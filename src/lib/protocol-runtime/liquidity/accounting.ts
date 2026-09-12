/**
 * RTN-007 — Liquidity Authority: pure INV-6-1 accounting and the position
 * fold — the deterministic projection of an area-5 ledger resource log
 * onto one LiquidityPosition.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §1 Area 6:
 *   lines 52-54 (INV-6-1, verbatim):
 *     "INV-6-1 (financial correctness): pool total equals the integer sum
 *      of its positions at all times; per position,
 *      available + reserved + consumed arithmetic is exact and integer."
 *   lines 55-57 (INV-6-2, verbatim):
 *     "INV-6-2 (concurrency): position transitions occur only via the
 *      area 5 serialized ledger; pools are single-currency, so no
 *      cross-currency arithmetic occurs here."
 *   lines 36-39 (the position machine, "driven exclusively by area 5
 *     reservations").
 *   spec/architecture/v0.1/core.md §5 Area 5 lines 304-306 (INV-5-1 — the
 *     resource identity the position's ledger resource carries: available
 *     = declared total minus held minus consumed) and lines 335-336
 *     ("Depends on areas 6, 7, and 3 as resource owners").
 *   spec/architecture/v0.1/README.md §3 GC-1 (integer-only arithmetic).
 *
 * Design (recorded in CONTRACT-REVIEW.md): the position IS the ledger
 * resource — resourceId === positionId, declared total === position
 * total. The position's accounting triple is therefore EXACTLY the
 * resource's INV-5-1 accounting (available = declared - held - consumed),
 * and the position's state machine is a PURE LEFT FOLD of the resource's
 * entry log:
 *   - AVAILABLE -> RESERVED on the first HELD entry;
 *   - RESERVED stays RESERVED while any hold is live (held > 0);
 *   - when held drains to zero the position is terminal:
 *     CONSUMED iff consumed == total (exhausted), RETURNED otherwise
 *     (the residual — total - consumed — stays attributed to the returned
 *     position and counted in the pool total);
 *   - a REQUESTED(REJECT) resolution to RELEASED never held anything and
 *     has NO machine effect (the ledger's own rejection resolution);
 *   - a HELD entry against a terminal position is a corrupt log — the
 *     composition contract ("all resource mutations pass through [the
 *     ledger]" via the owning authority, core.md lines 293-295 + 335-336)
 *     is that reservation requests against liquidity-owned resources are
 *     mediated by THIS authority, which never requests against a terminal
 *     position; the fold fails loudly exactly like the ledger's own
 *     corrupt-log adoption.
 *
 * Every function here is a pure function of its inputs (GC-1
 * determinism): identical logs fold to identical positions.
 */

import { createHash } from 'node:crypto';
import { money, subtractMoney } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';
import type { ReservationLedgerEntry } from '../reservations/types.ts';
import type { PositionState } from './types.ts';

/**
 * Format version of the position arithmetic-identity hash (INV-6-1's
 * verifiable encoding). Bump on any change to the canonical encoding.
 *
 * Source: INV-6-1 (liquidity-credit-queues.md lines 52-54 — the identity
 * the hash encodes); the RTN-006 resource-identity-hash precedent.
 */
export const POSITION_ARITHMETIC_IDENTITY_HASH_FORMAT_VERSION = 1;

/**
 * The folded state of one position's ledger resource log: the INV-6-1
 * accounting triple plus the machine state the fold derived.
 *
 * Source: INV-6-1 lines 52-54; INV-6-2 lines 55-57 (the fold's inputs are
 * ledger entries only).
 */
export interface PositionFold {
  readonly state: PositionState;
  readonly total: Money;
  readonly available: Money;
  readonly reserved: Money;
  readonly consumed: Money;
}

/**
 * The per-position ledger entry accounting: the fold plus the set of
 * reservations that were ever HELD (the discriminator that separates a
 * live hold's RELEASED/EXPIRED — a real return — from a REQUESTED(REJECT)
 * resolution that never held anything).
 *
 * Source: core.md lines 288-295 (the reservation machine whose entries
 * the fold consumes).
 */
export interface PositionLedgerProjection {
  readonly fold: PositionFold;
  /** Reservation ids that reached HELD at least once. */
  readonly heldReservationIds: ReadonlySet<string>;
  /** The highest resource sequence consumed by the fold. */
  readonly lastResourceSequence: number;
}

/**
 * The zero fold of a freshly funded position: every unit available, the
 * AVAILABLE state.
 *
 * Source: INV-6-1 lines 52-54 (the identity's zero point); lines 38-39
 * (the machine's start state).
 */
