/**
 * RTN-006 — Routing Authority: the pure state-machine application over
 * RoutePlan records (the typed, decision-free layer the authority
 * composes).
 *
 * Spec sources (binding) — spec/architecture/v0.1/core.md §4 Area 4:
 *   lines 224-225 (the state machine, verbatim):
 *     "States: COMPILED -> VALIDATED -> DISPATCHED ->
 *      terminal(COMPLETED | FAILED | ABANDONED)."
 *   lines 255-259 (the UNKNOWN-halting rule that the machine makes
 *   structural):
 *     "a hop may return UNKNOWN from a rail (area 13); the plan then halts
 *      at DISPATCHED — it never re-dispatches hops blindly (GC-2). Recovery
 *      proceeds only after reconciliation (area 14) resolves the UNKNOWN
 *      rail operation; the plan then completes or fails based on the
 *      resolved outcome."
 *   lines 263-265 (evidence: "ROUTE_FAILED, ROUTE_ABANDONED (with reason
 *   codes and affected hop ids)").
 *
 * This module is PURE: it maps (record, target state) to either the updated
 * record or a typed rejection; it touches no store, no clock, no evidence
 * port. The authority (authority.ts) owns serialization, reservation
 * acquisition, evidence, and commit ordering.
 */

import type { ProtocolTime } from '../kernel/time.ts';
import type {
  HopReservationRef,
  RoutePlan,
  RoutePlanReasonCode,
  RoutePlanState,
  RouteCommandResult,
} from './types.ts';
import { canTransitionRoutePlan } from './types.ts';

/**
 * Apply one state transition to a RoutePlan record — pure. Returns the
 * updated record (same identity, same hops and value ledger, new state and
 * stateChangedAt, plus dispatch-time reservation references) or a typed
 * rejection:
 *   - ILLEGAL_TRANSITION — the (from, to) pair is not in the frozen table.
 *     This covers every blind re-dispatch attempt ("it never re-dispatches
 *     hops blindly (GC-2)": DISPATCHED has no DISPATCHED successor) and
 *     every post-terminal attempt (all three terminals have empty successor
 *     sets).
 *
 * The returned record carries the SAME hops, value ledger, and snapshot id:
 * a dispatched plan cannot be re-compiled in place (a new compilation is a
 * new plan under a new compilation key — INV-4-3).
 *
 * Source: core.md lines 224-225 (the chain), 255-259 (the exits and the
 * no-blind-re-dispatch rule).
 */
export function transitionRoutePlan(
  plan: RoutePlan,
  target: RoutePlanState,
  at: ProtocolTime,
  patch: {
    readonly reservationRefs?: readonly HopReservationRef[];
  } = {},
): RouteCommandResult {
  if (!canTransitionRoutePlan(plan.state, target)) {
    return {
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      problem:
        `route plan ${plan.planId}: illegal one-way transition ${plan.state} -> ${target} ` +
        '(core.md A04 lines 224-225; a dispatched plan is never re-dispatched blindly (GC-2, lines 255-259) ' +
        'and a terminal plan has no successor)',
    };
  }
  const updated: RoutePlan = {
    ...plan,
    state: target,
    ...(patch.reservationRefs === undefined ? {} : { reservationRefs: patch.reservationRefs }),
    stateChangedAt: at,
  };
  return { ok: true, plan: updated };
}

/**
 * The reason-code validation for terminal transitions: FAILED and ABANDONED
 * transitions REQUIRE a reason code from the frozen vocabulary ("with
 * reason codes and affected hop ids" — core.md lines 263-265; NO_VIABLE_ROUTE
 * is the terminal failure's own code, lines 253-254). Happy-path
 * transitions accept no reason code (VALIDATED / DISPATCHED / COMPLETED
 * carry none in the v0.1 evidence contract).
 *
 * Source: core.md lines 253-265.
 */
export function requiresReasonCode(target: RoutePlanState): boolean {
  return target === 'FAILED' || target === 'ABANDONED';
}

/**
 * Validate a reason code against the frozen A04 vocabulary. Returns the
 * typed rejection shape on failure (the caller forwards it).
 *
 * Source: core.md lines 263-265 ("with reason codes"); the frozen
 * vocabulary (types.ts ROUTE_PLAN_REASON_CODES).
 */
export function checkRoutePlanReasonCode(
  target: RoutePlanState,
  reasonCode: RoutePlanReasonCode | undefined,
): { readonly ok: true } | { readonly ok: false; readonly problem: string } {
  if (requiresReasonCode(target)) {
    if (reasonCode === undefined) {
      return {
        ok: false,
        problem:
          `route plan terminal transition to ${target} requires a reason code ` +
          '(core.md A04 lines 263-265: "with reason codes and affected hop ids")',
      };
    }
  } else if (reasonCode !== undefined) {
    return {
      ok: false,
      problem: `route plan transition to ${target} carries no reason code (core.md A04 lines 263-265)`,
    };
  }
  return { ok: true };
}

/**
 * Guard: a DISPATCHED plan with any UNRESOLVED UNKNOWN-hop halt annotation
 * may not complete — "the plan then halts at DISPATCHED ... Recovery
 * proceeds only after reconciliation (area 14) resolves the UNKNOWN rail
 * operation; the plan then completes or fails based on the resolved
 * outcome" (core.md lines 255-259). Completing (or otherwise terminal-
 * transitioning on a resolved outcome) while a halt is unresolved would be
 * exactly the blind resume GC-2 forbids.
 *
 * PURE: a predicate over the plan record.
 *
 * Source: core.md lines 255-259; README.md §3 GC-2 lines 45-49.
 */
export function hasUnresolvedUnknownHop(plan: RoutePlan): boolean {
  return plan.unknownHops.some((ref) => ref.resolvedOutcome === undefined);
}

/**
 * The protocol time the plan's terminal transition must carry when the plan
 * has UNRESOLVED UNKNOWN-hop annotations is left deliberately to the
 * authority (this module stays clock-free); this helper only derives the
 * deterministic wall-clock ordering fact the halt rule needs: true iff the
 * given protocol time is at or past the reservation deadline the plan
 * recorded. Used by the authority to decide RESERVATIONS_EXPIRED
 * abandonment of a halted plan.
 *
 * Source: core.md lines 288-291 (area 5 — "Each reservation carries a
 * deadline; expiry is deterministic on protocol time").
 */
export function deadlinePassedAt(plan: RoutePlan, at: ProtocolTime): boolean {
  return at.wallMs >= plan.deadlineEpochMs;
}
