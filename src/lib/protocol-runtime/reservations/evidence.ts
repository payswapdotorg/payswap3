/**
 * RTN-006 — Reservation Authority: A05 evidence emission through the
 * kernel-declared EvidenceSubmission port, to the REAL A15 log (RTN-002,
 * merged at this item's base).
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/core.md §5 Area 5, lines 326-328 (the complete
 *   named evidence set of the area):
 *     "Evidence produced
 *      - RESERVATION_HELD, RESERVATION_CONSUMED, RESERVATION_RELEASED,
 *        RESERVATION_EXPIRED (proof: ledger sequence number and arithmetic
 *        identity after transition)."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   26-32 (the exact five-slot record shape: what/when/authority/outcome/
 *   proof) and lines 62-64 (the synchronous coupling):
 *     "Evidence writing is internal and synchronous with the operation it
 *      records: an operation is not committed until its record is written.
 *      A failed write fails the operation."
 *   spec/architecture/v0.1/README.md §3 GC-5 lines 63-67 (exactly one
 *   record per consequential operation).
 *   spec/registry/protocol-registry.json A05 — owningAuthority:
 *     "Reservation Authority" (the 'authority' slot value; validated by
 *     the real log against EVIDENCE_AUTHORITIES).
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - One record per consequential transition, exactly the named set:
 *     the resolution of REQUESTED (-> HELD or -> RELEASED) writes
 *     RESERVATION_HELD / RESERVATION_RELEASED; CONSUMED, RELEASED, and
 *     EXPIRED write their own records; recovery-applied resolutions write
 *     the same types with their recovery reason codes. The REQUESTED entry
 *     itself emits NO record (no RESERVATION_REQUESTED type exists in the
 *     named set — it is the pre-commit log fact whose decision crash
 *     recovery consumes; A05's named set is exhaustive, the RTN-005
 *     precedent). Resource declarations emit no record for the same
 *     reason (the declaration is the resource-owner integration input of
 *     INV-5-1, not a reservation transition).
 *   - Proof slot mapping of "(proof: ledger sequence number and arithmetic
 *     identity after transition)": proof.sequenceNumbers = the transition
 *     entry's PER-RESOURCE sequence position (INV-5-2's cited ordering:
 *     "transitions for the same resource are totally ordered by the ledger
 *     sequence"); proof.hashes = the post-transition arithmetic-identity
 *     hash (resource.ts resourceArithmeticIdentityHash — the verifiable
 *     encoding of the INV-5-1 identity).
 *   - what.subjectIds: the reservation id, resource id, intent id, and hop
 *     id (the subject object ids the record is about — A15 line 27).
 *   - Emission is submit-then-commit at the ledger layer: a failed
 *     submission throws and nothing is committed ("A failed write fails
 *     the operation").
 */

import type {
  EvidenceSubmission,
  EvidenceSubmissionRecord,
} from '../kernel/ports.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { isProtocolTime } from '../kernel/time.ts';
import type { ResourceAccounting } from './resource.ts';
import { resourceArithmeticIdentityHash } from './resource.ts';
import type { ReservationRecord, ReservationReasonCode } from './types.ts';

/**
 * The authority identity recorded in the 'authority' slot of A05's records —
 * the registry's owning authority name for area 5.
 *
 * Source: spec/registry/protocol-registry.json A05 — "owningAuthority":
 * "Reservation Authority".
 */
export const RESERVATION_AUTHORITY_ID = 'Reservation Authority';

/**
 * The A05 evidence operation-type vocabulary — exactly the four named
 * types, frozen (no inventions).
 *
 * Source: core.md lines 326-328 (the named set quoted in the module doc).
 */
export const RESERVATION_EVIDENCE_VOCABULARY = Object.freeze({
  heldOperationType: 'RESERVATION_HELD',
  consumedOperationType: 'RESERVATION_CONSUMED',
  releasedOperationType: 'RESERVATION_RELEASED',
  expiredOperationType: 'RESERVATION_EXPIRED',
} as const);

function assertWhen(when: unknown): asserts when is ProtocolTime {
  if (!isProtocolTime(when)) {
    throw new TypeError('reservation evidence: when must be a well-formed ProtocolTime');
  }
}

function assertReservation(reservation: ReservationRecord): void {
  if (reservation === null || typeof reservation !== 'object') {
    throw new TypeError('reservation evidence: reservation must be a ReservationRecord');
  }
}

/**
 * Build one RESERVATION_* record for a resolved transition. Slot mapping
 * (see the module doc): what.subjectIds = [reservationId, resourceId,
 * intentId, hopId]; outcome = the resulting state with its reason code
 * when one applies; proof.sequenceNumbers = [resourceSequence];
 * proof.hashes = [post-transition arithmetic-identity hash].
 *
 * Source: core.md lines 326-328; A15 lines 26-32; GC-5.
 */
