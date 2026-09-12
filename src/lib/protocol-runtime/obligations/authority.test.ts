/**
 * RTN-008 — Obligation Ledger Authority: the closed INV-10-4 write
 * surface — the machine-checked authority gate, the lifecycle journeys,
 * INV-10-3 creation idempotency, the correction path (CANCELLED with
 * mandatory evidence, new linked obligations), the dispute path
 * (DISPUTED + resolution creates new obligations, never mutates), the
 * risk write-off, and the area-12 finality advance (exactly once).
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §2 Area 10,
 *   lines 91-111 (the machine and the owning authority); lines 113-123
 *   (INV-10-1/2/3/4, verbatim); lines 125-131 (the UNKNOWN-settlement
 *   hold).
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import type { EvidenceSubmission, EvidenceSubmissionRecord } from '../kernel/ports.ts';
import { ObligationLedgerAuthority } from './authority.ts';
import type {
  ClearingCreationInstruction,
  DisputeResolutionInstruction,
  NettingCommitInstruction,
  ObligationWriteInstruction,
  RiskWriteOffInstruction,
  SettlementFinalityInstruction,
  SettlementInstructionApplied,
} from './authority.ts';
import { obligationIdForOriginRecord } from './state-machine.ts';
import {
  INV_10_4_AUTHORITY_GATE,
  OBLIGATION_INSTRUCTION_KINDS,
  inv10_4CreationKinds,
  inv10_4TerminalKindFor,
  isObligationInstructionKind,
} from './types.ts';

function makeAuthority(options: { readonly settlementHold?: (id: string) => boolean } = {}) {
  const records: EvidenceSubmissionRecord[] = [];
  const recorder: EvidenceSubmission = {
    submit: (record) => {
      records.push(record);
    },
  };
  let wall = 5_000;
  const authority = new ObligationLedgerAuthority({
    evidence: recorder,
    settlementHold: options.settlementHold,
    wallClock: () => wall,
  });
  return { records, authority, advance: (ms: number) => { wall += ms; } };
}

const EUR = (minor: number) => money('EUR', minor, 2);

function clearingInstruction(overrides: Partial<ClearingCreationInstruction> = {}): ClearingCreationInstruction {
  return {
    kind: 'CLEARING_COMMIT',
    batchId: 'pid.v1.batch-1',
    recordId: 'pid.v1.record-1',
    originActivityId: 'activity-1',
    originKind: 'INTENT',
    debtorParticipantId: 'participant-a',
    creditorParticipantId: 'participant-b',
    amount: EUR(1_000),
    reason: 'hop settlement',
    ...overrides,
  };
}

async function createObligation(
  authority: ObligationLedgerAuthority,
  overrides: Partial<ClearingCreationInstruction> = {},
): Promise<string> {
  const outcome = await authority.applyClearingCommand(clearingInstruction(overrides));
  return outcome.obligationId;
}

describe('the INV-10-4 machine-checked authority gate (lines 119-123)', () => {
  test('the frozen gate table: creation ONLY via clearing commits and dispute outcomes', () => {
    expect(inv10_4CreationKinds()).toEqual(['CLEARING_COMMIT', 'DISPUTE_RESOLUTION']);
    for (const kind of OBLIGATION_INSTRUCTION_KINDS) {
      const gate = INV_10_4_AUTHORITY_GATE[kind];
      if (kind === 'CLEARING_COMMIT' || kind === 'DISPUTE_RESOLUTION') {
        expect(gate.creates).toBe(true);
      } else {
        expect(gate.creates).toBe(false);
      }
    }
  });

  test('the frozen gate table: the disposition terminalizers are exact', () => {
    expect(inv10_4TerminalKindFor('DISPUTED')).toBe('DISPUTE_OPEN');
    expect(inv10_4TerminalKindFor('WRITTEN_OFF')).toBe('RISK_WRITE_OFF');
    expect(inv10_4TerminalKindFor('CANCELLED')).toBe('CLEARING_CORRECTION_CANCEL');
    expect(inv10_4TerminalKindFor('SETTLED')).toBe('SETTLEMENT_FINALITY');
    // the lifecycle kinds terminalize nothing
    expect(INV_10_4_AUTHORITY_GATE.NETTING_COMMIT.terminalizes).toBe(null);
    expect(INV_10_4_AUTHORITY_GATE.SETTLEMENT_INSTRUCTION.terminalizes).toBe(null);
  });

  test('creation outside the three paths is REJECTED: a fabricated instruction kind is refused (runtime closedness)', async () => {
    const { authority } = makeAuthority();
    const fabricated = { kind: 'PRODUCT_LAYER_WRITE', obligationId: 'x' } as unknown as ObligationWriteInstruction;
    expect(() => authority.applyInstruction(fabricated)).toThrow(/closed INV-10-4 surface/);
    expect(authority.log.height).toBe(0); // no ledger effect
  });

  test('every non-creating instruction kind produces NO new obligation (creation is the two commands only)', async () => {
    const { authority } = makeAuthority();
    // apply every transition-shaped kind against a nonexistent obligation:
    // each is rejected with OBLIGATION_NOT_FOUND and creates nothing
    const transitions: ObligationWriteInstruction[] = [
      { kind: 'DISPUTE_OPEN', obligationId: 'pid.v1.missing', disputeId: 'dispute-1' },
      { kind: 'RISK_WRITE_OFF', obligationId: 'pid.v1.missing', riskAuthorityReference: 'risk-1' },
      { kind: 'CLEARING_CORRECTION_CANCEL', obligationId: 'pid.v1.missing', replacementObligationId: 'pid.v1.replacement', evidenceReference: 'case-1' },
      { kind: 'SETTLEMENT_FINALITY', obligationId: 'pid.v1.missing', finalityRecordId: 'finality-1' },
      { kind: 'NETTING_COMMIT', obligationId: 'pid.v1.missing', nettingSetId: 'netting-1', replacementObligationIds: [] },
      { kind: 'SETTLEMENT_INSTRUCTION', obligationId: 'pid.v1.missing', settlementInstructionId: 'instruction-1' },
    ];
    for (const instruction of transitions) {
      const result = await authority.applyInstruction(instruction);
      expect(result.ok).toBe(false);
    }
    expect(authority.obligations()).toEqual([]);
    expect(authority.log.inv10_4Audit().holds).toBe(true);
  });

  test('a full journey passes the content-level audit: every creation entry carries a gate creation path', async () => {
    const { authority } = makeAuthority();
    const obligationId = await createObligation(authority);
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
    const audit = authority.log.inv10_4Audit();
    expect(audit.holds).toBe(true);
    expect(authority.log.sequenceInvariant()).toBe(true);
  });
});

describe('INV-10-3: creation keyed by origin record id; duplicates are no-ops (lines 119-121)', () => {
  test('the obligation id is derived from the origin record id', async () => {
    const { authority } = makeAuthority();
    const obligationId = await createObligation(authority);
    expect(obligationId).toBe(obligationIdForOriginRecord('pid.v1.record-1'));
    expect(obligationId.startsWith('pid.v1.')).toBe(true);
  });

  test('a duplicate instruction is a no-op returning the recorded obligation — no second entry, no second evidence', async () => {
    const { authority, records } = makeAuthority();
    const first = await authority.applyClearingCommand(clearingInstruction());
    expect(first.duplicate).toBe(false);
    const evidenceAfterFirst = records.length;
    const second = await authority.applyClearingCommand(clearingInstruction());
    expect(second.duplicate).toBe(true);
    expect(second.obligationId).toBe(first.obligationId);
    expect(authority.log.height).toBe(1); // ONE creation entry
    expect(records.length).toBe(evidenceAfterFirst); // no second OBLIGATION_CREATED
    expect((authority.obligations()).length).toBe(1);
  });

  test('a different origin record id creates a distinct obligation', async () => {
    const { authority } = makeAuthority();
    const a = await createObligation(authority);
    const b = await createObligation(authority, { recordId: 'pid.v1.record-2', originActivityId: 'activity-2' });
    expect(a).not.toBe(b);
    expect((authority.obligations()).length).toBe(2);
  });
});

describe('the lifecycle journeys (A10 lines 92-103)', () => {
  test('CREATED -> NETTED -> SETTLEMENT_PENDING -> SETTLED (the happy path with netting)', async () => {
    const { authority } = makeAuthority();
    const obligationId = await createObligation(authority);
    const netted = await authority.applyNettingCommit({
      kind: 'NETTING_COMMIT',
      obligationId,
      nettingSetId: 'netting-set-1',
      replacementObligationIds: ['pid.v1.net-obligation-1'],
    });
    expect(netted.ok).toBe(true);
    if (netted.ok) {
      expect(netted.value.state).toBe('NETTED');
    }
    const pending = await authority.applySettlementInstruction({
      kind: 'SETTLEMENT_INSTRUCTION',
      obligationId,
      settlementInstructionId: 'instruction-1',
    });
    expect(pending.ok).toBe(true);
    if (pending.ok) {
      expect(pending.value.obligation.state).toBe('SETTLEMENT_PENDING');
      expect(pending.value.applied).toBe(true);
    }
    const settled = await authority.applySettlementFinality({
      kind: 'SETTLEMENT_FINALITY',
      obligationId,
      finalityRecordId: 'finality-1',
    });
    expect(settled.ok).toBe(true);
    if (settled.ok) {
      expect(settled.value.state).toBe('SETTLED');
    }
  });

  test('CREATED -> SETTLEMENT_PENDING directly (netting is optional)', async () => {
    const { authority } = makeAuthority();
    const obligationId = await createObligation(authority);
    const pending = await authority.applySettlementInstruction({
      kind: 'SETTLEMENT_INSTRUCTION',
      obligationId,
      settlementInstructionId: 'instruction-1',
    });
    expect(pending.ok).toBe(true);
    if (pending.ok) {
      expect(pending.value.obligation.state).toBe('SETTLEMENT_PENDING');
    }
  });

  test('a second settlement instruction while pending is a typed no-op (area-12 recovery: a new instruction)', async () => {
    const { authority, records } = makeAuthority();
    const obligationId = await createObligation(authority);
    await authority.applySettlementInstruction({
      kind: 'SETTLEMENT_INSTRUCTION',
      obligationId,
      settlementInstructionId: 'instruction-1',
    });
    const evidenceBefore = records.length;
    const retry = await authority.applySettlementInstruction({
      kind: 'SETTLEMENT_INSTRUCTION',
      obligationId,
      settlementInstructionId: 'instruction-2',
    });
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.value.applied).toBe(false); // no state change
    }
    expect(records.length).toBe(evidenceBefore); // no evidence for a no-op
  });

  test('finality is exactly once: a second advance is the typed ILLEGAL_TRANSITION (post-terminal)', async () => {
    const { authority } = makeAuthority();
    const obligationId = await createObligation(authority);
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
    const second = await authority.applySettlementFinality({
      kind: 'SETTLEMENT_FINALITY',
      obligationId,
      finalityRecordId: 'finality-2',
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe('ILLEGAL_TRANSITION');
    }
  });

  test('finality requires SETTLEMENT_PENDING first (the machine: no SETTLED from CREATED)', async () => {
    const { authority } = makeAuthority();
    const obligationId = await createObligation(authority);
    const early = await authority.applySettlementFinality({
      kind: 'SETTLEMENT_FINALITY',
      obligationId,
      finalityRecordId: 'finality-1',
    });
    expect(early.ok).toBe(false);
    if (!early.ok) {
      expect(early.code).toBe('ILLEGAL_TRANSITION');
    }
  });
});

describe('the correction path: CANCELLED with mandatory evidence + new linked obligations (lines 102-103, 113-116)', () => {
  test('a correction creates the NEW linked obligation via the clearing path, then cancels the prior with mandatory evidence', async () => {
    const { authority } = makeAuthority();
    const priorId = await createObligation(authority, {
      recordId: 'pid.v1.record-original',
      originActivityId: 'activity-original',
    });
    // the correction record (origin: the reconciliation adjustment)
    const replacementId = await createObligation(authority, {
      recordId: 'pid.v1.record-correction',
      originActivityId: 'adjustment-case-1',
      originKind: 'RECONCILIATION_ADJUSTMENT',
      correctionOf: priorId,
    });
    // INV-10-1: "corrections are new linked obligations"
    const replacement = authority.obligation(replacementId);
    expect(replacement?.linkedPriorObligationId).toBe(priorId);
    // the prior obligation is CANCELLED with mandatory evidence
    const cancelled = await authority.applyClearingCorrectionCancel({
      kind: 'CLEARING_CORRECTION_CANCEL',
      obligationId: priorId,
      replacementObligationId: replacementId,
      evidenceReference: 'case-1-adjustment',
    });
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) {
      expect(cancelled.value.state).toBe('CANCELLED');
    }
    // the prior obligation's terms were NEVER mutated
    expect(authority.obligation(priorId)?.terms.amount.amountMinor).toBe(1_000);
    // the replacement is live
    expect(authority.obligation(replacementId)?.state).toBe('CREATED');
  });

  test('CANCELLED without mandatory evidence is refused (the shape guard throws)', async () => {
    const { authority } = makeAuthority();
    const priorId = await createObligation(authority);
    expect(() =>
      authority.applyClearingCorrectionCancel({
        kind: 'CLEARING_CORRECTION_CANCEL',
        obligationId: priorId,
        replacementObligationId: 'pid.v1.replacement',
        evidenceReference: '',
      }),
    ).toThrow(/evidenceReference/);
  });

  test('a correction referencing a nonexistent prior obligation fails loudly', async () => {
    const { authority } = makeAuthority();
    let threw = false;
    try {
      await authority.applyClearingCommand(
        clearingInstruction({
          recordId: 'pid.v1.record-correction',
          originActivityId: 'adjustment-case-1',
          originKind: 'RECONCILIATION_ADJUSTMENT',
          correctionOf: 'pid.v1.never-existed',
        }),
      );
    } catch (error) {
      threw = error instanceof Error && error.message.includes('correctionOf');
    }
    expect(threw).toBe(true);
  });
});

describe('the dispute path: DISPUTED + resolution creates new obligations, never mutates (lines 98-100)', () => {
  test('openDispute terminalizes to DISPUTED; the resolution creates NEW linked obligations', async () => {
    const { authority } = makeAuthority();
    const disputedId = await createObligation(authority, {
      recordId: 'pid.v1.record-disputed',
      originActivityId: 'activity-disputed',
    });
    const opened = await authority.openDispute({
      kind: 'DISPUTE_OPEN',
      obligationId: disputedId,
      disputeId: 'dispute-1',
    });
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.value.state).toBe('DISPUTED');
    }
    // the resolution: replacements are NEW obligations linked to the
    // disputed one; the disputed one is NEVER mutated
    const resolution: DisputeResolutionInstruction = {
      kind: 'DISPUTE_RESOLUTION',
      disputeId: 'dispute-1',
      resolvedObligationId: disputedId,
      replacements: [
        {
          debtorParticipantId: 'participant-a',
          creditorParticipantId: 'participant-b',
          amount: EUR(600),
          reason: 'dispute resolution: partial debt upheld',
        },
      ],
    };
    const resolved = await authority.applyDisputeResolution(resolution);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect((resolved.value).length).toBe(1);
      expect(resolved.value[0]?.duplicate).toBe(false);
      const replacementId = resolved.value[0]?.obligationId;
      const replacement = authority.obligation(replacementId ?? '');
      expect(replacement?.state).toBe('CREATED');
      expect(replacement?.linkedPriorObligationId).toBe(disputedId);
      expect(replacement?.origin.kind).toBe('DISPUTE_RESOLUTION');
      expect(replacement?.terms.amount.amountMinor).toBe(600);
    }
    // the disputed obligation is untouched: still DISPUTED, original terms
    const disputed = authority.obligation(disputedId);
    expect(disputed?.state).toBe('DISPUTED');
    expect(disputed?.terms.amount.amountMinor).toBe(1_000);
  });

  test('a duplicate resolution application no-ops the already-created replacements', async () => {
    const { authority } = makeAuthority();
    const disputedId = await createObligation(authority, {
      recordId: 'pid.v1.record-disputed',
      originActivityId: 'activity-disputed',
    });
    await authority.openDispute({
      kind: 'DISPUTE_OPEN',
      obligationId: disputedId,
      disputeId: 'dispute-1',
    });
    const resolution: DisputeResolutionInstruction = {
      kind: 'DISPUTE_RESOLUTION',
      disputeId: 'dispute-1',
      resolvedObligationId: disputedId,
      replacements: [
        {
          debtorParticipantId: 'participant-a',
          creditorParticipantId: 'participant-b',
          amount: EUR(600),
          reason: 'dispute resolution: partial debt upheld',
        },
      ],
    };
    const first = await authority.applyDisputeResolution(resolution);
    const second = await authority.applyDisputeResolution(resolution);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value[0]?.duplicate).toBe(true);
      expect(second.value[0]?.obligationId).toBe(first.value[0]?.obligationId);
    }
    expect((authority.obligations()).length).toBe(2); // the disputed + ONE replacement
  });

  test('resolving an obligation that is not DISPUTED is the typed NOT_DISPUTED rejection', async () => {
    const { authority } = makeAuthority();
    const obligationId = await createObligation(authority);
    const resolved = await authority.applyDisputeResolution({
      kind: 'DISPUTE_RESOLUTION',
      disputeId: 'dispute-1',
      resolvedObligationId: obligationId,
      replacements: [],
    });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.code).toBe('NOT_DISPUTED');
    }
  });
});

describe('the risk write-off: WRITTEN_OFF via risk authority (lines 100-101)', () => {
  test('applyRiskWriteOff terminalizes to WRITTEN_OFF with the risk authority reference', async () => {
    const { authority, records } = makeAuthority();
    const obligationId = await createObligation(authority);
    const writtenOff = await authority.applyRiskWriteOff({
      kind: 'RISK_WRITE_OFF',
      obligationId,
      riskAuthorityReference: 'risk-disposition-7',
    });
    expect(writtenOff.ok).toBe(true);
    if (writtenOff.ok) {
      expect(writtenOff.value.state).toBe('WRITTEN_OFF');
    }
    // the OBLIGATION_WRITTEN_OFF evidence carries the risk reference
    const writeOffRecord = records.find(
      (record) => record.what.operationType === 'OBLIGATION_WRITTEN_OFF',
    );
    expect(writeOffRecord === undefined).toBe(false);
    expect(writeOffRecord?.what.subjectIds).toContain('risk-disposition-7');
  });

  test('a write-off of a terminal obligation is the typed ILLEGAL_TRANSITION (at most once)', async () => {
    const { authority } = makeAuthority();
    const obligationId = await createObligation(authority);
    await authority.applyRiskWriteOff({
      kind: 'RISK_WRITE_OFF',
      obligationId,
      riskAuthorityReference: 'risk-disposition-7',
    });
    const second = await authority.applyRiskWriteOff({
      kind: 'RISK_WRITE_OFF',
      obligationId,
      riskAuthorityReference: 'risk-disposition-8',
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe('ILLEGAL_TRANSITION');
    }
  });
});

describe('the UNKNOWN-settlement hold (lines 125-131, GC-2)', () => {
  test('finality is REFUSED (typed UNKNOWN_HELD) while the settlement attempt is an unresolved UNKNOWN', async () => {
    let held = true;
    const { authority } = makeAuthority({ settlementHold: () => held });
    const obligationId = await createObligation(authority);
    await authority.applySettlementInstruction({
      kind: 'SETTLEMENT_INSTRUCTION',
      obligationId,
      settlementInstructionId: 'instruction-1',
    });
    // the settlement attempt went UNKNOWN; finality cannot be declared
    const refused = await authority.applySettlementFinality({
      kind: 'SETTLEMENT_FINALITY',
      obligationId,
      finalityRecordId: 'finality-1',
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe('UNKNOWN_HELD');
      expect(refused.message).toContain('SETTLEMENT_PENDING');
    }
    // the obligation REMAINS SETTLEMENT_PENDING, unchanged
    expect(authority.obligation(obligationId)?.state).toBe('SETTLEMENT_PENDING');
    expect(authority.log.height).toBe(2); // creation + instruction only
    // after reconciliation resolves the rail operation, finality advances
    held = false;
    const advanced = await authority.applySettlementFinality({
      kind: 'SETTLEMENT_FINALITY',
      obligationId,
      finalityRecordId: 'finality-1',
    });
    expect(advanced.ok).toBe(true);
    if (advanced.ok) {
      expect(advanced.value.state).toBe('SETTLED');
    }
    // ... exactly once
    const again = await authority.applySettlementFinality({
      kind: 'SETTLEMENT_FINALITY',
      obligationId,
      finalityRecordId: 'finality-2',
    });
    expect(again.ok).toBe(false);
  });
});
