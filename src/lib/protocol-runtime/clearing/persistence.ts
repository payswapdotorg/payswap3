/**
 * RTN-008 — Clearing Authority: the per-domain durable store (the
 * openKernelStore convention, read-only over the DEP-003 database layer).
 *
 * THE CONVENTION (decided in RTN — spec/protocol-runtime-work-orders/
 * README.md, "Persistence convention"):
 *   "each authority domain owns its schema and per-domain migrations inside
 *    its owned prefix, using the DEP-003 database layer read-only."
 *
 * v0.1 permission for this convention — spec/architecture/v0.1/README.md
 * §9, lines 173-174: "This directory defines semantics only; it
 * intentionally prescribes no implementation, storage, or service
 * decomposition."
 *
 * Mechanically (the kernel's persistence.ts template, the RTN-007 sibling
 * template): one SQLite database opened through the substrate's
 * openDurableDatabase({ dbPath, migrationsDir }), migrations in the owned
 * prefix src/lib/protocol-runtime/clearing/migrations/, domain database
 * file var/clearing.sqlite. The substrate supplies WAL,
 * synchronous=FULL, busy_timeout, and the explicit migration runner.
 *
 * Spec sources of the persisted records:
 *   - clearing-netting-settlement.md lines 29-33 (ClearingBatch — the
 *     persisted batch shape, the exact state machine as a CHECK, the
 *     INV-9-2 sequence as a UNIQUE total order).
 *   - lines 35-40 (ClearingRecord — the persisted record shape, the
 *     exact record machine as a CHECK, quarantine reason codes as a
 *     mandatory-when-quarantined column: quarantined rows are KEPT,
 *     never dropped).
 *   - lines 48-56 (INV-9-1/9-2/9-3 — the summation totals, the sequence
 *     order, the recorded commit result).
 *
 * DEP-003 integration is READ-ONLY: this module imports the db API from
 * src/lib/durable/db.ts and never modifies the substrate.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openDurableDatabase } from '../../durable/db.ts';
import type { DurableDatabase } from '../../durable/db.ts';
import { money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type {
  BatchCommitResult,
  ClearingBatchRecord,
  ClearingOriginKind,
  ClearingRecord,
} from './types.ts';
import {
  isBatchState,
  isClearingOriginKind,
  isClearingReasonCode,
  isRecordState,
} from './types.ts';

/**
 * Default filesystem path of the clearing-domain store (mirrors the
 * substrate's var/durable.sqlite and the sibling domains' defaults).
 * var/ is a runtime artifact directory and is gitignored.
 *
 * Source: the per-domain persistence convention; DEP-003 §2 lines 40-43.
 */
export const DEFAULT_CLEARING_DB_PATH = 'var/clearing.sqlite';

/**
 * Environment variable overriding the clearing migrations directory
 * (mirrors the substrate's PAYSWAP_MIGRATIONS_DIR and the sibling
 * domains' variables).
 *
 * Source: DEP-003 §2 lines 44-47; the per-domain convention.
 */
export const CLEARING_MIGRATIONS_DIR_ENV_VAR = 'PAYSWAP_CLEARING_MIGRATIONS_DIR';

/** The clearing domain's owned migration directory, relative to the repository root. */
export const CLEARING_MIGRATIONS_RELATIVE_DIR = join(
  'src',
  'lib',
  'protocol-runtime',
  'clearing',
  'migrations',
);

/** The clearing domain's owner identity (for rows the domain itself records). */
export const CLEARING_STORE_DOMAIN = 'protocol-runtime-clearing';

/**
 * Resolve the clearing migrations directory (explicit argument, then the
 * environment variable, then the 8-level walk-up, then the cwd-relative
 * fallback that fails closed inside the runner) — the same strategy the
 * substrate, the kernel, and the sibling domains use.
 *
 * Source: DEP-003 migration conventions (spec/durable/execution.md §2/§4);
 * the per-domain persistence convention.
 */
export function resolveClearingMigrationsDir(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return resolve(explicit);
  }
  const fromEnv = process.env[CLEARING_MIGRATIONS_DIR_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return resolve(fromEnv.trim());
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, CLEARING_MIGRATIONS_RELATIVE_DIR);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(process.cwd(), CLEARING_MIGRATIONS_RELATIVE_DIR);
}

/**
 * Options for opening the clearing-domain store.
 *
 * Source: the per-domain persistence convention; option shape mirrors
 * the substrate's DurableDatabaseOptions (src/lib/durable/db.ts).
 */
