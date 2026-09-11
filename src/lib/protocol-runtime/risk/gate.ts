/**
 * RTN-003 — Risk/Compliance Authority: the compliance gate (INV-16-3).
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/evidence-risk-compliance.md §2 Area 16, lines
 *   129-131 (THE gating invariant):
 *     "INV-16-3 (gating): state transitions gated by compliance
 *      (intent AUTHORIZATION, capability ACTIVATION) cannot complete
 *      without a terminal APPROVED record for the subject."
 *   lines 140-141 (undecided semantics — what blocks mean):
 *     "There is no UNKNOWN decision state: undecided checks block the
 *      gated transition until resolved."
 *   lines 91-93 (the area's power — and its only power):
 *     "Compliance decisions block or allow progression; they never
 *      themselves move money."
 *   spec/architecture/v0.1/core.md §1 Area 1, lines 84-85 (the gated
 *   transition, intent side):
 *     "Depends on area 2 at authorization, area 3 at routing, and area 16
 *      for compliance gating before AUTHORIZED."
 *   spec/architecture/v0.1/core.md §3 Area 3, lines 207-208 (the gated
 *   transition, capability side):
 *     "Depends on area 15 for evidence and area 16 for risk gating of
 *      capability registration."
 *   spec/registry/protocol-registry.json area A16 — owningAuthority:
 *   "Risk and Compliance Authority".
 *
 * Design:
 *   - The gate is the interface other authorities call before completing a
 *     gated transition (RTN-005's Intent Authority before AUTHORIZED;
 *     RTN-006's Capability Authority at ACTIVATION). It is a PURE function
 *     over the recorded checks for the subject plus the gate kind — the
 *     verdict depends on nothing else.
 *   - Verdict semantics (exactly INV-16-3 + the undecided sentence):
 *       allowed   — a terminal APPROVED check exists for the subject;
 *       blocked   — everything else: no check at all, an undecided check
 *                   (EVALUATED or MANUAL_REVIEW), or a DENIED check.
 *   - The two gate kinds are exactly the two INV-16-3 names — no other
 *     gated transition is representable. A check authorizes a gate only
 *     if its subject kind matches the gate kind's subject (an INTENT check
 *     for intent AUTHORIZATION; a CAPABILITY_REGISTRATION check for
 *     capability ACTIVATION) — so a check recorded for one kind of subject
 *     can never authorize a different kind of gated transition.
 *   - Blocked verdicts carry a deterministic blocking reason and the
 *     blocking check id (when one exists), so callers can record why the
 *     gated transition did not complete.
 */

import type { ComplianceCheckRecord } from './evaluation.ts';
import { isComplianceCheckUndecided } from './check.ts';
import type { SubjectKind } from './subject.ts';

/**
 * The gated transition kinds, exactly the two INV-16-3 names: intent
 * AUTHORIZATION and capability ACTIVATION. Frozen — no other gated
 * transition is representable.
 *
 * Source: INV-16-3 (evidence-risk-compliance.md lines 129-131) — "state
 * transitions gated by compliance (intent AUTHORIZATION, capability
 * ACTIVATION) cannot complete without a terminal APPROVED record for the
 * subject."
 */
export const GATED_TRANSITION_KINDS: readonly ['intent.AUTHORIZATION', 'capability.ACTIVATION'] =
  Object.freeze(['intent.AUTHORIZATION', 'capability.ACTIVATION'] as const);

/**
 * A gated transition kind. Source: INV-16-3 (evidence-risk-compliance.md
 * lines 129-131).
 */
export type GatedTransitionKind = (typeof GATED_TRANSITION_KINDS)[number];

/**
 * Why a gated transition is blocked (the deterministic blocking reasons).
 *
 * Source: INV-16-3 (evidence-risk-compliance.md lines 129-131 — anything but
 * a terminal APPROVED record blocks) + lines 140-141 (undecided checks
 * block).
 */
