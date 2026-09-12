/**
 * RTN-007 — Liquidity Authority: the authority's command surface over the
 * REAL ReservationLedger — the ledger-mediated position machine (INV-6-2),
 * the INV-6-1 identity after every transition, pool gating, and the
 * fold's deterministic replay.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §1 Area 6:
 *   lines 33-39 (the machines); lines 52-57 (INV-6-1/INV-6-2);
 *   spec/architecture/v0.1/core.md §5 Area 5 lines 293-295 ("The ledger is
 *    the concurrency frontier: all resource mutations pass through it in
 *    sequence order"), lines 335-336 ("Depends on areas 6, 7, and 3 as
 *    resource owners").
 */
import { describe, expect, test } from 'bun:test';
import { createEvidenceLog } from '../evidence/log.ts';
import { money } from '../kernel/money.ts';
import { ReservationLedger } from '../reservations/ledger.ts';
import { LiquidityAuthority } from './authority.ts';

function makeAuthority() {
  const log = createEvidenceLog({ wallMs: 1_000 });
  let wall = 5_000;
  const ledger = new ReservationLedger({ evidence: log, wallClock: () => wall });
  const authority = new LiquidityAuthority({ evidence: log, ledger, wallClock: () => wall });
  return { log, ledger, authority, advance: (ms: number) => { wall += ms; } };
}

async function fundedPool(fundingMinor = 1_000_00) {
  const harness = makeAuthority();
  await harness.authority.openPool({ poolId: 'pool-a', currency: 'EUR', scale: 2 });
  const funding = await harness.authority.recordConfirmedFunding({
    poolId: 'pool-a',
    source: { kind: 'INTERNAL_TRANSFER', referenceId: 'transfer-1' },
    amount: money('EUR', fundingMinor, 2),
  });
  if (!funding.ok || !funding.created) {
    throw new Error('funding failed');
  }
  return { ...harness, position: funding.position, funding };
}

const AMOUNT = (minor: number) => money('EUR', minor, 2);

