/**
 * DEP-007 — Recovery: restore into a target copy + verification.
 *
 * Owned surface: src/lib/recovery/restore.ts (work order DEP-007 — "Backup
 * and restore are automated/tested"; "Evidence integrity is checked after
 * restore").
 *
 * THE RESTORE CONTRACT:
 *   - NEVER IN PLACE: the backup is copied to a FRESH target path (a
 *     clobbered or source-equal target is refused; the source store is
 *     never touched by a restore).
 *   - OPENED THROUGH THE SUBSTRATE: the target is opened with
 *     openDurableDatabase (the migration runner applies pending migrations
 *     — in the drill: none pending, the applied set matches; the runner's
 *     immutability check runs on every open).
 *   - VERIFIED, FAIL-CLOSED, in this order:
 *       1. PRAGMA integrity_check on the target must report 'ok';
 *       2. the target's schema_migrations must equal the BACKUP's recorded
 *          set AND match the repository's migration files (the checksums
 *          the runner already verified at open are re-derived against the
 *          backup's recorded set explicitly);
 *       3. event/journal continuity: the target's durable_events ids must
 *          be exactly the backup's ids — strictly increasing, starting at
 *          the backup's first id, with NO gap the restore itself
 *          introduced (append-only history preserved: every event the
 *          backup contained is present, with identical content digests);
 *       4. evidence integrity: every per-row digest recomputed on the
 *          target matches the manifest's (a single tampered row is
 *          identified by eventId).
 *     Any failure: the target handle is closed and a typed
 *     RestoreVerificationError carrying the named failures is thrown
 *     (fail-closed — a partial restore is never returned).
 *
 * verifyEvidenceIntegrity() is ALSO exported standalone: the tamper drill
 * runs it directly against a tampered copy and asserts the failure names
 * the row.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDurableDatabase, resolveMigrationsDir } from '../durable/db.ts';
import type { DurableDatabase } from '../durable/db.ts';
import { RECOVERY_EVENT_OWNER, RECOVERY_EVENT_TYPES } from './journal.ts';
import type { RecoveryAuditPort } from './journal.ts';
import { evidenceRowDigest, evidenceRootDigest, readBackupManifest } from './backup.ts';
import type { BackupManifestEntry } from './backup.ts';

// ---------------------------------------------------------------------------
// Static SQL (bound parameters only — the substrate's house rule)
// ---------------------------------------------------------------------------

const SQL_INTEGRITY_CHECK = 'PRAGMA integrity_check';
const SQL_TARGET_MIGRATIONS = 'SELECT name, checksum FROM schema_migrations ORDER BY name ASC';
const SQL_TARGET_EVENT_IDS = 'SELECT id, type, owner, data FROM durable_events ORDER BY id ASC';

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// The verification shapes
// ---------------------------------------------------------------------------

/** One evidence-integrity mismatch (the tampered row, identified). */
export interface EvidenceMismatch {
  readonly eventId: number;
  readonly expectedDigest: string;
  readonly actualDigest: string;
}

/** The standalone evidence-integrity verification result. */
export interface EvidenceIntegrityResult {
  readonly ok: boolean;
  readonly verifiedCount: number;
  readonly rootDigestMatches: boolean;
  readonly mismatches: readonly EvidenceMismatch[];
}

/** The full restore verification report. */
export interface RestoreVerification {
  readonly integrityCheck: string;
  readonly migrationsMatch: boolean;
  readonly repoMigrationsMatch: boolean;
  readonly continuity: {
    readonly ok: boolean;
    readonly expectedEventIds: readonly number[];
    readonly restoredEventIds: readonly number[];
    readonly gaps: readonly number[];
  };
  readonly evidenceIntegrity: EvidenceIntegrityResult;
}

/** The restore result: the OPEN target handle + the verification report. */
export interface RestoreResult {
  readonly targetPath: string;
  readonly database: DurableDatabase;
  readonly entry: BackupManifestEntry;
  readonly verification: RestoreVerification;
}

