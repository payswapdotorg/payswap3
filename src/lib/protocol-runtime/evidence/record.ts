/**
 * RTN-002 — Evidence Authority: the EvidenceRecord type, the authority-name
 * contract, submission validation, and INV-15-4 write-key derivation.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   25-33 (the record contract this module materializes):
 *     "EvidenceRecord — one immutable record per consequential operation.
 *      Fields (mandatory, exactly these five semantic slots):
 *      - what: operation type and subject object ids.
 *      - when: protocol time (sequenced) and recorded wall time.
 *      - authority: which protocol authority performed the operation.
 *      - outcome: resulting state or decision, including reason codes.
 *      - proof: hashes, sequence numbers, and links to prior records
 *        required to verify the record.
 *      State: WRITTEN (terminal). Records are never updated or deleted."
 *   spec/architecture/v0.1/README.md §3 GC-5, lines 63-67:
 *     "GC-5 — Every consequential operation produces an evidence record. ...
 *      Each writes exactly one evidence record (area 15) with fields: what,
 *      when, authority, outcome, proof."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   39-43 (the owning-authority contract):
 *     "Evidence Authority (protocol layer, area 15) owns the log and record
 *      schema. All other authorities are writers-by-submission only; none
 *      can alter or suppress records."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   56-58 (INV-15-4, the write-key contract):
 *     "evidence write keys derived from the subject operation id prevent
 *      duplicate records for one operation."
 *   spec/registry/protocol-registry.json (the authority-name enumeration):
 *     every area's "owningAuthority" value (lines 36, 47, 58, 69, 80, 91,
 *     102, 113, 124, 135, 146, 157, 168, 179, 190, 202, 213, 227, 238,
 *     249, 260, 271, 282, 293). A15's own owning authority is
 *     "Evidence Authority" (line 190). A13 and A23 both name the
 *     "Rail Authority" (lines 168, 282) — the registry enumerates 24 areas
 *     over 23 distinct authority names.
 *
 * The record shape extends the kernel's port types (src/lib/protocol-runtime/
 * kernel/ports.ts): what/when/authority/outcome are exactly the kernel's
 * EvidenceWhat/ProtocolTime/EvidenceOutcome, and proof extends the kernel's
 * EvidenceProof with the chain material A15 line 31-32 requires ("hashes,
 * sequence numbers, and links to prior records required to verify the
 * record") — the log's sequence number, the predecessor-hash link, the
 * record's own hash, and its derived record id. No slot is redeclared and
 * no conflicting shape is introduced.
 *
 * Interpretation decisions recorded in CONTRACT-REVIEW.md (summary):
 *   - "State: WRITTEN (terminal)" (line 33) is materialized as EXISTENCE:
 *     the record type exists only in its written, deep-frozen form; the
 *     append is the WRITTEN transition and there is no second state to
 *     represent, so no sixth field is added to the five semantic slots.
 *   - INV-15-4's "subject operation id" is the identity of the operation the
 *     submission records, expressed through the port's own five slots (the
 *     kernel port carries no separate operation-id field); the write key is
 *     derived from the canonical encoding of that identity via the kernel
 *     identity module, exactly the derivation route the work order names.
 */

