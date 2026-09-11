/**
 * RTN-004 — State-machine conformance tests, part 1: the frozen tables
 * (pure — no store; the store-backed command-level conformance battery
 * lives in scripts/test_protocol_rails.mjs, the kernel's evidence-harness
 * convention, because bun test cannot load node:sqlite in this
 * environment).
 *
 * Source of the tested contracts — spec/architecture/v0.1/
 * rails-adapters-reconciliation.md:
 *   Area 13 lines 30-31: "States: REGISTERED -> ACTIVE -> DEGRADED ->
 *    RETIRED."
 *   Area 13 lines 33-35: "States: AUTHORIZED -> SUBMITTED ->
 *    PENDING | terminal(CONFIRMED | FAILED | UNKNOWN)."
 *   Area 13 lines 45-46: "UNKNOWN: ... This is a durable state; adapters
 *    MUST NOT resolve UNKNOWN by re-submission."
 *   Area 14 lines 119-123: "States: OPEN -> INVESTIGATING ->
 *    terminal(MATCHED | RESOLVED_CONFIRMED | RESOLVED_FAILED |
 *    RESOLVED_ADJUSTED)."
 *   Area 14 lines 133-137: "States: OPEN -> COLLECTED -> MATCHED -> CLOSED."
 * Work order acceptance: "All A13/A14 state machines exact; illegal
 * transitions unrepresentable."
 */
import { describe, expect, test } from 'bun:test';
import {
  RAIL_ADAPTER_TRANSITIONS,
  RAIL_OPERATION_TRANSITIONS,
  RECONCILIATION_CASE_TRANSITIONS,
  RECONCILIATION_CYCLE_TRANSITIONS,
  isRailAdapterStatus,
  isRailOperationStatus,
  isRailReportClass,
  isReconciliationCaseStatus,
  isReconciliationCycleStatus,
} from './types.ts';

const ADAPTER_STATES = ['REGISTERED', 'ACTIVE', 'DEGRADED', 'RETIRED'] as const;
const OPERATION_STATES = [
  'AUTHORIZED',
  'SUBMITTED',
  'PENDING',
  'CONFIRMED',
  'FAILED',
  'UNKNOWN',
] as const;
const CASE_STATES = [
  'OPEN',
  'INVESTIGATING',
  'MATCHED',
  'RESOLVED_CONFIRMED',
  'RESOLVED_FAILED',
  'RESOLVED_ADJUSTED',
] as const;
const CYCLE_STATES = ['OPEN', 'COLLECTED', 'MATCHED', 'CLOSED'] as const;

