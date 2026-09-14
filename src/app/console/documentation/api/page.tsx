/**
 * PC-005 — Console module route entrypoint (composed): documentation — API
 * reference.
 *
 * Module:  console.documentation.api
 * Route:   /console/documentation/api
 *
 * The API reference, enumerated from the REAL implemented HTTP boundaries
 * (route-inventory.ts — every route file under src/app/api, summarized from
 * each route’s own declarations). The inventory is mechanically
 * cross-checked against the filesystem by the documentation route-inventory
 * test, so this page can neither invent a route nor omit one: the reference
 * and the implementation cannot drift silently.
 *
 * Guard on direct entry (fail closed): requireConsoleRoute resolves this
 * page’s own route through the frozen registry and enforces the module’s
 * allowed roles server-side (every authenticated role — documentation is
 * part of the product shell, design §14). Unauthenticated viewers are
 * redirected away before any content renders.
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import type { ReactNode } from 'react';
import {
  DOCUMENTATION_API_ROUTE_SECTIONS,
  DOCUMENTATION_API_ROUTE_ENTRIES,
} from './route-inventory';
import type { DocumentationApiRouteEntry } from './route-inventory';

export const metadata = consoleRouteMetadata('/console/documentation/api');

const METHOD_STYLES: Readonly<Record<string, string>> = {
  GET: 'border-teal-300 bg-teal-50 text-teal-800',
  POST: 'border-stone-400 bg-stone-100 text-stone-800',
  DELETE: 'border-red-300 bg-red-50 text-red-800',
};

function RouteEntryView({ entry }: { readonly entry: DocumentationApiRouteEntry }): ReactNode {
  return (
    <li
      data-docs-api-route={entry.path}
      className="rounded-xl border border-stone-300 bg-white p-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {entry.methods.map((method) => (
          <span
            key={method}
            data-docs-api-method={method}
            className={`inline-flex min-h-6 items-center rounded-lg border px-2 py-0.5 text-xs font-semibold ${
              METHOD_STYLES[method] ?? 'border-stone-300 bg-stone-50 text-stone-700'
            }`}
          >
            {method}
          </span>
        ))}
        <code className="break-all rounded bg-stone-100 px-1 py-0.5 text-sm font-semibold">{entry.path}</code>
      </div>
      <p className="mt-2 max-w-3xl text-sm text-stone-700">{entry.summary}</p>
      <ul className="mt-2 max-w-3xl list-disc space-y-1 pl-5 text-sm text-stone-600">
        {entry.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-stone-500">
        Source:{' '}
        <code data-docs-api-source={entry.sourceFile} className="break-all rounded bg-stone-100 px-1 py-0.5">
          {entry.sourceFile}
        </code>
      </p>
    </li>
  );
}

export default async function ConsoleDocumentationApiPage() {
  // Fail closed on direct entry (unauthenticated → redirect '/').
  await requireConsoleRoute('/console/documentation/api');

  return (
    <article className="flex min-w-0 flex-col gap-6" data-console-view="documentation-api">
      <ConsoleModuleViewHeader
        href="/console/documentation/api"
        lead="Every HTTP boundary the repository actually implements, enumerated route file by route file — with each route’s own fail-closed conventions, envelope shapes, and honest denial semantics stated. The inventory is cross-checked against the filesystem by the documentation route-inventory test, so this reference cannot drift from the implementation."
      />
      <section
        aria-labelledby="docs-api-scope-heading"
        className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6"
      >
        <h2 id="docs-api-scope-heading" className="text-lg font-semibold text-stone-900">
          Scope and maintenance
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          This reference covers exactly the {DOCUMENTATION_API_ROUTE_ENTRIES.length} route files under{' '}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">src/app/api/**</code> that exist at
          this baseline. Summaries are taken from each route’s own declarations (its header comment and
          handler behavior) — nothing here re-derives protocol semantics; where a route’s semantics are
          owned by a spec, the owning spec is the authority (see{' '}
          <a className="underline" href="/console/documentation/concepts">
            Concepts
          </a>
          ).
        </p>
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          A mechanical test enumerates the implemented route files and asserts set equality with this
          page’s inventory in both directions: a new route cannot ship undocumented, and this page
          cannot document a route that does not exist. Ready-to-run requests against these routes are
          on the{' '}
          <a className="underline" href="/console/documentation/examples">
            Examples
          </a>{' '}
          page, each labeled executable or illustrative.
        </p>
      </section>
      {DOCUMENTATION_API_ROUTE_SECTIONS.map((section) => (
        <section
          key={section.family}
          aria-labelledby={`docs-api-${section.family}-heading`}
          className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6"
        >
          <h2 id={`docs-api-${section.family}-heading`} className="text-lg font-semibold text-stone-900">
            {section.heading}
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-stone-600">{section.lead}</p>
          <ul className="mt-3 space-y-3">
            {section.entries.map((entry) => (
              <RouteEntryView key={entry.path} entry={entry} />
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
