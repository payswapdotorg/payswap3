/**
 * RTN-002 — Evidence Authority: per-domain persistence.
 *
 * THE CONVENTION (decided in RTN-001 — spec/protocol-runtime-work-orders/
 * README.md, "Persistence convention", line 37):
 *
 *   "each authority domain owns its schema and per-domain migrations inside
 *    its owned prefix, using the DEP-003 database layer read-only. This
 *    keeps sibling surfaces disjoint (a shared deploy/migrations/ prefix
 *    would collide between parallel siblings)."
 *
 * v0.1 permission for this convention — spec/architecture/v0.1/README.md
 * §9, lines 173-174:
 *   "This directory defines semantics only; it intentionally prescribes no
 *    implementation, storage, or service decomposition."
 *
 * This module mirrors the kernel's reference pattern (src/lib/protocol-
 * runtime/kernel/persistence.ts) for the evidence domain:
 *   - ONE SQLite database opened through the substrate's
 *     openDurableDatabase({ dbPath, migrationsDir }) (WAL,
 *     synchronous=FULL, busy_timeout, the explicit migration runner);
 *   - migrations in the evidence domain's OWNED prefix
 *     (src/lib/protocol-runtime/evidence/migrations/), never in the shared
 *     deploy/migrations/;
 *   - its own database file (default var/evidence.sqlite), fully disjoint
 *     from the substrate's var/durable.sqlite and the kernel's
 *     var/kernel.sqlite.
 *
 * The A15 EvidenceLog itself is an in-process object store (per the RTN-002
 * work order); the migration demonstrates the log's schema durably, and the
 * bridge below (writeEvidenceRecord / readEvidenceRecords) is the
 * INSERT-only durable side of the same append-only discipline — the
 * substrate's ON CONFLICT DO NOTHING dedupe shape, keyed by the INV-15-4
 * write key. The substrate's lifecycle-events table (durable_events) is a
 * DIFFERENT thing and is NOT reused: substrate events are substrate-owned
 * (spec/durable/execution.md §11, owner durable-substrate); the A15 log is
 * protocol-owned — the RTN-002 stop condition against that conflation is
 * honored by construction.
 *
 * DEP-003 integration is READ-ONLY: this module imports the db API from
 * src/lib/durable/db.ts and never modifies the substrate.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   35-37 (the log being persisted);
 *   lines 51-53 (INV-15-2 — "the log is append-only; no record is modified
 *   or removed");
 *   lines 56-58 (INV-15-4 — the write-key dedupe the bridge keys on);
 *   spec/durable/execution.md §2 (configuration), §4 (migrations), §6
 *   (lines 125-133 — the ON CONFLICT DO NOTHING dedupe shape mirrored
 *   here), §11 (lines 215-224 — substrate event ownership, the boundary
 *   this store deliberately does not cross).
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openDurableDatabase } from '../../durable/db.ts';
import type { DurableDatabase } from '../../durable/db.ts';
import { canonicalJson } from './canonical.ts';
import { evidenceWriteKey } from './record.ts';
import type { EvidenceRecord } from './record.ts';

/**
 * Default filesystem path of the evidence-domain store, relative to the
 * process working directory (mirrors the substrate's var/durable.sqlite and
 * the kernel's var/kernel.sqlite defaults; spec/durable/execution.md §2
 * lines 40-43). var/ is a runtime artifact directory and is gitignored
 * ("Data is never committed").
 *
 * Source: the per-domain persistence convention; DEP-003 §2 lines 40-43.
 */
export const DEFAULT_EVIDENCE_DB_PATH = 'var/evidence.sqlite';

/**
 * Environment variable overriding the evidence migrations directory
 * (mirrors the substrate's PAYSWAP_MIGRATIONS_DIR and the kernel's
 * PAYSWAP_KERNEL_MIGRATIONS_DIR; spec/durable/execution.md §2 lines 44-47).
 * In a deployed image the migrations directory must ship with the
 * application (or be pointed at via this variable) — the runner fails
 * closed when it cannot find migrations.
 *
 * Source: DEP-003 §2 lines 44-47; the per-domain convention.
 */
export const EVIDENCE_MIGRATIONS_DIR_ENV_VAR = 'PAYSWAP_EVIDENCE_MIGRATIONS_DIR';

/** The evidence domain's owned migration directory, relative to the repository root. */
export const EVIDENCE_MIGRATIONS_RELATIVE_DIR = join('src', 'lib', 'protocol-runtime', 'evidence', 'migrations');

