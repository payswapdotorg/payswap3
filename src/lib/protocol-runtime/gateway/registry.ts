/**
 * RTN-010 — Protocol gateway: the per-authority command-kind registry.
 *
 * THE REGISTRY is the admission surface's map of every merged authority's
 * command kinds to their validation schemas — "command validation against
 * each authority's command schema" (RTN-010.md line 10) made executable.
 * The kernel deliberately left this seam unoccupied (kernel/envelope.ts:
 * "the authority-name enumeration belongs to the registry projection ...
 * and its consumers (RTN-002 binds evidence authority names; RTN-010
 * validates per-command per owning authority)"); this module occupies it
 * and nothing else does.
 *
 * Spec sources (binding):
 *   spec/protocol-runtime-work-orders/RTN-010.md line 10: "command
 *     validation against each authority's command schema"
 *   spec/protocol-runtime-work-orders/RTN-010.md line 14: "Every authority
 *     command kind is admitted or rejected with a deterministic reason
 *     code"
 *   spec/development-state/rtn-plan-rulings.md Q4 (lines 74, 85): the
 *     gateway "implements no identity or market authority — its admission
 *     surface validates command schemas (including subject ids) per owning
 *     authority and rejects with deterministic reason codes."
 *   spec/registry/protocol-registry.json (the authority-name projection
 *     the envelope's authority vocabulary keys on — kernel/envelope.ts)
 *   spec/deployment/topology.md line 231: "There is exactly one
 *     protocol-command admission point (protocol-gateway)" — this registry
 *     is that point's command catalogue.
 *
 * Kind naming (recorded convention): every kind is lowercase
 * dot-separated segments matching the kernel envelope's KIND_PATTERN
 * (`area.verb`, e.g. `intent.create` — kernel/envelope.ts): the first
 * segment is the authority's domain; object-scoped operations continue
 * with the object noun (`capability.commitment.offer`); the final segment
 * is the verb. Every kind maps 1:1 onto exactly one public command method
 * of exactly one merged authority class (the mapping is each spec's
 * `description` and is tabulated in COMMAND-SURFACE.md for the UI-011
 * product-port re-anchoring ledger item — rtn-plan-rulings.md Q5/delta 6).
 *
 * Validation sources (recorded convention): each field's check mirrors the
 * OWNING AUTHORITY's own entry validation for that parameter — the
 * authority's exported guard, the authority's exported minting validator
 * (via mintedBy — the mint IS the schema), or a structural composition of
 * the authority's exported type where no public validator exists. The
 * gateway is STRICTER than the authorities, never looser (unknown body
 * fields are rejected; cross-field invariants the authorities enforce are
 * enforced here too). The ONE deliberate exception: clearing.record.add's
 * `amount` is deliberately NOT shape-checked — the Clearing Authority
 * defers amount validation to its stage-time QUARANTINE flow (a domain
 * semantic admission must not preempt; see that command's row).
 *
 * Authority vocabulary (recorded interpretation): the envelope's
 * `authority` slot carries the authority ids the MERGED MODULES export
 * (INTENT_AUTHORITY_ID, ..., RAIL_ADAPTER_AUTHORITY_ID,
 * RECONCILIATION_AUTHORITY_ID, RISK_AUTHORITY_ID) — plus 'Rail Authority',
 * the REGISTRY's A13 owning-authority name (spec/registry/
 * protocol-registry.json A13), accepted as an envelope alias for the rail
 * adapter command surface. The evidence-authority mapping normalizes the
 * rails module's 'Rail Adapter Authority' label to the registry name
 * 'Rail Authority' for A15 attribution (EVIDENCE_AUTHORITIES contains the
 * registry name; the module constant does not — recorded as a known
 * limitation for RTN-012's composed integration, see CONTRACT-REVIEW.md).
 *
 * NOT in the registry (documented, with grounds):
 *   - The kernel hosts no authority and has no command surface
 *     (kernel/kernel.ts: "The kernel hosts NO financial authority"); there
 *     are no kernel commands to admit.
 *   - The Evidence Authority's log is written synchronously through the
 *     kernel-declared EvidenceSubmission port by every authority
 *     (writers-by-submission — evidence-risk-compliance.md lines 41-43);
 *     it exposes no protocol command surface on the durable command path,
 *     so no evidence command kinds exist. (An envelope addressed to
 *     'Evidence Authority' is rejected with AUTHORITY_UNKNOWN and a
 *     recorded rejection.)
 *   - Areas A17-A24 are RTN wave 2 (spec/protocol-runtime-work-orders/
 *     README.md "RTN wave 2"): no runtime surfaces exist; envelopes
 *     addressed to those registry authorities are rejected with
 *     AUTHORITY_UNKNOWN and recorded evidence.
 */

import {
  arrayOf,
  currencyCode,
  guardOf,
  mintedBy,
  moneyValue,
  nonEmptyString,
  nonNegativeInteger,
  nonNegativeMoney,
  oneOfLiterals,
  optional,
  plainString,
  positiveInteger,
  positiveMoney,
  protocolTimeValue,
  recordField,
  safeInteger,
} from './schema.ts';
import type { FieldCheck, FieldProblem, FieldSpec } from './schema.ts';

import { demandDescriptor } from '../intent/descriptor.ts';
import { INTENT_AUTHORITY_ID } from '../intent/evidence.ts';
import { isIntentReasonCode } from '../intent/types.ts';

import { fulfillmentPolicyDefinition } from '../policy/evaluation.ts';
import { POLICY_AUTHORITY_ID } from '../policy/evidence.ts';

import { CAPABILITY_AUTHORITY_ID } from '../capability/evidence.ts';
import { isCapabilityState } from '../capability/types.ts';

import { canonicalConversionSchedule } from '../routing/compiler.ts';
import { ROUTING_AUTHORITY_ID } from '../routing/evidence.ts';
import { isRoutePlanReasonCode } from '../routing/types.ts';

import { RESERVATION_AUTHORITY_ID } from '../reservations/evidence.ts';

import { LIQUIDITY_AUTHORITY_ID } from '../liquidity/evidence.ts';
import { isFundingSourceKind, isPendingFundingResolution } from '../liquidity/types.ts';

import { CREDIT_AUTHORITY_ID } from '../credit/evidence.ts';

import { QUEUE_AUTHORITY_ID } from '../queues/evidence.ts';
import { isDispatchResolution } from '../queues/types.ts';

import { CLEARING_AUTHORITY_ID } from '../clearing/evidence.ts';
import { isClearingOriginKind } from '../clearing/types.ts';

import { OBLIGATION_AUTHORITY_ID } from '../obligations/evidence.ts';

import { NETTING_AUTHORITY_ID } from '../netting/evidence.ts';
import { mintNettingScope } from '../netting/state-machine.ts';

import { SETTLEMENT_AUTHORITY_ID } from '../settlement/evidence.ts';

import { RAIL_ADAPTER_AUTHORITY_ID } from '../rails/authority.ts';
import { RECONCILIATION_AUTHORITY_ID } from '../rails/reconciliation.ts';
import { validateRailOperationPayload } from '../rails/payload.ts';
import { isRailReportClass } from '../rails/types.ts';

import { RISK_AUTHORITY_ID } from '../risk/evidence.ts';
import { subjectComplianceData } from '../risk/subject.ts';
import { validateRiskRuleDefinition } from '../risk/rule.ts';

// ---------------------------------------------------------------------------
// Subject bindings
// ---------------------------------------------------------------------------

/**
 * The subject resolution: the subject object ids a command addresses,
 * derived from its (already body-validated) body, or the body problem that
 * prevented the derivation. The gateway checks the envelope's subjectIds
 * against the resolved list — positionally equal.
 *
 * Source: kernel/envelope.ts CommandEnvelope ("subjectIds — the subject
 * object ids this command addresses"); A15 line 27 ("what: operation type
 * and subject object ids"); rtn-plan-rulings.md Q4 (subject ids validated
 * per owning authority).
 */
export type SubjectResolution =
  | { readonly ok: true; readonly subjectIds: readonly string[] }
  | { readonly ok: false; readonly path: string; readonly problem: string };

/**
 * The subject resolver function type: derives the subject ids from the
 * validated body.
 *
 * Source: kernel/envelope.ts (subjectIds); per-authority command shapes.
 */
export type SubjectResolver = (body: Record<string, unknown>) => SubjectResolution;

/**
 * Resolve subjects from named body fields (the common case: the command's
 * primary subject ids are body fields).
 *
 * Source: kernel/envelope.ts (subjectIds); per-authority command shapes.
 */
export function subjectFields(...fields: readonly string[]): SubjectResolver {
  return (body) => {
    const ids: string[] = [];
    for (const field of fields) {
      const value = body[field];
      if (typeof value !== 'string' || value.length === 0) {
        return {
          ok: false as const,
          path: field,
          problem: 'the command addresses this subject object; the body field must be a non-empty string',
        };
      }
      ids.push(value);
    }
    return { ok: true as const, subjectIds: ids };
  };
}

/**
 * No subject objects (commands that create their subject — e.g. intent
 * submission, whose intent id is derived from the idempotency key — or
 * scheduler-tick sweeps that address no prior object; kernel/envelope.ts:
 * "may be empty: e.g. scheduler tick commands address no prior subject
 * object").
 *
 * Source: kernel/envelope.ts (empty subjectIds allowed).
 */
export const noSubjects: SubjectResolver = () => ({ ok: true, subjectIds: [] });

// ---------------------------------------------------------------------------
// Shared structural checks (compositions of the authorities' exported
// types — each cited at its use site)
// ---------------------------------------------------------------------------

/** IntentTerms (policy/types.ts), composed structurally — no public mint exists. */
const intentTermsField: FieldCheck = recordField(
  {
    amount: moneyValue,
    sourceCurrency: nonEmptyString,
    destinationCurrency: nonEmptyString,
    sourceGeography: nonEmptyString,
    destinationGeography: nonEmptyString,
    deadlineEpochMs: safeInteger,
    allowedRails: arrayOf(nonEmptyString, 'rail ids'),
    costCeiling: moneyValue,
  },
  'intent terms',
);

/** CapabilitySnapshotEntry's corridor (capability/types.ts Corridor). */
const snapshotCorridorField: FieldCheck = recordField(
  {
    sourceCurrency: nonEmptyString,
    destinationCurrency: nonEmptyString,
    sourceGeography: nonEmptyString,
    destinationGeography: nonEmptyString,
  },
  'a corridor',
);

