/**
 * PC-004 — Console module route entrypoint (composed): accounts — customers.
 *
 * Module:  console.accounts.customers
 * Route:   /console/accounts/customers
 *
 * The PC-004 inventory found NO customer account authority at this baseline
 * (identity is a verification-harness audience signal, not an account
 * registry), so this page renders the honest recorded-gap projection —
 * never a fabricated account list (design §13: projections over EXISTING
 * authorities only).
 *
 * Guard on direct entry (fail closed): requireConsoleRoute enforces the
 * module's allowed roles server-side (administrator only).
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import { ConsoleAccountGapView } from '@/components/console/views/accounts-views';

export const metadata = consoleRouteMetadata('/console/accounts/customers');

export default async function ConsoleAccountsCustomersPage() {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  await requireConsoleRoute('/console/accounts/customers');

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <ConsoleModuleViewHeader
        href="/console/accounts/customers"
        lead="Customer account projection over existing authorities — rendered honestly: no account authority exists at this baseline, so this is a recorded gap, not a list."
      />
      <ConsoleAccountGapView audience="customers" />
    </article>
  );
}
