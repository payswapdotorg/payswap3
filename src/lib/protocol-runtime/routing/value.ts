/**
 * RTN-006 — Routing Authority: pure value-preservation accounting (INV-4-1).
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/core.md §4 Area 4, lines 239-244:
 *     "INV-4-1 (financial correctness): per hop, amounts are Money values;
 *      the plan's value preservation is checked by integer summation —
 *      for a simple transfer, hop amounts equal the intent amount in each
 *      currency leg, with explicit, recorded conversion amounts for any
 *      currency change. Fees are explicit Money line items; nothing is
 *      derived by floating point."
 *   spec/architecture/v0.1/README.md §3 GC-1 lines 39-43:
 *     "All monetary values are signed integers in minor units ... No
 *      floating point. ... Re-running any computation on identical inputs
 *      yields identical outputs."
 *
 * The identity this module machine-checks (recorded in CONTRACT-
 * REVIEW.md as the materialization of "checked by integer summation"):
 *
 *   (V1) every hop amount is a Money value denominated in that hop's
 *        corridor SOURCE currency and scale (per-hop well-formedness);
 *   (V2) the value entering hop 0 IS the intent amount (the source leg);
 *   (V3) hop chaining: hop i's corridor destination (currency AND
 *        geography) equals hop i+1's corridor source (currency AND
 *        geography) — the ordered hops form one unbroken corridor chain
 *        from the intent's source to the intent's destination;
 *   (V4) currency changes are exactly recorded: a hop whose corridor
 *        changes currency carries EXACTLY ONE conversion line item whose
 *        from-amount equals the hop's amount (integer Money equality) and
 *        whose to-amount is the hop's delivered output in the destination
 *        currency; a same-currency hop carries NO conversion item;
 *   (V5) flow continuity by integer summation: the value leaving hop i
 *        equals the value entering hop i+1 (for a same-currency hop the
 *        output is the input; for a cross-currency hop it is the recorded
 *        conversion's to-amount) — no value is created or lost at any hop
 *        boundary;
 *   (V6) the value leaving the last hop IS the ledger's deliveredAmount,
 *        denominated in the intent's destination currency;
 *   (V7) fees are explicit Money line items: exactly one per hop, each
 *        tied to that hop's id;
 *   (V8) no orphan line items: every conversion and fee item references
 *        a hop of THIS plan.
 *
 * For a simple (single-currency) transfer, (V2)+(V5) reduce to exactly the
 * spec's sentence: every hop amount equals the intent amount in each
 * currency leg (the single leg). For a cross-currency plan, the conversion
 * line items of (V4) are the "explicit, recorded conversion amounts".
 *
 * All comparisons are the kernel's integer Money operators (moneyEquals /
 * addMoney / subtractMoney) — nothing is derived by floating point, and
 * every function here is pure (GC-1 determinism).
 */

import { addMoney, moneyEquals, subtractMoney } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';
import type { IntentTerms } from '../policy/types.ts';
import type {
  ConversionLineItem,
  FeeLineItem,
  RouteHop,
  RouteValueLedger,
} from './types.ts';

/**
 * The typed failure of the value-preservation check: which identity rule
 * failed and the deterministic problem description. (A pure predicate with
 * a reason — the same convention the merged state machines use for typed
 * rejections.)
 *
 * Source: INV-4-1 (core.md lines 239-244).
 */
export type ValuePreservationCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly rule: string; readonly problem: string };

/**
 * The value flowing OUT of one hop — pure. For a hop whose corridor does
 * not change currency, the output IS the hop's amount ("hop amounts equal
 * the intent amount in each currency leg"); for a cross-currency hop, the
 * output is the recorded conversion's to-amount (the explicit, recorded
 * conversion amount). Returns the output or undefined when no well-formed
 * conversion exists for the hop (the caller's check reports the rule
 * failure).
 *
 * Source: core.md lines 239-244 (INV-4-1 — integer summation with explicit
 * recorded conversion amounts).
 */
export function hopOutputAmount(
  hop: RouteHop,
  conversions: readonly ConversionLineItem[],
): Money | undefined {
  const sameCurrency = hop.corridor.sourceCurrency === hop.corridor.destinationCurrency;
  if (sameCurrency) {
    return hop.amount;
  }
  const item = conversions.find((candidate) => candidate.hopId === hop.hopId);
  if (item === undefined) {
    return undefined;
  }
  return item.toAmount;
}

/**
 * The total of all fee line items in one currency — integer summation of
 * the explicit Money line items (all fees of a compiled plan share the
 * cost-ceiling currency by construction; this helper sums whichever
 * currency is asked for). PURE.
 *
 * Source: core.md lines 243-244 — "Fees are explicit Money line items";
 * integer summation per INV-4-1.
 */