export type ComplianceGateBlockReason = 'NO_APPROVED_CHECK' | 'CHECK_UNDECIDED' | 'CHECK_DENIED';

/**
 * The gate verdict: allowed with the authorizing check, or blocked with a
 * deterministic reason (and the blocking check id when one exists).
 *
 * Source: INV-16-3 (evidence-risk-compliance.md lines 129-131); lines
 * 140-141 (undecided blocking).
 */
export type ComplianceGateVerdict =
  | {
      readonly allowed: true;
      readonly gateKind: GatedTransitionKind;
      readonly subjectId: string;
      readonly checkId: string;
    }
  | {
      readonly allowed: false;
      readonly gateKind: GatedTransitionKind;
      readonly subjectId: string;
      readonly blockedBy: ComplianceGateBlockReason;
      readonly checkId?: string;
    };

/**
 * Runtime type guard: true iff the value is a GatedTransitionKind.
 *
 * Source: INV-16-3 (the closed two-member list).
 */
export function isGatedTransitionKind(value: unknown): value is GatedTransitionKind {
  return typeof value === 'string' && (GATED_TRANSITION_KINDS as readonly string[]).includes(value);
}

function subjectKindForGate(kind: GatedTransitionKind): SubjectKind {
  return kind === 'intent.AUTHORIZATION' ? 'INTENT' : 'CAPABILITY_REGISTRATION';
}

/**
 * The gate check other authorities call before completing a gated
 * transition: PURE over the recorded checks for the subject. The gated
 * transition may complete ONLY on `allowed: true` — a terminal APPROVED
 * record for the subject (INV-16-3). Every other configuration blocks:
 *   - CHECK_UNDECIDED — an EVALUATED or MANUAL_REVIEW check exists
 *     (undecided checks block until resolved — A16 lines 140-141);
 *   - CHECK_DENIED    — a DENIED check exists (terminal negative);
 *   - NO_APPROVED_CHECK — no check of the gate's subject kind exists.
 * Blocking-reason priority (deterministic): CHECK_DENIED > CHECK_UNDECIDED
 * > NO_APPROVED_CHECK.
 *
 * Source: INV-16-3 (evidence-risk-compliance.md lines 129-131 — "cannot
 * complete without a terminal APPROVED record for the subject"); lines
 * 140-141 ("undecided checks block the gated transition until resolved").
 */
export function evaluateComplianceGate(
  checks: readonly ComplianceCheckRecord[],
  gateKind: GatedTransitionKind,
  subjectId: string,
): ComplianceGateVerdict {
  if (!isGatedTransitionKind(gateKind)) {
    throw new TypeError(
      `gate: gateKind must be one of ${GATED_TRANSITION_KINDS.join(', ')} (got ${JSON.stringify(gateKind)})`,
    );
  }
  if (typeof subjectId !== 'string' || subjectId.length === 0) {
    throw new TypeError('gate: subjectId must be a non-empty string');
  }
  const subjectKind = subjectKindForGate(gateKind);
  const relevant = checks.filter(
    (check) => check.subjectId === subjectId && check.subjectKind === subjectKind,
  );

  const approved = relevant.find((check) => check.state === 'APPROVED');
  if (approved !== undefined) {
    return { allowed: true, gateKind, subjectId, checkId: approved.checkId };
  }
  const denied = relevant.find((check) => check.state === 'DENIED');
  if (denied !== undefined) {
    return { allowed: false, gateKind, subjectId, blockedBy: 'CHECK_DENIED', checkId: denied.checkId };
  }
  const undecided = relevant.find((check) => isComplianceCheckUndecided(check));
  if (undecided !== undefined) {
    return {
      allowed: false,
      gateKind,
      subjectId,
      blockedBy: 'CHECK_UNDECIDED',
      checkId: undecided.checkId,
    };
  }
  return { allowed: false, gateKind, subjectId, blockedBy: 'NO_APPROVED_CHECK' };
}
