/**
 * PC-004 — Console module route entrypoint (composed): operations — UNKNOWN
 * cases.
 *
 * Module:  console.operations.unknown
 * Route:   /console/operations/unknown
 *
 * Composed EXCLUSIVELY from the PC-003 operations-health read model
 * (`readConsoleOperationsHealth`). This page highlights the unknown domain
 * and renders the full frozen taxonomy, plus the honest gap panel: no
 * UNKNOWN-case listing read exists at this baseline — per-reference UNKNOWN
 * context and recovery actions live on payment detail (the waiting sub-read
 * the payments read model carries). Read-mostly (design §12).
 *
 * Guard on direct entry (fail closed): requireConsoleRoute enforces the
 * module's allowed roles server-side (operator only).
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { readConsoleOperationsHealth } from '@/lib/console/read-models/operations-health';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import { ConsoleOperationsDomainView } from '@/components/console/views/operations-health-view';

export const metadata = consoleRouteMetadata('/console/operations/unknown');

export default async function ConsoleOperationsUnknownPage() {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  await requireConsoleRoute('/console/operations/unknown');
  const result = await readConsoleOperationsHealth();

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <ConsoleModuleViewHeader
        href="/console/operations/unknown"
        lead="UNKNOWN-case visibility and recovery context from the existing health authority — the frozen taxonomy verbatim, the unknown domain highlighted, and per-reference UNKNOWN context on payment detail."
      />
      <ConsoleOperationsDomainView result={result} href="/console/operations/unknown" />
    </article>
  );
}
