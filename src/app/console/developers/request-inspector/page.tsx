/**
 * PC-005 — Console module route entrypoint (composed): developers —
 * request inspector.
 *
 * Module:  console.developers.request-inspector
 * Route:   /console/developers/request-inspector
 *
 * A query view over the SAME diagnostic ring the logs surface reads:
 * server-side filtering by path/status (through this page's own
 * searchParams — presentation filtering only), per-entry detail with the
 * full redaction guarantees, and NO export by design.
 *
 * Guard on direct entry (fail closed): requireConsoleRoute enforces the
 * module's allowed roles server-side (merchant only). The filter values
 * never participate in authorization or environment.
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import { ConsoleDeveloperRequestInspectorView } from '@/components/console/developers/request-inspector-view';
import { readConsoleDeveloperRequestInspector } from '@/lib/console/developers/read-models';

export const metadata = consoleRouteMetadata('/console/developers/request-inspector');

type PageSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ConsoleDevelopersRequestInspectorPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  await requireConsoleRoute('/console/developers/request-inspector');
  const params = await searchParams;

  // Presentation filtering only: parsed defensively, clamped to honest
  // shapes (bounded path string / integer status), and echoed verbatim in
  // the read result. No request value affects role or environment.
  const rawPath = firstValue(params.path);
  const rawStatus = firstValue(params.status);
  const filterPath = rawPath !== undefined && rawPath.trim().length > 0 ? rawPath.slice(0, 512) : undefined;
  const parsedStatus =
    rawStatus !== undefined && /^\d{3}$/.test(rawStatus) ? Number.parseInt(rawStatus, 10) : undefined;

  const result = readConsoleDeveloperRequestInspector({
    ...(filterPath === undefined ? {} : { path: filterPath }),
    ...(parsedStatus === undefined ? {} : { status: parsedStatus }),
  });

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <ConsoleModuleViewHeader
        href="/console/developers/request-inspector"
        lead="Per-entry request inspection over the diagnostic ring — credentials, authorization headers, and secret-bearing configuration are redacted before storage, so this surface has no unredacted data to leak. No export exists by design."
      />
      <ConsoleDeveloperRequestInspectorView result={result} />
    </article>
  );
}