/** CapabilitySnapshotEntry (capability/types.ts). */
const snapshotEntryField: FieldCheck = recordField(
  {
    capabilityId: nonEmptyString,
    railId: nonEmptyString,
    corridor: snapshotCorridorField,
    state: guardOf(isCapabilityState, 'must be a CapabilityState (REGISTERED, ACTIVE, DEGRADED, or RETIRED)'),
    declaredCapacity: moneyValue,
    reservedTotal: moneyValue,
    consumedTotal: moneyValue,
    availableCapacity: moneyValue,
    costSchedule: moneyValue,
    tier: nonEmptyString,
  },
  'a capability snapshot entry',
);

/** CapabilitySnapshot (capability/types.ts). */
const capabilitySnapshotField: FieldCheck = recordField(
  {
    snapshotId: nonEmptyString,
    sequence: safeInteger,
    wallMs: safeInteger,
    capabilities: arrayOf(snapshotEntryField, 'capability snapshot entries'),
  },
  'a capability snapshot',
);

/** RouteRequirement (policy/types.ts). */
const routeRequirementField: FieldCheck = recordField(
  {
    capabilityId: nonEmptyString,
    railId: nonEmptyString,
    sourceCurrency: nonEmptyString,
    destinationCurrency: nonEmptyString,
    costSchedule: moneyValue,
    tier: nonEmptyString,
  },
  'a route requirement',
);

/** PolicyEvaluationOutcome (policy/types.ts) — the satisfiable union. */
const policyEvaluationOutcomeField: FieldCheck = (value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { path: '', problem: 'must be a policy evaluation outcome (the satisfiable union)' };
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.satisfiable === false) {
    return candidate.reasonCode === 'POLICY_UNSATISFIABLE'
      ? true
      : { path: 'reasonCode', problem: 'must be POLICY_UNSATISFIABLE when satisfiable is false' };
  }
  if (candidate.satisfiable !== true) {
    return { path: 'satisfiable', problem: 'must be true or false' };
  }
  const result = candidate.result;
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return { path: 'result', problem: 'must be the PolicyEvaluationResult when satisfiable is true' };
  }
  const envelope = (result as Record<string, unknown>).constraintEnvelope;
  if (
    typeof envelope !== 'object' ||
    envelope === null ||
    Array.isArray(envelope) ||
    !Array.isArray((envelope as Record<string, unknown>).allowedRails) ||
    ((envelope as Record<string, unknown>).ordering !== 'COST_ASC' &&
      (envelope as Record<string, unknown>).ordering !== 'TIER_DESC') ||
    !Array.isArray((envelope as Record<string, unknown>).fallbackPreference)
  ) {
    return { path: 'result.constraintEnvelope', problem: 'must be a constraint envelope (allowedRails, ordering, fallbackPreference)' };
  }
  const requirements = (result as Record<string, unknown>).rankedRouteRequirements;
  if (!Array.isArray(requirements)) {
    return { path: 'result.rankedRouteRequirements', problem: 'must be an array of route requirements' };
  }
  for (let index = 0; index < requirements.length; index += 1) {
    const outcome = routeRequirementField(requirements[index]);
    if (outcome !== true) {
      return {
        path: `result.rankedRouteRequirements[${index}]${outcome.path.length === 0 ? '' : `.${outcome.path}`}`,
        problem: outcome.problem,
      };
    }
  }
  const ceiling = (result as Record<string, unknown>).costCeiling;
  if (!isMoneyShaped(ceiling)) {
    return { path: 'result.costCeiling', problem: 'must be a well-formed Money value (integer minor units, GC-1)' };
  }
  const deadline = (result as Record<string, unknown>).deadlineEpochMs;
  if (typeof deadline !== 'number' || !Number.isInteger(deadline)) {
    return { path: 'result.deadlineEpochMs', problem: 'must be an integer (GC-1)' };
  }
  return true;
};

/** FundingSource (liquidity/types.ts) — composed of the exported kind guard. */
const fundingSourceField: FieldCheck = recordField(
  {
    kind: guardOf(isFundingSourceKind, 'must be INTERNAL_TRANSFER or EXTERNAL_RAIL'),
    referenceId: nonEmptyString,
  },
  'a funding source',
);

/**
 * QueuePolicy (queues/types.ts) — mirrors the Queue Authority's own private
 * assertPolicy exactly (ordering rule fixed; positive max wait; at least
 * one release condition; Money-shaped optional thresholds).
 */
const queuePolicyField: FieldCheck = (value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { path: '', problem: 'must be a QueuePolicy' };
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.orderingRule !== 'PRIORITY_CLASS_THEN_SEQUENCE_NUMBER') {
    return {
      path: 'orderingRule',
      problem: 'must be the fixed deterministic rule (priority class, then sequence)',
    };
  }
  const maxWait = candidate.maxWaitEpochMs;
  if (typeof maxWait !== 'number' || !Number.isInteger(maxWait) || maxWait <= 0) {
    return { path: 'maxWaitEpochMs', problem: 'must be a positive integer (GC-1)' };
  }
  const conditions = candidate.releaseConditions;
  if (typeof conditions !== 'object' || conditions === null || Array.isArray(conditions)) {
    return { path: 'releaseConditions', problem: 'must be a QueueReleaseConditions value' };
  }
  const release = conditions as Record<string, unknown>;
  if (
    release.minLiquidityAvailable !== undefined &&
    !isMoneyShaped(release.minLiquidityAvailable)
  ) {
    return { path: 'releaseConditions.minLiquidityAvailable', problem: 'must be Money (GC-1)' };
  }
  if (release.minCreditRemaining !== undefined && !isMoneyShaped(release.minCreditRemaining)) {
    return { path: 'releaseConditions.minCreditRemaining', problem: 'must be Money (GC-1)' };
  }
  if (
    release.requiredCapabilityTier === undefined &&
    release.minLiquidityAvailable === undefined &&
    release.minCreditRemaining === undefined
  ) {
    return { path: 'releaseConditions', problem: 'must name at least one condition (the eligibility rule)' };
  }
  if (release.requiredCapabilityTier !== undefined && typeof release.requiredCapabilityTier !== 'string') {
    return { path: 'releaseConditions.requiredCapabilityTier', problem: 'must be a string when present' };
  }
  return true;
};

/**
 * ProtocolEligibilitySnapshot (queues/types.ts) — structural composition
 * (the authority itself only object-checks it; the gateway is stricter,
 * never looser).
 */
const eligibilitySnapshotField: FieldCheck = recordField(
  {
    liquidity: arrayOf(
      recordField({ poolId: nonEmptyString, available: moneyValue }, 'a liquidity availability fact'),
      'liquidity availability facts',
    ),
    capability: arrayOf(
      recordField(
        { capabilityId: nonEmptyString, tier: nonEmptyString, state: nonEmptyString },
        'a capability availability fact',
      ),
      'capability availability facts',
    ),
    credit: arrayOf(
      recordField({ lineId: nonEmptyString, remaining: moneyValue }, 'a credit availability fact'),
      'credit availability facts',
    ),
    at: protocolTimeValue,
  },
  'a protocol eligibility snapshot',
);

/**
 * One clearing record input (clearing/authority.ts ClearingRecordInput) —
 * mirrors the Clearing Authority's own addRecord checks EXACTLY, including
 * the deliberate omission: `amount` is NOT shape-checked (its shape is
 * validated at STAGE time by the quarantine flow — CLEARING_REASON_CODES
 * INVALID_MONEY_NOT_INTEGER / INVALID_MONEY_SHAPE / ZERO_AMOUNT /
 * SELF_PARTY are domain semantics admission must not preempt).
 */
const clearingRecordField: FieldCheck = (value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { path: '', problem: 'must be a clearing record input object' };
  }
  const candidate = value as Record<string, unknown>;
  const origin = candidate.origin;
  if (typeof origin !== 'object' || origin === null || Array.isArray(origin)) {
    return { path: 'origin', problem: 'must be an object' };
  }
  const originRecord = origin as Record<string, unknown>;
  if (typeof originRecord.originActivityId !== 'string' || originRecord.originActivityId.length === 0) {
    return { path: 'origin.originActivityId', problem: 'must be a non-empty string' };
  }
  if (!isClearingOriginKind(originRecord.originKind)) {
    return {
      path: 'origin.originKind',
      problem: 'must be ROUTE_PLAN_HOP | INTENT | RECONCILIATION_ADJUSTMENT',
    };
  }
  const parties = candidate.parties;
  if (
    typeof parties !== 'object' ||
    parties === null ||
    Array.isArray(parties) ||
    typeof (parties as Record<string, unknown>).debtorParticipantId !== 'string' ||
    ((parties as Record<string, unknown>).debtorParticipantId as string).length === 0 ||
    typeof (parties as Record<string, unknown>).creditorParticipantId !== 'string' ||
    ((parties as Record<string, unknown>).creditorParticipantId as string).length === 0
  ) {
    return {
      path: 'parties',
      problem: 'must carry non-empty debtorParticipantId and creditorParticipantId',
    };
  }
  if (typeof candidate.reason !== 'string' || candidate.reason.length === 0) {
    return { path: 'reason', problem: 'must be a non-empty string' };
  }
  if (
    candidate.correctionOf !== undefined &&
    (typeof candidate.correctionOf !== 'string' || candidate.correctionOf.length === 0)
  ) {
    return { path: 'correctionOf', problem: 'must be a non-empty string when present' };
  }
  // amount: deliberately NOT shape-checked — see the doc comment above.
  return true;
};

/**
 * One obligation dispute-replacement input (obligations/authority.ts
 * assertTermsInput): non-empty distinct parties, Money amount, non-empty
 * reason.
 */
const obligationReplacementField: FieldCheck = (value) => {
  const outcome = recordField(
    {
      debtorParticipantId: nonEmptyString,
      creditorParticipantId: nonEmptyString,
      amount: moneyValue,
      reason: nonEmptyString,
    },
    'a replacement obligation',
  )(value);
  if (outcome !== true) {
    return outcome;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.debtorParticipantId === candidate.creditorParticipantId) {
    return { path: 'creditorParticipantId', problem: 'debtor and creditor must be distinct participants' };
  }
  return true;
};

