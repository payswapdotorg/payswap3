/**
 * PC-002 — Console Overview (the frozen registry root module, `available`).
 *
 * The honest foundation surface (PC-001 content carried forward): the frozen
 * route/module registry summary and the server-derived environment context,
 * plus the role-scoped module map — the modules the signed-in role may
 * actually reach, with their registry status. No composed feature views ship
 * in PC-002: every non-root module below is `planned` and renders the honest
 * planned-state placeholder (registry-derived label + status, no invented
 * data) until PC-004/PC-005 flip it.
 *
 * Deep-link role check on direct entry (P8): the page re-checks its own
 * module even though the layout already guarded the group.
 */

import {
  consoleRegistryByGroup,
  consoleRegistrySummary,
} from '@/lib/console/registry';
import { getConsoleEnvironmentContext } from '@/lib/console/environment-context';
import { ConsoleAuthorityLine } from '@/components/console';
import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { consoleNavigationForRole } from '@/components/console/shell/console-navigation';
import { ConsoleNavList } from '@/components/console/shell/console-nav';

export const metadata = consoleRouteMetadata('/console');

export default async function ConsoleOverviewPage() {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  const principal = await requireConsoleRoute('/console');

  const environment = getConsoleEnvironmentContext();
  const navigation = consoleNavigationForRole(principal.role);
  const grouped = consoleRegistryByGroup();
  const summary = consoleRegistrySummary();
  const reachableCount = navigation.reduce((count, group) => count + group.items.length, 0);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-teal-700">
          Console module · Overview
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          PaySwap developer console
        </h1>
        <p className="mt-4 max-w-3xl text-base text-stone-600">
          One console shell over the frozen information architecture: the navigation and
          every module route derive from the single route/module registry, and the
          navigation renders only the modules your signed-in role may access
          (server-side, default-deny). Modules whose feature view has not shipped yet
          render an honest planned-state placeholder — never a simulated view.
        </p>
      </header>

      <section aria-labelledby="console-principal" className="mt-0">
        <h2 id="console-principal" className="text-xl font-semibold">
          Principal &amp; environment
        </h2>
        <div className="mt-3 max-w-3xl rounded-xl border border-stone-300 bg-white p-4">
          <p className="text-sm">
            <span className="font-semibold">Signed-in role: </span>
            <span data-testid="console-principal-role">{principal.role}</span>
            <span className="text-stone-500"> (resolved server-side from the shell audience authority)</span>
          </p>
          <p className="mt-1 text-sm">
            <span className="font-semibold">Environment: </span>
            <span data-testid="console-environment-kind" className="font-semibold">
              {environment.kind}
            </span>
            <span className="text-stone-500">
              {' '}
              ({environment.configuredValue} · derived by {environment.derivedBy} configuration only)
            </span>
          </p>
          <p className="mt-1 text-xs text-stone-500">
            Startup configuration validation: {environment.startupConfiguration.ok ? 'ok' : 'not ok'}{' '}
            for {environment.startupConfiguration.env} · source: {environment.source} ·
            client input cannot select production/test.
          </p>
        </div>
      </section>

      <section aria-labelledby="console-your-modules">
        <h2 id="console-your-modules" className="text-xl font-semibold">
          Your console modules
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          {reachableCount} of {summary.totalRoutes} registry routes are reachable for the{' '}
          <span className="font-medium">{principal.role}</span> role ({' '}
          {summary.availableRoutes} available · {summary.plannedRoutes} planned across the
          whole registry). Planned entries link to their honest placeholder pages; the
          payment-detail route is deep-linkable but has no navigation entry because its
          segment is per-payment.
        </p>
        <div className="mt-4 max-w-3xl rounded-xl border border-stone-300 bg-white p-3">
          <ConsoleNavList groups={navigation} label="Console modules available to your role" />
        </div>
      </section>

      <section aria-labelledby="console-registry">
        <h2 id="console-registry" className="text-xl font-semibold">
          Frozen route/module registry
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          {summary.totalRoutes} routes across {summary.groups.length} top-level groups —{' '}
          {summary.availableRoutes} available (this Overview root) and{' '}
          {summary.plannedRoutes} planned. Roles shown per entry are the design §6
          role model enforced server-side (default-deny).
        </p>
        <div className="mt-4 space-y-6">
          {Object.entries(grouped).map(([group, entries]) => (
            <div key={group}>
              <h3 className="text-sm font-semibold uppercase tracking-widest text-stone-500">
                {group}
              </h3>
              <ul className="mt-2 divide-y divide-stone-200 rounded-xl border border-stone-300 bg-white">
                {entries.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
                    <code className="break-words rounded bg-stone-100 px-1 py-0.5 text-xs">{entry.href}</code>
                    <span className="text-sm font-medium">{entry.label}</span>
                    <span className="text-xs text-stone-500">
                      roles: {entry.allowedRoles.join(', ')}
                    </span>
                    <span
                      className={
                        entry.status === 'available'
                          ? 'text-xs font-semibold text-teal-700'
                          : 'text-xs font-semibold text-stone-400'
                      }
                    >
                      {entry.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-2 border-t border-stone-200 pt-4">
        <ConsoleAuthorityLine
          owningAuthority="Frozen console registry (src/lib/console/registry.ts) · server role policy (src/lib/console/policy.ts) · server-derived environment (src/lib/environment.ts)"
          runtimeBoundary="server components under src/app/console/** (PC-002 shell + route entrypoints)"
          durableSource="none — foundation surface composes no financial reads"
          evidenceReference="spec/console/PC-001-evidence.md · spec/console/route-role-matrix.md · spec/console/reconciliation-matrix.md"
        />
      </footer>
    </div>
  );
}
