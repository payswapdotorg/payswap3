/**
 * RTN-010 — Protocol gateway: rejection evidence through the
 * kernel-declared EvidenceSubmission port, to the REAL A15 log.
 *
 * "Rejected commands are recorded as evidence (admission decisions are
 * consequential records)" — RTN-010.md line 16, acceptance. Every typed
 * admission refusal writes exactly one A15 record BEFORE the rejection is
 * returned (submit-then-return: a failed write fails the admission
 * operation — evidence-risk-compliance.md lines 62-64, "an operation is
 * not committed until its record is written. A failed write fails the
 * operation").
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   26-32 (the five mandatory semantic slots — what, when, authority,
 *   outcome, proof):
 *     "EvidenceRecord — one immutable record per consequential operation.
 *      Fields (mandatory, exactly these five semantic slots): ..."
 *   spec/architecture/v0.1/README.md §3 GC-5, lines 63-67 ("Every
 *     consequential operation produces an evidence record").
 *   spec/protocol-runtime-work-orders/RTN-010.md line 16 (rejected commands
 *     are recorded as evidence).
 *
 * Authority attribution (recorded interpretation — CONTRACT-REVIEW.md):
 *   the record's 'authority' slot names the OWNING AUTHORITY the command
 *   was addressed to (the submission's authority, resolved to its
 *   EVIDENCE_AUTHORITIES member). Grounds:
 *     - Q4 ruling (rtn-plan-rulings.md lines 74, 85, 120): the gateway
 *       "implements no identity or market authority — subject validation
 *       is per-command per owning authority". The refusal is per owning
 *       authority: that authority's command schema was violated, or its
 *       command surface was addressed without a registered kind.
 *     - The gateway hosts no authority of its own and there is no
 *       'Protocol Gateway' name in the registry's closed authority set
 *       (spec/registry/protocol-registry.json, 24 areas); materializing a
 *       new authority name would be a silent semantic change — VOID
 *       without an ACR (rtn-plan-rulings.md line 87, the Q4 ruling's own
 *       reasoning applied to a 'Gateway Authority').
 *     - deploy/contracts/components.json protocol-gateway: the protocol
 *       authorities are "enforced inside a deployment-owned process; the
 *       sole admission point for protocol commands" — the admission
 *       decision is the target authority's enforcement action performed at
 *       the gateway.
 *   Fail-closed rule (admission may never bypass evidence — RTN-010.md
 *   line 28 stop condition): when the submission's authority slot cannot
 *   be resolved to an honest evidence attribution (absent, not a string,
 *   or a name in neither the gateway's registry nor EVIDENCE_AUTHORITIES),
 *   the gateway THROWS a TypeError instead of returning a typed rejection:
 *   an unattributable submission is an input-shape violation (the merged
 *   kernel convention: input-shape violations throw), and returning an
 *   unrecorded typed rejection would create a consequential admission
 *   decision with no evidence record.
 */

