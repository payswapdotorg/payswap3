/**
 * RTN-007 — Liquidity Authority: the INV-6-1 property tests — randomized
 * command sequences over the REAL ledger and authority, asserting the
 * arithmetic identity after EVERY transition (the spec's "pool total
 * equals the integer sum of its positions at all times; per position,
 * available + reserved + consumed arithmetic is exact and integer").
 *
 * Tested contract (spec-cited):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §1 Area 6, lines
 *   52-54 (INV-6-1, quoted in the module doc of accounting.ts).
 *
 * Determinism: the sequences are driven by a SEEDED xorshift32 PRNG
 * (integer arithmetic only — GC-1); identical seeds yield identical
 * sequences, so failures are reproducible.
 */
import { describe, expect, test } from 'bun:test';
import { createEvidenceLog } from '../evidence/log.ts';
import { money } from '../kernel/money.ts';
import { ReservationLedger } from '../reservations/ledger.ts';
import { LiquidityAuthority } from './authority.ts';
import { positionInvariantHolds, poolInvariantHolds } from './accounting.ts';

/** Seeded xorshift32 — deterministic integer PRNG (no Math.random). */
function xorshift32(seed: number): () => number {
  let state = seed | 0;
  if (state === 0) {
    state = 0x9e3779b9;
  }
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    return Math.abs(state);
  };
}

const AMOUNT = (minor: number) => money('EUR', minor, 2);

async function runScenario(seed: number): Promise<{
  finalTotal: number;
  positionStates: string[];
  poolIdentity: boolean;
  positionIdentities: boolean[];
  entryCount: number;
}> {
  const random = xorshift32(seed);
  const log = createEvidenceLog({ wallMs: 1_000 });
  let wall = 5_000;
  const ledger = new ReservationLedger({ evidence: log, wallClock: () => wall });
  const authority = new LiquidityAuthority({ evidence: log, ledger, wallClock: () => wall });
  await authority.openPool({ poolId: `pool-${seed}`, currency: 'EUR', scale: 2 });

  // Randomized funding: 1..4 positions of 100..500.
  const positionCount = 1 + (random() % 4);
  for (let index = 0; index < positionCount; index += 1) {
    await authority.recordConfirmedFunding({
      poolId: `pool-${seed}`,
      source: { kind: 'INTERNAL_TRANSFER', referenceId: `transfer-${seed}-${index}` },
      amount: AMOUNT(100 * (1 + (random() % 5))),
    });
  }

  const liveHolds: { reservationId: string; positionId: string }[] = [];
  const check = () => {
    const pool = authority.pool(`pool-${seed}`);
    const positions = authority.positionsOf(`pool-${seed}`);
    if (pool === undefined) {
      throw new Error('pool vanished');
    }
    const identity = poolInvariantHolds({
      poolCurrency: pool.currency,
      poolScale: pool.scale,
      storedTotalMinor: pool.totalMinor,
      positionTotals: positions.map((position) => position.total),
    });
    if (!identity) {
      throw new Error(`INV-6-1 violated at seed ${seed}`);
    }
    for (const position of positions) {
      if (
        !positionInvariantHolds({
          state: position.state,
          total: position.total,
          available: position.available,
          reserved: position.reserved,
          consumed: position.consumed,
        })
      ) {
        throw new Error(`INV-6-1 per-position violated at seed ${seed} on ${position.positionId}`);
      }
    }
  };

  // 150 randomized commands; the identity is checked after EVERY command.
  let commandCount = 0;
  for (let step = 0; step < 150; step += 1) {
    const roll = random() % 100;
    const positions = authority.positionsOf(`pool-${seed}`);
    if (roll < 30 && positions.length > 0) {
      // Request a hold on a random non-terminal position.
      const target = positions[random() % positions.length];
      if (target.state !== 'CONSUMED' && target.state !== 'RETURNED') {
        const hold = await authority.requestPositionHold({
          positionId: target.positionId,
          intentId: `pid.v1.i-${seed}-${commandCount}`,
          hopId: `pid.v1.h-${seed}-${commandCount}`,
          amount: AMOUNT(100 * (1 + (random() % 3))),
          deadlineEpochMs: 10_000 + 10_000 * (random() % 5),
        });
        if (hold.ok) {
          liveHolds.push({ reservationId: hold.record.reservationId, positionId: target.positionId });
        }
      }
    } else if (roll < 50 && liveHolds.length > 0) {
      const index = random() % liveHolds.length;
      const chosen = liveHolds.splice(index, 1)[0] as { reservationId: string; positionId: string };
      await authority.consumeHold(chosen.reservationId);
    } else if (roll < 70 && liveHolds.length > 0) {
      const index = random() % liveHolds.length;
      const chosen = liveHolds.splice(index, 1)[0] as { reservationId: string; positionId: string };
      await authority.releaseHold(chosen.reservationId);
    } else if (roll < 80) {
      wall += 30_000;
      await authority.expireDueHolds();
      for (const expired of liveHolds.splice(0)) {
        const reservation = ledger.reservation(expired.reservationId);
        if (reservation?.state === 'HELD') {
          liveHolds.push(expired);
        }
      }
    } else if (roll < 85) {
      await authority.recordConfirmedFunding({
        poolId: `pool-${seed}`,
        source: { kind: 'INTERNAL_TRANSFER', referenceId: `transfer-${seed}-x-${step}` },
        amount: AMOUNT(100 * (1 + (random() % 3))),
      });
    } else {
      // A no-op probe (keeps the sequence balanced).
      authority.pool(`pool-${seed}`);
    }
    commandCount += 1;
    check();
  }

  const pool = authority.pool(`pool-${seed}`);
  const positions = authority.positionsOf(`pool-${seed}`);
  return {
    finalTotal: pool?.totalMinor ?? -1,
    positionStates: positions.map((position) => position.state),
    poolIdentity: authority.poolInvariant(`pool-${seed}`),
    positionIdentities: positions.map((position) =>
      positionInvariantHolds({
        state: position.state,
        total: position.total,
        available: position.available,
        reserved: position.reserved,
        consumed: position.consumed,
      }),
    ),
    entryCount: positions.length,
  };
}

describe('INV-6-1 property tests (the identity holds after every transition)', () => {
  test('randomized command sequences hold the identity at every step (20 seeds)', async () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const outcome = await runScenario(seed);
      expect(outcome.poolIdentity).toBe(true);
      expect(outcome.positionIdentities.every(Boolean)).toBe(true);
      expect(outcome.finalTotal).toBeGreaterThan(0);
      expect(outcome.entryCount).toBeGreaterThan(0);
    }
  });

  test('identical seeds yield identical scenarios (determinism, GC-1)', async () => {
    const first = await runScenario(4242);
    const second = await runScenario(4242);
    expect(second.finalTotal).toBe(first.finalTotal);
    expect(second.positionStates).toEqual(first.positionStates);
    expect(second.entryCount).toBe(first.entryCount);
  });
});
