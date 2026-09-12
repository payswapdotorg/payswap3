/**
 * RTN-008 — Clearing Authority: the A09 type vocabulary, state machine
 * tables, record shapes, and runtime guards.
 *
 * Spec sources (binding) — spec/architecture/v0.1/
 * clearing-netting-settlement.md §1 Area 9:
 *   lines 18-25 (Purpose, verbatim):
 *     "Convert completed fulfillment activity into ledger-ready records:
 *      validated, deduplicated, and staged economic events from which
 *      obligations are created exactly once. Clearing is deterministic
 *      batch processing, not money movement."
 *   lines 29-33 (ClearingBatch, verbatim):
 *     "ClearingBatch — unit of staged processing.
 *      States: OPEN -> STAGED -> COMMITTED -> FINAL.
 *      Contents are immutable after STAGED. COMMITTED means obligations
 *      have been created; FINAL means all produced obligations are handed
 *      to the obligation ledger."
 *   lines 35-40 (ClearingRecord, verbatim):
 *     "ClearingRecord — one economic event inside a batch: reference to
 *      the fulfilling activity (route plan hop, intent), parties, Money
 *      amounts, and reason.
 *      States: ACCEPTED -> STAGED | QUARANTINED.
 *      Quarantined records never produce obligations; they await manual
 *      or automated disposition with reason codes."
 *   lines 42-45 (Owning authority):
 *     "Clearing Authority (protocol layer, area 9) owns batch and record
 *      state, and is the only creator of obligation creation instructions."
 *   lines 47-56 (INV-9-1 / INV-9-2 / INV-9-3, quoted in the enforcing
 *     modules: summation.ts, authority.ts).
 *   lines 58-64 (failure and UNKNOWN semantics — the upstream-UNKNOWN
 *     clearability gate: "any upstream UNKNOWN (rail operations during
 *     fulfillment) must already be resolved by area 14 before the activity
 *      becomes clearable").
 *   lines 66-70 (evidence produced — BATCH_STAGED, BATCH_COMMITTED,
 *     RECORD_QUARANTINED).
 *   lines 72-78 (boundaries — "Clearing creates obligation instructions;
 *     it does not net, settle, or touch rails.").
 *   spec/architecture/v0.1/README.md §3 GC-1/GC-2/GC-4/GC-5.
 *   spec/registry/protocol-registry.json A09 — owningAuthority:
 *     "Clearing Authority".
 *
 * Transition-table interpretation (recorded in CONTRACT-REVIEW.md): the
 * v0.1 chains are materialized EXACTLY as written:
 *   - Batch: OPEN -> STAGED -> COMMITTED -> FINAL (one-way; FINAL is
 *     terminal; contents freeze at STAGED — the authority's command
 *     surface accepts records only while OPEN).
 *   - Record: ACCEPTED -> STAGED | QUARANTINED. Both successors are
 *     absorbing within this surface: the frozen chain has no outgoing
 *     edges from either, so record disposition ("they await manual or
 *     automated disposition with reason codes") happens OUT of band —
 *     a dispositioned record is re-submitted as a NEW record in a NEW
 *     batch; the quarantined row itself is never dropped, never mutated,
 *     and never produces an obligation.
 */

import type { Money } from '../kernel/money.ts';
import type { ProtocolTime } from '../kernel/time.ts';

// ---------------------------------------------------------------------------
// Area 9 — ClearingBatch state machine
// ---------------------------------------------------------------------------

/**
 * The ClearingBatch state vocabulary, verbatim from the v0.1 chain.
 *
 * Source: clearing-netting-settlement.md lines 30-31 — "States: OPEN ->
 * STAGED -> COMMITTED -> FINAL."
 */
export const BATCH_STATES: readonly ['OPEN', 'STAGED', 'COMMITTED', 'FINAL'] = Object.freeze([
  'OPEN',
  'STAGED',
  'COMMITTED',
  'FINAL',
] as const);

/**
 * A ClearingBatch state. FINAL is terminal ("all produced obligations are
 * handed to the obligation ledger").
 *
 * Source: clearing-netting-settlement.md lines 30-33.
 */
