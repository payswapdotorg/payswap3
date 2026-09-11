/**
 * RTN-005 — Compliance-gate integration tests: the Intent Authority wired
 * to the REAL RTN-003 gate interface (evaluateComplianceGate) with REAL
 * compliance checks built by RTN-003's own pure modules.
 *
 * Source of the tested contract:
 *   spec/architecture/v0.1/core.md §1 lines 84-85:
 *     "Depends on ... area 16 for compliance gating before AUTHORIZED."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §2 Area 16, lines
 *   129-131 (INV-16-3):
 *     "state transitions gated by compliance (intent AUTHORIZATION,
 *      capability ACTIVATION) cannot complete without a terminal APPROVED
 *      record for the subject."
 *   lines 140-141: "There is no UNKNOWN decision state: undecided checks
 *    block the gated transition until resolved."
 * Work order acceptance: "Compliance gate: no AUTHORIZED transition without
 * terminal APPROVED for the subject (integration with RTN-003)."
 */
import { describe, expect, test } from 'bun:test';
import { protocolTime } from '../kernel/time.ts';
import { money } from '../kernel/money.ts';
import { createEvidenceLog } from '../evidence/log.ts';
import { evaluateComplianceCheck } from '../risk/evaluation.ts';
import type { ComplianceCheckRecord } from '../risk/evaluation.ts';
import { decideComplianceCheck, recordComplianceReview, routeComplianceCheckForReview } from '../risk/check.ts';
import { authorRiskRule, publishRiskRuleVersion } from '../risk/rule.ts';
import { createScreeningList } from '../risk/screening.ts';
import { deriveSubjectDataHash, subjectComplianceData } from '../risk/subject.ts';
import { evaluateComplianceGate } from '../risk/gate.ts';
import { demandDescriptor } from './descriptor.ts';
import { IntentAuthority } from './authority.ts';
import type { IntentAuthorizationGate } from './authority.ts';

const WHEN = protocolTime(10, 1_000);
const LATER = protocolTime(11, 2_000);

function intentSubject(subjectId: string) {
  return subjectComplianceData({
    subjectId,
    subjectKind: 'INTENT',
    moneyFacts: [{ currency: 'EUR', amountMinor: 1_000 }],
  });
}

function evaluatedCheck(subjectId: string): ComplianceCheckRecord {
  return evaluateComplianceCheck({
    rules: [],
    screeningList: createScreeningList('sanctions', 1, []),
    subject: intentSubject(subjectId),
    evaluatedAt: WHEN,
  });
}

function approvedCheck(subjectId: string): ComplianceCheckRecord {
  return decideComplianceCheck(
    evaluatedCheck(subjectId) as Parameters<typeof decideComplianceCheck>[0],
    LATER,
  );
}

function deniedCheck(subjectId: string): ComplianceCheckRecord {
  // The RTN-003 gate-test pattern: a DENY-verdict rule that fires on the
  // subject's money facts (auto-decision is forbidden for screening hits).
  const drafted = authorRiskRule('limit-eur', {
    kind: 'THRESHOLD',
    fact: { factClass: 'MONEY', currency: 'EUR' },
    operator: 'GT',
    bound: { boundClass: 'MONEY', currency: 'EUR', amountMinor: 100 },
    onBreach: 'DENY',
  });
  const published = publishRiskRuleVersion(drafted, 1);
  return decideComplianceCheck(
    evaluateComplianceCheck({
      rules: [published.ok ? published.rule : drafted],
      screeningList: createScreeningList('sanctions', 1, []),
      subject: intentSubject(subjectId),
      evaluatedAt: WHEN,
    }) as Parameters<typeof decideComplianceCheck>[0],
    LATER,
  );
}

function undecidedCheck(subjectId: string): ComplianceCheckRecord {
  return evaluatedCheck(subjectId);
}

