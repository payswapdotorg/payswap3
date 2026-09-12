/**
 * RTN-008 — Obligation Ledger Authority: A10 evidence emission through
 * the kernel-declared EvidenceSubmission port, to the REAL A15 log
 * (RTN-002, merged at this item's base).
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §2 Area 10,
 *   lines 133-137 (the complete named evidence set of the area):
 *     "Evidence produced
 *      - OBLIGATION_CREATED (origin reference, terms hash).
 *      - OBLIGATION_STATE_CHANGED (each transition, with cause
 *        reference).
 *      - OBLIGATION_WRITTEN_OFF (risk authority reference)."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   26-32 (the exact five-slot record shape) and lines 62-64 (the
 *   synchronous coupling: "an operation is not committed until its record
 *   is written. A failed write fails the operation").
 *   spec/architecture/v0.1/README.md §3 GC-5 lines 63-67 (exactly one
 *   record per consequential operation).
 *   spec/registry/protocol-registry.json A10 — owningAuthority:
 *     "Obligation Authority" (the 'authority' slot value; validated by
 *     the real log against EVIDENCE_AUTHORITIES).
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - One record per consequential operation, exactly the named set:
 *     every creation writes OBLIGATION_CREATED (the origin reference ids
 *     in what.subjectIds; the terms hash in proof.hashes — "origin
 *     reference, terms hash"); every transition EXCEPT the write-off
 *     writes OBLIGATION_STATE_CHANGED (the driving instruction's cause
 *     reference among the subject ids and in proof.priorRecordIds —
 *     "each transition, with cause reference"); the WRITTEN_OFF
 *     transition writes OBLIGATION_WRITTEN_OFF (the risk authority
 *     reference among the subject ids — "risk authority reference").
 *     The write-off's own named record subsumes the generic
 *     OBLIGATION_STATE_CHANGED for that operation — otherwise one
 *     consequential operation would write two records and violate GC-5's
 *     exactly-one.
 *   - Rejections, duplicate creation no-ops (INV-10-3), and no-op
 *     re-observations emit NO record (no state mutated; the named set is
 *     exhaustive — the RTN-005/006/007 precedent).
 */

import type {
  EvidenceSubmission,
  EvidenceSubmissionRecord,
} from '../kernel/ports.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { isProtocolTime } from '../kernel/time.ts';
import { hashObligationTerms } from './state-machine.ts';
import type {
  ObligationCreatedEntry,
  ObligationInstructionKind,
  ObligationRecord,
  ObligationTransitionedEntry,
} from './types.ts';

/**
 * The authority identity recorded in the 'authority' slot of A10's
 * records — the registry's owning authority name for area 10.
 *
 * Source: spec/registry/protocol-registry.json A10 — "owningAuthority":
 * "Obligation Authority"; clearing-netting-settlement.md lines 108-110 —
 * "Obligation Ledger Authority (protocol layer, area 10)".
 */
export const OBLIGATION_AUTHORITY_ID = 'Obligation Authority';

/**
 * The A10 evidence operation-type vocabulary — exactly the three named
 * types, frozen (no inventions).
 *
 * Source: clearing-netting-settlement.md lines 133-137 (the named set
 * quoted in the module doc).
 */
export const OBLIGATION_EVIDENCE_VOCABULARY = Object.freeze({
  obligationCreatedOperationType: 'OBLIGATION_CREATED',
  obligationStateChangedOperationType: 'OBLIGATION_STATE_CHANGED',
  obligationWrittenOffOperationType: 'OBLIGATION_WRITTEN_OFF',
} as const);

function assertWhen(when: unknown): asserts when is ProtocolTime {
  if (!isProtocolTime(when)) {
    throw new TypeError('obligations evidence: when must be a well-formed ProtocolTime');
  }
}

/**
 * Build the OBLIGATION_CREATED record. Slot mapping: what.subjectIds =
 * [obligationId, ...originReferenceIds] — "origin reference"; proof.hashes
 * = [the terms hash] — "terms hash"; the creation path in
 * outcome.reasonCode.
 *
 * Source: clearing-netting-settlement.md lines 133-134; A15 lines 26-32;
 * GC-5.
 */
