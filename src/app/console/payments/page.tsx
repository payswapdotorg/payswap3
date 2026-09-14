/**
 * PC-004 — Console module route entrypoint (composed): payment list.
 *
 * Module:  console.payments.all
 * Route:   /console/payments
 *
 * Composed EXCLUSIVELY from the PC-003 payments read model
 * (`readConsolePayments`) after the SYS-001 server wiring seam — the same
 * seam the product routes and the console API boundary use. The read model
 * is the composition point: this page adds guard + presentation only.
 *
 * Guard on direct entry (fail closed): requireConsoleRoute resolves this
 * page's own route through the frozen registry and enforces the module's
 * allowed roles server-side (customer, merchant, operator) — unauthenticated
 * or role-denied viewers are redirected away before any content renders.
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { ensureProductPortsWired } from '@/lib/protocol/server-composition';
import { readConsolePayments } from '@/lib/console/read-models/payments';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import { ConsolePaymentListView } from '@/components/console/views/payment-list-view';

export const metadata = consoleRouteMetadata('/console/payments');

export default async function ConsolePaymentsPage() {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  const principal = await requireConsoleRoute('/console/payments');
  // SYS-001 (D-2): resolve the runtime-backed port adapters before the read
  // model resolves the ports (idempotent per module graph).
  await ensureProductPortsWired();
  const result = await readConsolePayments(principal.role);

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <ConsoleModuleViewHeader
        href="/console/payments"
        lead="Payment/activity list composed from the intent authority's own listing read — per-item states use the frozen display mapping, and an unavailable read renders UNKNOWN (never an empty list standing in for an answer, never a business verdict)."
      />
      <ConsolePaymentListView result={result} />
    </article>
  );
}
