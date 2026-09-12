/**
 * RTN-007 — Queue Authority: the per-domain durable store (the
 * openKernelStore convention, read-only over the DEP-003 database layer).
 *
 * THE CONVENTION (decided in RTN-001 — spec/protocol-runtime-work-orders/
 * README.md, "Persistence convention"):
 *   "each authority domain owns its schema and per-domain migrations inside
 *    its owned prefix, using the DEP-003 database layer read-only."
 *
 * v0.1 permission for this convention — spec/architecture/v0.1/README.md
 * §9, lines 173-174: "This directory defines semantics only; it
 * intentionally prescribes no implementation, storage, or service
 * decomposition."
 *
 * Spec sources of the persisted records:
 *   - liquidity-credit-queues.md lines 163-165 (FulfillmentQueue — the
 *     persisted shape; the exact state machine as a CHECK constraint; the
 *     immutable policy as JSON columns).
 *   - lines 167-175 (QueuedItem — the persisted shape; the derived
 *     (queue id, intent id) item identity and the per-queue sequence as
 *     storage-level UNIQUE constraints, which make INV-8-2's
 *     exactly-one-residency and the deterministic ordering structural).
 *   - lines 182-184 (INV-8-1 — the fixed terms column: canonical Money
 *     JSON, written once at enqueue, never updated).
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openDurableDatabase } from '../../durable/db.ts';
import type { DurableDatabase } from '../../durable/db.ts';
import { isMoney, money } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type {
  FulfillmentQueueRecord,
  QueuedItemRecord,
  QueuePolicy,
} from './types.ts';
import {
  isItemState,
  isQueueReasonCode,
  isQueueState,
} from './types.ts';

/**
 * Default filesystem path of the queues-domain store (mirrors the
 * substrate's var/durable.sqlite and the sibling domains' defaults).
 *
 * Source: the per-domain persistence convention; DEP-003 §2 lines 40-43.
 */
export const DEFAULT_QUEUES_DB_PATH = 'var/queues.sqlite';

/**
 * Environment variable overriding the queues migrations directory.
 *
 * Source: DEP-003 §2 lines 44-47; the per-domain convention.
 */
export const QUEUES_MIGRATIONS_DIR_ENV_VAR = 'PAYSWAP_QUEUES_MIGRATIONS_DIR';

/** The queues domain's owned migration directory, relative to the repository root. */
export const QUEUES_MIGRATIONS_RELATIVE_DIR = join('src', 'lib', 'protocol-runtime', 'queues', 'migrations');

/** The queues domain's owner identity (for rows the domain itself records). */
export const QUEUES_STORE_DOMAIN = 'protocol-runtime-queues';

/**
 * Resolve the queues migrations directory (explicit argument, then the
 * environment variable, then the 8-level walk-up, then the cwd-relative
 * fallback that fails closed inside the runner).
 *
 * Source: DEP-003 migration conventions (spec/durable/execution.md §2/§4);
 * the per-domain persistence convention.
 */
export function resolveQueuesMigrationsDir(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return resolve(explicit);
  }
  const fromEnv = process.env[QUEUES_MIGRATIONS_DIR_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return resolve(fromEnv.trim());
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, QUEUES_MIGRATIONS_RELATIVE_DIR);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(process.cwd(), QUEUES_MIGRATIONS_RELATIVE_DIR);
}

/**
 * Options for opening the queues-domain store.
 *
 * Source: the per-domain persistence convention; option shape mirrors the
 * substrate's DurableDatabaseOptions.
 */
export interface QueuesStoreOptions {
  /** Default: var/queues.sqlite (created on demand; never committed). */
  dbPath?: string;
  /** Explicit migrations directory. Default: resolveQueuesMigrationsDir(). */
  migrationsDir?: string;
}

/**
 * Open the queues-domain store THROUGH the DEP-003 database layer
 * (read-only integration): the substrate's crash-safety pragmas and
 * migration runner over this domain's owned migrations.
 *
 * Source: spec/protocol-runtime-work-orders/README.md "Persistence
 * convention"; spec/durable/execution.md §3/§4.
 */
export function openQueuesStore(options: QueuesStoreOptions = {}): DurableDatabase {
  return openDurableDatabase({
    dbPath: options.dbPath ?? DEFAULT_QUEUES_DB_PATH,
    migrationsDir: resolveQueuesMigrationsDir(options.migrationsDir),
  });
}

// ---------------------------------------------------------------------------
// Write path
// ---------------------------------------------------------------------------

const SQL_INSERT_QUEUE = `
  INSERT INTO fulfillment_queues (
    queue_id, state, ordering_rule, max_wait_epoch_ms, release_conditions,
    next_sequence, created_seq, created_wall_ms, state_seq, state_wall_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (queue_id) DO NOTHING
`;

