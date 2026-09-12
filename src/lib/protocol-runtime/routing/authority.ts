/**
 * RTN-006 — Routing Authority: the composed single-writer command surface
 * for area 4 (A04).
 *
 * Spec sources (binding) — spec/architecture/v0.1/core.md §4 Area 4:
 *   lines 221-230 (RoutePlan object + state machine + RouteCompiler):
 *     "States: COMPILED -> VALIDATED -> DISPATCHED ->
 *      terminal(COMPLETED | FAILED | ABANDONED)."
 *     "RouteCompiler — deterministic function from (intent terms, policy
 *      evaluation, capability snapshot) to either a RoutePlan or a
 *      reason-coded failure (NO_VIABLE_ROUTE). Compiler versions are pinned;
 *      the version id is recorded in every plan."
 *   lines 232-235 (owning authority):
 *     "Routing Authority (protocol layer, area 4) owns compilation and plan
 *      state. Execution of a dispatched plan is owned by areas 5-13."
 *   lines 239-249 (INV-4-1 / INV-4-2 / INV-4-3 — quoted in value.ts,
 *     compiler.ts, and enforced structurally below).
 *   lines 253-259 (failure and UNKNOWN semantics):
 *     "NO_VIABLE_ROUTE is a terminal failure that also emits a demand
 *      signal for area 24. During execution, a hop may return UNKNOWN from
 *      a rail (area 13); the plan then halts at DISPATCHED — it never
 *      re-dispatches hops blindly (GC-2). Recovery proceeds only after
 *      reconciliation (area 14) resolves the UNKNOWN rail operation; the
 *      plan then completes or fails based on the resolved outcome."
 *   lines 263-265 (evidence produced — ROUTE_* through the REAL A15 log).
 *   lines 269-273 (boundaries — "Depends on areas 1-3 for inputs and area 5
 *     for reservation acquisition during dispatch").
 *   spec/architecture/v0.1/README.md §3 GC-1/GC-2/GC-4/GC-5.
 *   spec/registry/protocol-registry.json A04 — owningAuthority:
 *     "Routing Authority".
 *
 * Command discipline (the merged rails/intent convention, adapted to this
 * area):
 *   - Every plan command runs INSIDE the keyed serializer under the PLAN id
 *     — the derived INV-4-3 compilation key (intent id, compiler version,
 *     snapshot id): concurrent compilations of the same key collapse to one
 *     plan ("identical inputs return the identical plan"), and every later
 *     command on the plan is serialized.
 *   - Every consequential operation submits its GC-5 evidence record FIRST
 *     (awaited) and commits its in-memory state only after the write
 *     succeeds: "an operation is not committed until its record is written.
 *     A failed write fails the operation" (A15 lines 62-64).
 *   - Domain rejections are typed values, never thrown; input-shape
 *     violations throw TypeError (kernel convention). Rejections emit NO
 *     evidence: a refused command mutates no state, and A04's named
 *     evidence set is exhaustive.
 *   - Dispatch acquires the plan's reservations through the area-5
 *     ReservationAcquisition port STRICTLY in the plan's fixed hop order
 *     (INV-4-2); an acquisition failure unwinds the already-acquired holds
 *     in reverse hop order (a deterministic unwind — recorded
 *     interpretation) and abandons the plan (ACQUISITION_FAILED): nothing
 *     was dispatched.
 *   - A hop UNKNOWN from a rail HALTS the plan at DISPATCHED
 *     (recordUnknownHop): the state stays DISPATCHED, the annotation is
 *     recorded on the plan, and NO terminal transition is accepted while
 *     any halt is unresolved (UNRESOLVED_UNKNOWN_HOP) — the caller resolves
 *     each halt only after reconciliation (area 14) reports the outcome
 *     (resolveUnknownHop), and only then completes or fails the plan. A
 *     second dispatch of a dispatched plan is unrepresentable (the frozen
 *     transition table has no DISPATCHED successor for DISPATCHED).
 *   - NO_VIABLE_ROUTE is the terminal compilation failure: the authority
 *     writes the ROUTE_FAILED record (reason NO_VIABLE_ROUTE, subjects =
 *     intent + the compilation-attempt key) and ALSO emits the area-24
 *     demand signal — a durable, idempotent record whose emission point is
 *     the ROUTE_FAILED record's derived id. The A24 consumer arrives with
 *     the follow-on wave; the recorded signals are its input.
 *   - Terminal transitions drive the plan's own reservations' terminals
 *     exactly once (complete -> consume in fixed hop order; fail/abandon ->
 *     release what is still HELD): "they are then consumed or released
 *     exactly once (GC-2)" (core.md lines 319-322 — the area 5 UNKNOWN
 *     semantics the plan-side drives). Idempotent replay is safe: duplicate
 *     requests return the recorded state (INV-5-3).
 *
 * State layer (recorded in CONTRACT-REVIEW.md): the authority is an
 * in-process single writer over its own state maps — the RTN-002
 * in-process-object-store precedent (the same split RTN-005 used) — so the
 * full command discipline is exercised under bun test without node:sqlite.
 * The domain's durable side is the per-domain persistence module
 * (persistence.ts + migrations/), composed by the deployment root.
 */

