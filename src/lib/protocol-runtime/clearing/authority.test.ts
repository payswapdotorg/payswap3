/**
 * RTN-008 — Clearing Authority: the composed command surface — the batch
 * lifecycle, staged-contents immutability, the INV-9-1 commit gate, the
 * quarantine path (never silently dropped), the INV-9-2 sequence-order
 * and dedup guarantees, the INV-9-3 re-commit no-op, and the A09
 * upstream-UNKNOWN clearability gate.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §1 Area 9,
 *   lines 29-33 (the batch machine + "Contents are immutable after
 *   STAGED"); lines 35-40 (records; quarantine); lines 42-45 ("the only
 *   creator of obligation creation instructions"); lines 47-56
 *   (INV-9-1/9-2/9-3); lines 58-64 (the upstream-UNKNOWN gate).
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import type { EvidenceSubmission, EvidenceSubmissionRecord } from '../kernel/ports.ts';
import { ClearingAuthority } from './authority.ts';
import type {
  ObligationCreationInstruction,
  ObligationLedgerSink,
} from './authority.ts';

/**
 * The in-surface sink double: an idempotent-by-record-id obligation
 * creator (the INV-10-3 contract the real obligations authority
 * implements — mirrored here so the clearing surface is testable
 * standalone, exactly like the rails surface's evidence-test-double
 * precedent).
 */
function makeSink() {
  const created = new Map<string, string>(); // recordId -> obligationId
  let ordinal = 0;
  const instructions: ObligationCreationInstruction[] = [];
  const sink: ObligationLedgerSink = {
    async applyClearingCommand(instruction) {
      instructions.push(instruction);
      const existing = created.get(instruction.recordId);
      if (existing !== undefined) {
        return { obligationId: existing, duplicate: true };
      }
      const obligationId = `pid.v1.obligation-${++ordinal}`;
      created.set(instruction.recordId, obligationId);
      return { obligationId, duplicate: false };
    },
    hasObligation(obligationId) {
      return [...created.values()].includes(obligationId);
    },
  };
  return { sink, instructions, created };
}

function makeAuthority(options: {
  readonly clearability?: (activityId: string) => readonly string[];
  readonly failEvidenceAfter?: number;
} = {}) {
  const records: EvidenceSubmissionRecord[] = [];
  let writes = 0;
  const recorder: EvidenceSubmission = {
    submit: (record) => {
      writes += 1;
      if (options.failEvidenceAfter !== undefined && writes > options.failEvidenceAfter) {
        throw new TypeError('simulated evidence write failure');
      }
      records.push(record);
    },
  };
  const sinkHarness = makeSink();
  let wall = 5_000;
  const authority = new ClearingAuthority({
    evidence: recorder,
    sink: sinkHarness.sink,
    clearability: options.clearability ?? (() => []),
    wallClock: () => wall,
  });
  return {
    authority,
    sink: sinkHarness.sink,
    instructions: sinkHarness.instructions,
    createdCount: () => sinkHarness.created.size,
    records,
    advance: (ms: number) => {
      wall += ms;
    },
  };
}

const EUR = (minor: number) => money('EUR', minor, 2);

function recordInput(originActivityId: string, amountMinor = 1_000) {
  return {
    origin: { originActivityId, originKind: 'INTENT' as const },
    parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
    amount: EUR(amountMinor),
    reason: 'hop settlement',
  };
}

let batchCounter = 0;

async function openAndAdd(authority: ClearingAuthority, activities: string[]) {
  const opened = await authority.openBatch({ batchLabel: `batch-${++batchCounter}` });
  if (!opened.ok) {
    throw new Error('open failed');
  }
  for (const activity of activities) {
    const added = await authority.addRecord(opened.value.batchId, recordInput(activity));
    if (!added.ok) {
      throw new Error('add failed');
    }
  }
  return opened.value.batchId;
}

