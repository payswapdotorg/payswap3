/**
 * DEP-007 — Recovery: recovery replay over the EXISTING worker/queue API.
 *
 * Owned surface: src/lib/recovery/replay.ts (work order DEP-007 — "Queue
 * and worker recovery are proven"; "Event/journal replay preserves
 * idempotency").
 *
 * THE REPLAY CONTRACT:
 *   - NEVER BYPASSES THE SUBSTRATE: replay re-drives a restored store
 *     through the SAME exported classes the application composes —
 *     DurableQueue + DurableWorker (src/lib/durable/queue.ts / worker.ts)
 *     — constructed over the restored database handle by
 *     bindDurableRuntime(), with the lifecycle-event wiring the substrate's
 *     own barrel performs (emitEvent → recordEvent under owner
 *     'durable-substrate'). No SQL, no direct row mutation, no second
 *     execution path: the worker reserves, executes registered handlers,
 *     completes or fails with bounded backoff, and reclaimExpired()
 *     redelivers lease-expired jobs — exactly the production loop.
 *   - IDEMPOTENT BY CONSTRUCTION: the substrate's UNIQUE (idempotency_key,
 *     kind) is the backstop the drill proves — a replayed enqueue of the
 *     same (kind, key) is absorbed (created: false, job_enqueue_deduped),
 *     and a crash-redelivered job re-executes its handler whose effects
 *     are guarded by the recorded receipts (the drill's handlers check the
 *     journal before recording an effect — one effect per key, ever).
 *   - UNKNOWN IS NEVER RETRIED HERE EITHER: the drain loop surfaces
 *     UNKNOWN-outcome events it observes (the drill's handlers record
 *     them); it never re-drives a job BECAUSE its outcome was UNKNOWN
 *     (redelivery happens only through lease expiry — the at-least-once
 *     substrate rule).
 *
 * bindDurableRuntime() is the reusable NON-singleton composition over an
 * explicit database handle (the substrate's init() barrel is a singleton
 * over the configured path; recovery needs one runtime per restored COPY,
 * so the same exported classes are composed here — the documented
 * wrap-don't-patch rule).
 */

import { DurableQueue } from '../durable/queue.ts';
import { DurableWorker } from '../durable/worker.ts';
import { recordEvent as recordEventOnDatabase } from '../durable/events.ts';
import { SUBSTRATE_EVENT_OWNER } from '../durable/events.ts';
import type { DurableDatabase } from '../durable/db.ts';
import type { DurableJobStatus, EnqueueOptions, EnqueueResult } from '../durable/queue.ts';
import type { DurableJobHandler } from '../durable/worker.ts';
import { RECOVERY_EVENT_OWNER, RECOVERY_EVENT_TYPES } from './journal.ts';
import type { RecoveryAuditPort } from './journal.ts';

// ---------------------------------------------------------------------------
// The non-singleton substrate composition over an explicit handle
// ---------------------------------------------------------------------------

export interface BindDurableRuntimeOptions {
  /** The database handle to compose over (the restored copy, or any store). */
  readonly database: DurableDatabase;
  /** Stable worker identity (recorded on reservations). Default: dep007-replay-<random>. */
  readonly workerId?: string;
  /** Bounded concurrency. Default: 1. */
  readonly concurrency?: number;
  /** Lease duration per reservation. Default: 60000 ms. */
  readonly leaseMs?: number;
  /** Poll interval (unused by the manual drain; kept for start() parity). Default: 500 ms. */
  readonly pollIntervalMs?: number;
  /** Deterministic backoff base. Default: 1000 ms. */
  readonly backoffBaseMs?: number;
  /** Deterministic backoff ceiling. Default: 300000 ms. */
  readonly backoffMaxMs?: number;
}

/** The substrate surface a replay drives (the exported classes, composed). */
export interface BoundDurableRuntime {
  readonly database: DurableDatabase;
  readonly queue: DurableQueue;
  readonly worker: DurableWorker;
  /** THE integration point (the substrate's register, verbatim). */
  register(kind: string, handler: DurableJobHandler): BoundDurableRuntime;
  /** The substrate's public enqueue (verbatim). */
  enqueue(kind: string, payload: unknown, options?: EnqueueOptions): EnqueueResult;
  /** The substrate's public recordEvent (verbatim). */
  recordEvent(type: string, data: unknown, owner: string, jobId?: string | null): unknown;
  /** Graceful stop of the worker loop. */
  stop(): Promise<void>;
}

/**
 * Compose the EXPORTED substrate classes over an explicit database handle —
 * the same wiring the substrate's own barrel performs (queue with the
 * lifecycle-event emitter recording under SUBSTRATE_EVENT_OWNER; worker
 * over that queue). This is the wrap-don't-patch composition recovery
 * replays through; it adds no semantics.
 */
