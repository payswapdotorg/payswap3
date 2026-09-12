/**
 * RTN-010 — Rejection-evidence tests: rejected commands are recorded as
 * evidence (admission decisions are consequential records).
 *
 * Work order acceptance (RTN-010.md line 16): "Rejected commands are
 * recorded as evidence (admission decisions are consequential records)."
 * Spec ground (evidence-risk-compliance.md §1 Area 15, lines 26-32 — the
 * five mandatory slots; lines 62-64 — "an operation is not committed until
 * its record is written. A failed write fails the operation"; README.md
 * §3 GC-5): every typed admission refusal writes EXACTLY ONE record to the
 * REAL A15 log (RTN-002's createEvidenceLog — merged at this base; no test
 * double) BEFORE the refusal is returned.
 *
 * Attribution cases covered: the owning authority (identity), the rails
 * vocabulary normalization ('Rail Adapter Authority' envelope ->
 * 'Rail Authority' record), a wave-2 registry authority addressed without
 * a command surface (attributed to itself), the fail-closed unattributable
 * case (throws; no record), and the failed-write-fails-the-operation
 * discipline (an evidence port that throws fails the whole admission).
 */

import { describe, expect, test } from 'bun:test';
import { createEvidenceLog } from '../evidence/log.ts';
import type { EvidenceLog } from '../evidence/log.ts';
import type { EvidenceSubmission, EvidenceSubmissionRecord } from '../kernel/ports.ts';
import { protocolTime } from '../kernel/time.ts';
import { ProtocolGateway } from './admission.ts';
import { GATEWAY_EVIDENCE_VOCABULARY } from './evidence.ts';

class QueueDouble {
  readonly calls: Array<{ readonly kind: string; readonly payload: unknown; readonly idempotencyKey: string }> = [];
  readonly jobs = new Map<string, string>();