describe('position holds through the area-5 ledger (INV-6-2)', () => {
  test('a hold moves the position AVAILABLE -> RESERVED with exact accounting', async () => {
    const { authority, position } = await fundedPool(1_000_00);
    const hold = await authority.requestPositionHold({
      positionId: position.positionId,
      intentId: 'pid.v1.intent-1',
      hopId: 'pid.v1.hop-1',
      amount: AMOUNT(400_00),
      deadlineEpochMs: 60_000,
    });
    expect(hold.ok).toBe(true);
    if (hold.ok) {
      expect(hold.record.position.state).toBe('RESERVED');
      expect(hold.record.position.reserved.amountMinor).toBe(400_00);
      expect(hold.record.position.available.amountMinor).toBe(600_00);
      expect(hold.record.position.consumed.amountMinor).toBe(0);
    }
    expect(authority.poolInvariant('pool-a')).toBe(true);
  });

  test('the hold is a REAL ledger reservation against the position resource', async () => {
    const { authority, ledger, position } = await fundedPool(1_000_00);
    const hold = await authority.requestPositionHold({
      positionId: position.positionId,
      intentId: 'pid.v1.intent-1',
      hopId: 'pid.v1.hop-1',
      amount: AMOUNT(400_00),
      deadlineEpochMs: 60_000,
    });
    expect(hold.ok).toBe(true);
    const reservation = ledger.reservation(hold.ok ? hold.record.reservationId : '');
    expect(reservation?.state).toBe('HELD');
    expect(reservation?.resourceId).toBe(position.positionId);
    expect(ledger.availableOf(position.positionId)?.amountMinor).toBe(600_00);
  });

  test('a hold the position cannot cover is the typed INSUFFICIENT_AVAILABLE rejection (atomic INV-5-1/INV-6-1)', async () => {
    const { authority, position } = await fundedPool(100_00);
    const hold = await authority.requestPositionHold({
      positionId: position.positionId,
      intentId: 'pid.v1.intent-2',
      hopId: 'pid.v1.hop-2',
      amount: AMOUNT(200_00),
      deadlineEpochMs: 60_000,
    });
    expect(hold.ok).toBe(false);
    if (!hold.ok) {
      expect(hold.code).toBe('INSUFFICIENT_AVAILABLE');
    }
    expect(authority.position(position.positionId)?.state).toBe('AVAILABLE');
  });

  test('consuming the hold folds the position: partial consumption ends RETURNED; full consumption ends CONSUMED', async () => {
    const { authority, position } = await fundedPool(1_000_00);
    const hold = await authority.requestPositionHold({
      positionId: position.positionId,
      intentId: 'pid.v1.intent-1',
      hopId: 'pid.v1.hop-1',
      amount: AMOUNT(400_00),
      deadlineEpochMs: 60_000,
    });
    const reservationId = hold.ok ? hold.record.reservationId : '';
    const consumed = await authority.consumeHold(reservationId);
    expect(consumed.ok).toBe(true);
    if (consumed.ok) {
      // consumed 400 of 1000 — the residual was never held: the position
      // ends its cycle RETURNED with the residual attributable.
      expect(consumed.record.state).toBe('RETURNED');
      expect(consumed.record.consumed.amountMinor).toBe(400_00);
      expect(consumed.record.available.amountMinor).toBe(600_00);
      expect(consumed.record.reserved.amountMinor).toBe(0);
    }
    expect(authority.poolInvariant('pool-a')).toBe(true);
  });

  test('a full hold consumed to exhaustion ends CONSUMED (terminal)', async () => {
    const { authority, position } = await fundedPool(400_00);
    const hold = await authority.requestPositionHold({
      positionId: position.positionId,
      intentId: 'pid.v1.intent-1',
      hopId: 'pid.v1.hop-1',
      amount: AMOUNT(400_00),
      deadlineEpochMs: 60_000,
    });
    const consumed = await authority.consumeHold(hold.ok ? hold.record.reservationId : '');
    expect(consumed.ok).toBe(true);
    if (consumed.ok) {
      expect(consumed.record.state).toBe('CONSUMED');
      expect(consumed.record.consumed.amountMinor).toBe(400_00);
      expect(consumed.record.available.amountMinor).toBe(0);
    }
  });

  test('releasing the hold returns the amount and ends the cycle RETURNED', async () => {
    const { authority, position } = await fundedPool(1_000_00);
    const hold = await authority.requestPositionHold({
      positionId: position.positionId,
      intentId: 'pid.v1.intent-1',
      hopId: 'pid.v1.hop-1',
      amount: AMOUNT(400_00),
      deadlineEpochMs: 60_000,
    });
    const released = await authority.releaseHold(hold.ok ? hold.record.reservationId : '');
    expect(released.ok).toBe(true);
    if (released.ok) {
      expect(released.record.state).toBe('RETURNED');
      expect(released.record.available.amountMinor).toBe(1_000_00);
      expect(released.record.consumed.amountMinor).toBe(0);
    }
  });

  test('two concurrent partial holds keep the position RESERVED until both resolve; INV-6-1 holds at every step', async () => {
    const { authority, position } = await fundedPool(1_000_00);
    const first = await authority.requestPositionHold({
      positionId: position.positionId,
      intentId: 'pid.v1.intent-1',
      hopId: 'pid.v1.hop-1',
      amount: AMOUNT(300_00),
      deadlineEpochMs: 60_000,
    });
    const second = await authority.requestPositionHold({
      positionId: position.positionId,
      intentId: 'pid.v1.intent-2',
      hopId: 'pid.v1.hop-2',
      amount: AMOUNT(500_00),
      deadlineEpochMs: 60_000,
    });
    expect(first.ok && second.ok).toBe(true);
    expect(authority.position(position.positionId)?.state).toBe('RESERVED');
    expect(authority.position(position.positionId)?.reserved.amountMinor).toBe(800_00);
    // Consume the first: the second hold keeps the position RESERVED.
    await authority.consumeHold(first.ok ? first.record.reservationId : '');
    expect(authority.position(position.positionId)?.state).toBe('RESERVED');
    expect(authority.position(position.positionId)?.consumed.amountMinor).toBe(300_00);
    expect(authority.poolInvariant('pool-a')).toBe(true);
    // Release the second: held drains to zero -> terminal.
    await authority.releaseHold(second.ok ? second.record.reservationId : '');
    expect(authority.position(position.positionId)?.state).toBe('RETURNED');
    expect(authority.poolInvariant('pool-a')).toBe(true);
  });

  test('repeat consume/release commands replay the ledger terminal with no second effect', async () => {
    const { authority, position } = await fundedPool(1_000_00);
    const hold = await authority.requestPositionHold({
      positionId: position.positionId,
      intentId: 'pid.v1.intent-1',
      hopId: 'pid.v1.hop-1',
      amount: AMOUNT(400_00),
      deadlineEpochMs: 60_000,
    });
    const reservationId = hold.ok ? hold.record.reservationId : '';
    const first = await authority.consumeHold(reservationId);
    const second = await authority.consumeHold(reservationId);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.replayed).toBe(true);
      expect(second.record.state).toBe(first.record.state);
      expect(second.record.consumed.amountMinor).toBe(first.record.consumed.amountMinor);
    }
  });

  test('a hold against a TERMINAL position is the typed POSITION_TERMINAL rejection (no new holds)', async () => {
    const { authority, position } = await fundedPool(400_00);
    const hold = await authority.requestPositionHold({
      positionId: position.positionId,
      intentId: 'pid.v1.intent-1',
      hopId: 'pid.v1.hop-1',
      amount: AMOUNT(400_00),
      deadlineEpochMs: 60_000,
    });
    await authority.consumeHold(hold.ok ? hold.record.reservationId : '');
    const second = await authority.requestPositionHold({
      positionId: position.positionId,
      intentId: 'pid.v1.intent-2',
      hopId: 'pid.v1.hop-2',
      amount: AMOUNT(1),
      deadlineEpochMs: 60_000,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe('POSITION_TERMINAL');
    }
  });

  test('deadline expiry drives the position to RETURNED through the ledger', async () => {
    const harness = await fundedPool(1_000_00);
    const { authority, ledger, advance, position } = harness;
    await authority.requestPositionHold({
      positionId: position.positionId,
      intentId: 'pid.v1.intent-1',
      hopId: 'pid.v1.hop-1',
      amount: AMOUNT(400_00),
      deadlineEpochMs: 10_000,
    });
    advance(20_000);
    const expired = await authority.expireDueHolds();
    expect(expired.length).toBe(1);
    expect(expired[0]?.state).toBe('RETURNED');
    expect(expired[0]?.available.amountMinor).toBe(1_000_00);
    expect(authority.poolInvariant('pool-a')).toBe(true);
    expect(ledger.reservations().every((r) => r.state !== 'HELD')).toBe(true);
  });
});

