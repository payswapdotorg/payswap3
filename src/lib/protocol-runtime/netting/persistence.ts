/**
 * RTN-009 — Netting Authority: the per-domain durable store (the
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
 * Mechanically (the kernel's persistence.ts template, the RTN-007/RTN-008
 * sibling templates): one SQLite database opened through the substrate's
 * openDurableDatabase({ dbPath, migrationsDir }), migrations in the owned
 * prefix src/lib/protocol-runtime/netting/migrations/, domain database
 * file var/netting.sqlite.
 *
 * Spec sources of the persisted records:
 *   - clearing-netting-settlement.md §3 Area 11 lines 157-170 (NettingSet,
 *     NetPosition, NettingScope — the persisted record shapes), lines
 *     180-189 (INV-11-1: the recorded conservation proof; INV-11-3: the
 *     fixed input ids + algorithm version).
 *   - lines 161-166 (the net obligations materialized in the netting
 *     domain — the types.ts recorded interpretation).
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
  GrossObligationSnapshot,
  NetObligationRecord,
  NetPosition,
  NettingSetRecord,
  ConservationProof,
  CurrencyConservationRecord,
} from './types.ts';

/**
 * Default filesystem path of the netting-domain store (mirrors the
 * substrate's var/durable.sqlite and the sibling domains' defaults).
 * var/ is a runtime artifact directory and is gitignored.
 *
 * Source: the per-domain persistence convention; DEP-003 §2 lines 40-43.
 */
export const DEFAULT_NETTING_DB_PATH = 'var/netting.sqlite';

/**
 * Environment variable overriding the netting migrations directory
 * (mirrors the substrate's PAYSWAP_MIGRATIONS_DIR and the sibling
 * domains' variables).
 *
 * Source: DEP-003 §2 lines 44-47; the per-domain convention.
 */
export const NETTING_MIGRATIONS_DIR_ENV_VAR = 'PAYSWAP_NETTING_MIGRATIONS_DIR';

/** The netting domain's owned migration directory, relative to the repository root. */
export const NETTING_MIGRATIONS_RELATIVE_DIR = join(
  'src',
  'lib',
  'protocol-runtime',
  'netting',
  'migrations',
);

/** The netting domain's owner identity. */
export const NETTING_STORE_DOMAIN = 'protocol-runtime-netting';

/**
 * Resolve the netting migrations directory (explicit argument, then the
 * environment variable, then the 8-level walk-up, then the cwd-relative
 * fallback that fails closed inside the runner).
 *
 * Source: DEP-003 migration conventions (spec/durable/execution.md §2/§4);
 * the per-domain persistence convention.
 */
export function resolveNettingMigrationsDir(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return resolve(explicit);
  }
  const fromEnv = process.env[NETTING_MIGRATIONS_DIR_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return resolve(fromEnv.trim());
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, NETTING_MIGRATIONS_RELATIVE_DIR);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(process.cwd(), NETTING_MIGRATIONS_RELATIVE_DIR);
}

/**
 * Options for opening the netting-domain store.
 *
 * Source: the per-domain persistence convention; option shape mirrors the
 * substrate's DurableDatabaseOptions (src/lib/durable/db.ts).
 */
export interface NettingStoreOptions {
  /**
   * Filesystem path of the netting-domain SQLite database file.
   * Default: var/netting.sqlite (created on demand; never committed).
   */
  readonly dbPath?: string;
  /** Explicit migrations directory. Default: resolveNettingMigrationsDir(). */
  readonly migrationsDir?: string;
}

/**
 * Open the netting-domain store THROUGH the DEP-003 database layer
 * (read-only integration): opens the SQLite database with the
 * substrate's crash-safety pragmas and applies the netting domain's
 * pending migrations from
 * src/lib/protocol-runtime/netting/migrations/ via the substrate's
 * migration runner.
 *
 * Source: spec/protocol-runtime-work-orders/README.md "Persistence
 * convention"; spec/durable/execution.md §3/§4.
 */
export function openNettingStore(options: NettingStoreOptions = {}): DurableDatabase {
  return openDurableDatabase({
    dbPath: options.dbPath ?? DEFAULT_NETTING_DB_PATH,
    migrationsDir: resolveNettingMigrationsDir(options.migrationsDir),
  });
}

