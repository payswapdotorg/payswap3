/**
 * RTN-009 — Settlement and Finality Authority: the command surface — the
 * instruction/attempt/finality lifecycles, the INV-12-1 verbatim-amount and
 * payload-hash discipline, the INV-12-2 single-attempt negative tests, the
 * INV-12-4 finality exclusivity and irreversibility, and the UNKNOWN
 * durable-state semantics — against the in-memory A13/A14 double over the
 * REAL SimulatedRail (the real-authority composition runs in the node
 * harness; the same split RTN-008 used for the rails composition).
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §4 Area 12:
 *     lines 224-240 (the objects and machines), lines 247-262 (the four
 *     invariants — verbatim), lines 264-273 (the failure and UNKNOWN
 *     semantics — verbatim).
 *   spec/architecture/v0.1/rails-adapters-reconciliation.md §1 Area 13
 *   lines 33-46, 70-72; §2 Area 14 lines 149-157, 171-179.
 *   spec/architecture/v0.1/README.md §3 GC-2/GC-3/GC-5.
 */
import { describe, expect, test } from 'bun:test';
import { createEvidenceLog } from '../evidence/log.ts';
import { money } from '../kernel/money.ts';
import { NettingAuthority } from '../netting/authority.ts';
import type { NettingObligationLedgerPort } from '../netting/authority.ts';
import type { SettlementNettingPort } from './ports.ts';
import { obligationLedgerPortFromAuthority, nettingPortFromAuthority } from './ports.ts';
import { ObligationLedgerAuthority } from '../obligations/authority.ts';
import type { ClearingCreationInstruction } from '../obligations/authority.ts';
import { SimulatedRail, createSimulatedRailAdapter } from '../rails/adapters.ts';
import type { SimulatedRailScenario } from '../rails/adapters.ts';
import { obligationIdForOriginRecord } from '../obligations/state-machine.ts';
import { InMemoryRailsDouble } from './rails-test-double.ts';
import { SettlementAuthority } from './authority.ts';
import {
  railIdempotencyKeyForInstruction,
  settlementInstructionIdFor,
} from './state-machine.ts';

const EUR = (minor: number) => money('EUR', minor, 2);

type Script = Record<string, SimulatedRailScenario>;

/**
 * The composed harness: the REAL obligations ledger (RTN-008), the REAL
 * netting authority (RTN-009 netting), the REAL settlement authority, the
 * REAL evidence log, and the A13/A14 double over the REAL SimulatedRail.
 * The obligations ledger's settlementHold probe is wired to the
 * settlement authority's UNKNOWN-hold query (the composition root's
 * wiring).
 */
function makeHarness(script: Script = {}) {
  const log = createEvidenceLog({ wallMs: 1_000 });
  let wall = 5_000;
  const clock = () => wall;
  const rails = new InMemoryRailsDouble(clock);
  const adapterId = rails.registerAndActivateAdapter('sim-bank', 'primary');
  const rail = new SimulatedRail('bank-1', script);
  const connection = createSimulatedRailAdapter(rail, { wallClock: clock });
  // The obligations ledger with the settlementHold probe wired to the
  // settlement authority (the composition root's wiring).
  const obligations = new ObligationLedgerAuthority({
    evidence: log,
    wallClock: clock,
    settlementHold: () => false, // replaced below once settlement exists
  });
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
  // Wire the hold probe now that settlement exists (the closure re-reads).
  (obligations as unknown as { settlementHold?: (id: string) => boolean }).settlementHold = (
    obligationId: string,
  ) => settlement.isUnknownHeld({ kind: 'OBLIGATION', obligationId });
  return {
    log,
    rails,
    rail,
    connection,
    adapterId,
    obligations,
    netting,
    settlement,
    advance: (ms: number) => {
      wall += ms;
    },
    wall: () => wall,
  };
}

