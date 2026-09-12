/**
 * RTN-007 — Liquidity Authority: the A06 type vocabulary, state machine
 * tables, record shapes, and runtime guards.
 *
 * Spec sources (binding) — spec/architecture/v0.1/liquidity-credit-queues.md
 * §1 Area 6:
 *   lines 29-43 (Core objects and state, verbatim):
 *     "LiquidityPool — protocol-owned account of funds usable for
 *      fulfillment in one currency.
 *      States: OPEN -> FROZEN -> CLOSED. Frozen pools accept no new
 *      reservations; closure is terminal after all positions settle."
 *     "LiquidityPosition — component of a pool attributed to a funding
 *      source or operational purpose.
 *      States: AVAILABLE -> RESERVED -> terminal(CONSUMED | RETURNED).
 *      Transitions are driven exclusively by area 5 reservations."
 *     "FundingEntry — record of funds entering a pool, referencing either
 *      an internal transfer of settled funds (area 12) or a confirmed
 *      external funding rail operation (area 13)."
 *   lines 47-48 (Owning authority):
 *     "Liquidity Authority (protocol layer, area 6) owns pool and position
 *      state. No other layer may recompute or duplicate it (GC-4)."
 *   lines 50-62 (INV-6-1 / INV-6-2 / INV-6-3, quoted in the enforcing
 *     modules: accounting.ts, authority.ts, and the funding-id
 *     exactly-once contract below).
 *   lines 64-69 (failure and UNKNOWN semantics — the FundingEntry creation
 *     rule: only after reconciliation confirms; UNKNOWN leaves the pool
 *     unchanged; confirmed failure creates no entry).
 *   lines 71-75 (evidence produced — POOL_OPENED, POOL_FROZEN,
 *     POOL_CLOSED, POSITION_STATE_CHANGED, FUNDING_RECORDED).
 *   lines 77-82 (boundaries — never touch rails (GC-3); customer-facing
 *     balances are a product projection (GC-4); "Depends on areas 5, 12,
 *     13, and 14").
 *   spec/architecture/v0.1/README.md §3 GC-1/GC-4/GC-5.
 *   spec/registry/protocol-registry.json A06 — owningAuthority:
 *     "Liquidity Authority".
 *   spec/architecture/v0.1/core.md §5 Area 5 lines 335-336 ("Depends on
 *     areas 6, 7, and 3 as resource owners" — the position IS the area-5
 *     resource this domain declares).
 *
 * Transition-table interpretation (recorded in CONTRACT-REVIEW.md): the
 * v0.1 chains are materialized EXACTLY as written:
 *   - Pool: OPEN -> FROZEN -> CLOSED (closure only from FROZEN, after all
 *     positions settle; freezing only from OPEN). No unfreeze edge.
 *   - Position: AVAILABLE -> RESERVED -> terminal(CONSUMED | RETURNED).
 *     There is NO RESERVED -> AVAILABLE edge: a position whose held amount
 *     drains to zero ends its reservation cycle terminal — CONSUMED when
 *     the position is exhausted (consumed == total), RETURNED otherwise
 *     (the residual stays attributed to the returned position, still
 *     counted in the pool total by INV-6-1). Re-offering capacity is the
 *     funding flow's job (a new FundingEntry creates a new AVAILABLE
 *     position). Every terminal has an empty successor set.
 */

import type { Money } from '../kernel/money.ts';
import type { ProtocolTime } from '../kernel/time.ts';

/**
 * The LiquidityPool state vocabulary, verbatim from the v0.1 chain.
 *
 * Source: liquidity-credit-queues.md lines 33-34 — "States: OPEN -> FROZEN
 * -> CLOSED."
 */
export const POOL_STATES: readonly ['OPEN', 'FROZEN', 'CLOSED'] = Object.freeze([
  'OPEN',
  'FROZEN',
  'CLOSED',
] as const);

/**
 * A LiquidityPool state. CLOSED is terminal ("closure is terminal after
 * all positions settle").
 *
 * Source: liquidity-credit-queues.md lines 33-34.
 */
export type PoolState = (typeof POOL_STATES)[number];

/**
 * The frozen one-way LiquidityPool transition table — the exact v0.1
 * chain. "Frozen pools accept no new reservations" (the authority's
 * command surface enforces the gate); closure requires FROZEN with every
 * position terminal.
 *
 * Source: liquidity-credit-queues.md lines 33-34.
 */
