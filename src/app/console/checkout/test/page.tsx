/**
 * PC-004 — Console module route entrypoint (composed): checkout test.
 *
 * Module:  console.checkout.test
 * Route:   /console/checkout/test
 *
 * Design §10 surface: test checkout actions use the EXISTING protocol/
 * runtime paths with the server-derived environment signal. This page
 * composes the PC-001 server-derived environment context and links to the
 * existing product execution surfaces (customer pay flow, merchant checkout
 * surface) plus the documented protocol command HTTP boundary — it builds NO
 * console-local simulator and executes nothing itself. See the view's module
 * header for the full decision record.
 *
 * Guard on direct entry (fail closed): requireConsoleRoute enforces the
 * module's allowed roles server-side (customer, merchant).
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { getConsoleEnvironmentContext } from '@/lib/console/environment-context';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import { ConsoleCheckoutTestView } from '@/components/console/views/checkout-test-view';

export const metadata = consoleRouteMetadata('/console/checkout/test');

export default async function ConsoleCheckoutTestPage() {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  await requireConsoleRoute('/console/checkout/test');
  // Server-derived environment context (no arguments — no client input path).
  const environment = getConsoleEnvironmentContext();

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <ConsoleModuleViewHeader
        href="/console/checkout/test"
        lead="Test checkout through the existing protocol paths only — the server-derived environment signal, the sanctioned execution surfaces, and no console-local simulator."
      />
      <ConsoleCheckoutTestView environment={environment} />
    </article>
  );
}
