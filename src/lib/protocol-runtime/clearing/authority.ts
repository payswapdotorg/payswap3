/**
 * RTN-008 — Clearing Authority: the composed single-writer command
 * surface for area 9 (A09).
 *
 * Spec sources (binding) — spec/architecture/v0.1/
 * clearing-netting-settlement.md §1 Area 9:
 *   lines 18-25 (Purpose — "Convert completed fulfillment activity into
 *     ledger-ready records ... obligations are created exactly once.
 *     Clearing is deterministic batch processing, not money movement.").
 *   lines 29-33 (ClearingBatch, verbatim):
 *     "ClearingBatch — unit of staged processing.
 *      States: OPEN -> STAGED -> COMMITTED -> FINAL.
 *      Contents are immutable after STAGED. COMMITTED means obligations
 *      have been created; FINAL means all produced obligations are handed
 *      to the obligation ledger."
 *   lines 35-40 (ClearingRecord — ACCEPTED -> STAGED | QUARANTINED;
 *     quarantined records never produce obligations; never dropped).
 *   lines 42-45 (Owning authority):
 *     "Clearing Authority (protocol layer, area 9) owns batch and record
 *      state, and is the only creator of obligation creation
 *      instructions."
 *   lines 47-56 (the three invariants, enforced here):
 *     "INV-9-1 (financial correctness): amounts are integer Money;
 *      staging performs per-currency integer summation checks; a batch is
 *      committed only if every included record passes validation."
 *     "INV-9-2 (concurrency): batches are processed in sequence order;
 *      record deduplication keys (origin activity id) guarantee a
 *      committed batch produces each obligation exactly once."
 *     "INV-9-3 (idempotency): re-committing the same batch id is a no-op
 *      returning the recorded result."
 *   lines 58-64 (failure and UNKNOWN semantics, verbatim):
 *     "Clearing is internal and deterministic. Invalid records are
 *      quarantined, never dropped. Because clearing consumes only
 *      protocol-internal activity records, it has no UNKNOWN state; any
 *      upstream UNKNOWN (rail operations during fulfillment) must already
 *      be resolved by area 14 before the activity becomes clearable."
 *   lines 66-70 (evidence produced); lines 72-78 (boundaries).
 *   spec/architecture/v0.1/README.md §3 GC-1/GC-2/GC-4/GC-5.
 *
 * Command discipline:
 *   - EVERY batch-mutating command runs under ONE global serializer key
 *     (the pipeline key): INV-9-2's "batches are processed in sequence
 *     order" is the rank-monotonicity gate — an earlier-sequence batch is
 *     never less advanced than a later-sequence one (batchStateRank); the
 *     gate is machine-checkable (sequenceInvariant()).
 *   - Records are accepted only while the batch is OPEN ("Contents are
 *     immutable after STAGED" — addRecord on a STAGED/COMMITTED/FINAL
 *     batch is the typed BATCH_NOT_OPEN rejection; records and the record
 *     list are deep-frozen at stage time).
 *   - Staging (OPEN -> STAGED) is RESUMABLE: each record's
 *     ACCEPTED -> STAGED | QUARANTINED transition is computed, evidenced
 *     (RECORD_QUARANTINED first, awaited), and committed per record; a
 *     failed evidence write fails the staging pass with the already-
 *     transitioned records retaining their states (idempotent re-stage
 *     skips them). The pass ends with the batch-level INV-9-1 summation
 *     and the BATCH_STAGED record (awaited) before the batch state
 *     commits — "an operation is not committed until its record is
 *     written. A failed write fails the operation" (A15 lines 62-64).
 *   - Commit (STAGED -> COMMITTED) applies the batch's obligation
 *     creation instructions to the ObligationLedgerSink in stored record
 *     order ("the only creator of obligation creation instructions");
 *     duplicate instructions are ledger no-ops (INV-10-3) reported in the
 *     commit result (INV-9-2's exactly-once). A batch with ANY quarantined
 *     record is REFUSED (INV-9-1's "a batch is committed only if every
 *     included record passes validation" — the work order's stop
 *     condition "batch commit that can proceed with a failed record").
 *     Re-commit of a COMMITTED/FINAL batch returns the recorded commit
 *     result (INV-9-3 no-op; no second BATCH_COMMITTED record).
 *   - Finalize (COMMITTED -> FINAL) is the hand-off acknowledgment:
 *     every produced obligation id must exist in the ledger ("all
 *     produced obligations are handed to the obligation ledger"); a
 *     missing id is the typed OBLIGATION_LEDGER_MISMATCH rejection (the
 *     failure is loud, never silent). Emits no evidence record (the A09
 *     named set is exhaustive and has no BATCH_FINAL member — recorded
 *     interpretation; the obligations' creation is the ledger's own
 *     evidenced fact).
 *   - Domain rejections are typed values, never thrown; input-shape
 *     violations throw TypeError (kernel convention).
 *
 * State layer (recorded in CONTRACT-REVIEW.md): in-process single writer —
 * the RTN-002/RTN-005/RTN-007 in-process-object-store precedent. The
 * durable side is persistence.ts + migrations/.
 */

