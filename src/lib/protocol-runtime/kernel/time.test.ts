/**
 * RTN-001 — protocol time tests.
 *
 * Source of the tested contract: spec/architecture/v0.1/
 * evidence-risk-compliance.md §1 Area 15 line 28 — "when: protocol time
 * (sequenced) and recorded wall time."
 */
import { describe, expect, test } from 'bun:test';
import { protocolTime, isProtocolTime } from './time.ts';

describe('protocol time (conformance)', () => {
  test('pairs a non-negative sequence with an integer wall instant', () => {
    const stamp = protocolTime(0, 0);
    expect(stamp.sequence).toBe(0);
    expect(stamp.wallMs).toBe(0);
    const later = protocolTime(41, 1_700_000_000_000);
    expect(later.sequence).toBe(41);
    expect(later.wallMs).toBe(1_700_000_000_000);
  });

  test('negative wall instants (pre-1970 epochs) are representable', () => {
    const stamp = protocolTime(0, -86_400_000);
    expect(stamp.wallMs).toBe(-86_400_000);
  });

  test('isProtocolTime accepts well-formed values only', () => {
    expect(isProtocolTime(protocolTime(1, 2))).toBe(true);
    expect(isProtocolTime({ sequence: 1, wallMs: 2 })).toBe(true);
    expect(isProtocolTime(null)).toBe(false);
    expect(isProtocolTime({ sequence: 1.5, wallMs: 2 })).toBe(false);
    expect(isProtocolTime({ sequence: -1, wallMs: 2 })).toBe(false);
    expect(isProtocolTime({ sequence: 1 })).toBe(false);
    expect(isProtocolTime({ sequence: 1, wallMs: 2.5 })).toBe(false);
  });
});

describe('protocol time (negative: integer discipline)', () => {
  test('float sequences are rejected', () => {
    expect(() => protocolTime(1.5, 0)).toThrow(/sequence must be an integer/);
    expect(() => protocolTime(Number.NaN, 0)).toThrow(/sequence must be an integer/);
  });

  test('negative sequences are rejected', () => {
    expect(() => protocolTime(-1, 0)).toThrow(/sequence must be non-negative/);
  });

  test('unsafe sequences are rejected', () => {
    expect(() => protocolTime(Number.MAX_SAFE_INTEGER + 1, 0)).toThrow(/safe integer/);
  });

  test('float wall timestamps are rejected', () => {
    expect(() => protocolTime(0, 1_700_000_000_000.5)).toThrow(/wallMs must be an integer/);
    expect(() => protocolTime(0, Number.NaN)).toThrow(/wallMs must be an integer/);
  });

  test('unsafe wall timestamps are rejected', () => {
    expect(() => protocolTime(0, Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe integer/);
  });
});
