/**
 * DEP-007 — Observability: the actionable health/readiness model.
 *
 * Owned surface: src/lib/observability/health.ts (work order DEP-007 —
 * "Health/readiness states are actionable").
 *
 * THE MODEL. Per domain:
 *
 *   health ∈ ok | degraded | down | unknown-data
 *
 * with the hard rule: EVERY non-ok state carries a REQUIRED action
 * descriptor — what to inspect, which drill applies, which runbook section
 * (spec/deployment/observability.md). The rule is enforced structurally:
 * domainHealth() REFUSES to construct a non-ok DomainHealth without an
 * action (fail-closed construction), so an unactionable degraded/down
 * state cannot exist.
 *
 * SEVERITY ORDER (worst is last):
 *
 *   ok(0) < degraded(1) < unknown-data(2) < down(3)
 *
 * unknown-data outranks degraded by design: a domain whose state cannot be
 * derived may be concealing a down state, so the composite never claims
 * better than "we cannot see" (fail-closed). down is the absolute worst.
 *
 * THE COMPOSITE ROLLUP IS WORST-OF: the component health is the maximum
 * severity across all nine domains. An ok domain can never mask a degraded,
 * unknown-data, or down domain — the rollup is computed by max, and the
 * worst domains are named in the result. (This is the anti-green-washing
 * rule for composed health: one sick domain is enough to make the composite
 * sick at that severity.)
 *
 * Telemetry never decides financial outcomes here: the health model is an
 * operational signal for readiness and incident response ONLY (the
 * forbidden boundary — taxonomy.ts).
 *
 * The thresholds are explicit, documented, and overridable per deployment
 * (they are operational configuration, not protocol semantics).
 */

import type { TelemetrySnapshot } from './telemetry.ts';
import type { ObservabilityDomain } from './taxonomy.ts';
import { OBSERVABILITY_DOMAINS } from './taxonomy.ts';

// ---------------------------------------------------------------------------
// The state vocabulary and severity ordering
// ---------------------------------------------------------------------------

/** The health states, worst last. */
export type HealthState = 'ok' | 'degraded' | 'unknown-data' | 'down';

/**
 * The severity ordering (higher = worse). unknown-data outranks degraded:
 * an underivable domain may conceal a down state, so the composite never
 * claims better than "cannot see". See the module doc.
 */
export const HEALTH_SEVERITY: Readonly<Record<HealthState, number>> = Object.freeze({
  ok: 0,
  degraded: 1,
  'unknown-data': 2,
  down: 3,
});

/** The worst of two states (the worst-of primitive the rollup uses). */
export function worstOf(a: HealthState, b: HealthState): HealthState {
  return HEALTH_SEVERITY[a] >= HEALTH_SEVERITY[b] ? a : b;
}

// ---------------------------------------------------------------------------
// The action descriptor (REQUIRED for every non-ok state)
// ---------------------------------------------------------------------------

/** What an operator must do about a non-ok domain. */
export interface HealthActionDescriptor {
  /** What to inspect first (a concrete surface, never a guess). */
  readonly whatToInspect: string;
  /** The drill that exercises the remediation (the drill catalog id). */
  readonly drill: string;
  /** The runbook section (spec/deployment/observability.md §...). */
  readonly runbookSection: string;
}

// ---------------------------------------------------------------------------
// The domain and composite health shapes
// ---------------------------------------------------------------------------

/** One domain's health. `action` is REQUIRED for every non-ok state. */
export interface DomainHealth {
  readonly domain: ObservabilityDomain;
  readonly state: HealthState;
  /** Present iff state !== 'ok' (enforced by the constructor below). */
  readonly action?: HealthActionDescriptor;
  /** Value-free human summary of the observed signals. */
  readonly summary: string;
  /** The specific signals that fired (machine-greppable). */
  readonly signals: readonly string[];
}

/** The composite component health (worst-of across the nine domains). */
export interface ComponentHealth {
  readonly component: string;
  readonly overall: HealthState;
  readonly generatedAt: number;
  readonly domains: Readonly<Record<ObservabilityDomain, DomainHealth>>;
  /** The domains sitting at the composite severity (the worst-of witnesses). */
  readonly worstDomains: readonly ObservabilityDomain[];
}

