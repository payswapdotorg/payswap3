/**
 * DEP-007 — Observability: the TelemetrySnapshot collector.
 *
 * Owned surface: src/lib/observability/telemetry.ts (work order DEP-007 —
 * runtime telemetry over the nine domains; "Backup and restore are
 * automated/tested" supplies the incident-recovery signals).
 *
 * collectTelemetrySnapshot(database, options) derives ONE snapshot of all
 * nine domains from the durable store: queue depth by status, oldest
 * queued age, dead-letter count, lease-expired reserved jobs, attempt
 * histogram; event counts by owner/type over the window; the rail adapter
 * activity rollup (the DEP-005 activity surface's durable dual-write under
 * owner 'rail-connectivity'); reconciliation-sweep freshness (the DEP-004
 * operations progress reader); and the incident-recovery/deployment
 * posture from the recovery family's own journal plus the backup manifest.
 *
 * EVERY derivation here is a PURE FUNCTION OF QUERIES: no mutation, no
 * side effects, no network, no recordEvent call, no enqueue, no clock
 * reads other than the injected `now`. The snapshot carries the
 * ObservationOnly brand — it is telemetry, never financial evidence (the
 * work order's forbidden clause; see taxonomy.ts).
 *
 * SQL discipline (the substrate's house rule): every statement below is a
 * module-level static string literal with bound parameters — no data is
 * ever interpolated into a statement.
 *
 * Runtime note: type-only imports from the substrate; value imports are
 * limited to the plain-Node-loadable leaves (durable/events read helpers,
 * the operations progress reader + the operations/rail/recovery owner
 * constants, the frozen environment signal) so this module loads under
 * plain Node with type stripping AND type-checks under tsc.
 */

import { listRecentEvents } from '../durable/events.ts';
import type { DurableDatabase } from '../durable/db.ts';
import type { DurableJobStatus } from '../durable/queue.ts';
import { readOperationalJobProgress } from '../operations/progress-reader.ts';
import { OPERATIONS_EVENT_OWNER, OPERATIONS_EVENT_TYPES } from '../operations/jobs.ts';
import { RECONCILIATION_SWEEP_JOB_KIND } from '../operations/reconciliation-sweep.ts';
import { CLEARING_PROGRESSION_JOB_KIND } from '../operations/clearing-progression.ts';
import { NETTING_SETTLEMENT_PROGRESSION_JOB_KIND } from '../operations/netting-settlement-progression.ts';
import { RAIL_CONNECTIVITY_EVENT_TYPES } from '../rail-connectivity/activity.ts';
import { RECOVERY_EVENT_OWNER, RECOVERY_EVENT_TYPES } from '../recovery/journal.ts';
import { getEnvironment } from '../environment.ts';
import type { ObservationOnly } from './taxonomy.ts';

// ---------------------------------------------------------------------------
// Options and the per-domain metric shapes (all deeply readonly — the
// observation-only read surface)
// ---------------------------------------------------------------------------

/** How many events the bounded derivations may scan (a honesty bound). */
export const DEFAULT_EVENT_SCAN_LIMIT = 8_000;

/** The default derivation window (ms) for "in window" metrics. */
export const DEFAULT_TELEMETRY_WINDOW_MS = 300_000;

/** One row of the parsed backup manifest (see recovery/backup.ts). */
export interface BackupManifestSummaryEntry {
  readonly backupId: string;
  readonly createdAt: number;
  readonly byteSize: number;
  readonly eventCount: number;
  readonly integrityCheck: string;
}

