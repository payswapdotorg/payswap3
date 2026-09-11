/**
 * RTN-003 — ComplianceCheck lifecycle conformance tests, including the
 * HIT -> MANUAL_REVIEW no-auto-decision requirement.
 *
 * Source of the tested contract:
 *   spec/architecture/v0.1/evidence-risk-compliance.md §2 Area 16, lines
 *   102-113 — "ComplianceCheck — one evaluation instance tied to a subject
 *   ... States: EVALUATED -> terminal(APPROVED | DENIED | MANUAL_REVIEW)
 *   -> after review: APPROVED | DENIED. MANUAL_REVIEW is a durable state; a
 *   reviewed decision is recorded with reviewer authority identity and
 *   reason." / "HIT creates a MANUAL_REVIEW ComplianceCheck; auto-decision
 *   is forbidden for hits."; lines 140-141 ("undecided checks block the
 *   gated transition until resolved").
 *
 * Evidence produced: every LEGAL transition (both per-instance flavors) and
 * every ILLEGAL transition rejected (the full 4x4 matrix on both flavors);
 * the typed facades' unrepresentability (@ts-expect-error, verified by
 * `tsc --noEmit`); reviewed decisions recording reviewer authority identity
 * and reason; MANUAL_REVIEW as a durable state.
 */
import { describe, expect, test } from 'bun:test';
import { COMPLIANCE_CHECK_STATES, evaluateComplianceCheck } from './evaluation.ts';
import type {
  AutoDecidableComplianceCheck,
  ComplianceCheckState,
  ReviewRequiredComplianceCheck,
} from './evaluation.ts';
import { authorRiskRule, publishRiskRuleVersion } from './rule.ts';
import { createScreeningList } from './screening.ts';
import { deriveSubjectDataHash, subjectComplianceData } from './subject.ts';
import { protocolTime } from '../kernel/time.ts';
import {
  COMPLIANCE_CHECK_TRANSITIONS,
  canTransitionComplianceCheck,
  decideComplianceCheck,
  isComplianceCheckState,
  isComplianceCheckUndecided,
  nextProtocolTimeAfter,
  recordComplianceReview,
  routeComplianceCheckForReview,
  transitionComplianceCheck,
} from './check.ts';

const WHEN = protocolTime(10, 1_000);
const LATER = protocolTime(11, 2_000);

const SUBJECT = subjectComplianceData({
  subjectId: 'intent-1',
  subjectKind: 'INTENT',
  moneyFacts: [{ currency: 'USD', amountMinor: 5_000 }],
});
const SUBJECT_HASH = deriveSubjectDataHash(SUBJECT);

function denyRule() {
  const drafted = authorRiskRule('limit-usd', {
    kind: 'THRESHOLD',
    fact: { factClass: 'MONEY', currency: 'USD' },
    operator: 'GT',
    bound: { boundClass: 'MONEY', currency: 'USD', amountMinor: 100 },
    onBreach: 'DENY',
  });
  const published = publishRiskRuleVersion(drafted, 1);
  return [published.ok ? published.rule : drafted];
}

function autoCheck(): AutoDecidableComplianceCheck {
  // Clean subject, clear list, no rules -> AUTO_APPROVE.
  return evaluateComplianceCheck({
    rules: [],
    screeningList: createScreeningList('sanctions', 1, []),
    subject: SUBJECT,
    evaluatedAt: WHEN,
  }) as AutoDecidableComplianceCheck;
}

function autoDenyCheck(): AutoDecidableComplianceCheck {
  return evaluateComplianceCheck({
    rules: denyRule(),
    screeningList: createScreeningList('sanctions', 1, []),
    subject: subjectComplianceData({
      subjectId: 'intent-2',
      subjectKind: 'INTENT',
      moneyFacts: [{ currency: 'USD', amountMinor: 50_000 }],
    }),
    evaluatedAt: WHEN,
  }) as AutoDecidableComplianceCheck;
}

