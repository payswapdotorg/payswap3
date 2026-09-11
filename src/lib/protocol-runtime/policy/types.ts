/**
 * RTN-005 — Fulfillment Policy Authority: the A02 type vocabulary, state
 * machine tables, and runtime guards.
 *
 * Spec sources (binding) — spec/architecture/v0.1/core.md §2 Area 2:
 *   lines 91-93 (purpose):
 *     "Define how an authorized intent selects its fulfillment shape:
 *      allowed rails, ordering, cost ceilings, deadlines, and fallback
 *      preferences. Policies are evaluated deterministically; they never
 *      move money."
 *   lines 97-100 (FulfillmentPolicy — the object and lifecycle, verbatim):
 *     "FulfillmentPolicy — versioned, immutable policy document attached to
 *      an intent at authorization time.
 *      Lifecycle: AUTHORED -> VERSIONED -> ATTACHED. No further state
 *      changes; a policy attached to an intent is fixed for that intent."
 *   lines 102-107 (PolicyEvaluation):
 *     "PolicyEvaluation — deterministic result of evaluating a policy
 *      against an intent and a capability snapshot.
 *      States: EVALUATED -> CONSUMED.
 *      Contents: ranked route requirements, constraint envelope, cost
 *      ceiling, deadline."
 *   lines 115-123 (INV-2-1/INV-2-2/INV-2-3, quoted in the enforcing
 *   modules).
 *   lines 127-130 (failure semantics):
 *     "Evaluation is internal and deterministic; failures are reason-coded
 *      (POLICY_UNSATISFIABLE) and route the intent to FAILED. No UNKNOWN
 *      state exists in this area. Recovery: attach a new policy version to
 *      a new intent."
 *   lines 134-135 (evidence produced — POLICY_ATTACHED / POLICY_EVALUATED).
 *   lines 139-142 (boundaries: "Policies do not create reservations,
 *   obligations, or rail operations"; "Depends on area 3 for the
 *   capability snapshot format").
 *   spec/architecture/v0.1/README.md §3 GC-1/GC-4/GC-5.
 *   spec/registry/protocol-registry.json A02 — owningAuthority:
 *   "Fulfillment Policy Authority".
 */

import type { Money } from '../kernel/money.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type { CapabilitySnapshot } from '../capability/types.ts';

/**
 * The FulfillmentPolicy state vocabulary, verbatim from v0.1.
 *
 * Source: core.md lines 98-99 — "Lifecycle: AUTHORED -> VERSIONED ->
 * ATTACHED."
 */
export const POLICY_STATES: readonly ['AUTHORED', 'VERSIONED', 'ATTACHED'] = Object.freeze([
  'AUTHORED',
  'VERSIONED',
  'ATTACHED',
] as const);

/**
 * A FulfillmentPolicy state. ATTACHED is terminal for the policy object
 * ("No further state changes; a policy attached to an intent is fixed for
 * that intent", core.md lines 99-100).
 *
 * Source: core.md lines 98-100.
 */
export type PolicyState = (typeof POLICY_STATES)[number];

/**
 * The frozen FulfillmentPolicy transition table: the exact lifecycle, no
 * shortcuts and no exits from ATTACHED.
 *
 * Source: core.md lines 98-100 — "AUTHORED -> VERSIONED -> ATTACHED. No
 * further state changes".
 */
export const POLICY_TRANSITIONS: Readonly<Record<PolicyState, readonly PolicyState[]>> =
  Object.freeze({
    AUTHORED: Object.freeze(['VERSIONED'] as const),
    VERSIONED: Object.freeze(['ATTACHED'] as const),
    ATTACHED: Object.freeze([] as const),
  });

/**
 * Runtime type guard for PolicyState.
 *
 * Source: core.md lines 98-99 (the vocabulary this guard re-checks).
 */
export function isPolicyState(value: unknown): value is PolicyState {
  return typeof value === 'string' && (POLICY_STATES as readonly string[]).includes(value);
}

/**
 * True iff the (from, to) pair is a legal FulfillmentPolicy transition.
 *
 * Source: core.md lines 98-100 (the lifecycle).
 */
