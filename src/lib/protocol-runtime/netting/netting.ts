/**
 * RTN-009 — Netting Authority: public barrel.
 *
 * Owned surface: src/lib/protocol-runtime/netting/ (work order RTN-009,
 * area 11). Every export cites its spec/architecture/v0.1/ source in its
 * module's doc-comments and in CONTRACT-REVIEW.md (this directory).
 *
 * This barrel materializes the A11 Netting Authority: the NettingSet
 * machine (OPEN -> COMPUTED -> COMMITTED with the input obligation ids
 * fixed at OPEN), the NetPosition ("per participant, per currency net
 * amount (signed integer Money) after netting, with a breakdown hash
 * proving conservation"), the NettingScope (bilateral — exactly two
 * participants — and multilateral — three or more, defined participant
 * set), INV-11-1 (conservation: the check recorded in the set's proof
 * before commit), INV-11-2 (an obligation belongs to at most one open
 * netting set; membership claimed atomically at OPEN), INV-11-3
 * (computing is a pure function of the fixed input ids + algorithm
 * version; re-commit no-op), the DISPUTED exclusion, the A10 NETTED
 * transitions driven on Netting Authority instruction, and the A11
 * evidence set (NETTING_SET_OPENED / NETTING_COMPUTED /
 * NETTING_COMMITTED) submitted to the REAL RTN-002 A15 log.
 *
 * Runtime note: loadable in plain Node with type stripping (explicit .ts
 * specifiers); the only cross-layer runtime import is persistence.ts →
 * src/lib/durable/db.ts (read-only). The obligations-ledger port is
 * constructor-injected (the merged RTN-008 authority satisfies it
 * structurally); the barrel itself imports obligations types TYPE-ONLY.
 */

// --- types.ts — the A11 vocabulary, machines, records, rejections --------
export {
  NETTING_SET_STATES,
  NETTING_SET_TRANSITIONS,
  BILATERAL_PARTICIPANT_COUNT,
  MULTILATERAL_MIN_PARTICIPANTS,
  NET_OBLIGATION_STATES,
  NET_OBLIGATION_TRANSITIONS,
  NETTING_REJECTION_CODES,
  isNettingSetState,
  canTransitionNettingSet,
  isNetObligationState,
  canTransitionNetObligation,
  isNettingRejectionCode,
} from './types.ts';
export type {
  NettingSetState,
  NettingScope,
  GrossObligationSnapshot,
  NetPosition,
  CurrencyConservationRecord,
  ConservationProof,
  NettingSetRecord,
  NetObligationState,
  NetObligationRecord,
  NettingRejectionCode,
  NettingCommandResult,
  ObligationView,
} from './types.ts';

// --- algorithm.ts — the pure computation + conservation (INV-11-1/11-3) ---
export {
  NETTING_ALGORITHM_VERSION,
  netPositionBreakdownHash,
  conservationProofHash,
  scopeParticipants,
  computeNetPositions,
  buildConservationProof,
  materializeNetObligations,
  verifyConservationProof,
} from './algorithm.ts';
export type { MaterializedNetFlow } from './algorithm.ts';

// --- state-machine.ts — derived identity + pure transitions ---------------
export {
  NETTING_DERIVATION_DOMAIN,
  nettingSetIdForLabel,
  netObligationIdFor,
  mintNettingScope,
  transitionNettingSet,
  transitionNetObligation,
  nettingTime,
} from './state-machine.ts';

// --- evidence.ts — the A11 named evidence set ------------------------------
export {
  NETTING_AUTHORITY_ID,
  NETTING_EVIDENCE_VOCABULARY,
  nettingSetOpenedEvidence,
  nettingComputedEvidence,
  nettingCommittedEvidence,
  submitNettingEvidence,
} from './evidence.ts';

// --- store.ts — the in-process single-writer state store -------------------
export { NettingStore } from './store.ts';

// --- freeze.ts — the value discipline ---------------------------------------
export { deepFreeze } from './freeze.ts';

// --- authority.ts — the composed command surface -----------------------------
export { NettingAuthority } from './authority.ts';
export type {
  NettingObligationLedgerPort,
  NettingAuthorityDeps,
  NettingCommitOutcome,
} from './authority.ts';

// --- persistence.ts — the per-domain durable store ---------------------------
export {
  DEFAULT_NETTING_DB_PATH,
  NETTING_MIGRATIONS_DIR_ENV_VAR,
  NETTING_MIGRATIONS_RELATIVE_DIR,
  NETTING_STORE_DOMAIN,
  resolveNettingMigrationsDir,
  openNettingStore,
  writeNettingSet,
  updateNettingSet,
  writeNetObligation,
  updateNetObligationState,
  readNettingSets,
  readNetObligations,
} from './persistence.ts';
export type { NettingStoreOptions, NettingStoreWrite } from './persistence.ts';
