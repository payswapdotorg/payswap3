/**
 * DEP-004 — Operational jobs: the shared job runtime (the submission and
 * audit discipline every duty module composes).
 *
 * Owned surface: src/lib/operations/jobs.ts (work order DEP-004 — the
 * operational-jobs family: "job definitions, orchestration/progression
 * logic, sweep policies, operational evidence docs").
 *
 * THE DISCIPLINE THIS MODULE ENFORCES (the work order's acceptance
 * criteria, structurally):
 *
 *  1. ONE ADMISSION POINT — every protocol command a job emits goes
 *     through ProtocolGateway.submitCommand (the sole admission point;
 *     spec/deployment/topology.md "Runtime ownership of protocol
 *     authorities"). The job runtime holds ONLY the gateway's
 *     submitCommand — no authority reference, no enqueue path, no state
 *     write. Zero authority semantics, zero direct state mutation.
 *
 *  2. DETERMINISTIC IDEMPOTENCY KEYS per (job, cycle, subject) —
 *     deriveIdempotencyKey('command', commandKind, jobKind, cycle,
 *     subject): the kernel derivation feeding the DEP-003 dedupe identity
 *     (UNIQUE (idempotency_key, kind)). Duplicate execution is harmless:
 *     the re-submission returns the RECORDED receipt verbatim (never a
 *     second effect) — INV-1-3 generalized by the gateway.
 *
 *  3. AUTHORITATIVE READS ONLY — jobs derive work from the authorities'
 *     public read surface (OperationalReadSurface below: a structural
 *     projection the composed runtime satisfies). No job ever reads the
 *     substrate's queue internals to decide financial work.
 *
 *  4. AUDIT — every consequential job action (a command submission, a
 *     derived-work observation, an UNKNOWN-held observation) records a
 *     durable_events row under OPERATIONS_EVENT_OWNER (the DEP-003
 *     evidence home with the explicit owner column — spec/durable/
 *     execution.md "own their own evidence via recordEvent(type, data,
 *     owner)"). Every submission is ALSO evidenced in the A15 chain
 *     through the protocol's own discipline: executed commands produce
 *     the owning authority's records; admission refusals produce
 *     GATEWAY_COMMAND_REJECTED records on the real A15 log (the gateway's
 *     rejection-evidence discipline).
 *
 *  5. RESTART SAFETY — a job run is a pure function of (payload, the
 *     authoritative state at run time): re-running after a crash
 *     re-derives the pending work and re-submits with the SAME
 *     idempotency keys. The DEP-003 at-least-once delivery + the gateway
 *     dedupe make the replay harmless.
 *
 * Spec sources (binding): spec/system-work-orders/DEP-004.md (the
 * objective and acceptance criteria); spec/deployment/topology.md (the
 * worker boundary — "never serve internet traffic, never hold rail
 * credentials, and never mutate authoritative state directly"; the
 * scheduler boundary — timing-driven command emission); src/lib/
 * protocol-runtime/INTEGRATION-EVIDENCE.md (the composed UNKNOWN
 * semantics — the oracle); src/lib/protocol-runtime/gateway/
 * COMMAND-SURFACE.md (the submission contract); src/lib/durable/ (the
 * substrate's public API, read-only integration).
 *
 * Runtime note (the repository's documented split): this module imports
 * the kernel leaf modules directly (identity/time — plain-Node loadable)
 * and TYPE-ONLY imports from the composed runtime barrel and the durable
 * substrate (erased at load time), so the job family loads under plain
 * Node with type stripping AND type-checks under tsc/bun.
 */

import { deriveIdempotencyKey } from '../protocol-runtime/kernel/identity.ts';
import type { DerivedIdempotencyKey } from '../protocol-runtime/kernel/identity.ts';
import { protocolTime } from '../protocol-runtime/kernel/time.ts';
import type { CommandKind, CommandEnvelope, ProtocolAuthorityId } from '../protocol-runtime/kernel/envelope.ts';
import type { CommandAdmissionResult } from '../protocol-runtime/index.ts';
import type { DurableJobHandler } from '../durable/worker.ts';
import type { DurableJob } from '../durable/queue.ts';

// ---------------------------------------------------------------------------
// The audit identity (DEP-003 durable_events owner column)
// ---------------------------------------------------------------------------

