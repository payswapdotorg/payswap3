/**
 * RTN-011 — Transition runtime: the command execution path.
 *
 * The transition-runtime component's in-process form — THE single
 * authoritative-state writer (spec/deployment/topology.md, line 148:
 * "Authority hosted: authoritative state transitions — execution,
 * clearing, obligations, netting, settlement, finality (protocol-owned) —
 * applied as the single writer to authoritative-state-store").
 *
 * The execution path, per the work order's acceptance (RTN-011.md line
 * 14), is EXACTLY:
 *
 *   dequeue a command
 *     → resolve the owning authority handler
 *     → apply the transition
 *     → write the A15 evidence record
 *     → commit state atomically
 *
 * where "dequeue" is performed by the substrate's worker (it reserves a
 * job and dispatches it to the REGISTERED handler — spec/durable/
 * execution.md §9: "register(kind, handler) is the ONLY integration
 * point"), and this module's executor is that registered handler:
 *
 *   1. dequeue          — the substrate worker reserves the job and calls
 *                         the registered executor (TransitionRuntime.
 *                         executeCommand) with the DurableJob;
 *   2. resolve          — validate the job payload as a kernel CommandEnvelope
 *                         (the payload contract of the durable command path)
 *                         and resolve the owning authority handler by kind,
 *                         cross-checking the envelope's authority target;
 *   3. apply + evidence — the binding's execute() calls the owning
 *                         authority's command. Every merged authority
 *                         implements the A15 synchronous coupling
 *                         internally — "an operation is not committed
 *                         until its record is written. A failed write
 *                         fails the operation" (evidence-risk-compliance.md
 *                         lines 62-64) — so the A15 record is written
 *                         BEFORE the authority's in-memory state mutates,
 *                         and any write failure throws out of the command
 *                         with ZERO state effect;
 *   4. commit           — the binding's durable write-through (per-domain
 *                         idempotent bridges: INSERT ... ON CONFLICT DO
 *                         NOTHING / UPDATE-state statements) lands AFTER
 *                         the evidence record, so an induced evidence
 *                         failure leaves NOTHING committed — the
 *                         transition is rolled back;
 *   5. observe          — one durable_events row is recorded through the
 *                         substrate's recordEvent(type, data, owner) under
 *                         the OWNING AUTHORITY'S owner identity (the
 *                         documented integration point: "Future protocol
 *                         authorities plug in via register() and own their
 *                         own evidence via recordEvent(type, data, owner)"
 *                         — src/lib/durable/index.ts lines 17-18).
 *
 * Failure semantics (RTN-011.md line 14: "failure fails the operation"):
 *   - ANY exception on the path (induced evidence-write failure, persist
 *     failure, authority TypeError) propagates out of executeCommand, so
 *     the substrate worker reports a failed attempt (deterministic bounded
 *     backoff, at-least-once redelivery — execution.md §7/§8). The
 *     operation is NOT committed: no A15 record escaped, no state row
 *     persisted, no observation row recorded.
 *   - A typed protocol REJECTION (the merged authorities' {ok:false, code}
 *     convention — deterministic protocol decisions) is a COMPLETED
 *     execution, not a failure: the command was delivered, evaluated, and
 *     refused; retrying a deterministic rejection would only burn
 *     attempts. The job completes and the rejection is observable in the
 *     authority-owned observation row (status 'rejected').
 *
 * At-least-once redelivery safety (RTN-011.md line 16: "handlers are
 * idempotent via each area's INV-x-3 key discipline (duplicate delivery
 * returns recorded state, never a second effect)"): the substrate
 * redelivers at-least-once (lease expiry → reclaimExpired, attempts+1,
 * bounded); the owning authority's INV-x-3 keys deduplicate the
 * re-execution — duplicate delivery returns the recorded state
 * (replayed:true / duplicate:true / applied:false — the merged result
 * shapes), never a second effect, and never a second A15 record
 * (duplicate no-ops emit no evidence — each area's named evidence set is
 * exhaustive). The executor maps those shapes onto the 'replayed'
 * observation status so a redelivered command's observation row states
 * exactly what happened.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   62-64: "Evidence writing is internal and synchronous with the
 *   operation it records: an operation is not committed until its record
 *   is written. A failed write fails the operation."
 *   spec/deployment/topology.md lines 146-150 (transition-runtime:
 *   "applied as the single writer to authoritative-state-store"; health
 *   signal "transition backlog depth/age; authoritative-state consistency
 *   probes"); line 188 ("mutated only by transition-runtime through
 *   protocol-owned transitions — no other layer may mutate it directly").
 *   spec/durable/execution.md §9 (register is the only integration point);
 *   §7 (reservation/lease/redelivery: "at-least-once execution per job +
 *   idempotent handlers under the job's idempotency key = effectively-once
 *   side effects").
 *   src/lib/protocol-runtime/kernel/envelope.ts (the CommandEnvelope
 *   payload contract; validateCommandEnvelope; the kind ↔ durable_jobs.kind
 *   1:1 mapping).
 *   rtn-plan-rulings.md delta 5 (the re-scope: commands are enqueued by
 *   this item's own test harness through the substrate's PUBLIC enqueue
 *   API; production admission remains exclusively RTN-010's gateway).
 */

