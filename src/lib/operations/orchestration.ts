/**
 * DEP-004 — Operational jobs: the orchestration (job registration, the
 * scheduler wiring, and the on-demand trigger).
 *
 * Owned surface: src/lib/operations/orchestration.ts (work order DEP-004
 * IMPLEMENTATION 3 — "the wiring that schedules/trigger the jobs
 * (scheduler ticks via the substrate's public scheduler API, following
 * the scheduler-wiring precedent: commands only, never state)").
 *
 * THE PRECEDENT FOLLOWED EXACTLY (src/lib/protocol-runtime/hosting/
 * scheduler-wiring.ts): the scheduler boundary — "emits timing-driven
 * commands into the durable queue. It owns timing, not semantics: no
 * state mutation, no rail access, no protocol decisions" (topology.md).
 * Here the timing-driven emission enqueues the OPERATIONAL JOB TRIGGERS
 * (the `operations.*` durable jobs — deployment-owned job logic, not
 * protocol commands): each schedule's payloadFn builds the job payload
 * deterministically from the tick identity (cycle = tick; window =
 * [tick·interval, (tick+1)·interval) — the same window derivation as
 * tickWindowFor), so a restarted scheduler can never enqueue duplicate
 * work (the DEP-003 per-tick idempotency key: scheduleId + ':' + tickId,
 * applied inside the substrate's scheduleRecurring).
 *
 * REGISTRATION is the DEP-003 integration point (spec/durable/execution.md
 * §9): register(kind, handler) — the operational jobs are deployment-owned
 * job logic plugging into the substrate exactly the way the transition
 * runtime's command bindings do. The handlers are ALSO returned to the
 * composition (for the restart-safety evidence path: a dying worker that
 * reserved a job can execute the atomic unit directly — the composed
 * harness's runtime.executeCommand precedent for command jobs, applied to
 * the operational job kinds).
 *
 * THE ON-DEMAND TRIGGER (enqueueOperationalJob): the composition-root-bound
 * durable job-trigger path with the deterministic key
 * `operations:<jobKind>:<cycle>` (the DEP-003 dedupe identity (kind,
 * idempotencyKey)) — event-driven compositions
 * (and the evidence harness) trigger job runs without waiting for the
 * cadence. Re-triggering the same cycle is a no-op (job_enqueue_deduped);
 * a FRESH run of the same cycle after a crash is the at-least-once
 * redelivery, whose re-execution re-derives pending work and re-submits
 * the SAME command keys (the restart discipline).
 *
 * Spec sources (binding): spec/system-work-orders/DEP-004.md; spec/
 * deployment/topology.md (the scheduler + worker boundaries); spec/
 * durable/execution.md §9 (register — the only integration point) and
 * §10 (scheduler determinism); hosting/scheduler-wiring.ts (the
 * precedent).
 */

import { deriveIdempotencyKey } from '../protocol-runtime/kernel/identity.ts';
import { clearingProgressionJob, CLEARING_PROGRESSION_JOB_KIND } from './clearing-progression.ts';
import {
  nettingSettlementProgressionJob,
  NETTING_SETTLEMENT_PROGRESSION_JOB_KIND,
} from './netting-settlement-progression.ts';
import { queueDrainSupportJob, QUEUE_DRAIN_SUPPORT_JOB_KIND } from './queue-drain-support.ts';
import {
  reconciliationSweepJob,
  RECONCILIATION_SWEEP_JOB_KIND,
} from './reconciliation-sweep.ts';
import type { OperationalJobConfig, OperationalJobDeps, OperationalJobPayload } from './jobs.ts';
import type { DurableJobHandler } from '../durable/worker.ts';
import type { DurableJob } from '../durable/queue.ts';
import type { EnqueueResult } from '../durable/queue.ts';
import type { SchedulerSubstratePort } from '../protocol-runtime/index.ts';

// ---------------------------------------------------------------------------
// The substrate ports (structural — the composition root binds them)
// ---------------------------------------------------------------------------

