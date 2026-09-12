/**
 * RTN-007 — Queue Authority: the composed single-writer command surface
 * for area 8 (A08).
 *
 * Spec sources (binding) — spec/architecture/v0.1/liquidity-credit-queues.md
 * §3 Area 8:
 *   lines 163-175 (the three objects and their exact state machines,
 *     quoted in types.ts).
 *   lines 177-178 (Owning authority):
 *     "Queue Authority (protocol layer, area 8) owns queue and item
 *      state."
 *   lines 181-193 (the four invariants this authority enforces):
 *     "INV-8-1 (financial correctness): queuing never changes monetary
 *      terms; the item references the intent's fixed terms (INV-1-1).
 *      INV-8-2 (concurrency): an item is resident in exactly one queue;
 *      eligibility evaluation is serialized per queue; no item is
 *      dispatched twice — dispatch is exactly-once per item id.
 *      INV-8-3 (idempotency): item state transitions are keyed by
 *      (item id, transition); replays return the recorded state.
 *      INV-8-4 (no blind retry): when a dispatched item's downstream rail
 *      operation is UNKNOWN, the item stays DISPATCHED; it is never
 *      re-queued or re-dispatched until reconciliation resolves the
 *      operation (GC-2)."
 *   lines 195-204 (failure and UNKNOWN semantics, verbatim):
 *     "Queue mechanics are internal and deterministic. Eligibility that
 *      depends on external state is evaluated from protocol-owned
 *      snapshots (areas 3, 6, 7), never by probing rails. If a dispatched
 *      item's route fails deterministically, the item moves to CANCELLED
 *      with a reason code; if the underlying rail operation is UNKNOWN, the
 *      item remains DISPATCHED and the linked reconciliation case drives
 *      recovery: confirmation graduates the item; confirmed failure
 *      cancels it."
 *   lines 206-210 (evidence produced); lines 212-219 (boundaries).
 *   spec/architecture/v0.1/README.md §3 GC-1/GC-2/GC-4/GC-5.
 *
 * Command discipline:
 *   - INV-8-1 is STRUCTURAL: the item's terms are set once at enqueue
 *     (deep-frozen) and NO command accepts terms as input — there is no
 *     code path that can change them; every test asserts deep-equality
 *     after every transition.
 *   - INV-8-2: the item-residency registry is global per authority (an
 *     item id can be resident in exactly one queue — re-enqueue of a
 *     resident id is the typed ITEM_ALREADY_RESIDENT rejection); every
 *     queue command runs inside the per-queue keyed serializer; dispatch
 *     is exactly-once per item id (the machine has no re-dispatch edge,
 *     and a repeat dispatch returns the recorded DISPATCHED state).
 *   - INV-8-3: transitions are keyed by (item id, transition) — every
 *     command checks the recorded state first and returns the recorded
 *     record on replay (no second effect, no second evidence record).
 *   - INV-8-4: dispatch links the item to its downstream operation id; a
 *     DISPATCHED item has exactly two possible next states (GRADUATED,
 *     CANCELLED), reachable ONLY through the reconciliation resolution
 *     (resolveDispatchedItem) or a deterministic route failure; there is
 *     no retry or re-queue path anywhere in the surface.
 *   - Eligibility is evaluated ONLY from the caller-supplied
 *     protocol-owned snapshot (areas 3/6/7 views) — this module imports
 *     no rail surface at all and performs no I/O.
 *   - Every consequential operation submits its GC-5 evidence record
 *     FIRST (awaited) and commits state only after the write succeeds
 *     ("A failed write fails the operation", A15 lines 62-64).
 *   - Domain rejections are typed values, never thrown; input-shape
 *     violations throw TypeError (kernel convention).
 *
 * State layer (recorded in CONTRACT-REVIEW.md): in-process single writer —
 * the RTN-002/RTN-005 in-process-object-store precedent. The durable side
 * is persistence.ts + migrations/.
 */

