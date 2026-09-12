/**
 * RTN-009 — Settlement and Finality Authority: A12 evidence emission
 * through the kernel-declared EvidenceSubmission port, to the REAL A15
 * log (RTN-002, merged at this item's base).
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §4 Area 12,
 *   lines 275-279 (the complete named evidence set of the area —
 *   verbatim):
 *     "Evidence produced
 *      - SETTLEMENT_INSTRUCTION_CREATED (obligation id, amount hash).
 *      - SETTLEMENT_ATTEMPT_AUTHORIZED (attempt id, rail op id).
 *      - SETTLEMENT_ATTEMPT_RESOLVED (outcome, resolution reference).
 *      - FINALITY_DECLARED (PROVISIONAL or FINAL, rule reference, proof)."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   26-32 (the exact five-slot record shape) and lines 62-64 (the
 *   synchronous coupling: "an operation is not committed until its
 *   record is written. A failed write fails the operation").
 *   spec/architecture/v0.1/README.md §3 GC-5 lines 63-67 (exactly one
 *   record per consequential operation).
 *   spec/registry/protocol-registry.json A12 — owningAuthority:
 *     "Settlement and Finality Authority" (the 'authority' slot value;
 *     validated by the real log against EVIDENCE_AUTHORITIES).
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - One record per consequential operation, exactly the named set:
 *     instruction creation writes SETTLEMENT_INSTRUCTION_CREATED (the
 *     subject id + instruction id in what.subjectIds; the payload /
 *     amount hash in proof.hashes — "obligation id, amount hash");
 *     attempt authorization writes SETTLEMENT_ATTEMPT_AUTHORIZED (the
 *     attempt id + rail operation id in subjectIds, the idempotency key
 *     in proof.hashes — "attempt id, rail op id"); every attempt
 *     terminal landing (CONFIRMED / FAILED / UNKNOWN — and the UNKNOWN
 *     resolution landings CONFIRMED / FAILED) writes
 *     SETTLEMENT_ATTEMPT_RESOLVED (the outcome in the result slot, the
 *     resolution reference — the rail report's operation reference or
 *     the reconciliation case id — in proof.priorRecordIds — "outcome,
 *     resolution reference"); each finality declaration (PROVISIONAL and
 *     FINAL — two consequential operations, two records) writes
 *     FINALITY_DECLARED (the state in the result, the rule reference in
 *     the result suffix, the payload hash + operation reference in
 *     proof — "PROVISIONAL or FINAL, rule reference, proof").
 *   - Rejections, no-op transitions, and read queries emit NO record
 *     (the named set is exhaustive — the RTN-005/006/007/008 precedent).
 *   - The instruction's terminal state and the subject-domain lifecycle
 *     transitions are consequences of the attempt resolution operation
 *     (one consequential operation, one record) — the A10 mirror of the
 *     same discipline RTN-008 applied to its own surface.
 */

import type {
  EvidenceSubmission,
  EvidenceSubmissionRecord,
} from '../kernel/ports.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type {
  FinalityRecord,
  SettlementAttemptRecord,
  SettlementInstructionRecord,
} from './types.ts';
import { settlementSubjectKey } from './types.ts';

/**
 * The authority identity recorded in the 'authority' slot of A12's
 * records — the registry's owning authority name for area 12 (the apex
 * of the singleFinancialAuthority chain).
 *
 * Source: spec/registry/protocol-registry.json A12 — "Settlement and
 * Finality Authority"; singleFinancialAuthority.apex;
 * clearing-netting-settlement.md lines 242-245.
 */
export const SETTLEMENT_AUTHORITY_ID = 'Settlement and Finality Authority';

/**
 * The complete A12 evidence vocabulary — the four named records.
 *
 * Source: clearing-netting-settlement.md lines 275-279.
 */
export const SETTLEMENT_EVIDENCE_VOCABULARY: readonly [
  'SETTLEMENT_INSTRUCTION_CREATED',
  'SETTLEMENT_ATTEMPT_AUTHORIZED',
  'SETTLEMENT_ATTEMPT_RESOLVED',
  'FINALITY_DECLARED',
] = Object.freeze([
  'SETTLEMENT_INSTRUCTION_CREATED',
  'SETTLEMENT_ATTEMPT_AUTHORIZED',
  'SETTLEMENT_ATTEMPT_RESOLVED',
  'FINALITY_DECLARED',
] as const);

