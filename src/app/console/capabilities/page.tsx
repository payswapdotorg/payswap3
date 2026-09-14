/**
 * PC-004 — Console module route entrypoint (composed): capabilities.
 *
 * Module:  console.capabilities
 * Route:   /console/capabilities
 *
 * Composed EXCLUSIVELY from the PC-003 capabilities read model
 * (`readConsoleCapabilities`) after the SYS-001 server wiring seam. The
 * two-axis truth (capability state + source availability) renders verbatim;
 * per-item availability-UNKNOWN is preserved (design §13) — availability is
 * never inferred from configuration, routes, or registry entries.
 *
 * Guard on direct entry (fail closed): requireConsoleRoute enforces the
 * module's allowed roles server-side (provider only).
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { ensureProductPortsWired } from '@/lib/protocol/server-composition';
import { readConsoleCapabilities } from '@/lib/console/read-models/capabilities';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import { ConsoleCapabilitiesView } from '@/components/console/views/capabilities-view';

export const metadata = consoleRouteMetadata('/console/capabilities');

export default async function ConsoleCapabilitiesPage() {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  await requireConsoleRoute('/console/capabilities');
  // SYS-001 (D-2): resolve the runtime-backed port adapters before the read
  // model resolves the ports (idempotent per module graph).
  await ensureProductPortsWired();
  const result = await readConsoleCapabilities();

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <ConsoleModuleViewHeader
        href="/console/capabilities"
        lead="Capability state exactly as the capability authority reports it — two axes kept verbatim, per-item UNKNOWN preserved, availability never inferred from configuration."
      />
      <ConsoleCapabilitiesView result={result} />
    </article>
  );
}
