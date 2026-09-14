/**
 * PC-004 — Checkout configuration view (module console.checkout.configuration).
 *
 * The repository exposes NO checkout-configuration read at this baseline:
 * there is no configuration authority, no settings store behind the checkout
 * port, and the checkout authority surface itself (area-20 Merchant Authority
 * runtime) is a later-wave change honestly pinned ARRIVING at the port
 * boundary. This view therefore renders an HONEST GAP: the recorded gap, the
 * authoritative boundary facts the PC-003 checkout-sessions read model DOES
 * carry (runtime, authority owner — quoted verbatim, without rendering any
 * session items, which belong to the sessions module), and no invented
 * settings of any kind (design §13: availability/configuration truth is never
 * inferred from what merely exists).
 *
 * The recorded gap is a fact of the repository baseline, NOT a read-dependent
 * verdict: it renders in BOTH envelope branches (the accounts-views precedent
 * — the gap stands on its own), so an unavailable boundary read renders the
 * honest UNKNOWN panel AND the gap, never the UNKNOWN panel alone.
 */

import type { ReactNode } from 'react';
import type { ConsoleReadResult } from '@/lib/console/types';
import type { ConsoleCheckoutSessionsDto } from '@/lib/console/read-models/checkout-sessions';
import { ConsoleReadResultView } from './console-read-result';
import { ConsoleGapPanel } from './console-view-chrome';

const CONFIGURATION_GAP_NOTE =
  'No checkout configuration authority or settings read exists in the repository at this baseline: the checkout port exposes offer/status/decision reads only, and the checkout authority surface the port reports (the area-20 Merchant Authority runtime) is a later-wave change pinned ARRIVING at the boundary. Nothing on this page invents a setting, a default, or a configuration value — a missing configuration read is rendered as the gap it is.';

const CONFIGURATION_INVENTORY: readonly string[] = [
  'The checkout port boundary (the PC-003 read model behind it): offer presentation, open-offer listing, per-reference status, and decision submission — no configuration members.',
  'The port’s own pinned runtime facts (ARRIVING) and authority-owner string — honest boundary facts, not settings.',
  'The environment signal (server-derived PAYSWAP_ENV → sandbox/production), which governs test-vs-production execution everywhere — see the checkout test view.',
];

export interface ConsoleCheckoutConfigurationViewProps {
  /**
   * The checkout-sessions read-model envelope (PC-003), composed ONLY for its
   * boundary facts (runtime + authority owner). Session items are never
   * rendered here — they belong to the sessions module.
   */
  readonly boundary: ConsoleReadResult<ConsoleCheckoutSessionsDto>;
}

/** The honest checkout-configuration gap view. */
export function ConsoleCheckoutConfigurationView({ boundary }: ConsoleCheckoutConfigurationViewProps): ReactNode {
  return (
    <section data-console-view="checkout-configuration" aria-labelledby="console-checkout-configuration-heading" className="min-w-0">
      <h2 id="console-checkout-configuration-heading" className="text-lg font-semibold">
        Checkout configuration
      </h2>
      {/*
        * The recorded gap is a static repository fact — it renders in BOTH read
        * branches and never disappears when the boundary read transport-fails
        * (the accounts-views "the gap stands on its own" precedent).
        */}
      <ConsoleGapPanel
        subject="checkout configuration"
        gapNote={CONFIGURATION_GAP_NOTE}
        inventory={CONFIGURATION_INVENTORY}
        authority={{
          owningAuthority: boundary.authority.owningAuthority,
          runtimeBoundary: boundary.authority.runtimeBoundary,
          durableSource: boundary.authority.durableSource,
          evidenceReference: `${boundary.authority.evidenceReference} · recorded gap: no checkout-configuration read exists at this baseline (PC-004 evidence)`,
        }}
      />
      <div className="mt-6">
        <ConsoleReadResultView
          result={boundary}
          subject="checkout configuration"
          renderValue={(value: ConsoleCheckoutSessionsDto) => (
            <div className="max-w-3xl rounded-xl border border-stone-300 bg-white p-4">
              <h3 className="text-sm font-semibold text-stone-800">
                The one authoritative fact this module can state today
              </h3>
              <p className="mt-2 text-sm text-stone-700">
                The checkout boundary pins its own runtime status{' '}
                <code className="rounded bg-stone-100 px-1 py-0.5 text-xs" data-testid="console-checkout-configuration-runtime">
                  {value.runtime}
                </code>{' '}
                with authority owner {value.authorityOwner} — quoted verbatim from the
                checkout read model. That is the whole of the authoritative configuration
                knowledge this baseline exposes; every other configuration question has no
                owning read and renders as the gap above.
              </p>
            </div>
          )}
        />
      </div>
    </section>
  );
}