/**
 * The SETTLEMENT_INSTRUCTION_CREATED record — "(obligation id, amount
 * hash)".
 *
 * Source: clearing-netting-settlement.md line 276; A15 lines 26-32; GC-5.
 */
export function settlementInstructionCreatedEvidence(
  instruction: SettlementInstructionRecord,
): EvidenceSubmissionRecord {
  return {
    what: {
      operationType: 'SETTLEMENT_INSTRUCTION_CREATED',
      subjectIds: [instruction.instructionId, settlementSubjectKey(instruction.subject)],
    },
    when: instruction.createdAt,
    authority: SETTLEMENT_AUTHORITY_ID,
    outcome: { result: 'CREATED' },
    proof: {
      hashes: [instruction.payloadHash],
      sequenceNumbers: [instruction.createdAt.sequence, instruction.subjectOrdinal],
    },
  };
}

/**
 * The SETTLEMENT_ATTEMPT_AUTHORIZED record — "(attempt id, rail op id)".
 *
 * Source: clearing-netting-settlement.md line 277; A15 lines 26-32; GC-5.
 */
export function settlementAttemptAuthorizedEvidence(
  attempt: SettlementAttemptRecord,
  when: ProtocolTime,
): EvidenceSubmissionRecord {
  return {
    what: {
      operationType: 'SETTLEMENT_ATTEMPT_AUTHORIZED',
      subjectIds: [attempt.attemptId, attempt.operationId, attempt.instructionId],
    },
    when,
    authority: SETTLEMENT_AUTHORITY_ID,
    outcome: { result: 'AUTHORIZED' },
    proof: {
      hashes: [attempt.idempotencyKey],
      sequenceNumbers: [when.sequence],
    },
  };
}

/**
 * The SETTLEMENT_ATTEMPT_RESOLVED record — "(outcome, resolution
 * reference)": the attempt's terminal landing (CONFIRMED / FAILED /
 * UNKNOWN) or its reconciliation resolution landing (UNKNOWN ->
 * CONFIRMED / FAILED).
 *
 * Source: clearing-netting-settlement.md line 278; A15 lines 26-32; GC-5.
 */
export function settlementAttemptResolvedEvidence(
  attempt: SettlementAttemptRecord,
  when: ProtocolTime,
  resolutionReference: string,
): EvidenceSubmissionRecord {
  return {
    what: {
      operationType: 'SETTLEMENT_ATTEMPT_RESOLVED',
      subjectIds: [attempt.attemptId, attempt.instructionId, attempt.operationId, resolutionReference],
    },
    when,
    authority: SETTLEMENT_AUTHORITY_ID,
    outcome: { result: attempt.state },
    proof: {
      priorRecordIds: [resolutionReference],
      sequenceNumbers: [when.sequence],
    },
  };
}

/**
 * The FINALITY_DECLARED record — "(PROVISIONAL or FINAL, rule
 * reference, proof)".
 *
 * Source: clearing-netting-settlement.md lines 278-279; A15 lines 26-32;
 * GC-5.
 */
export function finalityDeclaredEvidence(
  finality: FinalityRecord,
  when: ProtocolTime,
): EvidenceSubmissionRecord {
  return {
    what: {
      operationType: 'FINALITY_DECLARED',
      subjectIds: [finality.finalityRecordId, settlementSubjectKey(finality.subject)],
    },
    when,
    authority: SETTLEMENT_AUTHORITY_ID,
    outcome: { result: finality.state, reasonCode: finality.ruleReference },
    proof: {
      ...(finality.payloadHash === undefined ? {} : { hashes: [finality.payloadHash] }),
      ...(finality.operationId === undefined
        ? {}
        : { priorRecordIds: [finality.operationId] }),
      sequenceNumbers: [when.sequence],
    },
  };
}

/**
 * Submit one evidence record to the A15 log — the synchronous coupling:
 * the caller awaits this BEFORE committing the state it records ("an
 * operation is not committed until its record is written. A failed write
 * fails the operation" — A15 lines 62-64).
 *
 * Source: evidence-risk-compliance.md lines 62-64.
 */
export async function submitSettlementEvidence(
  evidence: EvidenceSubmission,
  record: EvidenceSubmissionRecord,
): Promise<void> {
  await evidence.submit(record);
}
