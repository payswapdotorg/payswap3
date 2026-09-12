/**
 * RTN-006 — Reservation Authority: the A05 type vocabulary, state machine
 * tables, ledger entry shapes, and runtime guards.
 *
 * Spec sources (binding) — spec/architecture/v0.1/core.md §5 Area 5:
 *   lines 286-291 (Reservation — the object and state machine, verbatim):
 *     "Reservation — hold on a resource (liquidity position, credit
 *      exposure, or capability commitment) for one intent and one hop.
 *      States: REQUESTED -> HELD -> terminal(CONSUMED | RELEASED |
 *      EXPIRED).
 *      Each reservation carries a deadline; expiry is deterministic on
 *      protocol time."
 *   lines 293-295 (ReservationLedger):
 *     "ReservationLedger — per-resource serialized log of reservation
 *      transitions. The ledger is the concurrency frontier: all resource
 *      mutations pass through it in sequence order."
 *   lines 304-312 (INV-5-1 / INV-5-2 / INV-5-3, quoted in the enforcing
 *   modules: resource.ts, ledger.ts, and the reservation-id derivation
 *   below).
 *   lines 316-322 (failure and UNKNOWN semantics — the ledger-tail crash
 *     recovery rule and the UNKNOWN-holds-stay-HELD rule).
 *   lines 326-328 (evidence produced — RESERVATION_HELD / CONSUMED /
 *     RELEASED / EXPIRED with ledger sequence number and arithmetic
 *     identity proofs).
 *   lines 330-336 (boundaries: reservations are not obligations; the
 *     ledger initiates no external effects; "Depends on areas 6, 7, and 3
 *     as resource owners").
 *   spec/architecture/v0.1/README.md §3 GC-1/GC-2/GC-4/GC-5.
 *   spec/registry/protocol-registry.json A05 — owningAuthority:
 *     "Reservation Authority".
 *
 * Transition-table interpretation (recorded in CONTRACT-REVIEW.md): the
 * v0.1 chain is REQUESTED -> HELD -> terminal(CONSUMED | RELEASED |
 * EXPIRED). The area's own failure semantics add the REQUESTED -> RELEASED
 * edge, and it is load-bearing:
 *   - INV-5-2 (lines 307-309): "a REQUESTED transition either becomes HELD
 *     or is rejected — never left ambiguous" — a rejected request resolves
 *     REQUESTED to the RELEASED terminal (the recorded, unambiguous
 *     outcome; the rejection reason rides the release).
 *   - Crash recovery (lines 316-318): "REQUESTED without a subsequent
 *     transition is rolled forward to HELD or rolled back to RELEASED
 *     based on the recorded decision, never duplicated" — the roll-back
 *     edge is REQUESTED -> RELEASED.
 * REQUESTED -> CONSUMED and REQUESTED -> EXPIRED do not exist: a hold is
 * consumed or expired only while HELD ("RESERVED commitments count against
 * capability capacity" is area 3's mirror of the same rule). Every terminal
 * has an empty successor set — the exactly-once discipline is structural.
 */

import type { Money } from '../kernel/money.ts';
import type { ProtocolTime } from '../kernel/time.ts';

/**
 * The Reservation state vocabulary, verbatim from the v0.1 chain.
 *
 * Source: core.md lines 288-289 — "States: REQUESTED -> HELD ->
 * terminal(CONSUMED | RELEASED | EXPIRED)."
 */
export const RESERVATION_STATES: readonly [
  'REQUESTED',
  'HELD',
  'CONSUMED',
  'RELEASED',
  'EXPIRED',
] = Object.freeze(['REQUESTED', 'HELD', 'CONSUMED', 'RELEASED', 'EXPIRED'] as const);

/**
 * A Reservation state. CONSUMED, RELEASED, and EXPIRED are terminal
 * ("CONSUMED and RELEASED are exactly-once terminals", INV-5-3, lines
 * 311-312; EXPIRED is the deadline-driven terminal, lines 290-291).
 *
 * Source: core.md lines 288-289, 310-312.
 */
export type ReservationState = (typeof RESERVATION_STATES)[number];

