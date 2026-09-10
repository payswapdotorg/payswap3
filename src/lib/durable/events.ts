/**
 * DEP-003 — Durable event/evidence recording.
 *
 * `durable_events` (deploy/migrations/0001_durable_execution.sql) is the
 * defined, persistent home for event/evidence state, with an explicit owner
 * column so every row names the party that recorded it:
 *
 *   - The substrate itself records job lifecycle events (job_enqueued,
 *     job_reserved, job_succeeded, job_attempt_failed, job_dead_lettered,
 *     job_lease_expired, job_enqueue_deduped) under the owner constant
 *     SUBSTRATE_EVENT_OWNER.
 *   - Protocol authorities (future work) record their OWN evidence under
 *     their own owner identity via the same table. The substrate never
 *     writes, interprets, or owns protocol evidence.
 *
 * Runtime note: this module imports only types from './db' (type-only,
 * erased at load time) so it stays loadable in plain Node with type
 * stripping; the database handle is always passed in explicitly.
 */
import type { DurableDatabase } from './db';

/** Owner identity used by the substrate for its own lifecycle events. */
export const SUBSTRATE_EVENT_OWNER = 'durable-substrate';

export interface DurableEvent {
  id: number;
  jobId: string | null;
  type: string;
  data: unknown;
  owner: string;
  recordedAt: number;
}

const SQL_INSERT_EVENT =
  "INSERT INTO durable_events (job_id, type, data, owner, recorded_at) VALUES (?, ?, ?, ?, ?)";
const SQL_SELECT_BY_JOB =
  "SELECT id, job_id, type, data, owner, recorded_at FROM durable_events WHERE job_id = ? ORDER BY id ASC LIMIT ?";
const SQL_SELECT_RECENT =
  "SELECT id, job_id, type, data, owner, recorded_at FROM durable_events ORDER BY id DESC LIMIT ?";

/**
 * Record one event/evidence row with a defined owner.
 *
 * @param database  open durable database handle
 * @param type      non-empty event type (e.g. 'job_reserved', or a
 *                  protocol-authority evidence type)
 * @param data      JSON-serializable payload (stored as JSON text)
 * @param owner     non-empty owner identity — mandatory: evidence without an
 *                  owner is rejected by definition
 * @param jobId     optional association to a durable_jobs row
 */
export function recordEvent(
  database: DurableDatabase,
  type: string,
  data: unknown,
  owner: string,
  jobId?: string | null,
): DurableEvent {
  if (typeof type !== 'string' || type.length === 0) {
    throw new TypeError('recordEvent: type must be a non-empty string');
  }
  if (typeof owner !== 'string' || owner.length === 0) {
    throw new TypeError('recordEvent: owner must be a non-empty string (event/evidence ownership is mandatory)');
  }
  const normalizedJobId = jobId ?? null;
  const payloadText = JSON.stringify(data === undefined ? null : data) ?? 'null';
  const recordedAt = Date.now();
  const result = database
    .prepare(SQL_INSERT_EVENT)
    .run(normalizedJobId, type, payloadText, owner, recordedAt);
  return {
    id: Number(result.lastInsertRowid),
    jobId: normalizedJobId,
    type,
    data,
    owner,
    recordedAt,
  };
}

function rowToEvent(row: Record<string, unknown>): DurableEvent {
  let data: unknown = row.data;
  if (typeof row.data === 'string') {
    try {
      data = JSON.parse(row.data) as unknown;
    } catch {
      data = row.data;
    }
  }
  const jobId = row.job_id === null || row.job_id === undefined ? null : String(row.job_id);
  return {
    id: Number(row.id),
    jobId,
    type: String(row.type),
    data,
    owner: String(row.owner),
    recordedAt: Number(row.recorded_at),
  };
}

/** List events associated with a job, oldest first. */
export function listEventsByJob(database: DurableDatabase, jobId: string, limit: number = 100): DurableEvent[] {
  const rows = database
    .prepare(SQL_SELECT_BY_JOB)
    .all(jobId, limit) as Array<Record<string, unknown>>;
  return rows.map(rowToEvent);
}

/** List the most recent events across all owners, newest first. */
export function listRecentEvents(database: DurableDatabase, limit: number = 100): DurableEvent[] {
  const rows = database.prepare(SQL_SELECT_RECENT).all(limit) as Array<Record<string, unknown>>;
  return rows.map(rowToEvent);
}