export interface TelemetryOptions {
  /** The `now` the derivation measures against. Default: Date.now(). */
  readonly now?: number;
  /** The window (ms) for the "...InWindow" metrics. Default: 300000. */
  readonly windowMs?: number;
  /**
   * The runtime environment for the deployment domain. Default: the frozen
   * environment signal (src/lib/environment.ts — the PAYSWAP_ENV allowlist,
   * fail-safe sandbox). Injectable for deterministic drills.
   */
  readonly environment?: 'sandbox' | 'production';
  /**
   * The parsed append-only backup manifest rows (recovery/backup.ts
   * readBackupManifest). Optional: absent = no manifest observed (the
   * incident-recovery and deployment domains report no backup coverage).
   */
  readonly backupManifest?: readonly BackupManifestSummaryEntry[];
  /**
   * Which durable job kinds count as command-path jobs. The substrate
   * records no marker distinguishing gateway-admitted command jobs from
   * other locally-registered kinds, so the composition root supplies the
   * classification. Default: every kind NOT prefixed 'operations.' (the
   * operations trigger family's prefix) — conservative: it over-counts
   * command jobs rather than under-counting them (fail-closed direction).
   */
  readonly isCommandJobKind?: (kind: string) => boolean;
  /** Bounded event-scan limit. Default: 8000. */
  readonly eventScanLimit?: number;
}

/** Queue-domain metrics (durable_jobs). */
export interface QueueDomainMetrics {
  readonly depthByStatus: Readonly<Record<DurableJobStatus, number>>;
  readonly totalJobs: number;
  readonly oldestQueuedAgeMs: number | null;
  readonly deadLetterCount: number;
  readonly leaseExpiredReservedCount: number;
  readonly reservedCount: number;
  readonly attemptHistogram: readonly { readonly attempts: number; readonly count: number }[];
}

/** Command-domain metrics (admission + the durable command path). */
export interface CommandDomainMetrics {
  readonly submissionsInWindow: number;
  readonly createdInWindow: number;
  readonly replayedInWindow: number;
  readonly refusedInWindow: number;
  readonly refusalReasonsInWindow: readonly { readonly reasonCode: string; readonly count: number }[];
  readonly commandJobsQueued: number;
  readonly commandJobsTotal: number;
  readonly oldestCommandJobQueuedAgeMs: number | null;
}

/** Execution-domain metrics (substrate lifecycle + command observations). */
export interface ExecutionDomainMetrics {
  readonly succeededInWindow: number;
  readonly attemptFailedInWindow: number;
  readonly deadLetteredInWindow: number;
  readonly leaseExpiredInWindow: number;
  readonly executedObservationsInWindow: number;
  readonly succeededTotal: number;
  readonly meanAttemptsOfSucceeded: number | null;
}

/** UNKNOWN-domain metrics (the never-retry discipline's surface). */
export interface UnknownDomainMetrics {
  readonly unknownHeldInWindow: number;
  readonly railUnknownSurfacedInWindow: number;
  readonly railTimeoutInWindow: number;
  readonly railTransportFailureInWindow: number;
  readonly railRetransmittedInWindow: number;
  readonly totalInWindow: number;
}

/** Reconciliation-domain metrics (sweep freshness via the progress reader). */
export interface ReconciliationDomainMetrics {
  readonly lastSweepCompletedAt: number | null;
  readonly sweepFreshnessMs: number | null;
  readonly sweepRunsInWindow: number;
  readonly investigateSubmissionsInWindow: number;
  /** The reader's all-time sweep run count (present once any run exists). */
  readonly sweepRunsTotal?: number;
}

/** Clearing/netting-domain metrics (progression freshness). */
export interface ClearingNettingDomainMetrics {
  readonly lastClearingRunAt: number | null;
  readonly lastNettingRunAt: number | null;
  readonly clearingRunsInWindow: number;
  readonly nettingRunsInWindow: number;
  readonly clearingCommandsInWindow: number;
  readonly nettingCommandsInWindow: number;
  readonly refusalsInWindow: number;
}

/** Settlement/finality-domain metrics. */
export interface SettlementFinalityDomainMetrics {
  readonly settlementCommandsInWindow: number;
  readonly finalityCommandsInWindow: number;
  readonly finalityExecutionsInWindow: number;
  readonly settlementJobsQueued: number;
  readonly oldestSettlementJobQueuedAgeMs: number | null;
  readonly unknownHeldInWindow: number;
}

/** Incident-recovery-domain metrics. */
export interface IncidentRecoveryDomainMetrics {
  readonly backupsInWindow: number;
  readonly lastBackupAt: number | null;
  readonly backupFreshnessMs: number | null;
  readonly manifestBackupsTotal: number | null;
  readonly restoresVerifiedInWindow: number;
  readonly replaysCompletedInWindow: number;
  readonly tamperDetectedTotal: number;
  readonly integrityVerifiedInWindow: number;
}

