/**
 * RTN-005 — CapabilitySnapshot tests: immutability and sequencing.
 *
 * Source of the tested contract — spec/architecture/v0.1/core.md §3:
 *   lines 165-166: "CapabilitySnapshot — immutable, sequenced view of all
 *    capabilities at a point in protocol time; consumed by policy
 *    evaluation and routing."
 * Work order acceptance: "snapshot immutability tests"; "CapabilitySnapshot
 * (immutable, sequenced)".
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import { deriveProtocolId } from '../kernel/identity.ts';
import { createEvidenceLog } from '../evidence/log.ts';
import { CapabilityAuthority } from './authority.ts';

const ALLOW_ALL = (subjectId: string) => ({
  allowed: true as const,
  gateKind: 'capability.ACTIVATION' as const,
  subjectId,
  checkId: 'check-ok',
});

function makeAuthority(): CapabilityAuthority {
  let wall = 1_000;
  return new CapabilityAuthority({
    evidence: createEvidenceLog({ wallMs: 1_000 }),
    gate: ALLOW_ALL,
    wallClock: () => {
      wall += 1;
      return wall;
    },
  });
}

const DECLARATION_A = {
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

const DECLARATION_B = {
  railId: 'rail-b',
  corridor: {
    sourceCurrency: 'EUR',
    destinationCurrency: 'USD',
    sourceGeography: 'DE',
    destinationGeography: 'US',
  },
  costSchedule: money('USD', 80, 2),
  tier: 'premium',
};

describe('CapabilitySnapshot — immutable, sequenced', () => {
  test('the snapshot is deep-frozen at mint (object, entries array, every entry, every nested value)', async () => {
    const authority = makeAuthority();
    await authority.registerCapability({
      capabilityId: 'cap-1',
      declaration: DECLARATION_A,
      declaredCapacity: money('EUR', 5_000, 2),
    });
    await authority.activateCapability('cap-1');
    const snapshot = authority.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.capabilities)).toBe(true);
    for (const entry of snapshot.capabilities) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.corridor)).toBe(true);
    }
    // strict-mode mutation attempts throw
    expect(() => {
      (snapshot as { sequence: number }).sequence = 99;
    }).toThrow();
    expect(() => {
      (snapshot.capabilities as unknown[]).push({});
    }).toThrow();
    expect(() => {
      const entry = snapshot.capabilities[0] as { tier: string };
      entry.tier = 'tampered';
    }).toThrow();
  });

  test('a previously obtained snapshot never changes under later authority mutations', async () => {
    const authority = makeAuthority();
    await authority.registerCapability({
      capabilityId: 'cap-1',
      declaration: DECLARATION_A,
      declaredCapacity: money('EUR', 5_000, 2),
    });
    await authority.activateCapability('cap-1');
    const early = authority.snapshot();
    expect(early.capabilities.length).toBe(1);
    expect(early.capabilities[0]?.state).toBe('ACTIVE');
    expect(early.capabilities[0]?.availableCapacity.amountMinor).toBe(5_000);

    // mutate the world: a second capability, a reservation, a degradation
    await authority.registerCapability({
      capabilityId: 'cap-2',
      declaration: DECLARATION_B,
      declaredCapacity: money('EUR', 3_000, 2),
    });
    await authority.activateCapability('cap-2');
    await authority.offerCommitment({
      intentId: 'pid.v1.intent',
      capabilityId: 'cap-1',
      amount: money('EUR', 1_000, 2),
      deadlineEpochMs: 60_000,
    });
    const commitmentId = deriveProtocolId('commitment', 'pid.v1.intent', 'cap-1');
    await authority.reserveCommitment(commitmentId);
    await authority.degradeCapability('cap-2');

    // the early snapshot is untouched
    expect(early.capabilities.length).toBe(1);
    expect(early.capabilities[0]?.capabilityId).toBe('cap-1');
    expect(early.capabilities[0]?.state).toBe('ACTIVE');
    expect(early.capabilities[0]?.availableCapacity.amountMinor).toBe(5_000);
    expect(early.capabilities[0]?.reservedTotal.amountMinor).toBe(0);

    // a fresh snapshot reflects the current world
    const late = authority.snapshot();
    expect(late.capabilities.length).toBe(2);
    expect(late.capabilities.find((entry) => entry.capabilityId === 'cap-1')?.availableCapacity.amountMinor).toBe(4_000);
    expect(late.capabilities.find((entry) => entry.capabilityId === 'cap-2')?.state).toBe('DEGRADED');
  });

  test('snapshots are sequenced: monotonic sequence positions and distinct derived ids', async () => {
    const authority = makeAuthority();
    await authority.registerCapability({
      capabilityId: 'cap-1',
      declaration: DECLARATION_A,
      declaredCapacity: money('EUR', 5_000, 2),
    });
    const first = authority.snapshot();
    const second = authority.snapshot();
    const third = authority.snapshot();
    expect(first.sequence).toBe(0);
    expect(second.sequence).toBe(1);
    expect(third.sequence).toBe(2);
    expect(first.snapshotId).toBe(deriveProtocolId('capability-snapshot', 0));
    expect(second.snapshotId).toBe(deriveProtocolId('capability-snapshot', 1));
    expect(new Set([first.snapshotId, second.snapshotId, third.snapshotId]).size).toBe(3);
  });

  test('the snapshot entry carries the capacity accounting view (INV-3-1 identity implied)', async () => {
    const authority = makeAuthority();
    await authority.registerCapability({
      capabilityId: 'cap-1',
      declaration: DECLARATION_A,
      declaredCapacity: money('EUR', 5_000, 2),
    });
    await authority.activateCapability('cap-1');
    await authority.offerCommitment({
      intentId: 'pid.v1.intent',
      capabilityId: 'cap-1',
      amount: money('EUR', 1_200, 2),
      deadlineEpochMs: 60_000,
    });
    await authority.reserveCommitment(deriveProtocolId('commitment', 'pid.v1.intent', 'cap-1'));
    await authority.offerCommitment({
      intentId: 'pid.v1.intent-2',
      capabilityId: 'cap-1',
      amount: money('EUR', 300, 2),
      deadlineEpochMs: 60_000,
    });
    await authority.reserveCommitment(deriveProtocolId('commitment', 'pid.v1.intent-2', 'cap-1'));
    await authority.consumeCommitment(deriveProtocolId('commitment', 'pid.v1.intent-2', 'cap-1'));
    const snapshot = authority.snapshot();
    const entry = snapshot.capabilities[0];
    expect(entry?.declaredCapacity.amountMinor).toBe(5_000);
    expect(entry?.reservedTotal.amountMinor).toBe(1_200);
    expect(entry?.consumedTotal.amountMinor).toBe(300);
    // available = declared - reserved - consumed (the identity rearranged)
    expect(entry?.availableCapacity.amountMinor).toBe(5_000 - 1_200 - 300);
    expect(entry?.railId).toBe('rail-a');
    expect(entry?.costSchedule.amountMinor).toBe(50);
    expect(entry?.tier).toBe('standard');
  });

  test('the snapshot orders capabilities by id (deterministic view order)', async () => {
    const authority = makeAuthority();
    await authority.registerCapability({
      capabilityId: 'cap-z',
      declaration: DECLARATION_A,
      declaredCapacity: money('EUR', 5_000, 2),
    });
    await authority.registerCapability({
      capabilityId: 'cap-a',
      declaration: DECLARATION_B,
      declaredCapacity: money('EUR', 5_000, 2),
    });
    const snapshot = authority.snapshot();
    expect(snapshot.capabilities.map((entry) => entry.capabilityId)).toEqual(['cap-a', 'cap-z']);
  });
});
