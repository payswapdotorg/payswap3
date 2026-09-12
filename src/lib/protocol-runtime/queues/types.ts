/**
 * RTN-007 — Queue Authority: the A08 type vocabulary, state machine
 * tables, record shapes, and runtime guards.
 *
 * Spec sources (binding) — spec/architecture/v0.1/liquidity-credit-queues.md
 * §3 Area 8:
 *   lines 151-175 (Core objects and state, verbatim):
 *     "FulfillmentQueue — ordered waiting area with an eligibility rule
 *      (resource availability, capability tier, deadline class).
 *      States: OPEN -> DRAINING -> PAUSED -> CLOSED."
 *     "QueuedItem — one waiting intent (or route plan awaiting dispatch).
 *      States: QUEUED -> ELIGIBLE -> DISPATCHED ->
 *      terminal(GRADUATED | CANCELLED | EXPIRED).
 *      GRADUATED means downstream fulfillment completed; the evidence
 *      chain links the item to the final outcome."
 *     "QueuePolicy — immutable per-queue policy: ordering rule, max wait,
 *      release conditions. Ordering is deterministic: priority class,
 *      then sequence number."
 *   lines 151-159 (Purpose):
 *     "Define how intents whose fulfillment cannot proceed now — because
 *      liquidity, credit, capability, or policy conditions are not met —
 *      wait deterministically in queues until they become eligible, expire,
 *      or are cancelled. Queues never duplicate work and never blindly
 *      re-attempt external effects."
 *   lines 177-178 (Owning authority):
 *     "Queue Authority (protocol layer, area 8) owns queue and item
 *      state."
 *   lines 181-193 (INV-8-1 / INV-8-2 / INV-8-3 / INV-8-4, quoted in the
 *     enforcing modules: the immutable terms, the serializer, the
 *     transition replay keying, and the no-blind-retry machine).
 *   lines 195-204 (failure and UNKNOWN semantics — eligibility from
 *     protocol-owned snapshots, never rail probing; UNKNOWN items stay
 *     DISPATCHED; confirmation graduates, confirmed failure cancels).
 *   lines 206-210 (evidence produced — the six ITEM_* types, each with
 *     queue sequence and reason codes where applicable).
 *   lines 212-219 (boundaries — "Queues hold intents and plans, never
 *     money; no balances are mutated here"; no business retry policies;
 *     "Depends on areas 1-7 for inputs, areas 9-14 for downstream
 *     outcomes").
 *   spec/architecture/v0.1/core.md §1 Area 1 lines 54-56 (INV-1-1 — the
 *     fixed monetary terms INV-8-1 references).
 *   spec/architecture/v0.1/README.md §3 GC-1/GC-2/GC-5.
 *   spec/registry/protocol-registry.json A08 — owningAuthority:
 *     "Queue Authority".
 *
 * Transition-table interpretation (recorded in CONTRACT-REVIEW.md):
 *   - FulfillmentQueue: the exact one-way chain OPEN -> DRAINING ->
 *     PAUSED -> CLOSED (no PAUSED -> DRAINING resume edge; no closure
 *     from OPEN or DRAINING). Resumption is queue replacement (a new
 *     queue), exactly like a frozen pool's wind-down — the spec-literal
 *     reading of "All three state machines exact".
 *   - QueuedItem: the linear chain is the happy path; the Purpose's own
 *     semantics ("wait deterministically in queues until they become
 *     eligible, expire, or are cancelled") make expiry and cancellation
 *     load-bearing from the WAITING states, and the failure semantics
 *     ("confirmation graduates the item; confirmed failure cancels it")
 *     make both terminals load-bearing from DISPATCHED — the same
 *     rule RTN-006 applied when its area's own semantics added the
 *     REQUESTED -> RELEASED edge to the reservation chain:
 *       QUEUED     -> ELIGIBLE | CANCELLED | EXPIRED
 *       ELIGIBLE   -> DISPATCHED | CANCELLED | EXPIRED
 *       DISPATCHED -> GRADUATED | CANCELLED
 *     There is NO edge out of DISPATCHED back to QUEUED or ELIGIBLE and
 *     no re-dispatch edge: INV-8-4's "it is never re-queued or
 *     re-dispatched until reconciliation resolves the operation" is
 *     STRUCTURAL — the machine itself cannot express a retry.
 */

