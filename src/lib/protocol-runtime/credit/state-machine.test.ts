/**
 * RTN-007 — Credit Authority: the exact A07 state machines, machine-
 * checked — every legal edge applies, every non-edge is rejected.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §2 Area 7:
 *   lines 97-99: "States: OFFERED -> ACTIVE -> SUSPENDED ->
 *    terminal(CLOSED)."
 *   lines 107-108: "States: EVALUATED -> APPLIED."
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';
import { transitionCreditDecision, transitionCreditLine } from './state-machine.ts';
import { CREDIT_DECISION_STATES, CREDIT_LINE_STATES } from './types.ts';
import { canTransitionCreditLine } from './types.ts';
import type {
  CreditDecisionRecord,
  CreditLineRecord,
} from './types.ts';

const WHEN = protocolTime(1, 1_000);

const line = (state: CreditLineRecord['state']): CreditLineRecord => ({
  lineId: 'line-a',
  limit: money('EUR', 5_000_00, 2),
  state,
  offeredAt: WHEN,
  stateChangedAt: WHEN,
});

const decision = (state: CreditDecisionRecord['state']): CreditDecisionRecord => ({
  decisionId: 'pid.v1.decision',
  intentId: 'pid.v1.intent',
  lineId: 'line-a',
  state,
  outcome: { kind: 'APPROVED', approvedAmount: money('EUR', 500_00, 2) },
  evaluatedAt: WHEN,
  ...(state === 'APPLIED' ? { reservationId: 'pid.v1.reservation', appliedAt: WHEN } : {}),
});

describe('A07 credit line machine (OFFERED -> ACTIVE -> SUSPENDED -> CLOSED, exact)', () => {
  test('the vocabulary is exactly the four v0.1 states', () => {
    expect([...CREDIT_LINE_STATES]).toEqual(['OFFERED', 'ACTIVE', 'SUSPENDED', 'CLOSED']);
  });

  test('the exact legal edges; CLOSED terminal', () => {
    expect(canTransitionCreditLine('OFFERED', 'ACTIVE')).toBe(true);
    expect(canTransitionCreditLine('ACTIVE', 'SUSPENDED')).toBe(true);
    expect(canTransitionCreditLine('SUSPENDED', 'CLOSED')).toBe(true);
    for (const to of CREDIT_LINE_STATES) {
      expect(canTransitionCreditLine('CLOSED', to)).toBe(false);
    }
  });

  test('no SUSPENDED -> ACTIVE resume edge (resumption is a new line)', () => {
    expect(canTransitionCreditLine('SUSPENDED', 'ACTIVE')).toBe(false);
  });

  test('no OFFERED -> CLOSED withdrawal edge and no ACTIVE -> CLOSED shortcut', () => {
    expect(canTransitionCreditLine('OFFERED', 'CLOSED')).toBe(false);
    expect(canTransitionCreditLine('OFFERED', 'SUSPENDED')).toBe(false);
    expect(canTransitionCreditLine('ACTIVE', 'CLOSED')).toBe(false);
  });

  test('transitionCreditLine applies the legal edges and rejects the rest', () => {
    const active = transitionCreditLine(line('OFFERED'), 'ACTIVE', WHEN);
    expect(active.ok).toBe(true);
    if (active.ok) {
      expect(active.line.state).toBe('ACTIVE');
      expect(active.line.stateChangedAt).toBe(WHEN);
    }
    expect(transitionCreditLine(line('OFFERED'), 'CLOSED', WHEN).ok).toBe(false);
    expect(transitionCreditLine(line('ACTIVE'), 'OFFERED', WHEN).ok).toBe(false);
    expect(transitionCreditLine(line('SUSPENDED'), 'ACTIVE', WHEN).ok).toBe(false);
    expect(transitionCreditLine(line('CLOSED'), 'SUSPENDED', WHEN).ok).toBe(false);
  });
});

describe('A07 credit decision machine (EVALUATED -> APPLIED, exact)', () => {
  test('the vocabulary is exactly the two v0.1 states', () => {
    expect([...CREDIT_DECISION_STATES]).toEqual(['EVALUATED', 'APPLIED']);
  });

  test('EVALUATED -> APPLIED applies and sets the applied time', () => {
    const applied = transitionCreditDecision(decision('EVALUATED'), 'APPLIED', WHEN);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.decision.state).toBe('APPLIED');
      expect(applied.decision.appliedAt).toBe(WHEN);
    }
  });

  test('APPLIED has no successor (apply exactly once)', () => {
    expect(transitionCreditDecision(decision('APPLIED'), 'APPLIED', WHEN).ok).toBe(false);
    expect(transitionCreditDecision(decision('APPLIED'), 'EVALUATED', WHEN).ok).toBe(false);
  });
});
