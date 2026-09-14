/**
 * PC-005 — Environments view (module console.developers.environments).
 *
 * A READ-ONLY presentation of the PC-001 server-derived environment
 * context: the resolved kind (sandbox | production), the classified
 * configuration summary, the derivation chain (quoted from the frozen
 * authority), and the startup configuration validation result (names
 * only, never values — DEP-002's S1–S5 secret boundary).
 *
 * NO ENVIRONMENT SWITCHING exists (design §2/§10, UX contract Section 10):
 * the environment signal is server-configuration-derived and read-only.
 * The view states that explicitly and renders no selector of any kind —
 * proven by tests that attempt to spoof an environment through the page's
 * own searchParams.
 */

import type { ReactNode } from 'react';
import type { ConsoleReadResult } from '@/lib/console/types';
import type { ConsoleDeveloperEnvironmentsDto } from '@/lib/console/developers/read-models';
import { ConsoleAuthorityLine } from '@/components/console';
import { ConsoleReadResultView } from '@/components/console/views/console-read-result';
import { DeveloperProvenanceNote } from './developer-provenance-note';

export interface ConsoleDeveloperEnvironmentsViewProps {
  readonly result: ConsoleReadResult<ConsoleDeveloperEnvironmentsDto>;
}

export function ConsoleDeveloperEnvironmentsView({
  result,
}: ConsoleDeveloperEnvironmentsViewProps): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-6" data-console-view="developer-environments">
      <DeveloperProvenanceNote subject="Environment context" />
      <ConsoleReadResultView
        result={result}
        subject="the server-derived environment context"
        renderValue={(value, _status, authority) => (
          <>
            <section
              aria-labelledby="environments-current-heading"
              className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6"
            >
              <h2 id="environments-current-heading" className="text-lg font-semibold text-stone-900">
                Current environment
              </h2>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-2">
                <span
                  data-testid="console-environment-kind"
                  className={`inline-flex min-h-7 items-center rounded-lg border px-3 py-1 text-sm font-semibold ${
                    value.context.kind === 'production'
                      ? 'border-red-300 bg-red-50 text-red-800'
                      : 'border-teal-300 bg-teal-50 text-teal-800'
                  }`}
                >
                  {value.context.kind}
                </span>
                <span className="text-sm text-stone-600">
                  derived by <span className="font-semibold">{value.context.derivedBy}</span> · configuration classified as{' '}
                  <span data-testid="console-environment-configured" className="font-semibold">{value.context.configuredValue}</span>
                </span>
              </div>
              <p className="mt-3 max-w-3xl text-sm text-stone-600">Source: {value.context.source}</p>
              <p
                data-testid="console-environment-no-switching"
                className="mt-3 max-w-3xl rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700"
              >
                {value.noSwitchingNote}
              </p>
            </section>
            <section aria-labelledby="environments-chain-heading" className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6">
              <h2 id="environments-chain-heading" className="text-lg font-semibold text-stone-900">
                Derivation chain (the only chain that sets the signal)
              </h2>
              <ol className="mt-3 max-w-3xl list-decimal space-y-2 pl-5 text-sm text-stone-700">
                {value.derivationChain.map((step) => (
                  <li key={step} data-testid="console-environment-chain-step">{step}</li>
                ))}
              </ol>
              <p className="mt-3 max-w-3xl text-sm text-stone-600">
                Sandbox is the fail-safe: unset or invalid configuration resolves to sandbox, so
                sandbox execution can never be presented as production execution. Developer
                credentials are created in this environment only (see API keys / webhooks).
              </p>
            </section>
            <section aria-labelledby="environments-startup-heading" className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6">
              <h2 id="environments-startup-heading" className="text-lg font-semibold text-stone-900">
                Startup configuration validation (names only, never values)
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-stone-600">
                The DEP-002 fail-closed per-environment check. In production, any missing required
                configuration name means NOT ok; sandbox requires nothing beyond the environment
                selection itself.
              </p>
              <p className="mt-2 text-sm">
                <span className="font-medium text-stone-700">Result for {value.context.startupConfiguration.env}: </span>
                <span
                  data-testid="console-environment-startup-ok"
                  className={value.context.startupConfiguration.ok ? 'font-semibold text-teal-700' : 'font-semibold text-red-700'}
                >
                  {value.context.startupConfiguration.ok ? 'ok' : 'NOT ok'}
                </span>
              </p>
              <ul className="mt-2 max-w-3xl list-disc space-y-1 pl-5 text-sm text-stone-700">
                {value.context.startupConfiguration.checks.map((check) => (
                  <li key={check.id}>
                    <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">{check.id}</code> —{' '}
                    <span className={check.ok ? 'text-teal-700' : 'text-red-700'}>{check.ok ? 'present' : 'missing'}</span>
                    <span className="text-stone-500"> ({check.detail})</span>
                  </li>
                ))}
              </ul>
            </section>
            <ConsoleAuthorityLine
              owningAuthority={authority.owningAuthority}
              runtimeBoundary={authority.runtimeBoundary}
              durableSource={authority.durableSource}
              evidenceReference={authority.evidenceReference}
            />
          </>
        )}
      />
    </div>
  );
}
