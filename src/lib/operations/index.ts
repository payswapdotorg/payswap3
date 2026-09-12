/**
 * DEP-004 — The operational-jobs family barrel: the composed public
 * surface of the durable operational-jobs layer.
 *
 * Owned surface: src/lib/operations/index.ts (work order DEP-004 — the
 * operational-jobs family over the composed protocol runtime).
 *
 * WHAT THIS LAYER IS: background operational jobs and orchestration ONLY
 * (the work order's owned-surface phrase). The family runs as/over the
 * DEP-003 durable substrate (the in-process form first — the
 * DEP-001/002/003/RTN-012 precedent; externalized process binding is
 * recorded FUTURE-WORK in the deployment contract). Every job:
 *   - derives its work ONLY from the authorities' public read surface
 *     (OperationalReadSurface — the composed runtime satisfies it);
 *   - emits protocol commands EXCLUSIVELY through
 *     ProtocolGateway.submitCommand — the ONE admission point — with
 *     deterministic idempotency keys per (job, cycle, subject);
 *   - records its audit trail in durable_events under the
 *     'operational-jobs' owner (the DEP-003 evidence home);
 *   - NEVER mutates authoritative state (the transition runtime is the
 *     single writer), NEVER holds rail credentials, NEVER serves
 *     internet traffic, and NEVER asserts settlement finality (finality
 *     is A12's alone).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE MAP — per-module entry points
 * ═══════════════════════════════════════════════════════════════════════
 *
 * | Module | Duty | Command kinds emitted (COMMAND-SURFACE.md) |
 * |---|---|---|
 * | jobs.ts | the shared job runtime: the submission + audit discipline, the read-surface port, the payload contract | (the discipline: deriveIdempotencyKey('command', kind, jobKind, cycle, subject) → gateway) |
 * | reconciliation-sweep.ts | reconciliation sweeps (A14): statement sources, the window matching cycle, the OPEN-case investigation triggers | reconciliation.source.register; reconciliation.cycle.open / .statements.collect / .matching.run / .close; reconciliation.case.investigate |
 * | clearing-progression.ts | clearing batch progression (A09): the window batch lifecycle | clearing.batch.open / .stage / .commit / .finalize |
 * | netting-settlement-progression.ts | netting-settlement progression (A11+A12): netting-set progression + settlement support (progression only — finality never) | netting.set.open / .compute / .commit; settlement.instruction.create / .attempt.authorize / .attempt.submit |
 * | queue-drain-support.ts | queue-draining support (A08): ensure-created, the drain gate, the eligibility sweep + due expiry | queues.queue.create / .queue.drain.start / .eligibility.evaluate / .items.due.expire |
 * | orchestration.ts | the wiring: job registration (register()), the scheduler wiring (scheduleRecurring — the scheduler-wiring precedent), the on-demand trigger | (job-trigger emission only — commands/jobs, never state) |
 * | progress-reader.ts | the job-progress audit reader (reads only) | — |
 * | OPERATIONS-EVIDENCE.md | the operational evidence document (duties, disciplines, the honest D-2 execution-gap note) | — |
 *
 * ═══════════════════════════════════════════════════════════════════════
 * THE COMPOSITION ORDER (how the jobs layer composes onto the composed
 * runtime — extending the wave barrel's order, read-only integration)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  1. THE COMPOSED RUNTIME (src/lib/protocol-runtime/index.ts — read-only
 *     via the barrel): substrate → evidence → authorities → persist
 *     hooks → bindings → transition runtime (registerAll) → gateway.
 *  2. THE READ SURFACE: the composition root passes the authorities'
 *     public read methods as the structural OperationalReadSurface.
 *  3. THE JOB DEPS: gateway (submitCommand only) + reads + the audit
 *     port (the substrate's recordEvent) + the job configuration.
 *  4. REGISTRATION: registerOperationalJobs(substrate, deps) — the
 *     DEP-003 register() integration point for the four `operations.*`
 *     job kinds.
 *  5. THE SCHEDULER WIRING: wireOperationalJobScheduler(substrate) —
 *     scheduleRecurring per duty (timing-driven job triggers; commands
 *     only, never state), and/or enqueueOperationalJob for event-driven
 *     triggers.
 *  6. THE AUDIT READER: readOperationalJobProgress(database) — the
 *     reads-only progress report over the journal + execution join.
 *
 * The evidence harness scripts/test_operations.mjs realizes this order
 * end-to-end over the REAL composed runtime (the RTN-012 harness style).
 *
 * Runtime note: like the composed runtime's leaf modules, this family
 * loads under plain Node with type stripping (explicit .ts specifiers)
 * and type-checks under tsc — it is NOT loaded by any bun suite (the
 * merged 1901 remain untouched) and NOT imported by any src/app route
 * (the web boundary keeps zero operations reach, per the topology's web
 * boundary rules).
 */

// --- the shared job runtime (the discipline) ---------------------------------
export {
  OPERATIONS_EVENT_OWNER,
  OPERATIONS_EVENT_TYPES,
  parseOperationalJobPayload,
  operationalCommandIdempotencyKey,
  submitJobCommand,
  operationalJobHandler,
} from './jobs.ts';
export type {
  OperationalReadSurface,
  OperationalSettlementSubject,
  OperationalGatewayPort,
  OperationalAuditPort,
  OperationalJobConfig,
  OperationalJobDeps,
  OperationalJobPayload,
  JobCommandSpec,
  JobCommandOutcome,
  OperationalJobContext,
} from './jobs.ts';

// --- the four recurring operational duties -----------------------------------
export {
  RECONCILIATION_SWEEP_JOB_KIND,
  DEFAULT_RECONCILIATION_RULE_VERSION,
  reconciliationCycleIdForWindow,
  reconciliationSweepJob,
} from './reconciliation-sweep.ts';
export {
  CLEARING_PROGRESSION_JOB_KIND,
  DEFAULT_CLEARING_BATCH_LABEL_PREFIX,
  clearingProgressionJob,
} from './clearing-progression.ts';
export {
  NETTING_SETTLEMENT_PROGRESSION_JOB_KIND,
  DEFAULT_NETTING_LABEL_PREFIX,
  nettingSettlementProgressionJob,
} from './netting-settlement-progression.ts';
export {
  QUEUE_DRAIN_SUPPORT_JOB_KIND,
  queueDrainSupportJob,
} from './queue-drain-support.ts';

// --- the orchestration (registration + scheduler wiring + triggers) ----------
export {
  OPERATIONAL_JOB_KINDS,
  OPERATIONAL_JOB_SCHEDULES,
  registerOperationalJobs,
  operationalJobIdempotencyKey,
  enqueueOperationalJob,
  wireOperationalJobScheduler,
} from './orchestration.ts';
export type {
  OperationalJobSubstratePort,
  RegisteredOperationalJob,
  OperationalJobWiring,
  OperationalJobScheduleConfig,
  WiredOperationalJobSchedule,
} from './orchestration.ts';

// --- the job-progress audit reader (reads only) ------------------------------
export { readOperationalJobProgress } from './progress-reader.ts';
export type { AuditedJobCommand, AuditedJobRun, OperationalJobProgress } from './progress-reader.ts';
