/**
 * RTN-011 — The recurring scheduler wiring (bun suite): timing-driven
 * COMMAND EMISSION ONLY.
 *
 * The wiring is exercised over the REAL substrate scheduler module
 * (src/lib/durable/scheduler.ts — type-only imports, bun-loadable) with
 * an in-memory queue double that mirrors the substrate's enqueue dedupe
 * contract; the emission-only discipline is proven BOTH behaviorally
 * (tickOnce enqueues a command envelope; nothing else happens) and
 * structurally (a source scan: the wiring module imports NO authority
 * module — the scheduler boundary's "no state mutation" is
 * unrepresentable in the module).
 *
 * Tested contracts (spec-cited):
 *   spec/deployment/topology.md lines 156-157: "Authority hosted: none —
 *   emits timing-driven commands into the durable command queue; owns
 *   timing only, never mutates authoritative state and never reaches
 *   external rails."; line 217: "Scheduler boundary. `scheduler` emits
 *   timing-driven commands into the durable queue. It owns timing, not
 *   semantics: no state mutation, no rail access, no protocol decisions."
 *   spec/durable/execution.md §10 (tick identity; at-most-one job per
 *   tick; stable scheduleId; distinct scheduleIds).
 *   RTN-011.md line 24: "Recurring-tick jobs emit commands only (no
 *   direct state mutation from scheduler callbacks)."
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scheduleRecurring } from '../../durable/scheduler.ts';
import { validateCommandEnvelope } from '../kernel/envelope.ts';
import {
  RECURRING_COMMAND_SCHEDULES,
  tickCommandEnvelope,
  tickWindowFor,
  wireRecurringCommandEmitters,
} from './scheduler-wiring.ts';
import type { RecurringCommandScheduleConfig } from './scheduler-wiring.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

interface CapturedJob {
  readonly kind: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
}

/**
 * An in-memory queue double mirroring the substrate's enqueue dedupe
 * contract (execution.md §6: UNIQUE (idempotency_key, kind), the second
 * call reports created:false with the existing job).
 */
function makeQueueDouble() {
  const jobs: CapturedJob[] = [];
  const seen = new Set<string>();
  return {
    jobs,
    enqueue(kind: string, payload: unknown, options: { idempotencyKey?: string | null } = {}) {
      const key = options.idempotencyKey ?? null;
      if (key !== null && seen.has(`${kind}\u0000${key}`)) {
        return { created: false, reason: 'deduplicated' as const, job: jobs.find((job) => job.kind === kind && job.idempotencyKey === key) };
      }
      const job: CapturedJob = { kind, payload, idempotencyKey: key ?? '' };
      jobs.push(job);
      if (key !== null) {
        seen.add(`${kind}\u0000${key}`);
      }
      return { created: true, reason: 'enqueued' as const, job };
    },
  };
}

function wiringHarness(configs: readonly RecurringCommandScheduleConfig[]) {
  const queue = makeQueueDouble();
  const schedulerPort = {
    scheduleRecurring: (
      kind: string,
      payloadFn: (tick: number) => unknown,
      intervalMs: number,
      options?: { scheduleId?: string; maxAttempts?: number; startImmediately?: boolean },
    ) => scheduleRecurring(queue as never, kind, payloadFn, intervalMs, options as never),
  };
  const wired = wireRecurringCommandEmitters(schedulerPort as never, configs);
  return { queue, wired };
}

describe('scheduler wiring: tick command envelopes are deterministic', () => {
  test('the envelope derives wholly from the tick identity (key, time, window body)', () => {
    const config = RECURRING_COMMAND_SCHEDULES[0] as RecurringCommandScheduleConfig;
    const first = tickCommandEnvelope(config, 42);
    const second = tickCommandEnvelope(config, 42);
    expect(first).toEqual(second);
    expect(first.kind).toBe('clearing.batch.tick');
    expect(first.authority).toBe('Clearing Authority');
    expect(first.subjectIds).toEqual([]);
    expect(first.idempotencyKey).toBe('clearing-batch-tick:t42');
    expect(first.protocolTime.sequence).toBe(42);
    expect(first.protocolTime.wallMs).toBe(42 * config.intervalMs);
    const body = first.body as Record<string, unknown>;
    expect(body.batchLabel).toBe('clearing-window-42');
    expect(body.windowStartWallMs).toBe(42 * config.intervalMs);
    expect(body.windowEndWallMs).toBe(43 * config.intervalMs);
    // A distinct tick derives a distinct command.
    const other = tickCommandEnvelope(config, 43);
    expect(other.idempotencyKey).toBe('clearing-batch-tick:t43');
    expect((other.body as Record<string, unknown>).batchLabel).toBe('clearing-window-43');
  });

  test('the window derivation and the canonical four schedules', () => {
    const window = tickWindowFor(3, 1000);
    expect(window.windowStartWallMs).toBe(3000);
    expect(window.windowEndWallMs).toBe(4000);
    expect(() => tickWindowFor(-1, 1000)).toThrow();
    expect(() => tickWindowFor(1, 0)).toThrow();
    const kinds = RECURRING_COMMAND_SCHEDULES.map((config) => config.kind);
    expect(kinds).toEqual([
      'clearing.batch.tick',
      'netting.set.tick',
      'reconciliation.cycle.tick',
      'queues.eligibility.tick',
    ]);
    const scheduleIds = RECURRING_COMMAND_SCHEDULES.map((config) => config.scheduleId);
    expect(new Set(scheduleIds).size).toBe(4);
  });
});

