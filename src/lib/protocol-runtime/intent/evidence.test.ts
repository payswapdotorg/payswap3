/**
 * RTN-005 — A01 evidence-record tests against the REAL A15 log
 * (RTN-002's createEvidenceLog — no test double).
 *
 * Source of the tested contract — spec/architecture/v0.1/core.md §1 lines
 * 74-78 (the complete named evidence set):
 *   "Evidence produced
 *    - INTENT_CREATED (what: intent terms; when; authority: Intent
 *      Authority; outcome: DRAFT; proof: submitted descriptor hash).
 *    - INTENT_AUTHORIZED (outcome: AUTHORIZED; proof: policy decision id).
 *    - INTENT_STATE_CHANGED (one record per transition, with reason code)."
 * spec/architecture/v0.1/README.md §3 GC-5 lines 63-67 (exactly one record
 * per consequential operation).
 * evidence-risk-compliance.md §1 A15 lines 26-33 (the five-slot shape).
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';
import { createEvidenceLog } from '../evidence/log.ts';
import { isEvidenceRecord } from '../evidence/record.ts';
import { demandDescriptor, demandDescriptorHash } from './descriptor.ts';
import { IntentAuthority } from './authority.ts';
import {
  INTENT_AUTHORITY_ID,
  intentCreatedEvidence,
  intentAuthorizedEvidence,
  intentStateChangedEvidence,
} from './evidence.ts';

const ALLOW_ALL = (subjectId: string) => ({
  allowed: true as const,
  gateKind: 'intent.AUTHORIZATION' as const,
  subjectId,
  checkId: 'check-ok',
});

const DESCRIPTOR = demandDescriptor({
  amount: money('EUR', 1_000, 2),
  source: { currency: 'EUR', geography: 'DE', account: 'acct-source' },
  destination: { currency: 'USD', geography: 'US', account: 'acct-destination' },
  constraints: {
    deadlineEpochMs: 60_000,
    allowedRails: ['rail-a'],
    costCeiling: money('USD', 500, 2),
  },
  idempotencyKey: 'idem-evidence',
});

function makeAuthority() {
  const log = createEvidenceLog({ wallMs: 1_000 });
  let wall = 1_000;
  const authority = new IntentAuthority({
    evidence: log,
    gate: ALLOW_ALL,
    wallClock: () => {
      wall += 1;
      return wall;
    },
  });
  return { log, authority };
}

describe('INTENT_CREATED — the creation record in the real log', () => {
  test('five slots exact: what (intent id + key), when, authority, outcome DRAFT, proof descriptor hash', async () => {
    const { log, authority } = makeAuthority();
    const submission = await authority.submitIntent(DESCRIPTOR);
    const intent = submission.ok ? submission.intent : undefined;
    const record = log
      .records()
      .find((entry) => entry.what.operationType === 'INTENT_CREATED');
    expect(record).not.toBe(undefined);
    expect(isEvidenceRecord(record)).toBe(true);
    if (record && intent) {
      expect(record.what.subjectIds).toEqual([intent.intentId, 'idem-evidence']);
      expect(record.when.sequence >= 0).toBe(true);
      expect(record.authority).toBe(INTENT_AUTHORITY_ID);
      expect(record.authority).toBe('Intent Authority');
      expect(record.outcome.result).toBe('DRAFT');
      expect(record.outcome.reasonCode).toBe(undefined);
      expect(record.proof.hashes).toEqual([demandDescriptorHash(DESCRIPTOR)]);
    }
  });

  test('the builder requires DRAFT and a well-formed time', () => {
    const intent = {
      intentId: 'pid.v1.x',
      idempotencyKey: 'idem-evidence',
      state: 'AUTHORIZED' as const,
      descriptor: DESCRIPTOR,
      descriptorHash: demandDescriptorHash(DESCRIPTOR),
      createdAt: protocolTime(0, 1_000),
      stateChangedAt: protocolTime(0, 1_000),
    };
    expect(() => intentCreatedEvidence(intent, protocolTime(0, 1_000))).toThrow(/DRAFT/);
  });
});

describe('INTENT_AUTHORIZED — outcome AUTHORIZED, proof policy decision id', () => {
  test('the record carries the policy decision id as its prior-record link', async () => {
    const { log, authority } = makeAuthority();
    const submission = await authority.submitIntent(DESCRIPTOR);
    const intentId = submission.ok ? submission.intent.intentId : '';
    await authority.authorizeIntent(intentId, 'pid.v1.policy-decision');
    const record = log
      .records()
      .find((entry) => entry.what.operationType === 'INTENT_AUTHORIZED');
    expect(record).not.toBe(undefined);
    if (record) {
      expect(record.outcome.result).toBe('AUTHORIZED');
      expect(record.authority).toBe('Intent Authority');
      expect(record.proof.priorRecordIds).toEqual(['pid.v1.policy-decision']);
      expect(record.what.subjectIds).toContain(intentId);
      expect(record.what.subjectIds).toContain('pid.v1.policy-decision');
    }
  });

  test('the builder requires AUTHORIZED and a non-empty decision id', async () => {
    const { authority } = makeAuthority();
    const submission = await authority.submitIntent(DESCRIPTOR);
    const intent = submission.ok ? submission.intent : undefined;
    if (intent) {
      const authorized = { ...intent, state: 'AUTHORIZED' as const, policyDecisionId: 'pid.v1.d' };
      expect(() => intentAuthorizedEvidence(authorized, '', protocolTime(1, 2_000))).toThrow(/policy decision id/);
      expect(() =>
        intentAuthorizedEvidence({ ...intent, state: 'DRAFT' as const }, 'pid.v1.d', protocolTime(1, 2_000)),
      ).toThrow(/AUTHORIZED/);
    }
  });
});

describe('INTENT_STATE_CHANGED — one record per transition, with reason code', () => {
  test('each later transition writes exactly one record with the new state', async () => {
    const { log, authority } = makeAuthority();
    const submission = await authority.submitIntent(DESCRIPTOR);
    const intentId = submission.ok ? submission.intent.intentId : '';
    await authority.authorizeIntent(intentId, 'pid.v1.d');
    await authority.routeIntent(intentId);
    await authority.startFulfillingIntent(intentId);
    await authority.fulfillIntent(intentId);
    const stateChanges = log
      .records()
      .filter((entry) => entry.what.operationType === 'INTENT_STATE_CHANGED');
    expect(stateChanges.length).toBe(3);
    expect(stateChanges.map((entry) => entry.outcome.result)).toEqual(['ROUTED', 'FULFILLING', 'FULFILLED']);
    for (const entry of stateChanges) {
      expect(entry.authority).toBe('Intent Authority');
      expect(entry.what.subjectIds).toEqual([intentId]);
    }
  });

  test('the reason code rides in the outcome slot; the failing record link rides in proof', async () => {
    const { log, authority } = makeAuthority();
    const submission = await authority.submitIntent(DESCRIPTOR);
    const intentId = submission.ok ? submission.intent.intentId : '';
    await authority.authorizeIntent(intentId, 'pid.v1.d');
    await authority.failIntent(intentId, 'NO_VIABLE_ROUTE', 'pid.v1.route-record');
    const failed = log
      .records()
      .find((entry) => entry.what.operationType === 'INTENT_STATE_CHANGED' && entry.outcome.result === 'FAILED');
    expect(failed?.outcome.reasonCode).toBe('NO_VIABLE_ROUTE');
    expect(failed?.proof.priorRecordIds).toEqual(['pid.v1.route-record']);
  });

  test('the builder accepts an optional reason code and rejects malformed input', () => {
    const intent = {
      intentId: 'pid.v1.x',
      idempotencyKey: 'idem-evidence',
      state: 'ROUTED' as const,
      descriptor: DESCRIPTOR,
      descriptorHash: demandDescriptorHash(DESCRIPTOR),
      createdAt: protocolTime(0, 1_000),
      stateChangedAt: protocolTime(1, 2_000),
    };
    const record = intentStateChangedEvidence(intent, protocolTime(2, 3_000), { reasonCode: 'FULFILLMENT_FAILED' });
    expect(record.outcome).toEqual({ result: 'ROUTED', reasonCode: 'FULFILLMENT_FAILED' });
    expect(() => intentStateChangedEvidence(intent, { sequence: -1, wallMs: 3_000 } as never)).toThrow(/ProtocolTime/);
  });
});

describe('the real-log discipline over A01 records', () => {
  test('duplicate submissions do not duplicate records (INV-15-4 write keys)', async () => {
    const { log, authority } = makeAuthority();
    await authority.submitIntent(DESCRIPTOR);
    await authority.submitIntent(DESCRIPTOR);
    expect(log.records().filter((entry) => entry.what.operationType === 'INTENT_CREATED').length).toBe(1);
  });

  test('the full A01 record set verifies as a chain', async () => {
    const { log, authority } = makeAuthority();
    const submission = await authority.submitIntent(DESCRIPTOR);
    const intentId = submission.ok ? submission.intent.intentId : '';
    await authority.authorizeIntent(intentId, 'pid.v1.d');
    await authority.routeIntent(intentId);
    await authority.startFulfillingIntent(intentId);
    await authority.fulfillIntent(intentId);
    const verification = log.verifyAndRecord(10_000);
    expect(verification.verdict).toBe('VERIFIED');
    // genesis + INTENT_CREATED + INTENT_AUTHORIZED + 3 x INTENT_STATE_CHANGED
    expect(verification.verifiedHeight).toBe(6);
  });

  test('the authority-slot name is one of the registry owning authorities', async () => {
    const { log, authority } = makeAuthority();
    await authority.submitIntent(DESCRIPTOR);
    const a01Records = log
      .records()
      .filter((entry) => entry.what.operationType.startsWith('INTENT_'));
    expect(a01Records.length).toBeGreaterThan(0);
    for (const entry of a01Records) {
      expect(entry.authority).toBe('Intent Authority');
    }
  });
});
