/**
 * RTN-005 — Intent Authority: the A01 type vocabulary, state machine tables,
 * and runtime guards.
 *
 * Spec sources (binding) — spec/architecture/v0.1/core.md §1 Area 1:
 *   lines 33-37 (PaymentIntent — the state machine, verbatim):
 *     "PaymentIntent — durable statement of demand.
 *      States: DRAFT -> AUTHORIZED -> ROUTED -> FULFILLING ->
 *      terminal(FULFILLED | FAILED | CANCELLED).
 *      Transitions are one-way; a failed or cancelled intent cannot be
 *      restarted. A retry is a new intent linked to the prior intent id."
 *   lines 39-41 (DemandDescriptor):
 *     "DemandDescriptor — immutable attachment created at DRAFT: amount
 *      (Money), source and destination descriptors, constraints (deadline,
 *      allowed rails, cost ceiling), idempotency key."
 *   lines 43-44 (IntentReceipt):
 *     "IntentReceipt — idempotent response object: intent id, current state,
 *      and recorded outcome for the submitted idempotency key."
 *   lines 54-62 (INV-1-1/INV-1-2/INV-1-3, quoted in the invariant table rows
 *   below and in the modules that enforce them).
 *   lines 67-69 (failure semantics):
 *     "If routing or fulfillment later fails, the intent moves to FAILED
 *      with a machine readable reason code and a link to the failing
 *      evidence record."
 *   line 70 (recovery):
 *     "Recovery: create a new intent referencing the prior intent id."
 *   lines 74-78 (evidence produced — INTENT_CREATED / INTENT_AUTHORIZED /
 *   INTENT_STATE_CHANGED).
 *   lines 82-85 (boundaries: "No rail access; no external effects (GC-3)",
 *   "No mutation of balances, obligations, or reservations").
 *   spec/architecture/v0.1/README.md §3 GC-1/GC-4/GC-5.
 *   spec/registry/protocol-registry.json A01 — owningAuthority:
 *   "Intent Authority".
 *
 * Transition-table interpretation (recorded in CONTRACT-REVIEW.md): the
 * v0.1 chain names the happy path DRAFT -> AUTHORIZED -> ROUTED ->
 * FULFILLING -> terminal(FULFILLED | FAILED | CANCELLED). Two contracts in
 * the SAME area add edges the chain does not spell out, and both are
 * load-bearing:
 *   - core.md lines 67-69 ("If routing or fulfillment later fails, the
 *     intent moves to FAILED") — routing failure happens between
 *     AUTHORIZATION and ROUTED, fulfillment failure between ROUTED and
 *     terminal; so AUTHORIZED and ROUTED each carry a FAILED exit;
 *   - INV-1-1 (lines 54-56, "Any change after authorization requires a new
 *     intent; the old intent moves to CANCELLED") — AUTHORIZED, ROUTED, and
 *     FULFILLING each carry a CANCELLED exit.
 * DRAFT's only exit is AUTHORIZED: no contract in the area cancels or fails
 * a draft. Every terminal has an empty successor set — "a failed or
 * cancelled intent cannot be restarted" is structural.
 */

import type { Money } from '../kernel/money.ts';
import type { ProtocolTime } from '../kernel/time.ts';

/**
 * The PaymentIntent state vocabulary, verbatim from the v0.1 chain.
 *
 * Source: core.md lines 34-35 — "States: DRAFT -> AUTHORIZED -> ROUTED ->
 * FULFILLING -> terminal(FULFILLED | FAILED | CANCELLED)."
 */
export const INTENT_STATES: readonly [
  'DRAFT',
  'AUTHORIZED',
  'ROUTED',
  'FULFILLING',
  'FULFILLED',
  'FAILED',
  'CANCELLED',
] = Object.freeze([
  'DRAFT',
  'AUTHORIZED',
  'ROUTED',
  'FULFILLING',
  'FULFILLED',
  'FAILED',
  'CANCELLED',
] as const);

/**
 * A PaymentIntent state. FULFILLED, FAILED, and CANCELLED are terminal
 * ("Transitions are one-way; a failed or cancelled intent cannot be
 * restarted").
 *
 * Source: core.md lines 34-36.
 */
export type IntentState = (typeof INTENT_STATES)[number];

/**
 * The frozen one-way transition table. Empty successor sets make restarts
 * and post-terminal transitions unrepresentable at the type/runtime guard
 * level.
 *
 * Edges beyond the happy-path chain are each spec-cited: AUTHORIZED/ROUTED
 * -> FAILED (core.md lines 67-69, routing or fulfillment failure);
 * AUTHORIZED/ROUTED/FULFILLING -> CANCELLED (INV-1-1, core.md lines 54-56).
 *
 * Source: core.md lines 34-37, 54-56, 67-69.
 */
