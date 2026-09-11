/**
 * RTN-005 — Fulfillment Policy Authority: the pure INV-2-1 evaluation.
 *
 * Spec sources (binding) — spec/architecture/v0.1/core.md §2 Area 2:
 *   lines 115-117 (INV-2-1 — THE determinism contract):
 *     "INV-2-1 (financial correctness): cost ceilings are Money values;
 *      policy comparisons are integer comparisons. Evaluation is a pure
 *      function of (policy version, intent terms, capability snapshot)."
 *   lines 102-107 (the PolicyEvaluation object):
 *     "PolicyEvaluation — deterministic result of evaluating a policy
 *      against an intent and a capability snapshot.
 *      States: EVALUATED -> CONSUMED.
 *      Contents: ranked route requirements, constraint envelope, cost
 *      ceiling, deadline."
 *   lines 127-128 (failure semantics):
 *     "failures are reason-coded (POLICY_UNSATISFIABLE) and route the
 *      intent to FAILED."
 *   lines 91-93 (purpose — the fields the evaluation merges).
 *   spec/architecture/v0.1/README.md §3 GC-1 lines 39-43 ("Re-running any
 *   computation on identical inputs yields identical outputs").
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - `evaluateFulfillmentPolicy` is PURE: no store, no clock, no
 *     randomness, no port. Its inputs are exactly the INV-2-1 triple — the
 *     policy (identity + version + definition), the intent terms, and the
 *     capability snapshot. Identical inputs produce identical outcomes
 *     (deep-equal, property-tested; the result hash is derived from the
 *     canonical encoding of the outcome).
 *   - Candidate filter (all integer or set-theoretic, no floats): ACTIVE
 *     snapshot capabilities whose rail is in the policy's AND the intent's
 *     allowed rails; whose corridor matches the intent's corridor exactly
 *     (both currencies, both geographies); whose cost schedule is within
 *     the merged cost ceiling (compareMoney — integer comparison); and
 *     whose available capacity covers the intent amount (compareMoney).
 *   - Ranking: the policy's ordering directive (COST_ASC or TIER_DESC),
 *     always tie-broken by capability id — a total order, so the ranked
 *     list is deterministic.
 *   - Merged envelope: allowed rails = policy ∩ intent (ascending), the
 *     policy's ordering and fallback preference; merged cost ceiling =
 *     min(policy ceiling, intent ceiling) by integer comparison; merged
 *     deadline = min(policy deadline, intent deadline) by integer
 *     comparison.
 *   - No candidate (or an empty merged rail set / impossible ceiling)
 *     yields POLICY_UNSATISFIABLE — the reason-coded failure that routes
 *     the intent to FAILED (the intent authority's failIntent carries the
 *     code; the composed test wires them).
 */

import { createHash } from 'node:crypto';
import { canonicalDerivationInput } from '../kernel/identity.ts';
import { compareMoney } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';
import type { CapabilitySnapshotEntry } from '../capability/types.ts';
import type {
  ConstraintEnvelope,
  FulfillmentPolicyDefinition,
  IntentTerms,
  PolicyEvaluationOutcome,
  PolicyEvaluationResult,
  RouteRequirement,
} from './types.ts';

/**
 * Version of the evaluation result hash input format. Bump on any change
 * to the canonical encoding; hashed values carry the version in their
 * prefix (`peh.v1.<hex>`).
 *
 * Source: INV-2-1 (core.md lines 115-117 — comparable deterministic
 * derivations); core.md line 135 ("result hash").
 */
export const POLICY_EVALUATION_HASH_FORMAT_VERSION = 1;

function fail(message: string): never {
  throw new TypeError(message);
}

/**
 * Validate and canonicalize a policy definition: allowed rails sorted
 * ascending and duplicate-free; the ordering from the frozen vocabulary; a
 * kernel Money cost ceiling; an integer deadline; fallback preferences a
 * duplicate-free rail list. Returns the deep-frozen definition — the
 * "versioned, immutable policy document" starts immutable at mint.
 *
 * Source: core.md lines 91-93 (the field list), 97-99 ("versioned,
 * immutable"); GC-1.
 */
