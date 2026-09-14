/**
 * PC-004 — Console module route entrypoint (composed): accounts — merchants.
 *
 * Module:  console.accounts.merchants
 * Route:   /console/accounts/merchants
 *
 * The PC-004 inventory found NO merchant account authority at this baseline
 * (the merchant-scoped surfaces that exist — the checkout port — expose
 * offers and decisions, not accounts), so this page renders the honest
 * recorded-gap projection — never a fabricated account list (design §13).
 *
 * Guard on direct entry (fail closed): requireConsoleRoute enforces the
 * module's allowed roles server-side (merchant, administrator).
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import { ConsoleAccountGapView } from '@/components/console/views/accounts-views';

export const metadata = consoleRouteMetadata('/console/accounts/merchants');

export default async function ConsoleAccountsMerchantsPage() {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  await requireConsoleRoute('/console/accounts/merchants');

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <ConsoleModuleViewHeader
        href="/console/accounts/merchants"
        lead="Merchant account projection over existing authorities — rendered honestly: no account authority exists at this baseline, so this is a recorded gap, not a list."
      />
      <ConsoleAccountGapView
        audience="merchants"
        extraInventory={[
          'The merchant-scoped checkout reads (the checkout sessions module) — offer/status/decision reads for the merchant audience, not account data.',
        ]}
      />
    </article>
  );
}
