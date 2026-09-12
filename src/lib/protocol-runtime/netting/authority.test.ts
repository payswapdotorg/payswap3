/**
 * RTN-009 — Netting Authority: the command surface — the OPEN -> COMPUTED
 * -> COMMITTED lifecycle, the atomic membership claim (INV-11-2), the
 * DISPUTED exclusion, the conservation-before-commit gate (INV-11-1), the
 * re-commit no-op (INV-11-3), and the composed A10 NETTED transitions.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §3 Area 11:
 *     lines 157-175 (the objects, states, and the owning-authority split:
 *      "obligation transitions remain owned by area 10, executed only on
 *      Netting Authority instruction").
 *     lines 177-189 (INV-11-1 / INV-11-2 / INV-11-3 — verbatim).
 *     lines 191-197 ("failures are validation failures that abort the set
 *      before commit with no ledger effect. No UNKNOWN state.").
 *     lines 205-209 (boundaries: "Netting never includes obligations in
 *      DISPUTED state.").
 *   spec/architecture/v0.1/README.md §3 GC-1/GC-4.
 */
import { describe, expect, test } from 'bun:test';
import { createEvidenceLog } from '../evidence/log.ts';
import { money } from '../kernel/money.ts';
import { NettingAuthority } from './authority.ts';
import type { NettingObligationLedgerPort } from './authority.ts';
import { obligationIdForOriginRecord } from '../obligations/state-machine.ts';
import { ObligationLedgerAuthority } from '../obligations/authority.ts';
import type { ClearingCreationInstruction } from '../obligations/authority.ts';

const EUR = (minor: number) => money('EUR', minor, 2);

/** The composed in-process harness: the REAL A10 ledger + the REAL A15 log. */
function makeHarness() {
  const log = createEvidenceLog({ wallMs: 1_000 });
  let wall = 5_000;
  const clock = () => wall;
  const obligations = new ObligationLedgerAuthority({ evidence: log, wallClock: clock });
  const netting = new NettingAuthority({
    evidence: log,
    obligations: obligations as unknown as NettingObligationLedgerPort,
    wallClock: clock,
  });
  return {
    log,
    obligations,
    netting,
    advance: (ms: number) => {
      wall += ms;
    },
    wall: () => wall,
  };
}

/** Create one obligation in the REAL A10 ledger (acting as the clearing composition root). */
async function createObligation(
  obligations: ObligationLedgerAuthority,
  recordId: string,
  debtor: string,
  creditor: string,
  amountMinor: number,
): Promise<string> {
  const instruction: Omit<ClearingCreationInstruction, 'kind'> = {
    batchId: `batch-${recordId}`,
    recordId,
    originActivityId: `activity-${recordId}`,
    originKind: 'INTENT',
    debtorParticipantId: debtor,
    creditorParticipantId: creditor,
    amount: EUR(amountMinor),
    reason: 'netting test fixture',
  };
  const outcome = await obligations.applyClearingCommand(instruction);
  return outcome.obligationId;
}

