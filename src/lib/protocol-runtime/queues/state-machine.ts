/**
 * RTN-007 — Queue Authority: pure transition application for the A08
 * state machines (queue and item).
 *
 * Spec sources (binding) — spec/architecture/v0.1/liquidity-credit-queues.md
 * §3 Area 8:
 *   lines 163-165 (FulfillmentQueue, verbatim):
 *     "States: OPEN -> DRAINING -> PAUSED -> CLOSED."
 *   lines 167-170 (QueuedItem, verbatim):
 *     "States: QUEUED -> ELIGIBLE -> DISPATCHED ->
 *      terminal(GRADUATED | CANCELLED | EXPIRED)."
 *   lines 190-193 (INV-8-4):
 *     "when a dispatched item's downstream rail operation is UNKNOWN, the
 *      item stays DISPATCHED; it is never re-queued or re-dispatched until
 *      reconciliation resolves the operation (GC-2)."
 *
 * The transition tables live in types.ts (the frozen exact machines);
 * this module applies them to the record shapes, returning the updated
 * record or the typed ILLEGAL_TRANSITION rejection (typed values, never
 * thrown — the merged command convention). The no-retry discipline of
 * INV-8-4 is structural: the ITEM table has no edge out of DISPATCHED
 * except GRADUATED and CANCELLED, so no command sequence can re-queue or
 * re-dispatch a dispatched item.
 */

import type { ProtocolTime } from '../kernel/time.ts';
import type {
  FulfillmentQueueRecord,
  ItemState,
  QueuedItemRecord,
  QueuePolicy,
  QueueReasonCode,
  QueueState,
} from './types.ts';
import { canTransitionItem, canTransitionQueue } from './types.ts';

/**
 * Apply one FulfillmentQueue transition — the pure carrier of the exact
 * chain. Replays (from === to) and every non-edge are the typed
 * ILLEGAL_TRANSITION rejection.
 *
 * Source: liquidity-credit-queues.md lines 163-165.
 */
export function transitionQueue(
  queue: FulfillmentQueueRecord,
  to: QueueState,
  when: ProtocolTime,
): { readonly ok: true; readonly queue: FulfillmentQueueRecord } | { readonly ok: false } {
  if (!canTransitionQueue(queue.state, to)) {
    return { ok: false };
  }
  return {
    ok: true,
    queue: { ...queue, state: to, stateChangedAt: when },
  };
}

/**
 * Apply one QueuedItem transition — the pure carrier of the exact
 * machine. The reason code rides the record ("reason codes where
 * applicable" — the evidence records carry it).
 *
 * Source: liquidity-credit-queues.md lines 167-170, 206-210.
 */
export function transitionItem(
  item: QueuedItemRecord,
  to: ItemState,
  reasonCode: QueueReasonCode,
  when: ProtocolTime,
): { readonly ok: true; readonly item: QueuedItemRecord } | { readonly ok: false } {
  if (!canTransitionItem(item.state, to)) {
    return { ok: false };
  }
  return {
    ok: true,
    item: { ...item, state: to, reasonCode, stateChangedAt: when },
  };
}

/**
 * The deterministic max-wait predicate: an item is expired iff the
 * evaluation wall time has reached the item's deadline
 * (enqueuedAtWallMs + policy.maxWaitEpochMs) — a pure function of (item,
 * policy, wall time), "deterministic on protocol time" in the merged
 * expiry convention (the deadline is the last valid instant).
 *
 * Source: liquidity-credit-queues.md lines 173-175 (QueuePolicy "max
 * wait"), lines 151-159 ("until they become eligible, expire, or are
 * cancelled").
 */
export function isItemExpiredAtWallMs(item: QueuedItemRecord, policy: QueuePolicy, wallMs: number): boolean {
  if (typeof wallMs !== 'number' || !Number.isInteger(wallMs)) {
    throw new TypeError('queue state machine: wallMs must be an integer (GC-1)');
  }
  const deadline = item.enqueuedAtWallMs + policy.maxWaitEpochMs;
  if (!Number.isSafeInteger(deadline)) {
    throw new TypeError('queue state machine: the item deadline leaves the safe-integer range (GC-1)');
  }
  return wallMs >= deadline;
}
