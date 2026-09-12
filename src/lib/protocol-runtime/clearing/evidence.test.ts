/**
 * RTN-008 — Clearing Authority: the A09 evidence records — shapes, proof
 * material, and the real-log coupling.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §1 Area 9,
 *   lines 66-70 (the named set, verbatim):
 *     "Evidence produced
 *      - BATCH_STAGED (record count, per-currency totals hash).
 *      - BATCH_COMMITTED (obligation ids created, idempotency proof).
 *      - RECORD_QUARANTINED (reason code, origin reference)."
 *   spec/architecture/v0.1/README.md §3 GC-5 (exactly one record per
 *   consequential operation).
 */
import { describe, expect, test } from 'bun:test';
import { createEvidenceLog } from '../evidence/log.ts';
import { money } from '../kernel/money.ts';
import type { EvidenceSubmission, EvidenceSubmissionRecord } from '../kernel/ports.ts';
import { ClearingAuthority } from './authority.ts';
import type { ObligationLedgerSink } from './authority.ts';
import { CLEARING_AUTHORITY_ID, CLEARING_EVIDENCE_VOCABULARY } from './evidence.ts';

function makeSink(): ObligationLedgerSink {
  const created = new Map<string, string>();
  let ordinal = 0;
  return {
    async applyClearingCommand(instruction) {
      const existing = created.get(instruction.recordId);
      if (existing !== undefined) {
        return { obligationId: existing, duplicate: true };
      }
      const obligationId = `pid.v1.obligation-${++ordinal}`;
      created.set(instruction.recordId, obligationId);
      return { obligationId, duplicate: false };
    },
    hasObligation(obligationId) {
      return [...created.values()].includes(obligationId);
    },
  };
}

function makeAuthority() {
  const log = createEvidenceLog({ wallMs: 1_000 });
  const records: EvidenceSubmissionRecord[] = [];
  const recorder: EvidenceSubmission = {
    submit: (record) => {
      records.push(record);
    },
  };
  let wall = 5_000;
  const authority = new ClearingAuthority({
    evidence: recorder,
    sink: makeSink(),
    wallClock: () => wall,
  });
  return { log, records, authority };
}

const EUR = (minor: number) => money('EUR', minor, 2);

