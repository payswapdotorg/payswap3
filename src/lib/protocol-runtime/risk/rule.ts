/**
 * RTN-003 — Risk/Compliance Authority: the RiskRule lifecycle.
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/evidence-risk-compliance.md §2 Area 16, lines
 *   98-100 (the object and its state machine):
 *     "RiskRule — versioned, immutable rule definition with an explicit
 *      evaluation function signature.
 *      States: AUTHORED -> VERSIONED -> ACTIVE -> RETIRED."
 *   lines 124-126 (INV-16-1, determinism):
 *     "INV-16-1 (determinism): evaluation is a pure function of
 *      (rule version, screening list version, subject data hash);
 *      identical inputs always produce the identical recorded outcome."
 *   lines 127-128 (INV-16-2, integer thresholds):
 *     "INV-16-2 (no float risk): all threshold comparisons use integer
 *      Money or integer counts."
 *   lines 117-119 (owning authority):
 *     "Risk/Compliance Authority (protocol layer, area 16) owns rule
 *      semantics, check lifecycle, and screening evaluation."
 *   line 145 (the rule set version's evidence role):
 *     "CHECK_DECIDED (subject, rule set version, outcome, reason code)."
 *   lines 133-134 (INV-16-4, the check-id keying that consumes the rule set
 *   version):
 *     "INV-16-4 (idempotency): check ids are keyed by (subject id,
 *      rule set version); re-evaluation returns the recorded result."
 *
 * Design:
 *   - The four states and exactly three transitions are materialized as a
 *     transition table; every other pair is rejected (conformance tests
 *     enumerate ALL pairs).
 *   - A rule version is one immutable object: while AUTHORED the definition
 *     may still be revised; publishing (AUTHORED -> VERSIONED) assigns the
 *     integer version and FREEZES the definition (the "immutable rule
 *     definition"); from VERSIONED on, revision is rejected.
 *   - The rule identity (ruleId) persists across versions: retiring one
 *     version is terminal for THAT version, and a new AUTHORED draft of the
 *     same ruleId starts the next version's own lifecycle.
 *   - Rule semantics are structured threshold predicates over the subject's
 *     integer facts — pure functions by construction (the stop condition
 *     "a rule semantics requirement that cannot be expressed as a pure
 *     function" therefore never triggers). The explicit evaluation
 *     signature is `RiskRuleEvaluation` / `evaluateRiskRule`.
 *   - The RULE SET VERSION is derived (pure sha256) over the exact member
 *     rule versions in canonical order — the "rule version" input of
 *     INV-16-1 and the "rule set version" of INV-16-4 / CHECK_DECIDED. A
 *     derived digest (no invented publishing lifecycle — the spec gives a
 *     state machine to RiskRule, not to rule sets) makes "identical rule
 *     versions => identical outcome" checkable and collision-free.
 */

import { createHash } from 'node:crypto';
import { deriveProtocolId } from '../kernel/identity.ts';
import type { SubjectComplianceData } from './subject.ts';

/**
 * The RiskRule state machine, verbatim from the spec.
 *
 * Source: evidence-risk-compliance.md §2 line 100 — "States: AUTHORED ->
 * VERSIONED -> ACTIVE -> RETIRED."
 */
export const RISK_RULE_STATES: readonly ['AUTHORED', 'VERSIONED', 'ACTIVE', 'RETIRED'] =
  Object.freeze(['AUTHORED', 'VERSIONED', 'ACTIVE', 'RETIRED'] as const);

/**
 * A RiskRule state. Source: evidence-risk-compliance.md §2 line 100.
 */
export type RiskRuleState = (typeof RISK_RULE_STATES)[number];

/**
 * The complete legal-transition table of the RiskRule state machine. Keys
 * are source states; values are the exhaustive legal targets.
 *
 * Source: evidence-risk-compliance.md §2 line 100 — "AUTHORED -> VERSIONED
 * -> ACTIVE -> RETIRED."
 */
export const RISK_RULE_TRANSITIONS: Readonly<Record<RiskRuleState, readonly RiskRuleState[]>> =
  Object.freeze({
    AUTHORED: Object.freeze(['VERSIONED'] as const),
    VERSIONED: Object.freeze(['ACTIVE'] as const),
    ACTIVE: Object.freeze(['RETIRED'] as const),
    RETIRED: Object.freeze([] as const),
  });

/**
 * Which fact a threshold rule compares: an integer Money fact (by currency)
 * or an integer count fact (by name).
 *
 * Source: INV-16-2 (evidence-risk-compliance.md lines 127-128) — "all
 * threshold comparisons use integer Money or integer counts."
 */
