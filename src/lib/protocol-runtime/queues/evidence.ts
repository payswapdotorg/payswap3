/**
 * RTN-007 — Queue Authority: A08 evidence emission through the
 * kernel-declared EvidenceSubmission port, to the REAL A15 log (RTN-002,
 * merged at this item's base).
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §3 Area 8, lines
 *   206-210 (the complete named evidence set of the area):
 *     "Evidence produced
 *      - ITEM_QUEUED, ITEM_ELIGIBLE, ITEM_DISPATCHED, ITEM_GRADUATED,
 *      ITEM_CANCELLED, ITEM_EXPIRED (each with queue sequence and
 *      reason codes where applicable)."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   26-32 (the exact five-slot record shape) and lines 62-64 (the
 *   synchronous coupling: "an operation is not committed until its record
 *   is written. A failed write fails the operation").
 *   spec/architecture/v0.1/README.md §3 GC-5 lines 63-67 (exactly one
 *   record per consequential operation).
 *   spec/registry/protocol-registry.json A08 — owningAuthority:
 *     "Queue Authority" (the 'authority' slot value; validated by the
 *     real log against EVIDENCE_AUTHORITIES).
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - The named set is exactly the six ITEM_* types — no QUEUE_* types
 *     exist in the area's exhaustive set, and queue state transitions
 *     are not financial-state mutations under GC-5's own definition
 *     ("Queues hold intents and plans, never money"), so they emit no
 *     records. The asymmetry is the spec's.
 *   - Each record carries the item's queue sequence in
 *     proof.sequenceNumbers ("each with queue sequence") and the reason
 *     code where applicable in outcome.reasonCode.
 *   - Rejections and replays emit NO record (a refused or no-effect
 *     command mutates no state — the RTN-005/RTN-006 precedent).
 */

import type {
  EvidenceSubmission,
  EvidenceSubmissionRecord,
} from '../kernel/ports.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { isProtocolTime } from '../kernel/time.ts';
import type { QueuedItemRecord, QueueReasonCode } from './types.ts';

/**
 * The authority identity recorded in the 'authority' slot of A08's
 * records — the registry's owning authority name for area 8.
 *
 * Source: spec/registry/protocol-registry.json A08 — "owningAuthority":
 * "Queue Authority".
 */
export const QUEUE_AUTHORITY_ID = 'Queue Authority';

/**
 * The A08 evidence operation-type vocabulary — exactly the six named
 * types, frozen (no inventions).
 *
 * Source: liquidity-credit-queues.md lines 206-210 (the named set quoted
 * in the module doc).
 */
export const QUEUE_EVIDENCE_VOCABULARY = Object.freeze({
  queuedOperationType: 'ITEM_QUEUED',
  eligibleOperationType: 'ITEM_ELIGIBLE',
  dispatchedOperationType: 'ITEM_DISPATCHED',
  graduatedOperationType: 'ITEM_GRADUATED',
  cancelledOperationType: 'ITEM_CANCELLED',
  expiredOperationType: 'ITEM_EXPIRED',
} as const);

function assertWhen(when: unknown): asserts when is ProtocolTime {
  if (!isProtocolTime(when)) {
    throw new TypeError('queue evidence: when must be a well-formed ProtocolTime');
  }
}

/**
 * Build one ITEM_* record. Slot mapping: what.subjectIds = [itemId,
 * queueId, intentId] (the subject objects the item concerns);
 * outcome = the item's new state with the transition's reason code;
 * proof.sequenceNumbers = [queueSequence] ("each with queue sequence");
 * proof.priorRecordIds = [linkedOperationId] when a reconciliation
 * linkage applies (the INV-8-4 recovery chain).
 *
 * Source: liquidity-credit-queues.md lines 206-210; A15 lines 26-32;
 * GC-5.
 */
export function itemEvidence(input: {
  readonly operationType: string;
  readonly item: QueuedItemRecord;
  readonly requiredState: 'QUEUED' | 'ELIGIBLE' | 'DISPATCHED' | 'GRADUATED' | 'CANCELLED' | 'EXPIRED';
  readonly reasonCode?: QueueReasonCode;
  readonly when: ProtocolTime;
}): EvidenceSubmissionRecord {
  const { operationType, item, requiredState, reasonCode, when } = input;
  assertWhen(when);
  if (item.state !== requiredState) {
    throw new TypeError(
      `queue evidence: ${operationType} requires the item in ${requiredState} (got ${item.state})`,
    );
  }
  return {
    what: {
      operationType,
      subjectIds:
        item.linkedOperationId === undefined
          ? [item.itemId, item.queueId, item.intentId]
          : [item.itemId, item.queueId, item.intentId, item.linkedOperationId],
    },
    when,
    authority: QUEUE_AUTHORITY_ID,
    outcome: {
      result: requiredState,
      ...(reasonCode === undefined ? {} : { reasonCode }),
    },
    proof: {
      sequenceNumbers: [item.queueSequence],
      ...(item.linkedOperationId === undefined
        ? {}
        : { priorRecordIds: [item.linkedOperationId] }),
    },
  };
}

