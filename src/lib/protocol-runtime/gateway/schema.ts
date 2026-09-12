/**
 * RTN-010 — Protocol gateway: the command-body schema language.
 *
 * The admission surface validates each command's body against the OWNING
 * authority's command schema (rtn-plan-rulings.md Q4/delta 4: "its
 * admission surface validates command schemas (including subject ids) per
 * owning authority"). This module is the tiny, deterministic schema
 * language those per-command schemas are written in:
 *
 *   - a FieldCheck is a pure function `unknown -> true | FieldProblem`
 *     (never throws, never mutates; the same value always yields the same
 *     outcome — GC-1's determinism discipline applied to validation);
 *   - a FieldSpec is either a required FieldCheck or an `optional(...)`
 *     wrapper (absent allowed, present must validate);
 *   - `validateCommandBody` walks a declared field map over a plain JSON
 *     body and returns the FIRST failing field as a dotted path with a
 *     deterministic problem string (field order is the declaration order —
 *     rejections are stable and reproducible);
 *   - complex authority-owned records are validated by the authorities'
 *     OWN exported validators, wrapped with `mintedBy` (the mint IS the
 *     schema — single source of truth, no drift) or composed structurally
 *     with `recordField` where no public mint exists.
 *
 * Spec sources (binding):
 *   spec/protocol-runtime-work-orders/RTN-010.md line 10: "command
 *     validation against each authority's command schema"
 *   spec/protocol-runtime-work-orders/RTN-010.md line 14: "Every authority
 *     command kind is admitted or rejected with a deterministic reason
 *     code"
 *   spec/development-state/rtn-plan-rulings.md Q4 scope impact (line 85):
 *     "RTN-010 implements no identity or market authority — its admission
 *     surface validates command schemas (including subject ids) per owning
 *     authority and rejects with deterministic reason codes."
 *   spec/architecture/v0.1/README.md §3 GC-1 lines 39-43 ("Re-running any
 *     computation on identical inputs yields identical outputs").
 *
 * Admission strictness (recorded interpretation, see CONTRACT-REVIEW.md):
 *   the gateway is STRICTER than the authorities' own entry checks, never
 *   looser: bodies must carry exactly the declared fields (a typo'd extra
 *     field is a malformed command, not a silently-ignored one), every
 *     declared field must pass its check, and cross-field invariants (e.g.
 *     queues' `terms.intentId` must equal `intentId`) are enforced at
 *     admission. The ONE deliberate exception is the clearing record's
 *     `amount`: the Clearing Authority defers amount validation to its
 *     stage-time QUARANTINE flow (CLEARING_REASON_CODES INVALID_MONEY_*,
 *     ZERO_AMOUNT, SELF_PARTY — a domain semantic admission must not
 *     preempt), so `clearing.record.add` does not shape-check `amount`
 *     (documented on that command's spec row).
 */

import { isMoney } from '../kernel/money.ts';
import { isProtocolTime } from '../kernel/time.ts';

/**
 * One field problem: the dotted path RELATIVE to the checked field (empty
 * for the field itself, nested for record fields) plus the deterministic
 * problem description.
 *
 * Source: RTN-010.md line 14 (deterministic reason codes); GC-1.
 */
export interface FieldProblem {
  readonly path: string;
  readonly problem: string;
}

/**
 * A field check: pure, total, deterministic. Returns `true` when the value
 * conforms; otherwise the problem (with the path relative to the field).
 *
 * Source: RTN-010.md lines 10, 14; GC-1.
 */
export type FieldCheck = (value: unknown) => true | FieldProblem;

/**
 * A field specification in a command body's declared field map: a required
 * FieldCheck, or an optional one (absent allowed).
 *
 * Source: RTN-010.md line 10 (per-authority command schemas).
 */
export type FieldSpec = FieldCheck | OptionalField;

