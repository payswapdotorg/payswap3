/**
 * RTN-008 — Obligation Ledger Authority: the A10 evidence records —
 * shapes, proof material, and the real-log coupling.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §2 Area 10,
 *   lines 133-137 (the named set, verbatim):
 *     "Evidence produced
 *      - OBLIGATION_CREATED (origin reference, terms hash).
 *      - OBLIGATION_STATE_CHANGED (each transition, with cause
 *        reference).
 *      - OBLIGATION_WRITTEN_OFF (risk authority reference)."
 *   spec/architecture/v0.1/README.md §3 GC-5 (exactly one record per
 *   consequential operation).
 */
import { describe, expect, test } from 'bun:test';
import { createEvidenceLog } from '../evidence/log.ts';
import { money } from '../kernel/money.ts';
import type { EvidenceSubmission, EvidenceSubmissionRecord } from '../kernel/ports.ts';
import { ObligationLedgerAuthority } from './authority.ts';
import { OBLIGATION_AUTHORITY_ID, OBLIGATION_EVIDENCE_VOCABULARY } from './evidence.ts';
import { hashObligationTerms } from './state-machine.ts';

function makeAuthority() {
  const log = createEvidenceLog({ wallMs: 1_000 });
  const records: EvidenceSubmissionRecord[] = [];
  const recorder: EvidenceSubmission = {
    submit: (record) => {
      records.push(record);
    },
  };
  let wall = 5_000;
  const authority = new ObligationLedgerAuthority({
    evidence: recorder,
    wallClock: () => wall,
  });
  return { log, records, authority };
}

const EUR = (minor: number) => money('EUR', minor, 2);

async function createObligation(authority: ObligationLedgerAuthority): Promise<string> {
  const outcome = await authority.applyClearingCommand({
    batchId: 'pid.v1.batch-1',
    recordId: 'pid.v1.record-1',
    originActivityId: 'activity-1',
    originKind: 'INTENT',
    debtorParticipantId: 'participant-a',
    creditorParticipantId: 'participant-b',
    amount: EUR(1_000),
    reason: 'hop settlement',
  });
  return outcome.obligationId;
}

describe('A10 evidence records (the named set, with proof material)', () => {
  test('the vocabulary is exactly the three named operation types', () => {
    expect(OBLIGATION_EVIDENCE_VOCABULARY.obligationCreatedOperationType).toBe('OBLIGATION_CREATED');
    expect(OBLIGATION_EVIDENCE_VOCABULARY.obligationStateChangedOperationType).toBe(
      'OBLIGATION_STATE_CHANGED',
    );
    expect(OBLIGATION_EVIDENCE_VOCABULARY.obligationWrittenOffOperationType).toBe(
      'OBLIGATION_WRITTEN_OFF',
    );
  });

  test('creation writes OBLIGATION_CREATED with the origin reference and the terms hash', async () => {
    const { records, authority } = makeAuthority();
    await createObligation(authority);
    const created = records.find(
      (record) => record.what.operationType === 'OBLIGATION_CREATED',
    ) as EvidenceSubmissionRecord;
    expect(created === undefined).toBe(false);
    expect(created.authority).toBe(OBLIGATION_AUTHORITY_ID);
    // "origin reference": the origin record id, activity id, and batch id
    expect(created.what.subjectIds).toContain('pid.v1.record-1');
    expect(created.what.subjectIds).toContain('activity-1');
    expect(created.what.subjectIds).toContain('pid.v1.batch-1');
    // "terms hash": the sha256 over the canonical terms encoding
    const obligation = authority.obligations()[0];
    expect(created.proof.hashes?.[0]).toBe(
      hashObligationTerms(obligation?.terms as never),
    );
    expect(created.outcome.result).toBe('CREATED');
    expect(created.outcome.reasonCode).toBe('CLEARING_COMMIT');
  });

  test('each transition writes OBLIGATION_STATE_CHANGED with the cause reference', async () => {
    const { records, authority } = makeAuthority();
    const obligationId = await createObligation(authority);
    await authority.applySettlementInstruction({
      kind: 'SETTLEMENT_INSTRUCTION',
      obligationId,
      settlementInstructionId: 'instruction-42',
    });
    await authority.applySettlementFinality({
      kind: 'SETTLEMENT_FINALITY',
      obligationId,
      finalityRecordId: 'finality-record-9',
    });
    const changes = records.filter(
      (record) => record.what.operationType === 'OBLIGATION_STATE_CHANGED',
    );
    expect((changes).length).toBe(2);
    // "each transition, with cause reference"
    expect(changes[0]?.outcome.result).toBe('SETTLEMENT_PENDING');
    expect(changes[0]?.what.subjectIds).toContain('instruction-42');
    expect(changes[0]?.outcome.reasonCode).toBe('SETTLEMENT_INSTRUCTION');
    expect(changes[1]?.outcome.result).toBe('SETTLED');
    expect(changes[1]?.what.subjectIds).toContain('finality-record-9');
    expect(changes[1]?.outcome.reasonCode).toBe('SETTLEMENT_FINALITY');
  });

  test('the write-off transition writes OBLIGATION_WRITTEN_OFF with the risk authority reference (not STATE_CHANGED)', async () => {
    const { records, authority } = makeAuthority();
    const obligationId = await createObligation(authority);
    await authority.applyRiskWriteOff({
      kind: 'RISK_WRITE_OFF',
      obligationId,
      riskAuthorityReference: 'risk-disposition-7',
    });
    const writtenOff = records.find(
      (record) => record.what.operationType === 'OBLIGATION_WRITTEN_OFF',
    ) as EvidenceSubmissionRecord;
    expect(writtenOff === undefined).toBe(false);
    // "OBLIGATION_WRITTEN_OFF (risk authority reference)"
    expect(writtenOff.authority).toBe(OBLIGATION_AUTHORITY_ID);
    expect(writtenOff.what.subjectIds).toContain('risk-disposition-7');
    expect(writtenOff.outcome.result).toBe('WRITTEN_OFF');
    // the write-off's ONE record is OBLIGATION_WRITTEN_OFF — GC-5's
    // exactly-one per operation (no second OBLIGATION_STATE_CHANGED)
    const changes = records.filter(
      (record) => record.what.operationType === 'OBLIGATION_STATE_CHANGED',
    );
    expect((changes).length).toBe(0);
  });

  test('duplicate creations and no-op re-observations emit NO record', async () => {
    const { records, authority } = makeAuthority();
    await createObligation(authority);
    const count = records.length;
    // a duplicate creation no-op (INV-10-3)
    await createObligation(authority);
    expect(records.length).toBe(count);
    // a no-op settlement instruction (already pending) — first make it pending
    const obligationId = authority.obligations()[0]?.obligationId ?? '';
    await authority.applySettlementInstruction({
      kind: 'SETTLEMENT_INSTRUCTION',
      obligationId,
      settlementInstructionId: 'instruction-1',
    });
    const countAfterPending = records.length;
    await authority.applySettlementInstruction({
      kind: 'SETTLEMENT_INSTRUCTION',
      obligationId,
      settlementInstructionId: 'instruction-2',
    });
    expect(records.length).toBe(countAfterPending);
  });
});