function hitCheck(): ReviewRequiredComplianceCheck {
  // The subject's data hash is on the screening list -> HIT -> review.
  return evaluateComplianceCheck({
    rules: denyRule(),
    screeningList: createScreeningList('sanctions', 1, [SUBJECT_HASH]),
    subject: SUBJECT,
    evaluatedAt: WHEN,
  }) as ReviewRequiredComplianceCheck;
}

function reviewRuleCheck(): ReviewRequiredComplianceCheck {
  // A REVIEW-verdict rule with a clear screening -> mandatory review.
  const drafted = authorRiskRule('watch-usd', {
    kind: 'THRESHOLD',
    fact: { factClass: 'MONEY', currency: 'USD' },
    operator: 'GT',
    bound: { boundClass: 'MONEY', currency: 'USD', amountMinor: 100 },
    onBreach: 'REVIEW',
  });
  const published = publishRiskRuleVersion(drafted, 1);
  return evaluateComplianceCheck({
    rules: [published.ok ? published.rule : drafted],
    screeningList: createScreeningList('sanctions', 1, []),
    subject: SUBJECT,
    evaluatedAt: WHEN,
  }) as ReviewRequiredComplianceCheck;
}

describe('ComplianceCheck state machine (conformance: every legal, every illegal)', () => {
  test('the abstract transition table matches the spec sentence exactly', () => {
    expect(COMPLIANCE_CHECK_TRANSITIONS.EVALUATED).toEqual(['APPROVED', 'DENIED', 'MANUAL_REVIEW']);
    expect(COMPLIANCE_CHECK_TRANSITIONS.MANUAL_REVIEW).toEqual(['APPROVED', 'DENIED']);
    expect(COMPLIANCE_CHECK_TRANSITIONS.APPROVED).toEqual([]);
    expect(COMPLIANCE_CHECK_TRANSITIONS.DENIED).toEqual([]);
  });

  test('every illegal pair is rejected by the predicate (full 4x4 matrix)', () => {
    const legal: string[] = [
      'EVALUATED>APPROVED',
      'EVALUATED>DENIED',
      'EVALUATED>MANUAL_REVIEW',
      'MANUAL_REVIEW>APPROVED',
      'MANUAL_REVIEW>DENIED',
    ];
    for (const from of COMPLIANCE_CHECK_STATES) {
      for (const to of COMPLIANCE_CHECK_STATES) {
        expect(canTransitionComplianceCheck(from, to)).toBe(legal.includes(`${from}>${to}`));
      }
    }
  });

  test('the full transition matrix over BOTH flavors (per-instance constraints)', () => {
    // AUTO flavor: EVALUATED -> its recorded decision only.
    const auto = autoCheck();
    for (const to of COMPLIANCE_CHECK_STATES) {
      const result = transitionComplianceCheck(auto, to, LATER);
      const expected = to === 'APPROVED'; // recorded outcome AUTO_APPROVE
      expect(result.ok).toBe(expected);
      if (!expected && !result.ok) {
        expect(result.problem).toMatch(/illegal|contradicts|deterministic decision/);
      }
    }
    const autoDeny = autoDenyCheck();
    for (const to of COMPLIANCE_CHECK_STATES) {
      expect(transitionComplianceCheck(autoDeny, to, LATER).ok).toBe(to === 'DENIED');
    }

    // REVIEW flavor (a screening HIT): auto-decision is FORBIDDEN — only
    // MANUAL_REVIEW is reachable from EVALUATED.
    const hit = hitCheck();
    for (const to of COMPLIANCE_CHECK_STATES) {
      const result = transitionComplianceCheck(hit, to, LATER);
      expect(result.ok).toBe(to === 'MANUAL_REVIEW');
      if ((to === 'APPROVED' || to === 'DENIED') && !result.ok) {
        expect(result.problem).toMatch(/auto-decision is forbidden/);
      }
    }
    // REVIEW flavor (a REVIEW-verdict rule): same shape.
    const reviewRule = reviewRuleCheck();
    for (const to of COMPLIANCE_CHECK_STATES) {
      expect(transitionComplianceCheck(reviewRule, to, LATER).ok).toBe(to === 'MANUAL_REVIEW');
    }
  });

  test('terminals are final on both flavors', () => {
    const approved = decideComplianceCheck(autoCheck(), LATER);
    for (const to of COMPLIANCE_CHECK_STATES) {
      expect(transitionComplianceCheck(approved, to, LATER).ok).toBe(false);
    }
    const denied = decideComplianceCheck(autoDenyCheck(), LATER);
    for (const to of COMPLIANCE_CHECK_STATES) {
      expect(transitionComplianceCheck(denied, to, LATER).ok).toBe(false);
    }
    const reviewed = recordComplianceReview(routeComplianceCheckForReview(hitCheck(), LATER), {
      reviewerAuthority: 'Reviewer Authority X',
      decision: 'APPROVED',
      rationale: 'verified post-review',
    }, protocolTime(12, 3_000));
    for (const to of COMPLIANCE_CHECK_STATES) {
      expect(transitionComplianceCheck(reviewed, to, protocolTime(13, 4_000)).ok).toBe(false);
    }
  });

  test('a check cannot be decided against its recorded outcome', () => {
    // AUTO_APPROVE recorded: deciding DENIED is rejected (determinism).
    const result = transitionComplianceCheck(autoCheck(), 'DENIED', LATER);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem).toMatch(/deterministic decision is APPROVED/);
    }
  });
});

