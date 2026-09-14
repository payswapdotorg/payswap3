/**
 * PC-005 — Console module route entrypoint (composed): documentation —
 * guides.
 *
 * Module:  console.documentation.guides
 * Route:   /console/documentation/guides
 *
 * The console getting-started guide: a walk through surfaces that ACTUALLY
 * exist at this baseline, in the order a new operator of the console would
 * meet them. Every internal link on this page resolves to a route in the
 * frozen console registry (the documentation route-inventory test extracts
 * the rendered hrefs and verifies each against the registry + the page
 * files on disk — no dead internal links), and every honest limitation
 * (in-memory developer stores, the simulated shell audience, no webhook
 * delivery worker) is stated where it is met.
 *
 * Guard on direct entry (fail closed): requireConsoleRoute resolves this
 * page’s own route through the frozen registry and enforces the module’s
 * allowed roles server-side (every authenticated role). Unauthenticated
 * viewers are redirected away before any content renders.
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import type { ReactNode } from 'react';

export const metadata = consoleRouteMetadata('/console/documentation/guides');

function StepView({
  ordinal,
  title,
  audience,
  children,
}: {
  readonly ordinal: number;
  readonly title: string;
  readonly audience: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <li data-docs-guide-step={ordinal} className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="inline-flex min-h-7 items-center rounded-lg border border-stone-300 bg-stone-100 px-2 py-0.5 text-sm font-semibold text-stone-700">
          Step {ordinal}
        </span>
        <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
        <span className="text-xs text-stone-500">audience: {audience}</span>
      </div>
      <div className="mt-3 max-w-3xl space-y-2 text-sm text-stone-600">{children}</div>
    </li>
  );
}

function ConsoleLink({ href, children }: { readonly href: string; readonly children: ReactNode }): ReactNode {
  return (
    <a data-docs-console-link={href} className="font-medium text-teal-700 underline hover:text-teal-800" href={href}>
      {children}
    </a>
  );
}

export default async function ConsoleDocumentationGuidesPage() {
  // Fail closed on direct entry (unauthenticated → redirect '/').
  await requireConsoleRoute('/console/documentation/guides');

  return (
    <article className="flex min-w-0 flex-col gap-6" data-console-view="documentation-guides">
      <ConsoleModuleViewHeader
        href="/console/documentation/guides"
        lead="Getting started with the PaySwap console: a walk through the surfaces that exist today, in the order you meet them — audiences and the fail-closed guard, the role-aware overview, the developer controls (credentials, webhooks, logs, inspector, environments), and where the deeper documentation lives."
      />
      <section
        aria-labelledby="docs-guides-honesty-heading"
        className="rounded-xl border-2 border-dashed border-stone-300 bg-stone-50 p-4 sm:p-6"
      >
        <h2 id="docs-guides-honesty-heading" className="text-lg font-semibold text-stone-900">
          What is (and is not) real at this baseline
        </h2>
        <ul className="mt-2 max-w-3xl list-disc space-y-1 pl-5 text-sm text-stone-700">
          <li>
            The <span className="font-semibold">shell audience is simulated</span>: a session cookie
            drives the role you are browsing as. Every guarded surface evaluates it server-side on
            entry — it grants no capability by itself.
          </li>
          <li>
            The <span className="font-semibold">developer-control stores are in-memory</span>{' '}
            (module-scoped, cleared on restart): developer tooling, never protocol financial truth.
            Every developer surface says so on its face.
          </li>
          <li>
            <span className="font-semibold">No webhook delivery worker exists</span> at this baseline:
            you can register endpoints and read the real event-identifier catalog, but no delivery is
            recorded or simulated.
          </li>
          <li>
            Console request logs are <span className="font-semibold">diagnostic records</span>,
            redacted before storage — never protocol evidence substitutes.
          </li>
        </ul>
      </section>
      <ol className="space-y-4">
        <StepView ordinal={1} title="Enter with an audience" audience="any (pick one)">
          <p>
            The console is role-aware and fail-closed: unauthenticated viewers are redirected away
            before any content renders, and each module allows only its frozen set of roles. Start by
            switching the simulated shell audience (the header control on the product shell, or the
            executable audience-switch example on the{' '}
            <ConsoleLink href="/console/documentation/examples">examples page</ConsoleLink>).
          </p>
          <p>
            The role you pick decides what you see: merchants get payments, checkout, accounts, and
            the developer controls; providers get capabilities; operators get the operations family;
            administrators get cross-role accounts; customers get their payments and checkout test.
            The full allow/deny grid is the frozen route-role matrix (
            <code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">
              spec/console/route-role-matrix.md
            </code>
            ).
          </p>
        </StepView>
        <StepView ordinal={2} title="Orient on the overview" audience="every authenticated role">
          <p>
            <ConsoleLink href="/console">/console</ConsoleLink> renders the role-aware overview: the
            modules your role may reach, with their registry statuses (a module still marked planned
            renders the honest planned-state placeholder — no invented data).
          </p>
          <p>
            The environment signal (sandbox | production) is derived server-side from deployment
            configuration and rendered persistently in the shell. It is read-only everywhere: there is
            no control that selects it.
          </p>
        </StepView>
        <StepView ordinal={3} title="Create your first API key (merchant)" audience="merchant">
          <p>
            Open <ConsoleLink href="/console/developers/api-keys">/console/developers/api-keys</ConsoleLink>.
            The create form posts to the dedicated credential boundary; the token is generated
            server-side and shown <span className="font-semibold">exactly once</span> in the creation
            receipt — copy it into your secret storage immediately. The list later shows only
            id/label/environment/created/revoked; the plaintext is never re-displayed by any later
            read.
          </p>
          <p>
            Revocation is explicit (the per-key revoke form) and audited in the in-memory audit trail
            rendered on the same page. Keys are environment-scoped: the environment comes from the
            server-derived configuration, and the form deliberately has no environment field.
          </p>
        </StepView>
        <StepView ordinal={4} title="Register a webhook endpoint and read the event catalog (merchant)" audience="merchant">
          <p>
            On <ConsoleLink href="/console/developers/webhooks">/console/developers/webhooks</ConsoleLink>,
            register an endpoint (https, or http for loopback hosts). The signing secret is a
            credential: server-generated, shown once through the same receipt mechanism, never
            logged.
          </p>
          <p>
            The event catalog lists the identifiers a delivery WOULD reference — taken only from the
            real vocabularies the repository defines (the frozen observability taxonomy and the
            durable substrate job-lifecycle events), each with its owning vocabulary attributed. The
            delivery-state panel states the honest absence: no delivery worker exists, and retries
            must never imply protocol replay.
          </p>
        </StepView>
        <StepView ordinal={5} title="Read the integration logs and inspect a request (merchant)" audience="merchant">
          <p>
            <ConsoleLink href="/console/developers/logs">/console/developers/logs</ConsoleLink> shows
            the bounded diagnostic ring: every request that crosses the developer credential boundary
            lands there payload-free (method/path/status/outcome), redacted before storage through
            the same fail-closed primitive every structured log emit uses. An empty ring is the
            honest empty value — it fills as traffic crosses the boundary.
          </p>
          <p>
            <ConsoleLink href="/console/developers/request-inspector">
              /console/developers/request-inspector
            </ConsoleLink>{' '}
            is the per-entry query view over the same ring: server-side path/status filters
            (presentation only), full per-entry detail with the already-redacted payload, and no
            export by design — no secret-bearing output ever leaves that surface.
          </p>
        </StepView>
        <StepView ordinal={6} title="Check the environment scope (merchant)" audience="merchant">
          <p>
            <ConsoleLink href="/console/developers/environments">
              /console/developers/environments
            </ConsoleLink>{' '}
            renders the one derivation chain that sets the environment signal, the startup
            configuration validation summary (names only, never values), and the read-only
            no-switching statement. Developer credentials are created in this environment only.
          </p>
        </StepView>
        <StepView ordinal={7} title="Go deeper with the documentation" audience="every authenticated role">
          <p>
            The <ConsoleLink href="/console/documentation/api">API reference</ConsoleLink> enumerates
            every implemented HTTP boundary with its own conventions; the{' '}
            <ConsoleLink href="/console/documentation/concepts">concepts page</ConsoleLink> links the
            frozen protocol architecture (never re-interpreting it); the{' '}
            <ConsoleLink href="/console/documentation/examples">examples page</ConsoleLink> carries
            runnable requests, each labeled executable or illustrative.
          </p>
        </StepView>
      </ol>
    </article>
  );
}
