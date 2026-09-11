import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { describeEnvironment } from '@/lib/environment';
import {
  BREAKPOINTS,
  NAVIGATION_ENTRIES,
  NAVIGATION_GRAMMAR_RULES,
  audienceLabel,
} from '@/lib/navigation';
import {
  ActionRequiredState,
  AvailabilityUnknownState,
  FailedState,
  InProgressState,
  SucceededState,
  UnknownState,
  WaitingState,
} from '@/components/state';
import { EnvironmentSpoofProbe } from '@/components/verification/environment-spoof-probe';
import { RoleRoutingMatrix } from '@/components/verification/role-routing-matrix';
import { StateTransitionDemo } from '@/components/verification/state-transition-demo';

export const metadata: Metadata = {
  title: 'State primitives (verification)',
  description:
    'UI-001 verification surface: state-primitive matrix, environment derivation and anti-spoofing proof, role-routing matrix, and the navigation grammar registry.',
};

/**
 * UI-001 verification surface — the work-order evidence surface.
 *
 * Renders the state-primitive matrix (including the UNKNOWN and
 * fetch-failure cases), the environment derivation chain with an anti-spoof
 * probe, the role-routing matrix for the five roles plus the unauthenticated
 * view, and the navigation grammar registry. The surface is itself part of
 * the grammar (footer entry on every route, deep-linkable, allowed for
 * every audience). It carries no financial semantics: every state below is
 * a demonstration fixture, never a product outcome.
 */
