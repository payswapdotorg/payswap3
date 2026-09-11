/**
 * RTN-002 — hash-chain verification tests (genesis, append, verify,
 * tamper-detect).
 *
 * Source of the tested contract: spec/architecture/v0.1/
 * evidence-risk-compliance.md §1 Area 15:
 *   lines 35-37 — "EvidenceLog — append-only, totally sequenced,
 *    hash-chained log of EvidenceRecords. Each record's proof includes the
 *    hash of its predecessor, making tampering detectable."
 *   lines 54-55 (INV-15-3) — "the hash chain verifies deterministically
 *    from genesis; verification is a pure function of the log."
 *   lines 73-74 — "Verification results are recorded with the verified
 *    chain height and final hash."
 */
import { describe, expect, test } from 'bun:test';
import { createEvidenceLog, verificationLifecycleSubmission } from './log.ts';
import {
  EVIDENCE_CHAIN_FORMAT_VERSION,
  EVIDENCE_VERIFICATION_REASON_CODES,
  GENESIS_PREDECESSOR_HASH,
  computeRecordHash,
  verifyEvidenceChain,
} from './chain.ts';
import { protocolTime } from '../kernel/time.ts';
import type { EvidenceRecord } from './record.ts';
import type { EvidenceSubmissionRecord } from '../kernel/ports.ts';

const WALL = 1_700_000_000_000;

function buildLog(): ReturnType<typeof createEvidenceLog> {
  const log = createEvidenceLog({ wallMs: WALL });
  const submissions: EvidenceSubmissionRecord[] = [
    {
      what: { operationType: 'INTENT_CREATED', subjectIds: ['intent-1'] },
      when: protocolTime(3, WALL + 1),
      authority: 'Intent Authority',
      outcome: { result: 'DRAFT' },
      proof: { sequenceNumbers: [3] },
    },
    {
      what: { operationType: 'COMMITMENT_RESERVED', subjectIds: ['commitment-1', 'intent-1'] },
      when: protocolTime(11, WALL + 2),
      authority: 'Capability Authority',
      outcome: { result: 'RESERVED', reasonCode: 'UNKNOWN' },
      proof: { hashes: ['claim-7'], priorRecordIds: ['ev-1'] },
    },
    {
      what: { operationType: 'SETTLEMENT_MARKED_FINAL', subjectIds: ['settlement-9'] },
      when: protocolTime(29, WALL + 3),
      authority: 'Settlement and Finality Authority',
      outcome: { result: 'FINAL' },
      proof: { hashes: ['stmt-1', 'stmt-2'], sequenceNumbers: [29, 30] },
    },
  ];
  for (const submission of submissions) {
    log.submit(submission);
  }
  return log;
}

/** Deep, unfrozen copy of a record list — the "tamperer's" working material. */
function copyRecords(records: readonly EvidenceRecord[]): EvidenceRecord[] {
  return records.map((record) => JSON.parse(JSON.stringify(record)) as EvidenceRecord);
}

