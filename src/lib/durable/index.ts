/**
 * DEP-003 — Durable execution substrate: module-level singleton barrel.
 *
 * init() opens the configured database, applies migrations, and wires the
 * queue, worker, and lifecycle-event recorder together. init-once
 * semantics: a second init() returns the existing runtime (and rejects a
 * conflicting database path); after close() the runtime can be
 * re-initialized.
 *
 * Public surface (work order): init(), register(), start(), stop(),
 * enqueue(), recordEvent() — plus scheduleRecurring() for deterministic
 * recurring work.
 *
 * Hard boundary: the substrate executes jobs via REGISTERED HANDLERS only.
 * register(kind, handler) is the single integration point; this module
 * hosts no financial authority, decides no financial outcomes, computes no
 * balances, and signs nothing. Future protocol authorities plug in via
 * register() and own their own evidence via recordEvent(type, data, owner).
 *
 * Usage note: server-side only. This barrel performs runtime value imports
 * from its sibling modules, so it is intended to be loaded by the
 * application's module bundler (Next.js server runtime), never by plain
 * Node scripts — the underlying modules (db/queue/worker/scheduler/events)
 * are individually loadable in plain Node and are exercised that way by
 * scripts/test_durable.mjs.
 */
import { resolve } from 'node:path';
import { openDurableDatabase } from './db';
import { DurableQueue } from './queue';
import { DurableWorker } from './worker';
import {
  enqueueTick,
  computeTick,
  tickIdempotencyKey,
  scheduleRecurring as scheduleRecurringOnQueue,
} from './scheduler';
import {
  recordEvent as recordEventOnDatabase,
  listEventsByJob,
  listRecentEvents,
  SUBSTRATE_EVENT_OWNER,
} from './events';
import type { DurableDatabase, DurableDatabaseOptions } from './db';
import type {
  DurableLifecycleEvent,
  EnqueueOptions,
  EnqueueResult,
} from './queue';
import type { DurableJobHandler } from './worker';
import type {
  RecurringSchedule,
  RecurringScheduleOptions,
  TickPayloadFn,
} from './scheduler';
import type { DurableEvent } from './events';

