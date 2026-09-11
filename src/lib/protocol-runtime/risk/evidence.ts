/**
 * RTN-003 — Risk/Compliance Authority: evidence emission through the
 * kernel-declared EvidenceSubmission port.
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/evidence-risk-compliance.md §2 Area 16, lines
 *   144-147 (the evidence this area produces — the complete named set):
 *     "Evidence produced
 *      - CHECK_DECIDED (subject, rule set version, outcome, reason code).
 *      - SCREENING_COMPUTED (list version, subject hash, outcome).
 *      - REVIEW_RECORDED (reviewer authority, decision, rationale)."
 *   §1 Area 15, lines 26-32 (the exact five-slot record shape):
 *     "EvidenceRecord — one immutable record per consequential operation.
 *      Fields (mandatory, exactly these five semantic slots):
 *      - what: operation type and subject object ids.
 *      - when: protocol time (sequenced) and recorded wall time.
 *      - authority: which protocol authority performed the operation.
 *      - outcome: resulting state or decision, including reason codes.
 *      - proof: hashes, sequence numbers, and links to prior records
 *        required to verify the record."
 *   §1 Area 15, lines 41-43 (the submission relationship):
 *     "Evidence Authority (protocol layer, area 15) owns the log and
 *      record schema. All other authorities are writers-by-submission
 *      only; none can alter or suppress records."
 *   §1 Area 15, lines 62-64 (the synchronous coupling this module honors):
 *     "Evidence writing is internal and synchronous with the operation it
 *      records: an operation is not committed until its record is written.
 *      A failed write fails the operation."
 *   spec/architecture/v0.1/README.md §3 GC-5, lines 63-67.
 *   spec/registry/protocol-registry.json area A16 — owningAuthority:
 *   "Risk and Compliance Authority".
 *
 * Design:
 *   - RTN-002 (the Evidence Authority that implements the log) is a sibling
 *     that may be unmerged at this item's dispatch; per the wave evidence
 *     discipline (spec/protocol-runtime-work-orders/README.md line 39),
 *     emission is tested here against an OWNED IN-SURFACE TEST DOUBLE of
 *     the kernel-declared port type; the real-log integration is proven in
 *     RTN-012. Nothing in this module knows the implementor.
 *   - Each builder returns EXACTLY the five slots (the record type enforces
 *     it structurally; the test double re-asserts the shape at submit
 *     time).
 *   - The 'authority' slot is the Risk and Compliance Authority for
 *     CHECK_DECIDED and SCREENING_COMPUTED. For REVIEW_RECORDED the slot
 *     carries the REVIEWER authority identity — the reviewing authority is
 *     the authority that performed the reviewed decision ("a reviewed
 *     decision is recorded with reviewer authority identity and reason" —
 *     A16 lines 106-107); its decision and rationale ride in the outcome
 *     slot. (Interpretation decision — see CONTRACT-REVIEW.md.)
 *   - Emission is submit-then-commit at the authority layer
 *     (authority.ts): a failed submission throws, and the operation's
 *     state change is never persisted — "A failed write fails the
 *     operation."
 */

import type {
  EvidenceSubmission,
  EvidenceSubmissionRecord,
} from '../kernel/ports.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { isProtocolTime } from '../kernel/time.ts';
import type {
  ComplianceCheckRecord,
  ComplianceReviewRecord,
} from './evaluation.ts';
import type { ScreeningResultRecord } from './screening.ts';

/**
 * The authority identity recorded in the 'authority' slot of this area's
 * own records (the registry's owning authority name for A16).
 *
 * Source: spec/registry/protocol-registry.json area A16 — "owningAuthority":
 * "Risk and Compliance Authority"; A15 line 29 — "authority: which protocol
 * authority performed the operation."
 */
export const RISK_AUTHORITY_ID = 'Risk and Compliance Authority';

function assertWhen(when: unknown): asserts when is ProtocolTime {
  if (!isProtocolTime(when)) {
    throw new TypeError('risk evidence: when must be a well-formed ProtocolTime');
  }
}

/**
 * Build the CHECK_DECIDED record: the evidence a check decision produces.
 * Slot mapping of the A16 contract "CHECK_DECIDED (subject, rule set
 * version, outcome, reason code)":
 *   - what.subjectIds: the check id, the gated subject id, and the rule
 *     set version (the subject object ids the decision concerns);
 *   - when: the decision time;
 *   - authority: the Risk and Compliance Authority;
 *   - outcome: the terminal decision (APPROVED | DENIED | MANUAL_REVIEW)
 *     with the A16 reason code;
 *   - proof: the evaluation's input triple (subject data hash, screening
 *     list version id) as verification hashes and the check id as the
 *     prior-record link.
 *
 * Source: evidence-risk-compliance.md §2 line 145; §1 lines 26-32; GC-5.
 */
