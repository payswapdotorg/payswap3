/**
 * DEP-003 — Durable queue.
 *
 * enqueue(kind, payload, {idempotencyKey, maxAttempts, availableAt})
 *   Deduplicated by the UNIQUE (idempotency_key, kind) constraint: enqueueing
 *   the same (kind, idempotencyKey) twice results in exactly ONE job row —
 *   the second call reports `created: false` and returns the existing job.
 *   A NULL/omitted idempotency key opts out of dedupe.
 *
 * reserve(workerId, leaseMs, {kind})
 *   Claims ONE available job atomically (BEGIN IMMEDIATE transaction:
 *   candidate select → conditional UPDATE status='reserved' + lease → read
 *   back). Only jobs in 'queued'/'failed' status whose available_at has
 *   passed are claimable; FIFO order is (available_at, created_at, id).
 *
 * complete(jobId, workerId?) / fail(jobId, error, workerId?)
 *   Terminal success, or deterministic exponential backoff: attempts+1;
 *   status → 'queued' with available_at = now + backoff(attempts), or
 *   'dead_lettered' once attempts reaches max_attempts. The optional
 *   workerId guards against a late completion/failure from a worker whose
 *   lease was already reclaimed by someone else.
 *
 * reclaimExpired(now)
 *   At-least-once redelivery: reserved jobs whose lease expired return to
 *   'queued' with attempts+1 (dead-lettered at the bound). Crash-safe by
 *   design — an abrupt process death simply leaves the lease to expire.
 *
 * Hard boundary: this module moves job ROWS, never financial meaning. All
 * SQL below is a static string literal with bound parameters — no data is
 * ever interpolated into a statement.
 */
import { randomUUID } from 'node:crypto';
import type { DurableDatabase } from './db';

export type DurableJobStatus = 'queued' | 'reserved' | 'succeeded' | 'failed' | 'dead_lettered';

