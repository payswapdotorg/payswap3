/**
 * RTN-006 — Routing Authority: the A04 type vocabulary, state machine
 * tables, and runtime guards.
 *
 * Spec sources (binding) — spec/architecture/v0.1/core.md §4 Area 4:
 *   lines 221-225 (RoutePlan — the object and state machine, verbatim):
 *     "RoutePlan — compiled plan: ordered hops, each hop naming a capability
 *      (rail id, corridor), an amount (Money), and expected settlement
 *      semantics.
 *      States: COMPILED -> VALIDATED -> DISPATCHED ->
 *      terminal(COMPLETED | FAILED | ABANDONED)."
 *   lines 227-230 (RouteCompiler):
 *     "RouteCompiler — deterministic function from (intent terms, policy
 *      evaluation, capability snapshot) to either a RoutePlan or a
 *      reason-coded failure (NO_VIABLE_ROUTE). Compiler versions are pinned;
 *      the version id is recorded in every plan."
 *   lines 239-249 (INV-4-1 / INV-4-2 / INV-4-3, quoted in the enforcing
 *   modules: value.ts, compiler.ts, and the plan-id derivation below).
 *   lines 253-259 (failure and UNKNOWN semantics — NO_VIABLE_ROUTE's
 *     area-24 demand signal, and the halt-at-DISPATCHED rule).
 *   lines 263-265 (evidence produced — ROUTE_COMPILED ... ROUTE_ABANDONED).
 *   lines 269-273 (boundaries: the compiler never calls rails and never
 *     mutates balances; plans reference capabilities by id; depends on
 *     areas 1-3 for inputs and area 5 for reservation acquisition).
 *   spec/architecture/v0.1/README.md §3 GC-1/GC-2/GC-4/GC-5.
 *   spec/registry/protocol-registry.json A04 — owningAuthority:
 *     "Routing Authority".
 *
 * Transition-table interpretation (recorded in CONTRACT-REVIEW.md): the
 * v0.1 chain names the happy path COMPILED -> VALIDATED -> DISPATCHED ->
 * terminal(COMPLETED | FAILED | ABANDONED). The area's own contracts add
 * the pre-terminal exits, and both are load-bearing:
 *   - core.md lines 255-259 (UNKNOWN semantics): "a hop may return UNKNOWN
 *     from a rail (area 13); the plan then halts at DISPATCHED — it never
 *     re-dispatches hops blindly (GC-2). Recovery proceeds only after
 *     reconciliation (area 14) resolves the UNKNOWN rail operation; the
 *     plan then completes or fails based on the resolved outcome." So
 *     DISPATCHED carries COMPLETED and FAILED exits, and a halt NEVER
 *     re-enters DISPATCHED (a second dispatch is unrepresentable: DISPATCHED
 *     has no DISPATCHED successor).
 *   - ABANDONED is the give-up terminal of the machine (core.md line 225
 *     names it without spelling out its triggers; v0.1 does not enumerate
 *     them). Interpretation, recorded in CONTRACT-REVIEW.md: ABANDONED is
 *     the non-execution give-up terminal — pre-dispatch abandonment
 *     (COMPILED/VALIDATED -> ABANDONED: superseded snapshot, payer
 *     cancellation) and dispatch-time reservation-acquisition failure
 *     (VALIDATED -> ABANDONED: INV-4-2's acquisition step failed, nothing
 *     was dispatched), while FAILED is the execution-failure terminal
 *     (cited by lines 258-259). DISPATCHED -> ABANDONED exists for a halted
 *     plan whose reservations expired (area 5 EXPIRED) and can no longer
 *     complete or fail on a resolved rail outcome.
 */

import type { Money } from '../kernel/money.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type { Corridor } from '../capability/types.ts';

/**
 * The RoutePlan state vocabulary, verbatim from the v0.1 chain.
 *
 * Source: core.md lines 224-225 — "States: COMPILED -> VALIDATED ->
 * DISPATCHED -> terminal(COMPLETED | FAILED | ABANDONED)."
 */
export const ROUTE_PLAN_STATES: readonly [
  'COMPILED',
  'VALIDATED',
  'DISPATCHED',
  'COMPLETED',
  'FAILED',
  'ABANDONED',
] = Object.freeze([
  'COMPILED',
  'VALIDATED',
  'DISPATCHED',
  'COMPLETED',
  'FAILED',
  'ABANDONED',
] as const);

