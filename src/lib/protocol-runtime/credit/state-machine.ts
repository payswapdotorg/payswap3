/**
 * RTN-007 — Credit Authority: pure transition application for the A07
 * state machines (line and decision).
 *
 * Spec sources (binding) — spec/architecture/v0.1/liquidity-credit-queues.md
 * §2 Area 7:
 *   lines 97-100 (CreditLine, verbatim):
 *     "States: OFFERED -> ACTIVE -> SUSPENDED -> terminal(CLOSED).
 *      Suspension blocks new reservations; closure is terminal after
 *      outstanding exposure is settled or written off (areas 10, 12)."
 *   lines 107-108 (CreditDecision, verbatim):
 *     "States: EVALUATED -> APPLIED."
 *
 * The transition tables live in types.ts (the frozen exact chains); this
 * module applies them to the record shapes, returning the updated record
 * or the typed ILLEGAL_TRANSITION rejection (typed values, never thrown —
 * the merged command convention).
 */

import type { ProtocolTime } from '../kernel/time.ts';
import type {
  CreditDecisionRecord,
  CreditDecisionState,
  CreditLineRecord,
  CreditLineState,
} from './types.ts';
import { canTransitionCreditLine } from './types.ts';

/**
 * Apply one CreditLine transition — the pure carrier of the exact chain.
 * Replays (from === to) and every non-edge are the typed
 * ILLEGAL_TRANSITION rejection.
 *
 * Source: liquidity-credit-queues.md lines 97-100.
 */
export function transitionCreditLine(
  line: CreditLineRecord,
  to: CreditLineState,
  when: ProtocolTime,
): { readonly ok: true; readonly line: CreditLineRecord } | { readonly ok: false } {
  if (!canTransitionCreditLine(line.state, to)) {
    return { ok: false };
  }
  return {
    ok: true,
    line: { ...line, state: to, stateChangedAt: when },
  };
}

/**
 * Apply one CreditDecision transition — the pure carrier of the exact
 * EVALUATED -> APPLIED chain (APPLIED is reached exactly once, when the
 * decision's area-5 reservation is HELD).
 *
 * Source: liquidity-credit-queues.md lines 107-108.
 */
export function transitionCreditDecision(
  decision: CreditDecisionRecord,
  to: CreditDecisionState,
  when: ProtocolTime,
): { readonly ok: true; readonly decision: CreditDecisionRecord } | { readonly ok: false } {
  if (decision.state === to) {
    return { ok: false }; // replays are handled as idempotent observations by the authority
  }
  if (decision.state === 'EVALUATED' && to === 'APPLIED') {
    return {
      ok: true,
      decision: { ...decision, state: to, appliedAt: when },
    };
  }
  return { ok: false };
}