describe('chain verification (INV-15-3: deterministic from genesis, pure)', () => {
  test('genesis: the first record chains from the genesis sentinel at sequence 0', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    const genesis = log.recordAt(0);
    expect(genesis !== undefined).toBe(true);
    expect(genesis?.proof.sequenceNumber).toBe(0);
    expect(genesis?.proof.predecessorHash).toBe(GENESIS_PREDECESSOR_HASH);
    expect(GENESIS_PREDECESSOR_HASH).toBe('GENESIS');
    const verification = verifyEvidenceChain(log.records());
    expect(verification.verdict).toBe('VERIFIED');
    expect(verification.verifiedHeight).toBe(1);
    expect(verification.finalHash).toBe(genesis?.proof.recordHash);
  });

  test('append: every appended record links the prior record hash, and the chain verifies', () => {
    const log = buildLog();
    expect(log.height).toBe(4);
    for (let index = 1; index < log.height; index += 1) {
      const record = log.recordAt(index);
      const predecessor = log.recordAt(index - 1);
      expect(record?.proof.sequenceNumber).toBe(index);
      expect(record?.proof.predecessorHash).toBe(predecessor?.proof.recordHash);
    }
    const verification = verifyEvidenceChain(log.records());
    expect(verification.verdict).toBe('VERIFIED');
    expect(verification.verifiedHeight).toBe(4);
    expect(verification.finalHash).toBe(log.headHash);
    expect(verification.divergence).toBe(null);
  });

  test('verify: verification is pure — identical inputs, identical verdicts', () => {
    const log = buildLog();
    const first = verifyEvidenceChain(log.records());
    const second = verifyEvidenceChain(log.records());
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test('verify: an empty log-shaped list verifies as the empty intact prefix', () => {
    const verification = verifyEvidenceChain([]);
    expect(verification.verdict).toBe('VERIFIED');
    expect(verification.verifiedHeight).toBe(0);
    expect(verification.finalHash).toBe(GENESIS_PREDECESSOR_HASH);
  });
});

describe('tamper detection (A15 lines 36-37: "making tampering detectable")', () => {
  test('mutating a middle record\'s content is detected at that record', () => {
    const log = buildLog();
    const tampered = copyRecords(log.records());
    (tampered[2] as { outcome: { result: string } }).outcome.result = 'NOT_FINAL';
    const verification = verifyEvidenceChain(tampered);
    expect(verification.verdict).toBe('TAMPER_DETECTED');
    expect(verification.divergence?.sequenceNumber).toBe(2);
    expect(verification.divergence?.problem).toBe('RECORD_HASH_MISMATCH');
    expect(verification.verifiedHeight).toBe(2);
    expect(verification.finalHash).toBe(log.recordAt(1)?.proof.recordHash);
    // The detail string is deterministic.
    expect(verifyEvidenceChain(tampered).divergence?.detail).toBe(verification.divergence?.detail);
  });

  test('mutating a stored record hash is detected', () => {
    const log = buildLog();
    const tampered = copyRecords(log.records());
    (tampered[3] as { proof: { recordHash: string } }).proof.recordHash = '0'.repeat(64);
    const verification = verifyEvidenceChain(tampered);
    expect(verification.verdict).toBe('TAMPER_DETECTED');
    expect(verification.divergence?.sequenceNumber).toBe(3);
    expect(verification.divergence?.problem).toBe('RECORD_HASH_MISMATCH');
  });

  test('mutating a predecessor link is detected as a predecessor mismatch', () => {
    const log = buildLog();
    const tampered = copyRecords(log.records());
    (tampered[2] as { proof: { predecessorHash: string } }).proof.predecessorHash = 'f'.repeat(64);
    const verification = verifyEvidenceChain(tampered);
    expect(verification.verdict).toBe('TAMPER_DETECTED');
    expect(verification.divergence?.sequenceNumber).toBe(2);
    expect(verification.divergence?.problem).toBe('PREDECESSOR_HASH_MISMATCH');
  });

  test('mutating a record id is detected by re-derivation', () => {
    const log = buildLog();
    const tampered = copyRecords(log.records());
    (tampered[1] as { proof: { recordId: string } }).proof.recordId = 'pid.v1.' + 'a'.repeat(64);
    const verification = verifyEvidenceChain(tampered);
    expect(verification.verdict).toBe('TAMPER_DETECTED');
    expect(verification.divergence?.sequenceNumber).toBe(1);
    expect(verification.divergence?.problem).toBe('RECORD_ID_MISMATCH');
  });

  test('mutating a sequence number (resequencing) is detected', () => {
    const log = buildLog();
    const tampered = copyRecords(log.records());
    (tampered[2] as { proof: { sequenceNumber: number } }).proof.sequenceNumber = 7;
    const verification = verifyEvidenceChain(tampered);
    expect(verification.verdict).toBe('TAMPER_DETECTED');
    expect(verification.divergence?.sequenceNumber).toBe(2);
    expect(verification.divergence?.problem).toBe('SEQUENCE_MISMATCH');
  });

  test('deleting an interior record is detected', () => {
    const log = buildLog();
    const tampered = copyRecords(log.records());
    tampered.splice(2, 1);
    const verification = verifyEvidenceChain(tampered);
    expect(verification.verdict).toBe('TAMPER_DETECTED');
    // The record now at position 2 is the old record 3: its sequence number
    // and its predecessor link both diverge there.
    expect(verification.divergence?.sequenceNumber).toBe(2);
    expect(verification.verifiedHeight).toBe(2);
  });

  test('swapping two records (reordering) is detected', () => {
    const log = buildLog();
    const tampered = copyRecords(log.records());
    const held = tampered[1];
    tampered[1] = tampered[2];
    tampered[2] = held;
    const verification = verifyEvidenceChain(tampered);
    expect(verification.verdict).toBe('TAMPER_DETECTED');
    expect(verification.verifiedHeight).toBe(1);
  });

  test('tampering the genesis record itself is detected at height 0', () => {
    const log = buildLog();
    const tampered = copyRecords(log.records());
    (tampered[0] as { outcome: { result: string } }).outcome.result = 'FAKE_GENESIS';
    const verification = verifyEvidenceChain(tampered);
    expect(verification.verdict).toBe('TAMPER_DETECTED');
    expect(verification.divergence?.sequenceNumber).toBe(0);
    expect(verification.verifiedHeight).toBe(0);
    expect(verification.finalHash).toBe(GENESIS_PREDECESSOR_HASH);
  });
});

describe('record hash computation (deterministic, position-bound)', () => {
  test('identical content at an identical position yields the identical hash', () => {
    const log = buildLog();
    const record = log.recordAt(1);
    expect(record !== undefined).toBe(true);
    const recomputed = computeRecordHash(record as EvidenceRecord, 1, log.recordAt(0)?.proof.recordHash as string);
    expect(recomputed).toBe(record?.proof.recordHash);
  });

  test('the same content at a different position hashes differently', () => {
    const log = buildLog();
    const record = log.recordAt(1) as EvidenceRecord;
    const atOne = computeRecordHash(record, 1, log.recordAt(0)?.proof.recordHash as string);
    const atTwo = computeRecordHash(record, 2, log.recordAt(0)?.proof.recordHash as string);
    expect(atOne).not.toBe(atTwo);
  });

  test('the chain format version is 1 and the divergence vocabulary is frozen and closed', () => {
    expect(EVIDENCE_CHAIN_FORMAT_VERSION).toBe(1);
    expect(EVIDENCE_VERIFICATION_REASON_CODES.length).toBe(4);
    expect(EVIDENCE_VERIFICATION_REASON_CODES).toContain('SEQUENCE_MISMATCH');
    expect(EVIDENCE_VERIFICATION_REASON_CODES).toContain('PREDECESSOR_HASH_MISMATCH');
    expect(EVIDENCE_VERIFICATION_REASON_CODES).toContain('RECORD_HASH_MISMATCH');
    expect(EVIDENCE_VERIFICATION_REASON_CODES).toContain('RECORD_ID_MISMATCH');
    expect(Object.isFrozen(EVIDENCE_VERIFICATION_REASON_CODES)).toBe(true);
  });
});

describe('verification lifecycle submissions (A15 lines 70-74)', () => {
  test('a VERIFIED run records verdict, verified height, and final hash', () => {
    const log = buildLog();
    const verification = verifyEvidenceChain(log.records());
    const submission = verificationLifecycleSubmission(verification, WALL + 99);
    expect(submission.authority).toBe('Evidence Authority');
    expect(submission.what.operationType).toBe('EVIDENCE_LOG_VERIFICATION');
    expect(submission.outcome.result).toBe('VERIFIED');
    expect(submission.proof.hashes).toEqual([verification.finalHash]);
    expect(submission.proof.sequenceNumbers).toEqual([verification.verifiedHeight]);
    expect(submission.when.sequence).toBe(verification.verifiedHeight);
  });

  test('a TAMPER_DETECTED run records the verdict with the divergence class as reason code', () => {
    const log = buildLog();
    const tampered = copyRecords(log.records());
    (tampered[2] as { outcome: { result: string } }).outcome.result = 'NOT_FINAL';
    const verification = verifyEvidenceChain(tampered);
    const submission = verificationLifecycleSubmission(verification, WALL + 99);
    expect(submission.outcome.result).toBe('TAMPER_DETECTED');
    expect(submission.outcome.reasonCode).toBe('RECORD_HASH_MISMATCH');
    expect(submission.proof.hashes).toEqual([verification.finalHash]);
    expect(submission.proof.sequenceNumbers).toEqual([2, 2]);
    // The lifecycle submission is itself a valid, submittable record: the
    // TAMPER verdict is recordable as a fact without altering the log.
    const verdictLog = createEvidenceLog({ wallMs: WALL });
    expect(() => verdictLog.submit(submission)).not.toThrow();
    expect(verdictLog.recordAt(1)?.outcome.result).toBe('TAMPER_DETECTED');
  });

  test('the lifecycle submission is deterministic in (verification, wallMs)', () => {
    const log = buildLog();
    const verification = verifyEvidenceChain(log.records());
    expect(verificationLifecycleSubmission(verification, WALL + 1)).toEqual(
      verificationLifecycleSubmission(verification, WALL + 1),
    );
    expect(verificationLifecycleSubmission(verification, WALL + 2)).not.toEqual(
      verificationLifecycleSubmission(verification, WALL + 1),
    );
  });
});