/**
 * A RoutePlan state. COMPLETED, FAILED, and ABANDONED are terminal (the
 * machine has no exit from any of them — "it never re-dispatches hops
 * blindly" is structural: DISPATCHED has no DISPATCHED successor, and no
 * terminal has any successor).
 *
 * Source: core.md lines 224-225, 255-259.
 */
export type RoutePlanState = (typeof ROUTE_PLAN_STATES)[number];

/**
 * The frozen one-way RoutePlan transition table. Edges beyond the happy
 * path are each spec-cited in the module doc (lines 255-259 for the
 * DISPATCHED exits; the ABANDONED interpretation recorded in
 * CONTRACT-REVIEW.md).
 *
 * Source: core.md lines 224-225 (the chain), 255-259 (the DISPATCHED
 * exits and the no-blind-re-dispatch rule).
 */
export const ROUTE_PLAN_TRANSITIONS: Readonly<Record<RoutePlanState, readonly RoutePlanState[]>> =
  Object.freeze({
    COMPILED: Object.freeze(['VALIDATED', 'ABANDONED'] as const),
    VALIDATED: Object.freeze(['DISPATCHED', 'ABANDONED'] as const),
    DISPATCHED: Object.freeze(['COMPLETED', 'FAILED', 'ABANDONED'] as const),
    COMPLETED: Object.freeze([] as const),
    FAILED: Object.freeze([] as const),
    ABANDONED: Object.freeze([] as const),
  });

/**
 * Runtime type guard for RoutePlanState.
 *
 * Source: core.md lines 224-225 (the vocabulary this guard re-checks).
 */
export function isRoutePlanState(value: unknown): value is RoutePlanState {
  return typeof value === 'string' && (ROUTE_PLAN_STATES as readonly string[]).includes(value);
}

/**
 * True iff the (from, to) pair is a legal one-way RoutePlan transition.
 *
 * Source: core.md lines 224-225 (the chain this table materializes);
 * lines 255-259 (the DISPATCHED exits).
 */
export function canTransitionRoutePlan(from: RoutePlanState, to: RoutePlanState): boolean {
  return ROUTE_PLAN_TRANSITIONS[from].includes(to);
}

/**
 * The A04 reason-code vocabulary — the machine-readable codes the ROUTE_*
 * evidence records' outcome slots carry ("ROUTE_VALIDATED, ROUTE_DISPATCHED,
 * ROUTE_COMPLETED, ROUTE_FAILED, ROUTE_ABANDONED (with reason codes and
 * affected hop ids)", core.md lines 263-265).
 *
 * Members (each spec-grounded or a recorded interpretation, see
 * CONTRACT-REVIEW.md):
 *   - NO_VIABLE_ROUTE — core.md lines 253-254: "NO_VIABLE_ROUTE is a
 *     terminal failure that also emits a demand signal for area 24."
 *   - HOP_FAILED — core.md lines 258-259: "the plan then completes or fails
 *     based on the resolved outcome" (a hop's rail operation failed, or its
 *     UNKNOWN resolved FAILED after reconciliation).
 *   - ACQUISITION_FAILED — INV-4-2 (lines 245-247): dispatch acquires
 *     reservations in the plan's fixed hop order; an acquisition that
 *     cannot complete abandons the plan (nothing was dispatched).
 *   - RESERVATIONS_EXPIRED — core.md lines 288-291 (area 5): "Each
 *     reservation carries a deadline; expiry is deterministic on protocol
 *     time"; a halted plan whose holds expired can neither complete nor
 *     fail on a rail outcome.
 *   - SUPERSEDED — INV-4-2 (lines 245-247): "a plan is compiled against one
 *     capability snapshot id"; a fresher snapshot supersedes a not-yet-
 *     dispatched plan.
 *   - PAYER_CANCELLED — area 1's cancellation cascading to its plan (the
 *     intent's PAYER_CANCELLED vocabulary, intent/types.ts, mirrored for
 *     the plan's ABANDONED terminal).
 */
export const ROUTE_PLAN_REASON_CODES: readonly [
  'NO_VIABLE_ROUTE',
  'HOP_FAILED',
  'ACQUISITION_FAILED',
  'RESERVATIONS_EXPIRED',
  'SUPERSEDED',
  'PAYER_CANCELLED',
] = Object.freeze([
  'NO_VIABLE_ROUTE',
  'HOP_FAILED',
  'ACQUISITION_FAILED',
  'RESERVATIONS_EXPIRED',
  'SUPERSEDED',
  'PAYER_CANCELLED',
] as const);

