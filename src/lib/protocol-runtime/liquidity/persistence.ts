/**
 * RTN-007 — Liquidity Authority: the per-domain durable store (the
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
 * Mechanically (the kernel's persistence.ts template): one SQLite
 * database opened through the substrate's openDurableDatabase({ dbPath,
 * migrationsDir }), migrations in the owned prefix
 * src/lib/protocol-runtime/liquidity/migrations/, domain database file
 * var/liquidity.sqlite. The substrate supplies WAL, synchronous=FULL,
 * busy_timeout, and the explicit migration runner.
 *
 * Spec sources of the persisted records:
 *   - liquidity-credit-queues.md lines 31-43 (pool, position, FundingEntry
 *     — the persisted shapes), lines 58-60 (INV-6-3 — the storage-level
 *     PRIMARY KEY on funding_entry_id makes the exactly-once funding
 *     contract structural), lines 64-69 (the pending funding linkage —
 *     the UNKNOWN path's durable artifact), lines 52-54 (INV-6-1 — the
 *     CHECK constraint backstop: available + reserved + consumed = total).
 *
 * DEP-003 integration is READ-ONLY: this module imports the db API from
 * src/lib/durable/db.ts and never modifies the substrate.
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
  FundingEntryRecord,
  FundingSource,
  LiquidityPoolRecord,
  LiquidityPositionRecord,
  PendingFundingLinkRecord,
} from './types.ts';
import {
  isFundingSourceKind,
  isPoolState,
  isPositionState,
  isPendingFundingResolution,
} from './types.ts';

/**
 * Default filesystem path of the liquidity-domain store (mirrors the
 * substrate's var/durable.sqlite and the sibling domains' defaults).
 * var/ is a runtime artifact directory and is gitignored.
 *
 * Source: the per-domain persistence convention; DEP-003 §2 lines 40-43.
 */
export const DEFAULT_LIQUIDITY_DB_PATH = 'var/liquidity.sqlite';

/**
 * Environment variable overriding the liquidity migrations directory
 * (mirrors the substrate's PAYSWAP_MIGRATIONS_DIR and the sibling
 * domains' variables).
 *
 * Source: DEP-003 §2 lines 44-47; the per-domain convention.
 */
export const LIQUIDITY_MIGRATIONS_DIR_ENV_VAR = 'PAYSWAP_LIQUIDITY_MIGRATIONS_DIR';

/** The liquidity domain's owned migration directory, relative to the repository root. */
export const LIQUIDITY_MIGRATIONS_RELATIVE_DIR = join(
  'src',
  'lib',
  'protocol-runtime',
  'liquidity',
  'migrations',
);

/** The liquidity domain's owner identity (for rows the domain itself records). */
export const LIQUIDITY_STORE_DOMAIN = 'protocol-runtime-liquidity';

/**
 * Resolve the liquidity migrations directory (explicit argument, then the
 * environment variable, then the 8-level walk-up, then the cwd-relative
 * fallback that fails closed inside the runner) — the same strategy the
 * substrate, the kernel, and the sibling domains use.
 *
 * Source: DEP-003 migration conventions (spec/durable/execution.md §2/§4);
 * the per-domain persistence convention.
 */
export function resolveLiquidityMigrationsDir(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return resolve(explicit);
  }
  const fromEnv = process.env[LIQUIDITY_MIGRATIONS_DIR_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return resolve(fromEnv.trim());
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, LIQUIDITY_MIGRATIONS_RELATIVE_DIR);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(process.cwd(), LIQUIDITY_MIGRATIONS_RELATIVE_DIR);
}

/**
 * Options for opening the liquidity-domain store.
 *
 * Source: the per-domain persistence convention; option shape mirrors the
 * substrate's DurableDatabaseOptions.
 */
export interface LiquidityStoreOptions {
  /** Default: var/liquidity.sqlite (created on demand; never committed). */
  dbPath?: string;
  /** Explicit migrations directory. Default: resolveLiquidityMigrationsDir(). */
  migrationsDir?: string;
}

/**
 * Open the liquidity-domain store THROUGH the DEP-003 database layer
 * (read-only integration): the substrate's crash-safety pragmas and
 * migration runner over this domain's owned migrations.
 *
 * Source: spec/protocol-runtime-work-orders/README.md "Persistence
 * convention"; spec/durable/execution.md §3/§4.
 */
