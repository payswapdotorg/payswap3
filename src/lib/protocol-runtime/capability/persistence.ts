/**
 * RTN-005 — Capability Authority: per-domain persistence.
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
 * runtime/kernel/persistence.ts) and the RTN-002 evidence domain's
 * in-process-object-store + durable-bridge split for the capability
 * domain: ONE SQLite database (default var/capability.sqlite) opened
 * through the substrate's openDurableDatabase, migrations in this domain's
 * OWNED prefix, and write-through bridge functions persisting the
 * authority's committed records plus read-back reconstruction (Money
 * re-minted through the kernel's money() guard — GC-1's integer discipline
 * holds on the read path too).
 *
 * DEP-003 integration is READ-ONLY: this module imports the db API from
 * src/lib/durable/db.ts and never modifies the substrate.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/core.md §3 Area 3 lines 154-166 (Capability,
 *   Commitment, CapabilitySnapshot — the records being persisted); lines
 *   176-184 (INV-3-1/INV-3-2/INV-3-3 — the storage-level UNIQUE and
 *   non-negative constraints that make the contracts structural);
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
import type {
  CapabilityDeclaration,
  CapabilityRecord,
  CapabilitySnapshot,
  CapabilitySnapshotEntry,
  CapabilityState,
  CommitmentRecord,
  CommitmentState,
  Corridor,
} from './types.ts';
import {
  isCapabilityState,
  isCommitmentState,
} from './types.ts';

/**
 * Default filesystem path of the capability-domain store, relative to the
 * process working directory (mirrors the substrate's var/durable.sqlite
 * and the sibling domains' defaults; spec/durable/execution.md §2 lines
 * 40-43). var/ is a runtime artifact directory and is gitignored.
 *
 * Source: the per-domain persistence convention; DEP-003 §2 lines 40-43.
 */
export const DEFAULT_CAPABILITY_DB_PATH = 'var/capability.sqlite';

/**
 * Environment variable overriding the capability migrations directory
 * (mirrors the substrate's PAYSWAP_MIGRATIONS_DIR and the sibling domains'
 * variables; spec/durable/execution.md §2 lines 44-47). In a deployed
 * image the migrations directory must ship with the application — the
 * runner fails closed when it cannot find migrations.
 *
 * Source: DEP-003 §2 lines 44-47; the per-domain convention.
 */
export const CAPABILITY_MIGRATIONS_DIR_ENV_VAR = 'PAYSWAP_CAPABILITY_MIGRATIONS_DIR';

/** The capability domain's owned migration directory, relative to the repository root. */
export const CAPABILITY_MIGRATIONS_RELATIVE_DIR = join('src', 'lib', 'protocol-runtime', 'capability', 'migrations');

/** The capability domain's owner identity (for rows the domain itself records). */
export const CAPABILITY_STORE_DOMAIN = 'protocol-runtime-capability';

/**
 * Resolve the capability migrations directory (explicit argument, then the
 * environment variable, then the 8-level walk-up, then the cwd-relative
 * fallback that fails closed inside the runner) — the same strategy the
 * substrate, the kernel, and the sibling domains use.
 *
 * Source: DEP-003 migration conventions (spec/durable/execution.md §2/§4);
 * the per-domain persistence convention.
 */
export function resolveCapabilityMigrationsDir(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return resolve(explicit);
  }
  const fromEnv = process.env[CAPABILITY_MIGRATIONS_DIR_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return resolve(fromEnv.trim());
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, CAPABILITY_MIGRATIONS_RELATIVE_DIR);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(process.cwd(), CAPABILITY_MIGRATIONS_RELATIVE_DIR);
}

/**
 * Options for opening the capability-domain store.
 *
 * Source: the per-domain persistence convention; option shape mirrors the
 * substrate's DurableDatabaseOptions.
 */
export interface CapabilityStoreOptions {
  /** Default: var/capability.sqlite (created on demand; never committed). */
  dbPath?: string;
  /** Explicit migrations directory. Default: resolveCapabilityMigrationsDir(). */
  migrationsDir?: string;
}

/**
 * Open the capability-domain store THROUGH the DEP-003 database layer
 * (read-only integration): the substrate's crash-safety pragmas and
 * migration runner over this domain's owned migrations.
 *
 * Source: spec/protocol-runtime-work-orders/README.md "Persistence
 * convention"; spec/durable/execution.md §3/§4.
 */
