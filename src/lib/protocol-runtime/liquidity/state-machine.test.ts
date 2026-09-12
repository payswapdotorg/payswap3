/**
 * RTN-007 — Liquidity Authority: the exact A06 state machines, machine-
 * checked — every legal edge applies, every non-edge is rejected.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §1 Area 6:
 *   lines 33-34: "States: OPEN -> FROZEN -> CLOSED."
 *   lines 38-39: "States: AVAILABLE -> RESERVED -> terminal(CONSUMED |
 *    RETURNED). Transitions are driven exclusively by area 5
 *    reservations."
 */
import { describe, expect, test } from 'bun:test';
import { protocolTime } from '../kernel/time.ts';
import { transitionPool, transitionPosition } from './state-machine.ts';
import { POOL_STATES, POSITION_STATES } from './types.ts';
import { canTransitionPool, canTransitionPosition } from './types.ts';
import type { LiquidityPoolRecord, LiquidityPositionRecord } from './types.ts';
import { money } from '../kernel/money.ts';

const WHEN = protocolTime(1, 1_000);

const pool = (state: LiquidityPoolRecord['state']): LiquidityPoolRecord => ({
  poolId: 'pool-a',
  currency: 'EUR',
  scale: 2,
  state,
  totalMinor: 0,
  openedAt: WHEN,
  stateChangedAt: WHEN,
});

const position = (state: LiquidityPositionRecord['state']): LiquidityPositionRecord => ({
  positionId: 'pid.v1.position',
  poolId: 'pool-a',
  fundingEntryId: 'pid.v1.entry',
  state,
  total: money('EUR', 100_00, 2),
  available: money('EUR', 100_00, 2),
  reserved: money('EUR', 0, 2),
  consumed: money('EUR', 0, 2),
  fundingSource: { kind: 'INTERNAL_TRANSFER', referenceId: 'transfer-1' },
  createdAt: WHEN,
  stateChangedAt: WHEN,
});

describe('A06 pool machine (OPEN -> FROZEN -> CLOSED, exact)', () => {
  test('the vocabulary is exactly the three v0.1 states', () => {
    expect([...POOL_STATES]).toEqual(['OPEN', 'FROZEN', 'CLOSED']);
  });

  test('the exact legal edges: OPEN->FROZEN, FROZEN->CLOSED; CLOSED terminal', () => {
    expect(canTransitionPool('OPEN', 'FROZEN')).toBe(true);
    expect(canTransitionPool('FROZEN', 'CLOSED')).toBe(true);
    expect(canTransitionPool('CLOSED', 'OPEN')).toBe(false);
    expect(canTransitionPool('CLOSED', 'FROZEN')).toBe(false);
  });

  test('closure directly from OPEN is not an edge (freeze first)', () => {
    expect(canTransitionPool('OPEN', 'CLOSED')).toBe(false);
  });

  test('there is no unfreeze edge (FROZEN -> OPEN)', () => {
    expect(canTransitionPool('FROZEN', 'OPEN')).toBe(false);
  });

  test('transitionPool applies the legal edges and rejects the rest', () => {
    const frozen = transitionPool(pool('OPEN'), 'FROZEN', WHEN);
    expect(frozen.ok).toBe(true);
    if (frozen.ok) {
      expect(frozen.pool.state).toBe('FROZEN');
      expect(frozen.pool.stateChangedAt).toBe(WHEN);
    }
    expect(transitionPool(pool('OPEN'), 'CLOSED', WHEN).ok).toBe(false);
    expect(transitionPool(pool('FROZEN'), 'OPEN', WHEN).ok).toBe(false);
    expect(transitionPool(pool('CLOSED'), 'FROZEN', WHEN).ok).toBe(false);
    expect(transitionPool(pool('FROZEN'), 'FROZEN', WHEN).ok).toBe(false);
  });
});

describe('A06 position machine (AVAILABLE -> RESERVED -> terminal, exact)', () => {
  test('the vocabulary is exactly the four v0.1 states', () => {
    expect([...POSITION_STATES]).toEqual(['AVAILABLE', 'RESERVED', 'CONSUMED', 'RETURNED']);
  });

  test('the exact legal edges', () => {
    expect(canTransitionPosition('AVAILABLE', 'RESERVED')).toBe(true);
    expect(canTransitionPosition('RESERVED', 'CONSUMED')).toBe(true);
    expect(canTransitionPosition('RESERVED', 'RETURNED')).toBe(true);
  });

  test('there is NO RESERVED -> AVAILABLE edge (the chain is one-way)', () => {
    expect(canTransitionPosition('RESERVED', 'AVAILABLE')).toBe(false);
  });

  test('terminals have empty successor sets', () => {
    for (const terminal of ['CONSUMED', 'RETURNED'] as const) {
      for (const to of POSITION_STATES) {
        expect(canTransitionPosition(terminal, to)).toBe(false);
      }
    }
  });

  test('AVAILABLE cannot jump to a terminal (a hold comes first)', () => {
    expect(canTransitionPosition('AVAILABLE', 'CONSUMED')).toBe(false);
    expect(canTransitionPosition('AVAILABLE', 'RETURNED')).toBe(false);
  });

  test('transitionPosition applies the legal edges and rejects the rest', () => {
    const reserved = transitionPosition(position('AVAILABLE'), 'RESERVED', WHEN);
    expect(reserved.ok).toBe(true);
    if (reserved.ok) {
      expect(reserved.position.state).toBe('RESERVED');
    }
    expect(transitionPosition(position('RESERVED'), 'AVAILABLE', WHEN).ok).toBe(false);
    expect(transitionPosition(position('CONSUMED'), 'RESERVED', WHEN).ok).toBe(false);
    expect(transitionPosition(position('RETURNED'), 'RESERVED', WHEN).ok).toBe(false);
  });
});
