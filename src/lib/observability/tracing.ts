/**
 * DEP-007 — Observability: lightweight trace correlation over the ids the
 * substrate already records.
 *
 * Owned surface: src/lib/observability/tracing.ts (work order DEP-007 —
 * logging/tracing surfaces).
 *
 * THE DESIGN (no new instrumentation): every job and event row already
 * carries ids — durable_jobs.id, durable_jobs.idempotency_key,
 * durable_events.id, durable_events.job_id, and the operations journal's
 * recorded commandJobId links. The trace() helper CORRELATES them, purely
 * by reading:
 *
 *   command → queue → execution → effects
 *     the operations.command.submitted journal row (the command admission)
 *       → the durable command job it created (commandJobId → the queue row)
 *         → the protocol.command.executed observation for that job (execution)
 *           → the job_* lifecycle events of the originating duty job (effects)
 *
 * Anchored by a job id, an idempotency key, or an event id, the trace
 * document names every correlated row and every link between them — the
 * ids the substrate already recorded, joined read-only. No spans, no
 * timers, no external tracing backend (in-process correlation only; the
 * external binding is FUTURE-WORK with the other observability bindings).
 *
 * Observation only: pure queries, no mutation; the trace document carries
 * the ObservationOnly brand (never financial evidence — taxonomy.ts).
 */

import { listEventsByJob, listRecentEvents } from '../durable/events.ts';
import type { DurableDatabase } from '../durable/db.ts';
import { OPERATIONS_EVENT_TYPES } from '../operations/jobs.ts';
import type { ObservationOnly } from './taxonomy.ts';

// ---------------------------------------------------------------------------
// The anchor and the trace document
// ---------------------------------------------------------------------------

/** Where a trace starts: one of the substrate's recorded ids. */
export interface TraceAnchor {
  /** A durable_jobs row id. */
  readonly jobId?: string;
  /** A durable_events row id. */
  readonly eventId?: number;
  /** A durable_jobs idempotency key (correlated across kinds). */
  readonly idempotencyKey?: string;
}

/** One job as the trace sees it (the queue row). */
export interface TraceJob {
  readonly jobId: string;
  readonly kind: string;
  readonly idempotencyKey: string | null;
  readonly status: string;
  readonly attempts: number;
}

/** One event as the trace sees it (the journal row). */
export interface TraceEvent {
  readonly eventId: number;
  readonly type: string;
  readonly owner: string;
  readonly jobId: string | null;
  readonly recordedAt: number;
}

/** One correlation link (from → to, by relation). */
export interface TraceLink {
  readonly from: string;
  readonly to: string;
  readonly relation:
    | 'job→lifecycle-event'
    | 'job→command-submission'
    | 'submission→command-job'
    | 'command-job→execution-observation'
    | 'anchor→job';
}

/** The correlated trace document (pure reads over the substrate). */
export interface TraceDocument extends ObservationOnly {
  readonly anchor: TraceAnchor;
  readonly jobs: readonly TraceJob[];
  readonly events: readonly TraceEvent[];
  readonly links: readonly TraceLink[];
}

// ---------------------------------------------------------------------------
// Static SQL (bound parameters only — the substrate's house rule)
// ---------------------------------------------------------------------------

const SQL_JOB_BY_ID = 'SELECT * FROM durable_jobs WHERE id = ?';
const SQL_JOBS_BY_IDEMPOTENCY_KEY = 'SELECT * FROM durable_jobs WHERE idempotency_key = ? ORDER BY created_at ASC';
const SQL_EVENT_BY_ID = 'SELECT id, job_id, type, owner, recorded_at FROM durable_events WHERE id = ?';
const SQL_EVENT_DATA_BY_ID = 'SELECT data FROM durable_events WHERE id = ?';

type JobRow = Record<string, unknown>;
type EventRow = Record<string, unknown>;

function rowToTraceJob(row: JobRow): TraceJob {
  return {
    jobId: String(row.id),
    kind: String(row.kind),
    idempotencyKey: row.idempotency_key === null || row.idempotency_key === undefined ? null : String(row.idempotency_key),
    status: String(row.status),
    attempts: Number(row.attempts) || 0,
  };
}

