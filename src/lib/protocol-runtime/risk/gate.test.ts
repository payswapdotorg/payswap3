/**
 * RTN-003 — Compliance gate tests (INV-16-3), including the gating
 * negative test.
 *
 * Source of the tested contract:
 *   spec/architecture/v0.1/evidence-risk-compliance.md §2 Area 16, lines
 *   129-131 — "INV-16-3 (gating): state transitions gated by compliance
 *   (intent AUTHORIZATION, capability ACTIVATION) cannot complete without a
 *   terminal APPROVED record for the subject."; lines 140-141 — "There is
 *   no UNKNOWN decision state: undecided checks block the gated transition
 *   until resolved."; core.md §1 Area 1 lines 84-85 (intent gating before
 *   AUTHORIZED); core.md §3 Area 3 lines 207-208 (capability gating).
 *
 * Evidence produced: allowed exactly on a terminal APPROVED record for the
 * subject; the negative cases (no check, undecided EVALUATED, undecided
 * MANUAL_REVIEW, DENIED); subject-kind matching; the frozen gate-kind
 * vocabulary.
 */
import { describe, expect, test } from 'bun:test';
import { evaluateComplianceCheck } from './evaluation.ts';
import type { ComplianceCheckRecord } from './evaluation.ts';
import { authorRiskRule, publishRiskRuleVersion } from './rule.ts';
import { createScreeningList } from './screening.ts';
import { deriveSubjectDataHash, subjectComplianceData } from './subject.ts';
import { protocolTime } from '../kernel/time.ts';
import {
  GATED_TRANSITION_KINDS,
  evaluateComplianceGate,
  isGatedTransitionKind,
} from './gate.ts';
import { decideComplianceCheck, recordComplianceReview, routeComplianceCheckForReview } from './check.ts';

const WHEN = protocolTime(10, 1_000);
const LATER = protocolTime(11, 2_000);

const INTENT_SUBJECT = subjectComplianceData({
  subjectId: 'intent-1',
  subjectKind: 'INTENT',
  moneyFacts: [{ currency: 'USD', amountMinor: 5_000 }],
});
const INTENT_HASH = deriveSubjectDataHash(INTENT_SUBJECT);

const CAPABILITY_SUBJECT = subjectComplianceData({
  subjectId: 'cap-1',
  subjectKind: 'CAPABILITY_REGISTRATION',
  countFacts: [{ name: 'rails', count: 3 }],
});
const CAPABILITY_HASH = deriveSubjectDataHash(CAPABILITY_SUBJECT);

const MERCHANT_SUBJECT = subjectComplianceData({
  subjectId: 'merchant-1',
  subjectKind: 'MERCHANT_ONBOARDING',
});

function evaluatedCheckFor(subject = INTENT_SUBJECT): ComplianceCheckRecord {
  return evaluateComplianceCheck({
    rules: [],
    screeningList: createScreeningList('sanctions', 1, []),
    subject,
    evaluatedAt: WHEN,
  });
}

function approvedCheck(subject = INTENT_SUBJECT): ComplianceCheckRecord {
  return decideComplianceCheck(
    evaluateComplianceCheck({
      rules: [],
      screeningList: createScreeningList('sanctions', 1, []),
      subject,
      evaluatedAt: WHEN,
    }) as Parameters<typeof decideComplianceCheck>[0],
    LATER,
  );
}

function deniedCheck(subject = INTENT_SUBJECT): ComplianceCheckRecord {
  const drafted = authorRiskRule('limit-usd', {
    kind: 'THRESHOLD',
    fact: { factClass: 'MONEY', currency: 'USD' },
    operator: 'GT',
    bound: { boundClass: 'MONEY', currency: 'USD', amountMinor: 100 },
    onBreach: 'DENY',
  });
  const published = publishRiskRuleVersion(drafted, 1);
  return decideComplianceCheck(
    evaluateComplianceCheck({
      rules: [published.ok ? published.rule : drafted],
      screeningList: createScreeningList('sanctions', 1, []),
      subject,
      evaluatedAt: WHEN,
    }) as Parameters<typeof decideComplianceCheck>[0],
    LATER,
  );
}

function manualReviewCheck(subject = INTENT_SUBJECT): ComplianceCheckRecord {
  return routeComplianceCheckForReview(
    evaluateComplianceCheck({
      rules: [],
      screeningList: createScreeningList('sanctions', 1, [deriveSubjectDataHash(subject)]),
      subject,
      evaluatedAt: WHEN,
    }) as Parameters<typeof routeComplianceCheckForReview>[0],
    LATER,
  );
}

function reviewedCheck(
  decision: 'APPROVED' | 'DENIED',
  subject = INTENT_SUBJECT,
): ComplianceCheckRecord {
  return recordComplianceReview(
    manualReviewCheck(subject),
    { reviewerAuthority: 'Compliance Review Board', decision, rationale: 'review rationale' },
    protocolTime(12, 3_000),
  );
}

