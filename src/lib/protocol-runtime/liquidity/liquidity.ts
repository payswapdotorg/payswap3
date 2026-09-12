/**
 * RTN-007 — Liquidity Authority: public barrel.
 *
 * Owned surface: src/lib/protocol-runtime/liquidity/ (work order RTN-007,
 * area 6). Every export cites its spec/architecture/v0.1/ source in its
 * module's doc-comments and in CONTRACT-REVIEW.md (this directory).
 *
 * This barrel materializes the A06 Liquidity Authority: LiquidityPool
 * (OPEN -> FROZEN -> CLOSED, single-currency), LiquidityPosition
 * (AVAILABLE -> RESERVED -> terminal(CONSUMED | RETURNED), driven
 * exclusively by area 5 reservations — the position IS the RTN-006 ledger
 * resource, and the position projection is the pure fold of the ledger's
 * per-resource entry log), FundingEntry exactly-once by derived id
 * (INV-6-3), the UNKNOWN-funding pending reconciliation linkage (GC-2),
 * INV-6-1 (pool total equals the integer sum of positions; per-position
 * available + reserved + consumed exact — asserted after every
 * transition), and A06's POOL_* / POSITION_STATE_CHANGED /
 * FUNDING_RECORDED evidence records (proof: post-transition arithmetic
 * identity) submitted to the REAL RTN-002 A15 log.
 *
 * Runtime note: loadable in plain Node with type stripping (explicit .ts
 * specifiers); the bun test suites import leaf modules directly because
 * Bun 1.3.14 does not implement node:sqlite — the same split the sibling
 * domains observe (the persistence bridge is exercised by the node
 * harness scripts/test_protocol_liquidity_credit_queues.mjs).
 */

// --- types.ts — the A06 vocabulary, state machine tables, records ------
export {
  POOL_STATES,
  POOL_TRANSITIONS,
  POSITION_STATES,
  POSITION_TRANSITIONS,
  LIQUIDITY_REASON_CODES,
  FUNDING_SOURCE_KINDS,
  LIQUIDITY_REJECTION_CODES,
  PENDING_FUNDING_RESOLUTIONS,
  isPoolState,
  canTransitionPool,
  isPositionState,
  canTransitionPosition,
  isLiquidityReasonCode,
  isFundingSourceKind,
  isLiquidityRejectionCode,
  isPendingFundingResolution,
} from './types.ts';
export type {
  PoolState,
  PositionState,
  LiquidityReasonCode,
  FundingSourceKind,
  LiquidityPoolRecord,
  LiquidityPositionRecord,
  FundingSource,
  FundingEntryRecord,
  PendingFundingLinkRecord,
  LiquidityRejectionCode,
  LiquidityCommandResult,
  FundingCommandResult,
  ResolvePendingFundingResult,
  PendingFundingResolution,
} from './types.ts';

// --- state-machine.ts — pure transition application --------------------
export { transitionPool, transitionPosition, positionTransitionTime } from './state-machine.ts';

// --- accounting.ts — the pure INV-6-1 arithmetic + position fold --------
export {
  POSITION_ARITHMETIC_IDENTITY_HASH_FORMAT_VERSION,
  initialPositionFold,
  positionInvariantHolds,
  foldPositionFromEntries,
  poolInvariantHolds,
  sumPositionTotals,
  canonicalPositionAccounting,
  positionArithmeticIdentityHash,
} from './accounting.ts';
export type { PositionFold, PositionLedgerProjection } from './accounting.ts';

// --- serializer.ts — keyed serialization (INV-6-2) ----------------------
export { KeyedSerializer } from './serializer.ts';

// --- evidence.ts — A06 records through the port to the real log --------
export {
  LIQUIDITY_AUTHORITY_ID,
  LIQUIDITY_EVIDENCE_VOCABULARY,
  poolOpenedEvidence,
  poolFrozenEvidence,
  poolClosedEvidence,
  positionStateChangedEvidence,
  fundingRecordedEvidence,
  submitLiquidityEvidence,
} from './evidence.ts';

// --- authority.ts — the Liquidity Authority (single writer) ------------
export { LiquidityAuthority } from './authority.ts';
export type {
  LiquidityAuthorityDeps,
  PositionHoldRecord,
  LiquidityRejection,
} from './authority.ts';

// --- persistence.ts — the per-domain durable store (DEP-003 read-only) --
export {
  DEFAULT_LIQUIDITY_DB_PATH,
  LIQUIDITY_MIGRATIONS_DIR_ENV_VAR,
  LIQUIDITY_MIGRATIONS_RELATIVE_DIR,
  LIQUIDITY_STORE_DOMAIN,
  resolveLiquidityMigrationsDir,
  openLiquidityStore,
  writePool,
  writePosition,
  writeFundingEntry,
  writePendingFundingLink,
  readPools,
  readPositions,
  readFundingEntries,
  readPendingFundingLinks,
} from './persistence.ts';
export type { LiquidityStoreOptions, LiquidityStoreWrite } from './persistence.ts';