import { deriveProtocolId } from '../kernel/identity.ts';
import type { EvidenceSubmission } from '../kernel/ports.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { evidenceRecordId } from '../evidence/record.ts';
import type { IntentTerms, PolicyEvaluationOutcome } from '../policy/types.ts';
import type { CapabilitySnapshot } from '../capability/types.ts';
import { ROUTE_COMPILER_VERSION, compileRoutePlan } from './compiler.ts';
import type { RoutePlanContent } from './compiler.ts';
import { checkRouteValuePreservation } from './value.ts';
import {
  routeAbandonedEvidence,
  routeCompiledEvidence,
  routeCompletedEvidence,
  routeDispatchedEvidence,
  routeFailedEvidence,
  routeNoViableRouteEvidence,
  routeValidatedEvidence,
  submitRoutingEvidence,
} from './evidence.ts';
import { KeyedSerializer } from './serializer.ts';
import {
  checkRoutePlanReasonCode,
  hasUnresolvedUnknownHop,
  transitionRoutePlan,
} from './state-machine.ts';
import type {
  ConversionQuote,
  HopReservationRef,
  ReservationAcquisition,
  RouteCommandResult,
  RouteCompilationResult,
  RouteDemandSignal,
  RoutePlan,
  RoutePlanReasonCode,
  RoutePlanState,
  UnknownHopRef,
} from './types.ts';

/**
 * Constructor dependencies for the Routing Authority.
 *
 * Source: the wave evidence discipline (evidence through the kernel port —
 * here the REAL RTN-002 log); core.md lines 272-273 (the area 5
 * reservation acquisition dependency); the wallClock-injection convention
 * for deterministic tests.
 */
export interface RoutingAuthorityDeps {
  /** The EvidenceSubmission port — the real RTN-002 EvidenceLog. */
  readonly evidence: EvidenceSubmission;
  /** The area-5 reservation acquisition port (INV-4-2's dispatch step). */
  readonly reservations: ReservationAcquisition;
  /** Injectable wall clock (epoch ms) for deterministic tests; default Date.now. */
  readonly wallClock?: () => number;
}

/**
 * The Routing Authority: sole writer of RoutePlan state. Commands:
 * compileRoute (deterministic, pinned, INV-4-3-keyed; NO_VIABLE_ROUTE ->
 * ROUTE_FAILED + the area-24 demand signal), validatePlan, dispatchPlan
 * (fixed-hop-order reservation acquisition), recordUnknownHop /
 * resolveUnknownHop (the halt-at-DISPATCHED discipline), completePlan,
 * failPlan, abandonPlan. Every state mutation is serialized per plan id and
 * evidenced to the real A15 log before commit.
 *
 * Source: core.md lines 232-235 (owning authority), lines 239-259 (the
 * invariants and failure semantics), lines 263-265 (evidence).
 */
export class RoutingAuthority {
  private readonly evidence: EvidenceSubmission;
  private readonly reservations: ReservationAcquisition;
  private readonly wallClock: () => number;
  private readonly serializer = new KeyedSerializer();
  private readonly plansById = new Map<string, RoutePlan>();
  private readonly planOrder: string[] = [];
  private readonly demandSignalsById = new Map<string, RouteDemandSignal>();
  private readonly demandSignalOrder: string[] = [];
  /** The intent terms each plan was compiled against (validation input). */
  private readonly intentTermsByPlan = new Map<string, IntentTerms>();
  private sequence = 0;

  constructor(deps: RoutingAuthorityDeps) {
    if (
      deps.evidence === null ||
      typeof deps.evidence !== 'object' ||
      typeof deps.evidence.submit !== 'function'
    ) {
      throw new TypeError('routing authority: deps.evidence must be an EvidenceSubmission port');
    }
    if (
      deps.reservations === null ||
      typeof deps.reservations !== 'object' ||
      typeof deps.reservations.request !== 'function' ||
      typeof deps.reservations.consume !== 'function' ||
      typeof deps.reservations.release !== 'function' ||
      typeof deps.reservations.stateOf !== 'function'
    ) {
      throw new TypeError(
        'routing authority: deps.reservations must be the area-5 ReservationAcquisition port',
      );
    }
    this.evidence = deps.evidence;
    this.reservations = deps.reservations;
    this.wallClock = deps.wallClock ?? (() => Date.now());
  }

  private nextTime(): ProtocolTime {
    const when = protocolTime(this.sequence, this.wallClock());
    this.sequence += 1;
    return when;
  }

