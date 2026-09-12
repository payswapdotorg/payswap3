/**
 * RTN-007 — Queue Authority: the exact A08 state machines, machine-
 * checked — every legal edge applies, every non-edge is rejected,
 * including the structural INV-8-4 (no re-queue / re-dispatch edges).
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §3 Area 8:
 *   lines 163-165: "States: OPEN -> DRAINING -> PAUSED -> CLOSED."
 *   lines 168-169: "States: QUEUED -> ELIGIBLE -> DISPATCHED ->
 *    terminal(GRADUATED | CANCELLED | EXPIRED)."
 *   lines 190-193 (INV-8-4): "when a dispatched item's downstream rail
 *    operation is UNKNOWN, the item stays DISPATCHED; it is never
 *    re-queued or re-dispatched until reconciliation resolves the
 *    operation (GC-2)."
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';
import { transitionItem, transitionQueue, isItemExpiredAtWallMs } from './state-machine.ts';
import { ITEM_STATES, QUEUE_STATES } from './types.ts';
import { canTransitionItem, canTransitionQueue } from './types.ts';
import type { FulfillmentQueueRecord, QueuedItemRecord } from './types.ts';

const WHEN = protocolTime(1, 1_000);

const queue = (state: FulfillmentQueueRecord['state']): FulfillmentQueueRecord => ({
  queueId: 'queue-a',
  state,
  policy: {
    orderingRule: 'PRIORITY_CLASS_THEN_SEQUENCE_NUMBER',
    maxWaitEpochMs: 60_000,
    releaseConditions: { requiredCapabilityTier: 'standard' },
  },
  nextSequence: 0,
  createdAt: WHEN,
  stateChangedAt: WHEN,
});

const item = (state: QueuedItemRecord['state']): QueuedItemRecord => ({
  itemId: 'pid.v1.item',
  queueId: 'queue-a',
  intentId: 'pid.v1.intent',
  priorityClass: 0,
  queueSequence: 0,
  state,
  terms: { intentId: 'pid.v1.intent', terms: money('EUR', 100_00, 2) },
  enqueuedAtWallMs: 1_000,
  enqueuedAt: WHEN,
  stateChangedAt: WHEN,
  ...(state === 'DISPATCHED' ? { linkedOperationId: 'rail-op-1' } : {}),
});

describe('A08 queue machine (OPEN -> DRAINING -> PAUSED -> CLOSED, exact)', () => {
  test('the vocabulary is exactly the four v0.1 states', () => {
    expect([...QUEUE_STATES]).toEqual(['OPEN', 'DRAINING', 'PAUSED', 'CLOSED']);
  });

  test('the exact legal edges; CLOSED terminal', () => {
    expect(canTransitionQueue('OPEN', 'DRAINING')).toBe(true);
    expect(canTransitionQueue('DRAINING', 'PAUSED')).toBe(true);
    expect(canTransitionQueue('PAUSED', 'CLOSED')).toBe(true);
    for (const to of QUEUE_STATES) {
      expect(canTransitionQueue('CLOSED', to)).toBe(false);
    }
  });

  test('there is no PAUSED -> DRAINING resume edge (the spec-literal chain)', () => {
    expect(canTransitionQueue('PAUSED', 'DRAINING')).toBe(false);
    expect(canTransitionQueue('PAUSED', 'OPEN')).toBe(false);
  });

  test('closure directly from OPEN or DRAINING is not an edge (pause first)', () => {
    expect(canTransitionQueue('OPEN', 'CLOSED')).toBe(false);
    expect(canTransitionQueue('OPEN', 'PAUSED')).toBe(false);
    expect(canTransitionQueue('DRAINING', 'CLOSED')).toBe(false);
  });

  test('transitionQueue applies the legal edges and rejects the rest', () => {
    const draining = transitionQueue(queue('OPEN'), 'DRAINING', WHEN);
    expect(draining.ok).toBe(true);
    if (draining.ok) {
      expect(draining.queue.state).toBe('DRAINING');
    }
    expect(transitionQueue(queue('OPEN'), 'CLOSED', WHEN).ok).toBe(false);
    expect(transitionQueue(queue('PAUSED'), 'DRAINING', WHEN).ok).toBe(false);
    expect(transitionQueue(queue('DRAINING'), 'DRAINING', WHEN).ok).toBe(false);
  });
});

describe('A08 item machine (QUEUED -> ELIGIBLE -> DISPATCHED -> terminal, exact)', () => {
  test('the vocabulary is exactly the six v0.1 states', () => {
    expect([...ITEM_STATES]).toEqual([
      'QUEUED',
      'ELIGIBLE',
      'DISPATCHED',
      'GRADUATED',
      'CANCELLED',
      'EXPIRED',
    ]);
  });

  test('the happy-path edges', () => {
    expect(canTransitionItem('QUEUED', 'ELIGIBLE')).toBe(true);
    expect(canTransitionItem('ELIGIBLE', 'DISPATCHED')).toBe(true);
    expect(canTransitionItem('DISPATCHED', 'GRADUATED')).toBe(true);
    expect(canTransitionItem('DISPATCHED', 'CANCELLED')).toBe(true);
  });

  test('the waiting-state expiry and cancellation edges (the Purpose makes them load-bearing)', () => {
    expect(canTransitionItem('QUEUED', 'CANCELLED')).toBe(true);
    expect(canTransitionItem('QUEUED', 'EXPIRED')).toBe(true);
    expect(canTransitionItem('ELIGIBLE', 'CANCELLED')).toBe(true);
    expect(canTransitionItem('ELIGIBLE', 'EXPIRED')).toBe(true);
  });

  test('INV-8-4 is structural: NO edge re-queues or re-dispatches a DISPATCHED item', () => {
    expect(canTransitionItem('DISPATCHED', 'QUEUED')).toBe(false);
    expect(canTransitionItem('DISPATCHED', 'ELIGIBLE')).toBe(false);
    expect(canTransitionItem('DISPATCHED', 'DISPATCHED')).toBe(false);
    expect(canTransitionItem('DISPATCHED', 'EXPIRED')).toBe(false);
  });

  test('terminals have empty successor sets', () => {
    for (const terminal of ['GRADUATED', 'CANCELLED', 'EXPIRED'] as const) {
      for (const to of ITEM_STATES) {
        expect(canTransitionItem(terminal, to)).toBe(false);
      }
    }
  });

  test('transitionItem applies the legal edges and rejects the rest', () => {
    const eligible = transitionItem(item('QUEUED'), 'ELIGIBLE', 'ELIGIBLE_PER_POLICY', WHEN);
    expect(eligible.ok).toBe(true);
    if (eligible.ok) {
      expect(eligible.item.state).toBe('ELIGIBLE');
      expect(eligible.item.reasonCode).toBe('ELIGIBLE_PER_POLICY');
    }
    expect(transitionItem(item('DISPATCHED'), 'QUEUED', 'INTENT_CANCELLED', WHEN).ok).toBe(false);
    expect(transitionItem(item('CANCELLED'), 'QUEUED', 'INTENT_CANCELLED', WHEN).ok).toBe(false);
  });

  test('the max-wait predicate is deterministic (the deadline is the last valid instant)', () => {
    const waiting = item('QUEUED');
    expect(isItemExpiredAtWallMs(waiting, queue('OPEN').policy, 59_000)).toBe(false);
    expect(isItemExpiredAtWallMs(waiting, queue('OPEN').policy, 61_000)).toBe(true);
    expect(isItemExpiredAtWallMs(waiting, queue('OPEN').policy, 1_000 + 60_000)).toBe(true);
  });
});
