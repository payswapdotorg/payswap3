/**
 * RTN-001 — Protocol runtime kernel: the EvidenceSubmission port declaration.
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   25-33 (the five mandatory semantic slots):
 *     "EvidenceRecord — one immutable record per consequential operation.
 *      Fields (mandatory, exactly these five semantic slots):
 *      - what: operation type and subject object ids.
 *      - when: protocol time (sequenced) and recorded wall time.
 *      - authority: which protocol authority performed the operation.
 *      - outcome: resulting state or decision, including reason codes.
 *      - proof: hashes, sequence numbers, and links to prior records
 *        required to verify the record.
 *      State: WRITTEN (terminal). Records are never updated or deleted."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   41-43 (the submission relationship this port declares):
 *     "Evidence Authority (protocol layer, area 15) owns the log and record
 *      schema. All other authorities are writers-by-submission only; none
 *      can alter or suppress records."
 *   spec/architecture/v0.1/README.md §3 GC-5, lines 63-67:
 *     "Every consequential operation produces an evidence record. A
 *      consequential operation is any operation that creates, mutates, or
 *      resolves financial state, or authorizes an external effect. Each
 *      writes exactly one evidence record (area 15) with fields: what, when,
 *      authority, outcome, proof."
 *
 * This module is a TYPE-ONLY port DECLARATION. It defines no storage, no
 * implementation, and no behavior: the Evidence Authority (RTN-002)
 * implements the port over the append-only, totally sequenced, hash-chained
 * EvidenceLog, and every other authority consumes the port as a
 * writer-by-submission. Nothing here may be construed as a second evidence
 * authority or as evidence storage owned by the kernel.
 */

import type { ProtocolTime } from './time.ts';

/**
 * The 'what' slot: the operation type and the subject object ids the record
 * is about.
 *
 * Source: evidence-risk-compliance.md line 27 — "what: operation type and
 * subject object ids."; GC-5 (README.md §3 line 66).
 */
export interface EvidenceWhat {
  readonly operationType: string;
  readonly subjectIds: readonly string[];
}

/**
 * The 'outcome' slot: the resulting state or decision, including its reason
 * code (from the owning area's vocabulary; the shared vocabulary's only
 * member is UNKNOWN — see reason-codes.ts).
 *
 * Source: evidence-risk-compliance.md line 30 — "outcome: resulting state or
 * decision, including reason codes."
 */
export interface EvidenceOutcome {
  readonly result: string;
  readonly reasonCode?: string;
}

/**
 * The 'proof' slot: the verifiable material — hashes, sequence numbers, and
 * links to prior records. All three are optional per record: the spec lists
 * them as the classes of material "required to verify the record", which
 * varies with the operation recorded (RTN-002's hash chain supplies the
 * prior-record link invariant).
 *
 * Source: evidence-risk-compliance.md lines 31-32 — "proof: hashes, sequence
 * numbers, and links to prior records required to verify the record."
 */
export interface EvidenceProof {
  readonly hashes?: readonly string[];
  readonly sequenceNumbers?: readonly number[];
  readonly priorRecordIds?: readonly string[];
}

/**
 * One evidence submission: exactly the five mandatory semantic slots —
 * what, when, authority, outcome, proof — no more, no less.
 *
 * Source: evidence-risk-compliance.md lines 26-32 ("Fields (mandatory,
 * exactly these five semantic slots)"); GC-5 (README.md §3 lines 63-67).
 */
export interface EvidenceSubmissionRecord {
  readonly what: EvidenceWhat;
  readonly when: ProtocolTime;
  readonly authority: string;
  readonly outcome: EvidenceOutcome;
  readonly proof: EvidenceProof;
}

/**
 * The EvidenceSubmission port: every authority is a writer-by-submission to
 * the Evidence Authority's log; none can alter or suppress records. The
 * submit call is synchronous with the operation it records (A15 Failure
 * semantics: "an operation is not committed until its record is written. A
 * failed write fails the operation") — hence the void-or-Promise-void shape
 * with no return channel: submission carries no decision semantics back.
 *
 * Implementor: RTN-002 (the Evidence Authority owns the log and the record
 * schema). The kernel only DECLARES the port.
 *
 * Source: evidence-risk-compliance.md lines 41-43 — "All other authorities
 * are writers-by-submission only; none can alter or suppress records.";
 * lines 62-64 — "Evidence writing is internal and synchronous with the
 * operation it records: an operation is not committed until its record is
 * written. A failed write fails the operation."
 */
export interface EvidenceSubmission {
  submit(record: EvidenceSubmissionRecord): void | Promise<void>;
}
