/**
 * RTN-005 — A03 evidence-record tests against the REAL A15 log
 * (RTN-002's createEvidenceLog — no test double): the named
 * CAPABILITY_* / COMMITMENT_* set, the five-slot shape, capacity
 * arithmetic in the proof field, and chain verification.
 *
 * Source of the tested contract — spec/architecture/v0.1/core.md §3:
 *   lines 197-200: "Evidence produced
 *    - CAPABILITY_REGISTERED / CAPABILITY_STATE_CHANGED.
 *    - COMMITMENT_OFFERED, COMMITMENT_RESERVED, COMMITMENT_CONSUMED,
 *      COMMITMENT_RELEASED, COMMITMENT_EXPIRED (each with capacity
 *      arithmetic in the proof field)."
 * spec/architecture/v0.1/README.md §3 GC-5 lines 63-67.
 * evidence-risk-compliance.md §1 A15 lines 26-33 (the five-slot shape).
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import { deriveProtocolId } from '../kernel/identity.ts';
import { createEvidenceLog } from '../evidence/log.ts';
import { isEvidenceRecord } from '../evidence/record.ts';
import { CapabilityAuthority } from './authority.ts';
import {
  CAPABILITY_AUTHORITY_ID,
  CAPABILITY_EVIDENCE_VOCABULARY,
  capabilityDeclarationHash,
} from './evidence.ts';

const ALLOW_ALL = (subjectId: string) => ({
  allowed: true as const,
  gateKind: 'capability.ACTIVATION' as const,
  subjectId,
  checkId: 'check-ok',
});

const DECLARATION = {
  railId: 'rail-a',
  corridor: {
    sourceCurrency: 'EUR',
    destinationCurrency: 'USD',
    sourceGeography: 'DE',
    destinationGeography: 'US',
  },
  costSchedule: money('USD', 50, 2),
  tier: 'standard',
};

function makeAuthority() {
  const log = createEvidenceLog({ wallMs: 1_000 });
  let wall = 1_000;
  const authority = new CapabilityAuthority({
    evidence: log,
    gate: ALLOW_ALL,
    wallClock: () => {
      wall += 1;
      return wall;
    },
  });
  return { log, authority };
}

describe('CAPABILITY_REGISTERED / CAPABILITY_STATE_CHANGED in the real log', () => {
  test('registration: five slots, authority Capability Authority, proof declaration hash', async () => {
    const { log, authority } = makeAuthority();
    const registered = await authority.registerCapability({
      capabilityId: 'cap-1',
      declaration: DECLARATION,
      declaredCapacity: money('EUR', 5_000, 2),
    });
    const record = log
      .records()
      .find((entry) => entry.what.operationType === 'CAPABILITY_REGISTERED');
    expect(record).not.toBe(undefined);
    expect(isEvidenceRecord(record)).toBe(true);
    if (record && registered.ok) {
      expect(record.what.subjectIds).toEqual(['cap-1']);
      expect(record.authority).toBe(CAPABILITY_AUTHORITY_ID);
      expect(record.authority).toBe('Capability Authority');
      expect(record.outcome.result).toBe('REGISTERED');
      expect(record.proof.hashes).toEqual([capabilityDeclarationHash(registered.record)]);
    }
  });

  test('each lifecycle step writes exactly one CAPABILITY_STATE_CHANGED with the new state', async () => {
    const { log, authority } = makeAuthority();
    await authority.registerCapability({
      capabilityId: 'cap-1',
      declaration: DECLARATION,
      declaredCapacity: money('EUR', 5_000, 2),
    });
    await authority.activateCapability('cap-1', 'GATE_APPROVED');
    await authority.degradeCapability('cap-1', 'RAIL_DISRUPTION');
    const stateChanges = log
      .records()
      .filter((entry) => entry.what.operationType === 'CAPABILITY_STATE_CHANGED');
    expect(stateChanges.map((entry) => entry.outcome.result)).toEqual(['ACTIVE', 'DEGRADED']);
    expect(stateChanges[1]?.outcome.reasonCode).toBe('RAIL_DISRUPTION');
  });
});

describe('COMMITMENT_* records — each with capacity arithmetic in the proof field', () => {
  test('the full commitment lifecycle writes all five named operation types with the arithmetic triple', async () => {
    const { log, authority } = makeAuthority();
    await authority.registerCapability({
      capabilityId: 'cap-1',
      declaration: DECLARATION,
      declaredCapacity: money('EUR', 1_000, 2),
    });
    await authority.activateCapability('cap-1');
    const intentId = 'pid.v1.intent';
    const commitmentId = deriveProtocolId('commitment', intentId, 'cap-1');
    await authority.offerCommitment({
      intentId,
      capabilityId: 'cap-1',
      amount: money('EUR', 400, 2),
      deadlineEpochMs: 5_000,
    });
    await authority.reserveCommitment(commitmentId);
    await authority.consumeCommitment(commitmentId);
    // a second commitment exercises RELEASED and EXPIRED
    await authority.offerCommitment({
      intentId: 'pid.v1.intent-2',
      capabilityId: 'cap-1',
      amount: money('EUR', 300, 2),
      deadlineEpochMs: 5_000,
    });
    const secondId = deriveProtocolId('commitment', 'pid.v1.intent-2', 'cap-1');
    await authority.reserveCommitment(secondId);
    await authority.releaseCommitment(secondId);
    await authority.offerCommitment({
      intentId: 'pid.v1.intent-3',
      capabilityId: 'cap-1',
      amount: money('EUR', 200, 2),
      deadlineEpochMs: 5_000,
    });
    const thirdId = deriveProtocolId('commitment', 'pid.v1.intent-3', 'cap-1');
    await authority.reserveCommitment(thirdId);
    await authority.expireCommitment(thirdId, 5_000);

    const offered = log.records().find((entry) => entry.what.operationType === 'COMMITMENT_OFFERED');
    const reserved = log.records().find((entry) => entry.what.operationType === 'COMMITMENT_RESERVED');
    const consumed = log.records().find((entry) => entry.what.operationType === 'COMMITMENT_CONSUMED');
    const released = log
      .records()
      .find((entry) => entry.what.operationType === 'COMMITMENT_RELEASED');
    const expired = log.records().find((entry) => entry.what.operationType === 'COMMITMENT_EXPIRED');
    for (const record of [offered, reserved, consumed, released, expired]) {
      expect(record).not.toBe(undefined);
      if (record) {
        expect(isEvidenceRecord(record)).toBe(true);
        expect(record.authority).toBe('Capability Authority');
        expect(record.what.subjectIds.length).toBe(3);
        expect(record.what.subjectIds[1]).toBe('cap-1');
        // "each with capacity arithmetic in the proof field": the triple
        // [reserved, consumed, declared] as integers
        expect(record.proof.sequenceNumbers?.length).toBe(3);
        const [reservedMinor, consumedMinor, declaredMinor] = record.proof.sequenceNumbers ?? [];
        expect(Number.isInteger(reservedMinor)).toBe(true);
        expect(Number.isInteger(consumedMinor)).toBe(true);
        expect(declaredMinor).toBe(1_000);
        expect((reservedMinor ?? 0) + (consumedMinor ?? 0) <= (declaredMinor ?? 0)).toBe(true);
      }
    }
    // the arithmetic evolves with the transitions
    expect(offered?.proof.sequenceNumbers).toEqual([0, 0, 1_000]);
    expect(reserved?.proof.sequenceNumbers).toEqual([400, 0, 1_000]);
    expect(consumed?.proof.sequenceNumbers).toEqual([0, 400, 1_000]);
    // the subject ids are the commitment / capability / intent triple
    expect(offered?.what.subjectIds).toEqual([
      deriveProtocolId('commitment', intentId, 'cap-1'),
      'cap-1',
      intentId,
    ]);
    // the outcome slots carry the commitment states
    expect(offered?.outcome.result).toBe('OFFERED');
    expect(reserved?.outcome.result).toBe('RESERVED');
    expect(consumed?.outcome.result).toBe('CONSUMED');
    expect(released?.outcome.result).toBe('RELEASED');
    expect(expired?.outcome.result).toBe('EXPIRED');
  });
});

describe('the real-log discipline over A03 records', () => {
  test('duplicate offer requests do not duplicate COMMITMENT_OFFERED records', async () => {
    const { log, authority } = makeAuthority();
    await authority.registerCapability({
      capabilityId: 'cap-1',
      declaration: DECLARATION,
      declaredCapacity: money('EUR', 1_000, 2),
    });
    await authority.activateCapability('cap-1');
    const offer = {
      intentId: 'pid.v1.intent',
      capabilityId: 'cap-1',
      amount: money('EUR', 100, 2),
      deadlineEpochMs: 5_000,
    };
    await authority.offerCommitment(offer);
    await authority.offerCommitment(offer);
    expect(
      log.records().filter((entry) => entry.what.operationType === 'COMMITMENT_OFFERED').length,
    ).toBe(1);
  });

  test('the full A03 record set verifies as a chain', async () => {
    const { log, authority } = makeAuthority();
    await authority.registerCapability({
      capabilityId: 'cap-1',
      declaration: DECLARATION,
      declaredCapacity: money('EUR', 1_000, 2),
    });
    await authority.activateCapability('cap-1');
    await authority.offerCommitment({
      intentId: 'pid.v1.intent',
      capabilityId: 'cap-1',
      amount: money('EUR', 100, 2),
      deadlineEpochMs: 5_000,
    });
    await authority.reserveCommitment(deriveProtocolId('commitment', 'pid.v1.intent', 'cap-1'));
    const verification = log.verifyAndRecord(10_000);
    expect(verification.verdict).toBe('VERIFIED');
  });

  test('the frozen evidence vocabulary is exactly the seven named operation types', () => {
    expect({ ...CAPABILITY_EVIDENCE_VOCABULARY }).toEqual({
      capabilityRegisteredOperationType: 'CAPABILITY_REGISTERED',
      capabilityStateChangedOperationType: 'CAPABILITY_STATE_CHANGED',
      commitmentOfferedOperationType: 'COMMITMENT_OFFERED',
      commitmentReservedOperationType: 'COMMITMENT_RESERVED',
      commitmentConsumedOperationType: 'COMMITMENT_CONSUMED',
      commitmentReleasedOperationType: 'COMMITMENT_RELEASED',
      commitmentExpiredOperationType: 'COMMITMENT_EXPIRED',
    });
    expect(Object.isFrozen(CAPABILITY_EVIDENCE_VOCABULARY)).toBe(true);
  });
});
