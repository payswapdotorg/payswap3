/**
 * RTN-002 — Evidence Authority: the EvidenceLog.
 *
 * The append-only, totally sequenced, hash-chained log of EvidenceRecords —
 * the A15 audit backbone — together with the EvidenceSubmission port
 * implementation (the kernel declared the port type; this module owns the
 * implementation) and the synchronous commit coupling.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   35-37:
 *     "EvidenceLog — append-only, totally sequenced, hash-chained log of
 *      EvidenceRecords. Each record's proof includes the hash of its
 *      predecessor, making tampering detectable."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   39-43 (the submission relationship):
 *     "Evidence Authority (protocol layer, area 15) owns the log and record
 *      schema. All other authorities are writers-by-submission only; none
 *      can alter or suppress records."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   60-64 (the write discipline):
 *     "Evidence writing is internal and synchronous with the operation it
 *      records: an operation is not committed until its record is written.
 *      A failed write fails the operation. There is no UNKNOWN state in
 *      the log itself."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   70-74 (lifecycle events):
 *     "The log's own lifecycle events are also recorded (log genesis,
 *      verification runs). Verification results are recorded with the
 *      verified chain height and final hash."
 *   spec/architecture/v0.1/README.md §3 GC-5, lines 63-67 (exactly one
 *   record per consequential operation, five fields).
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - The log structurally IMPLEMENTS the kernel's EvidenceSubmission port:
 *     its single submit() method is the writers-by-submission channel, and
 *     it is synchronous (the void arm of the port's void-or-Promise shape —
 *     the strongest form of the A15 synchronous-write discipline).
 *   - A duplicate write (same INV-15-4 write key — the same subject
 *     operation) is a no-op, not a failure: the operation's record already
 *     exists, so its commit discipline is already satisfied.
 *   - Every validation or encoding failure throws synchronously out of
 *     submit(): a failed write fails the operation that called it.
 *   - No clock: all wall times are caller-supplied; the log mints only the
 *     total sequence (its own ordering — "the kernel does not own
 *     sequencing ... that belongs to the authorities' ledgers/logs", kernel
 *     time.ts). Deterministic for identical inputs (GC-1).
 *   - INV-15-2 at the code level: the log exposes no update, delete, clear,
 *     or truncate member; records are deep-frozen at mint; snapshots are
 *     frozen copy-on-write arrays, so previously obtained snapshots never
 *     change under the caller.
 *   - The log's own lifecycle events (genesis at creation; every
 *     verification run) are recorded through the same append path as any
 *     other record — as records themselves, with the Evidence Authority as
 *     their authority.
 */

import { protocolTime } from '../kernel/time.ts';
import type { EvidenceSubmission, EvidenceSubmissionRecord } from '../kernel/ports.ts';
import {
  EVIDENCE_AUTHORITY_NAME,
  EVIDENCE_LIFECYCLE_VOCABULARY,
  evidenceRecordId,
  evidenceWriteKey,
  validateEvidenceSubmission,
} from './record.ts';
import type { EvidenceRecord } from './record.ts';
import { GENESIS_PREDECESSOR_HASH, computeRecordHash, verifyEvidenceChain } from './chain.ts';
import type { ChainVerification } from './chain.ts';

/**
 * Options for creating an EvidenceLog.
 *
 * wallMs — the recorded wall time of the log's genesis record. The log has
 * no internal clock (determinism, GC-1): every wall time it ever records is
 * caller-supplied, starting with genesis.
 *
 * Source: evidence-risk-compliance.md line 28 — "when: protocol time
 * (sequenced) and recorded wall time."; lines 70-72 — "The log's own
 * lifecycle events are also recorded (log genesis, ...)".
 */
export interface EvidenceLogOptions {
  readonly wallMs: number;
}

/**
 * The EvidenceLog: append-only, totally sequenced, hash-chained. This
 * interface is also the kernel port's IMPLEMENTATION type — an EvidenceLog
 * structurally satisfies EvidenceSubmission (its submit() is the
 * writers-by-submission channel, synchronous per A15 lines 62-64).
 *
 * There is deliberately NO update, delete, clear, or truncate member
 * (INV-15-2 — "the log is append-only; no record is modified or removed");
 * the mutation paths are unrepresentable in the API surface itself.
 *
 * Source: evidence-risk-compliance.md lines 35-43; INV-15-2 lines 51-53;
 * INV-15-4 lines 56-58; A15 lines 62-64.
 */
