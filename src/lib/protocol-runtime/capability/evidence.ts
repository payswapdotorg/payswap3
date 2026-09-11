/**
 * RTN-005 — Capability Authority: A03 evidence emission through the
 * kernel-declared EvidenceSubmission port, to the REAL A15 log (RTN-002,
 * merged at this item's base).
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/core.md §3 Area 3, lines 197-200 (the complete
 *   named evidence set of the area):
 *     "Evidence produced
 *      - CAPABILITY_REGISTERED / CAPABILITY_STATE_CHANGED.
 *      - COMMITMENT_OFFERED, COMMITMENT_RESERVED, COMMITMENT_CONSUMED,
 *        COMMITMENT_RELEASED, COMMITMENT_EXPIRED (each with capacity
 *        arithmetic in the proof field)."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   26-32 (the exact five-slot record shape) and lines 62-64 (the
 *   synchronous coupling):
 *     "Evidence writing is internal and synchronous with the operation it
 *      records: an operation is not committed until its record is written.
 *      A failed write fails the operation."
 *   spec/architecture/v0.1/README.md §3 GC-5 lines 63-67.
 *   spec/registry/protocol-registry.json A03 — owningAuthority: "Capability
 *   Authority" (the 'authority' slot value; validated by the real log
 *   against EVIDENCE_AUTHORITIES).
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - One record per consequential operation, exactly the named set:
 *     registration -> CAPABILITY_REGISTERED; every capability state change
 *     (activate/degrade/retire) -> CAPABILITY_STATE_CHANGED; every
 *     commitment transition (offer/reserve/consume/release/expire,
 *     including the degradation invalidation of OFFERED commitments) ->
 *     the named COMMITMENT_* record. No other operation type is invented.
 *   - "each with capacity arithmetic in the proof field": every COMMITMENT_*
 *     record's proof.sequenceNumbers carries [reservedMinor, consumedMinor,
 *     declaredMinor] — the exact integers of the INV-3-1 identity after the
 *     transition (see capacity.ts capacityArithmeticProof).
 *   - The CAPABILITY_REGISTERED proof carries the declaration hash (the
 *     verifiable fingerprint of the advertised ability).
 *   - Emission is submit-then-commit at the authority layer ("A failed
 *     write fails the operation").
 */

import { createHash } from 'node:crypto';
import { canonicalDerivationInput } from '../kernel/identity.ts';
import type {
  EvidenceSubmission,
  EvidenceSubmissionRecord,
} from '../kernel/ports.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { isProtocolTime } from '../kernel/time.ts';
import { capacityArithmeticProof } from './capacity.ts';
import type { CapabilityAccounting } from './capacity.ts';
import type { CapabilityRecord, CommitmentRecord } from './types.ts';

/**
 * The authority identity recorded in the 'authority' slot of A03's records —
 * the registry's owning authority name for area 3.
 *
 * Source: spec/registry/protocol-registry.json A03 — "owningAuthority":
 * "Capability Authority"; core.md lines 197-200 (the named set's authority).
 */
export const CAPABILITY_AUTHORITY_ID = 'Capability Authority';

/**
 * The A03 evidence operation-type vocabulary — exactly the seven named
 * types, frozen (no inventions).
 *
 * Source: core.md lines 197-200 (the named set quoted in the module doc).
 */
export const CAPABILITY_EVIDENCE_VOCABULARY = Object.freeze({
  capabilityRegisteredOperationType: 'CAPABILITY_REGISTERED',
  capabilityStateChangedOperationType: 'CAPABILITY_STATE_CHANGED',
  commitmentOfferedOperationType: 'COMMITMENT_OFFERED',
  commitmentReservedOperationType: 'COMMITMENT_RESERVED',
  commitmentConsumedOperationType: 'COMMITMENT_CONSUMED',
  commitmentReleasedOperationType: 'COMMITMENT_RELEASED',
  commitmentExpiredOperationType: 'COMMITMENT_EXPIRED',
} as const);

/**
 * Version of the capability-declaration hash input format. Bump on any
 * change to the canonical encoding; hashed values carry the version in
 * their prefix (`cdh.v1.<hex>`).
 *
 * Source: GC-1 (README.md §3 lines 39-43 — comparable deterministic
 * derivations).
 */
export const CAPABILITY_DECLARATION_HASH_FORMAT_VERSION = 1;

function assertWhen(when: unknown): asserts when is ProtocolTime {
  if (!isProtocolTime(when)) {
    throw new TypeError('capability evidence: when must be a well-formed ProtocolTime');
  }
}

/**
 * The canonical, versioned encoding of a capability declaration — the
 * registration proof input. Pure function of the declaration; identical
 * declarations encode identically (GC-1), using the kernel's type-tagged
 * part encoding.
 *
 * Source: core.md lines 154-155 (the advertised ability's fields); A15
 * lines 31-32 (proof material "required to verify the record").
 */
export function canonicalCapabilityDeclaration(capability: CapabilityRecord): string {
  return canonicalDerivationInput([
    'capability-declaration',
    `v${CAPABILITY_DECLARATION_HASH_FORMAT_VERSION}`,
    capability.capabilityId,
    capability.declaration.railId,
    capability.declaration.corridor.sourceCurrency,
    capability.declaration.corridor.destinationCurrency,
    capability.declaration.corridor.sourceGeography,
    capability.declaration.corridor.destinationGeography,
    capability.declaration.costSchedule.currency,
    capability.declaration.costSchedule.scale,
    capability.declaration.costSchedule.amountMinor,
    capability.declaration.tier,
    capability.declaredCapacity.currency,
    capability.declaredCapacity.scale,
    capability.declaredCapacity.amountMinor,
  ]);
}

