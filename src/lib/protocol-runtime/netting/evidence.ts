/**
 * RTN-009 — Netting Authority: A11 evidence emission through the
 * kernel-declared EvidenceSubmission port, to the REAL A15 log (RTN-002,
 * merged at this item's base).
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §3 Area 11,
 *   lines 199-203 (the complete named evidence set of the area — verbatim):
 *     "Evidence produced
 *      - NETTING_SET_OPENED (input obligation ids).
 *      - NETTING_COMPUTED (algorithm version, per-currency conservation
 *        proof).
 *      - NETTING_COMMITTED (net obligation ids created)."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   26-32 (the exact five-slot record shape) and lines 62-64 (the
 *   synchronous coupling: "an operation is not committed until its record
 *   is written. A failed write fails the operation").
 *   spec/architecture/v0.1/README.md §3 GC-5 lines 63-67 (exactly one
 *   record per consequential operation).
 *   spec/registry/protocol-registry.json A11 — owningAuthority:
 *     "Netting Authority" (the 'authority' slot value; validated by the
 *     real log against EVIDENCE_AUTHORITIES).
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - One record per consequential operation, exactly the named set:
 *     openNettingSet writes NETTING_SET_OPENED (the input obligation ids
 *     in what.subjectIds); computeNettingSet writes NETTING_COMPUTED (the
 *     algorithm version in the outcome result and the conservation
 *     proof hash in proof.hashes — "algorithm version, per-currency
 *     conservation proof"); commitNettingSet writes NETTING_COMMITTED
 *     (the net obligation ids created in what.subjectIds — "net
 *     obligation ids created").
 *   - Rejections, duplicate re-commit no-ops (INV-11-3), and read queries
 *     emit NO record (no state mutated; the named set is exhaustive — the
 *     RTN-005/006/007/008 precedent).
 */

import type {
  EvidenceSubmission,
  EvidenceSubmissionRecord,
} from '../kernel/ports.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type { NetObligationRecord } from './types.ts';
import type { NettingSetRecord } from './types.ts';

/**
 * The authority identity recorded in the 'authority' slot of A11's records
 * — the registry's owning authority name for area 11.
 *
 * Source: spec/registry/protocol-registry.json A11 — "Netting Authority";
 * clearing-netting-settlement.md lines 172-175 ("Netting Authority
 * (protocol layer, area 11) owns netting computation and set state").
 */
export const NETTING_AUTHORITY_ID = 'Netting Authority';

/**
 * The complete A11 evidence vocabulary — the three named records.
 *
 * Source: clearing-netting-settlement.md lines 199-203.
 */
export const NETTING_EVIDENCE_VOCABULARY: readonly [
  'NETTING_SET_OPENED',
  'NETTING_COMPUTED',
  'NETTING_COMMITTED',
] = Object.freeze(['NETTING_SET_OPENED', 'NETTING_COMPUTED', 'NETTING_COMMITTED'] as const);

/**
 * The NETTING_SET_OPENED record — "(input obligation ids)".
 *
 * Source: clearing-netting-settlement.md line 200; A15 lines 26-32; GC-5.
 */
export function nettingSetOpenedEvidence(set: NettingSetRecord): EvidenceSubmissionRecord {
  return {
    what: {
      operationType: 'NETTING_SET_OPENED',
      subjectIds: [set.nettingSetId, ...set.inputObligationIds],
    },
    when: set.openedAt,
    authority: NETTING_AUTHORITY_ID,
    outcome: { result: 'OPEN' },
    proof: {
      sequenceNumbers: [set.openedAt.sequence],
      priorRecordIds: [...set.inputObligationIds],
    },
  };
}

/**
 * The NETTING_COMPUTED record — "(algorithm version, per-currency
 * conservation proof)".
 *
 * Source: clearing-netting-settlement.md lines 201-202; A15 lines 26-32;
 * GC-5.
 */
export function nettingComputedEvidence(set: NettingSetRecord): EvidenceSubmissionRecord {
  const proof = set.conservationProof;
  const computedAt = set.computedAt;
  if (proof === undefined || computedAt === undefined) {
    throw new TypeError(
      'netting evidence: NETTING_COMPUTED requires a computed set (conservation proof present)',
    );
  }
  return {
    what: {
      operationType: 'NETTING_COMPUTED',
      subjectIds: [set.nettingSetId, ...set.inputObligationIds],
    },
    when: computedAt,
    authority: NETTING_AUTHORITY_ID,
    outcome: { result: `COMPUTED.v${proof.algorithmVersion}` },
    proof: {
      hashes: [proof.proofHash],
      sequenceNumbers: [computedAt.sequence, proof.perCurrency.length],
    },
  };
}

/**
 * The NETTING_COMMITTED record — "(net obligation ids created)".
 *
 * Source: clearing-netting-settlement.md line 202-203; A15 lines 26-32;
 * GC-5.
 */
export function nettingCommittedEvidence(
  set: NettingSetRecord,
  netObligations: readonly NetObligationRecord[],
): EvidenceSubmissionRecord {
  const committedAt = set.committedAt;
  if (committedAt === undefined) {
    throw new TypeError(
      'netting evidence: NETTING_COMMITTED requires a committed set (committedAt present)',
    );
  }
  return {
    what: {
      operationType: 'NETTING_COMMITTED',
      subjectIds: [set.nettingSetId, ...netObligations.map((entry) => entry.netObligationId)],
    },
    when: committedAt,
    authority: NETTING_AUTHORITY_ID,
    outcome: { result: 'COMMITTED' },
    proof: {
      hashes: [set.conservationProof?.proofHash ?? ''],
      sequenceNumbers: [committedAt.sequence, netObligations.length],
      priorRecordIds: [...set.inputObligationIds],
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
export async function submitNettingEvidence(
  evidence: EvidenceSubmission,
  record: EvidenceSubmissionRecord,
): Promise<void> {
  await evidence.submit(record);
}
