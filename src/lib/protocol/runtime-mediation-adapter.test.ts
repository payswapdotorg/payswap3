/**
 * UI-011 — RUNTIME MEDIATION ADAPTER product suite (bun).
 *
 * Proves the mediation port's honest runtime re-anchoring: dispute
 * initiation submits obligations.dispute.open through the protocol gateway
 * (hosted — executed on the durable path), dispute reads derive from the
 * A10 obligation records + the real A15 chain, and the area-19/21
 * surfaces (proposals, mediation cases, their commands) present
 * unavailable/denied with the recorded gap — never fabricated.
 */

import { describe, expect, test } from 'bun:test';
import { composeProductTestRuntime, type ProductTestComposition } from './product-adapter-test-compose';
import { createRuntimeMediationAdapter } from './runtime-mediation-adapter';
import { getMediationPort, registerMediationPortBacking } from './mediation-port';
import type { MediationPort } from './mediation-port';
import { clearingBatchId } from '../protocol-runtime/clearing/summation.ts';
import { money } from '../protocol-runtime/kernel/money.ts';

// Top-level awaited setup (bun's ESM test runtime; the ambient bun:test
// declaration exposes describe/test/expect only — no lifecycle hooks).
const composition = await composeProductTestRuntime();
const port: MediationPort = createRuntimeMediationAdapter(composition.handle);
registerMediationPortBacking(port);

const ORIGIN_ACTIVITY = 'activity-mediation-suite';

const setup = await (async () => {

  // Create an obligation through the clearing path: batch open (gateway,
  // hosted) → record add (the A09 command surface — the D-2 un-hosted
  // precedent) → stage + commit (gateway, hosted) → the A10 sink creates
  // the obligation.
  const opened = await composition.submit(
    'clearing.batch.open',
    'Clearing Authority',
    { batchLabel: 'batch-mediation-suite' },
    'open-batch-mediation',
  );
  expect(opened.ok).toBe(true);
  // The clearing authority names batches DETERMINISTICALLY (the summation
  // module's own derivation — the composed-journey precedent), so the batch
  // id is derivable from the label; verify it against the authority's read.
  const batchIdLocal = clearingBatchId('batch-mediation-suite');
  expect(composition.clearing.batch(batchIdLocal)).toBeDefined();

  const added = await composition.clearing.addRecord(batchIdLocal, {
    origin: { originActivityId: ORIGIN_ACTIVITY, originKind: 'INTENT' },
    parties: { debtorParticipantId: 'participant-customer', creditorParticipantId: 'participant-merchant' },
    amount: money('USD', 1_000_00, 2),
    reason: 'settlement-of-intent',
  });
  expect(added.ok).toBe(true);

  const staged = await composition.submit('clearing.batch.stage', 'Clearing Authority', { batchId: batchIdLocal }, 'stage-mediation', [batchIdLocal]);
  expect(staged.ok).toBe(true);
  const committed = await composition.submit('clearing.batch.commit', 'Clearing Authority', { batchId: batchIdLocal }, 'commit-mediation', [batchIdLocal]);
  expect(committed.ok).toBe(true);

  const obligation = composition.handle.authorities.obligations
    .obligations()
    .find((record) => record.origin.kind === 'CLEARING' && record.origin.originActivityId === ORIGIN_ACTIVITY);
  expect(obligation).toBeDefined();
  return {
    batchId: batchIdLocal,
    obligationId: obligation?.obligationId ?? '',
  };
})();
const batchId = setup.batchId;
const obligationReference = setup.obligationId;

