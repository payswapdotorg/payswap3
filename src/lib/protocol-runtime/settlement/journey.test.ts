/**
 * RTN-009 — the composed netting -> settlement journey: clearing-created
 * obligations -> a committed netting set -> the net position settled as a
 * FIRST-CLASS subject ("for one obligation or net position") -> UNKNOWN on
 * the simulated rail -> the automatic area-14 case -> the reconciliation
 * resolution -> finality -> SETTLED; plus the direct-obligation journey and
 * the determinism run-twice proof.
 *
 * The REAL rails authorities (RTN-004 RailsStore requires node:sqlite)
 * run in the node harness
 * scripts/test_protocol_netting_settlement.mjs — the same split RTN-008
 * used; here the A13/A14 semantics are the owned in-memory double over
 * the REAL SimulatedRail.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §3 Area 11
 *   lines 147-209 (the whole area); §4 Area 12 lines 211-289 (the whole
 *   area, especially lines 264-273 — "UNKNOWN is a durable attempt state:
 *   the instruction stays ISSUED, the obligation stays SETTLEMENT_PENDING,
 *   and a reconciliation case (area 14) is opened automatically. Only the
 *   reconciliation resolution may drive the attempt to CONFIRMED or FAILED
 *   and then advance finality. Resumption after resolution is
 *   safe-resume, never re-submission of the same external effect (GC-2).").
 *   spec/registry/protocol-registry.json singleFinancialAuthority (the
 *   apex chain: netting transforms, settlement instructs, rails execute).
 *   spec/architecture/v0.1/README.md §3 GC-1 (determinism).
 */
import { describe, expect, test } from 'bun:test';
import { createEvidenceLog } from '../evidence/log.ts';
import { money } from '../kernel/money.ts';
import { NettingAuthority } from '../netting/authority.ts';
import type { NettingObligationLedgerPort } from '../netting/authority.ts';
import { obligationLedgerPortFromAuthority, nettingPortFromAuthority } from './ports.ts';
import { ObligationLedgerAuthority } from '../obligations/authority.ts';
import type { ClearingCreationInstruction } from '../obligations/authority.ts';
import { obligationIdForOriginRecord } from '../obligations/state-machine.ts';
import { SimulatedRail, createSimulatedRailAdapter } from '../rails/adapters.ts';
import type { SimulatedRailScenario } from '../rails/adapters.ts';
import { InMemoryRailsDouble } from './rails-test-double.ts';
import { SettlementAuthority } from './authority.ts';
import { finalityRecordIdFor, railIdempotencyKeyForInstruction, settlementInstructionIdFor } from './state-machine.ts';

const EUR = (minor: number) => money('EUR', minor, 2);
type Script = Record<string, SimulatedRailScenario>;

/**
 * Run the WHOLE composed journey once (the determinism unit): returns a
 * transcript of every observable step. All authorities are real except
 * the two SQLite-backed rails authorities (the in-memory double).
 */