export function totalFeesInCurrency(
  fees: readonly FeeLineItem[],
  currency: string,
): Money | undefined {
  const inCurrency = fees.filter((item) => item.fee.currency === currency);
  if (inCurrency.length === 0) {
    return undefined;
  }
  const first = inCurrency[0] as FeeLineItem;
  let total = first.fee;
  for (let index = 1; index < inCurrency.length; index += 1) {
    total = addMoney(total, (inCurrency[index] as FeeLineItem).fee);
  }
  return total;
}

/**
 * The INV-4-1 value-preservation identity over a full plan content
 * (hops + value ledger) against the intent terms it was compiled for.
 * Every rule V1..V8 of the module doc; returns the first failure or ok.
 * PURE: a deterministic function of (hops, valueLedger, intentTerms).
 *
 * Source: core.md lines 239-244 (INV-4-1); README.md §3 GC-1.
 */
export function checkRouteValuePreservation(
  hops: readonly RouteHop[],
  valueLedger: RouteValueLedger,
  intentTerms: IntentTerms,
): ValuePreservationCheck {
  // (V1 precondition) a plan has at least one hop.
  if (hops.length === 0) {
    return {
      ok: false,
      rule: 'V1',
      problem: 'value preservation: a plan must have at least one hop (INV-4-1, core.md lines 239-244)',
    };
  }

  // (V1) per-hop well-formedness: amount Money values in the corridor
  // source currency and scale; positions strictly ascending from 0.
  for (let index = 0; index < hops.length; index += 1) {
    const hop = hops[index] as RouteHop;
    if (hop.position !== index) {
      return {
        ok: false,
        rule: 'V1',
        problem:
          `value preservation: hop at index ${index} carries position ${hop.position} ` +
          '(the fixed hop order is 0-based ascending — INV-4-2, core.md lines 245-247)',
      };
    }
    if (hop.amount.currency !== hop.corridor.sourceCurrency) {
      return {
        ok: false,
        rule: 'V1',
        problem:
          `value preservation: hop ${hop.hopId} amount is denominated in ${hop.amount.currency} ` +
          `but its corridor source currency is ${hop.corridor.sourceCurrency} ` +
          '(per hop, amounts are Money values of the hop\'s corridor source currency — INV-4-1, core.md lines 239-241)',
      };
    }
  }

  // (V2) the value entering hop 0 IS the intent amount (source leg).
  const firstHop = hops[0] as RouteHop;
  if (!moneyEquals(firstHop.amount, valueLedger.sourceAmount)) {
    return {
      ok: false,
      rule: 'V2',
      problem:
        `value preservation: hop 0 amount is ${firstHop.amount.amountMinor} ${firstHop.amount.currency} ` +
        `but the ledger source amount is ${valueLedger.sourceAmount.amountMinor} ${valueLedger.sourceAmount.currency} ` +
        '(hop amounts equal the intent amount in each currency leg — INV-4-1, core.md lines 241-242)',
    };
  }
  if (!moneyEquals(valueLedger.sourceAmount, intentTerms.amount)) {
    return {
      ok: false,
      rule: 'V2',
      problem:
        `value preservation: ledger source amount ${valueLedger.sourceAmount.amountMinor} ` +
        `${valueLedger.sourceAmount.currency} does not equal the intent amount ` +
        `${intentTerms.amount.amountMinor} ${intentTerms.amount.currency} ` +
        '(the intent amount is the value entering the plan — INV-4-1, core.md lines 241-242)',
    };
  }
  if (
    firstHop.corridor.sourceCurrency !== intentTerms.sourceCurrency ||
    firstHop.corridor.sourceGeography !== intentTerms.sourceGeography
  ) {
    return {
      ok: false,
      rule: 'V3',
      problem:
        `value preservation: hop 0 corridor source (${firstHop.corridor.sourceCurrency}, ` +
        `${firstHop.corridor.sourceGeography}) does not match the intent source ` +
        `(${intentTerms.sourceCurrency}, ${intentTerms.sourceGeography}) ` +
        '(the plan\'s corridor chain must start at the intent source — core.md lines 214-216)',
    };
  }
  const lastHop = hops[hops.length - 1] as RouteHop;
  if (
    lastHop.corridor.destinationCurrency !== intentTerms.destinationCurrency ||
    lastHop.corridor.destinationGeography !== intentTerms.destinationGeography
  ) {
    return {
      ok: false,
      rule: 'V3',
      problem:
        `value preservation: last hop corridor destination (${lastHop.corridor.destinationCurrency}, ` +
        `${lastHop.corridor.destinationGeography}) does not match the intent destination ` +
        `(${intentTerms.destinationCurrency}, ${intentTerms.destinationGeography}) ` +
        '(the plan\'s corridor chain must end at the intent destination — core.md lines 214-216)',
    };
  }

  // (V3) hop chaining: hop i's corridor destination is hop i+1's corridor
  // source (currency AND geography).
  for (let index = 0; index + 1 < hops.length; index += 1) {
    const current = hops[index] as RouteHop;
    const next = hops[index + 1] as RouteHop;
    if (
      current.corridor.destinationCurrency !== next.corridor.sourceCurrency ||
      current.corridor.destinationGeography !== next.corridor.sourceGeography
    ) {
      return {
        ok: false,
        rule: 'V3',
        problem:
          `value preservation: hop ${index} corridor destination ` +
          `(${current.corridor.destinationCurrency}, ${current.corridor.destinationGeography}) ` +
          `does not chain to hop ${index + 1} corridor source ` +
          `(${next.corridor.sourceCurrency}, ${next.corridor.sourceGeography}) ` +
          '(ordered hops form one unbroken corridor chain — core.md lines 221-223, 214-216)',
      };
    }
  }

  // (V4) currency changes are exactly recorded; (V5) flow continuity by
  // integer summation; (V6) the last hop's output is the delivered amount.
  for (let index = 0; index < hops.length; index += 1) {
    const hop = hops[index] as RouteHop;
    const crossCurrency = hop.corridor.sourceCurrency !== hop.corridor.destinationCurrency;
    const item = valueLedger.conversions.find((candidate) => candidate.hopId === hop.hopId);
    if (crossCurrency) {
      if (item === undefined) {
        return {
          ok: false,
          rule: 'V4',
          problem:
            `value preservation: hop ${hop.hopId} changes currency ` +
            `(${hop.corridor.sourceCurrency} -> ${hop.corridor.destinationCurrency}) ` +
            'without an explicit, recorded conversion amount ' +
            '(INV-4-1, core.md lines 242-243: "explicit, recorded conversion amounts for any currency change")',
        };
      }
      if (!moneyEquals(item.fromAmount, hop.amount)) {
        return {
          ok: false,
          rule: 'V4',
          problem:
            `value preservation: conversion for hop ${hop.hopId} records from-amount ` +
            `${item.fromAmount.amountMinor} ${item.fromAmount.currency} but the hop amount is ` +
            `${hop.amount.amountMinor} ${hop.amount.currency} ` +
            '(the recorded conversion amount must be exact — INV-4-1, core.md lines 242-243)',
        };
      }
      if (
        item.fromAmount.currency !== hop.corridor.sourceCurrency ||
        item.toAmount.currency !== hop.corridor.destinationCurrency
      ) {
        return {
          ok: false,
          rule: 'V4',
          problem:
            `value preservation: conversion for hop ${hop.hopId} must convert ` +
            `${hop.corridor.sourceCurrency} -> ${hop.corridor.destinationCurrency} ` +
            `(recorded ${item.fromAmount.currency} -> ${item.toAmount.currency}) ` +
            '(INV-4-1, core.md lines 242-243)',
        };
      }
    } else if (item !== undefined) {
      return {
        ok: false,
        rule: 'V4',
        problem:
          `value preservation: hop ${hop.hopId} does not change currency ` +
          `(${hop.corridor.sourceCurrency} -> ${hop.corridor.destinationCurrency}) ` +
          'but carries a conversion line item ' +
          '(conversion amounts are recorded for ANY currency change and only for currency changes — INV-4-1, core.md lines 242-243)',
      };
    }
    // (V5) flow continuity at each hop boundary.
    if (index + 1 < hops.length) {
      const next = hops[index + 1] as RouteHop;
      const output = hopOutputAmount(hop, valueLedger.conversions);
      if (output === undefined) {
        return {
          ok: false,
          rule: 'V5',
          problem:
            `value preservation: hop ${hop.hopId} has no well-formed output ` +
            '(integer summation over the plan is impossible — INV-4-1, core.md lines 239-244)',
        };
      }
      if (!moneyEquals(output, next.amount)) {
        return {
          ok: false,
          rule: 'V5',
          problem:
            `value preservation: hop ${index} output ${output.amountMinor} ${output.currency} ` +
            `does not equal hop ${index + 1} amount ${next.amount.amountMinor} ${next.amount.currency} ` +
            '(the value leaving each hop equals the value entering the next — INV-4-1 integer summation, core.md lines 239-244)',
        };
      }
    }
  }

  // (V6) the last hop's output is the ledger's delivered amount.
  const lastOutput = hopOutputAmount(lastHop, valueLedger.conversions);
  if (lastOutput === undefined || !moneyEquals(lastOutput, valueLedger.deliveredAmount)) {
    return {
      ok: false,
      rule: 'V6',
      problem:
        `value preservation: last hop output ` +
        `${lastOutput === undefined ? '(undefined)' : `${lastOutput.amountMinor} ${lastOutput.currency}`} ` +
        `does not equal the ledger delivered amount ` +
        `${valueLedger.deliveredAmount.amountMinor} ${valueLedger.deliveredAmount.currency} ` +
        '(the value leaving the plan is the delivered amount — INV-4-1, core.md lines 239-244)',
    };
  }
  if (valueLedger.deliveredAmount.currency !== intentTerms.destinationCurrency) {
    return {
      ok: false,
      rule: 'V6',
      problem:
        `value preservation: delivered amount is denominated in ${valueLedger.deliveredAmount.currency} ` +
        `but the intent destination currency is ${intentTerms.destinationCurrency} ` +
        '(the destination leg is the intent\'s destination currency — INV-4-1, core.md lines 241-242)',
    };
  }

  // (V7) fees: exactly one explicit Money line item per hop.
  for (const hop of hops) {
    const items = valueLedger.fees.filter((candidate) => candidate.hopId === hop.hopId);
    if (items.length !== 1) {
      return {
        ok: false,
        rule: 'V7',
        problem:
          `value preservation: hop ${hop.hopId} carries ${items.length} fee line items ` +
          '(fees are explicit Money line items, exactly one per hop — INV-4-1, core.md lines 243-244)',
      };
    }
  }

  // (V8) no orphan line items.
  for (const item of valueLedger.conversions) {
    if (!hops.some((hop) => hop.hopId === item.hopId)) {
      return {
        ok: false,
        rule: 'V8',
        problem:
          `value preservation: conversion line item for ${item.hopId} references no hop of this plan ` +
          '(no orphan line items — INV-4-1, core.md lines 239-244)',
      };
    }
  }
  for (const item of valueLedger.fees) {
    if (!hops.some((hop) => hop.hopId === item.hopId)) {
      return {
        ok: false,
        rule: 'V8',
        problem:
          `value preservation: fee line item for ${item.hopId} references no hop of this plan ` +
          '(no orphan line items — INV-4-1, core.md lines 239-244)',
      };
    }
  }

  return { ok: true };
}