describe('HIT handling: HIT creates a MANUAL_REVIEW check; no auto-decision', () => {
  test('a HIT evaluation mints a review-required check in EVALUATED', () => {
    const check = hitCheck();
    expect(check.state).toBe('EVALUATED');
    expect(check.__checkFlavor).toBe('REVIEW');
    expect(check.evaluation.reasonCode).toBe('SCREENING_HIT');
    expect(check.evaluation.screeningOutcome).toBe('HIT');
  });

  test('decideComplianceCheck on a review-required check is UNREPRESENTABLE (type) and rejected (runtime)', () => {
    const check = hitCheck();
    // Type level: the call does not typecheck — ReviewRequiredComplianceCheck
    // is not assignable to AutoDecidableComplianceCheck.
    // @ts-expect-error — auto-decision for hits is forbidden (A16 lines 112-113)
    expect(() => decideComplianceCheck(check, LATER)).toThrow(/forbidden|MANDATORY_REVIEW/);
  });

  test('routeComplianceCheckForReview on an auto-decidable check is UNREPRESENTABLE (type)', () => {
    const check = autoCheck();
    // @ts-expect-error — routing a clean check contradicts its recorded outcome
    expect(() => routeComplianceCheckForReview(check, LATER)).toThrow(/contradicts/);
  });

  test('the HIT check routes to MANUAL_REVIEW (the durable review state)', () => {
    const routed = routeComplianceCheckForReview(hitCheck(), LATER);
    expect(routed.state).toBe('MANUAL_REVIEW');
    expect(isComplianceCheckUndecided(routed)).toBe(true);
  });

  test('a REVIEW-verdict rule also routes to MANUAL_REVIEW', () => {
    expect(routeComplianceCheckForReview(reviewRuleCheck(), LATER).state).toBe('MANUAL_REVIEW');
  });
});

