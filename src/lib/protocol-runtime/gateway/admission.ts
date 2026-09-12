/**
 * RTN-010 — Protocol gateway: command admission, idempotent receipts, and
 * the durable submission path.
 *
 * THE GATEWAY is the in-process, sole admission point for protocol commands
 * (spec/deployment/topology.md line 231: "There is exactly one
 * protocol-command admission point (protocol-gateway)"; deploy/contracts/
 * components.json: "the sole admission point for protocol commands"). One
 * method admits commands: submitCommand. Its pipeline, in order:
 *
 *   1. submission shape       — a plain object with an attributable
 *                               authority slot (fail-closed TypeError when
 *                               unattributable — see gateway/evidence.ts);
 *   2. kernel envelope        — validateCommandEnvelope against the
 *                               gateway's authority vocabulary (typed
 *                               ENVELOPE_INVALID rejection + evidence);
 *   3. authority registry     — the authority must host a gateway command
 *                               surface (AUTHORITY_UNKNOWN + evidence);
 *   4. command kind           — the kind must be one of the authority's
 *                               registered kinds (COMMAND_KIND_UNKNOWN +
 *                               evidence);
 *   5. body schema            — the owning authority's command schema
 *                               (COMMAND_BODY_INVALID + evidence);
 *   6. subject binding        — the envelope's subjectIds must match the
 *                               command's declared subjects
 *                               (COMMAND_SUBJECT_INVALID + evidence);
 *   7. idempotent receipt     — a recorded (kind, idempotency key) returns
 *                               the RECORDED receipt verbatim — no second
 *                               enqueue, no second effect (INV-1-3);
 *   8. durable submission     — commandEnvelopeToEnqueueInput maps the
 *                               envelope 1:1 onto the DEP-003 enqueue
 *                               contract; the queue's UNIQUE
 *                               (idempotency_key, kind) is the durable
 *                               dedupe backstop (a gateway restart between
 *                               two same-key submissions yields created:
 *                               false and a DUPLICATE-outcome receipt).
 *
 * NO FINANCIAL EFFECT OCCURS AT ADMISSION: the gateway validates and
 * enqueues; it never calls an authority command method, never executes a
 * transition, and never mutates authoritative state (RTN-010.md line 14:
 * "effects occur only via the transition path"; single-writer violation is
 * a stop condition — the transition path is RTN-011's owned surface).
 *
 * Spec sources (binding):
 *   spec/deployment/topology.md lines 229-233 (exactly one admission
 *     point; the durable command path; the single-writer rule);
 *   deploy/contracts/components.json protocol-gateway ("the sole admission
 *     point for protocol commands"; health: "Readiness endpoint; command
 *     acceptance rate and latency; durable-queue submit success");
 *   spec/protocol-runtime-work-orders/RTN-010.md lines 10, 14-16;
 *   spec/architecture/v0.1/core.md §1 lines 43-44, 57-62 (IntentReceipt,
 *     INV-1-2/INV-1-3 — generalized to every command);
 *   spec/durable/execution.md §6 lines 125-133 (the enqueue dedupe
 *     contract the kernel envelope maps onto);
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 lines 26-32,
 *     62-64 (the rejection record and the failed-write-fails-the-operation
 *     discipline).
 */

import { commandEnvelopeToEnqueueInput, validateCommandEnvelope } from '../kernel/envelope.ts';
import type { CommandEnvelope } from '../kernel/envelope.ts';
import type { EvidenceSubmission } from '../kernel/ports.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type { DurableQueue } from '../../durable/queue.ts';
import { EVIDENCE_AUTHORITIES } from '../evidence/record.ts';
import { commandRejectedEvidence, resolveEvidenceAuthority, submitGatewayEvidence } from './evidence.ts';
import {
  GATEWAY_COMMAND_AUTHORITIES,
  GATEWAY_ENVELOPE_AUTHORITIES,
  GATEWAY_EVIDENCE_AUTHORITY_BY_ENVELOPE,
  findAuthorityCommands,
  findCommandSpec,
} from './registry.ts';
import { commandReceipt } from './receipts.ts';
import type { CommandReceipt } from './receipts.ts';
import type { GatewayAdmissionReasonCode } from './reason-codes.ts';
import { validateCommandBody } from './schema.ts';
import type { FieldProblem } from './schema.ts';

