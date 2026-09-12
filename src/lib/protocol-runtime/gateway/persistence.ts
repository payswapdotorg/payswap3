/**
 * RTN-010 — Protocol gateway: the per-domain persistence convention.
 *
 * THE CONVENTION (decided in RTN-001 — spec/protocol-runtime-work-orders/
 * README.md, "Persistence convention"): "each authority domain owns its
 * schema and per-domain migrations inside its owned prefix, using the
 * DEP-003 database layer read-only." The gateway domain follows it exactly
 * as the kernel demonstrates (kernel/persistence.ts is the reference):
 *
 *   1. ONE SQLite database opened through the substrate's
 *      openDurableDatabase({ dbPath, migrationsDir });
 *   2. the gateway's migrations live in src/lib/protocol-runtime/gateway/
 *      migrations/ (NOT the shared deploy/migrations/ — sibling domains
 *      never collide);
 *   3. its own database file (default var/gateway.sqlite) keeps domains
 *      disjoint at the storage layer.
 *
 * The gateway's durable rows are its RECEIPTS — the generalized
 * IntentReceipt store ("intent id, current state, and recorded outcome for
 * the submitted idempotency key", core.md lines 43-44, generalized per
 * RTN-010.md line 10). The PRIMARY KEY (kind, idempotency_key) mirrors the
 * DEP-003 dedupe identity UNIQUE (idempotency_key, kind) — one row per
 * admitted command, exactly as the intent domain's intent_receipts table
 * mirrors INV-1-3 per key.
 *
 * Composition (the merged split): the gateway class itself is the
 * in-process single writer over in-memory receipt state (the RTN-002
 * in-process-object-store precedent — exercisable under bun test without
 * node:sqlite); this module is the durable side, composed by the
 * deployment root the same way RTN-002's log composes with its store and
 * RTN-005's authority with its persistence module. The queue's own
 * UNIQUE (idempotency_key, kind) row is the cross-restart effect backstop;
 * this store is the cross-restart RECEIPT record.
 *
 * DEP-003 integration is READ-ONLY: this module imports the db API from
 * src/lib/durable/db.ts and never modifies the substrate.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openDurableDatabase } from '../../durable/db.ts';
import type { DurableDatabase } from '../../durable/db.ts';
import { protocolTime } from '../kernel/time.ts';
import type { CommandReceipt, GatewayAdmissionOutcome, GatewayAdmissionState } from './receipts.ts';
import { isCommandReceipt } from './receipts.ts';

/**
 * Default filesystem path of the gateway-domain store (mirrors the
 * substrate's var/durable.sqlite and the kernel's var/kernel.sqlite
 * defaults; var/ is a runtime artifact directory and is gitignored).
 *
 * Source: spec/durable/execution.md §2 lines 40-43; the per-domain
 * persistence convention.
 */
export const DEFAULT_GATEWAY_DB_PATH = 'var/gateway.sqlite';

/**
 * Environment variable overriding the gateway migrations directory
 * (mirrors the substrate's PAYSWAP_MIGRATIONS_DIR and the kernel's
 * PAYSWAP_KERNEL_MIGRATIONS_DIR).
 *
 * Source: spec/durable/execution.md §2 lines 44-47.
 */
export const GATEWAY_MIGRATIONS_DIR_ENV_VAR = 'PAYSWAP_GATEWAY_MIGRATIONS_DIR';

/** The gateway domain's owned migration directory, relative to the repository root. */
export const GATEWAY_MIGRATIONS_RELATIVE_DIR = join('src', 'lib', 'protocol-runtime', 'gateway', 'migrations');

/** The gateway domain's owner identity. */
export const GATEWAY_STORE_DOMAIN = 'protocol-runtime-gateway';

/**
 * Resolve the gateway migrations directory (explicit argument, then the
 * environment variable, then the walk-up probe of the owned prefix — the
 * kernel's resolveKernelMigrationsDir strategy verbatim).
 *
 * Source: DEP-003 migration conventions (spec/durable/execution.md §2/§4);
 * the per-domain persistence convention.
 */
export function resolveGatewayMigrationsDir(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return resolve(explicit);
  }
  const fromEnv = process.env[GATEWAY_MIGRATIONS_DIR_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return resolve(fromEnv.trim());
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, GATEWAY_MIGRATIONS_RELATIVE_DIR);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(process.cwd(), GATEWAY_MIGRATIONS_RELATIVE_DIR);
}

/**
 * Options for opening the gateway-domain store (the kernel's
 * KernelStoreOptions shape).
 *
 * Source: the per-domain persistence convention.
 */
