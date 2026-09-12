/**
 * RTN-006 — Reservation Authority: the ReservationAcquisition port
 * implementation over the ReservationLedger (routing's area-5 dependency).
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/core.md §4 Area 4, lines 245-247 (INV-4-2 —
 *   the port's request operation is dispatch's acquisition step):
 *     "INV-4-2 (concurrency): a plan is compiled against one capability
 *      snapshot id; dispatch acquires reservations (area 5) in the plan's
 *      fixed hop order."
 *   spec/architecture/v0.1/core.md §4 Area 4, lines 272-273:
 *     "Depends on areas 1-3 for inputs and area 5 for reservation
 *      acquisition during dispatch."
 *   spec/architecture/v0.1/core.md §5 Area 5, lines 310-312 (INV-5-3 —
 *   the derived reservation ids the port references) and lines 319-322
 *   (the UNKNOWN-holds terminal discipline the port's consume/release
 *   operations carry):
 *     "When a downstream rail operation is UNKNOWN, associated
 *      reservations remain HELD until reconciliation resolves the
 *      operation; they are then consumed or released exactly once (GC-2)."
 *
 * Design (recorded in CONTRACT-REVIEW.md): the port TYPE is declared by
 * routing (the consumer — dependency inversion, the kernel's
 * EvidenceSubmission pattern); this module implements it structurally over
 * the ledger, TYPE-ONLY-importing the port shape from the sibling surface
 * (both surfaces are this work order's owned prefixes). The adapter maps:
 *   - request: the ledger's recorded outcome — HELD is the acquisition
 *     success; a recorded rejection (the REQUESTED -> RELEASED resolution
 *     with reason INSUFFICIENT_AVAILABLE) is the typed INSUFFICIENT_AVAILABLE
 *     failure; any other recorded non-HELD state is the typed NOT_HELD
 *     failure with the recorded state named (deterministic in both cases —
 *     INV-5-3's "duplicate requests return the recorded state" makes the
 *     first and the replayed request map identically);
 *   - consume / release: the ledger's exactly-once terminals, mapped to
 *     the port's terminal observations;
 *   - stateOf: the ledger's recorded state, for the dispatch unwind and
 *     the plan-terminal flows ("release only what is still HELD").
 */

import type {
  ReservationAcquisition,
  ReservationAcquisitionRequest,
  ReservationAcquisitionResult,
  ReservationTerminalResult,
} from '../routing/types.ts';
import type { ReservationLedger } from './ledger.ts';

/**
 * Build the ReservationAcquisition port over a ReservationLedger — the
 * area-5 dependency the Routing Authority's dispatch drives (INV-4-2's
 * fixed-hop-order acquisition) and its plan-terminal flows consume/release
 * through.
 *
 * Source: core.md lines 245-247, 272-273, 310-312, 319-322.
 */
export function createReservationAcquisitionPort(
  ledger: ReservationLedger,
): ReservationAcquisition {
  return {
    request: async (
      request: ReservationAcquisitionRequest,
    ): Promise<ReservationAcquisitionResult> => {
      const result = await ledger.requestReservation({
        intentId: request.intentId,
        hopId: request.hopId,
        resourceId: request.resourceId,
        amount: request.amount,
        deadlineEpochMs: request.deadlineEpochMs,
      });
      if (result.ok) {
        if (result.held) {
          return { ok: true, reservationId: result.reservation.reservationId };
        }
        // The recorded rejection of the REQUESTED hold (INV-5-2: rejected —
        // never ambiguous) or another recorded non-HELD terminal.
        if (result.reservation.reasonCode === 'INSUFFICIENT_AVAILABLE') {
          return {
            ok: false,
            code: 'INSUFFICIENT_AVAILABLE',
            problem:
              `reservation for hop ${request.hopId} on resource ${request.resourceId} was ` +
              `rejected: the available balance cannot cover ${request.amount.amountMinor} ` +
              `${request.amount.currency} (INV-5-1/INV-5-2, core.md lines 304-309)`,
          };
        }
        return {
          ok: false,
          code: `NOT_HELD_${result.reservation.state}`,
          problem:
            `reservation for hop ${request.hopId} on resource ${request.resourceId} is ` +
            `recorded in state ${result.reservation.state} (INV-5-3: duplicate requests ` +
            'return the recorded state — core.md lines 310-312)',
        };
      }
      return { ok: false, code: result.code, problem: result.problem };
    },
    consume: async (reservationId: string): Promise<ReservationTerminalResult> => {
      const result = await ledger.consumeReservation(reservationId);
      if (result.ok) {
        return { ok: true, terminal: 'CONSUMED' };
      }
      return { ok: false, code: result.code, problem: result.problem };
    },
    release: async (reservationId: string): Promise<ReservationTerminalResult> => {
      const result = await ledger.releaseReservation(reservationId);
      if (result.ok) {
        return { ok: true, terminal: 'RELEASED' };
      }
      return { ok: false, code: result.code, problem: result.problem };
    },
    stateOf: (reservationId: string) => ledger.reservation(reservationId)?.state,
  };
}
