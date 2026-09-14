/**
 * PC-002 — The honest planned-state module placeholder.
 *
 * Every console route whose frozen registry status is `planned` renders THIS
 * component (never a fake feature view): the registry-derived label,
 * description, route, module id, status, and allowed roles — and nothing
 * else. No data is displayed because none exists on this surface yet; the
 * composed feature views arrive in the later governed work items (PC-004 /
 * PC-005) that own those modules and flip their registry status.
 *
 * The component is purely presentational over ONE registry entry resolved
 * by route path (single source: the page passes only its own href). A route
 * that is not in the frozen registry fails closed through notFound() — the
 * existing grammar-aware 404 convention. Access enforcement is NOT done
 * here: pages guard themselves with requireConsoleRoute before rendering
 * this component (fail closed before any content exists).
 */

import { notFound } from 'next/navigation';
import { findConsoleRoute } from '@/lib/console/registry';
import { consoleGroupLabel } from './console-navigation';
import { ConsoleAuthorityLine } from '@/components/console';

export interface ConsolePlannedModuleProps {
  /** The page's own route path — resolved through the frozen registry. */
  readonly href: string;
}

export function ConsolePlannedModule({ href }: ConsolePlannedModuleProps) {
  const entry = findConsoleRoute(href);
  if (!entry) {
    // Registry-unknown route → no surface (P1: no orphan routes).
    notFound();
  }
  return (
    <article data-console-module-page={entry.id} className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-teal-700">
          Console module · {consoleGroupLabel(entry.group)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" data-testid="console-module-label">
            {entry.label}
          </h1>
          <span
            aria-label="Module status: planned — no feature view has shipped yet"
            title="Reserved by the frozen registry; the composed feature view ships in its owning work item."
            className="inline-flex min-h-6 items-center rounded-full border border-stone-300 bg-stone-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500"
            data-testid="console-module-status"
          >
            Planned
          </span>
        </div>
      </header>

      <p className="mt-4 max-w-2xl text-sm text-stone-600" data-testid="console-module-description">
        {entry.description}
      </p>

      <section aria-labelledby="console-module-facts" className="mt-6">
        <h2 id="console-module-facts" className="text-sm font-semibold text-stone-800">
          Registry facts
        </h2>
        <dl className="mt-2 grid max-w-2xl grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-stone-600">Route:</dt>
            <dd>
              <code className="break-words rounded bg-stone-100 px-1 py-0.5 text-xs">{entry.href}</code>
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-stone-600">Module id:</dt>
            <dd>
              <code className="break-words rounded bg-stone-100 px-1 py-0.5 text-xs">{entry.id}</code>
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-stone-600">Status:</dt>
            <dd className="font-semibold text-stone-500">{entry.status}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-stone-600">Allowed roles:</dt>
            <dd>{entry.allowedRoles.join(', ')}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="console-module-planned-note" className="mt-6">
        <h2 id="console-module-planned-note" className="text-sm font-semibold text-stone-800">
          What this page is — and is not
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-stone-600">
          This module is <span className="font-semibold">planned</span> in the frozen
          console registry: the route exists so the information architecture is real and
          deep-linkable for the roles allowed above, but its feature view has not shipped
          yet. <span className="font-semibold">No data is displayed here, because none
          exists on this surface</span> — this placeholder never presents a simulated,
          cached, or invented view of the module. The composed feature view arrives with
          its owning work item, which also flips this registry entry to{' '}
          <code className="break-words rounded bg-stone-100 px-1 py-0.5 text-xs">available</code>.
        </p>
        <p className="mt-2 max-w-2xl text-sm text-stone-600">
          Access to this route is enforced server-side before this page renders: viewers
          who are not explicitly allowed for the module are redirected away — the
          placeholder above never leaks to an unauthorized audience.
        </p>
      </section>

      <footer className="mt-8 border-t border-stone-200 pt-4">
        <ConsoleAuthorityLine
          owningAuthority="Frozen console registry (src/lib/console/registry.ts) · server role policy (src/lib/console/policy.ts)"
          runtimeBoundary="server components under src/app/console/** (PC-002 route entrypoints)"
          durableSource="none — planned module renders no data (PC-004/PC-005 compose the feature views)"
          evidenceReference="spec/console/route-role-matrix.md · spec/console/reconciliation-matrix.md"
        />
      </footer>
    </article>
  );
}
