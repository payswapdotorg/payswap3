/**
 * RTN-005 — Capability Authority: public barrel.
 *
 * Owned surface: src/lib/protocol-runtime/capability/ (work order RTN-005,
 * area 3). Every export cites its spec/architecture/v0.1/ source in its
 * module's doc-comments and in CONTRACT-REVIEW.md (this directory).
 *
 * This barrel materializes the A03 Capability Authority: the Capability
 * state machine (REGISTERED -> ACTIVE -> DEGRADED -> RETIRED; degraded
 * capabilities accept no new commitments), the Commitment machine (OFFERED
 * -> RESERVED -> CONSUMED | EXPIRED | RELEASED; CONSUMED terminal and
 * exactly-once), the immutable sequenced CapabilitySnapshot, INV-3-1/2/3
 * (integer Money capacity bound, per-(capability, intent) serialization
 * with atomic accounting, commitment ids derived from (intent id,
 * capability id)), compliance gating before ACTIVATION through the RTN-003
 * gate interface, and A03's evidence records (with capacity arithmetic in
 * the proof field) submitted to the REAL RTN-002 A15 log.
 *
 * Runtime note: loadable in plain Node with type stripping (explicit .ts
 * specifiers); the bun test suites import leaf modules directly because
 * Bun 1.3.14 does not implement node:sqlite — the same split the sibling
 * domains observe.
 */

// --- types.ts — the A03 vocabulary and state machine tables -----------------
export {
  CAPABILITY_STATES,
  CAPABILITY_TRANSITIONS,
  COMMITMENT_STATES,
  COMMITMENT_TRANSITIONS,
  CAPABILITY_REJECTION_CODES,
  isCapabilityState,
  isCommitmentState,
  canTransitionCapability,
  canTransitionCommitment,
} from './types.ts';
export type {
  CapabilityState,
  CommitmentState,
  Corridor,
  CapabilityDeclaration,
  CapabilityRecord,
  CommitmentRecord,
  CapabilitySnapshotEntry,
  CapabilitySnapshot,
  CapabilityRejectionCode,
  CapabilityCommandResult,
} from './types.ts';

// --- capacity.ts — the pure INV-3-1 accounting ------------------------------
export {
  initialAccounting,
  capacityInvariantHolds,
  availableCapacity,
  applyReservation,
  applyConsumption,
  applyRelease,
  isZeroAccounting,
  capacityArithmeticProof,
} from './capacity.ts';
export type { CapabilityAccounting } from './capacity.ts';

// --- state-machine.ts — pure transition application + degradation rules ----
export {
  transitionCapability,
  transitionCommitment,
  acceptsNewCommitments,
  isInvalidatedByDegradation,
  isExpiredAt,
} from './state-machine.ts';

// --- serializer.ts — INV-3-2 keyed serialization ----------------------------
export { KeyedSerializer } from './serializer.ts';

// --- evidence.ts — A03 records through the port to the real log -------------
export {
  CAPABILITY_AUTHORITY_ID,
  CAPABILITY_EVIDENCE_VOCABULARY,
  CAPABILITY_DECLARATION_HASH_FORMAT_VERSION,
  canonicalCapabilityDeclaration,
  capabilityDeclarationHash,
  capabilityRegisteredEvidence,
  capabilityStateChangedEvidence,
  commitmentEvidence,
  submitCapabilityEvidence,
} from './evidence.ts';

// --- authority.ts — the composed single-writer command surface --------------
export { CapabilityAuthority } from './authority.ts';
export type {
  CapabilityActivationGate,
  CapabilityAuthorityDeps,
} from './authority.ts';

// --- persistence.ts — the capability-domain store (DEP-003, read-only) ------
export {
  DEFAULT_CAPABILITY_DB_PATH,
  CAPABILITY_MIGRATIONS_DIR_ENV_VAR,
  CAPABILITY_MIGRATIONS_RELATIVE_DIR,
  CAPABILITY_STORE_DOMAIN,
  resolveCapabilityMigrationsDir,
  openCapabilityStore,
  writeCapabilityRecord,
  saveCapabilityState,
  writeCommitmentRecord,
  saveCommitmentState,
  writeCapabilitySnapshot,
  readCapabilities,
  readCommitments,
  readCapabilitySnapshots,
} from './persistence.ts';
export type { CapabilityStoreOptions, CapabilityStoreWrite } from './persistence.ts';
