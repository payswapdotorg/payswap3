/**
 * RTN-007 — Credit Authority: public barrel.
 *
 * Owned surface: src/lib/protocol-runtime/credit/ (work order RTN-007,
 * area 7). Every export cites its spec/architecture/v0.1/ source in its
 * module's doc-comments and in CONTRACT-REVIEW.md (this directory).
 *
 * This barrel materializes the A07 Credit Authority: CreditLine (OFFERED
 * -> ACTIVE -> SUSPENDED -> terminal(CLOSED), exact chain), CreditExposure
 * (the current outstanding amount on the line, mutated only through area
 * 5 reservations — the line IS the RTN-006 ledger resource with declared
 * total = limit, so INV-7-1 "exposure never exceeds the line limit" is
 * exactly the ledger's INV-5-1 available >= 0, atomic under area-5
 * serialization by construction), and CreditDecision (EVALUATED ->
 * APPLIED, keyed by (intent id, line id) — INV-7-3; APPROVED with an
 * exact integer amount or DENIED with reason). Evidence:
 * CREDIT_LINE_STATE_CHANGED, CREDIT_DECIDED, EXPOSURE_CHANGED
 * (post-transition integer arithmetic proofs) submitted to the REAL
 * RTN-002 A15 log.
 *
 * Runtime note: loadable in plain Node with type stripping (explicit .ts
 * specifiers); the bun test suites import leaf modules directly because
 * Bun 1.3.14 does not implement node:sqlite — the same split the sibling
 * domains observe (the persistence bridge is exercised by the node
 * harness scripts/test_protocol_liquidity_credit_queues.mjs).
 */

// --- types.ts — the A07 vocabulary, state machine tables, records ------
export {
  CREDIT_LINE_STATES,
  CREDIT_LINE_TRANSITIONS,
  CREDIT_DECISION_STATES,
  CREDIT_REASON_CODES,
  CREDIT_REJECTION_CODES,
  isCreditLineState,
  canTransitionCreditLine,
  isCreditDecisionState,
  isCreditReasonCode,
  isCreditRejectionCode,
} from './types.ts';
export type {
  CreditLineState,
  CreditDecisionState,
  CreditReasonCode,
  CreditLineRecord,
  CreditExposureView,
  CreditDecisionOutcome,
  CreditDecisionRecord,
  CreditRejectionCode,
  CreditCommandResult,
  ApplyCreditDecisionResult,
} from './types.ts';

// --- state-machine.ts — pure transition application --------------------
export { transitionCreditLine, transitionCreditDecision } from './state-machine.ts';

// --- exposure.ts — the pure INV-7-1 arithmetic + identity hashes --------
export {
  EXPOSURE_ARITHMETIC_IDENTITY_HASH_FORMAT_VERSION,
  exposureFromAccounting,
  zeroExposure,
  exposureInvariantHolds,
  canonicalExposureAccounting,
  exposureArithmeticIdentityHash,
  canonicalCreditDecision,
  creditDecisionIdentityHash,
} from './exposure.ts';

// --- serializer.ts — keyed serialization (INV-7-2) ----------------------
export { KeyedSerializer } from './serializer.ts';

// --- evidence.ts — A07 records through the port to the real log --------
export {
  CREDIT_AUTHORITY_ID,
  CREDIT_EVIDENCE_VOCABULARY,
  creditLineStateChangedEvidence,
  creditDecidedEvidence,
  exposureChangedEvidence,
  submitCreditEvidence,
} from './evidence.ts';

// --- authority.ts — the Credit Authority (single writer) ---------------
export { CreditAuthority, creditLineResourceId } from './authority.ts';
export type { CreditAuthorityDeps, CreditRejection } from './authority.ts';

// --- persistence.ts — the per-domain durable store (DEP-003 read-only) --
export {
  DEFAULT_CREDIT_DB_PATH,
  CREDIT_MIGRATIONS_DIR_ENV_VAR,
  CREDIT_MIGRATIONS_RELATIVE_DIR,
  CREDIT_STORE_DOMAIN,
  resolveCreditMigrationsDir,
  openCreditStore,
  writeCreditLine,
  writeCreditDecision,
  writeCreditExposure,
  readCreditLines,
  readCreditDecisions,
  readCreditExposure,
} from './persistence.ts';
export type { CreditStoreOptions, CreditStoreWrite } from './persistence.ts';