export const POOL_TRANSITIONS: Readonly<Record<PoolState, readonly PoolState[]>> = Object.freeze({
  OPEN: Object.freeze(['FROZEN'] as const),
  FROZEN: Object.freeze(['CLOSED'] as const),
  CLOSED: Object.freeze([] as const),
});

/**
 * Runtime type guard for PoolState.
 *
 * Source: liquidity-credit-queues.md lines 33-34 (the vocabulary this
 * guard re-checks).
 */
export function isPoolState(value: unknown): value is PoolState {
  return typeof value === 'string' && (POOL_STATES as readonly string[]).includes(value);
}

/**
 * True iff the (from, to) pair is a legal one-way LiquidityPool transition.
 *
 * Source: liquidity-credit-queues.md lines 33-34 (the chain this table
 * materializes).
 */
export function canTransitionPool(from: PoolState, to: PoolState): boolean {
  return POOL_TRANSITIONS[from].includes(to);
}

/**
 * The LiquidityPosition state vocabulary, verbatim from the v0.1 chain.
 *
 * Source: liquidity-credit-queues.md lines 38-39 — "States: AVAILABLE ->
 * RESERVED -> terminal(CONSUMED | RETURNED)."
 */
export const POSITION_STATES: readonly [
  'AVAILABLE',
  'RESERVED',
  'CONSUMED',
  'RETURNED',
] = Object.freeze(['AVAILABLE', 'RESERVED', 'CONSUMED', 'RETURNED'] as const);

/**
 * A LiquidityPosition state. CONSUMED and RETURNED are terminal
 * ("terminal(CONSUMED | RETURNED)").
 *
 * Source: liquidity-credit-queues.md lines 38-39.
 */
export type PositionState = (typeof POSITION_STATES)[number];

/**
 * The frozen one-way LiquidityPosition transition table — the exact v0.1
 * chain, driven exclusively by area 5 reservations (the ledger's HELD /
 * CONSUMED / RELEASED / EXPIRED entries against the position's resource).
 * AVAILABLE -> RESERVED happens when an area-5 hold is placed; RESERVED ->
 * CONSUMED when the position is exhausted by consumed holds; RESERVED ->
 * RETURNED when the held amount drains to zero without full consumption.
 *
 * Source: liquidity-credit-queues.md lines 38-39 ("Transitions are driven
 * exclusively by area 5 reservations").
 */
export const POSITION_TRANSITIONS: Readonly<Record<PositionState, readonly PositionState[]>> =
  Object.freeze({
    AVAILABLE: Object.freeze(['RESERVED'] as const),
    RESERVED: Object.freeze(['CONSUMED', 'RETURNED'] as const),
    CONSUMED: Object.freeze([] as const),
    RETURNED: Object.freeze([] as const),
  });

/**
 * Runtime type guard for PositionState.
 *
 * Source: liquidity-credit-queues.md lines 38-39.
 */
export function isPositionState(value: unknown): value is PositionState {
  return typeof value === 'string' && (POSITION_STATES as readonly string[]).includes(value);
}

/**
 * True iff the (from, to) pair is a legal one-way LiquidityPosition
 * transition.
 *
 * Source: liquidity-credit-queues.md lines 38-39 (the chain this table
 * materializes).
 */
export function canTransitionPosition(from: PositionState, to: PositionState): boolean {
  return POSITION_TRANSITIONS[from].includes(to);
}

/**
 * The A06 reason-code vocabulary — the machine-readable codes the POOL_*,
 * POSITION_STATE_CHANGED, and FUNDING_RECORDED records' outcome slots
 * carry. Members (each grounded or a recorded interpretation, see
 * CONTRACT-REVIEW.md):
 *   - HOLD_PLACED / HOLD_CONSUMED / HOLD_RELEASED / HOLD_EXPIRED — the
 *     driving area-5 ledger event behind a POSITION_STATE_CHANGED record
 *     ("Transitions are driven exclusively by area 5 reservations", lines
 *     38-39; the ledger's own transition vocabulary, core.md lines
 *     288-289).
 *   - POSITION_FUNDED — the funding event behind a position's creation
 *     (its first AVAILABLE record; lines 40-43).
 *   - POOL_OPENED / POOL_FROZEN_NO_NEW_RESERVATIONS /
 *     POOL_CLOSED_ALL_POSITIONS_SETTLED — the pool-state records' grounded
 *     reasons (lines 33-35).
 *
 * Source: liquidity-credit-queues.md lines 33-43, 71-75; A15 line 30
 * ("outcome: resulting state or decision, including reason codes").
 */