/** The evidence domain's owner identity (for rows the evidence domain itself records). */
export const EVIDENCE_STORE_DOMAIN = 'protocol-runtime-evidence';

/**
 * Resolve the evidence migrations directory:
 *   1. an explicit argument (tests and deployments);
 *   2. PAYSWAP_EVIDENCE_MIGRATIONS_DIR from the environment;
 *   3. the first `src/lib/protocol-runtime/evidence/migrations` found
 *      walking up from the process working directory (up to 8 levels) —
 *      the same walk-up strategy the substrate and the kernel use;
 *   4. the cwd-relative fallback (which then fails closed inside the
 *      runner with a precise error, exactly like the substrate).
 *
 * Source: DEP-003 migration conventions (spec/durable/execution.md §2/§4);
 * the per-domain persistence convention (kernel/persistence.ts is the
 * reference pattern).
 */
export function resolveEvidenceMigrationsDir(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return resolve(explicit);
  }
  const fromEnv = process.env[EVIDENCE_MIGRATIONS_DIR_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return resolve(fromEnv.trim());
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, EVIDENCE_MIGRATIONS_RELATIVE_DIR);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(process.cwd(), EVIDENCE_MIGRATIONS_RELATIVE_DIR);
}

/**
 * Options for opening the evidence-domain store.
 *
 * Source: the per-domain persistence convention; option shape mirrors the
 * substrate's DurableDatabaseOptions (src/lib/durable/db.ts).
 */
export interface EvidenceStoreOptions {
  /**
   * Filesystem path of the evidence-domain SQLite database file.
   * Default: var/evidence.sqlite (created on demand; never committed).
   * `:memory:` is accepted for experiments only (not durable, WAL
   * unavailable) — same rule as the substrate.
   */
  dbPath?: string;
  /** Explicit migrations directory. Default: resolveEvidenceMigrationsDir(). */
  migrationsDir?: string;
}

/**
 * Open the evidence-domain store THROUGH the DEP-003 database layer
 * (read-only integration): opens the SQLite database with the substrate's
 * crash-safety pragmas (WAL, synchronous=FULL, busy_timeout) and applies
 * the evidence domain's pending migrations from
 * src/lib/protocol-runtime/evidence/migrations/ via the substrate's
 * migration runner. This is the evidence domain's instance of the
 * per-domain persistence convention the kernel demonstrated.
 *
 * Guarantees on return (inherited from openDurableDatabase): WAL journaling
 * active (file-backed), synchronous=FULL on the connection,
 * busy_timeout=5000, and all pending evidence migrations applied and
 * recorded in schema_migrations.
 *
 * Source: spec/protocol-runtime-work-orders/README.md "Persistence
 * convention"; spec/durable/execution.md §3/§4.
 */
export function openEvidenceStore(options: EvidenceStoreOptions = {}): DurableDatabase {
  return openDurableDatabase({
    dbPath: options.dbPath ?? DEFAULT_EVIDENCE_DB_PATH,
    migrationsDir: resolveEvidenceMigrationsDir(options.migrationsDir),
  });
}

/**
 * The outcome of one durable record write: created is false when the
 * INV-15-4 write key already existed (the duplicate no-op — the same
 * { created, reason } shape the substrate's deduplicated enqueue reports,
 * spec/durable/execution.md §6 lines 125-133).
 *
 * Source: INV-15-4 (evidence-risk-compliance.md lines 56-58); DEP-003 §6
 * (the dedupe-report shape mirrored).
 */
export interface EvidenceStoreWrite {
  readonly created: boolean;
  readonly reason: 'written' | 'duplicate-no-op';
  readonly recordId: string;
}

const SQL_INSERT_RECORD = `
  INSERT INTO evidence_records (
    sequence_number, record_id, write_key, authority, operation_type,
    subject_ids, protocol_sequence, wall_ms, outcome_result,
    outcome_reason_code, submitter_proof, predecessor_hash, record_hash
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (write_key) DO NOTHING
`;

/**
 * Write one WRITTEN EvidenceRecord into the evidence store. INSERT-only —
 * there is no update or delete companion (INV-15-2); the schema's triggers
 * abort any UPDATE or DELETE attempted by other means. A duplicate write
 * key is a no-op (created: false), mirroring the substrate's deduplicated
 * enqueue. Like every write in this module, a failed write throws — the
 * caller couples it to the operation via the same A15 discipline
 * (lines 62-64).
 *
 * Source: INV-15-2 (evidence-risk-compliance.md lines 51-53); INV-15-4
 * (lines 56-58); A15 lines 62-64; DEP-003 §6 lines 125-133 (the
 * ON CONFLICT DO NOTHING shape).
 */
