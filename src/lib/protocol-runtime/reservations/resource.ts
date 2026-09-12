/**
 * RTN-006 — Reservation Authority: pure resource accounting (INV-5-1).
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/core.md §5 Area 5, lines 304-306:
 *     "INV-5-1 (financial correctness): for every resource, available =
 *      declared total minus held minus consumed, computed in integer
 *      Money; the identity holds after every transition."
 *   spec/architecture/v0.1/README.md §3 GC-1 lines 39-43:
 *     "All monetary values are signed integers in minor units ... No
 *      floating point. ... Re-running any computation on identical inputs
 *      yields identical outputs."
 *
 * All arithmetic goes through the kernel's Money operators (addMoney /
 * subtractMoney / compareMoney), which enforce same-currency + same-scale
 * operands and safe-integer results — the identity is integer-only by
 * construction (GC-1). Every mutation function returns the NEW accounting
 * or a typed rejection; the identity function is the property-tested
 * invariant (resourceInvariantHolds) the ledger asserts after EVERY
 * transition.
 */

import { createHash } from 'node:crypto';
import { addMoney, compareMoney, money, moneyEquals, subtractMoney } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';
import type { ReservationState } from './types.ts';

/**
 * The resource accounting triple of INV-5-1: the resource owner's declared
 * total, the sum of HELD reservation amounts, and the sum of CONSUMED
 * reservation amounts.
 *
 * Source: INV-5-1 (core.md lines 304-306); core.md lines 335-336 ("Depends
 * on areas 6, 7, and 3 as resource owners" — the declared total's
 * provenance).
 */
export interface ResourceAccounting {
  readonly resourceId: string;
  readonly declaredTotal: Money;
  readonly heldTotal: Money;
  readonly consumedTotal: Money;
}

/**
 * Mint an accounting triple for a newly declared resource: held and
 * consumed start at exactly zero in the declared total's unit.
 *
 * Source: INV-5-1 (core.md lines 304-306 — the identity's zero point).
 */
export function initialResourceAccounting(resourceId: string, declaredTotal: Money): ResourceAccounting {
  return {
    resourceId,
    declaredTotal,
    heldTotal: money(declaredTotal.currency, 0, declaredTotal.scale),
    consumedTotal: money(declaredTotal.currency, 0, declaredTotal.scale),
  };
}

/**
 * Available: declaredTotal - heldTotal - consumedTotal (integer Money) —
 * the INV-5-1 identity's left-hand side, rearranged. Never negative for a
 * well-formed accounting.
 *
 * Source: INV-5-1 (core.md lines 304-306).
 */
export function availableResource(accounting: ResourceAccounting): Money {
  return subtractMoney(subtractMoney(accounting.declaredTotal, accounting.heldTotal), accounting.consumedTotal);
}

/**
 * The INV-5-1 invariant as a pure predicate: the identity recomputes
 * exactly (available equals declared minus held minus consumed) AND the
 * components stay non-negative (an over-commit would drive available below
 * zero — the identity "holds after every transition" excludes that). The
 * property tests assert it after EVERY transition of randomized sequences.
 *
 * Source: INV-5-1 (core.md lines 304-306); GC-1 (integer comparison).
 */
export function resourceInvariantHolds(accounting: ResourceAccounting): boolean {
  const available = availableResource(accounting);
  if (available.amountMinor < 0) {
    return false;
  }
  if (accounting.heldTotal.amountMinor < 0 || accounting.consumedTotal.amountMinor < 0) {
    return false;
  }
  // The identity itself: available === declared - held - consumed by
  // construction of availableResource(); recompute the right-hand side and
  // compare as an independent check (integer equality).
  const recomputed = subtractMoney(
    subtractMoney(accounting.declaredTotal, accounting.heldTotal),
    accounting.consumedTotal,
  );
  return moneyEquals(available, recomputed);
}

/**
 * The REQUESTED -> HELD step: heldTotal += amount, rejected (typed) when
 * the resource's available balance cannot cover the amount — INV-5-1's
 * over-commit protection, evaluated BEFORE the hold exists (the decision
 * the REQUESTED ledger entry records).
 *
 * Source: INV-5-1 (core.md lines 304-306); INV-5-2 lines 307-309 ("a
 * REQUESTED transition either becomes HELD or is rejected").
 */
export function applyHold(
  accounting: ResourceAccounting,
  amount: Money,
): { readonly ok: true; readonly accounting: ResourceAccounting } | { readonly ok: false; readonly problem: string } {
  const candidate: ResourceAccounting = {
    ...accounting,
    heldTotal: addMoney(accounting.heldTotal, amount),
  };
  if (!resourceInvariantHolds(candidate)) {
    return {
      ok: false,
      problem:
        `insufficient available on resource ${accounting.resourceId}: holding ` +
        `${amount.amountMinor} ${amount.currency} would drive available below zero ` +
        `(declared ${accounting.declaredTotal.amountMinor}, held ${candidate.heldTotal.amountMinor}, ` +
        `consumed ${accounting.consumedTotal.amountMinor} — INV-5-1, core.md lines 304-306)`,
    };
  }
  return { ok: true, accounting: candidate };
}