/** Deployment-domain metrics. */
export interface DeploymentDomainMetrics {
  readonly environment: 'sandbox' | 'production';
  readonly journalMode: string;
  readonly migrationsApplied: number;
  readonly migrationNames: readonly string[];
  readonly lastBackupAt: number | null;
  readonly lastBackupAgeMs: number | null;
}

/** THE telemetry snapshot: all nine domains, one point in time. */
export interface TelemetrySnapshot extends ObservationOnly {
  readonly collectedAt: number;
  readonly windowMs: number;
  readonly eventRowsScanned: number;
  readonly domains: {
    readonly command: CommandDomainMetrics;
    readonly queue: QueueDomainMetrics;
    readonly execution: ExecutionDomainMetrics;
    readonly unknown: UnknownDomainMetrics;
    readonly reconciliation: ReconciliationDomainMetrics;
    readonly 'clearing-netting': ClearingNettingDomainMetrics;
    readonly 'settlement-finality': SettlementFinalityDomainMetrics;
    readonly 'incident-recovery': IncidentRecoveryDomainMetrics;
    readonly deployment: DeploymentDomainMetrics;
  };
}

// ---------------------------------------------------------------------------
// Static SQL (bound parameters only — the substrate's house rule)
// ---------------------------------------------------------------------------

const SQL_JOBS_BY_STATUS = 'SELECT status, COUNT(*) AS total FROM durable_jobs GROUP BY status';
const SQL_ALL_JOB_KINDS = 'SELECT kind, status, available_at FROM durable_jobs';
const SQL_SETTLEMENT_QUEUED_COUNT =
  "SELECT COUNT(*) AS total FROM durable_jobs WHERE status IN ('queued', 'failed') AND kind LIKE 'settlement.%'";
const SQL_OLDEST_QUEUED =
  "SELECT MIN(available_at) AS oldest FROM durable_jobs WHERE status IN ('queued', 'failed')";
const SQL_LEASE_EXPIRED_RESERVED =
  "SELECT COUNT(*) AS total FROM durable_jobs WHERE status = 'reserved' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?";
const SQL_ATTEMPT_HISTOGRAM =
  'SELECT attempts, COUNT(*) AS total FROM durable_jobs GROUP BY attempts ORDER BY attempts ASC';
const SQL_OLDEST_QUEUED_KIND =
  "SELECT MIN(available_at) AS oldest FROM durable_jobs WHERE status IN ('queued', 'failed') AND kind NOT LIKE 'operations.%'";
const SQL_SETTLEMENT_QUEUED_AGE =
  "SELECT MIN(available_at) AS oldest FROM durable_jobs WHERE status IN ('queued', 'failed') AND kind LIKE 'settlement.%'";
const SQL_SUCCEEDED_ATTEMPTS =
  "SELECT COUNT(*) AS total, AVG(attempts) AS mean FROM durable_jobs WHERE status = 'succeeded'";
const SQL_EVENTS_BY_TYPE_SINCE =
  'SELECT type, COUNT(*) AS total FROM durable_events WHERE recorded_at >= ? GROUP BY type';
const SQL_EVENTS_SINCE_BY_TYPE =
  'SELECT id, type, owner, job_id, recorded_at, data FROM durable_events WHERE recorded_at >= ? AND type = ? ORDER BY id ASC';
const SQL_LAST_EVENT_OF_TYPE =
  'SELECT MAX(recorded_at) AS last FROM durable_events WHERE type = ? AND owner = ?';
const SQL_RECOVERY_EVENT_COUNTS =
  'SELECT type, COUNT(*) AS total FROM durable_events WHERE owner = ? GROUP BY type';
const SQL_PRAGMA_JOURNAL_MODE = 'PRAGMA journal_mode';
const SQL_MIGRATIONS = 'SELECT name FROM schema_migrations ORDER BY name ASC';

type Row = Record<string, unknown>;

function toCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstColumn(row: Row | undefined, key: string): number | null {
  if (row === undefined) {
    return null;
  }
  const value = row[key];
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse one event row's JSON data column (the substrate reader's rule). */
function parseEventData(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') {
    return (raw ?? {}) as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

interface ScannedEvent {
  readonly id: number;
  readonly type: string;
  readonly owner: string;
  readonly jobId: string | null;
  readonly recordedAt: number;
  readonly data: Record<string, unknown>;
}

function rowToScannedEvent(row: Row): ScannedEvent {
  return {
    id: toCount(row.id),
    type: String(row.type),
    owner: String(row.owner),
    jobId: row.job_id === null || row.job_id === undefined ? null : String(row.job_id),
    recordedAt: toCount(row.recorded_at),
    data: parseEventData(row.data),
  };
}

/** Events of one type since a wall time (oldest first), parsed. */
function eventsSince(database: DurableDatabase, type: string, sinceWallMs: number): ScannedEvent[] {
  const rows = database.prepare(SQL_EVENTS_SINCE_BY_TYPE).all(sinceWallMs, type) as Row[];
  return rows.map(rowToScannedEvent);
}

function countEventsSince(database: DurableDatabase, type: string, sinceWallMs: number): number {
  const rows = database
    .prepare(SQL_EVENTS_BY_TYPE_SINCE)
    .all(sinceWallMs) as Array<{ type: unknown; total: unknown }>;
  for (const row of rows) {
    if (String(row.type) === type) {
      return toCount(row.total);
    }
  }
  return 0;
}

function lastEventAt(database: DurableDatabase, type: string, owner: string): number | null {
  const row = database.prepare(SQL_LAST_EVENT_OF_TYPE).get(type, owner) as Row | undefined;
  return firstColumn(row, 'last');
}

// ---------------------------------------------------------------------------
// The per-domain derivations (each a pure function of queries)
// ---------------------------------------------------------------------------

function deriveQueueMetrics(database: DurableDatabase, now: number): QueueDomainMetrics {
  const depth: Record<DurableJobStatus, number> = {
    queued: 0,
    reserved: 0,
    succeeded: 0,
    failed: 0,
    dead_lettered: 0,
  };
  for (const row of database.prepare(SQL_JOBS_BY_STATUS).all() as Row[]) {
    const status = String(row.status) as DurableJobStatus;
    if (status in depth) {
      depth[status] = toCount(row.total);
    }
  }
  const oldestQueued = firstColumn(
    database.prepare(SQL_OLDEST_QUEUED).get() as Row | undefined,
    'oldest',
  );
  const expired = database.prepare(SQL_LEASE_EXPIRED_RESERVED).get(now) as Row | undefined;
  const histogram = (database.prepare(SQL_ATTEMPT_HISTOGRAM).all() as Row[]).map((row) => ({
    attempts: toCount(row.attempts),
    count: toCount(row.total),
  }));
  return {
    depthByStatus: Object.freeze(depth),
    totalJobs: depth.queued + depth.reserved + depth.succeeded + depth.failed + depth.dead_lettered,
    oldestQueuedAgeMs: oldestQueued === null ? null : Math.max(0, now - oldestQueued),
    deadLetterCount: depth.dead_lettered,
    leaseExpiredReservedCount: toCount((expired as Row | undefined)?.total ?? 0),
    reservedCount: depth.reserved,
    attemptHistogram: Object.freeze(histogram),
  };
}

function deriveCommandMetrics(
  database: DurableDatabase,
  now: number,
  windowStart: number,
  isCommandJobKind: (kind: string) => boolean,
): CommandDomainMetrics {
  const submissions = eventsSince(database, OPERATIONS_EVENT_TYPES.commandSubmitted, windowStart);
  let created = 0;
  let replayed = 0;
  let refused = 0;
  const refusalReasons = new Map<string, number>();
  for (const event of submissions) {
    if (event.owner !== OPERATIONS_EVENT_OWNER) {
      continue;
    }
    if (Boolean(event.data.ok)) {
      if (Boolean(event.data.created)) {
        created += 1;
      } else if (Boolean(event.data.replayed)) {
        replayed += 1;
      }
    } else {
      refused += 1;
      const reasonCode = typeof event.data.reasonCode === 'string' ? event.data.reasonCode : 'UNRECORDED';
      refusalReasons.set(reasonCode, (refusalReasons.get(reasonCode) ?? 0) + 1);
    }
  }
  // The durable command path: jobs of command kinds by status. The
  // substrate records no command marker, so the composition root's
  // classification filters the durable_jobs kinds (conservative default:
  // every kind not prefixed 'operations.').
  const byStatus = new Map<string, number>();
  let oldestQueued: number | null = null;
  for (const row of database.prepare(SQL_ALL_JOB_KINDS).all() as Array<{
    kind: unknown;
    status: unknown;
    available_at: unknown;
  }>) {
    const kind = String(row.kind);
    if (!isCommandJobKind(kind)) {
      continue;
    }
    const status = String(row.status);
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    if (status === 'queued' || status === 'failed') {
      const availableAt = Number(row.available_at);
      if (Number.isFinite(availableAt) && (oldestQueued === null || availableAt < oldestQueued)) {
        oldestQueued = availableAt;
      }
    }
  }
  const commandJobsQueued = (byStatus.get('queued') ?? 0) + (byStatus.get('failed') ?? 0);
  return {
    submissionsInWindow: submissions.length,
    createdInWindow: created,
    replayedInWindow: replayed,
    refusedInWindow: refused,
    refusalReasonsInWindow: Object.freeze(
      [...refusalReasons.entries()]
        .map(([reasonCode, count]) => Object.freeze({ reasonCode, count }))
        .sort((a, b) => b.count - a.count),
    ),
    commandJobsQueued,
    commandJobsTotal: [...byStatus.values()].reduce((sum, count) => sum + count, 0),
    oldestCommandJobQueuedAgeMs:
      oldestQueued === null ? null : Math.max(0, now - oldestQueued),
  };
}

function deriveExecutionMetrics(
  database: DurableDatabase,
  windowStart: number,
): ExecutionDomainMetrics {
  const succeeded = countEventsSince(database, 'job_succeeded', windowStart);
  const attemptFailed = countEventsSince(database, 'job_attempt_failed', windowStart);
  const deadLettered = countEventsSince(database, 'job_dead_lettered', windowStart);
  const leaseExpired = countEventsSince(database, 'job_lease_expired', windowStart);
  // The transition runtime's execution observations (owner = the binding
  // authority; the type is the transition module's exported constant's
  // literal — repeated here as a documented constant because importing the
  // transition module would pull its runtime value graph; the type string
  // is frozen vocabulary in the composed runtime's journal contract).
  const executed = countEventsSince(database, 'protocol.command.executed', windowStart);
  const statsRow = database.prepare(SQL_SUCCEEDED_ATTEMPTS).get() as Row | undefined;
  const succeededTotal = toCount(statsRow?.total ?? 0);
  const meanRaw = Number(statsRow?.mean);
  return {
    succeededInWindow: succeeded,
    attemptFailedInWindow: attemptFailed,
    deadLetteredInWindow: deadLettered,
    leaseExpiredInWindow: leaseExpired,
    executedObservationsInWindow: executed,
    succeededTotal,
    meanAttemptsOfSucceeded: Number.isFinite(meanRaw) ? meanRaw : null,
  };
}

function deriveUnknownMetrics(database: DurableDatabase, windowStart: number): UnknownDomainMetrics {
  const unknownHeld = countEventsSince(database, OPERATIONS_EVENT_TYPES.unknownHeld, windowStart);
  const railUnknown = countEventsSince(
    database,
    RAIL_CONNECTIVITY_EVENT_TYPES.unknownSurfaced,
    windowStart,
  );
  const railTimeout = countEventsSince(database, RAIL_CONNECTIVITY_EVENT_TYPES.transmitTimeout, windowStart);
  const railFailure = countEventsSince(
    database,
    RAIL_CONNECTIVITY_EVENT_TYPES.transportFailure,
    windowStart,
  );
  const railRetransmitted = countEventsSince(
    database,
    RAIL_CONNECTIVITY_EVENT_TYPES.transmitRetransmitted,
    windowStart,
  );
  return {
    unknownHeldInWindow: unknownHeld,
    railUnknownSurfacedInWindow: railUnknown,
    railTimeoutInWindow: railTimeout,
    railTransportFailureInWindow: railFailure,
    railRetransmittedInWindow: railRetransmitted,
    totalInWindow: unknownHeld + railUnknown + railTimeout + railFailure,
  };
}

/** The timestamp of the last operations.job.completed row for one job kind. */
function lastJobCompletedAt(database: DurableDatabase, jobKind: string): number | null {
  const completed = eventsSince(database, OPERATIONS_EVENT_TYPES.jobCompleted, 0);
  let last: number | null = null;
  for (const event of completed) {
    if (event.owner !== OPERATIONS_EVENT_OWNER) {
      continue;
    }
    if (String(event.data.jobKind ?? '') !== jobKind) {
      continue;
    }
    if (last === null || event.recordedAt > last) {
      last = event.recordedAt;
    }
  }
  return last;
}

function deriveReconciliationMetrics(
  database: DurableDatabase,
  now: number,
  windowStart: number,
): ReconciliationDomainMetrics {
  // Freshness comes from the operations progress reader's journal (the
  // DEP-004 audit surface — the run set and the journal rows are the
  // reader's own sources; the timestamps live on the journal rows).
  const progress = readOperationalJobProgress(database);
  const sweepRunCount = progress.runs.filter(
    (run) => run.jobKind === RECONCILIATION_SWEEP_JOB_KIND,
  ).length;
  const lastSweep = lastJobCompletedAt(database, RECONCILIATION_SWEEP_JOB_KIND);
  const sweepRunsInWindow = countRunsInWindow(database, RECONCILIATION_SWEEP_JOB_KIND, windowStart);
  const investigate = eventsSince(
    database,
    OPERATIONS_EVENT_TYPES.commandSubmitted,
    windowStart,
  ).filter(
    (event) =>
      event.owner === OPERATIONS_EVENT_OWNER &&
      String(event.data.commandKind ?? '') === 'reconciliation.case.investigate',
  ).length;
  return {
    lastSweepCompletedAt: lastSweep,
    sweepFreshnessMs: lastSweep === null ? null : Math.max(0, now - lastSweep),
    sweepRunsInWindow,
    investigateSubmissionsInWindow: investigate,
    ...(sweepRunCount > 0 ? { sweepRunsTotal: sweepRunCount } : {}),
  } as ReconciliationDomainMetrics;
}

function countRunsInWindow(database: DurableDatabase, jobKind: string, windowStart: number): number {
  return eventsSince(database, OPERATIONS_EVENT_TYPES.jobCompleted, windowStart).filter(
    (event) =>
      event.owner === OPERATIONS_EVENT_OWNER && String(event.data.jobKind ?? '') === jobKind,
  ).length;
}

function deriveClearingNettingMetrics(
  database: DurableDatabase,
  windowStart: number,
): ClearingNettingDomainMetrics {
  const lastClearing = lastJobCompletedAt(database, CLEARING_PROGRESSION_JOB_KIND);
  const lastNetting = lastJobCompletedAt(database, NETTING_SETTLEMENT_PROGRESSION_JOB_KIND);
  const submissions = eventsSince(database, OPERATIONS_EVENT_TYPES.commandSubmitted, windowStart);
  let clearingCommands = 0;
  let nettingCommands = 0;
  let refusals = 0;
  for (const event of submissions) {
    if (event.owner !== OPERATIONS_EVENT_OWNER) {
      continue;
    }
    const commandKind = String(event.data.commandKind ?? '');
    if (commandKind.startsWith('clearing.')) {
      clearingCommands += 1;
    } else if (commandKind.startsWith('netting.')) {
      nettingCommands += 1;
    }
    if (!Boolean(event.data.ok)) {
      refusals += 1;
    }
  }
  return {
    lastClearingRunAt: lastClearing,
    lastNettingRunAt: lastNetting,
    clearingRunsInWindow: countRunsInWindow(database, CLEARING_PROGRESSION_JOB_KIND, windowStart),
    nettingRunsInWindow: countRunsInWindow(
      database,
      NETTING_SETTLEMENT_PROGRESSION_JOB_KIND,
      windowStart,
    ),
    clearingCommandsInWindow: clearingCommands,
    nettingCommandsInWindow: nettingCommands,
    refusalsInWindow: refusals,
  };
}

function deriveSettlementFinalityMetrics(
  database: DurableDatabase,
  now: number,
  windowStart: number,
): SettlementFinalityDomainMetrics {
  const submissions = eventsSince(database, OPERATIONS_EVENT_TYPES.commandSubmitted, windowStart);
  let settlementCommands = 0;
  let finalityCommands = 0;
  for (const event of submissions) {
    if (event.owner !== OPERATIONS_EVENT_OWNER) {
      continue;
    }
    const commandKind = String(event.data.commandKind ?? '');
    if (commandKind.startsWith('settlement.')) {
      settlementCommands += 1;
      if (commandKind === 'settlement.finality.declare') {
        finalityCommands += 1;
      }
    }
  }
  // Finality advancing through the AUTHORITY: executed observations of the
  // authority's own finality command.
  const finalityExecutions = eventsSince(database, 'protocol.command.executed', windowStart).filter(
    (event) => String(event.data.kind ?? '') === 'settlement.finality.declare',
  ).length;
  const oldestQueued = firstColumn(
    database.prepare(SQL_SETTLEMENT_QUEUED_AGE).get() as Row | undefined,
    'oldest',
  );
  const settlementQueued = database.prepare(SQL_SETTLEMENT_QUEUED_COUNT).get() as Row | undefined;
  const unknownHeld = countEventsSince(database, OPERATIONS_EVENT_TYPES.unknownHeld, windowStart);
  return {
    settlementCommandsInWindow: settlementCommands,
    finalityCommandsInWindow: finalityCommands,
    finalityExecutionsInWindow: finalityExecutions,
    settlementJobsQueued: toCount(settlementQueued?.total ?? 0),
    oldestSettlementJobQueuedAgeMs:
      oldestQueued === null ? null : Math.max(0, now - oldestQueued),
    unknownHeldInWindow: unknownHeld,
  };
}

function deriveIncidentRecoveryMetrics(
  database: DurableDatabase,
  now: number,
  windowStart: number,
  backupManifest: readonly BackupManifestSummaryEntry[] | undefined,
): IncidentRecoveryDomainMetrics {
  const counts = new Map<string, number>();
  for (const row of database.prepare(SQL_RECOVERY_EVENT_COUNTS).all(RECOVERY_EVENT_OWNER) as Row[]) {
    counts.set(String(row.type), toCount(row.total));
  }
  const inWindow = (type: string): number => countEventsSince(database, type, windowStart);
  // Backup recency prefers the durable journal (the live narrative), with
  // the manifest as the recorded artifact trail.
  let lastBackupAt = lastEventAt(database, RECOVERY_EVENT_TYPES.backupCompleted, RECOVERY_EVENT_OWNER);
  if (lastBackupAt === null && backupManifest !== undefined && backupManifest.length > 0) {
    lastBackupAt = Math.max(...backupManifest.map((entry) => entry.createdAt));
  }
  return {
    backupsInWindow: inWindow(RECOVERY_EVENT_TYPES.backupCompleted),
    lastBackupAt,
    backupFreshnessMs: lastBackupAt === null ? null : Math.max(0, now - lastBackupAt),
    manifestBackupsTotal: backupManifest === undefined ? null : backupManifest.length,
    restoresVerifiedInWindow: inWindow(RECOVERY_EVENT_TYPES.restoreVerified),
    replaysCompletedInWindow: inWindow(RECOVERY_EVENT_TYPES.replayCompleted),
    // A detected tamper NEVER ages out of the posture (all-time count).
    tamperDetectedTotal:
      (counts.get(RECOVERY_EVENT_TYPES.tamperDetected) ?? 0) +
      (counts.get(RECOVERY_EVENT_TYPES.restoreFailed) ?? 0),
    integrityVerifiedInWindow: inWindow(RECOVERY_EVENT_TYPES.integrityVerified),
  };
}

function deriveDeploymentMetrics(
  database: DurableDatabase,
  environment: 'sandbox' | 'production',
  lastBackupAt: number | null,
  now: number,
): DeploymentDomainMetrics {
  const journalRow = database.prepare(SQL_PRAGMA_JOURNAL_MODE).get() as Row | undefined;
  const journalModeValue =
    journalRow === undefined ? 'unknown' : Object.values(journalRow)[0] ?? 'unknown';
  const journalMode = String(journalModeValue).toLowerCase();
  const migrationNames = (database.prepare(SQL_MIGRATIONS).all() as Row[]).map((row) =>
    String(row.name),
  );
  return {
    environment,
    journalMode,
    migrationsApplied: migrationNames.length,
    migrationNames: Object.freeze(migrationNames),
    lastBackupAt,
    lastBackupAgeMs: lastBackupAt === null ? null : Math.max(0, now - lastBackupAt),
  };
}

// ---------------------------------------------------------------------------
// The snapshot collector
// ---------------------------------------------------------------------------

/**
 * Derive one telemetry snapshot over all nine domains. PURE: queries only —
 * no mutation, no side effects, no network. The database handle is passed
 * in explicitly (the plain-Node composition convention).
 */
export function collectTelemetrySnapshot(
  database: DurableDatabase,
  options: TelemetryOptions = {},
): TelemetrySnapshot {
  if (!database || !database.isOpen()) {
    throw new TypeError('collectTelemetrySnapshot: requires an open DurableDatabase');
  }
  const now = options.now ?? Date.now();
  const windowMs =
    options.windowMs !== undefined && Number.isFinite(options.windowMs) && options.windowMs > 0
      ? Math.floor(options.windowMs)
      : DEFAULT_TELEMETRY_WINDOW_MS;
  const windowStart = now - windowMs;
  const environment =
    options.environment !== undefined ? options.environment : getEnvironment();
  const isCommandJobKind =
    options.isCommandJobKind ?? ((kind: string) => !kind.startsWith('operations.'));

  // The bounded event scan the derivations share (the honesty bound: the
  // snapshot records how many event rows the window queries actually saw).
  const recent = listRecentEvents(database, options.eventScanLimit ?? DEFAULT_EVENT_SCAN_LIMIT);
  const eventRowsScanned = recent.length;

  const queue = deriveQueueMetrics(database, now);
  const command = deriveCommandMetrics(database, now, windowStart, isCommandJobKind);
  const execution = deriveExecutionMetrics(database, windowStart);
  const unknown = deriveUnknownMetrics(database, windowStart);
  const reconciliation = deriveReconciliationMetrics(database, now, windowStart);
  const clearingNetting = deriveClearingNettingMetrics(database, windowStart);
  const settlementFinality = deriveSettlementFinalityMetrics(database, now, windowStart);
  const incidentRecovery = deriveIncidentRecoveryMetrics(
    database,
    now,
    windowStart,
    options.backupManifest,
  );
  const deployment = deriveDeploymentMetrics(database, environment, incidentRecovery.lastBackupAt, now);

  // The ObservationOnly brand is type-only: the literal carries no runtime
  // marker, so construction goes through the unbranded shape and the brand
  // is asserted here (the accepted unique-symbol branding pattern — only
  // this collector mints snapshots, and it never mints evidence).
  const snapshot = {
    collectedAt: now,
    windowMs,
    eventRowsScanned,
    domains: Object.freeze({
      command: Object.freeze(command),
      queue: Object.freeze(queue),
      execution: Object.freeze(execution),
      unknown: Object.freeze(unknown),
      reconciliation: Object.freeze(reconciliation),
      'clearing-netting': Object.freeze(clearingNetting),
      'settlement-finality': Object.freeze(settlementFinality),
      'incident-recovery': Object.freeze(incidentRecovery),
      deployment: Object.freeze(deployment),
    }),
  } as TelemetrySnapshot;
  return snapshot;
}
