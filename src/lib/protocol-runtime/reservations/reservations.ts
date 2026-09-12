/**
 * RTN-006 — Reservation Authority: public barrel.
 *
 * Owned surface: src/lib/protocol-runtime/reservations/ (work order
 * RTN-006, area 5). Every export cites its spec/architecture/v0.1/ source
 * in its module's doc-comments and in CONTRACT-REVIEW.md (this
 * directory).
 *
 * This barrel materializes the A05 Reservation Authority: the Reservation
 * state machine (REQUESTED -> HELD -> terminal(CONSUMED | RELEASED |
 * EXPIRED); deadlines deterministic on protocol time), the ReservationLedger
 * as THE concurrency frontier (per-resource serialized append-only log;
 * all resource mutations pass through it in sequence order), INV-5-1
 * (available = declared total - held - consumed, integer Money, asserted
 * after every transition), INV-5-2 (per-resource total order; REQUESTED
 * resolves to HELD or is rejected, never ambiguous), INV-5-3 (ids derived
 * from (intent id, hop id, resource id); exactly-once terminals), the
 * ledger-tail crash recovery (dangling REQUESTEDs rolled forward to HELD
 * or back to RELEASED per the recorded decision, never duplicated), and
 * A05's RESERVATION_* evidence records (proof: ledger sequence number and
 * post-transition arithmetic identity) submitted to the REAL RTN-002 A15
 * log.
 *
 * Runtime note: loadable in plain Node with type stripping (explicit .ts
 * specifiers); the bun test suites import leaf modules directly because
 * Bun 1.3.14 does not implement node:sqlite — the same split the sibling
 * domains observe.
 */

// --- types.ts — the A05 vocabulary, state machine tables, ledger shapes ---
export {
  RESERVATION_STATES,
  RESERVATION_TRANSITIONS,
  RESERVATION_REASON_CODES,
  RESERVATION_ENTRY_KINDS,
  RESERVATION_REJECTION_CODES,
  isReservationState,
  isReservationReasonCode,
  isReservationEntryKind,
  canTransitionReservation,
} from './types.ts';
export type {
  ReservationState,
  ReservationReasonCode,
  ReservationRecord,
  ReservationEntryKind,
  ReservationLedgerEntry,
  ReservationRejectionCode,
  ReservationRequestResult,
  ReservationTerminalCommandResult,
  ResourceDeclarationResult,
  LedgerRecoveryReport,
} from './types.ts';

// --- state-machine.ts — pure transition application + the deadline rule --
export { transitionReservation, isExpiredAt, isRequestedResolution } from './state-machine.ts';

// --- resource.ts — the pure INV-5-1 accounting -----------------------------
export {
  initialResourceAccounting,
  availableResource,
  resourceInvariantHolds,
  applyHold,
  applyTransitionArithmetic,
  coversAmount,
  RESOURCE_ARITHMETIC_IDENTITY_HASH_FORMAT_VERSION,
  canonicalResourceAccounting,
  resourceArithmeticIdentityHash,
} from './resource.ts';
export type { ResourceAccounting } from './resource.ts';

// --- serializer.ts — per-resource keyed serialization ----------------------
export { KeyedSerializer } from './serializer.ts';

// --- evidence.ts — A05 records through the port to the real log ------------
export {
  RESERVATION_AUTHORITY_ID,
  RESERVATION_EVIDENCE_VOCABULARY,
  reservationHeldEvidence,
  reservationConsumedEvidence,
  reservationReleasedEvidence,
  reservationExpiredEvidence,
  submitReservationEvidence,
} from './evidence.ts';

// --- ledger.ts — the ReservationLedger (the concurrency frontier) ----------
export { ReservationLedger, openReservationLedger } from './ledger.ts';
export type { ReservationLedgerDeps, RecoveryAction } from './ledger.ts';

// --- acquisition.ts — the routing-facing ReservationAcquisition port -------
export { createReservationAcquisitionPort } from './acquisition.ts';

// --- persistence.ts — the per-domain durable store (DEP-003 read-only) ----
export {
  DEFAULT_RESERVATIONS_DB_PATH,
  RESERVATIONS_MIGRATIONS_DIR_ENV_VAR,
  RESERVATIONS_MIGRATIONS_RELATIVE_DIR,
  RESERVATIONS_STORE_DOMAIN,
  resolveReservationsMigrationsDir,
  openReservationsStore,
  writeLedgerEntry,
  writeReservationRecord,
  saveReservationState,
  writeResourceRow,
  saveResourceAccounting,
  readLedgerEntries,
  readReservations,
  readResourceAccountings,
  persistLedgerSnapshot,
  accountingFromDeclared,
} from './persistence.ts';
export type { ReservationsStoreOptions, ReservationsStoreWrite } from './persistence.ts';
