/**
 * RTN-006 — Routing Authority: the deterministic, version-pinned
 * RouteCompiler (INV-4-2/INV-4-3 + the RouteCompiler contract).
 *
 * Spec sources (binding) — spec/architecture/v0.1/core.md §4 Area 4:
 *   lines 227-230 (RouteCompiler, verbatim):
 *     "RouteCompiler — deterministic function from (intent terms, policy
 *      evaluation, capability snapshot) to either a RoutePlan or a
 *      reason-coded failure (NO_VIABLE_ROUTE). Compiler versions are pinned;
 *      the version id is recorded in every plan."
 *   lines 239-244 (INV-4-1 — value preservation, quoted in value.ts);
 *   lines 245-249 (INV-4-2 / INV-4-3):
 *     "INV-4-2 (concurrency): a plan is compiled against one capability
 *      snapshot id; dispatch acquires reservations (area 5) in the plan's
 *      fixed hop order.
 *      INV-4-3 (idempotency): compilation is keyed by (intent id, compiler
 *      version, snapshot id); identical inputs return the identical plan."
 *   lines 253-254 (NO_VIABLE_ROUTE — the reason-coded terminal failure).
 *   lines 269-271 (boundaries):
 *     "The compiler never calls rails and never mutates balances.
 *      Route plans reference capabilities by id; they do not embed
 *      adapter credentials or endpoints."
 *   spec/architecture/v0.1/README.md §3 GC-1 lines 39-43 ("Re-running any
 *   computation on identical inputs yields identical outputs").
 *
 * Purity: `compileRoutePlan` is PURE — no store, no clock, no randomness,
 * no port, no rail call, no balance mutation. Its inputs are exactly the
 * spec's triple (intent terms, policy evaluation, capability snapshot)
 * plus the caller's recorded conversion facts (the ConversionQuote
 * schedule — see types.ts for the recorded interpretation: the quotes are
 * INV-4-1's "explicit, recorded conversion amounts" as supplied facts, not
 * a fourth authority input). Identical inputs produce an identical outcome
 * (deep-equal, property-tested); the pinned ROUTE_COMPILER_VERSION is
 * recorded in every plan and participates in the plan id (INV-4-3).
 *
 * Deterministic search (recorded in CONTRACT-REVIEW.md):
 *   - usable capabilities: snapshot entries that are ACTIVE, whose rail is
 *     in the policy evaluation's merged allowed-rails envelope, and whose
 *     cost schedule is denominated in the envelope cost-ceiling currency
 *     and scale (integer fee comparability — the same comparability rule
 *     the RTN-005 policy evaluation applies to its candidates);
 *   - chains: simple paths (no repeated capability) through the corridor
 *     graph — hop i's corridor destination (currency AND geography) is hop
 *     i+1's corridor source — starting at the intent's source endpoint and
 *     ending at the intent's destination endpoint;
 *   - flow: the intent amount enters hop 0; each cross-currency hop's
 *     output is the recorded conversion quote's to-amount (applied only
 *     when the quote's from-amount EXACTLY equals the value flowing in);
 *     each same-currency hop's output is its input (recorded equality, no
 *     arithmetic);
 *   - viability: every hop's flowing amount is covered by its
 *     capability's snapshot available capacity (integer comparison, same
 *     currency and scale), and the integer sum of all hop fees (the
 *     capabilities' cost schedules) is within the envelope cost ceiling;
 *   - ranking: viable chains are totally ordered by (hop count ascending,
 *     then element-wise comparison of the hop sequences under the policy's
 *     ordering directive — the same comparator the RTN-005 evaluation ranks
 *     route requirements with: COST_ASC = cost asc then capability id asc;
 *     TIER_DESC = tier desc then cost asc then capability id asc). The
 *     minimum chain is the compiled plan.
 *
 * The search enumerates simple paths depth-first in the canonical
 * comparator order and keeps the running minimum — deterministic for
 * identical inputs, with a fixed exploration bound (SEARCH_EXPANSION_LIMIT)
 * that is part of the pinned compiler version's behavior.
 */

import { createHash } from 'node:crypto';
import { deriveProtocolId } from '../kernel/identity.ts';
import { addMoney, compareMoney, isMoney } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';
import type { CapabilitySnapshotEntry } from '../capability/types.ts';
import type { IntentTerms, PolicyEvaluationOutcome, PolicyOrdering } from '../policy/types.ts';
import { canonicalValueFlow } from './value.ts';
import type {
  ConversionLineItem,
  ConversionQuote,
  FeeLineItem,
  RouteHop,
  RouteValueLedger,
} from './types.ts';