export const LIQUIDITY_REASON_CODES: readonly [
  'HOLD_PLACED',
  'HOLD_CONSUMED',
  'HOLD_RELEASED',
  'HOLD_EXPIRED',
  'POSITION_FUNDED',
  'POOL_OPENED',
  'POOL_FROZEN_NO_NEW_RESERVATIONS',
  'POOL_CLOSED_ALL_POSITIONS_SETTLED',
] = Object.freeze([
  'HOLD_PLACED',
  'HOLD_CONSUMED',
  'HOLD_RELEASED',
  'HOLD_EXPIRED',
  'POSITION_FUNDED',
  'POOL_OPENED',
  'POOL_FROZEN_NO_NEW_RESERVATIONS',
  'POOL_CLOSED_ALL_POSITIONS_SETTLED',
] as const);

/** An A06 reason code. Source: the frozen vocabulary above. */
export type LiquidityReasonCode = (typeof LIQUIDITY_REASON_CODES)[number];

/**
 * Runtime type guard for LiquidityReasonCode.
 *
 * Source: A15 line 30 (the reason-code contract this guards).
 */
export function isLiquidityReasonCode(value: unknown): value is LiquidityReasonCode {
  return typeof value === 'string' && (LIQUIDITY_REASON_CODES as readonly string[]).includes(value);
}

/**
 * The provenance of a FundingEntry — the two reference kinds the spec
 * names: "referencing either an internal transfer of settled funds (area
 * 12) or a confirmed external funding rail operation (area 13)."
 *
 * Source: liquidity-credit-queues.md lines 40-43.
 */
export const FUNDING_SOURCE_KINDS: readonly ['INTERNAL_TRANSFER', 'EXTERNAL_RAIL'] = Object.freeze([
  'INTERNAL_TRANSFER',
  'EXTERNAL_RAIL',
] as const);

/**
 * One FundingEntry source reference kind.
 *
 * Source: liquidity-credit-queues.md lines 40-43.
 */
export type FundingSourceKind = (typeof FUNDING_SOURCE_KINDS)[number];

/**
 * Runtime type guard for FundingSourceKind.
 *
 * Source: liquidity-credit-queues.md lines 40-43.
 */
export function isFundingSourceKind(value: unknown): value is FundingSourceKind {
  return typeof value === 'string' && (FUNDING_SOURCE_KINDS as readonly string[]).includes(value);
}

/**
 * LiquidityPool — protocol-owned account of funds usable for fulfillment
 * in ONE currency. The stored totalMinor is the INV-6-1 mirror the
 * identity check recomputes against the integer sum of positions ("pool
 * total equals the integer sum of its positions at all times").
 *
 * Source: liquidity-credit-queues.md lines 31-34; INV-6-1 lines 52-54.
 */
export interface LiquidityPoolRecord {
  readonly poolId: string;
  /** The single currency (and its decimal scale) of every position — INV-6-2. */
  readonly currency: string;
  readonly scale: number;
  readonly state: PoolState;
  /** The stored INV-6-1 left-hand side: the integer sum of position totals. */
  readonly totalMinor: number;
  readonly openedAt: ProtocolTime;
  readonly stateChangedAt: ProtocolTime;
}

/**
 * LiquidityPosition — component of a pool attributed to a funding source
 * or operational purpose. The position IS the area-5 ledger resource
 * (resourceId === positionId; declared total === position total — core.md
 * lines 335-336), so its accounting is the ledger's INV-5-1 accounting and
 * its state is the pure fold of the ledger's per-resource entry log
 * (accounting.ts).
 *
 * Source: liquidity-credit-queues.md lines 36-39; INV-6-1 lines 52-54;
 * INV-6-2 lines 55-57; core.md lines 335-336.
 */
export interface LiquidityPositionRecord {
  readonly positionId: string;
  readonly poolId: string;
  /** The FundingEntry that created the position (funds entering the pool). */
  readonly fundingEntryId: string;
  readonly state: PositionState;
  /** The position's total (the ledger resource's declared total). */
  readonly total: Money;
  /** available + reserved + consumed === total, integer-exact (INV-6-1). */
  readonly available: Money;
  readonly reserved: Money;
  readonly consumed: Money;
  readonly fundingSource: FundingSource;
  readonly createdAt: ProtocolTime;
  readonly stateChangedAt: ProtocolTime;
}

/**
 * The FundingEntry's source reference — the internal transfer id (area
 * 12) or the confirmed external rail operation id (area 13).
 *
 * Source: liquidity-credit-queues.md lines 40-43.
 */