import { validateCommandEnvelope } from '../kernel/envelope.ts';
import type {
  CommandEnvelope,
  CommandKind,
  ProtocolAuthorityId,
} from '../kernel/envelope.ts';
import type { DurableJob } from '../../durable/queue.ts';
import type { TransitionSubstrate } from './substrate-port.ts';

/**
 * The durable_events type of the authority-owned observation row the
 * executor records for every COMPLETED command execution (applied,
 * replayed, or rejected). The row's OWNER is the owning authority's
 * registry name — the documented integration point ("own their own
 * evidence via recordEvent(type, data, owner)").
 *
 * Source: src/lib/durable/index.ts lines 17-18 (quoted above);
 * spec/durable/execution.md §11 lines 212-218 ("Protocol evidence remains
 * owned by future protocol authorities: they record their own rows under
 * their own owner identity via the same table and API").
 */
export const COMMAND_EXECUTED_EVENT_TYPE = 'protocol.command.executed';

/**
 * The execution status of one completed command: 'applied' (the
 * transition executed and committed), 'replayed' (duplicate delivery —
 * the authority returned the recorded state, no second effect), or
 * 'rejected' (a typed protocol rejection — a deterministic refusal, no
 * state effect).
 *
 * Source: RTN-011.md line 16 — "duplicate delivery returns recorded
 * state, never a second effect"; the merged authorities' typed-result
 * convention ({ok:false, code} rejections emit no evidence).
 */
export type AuthorityCommandExecutionStatus = 'applied' | 'replayed' | 'rejected';

/**
 * The outcome of one authority command execution as reported by a
 * binding: the execution status, the typed rejection code when refused,
 * and a small JSON-safe summary recorded in the observation row.
 *
 * Source: RTN-011.md lines 14-16 (the execution path + idempotency
 * contract the binding implements).
 */
export interface AuthorityCommandOutcome {
  readonly status: AuthorityCommandExecutionStatus;
  readonly code?: string;
  readonly summary?: Readonly<Record<string, unknown>>;
}

/**
 * One authority command binding: the hosted authority's execution of one
 * command kind. `execute` MUST preserve the merged authorities' atomic
 * discipline — the A15 record written before the in-memory mutation
 * (inside the authority's command), the durable write-through AFTER —
 * so an exception anywhere leaves the operation uncommitted.
 *
 * `owner` is the authority's registry evidence-authority name (e.g.
 * 'Intent Authority'): the observation row recorded through
 * recordEvent(type, data, owner) is owned by the authority, per the
 * documented integration point.
 *
 * Source: src/lib/durable/index.ts lines 14-18; RTN-011.md line 14
 * (the dequeue → resolve → apply → evidence → commit path).
 */