export function fulfillmentPolicyDefinition(input: {
  readonly allowedRails: readonly string[];
  readonly ordering: string;
  readonly costCeiling: Money;
  readonly deadlineEpochMs: number;
  readonly fallbackPreference: readonly string[];
}): FulfillmentPolicyDefinition {
  if (!Array.isArray(input.allowedRails) || input.allowedRails.length === 0) {
    fail('policy definition: allowedRails must be a non-empty array of rail ids');
  }
  const sorted = [...input.allowedRails].sort();
  for (const rail of sorted) {
    if (typeof rail !== 'string' || rail.length === 0) {
      fail('policy definition: every allowed rail id must be a non-empty string');
    }
  }
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1]) {
      fail(`policy definition: duplicate allowed rail id ${JSON.stringify(sorted[index])}`);
    }
  }
  const ordering = input.ordering;
  if (ordering !== 'COST_ASC' && ordering !== 'TIER_DESC') {
    fail(`policy definition: ordering must be COST_ASC or TIER_DESC (got ${JSON.stringify(ordering)})`);
  }
  if (
    input.costCeiling === null ||
    typeof input.costCeiling !== 'object' ||
    typeof input.costCeiling.amountMinor !== 'number' ||
    !Number.isInteger(input.costCeiling.amountMinor)
  ) {
    fail('policy definition: costCeiling must be a kernel Money value (integer minor units — INV-2-1)');
  }
  if (typeof input.deadlineEpochMs !== 'number' || !Number.isInteger(input.deadlineEpochMs) || !Number.isSafeInteger(input.deadlineEpochMs)) {
    fail('policy definition: deadlineEpochMs must be a safe integer number of epoch milliseconds');
  }
  if (!Array.isArray(input.fallbackPreference)) {
    fail('policy definition: fallbackPreference must be an array of rail ids');
  }
  const fallback = [...input.fallbackPreference].sort();
  for (const rail of fallback) {
    if (typeof rail !== 'string' || rail.length === 0) {
      fail('policy definition: every fallback preference rail id must be a non-empty string');
    }
  }
  for (let index = 1; index < fallback.length; index += 1) {
    if (fallback[index] === fallback[index - 1]) {
      fail(`policy definition: duplicate fallback rail id ${JSON.stringify(fallback[index])}`);
    }
  }
  return Object.freeze({
    allowedRails: Object.freeze(sorted),
    ordering,
    costCeiling: input.costCeiling,
    deadlineEpochMs: input.deadlineEpochMs,
    fallbackPreference: Object.freeze(fallback),
  });
}

function isActive(entry: CapabilitySnapshotEntry): boolean {
  // Only ACTIVE capabilities serve commitments ("Degraded capabilities
  // accept no new commitments", core.md lines 157-158; REGISTERED has not
  // been gated active, RETIRED is terminal).
  return entry.state === 'ACTIVE';
}

function corridorMatches(entry: CapabilitySnapshotEntry, terms: IntentTerms): boolean {
  return (
    entry.corridor.sourceCurrency === terms.sourceCurrency &&
    entry.corridor.destinationCurrency === terms.destinationCurrency &&
    entry.corridor.sourceGeography === terms.sourceGeography &&
    entry.corridor.destinationGeography === terms.destinationGeography
  );
}

function railAllowed(entry: CapabilitySnapshotEntry, allowedRails: readonly string[]): boolean {
  return allowedRails.includes(entry.railId);
}

/**
 * The merged allowed-rails intersection (policy ∩ intent), ascending — the
 * constraint envelope's rail set and the candidate filter's first gate.
 *
 * Source: core.md lines 91-93 (both sides carry "allowed rails"); lines
 * 105-106 ("constraint envelope").
 */
export function mergedAllowedRails(
  policy: FulfillmentPolicyDefinition,
  terms: IntentTerms,
): readonly string[] {
  const intentRails = new Set(terms.allowedRails);
  return policy.allowedRails.filter((rail) => intentRails.has(rail));
}

/**
 * The merged cost ceiling: min(policy ceiling, intent ceiling) by integer
 * comparison — both Money values, same currency and scale required
 * (INV-2-1: "cost ceilings are Money values; policy comparisons are
 * integer comparisons").
 *
 * Source: INV-2-1 (core.md lines 115-117); core.md lines 39-41 (the
 * demand's cost-ceiling constraint).
 */
export function mergedCostCeiling(policy: FulfillmentPolicyDefinition, terms: IntentTerms): Money {
  if (
    policy.costCeiling.currency !== terms.costCeiling.currency ||
    policy.costCeiling.scale !== terms.costCeiling.scale
  ) {
    fail(
      `policy evaluation: cost ceilings must share currency and scale (policy ${policy.costCeiling.currency}/${policy.costCeiling.scale}, intent ${terms.costCeiling.currency}/${terms.costCeiling.scale})`,
    );
  }
  return compareMoney(policy.costCeiling, terms.costCeiling) <= 0
    ? policy.costCeiling
    : terms.costCeiling;
}