  // -------------------------------------------------------------------------
  // Compilation (INV-4-3) and the NO_VIABLE_ROUTE demand signal
  // -------------------------------------------------------------------------

  /**
   * Compile a route plan for one intent against one capability snapshot —
   * the deterministic, pinned RouteCompiler (pure), keyed by (intent id,
   * compiler version, snapshot id): a recorded plan is returned verbatim on
   * re-compilation ("identical inputs return the identical plan", INV-4-3).
   *
   * NO_VIABLE_ROUTE is the terminal failure: the authority writes the
   * ROUTE_FAILED record (reason NO_VIABLE_ROUTE; subjects: intent id + the
   * compilation-attempt key) and emits the area-24 demand signal with the
   * emission point recorded (the ROUTE_FAILED record's derived id). The
   * signal is idempotent per compilation key.
   *
   * Source: core.md lines 227-230 (RouteCompiler), 253-254 (NO_VIABLE_ROUTE
   * + demand signal), 248-249 (INV-4-3); GC-5.
   */
  async compileRoute(input: {
    readonly intentId: string;
    readonly intentTerms: IntentTerms;
    readonly policyEvaluation: PolicyEvaluationOutcome;
    readonly snapshot: CapabilitySnapshot;
    readonly conversions?: readonly ConversionQuote[];
  }): Promise<RouteCompilationResult> {
    if (typeof input.intentId !== 'string' || input.intentId.length === 0) {
      throw new TypeError('routing authority: compileRoute requires a non-empty intentId');
    }
    if (input.intentTerms === null || typeof input.intentTerms !== 'object') {
      throw new TypeError('routing authority: compileRoute requires intent terms (IntentTerms)');
    }
    if (input.policyEvaluation === null || typeof input.policyEvaluation !== 'object') {
      throw new TypeError('routing authority: compileRoute requires a PolicyEvaluationOutcome');
    }
    if (input.snapshot === null || typeof input.snapshot !== 'object' || !Array.isArray(input.snapshot.capabilities)) {
      throw new TypeError('routing authority: compileRoute requires a CapabilitySnapshot');
    }
    const planId = deriveProtocolId(
      'route-plan',
      input.intentId,
      ROUTE_COMPILER_VERSION,
      input.snapshot.snapshotId,
    );
    return this.serializer.run(`plan:${planId}`, async (): Promise<RouteCompilationResult> => {
      const recorded = this.plansById.get(planId);
      if (recorded !== undefined) {
        // INV-4-3: the recorded plan, verbatim — the compilation key is the
        // idempotency key (the intent authority's recorded-receipt
        // precedent).
        return { ok: true, replayed: true, plan: recorded };
      }
      const outcome = compileRoutePlan({
        intentId: input.intentId,
        intentTerms: input.intentTerms,
        policyEvaluation: input.policyEvaluation,
        snapshot: input.snapshot,
        ...(input.conversions === undefined ? {} : { conversions: input.conversions }),
      });
      if (!outcome.compiled) {
        return this.recordNoViableRoute(input, outcome.problem);
      }
      const when = this.nextTime();
      const plan = planFromContent(outcome.content, when);
      // Submit-then-commit (A15 lines 62-64): a failed write fails the
      // operation and nothing is recorded.
      await submitRoutingEvidence(this.evidence, routeCompiledEvidence(outcome.content, when));
      this.plansById.set(planId, plan);
      this.planOrder.push(planId);
      this.intentTermsByPlan.set(planId, input.intentTerms);
      return { ok: true, replayed: false, plan };
    });
  }

