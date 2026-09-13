/**
 * DEP-007 — Recovery: the online backup of the SQLite durable store.
 *
 * Owned surface: src/lib/recovery/backup.ts (work order DEP-007 — "Backup
 * and restore are automated/tested").
 *
 * THE BACKUP CONTRACT:
 *   - ONLINE: the backup uses SQLite's own VACUUM INTO through the
 *     substrate's database handle (database.prepare('VACUUM INTO ?') — a
 *     parameterized statement, no path interpolation), which produces a
 *     self-contained snapshot of a LIVE database (readers and writers may
 *     continue; the snapshot is transactionally consistent). Before the
 *     copy, a WAL checkpoint (PRAGMA wal_checkpoint(TRUNCATE)) is run for
 *     hygiene — the write-ahead-log checkpoint discipline.
 *   - VERIFIED AT CREATION: the backup file is re-opened READ-ONLY and
 *     checked immediately — PRAGMA integrity_check must report 'ok', the
 *     schema_migrations applied set must match the source's, and every
 *     durable_events row digest must match the source's per-row digest
 *     (the same evidence-integrity computation restore re-verifies).
 *   - MANIFESTED: one row appended to the append-only backup manifest
 *     (JSONL): source path, byte size, sha256 of the backup file, the
 *     schema_migrations applied set (name + checksum), the event/job
 *     counts, the evidence root digest, the per-row evidence digest list,
 *     the timestamp, and the verification outcome. The manifest is
 *     append-only (the evidence-object-store rule generalized to the DR
 *     artifacts); a duplicate backupId in the manifest is refused.
 *   - AUDITED: one durable_events row under owner 'incident-recovery'
 *     (recovery.backup.completed) on the audit port the composition root
 *     binds — normally the SOURCE store (the live narrative), never the
 *     backup artifact.
 *
 * EVIDENCE INTEGRITY (the per-row digest): sha256 over
 * `${eventId}\n${type}\n${owner}\n${dataText}` — the raw TEXT columns as
 * stored, byte-exact. The root digest chains the per-row digests in event
 * id order. Restore recomputes both; the tamper drill proves a single
 * mutated payload row is identified by eventId.
 *
 * FAIL-CLOSED everywhere: the target path must not exist (never clobber),
 * must differ from the source path (never in place), every verification
 * failure refuses the backup, a missing input is an error.
 */

import { createHash } from 'node:crypto';
import { existsSync, appendFileSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DurableDatabase } from '../durable/db.ts';
import { RECOVERY_EVENT_OWNER, RECOVERY_EVENT_TYPES } from './journal.ts';
import type { RecoveryAuditPort } from './journal.ts';

// ---------------------------------------------------------------------------
// The manifest shapes
// ---------------------------------------------------------------------------

/** One durable_events row's content digest (the evidence-integrity unit). */
export interface EvidenceRowDigest {
  readonly eventId: number;
  readonly digest: string;
}

/** One applied migration as the manifest records it. */
export interface BackupMigrationRecord {
  readonly name: string;
  readonly checksum: string;
}

/** One append-only backup-manifest row (also the backup's receipt). */
export interface BackupManifestEntry {
  readonly backupId: string;
  readonly sourcePath: string;
  readonly backupPath: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly createdAt: number;
  readonly migrations: readonly BackupMigrationRecord[];
  readonly jobCount: number;
  readonly eventCount: number;
  readonly evidenceRootDigest: string;
  readonly evidence: readonly EvidenceRowDigest[];
  readonly integrityCheck: string;
  readonly migrationChecksumsMatch: boolean;
  readonly evidenceDigestsMatch: boolean;
}

// ---------------------------------------------------------------------------
// Static SQL (bound parameters only — the substrate's house rule)
// ---------------------------------------------------------------------------

const SQL_CHECKPOINT = 'PRAGMA wal_checkpoint(TRUNCATE)';
const SQL_VACUUM_INTO = 'VACUUM INTO ?';
const SQL_INTEGRITY_CHECK = 'PRAGMA integrity_check';
const SQL_SOURCE_MIGRATIONS = 'SELECT name, checksum FROM schema_migrations ORDER BY name ASC';
const SQL_SOURCE_EVENTS = 'SELECT id, type, owner, data FROM durable_events ORDER BY id ASC';
const SQL_SOURCE_JOB_COUNT = 'SELECT COUNT(*) AS total FROM durable_jobs';

type Row = Record<string, unknown>;

function toCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * One event row's content digest: sha256 over
 * `${eventId}\n${type}\n${owner}\n${dataText}` — the raw stored TEXT,
 * byte-exact (the digest the backup computes and the restore re-verifies).
 */
