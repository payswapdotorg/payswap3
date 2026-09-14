/**
 * PC-005 — Console module route entrypoint (composed): documentation —
 * examples.
 *
 * Module:  console.documentation.examples
 * Route:   /console/documentation/examples
 *
 * Every example carries an explicit label:
 *   - EXECUTABLE — the request runs against a running server exactly as
 *     shown (base URL: a local dev server), and the documented response is
 *     what the real route handler answers;
 *   - ILLUSTRATIVE — marked prose: the SHAPE orients reading, with the
 *     honest reason it is not runnable as-is stated on the card. Nothing
 *     illustrative is ever presented as runnable.
 *
 * The example set lives in example-set.ts; the documentation
 * route-inventory test verifies every route path referenced by an example
 * exists (a real implemented route or a real console page) — no example
 * can point at a dead route.
 *
 * Guard on direct entry (fail closed): requireConsoleRoute resolves this
 * page’s own route through the frozen registry and enforces the module’s
 * allowed roles server-side (every authenticated role). Unauthenticated
 * viewers are redirected away before any content renders.
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import type { ReactNode } from 'react';
import {
  EXECUTABLE_DOCUMENTATION_EXAMPLES,
  ILLUSTRATIVE_DOCUMENTATION_EXAMPLES,
} from './example-set';
import type { DocumentationExample } from './example-set';

export const metadata = consoleRouteMetadata('/console/documentation/examples');

function ExampleCardView({ example }: { readonly example: DocumentationExample }): ReactNode {
  const executable = example.kind === 'executable';
  return (
    <li
      data-docs-example={example.id}
      data-docs-example-kind={example.kind}
      className="rounded-xl border border-stone-300 bg-white p-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold text-stone-900">{example.title}</h3>
        {executable ? (
          <span
            data-docs-example-label="executable"
            className="inline-flex min-h-6 items-center rounded-lg border border-teal-300 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800"
          >
            Executable — runs against a live server exactly as shown
          </span>
        ) : (
          <span
            data-docs-example-label="illustrative"
            className="inline-flex min-h-6 items-center rounded-lg border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800"
          >
            Illustrative — shape only, not runnable as-is
          </span>
        )}
      </div>
      <p className="mt-2 max-w-3xl text-sm text-stone-700">{example.point}</p>
      <pre className="mt-3 max-w-full overflow-x-auto rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs leading-relaxed text-stone-800">
        {example.request}
      </pre>
      {executable && example.response !== undefined && (
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          <span className="font-semibold text-stone-700">Response: </span>
          <code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">{example.response}</code>
        </p>
      )}
      {!executable && example.illustrativeBecause !== undefined && (
        <p className="mt-2 max-w-3xl rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="font-semibold">Why illustrative: </span>
          {example.illustrativeBecause}
        </p>
      )}
      <p className="mt-2 text-xs text-stone-500">
        Routes:{' '}
        {example.routes.map((route) => (
          <code key={route} data-docs-example-route={route} className="mr-1 break-all rounded bg-stone-100 px-1 py-0.5">
            {route}
          </code>
        ))}
      </p>
    </li>
  );
}

export default async function ConsoleDocumentationExamplesPage() {
  // Fail closed on direct entry (unauthenticated → redirect '/').
  await requireConsoleRoute('/console/documentation/examples');

  return (
    <article className="flex min-w-0 flex-col gap-6" data-console-view="documentation-examples">
      <ConsoleModuleViewHeader
        href="/console/documentation/examples"
        lead="Requests against the implemented boundaries, each labeled executable or illustrative. Executable ones run exactly as shown against a running server (the documented responses are the real handlers' answers); illustrative ones show shapes only, with the honest reason they are not runnable as-is stated on every card."
      />
      <section
        aria-labelledby="docs-examples-conventions-heading"
        className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6"
      >
        <h2 id="docs-examples-conventions-heading" className="text-lg font-semibold text-stone-900">
          Conventions
        </h2>
        <ul className="mt-2 max-w-3xl list-disc space-y-1 pl-5 text-sm text-stone-600">
          <li>
            Base URL: the examples address a local dev server (
            <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">http://localhost:3000</code>) —
            substitute your running origin.
          </li>
          <li>
            Audience: console and mediation boundaries authorize the SERVER-side session audience
            cookie (<code className="rounded bg-stone-100 px-1 py-0.5 text-xs">payswap-shell-audience</code>
            ), set through the simulated shell (see the executable audience-switch example).
          </li>
          <li>
            Every response is <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">no-store</code>;
            the routes’ full contracts are on the{' '}
            <a className="underline" href="/console/documentation/api">
              API reference
            </a>{' '}
            page.
          </li>
        </ul>
      </section>
      <section
        aria-labelledby="docs-examples-executable-heading"
        className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6"
      >
        <h2 id="docs-examples-executable-heading" className="text-lg font-semibold text-stone-900">
          Executable examples ({EXECUTABLE_DOCUMENTATION_EXAMPLES.length})
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          Run these exactly as shown; the documented responses are the honest answers the real route
          handlers give.
        </p>
        <ul className="mt-3 space-y-3">
          {EXECUTABLE_DOCUMENTATION_EXAMPLES.map((example) => (
            <ExampleCardView key={example.id} example={example} />
          ))}
        </ul>
      </section>
      <section
        aria-labelledby="docs-examples-illustrative-heading"
        className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6"
      >
        <h2 id="docs-examples-illustrative-heading" className="text-lg font-semibold text-stone-900">
          Illustrative examples ({ILLUSTRATIVE_DOCUMENTATION_EXAMPLES.length}) — marked prose
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          These show request/payload SHAPES to orient reading. Each card states why it is not
          runnable as-is — including the honest absences (no webhook delivery worker exists at this
          baseline). None of them is presented as runnable.
        </p>
        <ul className="mt-3 space-y-3">
          {ILLUSTRATIVE_DOCUMENTATION_EXAMPLES.map((example) => (
            <ExampleCardView key={example.id} example={example} />
          ))}
        </ul>
      </section>
    </article>
  );
}
