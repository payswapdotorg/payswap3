/**
 * RTN-005 — A02 evidence-record tests against the REAL A15 log
 * (RTN-002's createEvidenceLog — no test double).
 *
 * Source of the tested contract — spec/architecture/v0.1/core.md §2:
 *   lines 134-135: "Evidence produced
 *    - POLICY_ATTACHED (policy version, snapshot id).
 *    - POLICY_EVALUATED (outcome: evaluation id and result hash)."
 * spec/architecture/v0.1/README.md §3 GC-5 lines 63-67.
 * evidence-risk-compliance.md §1 A15 lines 26-33 (the five-slot shape).
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';
import { createEvidenceLog } from '../evidence/log.ts';
import { isEvidenceRecord } from '../evidence/record.ts';
import { fulfillmentPolicyDefinition, policyDefinitionHash } from './evaluation.ts';
import { policyAttachedEvidence, policyEvaluatedEvidence } from './evidence.ts';
import { PolicyAuthority } from './authority.ts';
import type { CapabilitySnapshot } from '../capability/types.ts';
import type { IntentTerms, PolicyEvaluationRecord } from './types.ts';

const DEFINITION = fulfillmentPolicyDefinition({
  allowedRails: ['rail-a'],
  ordering: 'COST_ASC',
  costCeiling: money('USD', 300, 2),
  deadlineEpochMs: 50_000,
  fallbackPreference: [],
});

const SNAPSHOT: CapabilitySnapshot = Object.freeze({
  snapshotId: 'pid.v1.snapshot',
  sequence: 0,
  wallMs: 1_000,
  capabilities: Object.freeze([
    Object.freeze({
      capabilityId: 'cap-a',
      railId: 'rail-a',
      corridor: Object.freeze({
        sourceCurrency: 'EUR',
        destinationCurrency: 'USD',
        sourceGeography: 'DE',
        destinationGeography: 'US',
      }),
      state: 'ACTIVE' as const,
      declaredCapacity: money('EUR', 5_000, 2),
      reservedTotal: money('EUR', 0, 2),
      consumedTotal: money('EUR', 0, 2),
      availableCapacity: money('EUR', 5_000, 2),
      costSchedule: money('USD', 50, 2),
      tier: 'standard',
    }),
  ]),
});

const TERMS: IntentTerms = {
  amount: money('EUR', 1_000, 2),
  sourceCurrency: 'EUR',
  destinationCurrency: 'USD',
  sourceGeography: 'DE',
  destinationGeography: 'US',
  deadlineEpochMs: 60_000,
  allowedRails: ['rail-a'],
  costCeiling: money('USD', 500, 2),
};

function makeAuthority() {
  const log = createEvidenceLog({ wallMs: 1_000 });
  let wall = 1_000;
  const authority = new PolicyAuthority({
    evidence: log,
    wallClock: () => {
      wall += 1;
      return wall;
    },
  });
  return { log, authority };
}

describe('POLICY_ATTACHED in the real log', () => {
  test('five slots exact: policy version + intent + snapshot as subjects; definition hash as proof', async () => {
    const { log, authority } = makeAuthority();
    await authority.authorPolicy('policy-1', DEFINITION);
    await authority.publishPolicyVersion('policy-1');
    await authority.attachPolicy({
      policyId: 'policy-1',
      version: 1,
      intentId: 'pid.v1.intent',
      snapshotId: SNAPSHOT.snapshotId,
    });
    const record = log.records().find((entry) => entry.what.operationType === 'POLICY_ATTACHED');
    expect(record).not.toBe(undefined);
    expect(isEvidenceRecord(record)).toBe(true);
    if (record) {
      expect(record.what.subjectIds).toEqual(['policy-1@v1', 'pid.v1.intent', 'pid.v1.snapshot']);
      expect(record.authority).toBe('Fulfillment Policy Authority');
      expect(record.outcome.result).toBe('ATTACHED');
      expect(record.proof.hashes).toEqual([policyDefinitionHash('policy-1', 1, DEFINITION)]);
    }
  });

  test('the builder refuses a non-ATTACHED policy', async () => {
    const { authority } = makeAuthority();
    const authored = await authority.authorPolicy('policy-1', DEFINITION);
    expect(authored.ok).toBe(true);
    if (authored.ok) {
      expect(() =>
        policyAttachedEvidence(authored.record, protocolTime(0, 1_000)),
      ).toThrow(/ATTACHED/);
    }
  });
});

describe('POLICY_EVALUATED in the real log', () => {
  async function evaluatedRecord(): Promise<{ log: ReturnType<typeof createEvidenceLog>; evaluation: PolicyEvaluationRecord }> {
    const { log, authority } = makeAuthority();
    await authority.authorPolicy('policy-1', DEFINITION);
    await authority.publishPolicyVersion('policy-1');
    const evaluation = await authority.evaluatePolicy({
      policyId: 'policy-1',
      version: 1,
      intentId: 'pid.v1.intent',
      intentTerms: TERMS,
      snapshot: SNAPSHOT,
    });
    if (!evaluation.ok) {
      throw new Error('expected a satisfiable evaluation');
    }
    return { log, evaluation: evaluation.record };
  }

  test('five slots exact: evaluation id as subject, result hash as proof, outcome EVALUATED', async () => {
    const { log, evaluation } = await evaluatedRecord();
    const record = log.records().find((entry) => entry.what.operationType === 'POLICY_EVALUATED');
    expect(record).not.toBe(undefined);
    expect(isEvidenceRecord(record)).toBe(true);
    if (record) {
      expect(record.what.subjectIds).toEqual([
        evaluation.evaluationId,
        'pid.v1.intent',
        'policy-1@v1',
        'pid.v1.snapshot',
      ]);
      expect(record.authority).toBe('Fulfillment Policy Authority');
      expect(record.outcome.result).toBe('EVALUATED');
      expect(record.proof.hashes).toEqual([evaluation.resultHash]);
    }
  });

  test('duplicate evaluations do not duplicate records (INV-15-4 write keys)', async () => {
    const { log, authority } = makeAuthority();
    await authority.authorPolicy('policy-1', DEFINITION);
    await authority.publishPolicyVersion('policy-1');
    const input = {
      policyId: 'policy-1',
      version: 1,
      intentId: 'pid.v1.intent',
      intentTerms: TERMS,
      snapshot: SNAPSHOT,
    };
    await authority.evaluatePolicy(input);
    await authority.evaluatePolicy(input);
    expect(log.records().filter((entry) => entry.what.operationType === 'POLICY_EVALUATED').length).toBe(1);
  });

  test('the full A02 record set verifies as a chain', async () => {
    const { log, authority } = makeAuthority();
    await authority.authorPolicy('policy-1', DEFINITION);
    await authority.publishPolicyVersion('policy-1');
    await authority.attachPolicy({
      policyId: 'policy-1',
      version: 1,
      intentId: 'pid.v1.intent',
      snapshotId: SNAPSHOT.snapshotId,
    });
    await authority.evaluatePolicy({
      policyId: 'policy-1',
      version: 1,
      intentId: 'pid.v1.intent-2',
      intentTerms: TERMS,
      snapshot: SNAPSHOT,
    });
    const verification = log.verifyAndRecord(10_000);
    expect(verification.verdict).toBe('VERIFIED');
  });

  test('the builder requires a recorded evaluation', () => {
    expect(() =>
      policyEvaluatedEvidence({ state: 'EVALUATED' } as never, protocolTime(0, 1_000)),
    ).toThrow(/recorded evaluation/);
  });
});