/** SettlementSubject (settlement/authority.ts) — the OBLIGATION | NET_POSITION union. */
const settlementSubjectField: FieldCheck = (value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      path: '',
      problem: 'must be { kind: "OBLIGATION", obligationId } or { kind: "NET_POSITION", netObligationId }',
    };
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'OBLIGATION') {
    return typeof candidate.obligationId === 'string' && candidate.obligationId.length > 0
      ? true
      : { path: 'obligationId', problem: 'must be a non-empty string when kind is OBLIGATION' };
  }
  if (candidate.kind === 'NET_POSITION') {
    return typeof candidate.netObligationId === 'string' && candidate.netObligationId.length > 0
      ? true
      : { path: 'netObligationId', problem: 'must be a non-empty string when kind is NET_POSITION' };
  }
  return { path: 'kind', problem: 'must be OBLIGATION or NET_POSITION' };
};

/** RecoveryDirective (rails/types.ts) — the three-feed union. */
const recoveryDirectiveField: FieldCheck = (value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { path: '', problem: 'must be a RecoveryDirective' };
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.feed === 'AREA_12_FINALITY_ADVANCE') {
    if (typeof candidate.instructionId !== 'string' || candidate.instructionId.length === 0) {
      return { path: 'instructionId', problem: 'must be a non-empty string' };
    }
    if (typeof candidate.operationId !== 'string' || candidate.operationId.length === 0) {
      return { path: 'operationId', problem: 'must be a non-empty string' };
    }
    if (candidate.attemptOutcome !== 'CONFIRMED') {
      return { path: 'attemptOutcome', problem: 'must be CONFIRMED' };
    }
    return true;
  }
  if (candidate.feed === 'AREA_12_NEW_INSTRUCTION') {
    if (typeof candidate.instructionId !== 'string' || candidate.instructionId.length === 0) {
      return { path: 'instructionId', problem: 'must be a non-empty string' };
    }
    if (typeof candidate.operationId !== 'string' || candidate.operationId.length === 0) {
      return { path: 'operationId', problem: 'must be a non-empty string' };
    }
    if (candidate.note !== 'RECOVERY_IS_A_NEW_INSTRUCTION_NOT_A_RETRY') {
      return { path: 'note', problem: 'must be RECOVERY_IS_A_NEW_INSTRUCTION_NOT_A_RETRY' };
    }
    return true;
  }
  if (candidate.feed === 'AREA_09_10_NEW_LINKED_ENTRIES') {
    if (typeof candidate.caseId !== 'string' || candidate.caseId.length === 0) {
      return { path: 'caseId', problem: 'must be a non-empty string' };
    }
    if (!Array.isArray(candidate.adjustmentIds)) {
      return { path: 'adjustmentIds', problem: 'must be an array of adjustment ids' };
    }
    for (let index = 0; index < candidate.adjustmentIds.length; index += 1) {
      const id = candidate.adjustmentIds[index];
      if (typeof id !== 'string' || id.length === 0) {
        return { path: `adjustmentIds[${index}]`, problem: 'must be a non-empty string' };
      }
    }
    if (!Array.isArray(candidate.linkedPriorEntries)) {
      return { path: 'linkedPriorEntries', problem: 'must be an array of prior entry ids' };
    }
    for (let index = 0; index < candidate.linkedPriorEntries.length; index += 1) {
      const id = candidate.linkedPriorEntries[index];
      if (typeof id !== 'string' || id.length === 0) {
        return { path: `linkedPriorEntries[${index}]`, problem: 'must be a non-empty string' };
      }
    }
    return true;
  }
  return { path: 'feed', problem: 'must be an area-12 or area-09-10 recovery feed' };
};

/** RailReportEnvelope (rails/adapters.ts) — structural (the authority performs no entry validation). */
const railReportEnvelopeField: FieldCheck = recordField(
  {
    outcomeClass: guardOf(isRailReportClass, 'must be a RailReportClass (CONFIRMED, FAILED, or UNKNOWN)'),
    reasonCode: optional(nonEmptyString),
    railReferences: arrayOf(nonEmptyString, 'rail references'),
    payloadHash: nonEmptyString,
    reportedAtWallMs: safeInteger,
  },
  'a rail report envelope',
);

/**
 * CaseResolutionInput (rails/reconciliation.ts) — the four-resolution
 * union (RESOLVED_CONFIRMED | RESOLVED_FAILED | RESOLVED_ADJUSTED |
 * MATCHED), each with its proof.
 */
const caseResolutionInputField: FieldCheck = (value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { path: '', problem: 'must be a case resolution input' };
  }
  const candidate = value as Record<string, unknown>;
  const resolution = candidate.resolution;
  if (
    resolution !== 'RESOLVED_CONFIRMED' &&
    resolution !== 'RESOLVED_FAILED' &&
    resolution !== 'RESOLVED_ADJUSTED' &&
    resolution !== 'MATCHED'
  ) {
    return { path: 'resolution', problem: 'must be RESOLVED_CONFIRMED, RESOLVED_FAILED, RESOLVED_ADJUSTED, or MATCHED' };
  }
  const proofOutcome = resolutionProofField(candidate.proof);
  if (proofOutcome !== true) {
    return { path: proofOutcome.path.length === 0 ? 'proof' : `proof.${proofOutcome.path}`, problem: proofOutcome.problem };
  }
  if (resolution === 'RESOLVED_ADJUSTED') {
    if (candidate.operationOutcome !== 'CONFIRMED' && candidate.operationOutcome !== 'FAILED') {
      return { path: 'operationOutcome', problem: 'must be CONFIRMED or FAILED for RESOLVED_ADJUSTED' };
    }
    const adjustment = candidate.adjustment;
    if (typeof adjustment !== 'object' || adjustment === null || Array.isArray(adjustment)) {
      return { path: 'adjustment', problem: 'must be an adjustment (links, description)' };
    }
    const adjustmentRecord = adjustment as Record<string, unknown>;
    if (
      !Array.isArray(adjustmentRecord.links) ||
      adjustmentRecord.links.length === 0 ||
      adjustmentRecord.links.some((link) => typeof link !== 'string' || link.length === 0)
    ) {
      return { path: 'adjustment.links', problem: 'must be a non-empty array of non-empty link ids' };
    }
    if (typeof adjustmentRecord.description !== 'string' || adjustmentRecord.description.length === 0) {
      return { path: 'adjustment.description', problem: 'must be a non-empty string' };
    }
  }
  return true;
};

/** ResolutionProof (rails/types.ts) — optional reference arrays of non-empty strings. */
function resolutionProofField(value: unknown): true | FieldProblem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { path: '', problem: 'must be a resolution proof' };
  }
  const candidate = value as Record<string, unknown>;
  for (const key of ['matchedStatementRefs', 'adjustmentLedgerRefs', 'externalRefs'] as const) {
    const refs = candidate[key];
    if (refs === undefined) {
      continue;
    }
    if (!Array.isArray(refs) || refs.some((ref) => typeof ref !== 'string' || ref.length === 0)) {
      return { path: key, problem: 'must be an array of non-empty reference ids when present' };
    }
  }
  return true;
}

/**
 * ExternalStatementRecord (rails/types.ts) — mirrors the reconciliation
 * matcher's own statement rules: non-empty sourceId, positive integer
 * sequence, non-empty railReference, a RailReportClass outcome, safe-integer
 * amountMinor, 3-letter currency, safe-integer assertedAtWallMs.
 */
const externalStatementField: FieldCheck = recordField(
  {
    sourceId: nonEmptyString,
    sequence: (value: unknown) =>
      typeof value === 'number' && Number.isInteger(value) && value > 0 && Number.isSafeInteger(value)
        ? true
        : { path: '', problem: 'must be a positive integer' },
    railReference: nonEmptyString,
    operationId: optional(nonEmptyString),
    idempotencyKey: optional(nonEmptyString),
    outcomeClass: guardOf(isRailReportClass, 'must be a RailReportClass (CONFIRMED, FAILED, or UNKNOWN)'),
    amountMinor: safeInteger,
    currency: currencyCode,
    assertedAtWallMs: safeInteger,
  },
  'an external statement record',
);

/**
 * The risk authority's caller-supplied protocol time (risk commands take
 * `when: ProtocolTime` — the authority has no clock; assertWhen TypeErrors
 * on malformed times).
 */
const riskWhenField = protocolTimeValue;

/** A risk rule definition — validated by the authority's own exported validator (the mint IS the schema). */
const riskRuleDefinitionField: FieldCheck = mintedBy(
  validateRiskRuleDefinition as (input: never) => unknown,
  'risk rule definition',
);

/** Subject compliance data — validated by the authority's own exported mint. */
const subjectComplianceDataField: FieldCheck = mintedBy(
  subjectComplianceData as (input: never) => unknown,
  'subject compliance data',
);

function isMoneyShaped(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).currency === 'string' &&
    /^[A-Z]{3}$/.test((value as Record<string, unknown>).currency as string) &&
    typeof (value as Record<string, unknown>).scale === 'number' &&
    Number.isInteger((value as Record<string, unknown>).scale) &&
    (value as Record<string, unknown>).scale as number >= 0 &&
    typeof (value as Record<string, unknown>).amountMinor === 'number' &&
    Number.isInteger((value as Record<string, unknown>).amountMinor) &&
    Number.isSafeInteger((value as Record<string, unknown>).amountMinor)
  );
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/**
 * One command kind's admission specification: the kind string, the body
 * field schema (the owning authority's command schema, composed per the
 * module conventions), optional cross-field invariants, the subject
 * binding, and the 1:1 mapping to the owning authority's public command
 * method.
 *
 * Source: RTN-010.md lines 10, 14; rtn-plan-rulings.md Q4.
 */
export interface CommandSpec {
  /** The command kind (kernel KIND_PATTERN: lowercase dot-separated segments). */
  readonly kind: string;
  /** The owning authority's exported authority id (the envelope's authority target). */
  readonly authority: string;
  /** The 1:1 mapping to the owning authority's public command method (for COMMAND-SURFACE.md and the transition path). */
  readonly description: string;
  /** The body's declared fields (the owning authority's command schema). */
  readonly fields: Readonly<Record<string, FieldSpec>>;
  /** Cross-field invariants applied after every declared field passes. */
  readonly invariants?: readonly ((body: Record<string, unknown>) => true | FieldProblem)[];
  /** The subject objects the command addresses (derived from the validated body). */
  readonly subjects: SubjectResolver;
}

