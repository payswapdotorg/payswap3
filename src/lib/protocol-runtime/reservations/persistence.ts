/**
 * RTN-006 — Reservation Authority: per-domain persistence.
 *
 * THE CONVENTION (decided in RTN-001 — spec/protocol-runtime-work-orders/
 * README.md, "Persistence convention"):
 *
 *   "each authority domain owns its schema and per-domain migrations inside
 *    its owned prefix, using the DEP-003 database layer read-only. This
 *    keeps sibling surfaces disjoint (a shared deploy/migrations/ prefix
 *    would collide between parallel siblings)."
 *
 * v0.1 permission for this convention — spec/architecture/v0.1/README.md
 * §9, lines 173-174: "This directory defines semantics only; it
 * intentionally prescribes no implementation, storage, or service
 * decomposition."
 *
 * This module mirrors the kernel's reference pattern (src/lib/protocol-
 * runtime/kernel/persistence.ts) and the RTN-005 domains' in-process-
 * object-store + durable-bridge split for the reservations domain: ONE
 * SQLite database (default var/reservations.sqlite) opened through the
 * substrate's openDurableDatabase, migrations in this domain's OWNED
 * prefix, and write-through bridge functions persisting the ledger's
 * committed artifacts — the append-only entry log (the crash-recovery
 * input), the materialized reservation records, and the per-resource
 * INV-5-1 accounting — plus read-back reconstruction (Money re-minted
 * through the kernel's money() guard — GC-1's integer discipline holds on
 * the read path too).
 *
 * DEP-003 integration is READ-ONLY: this module imports the db API from
 * src/lib/durable/db.ts and never modifies the substrate.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/core.md §5 Area 5 lines 286-295 (Reservation,
 *     ReservationLedger — the artifacts being persisted; the log is the
 *     append-only durable fact base);
 *   lines 304-312 (INV-5-1/INV-5-2/INV-5-3 — the storage-level UNIQUE
 *     constraints that make the contracts structural);
 *   lines 316-318 (crash recovery — the persisted entry log with its
 *     recorded decisions is the recovery input);
 *   spec/durable/execution.md §2 (configuration), §4 (migrations).
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openDurableDatabase } from '../../durable/db.ts';
import type { DurableDatabase } from '../../durable/db.ts';
import { money } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { initialResourceAccounting } from './resource.ts';
import type { ResourceAccounting } from './resource.ts';
import type {
  ReservationEntryKind,
  ReservationLedgerEntry,
  ReservationReasonCode,
  ReservationRecord,
  ReservationState,
} from './types.ts';
import { isReservationEntryKind, isReservationReasonCode, isReservationState } from './types.ts';

/**
 * Default filesystem path of the reservations-domain store, relative to
 * the process working directory (mirrors the substrate's
 * var/durable.sqlite and the sibling domains' defaults; spec/durable/
 * execution.md §2 lines 40-43). var/ is a runtime artifact directory and
 * is gitignored.
 *
 * Source: the per-domain persistence convention; DEP-003 §2 lines 40-43.
 */
export const DEFAULT_RESERVATIONS_DB_PATH = 'var/reservations.sqlite';

/**
 * Environment variable overriding the reservations migrations directory
 * (mirrors the substrate's PAYSWAP_MIGRATIONS_DIR and the sibling domains'
 * variables; spec/durable/execution.md §2 lines 44-47). In a deployed
 * image the migrations directory must ship with the application — the
 * runner fails closed when it cannot find migrations.
 *
 * Source: DEP-003 §2 lines 44-47; the per-domain convention.
 */
export const RESERVATIONS_MIGRATIONS_DIR_ENV_VAR = 'PAYSWAP_RESERVATIONS_MIGRATIONS_DIR';

/** The reservations domain's owned migration directory, relative to the repository root. */
export const RESERVATIONS_MIGRATIONS_RELATIVE_DIR = join(
  'src',
  'lib',
  'protocol-runtime',
  'reservations',
  'migrations',
);

