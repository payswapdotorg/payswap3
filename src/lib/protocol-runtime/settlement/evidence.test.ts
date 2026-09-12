/**
 * RTN-009 — Settlement and Finality Authority: the A12 named evidence set
 * against the REAL RTN-002 A15 log.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §4 Area 12,
 *   lines 275-279 (the complete named set — verbatim):
 *     "Evidence produced
 *      - SETTLEMENT_INSTRUCTION_CREATED (obligation id, amount hash).
 *      - SETTLEMENT_ATTEMPT_AUTHORIZED (attempt id, rail op id).
 *      - SETTLEMENT_ATTEMPT_RESOLVED (outcome, resolution reference).
 *      - FINALITY_DECLARED (PROVISIONAL or FINAL, rule reference, proof)."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15 lines
 *   26-32, 62-64. spec/architecture/v0.1/README.md §3 GC-5.
 */
import { describe, expect, test } from 'bun:test';
import { createEvidenceLog } from '../evidence/log.ts';
import { money } from '../kernel/money.ts';
import { NettingAuthority } from '../netting/authority.ts';
import type { NettingObligationLedgerPort } from '../netting/authority.ts';
import { obligationLedgerPortFromAuthority, nettingPortFromAuthority } from './ports.ts';
import { ObligationLedgerAuthority } from '../obligations/authority.ts';
import type { ClearingCreationInstruction } from '../obligations/authority.ts';
import { SimulatedRail, createSimulatedRailAdapter } from '../rails/adapters.ts';
import { InMemoryRailsDouble } from './rails-test-double.ts';
import { SettlementAuthority } from './authority.ts';
import {
  railIdempotencyKeyForInstruction,
  settlementInstructionIdFor,
} from './state-machine.ts';
import { obligationIdForOriginRecord } from '../obligations/state-machine.ts';
import { SETTLEMENT_AUTHORITY_ID, SETTLEMENT_EVIDENCE_VOCABULARY } from './evidence.ts';

const EUR = (minor: number) => money('EUR', minor, 2);

function makeHarness(script: Record<string, 'ACCEPT_REPORT_CONFIRMED' | 'ACCEPT_REPORT_FAILED' | 'ACCEPT_REPORT_UNKNOWN' | 'ACCEPT_NO_REPORT' | 'REJECT_AT_SUBMISSION' | 'TRANSMIT_TIMEOUT'> = {}) {
  const log = createEvidenceLog({ wallMs: 1_000 });
  let wall = 5_000;
  const clock = () => wall;
  const rails = new InMemoryRailsDouble(clock);
  const adapterId = rails.registerAndActivateAdapter('sim-bank', 'primary');
  const rail = new SimulatedRail('bank-1', script);
  const connection = createSimulatedRailAdapter(rail, { wallClock: clock });
  const obligations = new ObligationLedgerAuthority({ evidence: log, wallClock: clock });
  const netting = new NettingAuthority({
    evidence: log,
    obligations: obligations as unknown as NettingObligationLedgerPort,
    wallClock: clock,
  });
  const settlement = new SettlementAuthority({
    evidence: log,
    rails,
    obligations: obligationLedgerPortFromAuthority(obligations),
    netting: nettingPortFromAuthority(netting),
    wallClock: clock,
  });
  return { log, rails, connection, adapterId, obligations, netting, settlement };
}