/**
 * The durable_events owner for every operational-job audit row. The
 * DEP-003 evidence discipline: every row names the party that recorded it
 * (spec/durable/execution.md — "Protocol authorities (future work) record
 * their OWN evidence under their own owner identity via the same table").
 * The operational-jobs family is deployment-owned job logic — it records
 * under its own identity and writes NO A15 records directly (the A15
 * chain's authority vocabulary is closed to registry authorities; the
 * jobs' consequential actions are evidenced in the chain through the
 * gateway's admission discipline and the authorities' own records).
 */
export const OPERATIONS_EVENT_OWNER = 'operational-jobs';

/** One job action's audit event types (the journal vocabulary). */
export const OPERATIONS_EVENT_TYPES = Object.freeze({
  jobStarted: 'operations.job.started',
  workDerived: 'operations.work.derived',
  commandSubmitted: 'operations.command.submitted',
  unknownHeld: 'operations.unknown.held',
  noWork: 'operations.job.no-work',
  jobCompleted: 'operations.job.completed',
} as const);

// ---------------------------------------------------------------------------
// The read surface (authoritative protocol state, read-only)
// ---------------------------------------------------------------------------

/** One settleable subject (A12's subject union, as the jobs read it). */
export interface OperationalSettlementSubject {
  readonly kind: 'OBLIGATION' | 'NET_POSITION';
  readonly obligationId?: string;
  readonly netObligationId?: string;
}

/**
 * The authorities' public read surface the jobs consume — a STRUCTURAL
 * projection (the composed runtime's authorities satisfy it; the
 * composition root passes them in). Reads only: no command method appears
 * here, by construction. Jobs consume ONLY authoritative protocol state
 * (the acceptance criterion).
 */
export interface OperationalReadSurface {
  /** A09 — clearing batches by id (the deterministic batch-label domain). */
  readonly clearing: {
    readonly batch: (batchId: string) => { readonly state: string } | undefined;
  };
  /** A11 — netting sets + net obligations + the INV-11-2 membership claim. */
  readonly netting: {
    readonly nettingSet: (nettingSetId: string) => { readonly state: string } | undefined;
    readonly listNettingSets: () => ReadonlyArray<{ readonly nettingSetId: string; readonly state: string }>;
    readonly listNetObligations: () => ReadonlyArray<{
      readonly netObligationId: string;
      readonly state: string;
    }>;
    readonly obligationClaim: (obligationId: string) => string | undefined;
  };
  /** A10 — the obligation projection. */
  readonly obligations: {
    readonly obligations: () => ReadonlyArray<{
      readonly obligationId: string;
      readonly state: string;
      readonly terms: { readonly debtorParticipantId: string; readonly creditorParticipantId: string };
    }>;
  };
  /** A12 — settlement instructions, attempts, finality, the GC-2 hold probe. */
  readonly settlement: {
    readonly listInstructions: () => ReadonlyArray<{
      readonly instructionId: string;
      readonly state: string;
      readonly subject: OperationalSettlementSubject;
    }>;
    readonly instructionsForSubject: (subject: OperationalSettlementSubject) => ReadonlyArray<{ readonly instructionId: string; readonly state: string }>;
    readonly attemptForInstruction: (
      instructionId: string,
    ) => { readonly instructionId: string; readonly state: string; readonly reconciliationCaseId?: string } | undefined;
    readonly listAttempts: () => ReadonlyArray<{
      readonly attemptId: string;
      readonly instructionId: string;
      readonly state: string;
      readonly reconciliationCaseId?: string;
    }>;
  };
  /** A14 — reconciliation sources, cases, cycles. */
  readonly reconciliation: {
    readonly getSource: (sourceId: string) => { readonly sourceId: string } | undefined;
    readonly listSources: () => ReadonlyArray<{ readonly sourceId: string }>;
    readonly listCases: () => ReadonlyArray<{ readonly caseId: string; readonly status: string }>;
    readonly getCycle: (cycleId: string) => { readonly cycleId: string; readonly status: string } | undefined;
  };
  /** A08 — queues by id. */
  readonly queues: {
    readonly queue: (queueId: string) => { readonly queueId: string; readonly state: string } | undefined;
  };
  /** A03 — the capability snapshot (the eligibility fact source). */
  readonly capability: {
    readonly snapshot: () => {
      readonly snapshotId: string;
      readonly capabilities: ReadonlyArray<{
        readonly capabilityId: string;
        readonly tier: string;
        readonly state: string;
      }>;
    };
  };
  /** A06 — liquidity pools by id (the eligibility fact source). */
  readonly liquidity: {
    readonly pool: (poolId: string) => { readonly poolId: string; readonly currency: string; readonly scale: number; readonly totalMinor: number } | undefined;
  };
  /** A07 — credit lines (the eligibility fact source). */
  readonly credit: {
    readonly linesInOrder: () => ReadonlyArray<{ readonly lineId: string }>;
    readonly lineExposure: (lineId: string) => { readonly lineId: string; readonly remaining: { readonly currency: string; readonly amountMinor: number; readonly scale: number } } | undefined;
  };
}

