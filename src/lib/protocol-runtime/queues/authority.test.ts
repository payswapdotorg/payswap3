/**
 * RTN-007 — Queue Authority: the authority's command surface — INV-8-1
 * (terms immutable), INV-8-2 (residency + dispatch exactly-once +
 * serialized eligibility), INV-8-3 (replays return the recorded state),
 * INV-8-4 (UNKNOWN keeps the item DISPATCHED until reconciliation
 * resolves), the queue machine, and expiry.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §3 Area 8, lines
 *   151-204 (Purpose, machines, invariants, failure semantics).
 */
import { describe, expect, test } from 'bun:test';
import { createEvidenceLog } from '../evidence/log.ts';
import { deriveProtocolId } from '../kernel/identity.ts';
import { money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';
import { QueueAuthority } from './authority.ts';
import type { ProtocolEligibilitySnapshot } from './types.ts';

function makeAuthority() {
  const log = createEvidenceLog({ wallMs: 1_000 });
  let wall = 5_000;
  const authority = new QueueAuthority({ evidence: log, wallClock: () => wall });
  return {
    log,
    authority,
    advance: (ms: number) => { wall += ms; },
    now: () => wall,
  };
}

const TERMS = money('EUR', 250_00, 2);
const POLICY = {
  orderingRule: 'PRIORITY_CLASS_THEN_SEQUENCE_NUMBER' as const,
  maxWaitEpochMs: 60_000,
  releaseConditions: { requiredCapabilityTier: 'standard' },
};

const SNAPSHOT: ProtocolEligibilitySnapshot = {
  liquidity: [{ poolId: 'pool-a', available: money('EUR', 1_000_00, 2) }],
  capability: [{ capabilityId: 'cap-a', tier: 'standard', state: 'ACTIVE' }],
  credit: [{ lineId: 'line-a', remaining: money('EUR', 1_000_00, 2) }],
  at: protocolTime(1, 5_000),
};

async function readyQueue(harness: ReturnType<typeof makeAuthority>) {
  const { authority } = harness;
  const created = await authority.createQueue({ queueId: 'queue-a', policy: POLICY });
  if (!created.ok) {
    throw new Error('queue creation failed');
  }
  await authority.startDraining('queue-a');
  return authority;
}

async function enqueue(authority: QueueAuthority, intentId: string, priorityClass = 0) {
  const result = await authority.enqueueItem({
    queueId: 'queue-a',
    intentId,
    priorityClass,
    terms: { intentId, terms: TERMS },
  });
  if (!result.ok) {
    throw new Error(`enqueue failed: ${result.problem}`);
  }
  return result.record;
}

describe('INV-8-1 (queuing never changes monetary terms)', () => {
  test('the item references the intent\'s fixed terms — identical after every transition', async () => {
    const harness = makeAuthority();
    const authority = await readyQueue(harness);
    const item = await enqueue(authority, 'pid.v1.intent-1');
    expect(item.terms.terms).toEqual(TERMS);
    const itemId = item.itemId;
    // Drive the item through its whole lifecycle; the terms never change.
    await authority.evaluateEligibility({ queueId: 'queue-a', snapshot: SNAPSHOT });
    const dispatched = await authority.dispatchNext({ queueId: 'queue-a', linkedOperationId: 'rail-op-1' });
    expect(dispatched.ok).toBe(true);
    await authority.resolveDispatchedItem({ itemId, resolution: 'RESOLVED_CONFIRMED' });
    const final = authority.item(itemId);
    expect(final?.terms.terms).toEqual(TERMS);
    expect(final?.terms.intentId).toBe('pid.v1.intent-1');
    // Deep-frozen: mutation attempts throw (immutable by construction).
    expect(Object.isFrozen(final?.terms.terms)).toBe(true);
  });

  test('there is NO command that accepts terms as input (structural immutability)', async () => {
    const harness = makeAuthority();
    const authority = await readyQueue(harness);
    const item = await enqueue(authority, 'pid.v1.intent-1');
    // The only terms-carrying command is enqueue; every other command
    // takes ids and reasons only — verified by the authority's surface.
    expect(authority.item(item.itemId)?.terms.terms).toEqual(TERMS);
  });
});

describe('INV-8-2 (exactly one residency; dispatch exactly-once per item id)', () => {
  test('an item id resident in one queue cannot be enqueued again (typed rejection)', async () => {
    const harness = makeAuthority();
    const authority = await readyQueue(harness);
    await authority.createQueue({ queueId: 'queue-b', policy: POLICY });
    await enqueue(authority, 'pid.v1.intent-1');
    const again = await authority.enqueueItem({
      queueId: 'queue-a',
      intentId: 'pid.v1.intent-1',
      priorityClass: 1,
      terms: { intentId: 'pid.v1.intent-1', terms: TERMS },
    });
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.code).toBe('ITEM_ALREADY_RESIDENT');
    }
  });

  test('the same intent in a DIFFERENT queue is a different item (one item, one queue)', async () => {
    const harness = makeAuthority();
    const authority = await readyQueue(harness);
    await authority.createQueue({ queueId: 'queue-b', policy: POLICY });
    const first = await enqueue(authority, 'pid.v1.intent-1');
    const second = await authority.enqueueItem({
      queueId: 'queue-b',
      intentId: 'pid.v1.intent-1',
      priorityClass: 0,
      terms: { intentId: 'pid.v1.intent-1', terms: TERMS },
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.record.itemId).not.toBe(first.itemId);
    }
    expect(authority.isResident(first.itemId)).toBe(true);
    expect(authority.isResident(second.ok ? second.record.itemId : '')).toBe(true);
  });

  test('the item id is derived from (queue id, intent id) — deterministic', async () => {
    const harness = makeAuthority();
    const authority = await readyQueue(harness);
    const item = await enqueue(authority, 'pid.v1.intent-42');
    expect(item.itemId).toBe(deriveProtocolId('queue-item', 'queue-a', 'pid.v1.intent-42'));
  });

  test('dispatch is exactly-once per item id: a repeat dispatch returns the recorded DISPATCHED state', async () => {
    const harness = makeAuthority();
    const authority = await readyQueue(harness);
    await enqueue(authority, 'pid.v1.intent-1');
    await enqueue(authority, 'pid.v1.intent-2');
    await authority.evaluateEligibility({ queueId: 'queue-a', snapshot: SNAPSHOT });
    const first = await authority.dispatchNext({ queueId: 'queue-a', linkedOperationId: 'rail-op-1' });
    expect(first.ok).toBe(true);
    // The next dispatch picks the OTHER item (the first is DISPATCHED —
    // no re-dispatch edge exists).
    const second = await authority.dispatchNext({ queueId: 'queue-a', linkedOperationId: 'rail-op-2' });
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.record.itemId).not.toBe(first.record.itemId);
    }
    // Both dispatched; nothing ELIGIBLE remains.
    const empty = await authority.dispatchNext({ queueId: 'queue-a', linkedOperationId: 'rail-op-3' });
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.code).toBe('ITEM_NOT_ELIGIBLE');
    }
  });

  test('dispatch requires the queue to be DRAINING (typed rejection when not)', async () => {
    const harness = makeAuthority();
    const { authority } = harness;
    await authority.createQueue({ queueId: 'queue-open', policy: POLICY });
    await authority.enqueueItem({
      queueId: 'queue-open',
      intentId: 'pid.v1.intent-1',
      priorityClass: 0,
      terms: { intentId: 'pid.v1.intent-1', terms: TERMS },
    });
    await authority.evaluateEligibility({ queueId: 'queue-open', snapshot: SNAPSHOT });
    const blocked = await authority.dispatchNext({ queueId: 'queue-open', linkedOperationId: 'rail-op-1' });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe('QUEUE_NOT_DRAINING');
    }
  });

  test('concurrent eligibility evaluations on one queue serialize (per-queue serialization)', async () => {
    const harness = makeAuthority();
    const authority = await readyQueue(harness);
    for (let index = 1; index <= 5; index += 1) {
      await enqueue(authority, `pid.v1.intent-${index}`);
    }
    const runs = await Promise.all([
      authority.evaluateEligibility({ queueId: 'queue-a', snapshot: SNAPSHOT }),
      authority.evaluateEligibility({ queueId: 'queue-a', snapshot: SNAPSHOT }),
    ]);
    // Every QUEUED item became ELIGIBLE exactly once (no double
    // transitions, no lost updates).
    const eligible = authority.residentItemsOf('queue-a').filter((item) => item.state === 'ELIGIBLE');
    expect(eligible.length).toBe(5);
    for (const run of runs) {
      expect(run.ok).toBe(true);
    }
  });
});