export type BatchState = (typeof BATCH_STATES)[number];

/**
 * The frozen one-way ClearingBatch transition table — the exact v0.1 chain.
 * "Contents are immutable after STAGED" is enforced by the authority's
 * command surface (records are accepted only while OPEN); "COMMITTED means
 * obligations have been created" and "FINAL means all produced obligations
 * are handed to the obligation ledger" are the state semantics the
 * authority's stage/commit/finalize commands carry.
 *
 * Source: clearing-netting-settlement.md lines 30-33.
 */
export const BATCH_TRANSITIONS: Readonly<Record<BatchState, readonly BatchState[]>> = Object.freeze({
  OPEN: Object.freeze(['STAGED'] as const),
  STAGED: Object.freeze(['COMMITTED'] as const),
  COMMITTED: Object.freeze(['FINAL'] as const),
  FINAL: Object.freeze([] as const),
});

/**
 * Runtime type guard for BatchState.
 *
 * Source: clearing-netting-settlement.md lines 30-33 (the vocabulary this
 * guard re-checks).
 */
export function isBatchState(value: unknown): value is BatchState {
  return typeof value === 'string' && (BATCH_STATES as readonly string[]).includes(value);
}

/**
 * True iff the (from, to) pair is a legal one-way ClearingBatch transition.
 *
 * Source: clearing-netting-settlement.md lines 30-33 (the chain this table
 * materializes).
 */
export function canTransitionBatch(from: BatchState, to: BatchState): boolean {
  return BATCH_TRANSITIONS[from].includes(to);
}

/**
 * The processing rank of a batch state — the position on the OPEN ->
 * STAGED -> COMMITTED -> FINAL chain. INV-9-2 ("batches are processed in
 * sequence order") is enforced as rank monotonicity over the batch
 * sequence: an earlier-sequence batch is never LESS advanced than a
 * later-sequence one (see authority.ts).
 *
 * Source: clearing-netting-settlement.md lines 30-33 (the chain order);
 * INV-9-2 lines 52-54 ("batches are processed in sequence order").
 */
export function batchStateRank(state: BatchState): 0 | 1 | 2 | 3 {
  switch (state) {
    case 'OPEN':
      return 0;
    case 'STAGED':
      return 1;
    case 'COMMITTED':
      return 2;
    case 'FINAL':
      return 3;
  }
}

// ---------------------------------------------------------------------------
// Area 9 — ClearingRecord state machine
// ---------------------------------------------------------------------------

/**
 * The ClearingRecord state vocabulary, verbatim from the v0.1 chain.
 *
 * Source: clearing-netting-settlement.md lines 37-38 — "States: ACCEPTED
 * -> STAGED | QUARANTINED."
 */
export const RECORD_STATES: readonly ['ACCEPTED', 'STAGED', 'QUARANTINED'] = Object.freeze([
  'ACCEPTED',
  'STAGED',
  'QUARANTINED',
] as const);

/**
 * A ClearingRecord state. QUARANTINED is absorbing within this surface
 * ("Quarantined records never produce obligations; they await manual or
 * automated disposition with reason codes" — disposition is out of band).
 *
 * Source: clearing-netting-settlement.md lines 37-40.
 */
export type RecordState = (typeof RECORD_STATES)[number];

/**
 * The frozen ClearingRecord transition table — the exact v0.1 chain: an
 * ACCEPTED record either passes staging validation (STAGED) or is
 * quarantined (QUARANTINED). No outgoing edges from either successor:
 * quarantined records are never silently dropped and never re-enter
 * ACCEPTED within a batch (corrections are new records in new batches —
 * INV-10-1's "corrections are new linked obligations").
 *
 * Source: clearing-netting-settlement.md lines 37-40.
 */
export const RECORD_TRANSITIONS: Readonly<Record<RecordState, readonly RecordState[]>> =
  Object.freeze({
    ACCEPTED: Object.freeze(['STAGED', 'QUARANTINED'] as const),
    STAGED: Object.freeze([] as const),
    QUARANTINED: Object.freeze([] as const),
  });