import { deriveProtocolId } from '../kernel/identity.ts';
import { isMoney } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';
import type { EvidenceSubmission } from '../kernel/ports.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import {
  itemCancelledEvidence,
  itemDispatchedEvidence,
  itemEligibleEvidence,
  itemExpiredEvidence,
  itemGraduatedEvidence,
  itemQueuedEvidence,
  submitQueueEvidence,
} from './evidence.ts';
import { isEligibleUnderSnapshot, orderForDispatch } from './ordering.ts';
import { KeyedSerializer } from './serializer.ts';
import { isItemExpiredAtWallMs, transitionItem, transitionQueue } from './state-machine.ts';
import type {
  DispatchResolution,
  FixedIntentTerms,
  FulfillmentQueueRecord,
  ProtocolEligibilitySnapshot,
  QueuedItemRecord,
  QueueCommandResult,
  QueuePolicy,
  QueueRejectionCode,
  QueueReasonCode,
} from './types.ts';
import { isDispatchResolution } from './types.ts';

/**
 * Constructor dependencies for the Queue Authority.
 *
 * Source: the wave evidence discipline (the REAL RTN-002 log through the
 * kernel port); the wallClock-injection convention for deterministic
 * tests.
 */
export interface QueueAuthorityDeps {
  /** The EvidenceSubmission port — the real RTN-002 EvidenceLog. */
  readonly evidence: EvidenceSubmission;
  /** Injectable wall clock (epoch ms) for deterministic tests; default Date.now. */
  readonly wallClock?: () => number;
}

/** One command's rejection (typed, never thrown). */
export interface QueueRejection {
  readonly ok: false;
  readonly code: QueueRejectionCode;
  readonly problem: string;
}

/**
 * The Queue Authority: sole writer of queue and item state (GC-4).
 * Commands: createQueue (with the immutable QueuePolicy) / startDraining
 * / pauseQueue / closeQueue (the exact queue machine);
 * enqueueItem (INV-8-1 terms by reference, INV-8-2 residency);
 * evaluateEligibility (snapshot-driven, serialized per queue);
 * dispatchNext (the deterministic order, exactly-once);
 * resolveDispatchedItem (INV-8-4 — the reconciliation resolution);
 * cancelItem (reason-coded); expireDueItems (the deterministic max wait).
 *
 * Source: liquidity-credit-queues.md lines 163-219.
 */
export class QueueAuthority {
  private readonly evidence: EvidenceSubmission;
  private readonly wallClock: () => number;
  private readonly serializer = new KeyedSerializer();
  private readonly queues = new Map<string, FulfillmentQueueRecord>();
  private readonly items = new Map<string, QueuedItemRecord>();
  private readonly itemsByQueue = new Map<string, string[]>();
  /** The global residency registry (INV-8-2: exactly one queue per item id). */
  private readonly residentItemIds = new Set<string>();
  private protocolSequence = 0;

  constructor(deps: QueueAuthorityDeps) {
    if (
      deps.evidence === null ||
      typeof deps.evidence !== 'object' ||
      typeof deps.evidence.submit !== 'function'
    ) {
      throw new TypeError('queue authority: deps.evidence must be an EvidenceSubmission port');
    }
    this.evidence = deps.evidence;
    this.wallClock = deps.wallClock ?? (() => Date.now());
  }

  private nextTime(): ProtocolTime {
    const when = protocolTime(this.protocolSequence, this.wallClock());
    this.protocolSequence += 1;
    return when;
  }

  // -------------------------------------------------------------------------
  // Queue machine (OPEN -> DRAINING -> PAUSED -> CLOSED, exact)
  // -------------------------------------------------------------------------

  /**
   * Create a queue with its IMMUTABLE policy — the ordering rule (the
   * fixed deterministic rule), the max wait, and the release conditions.
   * The policy record is deep-frozen; no mutation path exists
   * ("immutable per-queue policy").
   *
   * Source: liquidity-credit-queues.md lines 163-165, 173-175.
   */
  async createQueue(input: {
    readonly queueId: string;
    readonly policy: QueuePolicy;
  }): Promise<QueueCommandResult<FulfillmentQueueRecord>> {
    if (typeof input.queueId !== 'string' || input.queueId.length === 0) {
      throw new TypeError('queue authority: queueId must be a non-empty string');
    }
    assertPolicy(input.policy);
    return this.serializer.run(`queue:${input.queueId}`, async () => {
      const existing = this.queues.get(input.queueId);
      if (existing !== undefined) {
        if (policiesEqual(existing.policy, input.policy)) {
          return { ok: true as const, replayed: true, record: existing };
        }
        return rejection(
          'ILLEGAL_TRANSITION',
          `queue authority: queue ${input.queueId} already exists with a different policy (the policy is immutable)`,
        );
      }
      const when = this.nextTime();
      const queue: FulfillmentQueueRecord = deepFreeze({
        queueId: input.queueId,
        state: 'OPEN',
        policy: input.policy,
        nextSequence: 0,
        createdAt: when,
        stateChangedAt: when,
      });
      this.queues.set(queue.queueId, queue);
      this.itemsByQueue.set(queue.queueId, []);
      // No evidence record: queue state transitions are not financial-state
      // mutations under GC-5's definition ("Queues hold intents and plans,
      // never money") and A08's named set is exactly the six ITEM_* types
      // (CONTRACT-REVIEW interpretation).
      return { ok: true as const, replayed: false, record: queue };
    });
  }

