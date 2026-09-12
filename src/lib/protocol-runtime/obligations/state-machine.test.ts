/**
 * RTN-008 — Obligation Ledger Authority: the A10 obligation state-machine
 * suite (legal + illegal).
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §2 Area 10,
 *   lines 91-103 (Obligation, verbatim): "States: CREATED -> NETTED ->
 *   SETTLEMENT_PENDING -> terminal(SETTLED | DISPUTED | WRITTEN_OFF |
 *   CANCELLED). Transitions:
 *    - CREATED -> NETTED: replaced by net positions in a committed
 *      netting set (area 11).
 *    - SETTLEMENT_PENDING: a settlement instruction (area 12) exists.
 *    - SETTLED: settlement finality recorded (area 12).
 *    - DISPUTED: a dispute (area 21) is open; resolution creates new
 *      obligations, never mutates this one.
 *    - WRITTEN_OFF: terminal disposition via risk authority.
 *    - CANCELLED: correction path with mandatory evidence."
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';
import { hashObligationTerms, transitionObligation } from './state-machine.ts';
import {
  OBLIGATION_STATES,
  OBLIGATION_TERMINAL_STATES,
  OBLIGATION_TRANSITIONS,
  canTransitionObligation,
  isObligationState,
  isObligationTerminalState,
} from './types.ts';
import type { ObligationRecord } from './types.ts';

const WHEN = protocolTime(1, 1_000);

function makeObligation(state: ObligationRecord['state']): ObligationRecord {
  return {
    obligationId: 'pid.v1.obligation-1',
    terms: {
      debtorParticipantId: 'participant-a',
      creditorParticipantId: 'participant-b',
      amount: { currency: 'EUR', scale: 2, amountMinor: 1_000 } as ObligationRecord['terms']['amount'],
      reason: 'hop settlement',
    },
    origin: {
      kind: 'CLEARING',
      originRecordId: 'pid.v1.record-1',
      originActivityId: 'activity-1',
      batchId: 'pid.v1.batch-1',
    },
    state,
    createdAt: WHEN,
    stateChangedAt: WHEN,
  };
}

describe('the Obligation state machine (A10 lines 92-103)', () => {
  test('the state vocabulary is exactly the seven written states', () => {
    expect([...OBLIGATION_STATES]).toEqual([
      'CREATED',
      'NETTED',
      'SETTLEMENT_PENDING',
      'SETTLED',
      'DISPUTED',
      'WRITTEN_OFF',
      'CANCELLED',
    ]);
    expect([...OBLIGATION_TERMINAL_STATES]).toEqual([
      'SETTLED',
      'DISPUTED',
      'WRITTEN_OFF',
      'CANCELLED',
    ]);
  });

  test('the frozen transition table: happy path + condition-driven edges, terminals absorbing', () => {
    // NETTED only from CREATED (a netted obligation was already replaced)
    expect(OBLIGATION_TRANSITIONS.CREATED).toContain('NETTED');
    // SETTLEMENT_PENDING from CREATED or NETTED (netting is optional)
    expect(OBLIGATION_TRANSITIONS.CREATED).toContain('SETTLEMENT_PENDING');
    expect(OBLIGATION_TRANSITIONS.NETTED).toEqual([
      'SETTLEMENT_PENDING',
      'DISPUTED',
      'WRITTEN_OFF',
      'CANCELLED',
    ]);
    // SETTLED only from SETTLEMENT_PENDING (finality requires an instruction)
    expect(OBLIGATION_TRANSITIONS.SETTLEMENT_PENDING).toEqual([
      'SETTLED',
      'DISPUTED',
      'WRITTEN_OFF',
      'CANCELLED',
    ]);
    // all four terminals are absorbing
    for (const terminal of OBLIGATION_TERMINAL_STATES) {
      expect(OBLIGATION_TRANSITIONS[terminal]).toEqual([]);
    }
  });

  test('legal transitions apply and stamp the state change time', () => {
    for (const [from, to] of [
      ['CREATED', 'NETTED'],
      ['CREATED', 'SETTLEMENT_PENDING'],
      ['CREATED', 'DISPUTED'],
      ['CREATED', 'WRITTEN_OFF'],
      ['CREATED', 'CANCELLED'],
      ['NETTED', 'SETTLEMENT_PENDING'],
      ['SETTLEMENT_PENDING', 'SETTLED'],
    ] as const) {
      const applied = transitionObligation(makeObligation(from), to, WHEN);
      expect(applied.ok).toBe(true);
      if (applied.ok) {
        expect(applied.obligation.state).toBe(to);
        expect(applied.obligation.stateChangedAt).toBe(WHEN);
      }
    }
  });

  test('illegal transitions are typed rejections: skips, replays, post-terminal, reversed edges', () => {
    // SETTLED directly from CREATED/NETTED (finality requires an instruction)
    expect(transitionObligation(makeObligation('CREATED'), 'SETTLED', WHEN).ok).toBe(false);
    expect(transitionObligation(makeObligation('NETTED'), 'SETTLED', WHEN).ok).toBe(false);
    // NETTED only from CREATED — a NETTED obligation is already replaced
    expect(transitionObligation(makeObligation('SETTLEMENT_PENDING'), 'NETTED', WHEN).ok).toBe(false);
    // replays
    expect(transitionObligation(makeObligation('CREATED'), 'CREATED', WHEN).ok).toBe(false);
    // post-terminal: every terminal has no outgoing edges
    for (const terminal of OBLIGATION_TERMINAL_STATES) {
      expect(transitionObligation(makeObligation(terminal), 'CREATED', WHEN).ok).toBe(false);
      expect(transitionObligation(makeObligation(terminal), 'SETTLED', WHEN).ok).toBe(false);
      expect(transitionObligation(makeObligation(terminal), 'DISPUTED', WHEN).ok).toBe(false);
    }
  });

  test('canTransitionObligation mirrors the table; the guards hold', () => {
    for (const from of OBLIGATION_STATES) {
      for (const to of OBLIGATION_STATES) {
        expect(canTransitionObligation(from, to)).toBe(OBLIGATION_TRANSITIONS[from].includes(to));
      }
    }
    expect(isObligationState('SETTLEMENT_PENDING')).toBe(true);
    expect(isObligationState('PENDING')).toBe(false);
    expect(isObligationTerminalState('SETTLED')).toBe(true);
    expect(isObligationTerminalState('SETTLEMENT_PENDING')).toBe(false);
  });

  test('the terms hash is deterministic and discriminating (the OBLIGATION_CREATED proof material)', () => {
    const termsA = makeObligation('CREATED').terms;
    const termsB = makeObligation('CREATED').terms;
    const differentAmount = {
      ...termsA,
      amount: money('EUR', 2_000, 2),
    };
    expect(hashObligationTerms(termsA)).toBe(hashObligationTerms(termsB));
    expect(hashObligationTerms(termsA)).not.toBe(hashObligationTerms(differentAmount));
    expect((hashObligationTerms(termsA)).length).toBe(64);
  });
});