/**
 * The envelope authority vocabulary: the registry's authority-name
 * projection (EVIDENCE_AUTHORITIES) unioned with the merged modules'
 * exported command-authority ids — every authority name a command envelope
 * may carry through envelope validation. (Step (1) has already failed
 * closed on any name outside BOTH sets, so this list is the attribution-
 * safe vocabulary by construction.)
 *
 * Source: kernel/envelope.ts (the authority-name enumeration belongs to
 * the registry projection); evidence/record.ts EVIDENCE_AUTHORITIES;
 * gateway/registry.ts GATEWAY_ENVELOPE_AUTHORITIES.
 */
const ENVELOPE_ALLOWED_AUTHORITIES: readonly string[] = Object.freeze([
  ...new Set<string>([...EVIDENCE_AUTHORITIES, ...GATEWAY_ENVELOPE_AUTHORITIES]),
]);

/**
 * The durable-command-path submission port: exactly the enqueue slice of
 * the DEP-003 queue contract the gateway consumes (spec/durable/
 * execution.md §6: "enqueue(kind, payload, { idempotencyKey, ... })" with
 * UNIQUE (idempotency_key, kind) dedupe). The real DurableQueue satisfies
 * it through `commandQueuePortFromDurableQueue`; tests bind an in-surface
 * double with identical dedupe semantics.
 *
 * Source: spec/durable/execution.md §6 lines 125-133; spec/deployment/
 * topology.md (the durable command path node).
 */
export interface CommandQueuePort {
  enqueue(
    kind: string,
    payload: unknown,
    options: { readonly idempotencyKey: string },
  ): CommandQueueEnqueueOutcome;
}

/**
 * The enqueue outcome the gateway consumes: whether THIS call created the
 * durable job, the dedupe reason, and the job's id.
 *
 * Source: spec/durable/execution.md §6 lines 125-129 ("exactly ONE row;
 * the second call returns created: false with the existing job").
 */
export interface CommandQueueEnqueueOutcome {
  readonly created: boolean;
  readonly reason: 'enqueued' | 'deduplicated';
  readonly jobId: string;
}

/**
 * Bind the REAL DEP-003 DurableQueue as the gateway's command queue port
 * (the read-only integration: the substrate's public enqueue API; nothing
 * in src/lib/durable/ is modified). The adapter is a thin projection —
 * kind, payload, and idempotency key pass through unchanged.
 *
 * Source: spec/protocol-runtime-work-orders/README.md (shared forbidden
 * surfaces: "src/lib/durable/ (read-only integration: import + register()/
 * db API)"); spec/durable/execution.md §6.
 */
export function commandQueuePortFromDurableQueue(queue: DurableQueue): CommandQueuePort {
  return {
    enqueue: (kind, payload, options) => {
      const result = queue.enqueue(kind, payload, { idempotencyKey: options.idempotencyKey });
      return { created: result.created, reason: result.reason, jobId: result.job.id };
    },
  };
}

/**
 * The admission result: the accepted arm (the receipt plus admission
 * metadata) or the typed refusal (a deterministic admission reason code
 * and problem). Refusals NEVER produce a receipt — they produce exactly
 * one rejection evidence record before the refusal is returned.
 *
 * Source: RTN-010.md lines 14-16; core.md lines 43-44, 60-62.
 */
export type CommandAdmissionResult =
  | {
      readonly ok: true;
      /** true when this submission replayed a recorded key or was absorbed by the queue's dedupe (never a second effect). */
      readonly replayed: boolean;
      /** true when this submission created the durable job (the first admission for the key). */
      readonly created: boolean;
      readonly receipt: CommandReceipt;
      /** The durable job id the command was submitted onto (the durable command path position). */
      readonly jobId: string;
    }
  | {
      readonly ok: false;
      readonly reasonCode: GatewayAdmissionReasonCode;
      readonly problem: string;
      /** The failing field path when the refusal is a body or subject violation. */
      readonly field?: string;
    };

/**
 * The gateway's constructor dependencies.
 *
 * Source: RTN-010.md line 10 (the durable submission path and the evidence
 * port); the merged wallClock-injection convention for deterministic tests.
 */
export interface ProtocolGatewayDeps {
  /** The EvidenceSubmission port — the REAL RTN-002 EvidenceLog (rejection evidence). */
  readonly evidence: EvidenceSubmission;
  /** The durable-command-path submission port (bind the real queue via commandQueuePortFromDurableQueue). */
  readonly queue: CommandQueuePort;
  /** Injectable wall clock (epoch ms) for deterministic tests; default Date.now. */
  readonly wallClock?: () => number;
}