  /**
   * Start draining — OPEN -> DRAINING (the actively-dispatching state:
   * dispatchNext requires DRAINING).
   *
   * Source: liquidity-credit-queues.md lines 163-165.
   */
  async startDraining(queueId: string): Promise<QueueCommandResult<FulfillmentQueueRecord>> {
    return this.queueTransition(queueId, 'DRAINING');
  }

  /**
   * Pause the queue — DRAINING -> PAUSED (dispatch halts; items may still
   * be enqueued, become eligible, cancel, and expire while paused).
   *
   * Source: liquidity-credit-queues.md lines 163-165.
   */
  async pauseQueue(queueId: string): Promise<QueueCommandResult<FulfillmentQueueRecord>> {
    return this.queueTransition(queueId, 'PAUSED');
  }

  /**
   * Close the queue — PAUSED -> CLOSED, terminal. Closure requires every
   * resident item terminal (a closed queue would otherwise trap live
   * items — INV-8-2's exactly-one-residency has no transfer path); the
   * typed QUEUE_HAS_RESIDENT_ITEMS rejection names the blocker.
   *
   * Source: liquidity-credit-queues.md lines 163-165; INV-8-2 lines
   * 185-187.
   */
  async closeQueue(queueId: string): Promise<QueueCommandResult<FulfillmentQueueRecord>> {
    if (typeof queueId !== 'string' || queueId.length === 0) {
      throw new TypeError('queue authority: queueId must be a non-empty string');
    }
    return this.serializer.run(`queue:${queueId}`, async () => {
      const queue = this.queues.get(queueId);
      if (queue === undefined) {
        return rejection('QUEUE_NOT_FOUND', `queue authority: queue ${queueId} is not recorded`);
      }
      if (queue.state === 'CLOSED') {
        return { ok: true as const, replayed: true, record: queue };
      }
      const resident = this.residentItemsOf(queueId);
      if (resident.length > 0) {
        return rejection(
          'QUEUE_HAS_RESIDENT_ITEMS',
          `queue authority: queue ${queueId} cannot close while ${resident.length} item(s) are ` +
            'still resident (cancel or expire them first — an item is resident in exactly one queue, ' +
            'INV-8-2)',
        );
      }
      const when = this.nextTime();
      const transition = transitionQueue(queue, 'CLOSED', when);
      if (!transition.ok) {
        return rejection(
          'ILLEGAL_TRANSITION',
          `queue authority: queue transition ${queue.state} -> CLOSED is not an edge of the exact v0.1 chain`,
        );
      }
      this.queues.set(queueId, deepFreeze(transition.queue));
      return { ok: true as const, replayed: false, record: transition.queue };
    });
  }

  private async queueTransition(
    queueId: string,
    to: 'DRAINING' | 'PAUSED',
  ): Promise<QueueCommandResult<FulfillmentQueueRecord>> {
    if (typeof queueId !== 'string' || queueId.length === 0) {
      throw new TypeError('queue authority: queueId must be a non-empty string');
    }
    return this.serializer.run(`queue:${queueId}`, async () => {
      const queue = this.queues.get(queueId);
      if (queue === undefined) {
        return rejection('QUEUE_NOT_FOUND', `queue authority: queue ${queueId} is not recorded`);
      }
      if (queue.state === to) {
        return { ok: true as const, replayed: true, record: queue };
      }
      const when = this.nextTime();
      const transition = transitionQueue(queue, to, when);
      if (!transition.ok) {
        return rejection(
          'ILLEGAL_TRANSITION',
          `queue authority: queue transition ${queue.state} -> ${to} is not an edge of the exact v0.1 chain`,
        );
      }
      this.queues.set(queueId, deepFreeze(transition.queue));
      return { ok: true as const, replayed: false, record: transition.queue };
    });
  }