import type { Money } from '../kernel/money.ts';
import type { EvidenceSubmission } from '../kernel/ports.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { deepFreeze } from './freeze.ts';
import {
  batchCommittedEvidence,
  batchStagedEvidence,
  recordQuarantinedEvidence,
  submitClearingEvidence,
} from './evidence.ts';
import { KeyedSerializer } from './serializer.ts';
import {
  batchCommitIdempotencyKey,
  canonicalTotalsJson,
  clearingBatchId,
  clearingRecordId,
  hashStagedContents,
  stagedPerCurrencyTotals,
  totalsToMap,
  validateClearingRecord,
} from './summation.ts';
import { transitionBatch, transitionRecord } from './state-machine.ts';
import type {
  BatchCommitResult,
  ClearingBatchRecord,
  ClearingCommandResult,
  ClearingOriginKind,
  ClearingOriginReference,
  ClearingParties,
  ClearingRecord,
} from './types.ts';
import { batchStateRank, isClearingOriginKind } from './types.ts';

/**
 * One obligation creation instruction — the Clearing Authority's ONLY
 * product toward area 10 ("the only creator of obligation creation
 * instructions"). The instruction shape is the clearing-owned half of the
 * clearing/obligations contract: the Obligation Ledger Authority's
 * applyClearingCommand structurally implements the sink (the obligations
 * module is the sibling surface of the SAME work order — direct
 * composition, no unmerged-sibling violation).
 *
 * `correctionOf` carries the prior obligation id for correction records
 * (origin kind RECONCILIATION_ADJUSTMENT) — INV-10-1's "corrections are
 * new linked obligations" and area 14's "new linked obligations created
 * via area 9/10 paths" (rails-adapters-reconciliation.md lines 177-179).
 *
 * Source: clearing-netting-settlement.md lines 42-45, 35-40;
 * rails-adapters-reconciliation.md lines 175-179.
 */
export interface ObligationCreationInstruction {
  readonly batchId: string;
  readonly recordId: string;
  readonly originActivityId: string;
  readonly originKind: ClearingOriginKind;
  readonly debtorParticipantId: string;
  readonly creditorParticipantId: string;
  readonly amount: Money;
  readonly reason: string;
  /** The prior obligation this record corrects (correction records). */
  readonly correctionOf?: string;
}

/**
 * The outcome of one obligation creation instruction: the obligation id
 * the ledger recorded, and whether the instruction was a duplicate no-op
 * (INV-10-3 — "duplicate instructions are no-ops"; INV-9-2 — "a
 * committed batch produces each obligation exactly once").
 *
 * Source: clearing-netting-settlement.md lines 52-54, 119-121.
 */
export interface ObligationCreationOutcome {
  readonly obligationId: string;
  readonly duplicate: boolean;
}

/**
 * The ObligationLedgerSink — the area-10 consumption contract the
 * Clearing Authority depends on. The Obligation Ledger Authority
 * (obligations/authority.ts) structurally satisfies this interface.
 *
 * Source: clearing-netting-settlement.md lines 42-45 ("the only creator
 * of obligation creation instructions" — the instructions flow to area
 * 10), lines 77-78 ("Depends on ... area 10 for obligation creation").
 */