describe('the OPEN -> COMPUTED -> COMMITTED lifecycle', () => {
  test('a bilateral set: open fixes the input ids, compute records the conservation proof, commit moves the obligations to NETTED and materializes the net obligations', async () => {
    const harness = makeHarness();
    const { netting, obligations } = harness;
    const o1 = await createObligation(obligations, 'r1', 'merchant-a', 'merchant-b', 10_000);
    const o2 = await createObligation(obligations, 'r2', 'merchant-b', 'merchant-a', 7_000);
    const opened = await netting.openNettingSet({
      label: 'bilateral-1',
      scope: { kind: 'BILATERAL', participants: ['merchant-a', 'merchant-b'] },
      inputObligationIds: [o1, o2],
    });
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.value.state).toBe('OPEN');
      expect([...opened.value.inputObligationIds]).toEqual([o1, o2]);
      expect(netting.obligationClaim(o1)).toBe(opened.value.nettingSetId);
      expect(netting.obligationClaim(o2)).toBe(opened.value.nettingSetId);
    }
    const computed = await netting.computeNettingSet(
      opened.ok ? opened.value.nettingSetId : '',
    );
    expect(computed.ok).toBe(true);
    if (computed.ok) {
      expect(computed.value.state).toBe('COMPUTED');
      // INV-11-1: the check is recorded in the set's proof BEFORE commit.
      expect(computed.value.conservationProof).toBeDefined();
      expect(computed.value.conservationProof?.perCurrency.every((entry) => entry.conserved)).toBe(true);
      // The net positions: a: -3000, b: +3000, each with its breakdown hash.
      const positionA = computed.value.netPositions?.find((p) => p.participantId === 'merchant-a');
      expect(positionA?.net.amountMinor).toBe(-3_000);
      expect(positionA?.breakdownHash).toBeDefined();
      expect(positionA?.breakdown.length).toBe(2);
    }
    const setId = computed.ok ? computed.value.nettingSetId : '';
    const committed = await netting.commitNettingSet(setId);
    expect(committed.ok).toBe(true);
    if (committed.ok) {
      expect(committed.value.noop).toBe(false);
      expect(committed.value.set.state).toBe('COMMITTED');
      // The input obligations moved to NETTED in the REAL ledger, with the
      // net obligations as the replacement references.
      expect(obligations.obligation(o1)?.state).toBe('NETTED');
      expect(obligations.obligation(o2)?.state).toBe('NETTED');
      // One net obligation: merchant-a owes merchant-b 3000.
      expect(committed.value.netObligations.length).toBe(1);
      const net = committed.value.netObligations[0];
      expect(net?.debtorParticipantId).toBe('merchant-a');
      expect(net?.creditorParticipantId).toBe('merchant-b');
      expect(net?.amount.amountMinor).toBe(3_000);
      expect(net?.state).toBe('CREATED');
      // The A10 NETTED transition entry carries the replacement references.
      const transition = obligations.log
        .fold()
        .find((o) => o.obligationId === o1 && o.state === 'NETTED');
      expect(transition).toBeDefined();
      // The membership claims were released at COMMIT.
      expect(netting.obligationClaim(o1)).toBeUndefined();
      expect(netting.obligationClaim(o2)).toBeUndefined();
    }
  });

  test('a multilateral set: cyclic obligations net to conserving flows; every input goes NETTED', async () => {
    const harness = makeHarness();
    const { netting, obligations } = harness;
    const o1 = await createObligation(obligations, 'm1', 'p-a', 'p-b', 10_000);
    const o2 = await createObligation(obligations, 'm2', 'p-b', 'p-c', 7_000);
    const o3 = await createObligation(obligations, 'm3', 'p-c', 'p-a', 5_000);
    const opened = await netting.openNettingSet({
      label: 'multilateral-1',
      scope: { kind: 'MULTILATERAL', participants: ['p-a', 'p-b', 'p-c'] },
      inputObligationIds: [o1, o2, o3],
    });
    expect(opened.ok).toBe(true);
    const setId = opened.ok ? opened.value.nettingSetId : '';
    expect((await netting.computeNettingSet(setId)).ok).toBe(true);
    const committed = await netting.commitNettingSet(setId);
    expect(committed.ok).toBe(true);
    if (committed.ok) {
      expect(obligations.obligation(o1)?.state).toBe('NETTED');
      expect(obligations.obligation(o2)?.state).toBe('NETTED');
      expect(obligations.obligation(o3)?.state).toBe('NETTED');
      // Nets: a: -5000, b: +3000, c: +2000 -> flows summing to 5000.
      expect(
        committed.value.netObligations.reduce((acc, entry) => acc + entry.amount.amountMinor, 0),
      ).toBe(5_000);
      // INV-11-1 recorded before commit.
      expect(committed.value.set.conservationProof?.perCurrency.every((e) => e.conserved)).toBe(true);
    }
  });

  test('INV-11-3: re-commit of a committed set id is a no-op returning the recorded result (no second evidence)', async () => {
    const harness = makeHarness();
    const { netting, obligations, log } = harness;
    const o1 = await createObligation(obligations, 'n1', 'x', 'y', 1_000);
    const opened = await netting.openNettingSet({
      label: 'no-op-1',
      scope: { kind: 'BILATERAL', participants: ['x', 'y'] },
      inputObligationIds: [o1],
    });
    const setId = opened.ok ? opened.value.nettingSetId : '';
    await netting.computeNettingSet(setId);
    const first = await netting.commitNettingSet(setId);
    expect(first.ok).toBe(true);
    const recordsAfterFirst = log.records().length;
    const second = await netting.commitNettingSet(setId);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.noop).toBe(true);
      expect(second.value.netObligations.map((entry) => entry.netObligationId)).toEqual(
        first.value.netObligations.map((entry) => entry.netObligationId),
      );
      expect(log.records().length).toBe(recordsAfterFirst); // no second evidence record
      expect(netting.nettingSet(setId)?.state).toBe('COMMITTED');
    }
  });

  test('the machine is exact: compute requires OPEN, commit requires COMPUTED', async () => {
    const harness = makeHarness();
    const { netting, obligations } = harness;
    const o1 = await createObligation(obligations, 'x1', 'x', 'y', 500);
    const opened = await netting.openNettingSet({
      label: 'machine-1',
      scope: { kind: 'BILATERAL', participants: ['x', 'y'] },
      inputObligationIds: [o1],
    });
    const setId = opened.ok ? opened.value.nettingSetId : '';
    // commit before compute
    const early = await netting.commitNettingSet(setId);
    expect(early.ok).toBe(false);
    if (!early.ok) {
      expect(early.code).toBe('NOT_COMPUTED');
    }
    expect((await netting.computeNettingSet(setId)).ok).toBe(true);
    // recompute
    const recomputed = await netting.computeNettingSet(setId);
    expect(recomputed.ok).toBe(false);
    if (!recomputed.ok) {
      expect(recomputed.code).toBe('ILLEGAL_TRANSITION');
    }
    expect((await netting.commitNettingSet(setId)).ok).toBe(true);
  });
});

