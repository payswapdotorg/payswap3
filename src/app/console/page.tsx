/**
 * PC-001 — Console foundation root (placeholder, NO feature views).
 *
 * Renders exactly the foundation surface: the frozen route/module registry
 * summary (from src/lib/console/registry.ts — design §5 information
 * architecture) and the server-derived environment label (from
 * src/lib/console/environment-context.ts). Composed feature views belong to
 * PC-004/PC-005 and are marked `planned` in the registry until then.
 *
 * Deep-link role check on direct entry (P8): the page re-checks its own
 * module even though the layout already guarded the group.
 */

import type { Metadata } from 'next';
import {
  CONSOLE_ROOT_MODULE_ID,
  consoleRegistryByGroup,
  consoleRegistrySummary,
} from '@/lib/console/registry';
import { requireConsoleModule } from '@/lib/console/policy';
import { getConsoleEnvironmentContext } from '@/lib/console/environment-context';
import { ConsoleAuthorityLine } from '@/components/console';

export const metadata: Metadata = {
  title: 'Console — PaySwap',
  description:
    'PaySwap developer console foundation: the frozen route/module registry and the server-derived environment context. Feature views arrive in later work items.',
};

export default async function ConsoleFoundationPage() {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  const principal = await requireConsoleModule(CONSOLE_ROOT_MODULE_ID);

  const environment = getConsoleEnvironmentContext();
  const grouped = consoleRegistryByGroup();
  const summary = consoleRegistrySummary();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-teal-700">
          PC-001 · Console foundation
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          PaySwap developer console
        </h1>
        <p className="mt-4 max-w-3xl text-base text-stone-600">
          This is the frozen foundation surface: the route/module registry for the
          approved console information architecture and the server-derived environment
          context. No feature views ship in this work item — every composed feature
          route below is <span className="font-semibold">planned</span> until its owning
          work item (PC-004/PC-005) merges.
        </p>
      </header>

      <section aria-labelledby="console-principal" className="mt-8">
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

      <section aria-labelledby="console-registry" className="mt-10">
        <h2 id="console-registry" className="text-xl font-semibold">
          Frozen route/module registry
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          {summary.totalRoutes} routes across {summary.groups.length} top-level groups —{' '}
          {summary.availableRoutes} available (this foundation root) and{' '}
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
                    <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">{entry.href}</code>
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

      <footer className="mt-10 border-t border-stone-200 pt-4">
        <ConsoleAuthorityLine
          owningAuthority="Frozen console registry (src/lib/console/registry.ts) · server-derived environment (src/lib/environment.ts)"
          runtimeBoundary="server components under src/app/console/** (PC-001 scaffolding)"
          durableSource="none — foundation surface composes no financial reads"
          evidenceReference="spec/console/PC-001-evidence.md · spec/console/route-role-matrix.md · spec/console/reconciliation-matrix.md"
        />
      </footer>
    </div>
  );
}