/**
 * One command authority's registry entry: the envelope authority id, the
 * evidence-authority name for A15 attribution, and the authority's command
 * kinds.
 *
 * Source: RTN-010.md line 10; kernel/envelope.ts (the authority-name
 * enumeration); evidence/record.ts EVIDENCE_AUTHORITIES.
 */
export interface AuthorityCommands {
  /** The envelope authority id (the merged module's exported authority constant). */
  readonly authority: string;
  /** The EVIDENCE_AUTHORITIES member rejection evidence attributes to. */
  readonly evidenceAuthority: string;
  /** The authority's command kinds, keyed by kind string. */
  readonly commands: readonly CommandSpec[];
}

function authority(
  authorityId: string,
  evidenceAuthority: string,
  commands: readonly Omit<CommandSpec, 'authority'>[],
): AuthorityCommands {
  return {
    authority: authorityId,
    evidenceAuthority,
    commands: Object.freeze(commands.map((command) => Object.freeze({ ...command, authority: authorityId }))),
  };
}

// --- A01 Intent Authority (7 command kinds) --------------------------------
// Authority id: intent/evidence.ts INTENT_AUTHORITY_ID = 'Intent Authority'
// Command surface: intent/authority.ts IntentAuthority (submitIntent,
// authorizeIntent, routeIntent, startFulfillingIntent, fulfillIntent,
// failIntent, cancelIntent).

const intentCommands = authority(INTENT_AUTHORITY_ID, INTENT_AUTHORITY_ID, [
  {
    kind: 'intent.submit',
    description: 'IntentAuthority.submitIntent(descriptor, { priorIntentId }) — the DRAFT-creating demand submission (INV-1-2/INV-1-3).',
    fields: {
      descriptor: mintedBy(demandDescriptor as (input: never) => unknown, 'demand descriptor'),
      priorIntentId: optional(nonEmptyString),
    },
    subjects: noSubjects,
  },
  {
    kind: 'intent.authorize',
    description: 'IntentAuthority.authorizeIntent(intentId, policyDecisionId) — DRAFT -> AUTHORIZED (compliance-gated at execution, INV-16-3).',
    fields: { intentId: nonEmptyString, policyDecisionId: nonEmptyString },
    subjects: subjectFields('intentId'),
  },
  {
    kind: 'intent.route',
    description: 'IntentAuthority.routeIntent(intentId, reasonCode?) — AUTHORIZED -> ROUTED.',
    fields: { intentId: nonEmptyString, reasonCode: optional(guardOf(isIntentReasonCode, 'must be an IntentReasonCode')) },
    subjects: subjectFields('intentId'),
  },
  {
    kind: 'intent.fulfilling.start',
    description: 'IntentAuthority.startFulfillingIntent(intentId, reasonCode?) — ROUTED -> FULFILLING.',
    fields: { intentId: nonEmptyString, reasonCode: optional(guardOf(isIntentReasonCode, 'must be an IntentReasonCode')) },
    subjects: subjectFields('intentId'),
  },
  {
    kind: 'intent.fulfill',
    description: 'IntentAuthority.fulfillIntent(intentId, reasonCode?) — FULFILLING -> FULFILLED (terminal).',
    fields: { intentId: nonEmptyString, reasonCode: optional(guardOf(isIntentReasonCode, 'must be an IntentReasonCode')) },
    subjects: subjectFields('intentId'),
  },
  {
    kind: 'intent.fail',
    description: 'IntentAuthority.failIntent(intentId, reasonCode, failingRecordId?) — -> FAILED with a REQUIRED machine-readable reason code.',
    fields: {
      intentId: nonEmptyString,
      reasonCode: guardOf(isIntentReasonCode, 'must be an IntentReasonCode'),
      failingRecordId: optional(nonEmptyString),
    },
    subjects: subjectFields('intentId'),
  },
  {
    kind: 'intent.cancel',
    description: 'IntentAuthority.cancelIntent(intentId, reasonCode) — -> CANCELLED with a REQUIRED reason code (the INV-1-1 change path).',
    fields: { intentId: nonEmptyString, reasonCode: guardOf(isIntentReasonCode, 'must be an IntentReasonCode') },
    subjects: subjectFields('intentId'),
  },
]);

// --- A02 Fulfillment Policy Authority (5 command kinds) -------------------
// Authority id: policy/evidence.ts POLICY_AUTHORITY_ID = 'Fulfillment Policy
// Authority'. Command surface: policy/authority.ts PolicyAuthority.

const policyCommands = authority(POLICY_AUTHORITY_ID, POLICY_AUTHORITY_ID, [
  {
    kind: 'policy.author',
    description: 'PolicyAuthority.authorPolicy(policyId, definition) — the AUTHORED entry operation.',
    fields: {
      policyId: nonEmptyString,
      definition: mintedBy(fulfillmentPolicyDefinition as (input: never) => unknown, 'fulfillment policy definition'),
    },
    subjects: noSubjects,
  },
  {
    kind: 'policy.version.publish',
    description: 'PolicyAuthority.publishPolicyVersion(policyId) — AUTHORED -> VERSIONED.',
    fields: { policyId: nonEmptyString },
    subjects: subjectFields('policyId'),
  },
  {
    kind: 'policy.attach',
    description: 'PolicyAuthority.attachPolicy({ policyId, version, intentId, snapshotId }) — VERSIONED -> ATTACHED.',
    fields: {
      policyId: nonEmptyString,
      version: positiveInteger,
      intentId: nonEmptyString,
      snapshotId: nonEmptyString,
    },
    subjects: subjectFields('policyId', 'intentId'),
  },
  {
    kind: 'policy.evaluate',
    description: 'PolicyAuthority.evaluatePolicy({ policyId, version, intentId, intentTerms, snapshot }) — the pure INV-2-1 evaluation.',
    fields: {
      policyId: nonEmptyString,
      version: positiveInteger,
      intentId: nonEmptyString,
      intentTerms: intentTermsField,
      snapshot: capabilitySnapshotField,
    },
    subjects: subjectFields('policyId', 'intentId'),
  },
  {
    kind: 'policy.evaluation.consume',
    description: 'PolicyAuthority.consumeEvaluation(evaluationId) — EVALUATED -> CONSUMED.',
    fields: { evaluationId: nonEmptyString },
    subjects: subjectFields('evaluationId'),
  },
]);

// --- A03 Capability Authority (9 command kinds) ---------------------------
// Authority id: capability/evidence.ts CAPABILITY_AUTHORITY_ID = 'Capability
// Authority'. Command surface: capability/authority.ts CapabilityAuthority.
// The declaration has no public mint; the check mirrors the authority's own
// assertDeclaration rules exactly.

const capabilityDeclarationField: FieldCheck = recordField(
  {
    railId: nonEmptyString,
    corridor: recordField(
      {
        sourceCurrency: currencyCode,
        destinationCurrency: currencyCode,
        sourceGeography: nonEmptyString,
        destinationGeography: nonEmptyString,
      },
      'a corridor',
    ),
    costSchedule: moneyValue,
    tier: nonEmptyString,
  },
  'a capability declaration',
);

const capabilityCommands = authority(CAPABILITY_AUTHORITY_ID, CAPABILITY_AUTHORITY_ID, [
  {
    kind: 'capability.register',
    description: 'CapabilityAuthority.registerCapability({ capabilityId, declaration, declaredCapacity }) — the REGISTERED entry operation.',
    fields: {
      capabilityId: nonEmptyString,
      declaration: capabilityDeclarationField,
      declaredCapacity: nonNegativeMoney,
    },
    subjects: noSubjects,
  },
  {
    kind: 'capability.activate',
    description: 'CapabilityAuthority.activateCapability(capabilityId, reasonCode?) — REGISTERED -> ACTIVE (compliance-gated at execution, INV-16-3).',
    fields: { capabilityId: nonEmptyString, reasonCode: optional(nonEmptyString) },
    subjects: subjectFields('capabilityId'),
  },
  {
    kind: 'capability.degrade',
    description: 'CapabilityAuthority.degradeCapability(capabilityId, reasonCode?) — ACTIVE -> DEGRADED (OFFERED commitments release at execution).',
    fields: { capabilityId: nonEmptyString, reasonCode: optional(nonEmptyString) },
    subjects: subjectFields('capabilityId'),
  },
  {
    kind: 'capability.retire',
    description: 'CapabilityAuthority.retireCapability(capabilityId, reasonCode?) — DEGRADED -> RETIRED (terminal).',
    fields: { capabilityId: nonEmptyString, reasonCode: optional(nonEmptyString) },
    subjects: subjectFields('capabilityId'),
  },
  {
    kind: 'capability.commitment.offer',
    description: 'CapabilityAuthority.offerCommitment({ intentId, capabilityId, amount, deadlineEpochMs }) — the OFFERED commitment entry.',
    fields: {
      intentId: nonEmptyString,
      capabilityId: nonEmptyString,
      amount: positiveMoney,
      deadlineEpochMs: safeInteger,
    },
    subjects: subjectFields('intentId', 'capabilityId'),
  },
  {
    kind: 'capability.commitment.reserve',
    description: 'CapabilityAuthority.reserveCommitment(commitmentId) — OFFERED -> RESERVED (INV-3-1 capacity at execution).',
    fields: { commitmentId: nonEmptyString },
    subjects: subjectFields('commitmentId'),
  },
  {
    kind: 'capability.commitment.consume',
    description: 'CapabilityAuthority.consumeCommitment(commitmentId) — RESERVED -> CONSUMED (exactly-once terminal).',
    fields: { commitmentId: nonEmptyString },
    subjects: subjectFields('commitmentId'),
  },
  {
    kind: 'capability.commitment.release',
    description: 'CapabilityAuthority.releaseCommitment(commitmentId) — -> RELEASED.',
    fields: { commitmentId: nonEmptyString },
    subjects: subjectFields('commitmentId'),
  },
  {
    kind: 'capability.commitment.expire',
    description: 'CapabilityAuthority.expireCommitment(commitmentId, wallMs) — deadline-expiry sweep (scheduler-tick driven).',
    fields: { commitmentId: nonEmptyString, wallMs: safeInteger },
    subjects: subjectFields('commitmentId'),
  },
]);

