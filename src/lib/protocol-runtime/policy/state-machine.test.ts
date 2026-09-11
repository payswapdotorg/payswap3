/**
 * RTN-005 — A02 state-machine conformance tests: the frozen
 * FulfillmentPolicy and PolicyEvaluation transition tables (legal + illegal
 * transitions).
 *
 * Source of the tested contract — spec/architecture/v0.1/core.md §2:
 *   lines 98-100: "Lifecycle: AUTHORED -> VERSIONED -> ATTACHED. No further
 *    state changes; a policy attached to an intent is fixed for that
 *    intent."
 *   lines 104-105: "States: EVALUATED -> CONSUMED."
 * Work order acceptance: "All three state machines exact; one-way
 * transitions enforced."
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';
import {
  POLICY_STATES,
  POLICY_TRANSITIONS,
  POLICY_EVALUATION_STATES,
  POLICY_EVALUATION_TRANSITIONS,
  POLICY_ORDERINGS,
  POLICY_REASON_CODES,
  isPolicyState,
  isPolicyEvaluationState,
  isPolicyOrdering,
  isPolicyReasonCode,
  canTransitionPolicy,
  canTransitionPolicyEvaluation,
} from './types.ts';
import type { FulfillmentPolicyRecord, PolicyEvaluationRecord, PolicyState } from './types.ts';
import { transitionFulfillmentPolicy, transitionPolicyEvaluation } from './state-machine.ts';

const WHEN = protocolTime(0, 1_000);
const LATER = protocolTime(1, 2_000);

const DEFINITION = {
  allowedRails: ['rail-a'],
  ordering: 'COST_ASC' as const,
  costCeiling: money('USD', 500, 2),
  deadlineEpochMs: 60_000,
  fallbackPreference: [],
};

const POLICY: FulfillmentPolicyRecord = {
  policyId: 'policy-1',
  version: 1,
  state: 'VERSIONED',
  definition: DEFINITION,
  createdAt: WHEN,
  stateChangedAt: WHEN,
};

const EVALUATION: PolicyEvaluationRecord = {
  evaluationId: 'pid.v1.eval',
  intentId: 'pid.v1.intent',
  policyId: 'policy-1',
  policyVersion: 1,
  snapshotId: 'pid.v1.snapshot',
  state: 'EVALUATED',
  outcome: { satisfiable: true, result: {
    rankedRouteRequirements: [],
    constraintEnvelope: { allowedRails: ['rail-a'], ordering: 'COST_ASC', fallbackPreference: [] },
    costCeiling: money('USD', 500, 2),
    deadlineEpochMs: 60_000,
  } },
  resultHash: 'peh.v1.test',
  evaluatedAt: WHEN,
  stateChangedAt: WHEN,
};

describe('A02 FulfillmentPolicy — frozen lifecycle table exact', () => {
  test('exactly AUTHORED→VERSIONED→ATTACHED; ATTACHED has no exits ("No further state changes")', () => {
    expect(POLICY_TRANSITIONS['AUTHORED']).toEqual(['VERSIONED']);
    expect(POLICY_TRANSITIONS['VERSIONED']).toEqual(['ATTACHED']);
    expect(POLICY_TRANSITIONS['ATTACHED']).toEqual([]);
    expect([...POLICY_STATES]).toEqual(['AUTHORED', 'VERSIONED', 'ATTACHED']);
    expect(Object.isFrozen(POLICY_TRANSITIONS)).toBe(true);
    expect(isPolicyState('ATTACHED')).toBe(true);
    expect(isPolicyState('PUBLISHED')).toBe(false);
  });

  test('every illegal lifecycle pair is rejected — the full battery', () => {
    const states = [...POLICY_STATES] as readonly PolicyState[];
    let illegal = 0;
    for (const from of states) {
      for (const to of states) {
        if (canTransitionPolicy(from, to)) {
          continue;
        }
        illegal += 1;
        const result = transitionFulfillmentPolicy({ ...POLICY, state: from }, to, LATER);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe('ILLEGAL_TRANSITION');
        }
      }
    }
    // 3x3 = 9 pairs minus 2 legal = 7 illegal pairs, all rejected.
    expect(illegal).toBe(7);
  });

  test('ATTACHED records the intent id and the snapshot id (the POLICY_ATTACHED data)', () => {
    const result = transitionFulfillmentPolicy(POLICY, 'ATTACHED', LATER, {
      intentId: 'pid.v1.intent',
      snapshotId: 'pid.v1.snapshot',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.state).toBe('ATTACHED');
      expect(result.record.attachedIntentId).toBe('pid.v1.intent');
      expect(result.record.attachedSnapshotId).toBe('pid.v1.snapshot');
    }
  });

  test('ATTACHED without the intent id or the snapshot id is refused (TypeError)', () => {
    expect(() => transitionFulfillmentPolicy(POLICY, 'ATTACHED', LATER, {})).toThrow(/intent id/);
    expect(() =>
      transitionFulfillmentPolicy(POLICY, 'ATTACHED', LATER, { intentId: 'pid.v1.intent' }),
    ).toThrow(/snapshot id/);
  });
});

describe('A02 PolicyEvaluation — frozen machine exact', () => {
  test('exactly EVALUATED→CONSUMED; CONSUMED has no exits', () => {
    expect(POLICY_EVALUATION_TRANSITIONS['EVALUATED']).toEqual(['CONSUMED']);
    expect(POLICY_EVALUATION_TRANSITIONS['CONSUMED']).toEqual([]);
    expect([...POLICY_EVALUATION_STATES]).toEqual(['EVALUATED', 'CONSUMED']);
    expect(isPolicyEvaluationState('CONSUMED')).toBe(true);
    expect(isPolicyEvaluationState('EVALUATING')).toBe(false);
  });

  test('every illegal evaluation pair is rejected — the full battery', () => {
    expect(transitionPolicyEvaluation(EVALUATION, 'EVALUATED', LATER).ok).toBe(false);
    const consumed = transitionPolicyEvaluation(EVALUATION, 'CONSUMED', LATER);
    expect(consumed.ok).toBe(true);
    if (consumed.ok) {
      expect(transitionPolicyEvaluation(consumed.record, 'EVALUATED', LATER).ok).toBe(false);
      expect(transitionPolicyEvaluation(consumed.record, 'CONSUMED', LATER).ok).toBe(false);
    }
  });
});

describe('A02 vocabularies — frozen and closed', () => {
  test('the ordering vocabulary is exactly the two deterministic directives', () => {
    expect([...POLICY_ORDERINGS]).toEqual(['COST_ASC', 'TIER_DESC']);
    expect(isPolicyOrdering('COST_ASC')).toBe(true);
    expect(isPolicyOrdering('FASTEST')).toBe(false);
    expect(Object.isFrozen(POLICY_ORDERINGS)).toBe(true);
  });

  test('the reason-code vocabulary is exactly the one named code', () => {
    expect([...POLICY_REASON_CODES]).toEqual(['POLICY_UNSATISFIABLE']);
    expect(isPolicyReasonCode('POLICY_UNSATISFIABLE')).toBe(true);
    expect(isPolicyReasonCode('POLICY_EXPIRED')).toBe(false);
    expect(Object.isFrozen(POLICY_REASON_CODES)).toBe(true);
  });
});
