/**
 * RTN-003 — Risk/Compliance Authority: the deterministic compliance
 * evaluation (the INV-16-1 pure function).
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/evidence-risk-compliance.md §2 Area 16:
 *     lines 124-126 (INV-16-1 — THE determinism contract):
 *       "INV-16-1 (determinism): evaluation is a pure function of
 *        (rule version, screening list version, subject data hash);
 *        identical inputs always produce the identical recorded outcome."
 *     lines 102-107 (the check the evaluation instantiates):
 *       "ComplianceCheck — one evaluation instance tied to a subject
 *        (intent, capability registration, merchant onboarding).
 *        States: EVALUATED -> terminal(APPROVED | DENIED | MANUAL_REVIEW)
 *        -> after review: APPROVED | DENIED."
 *     lines 109-113 (the screening input and HIT handling):
 *       "ScreeningResult — deterministic outcome of matching subject data
 *        against a screening list version (sanctions, blocked parties).
 *        States: COMPUTED -> terminal(CLEAR | HIT).
 *        HIT creates a MANUAL_REVIEW ComplianceCheck; auto-decision is
 *        forbidden for hits."
 *     lines 133-134 (INV-16-4 — the check id keying):
 *       "INV-16-4 (idempotency): check ids are keyed by (subject id,
 *        rule set version); re-evaluation returns the recorded result."
 *     lines 140-141 (no UNKNOWN decision):
 *       "There is no UNKNOWN decision state: undecided checks block the
 *        gated transition until resolved."
 *     lines 91-93 (the area's power):
 *       "Compliance decisions block or allow progression; they never
 *        themselves move money."
 *
 * Design:
 *   - `evaluateCompliance` is PURE: given the pinned rule set (rule
 *     versions), the screening list version, and the subject data (whose
 *     canonical hash is the third input), it derives and records the
 *     complete evaluation basis. No store access, no clock, no randomness —
 *     identical inputs produce identical values (property-tested).
 *   - The evaluation outcome is one of exactly three:
 *       AUTO_APPROVE — screening CLEAR, no rule fired.
 *       AUTO_DENY    — a rule fired with onBreach DENY (screening CLEAR;
 *                      a HIT outranks rules — see below).
 *       MANDATORY_REVIEW — the screening matched (HIT) OR a rule fired with
 *                      onBreach REVIEW. Auto-decision for a hit is
 *                      unrepresentable downstream (check.ts's branded
 *                      flavors), so this outcome can only become a
 *                      MANUAL_REVIEW check.
 *   - Deterministic combination order (documented, stable): rules are
 *     evaluated in canonical (ruleId, version) order; fired rules are
 *     recorded in that order; the reason code priority is
 *     SCREENING_HIT > RULE_BREACH > RULE_REVIEW > NO_BREACH.
 *   - The check constructed from an evaluation starts in EVALUATED — the
 *     initial state of the check lifecycle — carrying the full recorded
 *     basis (INV-16-1's "recorded outcome"). Deciding it is a separate,
 *     later operation (check.ts); an undecided check blocks gated
 *     transitions (gate.ts).
 */

import type { ProtocolTime } from '../kernel/time.ts';
import {
  assembleRuleSet,
  deriveComplianceCheckId,
  evaluateRiskRule,
} from './rule.ts';
import type { RiskRuleRecord, VersionedRuleSet, RuleSetVersion } from './rule.ts';
import type { RiskReasonCode } from './reason-codes.ts';
import { screenSubjectData } from './screening.ts';
import type { ScreeningListRecord } from './screening.ts';
import { deriveSubjectDataHash } from './subject.ts';
import type { SubjectComplianceData, SubjectDataHash, SubjectKind } from './subject.ts';

/**
 * The evaluation outcome: exactly the three destinations of the check
 * lifecycle's EVALUATED state, with HIT/RULE_REVIEW collapsed into
 * MANDATORY_REVIEW (the only route to MANUAL_REVIEW).
 *
 * Source: evidence-risk-compliance.md §2 lines 104-107 ("EVALUATED ->
 * terminal(APPROVED | DENIED | MANUAL_REVIEW)") + lines 112-113 ("HIT
 * creates a MANUAL_REVIEW ComplianceCheck; auto-decision is forbidden for
 * hits").
 */
export type ComplianceEvaluationOutcome = 'AUTO_APPROVE' | 'AUTO_DENY' | 'MANDATORY_REVIEW';

/**
 * One fired rule version, recorded in the evaluation as proof of which
 * rule version fired and with what verdict.
 *
 * Source: evidence-risk-compliance.md §2 lines 98-100 (the versioned rule
 * definitions the evaluation ran); INV-16-1's "rule version" input (lines
 * 124-126 — the fired rules are recorded per exact version).
 */
export interface FiredRule {
  readonly ruleId: string;
  readonly version: number;
  readonly verdict: 'DENY' | 'REVIEW';
}