describe('the batch lifecycle (A09 lines 29-33)', () => {
  test('OPEN -> STAGED -> COMMITTED -> FINAL applies in order with evidence at each consequential step', async () => {
    const harness = makeAuthority();
    const batchId = await openAndAdd(harness.authority, ['activity-1']);
    const staged = await harness.authority.stageBatch(batchId);
    expect(staged.ok).toBe(true);
    if (staged.ok) {
      expect(staged.value.state).toBe('STAGED');
      expect(staged.value.recordCount).toBe(1);
      expect(staged.value.perCurrencyTotals).toBe('{"EUR":1000}');
    }
    const committed = await harness.authority.commitBatch(batchId);
    expect(committed.ok).toBe(true);
    if (committed.ok) {
      expect(committed.value.batch.state).toBe('COMMITTED');
      expect((committed.value.commit.obligationIds).length).toBe(1);
      expect(committed.value.replayed).toBe(false);
    }
    const finalized = await harness.authority.finalizeBatch(batchId);
    expect(finalized.ok).toBe(true);
    if (finalized.ok) {
      expect(finalized.value.state).toBe('FINAL');
    }
    // the sink saw exactly one instruction: "the only creator of
    // obligation creation instructions"
    expect((harness.instructions).length).toBe(1);
    expect(harness.instructions[0]?.originActivityId).toBe('activity-1');
  });

  test('the command surface refuses skipping and out-of-order machine steps', async () => {
    const harness = makeAuthority();
    const batchId = await openAndAdd(harness.authority, ['activity-1']);
    // cannot commit an OPEN batch; cannot finalize it either
    const earlyCommit = await harness.authority.commitBatch(batchId);
    expect(earlyCommit.ok).toBe(false);
    if (!earlyCommit.ok) {
      expect(earlyCommit.code).toBe('ILLEGAL_TRANSITION');
    }
    const earlyFinal = await harness.authority.finalizeBatch(batchId);
    expect(earlyFinal.ok).toBe(false);
    if (!earlyFinal.ok) {
      expect(earlyFinal.code).toBe('NOT_COMMITTED');
    }
    await harness.authority.stageBatch(batchId);
    // cannot finalize a STAGED batch
    const midFinal = await harness.authority.finalizeBatch(batchId);
    expect(midFinal.ok).toBe(false);
    if (!midFinal.ok) {
      expect(midFinal.code).toBe('NOT_COMMITTED');
    }
    await harness.authority.commitBatch(batchId);
    // cannot stage or add records to a COMMITTED batch
    const lateStage = await harness.authority.stageBatch(batchId);
    expect(lateStage.ok).toBe(false);
    const lateAdd = await harness.authority.addRecord(batchId, recordInput('activity-2'));
    expect(lateAdd.ok).toBe(false);
    if (!lateAdd.ok) {
      expect(lateAdd.code).toBe('BATCH_NOT_OPEN');
    }
    await harness.authority.finalizeBatch(batchId);
    const postFinal = await harness.authority.finalizeBatch(batchId);
    expect(postFinal.ok).toBe(false);
    if (!postFinal.ok) {
      expect(postFinal.code).toBe('ALREADY_FINAL');
    }
  });

  test('a re-opened batch label is refused (batch ids are derived from labels)', async () => {
    const harness = makeAuthority();
    await harness.authority.openBatch({ batchLabel: 'cycle-1' });
    const second = await harness.authority.openBatch({ batchLabel: 'cycle-1' });
    expect(second.ok).toBe(false);
  });
});

describe('staged-batch immutability (A09 line 31: "Contents are immutable after STAGED")', () => {
  test('addRecord is refused once the batch is STAGED (typed BATCH_NOT_OPEN)', async () => {
    const harness = makeAuthority();
    const batchId = await openAndAdd(harness.authority, ['activity-1']);
    await harness.authority.stageBatch(batchId);
    const refused = await harness.authority.addRecord(batchId, recordInput('activity-2'));
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe('BATCH_NOT_OPEN');
      expect(refused.message).toContain('immutable after STAGED');
    }
  });

  test('staged records are deep-frozen: mutation attempts throw (the value-layer machine check)', async () => {
    const harness = makeAuthority();
    const batchId = await openAndAdd(harness.authority, ['activity-1']);
    await harness.authority.stageBatch(batchId);
    const stagedRecord = harness.authority.batchRecords(batchId)[0] as never as Record<string, unknown>;
    expect(() => {
      (stagedRecord as { amount?: { amountMinor?: number } }).amount!.amountMinor = 999_999;
    }).toThrow();
    // batch contents snapshot is frozen too
    const snapshot = harness.authority.batchRecords(batchId);
    expect(() => {
      (snapshot as unknown as unknown[]).push({} as never);
    }).toThrow();
  });
});