const SQL_UPDATE_QUEUE = `
  UPDATE fulfillment_queues
  SET state = ?, next_sequence = ?, state_seq = ?, state_wall_ms = ?
  WHERE queue_id = ?
`;

const SQL_INSERT_ITEM = `
  INSERT INTO queued_items (
    item_id, queue_id, intent_id, priority_class, queue_sequence, state,
    terms, enqueued_wall_ms, enqueued_seq, enqueued_wall_ms_seq,
    state_seq, state_wall_ms, linked_operation_id, reason_code
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (item_id) DO NOTHING
`;

const SQL_UPDATE_ITEM = `
  UPDATE queued_items
  SET state = ?, linked_operation_id = ?, reason_code = ?, state_seq = ?, state_wall_ms = ?
  WHERE item_id = ?
`;

/**
 * The outcome of one durable queues-domain write: created is false when
 * the row already existed (the dedupe no-op — the same { created, reason }
 * shape the sibling domains' stores report).
 *
 * Source: INV-8-3 (liquidity-credit-queues.md lines 187-189 — the
 * storage-level dedupe this outcome reports); DEP-003 §6.
 */
export interface QueuesStoreWrite {
  readonly created: boolean;
  readonly reason: 'written' | 'duplicate-no-op';
}

/**
 * Persist one committed queue row (INSERT for creation; UPDATE for state
 * and sequence progression). The policy columns are written ONLY at
 * creation — the policy is immutable.
 *
 * Source: liquidity-credit-queues.md lines 163-165, 173-175.
 */
export function writeQueue(store: DurableDatabase, queue: FulfillmentQueueRecord): QueuesStoreWrite {
  const result = store
    .prepare(SQL_INSERT_QUEUE)
    .run(
      queue.queueId,
      queue.state,
      queue.policy.orderingRule,
      queue.policy.maxWaitEpochMs,
      JSON.stringify(queue.policy.releaseConditions),
      queue.nextSequence,
      queue.createdAt.sequence,
      queue.createdAt.wallMs,
      queue.stateChangedAt.sequence,
      queue.stateChangedAt.wallMs,
    );
  if (Number(result.changes) === 1) {
    return { created: true, reason: 'written' };
  }
  store
    .prepare(SQL_UPDATE_QUEUE)
    .run(queue.state, queue.nextSequence, queue.stateChangedAt.sequence, queue.stateChangedAt.wallMs, queue.queueId);
  return { created: false, reason: 'written' };
}

/**
 * Persist one committed item row (INSERT for the enqueue — the terms
 * column is written once, INV-8-1; UPDATE for the state progression).
 *
 * Source: liquidity-credit-queues.md lines 167-175, 182-184.
 */
export function writeQueuedItem(store: DurableDatabase, item: QueuedItemRecord): QueuesStoreWrite {
  const result = store
    .prepare(SQL_INSERT_ITEM)
    .run(
      item.itemId,
      item.queueId,
      item.intentId,
      item.priorityClass,
      item.queueSequence,
      item.state,
      JSON.stringify(item.terms),
      item.enqueuedAtWallMs,
      item.enqueuedAt.sequence,
      item.enqueuedAt.wallMs,
      item.stateChangedAt.sequence,
      item.stateChangedAt.wallMs,
      item.linkedOperationId ?? null,
      item.reasonCode ?? null,
    );
  if (Number(result.changes) === 1) {
    return { created: true, reason: 'written' };
  }
  store
    .prepare(SQL_UPDATE_ITEM)
    .run(
      item.state,
      item.linkedOperationId ?? null,
      item.reasonCode ?? null,
      item.stateChangedAt.sequence,
      item.stateChangedAt.wallMs,
      item.itemId,
    );
  return { created: false, reason: 'written' };
}

// ---------------------------------------------------------------------------
// Read path (GC-1 holds: every Money column re-mints through money())
// ---------------------------------------------------------------------------

function parseMoneyColumn(value: unknown, label: string): Money {
  if (typeof value !== 'string') {
    throw new TypeError(`queues store: the ${label} column must hold canonical Money JSON`);
  }
  const parsed: unknown = JSON.parse(value);
  if (!isMoney(parsed)) {
    throw new TypeError(`queues store: the ${label} column is not a well-formed Money value (GC-1)`);
  }
  return money(parsed.currency, parsed.amountMinor, parsed.scale);
}

function parseTime(seq: unknown, wallMs: unknown, label: string): ProtocolTime {
  if (typeof seq !== 'number' || typeof wallMs !== 'number') {
    throw new TypeError(`queues store: the ${label} time columns are malformed`);
  }
  return protocolTime(seq, wallMs);
}