// ---------------------------------------------------------------------------
// Thresholds (operational configuration — documented defaults)
// ---------------------------------------------------------------------------

export interface HealthThresholds {
  /** Queue: oldest queued/failed job age before degradation. Default 60s. */
  readonly oldestQueuedAgeMs?: number;
  /** Queue: dead-letter count at which the queue domain goes DOWN. Default 5. */
  readonly deadLetterDown?: number;
  /** Command: oldest queued command job age before degradation. Default 60s. */
  readonly oldestCommandQueuedAgeMs?: number;
  /** Unknown: total UNKNOWN-class events in window at which the domain goes DOWN. Default 10. */
  readonly unknownDown?: number;
  /** Reconciliation: sweep freshness before degradation. Default 600s (two missed 300s sweeps). */
  readonly sweepFreshnessMs?: number;
  /** Clearing: clearing-progression freshness before degradation. Default 600s. */
  readonly clearingFreshnessMs?: number;
  /** Settlement: oldest queued settlement command age before degradation. Default 300s. */
  readonly settlementQueuedAgeMs?: number;
  /** Recovery: backup age before degradation (deployment hygiene). Default 3600s. */
  readonly backupFreshnessMs?: number;
}

const DEFAULT_THRESHOLDS: Readonly<Required<HealthThresholds>> = Object.freeze({
  oldestQueuedAgeMs: 60_000,
  deadLetterDown: 5,
  oldestCommandQueuedAgeMs: 60_000,
  unknownDown: 10,
  sweepFreshnessMs: 600_000,
  clearingFreshnessMs: 600_000,
  settlementQueuedAgeMs: 300_000,
  backupFreshnessMs: 3_600_000,
});

// ---------------------------------------------------------------------------
// The fail-closed domain-health constructor
// ---------------------------------------------------------------------------

/**
 * Construct one domain's health. FAIL-CLOSED: a non-ok state without an
 * action descriptor is a construction error (an unactionable degraded/down
 * state must never exist — the work order's "states are actionable").
 */
function domainHealth(
  domain: ObservabilityDomain,
  state: HealthState,
  summary: string,
  signals: readonly string[],
  action?: HealthActionDescriptor,
): DomainHealth {
  if (state !== 'ok' && action === undefined) {
    throw new TypeError(
      `domainHealth: non-ok state '${state}' for domain '${domain}' requires an action descriptor ` +
        '(health states are actionable — spec/deployment/observability.md)',
    );
  }
  return Object.freeze({
    domain,
    state,
    ...(action === undefined ? {} : { action: Object.freeze(action) }),
    summary,
    signals: Object.freeze([...signals]),
  });
}

// ---------------------------------------------------------------------------
// The per-domain health derivations (pure functions of the snapshot)
// ---------------------------------------------------------------------------

