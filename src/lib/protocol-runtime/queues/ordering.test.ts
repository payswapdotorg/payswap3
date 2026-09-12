/**
 * RTN-007 — Queue Authority: the deterministic ordering (priority class,
 * then sequence number) and the snapshot-driven eligibility predicate.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §3 Area 8:
 *   lines 173-175: "Ordering is deterministic: priority class, then
 *    sequence number."
 *   lines 197-199: "Eligibility that depends on external state is
 *    evaluated from protocol-owned snapshots (areas 3, 6, 7), never by
 *    probing rails."
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';
import { compareQueuedItems, isEligibleUnderSnapshot, orderForDispatch } from './ordering.ts';
import type { ProtocolEligibilitySnapshot, QueuedItemRecord, QueuePolicy } from './types.ts';

const WHEN = protocolTime(1, 1_000);

const item = (overrides: Partial<QueuedItemRecord>): QueuedItemRecord => ({
  itemId: 'pid.v1.item',
  queueId: 'queue-a',
  intentId: 'pid.v1.intent',
  priorityClass: 0,
  queueSequence: 0,
  state: 'QUEUED',
  terms: { intentId: 'pid.v1.intent', terms: money('EUR', 100_00, 2) },
  enqueuedAtWallMs: 1_000,
  enqueuedAt: WHEN,
  stateChangedAt: WHEN,
  ...overrides,
});

describe('the deterministic ordering (priority class, then sequence number)', () => {
  test('lower priority classes dispatch first', () => {
    const high = item({ itemId: 'a', priorityClass: 1, queueSequence: 0 });
    const low = item({ itemId: 'b', priorityClass: 0, queueSequence: 5 });
    expect(compareQueuedItems(low, high)).toBe(-1);
    expect(orderForDispatch([high, low])[0]?.itemId).toBe('b');
  });

  test('within one class, the queue sequence (arrival) breaks ties — FIFO', () => {
    const first = item({ itemId: 'first', queueSequence: 1 });
    const second = item({ itemId: 'second', queueSequence: 2 });
    const zeroth = item({ itemId: 'zeroth', queueSequence: 0 });
    const ordered = orderForDispatch([second, first, zeroth]);
    expect(ordered.map((entry) => entry.itemId)).toEqual(['zeroth', 'first', 'second']);
  });

  test('the order is a pure total order — input order is irrelevant', () => {
    const items = [
      item({ itemId: 'c3', priorityClass: 1, queueSequence: 1 }),
      item({ itemId: 'a0', priorityClass: 0, queueSequence: 3 }),
      item({ itemId: 'b0', priorityClass: 0, queueSequence: 1 }),
      item({ itemId: 'd2', priorityClass: 2, queueSequence: 0 }),
      item({ itemId: 'c1', priorityClass: 1, queueSequence: 0 }),
    ];
    const forward = orderForDispatch(items).map((entry) => entry.itemId);
    const backward = orderForDispatch([...items].reverse()).map((entry) => entry.itemId);
    expect(forward).toEqual(['b0', 'a0', 'c1', 'c3', 'd2']);
    expect(forward).toEqual(backward);
  });
});

describe('the snapshot-driven eligibility (areas 3/6/7 views; never rail probing)', () => {
  const policy = (conditions: QueuePolicy['releaseConditions']): QueuePolicy => ({
    orderingRule: 'PRIORITY_CLASS_THEN_SEQUENCE_NUMBER',
    maxWaitEpochMs: 60_000,
    releaseConditions: conditions,
  });

  const snapshot = (overrides: Partial<ProtocolEligibilitySnapshot>): ProtocolEligibilitySnapshot => ({
    liquidity: [{ poolId: 'pool-a', available: money('EUR', 500_00, 2) }],
    capability: [{ capabilityId: 'cap-a', tier: 'standard', state: 'ACTIVE' }],
    credit: [{ lineId: 'line-a', remaining: money('EUR', 300_00, 2) }],
    at: WHEN,
    ...overrides,
  });

  const terms = money('EUR', 100_00, 2);

  test('an empty release-condition set releases on arrival', () => {
    expect(isEligibleUnderSnapshot(policy({}), terms, snapshot({}))).toBe(true);
  });

  test('the capability tier condition matches an ACTIVE capability of the tier', () => {
    expect(isEligibleUnderSnapshot(policy({ requiredCapabilityTier: 'standard' }), terms, snapshot({}))).toBe(true);
    expect(
      isEligibleUnderSnapshot(
        policy({ requiredCapabilityTier: 'premium' }),
        terms,
        snapshot({ capability: [{ capabilityId: 'cap-a', tier: 'standard', state: 'ACTIVE' }] }),
      ),
    ).toBe(false);
    // A non-ACTIVE capability of the right tier does not satisfy.
    expect(
      isEligibleUnderSnapshot(
        policy({ requiredCapabilityTier: 'standard' }),
        terms,
        snapshot({ capability: [{ capabilityId: 'cap-a', tier: 'standard', state: 'REGISTERED' }] }),
      ),
    ).toBe(false);
  });

  test('the liquidity condition matches available >= minimum in the same currency (integer comparison)', () => {
    expect(
      isEligibleUnderSnapshot(
        policy({ minLiquidityAvailable: money('EUR', 400_00, 2) }),
        terms,
        snapshot({}),
      ),
    ).toBe(true);
    expect(
      isEligibleUnderSnapshot(
        policy({ minLiquidityAvailable: money('EUR', 600_00, 2) }),
        terms,
        snapshot({}),
      ),
    ).toBe(false);
    // A different currency never satisfies a different-currency minimum.
    expect(
      isEligibleUnderSnapshot(
        policy({ minLiquidityAvailable: money('USD', 100_00, 2) }),
        terms,
        snapshot({}),
      ),
    ).toBe(false);
  });

  test('the credit condition matches remaining >= minimum in the same currency', () => {
    expect(
      isEligibleUnderSnapshot(policy({ minCreditRemaining: money('EUR', 300_00, 2) }), terms, snapshot({})),
    ).toBe(true);
    expect(
      isEligibleUnderSnapshot(policy({ minCreditRemaining: money('EUR', 301_00, 2) }), terms, snapshot({})),
    ).toBe(false);
  });

  test('all named conditions must hold together (the conjunction)', () => {
    const conjunctive = policy({
      requiredCapabilityTier: 'standard',
      minLiquidityAvailable: money('EUR', 500_00, 2),
    });
    expect(isEligibleUnderSnapshot(conjunctive, terms, snapshot({}))).toBe(true);
    expect(
      isEligibleUnderSnapshot(
        conjunctive,
        terms,
        snapshot({ liquidity: [{ poolId: 'pool-a', available: money('EUR', 400_00, 2) }] }),
      ),
    ).toBe(false);
  });
});