export const INTENT_TRANSITIONS: Readonly<Record<IntentState, readonly IntentState[]>> =
  Object.freeze({
    DRAFT: Object.freeze(['AUTHORIZED'] as const),
    AUTHORIZED: Object.freeze(['ROUTED', 'FAILED', 'CANCELLED'] as const),
    ROUTED: Object.freeze(['FULFILLING', 'FAILED', 'CANCELLED'] as const),
    FULFILLING: Object.freeze(['FULFILLED', 'FAILED', 'CANCELLED'] as const),
    FULFILLED: Object.freeze([] as const),
    FAILED: Object.freeze([] as const),
    CANCELLED: Object.freeze([] as const),
  });

/**
 * Runtime type guard: true iff the value is one of the seven intent states.
 *
 * Source: core.md lines 34-36 (the state vocabulary this guard re-checks).
 */
export function isIntentState(value: unknown): value is IntentState {
  return typeof value === 'string' && (INTENT_STATES as readonly string[]).includes(value);
}

/**
 * True iff the (from, to) pair is a legal one-way transition.
 *
 * Source: core.md lines 36-37 — "Transitions are one-way"; the frozen table
 * is the materialization.
 */
export function canTransitionIntent(from: IntentState, to: IntentState): boolean {
  return INTENT_TRANSITIONS[from].includes(to);
}

/**
 * The A01 reason-code vocabulary for the INTENT_STATE_CHANGED evidence
 * records ("one record per transition, with reason code" — core.md line 77)
 * and for FAILED's "machine readable reason code" (lines 67-69).
 *
 * Members (each spec-grounded or minimal for a named flow, recorded in
 * CONTRACT-REVIEW.md):
 *   - POLICY_UNSATISFIABLE — core.md lines 127-128: "failures are
 *     reason-coded (POLICY_UNSATISFIABLE) and route the intent to FAILED."
 *   - NO_VIABLE_ROUTE — core.md lines 253-254 (area 4's terminal routing
 *     failure; the intent's routing-failure exit per area 1 lines 67-69).
 *   - FULFILLMENT_FAILED — area 1 lines 67-69 ("If routing or fulfillment
 *     later fails").
 *   - TERMS_SUPERSEDED — INV-1-1 (lines 54-56): a change after
 *     authorization moves the old intent to CANCELLED for a new intent.
 *   - PAYER_CANCELLED — the plain cancellation path of the CANCELLED
 *     terminal (lines 35-36).
 */
export const INTENT_REASON_CODES: readonly [
  'POLICY_UNSATISFIABLE',
  'NO_VIABLE_ROUTE',
  'FULFILLMENT_FAILED',
  'TERMS_SUPERSEDED',
  'PAYER_CANCELLED',
] = Object.freeze([
  'POLICY_UNSATISFIABLE',
  'NO_VIABLE_ROUTE',
  'FULFILLMENT_FAILED',
  'TERMS_SUPERSEDED',
  'PAYER_CANCELLED',
] as const);

/**
 * An A01 reason code. Source: core.md lines 67-69 ("machine readable reason
 * code"); the frozen vocabulary is the closed set the authority accepts.
 */
export type IntentReasonCode = (typeof INTENT_REASON_CODES)[number];

/**
 * Runtime type guard for IntentReasonCode.
 *
 * Source: core.md lines 67-69 (the reason-code contract this guards).
 */
export function isIntentReasonCode(value: unknown): value is IntentReasonCode {
  return typeof value === 'string' && (INTENT_REASON_CODES as readonly string[]).includes(value);
}

/**
 * One endpoint descriptor: the "source and destination descriptors" of the
 * demand (core.md line 40). Currency and geography are the corridor-matching
 * inputs area 2/3 consume; account is the opaque endpoint reference.
 *
 * Source: core.md line 40 — "source and destination descriptors"; area 3
 * lines 154-155 (corridor "source/destination currencies and geographies").
 */
export interface EndpointDescriptor {
  /** 3-letter currency code of this endpoint's leg. */
  readonly currency: string;
  /** Geography of this endpoint (corridor matching input). */
  readonly geography: string;
  /** Opaque endpoint account reference. */
  readonly account: string;
}

/**
 * The demand constraints, verbatim from the DemandDescriptor contract:
 * "constraints (deadline, allowed rails, cost ceiling)".
 *
 * Source: core.md line 40.
 */
export interface DemandConstraints {
  /** Deadline as integer epoch milliseconds (integer time, GC-1). */
  readonly deadlineEpochMs: number;
  /** Allowed rails, ascending-sorted, duplicate-free. */
  readonly allowedRails: readonly string[];
  /** Cost ceiling as a kernel Money value (integer minor units). */
  readonly costCeiling: Money;
}

/**
 * DemandDescriptor — the immutable attachment created at DRAFT. Field list
 * is exactly the spec's: amount (Money), source and destination
 * descriptors, constraints, idempotency key.
 *
 * Source: core.md lines 39-41.
 */
