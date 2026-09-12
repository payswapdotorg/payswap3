/**
 * RTN-006 — Reservation Authority: the pure INV-5-1 resource-accounting
 * tests.
 *
 * Tested contract (spec-cited):
 *   spec/architecture/v0.1/core.md §5 Area 5 lines 304-306:
 *     "INV-5-1 (financial correctness): for every resource, available =
 *      declared total minus held minus consumed, computed in integer
 *      Money; the identity holds after every transition."
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import {
  applyHold,
  applyTransitionArithmetic,
  availableResource,
  canonicalResourceAccounting,
  coversAmount,
  initialResourceAccounting,
  resourceArithmeticIdentityHash,
  resourceInvariantHolds,
} from './resource.ts';

const DECLARED = money('EUR', 1_000_00, 2);

describe('INV-5-1 resource accounting (core.md lines 304-306)', () => {
  test('a fresh resource starts at (declared, 0, 0) with available = declared', () => {
    const accounting = initialResourceAccounting('cap-a', DECLARED);
    expect(accounting.heldTotal.amountMinor).toBe(0);
    expect(accounting.consumedTotal.amountMinor).toBe(0);
    expect(availableResource(accounting).amountMinor).toBe(1_000_00);
    expect(resourceInvariantHolds(accounting)).toBe(true);
  });

  test('available = declared total minus held minus consumed, exactly, after every transition kind', () => {
    let accounting = initialResourceAccounting('cap-a', DECLARED);
    accounting = applyTransitionArithmetic(accounting, 'REQUESTED', 'HELD', money('EUR', 300_00, 2));
    expect(availableResource(accounting).amountMinor).toBe(700_00);
    expect(resourceInvariantHolds(accounting)).toBe(true);
    accounting = applyTransitionArithmetic(accounting, 'HELD', 'CONSUMED', money('EUR', 300_00, 2));
    expect(availableResource(accounting).amountMinor).toBe(700_00);
    expect(accounting.consumedTotal.amountMinor).toBe(300_00);
    expect(resourceInvariantHolds(accounting)).toBe(true);
    accounting = applyTransitionArithmetic(accounting, 'REQUESTED', 'HELD', money('EUR', 200_00, 2));
    expect(availableResource(accounting).amountMinor).toBe(500_00);
    accounting = applyTransitionArithmetic(accounting, 'HELD', 'RELEASED', money('EUR', 200_00, 2));
    expect(availableResource(accounting).amountMinor).toBe(700_00);
    expect(accounting.heldTotal.amountMinor).toBe(0);
    expect(resourceInvariantHolds(accounting)).toBe(true);
    accounting = applyTransitionArithmetic(accounting, 'REQUESTED', 'HELD', money('EUR', 100_00, 2));
    accounting = applyTransitionArithmetic(accounting, 'HELD', 'EXPIRED', money('EUR', 100_00, 2));
    expect(availableResource(accounting).amountMinor).toBe(700_00);
    expect(resourceInvariantHolds(accounting)).toBe(true);
  });

  test('a rejected REQUESTED -> RELEASED resolution holds nothing (no arithmetic)', () => {
    const accounting = initialResourceAccounting('cap-a', DECLARED);
    const unchanged = applyTransitionArithmetic(accounting, 'REQUESTED', 'RELEASED', money('EUR', 500_00, 2));
    expect(unchanged).toBe(accounting);
    expect(resourceInvariantHolds(unchanged)).toBe(true);
  });

  test('applyHold rejects an over-commit (the identity would go negative)', () => {
    const accounting = initialResourceAccounting('cap-a', DECLARED);
    expect(applyHold(accounting, money('EUR', 1_000_00, 2)).ok).toBe(true);
    const over = applyHold(accounting, money('EUR', 1_000_01, 2));
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.problem).toContain('insufficient available');
    }
    expect(coversAmount(accounting, money('EUR', 1_000_00, 2))).toBe(true);
    expect(coversAmount(accounting, money('EUR', 1_000_01, 2))).toBe(false);
  });

  test('an unknown transition rule is a TypeError (the machine is closed)', () => {
    const accounting = initialResourceAccounting('cap-a', DECLARED);
    expect(() => applyTransitionArithmetic(accounting, 'CONSUMED', 'HELD', money('EUR', 1, 2))).toThrow();
    expect(() => applyTransitionArithmetic(accounting, 'RELEASED', 'EXPIRED', money('EUR', 1, 2))).toThrow();
  });

  test('the arithmetic-identity hash is deterministic and state-sensitive', () => {
    const base = initialResourceAccounting('cap-a', DECLARED);
    const held = applyTransitionArithmetic(base, 'REQUESTED', 'HELD', money('EUR', 100_00, 2));
    expect(resourceArithmeticIdentityHash(base)).toBe(resourceArithmeticIdentityHash(base));
    expect(resourceArithmeticIdentityHash(base) === resourceArithmeticIdentityHash(held)).toBe(false);
    expect(resourceArithmeticIdentityHash(held)).toMatch(/^rai\.v1\.[0-9a-f]{64}$/);
    expect(canonicalResourceAccounting(held)).toContain('cap-a');
    expect(canonicalResourceAccounting(held)).toContain('10000');
  });

  test('cross-resource accountings of equal amounts hash differently (the resource id participates)', () => {
    const left = initialResourceAccounting('cap-a', DECLARED);
    const right = initialResourceAccounting('cap-b', DECLARED);
    expect(resourceArithmeticIdentityHash(left) === resourceArithmeticIdentityHash(right)).toBe(false);
  });
});
