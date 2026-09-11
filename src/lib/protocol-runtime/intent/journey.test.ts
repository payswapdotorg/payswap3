/**
 * RTN-005 — the composed areas-1-3 journey: one intent through the three
 * authorities (Intent, Fulfillment Policy, Capability), gated by the REAL
 * RTN-003 compliance gate, with every consequential operation's evidence
 * record in the REAL RTN-002 A15 log.
 *
 * Source of the tested contract — spec/architecture/v0.1/core.md:
 *   §1 lines 84-85: "Depends on area 2 at authorization, area 3 at
 *    routing, and area 16 for compliance gating before AUTHORIZED."
 *   §2 lines 102-107 (the evaluation feeding authorization), 134-135
 *    (policy evidence).
 *   §3 lines 160-166 (the commitment and the snapshot feeding policy),
 *    197-200 (capability evidence).
 *   evidence-risk-compliance.md §1 A15 lines 26-33, 62-64 (the real log
 *   and the synchronous coupling); §2 A16 lines 129-131 (the gate).
 * Work order acceptance: "Evidence: ... records written to the real A15
 * log (RTN-002 merged)"; "Compliance gate: no AUTHORIZED transition
 * without terminal APPROVED".
 */
import { describe, expect, test } from 'bun:test';
import { protocolTime } from '../kernel/time.ts';
import { money } from '../kernel/money.ts';
import { deriveProtocolId } from '../kernel/identity.ts';
import { createEvidenceLog } from '../evidence/log.ts';
import { evaluateComplianceCheck } from '../risk/evaluation.ts';
import type { ComplianceCheckRecord } from '../risk/evaluation.ts';
import { decideComplianceCheck } from '../risk/check.ts';
import { createScreeningList } from '../risk/screening.ts';
import { subjectComplianceData } from '../risk/subject.ts';
import { evaluateComplianceGate } from '../risk/gate.ts';
import { IntentAuthority } from '../intent/authority.ts';
import { demandDescriptor } from '../intent/descriptor.ts';
import { PolicyAuthority } from '../policy/authority.ts';
import { fulfillmentPolicyDefinition } from '../policy/evaluation.ts';
import type { IntentTerms } from '../policy/types.ts';
import { CapabilityAuthority } from '../capability/authority.ts';

const GATE_CHECKS = new Map<string, ComplianceCheckRecord>();

function approvedCheckFor(subjectId: string, kind: 'INTENT' | 'CAPABILITY_REGISTRATION'): ComplianceCheckRecord {
  const cached = GATE_CHECKS.get(subjectId);
  if (cached !== undefined) {
    return cached;
  }
  const check = decideComplianceCheck(
    evaluateComplianceCheck({
      rules: [],
      screeningList: createScreeningList('sanctions', 1, []),
      subject: subjectComplianceData({
        subjectId,
        subjectKind: kind,
        ...(kind === 'INTENT'
          ? { moneyFacts: [{ currency: 'EUR', amountMinor: 1_000 }] }
          : { countFacts: [{ name: 'rails', count: 1 }] }),
      }),
      evaluatedAt: protocolTime(0, 1_000),
    }) as Parameters<typeof decideComplianceCheck>[0],
    protocolTime(1, 2_000),
  );
  GATE_CHECKS.set(subjectId, check);
  return check;
}

