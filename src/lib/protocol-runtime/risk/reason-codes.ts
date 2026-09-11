/**
 * RTN-003 — Risk/Compliance Authority: the area-16 reason-code vocabulary.
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/evidence-risk-compliance.md §2 Area 16:
 *     line 30 — "outcome: resulting state or decision, including reason
 *      codes." (the A15 evidence slot every A16 record fills)
 *     lines 145-147 — "Evidence produced:
 *      - CHECK_DECIDED (subject, rule set version, outcome, reason code)."
 *   spec/architecture/v0.1/README.md §3 GC-5, lines 63-67 (the record shape
 *   the reason code rides in).
 *
 * Scope discipline (mirroring the kernel's reason-codes.ts decision 3): the
 * v0.1 shared vocabulary defines exactly one area-agnostic outcome token
 * (UNKNOWN, GC-2 — see kernel reason-codes.ts); every area-specific code is
 * owned by its area's materialization work order. This module is the A16
 * vocabulary owned by RTN-003, exactly as large as the A16 evidence contract
 * requires it to be: CHECK_DECIDED carries ONE reason code naming WHY the
 * check decided as it did. The four members below are the complete, closed
 * set of check-decision reasons the area's deterministic evaluation can
 * produce (see evaluation.ts — the evaluation outcome maps 1:1 onto one of
 * these codes); no other member can be minted at runtime (frozen tuple).
 *
 * Mapping (evaluation.ts enforces; tests assert):
 *   NO_BREACH      — screening CLEAR and no rule fired          -> AUTO_APPROVE
 *   RULE_BREACH    — a rule fired with onBreach DENY            -> AUTO_DENY
 *   RULE_REVIEW    — a rule fired with onBreach REVIEW          -> MANDATORY_REVIEW
 *   SCREENING_HIT  — screening matched a list entry             -> MANDATORY_REVIEW
 */

/**
 * The A16 check-decision reason vocabulary, frozen. Members:
 *   - NO_BREACH: "no rule fired, screening clear" — the AUTO_APPROVE cause.
 *   - RULE_BREACH: a threshold rule fired with DENY — the AUTO_DENY cause
 *     (INV-16-2: the breach comparison that fired was integer-only).
 *   - RULE_REVIEW: a threshold rule fired with REVIEW — a MANUAL_REVIEW cause.
 *   - SCREENING_HIT: the screening matched (A16 lines 112-113: "HIT creates a
 *     MANUAL_REVIEW ComplianceCheck; auto-decision is forbidden for hits") —
 *     the other MANUAL_REVIEW cause.
 *
 * Source: evidence-risk-compliance.md §2 lines 145-147 ("CHECK_DECIDED
 * (subject, rule set version, outcome, reason code)"); the evaluation causes
 * derive from lines 98-113 (rule semantics, screening semantics) — the
 * vocabulary is the closed set of causes the deterministic evaluation
 * (INV-16-1) can record.
 */
export const RISK_REASON_CODES: readonly ['NO_BREACH', 'RULE_BREACH', 'RULE_REVIEW', 'SCREENING_HIT'] =
  Object.freeze(['NO_BREACH', 'RULE_BREACH', 'RULE_REVIEW', 'SCREENING_HIT'] as const);

/**
 * A risk/compliance reason code (a CHECK_DECIDED reason).
 *
 * Source: evidence-risk-compliance.md §2 line 145 — "CHECK_DECIDED (subject,
 * rule set version, outcome, reason code)."
 */
export type RiskReasonCode = (typeof RISK_REASON_CODES)[number];

/**
 * Runtime type guard: true iff the value is a member of the A16 vocabulary.
 *
 * Source: evidence-risk-compliance.md §2 line 145 (the reason-code field of
 * CHECK_DECIDED is a closed area vocabulary).
 */
export function isRiskReasonCode(value: unknown): value is RiskReasonCode {
  return typeof value === 'string' && (RISK_REASON_CODES as readonly string[]).includes(value);
}
