/**
 * RTN-008 — Obligation Ledger Authority: the per-domain durable store
 * (the openKernelStore convention, read-only over the DEP-003 database
 * layer).
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
 * Mechanically (the kernel's persistence.ts template, the RTN-007 sibling
 * template): one SQLite database opened through the substrate's
 * openDurableDatabase({ dbPath, migrationsDir }), migrations in the owned
 * prefix src/lib/protocol-runtime/obligations/migrations/, domain
 * database file var/obligations.sqlite.
 *
 * Spec sources of the persisted records:
 *   - clearing-netting-settlement.md lines 104-106 (ObligationLedger —
 *     the append-only, totally sequenced entry log; the sequence is the
 *     PRIMARY KEY: the gapless total order, INV-10-2).
 *   - lines 91-103 (the Obligation machine — the state CHECKs).
 *   - lines 113-123 (INV-10-1/2/3/4 — the storage-level closed
 *     instruction-kind CHECK, the creation-path CHECK over exactly
 *     CLEARING_COMMIT | DISPUTE_RESOLUTION, and NO update path: the
 *     append-only log has no UPDATE statement anywhere in this module).
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
  ObligationCreatedEntry,
  ObligationLedgerEntry,
  ObligationOrigin,
  ObligationTerms,
  ObligationTransitionedEntry,
} from './types.ts';
import { isObligationInstructionKind, isObligationState } from './types.ts';

/**
 * Default filesystem path of the obligations-domain store (mirrors the
 * substrate's var/durable.sqlite and the sibling domains' defaults).
 * var/ is a runtime artifact directory and is gitignored.
 *
 * Source: the per-domain persistence convention; DEP-003 §2 lines 40-43.
 */
export const DEFAULT_OBLIGATIONS_DB_PATH = 'var/obligations.sqlite';

/**
 * Environment variable overriding the obligations migrations directory
 * (mirrors the substrate's PAYSWAP_MIGRATIONS_DIR and the sibling
 * domains' variables).
 *
 * Source: DEP-003 §2 lines 44-47; the per-domain convention.
 */
export const OBLIGATIONS_MIGRATIONS_DIR_ENV_VAR = 'PAYSWAP_OBLIGATIONS_MIGRATIONS_DIR';

/** The obligations domain's owned migration directory, relative to the repository root. */
export const OBLIGATIONS_MIGRATIONS_RELATIVE_DIR = join(
  'src',
  'lib',
  'protocol-runtime',
  'obligations',
  'migrations',
);

/** The obligations domain's owner identity. */
export const OBLIGATIONS_STORE_DOMAIN = 'protocol-runtime-obligations';

/**
 * Resolve the obligations migrations directory (explicit argument, then
 * the environment variable, then the 8-level walk-up, then the
 * cwd-relative fallback that fails closed inside the runner).
 *
 * Source: DEP-003 migration conventions (spec/durable/execution.md §2/§4);
 * the per-domain persistence convention.
 */
export function resolveObligationsMigrationsDir(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return resolve(explicit);
  }
  const fromEnv = process.env[OBLIGATIONS_MIGRATIONS_DIR_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return resolve(fromEnv.trim());
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, OBLIGATIONS_MIGRATIONS_RELATIVE_DIR);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(process.cwd(), OBLIGATIONS_MIGRATIONS_RELATIVE_DIR);
}

/**
 * Options for opening the obligations-domain store.
 *
 * Source: the per-domain persistence convention; option shape mirrors
 * the substrate's DurableDatabaseOptions (src/lib/durable/db.ts).
 */
export interface ObligationsStoreOptions {
  /**
   * Filesystem path of the obligations-domain SQLite database file.
   * Default: var/obligations.sqlite (created on demand; never committed).
   */
  readonly dbPath?: string;
  /** Explicit migrations directory. Default: resolveObligationsMigrationsDir(). */
  readonly migrationsDir?: string;
}

/**
 * Open the obligations-domain store THROUGH the DEP-003 database layer
 * (read-only integration): opens the SQLite database with the
 * substrate's crash-safety pragmas and applies the obligations domain's
 * pending migrations from
 * src/lib/protocol-runtime/obligations/migrations/ via the substrate's
 * migration runner.
 *
 * Source: spec/protocol-runtime-work-orders/README.md "Persistence
 * convention"; spec/durable/execution.md §3/§4.
 */
export function openObligationsStore(options: ObligationsStoreOptions = {}): DurableDatabase {
  return openDurableDatabase({
    dbPath: options.dbPath ?? DEFAULT_OBLIGATIONS_DB_PATH,
    migrationsDir: resolveObligationsMigrationsDir(options.migrationsDir),
  });
}

// ---------------------------------------------------------------------------
// Append-only write / read bridges
// ---------------------------------------------------------------------------

/** A persisted ledger entry row (the write bridge's result marker). */
export interface ObligationStoreWrite {
  readonly kind: 'entry';
}

function asString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError(`obligations store: expected a string (got ${typeof value})`);
  }
  return value;
}

function asInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`obligations store: expected an integer (got ${JSON.stringify(value)})`);
  }
  return value;
}

function parseTime(sequence: unknown, wallMs: unknown): ProtocolTime {
  return protocolTime(asInteger(sequence), asInteger(wallMs));
}

/**
 * Append one ledger entry row. INSERT only — the append-only log has no
 * UPDATE and no DELETE anywhere in this module (INV-10-1: the log never
 * rewrites; the sequence is the gapless total order, INV-10-2).
 *
 * Source: clearing-netting-settlement.md lines 104-106, 113-118.
 */