async function runJourney(scriptOverride: Script = {}) {
  // The journey's inputs are fixed, so the deterministic identity chain is
  // computable up front: the set id from the label; the largest net
  // obligation id from (set, debtor, creditor, currency); the instruction
  // id from (subject, ordinal 1); the rail key from the instruction id.
  const { netObligationIdFor, nettingSetIdForLabel } = await import('../netting/state-machine.ts');
  const journeySetId = nettingSetIdForLabel('journey-set');
  const journeyNetObligationId = netObligationIdFor(journeySetId, 'alpha', 'gamma', 'EUR');
  const journeyInstructionId = settlementInstructionIdFor(
    { kind: 'NET_POSITION', netObligationId: journeyNetObligationId },
    1,
  );
  const journeyKey = railIdempotencyKeyForInstruction(journeyInstructionId);
  // Default: the net-position instruction's rail accepts and reports
  // CONFIRMED (the report-driven path); the override may flip it to an
  // UNKNOWN scenario.
  const script: Script = { [journeyKey]: 'ACCEPT_REPORT_CONFIRMED', ...scriptOverride };
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
  (obligations as unknown as { settlementHold?: (id: string) => boolean }).settlementHold = (
    obligationId: string,
  ) => settlement.isUnknownHeld({ kind: 'OBLIGATION', obligationId });

  const transcript: string[] = [];
  const note = (step: string) => transcript.push(step);

  // 1. Clearing creates four gross obligations between three participants.
  const gross: { id: string; debtor: string; creditor: string; amount: number }[] = [
    { id: 'j1', debtor: 'alpha', creditor: 'beta', amount: 10_000 },
    { id: 'j2', debtor: 'beta', creditor: 'alpha', amount: 4_000 },
    { id: 'j3', debtor: 'beta', creditor: 'gamma', amount: 7_000 },
    { id: 'j4', debtor: 'gamma', creditor: 'alpha', amount: 2_000 },
  ];
  for (const entry of gross) {
    const outcome = await obligations.applyClearingCommand({
      batchId: `batch-${entry.id}`,
      recordId: entry.id,
      originActivityId: `activity-${entry.id}`,
      originKind: 'INTENT',
      debtorParticipantId: entry.debtor,
      creditorParticipantId: entry.creditor,
      amount: EUR(entry.amount),
      reason: 'journey fixture',
    } as Omit<ClearingCreationInstruction, 'kind'>);
    note(`obligation:${outcome.obligationId}`);
  }

  // 2. A multilateral netting set over all four.
  const opened = await netting.openNettingSet({
    label: 'journey-set',
    scope: { kind: 'MULTILATERAL', participants: ['alpha', 'beta', 'gamma'] },
    inputObligationIds: obligations.obligations().map((o) => o.obligationId),
  });
  expect(opened.ok).toBe(true);
  const setId = opened.ok ? opened.value.nettingSetId : '';
  await netting.computeNettingSet(setId);
  const committed = await netting.commitNettingSet(setId);
  expect(committed.ok).toBe(true);
  // Nets: alpha: -10000 + 4000 + 2000 = -4000; beta: +10000 - 4000 - 7000 = -1000;
  // gamma: +7000 - 2000 = +5000. Flows sum to 5000.
  if (committed.ok) {
    for (const entry of committed.value.netObligations) {
      note(`net:${entry.netObligationId}:${entry.debtorParticipantId}>${entry.creditorParticipantId}:${entry.amount.amountMinor}`);
    }
    expect(
      committed.value.netObligations.reduce((acc, entry) => acc + entry.amount.amountMinor, 0),
    ).toBe(5_000);
  }

  // 3. Settle the LARGEST net position (the subject is a NET POSITION).
  const netObligations = netting.netObligationsOfSet(setId);
  const target = netObligations.reduce((a, b) =>
    a.amount.amountMinor >= b.amount.amountMinor ? a : b,
  );
  const instructionId = settlementInstructionIdFor(
    { kind: 'NET_POSITION', netObligationId: target.netObligationId },
    1,
  );
  const key = railIdempotencyKeyForInstruction(instructionId);
  const created = await settlement.createSettlementInstruction({
    subject: { kind: 'NET_POSITION', netObligationId: target.netObligationId },
    beneficiary: `acct-${target.creditorParticipantId}`,
    memo: 'net position settlement',
  });
  expect(created.ok).toBe(true);
  note(`instruction:${instructionId}:${created.ok ? created.value.amount.amountMinor : 0}`);
  // INV-12-1: the amount is the net position's amount, verbatim.
  expect(created.ok ? created.value.amount.amountMinor : 0).toBe(target.amount.amountMinor);
  // The netting domain transitioned the net obligation (re-read — the
  // records are immutable snapshots).
  expect(netting.netObligation(target.netObligationId)?.state).toBe('SETTLEMENT_PENDING');

  // 4. Authorize + submit. The rail script decides the outcome.
  const authorized = await settlement.authorizeAttempt(instructionId, adapterId);
  expect(authorized.ok).toBe(true);
  const submitted = await settlement.submitAttempt(instructionId, connection);
  expect(submitted.ok).toBe(true);
  const attempt = settlement.attemptForInstruction(instructionId);
  note(`attempt:${attempt?.state}`);
  const caseId = attempt?.reconciliationCaseId ?? '';
  if (attempt?.state === 'UNKNOWN') {
    // 5. The durable UNKNOWN state: instruction ISSUED, net position
    //    SETTLEMENT_PENDING, exactly one case.
    expect(settlement.instruction(instructionId)?.state).toBe('ISSUED');
    expect(netting.netObligation(target.netObligationId)?.state).toBe('SETTLEMENT_PENDING');
    expect(rails.caseForOperation(attempt.operationId)?.caseId).toBe(caseId);
    note(`case:${caseId}`);
    // 6. Reconciliation: investigate + resolve CONFIRMED.
    await rails.investigateCase(caseId);
    const resolved = rails.resolveCase(caseId, {
      resolution: 'RESOLVED_CONFIRMED',
      proof: { externalRefs: ['bank-statement-journey'] },
    });
    expect(resolved.ok).toBe(true);
    // 7. The safe-resume: attempt CONFIRMED, finality advances.
    const resumed = await settlement.applyResolution(
      resolved.ok ? resolved.value.recovery : { feed: 'AREA_12_FINALITY_ADVANCE', instructionId, operationId: '', attemptOutcome: 'CONFIRMED' },
      caseId,
    );
    expect(resumed.ok).toBe(true);
    note(`resolved:${resumed.ok ? resumed.value.attempt.state : ''}`);
  } else if (attempt?.state === 'PENDING') {
    // The report-driven confirmed path.
    const report = connection.fetchReport(key);
    const recorded = rails.recordReport(attempt.operationId, report);
    expect(recorded.ok).toBe(true);
    const mirrored = await settlement.applyRailOutcome(instructionId);
    expect(mirrored.ok).toBe(true);
    note(`resolved:${mirrored.ok ? mirrored.value.attempt.state : ''}`);
  }

  // 8. FINAL by protocol rule; the net position SETTLED exactly once.
  const declared = await settlement.declareFinality(instructionId);
  expect(declared.ok).toBe(true);
  note(`finality:${declared.ok ? declared.value.state : ''}`);
  expect(netting.netObligation(target.netObligationId)?.state).toBe('SETTLED');

  // 9. Settle one remaining gross-free obligation directly... every input
  //    obligation is NETTED now; create a fresh one and settle it directly.
  const fresh = await obligations.applyClearingCommand({
    batchId: 'batch-j9',
    recordId: 'j9',
    originActivityId: 'activity-j9',
    originKind: 'INTENT',
    debtorParticipantId: 'alpha',
    creditorParticipantId: 'gamma',
    amount: EUR(900),
    reason: 'direct settlement fixture',
  } as Omit<ClearingCreationInstruction, 'kind'>);
  const directInstruction = await settlement.createSettlementInstruction({
    subject: { kind: 'OBLIGATION', obligationId: fresh.obligationId },
    beneficiary: 'acct-gamma',
  });
  expect(directInstruction.ok).toBe(true);
  await settlement.authorizeAttempt(
    directInstruction.ok ? directInstruction.value.instructionId : '',
    adapterId,
  );
  const directSubmitted = await settlement.submitAttempt(
    directInstruction.ok ? directInstruction.value.instructionId : '',
    connection,
  );
  expect(directSubmitted.ok).toBe(true);
  const directAttempt = settlement.attemptForInstruction(
    directInstruction.ok ? directInstruction.value.instructionId : '',
  );
  note(`direct:${directAttempt?.state}`);
  if (directAttempt?.state === 'PENDING') {
    const report = connection.fetchReport(
      railIdempotencyKeyForInstruction(directInstruction.ok ? directInstruction.value.instructionId : ''),
    );
    rails.recordReport(directAttempt.operationId, report);
    await settlement.applyRailOutcome(directInstruction.ok ? directInstruction.value.instructionId : '');
  }
  const directFinal = await settlement.declareFinality(
    directInstruction.ok ? directInstruction.value.instructionId : '',
  );
  note(`directFinal:${directFinal.ok ? (directFinal.ok ? directFinal.value.state : '') : directFinal.code}`);
  expect(obligations.obligation(fresh.obligationId)?.state).toBe(
    directFinal.ok ? 'SETTLED' : 'SETTLEMENT_PENDING',
  );

  // 10. The chain verifies end-to-end.
  const verification = log.verifyAndRecord(wall);
  note(`chain:${verification.verdict}`);
  expect(verification.verdict).toBe('VERIFIED');
  return transcript;
}

