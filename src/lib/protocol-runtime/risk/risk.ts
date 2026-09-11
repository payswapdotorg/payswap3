/**
 * RTN-003 — Risk/Compliance Authority: public barrel.
 *
 * Owned surface: src/lib/protocol-runtime/risk/ (work order RTN-003).
 * Every export cites its spec/architecture/v0.1/ source in its module's
 * doc-comments and in CONTRACT-REVIEW.md (this directory).
 *
 * The authority materializes the A16 contracts: the RiskRule lifecycle
 * (AUTHORED -> VERSIONED -> ACTIVE -> RETIRED), the ComplianceCheck
 * lifecycle (EVALUATED -> terminal(APPROVED | DENIED | MANUAL_REVIEW) ->
 * after review APPROVED | DENIED), the ScreeningResult lifecycle (COMPUTED
 * -> terminal(CLEAR | HIT)), deterministic evaluation as a pure function of
 * (rule version, screening list version, subject data hash) (INV-16-1),
 * integer-only thresholds (INV-16-2), compliance gating of intent
 * AUTHORIZATION and capability ACTIVATION (INV-16-3), and check idempotency
 * keyed by (subject id, rule set version) (INV-16-4). Evidence is emitted
 * through the kernel-declared EvidenceSubmission port (an owned test double
 * until RTN-012 proves the real-log integration); persistence follows the
 * RTN-001 per-domain convention on the DEP-003 database layer.
 *
 * The authority hosts no financial decision beyond gating and recording:
 * it never creates obligations or rail operations (A16 boundaries, lines
 * 149-154).
 */

// --- reason-codes.ts — the A16 reason vocabulary ---------------------------
export { RISK_REASON_CODES, isRiskReasonCode } from './reason-codes.ts';
export type { RiskReasonCode } from './reason-codes.ts';

// --- subject.ts — the checked subject and its data hash -------------------
export {
  SUBJECT_DATA_HASH_FORMAT_VERSION,
  SUBJECT_KINDS,
  subjectComplianceData,
  canonicalSubjectData,
  deriveSubjectDataHash,
  isSubjectDataHash,
  isSubjectKind,
} from './subject.ts';
export type {
  SubjectKind,
  SubjectMoneyFact,
  SubjectCountFact,
  SubjectComplianceData,
  SubjectDataHash,
} from './subject.ts';

// --- rule.ts — the RiskRule lifecycle and rule set versions ----------------
export {
  RISK_RULE_STATES,
  RISK_RULE_TRANSITIONS,
  RULE_SET_VERSION_FORMAT_VERSION,
  isRiskRuleState,
  canTransitionRiskRule,
  authorRiskRule,
  reviseRiskRuleDefinition,
  publishRiskRuleVersion,
  activateRiskRule,
  retireRiskRule,
  validateRiskRuleDefinition,
  evaluateRiskRule,
  deriveRuleSetVersion,
  assembleRuleSet,
  deriveComplianceCheckId,
} from './rule.ts';
export type {
  RiskRuleState,
  RuleFactReference,
  RuleThresholdBound,
  RuleComparisonOperator,
  RuleBreachAction,
  RiskRuleDefinition,
  RiskRuleRecord,
  RuleSetVersion,
  RiskRuleVerdict,
  RiskRuleTransitionResult,
  RiskRuleEvaluation,
  VersionedRuleSet,
} from './rule.ts';

// --- screening.ts — the ScreeningResult lifecycle --------------------------
export {
  SCREENING_RESULT_STATES,
  SCREENING_RESULT_TRANSITIONS,
  screeningListVersionId,
  screenSubjectData,
  isScreeningResultState,
  canTransitionScreeningResult,
  createScreeningList,
  computeScreeningResult,
  resolveScreeningResult,
  deriveScreeningId,
} from './screening.ts';
export type {
  ScreeningResultState,
  ScreeningListRecord,
  ScreeningResultRecord,
} from './screening.ts';

// --- evaluation.ts — the pure INV-16-1 evaluation and the check record -----
export {
  COMPLIANCE_CHECK_STATES,
  evaluateCompliance,
  evaluateComplianceCheck,
} from './evaluation.ts';
export type {
  ComplianceEvaluationOutcome,
  FiredRule,
  ComplianceEvaluation,
  ComplianceEvaluationInput,
  ComplianceCheckRecord,
  ComplianceCheckState,
  ComplianceReviewRecord,
  AutoDecidableComplianceCheck,
  ReviewRequiredComplianceCheck,
  EvaluatedComplianceCheck,
} from './evaluation.ts';

// --- check.ts — the ComplianceCheck state machine --------------------------
export {
  COMPLIANCE_CHECK_TRANSITIONS,
  isComplianceCheckState,
  canTransitionComplianceCheck,
  transitionComplianceCheck,
  decideComplianceCheck,
  routeComplianceCheckForReview,
  recordComplianceReview,
  isComplianceCheckUndecided,
  nextProtocolTimeAfter,
} from './check.ts';
export type { ComplianceCheckTransitionResult } from './check.ts';

// --- gate.ts — the INV-16-3 compliance gate ---------------------------------
export {
  GATED_TRANSITION_KINDS,
  isGatedTransitionKind,
  evaluateComplianceGate,
} from './gate.ts';
export type {
  GatedTransitionKind,
  ComplianceGateBlockReason,
  ComplianceGateVerdict,
} from './gate.ts';

// --- evidence.ts — A15 five-slot records through the port ------------------
export {
  RISK_AUTHORITY_ID,
  checkDecidedEvidence,
  screeningComputedEvidence,
  reviewRecordedEvidence,
  submitRiskEvidence,
} from './evidence.ts';

// --- store.ts — the risk-domain persistence convention ---------------------
export {
  DEFAULT_RISK_DB_PATH,
  RISK_MIGRATIONS_DIR_ENV_VAR,
  RISK_MIGRATIONS_RELATIVE_DIR,
  RISK_STORE_DOMAIN,
  resolveRiskMigrationsDir,
  openRiskStore,
  insertRiskRuleDraft,
  saveRiskRuleDraftDefinition,
  publishRiskRuleRow,
  saveRiskRuleState,
  findRiskRule,
  findRiskRuleDraft,
  nextRiskRuleVersion,
  listRiskRulesInState,
  insertScreeningList,
  findLatestScreeningList,
  findScreeningListVersion,
  recordScreeningListRefreshFailure,
  countScreeningListRefreshFailures,
  insertScreeningResult,
  saveScreeningResultState,
  findScreeningResult,
  insertComplianceCheck,
  saveComplianceCheckState,
  findComplianceCheck,
  listComplianceChecksForSubject,
} from './store.ts';
export type { RiskStoreOptions } from './store.ts';

// --- test-double.ts — the owned EvidenceSubmission port double -------------
export {
  EVIDENCE_RECORD_SLOTS,
  assertEvidenceFiveSlotShape,
  EvidenceSubmissionTestDouble,
} from './test-double.ts';
export type { RecordedEvidenceSubmission } from './test-double.ts';

// --- authority.ts — the composed service ------------------------------------
export { createRiskComplianceAuthority } from './authority.ts';
export type {
  RiskComplianceAuthorityOptions,
  RiskComplianceAuthority,
} from './authority.ts';
