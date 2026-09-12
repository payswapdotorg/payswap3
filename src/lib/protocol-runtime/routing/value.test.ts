/**
 * RTN-006 — Routing Authority: the INV-4-1 value-preservation identity
 * tests (every rule V1..V8 of value.ts, plus the hop-output and fee
 * helpers).
 *
 * Tested contract (spec-cited):
 *   spec/architecture/v0.1/core.md §4 Area 4 lines 239-244:
 *     "INV-4-1 (financial correctness): per hop, amounts are Money values;
 *      the plan's value preservation is checked by integer summation —
 *      for a simple transfer, hop amounts equal the intent amount in each
 *      currency leg, with explicit, recorded conversion amounts for any
 *      currency change. Fees are explicit Money line items; nothing is
 *      derived by floating point."
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import type { IntentTerms } from '../policy/types.ts';
import {
  availableAfterFees,
  canonicalValueFlow,
  checkRouteValuePreservation,
  hopOutputAmount,
  totalFeesInCurrency,
} from './value.ts';
import type { ConversionLineItem, FeeLineItem, RouteHop, RouteValueLedger } from './types.ts';

const TERMS: IntentTerms = {
  amount: money('EUR', 200_00, 2),
  sourceCurrency: 'EUR',
  destinationCurrency: 'USD',
  sourceGeography: 'DE',
  destinationGeography: 'US',
  deadlineEpochMs: 60_000,
  allowedRails: ['sepa', 'wise'],
  costCeiling: money('EUR', 500_00, 2),
};

function hop(
  hopId: string,
  position: number,
  corridor: [string, string, string, string],
  amountMinor: number,
  currency = corridor[0],
): RouteHop {
  const [sourceCurrency, sourceGeography, destinationCurrency, destinationGeography] = corridor;
  return {
    hopId,
    position,
    capabilityId: `cap-${position}`,
    railId: 'sepa',
    corridor: { sourceCurrency, sourceGeography, destinationCurrency, destinationGeography },
    amount: money(currency, amountMinor, 2),
    settlementSemantics: 'HOP_SETTLEMENT:x',
  };
}

function twoHopLedger(): {
  hops: RouteHop[];
  ledger: RouteValueLedger;
  conversions: ConversionLineItem[];
  fees: FeeLineItem[];
} {
  const hops = [
    hop('hop-0', 0, ['EUR', 'DE', 'EUR', 'FR'], 200_00),
    hop('hop-1', 1, ['EUR', 'FR', 'USD', 'US'], 200_00),
  ];
  const conversions = [
    { hopId: 'hop-1', fromAmount: money('EUR', 200_00, 2), toAmount: money('USD', 220_00, 2) },
  ];
  const fees = [
    { hopId: 'hop-0', fee: money('EUR', 100, 2) },
    { hopId: 'hop-1', fee: money('EUR', 250, 2) },
  ];
  const ledger: RouteValueLedger = {
    sourceAmount: money('EUR', 200_00, 2),
    deliveredAmount: money('USD', 220_00, 2),
    conversions,
    fees,
  };
  return { hops, ledger, conversions, fees };
}

describe('INV-4-1 value-preservation identity (core.md lines 239-244)', () => {
  test('a well-formed multi-hop cross-currency plan passes all rules', () => {
    const { hops, ledger } = twoHopLedger();
    expect(checkRouteValuePreservation(hops, ledger, TERMS).ok).toBe(true);
  });

  test('a simple single-currency plan passes: every hop amount equals the intent amount', () => {
    const hops = [hop('hop-0', 0, ['EUR', 'DE', 'EUR', 'DE'], 200_00)];
    const ledger: RouteValueLedger = {
      sourceAmount: money('EUR', 200_00, 2),
      deliveredAmount: money('EUR', 200_00, 2),
      conversions: [],
      fees: [{ hopId: 'hop-0', fee: money('EUR', 100, 2) }],
    };
    expect(
      checkRouteValuePreservation(hops, ledger, {
        ...TERMS,
        destinationCurrency: 'EUR',
        destinationGeography: 'DE',
      }).ok,
    ).toBe(true);
  });

  test('V1: a plan with no hops fails; a mispositioned hop fails', () => {
    const { ledger } = twoHopLedger();
    expect(checkRouteValuePreservation([], ledger, TERMS).ok).toBe(false);
    const { hops } = twoHopLedger();
    const swapped = [hops[1] as RouteHop, { ...(hops[0] as RouteHop), position: 1 } as RouteHop];
    const result = checkRouteValuePreservation(swapped, ledger, TERMS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rule).toBe('V1');
    }
  });

  test('V2: hop 0 must carry exactly the intent amount (the source leg)', () => {
    const { hops, ledger } = twoHopLedger();
    const wrongSource: RouteValueLedger = {
      ...ledger,
      sourceAmount: money('EUR', 199_00, 2),
    };
    const result = checkRouteValuePreservation(hops, wrongSource, TERMS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rule).toBe('V2');
    }
  });

  test('V3: a broken corridor chain fails; wrong endpoints fail', () => {
    const { ledger } = twoHopLedger();
    const brokenChain = [
      hop('hop-0', 0, ['EUR', 'DE', 'EUR', 'ES'], 200_00),
      hop('hop-1', 1, ['EUR', 'FR', 'USD', 'US'], 200_00),
    ];
    const result = checkRouteValuePreservation(brokenChain, ledger, TERMS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rule).toBe('V3');
    }
    const { hops } = twoHopLedger();
    const wrongStart = [
      hop('hop-0', 0, ['EUR', 'ES', 'EUR', 'FR'], 200_00),
      hop('hop-1', 1, ['EUR', 'FR', 'USD', 'US'], 200_00),
    ];
    expect(checkRouteValuePreservation(wrongStart, ledger, TERMS).ok).toBe(false);
  });

  test('V4: a currency change without a conversion fails; a mismatched conversion fails', () => {
    const { hops } = twoHopLedger();
    const missingConversion: RouteValueLedger = {
      sourceAmount: money('EUR', 200_00, 2),
      deliveredAmount: money('USD', 220_00, 2),
      conversions: [],
      fees: [
        { hopId: 'hop-0', fee: money('EUR', 100, 2) },
        { hopId: 'hop-1', fee: money('EUR', 250, 2) },
      ],
    };
    const result = checkRouteValuePreservation(hops, missingConversion, TERMS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rule).toBe('V4');
    }
    const { ledger } = twoHopLedger();
    const wrongFrom: RouteValueLedger = {
      ...ledger,
      conversions: [
        {
          hopId: 'hop-1',
          fromAmount: money('EUR', 199_00, 2),
          toAmount: money('USD', 220_00, 2),
        },
      ],
    };
    expect(checkRouteValuePreservation(hops, wrongFrom, TERMS).ok).toBe(false);
    // A conversion on a same-currency hop also fails.
    const sameCurrencyHops = [hop('hop-0', 0, ['EUR', 'DE', 'EUR', 'DE'], 200_00)];
    const spuriousConversion: RouteValueLedger = {
      sourceAmount: money('EUR', 200_00, 2),
      deliveredAmount: money('EUR', 200_00, 2),
      conversions: [
        { hopId: 'hop-0', fromAmount: money('EUR', 200_00, 2), toAmount: money('EUR', 200_00, 2) },
      ],
      fees: [{ hopId: 'hop-0', fee: money('EUR', 100, 2) }],
    };
    const spurious = checkRouteValuePreservation(sameCurrencyHops, spuriousConversion, {
      ...TERMS,
      destinationCurrency: 'EUR',
      destinationGeography: 'DE',
    });
    expect(spurious.ok).toBe(false);
    if (!spurious.ok) {
      expect(spurious.rule).toBe('V4');
    }
  });

  test('V5: flow discontinuity between hops fails (value lost at a boundary)', () => {
    const { ledger } = twoHopLedger();
    const discontinuous = [
      hop('hop-0', 0, ['EUR', 'DE', 'EUR', 'FR'], 200_00),
      hop('hop-1', 1, ['EUR', 'FR', 'USD', 'US'], 150_00),
    ];
    const result = checkRouteValuePreservation(discontinuous, ledger, TERMS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rule).toBe('V5');
    }
  });

  test('V6: the delivered amount must be the last hop output, in the destination currency', () => {
    const { hops } = twoHopLedger();
    const wrongDelivered: RouteValueLedger = {
      sourceAmount: money('EUR', 200_00, 2),
      deliveredAmount: money('USD', 219_00, 2),
      conversions: [
        { hopId: 'hop-1', fromAmount: money('EUR', 200_00, 2), toAmount: money('USD', 220_00, 2) },
      ],
      fees: [
        { hopId: 'hop-0', fee: money('EUR', 100, 2) },
        { hopId: 'hop-1', fee: money('EUR', 250, 2) },
      ],
    };
    const result = checkRouteValuePreservation(hops, wrongDelivered, TERMS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rule).toBe('V6');
    }
  });

  test('V7: exactly one explicit Money fee line item per hop', () => {
    const { hops, ledger } = twoHopLedger();
    const doubleFee: RouteValueLedger = {
      ...ledger,
      fees: [
        { hopId: 'hop-0', fee: money('EUR', 100, 2) },
        { hopId: 'hop-0', fee: money('EUR', 1, 2) },
        { hopId: 'hop-1', fee: money('EUR', 250, 2) },
      ],
    };
    const result = checkRouteValuePreservation(hops, doubleFee, TERMS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rule).toBe('V7');
    }
  });

  test('V8: orphan conversion and fee line items fail', () => {
    const { hops, ledger } = twoHopLedger();
    const orphanConversion: RouteValueLedger = {
      ...ledger,
      conversions: [
        ...ledger.conversions,
        { hopId: 'hop-9', fromAmount: money('EUR', 1, 2), toAmount: money('USD', 1, 2) },
      ],
    };
    const conversionResult = checkRouteValuePreservation(hops, orphanConversion, TERMS);
    expect(conversionResult.ok).toBe(false);
    if (!conversionResult.ok) {
      expect(conversionResult.rule).toBe('V8');
    }
    const orphanFee: RouteValueLedger = {
      ...ledger,
      fees: [...ledger.fees, { hopId: 'hop-9', fee: money('EUR', 1, 2) }],
    };
    const feeResult = checkRouteValuePreservation(hops, orphanFee, TERMS);
    expect(feeResult.ok).toBe(false);
    if (!feeResult.ok) {
      expect(feeResult.rule).toBe('V8');
    }
  });
});

describe('INV-4-1 helpers', () => {
  test('hopOutputAmount: same-currency hops pass their input through; cross-currency hops use the recorded conversion', () => {
    const same = hop('hop-0', 0, ['EUR', 'DE', 'EUR', 'DE'], 200_00);
    expect(hopOutputAmount(same, [])?.amountMinor).toBe(200_00);
    const cross = hop('hop-1', 1, ['EUR', 'FR', 'USD', 'US'], 200_00);
    expect(hopOutputAmount(cross, [])).toBe(undefined);
    expect(
      hopOutputAmount(cross, [
        { hopId: 'hop-1', fromAmount: money('EUR', 200_00, 2), toAmount: money('USD', 220_00, 2) },
      ])?.amountMinor,
    ).toBe(220_00);
  });

  test('totalFeesInCurrency: integer summation of the explicit line items', () => {
    const fees = [
      { hopId: 'hop-0', fee: money('EUR', 100, 2) },
      { hopId: 'hop-1', fee: money('EUR', 250, 2) },
    ];
    expect(totalFeesInCurrency(fees, 'EUR')?.amountMinor).toBe(350);
    expect(totalFeesInCurrency(fees, 'USD')).toBe(undefined);
    expect(availableAfterFees(money('EUR', 200_00, 2), money('EUR', 350, 2)).amountMinor).toBe(196_50);
  });

  test('canonicalValueFlow is deterministic and value-sensitive', () => {
    const { hops, ledger } = twoHopLedger();
    const first = canonicalValueFlow(hops, ledger);
    const second = canonicalValueFlow(
      hops.map((h) => ({ ...h })),
      {
        sourceAmount: { ...ledger.sourceAmount },
        deliveredAmount: { ...ledger.deliveredAmount },
        conversions: ledger.conversions.map((c) => ({ ...c })),
        fees: ledger.fees.map((f) => ({ ...f })),
      },
    );
    expect(first).toBe(second);
    const altered = canonicalValueFlow(hops, {
      ...ledger,
      deliveredAmount: money('USD', 219_00, 2),
    });
    expect(altered === first).toBe(false);
  });
});
