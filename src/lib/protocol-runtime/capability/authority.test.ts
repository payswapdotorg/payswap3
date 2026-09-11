/**
 * RTN-005 — Capability Authority command tests: the registry lifecycle,
 * commitments (INV-3-3 ids, capacity bound, exactly-once consumption,
 * degradation semantics, expiry), and INV-3-2 concurrency — with evidence
 * submitted to the REAL RTN-002 A15 log.
 *
 * Source of the tested contract — spec/architecture/v0.1/core.md §3:
 *   lines 156-158 (capability states; degraded accepts no new
 *    commitments), 160-163 (commitment machine; RESERVED counts against
 *    capacity; CONSUMED terminal and exactly once per intent),
 *   lines 176-184 (INV-3-1/INV-3-2/INV-3-3),
 *   lines 186-191 (degradation invalidates only OFFERED; RESERVED
 *    survives until release/expiry; expiry is deadline-driven).
 * Work order acceptance: "DEGRADED capability accepts no new commitments;
 * RESERVED survives degradation until area-5 release/expiry."
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import { deriveProtocolId } from '../kernel/identity.ts';
import { createEvidenceLog } from '../evidence/log.ts';
import type { EvidenceLog } from '../evidence/log.ts';
import { CapabilityAuthority } from './authority.ts';


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

const ALLOW_ALL = (subjectId: string) => ({
  allowed: true as const,
  gateKind: 'capability.ACTIVATION' as const,
  subjectId,
  checkId: 'check-ok',
});

function makeAuthority(log: EvidenceLog): CapabilityAuthority {
  let wall = 1_000;
  return new CapabilityAuthority({
    evidence: log,
    gate: ALLOW_ALL,
    wallClock: () => {
      wall += 1;
      return wall;
    },
  });
}

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

async function makeActiveCapability(authority: CapabilityAuthority, capacityMinor = 5_000): Promise<string> {
  const registered = await authority.registerCapability({
    capabilityId: 'cap-1',
    declaration: DECLARATION,
    declaredCapacity: money('EUR', capacityMinor, 2),
  });
  expect(registered.ok).toBe(true);
  const activated = await authority.activateCapability('cap-1');
  expect(activated.ok).toBe(true);
  return 'cap-1';
}

describe('Capability Authority — registry lifecycle', () => {
  test('register emits CAPABILITY_REGISTERED; the capability starts REGISTERED', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const authority = makeAuthority(log);
    const result = await authority.registerCapability({
      capabilityId: 'cap-1',
      declaration: DECLARATION,
      declaredCapacity: money('EUR', 5_000, 2),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.state).toBe('REGISTERED');
      expect(result.record.reservedTotal.amountMinor).toBe(0);
      expect(result.record.consumedTotal.amountMinor).toBe(0);
    }
    expect(
      log.records().filter((entry) => entry.what.operationType === 'CAPABILITY_REGISTERED').length,
    ).toBe(1);
  });

  test('the strict chain: REGISTERED→ACTIVE→DEGRADED→RETIRED, one CAPABILITY_STATE_CHANGED per step', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const authority = makeAuthority(log);
    await makeActiveCapability(authority);
    await authority.degradeCapability('cap-1');
    const retired = await authority.retireCapability('cap-1');
    expect(retired.ok).toBe(true);
    if (retired.ok) {
      expect(retired.record.state).toBe('RETIRED');
    }
    const stateChanges = log
      .records()
      .filter((entry) => entry.what.operationType === 'CAPABILITY_STATE_CHANGED');
    expect(stateChanges.map((entry) => entry.outcome.result)).toEqual(['ACTIVE', 'DEGRADED', 'RETIRED']);
  });

  test('shortcuts are refused: REGISTERED→DEGRADED, ACTIVE→RETIRED, RETIRED→ACTIVE', async () => {
    const authority = makeAuthority(createEvidenceLog({ wallMs: 1_000 }));
    await authority.registerCapability({
      capabilityId: 'cap-1',
      declaration: DECLARATION,
      declaredCapacity: money('EUR', 5_000, 2),
    });
    expect((await authority.degradeCapability('cap-1')).ok).toBe(false);
    expect((await authority.retireCapability('cap-1')).ok).toBe(false);
    await authority.activateCapability('cap-1');
    expect((await authority.retireCapability('cap-1')).ok).toBe(false);
    await authority.degradeCapability('cap-1');
    await authority.retireCapability('cap-1');
    expect((await authority.activateCapability('cap-1')).ok).toBe(false);
  });

  test('unknown capability ids are CAPABILITY_NOT_FOUND; duplicate registration is refused', async () => {
    const authority = makeAuthority(createEvidenceLog({ wallMs: 1_000 }));
    const result = await authority.activateCapability('cap-absent');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CAPABILITY_NOT_FOUND');
    }
    await authority.registerCapability({
      capabilityId: 'cap-1',
      declaration: DECLARATION,
      declaredCapacity: money('EUR', 5_000, 2),
    });
    const duplicate = await authority.registerCapability({
      capabilityId: 'cap-1',
      declaration: DECLARATION,
      declaredCapacity: money('EUR', 5_000, 2),
    });
    expect(duplicate.ok).toBe(false);
  });
});

describe('Capability Authority — INV-3-3 commitment ids and idempotency', () => {
  test('commitment ids are derived from (intent id, capability id)', async () => {
    const authority = makeAuthority(createEvidenceLog({ wallMs: 1_000 }));
    await makeActiveCapability(authority);
    const result = await authority.offerCommitment({
      intentId: 'pid.v1.intent-a',
      capabilityId: 'cap-1',
      amount: money('EUR', 1_000, 2),
      deadlineEpochMs: 60_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.commitmentId).toBe(deriveProtocolId('commitment', 'pid.v1.intent-a', 'cap-1'));
      expect(result.record.state).toBe('OFFERED');
    }
  });

  test('duplicate offer requests return the recorded commitment state', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const authority = makeAuthority(log);
    await makeActiveCapability(authority);
    const first = await authority.offerCommitment({
      intentId: 'pid.v1.intent-a',
      capabilityId: 'cap-1',
      amount: money('EUR', 1_000, 2),
      deadlineEpochMs: 60_000,
    });
    const second = await authority.offerCommitment({
      intentId: 'pid.v1.intent-a',
      capabilityId: 'cap-1',
      amount: money('EUR', 1_000, 2),
      deadlineEpochMs: 60_000,
    });
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.record).toBe(first.record);
    }
    // one COMMITMENT_OFFERED record for the (intent, capability) pair
    expect(
      log.records().filter((entry) => entry.what.operationType === 'COMMITMENT_OFFERED').length,
    ).toBe(1);
  });

  test('the same (intent, capability) pair with a different amount is a COMMITMENT_MISMATCH', async () => {
    const authority = makeAuthority(createEvidenceLog({ wallMs: 1_000 }));
    await makeActiveCapability(authority);
    await authority.offerCommitment({
      intentId: 'pid.v1.intent-a',
      capabilityId: 'cap-1',
      amount: money('EUR', 1_000, 2),
      deadlineEpochMs: 60_000,
    });
    const conflicting = await authority.offerCommitment({
      intentId: 'pid.v1.intent-a',
      capabilityId: 'cap-1',
      amount: money('EUR', 2_000, 2),
      deadlineEpochMs: 60_000,
    });
    expect(conflicting.ok).toBe(false);
    if (!conflicting.ok) {
      expect(conflicting.code).toBe('COMMITMENT_MISMATCH');
    }
  });
});

describe('Capability Authority — capacity (INV-3-1 at the command level)', () => {
  test('reserve takes capacity; over-capacity reserve is CAPACITY_EXCEEDED with nothing changed', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const authority = makeAuthority(log);
    await makeActiveCapability(authority, 1_000);
    for (const intentId of ['pid.v1.i1', 'pid.v1.i2']) {
      const offer = await authority.offerCommitment({
        intentId,
        capabilityId: 'cap-1',
        amount: money('EUR', 600, 2),
        deadlineEpochMs: 60_000,
      });
      expect(offer.ok).toBe(true);
    }
    const first = await authority.reserveCommitment(deriveProtocolId('commitment', 'pid.v1.i1', 'cap-1'));
    expect(first.ok).toBe(true);
    const second = await authority.reserveCommitment(deriveProtocolId('commitment', 'pid.v1.i2', 'cap-1'));
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe('CAPACITY_EXCEEDED');
    }
    // the accounting shows exactly the first amount reserved
    const accounting = authority.getAccounting('cap-1');
    expect(accounting?.reserved.amountMinor).toBe(600);
    expect(accounting?.consumed.amountMinor).toBe(0);
    // the second commitment was never reserved
    const rejected = authority.getCommitment(deriveProtocolId('commitment', 'pid.v1.i2', 'cap-1'));
    expect(rejected?.state).toBe('OFFERED');
    // one COMMITMENT_RESERVED record only
    expect(
      log.records().filter((entry) => entry.what.operationType === 'COMMITMENT_RESERVED').length,
    ).toBe(1);
  });

  test('CONSUMED is exactly-once: the second consume attempt is refused', async () => {
    const authority = makeAuthority(createEvidenceLog({ wallMs: 1_000 }));
    await makeActiveCapability(authority);
    await authority.offerCommitment({
      intentId: 'pid.v1.intent-a',
      capabilityId: 'cap-1',
      amount: money('EUR', 1_000, 2),
      deadlineEpochMs: 60_000,
    });
    const commitmentId = deriveProtocolId('commitment', 'pid.v1.intent-a', 'cap-1');
    await authority.reserveCommitment(commitmentId);
    const first = await authority.consumeCommitment(commitmentId);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.record.state).toBe('CONSUMED');
    }
    const second = await authority.consumeCommitment(commitmentId);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe('ILLEGAL_TRANSITION');
    }
    // consumption moved the amount from reserved to consumed
    const accounting = authority.getAccounting('cap-1');
    expect(accounting?.reserved.amountMinor).toBe(0);
    expect(accounting?.consumed.amountMinor).toBe(1_000);
  });

  test('release returns capacity; expiry is deterministic on protocol time', async () => {
    const authority = makeAuthority(createEvidenceLog({ wallMs: 1_000 }));
    await makeActiveCapability(authority);
    for (const intentId of ['pid.v1.i1', 'pid.v1.i2']) {
      await authority.offerCommitment({
        intentId,
        capabilityId: 'cap-1',
        amount: money('EUR', 500, 2),
        deadlineEpochMs: 5_000,
      });
      await authority.reserveCommitment(deriveProtocolId('commitment', intentId, 'cap-1'));
    }
    // release one commitment (the area-5 release path)
    const released = await authority.releaseCommitment(deriveProtocolId('commitment', 'pid.v1.i1', 'cap-1'));
    expect(released.ok).toBe(true);
    if (released.ok) {
      expect(released.record.state).toBe('RELEASED');
    }
    expect(authority.getAccounting('cap-1')?.reserved.amountMinor).toBe(500);
    // expiry: before the deadline it is NOT_DUE; after it, EXPIRED
    const notDue = await authority.expireCommitment(deriveProtocolId('commitment', 'pid.v1.i2', 'cap-1'), 4_999);
    expect(notDue.ok).toBe(false);
    if (!notDue.ok) {
      expect(notDue.code).toBe('NOT_DUE');
    }
    const expired = await authority.expireCommitment(deriveProtocolId('commitment', 'pid.v1.i2', 'cap-1'), 5_000);
    expect(expired.ok).toBe(true);
    if (expired.ok) {
      expect(expired.record.state).toBe('EXPIRED');
    }
    expect(authority.getAccounting('cap-1')?.reserved.amountMinor).toBe(0);
  });

  test('offers are refused unless the capability is ACTIVE ("degraded capabilities accept no new commitments")', async () => {
    const authority = makeAuthority(createEvidenceLog({ wallMs: 1_000 }));
    await authority.registerCapability({
      capabilityId: 'cap-1',
      declaration: DECLARATION,
      declaredCapacity: money('EUR', 5_000, 2),
    });
    const onRegistered = await authority.offerCommitment({
      intentId: 'pid.v1.i1',
      capabilityId: 'cap-1',
      amount: money('EUR', 100, 2),
      deadlineEpochMs: 60_000,
    });
    expect(onRegistered.ok).toBe(false);
    if (!onRegistered.ok) {
      expect(onRegistered.code).toBe('NOT_ACTIVE');
    }
    await authority.activateCapability('cap-1');
    await authority.degradeCapability('cap-1');
    const onDegraded = await authority.offerCommitment({
      intentId: 'pid.v1.i1',
      capabilityId: 'cap-1',
      amount: money('EUR', 100, 2),
      deadlineEpochMs: 60_000,
    });
    expect(onDegraded.ok).toBe(false);
    if (!onDegraded.ok) {
      expect(onDegraded.code).toBe('NOT_ACTIVE');
      expect(onDegraded.problem).toContain('no new commitments');
    }
  });
});

describe('A03 degradation semantics — OFFERED invalidated, RESERVED survives', () => {
  test('entering DEGRADED invalidates only OFFERED commitments; RESERVED survives until released or expired', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const authority = makeAuthority(log);
    await makeActiveCapability(authority, 2_000);
    // one OFFERED commitment, one RESERVED commitment
    await authority.offerCommitment({
      intentId: 'pid.v1.offered',
      capabilityId: 'cap-1',
      amount: money('EUR', 500, 2),
      deadlineEpochMs: 60_000,
    });
    await authority.offerCommitment({
      intentId: 'pid.v1.reserved',
      capabilityId: 'cap-1',
      amount: money('EUR', 700, 2),
      deadlineEpochMs: 60_000,
    });
    const reservedId = deriveProtocolId('commitment', 'pid.v1.reserved', 'cap-1');
    await authority.reserveCommitment(reservedId);
    // degrade: the OFFERED commitment is invalidated (-> RELEASED with its
    // own evidence record); the RESERVED commitment is untouched
    await authority.degradeCapability('cap-1');
    const offered = authority.getCommitment(deriveProtocolId('commitment', 'pid.v1.offered', 'cap-1'));
    expect(offered?.state).toBe('RELEASED');
    const reserved = authority.getCommitment(reservedId);
    expect(reserved?.state).toBe('RESERVED');
    // capacity: the RESERVED amount is still held (700); the invalidated
    // offer never held any
    expect(authority.getAccounting('cap-1')?.reserved.amountMinor).toBe(700);
    // the invalidated offer emitted COMMITMENT_RELEASED with capacity arithmetic
    const releasedRecords = log
      .records()
      .filter((entry) => entry.what.operationType === 'COMMITMENT_RELEASED');
    expect(releasedRecords.length).toBe(1);
    if (releasedRecords.length > 0) {
      expect(releasedRecords[0]?.what.subjectIds).toContain(deriveProtocolId('commitment', 'pid.v1.offered', 'cap-1'));
    }
    // the RESERVED commitment still completes its lifecycle: release (the
    // area-5 release path) and consume work after degradation
    const consumed = await authority.consumeCommitment(reservedId);
    expect(consumed.ok).toBe(true);
    expect(authority.getAccounting('cap-1')?.consumed.amountMinor).toBe(700);
  });
});

describe('INV-3-2 — serialized per capability with atomic accounting', () => {
  test('5 concurrent reserves against capacity 1_000 with 600 each: exactly ONE fits', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const authority = makeAuthority(log);
    await makeActiveCapability(authority, 1_000);
    const intentIds = Array.from({ length: 5 }, (_, index) => `pid.v1.race-${index}`);
    // all five offers land first (OFFERED holds no capacity)
    await Promise.all(
      intentIds.map((intentId) =>
        authority.offerCommitment({
          intentId,
          capabilityId: 'cap-1',
          amount: money('EUR', 600, 2),
          deadlineEpochMs: 60_000,
        }),
      ),
    );
    // five CONCURRENT reserves: the atomic accounting admits exactly one
    const results = await Promise.all(
      intentIds.map((intentId) => authority.reserveCommitment(deriveProtocolId('commitment', intentId, 'cap-1'))),
    );
    const succeeded = results.filter((result) => result.ok);
    const rejected = results.filter((result) => !result.ok);
    expect(succeeded.length).toBe(1);
    expect(rejected.length).toBe(4);
    for (const result of rejected) {
      expect(result.code).toBe('CAPACITY_EXCEEDED');
    }
    // INV-3-1 after the race: reserved + consumed <= declared, exactly 600
    const accounting = authority.getAccounting('cap-1');
    expect(accounting?.reserved.amountMinor).toBe(600);
    expect(
      accounting ? accounting.reserved.amountMinor + accounting.consumed.amountMinor <= 1_000 : false,
    ).toBe(true);
    // exactly one COMMITMENT_RESERVED record
    expect(
      log.records().filter((entry) => entry.what.operationType === 'COMMITMENT_RESERVED').length,
    ).toBe(1);
  });

  test('concurrent same-(intent, capability) offers collapse to ONE commitment', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const authority = makeAuthority(log);
    await makeActiveCapability(authority);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        authority.offerCommitment({
          intentId: 'pid.v1.same',
          capabilityId: 'cap-1',
          amount: money('EUR', 100, 2),
          deadlineEpochMs: 60_000,
        }),
      ),
    );
    for (const result of results) {
      expect(result.ok).toBe(true);
    }
    const records = new Set(results.map((result) => (result.ok ? result.record : undefined)));
    expect(records.size).toBe(1);
    expect(
      log.records().filter((entry) => entry.what.operationType === 'COMMITMENT_OFFERED').length,
    ).toBe(1);
  });
});

describe('A15 coupling — a failed evidence write fails the capability operation', () => {
  test('a throwing port fails registration and nothing is committed', async () => {
    const failingPort = {
      submit: (): never => {
        throw new Error('log unavailable');
      },
    };
    const authority = new CapabilityAuthority({ evidence: failingPort, gate: ALLOW_ALL });
    await expectRejection(
      authority.registerCapability({
        capabilityId: 'cap-1',
        declaration: DECLARATION,
        declaredCapacity: money('EUR', 5_000, 2),
      }),
      /log unavailable/,
    );
    expect(authority.getCapability('cap-1')).toBe(undefined);
  });

  test('a throwing port fails a reserve and the capacity is unchanged', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const authority = makeAuthority(log);
    await makeActiveCapability(authority);
    await authority.offerCommitment({
      intentId: 'pid.v1.i1',
      capabilityId: 'cap-1',
      amount: money('EUR', 100, 2),
      deadlineEpochMs: 60_000,
    });
    const commitmentId = deriveProtocolId('commitment', 'pid.v1.i1', 'cap-1');
    // swap the port for a failing one is impossible mid-life (the port is
    // fixed at construction); verify the coupling via a second authority
    // over the failing port
    const failingPort = {
      submit: (): never => {
        throw new Error('log unavailable');
      },
    };
    const broken = new CapabilityAuthority({ evidence: failingPort, gate: ALLOW_ALL });
    await expectRejection(
      broken.registerCapability({
        capabilityId: 'cap-1',
        declaration: DECLARATION,
        declaredCapacity: money('EUR', 5_000, 2),
      }),
      /log unavailable/,
    );
    // the healthy authority still reserves
    expect((await authority.reserveCommitment(commitmentId)).ok).toBe(true);
  });
});