export function obligationCreatedEvidence(entry: ObligationCreatedEntry): EvidenceSubmissionRecord {
  const originReferenceIds =
    entry.origin.kind === 'CLEARING'
      ? [entry.origin.originRecordId, entry.origin.originActivityId, entry.origin.batchId]
      : [entry.origin.disputeId, entry.origin.resolvedObligationId];
  return {
    what: {
      operationType: OBLIGATION_EVIDENCE_VOCABULARY.obligationCreatedOperationType,
      subjectIds: [entry.obligationId, ...originReferenceIds],
    },
    when: entry.when,
    authority: OBLIGATION_AUTHORITY_ID,
    outcome: { result: 'CREATED', reasonCode: entry.createdBy },
    proof: {
      hashes: [hashObligationTerms(entry.terms)],
      sequenceNumbers: [entry.sequence],
    },
  };
}

/**
 * Build the OBLIGATION_STATE_CHANGED record — the record of every
 * transition except the write-off. Slot mapping: what.subjectIds =
 * [obligationId, causeReference] — "with cause reference";
 * outcome.result = the new state; outcome.reasonCode = the driving
 * instruction kind; proof.sequenceNumbers = [the entry's ledger
 * sequence], proof.priorRecordIds = [the cause reference].
 *
 * Source: clearing-netting-settlement.md lines 134-135; A15 lines 26-32;
 * GC-5.
 */
export function obligationStateChangedEvidence(
  entry: ObligationTransitionedEntry,
): EvidenceSubmissionRecord {
  return {
    what: {
      operationType: OBLIGATION_EVIDENCE_VOCABULARY.obligationStateChangedOperationType,
      subjectIds: [entry.obligationId, entry.causeReference],
    },
    when: entry.when,
    authority: OBLIGATION_AUTHORITY_ID,
    outcome: { result: entry.to, reasonCode: entry.instructionKind },
    proof: {
      sequenceNumbers: [entry.sequence],
      priorRecordIds: [entry.causeReference],
    },
  };
}

/**
 * Build the OBLIGATION_WRITTEN_OFF record — the write-off transition's
 * own named record ("OBLIGATION_WRITTEN_OFF (risk authority
 * reference)"). Slot mapping: what.subjectIds = [obligationId,
 * riskAuthorityReference] — the risk authority reference;
 * outcome.result = WRITTEN_OFF; proof.sequenceNumbers = [the entry's
 * ledger sequence].
 *
 * Source: clearing-netting-settlement.md lines 135-136; A15 lines 26-32;
 * GC-5.
 */
export function obligationWrittenOffEvidence(
  entry: ObligationTransitionedEntry,
): EvidenceSubmissionRecord {
  if (entry.instructionKind !== 'RISK_WRITE_OFF') {
    throw new TypeError(
      'obligations evidence: OBLIGATION_WRITTEN_OFF requires a RISK_WRITE_OFF transition entry',
    );
  }
  return {
    what: {
      operationType: OBLIGATION_EVIDENCE_VOCABULARY.obligationWrittenOffOperationType,
      subjectIds: [entry.obligationId, entry.causeReference],
    },
    when: entry.when,
    authority: OBLIGATION_AUTHORITY_ID,
    outcome: { result: 'WRITTEN_OFF', reasonCode: entry.instructionKind },
    proof: {
      sequenceNumbers: [entry.sequence],
    },
  };
}

/**
 * The evidence builder dispatch for one transition entry: the write-off
 * transition writes OBLIGATION_WRITTEN_OFF; every other transition writes
 * OBLIGATION_STATE_CHANGED.
 *
 * Source: clearing-netting-settlement.md lines 133-137 (the named set);
 * GC-5 (exactly one record per operation).
 */
export function transitionEvidence(
  entry: ObligationTransitionedEntry,
): EvidenceSubmissionRecord {
  return entry.instructionKind === 'RISK_WRITE_OFF'
    ? obligationWrittenOffEvidence(entry)
    : obligationStateChangedEvidence(entry);
}

/**
 * Submit one A10 evidence record through the EvidenceSubmission port.
 * Awaits a thenable return (an async port implementation) — the A15
 * synchronous-write discipline ("an operation is not committed until its
 * record is written. A failed write fails the operation") requires the
 * caller to await the write before committing the entry.
 *
 * Source: A15 lines 62-64 (evidence-risk-compliance.md); GC-5.
 */
export async function submitObligationEvidence(
  port: EvidenceSubmission,
  record: EvidenceSubmissionRecord,
): Promise<void> {
  const returned = port.submit(record);
  if (returned !== undefined && typeof (returned as { then?: unknown }).then === 'function') {
    await returned;
  }
}
