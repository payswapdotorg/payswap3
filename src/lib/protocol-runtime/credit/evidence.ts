/**
 * RTN-007 — Credit Authority: A07 evidence emission through the
 * kernel-declared EvidenceSubmission port, to the REAL A15 log (RTN-002,
 * merged at this item's base).
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §2 Area 7, lines
 *   138-140 (the complete named evidence set of the area):
 *     "Evidence produced
 *      - CREDIT_LINE_STATE_CHANGED.
 *      - CREDIT_DECIDED (decision id, key, outcome, reason code).
 *      - EXPOSURE_CHANGED (post-transition integer arithmetic proof)."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   26-32 (the exact five-slot record shape) and lines 62-64 (the
 *   synchronous coupling: "an operation is not committed until its record
 *   is written. A failed write fails the operation").
 *   spec/architecture/v0.1/README.md §3 GC-5 lines 63-67 (exactly one
 *   record per consequential operation).
 *   spec/registry/protocol-registry.json A07 — owningAuthority:
 *     "Credit Authority" (the 'authority' slot value; validated by the
 *     real log against EVIDENCE_AUTHORITIES).
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - One record per consequential transition, exactly the named set.
 *   - CREDIT_DECIDED carries the decision id and its KEY ((intent id,
 *     line id)) in what.subjectIds; outcome = APPROVED/DENIED with the
 *     denial's reason code; proof.hashes = the decision identity hash
 *     (the approved amount is verifiable through it — "an approval names
 *     an exact integer amount"); proof.sequenceNumbers = [limit,
 *     exposure] at evaluation (the deterministic evaluation inputs).
 *   - EXPOSURE_CHANGED carries the driving ledger event in outcome and
 *     the post-transition INV-7-1 arithmetic identity hash in
 *     proof.hashes, with [exposure, limit] in proof.sequenceNumbers.
 *   - Rejections emit NO record (a refused command mutates no state; the
 *     named set is exhaustive — the RTN-005/RTN-006 precedent).
 */

import type {
  EvidenceSubmission,
  EvidenceSubmissionRecord,
} from '../kernel/ports.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { isProtocolTime } from '../kernel/time.ts';
import {
  creditDecisionIdentityHash,
  exposureArithmeticIdentityHash,
} from './exposure.ts';
import type { CreditExposureView } from './types.ts';
import type {
  CreditDecisionRecord,
  CreditLineRecord,
  CreditReasonCode,
} from './types.ts';

/**
 * The authority identity recorded in the 'authority' slot of A07's
 * records — the registry's owning authority name for area 7.
 *
 * Source: spec/registry/protocol-registry.json A07 — "owningAuthority":
 * "Credit Authority".
 */
export const CREDIT_AUTHORITY_ID = 'Credit Authority';

/**
 * The A07 evidence operation-type vocabulary — exactly the three named
 * types, frozen (no inventions).
 *
 * Source: liquidity-credit-queues.md lines 138-140 (the named set quoted
 * in the module doc).
 */
export const CREDIT_EVIDENCE_VOCABULARY = Object.freeze({
  lineStateChangedOperationType: 'CREDIT_LINE_STATE_CHANGED',
  decidedOperationType: 'CREDIT_DECIDED',
  exposureChangedOperationType: 'EXPOSURE_CHANGED',
} as const);

function assertWhen(when: unknown): asserts when is ProtocolTime {
  if (!isProtocolTime(when)) {
    throw new TypeError('credit evidence: when must be a well-formed ProtocolTime');
  }
}

/**
 * Build the CREDIT_LINE_STATE_CHANGED record. Slot mapping:
 * what.subjectIds = [lineId]; outcome = the new state with its grounded
 * reason code; proof.sequenceNumbers = [limitMinor] (the declared-total
 * input of the INV-7-1 identity).
 *
 * Source: liquidity-credit-queues.md line 138; A15 lines 26-32; GC-5.
 */
export function creditLineStateChangedEvidence(input: {
  readonly line: CreditLineRecord;
  readonly requiredState: 'OFFERED' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  readonly reasonCode: CreditReasonCode;
  readonly when: ProtocolTime;
}): EvidenceSubmissionRecord {
  const { line, requiredState, reasonCode, when } = input;
  assertWhen(when);
  if (line.state !== requiredState) {
    throw new TypeError(
      `credit evidence: CREDIT_LINE_STATE_CHANGED requires the line in ${requiredState} (got ${line.state})`,
    );
  }
  return {
    what: {
      operationType: CREDIT_EVIDENCE_VOCABULARY.lineStateChangedOperationType,
      subjectIds: [line.lineId],
    },
    when,
    authority: CREDIT_AUTHORITY_ID,
    outcome: {
      result: requiredState,
      reasonCode,
    },
    proof: {
      sequenceNumbers: [line.limit.amountMinor],
    },
  };
}

