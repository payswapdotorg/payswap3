/**
 * RTN-007 — Queue Authority: public barrel.
 *
 * Owned surface: src/lib/protocol-runtime/queues/ (work order RTN-007,
 * area 8). Every export cites its spec/architecture/v0.1/ source in its
 * module's doc-comments and in CONTRACT-REVIEW.md (this directory).
 *
 * This barrel materializes the A08 Queue Authority: FulfillmentQueue
 * (OPEN -> DRAINING -> PAUSED -> CLOSED, exact chain), QueuedItem
 * (QUEUED -> ELIGIBLE -> DISPATCHED -> terminal(GRADUATED | CANCELLED |
 * EXPIRED), with the waiting-state expiry/cancellation edges the area's
 * own semantics make load-bearing and NO re-queue/re-dispatch edge —
 * INV-8-4 is structural), QueuePolicy (immutable: the fixed
 * priority-class-then-sequence ordering rule, max wait, release
 * conditions), INV-8-1 (terms immutable by construction), INV-8-2
 * (exactly-one residency; serialized-per-queue eligibility; dispatch
 * exactly-once per item id), INV-8-3 (replays return the recorded state),
 * snapshot-driven eligibility (areas 3/6/7 views, never rail probing),
 * and the six ITEM_* evidence records submitted to the REAL RTN-002 A15
 * log.
 *
 * Runtime note: loadable in plain Node with type stripping (explicit .ts
 * specifiers); the bun test suites import leaf modules directly because
 * Bun 1.3.14 does not implement node:sqlite — the same split the sibling
 * domains observe (the persistence bridge is exercised by the node
 * harness scripts/test_protocol_liquidity_credit_queues.mjs).
 */

// --- types.ts — the A08 vocabulary, state machine tables, records ------
export {
  QUEUE_STATES,
  QUEUE_TRANSITIONS,
  ITEM_STATES,
  ITEM_TRANSITIONS,
  QUEUE_ORDERING_RULE,
  QUEUE_REASON_CODES,
  QUEUE_REJECTION_CODES,
  DISPATCH_RESOLUTIONS,
  isQueueState,
  canTransitionQueue,
  isItemState,
  canTransitionItem,
  isQueueReasonCode,
  isQueueRejectionCode,
  isDispatchResolution,
} from './types.ts';
export type {
  QueueState,
  ItemState,
  QueueReasonCode,
  QueueReleaseConditions,
  QueuePolicy,
  FulfillmentQueueRecord,
  FixedIntentTerms,
  QueuedItemRecord,
  ProtocolEligibilitySnapshot,
  QueueRejectionCode,
  QueueCommandResult,
  DispatchResolution,
} from './types.ts';

// --- state-machine.ts — pure transition application --------------------
export { transitionQueue, transitionItem, isItemExpiredAtWallMs } from './state-machine.ts';

// --- ordering.ts — the deterministic ordering + eligibility ------------
export { compareQueuedItems, orderForDispatch, isEligibleUnderSnapshot } from './ordering.ts';

// --- serializer.ts — keyed serialization (INV-8-2) ----------------------
export { KeyedSerializer } from './serializer.ts';

// --- evidence.ts — A08 records through the port to the real log --------
export {
  QUEUE_AUTHORITY_ID,
  QUEUE_EVIDENCE_VOCABULARY,
  itemQueuedEvidence,
  itemEligibleEvidence,
  itemDispatchedEvidence,
  itemGraduatedEvidence,
  itemCancelledEvidence,
  itemExpiredEvidence,
  submitQueueEvidence,
} from './evidence.ts';

// --- authority.ts — the Queue Authority (single writer) ----------------
export { QueueAuthority } from './authority.ts';
export type { QueueAuthorityDeps, QueueRejection } from './authority.ts';

// --- persistence.ts — the per-domain durable store (DEP-003 read-only) --
export {
  DEFAULT_QUEUES_DB_PATH,
  QUEUES_MIGRATIONS_DIR_ENV_VAR,
  QUEUES_MIGRATIONS_RELATIVE_DIR,
  QUEUES_STORE_DOMAIN,
  resolveQueuesMigrationsDir,
  openQueuesStore,
  writeQueue,
  writeQueuedItem,
  readQueues,
  readQueuedItems,
} from './persistence.ts';
export type { QueuesStoreOptions, QueuesStoreWrite } from './persistence.ts';
