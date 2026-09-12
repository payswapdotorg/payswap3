/**
 * RTN-011 — Transition runtime: the owned in-surface substrate test
 * double.
 *
 * An in-memory, clock-injectable double of the DEP-003 durable execution
 * substrate's PUBLIC contract (the same repository convention as
 * rails/evidence-test-double.ts and settlement/rails-test-double.ts):
 * bun does not implement node:sqlite, so the bun test suites exercise
 * the transition runtime's semantics against this faithful mirror while
 * the REAL substrate compositions (real node:sqlite queue + worker +
 * lease reclaim + scheduler) run in the plain-Node harness
 * scripts/test_protocol_transition_hosting.mjs, enqueuing commands
 * through the substrate's PUBLIC enqueue API.
 *
 * The double mirrors the documented contract of spec/durable/execution.md
 * §5-§12 exactly (states, dedupe, reservation/lease/redelivery, bounded
 * retry with deterministic backoff, event ownership):
 *   - §5 job lifecycle: queued ──reserve──▶ reserved ──complete──▶
 *     succeeded; fail → queued (backoff) or dead_lettered at the bound;
 *     reclaimExpired (lease expired, attempts+1) → queued or
 *     dead_lettered at the bound; attempts counts FAILED executions and
 *     expired leases, never reservations;
 *   - §6 idempotency: enqueue deduplicated by UNIQUE (idempotency_key,
 *     kind) — the second call returns created:false with the existing
 *     job; NULL key opts out (protocol commands never do — the kernel
 *     envelope requires a key);
 *   - §7 reservation: one job per reserver, FIFO by
 *     (available_at, created_at, id), optional kind filter;
 *     complete/fail/release conditional on status='reserved' (and the
 *     owning worker when supplied);
 *   - §8 retries: deterministic backoff min(base * 2^(n-1), max);
 *   - §9 worker: reserves exclusively jobs whose kind has a REGISTERED
 *     handler; each tick: reclaimExpired first, then reserve per
 *     registered kind while capacity remains, then execute (complete on
 *     success, fail with bounded backoff on error);
 *   - §11 events: recordEvent with the mandatory owner.
 *
 * Deliberate simplification (documented): the worker dispatches handlers
 * SEQUENTIALLY inside tick() (the real worker dispatches concurrently
 * under its bounded-concurrency slot discipline — a substrate-internal
 * concern proven by DEP-003's own harness; the double models
 * concurrency=1). Crash-mid-execution is exercised through the queue's
 * PUBLIC reserve/reclaimExpired surface (reserve → execute → never
 * complete → lease expiry → reclaim → redelivery), which is exactly how
 * the Node harness drives the REAL substrate for the same scenario.
 *
 * Source: spec/durable/execution.md §5-§12 (the mirrored contract);
 * the repository's in-surface test-double convention (RTN-004
 * evidence-test-double.ts, RTN-009 rails-test-double.ts).
 */

import type {
  DurableJob,
  DurableJobStatus,
  EnqueueOptions,
  EnqueueResult,
} from '../../durable/queue.ts';
import type { TransitionQueueInsights, TransitionSubstrate } from './substrate-port.ts';

/** A durable_events row as recorded by the double (owner mandatory). */
export interface SubstrateDoubleEvent {
  readonly id: number;
  readonly jobId: string | null;
  readonly type: string;
  readonly data: unknown;
  readonly owner: string;
  readonly recordedAt: number;
}

interface DoubleJobRow {
  readonly id: string;
  readonly kind: string;
  readonly idempotencyKey: string | null;
  readonly payload: unknown;
  status: DurableJobStatus;
  attempts: number;
  readonly maxAttempts: number;
  reservedBy: string | null;
  leaseExpiresAt: number | null;
  availableAt: number;
  readonly createdAt: number;
  updatedAt: number;
}

export interface InMemoryDurableSubstrateOptions {
  /** Injectable clock (epoch ms) — deterministic tests. Default: Date.now. */
  readonly now?: () => number;
  /** Lease duration used by tick()'s reservations. Default: 60000 ms. */
  readonly leaseMs?: number;
  /** First retry delay (deterministic doubling). Default: 1000 ms. */
  readonly backoffBaseMs?: number;
  /** Backoff ceiling. Default: 300000 ms. */
  readonly backoffMaxMs?: number;
  /** Job id factory (deterministic tests). Default: incrementing counter. */
  readonly nextJobId?: () => string;
}

function describeError(error: unknown): string {
  return error instanceof Error && typeof error.message === 'string' ? error.message : String(error);
}

/**
 * The in-memory substrate double. Implements TransitionSubstrate plus the
 * queue's public surface (reserve/complete/fail/release/reclaimExpired)
 * and a worker-like tick(), mirroring spec/durable/execution.md §5-§12.
 */