export interface AuthorityCommandBinding {
  /** The command kind — maps 1:1 onto durable_jobs.kind (kernel contract). */
  readonly kind: CommandKind;
  /** The owning authority's registry name (the envelope's authority target). */
  readonly authority: ProtocolAuthorityId;
  /** The owner identity for the authority-owned observation rows. */
  readonly owner: string;
  /**
   * Apply the transition: call the owning authority's command (A15
   * evidence write happens inside, before the authority's state
   * mutation), then perform the durable write-through. MUST throw on any
   * failure so the substrate fails the operation (bounded backoff,
   * at-least-once redelivery).
   */
  execute(envelope: CommandEnvelope, job: DurableJob): Promise<AuthorityCommandOutcome>;
}

/**
 * The transition runtime: the single authoritative-state writer's
 * command execution path, hosted on the substrate via register().
 *
 * Construction wires NOTHING into the substrate; call registerAll() (or
 * register each binding's kind) to plug the executor in at the
 * documented integration point.
 *
 * Source: RTN-011.md lines 14-20 (the acceptance path); spec/deployment/
 * topology.md lines 146-150 ("the single writer to
 * authoritative-state-store").
 */
export class TransitionRuntime {
  readonly #substrate: TransitionSubstrate;
  readonly #bindings: ReadonlyMap<CommandKind, AuthorityCommandBinding>;
  readonly #authorities: ReadonlySet<ProtocolAuthorityId>;

  constructor(deps: {
    /** The substrate's public API (register/enqueue/recordEvent). */
    readonly substrate: TransitionSubstrate;
    /** The hosted authority command bindings (one per command kind). */
    readonly bindings: readonly AuthorityCommandBinding[];
  }) {
    if (!deps.substrate) {
      throw new TypeError('TransitionRuntime requires a TransitionSubstrate');
    }
    const bindings = new Map<CommandKind, AuthorityCommandBinding>();
    const authorities = new Set<ProtocolAuthorityId>();
    for (const binding of deps.bindings) {
      if (typeof binding.kind !== 'string' || binding.kind.length === 0) {
        throw new TypeError('TransitionRuntime: every binding needs a non-empty kind');
      }
      if (typeof binding.authority !== 'string' || binding.authority.length === 0) {
        throw new TypeError('TransitionRuntime: every binding needs a non-empty authority');
      }
      if (typeof binding.owner !== 'string' || binding.owner.length === 0) {
        throw new TypeError(
          'TransitionRuntime: every binding needs a non-empty owner (evidence ownership is mandatory)',
        );
      }
      if (typeof binding.execute !== 'function') {
        throw new TypeError('TransitionRuntime: every binding needs an execute function');
      }
      if (bindings.has(binding.kind)) {
        throw new TypeError(`TransitionRuntime: duplicate binding for kind ${binding.kind}`);
      }
      bindings.set(binding.kind, binding);
      authorities.add(binding.authority);
    }
    this.#substrate = deps.substrate;
    this.#bindings = bindings;
    this.#authorities = authorities;
  }

  /**
   * Resolve the owning authority handler for a command kind — the
   * "resolve the owning authority handler" step of the acceptance path.
   * A kind with no binding resolves to undefined (the substrate's own
   * semantics keep such jobs queued: the worker only reserves registered
   * kinds — execution.md §9).
   *
   * Source: RTN-011.md line 14 ("resolve the owning authority handler");
   * spec/durable/execution.md §9 lines 174-179.
   */
  resolveOwningHandler(kind: CommandKind): AuthorityCommandBinding | undefined {
    return this.#bindings.get(kind);
  }