// --- A04 Routing Authority (8 command kinds) ------------------------------
// Authority id: routing/evidence.ts ROUTING_AUTHORITY_ID = 'Routing
// Authority'. Command surface: routing/authority.ts RoutingAuthority.

const routingCommands = authority(ROUTING_AUTHORITY_ID, ROUTING_AUTHORITY_ID, [
  {
    kind: 'routing.compile',
    description: 'RoutingAuthority.compileRoute({ intentId, intentTerms, policyEvaluation, snapshot, conversions? }) — the deterministic compilation.',
    fields: {
      intentId: nonEmptyString,
      intentTerms: intentTermsField,
      policyEvaluation: policyEvaluationOutcomeField,
      snapshot: capabilitySnapshotField,
      conversions: optional(mintedBy(canonicalConversionSchedule as (input: never) => unknown, 'conversion schedule')),
    },
    subjects: subjectFields('intentId'),
  },
  {
    kind: 'routing.plan.validate',
    description: 'RoutingAuthority.validatePlan(planId) — COMPILED -> VALIDATED.',
    fields: { planId: nonEmptyString },
    subjects: subjectFields('planId'),
  },
  {
    kind: 'routing.plan.dispatch',
    description: 'RoutingAuthority.dispatchPlan(planId) — VALIDATED -> DISPATCHED (reservation acquisition at execution, INV-4-2).',
    fields: { planId: nonEmptyString },
    subjects: subjectFields('planId'),
  },
  {
    kind: 'routing.hop.unknown.record',
    description: 'RoutingAuthority.recordUnknownHop(planId, hopId, railOperationId) — the plan halts at DISPATCHED (GC-2: no blind re-dispatch).',
    fields: { planId: nonEmptyString, hopId: nonEmptyString, railOperationId: nonEmptyString },
    subjects: subjectFields('planId', 'hopId'),
  },
  {
    kind: 'routing.hop.unknown.resolve',
    description: 'RoutingAuthority.resolveUnknownHop(planId, hopId, resolvedOutcome) — the post-reconciliation resolution (area 14 exit).',
    fields: {
      planId: nonEmptyString,
      hopId: nonEmptyString,
      resolvedOutcome: oneOfLiterals(['CONFIRMED', 'FAILED'], 'CONFIRMED or FAILED'),
    },
    subjects: subjectFields('planId', 'hopId'),
  },
  {
    kind: 'routing.plan.complete',
    description: 'RoutingAuthority.completePlan(planId) — DISPATCHED -> COMPLETED (terminal).',
    fields: { planId: nonEmptyString },
    subjects: subjectFields('planId'),
  },
  {
    kind: 'routing.plan.fail',
    description: 'RoutingAuthority.failPlan(planId, reasonCode, { affectedHopIds? }) — -> FAILED with a REQUIRED reason code.',
    fields: {
      planId: nonEmptyString,
      reasonCode: guardOf(isRoutePlanReasonCode, 'must be a RoutePlanReasonCode'),
      affectedHopIds: optional(arrayOf(nonEmptyString, 'hop ids')),
    },
    subjects: subjectFields('planId'),
  },
  {
    kind: 'routing.plan.abandon',
    description: 'RoutingAuthority.abandonPlan(planId, reasonCode, { affectedHopIds? }) — -> ABANDONED with a REQUIRED reason code.',
    fields: {
      planId: nonEmptyString,
      reasonCode: guardOf(isRoutePlanReasonCode, 'must be a RoutePlanReasonCode'),
      affectedHopIds: optional(arrayOf(nonEmptyString, 'hop ids')),
    },
    subjects: subjectFields('planId'),
  },
]);

// --- A05 Reservation Authority (5 command kinds) --------------------------
// Authority id: reservations/evidence.ts RESERVATION_AUTHORITY_ID =
// 'Reservation Authority'. Command surface: reservations/ledger.ts
// ReservationLedger (the A05 command surface; there is no authority.ts in
// this domain).

const reservationCommands = authority(RESERVATION_AUTHORITY_ID, RESERVATION_AUTHORITY_ID, [
  {
    kind: 'reservations.resource.declare',
    description: 'ReservationLedger.declareResource(resourceId, declaredTotal) — the per-resource ledger genesis (INV-5-1 identity base).',
    fields: { resourceId: nonEmptyString, declaredTotal: nonNegativeMoney },
    subjects: subjectFields('resourceId'),
  },
  {
    kind: 'reservations.hold.request',
    description: 'ReservationLedger.requestReservation({ intentId, hopId, resourceId, amount, deadlineEpochMs }) — REQUESTED -> HELD (INV-5-2/5-3).',
    fields: {
      intentId: nonEmptyString,
      hopId: nonEmptyString,
      resourceId: nonEmptyString,
      amount: nonNegativeMoney,
      deadlineEpochMs: safeInteger,
    },
    subjects: subjectFields('intentId', 'hopId', 'resourceId'),
  },
  {
    kind: 'reservations.hold.consume',
    description: 'ReservationLedger.consumeReservation(reservationId) — HELD -> CONSUMED (exactly-once terminal).',
    fields: { reservationId: nonEmptyString },
    subjects: subjectFields('reservationId'),
  },
  {
    kind: 'reservations.hold.release',
    description: 'ReservationLedger.releaseReservation(reservationId) — HELD -> RELEASED (exactly-once terminal).',
    fields: { reservationId: nonEmptyString },
    subjects: subjectFields('reservationId'),
  },
  {
    kind: 'reservations.due.expire',
    description: 'ReservationLedger.expireDueReservations(at?) — the deadline-expiry sweep (scheduler-tick driven; deterministic on protocol time).',
    fields: { at: optional(protocolTimeValue) },
    subjects: noSubjects,
  },
]);

// --- A06 Liquidity Authority (10 command kinds) ---------------------------
// Authority id: liquidity/evidence.ts LIQUIDITY_AUTHORITY_ID = 'Liquidity
// Authority'. Command surface: liquidity/authority.ts LiquidityAuthority.

const liquidityCommands = authority(LIQUIDITY_AUTHORITY_ID, LIQUIDITY_AUTHORITY_ID, [
  {
    kind: 'liquidity.pool.open',
    description: 'LiquidityAuthority.openPool({ poolId, currency, scale }) — the OPEN pool genesis.',
    fields: { poolId: nonEmptyString, currency: currencyCode, scale: nonNegativeInteger },
    subjects: noSubjects,
  },
  {
    kind: 'liquidity.pool.freeze',
    description: 'LiquidityAuthority.freezePool(poolId) — OPEN -> FROZEN (no new reservations).',
    fields: { poolId: nonEmptyString },
    subjects: subjectFields('poolId'),
  },
  {
    kind: 'liquidity.pool.close',
    description: 'LiquidityAuthority.closePool(poolId) — FROZEN -> CLOSED (all positions settled).',
    fields: { poolId: nonEmptyString },
    subjects: subjectFields('poolId'),
  },
  {
    kind: 'liquidity.funding.record',
    description: 'LiquidityAuthority.recordConfirmedFunding({ poolId, source, amount }) — confirmed funding entry.',
    fields: { poolId: nonEmptyString, source: fundingSourceField, amount: positiveMoney },
    subjects: subjectFields('poolId'),
  },
  {
    kind: 'liquidity.funding.pending.open',
    description: 'LiquidityAuthority.openPendingFunding({ poolId, railOperationId, expectedAmount }) — the UNKNOWN-funding link.',
    fields: {
      poolId: nonEmptyString,
      railOperationId: nonEmptyString,
      expectedAmount: moneyValue,
    },
    subjects: subjectFields('poolId'),
  },
  {
    kind: 'liquidity.funding.pending.resolve',
    description: 'LiquidityAuthority.resolvePendingFunding({ pendingId, resolution }) — CONFIRMED | REFUSED resolution.',
    fields: {
      pendingId: nonEmptyString,
      resolution: guardOf(isPendingFundingResolution, 'must be a PendingFundingResolution (CONFIRMED or REFUSED)'),
    },
    subjects: subjectFields('pendingId'),
  },
  {
    kind: 'liquidity.hold.request',
    description: 'LiquidityAuthority.requestPositionHold({ positionId, intentId, hopId, amount, deadlineEpochMs }) — position HELD via the reservation ledger.',
    fields: {
      positionId: nonEmptyString,
      intentId: nonEmptyString,
      hopId: nonEmptyString,
      amount: positiveMoney,
      deadlineEpochMs: safeInteger,
    },
    subjects: subjectFields('positionId', 'intentId'),
  },
  {
    kind: 'liquidity.hold.consume',
    description: 'LiquidityAuthority.consumeHold(reservationId) — position CONSUMED.',
    fields: { reservationId: nonEmptyString },
    subjects: subjectFields('reservationId'),
  },
  {
    kind: 'liquidity.hold.release',
    description: 'LiquidityAuthority.releaseHold(reservationId) — position RELEASED.',
    fields: { reservationId: nonEmptyString },
    subjects: subjectFields('reservationId'),
  },
  {
    kind: 'liquidity.holds.due.expire',
    description: 'LiquidityAuthority.expireDueHolds(at?) — the deadline-expiry sweep (scheduler-tick driven).',
    fields: { at: optional(protocolTimeValue) },
    subjects: noSubjects,
  },
]);

// --- A07 Credit Authority (9 command kinds) -------------------------------
// Authority id: credit/evidence.ts CREDIT_AUTHORITY_ID = 'Credit Authority'.
// Command surface: credit/authority.ts CreditAuthority.

