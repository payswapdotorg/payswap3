/**
 * RTN-002 — EvidenceRecord schema conformance tests.
 *
 * Source of the tested contract: spec/architecture/v0.1/
 * evidence-risk-compliance.md §1 Area 15, lines 25-33 —
 *   "EvidenceRecord — one immutable record per consequential operation.
 *    Fields (mandatory, exactly these five semantic slots):
 *    - what: operation type and subject object ids.
 *    - when: protocol time (sequenced) and recorded wall time.
 *    - authority: which protocol authority performed the operation.
 *    - outcome: resulting state or decision, including reason codes.
 *    - proof: hashes, sequence numbers, and links to prior records
 *      required to verify the record.
 *    State: WRITTEN (terminal). Records are never updated or deleted."
 * and README.md §3 GC-5, lines 63-67.
 *
 * The field-by-field conformance below checks each A15 slot line against
 * the materialized record: exactly five keys, each slot's shape, the
 * authority vocabulary, and the validation rejections.
 */
import { describe, expect, test } from 'bun:test';
import {
  EVIDENCE_AUTHORITIES,
  EVIDENCE_AUTHORITY_NAME,
  EVIDENCE_LIFECYCLE_VOCABULARY,
  canonicalSubmissionEncoding,
  evidenceRecordId,
  evidenceWriteKey,
  isEvidenceRecord,
  validateEvidenceSubmission,
} from './record.ts';
import { canonicalJson } from './canonical.ts';
import { protocolTime } from '../kernel/time.ts';
import { isDerivedIdempotencyKey, isDerivedProtocolId } from '../kernel/identity.ts';
import { createEvidenceLog } from './log.ts';
import type { EvidenceSubmissionRecord } from '../kernel/ports.ts';

function sampleSubmission(): EvidenceSubmissionRecord {
  return {
    what: { operationType: 'INTENT_CREATED', subjectIds: ['intent-1', 'intent-2'] },
    when: protocolTime(3, 1_700_000_000_000),
    authority: 'Intent Authority',
    outcome: { result: 'DRAFT', reasonCode: 'UNKNOWN' },
    proof: { hashes: ['claim-1'], sequenceNumbers: [3], priorRecordIds: ['ev-0'] },
  };
}

describe('EvidenceRecord schema conformance (A15 lines 25-33, GC-5)', () => {
  test('a written record carries exactly the five mandatory semantic slots', () => {
    const log = createEvidenceLog({ wallMs: 1_700_000_000_000 });
    log.submit(sampleSubmission());
    const record = log.recordAt(1);
    expect(record !== undefined).toBe(true);
    // GC-5 / A15 line 26: "Fields (mandatory, exactly these five semantic slots)".
    expect(Object.keys(record as object).sort()).toEqual(['authority', 'outcome', 'proof', 'what', 'when']);
  });

  test('the what slot is operation type and subject object ids (A15 line 27)', () => {
    const log = createEvidenceLog({ wallMs: 1_700_000_000_000 });
    log.submit(sampleSubmission());
    const what = log.recordAt(1)?.what;
    expect(what !== undefined).toBe(true);
    expect(Object.keys(what as object).sort()).toEqual(['operationType', 'subjectIds']);
    expect((what as { operationType: string }).operationType).toBe('INTENT_CREATED');
    expect((what as unknown as { subjectIds: readonly string[] }).subjectIds).toEqual(['intent-1', 'intent-2']);
  });

  test('the when slot is protocol time (sequenced) and recorded wall time (A15 line 28)', () => {
    const log = createEvidenceLog({ wallMs: 1_700_000_000_000 });
    log.submit(sampleSubmission());
    const when = log.recordAt(1)?.when;
    expect(when !== undefined).toBe(true);
    expect(Object.keys(when as object).sort()).toEqual(['sequence', 'wallMs']);
    expect((when as { sequence: number }).sequence).toBe(3);
    expect((when as { wallMs: number }).wallMs).toBe(1_700_000_000_000);
  });

  test('the authority slot names the performing protocol authority (A15 line 29)', () => {
    const log = createEvidenceLog({ wallMs: 1_700_000_000_000 });
    log.submit(sampleSubmission());
    expect(log.recordAt(1)?.authority).toBe('Intent Authority');
  });

  test('the outcome slot carries result and reason code (A15 line 30)', () => {
    const log = createEvidenceLog({ wallMs: 1_700_000_000_000 });
    log.submit(sampleSubmission());
    const outcome = log.recordAt(1)?.outcome;
    expect(outcome !== undefined).toBe(true);
    expect(Object.keys(outcome as object).sort()).toEqual(['reasonCode', 'result']);
    expect((outcome as { result: string }).result).toBe('DRAFT');
    expect((outcome as { reasonCode: string }).reasonCode).toBe('UNKNOWN');
  });

  test('the proof slot carries submitter material plus the chain material (A15 lines 31-37)', () => {
    const log = createEvidenceLog({ wallMs: 1_700_000_000_000 });
    log.submit(sampleSubmission());
    const proof = log.recordAt(1)?.proof;
    expect(proof !== undefined).toBe(true);
    // A15 lines 31-32: "hashes, sequence numbers, and links to prior records
    // required to verify the record" (submitter material) ...
    expect((proof as unknown as { hashes: readonly string[] }).hashes).toEqual(['claim-1']);
    expect((proof as unknown as { sequenceNumbers: readonly number[] }).sequenceNumbers).toEqual([3]);
    expect((proof as unknown as { priorRecordIds: readonly string[] }).priorRecordIds).toEqual(['ev-0']);
    // ... plus A15 lines 35-37: the chain material ("totally sequenced",
    // "hash-chained", "Each record's proof includes the hash of its
    // predecessor").
    const chainProof = proof as {
      recordId: string;
      sequenceNumber: number;
      predecessorHash: string;
      recordHash: string;
    };
    expect(chainProof.sequenceNumber).toBe(1);
    expect(chainProof.predecessorHash).toBe(log.recordAt(0)?.proof.recordHash);
    expect(chainProof.recordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(chainProof.recordId).toMatch(/^pid\.v1\.[0-9a-f]{64}$/);
  });

  test('the WRITTEN state is terminal: the record exists only written, frozen (A15 line 33)', () => {
    const log = createEvidenceLog({ wallMs: 1_700_000_000_000 });
    log.submit(sampleSubmission());
    const record = log.recordAt(1) as unknown as Record<string, unknown>;
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.what)).toBe(true);
    expect(Object.isFrozen(record.proof)).toBe(true);
    // No state field exists — WRITTEN is materialized as existence (the
    // record type has no second state and no transition); see
    // CONTRACT-REVIEW interpretation decision.
    expect(Object.keys(record).sort()).toEqual(['authority', 'outcome', 'proof', 'what', 'when']);
  });

  test('isEvidenceRecord accepts written records and rejects foreign values', () => {
    const log = createEvidenceLog({ wallMs: 1_700_000_000_000 });
    log.submit(sampleSubmission());
    expect(isEvidenceRecord(log.recordAt(1))).toBe(true);
    expect(isEvidenceRecord(null)).toBe(false);
    expect(isEvidenceRecord(42)).toBe(false);
    expect(isEvidenceRecord(sampleSubmission())).toBe(false);
    const incomplete = { ...log.recordAt(1) } as unknown as Record<string, unknown>;
    delete incomplete.proof;
    expect(isEvidenceRecord(incomplete)).toBe(false);
  });
});

