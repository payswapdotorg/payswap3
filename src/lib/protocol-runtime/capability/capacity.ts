/**
 * RTN-005 — Capability Authority: pure capacity accounting (INV-3-1).
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/core.md §3 Area 3, lines 176-178:
 *     "INV-3-1 (financial correctness): capacity limits are integer Money
 *      bounds; sum of RESERVED and CONSUMED commitments never exceeds the
 *      capability's declared capacity."
 *   spec/architecture/v0.1/README.md §3 GC-1 lines 39-43:
 *     "All monetary values are signed integers in minor units ... No
 *      floating point. ... Re-running any computation on identical inputs
 *      yields identical outputs."
 *
 * All arithmetic goes through the kernel's Money operators (addMoney /
 * subtractMoney), which enforce same-currency + same-scale operands and
 * safe-integer results — the capacity identity is integer-only by
 * construction (GC-1). Every mutation function returns the NEW accounting
 * or a typed rejection; the identity function is the property-tested
 * invariant (capacityInvariantHolds) the authority asserts after EVERY
 * commitment transition.
 */

import { addMoney, compareMoney, isZeroMoney, money, subtractMoney } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';

/**
 * The capacity accounting triple of one capability: the declared integer
 * Money bound, the sum of RESERVED commitment amounts, and the sum of
 * CONSUMED commitment amounts.
 *
 * Source: INV-3-1 (core.md lines 176-178 — "sum of RESERVED and CONSUMED
 * commitments never exceeds the capability's declared capacity").
 */
export interface CapabilityAccounting {
  readonly declared: Money;
  readonly reserved: Money;
  readonly consumed: Money;
}

/**
 * Mint an accounting triple for a newly registered capability: reserved and
 * consumed start at exactly zero in the declared capacity's unit.
 *
 * Source: INV-3-1 (core.md lines 176-178 — the bound being declared);
 * INV-3-2 (line 179-181 — the accounting updated atomically with commitment
 * state, starting from zero commitments).
 */
export function initialAccounting(declared: Money): CapabilityAccounting {
  return {
    declared,
    reserved: money(declared.currency, 0, declared.scale),
    consumed: money(declared.currency, 0, declared.scale),
  };
}

/**
 * The INV-3-1 invariant as a pure predicate: reserved + consumed <=
 * declared, computed by integer Money summation. Holds for every
 * well-formed accounting the mutation functions return; the property tests
 * assert it after EVERY transition.
 *
 * Source: INV-3-1 (core.md lines 176-178); GC-1 (integer comparison).
 */
export function capacityInvariantHolds(accounting: CapabilityAccounting): boolean {
  const committed = addMoney(accounting.reserved, accounting.consumed);
  return compareMoney(committed, accounting.declared) <= 0;
}

/**
 * Available capacity: declared - reserved - consumed (integer Money). This
 * is the INV-3-1 identity rearranged for feasibility checks — never
 * negative for a well-formed accounting.
 *
 * Source: INV-3-1 (core.md lines 176-178); core.md lines 165-166 (the
 * snapshot view policy evaluation consumes).
 */
export function availableCapacity(accounting: CapabilityAccounting): Money {
  return subtractMoney(subtractMoney(accounting.declared, accounting.reserved), accounting.consumed);
}

/**
 * The reservation step of OFFERED -> RESERVED: reserved += amount, rejected
 * (typed) when the result would exceed the declared bound. This is the
 * single point where capacity is taken; CONSUMED moves capacity from
 * reserved to consumed and never re-checks the bound (it was already
 * inside it while RESERVED).
 *
 * Source: INV-3-1 (core.md lines 176-178 — "never exceeds"); INV-3-2
 * (lines 179-181 — accounting updated atomically with commitment state).
 */
export function applyReservation(
  accounting: CapabilityAccounting,
  amount: Money,
): { readonly ok: true; readonly accounting: CapabilityAccounting } | { readonly ok: false; readonly problem: string } {
  const candidate: CapabilityAccounting = {
    ...accounting,
    reserved: addMoney(accounting.reserved, amount),
  };
  if (!capacityInvariantHolds(candidate)) {
    return {
      ok: false,
      problem: `capacity exceeded: reserving ${amount.amountMinor} ${amount.currency} would make RESERVED + CONSUMED = ${candidate.reserved.amountMinor + candidate.consumed.amountMinor} exceed declared capacity ${candidate.declared.amountMinor} (INV-3-1, core.md lines 176-178)`,
    };
  }
  return { ok: true, accounting: candidate };
}

/**
 * The consumption step of RESERVED -> CONSUMED: capacity moves from
 * reserved to consumed — reserved -= amount, consumed += amount. The
 * committed total is unchanged (it already satisfied INV-3-1 while the
 * amount was RESERVED), so the identity holds after the transition by
 * construction; the returned accounting is still asserted by the caller.
 *
 * Source: core.md lines 162-163 ("RESERVED commitments count against
 * capability capacity; CONSUMED is terminal and exactly once per intent");
 * INV-3-1 lines 176-178.
 */
export function applyConsumption(
  accounting: CapabilityAccounting,
  amount: Money,
): CapabilityAccounting {
  return {
    ...accounting,
    reserved: subtractMoney(accounting.reserved, amount),
    consumed: addMoney(accounting.consumed, amount),
  };
}

/**
 * The release/expiry step of RESERVED -> RELEASED | EXPIRED (and the
 * degradation invalidation of OFFERED, which holds no capacity): reserved
 * -= amount. Consumed is untouched (CONSUMED is terminal).
 *
 * Source: core.md lines 190-191 ("RESERVED commitments remain valid until
 * released by area 5 rules or expired by deadline"); INV-3-1.
 */
export function applyRelease(
  accounting: CapabilityAccounting,
  amount: Money,
): CapabilityAccounting {
  return {
    ...accounting,
    reserved: subtractMoney(accounting.reserved, amount),
  };
}

/**
 * True when nothing is reserved and nothing is consumed (a fresh or fully
 * drained capability). A test/inspection helper over the accounting triple.
 *
 * Source: INV-3-1 (the zero baseline of the identity).
 */
export function isZeroAccounting(accounting: CapabilityAccounting): boolean {
  return isZeroMoney(accounting.reserved) && isZeroMoney(accounting.consumed);
}

/**
 * The capacity arithmetic triple recorded in every COMMITMENT_* evidence
 * record's proof slot: [reservedMinor, consumedMinor, declaredMinor] — the
 * exact integers of the INV-3-1 identity after the transition ("each with
 * capacity arithmetic in the proof field", core.md lines 198-200).
 *
 * Source: core.md lines 198-200; INV-3-1 lines 176-178.
 */
export function capacityArithmeticProof(accounting: CapabilityAccounting): readonly number[] {
  return [
    accounting.reserved.amountMinor,
    accounting.consumed.amountMinor,
    accounting.declared.amountMinor,
  ];
}
