/**
 * RTN-005 — A01 state-machine conformance tests (the frozen tables and the
 * pure transition application; legal + illegal transitions).
 *
 * Source of the tested contract — spec/architecture/v0.1/core.md §1:
 *   lines 34-37: "States: DRAFT -> AUTHORIZED -> ROUTED -> FULFILLING ->
 *    terminal(FULFILLED | FAILED | CANCELLED). Transitions are one-way; a
 *    failed or cancelled intent cannot be restarted. A retry is a new
 *    intent linked to the prior intent id."
 *   lines 54-56 (INV-1-1: terms fixed at AUTHORIZATION; change -> new
 *    intent + CANCELLED).
 *   lines 67-69 (routing/fulfillment failure -> FAILED with reason code).
 * Work order acceptance: "All three state machines exact; one-way
 * transitions enforced; retry-as-new-intent linkage."
 */
import { describe, expect, test } from 'bun:test';
import { protocolTime } from '../kernel/time.ts';
import { money } from '../kernel/money.ts';
import {
  INTENT_STATES,
  INTENT_TRANSITIONS,
  INTENT_REASON_CODES,
  isIntentState,
  isIntentReasonCode,
  canTransitionIntent,
} from './types.ts';
import type { IntentState } from './types.ts';
import { demandDescriptor, demandDescriptorHash } from './descriptor.ts';
import {
  draftPaymentIntent,
  transitionPaymentIntent,
  requiresReasonCode,
  checkIntentReasonCode,
} from './state-machine.ts';

const WHEN = protocolTime(0, 1_000);
const LATER = protocolTime(1, 2_000);

const DESCRIPTOR = demandDescriptor({
  amount: money('EUR', 1_000, 2),
  source: { currency: 'EUR', geography: 'DE', account: 'acct-source' },
  destination: { currency: 'USD', geography: 'US', account: 'acct-destination' },
  constraints: {
    deadlineEpochMs: 60_000,
    allowedRails: ['rail-a'],
    costCeiling: money('USD', 500, 2),
  },
  idempotencyKey: 'idem-1',
});

const STATES = INTENT_STATES as readonly IntentState[];

describe('A01 PaymentIntent — frozen transition table exact', () => {
  test('the state vocabulary is exactly the seven v0.1 states', () => {
    expect([...INTENT_STATES]).toEqual([
      'DRAFT',
      'AUTHORIZED',
      'ROUTED',
      'FULFILLING',
      'FULFILLED',
      'FAILED',
      'CANCELLED',
    ]);
  });

  test('the happy-path chain is exact: DRAFT→AUTHORIZED→ROUTED→FULFILLING→terminals', () => {
    expect(INTENT_TRANSITIONS['DRAFT']).toEqual(['AUTHORIZED']);
    expect(INTENT_TRANSITIONS['AUTHORIZED']).toContain('ROUTED');
    expect(INTENT_TRANSITIONS['ROUTED']).toContain('FULFILLING');
    expect(INTENT_TRANSITIONS['FULFILLING']).toContain('FULFILLED');
  });

  test('INV-1-1 CANCELLED exits exist from AUTHORIZED, ROUTED, FULFILLING; not from DRAFT', () => {
    expect(INTENT_TRANSITIONS['AUTHORIZED']).toContain('CANCELLED');
    expect(INTENT_TRANSITIONS['ROUTED']).toContain('CANCELLED');
    expect(INTENT_TRANSITIONS['FULFILLING']).toContain('CANCELLED');
    expect(INTENT_TRANSITIONS['DRAFT']).not.toContain('CANCELLED');
  });

  test('failure semantics: AUTHORIZED and ROUTED carry FAILED exits (routing/fulfillment failure)', () => {
    expect(INTENT_TRANSITIONS['AUTHORIZED']).toContain('FAILED');
    expect(INTENT_TRANSITIONS['ROUTED']).toContain('FAILED');
    expect(INTENT_TRANSITIONS['FULFILLING']).toContain('FAILED');
    expect(INTENT_TRANSITIONS['DRAFT']).not.toContain('FAILED');
  });

  test('terminals have empty successor sets (one-way; no restart is representable)', () => {
    for (const terminal of ['FULFILLED', 'FAILED', 'CANCELLED'] as const) {
      expect(INTENT_TRANSITIONS[terminal]).toEqual([]);
    }
  });

  test('every state is a table key (total, frozen)', () => {
    for (const state of STATES) {
      expect(INTENT_TRANSITIONS[state]).not.toBe(undefined);
    }
    expect(Object.isFrozen(INTENT_TRANSITIONS)).toBe(true);
  });
});

