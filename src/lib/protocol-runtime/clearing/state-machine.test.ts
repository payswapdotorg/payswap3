/**
 * RTN-008 — Clearing Authority: the A09 state-machine suites (legal +
 * illegal) for ClearingBatch and ClearingRecord.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §1 Area 9,
 *   lines 29-33 (ClearingBatch, verbatim): "States: OPEN -> STAGED ->
 *   COMMITTED -> FINAL. Contents are immutable after STAGED. COMMITTED
 *   means obligations have been created; FINAL means all produced
 *   obligations are handed to the obligation ledger."
 *   lines 35-40 (ClearingRecord, verbatim): "States: ACCEPTED -> STAGED
 *   | QUARANTINED. Quarantined records never produce obligations; they
 *   await manual or automated disposition with reason codes."
 */
import { describe, expect, test } from 'bun:test';
import { protocolTime } from '../kernel/time.ts';
import { transitionBatch, transitionRecord } from './state-machine.ts';
import {
  BATCH_STATES,
  BATCH_TRANSITIONS,
  RECORD_STATES,
  RECORD_TRANSITIONS,
  batchStateRank,
  canTransitionBatch,
  canTransitionRecord,
  isBatchState,
  isRecordState,
} from './types.ts';
import type { ClearingBatchRecord, ClearingRecord } from './types.ts';

const WHEN = protocolTime(1, 1_000);

function makeBatch(state: ClearingBatchRecord['state']): ClearingBatchRecord {
  return {
    batchId: 'pid.v1.batch-1',
    sequence: 0,
    state,
    recordCount: 0,
    perCurrencyTotals: '{}',
    contentsHash: 'hash',
    openedAt: WHEN,
    stateChangedAt: WHEN,
  };
}

function makeRecord(state: ClearingRecord['state']): ClearingRecord {
  return {
    recordId: 'pid.v1.record-1',
    origin: { originActivityId: 'activity-1', originKind: 'INTENT' },
    parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
    amount: { currency: 'EUR', scale: 2, amountMinor: 1_000 } as ClearingRecord['amount'],
    reason: 'hop settlement',
    state,
    acceptedAt: WHEN,
    stateChangedAt: WHEN,
  };
}

describe('the ClearingBatch state machine (A09 lines 29-33)', () => {
  test('the state vocabulary is exactly the four written states', () => {
    expect([...BATCH_STATES]).toEqual(['OPEN', 'STAGED', 'COMMITTED', 'FINAL']);
  });

  test('the frozen transition table is the exact linear chain OPEN->STAGED->COMMITTED->FINAL', () => {
    expect(BATCH_TRANSITIONS.OPEN).toEqual(['STAGED']);
    expect(BATCH_TRANSITIONS.STAGED).toEqual(['COMMITTED']);
    expect(BATCH_TRANSITIONS.COMMITTED).toEqual(['FINAL']);
    expect(BATCH_TRANSITIONS.FINAL).toEqual([]);
  });

  test('legal transitions apply and stamp the state change time', () => {
    const staged = transitionBatch(makeBatch('OPEN'), 'STAGED', WHEN);
    expect(staged.ok).toBe(true);
    if (staged.ok) {
      expect(staged.batch.state).toBe('STAGED');
      expect(staged.batch.stateChangedAt).toBe(WHEN);
    }
    const committed = transitionBatch(makeBatch('STAGED'), 'COMMITTED', WHEN);
    expect(committed.ok).toBe(true);
    const finalized = transitionBatch(makeBatch('COMMITTED'), 'FINAL', WHEN);
    expect(finalized.ok).toBe(true);
  });

  test('illegal transitions are typed rejections: skips, replays, post-terminal', () => {
    // skips: OPEN->COMMITTED, OPEN->FINAL, STAGED->FINAL
    expect(transitionBatch(makeBatch('OPEN'), 'COMMITTED', WHEN).ok).toBe(false);
    expect(transitionBatch(makeBatch('OPEN'), 'FINAL', WHEN).ok).toBe(false);
    expect(transitionBatch(makeBatch('STAGED'), 'FINAL', WHEN).ok).toBe(false);
    // replays (from === to)
    expect(transitionBatch(makeBatch('OPEN'), 'OPEN', WHEN).ok).toBe(false);
    expect(transitionBatch(makeBatch('STAGED'), 'STAGED', WHEN).ok).toBe(false);
    // post-terminal: FINAL has no outgoing edges
    expect(transitionBatch(makeBatch('FINAL'), 'OPEN', WHEN).ok).toBe(false);
    expect(transitionBatch(makeBatch('FINAL'), 'FINAL', WHEN).ok).toBe(false);
  });

  test('canTransitionBatch mirrors the table; isBatchState guards the vocabulary', () => {
    for (const from of BATCH_STATES) {
      for (const to of BATCH_STATES) {
        expect(canTransitionBatch(from, to)).toBe(BATCH_TRANSITIONS[from].includes(to));
      }
    }
    expect(isBatchState('OPEN')).toBe(true);
    expect(isBatchState('REOPENED')).toBe(false);
    expect(isBatchState(null)).toBe(false);
  });

  test('batchStateRank orders the chain (the INV-9-2 monotonicity substrate)', () => {
    expect(batchStateRank('OPEN') < batchStateRank('STAGED')).toBe(true);
    expect(batchStateRank('STAGED') < batchStateRank('COMMITTED')).toBe(true);
    expect(batchStateRank('COMMITTED') < batchStateRank('FINAL')).toBe(true);
  });
});