/** The reservations domain's owner identity (for rows the domain itself records). */
export const RESERVATIONS_STORE_DOMAIN = 'protocol-runtime-reservations';

/**
 * Resolve the reservations migrations directory (explicit argument, then
 * the environment variable, then the 8-level walk-up, then the
 * cwd-relative fallback that fails closed inside the runner) — the same
 * strategy the substrate, the kernel, and the sibling domains use.
 *
 * Source: DEP-003 migration conventions (spec/durable/execution.md §2/§4);
 * the per-domain persistence convention.
 */
export function resolveReservationsMigrationsDir(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return resolve(explicit);
  }
  const fromEnv = process.env[RESERVATIONS_MIGRATIONS_DIR_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return resolve(fromEnv.trim());
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, RESERVATIONS_MIGRATIONS_RELATIVE_DIR);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(process.cwd(), RESERVATIONS_MIGRATIONS_RELATIVE_DIR);
}

/**
 * Options for opening the reservations-domain store.
 *
 * Source: the per-domain persistence convention; option shape mirrors the
 * substrate's DurableDatabaseOptions.
 */
export interface ReservationsStoreOptions {
  /** Default: var/reservations.sqlite (created on demand; never committed). */
  dbPath?: string;
  /** Explicit migrations directory. Default: resolveReservationsMigrationsDir(). */
  migrationsDir?: string;
}

/**
 * Open the reservations-domain store THROUGH the DEP-003 database layer
 * (read-only integration): the substrate's crash-safety pragmas and
 * migration runner over this domain's owned migrations.
 *
 * Source: spec/protocol-runtime-work-orders/README.md "Persistence
 * convention"; spec/durable/execution.md §3/§4.
 */
export function openReservationsStore(options: ReservationsStoreOptions = {}): DurableDatabase {
  return openDurableDatabase({
    dbPath: options.dbPath ?? DEFAULT_RESERVATIONS_DB_PATH,
    migrationsDir: resolveReservationsMigrationsDir(options.migrationsDir),
  });
}

// ---------------------------------------------------------------------------
// Write path (the durable side of the ledger's committed artifacts)
// ---------------------------------------------------------------------------

const SQL_INSERT_ENTRY = `
  INSERT INTO reservation_ledger_entries (
    global_sequence, resource_sequence, resource_id, reservation_id, intent_id, hop_id,
    entry_kind, amount, deadline_epoch_ms, decision, reason_code, seq, wall_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (global_sequence) DO NOTHING
`;

const SQL_INSERT_RESERVATION = `
  INSERT INTO reservations (
    reservation_id, intent_id, hop_id, resource_id, amount, state, deadline_epoch_ms, reason_code,
    created_seq, created_wall_ms, state_seq, state_wall_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (reservation_id) DO NOTHING
`;

const SQL_UPDATE_RESERVATION = `
  UPDATE reservations
  SET state = ?, reason_code = ?, state_seq = ?, state_wall_ms = ?
  WHERE reservation_id = ?
`;

const SQL_INSERT_RESOURCE = `
  INSERT INTO reservation_resources (resource_id, declared_total, held_total, consumed_total)
  VALUES (?, ?, ?, ?)
  ON CONFLICT (resource_id) DO NOTHING
`;

const SQL_UPDATE_RESOURCE = `
  UPDATE reservation_resources
  SET held_total = ?, consumed_total = ?
  WHERE resource_id = ?
`;

/**
 * The outcome of one durable reservations-domain write: created is false
 * when the row already existed (the dedupe no-op — the same { created,
 * reason } shape the substrate's deduplicated enqueue and the sibling
 * domains' stores report).
 *
 * Source: INV-5-3 (core.md lines 310-312 — the storage-level dedupe this
 * outcome reports); DEP-003 §6 (the dedupe-report shape mirrored).
 */
export interface ReservationsStoreWrite {
  readonly created: boolean;
  readonly reason: 'written' | 'duplicate-no-op';
}