/**
 * The capability declaration hash: sha256 over the canonical encoding,
 * prefixed `cdh.v1.<hex>`. Feeds the CAPABILITY_REGISTERED proof slot.
 *
 * Source: A15 lines 31-32 (proof hashes); GC-1.
 */
export function capabilityDeclarationHash(capability: CapabilityRecord): string {
  const hex = createHash('sha256').update(canonicalCapabilityDeclaration(capability), 'utf8').digest('hex');
  return `cdh.v${CAPABILITY_DECLARATION_HASH_FORMAT_VERSION}.${hex}`;
}

/**
 * Build the CAPABILITY_REGISTERED record. Slot mapping of "CAPABILITY_
 * REGISTERED":
 *   - what.subjectIds: the capability id (the subject object being
 *     registered);
 *   - when: the registration time;
 *   - authority: Capability Authority;
 *   - outcome: REGISTERED;
 *   - proof.hashes: the declaration hash (the fingerprint of the
 *     advertised ability and its declared capacity bound).
 *
 * Source: core.md line 197; A15 lines 26-32; GC-5.
 */
export function capabilityRegisteredEvidence(
  capability: CapabilityRecord,
  when: ProtocolTime,
): EvidenceSubmissionRecord {
  assertWhen(when);
  if (capability.state !== 'REGISTERED') {
    throw new TypeError('capability evidence: CAPABILITY_REGISTERED requires the capability in REGISTERED');
  }
  return {
    what: {
      operationType: CAPABILITY_EVIDENCE_VOCABULARY.capabilityRegisteredOperationType,
      subjectIds: [capability.capabilityId],
    },
    when,
    authority: CAPABILITY_AUTHORITY_ID,
    outcome: { result: 'REGISTERED' },
    proof: { hashes: [capabilityDeclarationHash(capability)] },
  };
}

/**
 * Build the CAPABILITY_STATE_CHANGED record (ACTIVE, DEGRADED, RETIRED).
 * Slot mapping:
 *   - what.subjectIds: the capability id;
 *   - when: the transition time;
 *   - authority: Capability Authority;
 *   - outcome: the new state, with a reason code when the caller names one
 *     (e.g. a degradation cause);
 *   - proof: the declaration hash (the record's verification material).
 *
 * Source: core.md line 197 ("CAPABILITY_STATE_CHANGED"); A15 lines 26-32;
 * GC-5.
 */
export function capabilityStateChangedEvidence(
  capability: CapabilityRecord,
  when: ProtocolTime,
  options: { readonly reasonCode?: string } = {},
): EvidenceSubmissionRecord {
  assertWhen(when);
  const { reasonCode } = options;
  return {
    what: {
      operationType: CAPABILITY_EVIDENCE_VOCABULARY.capabilityStateChangedOperationType,
      subjectIds: [capability.capabilityId],
    },
    when,
    authority: CAPABILITY_AUTHORITY_ID,
    outcome: {
      result: capability.state,
      ...(reasonCode === undefined ? {} : { reasonCode }),
    },
    proof: { hashes: [capabilityDeclarationHash(capability)] },
  };
}

/**
 * Build one COMMITMENT_* record (the shared five-slot shape of all five
 * named commitment operation types). Slot mapping:
 *   - what.subjectIds: the commitment id, the capability id, and the intent
 *     id (the subject objects the promise concerns — the commitment id is
 *     the derived (intent id, capability id) identity of INV-3-3);
 *   - when: the transition time;
 *   - authority: Capability Authority;
 *   - outcome: the commitment's new state;
 *   - proof.sequenceNumbers: [reservedMinor, consumedMinor, declaredMinor]
 *     — the capacity arithmetic of the INV-3-1 identity after the
 *     transition ("each with capacity arithmetic in the proof field").
 *
 * Source: core.md lines 198-200; A15 lines 26-32, 31-32; INV-3-1 lines
 * 176-178; GC-5.
 */
export function commitmentEvidence(
  commitment: CommitmentRecord,
  accounting: CapabilityAccounting,
  when: ProtocolTime,
): EvidenceSubmissionRecord {
  assertWhen(when);
  const operationType = commitmentOperationType(commitment.state);
  return {
    what: {
      operationType,
      subjectIds: [commitment.commitmentId, commitment.capabilityId, commitment.intentId],
    },
    when,
    authority: CAPABILITY_AUTHORITY_ID,
    outcome: { result: commitment.state },
    proof: { sequenceNumbers: capacityArithmeticProof(accounting) },
  };
}

function commitmentOperationType(state: CommitmentRecord['state']): string {
  switch (state) {
    case 'OFFERED':
      return CAPABILITY_EVIDENCE_VOCABULARY.commitmentOfferedOperationType;
    case 'RESERVED':
      return CAPABILITY_EVIDENCE_VOCABULARY.commitmentReservedOperationType;
    case 'CONSUMED':
      return CAPABILITY_EVIDENCE_VOCABULARY.commitmentConsumedOperationType;
    case 'RELEASED':
      return CAPABILITY_EVIDENCE_VOCABULARY.commitmentReleasedOperationType;
    case 'EXPIRED':
      return CAPABILITY_EVIDENCE_VOCABULARY.commitmentExpiredOperationType;
  }
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
export async function submitCapabilityEvidence(
  port: EvidenceSubmission,
  record: EvidenceSubmissionRecord,
): Promise<void> {
  await port.submit(record);
}
