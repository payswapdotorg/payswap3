/**
 * RTN-005 — Policy Authority command tests: the lifecycle, INV-2-2 (the
 * recorded snapshot id), INV-2-3 (one evaluation id per (intent, policy
 * version, snapshot id) — sequential and concurrent), the 1:1 attachment,
 * and the composed POLICY_UNSATISFIABLE → intent FAILED path — with
 * evidence submitted to the REAL RTN-002 A15 log.
 *
 * Source of the tested contract — spec/architecture/v0.1/core.md §2:
 *   lines 97-100 (lifecycle; fixed per intent), 102-107 (evaluation),
 *   lines 115-123 (INV-2-1/2-2/2-3), lines 127-130 (failure semantics).
 * Work order acceptance: "Idempotent receipts...; Policy evaluation
 * determinism...; one evaluation id per (intent, policy version, snapshot
 * id)".
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';
import { deriveProtocolId } from '../kernel/identity.ts';
import { createEvidenceLog } from '../evidence/log.ts';
import type { EvidenceLog } from '../evidence/log.ts';
import { fulfillmentPolicyDefinition } from './evaluation.ts';
import { PolicyAuthority } from './authority.ts';
import { IntentAuthority } from '../intent/authority.ts';
import { demandDescriptor } from '../intent/descriptor.ts';
import type { CapabilitySnapshot } from '../capability/types.ts';
import type { IntentTerms } from './types.ts';


/** Assert a promise rejects with a message matching the pattern (the
 * bun-test matcher subset declares no `rejects`; this is the equivalent
 * helper). */
async function expectRejection(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let threw = false;
  let message = '';
  try {
    await promise;
  } catch (error) {
    threw = true;
    message = error instanceof Error ? error.message : String(error);
  }
  expect(threw).toBe(true);
  expect(message).toMatch(pattern);
}

const ALLOW_ALL_INTENT = (subjectId: string) => ({
  allowed: true as const,
  gateKind: 'intent.AUTHORIZATION' as const,
  subjectId,
  checkId: 'check-ok',
});

function makeAuthority(log: EvidenceLog): PolicyAuthority {
  let wall = 1_000;
  return new PolicyAuthority({
    evidence: log,
    wallClock: () => {
      wall += 1;
      return wall;
    },
  });
}

const DEFINITION = fulfillmentPolicyDefinition({
  allowedRails: ['rail-a'],
  ordering: 'COST_ASC',
  costCeiling: money('USD', 300, 2),
  deadlineEpochMs: 50_000,
  fallbackPreference: [],
});