describe('pool gating (frozen pools accept no new reservations; closure after all positions settle)', () => {
  test('a frozen pool rejects new holds (typed), but in-flight holds still settle', async () => {
    const { authority, position } = await fundedPool(1_000_00);
    const hold = await authority.requestPositionHold({
      positionId: position.positionId,
      intentId: 'pid.v1.intent-1',
      hopId: 'pid.v1.hop-1',
      amount: AMOUNT(400_00),
      deadlineEpochMs: 60_000,
    });
    await authority.freezePool('pool-a');
    expect(authority.pool('pool-a')?.state).toBe('FROZEN');
    const rejected = await authority.requestPositionHold({
      positionId: position.positionId,
      intentId: 'pid.v1.intent-2',
      hopId: 'pid.v1.hop-2',
      amount: AMOUNT(100_00),
      deadlineEpochMs: 60_000,
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.code).toBe('POOL_FROZEN_NO_NEW_RESERVATIONS');
    }
    // The in-flight hold still settles through the ledger.
    const consumed = await authority.consumeHold(hold.ok ? hold.record.reservationId : '');
    expect(consumed.ok).toBe(true);
  });

  test('closure requires FROZEN first (the exact chain; an empty pool settles trivially)', async () => {
    const { authority } = makeAuthority();
    await authority.openPool({ poolId: 'pool-empty', currency: 'EUR', scale: 2 });
    const fromOpen = await authority.closePool('pool-empty');
    expect(fromOpen.ok).toBe(false);
    if (!fromOpen.ok) {
      expect(fromOpen.code).toBe('ILLEGAL_TRANSITION');
    }
    await authority.freezePool('pool-empty');
    expect((await authority.closePool('pool-empty')).ok).toBe(true);
    expect(authority.pool('pool-empty')?.state).toBe('CLOSED');
  });

  test('closure requires all positions terminal (unsettled positions block)', async () => {
    const { authority, position } = await fundedPool(1_000_00);
    const hold = await authority.requestPositionHold({
      positionId: position.positionId,
      intentId: 'pid.v1.intent-1',
      hopId: 'pid.v1.hop-1',
      amount: AMOUNT(400_00),
      deadlineEpochMs: 60_000,
    });
    await authority.freezePool('pool-a');
    const blocked = await authority.closePool('pool-a');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe('POOL_HAS_UNSETTLED_POSITIONS');
    }
    await authority.releaseHold(hold.ok ? hold.record.reservationId : '');
    expect((await authority.closePool('pool-a')).ok).toBe(true);
  });

  test('pool open replays are idempotent; a conflicting re-open is the typed rejection', async () => {
    const { authority } = makeAuthority();
    const first = await authority.openPool({ poolId: 'pool-b', currency: 'USD', scale: 2 });
    const replay = await authority.openPool({ poolId: 'pool-b', currency: 'USD', scale: 2 });
    expect(first.ok && replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.replayed).toBe(true);
    }
    const conflicting = await authority.openPool({ poolId: 'pool-b', currency: 'EUR', scale: 2 });
    expect(conflicting.ok).toBe(false);
  });
});