  /**
   * Record the NO_VIABLE_ROUTE terminal failure: the ROUTE_FAILED evidence
   * record plus the area-24 demand signal (emission point recorded).
   * Idempotent per compilation key: a recorded signal is returned verbatim.
   *
   * Source: core.md lines 253-254; A15 lines 26-32, 62-64; GC-5.
   */
  private async recordNoViableRoute(
    input: {
      readonly intentId: string;
      readonly intentTerms: IntentTerms;
      readonly policyEvaluation: PolicyEvaluationOutcome;
      readonly snapshot: CapabilitySnapshot;
    },
    problem: string,
  ): Promise<RouteCompilationResult> {
    const signalId = deriveProtocolId(
      'route-demand-signal',
      input.intentId,
      ROUTE_COMPILER_VERSION,
      input.snapshot.snapshotId,
    );
    const recordedSignal = this.demandSignalsById.get(signalId);
    if (recordedSignal !== undefined) {
      return {
        ok: false,
        terminal: true,
        reasonCode: 'NO_VIABLE_ROUTE',
        problem,
        demandSignal: recordedSignal,
      };
    }
    const attemptKey = deriveProtocolId(
      'route-plan',
      input.intentId,
      ROUTE_COMPILER_VERSION,
      input.snapshot.snapshotId,
    );
    const when = this.nextTime();
    const failureRecord = routeNoViableRouteEvidence({
      intentId: input.intentId,
      attemptKey,
      snapshotId: input.snapshot.snapshotId,
      when,
    });
    await submitRoutingEvidence(this.evidence, failureRecord);
    const signal: RouteDemandSignal = deepFreeze({
      signalId,
      intentId: input.intentId,
      compilerVersion: ROUTE_COMPILER_VERSION,
      snapshotId: input.snapshot.snapshotId,
      requestedCorridor: {
        sourceCurrency: input.intentTerms.sourceCurrency,
        destinationCurrency: input.intentTerms.destinationCurrency,
        sourceGeography: input.intentTerms.sourceGeography,
        destinationGeography: input.intentTerms.destinationGeography,
      },
      amount: input.intentTerms.amount,
      emissionPointRecordId: evidenceRecordId(failureRecord),
      emittedAt: when,
    });
    this.demandSignalsById.set(signalId, signal);
    this.demandSignalOrder.push(signalId);
    return {
      ok: false,
      terminal: true,
      reasonCode: 'NO_VIABLE_ROUTE',
      problem,
      demandSignal: signal,
    };
  }

  // -------------------------------------------------------------------------
  // Validation (COMPILED -> VALIDATED)
  // -------------------------------------------------------------------------

  /**
   * Validate the plan: COMPILED -> VALIDATED. Re-runs the INV-4-1
   * value-preservation identity (integer summation over the plan's value
   * ledger against the intent terms the plan was compiled for); a failed
   * check is the typed VALIDATION_FAILED rejection and the plan stays
   * COMPILED (nothing mutated, no evidence).
   *
   * Source: core.md lines 224-225 (the chain), lines 239-244 (INV-4-1 —
   * the identity re-checked), line 264 (ROUTE_VALIDATED).
   */
  async validatePlan(planId: string): Promise<RouteCommandResult> {
    if (typeof planId !== 'string' || planId.length === 0) {
      throw new TypeError('routing authority: planId must be a non-empty string');
    }
    return this.serializer.run(`plan:${planId}`, async (): Promise<RouteCommandResult> => {
      const current = this.plansById.get(planId);
      if (current === undefined) {
        return planNotFound(planId);
      }
      if (current.state !== 'COMPILED') {
        return illegalPlanTransition(current, 'VALIDATED');
      }
      const terms = this.intentTermsByPlan.get(planId);
      if (terms === undefined) {
        throw new TypeError(
          `routing authority: plan ${planId} has no recorded intent terms (internal consistency)`,
        );
      }
      const check = checkRouteValuePreservation(current.hops, current.valueLedger, terms);
      if (!check.ok) {
        return {
          ok: false,
          code: 'VALIDATION_FAILED',
          problem: `${check.problem} [rule ${check.rule}]`,
        };
      }
      const when = this.nextTime();
      const transition = transitionRoutePlan(current, 'VALIDATED', when);
      if (!transition.ok) {
        return transition;
      }
      await submitRoutingEvidence(this.evidence, routeValidatedEvidence(transition.plan, when));
      this.plansById.set(planId, transition.plan);
      return { ok: true, plan: transition.plan };
    });
  }

  // -------------------------------------------------------------------------
  // Dispatch (VALIDATED -> DISPATCHED, fixed hop order acquisition)
  // -------------------------------------------------------------------------