// ---------------------------------------------------------------------------
// Write / read bridges
// ---------------------------------------------------------------------------

/** A persisted netting-domain row (the write bridge's result marker). */
export interface NettingStoreWrite {
  readonly kind: 'netting-set' | 'net-obligation';
}

function asString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError(`netting store: expected a string (got ${typeof value})`);
  }
  return value;
}

function asInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`netting store: expected an integer (got ${JSON.stringify(value)})`);
  }
  return value;
}

function parseTime(sequence: unknown, wallMs: unknown): ProtocolTime {
  return protocolTime(asInteger(sequence), asInteger(wallMs));
}

function optionalTime(
  sequence: unknown,
  wallMs: unknown,
): ProtocolTime | undefined {
  return sequence === null ? undefined : parseTime(sequence, wallMs);
}

/**
 * Persist one NettingSet record (INSERT — the bridge writes each record
 * once per state, keyed by the set id; the update path below replaces the
 * row on the OPEN -> COMPUTED -> COMMITTED transitions).
 *
 * Source: clearing-netting-settlement.md lines 157-163 (the record), 180-189
 * (the carried proof material).
 */
export function writeNettingSet(
  store: DurableDatabase,
  set: NettingSetRecord,
  label: string,
): NettingStoreWrite {
  store
    .prepare(
      `INSERT INTO netting_sets (
         netting_set_id, label, state, scope_kind, scope_participants,
         algorithm_version, input_obligation_ids, gross_obligations,
         net_positions, conservation_proof, opened_seq, opened_wall_ms,
         computed_seq, computed_wall_ms, committed_seq, committed_wall_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      set.nettingSetId,
      label,
      set.state,
      set.scope.kind,
      JSON.stringify([...set.scope.participants]),
      set.algorithmVersion,
      JSON.stringify([...set.inputObligationIds]),
      set.grossObligations === undefined ? null : JSON.stringify([...set.grossObligations]),
      set.netPositions === undefined ? null : JSON.stringify([...set.netPositions]),
      set.conservationProof === undefined ? null : JSON.stringify(set.conservationProof),
      set.openedAt.sequence,
      set.openedAt.wallMs,
      set.computedAt === undefined ? null : set.computedAt.sequence,
      set.computedAt === undefined ? null : set.computedAt.wallMs,
      set.committedAt === undefined ? null : set.committedAt.sequence,
      set.committedAt === undefined ? null : set.committedAt.wallMs,
    );
  return { kind: 'netting-set' };
}

/**
 * Update one NettingSet row (the OPEN -> COMPUTED -> COMMITTED
 * transitions — the computed/committed material is written exactly once
 * per transition; the input ids and scope are immutable after insert).
 *
 * Source: clearing-netting-settlement.md lines 158-163.
 */
export function updateNettingSet(
  store: DurableDatabase,
  set: NettingSetRecord,
): NettingStoreWrite {
  store
    .prepare(
      `UPDATE netting_sets
         SET state = ?, gross_obligations = ?, net_positions = ?,
             conservation_proof = ?, computed_seq = ?, computed_wall_ms = ?,
             committed_seq = ?, committed_wall_ms = ?
       WHERE netting_set_id = ?`,
    )
    .run(
      set.state,
      set.grossObligations === undefined ? null : JSON.stringify([...set.grossObligations]),
      set.netPositions === undefined ? null : JSON.stringify([...set.netPositions]),
      set.conservationProof === undefined ? null : JSON.stringify(set.conservationProof),
      set.computedAt === undefined ? null : set.computedAt.sequence,
      set.computedAt === undefined ? null : set.computedAt.wallMs,
      set.committedAt === undefined ? null : set.committedAt.sequence,
      set.committedAt === undefined ? null : set.committedAt.wallMs,
      set.nettingSetId,
    );
  return { kind: 'netting-set' };
}

/**
 * Persist one NetObligation record (INSERT — one row per derived id; the
 * deterministic identity makes re-inserting a committed set's obligations
 * a key violation, which is exactly the INV-11-3 no-op discipline at the
 * storage layer).
 *
 * Source: clearing-netting-settlement.md lines 161-166; GC-1 (the integer
 * Money columns).
 */
export function writeNetObligation(
  store: DurableDatabase,
  netObligation: NetObligationRecord,
): NettingStoreWrite {
  store
    .prepare(
      `INSERT INTO net_obligations (
         net_obligation_id, netting_set_id, debtor_participant_id,
         creditor_participant_id, currency, scale, amount_minor, state,
         created_seq, created_wall_ms, state_changed_seq, state_changed_wall_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      netObligation.netObligationId,
      netObligation.nettingSetId,
      netObligation.debtorParticipantId,
      netObligation.creditorParticipantId,
      netObligation.amount.currency,
      netObligation.amount.scale,
      netObligation.amount.amountMinor,
      netObligation.state,
      netObligation.createdAt.sequence,
      netObligation.createdAt.wallMs,
      netObligation.stateChangedAt.sequence,
      netObligation.stateChangedAt.wallMs,
    );
  return { kind: 'net-obligation' };
}

/**
 * Update one NetObligation's settlement-facing state (the CREATED ->
 * SETTLEMENT_PENDING -> SETTLED transitions; SETTLED is terminal).
 *
 * Source: clearing-netting-settlement.md lines 92-99 (the vocabulary),
 * §4 Area 12 lines 259-262 (INV-12-4 — exactly once).
 */
export function updateNetObligationState(
  store: DurableDatabase,
  netObligation: NetObligationRecord,
): NettingStoreWrite {
  store
    .prepare(
      `UPDATE net_obligations
         SET state = ?, state_changed_seq = ?, state_changed_wall_ms = ?
       WHERE net_obligation_id = ?`,
    )
    .run(
      netObligation.state,
      netObligation.stateChangedAt.sequence,
      netObligation.stateChangedAt.wallMs,
      netObligation.netObligationId,
    );
  return { kind: 'net-obligation' };
}

/**
 * Read all NettingSet records back, reconstructing the exact record
 * shapes (Money re-minted through the kernel guards — GC-1 holds on the
 * read path).
 *
 * Source: clearing-netting-settlement.md lines 157-170; GC-1.
 */
export function readNettingSets(
  store: DurableDatabase,
): readonly { readonly set: NettingSetRecord; readonly label: string }[] {
  const rows = store.prepare(`SELECT * FROM netting_sets ORDER BY rowid ASC`).all();
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    const scopeKind = asString(record['scope_kind']);
    const participants = (JSON.parse(asString(record['scope_participants'])) as unknown[]).map(
      asString,
    );
    const inputIds = (JSON.parse(asString(record['input_obligation_ids'])) as unknown[]).map(
      asString,
    );
    const gross =
      record['gross_obligations'] === null
        ? undefined
        : (
            JSON.parse(asString(record['gross_obligations'])) as {
              obligationId: unknown;
              debtorParticipantId: unknown;
              creditorParticipantId: unknown;
              amount: { currency: unknown; scale: unknown; amountMinor: unknown };
            }[]
          ).map((entry) => ({
            obligationId: asString(entry.obligationId),
            debtorParticipantId: asString(entry.debtorParticipantId),
            creditorParticipantId: asString(entry.creditorParticipantId),
            amount: money(
              asString(entry.amount.currency),
              asInteger(entry.amount.amountMinor),
              asInteger(entry.amount.scale),
            ),
          }));
    const positions =
      record['net_positions'] === null
        ? undefined
        : (
            JSON.parse(asString(record['net_positions'])) as {
              participantId: unknown;
              currency: unknown;
              net: { currency: unknown; scale: unknown; amountMinor: unknown };
              breakdownHash: unknown;
              breakdown: { obligationId: unknown; signedAmountMinor: unknown }[];
            }[]
          ).map((entry) => ({
            nettingSetId: asString(record['netting_set_id']),
            participantId: asString(entry.participantId),
            currency: asString(entry.currency),
            net: money(
              asString(entry.net.currency),
              asInteger(entry.net.amountMinor),
              asInteger(entry.net.scale),
            ),
            breakdownHash: asString(entry.breakdownHash),
            breakdown: entry.breakdown.map((b) => ({
              obligationId: asString(b.obligationId),
              signedAmountMinor: asInteger(b.signedAmountMinor),
            })),
          }));
    const proof =
      record['conservation_proof'] === null
        ? undefined
        : parseConservationProof(record['conservation_proof']);
    const set: NettingSetRecord = {
      nettingSetId: asString(record['netting_set_id']),
      state: asString(record['state']) as NettingSetRecord['state'],
      scope:
        scopeKind === 'BILATERAL'
          ? {
              kind: 'BILATERAL',
              participants: [participants[0], participants[1]] as [string, string],
            }
          : { kind: 'MULTILATERAL', participants },
      algorithmVersion: asInteger(record['algorithm_version']),
      inputObligationIds: Object.freeze(inputIds),
      ...(gross === undefined ? {} : { grossObligations: Object.freeze(gross) }),
      ...(positions === undefined ? {} : { netPositions: Object.freeze(positions as NetPosition[]) }),
      ...(proof === undefined ? {} : { conservationProof: proof }),
      openedAt: parseTime(record['opened_seq'], record['opened_wall_ms']),
      ...(optionalTime(record['computed_seq'], record['computed_wall_ms']) === undefined
        ? {}
        : { computedAt: optionalTime(record['computed_seq'], record['computed_wall_ms']) }),
      ...(optionalTime(record['committed_seq'], record['committed_wall_ms']) === undefined
        ? {}
        : { committedAt: optionalTime(record['committed_seq'], record['committed_wall_ms']) }),
    };
    return { set, label: asString(record['label']) };
  });
}

