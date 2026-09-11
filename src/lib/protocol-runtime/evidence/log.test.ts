/**
 * RTN-002 — EvidenceLog tests: the EvidenceSubmission port implementation,
 * duplicate-write no-ops, append-only negative tests, synchronous commit
 * coupling, and lifecycle event recording.
 *
 * Source of the tested contract: spec/architecture/v0.1/
 * evidence-risk-compliance.md §1 Area 15:
 *   lines 39-43 — "Evidence Authority (protocol layer, area 15) owns the log
 *    and record schema. All other authorities are writers-by-submission
 *    only; none can alter or suppress records."
 *   lines 51-53 (INV-15-2) — "the log is append-only; no record is modified
 *    or removed; corrections are new records that reference the corrected
 *    one."
 *   lines 56-58 (INV-15-4) — "evidence write keys derived from the subject
 *    operation id prevent duplicate records for one operation."
 *   lines 62-64 — "Evidence writing is internal and synchronous with the
 *    operation it records: an operation is not committed until its record
 *    is written. A failed write fails the operation. There is no UNKNOWN
 *    state in the log itself."
 *   lines 70-74 — lifecycle events recorded as records.
 */
import { describe, expect, test } from 'bun:test';
import { commitWithEvidence, createEvidenceLog, verificationLifecycleSubmission } from './log.ts';
import { verifyEvidenceChain } from './chain.ts';
import { EVIDENCE_LIFECYCLE_VOCABULARY } from './record.ts';
import { protocolTime } from '../kernel/time.ts';
import type { EvidenceSubmission, EvidenceSubmissionRecord } from '../kernel/ports.ts';

const WALL = 1_700_000_000_000;

function sampleSubmission(sequence: number, result = 'DRAFT'): EvidenceSubmissionRecord {
  return {
    what: { operationType: 'INTENT_CREATED', subjectIds: [`intent-${sequence}`] },
    when: protocolTime(sequence, WALL + sequence),
    authority: 'Intent Authority',
    outcome: { result },
    proof: { sequenceNumbers: [sequence] },
  };
}

describe('the EvidenceSubmission port implementation (A15 lines 39-43)', () => {
  test('an EvidenceLog structurally satisfies the kernel port: submit is its only write channel', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    const port: EvidenceSubmission = log;
    expect(typeof port.submit).toBe('function');
    port.submit(sampleSubmission(3));
    expect(log.height).toBe(2);
  });

  test('submit is synchronous: the record is written when submit returns (void)', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    const returned = log.submit(sampleSubmission(3));
    expect(returned).toBe(undefined);
    // The write is observable immediately — same tick, no awaiting.
    expect(log.height).toBe(2);
    expect(log.recordAt(1)?.what.operationType).toBe('INTENT_CREATED');
  });

  test('no submitter can alter or suppress records: submission is the only surface', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    log.submit(sampleSubmission(3));
    const firstRecord = log.recordAt(1);
    // A second authority submitting a DIFFERENT operation appends; it can
    // never touch the first authority's record.
    log.submit({
      what: { operationType: 'COMMITMENT_RESERVED', subjectIds: ['commitment-1'] },
      when: protocolTime(4, WALL + 4),
      authority: 'Capability Authority',
      outcome: { result: 'RESERVED' },
      proof: {},
    });
    expect(log.recordAt(1)).toEqual(firstRecord);
    expect(log.height).toBe(3);
  });
});