export interface ObligationLedgerSink {
  /** Apply one obligation creation instruction (INV-10-3 idempotent). */
  applyClearingCommand(instruction: ObligationCreationInstruction): Promise<ObligationCreationOutcome>;
  /** Does the ledger hold this obligation id (the FINAL hand-off proof)? */
  hasObligation(obligationId: string): boolean;
}

/**
 * The upstream-UNKNOWN clearability gate: for one origin activity, the
 * ids of rail operations still in UNKNOWN state ("any upstream UNKNOWN
 * (rail operations during fulfillment) must already be resolved by area
 * 14 before the activity becomes clearable"). The composition root wires
 * the real rails-store query (RTN-012); the default resolves to none.
 *
 * Source: clearing-netting-settlement.md lines 58-64; README.md §3 GC-2.
 */
export type ClearabilityProbe = (originActivityId: string) => readonly string[];

/**
 * Constructor dependencies for the Clearing Authority.
 *
 * Source: the wave evidence discipline (the REAL RTN-002 log through the
 * kernel port); the area-10 sink (this work order's sibling surface); the
 * A09 clearability gate; the wallClock-injection convention for
 * deterministic tests.
 */
export interface ClearingAuthorityDeps {
  /** The EvidenceSubmission port — the real RTN-002 EvidenceLog. */
  readonly evidence: EvidenceSubmission;
  /** The area-10 obligation ledger sink. */
  readonly sink: ObligationLedgerSink;
  /** The upstream-UNKNOWN clearability probe (default: no UNKNOWNs). */
  readonly clearability?: ClearabilityProbe;
  /** Injectable wall clock (epoch ms) for deterministic tests; default Date.now. */
  readonly wallClock?: () => number;
}

const PIPELINE_KEY = 'clearing.pipeline';

/**
 * The submitted economic event (the addRecord command's input): origin
 * reference, parties, Money amount, reason, and — for correction records
 * — the prior obligation being corrected.
 *
 * Source: clearing-netting-settlement.md lines 35-37; lines 175-179 of
 * rails-adapters-reconciliation.md (the correction path).
 */
export interface ClearingRecordInput {
  readonly origin: ClearingOriginReference;
  readonly parties: ClearingParties;
  readonly amount: Money;
  readonly reason: string;
  readonly correctionOf?: string;
}

/**
 * The Clearing Authority: batch and record state, the INV-9-1/9-2/9-3
 * gates, and the only creator of obligation creation instructions.
 *
 * Source: clearing-netting-settlement.md lines 42-45 (Owning authority);
 * lines 47-56 (the invariants).
 */
export class ClearingAuthority {
  private readonly evidence: EvidenceSubmission;
  private readonly sink: ObligationLedgerSink;
  private readonly clearability: ClearabilityProbe;
  private readonly wallClock: () => number;
  private readonly pipeline = new KeyedSerializer();
  private readonly batches = new Map<string, ClearingBatchRecord>();
  private readonly batchOrder: string[] = [];
  private readonly records = new Map<string, ClearingRecord[]>();
  /** Batch labels already used — the INV-9-3 batch-id key space. */
  private readonly usedLabels = new Set<string>();
  private nextBatchSequence = 0;
  private nextProtocolSequence = 0;

