/**
 * PC-004 — Console module route entrypoint (composed): operations —
 * execution.
 *
 * Module:  console.operations.execution
 * Route:   /console/operations/execution
 *
 * Composed EXCLUSIVELY from the PC-003 operations-health read model
 * (`readConsoleOperationsHealth`). This page highlights the execution domain
 * and renders the full frozen taxonomy, plus the honest gap panel for the
 * execution-specific telemetry (durable-job listings) that has no exposed
 * read at this baseline. Read-mostly (design §12).
 *
 * Guard on direct entry (fail closed): requireConsoleRoute enforces the
 * module's allowed roles server-side (operator only).
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { readConsoleOperationsHealth } from '@/lib/console/read-models/operations-health';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import { ConsoleOperationsDomainView } from '@/components/console/views/operations-health-view';

export const metadata = consoleRouteMetadata('/console/operations/execution');

export default async function ConsoleOperationsExecutionPage() {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  await requireConsoleRoute('/console/operations/execution');
  const result = await readConsoleOperationsHealth();

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <ConsoleModuleViewHeader
        href="/console/operations/execution"
        lead="Durable execution visibility from the existing health authority — the frozen taxonomy verbatim, the execution domain highlighted, and an honest gap where no job listing read exists."
      />
      <ConsoleOperationsDomainView result={result} href="/console/operations/execution" />
    </article>
  );
}