export function canTransitionPolicy(from: PolicyState, to: PolicyState): boolean {
  return POLICY_TRANSITIONS[from].includes(to);
}

/**
 * The PolicyEvaluation state vocabulary, verbatim from v0.1.
 *
 * Source: core.md lines 104-105 — "States: EVALUATED -> CONSUMED."
 */
export const POLICY_EVALUATION_STATES: readonly ['EVALUATED', 'CONSUMED'] = Object.freeze([
  'EVALUATED',
  'CONSUMED',
] as const);

/**
 * A PolicyEvaluation state. CONSUMED is terminal (the machine has no
 * further state).
 *
 * Source: core.md lines 104-105.
 */
export type PolicyEvaluationState = (typeof POLICY_EVALUATION_STATES)[number];

/**
 * The frozen PolicyEvaluation transition table — the exact machine.
 *
 * Source: core.md lines 104-105.
 */
export const POLICY_EVALUATION_TRANSITIONS: Readonly<
  Record<PolicyEvaluationState, readonly PolicyEvaluationState[]>
> = Object.freeze({
  EVALUATED: Object.freeze(['CONSUMED'] as const),
  CONSUMED: Object.freeze([] as const),
});

/**
 * Runtime type guard for PolicyEvaluationState.
 *
 * Source: core.md lines 104-105 (the vocabulary this guard re-checks).
 */
export function isPolicyEvaluationState(value: unknown): value is PolicyEvaluationState {
  return typeof value === 'string' && (POLICY_EVALUATION_STATES as readonly string[]).includes(value);
}

/**
 * True iff the (from, to) pair is a legal PolicyEvaluation transition.
 *
 * Source: core.md lines 104-105 (the machine).
 */
export function canTransitionPolicyEvaluation(
  from: PolicyEvaluationState,
  to: PolicyEvaluationState,
): boolean {
  return POLICY_EVALUATION_TRANSITIONS[from].includes(to);
}

/**
 * The policy's ordering directive — how the evaluation ranks route
 * requirements. Two members, each a fully deterministic total order (final
 * tie-break is always the capability id, so no two distinct capabilities
 * can swap ranks):
 *   - COST_ASC — cost schedule ascending, then capability id ascending;
 *   - TIER_DESC — tier descending (code-point order), then cost ascending,
 *     then capability id ascending.
 *
 * Source: core.md lines 91-93 — "Define how an authorized intent selects
 * its fulfillment shape: allowed rails, ordering, cost ceilings, deadlines,
 * and fallback preferences"; line 105 — "ranked route requirements" (the
 * ranking must be deterministic: INV-2-1).
 */
export const POLICY_ORDERINGS: readonly ['COST_ASC', 'TIER_DESC'] = Object.freeze([
  'COST_ASC',
  'TIER_DESC',
] as const);

/**
 * A policy ordering directive. Source: core.md lines 91-93 ("ordering");
 * INV-2-1 (lines 115-117 — the evaluation is a pure function, so the
 * ordering must be a deterministic rule).
 */
export type PolicyOrdering = (typeof POLICY_ORDERINGS)[number];

/**
 * Runtime type guard for PolicyOrdering.
 *
 * Source: core.md lines 91-93 + INV-2-1.
 */
export function isPolicyOrdering(value: unknown): value is PolicyOrdering {
  return typeof value === 'string' && (POLICY_ORDERINGS as readonly string[]).includes(value);
}

/**
 * The A02 reason-code vocabulary — exactly the one named code in the area
 * ("failures are reason-coded (POLICY_UNSATISFIABLE)", core.md lines
 * 127-128).
 *
 * Source: core.md lines 127-128.
 */
export const POLICY_REASON_CODES: readonly ['POLICY_UNSATISFIABLE'] = Object.freeze([
  'POLICY_UNSATISFIABLE',
] as const);

/**
 * An A02 reason code. Source: core.md lines 127-128.
 */
export type PolicyReasonCode = (typeof POLICY_REASON_CODES)[number];

/**
 * Runtime type guard for PolicyReasonCode.
 *
 * Source: core.md lines 127-128 (the named reason code).
 */
