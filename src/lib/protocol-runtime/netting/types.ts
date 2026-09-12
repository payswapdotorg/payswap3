/**
 * RTN-009 — Netting Authority: the A11 type vocabulary — the NettingSet and
 * NetObligation state machines, the NettingScope, the NetPosition and
 * conservation-proof record shapes, and the typed rejection codes.
 *
 * Spec sources (binding) — spec/architecture/v0.1/
 * clearing-netting-settlement.md §3 Area 11:
 *   lines 147-153 (Purpose, verbatim):
 *     "Reduce sets of obligations to net positions without changing total
 *      value: pairwise (bilateral) between two participants and cyclic or
 *      optimization-based (multilateral) across many participants. Netting
 *      is a deterministic computation over the obligation ledger."
 *   lines 155-170 (Core objects and state, verbatim):
 *     "NettingSet — one netting computation over a closed set of
 *      obligations.
 *      States: OPEN -> COMPUTED -> COMMITTED.
 *      OPEN: input obligation ids fixed. COMPUTED: net positions
 *      computed and checkable. COMMITTED: input obligations moved to
 *      NETTED and replaced by net obligations in the ledger.
 *
 *      NetPosition — per participant, per currency net amount (signed
 *      integer Money) after netting, with a breakdown hash proving
 *      conservation.
 *
 *      NettingScope — bilateral (exactly two participants) or
 *      multilateral (three or more, defined participant set)."
 *   lines 172-175 (Owning authority):
 *     "Netting Authority (protocol layer, area 11) owns netting
 *      computation and set state; obligation transitions remain owned by
 *      area 10, executed only on Netting Authority instruction."
 *   lines 177-189 (the three invariants — quoted in full below at each
 *     binding site).
 *   lines 191-197 (failure semantics: "failures are validation failures
 *     that abort the set before commit with no ledger effect. No UNKNOWN
 *     state.").
 *   lines 199-203 (evidence produced); lines 205-209 (boundaries: "Netting
 *     never settles; it only transforms obligations." / "Netting never
 *     includes obligations in DISPUTED state." / "Depends on areas 10, 12,
 *     15").
 *   spec/architecture/v0.1/README.md §3 GC-1 (lines 39-43), GC-4 (lines
 *     57-61: "The protocol layer owns financial truth: balances,
 *     obligations, net positions, and finality.").
 *   spec/registry/protocol-registry.json A11 — owningAuthority:
 *     "Netting Authority".
 *
 * Interpretation decisions (recorded in CONTRACT-REVIEW.md):
 *   - The net obligations that "replace" the input obligations are
 *     materialized as NetObligation records in the NETTING domain (the
 *     NetPosition's bilateral obligation form), with deterministic ids.
 *     Rationale: INV-10-4's frozen creation list has no netting member
 *     and the merged A10 write surface (RTN-008) has no netting creation
 *     kind — its CONTRACT-REVIEW decision #11 explicitly deferred this
 *     boundary to RTN-009; A12 lines 224-225 makes a settlement
 *     instruction "for one obligation or net position" (net positions
 *     are first-class settlement subjects, distinct from A10
 *     obligations); GC-4 lists "net positions" as protocol-owned
 *     financial truth alongside "obligations". The A10 NETTED transition
 *     carries the net obligations as its replacementObligationIds, so
 *     the replacement is recorded in the ledger (the transition entry).
 *   - The NetObligation lifecycle is the A10 obligation machine's
 *     settlement-facing subset — CREATED -> SETTLEMENT_PENDING -> SETTLED
 *     — owned by the Netting Authority and driven ONLY by Settlement
 *     Authority instruction (the exact mirror of how A11 itself drives
 *     A10's transitions). "Netting never settles" holds: the netting
 *     domain declares no finality, calls no rails, and owns no
 *     instruction/attempt/finality state; it only transitions its own
 *     records on area-12 instructions, as area 10 does.
 */

import type { Money } from '../kernel/money.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type { ObligationRecord } from '../obligations/obligations.ts';

// ---------------------------------------------------------------------------
// Area 11 — the NettingSet state machine
// ---------------------------------------------------------------------------

