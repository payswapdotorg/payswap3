/**
 * RTN-008 — Clearing Authority: A09 evidence emission through the
 * kernel-declared EvidenceSubmission port, to the REAL A15 log (RTN-002,
 * merged at this item's base).
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §1 Area 9,
 *   lines 66-70 (the complete named evidence set of the area):
 *     "Evidence produced
 *      - BATCH_STAGED (record count, per-currency totals hash).
 *      - BATCH_COMMITTED (obligation ids created, idempotency proof).
 *      - RECORD_QUARANTINED (reason code, origin reference)."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   26-32 (the exact five-slot record shape) and lines 62-64 (the
 *   synchronous coupling: "an operation is not committed until its record
 *   is written. A failed write fails the operation").
 *   spec/architecture/v0.1/README.md §3 GC-5 lines 63-67 (exactly one
 *   record per consequential operation).
 *   spec/registry/protocol-registry.json A09 — owningAuthority:
 *     "Clearing Authority" (the 'authority' slot value; validated by the
 *     real log against EVIDENCE_AUTHORITIES).
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - One record per consequential operation, exactly the named set:
 *     the STAGED transition writes BATCH_STAGED (record count +
 *     per-currency totals hash in proof.hashes, the staged count in
 *     proof.sequenceNumbers); the COMMITTED transition writes
 *     BATCH_COMMITTED (the created obligation ids in what.subjectIds, the
 *     duplicate origin keys and the commit idempotency key in proof —
 *     "obligation ids created, idempotency proof"); each record's
 *     quarantine (ACCEPTED -> QUARANTINED) writes RECORD_QUARANTINED
 *     (the reason code in outcome.reasonCode, the origin reference in
 *     what.subjectIds).
 *   - Rejections, re-commit no-ops (INV-9-3), and duplicate creation
 *     no-ops (INV-10-3) emit NO record (a refused or no-effect command
 *     mutates no state; the named set is exhaustive — the RTN-005/006/007
 *     precedent).
 *   - The FINAL transition (COMMITTED -> FINAL — the hand-off
 *     acknowledgment bookkeeping) emits NO clearing record: the A09 named
 *     set has no BATCH_FINAL member and the named set is exhaustive; the
 *     hand-off's subject matter (the obligations) is already evidenced by
 *     the ledger's own OBLIGATION_CREATED records.
 */

import type {
  EvidenceSubmission,
  EvidenceSubmissionRecord,
} from '../kernel/ports.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { isProtocolTime } from '../kernel/time.ts';
import type { BatchCommitResult, ClearingRecord } from './types.ts';

/**
 * The authority identity recorded in the 'authority' slot of A09's
 * records — the registry's owning authority name for area 9.
 *
 * Source: spec/registry/protocol-registry.json A09 — "owningAuthority":
 * "Clearing Authority"; clearing-netting-settlement.md lines 42-44 —
 * "Clearing Authority (protocol layer, area 9) owns batch and record
 * state".
 */
export const CLEARING_AUTHORITY_ID = 'Clearing Authority';

/**
 * The A09 evidence operation-type vocabulary — exactly the three named
 * types, frozen (no inventions).
 *
 * Source: clearing-netting-settlement.md lines 66-70 (the named set
 * quoted in the module doc).
 */
export const CLEARING_EVIDENCE_VOCABULARY = Object.freeze({
  batchStagedOperationType: 'BATCH_STAGED',
  batchCommittedOperationType: 'BATCH_COMMITTED',
  recordQuarantinedOperationType: 'RECORD_QUARANTINED',
} as const);

function assertWhen(when: unknown): asserts when is ProtocolTime {
  if (!isProtocolTime(when)) {
    throw new TypeError('clearing evidence: when must be a well-formed ProtocolTime');
  }
}

/**
 * Build the BATCH_STAGED record. Slot mapping: what.subjectIds = [batchId];
 * outcome = STAGED; proof.hashes = [the per-currency totals hash],
 * proof.sequenceNumbers = [the staged record count] — exactly the named
 * proof material "record count, per-currency totals hash".
 *
 * Source: clearing-netting-settlement.md lines 67-68; A15 lines 26-32;
 * GC-5.
 */