export function isPolicyReasonCode(value: unknown): value is PolicyReasonCode {
  return typeof value === 'string' && (POLICY_REASON_CODES as readonly string[]).includes(value);
}

/**
 * The FulfillmentPolicy definition — the versioned, immutable policy
 * document, with exactly the fields the purpose section names: allowed
 * rails, ordering, cost ceilings, deadlines, and fallback preferences.
 *
 * Source: core.md lines 91-93 (the field list), 97-99 ("versioned,
 * immutable policy document").
 */
export interface FulfillmentPolicyDefinition {
  /** Allowed rails, ascending-sorted, duplicate-free. */
  readonly allowedRails: readonly string[];
  /** The deterministic ranking directive for route requirements. */
  readonly ordering: PolicyOrdering;
  /** Cost ceiling as a kernel Money value (integer minor units — INV-2-1). */
  readonly costCeiling: Money;
  /** The policy's deadline as integer epoch milliseconds. */
  readonly deadlineEpochMs: number;
  /** Fallback preferences: the ordered rail ids to prefer on fallback. */
  readonly fallbackPreference: readonly string[];
}

/**
 * FulfillmentPolicy — the policy record: the definition plus its lifecycle
 * state and, once attached, the intent it is fixed to and the snapshot id
 * the attachment was recorded against.
 *
 * Attachment is 1:1 — a policy attached to an intent is fixed for that
 * intent, and an intent carries at most one attached policy (core.md lines
 * 98-100; interpretation recorded in CONTRACT-REVIEW.md).
 *
 * Source: core.md lines 97-100.
 */
export interface FulfillmentPolicyRecord {
  readonly policyId: string;
  /** 0 for the AUTHORED draft (version assigned at VERSIONED — the risk-rule precedent). */
  readonly version: number;
  readonly state: PolicyState;
  readonly definition: FulfillmentPolicyDefinition;
  /** Set at ATTACHED: the intent this policy is fixed to. */
  readonly attachedIntentId?: string;
  /** Set at ATTACHED: the snapshot id the attachment was recorded against (POLICY_ATTACHED). */
  readonly attachedSnapshotId?: string;
  readonly createdAt: ProtocolTime;
  readonly stateChangedAt: ProtocolTime;
}

/**
 * The intent terms the evaluation consumes — the DemandDescriptor's
 * demand-side inputs, passed as values (the pure function takes no
 * dependency on the intent authority). Exactly the fields the evaluation
 * needs: the amount (Money), the corridor endpoints, and the demand
 * constraints (deadline, allowed rails, cost ceiling).
 *
 * Source: core.md lines 102-103 ("evaluating a policy against an intent
 * and a capability snapshot"); lines 39-41 (the demand's terms — area 1's
 * descriptor fields the evaluation reads).
 */
export interface IntentTerms {
  readonly amount: Money;
  readonly sourceCurrency: string;
  readonly destinationCurrency: string;
  readonly sourceGeography: string;
  readonly destinationGeography: string;
  readonly deadlineEpochMs: number;
  readonly allowedRails: readonly string[];
  readonly costCeiling: Money;
}

/**
 * One ranked route requirement — the ranked candidate the evaluation
 * produced: the capability id (the routing authority's reference), its
 * rail, its corridor, its cost schedule, and its tier.
 *
 * Source: core.md lines 105-106 — "Contents: ranked route requirements,
 * constraint envelope, cost ceiling, deadline."
 */
export interface RouteRequirement {
  readonly capabilityId: string;
  readonly railId: string;
  readonly sourceCurrency: string;
  readonly destinationCurrency: string;
  readonly costSchedule: Money;
  readonly tier: string;
}

/**
 * The constraint envelope — the merged constraints the evaluation hands to
 * routing: the intersection of the policy's and the intent's allowed rails,
 * the policy's ordering, and the fallback preferences.
 *
 * Source: core.md lines 105-106 ("constraint envelope"); lines 91-93 (the
 * constraint fields a policy carries).
 */
export interface ConstraintEnvelope {
  readonly allowedRails: readonly string[];
  readonly ordering: PolicyOrdering;
  readonly fallbackPreference: readonly string[];
}

