/**
 * RTN-008 — Obligation Ledger Authority: public barrel.
 *
 * Owned surface: src/lib/protocol-runtime/obligations/ (work order
 * RTN-008, area 10). Every export cites its spec/architecture/v0.1/
 * source in its module's doc-comments and in CONTRACT-REVIEW.md (this
 * directory).
 *
 * This barrel materializes the A10 Obligation Ledger Authority: the
 * Obligation machine (CREATED -> NETTED -> SETTLEMENT_PENDING ->
 * terminal(SETTLED | DISPUTED | WRITTEN_OFF | CANCELLED) with the exact
 * condition-driven transition semantics), the ObligationLedger
 * (append-only, totally sequenced log — the protocol's single financial
 * truth, GC-4), INV-10-1 (amount mutation unrepresentable; corrections
 * are new linked obligations), INV-10-2 (serialized by sequence; at most
 * one transition per state), INV-10-3 (creation keyed by origin record
 * id; duplicates no-ops), INV-10-4 (the machine-checked authority gate:
 * only clearing commits, dispute outcomes, and risk write-offs create or
 * terminalize obligations), the UNKNOWN-settlement hold (the obligation
 * remains SETTLEMENT_PENDING unchanged until reconciliation resolves the
 * rail operation — GC-2), and the A10 evidence set (OBLIGATION_CREATED /
 * OBLIGATION_STATE_CHANGED / OBLIGATION_WRITTEN_OFF with terms hashes)
 * submitted to the REAL RTN-002 A15 log.
 *
 * Runtime note: loadable in plain Node with type stripping (explicit .ts
 * specifiers); the bun test suites import leaf modules directly because
 * Bun does not implement node:sqlite — the persistence bridge is
 * exercised by the node harness
 * scripts/test_protocol_clearing_obligations.mjs (the same split the
 * sibling domains observe).
 */

// --- types.ts — the A10 vocabulary, machines, gate, record shapes ------
export {
  OBLIGATION_STATES,
  OBLIGATION_TRANSITIONS,
  OBLIGATION_TERMINAL_STATES,
  OBLIGATION_INSTRUCTION_KINDS,
  INV_10_4_AUTHORITY_GATE,
  OBLIGATION_REASON_CODES,
  OBLIGATION_REJECTION_CODES,
  isObligationState,
  canTransitionObligation,
  isObligationTerminalState,
  isObligationInstructionKind,
  inv10_4CreationKinds,
  inv10_4TerminalKindFor,
  isObligationReasonCode,
  isObligationRejectionCode,
} from './types.ts';
export type {
  ObligationState,
  ObligationTerminalState,
  ObligationInstructionKind,
  ObligationTerms,
  ObligationOrigin,
  ObligationRecord,
  ObligationCreatedEntry,
  ObligationTransitionedEntry,
  ObligationLedgerEntry,
  ObligationReasonCode,
  ObligationRejectionCode,
  ObligationCommandResult,
} from './types.ts';

// --- state-machine.ts — pure transitions + derived identity ------------
export {
  OBLIGATION_DERIVATION_DOMAIN,
  obligationIdForOriginRecord,
  obligationIdForDisputeReplacement,
  hashObligationTerms,
  transitionObligation,
  obligationTime,
} from './state-machine.ts';

// --- ledger.ts — the append-only, totally sequenced log -----------------
export { ObligationLedger } from './ledger.ts';

// --- serializer.ts — the single-lane serialization (INV-10-2) -------------
export { KeyedSerializer } from './serializer.ts';

// --- evidence.ts — the A10 named evidence set ---------------------------
export {
  OBLIGATION_AUTHORITY_ID,
  OBLIGATION_EVIDENCE_VOCABULARY,
  obligationCreatedEvidence,
  obligationStateChangedEvidence,
  obligationWrittenOffEvidence,
  transitionEvidence,
  submitObligationEvidence,
} from './evidence.ts';

// --- authority.ts — the closed INV-10-4 command surface ------------------
export { ObligationLedgerAuthority } from './authority.ts';
export type {
  ClearingCreationInstruction,
  ClearingCorrectionCancelInstruction,
  DisputeOpenInstruction,
  DisputeResolutionInstruction,
  RiskWriteOffInstruction,
  NettingCommitInstruction,
  SettlementInstructionApplied,
  SettlementFinalityInstruction,
  ObligationWriteInstruction,
  SettlementHoldProbe,
  ObligationLedgerAuthorityDeps,
  ClearingCreationOutcome,
} from './authority.ts';

// --- persistence.ts — the per-domain durable store -----------------------
export {
  DEFAULT_OBLIGATIONS_DB_PATH,
  OBLIGATIONS_MIGRATIONS_DIR_ENV_VAR,
  OBLIGATIONS_MIGRATIONS_RELATIVE_DIR,
  OBLIGATIONS_STORE_DOMAIN,
  resolveObligationsMigrationsDir,
  openObligationsStore,
  writeEntry,
  readEntries,
} from './persistence.ts';
export type { ObligationsStoreOptions, ObligationStoreWrite } from './persistence.ts';