  /**
   * Dispatch the plan: VALIDATED -> DISPATCHED, acquiring the plan's
   * reservations through the area-5 port STRICTLY in the plan's fixed hop
   * order (INV-4-2). Every hop's reservation is requested with the hop's
   * amount and the plan's deadline; an acquisition failure unwinds the
   * already-acquired holds in reverse hop order and abandons the plan
   * (ACQUISITION_FAILED — nothing was dispatched; the returned plan is the
   * ABANDONED record). A successful dispatch records the acquired
   * reservation ids on the plan, in fixed hop order.
   *
   * Dispatch crash-consistency (recorded interpretation): if the
   * ROUTE_DISPATCHED evidence write fails AFTER the acquisitions, the
   * command throws, the plan stays VALIDATED, and the acquired holds remain
   * HELD; a re-dispatch re-requests the same derived reservation ids and
   * the ledger returns the recorded HELD state (INV-5-3), so the retry is
   * idempotent — no blind double-hold is possible.
   *
   * Source: core.md lines 245-247 (INV-4-2), lines 263-265
   * (ROUTE_DISPATCHED), lines 272-273 (the area 5 dependency).
   */
  async dispatchPlan(planId: string): Promise<RouteCommandResult> {
    if (typeof planId !== 'string' || planId.length === 0) {
      throw new TypeError('routing authority: planId must be a non-empty string');
    }
    return this.serializer.run(`plan:${planId}`, async (): Promise<RouteCommandResult> => {
      const current = this.plansById.get(planId);
      if (current === undefined) {
        return planNotFound(planId);
      }
      if (current.state !== 'VALIDATED') {
        return illegalPlanTransition(current, 'DISPATCHED');
      }
      const refs: HopReservationRef[] = [];
      for (const hop of current.hops) {
        const acquired = await this.reservations.request({
          intentId: current.intentId,
          hopId: hop.hopId,
          resourceId: hop.capabilityId,
          amount: hop.amount,
          deadlineEpochMs: current.deadlineEpochMs,
        });
        if (!acquired.ok) {
          // Unwind: release the already-acquired holds in REVERSE hop order
          // (a deterministic unwind), then abandon — nothing was dispatched.
          for (let index = refs.length - 1; index >= 0; index -= 1) {
            const ref = refs[index] as HopReservationRef;
            await this.reservations.release(ref.reservationId);
          }
          const when = this.nextTime();
          const transition = transitionRoutePlan(current, 'ABANDONED', when);
          if (!transition.ok) {
            return transition;
          }
          await submitRoutingEvidence(
            this.evidence,
            routeAbandonedEvidence({
              plan: transition.plan,
              when,
              reasonCode: 'ACQUISITION_FAILED',
              affectedHopIds: current.hops
                .slice(hop.position)
                .map((candidate) => candidate.hopId),
            }),
          );
          this.plansById.set(planId, transition.plan);
          return { ok: true, plan: transition.plan };
        }
        refs.push({ hopId: hop.hopId, reservationId: acquired.reservationId });
      }
      const when = this.nextTime();
      const transition = transitionRoutePlan(current, 'DISPATCHED', when, {
        reservationRefs: Object.freeze(refs),
      });
      if (!transition.ok) {
        return transition;
      }
      await submitRoutingEvidence(this.evidence, routeDispatchedEvidence(transition.plan, when));
      this.plansById.set(planId, transition.plan);
      return { ok: true, plan: transition.plan };
    });
  }

  // -------------------------------------------------------------------------
  // The UNKNOWN-hop halt discipline (the plan halts at DISPATCHED, GC-2)
  // -------------------------------------------------------------------------

  /**
   * Record that a hop's rail operation returned UNKNOWN: the plan HALTS at
   * DISPATCHED — the state stays DISPATCHED (no transition, no evidence:
   * the UNKNOWN fact's own evidence belongs to the rail/reconciliation
   * areas 13/12/14), the annotation is recorded on the plan, and every
   * terminal transition is refused until the halt is resolved
   * (resolveUnknownHop). Idempotent for the same (hop, rail operation)
   * pair.
   *
   * Source: core.md lines 255-259 ("the plan then halts at DISPATCHED — it
   * never re-dispatches hops blindly (GC-2)"); GC-2 (README.md §3 lines
   * 45-49); rails-adapters-reconciliation.md lines 124-125.
   */
  async recordUnknownHop(
    planId: string,
    hopId: string,
    railOperationId: string,
  ): Promise<RouteCommandResult> {
    if (typeof planId !== 'string' || planId.length === 0) {
      throw new TypeError('routing authority: planId must be a non-empty string');
    }
    if (typeof hopId !== 'string' || hopId.length === 0) {
      throw new TypeError('routing authority: hopId must be a non-empty string');
    }
    if (typeof railOperationId !== 'string' || railOperationId.length === 0) {
      throw new TypeError('routing authority: railOperationId must be a non-empty string');
    }
    return this.serializer.run(`plan:${planId}`, async (): Promise<RouteCommandResult> => {
      const current = this.plansById.get(planId);
      if (current === undefined) {
        return planNotFound(planId);
      }
      if (current.state !== 'DISPATCHED') {
        return {
          ok: false,
          code: 'ILLEGAL_TRANSITION',
          problem:
            `route plan ${planId}: an UNKNOWN hop halts a DISPATCHED plan (current state ${current.state}; ` +
            'core.md A04 lines 255-259 — "the plan then halts at DISPATCHED")',
        };
      }
      const hop = current.hops.find((candidate) => candidate.hopId === hopId);
      if (hop === undefined) {
        return {
          ok: false,
          code: 'NO_UNKNOWN_HOP',
          problem: `route plan ${planId}: hop ${hopId} is not a hop of this plan`,
        };
      }
      const existing = current.unknownHops.find(
        (ref) => ref.hopId === hopId && ref.resolvedOutcome === undefined,
      );
      if (existing !== undefined) {
        if (existing.railOperationId === railOperationId) {
          // Idempotent: the same halt fact is already recorded.
          return { ok: true, plan: current };
        }
        return {
          ok: false,
          code: 'HOP_ALREADY_HALTED',
          problem:
            `route plan ${planId}: hop ${hopId} already halts for rail operation ` +
            `${existing.railOperationId} (one unresolved UNKNOWN per hop — GC-2)`,
        };
      }
      const when = this.nextTime();
      const annotation: UnknownHopRef = deepFreeze({
        hopId,
        railOperationId,
        haltedAt: when,
      });
      const halted: RoutePlan = deepFreeze({
        ...current,
        unknownHops: Object.freeze([...current.unknownHops, annotation]),
      });
      this.plansById.set(planId, halted);
      return { ok: true, plan: halted };
    });
  }