export class InMemoryDurableSubstrate implements TransitionSubstrate {
  readonly #rows: DoubleJobRow[] = [];
  readonly #handlers = new Map<string, (job: DurableJob) => void | Promise<void>>();
  readonly #events: SubstrateDoubleEvent[] = [];
  readonly #now: () => number;
  readonly #leaseMs: number;
  readonly #backoffBaseMs: number;
  readonly #backoffMaxMs: number;
  readonly #nextJobId: () => string;
  #jobCounter = 0;
  #eventCounter = 0;

  constructor(options: InMemoryDurableSubstrateOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#leaseMs = options.leaseMs ?? 60000;
    this.#backoffBaseMs = options.backoffBaseMs ?? 1000;
    this.#backoffMaxMs = options.backoffMaxMs ?? 300000;
    this.#nextJobId =
      options.nextJobId ?? (() => {
        this.#jobCounter += 1;
        return `job-${this.#jobCounter}`;
      });
  }

  // -- TransitionSubstrate -------------------------------------------------

  register(kind: string, handler: (job: DurableJob) => void | Promise<void>): this {
    if (typeof kind !== 'string' || kind.length === 0) {
      throw new TypeError('register: kind must be a non-empty string');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('register: handler must be a function');
    }
    this.#handlers.set(kind, handler);
    return this;
  }

  enqueue(kind: string, payload: unknown, options: EnqueueOptions = {}): EnqueueResult {
    if (typeof kind !== 'string' || kind.length === 0) {
      throw new TypeError('enqueue: kind must be a non-empty string');
    }
    const idempotencyKey = options.idempotencyKey ?? null;
    const maxAttempts = options.maxAttempts ?? 5;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new RangeError('enqueue: maxAttempts must be an integer >= 1');
    }
    const now = this.#now();
    const availableAt = options.availableAt ?? now;
    if (idempotencyKey !== null) {
      const existing = this.#rows.find(
        (row) => row.kind === kind && row.idempotencyKey === idempotencyKey,
      );
      if (existing) {
        this.#recordEvent('job_enqueue_deduped', { kind, idempotencyKey }, 'durable-substrate', existing.id);
        return { created: false, reason: 'deduplicated', job: this.#job(existing) };
      }
    }
    const row: DoubleJobRow = {
      id: this.#nextJobId(),
      kind,
      idempotencyKey,
      payload,
      status: 'queued',
      attempts: 0,
      maxAttempts,
      reservedBy: null,
      leaseExpiresAt: null,
      availableAt,
      createdAt: now,
      updatedAt: now,
    };
    this.#rows.push(row);
    this.#recordEvent('job_enqueued', { kind, idempotencyKey, maxAttempts }, 'durable-substrate', row.id);
    return { created: true, reason: 'enqueued', job: this.#job(row) };
  }

  recordEvent(type: string, data: unknown, owner: string, jobId?: string | null): SubstrateDoubleEvent {
    return this.#recordEvent(type, data, owner, jobId);
  }

  readonly queue: TransitionQueueInsights = {
    stats: (): Record<DurableJobStatus, number> => {
      const result: Record<DurableJobStatus, number> = {
        queued: 0,
        reserved: 0,
        succeeded: 0,
        failed: 0,
        dead_lettered: 0,
      };
      for (const row of this.#rows) {
        result[row.status] += 1;
      }
      return result;
    },
    backlogExtremes: () => {
      let oldestBacklog: { readonly jobId: string; readonly createdAt: number } | null = null;
      let oldestEligible: { readonly jobId: string; readonly availableAt: number } | null = null;
      for (const row of this.#rows) {
        if (row.status === 'succeeded' || row.status === 'dead_lettered') {
          continue;
        }
        if (oldestBacklog === null || row.createdAt < oldestBacklog.createdAt) {
          oldestBacklog = { jobId: row.id, createdAt: row.createdAt };
        }
        if (
          (row.status === 'queued' || row.status === 'failed') &&
          (oldestEligible === null || row.availableAt < oldestEligible.availableAt)
        ) {
          oldestEligible = { jobId: row.id, availableAt: row.availableAt };
        }
      }
      return { oldestBacklog, oldestEligible };
    },
  };

  // -- The queue's public surface (execution.md §5-§8) ---------------------

