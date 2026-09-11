/**
 * RTN-002 — Evidence Authority: the hash chain.
 *
 * The chain discipline of the A15 EvidenceLog: every record's proof includes
 * the hash of its predecessor, the whole chain verifies deterministically
 * from genesis, and verification is a pure function of the log.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   35-37 (the chain contract):
 *     "EvidenceLog — append-only, totally sequenced, hash-chained log of
 *      EvidenceRecords. Each record's proof includes the hash of its
 *      predecessor, making tampering detectable."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   54-55 (INV-15-3):
 *     "INV-15-3 (integrity): the hash chain verifies deterministically
 *      from genesis; verification is a pure function of the log."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   31-32 (the proof material the hash covers):
 *     "proof: hashes, sequence numbers, and links to prior records
 *      required to verify the record."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   73-74 (what a verification result carries):
 *     "Verification results are recorded with the verified chain height
 *      and final hash."
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - The record hash is sha256 over the canonical JSON encoding of the
 *     record's five slots (submitter proof material included, chain fields
 *     excluded by construction) plus the chain position (sequence number and
 *     predecessor hash). Every content mutation therefore changes the hash.
 *   - The record id is NOT hashed into the record hash; instead,
 *     verification re-derives the id from the record's own slots, so id
 *     tampering is independently detectable while the hash stays a pure
 *     content+position digest.
 *   - Genesis (sequence 0) carries a non-hex sentinel predecessor — there is
 *     no predecessor to hash, and the sentinel is visually distinct from
 *     every real 64-hex digest.
 *   - Verification checks, per record at sequence n: total sequencing
 *     (n === index), the predecessor link (proof.predecessorHash ===
 *     records[n-1].proof.recordHash, or the genesis sentinel at n === 0),
 *     the record hash re-computation, and the record-id re-derivation. Any
 *     mutation of any record — content, hash, link, id, sequence, or an
 *     interior deletion/reordering — diverges at exactly one determinable
 *     position.
 */

import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical.ts';
import { canonicalSubmissionEncoding, evidenceRecordId } from './record.ts';
import type { EvidenceRecord } from './record.ts';
import type { EvidenceProof } from '../kernel/ports.ts';
import type { EvidenceWhat, EvidenceOutcome } from '../kernel/ports.ts';

/**
 * Version of the chain's hash-input format. Bump on any change to what the
 * record hash covers; the version integer is inside the hashed payload, so
 * mixed-format records hash differently and are detectable (the same
 * versioned-input discipline as the kernel's DERIVATION_FORMAT_VERSION).
 *
 * Source: INV-15-3 (evidence-risk-compliance.md lines 54-55 — deterministic,
 * comparable verification); kernel identity.ts versioned-format contract
 * (INV-4-3 core.md lines 248-249).
 */
export const EVIDENCE_CHAIN_FORMAT_VERSION = 1;

/**
 * The predecessor-hash sentinel carried by the genesis record (sequence 0):
 * genesis has no predecessor to hash. Deliberately not hex-shaped so it can
 * never be confused with a real record hash.
 *
 * Source: evidence-risk-compliance.md lines 35-37 ("Each record's proof
 * includes the hash of its predecessor" — the first record is the exception
 * the chain grows FROM); INV-15-3 lines 54-55 ("verifies deterministically
 * from genesis").
 */
export const GENESIS_PREDECESSOR_HASH = 'GENESIS';

/**
 * How a record can diverge from the chain contract. Each class names the
 * proof-slot field whose check failed; together they are the evidence
 * area's verification reason codes (the outcome vocabulary the Evidence
 * Authority records for TAMPER_DETECTED verification runs).
 *
 * Source: evidence-risk-compliance.md lines 31-37 (the proof material and
 * chain contract these checks enforce); lines 30 + 73-74 (outcome carries
 * reason codes; verification results carry height and final hash).
 */
export type ChainDivergenceProblem =
  | 'SEQUENCE_MISMATCH'
  | 'PREDECESSOR_HASH_MISMATCH'
  | 'RECORD_HASH_MISMATCH'
  | 'RECORD_ID_MISMATCH';

/**
 * The frozen verification reason-code vocabulary (the four divergence
 * classes). The Evidence Authority owns its record schema (A15 lines
 * 41-42), so this vocabulary is evidence-area-owned, minimal, and frozen —
 * no runtime extension.
 *
 * Source: A15 lines 30 ("outcome: ... including reason codes") + lines
 * 54-55 (INV-15-3) + lines 73-74 (verification results).
 */
export const EVIDENCE_VERIFICATION_REASON_CODES: readonly ChainDivergenceProblem[] = Object.freeze([
  'SEQUENCE_MISMATCH',
  'PREDECESSOR_HASH_MISMATCH',
  'RECORD_HASH_MISMATCH',
  'RECORD_ID_MISMATCH',
]);

/**
 * Where and how the chain diverged: the sequence number of the first record
 * that fails its chain check, and the class of the failure. The detail
 * string is constructed from the actual mismatched values — deterministic
 * for a given log state.
 *
 * Source: evidence-risk-compliance.md lines 36-37 ("making tampering
 * detectable").
 */
