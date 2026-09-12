/**
 * RTN-007 — Credit Authority: pure INV-7-1 exposure arithmetic and the
 * evidence identity hashes.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §2 Area 7:
 *   lines 119-121 (INV-7-1, verbatim):
 *     "INV-7-1 (financial correctness): exposure never exceeds the line
 *      limit; the check and the reservation are atomic under area 5
 *      serialization. Exposure arithmetic is integer Money."
 *   lines 101-104 (CreditExposure, verbatim):
 *     "CreditExposure — current outstanding amount (Money, integer) on a
 *      credit line, mutated only through area 5 reservations tied to
 *      obligations from clearing (area 9)."
 *   lines 138-140 (evidence produced):
 *     "EXPOSURE_CHANGED (post-transition integer arithmetic proof)."
 *   spec/architecture/v0.1/core.md §5 Area 5 lines 304-306 (INV-5-1 — the
 *     resource identity the line's ledger resource carries: available =
 *     declared total minus held minus consumed; with declared total =
 *     limit, available >= 0 is EXACTLY exposure <= limit).
 *   spec/architecture/v0.1/README.md §3 GC-1 (integer-only arithmetic).
 *
 * Design (recorded in CONTRACT-REVIEW.md): the credit line IS the ledger
 * resource (resourceId = `credit-line:<lineId>`, declared total = limit).
 * Exposure = held + consumed (the total capacity currently extended —
 * reserved or settled into obligations — and not yet repaid); INV-7-1
 * (exposure <= limit) is exactly INV-5-1's available >= 0, which the
 * ledger enforces atomically under per-resource (per-line)
 * serialization. Every function here is a pure function of its inputs
 * (GC-1 determinism).
 */

import { createHash } from 'node:crypto';
import { money, subtractMoney } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';
import type { ResourceAccounting } from '../reservations/resource.ts';
import type { CreditExposureView } from './types.ts';

/**
 * Format version of the exposure arithmetic-identity hash (INV-7-1's
 * verifiable encoding). Bump on any change to the canonical encoding.
 *
 * Source: INV-7-1 (liquidity-credit-queues.md lines 119-121 — the
 * identity the hash encodes); the RTN-006 resource-identity-hash
 * precedent.
 */
export const EXPOSURE_ARITHMETIC_IDENTITY_HASH_FORMAT_VERSION = 1;

/**
 * Derive the credit line's exposure view from its ledger resource
 * accounting (the INV-5-1 triple with declared total = limit): exposure =
 * held + consumed; remaining = limit - exposure; INV-7-1 is the
 * non-negativity of remaining.
 *
 * Source: liquidity-credit-queues.md lines 101-104; INV-7-1 lines
 * 119-121; core.md lines 304-306.
 */
export function exposureFromAccounting(lineId: string, limit: Money, accounting: ResourceAccounting): CreditExposureView {
  if (
    accounting.declaredTotal.currency !== limit.currency ||
    accounting.declaredTotal.scale !== limit.scale ||
    accounting.declaredTotal.amountMinor !== limit.amountMinor
  ) {
    throw new TypeError(
      'credit exposure: the ledger resource accounting does not carry the line limit as its declared total',
    );
  }
  const exposure = money(
    limit.currency,
    accounting.heldTotal.amountMinor + accounting.consumedTotal.amountMinor,
    limit.scale,
  );
  if (!Number.isSafeInteger(exposure.amountMinor)) {
    throw new TypeError('credit exposure: the exposure leaves the safe-integer range (GC-1)');
  }
  return {
    lineId,
    limit,
    reserved: accounting.heldTotal,
    consumed: accounting.consumedTotal,
    exposure,
    remaining: subtractMoney(limit, exposure),
  };
}

/**
 * The zero exposure view of a freshly activated line (before any
 * reservation).
 *
 * Source: INV-7-1 lines 119-121 (the identity's zero point).
 */
export function zeroExposure(lineId: string, limit: Money): CreditExposureView {
  const zero = money(limit.currency, 0, limit.scale);
  return {
    lineId,
    limit,
    reserved: zero,
    consumed: zero,
    exposure: zero,
    remaining: limit,
  };
}

/**
 * The INV-7-1 invariant as a pure predicate: exposure never exceeds the
 * line limit, every component non-negative, integer arithmetic
 * throughout. The property tests assert it after EVERY transition.
 *
 * Source: INV-7-1 (liquidity-credit-queues.md lines 119-121).
 */
