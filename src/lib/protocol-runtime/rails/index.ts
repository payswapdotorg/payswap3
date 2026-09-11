/**
 * RTN-004 — Rails public barrel (areas 13-14).
 *
 * Owned surface: src/lib/protocol-runtime/rails/ (work order RTN-004).
 * Every export cites its spec/architecture/v0.1/ source in its module's
 * doc-comments and in CONTRACT-REVIEW.md (this directory).
 *
 * The surface materializes:
 *   - A13 Rail Adapter Authority semantics: the RailAdapter and
 *     RailOperation state machines as protocol-owned authority state, the
 *     transmission-and-reporting-only adapter interface (simulated rails
 *     in-process; no egress, no credentials — topology.md's simulation
 *     rule), deterministic rail idempotency keys, payload-hash discipline,
 *     and the INV-13-4 no-guessing report mapping.
 *   - A14 Reconciliation Authority semantics: cases, cycles, sources, and
 *     adjustments — the ONLY exit from UNKNOWN (GC-2), with exactly-once
 *     resolution and history-never-mutated adjustments.
 *
 * The EvidenceSubmission port is consumed WRITER-BY-SUBMISSION only (the
 * kernel's type-only declaration; RTN-002 owns the log — this surface
 * tests against an owned in-surface test double per the wave's evidence
 * discipline, and RTN-012 proves the real-log integration).
 *
 * Runtime note: like the kernel barrel, this barrel stays loadable in
 * plain Node with type stripping (every intra-surface runtime import uses
 * an explicit `.ts` specifier; the only cross-layer runtime import is
 * store.ts → src/lib/durable/db.ts, read-only).
 */

// --- A13/A14 core state machines and record types ------------------------
export {
  RAIL_ADAPTER_TRANSITIONS,
  RAIL_OPERATION_TRANSITIONS,
  RECONCILIATION_CASE_TRANSITIONS,
  RECONCILIATION_CYCLE_TRANSITIONS,
  isRailAdapterStatus,
  isRailOperationStatus,
  isRailReportClass,
  isReconciliationCaseStatus,
  isReconciliationCycleStatus,
} from './types.ts';
export type {
  RailAdapterStatus,
  RailOperationStatus,
  RailReportClass,
  RailOperationPayload,
  RailAdapterRecord,
  RailOperationRecord,
  RailResultReportRecord,
  ReconciliationCaseStatus,
  ReconciliationCycleStatus,
  ReconciliationCaseOrigin,
  ReconciliationCaseRecord,
  CaseTerminalResolution,
  ResolutionProof,
  RecoveryDirective,
  ReconciliationCycleRecord,
  ReconciliationSourceRecord,
  ExternalStatementRecord,
  ReconciliationAdjustment,
  UnknownCaseOpener,
  RailsCommandResult,
} from './types.ts';

// --- reason codes ----------------------------------------------------------
export { RAILS_REASON_CODES, isRailsReasonCode } from './reason-codes.ts';

// --- payload discipline (INV-13-2) ----------------------------------------
export {
  RAIL_PAYLOAD_ENCODING_VERSION,
  canonicalRailPayload,
  hashRailPayload,
  validateRailOperationPayload,
} from './payload.ts';

// --- the adapter interface + simulated rails (delta 1: transmission-only) --
export {
  submissionReportClass,
  SimulatedRail,
  createSimulatedRailAdapter,
} from './adapters.ts';
export type {
  SimulatedRailScenario,
  SimulatedRailAdapterOptions,
  RailTransmissionRequest,
  RailTransmissionOutcome,
  RailReportEnvelope,
  RailAdapterConnection,
} from './adapters.ts';

// --- deterministic matching (INV-14-4) --------------------------------------
export {
  RAILS_MATCHING_RULE_VERSION,
  matchReconciliationRecords,
  stableStringify,
} from './matching.ts';
export type {
  MatchedPair,
  MatchDiscrepancy,
  MatchOutcome,
} from './matching.ts';

// --- per-domain persistence -------------------------------------------------
export {
  DEFAULT_RAILS_DB_PATH,
  RAILS_MIGRATIONS_DIR_ENV_VAR,
  RAILS_MIGRATIONS_RELATIVE_DIR,
  RAILS_STORE_DOMAIN,
  resolveRailsMigrationsDir,
  openRailsStore,
} from './persistence.ts';
export type { RailsStoreOptions } from './persistence.ts';

// --- the authority-state store ------------------------------------------------
export { RailsStore } from './store.ts';

// --- A13 authority command surface ---------------------------------------------
export { RailAdapterAuthority, RAIL_ADAPTER_AUTHORITY_ID } from './authority.ts';
export type {
  RailAdapterAuthorityDeps,
  SubmitRailOperationOutcome,
} from './authority.ts';

// --- A14 authority command surface ----------------------------------------------
export {
  ReconciliationAuthority,
  RECONCILIATION_AUTHORITY_ID,
} from './reconciliation.ts';
export type {
  ReconciliationAuthorityDeps,
  CaseResolutionInput,
  ResolveCaseOutcome,
  CycleMatchingOutcome,
} from './reconciliation.ts';

// --- composition root ------------------------------------------------------------
export { createRailsAuthorities, openRailsAuthorities } from './runtime.ts';
export type { RailsAuthorities, RailsRuntimeDeps } from './runtime.ts';