  /**
   * Resolve one UNKNOWN-hop halt with the outcome reconciliation (area 14)
   * reported: the annotation records the resolved outcome and time; the
   * plan is then free to complete or fail based on that outcome
   * ("the plan then completes or fails based on the resolved outcome",
   * core.md lines 258-259). Resolving is orthogonal to the terminal
   * transition: the caller drives completePlan / failPlan after every halt
   * is resolved.
   *
   * Source: core.md lines 255-259; GC-2 (the only exit from UNKNOWN is
   * reconciliation — README.md §3 lines 45-49).
   */
  async resolveUnknownHop(
    planId: string,
    hopId: string,
    resolvedOutcome: 'CONFIRMED' | 'FAILED',
  ): Promise<RouteCommandResult> {
    if (typeof planId !== 'string' || planId.length === 0) {
      throw new TypeError('routing authority: planId must be a non-empty string');
    }
    if (typeof hopId !== 'string' || hopId.length === 0) {
      throw new TypeError('routing authority: hopId must be a non-empty string');
    }
    if (resolvedOutcome !== 'CONFIRMED' && resolvedOutcome !== 'FAILED') {
      throw new TypeError('routing authority: resolvedOutcome must be CONFIRMED or FAILED');
    }
    return this.serializer.run(`plan:${planId}`, async (): Promise<RouteCommandResult> => {
      const current = this.plansById.get(planId);
      if (current === undefined) {
        return planNotFound(planId);
      }
      if (current.state !== 'DISPATCHED') {
        return {
          ok: false,
          code: 'ILLEGAL_TRANSITION',
          problem:
            `route plan ${planId}: only a DISPATCHED plan carries UNKNOWN-hop halts to resolve ` +
            `(current state ${current.state})`,
        };
      }
      const index = current.unknownHops.findIndex(
        (ref) => ref.hopId === hopId && ref.resolvedOutcome === undefined,
      );
      if (index < 0) {
        return {
          ok: false,
          code: 'NO_UNKNOWN_HOP',
          problem: `route plan ${planId}: hop ${hopId} has no unresolved UNKNOWN halt`,
        };
      }
      const when = this.nextTime();
      const resolved = current.unknownHops.map((ref, position) =>
        position === index
          ? deepFreeze({ ...ref, resolvedAt: when, resolvedOutcome })
          : ref,
      );
      const updated: RoutePlan = deepFreeze({
        ...current,
        unknownHops: Object.freeze(resolved),
      });
      this.plansById.set(planId, updated);
      return { ok: true, plan: updated };
    });
  }

  // -------------------------------------------------------------------------
  // Terminal transitions (DISPATCHED -> COMPLETED | FAILED; -> ABANDONED)
  // -------------------------------------------------------------------------

  /**
   * Complete the plan: DISPATCHED -> COMPLETED. Requires every UNKNOWN-hop
   * halt resolved (UNRESOLVED_UNKNOWN_HOP otherwise — completing a plan
   * with an unresolved UNKNOWN would be the blind resume GC-2 forbids),
   * then consumes the plan's reservations in fixed hop order (idempotent:
   * already-consumed reservations are skipped; INV-5-3's exactly-once
   * terminals). A reservation that is no longer HELD (released or expired)
   * blocks completion with RESERVATION_NOT_HELD — the plan cannot complete
   * without its holds.
   *
   * Source: core.md lines 224-225, 255-259 ("the plan then completes ...
   * based on the resolved outcome"), lines 319-322 (the reservations are
   * "consumed or released exactly once (GC-2)"); line 264
   * (ROUTE_COMPLETED).
   */
  async completePlan(planId: string): Promise<RouteCommandResult> {
    return this.terminalTransition(planId, 'COMPLETED');
  }

  /**
   * Fail the plan: DISPATCHED -> FAILED, with a reason code from the frozen
   * vocabulary (HOP_FAILED for a hop's failed or resolved-FAILED rail
   * outcome). Requires every UNKNOWN-hop halt resolved, then releases the
   * reservations still HELD (consumed ones stay consumed — exactly-once
   * terminals).
   *
   * Source: core.md lines 224-225, 255-259 ("... or fails based on the
   * resolved outcome"), lines 319-322; line 264 (ROUTE_FAILED "with reason
   * codes and affected hop ids").
   */
  async failPlan(
    planId: string,
    reasonCode: RoutePlanReasonCode,
    options: { readonly affectedHopIds?: readonly string[] } = {},
  ): Promise<RouteCommandResult> {
    return this.terminalTransition(planId, 'FAILED', reasonCode, options.affectedHopIds);
  }

