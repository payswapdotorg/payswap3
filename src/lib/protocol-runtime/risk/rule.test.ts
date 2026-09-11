/**
 * RTN-003 — RiskRule lifecycle conformance tests.
 *
 * Source of the tested contract:
 *   spec/architecture/v0.1/evidence-risk-compliance.md §2 Area 16, lines
 *   98-100 — "RiskRule — versioned, immutable rule definition with an
 *   explicit evaluation function signature. States: AUTHORED -> VERSIONED
 *   -> ACTIVE -> RETIRED."; INV-16-1/INV-16-2 (lines 124-128).
 *
 * Evidence produced: every LEGAL transition exercised; every ILLEGAL
 * transition rejected (the full 4x4 pair matrix); definition immutability
 * after publish; integer-threshold discipline (INV-16-2); the pure rule
 * evaluation; rule-set-version derivation.
 */
import { describe, expect, test } from 'bun:test';
import {
  RISK_RULE_STATES,
  RISK_RULE_TRANSITIONS,
  activateRiskRule,
  assembleRuleSet,
  authorRiskRule,
  canTransitionRiskRule,
  deriveComplianceCheckId,
  deriveRuleSetVersion,
  evaluateRiskRule,
  isRiskRuleState,
  publishRiskRuleVersion,
  retireRiskRule,
  reviseRiskRuleDefinition,
  validateRiskRuleDefinition,
} from './rule.ts';

const DENY_RULE: Parameters<typeof authorRiskRule>[1] = {
  kind: 'THRESHOLD',
  fact: { factClass: 'MONEY', currency: 'USD' },
  operator: 'GT',
  bound: { boundClass: 'MONEY', currency: 'USD', amountMinor: 10_000 },
  onBreach: 'DENY',
};

function authored() {
  return authorRiskRule('velocity-usd', DENY_RULE);
}