  /** Registered kinds (the worker reserves exclusively these — §9). */
  registeredKinds(): string[] {
    return [...this.#handlers.keys()];
  }

  /**
   * Atomically claim ONE available job (execution.md §7): status →
   * 'reserved' with the lease set; FIFO by (availableAt, createdAt, id);
   * optional kind filter.
   */
  reserve(workerId: string, leaseMs: number = this.#leaseMs, options: { kind?: string | null } = {}): DurableJob | null {
    if (typeof workerId !== 'string' || workerId.length === 0) {
      throw new TypeError('reserve: workerId must be a non-empty string');
    }
    const now = this.#now();
    const kind = options.kind ?? null;
    const candidates = this.#rows
      .filter(
        (row) =>
          (row.status === 'queued' || row.status === 'failed') &&
          row.availableAt <= now &&
          (kind === null || row.kind === kind),
      )
      .sort((a, b) =>
        a.availableAt !== b.availableAt
          ? a.availableAt - b.availableAt
          : a.createdAt !== b.createdAt
            ? a.createdAt - b.createdAt
            : a.id < b.id
              ? -1
              : 1,
      );
    const row = candidates[0];
    if (!row) {
      return null;
    }
    row.status = 'reserved';
    row.reservedBy = workerId;
    row.leaseExpiresAt = now + Math.floor(leaseMs);
    row.updatedAt = now;
    const job = this.#job(row);
    this.#recordEvent(
      'job_reserved',
      { workerId, kind: row.kind, leaseExpiresAt: row.leaseExpiresAt, attempts: row.attempts },
      'durable-substrate',
      row.id,
    );
    return job;
  }

  /** Mark a reserved job succeeded (guarded: only its reserver). */
  complete(jobId: string, workerId?: string | null): boolean {
    const row = this.#row(jobId);
    if (!row || row.status !== 'reserved') {
      return false;
    }
    if (workerId !== undefined && workerId !== null && row.reservedBy !== workerId) {
      return false;
    }
    row.status = 'succeeded';
    row.reservedBy = null;
    row.leaseExpiresAt = null;
    row.updatedAt = this.#now();
    this.#recordEvent('job_succeeded', { workerId: workerId ?? null }, 'durable-substrate', row.id);
    return true;
  }