// ---------------------------------------------------------------------------
// The job runtime ports (what a job may hold — nothing else)
// ---------------------------------------------------------------------------

/** The sole admission point, as a structural port (the gateway satisfies it). */
export interface OperationalGatewayPort {
  readonly submitCommand: (submission: unknown) => Promise<CommandAdmissionResult>;
}

/** The substrate audit port (durable_events under an explicit owner). */
export interface OperationalAuditPort {
  readonly recordEvent: (
    type: string,
    data: unknown,
    owner: string,
    jobId?: string | null,
  ) => unknown;
}

/** Per-job configuration (schedules are configuration — topology.md). */
export interface OperationalJobConfig {
  /** Clearing progression: the window batch-label prefix (label = prefix + cycle). */
  readonly clearingBatchLabelPrefix?: string;
  /** Clearing progression: how many prior cycles' batches the sweep covers. */
  readonly clearingLookback?: number;
  /** Netting progression: the cohort set-label prefix (label = prefix + cycle). */
  readonly nettingLabelPrefix?: string;
  /** Settlement support: the adapter that carries the attempts (A13 adapter id). */
  readonly settlementAdapterId?: string;
  /** Settlement support: the beneficiary resolver per settleable subject. */
  readonly beneficiaryFor?: (subject: OperationalSettlementSubject) => string;
  /** Reconciliation sweep: the statement sources to ensure registered. */
  readonly reconciliationSources?: ReadonlyArray<{ readonly kind: string; readonly description: string }>;
  /** Reconciliation sweep: the matching rule version (A14 supports 1). */
  readonly reconciliationRuleVersion?: number;
  /** Reconciliation sweep: the external statement provider (job input port). */
  readonly statementProvider?: (window: {
    readonly windowStartWallMs: number;
    readonly windowEndWallMs: number;
  }) => ReadonlyArray<Record<string, unknown>>;
  /** Queue-drain support: the queues to support. */
  readonly queueIds?: readonly string[];
  /** Queue-drain support: the creation policies for the supported queues. */
  readonly queuePolicies?: Readonly<
    Record<
      string,
      {
        readonly maxWaitEpochMs: number;
        readonly releaseConditions: {
          readonly requiredCapabilityTier?: string;
          readonly minLiquidityAvailable?: { readonly currency: string; readonly amountMinor: number; readonly scale: number };
          readonly minCreditRemaining?: { readonly currency: string; readonly amountMinor: number; readonly scale: number };
        };
      }
    >
  >;
  /** Queue-drain support: the pool ids the eligibility snapshot derives from. */
  readonly liquidityPoolIds?: readonly string[];
}

/** Everything a job run may touch (the enforced boundary). */
export interface OperationalJobDeps {
  readonly gateway: OperationalGatewayPort;
  readonly reads: OperationalReadSurface;
  readonly audit: OperationalAuditPort;
  readonly config: OperationalJobConfig;
}

// ---------------------------------------------------------------------------
// The job payload (the deterministic cycle identity)
// ---------------------------------------------------------------------------

/**
 * One operational job run's payload: the cycle identity (the tick number
 * or the on-demand trigger's explicit cycle) and the deterministic window
 * (the same derivation the scheduler-wiring precedent uses — the window,
 * not the wall-clock reading, is the run's subject identity, so the same
 * cycle always re-derives the same work across restarts).
 */
export interface OperationalJobPayload {
  readonly cycle: number;
  readonly windowStartWallMs: number;
  readonly windowEndWallMs: number;
}

