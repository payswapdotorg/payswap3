/**
 * RTN-006 — Reservation Authority: the pure state-machine application over
 * Reservation records (the typed, decision-free layer the ledger
 * composes).
 *
 * Spec sources (binding) — spec/architecture/v0.1/core.md §5 Area 5:
 *   lines 288-289 (the state machine, verbatim):
 *     "States: REQUESTED -> HELD -> terminal(CONSUMED | RELEASED |
 *      EXPIRED)."
 *   lines 290-291 (the deterministic deadline rule):
 *     "Each reservation carries a deadline; expiry is deterministic on
 *      protocol time."
 *   lines 307-309 (INV-5-2 — the never-ambiguous REQUESTED resolution);
 *   lines 316-318 (crash recovery — the roll-forward / roll-back edges).
 *
 * This module is PURE: it maps (record, target state) to either the updated
 * record or a typed rejection, and the deadline rule to a boolean; it
 * touches no store, no clock, no evidence port. The ledger (ledger.ts)
 * owns per-resource serialization, the append-only log, evidence, and
 * commit ordering.
 */

import type { ProtocolTime } from '../kernel/time.ts';
import type {
  ReservationRecord,
  ReservationReasonCode,
  ReservationRejectionCode,
  ReservationState,
  ReservationTerminalCommandResult,
} from './types.ts';
import { canTransitionReservation } from './types.ts';

/**
 * Apply one state transition to a Reservation record — pure. Returns the
 * updated record (same identity, same amount and deadline, new state and
 * stateChangedAt, plus the terminal's reason code when one applies) or a
 * typed rejection:
 *   - ILLEGAL_TRANSITION — the (from, to) pair is not in the frozen table.
 *     This covers every exactly-once violation (CONSUMED/RELEASED/EXPIRED
 *     have empty successor sets: a second consume, a release of a consumed
 *     hold, an expiry of a released hold — all unrepresentable) and every
 *     skip of HELD (REQUESTED -> CONSUMED does not exist).
 *
 * Source: core.md lines 288-289 (the chain); INV-5-3 lines 310-312
 * ("CONSUMED and RELEASED are exactly-once terminals"); lines 316-318 (the
 * roll-back edge).
 */
export function transitionReservation(
  reservation: ReservationRecord,
  target: ReservationState,
  at: ProtocolTime,
  options: { readonly reasonCode?: ReservationReasonCode } = {},
): ReservationTerminalCommandResult {
  if (!canTransitionReservation(reservation.state, target)) {
    return {
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      problem:
        `reservation ${reservation.reservationId}: illegal one-way transition ` +
        `${reservation.state} -> ${target} (core.md A05 lines 288-289; CONSUMED and RELEASED are ` +
        'exactly-once terminals — INV-5-3, lines 310-312)',
    };
  }
  const { reasonCode } = options;
  if (reasonCode !== undefined && target !== 'RELEASED' && target !== 'EXPIRED') {
    return {
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      problem:
        `reservation ${reservation.reservationId}: a reason code rides only RELEASED and EXPIRED ` +
        '(core.md A05 lines 326-328 — the evidence outcome slots that carry reason codes)',
    };
  }
  const updated: ReservationRecord = {
    ...reservation,
    state: target,
    ...(reasonCode === undefined && reservation.reasonCode === undefined
      ? {}
      : reasonCode === undefined
        ? {}
        : { reasonCode }),
    stateChangedAt: at,
  };
  return { ok: true, replayed: false, reservation: updated };
}

/**
 * The deterministic expiry predicate — pure: a HELD reservation is expired
 * at a protocol time iff the time's wall-clock component has reached the
 * reservation's deadline. The comparison is an integer epoch-millisecond
 * comparison (GC-1); the rule is a total function of (deadline, protocol
 * time), so "expiry is deterministic on protocol time" holds by
 * construction.
 *
 * Interpretation (recorded in CONTRACT-REVIEW.md): the deadline is the
 * LAST instant the hold is valid — at wallMs === deadlineEpochMs the hold
 * expires (expired iff wallMs >= deadlineEpochMs).
 *
 * Source: core.md lines 290-291 — "Each reservation carries a deadline;
 * expiry is deterministic on protocol time."
 */
export function isExpiredAt(reservation: ReservationRecord, at: ProtocolTime): boolean {
  return reservation.state === 'HELD' && at.wallMs >= reservation.deadlineEpochMs;
}

/**
 * Guard: the REQUESTED state's resolution rule — INV-5-2's "a REQUESTED
 * transition either becomes HELD or is rejected — never left ambiguous".
 * The legal resolutions of REQUESTED are exactly HELD (the hold succeeded)
 * and RELEASED (the rejection / the crash-recovery roll-back).
 *
 * Source: core.md lines 307-309, 316-318.
 */
export function isRequestedResolution(target: ReservationState): boolean {
  return target === 'HELD' || target === 'RELEASED';
}
