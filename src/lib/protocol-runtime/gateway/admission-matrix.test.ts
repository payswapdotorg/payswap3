/**
 * RTN-010 — Admission validation matrix: every authority command kind is
 * admitted or rejected with a deterministic reason code.
 *
 * Work order acceptance (RTN-010.md line 14): "Every authority command
 * kind is admitted or rejected with a deterministic reason code; no
 * financial effect occurs at admission (effects occur only via the
 * transition path)." Required evidence (line 24): "Admission validation
 * tests (per command kind: accept/reject matrix)."
 *
 * This suite is the per-command-kind accept/reject matrix, data-driven
 * over the registry itself: a valid sample body for EVERY registered kind
 * (the completeness assertion at the top proves the sample table covers
 * the registry exactly), then — per kind — the generic reject family
 * (non-object body, each required field omitted, each required field
 * nulled, an undeclared extra field, a subject-binding mismatch) plus the
 * shared envelope-level and attribution-level rejects. Selected
 * kind-specific semantic rejects (vocabularies, cross-field invariants,
 * mint failures) follow the generic matrix.
 *
 * "No financial effect at admission" is structural: the gateway under
 * test holds NO authority instances at all (its only collaborators are the
 * evidence log and the queue double) — there is nothing financial it
 * could effect; the queue double records the durable submission and the
 * log records the admission decisions.
 */