function snapshotFor(snapshotId: string): CapabilitySnapshot {
  return Object.freeze({
    snapshotId,
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
}

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

async function makeVersionedPolicy(authority: PolicyAuthority, policyId = 'policy-1'): Promise<void> {
  await authority.authorPolicy(policyId, DEFINITION);
  const published = await authority.publishPolicyVersion(policyId);
  expect(published.ok).toBe(true);
  if (published.ok) {
    expect(published.record.version).toBe(1);
    expect(published.record.state).toBe('VERSIONED');
  }
}

describe('Policy Authority — the AUTHORED→VERSIONED→ATTACHED lifecycle', () => {
  test('author creates the draft; publish assigns version 1 and freezes the identity', async () => {
    const authority = makeAuthority(createEvidenceLog({ wallMs: 1_000 }));
    await makeVersionedPolicy(authority);
    const versioned = authority.getPolicy('policy-1@v1');
    expect(versioned?.state).toBe('VERSIONED');
    expect(versioned?.definition).toEqual(DEFINITION);
  });

  test('attach is VERSIONED→ATTACHED, records intent + snapshot, and emits POLICY_ATTACHED', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const authority = makeAuthority(log);
    await makeVersionedPolicy(authority);
    const attached = await authority.attachPolicy({
      policyId: 'policy-1',
      version: 1,
      intentId: 'pid.v1.intent',
      snapshotId: 'pid.v1.snapshot',
    });
    expect(attached.ok).toBe(true);
    if (attached.ok) {
      expect(attached.record.state).toBe('ATTACHED');
      expect(attached.record.attachedIntentId).toBe('pid.v1.intent');
      expect(attached.record.attachedSnapshotId).toBe('pid.v1.snapshot');
    }
    const record = log.records().find((entry) => entry.what.operationType === 'POLICY_ATTACHED');
    expect(record).not.toBe(undefined);
    expect(record?.what.subjectIds).toEqual(['policy-1@v1', 'pid.v1.intent', 'pid.v1.snapshot']);
    expect(record?.authority).toBe('Fulfillment Policy Authority');
    expect(record?.outcome.result).toBe('ATTACHED');
  });

  test('the attachment is fixed per intent, both directions', async () => {
    const authority = makeAuthority(createEvidenceLog({ wallMs: 1_000 }));
    await makeVersionedPolicy(authority, 'policy-1');
    await makeVersionedPolicy(authority, 'policy-2');
    await authority.attachPolicy({
      policyId: 'policy-1',
      version: 1,
      intentId: 'pid.v1.intent-a',
      snapshotId: 'pid.v1.snapshot',
    });
    // the policy cannot attach to a second intent
    const secondIntent = await authority.attachPolicy({
      policyId: 'policy-1',
      version: 1,
      intentId: 'pid.v1.intent-b',
      snapshotId: 'pid.v1.snapshot',
    });
    expect(secondIntent.ok).toBe(false);
    if (!secondIntent.ok) {
      expect(secondIntent.code).toBe('ALREADY_ATTACHED');
    }
    // the intent cannot take a second policy
    const secondPolicy = await authority.attachPolicy({
      policyId: 'policy-2',
      version: 1,
      intentId: 'pid.v1.intent-a',
      snapshotId: 'pid.v1.snapshot',
    });
    expect(secondPolicy.ok).toBe(false);
    if (!secondPolicy.ok) {
      expect(secondPolicy.code).toBe('INTENT_ALREADY_HAS_POLICY');
    }
  });

  test('ATTACHED is terminal: no further state changes; publishing a new version is a new record', async () => {
    const authority = makeAuthority(createEvidenceLog({ wallMs: 1_000 }));
    await makeVersionedPolicy(authority);
    await authority.attachPolicy({
      policyId: 'policy-1',
      version: 1,
      intentId: 'pid.v1.intent',
      snapshotId: 'pid.v1.snapshot',
    });
    // recovery per core.md lines 129-130: a NEW policy version on a NEW intent
    const second = await authority.authorPolicy('policy-1', DEFINITION);
    expect(second.ok).toBe(false); // the draft slot for policy-1 is used; a new id is required
    const next = await authority.authorPolicy('policy-2', DEFINITION);
    expect(next.ok).toBe(true);
    await authority.publishPolicyVersion('policy-2');
    const attachedPolicy = authority.getPolicy('policy-2@v1');
    expect(attachedPolicy?.state).toBe('VERSIONED');
  });
});

describe('INV-2-2 / INV-2-3 — the recorded evaluation', () => {
  test('evaluate records the snapshot id and the derived evaluation id; CONSUMED is the terminal', async () => {
    const authority = makeAuthority(createEvidenceLog({ wallMs: 1_000 }));
    await makeVersionedPolicy(authority);
    const evaluation = await authority.evaluatePolicy({
      policyId: 'policy-1',
      version: 1,
      intentId: 'pid.v1.intent',
      intentTerms: TERMS,
      snapshot: snapshotFor('pid.v1.snapshot'),
    });
    expect(evaluation.ok).toBe(true);
    if (evaluation.ok) {
      const expectedId = deriveProtocolId('policy-evaluation', 'pid.v1.intent', 'policy-1', 1, 'pid.v1.snapshot');
      expect(evaluation.record.evaluationId).toBe(expectedId);
      expect(evaluation.record.snapshotId).toBe('pid.v1.snapshot');
      expect(evaluation.record.state).toBe('EVALUATED');
      expect(evaluation.record.outcome.satisfiable).toBe(true);
      const consumed = await authority.consumeEvaluation(expectedId);
      expect(consumed.ok).toBe(true);
      if (consumed.ok) {
        expect(consumed.record.state).toBe('CONSUMED');
      }
      const again = await authority.consumeEvaluation(expectedId);
      expect(again.ok).toBe(false);
    }
  });

  test('INV-2-3 sequential: duplicate evaluation requests return the RECORDED evaluation', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const authority = makeAuthority(log);
    await makeVersionedPolicy(authority);
    const input = {
      policyId: 'policy-1',
      version: 1,
      intentId: 'pid.v1.intent',
      intentTerms: TERMS,
      snapshot: snapshotFor('pid.v1.snapshot'),
    };
    const first = await authority.evaluatePolicy(input);
    const second = await authority.evaluatePolicy(input);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.record).toBe(first.record);
    }
    // one POLICY_EVALUATED record for the (intent, policy version, snapshot)
    expect(log.records().filter((entry) => entry.what.operationType === 'POLICY_EVALUATED').length).toBe(1);
  });

  test('INV-2-3 concurrent: 12 concurrent evaluations of the same key collapse to ONE record', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const authority = makeAuthority(log);
    await makeVersionedPolicy(authority);
    const input = {
      policyId: 'policy-1',
      version: 1,
      intentId: 'pid.v1.intent',
      intentTerms: TERMS,
      snapshot: snapshotFor('pid.v1.snapshot'),
    };
    const results = await Promise.all(Array.from({ length: 12 }, () => authority.evaluatePolicy(input)));
    for (const result of results) {
      expect(result.ok).toBe(true);
    }
    const records = new Set(results.map((result) => (result.ok ? result.record : undefined)));
    expect(records.size).toBe(1);
    expect(authority.listEvaluations().length).toBe(1);
    expect(log.records().filter((entry) => entry.what.operationType === 'POLICY_EVALUATED').length).toBe(1);
  });

  test('a different (intent, policy version, or snapshot) is a different evaluation id', async () => {
    const authority = makeAuthority(createEvidenceLog({ wallMs: 1_000 }));
    await makeVersionedPolicy(authority);
    await makeVersionedPolicy(authority, 'policy-2');
    const base = await authority.evaluatePolicy({
      policyId: 'policy-1',
      version: 1,
      intentId: 'pid.v1.intent-a',
      intentTerms: TERMS,
      snapshot: snapshotFor('pid.v1.snapshot-1'),
    });
    const otherIntent = await authority.evaluatePolicy({
      policyId: 'policy-1',
      version: 1,
      intentId: 'pid.v1.intent-b',
      intentTerms: TERMS,
      snapshot: snapshotFor('pid.v1.snapshot-1'),
    });
    const otherSnapshot = await authority.evaluatePolicy({
      policyId: 'policy-1',
      version: 1,
      intentId: 'pid.v1.intent-a',
      intentTerms: TERMS,
      snapshot: snapshotFor('pid.v1.snapshot-2'),
    });
    const otherPolicy = await authority.evaluatePolicy({
      policyId: 'policy-2',
      version: 1,
      intentId: 'pid.v1.intent-a',
      intentTerms: TERMS,
      snapshot: snapshotFor('pid.v1.snapshot-1'),
    });
    const ids = new Set(
      [base, otherIntent, otherSnapshot, otherPolicy].map((result) => (result.ok ? result.record.evaluationId : '')),
    );
    expect(ids.size).toBe(4);
    expect(authority.listEvaluations().length).toBe(4);
  });

  test('a policy attached to a DIFFERENT intent cannot be evaluated for this one (fixed per intent)', async () => {
    const authority = makeAuthority(createEvidenceLog({ wallMs: 1_000 }));
    await makeVersionedPolicy(authority);
    await authority.attachPolicy({
      policyId: 'policy-1',
      version: 1,
      intentId: 'pid.v1.intent-a',
      snapshotId: 'pid.v1.snapshot',
    });
    const result = await authority.evaluatePolicy({
      policyId: 'policy-1',
      version: 1,
      intentId: 'pid.v1.intent-b',
      intentTerms: TERMS,
      snapshot: snapshotFor('pid.v1.snapshot'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ALREADY_ATTACHED');
    }
  });
});