export default function StatePrimitivesPage() {
  const environment = describeEnvironment();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-teal-700">
          UI-001 · Verification evidence
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          State display primitives & shell proof
        </h1>
        <p className="mt-4 max-w-3xl text-base text-stone-600">
          This surface renders the full state-primitive matrix, the environment-signal
          derivation chain with an anti-spoof probe, the role-routing matrix for all five
          roles plus the unauthenticated view, and the single navigation grammar registry.
          It is deep-linkable and allowed for every audience per the grammar. Every state
          rendered below is a demonstration fixture with demonstration authorities — no
          financial semantics and no product outcomes exist on this surface.
        </p>
      </header>

      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="env-signal" className="mt-12">
        <h2 id="env-signal" className="text-xl font-semibold">
          1 · Environment signal — derivation and anti-spoofing
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          A persistent, always-visible environment signal distinguishes sandbox from
          production, derived exclusively from explicit configuration (UX contract Section
          10). This is the only chain that sets it:
        </p>
        <ol className="mt-4 max-w-3xl list-decimal space-y-2 pl-5 text-sm text-stone-700">
          <li>
            <span className="font-semibold">Configuration:</span> the deployment sets the
            server-side variable <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">PAYSWAP_ENV</code>{' '}
            before build/start. URL parameters, user content, and client state do not
            participate.
          </li>
          <li>
            <span className="font-semibold">Validation:</span> exact allowlist — the values
            sandbox and production.
          </li>
          <li>
            <span className="font-semibold">Fail-safe:</span> unset or invalid resolves to
            sandbox. Production framing appears only when configuration explicitly says
            production, so sandbox execution can never read as production execution (N4).
          </li>
          <li>
            <span className="font-semibold">Resolution:</span> the server root layout (
            <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">
              src/app/layout.tsx
            </code>
            ) resolves the signal once per render and passes it to the banner as a prop.
          </li>
          <li>
            <span className="font-semibold">Presentation:</span> the banner is a server
            component pinned to the top of every route. No control anywhere re-labels the
            environment.
          </li>
        </ol>
        <div
          role="note"
          aria-label="Current environment classification"
          className="mt-4 max-w-3xl rounded-xl border border-stone-300 bg-white p-4"
        >
          <p className="text-sm">
            <span className="font-semibold">Current classification: </span>
            {environment.configuredValue} → resolved{' '}
            <span className="font-semibold">{environment.kind}</span>
          </p>
          <p className="mt-1 text-xs text-stone-500">
            Source: {environment.source}. This page is a server component that re-derives
            the value from the same module the layout uses — there is exactly one derivation
            path. Raw configuration values are never echoed; only this classified summary
            renders.
          </p>
        </div>
        <div className="mt-4 max-w-3xl">
          <Suspense
            fallback={
              <p className="text-sm text-stone-500">Loading environment probe.</p>
            }
          >
            <EnvironmentSpoofProbe />
          </Suspense>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section id="state-matrix" aria-labelledby="state-matrix-heading" className="mt-12">
        <h2 id="state-matrix-heading" className="text-xl font-semibold">
          2 · State primitive matrix
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          Every stateful rendering resolves to exactly one of six explicit display states
          (P4). Each primitive is visually and semantically distinct — its own icon shape,
          border style, tint, and label word; color never carries the distinction alone
          (P5, P9). Each card below is deep-linkable (for example{' '}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">
            #state-unknown
          </code>
          ), and every state shown is a demonstration fixture.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <section id="state-succeeded" aria-labelledby="state-succeeded-heading">
            <h3 id="state-succeeded-heading" className="text-sm font-semibold">
              SUCCEEDED — authority-reported success
            </h3>
            <p className="mt-1 mb-2 text-xs text-stone-500">
              The owning authority reports a terminal successful outcome; wording comes from
              the authority and an evidence link is mandatory (P7).
            </p>
            <SucceededState
              outcome="The reference operation completed successfully, as reported by the demonstration authority."
              reportedBy="Demonstration authority"
              evidence={{
                label: 'View the evidence record (demonstration)',
                href: '#state-succeeded',
              }}
            />
          </section>
          <section id="state-failed" aria-labelledby="state-failed-heading">
            <h3 id="state-failed-heading" className="text-sm font-semibold">
              FAILED — authority-reported failure
            </h3>
            <p className="mt-1 mb-2 text-xs text-stone-500">
              Only an authority-reported terminal failure renders this. A failed fetch
              renders Unknown instead (see the availability case below).
            </p>
            <FailedState
              outcome="The reference operation failed, as reported by the demonstration authority."
              reportedBy="Demonstration authority"
              reason="The demonstration authority reported a rejected precondition."
              nextActions={[
                'Inspect the evidence record',
                'Start a new reference operation (when authorized)',
              ]}
            />
          </section>
          <section id="state-unknown" aria-labelledby="state-unknown-heading">
            <h3 id="state-unknown-heading" className="text-sm font-semibold">
              UNKNOWN — no authoritative answer
            </h3>
            <p className="mt-1 mb-2 text-xs text-stone-500">
              Distinct label, distinct visual (dashed amber frame, question icon), plain
              language, and a reconciliation path where known — never styled or worded as
              success or failure (P5).
            </p>
            <UnknownState
              subject="The current state of the reference operation is unknown."
              explanation="No authoritative answer is currently available, so the display state is Unknown. What is not yet known: whether the reference operation has completed, and with which outcome."
              reconciliation={{
                whoResolves:
                  'The demonstration authority, as the owner of the reference operation state',
                recheckTrigger:
                  'The next authoritative report, or a re-check once the owning surface ships',
              }}
            />
          </section>
          <section id="state-waiting" aria-labelledby="state-waiting-heading">
            <h3 id="state-waiting-heading" className="text-sm font-semibold">
              WAITING — with available actions
            </h3>
            <p className="mt-1 mb-2 text-xs text-stone-500">
              What is waiting, why (as reported by the owning authority), what happens next,
              and the available actions (P6).
            </p>
            <WaitingState
              whatIsWaiting="The reference operation is waiting."
              why="The demonstration authority reports the request is queued behind prior work."
              whatHappensNext="The authority processes the queue in order and reports the next state; the UI presents no invented timing estimates."
              reportedBy="Demonstration authority"
              availableActions={['Inspect the evidence record']}
            />
          </section>
          <section id="state-waiting-none" aria-labelledby="state-waiting-none-heading">
            <h3 id="state-waiting-none-heading" className="text-sm font-semibold">
              WAITING — no actions yet (explicit)
            </h3>
            <p className="mt-1 mb-2 text-xs text-stone-500">
              When no action is available, the primitive says so explicitly — a non-terminal
              state never dead-ends (P6).
            </p>
            <WaitingState
              whatIsWaiting="The reference operation is waiting."
              why="The demonstration authority reports a delay, with no user input requested."
              whatHappensNext="The authority resumes processing and reports the next state."
              reportedBy="Demonstration authority"
            />
          </section>
          <section id="state-in-progress" aria-labelledby="state-in-progress-heading">
            <h3 id="state-in-progress-heading" className="text-sm font-semibold">
              IN_PROGRESS — actively processing
            </h3>
            <p className="mt-1 mb-2 text-xs text-stone-500">
              What is happening, what completes it, and the reporting authority. The arc and
              strip are decorative motion, disabled under reduced motion — never a verdict
              (P4).
            </p>
            <InProgressState
              whatIsHappening="The demonstration authority is actively processing the reference operation."
              whatCompletesIt="Processing completes when the authority reports a terminal state; the UI never promotes a non-terminal state to terminal."
              reportedBy="Demonstration authority"
            />
          </section>
          <section id="state-action-required" aria-labelledby="state-action-required-heading">
            <h3 id="state-action-required-heading" className="text-sm font-semibold">
              ACTION_REQUIRED — user action needed
            </h3>
            <p className="mt-1 mb-2 text-xs text-stone-500">
              The action, the reporting authority, and validity or consequence of inaction
              only where the authority provides them — this fixture provides neither.
            </p>
            <ActionRequiredState
              action="Confirm the reference detail so the demonstration authority can continue."
              reportedBy="Demonstration authority"
            />
          </section>
          <section
            id="state-availability-unknown"
            aria-labelledby="state-availability-unknown-heading"
          >
            <h3 id="state-availability-unknown-heading" className="text-sm font-semibold">
              Fetch failure — renders UNKNOWN
            </h3>
            <p className="mt-1 mb-2 text-xs text-stone-500">
              Render conditions are distinct from outcomes (P4, P5): when the authoritative
              state cannot be retrieved, the display state is UNKNOWN — availability unknown —
              never a failure verdict.
            </p>
            <AvailabilityUnknownState
              target="the reference state service"
              detail="the retrieval request did not complete"
            />
          </section>
        </div>
        <div className="mt-6 rounded-xl border border-stone-300 bg-white p-4 sm:p-5">
          <h3 className="text-sm font-semibold">
            Side-by-side: outcome failure vs availability unknown
          </h3>
          <p className="mt-1 text-xs text-stone-500">
            The two cases stay visually and semantically distinct: a thick left-accent solid
            rose frame with an octagon-X (authority-reported failure) versus a dashed amber
            frame with a question icon (no authoritative answer).
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                If the authority reports failure
              </p>
              <FailedState
                outcome="The reference operation failed, as reported by the demonstration authority."
                reportedBy="Demonstration authority"
              />
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                What a failed fetch renders
              </p>
              <AvailabilityUnknownState target="the reference state service" />
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="transition-heading" className="mt-12">
        <h2 id="transition-heading" className="text-xl font-semibold">
          3 · State transitions announce accessibly
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          State transitions on consequential outcomes are announced through a persistent
          polite live region (P9, P4). The demonstration below cycles a fixture sequence:
          the primitive re-renders and the live region announces each change.
        </p>
        <div className="mt-4 max-w-2xl">
          <StateTransitionDemo />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="role-routing-heading" className="mt-12">
        <h2 id="role-routing-heading" className="text-xl font-semibold">
          4 · Role-routing matrix (P8)
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          Static proof for the five roles plus the unauthenticated viewer: each panel renders
          navigation through the same NavList component the live shell header and footer
          use. The matrix is static on purpose — the product ships no role-switching
          control, because role assignment is an authoritative input the UI never
          self-assigns, infers, or escalates. Unknown or unauthenticated visitors get least
          visibility.
        </p>
        <div className="mt-4">
          <RoleRoutingMatrix />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="grammar-heading" className="mt-12">
        <h2 id="grammar-heading" className="text-xl font-semibold">
          5 · Navigation grammar — rules and registry
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          One grammar for the whole product (P1), defined in{' '}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">
            src/lib/navigation.ts
          </code>{' '}
          and rendered through one shared component. The rules:
        </p>
        <ul className="mt-3 max-w-3xl list-disc space-y-2 pl-5 text-sm text-stone-700">
          {NAVIGATION_GRAMMAR_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        <p className="mt-4 max-w-3xl text-sm text-stone-600">
          The full registry — every entry, its reserved route, its audience gating, and its
          status:
        </p>
        <div className="ps-scroll mt-3 max-h-96 overflow-y-auto rounded-xl border border-stone-200 bg-white">
          <ul className="divide-y divide-stone-200">
            {NAVIGATION_ENTRIES.map((entry) => (
              <li key={entry.id} className="p-3 sm:p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs text-stone-800">
                    {entry.href}
                  </code>
                  <span className="text-sm font-medium">{entry.label}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      entry.status === 'available'
                        ? 'border-emerald-400 bg-emerald-100 text-emerald-900'
                        : 'border-stone-300 bg-stone-100 text-stone-600'
                    }`}
                  >
                    {entry.status === 'available' ? 'Available' : 'Planned'}
                  </span>
                  <span className="text-xs text-stone-500">
                    {entry.kind === 'primary' ? 'primary nav' : 'footer nav'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-stone-600">{entry.description}</p>
                <p className="mt-1 text-xs text-stone-600">
                  Visible to: {entry.audiences.map((a) => audienceLabel(a)).join(', ')}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="breakpoints-heading" className="mt-12">
        <h2 id="breakpoints-heading" className="text-xl font-semibold">
          6 · Shared breakpoint set (P10)
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          Defined once in the grammar and documented here; surfaces do not define divergent
          sets. The values mirror the Tailwind default scale used by the shell stylesheet.
        </p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {BREAKPOINTS.map((bp) => (
            <div
              key={bp.name}
              className="rounded-xl border border-stone-200 bg-stone-50 p-4"
            >
              <dt className="text-sm font-semibold">
                {bp.name} — {bp.minWidthPx}px and up
              </dt>
              <dd className="mt-1 text-xs text-stone-600">{bp.role}</dd>
            </div>
          ))}
        </dl>
        <ul className="mt-4 max-w-3xl list-disc space-y-1 pl-5 text-sm text-stone-700">
          <li>Touch targets are at least 44px (min-h-11) on every interactive element.</li>
          <li>No layout scrolls horizontally at any supported width.</li>
          <li>Behavior parity: every action available on small viewports.</li>
          <li>Dense presentations degrade to readable stacked forms, not truncation.</li>
        </ul>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="a11y-heading" className="mt-12">
        <h2 id="a11y-heading" className="text-xl font-semibold">
          7 · Accessibility baseline (P9)
        </h2>
        <ul className="mt-3 max-w-3xl list-disc space-y-1 pl-5 text-sm text-stone-700">
          <li>Semantic landmarks: header, nav, main, footer; skip link to main content.</li>
          <li>Full keyboard operability with a visible 3px focus outline on all controls.</li>
          <li>Labels on all controls; icons are aria-hidden decoration, never sole content.</li>
          <li>State is never signaled by color alone — icon shape, border style, and label word always accompany color.</li>
          <li>State transitions are announced through a persistent polite live region; FAILED and ACTION_REQUIRED render assertive alerts.</li>
          <li>Reduced-motion support: decorative animations stop under prefers-reduced-motion.</li>
          <li>
            Baseline standard: WCAG 2.2 level AA (assumption-flagged per the UX contract;
            tool-backed evidence lands at UI-009 and rolls up at UI-010).
          </li>
        </ul>
      </section>

      <p className="mt-12">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-lg border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 transition-colors hover:bg-stone-100"
        >
          Return to the shell home
        </Link>
      </p>
    </div>
  );
}