export function openCapabilityStore(options: CapabilityStoreOptions = {}): DurableDatabase {
  return openDurableDatabase({
    dbPath: options.dbPath ?? DEFAULT_CAPABILITY_DB_PATH,
    migrationsDir: resolveCapabilityMigrationsDir(options.migrationsDir),
  });
}

// ---------------------------------------------------------------------------
// Write path (the durable side of the authority's committed records)
// ---------------------------------------------------------------------------

const SQL_INSERT_CAPABILITY = `
  INSERT INTO capabilities (
    capability_id, state, declaration, declared_capacity, reserved_total, consumed_total,
    created_seq, created_wall_ms, state_seq, state_wall_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (capability_id) DO NOTHING
`;

const SQL_UPDATE_CAPABILITY = `
  UPDATE capabilities
  SET state = ?, reserved_total = ?, consumed_total = ?, state_seq = ?, state_wall_ms = ?
  WHERE capability_id = ?
`;

const SQL_INSERT_COMMITMENT = `
  INSERT INTO commitments (
    commitment_id, intent_id, capability_id, amount, state, deadline_epoch_ms,
    created_seq, created_wall_ms, state_seq, state_wall_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (commitment_id) DO NOTHING
`;

const SQL_UPDATE_COMMITMENT = `
  UPDATE commitments
  SET state = ?, state_seq = ?, state_wall_ms = ?
  WHERE commitment_id = ?
`;

const SQL_INSERT_SNAPSHOT = `
  INSERT INTO capability_snapshots (sequence, snapshot_id, wall_ms, entries)
  VALUES (?, ?, ?, ?)
  ON CONFLICT (sequence) DO NOTHING
`;

/**
 * The outcome of one durable capability-domain write: created is false
 * when the row already existed (the dedupe no-op — the same { created,
 * reason } shape the substrate's deduplicated enqueue and the sibling
 * domains' stores report).
 *
 * Source: INV-3-3 (core.md lines 182-184 — the storage-level dedupe this
 * outcome reports); DEP-003 §6 (the dedupe-report shape mirrored).
 */
export interface CapabilityStoreWrite {
  readonly created: boolean;
  readonly reason: 'written' | 'duplicate-no-op';
}

/**
 * Persist one committed CapabilityRecord (INSERT-only on identity; state
 * and accounting changes flow through saveCapabilityState, never a second
 * row).
 *
 * Source: core.md lines 154-158 (the record being persisted).
 */
export function writeCapabilityRecord(
  store: DurableDatabase,
  capability: CapabilityRecord,
): CapabilityStoreWrite {
  const result = store.prepare(SQL_INSERT_CAPABILITY).run(
    capability.capabilityId,
    capability.state,
    JSON.stringify(capability.declaration),
    JSON.stringify(capability.declaredCapacity),
    JSON.stringify(capability.reservedTotal),
    JSON.stringify(capability.consumedTotal),
    capability.createdAt.sequence,
    capability.createdAt.wallMs,
    capability.stateChangedAt.sequence,
    capability.stateChangedAt.wallMs,
  );
  const created = Number(result.changes) === 1;
  return { created, reason: created ? 'written' : 'duplicate-no-op' };
}

/**
 * Persist one committed capability state or accounting change (the durable
 * projection of a CAPABILITY_STATE_CHANGED or COMMITMENT_* transition's
 * accounting side). Returns the number of rows updated.
 *
 * Source: core.md lines 156-158 (state), INV-3-1/INV-3-2 (accounting
 * updated atomically with commitment state).
 */
export function saveCapabilityState(
  store: DurableDatabase,
  capability: CapabilityRecord,
): number {
  const result = store.prepare(SQL_UPDATE_CAPABILITY).run(
    capability.state,
    JSON.stringify(capability.reservedTotal),
    JSON.stringify(capability.consumedTotal),
    capability.stateChangedAt.sequence,
    capability.stateChangedAt.wallMs,
    capability.capabilityId,
  );
  return Number(result.changes);
}

/**
 * Persist one committed CommitmentRecord (INSERT-only on identity; state
 * changes flow through saveCommitmentState). The schema's UNIQUE
 * (intent_id, capability_id) makes the INV-3-3 one-commitment-per-pair
 * contract structural: a duplicate is a no-op row-wise and a typed failure
 * at the authority level.
 *
 * Source: core.md lines 160-163; INV-3-3 (lines 182-184).
 */
