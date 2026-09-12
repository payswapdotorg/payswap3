/**
 * RTN-011 — Authority hosting: the recurring scheduler wiring.
 *
 * The scheduler wiring pattern for recurring protocol ticks — clearing
 * batches, netting cycles, reconciliation cycles, and queue eligibility
 * scans — using the substrate's scheduleRecurring, per the scheduler
 * boundary:
 *
 *   spec/deployment/topology.md, scheduler, lines 156-157:
 *     "Authority hosted: none — emits timing-driven commands into the
 *      durable command queue; owns timing only, never mutates
 *      authoritative state and never reaches external rails."
 *   spec/deployment/topology.md, Component boundaries, line 217:
 *     "Scheduler boundary. `scheduler` emits timing-driven commands into
 *      the durable queue. It owns timing, not semantics: no state
 *      mutation, no rail access, no protocol decisions."
 *
 * TIMING-DRIVEN COMMAND EMISSION ONLY: this module constructs command
 * ENVELOPES from tick identities and hands them to the substrate's
 * scheduleRecurring (which enqueues through the public queue with the
 * per-tick idempotency key). It imports NO authority module and holds NO
 * authority reference — the structural impossibility of state mutation
 * here is asserted by hosting/boundary-review.test.ts (source scan).
 * The emitted tick commands are executed like any other command, through
 * the transition path's registered handlers (the bindings in
 * hosting/bindings.ts).
 *
 * Determinism (spec/durable/execution.md §10, lines 192-208):
 *   - tick identity is floor(now / intervalMs); the per-tick idempotency
 *     key is scheduleId + ':' + tickId — at most one job per tick
 *     identity, so a restarted scheduler can never enqueue duplicate
 *     financial work;
 *   - the tick command's idempotencyKey IS the per-tick key (the kernel
 *     envelope's 1:1 mapping onto the enqueue contract), and its subject
 *     window derives deterministically from the tick identity
 *     (window = [tick·interval, (tick+1)·interval) in wall-clock ms), so
 *     the same tick always produces the same command body — the command
 *     consumers (e.g. the reconciliation cycle id derivation from
 *     (windowStart, windowEnd, ruleVersion)) are idempotent per window.
 *
 * Spec sources (binding): spec/deployment/topology.md lines 152-158 +
 * line 217 (the scheduler boundary); spec/durable/execution.md §10
 * (scheduler determinism) and §13 (the scheduleRecurring integration
 * guide); RTN-011.md line 18 ("Scheduler wiring pattern for recurring
 * ticks (clearing batches, netting cycles, reconciliation cycles, queue
 * eligibility scans) using scheduleRecurring — timing-driven command
 * emission only"); RTN-011.md line 24 ("Recurring-tick jobs emit commands
 * only (no direct state mutation from scheduler callbacks)").
 */

import { protocolTime } from '../kernel/time.ts';
import type { CommandEnvelope, CommandKind, ProtocolAuthorityId } from '../kernel/envelope.ts';
import { tickIdempotencyKey } from '../../durable/scheduler.ts';

/**
 * The scheduler substrate port: the public scheduleRecurring surface
 * (structural — the real DEP-003 runtime satisfies it; the bun test
 * double implements it in-memory). The wiring holds NOTHING but this:
 * enqueueing ticks is the only capability it needs or gets.
 *
 * Source: spec/durable/execution.md §10/§13 (scheduleRecurring; "A
 * schedule's identity must be STABLE across restarts"); the scheduler
 * boundary (topology.md line 217 — "It owns timing, not semantics").
 */
export interface SchedulerSubstratePort {
  scheduleRecurring(
    kind: string,
    payloadFn: (tick: number) => unknown,
    intervalMs: number,
    options?: {
      readonly scheduleId?: string;
      readonly maxAttempts?: number;
      readonly startImmediately?: boolean;
    },
  ): {
    stop(): unknown;
    tickOnce(): { readonly created: boolean } | null;
  };
}

