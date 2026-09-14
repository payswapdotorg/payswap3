/**
 * PC-004 — Operations health views (modules console.operations.*).
 *
 * Composed EXCLUSIVELY from the PC-003 operations-health read model
 * (`readConsoleOperationsHealth`): the fail-closed nine-domain component
 * health probe — the SAME composition point /api/ready enriches through.
 * The domain vocabulary and per-domain states render VERBATIM (the frozen
 * observability taxonomy: ok | degraded | unknown-data | down), and the
 * documented projection onto the six statuses arrives already resolved in
 * the DTO. Nothing is recomputed, aggregated beyond the authority's own
 * worst-of rollup, or invented.
 *
 * Read-mostly (design §12): every operations page renders its own domain's
 * authoritative health plus the full taxonomy — and an HONEST GAP panel for
 * the module-specific telemetry that has NO exposed read at this baseline
 * (queue-depth listings, job listings, reconciliation records, UNKNOWN-case
 * listings, clearing/netting progression, incident records). The taxonomy
 * vocabulary is preserved; missing telemetry is never fabricated.
 */

import type { ReactNode } from 'react';
import { findConsoleRoute } from '@/lib/console/registry';
import type { ConsoleReadResult, ConsoleStatus } from '@/lib/console/types';
import type { ConsoleOperationsHealthDto } from '@/lib/console/read-models/operations-health';
import { ConsoleStatusPresentation, ConsoleAuthorityLine } from '@/components/console';
import { ConsoleReadResultView } from './console-read-result';
import { formatConsoleEpochMs } from './view-format';

type HealthDomainDto = ConsoleOperationsHealthDto['domains'][number];

/**
 * The observability domain each operations module surfaces (frozen taxonomy
 * ids — presentation mapping only; the domain vocabulary itself belongs to
 * the taxonomy module the read model already carries).
 */
export const OPERATIONS_MODULE_DOMAIN: Readonly<Record<string, string>> = {
  'console.operations.queues': 'queue',
  'console.operations.execution': 'execution',
  'console.operations.reconciliation': 'reconciliation',
  'console.operations.unknown': 'unknown',
  'console.operations.clearing-netting': 'clearing-netting',
  'console.operations.incidents': 'incident-recovery',
};

/** The module-specific telemetry that has no exposed read at this baseline. */
export const OPERATIONS_MODULE_GAP: Readonly<Record<string, string>> = {
  'console.operations.queues':
    'no queue-depth or worker listing read is exposed — the console does not enumerate queues or workers',
  'console.operations.execution':
    'no durable-job listing read is exposed — the console does not enumerate executions',
  'console.operations.reconciliation':
    'no reconciliation-record listing read is exposed — the console does not enumerate reconciliation runs',
  'console.operations.unknown':
    'no UNKNOWN-case listing read is exposed — the console does not enumerate unresolved cases (recovery context stays per-reference on payment detail)',
  'console.operations.clearing-netting':
    'no clearing/netting progression read is exposed — the console does not enumerate clearing or netting records',
  'console.operations.incidents':
    'no incident-record listing read is exposed — the console does not enumerate incidents',
};