/**
 * Build the CREDIT_DECIDED record — the decision's recording moment (the
 * EVALUATED state, outcome APPROVED or DENIED). Slot mapping:
 * what.subjectIds = [decisionId, intentId, lineId] — "CREDIT_DECIDED
 * (decision id, key, outcome, reason code)"; proof.hashes = the decision
 * identity hash; proof.sequenceNumbers = [limit, exposure] at evaluation.
 *
 * Source: liquidity-credit-queues.md line 139; A15 lines 26-32; GC-5.
 */
export function creditDecidedEvidence(input: {
  readonly decision: CreditDecisionRecord;
  readonly exposureAtEvaluation: CreditExposureView;
  readonly when: ProtocolTime;
}): EvidenceSubmissionRecord {
  const { decision, exposureAtEvaluation, when } = input;
  assertWhen(when);
  if (decision.state !== 'EVALUATED' && decision.state !== 'APPLIED') {
    throw new TypeError('credit evidence: the decision record is malformed');
  }
  return {
    what: {
      operationType: CREDIT_EVIDENCE_VOCABULARY.decidedOperationType,
      subjectIds: [decision.decisionId, decision.intentId, decision.lineId],
    },
    when,
    authority: CREDIT_AUTHORITY_ID,
    outcome: {
      result: decision.outcome.kind,
      ...(decision.outcome.kind === 'DENIED' ? { reasonCode: decision.outcome.reason } : {}),
    },
    proof: {
      hashes: [
        creditDecisionIdentityHash({
          decisionId: decision.decisionId,
          intentId: decision.intentId,
          lineId: decision.lineId,
          outcome: decision.outcome,
          ...(decision.outcome.kind === 'APPROVED'
            ? { approvedAmount: decision.outcome.approvedAmount }
            : {}),
        }),
      ],
      sequenceNumbers: [
        exposureAtEvaluation.limit.amountMinor,
        exposureAtEvaluation.exposure.amountMinor,
      ],
    },
  };
}

/**
 * Build the EXPOSURE_CHANGED record — one area-5 ledger mutation of the
 * line's exposure. Slot mapping: what.subjectIds = [lineId,
 * reservationId?] (the driving reservation); outcome = the driving ledger
 * event with its reason code; proof.hashes = the post-transition INV-7-1
 * arithmetic identity hash; proof.sequenceNumbers = [exposure, limit]
 * after the transition.
 *
 * Source: liquidity-credit-queues.md line 140 ("EXPOSURE_CHANGED
 * (post-transition integer arithmetic proof)"); lines 101-104 (the
 * ledger-only mutation path); A15 lines 26-32; GC-5.
 */
export function exposureChangedEvidence(input: {
  readonly lineId: string;
  readonly exposure: CreditExposureView;
  readonly reasonCode: CreditReasonCode;
  readonly when: ProtocolTime;
  readonly reservationId?: string;
}): EvidenceSubmissionRecord {
  const { lineId, exposure, reasonCode, when, reservationId } = input;
  assertWhen(when);
  return {
    what: {
      operationType: CREDIT_EVIDENCE_VOCABULARY.exposureChangedOperationType,
      subjectIds: reservationId === undefined ? [lineId] : [lineId, reservationId],
    },
    when,
    authority: CREDIT_AUTHORITY_ID,
    outcome: {
      result: 'EXPOSURE_CHANGED',
      reasonCode,
    },
    proof: {
      hashes: [exposureArithmeticIdentityHash(exposure)],
      sequenceNumbers: [exposure.exposure.amountMinor, exposure.limit.amountMinor],
    },
  };
}

/**
 * Submit one evidence record through the EvidenceSubmission port, honoring
 * the A15 coupling: a submission failure (a throw) propagates to the
 * caller and fails the operation that was being recorded ("A failed write
 * fails the operation" — A15 lines 62-64).
 *
 * Source: A15 lines 62-64 + lines 41-43; the kernel port declaration.
 */
export async function submitCreditEvidence(
  port: EvidenceSubmission,
  record: EvidenceSubmissionRecord,
): Promise<void> {
  await port.submit(record);
}