export interface GatewayStoreOptions {
  /**
   * Filesystem path of the gateway-domain SQLite database file.
   * Default: var/gateway.sqlite. `:memory:` is accepted for experiments
   * only (not durable) — same rule as the substrate.
   */
  dbPath?: string;
  /** Explicit migrations directory. Default: resolveGatewayMigrationsDir(). */
  migrationsDir?: string;
}

/**
 * Open the gateway-domain store THROUGH the DEP-003 database layer
 * (read-only integration): crash-safety pragmas (WAL, synchronous=FULL,
 * busy_timeout) and the gateway's pending migrations applied from
 * src/lib/protocol-runtime/gateway/migrations/ via the substrate's runner.
 *
 * Source: the per-domain persistence convention; spec/durable/execution.md
 * §3/§4; RTN-001 kernel/persistence.ts openKernelStore (the reference).
 */
export function openGatewayStore(options: GatewayStoreOptions = {}): DurableDatabase {
  return openDurableDatabase({
    dbPath: options.dbPath ?? DEFAULT_GATEWAY_DB_PATH,
    migrationsDir: resolveGatewayMigrationsDir(options.migrationsDir),
  });
}

/**
 * One stored command receipt row: the receipt plus its dedupe identity and
 * durable job position.
 *
 * Source: core.md lines 43-44 (the receipt fields); spec/durable/
 * execution.md §6 (the (kind, idempotencyKey) identity).
 */
export interface StoredCommandReceipt {
  readonly kind: string;
  readonly idempotencyKey: string;
  readonly receipt: CommandReceipt;
  /** The durable job id the command was submitted onto. */
  readonly jobId: string;
}

/** The outcome of one receipt write. */
export interface GatewayReceiptWrite {
  /** false when an existing (kind, idempotency_key) row absorbed this write. */
  readonly created: boolean;
  readonly reason: 'written' | 'duplicate-no-op';
}

const SQL_INSERT_RECEIPT =
  'INSERT INTO gateway_command_receipts (kind, idempotency_key, command_id, state, outcome, job_id, recorded_seq, recorded_wall_ms, written_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (kind, idempotency_key) DO NOTHING';
const SQL_SELECT_RECEIPTS =
  'SELECT kind, idempotency_key, command_id, state, outcome, job_id, recorded_seq, recorded_wall_ms FROM gateway_command_receipts ORDER BY written_at ASC, kind ASC, idempotency_key ASC';

/**
 * Write one command receipt to the gateway store (INSERT-only; the
 * PRIMARY KEY (kind, idempotency_key) absorbs duplicates as no-ops — the
 * same discipline as the evidence store's write and the queue's enqueue).
 *
 * Source: the per-domain persistence convention; INV-1-3 (one recorded
 * receipt per key); evidence/persistence.ts writeEvidenceRecord (the
 * insert-only precedent).
 */
export function writeCommandReceipt(
  store: DurableDatabase,
  entry: StoredCommandReceipt,
): GatewayReceiptWrite {
  if (!isCommandReceipt(entry.receipt)) {
    throw new TypeError('gateway persistence: entry.receipt must be a CommandReceipt');
  }
  const insert = store
    .prepare(SQL_INSERT_RECEIPT)
    .run(
      entry.kind,
      entry.idempotencyKey,
      entry.receipt.commandId,
      entry.receipt.state,
      entry.receipt.outcome,
      entry.jobId,
      entry.receipt.recordedAt.sequence,
      entry.receipt.recordedAt.wallMs,
      Date.now(),
    );
  return Number(insert.changes) === 1
    ? { created: true, reason: 'written' }
    : { created: false, reason: 'duplicate-no-op' };
}

/**
 * Read every stored command receipt (deterministic order: written_at, then
 * kind, then idempotency key).
 *
 * Source: the per-domain persistence convention; the intent domain's
 * readIntentReceipts precedent.
 */
export function readCommandReceipts(store: DurableDatabase): readonly StoredCommandReceipt[] {
  const rows = store.prepare(SQL_SELECT_RECEIPTS).all() as Array<Record<string, unknown>>;
  const result: StoredCommandReceipt[] = [];
  for (const row of rows) {
    const receipt: CommandReceipt = {
      commandId: String(row.command_id),
      state: String(row.state) as GatewayAdmissionState,
      outcome: String(row.outcome) as GatewayAdmissionOutcome,
      recordedAt: protocolTime(Number(row.recorded_seq), Number(row.recorded_wall_ms)),
    };
    if (!isCommandReceipt(receipt)) {
      throw new TypeError(
        `gateway persistence: stored receipt row for (${String(row.kind)}, ${String(row.idempotency_key)}) is malformed`,
      );
    }
    result.push({
      kind: String(row.kind),
      idempotencyKey: String(row.idempotency_key),
      receipt: Object.freeze(receipt),
      jobId: String(row.job_id),
    });
  }
  return Object.freeze(result);
}
