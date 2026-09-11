/**
 * RTN-005 — A03 state-machine conformance tests: the frozen Capability and
 * Commitment transition tables, the pure transition application, and the
 * degradation rules (legal + illegal transitions).
 *
 * Source of the tested contract — spec/architecture/v0.1/core.md §3:
 *   lines 156-158: "States: REGISTERED -> ACTIVE -> DEGRADED -> RETIRED.
 *    Degraded capabilities accept no new commitments. Retirement is
 *    terminal."
 *   lines 160-163: "States: OFFERED -> RESERVED -> CONSUMED | EXPIRED |
 *    RELEASED. RESERVED commitments count against capability capacity;
 *    CONSUMED is terminal and exactly once per intent."
 *   lines 186-190: "A capability entering DEGRADED invalidates only OFFERED
 *    commitments; RESERVED commitments remain valid until released by area
 *    5 rules or expired by deadline."
 * Work order acceptance: "All three state machines exact; one-way
 * transitions enforced."
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';
import {
  CAPABILITY_STATES,
  CAPABILITY_TRANSITIONS,
  COMMITMENT_STATES,
  COMMITMENT_TRANSITIONS,
  isCapabilityState,
  isCommitmentState,
  canTransitionCapability,
  canTransitionCommitment,
} from './types.ts';
import type { CapabilityRecord, CommitmentRecord, CommitmentState } from './types.ts';
import {
  transitionCapability,
  transitionCommitment,
  acceptsNewCommitments,
  isInvalidatedByDegradation,
  isExpiredAt,
} from './state-machine.ts';

const WHEN = protocolTime(0, 1_000);
const LATER = protocolTime(1, 2_000);

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

const CAPABILITY: CapabilityRecord = {
  capabilityId: 'cap-1',
  state: 'ACTIVE',
  declaration: DECLARATION,
  declaredCapacity: money('EUR', 5_000, 2),
  reservedTotal: money('EUR', 0, 2),
  consumedTotal: money('EUR', 0, 2),
  createdAt: WHEN,
  stateChangedAt: WHEN,
};

const COMMITMENT: CommitmentRecord = {
  commitmentId: 'pid.v1.commitment',
  intentId: 'pid.v1.intent',
  capabilityId: 'cap-1',
  amount: money('EUR', 1_000, 2),
  state: 'OFFERED',
  deadlineEpochMs: 60_000,
  createdAt: WHEN,
  stateChangedAt: WHEN,
};

describe('A03 Capability — frozen transition table exact', () => {
  test('exactly REGISTERED→ACTIVE→DEGRADED→RETIRED (the strict chain, no shortcuts)', () => {
    expect(CAPABILITY_TRANSITIONS['REGISTERED']).toEqual(['ACTIVE']);
    expect(CAPABILITY_TRANSITIONS['ACTIVE']).toEqual(['DEGRADED']);
    expect(CAPABILITY_TRANSITIONS['DEGRADED']).toEqual(['RETIRED']);
    expect(CAPABILITY_TRANSITIONS['RETIRED']).toEqual([]);
  });

  test('the state vocabulary is exactly the four v0.1 states; guards work', () => {
    expect([...CAPABILITY_STATES]).toEqual(['REGISTERED', 'ACTIVE', 'DEGRADED', 'RETIRED']);
    expect(isCapabilityState('ACTIVE')).toBe(true);
    expect(isCapabilityState('SUSPENDED')).toBe(false);
    expect(Object.isFrozen(CAPABILITY_STATES)).toBe(true);
    expect(Object.isFrozen(CAPABILITY_TRANSITIONS)).toBe(true);
  });

  test('every illegal Capability pair is rejected — the full battery', () => {
    const states = [...CAPABILITY_STATES];
    let illegal = 0;
    for (const from of states) {
      for (const to of states) {
        if (canTransitionCapability(from, to)) {
          continue;
        }
        illegal += 1;
        const result = transitionCapability({ ...CAPABILITY, state: from }, to, LATER);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe('ILLEGAL_TRANSITION');
        }
      }
    }
    // 4x4 = 16 pairs minus 3 legal = 13 illegal pairs, all rejected.
    expect(illegal).toBe(13);
  });

  test('retirement is terminal and only reachable from DEGRADED', () => {
    expect(transitionCapability({ ...CAPABILITY, state: 'ACTIVE' }, 'RETIRED', LATER).ok).toBe(false);
    expect(transitionCapability({ ...CAPABILITY, state: 'REGISTERED' }, 'RETIRED', LATER).ok).toBe(false);
    expect(transitionCapability({ ...CAPABILITY, state: 'RETIRED' }, 'ACTIVE', LATER).ok).toBe(false);
    expect(transitionCapability({ ...CAPABILITY, state: 'DEGRADED' }, 'RETIRED', LATER).ok).toBe(true);
  });
});

describe('A03 Commitment — frozen transition table exact', () => {
  test('the machine: OFFERED→RESERVED; RESERVED→{CONSUMED, EXPIRED, RELEASED}; OFFERED→RELEASED (degradation invalidation)', () => {
    expect(COMMITMENT_TRANSITIONS['OFFERED']).toEqual(['RESERVED', 'RELEASED']);
    expect(COMMITMENT_TRANSITIONS['RESERVED']).toEqual(['CONSUMED', 'EXPIRED', 'RELEASED']);
    expect(COMMITMENT_TRANSITIONS['CONSUMED']).toEqual([]);
    expect(COMMITMENT_TRANSITIONS['EXPIRED']).toEqual([]);
    expect(COMMITMENT_TRANSITIONS['RELEASED']).toEqual([]);
  });

  test('the state vocabulary is exactly the five v0.1 states; guards work', () => {
    expect([...COMMITMENT_STATES]).toEqual([
      'OFFERED',
      'RESERVED',
      'CONSUMED',
      'EXPIRED',
      'RELEASED',
    ]);
    expect(isCommitmentState('RESERVED')).toBe(true);
    expect(isCommitmentState('PENDING')).toBe(false);
    expect(Object.isFrozen(COMMITMENT_TRANSITIONS)).toBe(true);
  });

  test('every illegal Commitment pair is rejected — the full battery', () => {
    const states = [...COMMITMENT_STATES] as readonly CommitmentState[];
    let illegal = 0;
    for (const from of states) {
      for (const to of states) {
        if (canTransitionCommitment(from, to)) {
          continue;
        }
        illegal += 1;
        const result = transitionCommitment({ ...COMMITMENT, state: from }, to, LATER);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe('ILLEGAL_TRANSITION');
        }
      }
    }
    // 5x5 = 25 pairs minus 5 legal = 20 illegal pairs, all rejected —
    // including every restart (OFFERED->CONSUMED) and every terminal exit.
    expect(illegal).toBe(20);
  });

  test('CONSUMED is terminal: the second consume attempt is illegal', () => {
    const consumed = transitionCommitment({ ...COMMITMENT, state: 'RESERVED' }, 'CONSUMED', LATER);
    expect(consumed.ok).toBe(true);
    if (consumed.ok) {
      expect(transitionCommitment(consumed.record, 'CONSUMED', LATER).ok).toBe(false);
      expect(transitionCommitment(consumed.record, 'RELEASED', LATER).ok).toBe(false);
      expect(transitionCommitment(consumed.record, 'RESERVED', LATER).ok).toBe(false);
    }
  });
});

describe('A03 degradation semantics (pure rules)', () => {
  test('only ACTIVE capabilities accept new commitments', () => {
    expect(acceptsNewCommitments({ ...CAPABILITY, state: 'ACTIVE' })).toBe(true);
    expect(acceptsNewCommitments({ ...CAPABILITY, state: 'DEGRADED' })).toBe(false);
    expect(acceptsNewCommitments({ ...CAPABILITY, state: 'REGISTERED' })).toBe(false);
    expect(acceptsNewCommitments({ ...CAPABILITY, state: 'RETIRED' })).toBe(false);
  });

  test('only OFFERED commitments are invalidated by degradation; RESERVED survives', () => {
    expect(isInvalidatedByDegradation({ ...COMMITMENT, state: 'OFFERED' })).toBe(true);
    expect(isInvalidatedByDegradation({ ...COMMITMENT, state: 'RESERVED' })).toBe(false);
    expect(isInvalidatedByDegradation({ ...COMMITMENT, state: 'CONSUMED' })).toBe(false);
    expect(isInvalidatedByDegradation({ ...COMMITMENT, state: 'RELEASED' })).toBe(false);
  });

  test('expiry is deterministic on protocol time (deadline passed)', () => {
    const commitment = { ...COMMITMENT, state: 'RESERVED' as const, deadlineEpochMs: 5_000 };
    expect(isExpiredAt(commitment, 4_999)).toBe(false);
    expect(isExpiredAt(commitment, 5_000)).toBe(true);
    expect(isExpiredAt(commitment, 5_001)).toBe(true);
  });
});