/**
 * An A04 reason code. Source: core.md lines 263-265 ("with reason codes");
 * the frozen vocabulary is the closed set the authority accepts.
 */
export type RoutePlanReasonCode = (typeof ROUTE_PLAN_REASON_CODES)[number];

/**
 * Runtime type guard for RoutePlanReasonCode.
 *
 * Source: core.md lines 263-265 (the reason-code contract this guards).
 */
export function isRoutePlanReasonCode(value: unknown): value is RoutePlanReasonCode {
  return typeof value === 'string' && (ROUTE_PLAN_REASON_CODES as readonly string[]).includes(value);
}

/**
 * One explicit conversion line item — INV-4-1's "explicit, recorded
 * conversion amounts for any currency change". One item exists for exactly
 * each hop whose corridor changes currency (source currency differs from
 * destination currency); its from-amount is the value flowing into that hop
 * and its to-amount is the value the hop delivers in its destination
 * currency. Both are integer Money values supplied as recorded facts — the
 * compiler performs NO rate arithmetic anywhere (GC-1; the stop condition
 * "any need for floating-point conversion arithmetic" is unreachable).
 *
 * Source: core.md lines 239-244 (INV-4-1 — "with explicit, recorded
 * conversion amounts for any currency change. ... nothing is derived by
 * floating point").
 */
export interface ConversionLineItem {
  /** The cross-currency hop this conversion belongs to. */
  readonly hopId: string;
  /** The value flowing into the hop (the hop's corridor source currency). */
  readonly fromAmount: Money;
  /** The value the hop delivers (the hop's corridor destination currency). */
  readonly toAmount: Money;
}

/**
 * One explicit fee line item — INV-4-1's "Fees are explicit Money line
 * items". Exactly one per hop: the hop's capability's advertised cost
 * schedule, recorded as an explicit integer Money value on the plan.
 *
 * Source: core.md lines 243-244 — "Fees are explicit Money line items;
 * nothing is derived by floating point."
 */
export interface FeeLineItem {
  /** The hop this fee is charged for. */
  readonly hopId: string;
  /** The fee as an explicit integer Money value (the capability's cost schedule). */
  readonly fee: Money;
}

/**
 * The plan's value ledger — the INV-4-1 value-preservation material: the
 * source-leg amount (the intent amount), the delivered destination-leg
 * amount, one conversion line item per currency change, and one fee line
 * item per hop. The value-preservation identity over this ledger is checked
 * by integer summation in value.ts after compilation and at validation.
 *
 * Source: core.md lines 239-244 (INV-4-1).
 */
export interface RouteValueLedger {
  /** The intent amount entering the plan at hop 0 (the source currency leg). */
  readonly sourceAmount: Money;
  /** The value the last hop delivers (the destination currency leg). */
  readonly deliveredAmount: Money;
  /** One item per currency change, in fixed hop order. */
  readonly conversions: readonly ConversionLineItem[];
  /** One item per hop, in fixed hop order. */
  readonly fees: readonly FeeLineItem[];
}

/**
 * One ordered hop of a compiled plan — exactly the fields the spec names:
 * "each hop naming a capability (rail id, corridor), an amount (Money), and
 * expected settlement semantics."
 *
 * The hop references its capability by id (core.md lines 270-271: "Route
 * plans reference capabilities by id; they do not embed adapter credentials
 * or endpoints") and carries no rail-adapter configuration of any kind.
 *
 * Source: core.md lines 221-223.
 */
export interface RouteHop {
  /** deriveProtocolId('route-hop', planId, position) — deterministic hop id. */
  readonly hopId: string;
  /** The hop's position in the plan's fixed hop order (0-based, ascending). */
  readonly position: number;
  /** The capability this hop rides, referenced by id. */
  readonly capabilityId: string;
  /** The capability's rail id. */
  readonly railId: string;
  /** The capability's corridor (source/destination currencies and geographies). */
  readonly corridor: Corridor;
  /** The value entering this hop, in the hop's corridor source currency. */
  readonly amount: Money;
  /**
   * The expected settlement semantics, as a deterministic machine-readable
   * label derived from the hop's corridor destination leg (the settlement
   * instruction shape the hop expects area 12 to drive). v0.1 names the slot
   * (core.md lines 221-223, 214-216) without enumerating its vocabulary —
   * the label is this module's recorded interpretation; area 12's wave owns
   * the real semantics.
   *
   * Source: core.md lines 214-216 ("which settlement instructions to
   * expect"), 221-223.
   */
  readonly settlementSemantics: string;
}