describe('INV-11-2 — the atomic membership claim at OPEN', () => {
  test('an obligation can belong to at most one open netting set: the conflicting open is rejected with NO claims made', async () => {
    const harness = makeHarness();
    const { netting, obligations } = harness;
    const o1 = await createObligation(obligations, 'c1', 'x', 'y', 100);
    const o2 = await createObligation(obligations, 'c2', 'y', 'x', 200);
    const o3 = await createObligation(obligations, 'c3', 'x', 'y', 300);
    const o4 = await createObligation(obligations, 'c4', 'y', 'x', 400);
    const first = await netting.openNettingSet({
      label: 'claims-1',
      scope: { kind: 'BILATERAL', participants: ['x', 'y'] },
      inputObligationIds: [o1, o2],
    });
    expect(first.ok).toBe(true);
    // o2 conflicts: the whole open is rejected, and o3/o4 stay unclaimed.
    const second = await netting.openNettingSet({
      label: 'claims-2',
      scope: { kind: 'BILATERAL', participants: ['x', 'y'] },
      inputObligationIds: [o3, o2, o4],
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe('ALREADY_CLAIMED');
    }
    expect(netting.obligationClaim(o3)).toBeUndefined();
    expect(netting.obligationClaim(o4)).toBeUndefined();
    expect(netting.nettingSet(second.ok ? second.value.nettingSetId : 'pid.v1.none')).toBeUndefined();
    // After the first set commits, the claims are released and a new set
    // may claim the obligations again (the NETTED state then structurally
    // prevents re-netting: applyNettingCommit refuses from NETTED).
    const setId = first.ok ? first.value.nettingSetId : '';
    await netting.computeNettingSet(setId);
    expect((await netting.commitNettingSet(setId)).ok).toBe(true);
    expect(netting.obligationClaim(o1)).toBeUndefined();
    const reopened = await netting.openNettingSet({
      label: 'claims-3',
      scope: { kind: 'BILATERAL', participants: ['x', 'y'] },
      inputObligationIds: [o3, o4],
    });
    expect(reopened.ok).toBe(true);
  });

  test('duplicate input ids are rejected (a set is over a set of obligations)', async () => {
    const harness = makeHarness();
    const { netting, obligations } = harness;
    const o1 = await createObligation(obligations, 'd1', 'x', 'y', 100);
    const opened = await netting.openNettingSet({
      label: 'dup-1',
      scope: { kind: 'BILATERAL', participants: ['x', 'y'] },
      inputObligationIds: [o1, o1],
    });
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.code).toBe('DUPLICATE_INPUT');
    }
    expect(netting.obligationClaim(o1)).toBeUndefined();
  });

  test('set labels are unique: a duplicate label is a typed rejection', async () => {
    const harness = makeHarness();
    const { netting, obligations } = harness;
    const o1 = await createObligation(obligations, 'l1', 'x', 'y', 100);
    const o2 = await createObligation(obligations, 'l2', 'x', 'y', 100);
    expect(
      (
        await netting.openNettingSet({
          label: 'same-label',
          scope: { kind: 'BILATERAL', participants: ['x', 'y'] },
          inputObligationIds: [o1],
        })
      ).ok,
    ).toBe(true);
    const second = await netting.openNettingSet({
      label: 'same-label',
      scope: { kind: 'BILATERAL', participants: ['x', 'y'] },
      inputObligationIds: [o2],
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe('NETTING_SET_EXISTS');
    }
  });
});