  // -------------------------------------------------------------------------
  // Items (INV-8-1 terms by reference; INV-8-2 residency + dispatch;
  // INV-8-3 replay; INV-8-4 no blind retry)
  // -------------------------------------------------------------------------

  /**
   * Enqueue one waiting intent — the item referencing the intent's FIXED
   * monetary terms (INV-8-1: "queuing never changes monetary terms; the
   * item references the intent's fixed terms (INV-1-1)" — the terms are
   * stored deep-frozen and NO command accepts terms as input). The item
   * id is derived from (queue id, intent id) — deterministic; the queue
   * sequence is assigned at arrival. Residency is exclusive per item id
   * (INV-8-2): an already-resident id is the typed
   * ITEM_ALREADY_RESIDENT rejection; a REPLAYED enqueue of the same
   * recorded terminal item returns the recorded state (INV-8-3).
   * Queues accept items in every non-terminal state (OPEN, DRAINING,
   * PAUSED — waiting continues while paused; dispatch does not).
   *
   * Source: liquidity-credit-queues.md lines 167-170, 182-193.
   */
  async enqueueItem(input: {
    readonly queueId: string;
    readonly intentId: string;
    readonly priorityClass: number;
    readonly terms: FixedIntentTerms;
  }): Promise<QueueCommandResult<QueuedItemRecord>> {
    if (typeof input.intentId !== 'string' || input.intentId.length === 0) {
      throw new TypeError('queue authority: intentId must be a non-empty string');
    }
    if (typeof input.priorityClass !== 'number' || !Number.isInteger(input.priorityClass) || input.priorityClass < 0) {
      throw new TypeError('queue authority: priorityClass must be a non-negative integer (GC-1)');
    }
    if (input.terms === null || typeof input.terms !== 'object') {
      throw new TypeError('queue authority: terms must be a FixedIntentTerms value');
    }
    if (input.terms.intentId !== input.intentId) {
      throw new TypeError('queue authority: terms.intentId must match the enqueued intentId (INV-8-1)');
    }
    if (!isMoney(input.terms.terms)) {
      throw new TypeError('queue authority: terms.terms must be a kernel Money value (integer minor units, GC-1)');
    }
    if (input.terms.terms.amountMinor < 0) {
      throw new TypeError('queue authority: terms.terms must be non-negative (the fixed intent terms)');
    }
    const itemId = deriveProtocolId('queue-item', input.queueId, input.intentId);
    return this.serializer.run(`queue:${input.queueId}`, async () => {
      const queue = this.queues.get(input.queueId);
      if (queue === undefined) {
        return rejection('QUEUE_NOT_FOUND', `queue authority: queue ${input.queueId} is not recorded`);
      }
      if (queue.state === 'CLOSED') {
        return rejection('QUEUE_CLOSED', `queue authority: queue ${input.queueId} is CLOSED`);
      }
      const existing = this.items.get(itemId);
      if (existing !== undefined) {
        if (this.residentItemIds.has(itemId)) {
          return rejection(
            'ITEM_ALREADY_RESIDENT',
            `queue authority: item ${itemId} is already resident in queue ${existing.queueId} ` +
              '(an item is resident in exactly one queue — INV-8-2)',
          );
        }
        // The recorded terminal item of a past lifecycle: the recorded
        // state (INV-8-3 — replays return the recorded state).
        return { ok: true as const, replayed: true, record: existing };
      }
      const when = this.nextTime();
      const item: QueuedItemRecord = deepFreeze({
        itemId,
        queueId: input.queueId,
        intentId: input.intentId,
        priorityClass: input.priorityClass,
        queueSequence: queue.nextSequence,
        state: 'QUEUED',
        terms: input.terms,
        enqueuedAtWallMs: when.wallMs,
        enqueuedAt: when,
        stateChangedAt: when,
      });
      await submitQueueEvidence(this.evidence, itemQueuedEvidence({ item, when }));
      this.items.set(itemId, item);
      this.residentItemIds.add(itemId);
      const residents = this.itemsByQueue.get(input.queueId) ?? [];
      residents.push(itemId);
      this.itemsByQueue.set(input.queueId, residents);
      this.queues.set(input.queueId, deepFreeze({ ...queue, nextSequence: queue.nextSequence + 1 }));
      return { ok: true as const, replayed: false, record: item };
    });
  }

