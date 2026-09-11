/**
 * RTN-003 — Risk/Compliance Authority: the OWNED IN-SURFACE TEST DOUBLE of
 * the EvidenceSubmission port.
 *
 * Spec source (binding):
 *   Wave evidence discipline — spec/protocol-runtime-work-orders/README.md
 *   line 39:
 *     "Evidence discipline: every consequential operation writes an A15
 *      record through the kernel-declared EvidenceSubmission port; where
 *      the real evidence log is not yet a hard dependency (RTN-003,
 *      RTN-004), the item tests against an owned in-surface test double of
 *      the port and the real-log integration is proven in RTN-012
 *      ('constituent evidence does not compose')."
 *   The port contract it doubles (kernel declaration, implemented by
 *   RTN-002): src/lib/protocol-runtime/kernel/ports.ts —
 *     "All other authorities are writers-by-submission only; none can alter
 *      or suppress records." / "an operation is not committed until its
 *      record is written. A failed write fails the operation."
 *   The five-slot shape it asserts on every submission (A15 lines 26-32):
 *     "Fields (mandatory, exactly these five semantic slots): what, when,
 *      authority, outcome, proof."
 *
 * NOT a protocol type and NOT the real log: this is the item's owned test
 * instrument for the required evidence ("evidence emission tests against an
 * owned test double of the port"). It records what WOULD be written,
 * re-asserts the five-slot shape on every submit, and can be armed to fail
 * — the failing mode proves the synchronous coupling ("A failed write fails
 * the operation": the authority's operation throws and nothing persists).
 * RTN-012 replaces this double with the real Evidence Authority log.
 */

import type {
  EvidenceSubmission,
  EvidenceSubmissionRecord,
} from '../kernel/ports.ts';
import { isProtocolTime } from '../kernel/time.ts';

/**
 * One recorded submission: the record plus its submission ordinal (the
 * order it would occupy in the log).
 *
 * Source: the test double's purpose (WAVE README.md line 39 — "records what
 * would be written").
 */
export interface RecordedEvidenceSubmission {
  readonly record: EvidenceSubmissionRecord;
  readonly ordinal: number;
}

/**
 * The five mandatory semantic slots, as the exact key set every submission
 * must carry (A15 lines 26-32 — "exactly these five semantic slots").
 *
 * Source: evidence-risk-compliance.md §1 lines 26-32; GC-5 (README.md §3
 * lines 63-67).
 */
export const EVIDENCE_RECORD_SLOTS: readonly ['what', 'when', 'authority', 'outcome', 'proof'] =
  Object.freeze(['what', 'when', 'authority', 'outcome', 'proof'] as const);

/**
 * Assert the five-slot shape of an evidence submission record: exactly the
 * five mandatory keys, a well-formed 'what' (operation type + subject ids),
 * a well-formed 'when' (ProtocolTime), a non-empty 'authority', a
 * well-formed 'outcome', and an object 'proof'. Throws deterministically on
 * any violation.
 *
 * Source: evidence-risk-compliance.md §1 lines 26-32 (the mandatory, exact
 * slot set and each slot's shape).
 */
export function assertEvidenceFiveSlotShape(record: EvidenceSubmissionRecord): void {
  if (record === null || typeof record !== 'object') {
    throw new TypeError('evidence double: record must be an object');
  }
  const keys = Object.keys(record).sort();
  const expected = [...EVIDENCE_RECORD_SLOTS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError(
      `evidence double: record must carry exactly the five mandatory slots ${EVIDENCE_RECORD_SLOTS.join(', ')} (got ${keys.join(', ')})`,
    );
  }
  const what = record.what;
  if (
    what === null ||
    typeof what !== 'object' ||
    typeof what.operationType !== 'string' ||
    what.operationType.length === 0 ||
    !Array.isArray(what.subjectIds) ||
    what.subjectIds.some((id) => typeof id !== 'string' || id.length === 0)
  ) {
    throw new TypeError('evidence double: the what slot must be a non-empty operationType and non-empty subject ids');
  }
  if (!isProtocolTime(record.when)) {
    throw new TypeError('evidence double: the when slot must be a well-formed ProtocolTime');
  }
  if (typeof record.authority !== 'string' || record.authority.length === 0) {
    throw new TypeError('evidence double: the authority slot must be a non-empty string');
  }
  const outcome = record.outcome;
  if (
    outcome === null ||
    typeof outcome !== 'object' ||
    typeof outcome.result !== 'string' ||
    outcome.result.length === 0 ||
    (outcome.reasonCode !== undefined && typeof outcome.reasonCode !== 'string')
  ) {
    throw new TypeError('evidence double: the outcome slot must be a non-empty result with an optional string reasonCode');
  }
  const proof = record.proof;
  if (proof === null || typeof proof !== 'object') {
    throw new TypeError('evidence double: the proof slot must be an object');
  }
}

/**
 * The owned test double of the EvidenceSubmission port: records every
 * submission (what would be written), asserts the five-slot shape on each,
 * and can be armed to fail the next N submissions — the failing mode is how
 * the synchronous-coupling contract ("A failed write fails the operation" —
 * A15 lines 62-64) is proven.
 *
 * Source: WAVE README.md line 39 (the evidence discipline); kernel ports.ts
 * (the doubled contract).
 */
export class EvidenceSubmissionTestDouble implements EvidenceSubmission {
  private readonly submissions_: RecordedEvidenceSubmission[] = [];
  private failuresToInject_ = 0;
  private ordinal_ = 0;

  /** Arm the double to fail (throw on) the next `count` submissions. */
  failNextSubmissions(count: number): void {
    this.failuresToInject_ = count;
  }

  submit(record: EvidenceSubmissionRecord): void {
    assertEvidenceFiveSlotShape(record);
    if (this.failuresToInject_ > 0) {
      this.failuresToInject_ -= 1;
      throw new Error(`evidence submission failed (test double; ${this.failuresToInject_ + 1} remained)`);
    }
    this.submissions_.push({ record, ordinal: this.ordinal_ });
    this.ordinal_ += 1;
  }

  /** Every recorded submission, in submission order. */
  get submissions(): readonly RecordedEvidenceSubmission[] {
    return this.submissions_;
  }

  /** The recorded submissions of one operation type, in order. */
  byOperationType(operationType: string): readonly RecordedEvidenceSubmission[] {
    return this.submissions_.filter((entry) => entry.record.what.operationType === operationType);
  }

  /** Number of recorded submissions. */
  get count(): number {
    return this.submissions_.length;
  }
}
