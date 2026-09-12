/**
 * RTN-010 — Idempotent receipt tests: same command + idempotency key
 * returns the recorded receipt, never a second effect.
 *
 * Work order acceptance (RTN-010.md line 15): "Idempotent submission: same
 * command + idempotency key returns the recorded receipt, never a second
 * effect." Spec ground (core.md §1 Area 1, lines 57-62 — the generalized
 * contract):
 *   "INV-1-2 (concurrency): ... Concurrent submissions carrying the same
 *    idempotency key collapse to one intent and one receipt.
 *    INV-1-3 (idempotency): re-submission with a recorded idempotency key
 *    returns the recorded receipt; it never creates a second intent or a
 *    second financial effect."
 * Durable ground (spec/durable/execution.md §6 lines 125-133): "The
 * schema enforces UNIQUE (idempotency_key, kind): enqueueing the same
 * (kind, idempotencyKey) twice results in exactly ONE row; the second call
 * returns created: false with the existing job (a no-op)."
 *
 * The generalized no-second-effect here: never a second ENQUEUE (the
 * durable command path carries at most one job per (kind, key) — and
 * therefore at most one transition-path execution), and never a second
 * admission receipt for the key.
 */

import { describe, expect, test } from 'bun:test';
import { createEvidenceLog } from '../evidence/log.ts';
import type { EvidenceLog } from '../evidence/log.ts';
import { protocolTime } from '../kernel/time.ts';
import { ProtocolGateway } from './admission.ts';

class QueueDouble {
  readonly calls: Array<{ readonly kind: string; readonly payload: unknown; readonly idempotencyKey: string }> = [];
  readonly jobs = new Map<string, string>();
  failNext = false;

  enqueue(
    kind: string,
    payload: unknown,
    options: { readonly idempotencyKey: string },
  ): { readonly created: boolean; readonly reason: 'enqueued' | 'deduplicated'; readonly jobId: string } {
    this.calls.push({ kind, payload, idempotencyKey: options.idempotencyKey });
    if (this.failNext) {
      this.failNext = false;
      throw new Error('queue double: induced submit failure');
    }
    const key = `${kind}\u0000${options.idempotencyKey}`;
    const existing = this.jobs.get(key);
    if (existing !== undefined) {
      return { created: false, reason: 'deduplicated', jobId: existing };
    }
    const jobId = `job-${this.jobs.size + 1}`;
    this.jobs.set(key, jobId);
    return { created: true, reason: 'enqueued', jobId };
  }
}

function makeGateway(): { log: EvidenceLog; queue: QueueDouble; gateway: ProtocolGateway } {
  const log = createEvidenceLog({ wallMs: 1_000 });
  const queue = new QueueDouble();
  const gateway = new ProtocolGateway({ evidence: log, queue, wallClock: () => 5_000 });
  return { log, queue, gateway };
}

const when = protocolTime(0, 1_000);

function intentSubmitEnvelope(idempotencyKey: string): unknown {
  return {
    kind: 'intent.submit',
    authority: 'Intent Authority',
    subjectIds: [],
    idempotencyKey,
    protocolTime: when,
    body: {
      descriptor: {
        amount: { currency: 'EUR', scale: 2, amountMinor: 1_000 },
        source: { currency: 'EUR', geography: 'DE', account: 'acct-source' },
        destination: { currency: 'USD', geography: 'US', account: 'acct-destination' },
        constraints: {
          deadlineEpochMs: 60_000,
          allowedRails: ['rail-a'],
          costCeiling: { currency: 'USD', scale: 2, amountMinor: 500 },
        },
        idempotencyKey: 'descriptor-key-1',
      },
    },
  };
}

function intentAuthorizeEnvelope(idempotencyKey: string): unknown {
  return {
    kind: 'intent.authorize',
    authority: 'Intent Authority',
    subjectIds: ['pid.v1.intent-sample'],
    idempotencyKey,
    protocolTime: when,
    body: { intentId: 'pid.v1.intent-sample', policyDecisionId: 'pid.v1.decision-sample' },
  };
}