/**
 * The optional wrapper: the field may be absent (undefined); when present
 * it must pass the wrapped check. A present `null` FAILS the wrapped check
 * (null is a value, not an absence).
 *
 * Source: RTN-010.md line 10; the authorities' optional-parameter contracts
 * (e.g. core.md line 40's optional fields; `reasonCode?: IntentReasonCode`).
 */
export interface OptionalField {
  readonly specKind: 'optional';
  readonly check: FieldCheck;
}

/**
 * Mark a field optional (absent allowed; present must validate).
 *
 * Source: RTN-010.md line 10 (per-command schemas mirroring the
 * authorities' optional parameters).
 */
export function optional(check: FieldCheck): OptionalField {
  return { specKind: 'optional', check };
}

/**
 * A whole-body invariant: a pure cross-field rule applied after every
 * declared field passes (e.g. queues' `terms.intentId === intentId`).
 *
 * Source: RTN-010.md line 10 (the authorities' cross-field entry checks,
 * e.g. queues/authority.ts enqueueItem INV-8-1 terms linkage).
 */
export type BodyInvariant = (body: Record<string, unknown>) => true | FieldProblem;

/**
 * The outcome of validating one command body: either the validated plain
 * body, or the first failing field's dotted path with its deterministic
 * problem.
 *
 * Source: RTN-010.md line 14 (deterministic rejections).
 */
export type BodyValidation =
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly field: string; readonly problem: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function problem(path: string, text: string): FieldProblem {
  return { path, problem: text };
}

function joinPath(field: string, relative: string): string {
  return relative.length === 0 ? field : `${field}.${relative}`;
}

/**
 * Validate a plain JSON body against a declared field map (plus optional
 * whole-body invariants). Deterministic: fields are checked in declaration
 * order and the FIRST failure is reported; a body that is not a plain
 * object fails at the body root; an undeclared extra field fails at that
 * field (the gateway is stricter than the authorities' own mints — see the
 * module doc).
 *
 * Source: RTN-010.md lines 10, 14; GC-1.
 */
export function validateCommandBody(
  value: unknown,
  fields: Readonly<Record<string, FieldSpec>>,
  invariants: readonly BodyInvariant[] = [],
): BodyValidation {
  if (!isPlainObject(value)) {
    return { ok: false, field: '', problem: 'body must be a plain object' };
  }
  for (const name of Object.keys(fields)) {
    const spec = fields[name];
    if (value[name] === undefined) {
      if (typeof spec === 'object' && spec !== null && 'specKind' in spec && spec.specKind === 'optional') {
        continue;
      }
      return { ok: false, field: name, problem: 'is required' };
    }
    const check: FieldCheck =
      typeof spec === 'object' && spec !== null && 'specKind' in spec && spec.specKind === 'optional'
        ? (spec as OptionalField).check
        : (spec as FieldCheck);
    const outcome = check(value[name]);
    if (outcome !== true) {
      return { ok: false, field: joinPath(name, outcome.path), problem: outcome.problem };
    }
  }
  for (const key of Object.keys(value)) {
    if (!(key in fields)) {
      return { ok: false, field: key, problem: 'is not a declared field of this command' };
    }
  }
  for (const invariant of invariants) {
    const outcome = invariant(value);
    if (outcome !== true) {
      return { ok: false, field: outcome.path, problem: outcome.problem };
    }
  }
  return { ok: true, body: value };
}

// ---------------------------------------------------------------------------
// Primitive checks (each mirrors a rule the merged authorities enforce at
// their own command boundaries — cited per check)
// ---------------------------------------------------------------------------

/**
 * A non-empty string (the universal id/label/reference rule — every
 * authority command TypeErrors on empty ids: e.g. intent/authority.ts
 * "intentId must be a non-empty string").
 *
 * Source: the merged command convention (input-shape violations throw —
 * the gateway mirrors the same shapes as typed admission rejections);
 * RTN-010.md line 10.
 */
export function nonEmptyString(value: unknown): true | FieldProblem {
  return typeof value === 'string' && value.length > 0
    ? true
    : problem('', 'must be a non-empty string');
}