export function exposureInvariantHolds(view: CreditExposureView): boolean {
  if (
    view.limit.currency !== view.exposure.currency ||
    view.limit.currency !== view.reserved.currency ||
    view.limit.currency !== view.consumed.currency ||
    view.limit.currency !== view.remaining.currency ||
    view.limit.scale !== view.exposure.scale ||
    view.limit.scale !== view.reserved.scale ||
    view.limit.scale !== view.consumed.scale ||
    view.limit.scale !== view.remaining.scale
  ) {
    return false;
  }
  if (
    !Number.isInteger(view.limit.amountMinor) ||
    !Number.isInteger(view.exposure.amountMinor) ||
    !Number.isInteger(view.reserved.amountMinor) ||
    !Number.isInteger(view.consumed.amountMinor) ||
    !Number.isInteger(view.remaining.amountMinor)
  ) {
    return false;
  }
  if (
    view.reserved.amountMinor < 0 ||
    view.consumed.amountMinor < 0 ||
    view.remaining.amountMinor < 0
  ) {
    return false;
  }
  if (view.exposure.amountMinor !== view.reserved.amountMinor + view.consumed.amountMinor) {
    return false;
  }
  if (view.remaining.amountMinor !== view.limit.amountMinor - view.exposure.amountMinor) {
    return false;
  }
  // INV-7-1: exposure never exceeds the limit.
  return view.exposure.amountMinor <= view.limit.amountMinor;
}

/**
 * Canonical encoding of a line's INV-7-1 arithmetic identity — the
 * verifiable proof material of every EXPOSURE_CHANGED record
 * ("EXPOSURE_CHANGED (post-transition integer arithmetic proof)").
 *
 * Source: liquidity-credit-queues.md line 140; INV-7-1 lines 119-121.
 */
export function canonicalExposureAccounting(view: CreditExposureView): string {
  return (
    `v${EXPOSURE_ARITHMETIC_IDENTITY_HASH_FORMAT_VERSION}|` +
    `line:${view.lineId}|cur:${view.limit.currency}|scale:${view.limit.scale}|` +
    `limit:${view.limit.amountMinor}|reserved:${view.reserved.amountMinor}|` +
    `consumed:${view.consumed.amountMinor}|exposure:${view.exposure.amountMinor}|` +
    `remaining:${view.remaining.amountMinor}`
  );
}

/**
 * The sha256 arithmetic-identity hash of one exposure view — the
 * post-transition integer arithmetic proof of INV-7-1.
 *
 * Source: liquidity-credit-queues.md line 140; INV-7-1 lines 119-121.
 */
export function exposureArithmeticIdentityHash(view: CreditExposureView): string {
  return createHash('sha256').update(canonicalExposureAccounting(view), 'utf8').digest('hex');
}

/**
 * Canonical encoding of one credit decision — the verifiable proof
 * material of every CREDIT_DECIDED record ("CREDIT_DECIDED (decision id,
 * key, outcome, reason code)" — the approved amount is verifiable through
 * the encoding, "an approval names an exact integer amount").
 *
 * Source: liquidity-credit-queues.md line 139, lines 109-111; A15 lines
 * 31-32.
 */
export function canonicalCreditDecision(input: {
  readonly decisionId: string;
  readonly intentId: string;
  readonly lineId: string;
  readonly outcome: { readonly kind: 'APPROVED' | 'DENIED' };
  readonly approvedAmount?: Money;
  readonly reason?: string;
}): string {
  const outcome =
    input.outcome.kind === 'APPROVED'
      ? `APPROVED|amount:${input.approvedAmount?.currency}|${input.approvedAmount?.scale}|${input.approvedAmount?.amountMinor}`
      : `DENIED|reason:${input.reason ?? ''}`;
  return (
    `decision:${input.decisionId}|intent:${input.intentId}|line:${input.lineId}|${outcome}`
  );
}

/**
 * The sha256 identity hash of one credit decision — the CREDIT_DECIDED
 * record's proof material.
 *
 * Source: liquidity-credit-queues.md line 139; A15 lines 31-32.
 */
export function creditDecisionIdentityHash(input: {
  readonly decisionId: string;
  readonly intentId: string;
  readonly lineId: string;
  readonly outcome: { readonly kind: 'APPROVED' | 'DENIED' };
  readonly approvedAmount?: Money;
  readonly reason?: string;
}): string {
  return createHash('sha256').update(canonicalCreditDecision(input), 'utf8').digest('hex');
}