describe('POLICY_UNSATISFIABLE — the failure is recorded and routes the intent to FAILED', () => {
  test('the unsatisfiable evaluation is recorded with the reason code, and the intent authority fails the intent', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const policyAuthority = makeAuthority(log);
    let wall = 1_000;
    const intentAuthority = new IntentAuthority({
      evidence: log,
      gate: ALLOW_ALL_INTENT,
      wallClock: () => {
        wall += 1;
        return wall;
      },
    });
    // an intent exists
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
        idempotencyKey: 'idem-policy-failure',
      }),
    );
    const intentId = submission.ok ? submission.intent.intentId : '';
    await intentAuthority.authorizeIntent(intentId, 'pid.v1.decision');
    // the policy evaluation against an empty snapshot is unsatisfiable
    await makeVersionedPolicy(policyAuthority);
    const emptySnapshot = Object.freeze({
      snapshotId: 'pid.v1.empty',
      sequence: 0,
      wallMs: 1_000,
      capabilities: Object.freeze([]),
    });
    const evaluation = await policyAuthority.evaluatePolicy({
      policyId: 'policy-1',
      version: 1,
      intentId,
      intentTerms: TERMS,
      snapshot: emptySnapshot,
    });
    expect(evaluation.ok).toBe(true);
    if (evaluation.ok) {
      expect(evaluation.record.outcome.satisfiable).toBe(false);
      // the POLICY_EVALUATED record carries the reason-coded failure
      const record = log
        .records()
        .find((entry) => entry.what.operationType === 'POLICY_EVALUATED');
      expect(record?.outcome.result).toBe('POLICY_UNSATISFIABLE');
      expect(record?.outcome.reasonCode).toBe('POLICY_UNSATISFIABLE');
      // "failures ... route the intent to FAILED" (core.md lines 127-128):
      // the intent authority fails the intent with the policy reason code
      // and a link to the failing evidence record
      const failed = await intentAuthority.failIntent(intentId, 'POLICY_UNSATISFIABLE', evaluation.record.evaluationId);
      expect(failed.ok).toBe(true);
      expect(intentAuthority.getIntent(intentId)?.state).toBe('FAILED');
      const failedRecord = log
        .records()
        .find((entry) => entry.what.operationType === 'INTENT_STATE_CHANGED' && entry.outcome.result === 'FAILED');
      expect(failedRecord?.outcome.reasonCode).toBe('POLICY_UNSATISFIABLE');
      expect(failedRecord?.proof.priorRecordIds).toEqual([evaluation.record.evaluationId]);
    }
  });
});

