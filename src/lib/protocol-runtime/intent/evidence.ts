/**
 * RTN-005 — Intent Authority: A01 evidence emission through the
 * kernel-declared EvidenceSubmission port, to the REAL A15 log (RTN-002,
 * merged at this item's base).
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/core.md §1 Area 1, lines 74-78 (the complete
 *   named evidence set of the area):
 *     "Evidence produced
 *      - INTENT_CREATED (what: intent terms; when; authority: Intent
 *        Authority; outcome: DRAFT; proof: submitted descriptor hash).
 *      - INTENT_AUTHORIZED (outcome: AUTHORIZED; proof: policy decision id).
 *      - INTENT_STATE_CHANGED (one record per transition, with reason code)."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   26-32 (the exact five-slot record shape: what/when/authority/outcome/
 *   proof) and lines 62-64 (the synchronous coupling):
 *     "Evidence writing is internal and synchronous with the operation it
 *      records: an operation is not committed until its record is written.
 *      A failed write fails the operation."
 *   spec/architecture/v0.1/README.md §3 GC-5 lines 63-67 (exactly one record
 *   per consequential operation).
 *   spec/registry/protocol-registry.json A01 — owningAuthority: "Intent
 *   Authority" (the 'authority' slot value; validated by the real log
 *   against EVIDENCE_AUTHORITIES).
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - RTN-002 is MERGED at this base, so the evidence port the authority
 *     receives is the real EvidenceLog (createEvidenceLog) — no test double
 *     is needed or used for the real-log coupling (the wave README's
 *     test-double allowance applies only where the log is not yet a hard
 *     dependency).
 *   - One record per consequential operation, exactly the named set: create
 *     -> INTENT_CREATED, authorize -> INTENT_AUTHORIZED, every later
 *     transition -> INTENT_STATE_CHANGED. No INTENT_CANCELLED or other
 *     invented operation type exists.
 *   - Emission is submit-then-commit at the authority layer: a failed
 *     submission throws and nothing is committed ("A failed write fails the
 *     operation").
 */

import type {
  EvidenceSubmission,
  EvidenceSubmissionRecord,
} from '../kernel/ports.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { isProtocolTime } from '../kernel/time.ts';
import type { IntentReasonCode, PaymentIntent } from './types.ts';

/**
 * The authority identity recorded in the 'authority' slot of A01's records —
 * the registry's owning authority name for area 1.
 *
 * Source: spec/registry/protocol-registry.json A01 — "owningAuthority":
 * "Intent Authority"; core.md line 75 — "authority: Intent Authority".
 */
export const INTENT_AUTHORITY_ID = 'Intent Authority';

/**
 * The A01 evidence operation-type vocabulary — exactly the three named
 * types, frozen (no inventions).
 *
 * Source: core.md lines 74-78 (the named set quoted in the module doc).
 */
export const INTENT_EVIDENCE_VOCABULARY = Object.freeze({
  createdOperationType: 'INTENT_CREATED',
  authorizedOperationType: 'INTENT_AUTHORIZED',
  stateChangedOperationType: 'INTENT_STATE_CHANGED',
} as const);

function assertWhen(when: unknown): asserts when is ProtocolTime {
  if (!isProtocolTime(when)) {
    throw new TypeError('intent evidence: when must be a well-formed ProtocolTime');
  }
}

function assertIntent(intent: PaymentIntent): void {
  if (intent === null || typeof intent !== 'object') {
    throw new TypeError('intent evidence: intent must be a PaymentIntent record');
  }
}

/**
 * Build the INTENT_CREATED record. Slot mapping of the A01 contract
 * "INTENT_CREATED (what: intent terms; when; authority: Intent Authority;
 * outcome: DRAFT; proof: submitted descriptor hash)":
 *   - what.subjectIds: the intent id and the submitted idempotency key (the
 *     subject object ids the intent terms identify);
 *   - when: the creation time;
 *   - authority: Intent Authority;
 *   - outcome: DRAFT;
 *   - proof.hashes: the submitted descriptor hash.
 *
 * Source: core.md lines 74-75; A15 lines 26-32; GC-5.
 */
export function intentCreatedEvidence(intent: PaymentIntent, when: ProtocolTime): EvidenceSubmissionRecord {
  assertWhen(when);
  assertIntent(intent);
  if (intent.state !== 'DRAFT') {
    throw new TypeError('intent evidence: INTENT_CREATED requires the intent in DRAFT');
  }
  return {
    what: {
      operationType: INTENT_EVIDENCE_VOCABULARY.createdOperationType,
      subjectIds: [intent.intentId, intent.idempotencyKey],
    },
    when,
    authority: INTENT_AUTHORITY_ID,
    outcome: { result: 'DRAFT' },
    proof: { hashes: [intent.descriptorHash] },
  };
}

