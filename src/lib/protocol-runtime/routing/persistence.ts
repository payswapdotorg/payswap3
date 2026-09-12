/**
 * RTN-006 — Routing Authority: per-domain persistence.
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
 * object-store + durable-bridge split for the routing domain: ONE SQLite
 * database (default var/routing.sqlite) opened through the substrate's
 * openDurableDatabase, migrations in this domain's OWNED prefix, and
 * write-through bridge functions persisting the authority's committed
 * records plus read-back reconstruction (Money re-minted through the
 * kernel's money() guard — GC-1's integer discipline holds on the read
 * path too).
 *
 * DEP-003 integration is READ-ONLY: this module imports the db API from
 * src/lib/durable/db.ts and never modifies the substrate.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/core.md §4 Area 4 lines 221-230 (RoutePlan,
 *     RouteCompiler — the records being persisted; the pinned compiler
 *     version recorded in every plan row);
 *   lines 248-249 (INV-4-3 — the storage-level UNIQUE (intent_id,
 *     compiler_version, snapshot_id) that makes the compilation-key
 *     contract structural);
 *   lines 253-254 (NO_VIABLE_ROUTE's area-24 demand signal — the durable
 *     signal rows, with the emission point recorded);
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
import type { Corridor } from '../capability/types.ts';
import type {
  ConversionLineItem,
  FeeLineItem,
  HopReservationRef,
  RouteDemandSignal,
  RouteHop,
  RoutePlan,
  RoutePlanState,
  RouteValueLedger,
  UnknownHopRef,
} from './types.ts';
import { isRoutePlanState } from './types.ts';

/**
 * Default filesystem path of the routing-domain store, relative to the
 * process working directory (mirrors the substrate's var/durable.sqlite
 * and the sibling domains' defaults; spec/durable/execution.md §2 lines
 * 40-43). var/ is a runtime artifact directory and is gitignored.
 *
 * Source: the per-domain persistence convention; DEP-003 §2 lines 40-43.
 */
export const DEFAULT_ROUTING_DB_PATH = 'var/routing.sqlite';

/**
 * Environment variable overriding the routing migrations directory
 * (mirrors the substrate's PAYSWAP_MIGRATIONS_DIR and the sibling domains'
 * variables; spec/durable/execution.md §2 lines 44-47). In a deployed
 * image the migrations directory must ship with the application — the
 * runner fails closed when it cannot find migrations.
 *
 * Source: DEP-003 §2 lines 44-47; the per-domain convention.
 */
export const ROUTING_MIGRATIONS_DIR_ENV_VAR = 'PAYSWAP_ROUTING_MIGRATIONS_DIR';

/** The routing domain's owned migration directory, relative to the repository root. */
export const ROUTING_MIGRATIONS_RELATIVE_DIR = join('src', 'lib', 'protocol-runtime', 'routing', 'migrations');

/** The routing domain's owner identity (for rows the domain itself records). */
export const ROUTING_STORE_DOMAIN = 'protocol-runtime-routing';

/**
 * Resolve the routing migrations directory (explicit argument, then the
 * environment variable, then the 8-level walk-up, then the cwd-relative
 * fallback that fails closed inside the runner) — the same strategy the
 * substrate, the kernel, and the sibling domains use.
 *
 * Source: DEP-003 migration conventions (spec/durable/execution.md §2/§4);
 * the per-domain persistence convention.
 */
export function resolveRoutingMigrationsDir(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return resolve(explicit);
  }
  const fromEnv = process.env[ROUTING_MIGRATIONS_DIR_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return resolve(fromEnv.trim());
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, ROUTING_MIGRATIONS_RELATIVE_DIR);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(process.cwd(), ROUTING_MIGRATIONS_RELATIVE_DIR);
}

/**
 * Options for opening the routing-domain store.
 *
 * Source: the per-domain persistence convention; option shape mirrors the
 * substrate's DurableDatabaseOptions.
 */
export interface RoutingStoreOptions {
  /** Default: var/routing.sqlite (created on demand; never committed). */
  dbPath?: string;
  /** Explicit migrations directory. Default: resolveRoutingMigrationsDir(). */
  migrationsDir?: string;
}

