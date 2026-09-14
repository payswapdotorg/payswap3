/**
 * PC-004 — Console module route entrypoint (composed): accounts — providers.
 *
 * Module:  console.accounts.providers
 * Route:   /console/accounts/providers
 *
 * The provider-side projection that EXISTS is the A03 capability registry,
 * so this page composes the PC-003 capabilities read model (clearly labeled
 * and attributed) alongside the honest identity/profile gap: no provider
 * account authority exists at this baseline. The frozen registry explicitly
 * authorizes this module's audience (provider + administrator cross-role
 * visibility, design §6/§13); the dedicated capabilities module
 * (console.capabilities) remains provider-scoped.
 *
 * Guard on direct entry (fail closed): requireConsoleRoute enforces the
 * module's allowed roles server-side (provider, administrator).
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { ensureProductPortsWired } from '@/lib/protocol/server-composition';
import { readConsoleCapabilities } from '@/lib/console/read-models/capabilities';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import { ConsoleProviderAccountView } from '@/components/console/views/accounts-views';

export const metadata = consoleRouteMetadata('/console/accounts/providers');

export default async function ConsoleAccountsProvidersPage() {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  await requireConsoleRoute('/console/accounts/providers');
  // SYS-001 (D-2): resolve the runtime-backed port adapters before the read
  // model resolves the ports (idempotent per module graph).
  await ensureProductPortsWired();
  const capabilities = await readConsoleCapabilities();

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <ConsoleModuleViewHeader
        href="/console/accounts/providers"
        lead="Provider account projection over existing authorities: the capability registry (composed from the capability authority) plus the honest identity/profile gap — never a fabricated account list."
      />
      <ConsoleProviderAccountView capabilities={capabilities} />
    </article>
  );
}