/**
 * Build the INTENT_AUTHORIZED record. Slot mapping of "INTENT_AUTHORIZED
 * (outcome: AUTHORIZED; proof: policy decision id)":
 *   - what.subjectIds: the intent id (plus the policy decision id — the
 *     decision object this authorization consumed);
 *   - when: the authorization time;
 *   - authority: Intent Authority;
 *   - outcome: AUTHORIZED;
 *   - proof.priorRecordIds: the policy decision id (the record link
 *     "required to verify the record" — A15 lines 31-32).
 *
 * Source: core.md line 76; A15 lines 26-32, 31-32; GC-5.
 */
export function intentAuthorizedEvidence(
  intent: PaymentIntent,
  policyDecisionId: string,
  when: ProtocolTime,
): EvidenceSubmissionRecord {
  assertWhen(when);
  assertIntent(intent);
  if (intent.state !== 'AUTHORIZED') {
    throw new TypeError('intent evidence: INTENT_AUTHORIZED requires the intent in AUTHORIZED');
  }
  if (typeof policyDecisionId !== 'string' || policyDecisionId.length === 0) {
    throw new TypeError('intent evidence: INTENT_AUTHORIZED requires the policy decision id (core.md line 76)');
  }
  return {
    what: {
      operationType: INTENT_EVIDENCE_VOCABULARY.authorizedOperationType,
      subjectIds: [intent.intentId, policyDecisionId],
    },
    when,
    authority: INTENT_AUTHORITY_ID,
    outcome: { result: 'AUTHORIZED' },
    proof: { priorRecordIds: [policyDecisionId] },
  };
}

/**
 * Build the INTENT_STATE_CHANGED record — "one record per transition, with
 * reason code". Slot mapping:
 *   - what.subjectIds: the intent id;
 *   - when: the transition time;
 *   - authority: Intent Authority;
 *   - outcome: the new state, with the reason code when one is supplied
 *     (FAILED and CANCELLED always carry one — see checkIntentReasonCode);
 *   - proof.priorRecordIds: the link to the failing evidence record when the
 *     transition is a failure with a named failing record (core.md lines
 *     67-69: "the intent moves to FAILED with a machine readable reason
 *     code and a link to the failing evidence record").
 *
 * Source: core.md line 77; lines 67-69; A15 lines 26-32; GC-5.
 */
export function intentStateChangedEvidence(
  intent: PaymentIntent,
  when: ProtocolTime,
  options: {
    readonly reasonCode?: IntentReasonCode;
    readonly failingRecordId?: string;
  } = {},
): EvidenceSubmissionRecord {
  assertWhen(when);
  assertIntent(intent);
  const { reasonCode, failingRecordId } = options;
  if (reasonCode !== undefined && typeof reasonCode !== 'string') {
    throw new TypeError('intent evidence: reasonCode must be a string when present');
  }
  if (failingRecordId !== undefined && (typeof failingRecordId !== 'string' || failingRecordId.length === 0)) {
    throw new TypeError('intent evidence: failingRecordId must be a non-empty string when present');
  }
  return {
    what: {
      operationType: INTENT_EVIDENCE_VOCABULARY.stateChangedOperationType,
      subjectIds: [intent.intentId],
    },
    when,
    authority: INTENT_AUTHORITY_ID,
    outcome: {
      result: intent.state,
      ...(reasonCode === undefined ? {} : { reasonCode }),
    },
    proof:
      failingRecordId === undefined
        ? {}
        : { priorRecordIds: [failingRecordId] },
  };
}

/**
 * Submit one evidence record through the EvidenceSubmission port, honoring
 * the A15 coupling: a submission failure (a throw) propagates to the caller
 * and fails the operation that was being recorded ("A failed write fails the
 * operation" — A15 lines 62-64). The await accepts both port arms (the real
 * RTN-002 log submits synchronously; async ports are also honored, per the
 * kernel port's void-or-Promise shape).
 *
 * Source: A15 lines 62-64 + lines 41-43; the kernel port declaration
 * (src/lib/protocol-runtime/kernel/ports.ts).
 */
export async function submitIntentEvidence(
  port: EvidenceSubmission,
  record: EvidenceSubmissionRecord,
): Promise<void> {
  await port.submit(record);
}