/**
 * Apply one ledger transition's arithmetic to a resource accounting —
 * pure, keyed by the reservation's state BEFORE the transition:
 *   - REQUESTED -> HELD: heldTotal += amount (the hold begins);
 *   - HELD -> CONSUMED: heldTotal -= amount, consumedTotal += amount (the
 *     hold converts — "CONSUMED is terminal and exactly once");
 *   - HELD -> RELEASED and HELD -> EXPIRED: heldTotal -= amount (the hold
 *     returns to available — "every hold is either consumed or released —
 *     never silently lost", core.md lines 280-282);
 *   - REQUESTED -> RELEASED: NO arithmetic (the rejected request never
 *     held anything — INV-5-2's unambiguous rejection).
 *
 * Source: INV-5-1 (core.md lines 304-306 — "the identity holds after every
 * transition"); core.md lines 280-282, 288-289.
 */
export function applyTransitionArithmetic(
  accounting: ResourceAccounting,
  from: ReservationState,
  to: ReservationState,
  amount: Money,
): ResourceAccounting {
  if (from === 'REQUESTED' && to === 'HELD') {
    return { ...accounting, heldTotal: addMoney(accounting.heldTotal, amount) };
  }
  if (from === 'HELD' && to === 'CONSUMED') {
    return {
      ...accounting,
      heldTotal: subtractMoney(accounting.heldTotal, amount),
      consumedTotal: addMoney(accounting.consumedTotal, amount),
    };
  }
  if (from === 'HELD' && (to === 'RELEASED' || to === 'EXPIRED')) {
    return { ...accounting, heldTotal: subtractMoney(accounting.heldTotal, amount) };
  }
  if (from === 'REQUESTED' && to === 'RELEASED') {
    return accounting; // the rejected request held nothing
  }
  throw new TypeError(
    `resource accounting: no arithmetic rule for transition ${from} -> ${to} ` +
    '(core.md A05 lines 288-289 — the one-way machine)',
  );
}

/**
 * True iff an amount is coverable by a resource's available balance
 * (integer comparison, same currency and scale assumed — the ledger guards
 * the unit beforehand).
 *
 * Source: INV-5-1 (core.md lines 304-306); INV-5-2 lines 307-309.
 */
export function coversAmount(accounting: ResourceAccounting, amount: Money): boolean {
  return compareMoney(availableResource(accounting), amount) >= 0;
}

/**
 * Version of the arithmetic-identity hash input format. Bumped on any
 * change to the canonical encoding; hashed values carry the version prefix
 * (`rai.v1.<hex>`).
 *
 * Source: core.md lines 326-328 — "proof: ledger sequence number and
 * arithmetic identity after transition" (the identity's verifiable
 * encoding).
 */
export const RESOURCE_ARITHMETIC_IDENTITY_HASH_FORMAT_VERSION = 1;

/**
 * The canonical encoding of one post-transition resource accounting — the
 * arithmetic-identity hash input: the resource id, the unit, and the three
 * integer components plus the available value the identity fixes. PURE.
 *
 * Source: INV-5-1 (core.md lines 304-306); core.md lines 326-328.
 */
export function canonicalResourceAccounting(accounting: ResourceAccounting): string {
  const available = availableResource(accounting);
  return [
    'resource-accounting',
    `v${RESOURCE_ARITHMETIC_IDENTITY_HASH_FORMAT_VERSION}`,
    accounting.resourceId,
    accounting.declaredTotal.currency,
    accounting.declaredTotal.scale,
    accounting.declaredTotal.amountMinor,
    accounting.heldTotal.amountMinor,
    accounting.consumedTotal.amountMinor,
    available.amountMinor,
  ].join('|');
}

/**
 * The arithmetic-identity hash: sha256 over the canonical post-transition
 * accounting, prefixed `rai.v1.<hex>`. Deterministic; feeds the
 * RESERVATION_* records' proof slots ("arithmetic identity after
 * transition").
 *
 * Source: core.md lines 326-328; INV-5-1 lines 304-306; GC-1.
 */
export function resourceArithmeticIdentityHash(accounting: ResourceAccounting): string {
  const hex = createHash('sha256')
    .update(canonicalResourceAccounting(accounting), 'utf8')
    .digest('hex');
  return `rai.v${RESOURCE_ARITHMETIC_IDENTITY_HASH_FORMAT_VERSION}.${hex}`;
}