/**
 * The merged deadline: min(policy deadline, intent deadline) in integer
 * epoch milliseconds.
 *
 * Source: core.md lines 91-93 ("deadlines"), 105-106 ("deadline"); lines
 * 39-41 (the demand's deadline constraint).
 */
export function mergedDeadline(policy: FulfillmentPolicyDefinition, terms: IntentTerms): number {
  return Math.min(policy.deadlineEpochMs, terms.deadlineEpochMs);
}

/**
 * THE pure evaluation (INV-2-1). Inputs: the policy (identity + version +
 * definition), the intent terms, and the capability snapshot. Output: the
 * satisfiable result (ranked route requirements, constraint envelope, cost
 * ceiling, deadline) or the reason-coded POLICY_UNSATISFIABLE failure.
 * Deterministic: identical inputs produce identical outcomes (structural
 * deep equality — the determinism suite machine-checks it).
 *
 * Source: core.md lines 102-107 (the object and contents), 115-117
 * (INV-2-1), 127-128 (POLICY_UNSATISFIABLE).
 */
export function evaluateFulfillmentPolicy(input: {
  readonly policyId: string;
  readonly policyVersion: number;
  readonly definition: FulfillmentPolicyDefinition;
  readonly intentTerms: IntentTerms;
  readonly snapshot: { readonly snapshotId: string; readonly capabilities: readonly CapabilitySnapshotEntry[] };
}): PolicyEvaluationOutcome {
  const { definition, intentTerms, snapshot } = input;
  const rails = mergedAllowedRails(definition, intentTerms);
  const ceiling = mergedCostCeiling(definition, intentTerms);
  const deadline = mergedDeadline(definition, intentTerms);
  if (rails.length === 0) {
    return { satisfiable: false, reasonCode: 'POLICY_UNSATISFIABLE' };
  }
  const candidates: RouteRequirement[] = [];
  for (const entry of snapshot.capabilities) {
    if (!isActive(entry)) {
      continue;
    }
    if (!railAllowed(entry, rails)) {
      continue;
    }
    if (!corridorMatches(entry, intentTerms)) {
      continue;
    }
    if (
      entry.costSchedule.currency !== ceiling.currency ||
      entry.costSchedule.scale !== ceiling.scale
    ) {
      // A candidate priced in a different unit than the ceiling cannot be
      // compared by integer comparison — it is not a candidate under this
      // policy (INV-2-1 requires comparable Money values).
      continue;
    }
    if (compareMoney(entry.costSchedule, ceiling) > 0) {
      continue;
    }
    if (
      entry.availableCapacity.currency !== intentTerms.amount.currency ||
      entry.availableCapacity.scale !== intentTerms.amount.scale
    ) {
      continue;
    }
    if (compareMoney(entry.availableCapacity, intentTerms.amount) < 0) {
      continue;
    }
    candidates.push({
      capabilityId: entry.capabilityId,
      railId: entry.railId,
      sourceCurrency: entry.corridor.sourceCurrency,
      destinationCurrency: entry.corridor.destinationCurrency,
      costSchedule: entry.costSchedule,
      tier: entry.tier,
    });
  }
  if (candidates.length === 0) {
    return { satisfiable: false, reasonCode: 'POLICY_UNSATISFIABLE' };
  }
  const ranked = rankRouteRequirements(candidates, definition.ordering);
  const envelope: ConstraintEnvelope = Object.freeze({
    allowedRails: Object.freeze([...rails]),
    ordering: definition.ordering,
    fallbackPreference: definition.fallbackPreference,
  });
  const result: PolicyEvaluationResult = Object.freeze({
    rankedRouteRequirements: Object.freeze(ranked),
    constraintEnvelope: envelope,
    costCeiling: ceiling,
    deadlineEpochMs: deadline,
  });
  return { satisfiable: true, result };
}

/**
 * Rank the route requirements under a policy ordering — a deterministic
 * TOTAL order (capability id is the final tie-break):
 *   - COST_ASC: cost ascending, then capability id ascending;
 *   - TIER_DESC: tier descending (code-point), then cost ascending, then
 *     capability id ascending.
 *
 * Source: core.md lines 91-93 ("ordering"); line 105 ("ranked route
 * requirements"); INV-2-1 (lines 115-117 — the ranking must be a pure
 * function of the inputs).
 */