/**
 * The health snapshot — the programmatic form of the components.json
 * protocol-gateway health signal ("Readiness endpoint; command acceptance
 * rate and latency; durable-queue submit success"). HTTP binding is
 * deployment work (DEP-002+); these functions are the contract.
 *
 * Source: deploy/contracts/components.json protocol-gateway health_signal.
 */
export interface GatewayHealthSnapshot {
  /** Readiness: the gateway is constructed with validated ports and is admitting commands. */
  readonly ready: boolean;
  /** Total submitCommand calls that completed with a typed result (accepted or rejected). */
  readonly commandsTotal: number;
  /** First-admission acceptances (created the durable job). */
  readonly commandsAdmitted: number;
  /** Idempotent replays (returned a recorded receipt; no second effect). */
  readonly commandsReplayed: number;
  /** Typed refusals (each recorded as rejection evidence). */
  readonly commandsRejected: number;
  /** Refusals per admission reason code. */
  readonly rejectionCounts: Readonly<Record<string, number>>;
  /** submitCommand calls that threw (unattributable submissions; failed evidence writes; failed enqueues). */
  readonly invalidSubmissions: number;
  /** Accepted (admitted + replayed) / commandsTotal; 1 when no command has completed yet (nothing has been refused). */
  readonly commandAcceptanceRate: number;
  /** Completed submitCommand calls measured for latency. */
  readonly latencySamples: number;
  /** Mean admission latency (ms) across measured completions; 0 when none. */
  readonly meanAdmissionLatencyMs: number;
  /** The most recent completed submitCommand's latency (ms); null when none. */
  readonly lastAdmissionLatencyMs: number | null;
  /** Durable enqueue attempts (first admissions only — replays never enqueue). */
  readonly queueSubmits: number;
  /** Durable enqueue attempts that did not throw. */
  readonly queueSubmitSuccesses: number;
  /** The most recent enqueue outcome; null before the first attempt. */
  readonly lastQueueSubmitSuccess: boolean | null;
  /** Successful enqueues / enqueue attempts; 1 when none yet (no failure observed). */
  readonly queueSubmitSuccessRate: number;
}

/**
 * The Protocol Gateway: the sole admission point for protocol commands.
 * In-process, single-instance-per-composition-root; state = the recorded
 * receipts (the generalized IntentReceipt store) and the health counters.
 * The durable backstop for receipts across process restarts is the queue's
 * own UNIQUE (idempotency_key, kind) row plus the per-domain receipt store
 * (gateway/persistence.ts, composed by the deployment root — the merged
 * authorities' in-memory-plus-persistence split).
 *
 * Source: topology.md line 231; RTN-010.md lines 10, 14-16.
 */
export class ProtocolGateway {
  readonly #evidence: EvidenceSubmission;
  readonly #queue: CommandQueuePort;
  readonly #wallClock: () => number;
  readonly #receipts = new Map<string, CommandReceipt>();
  readonly #jobIds = new Map<string, string>();
  #sequence = 0;

  // Health counters (the components.json health signal, programmatic).
  #commandsTotal = 0;
  #commandsAdmitted = 0;
  #commandsReplayed = 0;
  #commandsRejected = 0;
  #rejectionCounts: Record<string, number> = {};
  #invalidSubmissions = 0;
  #latencySamples = 0;
  #latencyTotalMs = 0;
  #lastLatencyMs: number | null = null;
  #queueSubmits = 0;
  #queueSubmitSuccesses = 0;
  #lastQueueSubmitSuccess: boolean | null = null;

  constructor(deps: ProtocolGatewayDeps) {
    if (
      deps.evidence === null ||
      typeof deps.evidence !== 'object' ||
      typeof deps.evidence.submit !== 'function'
    ) {
      throw new TypeError('protocol gateway: deps.evidence must be an EvidenceSubmission port');
    }
    if (deps.queue === null || typeof deps.queue !== 'object' || typeof deps.queue.enqueue !== 'function') {
      throw new TypeError('protocol gateway: deps.queue must be a CommandQueuePort (see commandQueuePortFromDurableQueue)');
    }
    if (deps.wallClock !== undefined && typeof deps.wallClock !== 'function') {
      throw new TypeError('protocol gateway: deps.wallClock must be a function when present');
    }
    this.#evidence = deps.evidence;
    this.#queue = deps.queue;
    this.#wallClock = deps.wallClock ?? (() => Date.now());
  }