const creditCommands = authority(CREDIT_AUTHORITY_ID, CREDIT_AUTHORITY_ID, [
  {
    kind: 'credit.line.offer',
    description: 'CreditAuthority.offerLine({ lineId, limit }) — the OFFERED line genesis.',
    fields: { lineId: nonEmptyString, limit: positiveMoney },
    subjects: noSubjects,
  },
  {
    kind: 'credit.line.activate',
    description: 'CreditAuthority.activateLine(lineId) — OFFERED -> ACTIVE.',
    fields: { lineId: nonEmptyString },
    subjects: subjectFields('lineId'),
  },
  {
    kind: 'credit.line.suspend',
    description: 'CreditAuthority.suspendLine(lineId) — ACTIVE -> SUSPENDED (blocks new reservations).',
    fields: { lineId: nonEmptyString },
    subjects: subjectFields('lineId'),
  },
  {
    kind: 'credit.line.close',
    description: 'CreditAuthority.closeLine(lineId) — -> CLOSED (exposure settled).',
    fields: { lineId: nonEmptyString },
    subjects: subjectFields('lineId'),
  },
  {
    kind: 'credit.usage.evaluate',
    description: 'CreditAuthority.evaluateCreditUsage({ intentId, lineId, requestedAmount }) — the usage decision (INV-7-1).',
    fields: { intentId: nonEmptyString, lineId: nonEmptyString, requestedAmount: positiveMoney },
    subjects: subjectFields('intentId', 'lineId'),
  },
  {
    kind: 'credit.decision.apply',
    description: 'CreditAuthority.applyCreditDecision({ decisionId, hopId, deadlineEpochMs }) — the approved decision\'s reservation.',
    fields: { decisionId: nonEmptyString, hopId: nonEmptyString, deadlineEpochMs: safeInteger },
    subjects: subjectFields('decisionId'),
  },
  {
    kind: 'credit.reservation.consume',
    description: 'CreditAuthority.consumeCreditReservation(reservationId) — exposure CONSUMED.',
    fields: { reservationId: nonEmptyString },
    subjects: subjectFields('reservationId'),
  },
  {
    kind: 'credit.reservation.release',
    description: 'CreditAuthority.releaseCreditReservation(reservationId) — exposure RELEASED.',
    fields: { reservationId: nonEmptyString },
    subjects: subjectFields('reservationId'),
  },
  {
    kind: 'credit.reservations.due.expire',
    description: 'CreditAuthority.expireDueCreditReservations(at?) — the deadline-expiry sweep (scheduler-tick driven).',
    fields: { at: optional(protocolTimeValue) },
    subjects: noSubjects,
  },
]);

// --- A08 Queue Authority (10 command kinds) -------------------------------
// Authority id: queues/evidence.ts QUEUE_AUTHORITY_ID = 'Queue Authority'.
// Command surface: queues/authority.ts QueueAuthority.

const queueCommands = authority(QUEUE_AUTHORITY_ID, QUEUE_AUTHORITY_ID, [
  {
    kind: 'queues.queue.create',
    description: 'QueueAuthority.createQueue({ queueId, policy }) — the CREATED queue genesis.',
    fields: { queueId: nonEmptyString, policy: queuePolicyField },
    subjects: noSubjects,
  },
  {
    kind: 'queues.queue.drain.start',
    description: 'QueueAuthority.startDraining(queueId) — CREATED -> DRAINING.',
    fields: { queueId: nonEmptyString },
    subjects: subjectFields('queueId'),
  },
  {
    kind: 'queues.queue.pause',
    description: 'QueueAuthority.pauseQueue(queueId) — DRAINING -> PAUSED.',
    fields: { queueId: nonEmptyString },
    subjects: subjectFields('queueId'),
  },
  {
    kind: 'queues.queue.close',
    description: 'QueueAuthority.closeQueue(queueId) — -> CLOSED (no resident items).',
    fields: { queueId: nonEmptyString },
    subjects: subjectFields('queueId'),
  },
  {
    kind: 'queues.item.enqueue',
    description: 'QueueAuthority.enqueueItem({ queueId, intentId, priorityClass, terms }) — the QUEUED item entry (INV-8-1 fixed terms).',
    fields: {
      queueId: nonEmptyString,
      intentId: nonEmptyString,
      priorityClass: nonNegativeInteger,
      terms: recordField({ intentId: nonEmptyString, terms: nonNegativeMoney }, 'fixed intent terms'),
    },
    invariants: [
      (body) =>
        (body.terms as Record<string, unknown>).intentId === body.intentId
          ? true
          : { path: 'terms.intentId', problem: 'must match the enqueued intentId (INV-8-1)' },
    ],
    subjects: subjectFields('queueId', 'intentId'),
  },
  {
    kind: 'queues.eligibility.evaluate',
    description: 'QueueAuthority.evaluateEligibility({ queueId, snapshot }) — the per-snapshot eligibility sweep.',
    fields: { queueId: nonEmptyString, snapshot: eligibilitySnapshotField },
    subjects: subjectFields('queueId'),
  },
  {
    kind: 'queues.item.dispatch.next',
    description: 'QueueAuthority.dispatchNext({ queueId, linkedOperationId }) — the in-order dispatch step.',
    fields: { queueId: nonEmptyString, linkedOperationId: nonEmptyString },
    subjects: subjectFields('queueId'),
  },
  {
    kind: 'queues.item.dispatch.resolve',
    description: 'QueueAuthority.resolveDispatchedItem({ itemId, resolution }) — DISPATCHED -> GRADUATED (terminal).',
    fields: {
      itemId: nonEmptyString,
      resolution: guardOf(isDispatchResolution, 'must be RESOLVED_CONFIRMED or RESOLVED_FAILED (area 14 vocabulary)'),
    },
    subjects: subjectFields('itemId'),
  },
  {
    kind: 'queues.item.cancel',
    description: 'QueueAuthority.cancelItem({ itemId, reasonCode }) — the cancellation path (INTENT_CANCELLED | ROUTE_FAILED_DETERMINISTIC).',
    fields: {
      itemId: nonEmptyString,
      reasonCode: oneOfLiterals(
        ['INTENT_CANCELLED', 'ROUTE_FAILED_DETERMINISTIC'],
        'INTENT_CANCELLED or ROUTE_FAILED_DETERMINISTIC',
      ),
    },
    subjects: subjectFields('itemId'),
  },
  {
    kind: 'queues.items.due.expire',
    description: 'QueueAuthority.expireDueItems({ queueId, at? }) — the max-wait expiry sweep (scheduler-tick driven).',
    fields: { queueId: nonEmptyString, at: optional(protocolTimeValue) },
    subjects: subjectFields('queueId'),
  },
]);

// --- A09 Clearing Authority (5 command kinds) -----------------------------
// Authority id: clearing/evidence.ts CLEARING_AUTHORITY_ID = 'Clearing
// Authority'. Command surface: clearing/authority.ts ClearingAuthority.

const clearingCommands = authority(CLEARING_AUTHORITY_ID, CLEARING_AUTHORITY_ID, [
  {
    kind: 'clearing.batch.open',
    description: 'ClearingAuthority.openBatch({ batchLabel }) — the OPEN batch genesis.',
    fields: { batchLabel: nonEmptyString },
    subjects: noSubjects,
  },
  {
    kind: 'clearing.record.add',
    description:
      'ClearingAuthority.addRecord(batchId, record) — the record entry. NOTE: `amount` is deliberately NOT shape-checked at admission: ' +
      'the Clearing Authority defers amount validation to its stage-time QUARANTINE flow (a domain semantic admission must not preempt).',
    fields: { batchId: nonEmptyString, record: clearingRecordField },
    subjects: subjectFields('batchId'),
  },
  {
    kind: 'clearing.batch.stage',
    description: 'ClearingAuthority.stageBatch(batchId) — OPEN -> STAGED (per-currency summation; quarantine flow).',
    fields: { batchId: nonEmptyString },
    subjects: subjectFields('batchId'),
  },
  {
    kind: 'clearing.batch.commit',
    description: 'ClearingAuthority.commitBatch(batchId) — STAGED -> COMMITTED (batch idempotency key).',
    fields: { batchId: nonEmptyString },
    subjects: subjectFields('batchId'),
  },
  {
    kind: 'clearing.batch.finalize',
    description: 'ClearingAuthority.finalizeBatch(batchId) — COMMITTED -> FINAL (terminal; obligations already created at commit).',
    fields: { batchId: nonEmptyString },
    subjects: subjectFields('batchId'),
  },
]);

// --- A10 Obligation Ledger Authority (8 command kinds) --------------------
// Authority id: obligations/evidence.ts OBLIGATION_AUTHORITY_ID =
// 'Obligation Authority'. Command surface: obligations/authority.ts
// ObligationLedgerAuthority (the eight typed instruction commands; the
// generic applyInstruction dispatch is their union — one gateway kind per
// typed command keeps the kernel kind vocabulary lowercase-dot).

const obligationCommands = authority(OBLIGATION_AUTHORITY_ID, OBLIGATION_AUTHORITY_ID, [
  {
    kind: 'obligations.clearing.commit',
    description: 'ObligationLedgerAuthority.applyClearingCommand(...) — the clearing creation instruction (GC-4 single financial truth).',
    fields: {
      batchId: nonEmptyString,
      recordId: nonEmptyString,
      originActivityId: nonEmptyString,
      originKind: guardOf(isClearingOriginKind, 'must be ROUTE_PLAN_HOP | INTENT | RECONCILIATION_ADJUSTMENT'),
      debtorParticipantId: nonEmptyString,
      creditorParticipantId: nonEmptyString,
      amount: moneyValue,
      reason: nonEmptyString,
      correctionOf: optional(nonEmptyString),
    },
    invariants: [
      (body) =>
        body.debtorParticipantId === body.creditorParticipantId
          ? { path: 'creditorParticipantId', problem: 'debtor and creditor must be distinct participants' }
          : true,
    ],
    subjects: noSubjects,
  },
  {
    kind: 'obligations.correction.cancel',
    description: 'ObligationLedgerAuthority.applyClearingCorrectionCancel(...) — the correction-cancel instruction (mandatory evidence reference).',
    fields: {
      obligationId: nonEmptyString,
      replacementObligationId: nonEmptyString,
      evidenceReference: nonEmptyString,
    },
    subjects: subjectFields('obligationId'),
  },
  {
    kind: 'obligations.dispute.open',
    description: 'ObligationLedgerAuthority.openDispute(...) — the dispute-open instruction.',
    fields: { obligationId: nonEmptyString, disputeId: nonEmptyString },
    subjects: subjectFields('obligationId'),
  },
  {
    kind: 'obligations.dispute.resolve',
    description: 'ObligationLedgerAuthority.applyDisputeResolution(...) — the dispute resolution with replacement obligations.',
    fields: {
      disputeId: nonEmptyString,
      resolvedObligationId: nonEmptyString,
      replacements: arrayOf(obligationReplacementField, 'replacement obligations'),
    },
    subjects: subjectFields('disputeId', 'resolvedObligationId'),
  },
  {
    kind: 'obligations.writeoff.risk',
    description: 'ObligationLedgerAuthority.applyRiskWriteOff(...) — the risk write-off instruction.',
    fields: { obligationId: nonEmptyString, riskAuthorityReference: nonEmptyString },
    subjects: subjectFields('obligationId'),
  },
  {
    kind: 'obligations.netting.commit',
    description: 'ObligationLedgerAuthority.applyNettingCommit(...) — the netting-commit instruction (net obligations replace gross).',
    fields: {
      obligationId: nonEmptyString,
      nettingSetId: nonEmptyString,
      replacementObligationIds: arrayOf(nonEmptyString, 'obligation ids'),
    },
    subjects: subjectFields('obligationId', 'nettingSetId'),
  },
  {
    kind: 'obligations.settlement.instruction',
    description: 'ObligationLedgerAuthority.applySettlementInstruction(...) — SETTLEMENT_PENDING advance.',
    fields: { obligationId: nonEmptyString, settlementInstructionId: nonEmptyString },
    subjects: subjectFields('obligationId'),
  },
  {
    kind: 'obligations.settlement.finality',
    description: 'ObligationLedgerAuthority.applySettlementFinality(...) — SETTLED advance (finality, never reversed by deployment).',
    fields: { obligationId: nonEmptyString, finalityRecordId: nonEmptyString },
    subjects: subjectFields('obligationId'),
  },
]);