export function writeCommitmentRecord(
  store: DurableDatabase,
  commitment: CommitmentRecord,
): CapabilityStoreWrite {
  const result = store.prepare(SQL_INSERT_COMMITMENT).run(
    commitment.commitmentId,
    commitment.intentId,
    commitment.capabilityId,
    JSON.stringify(commitment.amount),
    commitment.state,
    commitment.deadlineEpochMs,
    commitment.createdAt.sequence,
    commitment.createdAt.wallMs,
    commitment.stateChangedAt.sequence,
    commitment.stateChangedAt.wallMs,
  );
  const created = Number(result.changes) === 1;
  return { created, reason: created ? 'written' : 'duplicate-no-op' };
}

/**
 * Persist one committed commitment state change (the durable projection of
 * a COMMITMENT_* transition). Returns the number of rows updated.
 *
 * Source: core.md lines 160-163 (the one-way machine this persists).
 */
export function saveCommitmentState(store: DurableDatabase, commitment: CommitmentRecord): number {
  const result = store.prepare(SQL_UPDATE_COMMITMENT).run(
    commitment.state,
    commitment.stateChangedAt.sequence,
    commitment.stateChangedAt.wallMs,
    commitment.commitmentId,
  );
  return Number(result.changes);
}

/**
 * Persist one minted CapabilitySnapshot (INSERT-only: the snapshot is
 * immutable — no update or delete companion exists).
 *
 * Source: core.md lines 165-166 ("immutable, sequenced view").
 */
export function writeCapabilitySnapshot(
  store: DurableDatabase,
  snapshot: CapabilitySnapshot,
): CapabilityStoreWrite {
  const result = store.prepare(SQL_INSERT_SNAPSHOT).run(
    snapshot.sequence,
    snapshot.snapshotId,
    snapshot.wallMs,
    JSON.stringify(snapshot.capabilities),
  );
  const created = Number(result.changes) === 1;
  return { created, reason: created ? 'written' : 'duplicate-no-op' };
}

// ---------------------------------------------------------------------------
// Read path (reconstruction as the domain's frozen records)
// ---------------------------------------------------------------------------

interface CapabilityRow {
  capability_id: string;
  state: string;
  declaration: string;
  declared_capacity: string;
  reserved_total: string;
  consumed_total: string;
  created_seq: number;
  created_wall_ms: number;
  state_seq: number;
  state_wall_ms: number;
}

interface CommitmentRow {
  commitment_id: string;
  intent_id: string;
  capability_id: string;
  amount: string;
  state: string;
  deadline_epoch_ms: number;
  created_seq: number;
  created_wall_ms: number;
  state_seq: number;
  state_wall_ms: number;
}

interface SnapshotRow {
  sequence: number;
  snapshot_id: string;
  wall_ms: number;
  entries: string;
}

function parseMoney(value: string, label: string): Money {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  return money(String(parsed['currency']), Number(parsed['amountMinor']), Number(parsed['scale']));
}

function parseCorridor(value: unknown): Corridor {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('capability store: declaration.corridor is not an object');
  }
  const corridor = value as Record<string, unknown>;
  return {
    sourceCurrency: String(corridor['sourceCurrency']),
    destinationCurrency: String(corridor['destinationCurrency']),
    sourceGeography: String(corridor['sourceGeography']),
    destinationGeography: String(corridor['destinationGeography']),
  };
}

function parseDeclaration(value: string): CapabilityDeclaration {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  return {
    railId: String(parsed['railId']),
    corridor: parseCorridor(parsed['corridor']),
    costSchedule: parseMoney(JSON.stringify(parsed['costSchedule']), 'costSchedule'),
    tier: String(parsed['tier']),
  };
}

function parseCapabilityState(value: string): CapabilityState {
  if (!isCapabilityState(value)) {
    throw new TypeError(`capability store: state is not a capability state (got ${JSON.stringify(value)})`);
  }
  return value;
}

function parseCommitmentState(value: string): CommitmentState {
  if (!isCommitmentState(value)) {
    throw new TypeError(`capability store: commitment state is invalid (got ${JSON.stringify(value)})`);
  }
  return value;
}

function asTime(seq: number, wallMs: number): ProtocolTime {
  return protocolTime(Number(seq), Number(wallMs));
}