/** Raised when any restore verification fails (fail-closed). */
export class RestoreVerificationError extends Error {
  override readonly name = 'RestoreVerificationError';
  readonly failures: readonly string[];

  constructor(failures: readonly string[]) {
    super(`restore verification FAILED (${failures.length}): ${failures.join('; ')}`);
    this.failures = Object.freeze([...failures]);
  }
}

// ---------------------------------------------------------------------------
// The standalone evidence-integrity verifier
// ---------------------------------------------------------------------------

/**
 * Recompute every per-row evidence digest on a store and compare against a
 * backup manifest entry. Pure reads; FAIL-CLOSED: a missing manifest field
 * is an error; every mismatch is reported with the eventId (the tampered
 * row is identified, never just counted).
 */
export function verifyEvidenceIntegrity(
  database: DurableDatabase,
  entry: BackupManifestEntry,
): EvidenceIntegrityResult {
  if (!database || !database.isOpen()) {
    throw new TypeError('verifyEvidenceIntegrity: requires an open DurableDatabase');
  }
  const expected = new Map<number, string>();
  for (const row of entry.evidence) {
    expected.set(row.eventId, row.digest);
  }
  const rows = database.prepare(SQL_TARGET_EVENT_IDS).all() as Array<{
    id: unknown;
    type: unknown;
    owner: unknown;
    data: unknown;
  }>;
  const mismatches: EvidenceMismatch[] = [];
  let verifiedCount = 0;
  const actual: Array<{ eventId: number; digest: string }> = [];
  for (const row of rows) {
    const eventId = Number(row.id) || 0;
    const digest = evidenceRowDigest(
      eventId,
      String(row.type),
      String(row.owner),
      String(row.data ?? ''),
    );
    actual.push({ eventId, digest });
    const expectedDigest = expected.get(eventId);
    if (expectedDigest === undefined) {
      // A row the backup did not contain (post-restore appends are legal;
      // the continuity check owns that rule — here it is verified against
      // the manifest only when present).
      continue;
    }
    if (expectedDigest !== digest) {
      mismatches.push(
        Object.freeze({ eventId, expectedDigest, actualDigest: digest }),
      );
    } else {
      verifiedCount += 1;
    }
  }
  // Also the reverse direction: every manifest row must be present.
  for (const [eventId, digest] of expected) {
    if (!actual.some((row) => row.eventId === eventId && row.digest === digest)) {
      if (!mismatches.some((mismatch) => mismatch.eventId === eventId)) {
        mismatches.push(
          Object.freeze({
            eventId,
            expectedDigest: digest,
            actualDigest: 'missing-or-altered',
          }),
        );
      }
    }
  }
  const rootDigestMatches = evidenceRootDigest(
    actual.map((row) => Object.freeze({ eventId: row.eventId, digest: row.digest })),
  ) === entry.evidenceRootDigest;
  return {
    ok: mismatches.length === 0,
    verifiedCount,
    rootDigestMatches,
    mismatches: Object.freeze(mismatches),
  };
}

// ---------------------------------------------------------------------------
// The restore
// ---------------------------------------------------------------------------

export interface RestoreOptions {
  /** The backup artifact path (must exist). */
  readonly backupPath: string;
  /** The FRESH target path to create (must not exist; never the source). */
  readonly targetPath: string;
  /** The manifest JSONL path (must exist — the entry is read from it). */
  readonly manifestPath: string;
  /** Restrict to one manifest entry (default: the LAST appended row). */
  readonly backupId?: string;
  /** Explicit migrations directory (default: the substrate's resolution). */
  readonly migrationsDir?: string;
  /** The audit port (normally the SOURCE/live store's). Optional. */
  readonly audit?: RecoveryAuditPort;
}

/**
 * Restore a backup INTO A TARGET COPY and verify it. Never in place; never
 * clobbering; fail-closed on every verification. Returns the OPEN target
 * handle (the caller owns its lifetime) plus the verification report.
 */