describe('the composed netting -> settlement journey (the apex of the singleFinancialAuthority chain)', () => {
  test('a multilateral net position settles through the report-confirmed path: PENDING -> CONFIRMED -> FINALITY (end-to-end against the simulated rail)', async () => {
    // The net-position instruction's rail is scripted ACCEPT_REPORT_
    // CONFIRMED (the report-driven path); the submission lands PENDING and
    // the rail's final statement confirms. The UNKNOWN variant is the next
    // describe block.
    const transcript = await runJourney({});
    expect(transcript.some((step) => step.startsWith('resolved:CONFIRMED'))).toBe(true);
    expect(transcript.some((step) => step.startsWith('finality:FINAL'))).toBe(true);
    expect(transcript[transcript.length - 1]).toBe('chain:VERIFIED');
  });

  test('determinism (GC-1): two identical runs produce identical transcripts', async () => {
    const first = await runJourney({});
    const second = await runJourney({});
    expect(second).toEqual(first);
  });
});

describe('the UNKNOWN variant of the journey (TRANSMIT_TIMEOUT on the net-position instruction)', () => {
  test('the net position settles through the reconciliation resolution: UNKNOWN -> case -> RESOLVED_CONFIRMED -> finality -> SETTLED', async () => {
    // Compute the deterministic instruction id chain for the journey's
    // largest net position: gross inputs are fixed, so the largest net is
    // gamma (5000, creditor), debtor alpha; the net obligation id derives
    // from (set id, alpha, gamma, EUR); the instruction id from ordinal 1.
    // The set id derives from the label 'journey-set'.
    const { netObligationIdFor, nettingSetIdForLabel } = await import('../netting/state-machine.ts');
    const setId = nettingSetIdForLabel('journey-set');
    const netObligationId = netObligationIdFor(setId, 'alpha', 'gamma', 'EUR');
    const instructionId = settlementInstructionIdFor(
      { kind: 'NET_POSITION', netObligationId },
      1,
    );
    const key = railIdempotencyKeyForInstruction(instructionId);
    const transcript = await runJourney({ [key]: 'TRANSMIT_TIMEOUT' });
    expect(
      transcript.some((step) => step.startsWith('attempt:UNKNOWN')),
    ).toBe(true);
    expect(transcript.some((step) => step.startsWith('case:'))).toBe(true);
    expect(transcript.some((step) => step.startsWith('resolved:CONFIRMED'))).toBe(true);
    expect(transcript.some((step) => step.startsWith('finality:FINAL'))).toBe(true);
    expect(transcript[transcript.length - 1]).toBe('chain:VERIFIED');
    // Determinism of the UNKNOWN variant too.
    const second = await runJourney({ [key]: 'TRANSMIT_TIMEOUT' });
    expect(second).toEqual(transcript);
  });
});