describe('the real-log coupling (the RTN-002 EvidenceLog accepts every A10 record)', () => {
  test('a full journey writes its records to the REAL A15 log and the chain verifies', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    let wall = 5_000;
    const authority = new ObligationLedgerAuthority({
      evidence: log,
      wallClock: () => wall,
    });
    const obligationId = await authority.applyClearingCommand({
      batchId: 'pid.v1.batch-1',
      recordId: 'pid.v1.record-1',
      originActivityId: 'activity-1',
      originKind: 'INTENT',
      debtorParticipantId: 'participant-a',
      creditorParticipantId: 'participant-b',
      amount: EUR(1_000),
      reason: 'hop settlement',
    }).then((outcome) => outcome.obligationId);
    await authority.applySettlementInstruction({
      kind: 'SETTLEMENT_INSTRUCTION',
      obligationId,
      settlementInstructionId: 'instruction-1',
    });
    await authority.applySettlementFinality({
      kind: 'SETTLEMENT_FINALITY',
      obligationId,
      finalityRecordId: 'finality-1',
    });
    // a second obligation that gets written off
    const secondId = await authority.applyClearingCommand({
      batchId: 'pid.v1.batch-1',
      recordId: 'pid.v1.record-2',
      originActivityId: 'activity-2',
      originKind: 'INTENT',
      debtorParticipantId: 'participant-b',
      creditorParticipantId: 'participant-c',
      amount: EUR(2_000),
      reason: 'hop settlement',
    }).then((outcome) => outcome.obligationId);
    await authority.applyRiskWriteOff({
      kind: 'RISK_WRITE_OFF',
      obligationId: secondId,
      riskAuthorityReference: 'risk-disposition-1',
    });
    const operationTypes = log.records().map((record) => record.what.operationType);
    expect(operationTypes).toContain('OBLIGATION_CREATED');
    expect(operationTypes).toContain('OBLIGATION_STATE_CHANGED');
    expect(operationTypes).toContain('OBLIGATION_WRITTEN_OFF');
    for (const record of log.records()) {
      if (record.what.operationType.startsWith('OBLIGATION_')) {
        expect(record.authority).toBe('Obligation Authority');
      }
    }
    const verification = log.verifyAndRecord(wall);
    expect(verification.verdict).toBe('VERIFIED');
  });
});
