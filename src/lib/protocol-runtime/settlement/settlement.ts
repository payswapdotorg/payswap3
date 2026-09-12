/**
 * RTN-009 — Settlement and Finality Authority: public barrel.
 *
 * Owned surface: src/lib/protocol-runtime/settlement/ (work order
 * RTN-009, area 12 — the apex of the singleFinancialAuthority chain).
 * Every export cites its spec/architecture/v0.1/ source in its module's
 * doc-comments and in CONTRACT-REVIEW.md (this directory).
 *
 * This barrel materializes the A12 Settlement and Finality Authority:
 * the SettlementInstruction machine (CREATED -> ISSUED ->
 * terminal(CONFIRMED | FAILED)); the SettlementAttempt machine (CREATED
 * -> SUBMITTED -> PENDING | terminal(CONFIRMED | FAILED | UNKNOWN),
 * with the UNKNOWN -> {CONFIRMED, FAILED} edges executable only by the
 * reconciliation-resolution consumer) under the INV-12-2 single-attempt
 * rule (at most one live attempt per instruction — blind retry
 * impossible by construction) and INV-12-3 (authorization keyed by
 * instruction id; deterministic rail idempotency keys derived through
 * the kernel identity and passed to the A13 adapter); the FinalityRecord
 * machine (PROVISIONAL -> FINAL — FINAL declared by protocol rule only,
 * exactly-once per settlement subject, irreversible; reversal only as a
 * new obligation via dispute/recourse) under INV-12-4's exclusivity;
 * INV-12-1 (amounts copied verbatim; payload hash recorded and compared
 * on every result); the UNKNOWN durable state (instruction stays ISSUED,
 * obligation stays SETTLEMENT_PENDING, an area-14 case opens
 * automatically — exactly one); the safe-resume consumer for RTN-004's
 * resolution interface; and the A12 evidence set
 * (SETTLEMENT_INSTRUCTION_CREATED / SETTLEMENT_ATTEMPT_AUTHORIZED /
 * SETTLEMENT_ATTEMPT_RESOLVED / FINALITY_DECLARED) submitted to the
 * REAL RTN-002 A15 log.
 *
 * Runtime note: loadable in plain Node with type stripping (explicit .ts
 * specifiers); the only cross-layer runtime imports are persistence.ts →
 * src/lib/durable/db.ts (read-only) and state-machine.ts →
 * rails/payload.ts (the canonical payload encoder — the merged RTN-004
 * module). The rails / obligations / netting ports are
 * constructor-injected (the merged authorities satisfy them
 * structurally; see ports.ts).
 */

// --- types.ts — the A12 vocabulary, machines, records, rejections ---------
export {
  SETTLEMENT_INSTRUCTION_STATES,
  SETTLEMENT_INSTRUCTION_TERMINAL_STATES,
  SETTLEMENT_INSTRUCTION_TRANSITIONS,
  SETTLEMENT_ATTEMPT_STATES,
  SETTLEMENT_ATTEMPT_TRANSITIONS,
  FINALITY_STATES,
  FINALITY_TRANSITIONS,
  SETTLEMENT_REJECTION_CODES,
  settlementSubjectKey,
  isSettlementInstructionState,
  canTransitionSettlementInstruction,
  isSettlementAttemptState,
  canTransitionSettlementAttempt,
  isLiveSettlementAttempt,
  isFinalityState,
  canTransitionFinality,
  isSettlementRejectionCode,
} from './types.ts';
export type {
  SettlementSubject,
  SettlementInstructionState,
  SettlementInstructionRecord,
  SettlementAttemptState,
  SettlementAttemptRecord,
  FinalityState,
  FinalityRecord,
  SettlementRejectionCode,
  SettlementCommandResult,
} from './types.ts';

// --- state-machine.ts — derived identity + the idempotency key -------------
export {
  SETTLEMENT_DERIVATION_DOMAIN,
  settlementInstructionIdFor,
  settlementAttemptIdFor,
  finalityRecordIdFor,
  railIdempotencyKeyForInstruction,
  railOperationIdForInstruction,
  settlementRailPayload,
  settlementPayloadHash,
  transitionSettlementInstruction,
  transitionSettlementAttempt,
  transitionFinality,
  settlementTime,
} from './state-machine.ts';

// --- evidence.ts — the A12 named evidence set -------------------------------
export {
  SETTLEMENT_AUTHORITY_ID,
  SETTLEMENT_EVIDENCE_VOCABULARY,
  settlementInstructionCreatedEvidence,
  settlementAttemptAuthorizedEvidence,
  settlementAttemptResolvedEvidence,
  finalityDeclaredEvidence,
  submitSettlementEvidence,
} from './evidence.ts';

// --- store.ts — the in-process single-writer state store --------------------
export { SettlementStore } from './store.ts';

// --- ports.ts — the composition ports (A13/A14, A10, A11) --------------------
export type {
  SettlementRailsPort,
  SettlementObligationLedgerPort,
  SettlementNettingPort,
} from './ports.ts';
export {
  settlementPortFromAuthorities,
  obligationLedgerPortFromAuthority,
  nettingPortFromAuthority,
} from './ports.ts';

// --- authority.ts — the composed command surface ------------------------------
export { SettlementAuthority } from './authority.ts';
export type { SettlementAuthorityDeps, AttemptOutcomeMirror } from './authority.ts';

// --- persistence.ts — the per-domain durable store ---------------------------
export {
  DEFAULT_SETTLEMENT_DB_PATH,
  SETTLEMENT_MIGRATIONS_DIR_ENV_VAR,
  SETTLEMENT_MIGRATIONS_RELATIVE_DIR,
  SETTLEMENT_STORE_DOMAIN,
  resolveSettlementMigrationsDir,
  openSettlementStore,
  writeInstruction,
  updateInstructionState,
  writeAttempt,
  updateAttemptState,
  writeFinality,
  updateFinalityState,
  readInstructions,
  readAttempts,
  readFinalities,
} from './persistence.ts';
export type { SettlementStoreOptions, SettlementStoreWrite } from './persistence.ts';