describe('the DISPUTED exclusion (a hard boundary, never a silent skip)', () => {
  test('an obligation in DISPUTED state cannot enter a netting set at OPEN', async () => {
    const harness = makeHarness();
    const { netting, obligations } = harness;
    const o1 = await createObligation(obligations, 'q1', 'x', 'y', 100);
    const o2 = await createObligation(obligations, 'q2', 'y', 'x', 100);
    // Move o2 to SETTLEMENT_PENDING first, then open a dispute on it.
    await obligations.applySettlementInstruction({
      kind: 'SETTLEMENT_INSTRUCTION',
      obligationId: o2,
      settlementInstructionId: 'fixture-instruction',
    });
    const disputed = await obligations.openDispute({
      kind: 'DISPUTE_OPEN',
      obligationId: o2,
      disputeId: 'dispute-1',
    });
    expect(disputed.ok).toBe(true);
    expect(obligations.obligation(o2)?.state).toBe('DISPUTED');
    const opened = await netting.openNettingSet({
      label: 'disputed-1',
      scope: { kind: 'BILATERAL', participants: ['x', 'y'] },
      inputObligationIds: [o1, o2],
    });
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.code).toBe('OBLIGATION_DISPUTED');
    }
    expect(netting.obligationClaim(o1)).toBeUndefined(); // atomic: nothing claimed
  });

  test('an obligation that becomes DISPUTED between OPEN and COMPUTE aborts the computation with no ledger effect', async () => {
    const harness = makeHarness();
    const { netting, obligations } = harness;
    const o1 = await createObligation(obligations, 'w1', 'x', 'y', 100);
    const o2 = await createObligation(obligations, 'w2', 'y', 'x', 100);
    const opened = await netting.openNettingSet({
      label: 'late-disputed',
      scope: { kind: 'BILATERAL', participants: ['x', 'y'] },
      inputObligationIds: [o1, o2],
    });
    expect(opened.ok).toBe(true);
    await obligations.applySettlementInstruction({
      kind: 'SETTLEMENT_INSTRUCTION',
      obligationId: o2,
      settlementInstructionId: 'fixture-instruction-2',
    });
    await obligations.openDispute({ kind: 'DISPUTE_OPEN', obligationId: o2, disputeId: 'dispute-2' });
    const computed = await netting.computeNettingSet(opened.ok ? opened.value.nettingSetId : '');
    expect(computed.ok).toBe(false);
    if (!computed.ok) {
      expect(computed.code).toBe('OBLIGATION_DISPUTED');
    }
    // No ledger effect: both obligations untouched by netting.
    expect(obligations.obligation(o1)?.state).toBe('CREATED');
    expect(obligations.obligation(o2)?.state).toBe('DISPUTED');
    expect(netting.nettingSet(opened.ok ? opened.value.nettingSetId : '')?.state).toBe('OPEN');
  });

  test('a non-CREATED obligation is refused at OPEN with its own typed code', async () => {
    const harness = makeHarness();
    const { netting, obligations } = harness;
    const o1 = await createObligation(obligations, 'p1', 'x', 'y', 100);
    await obligations.applySettlementInstruction({
      kind: 'SETTLEMENT_INSTRUCTION',
      obligationId: o1,
      settlementInstructionId: 'fixture-instruction-3',
    });
    const opened = await netting.openNettingSet({
      label: 'not-created',
      scope: { kind: 'BILATERAL', participants: ['x', 'y'] },
      inputObligationIds: [o1],
    });
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.code).toBe('OBLIGATION_NOT_CREATED');
    }
  });

  test('a party outside the scope participant set is refused', async () => {
    const harness = makeHarness();
    const { netting, obligations } = harness;
    const o1 = await createObligation(obligations, 's1', 'x', 'z', 100);
    const opened = await netting.openNettingSet({
      label: 'out-of-scope',
      scope: { kind: 'BILATERAL', participants: ['x', 'y'] },
      inputObligationIds: [o1],
    });
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.code).toBe('PARTICIPANTS_OUT_OF_SCOPE');
    }
  });
});

