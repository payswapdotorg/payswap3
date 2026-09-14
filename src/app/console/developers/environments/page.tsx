/**
 * PC-005 — Console module route entrypoint (composed): developers —
 * environments.
 *
 * Module:  console.developers.environments
 * Route:   /console/developers/environments
 *
 * A READ-ONLY presentation of the PC-001 server-derived environment
 * context (derivation chain, startup configuration validation result, the
 * sandbox/production distinction). NO environment switching exists: the
 * context function takes no input, and this page renders no selector —
 * spoofed environment values in this page's own searchParams are
 * structurally ignored (proven by tests).
 *
 * Guard on direct entry (fail closed): requireConsoleRoute enforces the
 * module's allowed roles server-side (merchant only).
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import { ConsoleDeveloperEnvironmentsView } from '@/components/console/developers/environments-view';
import { readConsoleDeveloperEnvironments } from '@/lib/console/developers/read-models';

export const metadata = consoleRouteMetadata('/console/developers/environments');

export default async function ConsoleDevelopersEnvironmentsPage() {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  await requireConsoleRoute('/console/developers/environments');
  // The read takes NO input by design: the environment is derived from the
  // server-side configuration authority (PAYSWAP_ENV chain), never from
  // this page's URL, forms, or any client state.
  const result = readConsoleDeveloperEnvironments();

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <ConsoleModuleViewHeader
        href="/console/developers/environments"
        lead="The server-derived environment for developer credentials — sandbox vs production, the one derivation chain, and the startup configuration validation result. Read-only: there is no environment switching anywhere in the console."
      />
      <ConsoleDeveloperEnvironmentsView result={result} />
    </article>
  );
}