describe('duplicate writes are no-ops (INV-15-4)', () => {
  test('an exactly duplicated submission writes exactly one record', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    const submission = sampleSubmission(3);
    log.submit(submission);
    expect(log.height).toBe(2);
    log.submit(submission);
    log.submit(submission);
    expect(log.height).toBe(2);
    expect(verifyEvidenceChain(log.records()).verdict).toBe('VERIFIED');
  });

  test('the duplicate no-op does not fail the retry: it returns void silently', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    log.submit(sampleSubmission(3));
    expect(() => log.submit(sampleSubmission(3))).not.toThrow();
  });

  test('the same operation re-serialized (reordered material) is still one record', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    log.submit({
      what: { operationType: 'INTENT_CREATED', subjectIds: ['intent-1', 'intent-2'] },
      when: protocolTime(3, WALL + 3),
      authority: 'Intent Authority',
      outcome: { result: 'DRAFT' },
      proof: { hashes: ['a', 'b'], priorRecordIds: ['x', 'y'] },
    });
    log.submit({
      what: { operationType: 'INTENT_CREATED', subjectIds: ['intent-2', 'intent-1'] },
      when: protocolTime(3, WALL + 3),
      authority: 'Intent Authority',
      outcome: { result: 'DRAFT' },
      proof: { hashes: ['b', 'a'], priorRecordIds: ['y', 'x'] },
    });
    expect(log.height).toBe(2);
  });

  test('a different operation by the same authority is a distinct record', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    log.submit(sampleSubmission(3));
    log.submit(sampleSubmission(4));
    log.submit(sampleSubmission(3, 'ACTIVE'));
    expect(log.height).toBe(4);
  });

  test('the write key and record id of a written record re-derive from its own slots', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    log.submit(sampleSubmission(3));
    // verifyEvidenceChain re-derives ids and hashes internally; a healthy
    // log passes — the stored identity matches the derivable identity.
    expect(verifyEvidenceChain(log.records()).verdict).toBe('VERIFIED');
  });
});

describe('append-only negative tests (INV-15-2: mutation attempts unrepresentable)', () => {
  test('the log surface exposes no update, delete, clear, pop, or truncate member', () => {
    const log = createEvidenceLog({ wallMs: WALL }) as unknown as Record<string, unknown>;
    for (const forbidden of ['update', 'delete', 'remove', 'clear', 'pop', 'shift', 'splice', 'truncate', 'setRecords']) {
      expect(log[forbidden]).toBe(undefined);
    }
    const ownMethods = Object.keys(log).sort();
    expect(ownMethods).toEqual(['headHash', 'height', 'recordAt', 'recordById', 'records', 'submit', 'verifyAndRecord'].sort());
  });

  test('records are deep-frozen: field mutation throws and changes nothing', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    log.submit(sampleSubmission(3));
    const record = log.recordAt(1) as unknown as Record<string, unknown>;
    expect(() => {
      record.authority = 'Rail Authority';
    }).toThrow();
    const outcome = record.outcome as Record<string, unknown>;
    expect(() => {
      outcome.result = 'HACKED';
    }).toThrow();
    const proof = record.proof as Record<string, unknown>;
    expect(() => {
      proof.recordHash = '0'.repeat(64);
    }).toThrow();
    expect(log.recordAt(1)?.authority).toBe('Intent Authority');
    expect(log.recordAt(1)?.outcome.result).toBe('DRAFT');
    expect(verifyEvidenceChain(log.records()).verdict).toBe('VERIFIED');
  });

  test('the records() snapshot is frozen and never changes retroactively', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    log.submit(sampleSubmission(3));
    const snapshot = log.records();
    expect(() => {
      (snapshot as unknown as unknown[]).push(log.recordAt(0) as never);
    }).toThrow();
    const before = JSON.stringify(snapshot);
    log.submit(sampleSubmission(4));
    // The earlier snapshot is unchanged by later appends (copy-on-write).
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(snapshot.length).toBe(2);
    expect(log.height).toBe(3);
  });

  test('delete on a record field throws and does not remove the slot', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    log.submit(sampleSubmission(3));
    const record = log.recordAt(1) as unknown as Record<string, unknown>;
    expect(() => {
      delete record.outcome;
    }).toThrow();
    expect(Object.keys(record).sort()).toEqual(['authority', 'outcome', 'proof', 'what', 'when']);
    expect(log.height).toBe(2);
  });

  test('corrections are new records referencing the corrected one (INV-15-2)', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    log.submit(sampleSubmission(3));
    const correctedId = log.recordAt(1)?.proof.recordId as string;
    log.submit({
      what: { operationType: 'INTENT_CORRECTED', subjectIds: ['intent-3'] },
      when: protocolTime(5, WALL + 5),
      authority: 'Intent Authority',
      outcome: { result: 'CORRECTED' },
      proof: { priorRecordIds: [correctedId] },
    });
    expect(log.height).toBe(3);
    expect(log.recordAt(2)?.proof.priorRecordIds).toEqual([correctedId]);
    // The original record is still present and unmodified.
    expect(log.recordAt(1)?.outcome.result).toBe('DRAFT');
  });
});