async function createObligation(
  obligations: ObligationLedgerAuthority,
  recordId: string,
  debtor: string,
  creditor: string,
  amountMinor: number,
): Promise<string> {
  const outcome = await obligations.applyClearingCommand({
    batchId: `batch-${recordId}`,
    recordId,
    originActivityId: `activity-${recordId}`,
    originKind: 'INTENT',
    debtorParticipantId: debtor,
    creditorParticipantId: creditor,
    amount: EUR(amountMinor),
    reason: 'settlement test fixture',
  } as Omit<ClearingCreationInstruction, 'kind'>);
  return outcome.obligationId;
}

/** Commit one bilateral netting set and return its single net obligation id. */
async function netBilateral(
  harness: ReturnType<typeof makeHarness>,
  label: string,
  o1: string,
  o2: string,
): Promise<string> {
  const opened = await harness.netting.openNettingSet({
    label,
    scope: { kind: 'BILATERAL', participants: ['x-participant', 'y-participant'] },
    inputObligationIds: [o1, o2],
  });
  expect(opened.ok).toBe(true);
  const setId = opened.ok ? opened.value.nettingSetId : '';
  await harness.netting.computeNettingSet(setId);
  const committed = await harness.netting.commitNettingSet(setId);
  expect(committed.ok).toBe(true);
  return committed.ok ? (committed.value.netObligations[0]?.netObligationId ?? '') : '';
}