export function writeEvidenceRecord(
  store: DurableDatabase,
  record: EvidenceRecord,
): EvidenceStoreWrite {
  const writeKey = evidenceWriteKey(record);
  const reasonCode =
    record.outcome.reasonCode === undefined ? null : record.outcome.reasonCode;
  const submitterProof = canonicalJson({
    ...(record.proof.hashes === undefined ? {} : { hashes: record.proof.hashes }),
    ...(record.proof.sequenceNumbers === undefined
      ? {}
      : { sequenceNumbers: record.proof.sequenceNumbers }),
    ...(record.proof.priorRecordIds === undefined
      ? {}
      : { priorRecordIds: record.proof.priorRecordIds }),
  });
  const result = store.prepare(SQL_INSERT_RECORD).run(
    record.proof.sequenceNumber,
    record.proof.recordId,
    writeKey,
    record.authority,
    record.what.operationType,
    canonicalJson({ subjectIds: record.what.subjectIds }),
    record.when.sequence,
    record.when.wallMs,
    record.outcome.result,
    reasonCode,
    submitterProof,
    record.proof.predecessorHash,
    record.proof.recordHash,
  );
  const created = Number(result.changes) === 1;
  return {
    created,
    reason: created ? 'written' : 'duplicate-no-op',
    recordId: record.proof.recordId,
  };
}

const SQL_READ_RECORDS =
  'SELECT sequence_number, record_id, authority, operation_type, subject_ids, ' +
  'protocol_sequence, wall_ms, outcome_result, outcome_reason_code, submitter_proof, ' +
  'predecessor_hash, record_hash FROM evidence_records ORDER BY sequence_number ASC';

interface EvidenceRecordRow {
  sequence_number: number;
  record_id: string;
  authority: string;
  operation_type: string;
  subject_ids: string;
  protocol_sequence: number;
  wall_ms: number;
  outcome_result: string;
  outcome_reason_code: string | null;
  submitter_proof: string;
  predecessor_hash: string;
  record_hash: string;
}

/**
 * Read every stored record back, in total sequence order, reconstructed as
 * WRITTEN EvidenceRecords (exactly the five slots, chain material restored
 * from the schema's columns). The read-back records are verifiable by the
 * pure verifyEvidenceChain — the durable copy is the same chain.
 *
 * Source: evidence-risk-compliance.md lines 35-37 (the chain survives
 * persistence); INV-15-3 lines 54-55 (verification is a pure function of
 * the log — wherever the log is read back from).
 */
export function readEvidenceRecords(store: DurableDatabase): EvidenceRecord[] {
  const rows = store.prepare(SQL_READ_RECORDS).all() as unknown as EvidenceRecordRow[];
  return rows.map((row) => {
    const subjectIds = parseJsonField(row.subject_ids, 'subject_ids').subjectIds;
    const submitterProof = parseJsonField(row.submitter_proof, 'submitter_proof');
    return {
      what: {
        operationType: row.operation_type,
        subjectIds,
      },
      when: {
        sequence: Number(row.protocol_sequence),
        wallMs: Number(row.wall_ms),
      },
      authority: row.authority,
      outcome: {
        result: row.outcome_result,
        ...(row.outcome_reason_code === null
          ? {}
          : { reasonCode: row.outcome_reason_code }),
      },
      proof: {
        ...(submitterProof.hashes === undefined ? {} : { hashes: submitterProof.hashes }),
        ...(submitterProof.sequenceNumbers === undefined
          ? {}
          : { sequenceNumbers: submitterProof.sequenceNumbers }),
        ...(submitterProof.priorRecordIds === undefined
          ? {}
          : { priorRecordIds: submitterProof.priorRecordIds }),
        recordId: row.record_id,
        sequenceNumber: Number(row.sequence_number),
        predecessorHash: row.predecessor_hash,
        recordHash: row.record_hash,
      },
    } as EvidenceRecord;
  });
}

function parseJsonField(text: string, field: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError(`evidence store: column ${field} is not valid JSON: ${text}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError(`evidence store: column ${field} must decode to an object`);
  }
  return parsed as Record<string, unknown>;
}