export interface ChainDivergence {
  readonly sequenceNumber: number;
  readonly problem: ChainDivergenceProblem;
  readonly detail: string;
}

/**
 * The verdict of one chain verification: the verdict itself, the height of
 * the verified intact prefix ("the verified chain height"), the record hash
 * at that height ("final hash" — the genesis sentinel when the prefix is
 * empty), and the first divergence when tampering was detected.
 *
 * Source: evidence-risk-compliance.md lines 73-74 — "Verification results
 * are recorded with the verified chain height and final hash."; INV-15-3
 * lines 54-55.
 */
export interface ChainVerification {
  readonly verdict: 'VERIFIED' | 'TAMPER_DETECTED';
  readonly verifiedHeight: number;
  readonly finalHash: string;
  readonly divergence: ChainDivergence | null;
}

/**
 * The record hash: sha256 over the canonical JSON encoding of the record's
 * five slots (submitter proof material included) plus its chain position
 * (log sequence number and predecessor hash). Deterministic: identical
 * record content at an identical chain position always yields the identical
 * hash; any content or position difference yields a different hash.
 *
 * The chain fields (recordId/sequenceNumber/predecessorHash/recordHash) are
 * excluded from the submission view by construction — the hash input is
 * minted from the submission slots and the position being assigned.
 *
 * Source: evidence-risk-compliance.md lines 35-37 (the hash chain);
 * lines 31-32 (the proof material); GC-1 (README.md §3 lines 39-43).
 */
export function computeRecordHash(
  submission: {
    readonly what: EvidenceWhat;
    readonly when: EvidenceRecord['when'];
    readonly authority: EvidenceRecord['authority'];
    readonly outcome: EvidenceOutcome;
    readonly proof: EvidenceProof;
  },
  sequenceNumber: number,
  predecessorHash: string,
): string {
  // Three unambiguous, independently canonical segments: the format
  // header, the submission identity (submitter proof material only — chain
  // fields are excluded by canonicalSubmissionEncoding's projection), and
  // the chain position being assigned.
  const hashInput = [
    `ev.v${EVIDENCE_CHAIN_FORMAT_VERSION}`,
    canonicalSubmissionEncoding(submission),
    canonicalJson({ sequenceNumber, predecessorHash }),
  ].join('|');
  return createHash('sha256').update(hashInput, 'utf8').digest('hex');
}

/**
 * Verify an evidence chain. PURE: a total function of the record list alone
 * — no clocks, no store, no side effects. Re-running it on the identical
 * list yields the identical verdict, and the verdict is deterministic for
 * any list state (INV-15-3).
 *
 * Checks per record at index n: the log's total sequencing (n ===
 * proof.sequenceNumber, contiguously from 0); the predecessor link (the
 * genesis sentinel at n === 0, else the prior record's recordHash); the
 * record-hash re-computation over the record's own content and position;
 * and the record-id re-derivation from the record's own five slots.
 *
 * On divergence: the verdict is TAMPER_DETECTED, verifiedHeight is the
 * length of the intact prefix, finalHash is the record hash at that height
 * (the genesis sentinel when the very first record diverges), and
 * divergence names the first failing sequence number and class. On success:
 * VERIFIED with the full height and the head hash.
 *
 * Source: evidence-risk-compliance.md lines 35-37; INV-15-3 lines 54-55;
 * lines 73-74 (height + final hash).
 */
export function verifyEvidenceChain(records: readonly EvidenceRecord[]): ChainVerification {
  let previousHash = GENESIS_PREDECESSOR_HASH;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined) {
      break;
    }
    if (record.proof.sequenceNumber !== index) {
      return divergence(
        index,
        'SEQUENCE_MISMATCH',
        previousHash,
        `record at position ${index} carries sequence number ${record.proof.sequenceNumber}`,
      );
    }
    if (record.proof.predecessorHash !== previousHash) {
      return divergence(
        index,
        'PREDECESSOR_HASH_MISMATCH',
        previousHash,
        `record at sequence ${index} links predecessor ${record.proof.predecessorHash} but the chain's prior hash is ${previousHash}`,
      );
    }
    const recomputedHash = computeRecordHash(record, index, previousHash);
    if (record.proof.recordHash !== recomputedHash) {
      return divergence(
        index,
        'RECORD_HASH_MISMATCH',
        previousHash,
        `record at sequence ${index} stores hash ${record.proof.recordHash} but its content hashes to ${recomputedHash}`,
      );
    }
    const derivedId = evidenceRecordId(record);
    if (record.proof.recordId !== derivedId) {
      return divergence(
        index,
        'RECORD_ID_MISMATCH',
        previousHash,
        `record at sequence ${index} stores id ${record.proof.recordId} but its content derives id ${derivedId}`,
      );
    }
    previousHash = recomputedHash;
  }
  return {
    verdict: 'VERIFIED',
    verifiedHeight: records.length,
    finalHash: previousHash,
    divergence: null,
  };
}

function divergence(
  index: number,
  problem: ChainDivergenceProblem,
  intactPrefixHash: string,
  detail: string,
): ChainVerification {
  return {
    verdict: 'TAMPER_DETECTED',
    verifiedHeight: index,
    finalHash: intactPrefixHash,
    divergence: { sequenceNumber: index, problem, detail },
  };
}