export interface EvidenceLog extends EvidenceSubmission {
  /**
   * Append one record — the EvidenceSubmission port's write channel
   * (narrowed to the synchronous void arm of the port's void-or-Promise
   * shape: the strongest form of A15's synchronous write discipline).
   * Returns void when the record is written (or already written — the
   * duplicate no-op), throws when the write fails. A failed write fails
   * the operation that called submit (A15 lines 62-64).
   */
  submit(record: EvidenceSubmissionRecord): void;
  /** Total number of records written (the chain height; genesis included). */
  readonly height: number;
  /** The record hash of the head record (the genesis sentinel is never observable: a created log has at least the genesis record). */
  readonly headHash: string;
  /** Immutable snapshot of all records in total sequence order. */
  records(): readonly EvidenceRecord[];
  /** The record at a log sequence number, if written. */
  recordAt(sequenceNumber: number): EvidenceRecord | undefined;
  /** The record with a given derived record id, if written. */
  recordById(recordId: string): EvidenceRecord | undefined;
  /**
   * Run the pure chain verification over the current records and record the
   * run as a lifecycle record (the verdict, the verified chain height, and
   * the final hash — A15 lines 72-74). Returns the verdict. Recording a
   * TAMPER_DETECTED verdict is itself an append: the tampered records stay
   * (append-only), and the detection becomes part of the log.
   */
  verifyAndRecord(wallMs: number): ChainVerification;
}

/**
 * Create an EvidenceLog. The log comes into existence by writing its
 * genesis record (sequence 0, the Evidence Authority as authority, the
 * genesis sentinel as predecessor) — "The log's own lifecycle events are
 * also recorded (log genesis, ...)".
 *
 * Deterministic: identical options yield an identical genesis record
 * (identical record id and hash) and an identical initial chain state.
 *
 * Source: evidence-risk-compliance.md lines 35-37 (hash-chained from
 * genesis); lines 70-72 (genesis is recorded); INV-15-3 lines 54-55
 * ("verifies deterministically from genesis").
 */
export function createEvidenceLog(options: EvidenceLogOptions): EvidenceLog {
  const genesisSubmission: EvidenceSubmissionRecord = {
    what: {
      operationType: EVIDENCE_LIFECYCLE_VOCABULARY.genesisOperationType,
      subjectIds: [],
    },
    when: protocolTime(0, options.wallMs),
    authority: EVIDENCE_AUTHORITY_NAME,
    outcome: { result: EVIDENCE_LIFECYCLE_VOCABULARY.genesisResult },
    proof: {},
  };
  const state: LogState = {
    records: [],
    writeKeys: new Set<string>(),
    byId: new Map<string, EvidenceRecord>(),
    headHash: GENESIS_PREDECESSOR_HASH,
  };
  appendSubmission(state, genesisSubmission);
  return {
    submit: (record: EvidenceSubmissionRecord): void => {
      appendSubmission(state, record);
    },
    get height(): number {
      return state.records.length;
    },
    get headHash(): string {
      return state.headHash;
    },
    records: (): readonly EvidenceRecord[] => state.records,
    recordAt: (sequenceNumber: number): EvidenceRecord | undefined =>
      sequenceNumber >= 0 && sequenceNumber < state.records.length
        ? state.records[sequenceNumber]
        : undefined,
    recordById: (recordId: string): EvidenceRecord | undefined => state.byId.get(recordId),
    verifyAndRecord: (wallMs: number): ChainVerification => {
      const verification = verifyEvidenceChain(state.records);
      appendSubmission(
        state,
        verificationLifecycleSubmission(verification, wallMs),
      );
      return verification;
    },
  };
}