describe('the settlement-facing net-obligation lifecycle (driven by area-12 instruction)', () => {
  test('CREATED -> SETTLEMENT_PENDING -> SETTLED, exactly once; a second finality is the typed refusal', async () => {
    const harness = makeHarness();
    const { netting, obligations } = harness;
    const o1 = await createObligation(obligations, 'f1', 'x', 'y', 1_000);
    const opened = await netting.openNettingSet({
      label: 'lifecycle-1',
      scope: { kind: 'BILATERAL', participants: ['x', 'y'] },
      inputObligationIds: [o1],
    });
    const setId = opened.ok ? opened.value.nettingSetId : '';
    await netting.computeNettingSet(setId);
    const committed = await netting.commitNettingSet(setId);
    expect(committed.ok).toBe(true);
    const netObligationId = committed.ok ? (committed.value.netObligations[0]?.netObligationId ?? '') : '';
    expect(netObligationId).not.toBe('');
    const pending = await netting.applyNetPositionSettlementInstruction({
      netObligationId,
      settlementInstructionId: 'instruction-1',
    });
    expect(pending.ok).toBe(true);
    if (pending.ok) {
      expect(pending.value.applied).toBe(true);
      expect(pending.value.netObligation.state).toBe('SETTLEMENT_PENDING');
    }
    // A second instruction while already SETTLEMENT_PENDING is the typed no-op.
    const second = await netting.applyNetPositionSettlementInstruction({
      netObligationId,
      settlementInstructionId: 'instruction-2',
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.applied).toBe(false);
    }
    const settled = await netting.applyNetPositionSettlementFinality({
      netObligationId,
      finalityRecordId: 'finality-1',
    });
    expect(settled.ok).toBe(true);
    expect(netting.netObligation(netObligationId)?.state).toBe('SETTLED');
    // Exactly once: the second advance is the typed ILLEGAL_TRANSITION refusal.
    const again = await netting.applyNetPositionSettlementFinality({
      netObligationId,
      finalityRecordId: 'finality-1',
    });
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.code).toBe('ILLEGAL_TRANSITION');
    }
  });

  test('an unknown net obligation is the typed NOT_FOUND refusal', async () => {
    const harness = makeHarness();
    const { netting } = harness;
    const result = await netting.applyNetPositionSettlementInstruction({
      netObligationId: 'pid.v1.missing',
      settlementInstructionId: 'instruction-x',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NET_OBLIGATION_NOT_FOUND');
    }
  });
});

describe('the INV-10-4 composition: netting never creates A10 obligations', () => {
  test('a netting commit adds ZERO creation entries to the A10 ledger (the gate holds)', async () => {
    const harness = makeHarness();
    const { netting, obligations } = harness;
    const before = obligations.obligations().length;
    const o1 = await createObligation(obligations, 'g1', 'x', 'y', 1_000);
    const o2 = await createObligation(obligations, 'g2', 'y', 'x', 400);
    const opened = await netting.openNettingSet({
      label: 'gate-1',
      scope: { kind: 'BILATERAL', participants: ['x', 'y'] },
      inputObligationIds: [o1, o2],
    });
    const setId = opened.ok ? opened.value.nettingSetId : '';
    await netting.computeNettingSet(setId);
    await netting.commitNettingSet(setId);
    // The A10 ledger holds exactly the two clearing-created obligations:
    // the net obligations live in the netting domain (the CONTRACT-REVIEW
    // interpretation), and the A10 audit still holds.
    expect(obligations.obligations().length).toBe(before + 2);
    expect(obligations.log.inv10_4Audit().holds).toBe(true);
    const netObligations = netting.netObligationsOfSet(setId);
    expect(netObligations.length).toBe(1);
    expect(netObligations[0]?.amount.amountMinor).toBe(600);
  });
});
