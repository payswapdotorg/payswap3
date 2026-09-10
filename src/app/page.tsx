import Link from 'next/link';
import type { ReactNode } from 'react';
import { describeEnvironment } from '@/lib/environment';
import { getShellAudience, resolveNavigation } from '@/lib/navigation';
import { DISPLAY_STATES, STATE_LABELS, STATE_MEANINGS } from '@/components/state/display-state';
import {
  ActionRequiredIcon,
  FailedIcon,
  InProgressIcon,
  SucceededIcon,
  UnknownIcon,
  WaitingIcon,
} from '@/components/state/state-icons';

/**
 * Shell entry surface (UI-001). Every visitor lands here; the shell renders
 * the least-visibility (unauthenticated) view until an identity work item
 * supplies an authoritative role input (P8). No financial semantics exist
 * on this surface.
 */
export default function HomePage() {
  const environment = describeEnvironment();
  const audience = getShellAudience();
  const navigation = resolveNavigation(audience);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
      <section aria-labelledby="shell-intro">
        <p className="text-xs font-semibold uppercase tracking-widest text-teal-700">
          UI-001 · Product foundation
        </p>
        <h1
          id="shell-intro"
          className="mt-2 max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl"
        >
          PaySwap application shell
        </h1>
        <p className="mt-4 max-w-2xl text-base text-stone-600">
          Every product surface mounts into this shell. It provides one navigation grammar,
          six explicit display states, a persistent environment signal, and role-scoped
          navigation — and it deliberately carries zero financial semantics: no balances, no
          settlement or finality wording, no protocol states.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/state-primitives"
            className="inline-flex min-h-11 items-center rounded-lg bg-stone-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-stone-700"
          >
            Open the verification surface
          </Link>
        </div>
      </section>

      <section aria-labelledby="state-vocabulary" className="mt-10">
        <h2 id="state-vocabulary" className="text-lg font-semibold">
          Display state vocabulary
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-stone-600">
          Every stateful rendering resolves to exactly one explicit display state (P4) — no
          ambiguous pending. Select a chip to see the primitive and its mandatory content.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {DISPLAY_STATES.map((state) => (
            <li key={state}>
              <StateVocabularyChip state={state} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="shell-provides" className="mt-10">
        <h2 id="shell-provides" className="text-lg font-semibold">
          What the shell provides
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <article className="rounded-xl border border-stone-200 bg-stone-50 p-4 sm:p-5">
            <h3 className="font-semibold">One navigation grammar</h3>
            <p className="mt-1 text-sm text-stone-600">
              Back/close semantics, primary navigation, and deep linking are defined once in{' '}
              <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">
                src/lib/navigation.ts
              </code>{' '}
              and consumed by every surface. Surfaces never invent local navigation (P1).
            </p>
          </article>
          <article className="rounded-xl border border-stone-200 bg-stone-50 p-4 sm:p-5">
            <h3 className="font-semibold">Six explicit display states</h3>
            <p className="mt-1 text-sm text-stone-600">
              Succeeded, failed, unknown, waiting, in progress, and action required render as
              distinct primitives with mandatory content. Unknown is never failure; a failed
              fetch renders unknown, not failed (P4, P5).
            </p>
            <p className="mt-2">
              <Link
                href="/state-primitives#state-matrix"
                className="inline-flex min-h-11 items-center text-sm font-medium text-teal-800 underline decoration-teal-700 underline-offset-4 hover:bg-teal-50"
              >
                View the state-primitive matrix
              </Link>
            </p>
          </article>
          <article className="rounded-xl border border-stone-200 bg-stone-50 p-4 sm:p-5">
            <h3 className="font-semibold">Environment signal</h3>
            <p className="mt-1 text-sm text-stone-600">
              This session runs in the{' '}
              <strong className="font-semibold">{environment.kind}</strong> environment. The
              signal derives only from explicit build-time configuration (
              {environment.source}); URL parameters, user content, and client state cannot set
              it, and no control re-labels it (Section 10, N4).
            </p>
          </article>
          <article className="rounded-xl border border-stone-200 bg-stone-50 p-4 sm:p-5">
            <h3 className="font-semibold">Role-scoped navigation</h3>
            <p className="mt-1 text-sm text-stone-600">
              Entries for customer, merchant, provider, operator, and administrator are
              declared in the grammar. Unauthenticated visitors get least visibility, and the
              UI never self-assigns or escalates roles — role truth is an authoritative input
              (P8).
            </p>
          </article>
        </div>
      </section>

      <section aria-labelledby="current-view" className="mt-10">
        <h2 id="current-view" className="text-lg font-semibold">
          Current view
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Environment
            </dt>
            <dd className="mt-1 text-sm">
              {environment.kind === 'sandbox' ? 'Sandbox' : 'Production'} — configuration
              classified as {environment.configuredValue}; anything other than an explicit
              production value resolves fail-safe to sandbox.
            </dd>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Viewer
            </dt>
            <dd className="mt-1 text-sm">
              Unauthenticated — least visibility (P8). No identity input exists in UI-001, so
              the shell never guesses a role.
            </dd>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Visible navigation
            </dt>
            <dd className="mt-1 text-sm">
              Primary: {navigation.primary.map((entry) => entry.label).join(', ')}. Footer:{' '}
              {navigation.footer.map((entry) => entry.label).join(', ')}.
            </dd>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Shared breakpoints (P10)
            </dt>
            <dd className="mt-1 text-sm">
              sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536 — defined once in the grammar.
              Touch targets are 44px; no layout scrolls horizontally.
            </dd>
          </div>
        </dl>
        <p className="mt-4 max-w-2xl text-sm text-stone-600">
          Planned role entries are inert and tagged until their owning work items ship them.
          The role-routing matrix on the verification surface renders all five role views plus
          the unauthenticated view as static proof — the product contains no role-switching
          control, because role assignment is an authoritative input the UI never
          self-assigns (P8).
        </p>
      </section>
    </div>
  );
}

function StateVocabularyChip({ state }: { state: (typeof DISPLAY_STATES)[number] }) {
  const className = 'h-4 w-4';
  const icon: ReactNode =
    state === 'SUCCEEDED' ? (
      <SucceededIcon className={className} />
    ) : state === 'FAILED' ? (
      <FailedIcon className={className} />
    ) : state === 'UNKNOWN' ? (
      <UnknownIcon className={className} />
    ) : state === 'WAITING' ? (
      <WaitingIcon className={className} />
    ) : state === 'IN_PROGRESS' ? (
      <InProgressIcon className={className} />
    ) : (
      <ActionRequiredIcon className={className} />
    );
  return (
    <Link
      href="/state-primitives#state-matrix"
      title={`${STATE_LABELS[state]} — ${STATE_MEANINGS[state]} (see the primitive matrix)`}
      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-stone-300 bg-white px-3 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100"
    >
      <span aria-hidden="true" className="text-stone-600">
        {icon}
      </span>
      {STATE_LABELS[state]}
    </Link>
  );
}