describe('RiskRule state machine (conformance: every legal, every illegal)', () => {
  test('the transition table is exactly AUTHORED->VERSIONED->ACTIVE->RETIRED', () => {
    expect(RISK_RULE_TRANSITIONS.AUTHORED).toEqual(['VERSIONED']);
    expect(RISK_RULE_TRANSITIONS.VERSIONED).toEqual(['ACTIVE']);
    expect(RISK_RULE_TRANSITIONS.ACTIVE).toEqual(['RETIRED']);
    expect(RISK_RULE_TRANSITIONS.RETIRED).toEqual([]);
  });

  test('every legal transition succeeds end to end', () => {
    let rule = authored();
    expect(rule.state).toBe('AUTHORED');
    expect(rule.version).toBe(0);

    const published = publishRiskRuleVersion(rule, 1);
    expect(published.ok).toBe(true);
    rule = published.ok ? published.rule : rule;
    expect(rule.state).toBe('VERSIONED');
    expect(rule.version).toBe(1);

    const activated = activateRiskRule(rule);
    expect(activated.ok).toBe(true);
    rule = activated.ok ? activated.rule : rule;
    expect(rule.state).toBe('ACTIVE');

    const retired = retireRiskRule(rule);
    expect(retired.ok).toBe(true);
    rule = retired.ok ? retired.rule : rule;
    expect(rule.state).toBe('RETIRED');
  });

  test('every illegal pair is rejected by the predicate (full 4x4 matrix)', () => {
    const legal: string[] = ['AUTHORED>VERSIONED', 'VERSIONED>ACTIVE', 'ACTIVE>RETIRED'];
    for (const from of RISK_RULE_STATES) {
      for (const to of RISK_RULE_STATES) {
        const pair = `${from}>${to}`;
        expect(canTransitionRiskRule(from, to)).toBe(legal.includes(pair));
      }
    }
  });

  test('publishing is rejected from every non-AUTHORED state', () => {
    const published = publishRiskRuleVersion(authored(), 1);
    const versioned = published.ok ? published.rule : authored();
    expect(publishRiskRuleVersion(versioned, 2).ok).toBe(false);

    const activated = activateRiskRule(versioned);
    expect(publishRiskRuleVersion(activated.ok ? activated.rule : versioned, 2).ok).toBe(false);

    const retired = retireRiskRule(activated.ok ? activated.rule : versioned);
    expect(publishRiskRuleVersion(retired.ok ? retired.rule : versioned, 2).ok).toBe(false);
  });

  test('activating is rejected from every non-VERSIONED state', () => {
    expect(activateRiskRule(authored()).ok).toBe(false);
    const published = publishRiskRuleVersion(authored(), 1);
    const versioned = published.ok ? published.rule : authored();
    const active = activateRiskRule(versioned);
    expect(activateRiskRule(active.ok ? active.rule : versioned).ok).toBe(false);
    const retired = retireRiskRule(active.ok ? active.rule : versioned);
    expect(activateRiskRule(retired.ok ? retired.rule : versioned).ok).toBe(false);
  });

  test('retiring is rejected from every non-ACTIVE state', () => {
    expect(retireRiskRule(authored()).ok).toBe(false);
    const published = publishRiskRuleVersion(authored(), 1);
    expect(retireRiskRule(published.ok ? published.rule : authored()).ok).toBe(false);
  });

  test('RETIRED is terminal: no operation moves it', () => {
    const published = publishRiskRuleVersion(authored(), 1);
    const activated = activateRiskRule(published.ok ? published.rule : authored());
    const retired = retireRiskRule(activated.ok ? activated.rule : authored());
    const dead = retired.ok ? retired.rule : authored();
    expect(publishRiskRuleVersion(dead, 2).ok).toBe(false);
    expect(activateRiskRule(dead).ok).toBe(false);
    expect(retireRiskRule(dead).ok).toBe(false);
  });

  test('publish assigns the caller-provided integer version (>= 1)', () => {
    const published = publishRiskRuleVersion(authored(), 7);
    expect(published.ok ? published.rule.version : -1).toBe(7);
    expect(() => publishRiskRuleVersion(authored(), 0)).toThrow();
    expect(() => publishRiskRuleVersion(authored(), 1.5)).toThrow();
  });
});

describe('RiskRule definition immutability (immutable rule definitions)', () => {
  test('an AUTHORED draft can be revised', () => {
    const revised = reviseRiskRuleDefinition(authored(), {
      ...DENY_RULE,
      bound: { boundClass: 'MONEY', currency: 'USD', amountMinor: 5_000 },
    });
    expect(revised.ok).toBe(true);
    const revisedBound = revised.ok ? revised.rule.definition.bound : undefined;
    expect(
      revisedBound !== undefined && revisedBound.boundClass === 'MONEY' ? revisedBound.amountMinor : -1,
    ).toBe(5_000);
  });

  test('a VERSIONED (or later) definition cannot be revised', () => {
    const published = publishRiskRuleVersion(authored(), 1);
    const versioned = published.ok ? published.rule : authored();
    expect(reviseRiskRuleDefinition(versioned, DENY_RULE).ok).toBe(false);
    const active = activateRiskRule(versioned);
    expect(reviseRiskRuleDefinition(active.ok ? active.rule : versioned, DENY_RULE).ok).toBe(false);
  });
});

