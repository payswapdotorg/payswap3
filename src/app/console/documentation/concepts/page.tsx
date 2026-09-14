/**
 * PC-005 — Console module route entrypoint (composed): documentation —
 * concepts.
 *
 * Module:  console.documentation.concepts
 * Route:   /console/documentation/concepts
 *
 * Protocol concepts, EXPLAINED BY LINKING to the frozen architecture
 * (spec/architecture/v0.1/): each file is named with its own coverage
 * statement (taken from the architecture index’s reading order), and the
 * binding global constraints appear as one-line pointers only. This page
 * deliberately does NOT duplicate or re-interpret area semantics — the
 * frozen files are the authority, and every referenced path is verified to
 * exist by the documentation route-inventory test (no dead links).
 *
 * The console-specific statements rendered here (UNKNOWN discipline in the
 * console, the server-derived environment signal) describe THIS
 * application’s existing behavior only.
 *
 * Guard on direct entry (fail closed): requireConsoleRoute resolves this
 * page’s own route through the frozen registry and enforces the module’s
 * allowed roles server-side (every authenticated role). Unauthenticated
 * viewers are redirected away before any content renders.
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import type { ReactNode } from 'react';
import { DOCUMENTATION_SPEC_LINKS, DOCUMENTATION_GLOBAL_CONSTRAINTS } from './spec-links';

export const metadata = consoleRouteMetadata('/console/documentation/concepts');

function SpecLinkView({ path, coverage }: { readonly path: string; readonly coverage: string }): ReactNode {
  return (
    <li className="rounded-xl border border-stone-300 bg-white p-4">
      <code
        data-docs-repo-path={path}
        className="block break-all rounded bg-stone-100 px-2 py-1 text-sm font-semibold"
      >
        {path}
      </code>
      <p className="mt-2 max-w-3xl text-sm text-stone-700">{coverage}</p>
    </li>
  );
}

export default async function ConsoleDocumentationConceptsPage() {
  // Fail closed on direct entry (unauthenticated → redirect '/').
  await requireConsoleRoute('/console/documentation/concepts');

  return (
    <article className="flex min-w-0 flex-col gap-6" data-console-view="documentation-concepts">
      <ConsoleModuleViewHeader
        href="/console/documentation/concepts"
        lead="The protocol concepts, linked — not duplicated. The frozen architecture directory is the single authority for protocol semantics; this page points at its files in the index’s own reading order and states only where each concept lives. Resolve the paths inside the repository checkout — a mechanical test verifies every one of them exists."
      />
      <section
        aria-labelledby="docs-concepts-authority-heading"
        className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6"
      >
        <h2 id="docs-concepts-authority-heading" className="text-lg font-semibold text-stone-900">
          One authority, frozen
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          Protocol architecture v0.1 is FROZEN: the directory{' '}
          <code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">spec/architecture/v0.1/</code>{' '}
          is the authoritative source for financial semantics, the authority model, ledgering,
          execution, clearing, netting, settlement, and finality. No content on this page restates or
          re-interprets an area — when you need the semantics, read the owning file. Changes to the
          frozen set require an Architecture Change Request; nothing in the console application can
          amend protocol semantics.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          Product UX semantics and deployment topology are explicitly out of scope for that directory
          (owned by product and deployment documentation); the console application implements the
          product layer and consumes protocol projections only.
        </p>
      </section>
      <section
        aria-labelledby="docs-concepts-constraints-heading"
        className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6"
      >
        <h2 id="docs-concepts-constraints-heading" className="text-lg font-semibold text-stone-900">
          The binding global constraints (pointers only)
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          Seven constraints bind every one of the 24 areas. The binding text lives in the
          architecture index; these are one-line pointers so you know what to look for when you open
          it:
        </p>
        <dl className="mt-3 grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {DOCUMENTATION_GLOBAL_CONSTRAINTS.map((constraint) => (
            <div key={constraint.id} className="flex flex-wrap gap-x-2">
              <dt className="font-semibold text-stone-700">{constraint.id}</dt>
              <dd className="text-stone-600" data-docs-constraint={constraint.id}>
                {constraint.pointer}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section
        aria-labelledby="docs-concepts-files-heading"
        className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6"
      >
        <h2 id="docs-concepts-files-heading" className="text-lg font-semibold text-stone-900">
          The architecture files, in the index’s reading order
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          Each file below states its own coverage; the area-per-file mapping and the reading order
          come from the architecture index (README.md). Resolve these paths inside the repository
          checkout.
        </p>
        <ol className="mt-3 space-y-3">
          {DOCUMENTATION_SPEC_LINKS.map((link) => (
            <li key={link.path}>
              <SpecLinkView path={link.path} coverage={link.coverage} />
            </li>
          ))}
        </ol>
      </section>
      <section
        aria-labelledby="docs-concepts-console-heading"
        className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6"
      >
        <h2 id="docs-concepts-console-heading" className="text-lg font-semibold text-stone-900">
          How the console itself behaves (this application, not protocol semantics)
        </h2>
        <ul className="mt-2 max-w-3xl list-disc space-y-2 pl-5 text-sm text-stone-600">
          <li>
            <span className="font-semibold text-stone-700">UNKNOWN, never guessed:</span> when a
            console read cannot reach its owning authority, the surface renders the honest UNKNOWN
            branch (the GC-2 discipline applied at the product layer) — never an empty list standing
            in for an answer, never a business verdict. See any composed console view.
          </li>
          <li>
            <span className="font-semibold text-stone-700">Environment signal:</span> the console’s
            environment (sandbox | production) is derived server-side from{' '}
            <code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">PAYSWAP_ENV</code>{' '}
            through the frozen allowlist with a fail-safe sandbox; no query parameter, header, cookie,
            or client state participates. The{' '}
            <a className="underline" href="/console/developers/environments">
              environments page
            </a>{' '}
            renders the whole chain read-only.
          </li>
          <li>
            <span className="font-semibold text-stone-700">Protocol evidence:</span> the console
            renders A15 evidence records verbatim where a read provides them; console request logs are
            diagnostic records, never evidence substitutes. The{' '}
            <a className="underline" href="/console/developers/logs">
              integration logs page
            </a>{' '}
            states the distinction on every entry.
          </li>
          <li>
            <span className="font-semibold text-stone-700">Command admission:</span> there is exactly
            one protocol-command admission point; the{' '}
            <a className="underline" href="/console/documentation/api">
              API reference
            </a>{' '}
            documents its HTTP binding (authorization, typed refusals, idempotent receipts).
          </li>
        </ul>
      </section>
    </article>
  );
}
