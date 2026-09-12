/**
 * RTN-007 — Liquidity Authority: the A06 evidence records — shapes,
 * arithmetic proofs, and the real-log coupling.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §1 Area 6, lines
 *   71-75: "Evidence produced — POOL_OPENED, POOL_FROZEN, POOL_CLOSED.
 *    POSITION_STATE_CHANGED (with post-transition arithmetic proof).
 *    FUNDING_RECORDED (linked rail operation id or internal transfer
 *    id)."
 *   spec/architecture/v0.1/README.md §3 GC-5 (exactly one record per
 *    consequential operation).
 */
import { describe, expect, test } from 'bun:test';
import { createEvidenceLog } from '../evidence/log.ts';
import { money } from '../kernel/money.ts';
import { ReservationLedger } from '../reservations/ledger.ts';
import { LiquidityAuthority } from './authority.ts';
import { LIQUIDITY_AUTHORITY_ID, LIQUIDITY_EVIDENCE_VOCABULARY } from './evidence.ts';
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
  const authority = new LiquidityAuthority({ evidence: recorder, ledger, wallClock: () => wall });
  return { records, authority };
}

const AMOUNT = money;

describe('A06 evidence records (the named set, with arithmetic proofs)', () => {
  test('pool open/freeze/close write POOL_OPENED, POOL_FROZEN, POOL_CLOSED', async () => {
    const { records, authority } = makeAuthority();
    await authority.openPool({ poolId: 'pool-a', currency: 'EUR', scale: 2 });
    await authority.freezePool('pool-a');
    await authority.closePool('pool-a');
    const operationTypes = records.map((record) => record.what.operationType);
    expect(operationTypes).toContain(LIQUIDITY_EVIDENCE_VOCABULARY.poolOpenedOperationType);
    expect(operationTypes).toContain(LIQUIDITY_EVIDENCE_VOCABULARY.poolFrozenOperationType);
    expect(operationTypes).toContain(LIQUIDITY_EVIDENCE_VOCABULARY.poolClosedOperationType);
    for (const record of records) {
      expect(record.authority).toBe(LIQUIDITY_AUTHORITY_ID);
      expect(record.what.subjectIds[0]).toBe('pool-a');
    }
    const opened = records.find(
      (record) => record.what.operationType === 'POOL_OPENED',
    ) as EvidenceSubmissionRecord;
    expect(opened.outcome.result).toBe('OPEN');
    expect(opened.proof.sequenceNumbers?.[0]).toBe(0);
  });

  test('funding writes FUNDING_RECORDED with the linked source reference id', async () => {
    const { records, authority } = makeAuthority();
    await authority.openPool({ poolId: 'pool-a', currency: 'EUR', scale: 2 });
    await authority.recordConfirmedFunding({
      poolId: 'pool-a',
      source: { kind: 'EXTERNAL_RAIL', referenceId: 'rail-op-7' },
      amount: money('EUR', 500_00, 2),
    });
    const funding = records.find(
      (record) => record.what.operationType === 'FUNDING_RECORDED',
    ) as EvidenceSubmissionRecord;
    expect(funding === undefined).toBe(false);
    // "FUNDING_RECORDED (linked rail operation id or internal transfer id)".
    expect(funding.what.subjectIds).toContain('rail-op-7');
    expect(funding.outcome.result).toBe('RECORDED');
    expect(funding.proof.sequenceNumbers?.[0]).toBe(500_00);
    expect(funding.proof.hashes?.length).toBe(1);
  });

  test('position transitions write POSITION_STATE_CHANGED with the post-transition arithmetic proof', async () => {
    const { records, authority } = makeAuthority();
    await authority.openPool({ poolId: 'pool-a', currency: 'EUR', scale: 2 });
    const funding = await authority.recordConfirmedFunding({
      poolId: 'pool-a',
      source: { kind: 'INTERNAL_TRANSFER', referenceId: 'transfer-1' },
      amount: money('EUR', 1_000_00, 2),
    });
    const positionId = funding.ok && funding.created ? funding.position.positionId : '';
    const hold = await authority.requestPositionHold({
      positionId,
      intentId: 'pid.v1.intent-1',
      hopId: 'pid.v1.hop-1',
      amount: money('EUR', 400_00, 2),
      deadlineEpochMs: 60_000,
    });
    await authority.consumeHold(hold.ok ? hold.record.reservationId : '');
    const positionRecords = records.filter(
      (record) => record.what.operationType === 'POSITION_STATE_CHANGED',
    );
    // AVAILABLE (funded) -> RESERVED (held) -> RETURNED (consumed, residual).
    expect(positionRecords.map((record) => record.outcome.result)).toEqual([
      'AVAILABLE',
      'RESERVED',
      'RETURNED',
    ]);
    for (const record of positionRecords) {
      expect(record.what.subjectIds).toContain(positionId);
      expect(record.proof.hashes?.length).toBe(1);
    }
    const reserved = positionRecords[1] as EvidenceSubmissionRecord;
    // The driving reservation id rides the subject ids; the ledger's
    // per-resource sequence rides the proof.
    expect(reserved.what.subjectIds).toContain(hold.ok ? hold.record.reservationId : '');
    expect(reserved.outcome.reasonCode).toBe('HOLD_PLACED');
    expect(reserved.proof.sequenceNumbers?.length).toBe(2);
  });

  test('accounting-only transitions emit NO liquidity record (the ledger records the reservation transition)', async () => {
    const { records, authority } = makeAuthority();
    await authority.openPool({ poolId: 'pool-a', currency: 'EUR', scale: 2 });
    const funding = await authority.recordConfirmedFunding({
      poolId: 'pool-a',
      source: { kind: 'INTERNAL_TRANSFER', referenceId: 'transfer-1' },
      amount: money('EUR', 1_000_00, 2),
    });
    const positionId = funding.ok && funding.created ? funding.position.positionId : '';
    const first = await authority.requestPositionHold({
      positionId,
      intentId: 'pid.v1.intent-1',
      hopId: 'pid.v1.hop-1',
      amount: money('EUR', 300_00, 2),
      deadlineEpochMs: 60_000,
    });
    const second = await authority.requestPositionHold({
      positionId,
      intentId: 'pid.v1.intent-2',
      hopId: 'pid.v1.hop-2',
      amount: money('EUR', 500_00, 2),
      deadlineEpochMs: 60_000,
    });
    // Second hold: still RESERVED — no additional POSITION_STATE_CHANGED
    // (the ledger's RESERVATION_HELD carries the arithmetic). The two
    // liquidity records are the funding-time AVAILABLE and the first
    // hold's RESERVED.
    const positionRecords = records.filter(
      (record) => record.what.operationType === 'POSITION_STATE_CHANGED',
    );
    expect(positionRecords.length).toBe(2);
    expect(first.ok && second.ok).toBe(true);
  });

  test('the records submit to the REAL A15 log (authority slot validated)', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    let wall = 5_000;
    const ledger = new ReservationLedger({ evidence: log, wallClock: () => wall });
    const authority = new LiquidityAuthority({ evidence: log, ledger, wallClock: () => wall });
    await authority.openPool({ poolId: 'pool-real', currency: 'EUR', scale: 2 });
    await authority.recordConfirmedFunding({
      poolId: 'pool-real',
      source: { kind: 'INTERNAL_TRANSFER', referenceId: 'transfer-real' },
      amount: money('EUR', 100_00, 2),
    });
    const written = log.records().filter((record) => record.authority === 'Liquidity Authority');
    expect(written.length).toBeGreaterThan(2);
  });
});