function healthForQueue(
  snapshot: TelemetrySnapshot,
  thresholds: Required<HealthThresholds>,
): DomainHealth {
  const queue = snapshot.domains.queue;
  const signals: string[] = [];
  let state: HealthState = 'ok';
  let action: HealthActionDescriptor | undefined;
  if (queue.deadLetterCount >= thresholds.deadLetterDown) {
    state = 'down';
    signals.push(`dead-lettered=${queue.deadLetterCount} (>= ${thresholds.deadLetterDown})`);
    action = {
      whatToInspect:
        'durable_jobs rows with status=dead_lettered (listRecentEvents job_dead_lettered for the causes); widespread terminal failure means the queue cannot drain',
      drill: 'drill:replay-recovery',
      runbookSection: 'spec/deployment/observability.md §Dead-letter recovery',
    };
  } else if (queue.deadLetterCount > 0) {
    state = worstOf(state, 'degraded');
    signals.push(`dead-lettered=${queue.deadLetterCount}`);
    action = {
      whatToInspect:
        'durable_jobs rows with status=dead_lettered and their job_dead_lettered events (bounded retries exhausted)',
      drill: 'drill:replay-recovery',
      runbookSection: 'spec/deployment/observability.md §Dead-letter recovery',
    };
  }
  if (queue.leaseExpiredReservedCount > 0) {
    state = worstOf(state, 'degraded');
    signals.push(`lease-expired-reserved=${queue.leaseExpiredReservedCount} (zombie reservations)`);
    action = action ?? {
      whatToInspect:
        'durable_jobs rows with status=reserved AND lease_expires_at <= now — workers died mid-execution; reclaimExpired() redelivers them (at-least-once)',
      drill: 'drill:worker-restart',
      runbookSection: 'spec/deployment/observability.md §Worker restart drill',
    };
  }
  if (queue.oldestQueuedAgeMs !== null && queue.oldestQueuedAgeMs > thresholds.oldestQueuedAgeMs) {
    state = worstOf(state, 'degraded');
    signals.push(`oldest-queued-age=${queue.oldestQueuedAgeMs}ms (> ${thresholds.oldestQueuedAgeMs}ms)`);
    action = action ?? {
      whatToInspect:
        'the oldest queued durable_jobs row (MIN(available_at)) and the kinds with no registered handler',
      drill: 'drill:worker-restart',
      runbookSection: 'spec/deployment/observability.md §Queue and worker recovery',
    };
  }
  return domainHealth(
    'queue',
    state,
    `depth=${queue.totalJobs} (queued=${queue.depthByStatus.queued}, reserved=${queue.reservedCount}, succeeded=${queue.depthByStatus.succeeded}, dead_lettered=${queue.deadLetterCount})`,
    signals.length > 0 ? signals : ['no degradation signals'],
    action,
  );
}

function healthForCommand(
  snapshot: TelemetrySnapshot,
  thresholds: Required<HealthThresholds>,
): DomainHealth {
  const command = snapshot.domains.command;
  const signals: string[] = [];
  let state: HealthState = 'ok';
  let action: HealthActionDescriptor | undefined;
  if (command.refusedInWindow > 0) {
    state = worstOf(state, 'degraded');
    signals.push(`refused=${command.refusedInWindow} in window`);
    action = {
      whatToInspect:
        "the refusal reason codes (durable_events operations.command.submitted rows with ok=false) — typed gateway refusals never enqueue",
      drill: 'drill:failure-injection',
      runbookSection: 'spec/deployment/observability.md §Command admission health',
    };
  }
  if (
    command.oldestCommandJobQueuedAgeMs !== null &&
    command.oldestCommandJobQueuedAgeMs > thresholds.oldestCommandQueuedAgeMs
  ) {
    state = worstOf(state, 'degraded');
    signals.push(
      `oldest-queued-command-age=${command.oldestCommandJobQueuedAgeMs}ms (> ${thresholds.oldestCommandQueuedAgeMs}ms)`,
    );
    action = action ?? {
      whatToInspect:
        'queued command-kind durable_jobs rows (admitted but not executing — an un-hosted binding kind or a worker outage)',
      drill: 'drill:replay-recovery',
      runbookSection: 'spec/deployment/observability.md §Admitted-but-queued commands',
    };
  }
  return domainHealth(
    'command',
    state,
    `submissions=${command.submissionsInWindow} (created=${command.createdInWindow}, replayed=${command.replayedInWindow}, refused=${command.refusedInWindow}), command-jobs-queued=${command.commandJobsQueued}`,
    signals.length > 0 ? signals : ['no degradation signals'],
    action,
  );
}