describe('the fold is the deterministic projection of the ledger log', () => {
  test('concurrent holds on one position serialize; the fold matches the ledger accounting exactly', async () => {
    const { authority, ledger, position } = await fundedPool(1_000_00);
    const requests = [1, 2, 3, 4, 5].map((index) =>
      authority.requestPositionHold({
        positionId: position.positionId,
        intentId: `pid.v1.intent-${index}`,
        hopId: `pid.v1.hop-${index}`,
        amount: AMOUNT(100_00),
        deadlineEpochMs: 60_000,
      }),
    );
    const results = await Promise.all(requests);
    for (const result of results) {
      expect(result.ok).toBe(true);
    }
    const stored = authority.position(position.positionId);
    const accounting = ledger.resourceAccounting(position.positionId);
    expect(stored?.reserved.amountMinor).toBe(accounting?.heldTotal.amountMinor);
    expect(stored?.available.amountMinor).toBe(ledger.availableOf(position.positionId)?.amountMinor);
    expect(stored?.state).toBe('RESERVED');
    expect(authority.poolInvariant('pool-a')).toBe(true);
  });

  test('INV-6-1 holds after every command of a mixed sequence (pool total = integer sum of positions)', async () => {
    const harness = makeAuthority();
    const { authority } = harness;
    await authority.openPool({ poolId: 'pool-c', currency: 'EUR', scale: 2 });
    const positions = [];
    for (let index = 1; index <= 3; index += 1) {
      const funding = await authority.recordConfirmedFunding({
        poolId: 'pool-c',
        source: { kind: 'INTERNAL_TRANSFER', referenceId: `transfer-${index}` },
        amount: AMOUNT(300_00),
      });
      if (funding.ok && funding.created) {
        positions.push(funding.position);
      }
    }
    expect(authority.pool('pool-c')?.totalMinor).toBe(900_00);
    // Hold, consume, release, expire across the positions.
    for (const [index, position] of positions.entries()) {
      const hold = await authority.requestPositionHold({
        positionId: position.positionId,
        intentId: `pid.v1.intent-${index}`,
        hopId: `pid.v1.hop-${index}`,
        amount: AMOUNT(100_00),
        deadlineEpochMs: index === 1 ? 5_000 : 60_000,
      });
      if (hold.ok) {
        if (index === 0) {
          await authority.consumeHold(hold.record.reservationId);
        } else if (index === 1) {
          harness.advance(10_000);
          await authority.expireDueHolds();
        } else {
          await authority.releaseHold(hold.record.reservationId);
        }
      }
      expect(authority.poolInvariant('pool-c')).toBe(true);
    }
    expect(authority.pool('pool-c')?.totalMinor).toBe(900_00);
    const states = authority.positionsOf('pool-c').map((position) => position.state);
    expect(states).toEqual(['RETURNED', 'RETURNED', 'RETURNED']);
  });
});