describe('reviewed decisions (after review: APPROVED | DENIED)', () => {
  test('a reviewed approval records reviewer authority identity and reason', () => {
    const routed = routeComplianceCheckForReview(hitCheck(), LATER);
    const reviewed = recordComplianceReview(routed, {
      reviewerAuthority: 'Compliance Review Board',
      decision: 'APPROVED',
      rationale: 'Verified against refreshed registry data.',
    }, protocolTime(12, 3_000));
    expect(reviewed.state).toBe('APPROVED');
    expect(reviewed.review?.reviewerAuthority).toBe('Compliance Review Board');
    expect(reviewed.review?.decision).toBe('APPROVED');
    expect(reviewed.review?.rationale).toBe('Verified against refreshed registry data.');
    expect(reviewed.review?.reviewedAt).toEqual(protocolTime(12, 3_000));
  });

  test('a reviewed denial records the reviewer decision and is terminal', () => {
    const routed = routeComplianceCheckForReview(reviewRuleCheck(), LATER);
    const reviewed = recordComplianceReview(routed, {
      reviewerAuthority: 'Compliance Review Board',
      decision: 'DENIED',
      rationale: 'Exposure limit breach confirmed.',
    }, protocolTime(12, 3_000));
    expect(reviewed.state).toBe('DENIED');
    expect(isComplianceCheckUndecided(reviewed)).toBe(false);
    expect(transitionComplianceCheck(reviewed, 'APPROVED', protocolTime(13, 4_000)).ok).toBe(false);
  });

  test('reviews are rejected without a reviewer authority identity or rationale', () => {
    const routed = routeComplianceCheckForReview(hitCheck(), LATER);
    expect(() =>
      recordComplianceReview(routed, { reviewerAuthority: '', decision: 'APPROVED', rationale: 'x' }, LATER),
    ).toThrow(/reviewer authority identity/);
    expect(() =>
      recordComplianceReview(routed, { reviewerAuthority: 'X', decision: 'APPROVED', rationale: '' }, LATER),
    ).toThrow(/rationale/);
  });

  test('the review decision must match the transition target (general machine)', () => {
    const routed = routeComplianceCheckForReview(hitCheck(), LATER);
    const mismatch = transitionComplianceCheck(routed, 'APPROVED', protocolTime(12, 3_000), {
      review: { reviewerAuthority: 'X', decision: 'DENIED', rationale: 'r', reviewedAt: protocolTime(12, 3_000) },
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.problem).toMatch(/review decision is DENIED/);
    }
  });

  test('reviewing a non-MANUAL_REVIEW state is rejected', () => {
    // An EVALUATED auto-decidable check cannot take a review record on its
    // auto-decision path, and a decided check is terminal.
    expect(() =>
      recordComplianceReview(autoCheck(), { reviewerAuthority: 'X', decision: 'APPROVED', rationale: 'r' }, LATER),
    ).toThrow(/auto-decision path|illegal ComplianceCheck transition/);
    const decided = decideComplianceCheck(autoCheck(), LATER);
    expect(() =>
      recordComplianceReview(decided, { reviewerAuthority: 'X', decision: 'APPROVED', rationale: 'r' }, LATER),
    ).toThrow(/illegal ComplianceCheck transition/);
  });
});

describe('undecided semantics and guards', () => {
  test('EVALUATED and MANUAL_REVIEW are undecided; terminals are decided', () => {
    expect(isComplianceCheckUndecided(autoCheck())).toBe(true);
    expect(isComplianceCheckUndecided(routeComplianceCheckForReview(hitCheck(), LATER))).toBe(true);
    expect(isComplianceCheckUndecided(decideComplianceCheck(autoCheck(), LATER))).toBe(false);
  });

  test('isComplianceCheckState accepts exactly the four states', () => {
    for (const state of COMPLIANCE_CHECK_STATES) {
      expect(isComplianceCheckState(state)).toBe(true);
    }
    expect(isComplianceCheckState('PENDING')).toBe(false);
    expect(isComplianceCheckState(null)).toBe(false);
  });

  test('nextProtocolTimeAfter is strictly monotonic in sequence', () => {
    const next = nextProtocolTimeAfter(WHEN, 9_999);
    expect(next.sequence).toBe(WHEN.sequence + 1);
    expect(next.wallMs).toBe(9_999);
  });

  test('deciding requires a well-formed protocol time', () => {
    expect(() => decideComplianceCheck(autoCheck(), { sequence: 1, wallMs: 1.5 } as never)).toThrow(
      /ProtocolTime/,
    );
  });
});
