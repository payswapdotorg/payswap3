/**
 * RTN-008 — Clearing Authority: public barrel.
 *
 * Owned surface: src/lib/protocol-runtime/clearing/ (work order RTN-008,
 * area 9). Every export cites its spec/architecture/v0.1/ source in its
 * module's doc-comments and in CONTRACT-REVIEW.md (this directory).
 *
 * This barrel materializes the A09 Clearing Authority: ClearingBatch
 * (OPEN -> STAGED -> COMMITTED -> FINAL; contents immutable after
 * STAGED), ClearingRecord (ACCEPTED -> STAGED | QUARANTINED; quarantined
 * records never produce obligations and are never dropped), INV-9-1
 * (integer Money; per-currency integer summation checks at staging;
 * commit only if every included record passes), INV-9-2 (batches
 * processed in sequence order — rank monotonicity over the batch
 * sequence; origin-activity-id dedup keys; a committed batch produces
 * each obligation exactly once), INV-9-3 (re-commit of the same batch id
 * is a no-op returning the recorded result), the upstream-UNKNOWN
 * clearability gate ("any upstream UNKNOWN ... must already be resolved
 * by area 14 before the activity becomes clearable"), and the A09
 * evidence set (BATCH_STAGED / BATCH_COMMITTED / RECORD_QUARANTINED)
 * submitted to the REAL RTN-002 A15 log. The Clearing Authority is "the
 * only creator of obligation creation instructions" — the instructions
 * flow to the area-10 sink (this work order's sibling surface,
 * obligations/).
 *
 * Runtime note: loadable in plain Node with type stripping (explicit .ts
 * specifiers); the bun test suites import leaf modules directly because
 * Bun does not implement node:sqlite — the persistence bridge is
 * exercised by the node harness
 * scripts/test_protocol_clearing_obligations.mjs (the same split the
 * sibling domains observe).
 */

// --- types.ts — the A09 vocabulary, state machine tables, records -----
export {
  BATCH_STATES,
  BATCH_TRANSITIONS,
  RECORD_STATES,
  RECORD_TRANSITIONS,
  CLEARING_REASON_CODES,
  CLEARING_REJECTION_CODES,
  CLEARING_ORIGIN_KINDS,
  isBatchState,
  canTransitionBatch,
  batchStateRank,
  isRecordState,
  canTransitionRecord,
  isClearingReasonCode,
  isClearingRejectionCode,
  isClearingOriginKind,
} from './types.ts';
export type {
  BatchState,
  RecordState,
  ClearingReasonCode,
  ClearingRejectionCode,
  ClearingOriginKind,
  ClearingOriginReference,
  ClearingParties,
  ClearingRecord,
  ClearingBatchRecord,
  BatchCommitResult,
  ClearingCommandResult,
} from './types.ts';

// --- state-machine.ts — pure transition application --------------------
export { transitionBatch, transitionRecord, clearingTime } from './state-machine.ts';

// --- serializer.ts — the single-lane serialization (INV-9-2) -----------
export { KeyedSerializer } from './serializer.ts';

// --- summation.ts — INV-9-1 validation + derived identity --------------
export {
  CLEARING_DERIVATION_DOMAIN,
  clearingRecordId,
  clearingBatchId,
  batchCommitIdempotencyKey,
  hashStagedContents,
  validateClearingRecord,
  stagedPerCurrencyTotals,
  totalsToMap,
  canonicalTotalsJson,
} from './summation.ts';
export type { RecordValidationOutcome } from './summation.ts';

// --- evidence.ts — the A09 named evidence set ---------------------------
export {
  CLEARING_AUTHORITY_ID,
  CLEARING_EVIDENCE_VOCABULARY,
  batchStagedEvidence,
  batchCommittedEvidence,
  recordQuarantinedEvidence,
  submitClearingEvidence,
} from './evidence.ts';

// --- authority.ts — the composed command surface -------------------------
export { ClearingAuthority } from './authority.ts';
export type {
  ObligationCreationInstruction,
  ObligationCreationOutcome,
  ObligationLedgerSink,
  ClearabilityProbe,
  ClearingAuthorityDeps,
  ClearingRecordInput,
} from './authority.ts';

// --- persistence.ts — the per-domain durable store -----------------------
export {
  DEFAULT_CLEARING_DB_PATH,
  CLEARING_MIGRATIONS_DIR_ENV_VAR,
  CLEARING_MIGRATIONS_RELATIVE_DIR,
  CLEARING_STORE_DOMAIN,
  resolveClearingMigrationsDir,
  openClearingStore,
  writeBatch,
  writeRecords,
  readBatches,
  readRecords,
} from './persistence.ts';
export type { ClearingStoreOptions, ClearingStoreWrite } from './persistence.ts';
