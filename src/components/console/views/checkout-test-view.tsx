/**
 * PC-004 — Checkout test view (module console.checkout.test).
 *
 * Design §10: "A test checkout MUST use the existing command/runtime path and
 * MUST NOT introduce a console-local payment simulator that masquerades as
 * protocol execution." This view composes NO simulator and executes NO
 * payment: it presents the server-derived environment signal (sandbox vs
 * production — server-configuration-derived only, never user-selected) and
 * inventories the EXISTING sanctioned execution paths the repository
 * actually offers, linking to them:
 *
 *   - the customer payment flow (/pay → /pay/review): outcome-first
 *     composition, authority-quoted consequence terms, and an explicit
 *     single-intent submit through the intent port — the real protocol path;
 *   - the merchant checkout surface (/checkout): authority-presented offers
 *     with explicit accept/decline decisions;
 *   - the protocol command HTTP boundary (/api/protocol/commands): the
 *     composed runtime's sole admission point (POST a kernel command
 *     envelope; GET the recorded-receipt lookup). The console documents this
 *     boundary and NEVER fabricates command envelopes itself — constructing
 *     protocol commands is protocol-kernel territory.
 *
 * Deep links into those surfaces are themselves role-gated by the existing
 * product guards, so linking is safe composition, not a bypass.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ConsoleEnvironmentContext } from '@/lib/console/types';
import { ConsoleAuthorityLine } from '@/components/console';

interface ExecutionPath {
  readonly title: string;
  readonly audience: string;
  readonly href: string;
  readonly whatItDoes: string;
}

const EXECUTION_PATHS: readonly ExecutionPath[] = [
  {
    title: 'Customer payment flow',
    audience: 'customer',
    href: '/pay',
    whatItDoes:
      'Compose a payment outcome-first, review the authority-quoted consequence terms, then submit explicitly through the intent port — the real protocol admission path, never a console simulation.',
  },
  {
    title: 'Merchant checkout surface',
    audience: 'merchant',
    href: '/checkout',
    whatItDoes:
      'Review authority-presented offers with full consequences and take an explicit accept/decline decision through the checkout boundary.',
  },
];

const COMMAND_BOUNDARY_FACTS: readonly string[] = [
  'POST /api/protocol/commands — the sole admission point for protocol commands: forwards a kernel command envelope verbatim (kind, authority, subjectIds, idempotencyKey, protocolTime, body) through the gateway, returning its typed admission result.',
  'GET /api/protocol/commands?kind=<kind>&idempotencyKey=<key> — the read-only recorded-receipt lookup (idempotent re-submission answers with the same receipt; no second effect).',
  'The console links to and documents this boundary; it never constructs command envelopes. Building protocol commands is protocol-kernel territory, not a console view.',
];

export interface ConsoleCheckoutTestViewProps {
  /** The server-derived environment context (PC-001; takes no input). */
  readonly environment: ConsoleEnvironmentContext;
}

/** The honest checkout-test surface: environment + existing execution paths. */
export function ConsoleCheckoutTestView({ environment }: ConsoleCheckoutTestViewProps): ReactNode {
  const sandbox = environment.kind === 'sandbox';
  return (
    <section data-console-view="checkout-test" aria-labelledby="console-checkout-test-heading" className="min-w-0">
      <h2 id="console-checkout-test-heading" className="text-lg font-semibold">
        Test checkout — through the existing protocol paths only
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-stone-600">
        This console module composes <span className="font-semibold">no local checkout
        simulator</span>: nothing on this page executes, fakes, or replays a payment.
        Test execution happens through the existing product/protocol boundaries below,
        and the environment signal governing them is derived server-side from
        configuration — a URL, a cookie, or any client state can never select it.
      </p>

      <div
        role="note"
        aria-label={`Checkout test environment: ${environment.kind}`}
        data-testid="console-checkout-test-environment"
        className={`mt-4 max-w-3xl rounded-xl border p-4 ${
          sandbox
            ? 'border-amber-300 bg-amber-50 text-amber-900'
            : 'border-stone-300 bg-stone-100 text-stone-800'
        }`}
      >
        <p className="text-sm font-semibold">
          Environment: {environment.kind}
          <span className="font-normal">
            {' '}
            (configured value {environment.configuredValue} · source {environment.source} ·
            derived by {environment.derivedBy} configuration only)
          </span>
        </p>
        <p className="mt-1 text-xs">
          {sandbox
            ? 'Sandbox: every path below executes against the sandbox runtime composition. The console clearly separates this from production execution — nothing on this page claims production wiring.'
            : 'Production configuration is active: the paths below execute against the configured runtime. The signal is server-derived; client input cannot switch it.'}
        </p>
        <p className="mt-1 text-xs">
          Startup configuration validation for {environment.startupConfiguration.env}:{' '}
          {environment.startupConfiguration.ok ? 'ok' : 'not ok'} (
          {environment.startupConfiguration.checks.length} checks — ids only, values are
          never rendered).
        </p>
      </div>

      <section aria-labelledby="console-checkout-test-paths" className="mt-6">
        <h3 id="console-checkout-test-paths" className="text-base font-semibold">
          Existing sanctioned execution paths
        </h3>
        <ul className="mt-3 flex flex-col gap-3">
          {EXECUTION_PATHS.map((path) => (
            <li key={path.href} className="max-w-3xl rounded-xl border border-stone-300 bg-white p-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="font-medium">{path.title}</p>
                <span className="text-xs text-stone-500">audience: {path.audience}</span>
              </div>
              <p className="mt-1 text-sm text-stone-600">{path.whatItDoes}</p>
              <Link
                href={path.href}
                className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-stone-300 px-3 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-900"
              >
                Open the {path.title.toLowerCase()}
              </Link>
              <p className="mt-1 text-xs text-stone-500">
                The product surface enforces its own role guard on entry — the link is
                safe composition, not a bypass.
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="console-checkout-test-command-boundary" className="mt-6">
        <h3 id="console-checkout-test-command-boundary" className="text-base font-semibold">
          The protocol command boundary (documented, not driven from here)
        </h3>
        <ul className="mt-3 max-w-3xl list-disc space-y-1 pl-5 text-sm text-stone-600">
          {COMMAND_BOUNDARY_FACTS.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      </section>

      <footer className="mt-8 border-t border-stone-200 pt-4">
        <ConsoleAuthorityLine
          owningAuthority="Server-derived environment context (PC-001, src/lib/console/environment-context.ts — wraps the frozen environment chain) · existing product pay/checkout surfaces and the protocol command HTTP boundary"
          runtimeBoundary="this view composes links and documentation only — it invokes no protocol code and invents no simulator"
          durableSource="none — no financial read or write occurs on this page"
          evidenceReference="design §10 (checkout/test surface) · spec/console/route-role-matrix.md (console.checkout.test) · spec/console/PC-004-evidence.md"
        />
      </footer>
    </section>
  );
}