describe('createSettlementInstruction (INV-12-1 + the subject gates)', () => {
  test('the amount is copied VERBATIM from the obligation; the subject advances to SETTLEMENT_PENDING', async () => {
    const harness = makeHarness();
    const o1 = await createObligation(harness.obligations, 'i1', 'x-participant', 'y-participant', 12_345);
    const created = await harness.settlement.createSettlementInstruction({
      subject: { kind: 'OBLIGATION', obligationId: o1 },
      beneficiary: 'acct-y',
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value.state).toBe('CREATED');
      expect(created.value.amount.amountMinor).toBe(12_345);
      expect(created.value.amount.currency).toBe('EUR');
      expect(created.value.amount.scale).toBe(2);
      expect(created.value.payloadHash).toBeDefined();
      expect(created.value.subjectOrdinal).toBe(1);
    }
    expect(harness.obligations.obligation(o1)?.state).toBe('SETTLEMENT_PENDING');
  });

  test('a nonexistent subject is the typed refusal; an already-settled subject is refused', async () => {
    const harness = makeHarness();
    const missing = await harness.settlement.createSettlementInstruction({
      subject: { kind: 'OBLIGATION', obligationId: 'pid.v1.missing' },
      beneficiary: 'acct',
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe('SUBJECT_NOT_FOUND');
    }
    const netMissing = await harness.settlement.createSettlementInstruction({
      subject: { kind: 'NET_POSITION', netObligationId: 'pid.v1.missing' },
      beneficiary: 'acct',
    });
    expect(netMissing.ok).toBe(false);
    if (!netMissing.ok) {
      expect(netMissing.code).toBe('NET_OBLIGATION_NOT_FOUND');
    }
    // A disputed obligation is not settleable.
    const o1 = await createObligation(harness.obligations, 'i2', 'x-participant', 'y-participant', 500);
    await harness.obligations.openDispute({
      kind: 'DISPUTE_OPEN',
      obligationId: o1,
      disputeId: 'dispute-i2',
    });
    const disputed = await harness.settlement.createSettlementInstruction({
      subject: { kind: 'OBLIGATION', obligationId: o1 },
      beneficiary: 'acct',
    });
    expect(disputed.ok).toBe(false);
    if (!disputed.ok) {
      expect(disputed.code).toBe('SUBJECT_NOT_SETTLEABLE');
    }
  });

  test('at most one LIVE instruction per subject: a second is refused until the first is terminal', async () => {
    const harness = makeHarness();
    const o1 = await createObligation(harness.obligations, 'i3', 'x-participant', 'y-participant', 800);
    const first = await harness.settlement.createSettlementInstruction({
      subject: { kind: 'OBLIGATION', obligationId: o1 },
      beneficiary: 'acct',
    });
    expect(first.ok).toBe(true);
    const second = await harness.settlement.createSettlementInstruction({
      subject: { kind: 'OBLIGATION', obligationId: o1 },
      beneficiary: 'acct',
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe('LIVE_INSTRUCTION_EXISTS');
    }
  });
});

describe('authorizeAttempt + submitAttempt (INV-12-2 / INV-12-3)', () => {
  test('the happy path: authorization derives the key and creates the rail operation; ISSUED means a rail operation exists; the accepted submission lands PENDING', async () => {
    const harness = makeHarness();
    const o1 = await createObligation(harness.obligations, 'a1', 'x-participant', 'y-participant', 900);
    const created = await harness.settlement.createSettlementInstruction({
      subject: { kind: 'OBLIGATION', obligationId: o1 },
      beneficiary: 'acct-y',
    });
    const instructionId = created.ok ? created.value.instructionId : '';
    const authorized = await harness.settlement.authorizeAttempt(instructionId, harness.adapterId);
    expect(authorized.ok).toBe(true);
    if (authorized.ok) {
      expect(authorized.value.state).toBe('CREATED');
      // INV-12-3: the deterministic key, derived from the instruction id.
      expect(authorized.value.idempotencyKey).toBe(railIdempotencyKeyForInstruction(instructionId));
      expect(authorized.value.operationId).toBeDefined();
      // The rail operation exists (AUTHORIZED) — the instruction is ISSUED.
      expect(harness.rails.getOperation(authorized.value.operationId)?.status).toBe('AUTHORIZED');
    }
    expect(harness.settlement.instruction(instructionId)?.state).toBe('ISSUED');
    const submitted = await harness.settlement.submitAttempt(instructionId, harness.connection);
    expect(submitted.ok).toBe(true);
    if (submitted.ok) {
      expect(submitted.value.attempt.state).toBe('PENDING');
      expect(submitted.value.instruction.state).toBe('ISSUED');
      // The adapter received the deterministic idempotency key.
      expect(harness.rail.receivedKeys()).toEqual([
        railIdempotencyKeyForInstruction(instructionId),
      ]);
    }
    expect(harness.obligations.obligation(o1)?.state).toBe('SETTLEMENT_PENDING');
  });

  test('the INV-12-2 single-attempt NEGATIVE tests: a second authorization is rejected while the first is live (CREATED, PENDING, and UNKNOWN)', async () => {
    // (a) while CREATED (authorized, not yet submitted)
    {
      const harness = makeHarness();
      const o1 = await createObligation(harness.obligations, 'n1', 'x-participant', 'y-participant', 100);
      const created = await harness.settlement.createSettlementInstruction({
        subject: { kind: 'OBLIGATION', obligationId: o1 },
        beneficiary: 'acct',
      });
      const instructionId = created.ok ? created.value.instructionId : '';
      expect((await harness.settlement.authorizeAttempt(instructionId, harness.adapterId)).ok).toBe(true);
      const second = await harness.settlement.authorizeAttempt(instructionId, harness.adapterId);
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.code).toBe('LIVE_ATTEMPT_EXISTS');
      }
    }
    // (b) while PENDING (submitted, rail accepted, outcome not yet final)
    {
      const harness = makeHarness();
      const o1 = await createObligation(harness.obligations, 'n2', 'x-participant', 'y-participant', 100);
      const created = await harness.settlement.createSettlementInstruction({
        subject: { kind: 'OBLIGATION', obligationId: o1 },
        beneficiary: 'acct',
      });
      const instructionId = created.ok ? created.value.instructionId : '';
      await harness.settlement.authorizeAttempt(instructionId, harness.adapterId);
      await harness.settlement.submitAttempt(instructionId, harness.connection);
      const second = await harness.settlement.authorizeAttempt(instructionId, harness.adapterId);
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.code).toBe('LIVE_ATTEMPT_EXISTS');
      }
      // Re-submission of the same external effect is refused too.
      const resubmitted = await harness.settlement.submitAttempt(instructionId, harness.connection);
      expect(resubmitted.ok).toBe(false);
      if (!resubmitted.ok) {
        expect(resubmitted.code).toBe('LIVE_ATTEMPT_EXISTS');
      }
    }
    // (c) while UNKNOWN (the durable state — the hardest single-attempt case)
    {
      const harness = makeHarness();
      const o1 = await createObligation(harness.obligations, 'n3', 'x-participant', 'y-participant', 100);
      const created = await harness.settlement.createSettlementInstruction({
        subject: { kind: 'OBLIGATION', obligationId: o1 },
        beneficiary: 'acct',
      });
      const instructionId = created.ok ? created.value.instructionId : '';
      const key = railIdempotencyKeyForInstruction(instructionId);
      const script: Script = { [key]: 'TRANSMIT_TIMEOUT' };
      const rail = new SimulatedRail('bank-timeout', script);
      const connection = createSimulatedRailAdapter(rail);
      await harness.settlement.authorizeAttempt(instructionId, harness.adapterId);
      const submitted = await harness.settlement.submitAttempt(instructionId, connection);
      expect(submitted.ok).toBe(true);
      if (submitted.ok) {
        expect(submitted.value.attempt.state).toBe('UNKNOWN');
      }
      // THE negative: no second attempt while the first is UNKNOWN.
      const second = await harness.settlement.authorizeAttempt(instructionId, harness.adapterId);
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.code).toBe('LIVE_ATTEMPT_EXISTS');
      }
    }
  });

  test('a rail rejection at submission: the attempt and the instruction FAIL; recovery is possible with a NEW instruction and a NEW idempotency key', async () => {
    const harness = makeHarness();
    const o1 = await createObligation(harness.obligations, 'r1', 'x-participant', 'y-participant', 700);
    const created = await harness.settlement.createSettlementInstruction({
      subject: { kind: 'OBLIGATION', obligationId: o1 },
      beneficiary: 'acct',
    });
    const instructionId = created.ok ? created.value.instructionId : '';
    const key = railIdempotencyKeyForInstruction(instructionId);
    const rail = new SimulatedRail('bank-reject', { [key]: 'REJECT_AT_SUBMISSION' });
    const connection = createSimulatedRailAdapter(rail);
    await harness.settlement.authorizeAttempt(instructionId, harness.adapterId);
    const submitted = await harness.settlement.submitAttempt(instructionId, connection);
    expect(submitted.ok).toBe(true);
    if (submitted.ok) {
      expect(submitted.value.attempt.state).toBe('FAILED');
      expect(submitted.value.instruction.state).toBe('FAILED');
    }
    // The subject stays SETTLEMENT_PENDING (recovery is a new instruction).
    expect(harness.obligations.obligation(o1)?.state).toBe('SETTLEMENT_PENDING');
    // Recovery: a NEW instruction (ordinal 2 -> a new id -> a new key).
    const recovery = await harness.settlement.createSettlementInstruction({
      subject: { kind: 'OBLIGATION', obligationId: o1 },
      beneficiary: 'acct',
    });
    expect(recovery.ok).toBe(true);
    if (recovery.ok) {
      expect(recovery.value.subjectOrdinal).toBe(2);
      expect(recovery.value.instructionId).not.toBe(instructionId);
      const recoveryKey = railIdempotencyKeyForInstruction(recovery.value.instructionId);
      expect(recoveryKey).not.toBe(key);
    }
  });
});