/**
 * A reservation acquired for one hop at dispatch — INV-4-2's "dispatch
 * acquires reservations (area 5) in the plan's fixed hop order" made
 * visible on the plan record: each dispatched plan carries the reservation
 * id acquired for each of its hops, in fixed hop order.
 *
 * Source: core.md lines 245-247 (INV-4-2); area 5 lines 310-312 (INV-5-3,
 * the derived reservation ids referenced here).
 */
export interface HopReservationRef {
  readonly hopId: string;
  readonly reservationId: string;
}

/**
 * The UNKNOWN-hop halt annotation — core.md lines 255-257: "a hop may
 * return UNKNOWN from a rail (area 13); the plan then halts at DISPATCHED".
 * The annotation records which hop halted and which rail operation is
 * UNKNOWN; the plan's state stays DISPATCHED (the halt is not a state
 * transition), and the annotation's resolution (after reconciliation,
 * area 14) un-halts the plan for its terminal transition. Reservations stay
 * HELD while any halt is unresolved (core.md lines 319-322).
 *
 * Source: core.md lines 255-259; rails-adapters-reconciliation.md lines
 * 124-125 ("Every UNKNOWN rail operation automatically opens exactly one
 * case").
 */
export interface UnknownHopRef {
  readonly hopId: string;
  /** The rail operation (area 13) whose result is UNKNOWN. */
  readonly railOperationId: string;
  readonly haltedAt: ProtocolTime;
  /** Set when reconciliation (area 14) resolved the UNKNOWN operation. */
  readonly resolvedAt?: ProtocolTime;
  /** The resolved outcome, once reconciliation reported it. */
  readonly resolvedOutcome?: 'CONFIRMED' | 'FAILED';
}

/**
 * RoutePlan — the compiled plan as recorded by the authority: the ordered
 * hops, the value ledger, the compilation key (INV-4-3), the one snapshot
 * id the plan was compiled against (INV-4-2), the pinned compiler version
 * ("the version id is recorded in every plan"), the acquired reservation
 * references (from dispatch on), and the UNKNOWN-hop halt annotations.
 *
 * Source: core.md lines 221-230 (object + compiler pinning); INV-4-2 lines
 * 245-247; INV-4-3 lines 248-249.
 */
export interface RoutePlan {
  /** deriveProtocolId('route-plan', intentId, compilerVersion, snapshotId) — INV-4-3. */
  readonly planId: string;
  readonly intentId: string;
  /** The pinned compiler version that produced this plan (recorded in every plan). */
  readonly compilerVersion: number;
  /** The one capability snapshot id this plan was compiled against (INV-4-2). */
  readonly snapshotId: string;
  readonly state: RoutePlanState;
  /** The ordered hops, in the plan's fixed hop order. */
  readonly hops: readonly RouteHop[];
  /** The INV-4-1 value-preservation material. */
  readonly valueLedger: RouteValueLedger;
  /** The plan's fulfillment deadline (the policy evaluation's merged deadline). */
  readonly deadlineEpochMs: number;
  /** The reservations acquired at dispatch, in fixed hop order (INV-4-2). */
  readonly reservationRefs: readonly HopReservationRef[];
  /** The UNKNOWN-hop halt annotations (the plan halts at DISPATCHED, GC-2). */
  readonly unknownHops: readonly UnknownHopRef[];
  readonly createdAt: ProtocolTime;
  readonly stateChangedAt: ProtocolTime;
}

/**
 * RouteDemandSignal — the demand signal NO_VIABLE_ROUTE emits for area 24,
 * with the emission point recorded. The signal is owned by the routing
 * domain and durably recorded; the area 24 consumer (the follow-on wave's
 * emergence surface) reads the recorded signals. The signal id is derived
 * from the compilation key (intent id, compiler version, snapshot id), so
 * repeated compilation of the same key emits the signal exactly once.
 *
 * Source: core.md lines 253-254 — "NO_VIABLE_ROUTE is a terminal failure
 * that also emits a demand signal for area 24."
 */
