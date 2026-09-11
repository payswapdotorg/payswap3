/**
 * RTN-005 — Fulfillment Policy Authority: pure state-machine application
 * over FulfillmentPolicy and PolicyEvaluation records.
 *
 * Spec sources (binding) — spec/architecture/v0.1/core.md §2 Area 2:
 *   lines 98-100 (FulfillmentPolicy lifecycle):
 *     "Lifecycle: AUTHORED -> VERSIONED -> ATTACHED. No further state
 *      changes; a policy attached to an intent is fixed for that intent."
 *   lines 104-105 (PolicyEvaluation machine):
 *     "States: EVALUATED -> CONSUMED."
 *
 * This module is PURE: (record, target) -> updated record | typed
 * rejection; no store, no clock, no evidence port.
 */

import type { ProtocolTime } from '../kernel/time.ts';
import type {
  FulfillmentPolicyRecord,
  PolicyCommandResult,
  PolicyEvaluationRecord,
  PolicyEvaluationState,
  PolicyState,
} from './types.ts';
import { canTransitionPolicy, canTransitionPolicyEvaluation } from './types.ts';

/**
 * Apply one FulfillmentPolicy state transition — pure. Returns the updated
 * record or the typed ILLEGAL_TRANSITION rejection (covers every attempt
 * to leave ATTACHED — "No further state changes" — and every shortcut,
 * e.g. AUTHORED -> ATTACHED).
 *
 * The VERSIONED -> ATTACHED patch records the intent the policy becomes
 * fixed to and the snapshot id the attachment was recorded against
 * (POLICY_ATTACHED's named data).
 *
 * Source: core.md lines 98-100.
 */
export function transitionFulfillmentPolicy(
  policy: FulfillmentPolicyRecord,
  target: PolicyState,
  at: ProtocolTime,
  patch: { readonly intentId?: string; readonly snapshotId?: string } = {},
): PolicyCommandResult<FulfillmentPolicyRecord> {
  if (!canTransitionPolicy(policy.state, target)) {
    return {
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      problem: `policy ${policy.policyId}@v${policy.version}: illegal lifecycle transition ${policy.state} -> ${target} (core.md A02 lines 98-100; no further state changes after ATTACHED)`,
    };
  }
  if (target === 'ATTACHED') {
    if (typeof patch.intentId !== 'string' || patch.intentId.length === 0) {
      throw new TypeError('policy state machine: ATTACHED requires the intent id the policy is fixed to');
    }
    if (typeof patch.snapshotId !== 'string' || patch.snapshotId.length === 0) {
      throw new TypeError('policy state machine: ATTACHED requires the snapshot id of the attachment');
    }
  }
  return {
    ok: true,
    record: {
      ...policy,
      state: target,
      ...(target === 'ATTACHED'
        ? { attachedIntentId: patch.intentId, attachedSnapshotId: patch.snapshotId }
        : {}),
      stateChangedAt: at,
    },
  };
}

/**
 * Apply one PolicyEvaluation state transition — pure: EVALUATED ->
 * CONSUMED, the machine's only edge. CONSUMED has no exits.
 *
 * Source: core.md lines 104-105.
 */
export function transitionPolicyEvaluation(
  evaluation: PolicyEvaluationRecord,
  target: PolicyEvaluationState,
  at: ProtocolTime,
): PolicyCommandResult<PolicyEvaluationRecord> {
  if (!canTransitionPolicyEvaluation(evaluation.state, target)) {
    return {
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      problem: `policy evaluation ${evaluation.evaluationId}: illegal transition ${evaluation.state} -> ${target} (core.md A02 lines 104-105; CONSUMED is the machine's terminal)`,
    };
  }
  return {
    ok: true,
    record: { ...evaluation, state: target, stateChangedAt: at },
  };
}