// --- A11 Netting Authority (5 command kinds) ------------------------------
// Authority id: netting/evidence.ts NETTING_AUTHORITY_ID = 'Netting
// Authority'. Command surface: netting/authority.ts NettingAuthority.

const nettingCommands = authority(NETTING_AUTHORITY_ID, NETTING_AUTHORITY_ID, [
  {
    kind: 'netting.set.open',
    description: 'NettingAuthority.openNettingSet({ label, scope, inputObligationIds }) — the OPEN set genesis (scope minted by mintNettingScope).',
    fields: {
      label: nonEmptyString,
      scope: mintedBy(mintNettingScope as (input: never) => unknown, 'netting scope'),
      inputObligationIds: arrayOf(nonEmptyString, 'obligation ids'),
    },
    subjects: noSubjects,
  },
  {
    kind: 'netting.set.compute',
    description: 'NettingAuthority.computeNettingSet(nettingSetId) — the conservation-proofed net-position computation (INV-11-1).',
    fields: { nettingSetId: nonEmptyString },
    subjects: subjectFields('nettingSetId'),
  },
  {
    kind: 'netting.set.commit',
    description: 'NettingAuthority.commitNettingSet(nettingSetId) — COMMITTED; net obligations replace the gross set (exactly once).',
    fields: { nettingSetId: nonEmptyString },
    subjects: subjectFields('nettingSetId'),
  },
  {
    kind: 'netting.position.instruction.apply',
    description: 'NettingAuthority.applyNetPositionSettlementInstruction({ netObligationId, settlementInstructionId }) — the A12 linkage (A11 emits no record; A12\'s does).',
    fields: { netObligationId: nonEmptyString, settlementInstructionId: nonEmptyString },
    subjects: subjectFields('netObligationId'),
  },
  {
    kind: 'netting.position.finality.apply',
    description: 'NettingAuthority.applyNetPositionSettlementFinality({ netObligationId, finalityRecordId }) — the A12 finality linkage.',
    fields: { netObligationId: nonEmptyString, finalityRecordId: nonEmptyString },
    subjects: subjectFields('netObligationId'),
  },
]);

// --- A12 Settlement and Finality Authority (6 command kinds) --------------
// Authority id: settlement/evidence.ts SETTLEMENT_AUTHORITY_ID = 'Settlement
// and Finality Authority'. Command surface: settlement/authority.ts
// SettlementAuthority.
//
// Port-binding interpretation (recorded): submitAttempt's and
// applyRailOutcome's RailAdapterConnection is a LIVE PORT, not a JSON
// value; the gateway admits the command's JSON-representable data
// (instructionId) and the transition runtime binds the connection
// server-side. Same for rails.operation.submit below.

const settlementCommands = authority(SETTLEMENT_AUTHORITY_ID, SETTLEMENT_AUTHORITY_ID, [
  {
    kind: 'settlement.instruction.create',
    description: 'SettlementAuthority.createSettlementInstruction({ subject, beneficiary, memo? }) — the instruction genesis.',
    fields: {
      subject: settlementSubjectField,
      beneficiary: nonEmptyString,
      memo: optional(plainString),
    },
    subjects: (body) => {
      const subject = body.subject as Record<string, unknown>;
      if (subject.kind === 'OBLIGATION') {
        return { ok: true, subjectIds: [subject.obligationId as string] };
      }
      return { ok: true, subjectIds: [subject.netObligationId as string] };
    },
  },
  {
    kind: 'settlement.attempt.authorize',
    description: 'SettlementAuthority.authorizeAttempt(instructionId, adapterId) — the rail operation authorization.',
    fields: { instructionId: nonEmptyString, adapterId: nonEmptyString },
    subjects: subjectFields('instructionId'),
  },
  {
    kind: 'settlement.attempt.submit',
    description:
      'SettlementAuthority.submitAttempt(instructionId, connection) — the transmission step. The live RailAdapterConnection is bound by the transition runtime; the gateway admits the JSON data.',
    fields: { instructionId: nonEmptyString },
    subjects: subjectFields('instructionId'),
  },
  {
    kind: 'settlement.attempt.railoutcome.apply',
    description:
      'SettlementAuthority.applyRailOutcome(instructionId) — pulls the latest adapter report into the attempt (connection bound by the transition runtime).',
    fields: { instructionId: nonEmptyString },
    subjects: subjectFields('instructionId'),
  },
  {
    kind: 'settlement.resolution.apply',
    description: 'SettlementAuthority.applyResolution(recovery, caseId?) — the area-14 recovery directive application.',
    fields: {
      recovery: recoveryDirectiveField,
      caseId: optional(nonEmptyString),
    },
    subjects: (body) => {
      const recovery = body.recovery as Record<string, unknown>;
      if (recovery.feed === 'AREA_09_10_NEW_LINKED_ENTRIES') {
        return { ok: true, subjectIds: [recovery.caseId as string] };
      }
      return { ok: true, subjectIds: [recovery.instructionId as string] };
    },
  },
  {
    kind: 'settlement.finality.declare',
    description: 'SettlementAuthority.declareFinality(instructionId) — FINALITY (terminal; deployment never un-finalizes).',
    fields: { instructionId: nonEmptyString },
    subjects: subjectFields('instructionId'),
  },
]);

// --- A13 Rail Adapter Authority (7 command kinds) -------------------------
// Authority id: rails/authority.ts RAIL_ADAPTER_AUTHORITY_ID = 'Rail Adapter
// Authority' (the module's exported id). The registry's A13 name is 'Rail
// Authority' (spec/registry/protocol-registry.json) — accepted below as an
// envelope ALIAS entry; evidence attribution normalizes to 'Rail Authority'
// (the EVIDENCE_AUTHORITIES member). Command surface: rails/authority.ts
// RailAdapterAuthority.

const railAdapterCommands = authority(RAIL_ADAPTER_AUTHORITY_ID, 'Rail Authority', [
  {
    kind: 'rails.adapter.register',
    description: 'RailAdapterAuthority.registerAdapter({ railFamily, name }) — the REGISTERED adapter genesis (adapter id derived from (railFamily, name)).',
    fields: { railFamily: nonEmptyString, name: nonEmptyString },
    subjects: noSubjects,
  },
  {
    kind: 'rails.adapter.activate',
    description: 'RailAdapterAuthority.activateAdapter(adapterId) — REGISTERED -> ACTIVE.',
    fields: { adapterId: nonEmptyString },
    subjects: subjectFields('adapterId'),
  },
  {
    kind: 'rails.adapter.degrade',
    description: 'RailAdapterAuthority.degradeAdapter(adapterId, reasonCode?) — ACTIVE -> DEGRADED (no new operations).',
    fields: { adapterId: nonEmptyString, reasonCode: optional(nonEmptyString) },
    subjects: subjectFields('adapterId'),
  },
  {
    kind: 'rails.adapter.retire',
    description: 'RailAdapterAuthority.retireAdapter(adapterId, reasonCode?) — DEGRADED -> RETIRED (recovery is a new registration).',
    fields: { adapterId: nonEmptyString, reasonCode: optional(nonEmptyString) },
    subjects: subjectFields('adapterId'),
  },
  {
    kind: 'rails.operation.authorize',
    description: 'RailAdapterAuthority.authorizeOperation({ instructionId, adapterId, payload }) — the GC-3 authorization (payload validated by the authority\'s own validator).',
    fields: {
      instructionId: nonEmptyString,
      adapterId: nonEmptyString,
      payload: mintedBy(validateRailOperationPayload as (input: never) => unknown, 'rail operation payload'),
    },
    invariants: [
      (body) => {
        const payload = body.payload as Record<string, unknown>;
        return payload.instructionId === body.instructionId
          ? true
          : {
              path: 'payload.instructionId',
              problem: 'must equal the command instructionId (the GC-3 authorization link)',
            };
      },
    ],
    subjects: subjectFields('instructionId'),
  },
  {
    kind: 'rails.operation.submit',
    description:
      'RailAdapterAuthority.submitRailOperation(operationId, connection) — the transmission step (fail-closed on UNKNOWN; the live connection is bound by the transition runtime).',
    fields: { operationId: nonEmptyString },
    subjects: subjectFields('operationId'),
  },
  {
    kind: 'rails.operation.report.record',
    description: 'RailAdapterAuthority.recordReport(operationId, report) — external result ingestion (evidence, not protocol truth).',
    fields: { operationId: nonEmptyString, report: railReportEnvelopeField },
    subjects: subjectFields('operationId'),
  },
]);

// --- A13 alias: the registry's owning-authority name 'Rail Authority' -----
// The kernel envelope's authority enumeration belongs to the registry
// projection (kernel/envelope.ts); spec/registry/protocol-registry.json A13
// names 'Rail Authority'. The alias entry accepts that name for the same
// command surface and attributes evidence to itself (it IS the
// EVIDENCE_AUTHORITIES member).

const railAuthorityAliasCommands = authority('Rail Authority', 'Rail Authority', [
  ...railAdapterCommands.commands.map((command) => ({ ...command, authority: 'Rail Authority' })),
]);

