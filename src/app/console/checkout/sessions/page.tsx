/**
 * PC-004 — Console module route entrypoint (composed): checkout sessions.
 *
 * Module:  console.checkout.sessions
 * Route:   /console/checkout/sessions
 *
 * Composed EXCLUSIVELY from the PC-003 checkout-sessions read models after
 * the SYS-001 server wiring seam: the open-offer list
 * (`readConsoleCheckoutSessions`) plus one per-session status read
 * (`readConsoleCheckoutSessionStatus`) for every listed session — the
 * authority-reported state of each open reference, composed server-side with
 * no HTTP hop.
 *
 * Guard on direct entry (fail closed): requireConsoleRoute enforces the
 * module's allowed roles server-side (merchant only).
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { ensureProductPortsWired } from '@/lib/protocol/server-composition';
import {
  readConsoleCheckoutSessions,
  readConsoleCheckoutSessionStatus,
} from '@/lib/console/read-models/checkout-sessions';
import type { ConsoleReadResult } from '@/lib/console/types';
import type { ConsoleCheckoutSessionStatusDto } from '@/lib/console/read-models/checkout-sessions';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import { ConsoleCheckoutSessionsView } from '@/components/console/views/checkout-sessions-view';

export const metadata = consoleRouteMetadata('/console/checkout/sessions');

export default async function ConsoleCheckoutSessionsPage() {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  await requireConsoleRoute('/console/checkout/sessions');
  // SYS-001 (D-2): resolve the runtime-backed port adapters before the read
  // model resolves the ports (idempotent per module graph).
  await ensureProductPortsWired();

  const result = await readConsoleCheckoutSessions();
  // Compose one status read per listed session (server-side, no self-fetch).
  // A failed sub-read degrades ONLY that session's status to UNKNOWN.
  const statuses = new Map<string, ConsoleReadResult<ConsoleCheckoutSessionStatusDto>>();
  if (result.outcome === 'value') {
    const entries = await Promise.all(
      result.value.sessions.map(async (session) => {
        const status = await readConsoleCheckoutSessionStatus(session.checkoutId);
        return [session.checkoutId, status] as const;
      }),
    );
    for (const [checkoutId, status] of entries) {
      statuses.set(checkoutId, status);
    }
  }

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <ConsoleModuleViewHeader
        href="/console/checkout/sessions"
        lead="Open checkout sessions composed from the checkout port's own reads — an empty list is the authority's legitimate empty answer, and every session's state is the authority-reported status, never a derived one."
      />
      <ConsoleCheckoutSessionsView result={result} statuses={statuses} />
    </article>
  );
}