describe('A09 evidence records (the named set, with proof material)', () => {
  test('the vocabulary is exactly the three named operation types', () => {
    expect(CLEARING_EVIDENCE_VOCABULARY.batchStagedOperationType).toBe('BATCH_STAGED');
    expect(CLEARING_EVIDENCE_VOCABULARY.batchCommittedOperationType).toBe('BATCH_COMMITTED');
    expect(CLEARING_EVIDENCE_VOCABULARY.recordQuarantinedOperationType).toBe('RECORD_QUARANTINED');
  });

  test('staging writes BATCH_STAGED with the record count and per-currency totals hash', async () => {
    const { records, authority } = makeAuthority();
    const opened = await authority.openBatch({ batchLabel: 'evidence-batch' });
    const batchId = opened.ok ? opened.value.batchId : '';
    await authority.addRecord(batchId, {
      origin: { originActivityId: 'activity-1', originKind: 'INTENT' },
      parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
      amount: EUR(1_000),
      reason: 'hop settlement',
    });
    await authority.stageBatch(batchId);
    const staged = records.find(
      (record) => record.what.operationType === 'BATCH_STAGED',
    ) as EvidenceSubmissionRecord;
    expect(staged === undefined).toBe(false);
    // "BATCH_STAGED (record count, per-currency totals hash)"
    expect(staged.authority).toBe(CLEARING_AUTHORITY_ID);
    expect(staged.what.subjectIds).toEqual([batchId]);
    expect(staged.outcome.result).toBe('STAGED');
    expect(staged.proof.sequenceNumbers?.[0]).toBe(1); // the record count
    expect(staged.proof.hashes?.[0]).toBe(authority.batch(batchId)?.contentsHash);
    // the per-currency totals hash is derived from the staged integer
    // summation — deterministic
    expect(staged.proof.hashes?.[0]?.length).toBe(64);
  });

  test('a quarantine writes RECORD_QUARANTINED with the reason code and origin reference', async () => {
    const { records, authority } = makeAuthority();
    const opened = await authority.openBatch({ batchLabel: 'quarantine-evidence' });
    const batchId = opened.ok ? opened.value.batchId : '';
    await authority.addRecord(batchId, {
      origin: { originActivityId: 'activity-bad', originKind: 'INTENT' },
      parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
      amount: EUR(0),
      reason: 'hop settlement',
    });
    await authority.stageBatch(batchId);
    const quarantined = records.find(
      (record) => record.what.operationType === 'RECORD_QUARANTINED',
    ) as EvidenceSubmissionRecord;
    expect(quarantined === undefined).toBe(false);
    // "RECORD_QUARANTINED (reason code, origin reference)"
    expect(quarantined.authority).toBe(CLEARING_AUTHORITY_ID);
    expect(quarantined.outcome.reasonCode).toBe('ZERO_AMOUNT');
    expect(quarantined.outcome.result).toBe('QUARANTINED');
    // the origin reference: batch id + record id + origin activity id
    expect(quarantined.what.subjectIds[2]).toBe('activity-bad');
    expect(quarantined.what.subjectIds[0]).toBe(batchId);
  });

  test('committing writes BATCH_COMMITTED with the obligation ids created and the idempotency proof', async () => {
    const { records, authority } = makeAuthority();
    const opened = await authority.openBatch({ batchLabel: 'commit-evidence' });
    const batchId = opened.ok ? opened.value.batchId : '';
    await authority.addRecord(batchId, {
      origin: { originActivityId: 'activity-1', originKind: 'INTENT' },
      parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
      amount: EUR(1_000),
      reason: 'hop settlement',
    });
    await authority.stageBatch(batchId);
    await authority.commitBatch(batchId);
    const committed = records.find(
      (record) => record.what.operationType === 'BATCH_COMMITTED',
    ) as EvidenceSubmissionRecord;
    expect(committed === undefined).toBe(false);
    expect(committed.authority).toBe(CLEARING_AUTHORITY_ID);
    expect(committed.outcome.result).toBe('COMMITTED');
    // "BATCH_COMMITTED (obligation ids created, idempotency proof)":
    // subject ids = batch id + the created obligation ids
    expect(committed.what.subjectIds[0]).toBe(batchId);
    expect(committed.what.subjectIds?.[1]?.startsWith('pid.v1.obligation-')).toBe(true);
    // the idempotency proof: the commit's derived idempotency key
    const idempotencyKey = committed.proof.hashes?.[0];
    expect(typeof idempotencyKey).toBe('string');
    expect(idempotencyKey?.startsWith('idem.v1.')).toBe(true);
    expect(committed.proof.sequenceNumbers?.[0]).toBe(1); // obligations created
  });

  test('the FINAL transition writes NO clearing record (the named set is exhaustive)', async () => {
    const { records, authority } = makeAuthority();
    const opened = await authority.openBatch({ batchLabel: 'final-evidence' });
    const batchId = opened.ok ? opened.value.batchId : '';
    await authority.addRecord(batchId, {
      origin: { originActivityId: 'activity-1', originKind: 'INTENT' },
      parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
      amount: EUR(1_000),
      reason: 'hop settlement',
    });
    await authority.stageBatch(batchId);
    await authority.commitBatch(batchId);
    const before = records.length;
    await authority.finalizeBatch(batchId);
    expect(records.length).toBe(before); // no BATCH_FINAL member exists
  });

  test('re-commit (INV-9-3) and duplicate creations emit NO second record', async () => {
    const { records, authority } = makeAuthority();
    const opened = await authority.openBatch({ batchLabel: 'recommit-evidence' });
    const batchId = opened.ok ? opened.value.batchId : '';
    await authority.addRecord(batchId, {
      origin: { originActivityId: 'activity-1', originKind: 'INTENT' },
      parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
      amount: EUR(1_000),
      reason: 'hop settlement',
    });
    await authority.stageBatch(batchId);
    await authority.commitBatch(batchId);
    const countAfterFirst = records.length;
    await authority.commitBatch(batchId); // INV-9-3 re-commit no-op
    expect(records.length).toBe(countAfterFirst);
  });
});

describe('the real-log coupling (the RTN-002 EvidenceLog accepts every A09 record)', () => {
  test('a full clearing journey writes its records to the REAL A15 log and the chain verifies', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    let wall = 5_000;
    const authority = new ClearingAuthority({
      evidence: log,
      sink: makeSink(),
      wallClock: () => wall,
    });
    const opened = await authority.openBatch({ batchLabel: 'real-log-batch' });
    const batchId = opened.ok ? opened.value.batchId : '';
    await authority.addRecord(batchId, {
      origin: { originActivityId: 'activity-1', originKind: 'INTENT' },
      parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
      amount: EUR(2_500),
      reason: 'hop settlement',
    });
    await authority.addRecord(batchId, {
      origin: { originActivityId: 'activity-bad', originKind: 'ROUTE_PLAN_HOP' },
      parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
      amount: EUR(0),
      reason: 'hop settlement',
    });
    await authority.stageBatch(batchId);
    // the quarantined record blocks the commit; open a clean batch for
    // the commit path
    const second = await authority.openBatch({ batchLabel: 'real-log-clean' });
    const cleanId = second.ok ? second.value.batchId : '';
    await authority.addRecord(cleanId, {
      origin: { originActivityId: 'activity-2', originKind: 'INTENT' },
      parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
      amount: EUR(1_200),
      reason: 'hop settlement',
    });
    await authority.stageBatch(cleanId);
    await authority.commitBatch(cleanId);
    // every A09 record type is in the real log
    const operationTypes = log.records().map((record) => record.what.operationType);
    expect(operationTypes).toContain('BATCH_STAGED');
    expect(operationTypes).toContain('RECORD_QUARANTINED');
    expect(operationTypes).toContain('BATCH_COMMITTED');
    for (const record of log.records()) {
      if (record.what.operationType.startsWith('BATCH_') || record.what.operationType === 'RECORD_QUARANTINED') {
        expect(record.authority).toBe('Clearing Authority');
      }
    }
    // the chain verifies from genesis (INV-15-3)
    const verification = log.verifyAndRecord(wall);
    expect(verification.verdict).toBe('VERIFIED');
  });
});