/**
 * One tick's deterministic window in wall-clock milliseconds:
 * [tick·intervalMs, (tick+1)·intervalMs). The window — not the wall clock
 * reading — is the tick command's subject identity, so command consumers
 * derive identical subjects for the same tick across restarts.
 *
 * Source: spec/durable/execution.md §10 lines 194-196 ("Tick identity is
 * derived from wall-clock time: tick = floor(now / intervalMs)").
 */
export interface TickWindow {
  readonly tick: number;
  readonly intervalMs: number;
  readonly windowStartWallMs: number;
  readonly windowEndWallMs: number;
}

/**
 * One recurring command schedule's configuration: the command kind, the
 * owning authority that will execute it, the STABLE schedule identity,
 * the cadence, and the body builder (configuration — "schedules are
 * configuration", topology.md line 158).
 *
 * Source: spec/deployment/topology.md lines 152-158 (the scheduler
 * component contract); RTN-011.md line 18 (the four named recurring
 * ticks).
 */
export interface RecurringCommandScheduleConfig {
  readonly kind: CommandKind;
  readonly authority: ProtocolAuthorityId;
  /** Stable across restarts; distinct per schedule (execution.md §10). */
  readonly scheduleId: string;
  readonly intervalMs: number;
  /** Builds the tick command's JSON-safe body from the tick window. */
  readonly bodyForTick: (window: TickWindow) => Readonly<Record<string, unknown>>;
}

const CANONICAL_SCHEDULES: readonly RecurringCommandScheduleConfig[] = Object.freeze([
  {
    kind: 'clearing.batch.tick',
    authority: 'Clearing Authority',
    scheduleId: 'clearing-batch-tick',
    intervalMs: 60_000,
    bodyForTick: (window) => ({
      batchLabel: `clearing-window-${window.tick}`,
      windowStartWallMs: window.windowStartWallMs,
      windowEndWallMs: window.windowEndWallMs,
    }),
  },
  {
    kind: 'netting.set.tick',
    authority: 'Netting Authority',
    scheduleId: 'netting-cycle-tick',
    intervalMs: 300_000,
    bodyForTick: (window) => ({
      label: `netting-window-${window.tick}`,
      windowStartWallMs: window.windowStartWallMs,
      windowEndWallMs: window.windowEndWallMs,
      scope: { kind: 'MULTILATERAL', participants: [] },
      inputObligationIds: [],
    }),
  },
  {
    kind: 'reconciliation.cycle.tick',
    authority: 'Reconciliation Authority',
    scheduleId: 'reconciliation-cycle-tick',
    intervalMs: 300_000,
    bodyForTick: (window) => ({
      windowStartWallMs: window.windowStartWallMs,
      windowEndWallMs: window.windowEndWallMs,
      ruleVersion: 1,
      sourceIds: [],
    }),
  },
  {
    kind: 'queues.eligibility.tick',
    authority: 'Queue Authority',
    scheduleId: 'queue-eligibility-tick',
    intervalMs: 30_000,
    bodyForTick: (window) => ({
      windowStartWallMs: window.windowStartWallMs,
      windowEndWallMs: window.windowEndWallMs,
      scans: [],
    }),
  },
]);

/**
 * The canonical recurring protocol ticks (RTN-011.md line 18 — "clearing
 * batches, netting cycles, reconciliation cycles, queue eligibility
 * scans"). Each emits exactly one command kind through the substrate's
 * per-tick idempotency key; the handlers are the hosted bindings
 * (clearing.batch.tick, netting.set.tick, reconciliation.cycle.tick,
 * queues.eligibility.tick).
 *
 * The interval defaults are configuration starting points (the deployment
 * binds real cadences — topology.md line 158: "schedules are
 * configuration, so no data recovery is involved").
 *
 * Source: RTN-011.md line 18; the four areas' recurring semantics
 * (clearing batches — clearing-netting-settlement.md Area 9; netting
 * cycles — Area 11; reconciliation cycles — rails-adapters-
 * reconciliation.md Area 14; queue eligibility scans — liquidity-credit-
 * queues.md Area 8).
 */
export const RECURRING_COMMAND_SCHEDULES: readonly RecurringCommandScheduleConfig[] = CANONICAL_SCHEDULES;