export function initialPositionFold(total: Money): PositionFold {
  return {
    state: 'AVAILABLE',
    total,
    available: total,
    reserved: money(total.currency, 0, total.scale),
    consumed: money(total.currency, 0, total.scale),
  };
}

/**
 * True iff the per-position INV-6-1 identity holds exactly:
 * available + reserved + consumed === total in integer arithmetic, every
 * component non-negative, same currency and scale throughout, and the
 * machine state consistent with the accounting (terminal CONSUMED iff
 * exhausted; terminal RETURNED iff a cycle ended with residual; RESERVED
 * iff a hold is live; AVAILABLE only with no live hold).
 *
 * Source: INV-6-1 (liquidity-credit-queues.md lines 52-54); INV-6-2 lines
 * 55-57 (single-currency).
 */
export function positionInvariantHolds(fold: PositionFold): boolean {
  if (
    fold.total.currency !== fold.available.currency ||
    fold.total.currency !== fold.reserved.currency ||
    fold.total.currency !== fold.consumed.currency ||
    fold.total.scale !== fold.available.scale ||
    fold.total.scale !== fold.reserved.scale ||
    fold.total.scale !== fold.consumed.scale
  ) {
    return false;
  }
  if (
    !Number.isInteger(fold.available.amountMinor) ||
    !Number.isInteger(fold.reserved.amountMinor) ||
    !Number.isInteger(fold.consumed.amountMinor) ||
    !Number.isInteger(fold.total.amountMinor)
  ) {
    return false;
  }
  if (
    fold.available.amountMinor < 0 ||
    fold.reserved.amountMinor < 0 ||
    fold.consumed.amountMinor < 0
  ) {
    return false;
  }
  if (
    fold.available.amountMinor + fold.reserved.amountMinor + fold.consumed.amountMinor !==
    fold.total.amountMinor
  ) {
    return false;
  }
  if (fold.state === 'CONSUMED') {
    return fold.consumed.amountMinor === fold.total.amountMinor && fold.reserved.amountMinor === 0;
  }
  if (fold.state === 'RETURNED') {
    return fold.reserved.amountMinor === 0 && fold.consumed.amountMinor < fold.total.amountMinor;
  }
  if (fold.state === 'RESERVED') {
    return fold.reserved.amountMinor > 0;
  }
  // AVAILABLE: no live hold, nothing consumed (the fold never leaves
  // AVAILABLE with consumed > 0 — the cycle ends RETURNED or CONSUMED).
  return fold.reserved.amountMinor === 0 && fold.consumed.amountMinor === 0;
}

/**
 * Fold the FULL per-resource entry log of one position into its
 * projection — the deterministic projection the authority recomputes
 * after every ledger command ("position transitions occur only via the
 * area 5 serialized ledger", INV-6-2). A pure function: identical logs
 * yield identical projections.
 *
 * Throws TypeError on a corrupt sequence (a hold against a terminal
 * position, a consumption with no live hold, a second declaration) — the
 * ledger's own corrupt-log convention.
 *
 * Source: INV-6-2 (liquidity-credit-queues.md lines 55-57); INV-6-1 lines
 * 52-54 (the identity asserted after every applied entry); core.md lines
 * 288-295 (the entry vocabulary and the serialized per-resource log).
 */