import type { Money } from '../kernel/money.ts';
import type { ProtocolTime } from '../kernel/time.ts';

/**
 * The FulfillmentQueue state vocabulary, verbatim from the v0.1 chain.
 *
 * Source: liquidity-credit-queues.md lines 163-165 — "States: OPEN ->
 * DRAINING -> PAUSED -> CLOSED."
 */
export const QUEUE_STATES: readonly ['OPEN', 'DRAINING', 'PAUSED', 'CLOSED'] = Object.freeze([
  'OPEN',
  'DRAINING',
  'PAUSED',
  'CLOSED',
] as const);

/**
 * A FulfillmentQueue state. CLOSED is terminal.
 *
 * Source: liquidity-credit-queues.md lines 163-165.
 */
export type QueueState = (typeof QUEUE_STATES)[number];

/**
 * The frozen one-way FulfillmentQueue transition table — the exact v0.1
 * chain. Dispatch (item ELIGIBLE -> DISPATCHED) requires the queue to be
 * DRAINING (the actively-dispatching state); closure requires PAUSED
 * with every resident item terminal.
 *
 * Source: liquidity-credit-queues.md lines 163-165.
 */
export const QUEUE_TRANSITIONS: Readonly<Record<QueueState, readonly QueueState[]>> =
  Object.freeze({
    OPEN: Object.freeze(['DRAINING'] as const),
    DRAINING: Object.freeze(['PAUSED'] as const),
    PAUSED: Object.freeze(['CLOSED'] as const),
    CLOSED: Object.freeze([] as const),
  });

/**
 * Runtime type guard for QueueState.
 *
 * Source: liquidity-credit-queues.md lines 163-165.
 */
export function isQueueState(value: unknown): value is QueueState {
  return typeof value === 'string' && (QUEUE_STATES as readonly string[]).includes(value);
}

/**
 * True iff the (from, to) pair is a legal one-way FulfillmentQueue
 * transition.
 *
 * Source: liquidity-credit-queues.md lines 163-165.
 */
export function canTransitionQueue(from: QueueState, to: QueueState): boolean {
  return QUEUE_TRANSITIONS[from].includes(to);
}

/**
 * The QueuedItem state vocabulary, verbatim from the v0.1 chain.
 *
 * Source: liquidity-credit-queues.md lines 168-169 — "States: QUEUED ->
 * ELIGIBLE -> DISPATCHED -> terminal(GRADUATED | CANCELLED | EXPIRED)."
 */
export const ITEM_STATES: readonly [
  'QUEUED',
  'ELIGIBLE',
  'DISPATCHED',
  'GRADUATED',
  'CANCELLED',
  'EXPIRED',
] = Object.freeze(['QUEUED', 'ELIGIBLE', 'DISPATCHED', 'GRADUATED', 'CANCELLED', 'EXPIRED'] as const);

/**
 * A QueuedItem state. GRADUATED, CANCELLED, and EXPIRED are terminal
 * ("terminal(GRADUATED | CANCELLED | EXPIRED)").
 *
 * Source: liquidity-credit-queues.md lines 168-169.
 */
export type ItemState = (typeof ITEM_STATES)[number];

/**
 * The frozen one-way QueuedItem transition table — the v0.1 chain plus
 * the waiting-state expiry/cancellation edges the area's own Purpose and
 * failure semantics make load-bearing (see the module doc). Every
 * terminal has an empty successor set; NO edge leaves DISPATCHED except
 * GRADUATED and CANCELLED — the structural INV-8-4.
 *
 * Source: liquidity-credit-queues.md lines 151-159 (Purpose), lines
 * 168-169 (the chain), lines 195-204 (failure semantics).
 */
export const ITEM_TRANSITIONS: Readonly<Record<ItemState, readonly ItemState[]>> =
  Object.freeze({
    QUEUED: Object.freeze(['ELIGIBLE', 'CANCELLED', 'EXPIRED'] as const),
    ELIGIBLE: Object.freeze(['DISPATCHED', 'CANCELLED', 'EXPIRED'] as const),
    DISPATCHED: Object.freeze(['GRADUATED', 'CANCELLED'] as const),
    GRADUATED: Object.freeze([] as const),
    CANCELLED: Object.freeze([] as const),
    EXPIRED: Object.freeze([] as const),
  });