/**
 * The pinned RouteCompiler version — "Compiler versions are pinned; the
 * version id is recorded in every plan" (core.md lines 229-230). Bumping
 * this constant is a compiler release: it changes every derived plan id
 * (INV-4-3 keys compilation by (intent id, compiler version, snapshot id))
 * and therefore never aliases an existing plan.
 *
 * Source: core.md lines 229-230; INV-4-3 lines 248-249.
 */
export const ROUTE_COMPILER_VERSION = 1;

/**
 * Version of the plan-hash input format. Bumped together with any change
 * to the canonical plan encoding; hashed values carry the version prefix
 * (`rph.v1.<hex>`).
 *
 * Source: core.md line 263 — "ROUTE_COMPILED (compiler version, snapshot
 * id, plan hash)". Deterministic hashing per GC-1.
 */
export const ROUTE_PLAN_HASH_FORMAT_VERSION = 1;

/**
 * The fixed exploration bound of the pinned compiler's chain search — the
 * maximum number of DFS expansions before the running minimum is taken.
 * A constant OF THE COMPILER VERSION (deterministic behavior per version;
 * recorded in CONTRACT-REVIEW.md).
 *
 * Source: GC-1 (README.md §3 lines 39-43 — deterministic computation).
 */
export const SEARCH_EXPANSION_LIMIT = 200_000;

/**
 * The compiled plan's CONTENT — the pure compiler's output: the full plan
 * value (identity + hops + value ledger + deadline) without state or
 * protocol time. The authority mints the recorded RoutePlan from this
 * content (state COMPILED + times); identical inputs yield identical
 * content (INV-4-3: "identical inputs return the identical plan").
 *
 * Source: core.md lines 221-230 (RoutePlan + RouteCompiler); INV-4-3
 * lines 248-249.
 */
export interface RoutePlanContent {
  /** deriveProtocolId('route-plan', intentId, compilerVersion, snapshotId). */
  readonly planId: string;
  readonly intentId: string;
  /** The pinned compiler version recorded in every plan. */
  readonly compilerVersion: number;
  /** The one snapshot id this plan was compiled against (INV-4-2). */
  readonly snapshotId: string;
  readonly hops: readonly RouteHop[];
  readonly valueLedger: RouteValueLedger;
  readonly deadlineEpochMs: number;
}

/**
 * The pure compiler's outcome: the compiled plan content, or the
 * reason-coded failure NO_VIABLE_ROUTE ("a reason-coded failure
 * (NO_VIABLE_ROUTE)", core.md lines 228-230).
 *
 * Source: core.md lines 227-230, 253-254.
 */
export type RouteCompilationOutcome =
  | { readonly compiled: true; readonly content: RoutePlanContent }
  | { readonly compiled: false; readonly reasonCode: 'NO_VIABLE_ROUTE'; readonly problem: string };

/**
 * The compilation request: the spec's triple (intent terms, policy
 * evaluation, capability snapshot) — identified by intent id — plus the
 * optional recorded conversion facts (see types.ts ConversionQuote).
 *
 * Source: core.md lines 227-229 (the triple); INV-4-3 lines 248-249 (the
 * compilation key (intent id, compiler version, snapshot id)).
 */
export interface RouteCompilationRequest {
  readonly intentId: string;
  readonly intentTerms: IntentTerms;
  readonly policyEvaluation: PolicyEvaluationOutcome;
  readonly snapshot: {
    readonly snapshotId: string;
    readonly capabilities: readonly CapabilitySnapshotEntry[];
  };
  /** Recorded conversion facts, one quote per currency pair. */
  readonly conversions?: readonly ConversionQuote[];
}

function fail(message: string): never {
  throw new TypeError(message);
}

function assertNonEmptyString(value: unknown, label: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`route compiler: ${label} must be a non-empty string (got ${JSON.stringify(value)})`);
  }
}

function assertMoneyValue(value: unknown, label: string): void {
  if (!isMoney(value)) {
    fail(`route compiler: ${label} must be a kernel Money value (integer minor units, GC-1)`);
  }
}