  /**
   * Abandon the plan: COMPILED/VALIDATED/DISPATCHED -> ABANDONED, with a
   * reason code from the frozen vocabulary (SUPERSEDED, PAYER_CANCELLED,
   * RESERVATIONS_EXPIRED, ...). A DISPATCHED abandonment requires every
   * UNKNOWN-hop halt resolved and releases the reservations still HELD.
   *
   * Source: core.md lines 224-225 (the terminal), lines 288-291 (area 5's
   * deterministic expiry feeding RESERVATIONS_EXPIRED); line 264
   * (ROUTE_ABANDONED).
   */
  async abandonPlan(
    planId: string,
    reasonCode: RoutePlanReasonCode,
    options: { readonly affectedHopIds?: readonly string[] } = {},
  ): Promise<RouteCommandResult> {
    return this.terminalTransition(planId, 'ABANDONED', reasonCode, options.affectedHopIds);
  }

  private async terminalTransition(
    planId: string,
    target: RoutePlanState,
    reasonCode?: RoutePlanReasonCode,
    affectedHopIds?: readonly string[],
  ): Promise<RouteCommandResult> {
    if (typeof planId !== 'string' || planId.length === 0) {
      throw new TypeError('routing authority: planId must be a non-empty string');
    }
    if (target === 'FAILED' || target === 'ABANDONED') {
      if (reasonCode === undefined || typeof reasonCode !== 'string') {
        throw new TypeError(
          `routing authority: the ${target} terminal transition requires a reason code`,
        );
      }
    }
    if (affectedHopIds !== undefined) {
      if (!Array.isArray(affectedHopIds)) {
        throw new TypeError('routing authority: affectedHopIds must be an array of hop ids');
      }
      for (const hopId of affectedHopIds) {
        if (typeof hopId !== 'string' || hopId.length === 0) {
          throw new TypeError('routing authority: affectedHopIds entries must be non-empty strings');
        }
      }
    }
    return this.serializer.run(`plan:${planId}`, async (): Promise<RouteCommandResult> => {
      const current = this.plansById.get(planId);
      if (current === undefined) {
        return planNotFound(planId);
      }
      if (current.state === 'DISPATCHED') {
        // GC-2: no terminal transition of a DISPATCHED plan while any
        // UNKNOWN-hop halt is unresolved.
        if (hasUnresolvedUnknownHop(current)) {
          return {
            ok: false,
            code: 'UNRESOLVED_UNKNOWN_HOP',
            problem:
              `route plan ${planId}: ${current.unknownHops.filter((ref) => ref.resolvedOutcome === undefined).length} ` +
              'UNKNOWN-hop halt(s) unresolved — recovery proceeds only after reconciliation (area 14) ' +
              'resolves the UNKNOWN rail operation (core.md A04 lines 255-259; GC-2)',
          };
        }
        // Drive the plan's own reservations' terminals exactly once:
        // COMPLETE consumes (fixed hop order); FAIL/ABANDON release what is
        // still HELD (consumed stays consumed).
        const reservationOutcome = await this.driveReservationTerminals(current, target);
        if (!reservationOutcome.ok) {
          return reservationOutcome;
        }
      }
      const reasonCheck = checkRoutePlanReasonCode(target, reasonCode);
      if (!reasonCheck.ok) {
        return { ok: false, code: 'REASON_CODE_REQUIRED', problem: reasonCheck.problem };
      }
      const when = this.nextTime();
      const transition = transitionRoutePlan(current, target, when);
      if (!transition.ok) {
        return transition;
      }
      if (target === 'COMPLETED') {
        await submitRoutingEvidence(this.evidence, routeCompletedEvidence(transition.plan, when));
      } else if (target === 'FAILED') {
        await submitRoutingEvidence(
          this.evidence,
          routeFailedEvidence({
            plan: transition.plan,
            when,
            reasonCode: reasonCode as RoutePlanReasonCode,
            ...(affectedHopIds === undefined ? {} : { affectedHopIds }),
          }),
        );
      } else {
        await submitRoutingEvidence(
          this.evidence,
          routeAbandonedEvidence({
            plan: transition.plan,
            when,
            reasonCode: reasonCode as RoutePlanReasonCode,
            ...(affectedHopIds === undefined ? {} : { affectedHopIds }),
          }),
        );
      }
      this.plansById.set(planId, transition.plan);
      return { ok: true, plan: transition.plan };
    });
  }