describe('scheduler wiring: timing-driven command emission ONLY', () => {
  test('tickOnce enqueues exactly one valid command envelope and touches nothing else', () => {
    const { queue, wired } = wiringHarness([
      { ...(RECURRING_COMMAND_SCHEDULES[0] as RecurringCommandScheduleConfig), intervalMs: 60_000 },
    ]);
    const cleared = wired[0]?.tickOnce();
    expect(cleared?.created).toBe(true);
    expect(queue.jobs.length).toBe(1);
    const job = queue.jobs[0] as CapturedJob;
    // The emitted payload IS a kernel command envelope (validated).
    const validation = validateCommandEnvelope(job.payload, {
      allowedAuthorities: ['Clearing Authority'],
    });
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.envelope.kind).toBe('clearing.batch.tick');
      expect(validation.envelope.idempotencyKey).toBe(job.idempotencyKey);
    }
    // The queue double received ONLY the enqueue call — no handler
    // execution, no authority interaction (the wiring holds no authority).
  });

  test('the same tick never emits twice; a distinct tick emits a new command', async () => {
    const { queue, wired } = wiringHarness([
      { ...(RECURRING_COMMAND_SCHEDULES[3] as RecurringCommandScheduleConfig), intervalMs: 5 },
    ]);
    const first = wired[0]?.tickOnce();
    expect(first?.created).toBe(true);
    // Re-firing within the same tick identity: the lastTick guard returns
    // null — no duplicate emission.
    const sameTick = wired[0]?.tickOnce();
    expect(sameTick).toBeNull();
    // After the interval elapses (real wall clock), the next tick identity
    // emits a NEW command with a NEW per-tick key.
    await new Promise((resolve) => setTimeout(resolve, 8));
    const next = wired[0]?.tickOnce();
    expect(next?.created).toBe(true);
    expect(queue.jobs.length).toBe(2);
    expect(queue.jobs[1]?.idempotencyKey === queue.jobs[0]?.idempotencyKey).toBe(false);
  });

  test('the queue-level per-tick dedupe collapses a re-attempt (execution.md §10)', () => {
    const { queue, wired } = wiringHarness([
      { ...(RECURRING_COMMAND_SCHEDULES[0] as RecurringCommandScheduleConfig), intervalMs: 60_000 },
    ]);
    wired[0]?.tickOnce();
    // A simulated restart re-attempt of the SAME tick identity: the
    // scheduler's enqueue key dedupes at the queue (UNIQUE (kind, key)).
    const reattempt = queue.enqueue('clearing.batch.tick', tickCommandEnvelope(RECURRING_COMMAND_SCHEDULES[0] as RecurringCommandScheduleConfig, Math.floor(Date.now() / 60_000)), { idempotencyKey: (queue.jobs[0] as CapturedJob).idempotencyKey });
    expect(reattempt.created).toBe(false);
    expect(queue.jobs.length).toBe(1);
  });

  test('a shared scheduleId is rejected (distinct identities are mandatory)', () => {
    const config = RECURRING_COMMAND_SCHEDULES[0] as RecurringCommandScheduleConfig;
    expect(() => wiringHarness([config, { ...config, kind: 'other.tick' }])).toThrow(/scheduleId/);
  });

  test('stop() halts emission', () => {
    const { queue, wired } = wiringHarness([
      { ...(RECURRING_COMMAND_SCHEDULES[0] as RecurringCommandScheduleConfig), intervalMs: 60_000 },
    ]);
    wired[0]?.tickOnce();
    wired[0]?.stop();
    // After stop, tickOnce still returns null (running=false short-circuits).
    expect(wired[0]?.tickOnce()).toBeNull();
    expect(queue.jobs.length).toBe(1);
  });
});

describe('scheduler wiring: the structural no-mutation boundary (source scan)', () => {
  test('the wiring module imports no authority module — timing only', () => {
    const source = readFileSync(join(HERE, 'scheduler-wiring.ts'), 'utf8');
    const specifiers = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1] ?? '');
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      // The wiring may import only the kernel and the substrate scheduler.
      const isKernel = specifier.startsWith('../kernel/');
      const isSubstrateScheduler = specifier === '../../durable/scheduler.ts';
      expect(isKernel || isSubstrateScheduler).toBe(true);
    }
  });
});
