/**
 * RTN-006 — Routing Authority: the deterministic pinned RouteCompiler
 * tests (compiler determinism + pinning, INV-4-1 value preservation,
 * INV-4-2/INV-4-3, NO_VIABLE_ROUTE).
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/core.md §4 Area 4 lines 227-230:
 *     "RouteCompiler — deterministic function from (intent terms, policy
 *      evaluation, capability snapshot) to either a RoutePlan or a
 *      reason-coded failure (NO_VIABLE_ROUTE). Compiler versions are pinned;
 *      the version id is recorded in every plan."
 *   lines 239-249 (INV-4-1/INV-4-2/INV-4-3); lines 253-254
 *   (NO_VIABLE_ROUTE).
 *   README.md §3 GC-1 lines 39-43 (identical inputs, identical outputs; no
 *   floating point).
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import { deriveProtocolId } from '../kernel/identity.ts';
import type { IntentTerms, PolicyEvaluationOutcome } from '../policy/types.ts';
import type { CapabilitySnapshot, CapabilitySnapshotEntry } from '../capability/types.ts';
import {
  ROUTE_COMPILER_VERSION,
  compileRoutePlan,
  routePlanHash,
  canonicalRoutePlan,
  canonicalConversionSchedule,
} from './compiler.ts';
import { checkRouteValuePreservation } from './value.ts';

function capability(
  capabilityId: string,
  railId: string,
  corridor: [string, string, string, string],
  availableMinor: number,
  costMinor: number,
  tier = 'STANDARD',
  state: CapabilitySnapshotEntry['state'] = 'ACTIVE',
): CapabilitySnapshotEntry {
  const [sourceCurrency, sourceGeography, destinationCurrency, destinationGeography] = corridor;
  return {
    capabilityId,
    railId,
    corridor: { sourceCurrency, sourceGeography, destinationCurrency, destinationGeography },
    state,
    declaredCapacity: money(sourceCurrency, availableMinor, 2),
    reservedTotal: money(sourceCurrency, 0, 2),
    consumedTotal: money(sourceCurrency, 0, 2),
    availableCapacity: money(sourceCurrency, availableMinor, 2),
    costSchedule: money('EUR', costMinor, 2),
    tier,
  };
}

function snapshotOf(capabilities: readonly CapabilitySnapshotEntry[], sequence = 1): CapabilitySnapshot {
  return {
    snapshotId: deriveProtocolId('capability-snapshot', sequence),
    sequence,
    wallMs: 1_000,
    capabilities,
  };
}

function terms(overrides: Partial<IntentTerms> = {}): IntentTerms {
  return {
    amount: money('EUR', 200_00, 2),
    sourceCurrency: 'EUR',
    destinationCurrency: 'USD',
    sourceGeography: 'DE',
    destinationGeography: 'US',
    deadlineEpochMs: 60_000,
    allowedRails: ['sepa', 'swift', 'wise'],
    costCeiling: money('EUR', 500_00, 2),
    ...overrides,
  };
}

function evaluation(overrides: Partial<{
  allowedRails: readonly string[];
  ordering: 'COST_ASC' | 'TIER_DESC';
  ceiling: number;
}> = {}): PolicyEvaluationOutcome {
  return {
    satisfiable: true,
    result: {
      rankedRouteRequirements: [],
      constraintEnvelope: {
        allowedRails: overrides.allowedRails ?? ['sepa', 'swift', 'wise'],
        ordering: overrides.ordering ?? 'COST_ASC',
        fallbackPreference: [],
      },
      costCeiling: money('EUR', overrides.ceiling ?? 500_00, 2),
      deadlineEpochMs: 60_000,
    },
  };
}

const EUR_TO_USD = {
  fromCurrency: 'EUR',
  toCurrency: 'USD',
  fromAmount: money('EUR', 200_00, 2),
  toAmount: money('USD', 220_00, 2),
};

describe('RouteCompiler determinism and pinning (core.md lines 227-230, INV-4-3)', () => {
  const snapshot = snapshotOf([
    capability('cap-a', 'sepa', ['EUR', 'DE', 'EUR', 'FR'], 500_00, 100),
    capability('cap-b', 'wise', ['EUR', 'FR', 'USD', 'US'], 1_000_00, 250),
  ]);

  test('identical inputs return the identical plan (deep-equal content)', () => {
    const first = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation(),
      snapshot,
      conversions: [EUR_TO_USD],
    });
    const second = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation(),
      snapshot,
      conversions: [EUR_TO_USD],
    });
    expect(first.compiled).toBe(true);
    expect(second.compiled).toBe(true);
    if (first.compiled && second.compiled) {
      expect(first.content).toEqual(second.content);
      expect(routePlanHash(first.content)).toBe(routePlanHash(second.content));
    }
  });

  test('the pinned compiler version is recorded in every plan and keys the plan id (INV-4-3)', () => {
    const outcome = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation(),
      snapshot,
      conversions: [EUR_TO_USD],
    });
    expect(outcome.compiled).toBe(true);
    if (outcome.compiled) {
      expect(outcome.content.compilerVersion).toBe(ROUTE_COMPILER_VERSION);
      expect(ROUTE_COMPILER_VERSION).toBe(1);
      expect(outcome.content.planId).toBe(
        deriveProtocolId('route-plan', 'pid.v1.intent', ROUTE_COMPILER_VERSION, snapshot.snapshotId),
      );
    }
  });

  test('a different snapshot id is a different compilation key (INV-4-2/INV-4-3)', () => {
    const first = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation(),
      snapshot,
      conversions: [EUR_TO_USD],
    });
    const second = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation(),
      snapshot: snapshotOf(
        [
          capability('cap-a', 'sepa', ['EUR', 'DE', 'EUR', 'FR'], 500_00, 100),
          capability('cap-b', 'wise', ['EUR', 'FR', 'USD', 'US'], 1_000_00, 250),
        ],
        2,
      ),
      conversions: [EUR_TO_USD],
    });
    expect(first.compiled).toBe(true);
    expect(second.compiled).toBe(true);
    if (first.compiled && second.compiled) {
      expect(first.content.planId === second.content.planId).toBe(false);
      expect(first.content.snapshotId === second.content.snapshotId).toBe(false);
    }
  });

  test('the plan hash is deterministic and covers the compilation key', () => {
    const outcome = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation(),
      snapshot,
      conversions: [EUR_TO_USD],
    });
    expect(outcome.compiled).toBe(true);
    if (outcome.compiled) {
      expect(routePlanHash(outcome.content)).toBe(routePlanHash(outcome.content));
      expect(routePlanHash(outcome.content)).toMatch(/^rph\.v1\.[0-9a-f]{64}$/);
      expect(canonicalRoutePlan(outcome.content)).toContain(`compiler.v${ROUTE_COMPILER_VERSION}`);
      expect(canonicalRoutePlan(outcome.content)).toContain(`snapshot.${snapshot.snapshotId}`);
    }
  });
});

describe('INV-4-1 value preservation (core.md lines 239-244)', () => {
  test('a simple single-currency transfer: every hop amount equals the intent amount', () => {
    const snapshot = snapshotOf([
      capability('cap-a', 'sepa', ['EUR', 'DE', 'EUR', 'DE'], 500_00, 100),
    ]);
    const outcome = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms({
        destinationCurrency: 'EUR',
        destinationGeography: 'DE',
        amount: money('EUR', 200_00, 2),
      }),
      policyEvaluation: evaluation(),
      snapshot,
    });
    expect(outcome.compiled).toBe(true);
    if (outcome.compiled) {
      const plan = outcome.content;
      expect(plan.hops.length).toBe(1);
      expect(plan.hops[0]?.amount.amountMinor).toBe(200_00);
      expect(plan.valueLedger.conversions.length).toBe(0);
      expect(plan.valueLedger.deliveredAmount.amountMinor).toBe(200_00);
      expect(plan.valueLedger.deliveredAmount.currency).toBe('EUR');
      expect(plan.valueLedger.fees.length).toBe(1);
      expect(plan.valueLedger.fees[0]?.fee.amountMinor).toBe(100);
      const check = checkRouteValuePreservation(
        plan.hops,
        plan.valueLedger,
        terms({ destinationCurrency: 'EUR', destinationGeography: 'DE' }),
      );
      expect(check.ok).toBe(true);
    }
  });

  test('a multi-hop cross-currency plan records the explicit conversion and explicit Money fees', () => {
    const snapshot = snapshotOf([
      capability('cap-a', 'sepa', ['EUR', 'DE', 'EUR', 'FR'], 500_00, 100),
      capability('cap-b', 'wise', ['EUR', 'FR', 'USD', 'US'], 1_000_00, 250),
    ]);
    const outcome = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation(),
      snapshot,
      conversions: [EUR_TO_USD],
    });
    expect(outcome.compiled).toBe(true);
    if (outcome.compiled) {
      const plan = outcome.content;
      expect(plan.hops.length).toBe(2);
      expect(plan.hops[0]?.position).toBe(0);
      expect(plan.hops[1]?.position).toBe(1);
      expect(plan.hops[0]?.amount.amountMinor).toBe(200_00);
      expect(plan.hops[0]?.amount.currency).toBe('EUR');
      expect(plan.hops[1]?.amount.amountMinor).toBe(200_00);
      expect(plan.valueLedger.conversions.length).toBe(1);
      expect(plan.valueLedger.conversions[0]?.fromAmount.amountMinor).toBe(200_00);
      expect(plan.valueLedger.conversions[0]?.fromAmount.currency).toBe('EUR');
      expect(plan.valueLedger.conversions[0]?.toAmount.amountMinor).toBe(220_00);
      expect(plan.valueLedger.conversions[0]?.toAmount.currency).toBe('USD');
      expect(plan.valueLedger.deliveredAmount.amountMinor).toBe(220_00);
      expect(plan.valueLedger.deliveredAmount.currency).toBe('USD');
      expect(plan.valueLedger.fees.map((item) => item.fee.amountMinor)).toEqual([100, 250]);
      expect(plan.valueLedger.fees.every((item) => item.fee.currency === 'EUR')).toBe(true);
      expect(
        checkRouteValuePreservation(plan.hops, plan.valueLedger, terms()).ok,
      ).toBe(true);
    }
  });

  test('a single-hop cross-currency corridor compiles with its conversion recorded', () => {
    const snapshot = snapshotOf([
      capability('cap-direct', 'swift', ['EUR', 'DE', 'USD', 'US'], 1_000_00, 300),
    ]);
    const outcome = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation(),
      snapshot,
      conversions: [EUR_TO_USD],
    });
    expect(outcome.compiled).toBe(true);
    if (outcome.compiled) {
      expect(outcome.content.hops.length).toBe(1);
      expect(outcome.content.valueLedger.conversions.length).toBe(1);
      expect(
        checkRouteValuePreservation(outcome.content.hops, outcome.content.valueLedger, terms()).ok,
      ).toBe(true);
    }
  });

  test('integer summation of fees bounds the plan by the cost ceiling', () => {
    // Two hops at 100 + 250 = 350 minor within the 500-minor ceiling compiles;
    // a 400 + 150 = 550-minor pair exceeds it and fails.
    const okSnapshot = snapshotOf([
      capability('cap-a', 'sepa', ['EUR', 'DE', 'EUR', 'FR'], 500_00, 100),
      capability('cap-b', 'wise', ['EUR', 'FR', 'USD', 'US'], 1_000_00, 250),
    ]);
    expect(
      compileRoutePlan({
        intentId: 'pid.v1.intent',
        intentTerms: terms(),
        policyEvaluation: evaluation({ ceiling: 500 }),
        snapshot: okSnapshot,
        conversions: [EUR_TO_USD],
      }).compiled,
    ).toBe(true);
    const overSnapshot = snapshotOf([
      capability('cap-a', 'sepa', ['EUR', 'DE', 'EUR', 'FR'], 500_00, 400),
      capability('cap-b', 'wise', ['EUR', 'FR', 'USD', 'US'], 1_000_00, 150),
    ]);
    const over = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation({ ceiling: 500 }),
      snapshot: overSnapshot,
      conversions: [EUR_TO_USD],
    });
    expect(over.compiled).toBe(false);
    if (!over.compiled) {
      expect(over.reasonCode).toBe('NO_VIABLE_ROUTE');
      expect(over.problem).toContain('ceiling');
    }
  });
});

describe('NO_VIABLE_ROUTE (core.md lines 253-254)', () => {
  test('an unsatisfiable policy evaluation fails with the reason-coded failure', () => {
    const outcome = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: { satisfiable: false, reasonCode: 'POLICY_UNSATISFIABLE' },
      snapshot: snapshotOf([]),
    });
    expect(outcome.compiled).toBe(false);
    if (!outcome.compiled) {
      expect(outcome.reasonCode).toBe('NO_VIABLE_ROUTE');
      expect(outcome.problem).toContain('unsatisfiable');
    }
  });

  test('no ACTIVE capability on an allowed rail fails deterministically', () => {
    const outcome = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation(),
      snapshot: snapshotOf([
        capability('cap-a', 'sepa', ['EUR', 'DE', 'EUR', 'FR'], 500_00, 100, 'STANDARD', 'RETIRED'),
      ]),
    });
    expect(outcome.compiled).toBe(false);
    if (!outcome.compiled) {
      expect(outcome.reasonCode).toBe('NO_VIABLE_ROUTE');
      expect(outcome.problem).toContain('no ACTIVE capability');
    }
  });

  test('no corridor chain from source to destination fails', () => {
    const outcome = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation(),
      snapshot: snapshotOf([
        capability('cap-a', 'sepa', ['EUR', 'DE', 'EUR', 'FR'], 500_00, 100),
        capability('cap-b', 'wise', ['GBP', 'GB', 'USD', 'US'], 1_000_00, 250),
      ]),
    });
    expect(outcome.compiled).toBe(false);
    if (!outcome.compiled) {
      expect(outcome.reasonCode).toBe('NO_VIABLE_ROUTE');
      expect(outcome.problem).toContain('no chain');
    }
  });

  test('an unrecordable currency change fails (no conversion quote)', () => {
    const snapshot = snapshotOf([
      capability('cap-direct', 'swift', ['EUR', 'DE', 'USD', 'US'], 1_000_00, 300),
    ]);
    const outcome = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation(),
      snapshot,
    });
    expect(outcome.compiled).toBe(false);
    if (!outcome.compiled) {
      expect(outcome.reasonCode).toBe('NO_VIABLE_ROUTE');
    }
  });

  test('a conversion quote whose from-amount does not match the flow is not applicable', () => {
    const snapshot = snapshotOf([
      capability('cap-direct', 'swift', ['EUR', 'DE', 'USD', 'US'], 1_000_00, 300),
    ]);
    const outcome = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation(),
      snapshot,
      conversions: [
        {
          fromCurrency: 'EUR',
          toCurrency: 'USD',
          fromAmount: money('EUR', 199_00, 2),
          toAmount: money('USD', 218_90, 2),
        },
      ],
    });
    expect(outcome.compiled).toBe(false);
  });

  test('insufficient snapshot capacity fails the chain', () => {
    const snapshot = snapshotOf([
      capability('cap-direct', 'swift', ['EUR', 'DE', 'USD', 'US'], 100_00, 300),
    ]);
    const outcome = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation(),
      snapshot,
      conversions: [EUR_TO_USD],
    });
    expect(outcome.compiled).toBe(false);
  });

  test('NO_VIABLE_ROUTE is deterministic: identical inputs, identical failure', () => {
    const snapshot = snapshotOf([]);
    const first = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation(),
      snapshot,
    });
    const second = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation(),
      snapshot,
    });
    expect(first).toEqual(second);
  });
});

describe('deterministic chain ranking (the policy ordering directive)', () => {
  function twoDirectCandidates() {
    return snapshotOf([
      capability('cap-cheap', 'swift', ['EUR', 'DE', 'USD', 'US'], 1_000_00, 300),
      capability('cap-pricey', 'wise', ['EUR', 'DE', 'USD', 'US'], 1_000_00, 350),
    ]);
  }

  test('COST_ASC prefers the cheaper single-hop candidate', () => {
    const outcome = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation({ ordering: 'COST_ASC' }),
      snapshot: twoDirectCandidates(),
      conversions: [EUR_TO_USD],
    });
    expect(outcome.compiled).toBe(true);
    if (outcome.compiled) {
      expect(outcome.content.hops[0]?.capabilityId).toBe('cap-cheap');
    }
  });

  test('TIER_DESC prefers the code-point-higher tier over the lower cost', () => {
    // The RTN-005 ordering definition: "TIER_DESC — tier descending
    // (code-point order)" — 'BETA' sorts above 'ALPHA'.
    const snapshot = snapshotOf([
      capability('cap-alpha', 'swift', ['EUR', 'DE', 'USD', 'US'], 1_000_00, 300, 'ALPHA'),
      capability('cap-beta', 'wise', ['EUR', 'DE', 'USD', 'US'], 1_000_00, 350, 'BETA'),
    ]);
    const outcome = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation({ ordering: 'TIER_DESC' }),
      snapshot,
      conversions: [EUR_TO_USD],
    });
    expect(outcome.compiled).toBe(true);
    if (outcome.compiled) {
      expect(outcome.content.hops[0]?.capabilityId).toBe('cap-beta');
    }
  });

  test('a shorter chain wins over a longer chain regardless of cost', () => {
    const snapshot = snapshotOf([
      capability('cap-direct', 'swift', ['EUR', 'DE', 'USD', 'US'], 1_000_00, 400),
      capability('cap-a', 'sepa', ['EUR', 'DE', 'EUR', 'FR'], 500_00, 50),
      capability('cap-b', 'wise', ['EUR', 'FR', 'USD', 'US'], 1_000_00, 50),
    ]);
    const outcome = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation({ ordering: 'COST_ASC' }),
      snapshot,
      conversions: [EUR_TO_USD],
    });
    expect(outcome.compiled).toBe(true);
    if (outcome.compiled) {
      expect(outcome.content.hops.length).toBe(1);
      expect(outcome.content.hops[0]?.capabilityId).toBe('cap-direct');
    }
  });

  test('rail exclusion by the merged envelope prunes candidates', () => {
    const outcome = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation({ allowedRails: ['sepa'] }),
      snapshot: twoDirectCandidates(),
      conversions: [EUR_TO_USD],
    });
    expect(outcome.compiled).toBe(false);
  });
});

describe('compiler input discipline (GC-1)', () => {
  test('malformed inputs are TypeError failures, never silent', () => {
    const snapshot = snapshotOf([]);
    expect(() =>
      compileRoutePlan({
        intentId: '',
        intentTerms: terms(),
        policyEvaluation: evaluation(),
        snapshot,
      }),
    ).toThrow(/intentId/);
    expect(() =>
      compileRoutePlan({
        intentId: 'pid.v1.intent',
        intentTerms: { ...terms(), amount: { currency: 'EUR', scale: 2, amountMinor: 1.5 } as never },
        policyEvaluation: evaluation(),
        snapshot,
      }),
    ).toThrow(/Money/);
    expect(() =>
      compileRoutePlan({
        intentId: 'pid.v1.intent',
        intentTerms: terms(),
        policyEvaluation: evaluation(),
        snapshot,
        conversions: [
          {
            fromCurrency: 'EUR',
            toCurrency: 'USD',
            fromAmount: money('EUR', 200_00, 2),
            toAmount: money('USD', 220_00, 2),
          },
          {
            fromCurrency: 'EUR',
            toCurrency: 'USD',
            fromAmount: money('EUR', 300_00, 2),
            toAmount: money('USD', 330_00, 2),
          },
        ],
      }),
    ).toThrow(/duplicate conversion quote/);
  });

  test('the conversion schedule canonicalizes to one quote per pair, deterministically', () => {
    const canonical = canonicalConversionSchedule([
      {
        fromCurrency: 'USD',
        toCurrency: 'GBP',
        fromAmount: money('USD', 1, 2),
        toAmount: money('GBP', 1, 2),
      },
      {
        fromCurrency: 'EUR',
        toCurrency: 'USD',
        fromAmount: money('EUR', 1, 2),
        toAmount: money('USD', 1, 2),
      },
    ]);
    expect(canonical.map((quote) => quote.fromCurrency)).toEqual(['EUR', 'USD']);
    expect(
      canonicalConversionSchedule([
        {
          fromCurrency: 'USD',
          toCurrency: 'GBP',
          fromAmount: money('USD', 1, 2),
          toAmount: money('GBP', 1, 2),
        },
        {
          fromCurrency: 'EUR',
          toCurrency: 'USD',
          fromAmount: money('EUR', 1, 2),
          toAmount: money('USD', 1, 2),
        },
      ]),
    ).toEqual(canonical);
  });

  test('hop ids derive from (plan id, position) — deterministic and positional', () => {
    const snapshot = snapshotOf([
      capability('cap-a', 'sepa', ['EUR', 'DE', 'EUR', 'FR'], 500_00, 100),
      capability('cap-b', 'wise', ['EUR', 'FR', 'USD', 'US'], 1_000_00, 250),
    ]);
    const outcome = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: terms(),
      policyEvaluation: evaluation(),
      snapshot,
      conversions: [EUR_TO_USD],
    });
    expect(outcome.compiled).toBe(true);
    if (outcome.compiled) {
      const plan = outcome.content;
      expect(plan.hops[0]?.hopId).toBe(deriveProtocolId('route-hop', plan.planId, 0));
      expect(plan.hops[1]?.hopId).toBe(deriveProtocolId('route-hop', plan.planId, 1));
      expect(plan.hops[0]?.settlementSemantics).toBe('HOP_SETTLEMENT:EUR->EUR@FR');
      expect(plan.hops[1]?.settlementSemantics).toBe('HOP_SETTLEMENT:EUR->USD@US');
    }
  });
});