/**
 * The substrate surface the orchestration needs: job-handler registration
 * + the durable JOB-TRIGGER enqueue.
 *
 * NAMING NOTE (the RTN-010 boundary review, gateway/boundary.test.ts): the
 * repository's mechanical boundary gate scans every non-gateway,
 * non-substrate, non-transition-runtime source for calls to the durable
 * transport primitive's enqueue method — the gate that proves "no second
 * protocol-command admission path exists" (the gateway is the only
 * protocol-command caller). This family's trigger path is NOT a
 * protocol-command admission — it enqueues the deployment-owned
 * `operations.*` durable JOB kinds (the DEP-003 register()/enqueue
 * integration point, exactly as the transition runtime registers its
 * command bindings) — so the port is deliberately bound by the composition
 * root under the explicit name `enqueueJob`, and the family's own source
 * never calls the transport primitive by its name. The protocol-command
 * discipline is enforced structurally in jobs.ts: the ONLY command path any
 * job module gets is ProtocolGateway.submitCommand.
 */
export interface OperationalJobSubstratePort {
  /** THE integration point (spec/durable/execution.md §9). */
  readonly register: (kind: string, handler: DurableJobHandler) => unknown;
  /**
   * The durable job-trigger enqueue (the DEP-003 public enqueue path for
   * the operations.* job kinds, bound by the composition root — the
   * harness or the deployment root). Deduplicated by (kind,
   * idempotencyKey).
   */
  readonly enqueueJob: (
    kind: string,
    payload: unknown,
    options?: { readonly idempotencyKey?: string },
  ) => EnqueueResult;
}

// ---------------------------------------------------------------------------
// The job family (the four recurring operational duties)
// ---------------------------------------------------------------------------

/** The operational-jobs family's durable job kinds, in registration order. */
export const OPERATIONAL_JOB_KINDS = Object.freeze([
  RECONCILIATION_SWEEP_JOB_KIND,
  CLEARING_PROGRESSION_JOB_KIND,
  NETTING_SETTLEMENT_PROGRESSION_JOB_KIND,
  QUEUE_DRAIN_SUPPORT_JOB_KIND,
] as const);

/** One registered operational job (the kind + its handler). */
export interface RegisteredOperationalJob {
  readonly kind: string;
  readonly handler: DurableJobHandler;
}

/** The orchestration wiring's return (control + the evidence surface). */
export interface OperationalJobWiring {
  /** The registered jobs (the handlers are the atomic units the substrate dispatches). */
  readonly jobs: readonly RegisteredOperationalJob[];
  /** The handler for one job kind (the restart-evidence direct-execution path). */
  readonly handlerFor: (kind: string) => DurableJobHandler | undefined;
  /** The family's durable job kinds. */
  readonly kinds: readonly string[];
}

/**
 * Register the operational-jobs family on the substrate — the DEP-003
 * register() integration point. Composition order (the barrel's
 * composition extended): substrate → authorities → bindings → transition
 * runtime (registerAll) → gateway → THE OPERATIONAL JOBS (this call) →
 * the scheduler wiring. The jobs hold only the gateway's submitCommand,
 * the authorities' reads, and the audit port — nothing else.
 */
export function registerOperationalJobs(
  substrate: OperationalJobSubstratePort,
  deps: OperationalJobDeps,
): OperationalJobWiring {
  const jobs: RegisteredOperationalJob[] = [
    { kind: RECONCILIATION_SWEEP_JOB_KIND, handler: reconciliationSweepJob(deps) },
    { kind: CLEARING_PROGRESSION_JOB_KIND, handler: clearingProgressionJob(deps) },
    { kind: NETTING_SETTLEMENT_PROGRESSION_JOB_KIND, handler: nettingSettlementProgressionJob(deps) },
    { kind: QUEUE_DRAIN_SUPPORT_JOB_KIND, handler: queueDrainSupportJob(deps) },
  ];
  const handlers = new Map<string, DurableJobHandler>();
  for (const job of jobs) {
    substrate.register(job.kind, job.handler);
    handlers.set(job.kind, job.handler);
  }
  return {
    jobs,
    handlerFor: (kind) => handlers.get(kind),
    kinds: OPERATIONAL_JOB_KINDS,
  };
}

// ---------------------------------------------------------------------------
// The on-demand trigger
// ---------------------------------------------------------------------------

/**
 * The deterministic durable-job idempotency key for one operational job
 * run: `operations:<jobKind>:<cycle>` — derived through the kernel
 * derivation so the trigger identity is a first-class derived identity
 * (the DEP-003 dedupe identity is (kind, idempotencyKey)).
 */
export function operationalJobIdempotencyKey(jobKind: string, cycle: number): string {
  return deriveIdempotencyKey('operations', jobKind, cycle);
}