describe('the confirmed path and INV-12-4 finality', () => {
  test('a rail-confirmed report: PROVISIONAL finality, then FINAL by protocol rule advances the obligation to SETTLED exactly once', async () => {
    // Precompute the deterministic identity chain (obligation id from the
    // origin record id; instruction id from the subject + ordinal 1; the
    // rail idempotency key from the instruction id) so the rail can be
    // scripted BEFORE the journey starts.
    const obligationId = obligationIdForOriginRecord('c1');
    const instructionId = settlementInstructionIdFor(
      { kind: 'OBLIGATION', obligationId },
      1,
    );
    const key = railIdempotencyKeyForInstruction(instructionId);
    const harness = makeHarness({ [key]: 'ACCEPT_REPORT_CONFIRMED' });
    const o1 = await createObligation(harness.obligations, 'c1', 'x-participant', 'y-participant', 1_500);
    expect(o1).toBe(obligationId); // the derivation holds end-to-end
    const created = await harness.settlement.createSettlementInstruction({
      subject: { kind: 'OBLIGATION', obligationId: o1 },
      beneficiary: 'acct-y',
    });
    expect(created.ok ? created.value.instructionId : '').toBe(instructionId);
    await harness.settlement.authorizeAttempt(instructionId, harness.adapterId);
    const submitted = await harness.settlement.submitAttempt(instructionId, harness.connection);
    expect(submitted.ok).toBe(true);
    if (submitted.ok) {
      expect(submitted.value.attempt.state).toBe('PENDING'); // accepted, outcome not yet known
    }
    // The rail's final statement says CONFIRMED: the composition root
    // fetches the report and records it through the A13 interface.
    const report = harness.connection.fetchReport(key);
    expect(report.outcomeClass).toBe('CONFIRMED');
    const recorded = harness.rails.recordReport(
      harness.settlement.attemptForInstruction(instructionId)?.operationId ?? '',
      report,
    );
    expect(recorded.ok).toBe(true);
    const mirrored = await harness.settlement.applyRailOutcome(instructionId);
    expect(mirrored.ok).toBe(true);
    if (mirrored.ok) {
      expect(mirrored.value.attempt.state).toBe('CONFIRMED');
      expect(mirrored.value.instruction.state).toBe('CONFIRMED');
    }
    // PROVISIONAL finality exists for the subject.
    const finality = harness.settlement.finalityForSubject({ kind: 'OBLIGATION', obligationId: o1 });
    expect(finality?.state).toBe('PROVISIONAL');
    expect(finality?.ruleReference).toBe('RAIL_CONFIRMATION_SEMANTICS');
    // FINAL is declared by protocol rule only.
    const declared = await harness.settlement.declareFinality(instructionId);
    expect(declared.ok).toBe(true);
    if (declared.ok) {
      expect(declared.value.state).toBe('FINAL');
    }
    expect(harness.obligations.obligation(o1)?.state).toBe('SETTLED');
    // Exactly once: a second declaration is the typed refusal, and the
    // obligation stays SETTLED.
    const again = await harness.settlement.declareFinality(instructionId);
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.code).toBe('FINALITY_ALREADY_DECLARED');
    }
    expect(harness.settlement.finalityForSubject({ kind: 'OBLIGATION', obligationId: o1 })?.state).toBe('FINAL');
    expect(harness.obligations.obligation(o1)?.state).toBe('SETTLED');
    // A settled subject accepts no new instruction.
    const restarted = await harness.settlement.createSettlementInstruction({
      subject: { kind: 'OBLIGATION', obligationId: o1 },
      beneficiary: 'acct',
    });
    expect(restarted.ok).toBe(false);
    if (!restarted.ok) {
      expect(restarted.code).toBe('SUBJECT_ALREADY_SETTLED');
    }
  });

  test('declareFinality refuses before PROVISIONAL (no confirmed attempt) and while the attempt is UNKNOWN (GC-2)', async () => {
    const harness = makeHarness();
    const o1 = await createObligation(harness.obligations, 'c2', 'x-participant', 'y-participant', 300);
    const created = await harness.settlement.createSettlementInstruction({
      subject: { kind: 'OBLIGATION', obligationId: o1 },
      beneficiary: 'acct',
    });
    const instructionId = created.ok ? created.value.instructionId : '';
    await harness.settlement.authorizeAttempt(instructionId, harness.adapterId);
    // No confirmed attempt yet: NOT_PROVISIONAL.
    const early = await harness.settlement.declareFinality(instructionId);
    expect(early.ok).toBe(false);
    if (!early.ok) {
      expect(early.code).toBe('NOT_PROVISIONAL');
    }
  });
});