describe('the ClearingRecord state machine (A09 lines 35-40)', () => {
  test('the state vocabulary is exactly the three written states', () => {
    expect([...RECORD_STATES]).toEqual(['ACCEPTED', 'STAGED', 'QUARANTINED']);
  });

  test('the frozen transition table is the exact fork ACCEPTED->STAGED|QUARANTINED with absorbing successors', () => {
    expect(RECORD_TRANSITIONS.ACCEPTED).toEqual(['STAGED', 'QUARANTINED']);
    expect(RECORD_TRANSITIONS.STAGED).toEqual([]);
    expect(RECORD_TRANSITIONS.QUARANTINED).toEqual([]);
  });

  test('a passing record stages (ACCEPTED -> STAGED) with no reason code', () => {
    const staged = transitionRecord(makeRecord('ACCEPTED'), 'STAGED', WHEN);
    expect(staged.ok).toBe(true);
    if (staged.ok) {
      expect(staged.record.state).toBe('STAGED');
      expect(staged.record.quarantineReason === undefined).toBe(true);
    }
  });

  test('a failing record quarantines (ACCEPTED -> QUARANTINED) with a MANDATORY reason code', () => {
    const quarantined = transitionRecord(makeRecord('ACCEPTED'), 'QUARANTINED', WHEN, 'ZERO_AMOUNT');
    expect(quarantined.ok).toBe(true);
    if (quarantined.ok) {
      expect(quarantined.record.state).toBe('QUARANTINED');
      expect(quarantined.record.quarantineReason).toBe('ZERO_AMOUNT');
    }
    // "with reason codes" is mandatory: a quarantine without a reason is
    // not a state this machine can represent.
    expect(transitionRecord(makeRecord('ACCEPTED'), 'QUARANTINED', WHEN).ok).toBe(false);
    // and a stage with a reason code is refused (the reason belongs to
    // the quarantine edge only)
    expect(transitionRecord(makeRecord('ACCEPTED'), 'STAGED', WHEN, 'ZERO_AMOUNT').ok).toBe(false);
  });

  test('quarantined records are absorbing: never dropped, never re-accepted (illegal edges)', () => {
    // QUARANTINED -> STAGED would let a quarantined record produce an
    // obligation — the machine makes it unrepresentable.
    expect(transitionRecord(makeRecord('QUARANTINED'), 'STAGED', WHEN).ok).toBe(false);
    expect(transitionRecord(makeRecord('QUARANTINED'), 'ACCEPTED', WHEN).ok).toBe(false);
    expect(transitionRecord(makeRecord('QUARANTINED'), 'QUARANTINED', WHEN, 'ZERO_AMOUNT').ok).toBe(false);
    // STAGED -> QUARANTINED after staging would mutate frozen contents.
    expect(transitionRecord(makeRecord('STAGED'), 'QUARANTINED', WHEN, 'ZERO_AMOUNT').ok).toBe(false);
    expect(transitionRecord(makeRecord('STAGED'), 'STAGED', WHEN).ok).toBe(false);
  });

  test('canTransitionRecord mirrors the table; isRecordState guards the vocabulary', () => {
    for (const from of RECORD_STATES) {
      for (const to of RECORD_STATES) {
        expect(canTransitionRecord(from, to)).toBe(RECORD_TRANSITIONS[from].includes(to));
      }
    }
    expect(isRecordState('ACCEPTED')).toBe(true);
    expect(isRecordState('DROPPED')).toBe(false);
  });
});
