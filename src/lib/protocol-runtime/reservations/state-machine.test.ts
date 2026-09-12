/**
 * RTN-006 — Reservation Authority: Reservation state machine tests.
 *
 * Tested contract (spec-cited):
 *   spec/architecture/v0.1/core.md §5 Area 5 lines 288-289:
 *     "States: REQUESTED -> HELD -> terminal(CONSUMED | RELEASED |
 *      EXPIRED)."
 *   lines 290-291 (the deterministic deadline rule);
 *   lines 307-309 (INV-5-2); lines 310-312 (INV-5-3); lines 316-318
 *   (crash recovery's roll-back edge).
 */
import { describe, expect, test } from 'bun:test';
import { protocolTime } from '../kernel/time.ts';
import { money } from '../kernel/money.ts';
import {
  RESERVATION_STATES,
  RESERVATION_TRANSITIONS,
  RESERVATION_REASON_CODES,
  RESERVATION_ENTRY_KINDS,
  canTransitionReservation,
  isReservationEntryKind,
  isReservationReasonCode,
  isReservationState,
} from './types.ts';
import { isExpiredAt, isRequestedResolution, transitionReservation } from './state-machine.ts';
import type { ReservationRecord } from './types.ts';

const WHEN = protocolTime(10, 1_000);
const LATER = protocolTime(11, 2_000);

function reservation(state: ReservationRecord['state'], overrides: Partial<ReservationRecord> = {}): ReservationRecord {
  return {
    reservationId: 'pid.v1.res',
    intentId: 'pid.v1.intent',
    hopId: 'pid.v1.hop',
    resourceId: 'cap-a',
    amount: money('EUR', 200_00, 2),
    state,
    deadlineEpochMs: 10_000,
    createdAt: WHEN,
    stateChangedAt: WHEN,
    ...overrides,
  };
}

describe('A05 Reservation state machine (core.md lines 288-289)', () => {
  test('the state vocabulary is exactly the five v0.1 states', () => {
    expect(RESERVATION_STATES).toEqual(['REQUESTED', 'HELD', 'CONSUMED', 'RELEASED', 'EXPIRED']);
    expect(isReservationState('HELD')).toBe(true);
    expect(isReservationState('PENDING')).toBe(false);
  });

  test('the machine is exact: the chain plus the REQUESTED -> RELEASED resolution edge', () => {
    expect(RESERVATION_TRANSITIONS['REQUESTED']).toEqual(['HELD', 'RELEASED']);
    expect(RESERVATION_TRANSITIONS['HELD']).toEqual(['CONSUMED', 'RELEASED', 'EXPIRED']);
    expect(canTransitionReservation('REQUESTED', 'HELD')).toBe(true);
    expect(canTransitionReservation('REQUESTED', 'RELEASED')).toBe(true);
    expect(canTransitionReservation('HELD', 'CONSUMED')).toBe(true);
    expect(canTransitionReservation('HELD', 'RELEASED')).toBe(true);
    expect(canTransitionReservation('HELD', 'EXPIRED')).toBe(true);
    // The skips and shortcuts that must NOT exist:
    expect(canTransitionReservation('REQUESTED', 'CONSUMED')).toBe(false);
    expect(canTransitionReservation('REQUESTED', 'EXPIRED')).toBe(false);
  });

  test('every terminal has an empty successor set (the exactly-once discipline is structural)', () => {
    for (const terminal of ['CONSUMED', 'RELEASED', 'EXPIRED'] as const) {
      expect(RESERVATION_TRANSITIONS[terminal]).toEqual([]);
      expect(canTransitionReservation(terminal, 'HELD')).toBe(false);
      expect(canTransitionReservation(terminal, 'CONSUMED')).toBe(false);
      expect(canTransitionReservation(terminal, 'RELEASED')).toBe(false);
    }
    const result = transitionReservation(reservation('CONSUMED'), 'CONSUMED', LATER);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ILLEGAL_TRANSITION');
      expect(result.problem).toContain('exactly-once');
    }
  });

  test('a transition preserves identity, amount, and deadline', () => {
    const source = reservation('REQUESTED');
    const result = transitionReservation(source, 'HELD', LATER);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reservation.reservationId).toBe(source.reservationId);
      expect(result.reservation.amount).toBe(source.amount);
      expect(result.reservation.deadlineEpochMs).toBe(source.deadlineEpochMs);
      expect(result.reservation.state).toBe('HELD');
      expect(result.reservation.stateChangedAt).toBe(LATER);
    }
  });

  test('reason codes ride only RELEASED and EXPIRED', () => {
    expect(
      transitionReservation(reservation('HELD'), 'CONSUMED', LATER, { reasonCode: 'DEADLINE_EXPIRED' }).ok,
    ).toBe(false);
    expect(
      transitionReservation(reservation('HELD'), 'EXPIRED', LATER, { reasonCode: 'DEADLINE_EXPIRED' }).ok,
    ).toBe(true);
  });

  test('the reason-code and entry-kind vocabularies are frozen and closed', () => {
    expect(RESERVATION_REASON_CODES).toEqual([
      'INSUFFICIENT_AVAILABLE',
      'DEADLINE_EXPIRED',
      'RECOVERY_ROLLFORWARD',
      'RECOVERY_ROLLBACK',
    ]);
    expect(isReservationReasonCode('INSUFFICIENT_AVAILABLE')).toBe(true);
    expect(isReservationReasonCode('SOMETHING')).toBe(false);
    expect(RESERVATION_ENTRY_KINDS).toEqual([
      'RESOURCE_DECLARED',
      'REQUESTED',
      'HELD',
      'CONSUMED',
      'RELEASED',
      'EXPIRED',
    ]);
    expect(isReservationEntryKind('REQUESTED')).toBe(true);
    expect(isReservationEntryKind('PENDING')).toBe(false);
  });
});

describe('A05 deterministic expiry (core.md lines 290-291)', () => {
  test('a HELD reservation expires exactly when the deadline is reached (integer comparison)', () => {
    const held = reservation('HELD', { deadlineEpochMs: 10_000 });
    expect(isExpiredAt(held, protocolTime(1, 9_999))).toBe(false);
    expect(isExpiredAt(held, protocolTime(1, 10_000))).toBe(true);
    expect(isExpiredAt(held, protocolTime(1, 10_001))).toBe(true);
  });

  test('only HELD reservations expire', () => {
    for (const state of ['REQUESTED', 'CONSUMED', 'RELEASED', 'EXPIRED'] as const) {
      expect(isExpiredAt(reservation(state, { deadlineEpochMs: 10_000 }), protocolTime(1, 20_000))).toBe(false);
    }
  });

  test('the REQUESTED resolution rule accepts exactly HELD and RELEASED (INV-5-2 + recovery)', () => {
    expect(isRequestedResolution('HELD')).toBe(true);
    expect(isRequestedResolution('RELEASED')).toBe(true);
    expect(isRequestedResolution('CONSUMED')).toBe(false);
    expect(isRequestedResolution('EXPIRED')).toBe(false);
    expect(isRequestedResolution('REQUESTED')).toBe(false);
  });
});
