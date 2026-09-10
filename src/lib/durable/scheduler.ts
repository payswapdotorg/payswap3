/**
 * DEP-003 — Deterministic recurring scheduler.
 *
 * Tick identity is derived deterministically from wall-clock time:
 *   tick = floor(now / intervalMs)
 * and every tick enqueues AT MOST ONE job, keyed by the idempotency key
 * (scheduleId + tick identity) under the queue's UNIQUE (kind,
 * idempotency_key) constraint. A duplicate enqueue is a no-op, so a
 * scheduler that re-runs after a restart (or two schedules racing on the
 * same tick) can NEVER enqueue duplicate financial work: the tick either
 * has exactly one job or none.
 *
 * Semantics (conservative by design):
 *   - at-most-once per tick identity — never more than one job per tick;
 *   - ticks missed while the process was down are NOT backfilled (the
 *     no-duplicate guarantee takes priority over catch-up);
 *   - a schedule's identity must be STABLE across restarts, so the default
 *     scheduleId is the constant 'default'. Two schedules of the same kind
 *     MUST use distinct scheduleIds, otherwise they intentionally share a
 *     tick identity and only one job per tick is enqueued.
 *
 * Runtime note: only type-only imports from sibling modules (erased at
 * load time); the queue is injected explicitly.
 */
import type { DurableQueue, EnqueueOptions, EnqueueResult } from './queue';

export type TickPayloadFn = (tick: number) => unknown;

export interface TickEnqueueOptions {
  /** Stable schedule identity included in the idempotency key. Default: 'default'. */
  scheduleId?: string;
  /** Custom tick identity renderer. Default: (tick) => `t${tick}`. */
  tickIdFn?: (tick: number) => string;
  maxAttempts?: number;
}

export interface RecurringScheduleOptions extends TickEnqueueOptions {
  /** Injectable clock (tests). Default: Date.now. */
  now?: () => number;
  /** Fire once immediately when started. Default: false. */
  startImmediately?: boolean;
  onEnqueue?: (result: EnqueueResult, tick: number) => void;
  onError?: (error: unknown, tick: number) => void;
}

export interface RecurringSchedule {
  readonly kind: string;
  readonly intervalMs: number;
  readonly scheduleId: string;
  start(): RecurringSchedule;
  stop(): RecurringSchedule;
  /** Fire once on demand using the current tick identity (dedupe applies). */
  tickOnce(): EnqueueResult | null;
}

/** Deterministic tick index for a point in time. */
export function computeTick(nowMs: number, intervalMs: number): number {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError('computeTick: intervalMs must be a positive number');
  }
  return Math.floor(nowMs / intervalMs);
}

/** The per-tick idempotency key: stable, deterministic, restart-safe. */
export function tickIdempotencyKey(tick: number, options: TickEnqueueOptions = {}): string {
  const scheduleId = options.scheduleId ?? 'default';
  const tickId = options.tickIdFn ? options.tickIdFn(tick) : `t${tick}`;
  return `${scheduleId}:${tickId}`;
}

/**
 * Core deterministic action: enqueue the job for one tick identity.
 * Calling this twice with the same tick (across processes, restarts, or
 * concurrent schedulers) results in exactly one durable_jobs row.
 */
export function enqueueTick(
  queue: DurableQueue,
  kind: string,
  payloadFn: TickPayloadFn,
  tick: number,
  options: TickEnqueueOptions = {},
): EnqueueResult {
  const idempotencyKey = tickIdempotencyKey(tick, options);
  const payload = payloadFn(tick);
  const enqueueOptions: EnqueueOptions = {
    idempotencyKey,
    maxAttempts: options.maxAttempts,
  };
  return queue.enqueue(kind, payload, enqueueOptions);
}

/**
 * scheduleRecurring(queue, kind, payloadFn, intervalMs, options) — start a
 * recurring schedule. On every interval the current tick identity is
 * computed and enqueueTick() is called (duplicate ticks are no-ops).
 */
export function scheduleRecurring(
  queue: DurableQueue,
  kind: string,
  payloadFn: TickPayloadFn,
  intervalMs: number,
  options: RecurringScheduleOptions = {},
): RecurringSchedule {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError('scheduleRecurring: intervalMs must be a positive number');
  }
  const scheduleId = options.scheduleId ?? 'default';
  const now = options.now ?? Date.now;
  const onEnqueue = options.onEnqueue ?? (() => {});
  const onError =
    options.onError ??
    ((error: unknown, tick: number) => {
      process.stderr.write(`[durable-scheduler] tick ${tick} failed: ${String(error)}\n`);
    });
  const tickIdFn = options.tickIdFn;
  const maxAttempts = options.maxAttempts;

  let lastTick: number | null = null;
  let timer: unknown = null;
  let running = false;

  const fire = (): EnqueueResult | null => {
    const tick = computeTick(now(), intervalMs);
    if (lastTick !== null && tick === lastTick) {
      return null;
    }
    lastTick = tick;
    try {
      const result = enqueueTick(queue, kind, payloadFn, tick, { scheduleId, tickIdFn, maxAttempts });
      onEnqueue(result, tick);
      return result;
    } catch (error) {
      onError(error, tick);
      return null;
    }
  };

  const schedule: RecurringSchedule = {
    kind,
    intervalMs,
    scheduleId,
    start(): RecurringSchedule {
      if (running) {
        return schedule;
      }
      running = true;
      if (options.startImmediately === true) {
        fire();
      }
      const interval: unknown = setInterval(() => {
        fire();
      }, intervalMs);
      if (
        interval &&
        typeof interval === 'object' &&
        typeof (interval as { unref?: () => void }).unref === 'function'
      ) {
        (interval as { unref: () => void }).unref();
      }
      timer = interval;
      return schedule;
    },
    stop(): RecurringSchedule {
      running = false;
      if (timer !== null) {
        clearInterval(timer as Parameters<typeof clearInterval>[0]);
        timer = null;
      }
      return schedule;
    },
    tickOnce(): EnqueueResult | null {
      return fire();
    },
  };
  return schedule;
}
