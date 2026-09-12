/**
 * RTN-008 — the composed clearing -> obligations journey and the
 * injectable UNKNOWN-hold semantics.
 *
 * The REAL rails case-model composition (the A09 clearability gate and
 * the A10 settlement hold wired to the RTN-004 RailsStore,
 * ReconciliationAuthority, and SimulatedRail) runs in the plain-Node
 * harness scripts/test_protocol_clearing_obligations.mjs — the same
 * split the sibling domains observe (Bun does not implement
 * node:sqlite, so store-backed composition is node-harness territory;
 * the bun suites cover the pure modules and the in-process authorities,
 * including the hold semantics through the injectable probes).
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §1 Area 9
 *   lines 42-45 ("Clearing Authority ... is the only creator of
 *   obligation creation instructions"); §2 Area 10 lines 119-121
 *   (INV-10-3 — "obligation creation from clearing is keyed by origin
 *   record id; duplicate instructions are no-ops"); lines 125-131 (the
 *   UNKNOWN-settlement hold: "the obligation remains in SETTLEMENT_
 *   PENDING unchanged until reconciliation resolves the rail operation
 *   (GC-2); finality then advances or fails the obligation exactly
 *   once").
 *   spec/architecture/v0.1/README.md §3 GC-2/GC-4.
 */
import { describe, expect, test } from 'bun:test';
import { createEvidenceLog } from '../evidence/log.ts';
import { money } from '../kernel/money.ts';
import { ClearingAuthority } from '../clearing/authority.ts';
import type { ObligationLedgerSink } from '../clearing/authority.ts';
import { ObligationLedgerAuthority } from './authority.ts';

function makeComposedHarness() {
  const log = createEvidenceLog({ wallMs: 1_000 });
  let wall = 5_000;
  const clock = () => wall;
  const obligations = new ObligationLedgerAuthority({
    evidence: log,
    wallClock: clock,
  });
  const authority = new ClearingAuthority({
    evidence: log,
    sink: obligations as unknown as ObligationLedgerSink,
    wallClock: clock,
  });
  return {
    log,
    obligations,
    authority,
    advance: (ms: number) => {
      wall += ms;
    },
    wall: () => wall,
  };
}

const EUR = (minor: number) => money('EUR', minor, 2);