/**
 * Build the ITEM_QUEUED record — the enqueue.
 *
 * Source: liquidity-credit-queues.md line 208; A15 lines 26-32; GC-5.
 */
export function itemQueuedEvidence(input: {
  readonly item: QueuedItemRecord;
  readonly when: ProtocolTime;
}): EvidenceSubmissionRecord {
  return itemEvidence({
    operationType: QUEUE_EVIDENCE_VOCABULARY.queuedOperationType,
    requiredState: 'QUEUED',
    reasonCode: 'ENQUEUED',
    ...input,
  });
}

/**
 * Build the ITEM_ELIGIBLE record — the snapshot-driven eligibility.
 *
 * Source: liquidity-credit-queues.md line 208; lines 197-199 (the
 * snapshot-driven evaluation); A15 lines 26-32; GC-5.
 */
export function itemEligibleEvidence(input: {
  readonly item: QueuedItemRecord;
  readonly when: ProtocolTime;
}): EvidenceSubmissionRecord {
  return itemEvidence({
    operationType: QUEUE_EVIDENCE_VOCABULARY.eligibleOperationType,
    requiredState: 'ELIGIBLE',
    reasonCode: 'ELIGIBLE_PER_POLICY',
    ...input,
  });
}

/**
 * Build the ITEM_DISPATCHED record — the exactly-once dispatch.
 *
 * Source: liquidity-credit-queues.md line 208; INV-8-2 lines 185-187
 * (dispatch exactly-once per item id); A15 lines 26-32; GC-5.
 */
export function itemDispatchedEvidence(input: {
  readonly item: QueuedItemRecord;
  readonly when: ProtocolTime;
  readonly linkedOperationId: string;
}): EvidenceSubmissionRecord {
  return itemEvidence({
    operationType: QUEUE_EVIDENCE_VOCABULARY.dispatchedOperationType,
    requiredState: 'DISPATCHED',
    reasonCode: 'DISPATCHED_IN_ORDER',
    ...input,
  });
}

/**
 * Build the ITEM_GRADUATED record — downstream fulfillment completed
 * ("GRADUATED means downstream fulfillment completed; the evidence chain
 * links the item to the final outcome" — the linked operation id rides
 * subjectIds and priorRecordIds).
 *
 * Source: liquidity-credit-queues.md lines 170-172, 208, 201-204; A15
 * lines 26-32; GC-5.
 */
export function itemGraduatedEvidence(input: {
  readonly item: QueuedItemRecord;
  readonly when: ProtocolTime;
}): EvidenceSubmissionRecord {
  return itemEvidence({
    operationType: QUEUE_EVIDENCE_VOCABULARY.graduatedOperationType,
    requiredState: 'GRADUATED',
    reasonCode: 'RECONCILIATION_CONFIRMED',
    ...input,
  });
}

/**
 * Build the ITEM_CANCELLED record — intent cancellation, deterministic
 * route failure, or confirmed-failure resolution (each with its reason
 * code).
 *
 * Source: liquidity-credit-queues.md line 209, lines 201-204; A15 lines
 * 26-32; GC-5.
 */
export function itemCancelledEvidence(input: {
  readonly item: QueuedItemRecord;
  readonly reasonCode: QueueReasonCode;
  readonly when: ProtocolTime;
}): EvidenceSubmissionRecord {
  return itemEvidence({
    operationType: QUEUE_EVIDENCE_VOCABULARY.cancelledOperationType,
    requiredState: 'CANCELLED',
    ...input,
  });
}

/**
 * Build the ITEM_EXPIRED record — the max-wait expiry (deterministic on
 * protocol time).
 *
 * Source: liquidity-credit-queues.md line 209, lines 173-175 (max wait);
 * A15 lines 26-32; GC-5.
 */
export function itemExpiredEvidence(input: {
  readonly item: QueuedItemRecord;
  readonly when: ProtocolTime;
}): EvidenceSubmissionRecord {
  return itemEvidence({
    operationType: QUEUE_EVIDENCE_VOCABULARY.expiredOperationType,
    requiredState: 'EXPIRED',
    reasonCode: 'MAX_WAIT_EXCEEDED',
    ...input,
  });
}

/**
 * Submit one evidence record through the EvidenceSubmission port, honoring
 * the A15 coupling: a submission failure (a throw) propagates to the
 * caller and fails the operation that was being recorded ("A failed write
 * fails the operation" — A15 lines 62-64).
 *
 * Source: A15 lines 62-64 + lines 41-43; the kernel port declaration.
 */
export async function submitQueueEvidence(
  port: EvidenceSubmission,
  record: EvidenceSubmissionRecord,
): Promise<void> {
  await port.submit(record);
}