export function openLiquidityStore(options: LiquidityStoreOptions = {}): DurableDatabase {
  return openDurableDatabase({
    dbPath: options.dbPath ?? DEFAULT_LIQUIDITY_DB_PATH,
    migrationsDir: resolveLiquidityMigrationsDir(options.migrationsDir),
  });
}

// ---------------------------------------------------------------------------
// Write path (the durable side of the authority's committed artifacts)
// ---------------------------------------------------------------------------

const SQL_INSERT_POOL = `
  INSERT INTO liquidity_pools (
    pool_id, currency, scale, state, total_minor, opened_seq, opened_wall_ms,
    state_seq, state_wall_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (pool_id) DO NOTHING
`;

const SQL_UPDATE_POOL = `
  UPDATE liquidity_pools
  SET state = ?, total_minor = ?, state_seq = ?, state_wall_ms = ?
  WHERE pool_id = ?
`;

const SQL_INSERT_POSITION = `
  INSERT INTO liquidity_positions (
    position_id, pool_id, funding_entry_id, state, total, available, reserved, consumed,
    funding_source_kind, funding_source_ref, created_seq, created_wall_ms,
    state_seq, state_wall_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (position_id) DO NOTHING
`;

const SQL_UPDATE_POSITION = `
  UPDATE liquidity_positions
  SET state = ?, available = ?, reserved = ?, consumed = ?, state_seq = ?, state_wall_ms = ?
  WHERE position_id = ?
`;

const SQL_INSERT_FUNDING_ENTRY = `
  INSERT INTO funding_entries (
    funding_entry_id, pool_id, position_id, amount, source_kind, source_reference_id,
    recorded_seq, recorded_wall_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (funding_entry_id) DO NOTHING
`;

const SQL_INSERT_PENDING = `
  INSERT INTO pending_funding_links (
    pending_id, pool_id, rail_operation_id, expected_amount, status,
    opened_seq, opened_wall_ms, resolved_seq, resolved_wall_ms, funding_entry_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (pending_id) DO NOTHING
`;

const SQL_UPDATE_PENDING = `
  UPDATE pending_funding_links
  SET status = ?, resolved_seq = ?, resolved_wall_ms = ?, funding_entry_id = ?
  WHERE pending_id = ?
`;

/**
 * The outcome of one durable liquidity-domain write: created is false when
 * the row already existed (the dedupe no-op — the same { created, reason }
 * shape the substrate's deduplicated enqueue and the sibling domains'
 * stores report).
 *
 * Source: INV-6-3 (liquidity-credit-queues.md lines 58-60 — the
 * storage-level dedupe this outcome reports); DEP-003 §6 (the
 * dedupe-report shape mirrored).
 */
export interface LiquidityStoreWrite {
  readonly created: boolean;
  readonly reason: 'written' | 'duplicate-no-op';
}

/**
 * Persist one committed pool row (INSERT for creation — the
 * dedupe-protected no-op; UPDATE for state/total progression).
 *
 * Source: liquidity-credit-queues.md lines 31-35, 52-54.
 */
export function writePool(store: DurableDatabase, pool: LiquidityPoolRecord): LiquidityStoreWrite {
  const result = store
    .prepare(SQL_INSERT_POOL)
    .run(
      pool.poolId,
      pool.currency,
      pool.scale,
      pool.state,
      pool.totalMinor,
      pool.openedAt.sequence,
      pool.openedAt.wallMs,
      pool.stateChangedAt.sequence,
      pool.stateChangedAt.wallMs,
    );
  if (Number(result.changes) === 1) {
    return { created: true, reason: 'written' };
  }
  store
    .prepare(SQL_UPDATE_POOL)
    .run(pool.state, pool.totalMinor, pool.stateChangedAt.sequence, pool.stateChangedAt.wallMs, pool.poolId);
  return { created: false, reason: 'written' };
}

/**
 * Persist one committed position row (INSERT for creation; UPDATE for the
 * fold progression — the accounting columns are kept in lockstep with the
 * ledger entries, and the schema's CHECK constraint backstops INV-6-1).
 *
 * Source: liquidity-credit-queues.md lines 36-39, 52-54.
 */