/** Parse and validate one durable job's payload as an OperationalJobPayload. */
export function parseOperationalJobPayload(value: unknown): OperationalJobPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('operational job payload must be a record');
  }
  const candidate = value as Record<string, unknown>;
  const { cycle, windowStartWallMs, windowEndWallMs } = candidate;
  if (!Number.isSafeInteger(cycle) || (cycle as number) < 0) {
    throw new TypeError('operational job payload: cycle must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(windowStartWallMs) || !Number.isSafeInteger(windowEndWallMs)) {
    throw new TypeError('operational job payload: window bounds must be safe integers');
  }
  if ((windowStartWallMs as number) > (windowEndWallMs as number)) {
    throw new TypeError('operational job payload: window start must be <= window end');
  }
  return {
    cycle: cycle as number,
    windowStartWallMs: windowStartWallMs as number,
    windowEndWallMs: windowEndWallMs as number,
  };
}

// ---------------------------------------------------------------------------
// The command submission discipline
// ---------------------------------------------------------------------------

/** One derived pending command (what a duty module asks the runtime to submit). */
export interface JobCommandSpec {
  /** The gateway catalogue kind (COMMAND-SURFACE.md — the 112-kind catalogue). */
  readonly kind: CommandKind;
  /** The owning authority (the registry name). */
  readonly authority: ProtocolAuthorityId;
  /** The envelope's subject ids (positional per the kind's declared binding). */
  readonly subjectIds: readonly string[];
  /** The (job, cycle, subject) identity component — the idempotency derivation input. */
  readonly subject: string;
  /** The command body (the owning authority's documented input). */
  readonly body: Record<string, unknown>;
}

/**
 * The deterministic idempotency key for one job command: per (job, cycle,
 * subject) — plus the command kind (the DEP-003 dedupe identity is
 * (idempotencyKey, kind), so kind inclusion keeps every submission's
 * receipt identity distinct while the (job, cycle, subject) discipline
 * guarantees the same derived work always re-derives the same key).
 *
 * Source: DEP-004.md IMPLEMENTATION 2 — "deterministic idempotency keys
 * per (job, cycle, subject) — the DEP-003 dedupe identity".
 */
export function operationalCommandIdempotencyKey(
  jobKind: string,
  cycle: number,
  subject: string,
  commandKind: string,
): DerivedIdempotencyKey {
  return deriveIdempotencyKey('command', commandKind, jobKind, cycle, subject);
}

/** One submission's audited outcome (the journal entry material). */
export interface JobCommandOutcome {
  readonly commandKind: string;
  readonly subject: string;
  readonly idempotencyKey: string;
  readonly ok: boolean;
  readonly created: boolean;
  readonly replayed: boolean;
  readonly reasonCode?: string;
  /** The durable command-path job id (the admitted command's queue position). */
  readonly commandJobId?: string;
}

/**
 * Submit ONE protocol command through THE GATEWAY with the deterministic
 * key, and record the audit row. This is the ONLY command path any job
 * module gets — the structural enforcement of "commands through the one
 * gateway admission point".
 */
export async function submitJobCommand(
  deps: OperationalJobDeps,
  jobKind: string,
  payload: OperationalJobPayload,
  jobId: string | null,
  spec: JobCommandSpec,
): Promise<JobCommandOutcome> {
  const idempotencyKey = operationalCommandIdempotencyKey(jobKind, payload.cycle, spec.subject, spec.kind);
  // The envelope's protocolTime is derived from the cycle identity — the
  // same cycle always produces the same envelope (GC-1 determinism; the
  // scheduler-wiring precedent's discipline: the window, never the live
  // clock reading, is the subject identity).
  const envelope: CommandEnvelope = {
    kind: spec.kind,
    authority: spec.authority,
    subjectIds: [...spec.subjectIds],
    idempotencyKey,
    protocolTime: protocolTime(payload.cycle, payload.windowStartWallMs),
    body: spec.body,
  };
  const admission = await deps.gateway.submitCommand(envelope);
  const outcome: JobCommandOutcome = admission.ok
    ? {
        commandKind: spec.kind,
        subject: spec.subject,
        idempotencyKey,
        ok: true,
        created: admission.created,
        replayed: admission.replayed,
        commandJobId: admission.jobId,
      }
    : {
        commandKind: spec.kind,
        subject: spec.subject,
        idempotencyKey,
        ok: false,
        created: false,
        replayed: false,
        reasonCode: admission.reasonCode,
      };
  deps.audit.recordEvent(
    OPERATIONS_EVENT_TYPES.commandSubmitted,
    {
      jobKind,
      cycle: payload.cycle,
      commandKind: spec.kind,
      authority: spec.authority,
      subject: spec.subject,
      idempotencyKey,
      ok: outcome.ok,
      created: outcome.created,
      replayed: outcome.replayed,
      ...(outcome.reasonCode === undefined ? {} : { reasonCode: outcome.reasonCode }),
      ...(outcome.commandJobId === undefined ? {} : { commandJobId: outcome.commandJobId }),
    },
    OPERATIONS_EVENT_OWNER,
    jobId,
  );
  return outcome;
}