/**
 * The canonical hop-summation identity hash input: the deterministic
 * encoding of the plan's full value flow (every hop amount, every
 * conversion pair, every fee, the source and delivered amounts). Used as
 * the ROUTE_COMPILED plan-hash input — the hash covers exactly the
 * value-preservation material, so two plans with equal hashes have equal
 * value flows (GC-1: re-running on identical inputs yields identical
 * outputs).
 *
 * Source: INV-4-1 (core.md lines 239-244); core.md line 263 ("ROUTE_COMPILED
 * (compiler version, snapshot id, plan hash)").
 */
export function canonicalValueFlow(
  hops: readonly RouteHop[],
  valueLedger: RouteValueLedger,
): string {
  const parts: (string | number)[] = ['route-value-flow', `hops:${hops.length}`];
  for (const hop of hops) {
    parts.push(
      hop.hopId,
      hop.corridor.sourceCurrency,
      hop.corridor.sourceGeography,
      hop.corridor.destinationCurrency,
      hop.corridor.destinationGeography,
      hop.amount.currency,
      hop.amount.scale,
      hop.amount.amountMinor,
    );
  }
  parts.push(
    'source',
    valueLedger.sourceAmount.currency,
    valueLedger.sourceAmount.scale,
    valueLedger.sourceAmount.amountMinor,
    'delivered',
    valueLedger.deliveredAmount.currency,
    valueLedger.deliveredAmount.scale,
    valueLedger.deliveredAmount.amountMinor,
    `conversions:${valueLedger.conversions.length}`,
  );
  for (const item of valueLedger.conversions) {
    parts.push(
      item.hopId,
      item.fromAmount.currency,
      item.fromAmount.scale,
      item.fromAmount.amountMinor,
      item.toAmount.currency,
      item.toAmount.scale,
      item.toAmount.amountMinor,
    );
  }
  parts.push(`fees:${valueLedger.fees.length}`);
  for (const item of valueLedger.fees) {
    parts.push(item.hopId, item.fee.currency, item.fee.scale, item.fee.amountMinor);
  }
  return parts.join('|');
}

/**
 * The remaining value the plan has NOT yet delivered at a hop boundary —
 * the integer subtraction of the cumulative fee total from the source
 * amount is deliberately NOT part of INV-4-1 (fees are recorded alongside
 * the flow, not deducted from it — recorded interpretation); this helper
 * exists for projections only. PURE.
 *
 * Source: INV-4-1 (core.md lines 239-244 — fees as explicit line items).
 */
export function availableAfterFees(sourceAmount: Money, totalFees: Money): Money {
  return subtractMoney(sourceAmount, totalFees);
}
