/**
 * RTN-003 — Risk/Compliance Authority: the ComplianceCheck lifecycle.
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/evidence-risk-compliance.md §2 Area 16, lines
 *   102-107 (the object, its state machine, and review semantics):
 *     "ComplianceCheck — one evaluation instance tied to a subject
 *      (intent, capability registration, merchant onboarding).
 *      States: EVALUATED -> terminal(APPROVED | DENIED | MANUAL_REVIEW)
 *      -> after review: APPROVED | DENIED.
 *      MANUAL_REVIEW is a durable state; a reviewed decision is recorded
 *      with reviewer authority identity and reason."
 *   lines 112-113 (HIT handling — the per-instance transition constraint):
 *     "HIT creates a MANUAL_REVIEW ComplianceCheck; auto-decision is
 *      forbidden for hits."
 *   lines 140-141 (undecided semantics):
 *     "There is no UNKNOWN decision state: undecided checks block the
 *      gated transition until resolved."
 *   lines 106-107 + 147 (the review record's contents):
 *     "a reviewed decision is recorded with reviewer authority identity
 *      and reason." / "REVIEW_RECORDED (reviewer authority, decision,
 *      rationale)."
 *
 * Design:
 *   - The abstract machine is a transition table (EVALUATED -> {APPROVED,
 *     DENIED, MANUAL_REVIEW}; MANUAL_REVIEW -> {APPROVED, DENIED}; the rest
 *     illegal), enforced by `transitionComplianceCheck`.
 *   - ON TOP of the abstract table sit two per-instance constraints that
 *     make the check's decision deterministic end-to-end (INV-16-1: the
 *     recorded outcome of the evaluation decides, identically, every time):
 *       1. EVALUATED -> APPROVED/DENIED is legal ONLY for a check whose
 *          recorded evaluation outcome is AUTO_APPROVE/AUTO_DENY. For a
 *          MANDATORY_REVIEW evaluation (a screening HIT or a REVIEW-verdict
 *          rule) the auto-decision transition is REJECTED — "auto-decision
 *          is forbidden for hits".
 *       2. EVALUATED -> MANUAL_REVIEW is legal ONLY for a check whose
 *          recorded evaluation outcome is MANDATORY_REVIEW (routing a clean
 *          check to review would contradict its recorded deterministic
 *          outcome).
 *   - The typed facades (decideComplianceCheck /
 *     routeComplianceCheckForReview) additionally make the wrong call
 *     UNREPRESENTABLE at the type level: they accept only the branded
 *     flavor minted by evaluateComplianceCheck whose evaluation outcome
 *     matches (see evaluation.ts).
 *   - recordComplianceReview moves MANUAL_REVIEW -> APPROVED | DENIED and
 *     attaches the review record (reviewer authority identity + decision +
 *     rationale + time). After review the check is terminal — no further
 *     transitions exist.
 */