export type RuleFactReference =
  | { readonly factClass: 'MONEY'; readonly currency: string }
  | { readonly factClass: 'COUNT'; readonly name: string };

/**
 * The integer bound of a threshold rule: an integer Money amount (minor
 * units of a 3-letter currency) or an integer count.
 *
 * Source: INV-16-2 (evidence-risk-compliance.md lines 127-128); core.md §0
 * lines 11-12 (Money representation).
 */
export type RuleThresholdBound =
  | { readonly boundClass: 'MONEY'; readonly currency: string; readonly amountMinor: number }
  | { readonly boundClass: 'COUNT'; readonly count: number };

/**
 * The comparison operator of a threshold rule. Integer comparison only.
 *
 * Source: INV-16-2 (integer comparisons); INV-2-1's wording for the sibling
 * area (core.md line 116: "policy comparisons are integer comparisons") is
 * the family discipline this follows.
 */
export type RuleComparisonOperator = 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ';

/**
 * What a fired rule demands: DENY (auto-deny the check) or REVIEW (route
 * the check to MANUAL_REVIEW).
 *
 * Source: evidence-risk-compliance.md §2 lines 102-107 (the check's terminal
 * decisions a fired rule can drive) and lines 91-93 (the area's purpose:
 * "Compliance decisions block or allow progression").
 */
export type RuleBreachAction = 'DENY' | 'REVIEW';

/**
 * A risk rule definition: ONE structured threshold predicate over the
 * subject's integer facts. Immutable once the rule version is published.
 *
 * Source: evidence-risk-compliance.md §2 lines 98-99 — "versioned, immutable
 * rule definition with an explicit evaluation function signature"; INV-16-2
 * (integer thresholds).
 */
export interface RiskRuleDefinition {
  readonly kind: 'THRESHOLD';
  readonly fact: RuleFactReference;
  readonly operator: RuleComparisonOperator;
  readonly bound: RuleThresholdBound;
  readonly onBreach: RuleBreachAction;
}

/**
 * One immutable RiskRule version. `version` is 0 while AUTHORED (unassigned
 * draft) and a positive integer once VERSIONED (assigned at publish).
 *
 * Source: evidence-risk-compliance.md §2 lines 98-100 (the versioned,
 * immutable rule definition and its state machine).
 */
export interface RiskRuleRecord {
  readonly ruleId: string;
  readonly version: number;
  readonly state: RiskRuleState;
  readonly definition: RiskRuleDefinition;
}

/**
 * A deterministically derived rule set version: `rsv.v1.<sha256-hex>` —
 * the "rule version" input of INV-16-1 and the "rule set version" of
 * INV-16-4 and CHECK_DECIDED.
 *
 * Source: INV-16-1 (evidence-risk-compliance.md lines 124-126); INV-16-4
 * (lines 133-134); line 145 (CHECK_DECIDED's rule set version).
 */
export type RuleSetVersion = string & { readonly __riskRuleSetVersion: 'rule-set-version' };

/**
 * The verdict of one rule's evaluation against one subject.
 *
 * Source: evidence-risk-compliance.md §2 lines 98-99 (the rule's evaluation
 * function) + lines 104-107 (the check outcomes a fired rule drives).
 */
export type RiskRuleVerdict = 'NOT_FIRED' | 'DENY' | 'REVIEW';

/**
 * The outcome of a state-machine operation on a rule: either the next rule
 * record, or the deterministic rejection (illegal transition / constraint
 * violation) naming the attempted move.
 *
 * Source: evidence-risk-compliance.md §2 line 100 (the exact transition set
 * this result type enforces).
 */
export type RiskRuleTransitionResult =
  | { readonly ok: true; readonly rule: RiskRuleRecord }
  | { readonly ok: false; readonly from: RiskRuleState; readonly to: RiskRuleState; readonly problem: string };

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

function fail(message: string): never {
  throw new TypeError(message);
}

function assertInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number') {
    fail(`rule: ${label} must be a number (got ${typeof value})`);
  }
  if (!Number.isInteger(value)) {
    fail(`rule: ${label} must be an integer — floats are forbidden by INV-16-2 (got ${value})`);
  }
  if (!Number.isSafeInteger(value)) {
    fail(`rule: ${label} must be a safe integer (got ${value})`);
  }
}

/**
 * Runtime type guard: true iff the value is a RiskRuleState.
 *
 * Source: evidence-risk-compliance.md §2 line 100.
 */
export function isRiskRuleState(value: unknown): value is RiskRuleState {
  return typeof value === 'string' && (RISK_RULE_STATES as readonly string[]).includes(value);
}

