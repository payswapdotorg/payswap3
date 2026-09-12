/**
 * RTN-007 — Queue Authority: the deterministic ordering (priority class,
 * then sequence number) and the pure eligibility evaluation.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §3 Area 8:
 *   lines 173-175 (QueuePolicy, verbatim):
 *     "QueuePolicy — immutable per-queue policy: ordering rule, max wait,
 *      release conditions. Ordering is deterministic: priority class,
 *      then sequence number."
 *   lines 163-165 (the eligibility rule):
 *     "FulfillmentQueue — ordered waiting area with an eligibility rule
 *      (resource availability, capability tier, deadline class)."
 *   lines 197-199 (eligibility from snapshots, verbatim):
 *     "Eligibility that depends on external state is evaluated from
 *      protocol-owned snapshots (areas 3, 6, 7), never by probing rails."
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - The comparator is a pure total order over (priorityClass, then
 *     queueSequence), both ascending; lower priority class values are
 *     dispatched earlier (class 0 before class 1 — the recorded
 *     interpretation of "priority class"); the queue sequence is the
 *     arrival position, so within one class the order is FIFO.
 *   - The eligibility evaluation is a pure function of (item terms,
 *     policy release conditions, protocol-owned snapshot): the
 *     capability condition matches some ACTIVE capability of the required
 *     tier (area 3 view), the liquidity condition matches some pool with
 *     available >= the minimum in the terms' currency (area 6 view), the
 *     credit condition matches some ACTIVE line with remaining >= the
 *     minimum in the terms' currency (area 7 view). Money comparisons are
 *     integer-only and unit-matched (GC-1). No rail surface is imported
 *     or touched anywhere in this module.
 */

import { compareMoney } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';
import type {
  ProtocolEligibilitySnapshot,
  QueuedItemRecord,
  QueuePolicy,
} from './types.ts';

/**
 * The deterministic item comparator: priority class, then sequence
 * number (both ascending) — a total order; equal keys are impossible
 * (the queue sequence is unique per queue).
 *
 * Source: liquidity-credit-queues.md lines 173-175 ("Ordering is
 * deterministic: priority class, then sequence number").
 */
export function compareQueuedItems(a: QueuedItemRecord, b: QueuedItemRecord): number {
  if (a.priorityClass !== b.priorityClass) {
    return a.priorityClass < b.priorityClass ? -1 : 1;
  }
  if (a.queueSequence !== b.queueSequence) {
    return a.queueSequence < b.queueSequence ? -1 : 1;
  }
  return 0;
}

/**
 * The deterministic dispatch order of a set of items: sorted by priority
 * class, then sequence number. A pure function; the input order is
 * irrelevant to the output.
 *
 * Source: liquidity-credit-queues.md lines 173-175.
 */
export function orderForDispatch(items: readonly QueuedItemRecord[]): readonly QueuedItemRecord[] {
  return Object.freeze([...items].sort(compareQueuedItems));
}

/**
 * True iff the queue's release conditions hold for the item's terms
 * under the protocol-owned snapshot — the pure eligibility predicate
 * ("evaluated from protocol-owned snapshots (areas 3, 6, 7), never by
 * probing rails"). An empty release-conditions object means the queue
 * releases on arrival (no conditions).
 *
 * Source: liquidity-credit-queues.md lines 163-165, 197-199.
 */
export function isEligibleUnderSnapshot(
  policy: QueuePolicy,
  terms: Money,
  snapshot: ProtocolEligibilitySnapshot,
): boolean {
  const conditions = policy.releaseConditions;
  if (conditions.requiredCapabilityTier !== undefined) {
    const matches = snapshot.capability.some(
      (entry) => entry.state === 'ACTIVE' && entry.tier === conditions.requiredCapabilityTier,
    );
    if (!matches) {
      return false;
    }
  }
  if (conditions.minLiquidityAvailable !== undefined) {
    const required = conditions.minLiquidityAvailable;
    const matches = snapshot.liquidity.some((entry) => sameUnitAndAtLeast(entry.available, required));
    if (!matches) {
      return false;
    }
  }
  if (conditions.minCreditRemaining !== undefined) {
    const required = conditions.minCreditRemaining;
    const matches = snapshot.credit.some((entry) => sameUnitAndAtLeast(entry.remaining, required));
    if (!matches) {
      return false;
    }
  }
  return true;
}

function sameUnitAndAtLeast(candidate: Money, minimum: Money): boolean {
  if (candidate.currency !== minimum.currency || candidate.scale !== minimum.scale) {
    return false;
  }
  return compareMoney(candidate, minimum) >= 0;
}
