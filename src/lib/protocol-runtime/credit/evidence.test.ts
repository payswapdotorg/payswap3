/**
 * RTN-007 — Credit Authority: the A07 evidence records — shapes,
 * arithmetic proofs, and the real-log coupling.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §2 Area 7, lines
 *   138-140: "Evidence produced — CREDIT_LINE_STATE_CHANGED.
 *    CREDIT_DECIDED (decision id, key, outcome, reason code).
 *    EXPOSURE_CHANGED (post-transition integer arithmetic proof)."
 *   spec/architecture/v0.1/README.md §3 GC-5 (exactly one record per
 *    consequential operation).
 */
import { describe, expect, test } from 'bun:test';
import { createEvidenceLog } from '../evidence/log.ts';
import { money } from '../kernel/money.ts';
import { ReservationLedger } from '../reservations/ledger.ts';
import { CreditAuthority } from './authority.ts';
import { CREDIT_AUTHORITY_ID, CREDIT_EVIDENCE_VOCABULARY } from './evidence.ts';
import type { EvidenceSubmission, EvidenceSubmissionRecord } from '../kernel/ports.ts';

function makeAuthority() {
  const log = createEvidenceLog({ wallMs: 1_000 });
  const records: EvidenceSubmissionRecord[] = [];
  const recorder: EvidenceSubmission = {
    submit: (record) => {
      records.push(record);
    },
  };
  let wall = 5_000;
  const ledger = new ReservationLedger({ evidence: log, wallClock: () => wall });
  const authority = new CreditAuthority({ evidence: recorder, ledger, wallClock: () => wall });
  return { log, records, ledger, authority };
}

const AMOUNT = (minor: number) => money('EUR', minor, 2);

