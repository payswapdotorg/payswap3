/**
 * RTN-003 — Evidence emission tests against the OWNED TEST DOUBLE of the
 * EvidenceSubmission port.
 *
 * Source of the tested contract:
 *   spec/architecture/v0.1/evidence-risk-compliance.md §2 Area 16, lines
 *   144-147 — "Evidence produced: CHECK_DECIDED (subject, rule set version,
 *   outcome, reason code). SCREENING_COMPUTED (list version, subject hash,
 *   outcome). REVIEW_RECORDED (reviewer authority, decision, rationale).";
 *   §1 Area 15 lines 26-32 (the exact five-slot record shape); lines 62-64
 *   ("an operation is not committed until its record is written. A failed
 *   write fails the operation."); GC-5 (README.md §3 lines 63-67).
 *   Wave evidence discipline (spec/protocol-runtime-work-orders/README.md
 *   line 39): the tests run against the in-surface test double; the
 *   real-log integration is RTN-012's.
 *
 * Evidence produced: the five-slot shape of every emitted record; the field
 * mapping of each of the three named record types; submission-order
 * recording; the failed-write failure propagation (synchronous coupling).
 */
import { describe, expect, test } from 'bun:test';
import { evaluateComplianceCheck } from './evaluation.ts';
import {
  RISK_AUTHORITY_ID,
  checkDecidedEvidence,
  reviewRecordedEvidence,
  screeningComputedEvidence,
  submitRiskEvidence,
} from './evidence.ts';
import { authorRiskRule, publishRiskRuleVersion } from './rule.ts';
import { computeScreeningResult, createScreeningList, resolveScreeningResult } from './screening.ts';
import { deriveSubjectDataHash, subjectComplianceData } from './subject.ts';
import { protocolTime } from '../kernel/time.ts';
import {
  EvidenceSubmissionTestDouble,
  assertEvidenceFiveSlotShape,
} from './test-double.ts';
import { decideComplianceCheck, recordComplianceReview, routeComplianceCheckForReview } from './check.ts';

const WHEN = protocolTime(10, 1_000);
const LATER = protocolTime(11, 2_000);

const SUBJECT = subjectComplianceData({
  subjectId: 'intent-1',
  subjectKind: 'INTENT',
  moneyFacts: [{ currency: 'USD', amountMinor: 5_000 }],
});
const SUBJECT_HASH = deriveSubjectDataHash(SUBJECT);
const CLEAR_LIST = createScreeningList('sanctions', 3, []);
const HIT_LIST = createScreeningList('sanctions', 3, [SUBJECT_HASH]);

function autoCheck() {
  return evaluateComplianceCheck({
    rules: [],
    screeningList: CLEAR_LIST,
    subject: SUBJECT,
    evaluatedAt: WHEN,
  });
}

function hitCheck() {
  return evaluateComplianceCheck({
    rules: [],
    screeningList: HIT_LIST,
    subject: SUBJECT,
    evaluatedAt: WHEN,
  });
}