export function evidenceRowDigest(eventId: number, type: string, owner: string, dataText: string): string {
  return sha256Hex(`${eventId}\n${type}\n${owner}\n${dataText}`);
}

/** The root digest: the ordered chain of the per-row digests. */
export function evidenceRootDigest(rows: readonly EvidenceRowDigest[]): string {
  const material = rows.map((row) => `${row.eventId}:${row.digest}\n`).join('');
  return sha256Hex(material);
}

// ---------------------------------------------------------------------------
// The backup
// ---------------------------------------------------------------------------

export interface BackupOptions {
  /** The SOURCE durable database handle (open). */
  readonly database: DurableDatabase;
  /** The backup artifact path to CREATE (must not exist). */
  readonly backupPath: string;
  /** The append-only manifest JSONL path (created on first append). */
  readonly manifestPath: string;
  /** The audit port (normally the SOURCE store's). Optional. */
  readonly audit?: RecoveryAuditPort;
  /** The wall clock (default Date.now — injectable for deterministic drills). */
  readonly now?: () => number;
}

/**
 * Create one verified online backup. Steps (each fail-closed):
 *   1. refuse clobber/in-place targets and a manifest that IS the backup;
 *   2. WAL checkpoint (TRUNCATE) on the source (hygiene);
 *   3. VACUUM INTO the backup path (parameterized — live, consistent);
 *   4. compute the source's migration set, event digests, job count;
 *   5. re-open the backup READ-ONLY: integrity_check, migration checksum
 *      comparison, per-row evidence digest comparison;
 *   6. sha256 the backup file, append the manifest row, audit the event.
 */
export function createBackup(options: BackupOptions): BackupManifestEntry {
  const { database } = options;
  if (!database || !database.isOpen()) {
    throw new TypeError('createBackup: requires an open DurableDatabase (the source)');
  }
  const now = options.now ?? Date.now;
  const backupPath = resolve(options.backupPath);
  const manifestPath = resolve(options.manifestPath);
  if (backupPath === resolve(database.path)) {
    throw new Error('createBackup: the backup path must differ from the source database path (never in place)');
  }
  if (existsSync(backupPath)) {
    throw new Error(`createBackup: refusing to clobber an existing file: ${backupPath}`);
  }
  if (backupPath === manifestPath) {
    throw new Error('createBackup: the manifest path must differ from the backup path');
  }

  // 2. WAL checkpoint (the write-ahead-log checkpoint discipline).
  database.prepare(SQL_CHECKPOINT).get();

  // 3. The online copy: VACUUM INTO with a bound parameter (no path
  //    interpolation into SQL — the parameterized form is the driver-
  //    supported equivalent the substrate handle exposes).
  database.prepare(SQL_VACUUM_INTO).run(backupPath);
  if (!existsSync(backupPath)) {
    throw new Error(`createBackup: VACUUM INTO produced no file at ${backupPath}`);
  }

  // 4. The source's recorded facts.
  const migrations: BackupMigrationRecord[] = (
    database.prepare(SQL_SOURCE_MIGRATIONS).all() as Row[]
  ).map((row) => ({ name: String(row.name), checksum: String(row.checksum) }));
  const sourceEvents = database.prepare(SQL_SOURCE_EVENTS).all() as Array<{
    id: unknown;
    type: unknown;
    owner: unknown;
    data: unknown;
  }>;
  const evidence: EvidenceRowDigest[] = sourceEvents.map((row) =>
    Object.freeze({
      eventId: toCount(row.id),
      digest: evidenceRowDigest(toCount(row.id), String(row.type), String(row.owner), String(row.data ?? '')),
    }),
  );
  const jobCount = toCount(
    (database.prepare(SQL_SOURCE_JOB_COUNT).get() as Row | undefined)?.total ?? 0,
  );
  const rootDigest = evidenceRootDigest(evidence);

  // 5. Immediate verification over the backup artifact (READ-ONLY open —
  //    the artifact is never mutated by its own verification).
  let integrityCheck = 'ok';
  let migrationChecksumsMatch = true;
  let evidenceDigestsMatch = true;
  const verifier = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const integrityRow = verifier.prepare(SQL_INTEGRITY_CHECK).get() as Row | undefined;
    integrityCheck = String(integrityRow?.integrity_check ?? 'unknown');
    const backupMigrations = (verifier.prepare(SQL_SOURCE_MIGRATIONS).all() as Row[]).map(
      (row) => ({ name: String(row.name), checksum: String(row.checksum) }),
    );
    migrationChecksumsMatch =
      backupMigrations.length === migrations.length &&
      backupMigrations.every((record, index) => record.name === migrations[index]?.name && record.checksum === migrations[index]?.checksum);
    const backupEvents = verifier.prepare(SQL_SOURCE_EVENTS).all() as Array<{
      id: unknown;
      type: unknown;
      owner: unknown;
      data: unknown;
    }>;
    evidenceDigestsMatch =
      backupEvents.length === evidence.length &&
      backupEvents.every((row, index) =>
        evidenceRowDigest(toCount(row.id), String(row.type), String(row.owner), String(row.data ?? '')) ===
        evidence[index]?.digest,
      );
  } finally {
    verifier.close();
  }
  if (integrityCheck !== 'ok' || !migrationChecksumsMatch || !evidenceDigestsMatch) {
    throw new Error(
      `createBackup: the fresh backup failed its own verification (integrity=${integrityCheck}, ` +
        `migrations-match=${migrationChecksumsMatch}, evidence-match=${evidenceDigestsMatch}) — refusing to manifest it`,
    );
  }

  // 6. The file digest + the append-only manifest row.
  const byteSize = statSync(backupPath).size;
  const fileSha256 = sha256Hex(readFileSync(backupPath));
  const entry: BackupManifestEntry = Object.freeze({
    backupId: `backup-${now()}`,
    sourcePath: resolve(database.path),
    backupPath,
    byteSize,
    sha256: fileSha256,
    createdAt: now(),
    migrations: Object.freeze(migrations),
    jobCount,
    eventCount: evidence.length,
    evidenceRootDigest: rootDigest,
    evidence: Object.freeze(evidence),
    integrityCheck,
    migrationChecksumsMatch,
    evidenceDigestsMatch,
  });
  appendToManifest(manifestPath, entry);

  options.audit?.recordEvent(
    RECOVERY_EVENT_TYPES.backupCompleted,
    {
      backupId: entry.backupId,
      sourcePath: entry.sourcePath,
      backupPath: entry.backupPath,
      byteSize: entry.byteSize,
      sha256: entry.sha256,
      eventCount: entry.eventCount,
      jobCount: entry.jobCount,
      evidenceRootDigest: entry.evidenceRootDigest,
      integrityCheck: entry.integrityCheck,
    },
    RECOVERY_EVENT_OWNER,
    null,
  );
  return entry;
}