/**
 * The NettingSet state vocabulary, verbatim from Area 11.
 *
 * Source: clearing-netting-settlement.md lines 158-160 — "States: OPEN ->
 * COMPUTED -> COMMITTED."
 */
export const NETTING_SET_STATES: readonly ['OPEN', 'COMPUTED', 'COMMITTED'] = Object.freeze([
  'OPEN',
  'COMPUTED',
  'COMMITTED',
] as const);

/**
 * A NettingSet state.
 *
 * Source: clearing-netting-settlement.md lines 158-160.
 */
export type NettingSetState = (typeof NETTING_SET_STATES)[number];

/**
 * The frozen one-way NettingSet transition table — exactly the v0.1 chain:
 * OPEN→COMPUTED, COMPUTED→COMMITTED. No abort/cancel state exists in the
 * frozen machine; validation failures are typed command rejections that
 * leave the set in its current state with no ledger effect (lines 191-193:
 * "failures are validation failures that abort the set before commit with
 * no ledger effect" — the set does not proceed; the exact three-state
 * machine is preserved).
 *
 * Source: clearing-netting-settlement.md lines 158-163, 191-193.
 */
export const NETTING_SET_TRANSITIONS: Readonly<
  Record<NettingSetState, readonly NettingSetState[]>
> = Object.freeze({
  OPEN: Object.freeze(['COMPUTED'] as const),
  COMPUTED: Object.freeze(['COMMITTED'] as const),
  COMMITTED: Object.freeze([] as const),
});

/**
 * Runtime type guard for NettingSetState.
 *
 * Source: clearing-netting-settlement.md lines 158-160.
 */
export function isNettingSetState(value: unknown): value is NettingSetState {
  return (
    typeof value === 'string' && (NETTING_SET_STATES as readonly string[]).includes(value)
  );
}

/**
 * True iff the (from, to) pair is a legal NettingSet transition.
 *
 * Source: clearing-netting-settlement.md lines 158-163.
 */
