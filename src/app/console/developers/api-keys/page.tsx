/**
 * PC-002 — Console module route entrypoint (gated placeholder).
 *
 * Module:  console.developers.api-keys
 * Route:   /console/developers/api-keys
 * Registry status: planned — the composed feature view ships with the
 * owning later work item; until then this route renders the honest
 * planned-state placeholder (registry-derived label + status, no invented
 * data).
 *
 * Guard on direct entry (fail closed): requireConsoleRoute resolves this
 * page's own route through the frozen registry and enforces the module's
 * allowed roles server-side — unauthenticated or role-denied viewers are
 * redirected away before any content renders. Deep links never bypass the
 * role gate (P8).
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { ConsolePlannedModule } from '@/components/console/shell/console-planned-module';

export const metadata = consoleRouteMetadata('/console/developers/api-keys');

export default async function ConsoleDevelopersApiKeysPage() {
  await requireConsoleRoute('/console/developers/api-keys');
  return <ConsolePlannedModule href="/console/developers/api-keys" />;
}