function parseConservationProof(raw: unknown): ConservationProof {
  const parsed = JSON.parse(asString(raw)) as {
    algorithmVersion: unknown;
    currencies: unknown[];
    perCurrency: {
      currency: unknown;
      grossPerParticipant: { participantId: unknown; amountMinor: unknown }[];
      netPerParticipant: { participantId: unknown; amountMinor: unknown }[];
      grossSumMinor: unknown;
      netSumMinor: unknown;
      conserved: unknown;
    }[];
    proofHash: unknown;
  };
  const perCurrency: CurrencyConservationRecord[] = parsed.perCurrency.map((entry) => ({
    currency: asString(entry.currency),
    grossPerParticipant: entry.grossPerParticipant.map((p) => ({
      participantId: asString(p.participantId),
      amountMinor: asInteger(p.amountMinor),
    })),
    netPerParticipant: entry.netPerParticipant.map((p) => ({
      participantId: asString(p.participantId),
      amountMinor: asInteger(p.amountMinor),
    })),
    grossSumMinor: asInteger(entry.grossSumMinor),
    netSumMinor: asInteger(entry.netSumMinor),
    conserved: entry.conserved === true,
  }));
  return {
    algorithmVersion: asInteger(parsed.algorithmVersion),
    currencies: parsed.currencies.map(asString),
    perCurrency,
    proofHash: asString(parsed.proofHash),
  };
}

/**
 * Read all NetObligation records back (insertion order), reconstructing
 * the exact record shapes (Money re-minted through the kernel guards).
 *
 * Source: clearing-netting-settlement.md lines 161-166; GC-1.
 */
export function readNetObligations(store: DurableDatabase): readonly NetObligationRecord[] {
  const rows = store.prepare(`SELECT * FROM net_obligations ORDER BY rowid ASC`).all();
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      netObligationId: asString(record['net_obligation_id']),
      nettingSetId: asString(record['netting_set_id']),
      debtorParticipantId: asString(record['debtor_participant_id']),
      creditorParticipantId: asString(record['creditor_participant_id']),
      amount: money(
        asString(record['currency']),
        asInteger(record['amount_minor']),
        asInteger(record['scale']),
      ),
      state: asString(record['state']) as NetObligationRecord['state'],
      createdAt: parseTime(record['created_seq'], record['created_wall_ms']),
      stateChangedAt: parseTime(record['state_changed_seq'], record['state_changed_wall_ms']),
    };
  });
}