import { canonicalJson } from './canonical.ts';
import { deriveIdempotencyKey, deriveProtocolId } from '../kernel/identity.ts';
import type { DerivedIdempotencyKey, DerivedProtocolId } from '../kernel/identity.ts';
import { isProtocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type {
  EvidenceWhat,
  EvidenceOutcome,
  EvidenceProof,
  EvidenceSubmissionRecord,
} from '../kernel/ports.ts';

/**
 * The registry's owning-authority names — the complete closed set of
 * authorities that may appear in a record's 'authority' slot. A submission
 * from any other name is rejected (a failed write fails the operation).
 *
 * Enumerated from spec/registry/protocol-registry.json's 24 areas; the
 * "Rail Authority" owns both A13 (external rail adapters) and A23
 * (blockchain rails), so the distinct-name count is 23. The set is frozen:
 * authority admission is a registry change, not a runtime one. The
 * registry-conformance test re-reads the registry JSON and asserts this
 * list matches it exactly (schema contradiction between A15 and the
 * registry is a work-order stop condition — the test makes the contradiction
 * loud instead of silent).
 *
 * Source: spec/registry/protocol-registry.json "owningAuthority" fields
 * (lines 36-293); A15 line 29 — "authority: which protocol authority
 * performed the operation."
 */
export const EVIDENCE_AUTHORITIES: readonly string[] = Object.freeze([
  'Intent Authority',
  'Fulfillment Policy Authority',
  'Capability Authority',
  'Routing Authority',
  'Reservation Authority',
  'Liquidity Authority',
  'Credit Authority',
  'Queue Authority',
  'Clearing Authority',
  'Obligation Authority',
  'Netting Authority',
  'Settlement and Finality Authority',
  'Rail Authority',
  'Reconciliation Authority',
  'Evidence Authority',
  'Risk and Compliance Authority',
  'Simulation Authority',
  'Marketplace Authority',
  'Agent Authority',
  'Merchant Authority',
  'Recourse Authority',
  'Federation Authority',
  'Emergence Authority',
]);

/**
 * The Evidence Authority's own name (the log's owning authority; the
 * authority that records the log's lifecycle events).
 *
 * Source: spec/registry/protocol-registry.json A15 line 190 —
 * "owningAuthority": "Evidence Authority"; evidence-risk-compliance.md
 * lines 41-42 — "Evidence Authority (protocol layer, area 15) owns the log
 * and record schema."
 */
export const EVIDENCE_AUTHORITY_NAME = 'Evidence Authority';

/**
 * The log's own lifecycle-event vocabulary — the operation types and outcome
 * results the Evidence Authority records for the log's own lifecycle
 * (genesis, verification runs).
 *
 * Source: evidence-risk-compliance.md lines 70-74 — "The log's own lifecycle
 * events are also recorded (log genesis, verification runs). Verification
 * results are recorded with the verified chain height and final hash."
 */
export const EVIDENCE_LIFECYCLE_VOCABULARY = Object.freeze({
  genesisOperationType: 'EVIDENCE_LOG_GENESIS',
  verificationOperationType: 'EVIDENCE_LOG_VERIFICATION',
  genesisResult: 'GENESIS',
  verifiedResult: 'VERIFIED',
  tamperDetectedResult: 'TAMPER_DETECTED',
} as const);

/**
 * The proof slot of a WRITTEN EvidenceRecord: the kernel port's submitter
 * material (hashes, sequence numbers, prior-record links — the classes A15
 * names, varying with the operation recorded) extended with the chain
 * material the hash-chained log itself supplies — the log's total sequence
 * number, the predecessor-hash link, the record's own hash, and its derived
 * record id.
 *
 * Source: evidence-risk-compliance.md lines 31-32 — "proof: hashes, sequence
 * numbers, and links to prior records required to verify the record.";
 * lines 35-37 — "EvidenceLog — append-only, totally sequenced, hash-chained
 * log of EvidenceRecords. Each record's proof includes the hash of its
 * predecessor, making tampering detectable."
 */
export interface EvidenceRecordProof extends EvidenceProof {
  /** The record's own id — derived from the subject operation's identity (INV-15-4 route). */
  readonly recordId: string;
  /** The log's total sequence position of this record (0 = genesis). */
  readonly sequenceNumber: number;
  /** The record hash of the predecessor (GENESIS_PREDECESSOR_HASH for sequence 0). */
  readonly predecessorHash: string;
  /** This record's hash over the canonical encoding of its content and chain position. */
  readonly recordHash: string;
}

/**
 * One WRITTEN evidence record: exactly the five mandatory semantic slots —
 * what, when, authority, outcome, proof — no more, no less (GC-5; A15 lines
 * 26-32). The type exists only in its written, immutable form: minting is
 * the append, the minted object is deep-frozen, and no update or delete
 * path exists anywhere in this module (INV-15-2).
 *
 * Source: evidence-risk-compliance.md lines 25-33; README.md §3 GC-5 lines
 * 63-67.
 */
export interface EvidenceRecord {
  /** "what: operation type and subject object ids." (A15 line 27) */
  readonly what: EvidenceWhat;
  /** "when: protocol time (sequenced) and recorded wall time." (A15 line 28) */
  readonly when: ProtocolTime;
  /** "authority: which protocol authority performed the operation." (A15 line 29) */
  readonly authority: string;
  /** "outcome: resulting state or decision, including reason codes." (A15 line 30) */
  readonly outcome: EvidenceOutcome;
  /** "proof: hashes, sequence numbers, and links to prior records ..." (A15 lines 31-32) */
  readonly proof: EvidenceRecordProof;
}

/**
 * Runtime type guard: true iff the value is a structurally complete,
 * well-formed WRITTEN EvidenceRecord (exactly the five slots, each slot
 * shape-valid, chain material well-formed). Used to validate records read
 * back from the durable store and by consumers of the log's snapshots.
 *
 * Source: evidence-risk-compliance.md lines 26-32 (the five-slot contract
 * this guard re-checks field by field).
 */
export function isEvidenceRecord(value: unknown): value is EvidenceRecord {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<EvidenceRecord> & Record<string, unknown>;
  if (Object.keys(candidate).sort().join(',') !== 'authority,outcome,proof,what,when') {
    return false;
  }
  if (!isSubmissionShaped(candidate)) {
    return false;
  }
  const proof = candidate.proof as Partial<EvidenceRecordProof>;
  return (
    typeof proof.recordId === 'string' &&
    proof.recordId.length > 0 &&
    typeof proof.sequenceNumber === 'number' &&
    Number.isInteger(proof.sequenceNumber) &&
    proof.sequenceNumber >= 0 &&
    Number.isSafeInteger(proof.sequenceNumber) &&
    typeof proof.predecessorHash === 'string' &&
    proof.predecessorHash.length > 0 &&
    typeof proof.recordHash === 'string' &&
    proof.recordHash.length > 0
  );
}

/**
 * Validate an evidence submission. Throws a TypeError (deterministically,
 * with a precise message) on any violation; returns void when the submission
 * is recordable. The write path calls this BEFORE deriving keys or minting a
 * record — a failed validation is a failed write, and a failed write fails
 * the operation (A15 lines 62-64).
 *
 * Enforced: exactly the five semantic slots (GC-5 "exactly"); the kernel
 * port's per-slot shapes; the authority name is one of the registry's owning
 * authorities; all proof material is well-formed; JSON-representability is
 * enforced downstream by the canonical encoder (functions, symbols, bigints,
 * cycles, floats all throw there).
 *
 * Source: evidence-risk-compliance.md lines 26-33 (the field contract);
 * lines 39-43 (authority-name ownership); README.md §3 GC-5 lines 63-67.
 */
export function validateEvidenceSubmission(record: EvidenceSubmissionRecord): void {
  if (record === null || typeof record !== 'object') {
    fail('evidence submission must be an object');
  }
  const keys = Object.keys(record).sort();
  if (keys.length !== 5 || keys.join(',') !== 'authority,outcome,proof,what,when') {
    fail(
      `evidence submission must carry exactly the five semantic slots what/when/authority/outcome/proof (GC-5; got keys: [${keys.join(', ')}])`,
    );
  }
  const candidate = record as Partial<EvidenceSubmissionRecord> & Record<string, unknown>;

  // what: operation type and subject object ids (A15 line 27).
  const what = candidate.what;
  if (what === null || typeof what !== 'object' || Array.isArray(what)) {
    fail('evidence submission slot "what" must be an object');
  }
  const whatKeys = Object.keys(what).sort();
  if (whatKeys.join(',') !== 'operationType,subjectIds') {
    fail(
      `evidence submission slot "what" must carry exactly operationType and subjectIds (got keys: [${whatKeys.join(', ')}])`,
    );
  }
  const operationType = (what as unknown as Record<string, unknown>).operationType;
  if (typeof operationType !== 'string' || operationType.length === 0) {
    fail('evidence submission slot "what.operationType" must be a non-empty string');
  }
  const subjectIds = (what as unknown as Record<string, unknown>).subjectIds;
  if (!Array.isArray(subjectIds)) {
    fail('evidence submission slot "what.subjectIds" must be an array of subject object ids');
  }
  for (const subjectId of subjectIds) {
    if (typeof subjectId !== 'string' || subjectId.length === 0) {
      fail('evidence submission slot "what.subjectIds" must contain only non-empty strings');
    }
  }

  // when: protocol time (sequenced) and recorded wall time (A15 line 28) —
  // the kernel's guard is the shared time shape's authority.
  if (!isProtocolTime(candidate.when)) {
    fail('evidence submission slot "when" must be a well-formed ProtocolTime');
  }

  // authority: which protocol authority performed the operation (A15 line 29)
  // — validated against the registry's owning-authority names.
  const authority = candidate.authority;
  if (typeof authority !== 'string' || authority.length === 0) {
    fail('evidence submission slot "authority" must be a non-empty string');
  }
  if (!(EVIDENCE_AUTHORITIES as readonly string[]).includes(authority)) {
    fail(
      `evidence submission authority "${authority}" is not one of the registry's owning authorities (spec/registry/protocol-registry.json)`,
    );
  }

  // outcome: resulting state or decision, including reason codes (A15 line 30).
  const outcome = candidate.outcome;
  if (outcome === null || typeof outcome !== 'object' || Array.isArray(outcome)) {
    fail('evidence submission slot "outcome" must be an object');
  }
  const outcomeKeys = Object.keys(outcome).sort();
  if (outcomeKeys.join(',') !== 'reasonCode,result' && outcomeKeys.join(',') !== 'result') {
    fail(
      `evidence submission slot "outcome" must carry exactly result (and optionally reasonCode) (got keys: [${outcomeKeys.join(', ')}])`,
    );
  }
  const result = (outcome as unknown as Record<string, unknown>).result;
  if (typeof result !== 'string' || result.length === 0) {
    fail('evidence submission slot "outcome.result" must be a non-empty string');
  }
  const reasonCode = (outcome as unknown as Record<string, unknown>).reasonCode;
  if (reasonCode !== undefined && (typeof reasonCode !== 'string' || reasonCode.length === 0)) {
    fail('evidence submission slot "outcome.reasonCode", when present, must be a non-empty string');
  }

  // proof: hashes, sequence numbers, and links to prior records (A15 lines
  // 31-32) — all three optional per record, each well-formed when present.
  const proof = candidate.proof;
  if (proof === null || typeof proof !== 'object' || Array.isArray(proof)) {
    fail('evidence submission slot "proof" must be an object');
  }
  const proofKeys = Object.keys(proof).sort();
  const allowedProofKeys = ['hashes', 'priorRecordIds', 'sequenceNumbers'];
  for (const proofKey of proofKeys) {
    if (!allowedProofKeys.includes(proofKey)) {
      fail(
        `evidence submission slot "proof" allows only hashes/sequenceNumbers/priorRecordIds (got key: ${proofKey})`,
      );
    }
  }
  const proofRecord = proof as Record<string, unknown>;
  if (proofRecord.hashes !== undefined) {
    if (!Array.isArray(proofRecord.hashes)) {
      fail('evidence submission slot "proof.hashes" must be an array of hash/reference claims');
    }
    for (const hash of proofRecord.hashes) {
      if (typeof hash !== 'string' || hash.length === 0) {
        fail('evidence submission slot "proof.hashes" must contain only non-empty strings');
      }
    }
  }
  if (proofRecord.sequenceNumbers !== undefined) {
    if (!Array.isArray(proofRecord.sequenceNumbers)) {
      fail('evidence submission slot "proof.sequenceNumbers" must be an array of sequence numbers');
    }
    for (const sequenceNumber of proofRecord.sequenceNumbers) {
      if (
        typeof sequenceNumber !== 'number' ||
        !Number.isInteger(sequenceNumber) ||
        !Number.isSafeInteger(sequenceNumber)
      ) {
        fail('evidence submission slot "proof.sequenceNumbers" must contain only safe integers');
      }
    }
  }
  if (proofRecord.priorRecordIds !== undefined) {
    if (!Array.isArray(proofRecord.priorRecordIds)) {
      fail('evidence submission slot "proof.priorRecordIds" must be an array of prior record ids');
    }
    for (const priorRecordId of proofRecord.priorRecordIds) {
      if (typeof priorRecordId !== 'string' || priorRecordId.length === 0) {
        fail('evidence submission slot "proof.priorRecordIds" must contain only non-empty strings');
      }
    }
  }
}

/**
 * The canonical encoding of a submission's subject-operation identity: the
 * five slots' submission content (submitter proof material only — chain
 * material is excluded by construction), with subject ids and proof
 * material lists canonicalized ORDER-INDEPENDENTLY (sorted) so a
 * re-submission of the same operation derives the same identity regardless
 * of serialization order. The written record itself preserves the submitted
 * order verbatim; only the derived identity is order-insensitive.
 *
 * This is the input the kernel's identity module consumes for evidence
 * write keys and record ids.
 *
 * Source: INV-15-4 (evidence-risk-compliance.md lines 56-58 — "evidence
 * write keys derived from the subject operation id"); A15 line 27 — "what:
 * operation type and subject object ids."
 */
export function canonicalSubmissionEncoding(record: EvidenceSubmissionRecord): string {
  const proof = (record.proof ?? {}) as Partial<EvidenceProof>;
  const submission = {
    what: {
      operationType: record.what.operationType,
      subjectIds: [...record.what.subjectIds].sort(),
    },
    when: { sequence: record.when.sequence, wallMs: record.when.wallMs },
    authority: record.authority,
    outcome:
      record.outcome.reasonCode === undefined
        ? { result: record.outcome.result }
        : { result: record.outcome.result, reasonCode: record.outcome.reasonCode },
    proof: {
      ...(proof.hashes === undefined ? {} : { hashes: [...proof.hashes].sort() }),
      ...(proof.sequenceNumbers === undefined
        ? {}
        : { sequenceNumbers: [...proof.sequenceNumbers].sort((a, b) => a - b) }),
      ...(proof.priorRecordIds === undefined
        ? {}
        : { priorRecordIds: [...proof.priorRecordIds].sort() }),
    },
  };
  return canonicalJson(submission);
}

/**
 * The INV-15-4 evidence write key: derived via the kernel identity module
 * (`deriveIdempotencyKey`) from the canonical encoding of the submission's
 * subject-operation identity. Identical submissions (and re-submissions of
 * the same operation, whatever their serialization order) derive the
 * identical key; any content difference derives a different key. The log
 * refuses to append a second record under a key it has already written —
 * duplicate writes for one operation are no-ops.
 *
 * Source: evidence-risk-compliance.md lines 56-58 (INV-15-4); kernel
 * identity.ts derivation route (INV-1-2/1-3 core.md lines 57-62; DEP-003 §6
 * lines 130-133 "MUST always carry a key derived from domain identity").
 */
export function evidenceWriteKey(record: EvidenceSubmissionRecord): DerivedIdempotencyKey {
  return deriveIdempotencyKey('evidence.write', canonicalSubmissionEncoding(record));
}

/**
 * The record id of the WRITTEN record for a submission: derived via the
 * kernel identity module (`deriveProtocolId`) from the submission's write
 * key, in the derived-object-id namespace (distinct from the idempotency-key
 * namespace, per the kernel identity contract). Chain verification
 * re-derives this id from every record's own five slots, so a record whose
 * id does not match its content is detectable (INV-15-3 tamper detection).
 *
 * Source: INV-15-4 (evidence-risk-compliance.md lines 56-58) via the kernel
 * derivation contracts (INV-3-3 core.md lines 182-184; INV-5-3 core.md
 * lines 310-312); A15 lines 31-32 (proof carries the links and ids
 * "required to verify the record").
 */
export function evidenceRecordId(record: EvidenceSubmissionRecord): DerivedProtocolId {
  return deriveProtocolId('evidence-record', evidenceWriteKey(record));
}

function isSubmissionShaped(value: Record<string, unknown>): boolean {
  const what = value.what as Record<string, unknown> | undefined;
  if (
    what === null ||
    typeof what !== 'object' ||
    typeof what.operationType !== 'string' ||
    what.operationType.length === 0 ||
    !Array.isArray(what.subjectIds) ||
    what.subjectIds.some((id) => typeof id !== 'string' || id.length === 0)
  ) {
    return false;
  }
  if (!isProtocolTime(value.when)) {
    return false;
  }
  if (typeof value.authority !== 'string' || !(EVIDENCE_AUTHORITIES as readonly string[]).includes(value.authority)) {
    return false;
  }
  const outcome = value.outcome as Record<string, unknown> | undefined;
  if (
    outcome === null ||
    typeof outcome !== 'object' ||
    typeof outcome.result !== 'string' ||
    outcome.result.length === 0 ||
    (outcome.reasonCode !== undefined &&
      (typeof outcome.reasonCode !== 'string' || outcome.reasonCode.length === 0))
  ) {
    return false;
  }
  return true;
}

function fail(message: string): never {
  throw new TypeError(message);
}