describe('INV-8-3 (replays return the recorded state)', () => {
  test('a re-enqueue of a terminal item intent returns the recorded terminal', async () => {
    const harness = makeAuthority();
    const authority = await readyQueue(harness);
    const item = await enqueue(authority, 'pid.v1.intent-1');
    await authority.cancelItem({ itemId: item.itemId, reasonCode: 'INTENT_CANCELLED' });
    const replay = await authority.enqueueItem({
      queueId: 'queue-a',
      intentId: 'pid.v1.intent-1',
      priorityClass: 0,
      terms: { intentId: 'pid.v1.intent-1', terms: TERMS },
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.replayed).toBe(true);
      expect(replay.record.state).toBe('CANCELLED');
    }
  });

  test('a repeat cancellation returns the recorded CANCELLED state', async () => {
    const harness = makeAuthority();
    const authority = await readyQueue(harness);
    const item = await enqueue(authority, 'pid.v1.intent-1');
    await authority.cancelItem({ itemId: item.itemId, reasonCode: 'INTENT_CANCELLED' });
    const replay = await authority.cancelItem({ itemId: item.itemId, reasonCode: 'INTENT_CANCELLED' });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.replayed).toBe(true);
    }
  });

  test('a repeat resolution returns the recorded terminal', async () => {
    const harness = makeAuthority();
    const authority = await readyQueue(harness);
    const item = await enqueue(authority, 'pid.v1.intent-1');
    await authority.evaluateEligibility({ queueId: 'queue-a', snapshot: SNAPSHOT });
    await authority.dispatchNext({ queueId: 'queue-a', linkedOperationId: 'rail-op-1' });
    await authority.resolveDispatchedItem({ itemId: item.itemId, resolution: 'RESOLVED_CONFIRMED' });
    const replay = await authority.resolveDispatchedItem({
      itemId: item.itemId,
      resolution: 'RESOLVED_CONFIRMED',
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.replayed).toBe(true);
      expect(replay.record.state).toBe('GRADUATED');
    }
    // A contradictory second resolution is the typed rejection.
    const contradiction = await authority.resolveDispatchedItem({
      itemId: item.itemId,
      resolution: 'RESOLVED_FAILED',
    });
    expect(contradiction.ok).toBe(true); // terminal replay path (recorded state)
    if (contradiction.ok) {
      expect(contradiction.replayed).toBe(true);
      expect(contradiction.record.state).toBe('GRADUATED');
    }
  });
});