/**
 * Persist one committed ledger entry (INSERT-only: the log is append-only —
 * no update or delete companion exists; "Records are never updated or
 * deleted" is the ledger's own discipline).
 *
 * Source: core.md lines 293-295 (the serialized log), lines 316-318 (the
 * recorded decisions the persisted REQUESTED rows carry).
 */
export function writeLedgerEntry(
  store: DurableDatabase,
  entry: ReservationLedgerEntry,
): ReservationsStoreWrite {
  const result = store.prepare(SQL_INSERT_ENTRY).run(
    entry.globalSequence,
    entry.resourceSequence,
    entry.resourceId,
    entry.reservationId ?? null,
    entry.intentId ?? null,
    entry.hopId ?? null,
    entry.entryKind,
    entry.amount === undefined ? null : JSON.stringify(entry.amount),
    entry.deadlineEpochMs ?? null,
    entry.decision ?? null,
    entry.reasonCode ?? null,
    entry.at.sequence,
    entry.at.wallMs,
  );
  const created = Number(result.changes) === 1;
  return { created, reason: created ? 'written' : 'duplicate-no-op' };
}

/**
 * Persist one committed ReservationRecord (INSERT-only on identity; state
 * changes flow through saveReservationState). The schema's UNIQUE
 * (intent_id, hop_id, resource_id) makes the INV-5-3 derivation contract
 * structural.
 *
 * Source: core.md lines 286-289 (the record being persisted); INV-5-3
 * lines 310-312.
 */
export function writeReservationRecord(
  store: DurableDatabase,
  reservation: ReservationRecord,
): ReservationsStoreWrite {
  const result = store.prepare(SQL_INSERT_RESERVATION).run(
    reservation.reservationId,
    reservation.intentId,
    reservation.hopId,
    reservation.resourceId,
    JSON.stringify(reservation.amount),
    reservation.state,
    reservation.deadlineEpochMs,
    reservation.reasonCode ?? null,
    reservation.createdAt.sequence,
    reservation.createdAt.wallMs,
    reservation.stateChangedAt.sequence,
    reservation.stateChangedAt.wallMs,
  );
  const created = Number(result.changes) === 1;
  return { created, reason: created ? 'written' : 'duplicate-no-op' };
}

/**
 * Persist one committed reservation state change (the durable projection
 * of a HELD/CONSUMED/RELEASED/EXPIRED transition). Returns the number of
 * rows updated.
 *
 * Source: core.md lines 288-289 (the one-way machine this persists).
 */
export function saveReservationState(
  store: DurableDatabase,
  reservation: ReservationRecord,
): number {
  const result = store.prepare(SQL_UPDATE_RESERVATION).run(
    reservation.state,
    reservation.reasonCode ?? null,
    reservation.stateChangedAt.sequence,
    reservation.stateChangedAt.wallMs,
    reservation.reservationId,
  );
  return Number(result.changes);
}

/**
 * Persist one declared resource (INSERT-only on identity; accounting
 * changes flow through saveResourceAccounting). Held and consumed start
 * at zero in the declared unit.
 *
 * Source: INV-5-1 (core.md lines 304-306 — the declared total), lines
 * 335-336 (the resource owners).
 */
export function writeResourceRow(
  store: DurableDatabase,
  accounting: ResourceAccounting,
): ReservationsStoreWrite {
  const result = store.prepare(SQL_INSERT_RESOURCE).run(
    accounting.resourceId,
    JSON.stringify(accounting.declaredTotal),
    JSON.stringify(accounting.heldTotal),
    JSON.stringify(accounting.consumedTotal),
  );
  const created = Number(result.changes) === 1;
  return { created, reason: created ? 'written' : 'duplicate-no-op' };
}

/**
 * Persist one committed accounting change (the durable projection of the
 * INV-5-1 identity's held/consumed components after a transition).
 * Returns the number of rows updated.
 *
 * Source: INV-5-1 (core.md lines 304-306 — "the identity holds after every
 * transition").
 */
export function saveResourceAccounting(
  store: DurableDatabase,
  accounting: ResourceAccounting,
): number {
  const result = store.prepare(SQL_UPDATE_RESOURCE).run(
    JSON.stringify(accounting.heldTotal),
    JSON.stringify(accounting.consumedTotal),
    accounting.resourceId,
  );
  return Number(result.changes);
}

