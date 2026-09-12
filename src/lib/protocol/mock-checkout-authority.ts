/**
 * ════════════════════════════════════════════════════════════════════════
 *  MOCK CHECKOUT AUTHORITY — RETIRED (UI-011) · verification-support shim
 * ════════════════════════════════════════════════════════════════════════
 *
 * UI-011 retired the mock checkout authority: the checkout port
 * (src/lib/protocol/checkout-port.ts) is now backed by the RUNTIME
 * ADAPTER over the composed A01 Intent Authority (src/lib/protocol/
 * runtime-checkout-adapter.ts — reads re-anchored; decisions fail closed
 * where the runtime exposes no command surface). This module is no longer
 * a port backing and implements NO authority semantics.
 *
 * WHY THIS FILE STILL EXISTS (recorded deviation, stated honestly): the
 * read-only verification surfaces frozen by UI-003
 * (src/app/verification/checkout-flow/page.tsx imports
 * MOCK_CHECKOUT_SCENARIOS; src/components/verification/
 * checkout-flow-harness.tsx imports the MockScenarioDescriptor type)
 * import this module BY PATH, and the work order forbids changing product
 * surfaces. The retained export is the verification scenario CATALOG —
 * display-only descriptors of the state-matrix presentations — re-worded
 * honestly for the runtime-backed world: the live flow reads the composed
 * runtime, and the merchant-decision surface is a recorded wave-2 gap.
 */

import type { CheckoutId, MerchantCheckoutState } from './checkout-port';

export interface MockScenarioDescriptor {
  readonly checkoutId: CheckoutId;
  readonly label: string;
  readonly description: string;
  readonly authorityState?: MerchantCheckoutState;
  readonly adapterError?: 'checkout-not-found' | 'authority-unreachable';
}

/**
 * The verification scenario catalog — the presentation matrix the harness
 * walks. Each descriptor names a checkout-state presentation and states
 * honestly how the runtime-backed port produces (or refuses to produce)
 * it.
 */
export const MOCK_CHECKOUT_SCENARIOS: readonly MockScenarioDescriptor[] = [
  {
    checkoutId: 'cko_live_offer_001',
    label: 'Open offer — read from the composed runtime',
    description:
      'The live flow: the runtime checkout adapter reads a recorded intent (DRAFT) from the A01 Intent Authority and presents its real terms. Only figures the authority actually reports appear (no fee-quote surface).',
    authorityState: 'offered',
  },
  {
    checkoutId: 'cko_live_accept_001',
    label: 'Accept — refused with the recorded gap',
    description:
      'The merchant-decision command surface: the composed runtime exposes none (the area-20 Merchant Authority is RTN wave 2), so accept is refused (decision-not-allowed) with the recorded reason — nothing committed, nothing fabricated.',
    authorityState: 'accept-submitted',
  },
  {
    checkoutId: 'cko_live_decline_001',
    label: 'Decline — refused with the recorded gap',
    description:
      'The decline decision is refused exactly like accept: no runtime command surface (area-20 wave 2); the refusal is an explicit state with the recorded gap, never a silent drop.',
    authorityState: 'decline-submitted',
  },
  {
    checkoutId: 'cko_payment_pending_001',
    label: 'Awaiting payment — unknown with reconciliation',
    description:
      'An intent that progressed beyond DRAFT: the runtime reports the intent\u2019s own progression, and the checkout presents unknown with its reconciliation path (the merchant-decision record does not exist in the composed runtime).',
    authorityState: 'unknown',
  },
  {
    checkoutId: 'cko_auth_refusal_001',
    label: 'Failed — the intent\u2019s recorded terminal failure',
    description:
      'An intent the authority moved to FAILED: the checkout presents the failed state with the authority\u2019s recorded reason (the state page carries the reason code).',
    authorityState: 'failed',
  },
  {
    checkoutId: 'cko_missing_001',
    label: 'No record — checkout-not-found',
    description:
      'A reference the Intent Authority holds no record for: the adapter reports checkout-not-found with the honest note — UNKNOWN for the reference, never a fabricated offer.',
    adapterError: 'checkout-not-found',
  },
] as const;