describe('the UNKNOWN durable state (lines 264-273)', () => {
  test('UNKNOWN: the instruction STAYS ISSUED, the obligation STAYS SETTLEMENT_PENDING, exactly one case opens automatically, and finality is blocked until resolution', async () => {
    const harness = makeHarness();
    const o1 = await createObligation(harness.obligations, 'u1', 'x-participant', 'y-participant', 2_000);
    const created = await harness.settlement.createSettlementInstruction({
      subject: { kind: 'OBLIGATION', obligationId: o1 },
      beneficiary: 'acct-y',
    });
    const instructionId = created.ok ? created.value.instructionId : '';
    const key = railIdempotencyKeyForInstruction(instructionId);
    const rail = new SimulatedRail('bank-unknown', { [key]: 'TRANSMIT_CONNECTION_LOSS' });
    const connection = createSimulatedRailAdapter(rail);
    await harness.settlement.authorizeAttempt(instructionId, harness.adapterId);
    const submitted = await harness.settlement.submitAttempt(instructionId, connection);
    expect(submitted.ok).toBe(true);
    if (submitted.ok) {
      expect(submitted.value.attempt.state).toBe('UNKNOWN');
      // Exactly one case, automatically (INV-14-1).
      expect(submitted.value.caseId).toBeDefined();
      const caseId = submitted.value.caseId ?? '';
      const caseRecord = harness.rails.caseForOperation(
        harness.settlement.attemptForInstruction(instructionId)?.operationId ?? '',
      );
      expect(caseRecord?.caseId).toBe(caseId);
      expect(caseRecord?.status).toBe('OPEN');
    }
    // The durable-state assertions, verbatim.
    expect(harness.settlement.instruction(instructionId)?.state).toBe('ISSUED');
    expect(harness.obligations.obligation(o1)?.state).toBe('SETTLEMENT_PENDING');
    expect(harness.settlement.isUnknownHeld({ kind: 'OBLIGATION', obligationId: o1 })).toBe(true);
    // Finality is blocked (GC-2) — both in the settlement domain ...
    const blocked = await harness.settlement.declareFinality(instructionId);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe('UNKNOWN_HELD');
    }
    // ... and in the A10 ledger (the wired settlementHold probe).
    const refused = await harness.obligations.applySettlementFinality({
      kind: 'SETTLEMENT_FINALITY',
      obligationId: o1,
      finalityRecordId: 'pid.v1.finality',
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe('UNKNOWN_HELD');
    }
    // applyRailOutcome refuses to move an UNKNOWN attempt (GC-2: only
    // the reconciliation resolution does).
    const mirror = await harness.settlement.applyRailOutcome(instructionId);
    expect(mirror.ok).toBe(false);
    if (!mirror.ok) {
      expect(mirror.code).toBe('RECOVERY_NOT_APPLICABLE');
    }
  });

  test('RESOLVED_CONFIRMED -> attempt CONFIRMED -> finality advances -> SETTLED (the safe-resume end-to-end)', async () => {
    const harness = makeHarness();
    const o1 = await createObligation(harness.obligations, 'u2', 'x-participant', 'y-participant', 2_400);
    const created = await harness.settlement.createSettlementInstruction({
      subject: { kind: 'OBLIGATION', obligationId: o1 },
      beneficiary: 'acct-y',
    });
    const instructionId = created.ok ? created.value.instructionId : '';
    const key = railIdempotencyKeyForInstruction(instructionId);
    const rail = new SimulatedRail('bank-unknown-2', { [key]: 'TRANSMIT_TIMEOUT' });
    const connection = createSimulatedRailAdapter(rail);
    await harness.settlement.authorizeAttempt(instructionId, harness.adapterId);
    await harness.settlement.submitAttempt(instructionId, connection);
    const attempt = harness.settlement.attemptForInstruction(instructionId);
    expect(attempt?.state).toBe('UNKNOWN');
    const caseId = attempt?.reconciliationCaseId ?? '';
    expect(caseId).not.toBe('');
    // The reconciliation: investigate, then resolve CONFIRMED (INV-14-2).
    expect((await harness.rails.investigateCase(caseId)).ok).toBe(true);
    const resolved = harness.rails.resolveCase(caseId, {
      resolution: 'RESOLVED_CONFIRMED',
      proof: { externalRefs: ['bank-statement-42'] },
    });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.operation.status).toBe('CONFIRMED');
      expect(resolved.value.recovery.feed).toBe('AREA_12_FINALITY_ADVANCE');
    }
    // Duplicate resolution is rejected (INV-14-2).
    const duplicate = harness.rails.resolveCase(caseId, {
      resolution: 'RESOLVED_FAILED',
      proof: { externalRefs: ['bank-statement-42'] },
    });
    expect(duplicate.ok).toBe(false);
    // The safe-resume: the attempt CONFIRMED, the instruction CONFIRMED,
    // finality advances.
    const resumed = await harness.settlement.applyResolution(
      resolved.ok ? resolved.value.recovery : { feed: 'AREA_12_FINALITY_ADVANCE', instructionId, operationId: '', attemptOutcome: 'CONFIRMED' },
      caseId,
    );
    expect(resumed.ok).toBe(true);
    if (resumed.ok) {
      expect(resumed.value.attempt.state).toBe('CONFIRMED');
      expect(resumed.value.instruction.state).toBe('CONFIRMED');
    }
    const finality = harness.settlement.finalityForSubject({ kind: 'OBLIGATION', obligationId: o1 });
    expect(finality?.state).toBe('PROVISIONAL');
    expect(finality?.ruleReference).toBe('RECONCILIATION_RESOLUTION_RESOLVED_CONFIRMED');
    // FINAL by protocol rule; the obligation SETTLED exactly once.
    expect((await harness.settlement.declareFinality(instructionId)).ok).toBe(true);
    expect(harness.obligations.obligation(o1)?.state).toBe('SETTLED');
    expect(harness.settlement.isUnknownHeld({ kind: 'OBLIGATION', obligationId: o1 })).toBe(false);
  });

  test('RESOLVED_FAILED -> attempt FAILED, instruction FAILED; a NEW instruction is possible with a NEW idempotency key (fully evidenced)', async () => {
    const harness = makeHarness();
    const o1 = await createObligation(harness.obligations, 'u3', 'x-participant', 'y-participant', 600);
    const created = await harness.settlement.createSettlementInstruction({
      subject: { kind: 'OBLIGATION', obligationId: o1 },
      beneficiary: 'acct-y',
    });
    const instructionId = created.ok ? created.value.instructionId : '';
    const key = railIdempotencyKeyForInstruction(instructionId);
    const rail = new SimulatedRail('bank-unknown-3', { [key]: 'TRANSMIT_AMBIGUOUS_RESPONSE' });
    const connection = createSimulatedRailAdapter(rail);
    await harness.settlement.authorizeAttempt(instructionId, harness.adapterId);
    await harness.settlement.submitAttempt(instructionId, connection);
    const caseId = harness.settlement.attemptForInstruction(instructionId)?.reconciliationCaseId ?? '';
    expect(caseId).not.toBe('');
    await harness.rails.investigateCase(caseId);
    const resolved = harness.rails.resolveCase(caseId, {
      resolution: 'RESOLVED_FAILED',
      proof: { externalRefs: ['bank-statement-43'] },
    });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.recovery.feed).toBe('AREA_12_NEW_INSTRUCTION');
    }
    const resumed = await harness.settlement.applyResolution(
      resolved.ok
        ? resolved.value.recovery
        : { feed: 'AREA_12_NEW_INSTRUCTION', instructionId, operationId: '', note: 'RECOVERY_IS_A_NEW_INSTRUCTION_NOT_A_RETRY' },
      caseId,
    );
    expect(resumed.ok).toBe(true);
    if (resumed.ok) {
      expect(resumed.value.attempt.state).toBe('FAILED');
      expect(resumed.value.instruction.state).toBe('FAILED');
    }
    // The obligation stays SETTLEMENT_PENDING; a new instruction is possible.
    expect(harness.obligations.obligation(o1)?.state).toBe('SETTLEMENT_PENDING');
    const recovery = await harness.settlement.createSettlementInstruction({
      subject: { kind: 'OBLIGATION', obligationId: o1 },
      beneficiary: 'acct-y',
    });
    expect(recovery.ok).toBe(true);
    if (recovery.ok) {
      expect(recovery.value.subjectOrdinal).toBe(2);
      expect(railIdempotencyKeyForInstruction(recovery.value.instructionId)).not.toBe(key);
      // The new attempt is authorizable (the first is terminally resolved).
      const authorized = await harness.settlement.authorizeAttempt(
        recovery.value.instructionId,
        harness.adapterId,
      );
      expect(authorized.ok).toBe(true);
    }
    // The old instruction's attempt refuses a second authorization (terminal).
    const stale = await harness.settlement.authorizeAttempt(instructionId, harness.adapterId);
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.code).toBe('INSTRUCTION_TERMINAL');
    }
  });

  test('applyResolution refuses a non-UNKNOWN attempt (the duplicate-resolution guard)', async () => {
    const harness = makeHarness();
    const o1 = await createObligation(harness.obligations, 'u4', 'x-participant', 'y-participant', 100);
    const created = await harness.settlement.createSettlementInstruction({
      subject: { kind: 'OBLIGATION', obligationId: o1 },
      beneficiary: 'acct',
    });
    const instructionId = created.ok ? created.value.instructionId : '';
    await harness.settlement.authorizeAttempt(instructionId, harness.adapterId);
    await harness.settlement.submitAttempt(instructionId, harness.connection);
    const attempt = harness.settlement.attemptForInstruction(instructionId);
    const operationId = attempt?.operationId ?? '';
    const refused = await harness.settlement.applyResolution({
      feed: 'AREA_12_FINALITY_ADVANCE',
      instructionId,
      operationId,
      attemptOutcome: 'CONFIRMED',
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe('RECOVERY_NOT_APPLICABLE');
    }
  });
});

