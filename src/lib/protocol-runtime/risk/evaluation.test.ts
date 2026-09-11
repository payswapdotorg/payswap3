/**
 * RTN-003 — Determinism property tests for the pure compliance evaluation
 * (INV-16-1) and the subject-data hash.
 *
 * Source of the tested contract:
 *   spec/architecture/v0.1/evidence-risk-compliance.md §2 Area 16, lines
 *   124-128 — "INV-16-1 (determinism): evaluation is a pure function of
 *   (rule version, screening list version, subject data hash); identical
 *   inputs always produce the identical recorded outcome. INV-16-2 (no
 *   float risk): all threshold comparisons use integer Money or integer
 *   counts."; lines 98-113 (rule and screening semantics the evaluation
 *   composes); core.md §0 / GC-1 (README.md §3 lines 39-43 — "Re-running
 *   any computation on identical inputs yields identical outputs").
 *
 * Property generators are SEEDED integer LCGs (Lehmer / Park–Miller,
 * modulus 2^31-1, multiplier 48271) — the tests themselves are deterministic
 * and use no floats.
 */
import { describe, expect, test } from 'bun:test';
import { evaluateCompliance, evaluateComplianceCheck } from './evaluation.ts';
import { assembleRuleSet, authorRiskRule, publishRiskRuleVersion } from './rule.ts';
import type { RiskRuleRecord } from './rule.ts';
import { createScreeningList } from './screening.ts';
import { canonicalSubjectData, deriveSubjectDataHash, subjectComplianceData } from './subject.ts';
import type { SubjectComplianceData } from './subject.ts';
import { protocolTime } from '../kernel/time.ts';

const WHEN = protocolTime(10, 1_000);

function makeRng(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) {
    state += 2147483646;
  }
  return () => {
    state = (state * 48271) % 2147483647;
    return state;
  };
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY'] as const;
const OPERATORS = ['GT', 'GTE', 'LT', 'LTE', 'EQ'] as const;

function randomSubject(rng: () => number, index: number): SubjectComplianceData {
  const moneyFacts = [];
  for (const currency of CURRENCIES) {
    if (rng() % 2 === 0) {
      moneyFacts.push({ currency, amountMinor: rng() % 1_000_000 });
    }
  }
  const countFacts = [];
  for (let i = 0; i < rng() % 3; i += 1) {
    countFacts.push({ name: `count${i}`, count: rng() % 100 });
  }
  return subjectComplianceData({
    subjectId: `subject-${index}`,
    subjectKind: 'INTENT',
    moneyFacts,
    countFacts,
  });
}

function randomRule(rng: () => number, index: number): RiskRuleRecord {
  const isMoney = rng() % 2 === 0;
  const currency = CURRENCIES[rng() % CURRENCIES.length];
  const base = authorRiskRule(`rule-${index}`, {
    kind: 'THRESHOLD',
    fact: isMoney
      ? { factClass: 'MONEY', currency }
      : { factClass: 'COUNT', name: `count${rng() % 3}` },
    operator: OPERATORS[rng() % OPERATORS.length],
    bound: isMoney
      ? { boundClass: 'MONEY', currency, amountMinor: rng() % 1_000_000 }
      : { boundClass: 'COUNT', count: rng() % 100 },
    onBreach: rng() % 2 === 0 ? 'DENY' : 'REVIEW',
  });
  const published = publishRiskRuleVersion(base, index + 1);
  return published.ok ? published.rule : base;
}