function healthForExecution(snapshot: TelemetrySnapshot): DomainHealth {
  const execution = snapshot.domains.execution;
  const signals: string[] = [];
  let state: HealthState = 'ok';
  let action: HealthActionDescriptor | undefined;
  if (execution.attemptFailedInWindow > 0 || execution.leaseExpiredInWindow > 0) {
    state = worstOf(state, 'degraded');
    if (execution.attemptFailedInWindow > 0) {
      signals.push(`attempt-failures=${execution.attemptFailedInWindow} in window`);
    }
    if (execution.leaseExpiredInWindow > 0) {
      signals.push(`lease-expiries=${execution.leaseExpiredInWindow} in window`);
    }
    action = {
      whatToInspect:
        'job_attempt_failed / job_lease_expired events (bounded backoff and at-least-once redelivery are working; sustained failures mean handler-level faults)',
      drill: 'drill:worker-restart',
      runbookSection: 'spec/deployment/observability.md §Worker restart drill',
    };
  }
  return domainHealth(
    'execution',
    state,
    `succeeded=${execution.succeededInWindow} in window (total ${execution.succeededTotal}, mean attempts ${execution.meanAttemptsOfSucceeded ?? 'n/a'}), observations=${execution.executedObservationsInWindow}`,
    signals.length > 0 ? signals : ['no degradation signals'],
    action,
  );
}

function healthForUnknown(
  snapshot: TelemetrySnapshot,
  thresholds: Required<HealthThresholds>,
): DomainHealth {
  const unknown = snapshot.domains.unknown;
  const signals: string[] = [];
  if (unknown.totalInWindow >= thresholds.unknownDown) {
    signals.push(
      `unknown-class-events=${unknown.totalInWindow} in window (>= ${thresholds.unknownDown}) — UNKNOWN storm`,
    );
    return domainHealth(
      'unknown',
      'down',
      `UNKNOWN-class events=${unknown.totalInWindow} in window (surfaced=${unknown.railUnknownSurfacedInWindow}, timeouts=${unknown.railTimeoutInWindow}, transport-failures=${unknown.railTransportFailureInWindow}, held=${unknown.unknownHeldInWindow})`,
      signals,
      {
        whatToInspect:
          'the rail activity surface (rail.transmit.* events by rail) and the open reconciliation cases — transmission reliability has collapsed; A14 reconciliation owns resolution, NEVER a blind retry',
        drill: 'drill:failure-injection',
        runbookSection: 'spec/deployment/observability.md §UNKNOWN storm',
      },
    );
  }
  if (unknown.totalInWindow > 0) {
    signals.push(
      `surfaced=${unknown.railUnknownSurfacedInWindow}, timeouts=${unknown.railTimeoutInWindow}, transport-failures=${unknown.railTransportFailureInWindow}, held=${unknown.unknownHeldInWindow}, retransmissions=${unknown.railRetransmittedInWindow}`,
    );
    return domainHealth(
      'unknown',
      'degraded',
      `UNKNOWN-class events=${unknown.totalInWindow} in window (retransmissions=${unknown.railRetransmittedInWindow})`,
      signals,
      {
        whatToInspect:
          'the rail activity records for the affected idempotency keys and the A14 reconciliation cases they routed to (UNKNOWN is surfaced, never retried — the DEP-005 contract)',
        drill: 'drill:failure-injection',
        runbookSection: 'spec/deployment/observability.md §UNKNOWN discipline',
      },
    );
  }
  return domainHealth('unknown', 'ok', `no UNKNOWN-class events in window`, [
    'no degradation signals',
  ]);
}

function healthForReconciliation(
  snapshot: TelemetrySnapshot,
  thresholds: Required<HealthThresholds>,
): DomainHealth {
  const reconciliation = snapshot.domains.reconciliation;
  if (reconciliation.lastSweepCompletedAt === null) {
    return domainHealth(
      'reconciliation',
      'unknown-data',
      'no reconciliation sweep has ever completed on this store — freshness is not derivable',
      ['sweep-never-completed'],
      {
        whatToInspect:
          'the operations.reconciliation-sweep registration and scheduler wiring (a store with no sweep history cannot be assessed for reconciliation health)',
        drill: 'drill:replay-recovery',
        runbookSection: 'spec/deployment/observability.md §Reconciliation freshness',
      },
    );
  }
  if (
    reconciliation.sweepFreshnessMs !== null &&
    reconciliation.sweepFreshnessMs > thresholds.sweepFreshnessMs
  ) {
    return domainHealth(
      'reconciliation',
      'degraded',
      `last sweep ${reconciliation.sweepFreshnessMs}ms ago (> ${thresholds.sweepFreshnessMs}ms)`,
      [`sweep-freshness=${reconciliation.sweepFreshnessMs}ms`],
      {
        whatToInspect:
          'the sweep schedule wiring and the last operations.job.completed row for operations.reconciliation-sweep (a stale sweep leaves OPEN cases unengaged)',
        drill: 'drill:replay-recovery',
        runbookSection: 'spec/deployment/observability.md §Reconciliation freshness',
      },
    );
  }
  return domainHealth(
    'reconciliation',
    'ok',
    `last sweep ${reconciliation.sweepFreshnessMs}ms ago; investigate-submissions=${reconciliation.investigateSubmissionsInWindow} in window`,
    ['no degradation signals'],
  );
}