describe('synchronous commit coupling (A15 lines 62-64)', () => {
  test('commitWithEvidence delivers the result only through a successful record write', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    let effect = 0;
    const committed = commitWithEvidence(
      log,
      () => {
        effect += 1;
        return { state: 'RESERVED' };
      },
      (result) => ({
        what: { operationType: 'COMMITMENT_RESERVED', subjectIds: ['commitment-1'] },
        when: protocolTime(9, WALL + 9),
        authority: 'Capability Authority',
        outcome: { result: result.state },
        proof: {},
      }),
    );
    expect(committed).toEqual({ state: 'RESERVED' });
    expect(effect).toBe(1);
    expect(log.height).toBe(2);
    expect(log.recordAt(1)?.outcome.result).toBe('RESERVED');
  });

  test('a failed write fails the operation: the result is never delivered', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    let delivered = false;
    let effect = 0;
    expect(() =>
      commitWithEvidence(
        log,
        () => {
          effect += 1;
          return 'would-be-committed';
        },
        () =>
          ({
            what: { operationType: 'X', subjectIds: ['x'] },
            when: protocolTime(1, WALL + 1),
            authority: 'Not A Registry Authority',
            outcome: { result: 'Y' },
            proof: {},
          }) as unknown as EvidenceSubmissionRecord,
      ),
    ).toThrow(/registry's owning authorities/);
    expect(delivered).toBe(false);
    expect(effect).toBe(1); // the operation ran...
    expect(log.height).toBe(1); // ...but its record was not written.
  });

  test('an operation that throws writes nothing and delivers nothing', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    expect(() =>
      commitWithEvidence(
        log,
        () => {
          throw new Error('operation failed before its effect');
        },
        () => sampleSubmission(3),
      ),
    ).toThrow(/operation failed/);
    expect(log.height).toBe(1);
  });

  test('a commit whose record write fails leaves no half-committed trace', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    const before = JSON.stringify(log.records());
    expect(() =>
      commitWithEvidence(
        log,
        () => 'result',
        () => ({ ...sampleSubmission(2), when: { sequence: -5, wallMs: 0 } } as unknown as EvidenceSubmissionRecord),
      ),
    ).toThrow();
    expect(JSON.stringify(log.records())).toBe(before);
  });
});