export interface DemandDescriptor {
  /** "amount (Money)" — kernel Money, integer minor units. */
  readonly amount: Money;
  /** "source ... descriptor". */
  readonly source: EndpointDescriptor;
  /** "destination descriptor[s]". */
  readonly destination: EndpointDescriptor;
  /** "constraints (deadline, allowed rails, cost ceiling)". */
  readonly constraints: DemandConstraints;
  /** "idempotency key" — the submission's dedupe identity (INV-1-2/1-3). */
  readonly idempotencyKey: string;
}

/**
 * PaymentIntent — the durable statement of demand, as recorded by the
 * authority. The descriptor is the immutable DRAFT attachment (no field of
 * this record mutates the descriptor — INV-1-1 makes that unrepresentable:
 * there is no term-mutation command anywhere in this surface).
 *
 * Source: core.md lines 33-37 (object + states); lines 39-41 (descriptor);
 * line 37 (retry linkage — priorIntentId); line 76 (INTENT_AUTHORIZED
 * "proof: policy decision id" — policyDecisionId).
 */
export interface PaymentIntent {
  /** Derived intent id: deriveProtocolId('intent', idempotencyKey). */
  readonly intentId: string;
  /** The submitted idempotency key (part of the descriptor). */
  readonly idempotencyKey: string;
  /** Current state. */
  readonly state: IntentState;
  /** The immutable demand attachment. */
  readonly descriptor: DemandDescriptor;
  /** Canonical hash of the submitted descriptor (INTENT_CREATED proof). */
  readonly descriptorHash: string;
  /** Prior intent id when this intent is a retry (core.md line 37, 70). */
  readonly priorIntentId?: string;
  /** Policy decision id recorded at AUTHORIZATION (core.md line 76). */
  readonly policyDecisionId?: string;
  /** Protocol time of DRAFT creation. */
  readonly createdAt: ProtocolTime;
  /** Protocol time of the last state change. */
  readonly stateChangedAt: ProtocolTime;
}

/**
 * IntentReceipt — the idempotent response object: intent id, state, and the
 * recorded outcome for the submitted idempotency key. The receipt is
 * RECORDED once per key and re-submission returns the recorded receipt
 * verbatim (INV-1-3: "re-submission with a recorded idempotency key returns
 * the recorded receipt"); "current state" (core.md line 43) is the state
 * current at recording.
 *
 * Source: core.md lines 43-44; INV-1-3 lines 60-62.
 */
export interface IntentReceipt {
  readonly intentId: string;
  readonly state: IntentState;
  /** The recorded outcome for the submitted idempotency key ('DRAFT' — the INTENT_CREATED outcome, core.md line 75). */
  readonly outcome: IntentState;
  /** Protocol time the receipt was recorded at. */
  readonly recordedAt: ProtocolTime;
}

/**
 * The typed rejection codes of the Intent Authority's command surface
 * (domain rejections are typed values, never thrown — the merged rails
 * command convention). Rejections emit NO evidence: a refused command
 * mutates no state, and A01's named evidence set is exhaustive.
 *
 * Source: core.md lines 74-78 (the exhaustive named set); the rails
 * typed-rejection convention (src/lib/protocol-runtime/rails/authority.ts).
 */
export const INTENT_REJECTION_CODES: readonly [
  'INTENT_NOT_FOUND',
  'PRIOR_INTENT_NOT_FOUND',
  'ILLEGAL_TRANSITION',
  'COMPLIANCE_BLOCKED',
] = Object.freeze([
  'INTENT_NOT_FOUND',
  'PRIOR_INTENT_NOT_FOUND',
  'ILLEGAL_TRANSITION',
  'COMPLIANCE_BLOCKED',
] as const);

/** An Intent Authority rejection code. Source: the frozen list above. */
export type IntentRejectionCode = (typeof INTENT_REJECTION_CODES)[number];

/**
 * The outcome of a submission command: the receipt plus whether this call
 * replayed a recorded key (INV-1-3) or created the intent.
 *
 * Source: core.md lines 43-44 (receipt); INV-1-2/INV-1-3 (collapse/replay).
 */
export type IntentSubmissionResult =
  | {
      readonly ok: true;
      readonly replayed: boolean;
      readonly intent: PaymentIntent;
      readonly receipt: IntentReceipt;
    }
  | {
      readonly ok: false;
      readonly code: IntentRejectionCode;
      readonly problem: string;
    };

/**
 * The outcome of a transition command (authorize/route/fulfilling/
 * fulfill/fail/cancel).
 *
 * Source: core.md lines 33-37 (the transitions); INV-1-1 (fail/cancel
 * semantics); lines 84-85 (compliance gating before AUTHORIZED).
 */
export type IntentTransitionResult =
  | {
      readonly ok: true;
      readonly intent: PaymentIntent;
    }
  | {
      readonly ok: false;
      readonly code: IntentRejectionCode;
      readonly problem: string;
    };
