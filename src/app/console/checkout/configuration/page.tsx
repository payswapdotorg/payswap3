/**
 * PC-004 — Console module route entrypoint (composed): checkout
 * configuration.
 *
 * Module:  console.checkout.configuration
 * Route:   /console/checkout/configuration
 *
 * The repository exposes NO checkout-configuration read at this baseline, so
 * this page renders the honest gap view. The ONLY authoritative facts it can
 * state come from the PC-003 checkout-sessions read model's boundary fields
 * (runtime + authority owner — quoted verbatim; session items are never
 * rendered here, they belong to the sessions module). No settings are
 * invented (design §13: configuration truth is never inferred from what
 * merely exists).
 *
 * Guard on direct entry (fail closed): requireConsoleRoute enforces the
 * module's allowed roles server-side (merchant only).
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { ensureProductPortsWired } from '@/lib/protocol/server-composition';
import { readConsoleCheckoutSessions } from '@/lib/console/read-models/checkout-sessions';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import { ConsoleCheckoutConfigurationView } from '@/components/console/views/checkout-configuration-view';

export const metadata = consoleRouteMetadata('/console/checkout/configuration');

export default async function ConsoleCheckoutConfigurationPage() {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  await requireConsoleRoute('/console/checkout/configuration');
  // SYS-001 (D-2): resolve the runtime-backed port adapters before the read
  // model resolves the ports (idempotent per module graph).
  await ensureProductPortsWired();

  // Composed ONLY for the boundary facts the read model carries (runtime,
  // authority owner). Session items are never rendered on this page.
  const boundary = await readConsoleCheckoutSessions();

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <ConsoleModuleViewHeader
        href="/console/checkout/configuration"
        lead="Checkout configuration from its owning authority — rendered honestly: if the repository exposes no configuration read, this page shows the recorded gap and never invents a setting."
      />
      <ConsoleCheckoutConfigurationView boundary={boundary} />
    </article>
  );
}