/**
 * The frozen one-way Reservation transition table. The REQUESTED ->
 * RELEASED edge is the INV-5-2 rejection resolution and the crash-recovery
 * roll-back (see the module doc); every terminal has an empty successor
 * set.
 *
 * Source: core.md lines 288-289 (the chain), 307-309 (INV-5-2), 316-318
 * (crash recovery).
 */
export const RESERVATION_TRANSITIONS: Readonly<
  Record<ReservationState, readonly ReservationState[]>
> = Object.freeze({
  REQUESTED: Object.freeze(['HELD', 'RELEASED'] as const),
  HELD: Object.freeze(['CONSUMED', 'RELEASED', 'EXPIRED'] as const),
  CONSUMED: Object.freeze([] as const),
  RELEASED: Object.freeze([] as const),
  EXPIRED: Object.freeze([] as const),
});

/**
 * Runtime type guard for ReservationState.
 *
 * Source: core.md lines 288-289 (the vocabulary this guard re-checks).
 */
export function isReservationState(value: unknown): value is ReservationState {
  return typeof value === 'string' && (RESERVATION_STATES as readonly string[]).includes(value);
}

/**
 * True iff the (from, to) pair is a legal one-way Reservation transition.
 *
 * Source: core.md lines 288-289 (the chain this table materializes);
 * lines 307-309 (INV-5-2), 316-318 (crash recovery).
 */
export function canTransitionReservation(from: ReservationState, to: ReservationState): boolean {
  return RESERVATION_TRANSITIONS[from].includes(to);
}

/**
 * The A05 reason-code vocabulary — the machine-readable codes the
 * RESERVATION_* evidence records' outcome slots carry and the recorded
 * decisions the ledger tail's recovery consumes. Members (each grounded or
 * a recorded interpretation, see CONTRACT-REVIEW.md):
 *   - INSUFFICIENT_AVAILABLE — INV-5-1 (core.md lines 304-306): a REQUESTED
 *     hold the resource's available balance cannot cover is rejected
 *     (resolved REQUESTED -> RELEASED, never ambiguous — INV-5-2).
 *   - DEADLINE_EXPIRED — core.md lines 290-291: "Each reservation carries
 *     a deadline; expiry is deterministic on protocol time" (the HELD ->
 *     EXPIRED terminal's reason).
 *   - RECOVERY_ROLLFORWARD / RECOVERY_ROLLBACK — core.md lines 316-318:
 *     "REQUESTED without a subsequent transition is rolled forward to HELD
 *     or rolled back to RELEASED based on the recorded decision, never
 *     duplicated" (the recovery-applied resolutions' provenance).
 *
 * Source: core.md lines 288-318; A15 line 30 ("outcome: resulting state or
 * decision, including reason codes").
 */
export const RESERVATION_REASON_CODES: readonly [
  'INSUFFICIENT_AVAILABLE',
  'DEADLINE_EXPIRED',
  'RECOVERY_ROLLFORWARD',
  'RECOVERY_ROLLBACK',
] = Object.freeze([
  'INSUFFICIENT_AVAILABLE',
  'DEADLINE_EXPIRED',
  'RECOVERY_ROLLFORWARD',
  'RECOVERY_ROLLBACK',
] as const);

/** An A05 reason code. Source: the frozen vocabulary above. */
export type ReservationReasonCode = (typeof RESERVATION_REASON_CODES)[number];

/**
 * Runtime type guard for ReservationReasonCode.
 *
 * Source: A15 line 30 (the reason-code contract this guards); core.md
 * lines 288-318.
 */
export function isReservationReasonCode(value: unknown): value is ReservationReasonCode {
  return typeof value === 'string' && (RESERVATION_REASON_CODES as readonly string[]).includes(value);
}

/**
 * Reservation — the hold on a resource for one intent and one hop, as
 * recorded by the ledger. The reservation id is derived from (intent id,
 * hop id, resource id) — INV-5-3 — so a duplicate request deterministically
 * names the recorded reservation.
 *
 * Source: core.md lines 286-291; INV-5-3 lines 310-312.
 */