export function writeEntry(
  store: DurableDatabase,
  entry: ObligationLedgerEntry,
): ObligationStoreWrite {
  if (entry.kind === 'OBLIGATION_CREATED') {
    store
      .prepare(
        `INSERT INTO obligation_ledger_entries (
           sequence, kind, obligation_id, created_by, origin_kind,
           origin_record_id, origin_activity_id, origin_batch_id,
           origin_dispute_id, origin_resolved_obligation_id,
           debtor_participant_id, creditor_participant_id, currency, scale,
           amount_minor, reason, linked_prior_obligation_id,
           when_seq, when_wall_ms
         ) VALUES (?, 'OBLIGATION_CREATED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.sequence,
        entry.obligationId,
        entry.createdBy,
        entry.origin.kind,
        entry.origin.kind === 'CLEARING'
          ? entry.origin.originRecordId
          : entry.origin.disputeId,
        entry.origin.kind === 'CLEARING' ? entry.origin.originActivityId : null,
        entry.origin.kind === 'CLEARING' ? entry.origin.batchId : null,
        entry.origin.kind === 'CLEARING' ? null : entry.origin.disputeId,
        entry.origin.kind === 'CLEARING' ? null : entry.origin.resolvedObligationId,
        entry.terms.debtorParticipantId,
        entry.terms.creditorParticipantId,
        entry.terms.amount.currency,
        entry.terms.amount.scale,
        entry.terms.amount.amountMinor,
        entry.terms.reason,
        entry.linkedPriorObligationId ?? null,
        entry.when.sequence,
        entry.when.wallMs,
      );
    return { kind: 'entry' };
  }
  store
    .prepare(
      `INSERT INTO obligation_ledger_entries (
         sequence, kind, obligation_id, from_state, to_state,
         instruction_kind, cause_reference, replacement_obligation_id,
         replacement_obligation_ids, when_seq, when_wall_ms
       ) VALUES (?, 'OBLIGATION_TRANSITIONED', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.sequence,
      entry.obligationId,
      entry.from,
      entry.to,
      entry.instructionKind,
      entry.causeReference,
      entry.replacementObligationId ?? null,
      entry.replacementObligationIds === undefined
        ? null
        : JSON.stringify([...entry.replacementObligationIds]),
      entry.when.sequence,
      entry.when.wallMs,
    );
  return { kind: 'entry' };
}

/**
 * Read all ledger entries back in sequence order, reconstructing the
 * exact entry shapes (Money re-minted through the kernel guards — GC-1
 * holds on the read path).
 *
 * Source: clearing-netting-settlement.md lines 104-106 (the entry
 * shapes); GC-1.
 */
export function readEntries(store: DurableDatabase): readonly ObligationLedgerEntry[] {
  const rows = store
    .prepare(`SELECT * FROM obligation_ledger_entries ORDER BY sequence ASC`)
    .all();
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    const kind = asString(record['kind']);
    const when = parseTime(record['when_seq'], record['when_wall_ms']);
    if (kind === 'OBLIGATION_CREATED') {
      const originKind = asString(record['origin_kind']);
      const origin: ObligationOrigin =
        originKind === 'CLEARING'
          ? {
              kind: 'CLEARING',
              originRecordId: asString(record['origin_record_id']),
              originActivityId: asString(record['origin_activity_id']),
              batchId: asString(record['origin_batch_id']),
            }
          : {
              kind: 'DISPUTE_RESOLUTION',
              disputeId: asString(record['origin_dispute_id']),
              resolvedObligationId: asString(record['origin_resolved_obligation_id']),
            };
      const terms: ObligationTerms = {
        debtorParticipantId: asString(record['debtor_participant_id']),
        creditorParticipantId: asString(record['creditor_participant_id']),
        amount: money(
          asString(record['currency']),
          asInteger(record['amount_minor']),
          asInteger(record['scale']),
        ),
        reason: asString(record['reason']),
      };
      const linkedPrior = record['linked_prior_obligation_id'];
      const createdBy = asString(record['created_by']);
      if (!isObligationInstructionKind(createdBy)) {
        throw new TypeError(
          `obligations store: unknown creation path ${JSON.stringify(createdBy)}`,
        );
      }
      const createdEntry: ObligationCreatedEntry = {
        kind: 'OBLIGATION_CREATED',
        sequence: asInteger(record['sequence']),
        obligationId: asString(record['obligation_id']),
        terms,
        origin,
        ...(linkedPrior !== null ? { linkedPriorObligationId: asString(linkedPrior) } : {}),
        createdBy,
        when,
      };
      return createdEntry;
    }
    const from = asString(record['from_state']);
    const to = asString(record['to_state']);
    if (!isObligationState(from) || !isObligationState(to)) {
      throw new TypeError(
        `obligations store: unknown transition states ${JSON.stringify(from)} -> ${JSON.stringify(to)}`,
      );
    }
    const instructionKind = asString(record['instruction_kind']);
    if (!isObligationInstructionKind(instructionKind)) {
      throw new TypeError(
        `obligations store: unknown instruction kind ${JSON.stringify(instructionKind)}`,
      );
    }
    const replacementIds = record['replacement_obligation_ids'];
    const replacementObligationId = record['replacement_obligation_id'];
    const transitionEntry: ObligationTransitionedEntry = {
      kind: 'OBLIGATION_TRANSITIONED',
      sequence: asInteger(record['sequence']),
      obligationId: asString(record['obligation_id']),
      from,
      to,
      instructionKind,
      causeReference: asString(record['cause_reference']),
      ...(replacementObligationId !== null
        ? { replacementObligationId: asString(replacementObligationId) }
        : {}),
      ...(replacementIds !== null
        ? {
            replacementObligationIds: Object.freeze(
              (JSON.parse(asString(replacementIds)) as unknown[]).map(asString),
            ),
          }
        : {}),
      when,
    };
    return transitionEntry;
  });
}