describe('RiskRule validation (INV-16-2: integer Money or integer counts)', () => {
  test('float bounds are rejected', () => {
    expect(() =>
      authorRiskRule('bad', {
        kind: 'THRESHOLD',
        fact: { factClass: 'MONEY', currency: 'USD' },
        operator: 'GT',
        bound: { boundClass: 'MONEY', currency: 'USD', amountMinor: 10.5 },
        onBreach: 'DENY',
      }),
    ).toThrow(/INV-16-2/);
    expect(() =>
      authorRiskRule('bad', {
        kind: 'THRESHOLD',
        fact: { factClass: 'COUNT', name: 'velocity' },
        operator: 'GTE',
        bound: { boundClass: 'COUNT', count: 3.14 },
        onBreach: 'REVIEW',
      }),
    ).toThrow(/INV-16-2/);
  });

  test('fact class and bound class must agree (MONEY<->MONEY same currency, COUNT<->COUNT)', () => {
    expect(() =>
      validateRiskRuleDefinition({
        kind: 'THRESHOLD',
        fact: { factClass: 'MONEY', currency: 'USD' },
        operator: 'GT',
        bound: { boundClass: 'COUNT', count: 10 },
        onBreach: 'DENY',
      }),
    ).toThrow(/MONEY bound/);
    expect(() =>
      validateRiskRuleDefinition({
        kind: 'THRESHOLD',
        fact: { factClass: 'MONEY', currency: 'USD' },
        operator: 'GT',
        bound: { boundClass: 'MONEY', currency: 'EUR', amountMinor: 10 },
        onBreach: 'DENY',
      }),
    ).toThrow(/must match fact currency/);
    expect(() =>
      validateRiskRuleDefinition({
        kind: 'THRESHOLD',
        fact: { factClass: 'COUNT', name: 'v' },
        operator: 'GT',
        bound: { boundClass: 'MONEY', currency: 'USD', amountMinor: 10 },
        onBreach: 'DENY',
      }),
    ).toThrow(/COUNT bound/);
  });

  test('malformed currencies and unknown operators/onBreach are rejected', () => {
    expect(() =>
      authorRiskRule('bad', {
        kind: 'THRESHOLD',
        fact: { factClass: 'MONEY', currency: 'usd' },
        operator: 'GT',
        bound: { boundClass: 'MONEY', currency: 'usd', amountMinor: 1 },
        onBreach: 'DENY',
      }),
    ).toThrow(/uppercase letters/);
    expect(() =>
      authorRiskRule('bad', { ...DENY_RULE, operator: 'APPROXIMATELY' as never }),
    ).toThrow(/operator/);
    expect(() =>
      authorRiskRule('bad', { ...DENY_RULE, onBreach: 'IGNORE' as never }),
    ).toThrow(/onBreach/);
  });
});

describe('the pure rule evaluation (explicit evaluation signature)', () => {
  const subject = {
    subjectId: 'intent-1',
    subjectKind: 'INTENT' as const,
    moneyFacts: [{ currency: 'USD', amountMinor: 15_000 }],
    countFacts: [{ name: 'velocity24h', count: 4 }],
  };

  test('an exceeded threshold fires with its onBreach verdict', () => {
    const published = publishRiskRuleVersion(authored(), 1);
    const rule = published.ok ? published.rule : authored();
    expect(evaluateRiskRule(rule, subject)).toBe('DENY');
  });

  test('a non-exceeded threshold does not fire', () => {
    const under = reviseRiskRuleDefinition(authored(), {
      ...DENY_RULE,
      bound: { boundClass: 'MONEY', currency: 'USD', amountMinor: 20_000 },
    });
    const rule = under.ok ? under.rule : authored();
    expect(evaluateRiskRule(rule, subject)).toBe('NOT_FIRED');
  });

  test('a rule referencing a fact the subject lacks does not fire', () => {
    const revised = reviseRiskRuleDefinition(authored(), {
      kind: 'THRESHOLD',
      fact: { factClass: 'COUNT', name: 'absent-fact' },
      operator: 'GT',
      bound: { boundClass: 'COUNT', count: 0 },
      onBreach: 'REVIEW',
    });
    expect(evaluateRiskRule(revised.ok ? revised.rule : authored(), subject)).toBe('NOT_FIRED');
  });

  test('integer comparisons are exact at every operator', () => {
    const cases: [Parameters<typeof authorRiskRule>[1]['operator'], number, boolean][] = [
      ['GT', 15_000, false],
      ['GTE', 15_000, true],
      ['LT', 15_000, false],
      ['LTE', 15_000, true],
      ['EQ', 15_000, true],
    ];
    for (const [operator, bound, shouldFire] of cases) {
      const revised = reviseRiskRuleDefinition(authored(), {
        ...DENY_RULE,
        operator,
        bound: { boundClass: 'MONEY', currency: 'USD', amountMinor: bound },
      });
      const rule = revised.ok ? revised.rule : authored();
      expect(evaluateRiskRule(rule, subject)).toBe(shouldFire ? 'DENY' : 'NOT_FIRED');
    }
  });
});

