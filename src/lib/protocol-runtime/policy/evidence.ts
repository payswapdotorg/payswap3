/**
 * RTN-005 — Fulfillment Policy Authority: A02 evidence emission through the
 * kernel-declared EvidenceSubmission port, to the REAL A15 log (RTN-002,
 * merged at this item's base).
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/core.md §2 Area 2, lines 134-135 (the complete
 *   named evidence set of the area):
 *     "Evidence produced
 *      - POLICY_ATTACHED (policy version, snapshot id).
 *      - POLICY_EVALUATED (outcome: evaluation id and result hash)."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   26-32 (the exact five-slot record shape) and lines 62-64 (the
 *   synchronous coupling):
 *     "Evidence writing is internal and synchronous with the operation it
 *      records: an operation is not committed until its record is written.
 *      A failed write fails the operation."
 *   spec/architecture/v0.1/README.md §3 GC-5 lines 63-67.
 *   spec/registry/protocol-registry.json A02 — owningAuthority:
 *   "Fulfillment Policy Authority" (the 'authority' slot value; validated
 *   by the real log against EVIDENCE_AUTHORITIES).
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - One record per consequential operation, exactly the named set:
 *     attach -> POLICY_ATTACHED; evaluate -> POLICY_EVALUATED (both the
 *     satisfiable outcome and the POLICY_UNSATISFIABLE failure — the
 *     failure is the area's reason-coded consequential decision, line
 *     127-128). No other operation type is invented: policy authoring and
 *     versioning are configuration (the RTN-003 rule-lifecycle precedent —
 *     A02's named set is exhaustive), and EVALUATED -> CONSUMED is not in
 *     the named set.
 *   - POLICY_ATTACHED's named data rides as: policy version ->
 *     what.subjectIds[0] (`policyId@v<version>`), snapshot id ->
 *     what.subjectIds[2]; the definition hash rides in proof.hashes.
 *   - POLICY_EVALUATED's named data rides as: evaluation id ->
 *     what.subjectIds[0], result hash -> proof.hashes[0]; the outcome slot
 *     carries the evaluation outcome (EVALUATED, or the reason-coded
 *     POLICY_UNSATISFIABLE failure).
 *   - Emission is submit-then-commit at the authority layer ("A failed
 *     write fails the operation").
 */

import type {
  EvidenceSubmission,
  EvidenceSubmissionRecord,
} from '../kernel/ports.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { isProtocolTime } from '../kernel/time.ts';
import { policyDefinitionHash } from './evaluation.ts';
import type { PolicyEvaluationRecord, FulfillmentPolicyRecord } from './types.ts';

/**
 * The authority identity recorded in the 'authority' slot of A02's records —
 * the registry's owning authority name for area 2.
 *
 * Source: spec/registry/protocol-registry.json A02 — "owningAuthority":
 * "Fulfillment Policy Authority".
 */
export const POLICY_AUTHORITY_ID = 'Fulfillment Policy Authority';

/**
 * The A02 evidence operation-type vocabulary — exactly the two named types,
 * frozen (no inventions).
 *
 * Source: core.md lines 134-135 (the named set quoted in the module doc).
 */
export const POLICY_EVIDENCE_VOCABULARY = Object.freeze({
  attachedOperationType: 'POLICY_ATTACHED',
  evaluatedOperationType: 'POLICY_EVALUATED',
} as const);

function assertWhen(when: unknown): asserts when is ProtocolTime {
  if (!isProtocolTime(when)) {
    throw new TypeError('policy evidence: when must be a well-formed ProtocolTime');
  }
}

/**
 * Build the POLICY_ATTACHED record. Slot mapping of "POLICY_ATTACHED
 * (policy version, snapshot id)":
 *   - what.subjectIds: the policy version id (`policyId@v<version>`), the
 *     attached intent id, and the snapshot id;
 *   - when: the attachment time;
 *   - authority: Fulfillment Policy Authority;
 *   - outcome: ATTACHED;
 *   - proof.hashes: the policy definition hash (the fingerprint of the
 *     attached immutable version).
 *
 * Source: core.md line 134; A15 lines 26-32; GC-5.
 */