/**
 * The satisfiable evaluation result — the PolicyEvaluation's contents,
 * verbatim from the spec: ranked route requirements, constraint envelope,
 * cost ceiling (Money — INV-2-1 integer comparisons), and deadline.
 *
 * Source: core.md lines 105-106.
 */
export interface PolicyEvaluationResult {
  readonly rankedRouteRequirements: readonly RouteRequirement[];
  readonly constraintEnvelope: ConstraintEnvelope;
  readonly costCeiling: Money;
  readonly deadlineEpochMs: number;
}

/**
 * The pure evaluation's outcome: the satisfiable result, or the
 * reason-coded failure (POLICY_UNSATISFIABLE) that "route[s] the intent to
 * FAILED" (core.md lines 127-128).
 *
 * Source: core.md lines 102-107, 127-128.
 */
export type PolicyEvaluationOutcome =
  | { readonly satisfiable: true; readonly result: PolicyEvaluationResult }
  | { readonly satisfiable: false; readonly reasonCode: PolicyReasonCode };

/**
 * PolicyEvaluation — the recorded evaluation: the derived id (one per
 * (intent, policy version, snapshot id) — INV-2-3), the recorded basis,
 * the state machine (EVALUATED -> CONSUMED), and the result hash
 * (POLICY_EVALUATED's named proof material).
 *
 * Source: core.md lines 102-107; INV-2-2 lines 118-120 ("the capability
 * snapshot id used for evaluation is recorded"); INV-2-3 lines 121-123;
 * line 135 ("POLICY_EVALUATED (outcome: evaluation id and result hash)").
 */
export interface PolicyEvaluationRecord {
  /** deriveProtocolId('policy-evaluation', intentId, policyId, version, snapshotId). */
  readonly evaluationId: string;
  readonly intentId: string;
  readonly policyId: string;
  readonly policyVersion: number;
  /** The recorded snapshot id — INV-2-2. */
  readonly snapshotId: string;
  readonly state: PolicyEvaluationState;
  readonly outcome: PolicyEvaluationOutcome;
  /** sha256 over the canonical result encoding — "result hash" (line 135). */
  readonly resultHash: string;
  readonly evaluatedAt: ProtocolTime;
  readonly stateChangedAt: ProtocolTime;
}

/**
 * The typed rejection codes of the Policy Authority's command surface
 * (domain rejections are typed values, never thrown — the merged rails
 * command convention). Rejections emit NO evidence: a refused command
 * mutates no state, and A02's named evidence set is exhaustive.
 *
 * Source: core.md lines 134-135 (the exhaustive named set); the rails
 * typed-rejection convention.
 */
export const POLICY_REJECTION_CODES: readonly [
  'POLICY_NOT_FOUND',
  'ILLEGAL_TRANSITION',
  'ALREADY_ATTACHED',
  'INTENT_ALREADY_HAS_POLICY',
  'EVALUATION_NOT_FOUND',
] = Object.freeze([
  'POLICY_NOT_FOUND',
  'ILLEGAL_TRANSITION',
  'ALREADY_ATTACHED',
  'INTENT_ALREADY_HAS_POLICY',
  'EVALUATION_NOT_FOUND',
] as const);

/** A Policy Authority rejection code. Source: the frozen list above. */
export type PolicyRejectionCode = (typeof POLICY_REJECTION_CODES)[number];

/**
 * The outcome of a policy command: the updated record on success; a typed
 * rejection code with a deterministic problem description on refusal.
 *
 * Source: core.md lines 97-107 (the state machines the commands drive);
 * INV-2-2/INV-2-3 (the invariants the guards enforce).
 */
export type PolicyCommandResult<T> =
  | {
      readonly ok: true;
      readonly record: T;
    }
  | {
      readonly ok: false;
      readonly code: PolicyRejectionCode;
      readonly problem: string;
    };

/**
 * The snapshot reference the pure evaluation consumes — the A03
 * CapabilitySnapshot format (type-only dependency: "Depends on area 3 for
 * the capability snapshot format", core.md lines 141-142).
 *
 * Source: core.md lines 141-142; capability/types.ts CapabilitySnapshot.
 */
export type PolicySnapshotInput = CapabilitySnapshot;