  /**
   * Drive the plan's reservations' terminals: COMPLETE consumes each of
   * the plan's reservations in fixed hop order (skipping already-consumed
   * ones — INV-5-3 idempotency); FAIL/ABANDON release the ones still HELD
   * (skipping terminals). A consume that finds the reservation no longer
   * HELD is the typed RESERVATION_NOT_HELD rejection (the plan cannot
   * complete without its holds). PURELY AREA-5-MEDIATED: every mutation
   * passes through the ledger's serialized path.
   *
   * Source: core.md lines 319-322 ("they are then consumed or released
   * exactly once (GC-2)"); INV-5-3 lines 310-312; INV-4-2 lines 245-247
   * (the fixed hop order).
   */
  private async driveReservationTerminals(
    plan: RoutePlan,
    target: RoutePlanState,
  ): Promise<RouteCommandResult> {
    if (target === 'COMPLETED') {
      for (const ref of plan.reservationRefs) {
        const state = this.reservations.stateOf(ref.reservationId);
        if (state === undefined) {
          return {
            ok: false,
            code: 'RESERVATION_NOT_HELD',
            problem:
              `route plan ${plan.planId}: reservation ${ref.reservationId} (hop ${ref.hopId}) ` +
              'is not recorded — the plan cannot complete without its holds',
          };
        }
        if (state === 'CONSUMED') {
          continue; // exactly-once terminal already applied (idempotent skip)
        }
        if (state !== 'HELD') {
          return {
            ok: false,
            code: 'RESERVATION_NOT_HELD',
            problem:
              `route plan ${plan.planId}: reservation ${ref.reservationId} (hop ${ref.hopId}) ` +
              `is ${state}, not HELD — the plan cannot complete without its holds ` +
              '(core.md A05 lines 319-322: consumed or released exactly once)',
          };
        }
        const consumed = await this.reservations.consume(ref.reservationId);
        if (!consumed.ok) {
          return {
            ok: false,
            code: 'RESERVATION_NOT_HELD',
            problem: `route plan ${plan.planId}: consuming reservation ${ref.reservationId} failed — ${consumed.problem}`,
          };
        }
      }
      return { ok: true, plan };
    }
    // FAIL / ABANDON: release what is still HELD; terminals stay terminal.
    for (const ref of plan.reservationRefs) {
      const state = this.reservations.stateOf(ref.reservationId);
      if (state === undefined || state !== 'HELD') {
        continue;
      }
      await this.reservations.release(ref.reservationId);
    }
    return { ok: true, plan };
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** The plan with the given id, or undefined. Source: queries are pure reads. */
  plan(planId: string): RoutePlan | undefined {
    return this.plansById.get(planId);
  }

  /** Every recorded plan, in compilation order. */
  plans(): readonly RoutePlan[] {
    return this.planOrder
      .map((planId) => this.plansById.get(planId))
      .filter((plan): plan is RoutePlan => plan !== undefined);
  }

  /** The plans compiled for one intent, in compilation order. */
  plansForIntent(intentId: string): readonly RoutePlan[] {
    return this.plans().filter((plan) => plan.intentId === intentId);
  }

  /** Every recorded demand signal (the area-24 input), in emission order. */
  demandSignals(): readonly RouteDemandSignal[] {
    return this.demandSignalOrder
      .map((signalId) => this.demandSignalsById.get(signalId))
      .filter((signal): signal is RouteDemandSignal => signal !== undefined);
  }

  /** The demand signal with the given id, or undefined. */
  demandSignal(signalId: string): RouteDemandSignal | undefined {
    return this.demandSignalsById.get(signalId);
  }
}

function planFromContent(content: RoutePlanContent, when: ProtocolTime): RoutePlan {
  return deepFreeze({
    planId: content.planId,
    intentId: content.intentId,
    compilerVersion: content.compilerVersion,
    snapshotId: content.snapshotId,
    state: 'COMPILED' as const,
    hops: content.hops,
    valueLedger: content.valueLedger,
    deadlineEpochMs: content.deadlineEpochMs,
    reservationRefs: Object.freeze([] as const),
    unknownHops: Object.freeze([] as const),
    createdAt: when,
    stateChangedAt: when,
  });
}

function planNotFound(planId: string): RouteCommandResult {
  return {
    ok: false,
    code: 'PLAN_NOT_FOUND',
    problem: `routing authority: plan ${planId} is not recorded`,
  };
}

function illegalPlanTransition(plan: RoutePlan, target: RoutePlanState): RouteCommandResult {
  return {
    ok: false,
    code: 'ILLEGAL_TRANSITION',
    problem:
      `routing authority: plan ${plan.planId} is ${plan.state}; the transition to ${target} ` +
      'is not in the frozen one-way table (core.md A04 lines 224-225; a dispatched plan is ' +
      'never re-dispatched blindly — GC-2)',
  };
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}