describe('the INV-9-1 commit gate and the quarantine path (lines 48-51, 35-40)', () => {
  test('a quarantined record blocks the commit (typed RECORDS_QUARANTINED) — never proceeds with a failed record', async () => {
    const harness = makeAuthority();
    const opened = await harness.authority.openBatch({ batchLabel: 'mixed-batch' });
    const batchId = opened.ok ? opened.value.batchId : '';
    await harness.authority.addRecord(batchId, recordInput('activity-1'));
    await harness.authority.addRecord(batchId, { ...recordInput('activity-2'), amount: EUR(0) });
    const staged = await harness.authority.stageBatch(batchId);
    expect(staged.ok).toBe(true);
    // activity-2 carries a zero amount — it must be QUARANTINED
    const quarantined = harness.authority.quarantinedRecords(batchId);
    expect((quarantined).length).toBe(1);
    expect(quarantined[0]?.quarantineReason).toBe('ZERO_AMOUNT');
    // and the commit is REFUSED
    const commit = await harness.authority.commitBatch(batchId);
    expect(commit.ok).toBe(false);
    if (!commit.ok) {
      expect(commit.code).toBe('RECORDS_QUARANTINED');
    }
    // no obligation was created ("Quarantined records never produce
    // obligations")
    expect((harness.instructions).length).toBe(0);
  });

  test('the quarantine path never silently drops records: quarantined rows stay in the immutable contents', async () => {
    const harness = makeAuthority();
    const opened = await harness.authority.openBatch({ batchLabel: 'quarantine-batch' });
    const batchId = opened.ok ? opened.value.batchId : '';
    await harness.authority.addRecord(batchId, recordInput('activity-1'));
    const zeroRecord = recordInput('activity-2');
    await harness.authority.addRecord(batchId, { ...zeroRecord, amount: EUR(0) });
    await harness.authority.stageBatch(batchId);
    // BOTH records remain in the batch contents — one staged, one
    // quarantined with its reason code
    const records = harness.authority.batchRecords(batchId);
    expect((records).length).toBe(2);
    expect(records.map((record) => record.state).sort()).toEqual(['QUARANTINED', 'STAGED']);
    expect(harness.authority.quarantinedRecords(batchId)[0]?.origin.originActivityId).toBe('activity-2');
  });

  test('staging is resumable: a failed evidence write leaves already-transitioned records intact', async () => {
    // the write that fails is the SECOND one (the first RECORD_QUARANTINED
    // succeeds, then BATCH_STAGED fails)
    const harness = makeAuthority({ failEvidenceAfter: 1 });
    const opened = await harness.authority.openBatch({ batchLabel: 'resumable' });
    const batchId = opened.ok ? opened.value.batchId : '';
    await harness.authority.addRecord(batchId, { ...recordInput('activity-1'), amount: EUR(0) });
    let threw = false;
    try {
      await harness.authority.stageBatch(batchId);
    } catch (error) {
      threw = error instanceof Error && error.message.includes('simulated evidence write failure');
    }
    expect(threw).toBe(true);
    // the record's quarantine DID commit (its evidence was written first
    // — A15 lines 62-64); the batch is still OPEN
    expect(harness.authority.batchRecords(batchId)[0]?.state).toBe('QUARANTINED');
    expect(harness.authority.batch(batchId)?.state).toBe('OPEN');
  });
});