/**
 * Any string, including empty (for genuinely free-form optional text the
 * authorities do not constrain — e.g. settlement's `memo?: string`:
 * "memo, when present, must be a string", settlement/authority.ts).
 *
 * Source: settlement/authority.ts createSettlementInstruction (the memo
 * contract); RTN-010.md line 10.
 */
export function plainString(value: unknown): true | FieldProblem {
  return typeof value === 'string' ? true : problem('', 'must be a string');
}

/**
 * A 3-letter uppercase currency code (kernel Money's currency rule —
 * "3-letter currency code", core.md §0 line 11).
 *
 * Source: core.md §0 line 11 (GC-1); kernel isMoney; the liquidity
 * openPool currency check.
 */
export function currencyCode(value: unknown): true | FieldProblem {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value)
    ? true
    : problem('', 'must be exactly 3 uppercase letters (a currency code, GC-1)');
}

/**
 * A well-formed kernel Money value (integer minor units, 3-letter currency,
 * non-negative safe-integer scale — core.md §0 line 11, GC-1).
 *
 * Source: core.md §0 lines 11-12; kernel/money.ts isMoney (the single
 * source of truth this check delegates to).
 */
export function moneyValue(value: unknown): true | FieldProblem {
  return isMoney(value) ? true : problem('', 'must be a well-formed Money value (integer minor units, GC-1)');
}

/**
 * A Money value with strictly positive minor units (the authorities'
 * "a demand for zero or negative value is not a demand" rule — intent
 * descriptor amount; liquidity funding amount; credit limit).
 *
 * Source: intent/descriptor.ts demandDescriptor (amount must be positive);
 * liquidity/authority.ts recordConfirmedFunding; credit/authority.ts
 * offerLine; GC-1.
 */
export function positiveMoney(value: unknown): true | FieldProblem {
  if (!isMoney(value)) {
    return problem('', 'must be a well-formed Money value (integer minor units, GC-1)');
  }
  return value.amountMinor > 0 ? true : problem('', 'must be positive minor units');
}

/**
 * A Money value with non-negative minor units (the declare/hold rules that
 * admit zero — reservations declareTotal/request amount; capability
 * declaredCapacity; queues fixed terms).
 *
 * Source: reservations/ledger.ts declareResource/requestReservation;
 * capability/authority.ts registerCapability; queues/authority.ts
 * enqueueItem; GC-1.
 */
export function nonNegativeMoney(value: unknown): true | FieldProblem {
  if (!isMoney(value)) {
    return problem('', 'must be a well-formed Money value (integer minor units, GC-1)');
  }
  return value.amountMinor >= 0 ? true : problem('', 'must be non-negative minor units');
}

/**
 * A safe integer (deadlines, wall times, scales, sequence positions —
 * "No floating point anywhere (GC-1)").
 *
 * Source: core.md §0 line 12 (GC-1); the authorities' integer entry checks
 * (deadlineEpochMs, wallMs, priorityClass, ...).
 */
export function safeInteger(value: unknown): true | FieldProblem {
  return typeof value === 'number' && Number.isInteger(value) && Number.isSafeInteger(value)
    ? true
    : problem('', 'must be a safe integer (GC-1)');
}

/**
 * A positive integer (>= 1) — policy versions, screening list versions.
 *
 * Source: policy/authority.ts attachPolicy (version must be integer >= 1);
 * risk/screening.ts createScreeningList; GC-1.
 */
export function positiveInteger(value: unknown): true | FieldProblem {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && Number.isSafeInteger(value)
    ? true
    : problem('', 'must be an integer >= 1');
}

/**
 * A non-negative integer (>= 0) — priority classes, currency scales.
 *
 * Source: queues/authority.ts enqueueItem (priorityClass must be a
 * non-negative integer); liquidity/authority.ts openPool (scale
 * non-negative integer); GC-1.
 */
export function nonNegativeInteger(value: unknown): true | FieldProblem {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && Number.isSafeInteger(value)
    ? true
    : problem('', 'must be an integer >= 0');
}