function reservationEvidence(input: {
  readonly operationType: string;
  readonly reservation: ReservationRecord;
  readonly requiredState: 'HELD' | 'CONSUMED' | 'RELEASED' | 'EXPIRED';
  readonly when: ProtocolTime;
  readonly resourceSequence: number;
  readonly accounting: ResourceAccounting;
  readonly reasonCode?: ReservationReasonCode;
}): EvidenceSubmissionRecord {
  const { operationType, reservation, requiredState, when, resourceSequence, accounting, reasonCode } =
    input;
  assertWhen(when);
  assertReservation(reservation);
  if (reservation.state !== requiredState) {
    throw new TypeError(
      `reservation evidence: ${operationType} requires the reservation in ${requiredState} ` +
        `(got ${reservation.state})`,
    );
  }
  if (accounting.resourceId !== reservation.resourceId) {
    throw new TypeError(
      `reservation evidence: accounting is for resource ${accounting.resourceId}, ` +
        `not the reservation's resource ${reservation.resourceId}`,
    );
  }
  return {
    what: {
      operationType,
      subjectIds: [
        reservation.reservationId,
        reservation.resourceId,
        reservation.intentId,
        reservation.hopId,
      ],
    },
    when,
    authority: RESERVATION_AUTHORITY_ID,
    outcome: {
      result: requiredState,
      ...(reasonCode === undefined ? {} : { reasonCode }),
    },
    proof: {
      sequenceNumbers: [resourceSequence],
      hashes: [resourceArithmeticIdentityHash(accounting)],
    },
  };
}

/**
 * Build the RESERVATION_HELD record — the REQUESTED -> HELD resolution
 * (fresh or recovery roll-forward).
 *
 * Source: core.md lines 326-328 ("RESERVATION_HELD"); lines 316-318 (the
 * recovery roll-forward writes the same record type with its recovery
 * reason code); A15 lines 26-32; GC-5.
 */
export function reservationHeldEvidence(input: {
  readonly reservation: ReservationRecord;
  readonly when: ProtocolTime;
  readonly resourceSequence: number;
  readonly accounting: ResourceAccounting;
  readonly reasonCode?: ReservationReasonCode;
}): EvidenceSubmissionRecord {
  return reservationEvidence({
    operationType: RESERVATION_EVIDENCE_VOCABULARY.heldOperationType,
    requiredState: 'HELD',
    ...input,
  });
}

/**
 * Build the RESERVATION_CONSUMED record — HELD -> CONSUMED.
 *
 * Source: core.md lines 326-328 ("RESERVATION_CONSUMED"); INV-5-3 lines
 * 310-312 (the exactly-once terminal); A15 lines 26-32; GC-5.
 */
export function reservationConsumedEvidence(input: {
  readonly reservation: ReservationRecord;
  readonly when: ProtocolTime;
  readonly resourceSequence: number;
  readonly accounting: ResourceAccounting;
}): EvidenceSubmissionRecord {
  return reservationEvidence({
    operationType: RESERVATION_EVIDENCE_VOCABULARY.consumedOperationType,
    requiredState: 'CONSUMED',
    ...input,
  });
}

/**
 * Build the RESERVATION_RELEASED record — HELD -> RELEASED, or the
 * REQUESTED -> RELEASED rejection resolution, or the recovery roll-back.
 *
 * Source: core.md lines 326-328 ("RESERVATION_RELEASED"); INV-5-2 lines
 * 307-309 (the rejection resolution); lines 316-318 (the recovery
 * roll-back); A15 lines 26-32; GC-5.
 */
export function reservationReleasedEvidence(input: {
  readonly reservation: ReservationRecord;
  readonly when: ProtocolTime;
  readonly resourceSequence: number;
  readonly accounting: ResourceAccounting;
  readonly reasonCode?: ReservationReasonCode;
}): EvidenceSubmissionRecord {
  return reservationEvidence({
    operationType: RESERVATION_EVIDENCE_VOCABULARY.releasedOperationType,
    requiredState: 'RELEASED',
    ...input,
  });
}

/**
 * Build the RESERVATION_EXPIRED record — HELD -> EXPIRED (the
 * deterministic deadline rule).
 *
 * Source: core.md lines 326-328 ("RESERVATION_EXPIRED"); lines 290-291
 * ("expiry is deterministic on protocol time"); A15 lines 26-32; GC-5.
 */
export function reservationExpiredEvidence(input: {
  readonly reservation: ReservationRecord;
  readonly when: ProtocolTime;
  readonly resourceSequence: number;
  readonly accounting: ResourceAccounting;
}): EvidenceSubmissionRecord {
  return reservationEvidence({
    operationType: RESERVATION_EVIDENCE_VOCABULARY.expiredOperationType,
    requiredState: 'EXPIRED',
    reasonCode: 'DEADLINE_EXPIRED',
    ...input,
  });
}

/**
 * Submit one evidence record through the EvidenceSubmission port, honoring
 * the A15 coupling: a submission failure (a throw) propagates to the caller
 * and fails the operation that was being recorded ("A failed write fails
 * the operation" — A15 lines 62-64). The await accepts both port arms (the
 * real RTN-002 log submits synchronously; async ports are also honored,
 * per the kernel port's void-or-Promise shape).
 *
 * Source: A15 lines 62-64 + lines 41-43; the kernel port declaration
 * (src/lib/protocol-runtime/kernel/ports.ts).
 */
export async function submitReservationEvidence(
  port: EvidenceSubmission,
  record: EvidenceSubmissionRecord,
): Promise<void> {
  await port.submit(record);
}