// ---------------------------------------------------------------------------
// The job run skeleton
// ---------------------------------------------------------------------------

/** The derivation context (what the duty's derive function receives). */
export interface OperationalJobContext {
  readonly deps: OperationalJobDeps;
  readonly jobKind: string;
  readonly payload: OperationalJobPayload;
  readonly jobId: string | null;
  /** Submit one derived command (the disciplined path — the ONLY path). */
  readonly submit: (spec: JobCommandSpec) => Promise<JobCommandOutcome>;
  /** Record an UNKNOWN-held observation (the never-retry discipline's audit). */
  readonly noteUnknownHeld: (observation: { readonly subject: string; readonly caseId?: string }) => void;
  /** Record one derived-work line (the audit narrative). */
  readonly noteDerived: (line: string) => void;
}

/**
 * Build one operational job's durable handler: parse the payload, audit
 * the start, run the duty's derivation (a pure function of the payload +
 * the authoritative state), audit the completion. The handler throws only
 * on malformed payloads — every typed refusal from the gateway is an
 * audited outcome, not an error (the job re-derives on the next run).
 */
export function operationalJobHandler(
  jobKind: string,
  deps: OperationalJobDeps,
  derive: (context: OperationalJobContext) => Promise<void> | void,
): DurableJobHandler {
  return async (job: DurableJob) => {
    const payload = parseOperationalJobPayload(job.payload);
    deps.audit.recordEvent(
      OPERATIONS_EVENT_TYPES.jobStarted,
      {
        jobKind,
        cycle: payload.cycle,
        windowStartWallMs: payload.windowStartWallMs,
        windowEndWallMs: payload.windowEndWallMs,
      },
      OPERATIONS_EVENT_OWNER,
      job.id,
    );
    const derived: string[] = [];
    const submissions: JobCommandOutcome[] = [];
    const unknownHeld: Array<{ readonly subject: string; readonly caseId?: string }> = [];
    const context: OperationalJobContext = {
      deps,
      jobKind,
      payload,
      jobId: job.id,
      submit: (spec) =>
        submitJobCommand(deps, jobKind, payload, job.id, spec).then((outcome) => {
          submissions.push(outcome);
          return outcome;
        }),
      noteUnknownHeld: (observation) => {
        unknownHeld.push(observation);
        deps.audit.recordEvent(
          OPERATIONS_EVENT_TYPES.unknownHeld,
          {
            jobKind,
            cycle: payload.cycle,
            subject: observation.subject,
            ...(observation.caseId === undefined ? {} : { caseId: observation.caseId }),
          },
          OPERATIONS_EVENT_OWNER,
          job.id,
        );
      },
      noteDerived: (line) => {
        derived.push(line);
      },
    };
    await derive(context);
    if (derived.length > 0) {
      deps.audit.recordEvent(
        OPERATIONS_EVENT_TYPES.workDerived,
        { jobKind, cycle: payload.cycle, derived },
        OPERATIONS_EVENT_OWNER,
        job.id,
      );
    } else {
      deps.audit.recordEvent(OPERATIONS_EVENT_TYPES.noWork, { jobKind, cycle: payload.cycle }, OPERATIONS_EVENT_OWNER, job.id);
    }
    deps.audit.recordEvent(
      OPERATIONS_EVENT_TYPES.jobCompleted,
      {
        jobKind,
        cycle: payload.cycle,
        derivedCount: derived.length,
        submissions: submissions.length,
        createdCount: submissions.filter((outcome) => outcome.created).length,
        replayedCount: submissions.filter((outcome) => outcome.replayed).length,
        refusedCount: submissions.filter((outcome) => !outcome.ok).length,
        unknownHeldCount: unknownHeld.length,
      },
      OPERATIONS_EVENT_OWNER,
      job.id,
    );
  };
}

export type { DurableJob, DurableJobHandler };
