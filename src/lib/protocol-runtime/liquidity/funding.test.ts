/**
 * RTN-007 — Liquidity Authority: the FundingEntry exactly-once discipline
 * (INV-6-3) and the UNKNOWN-funding pending linkage (GC-2) — over the
 * REAL ReservationLedger and the REAL A15 log.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §1 Area 6:
 *   lines 58-60 (INV-6-3): "a FundingEntry id applies exactly once;
 *    duplicate funding submissions are detected by id and recorded as
 *    duplicates without effect."
 *   lines 64-69 (failure and UNKNOWN semantics): "External funding is
 *    performed by area 13 rail operations, which may return UNKNOWN; in
 *    that case no FundingEntry exists yet — the pool is unchanged, and
 *    the case waits for reconciliation (GC-2). After reconciliation
 *    confirms the external funding, the FundingEntry is created exactly
 *    once. If reconciliation confirms failure, no entry is created."
 */
import { describe, expect, test } from 'bun:test';
import { createEvidenceLog } from '../evidence/log.ts';
import { money } from '../kernel/money.ts';
import { ReservationLedger } from '../reservations/ledger.ts';
import { LiquidityAuthority } from './authority.ts';
import type { EvidenceSubmission, EvidenceSubmissionRecord } from '../kernel/ports.ts';

function makeAuthority() {
  const log = createEvidenceLog({ wallMs: 1_000 });
  const records: EvidenceSubmissionRecord[] = [];
  const recorder: EvidenceSubmission = { submit: (record) => { records.push(record); } };
  let wall = 5_000;
  const ledger = new ReservationLedger({ evidence: log, wallClock: () => wall });
  const authority = new LiquidityAuthority({
    evidence: recorder,
    ledger,
    wallClock: () => wall,
  });
  return {
    log,
    records,
    ledger,
    authority,
    advance: (ms: number) => { wall += ms; },
  };
}

async function openFundedPool(fundingMinor: number) {
  const { authority, records } = makeAuthority();
  const pool = await authority.openPool({ poolId: 'pool-a', currency: 'EUR', scale: 2 });
  expect(pool.ok).toBe(true);
  const funding = await authority.recordConfirmedFunding({
    poolId: 'pool-a',
    source: { kind: 'INTERNAL_TRANSFER', referenceId: 'transfer-1' },
    amount: money('EUR', fundingMinor, 2),
  });
  expect(funding.ok).toBe(true);
  return { authority, records, poolId: 'pool-a', funding };
}