function healthForClearingNetting(
  snapshot: TelemetrySnapshot,
  thresholds: Required<HealthThresholds>,
): DomainHealth {
  const clearingNetting = snapshot.domains['clearing-netting'];
  if (clearingNetting.lastClearingRunAt === null) {
    return domainHealth(
      'clearing-netting',
      'unknown-data',
      'no clearing-progression run has ever completed on this store — progression health is not derivable',
      ['clearing-never-completed'],
      {
        whatToInspect:
          'the operations.clearing-progression registration and scheduler wiring',
        drill: 'drill:replay-recovery',
        runbookSection: 'spec/deployment/observability.md §Progression freshness',
      },
    );
  }
  const signals: string[] = [];
  let state: HealthState = 'ok';
  let action: HealthActionDescriptor | undefined;
  if (
    snapshot.collectedAt - clearingNetting.lastClearingRunAt >
    thresholds.clearingFreshnessMs
  ) {
    state = worstOf(state, 'degraded');
    signals.push(`clearing-freshness=${snapshot.collectedAt - clearingNetting.lastClearingRunAt}ms`);
    action = {
      whatToInspect:
        'the operations.clearing-progression schedule and the last operations.job.completed row for it (a stale progression leaves window batches un-advanced)',
      drill: 'drill:replay-recovery',
      runbookSection: 'spec/deployment/observability.md §Progression freshness',
    };
  }
  if (clearingNetting.refusalsInWindow > 0) {
    state = worstOf(state, 'degraded');
    signals.push(`refusals=${clearingNetting.refusalsInWindow} in window`);
    action = action ?? {
      whatToInspect:
        'the refused clearing./netting. command submissions in the window (typed gateway refusals — the authorities refused the progression)',
      drill: 'drill:failure-injection',
      runbookSection: 'spec/deployment/observability.md §Command admission health',
    };
  }
  return domainHealth(
    'clearing-netting',
    state,
    `clearing-commands=${clearingNetting.clearingCommandsInWindow}, netting-commands=${clearingNetting.nettingCommandsInWindow} in window`,
    signals.length > 0 ? signals : ['no degradation signals'],
    action,
  );
}

function healthForSettlementFinality(
  snapshot: TelemetrySnapshot,
  thresholds: Required<HealthThresholds>,
): DomainHealth {
  const settlement = snapshot.domains['settlement-finality'];
  const signals: string[] = [];
  let state: HealthState = 'ok';
  let action: HealthActionDescriptor | undefined;
  if (settlement.unknownHeldInWindow > 0) {
    state = worstOf(state, 'degraded');
    signals.push(`unknown-held=${settlement.unknownHeldInWindow} in window (finality blocked pending reconciliation)`);
    action = {
      whatToInspect:
        'the operations.unknown.held rows (settlement attempts held UNKNOWN — never retried; A14 reconciliation owns resolution; finality is NEVER forced by recovery)',
      drill: 'drill:failure-injection',
      runbookSection: 'spec/deployment/observability.md §UNKNOWN discipline',
    };
  }
  if (
    settlement.oldestSettlementJobQueuedAgeMs !== null &&
    settlement.oldestSettlementJobQueuedAgeMs > thresholds.settlementQueuedAgeMs
  ) {
    state = worstOf(state, 'degraded');
    signals.push(
      `oldest-queued-settlement-command=${settlement.oldestSettlementJobQueuedAgeMs}ms (> ${thresholds.settlementQueuedAgeMs}ms)`,
    );
    action = action ?? {
      whatToInspect:
        'queued settlement.* durable_jobs rows (admitted but not executing — the recorded D-2 un-hosted vocabulary subset or a binding outage; finality progression is stalled upstream)',
      drill: 'drill:replay-recovery',
      runbookSection: 'spec/deployment/observability.md §Admitted-but-queued commands',
    };
  }
  return domainHealth(
    'settlement-finality',
    state,
    `settlement-commands=${settlement.settlementCommandsInWindow}, finality-commands=${settlement.finalityCommandsInWindow}, finality-executions=${settlement.finalityExecutionsInWindow} in window; queued-settlement-jobs=${settlement.settlementJobsQueued}`,
    signals.length > 0 ? signals : ['no degradation signals'],
    action,
  );
}