export function foldPositionFromEntries(
  entries: readonly ReservationLedgerEntry[],
): PositionLedgerProjection {
  if (entries.length === 0) {
    throw new TypeError('position fold: the entry log is empty (the position is undeclared)');
  }
  const declared = entries[0] as ReservationLedgerEntry;
  if (declared.entryKind !== 'RESOURCE_DECLARED' || declared.amount === undefined) {
    throw new TypeError(
      'position fold: the log must start with the RESOURCE_DECLARED entry carrying the position total',
    );
  }
  const total = declared.amount;
  let fold = initialPositionFold(total);
  const heldReservationIds = new Set<string>();
  // The REQUESTED entries are the pre-commit facts carrying each
  // reservation's amount (the ledger's transition entries do not repeat
  // it — core.md lines 293-295, the serialized log's row vocabulary).
  const amountByReservation = new Map<string, Money>();
  let lastResourceSequence = declared.resourceSequence;
  for (let index = 1; index < entries.length; index += 1) {
    const entry = entries[index] as ReservationLedgerEntry;
    if (entry.resourceId !== declared.resourceId) {
      throw new TypeError('position fold: entries of other resources are not part of this fold');
    }
    if (entry.resourceSequence <= lastResourceSequence) {
      throw new TypeError('position fold: the resource sequence must strictly increase');
    }
    lastResourceSequence = entry.resourceSequence;
    switch (entry.entryKind) {
      case 'RESOURCE_DECLARED': {
        throw new TypeError('position fold: a second RESOURCE_DECLARED entry is corrupt');
      }
      case 'REQUESTED': {
        const reservationId = requireReservationId(entry, 'REQUESTED');
        if (entry.amount !== undefined) {
          amountByReservation.set(reservationId, entry.amount);
        }
        continue; // the pre-commit fact; its resolution entries apply
      }
      case 'HELD': {
        const reservationId = requireReservationId(entry, 'HELD');
        heldReservationIds.add(reservationId);
        fold = applyHold(fold, requireReservationAmount(amountByReservation, reservationId, 'HELD'));
        break;
      }
      case 'CONSUMED': {
        fold = applyConsumed(
          fold,
          requireReservationAmount(
            amountByReservation,
            requireReservationId(entry, 'CONSUMED'),
            'CONSUMED',
          ),
        );
        break;
      }
      case 'RELEASED':
      case 'EXPIRED': {
        const reservationId = requireReservationId(entry, entry.entryKind);
        if (heldReservationIds.has(reservationId)) {
          fold = applyReturned(
            fold,
            requireReservationAmount(amountByReservation, reservationId, entry.entryKind),
          );
        }
        // else: the REQUESTED(REJECT) resolution — never held, no effect.
        break;
      }
      default: {
        throw new TypeError(`position fold: unhandled entry kind ${String(entry.entryKind)}`);
      }
    }
    if (!positionInvariantHolds(fold)) {
      throw new TypeError(
        `position fold: INV-6-1 violated after the ${String(entry.entryKind)} entry at resource ` +
          `sequence ${entry.resourceSequence} (liquidity-credit-queues.md lines 52-54)`,
      );
    }
  }
  return { fold, heldReservationIds, lastResourceSequence };
}

function requireReservationId(entry: ReservationLedgerEntry, kind: string): string {
  if (typeof entry.reservationId !== 'string' || entry.reservationId.length === 0) {
    throw new TypeError(`position fold: a ${kind} entry must carry its reservation id`);
  }
  return entry.reservationId;
}

function requireReservationAmount(
  amountByReservation: ReadonlyMap<string, Money>,
  reservationId: string,
  kind: string,
): Money {
  const amount = amountByReservation.get(reservationId);
  if (amount === undefined) {
    throw new TypeError(
      `position fold: a ${kind} entry has no REQUESTED entry carrying its amount (corrupt log)`,
    );
  }
  return amount;
}

function sameUnit(a: Money, b: Money): void {
  if (a.currency !== b.currency || a.scale !== b.scale) {
    throw new TypeError(
      `position fold: cross-currency arithmetic inside pools is forbidden (INV-6-2; got ` +
        `${a.currency}/${a.scale} vs ${b.currency}/${b.scale})`,
    );
  }
}

function addUnit(a: Money, b: Money): Money {
  sameUnit(a, b);
  const sum = a.amountMinor + b.amountMinor;
  if (!Number.isSafeInteger(sum)) {
    throw new TypeError('position fold: the arithmetic leaves the safe-integer range (GC-1)');
  }
  return money(a.currency, sum, a.scale);
}

function applyHold(fold: PositionFold, amount: Money): PositionFold {
  if (fold.state === 'CONSUMED' || fold.state === 'RETURNED') {
    throw new TypeError(
      `position fold: a HELD entry is illegal against a terminal ${fold.state} position ` +
        '(reservations against liquidity positions are mediated by the Liquidity Authority — ' +
        'core.md lines 293-295, 335-336)',
    );
  }
  const next: PositionFold = {
    ...fold,
    state: 'RESERVED',
    reserved: addUnit(fold.reserved, amount),
    available: subtractMoney(fold.available, amount),
  };
  if (!positionInvariantHolds(next)) {
    throw new TypeError(
      'position fold: INV-6-1 violated at a HELD transition (a hold the position cannot cover)',
    );
  }
  return next;
}

function applyConsumed(fold: PositionFold, amount: Money): PositionFold {
  if (fold.state !== 'RESERVED') {
    throw new TypeError(
      `position fold: a CONSUMED entry is illegal against a ${fold.state} position (corrupt log)`,
    );
  }
  if (fold.reserved.amountMinor < amount.amountMinor) {
    throw new TypeError(
      "position fold: a CONSUMED entry exceeds the position's live holds (corrupt log)",
    );
  }
  const consumed = addUnit(fold.consumed, amount);
  const reserved = subtractMoney(fold.reserved, amount);
  const state: PositionState =
    reserved.amountMinor === 0
      ? consumed.amountMinor === fold.total.amountMinor
        ? 'CONSUMED'
        : 'RETURNED'
      : 'RESERVED';
  return { ...fold, state, consumed, reserved };
}