export interface FundingSource {
  readonly kind: FundingSourceKind;
  /** The internal transfer id (INTERNAL_TRANSFER) or rail operation id (EXTERNAL_RAIL). */
  readonly referenceId: string;
}

/**
 * FundingEntry — record of funds entering a pool. Created only after
 * reconciliation confirms external funding ("After reconciliation
 * confirms the external funding, the FundingEntry is created exactly
 * once. If reconciliation confirms failure, no entry is created.") or for
 * an internal transfer of settled funds (area 12). The entry id applies
 * exactly once (INV-6-3).
 *
 * Source: liquidity-credit-queues.md lines 40-43, 64-69; INV-6-3 lines
 * 58-60.
 */
export interface FundingEntryRecord {
  readonly fundingEntryId: string;
  readonly poolId: string;
  readonly positionId: string;
  readonly amount: Money;
  readonly source: FundingSource;
  readonly recordedAt: ProtocolTime;
}

/**
 * PendingFundingLink — the durable linkage created when an external
 * funding rail operation reports UNKNOWN: no FundingEntry exists yet, the
 * pool is unchanged, "and the case waits for reconciliation (GC-2)". The
 * terminal resolution drives the entry creation exactly once
 * (RESOLVED_CONFIRMED) or no entry (RESOLVED_FAILED).
 *
 * Source: liquidity-credit-queues.md lines 64-69; rails-adapters-
 * reconciliation.md lines 171-179 (the RESOLVED_CONFIRMED /
 * RESOLVED_FAILED recovery classes); README.md §3 GC-2.
 */
export interface PendingFundingLinkRecord {
  readonly pendingId: string;
  readonly poolId: string;
  /** The UNKNOWN external funding rail operation awaiting reconciliation. */
  readonly railOperationId: string;
  /** The expected amount (the caller's declared intent of the funding). */
  readonly expectedAmount: Money;
  readonly status: 'PENDING' | 'RESOLVED_CONFIRMED' | 'RESOLVED_FAILED';
  readonly openedAt: ProtocolTime;
  readonly resolvedAt?: ProtocolTime;
  /** The FundingEntry created on confirmation (present iff confirmed). */
  readonly fundingEntryId?: string;
}

/**
 * The typed rejection codes of the Liquidity Authority's command surface
 * (domain rejections are typed values, never thrown — the merged rails
 * command convention). Rejections emit NO evidence: a refused command
 * mutates no state, and A06's named evidence set is exhaustive.
 *
 * Source: liquidity-credit-queues.md lines 71-75 (the exhaustive named
 * set); the rails typed-rejection convention.
 */
export const LIQUIDITY_REJECTION_CODES: readonly [
  'POOL_NOT_FOUND',
  'POOL_NOT_OPEN',
  'POOL_FROZEN_NO_NEW_RESERVATIONS',
  'POOL_HAS_UNSETTLED_POSITIONS',
  'POSITION_NOT_FOUND',
  'POSITION_TERMINAL',
  'FUNDING_ENTRY_EXISTS',
  'PENDING_NOT_FOUND',
  'PENDING_ALREADY_RESOLVED',
  'ILLEGAL_TRANSITION',
  'INSUFFICIENT_AVAILABLE',
  'UNIT_MISMATCH',
  'CURRENCY_MISMATCH',
] = Object.freeze([
  'POOL_NOT_FOUND',
  'POOL_NOT_OPEN',
  'POOL_FROZEN_NO_NEW_RESERVATIONS',
  'POOL_HAS_UNSETTLED_POSITIONS',
  'POSITION_NOT_FOUND',
  'POSITION_TERMINAL',
  'FUNDING_ENTRY_EXISTS',
  'PENDING_NOT_FOUND',
  'PENDING_ALREADY_RESOLVED',
  'ILLEGAL_TRANSITION',
  'INSUFFICIENT_AVAILABLE',
  'UNIT_MISMATCH',
  'CURRENCY_MISMATCH',
] as const);

/** A Liquidity Authority rejection code. Source: the frozen list above. */
export type LiquidityRejectionCode = (typeof LIQUIDITY_REJECTION_CODES)[number];

/**
 * Runtime type guard for LiquidityRejectionCode.
 *
 * Source: the typed-rejection convention (the frozen list above).
 */
export function isLiquidityRejectionCode(value: unknown): value is LiquidityRejectionCode {
  return typeof value === 'string' && (LIQUIDITY_REJECTION_CODES as readonly string[]).includes(value);
}