export function rankRouteRequirements(
  requirements: readonly RouteRequirement[],
  ordering: 'COST_ASC' | 'TIER_DESC',
): readonly RouteRequirement[] {
  const ranked = [...requirements];
  ranked.sort((a, b) => {
    if (ordering === 'TIER_DESC') {
      if (a.tier !== b.tier) {
        return a.tier < b.tier ? 1 : -1;
      }
    }
    const costOrder = compareMoney(a.costSchedule, b.costSchedule);
    if (costOrder !== 0) {
      return costOrder;
    }
    return a.capabilityId < b.capabilityId ? -1 : a.capabilityId > b.capabilityId ? 1 : 0;
  });
  return Object.freeze(ranked);
}

/**
 * Canonical, versioned encoding of an evaluation outcome — the "result
 * hash" input. Pure function of the outcome; identical outcomes encode
 * identically (GC-1), using the kernel's type-tagged part encoding.
 *
 * Source: core.md line 135 — "POLICY_EVALUATED (outcome: evaluation id and
 * result hash)"; INV-2-1.
 */
export function canonicalPolicyEvaluationOutcome(outcome: PolicyEvaluationOutcome): string {
  const parts: (string | number)[] = [
    'policy-evaluation-result',
    `v${POLICY_EVALUATION_HASH_FORMAT_VERSION}`,
    outcome.satisfiable ? 'SATISFIABLE' : 'POLICY_UNSATISFIABLE',
  ];
  if (!outcome.satisfiable) {
    parts.push(outcome.reasonCode);
    return canonicalDerivationInput(parts);
  }
  const { result } = outcome;
  parts.push(result.costCeiling.currency, result.costCeiling.scale, result.costCeiling.amountMinor);
  parts.push(result.deadlineEpochMs);
  parts.push(result.constraintEnvelope.allowedRails.join(','));
  parts.push(result.constraintEnvelope.ordering);
  parts.push(result.constraintEnvelope.fallbackPreference.join(','));
  for (const requirement of result.rankedRouteRequirements) {
    parts.push(
      requirement.capabilityId,
      requirement.railId,
      requirement.sourceCurrency,
      requirement.destinationCurrency,
      requirement.costSchedule.currency,
      requirement.costSchedule.scale,
      requirement.costSchedule.amountMinor,
      requirement.tier,
    );
  }
  return canonicalDerivationInput(parts);
}

/**
 * The evaluation result hash: sha256 over the canonical outcome encoding,
 * prefixed `peh.v1.<hex>`. Deterministic; feeds the POLICY_EVALUATED proof
 * slot ("outcome: evaluation id and result hash").
 *
 * Source: core.md line 135; INV-2-1; GC-1.
 */
export function policyEvaluationResultHash(outcome: PolicyEvaluationOutcome): string {
  const hex = createHash('sha256').update(canonicalPolicyEvaluationOutcome(outcome), 'utf8').digest('hex');
  return `peh.v${POLICY_EVALUATION_HASH_FORMAT_VERSION}.${hex}`;
}

/**
 * The canonical, versioned encoding of a policy definition — the
 * POLICY_ATTACHED proof input (the fingerprint of the attached version).
 *
 * Source: core.md lines 97-99 ("versioned, immutable policy document");
 * line 134 ("POLICY_ATTACHED (policy version, snapshot id)"); A15 lines
 * 31-32 (proof material).
 */
export function canonicalPolicyDefinition(policyId: string, version: number, definition: FulfillmentPolicyDefinition): string {
  return canonicalDerivationInput([
    'fulfillment-policy',
    `v${POLICY_EVALUATION_HASH_FORMAT_VERSION}`,
    policyId,
    version,
    definition.allowedRails.join(','),
    definition.ordering,
    definition.costCeiling.currency,
    definition.costCeiling.scale,
    definition.costCeiling.amountMinor,
    definition.deadlineEpochMs,
    definition.fallbackPreference.join(','),
  ]);
}

/**
 * The policy definition hash: sha256 over the canonical definition
 * encoding, prefixed `pdh.v1.<hex>`. Feeds the POLICY_ATTACHED proof slot.
 *
 * Source: A15 lines 31-32 (proof hashes); GC-1.
 */
export function policyDefinitionHash(
  policyId: string,
  version: number,
  definition: FulfillmentPolicyDefinition,
): string {
  const hex = createHash('sha256').update(canonicalPolicyDefinition(policyId, version, definition), 'utf8').digest('hex');
  return `pdh.v${POLICY_EVALUATION_HASH_FORMAT_VERSION}.${hex}`;
}