describe('Policy Authority — typed rejections and the A15 coupling', () => {
  test('unknown policies and versions are POLICY_NOT_FOUND', async () => {
    const authority = makeAuthority(createEvidenceLog({ wallMs: 1_000 }));
    expect((await authority.publishPolicyVersion('absent')).ok).toBe(false);
    expect(
      (
        await authority.evaluatePolicy({
          policyId: 'absent',
          version: 1,
          intentId: 'pid.v1.i',
          intentTerms: TERMS,
          snapshot: snapshotFor('pid.v1.s'),
        })
      ).ok,
    ).toBe(false);
    expect((await authority.consumeEvaluation('pid.v1.absent')).ok).toBe(false);
  });

  test('a failed evidence write fails the attach operation (nothing committed)', async () => {
    const failingPort = {
      submit: (): never => {
        throw new Error('log unavailable');
      },
    };
    let wall = 1_000;
    const policyAuthority = new PolicyAuthority({
      evidence: failingPort,
      wallClock: () => {
        wall += 1;
        return wall;
      },
    });
    await policyAuthority.authorPolicy('policy-1', DEFINITION);
    await policyAuthority.publishPolicyVersion('policy-1');
    await expectRejection(
      policyAuthority.attachPolicy({
        policyId: 'policy-1',
        version: 1,
        intentId: 'pid.v1.intent',
        snapshotId: 'pid.v1.snapshot',
      }),
      /log unavailable/,
    );
    // nothing committed: the policy stays VERSIONED, no attachment recorded
    expect(policyAuthority.getPolicy('policy-1@v1')?.state).toBe('VERSIONED');
    expect(policyAuthority.getAttachedPolicy('pid.v1.intent')).toBe(undefined);
  });
});