function parsePolicy(row: Record<string, unknown>): QueuePolicy {
  const conditions: unknown = JSON.parse(String(row['release_conditions']));
  if (conditions === null || typeof conditions !== 'object') {
    throw new TypeError('queues store: the release_conditions column is malformed');
  }
  const candidate = conditions as Partial<{
    requiredCapabilityTier: unknown;
    minLiquidityAvailable: unknown;
    minCreditRemaining: unknown;
  }>;
  const orderingRule = String(row['ordering_rule']);
  if (orderingRule !== 'PRIORITY_CLASS_THEN_SEQUENCE_NUMBER') {
    throw new TypeError(`queues store: unknown ordering rule ${orderingRule}`);
  }
  return {
    orderingRule,
    maxWaitEpochMs: Number(row['max_wait_epoch_ms']),
    releaseConditions: {
      ...(typeof candidate.requiredCapabilityTier === 'string'
        ? { requiredCapabilityTier: candidate.requiredCapabilityTier }
        : {}),
      ...(candidate.minLiquidityAvailable === undefined
        ? {}
        : { minLiquidityAvailable: parseMoneyValue(candidate.minLiquidityAvailable, 'minLiquidityAvailable') }),
      ...(candidate.minCreditRemaining === undefined
        ? {}
        : { minCreditRemaining: parseMoneyValue(candidate.minCreditRemaining, 'minCreditRemaining') }),
    },
  };
}

function parseMoneyValue(value: unknown, label: string): Money {
  if (!isMoney(value)) {
    throw new TypeError(`queues store: the ${label} value is not a well-formed Money value (GC-1)`);
  }
  return money(value.currency, value.amountMinor, value.scale);
}

/**
 * Read every queue row. Source: liquidity-credit-queues.md lines 163-165,
 * 173-175.
 */
export function readQueues(store: DurableDatabase): readonly FulfillmentQueueRecord[] {
  const rows = store.prepare('SELECT * FROM fulfillment_queues ORDER BY created_seq, queue_id').all() as Record<
    string,
    unknown
  >[];
  return rows.map((row) => ({
    queueId: String(row['queue_id']),
    state: assertQueueState(row['state']),
    policy: parsePolicy(row),
    nextSequence: Number(row['next_sequence']),
    createdAt: parseTime(row['created_seq'], row['created_wall_ms'], 'createdAt'),
    stateChangedAt: parseTime(row['state_seq'], row['state_wall_ms'], 'stateChangedAt'),
  }));
}

/**
 * Read every item row (the terms column re-minted through the kernel
 * guards — GC-1 holds on the read path).
 *
 * Source: liquidity-credit-queues.md lines 167-175, 182-184.
 */
export function readQueuedItems(store: DurableDatabase): readonly QueuedItemRecord[] {
  const rows =
    store.prepare('SELECT * FROM queued_items ORDER BY queue_id, queue_sequence').all() as Record<
      string,
      unknown
    >[];
  return rows.map((row) => {
    const terms: unknown = JSON.parse(String(row['terms']));
    if (terms === null || typeof terms !== 'object') {
      throw new TypeError('queues store: the terms column is malformed');
    }
    const termsCandidate = terms as Partial<{ intentId: unknown; terms: unknown }>;
    const linkedOperationId = row['linked_operation_id'];
    const reasonCode = row['reason_code'];
    return {
      itemId: String(row['item_id']),
      queueId: String(row['queue_id']),
      intentId: String(row['intent_id']),
      priorityClass: Number(row['priority_class']),
      queueSequence: Number(row['queue_sequence']),
      state: assertItemState(row['state']),
      terms: {
        intentId: String(termsCandidate.intentId),
        terms: parseMoneyValue(termsCandidate.terms, 'terms'),
      },
      enqueuedAtWallMs: Number(row['enqueued_wall_ms']),
      enqueuedAt: parseTime(row['enqueued_seq'], row['enqueued_wall_ms_seq'], 'enqueuedAt'),
      stateChangedAt: parseTime(row['state_seq'], row['state_wall_ms'], 'stateChangedAt'),
      ...(typeof linkedOperationId === 'string' ? { linkedOperationId } : {}),
      ...(reasonCode === null || reasonCode === undefined
        ? {}
        : { reasonCode: assertReasonCode(reasonCode) }),
    } as QueuedItemRecord;
  });
}

function assertQueueState(value: unknown): FulfillmentQueueRecord['state'] {
  if (!isQueueState(value)) {
    throw new TypeError(`queues store: unknown queue state ${JSON.stringify(value)}`);
  }
  return value;
}

function assertItemState(value: unknown): QueuedItemRecord['state'] {
  if (!isItemState(value)) {
    throw new TypeError(`queues store: unknown item state ${JSON.stringify(value)}`);
  }
  return value;
}

function assertReasonCode(value: unknown): QueuedItemRecord['reasonCode'] {
  if (!isQueueReasonCode(value)) {
    throw new TypeError(`queues store: unknown reason code ${JSON.stringify(value)}`);
  }
  return value;
}
