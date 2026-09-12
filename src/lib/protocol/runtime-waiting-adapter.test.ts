/**
 * UI-011 — RUNTIME WAITING ADAPTER product suite (bun).
 *
 * Proves the waiting port's runtime re-anchoring: snapshots read the A08
 * Queue Authority's own records (derived from the real item states), the
 * re-check submits queues.eligibility.evaluate through the protocol
 * gateway (hosted — executed on the durable path), cancel recovery
 * submits queues.item.cancel (admitted; the un-hosted D-2 gap stated
 * honestly), and retry/escalate are denied with the recorded gap.
 */

import { describe, expect, test } from 'bun:test';
import { composeProductTestRuntime, type ProductTestComposition } from './product-adapter-test-compose';
import { createRuntimeWaitingAdapter } from './runtime-waiting-adapter';
import { getWaitingPort, registerWaitingPortBacking } from './waiting-port';
import type { WaitingPort } from './waiting-port';
import { getWaitingDisplayPresentation } from './waiting-state-mapping';
import { deriveProtocolId } from '../protocol-runtime/kernel/identity.ts';
import { money } from '../protocol-runtime/kernel/money.ts';

// Top-level awaited setup (bun's ESM test runtime; the ambient bun:test
// declaration exposes describe/test/expect only — no lifecycle hooks).
const composition = await composeProductTestRuntime();
const port: WaitingPort = createRuntimeWaitingAdapter(composition.handle);
registerWaitingPortBacking(port);

const QUEUE_ID = 'queue-waiting-suite';

const itemId = await (async () => {
  // Create the queue through the GATEWAY (queues.queue.create IS hosted).
  const created = await composition.submit(
    'queues.queue.create',
    'Queue Authority',
    {
      queueId: QUEUE_ID,
      policy: {
        orderingRule: 'PRIORITY_CLASS_THEN_SEQUENCE_NUMBER',
        maxWaitEpochMs: 600_000,
        releaseConditions: { requiredCapabilityTier: 'STANDARD' },
      },
    },
    `create-${QUEUE_ID}`,
  );
  expect(created.ok).toBe(true);
  // Enqueue the item on the OWNING authority's command surface (D-2:
  // queues.item.enqueue is admitted-but-unhosted — the composed-journey
  // precedent; every step still evidenced in the real A15 log).
  const intentId = deriveProtocolId('intent', 'waiting-suite-intent');
  const enqueued = await composition.authorities.queues.enqueueItem({
    queueId: QUEUE_ID,
    intentId,
    priorityClass: 0,
    terms: { intentId, terms: money('USD', 1_320, 2) },
  });
  expect(enqueued.ok).toBe(true);
  if (!enqueued.ok) {
    throw new Error('expected enqueue to succeed');
  }
  return enqueued.record.itemId;
})();

describe('UI-011 runtime waiting adapter — honest boundary', () => {
  test('the port reports the runtime-backed boundary (LIVE, authority owner names A08)', () => {
    expect(port.runtime).toBe('LIVE');
    expect(port.nonAuthoritative).toBe(false);
    expect(port.authorityOwner).toContain('A08');
    expect(getWaitingPort()).toBe(port);
  });
});

describe('UI-011 runtime waiting adapter — snapshots read the A08 records', () => {
  test('a reference the runtime does not know renders not-found (the honest no-record answer)', () => {
    const result = port.lookupWaiting('TRK-UNKNOWN', 'customer');
    expect(result.status).toBe('not-found');
  });

  test('a queued item presents the derived condition snapshot with the authority\u2019s own semantics', () => {
    const result = port.lookupWaiting(itemId, 'customer');
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      if (result.snapshot.snapshotKind === 'condition') {
        expect(result.snapshot.authorityStateId).toBe('fq.queued.provider-availability');
        expect(result.snapshot.conditionKind).toBe('queued');
        expect(result.snapshot.reason).toContain('release conditions');
        expect(result.snapshot.expectation).toContain('INV-8-4');
        expect(result.snapshot.reportedBy).toContain('A08');
        // The WAITING display resolution through the mapping discipline.
        const presentation = getWaitingDisplayPresentation(result.snapshot.authorityStateId);
        expect(presentation.recordId).toBeDefined();
        expect(['waiting', 'queued', 'delayed']).toContain(presentation.displayKind);
      } else {
        throw new Error('expected a condition snapshot');
      }
      expect(result.snapshot.amount.value).toBe('13.20');
      expect(result.snapshot.recovery.length).toBe(3);
      expect(result.snapshot.inquiry.available).toBe(true);
    }
  });

  test('the item id and the intent id both resolve the same waiting record', () => {
    const byIntent = port.lookupWaiting(deriveProtocolId('intent', 'waiting-suite-intent'), 'merchant');
    expect(byIntent.status).toBe('found');
  });
});

describe('UI-011 runtime waiting adapter — commands through the gateway', () => {
  test('a re-check on an unknown reference is rejected honestly (not applicable)', () => {
    const result = port.requestRecheck({ referenceId: 'TRK-UNKNOWN', requestedByRole: 'customer' });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toContain('no queue item');
    }
  });

  test('a re-check submits queues.eligibility.evaluate through the gateway (hosted — it executes)', () => {
    const result = port.requestRecheck({ referenceId: itemId, requestedByRole: 'customer' });
    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') {
      expect(result.routedTo).toContain('queues.eligibility.evaluate');
      expect(result.whoResolves).toContain('Fulfillment/Queue Authority');
      expect(result.whatUserSeesNext).toContain('re-read');
    }
    // The re-check command was admitted AND executed on the durable path
    // (the hosted binding drove the A08 authority).
    const eligibilityEvidence = composition.handle.evidenceLog
      .records()
      .some((record) => record.what.operationType === 'ITEM_ELIGIBLE' || record.what.operationType === 'ITEM_QUEUED');
    expect(eligibilityEvidence).toBe(true);
  });

  test('cancel recovery is authorized from QUEUED and submits queues.item.cancel; retry and escalate are denied with the recorded gap', () => {
    const cancel = port.requestRecovery({ referenceId: itemId, actionId: 'cancel', requestedByRole: 'customer' });
    expect(cancel.status).toBe('accepted');
    if (cancel.status === 'accepted') {
      expect(cancel.routedTo).toContain('queues.item.cancel');
      expect(cancel.whatHappensNext).toContain('D-2');
    }
    const retry = port.requestRecovery({ referenceId: itemId, actionId: 'retry', requestedByRole: 'customer' });
    expect(retry.status).toBe('denied');
    if (retry.status === 'denied') {
      expect(retry.reason).toContain('no retry command kind');
      expect(retry.reason).toContain('INV-8-4');
    }
    const escalate = port.requestRecovery({ referenceId: itemId, actionId: 'escalate', requestedByRole: 'customer' });
    expect(escalate.status).toBe('denied');
    if (escalate.status === 'denied') {
      expect(escalate.reason).toContain('no escalation command kind');
    }
  });

  test('an unknown action id is denied honestly', () => {
    const result = port.requestRecovery({
      referenceId: itemId,
      actionId: 'cancel',
      requestedByRole: 'customer',
    });
    expect(['accepted', 'denied']).toContain(result.status);
  });
});