function healthForIncidentRecovery(
  snapshot: TelemetrySnapshot,
  thresholds: Required<HealthThresholds>,
): DomainHealth {
  const recovery = snapshot.domains['incident-recovery'];
  if (recovery.tamperDetectedTotal > 0) {
    return domainHealth(
      'incident-recovery',
      'down',
      `evidence-integrity violations on record: ${recovery.tamperDetectedTotal} (tamper detected or restore refused)`,
      [`tamper-or-refused-restores=${recovery.tamperDetectedTotal}`],
      {
        whatToInspect:
          'the recovery.tamper.detected / recovery.restore.failed rows and the affected store copy — QUARANTINE the tampered store; restore from the last verified backup and re-verify evidence integrity; never repair evidence in place',
        drill: 'drill:evidence-integrity',
        runbookSection: 'spec/deployment/observability.md §Evidence-integrity violations',
      },
    );
  }
  if (recovery.lastBackupAt === null) {
    return domainHealth(
      'incident-recovery',
      'degraded',
      'no backup on record — disaster-recovery coverage is absent',
      ['no-backup-on-record'],
      {
        whatToInspect:
          'the backup manifest (no recovery.backup.completed event and no manifest rows) — take the first backup before any incident, not after',
        drill: 'drill:backup-restore',
        runbookSection: 'spec/deployment/observability.md §Backup and restore contract',
      },
    );
  }
  if (
    recovery.backupFreshnessMs !== null &&
    recovery.backupFreshnessMs > thresholds.backupFreshnessMs
  ) {
    return domainHealth(
      'incident-recovery',
      'degraded',
      `last backup ${recovery.backupFreshnessMs}ms ago (> ${thresholds.backupFreshnessMs}ms)`,
      [`backup-freshness=${recovery.backupFreshnessMs}ms`],
      {
        whatToInspect:
          'the backup manifest tail and the backup schedule — a stale backup means a longer recovery point objective than the contract',
        drill: 'drill:backup-restore',
        runbookSection: 'spec/deployment/observability.md §Backup and restore contract',
      },
    );
  }
  return domainHealth(
    'incident-recovery',
    'ok',
    `last backup ${recovery.backupFreshnessMs}ms ago; restores-verified=${recovery.restoresVerifiedInWindow}, replays=${recovery.replaysCompletedInWindow} in window`,
    ['no degradation signals'],
  );
}