  /**
   * Evaluate eligibility for the queue's waiting items from the
   * caller-supplied PROTOCOL-OWNED snapshot (areas 3/6/7 views) — "never
   * by probing rails": this module performs no I/O and imports no rail
   * surface. Serialized per queue (INV-8-2); each QUEUED item whose
   * release conditions hold moves QUEUED -> ELIGIBLE (deterministic
   * ascending queue-sequence order); replays are no-ops that return the
   * recorded state.
   *
   * Source: liquidity-credit-queues.md lines 163-165, 185-187, 197-199.
   */
  async evaluateEligibility(input: {
    readonly queueId: string;
    readonly snapshot: ProtocolEligibilitySnapshot;
  }): Promise<QueueCommandResult<readonly QueuedItemRecord[]>> {
    if (input.snapshot === null || typeof input.snapshot !== 'object') {
      throw new TypeError('queue authority: snapshot must be a ProtocolEligibilitySnapshot');
    }
    return this.serializer.run(`queue:${input.queueId}`, async () => {
      const queue = this.queues.get(input.queueId);
      if (queue === undefined) {
        return rejection('QUEUE_NOT_FOUND', `queue authority: queue ${input.queueId} is not recorded`);
      }
      const eligible: QueuedItemRecord[] = [];
      for (const item of this.residentItemsOf(input.queueId)) {
        if (item.state !== 'QUEUED') {
          continue;
        }
        if (isEligibleUnderSnapshot(queue.policy, item.terms.terms, input.snapshot)) {
          const updated = await this.transitionOne(item, 'ELIGIBLE', 'ELIGIBLE_PER_POLICY');
          eligible.push(updated);
        }
      }
      return { ok: true as const, replayed: false, record: Object.freeze(eligible) };
    });
  }

  /**
   * Dispatch the next item in the deterministic order (priority class,
   * then sequence number) — exactly-once per item id (INV-8-2): the
   * queue must be DRAINING, the item ELIGIBLE, and the dispatch links
   * the item to its downstream operation id (the reconciliation linkage
   * INV-8-4 rides). A repeat dispatch of the same item returns the
   * recorded DISPATCHED state (replay — no second effect, no second
   * record); the machine has no re-dispatch edge at all.
   *
   * Source: liquidity-credit-queues.md lines 168-170, 173-175, 185-187,
   * 190-193.
   */
  async dispatchNext(input: {
    readonly queueId: string;
    readonly linkedOperationId: string;
  }): Promise<QueueCommandResult<QueuedItemRecord>> {
    if (typeof input.linkedOperationId !== 'string' || input.linkedOperationId.length === 0) {
      throw new TypeError('queue authority: linkedOperationId must be a non-empty string');
    }
    return this.serializer.run(`queue:${input.queueId}`, async () => {
      const queue = this.queues.get(input.queueId);
      if (queue === undefined) {
        return rejection('QUEUE_NOT_FOUND', `queue authority: queue ${input.queueId} is not recorded`);
      }
      if (queue.state === 'CLOSED') {
        return rejection('QUEUE_CLOSED', `queue authority: queue ${input.queueId} is CLOSED`);
      }
      if (queue.state !== 'DRAINING') {
        return rejection(
          'QUEUE_NOT_DRAINING',
          `queue authority: queue ${input.queueId} is ${queue.state} (dispatch requires DRAINING)`,
        );
      }
      const waiting = orderForDispatch(
        this.residentItemsOf(input.queueId).filter((item) => item.state === 'ELIGIBLE'),
      );
      const next = waiting[0];
      if (next === undefined) {
        return rejection(
          'ITEM_NOT_ELIGIBLE',
          `queue authority: queue ${input.queueId} has no ELIGIBLE item to dispatch`,
        );
      }
      const updated = await this.applyDispatch(next, input.linkedOperationId);
      return { ok: true as const, replayed: false, record: updated };
    });
  }