describe('rule set versions and check ids (INV-16-1 / INV-16-4 keying)', () => {
  function publishedRule(id: string, version: number, bound: number) {
    const revised = reviseRiskRuleDefinition(authorRiskRule(id, { ...DENY_RULE, bound: { boundClass: 'MONEY', currency: 'USD', amountMinor: bound } }), DENY_RULE);
    const published = publishRiskRuleVersion(revised.ok ? revised.rule : authorRiskRule(id, DENY_RULE), version);
    return published.ok ? published.rule : authorRiskRule(id, DENY_RULE);
  }

  test('identical member sets derive the identical rule set version; any difference differs', () => {
    const a = publishedRule('rule-a', 1, 100);
    const b = publishedRule('rule-b', 1, 200);
    expect(deriveRuleSetVersion([a, b])).toBe(deriveRuleSetVersion([b, a]));
    expect(deriveRuleSetVersion([a])).not.toBe(deriveRuleSetVersion([a, b]));
    const a2 = publishedRule('rule-a', 2, 100);
    expect(deriveRuleSetVersion([a])).not.toBe(deriveRuleSetVersion([a2]));
  });

  test('the derived rule set version carries the format prefix', () => {
    expect(deriveRuleSetVersion([])).toMatch(/^rsv\.v1\.[0-9a-f]{64}$/);
  });

  test('AUTHORED drafts cannot enter a rule set', () => {
    expect(() => deriveRuleSetVersion([authored()])).toThrow(/AUTHORED/);
    expect(() => assembleRuleSet([authored()])).toThrow(/AUTHORED/);
  });

  test('assembleRuleSet canonicalizes member order', () => {
    const a = publishedRule('rule-a', 1, 100);
    const b = publishedRule('rule-b', 1, 200);
    const set1 = assembleRuleSet([b, a]);
    const set2 = assembleRuleSet([a, b]);
    expect(set1.ruleSetVersion).toBe(set2.ruleSetVersion);
    expect(set1.rules[0]?.ruleId).toBe('rule-a');
    expect(set1.rules[1]?.ruleId).toBe('rule-b');
  });

  test('check ids are keyed by (subject id, rule set version) — INV-16-4', () => {
    const a = publishedRule('rule-a', 1, 100);
    const setA = assembleRuleSet([a]);
    const setB = assembleRuleSet([a, publishedRule('rule-b', 1, 200)]);
    expect(deriveComplianceCheckId('intent-1', setA.ruleSetVersion)).toBe(
      deriveComplianceCheckId('intent-1', setA.ruleSetVersion),
    );
    expect(deriveComplianceCheckId('intent-1', setA.ruleSetVersion)).not.toBe(
      deriveComplianceCheckId('intent-2', setA.ruleSetVersion),
    );
    expect(deriveComplianceCheckId('intent-1', setA.ruleSetVersion)).not.toBe(
      deriveComplianceCheckId('intent-1', setB.ruleSetVersion),
    );
  });
});

describe('state guards', () => {
  test('isRiskRuleState accepts exactly the four states', () => {
    for (const state of RISK_RULE_STATES) {
      expect(isRiskRuleState(state)).toBe(true);
    }
    expect(isRiskRuleState('DRAFT')).toBe(false);
    expect(isRiskRuleState(null)).toBe(false);
    expect(isRiskRuleState(42)).toBe(false);
  });
});