describe('the singleFinancialAuthority discipline (structural)', () => {
  test('the settlement module performs ZERO external transmission (no fetch/socket/http client in the owned surface)', async () => {
    const { readFile } = await import('node:fs/promises');
    const files = [
      'settlement.ts',
      'types.ts',
      'state-machine.ts',
      'evidence.ts',
      'store.ts',
      'ports.ts',
      'authority.ts',
      'persistence.ts',
    ];
    for (const file of files) {
      const source = await readFile(
        new URL(`./${file}`, import.meta.url).pathname,
        'utf8',
      );
      expect(source.includes('fetch(')).toBe(false);
      expect(source.includes('node:http')).toBe(false);
      expect(source.includes('node:net')).toBe(false);
      expect(source.includes('WebSocket')).toBe(false);
    }
  });

  test('the netting module performs ZERO external transmission', async () => {
    const { readFile } = await import('node:fs/promises');
    const files = [
      'netting.ts',
      'types.ts',
      'algorithm.ts',
      'state-machine.ts',
      'evidence.ts',
      'store.ts',
      'authority.ts',
      'persistence.ts',
    ];
    for (const file of files) {
      const source = await readFile(
        new URL(`../netting/${file}`, import.meta.url).pathname,
        'utf8',
      );
      expect(source.includes('fetch(')).toBe(false);
      expect(source.includes('node:http')).toBe(false);
      expect(source.includes('node:net')).toBe(false);
      expect(source.includes('WebSocket')).toBe(false);
    }
  });
});