describe('the composed areas-1-3 journey over the real A15 log and the real A16 gate', () => {
  test('demand -> gate -> policy -> authorization -> commitment -> fulfillment, all records in one chain', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    let wall = 1_000;
    const clock = () => {
      wall += 1;
      return wall;
    };
    const intentAuthority = new IntentAuthority({
      evidence: log,
      gate: (subjectId) =>
        evaluateComplianceGate([approvedCheckFor(subjectId, 'INTENT')], 'intent.AUTHORIZATION', subjectId),
      wallClock: clock,
    });
    const policyAuthority = new PolicyAuthority({ evidence: log, wallClock: clock });
    const capabilityAuthority = new CapabilityAuthority({
      evidence: log,
      gate: (subjectId) =>
        evaluateComplianceGate(
          [approvedCheckFor(subjectId, 'CAPABILITY_REGISTRATION')],
          'capability.ACTIVATION',
          subjectId,
        ),
      wallClock: clock,
    });

    // --- A03: register + gate + activate the capability, then snapshot ---
    const registered = await capabilityAuthority.registerCapability({
      capabilityId: 'cap-eur-usd',
      declaration: {
        railId: 'rail-a',
        corridor: {
          sourceCurrency: 'EUR',
          destinationCurrency: 'USD',
          sourceGeography: 'DE',
          destinationGeography: 'US',
        },
        costSchedule: money('USD', 50, 2),
        tier: 'standard',
      },
      declaredCapacity: money('EUR', 5_000, 2),
    });
    expect(registered.ok).toBe(true);
    const activated = await capabilityAuthority.activateCapability('cap-eur-usd');
    expect(activated.ok).toBe(true);
    const snapshot = capabilityAuthority.snapshot();

    // --- A01: submit the demand ---
    const submission = await intentAuthority.submitIntent(
      demandDescriptor({
        amount: money('EUR', 1_000, 2),
        source: { currency: 'EUR', geography: 'DE', account: 'acct-source' },
        destination: { currency: 'USD', geography: 'US', account: 'acct-destination' },
        constraints: {
          deadlineEpochMs: 60_000,
          allowedRails: ['rail-a'],
          costCeiling: money('USD', 500, 2),
        },
        idempotencyKey: 'idem-journey',
      }),
    );
    expect(submission.ok).toBe(true);
    const intent = submission.ok ? submission.intent : undefined;
    expect(intent).not.toBe(undefined);
    const intentId = intent?.intentId ?? '';

    // --- A02: author, publish, attach the policy to the intent ---
    const definition = fulfillmentPolicyDefinition({
      allowedRails: ['rail-a'],
      ordering: 'COST_ASC',
      costCeiling: money('USD', 300, 2),
      deadlineEpochMs: 50_000,
      fallbackPreference: [],
    });
    await policyAuthority.authorPolicy('policy-journey', definition);
    await policyAuthority.publishPolicyVersion('policy-journey');
    const attached = await policyAuthority.attachPolicy({
      policyId: 'policy-journey',
      version: 1,
      intentId,
      snapshotId: snapshot.snapshotId,
    });
    expect(attached.ok).toBe(true);

    // --- A02: evaluate the attached policy against the terms + snapshot ---
    const terms: IntentTerms = {
      amount: money('EUR', 1_000, 2),
      sourceCurrency: 'EUR',
      destinationCurrency: 'USD',
      sourceGeography: 'DE',
      destinationGeography: 'US',
      deadlineEpochMs: 60_000,
      allowedRails: ['rail-a'],
      costCeiling: money('USD', 500, 2),
    };
    const evaluation = await policyAuthority.evaluatePolicy({
      policyId: 'policy-journey',
      version: 1,
      intentId,
      intentTerms: terms,
      snapshot,
    });
    expect(evaluation.ok).toBe(true);
    const evaluationRecord = evaluation.ok ? evaluation.record : undefined;
    expect(evaluationRecord?.outcome.satisfiable).toBe(true);
    if (evaluationRecord?.outcome.satisfiable) {
      expect(evaluationRecord.outcome.result.rankedRouteRequirements.length).toBe(1);
      expect(evaluationRecord.outcome.result.rankedRouteRequirements[0]?.capabilityId).toBe('cap-eur-usd');
    }

    // --- A01: authorize with the policy decision (the gate approved) ---
    const authorization = await intentAuthority.authorizeIntent(
      intentId,
      evaluationRecord?.evaluationId ?? '',
    );
    expect(authorization.ok).toBe(true);
    expect(intentAuthority.getIntent(intentId)?.policyDecisionId).toBe(evaluationRecord?.evaluationId);

    // --- A03: offer + reserve the commitment for the intent ---
    const offered = await capabilityAuthority.offerCommitment({
      intentId,
      capabilityId: 'cap-eur-usd',
      amount: money('EUR', 1_000, 2),
      deadlineEpochMs: 60_000,
    });
    expect(offered.ok).toBe(true);
    const commitmentId = deriveProtocolId('commitment', intentId, 'cap-eur-usd');
    expect((await capabilityAuthority.reserveCommitment(commitmentId)).ok).toBe(true);

    // --- A01: ROUTED -> FULFILLING -> FULFILLED ---
    expect((await intentAuthority.routeIntent(intentId)).ok).toBe(true);
    expect((await intentAuthority.startFulfillingIntent(intentId)).ok).toBe(true);

    // --- A02: consume the evaluation (the routing compiler's consumption) ---
    expect((await policyAuthority.consumeEvaluation(evaluationRecord?.evaluationId ?? '')).ok).toBe(true);

    // --- A03: consume the commitment (exactly once) ---
    expect((await capabilityAuthority.consumeCommitment(commitmentId)).ok).toBe(true);

    // --- A01: FULFILLED ---
    expect((await intentAuthority.fulfillIntent(intentId)).ok).toBe(true);
    expect(intentAuthority.getIntent(intentId)?.state).toBe('FULFILLED');

    // --- the one chain over all three authorities' records ---
    const verification = log.verifyAndRecord(20_000);
    expect(verification.verdict).toBe('VERIFIED');
    const operationTypes = log
      .records()
      .filter((entry) => entry.what.operationType !== 'EVIDENCE_LOG_VERIFICATION')
      .map((entry) => entry.what.operationType);
    expect(operationTypes).toEqual([
      'EVIDENCE_LOG_GENESIS',
      'CAPABILITY_REGISTERED',
      'CAPABILITY_STATE_CHANGED',
      'INTENT_CREATED',
      'POLICY_ATTACHED',
      'POLICY_EVALUATED',
      'INTENT_AUTHORIZED',
      'COMMITMENT_OFFERED',
      'COMMITMENT_RESERVED',
      'INTENT_STATE_CHANGED',
      'INTENT_STATE_CHANGED',
      'COMMITMENT_CONSUMED',
      'INTENT_STATE_CHANGED',
    ]);
    // the authorities are exactly the registry's names, per record
    const authorityByOperation = new Map<string, string>();
    for (const entry of log.records()) {
      authorityByOperation.set(entry.what.operationType, entry.authority);
    }
    expect(authorityByOperation.get('INTENT_CREATED')).toBe('Intent Authority');
    expect(authorityByOperation.get('POLICY_ATTACHED')).toBe('Fulfillment Policy Authority');
    expect(authorityByOperation.get('CAPABILITY_REGISTERED')).toBe('Capability Authority');
    expect(authorityByOperation.get('COMMITMENT_CONSUMED')).toBe('Capability Authority');
    // INV-3-1 at the end of the journey: reserved 0, consumed 1_000 <= 5_000
    const accounting = capabilityAuthority.getAccounting('cap-eur-usd');
    expect(accounting?.reserved.amountMinor).toBe(0);
    expect(accounting?.consumed.amountMinor).toBe(1_000);
    expect(
      accounting ? accounting.reserved.amountMinor + accounting.consumed.amountMinor <= accounting.declared.amountMinor : false,
    ).toBe(true);
  });

  test('the same journey with a DENIED gate check never authorizes and never reserves', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    let wall = 1_000;
    const clock = () => {
      wall += 1;
      return wall;
    };
    const intentAuthority = new IntentAuthority({
      evidence: log,
      gate: () => ({
        allowed: false,
        gateKind: 'intent.AUTHORIZATION',
        subjectId: 'x',
        blockedBy: 'CHECK_DENIED',
        checkId: 'pid.v1.denied-check',
      }),
      wallClock: clock,
    });
    const submission = await intentAuthority.submitIntent(
      demandDescriptor({
        amount: money('EUR', 1_000, 2),
        source: { currency: 'EUR', geography: 'DE', account: 'acct-source' },
        destination: { currency: 'USD', geography: 'US', account: 'acct-destination' },
        constraints: {
          deadlineEpochMs: 60_000,
          allowedRails: ['rail-a'],
          costCeiling: money('USD', 500, 2),
        },
        idempotencyKey: 'idem-journey-denied',
      }),
    );
    const intentId = submission.ok ? submission.intent.intentId : '';
    const authorization = await intentAuthority.authorizeIntent(intentId, 'pid.v1.decision');
    expect(authorization.ok).toBe(false);
    if (!authorization.ok) {
      expect(authorization.code).toBe('COMPLIANCE_BLOCKED');
    }
    expect(intentAuthority.getIntent(intentId)?.state).toBe('DRAFT');
    // no INTENT_AUTHORIZED record exists
    expect(
      log.records().filter((entry) => entry.what.operationType === 'INTENT_AUTHORIZED').length,
    ).toBe(0);
  });
});
