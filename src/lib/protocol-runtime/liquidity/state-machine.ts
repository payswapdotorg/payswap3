/**
 * RTN-007 — Liquidity Authority: pure transition application for the A06
 * state machines (pool and position).
 *
 * Spec sources (binding) — spec/architecture/v0.1/liquidity-credit-queues.md
 * §1 Area 6:
 *   lines 33-35 (LiquidityPool, verbatim):
 *     "States: OPEN -> FROZEN -> CLOSED. Frozen pools accept no new
 *      reservations; closure is terminal after all positions settle."
 *   lines 38-39 (LiquidityPosition, verbatim):
 *     "States: AVAILABLE -> RESERVED -> terminal(CONSUMED | RETURNED).
 *      Transitions are driven exclusively by area 5 reservations."
 *
 * The transition tables themselves live in types.ts (the frozen exact
 * chains); this module applies them to the record shapes, returning the
 * updated record or the typed ILLEGAL_TRANSITION rejection (typed values,
 * never thrown — the merged command convention). The position machine's
 * DRIVING layer (which ledger entry triggers which transition) is
 * accounting.ts's fold; this module is the pure state-carrier.
 */

import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type {
  LiquidityPoolRecord,
  LiquidityPositionRecord,
  PositionState,
  PoolState,
} from './types.ts';
import { canTransitionPool, canTransitionPosition } from './types.ts';

/**
 * Apply one LiquidityPool transition — the pure carrier of the exact
 * chain. Replays (from === to) are the typed ILLEGAL_TRANSITION
 * rejection; every non-edge is too.
 *
 * Source: liquidity-credit-queues.md lines 33-35.
 */
export function transitionPool(
  pool: LiquidityPoolRecord,
  to: PoolState,
  when: ProtocolTime,
): { readonly ok: true; readonly pool: LiquidityPoolRecord } | { readonly ok: false } {
  if (!canTransitionPool(pool.state, to)) {
    return { ok: false };
  }
  return {
    ok: true,
    pool: { ...pool, state: to, stateChangedAt: when },
  };
}

/**
 * Apply one LiquidityPosition transition — the pure carrier of the exact
 * chain. The fold (accounting.ts) decides WHEN a transition happens and
 * to which terminal; this applies it to the record shape.
 *
 * Source: liquidity-credit-queues.md lines 38-39.
 */
export function transitionPosition(
  position: LiquidityPositionRecord,
  to: PositionState,
  when: ProtocolTime,
): { readonly ok: true; readonly position: LiquidityPositionRecord } | { readonly ok: false } {
  if (!canTransitionPosition(position.state, to)) {
    return { ok: false };
  }
  return {
    ok: true,
    position: { ...position, state: to, stateChangedAt: when },
  };
}

/**
 * Mint the transition ProtocolTime for a domain command. The authority
 * owns its sequence counter; this helper exists so the state-machine
 * module stays pure (the caller supplies the sequenced time).
 *
 * Source: A15 line 28 — "when: protocol time (sequenced) and recorded
 * wall time."
 */
export function positionTransitionTime(sequence: number, wallMs: number): ProtocolTime {
  return protocolTime(sequence, wallMs);
}