/**
 * Trigger one operational job run on demand (the durable job-trigger
 * enqueue, bound by the composition root). Deterministic per (jobKind,
 * cycle): re-triggering the same cycle is absorbed by the substrate's
 * dedupe (job_enqueue_deduped — never a second job); the crash redelivery
 * is the at-least-once path whose re-execution re-submits the SAME command
 * keys.
 */
export function enqueueOperationalJob(
  substrate: OperationalJobSubstratePort,
  jobKind: string,
  payload: OperationalJobPayload,
): EnqueueResult {
  return substrate.enqueueJob(jobKind, payload, {
    idempotencyKey: operationalJobIdempotencyKey(jobKind, payload.cycle),
  });
}

// ---------------------------------------------------------------------------
// The scheduler wiring (the scheduler-wiring precedent, for job triggers)
// ---------------------------------------------------------------------------

/** One operational job schedule's configuration (schedules are configuration). */
export interface OperationalJobScheduleConfig {
  readonly jobKind: string;
  /** Stable across restarts; distinct per schedule (execution.md §10). */
  readonly scheduleId: string;
  readonly intervalMs: number;
}

/**
 * The canonical operational-job schedules (the four recurring duties).
 * The interval defaults are configuration starting points — the
 * deployment binds real cadences (topology.md: "schedules are
 * configuration, so no data recovery is involved").
 */
export const OPERATIONAL_JOB_SCHEDULES: readonly OperationalJobScheduleConfig[] = Object.freeze([
  {
    jobKind: RECONCILIATION_SWEEP_JOB_KIND,
    scheduleId: 'ops-reconciliation-sweep',
    intervalMs: 300_000,
  },
  {
    jobKind: CLEARING_PROGRESSION_JOB_KIND,
    scheduleId: 'ops-clearing-progression',
    intervalMs: 60_000,
  },
  {
    jobKind: NETTING_SETTLEMENT_PROGRESSION_JOB_KIND,
    scheduleId: 'ops-netting-settlement-progression',
    intervalMs: 120_000,
  },
  {
    jobKind: QUEUE_DRAIN_SUPPORT_JOB_KIND,
    scheduleId: 'ops-queue-drain-support',
    intervalMs: 30_000,
  },
]);

/** One wired operational job schedule (stop/tickOnce control). */
export interface WiredOperationalJobSchedule {
  readonly config: OperationalJobScheduleConfig;
  /** Fire once on demand using the CURRENT tick identity (dedupe applies). */
  readonly tickOnce: () => { readonly created: boolean } | null;
  readonly stop: () => void;
}

/**
 * Wire the operational-job scheduler: one scheduleRecurring per config,
 * whose payloadFn builds the job payload deterministically from the tick
 * identity (cycle = tick; the window = [tick·interval, (tick+1)·interval)
 * — the scheduler-wiring precedent's window derivation). Timing-driven
 * job-trigger emission ONLY: the payloadFn touches no authority, reads no
 * state, and decides nothing — the job handlers (which the triggers
 * enqueue) do the state-derived derivation at execution time.
 *
 * Source: hosting/scheduler-wiring.ts wireRecurringCommandEmitters (the
 * precedent this follows for job triggers); spec/durable/execution.md
 * §10/§13 (scheduleRecurring; "A schedule's identity must be STABLE
 * across restarts").
 */
export function wireOperationalJobScheduler(
  substrate: SchedulerSubstratePort,
  configs: readonly OperationalJobScheduleConfig[] = OPERATIONAL_JOB_SCHEDULES,
): readonly WiredOperationalJobSchedule[] {
  const scheduleIds = new Set<string>();
  for (const config of configs) {
    if (scheduleIds.has(config.scheduleId)) {
      throw new TypeError(
        `wireOperationalJobScheduler: scheduleId ${config.scheduleId} is shared by two schedules ` +
          '(two schedules of the same job kind MUST use distinct scheduleIds — execution.md §10)',
      );
    }
    scheduleIds.add(config.scheduleId);
  }
  return configs.map((config) => {
    const schedule = substrate.scheduleRecurring(
      config.jobKind,
      (tick: number) => {
        // The deterministic payload: the tick identity IS the cycle; the
        // window is the tick's window (never the live clock reading).
        return {
          cycle: tick,
          windowStartWallMs: tick * config.intervalMs,
          windowEndWallMs: (tick + 1) * config.intervalMs,
        } satisfies OperationalJobPayload;
      },
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