export interface DurableJob {
  id: string;
  kind: string;
  idempotencyKey: string | null;
  payload: unknown;
  status: DurableJobStatus;
  attempts: number;
  maxAttempts: number;
  reservedBy: string | null;
  leaseExpiresAt: number | null;
  availableAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface EnqueueOptions {
  /** Dedupe identity within (kind, idempotencyKey). null/omitted = no dedupe. */
  idempotencyKey?: string | null;
  /** Bounded retry limit (>= 1). Default: 5. */
  maxAttempts?: number;
  /** Epoch-ms time from which the job may be reserved. Default: now. */
  availableAt?: number;
}

export interface EnqueueResult {
  /** false when an existing (kind, idempotencyKey) row absorbed this enqueue. */
  created: boolean;
  reason: 'enqueued' | 'deduplicated';
  job: DurableJob;
}

export type DurableLifecycleEventType =
  | 'job_enqueued'
  | 'job_enqueue_deduped'
  | 'job_reserved'
  | 'job_succeeded'
  | 'job_attempt_failed'
  | 'job_dead_lettered'
  | 'job_lease_expired';

export interface DurableLifecycleEvent {
  type: DurableLifecycleEventType;
  jobId: string;
  data: Record<string, unknown>;
}

/** Injected lifecycle-event sink (wired to events.recordEvent by index.ts). */
export type DurableEventEmitter = (event: DurableLifecycleEvent) => void;

export interface DurableQueueOptions {
  /** First retry delay. Default: 1000 ms. */
  backoffBaseMs?: number;
  /** Backoff ceiling. Default: 300000 ms (5 minutes). */
  backoffMaxMs?: number;
  emitEvent?: DurableEventEmitter;
}

export interface ReserveOptions {
  /** Restrict the claim to this job kind (used by the worker's handler registry). */
  kind?: string | null;
}

export type FailOutcome = 'requeued' | 'dead_lettered' | 'ignored';

export interface FailResult {
  outcome: FailOutcome;
  job: DurableJob | null;
}

export interface ReclaimResult {
  reclaimed: number;
  deadLettered: number;
}

export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_BACKOFF_BASE_MS = 1000;
export const DEFAULT_BACKOFF_MAX_MS = 300000;

const SQL_INSERT_JOB =
  "INSERT INTO durable_jobs (id, kind, idempotency_key, payload, status, attempts, max_attempts, reserved_by, lease_expires_at, available_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', 0, ?, NULL, NULL, ?, ?, ?) ON CONFLICT (idempotency_key, kind) DO NOTHING";
const SQL_SELECT_JOB_BY_ID = "SELECT * FROM durable_jobs WHERE id = ?";
const SQL_SELECT_JOB_BY_KEY = "SELECT * FROM durable_jobs WHERE kind = ? AND idempotency_key = ?";
const SQL_SELECT_CANDIDATE =
  "SELECT id FROM durable_jobs WHERE status IN ('queued', 'failed') AND available_at <= ? AND (? IS NULL OR kind = ?) ORDER BY available_at ASC, created_at ASC, id ASC LIMIT 1";
const SQL_UPDATE_RESERVE =
  "UPDATE durable_jobs SET status = 'reserved', reserved_by = ?, lease_expires_at = ?, updated_at = ? WHERE id = ? AND status IN ('queued', 'failed') AND available_at <= ?";
const SQL_UPDATE_COMPLETE =
  "UPDATE durable_jobs SET status = 'succeeded', reserved_by = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'reserved' AND (? IS NULL OR reserved_by = ?)";
const SQL_UPDATE_FAIL =
  "UPDATE durable_jobs SET status = ?, attempts = ?, available_at = ?, reserved_by = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'reserved' AND (? IS NULL OR reserved_by = ?)";
const SQL_SELECT_EXPIRED =
  "SELECT id, attempts, max_attempts FROM durable_jobs WHERE status = 'reserved' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ? ORDER BY lease_expires_at ASC, id ASC";
const SQL_UPDATE_RECLAIM_RETRY =
  "UPDATE durable_jobs SET status = 'queued', attempts = ?, available_at = ?, reserved_by = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'reserved' AND lease_expires_at <= ?";
const SQL_UPDATE_RECLAIM_DEAD =
  "UPDATE durable_jobs SET status = 'dead_lettered', attempts = ?, reserved_by = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'reserved' AND lease_expires_at <= ?";
const SQL_UPDATE_RELEASE =
  "UPDATE durable_jobs SET status = 'queued', reserved_by = NULL, lease_expires_at = NULL, available_at = ?, updated_at = ? WHERE id = ? AND status = 'reserved' AND (? IS NULL OR reserved_by = ?)";
const SQL_COUNT_BY_STATUS = "SELECT status, COUNT(*) AS total FROM durable_jobs GROUP BY status";

type JobRow = Record<string, unknown>;

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function intOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePayload(raw: unknown): unknown {
  if (typeof raw !== 'string') {
    return raw === undefined ? null : raw;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function rowToJob(row: JobRow): DurableJob {
  return {
    id: String(row.id),
    kind: String(row.kind),
    idempotencyKey: textOrNull(row.idempotency_key),
    payload: parsePayload(row.payload),
    status: String(row.status) as DurableJobStatus,
    attempts: intOrZero(row.attempts),
    maxAttempts: intOrZero(row.max_attempts),
    reservedBy: textOrNull(row.reserved_by),
    leaseExpiresAt: row.lease_expires_at == null ? null : intOrZero(row.lease_expires_at),
    availableAt: intOrZero(row.available_at),
    createdAt: intOrZero(row.created_at),
    updatedAt: intOrZero(row.updated_at),
  };
}

function describeError(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}

export class DurableQueue {
  readonly #database: DurableDatabase;
  readonly #backoffBaseMs: number;
  readonly #backoffMaxMs: number;
  readonly #emitEvent: DurableEventEmitter;

  constructor(database: DurableDatabase, options: DurableQueueOptions = {}) {
    if (!database) {
      throw new TypeError('DurableQueue requires an open DurableDatabase');
    }
    this.#database = database;
    this.#backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.#backoffMaxMs = options.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
    this.#emitEvent = options.emitEvent ?? (() => {});
  }

  get database(): DurableDatabase {
    return this.#database;
  }

  /**
   * Deterministic exponential backoff for the Nth attempt (N >= 1):
   * min(backoffBaseMs * 2^(N-1), backoffMaxMs). No jitter: the same attempt
   * number always yields the same delay.
   */
  backoffMsForAttempt(attemptNumber: number): number {
    const exponent = Math.max(0, attemptNumber - 1);
    const raw = this.#backoffBaseMs * Math.pow(2, exponent);
    return Math.min(Math.ceil(raw), this.#backoffMaxMs);
  }

  enqueue(kind: string, payload: unknown, options: EnqueueOptions = {}): EnqueueResult {
    if (typeof kind !== 'string' || kind.length === 0) {
      throw new TypeError('enqueue: kind must be a non-empty string');
    }
    const idempotencyKey = options.idempotencyKey ?? null;
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new RangeError('enqueue: maxAttempts must be an integer >= 1');
    }
    const now = Date.now();
    const availableAt = options.availableAt ?? now;
    const payloadText = JSON.stringify(payload === undefined ? null : payload) ?? 'null';
    const id = randomUUID();

    const insert = this.#database
      .prepare(SQL_INSERT_JOB)
      .run(id, kind, idempotencyKey, payloadText, maxAttempts, availableAt, now, now);
    if (Number(insert.changes) === 1) {
      const job = this.getJob(id);
      if (!job) {
        throw new Error('enqueue: inserted job row could not be read back');
      }
      this.#emitEvent({ type: 'job_enqueued', jobId: job.id, data: { kind, idempotencyKey, maxAttempts } });
      return { created: true, reason: 'enqueued', job };
    }
    if (idempotencyKey === null) {
      throw new Error('enqueue: insert affected no rows without an idempotency key');
    }
    const existing = this.getByIdempotencyKey(kind, idempotencyKey);
    if (!existing) {
      throw new Error('enqueue: deduplicated insert matched no existing row');
    }
    this.#emitEvent({ type: 'job_enqueue_deduped', jobId: existing.id, data: { kind, idempotencyKey } });
    return { created: false, reason: 'deduplicated', job: existing };
  }

  /**
   * Atomically claim ONE available job (status → 'reserved', lease set).
   * Returns null when nothing is claimable. The claim is a single
   * transaction: candidate select → conditional UPDATE → read-back, so two
   * concurrent reservers can never hold the same job.
   */
  reserve(workerId: string, leaseMs: number, options: ReserveOptions = {}): DurableJob | null {
    if (typeof workerId !== 'string' || workerId.length === 0) {
      throw new TypeError('reserve: workerId must be a non-empty string');
    }
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
      throw new RangeError('reserve: leaseMs must be a positive number');
    }
    const kind = options.kind ?? null;
    const now = Date.now();
    const leaseExpiresAt = now + Math.floor(leaseMs);

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const candidate = this.#database
        .prepare(SQL_SELECT_CANDIDATE)
        .get(now, kind, kind) as JobRow | undefined;
      if (!candidate || candidate.id === undefined || candidate.id === null) {
        this.#database.exec("ROLLBACK");
        return null;
      }
      const id = String(candidate.id);
      const updated = this.#database
        .prepare(SQL_UPDATE_RESERVE)
        .run(workerId, leaseExpiresAt, now, id, now);
      if (Number(updated.changes) !== 1) {
        this.#database.exec("ROLLBACK");
        return null;
      }
      const job = this.getJob(id);
      if (!job) {
        this.#database.exec("ROLLBACK");
        return null;
      }
      this.#database.exec("COMMIT");
      this.#emitEvent({
        type: 'job_reserved',
        jobId: id,
        data: { workerId, kind: job.kind, leaseExpiresAt, attempts: job.attempts },
      });
      return job;
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // transaction already ended
      }
      throw error;
    }
  }

  /** Mark a reserved job succeeded. Returns false if the claim is no longer valid. */
  complete(jobId: string, workerId?: string | null): boolean {
    if (typeof jobId !== 'string' || jobId.length === 0) {
      throw new TypeError('complete: jobId must be a non-empty string');
    }
    const now = Date.now();
    const owner = workerId ?? null;
    const updated = this.#database.prepare(SQL_UPDATE_COMPLETE).run(now, jobId, owner, owner);
    if (Number(updated.changes) !== 1) {
      return false;
    }
    this.#emitEvent({ type: 'job_succeeded', jobId, data: { workerId: owner } });
    return true;
  }

  /**
   * Report a failed execution of a reserved job. Deterministic exponential
   * backoff: attempts := attempts + 1; if attempts >= max_attempts the job
   * is dead_lettered (terminal — no further retries); otherwise it returns
   * to 'queued' with available_at = now + backoffMsForAttempt(attempts).
   * Returns outcome 'ignored' when the job is not currently claimable by
   * this worker (e.g. already reclaimed, dead-lettered, or completed).
   */
  fail(jobId: string, error: unknown, workerId?: string | null): FailResult {
    if (typeof jobId !== 'string' || jobId.length === 0) {
      throw new TypeError('fail: jobId must be a non-empty string');
    }
    const owner = workerId ?? null;
    const now = Date.now();
    const current = this.getJob(jobId);
    if (!current) {
      return { outcome: 'ignored', job: null };
    }
    if (current.status !== 'reserved') {
      return { outcome: 'ignored', job: current };
    }
    const attempts = current.attempts + 1;
    const deadLetter = attempts >= current.maxAttempts;
    const nextStatus: DurableJobStatus = deadLetter ? 'dead_lettered' : 'queued';
    const backoffMs = deadLetter ? 0 : this.backoffMsForAttempt(attempts);
    const availableAt = now + backoffMs;
    const errorText = describeError(error);

    const updated = this.#database
      .prepare(SQL_UPDATE_FAIL)
      .run(nextStatus, attempts, availableAt, now, jobId, owner, owner);
    if (Number(updated.changes) !== 1) {
      return { outcome: 'ignored', job: this.getJob(jobId) ?? current };
    }
    this.#emitEvent({
      type: 'job_attempt_failed',
      jobId,
      data: { error: errorText, attempts, maxAttempts: current.maxAttempts, backoffMs, nextStatus },
    });
    if (deadLetter) {
      this.#emitEvent({
        type: 'job_dead_lettered',
        jobId,
        data: { attempts, maxAttempts: current.maxAttempts, error: errorText },
      });
    }
    return { outcome: deadLetter ? 'dead_lettered' : 'requeued', job: this.getJob(jobId) ?? current };
  }

  /**
   * At-least-once redelivery of lease-expired jobs: each reclaimed job
   * returns to 'queued' with attempts + 1 (bounded: dead_lettered when
   * attempts reaches max_attempts). Atomic across the reclaimed set.
   */
  reclaimExpired(now: number = Date.now()): ReclaimResult {
    let reclaimed = 0;
    let deadLettered = 0;
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const expired = this.#database.prepare(SQL_SELECT_EXPIRED).all(now) as JobRow[];
      for (const row of expired) {
        const id = String(row.id);
        const attempts = intOrZero(row.attempts) + 1;
        const maxAttempts = intOrZero(row.max_attempts);
        if (attempts >= maxAttempts) {
          const updated = this.#database.prepare(SQL_UPDATE_RECLAIM_DEAD).run(attempts, now, id, now);
          if (Number(updated.changes) === 1) {
            deadLettered += 1;
            this.#emitEvent({
              type: 'job_dead_lettered',
              jobId: id,
              data: { attempts, maxAttempts, cause: 'lease_expired' },
            });
          }
        } else {
          const updated = this.#database.prepare(SQL_UPDATE_RECLAIM_RETRY).run(attempts, now, now, id, now);
          if (Number(updated.changes) === 1) {
            reclaimed += 1;
            this.#emitEvent({
              type: 'job_lease_expired',
              jobId: id,
              data: { attempts, maxAttempts },
            });
          }
        }
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // transaction already ended
      }
      throw error;
    }
    return { reclaimed, deadLettered };
  }

  /**
   * Return a reserved job to 'queued' WITHOUT counting an attempt (no
   * penalty). Used by the worker when a job was reserved but its handler
   * disappeared mid-tick (unregistered concurrently).
   */
  release(jobId: string, workerId?: string | null): boolean {
    if (typeof jobId !== 'string' || jobId.length === 0) {
      throw new TypeError('release: jobId must be a non-empty string');
    }
    const owner = workerId ?? null;
    const now = Date.now();
    const updated = this.#database.prepare(SQL_UPDATE_RELEASE).run(now, now, jobId, owner, owner);
    return Number(updated.changes) === 1;
  }

  getJob(jobId: string): DurableJob | null {
    const row = this.#database.prepare(SQL_SELECT_JOB_BY_ID).get(jobId) as JobRow | undefined;
    return row ? rowToJob(row) : null;
  }

  getByIdempotencyKey(kind: string, idempotencyKey: string): DurableJob | null {
    const row = this.#database
      .prepare(SQL_SELECT_JOB_BY_KEY)
      .get(kind, idempotencyKey) as JobRow | undefined;
    return row ? rowToJob(row) : null;
  }

  stats(): Record<DurableJobStatus, number> {
    const rows = this.#database.prepare(SQL_COUNT_BY_STATUS).all() as JobRow[];
    const result: Record<DurableJobStatus, number> = {
      queued: 0,
      reserved: 0,
      succeeded: 0,
      failed: 0,
      dead_lettered: 0,
    };
    for (const row of rows) {
      result[String(row.status) as DurableJobStatus] = intOrZero(row.total);
    }
    return result;
  }
}