// ---------------------------------------------------------------------------
// The append-only manifest
// ---------------------------------------------------------------------------

/**
 * Append one manifest row (JSONL, one JSON object per line). APPEND-ONLY:
 * an existing row with the same backupId is refused (the evidence rule —
 * history is never rewritten), and the append never truncates.
 */
export function appendToManifest(manifestPath: string, entry: BackupManifestEntry): void {
  const existing = existsSync(manifestPath)
    ? readBackupManifest(manifestPath)
    : ([] as BackupManifestEntry[]);
  if (existing.some((row) => row.backupId === entry.backupId)) {
    throw new Error(
      `appendToManifest: backupId ${entry.backupId} is already recorded — the manifest is append-only (history is never rewritten)`,
    );
  }
  appendFileSync(manifestPath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8' });
}

/**
 * Read the append-only backup manifest. FAIL-CLOSED: every line must parse
 * as a manifest row; a malformed or truncated line is an error naming the
 * line number (never a silent skip).
 */
export function readBackupManifest(manifestPath: string): BackupManifestEntry[] {
  if (!existsSync(manifestPath)) {
    throw new Error(`readBackupManifest: no manifest at ${manifestPath} (a missing input is an error)`);
  }
  const text = readFileSync(manifestPath, 'utf8');
  const entries: BackupManifestEntry[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (line.trim().length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      throw new Error(
        `readBackupManifest: malformed manifest line ${index + 1} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as BackupManifestEntry).backupId !== 'string' ||
      typeof (parsed as BackupManifestEntry).sha256 !== 'string' ||
      !Array.isArray((parsed as BackupManifestEntry).evidence)
    ) {
      throw new Error(
        `readBackupManifest: manifest line ${index + 1} is not a backup manifest row (missing required fields)`,
      );
    }
    entries.push(parsed as BackupManifestEntry);
  }
  return entries;
}

/**
 * The manifest summary the telemetry snapshot consumes (the trimmed
 * projection — counts and timestamps only, no digest lists).
 */
export function manifestSummary(entries: readonly BackupManifestEntry[]): Array<{
  readonly backupId: string;
  readonly createdAt: number;
  readonly byteSize: number;
  readonly eventCount: number;
  readonly integrityCheck: string;
}> {
  return entries.map((entry) => ({
    backupId: entry.backupId,
    createdAt: entry.createdAt,
    byteSize: entry.byteSize,
    eventCount: entry.eventCount,
    integrityCheck: entry.integrityCheck,
  }));
}
