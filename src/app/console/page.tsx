/**
 * PC-004 — Console Overview (the frozen registry root module, composed).
 *
 * The PC-002 foundation content carried forward and extended with the PC-004
 * composed operations-health summary:
 *
 *   - the registry-driven module map (only the signed-in role's modules,
 *     filtered server-side before any markup exists);
 *   - the server-derived environment context (PC-001 — no input path);
 *   - the authoritative operations-health summary composed from the PC-003
 *     operations-health read model — ONLY for the operator role (the six
 *     operations modules are operator-only in the frozen route-role matrix,
 *     so composing health data for any other role would expose another
 *     role's data; every other role gets the honest scoping note instead).
 *
 * NO invented metrics: anything not derivable from an authoritative read is
 * either an honest UNKNOWN or omitted with a note (payment/activity counts,
 * volumes, and success rates have no authoritative aggregate read at this
 * baseline — the payments read model's own status convention forbids
 * aggregating item statuses into a verdict the authority never gave).
 *
 * Deep-link role check on direct entry (P8): the page re-checks its own
 * module even though the layout already guarded the group.
 */

import {
  consoleRegistryByGroup,
  consoleRegistrySummary,
} from '@/lib/console/registry';
import { getConsoleEnvironmentContext } from '@/lib/console/environment-context';
import { readConsoleOperationsHealth } from '@/lib/console/read-models/operations-health';
import { ConsoleAuthorityLine } from '@/components/console';
import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { consoleNavigationForRole } from '@/components/console/shell/console-navigation';
import { ConsoleNavList } from '@/components/console/shell/console-nav';
import { ConsoleOperationsHealthSummaryView } from '@/components/console/views/operations-health-view';
import { ConsoleReadUnavailablePanel } from '@/components/console/views/console-read-result';

export const metadata = consoleRouteMetadata('/console');

export default async function ConsoleOverviewPage() {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  const principal = await requireConsoleRoute('/console');

  const environment = getConsoleEnvironmentContext();
  const navigation = consoleNavigationForRole(principal.role);
  const grouped = consoleRegistryByGroup();
  const summary = consoleRegistrySummary();
  const reachableCount = navigation.reduce((count, group) => count + group.items.length, 0);

  // Role-aware health composition: the operations modules are operator-only
  // in the frozen route-role matrix — the health summary composes for the
  // operator and stays an honest scoping note for every other role.
  const operatorHealth =
    principal.role === 'operator' ? await readConsoleOperationsHealth() : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-teal-700">
          Console module · Overview
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          PaySwap developer console
        </h1>
        <p className="mt-4 max-w-3xl text-base text-stone-600">
          One console shell over the frozen information architecture: navigation and every
          module route derive from the single route/module registry, the navigation renders
          only the modules your signed-in role may access (server-side, default-deny), and
          composed views read only authoritative sources — anything an authority has not
          answered renders UNKNOWN, never a guessed verdict.
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

      {operatorHealth !== undefined ? (
        <section aria-labelledby="console-operations-health-summary">
          <h2 id="console-operations-health-summary" className="text-xl font-semibold">
            Operations health (operator-scoped)
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-stone-600">
            Composed from the PC-003 operations-health read model — the same fail-closed
            nine-domain probe the readiness boundary composes through. Shown here only for
            the operator role: the six operations modules are operator-only in the frozen
            route-role matrix, and this summary would expose another role's data for
            anyone else.
          </p>
          <div className="mt-3">
            {operatorHealth.outcome === 'unavailable' ? (
              <ConsoleReadUnavailablePanel
                subject="operations health"
                note={operatorHealth.note}
                authority={operatorHealth.authority}
              />
            ) : (
              <ConsoleOperationsHealthSummaryView result={operatorHealth} />
            )}
          </div>
        </section>
      ) : (
        <section aria-labelledby="console-operations-health-scoped">
          <h2 id="console-operations-health-scoped" className="text-xl font-semibold">
            Operations health (operator-scoped)
          </h2>
          <p className="mt-2 max-w-3xl rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600" data-testid="console-operations-health-role-scoped">
            The operations-health summary is composed only for the operator role — the
            six operations modules are operator-only in the frozen route-role matrix, so
            nothing operational is shown here for the {principal.role} role. This is a
            role-scoping statement, not a health verdict: nothing is claimed either way.
          </p>
        </section>
      )}

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

      <section aria-labelledby="console-overview-honesty">
        <h2 id="console-overview-honesty" className="text-xl font-semibold">
          What this overview deliberately does not show
        </h2>
        <p className="mt-2 max-w-3xl rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600" data-testid="console-overview-no-invented-metrics">
          No payment counts, volumes, success rates, or account totals appear here: no
          authoritative aggregate read exists at this baseline, and the payments read
          model's own status convention forbids aggregating per-item states into a
          verdict the authority never gave. Degrading to invented metrics is exactly
          what this console refuses to do — figures appear only where an authority
          quoted them.
        </p>
      </section>

      <footer className="mt-2 border-t border-stone-200 pt-4">
        <ConsoleAuthorityLine
          owningAuthority="Frozen console registry (src/lib/console/registry.ts) · server role policy (src/lib/console/policy.ts) · server-derived environment (src/lib/environment.ts) · operations health via the PC-003 read model (probeComponentHealth composition point)"
          runtimeBoundary="server components under src/app/console/** (PC-002 shell + PC-004 composed views)"
          durableSource="none beyond the operations-health telemetry substrate — this overview composes no financial reads"
          evidenceReference="spec/console/PC-001-evidence.md · spec/console/route-role-matrix.md · spec/console/reconciliation-matrix.md · spec/console/PC-004-evidence.md"
        />
      </footer>
    </div>
  );
}