export interface DurableInitOptions extends DurableDatabaseOptions {
  workerId?: string;
  concurrency?: number;
  leaseMs?: number;
  pollIntervalMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

export interface DurableRuntime {
  readonly database: DurableDatabase;
  readonly queue: DurableQueue;
  readonly worker: DurableWorker;
  /** THE integration point for future protocol authorities. */
  register(kind: string, handler: DurableJobHandler): DurableRuntime;
  /** Start the worker loop. */
  start(): DurableRuntime;
  /** Graceful stop: stop schedules + worker loop, await in-flight jobs. */
  stop(): Promise<void>;
  enqueue(kind: string, payload: unknown, options?: EnqueueOptions): EnqueueResult;
  scheduleRecurring(
    kind: string,
    payloadFn: TickPayloadFn,
    intervalMs: number,
    options?: Omit<RecurringScheduleOptions, 'now'>,
  ): RecurringSchedule;
  recordEvent(type: string, data: unknown, owner: string, jobId?: string | null): DurableEvent;
  /** Full teardown: stop() then close the database. Allows re-init. */
  close(): Promise<void>;
}

let runtime: DurableRuntime | null = null;

/** The current runtime, or null when not initialized. */
export function getDurableRuntime(): DurableRuntime | null {
  return runtime;
}

/** Initialize the substrate (idempotent: returns the existing runtime). */
export function init(options: DurableInitOptions = {}): DurableRuntime {
  if (runtime !== null && runtime.database.isOpen()) {
    if (options.dbPath && resolve(options.dbPath) !== runtime.database.path) {
      throw new Error(
        'durable runtime already initialized with a different dbPath; call close() before re-initializing',
      );
    }
    return runtime;
  }
  const database = openDurableDatabase({
    dbPath: options.dbPath,
    migrationsDir: options.migrationsDir,
  });
  const queue = new DurableQueue(database, {
    backoffBaseMs: options.backoffBaseMs,
    backoffMaxMs: options.backoffMaxMs,
    emitEvent: (event: DurableLifecycleEvent) => {
      recordEventOnDatabase(database, event.type, event.data, SUBSTRATE_EVENT_OWNER, event.jobId);
    },
  });
  const worker = new DurableWorker({
    queue,
    workerId: options.workerId,
    concurrency: options.concurrency,
    leaseMs: options.leaseMs,
    pollIntervalMs: options.pollIntervalMs,
  });
  const schedules: RecurringSchedule[] = [];

  const instance: DurableRuntime = {
    database,
    queue,
    worker,
    register(kind, handler) {
      worker.register(kind, handler);
      return instance;
    },
    start() {
      worker.start();
      return instance;
    },
    stop() {
      for (const schedule of schedules) {
        schedule.stop();
      }
      return worker.stop();
    },
    enqueue(kind, payload, enqueueOptions) {
      return queue.enqueue(kind, payload, enqueueOptions);
    },
    scheduleRecurring(kind, payloadFn, intervalMs, recurringOptions) {
      const schedule = scheduleRecurringOnQueue(queue, kind, payloadFn, intervalMs, recurringOptions);
      schedules.push(schedule);
      return schedule;
    },
    recordEvent(type, data, owner, jobId) {
      return recordEventOnDatabase(database, type, data, owner, jobId);
    },
    async close() {
      for (const schedule of schedules) {
        schedule.stop();
      }
      await worker.stop();
      database.close();
      runtime = null;
    },
  };
  runtime = instance;
  return instance;
}

function requireRuntime(): DurableRuntime {
  if (runtime === null) {
    throw new Error('durable runtime is not initialized; call init() first');
  }
  return runtime;
}

export function enqueue(kind: string, payload: unknown, options?: EnqueueOptions): EnqueueResult {
  return requireRuntime().enqueue(kind, payload, options);
}

export function register(kind: string, handler: DurableJobHandler): void {
  requireRuntime().register(kind, handler);
}

export function start(): void {
  requireRuntime().start();
}

export async function stop(): Promise<void> {
  if (runtime !== null) {
    await runtime.stop();
  }
}

export function recordEvent(type: string, data: unknown, owner: string, jobId?: string | null): DurableEvent {
  return requireRuntime().recordEvent(type, data, owner, jobId);
}

export function scheduleRecurring(
  kind: string,
  payloadFn: TickPayloadFn,
  intervalMs: number,
  options?: Omit<RecurringScheduleOptions, 'now'>,
): RecurringSchedule {
  return requireRuntime().scheduleRecurring(kind, payloadFn, intervalMs, options);
}

export {
  openDurableDatabase,
  getDurableDbPath,
  resolveMigrationsDir,
  runMigrations,
  DurableMigrationError,
  DEFAULT_DURABLE_DB_PATH,
  DURABLE_DB_ENV_VAR,
  DURABLE_MIGRATIONS_ENV_VAR,
} from './db';
export { DurableQueue, DEFAULT_MAX_ATTEMPTS, DEFAULT_BACKOFF_BASE_MS, DEFAULT_BACKOFF_MAX_MS } from './queue';
export { DurableWorker } from './worker';
export {
  enqueueTick,
  computeTick,
  tickIdempotencyKey,
  scheduleRecurring as scheduleRecurringOnQueue,
} from './scheduler';
export { listEventsByJob, listRecentEvents, SUBSTRATE_EVENT_OWNER } from './events';

export type { DurableDatabase, DurableDatabaseOptions, AppliedMigration, MigrationRunResult } from './db';
export type {
  DurableJob,
  DurableJobStatus,
  DurableQueueOptions,
  DurableLifecycleEvent,
  DurableLifecycleEventType,
  DurableEventEmitter,
  EnqueueOptions,
  EnqueueResult,
  FailOutcome,
  FailResult,
  ReclaimResult,
  ReserveOptions,
} from './queue';
export type { DurableWorkerOptions, DurableJobHandler } from './worker';
export type {
  RecurringSchedule,
  RecurringScheduleOptions,
  TickPayloadFn,
  TickEnqueueOptions,
} from './scheduler';
export type { DurableEvent } from './events';