export function bindDurableRuntime(options: BindDurableRuntimeOptions): BoundDurableRuntime {
  const { database } = options;
  if (!database || !database.isOpen()) {
    throw new TypeError('bindDurableRuntime: requires an open DurableDatabase');
  }
  const queue = new DurableQueue(database, {
    backoffBaseMs: options.backoffBaseMs,
    backoffMaxMs: options.backoffMaxMs,
    emitEvent: (event) => {
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
  const runtime: BoundDurableRuntime = {
    database,
    queue,
    worker,
    register(kind, handler) {
      worker.register(kind, handler);
      return runtime;
    },
    enqueue(kind, payload, enqueueOptions) {
      return queue.enqueue(kind, payload, enqueueOptions);
    },
    recordEvent(type, data, owner, jobId) {
      return recordEventOnDatabase(database, type, data, owner, jobId);
    },
    async stop() {
      await worker.stop();
    },
  };
  return runtime;
}

// ---------------------------------------------------------------------------
// The drain-until-settled loop (the replay engine)
// ---------------------------------------------------------------------------

/** The pending-jobs probe (the settle condition's material — registered kinds only). */
const SQL_PENDING_ROWS =
  "SELECT kind, available_at FROM durable_jobs WHERE status IN ('queued', 'failed')";
const SQL_RESERVED_JOBS = "SELECT id FROM durable_jobs WHERE status = 'reserved'";
const SQL_EVENTS_BY_TYPE_SINCE =
  'SELECT type, COUNT(*) AS total FROM durable_events WHERE id > ? GROUP BY type';
const SQL_MAX_EVENT_ID = 'SELECT MAX(id) AS maxId FROM durable_events';

export interface DrainOptions {
  /** The bound runtime to drive (its worker + queue). */
  readonly runtime: BoundDurableRuntime;
  /** The settle sleep between passes (lets deterministic backoff windows pass). Default: 10 ms. */
  readonly settleMs?: number;
  /** The hard pass bound (fail-closed: exhaustion is REPORTED, never looped past). Default: 200. */
  readonly maxPasses?: number;
  /** The wall clock for the claimability probe. Default: Date.now. */
  readonly now?: () => number;
}

export interface DrainReport {
  readonly passes: number;
  readonly dispatched: number;
  readonly reclaimed: number;
  readonly reclaimedDeadLettered: number;
  /** Pending jobs of REGISTERED kinds still queued/failed (0 when settled). */
  readonly pendingRemaining: number;
  readonly settled: boolean;
  readonly stats: Readonly<Record<DurableJobStatus, number>>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });

/**
 * Count the pending jobs of REGISTERED kinds (queued or failed, whether or
 * not their backoff window has elapsed). Unregistered kinds (the durable
 * command jobs of un-hosted bindings — the D-2 class) are NEVER counted:
 * the worker will not reserve them, so they must not hold the drain open.
 */
function pendingRegisteredCount(runtime: BoundDurableRuntime): number {
  const registered = new Set(runtime.worker.registeredKinds());
  const rows = runtime.database.prepare(SQL_PENDING_ROWS).all() as Array<{
    kind: unknown;
  }>;
  let pending = 0;
  for (const row of rows) {
    if (!registered.has(String(row.kind))) {
      continue;
    }
    pending += 1;
  }
  return pending;
}

/**
 * Drive the worker loop until the store is settled: nothing dispatchable,
 * nothing pending of the registered kinds. Each pass: worker.tick() (which
 * first calls reclaimExpired — the lease-expiry redelivery), then a graceful
 * stop (awaiting in-flight executions), then the settle sleep (backoff
 * windows pass deterministically). The pass bound is hard: an exhausted
 * bound is REPORTED (settled: false), never looped past (fail-closed
 * against a poisoned handler).
 */
export async function drainUntilSettled(options: DrainOptions): Promise<DrainReport> {
  const { runtime } = options;
  const settleMs = options.settleMs ?? 10;
  const maxPasses = options.maxPasses ?? 200;
  const now = options.now ?? Date.now;
  let passes = 0;
  let dispatchedTotal = 0;
  let reclaimedTotal = 0;
  let deadLetteredTotal = 0;
  let pendingRemaining = 0;
  let settled = false;
  for (; passes < maxPasses; passes += 1) {
    const dispatched = await runtime.worker.tick();
    await runtime.worker.stop();
    dispatchedTotal += dispatched;
    const reclaim = runtime.queue.reclaimExpired(now());
    reclaimedTotal += reclaim.reclaimed;
    deadLetteredTotal += reclaim.deadLettered;
    if (dispatched === 0) {
      pendingRemaining = pendingRegisteredCount(runtime);
      if (pendingRemaining === 0) {
        settled = true;
        passes += 1;
        break;
      }
      // Registered-kind work is still pending (claimable now, or inside a
      // deterministic backoff window): the settle sleep carries the pass
      // forward until it becomes claimable.
      await sleep(settleMs);
    } else {
      await sleep(settleMs);
    }
  }
  if (!settled) {
    pendingRemaining = pendingRegisteredCount(runtime);
  }
  return {
    passes,
    dispatched: dispatchedTotal,
    reclaimed: reclaimedTotal,
    reclaimedDeadLettered: deadLetteredTotal,
    pendingRemaining,
    settled,
    stats: runtime.queue.stats(),
  };
}

// ---------------------------------------------------------------------------
// The recovery replay (restore + register + drain + the idempotency report)
// ---------------------------------------------------------------------------

export interface ReplayReport {
  readonly drain: DrainReport;
  /** durable_events rows recorded during the replay window, by type. */
  readonly eventsByType: Readonly<Record<string, number>>;
  /** Jobs that were reserved mid-flight at replay start (the lease-expiry redelivery candidates). */
  readonly redeliveredJobs: readonly string[];
}

export interface ReplayRestoredQueueOptions {
  /** The restored target's database handle (left OPEN for the caller). */
  readonly database: DurableDatabase;
  /** The handlers (the same registration the original run used). */
  readonly handlers: ReadonlyMap<string, DurableJobHandler>;
  /** The worker identity for the replayed runtime. Default: dep007-replay-worker. */
  readonly workerId?: string;
  /** The lease duration for the replayed worker. Default: 40 ms (drill-scale). */
  readonly leaseMs?: number;
  /** The settle sleep between drain passes. Default: 10 ms. */
  readonly settleMs?: number;
  /** The hard pass bound. Default: 200. */
  readonly maxPasses?: number;
  /** The wall clock for claimability probes. Default: Date.now. */
  readonly now?: () => number;
  /** The audit port for the recovery.replay.completed event. Optional. */
  readonly audit?: RecoveryAuditPort;
}

/**
 * Replay a restored store through the EXISTING worker/queue API:
 * bindDurableRuntime (the exported classes) → register the provided
 * handlers → drainUntilSettled → the report. The restored handle is
 * returned OPEN for the caller's assertions (never closed here — the
 * caller owns the lifetime).
 */
export async function replayRestoredQueue(
  options: ReplayRestoredQueueOptions,
): Promise<ReplayReport & { runtime: BoundDurableRuntime }> {
  const runtime = bindDurableRuntime({
    database: options.database,
    workerId: options.workerId ?? 'dep007-replay-worker',
    concurrency: 1,
    leaseMs: options.leaseMs ?? 40,
    backoffBaseMs: 10,
    backoffMaxMs: 50,
  });
  for (const [kind, handler] of options.handlers) {
    runtime.register(kind, handler);
  }
  // Jobs reserved mid-flight at replay start (the crash redeliveries the
  // lease-expiry path will requeue) + the event-id watermark (the replay
  // window's receipt).
  const reservedBefore = options.database
    .prepare(SQL_RESERVED_JOBS)
    .all() as Array<{ id: unknown }>;
  const redeliveredJobs = reservedBefore.map((row) => String(row.id));
  const watermark = Number(
    (options.database.prepare(SQL_MAX_EVENT_ID).get() as Record<string, unknown>)?.maxId ?? 0,
  );

  const drain = await drainUntilSettled({
    runtime,
    settleMs: options.settleMs,
    maxPasses: options.maxPasses,
    now: options.now,
  });

  // The event-type rollup over the replay window (ids strictly above the
  // pre-replay watermark — exactly what the replay itself recorded).
  const eventsByType: Record<string, number> = {};
  for (const event of options.database
    .prepare(SQL_EVENTS_BY_TYPE_SINCE)
    .all(watermark) as Array<{ type: unknown; total: unknown }>) {
    eventsByType[String(event.type)] = Number(event.total) || 0;
  }

  options.audit?.recordEvent(
    RECOVERY_EVENT_TYPES.replayCompleted,
    {
      passes: drain.passes,
      dispatched: drain.dispatched,
      reclaimed: drain.reclaimed,
      reclaimedDeadLettered: drain.reclaimedDeadLettered,
      settled: drain.settled,
      stats: drain.stats,
      redeliveredJobs: redeliveredJobs.length,
    },
    RECOVERY_EVENT_OWNER,
    null,
  );
  return { drain, eventsByType, redeliveredJobs, runtime };
}