/**
 * Build the lifecycle submission for one verification run: the Evidence
 * Authority's own record of the run — the verdict as the outcome (with the
 * divergence class as the reason code when tampering was detected), the
 * verified chain height and final hash as proof material ("Verification
 * results are recorded with the verified chain height and final hash"),
 * and the verified chain height as the sequenced protocol time (which, on
 * a healthy log, is also the log sequence the run's record will occupy).
 * PURE: deterministic in (verification, wallMs).
 *
 * Source: evidence-risk-compliance.md lines 70-74 — "The log's own
 * lifecycle events are also recorded (log genesis, verification runs).
 * Verification results are recorded with the verified chain height and
 * final hash."
 */
export function verificationLifecycleSubmission(
  verification: ChainVerification,
  wallMs: number,
): EvidenceSubmissionRecord {
  return {
    what: {
      operationType: EVIDENCE_LIFECYCLE_VOCABULARY.verificationOperationType,
      subjectIds: [],
    },
    when: protocolTime(verification.verifiedHeight, wallMs),
    authority: EVIDENCE_AUTHORITY_NAME,
    outcome:
      verification.verdict === 'VERIFIED'
        ? { result: EVIDENCE_LIFECYCLE_VOCABULARY.verifiedResult }
        : {
            result: EVIDENCE_LIFECYCLE_VOCABULARY.tamperDetectedResult,
            reasonCode: verification.divergence === null ? undefined : verification.divergence.problem,
          },
    proof: {
      hashes: [verification.finalHash],
      sequenceNumbers:
        verification.divergence === null
          ? [verification.verifiedHeight]
          : [verification.verifiedHeight, verification.divergence.sequenceNumber],
    },
  };
}

/**
 * The synchronous commit coupling: run the operation, write its evidence
 * record, and only then deliver the operation's result. The result escapes
 * this function ONLY through a successful record write — the API shape
 * makes "an operation committed without its record written" unrepresentable
 * (A15 lines 62-64: "an operation is not committed until its record is
 * written. A failed write fails the operation").
 *
 * Order of events: `operation()` runs first (the record's outcome slot
 * describes the operation's actual result — the evidence callback builds
 * the submission from the result it is given); `submit` then writes the
 * record synchronously; the return happens last. If operation() throws,
 * nothing was recorded and nothing is delivered — whether a failed
 * operation attempt is itself recorded is the caller's decision (a failure
 * outcome with a reason code is a recordable submission; this helper's
 * contract covers the success path).
 *
 * Source: evidence-risk-compliance.md lines 62-64; GC-5 (README.md §3
 * lines 63-67 — the record is part of the operation, not an afterthought).
 */
export function commitWithEvidence<T>(
  log: EvidenceLog,
  operation: () => T,
  evidence: (result: T) => EvidenceSubmissionRecord,
): T {
  const result = operation();
  log.submit(evidence(result));
  return result;
}

interface LogState {
  records: readonly EvidenceRecord[];
  writeKeys: Set<string>;
  byId: Map<string, EvidenceRecord>;
  headHash: string;
}

/**
 * The single append path — genesis, verification runs, and every submitter's
 * submission all flow through here. Validates, derives the INV-15-4 write
 * key (duplicate = no-op), mints the frozen record chained to the current
 * head, and extends the copy-on-write state.
 */
function appendSubmission(state: LogState, submission: EvidenceSubmissionRecord): void {
  validateEvidenceSubmission(submission);
  const writeKey = evidenceWriteKey(submission);
  if (state.writeKeys.has(writeKey)) {
    // INV-15-4: the subject operation's record is already written; a
    // duplicate write is a no-op (the operation's commit discipline is
    // already satisfied), not a failure.
    return;
  }
  const recordId = evidenceRecordId(submission);
  const sequenceNumber = state.records.length;
  const predecessorHash = state.headHash;
  const recordHash = computeRecordHash(submission, sequenceNumber, predecessorHash);
  const record: EvidenceRecord = deepFreeze({
    what: submission.what,
    when: submission.when,
    authority: submission.authority,
    outcome: submission.outcome,
    proof: deepFreeze({
      ...submission.proof,
      recordId,
      sequenceNumber,
      predecessorHash,
      recordHash,
    }),
  });
  state.records = Object.freeze([...state.records, record]);
  state.writeKeys.add(writeKey);
  state.byId.set(recordId, record);
  state.headHash = recordHash;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}