describe('FundingEntry exactly-once (INV-6-3)', () => {
  test('a duplicate funding submission (same source reference) is detected, recorded as duplicate, no effect', async () => {
    const { authority, records } = await openFundedPool(500_00);
    const countBefore = records.length;
    const duplicate = await authority.recordConfirmedFunding({
      poolId: 'pool-a',
      source: { kind: 'INTERNAL_TRANSFER', referenceId: 'transfer-1' },
      amount: money('EUR', 500_00, 2),
    });
    expect(duplicate.ok).toBe(true);
    if (duplicate.ok && !duplicate.created) {
      expect(typeof duplicate.duplicateOf.fundingEntryId).toBe('string');
    } else {
      throw new Error('expected the duplicate observation');
    }
    // No effect: pool total unchanged, no new positions, no new evidence.
    expect(authority.pool('pool-a')?.totalMinor).toBe(500_00);
    expect(authority.positionsOf('pool-a').length).toBe(1);
    expect(records.length).toBe(countBefore);
  });

  test('the entry id is derived from the source reference — different references fund different entries', async () => {
    const { authority } = await openFundedPool(500_00);
    const second = await authority.recordConfirmedFunding({
      poolId: 'pool-a',
      source: { kind: 'INTERNAL_TRANSFER', referenceId: 'transfer-2' },
      amount: money('EUR', 250_00, 2),
    });
    expect(second.ok).toBe(true);
    if (second.ok && second.created) {
      expect(second.entry.fundingEntryId).not.toBe(authority.fundingEntry('nope')?.fundingEntryId);
    }
    expect(authority.pool('pool-a')?.totalMinor).toBe(750_00);
    expect(authority.positionsOf('pool-a').length).toBe(2);
    expect(authority.poolInvariant('pool-a')).toBe(true);
  });

  test('cross-currency funding into a single-currency pool is the typed rejection (INV-6-2)', async () => {
    const { authority } = await openFundedPool(500_00);
    const result = await authority.recordConfirmedFunding({
      poolId: 'pool-a',
      source: { kind: 'INTERNAL_TRANSFER', referenceId: 'transfer-usd' },
      amount: money('USD', 100_00, 2),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CURRENCY_MISMATCH');
    }
    expect(authority.pool('pool-a')?.totalMinor).toBe(500_00);
  });

  test('scale mismatch is the typed rejection (GC-1)', async () => {
    const { authority } = await openFundedPool(500_00);
    const result = await authority.recordConfirmedFunding({
      poolId: 'pool-a',
      source: { kind: 'INTERNAL_TRANSFER', referenceId: 'transfer-s0' },
      amount: money('EUR', 100, 0),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNIT_MISMATCH');
    }
  });
});

describe('UNKNOWN external funding (GC-2 — the pool is unchanged until reconciliation)', () => {
  test('opening a pending linkage leaves the pool unchanged and records no entry', async () => {
    const { authority } = await openFundedPool(500_00);
    const pending = await authority.openPendingFunding({
      poolId: 'pool-a',
      railOperationId: 'rail-op-unknown-1',
      expectedAmount: money('EUR', 200_00, 2),
    });
    expect(pending.ok).toBe(true);
    if (pending.ok) {
      expect(pending.link.status).toBe('PENDING');
    }
    // The pool is UNCHANGED: same total, same positions, no entry.
    expect(authority.pool('pool-a')?.totalMinor).toBe(500_00);
    expect(authority.positionsOf('pool-a').length).toBe(1);
    expect(authority.fundingEntry(pending.ok ? pending.link.pendingId : '')).toBe(undefined);
  });

  test('re-opening the same pending linkage is the recorded replay', async () => {
    const { authority } = await openFundedPool(500_00);
    await authority.openPendingFunding({
      poolId: 'pool-a',
      railOperationId: 'rail-op-unknown-1',
      expectedAmount: money('EUR', 200_00, 2),
    });
    const replay = await authority.openPendingFunding({
      poolId: 'pool-a',
      railOperationId: 'rail-op-unknown-1',
      expectedAmount: money('EUR', 200_00, 2),
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.replayed).toBe(true);
    }
  });

  test('RESOLVED_CONFIRMED creates the FundingEntry exactly once; replay returns the recorded entry', async () => {
    const { authority } = await openFundedPool(500_00);
    const pending = await authority.openPendingFunding({
      poolId: 'pool-a',
      railOperationId: 'rail-op-unknown-1',
      expectedAmount: money('EUR', 200_00, 2),
    });
    expect(pending.ok).toBe(true);
    const pendingId = pending.ok ? pending.link.pendingId : '';
    const resolution = await authority.resolvePendingFunding({
      pendingId,
      resolution: 'RESOLVED_CONFIRMED',
    });
    expect(resolution.ok).toBe(true);
    if (resolution.ok && resolution.resolution === 'RESOLVED_CONFIRMED') {
      expect(resolution.entry.amount.amountMinor).toBe(200_00);
      expect(resolution.position.state).toBe('AVAILABLE');
    }
    expect(authority.pool('pool-a')?.totalMinor).toBe(700_00);
    expect(authority.positionsOf('pool-a').length).toBe(2);
    // Exactly once: the replay of the identical resolution returns the
    // recorded entry with no second effect.
    const replay = await authority.resolvePendingFunding({
      pendingId,
      resolution: 'RESOLVED_CONFIRMED',
    });
    expect(replay.ok).toBe(true);
    if (replay.ok && replay.resolution === 'RESOLVED_CONFIRMED') {
      expect(replay.replayed).toBe(true);
    }
    expect(authority.pool('pool-a')?.totalMinor).toBe(700_00);
    expect(authority.positionsOf('pool-a').length).toBe(2);
  });

  test('RESOLVED_FAILED creates NO entry (the linkage closes without effect)', async () => {
    const { authority } = await openFundedPool(500_00);
    const pending = await authority.openPendingFunding({
      poolId: 'pool-a',
      railOperationId: 'rail-op-unknown-2',
      expectedAmount: money('EUR', 200_00, 2),
    });
    const pendingId = pending.ok ? pending.link.pendingId : '';
    const resolution = await authority.resolvePendingFunding({
      pendingId,
      resolution: 'RESOLVED_FAILED',
    });
    expect(resolution.ok).toBe(true);
    if (resolution.ok && resolution.resolution === 'RESOLVED_FAILED') {
      expect(resolution.link.status).toBe('RESOLVED_FAILED');
      expect(resolution.link.fundingEntryId).toBe(undefined);
    }
    expect(authority.pool('pool-a')?.totalMinor).toBe(500_00);
    expect(authority.positionsOf('pool-a').length).toBe(1);
  });

  test('a contradictory second resolution is the typed rejection', async () => {
    const { authority } = await openFundedPool(500_00);
    const pending = await authority.openPendingFunding({
      poolId: 'pool-a',
      railOperationId: 'rail-op-unknown-3',
      expectedAmount: money('EUR', 200_00, 2),
    });
    const pendingId = pending.ok ? pending.link.pendingId : '';
    await authority.resolvePendingFunding({ pendingId, resolution: 'RESOLVED_FAILED' });
    const contradiction = await authority.resolvePendingFunding({
      pendingId,
      resolution: 'RESOLVED_CONFIRMED',
    });
    expect(contradiction.ok).toBe(false);
    if (!contradiction.ok) {
      expect(contradiction.code).toBe('PENDING_ALREADY_RESOLVED');
    }
  });

  test('the direct confirmed path and the pending path derive the SAME entry id (structural exactly-once)', async () => {
    const { authority } = await openFundedPool(500_00);
    // The direct path records the funding for the rail operation.
    const direct = await authority.recordConfirmedFunding({
      poolId: 'pool-a',
      source: { kind: 'EXTERNAL_RAIL', referenceId: 'rail-op-9' },
      amount: money('EUR', 300_00, 2),
    });
    expect(direct.ok).toBe(true);
    // A pending linkage for the SAME rail operation cannot open (the
    // funding is already confirmed).
    const pending = await authority.openPendingFunding({
      poolId: 'pool-a',
      railOperationId: 'rail-op-9',
      expectedAmount: money('EUR', 300_00, 2),
    });
    expect(pending.ok).toBe(false);
    if (!pending.ok) {
      expect(pending.code).toBe('FUNDING_ENTRY_EXISTS');
    }
  });
});