/**
 * The transition predicate of the RiskRule state machine: true iff from -> to
 * is legal.
 *
 * Source: evidence-risk-compliance.md §2 line 100 — "States: AUTHORED ->
 * VERSIONED -> ACTIVE -> RETIRED."
 */
export function canTransitionRiskRule(from: RiskRuleState, to: RiskRuleState): boolean {
  return RISK_RULE_TRANSITIONS[from].includes(to);
}

/**
 * Author a new rule version: an AUTHORED draft with the given definition.
 * The version is 0 (unassigned); it is assigned at publish.
 *
 * Source: evidence-risk-compliance.md §2 lines 98-100 (AUTHORED is the first
 * state of the rule lifecycle).
 */
export function authorRiskRule(ruleId: string, definition: RiskRuleDefinition): RiskRuleRecord {
  if (typeof ruleId !== 'string' || ruleId.length === 0) {
    fail('rule: ruleId must be a non-empty string');
  }
  validateRiskRuleDefinition(definition);
  return { ruleId, version: 0, state: 'AUTHORED', definition };
}

/**
 * Revise the definition of an AUTHORED draft. Rejected once the rule version
 * is published — "immutable rule definition" (VERSIONED and later).
 *
 * Source: evidence-risk-compliance.md §2 lines 98-99 — "versioned, immutable
 * rule definition".
 */
export function reviseRiskRuleDefinition(
  rule: RiskRuleRecord,
  definition: RiskRuleDefinition,
): RiskRuleTransitionResult {
  validateRiskRuleDefinition(definition);
  if (rule.state !== 'AUTHORED') {
    return {
      ok: false,
      from: rule.state,
      to: rule.state,
      problem: `rule ${rule.ruleId} v${rule.version} is ${rule.state}: the definition is immutable (only AUTHORED drafts can be revised)`,
    };
  }
  return { ok: true, rule: { ...rule, definition } };
}

/**
 * Publish an AUTHORED draft as an immutable versioned rule (AUTHORED ->
 * VERSIONED). The integer version (>= 1) is assigned by the caller — the
 * owning authority's registry assigns versions (the store helper
 * nextRiskRuleVersion derives it deterministically from recorded versions).
 *
 * Source: evidence-risk-compliance.md §2 line 100 — "AUTHORED -> VERSIONED";
 * lines 98-99 — "versioned, immutable rule definition".
 */
export function publishRiskRuleVersion(
  rule: RiskRuleRecord,
  version: number,
): RiskRuleTransitionResult {
  if (!isRiskRuleState(rule.state)) {
    fail(`rule: unknown state ${JSON.stringify(rule.state)}`);
  }
  if (!canTransitionRiskRule(rule.state, 'VERSIONED')) {
    return {
      ok: false,
      from: rule.state,
      to: 'VERSIONED',
      problem: `illegal RiskRule transition ${rule.state} -> VERSIONED (legal: AUTHORED -> VERSIONED -> ACTIVE -> RETIRED)`,
    };
  }
  assertInteger(version, 'published rule version');
  if (version < 1) {
    fail(`rule: published rule version must be >= 1 (got ${version}; 0 is reserved for AUTHORED drafts)`);
  }
  return { ok: true, rule: { ...rule, version, state: 'VERSIONED' } };
}

/**
 * Activate a VERSIONED rule (VERSIONED -> ACTIVE). Only ACTIVE rules are
 * resolved into the live evaluation rule set (see evaluation.ts).
 *
 * Source: evidence-risk-compliance.md §2 line 100 — "VERSIONED -> ACTIVE".
 */
export function activateRiskRule(rule: RiskRuleRecord): RiskRuleTransitionResult {
  if (!canTransitionRiskRule(rule.state, 'ACTIVE')) {
    return {
      ok: false,
      from: rule.state,
      to: 'ACTIVE',
      problem: `illegal RiskRule transition ${rule.state} -> ACTIVE (legal: AUTHORED -> VERSIONED -> ACTIVE -> RETIRED)`,
    };
  }
  return { ok: true, rule: { ...rule, state: 'ACTIVE' } };
}

/**
 * Retire an ACTIVE rule (ACTIVE -> RETIRED). Terminal for that rule version.
 *
 * Source: evidence-risk-compliance.md §2 line 100 — "ACTIVE -> RETIRED".
 */