export interface ReservationRecord {
  /** deriveProtocolId('reservation', intentId, hopId, resourceId) — INV-5-3. */
  readonly reservationId: string;
  readonly intentId: string;
  readonly hopId: string;
  readonly resourceId: string;
  /** The held amount — integer Money in the resource's unit. */
  readonly amount: Money;
  readonly state: ReservationState;
  /** The hold's deadline (integer epoch ms); expiry is deterministic on protocol time. */
  readonly deadlineEpochMs: number;
  /** The recorded reason when the terminal carries one (rejection, expiry, recovery). */
  readonly reasonCode?: ReservationReasonCode;
  readonly createdAt: ProtocolTime;
  readonly stateChangedAt: ProtocolTime;
}

/**
 * The kind of one ledger entry — the per-resource serialized log's row
 * vocabulary: the resource owner's declaration (the INV-5-1 identity's
 * declared-total input, "Depends on areas 6, 7, and 3 as resource owners",
 * core.md lines 335-336) and the five reservation transitions.
 *
 * Source: core.md lines 293-295 ("per-resource serialized log of
 * reservation transitions. The ledger is the concurrency frontier: all
 * resource mutations pass through it in sequence order"); lines 288-289
 * (the transition vocabulary); lines 304-306 (INV-5-1's declared total).
 */
export const RESERVATION_ENTRY_KINDS: readonly [
  'RESOURCE_DECLARED',
  'REQUESTED',
  'HELD',
  'CONSUMED',
  'RELEASED',
  'EXPIRED',
] = Object.freeze([
  'RESOURCE_DECLARED',
  'REQUESTED',
  'HELD',
  'CONSUMED',
  'RELEASED',
  'EXPIRED',
] as const);

/** A ledger entry kind. Source: the frozen list above. */
export type ReservationEntryKind = (typeof RESERVATION_ENTRY_KINDS)[number];

/**
 * Runtime type guard for ReservationEntryKind.
 *
 * Source: core.md lines 293-295 (the log's vocabulary this guards).
 */
export function isReservationEntryKind(value: unknown): value is ReservationEntryKind {
  return typeof value === 'string' && (RESERVATION_ENTRY_KINDS as readonly string[]).includes(value);
}

/**
 * One entry of the per-resource serialized log — the durable, append-only
 * fact a transition (or a resource declaration) is. Every resource mutation
 * passes through the ledger as one such entry, in sequence order.
 *
 * Sequencing: `resourceSequence` is the entry's position in the resource's
 * TOTAL order (INV-5-2: "transitions for the same resource are totally
 * ordered by the ledger sequence"); `globalSequence` is the entry's
 * position in the whole ledger's total order (the cross-resource view the
 * entries() snapshot and the durable store carry).
 *
 * The REQUESTED entry records the DECISION ("HOLD" or "REJECT") — the
 * deterministic input the ledger tail's crash recovery consumes ("rolled
 * forward to HELD or rolled back to RELEASED based on the recorded
 * decision", core.md lines 316-318).
 *
 * Source: core.md lines 293-295 (the log), 307-309 (INV-5-2), 316-318
 * (crash recovery); INV-5-1 lines 304-306 (the declared total on
 * RESOURCE_DECLARED entries).
 */
export interface ReservationLedgerEntry {
  /** The entry's position in the whole ledger's total order. */
  readonly globalSequence: number;
  /** The entry's position in its resource's total order (INV-5-2). */
  readonly resourceSequence: number;
  readonly resourceId: string;
  /** The reservation this entry transitions (undefined for RESOURCE_DECLARED). */
  readonly reservationId?: string;
  /** The requesting intent's id (REQUESTED entries — INV-5-3's derivation part). */
  readonly intentId?: string;
  /** The requesting hop's id (REQUESTED entries — INV-5-3's derivation part). */
  readonly hopId?: string;
  readonly entryKind: ReservationEntryKind;
  /** The requested hold's amount (REQUESTED entries) or the declared total (RESOURCE_DECLARED entries). */
  readonly amount?: Money;
  /** The requested hold's deadline (REQUESTED entries). */
  readonly deadlineEpochMs?: number;
  /** The recorded decision (REQUESTED entries) — the crash-recovery input. */
  readonly decision?: 'HOLD' | 'REJECT';
  /** The transition's reason code (RELEASED / EXPIRED entries, when one applies). */
  readonly reasonCode?: ReservationReasonCode;
  readonly at: ProtocolTime;
}