export function canTransitionNettingSet(from: NettingSetState, to: NettingSetState): boolean {
  return NETTING_SET_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Area 11 — NettingScope
// ---------------------------------------------------------------------------

/**
 * The NettingScope: "bilateral (exactly two participants) or multilateral
 * (three or more, defined participant set)" — verbatim semantics. The
 * participants array is normalized to sorted order at mint, so identical
 * scopes are structurally identical (GC-1).
 *
 * Source: clearing-netting-settlement.md lines 167-169.
 */
export type NettingScope =
  | {
      readonly kind: 'BILATERAL';
      /** Exactly two distinct participant ids, sorted. */
      readonly participants: readonly [string, string];
    }
  | {
      readonly kind: 'MULTILATERAL';
      /** Three or more distinct participant ids, sorted. */
      readonly participants: readonly string[];
    };

/**
 * The participant count bounds of each scope kind: bilateral is EXACTLY two;
 * multilateral is three or more ("three or more, defined participant set").
 *
 * Source: clearing-netting-settlement.md lines 167-169.
 */
export const BILATERAL_PARTICIPANT_COUNT = 2;
export const MULTILATERAL_MIN_PARTICIPANTS = 3;

// ---------------------------------------------------------------------------
// Area 11 — the gross obligation snapshot and the NetPosition
// ---------------------------------------------------------------------------

/**
 * One input obligation as snapshotted for the computation: the id (fixed at
 * OPEN), the parties, and the integer Money amount (immutable per INV-10-1
 * — "the ledger never mutates an amount after creation" — so the snapshot is
 * a pure function of the fixed input ids).
 *
 * Source: clearing-netting-settlement.md lines 161-162 ("OPEN: input
 * obligation ids fixed."), 180-183 (INV-11-1 — the gross obligations the
 * conservation sums over), §2 Area 10 lines 113-116 (INV-10-1).
 */
export interface GrossObligationSnapshot {
  readonly obligationId: string;
  readonly debtorParticipantId: string;
  readonly creditorParticipantId: string;
  readonly amount: Money;
}

/**
 * NetPosition — "per participant, per currency net amount (signed integer
 * Money) after netting, with a breakdown hash proving conservation" —
 * verbatim. The breakdown hash covers the position's composition: the
 * ordered (obligationId, signed contribution) entries that sum to this
 * position, so conservation is independently checkable from the record.
 *
 * The signed amount is the participant's NET claim in the set: positive =
 * net creditor (owed to), negative = net debtor (owes).
 *
 * Source: clearing-netting-settlement.md lines 165-166.
 */
export interface NetPosition {
  readonly nettingSetId: string;
  readonly participantId: string;
  readonly currency: string;
  /** The signed net amount (integer Money — GC-1). */
  readonly net: Money;
  /** sha256 over the canonical ordered breakdown (obligation id, signed minor units). */
  readonly breakdownHash: string;
  /** The ordered breakdown proving conservation (input obligation id + signed contribution). */
  readonly breakdown: readonly {
    readonly obligationId: string;
    readonly signedAmountMinor: number;
  }[];
}

/**
 * The per-currency conservation record — the check that "is recorded in the
 * set's proof before commit" (INV-11-1). For every currency: the
 * independently recomputed per-participant gross sums (each input
 * obligation contributes +m to its creditor and -m to its debtor), the
 * computed net positions, and the equality result. `grossSumMinor` and
 * `netSumMinor` are the integer sums the invariant names ("the integer sum
 * of net positions equals the integer sum of gross obligations" — over the
 * participant-signed amounts; both are 0 for the closed participant set,
 * and the per-participant equalities are the non-trivial content).
 *
 * Source: clearing-netting-settlement.md lines 180-183 (INV-11-1).
 */
export interface CurrencyConservationRecord {
  readonly currency: string;
  /** Per participant, sorted by id: the signed gross sum recomputed from the input obligations. */
  readonly grossPerParticipant: readonly {
    readonly participantId: string;
    readonly amountMinor: number;
  }[];
  /** Per participant, sorted by id: the computed net position. */
  readonly netPerParticipant: readonly {
    readonly participantId: string;
    readonly amountMinor: number;
  }[];
  /** The integer sum of gross obligations (participant-signed). */
  readonly grossSumMinor: number;
  /** The integer sum of net positions. */
  readonly netSumMinor: number;
  /** True iff netSumMinor === grossSumMinor AND every per-participant net equals its gross. */
  readonly conserved: boolean;
}

/**
 * The NettingSet's conservation proof — recorded at COMPUTED, before
 * COMMIT. Carries the netting algorithm version (INV-11-3's pure-function
 * input), one conservation record per currency, and the proof hash (sha256
 * over the canonical encoding of the whole proof).
 *
 * Source: clearing-netting-settlement.md lines 180-183 (INV-11-1: "the
 * check is recorded in the set's proof before commit"), 185-189 (INV-11-3:
 * "a pure function of its fixed input ids and the netting algorithm
 * version").
 */
export interface ConservationProof {
  readonly algorithmVersion: number;
  readonly currencies: readonly string[];
  readonly perCurrency: readonly CurrencyConservationRecord[];
  /** sha256 over the canonical JSON encoding of this proof (GC-1 determinism). */
  readonly proofHash: string;
}

// ---------------------------------------------------------------------------
// Area 11 — the NettingSet record
// ---------------------------------------------------------------------------

/**
 * The NettingSet record: one netting computation over a closed set of
 * obligations. The input obligation ids are FIXED at OPEN (INV-11-3's
 * pure-function input); the gross snapshot, net positions, and conservation
 * proof are recorded at COMPUTED ("net positions computed and checkable").
 *
 * Source: clearing-netting-settlement.md lines 157-163.
 */
export interface NettingSetRecord {
  readonly nettingSetId: string;
  readonly state: NettingSetState;
  readonly scope: NettingScope;
  /** The netting algorithm version (INV-11-3). */
  readonly algorithmVersion: number;
  /** The input obligation ids, fixed at OPEN (INV-11-3). */
  readonly inputObligationIds: readonly string[];
  /** The input obligations as snapshotted at COMPUTE (present iff state is COMPUTED or COMMITTED). */
  readonly grossObligations?: readonly GrossObligationSnapshot[];
  /** The computed net positions (present iff state is COMPUTED or COMMITTED). */
  readonly netPositions?: readonly NetPosition[];
  /** The recorded conservation proof (present iff state is COMPUTED or COMMITTED — INV-11-1). */
  readonly conservationProof?: ConservationProof;
  readonly openedAt: ProtocolTime;
  readonly computedAt?: ProtocolTime;
  readonly committedAt?: ProtocolTime;
}

// ---------------------------------------------------------------------------
// Area 11 — the NetObligation (the net position's obligation form)
// ---------------------------------------------------------------------------

/**
 * The NetObligation state machine — the settlement-facing subset of the A10
 * obligation chain a net obligation participates in: CREATED (materialized
 * by the netting commit) -> SETTLEMENT_PENDING (a settlement instruction
 * (area 12) exists) -> SETTLED (settlement finality recorded). A net
 * obligation never passes through NETTED — it IS the product of netting
 * (A10 lines 95-97 reserves CREATED -> NETTED for gross obligations
 * "replaced by net positions in a committed netting set (area 11)"). All
 * states and their driving conditions use the A10 vocabulary verbatim
 * (lines 92-99).
 *
 * Source: clearing-netting-settlement.md lines 92-99 (the state
 * vocabulary), 161-163 ("replaced by net obligations in the ledger"),
 * 205-206 ("Netting never settles; it only transforms obligations").
 */
export const NET_OBLIGATION_STATES: readonly [
  'CREATED',
  'SETTLEMENT_PENDING',
  'SETTLED',
] = Object.freeze(['CREATED', 'SETTLEMENT_PENDING', 'SETTLED'] as const);

/**
 * A NetObligation state.
 *
 * Source: clearing-netting-settlement.md lines 92-99 (the vocabulary).
 */
export type NetObligationState = (typeof NET_OBLIGATION_STATES)[number];

/**
 * The frozen one-way NetObligation transition table: CREATED ->
 * SETTLEMENT_PENDING -> SETTLED; SETTLED is terminal with an empty
 * successor set ("FINAL advances the obligation to SETTLED exactly once" —
 * A12 INV-12-4; the A10 SETTLED mirror).
 *
 * Source: clearing-netting-settlement.md lines 92-99; §4 Area 12 lines
 * 236-240, 259-262 (INV-12-4).
 */
export const NET_OBLIGATION_TRANSITIONS: Readonly<
  Record<NetObligationState, readonly NetObligationState[]>
> = Object.freeze({
  CREATED: Object.freeze(['SETTLEMENT_PENDING'] as const),
  SETTLEMENT_PENDING: Object.freeze(['SETTLED'] as const),
  SETTLED: Object.freeze([] as const),
});

/**
 * Runtime type guard for NetObligationState.
 *
 * Source: clearing-netting-settlement.md lines 92-99.
 */
export function isNetObligationState(value: unknown): value is NetObligationState {
  return (
    typeof value === 'string' && (NET_OBLIGATION_STATES as readonly string[]).includes(value)
  );
}

/**
 * True iff the (from, to) pair is a legal NetObligation transition.
 *
 * Source: clearing-netting-settlement.md lines 92-99.
 */
export function canTransitionNetObligation(
  from: NetObligationState,
  to: NetObligationState,
): boolean {
  return NET_OBLIGATION_TRANSITIONS[from].includes(to);
}

/**
 * NetObligation — the materialized form of one nonzero bilateral net flow
 * between two participants in a committed netting set ("replaced by net
 * obligations in the ledger", lines 161-163): the debtor, the creditor,
 * the positive integer Money amount, and the link to the producing set.
 * Deterministic identity: the id is derived from (netting set id, debtor,
 * creditor, currency), so identical sets materialize identical net
 * obligations (GC-1 / INV-11-3).
 *
 * Source: clearing-netting-settlement.md lines 161-163, 165-166; §2 Area 10
 * lines 113-116 (INV-10-1 discipline: the amount is set once, at
 * materialization).
 */
export interface NetObligationRecord {
  readonly netObligationId: string;
  readonly nettingSetId: string;
  readonly debtorParticipantId: string;
  readonly creditorParticipantId: string;
  readonly amount: Money;
  readonly state: NetObligationState;
  readonly createdAt: ProtocolTime;
  readonly stateChangedAt: ProtocolTime;
}

// ---------------------------------------------------------------------------
// Typed rejections and command results
// ---------------------------------------------------------------------------

/**
 * The Netting Authority's typed rejection codes. NETTING_SET_NOT_FOUND /
 * NETTING_SET_EXISTS (label-derived ids); OBLIGATION_NOT_FOUND /
 * DUPLICATE_INPUT / OBLIGATION_NOT_CREATED / OBLIGATION_DISPUTED (the
 * OPEN-time validation gates — "Netting never includes obligations in
 * DISPUTED state" is a typed refusal, not a silent skip);
 * PARTICIPANTS_OUT_OF_SCOPE / INVALID_SCOPE (the NettingScope contract);
 * ILLEGAL_TRANSITION (the frozen machines); ALREADY_CLAIMED (INV-11-2);
 * NOT_COMPUTED / CONSERVATION_FAILED / OBLIGATION_CHANGED (the commit
 * gates); NET_OBLIGATION_NOT_FOUND.
 *
 * Source: clearing-netting-settlement.md lines 155-209 (the gates the
 * rejections ground); the merged typed-rejection convention
 * (RTN-005/006/007/008).
 */
export const NETTING_REJECTION_CODES: readonly [
  'NETTING_SET_NOT_FOUND',
  'NETTING_SET_EXISTS',
  'OBLIGATION_NOT_FOUND',
  'DUPLICATE_INPUT',
  'OBLIGATION_NOT_CREATED',
  'OBLIGATION_DISPUTED',
  'OBLIGATION_CHANGED',
  'INVALID_SCOPE',
  'PARTICIPANTS_OUT_OF_SCOPE',
  'ALREADY_CLAIMED',
  'ILLEGAL_TRANSITION',
  'NOT_COMPUTED',
  'CONSERVATION_FAILED',
  'NET_OBLIGATION_NOT_FOUND',
] = Object.freeze([
  'NETTING_SET_NOT_FOUND',
  'NETTING_SET_EXISTS',
  'OBLIGATION_NOT_FOUND',
  'DUPLICATE_INPUT',
  'OBLIGATION_NOT_CREATED',
  'OBLIGATION_DISPUTED',
  'OBLIGATION_CHANGED',
  'INVALID_SCOPE',
  'PARTICIPANTS_OUT_OF_SCOPE',
  'ALREADY_CLAIMED',
  'ILLEGAL_TRANSITION',
  'NOT_COMPUTED',
  'CONSERVATION_FAILED',
  'NET_OBLIGATION_NOT_FOUND',
] as const);

/**
 * A Netting Authority rejection code.
 *
 * Source: clearing-netting-settlement.md lines 155-209.
 */
export type NettingRejectionCode = (typeof NETTING_REJECTION_CODES)[number];

/**
 * Runtime type guard for NettingRejectionCode.
 *
 * Source: clearing-netting-settlement.md lines 155-209.
 */
export function isNettingRejectionCode(value: unknown): value is NettingRejectionCode {
  return (
    typeof value === 'string' && (NETTING_REJECTION_CODES as readonly string[]).includes(value)
  );
}

/**
 * The typed result shape of every Netting Authority command (the merged
 * convention — domain rejections are values, never thrown).
 *
 * Source: the merged command convention (RTN-005/006/007/008); A11 lines
 * 177-189 (the INV gates the rejections ground).
 */
export type NettingCommandResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: NettingRejectionCode; readonly message: string };

/**
 * The read view of one A10 obligation the Netting Authority needs (the
 * projection of the ledger — "every downstream netting or settlement fact
 * is a projection of it", A10 lines 80-87).
 *
 * Source: clearing-netting-settlement.md §2 Area 10 lines 80-87.
 */
export type ObligationView = ObligationRecord;