describe('INV-16-1 determinism (property tests, seeded)', () => {
  test('identical inputs always produce the identical recorded evaluation', () => {
    const rng = makeRng(20260101);
    for (let round = 0; round < 200; round += 1) {
      const rules = [];
      const ruleCount = rng() % 4;
      for (let i = 0; i < ruleCount; i += 1) {
        rules.push(randomRule(rng, i));
      }
      const subject = randomSubject(rng, round);
      const digest = deriveSubjectDataHash(subject);
      const entries = rng() % 3 === 0 ? [digest] : [];
      const list = createScreeningList('sanctions', 1 + (rng() % 3), entries);
      const input = { rules, screeningList: list, subject, evaluatedAt: WHEN };

      const first = evaluateCompliance(input);
      const second = evaluateCompliance(input);
      const third = evaluateCompliance({
        rules: [...rules].reverse(),
        screeningList: createScreeningList(list.listId, list.version, [...list.entries].reverse()),
        subject: subjectComplianceData({
          subjectId: subject.subjectId,
          subjectKind: subject.subjectKind,
          moneyFacts: [...subject.moneyFacts].reverse(),
          countFacts: [...subject.countFacts].reverse(),
        }),
        evaluatedAt: protocolTime(WHEN.sequence + round, WHEN.wallMs + round),
      });

      expect(second).toEqual(first);
      // Input-order permutations and a different evaluation timestamp do
      // not change the recorded decision basis (the 'when' stamp excepted).
      expect(third.ruleSetVersion).toBe(first.ruleSetVersion);
      expect(third.outcome).toBe(first.outcome);
      expect(third.reasonCode).toBe(first.reasonCode);
      expect(third.firedRules).toEqual(first.firedRules);
      expect(third.screeningOutcome).toBe(first.screeningOutcome);
    }
  });

  test('the recorded outcome follows the input triple, not the call site', () => {
    const rng = makeRng(7);
    for (let round = 0; round < 100; round += 1) {
      const rules = [randomRule(rng, 0)];
      const subject = randomSubject(rng, round);
      const digest = deriveSubjectDataHash(subject);
      const withHit = createScreeningList('sanctions', 1, [digest]);
      const withoutHit = createScreeningList('sanctions', 1, []);

      const hit = evaluateComplianceCheck({ rules, screeningList: withHit, subject, evaluatedAt: WHEN });
      const miss = evaluateComplianceCheck({ rules, screeningList: withoutHit, subject, evaluatedAt: WHEN });
      const missV2 = evaluateComplianceCheck({
        rules,
        screeningList: createScreeningList('sanctions', 2, []),
        subject,
        evaluatedAt: WHEN,
      });

      // HIT handling: the hit check is review-required, always.
      expect(hit.__checkFlavor).toBe('REVIEW');
      expect(hit.evaluation.screeningOutcome).toBe('HIT');
      expect(hit.evaluation.reasonCode).toBe('SCREENING_HIT');

      // INV-16-4 keying: the check id depends only on (subject id, rule
      // set version) — not on the screening list version or content.
      expect(miss.checkId).toBe(hit.checkId);
      expect(missV2.checkId).toBe(hit.checkId);
      expect(miss.ruleSetVersion).toBe(hit.ruleSetVersion);

      // Deterministic flavor on the clear screening, per the fired rules.
      const denyFired = miss.evaluation.firedRules.some((fired) => fired.verdict === 'DENY');
      const reviewFired = miss.evaluation.firedRules.some((fired) => fired.verdict === 'REVIEW');
      expect(miss.__checkFlavor).toBe(denyFired || !reviewFired ? 'AUTO' : 'REVIEW');
    }
  });

  test('any difference in the subject data hash input changes the addressed evaluation', () => {
    const a = subjectComplianceData({
      subjectId: 's',
      subjectKind: 'INTENT',
      moneyFacts: [{ currency: 'USD', amountMinor: 100 }],
    });
    const b = subjectComplianceData({
      subjectId: 's',
      subjectKind: 'INTENT',
      moneyFacts: [{ currency: 'USD', amountMinor: 101 }],
    });
    expect(deriveSubjectDataHash(a)).not.toBe(deriveSubjectDataHash(b));
  });
});

describe('the subject data hash (canonical derivation)', () => {
  test('fact order does not affect the canonical encoding or the hash', () => {
    const one = subjectComplianceData({
      subjectId: 's',
      subjectKind: 'INTENT',
      moneyFacts: [
        { currency: 'USD', amountMinor: 1 },
        { currency: 'EUR', amountMinor: 2 },
      ],
      countFacts: [
        { name: 'a', count: 1 },
        { name: 'b', count: 2 },
      ],
    });
    const two = subjectComplianceData({
      subjectId: 's',
      subjectKind: 'INTENT',
      moneyFacts: [
        { currency: 'EUR', amountMinor: 2 },
        { currency: 'USD', amountMinor: 1 },
      ],
      countFacts: [
        { name: 'b', count: 2 },
        { name: 'a', count: 1 },
      ],
    });
    expect(canonicalSubjectData(one)).toBe(canonicalSubjectData(two));
    expect(deriveSubjectDataHash(one)).toBe(deriveSubjectDataHash(two));
  });

  test('kind and id participate in the hash', () => {
    const base = subjectComplianceData({ subjectId: 's', subjectKind: 'INTENT' });
    const otherKind = subjectComplianceData({ subjectId: 's', subjectKind: 'CAPABILITY_REGISTRATION' });
    const otherId = subjectComplianceData({ subjectId: 't', subjectKind: 'INTENT' });
    expect(deriveSubjectDataHash(base)).not.toBe(deriveSubjectDataHash(otherKind));
    expect(deriveSubjectDataHash(base)).not.toBe(deriveSubjectDataHash(otherId));
  });

  test('float facts are rejected at construction (INV-16-2)', () => {
    expect(() =>
      subjectComplianceData({
        subjectId: 's',
        subjectKind: 'INTENT',
        moneyFacts: [{ currency: 'USD', amountMinor: 1.5 }],
      }),
    ).toThrow(/INV-16-2/);
    expect(() =>
      subjectComplianceData({
        subjectId: 's',
        subjectKind: 'INTENT',
        countFacts: [{ name: 'v', count: 0.5 }],
      }),
    ).toThrow(/INV-16-2/);
    expect(() =>
      subjectComplianceData({ subjectId: '', subjectKind: 'INTENT' }),
    ).toThrow(/subjectId/);
    expect(() =>
      subjectComplianceData({ subjectId: 's', subjectKind: 'UNKNOWN' as never }),
    ).toThrow(/subjectKind/);
    expect(() =>
      subjectComplianceData({
        subjectId: 's',
        subjectKind: 'INTENT',
        moneyFacts: [
          { currency: 'USD', amountMinor: 1 },
          { currency: 'USD', amountMinor: 2 },
        ],
      }),
    ).toThrow(/duplicate/);
  });

  test('the hash carries the versioned format prefix', () => {
    expect(deriveSubjectDataHash(subjectComplianceData({ subjectId: 's', subjectKind: 'INTENT' }))).toMatch(
      /^sdh\.v1\.[0-9a-f]{64}$/,
    );
  });
});