export function restoreBackup(options: RestoreOptions): RestoreResult {
  const backupPath = resolve(options.backupPath);
  const targetPath = resolve(options.targetPath);
  const manifestPath = resolve(options.manifestPath);
  if (!existsSync(backupPath)) {
    throw new Error(`restoreBackup: no backup artifact at ${backupPath} (a missing input is an error)`);
  }
  if (existsSync(targetPath)) {
    throw new Error(`restoreBackup: refusing to clobber an existing target: ${targetPath}`);
  }
  if (targetPath === backupPath) {
    throw new Error('restoreBackup: the target path must differ from the backup path');
  }
  const entries = readBackupManifest(manifestPath);
  if (entries.length === 0) {
    throw new Error('restoreBackup: the manifest is empty (nothing to restore)');
  }
  const entry =
    options.backupId === undefined
      ? entries[entries.length - 1]!
      : entries.find((candidate) => candidate.backupId === options.backupId);
  if (entry === undefined) {
    throw new Error(`restoreBackup: backupId ${options.backupId} is not in the manifest`);
  }
  if (resolve(entry.sourcePath) === targetPath) {
    throw new Error(
      'restoreBackup: the target path equals the backup\'s recorded source path (restore never happens in place)',
    );
  }
  if (resolve(entry.backupPath) !== backupPath) {
    throw new Error(
      `restoreBackup: the artifact at ${backupPath} is not the manifest row's backup path (${entry.backupPath})`,
    );
  }
  // The artifact's content digest must match the manifest's sha256 before
  // anything is restored from it (the manifest is the receipt).
  const artifactSha = createHash('sha256').update(readFileSync(backupPath)).digest('hex');
  if (artifactSha !== entry.sha256) {
    throw new Error(
      'restoreBackup: the backup artifact sha256 does not match the manifest row (tampered or truncated artifact)',
    );
  }

  // The copy (never in place: the source recorded in the manifest is
  // untouched; the target is a fresh path).
  copyFileSync(backupPath, targetPath);

  // Open through the substrate (migrations apply; the immutability check
  // runs on every open — a no-op when the applied set matches).
  const database = openDurableDatabase({
    dbPath: targetPath,
    ...(options.migrationsDir === undefined ? {} : { migrationsDir: options.migrationsDir }),
  });

  const failures: string[] = [];
  try {
    // 1. integrity_check.
    const integrityRow = database.prepare(SQL_INTEGRITY_CHECK).get() as Row | undefined;
    const integrityCheck = String(integrityRow?.integrity_check ?? 'unknown');
    if (integrityCheck !== 'ok') {
      failures.push(`integrity_check reported '${integrityCheck}' (expected 'ok')`);
    }

    // 2. Migration sets: target vs the backup record, and the backup
    //    record vs the repository's migration files (sha256 re-derived).
    const targetMigrations = (database.prepare(SQL_TARGET_MIGRATIONS).all() as Row[]).map(
      (row) => ({ name: String(row.name), checksum: String(row.checksum) }),
    );
    const migrationsMatch =
      targetMigrations.length === entry.migrations.length &&
      targetMigrations.every((record, index) =>
        record.name === entry.migrations[index]?.name &&
        record.checksum === entry.migrations[index]?.checksum);
    if (!migrationsMatch) {
      failures.push(
        `the target's schema_migrations do not match the backup's recorded set (target ${targetMigrations.length} rows, backup ${entry.migrations.length} rows)`,
      );
    }
    const migrationsDir = resolveMigrationsDir(options.migrationsDir);
    const repoFiles = readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    const repoMigrationsMatch =
      repoFiles.length === entry.migrations.length &&
      entry.migrations.every((record, index) => {
        const file = repoFiles[index];
        if (file !== record.name) {
          return false;
        }
        const content = readFileSync(join(migrationsDir, file), 'utf8').replace(/^\uFEFF/, '');
        return createHash('sha256').update(content).digest('hex') === record.checksum;
      });
    if (!repoMigrationsMatch) {
      failures.push(
        'the backup\'s recorded migration checksums do not match the repository\'s migration files (the repo moved under the backup)',
      );
    }

    // 3. Event/journal continuity: the target's ids must be exactly the
    //    backup's ids (monotonic, no restore-introduced gaps).
    const targetEventRows = database.prepare(SQL_TARGET_EVENT_IDS).all() as Array<{
      id: unknown;
    }>;
    const restoredEventIds = targetEventRows.map((row) => Number(row.id) || 0);
    const expectedEventIds = entry.evidence.map((row) => row.eventId);
    const gaps: number[] = [];
    for (let index = 1; index < restoredEventIds.length; index += 1) {
      const previous = restoredEventIds[index - 1] as number;
      const current = restoredEventIds[index] as number;
      if (current <= previous) {
        failures.push(`durable_events ids are not strictly increasing at position ${index} (${previous} → ${current})`);
        break;
      }
    }
    if (expectedEventIds.length > 0) {
      for (let index = 0; index < expectedEventIds.length; index += 1) {
        const expectedId = expectedEventIds[index] as number;
        const actualId = restoredEventIds[index];
        if (actualId !== expectedId) {
          gaps.push(expectedId);
        }
      }
    }
    const continuityOk =
      gaps.length === 0 &&
      restoredEventIds.length >= expectedEventIds.length &&
      restoredEventIds.slice(0, expectedEventIds.length).every((id, index) => id === expectedEventIds[index]);
    if (!continuityOk) {
      failures.push(
        `event/journal continuity broken: ${gaps.length} expected id(s) missing or displaced (first: ${gaps[0] ?? 'n/a'}); ` +
          `restored ${restoredEventIds.length} row(s) for ${expectedEventIds.length} backup row(s)`,
      );
    }

    // 4. Evidence integrity (the standalone verifier — the tamper drill
    //    runs the same function directly).
    const evidenceIntegrity = verifyEvidenceIntegrity(database, entry);
    if (!evidenceIntegrity.ok) {
      for (const mismatch of evidenceIntegrity.mismatches) {
        failures.push(
          `evidence-integrity violation at durable_events id ${mismatch.eventId}: expected digest ${mismatch.expectedDigest}, actual ${mismatch.actualDigest}`,
        );
      }
    }

    if (failures.length > 0) {
      // Fail-closed: never return a partially-verified restore.
      options.audit?.recordEvent(
        RECOVERY_EVENT_TYPES.restoreFailed,
        {
          backupId: entry.backupId,
          targetPath,
          failureCount: failures.length,
          failures,
        },
        RECOVERY_EVENT_OWNER,
        null,
      );
      throw new RestoreVerificationError(failures);
    }

    const verification: RestoreVerification = Object.freeze({
      integrityCheck,
      migrationsMatch,
      repoMigrationsMatch,
      continuity: Object.freeze({
        ok: continuityOk,
        expectedEventIds: Object.freeze(expectedEventIds),
        restoredEventIds: Object.freeze(restoredEventIds),
        gaps: Object.freeze(gaps),
      }),
      evidenceIntegrity: Object.freeze(evidenceIntegrity),
    });

    options.audit?.recordEvent(
      RECOVERY_EVENT_TYPES.restoreVerified,
      {
        backupId: entry.backupId,
        targetPath,
        integrityCheck,
        migrationsMatch,
        repoMigrationsMatch,
        eventCount: entry.eventCount,
        evidenceVerifiedCount: evidenceIntegrity.verifiedCount,
        evidenceRootDigestMatches: evidenceIntegrity.rootDigestMatches,
      },
      RECOVERY_EVENT_OWNER,
      null,
    );
    return { targetPath, database, entry, verification };
  } catch (error) {
    // Fail-closed: the target handle never leaks from a failed restore.
    try {
      database.close();
    } catch {
      // already closed
    }
    throw error;
  }
}