/**
 * Runtime type guard for RecordState.
 *
 * Source: clearing-netting-settlement.md lines 37-38 (the vocabulary this
 * guard re-checks).
 */
export function isRecordState(value: unknown): value is RecordState {
  return typeof value === 'string' && (RECORD_STATES as readonly string[]).includes(value);
}

/**
 * True iff the (from, to) pair is a legal ClearingRecord transition.
 *
 * Source: clearing-netting-settlement.md lines 37-38.
 */
export function canTransitionRecord(from: RecordState, to: RecordState): boolean {
  return RECORD_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Area 9 — reason codes (RECORD_QUARANTINED "with reason codes")
// ---------------------------------------------------------------------------

/**
 * The Clearing Authority's reason-code vocabulary. The members are the
 * machine-readable reasons the area names: INV-9-1's validation failures
 * ("a batch is committed only if every included record passes validation";
 * "amounts are integer Money; staging performs per-currency integer
 * summation checks") and the A09 UNKNOWN-gate rejection ("any upstream
 * UNKNOWN ... must already be resolved by area 14 before the activity
 * becomes clearable"). Frozen — no inventions.
 *
 * Source: clearing-netting-settlement.md lines 47-51 (INV-9-1), lines
 * 58-64 (the UNKNOWN gate), lines 38-40 ("with reason codes").
 */
export const CLEARING_REASON_CODES: readonly [
  'INVALID_MONEY_NOT_INTEGER',
  'INVALID_MONEY_SHAPE',
  'SCALE_MISMATCH_WITHIN_CURRENCY',
  'ZERO_AMOUNT',
  'SELF_PARTY',
  'UPSTREAM_UNRESOLVED_UNKNOWN',
] = Object.freeze([
  'INVALID_MONEY_NOT_INTEGER',
  'INVALID_MONEY_SHAPE',
  'SCALE_MISMATCH_WITHIN_CURRENCY',
  'ZERO_AMOUNT',
  'SELF_PARTY',
  'UPSTREAM_UNRESOLVED_UNKNOWN',
] as const);

/**
 * A Clearing Authority reason code (the quarantine reasons and command
 * rejection grounding).
 *
 * Source: clearing-netting-settlement.md lines 38-40, 47-51, 58-64.
 */
export type ClearingReasonCode = (typeof CLEARING_REASON_CODES)[number];

/**
 * Runtime type guard for ClearingReasonCode.
 *
 * Source: clearing-netting-settlement.md lines 38-40 ("with reason codes").
 */
export function isClearingReasonCode(value: unknown): value is ClearingReasonCode {
  return (
    typeof value === 'string' && (CLEARING_REASON_CODES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Area 9 — typed command rejections
// ---------------------------------------------------------------------------

/**
 * The typed rejection codes of the Clearing Authority's command surface
 * (typed values, never thrown — the merged command convention). Each
 * member's grounding: BATCH_NOT_FOUND (lookup failure), BATCH_NOT_OPEN
 * ("Contents are immutable after STAGED" — records are accepted only while
 * OPEN), RECORDS_QUARANTINED (INV-9-1: "a batch is committed only if every
 * included record passes validation"), BATCH_SEQUENCE_ORDER (INV-9-2:
 * "batches are processed in sequence order"), ILLEGAL_TRANSITION (the
 * frozen machines), NOT_COMMITTED / ALREADY_FINAL (the FINAL hand-off
 * command's state gate), and OBLIGATION_LEDGER_MISMATCH (the FINAL
 * hand-off proof failed — not every produced obligation is present in the
 * ledger).
 *
 * Source: clearing-netting-settlement.md lines 30-33, 47-56.
 */
export const CLEARING_REJECTION_CODES: readonly [
  'BATCH_NOT_FOUND',
  'BATCH_NOT_OPEN',
  'RECORDS_QUARANTINED',
  'BATCH_SEQUENCE_ORDER',
  'ILLEGAL_TRANSITION',
  'NOT_COMMITTED',
  'ALREADY_FINAL',
  'OBLIGATION_LEDGER_MISMATCH',
] = Object.freeze([
  'BATCH_NOT_FOUND',
  'BATCH_NOT_OPEN',
  'RECORDS_QUARANTINED',
  'BATCH_SEQUENCE_ORDER',
  'ILLEGAL_TRANSITION',
  'NOT_COMMITTED',
  'ALREADY_FINAL',
  'OBLIGATION_LEDGER_MISMATCH',
] as const);

/**
 * A typed Clearing Authority rejection code.
 *
 * Source: clearing-netting-settlement.md lines 30-33, 47-56.
 */
export type ClearingRejectionCode = (typeof CLEARING_REJECTION_CODES)[number];

/**
 * Runtime type guard for ClearingRejectionCode.
 *
 * Source: clearing-netting-settlement.md lines 30-33, 47-56.
 */
export function isClearingRejectionCode(value: unknown): value is ClearingRejectionCode {
  return (
    typeof value === 'string' &&
    (CLEARING_REJECTION_CODES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Area 9 — record and batch shapes
// ---------------------------------------------------------------------------

/**
 * The origin reference of one economic event — "reference to the fulfilling
 * activity (route plan hop, intent)". The `originActivityId` IS the
 * INV-9-2 deduplication key ("record deduplication keys (origin activity
 * id)"); the record id is the per-record identity the obligation ledger's
 * INV-10-3 keys creation on ("obligation creation from clearing is keyed
 * by origin record id"). RECONCILIATION_ADJUSTMENT is the origin kind of
 * correction records — area 14's "RESOLVED_ADJUSTED: new linked
 * obligations created via area 9/10 paths" (rails-adapters-
 * reconciliation.md lines 177-179).
 *
 * Source: clearing-netting-settlement.md lines 35-37 (the record's
 * reference shape), lines 52-54 (INV-9-2), lines 119-121 (INV-10-3);
 * rails-adapters-reconciliation.md lines 177-179.
 */
export const CLEARING_ORIGIN_KINDS: readonly [
  'ROUTE_PLAN_HOP',
  'INTENT',
  'RECONCILIATION_ADJUSTMENT',
] = Object.freeze(['ROUTE_PLAN_HOP', 'INTENT', 'RECONCILIATION_ADJUSTMENT'] as const);

/**
 * What kind of fulfilling activity the origin names.
 *
 * Source: clearing-netting-settlement.md lines 35-37 ("reference to the
 * fulfilling activity (route plan hop, intent)");
 * rails-adapters-reconciliation.md lines 177-179 (the adjustment path).
 */
export type ClearingOriginKind = (typeof CLEARING_ORIGIN_KINDS)[number];

/**
 * Runtime type guard for ClearingOriginKind.
 *
 * Source: clearing-netting-settlement.md lines 35-37.
 */
export function isClearingOriginKind(value: unknown): value is ClearingOriginKind {
  return (
    typeof value === 'string' &&
    (CLEARING_ORIGIN_KINDS as readonly string[]).includes(value)
  );
}

/**
 * The origin reference: the fulfilling activity's identity.
 *
 * Source: clearing-netting-settlement.md lines 35-37; INV-9-2 lines 52-54.
 */
export interface ClearingOriginReference {
  /** The fulfilling activity's id — the INV-9-2 deduplication key. */
  readonly originActivityId: string;
  readonly originKind: ClearingOriginKind;
}

/**
 * The parties of one economic event — the "parties" of the
 * ClearingRecord: the party the produced obligation is owed BY (debtor)
 * and the party it is owed TO (creditor). Participant ids are opaque
 * protocol subject ids (area 10's obligation terms copy them verbatim).
 *
 * Source: clearing-netting-settlement.md lines 35-37 ("parties");
 * clearing-netting-settlement.md lines 84-87 (the ledger maintains "who
 * owes whom what").
 */
export interface ClearingParties {
  readonly debtorParticipantId: string;
  readonly creditorParticipantId: string;
}

/**
 * ClearingRecord — one economic event inside a batch: origin reference,
 * parties, Money amount, and reason ("reference to the fulfilling activity
 * (route plan hop, intent), parties, Money amounts, and reason"). Records
 * are deep-frozen at mint; record contents are part of the batch contents
 * that freeze at STAGED.
 *
 * `quarantineReason` is present exactly when the record is QUARANTINED —
 * "they await manual or automated disposition with reason codes".
 *
 * Source: clearing-netting-settlement.md lines 35-40.
 */
export interface ClearingRecord {
  /** Derived record id — the INV-10-3 origin-record-id key. */
  readonly recordId: string;
  readonly origin: ClearingOriginReference;
  readonly parties: ClearingParties;
  /** The event's Money amount — one single-currency Money per record. */
  readonly amount: Money;
  /** The reason the economic event carries. */
  readonly reason: string;
  readonly state: RecordState;
  /** Present iff state is QUARANTINED ("with reason codes"). */
  readonly quarantineReason?: ClearingReasonCode;
  /**
   * The prior obligation this record corrects, for correction records
   * (origin kind RECONCILIATION_ADJUSTMENT) — INV-10-1's "corrections are
   * new linked obligations" via area 14's "new linked obligations created
   * via area 9/10 paths" (rails-adapters-reconciliation.md lines 175-179).
   */
  readonly correctionOf?: string;
  readonly acceptedAt: ProtocolTime;
  readonly stateChangedAt: ProtocolTime;
}

/**
 * ClearingBatch — the unit of staged processing. `sequence` is the INV-9-2
 * processing position (assigned at open, strictly increasing);
 * `recordCount` is the staged record count and `perCurrencyTotals` the
 * INV-9-1 staged per-currency integer summation totals and
 * `contentsHash` the staged contents hash (BATCH_STAGED proof material:
 * "record count, per-currency totals hash"); `commit` is the INV-9-3
 * recorded commit result (present iff COMMITTED/FINAL — re-commit returns
 * this recorded result, a no-op).
 *
 * Source: clearing-netting-settlement.md lines 29-33; lines 48-51
 * (INV-9-1); lines 52-54 (INV-9-2); lines 55-56 (INV-9-3); lines 67-68
 * (evidence produced).
 */
export interface ClearingBatchRecord {
  readonly batchId: string;
  /** INV-9-2 processing position — strictly increasing across batches. */
  readonly sequence: number;
  readonly state: BatchState;
  /** Staged record count (BATCH_STAGED proof material). */
  readonly recordCount: number;
  /** INV-9-1 per-currency integer summation totals (canonical MoneyBag JSON). */
  readonly perCurrencyTotals: string;
  /** Hash over the staged contents (BATCH_STAGED proof material). */
  readonly contentsHash: string;
  readonly openedAt: ProtocolTime;
  readonly stateChangedAt: ProtocolTime;
  /** The INV-9-3 recorded commit result — present iff committed. */
  readonly commit?: BatchCommitResult;
}

/**
 * The INV-9-3 recorded commit result: the obligation ids the committed
 * batch produced, the duplicate origin keys whose instructions were
 * no-ops ("a committed batch produces each obligation exactly once"), and
 * the idempotency proof (BATCH_COMMITTED's proof material — "obligation
 * ids created, idempotency proof").
 *
 * Source: clearing-netting-settlement.md lines 52-56 (INV-9-2/INV-9-3),
 * lines 67-68 (evidence produced).
 */
export interface BatchCommitResult {
  /** The obligations created by THIS commit, in stored record order. */
  readonly obligationIds: readonly string[];
  /** Origin activity ids whose creation instruction was a duplicate no-op. */
  readonly duplicateOriginActivityIds: readonly string[];
  /** The idempotency proof: the commit's derived idempotency key. */
  readonly idempotencyKey: string;
  readonly committedAt: ProtocolTime;
}

/**
 * The typed result shape of every Clearing Authority command: the value
 * arm or the typed rejection arm (never thrown — the merged convention).
 *
 * Source: the merged command convention (RTN-005/006/007); the A09
 * invariants the rejections ground (lines 30-33, 47-56).
 */
export type ClearingCommandResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ClearingRejectionCode; readonly message: string };