// --- A14 Reconciliation Authority (7 command kinds) -----------------------
// Authority id: rails/reconciliation.ts RECONCILIATION_AUTHORITY_ID =
// 'Reconciliation Authority'. Command surface: rails/reconciliation.ts
// ReconciliationAuthority. openCaseForUnknownOperation is the internal
// UnknownCaseOpener port (invoked BY the rail adapter authority, not an
// externally-submittable command) and is deliberately absent.

const reconciliationCommands = authority(RECONCILIATION_AUTHORITY_ID, RECONCILIATION_AUTHORITY_ID, [
  {
    kind: 'reconciliation.case.investigate',
    description: 'ReconciliationAuthority.investigateCase(caseId) — OPEN -> INVESTIGATING.',
    fields: { caseId: nonEmptyString },
    subjects: subjectFields('caseId'),
  },
  {
    kind: 'reconciliation.case.resolve',
    description: 'ReconciliationAuthority.resolveCase(caseId, resolution) — the terminal resolution (INV-14-3: adjustments are new linked entries).',
    fields: { caseId: nonEmptyString, resolution: caseResolutionInputField },
    subjects: subjectFields('caseId'),
  },
  {
    kind: 'reconciliation.source.register',
    description: 'ReconciliationAuthority.registerSource({ kind, description }) — the statement-source registry entry.',
    fields: { kind: nonEmptyString, description: nonEmptyString },
    subjects: noSubjects,
  },
  {
    kind: 'reconciliation.cycle.open',
    description: 'ReconciliationAuthority.openCycle({ windowStartWallMs, windowEndWallMs, sourceIds, ruleVersion? }) — the collection cycle genesis.',
    fields: {
      windowStartWallMs: safeInteger,
      windowEndWallMs: safeInteger,
      sourceIds: arrayOf(nonEmptyString, 'source ids'),
      ruleVersion: optional(positiveInteger),
    },
    subjects: noSubjects,
  },
  {
    kind: 'reconciliation.cycle.statements.collect',
    description: 'ReconciliationAuthority.collectStatements(cycleId, statements) — external statement ingestion (per-source sequences).',
    fields: {
      cycleId: nonEmptyString,
      statements: arrayOf(externalStatementField, 'external statement records'),
    },
    subjects: subjectFields('cycleId'),
  },
  {
    kind: 'reconciliation.cycle.matching.run',
    description: 'ReconciliationAuthority.runMatching(cycleId) — the deterministic matching run (drift detection).',
    fields: { cycleId: nonEmptyString },
    subjects: subjectFields('cycleId'),
  },
  {
    kind: 'reconciliation.cycle.close',
    description: 'ReconciliationAuthority.closeCycle(cycleId) — MATCHED -> CLOSED (terminal).',
    fields: { cycleId: nonEmptyString },
    subjects: subjectFields('cycleId'),
  },
]);

// --- A16 Risk and Compliance Authority (11 command kinds) -----------------
// Authority id: risk/evidence.ts RISK_AUTHORITY_ID = 'Risk and Compliance
// Authority'. Command surface: risk/authority.ts (the factory's returned
// RiskComplianceAuthority object). The risk authority takes a caller-supplied
// `when: ProtocolTime` per command (it has no clock) — bodies carry it.

const riskCommands = authority(RISK_AUTHORITY_ID, RISK_AUTHORITY_ID, [
  {
    kind: 'risk.rule.author',
    description: 'RiskComplianceAuthority.authorRule(ruleId, definition, when) — the AUTHORED rule genesis.',
    fields: { ruleId: nonEmptyString, definition: riskRuleDefinitionField, when: riskWhenField },
    subjects: noSubjects,
  },
  {
    kind: 'risk.rule.revise',
    description: 'RiskComplianceAuthority.reviseRule(ruleId, definition, when) — a new draft version.',
    fields: { ruleId: nonEmptyString, definition: riskRuleDefinitionField, when: riskWhenField },
    subjects: subjectFields('ruleId'),
  },
  {
    kind: 'risk.rule.publish',
    description: 'RiskComplianceAuthority.publishRule(ruleId, when) — AUTHORED -> VERSIONED.',
    fields: { ruleId: nonEmptyString, when: riskWhenField },
    subjects: subjectFields('ruleId'),
  },
  {
    kind: 'risk.rule.activate',
    description: 'RiskComplianceAuthority.activateRule(ruleId, version, when) — VERSIONED -> ACTIVE.',
    fields: { ruleId: nonEmptyString, version: positiveInteger, when: riskWhenField },
    subjects: subjectFields('ruleId'),
  },
  {
    kind: 'risk.rule.retire',
    description: 'RiskComplianceAuthority.retireRule(ruleId, version, when) — ACTIVE -> RETIRED.',
    fields: { ruleId: nonEmptyString, version: positiveInteger, when: riskWhenField },
    subjects: subjectFields('ruleId'),
  },
  {
    kind: 'risk.screeninglist.register',
    description: 'RiskComplianceAuthority.registerScreeningList({ listId, version, entries }, when) — the screening list version entry.',
    fields: {
      listId: nonEmptyString,
      version: positiveInteger,
      entries: arrayOf(nonEmptyString, 'screening entries'),
      when: riskWhenField,
    },
    subjects: noSubjects,
  },
  {
    kind: 'risk.subject.screen',
    description: 'RiskComplianceAuthority.screenSubject(subject, listId, when) — the screening computation (COMPUTED -> CLEAR | HIT).',
    fields: { subject: subjectComplianceDataField, listId: nonEmptyString, when: riskWhenField },
    subjects: noSubjects,
  },
  {
    kind: 'risk.check.evaluate',
    description: 'RiskComplianceAuthority.evaluateAndRecordCheck(subject, listId, when) — the recorded evaluation (INV-16-4 keyed).',
    fields: { subject: subjectComplianceDataField, listId: nonEmptyString, when: riskWhenField },
    subjects: noSubjects,
  },
  {
    kind: 'risk.check.decide',
    description: 'RiskComplianceAuthority.decideCheck(checkId, when) — auto-decision (forbidden for hits).',
    fields: { checkId: nonEmptyString, when: riskWhenField },
    subjects: subjectFields('checkId'),
  },
  {
    kind: 'risk.check.review.route',
    description: 'RiskComplianceAuthority.routeCheckToReview(checkId, when) — EVALUATED -> MANUAL_REVIEW (durable state).',
    fields: { checkId: nonEmptyString, when: riskWhenField },
    subjects: subjectFields('checkId'),
  },
  {
    kind: 'risk.check.review.record',
    description: 'RiskComplianceAuthority.recordCheckReview(checkId, review, when) — the reviewed decision with reviewer authority identity.',
    fields: {
      checkId: nonEmptyString,
      review: recordField(
        {
          reviewerAuthority: nonEmptyString,
          decision: oneOfLiterals(['APPROVED', 'DENIED'], 'APPROVED or DENIED'),
          rationale: nonEmptyString,
        },
        'a compliance review',
      ),
      when: riskWhenField,
    },
    subjects: subjectFields('checkId'),
  },
]);

/**
 * The gateway's command-authority registry: every merged command authority
 * (the operational spine A01-A14 plus A16), each with its command kinds.
 * Frozen at module load (a closed catalogue — no runtime extension).
 *
 * Source: RTN-010.md lines 10, 14; the shared-context note that ALL
 * authorities are merged at this base (A01-A16); rtn-plan-rulings.md Q4.
 */
export const GATEWAY_COMMAND_AUTHORITIES: readonly AuthorityCommands[] = Object.freeze([
  intentCommands,
  policyCommands,
  capabilityCommands,
  routingCommands,
  reservationCommands,
  liquidityCommands,
  creditCommands,
  queueCommands,
  clearingCommands,
  obligationCommands,
  nettingCommands,
  settlementCommands,
  railAdapterCommands,
  railAuthorityAliasCommands,
  reconciliationCommands,
  riskCommands,
]);

/**
 * The envelope authority vocabulary: every authority id a command envelope
 * may target (the merged modules' exported ids plus the registry's A13
 * 'Rail Authority' alias). This is the `allowedAuthorities` list the
 * gateway passes to the kernel envelope validator.
 *
 * Source: kernel/envelope.ts validateCommandEnvelope (allowedAuthorities);
 * spec/registry/protocol-registry.json (the authority-name projection).
 */
export const GATEWAY_ENVELOPE_AUTHORITIES: readonly string[] = Object.freeze(
  GATEWAY_COMMAND_AUTHORITIES.map((entry) => entry.authority),
);

/**
 * The evidence-authority mapping: envelope authority id -> the
 * EVIDENCE_AUTHORITIES member rejection evidence attributes to (identity
 * for every authority except the rails adapter label, which normalizes to
 * the registry's 'Rail Authority').
 *
 * Source: evidence/record.ts EVIDENCE_AUTHORITIES; the module doc's
 * attribution ruling.
 */
export const GATEWAY_EVIDENCE_AUTHORITY_BY_ENVELOPE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    GATEWAY_COMMAND_AUTHORITIES.map((entry) => [entry.authority, entry.evidenceAuthority] as const),
  ),
);

/**
 * The total number of DISTINCT command kinds in the registry (the alias
 * entry re-exposes the rail adapter kinds under the registry name and does
 * not double the count).
 *
 * Source: RTN-010.md line 14 (every authority command kind admitted or
 * rejected — this is the count of them).
 */
export const GATEWAY_COMMAND_KIND_COUNT: number = new Set(
  GATEWAY_COMMAND_AUTHORITIES.flatMap((entry) => entry.commands.map((command) => command.kind)),
).size;

/**
 * Find one authority's registry entry by envelope authority id.
 *
 * Source: kernel/envelope.ts (the authority target); RTN-010.md line 10.
 */
export function findAuthorityCommands(authorityId: string): AuthorityCommands | undefined {
  return GATEWAY_COMMAND_AUTHORITIES.find((entry) => entry.authority === authorityId);
}

/**
 * Find one command's specification by (envelope authority id, command
 * kind) — the exact pair the admission surface validates against.
 *
 * Source: RTN-010.md lines 10, 14.
 */
export function findCommandSpec(
  authorityId: string,
  kind: string,
): { readonly authority: AuthorityCommands; readonly spec: CommandSpec } | undefined {
  const authority = findAuthorityCommands(authorityId);
  if (authority === undefined) {
    return undefined;
  }
  const spec = authority.commands.find((command) => command.kind === kind);
  return spec === undefined ? undefined : { authority, spec };
}