describe('the five-slot shape (A15 lines 26-32: exactly these five)', () => {
  test('every emitted record carries exactly what/when/authority/outcome/proof', () => {
    const double = new EvidenceSubmissionTestDouble();
    const resolved = resolveScreeningResult(computeScreeningResult(CLEAR_LIST, SUBJECT_HASH), CLEAR_LIST);
    double.submit(screeningComputedEvidence(resolved, SUBJECT.subjectId, WHEN));
    double.submit(checkDecidedEvidence(decideComplianceCheck(autoCheck() as never, LATER), LATER));
    const reviewed = recordComplianceReview(
      routeComplianceCheckForReview(hitCheck() as never, LATER),
      { reviewerAuthority: 'Compliance Review Board', decision: 'APPROVED', rationale: 'verified' },
      protocolTime(12, 3_000),
    );
    double.submit(reviewRecordedEvidence(reviewed, protocolTime(12, 3_000)));
    expect(double.count).toBe(3);
    for (const entry of double.submissions) {
      // The double itself asserts the shape on every submit; this loop
      // would have thrown otherwise. Re-assert explicitly:
      expect(() => assertEvidenceFiveSlotShape(entry.record)).not.toThrow();
    }
  });

  test('malformed records are rejected by the shape assertion', () => {
    expect(() =>
      assertEvidenceFiveSlotShape({
        what: { operationType: 'X', subjectIds: [] },
        when: WHEN,
        authority: 'A',
        outcome: { result: 'R' },
        proof: {},
        extra: 'slot',
      } as never),
    ).toThrow(/exactly the five mandatory slots/);
    expect(() =>
      assertEvidenceFiveSlotShape({
        what: { operationType: 'X', subjectIds: [] },
        when: { sequence: 1, wallMs: 1.5 },
        authority: 'A',
        outcome: { result: 'R' },
        proof: {},
      } as never),
    ).toThrow(/when slot/);
    expect(() =>
      assertEvidenceFiveSlotShape({
        what: { operationType: '', subjectIds: [] },
        when: WHEN,
        authority: 'A',
        outcome: { result: 'R' },
        proof: {},
      } as never),
    ).toThrow(/what slot/);
  });
});

describe('CHECK_DECIDED (subject, rule set version, outcome, reason code)', () => {
  test('an auto approval emits the terminal decision with its reason code', () => {
    const decided = decideComplianceCheck(autoCheck() as never, LATER);
    const record = checkDecidedEvidence(decided, LATER);
    expect(record.what.operationType).toBe('CHECK_DECIDED');
    expect(record.what.subjectIds).toContain(decided.checkId);
    expect(record.what.subjectIds).toContain('intent-1');
    expect(record.what.subjectIds).toContain(decided.ruleSetVersion);
    expect(record.authority).toBe(RISK_AUTHORITY_ID);
    expect(record.outcome.result).toBe('APPROVED');
    expect(record.outcome.reasonCode).toBe('NO_BREACH');
    expect(record.proof.hashes).toContain(SUBJECT_HASH);
  });

  test('routing a HIT check emits outcome MANUAL_REVIEW with reason SCREENING_HIT', () => {
    const routed = routeComplianceCheckForReview(hitCheck() as never, LATER);
    const record = checkDecidedEvidence(routed, LATER);
    expect(record.outcome.result).toBe('MANUAL_REVIEW');
    expect(record.outcome.reasonCode).toBe('SCREENING_HIT');
  });

  test('an undecided (EVALUATED) check cannot emit CHECK_DECIDED', () => {
    expect(() => checkDecidedEvidence(autoCheck() as never, LATER)).toThrow(/undecided/);
  });

  test('the when slot carries the decision protocol time', () => {
    const record = checkDecidedEvidence(decideComplianceCheck(autoCheck() as never, LATER), LATER);
    expect(record.when).toEqual(LATER);
  });
});

describe('SCREENING_COMPUTED (list version, subject hash, outcome)', () => {
  test('a CLEAR screening emits list version, subject hash, and outcome', () => {
    const resolved = resolveScreeningResult(computeScreeningResult(CLEAR_LIST, SUBJECT_HASH), CLEAR_LIST);
    const record = screeningComputedEvidence(resolved, SUBJECT.subjectId, WHEN);
    expect(record.what.operationType).toBe('SCREENING_COMPUTED');
    expect(record.what.subjectIds).toContain('sanctions@v3');
    expect(record.authority).toBe(RISK_AUTHORITY_ID);
    expect(record.outcome.result).toBe('CLEAR');
    expect(record.proof.hashes).toEqual([SUBJECT_HASH]);
  });

  test('a HIT screening emits the outcome and the matched entry digest', () => {
    const resolved = resolveScreeningResult(computeScreeningResult(HIT_LIST, SUBJECT_HASH), HIT_LIST);
    const record = screeningComputedEvidence(resolved, SUBJECT.subjectId, WHEN);
    expect(record.outcome.result).toBe('HIT');
    expect(record.proof.hashes).toEqual([SUBJECT_HASH, SUBJECT_HASH]);
  });

  test('an unresolved (COMPUTED) screening cannot emit SCREENING_COMPUTED', () => {
    const computed = computeScreeningResult(CLEAR_LIST, SUBJECT_HASH);
    expect(() => screeningComputedEvidence(computed, SUBJECT.subjectId, WHEN)).toThrow(/unresolved/);
  });
});