/**
 * The typed rejection codes of the Reservation Authority's command surface
 * (domain rejections are typed values, never thrown — the merged rails
 * command convention). Rejections emit NO evidence: a refused command
 * mutates no state, and A05's named evidence set is exhaustive.
 *
 * Source: core.md lines 326-328 (the exhaustive named set); the rails
 * typed-rejection convention.
 */
export const RESERVATION_REJECTION_CODES: readonly [
  'RESERVATION_NOT_FOUND',
  'RESOURCE_NOT_DECLARED',
  'RESOURCE_ALREADY_DECLARED',
  'ILLEGAL_TRANSITION',
  'UNIT_MISMATCH',
] = Object.freeze([
  'RESERVATION_NOT_FOUND',
  'RESOURCE_NOT_DECLARED',
  'RESOURCE_ALREADY_DECLARED',
  'ILLEGAL_TRANSITION',
  'UNIT_MISMATCH',
] as const);

/** A Reservation Authority rejection code. Source: the frozen list above. */
export type ReservationRejectionCode = (typeof RESERVATION_REJECTION_CODES)[number];

/**
 * The outcome of a request command: the recorded reservation — HELD
 * (held: true), or the recorded terminal of a rejected or already-resolved
 * request (held: false — INV-5-3: "duplicate requests return the recorded
 * state") — or a typed command rejection (an undeclared resource, a
 * unit-mismatched amount).
 *
 * Source: core.md lines 286-289 (the machine); INV-5-2 lines 307-309
 * (HOLD-or-rejected, never ambiguous); INV-5-3 lines 310-312.
 */
export type ReservationRequestResult =
  | {
      readonly ok: true;
      readonly replayed: boolean;
      /** True iff the recorded state is HELD. */
      readonly held: boolean;
      readonly reservation: ReservationRecord;
    }
  | {
      readonly ok: false;
      readonly code: ReservationRejectionCode;
      readonly problem: string;
    };

/**
 * The outcome of a terminal command (consume / release / expire): the
 * updated reservation — or the RECORDED reservation when the terminal was
 * already applied (replayed: true — the exactly-once discipline as
 * idempotent observation: the transition's effect exists exactly once, and
 * a repeat command returns the recorded state without a second effect) —
 * or a typed rejection.
 *
 * Source: core.md lines 310-312 ("CONSUMED and RELEASED are exactly-once
 * terminals"); lines 319-322 ("consumed or released exactly once (GC-2)").
 */
export type ReservationTerminalCommandResult =
  | {
      readonly ok: true;
      readonly replayed: boolean;
      readonly reservation: ReservationRecord;
    }
  | {
      readonly ok: false;
      readonly code: ReservationRejectionCode;
      readonly problem: string;
    };

/**
 * The outcome of a resource declaration: the resource's accounting
 * (replayed: true when the identical total was already declared), or a
 * typed rejection.
 *
 * Source: core.md lines 304-306 (INV-5-1's declared total), lines 335-336
 * ("Depends on areas 6, 7, and 3 as resource owners").
 */
export type ResourceDeclarationResult =
  | {
      readonly ok: true;
      readonly replayed: boolean;
      readonly resourceId: string;
    }
  | {
      readonly ok: false;
      readonly code: ReservationRejectionCode;
      readonly problem: string;
    };

/**
 * The report of one ledger-tail recovery run: which dangling REQUESTED
 * entries were resolved, how ("rolled forward to HELD or rolled back to
 * RELEASED based on the recorded decision"), and the log length the
 * recovery ran over ("never duplicated" — the resolutions extend the log,
 * each exactly once).
 *
 * Source: core.md lines 316-318.
 */
export interface LedgerRecoveryReport {
  readonly resolved: readonly {
    readonly reservationId: string;
    readonly resourceId: string;
    readonly action: 'ROLLFORWARD_HELD' | 'ROLLBACK_RELEASED';
    readonly reasonCode: ReservationReasonCode;
  }[];
  /** The log length the recovery inspected (before the resolutions extended it). */
  readonly inspectedEntries: number;
}