/**
 * The complete recorded evaluation basis of a compliance check: the exact
 * input triple (rule set version, screening list version id, subject data
 * hash), the derived outcome and reason code, the fired rule versions in
 * canonical order, and the screening outcome.
 *
 * Source: INV-16-1 (evidence-risk-compliance.md lines 124-126 — "identical
 * inputs always produce the identical recorded outcome"); line 145
 * ("CHECK_DECIDED (subject, rule set version, outcome, reason code)").
 */
export interface ComplianceEvaluation {
  readonly ruleSetVersion: RuleSetVersion;
  readonly screeningListVersionId: string;
  readonly subjectDataHash: SubjectDataHash;
  readonly outcome: ComplianceEvaluationOutcome;
  readonly reasonCode: RiskReasonCode;
  readonly firedRules: readonly FiredRule[];
  readonly screeningOutcome: 'CLEAR' | 'HIT';
  readonly evaluatedAt: ProtocolTime;
}

/**
 * The inputs of the pure evaluation: the pinned rule versions, the pinned
 * screening list version, the subject data, and the protocol time the
 * evaluation is recorded at (a stamp, not an input to the decision — the
 * decision depends only on the spec's triple; the stamp rides along for the
 * record).
 *
 * Source: INV-16-1 (evidence-risk-compliance.md lines 124-126); the 'when'
 * stamp follows the A15 record contract (lines 27-28).
 */
export interface ComplianceEvaluationInput {
  readonly rules: readonly RiskRuleRecord[];
  readonly screeningList: ScreeningListRecord;
  readonly subject: SubjectComplianceData;
  readonly evaluatedAt: ProtocolTime;
}

/**
 * The pure deterministic evaluation (INV-16-1). Given the exact rule
 * versions, the screening list version, and the subject data (whose
 * canonical hash is the third named input), derives the complete recorded
 * evaluation basis. Identical inputs always produce the identical
 * evaluation. No store, no clock, no randomness.
 *
 * Combination semantics (deterministic, documented):
 *   1. the screening match runs first — a HIT forces MANDATORY_REVIEW with
 *      reason SCREENING_HIT (A16 lines 112-113);
 *   2. else rules evaluate in canonical (ruleId, version) order — any
 *      DENY-verdict firing forces AUTO_DENY with reason RULE_BREACH;
 *   3. else any REVIEW-verdict firing forces MANDATORY_REVIEW with reason
 *      RULE_REVIEW;
 *   4. else AUTO_APPROVE with reason NO_BREACH.
 *
 * Source: INV-16-1 (evidence-risk-compliance.md lines 124-126); lines
 * 109-113 (screening semantics and HIT handling); lines 98-99 (rule
 * semantics).
 */
export function evaluateCompliance(input: ComplianceEvaluationInput): ComplianceEvaluation {
  const ruleSet: VersionedRuleSet = assembleRuleSet(input.rules);
  const subjectDataHash = deriveSubjectDataHash(input.subject);
  const match = screenSubjectData(input.screeningList, subjectDataHash);

  const firedRules: FiredRule[] = [];
  for (const rule of ruleSet.rules) {
    const verdict = evaluateRiskRule(rule, input.subject);
    if (verdict !== 'NOT_FIRED') {
      firedRules.push({ ruleId: rule.ruleId, version: rule.version, verdict });
    }
  }

  let outcome: ComplianceEvaluationOutcome;
  let reasonCode: RiskReasonCode;
  if (match.outcome === 'HIT') {
    outcome = 'MANDATORY_REVIEW';
    reasonCode = 'SCREENING_HIT';
  } else if (firedRules.some((fired) => fired.verdict === 'DENY')) {
    outcome = 'AUTO_DENY';
    reasonCode = 'RULE_BREACH';
  } else if (firedRules.length > 0) {
    outcome = 'MANDATORY_REVIEW';
    reasonCode = 'RULE_REVIEW';
  } else {
    outcome = 'AUTO_APPROVE';
    reasonCode = 'NO_BREACH';
  }

  return {
    ruleSetVersion: ruleSet.ruleSetVersion,
    screeningListVersionId: `${input.screeningList.listId}@v${input.screeningList.version}`,
    subjectDataHash,
    outcome,
    reasonCode,
    firedRules,
    screeningOutcome: match.outcome,
    evaluatedAt: input.evaluatedAt,
  };
}

/**
 * One immutable compliance check — the evaluation instance. State starts at
 * EVALUATED; the id is derived from the exact INV-16-4 keying pair (subject
 * id, rule set version).
 *
 * Source: evidence-risk-compliance.md §2 lines 102-107; INV-16-4 (lines
 * 133-134).
 */