function assertIntentTerms(terms: IntentTerms): void {
  assertMoneyValue(terms.amount, 'intentTerms.amount');
  assertNonEmptyString(terms.sourceCurrency, 'intentTerms.sourceCurrency');
  assertNonEmptyString(terms.destinationCurrency, 'intentTerms.destinationCurrency');
  assertNonEmptyString(terms.sourceGeography, 'intentTerms.sourceGeography');
  assertNonEmptyString(terms.destinationGeography, 'intentTerms.destinationGeography');
  if (typeof terms.deadlineEpochMs !== 'number' || !Number.isInteger(terms.deadlineEpochMs)) {
    fail('route compiler: intentTerms.deadlineEpochMs must be an integer (GC-1)');
  }
  if (!Array.isArray(terms.allowedRails)) {
    fail('route compiler: intentTerms.allowedRails must be an array of rail ids');
  }
  for (const rail of terms.allowedRails) {
    assertNonEmptyString(rail, 'intentTerms.allowedRails entry');
  }
  assertMoneyValue(terms.costCeiling, 'intentTerms.costCeiling');
}

/**
 * Canonicalize the conversion schedule: one quote per (from, to) currency
 * pair — duplicates are ambiguous inputs (TypeError); each quote's amounts
 * must be Money values denominated exactly in the pair's currencies
 * (TypeError otherwise). Returned as a deterministic array sorted by
 * (fromCurrency, toCurrency).
 *
 * Source: INV-4-1 (core.md lines 242-243 — "explicit, recorded conversion
 * amounts"); GC-1 (integer discipline on the recorded facts).
 */
export function canonicalConversionSchedule(
  conversions: readonly ConversionQuote[],
): readonly ConversionQuote[] {
  if (!Array.isArray(conversions)) {
    fail('route compiler: conversions must be an array of ConversionQuote facts');
  }
  const byPair = new Map<string, ConversionQuote>();
  for (const quote of conversions) {
    if (quote === null || typeof quote !== 'object') {
      fail('route compiler: each conversion quote must be an object');
    }
    assertNonEmptyString(quote.fromCurrency, 'conversion quote fromCurrency');
    assertNonEmptyString(quote.toCurrency, 'conversion quote toCurrency');
    assertMoneyValue(quote.fromAmount, 'conversion quote fromAmount');
    assertMoneyValue(quote.toAmount, 'conversion quote toAmount');
    if (quote.fromAmount.currency !== quote.fromCurrency || quote.toAmount.currency !== quote.toCurrency) {
      fail(
        `route compiler: conversion quote ${quote.fromCurrency}->${quote.toCurrency} carries amounts ` +
          `denominated ${quote.fromAmount.currency}->${quote.toAmount.currency}`,
      );
    }
    const key = `${quote.fromCurrency}->${quote.toCurrency}`;
    if (byPair.has(key)) {
      fail(`route compiler: duplicate conversion quote for ${key} (one quote per currency pair)`);
    }
    byPair.set(key, quote);
  }
  return [...byPair.values()].sort((a, b) =>
    a.fromCurrency === b.fromCurrency
      ? a.toCurrency < b.toCurrency
        ? -1
        : a.toCurrency > b.toCurrency
          ? 1
          : 0
      : a.fromCurrency < b.fromCurrency
        ? -1
        : 1,
  );
}

/**
 * The hop comparator induced by the policy evaluation's ordering
 * directive — the same total order the RTN-005 evaluation ranks route
 * requirements with (cost ascending, then capability id ascending; or tier
 * descending, then cost ascending, then capability id ascending). The
 * final tie-break by capability id makes it a TOTAL order over hops.
 *
 * Source: core.md lines 91-93 (ordering); core.md line 105 ("ranked route
 * requirements"); INV-2-1 (the deterministic ranking the envelope carries
 * forward into routing).
 */
export function hopComparator(ordering: PolicyOrdering) {
  return (a: CapabilitySnapshotEntry, b: CapabilitySnapshotEntry): number => {
    if (ordering === 'TIER_DESC' && a.tier !== b.tier) {
      return a.tier < b.tier ? 1 : -1;
    }
    const costOrder = compareMoney(a.costSchedule, b.costSchedule);
    if (costOrder !== 0) {
      return costOrder;
    }
    return a.capabilityId < b.capabilityId ? -1 : a.capabilityId > b.capabilityId ? 1 : 0;
  };
}

/**
 * The deterministic settlement-semantics label of one hop — the
 * machine-readable expectation the hop records for area 12 ("which
 * settlement instructions to expect", core.md lines 214-216; "expected
 * settlement semantics", lines 221-223). Derived from the hop's corridor
 * destination leg; identical corridor entries always yield the identical
 * label.
 *
 * Source: core.md lines 214-216, 221-223 (the recorded interpretation —
 * see types.ts RouteHop.settlementSemantics).
 */
