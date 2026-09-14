/**
 * PC-005 — Console module route entrypoint (composed): developers — logs.
 *
 * Module:  console.developers.logs
 * Route:   /console/developers/logs
 *
 * Composed EXCLUSIVELY from the PC-005 request-log read model: the bounded
 * in-memory diagnostic ring, redacted BEFORE storage (the recorded PC-003
 * developer-request gap closes here as an honest empty VALUE — "no entries
 * recorded yet" — through the PC-003 exported normalizer seam).
 *
 * Guard on direct entry (fail closed): requireConsoleRoute enforces the
 * module's allowed roles server-side (merchant only).
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import { ConsoleDeveloperRequestLogsView } from '@/components/console/developers/request-logs-view';
import { readConsoleDeveloperRequestLogs } from '@/lib/console/developers/read-models';

export const metadata = consoleRouteMetadata('/console/developers/logs');

export default async function ConsoleDevelopersLogsPage() {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  await requireConsoleRoute('/console/developers/logs');
  const result = readConsoleDeveloperRequestLogs();

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <ConsoleModuleViewHeader
        href="/console/developers/logs"
        lead="Integration logs from the console API boundary — diagnostic records with credentials, authorization headers, and secret-bearing fields redacted before storage; never protocol evidence."
      />
      <ConsoleDeveloperRequestLogsView result={result} />
    </article>
  );
}