/**
 * Runtime type guard for ItemState.
 *
 * Source: liquidity-credit-queues.md lines 168-169.
 */
export function isItemState(value: unknown): value is ItemState {
  return typeof value === 'string' && (ITEM_STATES as readonly string[]).includes(value);
}

/**
 * True iff the (from, to) pair is a legal one-way QueuedItem transition.
 *
 * Source: liquidity-credit-queues.md lines 151-159, 168-169, 195-204.
 */
export function canTransitionItem(from: ItemState, to: ItemState): boolean {
  return ITEM_TRANSITIONS[from].includes(to);
}

/**
 * The deterministic ordering rule constant — "Ordering is deterministic:
 * priority class, then sequence number" (the ONE rule the spec names; the
 * policy carries it as immutable data, not as a configurable).
 *
 * Source: liquidity-credit-queues.md lines 173-175.
 */
export const QUEUE_ORDERING_RULE = 'PRIORITY_CLASS_THEN_SEQUENCE_NUMBER' as const;

/**
 * The A08 reason-code vocabulary — the machine-readable codes the ITEM_*
 * records' outcome slots carry ("each with queue sequence and reason
 * codes where applicable"). Members (each grounded, see
 * CONTRACT-REVIEW.md):
 *   - ENQUEUED / ELIGIBLE_PER_POLICY / DISPATCHED_IN_ORDER — the forward
 *     transitions' reasons (lines 168-170, 173-175).
 *   - INTENT_CANCELLED / ROUTE_FAILED_DETERMINISTIC — the cancellation
 *     reasons ("the item moves to CANCELLED with a reason code", lines
 *     201-204; intent cancellation, lines 151-159).
 *   - MAX_WAIT_EXCEEDED — the expiry reason (QueuePolicy "max wait",
 *     lines 173-175).
 *   - RECONCILIATION_CONFIRMED / RECONCILIATION_FAILED — the resolution
 *     reasons ("confirmation graduates the item; confirmed failure
 *     cancels it", lines 201-204).
 *
 * Source: liquidity-credit-queues.md lines 151-204, 206-210; A15 line 30.
 */
export const QUEUE_REASON_CODES: readonly [
  'ENQUEUED',
  'ELIGIBLE_PER_POLICY',
  'DISPATCHED_IN_ORDER',
  'INTENT_CANCELLED',
  'ROUTE_FAILED_DETERMINISTIC',
  'MAX_WAIT_EXCEEDED',
  'RECONCILIATION_CONFIRMED',
  'RECONCILIATION_FAILED',
] = Object.freeze([
  'ENQUEUED',
  'ELIGIBLE_PER_POLICY',
  'DISPATCHED_IN_ORDER',
  'INTENT_CANCELLED',
  'ROUTE_FAILED_DETERMINISTIC',
  'MAX_WAIT_EXCEEDED',
  'RECONCILIATION_CONFIRMED',
  'RECONCILIATION_FAILED',
] as const);

/** An A08 reason code. Source: the frozen vocabulary above. */
export type QueueReasonCode = (typeof QUEUE_REASON_CODES)[number];

/**
 * Runtime type guard for QueueReasonCode.
 *
 * Source: A15 line 30 (the reason-code contract this guards).
 */
export function isQueueReasonCode(value: unknown): value is QueueReasonCode {
  return typeof value === 'string' && (QUEUE_REASON_CODES as readonly string[]).includes(value);
}

/**
 * The eligibility release conditions of one QueuePolicy — the declarative
 * form of "an eligibility rule (resource availability, capability tier,
 * deadline class)": conditions are evaluated against protocol-owned
 * snapshots (areas 3, 6, 7), never by probing rails.
 *
 * Source: liquidity-credit-queues.md lines 163-165 (the eligibility
 * rule), lines 197-199 ("Eligibility that depends on external state is
 * evaluated from protocol-owned snapshots (areas 3, 6, 7), never by
 * probing rails").
 */