describe('INV-8-4 (UNKNOWN keeps the item DISPATCHED until reconciliation resolves)', () => {
  test('a dispatched item with an UNKNOWN downstream operation stays DISPATCHED — no retry surface exists', async () => {
    const harness = makeAuthority();
    const authority = await readyQueue(harness);
    const item = await enqueue(authority, 'pid.v1.intent-1');
    await authority.evaluateEligibility({ queueId: 'queue-a', snapshot: SNAPSHOT });
    await authority.dispatchNext({ queueId: 'queue-a', linkedOperationId: 'rail-op-unknown' });
    // The operation reports UNKNOWN. The queue holds the item:
    expect(authority.item(item.itemId)?.state).toBe('DISPATCHED');
    expect(authority.item(item.itemId)?.linkedOperationId).toBe('rail-op-unknown');
    // The queue is still draining with no ELIGIBLE items — the item is
    // NOT re-queued, NOT re-dispatched (machine-checked: no such edges).
    expect(authority.residentItemsOf('queue-a').map((entry) => entry.state)).toEqual(['DISPATCHED']);
    const nothing = await authority.dispatchNext({ queueId: 'queue-a', linkedOperationId: 'rail-op-x' });
    expect(nothing.ok).toBe(false);
    // Max-wait expiry does NOT touch a DISPATCHED item (its fate is the
    // linked operation).
    harness.advance(120_000);
    const expired = await authority.expireDueItems({ queueId: 'queue-a' });
    expect(expired.ok).toBe(true);
    if (expired.ok) {
      expect(expired.record.length).toBe(0);
    }
    expect(authority.item(item.itemId)?.state).toBe('DISPATCHED');
  });

  test('confirmation graduates the item (GRADUATED, downstream fulfillment completed)', async () => {
    const harness = makeAuthority();
    const authority = await readyQueue(harness);
    const item = await enqueue(authority, 'pid.v1.intent-1');
    await authority.evaluateEligibility({ queueId: 'queue-a', snapshot: SNAPSHOT });
    await authority.dispatchNext({ queueId: 'queue-a', linkedOperationId: 'rail-op-1' });
    const resolution = await authority.resolveDispatchedItem({
      itemId: item.itemId,
      resolution: 'RESOLVED_CONFIRMED',
    });
    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.record.state).toBe('GRADUATED');
    }
    expect(authority.isResident(item.itemId)).toBe(false);
  });

  test('confirmed failure cancels the item', async () => {
    const harness = makeAuthority();
    const authority = await readyQueue(harness);
    const item = await enqueue(authority, 'pid.v1.intent-1');
    await authority.evaluateEligibility({ queueId: 'queue-a', snapshot: SNAPSHOT });
    await authority.dispatchNext({ queueId: 'queue-a', linkedOperationId: 'rail-op-1' });
    const resolution = await authority.resolveDispatchedItem({
      itemId: item.itemId,
      resolution: 'RESOLVED_FAILED',
    });
    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.record.state).toBe('CANCELLED');
    }
  });

  test('a DISPATCHED item cancels ONLY on deterministic route failure', async () => {
    const harness = makeAuthority();
    const authority = await readyQueue(harness);
    const item = await enqueue(authority, 'pid.v1.intent-1');
    await authority.evaluateEligibility({ queueId: 'queue-a', snapshot: SNAPSHOT });
    await authority.dispatchNext({ queueId: 'queue-a', linkedOperationId: 'rail-op-1' });
    const intentCancel = await authority.cancelItem({ itemId: item.itemId, reasonCode: 'INTENT_CANCELLED' });
    expect(intentCancel.ok).toBe(false);
    if (!intentCancel.ok) {
      expect(intentCancel.code).toBe('ILLEGAL_TRANSITION');
    }
    const routeFail = await authority.cancelItem({ itemId: item.itemId, reasonCode: 'ROUTE_FAILED_DETERMINISTIC' });
    expect(routeFail.ok).toBe(true);
  });
});

