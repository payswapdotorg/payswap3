/**
 * PC-004 — Console module route entrypoint (composed): accounts — operators.
 *
 * Module:  console.accounts.operators
 * Route:   /console/accounts/operators
 *
 * The PC-004 inventory found NO operator account authority at this baseline
 * (the operator-scoped surfaces that exist — the operations modules — expose
 * telemetry, not accounts), so this page renders the honest recorded-gap
 * projection — never a fabricated account list (design §13).
 *
 * Guard on direct entry (fail closed): requireConsoleRoute enforces the
 * module's allowed roles server-side (administrator only).
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import { ConsoleAccountGapView } from '@/components/console/views/accounts-views';

export const metadata = consoleRouteMetadata('/console/accounts/operators');

export default async function ConsoleAccountsOperatorsPage() {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  await requireConsoleRoute('/console/accounts/operators');

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <ConsoleModuleViewHeader
        href="/console/accounts/operators"
        lead="Operator account projection over existing authorities — rendered honestly: no account authority exists at this baseline, so this is a recorded gap, not a list."
      />
      <ConsoleAccountGapView
        audience="operators"
        extraInventory={[
          'The operator-scoped operations modules (over the health authority) — telemetry reads, not account data.',
        ]}
      />
    </article>
  );
}