export function batchStagedEvidence(input: {
  readonly batchId: string;
  readonly recordCount: number;
  readonly perCurrencyTotalsHash: string;
  readonly when: ProtocolTime;
}): EvidenceSubmissionRecord {
  assertWhen(input.when);
  return {
    what: {
      operationType: CLEARING_EVIDENCE_VOCABULARY.batchStagedOperationType,
      subjectIds: [input.batchId],
    },
    when: input.when,
    authority: CLEARING_AUTHORITY_ID,
    outcome: { result: 'STAGED' },
    proof: {
      hashes: [input.perCurrencyTotalsHash],
      sequenceNumbers: [input.recordCount],
    },
  };
}

/**
 * Build the BATCH_COMMITTED record. Slot mapping: what.subjectIds = the
 * batch id followed by the created obligation ids ("obligation ids
 * created"); proof.hashes = [the commit idempotency key's hash material],
 * proof carries the duplicate origin keys in priorRecordIds-link form and
 * the commit's derived idempotency key — exactly the named proof material
 * "idempotency proof".
 *
 * Source: clearing-netting-settlement.md lines 67-68 ("BATCH_COMMITTED
 * (obligation ids created, idempotency proof)"); lines 55-56 (INV-9-3);
 * A15 lines 26-32; GC-5.
 */
export function batchCommittedEvidence(input: {
  readonly batchId: string;
  readonly commit: BatchCommitResult;
}): EvidenceSubmissionRecord {
  return {
    what: {
      operationType: CLEARING_EVIDENCE_VOCABULARY.batchCommittedOperationType,
      subjectIds: [input.batchId, ...input.commit.obligationIds],
    },
    when: input.commit.committedAt,
    authority: CLEARING_AUTHORITY_ID,
    outcome: { result: 'COMMITTED' },
    proof: {
      hashes: [input.commit.idempotencyKey],
      sequenceNumbers: [input.commit.obligationIds.length],
      priorRecordIds: [...input.commit.duplicateOriginActivityIds],
    },
  };
}

/**
 * Build the RECORD_QUARANTINED record. Slot mapping: what.subjectIds =
 * [batchId, recordId, originActivityId] — the "origin reference";
 * outcome.reasonCode = the quarantine reason code; outcome.result =
 * QUARANTINED. Exactly the named material "reason code, origin
 * reference".
 *
 * Source: clearing-netting-settlement.md lines 68-69 ("RECORD_QUARANTINED
 * (reason code, origin reference)"); lines 37-40 ("with reason codes");
 * A15 lines 26-32; GC-5.
 */
export function recordQuarantinedEvidence(input: {
  readonly batchId: string;
  readonly record: ClearingRecord;
  readonly when: ProtocolTime;
}): EvidenceSubmissionRecord {
  assertWhen(input.when);
  if (input.record.state !== 'QUARANTINED' || input.record.quarantineReason === undefined) {
    throw new TypeError(
      'clearing evidence: RECORD_QUARANTINED requires the record in QUARANTINED state with a reason code',
    );
  }
  return {
    what: {
      operationType: CLEARING_EVIDENCE_VOCABULARY.recordQuarantinedOperationType,
      subjectIds: [
        input.batchId,
        input.record.recordId,
        input.record.origin.originActivityId,
      ],
    },
    when: input.when,
    authority: CLEARING_AUTHORITY_ID,
    outcome: { result: 'QUARANTINED', reasonCode: input.record.quarantineReason },
    proof: {},
  };
}

/**
 * Submit one A09 evidence record through the EvidenceSubmission port.
 * Awaits a thenable return (an async port implementation) — the A15
 * synchronous-write discipline ("an operation is not committed until its
 * record is written. A failed write fails the operation") requires the
 * caller to await the write before committing state.
 *
 * Source: A15 lines 62-64 (evidence-risk-compliance.md); GC-5.
 */
export async function submitClearingEvidence(
  port: EvidenceSubmission,
  record: EvidenceSubmissionRecord,
): Promise<void> {
  const returned = port.submit(record);
  if (returned !== undefined && typeof (returned as { then?: unknown }).then === 'function') {
    await returned;
  }
}