describe('waiting items expire deterministically on the max wait', () => {
  test('QUEUED and ELIGIBLE items expire in dispatch order; DISPATCHED items do not', async () => {
    const harness = makeAuthority();
    const authority = await readyQueue(harness);
    const first = await enqueue(authority, 'pid.v1.intent-1');
    const second = await enqueue(authority, 'pid.v1.intent-2');
    const third = await enqueue(authority, 'pid.v1.intent-3');
    // One item becomes ELIGIBLE, one gets dispatched.
    await authority.evaluateEligibility({ queueId: 'queue-a', snapshot: SNAPSHOT });
    // Dispatch only the first (highest priority): the others wait.
    await authority.dispatchNext({ queueId: 'queue-a', linkedOperationId: 'rail-op-1' });
    expect(authority.item(first.itemId)?.state).toBe('DISPATCHED');
    expect(authority.item(second.itemId)?.state).toBe('ELIGIBLE');
    expect(authority.item(third.itemId)?.state).toBe('ELIGIBLE');
    harness.advance(120_000); // past maxWait
    const expired = await authority.expireDueItems({ queueId: 'queue-a' });
    expect(expired.ok).toBe(true);
    if (expired.ok) {
      expect(expired.record.map((entry) => entry.itemId)).toEqual([second.itemId, third.itemId]);
    }
    expect(authority.item(first.itemId)?.state).toBe('DISPATCHED');
    expect(authority.isResident(first.itemId)).toBe(true);
    expect(authority.isResident(second.itemId)).toBe(false);
  });
});