describe('INV-9-2: batches processed in sequence order (lines 52-54)', () => {
  test('batches receive strictly increasing sequence positions', async () => {
    const harness = makeAuthority();
    const a = await harness.authority.openBatch({ batchLabel: 'a' });
    const b = await harness.authority.openBatch({ batchLabel: 'b' });
    const c = await harness.authority.openBatch({ batchLabel: 'c' });
    expect(a.ok && b.ok && c.ok).toBe(true);
    expect(
      (a.ok ? a.value.sequence : -1) < (b.ok ? b.value.sequence : -1) &&
        (b.ok ? b.value.sequence : -1) < (c.ok ? c.value.sequence : -1),
    ).toBe(true);
  });

  test('a later batch cannot stage before an earlier batch stages', async () => {
    const harness = makeAuthority();
    const a = await harness.authority.openBatch({ batchLabel: 'a' });
    const b = await harness.authority.openBatch({ batchLabel: 'b' });
    const aId = a.ok ? a.value.batchId : '';
    const bId = b.ok ? b.value.batchId : '';
    const earlyStage = await harness.authority.stageBatch(bId);
    expect(earlyStage.ok).toBe(false);
    if (!earlyStage.ok) {
      expect(earlyStage.code).toBe('BATCH_SEQUENCE_ORDER');
    }
    await harness.authority.stageBatch(aId);
    const nowStage = await harness.authority.stageBatch(bId);
    expect(nowStage.ok).toBe(true);
  });

  test('batches are processed (staged) in sequence order; commits and finals follow their own machines', async () => {
    const harness = makeAuthority();
    const aId = await openAndAdd(harness.authority, ['activity-1']);
    const bId = await openAndAdd(harness.authority, ['activity-2']);
    // b cannot STAGE while a is still OPEN (unprocessed)
    const earlyStage = await harness.authority.stageBatch(bId);
    expect(earlyStage.ok).toBe(false);
    if (!earlyStage.ok) {
      expect(earlyStage.code).toBe('BATCH_SEQUENCE_ORDER');
    }
    await harness.authority.stageBatch(aId);
    const nowStage = await harness.authority.stageBatch(bId);
    expect(nowStage.ok).toBe(true);
    // with both processed, the state machines govern: either may commit
    const commitB = await harness.authority.commitBatch(bId);
    expect(commitB.ok).toBe(true);
    const commitA = await harness.authority.commitBatch(aId);
    expect(commitA.ok).toBe(true);
    await harness.authority.finalizeBatch(aId);
    await harness.authority.finalizeBatch(bId);
    expect(harness.authority.sequenceInvariant()).toBe(true);
  });

  test('the processing-order invariant holds across a full multi-batch journey', async () => {
    const harness = makeAuthority();
    const aId = await openAndAdd(harness.authority, ['activity-1']);
    const bId = await openAndAdd(harness.authority, ['activity-2']);
    expect(harness.authority.sequenceInvariant()).toBe(true);
    await harness.authority.stageBatch(aId);
    expect(harness.authority.sequenceInvariant()).toBe(true);
    await harness.authority.stageBatch(bId);
    expect(harness.authority.sequenceInvariant()).toBe(true);
    await harness.authority.commitBatch(aId);
    await harness.authority.commitBatch(bId);
    await harness.authority.finalizeBatch(aId);
    await harness.authority.finalizeBatch(bId);
    expect(harness.authority.sequenceInvariant()).toBe(true);
    expect(
      (harness.authority.batch(aId)?.sequence ?? 0) < (harness.authority.batch(bId)?.sequence ?? 0),
    ).toBe(true);
  });

  test('a stuck (quarantined) batch does NOT deadlock the pipeline — the disposition is out of band', async () => {
    const harness = makeAuthority();
    const opened = await harness.authority.openBatch({ batchLabel: 'stuck' });
    const stuckId = opened.ok ? opened.value.batchId : '';
    await harness.authority.addRecord(stuckId, { ...recordInput('bad-activity'), amount: EUR(0) });
    await harness.authority.stageBatch(stuckId);
    expect((harness.authority.quarantinedRecords(stuckId)).length).toBe(1);
    // the stuck batch can never commit (INV-9-1) ...
    const stuckCommit = await harness.authority.commitBatch(stuckId);
    expect(stuckCommit.ok).toBe(false);
    // ... but a NEW batch (the out-of-band disposition path) processes
    // and commits past it
    const freshId = await openAndAdd(harness.authority, ['good-activity']);
    const staged = await harness.authority.stageBatch(freshId);
    expect(staged.ok).toBe(true);
    const commit = await harness.authority.commitBatch(freshId);
    expect(commit.ok).toBe(true);
    if (commit.ok) {
      expect((commit.value.commit.obligationIds).length).toBe(1);
    }
    expect(harness.authority.sequenceInvariant()).toBe(true);
  });
});

describe('INV-9-2/INV-10-3: dedup by origin activity id (lines 52-54)', () => {
  test('a duplicate origin activity within one batch produces exactly one obligation (the duplicate is a reported no-op)', async () => {
    const harness = makeAuthority();
    const batchId = await openAndAdd(harness.authority, ['activity-1', 'activity-1']);
    await harness.authority.stageBatch(batchId);
    const commit = await harness.authority.commitBatch(batchId);
    expect(commit.ok).toBe(true);
    if (commit.ok) {
      expect((commit.value.commit.obligationIds).length).toBe(1);
      expect(commit.value.commit.duplicateOriginActivityIds).toEqual(['activity-1']);
    }
  });

  test('a duplicate origin activity across batches produces exactly one obligation (the second batch reports the duplicate)', async () => {
    const harness = makeAuthority();
    const first = await openAndAdd(harness.authority, ['activity-1']);
    await harness.authority.stageBatch(first);
    await harness.authority.commitBatch(first);
    await harness.authority.finalizeBatch(first);
    const second = await openAndAdd(harness.authority, ['activity-1']);
    await harness.authority.stageBatch(second);
    const commit = await harness.authority.commitBatch(second);
    expect(commit.ok).toBe(true);
    if (commit.ok) {
      // "a committed batch produces each obligation exactly once" — the
      // second commit creates nothing new; the sink no-ops the duplicate
      // (INV-10-3) and the commit reports it.
      expect(commit.value.commit.duplicateOriginActivityIds).toEqual(['activity-1']);
      expect(harness.createdCount()).toBe(1);
    }
  });
});

