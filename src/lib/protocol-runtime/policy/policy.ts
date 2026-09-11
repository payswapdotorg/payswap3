/**
 * RTN-005 — Fulfillment Policy Authority: public barrel.
 *
 * Owned surface: src/lib/protocol-runtime/policy/ (work order RTN-005,
 * area 2). Every export cites its spec/architecture/v0.1/ source in its
 * module's doc-comments and in CONTRACT-REVIEW.md (this directory).
 *
 * This barrel materializes the A02 Fulfillment Policy Authority: the
 * FulfillmentPolicy lifecycle (AUTHORED -> VERSIONED -> ATTACHED, fixed per
 * intent), the PolicyEvaluation machine (EVALUATED -> CONSUMED) as a PURE
 * function of (policy version, intent terms, capability snapshot), INV-2-1
 * (Money ceilings, integer comparisons, purity), INV-2-2 (recorded
 * snapshot id), INV-2-3 (one evaluation id per (intent, policy version,
 * snapshot id)), the reason-coded POLICY_UNSATISFIABLE failure, and A02's
 * evidence records (POLICY_ATTACHED / POLICY_EVALUATED) submitted to the
 * REAL RTN-002 A15 log.
 *
 * Runtime note: loadable in plain Node with type stripping (explicit .ts
 * specifiers); the bun test suites import leaf modules directly because
 * Bun 1.3.14 does not implement node:sqlite — the same split the sibling
 * domains observe.
 */

// --- types.ts — the A02 vocabulary and state machine tables -----------------
export {
  POLICY_STATES,
  POLICY_TRANSITIONS,
  POLICY_EVALUATION_STATES,
  POLICY_EVALUATION_TRANSITIONS,
  POLICY_ORDERINGS,
  POLICY_REASON_CODES,
  POLICY_REJECTION_CODES,
  isPolicyState,
  canTransitionPolicy,
  isPolicyEvaluationState,
  canTransitionPolicyEvaluation,
  isPolicyOrdering,
  isPolicyReasonCode,
} from './types.ts';
export type {
  PolicyState,
  PolicyEvaluationState,
  PolicyOrdering,
  PolicyReasonCode,
  FulfillmentPolicyDefinition,
  FulfillmentPolicyRecord,
  IntentTerms,
  RouteRequirement,
  ConstraintEnvelope,
  PolicyEvaluationResult,
  PolicyEvaluationOutcome,
  PolicyEvaluationRecord,
  PolicyRejectionCode,
  PolicyCommandResult,
  PolicySnapshotInput,
} from './types.ts';

// --- evaluation.ts — the pure INV-2-1 evaluation and its hashes -------------
export {
  POLICY_EVALUATION_HASH_FORMAT_VERSION,
  fulfillmentPolicyDefinition,
  mergedAllowedRails,
  mergedCostCeiling,
  mergedDeadline,
  evaluateFulfillmentPolicy,
  rankRouteRequirements,
  canonicalPolicyEvaluationOutcome,
  policyEvaluationResultHash,
  canonicalPolicyDefinition,
  policyDefinitionHash,
} from './evaluation.ts';

// --- state-machine.ts — pure transition application -------------------------
export {
  transitionFulfillmentPolicy,
  transitionPolicyEvaluation,
} from './state-machine.ts';

// --- serializer.ts — INV-2-3 keyed serialization ----------------------------
export { KeyedSerializer } from './serializer.ts';

// --- evidence.ts — A02 records through the port to the real log -------------
export {
  POLICY_AUTHORITY_ID,
  POLICY_EVIDENCE_VOCABULARY,
  policyAttachedEvidence,
  policyEvaluatedEvidence,
  submitPolicyEvidence,
} from './evidence.ts';

// --- authority.ts — the composed single-writer command surface --------------
export { PolicyAuthority } from './authority.ts';
export type { PolicyAuthorityDeps } from './authority.ts';

// --- persistence.ts — the policy-domain store (DEP-003, read-only) ----------
export {
  DEFAULT_POLICY_DB_PATH,
  POLICY_MIGRATIONS_DIR_ENV_VAR,
  POLICY_MIGRATIONS_RELATIVE_DIR,
  POLICY_STORE_DOMAIN,
  resolvePolicyMigrationsDir,
  openPolicyStore,
  writeFulfillmentPolicy,
  savePolicyState,
  writePolicyEvaluation,
  savePolicyEvaluationState,
  readFulfillmentPolicies,
  readPolicyEvaluations,
} from './persistence.ts';
export type { PolicyStoreOptions, PolicyStoreWrite } from './persistence.ts';
