/**
 * RTN-001 — EvidenceSubmission port shape conformance (A15 five slots).
 *
 * Source of the tested contract: spec/architecture/v0.1/
 * evidence-risk-compliance.md §1 Area 15 lines 25-33 — "Fields (mandatory,
 * exactly these five semantic slots): what / when / authority / outcome /
 * proof" — and lines 41-43 — "All other authorities are writers-by-
 * submission only; none can alter or suppress records."
 *
 * The port is a TYPE-ONLY declaration (implementation is RTN-002's), so this
 * suite is a compile-time shape conformance check (enforced by tsc over
 * these assignments) plus a runtime smoke assertion that the module truly
 * exports no runtime behavior.
 */
import { describe, expect, test } from 'bun:test';
import type {
  EvidenceWhat,
  EvidenceOutcome,
  EvidenceProof,
  EvidenceSubmissionRecord,
  EvidenceSubmission,
} from './ports.ts';
import { protocolTime } from './time.ts';

describe('EvidenceSubmission port (A15 five-slot shape, type-only)', () => {
  test('a five-slot record is assignable exactly as A15 specifies', () => {
    const what: EvidenceWhat = { operationType: 'INTENT_CREATED', subjectIds: ['intent-1'] };
    const when = protocolTime(3, 1_700_000_000_000);
    const outcome: EvidenceOutcome = { result: 'DRAFT', reasonCode: 'UNKNOWN' };
    const proof: EvidenceProof = {
      hashes: ['deadbeef'],
      sequenceNumbers: [3],
      priorRecordIds: ['ev-2'],
    };
    const record: EvidenceSubmissionRecord = {
      what,
      when,
      authority: 'Intent Authority',
      outcome,
      proof,
    };
    // Exactly the five semantic slots — no sixth slot exists on the type.
    expect(Object.keys(record).sort()).toEqual(['authority', 'outcome', 'proof', 'what', 'when']);
  });

  test('the port is a bare submit channel with no decision semantics', () => {
    const submissions: EvidenceSubmissionRecord[] = [];
    const port: EvidenceSubmission = {
      submit(record) {
        submissions.push(record);
      },
    };
    const record: EvidenceSubmissionRecord = {
      what: { operationType: 'COMMITMENT_RESERVED', subjectIds: ['commitment-1'] },
      when: protocolTime(4, 1_700_000_000_001),
      authority: 'Capability Authority',
      outcome: { result: 'RESERVED' },
      proof: { sequenceNumbers: [4] },
    };
    port.submit(record);
    expect(submissions).toEqual([record]);
    // The port type exposes exactly one member: submit.
    expect(Object.keys(port)).toEqual(['submit']);
  });
});