export function writePosition(
  store: DurableDatabase,
  position: LiquidityPositionRecord,
): LiquidityStoreWrite {
  const result = store
    .prepare(SQL_INSERT_POSITION)
    .run(
      position.positionId,
      position.poolId,
      position.fundingEntryId,
      position.state,
      JSON.stringify(position.total),
      JSON.stringify(position.available),
      JSON.stringify(position.reserved),
      JSON.stringify(position.consumed),
      position.fundingSource.kind,
      position.fundingSource.referenceId,
      position.createdAt.sequence,
      position.createdAt.wallMs,
      position.stateChangedAt.sequence,
      position.stateChangedAt.wallMs,
    );
  if (Number(result.changes) === 1) {
    return { created: true, reason: 'written' };
  }
  store
    .prepare(SQL_UPDATE_POSITION)
    .run(
      position.state,
      JSON.stringify(position.available),
      JSON.stringify(position.reserved),
      JSON.stringify(position.consumed),
      position.stateChangedAt.sequence,
      position.stateChangedAt.wallMs,
      position.positionId,
    );
  return { created: false, reason: 'written' };
}

/**
 * Persist one committed FundingEntry row (INSERT-only: the PRIMARY KEY on
 * funding_entry_id makes INV-6-3's exactly-once structural at the storage
 * layer).
 *
 * Source: liquidity-credit-queues.md lines 40-43, 58-60.
 */
export function writeFundingEntry(
  store: DurableDatabase,
  entry: FundingEntryRecord,
): LiquidityStoreWrite {
  const result = store
    .prepare(SQL_INSERT_FUNDING_ENTRY)
    .run(
      entry.fundingEntryId,
      entry.poolId,
      entry.positionId,
      JSON.stringify(entry.amount),
      entry.source.kind,
      entry.source.referenceId,
      entry.recordedAt.sequence,
      entry.recordedAt.wallMs,
    );
  const created = Number(result.changes) === 1;
  return { created, reason: created ? 'written' : 'duplicate-no-op' };
}

/**
 * Persist one committed pending-funding linkage row (INSERT for creation;
 * UPDATE for the resolution progression).
 *
 * Source: liquidity-credit-queues.md lines 64-69.
 */
export function writePendingFundingLink(
  store: DurableDatabase,
  link: PendingFundingLinkRecord,
): LiquidityStoreWrite {
  const result = store
    .prepare(SQL_INSERT_PENDING)
    .run(
      link.pendingId,
      link.poolId,
      link.railOperationId,
      JSON.stringify(link.expectedAmount),
      link.status,
      link.openedAt.sequence,
      link.openedAt.wallMs,
      link.resolvedAt === undefined ? null : link.resolvedAt.sequence,
      link.resolvedAt === undefined ? null : link.resolvedAt.wallMs,
      link.fundingEntryId ?? null,
    );
  if (Number(result.changes) === 1) {
    return { created: true, reason: 'written' };
  }
  store
    .prepare(SQL_UPDATE_PENDING)
    .run(
      link.status,
      link.resolvedAt === undefined ? null : link.resolvedAt.sequence,
      link.resolvedAt === undefined ? null : link.resolvedAt.wallMs,
      link.fundingEntryId ?? null,
      link.pendingId,
    );
  return { created: false, reason: 'written' };
}

// ---------------------------------------------------------------------------
// Read path (GC-1 holds: every Money column re-mints through money())
// ---------------------------------------------------------------------------

function parseMoneyColumn(value: unknown, label: string): Money {
  if (typeof value !== 'string') {
    throw new TypeError(`liquidity store: the ${label} column must hold canonical Money JSON`);
  }
  const parsed: unknown = JSON.parse(value);
  if (!isMoney(parsed)) {
    throw new TypeError(`liquidity store: the ${label} column is not a well-formed Money value (GC-1)`);
  }
  return money(parsed.currency, parsed.amountMinor, parsed.scale);
}

function parseTime(seq: unknown, wallMs: unknown, label: string): ProtocolTime {
  if (typeof seq !== 'number' || typeof wallMs !== 'number') {
    throw new TypeError(`liquidity store: the ${label} time columns are malformed`);
  }
  return protocolTime(seq, wallMs);
}

/**
 * Read every pool row. Source: lines 31-35 (the persisted shape).
 */
export function readPools(store: DurableDatabase): readonly LiquidityPoolRecord[] {
  const rows = store.prepare('SELECT * FROM liquidity_pools ORDER BY opened_seq, pool_id').all() as Record<
    string,
    unknown
  >[];
  return rows.map((row) => ({
    poolId: String(row['pool_id']),
    currency: String(row['currency']),
    scale: Number(row['scale']),
    state: assertPoolState(row['state']),
    totalMinor: Number(row['total_minor']),
    openedAt: parseTime(row['opened_seq'], row['opened_wall_ms'], 'openedAt'),
    stateChangedAt: parseTime(row['state_seq'], row['state_wall_ms'], 'stateChangedAt'),
  }));
}