function healthForDeployment(
  snapshot: TelemetrySnapshot,
  thresholds: Required<HealthThresholds>,
): DomainHealth {
  const deployment = snapshot.domains.deployment;
  const signals: string[] = [];
  let state: HealthState = 'ok';
  let action: HealthActionDescriptor | undefined;
  if (deployment.journalMode !== 'wal') {
    state = worstOf(state, 'degraded');
    signals.push(`journal-mode=${deployment.journalMode} (WAL is the crash-safety contract)`);
    action = {
      whatToInspect:
        "PRAGMA journal_mode on the durable handle — the DEP-003 open path enables WAL; a non-WAL store has lost the crash-safety guarantee",
      drill: 'drill:backup-restore',
      runbookSection: 'spec/deployment/observability.md §Deployment health',
    };
  }
  if (deployment.migrationsApplied === 0) {
    state = worstOf(state, 'degraded');
    signals.push('migrations-applied=0 (the durable schema is not installed)');
    action = action ?? {
      whatToInspect:
        'schema_migrations (an empty applied set means openDurableDatabase did not run — the store is not the governed schema)',
      drill: 'drill:backup-restore',
      runbookSection: 'spec/deployment/observability.md §Deployment health',
    };
  }
  if (
    deployment.lastBackupAgeMs !== null &&
    deployment.lastBackupAgeMs > thresholds.backupFreshnessMs
  ) {
    state = worstOf(state, 'degraded');
    signals.push(`backup-age=${deployment.lastBackupAgeMs}ms (> ${thresholds.backupFreshnessMs}ms)`);
    action = action ?? {
      whatToInspect: 'the backup manifest tail and the backup schedule (deployment hygiene)',
      drill: 'drill:backup-restore',
      runbookSection: 'spec/deployment/observability.md §Backup and restore contract',
    };
  }
  return domainHealth(
    'deployment',
    state,
    `env=${deployment.environment}, journal-mode=${deployment.journalMode}, migrations=${deployment.migrationsApplied}, last-backup=${deployment.lastBackupAgeMs === null ? 'none' : `${deployment.lastBackupAgeMs}ms ago`}`,
    signals.length > 0 ? signals : ['no degradation signals'],
    action,
  );
}

// ---------------------------------------------------------------------------
// The composite derivation (worst-of — never masks)
// ---------------------------------------------------------------------------

/**
 * Derive the composite component health from one telemetry snapshot.
 * WORST-OF: the overall state is the maximum severity across all nine
 * domains; an ok domain can never mask a worse one, and the worst domains
 * are named. Every non-ok domain carries its required action descriptor
 * (enforced at construction).
 */
export function deriveComponentHealth(
  snapshot: TelemetrySnapshot,
  options: { readonly thresholds?: HealthThresholds; readonly component?: string } = {},
): ComponentHealth {
  const thresholds: Required<HealthThresholds> = {
    ...DEFAULT_THRESHOLDS,
    ...(options.thresholds ?? {}),
  };
  const domains: Record<ObservabilityDomain, DomainHealth> = {
    command: healthForCommand(snapshot, thresholds),
    queue: healthForQueue(snapshot, thresholds),
    execution: healthForExecution(snapshot),
    unknown: healthForUnknown(snapshot, thresholds),
    reconciliation: healthForReconciliation(snapshot, thresholds),
    'clearing-netting': healthForClearingNetting(snapshot, thresholds),
    'settlement-finality': healthForSettlementFinality(snapshot, thresholds),
    'incident-recovery': healthForIncidentRecovery(snapshot, thresholds),
    deployment: healthForDeployment(snapshot, thresholds),
  };
  let overall: HealthState = 'ok';
  for (const domain of OBSERVABILITY_DOMAINS) {
    overall = worstOf(overall, domains[domain].state);
  }
  const worstDomains = OBSERVABILITY_DOMAINS.filter(
    (domain) => domains[domain].state === overall && overall !== 'ok',
  );
  return Object.freeze({
    component: options.component ?? 'web-api-boundary',
    overall,
    generatedAt: snapshot.collectedAt,
    domains: Object.freeze(domains),
    worstDomains: Object.freeze([...worstDomains]),
  });
}

/**
 * The readiness projection of a component health: 'ok'/'degraded' are
 * serving; 'unknown-data' and 'down' are not ready to claim health. This
 * is the mapping the additive /api/ready enrichment reports — it NEVER
 * changes the route's existing contract (the F6 configuration checks stay
 * the authority on readiness); it only ADDS the composite's state.
 */
export function readinessProjection(health: ComponentHealth): 'ready' | 'health-unknown' | 'unhealthy' {
  switch (health.overall) {
    case 'ok':
    case 'degraded':
      return 'ready';
    case 'unknown-data':
      return 'health-unknown';
    case 'down':
      return 'unhealthy';
  }
}