function DomainItemView({ domain, highlighted }: { readonly domain: HealthDomainDto; readonly highlighted: boolean }) {
  return (
    <li
      data-console-health-domain={domain.domain}
      className={`min-w-0 rounded-xl border bg-white p-4 ${
        highlighted ? 'border-stone-400 ring-1 ring-stone-300' : 'border-stone-300'
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <ConsoleStatusPresentation status={domain.displayStatus} subject={`the ${domain.domain} health domain`} />
        <code className="rounded bg-stone-100 px-1 py-0.5 text-xs" data-testid="console-health-domain-state">
          {domain.state}
        </code>
        {highlighted && (
          <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">this module's domain</span>
        )}
      </div>
      {domain.action !== undefined && (
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-stone-600 sm:grid-cols-3">
          <div className="flex flex-wrap gap-x-1">
            <dt className="font-medium">What to inspect:</dt>
            <dd>{domain.action.whatToInspect}</dd>
          </div>
          <div className="flex flex-wrap gap-x-1">
            <dt className="font-medium">Drill:</dt>
            <dd>{domain.action.drill}</dd>
          </div>
          <div className="flex flex-wrap gap-x-1">
            <dt className="font-medium">Runbook:</dt>
            <dd>{domain.action.runbookSection}</dd>
          </div>
        </dl>
      )}
      {domain.action === undefined && (
        <p className="mt-2 text-xs text-stone-500">
          No required action — the health authority reports this domain ok.
        </p>
      )}
    </li>
  );
}

function HealthHeaderFactsView({ value }: { readonly value: ConsoleOperationsHealthDto }) {
  return (
    <div className="mt-2 max-w-3xl rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
      <p>
        <span className="font-semibold">Composite facts (the probe's own, verbatim): </span>
        worst-of rollup <code className="rounded bg-stone-100 px-1 py-0.5">{value.overall}</code> ·
        readiness <code className="rounded bg-stone-100 px-1 py-0.5">{value.readiness}</code> ·
        generated {formatConsoleEpochMs(value.generatedAt)}.
      </p>
      <p className="mt-1">
        Observation only: this telemetry is never translated into a business verdict and
        never serves as financial evidence — the projection onto the six statuses above is
        the documented deterministic mapping the read model carries.
      </p>
      {value.probeError !== undefined && (
        <p className="mt-1" data-testid="console-health-probe-error">
          <span className="font-semibold">Probe error (fail-closed, named by the authority): </span>
          {value.probeError}
        </p>
      )}
    </div>
  );
}

export interface ConsoleOperationsHealthSummaryViewProps {
  /** The operations-health read-model envelope (PC-003). */
  readonly result: ConsoleReadResult<ConsoleOperationsHealthDto>;
}

/**
 * The compact health summary for the console Overview (operator-scoped there
 * by the owning page — the six operations modules are operator-only in the
 * frozen route-role matrix, so the overview composes this summary only for
 * the operator role and states that scoping honestly for everyone else).
 */
export function ConsoleOperationsHealthSummaryView({
  result,
}: ConsoleOperationsHealthSummaryViewProps): ReactNode {
  return (
    <ConsoleReadResultView
      result={result}
      subject="operations health"
      renderValue={(value: ConsoleOperationsHealthDto, status: ConsoleStatus, authority) => (
        <section data-console-view="operations-health-summary" aria-labelledby="console-operations-health-heading" className="min-w-0">
          <h2 id="console-operations-health-heading" className="text-lg font-semibold">
            Operations health — the health authority's composite answer
          </h2>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-2">
            <ConsoleStatusPresentation status={status} subject="overall operations health" />
            <span className="text-sm text-stone-600">
              overall <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">{value.overall}</code>
              <span className="text-xs text-stone-500"> · readiness {value.readiness}</span>
            </span>
          </div>
          <HealthHeaderFactsView value={value} />
          <ul className="mt-4 flex flex-col gap-2">
            {value.domains.map((domain) => (
              <li key={domain.domain} data-console-health-domain={domain.domain} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                <ConsoleStatusPresentation status={domain.displayStatus} subject={`the ${domain.domain} health domain`} />
                <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">{domain.domain}</code>
                <span className="text-xs text-stone-500">{domain.state}</span>
              </li>
            ))}
          </ul>
          <footer className="mt-4 border-t border-stone-200 pt-3">
            <ConsoleAuthorityLine
              owningAuthority={authority.owningAuthority}
              runtimeBoundary={authority.runtimeBoundary}
              durableSource={authority.durableSource}
              evidenceReference={authority.evidenceReference}
            />
          </footer>
        </section>
      )}
    />
  );
}

export interface ConsoleOperationsDomainViewProps {
  /** The operations-health read-model envelope (PC-003). */
  readonly result: ConsoleReadResult<ConsoleOperationsHealthDto>;
  /** The owning page's own route path (module id resolved through the frozen registry). */
  readonly href: string;
}

/**
 * One operations module view: the module's own domain highlighted, the full
 * nine-domain taxonomy, and the honest gap panel for the module-specific
 * telemetry that has no exposed read at this baseline.
 */
export function ConsoleOperationsDomainView({
  result,
  href,
}: ConsoleOperationsDomainViewProps): ReactNode {
  // Module id resolved through the ONE frozen registry (single source).
  const moduleId = findConsoleRoute(href)?.id;
  const domainId = moduleId !== undefined ? OPERATIONS_MODULE_DOMAIN[moduleId] : undefined;
  const gap = moduleId !== undefined ? OPERATIONS_MODULE_GAP[moduleId] : undefined;
  return (
    <ConsoleReadResultView
      result={result}
      subject={`the ${moduleId ?? href} operational view`}
      renderValue={(value: ConsoleOperationsHealthDto, status: ConsoleStatus, authority) => (
        <section data-console-view="operations-domain" data-console-module-id={moduleId ?? 'unknown'} className="min-w-0">
          <h2 id="console-operations-domain-heading" className="text-lg font-semibold">
            This module's authoritative health domain
          </h2>
          {domainId === undefined ? (
            <p className="mt-2 max-w-3xl text-sm text-stone-600">
              No domain mapping is recorded for this module — a wiring gap in the view,
              not a health verdict. The full taxonomy below is still the authority's own
              composite answer.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {value.domains
                .filter((domain) => domain.domain === domainId)
                .map((domain) => (
                  <DomainItemView key={domain.domain} domain={domain} highlighted />
                ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-stone-500">
            Overall composite (the authority's own worst-of rollup):{' '}
            <code className="rounded bg-stone-100 px-1 py-0.5">{value.overall}</code> →{' '}
            <ConsoleStatusPresentation status={status} subject="overall operations health" />
          </p>

          <section aria-labelledby="console-operations-taxonomy" className="mt-6">
            <h3 id="console-operations-taxonomy" className="text-base font-semibold">
              Full domain taxonomy (frozen vocabulary, verbatim states)
            </h3>
            <HealthHeaderFactsView value={value} />
            <ul className="mt-3 flex flex-col gap-3">
              {value.domains.map((domain) => (
                <DomainItemView key={domain.domain} domain={domain} highlighted={domain.domain === domainId} />
              ))}
            </ul>
          </section>

          <section aria-labelledby="console-operations-gap" className="mt-6">
            <h3 id="console-operations-gap" className="text-base font-semibold">
              What this module does not have at this baseline
            </h3>
            <p className="mt-2 max-w-3xl rounded-xl border-2 border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-700" data-testid="console-operations-gap">
              {gap ??
                'No module-specific telemetry beyond the domain health above is exposed at this baseline.'}{' '}
              The domain health above is the authoritative telemetry available through the
              operations-health read model; everything else stays an honest gap — the
              taxonomy vocabulary is preserved and nothing is invented.
            </p>
          </section>

          <footer className="mt-6 border-t border-stone-200 pt-4">
            <ConsoleAuthorityLine
              owningAuthority={authority.owningAuthority}
              runtimeBoundary={authority.runtimeBoundary}
              durableSource={authority.durableSource}
              evidenceReference={authority.evidenceReference}
            />
          </footer>
        </section>
      )}
    />
  );
}