  constructor(deps: ClearingAuthorityDeps) {
    this.evidence = deps.evidence;
    this.sink = deps.sink;
    this.clearability = deps.clearability ?? (() => []);
    this.wallClock = deps.wallClock ?? (() => Date.now());
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private now(): ProtocolTime {
    return protocolTime(this.nextProtocolSequence++, this.wallClock());
  }

  private requireBatch(batchId: string): ClearingBatchRecord {
    const batch = this.batches.get(batchId);
    if (batch === undefined) {
      throw new TypeError(`clearing authority: batch ${batchId} not found`);
    }
    return batch;
  }

  private setBatch(batch: ClearingBatchRecord): void {
    this.batches.set(batch.batchId, deepFreeze({ ...batch }));
  }

  private setRecords(batchId: string, records: readonly ClearingRecord[]): void {
    this.records.set(batchId, deepFreeze([...records]) as ClearingRecord[]);
  }

  /**
   * The INV-9-2 sequence-order gate: every batch with a lower sequence
   * must have been PROCESSED (left OPEN — staged into ledger-ready
   * records) before this batch advances. Interpretation (recorded in
   * CONTRACT-REVIEW.md): "batches are processed in sequence order" is the
   * PROCESSING (staging) order — the deterministic pass that converts
   * activities into ledger-ready records, after which contents freeze.
   * The full-lifecycle rank-monotonicity reading is REJECTED because it
   * deadlocks: a STAGED batch holding quarantined records is absorbing
   * (the frozen machine has no disposition edge) and INV-9-1 forbids its
   * commit, so a strict rank gate would freeze the pipeline forever on
   * one bad record — contradicting "they await manual or automated
   * disposition" (the disposition is out of band, in new batches, and
   * the pipeline must continue).
   *
   * Source: clearing-netting-settlement.md lines 52-54, 37-40, 48-51.
   */
  private sequenceGate(
    batch: ClearingBatchRecord,
  ): { readonly ok: true } | { readonly ok: false; readonly blockerId: string } {
    for (const otherId of this.batchOrder) {
      const other = this.batches.get(otherId);
      if (other === undefined || other.sequence >= batch.sequence) {
        continue;
      }
      if (batchStateRank(other.state) < 1) {
        return { ok: false, blockerId: other.batchId };
      }
    }
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Read surface
  // -------------------------------------------------------------------------

  /** The batch record by id (typed rejection if unknown). */
  batch(batchId: string): ClearingBatchRecord | undefined {
    const batch = this.batches.get(batchId);
    return batch === undefined ? undefined : batch;
  }

  /** The batch's records in stored order (frozen snapshot). */
  batchRecords(batchId: string): readonly ClearingRecord[] {
    return this.records.get(batchId) ?? [];
  }

  /**
   * The INV-9-2 machine check: the PROCESSING order is the sequence
   * order — no batch is past OPEN (staged/committed/final) while an
   * earlier-sequence batch is still OPEN (unprocessed). True iff the
   * processing order holds.
   *
   * Source: clearing-netting-settlement.md lines 52-54 ("batches are
   * processed in sequence order").
   */
  sequenceInvariant(): boolean {
    const entries = [...this.batches.values()].sort((a, b) => a.sequence - b.sequence);
    let seenOpen = false;
    for (const batch of entries) {
      if (batchStateRank(batch.state) < 1) {
        seenOpen = true; // an OPEN (unprocessed) batch at this sequence
      } else if (seenOpen) {
        // a PROCESSED batch at a HIGHER sequence than an OPEN one —
        // the processing order was violated
        return false;
      }
    }
    return true;
  }

  /**
   * Quarantine visibility: the quarantined records of a batch, with their
   * reason codes — "Quarantined records never produce obligations; they
   * await manual or automated disposition with reason codes" (the
   * quarantine path never silently drops records).
   *
   * Source: clearing-netting-settlement.md lines 37-40.
   */
  quarantinedRecords(batchId: string): readonly ClearingRecord[] {
    return this.batchRecords(batchId).filter((record) => record.state === 'QUARANTINED');
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  /**
   * Open a batch — OPEN, with the next INV-9-2 sequence position. The
   * batch id is derived from the caller's batch label (identical labels
   * derive identical ids — a re-opened label is the typed
   * ILLEGAL_TRANSITION-style duplicate, refused with a precise message).
   *
   * Source: clearing-netting-settlement.md lines 29-33 (the OPEN state);
   * INV-9-3 lines 55-56 (the batch id key).
   */
  async openBatch(input: { readonly batchLabel: string }): Promise<
    ClearingCommandResult<ClearingBatchRecord>
  > {
    if (typeof input.batchLabel !== 'string' || input.batchLabel.length === 0) {
      throw new TypeError('clearing authority: batchLabel must be a non-empty string');
    }
    return this.pipeline.run(PIPELINE_KEY, async () => {
      if (this.usedLabels.has(input.batchLabel)) {
        return {
          ok: false,
          code: 'ILLEGAL_TRANSITION' as const,
          message: `clearing authority: batch label ${JSON.stringify(input.batchLabel)} already opened (batch ids are derived from labels; re-commit is keyed by batch id — INV-9-3)`,
        };
      }
      this.usedLabels.add(input.batchLabel);
      const batchId = clearingBatchId(input.batchLabel);
      const at = this.now();
      const batch: ClearingBatchRecord = {
        batchId,
        sequence: this.nextBatchSequence++,
        state: 'OPEN',
        recordCount: 0,
        perCurrencyTotals: canonicalTotalsJson({}),
        contentsHash: hashStagedContents([], {}),
        openedAt: at,
        stateChangedAt: at,
      };
      this.batchOrder.push(batchId);
      this.setBatch(batch);
      this.setRecords(batchId, []);
      return { ok: true, value: this.batches.get(batchId) as ClearingBatchRecord };
    });
  }

  /**
   * Add one economic event to an OPEN batch (ACCEPTED). Refused on a
   * non-OPEN batch — "Contents are immutable after STAGED".
   *
   * Source: clearing-netting-settlement.md lines 29-33, 35-37.
   */
  async addRecord(batchId: string, record: ClearingRecordInput): Promise<
    ClearingCommandResult<ClearingRecord>
  > {
    if (typeof batchId !== 'string' || batchId.length === 0) {
      throw new TypeError('clearing authority: batchId must be a non-empty string');
    }
    if (record === null || typeof record !== 'object') {
      throw new TypeError('clearing authority: record must be an object');
    }
    if (record.origin === null || typeof record.origin !== 'object') {
      throw new TypeError('clearing authority: record.origin must be an object');
    }
    if (
      typeof record.origin.originActivityId !== 'string' ||
      record.origin.originActivityId.length === 0
    ) {
      throw new TypeError('clearing authority: record.origin.originActivityId must be a non-empty string');
    }
    if (!isClearingOriginKind(record.origin.originKind)) {
      throw new TypeError(
        `clearing authority: record.origin.originKind must be ROUTE_PLAN_HOP | INTENT | RECONCILIATION_ADJUSTMENT (got ${JSON.stringify(record.origin.originKind)})`,
      );
    }
    if (
      record.parties === null ||
      typeof record.parties !== 'object' ||
      typeof record.parties.debtorParticipantId !== 'string' ||
      record.parties.debtorParticipantId.length === 0 ||
      typeof record.parties.creditorParticipantId !== 'string' ||
      record.parties.creditorParticipantId.length === 0
    ) {
      throw new TypeError(
        'clearing authority: record.parties must carry non-empty debtorParticipantId and creditorParticipantId',
      );
    }
    if (typeof record.reason !== 'string' || record.reason.length === 0) {
      throw new TypeError('clearing authority: record.reason must be a non-empty string');
    }
    if (
      record.correctionOf !== undefined &&
      (typeof record.correctionOf !== 'string' || record.correctionOf.length === 0)
    ) {
      throw new TypeError('clearing authority: record.correctionOf must be a non-empty string when present');
    }
    return this.pipeline.run(PIPELINE_KEY, async () => {
      const batch = this.batches.get(batchId);
      if (batch === undefined) {
        return {
          ok: false,
          code: 'BATCH_NOT_FOUND' as const,
          message: `clearing authority: batch ${batchId} not found`,
        };
      }
      if (batch.state !== 'OPEN') {
        return {
          ok: false,
          code: 'BATCH_NOT_OPEN' as const,
          message: `clearing authority: batch ${batchId} is ${batch.state}; contents are immutable after STAGED (records are accepted only while OPEN)`,
        };
      }
      const at = this.now();
      const accepted: ClearingRecord = {
        recordId: clearingRecordId(record.origin),
        origin: { ...record.origin },
        parties: { ...record.parties },
        amount: record.amount,
        reason: record.reason,
        state: 'ACCEPTED',
        acceptedAt: at,
        stateChangedAt: at,
        ...(record.correctionOf !== undefined ? { correctionOf: record.correctionOf } : {}),
      };
      const current = this.records.get(batchId) ?? [];
      this.setRecords(batchId, [...current, accepted]);
      return {
        ok: true,
        value: (this.records.get(batchId) as ClearingRecord[]).slice(-1)[0] as ClearingRecord,
      };
    });
  }

  /**
   * Stage a batch — OPEN -> STAGED. The resumable staging pass: each
   * ACCEPTED record is validated (INV-9-1 field contract + the A09
   * upstream-UNKNOWN clearability gate); passing records transition to
   * STAGED, failing records to QUARANTINED with their reason codes (each
   * quarantine evidenced FIRST — RECORD_QUARANTINED, awaited — then the
   * record state commits); the pass ends with the per-currency integer
   * summation (MoneyBag) and the BATCH_STAGED record (awaited) before the
   * batch commits to STAGED. Already-transitioned records (a prior
   * partially-failed pass) keep their states.
   *
   * Source: clearing-netting-settlement.md lines 30-31, 37-40, 48-51
   * (INV-9-1), 58-64 (the clearability gate), 67-68 (BATCH_STAGED).
   */
  async stageBatch(batchId: string): Promise<ClearingCommandResult<ClearingBatchRecord>> {
    if (typeof batchId !== 'string' || batchId.length === 0) {
      throw new TypeError('clearing authority: batchId must be a non-empty string');
    }
    return this.pipeline.run(PIPELINE_KEY, async () => {
      const batch = this.batches.get(batchId);
      if (batch === undefined) {
        return {
          ok: false,
          code: 'BATCH_NOT_FOUND' as const,
          message: `clearing authority: batch ${batchId} not found`,
        };
      }
      if (batch.state === 'FINAL') {
        return {
          ok: false,
          code: 'ALREADY_FINAL' as const,
          message: `clearing authority: batch ${batchId} is FINAL (terminal)`,
        };
      }
      if (batch.state !== 'OPEN') {
        return {
          ok: false,
          code: 'ILLEGAL_TRANSITION' as const,
          message: `clearing authority: staging requires OPEN (batch ${batchId} is ${batch.state})`,
        };
      }
      const gate = this.sequenceGate(batch);
      if (!gate.ok) {
        return {
          ok: false,
          code: 'BATCH_SEQUENCE_ORDER' as const,
          message: `clearing authority: batch ${batchId} cannot stage before batch ${gate.blockerId} is processed (INV-9-2: batches are processed in sequence order)`,
        };
      }
      let records = [...(this.records.get(batchId) ?? [])];
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index] as ClearingRecord;
        if (record.state !== 'ACCEPTED') {
          continue; // already transitioned by a prior (failed) pass
        }
        const stagedSoFar = records.filter((candidate) => candidate.state === 'STAGED');
        const { scales } = stagedPerCurrencyTotals(stagedSoFar);
        const unresolved = this.clearability(record.origin.originActivityId);
        const validation = validateClearingRecord({
          amount: record.amount,
          parties: record.parties,
          seenCurrencyScales: scales,
          unresolvedUnknownOperationIds: unresolved,
        });
        const target = validation.ok ? 'STAGED' : 'QUARANTINED';
        const when = this.now();
        const applied = transitionRecord(
          record,
          target,
          when,
          validation.ok ? undefined : validation.reason,
        );
        if (!applied.ok) {
          return {
            ok: false,
            code: 'ILLEGAL_TRANSITION' as const,
            message: `clearing authority: record ${record.recordId} could not transition to ${target}`,
          };
        }
        if (target === 'QUARANTINED') {
          // Evidence FIRST (A15 lines 62-64): a failed write fails the
          // staging pass; the already-committed record states survive
          // (resumable re-stage skips them).
          await submitClearingEvidence(
            this.evidence,
            recordQuarantinedEvidence({ batchId, record: applied.record, when }),
          );
        }
        records[index] = applied.record;
        this.setRecords(batchId, records);
      }
      const { bag, scales: _scales } = stagedPerCurrencyTotals(records);
      const totals = totalsToMap(bag);
      const stagedRecords = records.filter((record) => record.state === 'STAGED');
      const contentsHash = hashStagedContents(
        stagedRecords.map((record) => record.recordId),
        totals,
      );
      const stagedWhen = this.now();
      await submitClearingEvidence(
        this.evidence,
        batchStagedEvidence({
          batchId,
          recordCount: records.length,
          perCurrencyTotalsHash: contentsHash,
          when: stagedWhen,
        }),
      );
      const transitioned = transitionBatch(batch, 'STAGED', stagedWhen);
      if (!transitioned.ok) {
        return {
          ok: false,
          code: 'ILLEGAL_TRANSITION' as const,
          message: `clearing authority: batch ${batchId} could not stage`,
        };
      }
      this.setBatch({
        ...transitioned.batch,
        recordCount: records.length,
        perCurrencyTotals: canonicalTotalsJson(totals),
        contentsHash,
      });
      return { ok: true, value: this.batches.get(batchId) as ClearingBatchRecord };
    });
  }

  /**
   * Commit a batch — STAGED -> COMMITTED. The INV-9-1 commit gate: a
   * batch with ANY quarantined record is REFUSED ("a batch is committed
   * only if every included record passes validation"). Each STAGED record
   * becomes one obligation creation instruction applied to the ledger
   * sink in stored order; duplicate instructions (same origin record id —
   * INV-10-3) are no-ops reported in the result (INV-9-2). The
   * BATCH_COMMITTED record is submitted FIRST (awaited); the commit
   * result is then recorded on the batch — INV-9-3's "recorded result".
   * Re-committing a committed batch id is a no-op returning the recorded
   * result (no second evidence record, no second financial effect).
   *
   * Source: clearing-netting-settlement.md lines 30-32 ("COMMITTED means
   * obligations have been created"), lines 48-56 (INV-9-1/9-2/9-3),
   * lines 67-68 (BATCH_COMMITTED).
   */
  async commitBatch(batchId: string): Promise<
    ClearingCommandResult<{ readonly batch: ClearingBatchRecord; readonly commit: BatchCommitResult; readonly replayed: boolean }>
  > {
    if (typeof batchId !== 'string' || batchId.length === 0) {
      throw new TypeError('clearing authority: batchId must be a non-empty string');
    }
    return this.pipeline.run(PIPELINE_KEY, async () => {
      const batch = this.batches.get(batchId);
      if (batch === undefined) {
        return {
          ok: false,
          code: 'BATCH_NOT_FOUND' as const,
          message: `clearing authority: batch ${batchId} not found`,
        };
      }
      if (batch.state === 'FINAL') {
        const recorded = batch.commit as BatchCommitResult;
        return {
          ok: true,
          value: { batch, commit: recorded, replayed: true },
        };
      }
      if (batch.state === 'COMMITTED') {
        // INV-9-3: re-committing the same batch id is a no-op returning
        // the recorded result — no second evidence record, no second
        // financial effect.
        const recorded = batch.commit as BatchCommitResult;
        return {
          ok: true,
          value: { batch, commit: recorded, replayed: true },
        };
      }
      if (batch.state !== 'STAGED') {
        return {
          ok: false,
          code: 'ILLEGAL_TRANSITION' as const,
          message: `clearing authority: committing requires STAGED (batch ${batchId} is ${batch.state})`,
        };
      }
      const gate = this.sequenceGate(batch);
      if (!gate.ok) {
        return {
          ok: false,
          code: 'BATCH_SEQUENCE_ORDER' as const,
          message: `clearing authority: batch ${batchId} cannot commit before batch ${gate.blockerId} is processed (INV-9-2: batches are processed in sequence order)`,
        };
      }
      const records = this.records.get(batchId) ?? [];
      const quarantined = records.filter((record) => record.state === 'QUARANTINED');
      if (quarantined.length > 0) {
        return {
          ok: false,
          code: 'RECORDS_QUARANTINED' as const,
          message: `clearing authority: batch ${batchId} holds ${quarantined.length} quarantined record(s) — a batch is committed only if every included record passes validation (INV-9-1); the quarantined records await disposition and never produce obligations`,
        };
      }
      const obligationIds: string[] = [];
      const duplicateOriginActivityIds: string[] = [];
      for (const record of records) {
        if (record.state !== 'STAGED') {
          continue;
        }
        const instruction: ObligationCreationInstruction = {
          batchId,
          recordId: record.recordId,
          originActivityId: record.origin.originActivityId,
          originKind: record.origin.originKind,
          debtorParticipantId: record.parties.debtorParticipantId,
          creditorParticipantId: record.parties.creditorParticipantId,
          amount: record.amount,
          reason: record.reason,
          ...(record.correctionOf !== undefined ? { correctionOf: record.correctionOf } : {}),
        };
        const outcome = await this.sink.applyClearingCommand(instruction);
        if (!outcome.duplicate) {
          obligationIds.push(outcome.obligationId);
        }
        if (outcome.duplicate) {
          duplicateOriginActivityIds.push(record.origin.originActivityId);
        }
      }
      const committedAt = this.now();
      const commit: BatchCommitResult = deepFreeze({
        obligationIds: Object.freeze([...obligationIds]),
        duplicateOriginActivityIds: Object.freeze([...duplicateOriginActivityIds]),
        idempotencyKey: batchCommitIdempotencyKey(batchId),
        committedAt,
      });
      // Evidence FIRST (A15 lines 62-64) — the obligations themselves are
      // already created and their OBLIGATION_CREATED records written by
      // the ledger; this record is the BATCH's consequential commit.
      await submitClearingEvidence(this.evidence, batchCommittedEvidence({ batchId, commit }));
      const transitioned = transitionBatch(batch, 'COMMITTED', committedAt);
      if (!transitioned.ok) {
        return {
          ok: false,
          code: 'ILLEGAL_TRANSITION' as const,
          message: `clearing authority: batch ${batchId} could not commit`,
        };
      }
      this.setBatch({ ...transitioned.batch, commit });
      return {
        ok: true,
        value: {
          batch: this.batches.get(batchId) as ClearingBatchRecord,
          commit,
          replayed: false,
        },
      };
    });
  }

  /**
   * Finalize a batch — COMMITTED -> FINAL: the hand-off acknowledgment.
   * Every obligation id the batch produced must exist in the ledger ("all
   * produced obligations are handed to the obligation ledger"); a missing
   * id fails loudly (OBLIGATION_LEDGER_MISMATCH — never a silent gap).
   * Emits no evidence record (the A09 named set is exhaustive; the
   * hand-off's subject is already evidenced by the ledger's own
   * OBLIGATION_CREATED records — recorded interpretation).
   *
   * Source: clearing-netting-settlement.md lines 30-33 ("FINAL means all
   * produced obligations are handed to the obligation ledger").
   */
  async finalizeBatch(batchId: string): Promise<ClearingCommandResult<ClearingBatchRecord>> {
    if (typeof batchId !== 'string' || batchId.length === 0) {
      throw new TypeError('clearing authority: batchId must be a non-empty string');
    }
    return this.pipeline.run(PIPELINE_KEY, async () => {
      const batch = this.batches.get(batchId);
      if (batch === undefined) {
        return {
          ok: false,
          code: 'BATCH_NOT_FOUND' as const,
          message: `clearing authority: batch ${batchId} not found`,
        };
      }
      if (batch.state === 'FINAL') {
        return {
          ok: false,
          code: 'ALREADY_FINAL' as const,
          message: `clearing authority: batch ${batchId} is FINAL (terminal)`,
        };
      }
      if (batch.state !== 'COMMITTED') {
        return {
          ok: false,
          code: 'NOT_COMMITTED' as const,
          message: `clearing authority: finalizing requires COMMITTED (batch ${batchId} is ${batch.state})`,
        };
      }
      const gate = this.sequenceGate(batch);
      if (!gate.ok) {
        return {
          ok: false,
          code: 'BATCH_SEQUENCE_ORDER' as const,
          message: `clearing authority: batch ${batchId} cannot finalize before batch ${gate.blockerId} is processed (INV-9-2: batches are processed in sequence order)`,
        };
      }
      const commit = batch.commit as BatchCommitResult;
      for (const obligationId of commit.obligationIds) {
        if (!this.sink.hasObligation(obligationId)) {
          return {
            ok: false,
            code: 'OBLIGATION_LEDGER_MISMATCH' as const,
            message: `clearing authority: produced obligation ${obligationId} is not present in the obligation ledger — the FINAL hand-off proof failed`,
          };
        }
      }
      const at = this.now();
      const transitioned = transitionBatch(batch, 'FINAL', at);
      if (!transitioned.ok) {
        return {
          ok: false,
          code: 'ILLEGAL_TRANSITION' as const,
          message: `clearing authority: batch ${batchId} could not finalize`,
        };
      }
      this.setBatch(transitioned.batch);
      return { ok: true, value: this.batches.get(batchId) as ClearingBatchRecord };
    });
  }
}