export interface ComplianceCheckRecord {
  readonly checkId: string;
  readonly subjectId: string;
  readonly subjectKind: SubjectKind;
  readonly ruleSetVersion: RuleSetVersion;
  readonly screeningListVersionId: string;
  readonly subjectDataHash: SubjectDataHash;
  readonly state: ComplianceCheckState;
  readonly evaluation: ComplianceEvaluation;
  readonly review?: ComplianceReviewRecord;
  readonly createdAt: ProtocolTime;
  readonly stateChangedAt: ProtocolTime;
}

/**
 * The check-decision flavors, minted ONLY by evaluateComplianceCheck:
 *   - AutoDecidableComplianceCheck: the evaluation outcome is AUTO_APPROVE
 *     or AUTO_DENY — the ONLY value decideComplianceCheck accepts.
 *   - ReviewRequiredComplianceCheck: the evaluation outcome is
 *     MANDATORY_REVIEW (a screening HIT or a REVIEW-verdict rule) — the
 *     ONLY value routeComplianceCheckForReview accepts.
 * A review-required check can therefore never be passed to the
 * auto-decision function, at the type level — "auto-decision is forbidden
 * for hits" is enforced structurally (and again at runtime by the state
 * machine's per-instance constraint).
 *
 * Source: evidence-risk-compliance.md §2 lines 112-113 — "HIT creates a
 * MANUAL_REVIEW ComplianceCheck; auto-decision is forbidden for hits."
 */
export interface AutoDecidableComplianceCheck extends ComplianceCheckRecord {
  readonly __checkFlavor: 'AUTO';
}

export interface ReviewRequiredComplianceCheck extends ComplianceCheckRecord {
  readonly __checkFlavor: 'REVIEW';
}

/**
 * The union of check flavors evaluateComplianceCheck mints.
 *
 * Source: evidence-risk-compliance.md §2 lines 104-113.
 */
export type EvaluatedComplianceCheck = AutoDecidableComplianceCheck | ReviewRequiredComplianceCheck;

/**
 * A recorded reviewed decision: the reviewer authority identity, the
 * decision, the rationale, and the review time. Present on a check only
 * after MANUAL_REVIEW -> APPROVED | DENIED.
 *
 * Source: evidence-risk-compliance.md §2 lines 106-107 — "MANUAL_REVIEW is
 * a durable state; a reviewed decision is recorded with reviewer authority
 * identity and reason."; line 147 — "REVIEW_RECORDED (reviewer authority,
 * decision, rationale)."
 */
export interface ComplianceReviewRecord {
  readonly reviewerAuthority: string;
  readonly decision: 'APPROVED' | 'DENIED';
  readonly rationale: string;
  readonly reviewedAt: ProtocolTime;
}

/**
 * The ComplianceCheck state machine, verbatim from the spec.
 *
 * Source: evidence-risk-compliance.md §2 lines 104-105 — "States: EVALUATED
 * -> terminal(APPROVED | DENIED | MANUAL_REVIEW) -> after review: APPROVED
 * | DENIED."
 */
export const COMPLIANCE_CHECK_STATES: readonly ['EVALUATED', 'APPROVED', 'DENIED', 'MANUAL_REVIEW'] =
  Object.freeze(['EVALUATED', 'APPROVED', 'DENIED', 'MANUAL_REVIEW'] as const);

/**
 * A ComplianceCheck state. Source: evidence-risk-compliance.md §2 lines
 * 104-105.
 */
export type ComplianceCheckState = (typeof COMPLIANCE_CHECK_STATES)[number];

/**
 * Evaluate a compliance check for a subject: the pure evaluation, the
 * derived check id (INV-16-4 keying), and the EVALUATED-state check record
 * carrying the full recorded basis. The returned flavor is branded by the
 * evaluation outcome — auto-decidable or review-required — which is what
 * makes auto-decision for hits unrepresentable downstream.
 *
 * Source: evidence-risk-compliance.md §2 lines 102-107 (the check as one
 * evaluation instance); INV-16-1 (lines 124-126); INV-16-4 (lines 133-134);
 * lines 112-113 (HIT handling).
 */
export function evaluateComplianceCheck(input: ComplianceEvaluationInput): EvaluatedComplianceCheck {
  const evaluation = evaluateCompliance(input);
  const checkId = deriveComplianceCheckId(input.subject.subjectId, evaluation.ruleSetVersion);
  const base = {
    checkId,
    subjectId: input.subject.subjectId,
    subjectKind: input.subject.subjectKind,
    ruleSetVersion: evaluation.ruleSetVersion,
    screeningListVersionId: evaluation.screeningListVersionId,
    subjectDataHash: evaluation.subjectDataHash,
    state: 'EVALUATED' as const,
    evaluation,
    createdAt: input.evaluatedAt,
    stateChangedAt: input.evaluatedAt,
  };
  if (evaluation.outcome === 'MANDATORY_REVIEW') {
    return { ...base, __checkFlavor: 'REVIEW' } as ReviewRequiredComplianceCheck;
  }
  return { ...base, __checkFlavor: 'AUTO' } as AutoDecidableComplianceCheck;
}