describe('the composed clearing -> obligations journey (GC-4: one financial truth)', () => {
  test('a batch commit creates the obligations in the REAL ledger; the batch FINALizes against them', async () => {
    const harness = makeComposedHarness();
    const { authority, obligations, log } = harness;
    const opened = await authority.openBatch({ batchLabel: 'composed-1' });
    const batchId = opened.ok ? opened.value.batchId : '';
    await authority.addRecord(batchId, {
      origin: { originActivityId: 'activity-1', originKind: 'INTENT' },
      parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
      amount: EUR(1_500),
      reason: 'hop settlement',
    });
    await authority.addRecord(batchId, {
      origin: { originActivityId: 'activity-2', originKind: 'ROUTE_PLAN_HOP' },
      parties: { debtorParticipantId: 'participant-b', creditorParticipantId: 'participant-c' },
      amount: EUR(700),
      reason: 'hop settlement',
    });
    const staged = await authority.stageBatch(batchId);
    expect(staged.ok).toBe(true);
    const committed = await authority.commitBatch(batchId);
    expect(committed.ok).toBe(true);
    if (committed.ok) {
      expect((committed.value.commit.obligationIds).length).toBe(2);
      // the obligations exist in the REAL ledger with the exact terms
      for (const obligationId of committed.value.commit.obligationIds) {
        const obligation = obligations.obligation(obligationId);
        expect(obligation !== undefined).toBe(true);
        expect(obligation?.state).toBe('CREATED');
        expect(obligation?.terms.amount.currency).toBe('EUR');
        expect(obligation?.origin.kind).toBe('CLEARING');
      }
    }
    const finalized = await authority.finalizeBatch(batchId);
    expect(finalized.ok).toBe(true);
    // the single evidence log carries BOTH authorities' records (GC-5)
    const authorities = new Set(log.records().map((record) => record.authority));
    expect(authorities.has('Clearing Authority')).toBe(true);
    expect(authorities.has('Obligation Authority')).toBe(true);
    expect(log.verifyAndRecord(harness.wall()).verdict).toBe("VERIFIED");
  });

  test('the dedup is end-to-end: re-submitting the same origin across batches yields ONE obligation', async () => {
    const { authority, obligations } = makeComposedHarness();
    const first = await authority.openBatch({ batchLabel: 'dedup-1' });
    const firstId = first.ok ? first.value.batchId : '';
    await authority.addRecord(firstId, {
      origin: { originActivityId: 'activity-dup', originKind: 'INTENT' },
      parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
      amount: EUR(500),
      reason: 'hop settlement',
    });
    await authority.stageBatch(firstId);
    await authority.commitBatch(firstId);
    await authority.finalizeBatch(firstId);
    const second = await authority.openBatch({ batchLabel: 'dedup-2' });
    const secondId = second.ok ? second.value.batchId : '';
    await authority.addRecord(secondId, {
      origin: { originActivityId: 'activity-dup', originKind: 'INTENT' },
      parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
      amount: EUR(500),
      reason: 'hop settlement',
    });
    await authority.stageBatch(secondId);
    const commit = await authority.commitBatch(secondId);
    expect(commit.ok).toBe(true);
    if (commit.ok) {
      expect((commit.value.commit.obligationIds).length).toBe(0); // nothing new
      expect(commit.value.commit.duplicateOriginActivityIds).toEqual(['activity-dup']);
    }
    expect((obligations.obligations()).length).toBe(1); // ONE obligation total
  });

  test('the correction path composes: the adjustment record creates the linked replacement and the prior is CANCELLED', async () => {
    const { authority, obligations } = makeComposedHarness();
    // the original obligation
    const original = await authority.openBatch({ batchLabel: 'original' });
    const originalId = original.ok ? original.value.batchId : '';
    await authority.addRecord(originalId, {
      origin: { originActivityId: 'activity-original', originKind: 'INTENT' },
      parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
      amount: EUR(1_000),
      reason: 'hop settlement',
    });
    await authority.stageBatch(originalId);
    const committed = await authority.commitBatch(originalId);
    expect(committed.ok).toBe(true);
    const priorObligationId = committed.ok ? committed.value.commit.obligationIds[0] ?? '' : '';
    await authority.finalizeBatch(originalId);
    // the correction batch: the adjustment record references the prior
    const correction = await authority.openBatch({ batchLabel: 'correction' });
    const correctionId = correction.ok ? correction.value.batchId : '';
    await authority.addRecord(correctionId, {
      origin: { originActivityId: 'adjustment-case-7', originKind: 'RECONCILIATION_ADJUSTMENT' },
      parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
      amount: EUR(900),
      reason: 'reconciliation adjustment: corrected amount',
      correctionOf: priorObligationId,
    });
    await authority.stageBatch(correctionId);
    const corrected = await authority.commitBatch(correctionId);
    expect(corrected.ok).toBe(true);
    const replacementObligationId = corrected.ok
      ? corrected.value.commit.obligationIds[0] ?? ''
      : '';
    // INV-10-1: the correction is a NEW linked obligation
    const replacement = obligations.obligation(replacementObligationId);
    expect(replacement?.linkedPriorObligationId).toBe(priorObligationId);
    expect(replacement?.terms.amount.amountMinor).toBe(900);
    // the prior obligation is CANCELLED with mandatory evidence
    const cancelled = await obligations.applyClearingCorrectionCancel({
      kind: 'CLEARING_CORRECTION_CANCEL',
      obligationId: priorObligationId,
      replacementObligationId,
      evidenceReference: 'case-7',
    });
    expect(cancelled.ok).toBe(true);
    expect(obligations.obligation(priorObligationId)?.state).toBe('CANCELLED');
    expect(obligations.obligation(replacementObligationId)?.state).toBe('CREATED');
    expect(obligations.log.inv10_4Audit().holds).toBe(true);
  });
});