export interface RouteDemandSignal {
  /** deriveProtocolId('route-demand-signal', intentId, compilerVersion, snapshotId). */
  readonly signalId: string;
  readonly intentId: string;
  readonly compilerVersion: number;
  readonly snapshotId: string;
  /** The corridor the demand asked for (from the intent terms). */
  readonly requestedCorridor: Corridor;
  /** The demanded amount (the intent amount, source leg). */
  readonly amount: Money;
  /**
   * The emission point: the derived record id of the ROUTE_FAILED evidence
   * record that carries the NO_VIABLE_ROUTE outcome (the point in the A15
   * log where the demand signal was emitted).
   */
  readonly emissionPointRecordId: string;
  readonly emittedAt: ProtocolTime;
}

/**
 * One explicit conversion quote supplied with a compilation request — the
 * recorded-fact source of INV-4-1's "explicit, recorded conversion amounts".
 * A quote maps one currency pair to an explicit (from-amount, to-amount)
 * integer pair; the compiler applies a quote only when the from-amount
 * EXACTLY equals the value flowing into the hop it converts (conversions
 * are recorded facts, never derived by rate arithmetic). The schedule is
 * keyed by currency pair: one quote per pair per compilation request.
 *
 * Interpretation (recorded in CONTRACT-REVIEW.md): core.md names the
 * compiler a function of (intent terms, policy evaluation, capability
 * snapshot) — the three authority inputs of areas 1-3. The conversion
 * schedule carries no authority semantics of its own: it is the caller's
 * recorded conversion facts (in the full protocol, supplied by the
 * liquidity/quote surfaces of the later waves), exactly the "explicit,
 * recorded conversion amounts" INV-4-1 requires the plan to carry. Without
 * a quote for a currency change, that change is unrecordable and the chain
 * containing it fails compilation (NO_VIABLE_ROUTE).
 *
 * Source: core.md lines 239-244 (INV-4-1); README.md §3 GC-1 (no floating
 * point — the compiler does no rate arithmetic at all).
 */
export interface ConversionQuote {
  readonly fromCurrency: string;
  readonly toCurrency: string;
  readonly fromAmount: Money;
  readonly toAmount: Money;
}

/**
 * The typed rejection codes of the Routing Authority's command surface
 * (domain rejections are typed values, never thrown — the merged rails
 * command convention). Rejections emit NO evidence: a refused command
 * mutates no state, and A04's named evidence set is exhaustive (the
 * RTN-005 precedent).
 *
 * Source: core.md lines 263-265 (the exhaustive named set); the rails
 * typed-rejection convention (src/lib/protocol-runtime/rails/authority.ts).
 */
export const ROUTE_REJECTION_CODES: readonly [
  'PLAN_NOT_FOUND',
  'ILLEGAL_TRANSITION',
  'VALIDATION_FAILED',
  'UNRESOLVED_UNKNOWN_HOP',
  'NO_UNKNOWN_HOP',
  'HOP_ALREADY_HALTED',
  'RESERVATION_NOT_HELD',
  'REASON_CODE_REQUIRED',
] = Object.freeze([
  'PLAN_NOT_FOUND',
  'ILLEGAL_TRANSITION',
  'VALIDATION_FAILED',
  'UNRESOLVED_UNKNOWN_HOP',
  'NO_UNKNOWN_HOP',
  'HOP_ALREADY_HALTED',
  'RESERVATION_NOT_HELD',
  'REASON_CODE_REQUIRED',
] as const);

/** A Routing Authority rejection code. Source: the frozen list above. */
export type RouteRejectionCode = (typeof ROUTE_REJECTION_CODES)[number];

/**
 * The outcome of a Routing Authority command: the updated plan on success;
 * a typed rejection code with a deterministic problem description on
 * refusal.
 *
 * Source: core.md lines 224-230 (the state machines the commands drive);
 * INV-4-2/INV-4-3 (the invariants the guards enforce).
 */
export type RouteCommandResult =
  | {
      readonly ok: true;
      readonly plan: RoutePlan;
    }
  | {
      readonly ok: false;
      readonly code: RouteRejectionCode;
      readonly problem: string;
    };