describe('the A12 named evidence set (lines 275-279, to the REAL A15 log)', () => {
  test('one record per consequential operation through the whole confirmed journey; the vocabulary is exactly the four named records', () => {
    expect([...SETTLEMENT_EVIDENCE_VOCABULARY]).toEqual([
      'SETTLEMENT_INSTRUCTION_CREATED',
      'SETTLEMENT_ATTEMPT_AUTHORIZED',
      'SETTLEMENT_ATTEMPT_RESOLVED',
      'FINALITY_DECLARED',
    ]);
  });

  test('the confirmed journey writes the exact sequence: CREATED, AUTHORIZED, RESOLVED(PENDING), RESOLVED(CONFIRMED), FINALITY(PROVISIONAL), FINALITY(FINAL)', async () => {
    const obligationId = obligationIdForOriginRecord('ev1');
    const instructionId = settlementInstructionIdFor({ kind: 'OBLIGATION', obligationId }, 1);
    const key = railIdempotencyKeyForInstruction(instructionId);
    const harness = makeHarness({ [key]: 'ACCEPT_REPORT_CONFIRMED' });
    const o1 = await harness.obligations.applyClearingCommand({
      batchId: 'batch-ev1',
      recordId: 'ev1',
      originActivityId: 'activity-ev1',
      originKind: 'INTENT',
      debtorParticipantId: 'x',
      creditorParticipantId: 'y',
      amount: EUR(4_200),
      reason: 'evidence fixture',
    } as Omit<ClearingCreationInstruction, 'kind'>);
    expect(o1.obligationId).toBe(obligationId);
    const before = harness.log.records().length;
    await harness.settlement.createSettlementInstruction({
      subject: { kind: 'OBLIGATION', obligationId },
      beneficiary: 'acct-y',
    });
    await harness.settlement.authorizeAttempt(instructionId, harness.adapterId);
    await harness.settlement.submitAttempt(instructionId, harness.connection);
    harness.rails.recordReport(
      harness.settlement.attemptForInstruction(instructionId)?.operationId ?? '',
      harness.connection.fetchReport(key),
    );
    await harness.settlement.applyRailOutcome(instructionId);
    await harness.settlement.declareFinality(instructionId);
    const records = harness.log.records().slice(before).filter(
      (record) => record.authority === SETTLEMENT_AUTHORITY_ID,
    );
    expect(records.map((record) => record.what.operationType)).toEqual([
      'SETTLEMENT_INSTRUCTION_CREATED',
      'SETTLEMENT_ATTEMPT_AUTHORIZED',
      'SETTLEMENT_ATTEMPT_RESOLVED',
      'SETTLEMENT_ATTEMPT_RESOLVED',
      'FINALITY_DECLARED',
      'FINALITY_DECLARED',
    ]);
    expect(records.map((record) => record.outcome.result)).toEqual([
      'CREATED',
      'AUTHORIZED',
      'PENDING',
      'CONFIRMED',
      'PROVISIONAL',
      'FINAL',
    ]);
    // "(obligation id, amount hash)" — the instruction record.
    expect(records[0]?.what.subjectIds).toEqual([instructionId, obligationId]);
    expect(records[0]?.proof.hashes?.length).toBe(1);
    // "(attempt id, rail op id)" — the authorization record.
    expect(records[1]?.what.subjectIds[0]).toBe(
      harness.settlement.attemptForInstruction(instructionId)?.attemptId,
    );
    expect(records[1]?.what.subjectIds[1]).toBe(
      harness.settlement.attemptForInstruction(instructionId)?.operationId,
    );
    // "(outcome, resolution reference)" — the resolution records.
    expect(records[2]?.outcome.result).toBe('PENDING');
    expect(records[3]?.outcome.result).toBe('CONFIRMED');
    // "(PROVISIONAL or FINAL, rule reference, proof)".
    expect(records[4]?.outcome.result).toBe('PROVISIONAL');
    expect(records[4]?.outcome.reasonCode).toBe('RAIL_CONFIRMATION_SEMANTICS');
    expect(records[5]?.outcome.result).toBe('FINAL');
    expect(records[5]?.outcome.reasonCode).toBe(
      'PROTOCOL_FINALITY_RULE_CONFIRMED_ATTEMPT_TERMINAL_INSTRUCTION_NO_OPEN_CASE',
    );
    // The whole log verifies.
    expect(harness.log.verifyAndRecord(90_000).verdict).toBe('VERIFIED');
  });

  test('the UNKNOWN journey records the UNKNOWN landing with the CASE reference and the resolution with the case id', async () => {
    const obligationId = obligationIdForOriginRecord('ev2');
    const instructionId = settlementInstructionIdFor({ kind: 'OBLIGATION', obligationId }, 1);
    const key = railIdempotencyKeyForInstruction(instructionId);
    const harness = makeHarness({ [key]: 'TRANSMIT_TIMEOUT' });
    await harness.obligations.applyClearingCommand({
      batchId: 'batch-ev2',
      recordId: 'ev2',
      originActivityId: 'activity-ev2',
      originKind: 'INTENT',
      debtorParticipantId: 'x',
      creditorParticipantId: 'y',
      amount: EUR(1_100),
      reason: 'evidence fixture',
    } as Omit<ClearingCreationInstruction, 'kind'>);
    const before = harness.log.records().length;
    await harness.settlement.createSettlementInstruction({
      subject: { kind: 'OBLIGATION', obligationId },
      beneficiary: 'acct-y',
    });
    await harness.settlement.authorizeAttempt(instructionId, harness.adapterId);
    await harness.settlement.submitAttempt(instructionId, harness.connection);
    const caseId = harness.settlement.attemptForInstruction(instructionId)?.reconciliationCaseId ?? '';
    expect(caseId).not.toBe('');
    await harness.rails.investigateCase(caseId);
    const resolved = harness.rails.resolveCase(caseId, {
      resolution: 'RESOLVED_CONFIRMED',
      proof: { externalRefs: ['statement-77'] },
    });
    expect(resolved.ok).toBe(true);
    await harness.settlement.applyResolution(
      resolved.ok ? resolved.value.recovery : { feed: 'AREA_12_FINALITY_ADVANCE', instructionId, operationId: '', attemptOutcome: 'CONFIRMED' },
      caseId,
    );
    await harness.settlement.declareFinality(instructionId);
    const records = harness.log.records().slice(before).filter(
      (record) => record.authority === SETTLEMENT_AUTHORITY_ID,
    );
    const resolvedRecords = records.filter(
      (record) => record.what.operationType === 'SETTLEMENT_ATTEMPT_RESOLVED',
    );
    expect(resolvedRecords.map((record) => record.outcome.result)).toEqual(['UNKNOWN', 'CONFIRMED']);
    // The resolution references: the case id appears in both the UNKNOWN
    // landing and the resolution record.
    expect(resolvedRecords[0]?.proof.priorRecordIds).toContain(caseId);
    expect(resolvedRecords[1]?.proof.priorRecordIds).toContain(caseId);
    // Rejections and no-ops emit nothing: a refused instruction creation.
    const beforeRefusal = harness.log.records().length;
    const refused = await harness.settlement.createSettlementInstruction({
      subject: { kind: 'OBLIGATION', obligationId: 'pid.v1.missing' },
      beneficiary: 'acct',
    });
    expect(refused.ok).toBe(false);
    expect(harness.log.records().length).toBe(beforeRefusal);
    expect(harness.log.verifyAndRecord(95_000).verdict).toBe('VERIFIED');
  });
});