  /**
   * Resolve a DISPATCHED item's linked reconciliation case — the ONLY
   * recovery path (INV-8-4: "confirmation graduates the item; confirmed
   * failure cancels it"). RESOLVED_CONFIRMED -> GRADUATED ("downstream
   * fulfillment completed; the evidence chain links the item to the final
   * outcome"); RESOLVED_FAILED -> CANCELLED. Replays return the recorded
   * terminal.
   *
   * Source: liquidity-credit-queues.md lines 190-193, 201-204;
   * rails-adapters-reconciliation.md lines 171-179; GC-2.
   */
  async resolveDispatchedItem(input: {
    readonly itemId: string;
    readonly resolution: DispatchResolution;
  }): Promise<QueueCommandResult<QueuedItemRecord>> {
    if (typeof input.itemId !== 'string' || input.itemId.length === 0) {
      throw new TypeError('queue authority: itemId must be a non-empty string');
    }
    if (!isDispatchResolution(input.resolution)) {
      throw new TypeError(
        'queue authority: resolution must be RESOLVED_CONFIRMED or RESOLVED_FAILED (area 14 vocabulary)',
      );
    }
    const item = this.items.get(input.itemId);
    if (item === undefined) {
      return rejection('ITEM_NOT_FOUND', `queue authority: item ${input.itemId} is not recorded`);
    }
    return this.serializer.run(`queue:${item.queueId}`, async () => {
      const current = this.items.get(input.itemId);
      if (current === undefined) {
        return rejection('ITEM_NOT_FOUND', `queue authority: item ${input.itemId} is not recorded`);
      }
      if (current.state === 'GRADUATED' || current.state === 'CANCELLED' || current.state === 'EXPIRED') {
        return { ok: true as const, replayed: true, record: current };
      }
      if (current.state !== 'DISPATCHED') {
        return rejection(
          'ILLEGAL_TRANSITION',
          `queue authority: item ${input.itemId} is ${current.state} (resolution applies to DISPATCHED items — INV-8-4)`,
        );
      }
      const target = input.resolution === 'RESOLVED_CONFIRMED' ? 'GRADUATED' : 'CANCELLED';
      const reasonCode: QueueReasonCode =
        input.resolution === 'RESOLVED_CONFIRMED' ? 'RECONCILIATION_CONFIRMED' : 'RECONCILIATION_FAILED';
      const updated = await this.transitionOne(current, target, reasonCode);
      return { ok: true as const, replayed: false, record: updated };
    });
  }

  /**
   * Cancel one item with a reason code — from the waiting states
   * (intent cancellation) or from DISPATCHED on a deterministic route
   * failure ("If a dispatched item's route fails deterministically, the
   * item moves to CANCELLED with a reason code"). A DISPATCHED item
   * whose rail operation is UNKNOWN is NOT cancellable through this
   * surface: its resolution is exclusively the reconciliation case
   * (resolveDispatchedItem) — the caller asserts the failure was
   * deterministic. Replays return the recorded terminal.
   *
   * Source: liquidity-credit-queues.md lines 151-159, 168-170, 201-204.
   */
  async cancelItem(input: {
    readonly itemId: string;
    readonly reasonCode: QueueReasonCode;
  }): Promise<QueueCommandResult<QueuedItemRecord>> {
    if (typeof input.itemId !== 'string' || input.itemId.length === 0) {
      throw new TypeError('queue authority: itemId must be a non-empty string');
    }
    if (
      input.reasonCode !== 'INTENT_CANCELLED' &&
      input.reasonCode !== 'ROUTE_FAILED_DETERMINISTIC'
    ) {
      throw new TypeError(
        'queue authority: a cancellation requires the INTENT_CANCELLED or ROUTE_FAILED_DETERMINISTIC reason code',
      );
    }
    const item = this.items.get(input.itemId);
    if (item === undefined) {
      return rejection('ITEM_NOT_FOUND', `queue authority: item ${input.itemId} is not recorded`);
    }
    return this.serializer.run(`queue:${item.queueId}`, async () => {
      const current = this.items.get(input.itemId);
      if (current === undefined) {
        return rejection('ITEM_NOT_FOUND', `queue authority: item ${input.itemId} is not recorded`);
      }
      if (current.state === 'CANCELLED') {
        return { ok: true as const, replayed: true, record: current };
      }
      if (current.state === 'DISPATCHED' && input.reasonCode !== 'ROUTE_FAILED_DETERMINISTIC') {
        return rejection(
          'ILLEGAL_TRANSITION',
          'queue authority: a DISPATCHED item cancels only on deterministic route failure (or the ' +
            'reconciliation resolution — INV-8-4); its rail operation is in flight',
        );
      }
      const updated = await this.transitionOne(current, 'CANCELLED', input.reasonCode);
      return { ok: true as const, replayed: false, record: updated };
    });
  }