describe('INV-16-3 gating: allowed exactly on a terminal APPROVED record', () => {
  test('an auto-decided APPROVED check allows the gated transition', () => {
    const verdict = evaluateComplianceGate([approvedCheck()], 'intent.AUTHORIZATION', 'intent-1');
    expect(verdict.allowed).toBe(true);
    if (verdict.allowed) {
      expect(verdict.checkId).toBe(approvedCheck().checkId);
    }
  });

  test('a REVIEWED APPROVED check (after MANUAL_REVIEW) allows it too', () => {
    const reviewed = reviewedCheck('APPROVED');
    const verdict = evaluateComplianceGate([reviewed], 'intent.AUTHORIZATION', 'intent-1');
    expect(verdict.allowed).toBe(true);
  });

  test('the capability ACTIVATION gate allows on an approved capability check', () => {
    const verdict = evaluateComplianceGate(
      [approvedCheck(CAPABILITY_SUBJECT)],
      'capability.ACTIVATION',
      'cap-1',
    );
    expect(verdict.allowed).toBe(true);
  });
});

describe('INV-16-3 gating NEGATIVE: every non-APPROVED configuration blocks', () => {
  test('no check at all blocks (absence is not approval)', () => {
    const verdict = evaluateComplianceGate([], 'intent.AUTHORIZATION', 'intent-1');
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.blockedBy).toBe('NO_APPROVED_CHECK');
      expect(verdict.checkId).toBe(undefined);
    }
  });

  test('an undecided EVALUATED check blocks the gated transition', () => {
    const verdict = evaluateComplianceGate([evaluatedCheckFor()], 'intent.AUTHORIZATION', 'intent-1');
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.blockedBy).toBe('CHECK_UNDECIDED');
      expect(verdict.checkId).toBe(evaluatedCheckFor().checkId);
    }
  });

  test('an undecided MANUAL_REVIEW check blocks until resolved', () => {
    const verdict = evaluateComplianceGate([manualReviewCheck()], 'intent.AUTHORIZATION', 'intent-1');
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.blockedBy).toBe('CHECK_UNDECIDED');
    }
  });

  test('a DENIED check blocks (terminal negative)', () => {
    const verdict = evaluateComplianceGate([deniedCheck()], 'intent.AUTHORIZATION', 'intent-1');
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.blockedBy).toBe('CHECK_DENIED');
    }
  });

  test('a DENIED check outranks an undecided one in the reported reason (deterministic priority)', () => {
    const verdict = evaluateComplianceGate(
      [evaluatedCheckFor(), deniedCheck()],
      'intent.AUTHORIZATION',
      'intent-1',
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.blockedBy).toBe('CHECK_DENIED');
    }
  });

  test('a blocked gate followed by review and approval then allows (resolution path)', () => {
    const before = evaluateComplianceGate([manualReviewCheck()], 'intent.AUTHORIZATION', 'intent-1');
    expect(before.allowed).toBe(false);
    const after = evaluateComplianceGate([reviewedCheck('APPROVED')], 'intent.AUTHORIZATION', 'intent-1');
    expect(after.allowed).toBe(true);
  });
});

describe('gate subject-kind matching (a check authorizes its own kind of gate)', () => {
  test('an INTENT check does not authorize the capability ACTIVATION gate', () => {
    const verdict = evaluateComplianceGate(
      [approvedCheck(INTENT_SUBJECT)],
      'capability.ACTIVATION',
      'intent-1',
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.blockedBy).toBe('NO_APPROVED_CHECK');
    }
  });

  test('a CAPABILITY_REGISTRATION check does not authorize the intent AUTHORIZATION gate', () => {
    const verdict = evaluateComplianceGate(
      [approvedCheck(CAPABILITY_SUBJECT)],
      'intent.AUTHORIZATION',
      'cap-1',
    );
    expect(verdict.allowed).toBe(false);
  });

  test('a MERCHANT_ONBOARDING check authorizes neither named gate kind', () => {
    const merchant = approvedCheck(MERCHANT_SUBJECT);
    expect(evaluateComplianceGate([merchant], 'intent.AUTHORIZATION', 'merchant-1').allowed).toBe(false);
    expect(evaluateComplianceGate([merchant], 'capability.ACTIVATION', 'merchant-1').allowed).toBe(false);
  });

  test('checks for a different subject id never authorize', () => {
    const verdict = evaluateComplianceGate(
      [approvedCheck(INTENT_SUBJECT)],
      'intent.AUTHORIZATION',
      'intent-other',
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.blockedBy).toBe('NO_APPROVED_CHECK');
    }
  });
});

describe('gate-kind vocabulary (exactly the two INV-16-3 names)', () => {
  test('the frozen list is exactly intent.AUTHORIZATION and capability.ACTIVATION', () => {
    expect([...GATED_TRANSITION_KINDS]).toEqual(['intent.AUTHORIZATION', 'capability.ACTIVATION']);
  });

  test('isGatedTransitionKind accepts exactly the two kinds; others rejected at the API', () => {
    expect(isGatedTransitionKind('intent.AUTHORIZATION')).toBe(true);
    expect(isGatedTransitionKind('capability.ACTIVATION')).toBe(true);
    expect(isGatedTransitionKind('merchant.ONBOARDING')).toBe(false);
    expect(isGatedTransitionKind(null)).toBe(false);
    expect(() => evaluateComplianceGate([], 'merchant.ONBOARDING' as never, 'x')).toThrow(/gateKind/);
    expect(() => evaluateComplianceGate([], 'intent.AUTHORIZATION', '')).toThrow(/subjectId/);
  });
});