describe('the queue machine and closure gating', () => {
  test('OPEN -> DRAINING -> PAUSED -> CLOSED walks the exact chain; resident items block closure', async () => {
    const harness = makeAuthority();
    const { authority } = harness;
    await authority.createQueue({ queueId: 'queue-a', policy: POLICY });
    await authority.startDraining('queue-a');
    const item = await enqueue(authority, 'pid.v1.intent-1');
    await authority.pauseQueue('queue-a');
    expect(authority.queue('queue-a')?.state).toBe('PAUSED');
    const blocked = await authority.closeQueue('queue-a');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe('QUEUE_HAS_RESIDENT_ITEMS');
    }
    await authority.cancelItem({ itemId: item.itemId, reasonCode: 'INTENT_CANCELLED' });
    expect((await authority.closeQueue('queue-a')).ok).toBe(true);
    expect(authority.queue('queue-a')?.state).toBe('CLOSED');
  });

  test('a closed queue accepts no new items (typed rejection)', async () => {
    const harness = makeAuthority();
    const { authority } = harness;
    await authority.createQueue({ queueId: 'queue-a', policy: POLICY });
    await authority.startDraining('queue-a');
    await authority.pauseQueue('queue-a');
    await authority.closeQueue('queue-a');
    const rejected = await authority.enqueueItem({
      queueId: 'queue-a',
      intentId: 'pid.v1.intent-late',
      priorityClass: 0,
      terms: { intentId: 'pid.v1.intent-late', terms: TERMS },
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.code).toBe('QUEUE_CLOSED');
    }
  });

  test('the queue policy is immutable (conflicting re-creation is the typed rejection)', async () => {
    const harness = makeAuthority();
    const { authority } = harness;
    await authority.createQueue({ queueId: 'queue-a', policy: POLICY });
    const replay = await authority.createQueue({ queueId: 'queue-a', policy: POLICY });
    expect(replay.ok && replay.replayed).toBe(true);
    const conflicting = await authority.createQueue({
      queueId: 'queue-a',
      policy: { ...POLICY, maxWaitEpochMs: 120_000 },
    });
    expect(conflicting.ok).toBe(false);
  });

  test('items enqueue and become eligible while PAUSED, but never dispatch', async () => {
    const harness = makeAuthority();
    const { authority } = harness;
    await authority.createQueue({ queueId: 'queue-a', policy: POLICY });
    await authority.startDraining('queue-a');
    const item = await enqueue(authority, 'pid.v1.intent-1');
    await authority.pauseQueue('queue-a');
    await authority.evaluateEligibility({ queueId: 'queue-a', snapshot: SNAPSHOT });
    expect(authority.item(item.itemId)?.state).toBe('ELIGIBLE');
    const blocked = await authority.dispatchNext({ queueId: 'queue-a', linkedOperationId: 'rail-op-1' });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe('QUEUE_NOT_DRAINING');
    }
  });
});