/**
 * The deterministic tick window for a tick identity and cadence.
 *
 * Source: spec/durable/execution.md §10 lines 194-196 (tick identity
 * derivation).
 */
export function tickWindowFor(tick: number, intervalMs: number): TickWindow {
  if (!Number.isInteger(tick) || tick < 0) {
    throw new RangeError('tickWindowFor: tick must be a non-negative integer');
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError('tickWindowFor: intervalMs must be a positive number');
  }
  return {
    tick,
    intervalMs,
    windowStartWallMs: tick * intervalMs,
    windowEndWallMs: (tick + 1) * intervalMs,
  };
}

/**
 * Build the tick command's envelope for one tick identity: the full
 * kernel CommandEnvelope whose idempotencyKey is the substrate scheduler's
 * own per-tick key (scheduleId + ':' + tickId) — the kernel envelope's
 * 1:1 mapping onto the enqueue contract keeps the command's dedupe
 * identity and the scheduler job's dedupe identity the same — and whose
 * protocolTime sequences the command by its tick identity with the
 * deterministic window start as wall time. subjectIds are empty: a
 * scheduler tick command addresses no prior subject object (the kernel
 * envelope contract allows the empty list for exactly this case).
 *
 * Source: kernel envelope.ts (CommandEnvelope.subjectIds doc — "may be
 * empty: e.g. scheduler tick commands address no prior subject object";
 * the 1:1 enqueue mapping); spec/durable/execution.md §10 (the per-tick
 * idempotency key).
 */
export function tickCommandEnvelope(
  config: RecurringCommandScheduleConfig,
  tick: number,
): CommandEnvelope {
  const window = tickWindowFor(tick, config.intervalMs);
  return {
    kind: config.kind,
    authority: config.authority,
    subjectIds: [],
    idempotencyKey: tickIdempotencyKey(tick, { scheduleId: config.scheduleId }),
    protocolTime: protocolTime(tick, window.windowStartWallMs),
    body: config.bodyForTick(window),
  };
}

/** One wired recurring command schedule (stop/tickOnce control). */
export interface WiredRecurringCommandSchedule {
  readonly config: RecurringCommandScheduleConfig;
  /** Fire once on demand using the CURRENT tick identity (dedupe applies). */
  tickOnce(): { readonly created: boolean } | null;
  stop(): void;
}

/**
 * Wire the recurring command emitters: one scheduleRecurring per config,
 * whose payloadFn builds the tick command envelope deterministically from
 * the tick identity. Emission only — the payloadFn constructs an
 * envelope; it cannot touch any authority (and the module imports none).
 *
 * The `now` parameter lets the caller read the clock at payload-build
 * time only for diagnostic fields — the command's subject identity is
 * the deterministic window, never the live clock reading.
 *
 * Source: RTN-011.md lines 18, 24; spec/durable/execution.md §10/§13
 * (scheduleRecurring(kind, payloadFn, intervalMs, { scheduleId })).
 */
export function wireRecurringCommandEmitters(
  substrate: SchedulerSubstratePort,
  configs: readonly RecurringCommandScheduleConfig[] = RECURRING_COMMAND_SCHEDULES,
): readonly WiredRecurringCommandSchedule[] {
  const scheduleIds = new Set<string>();
  for (const config of configs) {
    if (scheduleIds.has(config.scheduleId)) {
      throw new TypeError(
        `wireRecurringCommandEmitters: scheduleId ${config.scheduleId} is shared by two schedules ` +
          '(two schedules of the same kind MUST use distinct scheduleIds — execution.md §10)',
      );
    }
    scheduleIds.add(config.scheduleId);
  }
  return configs.map((config) => {
    const schedule = substrate.scheduleRecurring(
      config.kind,
      (tick: number) => tickCommandEnvelope(config, tick),
      config.intervalMs,
      { scheduleId: config.scheduleId },
    );
    return {
      config,
      tickOnce: () => schedule.tickOnce(),
      stop: () => {
        schedule.stop();
      },
    };
  });
}