/**
 * Open the routing-domain store THROUGH the DEP-003 database layer
 * (read-only integration): the substrate's crash-safety pragmas and
 * migration runner over this domain's owned migrations.
 *
 * Source: spec/protocol-runtime-work-orders/README.md "Persistence
 * convention"; spec/durable/execution.md §3/§4.
 */
export function openRoutingStore(options: RoutingStoreOptions = {}): DurableDatabase {
  return openDurableDatabase({
    dbPath: options.dbPath ?? DEFAULT_ROUTING_DB_PATH,
    migrationsDir: resolveRoutingMigrationsDir(options.migrationsDir),
  });
}

// ---------------------------------------------------------------------------
// Write path (the durable side of the authority's committed records)
// ---------------------------------------------------------------------------

const SQL_INSERT_PLAN = `
  INSERT INTO route_plans (
    plan_id, intent_id, compiler_version, snapshot_id, state, hops, value_ledger,
    deadline_epoch_ms, reservation_refs, unknown_hops,
    created_seq, created_wall_ms, state_seq, state_wall_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (plan_id) DO NOTHING
`;

const SQL_UPDATE_PLAN = `
  UPDATE route_plans
  SET state = ?, reservation_refs = ?, unknown_hops = ?, state_seq = ?, state_wall_ms = ?
  WHERE plan_id = ?
`;

const SQL_INSERT_SIGNAL = `
  INSERT INTO route_demand_signals (
    signal_id, intent_id, compiler_version, snapshot_id, requested_corridor, amount,
    emission_record_id, emitted_seq, emitted_wall_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (signal_id) DO NOTHING
`;

/**
 * The outcome of one durable routing-domain write: created is false when
 * the row already existed (the dedupe no-op — the same { created, reason }
 * shape the substrate's deduplicated enqueue and the sibling domains'
 * stores report).
 *
 * Source: INV-4-3 (core.md lines 248-249 — the storage-level dedupe this
 * outcome reports); DEP-003 §6 (the dedupe-report shape mirrored).
 */
export interface RoutingStoreWrite {
  readonly created: boolean;
  readonly reason: 'written' | 'duplicate-no-op';
}

/**
 * Persist one committed RoutePlan (INSERT-only on identity; state and
 * annotation changes flow through saveRoutePlanState, never a second row).
 *
 * Source: core.md lines 221-230 (the record being persisted).
 */
export function writeRoutePlan(store: DurableDatabase, plan: RoutePlan): RoutingStoreWrite {
  const result = store.prepare(SQL_INSERT_PLAN).run(
    plan.planId,
    plan.intentId,
    plan.compilerVersion,
    plan.snapshotId,
    plan.state,
    JSON.stringify(plan.hops),
    JSON.stringify(plan.valueLedger),
    plan.deadlineEpochMs,
    JSON.stringify(plan.reservationRefs),
    JSON.stringify(plan.unknownHops),
    plan.createdAt.sequence,
    plan.createdAt.wallMs,
    plan.stateChangedAt.sequence,
    plan.stateChangedAt.wallMs,
  );
  const created = Number(result.changes) === 1;
  return { created, reason: created ? 'written' : 'duplicate-no-op' };
}

/**
 * Persist one committed plan state, reservation-reference, or halt-
 * annotation change (the durable projection of a ROUTE_* transition).
 * Returns the number of rows updated.
 *
 * Source: core.md lines 224-225 (the one-way machine this persists);
 * lines 255-259 (the halt annotations carried alongside).
 */
export function saveRoutePlanState(store: DurableDatabase, plan: RoutePlan): number {
  const result = store.prepare(SQL_UPDATE_PLAN).run(
    plan.state,
    JSON.stringify(plan.reservationRefs),
    JSON.stringify(plan.unknownHops),
    plan.stateChangedAt.sequence,
    plan.stateChangedAt.wallMs,
    plan.planId,
  );
  return Number(result.changes);
}

/**
 * Persist one emitted RouteDemandSignal (INSERT-only: the signal is a
 * durable recorded fact with its emission point; no update or delete
 * companion exists). The schema's UNIQUE (intent_id, compiler_version,
 * snapshot_id) makes the exactly-one-signal-per-compilation-key contract
 * structural.
 *
 * Source: core.md lines 253-254 ("also emits a demand signal for area 24");
 * INV-4-3 lines 248-249 (the compilation key).
 */