export function policyAttachedEvidence(
  policy: FulfillmentPolicyRecord,
  when: ProtocolTime,
): EvidenceSubmissionRecord {
  assertWhen(when);
  if (policy.state !== 'ATTACHED' || policy.attachedIntentId === undefined || policy.attachedSnapshotId === undefined) {
    throw new TypeError('policy evidence: POLICY_ATTACHED requires the policy in ATTACHED with its intent and snapshot recorded');
  }
  return {
    what: {
      operationType: POLICY_EVIDENCE_VOCABULARY.attachedOperationType,
      subjectIds: [`${policy.policyId}@v${policy.version}`, policy.attachedIntentId, policy.attachedSnapshotId],
    },
    when,
    authority: POLICY_AUTHORITY_ID,
    outcome: { result: 'ATTACHED' },
    proof: { hashes: [policyDefinitionHash(policy.policyId, policy.version, policy.definition)] },
  };
}

/**
 * Build the POLICY_EVALUATED record. Slot mapping of "POLICY_EVALUATED
 * (outcome: evaluation id and result hash)":
 *   - what.subjectIds: the evaluation id, the intent id, the policy
 *     version id, and the snapshot id (the full recorded basis);
 *   - when: the evaluation time;
 *   - authority: Fulfillment Policy Authority;
 *   - outcome: EVALUATED on the satisfiable path, or the reason-coded
 *     POLICY_UNSATISFIABLE failure (lines 127-128);
 *   - proof.hashes: the evaluation result hash.
 *
 * Source: core.md line 135; lines 127-128; A15 lines 26-32; GC-5.
 */
export function policyEvaluatedEvidence(
  evaluation: PolicyEvaluationRecord,
  when: ProtocolTime,
): EvidenceSubmissionRecord {
  assertWhen(when);
  if (
    evaluation === null ||
    typeof evaluation !== 'object' ||
    typeof evaluation.evaluationId !== 'string' ||
    evaluation.evaluationId.length === 0 ||
    typeof evaluation.intentId !== 'string' ||
    evaluation.intentId.length === 0 ||
    typeof evaluation.policyId !== 'string' ||
    evaluation.policyId.length === 0 ||
    typeof evaluation.snapshotId !== 'string' ||
    evaluation.snapshotId.length === 0 ||
    typeof evaluation.resultHash !== 'string' ||
    evaluation.resultHash.length === 0 ||
    (evaluation.state !== 'EVALUATED' && evaluation.state !== 'CONSUMED')
  ) {
    throw new TypeError('policy evidence: POLICY_EVALUATED requires a recorded evaluation (id, basis, state, result hash)');
  }
  const outcome = evaluation.outcome;
  return {
    what: {
      operationType: POLICY_EVIDENCE_VOCABULARY.evaluatedOperationType,
      subjectIds: [
        evaluation.evaluationId,
        evaluation.intentId,
        `${evaluation.policyId}@v${evaluation.policyVersion}`,
        evaluation.snapshotId,
      ],
    },
    when,
    authority: POLICY_AUTHORITY_ID,
    outcome: outcome.satisfiable
      ? { result: 'EVALUATED' }
      : { result: 'POLICY_UNSATISFIABLE', reasonCode: outcome.reasonCode },
    proof: { hashes: [evaluation.resultHash] },
  };
}

/**
 * Submit one evidence record through the EvidenceSubmission port, honoring
 * the A15 coupling: a submission failure propagates and fails the operation
 * that was being recorded ("A failed write fails the operation" — A15
 * lines 62-64). The await accepts both port arms (the real RTN-002 log
 * submits synchronously).
 *
 * Source: A15 lines 62-64 + lines 41-43; the kernel port declaration.
 */
export async function submitPolicyEvidence(
  port: EvidenceSubmission,
  record: EvidenceSubmissionRecord,
): Promise<void> {
  await port.submit(record);
}
