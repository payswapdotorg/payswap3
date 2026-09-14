/**
 * PC-004 — Console module route entrypoint (composed): operations —
 * clearing & netting.
 *
 * Module:  console.operations.clearing-netting
 * Route:   /console/operations/clearing-netting
 *
 * Composed EXCLUSIVELY from the PC-003 operations-health read model
 * (`readConsoleOperationsHealth`). This page highlights the
 * clearing-netting domain and renders the full frozen taxonomy, plus the
 * honest gap panel for clearing/netting progression records (no listing read
 * exists at this baseline). Read-mostly (design §12).
 *
 * Guard on direct entry (fail closed): requireConsoleRoute enforces the
 * module's allowed roles server-side (operator only).
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { readConsoleOperationsHealth } from '@/lib/console/read-models/operations-health';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import { ConsoleOperationsDomainView } from '@/components/console/views/operations-health-view';

export const metadata = consoleRouteMetadata('/console/operations/clearing-netting');

export default async function ConsoleOperationsClearingNettingPage() {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  await requireConsoleRoute('/console/operations/clearing-netting');
  const result = await readConsoleOperationsHealth();

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <ConsoleModuleViewHeader
        href="/console/operations/clearing-netting"
        lead="Clearing/netting progression visibility from the existing health authority — the frozen taxonomy verbatim, the clearing-netting domain highlighted, and an honest gap where no progression read exists."
      />
      <ConsoleOperationsDomainView result={result} href="/console/operations/clearing-netting" />
    </article>
  );
}