describe('authority-name validation (the registry contract, A15 line 29)', () => {
  test('the authority vocabulary is the registry owning-authority set, frozen', () => {
    expect(EVIDENCE_AUTHORITIES.length).toBe(23);
    expect(EVIDENCE_AUTHORITIES).toContain('Evidence Authority');
    expect(EVIDENCE_AUTHORITIES).toContain('Intent Authority');
    expect(EVIDENCE_AUTHORITIES).toContain('Settlement and Finality Authority');
    expect(EVIDENCE_AUTHORITIES).toContain('Rail Authority');
    expect(Object.isFrozen(EVIDENCE_AUTHORITIES)).toBe(true);
  });

  test('the Evidence Authority owns the log and its lifecycle records (A15 lines 39-43, 70-74)', () => {
    expect(EVIDENCE_AUTHORITY_NAME).toBe('Evidence Authority');
    const log = createEvidenceLog({ wallMs: 1_700_000_000_000 });
    expect(log.recordAt(0)?.authority).toBe('Evidence Authority');
    expect(log.recordAt(0)?.what.operationType).toBe(EVIDENCE_LIFECYCLE_VOCABULARY.genesisOperationType);
    const verification = log.verifyAndRecord(1_700_000_000_001);
    expect(verification.verdict).toBe('VERIFIED');
    expect(log.recordAt(1)?.authority).toBe('Evidence Authority');
    expect(log.recordAt(1)?.what.operationType).toBe(EVIDENCE_LIFECYCLE_VOCABULARY.verificationOperationType);
  });

  test('a submission from an authority outside the registry is a failed write', () => {
    const log = createEvidenceLog({ wallMs: 1_700_000_000_000 });
    const bogus = { ...sampleSubmission(), authority: 'Bogus Authority' };
    expect(() => log.submit(bogus)).toThrow(/registry's owning authorities/);
    expect(log.height).toBe(1);
  });
});

describe('submission validation (failed writes fail the operation, A15 lines 62-64)', () => {
  const cases: ReadonlyArray<[string, EvidenceSubmissionRecord]> = [
    ['missing slot', { ...sampleSubmission(), proof: undefined } as unknown as EvidenceSubmissionRecord],
    ['sixth slot', { ...sampleSubmission(), extra: 1 } as unknown as EvidenceSubmissionRecord],
    ['empty operation type', { ...sampleSubmission(), what: { operationType: '', subjectIds: ['x'] } }],
    ['non-string subject id', { ...sampleSubmission(), what: { operationType: 'X', subjectIds: ['x', 7] } as unknown as { operationType: string; subjectIds: string[] } }],
    ['malformed protocol time', { ...sampleSubmission(), when: { sequence: -1, wallMs: 0 } as unknown as EvidenceSubmissionRecord['when'] }],
    ['empty outcome result', { ...sampleSubmission(), outcome: { result: '' } }],
    ['extra outcome key', { ...sampleSubmission(), outcome: { result: 'X', detail: 'y' } as unknown as { result: string } }],
    ['extra proof key', { ...sampleSubmission(), proof: { signatures: ['s'] } as unknown as EvidenceSubmissionRecord['proof'] }],
    ['non-string hash claim', { ...sampleSubmission(), proof: { hashes: [1.5] } as unknown as EvidenceSubmissionRecord['proof'] }],
    ['float sequence number in proof', { ...sampleSubmission(), proof: { sequenceNumbers: [1.5] } }],
  ];
  for (const [name, submission] of cases) {
    test(`${name} is rejected deterministically with a TypeError`, () => {
      let firstThrown: unknown = 'no-throw';
      try {
        validateEvidenceSubmission(submission);
      } catch (error) {
        firstThrown = error;
      }
      expect(firstThrown instanceof TypeError).toBe(true);
      let secondThrown: unknown = 'no-throw';
      try {
        validateEvidenceSubmission(submission);
      } catch (error) {
        secondThrown = error;
      }
      expect(String(secondThrown)).toBe(String(firstThrown));
    });
  }

  test('the five-slot shape with all optional proof material validates', () => {
    expect(() => validateEvidenceSubmission(sampleSubmission())).not.toThrow();
    const minimal: EvidenceSubmissionRecord = {
      what: { operationType: 'X', subjectIds: [] },
      when: protocolTime(0, 0),
      authority: 'Evidence Authority',
      outcome: { result: 'OK' },
      proof: {},
    };
    expect(() => validateEvidenceSubmission(minimal)).not.toThrow();
  });

  test('non-JSON-representable material is rejected by the canonical encoder', () => {
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(() => canonicalJson(cyclic)).toThrow(/cyclic/);
    expect(() => canonicalJson({ a: () => 1 })).toThrow(/not JSON-representable/);
    expect(() => canonicalJson(1.5)).toThrow(/GC-1/);
    expect(() => canonicalJson(Symbol('x'))).toThrow(/not JSON-representable/);
  });
});

describe('INV-15-4 write keys (kernel identity route)', () => {
  test('write keys are kernel idempotency keys; record ids are kernel protocol ids', () => {
    const writeKey = evidenceWriteKey(sampleSubmission());
    expect(isDerivedIdempotencyKey(writeKey)).toBe(true);
    const recordId = evidenceRecordId(sampleSubmission());
    expect(isDerivedProtocolId(recordId)).toBe(true);
  });

  test('identical submissions derive identical keys; content differences derive different keys', () => {
    expect(evidenceWriteKey(sampleSubmission())).toBe(evidenceWriteKey(sampleSubmission()));
    expect(evidenceRecordId(sampleSubmission())).toBe(evidenceRecordId(sampleSubmission()));
    const altered: EvidenceSubmissionRecord = {
      ...sampleSubmission(),
      outcome: { result: 'ACTIVE' },
    };
    expect(evidenceWriteKey(altered)).not.toBe(evidenceWriteKey(sampleSubmission()));
    expect(evidenceRecordId(altered)).not.toBe(evidenceRecordId(sampleSubmission()));
  });

  test('write keys are order-insensitive over subject ids and proof material (the same operation re-serialized)', () => {
    const base: EvidenceSubmissionRecord = {
      what: { operationType: 'INTENT_CREATED', subjectIds: ['intent-1', 'intent-2'] },
      when: protocolTime(3, 1_700_000_000_000),
      authority: 'Intent Authority',
      outcome: { result: 'DRAFT', reasonCode: 'UNKNOWN' },
      proof: { hashes: ['claim-1', 'claim-2'], sequenceNumbers: [3, 7], priorRecordIds: ['ev-0', 'ev-2'] },
    };
    const reordered: EvidenceSubmissionRecord = {
      ...base,
      what: { operationType: 'INTENT_CREATED', subjectIds: ['intent-2', 'intent-1'] },
      proof: { hashes: ['claim-2', 'claim-1'], sequenceNumbers: [7, 3], priorRecordIds: ['ev-2', 'ev-0'] },
    };
    expect(evidenceWriteKey(reordered)).toBe(evidenceWriteKey(base));
    expect(evidenceRecordId(reordered)).toBe(evidenceRecordId(base));
  });

  test('the canonical submission encoding is deterministic and unambiguous', () => {
    const encoding = canonicalSubmissionEncoding(sampleSubmission());
    expect(canonicalSubmissionEncoding(sampleSubmission())).toBe(encoding);
    // Different wall time is a different operation occurrence (the operation's
    // protocol time is part of its identity).
    const otherTime: EvidenceSubmissionRecord = {
      ...sampleSubmission(),
      when: protocolTime(4, 1_700_000_000_000),
    };
    expect(canonicalSubmissionEncoding(otherTime)).not.toBe(encoding);
  });
});