export interface QueueReleaseConditions {
  /** Area 3: the minimum capability tier some ACTIVE capability must expose. */
  readonly requiredCapabilityTier?: string;
  /** Area 6: the minimum available liquidity some pool must hold (one currency). */
  readonly minLiquidityAvailable?: Money;
  /** Area 7: the minimum remaining credit capacity some ACTIVE line must hold. */
  readonly minCreditRemaining?: Money;
}

/**
 * QueuePolicy — the immutable per-queue policy: ordering rule, max wait,
 * release conditions. Frozen at queue creation; no mutation path exists
 * anywhere in this domain ("immutable per-queue policy").
 *
 * Source: liquidity-credit-queues.md lines 173-175.
 */
export interface QueuePolicy {
  /** The fixed deterministic ordering rule (QUEUE_ORDERING_RULE). */
  readonly orderingRule: typeof QUEUE_ORDERING_RULE;
  /**
   * The maximum wait in integer epoch milliseconds: an item whose wait
   * reaches the max is EXPIRED (deterministic on protocol time).
   */
  readonly maxWaitEpochMs: number;
  /** The eligibility release conditions (evaluated over snapshots). */
  readonly releaseConditions: QueueReleaseConditions;
}

/**
 * FulfillmentQueue — the ordered waiting area with its eligibility rule.
 * The policy is immutable data carried by the record.
 *
 * Source: liquidity-credit-queues.md lines 163-165, 173-175.
 */
export interface FulfillmentQueueRecord {
  readonly queueId: string;
  readonly state: QueueState;
  readonly policy: QueuePolicy;
  /** The next queue sequence number to assign at enqueue (monotonic). */
  readonly nextSequence: number;
  readonly createdAt: ProtocolTime;
  readonly stateChangedAt: ProtocolTime;
}

/**
 * The intent's fixed monetary terms, carried by reference per INV-8-1:
 * "queuing never changes monetary terms; the item references the intent's
 * fixed terms (INV-1-1)". Set once at enqueue, deep-frozen, with NO
 * command accepting terms as input — the terms are immutable by
 * construction (there is no code path that can change them).
 *
 * Source: liquidity-credit-queues.md lines 182-184; core.md lines 54-56
 * ("monetary terms are fixed at AUTHORIZATION").
 */
export interface FixedIntentTerms {
  readonly intentId: string;
  /** The fixed monetary terms (INV-1-1) — immutable, single-currency Money. */
  readonly terms: Money;
}

/**
 * QueuedItem — one waiting intent (or route plan awaiting dispatch). The
 * item id is derived from (queue id, intent id) — deterministic; the
 * queue sequence is the per-queue arrival position (the ordering's
 * tie-breaker).
 *
 * Source: liquidity-credit-queues.md lines 167-170, 173-175.
 */
export interface QueuedItemRecord {
  readonly itemId: string;
  readonly queueId: string;
  readonly intentId: string;
  /** The item's priority class (lower value = dispatched earlier). */
  readonly priorityClass: number;
  /** The item's queue sequence (arrival position; the ordering tie-breaker). */
  readonly queueSequence: number;
  readonly state: ItemState;
  /** The intent's fixed monetary terms (INV-8-1) — immutable by construction. */
  readonly terms: FixedIntentTerms;
  /** The enqueue wall time — the max-wait clock's zero point. */
  readonly enqueuedAtWallMs: number;
  readonly enqueuedAt: ProtocolTime;
  readonly stateChangedAt: ProtocolTime;
  /** The reconciliation linkage of a DISPATCHED item (INV-8-4). */
  readonly linkedOperationId?: string;
  readonly reasonCode?: QueueReasonCode;
}

/**
 * The protocol-owned eligibility snapshot — the areas 3/6/7 views the
 * eligibility evaluation consumes. The composition root fills these from
 * the real authorities (the Capability Authority's snapshot, the
 * Liquidity Authority's pool views, the Credit Authority's line views);
 * the Queue Authority NEVER probes rails and imports no rail surface at
 * all.
 *
 * Source: liquidity-credit-queues.md lines 197-199 ("Eligibility that
 * depends on external state is evaluated from protocol-owned snapshots
 * (areas 3, 6, 7), never by probing rails").
 */