function manualReviewCheck(subjectId: string): ComplianceCheckRecord {
  // A screening HIT creates a MANDATORY_REVIEW evaluation; routing it to
  // MANUAL_REVIEW leaves it undecided (the RTN-003 pattern).
  const subject = subjectComplianceData({
    subjectId,
    subjectKind: 'INTENT',
    moneyFacts: [{ currency: 'EUR', amountMinor: 1_000 }],
  });
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

/** The gate port wiring the RTN-003 interface to the intent authority. */
function gateOver(
  checkFor: (subjectId: string) => ComplianceCheckRecord | undefined | readonly ComplianceCheckRecord[],
): IntentAuthorizationGate {
  return (subjectId: string) => {
    const checks = checkFor(subjectId);
    const list = Array.isArray(checks) ? checks : checks === undefined ? [] : [checks];
    return evaluateComplianceGate(list, 'intent.AUTHORIZATION', subjectId);
  };
}

function makeDescriptor(key: string) {
  return demandDescriptor({
    amount: money('EUR', 1_000, 2),
    source: { currency: 'EUR', geography: 'DE', account: 'acct-source' },
    destination: { currency: 'USD', geography: 'US', account: 'acct-destination' },
    constraints: {
      deadlineEpochMs: 60_000,
      allowedRails: ['rail-a'],
      costCeiling: money('USD', 500, 2),
    },
    idempotencyKey: key,
  });
}

function makeAuthority(gate: IntentAuthorizationGate): IntentAuthority {
  let wall = 1_000;
  return new IntentAuthority({
    evidence: createEvidenceLog({ wallMs: 1_000 }),
    gate,
    wallClock: () => {
      wall += 1;
      return wall;
    },
  });
}

describe('INV-16-3 — no AUTHORIZED without a terminal APPROVED record for the intent subject', () => {
  test('a terminal APPROVED check allows the authorization', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    let wall = 1_000;
    const authority = new IntentAuthority({
      evidence: log,
      gate: (subjectId) => evaluateComplianceGate([approvedCheck(subjectId)], 'intent.AUTHORIZATION', subjectId),
      wallClock: () => {
        wall += 1;
        return wall;
      },
    });
    const submission = await authority.submitIntent(makeDescriptor('idem-gate-ok'));
    const intentId = submission.ok ? submission.intent.intentId : '';
    const result = await authority.authorizeIntent(intentId, 'pid.v1.decision');
    expect(result.ok).toBe(true);
    expect(authority.getIntent(intentId)?.state).toBe('AUTHORIZED');
  });

  test('NO check at all blocks the authorization (NO_APPROVED_CHECK)', async () => {
    const authority = makeAuthority(gateOver(() => [] as readonly ComplianceCheckRecord[]));
    const submission = await authority.submitIntent(makeDescriptor('idem-gate-none'));
    const intentId = submission.ok ? submission.intent.intentId : '';
    const result = await authority.authorizeIntent(intentId, 'pid.v1.decision');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('COMPLIANCE_BLOCKED');
      expect(result.problem).toContain('NO_APPROVED_CHECK');
    }
    expect(authority.getIntent(intentId)?.state).toBe('DRAFT');
  });

  test('an undecided EVALUATED check blocks until resolved (CHECK_UNDECIDED)', async () => {
    const authority = makeAuthority(gateOver((subjectId) => undecidedCheck(subjectId)));
    const submission = await authority.submitIntent(makeDescriptor('idem-gate-undecided'));
    const intentId = submission.ok ? submission.intent.intentId : '';
    const result = await authority.authorizeIntent(intentId, 'pid.v1.decision');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('COMPLIANCE_BLOCKED');
      expect(result.problem).toContain('CHECK_UNDECIDED');
    }
  });

  test('an undecided MANUAL_REVIEW check blocks until resolved', async () => {
    const authority = makeAuthority(gateOver((subjectId) => manualReviewCheck(subjectId)));
    const submission = await authority.submitIntent(makeDescriptor('idem-gate-review'));
    const intentId = submission.ok ? submission.intent.intentId : '';
    expect((await authority.authorizeIntent(intentId, 'pid.v1.decision')).ok).toBe(false);
  });

  test('a DENIED check blocks (terminal negative — CHECK_DENIED)', async () => {
    const authority = makeAuthority(gateOver((subjectId) => deniedCheck(subjectId)));
    const submission = await authority.submitIntent(makeDescriptor('idem-gate-denied'));
    const intentId = submission.ok ? submission.intent.intentId : '';
    const result = await authority.authorizeIntent(intentId, 'pid.v1.decision');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('COMPLIANCE_BLOCKED');
      expect(result.problem).toContain('CHECK_DENIED');
    }
  });

  test('a blocked gate followed by review and APPROVAL then allows (the resolution path)', async () => {
    const reviewedFor = (subjectId: string) =>
      recordComplianceReview(
        manualReviewCheck(subjectId),
        { reviewerAuthority: 'Compliance Review Board', decision: 'APPROVED' as const, rationale: 'cleared' },
        protocolTime(12, 3_000),
      );
    const authority = makeAuthority(gateOver((subjectId) => reviewedFor(subjectId)));
    const submission = await authority.submitIntent(makeDescriptor('idem-gate-resolved'));
    const intentId = submission.ok ? submission.intent.intentId : '';
    expect((await authority.authorizeIntent(intentId, 'pid.v1.decision')).ok).toBe(true);
  });

  test('checks for a DIFFERENT subject id never authorize (subject matching via the real gate)', async () => {
    const authority = makeAuthority(gateOver(() => [approvedCheck('pid.v1.other-intent')] as readonly ComplianceCheckRecord[]));
    const submission = await authority.submitIntent(makeDescriptor('idem-gate-subject'));
    const intentId = submission.ok ? submission.intent.intentId : '';
    const result = await authority.authorizeIntent(intentId, 'pid.v1.decision');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem).toContain('NO_APPROVED_CHECK');
    }
  });

  test('a blocked authorization emits NO evidence record (nothing consequential happened)', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    let wall = 1_000;
    const authority = new IntentAuthority({
      evidence: log,
      gate: () => ({ allowed: false, gateKind: 'intent.AUTHORIZATION', subjectId: 'x', blockedBy: 'NO_APPROVED_CHECK' }),
      wallClock: () => {
        wall += 1;
        return wall;
      },
    });
    const submission = await authority.submitIntent(makeDescriptor('idem-gate-silent'));
    const intentId = submission.ok ? submission.intent.intentId : '';
    const before = log.height;
    await authority.authorizeIntent(intentId, 'pid.v1.decision');
    expect(log.height).toBe(before);
  });
});
