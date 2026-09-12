/**
 * RTN-009 — Netting Authority: the A11 named evidence set against the
 * REAL RTN-002 A15 log.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §3 Area 11,
 *   lines 199-203 (the complete named set — verbatim):
 *     "Evidence produced
 *      - NETTING_SET_OPENED (input obligation ids).
 *      - NETTING_COMPUTED (algorithm version, per-currency conservation
 *        proof).
 *      - NETTING_COMMITTED (net obligation ids created)."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15 lines
 *   26-32 (the five-slot shape), lines 62-64 (the synchronous coupling).
 *   spec/architecture/v0.1/README.md §3 GC-5 (exactly one record per
 *   consequential operation).
 */
import { describe, expect, test } from 'bun:test';
import { createEvidenceLog } from '../evidence/log.ts';
import { money } from '../kernel/money.ts';
import { NettingAuthority } from './authority.ts';
import type { NettingObligationLedgerPort } from './authority.ts';
import { ObligationLedgerAuthority } from '../obligations/authority.ts';
import type { ClearingCreationInstruction } from '../obligations/authority.ts';
import {
  NETTING_AUTHORITY_ID,
  NETTING_EVIDENCE_VOCABULARY,
} from './evidence.ts';

const EUR = (minor: number) => money('EUR', minor, 2);

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
  return { log, obligations, netting };
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
    reason: 'evidence fixture',
  } as Omit<ClearingCreationInstruction, 'kind'>);
  return outcome.obligationId;
}

describe('the A11 named evidence set (lines 199-203, to the REAL A15 log)', () => {
  test('one NETTING_SET_OPENED / NETTING_COMPUTED / NETTING_COMMITTED record per consequential operation, and nothing else from A11', async () => {
    const { log, obligations, netting } = makeHarness();
    const o1 = await createObligation(obligations, 'e1', 'x', 'y', 10_000);
    const o2 = await createObligation(obligations, 'e2', 'y', 'x', 6_000);
    const before = log.records().length;
    const opened = await netting.openNettingSet({
      label: 'evidence-1',
      scope: { kind: 'BILATERAL', participants: ['x', 'y'] },
      inputObligationIds: [o1, o2],
    });
    expect(opened.ok).toBe(true);
    const setId = opened.ok ? opened.value.nettingSetId : '';
    await netting.computeNettingSet(setId);
    const committed = await netting.commitNettingSet(setId);
    expect(committed.ok).toBe(true);
    // The re-commit no-op emits nothing (INV-11-3 + GC-5).
    await netting.commitNettingSet(setId);
    const nettingRecords = log.records().slice(before).filter(
      (record) => record.authority === NETTING_AUTHORITY_ID,
    );
    expect(nettingRecords.length).toBe(3);
    expect(nettingRecords.map((record) => record.what.operationType)).toEqual([
      'NETTING_SET_OPENED',
      'NETTING_COMPUTED',
      'NETTING_COMMITTED',
    ]);
    // NETTING_SET_OPENED "(input obligation ids)" — the ids in the subjects.
    expect(nettingRecords[0]?.what.subjectIds).toEqual([setId, o1, o2]);
    // NETTING_COMPUTED "(algorithm version, per-currency conservation proof)".
    expect(nettingRecords[1]?.outcome.result).toBe('COMPUTED.v1');
    expect(nettingRecords[1]?.proof.hashes?.length).toBe(1); // the proof hash
    // NETTING_COMMITTED "(net obligation ids created)".
    const netObligationId = committed.ok ? committed.value.netObligations[0]?.netObligationId : '';
    expect(nettingRecords[2]?.what.subjectIds).toEqual([setId, netObligationId]);
    // The whole log verifies (the hash chain holds).
    expect(log.verifyAndRecord(50_000).verdict).toBe('VERIFIED');
  });

  test('the vocabulary is exactly the three named records; rejections and no-ops emit nothing', async () => {
    expect([...NETTING_EVIDENCE_VOCABULARY]).toEqual([
      'NETTING_SET_OPENED',
      'NETTING_COMPUTED',
      'NETTING_COMMITTED',
    ]);
    const { log, obligations, netting } = makeHarness();
    const o1 = await createObligation(obligations, 'v1', 'x', 'y', 1_000);
    const before = log.records().length;
    // A rejected open (unknown obligation) emits nothing.
    const rejected = await netting.openNettingSet({
      label: 'vocab-rejected',
      scope: { kind: 'BILATERAL', participants: ['x', 'y'] },
      inputObligationIds: [o1, 'pid.v1.missing'],
    });
    expect(rejected.ok).toBe(false);
    // A rejected commit (not computed) emits nothing.
    const opened = await netting.openNettingSet({
      label: 'vocab-open',
      scope: { kind: 'BILATERAL', participants: ['x', 'y'] },
      inputObligationIds: [o1],
    });
    expect(opened.ok).toBe(true);
    const early = await netting.commitNettingSet(opened.ok ? opened.value.nettingSetId : '');
    expect(early.ok).toBe(false);
    const nettingRecords = log.records().slice(before).filter(
      (record) => record.authority === NETTING_AUTHORITY_ID,
    );
    expect(nettingRecords.length).toBe(1); // only the successful OPEN
    expect(nettingRecords[0]?.what.operationType).toBe('NETTING_SET_OPENED');
  });
});
