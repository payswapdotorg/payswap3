/**
 * RTN-009 — Netting Authority: the state machines, the derived identity,
 * and the scope contract.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §3 Area 11:
 *     lines 158-160 — "States: OPEN -> COMPUTED -> COMMITTED."
 *     lines 161-163 — "OPEN: input obligation ids fixed. COMPUTED: net
 *      positions computed and checkable. COMMITTED: input obligations
 *      moved to NETTED and replaced by net obligations in the ledger."
 *     lines 167-169 — "NettingScope — bilateral (exactly two
 *      participants) or multilateral (three or more, defined participant
 *      set)."
 *     lines 185-189 (INV-11-3 — the pure-function identity inputs).
 *   spec/architecture/v0.1/README.md §3 GC-1 (identical inputs ->
 *    identical outputs).
 */
import { describe, expect, test } from 'bun:test';
import {
  NETTING_SET_STATES,
  NETTING_SET_TRANSITIONS,
  NET_OBLIGATION_STATES,
  NET_OBLIGATION_TRANSITIONS,
  canTransitionNetObligation,
  canTransitionNettingSet,
  isNetObligationState,
  isNettingSetState,
} from './types.ts';
import {
  mintNettingScope,
  netObligationIdFor,
  nettingSetIdForLabel,
  transitionNetObligation,
  transitionNettingSet,
} from './state-machine.ts';
import { money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';

const WHEN = protocolTime(0, 0);
const EUR = (minor: number) => money('EUR', minor, 2);

describe('the NettingSet state machine (lines 158-163)', () => {
  test('the exact three-state vocabulary', () => {
    expect([...NETTING_SET_STATES]).toEqual(['OPEN', 'COMPUTED', 'COMMITTED']);
    expect(isNettingSetState('OPEN')).toBe(true);
    expect(isNettingSetState('ABORTED')).toBe(false);
  });

  test('the one-way chain: OPEN->COMPUTED->COMMITTED; COMMITTED is terminal', () => {
    expect([...NETTING_SET_TRANSITIONS.OPEN]).toEqual(['COMPUTED']);
    expect([...NETTING_SET_TRANSITIONS.COMPUTED]).toEqual(['COMMITTED']);
    expect([...NETTING_SET_TRANSITIONS.COMMITTED]).toEqual([]);
    expect(canTransitionNettingSet('OPEN', 'COMPUTED')).toBe(true);
    expect(canTransitionNettingSet('COMPUTED', 'COMMITTED')).toBe(true);
    // No invented abort/cancel state; no reversal.
    expect(canTransitionNettingSet('COMPUTED', 'OPEN')).toBe(false);
    expect(canTransitionNettingSet('COMMITTED', 'OPEN')).toBe(false);
    expect(canTransitionNettingSet('OPEN', 'COMMITTED')).toBe(false);
  });

  test('the pure transition carrier applies the machine', () => {
    const set = {
      nettingSetId: 'pid.v1.abc',
      state: 'OPEN' as const,
      scope: mintNettingScope({ kind: 'BILATERAL', participants: ['a', 'b'] }),
      algorithmVersion: 1,
      inputObligationIds: ['o1'],
      openedAt: WHEN,
    };
    expect(transitionNettingSet(set, 'COMPUTED', WHEN).ok).toBe(true);
    expect(transitionNettingSet(set, 'COMMITTED', WHEN).ok).toBe(false);
    const computed = transitionNettingSet(set, 'COMPUTED', WHEN);
    if (computed.ok) {
      expect(transitionNettingSet(computed.set, 'COMMITTED', WHEN).ok).toBe(true);
      expect(transitionNettingSet(computed.set, 'OPEN', WHEN).ok).toBe(false);
    }
  });
});

describe('the NetObligation state machine (the A10 settlement-facing subset)', () => {
  test('the exact vocabulary and one-way chain', () => {
    expect([...NET_OBLIGATION_STATES]).toEqual(['CREATED', 'SETTLEMENT_PENDING', 'SETTLED']);
    expect([...NET_OBLIGATION_TRANSITIONS.CREATED]).toEqual(['SETTLEMENT_PENDING']);
    expect([...NET_OBLIGATION_TRANSITIONS.SETTLEMENT_PENDING]).toEqual(['SETTLED']);
    // FINAL is irreversible: SETTLED has an empty successor set (INV-12-4).
    expect([...NET_OBLIGATION_TRANSITIONS.SETTLED]).toEqual([]);
    expect(isNetObligationState('NETTED')).toBe(false); // net obligations never pass through NETTED
    expect(canTransitionNetObligation('SETTLED', 'SETTLEMENT_PENDING')).toBe(false);
    expect(canTransitionNetObligation('SETTLED', 'CREATED')).toBe(false);
  });

  test('the pure transition carrier', () => {
    const netObligation = {
      netObligationId: 'pid.v1.xyz',
      nettingSetId: 'pid.v1.set',
      debtorParticipantId: 'a',
      creditorParticipantId: 'b',
      amount: EUR(50),
      state: 'CREATED' as const,
      createdAt: WHEN,
      stateChangedAt: WHEN,
    };
    expect(transitionNetObligation(netObligation, 'SETTLEMENT_PENDING', WHEN).ok).toBe(true);
    expect(transitionNetObligation(netObligation, 'SETTLED', WHEN).ok).toBe(false);
  });
});

describe('the NettingScope contract (lines 167-169)', () => {
  test('bilateral: exactly two participants, sorted, duplicates rejected', () => {
    const scope = mintNettingScope({ kind: 'BILATERAL', participants: ['b-participant', 'a-participant'] });
    expect(scope.kind).toBe('BILATERAL');
    expect(scope.participants).toEqual(['a-participant', 'b-participant']);
    expect(() => mintNettingScope({ kind: 'BILATERAL', participants: ['only-one'] })).toThrow();
    expect(() =>
      mintNettingScope({ kind: 'BILATERAL', participants: ['a', 'b', 'c'] }),
    ).toThrow();
    expect(() => mintNettingScope({ kind: 'BILATERAL', participants: ['a', 'a'] })).toThrow();
  });

  test('multilateral: three or more, sorted, duplicates rejected', () => {
    const scope = mintNettingScope({ kind: 'MULTILATERAL', participants: ['c', 'a', 'b'] });
    expect(scope.participants).toEqual(['a', 'b', 'c']);
    expect(() => mintNettingScope({ kind: 'MULTILATERAL', participants: ['a', 'b'] })).toThrow();
    expect(() => mintNettingScope({ kind: 'MULTILATERAL', participants: ['a', 'a', 'b'] })).toThrow();
  });
});

describe('derived identity (INV-11-3 + GC-1)', () => {
  test('set ids derive from labels: identical labels, identical ids', () => {
    expect(nettingSetIdForLabel('cycle-1')).toBe(nettingSetIdForLabel('cycle-1'));
    expect(nettingSetIdForLabel('cycle-1')).not.toBe(nettingSetIdForLabel('cycle-2'));
  });

  test('net obligation ids derive from (set, debtor, creditor, currency)', () => {
    const first = netObligationIdFor('set-1', 'a', 'b', 'EUR');
    expect(first).toBe(netObligationIdFor('set-1', 'a', 'b', 'EUR'));
    expect(first).not.toBe(netObligationIdFor('set-1', 'b', 'a', 'EUR')); // direction matters
    expect(first).not.toBe(netObligationIdFor('set-2', 'a', 'b', 'EUR'));
    expect(first).not.toBe(netObligationIdFor('set-1', 'a', 'b', 'USD'));
  });
});
