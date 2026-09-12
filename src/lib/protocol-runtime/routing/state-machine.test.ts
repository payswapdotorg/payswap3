/**
 * RTN-006 — Routing Authority: RoutePlan state machine tests.
 *
 * Tested contract (spec-cited):
 *   spec/architecture/v0.1/core.md §4 Area 4 lines 224-225:
 *     "States: COMPILED -> VALIDATED -> DISPATCHED ->
 *      terminal(COMPLETED | FAILED | ABANDONED)."
 *   lines 255-259 (the halt rule the table makes structural):
 *     "the plan then halts at DISPATCHED — it never re-dispatches hops
 *      blindly (GC-2)."
 *   lines 263-265 (reason codes on FAILED / ABANDONED).
 */
import { describe, expect, test } from 'bun:test';
import { protocolTime } from '../kernel/time.ts';
import { money } from '../kernel/money.ts';
import {
  ROUTE_PLAN_STATES,
  ROUTE_PLAN_TRANSITIONS,
  ROUTE_PLAN_REASON_CODES,
  canTransitionRoutePlan,
  isRoutePlanReasonCode,
  isRoutePlanState,
} from './types.ts';
import {
  checkRoutePlanReasonCode,
  deadlinePassedAt,
  hasUnresolvedUnknownHop,
  requiresReasonCode,
  transitionRoutePlan,
} from './state-machine.ts';
import type { RoutePlan } from './types.ts';

const WHEN = protocolTime(10, 1_000);
const LATER = protocolTime(11, 2_000);

function plan(state: RoutePlan['state'], overrides: Partial<RoutePlan> = {}): RoutePlan {
  return {
    planId: 'pid.v1.plan',
    intentId: 'pid.v1.intent',
    compilerVersion: 1,
    snapshotId: 'pid.v1.snapshot',
    state,
    hops: [],
    valueLedger: {
      sourceAmount: money('EUR', 100, 2),
      deliveredAmount: money('EUR', 100, 2),
      conversions: [],
      fees: [],
    },
    deadlineEpochMs: 10_000,
    reservationRefs: [],
    unknownHops: [],
    createdAt: WHEN,
    stateChangedAt: WHEN,
    ...overrides,
  };
}

describe('A04 RoutePlan state machine (core.md lines 224-225)', () => {
  test('the state vocabulary is exactly the six v0.1 states', () => {
    expect(ROUTE_PLAN_STATES).toEqual([
      'COMPILED',
      'VALIDATED',
      'DISPATCHED',
      'COMPLETED',
      'FAILED',
      'ABANDONED',
    ]);
  });

  test('the happy-path chain is exactly COMPILED -> VALIDATED -> DISPATCHED -> terminal', () => {
    expect(ROUTE_PLAN_TRANSITIONS['COMPILED']).toEqual(['VALIDATED', 'ABANDONED']);
    expect(ROUTE_PLAN_TRANSITIONS['VALIDATED']).toEqual(['DISPATCHED', 'ABANDONED']);
    expect(ROUTE_PLAN_TRANSITIONS['DISPATCHED']).toEqual(['COMPLETED', 'FAILED', 'ABANDONED']);
    expect(canTransitionRoutePlan('COMPILED', 'VALIDATED')).toBe(true);
    expect(canTransitionRoutePlan('VALIDATED', 'DISPATCHED')).toBe(true);
    expect(canTransitionRoutePlan('DISPATCHED', 'COMPLETED')).toBe(true);
    expect(canTransitionRoutePlan('DISPATCHED', 'FAILED')).toBe(true);
  });

  test('every terminal has an empty successor set (one-way, no restart)', () => {
    for (const terminal of ['COMPLETED', 'FAILED', 'ABANDONED'] as const) {
      expect(ROUTE_PLAN_TRANSITIONS[terminal]).toEqual([]);
      expect(canTransitionRoutePlan(terminal, 'COMPILED')).toBe(false);
      expect(canTransitionRoutePlan(terminal, 'VALIDATED')).toBe(false);
      expect(canTransitionRoutePlan(terminal, 'DISPATCHED')).toBe(false);
    }
  });

  test('a dispatched plan is never re-dispatched (GC-2, core.md lines 255-259)', () => {
    expect(canTransitionRoutePlan('DISPATCHED', 'DISPATCHED')).toBe(false);
    const result = transitionRoutePlan(plan('DISPATCHED'), 'DISPATCHED', LATER);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ILLEGAL_TRANSITION');
      expect(result.problem).toContain('never re-dispatched');
    }
  });

  test('pre-dispatch skips are illegal (COMPILED -> DISPATCHED)', () => {
    expect(canTransitionRoutePlan('COMPILED', 'DISPATCHED')).toBe(false);
    expect(canTransitionRoutePlan('COMPILED', 'COMPLETED')).toBe(false);
  });

  test('a transition preserves identity, hops, and the value ledger', () => {
    const source = plan('COMPILED');
    const result = transitionRoutePlan(source, 'VALIDATED', LATER);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.planId).toBe(source.planId);
      expect(result.plan.intentId).toBe(source.intentId);
      expect(result.plan.compilerVersion).toBe(source.compilerVersion);
      expect(result.plan.snapshotId).toBe(source.snapshotId);
      expect(result.plan.hops).toBe(source.hops);
      expect(result.plan.valueLedger).toBe(source.valueLedger);
      expect(result.plan.state).toBe('VALIDATED');
      expect(result.plan.stateChangedAt).toBe(LATER);
    }
  });

  test('dispatch attaches the acquired reservation references (INV-4-2)', () => {
    const result = transitionRoutePlan(plan('VALIDATED'), 'DISPATCHED', LATER, {
      reservationRefs: [{ hopId: 'pid.v1.hop0', reservationId: 'pid.v1.res0' }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.reservationRefs).toEqual([
        { hopId: 'pid.v1.hop0', reservationId: 'pid.v1.res0' },
      ]);
    }
  });
});