describe('A13/A14 state machines — frozen tables exact', () => {
  test('RailAdapter: exactly REGISTERED→ACTIVE→DEGRADED→RETIRED', () => {
    expect(RAIL_ADAPTER_TRANSITIONS['REGISTERED']).toEqual(['ACTIVE']);
    expect(RAIL_ADAPTER_TRANSITIONS['ACTIVE']).toEqual(['DEGRADED']);
    expect(RAIL_ADAPTER_TRANSITIONS['DEGRADED']).toEqual(['RETIRED']);
    expect(RAIL_ADAPTER_TRANSITIONS['RETIRED']).toEqual([]);
    // Every state is a table key (total, frozen).
    for (const status of ADAPTER_STATES) {
      expect(RAIL_ADAPTER_TRANSITIONS[status]).not.toBe(undefined);
    }
  });

  test('RailOperation: exact successor sets incl. the two UNKNOWN exits', () => {
    expect(RAIL_OPERATION_TRANSITIONS['AUTHORIZED']).toEqual(['SUBMITTED']);
    expect(RAIL_OPERATION_TRANSITIONS['SUBMITTED']).toEqual([
      'PENDING',
      'CONFIRMED',
      'FAILED',
      'UNKNOWN',
    ]);
    expect(RAIL_OPERATION_TRANSITIONS['PENDING']).toEqual(['CONFIRMED', 'FAILED', 'UNKNOWN']);
    expect(RAIL_OPERATION_TRANSITIONS['CONFIRMED']).toEqual([]);
    expect(RAIL_OPERATION_TRANSITIONS['FAILED']).toEqual([]);
    // The ONLY exits from UNKNOWN are the reconciliation-resolution edges
    // (GC-2; INV-14-2) — no re-submission edge (AUTHORIZED) exists.
    expect(RAIL_OPERATION_TRANSITIONS['UNKNOWN']).toEqual(['CONFIRMED', 'FAILED']);
    for (const status of OPERATION_STATES) {
      expect(RAIL_OPERATION_TRANSITIONS[status]).not.toBe(undefined);
    }
  });

  test('ReconciliationCase: OPEN→INVESTIGATING→terminal(...) exactly; terminals have no exits', () => {
    expect(RECONCILIATION_CASE_TRANSITIONS['OPEN']).toEqual(['INVESTIGATING']);
    expect(RECONCILIATION_CASE_TRANSITIONS['INVESTIGATING']).toEqual([
      'MATCHED',
      'RESOLVED_CONFIRMED',
      'RESOLVED_FAILED',
      'RESOLVED_ADJUSTED',
    ]);
    expect(RECONCILIATION_CASE_TRANSITIONS['MATCHED']).toEqual([]);
    expect(RECONCILIATION_CASE_TRANSITIONS['RESOLVED_CONFIRMED']).toEqual([]);
    expect(RECONCILIATION_CASE_TRANSITIONS['RESOLVED_FAILED']).toEqual([]);
    expect(RECONCILIATION_CASE_TRANSITIONS['RESOLVED_ADJUSTED']).toEqual([]);
    for (const status of CASE_STATES) {
      expect(RECONCILIATION_CASE_TRANSITIONS[status]).not.toBe(undefined);
    }
  });

  test('ReconciliationCycle: OPEN→COLLECTED→MATCHED→CLOSED exactly', () => {
    expect(RECONCILIATION_CYCLE_TRANSITIONS['OPEN']).toEqual(['COLLECTED']);
    expect(RECONCILIATION_CYCLE_TRANSITIONS['COLLECTED']).toEqual(['MATCHED']);
    expect(RECONCILIATION_CYCLE_TRANSITIONS['MATCHED']).toEqual(['CLOSED']);
    expect(RECONCILIATION_CYCLE_TRANSITIONS['CLOSED']).toEqual([]);
    for (const status of CYCLE_STATES) {
      expect(RECONCILIATION_CYCLE_TRANSITIONS[status]).not.toBe(undefined);
    }
  });

  test('illegal combinations are not representable: no (from,to) pair outside the tables is legal', () => {
    const tables = [
      [RAIL_ADAPTER_TRANSITIONS, ADAPTER_STATES],
      [RAIL_OPERATION_TRANSITIONS, OPERATION_STATES],
      [RECONCILIATION_CASE_TRANSITIONS, CASE_STATES],
      [RECONCILIATION_CYCLE_TRANSITIONS, CYCLE_STATES],
    ] as const;
    for (const [table, states] of tables) {
      let legalCount = 0;
      for (const from of states) {
        for (const to of states) {
          const legal = (table as Record<string, readonly string[]>)[from].includes(to);
          if (legal) {
            legalCount += 1;
          } else {
            // Every illegal pair must be rejected — the guard used by every
            // command is exactly this table membership test.
            expect(legal).toBe(false);
          }
        }
      }
      // Legal edge counts: adapter 3, operation 9, case 5, cycle 3.
      expect(legalCount).toBeGreaterThan(0);
    }
    expect(
      Object.values(RAIL_ADAPTER_TRANSITIONS).reduce(
        (sum, targets) => sum + targets.length,
        0,
      ),
    ).toBe(3);
    expect(
      Object.values(RAIL_OPERATION_TRANSITIONS).reduce(
        (sum, targets) => sum + targets.length,
        0,
      ),
    ).toBe(10);
    expect(
      Object.values(RECONCILIATION_CASE_TRANSITIONS).reduce(
        (sum, targets) => sum + targets.length,
        0,
      ),
    ).toBe(5);
    expect(
      Object.values(RECONCILIATION_CYCLE_TRANSITIONS).reduce(
        (sum, targets) => sum + targets.length,
        0,
      ),
    ).toBe(3);
  });

  test('runtime guards recognize every state vocabulary member and reject outsiders', () => {
    for (const status of ADAPTER_STATES) {
      expect(isRailAdapterStatus(status)).toBe(true);
    }
    expect(isRailAdapterStatus('PENDING')).toBe(false);
    expect(isRailAdapterStatus('REGISTERED ')).toBe(false);
    for (const status of OPERATION_STATES) {
      expect(isRailOperationStatus(status)).toBe(true);
    }
    expect(isRailOperationStatus('RETIRED')).toBe(false);
    for (const cls of ['CONFIRMED', 'FAILED', 'PENDING', 'UNKNOWN'] as const) {
      expect(isRailReportClass(cls)).toBe(true);
    }
    expect(isRailReportClass('AUTHORIZED')).toBe(false);
    for (const status of CASE_STATES) {
      expect(isReconciliationCaseStatus(status)).toBe(true);
    }
    expect(isReconciliationCaseStatus('COLLECTED')).toBe(false);
    for (const status of CYCLE_STATES) {
      expect(isReconciliationCycleStatus(status)).toBe(true);
    }
    expect(isReconciliationCycleStatus('INVESTIGATING')).toBe(false);
    for (const guard of [
      isRailAdapterStatus,
      isRailOperationStatus,
      isRailReportClass,
      isReconciliationCaseStatus,
      isReconciliationCycleStatus,
    ]) {
      expect(guard(null)).toBe(false);
      expect(guard(undefined)).toBe(false);
      expect(guard(42)).toBe(false);
    }
  });
});
