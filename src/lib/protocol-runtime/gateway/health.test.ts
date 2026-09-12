/**
 * RTN-010 — Health/readiness function tests.
 *
 * Work order acceptance (RTN-010.md line 18): "Readiness/health functions
 * report command acceptance and queue-submit success per the
 * components.json contract." Contract ground (deploy/contracts/
 * components.json protocol-gateway health_signal): "Readiness endpoint;
 * command acceptance rate and latency; durable-queue submit success
 * (contract for the future work item)" — exposed here as PROGRAMMATIC
 * functions (HTTP binding is deployment work; no src/app/ route is added).
 *
 * Latency determinism: the wall clock is injected, so admission latency is
 * measured in controlled increments.
 */

import { describe, expect, test } from 'bun:test';
import { createEvidenceLog } from '../evidence/log.ts';
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

const when = protocolTime(0, 1_000);

function acceptedEnvelope(key: string): unknown {
  return {
    kind: 'intent.route',
    authority: 'Intent Authority',
    subjectIds: ['pid.v1.intent-sample'],
    idempotencyKey: key,
    protocolTime: when,
    body: { intentId: 'pid.v1.intent-sample' },
  };
}

function rejectedEnvelope(key: string): unknown {
  return {
    kind: 'intent.explode',
    authority: 'Intent Authority',
    subjectIds: ['pid.v1.intent-sample'],
    idempotencyKey: key,
    protocolTime: when,
    body: { intentId: 'pid.v1.intent-sample' },
  };
}

describe('RTN-010 health — readiness, acceptance rate, latency, queue submit success', () => {
  test('initial health: ready, zero counters, vacuous-healthy rates', () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const gateway = new ProtocolGateway({
      evidence: log,
      queue: new QueueDouble(),
      wallClock: () => 5_000,
    });
    expect(gateway.isReady()).toBe(true);
    const health = gateway.health();
    expect(health.ready).toBe(true);
    expect(health.commandsTotal).toBe(0);
    expect(health.commandsAdmitted).toBe(0);
    expect(health.commandsReplayed).toBe(0);
    expect(health.commandsRejected).toBe(0);
    expect(health.invalidSubmissions).toBe(0);
    expect(health.commandAcceptanceRate).toBe(1);
    expect(health.latencySamples).toBe(0);
    expect(health.meanAdmissionLatencyMs).toBe(0);
    expect(health.lastAdmissionLatencyMs).toBe(null);
    expect(health.queueSubmits).toBe(0);
    expect(health.queueSubmitSuccesses).toBe(0);
    expect(health.lastQueueSubmitSuccess).toBe(null);
    expect(health.queueSubmitSuccessRate).toBe(1);
  });

  test('command acceptance rate: accepted + replayed over completed typed outcomes; per-code rejection counts', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const gateway = new ProtocolGateway({
      evidence: log,
      queue: new QueueDouble(),
      wallClock: () => 5_000,
    });
    await gateway.submitCommand(acceptedEnvelope('idem-health-1'));
    await gateway.submitCommand(acceptedEnvelope('idem-health-1'));
    await gateway.submitCommand(rejectedEnvelope('idem-health-2'));
    const health = gateway.health();
    expect(health.commandsTotal).toBe(3);
    expect(health.commandsAdmitted).toBe(1);
    expect(health.commandsReplayed).toBe(1);
    expect(health.commandsRejected).toBe(1);
    expect(health.commandAcceptanceRate).toBe(2 / 3);
    expect((health.rejectionCounts as Record<string, number>)['COMMAND_KIND_UNKNOWN']).toBe(1);
  });

  test('admission latency: mean and last over a tick-advancing wall clock', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    // The clock advances by 1ms on EVERY call: the gateway reads it at
    // submission start, at receipt-mint time, and at completion — so each
    // accepted admission spans exactly 2ms of measured latency.
    let ticks = 0;
    const gateway = new ProtocolGateway({
      evidence: log,
      queue: new QueueDouble(),
      wallClock: () => {
        ticks += 1;
        return 10_000 + ticks;
      },
    });
    await gateway.submitCommand(acceptedEnvelope('idem-latency-1'));
    await gateway.submitCommand(acceptedEnvelope('idem-latency-2'));
    const health = gateway.health();
    expect(health.latencySamples).toBe(2);
    expect(health.meanAdmissionLatencyMs).toBe(2);
    expect(health.lastAdmissionLatencyMs).toBe(2);
  });

  test('durable-queue submit success: the failed enqueue is counted, the operation fails, and the rate reflects it', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const queue = new QueueDouble();
    const gateway = new ProtocolGateway({ evidence: log, queue, wallClock: () => 5_000 });
    await gateway.submitCommand(acceptedEnvelope('idem-submit-1'));
    queue.failNext = true;
    let threw = false;
    try {
      await gateway.submitCommand(acceptedEnvelope('idem-submit-2'));
    } catch (error) {
      threw = true;
      expect((error as Error).message).toContain('queue double');
    }
    expect(threw).toBe(true);
    const health = gateway.health();
    expect(health.queueSubmits).toBe(2);
    expect(health.queueSubmitSuccesses).toBe(1);
    expect(health.lastQueueSubmitSuccess).toBe(false);
    expect(health.queueSubmitSuccessRate).toBe(1 / 2);
    expect(health.invalidSubmissions).toBe(1);
    // the failed admission contributed no typed outcome
    expect(health.commandsTotal).toBe(1);
    expect(health.commandsAdmitted).toBe(1);
  });

  test('constructor rejects malformed ports (fail-closed construction)', () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    expect(() => new ProtocolGateway({ evidence: null as never, queue: new QueueDouble() })).toThrow(
      /must be an EvidenceSubmission port/,
    );
    expect(() => new ProtocolGateway({ evidence: log, queue: {} as never })).toThrow(
      /must be a CommandQueuePort/,
    );
    expect(
      () =>
        new ProtocolGateway({
          evidence: log,
          queue: new QueueDouble(),
          wallClock: 'not-a-function' as never,
        }),
    ).toThrow(/must be a function when present/);
  });
});
