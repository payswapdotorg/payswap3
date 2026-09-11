/**
 * RTN-002 — repeated-run determinism test.
 *
 * Source of the tested contract: spec/architecture/v0.1/README.md §3 GC-1,
 * lines 41-43 — "Re-running any computation on identical inputs yields
 * identical outputs" — and evidence-risk-compliance.md §1 Area 15, lines
 * 54-55 (INV-15-3): "the hash chain verifies deterministically from
 * genesis; verification is a pure function of the log."
 *
 * Method (the kernel determinism suite's method applied to the evidence
 * domain): run the FULL evidence battery — log creation, multi-authority
 * submissions, duplicate no-ops, lifecycle verification runs, tamper
 * detection over a copied list, write-key/id derivation — TWICE inside one
 * test run, aggregate every output into a transcript, hash the transcript
 * with sha256, and assert the two runs are identical (both transcript
 * strings and digests). No clocks, no randomness: every wall time is fixed
 * by the battery itself.
 */
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { commitWithEvidence, createEvidenceLog, verificationLifecycleSubmission } from './log.ts';
import { verifyEvidenceChain } from './chain.ts';
import { canonicalSubmissionEncoding, evidenceRecordId, evidenceWriteKey } from './record.ts';
import { protocolTime } from '../kernel/time.ts';
import type { EvidenceRecord } from './record.ts';
import type { EvidenceSubmissionRecord } from '../kernel/ports.ts';

const WALL = 1_700_000_000_000;

/**
 * The battery: a fixed multi-authority scenario exercising every evidence
 * computation with an aggregateable output. Pure — any divergence between
 * two runs is a determinism defect.
 */
function runBattery(): string {
  const lines: string[] = [];
  const record = (label: string, value: unknown): void => {
    lines.push(`${label}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
  };

  const submissions: EvidenceSubmissionRecord[] = [
    {
      what: { operationType: 'INTENT_CREATED', subjectIds: ['intent-1'] },
      when: protocolTime(3, WALL + 1),
      authority: 'Intent Authority',
      outcome: { result: 'DRAFT', reasonCode: 'UNKNOWN' },
      proof: { sequenceNumbers: [3] },
    },
    {
      what: { operationType: 'COMMITMENT_RESERVED', subjectIds: ['commitment-1', 'intent-1'] },
      when: protocolTime(11, WALL + 2),
      authority: 'Capability Authority',
      outcome: { result: 'RESERVED' },
      proof: { hashes: ['claim-7'], priorRecordIds: [] },
    },
    {
      what: { operationType: 'SETTLEMENT_MARKED_FINAL', subjectIds: ['settlement-9'] },
      when: protocolTime(29, WALL + 3),
      authority: 'Settlement and Finality Authority',
      outcome: { result: 'FINAL' },
      proof: { hashes: ['stmt-1', 'stmt-2'], sequenceNumbers: [29, 30] },
    },
    {
      what: { operationType: 'RAIL_OPERATION_REPORTED', subjectIds: ['rail-op-4'] },
      when: protocolTime(31, WALL + 4),
      authority: 'Rail Authority',
      outcome: { result: 'UNKNOWN', reasonCode: 'UNKNOWN' },
      proof: { hashes: ['rail-ref-1'] },
    },
  ];

  // Derivation determinism (write keys / record ids / canonical encodings).
  for (const [index, submission] of submissions.entries()) {
    record(`key[${index}]`, evidenceWriteKey(submission));
    record(`rid[${index}]`, evidenceRecordId(submission));
    record(`enc[${index}]`, canonicalSubmissionEncoding(submission));
  }

  // Log construction: genesis, submissions, duplicates (no-ops), and
  // verification lifecycle runs.
  const log = createEvidenceLog({ wallMs: WALL });
  record('genesis', log.recordAt(0)?.proof);
  for (const submission of submissions) {
    log.submit(submission);
  }
  log.submit(submissions[1] as EvidenceSubmissionRecord); // duplicate -> no-op
  log.submit({
    ...submissions[2],
    what: { operationType: 'SETTLEMENT_MARKED_FINAL', subjectIds: [] },
  } as EvidenceSubmissionRecord); // different operation -> new record
  record('height', log.height);
  record('headHash', log.headHash);
  for (const logRecord of log.records()) {
    record(`record[${logRecord.proof.sequenceNumber}]`, logRecord);
  }
  const verificationOne = log.verifyAndRecord(WALL + 50);
  record('verify1', verificationOne);
  record('verifyRecord1', log.recordAt(log.height - 1));
  const verificationTwo = log.verifyAndRecord(WALL + 51);
  record('verify2', verificationTwo);

  // Pure verification over the log and over tampered copies.
  record('pureOk', verifyEvidenceChain(log.records()));
  const tampered: EvidenceRecord[] = log
    .records()
    .map((r) => JSON.parse(JSON.stringify(r)) as EvidenceRecord);
  (tampered[2] as { outcome: { result: string } }).outcome.result = 'TAMPERED';
  record('pureTamper', verifyEvidenceChain(tampered));
  (tampered as { splice(start: number, count: number): void }).splice(1, 1);
  record('pureDelete', verifyEvidenceChain(tampered));
  record('lifecycleTamper', verificationLifecycleSubmission(verificationTwo, WALL + 60));
  record('lifecycleOk', verificationLifecycleSubmission(verificationOne, WALL + 60));

  // Commit-coupling transcript.
  const committed = commitWithEvidence(
    log,
    () => ({ state: 'RESERVED' }),
    (result) => ({
      what: { operationType: 'COMMITMENT_RESERVED', subjectIds: ['commitment-9'] },
      when: protocolTime(41, WALL + 9),
      authority: 'Capability Authority',
      outcome: { result: result.state },
      proof: {},
    }),
  );
  record('committed', committed);
  record('finalHeight', log.height);

  return lines.join('\n');
}

describe('repeated-run determinism (GC-1; INV-15-3)', () => {
  test('two full battery runs in one test run are identical', () => {
    const runOne = runBattery();
    const runTwo = runBattery();
    expect(runTwo).toBe(runOne);
  });

  test('the aggregated battery transcript hashes identically across runs', () => {
    const digestOne = createHash('sha256').update(runBattery(), 'utf8').digest('hex');
    const digestTwo = createHash('sha256').update(runBattery(), 'utf8').digest('hex');
    expect(digestTwo).toBe(digestOne);
    expect(digestOne).toMatch(/^[0-9a-f]{64}$/);
  });

  test('the battery is non-trivial (covers every evidence computation family)', () => {
    const transcript = runBattery();
    expect(transcript.length).toBeGreaterThan(1000);
    expect(transcript).toContain('key[0]=');
    expect(transcript).toContain('rid[0]=');
    expect(transcript).toContain('enc[0]=');
    expect(transcript).toContain('genesis=');
    expect(transcript).toContain('record[3]');
    expect(transcript).toContain('verify1=');
    expect(transcript).toContain('pureTamper=');
    expect(transcript).toContain('pureDelete=');
    expect(transcript).toContain('committed=');
  });

  test('two logs built by the identical submission sequence are identical', () => {
    const build = (): string => {
      const log = createEvidenceLog({ wallMs: WALL });
      log.submit({
        what: { operationType: 'INTENT_CREATED', subjectIds: ['intent-1'] },
        when: protocolTime(3, WALL + 1),
        authority: 'Intent Authority',
        outcome: { result: 'DRAFT' },
        proof: { sequenceNumbers: [3] },
      });
      log.verifyAndRecord(WALL + 2);
      return JSON.stringify(log.records());
    };
    expect(build()).toBe(build());
  });
});