describe('INV-9-3: re-commit of the same batch id is a no-op returning the recorded result (lines 55-56)', () => {
  test('re-commit returns the recorded result with no second financial effect and no second evidence record', async () => {
    const harness = makeAuthority();
    const batchId = await openAndAdd(harness.authority, ['activity-1']);
    await harness.authority.stageBatch(batchId);
    const first = await harness.authority.commitBatch(batchId);
    expect(first.ok).toBe(true);
    const evidenceAfterFirst = harness.records.length;
    const replay = await harness.authority.commitBatch(batchId);
    expect(replay.ok).toBe(true);
    if (first.ok && replay.ok) {
      // the recorded result — identical obligation ids and idempotency
      // key — with the replay marker
      expect(replay.value.replayed).toBe(true);
      expect(replay.value.commit.obligationIds).toEqual(first.value.commit.obligationIds);
      expect(replay.value.commit.idempotencyKey).toBe(first.value.commit.idempotencyKey);
      expect(replay.value.commit.committedAt).toBe(first.value.commit.committedAt);
    }
    // no second instruction reached the sink and no second
    // BATCH_COMMITTED record was written
    expect((harness.instructions).length).toBe(1);
    expect(harness.records.length).toBe(evidenceAfterFirst);
    // re-commit of a FINAL batch also returns the recorded result
    await harness.authority.finalizeBatch(batchId);
    const afterFinal = await harness.authority.commitBatch(batchId);
    expect(afterFinal.ok).toBe(true);
    if (afterFinal.ok) {
      expect(afterFinal.value.replayed).toBe(true);
    }
  });
});

describe('the A09 upstream-UNKNOWN clearability gate (lines 58-64)', () => {
  test('a record whose activity has an unresolved UNKNOWN rail operation is QUARANTINED with UPSTREAM_UNRESOLVED_UNKNOWN', async () => {
    const harness = makeAuthority({
      clearability: (activityId) =>
        activityId === 'activity-unknown' ? ['rail-op-unknown-1'] : [],
    });
    const batchId = await openAndAdd(harness.authority, ['activity-unknown']);
    await harness.authority.stageBatch(batchId);
    const quarantined = harness.authority.quarantinedRecords(batchId);
    expect((quarantined).length).toBe(1);
    expect(quarantined[0]?.quarantineReason).toBe('UPSTREAM_UNRESOLVED_UNKNOWN');
    // the batch cannot commit — the activity is not clearable
    const commit = await harness.authority.commitBatch(batchId);
    expect(commit.ok).toBe(false);
  });

  test('after the UNKNOWN resolves, the dispositioned record clears in a NEW batch (the out-of-band disposition)', async () => {
    let resolved = false;
    const harness = makeAuthority({
      clearability: (activityId) =>
        activityId === 'activity-unknown' && !resolved ? ['rail-op-unknown-1'] : [],
    });
    const stuckBatch = await openAndAdd(harness.authority, ['activity-unknown']);
    await harness.authority.stageBatch(stuckBatch);
    expect((harness.authority.quarantinedRecords(stuckBatch)).length).toBe(1);
    // area 14 resolves the UNKNOWN (the case-model integration):
    resolved = true;
    const freshBatch = await openAndAdd(harness.authority, ['activity-unknown']);
    await harness.authority.stageBatch(freshBatch);
    expect((harness.authority.quarantinedRecords(freshBatch)).length).toBe(0);
    const commit = await harness.authority.commitBatch(freshBatch);
    expect(commit.ok).toBe(true);
    if (commit.ok) {
      expect((commit.value.commit.obligationIds).length).toBe(1);
    }
  });
});

describe('the FINAL hand-off proof (A09 lines 30-33)', () => {
  test('finalize verifies every produced obligation exists in the ledger (OBLIGATION_LEDGER_MISMATCH on a gap)', async () => {
    const harness = makeAuthority();
    const batchId = await openAndAdd(harness.authority, ['activity-1', 'activity-2']);
    await harness.authority.stageBatch(batchId);
    await harness.authority.commitBatch(batchId);
    // sabotage the sink: pretend an obligation vanished (corruption)
    const sabotage = harness.sink as { hasObligation?: (id: string) => boolean };
    const original = sabotage.hasObligation?.bind(harness.sink);
    sabotage.hasObligation = (id: string) => {
      return original ? original(id) && id.endsWith('1') : false;
    };
    const finalize = await harness.authority.finalizeBatch(batchId);
    expect(finalize.ok).toBe(false);
    if (!finalize.ok) {
      expect(finalize.code).toBe('OBLIGATION_LEDGER_MISMATCH');
    }
  });
});