describe('A01 — legal transitions apply; illegal transitions are typed rejections', () => {
  const draft = draftPaymentIntent({
    intentId: 'pid.v1.test',
    descriptor: DESCRIPTOR,
    descriptorHash: demandDescriptorHash(DESCRIPTOR),
    when: WHEN,
  });

  function inState(state: IntentState) {
    return { ...draft, state };
  }

  test('each legal (from, to) pair transitions and preserves the descriptor verbatim', () => {
    const legal: readonly [IntentState, IntentState][] = [
      ['DRAFT', 'AUTHORIZED'],
      ['AUTHORIZED', 'ROUTED'],
      ['AUTHORIZED', 'FAILED'],
      ['AUTHORIZED', 'CANCELLED'],
      ['ROUTED', 'FULFILLING'],
      ['ROUTED', 'FAILED'],
      ['ROUTED', 'CANCELLED'],
      ['FULFILLING', 'FULFILLED'],
      ['FULFILLING', 'FAILED'],
      ['FULFILLING', 'CANCELLED'],
    ];
    for (const [from, to] of legal) {
      expect(canTransitionIntent(from, to)).toBe(true);
      const result = transitionPaymentIntent(inState(from), to, LATER);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.intent.state).toBe(to);
        expect(result.intent.stateChangedAt).toBe(LATER);
        // INV-1-1: the terms ride along untouched — the same descriptor
        // object, the same hash.
        expect(result.intent.descriptor).toBe(draft.descriptor);
        expect(result.intent.descriptorHash).toBe(draft.descriptorHash);
        expect(result.intent.intentId).toBe(draft.intentId);
        expect(result.intent.createdAt).toBe(WHEN);
      }
    }
  });

  test('every (from, to) pair outside the table is rejected — the full illegal battery', () => {
    let illegalCount = 0;
    for (const from of STATES) {
      for (const to of STATES) {
        if (canTransitionIntent(from, to)) {
          continue;
        }
        illegalCount += 1;
        const result = transitionPaymentIntent(inState(from), to, LATER);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe('ILLEGAL_TRANSITION');
          expect(result.problem).toContain(from);
          expect(result.problem).toContain(to);
        }
      }
    }
    // 7x7 = 49 pairs minus 10 legal = 39 illegal pairs, all rejected.
    expect(illegalCount).toBe(39);
  });

  test('restart attempts are illegal: FAILED -> DRAFT/AUTHORIZED, CANCELLED -> DRAFT/AUTHORIZED', () => {
    expect(transitionPaymentIntent(inState('FAILED'), 'DRAFT', LATER).ok).toBe(false);
    expect(transitionPaymentIntent(inState('FAILED'), 'AUTHORIZED', LATER).ok).toBe(false);
    expect(transitionPaymentIntent(inState('CANCELLED'), 'DRAFT', LATER).ok).toBe(false);
    expect(transitionPaymentIntent(inState('CANCELLED'), 'AUTHORIZED', LATER).ok).toBe(false);
    expect(transitionPaymentIntent(inState('FULFILLED'), 'DRAFT', LATER).ok).toBe(false);
  });

  test('skip transitions are illegal: DRAFT -> ROUTED/FULFILLING/FAILED/CANCELLED', () => {
    for (const to of ['ROUTED', 'FULFILLING', 'FAILED', 'CANCELLED'] as const) {
      expect(transitionPaymentIntent(draft, to, LATER).ok).toBe(false);
    }
  });

  test('self-transitions are illegal (a transition always changes state)', () => {
    for (const state of STATES) {
      expect(canTransitionIntent(state, state)).toBe(false);
    }
  });
});

describe('A01 reason codes — the frozen machine-readable vocabulary', () => {
  test('the vocabulary is exactly the five members', () => {
    expect([...INTENT_REASON_CODES]).toEqual([
      'POLICY_UNSATISFIABLE',
      'NO_VIABLE_ROUTE',
      'FULFILLMENT_FAILED',
      'TERMS_SUPERSEDED',
      'PAYER_CANCELLED',
    ]);
    expect(Object.isFrozen(INTENT_REASON_CODES)).toBe(true);
  });

  test('guards recognize members and reject outsiders', () => {
    expect(isIntentReasonCode('POLICY_UNSATISFIABLE')).toBe(true);
    expect(isIntentReasonCode('TERMS_SUPERSEDED')).toBe(true);
    expect(isIntentReasonCode('INVENTED')).toBe(false);
    expect(isIntentReasonCode(null)).toBe(false);
    expect(isIntentState('DRAFT')).toBe(true);
    expect(isIntentState('SUBMITTED')).toBe(false);
    expect(isIntentState(42)).toBe(false);
  });

  test('FAILED and CANCELLED require a reason code; happy-path transitions do not', () => {
    expect(requiresReasonCode('FAILED')).toBe(true);
    expect(requiresReasonCode('CANCELLED')).toBe(true);
    for (const state of ['DRAFT', 'AUTHORIZED', 'ROUTED', 'FULFILLING', 'FULFILLED'] as const) {
      expect(requiresReasonCode(state)).toBe(false);
    }
    expect(checkIntentReasonCode('FAILED', undefined).ok).toBe(false);
    expect(checkIntentReasonCode('CANCELLED', undefined).ok).toBe(false);
    expect(checkIntentReasonCode('ROUTED', undefined).ok).toBe(true);
    expect(checkIntentReasonCode('FAILED', 'POLICY_UNSATISFIABLE').ok).toBe(true);
  });
});