  /**
   * THE admission method — the only way other code submits protocol
   * commands (the module boundary contract; gateway/index.ts). Validates
   * the command against the owning authority's schema, records the
   * idempotent receipt, and submits onto the durable command path. NO
   * financial effect occurs here — effects occur only via the transition
   * path that later consumes the durable job.
   *
   * Deterministic rejections carry admission reason codes; every typed
   * refusal writes exactly one rejection evidence record to the real A15
   * log BEFORE the refusal is returned. Unattributable submissions
   * (authority slot absent/garbage/naming no registry authority) throw a
   * TypeError — returning an unrecorded typed refusal would bypass
   * evidence (RTN-010.md stop condition). A failed enqueue also fails the
   * whole operation (thrown; nothing recorded; same-key retry is safe —
   * the queue dedupes).
   *
   * Source: RTN-010.md lines 10, 14-16; INV-1-2/INV-1-3 (core.md lines
   * 57-62); spec/durable/execution.md §6.
   */
  async submitCommand(submission: unknown): Promise<CommandAdmissionResult> {
    const startWallMs = this.#wallClock();
    const complete = (result: CommandAdmissionResult): CommandAdmissionResult => {
      this.#recordLatency(startWallMs);
      if (result.ok) {
        this.#commandsTotal += 1;
        if (result.replayed) {
          this.#commandsReplayed += 1;
        } else {
          this.#commandsAdmitted += 1;
        }
      } else {
        this.#commandsTotal += 1;
        this.#commandsRejected += 1;
        this.#rejectionCounts[result.reasonCode] = (this.#rejectionCounts[result.reasonCode] ?? 0) + 1;
      }
      return result;
    };
    const failInvalid = (error: unknown): never => {
      this.#invalidSubmissions += 1;
      throw error;
    };

    // (1) Submission shape + attributable authority (fail-closed).
    if (typeof submission !== 'object' || submission === null || Array.isArray(submission)) {
      return failInvalid(
        new TypeError('protocol gateway: submission must be a command envelope object (kernel CommandEnvelope shape)'),
      );
    }
    const rawAuthority = (submission as Record<string, unknown>).authority;
    const evidenceAuthority = resolveEvidenceAuthority(
      rawAuthority,
      GATEWAY_ENVELOPE_AUTHORITIES,
      GATEWAY_EVIDENCE_AUTHORITY_BY_ENVELOPE,
    );
    if (evidenceAuthority === undefined) {
      return failInvalid(
        new TypeError(
          `protocol gateway: submission.authority ${JSON.stringify(
            typeof rawAuthority === 'string' ? rawAuthority : rawAuthority,
          )} names no registry authority, so the refusal cannot be recorded without fabricating one — ` +
            'the authority slot must name a protocol authority (spec/registry/protocol-registry.json; rtn-plan-rulings.md Q4)',
        ),
      );
    }

    // (2) Kernel envelope validation against the FULL authority-name
    // vocabulary: the registry's authority-name projection
    // (EVIDENCE_AUTHORITIES — the kernel envelope's own doc: "the
    // authority-name enumeration belongs to the registry projection and its
    // consumers (RTN-002 binds evidence authority names; RTN-010 validates
    // per-command per owning authority)") UNION the merged modules'
    // exported command-authority ids (which include the rails module's
    // 'Rail Adapter Authority' label alongside the registry's 'Rail
    // Authority' name). Real registry authorities without a gateway command
    // surface (area 17-24 wave 2, the Evidence Authority) pass the envelope
    // check and are refused at step (3) with the precise AUTHORITY_UNKNOWN
    // code.
    const envelopeValidation = validateCommandEnvelope(submission, {
      allowedAuthorities: ENVELOPE_ALLOWED_AUTHORITIES,
    });
    if (!envelopeValidation.ok) {
      return complete(
        await this.#reject(submission, evidenceAuthority, 'ENVELOPE_INVALID', {
          problem: `command envelope field ${envelopeValidation.field}: ${envelopeValidation.problem}`,
          field: envelopeValidation.field,
        }),
      );
    }
    const envelope: CommandEnvelope = envelopeValidation.envelope;

    // (3) The authority must host a gateway command surface.
    const authorityEntry = findAuthorityCommands(envelope.authority);
    if (authorityEntry === undefined) {
      return complete(
        await this.#reject(submission, evidenceAuthority, 'AUTHORITY_UNKNOWN', {
          problem:
            `authority ${JSON.stringify(envelope.authority)} hosts no gateway command surface in this runtime ` +
            '(the merged command authorities are the operational spine A01-A14 and A16; the Evidence Authority is a ' +
            'writers-by-submission log, and areas A17-A24 are RTN wave 2)',
        }),
      );
    }

    // (4) The kind must be one of the authority's registered command kinds.
    const found = findCommandSpec(envelope.authority, envelope.kind);
    if (found === undefined) {
      const known = authorityEntry.commands.map((command) => command.kind).sort();
      return complete(
        await this.#reject(submission, authorityEntry.evidenceAuthority, 'COMMAND_KIND_UNKNOWN', {
          problem:
            `command kind ${JSON.stringify(envelope.kind)} is not registered for authority ` +
            `${JSON.stringify(envelope.authority)} (registered kinds: ${known.join(', ')})`,
        }),
      );
    }
    const { spec } = found;

    // (5) The body must satisfy the owning authority's command schema.
    const bodyValidation = validateCommandBody(envelope.body, spec.fields, spec.invariants ?? []);
    if (!bodyValidation.ok) {
      const field = bodyValidation.field.length === 0 ? undefined : bodyValidation.field;
      return complete(
        await this.#reject(submission, authorityEntry.evidenceAuthority, 'COMMAND_BODY_INVALID', {
          problem:
            `body field ${bodyValidation.field.length === 0 ? '(root)' : bodyValidation.field}: ` +
            `${bodyValidation.problem} (owning authority: ${JSON.stringify(spec.authority)}, command kind: ${JSON.stringify(spec.kind)})`,
          field,
        }),
      );
    }

    // (6) The envelope's subjectIds must match the command's declared subjects.
    const subjectResolution = spec.subjects(bodyValidation.body);
    if (!subjectResolution.ok) {
      return complete(
        await this.#reject(submission, authorityEntry.evidenceAuthority, 'COMMAND_SUBJECT_INVALID', {
          problem: `body field ${subjectResolution.path}: ${subjectResolution.problem}`,
          field: subjectResolution.path,
        }),
      );
    }
    const subjects = subjectResolution.subjectIds;
    if (
      envelope.subjectIds.length !== subjects.length ||
      envelope.subjectIds.some((subjectId, index) => subjectId !== subjects[index])
    ) {
      return complete(
        await this.#reject(submission, authorityEntry.evidenceAuthority, 'COMMAND_SUBJECT_INVALID', {
          problem:
            `subjectIds must be the command's declared subjects [${subjects.join(', ')}] ` +
            `(got [${envelope.subjectIds.join(', ')}] for kind ${JSON.stringify(spec.kind)})`,
        }),
      );
    }

    // (7) Idempotent receipt: a recorded (kind, key) returns the RECORDED
    // receipt verbatim — no second enqueue, no second effect (INV-1-3).
    const receiptKey = `${envelope.kind} ${envelope.idempotencyKey}`;
    const recorded = this.#receipts.get(receiptKey);
    if (recorded !== undefined) {
      const jobId = this.#jobIds.get(receiptKey);
      if (jobId === undefined) {
        // Internal consistency: a receipt without its durable job id.
        return failInvalid(
          new TypeError(
            `protocol gateway: recorded key ${JSON.stringify(envelope.idempotencyKey)} for kind ` +
              `${JSON.stringify(envelope.kind)} has no recorded durable job id (internal consistency)`,
          ),
        );
      }
      return complete({
        ok: true,
        replayed: true,
        created: false,
        receipt: recorded,
        jobId,
      });
    }

    // (8) Durable submission: the kernel envelope maps 1:1 onto the DEP-003
    // enqueue contract (kind ↔ kind, envelope ↔ payload, key ↔ key).
    const enqueueInput = commandEnvelopeToEnqueueInput(envelope);
    let outcome: CommandQueueEnqueueOutcome;
    this.#queueSubmits += 1;
    try {
      outcome = this.#queue.enqueue(enqueueInput.kind, enqueueInput.payload, {
        idempotencyKey: enqueueInput.idempotencyKey,
      });
    } catch (error) {
      this.#lastQueueSubmitSuccess = false;
      this.#invalidSubmissions += 1;
      this.#recordLatency(startWallMs);
      // A failed enqueue fails the whole admission operation: no receipt is
      // recorded, nothing is returned, and the same-key retry is safe (the
      // queue dedupes on UNIQUE (idempotency_key, kind)).
      throw error;
    }
    this.#queueSubmitSuccesses += 1;
    this.#lastQueueSubmitSuccess = true;

    // (9) Record the receipt (first admission, or a DUPLICATE when the
    // queue absorbed this submission after a gateway receipt-memory loss).
    const when = this.nextProtocolTime();
    const receipt = commandReceipt({
      kind: envelope.kind,
      idempotencyKey: envelope.idempotencyKey,
      state: 'ADMITTED',
      outcome: outcome.created ? 'ADMITTED' : 'DUPLICATE',
      recordedAt: when,
    });
    this.#receipts.set(receiptKey, receipt);
    this.#jobIds.set(receiptKey, outcome.jobId);
    return complete({
      ok: true,
      replayed: !outcome.created,
      created: outcome.created,
      receipt,
      jobId: outcome.jobId,
    });
  }

  /**
   * The recorded receipt for one (kind, idempotency key) pair, if any —
   * INV-1-3's lookup.
   *
   * Source: core.md lines 60-62 ("re-submission with a recorded
   * idempotency key returns the recorded receipt").
   */
  getReceipt(kind: string, idempotencyKey: string): CommandReceipt | undefined {
    return this.#receipts.get(`${kind} ${idempotencyKey}`);
  }

  /**
   * Readiness: the gateway is constructed with validated ports and is
   * admitting commands. (The HTTP readiness endpoint is deployment work —
   * DEP-002+; this function is the programmatic contract.)
   *
   * Source: deploy/contracts/components.json protocol-gateway health_signal
   * ("Readiness endpoint; ..."); RTN-010.md line 10 ("exposed as
   * programmatic health functions; HTTP binding is deployment work").
   */
  isReady(): boolean {
    return true;
  }

  /**
   * The health snapshot: command acceptance rate and latency, and
   * durable-queue submit success (the components.json health signal).
   *
   * Source: deploy/contracts/components.json protocol-gateway health_signal.
   */
  health(): GatewayHealthSnapshot {
    const accepted = this.#commandsAdmitted + this.#commandsReplayed;
    return {
      ready: this.isReady(),
      commandsTotal: this.#commandsTotal,
      commandsAdmitted: this.#commandsAdmitted,
      commandsReplayed: this.#commandsReplayed,
      commandsRejected: this.#commandsRejected,
      rejectionCounts: Object.freeze({ ...this.#rejectionCounts }),
      invalidSubmissions: this.#invalidSubmissions,
      commandAcceptanceRate: this.#commandsTotal === 0 ? 1 : accepted / this.#commandsTotal,
      latencySamples: this.#latencySamples,
      meanAdmissionLatencyMs: this.#latencySamples === 0 ? 0 : this.#latencyTotalMs / this.#latencySamples,
      lastAdmissionLatencyMs: this.#lastLatencyMs,
      queueSubmits: this.#queueSubmits,
      queueSubmitSuccesses: this.#queueSubmitSuccesses,
      lastQueueSubmitSuccess: this.#lastQueueSubmitSuccess,
      queueSubmitSuccessRate: this.#queueSubmits === 0 ? 1 : this.#queueSubmitSuccesses / this.#queueSubmits,
    };
  }

  /**
   * The gateway's protocol time for receipts and rejection records: a
   * self-sequenced protocol time over the injected wall clock (the
   * authorities' convention — no internal clock, GC-1 determinism).
   *
   * Source: kernel/time.ts protocolTime; the merged authority convention.
   */
  nextProtocolTime(): ProtocolTime {
    const when = protocolTime(this.#sequence, this.#wallClock());
    this.#sequence += 1;
    return when;
  }

  /**
   * Write one rejection evidence record to the REAL A15 log and return the
   * typed refusal. Submit-then-return: a failed write fails the admission
   * operation (A15 lines 62-64) — the refusal is never delivered without
   * its record.
   *
   * Source: RTN-010.md line 16; A15 lines 26-32, 62-64; GC-5.
   */
  async #reject(
    submission: unknown,
    evidenceAuthority: string,
    reasonCode: GatewayAdmissionReasonCode,
    detail: { readonly problem: string; readonly field?: string },
  ): Promise<CommandAdmissionResult> {
    const record = commandRejectedEvidence({
      submission,
      evidenceAuthority,
      reasonCode,
      when: this.nextProtocolTime(),
    });
    await submitGatewayEvidence(this.#evidence, record);
    return {
      ok: false,
      reasonCode,
      problem: detail.problem,
      ...(detail.field === undefined ? {} : { field: detail.field }),
    };
  }

  #recordLatency(startWallMs: number): void {
    const endWallMs = this.#wallClock();
    const elapsed = Math.max(0, endWallMs - startWallMs);
    this.#latencySamples += 1;
    this.#latencyTotalMs += elapsed;
    this.#lastLatencyMs = elapsed;
  }
}