  /**
   * Expire the queue's items whose max wait the given protocol time has
   * reached — the deterministic deadline rule ("wait deterministically in
   * queues until they become eligible, expire, or are cancelled"):
   * waiting items (QUEUED, ELIGIBLE) whose deadline passed move to
   * EXPIRED, in the deterministic dispatch order. DISPATCHED items never
   * expire (their fate is the linked rail operation — INV-8-4).
   *
   * Source: liquidity-credit-queues.md lines 151-159, 173-175, 190-193.
   */
  async expireDueItems(input: {
    readonly queueId: string;
    readonly at?: ProtocolTime;
  }): Promise<QueueCommandResult<readonly QueuedItemRecord[]>> {
    return this.serializer.run(`queue:${input.queueId}`, async () => {
      const queue = this.queues.get(input.queueId);
      if (queue === undefined) {
        return rejection('QUEUE_NOT_FOUND', `queue authority: queue ${input.queueId} is not recorded`);
      }
      const at = input.at ?? this.nextTime();
      const expired: QueuedItemRecord[] = [];
      for (const item of orderForDispatch(this.residentItemsOf(input.queueId))) {
        if (item.state !== 'QUEUED' && item.state !== 'ELIGIBLE') {
          continue;
        }
        if (isItemExpiredAtWallMs(item, queue.policy, at.wallMs)) {
          const updated = await this.transitionOne(item, 'EXPIRED', 'MAX_WAIT_EXCEEDED');
          expired.push(updated);
        }
      }
      return { ok: true as const, replayed: false, record: Object.freeze(expired) };
    });
  }

  // -------------------------------------------------------------------------
  // The single item transition path (INV-8-3 replay + evidence coupling)
  // -------------------------------------------------------------------------

  private async transitionOne(
    item: QueuedItemRecord,
    to: QueuedItemRecord['state'],
    reasonCode: QueueReasonCode,
  ): Promise<QueuedItemRecord> {
    const when = this.nextTime();
    const transition = transitionItem(item, to, reasonCode, when);
    if (!transition.ok) {
      throw new TypeError(
        `queue authority: item transition ${item.state} -> ${to} is not an edge of the exact v0.1 machine ` +
        `(item ${item.itemId})`,
      );
    }
    const evidence = itemEvidenceFor(transition.item, when);
    await submitQueueEvidence(this.evidence, evidence);
    const updated = deepFreeze(transition.item);
    this.items.set(item.itemId, updated);
    if (isTerminalState(updated.state)) {
      this.residentItemIds.delete(item.itemId);
    }
    return updated;
  }