import { describe, expect, test } from 'bun:test';
import { createEvidenceLog } from '../evidence/log.ts';
import type { EvidenceLog } from '../evidence/log.ts';
import { money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';
import { ProtocolGateway } from './admission.ts';
import type { CommandAdmissionResult } from './admission.ts';
import {
  GATEWAY_COMMAND_AUTHORITIES,
  GATEWAY_COMMAND_KIND_COUNT,
  findCommandSpec,
} from './registry.ts';
import type { CommandSpec } from './registry.ts';
import type { OptionalField } from './schema.ts';

// ---------------------------------------------------------------------------
// The in-surface command queue double (bun cannot open node:sqlite; the
// REAL DurableQueue integration is scripts/test_protocol_gateway.mjs)
// ---------------------------------------------------------------------------

class QueueDouble {
  readonly calls: Array<{ readonly kind: string; readonly payload: unknown; readonly idempotencyKey: string }> = [];
  readonly jobs = new Map<string, string>();
  failNext = false;

  enqueue(
    kind: string,
    payload: unknown,
    options: { readonly idempotencyKey: string },
  ): { readonly created: boolean; readonly reason: 'enqueued' | 'deduplicated'; readonly jobId: string } {
    this.calls.push({ kind, payload, idempotencyKey: options.idempotencyKey });
    if (this.failNext) {
      this.failNext = false;
      throw new Error('queue double: induced submit failure');
    }
    const key = `${kind}\u0000${options.idempotencyKey}`;
    const existing = this.jobs.get(key);
    if (existing !== undefined) {
      return { created: false, reason: 'deduplicated', jobId: existing };
    }
    const jobId = `job-${this.jobs.size + 1}`;
    this.jobs.set(key, jobId);
    return { created: true, reason: 'enqueued', jobId };
  }
}

function makeGateway(): { log: EvidenceLog; queue: QueueDouble; gateway: ProtocolGateway } {
  const log = createEvidenceLog({ wallMs: 1_000 });
  const queue = new QueueDouble();
  const gateway = new ProtocolGateway({ evidence: log, queue, wallClock: () => 5_000 });
  return { log, queue, gateway };
}

// ---------------------------------------------------------------------------
// Valid sample bodies for EVERY registered command kind
// ---------------------------------------------------------------------------

const EUR = (amountMinor: number) => money('EUR', amountMinor, 2);

const sampleDescriptor = {
  amount: money('EUR', 1_000, 2),
  source: { currency: 'EUR', geography: 'DE', account: 'acct-source' },
  destination: { currency: 'USD', geography: 'US', account: 'acct-destination' },
  constraints: {
    deadlineEpochMs: 60_000,
    allowedRails: ['rail-a'],
    costCeiling: money('USD', 500, 2),
  },
  idempotencyKey: 'descriptor-key-1',
};

const sampleIntentTerms = {
  amount: money('EUR', 1_000, 2),
  sourceCurrency: 'EUR',
  destinationCurrency: 'USD',
  sourceGeography: 'DE',
  destinationGeography: 'US',
  deadlineEpochMs: 60_000,
  allowedRails: ['rail-a'],
  costCeiling: money('EUR', 500, 2),
};

const sampleCorridor = {
  sourceCurrency: 'EUR',
  destinationCurrency: 'USD',
  sourceGeography: 'DE',
  destinationGeography: 'US',
};

const sampleSnapshotEntry = {
  capabilityId: 'cap-1',
  railId: 'rail-a',
  corridor: sampleCorridor,
  state: 'ACTIVE',
  declaredCapacity: EUR(100_000),
  reservedTotal: EUR(0),
  consumedTotal: EUR(0),
  availableCapacity: EUR(100_000),
  costSchedule: EUR(25),
  tier: 'STANDARD',
};

const sampleSnapshot = {
  snapshotId: 'pid.v1.snapshot-sample',
  sequence: 1,
  wallMs: 1_000,
  capabilities: [sampleSnapshotEntry],
};

const sampleRouteRequirement = {
  capabilityId: 'cap-1',
  railId: 'rail-a',
  sourceCurrency: 'EUR',
  destinationCurrency: 'USD',
  costSchedule: EUR(25),
  tier: 'STANDARD',
};

const samplePolicyEvaluation = {
  satisfiable: true,
  result: {
    rankedRouteRequirements: [sampleRouteRequirement],
    constraintEnvelope: { allowedRails: ['rail-a'], ordering: 'COST_ASC', fallbackPreference: ['rail-b'] },
    costCeiling: EUR(500),
    deadlineEpochMs: 60_000,
  },
};

const samplePolicyDefinition = {
  allowedRails: ['rail-a'],
  ordering: 'COST_ASC',
  costCeiling: EUR(500),
  deadlineEpochMs: 60_000,
  fallbackPreference: ['rail-b'],
};

const sampleRiskRuleDefinition = {
  kind: 'THRESHOLD',
  fact: { factClass: 'MONEY', currency: 'EUR' },
  bound: { boundClass: 'MONEY', currency: 'EUR', amountMinor: 500_000 },
  operator: 'GT',
  onBreach: 'REVIEW',
};

const sampleSubjectData = { subjectId: 'subject-1', subjectKind: 'INTENT' };

const when = protocolTime(0, 1_000);

/**
 * One valid body per registered command kind, keyed by kind. The
 * completeness test below asserts the key set equals the registry's kind
 * set exactly (112 kinds).
 */
const SAMPLES: Record<string, Record<string, unknown>> = {
  // --- A01 Intent Authority -------------------------------------------------
  'intent.submit': { descriptor: sampleDescriptor },
  'intent.authorize': { intentId: 'pid.v1.intent-sample', policyDecisionId: 'pid.v1.decision-sample' },
  'intent.route': { intentId: 'pid.v1.intent-sample' },
  'intent.fulfilling.start': { intentId: 'pid.v1.intent-sample' },
  'intent.fulfill': { intentId: 'pid.v1.intent-sample' },
  'intent.fail': { intentId: 'pid.v1.intent-sample', reasonCode: 'NO_VIABLE_ROUTE' },
  'intent.cancel': { intentId: 'pid.v1.intent-sample', reasonCode: 'PAYER_CANCELLED' },

  // --- A02 Fulfillment Policy Authority --------------------------------------
  'policy.author': { policyId: 'policy-1', definition: samplePolicyDefinition },
  'policy.version.publish': { policyId: 'policy-1' },
  'policy.attach': {
    policyId: 'policy-1',
    version: 1,
    intentId: 'pid.v1.intent-sample',
    snapshotId: 'pid.v1.snapshot-sample',
  },
  'policy.evaluate': {
    policyId: 'policy-1',
    version: 1,
    intentId: 'pid.v1.intent-sample',
    intentTerms: sampleIntentTerms,
    snapshot: sampleSnapshot,
  },
  'policy.evaluation.consume': { evaluationId: 'pid.v1.evaluation-sample' },

  // --- A03 Capability Authority ----------------------------------------------
  'capability.register': {
    capabilityId: 'cap-1',
    declaration: { railId: 'rail-a', corridor: sampleCorridor, costSchedule: EUR(25), tier: 'STANDARD' },
    declaredCapacity: EUR(100_000),
  },
  'capability.activate': { capabilityId: 'cap-1' },
  'capability.degrade': { capabilityId: 'cap-1' },
  'capability.retire': { capabilityId: 'cap-1' },
  'capability.commitment.offer': {
    intentId: 'pid.v1.intent-sample',
    capabilityId: 'cap-1',
    amount: EUR(1_000),
    deadlineEpochMs: 60_000,
  },
  'capability.commitment.reserve': { commitmentId: 'pid.v1.commitment-sample' },
  'capability.commitment.consume': { commitmentId: 'pid.v1.commitment-sample' },
  'capability.commitment.release': { commitmentId: 'pid.v1.commitment-sample' },
  'capability.commitment.expire': { commitmentId: 'pid.v1.commitment-sample', wallMs: 60_000 },

  // --- A04 Routing Authority --------------------------------------------------
  'routing.compile': {
    intentId: 'pid.v1.intent-sample',
    intentTerms: sampleIntentTerms,
    policyEvaluation: samplePolicyEvaluation,
    snapshot: sampleSnapshot,
  },
  'routing.plan.validate': { planId: 'pid.v1.plan-sample' },
  'routing.plan.dispatch': { planId: 'pid.v1.plan-sample' },
  'routing.hop.unknown.record': {
    planId: 'pid.v1.plan-sample',
    hopId: 'hop-1',
    railOperationId: 'pid.v1.rail-op-sample',
  },
  'routing.hop.unknown.resolve': { planId: 'pid.v1.plan-sample', hopId: 'hop-1', resolvedOutcome: 'CONFIRMED' },
  'routing.plan.complete': { planId: 'pid.v1.plan-sample' },
  'routing.plan.fail': { planId: 'pid.v1.plan-sample', reasonCode: 'HOP_FAILED' },
  'routing.plan.abandon': { planId: 'pid.v1.plan-sample', reasonCode: 'SUPERSEDED' },

  // --- A05 Reservation Authority ----------------------------------------------
  'reservations.resource.declare': { resourceId: 'resource-1', declaredTotal: EUR(10_000) },
  'reservations.hold.request': {
    intentId: 'pid.v1.intent-sample',
    hopId: 'hop-1',
    resourceId: 'resource-1',
    amount: EUR(1_000),
    deadlineEpochMs: 60_000,
  },
  'reservations.hold.consume': { reservationId: 'pid.v1.reservation-sample' },
  'reservations.hold.release': { reservationId: 'pid.v1.reservation-sample' },
  'reservations.due.expire': { at: protocolTime(3, 3_000) },

  // --- A06 Liquidity Authority -------------------------------------------------
  'liquidity.pool.open': { poolId: 'pool-1', currency: 'EUR', scale: 2 },
  'liquidity.pool.freeze': { poolId: 'pool-1' },
  'liquidity.pool.close': { poolId: 'pool-1' },
  'liquidity.funding.record': {
    poolId: 'pool-1',
    source: { kind: 'INTERNAL_TRANSFER', referenceId: 'funding-ref-1' },
    amount: EUR(5_000),
  },
  'liquidity.funding.pending.open': {
    poolId: 'pool-1',
    railOperationId: 'pid.v1.rail-op-sample',
    expectedAmount: EUR(5_000),
  },
  'liquidity.funding.pending.resolve': { pendingId: 'pid.v1.pending-sample', resolution: 'RESOLVED_CONFIRMED' },
  'liquidity.hold.request': {
    positionId: 'pid.v1.position-sample',
    intentId: 'pid.v1.intent-sample',
    hopId: 'hop-1',
    amount: EUR(1_000),
    deadlineEpochMs: 60_000,
  },
  'liquidity.hold.consume': { reservationId: 'pid.v1.reservation-sample' },
  'liquidity.hold.release': { reservationId: 'pid.v1.reservation-sample' },
  'liquidity.holds.due.expire': { at: protocolTime(3, 3_000) },

  // --- A07 Credit Authority ----------------------------------------------------
  'credit.line.offer': { lineId: 'line-1', limit: EUR(10_000) },
  'credit.line.activate': { lineId: 'line-1' },
  'credit.line.suspend': { lineId: 'line-1' },
  'credit.line.close': { lineId: 'line-1' },
  'credit.usage.evaluate': {
    intentId: 'pid.v1.intent-sample',
    lineId: 'line-1',
    requestedAmount: EUR(1_000),
  },
  'credit.decision.apply': {
    decisionId: 'pid.v1.decision-sample',
    hopId: 'hop-1',
    deadlineEpochMs: 60_000,
  },
  'credit.reservation.consume': { reservationId: 'pid.v1.reservation-sample' },
  'credit.reservation.release': { reservationId: 'pid.v1.reservation-sample' },
  'credit.reservations.due.expire': { at: protocolTime(3, 3_000) },

  // --- A08 Queue Authority ------------------------------------------------------
  'queues.queue.create': {
    queueId: 'queue-1',
    policy: {
      orderingRule: 'PRIORITY_CLASS_THEN_SEQUENCE_NUMBER',
      maxWaitEpochMs: 60_000,
      releaseConditions: { requiredCapabilityTier: 'STANDARD' },
    },
  },
  'queues.queue.drain.start': { queueId: 'queue-1' },
  'queues.queue.pause': { queueId: 'queue-1' },
  'queues.queue.close': { queueId: 'queue-1' },
  'queues.item.enqueue': {
    queueId: 'queue-1',
    intentId: 'pid.v1.intent-sample',
    priorityClass: 0,
    terms: { intentId: 'pid.v1.intent-sample', terms: EUR(1_000) },
  },
  'queues.eligibility.evaluate': {
    queueId: 'queue-1',
    snapshot: {
      liquidity: [{ poolId: 'pool-1', available: EUR(9_000) }],
      capability: [{ capabilityId: 'cap-1', tier: 'STANDARD', state: 'ACTIVE' }],
      credit: [{ lineId: 'line-1', remaining: EUR(9_000) }],
      at: protocolTime(3, 3_000),
    },
  },
  'queues.item.dispatch.next': { queueId: 'queue-1', linkedOperationId: 'pid.v1.operation-sample' },
  'queues.item.dispatch.resolve': { itemId: 'pid.v1.item-sample', resolution: 'RESOLVED_CONFIRMED' },
  'queues.item.cancel': { itemId: 'pid.v1.item-sample', reasonCode: 'INTENT_CANCELLED' },
  'queues.items.due.expire': { queueId: 'queue-1', at: protocolTime(3, 3_000) },

  // --- A09 Clearing Authority ----------------------------------------------------
  'clearing.batch.open': { batchLabel: 'batch-2026-01' },
  'clearing.record.add': {
    batchId: 'pid.v1.batch-sample',
    record: {
      origin: { originActivityId: 'activity-1', originKind: 'INTENT' },
      parties: { debtorParticipantId: 'participant-de', creditorParticipantId: 'participant-cr' },
      amount: EUR(1_000),
      reason: 'settlement-of-intent',
    },
  },
  'clearing.batch.stage': { batchId: 'pid.v1.batch-sample' },
  'clearing.batch.commit': { batchId: 'pid.v1.batch-sample' },
  'clearing.batch.finalize': { batchId: 'pid.v1.batch-sample' },

  // --- A10 Obligation Ledger Authority --------------------------------------------
  'obligations.clearing.commit': {
    batchId: 'pid.v1.batch-sample',
    recordId: 'pid.v1.clearing-record-sample',
    originActivityId: 'activity-1',
    originKind: 'INTENT',
    debtorParticipantId: 'participant-de',
    creditorParticipantId: 'participant-cr',
    amount: EUR(1_000),
    reason: 'settlement-of-intent',
  },
  'obligations.correction.cancel': {
    obligationId: 'pid.v1.obligation-sample',
    replacementObligationId: 'pid.v1.obligation-replacement',
    evidenceReference: 'evidence-ref-1',
  },
  'obligations.dispute.open': {
    obligationId: 'pid.v1.obligation-sample',
    disputeId: 'pid.v1.dispute-sample',
  },
  'obligations.dispute.resolve': {
    disputeId: 'pid.v1.dispute-sample',
    resolvedObligationId: 'pid.v1.obligation-sample',
    replacements: [
      {
        debtorParticipantId: 'participant-de',
        creditorParticipantId: 'participant-cr',
        amount: EUR(500),
        reason: 'dispute-split',
      },
    ],
  },
  'obligations.writeoff.risk': {
    obligationId: 'pid.v1.obligation-sample',
    riskAuthorityReference: 'risk-ref-1',
  },
  'obligations.netting.commit': {
    obligationId: 'pid.v1.obligation-sample',
    nettingSetId: 'pid.v1.netting-set-sample',
    replacementObligationIds: ['pid.v1.obligation-replacement'],
  },
  'obligations.settlement.instruction': {
    obligationId: 'pid.v1.obligation-sample',
    settlementInstructionId: 'pid.v1.settlement-instruction-sample',
  },
  'obligations.settlement.finality': {
    obligationId: 'pid.v1.obligation-sample',
    finalityRecordId: 'pid.v1.finality-sample',
  },

  // --- A11 Netting Authority ---------------------------------------------------------
  'netting.set.open': {
    label: 'netting-set-1',
    scope: { kind: 'BILATERAL', participants: ['participant-de', 'participant-cr'] },
    inputObligationIds: ['pid.v1.obligation-sample'],
  },
  'netting.set.compute': { nettingSetId: 'pid.v1.netting-set-sample' },
  'netting.set.commit': { nettingSetId: 'pid.v1.netting-set-sample' },
  'netting.position.instruction.apply': {
    netObligationId: 'pid.v1.net-obligation-sample',
    settlementInstructionId: 'pid.v1.settlement-instruction-sample',
  },
  'netting.position.finality.apply': {
    netObligationId: 'pid.v1.net-obligation-sample',
    finalityRecordId: 'pid.v1.finality-sample',
  },

  // --- A12 Settlement and Finality Authority -------------------------------------------
  'settlement.instruction.create': {
    subject: { kind: 'OBLIGATION', obligationId: 'pid.v1.obligation-sample' },
    beneficiary: 'beneficiary-1',
  },
  'settlement.attempt.authorize': {
    instructionId: 'pid.v1.settlement-instruction-sample',
    adapterId: 'pid.v1.adapter-sample',
  },
  'settlement.attempt.submit': { instructionId: 'pid.v1.settlement-instruction-sample' },
  'settlement.attempt.railoutcome.apply': { instructionId: 'pid.v1.settlement-instruction-sample' },
  'settlement.resolution.apply': {
    recovery: {
      feed: 'AREA_12_FINALITY_ADVANCE',
      instructionId: 'pid.v1.settlement-instruction-sample',
      operationId: 'pid.v1.rail-op-sample',
      attemptOutcome: 'CONFIRMED',
    },
  },
  'settlement.finality.declare': { instructionId: 'pid.v1.settlement-instruction-sample' },

  // --- A13 Rail Adapter Authority ---------------------------------------------------------
  'rails.adapter.register': { railFamily: 'bank-sepa', name: 'adapter-1' },
  'rails.adapter.activate': { adapterId: 'pid.v1.adapter-sample' },
  'rails.adapter.degrade': { adapterId: 'pid.v1.adapter-sample' },
  'rails.adapter.retire': { adapterId: 'pid.v1.adapter-sample' },
  'rails.operation.authorize': {
    instructionId: 'pid.v1.settlement-instruction-sample',
    adapterId: 'pid.v1.adapter-sample',
    payload: {
      instructionId: 'pid.v1.settlement-instruction-sample',
      money: EUR(1_000),
      beneficiary: 'beneficiary-1',
    },
  },
  'rails.operation.submit': { operationId: 'pid.v1.rail-op-sample' },
  'rails.operation.report.record': {
    operationId: 'pid.v1.rail-op-sample',
    report: {
      outcomeClass: 'CONFIRMED',
      railReferences: ['rail-ref-1'],
      payloadHash: 'rph.v1.0123456789abcdef',
      reportedAtWallMs: 1_500,
    },
  },

  // --- A14 Reconciliation Authority ----------------------------------------------------------
  'reconciliation.case.investigate': { caseId: 'pid.v1.case-sample' },
  'reconciliation.case.resolve': {
    caseId: 'pid.v1.case-sample',
    resolution: { resolution: 'RESOLVED_CONFIRMED', proof: { externalRefs: ['rail-ref-1'] } },
  },
  'reconciliation.source.register': { kind: 'bank-feed', description: 'SEPA statement feed' },
  'reconciliation.cycle.open': {
    windowStartWallMs: 1_000,
    windowEndWallMs: 2_000,
    sourceIds: ['source-1'],
  },
  'reconciliation.cycle.statements.collect': {
    cycleId: 'pid.v1.cycle-sample',
    statements: [
      {
        sourceId: 'source-1',
        sequence: 1,
        railReference: 'rail-ref-1',
        outcomeClass: 'CONFIRMED',
        amountMinor: 1_000,
        currency: 'EUR',
        assertedAtWallMs: 1_500,
      },
    ],
  },
  'reconciliation.cycle.matching.run': { cycleId: 'pid.v1.cycle-sample' },
  'reconciliation.cycle.close': { cycleId: 'pid.v1.cycle-sample' },

  // --- A16 Risk and Compliance Authority --------------------------------------------------------
  'risk.rule.author': { ruleId: 'rule-1', definition: sampleRiskRuleDefinition, when },
  'risk.rule.revise': { ruleId: 'rule-1', definition: sampleRiskRuleDefinition, when },
  'risk.rule.publish': { ruleId: 'rule-1', when },
  'risk.rule.activate': { ruleId: 'rule-1', version: 1, when },
  'risk.rule.retire': { ruleId: 'rule-1', version: 1, when },
  'risk.screeninglist.register': { listId: 'list-1', version: 1, entries: ['entry-1'], when },
  'risk.subject.screen': { subject: sampleSubjectData, listId: 'list-1', when },
  'risk.check.evaluate': { subject: sampleSubjectData, listId: 'list-1', when },
  'risk.check.decide': { checkId: 'pid.v1.check-sample', when },
  'risk.check.review.route': { checkId: 'pid.v1.check-sample', when },
  'risk.check.review.record': {
    checkId: 'pid.v1.check-sample',
    review: {
      reviewerAuthority: 'Risk and Compliance Authority',
      decision: 'APPROVED',
      rationale: 'verified within threshold',
    },
    when,
  },
};

// ---------------------------------------------------------------------------
// Matrix helpers
// ---------------------------------------------------------------------------

function requiredFields(spec: CommandSpec): string[] {
  return Object.entries(spec.fields)
    .filter(([, fieldSpec]) => !isOptional(fieldSpec))
    .map(([name]) => name);
}

function isOptional(fieldSpec: unknown): boolean {
  return (
    typeof fieldSpec === 'object' &&
    fieldSpec !== null &&
    (fieldSpec as { specKind?: unknown }).specKind === 'optional'
  );
}

function envelopeFor(spec: CommandSpec, body: unknown, subjectIds: readonly string[], idempotencyKey: string): unknown {
  return {
    kind: spec.kind,
    authority: spec.authority,
    subjectIds: [...subjectIds],
    idempotencyKey,
    protocolTime: when,
    body,
  };
}

function subjectsFor(spec: CommandSpec, body: Record<string, unknown>): readonly string[] {
  const resolution = spec.subjects(body);
  if (!resolution.ok) {
    throw new TypeError(`sample for ${spec.kind} fails its own subject resolution: ${resolution.problem}`);
  }
  return resolution.subjectIds;
}

async function admit(gateway: ProtocolGateway, spec: CommandSpec, body: unknown): Promise<CommandAdmissionResult> {
  const sample = SAMPLES[spec.kind];
  const subjects = subjectsFor(spec, sample);
  return gateway.submitCommand(envelopeFor(spec, body, subjects, `idem-${spec.kind}`));
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

describe('RTN-010 admission matrix — registry completeness and coverage', () => {
  test('the sample table covers the registry EXACTLY (every one of the 112 command kinds, no extras)', () => {
    const registryKinds = new Set(
      GATEWAY_COMMAND_AUTHORITIES.flatMap((entry) => entry.commands.map((command) => command.kind)),
    );
    expect(registryKinds.size).toBe(GATEWAY_COMMAND_KIND_COUNT);
    expect(registryKinds.size).toBe(112);
    const sampleKinds = new Set(Object.keys(SAMPLES));
    expect(sampleKinds.size).toBe(registryKinds.size);
    for (const kind of registryKinds) {
      expect(sampleKinds.has(kind)).toBe(true);
    }
    for (const kind of sampleKinds) {
      expect(registryKinds.has(kind)).toBe(true);
    }
  });

  test('every registered sample body satisfies its own spec (fields, invariants, subject resolution)', () => {
    for (const entry of GATEWAY_COMMAND_AUTHORITIES) {
      for (const spec of entry.commands) {
        const found = findCommandSpec(entry.authority, spec.kind);
        expect(found !== undefined).toBe(true);
        const resolution = spec.subjects(SAMPLES[spec.kind]);
        expect(resolution.ok).toBe(true);
      }
    }
  });
});

describe('RTN-010 admission matrix — accept: every command kind is admitted', () => {
  for (const entry of GATEWAY_COMMAND_AUTHORITIES) {
    for (const spec of entry.commands) {
      test(`${spec.authority} · ${spec.kind} — accepted, receipt recorded, enqueued exactly once, no authority touched`, async () => {
        const { log, queue, gateway } = makeGateway();
        const logHeightBefore = log.height;
        const result = await admit(gateway, spec, SAMPLES[spec.kind]);
        if (!result.ok) {
          throw new TypeError(`expected admission, got rejection: ${result.problem}`);
        }
        expect(result.replayed).toBe(false);
        expect(result.created).toBe(true);
        expect(result.receipt.state).toBe('ADMITTED');
        expect(result.receipt.outcome).toBe('ADMITTED');
        expect(result.receipt.commandId.startsWith('pid.v1.')).toBe(true);
        expect(result.jobId).toBe('job-1');
        // exactly ONE durable submission; the payload IS the submitted envelope
        expect(queue.calls.length).toBe(1);
        expect(queue.calls[0].kind).toBe(spec.kind);
        expect(queue.calls[0].idempotencyKey).toBe(`idem-${spec.kind}`);
        const payload = queue.calls[0].payload as Record<string, unknown>;
        expect(payload.kind).toBe(spec.kind);
        expect(payload.authority).toBe(spec.authority);
        expect(payload.idempotencyKey).toBe(`idem-${spec.kind}`);
        expect(payload.body).toBe(SAMPLES[spec.kind]);
        // the receipt is recorded under (kind, key)
        expect(gateway.getReceipt(spec.kind, `idem-${spec.kind}`)).toBe(result.receipt);
        // no rejection evidence for an accepted command
        expect(log.height).toBe(logHeightBefore);
      });
    }
  }
});

describe('RTN-010 admission matrix — reject: per-kind generic rejects', () => {
  for (const entry of GATEWAY_COMMAND_AUTHORITIES) {
    for (const spec of entry.commands) {
      const subjects = () => subjectsFor(spec, SAMPLES[spec.kind]);

      test(`${spec.kind} — non-object body rejected with COMMAND_BODY_INVALID`, async () => {
        const { gateway } = makeGateway();
        const result = await gateway.submitCommand(
          envelopeFor(spec, null, subjects(), `idem-${spec.kind}-null`),
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reasonCode).toBe('COMMAND_BODY_INVALID');
      });

      for (const field of requiredFields(spec)) {
        test(`${spec.kind} — omitted required field "${field}" rejected with COMMAND_BODY_INVALID`, async () => {
          const { gateway } = makeGateway();
          const body = { ...SAMPLES[spec.kind] };
          delete (body as Record<string, unknown>)[field];
          const result = await admit(gateway, spec, body);
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.reasonCode).toBe('COMMAND_BODY_INVALID');
          expect(result.field).toBe(field);
          expect(result.problem).toContain('is required');
        });

        test(`${spec.kind} — nulled required field "${field}" rejected with COMMAND_BODY_INVALID`, async () => {
          const { gateway } = makeGateway();
          const body = { ...SAMPLES[spec.kind], [field]: null };
          const result = await admit(gateway, spec, body);
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.reasonCode).toBe('COMMAND_BODY_INVALID');
        });
      }

      test(`${spec.kind} — undeclared extra body field rejected with COMMAND_BODY_INVALID`, async () => {
        const { gateway } = makeGateway();
        const body = { ...SAMPLES[spec.kind], surpriseField: 1 };
        const result = await admit(gateway, spec, body);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reasonCode).toBe('COMMAND_BODY_INVALID');
        expect(result.field).toBe('surpriseField');
      });

      test(`${spec.kind} — subject-binding mismatch rejected with COMMAND_SUBJECT_INVALID`, async () => {
        const { gateway } = makeGateway();
        const wrongSubjects = subjects().length === 0 ? ['pid.v1.not-a-subject'] : [];
        const result = await gateway.submitCommand(
          envelopeFor(spec, SAMPLES[spec.kind], wrongSubjects, `idem-${spec.kind}-subjects`),
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reasonCode).toBe('COMMAND_SUBJECT_INVALID');
      });
    }
  }
});