describe('REVIEW_RECORDED (reviewer authority, decision, rationale)', () => {
  test('the reviewer authority rides the authority slot; decision and rationale the outcome', () => {
    const reviewed = recordComplianceReview(
      routeComplianceCheckForReview(hitCheck() as never, LATER),
      { reviewerAuthority: 'Compliance Review Board', decision: 'DENIED', rationale: 'sanction match upheld' },
      protocolTime(12, 3_000),
    );
    const record = reviewRecordedEvidence(reviewed, protocolTime(12, 3_000));
    expect(record.what.operationType).toBe('REVIEW_RECORDED');
    expect(record.authority).toBe('Compliance Review Board');
    expect(record.outcome.result).toBe('DENIED');
    expect(record.outcome.reasonCode).toBe('sanction match upheld');
    expect(record.what.subjectIds).toContain(reviewed.checkId);
    expect(record.proof.priorRecordIds).toEqual([reviewed.checkId]);
  });

  test('an unreviewed check cannot emit REVIEW_RECORDED', () => {
    expect(() => reviewRecordedEvidence(routeComplianceCheckForReview(hitCheck() as never, LATER), LATER)).toThrow(
      /reviewed decision/,
    );
  });
});

describe('synchronous coupling through the port (A15 lines 62-64)', () => {
  test('the double records submissions in order, with ordinals', () => {
    const double = new EvidenceSubmissionTestDouble();
    const resolved = resolveScreeningResult(computeScreeningResult(CLEAR_LIST, SUBJECT_HASH), CLEAR_LIST);
    double.submit(screeningComputedEvidence(resolved, SUBJECT.subjectId, WHEN));
    double.submit(checkDecidedEvidence(decideComplianceCheck(autoCheck() as never, LATER), LATER));
    expect(double.submissions.map((entry) => entry.ordinal)).toEqual([0, 1]);
    expect(double.byOperationType('CHECK_DECIDED').length).toBe(1);
    expect(double.byOperationType('SCREENING_COMPUTED').length).toBe(1);
    expect(double.byOperationType('REVIEW_RECORDED').length).toBe(0);
  });

  test('a failed write fails the operation: submitRiskEvidence propagates', async () => {
    const double = new EvidenceSubmissionTestDouble();
    double.failNextSubmissions(1);
    const resolved = resolveScreeningResult(computeScreeningResult(CLEAR_LIST, SUBJECT_HASH), CLEAR_LIST);
    const record = screeningComputedEvidence(resolved, SUBJECT.subjectId, WHEN);
    let threw = false;
    try {
      await submitRiskEvidence(double, record);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(double.count).toBe(0);
  });

  test('the failure count decrements: subsequent submissions succeed', async () => {
    const double = new EvidenceSubmissionTestDouble();
    double.failNextSubmissions(1);
    const resolved = resolveScreeningResult(computeScreeningResult(CLEAR_LIST, SUBJECT_HASH), CLEAR_LIST);
    const record = screeningComputedEvidence(resolved, SUBJECT.subjectId, WHEN);
    let firstThrew = false;
    try {
      await submitRiskEvidence(double, record);
    } catch {
      firstThrew = true;
    }
    expect(firstThrew).toBe(true);
    await submitRiskEvidence(double, record);
    expect(double.count).toBe(1);
  });
});