describe('evaluation combination semantics (deterministic priority)', () => {
  function ruleWithBound(ruleId: string, boundMinor: number, onBreach: 'DENY' | 'REVIEW') {
    const drafted = authorRiskRule(ruleId, {
      kind: 'THRESHOLD',
      fact: { factClass: 'MONEY', currency: 'USD' },
      operator: 'GT',
      bound: { boundClass: 'MONEY', currency: 'USD', amountMinor: boundMinor },
      onBreach,
    });
    const published = publishRiskRuleVersion(drafted, 1);
    return published.ok ? published.rule : drafted;
  }

  const subject = subjectComplianceData({
    subjectId: 's',
    subjectKind: 'INTENT',
    moneyFacts: [{ currency: 'USD', amountMinor: 500 }],
  });
  const digest = deriveSubjectDataHash(subject);
  const hitList = createScreeningList('sanctions', 1, [digest]);
  const clearList = createScreeningList('sanctions', 1, []);

  test('a screening HIT outranks rules: MANDATORY_REVIEW / SCREENING_HIT', () => {
    const evaluation = evaluateCompliance({
      rules: [ruleWithBound('limit-usd', 100, 'DENY')],
      screeningList: hitList,
      subject,
      evaluatedAt: WHEN,
    });
    expect(evaluation.outcome).toBe('MANDATORY_REVIEW');
    expect(evaluation.reasonCode).toBe('SCREENING_HIT');
    expect(evaluation.screeningOutcome).toBe('HIT');
    // The fired deny rule is still recorded as proof.
    expect(evaluation.firedRules).toEqual([{ ruleId: 'limit-usd', version: 1, verdict: 'DENY' }]);
  });

  test('a DENY firing with a clear screening: AUTO_DENY / RULE_BREACH', () => {
    const evaluation = evaluateCompliance({
      rules: [ruleWithBound('limit-usd', 100, 'DENY')],
      screeningList: clearList,
      subject,
      evaluatedAt: WHEN,
    });
    expect(evaluation.outcome).toBe('AUTO_DENY');
    expect(evaluation.reasonCode).toBe('RULE_BREACH');
  });

  test('a REVIEW firing without a deny: MANDATORY_REVIEW / RULE_REVIEW', () => {
    const evaluation = evaluateCompliance({
      rules: [ruleWithBound('limit-usd', 100, 'REVIEW')],
      screeningList: clearList,
      subject,
      evaluatedAt: WHEN,
    });
    expect(evaluation.outcome).toBe('MANDATORY_REVIEW');
    expect(evaluation.reasonCode).toBe('RULE_REVIEW');
  });

  test('nothing fired and clear screening: AUTO_APPROVE / NO_BREACH', () => {
    const evaluation = evaluateCompliance({
      rules: [ruleWithBound('limit-usd', 10_000, 'DENY')],
      screeningList: clearList,
      subject,
      evaluatedAt: WHEN,
    });
    expect(evaluation.outcome).toBe('AUTO_APPROVE');
    expect(evaluation.reasonCode).toBe('NO_BREACH');
    expect(evaluation.firedRules).toEqual([]);
  });

  test('fired rules are recorded in canonical (ruleId, version) order', () => {
    const rules = [
      ruleWithBound('zzz-last', 100, 'REVIEW'),
      ruleWithBound('limit-usd', 100, 'DENY'),
      ruleWithBound('aaa-first', 100, 'REVIEW'),
    ];
    const evaluation = evaluateCompliance({
      rules,
      screeningList: clearList,
      subject,
      evaluatedAt: WHEN,
    });
    expect(evaluation.firedRules.map((fired) => fired.ruleId)).toEqual([
      'aaa-first',
      'limit-usd',
      'zzz-last',
    ]);
    expect(assembleRuleSet(rules).rules.map((rule) => rule.ruleId)).toEqual([
      'aaa-first',
      'limit-usd',
      'zzz-last',
    ]);
  });
});