export interface ProtocolEligibilitySnapshot {
  /** Area 6 views: pool id + available balance (the Liquidity Authority's). */
  readonly liquidity: readonly { readonly poolId: string; readonly available: Money }[];
  /** Area 3 views: capability id + tier + state (the Capability Authority's). */
  readonly capability: readonly { readonly capabilityId: string; readonly tier: string; readonly state: string }[];
  /** Area 7 views: line id + remaining capacity (the Credit Authority's). */
  readonly credit: readonly { readonly lineId: string; readonly remaining: Money }[];
  /** The snapshot's protocol time (the evaluation is deterministic in it). */
  readonly at: ProtocolTime;
}

/**
 * The typed rejection codes of the Queue Authority's command surface
 * (domain rejections are typed values, never thrown — the merged rails
 * command convention). Rejections emit NO evidence: a refused command
 * mutates no state, and A08's named evidence set is exhaustive.
 *
 * Source: liquidity-credit-queues.md lines 206-210 (the exhaustive named
 * set); the rails typed-rejection convention.
 */
export const QUEUE_REJECTION_CODES: readonly [
  'QUEUE_NOT_FOUND',
  'QUEUE_CLOSED',
  'QUEUE_NOT_DRAINING',
  'QUEUE_HAS_RESIDENT_ITEMS',
  'ITEM_NOT_FOUND',
  'ITEM_ALREADY_RESIDENT',
  'ITEM_NOT_ELIGIBLE',
  'ILLEGAL_TRANSITION',
] = Object.freeze([
  'QUEUE_NOT_FOUND',
  'QUEUE_CLOSED',
  'QUEUE_NOT_DRAINING',
  'QUEUE_HAS_RESIDENT_ITEMS',
  'ITEM_NOT_FOUND',
  'ITEM_ALREADY_RESIDENT',
  'ITEM_NOT_ELIGIBLE',
  'ILLEGAL_TRANSITION',
] as const);

/** A Queue Authority rejection code. Source: the frozen list above. */
export type QueueRejectionCode = (typeof QUEUE_REJECTION_CODES)[number];

/**
 * Runtime type guard for QueueRejectionCode.
 *
 * Source: the typed-rejection convention (the frozen list above).
 */
export function isQueueRejectionCode(value: unknown): value is QueueRejectionCode {
  return typeof value === 'string' && (QUEUE_REJECTION_CODES as readonly string[]).includes(value);
}

/**
 * The outcome of every Queue Authority command: the updated record on
 * success (replayed: true for an idempotent replay of an
 * already-recorded effect — no second effect, no second evidence
 * record), or a typed rejection.
 *
 * Source: INV-8-3 lines 187-189 (the replay discipline); the merged
 * typed-result convention.
 */
export type QueueCommandResult<T> =
  | {
      readonly ok: true;
      readonly replayed: boolean;
      readonly record: T;
    }
  | {
      readonly ok: false;
      readonly code: QueueRejectionCode;
      readonly problem: string;
    };

/**
 * The resolution classes a DISPATCHED item's linked reconciliation case
 * accepts — exactly the UNKNOWN-operation terminal resolutions of area
 * 14 ("confirmation graduates the item; confirmed failure cancels it").
 *
 * Source: liquidity-credit-queues.md lines 201-204;
 * rails-adapters-reconciliation.md lines 121-123, 171-179.
 */
export const DISPATCH_RESOLUTIONS: readonly ['RESOLVED_CONFIRMED', 'RESOLVED_FAILED'] = Object.freeze([
  'RESOLVED_CONFIRMED',
  'RESOLVED_FAILED',
] as const);

/**
 * One dispatch resolution class. Source: the frozen vocabulary above.
 */
export type DispatchResolution = (typeof DISPATCH_RESOLUTIONS)[number];

/**
 * Runtime type guard for DispatchResolution.
 *
 * Source: rails-adapters-reconciliation.md lines 171-179.
 */
export function isDispatchResolution(value: unknown): value is DispatchResolution {
  return typeof value === 'string' && (DISPATCH_RESOLUTIONS as readonly string[]).includes(value);
}