  /**
   * Report a failed execution (execution.md §8): deterministic backoff
   * attempts+1 → queued, or dead_lettered at the bound.
   */
  fail(jobId: string, error: unknown, workerId?: string | null): { outcome: 'requeued' | 'dead_lettered' | 'ignored' } {
    const row = this.#row(jobId);
    if (!row || row.status !== 'reserved') {
      return { outcome: 'ignored' };
    }
    if (workerId !== undefined && workerId !== null && row.reservedBy !== workerId) {
      return { outcome: 'ignored' };
    }
    const now = this.#now();
    row.attempts += 1;
    if (row.attempts >= row.maxAttempts) {
      row.status = 'dead_lettered';
      row.reservedBy = null;
      row.leaseExpiresAt = null;
      row.updatedAt = now;
      this.#recordEvent(
        'job_dead_lettered',
        { attempts: row.attempts, maxAttempts: row.maxAttempts, error: describeError(error) },
        'durable-substrate',
        row.id,
      );
      return { outcome: 'dead_lettered' };
    }
    const backoffMs = this.backoffMsForAttempt(row.attempts);
    row.status = 'queued';
    row.reservedBy = null;
    row.leaseExpiresAt = null;
    row.availableAt = now + backoffMs;
    row.updatedAt = now;
    this.#recordEvent(
      'job_attempt_failed',
      { error: describeError(error), attempts: row.attempts, maxAttempts: row.maxAttempts, backoffMs },
      'durable-substrate',
      row.id,
    );
    return { outcome: 'requeued' };
  }

  /** Return a reserved job to queued WITHOUT counting an attempt (§7). */
  release(jobId: string, workerId?: string | null): boolean {
    const row = this.#row(jobId);
    if (!row || row.status !== 'reserved') {
      return false;
    }
    if (workerId !== undefined && workerId !== null && row.reservedBy !== workerId) {
      return false;
    }
    const now = this.#now();
    row.status = 'queued';
    row.reservedBy = null;
    row.leaseExpiresAt = null;
    row.updatedAt = now;
    return true;
  }

  /**
   * At-least-once redelivery of lease-expired jobs (execution.md §7):
   * reserved + expired lease → queued with attempts+1 (dead_lettered at
   * the bound).
   */
  reclaimExpired(now: number = this.#now()): { reclaimed: number; deadLettered: number } {
    let reclaimed = 0;
    let deadLettered = 0;
    const expired = this.#rows
      .filter((row) => row.status === 'reserved' && row.leaseExpiresAt !== null && row.leaseExpiresAt <= now)
      .sort((a, b) => (a.leaseExpiresAt ?? 0) - (b.leaseExpiresAt ?? 0) || (a.id < b.id ? -1 : 1));
    for (const row of expired) {
      row.attempts += 1;
      row.reservedBy = null;
      row.leaseExpiresAt = null;
      row.updatedAt = now;
      if (row.attempts >= row.maxAttempts) {
        row.status = 'dead_lettered';
        deadLettered += 1;
        this.#recordEvent(
          'job_dead_lettered',
          { attempts: row.attempts, maxAttempts: row.maxAttempts, cause: 'lease_expired' },
          'durable-substrate',
          row.id,
        );
      } else {
        row.status = 'queued';
        row.availableAt = now;
        reclaimed += 1;
        this.#recordEvent(
          'job_lease_expired',
          { attempts: row.attempts, maxAttempts: row.maxAttempts },
          'durable-substrate',
          row.id,
        );
      }
    }
    return { reclaimed, deadLettered };
  }

  /** Deterministic backoff for the Nth attempt (§8): min(base·2^(N-1), max). */
  backoffMsForAttempt(attemptNumber: number): number {
    const exponent = Math.max(0, attemptNumber - 1);
    return Math.min(this.#backoffBaseMs * Math.pow(2, exponent), this.#backoffMaxMs);
  }

  // -- The worker loop (execution.md §9) ------------------------------------

  readonly workerId = 'double-worker-1';

  /**
   * One deterministic loop pass (mirrors DurableWorker.tick() at the
   * default bounded concurrency of 1): reclaimExpired() first, then
   * reserve ONE job among the REGISTERED kinds (registration order —
   * the real worker round-robins kinds under its capacity) and execute
   * it: complete() on success, fail() (bounded backoff) on error.
   * Returns the number of jobs dispatched (0 or 1). Unregistered kinds
   * are never reserved (they stay queued until their authority
   * registers — execution.md §9).
   */
  async tick(): Promise<number> {
    this.reclaimExpired();
    for (const kind of [...this.#handlers.keys()]) {
      const job = this.reserve(this.workerId, this.#leaseMs, { kind });
      if (!job) {
        continue;
      }
      const handler = this.#handlers.get(kind);
      if (!handler) {
        this.release(job.id, this.workerId);
        return 1;
      }
      try {
        await handler(job);
        this.complete(job.id, this.workerId);
      } catch (error) {
        this.fail(job.id, error, this.workerId);
      }
      return 1;
    }
    return 0;
  }

  /**
   * Repeat tick() until nothing is dispatchable (bounded): drains all
   * eligible jobs through the execution path. Returns total dispatches.
   */
  async drain(maxTicks: number = 100): Promise<number> {
    let total = 0;
    for (let i = 0; i < maxTicks; i += 1) {
      const dispatched = await this.tick();
      total += dispatched;
      if (dispatched === 0) {
        break;
      }
    }
    return total;
  }

  // -- Read access for tests -------------------------------------------------

  getJob(jobId: string): DurableJob | null {
    const row = this.#row(jobId);
    return row ? this.#job(row) : null;
  }

  getByIdempotencyKey(kind: string, idempotencyKey: string): DurableJob | null {
    const row = this.#rows.find((row_) => row_.kind === kind && row_.idempotencyKey === idempotencyKey);
    return row ? this.#job(row) : null;
  }

  /** All jobs, insertion order (test observability). */
  jobs(): readonly DurableJob[] {
    return this.#rows.map((row) => this.#job(row));
  }

  /** All recorded events, oldest first (test observability). */
  events(): readonly SubstrateDoubleEvent[] {
    return [...this.#events];
  }

  // -- internals ---------------------------------------------------------------

  #recordEvent(type: string, data: unknown, owner: string, jobId?: string | null): SubstrateDoubleEvent {
    if (typeof type !== 'string' || type.length === 0) {
      throw new TypeError('recordEvent: type must be a non-empty string');
    }
    if (typeof owner !== 'string' || owner.length === 0) {
      throw new TypeError('recordEvent: owner must be a non-empty string (evidence ownership is mandatory)');
    }
    this.#eventCounter += 1;
    const event: SubstrateDoubleEvent = {
      id: this.#eventCounter,
      jobId: jobId ?? null,
      type,
      data,
      owner,
      recordedAt: this.#now(),
    };
    this.#events.push(event);
    return event;
  }

  #row(jobId: string): DoubleJobRow | undefined {
    return this.#rows.find((row) => row.id === jobId);
  }

  #job(row: DoubleJobRow): DurableJob {
    return {
      id: row.id,
      kind: row.kind,
      idempotencyKey: row.idempotencyKey,
      payload: row.payload,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      reservedBy: row.reservedBy,
      leaseExpiresAt: row.leaseExpiresAt,
      availableAt: row.availableAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