  private async applyDispatch(item: QueuedItemRecord, linkedOperationId: string): Promise<QueuedItemRecord> {
    const when = this.nextTime();
    const transition = transitionItem(item, 'DISPATCHED', 'DISPATCHED_IN_ORDER', when);
    if (!transition.ok) {
      // The machine cannot re-dispatch: a repeat dispatch returns the
      // recorded state (handled by the command's replay check).
      throw new TypeError(
        `queue authority: dispatch is illegal from ${item.state} (item ${item.itemId})`,
      );
    }
    const dispatched: QueuedItemRecord = deepFreeze({
      ...transition.item,
      linkedOperationId,
    });
    await submitQueueEvidence(
      this.evidence,
      itemDispatchedEvidence({ item: dispatched, when, linkedOperationId }),
    );
    this.items.set(item.itemId, dispatched);
    return dispatched;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** The queue record, or undefined. Source: lines 163-165 (the owned state). */
  queue(queueId: string): FulfillmentQueueRecord | undefined {
    return this.queues.get(queueId);
  }

  /** The item record, or undefined. Source: lines 167-170. */
  item(itemId: string): QueuedItemRecord | undefined {
    return this.items.get(itemId);
  }

  /**
   * The queue's resident (non-terminal) items in the deterministic
   * dispatch order (priority class, then sequence).
   *
   * Source: liquidity-credit-queues.md lines 173-175, 185-187.
   */
  residentItemsOf(queueId: string): readonly QueuedItemRecord[] {
    const ids = this.itemsByQueue.get(queueId) ?? [];
    const resident = ids
      .map((id) => {
        const item = this.items.get(id);
        if (item === undefined) {
          throw new TypeError(`queue authority: item ${id} vanished (internal consistency)`);
        }
        return item;
      })
      .filter((item) => !isTerminalState(item.state));
    return orderForDispatch(resident);
  }

  /**
   * True iff the item id is currently resident in a queue (INV-8-2's
   * residency registry, observable for tests).
   *
   * Source: INV-8-2 (liquidity-credit-queues.md lines 185-187).
   */
  isResident(itemId: string): boolean {
    return this.residentItemIds.has(itemId);
  }
}

function isTerminalState(state: QueuedItemRecord['state']): boolean {
  return state === 'GRADUATED' || state === 'CANCELLED' || state === 'EXPIRED';
}

function itemEvidenceFor(item: QueuedItemRecord, when: ProtocolTime) {
  switch (item.state) {
    case 'QUEUED':
      return itemQueuedEvidence({ item, when });
    case 'ELIGIBLE':
      return itemEligibleEvidence({ item, when });
    case 'GRADUATED':
      return itemGraduatedEvidence({ item, when });
    case 'EXPIRED':
      return itemExpiredEvidence({ item, when });
    case 'CANCELLED':
      if (item.reasonCode !== 'INTENT_CANCELLED' && item.reasonCode !== 'ROUTE_FAILED_DETERMINISTIC' && item.reasonCode !== 'RECONCILIATION_FAILED') {
        throw new TypeError(`queue authority: item ${item.itemId} is CANCELLED without a cancellation reason code`);
      }
      return itemCancelledEvidence({ item, reasonCode: item.reasonCode, when });
    case 'DISPATCHED':
      return itemDispatchedEvidence({
        item,
        when,
        linkedOperationId: item.linkedOperationId as string,
      });
    default:
      throw new TypeError(`queue authority: unknown item state ${String(item.state)}`);
  }
}

function assertPolicy(policy: QueuePolicy): void {
  if (policy === null || typeof policy !== 'object') {
    throw new TypeError('queue authority: policy must be a QueuePolicy');
  }
  if (policy.orderingRule !== 'PRIORITY_CLASS_THEN_SEQUENCE_NUMBER') {
    throw new TypeError(
      'queue authority: policy.orderingRule must be the fixed deterministic rule (priority class, then sequence)',
    );
  }
  if (typeof policy.maxWaitEpochMs !== 'number' || !Number.isInteger(policy.maxWaitEpochMs) || policy.maxWaitEpochMs <= 0) {
    throw new TypeError('queue authority: policy.maxWaitEpochMs must be a positive integer (GC-1)');
  }
  const conditions = policy.releaseConditions;
  if (conditions === null || typeof conditions !== 'object') {
    throw new TypeError('queue authority: policy.releaseConditions must be a QueueReleaseConditions value');
  }
  if (conditions.minLiquidityAvailable !== undefined && !isMoney(conditions.minLiquidityAvailable)) {
    throw new TypeError('queue authority: releaseConditions.minLiquidityAvailable must be Money (GC-1)');
  }
  if (conditions.minCreditRemaining !== undefined && !isMoney(conditions.minCreditRemaining)) {
    throw new TypeError('queue authority: releaseConditions.minCreditRemaining must be Money (GC-1)');
  }
  if (
    conditions.requiredCapabilityTier === undefined &&
    conditions.minLiquidityAvailable === undefined &&
    conditions.minCreditRemaining === undefined
  ) {
    throw new TypeError('queue authority: releaseConditions must name at least one condition (the eligibility rule)');
  }
}

function policiesEqual(a: QueuePolicy, b: QueuePolicy): boolean {
  return (
    a.orderingRule === b.orderingRule &&
    a.maxWaitEpochMs === b.maxWaitEpochMs &&
    a.releaseConditions.requiredCapabilityTier === b.releaseConditions.requiredCapabilityTier &&
    moneyOptionalEqual(a.releaseConditions.minLiquidityAvailable, b.releaseConditions.minLiquidityAvailable) &&
    moneyOptionalEqual(a.releaseConditions.minCreditRemaining, b.releaseConditions.minCreditRemaining)
  );
}

function moneyOptionalEqual(a: Money | undefined, b: Money | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return a.currency === b.currency && a.scale === b.scale && a.amountMinor === b.amountMinor;
}

function rejection(code: QueueRejectionCode, problem: string): QueueRejection {
  return { ok: false, code, problem };
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