/**
 * A well-formed ProtocolTime (the envelope's own time rule — kernel
 * isProtocolTime, the single source of truth this check delegates to).
 *
 * Source: kernel/time.ts isProtocolTime; envelope.ts
 * validateCommandEnvelope.
 */
export function protocolTimeValue(value: unknown): true | FieldProblem {
  return isProtocolTime(value)
    ? true
    : problem('', 'must be a well-formed ProtocolTime (non-negative integer sequence, integer wallMs)');
}

// ---------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------

/**
 * Wrap an exported boolean guard (isIntentReasonCode, isFundingSourceKind,
 * ...) as a FieldCheck.
 *
 * Source: RTN-010.md line 10 (validation against the authorities' exported
 * schemas/guards).
 */
export function guardOf(
  guard: (value: unknown) => boolean,
  description: string,
): FieldCheck {
  return (value) => (guard(value) ? true : problem('', description));
}

/**
 * A closed string-literal field (a frozen vocabulary the authority itself
 * checks by membership — e.g. queues cancelItem's two-code subset,
 * routing's resolvedOutcome).
 *
 * Source: queues/authority.ts cancelItem; routing/authority.ts
 * resolveUnknownHop; RTN-010.md line 10.
 */
export function oneOfLiterals(values: readonly string[], description: string): FieldCheck {
  return (value) =>
    typeof value === 'string' && (values as readonly string[]).includes(value)
      ? true
      : problem('', `must be ${description}`);
}

/**
 * An array field whose every element passes the item check.
 *
 * Source: RTN-010.md line 10 (the authorities' array entry rules — e.g.
 * obligations replacementObligationIds, netting inputObligationIds).
 */
export function arrayOf(itemCheck: FieldCheck, label: string): FieldCheck {
  return (value) => {
    if (!Array.isArray(value)) {
      return problem('', `must be an array of ${label}`);
    }
    for (let index = 0; index < value.length; index += 1) {
      const outcome = itemCheck(value[index]);
      if (outcome !== true) {
        return problem(`[${index}]${outcome.path.length === 0 ? '' : `.${outcome.path}`}`, outcome.problem);
      }
    }
    return true;
  };
}

/**
 * A nested record field: the value must be a plain object carrying exactly
 * the declared sub-fields (same strictness rules as the body root).
 *
 * Source: RTN-010.md line 10 (the authorities' nested input shapes —
 * e.g. the demand descriptor's source/destination endpoints, the clearing
 * record's origin/parties).
 */
export function recordField(
  fields: Readonly<Record<string, FieldSpec>>,
  label: string,
): FieldCheck {
  return (value) => {
    const validation = validateCommandBody(value, fields);
    if (validation.ok) {
      return true;
    }
    return problem(validation.field, validation.problem || `${label} must be an object`);
  };
}

/**
 * Wrap an authority's exported minting validator (demandDescriptor,
 * fulfillmentPolicyDefinition, validateRiskRuleDefinition,
 * validateRailOperationPayload, mintNettingScope, subjectComplianceData,
 * canonicalConversionSchedule) as a FieldCheck: the mint IS the authority's
 * schema — calling it validates exactly what the authority's own command
 * boundary validates (single source of truth; no drift). The mint's
 * deterministic TypeError message becomes the problem string. The mint's
 * return value is DISCARDED: admission validates, it never canonicalizes
 * (the submitted body travels the durable path verbatim; the transition
 * path re-validates with the same mints — defense in depth).
 *
 * Source: RTN-010.md line 10 ("command validation against each authority's
 * command schema" — the mints are that schema's executable form).
 */
export function mintedBy(mint: (input: never) => unknown, label: string): FieldCheck {
  return (value) => {
    try {
      mint(value as never);
      return true;
    } catch (error) {
      const message = error instanceof Error && typeof error.message === 'string' ? error.message : String(error);
      return problem('', `${label} failed the owning authority's validator: ${message}`);
    }
  };
}