// ---------------------------------------------------------------------------
// Read path (reconstruction as the domain's frozen records)
// ---------------------------------------------------------------------------

interface EntryRow {
  global_sequence: number;
  resource_sequence: number;
  resource_id: string;
  reservation_id: string | null;
  intent_id: string | null;
  hop_id: string | null;
  entry_kind: string;
  amount: string | null;
  deadline_epoch_ms: number | null;
  decision: string | null;
  reason_code: string | null;
  seq: number;
  wall_ms: number;
}

interface ReservationRow {
  reservation_id: string;
  intent_id: string;
  hop_id: string;
  resource_id: string;
  amount: string;
  state: string;
  deadline_epoch_ms: number;
  reason_code: string | null;
  created_seq: number;
  created_wall_ms: number;
  state_seq: number;
  state_wall_ms: number;
}

interface ResourceRow {
  resource_id: string;
  declared_total: string;
  held_total: string;
  consumed_total: string;
}

function parseMoney(value: string, label: string): Money {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  return money(String(parsed['currency']), Number(parsed['amountMinor']), Number(parsed['scale']));
}

function parseEntryKind(value: string): ReservationEntryKind {
  if (!isReservationEntryKind(value)) {
    throw new TypeError(`reservations store: entry kind is invalid (got ${JSON.stringify(value)})`);
  }
  return value;
}

function parseState(value: string): ReservationState {
  if (!isReservationState(value)) {
    throw new TypeError(`reservations store: state is not a reservation state (got ${JSON.stringify(value)})`);
  }
  return value;
}

function parseReasonCode(value: string | null): ReservationReasonCode | undefined {
  if (value === null) {
    return undefined;
  }
  if (!isReservationReasonCode(value)) {
    throw new TypeError(`reservations store: reason code is invalid (got ${JSON.stringify(value)})`);
  }
  return value;
}

function asTime(seq: number, wallMs: number): ProtocolTime {
  return protocolTime(Number(seq), Number(wallMs));
}

/**
 * Read every persisted ledger entry back, in the ledger's total (global)
 * order, reconstructed as the domain's frozen ReservationLedgerEntry
 * records (Money re-minted through the kernel's money() guard — GC-1
 * holds on the read path). The persisted log — with its recorded REQUESTED
 * decisions — is the crash-recovery input.
 *
 * Source: core.md lines 293-295 (the log); lines 316-318 (crash
 * recovery); GC-1.
 */
export function readLedgerEntries(store: DurableDatabase): ReservationLedgerEntry[] {
  const rows = store
    .prepare(
      'SELECT global_sequence, resource_sequence, resource_id, reservation_id, intent_id, hop_id, ' +
        'entry_kind, amount, deadline_epoch_ms, decision, reason_code, seq, wall_ms ' +
        'FROM reservation_ledger_entries ORDER BY global_sequence ASC',
    )
    .all() as unknown as EntryRow[];
  return rows.map((row) =>
    Object.freeze({
      globalSequence: Number(row.global_sequence),
      resourceSequence: Number(row.resource_sequence),
      resourceId: row.resource_id,
      ...(row.reservation_id === null ? {} : { reservationId: row.reservation_id }),
      ...(row.intent_id === null ? {} : { intentId: row.intent_id }),
      ...(row.hop_id === null ? {} : { hopId: row.hop_id }),
      entryKind: parseEntryKind(row.entry_kind),
      ...(row.amount === null ? {} : { amount: parseMoney(row.amount, 'amount') }),
      ...(row.deadline_epoch_ms === null ? {} : { deadlineEpochMs: Number(row.deadline_epoch_ms) }),
      ...(row.decision === null ? {} : { decision: row.decision as 'HOLD' | 'REJECT' }),
      ...(row.reason_code === null ? {} : { reasonCode: parseReasonCode(row.reason_code) }),
      at: asTime(row.seq, row.wall_ms),
    }),
  );
}