export function retireRiskRule(rule: RiskRuleRecord): RiskRuleTransitionResult {
  if (!canTransitionRiskRule(rule.state, 'RETIRED')) {
    return {
      ok: false,
      from: rule.state,
      to: 'RETIRED',
      problem: `illegal RiskRule transition ${rule.state} -> RETIRED (legal: AUTHORED -> VERSIONED -> ACTIVE -> RETIRED)`,
    };
  }
  return { ok: true, rule: { ...rule, state: 'RETIRED' } };
}

/**
 * Validate a rule definition (deterministic TypeError on violation): the
 * threshold's fact class and bound class must agree (MONEY fact <-> MONEY
 * bound with the same 3-letter currency; COUNT fact <-> COUNT bound), and
 * every numeric bound must be an integer (INV-16-2).
 *
 * Source: INV-16-2 (evidence-risk-compliance.md lines 127-128); core.md §0
 * lines 11-12 (Money shape).
 */
export function validateRiskRuleDefinition(definition: RiskRuleDefinition): void {
  if (definition === null || typeof definition !== 'object') {
    fail('rule: definition must be an object');
  }
  if (definition.kind !== 'THRESHOLD') {
    fail(`rule: definition kind must be 'THRESHOLD' (got ${JSON.stringify(definition.kind)})`);
  }
  const { fact, bound, operator, onBreach } = definition;
  if (fact === null || typeof fact !== 'object') {
    fail('rule: fact must be an object');
  }
  if (bound === null || typeof bound !== 'object') {
    fail('rule: bound must be an object');
  }
  if (fact.factClass === 'MONEY') {
    if (typeof fact.currency !== 'string' || !CURRENCY_CODE_PATTERN.test(fact.currency)) {
      fail(`rule: MONEY fact currency must be exactly 3 uppercase letters (got ${JSON.stringify(fact.currency)})`);
    }
    if (bound.boundClass !== 'MONEY') {
      fail(`rule: a MONEY fact requires a MONEY bound (got ${JSON.stringify(bound.boundClass)})`);
    }
    if (bound.currency !== fact.currency) {
      fail(`rule: bound currency ${JSON.stringify(bound.currency)} must match fact currency ${JSON.stringify(fact.currency)}`);
    }
    assertInteger(bound.amountMinor, 'MONEY bound amountMinor');
  } else if (fact.factClass === 'COUNT') {
    if (typeof fact.name !== 'string' || fact.name.length === 0) {
      fail(`rule: COUNT fact name must be a non-empty string (got ${JSON.stringify(fact.name)})`);
    }
    if (bound.boundClass !== 'COUNT') {
      fail(`rule: a COUNT fact requires a COUNT bound (got ${JSON.stringify(bound.boundClass)})`);
    }
    assertInteger(bound.count, 'COUNT bound count');
  } else {
    fail(`rule: fact class must be 'MONEY' or 'COUNT' (got ${String(fact)})`);
  }
  const operators: readonly string[] = ['GT', 'GTE', 'LT', 'LTE', 'EQ'];
  if (!operators.includes(operator)) {
    fail(`rule: operator must be one of GT, GTE, LT, LTE, EQ (got ${JSON.stringify(operator)})`);
  }
  if (onBreach !== 'DENY' && onBreach !== 'REVIEW') {
    fail(`rule: onBreach must be 'DENY' or 'REVIEW' (got ${JSON.stringify(onBreach)})`);
  }
}

/**
 * The explicit evaluation function signature of a risk rule (the spec's
 * "explicit evaluation function signature"): a pure function from the
 * subject data to the rule's verdict.
 *
 * Source: evidence-risk-compliance.md §2 lines 98-99 — "versioned, immutable
 * rule definition with an explicit evaluation function signature."
 */
export type RiskRuleEvaluation = (subject: SubjectComplianceData) => RiskRuleVerdict;

function factValue(rule: RiskRuleDefinition, subject: SubjectComplianceData): number | undefined {
  if (rule.fact.factClass === 'MONEY') {
    for (const fact of subject.moneyFacts) {
      if (fact.currency === rule.fact.currency) {
        return fact.amountMinor;
      }
    }
    return undefined;
  }
  for (const fact of subject.countFacts) {
    if (fact.name === rule.fact.name) {
      return fact.count;
    }
  }
  return undefined;
}

function boundValue(bound: RuleThresholdBound): number {
  return bound.boundClass === 'MONEY' ? bound.amountMinor : bound.count;
}

function compareIntegers(left: number, right: number, operator: RuleComparisonOperator): boolean {
  switch (operator) {
    case 'GT':
      return left > right;
    case 'GTE':
      return left >= right;
    case 'LT':
      return left < right;
    case 'LTE':
      return left <= right;
    case 'EQ':
      return left === right;
  }
}

