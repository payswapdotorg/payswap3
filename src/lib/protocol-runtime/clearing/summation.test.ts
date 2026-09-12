/**
 * RTN-008 — Clearing Authority: the INV-9-1 per-currency integer
 * summation checks and the derived identity of records/batches.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §1 Area 9,
 *   lines 48-51 (INV-9-1, verbatim): "amounts are integer Money; staging
 *   performs per-currency integer summation checks; a batch is committed
 *   only if every included record passes validation."
 *   lines 52-54 (INV-9-2): "record deduplication keys (origin activity
 *   id) ...".
 *   spec/architecture/v0.1/README.md §3 GC-1 (integer-only arithmetic,
 *   deterministic re-runs).
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import {
  batchCommitIdempotencyKey,
  canonicalTotalsJson,
  clearingBatchId,
  clearingRecordId,
  hashStagedContents,
  stagedPerCurrencyTotals,
  totalsToMap,
  validateClearingRecord,
} from './summation.ts';
import type { ClearingRecord } from './types.ts';

const WHEN = { sequence: 0, wallMs: 0 } as ClearingRecord['stateChangedAt'];

function record(overrides: Partial<ClearingRecord> = {}): ClearingRecord {
  return {
    recordId: 'pid.v1.record-1',
    origin: { originActivityId: 'activity-1', originKind: 'INTENT' },
    parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
    amount: money('EUR', 1_000, 2),
    reason: 'hop settlement',
    state: 'STAGED',
    acceptedAt: WHEN,
    stateChangedAt: WHEN,
    ...overrides,
  };
}

describe('INV-9-1 per-record validation (lines 48-51)', () => {
  test('a well-formed record passes', () => {
    expect(
      validateClearingRecord({
        amount: money('EUR', 1_000, 2),
        parties: { debtorParticipantId: 'a', creditorParticipantId: 'b' },
        seenCurrencyScales: {},
        unresolvedUnknownOperationIds: [],
      }).ok,
    ).toBe(true);
  });

  test('a malformed Money amount is INVALID_MONEY_SHAPE (GC-1: integer-only)', () => {
    expect(
      validateClearingRecord({
        amount: { currency: 'EUR', scale: 2, amountMinor: 1.5 } as never,
        parties: { debtorParticipantId: 'a', creditorParticipantId: 'b' },
        seenCurrencyScales: {},
        unresolvedUnknownOperationIds: [],
      }),
    ).toEqual({ ok: false, reason: 'INVALID_MONEY_SHAPE' });
  });

  test('a self-party record is SELF_PARTY (a self-debt is not an economic event)', () => {
    expect(
      validateClearingRecord({
        amount: money('EUR', 1_000, 2),
        parties: { debtorParticipantId: 'a', creditorParticipantId: 'a' },
        seenCurrencyScales: {},
        unresolvedUnknownOperationIds: [],
      }),
    ).toEqual({ ok: false, reason: 'SELF_PARTY' });
  });

  test('a zero-amount record is ZERO_AMOUNT', () => {
    expect(
      validateClearingRecord({
        amount: money('EUR', 0, 2),
        parties: { debtorParticipantId: 'a', creditorParticipantId: 'b' },
        seenCurrencyScales: {},
        unresolvedUnknownOperationIds: [],
      }),
    ).toEqual({ ok: false, reason: 'ZERO_AMOUNT' });
  });

  test('a scale mismatch within one currency is SCALE_MISMATCH_WITHIN_CURRENCY (integer summation requires same-unit operands)', () => {
    expect(
      validateClearingRecord({
        amount: money('EUR', 1_000, 3),
        parties: { debtorParticipantId: 'a', creditorParticipantId: 'b' },
        seenCurrencyScales: { EUR: 2 },
        unresolvedUnknownOperationIds: [],
      }),
    ).toEqual({ ok: false, reason: 'SCALE_MISMATCH_WITHIN_CURRENCY' });
    // the first record of a currency sets the convention
    expect(
      validateClearingRecord({
        amount: money('EUR', 1_000, 3),
        parties: { debtorParticipantId: 'a', creditorParticipantId: 'b' },
        seenCurrencyScales: {},
        unresolvedUnknownOperationIds: [],
      }).ok,
    ).toBe(true);
  });

  test('an upstream-UNKNOWN activity is UPSTREAM_UNRESOLVED_UNKNOWN (A09 lines 58-64)', () => {
    expect(
      validateClearingRecord({
        amount: money('EUR', 1_000, 2),
        parties: { debtorParticipantId: 'a', creditorParticipantId: 'b' },
        seenCurrencyScales: {},
        unresolvedUnknownOperationIds: ['rail-op-unknown-1'],
      }),
    ).toEqual({ ok: false, reason: 'UPSTREAM_UNRESOLVED_UNKNOWN' });
  });
});

describe('INV-9-1 per-currency integer summation (lines 48-51)', () => {
  test('staged totals are the entrywise integer sums per currency', () => {
    const records = [
      record({ amount: money('EUR', 1_000, 2) }),
      record({ amount: money('EUR', 2_500, 2) }),
      record({ amount: money('USD', 500, 2), origin: { originActivityId: 'activity-2', originKind: 'INTENT' } }),
    ];
    const { bag, scales } = stagedPerCurrencyTotals(records);
    expect(totalsToMap(bag)).toEqual({ EUR: 3_500, USD: 500 });
    expect(scales).toEqual({ EUR: 2, USD: 2 });
  });

  test('quarantined records never join the summation (they never produce obligations)', () => {
    const records = [
      record({ amount: money('EUR', 1_000, 2) }),
      record({
        state: 'QUARANTINED',
        quarantineReason: 'ZERO_AMOUNT',
        amount: money('EUR', 99_999, 2),
        origin: { originActivityId: 'activity-2', originKind: 'INTENT' },
      }),
    ];
    const { bag } = stagedPerCurrencyTotals(records);
    expect(totalsToMap(bag)).toEqual({ EUR: 1_000 });
  });

  test('the summation is deterministic (GC-1) and ascending-currency-ordered', () => {
    const records = [
      record({ amount: money('USD', 5, 2) }),
      record({ amount: money('EUR', 7, 2), origin: { originActivityId: 'activity-2', originKind: 'INTENT' } }),
      record({ amount: money('USD', 5, 2) }),
    ];
    const first = stagedPerCurrencyTotals(records);
    const second = stagedPerCurrencyTotals(records);
    expect(first.bag.entries).toEqual(second.bag.entries);
    expect(first.bag.entries.map((entry) => entry.currency)).toEqual(['EUR', 'USD']);
    expect(first.bag.entries.map((entry) => entry.amountMinor)).toEqual([7, 10]);
  });

  test('the totals JSON and the staged contents hash are deterministic', () => {
    const totals = { EUR: 3_500, USD: 500 };
    expect(canonicalTotalsJson(totals)).toBe(canonicalTotalsJson({ USD: 500, EUR: 3_500 }));
    expect(hashStagedContents(['r1', 'r2'], totals)).toBe(hashStagedContents(['r1', 'r2'], totals));
    expect(hashStagedContents(['r1', 'r2'], totals)).not.toBe(hashStagedContents(['r2', 'r1'], totals));
  });
});

describe('derived identity (INV-9-2/INV-9-3/INV-10-3 keys)', () => {
  test('the record id is a pure function of the origin identity (the INV-10-3 creation key)', () => {
    const a = clearingRecordId({ originActivityId: 'activity-1', originKind: 'INTENT' });
    const b = clearingRecordId({ originActivityId: 'activity-1', originKind: 'INTENT' });
    expect(a).toBe(b);
    expect(a.startsWith('pid.v1.')).toBe(true);
    // different origin kind or activity derives a different key
    expect(clearingRecordId({ originActivityId: 'activity-1', originKind: 'ROUTE_PLAN_HOP' })).not.toBe(a);
    expect(clearingRecordId({ originActivityId: 'activity-2', originKind: 'INTENT' })).not.toBe(a);
  });

  test('the batch id is a pure function of the batch label (the INV-9-3 re-commit key)', () => {
    expect(clearingBatchId('cycle-2025-01')).toBe(clearingBatchId('cycle-2025-01'));
    expect(clearingBatchId('cycle-2025-01')).not.toBe(clearingBatchId('cycle-2025-02'));
    expect(clearingBatchId('cycle-2025-01').startsWith('pid.v1.')).toBe(true);
  });

  test('the commit idempotency key is a pure function of the batch id (the idempotency proof)', () => {
    const key = batchCommitIdempotencyKey('pid.v1.batch-1');
    expect(key).toBe(batchCommitIdempotencyKey('pid.v1.batch-1'));
    expect(key).not.toBe(batchCommitIdempotencyKey('pid.v1.batch-2'));
    expect(key.startsWith('idem.v1.')).toBe(true);
  });
});