describe('RTN-010 idempotent receipts — INV-1-3 replay, generalized', () => {
  test('re-submission with a recorded key returns the RECORDED receipt verbatim — no second enqueue', async () => {
    const { queue, gateway } = makeGateway();
    const first = await gateway.submitCommand(intentSubmitEnvelope('idem-replay-1'));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.replayed).toBe(false);
    expect(first.created).toBe(true);
    const second = await gateway.submitCommand(intentSubmitEnvelope('idem-replay-1'));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.replayed).toBe(true);
    expect(second.created).toBe(false);
    // VERBATIM: the identical receipt object, returned by reference
    expect(second.receipt).toBe(first.receipt);
    expect(second.jobId).toBe(first.jobId);
    // NEVER a second effect: exactly ONE durable submission for the key
    expect(queue.calls.length).toBe(1);
    expect(queue.jobs.size).toBe(1);
    // getReceipt is the same recorded receipt
    expect(gateway.getReceipt('intent.submit', 'idem-replay-1')).toBe(first.receipt);
  });

  test('the same key under a DIFFERENT kind is a distinct command (the DEP-003 dedupe identity is (kind, key))', async () => {
    const { queue, gateway } = makeGateway();
    const submit = await gateway.submitCommand(intentSubmitEnvelope('idem-shared'));
    const authorize = await gateway.submitCommand(intentAuthorizeEnvelope('idem-shared'));
    expect(submit.ok).toBe(true);
    expect(authorize.ok).toBe(true);
    if (!submit.ok || !authorize.ok) return;
    expect(submit.receipt.commandId === authorize.receipt.commandId).toBe(false);
    expect(queue.calls.length).toBe(2);
    expect(queue.jobs.size).toBe(2);
  });

  test('a different key is a new command: a second enqueue, a second receipt', async () => {
    const { queue, gateway } = makeGateway();
    await gateway.submitCommand(intentSubmitEnvelope('idem-a'));
    await gateway.submitCommand(intentSubmitEnvelope('idem-b'));
    expect(queue.calls.length).toBe(2);
    expect(queue.jobs.size).toBe(2);
    expect(gateway.getReceipt('intent.submit', 'idem-a') === gateway.getReceipt('intent.submit', 'idem-b')).toBe(false);
  });

  test('25 CONCURRENT same-key submissions collapse to ONE receipt object and ONE enqueue (INV-1-2)', async () => {
    const { queue, gateway } = makeGateway();
    const results = await Promise.all(
      Array.from({ length: 25 }, () => gateway.submitCommand(intentSubmitEnvelope('idem-collapse'))),
    );
    const okResults = results.filter((result) => result.ok);
    expect(okResults.length).toBe(25);
    expect(okResults.filter((result) => result.replayed).length).toBe(24);
    expect(okResults.filter((result) => !result.replayed).length).toBe(1);
    const receipts = new Set(okResults.map((result) => result.receipt));
    expect(receipts.size).toBe(1);
    expect(queue.calls.length).toBe(1);
    expect(queue.jobs.size).toBe(1);
  });

  test('cross-restart semantics: a receipt-memory loss resubmits, the queue dedupes (created: false), and the DUPLICATE outcome is recorded — still ONE durable job', async () => {
    // Gateway process A admits the command; its in-memory receipt is then
    // lost (a restart). Gateway process B shares the durable queue.
    const log = createEvidenceLog({ wallMs: 1_000 });
    const queue = new QueueDouble();
    const gatewayA = new ProtocolGateway({ evidence: log, queue, wallClock: () => 5_000 });
    const first = await gatewayA.submitCommand(intentSubmitEnvelope('idem-restart'));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.receipt.outcome).toBe('ADMITTED');

    const gatewayB = new ProtocolGateway({ evidence: log, queue, wallClock: () => 6_000 });
    const second = await gatewayB.submitCommand(intentSubmitEnvelope('idem-restart'));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.replayed).toBe(true);
    expect(second.created).toBe(false);
    // The honest outcome for this submission: the queue absorbed it as a
    // duplicate of the existing durable job.
    expect(second.receipt.outcome).toBe('DUPLICATE');
    expect(second.jobId).toBe(first.jobId);
    // Exactly ONE durable job for the (kind, key) — never a second effect;
    // two enqueue CALLS happened (B did call) but only one row exists.
    expect(queue.calls.length).toBe(2);
    expect(queue.jobs.size).toBe(1);
  });

  test('a valid duplicate resubmitted after an INVALID duplicate: the invalid one is rejected (with evidence), the valid one replays', async () => {
    const { log, queue, gateway } = makeGateway();
    const first = await gateway.submitCommand(intentSubmitEnvelope('idem-order'));
    const invalid = await gateway.submitCommand({
      ...((intentSubmitEnvelope('idem-order') as Record<string, unknown>)),
      body: { descriptor: null },
    });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.reasonCode).toBe('COMMAND_BODY_INVALID');
    const third = await gateway.submitCommand(intentSubmitEnvelope('idem-order'));
    expect(third.ok).toBe(true);
    if (!third.ok || !first.ok) return;
    expect(third.receipt).toBe(first.receipt);
    expect(queue.calls.length).toBe(1);
    // The invalid resubmission's rejection IS recorded (one record); the
    // valid replay adds none.
    expect(log.height).toBe(2);
  });

  test('a failed enqueue leaves NO receipt recorded — same-key retry is safe and then admits', async () => {
    const { queue, gateway } = makeGateway();
    queue.failNext = true;
    let threw = false;
    try {
      await gateway.submitCommand(intentSubmitEnvelope('idem-fail-retry'));
    } catch (error) {
      threw = true;
      expect((error as Error).message).toContain('queue double: induced submit failure');
    }
    expect(threw).toBe(true);
    expect(gateway.getReceipt('intent.submit', 'idem-fail-retry')).toBe(undefined);
    // The retry under the same key admits normally (the failed attempt
    // recorded nothing).
    const retry = await gateway.submitCommand(intentSubmitEnvelope('idem-fail-retry'));
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.created).toBe(true);
    expect(retry.replayed).toBe(false);
    expect(queue.jobs.size).toBe(1);
  });
});
