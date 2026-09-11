/**
 * RTN-005 — Intent Authority: the pure state-machine application over
 * PaymentIntent records (the typed, decision-free layer the authority
 * composes).
 *
 * Spec sources (binding) — spec/architecture/v0.1/core.md §1 Area 1:
 *   lines 34-37 (the state machine and one-way semantics):
 *     "States: DRAFT -> AUTHORIZED -> ROUTED -> FULFILLING ->
 *      terminal(FULFILLED | FAILED | CANCELLED).
 *      Transitions are one-way; a failed or cancelled intent cannot be
 *      restarted. A retry is a new intent linked to the prior intent id."
 *   lines 54-56 (INV-1-1):
 *     "INV-1-1 (financial correctness): monetary terms are fixed at
 *      AUTHORIZATION. Any change after authorization requires a new intent;
 *      the old intent moves to CANCELLED with an evidence record."
 *   lines 67-69 (failure semantics):
 *     "If routing or fulfillment later fails, the intent moves to FAILED
 *      with a machine readable reason code and a link to the failing
 *      evidence record."
 *
 * This module is PURE: it maps (record, target state) to either the updated
 * record or a typed rejection; it touches no store, no clock, no evidence
 * port. The authority (authority.ts) owns serialization, gating, evidence,
 * and commit ordering.
 */

import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type {
  IntentReasonCode,
  IntentState,
  IntentTransitionResult,
  PaymentIntent,
} from './types.ts';
import { canTransitionIntent } from './types.ts';

/**
 * Apply one state transition to a PaymentIntent record — pure. Returns the
 * updated record (same identity, same descriptor, new state and
 * stateChangedAt) or a typed rejection:
 *   - ILLEGAL_TRANSITION — the (from, to) pair is not in the frozen table
 *     (covers every restart and post-terminal attempt: "a failed or
 *     cancelled intent cannot be restarted", core.md lines 36-37).
 *
 * INV-1-1 is enforced STRUCTURALLY: the returned record carries the SAME
 * descriptor and descriptorHash objects — there is no field on the result
 * through which terms could change; the only path to new terms is a new
 * intent (see descriptor.ts + the authority's submit command).
 *
 * Source: core.md lines 34-37 (one-way transitions); INV-1-1 lines 54-56
 * (terms fixed at AUTHORIZATION); lines 67-69 (FAILED with reason code).
 */
export function transitionPaymentIntent(
  intent: PaymentIntent,
  target: IntentState,
  at: ProtocolTime,
  patch: {
    readonly policyDecisionId?: string;
  } = {},
): IntentTransitionResult {
  if (!canTransitionIntent(intent.state, target)) {
    return {
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      problem: `intent ${intent.intentId}: illegal one-way transition ${intent.state} -> ${target} (core.md A01 lines 34-37; failed or cancelled intents cannot be restarted)`,
    };
  }
  const updated: PaymentIntent = {
    ...intent,
    state: target,
    ...(patch.policyDecisionId === undefined ? {} : { policyDecisionId: patch.policyDecisionId }),
    stateChangedAt: at,
  };
  return { ok: true, intent: updated };
}

/**
 * The reason-code validation for state-changing commands: FAILED and
 * CANCELLED transitions REQUIRE a reason code from the frozen vocabulary
 * ("the intent moves to FAILED with a machine readable reason code" —
 * core.md lines 67-69; "the old intent moves to CANCELLED with an evidence
 * record" — INV-1-1 lines 54-56; "one record per transition, with reason
 * code" — line 77). Happy-path transitions accept an optional reason code.
 *
 * Source: core.md lines 67-69, 77; INV-1-1 lines 54-56.
 */
export function requiresReasonCode(target: IntentState): boolean {
  return target === 'FAILED' || target === 'CANCELLED';
}

/**
 * Validate a reason code against the frozen A01 vocabulary. Returns the
 * typed rejection shape on failure (the caller forwards it).
 *
 * Source: core.md lines 67-69 ("machine readable reason code"); the frozen
 * vocabulary (types.ts INTENT_REASON_CODES).
 */
export function checkIntentReasonCode(
  target: IntentState,
  reasonCode: IntentReasonCode | undefined,
): { readonly ok: true } | { readonly ok: false; readonly problem: string } {
  if (requiresReasonCode(target) && reasonCode === undefined) {
    return {
      ok: false,
      problem: `intent transition to ${target} requires a reason code from the frozen A01 vocabulary (core.md lines 67-69, 77)`,
    };
  }
  return { ok: true };
}

/**
 * Test helper with no authority semantics: mint a well-formed PaymentIntent
 * record in its initial DRAFT state from a descriptor (the same shape the
 * authority's submit command mints). Exported for conformance suites that
 * exercise the pure transition table without constructing the full
 * authority.
 *
 * Source: core.md lines 33-37 (DRAFT is the entry state; the descriptor is
 * attached at DRAFT, lines 39-41).
 */
export function draftPaymentIntent(input: {
  readonly intentId: string;
  readonly descriptor: PaymentIntent['descriptor'];
  readonly descriptorHash: string;
  readonly when: ProtocolTime;
  readonly priorIntentId?: string;
}): PaymentIntent {
  return {
    intentId: input.intentId,
    idempotencyKey: input.descriptor.idempotencyKey,
    state: 'DRAFT',
    descriptor: input.descriptor,
    descriptorHash: input.descriptorHash,
    ...(input.priorIntentId === undefined ? {} : { priorIntentId: input.priorIntentId }),
    createdAt: input.when,
    stateChangedAt: input.when,
  };
}

/**
 * Convenience re-export seam: the protocol-time mint used by tests of this
 * module (single import site for kernel time in conformance suites).
 *
 * Source: kernel time.ts (the shared 'when' shape, A15 line 28).
 */
export { protocolTime };
