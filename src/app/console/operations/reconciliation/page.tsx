/**
 * PC-004 — Console module route entrypoint (composed): operations —
 * reconciliation.
 *
 * Module:  console.operations.reconciliation
 * Route:   /console/operations/reconciliation
 *
 * Composed EXCLUSIVELY from the PC-003 operations-health read model
 * (`readConsoleOperationsHealth`). This page highlights the reconciliation
 * domain and renders the full frozen taxonomy, plus the honest gap panel for
 * reconciliation records (no listing read exists at this baseline).
 * Read-mostly (design §12): the observability taxonomy is preserved and
 * telemetry is never translated into a business verdict.
 *
 * Guard on direct entry (fail closed): requireConsoleRoute enforces the
 * module's allowed roles server-side (operator only).
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { readConsoleOperationsHealth } from '@/lib/console/read-models/operations-health';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import { ConsoleOperationsDomainView } from '@/components/console/views/operations-health-view';

export const metadata = consoleRouteMetadata('/console/operations/reconciliation');

export default async function ConsoleOperationsReconciliationPage() {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  await requireConsoleRoute('/console/operations/reconciliation');
  const result = await readConsoleOperationsHealth();

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <ConsoleModuleViewHeader
        href="/console/operations/reconciliation"
        lead="Reconciliation state visibility from the existing health authority — the frozen taxonomy verbatim, the reconciliation domain highlighted, and an honest gap where no record listing read exists."
      />
      <ConsoleOperationsDomainView result={result} href="/console/operations/reconciliation" />
    </article>
  );
}
