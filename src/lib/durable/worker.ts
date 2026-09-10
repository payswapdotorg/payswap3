/**
 * DEP-003 — Durable worker loop.
 *
 * Executes queued jobs EXCLUSIVELY through registered handlers:
 *   worker.register(kind, handler)
 * is the single integration point of the whole substrate — future protocol
 * authorities plug in there. The substrate itself never decides financial
 * outcomes, never computes balances, never signs anything; a handler that
 * does not exist simply means the job stays queued until the authority
 * arrives (the worker only reserves jobs whose kind is registered).
 *
 * Loop contract per tick:
 *   1. reclaimExpired() — return lease-expired jobs to the queue
 *      (crash safety for workers that died mid-execution),
 *   2. while capacity remains: reserve one job per registered kind,
 *   3. execute the handler; complete() on success, fail() (deterministic
 *      bounded backoff) on error.
 *
 * Concurrency is bounded (default 1). stop() is graceful: it stops
 * scheduling and awaits in-flight executions. Crash-safe by design: an
 * abrupt death leaves the job 'reserved' until its lease expires and the
 * next worker's reclaimExpired() redelivers it (at-least-once; handlers
 * must be idempotent under the job's idempotency key).
 *
 * Runtime note: only type-only imports from sibling modules (erased at
 * load time) so this file loads in plain Node with type stripping; the
 * queue is injected via the constructor.
 */
import { randomUUID } from 'node:crypto';
import type { DurableJob, DurableQueue } from './queue';

export type DurableJobHandler = (job: DurableJob) => void | Promise<void>;

export interface DurableWorkerOptions {
  queue: DurableQueue;
  /** Stable identity of this worker instance (recorded on reservations). */
  workerId?: string;
  /** Bounded concurrency. Default: 1. */
  concurrency?: number;
  /** Lease duration for each reservation. Default: 60000 ms. */
  leaseMs?: number;
  /** Poll interval of the loop. Default: 500 ms. */
  pollIntervalMs?: number;
  /** Injectable clock (tests). Default: Date.now. */
  now?: () => number;
  /** Injectable error logger. Default: stderr. */
  log?: (message: string) => void;
}

function describeError(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}

function unrefTimer(timer: unknown): void {
  if (timer && typeof timer === 'object' && typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }
}

export class DurableWorker {
  readonly #queue: DurableQueue;
  readonly #workerId: string;
  readonly #concurrency: number;
  readonly #leaseMs: number;
  readonly #pollIntervalMs: number;
  readonly #now: () => number;
  readonly #log: (message: string) => void;
  readonly #handlers = new Map<string, DurableJobHandler>();
  readonly #active = new Set<Promise<void>>();
  #running = false;
  #timer: unknown = null;

  constructor(options: DurableWorkerOptions) {
    if (!options.queue) {
      throw new TypeError('DurableWorker requires a DurableQueue');
    }
    this.#queue = options.queue;
    this.#workerId = options.workerId ?? `worker-${randomUUID()}`;
    const concurrency = options.concurrency ?? 1;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new RangeError('DurableWorker: concurrency must be an integer >= 1');
    }
    this.#concurrency = concurrency;
    this.#leaseMs = options.leaseMs ?? 60000;
    this.#pollIntervalMs = options.pollIntervalMs ?? 500;
    this.#now = options.now ?? Date.now;
    this.#log =
      options.log ?? ((message: string) => {
        process.stderr.write(`[durable-worker] ${message}\n`);
      });
  }

  get workerId(): string {
    return this.#workerId;
  }

  get running(): boolean {
    return this.#running;
  }

  get concurrency(): number {
    return this.#concurrency;
  }

  registeredKinds(): string[] {
    return [...this.#handlers.keys()];
  }

  /** THE integration point: register the handler that executes a job kind. */
  register(kind: string, handler: DurableJobHandler): this {
    if (typeof kind !== 'string' || kind.length === 0) {
      throw new TypeError('register: kind must be a non-empty string');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('register: handler must be a function');
    }
    this.#handlers.set(kind, handler);
    return this;
  }

  unregister(kind: string): this {
    this.#handlers.delete(kind);
    return this;
  }

  /** Start the polling loop (idempotent). The interval timer is unref'd. */
  start(): this {
    if (this.#running) {
      return this;
    }
    this.#running = true;
    void this.#tickSafely();
    const timer: unknown = setInterval(() => {
      void this.#tickSafely();
    }, this.#pollIntervalMs);
    unrefTimer(timer);
    this.#timer = timer;
    return this;
  }

  /** Graceful stop: stop scheduling and await in-flight executions. */
  async stop(): Promise<void> {
    this.#running = false;
    if (this.#timer !== null) {
      clearInterval(this.#timer as Parameters<typeof clearInterval>[0]);
      this.#timer = null;
    }
    while (this.#active.size > 0) {
      await Promise.allSettled([...this.#active]);
    }
  }

  /**
   * One deterministic loop pass (also usable without start()): reclaim
   * expired leases, then reserve up to (concurrency - inFlight) jobs among
   * the registered kinds. Returns the number of jobs dispatched.
   */
  async tick(): Promise<number> {
    const kinds = [...this.#handlers.keys()];
    if (kinds.length === 0) {
      // No handlers registered yet: jobs of unregistered kinds are never
      // reserved — they stay queued until their authority registers.
      return 0;
    }
    this.#queue.reclaimExpired(this.#now());
    let dispatched = 0;
    while (this.#active.size < this.#concurrency) {
      let reservedAny = false;
      for (const kind of kinds) {
        if (this.#active.size >= this.#concurrency) {
          break;
        }
        const job = this.#queue.reserve(this.#workerId, this.#leaseMs, { kind });
        if (!job) {
          continue;
        }
        reservedAny = true;
        dispatched += 1;
        this.#dispatch(job);
      }
      if (!reservedAny) {
        break;
      }
    }
    return dispatched;
  }

  async #tickSafely(): Promise<void> {
    try {
      await this.tick();
    } catch (error) {
      this.#log(`tick failed: ${describeError(error)}`);
    }
  }

  #dispatch(job: DurableJob): void {
    const handler = this.#handlers.get(job.kind);
    if (!handler) {
      // Handler vanished between reservation and dispatch: release the
      // lease without penalty so the job stays queued for its authority.
      try {
        this.#queue.release(job.id, this.#workerId);
      } catch (error) {
        this.#log(`release failed for job ${job.id}: ${describeError(error)}`);
      }
      return;
    }
    const execution = this.#execute(job, handler);
    this.#active.add(execution);
    void execution.then(
      () => {
        this.#active.delete(execution);
      },
      () => {
        this.#active.delete(execution);
        this.#log(`job ${job.id} execution ended with an internal error`);
      },
    );
  }

  async #execute(job: DurableJob, handler: DurableJobHandler): Promise<void> {
    try {
      await handler(job);
      this.#queue.complete(job.id, this.#workerId);
    } catch (error) {
      try {
        this.#queue.fail(job.id, error, this.#workerId);
      } catch (failError) {
        // The lease is the safety net: an un-reportable failure simply
        // expires and is redelivered by reclaimExpired().
        this.#log(`fail() rejected for job ${job.id}: ${describeError(failError)}`);
      }
    }
  }
}
