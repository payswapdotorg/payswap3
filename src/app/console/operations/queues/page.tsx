/**
 * PC-004 — Console module route entrypoint (composed): operations — queues.
 *
 * Module:  console.operations.queues
 * Route:   /console/operations/queues
 *
 * Composed EXCLUSIVELY from the PC-003 operations-health read model
 * (`readConsoleOperationsHealth`) — the fail-closed nine-domain probe. This
 * page highlights the queue domain and renders the full frozen taxonomy,
 * plus the honest gap panel for the queue-specific telemetry (queue-depth /
 * worker listings) that has no exposed read at this baseline. Read-mostly
 * (design §12): no operational action exists on this page.
 *
 * Guard on direct entry (fail closed): requireConsoleRoute enforces the
 * module's allowed roles server-side (operator only).
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { readConsoleOperationsHealth } from '@/lib/console/read-models/operations-health';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import { ConsoleOperationsDomainView } from '@/components/console/views/operations-health-view';

export const metadata = consoleRouteMetadata('/console/operations/queues');

export default async function ConsoleOperationsQueuesPage() {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  await requireConsoleRoute('/console/operations/queues');
  const result = await readConsoleOperationsHealth();

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <ConsoleModuleViewHeader
        href="/console/operations/queues"
        lead="Queue/worker operational visibility from the existing health authority — the frozen taxonomy verbatim, the queue domain highlighted, and an honest gap where no queue listing read exists."
      />
      <ConsoleOperationsDomainView result={result} href="/console/operations/queues" />
    </article>
  );
}