import { isProtocolTime, protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type {
  AutoDecidableComplianceCheck,
  ComplianceCheckRecord,
  ComplianceCheckState,
  ComplianceReviewRecord,
  ReviewRequiredComplianceCheck,
} from './evaluation.ts';
import { COMPLIANCE_CHECK_STATES } from './evaluation.ts';

/**
 * The complete legal-transition table of the ComplianceCheck state machine
 * (the abstract machine, before the per-instance HIT constraints).
 *
 * Source: evidence-risk-compliance.md §2 lines 104-105 — "EVALUATED ->
 * terminal(APPROVED | DENIED | MANUAL_REVIEW) -> after review: APPROVED |
 * DENIED."
 */
export const COMPLIANCE_CHECK_TRANSITIONS: Readonly<
  Record<ComplianceCheckState, readonly ComplianceCheckState[]>
> = Object.freeze({
  EVALUATED: Object.freeze(['APPROVED', 'DENIED', 'MANUAL_REVIEW'] as const),
  APPROVED: Object.freeze([] as const),
  DENIED: Object.freeze([] as const),
  MANUAL_REVIEW: Object.freeze(['APPROVED', 'DENIED'] as const),
});

/**
 * The outcome of a check state-machine operation: either the next check
 * record, or the deterministic rejection naming the attempted transition and
 * why it is illegal (abstract illegality, per-instance HIT constraint, or a
 * missing review payload).
 *
 * Source: evidence-risk-compliance.md §2 lines 104-107 + 112-113.
 */
export type ComplianceCheckTransitionResult =
  | { readonly ok: true; readonly check: ComplianceCheckRecord }
  | { readonly ok: false; readonly from: ComplianceCheckState; readonly to: ComplianceCheckState; readonly problem: string };

/**
 * Runtime type guard: true iff the value is a ComplianceCheckState.
 *
 * Source: evidence-risk-compliance.md §2 lines 104-105.
 */
export function isComplianceCheckState(value: unknown): value is ComplianceCheckState {
  return typeof value === 'string' && (COMPLIANCE_CHECK_STATES as readonly string[]).includes(value);
}

/**
 * The transition predicate of the abstract ComplianceCheck machine (before
 * per-instance constraints — see module doc).
 *
 * Source: evidence-risk-compliance.md §2 lines 104-105.
 */
export function canTransitionComplianceCheck(from: ComplianceCheckState, to: ComplianceCheckState): boolean {
  return COMPLIANCE_CHECK_TRANSITIONS[from].includes(to);
}

function assertWellFormedCheck(check: ComplianceCheckRecord): void {
  if (check === null || typeof check !== 'object') {
    throw new TypeError('check: record must be an object');
  }
  if (!isComplianceCheckState(check.state)) {
    throw new TypeError(`check: unknown state ${JSON.stringify(check.state)}`);
  }
  if (!isProtocolTime(check.stateChangedAt)) {
    throw new TypeError('check: stateChangedAt must be a well-formed ProtocolTime');
  }
  if (check.review !== undefined && !isProtocolTime(check.review.reviewedAt)) {
    throw new TypeError('check: review.reviewedAt must be a well-formed ProtocolTime');
  }
}

function assertTransitionTime(when: unknown): asserts when is ProtocolTime {
  if (!isProtocolTime(when)) {
    throw new TypeError('check: when must be a well-formed ProtocolTime');
  }
}

/**
 * The general state-machine transition for a compliance check. Enforces the
 * abstract table AND the per-instance constraints (module doc): the
 * auto-decision targets are legal only for auto-decidable evaluations, the
 * review routing only for mandatory-review evaluations, and the reviewed
 * transitions require the review payload. Deterministic rejections carry
 * the reason.
 *
 * Source: evidence-risk-compliance.md §2 lines 104-107 (lifecycle) +
 * lines 112-113 (HIT: "auto-decision is forbidden for hits").
 */
export function transitionComplianceCheck(
  check: ComplianceCheckRecord,
  to: ComplianceCheckState,
  when: ProtocolTime,
  context?: { readonly review?: ComplianceReviewRecord },
): ComplianceCheckTransitionResult {
  assertWellFormedCheck(check);
  assertTransitionTime(when);

  if (!canTransitionComplianceCheck(check.state, to)) {
    return {
      ok: false,
      from: check.state,
      to,
      problem: `illegal ComplianceCheck transition ${check.state} -> ${to} (legal: EVALUATED -> APPROVED | DENIED | MANUAL_REVIEW; MANUAL_REVIEW -> APPROVED | DENIED; terminals are final)`,
    };
  }

  if (check.state === 'EVALUATED' && (to === 'APPROVED' || to === 'DENIED')) {
    if (context?.review !== undefined) {
      return {
        ok: false,
        from: check.state,
        to,
        problem: 'a reviewed decision applies only from MANUAL_REVIEW (a review record cannot attach on the auto-decision path)',
      };
    }
    if (check.evaluation.outcome === 'MANDATORY_REVIEW') {
      return {
        ok: false,
        from: check.state,
        to,
        problem: `auto-decision is forbidden for this check: the recorded evaluation outcome is MANDATORY_REVIEW (reason ${check.evaluation.reasonCode}) — the check must route to MANUAL_REVIEW`,
      };
    }
    const recordedDecision = check.evaluation.outcome === 'AUTO_APPROVE' ? 'APPROVED' : 'DENIED';
    if (to !== recordedDecision) {
      return {
        ok: false,
        from: check.state,
        to,
        problem: `the recorded evaluation outcome is ${check.evaluation.outcome}: the deterministic decision is ${recordedDecision}, not ${to}`,
      };
    }
    return { ok: true, check: { ...check, state: to, stateChangedAt: when } };
  }

  if (check.state === 'EVALUATED' && to === 'MANUAL_REVIEW') {
    if (check.evaluation.outcome !== 'MANDATORY_REVIEW') {
      return {
        ok: false,
        from: check.state,
        to,
        problem: `routing to MANUAL_REVIEW contradicts the recorded evaluation outcome ${check.evaluation.outcome} (deterministic decisions follow the recorded outcome)`,
      };
    }
    return { ok: true, check: { ...check, state: 'MANUAL_REVIEW', stateChangedAt: when } };
  }

  // MANUAL_REVIEW -> APPROVED | DENIED: the reviewed decision.
  if (check.state === 'MANUAL_REVIEW' && (to === 'APPROVED' || to === 'DENIED')) {
    if (context?.review === undefined) {
      return {
        ok: false,
        from: check.state,
        to,
        problem: 'a reviewed decision requires a review record (reviewer authority identity, decision, rationale)',
      };
    }
    const review = context.review;
    if (typeof review.reviewerAuthority !== 'string' || review.reviewerAuthority.length === 0) {
      return {
        ok: false,
        from: check.state,
        to,
        problem: 'the review record requires a non-empty reviewer authority identity',
      };
    }
    if (typeof review.rationale !== 'string' || review.rationale.length === 0) {
      return {
        ok: false,
        from: check.state,
        to,
        problem: 'the review record requires a non-empty rationale',
      };
    }
    if (review.decision !== to) {
      return {
        ok: false,
        from: check.state,
        to,
        problem: `the review decision is ${review.decision}, not ${to}`,
      };
    }
    return {
      ok: true,
      check: { ...check, state: to, review, stateChangedAt: when },
    };
  }

  return {
    ok: false,
    from: check.state,
    to,
    problem: `unreachable transition arm for ${check.state} -> ${to}`,
  };
}

/**
 * Apply the recorded deterministic auto-decision of an EVALUATED,
 * auto-decidable check (EVALUATED -> APPROVED or EVALUATED -> DENIED —
 * exactly the outcome the pure evaluation recorded). Accepts ONLY the
 * AutoDecidableComplianceCheck flavor: a review-required check (a screening
 * HIT or a REVIEW-verdict rule) is not assignable — auto-decision for hits
 * is unrepresentable at the type level (and rejected at runtime by
 * transitionComplianceCheck).
 *
 * Source: evidence-risk-compliance.md §2 lines 104-105 (EVALUATED ->
 * APPROVED | DENIED) + lines 112-113 ("auto-decision is forbidden for
 * hits"); INV-16-1 (the decision follows the recorded outcome,
 * deterministically).
 */
export function decideComplianceCheck(
  check: AutoDecidableComplianceCheck,
  when: ProtocolTime,
): ComplianceCheckRecord {
  const result = transitionComplianceCheck(
    check,
    check.evaluation.outcome === 'AUTO_APPROVE' ? 'APPROVED' : 'DENIED',
    when,
  );
  if (!result.ok) {
    throw new TypeError(`decideComplianceCheck: ${result.problem}`);
  }
  return result.check;
}

/**
 * Route an EVALUATED, review-required check to MANUAL_REVIEW (EVALUATED ->
 * MANUAL_REVIEW) — the transition a screening HIT or a REVIEW-verdict rule
 * demands. Accepts ONLY the ReviewRequiredComplianceCheck flavor.
 *
 * Source: evidence-risk-compliance.md §2 lines 104-107 + lines 112-113 —
 * "HIT creates a MANUAL_REVIEW ComplianceCheck."
 */
export function routeComplianceCheckForReview(
  check: ReviewRequiredComplianceCheck,
  when: ProtocolTime,
): ComplianceCheckRecord {
  const result = transitionComplianceCheck(check, 'MANUAL_REVIEW', when);
  if (!result.ok) {
    throw new TypeError(`routeComplianceCheckForReview: ${result.problem}`);
  }
  return result.check;
}

/**
 * Record a reviewed decision on a MANUAL_REVIEW check (MANUAL_REVIEW ->
 * APPROVED | DENIED): the durable review state resolves with the reviewer
 * authority identity, the decision, and the rationale attached. The result
 * is terminal — APPROVED and DENIED have no outgoing transitions.
 *
 * Source: evidence-risk-compliance.md §2 lines 106-107 — "MANUAL_REVIEW is a
 * durable state; a reviewed decision is recorded with reviewer authority
 * identity and reason."; line 147 — "REVIEW_RECORDED (reviewer authority,
 * decision, rationale)."
 */
export function recordComplianceReview(
  check: ComplianceCheckRecord,
  review: Omit<ComplianceReviewRecord, 'reviewedAt'>,
  when: ProtocolTime,
): ComplianceCheckRecord {
  const result = transitionComplianceCheck(check, review.decision, when, {
    review: { ...review, reviewedAt: when },
  });
  if (!result.ok) {
    throw new TypeError(`recordComplianceReview: ${result.problem}`);
  }
  return result.check;
}

/**
 * Is the check undecided — i.e. does it still block gated transitions? An
 * EVALUATED check is undecided (evaluation recorded, no decision yet), and
 * a MANUAL_REVIEW check is undecided until reviewed. APPROVED and DENIED are
 * decided.
 *
 * Source: evidence-risk-compliance.md §2 lines 140-141 — "There is no
 * UNKNOWN decision state: undecided checks block the gated transition
 * until resolved."
 */
export function isComplianceCheckUndecided(check: ComplianceCheckRecord): boolean {
  return check.state === 'EVALUATED' || check.state === 'MANUAL_REVIEW';
}

/**
 * The stamp helper for authority operations that need a fresh protocol time
 * derived from a base (monotonic: the sequence never decreases). Pure
 * derivation of the next stamp — no clock reads inside the state machine.
 *
 * Source: the A15 'when' contract (evidence-risk-compliance.md lines 27-28
 * — "protocol time (sequenced) and recorded wall time"); the kernel
 * protocolTime mint (time.ts).
 */
export function nextProtocolTimeAfter(base: ProtocolTime, wallMs: number): ProtocolTime {
  return protocolTime(base.sequence + 1, wallMs);
}