/**
 * Read every persisted reservation back, in insertion order, reconstructed
 * as the domain's frozen ReservationRecord records.
 *
 * Source: core.md lines 286-289; INV-5-3 (the derived ids this read
 * returns).
 */
export function readReservations(store: DurableDatabase): ReservationRecord[] {
  const rows = store
    .prepare(
      'SELECT reservation_id, intent_id, hop_id, resource_id, amount, state, deadline_epoch_ms, ' +
        'reason_code, created_seq, created_wall_ms, state_seq, state_wall_ms FROM reservations ' +
        'ORDER BY created_seq ASC',
    )
    .all() as unknown as ReservationRow[];
  return rows.map((row) =>
    Object.freeze({
      reservationId: row.reservation_id,
      intentId: row.intent_id,
      hopId: row.hop_id,
      resourceId: row.resource_id,
      amount: parseMoney(row.amount, 'amount'),
      state: parseState(row.state),
      deadlineEpochMs: Number(row.deadline_epoch_ms),
      ...(row.reason_code === null ? {} : { reasonCode: parseReasonCode(row.reason_code) }),
      createdAt: asTime(row.created_seq, row.created_wall_ms),
      stateChangedAt: asTime(row.state_seq, row.state_wall_ms),
    }),
  );
}

/**
 * Read every persisted resource accounting back, in insertion order,
 * reconstructed as the domain's frozen ResourceAccounting records (held
 * and consumed re-minted at zero when absent — the accounting starts at
 * the identity's zero point).
 *
 * Source: INV-5-1 (core.md lines 304-306).
 */
export function readResourceAccountings(store: DurableDatabase): ResourceAccounting[] {
  const rows = store
    .prepare('SELECT resource_id, declared_total, held_total, consumed_total FROM reservation_resources')
    .all() as unknown as ResourceRow[];
  return rows.map((row) => {
    const declared = parseMoney(row.declared_total, 'declared_total');
    return Object.freeze({
      resourceId: row.resource_id,
      declaredTotal: declared,
      heldTotal: parseMoney(row.held_total, 'held_total'),
      consumedTotal: parseMoney(row.consumed_total, 'consumed_total'),
    });
  });
}

/**
 * Convenience bridge: persist the full current state of one ledger (every
 * entry, every reservation, every resource accounting) — the deployment
 * root's write-through composition for the reservations domain. Returns
 * the number of rows written.
 *
 * Source: the per-domain persistence convention (the durable side the
 * deployment root composes); core.md lines 286-306 (the artifacts).
 */
export function persistLedgerSnapshot(store: DurableDatabase, ledger: {
  readonly entries: readonly ReservationLedgerEntry[];
  readonly reservations: readonly ReservationRecord[];
  readonly resourceAccountings: readonly ResourceAccounting[];
}): { entries: number; reservations: number; resources: number } {
  let entryWrites = 0;
  for (const entry of ledger.entries) {
    if (writeLedgerEntry(store, entry).created) {
      entryWrites += 1;
    }
  }
  let reservationWrites = 0;
  for (const reservation of ledger.reservations) {
    if (writeReservationRecord(store, reservation).created) {
      reservationWrites += 1;
    } else {
      saveReservationState(store, reservation);
    }
  }
  let resourceWrites = 0;
  for (const accounting of ledger.resourceAccountings) {
    if (writeResourceRow(store, accounting).created) {
      resourceWrites += 1;
    } else {
      saveResourceAccounting(store, accounting);
    }
  }
  return { entries: entryWrites, reservations: reservationWrites, resources: resourceWrites };
}

/**
 * Rebuild a fresh resource-accounting triple from a persisted declared
 * total (the read-side helper for reconstructing accounting rows that
 * predate an entries replay).
 *
 * Source: INV-5-1 (core.md lines 304-306 — the zero point).
 */
export function accountingFromDeclared(resourceId: string, declaredTotal: Money): ResourceAccounting {
  return initialResourceAccounting(resourceId, declaredTotal);
}