/**
 * Read every position row (Money columns re-minted through the kernel
 * guards — GC-1 holds on the read path).
 *
 * Source: lines 36-39.
 */
export function readPositions(store: DurableDatabase): readonly LiquidityPositionRecord[] {
  const rows =
    store.prepare('SELECT * FROM liquidity_positions ORDER BY created_seq, position_id').all() as Record<
      string,
      unknown
    >[];
  return rows.map((row) => ({
    positionId: String(row['position_id']),
    poolId: String(row['pool_id']),
    fundingEntryId: String(row['funding_entry_id']),
    state: assertPositionState(row['state']),
    total: parseMoneyColumn(row['total'], 'total'),
    available: parseMoneyColumn(row['available'], 'available'),
    reserved: parseMoneyColumn(row['reserved'], 'reserved'),
    consumed: parseMoneyColumn(row['consumed'], 'consumed'),
    fundingSource: {
      kind: assertFundingKind(row['funding_source_kind']),
      referenceId: String(row['funding_source_ref']),
    },
    createdAt: parseTime(row['created_seq'], row['created_wall_ms'], 'createdAt'),
    stateChangedAt: parseTime(row['state_seq'], row['state_wall_ms'], 'stateChangedAt'),
  }));
}

/**
 * Read every FundingEntry row. Source: lines 40-43, 58-60.
 */
export function readFundingEntries(store: DurableDatabase): readonly FundingEntryRecord[] {
  const rows =
    store.prepare('SELECT * FROM funding_entries ORDER BY recorded_seq, funding_entry_id').all() as Record<
      string,
      unknown
    >[];
  return rows.map((row) => ({
    fundingEntryId: String(row['funding_entry_id']),
    poolId: String(row['pool_id']),
    positionId: String(row['position_id']),
    amount: parseMoneyColumn(row['amount'], 'amount'),
    source: {
      kind: assertFundingKind(row['source_kind']),
      referenceId: String(row['source_reference_id']),
    },
    recordedAt: parseTime(row['recorded_seq'], row['recorded_wall_ms'], 'recordedAt'),
  }));
}

/**
 * Read every pending-funding linkage row. Source: lines 64-69.
 */
export function readPendingFundingLinks(store: DurableDatabase): readonly PendingFundingLinkRecord[] {
  const rows =
    store.prepare('SELECT * FROM pending_funding_links ORDER BY opened_seq, pending_id').all() as Record<
      string,
      unknown
    >[];
  return rows.map((row) => {
    const status = String(row['status']);
    if (status !== 'PENDING' && !isPendingFundingResolution(status)) {
      throw new TypeError(`liquidity store: unknown pending status ${status}`);
    }
    const fundingEntryId = row['funding_entry_id'];
    const resolvedSeq = row['resolved_seq'];
    return {
      pendingId: String(row['pending_id']),
      poolId: String(row['pool_id']),
      railOperationId: String(row['rail_operation_id']),
      expectedAmount: parseMoneyColumn(row['expected_amount'], 'expected_amount'),
      status,
      openedAt: parseTime(row['opened_seq'], row['opened_wall_ms'], 'openedAt'),
      ...(resolvedSeq === null || resolvedSeq === undefined
        ? {}
        : {
            resolvedAt: parseTime(resolvedSeq, row['resolved_wall_ms'], 'resolvedAt'),
            ...(typeof fundingEntryId === 'string' ? { fundingEntryId } : {}),
          }),
    } as PendingFundingLinkRecord;
  });
}

function assertPoolState(value: unknown): LiquidityPoolRecord['state'] {
  if (!isPoolState(value)) {
    throw new TypeError(`liquidity store: unknown pool state ${JSON.stringify(value)}`);
  }
  return value;
}

function assertPositionState(value: unknown): LiquidityPositionRecord['state'] {
  if (!isPositionState(value)) {
    throw new TypeError(`liquidity store: unknown position state ${JSON.stringify(value)}`);
  }
  return value;
}

function assertFundingKind(value: unknown): FundingSource['kind'] {
  if (!isFundingSourceKind(value)) {
    throw new TypeError(`liquidity store: unknown funding source kind ${JSON.stringify(value)}`);
  }
  return value;
}
