/**
 * RTN-001 — shared reason-code vocabulary tests.
 *
 * Source of the tested contract: spec/architecture/v0.1/core.md §0 lines
 * 16-17 and README.md §3 GC-2 lines 45-49. The shared vocabulary is exactly
 * the verbatim set {UNKNOWN}; area-specific codes are owned by their areas'
 * work orders and must not appear here (no inventions).
 */
import { describe, expect, test } from 'bun:test';
import { SHARED_REASON_CODES, isSharedReasonCode } from './reason-codes.ts';

describe('shared reason-code vocabulary (verbatim, no inventions)', () => {
  test('the shared vocabulary is exactly [UNKNOWN]', () => {
    expect([...SHARED_REASON_CODES]).toEqual(['UNKNOWN']);
  });

  test('isSharedReasonCode accepts UNKNOWN only', () => {
    expect(isSharedReasonCode('UNKNOWN')).toBe(true);
    expect(isSharedReasonCode('unknown')).toBe(false);
    expect(isSharedReasonCode('FAILED')).toBe(false);
    expect(isSharedReasonCode('POLICY_UNSATISFIABLE')).toBe(false);
    expect(isSharedReasonCode('NO_VIABLE_ROUTE')).toBe(false);
    expect(isSharedReasonCode('')).toBe(false);
    expect(isSharedReasonCode(null)).toBe(false);
    expect(isSharedReasonCode(0)).toBe(false);
  });

  test('the exported array is frozen at the type level (readonly, one member)', () => {
    expect(Object.isFrozen(SHARED_REASON_CODES)).toBe(true);
    expect(SHARED_REASON_CODES.length).toBe(1);
  });
});