export interface ClearingStoreOptions {
  /**
   * Filesystem path of the clearing-domain SQLite database file.
   * Default: var/clearing.sqlite (created on demand; never committed).
   */
  readonly dbPath?: string;
  /** Explicit migrations directory. Default: resolveClearingMigrationsDir(). */
  readonly migrationsDir?: string;
}

/**
 * Open the clearing-domain store THROUGH the DEP-003 database layer
 * (read-only integration): opens the SQLite database with the
 * substrate's crash-safety pragmas and applies the clearing domain's
 * pending migrations from
 * src/lib/protocol-runtime/clearing/migrations/ via the substrate's
 * migration runner.
 *
 * Source: spec/protocol-runtime-work-orders/README.md "Persistence
 * convention"; spec/durable/execution.md §3/§4.
 */
export function openClearingStore(options: ClearingStoreOptions = {}): DurableDatabase {
  return openDurableDatabase({
    dbPath: options.dbPath ?? DEFAULT_CLEARING_DB_PATH,
    migrationsDir: resolveClearingMigrationsDir(options.migrationsDir),
  });
}

// ---------------------------------------------------------------------------
// Write-through bridges (the RTN-007 convention: the in-process authority
// is the single writer; the durable side persists every committed
// artifact; the round trip reconstructs the records exactly)
// ---------------------------------------------------------------------------

/** A persisted clearing batch row (the read-bridge shape). */
export interface ClearingStoreWrite {
  readonly kind: 'batch' | 'records';
}

function asString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError(`clearing store: expected a string (got ${typeof value})`);
  }
  return value;
}

function asInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`clearing store: expected an integer (got ${JSON.stringify(value)})`);
  }
  return value;
}

function parseTime(sequence: unknown, wallMs: unknown, label: string): ProtocolTime {
  return protocolTime(asInteger(sequence), asInteger(wallMs));
}

/**
 * Write (upsert) one batch row. The commit result columns are written
 * only when the batch carries one (COMMITTED/FINAL).
 *
 * Source: clearing-netting-settlement.md lines 29-33, 55-56 (the INV-9-3
 * recorded commit result).
 */
export function writeBatch(store: DurableDatabase, batch: ClearingBatchRecord, batchLabel: string): ClearingStoreWrite {
  store
    .prepare(
      `INSERT INTO clearing_batches (
         batch_id, batch_label, batch_sequence, state, record_count,
         per_currency_totals, contents_hash, opened_seq, opened_wall_ms,
         state_seq, state_wall_ms, commit_idempotency_key,
         commit_obligation_ids, commit_duplicate_origins, commit_seq, commit_wall_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(batch_id) DO UPDATE SET
         state = excluded.state,
         record_count = excluded.record_count,
         per_currency_totals = excluded.per_currency_totals,
         contents_hash = excluded.contents_hash,
         state_seq = excluded.state_seq,
         state_wall_ms = excluded.state_wall_ms,
         commit_idempotency_key = excluded.commit_idempotency_key,
         commit_obligation_ids = excluded.commit_obligation_ids,
         commit_duplicate_origins = excluded.commit_duplicate_origins,
         commit_seq = excluded.commit_seq,
         commit_wall_ms = excluded.commit_wall_ms`,
    )
    .run(
      batch.batchId,
      batchLabel,
      batch.sequence,
      batch.state,
      batch.recordCount,
      batch.perCurrencyTotals,
      batch.contentsHash,
      batch.openedAt.sequence,
      batch.openedAt.wallMs,
      batch.stateChangedAt.sequence,
      batch.stateChangedAt.wallMs,
      batch.commit?.idempotencyKey ?? null,
      JSON.stringify(batch.commit?.obligationIds ?? []),
      JSON.stringify(batch.commit?.duplicateOriginActivityIds ?? []),
      batch.commit?.committedAt.sequence ?? null,
      batch.commit?.committedAt.wallMs ?? null,
    );
  return { kind: 'batch' };
}

/**
 * Write (replace) the full record list of one batch — the stored order
 * (position) is the deterministic commit order.
 *
 * Source: clearing-netting-settlement.md lines 35-40 (the record shape).
 */