export function writeRouteDemandSignal(
  store: DurableDatabase,
  signal: RouteDemandSignal,
): RoutingStoreWrite {
  const result = store.prepare(SQL_INSERT_SIGNAL).run(
    signal.signalId,
    signal.intentId,
    signal.compilerVersion,
    signal.snapshotId,
    JSON.stringify(signal.requestedCorridor),
    JSON.stringify(signal.amount),
    signal.emissionPointRecordId,
    signal.emittedAt.sequence,
    signal.emittedAt.wallMs,
  );
  const created = Number(result.changes) === 1;
  return { created, reason: created ? 'written' : 'duplicate-no-op' };
}

// ---------------------------------------------------------------------------
// Read path (reconstruction as the domain's frozen records)
// ---------------------------------------------------------------------------

interface PlanRow {
  plan_id: string;
  intent_id: string;
  compiler_version: number;
  snapshot_id: string;
  state: string;
  hops: string;
  value_ledger: string;
  deadline_epoch_ms: number;
  reservation_refs: string;
  unknown_hops: string;
  created_seq: number;
  created_wall_ms: number;
  state_seq: number;
  state_wall_ms: number;
}

interface SignalRow {
  signal_id: string;
  intent_id: string;
  compiler_version: number;
  snapshot_id: string;
  requested_corridor: string;
  amount: string;
  emission_record_id: string;
  emitted_seq: number;
  emitted_wall_ms: number;
}

function parseMoney(value: string, label: string): Money {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  return money(String(parsed['currency']), Number(parsed['amountMinor']), Number(parsed['scale']));
}

function parseCorridor(value: unknown): Corridor {
  if (value === null || typeof value !== 'object') {
    throw new TypeError(`routing store: corridor is not an object (${JSON.stringify(value)})`);
  }
  const corridor = value as Record<string, unknown>;
  return {
    sourceCurrency: String(corridor['sourceCurrency']),
    destinationCurrency: String(corridor['destinationCurrency']),
    sourceGeography: String(corridor['sourceGeography']),
    destinationGeography: String(corridor['destinationGeography']),
  };
}

function parsePlanState(value: string): RoutePlanState {
  if (!isRoutePlanState(value)) {
    throw new TypeError(`routing store: state is not a route plan state (got ${JSON.stringify(value)})`);
  }
  return value;
}

function parseHops(value: string): RouteHop[] {
  const parsed = JSON.parse(value) as unknown[];
  return parsed.map((entry, position) => {
    if (entry === null || typeof entry !== 'object') {
      throw new TypeError(`routing store: hop at position ${position} is not an object`);
    }
    const record = entry as Record<string, unknown>;
    return {
      hopId: String(record['hopId']),
      position: Number(record['position']),
      capabilityId: String(record['capabilityId']),
      railId: String(record['railId']),
      corridor: parseCorridor(record['corridor']),
      amount: parseMoney(JSON.stringify(record['amount']), `hops[${position}].amount`),
      settlementSemantics: String(record['settlementSemantics']),
    };
  });
}

function parseValueLedger(value: string): RouteValueLedger {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  const conversions = (parsed['conversions'] as unknown[]).map((entry) => {
    const record = entry as Record<string, unknown>;
    return {
      hopId: String(record['hopId']),
      fromAmount: parseMoney(JSON.stringify(record['fromAmount']), 'conversion.fromAmount'),
      toAmount: parseMoney(JSON.stringify(record['toAmount']), 'conversion.toAmount'),
    } satisfies ConversionLineItem;
  });
  const fees = (parsed['fees'] as unknown[]).map((entry) => {
    const record = entry as Record<string, unknown>;
    return {
      hopId: String(record['hopId']),
      fee: parseMoney(JSON.stringify(record['fee']), 'fee.fee'),
    } satisfies FeeLineItem;
  });
  return {
    sourceAmount: parseMoney(JSON.stringify(parsed['sourceAmount']), 'sourceAmount'),
    deliveredAmount: parseMoney(JSON.stringify(parsed['deliveredAmount']), 'deliveredAmount'),
    conversions: Object.freeze(conversions),
    fees: Object.freeze(fees),
  };
}