export function settlementSemanticsFor(entry: CapabilitySnapshotEntry): string {
  const corridor = entry.corridor;
  return `HOP_SETTLEMENT:${corridor.sourceCurrency}->${corridor.destinationCurrency}@${corridor.destinationGeography}`;
}

/**
 * One viable chain under construction — parallel arrays indexed by hop
 * position: the chain's capabilities, the amount flowing into each hop,
 * and the conversion applied at each hop (undefined for a same-currency
 * hop). The chain's delivered amount is the value flowing out of its last
 * hop.
 *
 * Source: core.md lines 221-223 (ordered hops); INV-4-1 lines 239-244
 * (the flow the arrays record).
 */
interface ChainCandidate {
  readonly entries: readonly CapabilitySnapshotEntry[];
  readonly amounts: readonly Money[];
  readonly conversionsByHop: readonly (ConversionLineItem | undefined)[];
  readonly delivered: Money;
}

function moneyExact(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.scale === b.scale && a.amountMinor === b.amountMinor;
}

function compareChains(
  candidate: ChainCandidate,
  incumbent: ChainCandidate,
  ordering: PolicyOrdering,
): number {
  if (candidate.entries.length !== incumbent.entries.length) {
    return candidate.entries.length < incumbent.entries.length ? -1 : 1;
  }
  for (let index = 0; index < candidate.entries.length; index += 1) {
    const left = candidate.entries[index] as CapabilitySnapshotEntry;
    const right = incumbent.entries[index] as CapabilitySnapshotEntry;
    if (ordering === 'TIER_DESC' && left.tier !== right.tier) {
      return left.tier < right.tier ? 1 : -1;
    }
    const costOrder = compareMoney(left.costSchedule, right.costSchedule);
    if (costOrder !== 0) {
      return costOrder;
    }
    if (left.capabilityId !== right.capabilityId) {
      return left.capabilityId < right.capabilityId ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Compile one route plan — the deterministic, pinned RouteCompiler. PURE.
 * See the module doc for the search, ranking, and value-flow rules. Every
 * plan the function returns carries the pinned ROUTE_COMPILER_VERSION, the
 * one snapshot id (INV-4-2), hops with derived ids in fixed order, and the
 * INV-4-1 value ledger (explicit conversions, explicit fees).
 *
 * Source: core.md lines 227-230 (RouteCompiler); lines 239-249 (INV-4-1/
 * 4-2/4-3); lines 253-254 (NO_VIABLE_ROUTE); README.md §3 GC-1.
 */
export function compileRoutePlan(request: RouteCompilationRequest): RouteCompilationOutcome {
  assertNonEmptyString(request.intentId, 'intentId');
  assertIntentTerms(request.intentTerms);
  if (request.policyEvaluation === null || typeof request.policyEvaluation !== 'object') {
    fail('route compiler: policyEvaluation must be a PolicyEvaluationOutcome');
  }
  if (
    request.snapshot === null ||
    typeof request.snapshot !== 'object' ||
    !Array.isArray(request.snapshot.capabilities)
  ) {
    fail('route compiler: snapshot must carry a capabilities array');
  }
  assertNonEmptyString(request.snapshot.snapshotId, 'snapshot.snapshotId');
  const conversions = canonicalConversionSchedule(request.conversions ?? []);
  const { intentTerms, policyEvaluation, snapshot } = request;

  // An unsatisfiable policy evaluation leaves no ranked route requirements
  // to compile against — there is no viable route (the intent's FAILED
  // transition for POLICY_UNSATISFIABLE is area 1/2 semantics; the
  // compilation failure is reason-coded NO_VIABLE_ROUTE here).
  if (!policyEvaluation.satisfiable) {
    return {
      compiled: false,
      reasonCode: 'NO_VIABLE_ROUTE',
      problem:
        `no viable route for intent ${request.intentId}: the policy evaluation is unsatisfiable ` +
        `(${policyEvaluation.reasonCode}); no ranked route requirements exist to compile against ` +
        `(compiler v${ROUTE_COMPILER_VERSION}, snapshot ${snapshot.snapshotId})`,
    };
  }
  const evaluation = policyEvaluation.result;
  const envelope = evaluation.constraintEnvelope;
  const ceiling = evaluation.costCeiling;

  // Usable capabilities: ACTIVE, envelope-allowed rail, fee comparability
  // with the cost ceiling (same currency and scale — integer comparison).
  const usable: CapabilitySnapshotEntry[] = [];
  for (const entry of snapshot.capabilities) {
    if (entry.state !== 'ACTIVE') {
      continue;
    }
    if (!(envelope.allowedRails as readonly string[]).includes(entry.railId)) {
      continue;
    }
    if (entry.costSchedule.currency !== ceiling.currency || entry.costSchedule.scale !== ceiling.scale) {
      // A hop priced in a unit the ceiling cannot integer-compare is not a
      // compilable hop under this envelope (INV-2-1 comparability, carried
      // into routing).
      continue;
    }
    usable.push(entry);
  }
  if (usable.length === 0) {
    return noViableRoute(
      request,
      'no ACTIVE capability rides an allowed rail in the envelope',
    );
  }

  // Canonical expansion order: the policy ordering's total order.
  const comparator = hopComparator(envelope.ordering);
  const ordered = [...usable].sort((a, b) => comparator(a, b));

  const quoteFor = (fromCurrency: string, toCurrency: string): ConversionQuote | undefined =>
    conversions.find(
      (quote) => quote.fromCurrency === fromCurrency && quote.toCurrency === toCurrency,
    );

  let best: ChainCandidate | undefined;
  let expansions = 0;

  const consider = (chain: ChainCandidate): void => {
    // Fee ceiling: the integer sum of the hop fees (all in the ceiling's
    // currency and scale by the usable filter) must be within the envelope
    // cost ceiling (INV-4-1's explicit fee discipline — a chain whose fees
    // exceed the ceiling is not viable).
    let totalFees = (chain.entries[0] as CapabilitySnapshotEntry).costSchedule;
    for (let index = 1; index < chain.entries.length; index += 1) {
      totalFees = addMoney(totalFees, (chain.entries[index] as CapabilitySnapshotEntry).costSchedule);
    }
    if (compareMoney(totalFees, ceiling) > 0) {
      return;
    }
    if (best === undefined) {
      best = chain;
      return;
    }
    if (compareChains(chain, best, envelope.ordering) < 0) {
      best = chain;
    }
  };

  const explore = (
    node: { readonly currency: string; readonly geography: string },
    entries: CapabilitySnapshotEntry[],
    amounts: Money[],
    conversionsByHop: (ConversionLineItem | undefined)[],
    flowing: Money,
  ): void => {
    expansions += 1;
    if (expansions > SEARCH_EXPANSION_LIMIT) {
      return;
    }
    const atGoal =
      entries.length >= 1 &&
      node.currency === intentTerms.destinationCurrency &&
      node.geography === intentTerms.destinationGeography;
    if (atGoal) {
      consider({ entries, amounts, conversionsByHop, delivered: flowing });
      // A chain that reached the destination may still continue (a longer
      // route to the same destination); the ranking prefers shorter
      // chains, so the continuation only matters when the shorter prefix
      // is inviable.
    }
    for (const entry of ordered) {
      if (entries.includes(entry)) {
        continue; // simple paths only — no repeated capability in a chain
      }
      const corridor = entry.corridor;
      if (
        corridor.sourceCurrency !== node.currency ||
        corridor.sourceGeography !== node.geography
      ) {
        continue;
      }
      // Capacity: the flowing amount must be covered by the capability's
      // snapshot available capacity (integer comparison, same currency and
      // scale).
      if (
        entry.availableCapacity.currency !== flowing.currency ||
        entry.availableCapacity.scale !== flowing.scale ||
        compareMoney(entry.availableCapacity, flowing) < 0
      ) {
        continue;
      }
      // Flow into this hop: a currency change must be exactly recorded by
      // a conversion quote whose from-amount equals the flowing value.
      let output: Money;
      let conversionAtHop: ConversionLineItem | undefined;
      if (corridor.sourceCurrency === corridor.destinationCurrency) {
        output = flowing;
        conversionAtHop = undefined;
      } else {
        const quote = quoteFor(corridor.sourceCurrency, corridor.destinationCurrency);
        if (quote === undefined || !moneyExact(quote.fromAmount, flowing)) {
          continue; // the currency change is unrecordable for this flow
        }
        output = quote.toAmount;
        conversionAtHop = { hopId: 'pending', fromAmount: quote.fromAmount, toAmount: quote.toAmount };
      }
      explore(
        { currency: corridor.destinationCurrency, geography: corridor.destinationGeography },
        [...entries, entry],
        [...amounts, flowing],
        [...conversionsByHop, conversionAtHop],
        output,
      );
    }
  };

  explore(
    { currency: intentTerms.sourceCurrency, geography: intentTerms.sourceGeography },
    [],
    [],
    [],
    intentTerms.amount,
  );

  if (best === undefined) {
    return noViableRoute(
      request,
      'no chain of ACTIVE allowed-rail capabilities connects the intent corridor with recorded conversions, sufficient available capacity, and fees within the ceiling',
    );
  }
  const chosen: ChainCandidate = best;

  // Mint the plan: derived ids in fixed hop order; the value ledger's line
  // items tied to the real hop ids by hop position.
  const planId = deriveProtocolId(
    'route-plan',
    request.intentId,
    ROUTE_COMPILER_VERSION,
    snapshot.snapshotId,
  );
  const hops: RouteHop[] = chosen.entries.map((entry, position) => ({
    hopId: deriveProtocolId('route-hop', planId, position),
    position,
    capabilityId: entry.capabilityId,
    railId: entry.railId,
    corridor: entry.corridor,
    amount: chosen.amounts[position] as Money,
    settlementSemantics: settlementSemanticsFor(entry),
  }));
  const conversionsTied: ConversionLineItem[] = [];
  const feesTied: FeeLineItem[] = [];
  for (let position = 0; position < hops.length; position += 1) {
    const hop = hops[position] as RouteHop;
    const conversionAtHop = chosen.conversionsByHop[position];
    if (conversionAtHop !== undefined) {
      conversionsTied.push({ ...conversionAtHop, hopId: hop.hopId });
    }
    feesTied.push({
      hopId: hop.hopId,
      fee: (chosen.entries[position] as CapabilitySnapshotEntry).costSchedule,
    });
  }
  const valueLedger: RouteValueLedger = {
    sourceAmount: intentTerms.amount,
    deliveredAmount: chosen.delivered,
    conversions: Object.freeze(conversionsTied),
    fees: Object.freeze(feesTied),
  };
  const content: RoutePlanContent = {
    planId,
    intentId: request.intentId,
    compilerVersion: ROUTE_COMPILER_VERSION,
    snapshotId: snapshot.snapshotId,
    hops: Object.freeze(hops),
    valueLedger,
    deadlineEpochMs: evaluation.deadlineEpochMs,
  };
  return { compiled: true, content };
}

function noViableRoute(request: RouteCompilationRequest, detail: string): RouteCompilationOutcome {
  const { intentTerms } = request;
  return {
    compiled: false,
    reasonCode: 'NO_VIABLE_ROUTE',
    problem:
      `no viable route for intent ${request.intentId} from ` +
      `(${intentTerms.sourceCurrency}, ${intentTerms.sourceGeography}) to ` +
      `(${intentTerms.destinationCurrency}, ${intentTerms.destinationGeography}): ${detail} ` +
      `(compiler v${ROUTE_COMPILER_VERSION}, snapshot ${request.snapshot.snapshotId})`,
  };
}

/**
 * The canonical, versioned encoding of a compiled plan — the ROUTE_COMPILED
 * plan-hash input. Covers the compilation key (intent id, compiler
 * version, snapshot id — INV-4-3), the deadline, and the full canonical
 * value flow (the INV-4-1 material). PURE.
 *
 * Source: core.md line 263 — "ROUTE_COMPILED (compiler version, snapshot
 * id, plan hash)"; INV-4-1 lines 239-244; GC-1.
 */
export function canonicalRoutePlan(content: RoutePlanContent): string {
  return [
    'route-plan',
    `v${ROUTE_PLAN_HASH_FORMAT_VERSION}`,
    content.planId,
    content.intentId,
    `compiler.v${content.compilerVersion}`,
    `snapshot.${content.snapshotId}`,
    `deadline.${content.deadlineEpochMs}`,
    canonicalValueFlow(content.hops, content.valueLedger),
  ].join('|');
}

/**
 * The plan hash: sha256 over the canonical plan encoding, prefixed
 * `rph.v1.<hex>`. Deterministic; feeds the ROUTE_COMPILED proof slot.
 *
 * Source: core.md line 263 — "ROUTE_COMPILED (compiler version, snapshot
 * id, plan hash)"; GC-1.
 */
export function routePlanHash(content: RoutePlanContent): string {
  const hex = createHash('sha256').update(canonicalRoutePlan(content), 'utf8').digest('hex');
  return `rph.v${ROUTE_PLAN_HASH_FORMAT_VERSION}.${hex}`;
}