describe('A04 reason codes (core.md lines 253-265)', () => {
  test('the vocabulary is frozen and closed', () => {
    expect(ROUTE_PLAN_REASON_CODES).toEqual([
      'NO_VIABLE_ROUTE',
      'HOP_FAILED',
      'ACQUISITION_FAILED',
      'RESERVATIONS_EXPIRED',
      'SUPERSEDED',
      'PAYER_CANCELLED',
    ]);
    expect(isRoutePlanReasonCode('NO_VIABLE_ROUTE')).toBe(true);
    expect(isRoutePlanReasonCode('SOMETHING_ELSE')).toBe(false);
    expect(isRoutePlanState('DISPATCHED')).toBe(true);
    expect(isRoutePlanState('PENDING')).toBe(false);
  });

  test('FAILED and ABANDONED require a reason code; happy paths carry none', () => {
    expect(requiresReasonCode('FAILED')).toBe(true);
    expect(requiresReasonCode('ABANDONED')).toBe(true);
    expect(requiresReasonCode('VALIDATED')).toBe(false);
    expect(requiresReasonCode('DISPATCHED')).toBe(false);
    expect(requiresReasonCode('COMPLETED')).toBe(false);
    expect(checkRoutePlanReasonCode('FAILED', undefined).ok).toBe(false);
    expect(checkRoutePlanReasonCode('FAILED', 'HOP_FAILED').ok).toBe(true);
    expect(checkRoutePlanReasonCode('VALIDATED', 'HOP_FAILED').ok).toBe(false);
  });
});

describe('A04 UNKNOWN-hop halt guard (core.md lines 255-259, GC-2)', () => {
  test('an unresolved annotation blocks; a resolved one does not', () => {
    const halted = plan('DISPATCHED', {
      unknownHops: [
        {
          hopId: 'pid.v1.hop0',
          railOperationId: 'railop-1',
          haltedAt: WHEN,
        },
      ],
    });
    expect(hasUnresolvedUnknownHop(halted)).toBe(true);
    const resolved = plan('DISPATCHED', {
      unknownHops: [
        {
          hopId: 'pid.v1.hop0',
          railOperationId: 'railop-1',
          haltedAt: WHEN,
          resolvedAt: LATER,
          resolvedOutcome: 'CONFIRMED',
        },
      ],
    });
    expect(hasUnresolvedUnknownHop(resolved)).toBe(false);
  });

  test('the deadline predicate is the integer wall-time comparison', () => {
    const p = plan('DISPATCHED');
    expect(deadlinePassedAt(p, protocolTime(1, 9_999))).toBe(false);
    expect(deadlinePassedAt(p, protocolTime(1, 10_000))).toBe(true);
    expect(deadlinePassedAt(p, protocolTime(1, 10_001))).toBe(true);
  });
});