/**
 * The evaluation function of one rule version: a PURE function of (rule
 * definition, subject data). A rule referencing a fact the subject lacks
 * does not fire (deterministically NOT_FIRED). A firing rule's verdict is
 * its onBreach action.
 *
 * Source: evidence-risk-compliance.md §2 lines 98-99 (the evaluation
 * signature); INV-16-1 (lines 124-126 — evaluation is pure); INV-16-2
 * (lines 127-128 — the comparison is integer-only).
 */
export function evaluateRiskRule(rule: RiskRuleRecord, subject: SubjectComplianceData): RiskRuleVerdict {
  validateRiskRuleDefinition(rule.definition);
  const value = factValue(rule.definition, subject);
  if (value === undefined) {
    return 'NOT_FIRED';
  }
  const bound = boundValue(rule.definition.bound);
  return compareIntegers(value, bound, rule.definition.operator)
    ? rule.definition.onBreach
    : 'NOT_FIRED';
}

/**
 * Version of the rule-set-version derivation format. Bump on any change to
 * the canonical encoding; derived values carry the version in their prefix.
 *
 * Source: INV-16-1 (the "rule version" input must be stable and comparable).
 */
export const RULE_SET_VERSION_FORMAT_VERSION = 1;

/**
 * Derive the rule set version: a pure sha256 digest over the exact member
 * rule versions in canonical (ruleId, version) order — `rsv.v1.<hex>`.
 * Identical member sets always derive the identical version; any member
 * difference derives a different version. This is the "rule version" input
 * of INV-16-1's pure evaluation and the "rule set version" keyed by INV-16-4
 * and recorded by CHECK_DECIDED.
 *
 * Source: INV-16-1 (evidence-risk-compliance.md lines 124-126); INV-16-4
 * (lines 133-134); line 145 (CHECK_DECIDED's field).
 */
export function deriveRuleSetVersion(rules: readonly RiskRuleRecord[]): RuleSetVersion {
  const published = rules.map((rule) => {
    if (!isRiskRuleState(rule.state)) {
      fail(`rule: unknown state ${JSON.stringify(rule.state)}`);
    }
    if (rule.state === 'AUTHORED') {
      fail(`rule: ${rule.ruleId} is AUTHORED (no version assigned) — only published rule versions can enter a rule set`);
    }
    return [rule.ruleId, rule.version] as const;
  });
  published.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  const encoding = published.map(([id, version]) => `r:${id.length}:${id}@v${version}`).join('|');
  const hex = createHash('sha256')
    .update(`v${RULE_SET_VERSION_FORMAT_VERSION}|${encoding}`, 'utf8')
    .digest('hex');
  return `rsv.v${RULE_SET_VERSION_FORMAT_VERSION}.${hex}` as RuleSetVersion;
}

/**
 * A pinned rule set: the exact rule versions under which evaluations run,
 * together with their derived rule set version.
 *
 * Source: INV-16-1 (the "rule version" evaluation input); INV-16-4 (the
 * "(subject id, rule set version)" check-id keying).
 */
export interface VersionedRuleSet {
  readonly ruleSetVersion: RuleSetVersion;
  readonly rules: readonly RiskRuleRecord[];
}

/**
 * Assemble a pinned rule set from published rule versions (VERSIONED,
 * ACTIVE, or RETIRED — each has its immutable integer version; the live
 * evaluation path resolves ACTIVE rules, but a pinned set may reference any
 * published version, e.g. for deterministic re-evaluation of a historical
 * set). AUTHORED drafts are rejected: they have no version and no frozen
 * definition.
 *
 * Source: evidence-risk-compliance.md §2 lines 98-100 (versioned, immutable
 * rule definitions); INV-16-1 (evaluation pinned to the rule version).
 */
export function assembleRuleSet(rules: readonly RiskRuleRecord[]): VersionedRuleSet {
  const canonical = [...rules].sort((a, b) =>
    a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : a.version - b.version,
  );
  return { ruleSetVersion: deriveRuleSetVersion(canonical), rules: canonical };
}

/**
 * The check id of a compliance check: derived by the kernel's identity
 * facility from the exact INV-16-4 keying pair (subject id, rule set
 * version). Identical pairs always derive the identical check id.
 *
 * Source: INV-16-4 (evidence-risk-compliance.md lines 133-134) — "check ids
 * are keyed by (subject id, rule set version)".
 */
export function deriveComplianceCheckId(subjectId: string, ruleSetVersion: RuleSetVersion): string {
  return deriveProtocolId('compliance-check', subjectId, ruleSetVersion);
}