export function writeRecords(
  store: DurableDatabase,
  batchId: string,
  records: readonly ClearingRecord[],
): ClearingStoreWrite {
  store.prepare(`DELETE FROM clearing_records WHERE batch_id = ?`).run(batchId);
  const insert = store.prepare(
    `INSERT INTO clearing_records (
       batch_id, position, record_id, origin_activity_id, origin_kind,
       debtor_participant_id, creditor_participant_id, currency, scale,
       amount_minor, reason, correction_of, state, quarantine_reason,
       accepted_seq, accepted_wall_ms, state_seq, state_wall_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let position = 0; position < records.length; position += 1) {
    const record = records[position] as ClearingRecord;
    insert.run(
      batchId,
      position,
      record.recordId,
      record.origin.originActivityId,
      record.origin.originKind,
      record.parties.debtorParticipantId,
      record.parties.creditorParticipantId,
      record.amount.currency,
      record.amount.scale,
      record.amount.amountMinor,
      record.reason,
      record.correctionOf ?? null,
      record.state,
      record.quarantineReason ?? null,
      record.acceptedAt.sequence,
      record.acceptedAt.wallMs,
      record.stateChangedAt.sequence,
      record.stateChangedAt.wallMs,
    );
  }
  return { kind: 'records' };
}

/**
 * Read all batch rows back, reconstructing the exact record shapes
 * (Money re-minted through the kernel guards — GC-1 holds on the read
 * path).
 *
 * Source: clearing-netting-settlement.md lines 29-33 (the batch shape);
 * GC-1.
 */
export function readBatches(store: DurableDatabase): readonly ClearingBatchRecord[] {
  const rows = store.prepare(`SELECT * FROM clearing_batches ORDER BY batch_sequence ASC`).all();
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    const commitIdempotencyKey = record['commit_idempotency_key'];
    const commit: BatchCommitResult | undefined =
      typeof commitIdempotencyKey === 'string'
        ? {
            obligationIds: Object.freeze(
              (JSON.parse(asString(record['commit_obligation_ids'])) as unknown[]).map(asString),
            ),
            duplicateOriginActivityIds: Object.freeze(
              (JSON.parse(asString(record['commit_duplicate_origins'])) as unknown[]).map(asString),
            ),
            idempotencyKey: commitIdempotencyKey,
            committedAt: parseTime(record['commit_seq'], record['commit_wall_ms'], 'commit'),
          }
        : undefined;
    const state = asString(record['state']);
    if (!isBatchState(state)) {
      throw new TypeError(`clearing store: unknown batch state ${JSON.stringify(state)}`);
    }
    return {
      batchId: asString(record['batch_id']),
      sequence: asInteger(record['batch_sequence']),
      state,
      recordCount: asInteger(record['record_count']),
      perCurrencyTotals: asString(record['per_currency_totals']),
      contentsHash: asString(record['contents_hash']),
      openedAt: parseTime(record['opened_seq'], record['opened_wall_ms'], 'opened'),
      stateChangedAt: parseTime(record['state_seq'], record['state_wall_ms'], 'state'),
      ...(commit !== undefined ? { commit } : {}),
    } satisfies ClearingBatchRecord;
  });
}

/**
 * Read all record rows of one batch back, in stored order, reconstructing
 * the exact record shapes.
 *
 * Source: clearing-netting-settlement.md lines 35-40 (the record shape).
 */
export function readRecords(store: DurableDatabase, batchId: string): readonly ClearingRecord[] {
  const rows = store
    .prepare(`SELECT * FROM clearing_records WHERE batch_id = ? ORDER BY position ASC`)
    .all(batchId);
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    const state = asString(record['state']);
    if (!isRecordState(state)) {
      throw new TypeError(`clearing store: unknown record state ${JSON.stringify(state)}`);
    }
    const originKind = asString(record['origin_kind']);
    if (!isClearingOriginKind(originKind)) {
      throw new TypeError(`clearing store: unknown origin kind ${JSON.stringify(originKind)}`);
    }
    const quarantineReason = record['quarantine_reason'];
    if (quarantineReason !== null && !isClearingReasonCode(quarantineReason)) {
      throw new TypeError(`clearing store: unknown quarantine reason ${JSON.stringify(quarantineReason)}`);
    }
    const correctionOf = record['correction_of'];
    return {
      recordId: asString(record['record_id']),
      origin: {
        originActivityId: asString(record['origin_activity_id']),
        originKind: originKind as ClearingOriginKind,
      },
      parties: {
        debtorParticipantId: asString(record['debtor_participant_id']),
        creditorParticipantId: asString(record['creditor_participant_id']),
      },
      amount: money(
        asString(record['currency']),
        asInteger(record['amount_minor']),
        asInteger(record['scale']),
      ),
      reason: asString(record['reason']),
      state,
      ...(quarantineReason !== null ? { quarantineReason: quarantineReason as ClearingRecord['quarantineReason'] } : {}),
      ...(correctionOf !== null ? { correctionOf: asString(correctionOf) } : {}),
      acceptedAt: parseTime(record['accepted_seq'], record['accepted_wall_ms'], 'accepted'),
      stateChangedAt: parseTime(record['state_seq'], record['state_wall_ms'], 'recordState'),
    } satisfies ClearingRecord;
  });
}