export function checkDecidedEvidence(
  check: ComplianceCheckRecord,
  when: ProtocolTime,
): EvidenceSubmissionRecord {
  assertWhen(when);
  if (check.state === 'EVALUATED') {
    throw new TypeError('risk evidence: CHECK_DECIDED requires a decided check (EVALUATED is undecided)');
  }
  return {
    what: {
      operationType: 'CHECK_DECIDED',
      subjectIds: [check.checkId, check.subjectId, check.ruleSetVersion],
    },
    when,
    authority: RISK_AUTHORITY_ID,
    outcome: {
      result: check.state,
      reasonCode: check.evaluation.reasonCode,
    },
    proof: {
      hashes: [check.subjectDataHash],
      priorRecordIds: [check.checkId],
    },
  };
}

/**
 * Build the SCREENING_COMPUTED record: the evidence a resolved screening
 * produces. Slot mapping of the A16 contract "SCREENING_COMPUTED (list
 * version, subject hash, outcome)":
 *   - what.subjectIds: the screening id and the list version id (the
 *     objects the computation concerns);
 *   - when: the resolution time;
 *   - authority: the Risk and Compliance Authority;
 *   - outcome: CLEAR | HIT;
 *   - proof: the subject data hash (and, on a HIT, the matched entry
 *     digest) as verification hashes.
 *
 * Source: evidence-risk-compliance.md §2 line 146; §1 lines 26-32; GC-5.
 */
export function screeningComputedEvidence(
  result: ScreeningResultRecord,
  subjectId: string,
  when: ProtocolTime,
): EvidenceSubmissionRecord {
  assertWhen(when);
  if (result.state === 'COMPUTED') {
    throw new TypeError('risk evidence: SCREENING_COMPUTED requires a resolved screening (COMPUTED is unresolved)');
  }
  return {
    what: {
      operationType: 'SCREENING_COMPUTED',
      subjectIds: [result.screeningId, result.listVersionId],
    },
    when,
    authority: RISK_AUTHORITY_ID,
    outcome: {
      result: result.state,
    },
    proof: {
      hashes: result.state === 'HIT' && result.matchedEntry !== undefined
        ? [result.subjectDataHash, result.matchedEntry]
        : [result.subjectDataHash],
    },
  };
}

/**
 * Build the REVIEW_RECORDED record: the evidence a reviewed decision
 * produces. Slot mapping of the A16 contract "REVIEW_RECORDED (reviewer
 * authority, decision, rationale)":
 *   - what.subjectIds: the check id and the gated subject id;
 *   - when: the review time;
 *   - authority: the REVIEWER authority identity — the authority that
 *     performed the reviewed decision (A16 lines 106-107: "a reviewed
 *     decision is recorded with reviewer authority identity and reason");
 *   - outcome: the reviewed decision (APPROVED | DENIED) with the
 *     reviewer's rationale as the reason;
 *   - proof: the evaluation's subject data hash and the check id link.
 *
 * Source: evidence-risk-compliance.md §2 line 147 + lines 106-107; §1 lines
 * 26-32; GC-5.
 */
export function reviewRecordedEvidence(
  check: ComplianceCheckRecord,
  when: ProtocolTime,
): EvidenceSubmissionRecord {
  assertWhen(when);
  const review: ComplianceReviewRecord | undefined = check.review;
  if (review === undefined || (check.state !== 'APPROVED' && check.state !== 'DENIED')) {
    throw new TypeError('risk evidence: REVIEW_RECORDED requires a reviewed decision on the check');
  }
  return {
    what: {
      operationType: 'REVIEW_RECORDED',
      subjectIds: [check.checkId, check.subjectId],
    },
    when,
    authority: review.reviewerAuthority,
    outcome: {
      result: review.decision,
      reasonCode: review.rationale,
    },
    proof: {
      hashes: [check.subjectDataHash],
      priorRecordIds: [check.checkId],
    },
  };
}

/**
 * Submit one evidence record through the EvidenceSubmission port, honoring
 * the synchronous-coupling contract: the submission's failure (a throw)
 * propagates to the caller, failing the operation that was being recorded
 * ("A failed write fails the operation" — A15 lines 62-64). Submission
 * carries no decision semantics back (the port has no return channel).
 *
 * Source: A15 lines 62-64 + lines 41-43; the kernel port declaration
 * (src/lib/protocol-runtime/kernel/ports.ts).
 */
export async function submitRiskEvidence(
  port: EvidenceSubmission,
  record: EvidenceSubmissionRecord,
): Promise<void> {
  await port.submit(record);
}