describe('A07 evidence records (the named set, with arithmetic proofs)', () => {
  test('line transitions write CREDIT_LINE_STATE_CHANGED with the grounded reasons', async () => {
    const { records, authority } = makeAuthority();
    await authority.offerLine({ lineId: 'line-a', limit: AMOUNT(1_000_00) });
    await authority.activateLine('line-a');
    await authority.suspendLine('line-a');
    await authority.closeLine('line-a');
    const lineRecords = records.filter(
      (record) => record.what.operationType === 'CREDIT_LINE_STATE_CHANGED',
    );
    expect(lineRecords.map((record) => record.outcome.result)).toEqual([
      'OFFERED',
      'ACTIVE',
      'SUSPENDED',
      'CLOSED',
    ]);
    for (const record of lineRecords) {
      expect(record.authority).toBe(CREDIT_AUTHORITY_ID);
      expect(record.what.subjectIds).toEqual(['line-a']);
      expect(record.proof.sequenceNumbers?.[0]).toBe(1_000_00);
    }
  });

  test('evaluation writes CREDIT_DECIDED carrying the decision id, key, outcome, and reason', async () => {
    const { records, authority } = makeAuthority();
    await authority.offerLine({ lineId: 'line-a', limit: AMOUNT(500_00) });
    await authority.activateLine('line-a');
    await authority.evaluateCreditUsage({
      intentId: 'pid.v1.intent-1',
      lineId: 'line-a',
      requestedAmount: AMOUNT(123_00),
    });
    await authority.evaluateCreditUsage({
      intentId: 'pid.v1.intent-big',
      lineId: 'line-a',
      requestedAmount: AMOUNT(900_00),
    });
    const decided = records.filter(
      (record) => record.what.operationType === 'CREDIT_DECIDED',
    );
    expect(decided.length).toBe(2);
    const [approved, denied] = decided as [EvidenceSubmissionRecord, EvidenceSubmissionRecord];
    expect(approved.outcome.result).toBe('APPROVED');
    // "CREDIT_DECIDED (decision id, key, outcome, reason code)": the key
    // is (intent id, line id) — both ride the subject ids.
    expect(approved.what.subjectIds).toContain('pid.v1.intent-1');
    expect(approved.what.subjectIds).toContain('line-a');
    expect(approved.proof.hashes?.length).toBe(1);
    expect(approved.proof.sequenceNumbers).toEqual([500_00, 0]);
    expect(denied.outcome.result).toBe('DENIED');
    expect(denied.outcome.reasonCode).toBe('INSUFFICIENT_REMAINING_LIMIT');
  });

  test('every ledger mutation of exposure writes EXPOSURE_CHANGED with the post-transition proof', async () => {
    const { records, authority } = makeAuthority();
    await authority.offerLine({ lineId: 'line-a', limit: AMOUNT(1_000_00) });
    await authority.activateLine('line-a');
    const evaluation = await authority.evaluateCreditUsage({
      intentId: 'pid.v1.intent-1',
      lineId: 'line-a',
      requestedAmount: AMOUNT(400_00),
    });
    const applied = await authority.applyCreditDecision({
      decisionId: evaluation.ok ? evaluation.decision.decisionId : '',
      hopId: 'pid.v1.hop-1',
      deadlineEpochMs: 60_000,
    });
    await authority.consumeCreditReservation(applied.ok ? applied.reservationId : '');
    const exposureRecords = records.filter(
      (record) => record.what.operationType === 'EXPOSURE_CHANGED',
    );
    // One for the applied hold, one for the consumption.
    expect(exposureRecords.length).toBe(2);
    const [held, consumed] = exposureRecords as [EvidenceSubmissionRecord, EvidenceSubmissionRecord];
    expect(held.outcome.reasonCode).toBe('EXPOSURE_HELD');
    expect(held.proof.sequenceNumbers).toEqual([400_00, 1_000_00]);
    expect(held.proof.hashes?.length).toBe(1);
    expect(consumed.outcome.reasonCode).toBe('EXPOSURE_CONSUMED');
    expect(consumed.proof.sequenceNumbers).toEqual([400_00, 1_000_00]);
    // The driving reservation rides the subject ids.
    expect(consumed.what.subjectIds).toContain(applied.ok ? applied.reservationId : '');
  });

  test('rejections and unapplied evaluations emit no exposure records', async () => {
    const { records, authority } = makeAuthority();
    await authority.offerLine({ lineId: 'line-a', limit: AMOUNT(100_00) });
    await authority.activateLine('line-a');
    // A denied evaluation: one CREDIT_DECIDED, no EXPOSURE_CHANGED.
    await authority.evaluateCreditUsage({
      intentId: 'pid.v1.intent-big',
      lineId: 'line-a',
      requestedAmount: AMOUNT(900_00),
    });
    // A typed rejection: no record at all.
    await authority.applyCreditDecision({
      decisionId: 'pid.v1.missing',
      hopId: 'pid.v1.hop-x',
      deadlineEpochMs: 60_000,
    });
    expect(records.filter((record) => record.what.operationType === 'EXPOSURE_CHANGED').length).toBe(0);
  });

  test('the records submit to the REAL A15 log (authority slot validated)', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    let wall = 5_000;
    const ledger = new ReservationLedger({ evidence: log, wallClock: () => wall });
    const authority = new CreditAuthority({ evidence: log, ledger, wallClock: () => wall });
    await authority.offerLine({ lineId: 'line-real', limit: AMOUNT(1_000_00) });
    await authority.activateLine('line-real');
    const evaluation = await authority.evaluateCreditUsage({
      intentId: 'pid.v1.intent-real',
      lineId: 'line-real',
      requestedAmount: AMOUNT(200_00),
    });
    await authority.applyCreditDecision({
      decisionId: evaluation.ok ? evaluation.decision.decisionId : '',
      hopId: 'pid.v1.hop-real',
      deadlineEpochMs: 60_000,
    });
    const written = log.records().filter((record) => record.authority === 'Credit Authority');
    expect(written.length).toBeGreaterThan(2);
    const types = new Set(written.map((record) => record.what.operationType));
    expect(types.has('CREDIT_LINE_STATE_CHANGED')).toBe(true);
    expect(types.has('CREDIT_DECIDED')).toBe(true);
    expect(types.has('EXPOSURE_CHANGED')).toBe(true);
  });
});