  enqueue(
    kind: string,
    payload: unknown,
    options: { readonly idempotencyKey: string },
  ): { readonly created: boolean; readonly reason: 'enqueued' | 'deduplicated'; readonly jobId: string } {
    this.calls.push({ kind, payload, idempotencyKey: options.idempotencyKey });
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

const validIntentAuthorize = {
  kind: 'intent.authorize',
  authority: 'Intent Authority',
  subjectIds: ['pid.v1.intent-sample'],
  idempotencyKey: 'idem-evidence-1',
  protocolTime: when,
  body: { intentId: 'pid.v1.intent-sample', policyDecisionId: 'pid.v1.decision-sample' },
};

function rejectionRecords(log: EvidenceLog): Array<Record<string, unknown>> {
  return log
    .records()
    .filter(
      (record) =>
        record.what.operationType === GATEWAY_EVIDENCE_VOCABULARY.rejectedOperationType,
    )
    .map((record) => record as unknown as Record<string, unknown>);
}

describe('RTN-010 rejection evidence — one consequential record per typed refusal', () => {
  test('an envelope-invalid refusal writes EXACTLY ONE record with the five A15 slots populated for admission', async () => {
    const { log, gateway } = makeGateway();
    const result = await gateway.submitCommand({
      ...validIntentAuthorize,
      protocolTime: { sequence: -1, wallMs: 1_000 },
    });
    expect(result.ok).toBe(false);
    const records = rejectionRecords(log);
    expect(records.length).toBe(1);
    const what = records[0].what as Record<string, unknown>;
    expect(what.operationType).toBe('GATEWAY_COMMAND_REJECTED');
    const subjectIds = what.subjectIds as string[];
    expect(subjectIds).toContain('intent.authorize');
    expect(subjectIds).toContain('idem-evidence-1');
    expect(subjectIds).toContain('pid.v1.intent-sample');
    expect(records[0].authority).toBe('Intent Authority');
    const outcome = records[0].outcome as Record<string, unknown>;
    expect(outcome.result).toBe('REJECTED');
    expect(outcome.reasonCode).toBe('ENVELOPE_INVALID');
    const proof = records[0].proof as Record<string, unknown>;
    expect((proof.hashes as string[]).length).toBe(1);
    expect((proof.hashes as string[])[0].startsWith('gwsub.v1.')).toBe(true);
  });

  test('a body-invalid refusal attributes to the OWNING authority with COMMAND_BODY_INVALID', async () => {
    const { log, gateway } = makeGateway();
    const result = await gateway.submitCommand({
      ...validIntentAuthorize,
      body: { intentId: 'pid.v1.intent-sample' },
    });
    expect(result.ok).toBe(false);
    const records = rejectionRecords(log);
    expect(records.length).toBe(1);
    expect(records[0].authority).toBe('Intent Authority');
    const outcome = records[0].outcome as Record<string, unknown>;
    expect(outcome.reasonCode).toBe('COMMAND_BODY_INVALID');
  });

  test('a rails-command refusal attributes to the REGISTRY name (Rail Authority) even under the module label envelope', async () => {
    for (const authorityId of ['Rail Adapter Authority', 'Rail Authority'] as const) {
      const { log, gateway } = makeGateway();
      const result = await gateway.submitCommand({
        kind: 'rails.adapter.activate',
        authority: authorityId,
        subjectIds: ['pid.v1.adapter-sample'],
        idempotencyKey: 'idem-evidence-rails',
        protocolTime: when,
        body: {},
      });
      expect(result.ok).toBe(false);
      const records = rejectionRecords(log);
      expect(records.length).toBe(1);
      expect(records[0].authority).toBe('Rail Authority');
    }
  });

  test('an AUTHORITY_UNKNOWN refusal for a wave-2 registry authority attributes to that authority (honest: it exists, it hosts no command surface here)', async () => {
    const { log, gateway } = makeGateway();
    const result = await gateway.submitCommand({
      kind: 'simulation.run',
      authority: 'Simulation Authority',
      subjectIds: [],
      idempotencyKey: 'idem-evidence-sim',
      protocolTime: when,
      body: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('AUTHORITY_UNKNOWN');
    const records = rejectionRecords(log);
    expect(records.length).toBe(1);
    expect(records[0].authority).toBe('Simulation Authority');
  });

  test('a COMMAND_KIND_UNKNOWN refusal records the kind and key as subjects', async () => {
    const { log, gateway } = makeGateway();
    const result = await gateway.submitCommand({
      ...validIntentAuthorize,
      kind: 'intent.explode',
    });
    expect(result.ok).toBe(false);
    const records = rejectionRecords(log);
    expect(records.length).toBe(1);
    const subjectIds = (records[0].what as Record<string, unknown>).subjectIds as string[];
    expect(subjectIds).toContain('intent.explode');
    const outcome = records[0].outcome as Record<string, unknown>;
    expect(outcome.reasonCode).toBe('COMMAND_KIND_UNKNOWN');
  });

  test('a COMMAND_SUBJECT_INVALID refusal records with the subject-binding reason code', async () => {
    const { log, gateway } = makeGateway();
    const result = await gateway.submitCommand({
      ...validIntentAuthorize,
      subjectIds: [],
    });
    expect(result.ok).toBe(false);
    const records = rejectionRecords(log);
    expect(records.length).toBe(1);
    const outcome = records[0].outcome as Record<string, unknown>;
    expect(outcome.reasonCode).toBe('COMMAND_SUBJECT_INVALID');
  });

  test('ACCEPTED commands write NO rejection record; replays add none', async () => {
    const { log, gateway } = makeGateway();
    await gateway.submitCommand(validIntentAuthorize);
    await gateway.submitCommand(validIntentAuthorize);
    expect(rejectionRecords(log).length).toBe(0);
  });

  test('an unattributable submission THROWS and writes NO record (never a fabricated authority, never an unrecorded refusal)', async () => {
    const { log, gateway } = makeGateway();
    const heightBefore = log.height;
    let threw = false;
    try {
      await gateway.submitCommand({
        kind: 'market.quote',
        authority: 'Market Authority',
        subjectIds: [],
        idempotencyKey: 'idem-evidence-invented',
        protocolTime: when,
        body: {},
      });
    } catch (error) {
      threw = true;
      expect((error as Error).message).toContain('names no registry authority');
    }
    expect(threw).toBe(true);
    expect(log.height).toBe(heightBefore);
  });

  test('a FAILED EVIDENCE WRITE fails the admission operation (A15: "A failed write fails the operation") — no receipt, no enqueue', async () => {
    const queue = new QueueDouble();
    const port: EvidenceSubmission = {
      submit(record: EvidenceSubmissionRecord): void {
        // A failing A15 write (the real log throws on invalid records; this
        // double models any failed write).
        throw new Error(`evidence port failure for ${record.what.operationType}`);
      },
    };
    const gateway = new ProtocolGateway({ evidence: port, queue, wallClock: () => 5_000 });
    let threw = false;
    try {
      await gateway.submitCommand({
        ...validIntentAuthorize,
        body: { intentId: 'pid.v1.intent-sample' },
      });
    } catch (error) {
      threw = true;
      expect((error as Error).message).toContain('evidence port failure');
    }
    expect(threw).toBe(true);
    expect(gateway.getReceipt('intent.authorize', 'idem-evidence-1')).toBe(undefined);
    expect(queue.calls.length).toBe(0);
  });

  test('the rejection records chain verifies (the REAL log accepts every gateway rejection record)', async () => {
    const { log, gateway } = makeGateway();
    await gateway.submitCommand({ ...validIntentAuthorize, kind: 'intent.explode' });
    await gateway.submitCommand({ ...validIntentAuthorize, body: {} });
    await gateway.submitCommand({
      kind: 'queues.item.cancel',
      authority: 'Queue Authority',
      subjectIds: ['pid.v1.item-sample'],
      idempotencyKey: 'idem-evidence-3',
      protocolTime: when,
      body: { itemId: 'pid.v1.item-sample', reasonCode: 'NOT_A_CODE' },
    });
    const verification = log.verifyAndRecord(9_000);
    expect(verification.verdict).toBe('VERIFIED');
    expect(verification.verifiedHeight).toBe(4);
  });

  test('repeated identical refusals append distinct records (each refusal is its own consequential decision, sequenced by the gateway)', async () => {
    const { log, gateway } = makeGateway();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await gateway.submitCommand({
        ...validIntentAuthorize,
        kind: 'intent.explode',
      });
    }
    const records = rejectionRecords(log);
    expect(records.length).toBe(3);
    const sequences = records.map(
      (record) => (record.when as Record<string, unknown>).sequence as number,
    );
    expect(sequences[0] < sequences[1]).toBe(true);
    expect(sequences[1] < sequences[2]).toBe(true);
  });
});