import { createHash } from 'node:crypto';
import { canonicalJson } from '../evidence/canonical.ts';
import { EVIDENCE_AUTHORITIES } from '../evidence/record.ts';
import type { EvidenceSubmission, EvidenceSubmissionRecord } from '../kernel/ports.ts';
import { isProtocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type { GatewayAdmissionReasonCode } from './reason-codes.ts';
import { isGatewayAdmissionReasonCode } from './reason-codes.ts';

/**
 * The gateway evidence vocabulary: the operation type of a gateway
 * admission rejection record, and its outcome tokens. Frozen (no
 * inventions; the A15 named-set discipline).
 *
 * Source: RTN-010.md line 16 (rejected commands are recorded as evidence —
 * this vocabulary names that record); A15 lines 26-32 (the slots the
 * operation type and outcome occupy).
 */
export const GATEWAY_EVIDENCE_VOCABULARY = Object.freeze({
  rejectedOperationType: 'GATEWAY_COMMAND_REJECTED',
  rejectedResult: 'REJECTED',
} as const);

/**
 * The placeholder recorded in the 'what' slot when a submission's field
 * could not be read as a string (an envelope-invalid submission may carry
 * a non-string kind or idempotency key; the record still names the slot
 * deterministically).
 *
 * Source: A15 line 27 ("what: operation type and subject object ids" —
 * the refused command's identity slots are recorded even when malformed);
 * GC-1 (deterministic placeholders, never invented identities).
 */
export const GATEWAY_UNKNOWN_SUBJECT_TOKEN = 'unknown';

/**
 * Resolve the EVIDENCE authority name a submission's authority slot
 * attributes to: the gateway registry's evidence name when the authority
 * is a registered command authority, the name itself when it is a member
 * of EVIDENCE_AUTHORITIES (a real registry authority without a gateway
 * command surface), or undefined when NO honest attribution exists.
 *
 * Source: evidence/record.ts EVIDENCE_AUTHORITIES (the closed set the real
 * log validates against); rtn-plan-rulings.md Q4 (per-command per owning
 * authority; no invented authorities); the fail-closed rule in the module
 * doc.
 */
export function resolveEvidenceAuthority(
  submissionAuthority: unknown,
  gatewayAuthorityIds: readonly string[],
  evidenceAuthorityByEnvelope: Readonly<Record<string, string>>,
): string | undefined {
  if (typeof submissionAuthority !== 'string' || submissionAuthority.length === 0) {
    return undefined;
  }
  const mapped = evidenceAuthorityByEnvelope[submissionAuthority];
  if (typeof mapped === 'string' && mapped.length > 0) {
    return mapped;
  }
  if ((EVIDENCE_AUTHORITIES as readonly string[]).includes(submissionAuthority)) {
    return submissionAuthority;
  }
  return undefined;
}

/**
 * Build the GATEWAY_COMMAND_REJECTED record for one refused submission.
 * Slot mapping (A15 lines 26-32):
 *   - what.operationType: 'GATEWAY_COMMAND_REJECTED';
 *   - what.subjectIds: the submission's subject ids (when the envelope's
 *     subjectIds parsed as an array), then the kind and idempotency key
 *     (the refused command's own identity slots; 'unknown' placeholders
 *     when unreadable);
 *   - when: the gateway's protocol time of the refusal;
 *   - authority: the resolved evidence authority (the owning authority the
 *     command was addressed to — see the module doc's attribution ruling);
 *   - outcome: { result: 'REJECTED', reasonCode: the admission reason code };
 *   - proof.hashes: the sha256 of the submission's canonical JSON encoding
 *     (the verifiable fingerprint of WHAT was refused; omitted when the
 *     submission is not canonical-JSON-encodable).
 *
 * Pure: deterministic in (submission, authority, reasonCode, when).
 *
 * Source: A15 lines 26-32; RTN-010.md line 16; GC-5.
 */
export function commandRejectedEvidence(input: {
  readonly submission: unknown;
  readonly evidenceAuthority: string;
  readonly reasonCode: GatewayAdmissionReasonCode;
  readonly when: ProtocolTime;
}): EvidenceSubmissionRecord {
  if (typeof input.evidenceAuthority !== 'string' || input.evidenceAuthority.length === 0) {
    throw new TypeError('gateway evidence: evidenceAuthority must be a non-empty string');
  }
  if (!isGatewayAdmissionReasonCode(input.reasonCode)) {
    throw new TypeError('gateway evidence: reasonCode must be a gateway admission reason code');
  }
  if (!isProtocolTime(input.when)) {
    throw new TypeError('gateway evidence: when must be a well-formed ProtocolTime');
  }
  const subjectIds: string[] = [];
  const candidate =
    typeof input.submission === 'object' && input.submission !== null
      ? (input.submission as Record<string, unknown>)
      : {};
  if (Array.isArray(candidate.subjectIds)) {
    for (const subjectId of candidate.subjectIds) {
      if (typeof subjectId === 'string' && subjectId.length > 0) {
        subjectIds.push(subjectId);
      }
    }
  }
  subjectIds.push(readableSlot(candidate.kind));
  subjectIds.push(readableSlot(candidate.idempotencyKey));
  let proof: { readonly hashes?: readonly string[] };
  try {
    const hex = createHash('sha256').update(canonicalJson(input.submission), 'utf8').digest('hex');
    proof = { hashes: [`gwsub.v1.${hex}`] };
  } catch {
    // The submission is not canonical-JSON-encodable (contains a function,
    // symbol, bigint, cycle, or float — evidence/canonical.ts rejects all
    // five). The proof slot is optional per A15 lines 31-32; the refusal is
    // still fully identified by what/when/authority/outcome.
    proof = {};
  }
  return {
    what: {
      operationType: GATEWAY_EVIDENCE_VOCABULARY.rejectedOperationType,
      subjectIds: Object.freeze([...subjectIds]),
    },
    when: input.when,
    authority: input.evidenceAuthority,
    outcome: {
      result: GATEWAY_EVIDENCE_VOCABULARY.rejectedResult,
      reasonCode: input.reasonCode,
    },
    proof,
  };
}

/**
 * Submit one evidence record through the kernel port (the REAL A15 log is
 * the injected implementation — createEvidenceLog; RTN-002 is merged at
 * this base). Awaits thenable returns so an async port arm completes
 * before the caller proceeds (the A15 synchronous-write discipline).
 *
 * Source: kernel/ports.ts EvidenceSubmission; A15 lines 62-64.
 */
export async function submitGatewayEvidence(
  port: EvidenceSubmission,
  record: EvidenceSubmissionRecord,
): Promise<void> {
  const outcome = port.submit(record);
  if (outcome instanceof Promise) {
    await outcome;
  }
}

function readableSlot(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : GATEWAY_UNKNOWN_SUBJECT_TOKEN;
}