/**
 * The outcome of every Liquidity Authority command: the updated record on
 * success (replayed: true when the command was the idempotent replay of
 * an already-recorded effect — no second effect, no second evidence
 * record), or a typed rejection.
 *
 * Source: INV-6-2 lines 55-57 (ledger-only mutations); INV-6-3 lines
 * 58-60 (the exactly-once funding id); the merged typed-result
 * convention.
 */
export type LiquidityCommandResult<T> =
  | {
      readonly ok: true;
      readonly replayed: boolean;
      readonly record: T;
    }
  | {
      readonly ok: false;
      readonly code: LiquidityRejectionCode;
      readonly problem: string;
    };

/**
 * The outcome of a funding command: the created FundingEntry (and its
 * position), or — for a duplicate funding id — the recorded duplicate
 * observation ("duplicate funding submissions are detected by id and
 * recorded as duplicates without effect", INV-6-3), or a typed rejection.
 * The FundingEntry id is DERIVED from its linked source reference
 * (deriveProtocolId('liquidity-funding-entry', kind, referenceId)), so the
 * exactly-once contract of INV-6-3 is structural: the same rail operation
 * id or internal transfer id always names the same entry.
 *
 * Source: INV-6-3 (liquidity-credit-queues.md lines 58-60); lines 64-69
 * (the confirmation-gated creation rule); lines 40-43 (the source
 * references).
 */
export type FundingCommandResult =
  | {
      readonly ok: true;
      readonly created: true;
      readonly entry: FundingEntryRecord;
      readonly position: LiquidityPositionRecord;
    }
  | {
      readonly ok: true;
      readonly created: false;
      /** The duplicate observation (INV-6-3): detected by id, no effect. */
      readonly duplicateOf: FundingEntryRecord;
    }
  | {
      readonly ok: false;
      readonly code: LiquidityRejectionCode;
      readonly problem: string;
    };

/**
 * The outcome of a pending-funding resolution: RESOLVED_CONFIRMED creates
 * the FundingEntry exactly once (replayed: true when the identical
 * resolution was already applied — the recorded state, INV-6-2's
 * replay discipline); RESOLVED_FAILED closes the linkage with no entry
 * ("If reconciliation confirms failure, no entry is created").
 *
 * Source: liquidity-credit-queues.md lines 66-69; rails-adapters-
 * reconciliation.md lines 171-179; GC-2.
 */
export type ResolvePendingFundingResult =
  | {
      readonly ok: true;
      readonly resolution: 'RESOLVED_CONFIRMED';
      readonly replayed: boolean;
      readonly entry: FundingEntryRecord;
      readonly position: LiquidityPositionRecord;
      readonly link: PendingFundingLinkRecord;
    }
  | {
      readonly ok: true;
      readonly resolution: 'RESOLVED_FAILED';
      readonly replayed: boolean;
      readonly link: PendingFundingLinkRecord;
    }
  | {
      readonly ok: false;
      readonly code: LiquidityRejectionCode;
      readonly problem: string;
    };

/**
 * The resolution classes a pending funding link accepts — exactly the
 * UNKNOWN-operation terminal resolutions of area 14 ("RESOLVED_CONFIRMED
 * / RESOLVED_FAILED: the UNKNOWN operation's true outcome is
 * established"). RESOLVED_ADJUSTED and MATCHED are not funding-entry
 * outcomes (an adjustment creates new linked entries elsewhere, an
 * area-9/10 flow; a cycle match is not an UNKNOWN resolution) — recorded
 * interpretation.
 *
 * Source: rails-adapters-reconciliation.md lines 121-123, 171-179.
 */
export const PENDING_FUNDING_RESOLUTIONS: readonly [
  'RESOLVED_CONFIRMED',
  'RESOLVED_FAILED',
] = Object.freeze(['RESOLVED_CONFIRMED', 'RESOLVED_FAILED'] as const);

/**
 * One pending-funding resolution class. Source: the frozen vocabulary
 * above.
 */
export type PendingFundingResolution = (typeof PENDING_FUNDING_RESOLUTIONS)[number];

/**
 * Runtime type guard for PendingFundingResolution.
 *
 * Source: rails-adapters-reconciliation.md lines 171-179.
 */
export function isPendingFundingResolution(value: unknown): value is PendingFundingResolution {
  return (
    typeof value === 'string' && (PENDING_FUNDING_RESOLUTIONS as readonly string[]).includes(value)
  );
}