function parseReservationRefs(value: string): HopReservationRef[] {
  const parsed = JSON.parse(value) as unknown[];
  return parsed.map((entry) => {
    const record = entry as Record<string, unknown>;
    return {
      hopId: String(record['hopId']),
      reservationId: String(record['reservationId']),
    } satisfies HopReservationRef;
  });
}

function parseUnknownHops(value: string): UnknownHopRef[] {
  const parsed = JSON.parse(value) as unknown[];
  return parsed.map((entry) => {
    const record = entry as Record<string, unknown>;
    const halted = record['haltedAt'] as Record<string, unknown>;
    const resolvedAt = record['resolvedAt'] as Record<string, unknown> | undefined;
    const resolvedOutcome = record['resolvedOutcome'];
    return {
      hopId: String(record['hopId']),
      railOperationId: String(record['railOperationId']),
      haltedAt: protocolTime(Number(halted['sequence']), Number(halted['wallMs'])),
      ...(resolvedAt === undefined
        ? {}
        : {
            resolvedAt: protocolTime(Number(resolvedAt['sequence']), Number(resolvedAt['wallMs'])),
          }),
      ...(resolvedOutcome === undefined
        ? {}
        : { resolvedOutcome: String(resolvedOutcome) as 'CONFIRMED' | 'FAILED' }),
    } satisfies UnknownHopRef;
  });
}

function asTime(seq: number, wallMs: number): ProtocolTime {
  return protocolTime(Number(seq), Number(wallMs));
}

/**
 * Read every persisted plan back, in insertion order, reconstructed as the
 * domain's frozen RoutePlan records (Money re-minted through the kernel's
 * money() guard — GC-1 holds on the read path).
 *
 * Source: core.md lines 221-230 (the records this read reconstructs); GC-1
 * (README.md §3 lines 39-43).
 */
export function readRoutePlans(store: DurableDatabase): RoutePlan[] {
  const rows = store
    .prepare(
      'SELECT plan_id, intent_id, compiler_version, snapshot_id, state, hops, value_ledger, ' +
        'deadline_epoch_ms, reservation_refs, unknown_hops, created_seq, created_wall_ms, ' +
        'state_seq, state_wall_ms FROM route_plans ORDER BY created_seq ASC',
    )
    .all() as unknown as PlanRow[];
  return rows.map((row) =>
    Object.freeze({
      planId: row.plan_id,
      intentId: row.intent_id,
      compilerVersion: Number(row.compiler_version),
      snapshotId: row.snapshot_id,
      state: parsePlanState(row.state),
      hops: Object.freeze(parseHops(row.hops)),
      valueLedger: Object.freeze(parseValueLedger(row.value_ledger)),
      deadlineEpochMs: Number(row.deadline_epoch_ms),
      reservationRefs: Object.freeze(parseReservationRefs(row.reservation_refs)),
      unknownHops: Object.freeze(parseUnknownHops(row.unknown_hops)),
      createdAt: asTime(row.created_seq, row.created_wall_ms),
      stateChangedAt: asTime(row.state_seq, row.state_wall_ms),
    }),
  );
}

/**
 * Read every persisted demand signal back, in emission order, reconstructed
 * as the domain's frozen RouteDemandSignal records (the area-24 input, with
 * the emission point recorded).
 *
 * Source: core.md lines 253-254.
 */
export function readRouteDemandSignals(store: DurableDatabase): RouteDemandSignal[] {
  const rows = store
    .prepare(
      'SELECT signal_id, intent_id, compiler_version, snapshot_id, requested_corridor, amount, ' +
        'emission_record_id, emitted_seq, emitted_wall_ms FROM route_demand_signals ' +
        'ORDER BY emitted_seq ASC',
    )
    .all() as unknown as SignalRow[];
  return rows.map((row) =>
    Object.freeze({
      signalId: row.signal_id,
      intentId: row.intent_id,
      compilerVersion: Number(row.compiler_version),
      snapshotId: row.snapshot_id,
      requestedCorridor: parseCorridor(JSON.parse(row.requested_corridor)),
      amount: parseMoney(row.amount, 'amount'),
      emissionPointRecordId: row.emission_record_id,
      emittedAt: asTime(row.emitted_seq, row.emitted_wall_ms),
    }),
  );
}