/**
 * Read every persisted capability back, in insertion order, reconstructed
 * as the domain's frozen CapabilityRecord records (Money re-minted through
 * the kernel's money() guard — GC-1 holds on the read path).
 *
 * Source: core.md lines 154-158; GC-1 (README.md §3 lines 39-43).
 */
export function readCapabilities(store: DurableDatabase): CapabilityRecord[] {
  const rows = store
    .prepare(
      'SELECT capability_id, state, declaration, declared_capacity, reserved_total, consumed_total, ' +
        'created_seq, created_wall_ms, state_seq, state_wall_ms FROM capabilities ORDER BY created_seq ASC',
    )
    .all() as unknown as CapabilityRow[];
  return rows.map((row) =>
    Object.freeze({
      capabilityId: row.capability_id,
      state: parseCapabilityState(row.state),
      declaration: Object.freeze(parseDeclaration(row.declaration)),
      declaredCapacity: parseMoney(row.declared_capacity, 'declared_capacity'),
      reservedTotal: parseMoney(row.reserved_total, 'reserved_total'),
      consumedTotal: parseMoney(row.consumed_total, 'consumed_total'),
      createdAt: asTime(row.created_seq, row.created_wall_ms),
      stateChangedAt: asTime(row.state_seq, row.state_wall_ms),
    }),
  );
}

/**
 * Read every persisted commitment back, in insertion order, reconstructed
 * as the domain's frozen CommitmentRecord records.
 *
 * Source: core.md lines 160-163; INV-3-3 (the derived ids this read
 * returns).
 */
export function readCommitments(store: DurableDatabase): CommitmentRecord[] {
  const rows = store
    .prepare(
      'SELECT commitment_id, intent_id, capability_id, amount, state, deadline_epoch_ms, ' +
        'created_seq, created_wall_ms, state_seq, state_wall_ms FROM commitments ORDER BY created_seq ASC',
    )
    .all() as unknown as CommitmentRow[];
  return rows.map((row) =>
    Object.freeze({
      commitmentId: row.commitment_id,
      intentId: row.intent_id,
      capabilityId: row.capability_id,
      amount: parseMoney(row.amount, 'amount'),
      state: parseCommitmentState(row.state),
      deadlineEpochMs: Number(row.deadline_epoch_ms),
      createdAt: asTime(row.created_seq, row.created_wall_ms),
      stateChangedAt: asTime(row.state_seq, row.state_wall_ms),
    }),
  );
}

/**
 * Read every persisted snapshot back, in sequence order, reconstructed as
 * the domain's frozen CapabilitySnapshot records (entries re-minted and
 * re-frozen — the immutable view survives the round trip).
 *
 * Source: core.md lines 165-166 ("immutable, sequenced view").
 */
export function readCapabilitySnapshots(store: DurableDatabase): CapabilitySnapshot[] {
  const rows = store
    .prepare('SELECT sequence, snapshot_id, wall_ms, entries FROM capability_snapshots ORDER BY sequence ASC')
    .all() as unknown as SnapshotRow[];
  return rows.map((row) => {
    const entries = JSON.parse(row.entries) as unknown[];
    const parsed = entries.map((entry) => {
      const record = entry as Record<string, unknown>;
      return Object.freeze({
        capabilityId: String(record['capabilityId']),
        railId: String(record['railId']),
        corridor: parseCorridor(record['corridor']),
        state: parseCapabilityState(String(record['state'])),
        declaredCapacity: parseMoney(JSON.stringify(record['declaredCapacity']), 'declaredCapacity'),
        reservedTotal: parseMoney(JSON.stringify(record['reservedTotal']), 'reservedTotal'),
        consumedTotal: parseMoney(JSON.stringify(record['consumedTotal']), 'consumedTotal'),
        availableCapacity: parseMoney(JSON.stringify(record['availableCapacity']), 'availableCapacity'),
        costSchedule: parseMoney(JSON.stringify(record['costSchedule']), 'costSchedule'),
        tier: String(record['tier']),
      }) satisfies CapabilitySnapshotEntry;
    });
    return Object.freeze({
      snapshotId: row.snapshot_id,
      sequence: Number(row.sequence),
      wallMs: Number(row.wall_ms),
      capabilities: Object.freeze(parsed),
    });
  });
}
