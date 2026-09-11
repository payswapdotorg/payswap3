/**
 * RTN-005 — INV-3-1 capacity conservation property tests: the integer
 * identity reserved + consumed <= declared holds after EVERY commitment
 * transition, under seeded pseudo-random operation sequences.
 *
 * Source of the tested contract — spec/architecture/v0.1/core.md §3:
 *   lines 176-178: "INV-3-1 (financial correctness): capacity limits are
 *    integer Money bounds; sum of RESERVED and CONSUMED commitments never
 *    exceeds the capability's declared capacity."
 *   lines 179-181: "INV-3-2 ... capacity accounting is updated atomically
 *    with commitment state."
 *   README.md §3 GC-1 lines 39-43 (integer-only arithmetic; identical
 *    inputs -> identical outputs).
 * Work order acceptance: "Capacity arithmetic invariant holds after every
 * commitment transition (INV-3-1) — property test."
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import {
  applyConsumption,
  applyRelease,
  applyReservation,
  availableCapacity,
  capacityArithmeticProof,
  capacityInvariantHolds,
  initialAccounting,
  isZeroAccounting,
} from './capacity.ts';
import type { CapabilityAccounting } from './capacity.ts';

const DECLARED = money('EUR', 1_000, 2);

/** Deterministic seeded PRNG (a small LCG) — identical seeds, identical runs (GC-1). */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1_103_515_245 * state + 12_345) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe('INV-3-1 — the integer identity and its boundaries', () => {
  test('a fresh accounting starts at zero with the identity holding', () => {
    const accounting = initialAccounting(DECLARED);
    expect(capacityInvariantHolds(accounting)).toBe(true);
    expect(isZeroAccounting(accounting)).toBe(true);
    expect(availableCapacity(accounting).amountMinor).toBe(1_000);
  });

  test('exact fit reserves and consumes hold the identity at every step', () => {
    let accounting: CapabilityAccounting = initialAccounting(DECLARED);
    const first = applyReservation(accounting, money('EUR', 600, 2));
    if (first.ok) {
      accounting = first.accounting;
    }
    expect(capacityInvariantHolds(accounting)).toBe(true);
    const second = applyReservation(accounting, money('EUR', 400, 2));
    if (second.ok) {
      accounting = second.accounting;
    }
    expect(capacityInvariantHolds(accounting)).toBe(true);
    expect(accounting.reserved.amountMinor).toBe(1_000);
    // one over the declared bound is a typed rejection, nothing changes
    const rejected = applyReservation(accounting, money('EUR', 1, 2));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.problem).toContain('INV-3-1');
    }
    // consumption moves 400 from reserved to consumed; the identity holds
    accounting = applyConsumption(accounting, money('EUR', 400, 2));
    expect(accounting.reserved.amountMinor).toBe(600);
    expect(accounting.consumed.amountMinor).toBe(400);
    expect(capacityInvariantHolds(accounting)).toBe(true);
    // release returns the rest
    accounting = applyRelease(accounting, money('EUR', 600, 2));
    expect(accounting.reserved.amountMinor).toBe(0);
    expect(accounting.consumed.amountMinor).toBe(400);
    expect(capacityInvariantHolds(accounting)).toBe(true);
  });

  test('mixed-currency or mixed-scale capacity operations are refused by the kernel Money guards', () => {
    const accounting = initialAccounting(DECLARED);
    expect(() => applyReservation(accounting, money('USD', 100, 2))).toThrow(/same currency/);
    expect(() => applyReservation(accounting, money('EUR', 100, 0))).toThrow(/same decimal scale/);
    expect(() => applyConsumption(accounting, money('EUR', 100, 0))).toThrow();
    expect(() => applyRelease(accounting, money('USD', 100, 2))).toThrow();
  });

  test('the capacity arithmetic proof triple is the identity as integers', () => {
    const accounting: CapabilityAccounting = {
      declared: DECLARED,
      reserved: money('EUR', 300, 2),
      consumed: money('EUR', 200, 2),
    };
    expect(capacityArithmeticProof(accounting)).toEqual([300, 200, 1_000]);
  });
});

describe('INV-3-1 — property test: the identity holds after EVERY transition of seeded random sequences', () => {
  type Operation = 'reserve' | 'consume' | 'release';

  interface SimCommitment {
    amount: number;
    reserved: boolean;
    consumed: boolean;
    released: boolean;
  }

  test('50 seeded random runs x 40 transitions each: invariant checked after every step', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const random = seededRandom(seed);
      let accounting: CapabilityAccounting = initialAccounting(DECLARED);
      const live: SimCommitment[] = [];
      for (let step = 0; step < 40; step += 1) {
        const operationRoll = random();
        if (operationRoll < 0.4 || live.length === 0) {
          // reserve a new commitment with a random amount in [1, 100]
          const amount = 1 + Math.floor(random() * 100);
          const reservation = applyReservation(accounting, money('EUR', amount, 2));
          if (reservation.ok) {
            accounting = reservation.accounting;
            live.push({ amount, reserved: true, consumed: false, released: false });
          } else {
            // the typed rejection leaves the accounting untouched
            expect(capacityInvariantHolds(accounting)).toBe(true);
          }
        } else if (operationRoll < 0.7) {
          // consume a random live reserved commitment
          const candidates = live.filter((c) => c.reserved && !c.consumed && !c.released);
          if (candidates.length > 0) {
            const chosen = candidates[Math.floor(random() * candidates.length)];
            chosen.consumed = true;
            chosen.reserved = false;
            accounting = applyConsumption(accounting, money('EUR', chosen.amount, 2));
          }
        } else {
          // release a random live reserved commitment
          const candidates = live.filter((c) => c.reserved && !c.consumed && !c.released);
          if (candidates.length > 0) {
            const chosen = candidates[Math.floor(random() * candidates.length)];
            chosen.released = true;
            chosen.reserved = false;
            accounting = applyRelease(accounting, money('EUR', chosen.amount, 2));
          }
        }
        // INV-3-1: assert AFTER EVERY transition
        expect(capacityInvariantHolds(accounting)).toBe(true);
        // the accounting identity is integer-only and non-negative
        expect(Number.isInteger(accounting.reserved.amountMinor)).toBe(true);
        expect(Number.isInteger(accounting.consumed.amountMinor)).toBe(true);
        expect(accounting.reserved.amountMinor >= 0).toBe(true);
        expect(accounting.consumed.amountMinor >= 0).toBe(true);
      }
    }
  });

  test('determinism: identical seeds produce identical accounting traces (GC-1)', () => {
    function runSeed(seed: number): number[] {
      const random = seededRandom(seed);
      let accounting = initialAccounting(DECLARED);
      const trace: number[] = [];
      for (let step = 0; step < 60; step += 1) {
        const roll = random();
        if (roll < 0.5) {
          const amount = 1 + Math.floor(random() * 50);
          const reservation = applyReservation(accounting, money('EUR', amount, 2));
          if (reservation.ok) {
            accounting = reservation.accounting;
          }
        } else {
          accounting = applyRelease(accounting, money('EUR', Math.min(10, accounting.reserved.amountMinor), 2));
        }
        trace.push(accounting.reserved.amountMinor + accounting.consumed.amountMinor);
      }
      return trace;
    }
    expect(runSeed(7)).toEqual(runSeed(7));
    expect(runSeed(9)).toEqual(runSeed(9));
  });
});