describe('RTN-010 admission matrix — envelope-level and attribution-level rejects', () => {
  const intentSpec = findCommandSpec('Intent Authority', 'intent.authorize')?.spec;
  if (intentSpec === undefined) {
    throw new TypeError('matrix setup: intent.authorize spec not found');
  }
  const intentSample = SAMPLES['intent.authorize'];
  const intentSubjects = subjectsFor(intentSpec, intentSample);

  test('malformed kind (uppercase segments) rejected with ENVELOPE_INVALID', async () => {
    const { gateway } = makeGateway();
    const result = await gateway.submitCommand({
      kind: 'Intent.Authorize',
      authority: 'Intent Authority',
      subjectIds: intentSubjects,
      idempotencyKey: 'idem-envelope-1',
      protocolTime: when,
      body: intentSample,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('ENVELOPE_INVALID');
    expect(result.field).toBe('kind');
  });

  test('missing idempotency key rejected with ENVELOPE_INVALID (protocol commands never opt out of dedupe)', async () => {
    const { gateway } = makeGateway();
    const result = await gateway.submitCommand({
      kind: 'intent.authorize',
      authority: 'Intent Authority',
      subjectIds: intentSubjects,
      idempotencyKey: '',
      protocolTime: when,
      body: intentSample,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('ENVELOPE_INVALID');
    expect(result.field).toBe('idempotencyKey');
  });

  test('malformed protocolTime rejected with ENVELOPE_INVALID', async () => {
    const { gateway } = makeGateway();
    const result = await gateway.submitCommand({
      kind: 'intent.authorize',
      authority: 'Intent Authority',
      subjectIds: intentSubjects,
      idempotencyKey: 'idem-envelope-2',
      protocolTime: { sequence: -1, wallMs: 1_000 },
      body: intentSample,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('ENVELOPE_INVALID');
    expect(result.field).toBe('protocolTime');
  });

  test('non-string subject id rejected with ENVELOPE_INVALID', async () => {
    const { gateway } = makeGateway();
    const result = await gateway.submitCommand({
      kind: 'intent.authorize',
      authority: 'Intent Authority',
      subjectIds: [42],
      idempotencyKey: 'idem-envelope-3',
      protocolTime: when,
      body: intentSample,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('ENVELOPE_INVALID');
    expect(result.field).toBe('subjectIds');
  });

  test('unknown kind for a known authority rejected with COMMAND_KIND_UNKNOWN (deterministic, lists the registered kinds)', async () => {
    const { gateway } = makeGateway();
    const result = await gateway.submitCommand({
      kind: 'intent.explode',
      authority: 'Intent Authority',
      subjectIds: intentSubjects,
      idempotencyKey: 'idem-envelope-4',
      protocolTime: when,
      body: intentSample,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('COMMAND_KIND_UNKNOWN');
    expect(result.problem).toContain('intent.submit');
    expect(result.problem).toContain('intent.authorize');
  });

  test('a kind registered under a DIFFERENT authority is COMMAND_KIND_UNKNOWN (kind and authority must agree)', async () => {
    const { gateway } = makeGateway();
    const result = await gateway.submitCommand({
      kind: 'rails.adapter.register',
      authority: 'Intent Authority',
      subjectIds: [],
      idempotencyKey: 'idem-envelope-5',
      protocolTime: when,
      body: { railFamily: 'bank-sepa', name: 'adapter-1' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('COMMAND_KIND_UNKNOWN');
  });

  test('registry wave-2 authority (Simulation Authority) rejected with AUTHORITY_UNKNOWN', async () => {
    const { gateway } = makeGateway();
    const result = await gateway.submitCommand({
      kind: 'simulation.run',
      authority: 'Simulation Authority',
      subjectIds: [],
      idempotencyKey: 'idem-envelope-6',
      protocolTime: when,
      body: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('AUTHORITY_UNKNOWN');
  });

  test('Evidence Authority (writers-by-submission log, no command surface) rejected with AUTHORITY_UNKNOWN', async () => {
    const { gateway } = makeGateway();
    const result = await gateway.submitCommand({
      kind: 'evidence.verify',
      authority: 'Evidence Authority',
      subjectIds: [],
      idempotencyKey: 'idem-envelope-7',
      protocolTime: when,
      body: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('AUTHORITY_UNKNOWN');
  });

  test('unattributable submission (invented "Identity Authority") THROWS — no invented authority, no unrecorded refusal (Q4)', async () => {
    const { log, gateway } = makeGateway();
    const heightBefore = log.height;
    let threw = false;
    try {
      await gateway.submitCommand({
        kind: 'identity.register',
        authority: 'Identity Authority',
        subjectIds: [],
        idempotencyKey: 'idem-envelope-8',
        protocolTime: when,
        body: {},
      });
    } catch (error) {
      threw = true;
      expect((error as Error).message).toContain('names no registry authority');
    }
    expect(threw).toBe(true);
    expect(log.height).toBe(heightBefore);
  });

  test('missing authority slot THROWS (input-shape violation, kernel convention)', async () => {
    const { gateway } = makeGateway();
    let threw = false;
    try {
      await gateway.submitCommand({
        kind: 'intent.authorize',
        subjectIds: intentSubjects,
        idempotencyKey: 'idem-envelope-9',
        protocolTime: when,
        body: intentSample,
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test('non-object submission THROWS', async () => {
    const { gateway } = makeGateway();
    let threw = false;
    try {
      await gateway.submitCommand(42);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test('the registry A13 alias: both "Rail Authority" and "Rail Adapter Authority" admit rails command kinds', async () => {
    for (const authorityId of ['Rail Authority', 'Rail Adapter Authority'] as const) {
      const { queue, gateway } = makeGateway();
      const result = await gateway.submitCommand({
        kind: 'rails.adapter.register',
        authority: authorityId,
        subjectIds: [],
        idempotencyKey: `idem-alias-${authorityId}`,
        protocolTime: when,
        body: { railFamily: 'bank-sepa', name: 'adapter-1' },
      });
      expect(result.ok).toBe(true);
      expect(queue.calls.length).toBe(1);
    }
  });
});

describe('RTN-010 admission matrix — selected kind-specific semantic rejects', () => {
  test('intent.fail without a reasonCode is rejected (the REQUIRED machine-readable reason code)', async () => {
    const { gateway } = makeGateway();
    const spec = findCommandSpec('Intent Authority', 'intent.fail')?.spec;
    if (spec === undefined) throw new TypeError('setup');
    const result = await admit(gateway, spec, { intentId: 'pid.v1.intent-sample' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('COMMAND_BODY_INVALID');
    expect(result.field).toBe('reasonCode');
  });

  test('intent.fail with an out-of-vocabulary reasonCode is rejected (frozen vocabulary)', async () => {
    const { gateway } = makeGateway();
    const spec = findCommandSpec('Intent Authority', 'intent.fail')?.spec;
    if (spec === undefined) throw new TypeError('setup');
    const result = await admit(gateway, spec, {
      intentId: 'pid.v1.intent-sample',
      reasonCode: 'NOT_A_REAL_CODE',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('COMMAND_BODY_INVALID');
    expect(result.field).toBe('reasonCode');
  });

  test('intent.submit with a malformed descriptor is rejected by the authority\'s own mint (demandDescriptor)', async () => {
    const { gateway } = makeGateway();
    const spec = findCommandSpec('Intent Authority', 'intent.submit')?.spec;
    if (spec === undefined) throw new TypeError('setup');
    const result = await admit(gateway, spec, {
      descriptor: { ...sampleDescriptor, amount: { currency: 'EUR', scale: 2, amountMinor: 0 } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('COMMAND_BODY_INVALID');
    expect(result.field).toBe('descriptor');
    expect(result.problem).toContain('demand descriptor failed the owning authority\'s validator');
  });

  test('liquidity.pool.open with a lowercase currency is rejected (GC-1 currency rule)', async () => {
    const { gateway } = makeGateway();
    const spec = findCommandSpec('Liquidity Authority', 'liquidity.pool.open')?.spec;
    if (spec === undefined) throw new TypeError('setup');
    const result = await admit(gateway, spec, { poolId: 'pool-1', currency: 'eur', scale: 2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('COMMAND_BODY_INVALID');
    expect(result.field).toBe('currency');
  });

  test('credit.line.offer with a zero limit is rejected (positive minor units)', async () => {
    const { gateway } = makeGateway();
    const spec = findCommandSpec('Credit Authority', 'credit.line.offer')?.spec;
    if (spec === undefined) throw new TypeError('setup');
    const result = await admit(gateway, spec, { lineId: 'line-1', limit: EUR(0) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('COMMAND_BODY_INVALID');
    expect(result.field).toBe('limit');
  });

  test('queues.item.enqueue with a mismatched terms.intentId is rejected (the INV-8-1 cross-field invariant)', async () => {
    const { gateway } = makeGateway();
    const spec = findCommandSpec('Queue Authority', 'queues.item.enqueue')?.spec;
    if (spec === undefined) throw new TypeError('setup');
    const result = await admit(gateway, spec, {
      queueId: 'queue-1',
      intentId: 'pid.v1.intent-sample',
      priorityClass: 0,
      terms: { intentId: 'pid.v1.DIFFERENT', terms: EUR(1_000) },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('COMMAND_BODY_INVALID');
    expect(result.field).toBe('terms.intentId');
  });

  test('queues.queue.create with a condition-free policy is rejected (the eligibility rule)', async () => {
    const { gateway } = makeGateway();
    const spec = findCommandSpec('Queue Authority', 'queues.queue.create')?.spec;
    if (spec === undefined) throw new TypeError('setup');
    const result = await admit(gateway, spec, {
      queueId: 'queue-1',
      policy: {
        orderingRule: 'PRIORITY_CLASS_THEN_SEQUENCE_NUMBER',
        maxWaitEpochMs: 60_000,
        releaseConditions: {},
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('COMMAND_BODY_INVALID');
    expect(result.field).toBe('policy.releaseConditions');
  });

  test('obligations.clearing.commit with identical debtor and creditor is rejected (distinct-participants invariant)', async () => {
    const { gateway } = makeGateway();
    const spec = findCommandSpec('Obligation Authority', 'obligations.clearing.commit')?.spec;
    if (spec === undefined) throw new TypeError('setup');
    const result = await admit(gateway, spec, {
      ...SAMPLES['obligations.clearing.commit'],
      creditorParticipantId: 'participant-de',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('COMMAND_BODY_INVALID');
    expect(result.field).toBe('creditorParticipantId');
  });

  test('netting.set.open with a malformed scope is rejected by the authority\'s own mint (mintNettingScope)', async () => {
    const { gateway } = makeGateway();
    const spec = findCommandSpec('Netting Authority', 'netting.set.open')?.spec;
    if (spec === undefined) throw new TypeError('setup');
    const result = await admit(gateway, spec, {
      label: 'netting-set-1',
      scope: { kind: 'BILATERAL', participants: ['a', 'b', 'c'] },
      inputObligationIds: ['pid.v1.obligation-sample'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('COMMAND_BODY_INVALID');
    expect(result.field).toBe('scope');
    expect(result.problem).toContain('BILATERAL requires exactly two participants');
  });

  test('policy.author with an invalid definition is rejected by the authority\'s own mint (fulfillmentPolicyDefinition)', async () => {
    const { gateway } = makeGateway();
    const spec = findCommandSpec('Fulfillment Policy Authority', 'policy.author')?.spec;
    if (spec === undefined) throw new TypeError('setup');
    const result = await admit(gateway, spec, {
      policyId: 'policy-1',
      definition: { ...samplePolicyDefinition, ordering: 'CHEAPEST_FIRST' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('COMMAND_BODY_INVALID');
    expect(result.field).toBe('definition');
    expect(result.problem).toContain('COST_ASC or TIER_DESC');
  });

  test('rails.operation.authorize with a payload whose instructionId differs is rejected (the GC-3 link invariant)', async () => {
    const { gateway } = makeGateway();
    const spec = findCommandSpec('Rail Adapter Authority', 'rails.operation.authorize')?.spec;
    if (spec === undefined) throw new TypeError('setup');
    const result = await admit(gateway, spec, {
      instructionId: 'pid.v1.settlement-instruction-sample',
      adapterId: 'pid.v1.adapter-sample',
      payload: {
        instructionId: 'pid.v1.DIFFERENT',
        money: EUR(1_000),
        beneficiary: 'beneficiary-1',
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('COMMAND_BODY_INVALID');
    expect(result.field).toBe('payload.instructionId');
  });

  test('risk.rule.author with an invalid definition is rejected by the authority\'s own validator', async () => {
    const { gateway } = makeGateway();
    const spec = findCommandSpec('Risk and Compliance Authority', 'risk.rule.author')?.spec;
    if (spec === undefined) throw new TypeError('setup');
    const result = await admit(gateway, spec, {
      ruleId: 'rule-1',
      definition: { ...sampleRiskRuleDefinition, onBreach: 'EXPLODE' },
      when,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('COMMAND_BODY_INVALID');
    expect(result.field).toBe('definition');
  });

  test('routing.plan.fail with an out-of-vocabulary reasonCode is rejected (frozen vocabulary)', async () => {
    const { gateway } = makeGateway();
    const spec = findCommandSpec('Routing Authority', 'routing.plan.fail')?.spec;
    if (spec === undefined) throw new TypeError('setup');
    const result = await admit(gateway, spec, { planId: 'pid.v1.plan-sample', reasonCode: 'WHIM' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('COMMAND_BODY_INVALID');
    expect(result.field).toBe('reasonCode');
  });

  test('routing.compile with an unsatisfiable-branch outcome carrying a wrong reasonCode is rejected', async () => {
    const { gateway } = makeGateway();
    const spec = findCommandSpec('Routing Authority', 'routing.compile')?.spec;
    if (spec === undefined) throw new TypeError('setup');
    const result = await admit(gateway, spec, {
      intentId: 'pid.v1.intent-sample',
      intentTerms: sampleIntentTerms,
      policyEvaluation: { satisfiable: false, reasonCode: 'NOT_A_POLICY_CODE' },
      snapshot: sampleSnapshot,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('COMMAND_BODY_INVALID');
    expect(result.field).toBe('policyEvaluation.reasonCode');
  });

  test('settlement.instruction.create with a malformed subject union is rejected', async () => {
    const { gateway } = makeGateway();
    const spec = findCommandSpec('Settlement and Finality Authority', 'settlement.instruction.create')?.spec;
    if (spec === undefined) throw new TypeError('setup');
    const result = await admit(gateway, spec, {
      subject: { kind: 'MYSTERY', obligationId: 'pid.v1.obligation-sample' },
      beneficiary: 'beneficiary-1',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('COMMAND_BODY_INVALID');
    expect(result.field).toBe('subject.kind');
  });

  test('reconciliation.case.resolve with a missing proof is rejected', async () => {
    const { gateway } = makeGateway();
    const spec = findCommandSpec('Reconciliation Authority', 'reconciliation.case.resolve')?.spec;
    if (spec === undefined) throw new TypeError('setup');
    const result = await admit(gateway, spec, {
      caseId: 'pid.v1.case-sample',
      resolution: { resolution: 'RESOLVED_CONFIRMED' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe('COMMAND_BODY_INVALID');
    expect(result.field).toBe('resolution.proof');
  });

  test('DELIBERATE EXCEPTION — clearing.record.add with a GARBAGE amount is ADMITTED (the A09 stage-time quarantine owns amount validation)', async () => {
    const { queue, gateway } = makeGateway();
    const spec = findCommandSpec('Clearing Authority', 'clearing.record.add')?.spec;
    if (spec === undefined) throw new TypeError('setup');
    const result = await admit(gateway, spec, {
      batchId: 'pid.v1.batch-sample',
      record: {
        origin: { originActivityId: 'activity-1', originKind: 'INTENT' },
        parties: { debtorParticipantId: 'participant-de', creditorParticipantId: 'participant-cr' },
        amount: 'not-money-at-all',
        reason: 'settlement-of-intent',
      },
    });
    expect(result.ok).toBe(true);
    expect(queue.calls.length).toBe(1);
  });
});