function applyReturned(fold: PositionFold, amount: Money): PositionFold {
  if (fold.state !== 'RESERVED') {
    throw new TypeError(
      `position fold: a RELEASED/EXPIRED entry of a live hold is illegal against a ` +
        `${fold.state} position (corrupt log)`,
    );
  }
  if (fold.reserved.amountMinor < amount.amountMinor) {
    throw new TypeError(
      "position fold: a return entry exceeds the position's live holds (corrupt log)",
    );
  }
  const reserved = subtractMoney(fold.reserved, amount);
  const available = addUnit(fold.available, amount);
  const state: PositionState = reserved.amountMinor === 0 ? 'RETURNED' : 'RESERVED';
  return { ...fold, state, reserved, available };
}

/**
 * The pool-side INV-6-1 check: the stored pool total equals the integer
 * sum of its position totals, and every position carries the pool's
 * single currency and scale ("pools are single-currency, so no
 * cross-currency arithmetic occurs here" — INV-6-2).
 *
 * Source: INV-6-1 (liquidity-credit-queues.md lines 52-54); INV-6-2 lines
 * 55-57.
 */
export function poolInvariantHolds(input: {
  readonly poolCurrency: string;
  readonly poolScale: number;
  readonly storedTotalMinor: number;
  readonly positionTotals: readonly Money[];
}): boolean {
  let sum = 0;
  for (const total of input.positionTotals) {
    if (total.currency !== input.poolCurrency || total.scale !== input.poolScale) {
      return false; // single-currency pools (INV-6-2)
    }
    if (!Number.isInteger(total.amountMinor) || !Number.isSafeInteger(sum + total.amountMinor)) {
      return false;
    }
    sum += total.amountMinor;
  }
  return sum === input.storedTotalMinor;
}

/**
 * The integer sum of position totals (the recomputed INV-6-1 right-hand
 * side). Throws on cross-currency or cross-scale members (the work
 * order's stop condition) or unsafe-integer sums (GC-1).
 *
 * Source: INV-6-1 (liquidity-credit-queues.md lines 52-54); INV-6-2 lines
 * 55-57.
 */
export function sumPositionTotals(
  poolCurrency: string,
  poolScale: number,
  positionTotals: readonly Money[],
): number {
  let sum = 0;
  for (const total of positionTotals) {
    if (total.currency !== poolCurrency || total.scale !== poolScale) {
      throw new TypeError(
        `liquidity: cross-currency arithmetic inside pools is forbidden (INV-6-2; expected ` +
          `${poolCurrency}/${poolScale}, got ${total.currency}/${total.scale})`,
      );
    }
    if (!Number.isSafeInteger(sum + total.amountMinor)) {
      throw new TypeError('liquidity: the pool total leaves the safe-integer range (GC-1)');
    }
    sum += total.amountMinor;
  }
  return sum;
}

/**
 * Canonical encoding of a position's INV-6-1 arithmetic identity — the
 * verifiable proof material of every POSITION_STATE_CHANGED record
 * ("POSITION_STATE_CHANGED (with post-transition arithmetic proof)").
 *
 * Source: liquidity-credit-queues.md lines 73-74; A15 lines 31-32.
 */
export function canonicalPositionAccounting(fold: PositionFold): string {
  return (
    `v${POSITION_ARITHMETIC_IDENTITY_HASH_FORMAT_VERSION}|` +
    `state:${fold.state}|cur:${fold.total.currency}|scale:${fold.total.scale}|` +
    `total:${fold.total.amountMinor}|available:${fold.available.amountMinor}|` +
    `reserved:${fold.reserved.amountMinor}|consumed:${fold.consumed.amountMinor}`
  );
}

/**
 * The sha256 arithmetic-identity hash of one position fold — the
 * post-transition arithmetic proof of INV-6-1 carried in every
 * POSITION_STATE_CHANGED record's proof slot.
 *
 * Source: liquidity-credit-queues.md lines 73-74 ("post-transition
 * arithmetic proof"); INV-6-1 lines 52-54.
 */
export function positionArithmeticIdentityHash(fold: PositionFold): string {
  return createHash('sha256').update(canonicalPositionAccounting(fold), 'utf8').digest('hex');
}