/**
 * The outcome of a compilation command: the recorded plan (replayed: true
 * when the compilation key already had the identical plan recorded — INV-4-3
 * "identical inputs return the identical plan"), or the reason-coded
 * terminal failure NO_VIABLE_ROUTE (which the authority evidences as
 * ROUTE_FAILED and pairs with the area-24 demand-signal emission), or a
 * typed command rejection.
 *
 * Source: core.md lines 227-230 (RouteCompiler); INV-4-3 lines 248-249;
 * lines 253-254 (NO_VIABLE_ROUTE + demand signal).
 */
export type RouteCompilationResult =
  | {
      readonly ok: true;
      readonly replayed: boolean;
      readonly plan: RoutePlan;
    }
  | {
      /** The terminal compilation failure (NO_VIABLE_ROUTE). */
      readonly ok: false;
      readonly terminal: true;
      readonly reasonCode: 'NO_VIABLE_ROUTE';
      readonly problem: string;
      /** The demand signal emitted for area 24 (emission point recorded). */
      readonly demandSignal: RouteDemandSignal;
    }
  | {
      readonly ok: false;
      readonly terminal: false;
      readonly code: RouteRejectionCode;
      readonly problem: string;
    };

/**
 * The area-5 dependency of dispatch — the reservation acquisition port
 * (core.md lines 272-273: "Depends on areas 1-3 for inputs and area 5 for
 * reservation acquisition during dispatch"). The kernel declares the
 * EvidenceSubmission port the same way (dependency inversion): routing
 * declares the port; the Reservation Authority (this work order's
 * reservations module) implements it over the ReservationLedger
 * (reservations/acquisition.ts).
 *
 * The port's request operation is INV-4-2's acquisition step ("dispatch
 * acquires reservations (area 5) in the plan's fixed hop order"); the
 * consume/release operations carry the plan-terminal discipline of area 5's
 * UNKNOWN semantics ("they are then consumed or released exactly once
 * (GC-2)", core.md lines 319-322) so a completing, failing, or abandoned
 * plan drives its own reservations' terminals exactly once.
 *
 * Source: core.md lines 245-247 (INV-4-2), 272-273, 319-322; INV-5-3
 * lines 310-312 (the derived reservation ids referenced by request).
 */
export interface ReservationAcquisitionRequest {
  readonly intentId: string;
  readonly hopId: string;
  readonly resourceId: string;
  readonly amount: Money;
  readonly deadlineEpochMs: number;
}

/**
 * The result of one reservation request through the port: the acquired
 * (HELD) reservation's id, or a typed failure (a recorded rejection such
 * as INSUFFICIENT_AVAILABLE, or a command-level rejection such as
 * RESOURCE_NOT_DECLARED — both deterministic outcomes of the ledger's
 * serialized decision).
 *
 * Source: core.md lines 245-247 (INV-4-2); INV-5-2 lines 307-309 ("a
 * REQUESTED transition either becomes HELD or is rejected — never left
 * ambiguous").
 */
export type ReservationAcquisitionResult =
  | { readonly ok: true; readonly reservationId: string }
  | { readonly ok: false; readonly code: string; readonly problem: string };

/**
 * The result of one reservation terminal operation through the port.
 *
 * Source: core.md lines 319-322 ("consumed or released exactly once").
 */
export type ReservationTerminalResult =
  | { readonly ok: true; readonly terminal: 'CONSUMED' | 'RELEASED' | 'EXPIRED' | 'NOT_HELD' }
  | { readonly ok: false; readonly code: string; readonly problem: string };

/**
 * The reservation acquisition port — routing's view of area 5 during
 * dispatch and plan-terminal transitions.
 *
 * Source: core.md lines 245-247, 272-273, 310-312, 319-322.
 */
export interface ReservationAcquisition {
  /** Acquire (request) one reservation — INV-4-2's dispatch step. */
  request(request: ReservationAcquisitionRequest): Promise<ReservationAcquisitionResult>;
  /** Consume one reservation (exactly-once terminal). */
  consume(reservationId: string): Promise<ReservationTerminalResult>;
  /** Release one reservation (exactly-once terminal). */
  release(reservationId: string): Promise<ReservationTerminalResult>;
  /**
   * The reservation's current state, or undefined when no such reservation
   * is recorded — the dispatch unwind and terminal transitions release only
   * what is still HELD ("consumed or released exactly once").
   */
  stateOf(
    reservationId: string,
  ): 'REQUESTED' | 'HELD' | 'CONSUMED' | 'RELEASED' | 'EXPIRED' | undefined;
}