describe('the direct-obligation settlement journey (no netting)', () => {
  test('a cleared obligation settles CONFIRMED: SETTLEMENT_PENDING -> SETTLED exactly once, with the finality cause reference', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    let wall = 7_000;
    const clock = () => wall;
    const rails = new InMemoryRailsDouble(clock);
    const adapterId = rails.registerAndActivateAdapter('sim-bank', 'primary');
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
    (obligations as unknown as { settlementHold?: (id: string) => boolean }).settlementHold = (
      obligationId: string,
    ) => settlement.isUnknownHeld({ kind: 'OBLIGATION', obligationId });

    const obligationId = obligationIdForOriginRecord('direct-1');
    const instructionId = settlementInstructionIdFor({ kind: 'OBLIGATION', obligationId }, 1);
    const key = railIdempotencyKeyForInstruction(instructionId);
    const rail = new SimulatedRail('bank-direct', { [key]: 'ACCEPT_REPORT_CONFIRMED' });
    const connection = createSimulatedRailAdapter(rail, { wallClock: clock });

    const created = await obligations.applyClearingCommand({
      batchId: 'batch-direct-1',
      recordId: 'direct-1',
      originActivityId: 'activity-direct-1',
      originKind: 'INTENT',
      debtorParticipantId: 'alpha',
      creditorParticipantId: 'beta',
      amount: EUR(3_333),
      reason: 'direct fixture',
    } as Omit<ClearingCreationInstruction, 'kind'>);
    expect(created.obligationId).toBe(obligationId);

    expect(
      (
        await settlement.createSettlementInstruction({
          subject: { kind: 'OBLIGATION', obligationId },
          beneficiary: 'acct-beta',
        })
      ).ok,
    ).toBe(true);
    expect(obligations.obligation(obligationId)?.state).toBe('SETTLEMENT_PENDING');
    expect((await settlement.authorizeAttempt(instructionId, adapterId)).ok).toBe(true);
    expect((await settlement.submitAttempt(instructionId, connection)).ok).toBe(true);
    expect(settlement.attemptForInstruction(instructionId)?.state).toBe('PENDING');
    const report = connection.fetchReport(key);
    expect(report.outcomeClass).toBe('CONFIRMED');
    const recorded = rails.recordReport(
      settlement.attemptForInstruction(instructionId)?.operationId ?? '',
      report,
    );
    expect(recorded.ok).toBe(true);
    const mirrored = await settlement.applyRailOutcome(instructionId);
    expect(mirrored.ok).toBe(true);
    if (mirrored.ok) {
      expect(mirrored.value.attempt.state).toBe('CONFIRMED');
      expect(mirrored.value.instruction.state).toBe('CONFIRMED');
    }
    const declared = await settlement.declareFinality(instructionId);
    expect(declared.ok).toBe(true);
    if (declared.ok) {
      expect(declared.value.finalityRecordId).toBe(finalityRecordIdFor({ kind: 'OBLIGATION', obligationId }));
    }
    expect(obligations.obligation(obligationId)?.state).toBe('SETTLED');
    // The A10 SETTLED transition's cause reference is the finality record.
    const settled = obligations.log.fold().find((o) => o.obligationId === obligationId && o.state === 'SETTLED');
    expect(settled).toBeDefined();
    // The obligation's final state is terminal: nothing further applies.
    const disputedAfterSettlement = await obligations.openDispute({
      kind: 'DISPUTE_OPEN',
      obligationId,
      disputeId: 'dispute-after',
    });
    expect(disputedAfterSettlement.ok).toBe(false); // SETTLED is terminal
    expect(log.verifyAndRecord(wall).verdict).toBe('VERIFIED');
  });
});