  /** The registered command kinds (hosted authority surface). */
  commandKinds(): readonly CommandKind[] {
    return [...this.#bindings.keys()];
  }

  /**
   * Plug every binding into the substrate at the documented integration
   * point: register(kind, handler). One registration per command kind;
   * the handler is this runtime's executeCommand.
   *
   * Source: src/lib/durable/index.ts lines 14-18 ("register(kind,
   * handler) is the single integration point"); execution.md §9.
   */
  registerAll(): this {
    for (const binding of this.#bindings.values()) {
      this.#substrate.register(binding.kind, (job) => this.executeCommand(job));
    }
    return this;
  }

  /**
   * THE command execution path: the handler body the substrate's worker
   * dispatches to after dequeuing a command.
   *
   * Order of events (each step's failure semantics documented inline):
   *   1. resolve   — validate the payload as a CommandEnvelope and
   *                  resolve the owning binding (kind + authority target).
   *                  A contract violation is a producer bug (in production
   *                  the gateway admits only well-formed commands —
   *                  RTN-010): it THROWS, failing the operation loudly
   *                  for the substrate's bounded-retry/dead-letter
   *                  attention path.
   *   2. apply     — binding.execute(envelope, job): the authority
   *                  command (A15 evidence write BEFORE the in-memory
   *                  mutation — merged INV-x-3 discipline), then the
   *                  durable write-through. Any failure THROWS with zero
   *                  committed effect ("a failed evidence write rolls
   *                  back the transition").
   *   3. observe   — recordEvent(COMMAND_EXECUTED_EVENT_TYPE, {...},
   *                  binding.owner, job.id): the authority-owned
   *                  observation row. A recordEvent failure also THROWS
   *                  (the observation is part of the completed execution;
   *                  at-least-once redelivery re-runs the idempotent path
   *                  — a redelivered execution may therefore append a
   *                  SECOND observation row for the SAME command; the
   *                  observation rows are delivery observations, not the
   *                  authoritative evidence — the A15 record is, and it
   *                  is exactly-once by INV-15-4 write keys).
   *
   * Source: RTN-011.md lines 14-16, 20-22 (the path, the atomicity, the
   * redelivery contract); evidence-risk-compliance.md lines 62-64.
   */
  async executeCommand(job: DurableJob): Promise<void> {
    if (!job || typeof job !== 'object' || typeof job.kind !== 'string') {
      throw new TypeError('executeCommand: requires a substrate job');
    }
    // Step 1 — resolve the owning authority handler.
    const validation = validateCommandEnvelope(job.payload, {
      allowedAuthorities: [...this.#authorities],
    });
    if (!validation.ok) {
      throw new Error(
        `transition-runtime: job ${job.id} payload is not a valid command envelope ` +
          `(${validation.field}: ${validation.problem}) — the durable command path carries ` +
          'kernel CommandEnvelope payloads only',
      );
    }
    const envelope = validation.envelope;
    if (envelope.kind !== job.kind) {
      throw new Error(
        `transition-runtime: job ${job.id} kind ${job.kind} does not match its envelope kind ` +
          `${envelope.kind} (the envelope kind maps 1:1 onto durable_jobs.kind)`,
      );
    }
    const binding = this.resolveOwningHandler(envelope.kind);
    if (!binding) {
      throw new Error(
        `transition-runtime: no authority handler is hosted for command kind ${envelope.kind}`,
      );
    }
    if (binding.authority !== envelope.authority) {
      throw new Error(
        `transition-runtime: command kind ${envelope.kind} is owned by authority ` +
          `${binding.authority}; the envelope targets ${envelope.authority}`,
      );
    }
    // Step 2 — apply the transition + write the A15 evidence record +
    // commit (the binding preserves the authorities' evidence-first
    // atomic discipline; any failure throws with nothing committed).
    const outcome = await binding.execute(envelope, job);
    // Step 3 — the authority-owned observation row (recordEvent(type,
    // data, owner) — the documented integration point).
    this.#substrate.recordEvent(
      COMMAND_EXECUTED_EVENT_TYPE,
      {
        kind: envelope.kind,
        authority: envelope.authority,
        idempotencyKey: envelope.idempotencyKey,
        status: outcome.status,
        ...(outcome.code === undefined ? {} : { code: outcome.code }),
        ...(outcome.summary === undefined ? {} : { summary: outcome.summary }),
      },
      binding.owner,
      job.id,
    );
  }
}

/**
 * Construct a TransitionRuntime over a substrate and a set of authority
 * command bindings (the hosting pattern's composition entry point).
 *
 * Source: RTN-011.md lines 14-20; src/lib/durable/index.ts lines 14-18.
 */
export function createTransitionRuntime(deps: {
  readonly substrate: TransitionSubstrate;
  readonly bindings: readonly AuthorityCommandBinding[];
}): TransitionRuntime {
  return new TransitionRuntime(deps);
}