describe('log lifecycle events are recorded as records (A15 lines 70-74)', () => {
  test('creation writes the genesis record at sequence 0', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    expect(log.height).toBe(1);
    const genesis = log.recordAt(0);
    expect(genesis?.what.operationType).toBe(EVIDENCE_LIFECYCLE_VOCABULARY.genesisOperationType);
    expect(genesis?.what.subjectIds).toEqual([]);
    expect(genesis?.authority).toBe('Evidence Authority');
    expect(genesis?.outcome.result).toBe(EVIDENCE_LIFECYCLE_VOCABULARY.genesisResult);
    expect(genesis?.when.sequence).toBe(0);
    expect(genesis?.when.wallMs).toBe(WALL);
  });

  test('verifyAndRecord records the run with height and final hash, and returns the verdict', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    log.submit(sampleSubmission(3));
    log.submit(sampleSubmission(4));
    const heightBefore = log.height;
    const verification = log.verifyAndRecord(WALL + 99);
    expect(verification.verdict).toBe('VERIFIED');
    expect(verification.verifiedHeight).toBe(heightBefore);
    expect(log.height).toBe(heightBefore + 1);
    const record = log.recordAt(log.height - 1);
    expect(record?.what.operationType).toBe(EVIDENCE_LIFECYCLE_VOCABULARY.verificationOperationType);
    expect(record?.outcome.result).toBe(EVIDENCE_LIFECYCLE_VOCABULARY.verifiedResult);
    expect(record?.proof.hashes).toEqual([verification.finalHash]);
    expect(record?.proof.sequenceNumbers).toEqual([verification.verifiedHeight]);
    // The verification record is itself chained and verified.
    expect(verifyEvidenceChain(log.records()).verdict).toBe('VERIFIED');
  });

  test('every verification run is a new record (runs are distinct operations)', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    log.verifyAndRecord(WALL + 1);
    log.verifyAndRecord(WALL + 2);
    expect(log.height).toBe(3);
    const runs = log.records().filter(
      (record) => record.what.operationType === EVIDENCE_LIFECYCLE_VOCABULARY.verificationOperationType,
    );
    expect(runs.length).toBe(2);
  });

  test('a tamper verdict, once recorded through the lifecycle submission, stays recorded (append-only)', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    // The pure builder produces a TAMPER_DETECTED lifecycle record for a
    // divergence verdict; submitting it records the fact without altering
    // any existing record.
    const tamperSubmission = verificationLifecycleSubmission(
      {
        verdict: 'TAMPER_DETECTED',
        verifiedHeight: 1,
        finalHash: 'a'.repeat(64),
        divergence: { sequenceNumber: 1, problem: 'RECORD_HASH_MISMATCH', detail: 'record at sequence 1 stores hash ...' },
      },
      WALL + 5,
    );
    log.submit(tamperSubmission);
    const record = log.recordAt(1);
    expect(record?.outcome.result).toBe(EVIDENCE_LIFECYCLE_VOCABULARY.tamperDetectedResult);
    expect(record?.outcome.reasonCode).toBe('RECORD_HASH_MISMATCH');
    expect(log.height).toBe(2);
  });

  test('the log has no UNKNOWN state: outcomes are results, never a pending condition', () => {
    // A15 line 64: "There is no UNKNOWN state in the log itself." A record
    // exists iff it was written; there is no pending record type or member.
    const log = createEvidenceLog({ wallMs: WALL });
    const surface = log as unknown as Record<string, unknown>;
    expect(surface.pending).toBe(undefined);
    expect(surface.unknown).toBe(undefined);
    expect(log.recordAt(0) !== undefined).toBe(true);
    expect(log.recordAt(1)).toBe(undefined);
  });
});

describe('log-level invariants (total sequencing, head hash, lookups)', () => {
  test('height equals the record count; the head hash is the last record hash', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    log.submit(sampleSubmission(3));
    log.submit(sampleSubmission(4));
    expect(log.height).toBe(3);
    expect(log.headHash).toBe(log.recordAt(2)?.proof.recordHash);
    expect(log.headHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('recordAt and recordById resolve records; out-of-range lookups are undefined', () => {
    const log = createEvidenceLog({ wallMs: WALL });
    log.submit(sampleSubmission(3));
    expect(log.recordAt(0)?.what.operationType).toBe('EVIDENCE_LOG_GENESIS');
    expect(log.recordAt(1)?.what.operationType).toBe('INTENT_CREATED');
    expect(log.recordAt(2)).toBe(undefined);
    expect(log.recordAt(-1)).toBe(undefined);
    const recordId = log.recordAt(1)?.proof.recordId as string;
    expect(log.recordById(recordId)?.proof.sequenceNumber).toBe(1);
    expect(log.recordById('pid.v1.' + '0'.repeat(64))).toBe(undefined);
  });

  test('identical creation options yield identical genesis records and head hashes', () => {
    const logA = createEvidenceLog({ wallMs: WALL });
    const logB = createEvidenceLog({ wallMs: WALL });
    expect(logB.headHash).toBe(logA.headHash);
    expect(JSON.stringify(logB.records())).toBe(JSON.stringify(logA.records()));
    const logC = createEvidenceLog({ wallMs: WALL + 1 });
    expect(logC.headHash).not.toBe(logA.headHash);
  });
});