describe('UI-011 runtime mediation adapter — the wave-2 gaps are denied, never fabricated', () => {
  test('the party docket reports the runtime\u2019s real sets (no proposals/mediations; disputes from A10)', async () => {
    const result = await port.getPartyDocket('customer');
    expect(result.kind).toBe('fetched');
    if (result.kind === 'fetched') {
      expect(result.record.proposals.length).toBe(0);
      expect(result.record.mediations.length).toBe(0);
      expect(result.record.disputes.length).toBe(0);
      expect(result.record.disputableIntents.length).toBe(1);
      expect(result.record.disputableIntents[0]?.reference).toBe(ORIGIN_ACTIVITY);
    }
  });

  test('a proposal fetch presents unavailable with the recorded area-19 gap', async () => {
    const result = await port.getProposal({ proposalId: 'prop-1', viewer: 'customer' });
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') {
      expect(result.detail).toContain('area 19');
      expect(result.detail).toContain('RTN wave 2');
    }
  });

  test('a mediation-case fetch presents unavailable the same honest way', async () => {
    const result = await port.getMediationCase({ caseId: 'case-1', viewer: 'merchant' });
    expect(result.kind).toBe('unavailable');
  });

  test('proposal decisions and mediation actions are denied with the recorded gap', async () => {
    const decision = await port.submitProposalDecision({
      proposalId: 'prop-1',
      decision: 'accept',
      actor: 'customer',
    });
    expect(decision.kind).toBe('denied');
    if (decision.kind === 'denied') {
      expect(decision.reason).toContain('area 19');
    }
    const action = await port.submitMediationAction({
      caseId: 'case-1',
      action: 'submit-statement',
      actor: 'merchant',
      statement: 'statement',
    });
    expect(action.kind).toBe('denied');
  });

  test('the harness script surface reports honestly that no authority-state scripting exists', async () => {
    const result = await port.applyHarnessScript({ type: 'reset' });
    expect(result.applied).toBe('no');
    expect(result.note).toContain('no authority-state scripting');
  });

  test('the dispute-initiation briefing is worded from the A10 dispute primitive', async () => {
    const briefing = await port.getDisputeInitiationBriefing();
    expect(briefing.authority).toContain('obligations.dispute.open');
    expect(briefing.grounds.length).toBe(5);
    expect(briefing.consequences.some((line) => line.includes('DISPUTED'))).toBe(true);
  });
});

describe('UI-011 runtime mediation adapter — dispute initiation round-trips through the gateway', () => {
  test('a reference with no obligation is denied honestly (nothing recorded)', async () => {
    const result = await port.initiateDispute({
      intentReference: 'activity-never-cleared',
      grounds: ['goods-not-received'],
      accountOfWhatHappened: 'The goods never arrived.',
      evidence: [],
      actor: 'customer',
    });
    expect(result.kind).toBe('denied');
    if (result.kind === 'denied') {
      expect(result.reason).toContain('NOT initiated');
    }
  });

  test('the initiation matrix authorizes the disputing parties against the recorded obligation', async () => {
    const rows = await port.describeDisputeInitiationMatrix({ intentReference: ORIGIN_ACTIVITY });
    expect(rows.length).toBe(5);
    const customer = rows.find((row) => row.role === 'customer');
    const operator = rows.find((row) => row.role === 'operator');
    expect(customer?.authorized).toBe(true);
    expect(operator?.authorized).toBe(false);
  });

  test('initiating the dispute admits obligations.dispute.open, terminalizes the obligation, and records the A15 evidence', async () => {
    const result = await port.initiateDispute({
      intentReference: ORIGIN_ACTIVITY,
      grounds: ['goods-not-received'],
      accountOfWhatHappened: 'The goods never arrived.',
      evidence: [],
      actor: 'customer',
    });
    expect(result.kind).toBe('initiated');
    if (result.kind === 'initiated') {
      expect(result.record.authorityState).toBe('open');
      expect(result.record.intentReference).toBe(ORIGIN_ACTIVITY);
      expect(result.record.recourseTrail[0]?.authority).toContain('Obligation Authority (A10)');
    }
    // The obligation is terminalized into DISPUTED (the A10 primitive).
    expect(composition.handle.authorities.obligations.obligation(obligationReference)?.state).toBe('DISPUTED');
    // The DISPUTE_OPEN transition is recorded in the A15 chain.
    const disputeOpenEvidence = composition.handle.evidenceLog
      .records()
      .some((record) => record.outcome.reasonCode === 'DISPUTE_OPEN');
    expect(disputeOpenEvidence).toBe(true);
  });

  test('the dispute reads back by its id with its recourse trail', async () => {
    const docket = await port.getPartyDocket('customer');
    expect(docket.kind).toBe('fetched');
    if (docket.kind !== 'fetched') return;
    const dispute = docket.record.disputes[0];
    expect(dispute).toBeDefined();
    const fetched = await port.getDispute({ disputeId: dispute?.id ?? '', viewer: 'customer' });
    expect(fetched.kind).toBe('fetched');
    if (fetched.kind === 'fetched') {
      expect(fetched.record.authorityState).toBe('open');
      expect(fetched.record.accountOfWhatHappened).toContain('A15');
    }
  });

  test('re-disputing the terminalized obligation is denied per the frozen one-way table', async () => {
    const result = await port.initiateDispute({
      intentReference: ORIGIN_ACTIVITY,
      grounds: ['goods-not-as-described'],
      accountOfWhatHappened: 'Second attempt.',
      evidence: [],
      actor: 'customer',
    });
    expect(result.kind).toBe('denied');
    if (result.kind === 'denied') {
      expect(result.reason).toContain('DISPUTED');
    }
  });
});