function rowToTraceEvent(row: EventRow): TraceEvent {
  return {
    eventId: Number(row.id) || 0,
    type: String(row.type),
    owner: String(row.owner),
    jobId: row.job_id === null || row.job_id === undefined ? null : String(row.job_id),
    recordedAt: Number(row.recorded_at) || 0,
  };
}

function parseData(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') {
    return {};
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

// ---------------------------------------------------------------------------
// The trace() helper
// ---------------------------------------------------------------------------

/**
 * Correlate one trace from an anchor, over the ids the substrate already
 * records. Pure reads; bounded (the command-submission scan is bounded by
 * the recent-events limit). The correlation:
 *   - the anchor resolves to job rows (by job id / idempotency key; an
 *     event-id anchor resolves through the event's job_id and, when the
 *     event is a command submission, its recorded commandJobId);
 *   - each job contributes its lifecycle events (listEventsByJob);
 *   - each duty job's operations.command.submitted rows contribute their
 *     command jobs (commandJobId) — the queue hop;
 *   - each command job contributes its protocol.command.executed
 *     observation (the execution hop) when one exists.
 */
export function trace(
  database: DurableDatabase,
  anchor: TraceAnchor,
  options: { readonly eventScanLimit?: number } = {},
): TraceDocument {
  if (!database || !database.isOpen()) {
    throw new TypeError('trace: requires an open DurableDatabase');
  }
  const anchors = [anchor.jobId, anchor.eventId, anchor.idempotencyKey].filter(
    (value) => value !== undefined,
  );
  if (anchors.length === 0) {
    throw new TypeError('trace: the anchor must carry at least one id (jobId, eventId, or idempotencyKey)');
  }

  const jobs = new Map<string, TraceJob>();
  const events = new Map<number, TraceEvent>();
  const links: TraceLink[] = [];
  const addJob = (job: TraceJob, relation: 'anchor→job' | 'submission→command-job', from: string): void => {
    if (jobs.has(job.jobId)) {
      return;
    }
    jobs.set(job.jobId, job);
    links.push({ from, to: `job:${job.jobId}`, relation });
  };

  // -- resolve the anchor to job rows --------------------------------------
  const anchorLabel = `anchor:${JSON.stringify(anchor)}`;
  if (anchor.jobId !== undefined) {
    const row = database.prepare(SQL_JOB_BY_ID).get(anchor.jobId) as JobRow | undefined;
    if (row !== undefined) {
      addJob(rowToTraceJob(row), 'anchor→job', anchorLabel);
    }
  }
  if (anchor.idempotencyKey !== undefined) {
    const rows = database
      .prepare(SQL_JOBS_BY_IDEMPOTENCY_KEY)
      .all(anchor.idempotencyKey) as JobRow[];
    for (const row of rows) {
      addJob(rowToTraceJob(row), 'anchor→job', anchorLabel);
    }
  }
  if (anchor.eventId !== undefined) {
    const row = database.prepare(SQL_EVENT_BY_ID).get(anchor.eventId) as EventRow | undefined;
    if (row !== undefined) {
      const event = rowToTraceEvent(row);
      events.set(event.eventId, event);
      if (event.jobId !== null) {
        const jobRow = database.prepare(SQL_JOB_BY_ID).get(event.jobId) as JobRow | undefined;
        if (jobRow !== undefined) {
          addJob(rowToTraceJob(jobRow), 'anchor→job', anchorLabel);
        }
      }
      // A command-submission anchor also reaches the command job it recorded.
      if (event.type === OPERATIONS_EVENT_TYPES.commandSubmitted) {
        const data = parseData(
          (database.prepare(SQL_EVENT_DATA_BY_ID).get(anchor.eventId) as JobRow | undefined)?.data,
        );
        const commandJobId = typeof data.commandJobId === 'string' ? data.commandJobId : undefined;
        if (commandJobId !== undefined) {
          const commandRow = database.prepare(SQL_JOB_BY_ID).get(commandJobId) as JobRow | undefined;
          if (commandRow !== undefined) {
            addJob(
              rowToTraceJob(commandRow),
              'submission→command-job',
              `event:${event.eventId}`,
            );
          }
        }
      }
    }
  }

  // -- correlate outward: lifecycle events, submissions, command jobs ------
  const dutyJobIds = [...jobs.keys()];
  for (const jobId of dutyJobIds) {
    // The job's own lifecycle events (command → effects narrative).
    const lifecycle = listEventsByJob(database, jobId, 200);
    for (const event of lifecycle) {
      if (!events.has(event.id)) {
        events.set(event.id, {
          eventId: event.id,
          type: event.type,
          owner: event.owner,
          jobId: event.jobId,
          recordedAt: event.recordedAt,
        });
      }
      links.push({ from: `job:${jobId}`, to: `event:${event.id}`, relation: 'job→lifecycle-event' });
    }
  }

  // The operations journal's command submissions recorded for these jobs.
  const recent = listRecentEvents(database, options.eventScanLimit ?? 4_000);
  for (const event of recent) {
    if (event.type !== OPERATIONS_EVENT_TYPES.commandSubmitted || event.jobId === null) {
      continue;
    }
    if (!jobs.has(event.jobId)) {
      continue;
    }
    if (!events.has(event.id)) {
      events.set(event.id, {
        eventId: event.id,
        type: event.type,
        owner: event.owner,
        jobId: event.jobId,
        recordedAt: event.recordedAt,
      });
    }
    links.push({ from: `job:${event.jobId}`, to: `event:${event.id}`, relation: 'job→command-submission' });
    const data = (event.data ?? {}) as Record<string, unknown>;
    const commandJobId = typeof data.commandJobId === 'string' ? data.commandJobId : undefined;
    if (commandJobId !== undefined) {
      const commandRow = database.prepare(SQL_JOB_BY_ID).get(commandJobId) as JobRow | undefined;
      if (commandRow !== undefined) {
        const commandJob = rowToTraceJob(commandRow);
        if (!jobs.has(commandJob.jobId)) {
          jobs.set(commandJob.jobId, commandJob);
          links.push({
            from: `event:${event.id}`,
            to: `job:${commandJob.jobId}`,
            relation: 'submission→command-job',
          });
        }
      }
    }
  }

  // The execution observations for the correlated command jobs.
  for (const event of recent) {
    if (event.type !== 'protocol.command.executed' || event.jobId === null) {
      continue;
    }
    if (!jobs.has(event.jobId)) {
      continue;
    }
    if (!events.has(event.id)) {
      events.set(event.id, {
        eventId: event.id,
        type: event.type,
        owner: event.owner,
        jobId: event.jobId,
        recordedAt: event.recordedAt,
      });
    }
    links.push({
      from: `job:${event.jobId}`,
      to: `event:${event.id}`,
      relation: 'command-job→execution-observation',
    });
  }

  const orderedEvents = [...events.values()].sort((a, b) => a.eventId - b.eventId);
  return {
    anchor: Object.freeze({ ...anchor }),
    jobs: Object.freeze([...jobs.values()]),
    events: Object.freeze(orderedEvents),
    links: Object.freeze(links),
  } as TraceDocument;
}

// ---------------------------------------------------------------------------
// The renderer (compact, human-readable, value-free)
// ---------------------------------------------------------------------------

/**
 * Render one trace document as a compact narrative (for logs and drill
 * transcripts): the anchor, the correlated jobs, and the event chain with
 * its links. Value-free: ids and types only.
 */
export function renderTrace(document: TraceDocument): string {
  const lines: string[] = [];
  lines.push(
    `trace anchor=${JSON.stringify(document.anchor)} jobs=${document.jobs.length} events=${document.events.length} links=${document.links.length}`,
  );
  for (const job of document.jobs) {
    lines.push(
      `  job ${job.jobId} kind=${job.kind} status=${job.status} attempts=${job.attempts} key=${job.idempotencyKey ?? '-'}`,
    );
  }
  for (const event of document.events) {
    lines.push(`  event #${event.eventId} ${event.type} owner=${event.owner} job=${event.jobId ?? '-'}`);
  }
  for (const link of document.links) {
    lines.push(`  link ${link.from} --${link.relation}--> ${link.to}`);
  }
  return lines.join('\n');
}
