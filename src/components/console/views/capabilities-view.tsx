/**
 * PC-004 — Capabilities view (module console.capabilities).
 *
 * Composed EXCLUSIVELY from the PC-003 capabilities read model
 * (`readConsoleCapabilities`): the A03 Capability Authority's own sequenced
 * registry view, with the frozen two-axis display resolution already in the
 * DTO. Presentation only — availability is never re-derived, never inferred
 * from configuration, and the per-item availability-UNKNOWN discipline of
 * design §13 is preserved exactly: an item with no authoritative report
 * renders UNKNOWN (the absence of an answer), never "unavailable" as a
 * business verdict, never an outcome.
 */

import type { ReactNode } from 'react';
import type { ConsoleReadResult, ConsoleStatus } from '@/lib/console/types';
import type { ConsoleCapabilitiesDto } from '@/lib/console/read-models/capabilities';
import { ConsoleStatusPresentation, ConsoleAuthorityLine } from '@/components/console';
import { ConsoleReadResultView } from './console-read-result';
import { formatConsoleIsoTimestamp } from './view-format';

function CapabilityItemView({ capability }: { capability: ConsoleCapabilitiesDto['capabilities'][number] }) {
  return (
    <li data-console-capability={capability.capabilityId} className="min-w-0 rounded-xl border border-stone-300 bg-white p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <ConsoleStatusPresentation status={capability.displayStatus} subject={capability.name} />
        <p className="font-medium">{capability.name}</p>
        <span className="text-xs text-stone-500">{capability.category}</span>
      </div>
      <dl className="mt-2 grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-stone-600">Capability id:</dt>
          <dd>
            <code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">{capability.capabilityId}</code>
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-stone-600">Source availability:</dt>
          <dd>
            <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">{capability.sourceAvailability}</code>
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-stone-600">Authority state:</dt>
          <dd>
            {capability.authorityState !== undefined ? (
              <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">{capability.authorityState}</code>
            ) : (
              <span className="text-xs text-stone-500">
                no authoritative report — availability is UNKNOWN, never inferred
              </span>
            )}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-stone-600">Reported:</dt>
          <dd>
            {capability.reportedAt !== undefined ? (
              <>
                {formatConsoleIsoTimestamp(capability.reportedAt)}
                {capability.reportedBy !== undefined ? (
                  <span className="text-xs text-stone-500"> · by {capability.reportedBy}</span>
                ) : null}
              </>
            ) : (
              <span className="text-xs text-stone-500">no report to quote</span>
            )}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2 sm:col-span-2">
          <dt className="font-medium text-stone-600">Mapping record:</dt>
          <dd className="text-xs text-stone-500">{capability.mappingRecord}</dd>
        </div>
        {capability.evidence !== undefined && (
          <div className="flex flex-wrap gap-x-2 sm:col-span-2">
            <dt className="font-medium text-stone-600">Evidence:</dt>
            <dd>
              <a
                href={capability.evidence.href}
                className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-stone-900"
              >
                {capability.evidence.label}
              </a>
            </dd>
          </div>
        )}
      </dl>
    </li>
  );
}

export interface ConsoleCapabilitiesViewProps {
  /** The capabilities read-model envelope (PC-003). */
  readonly result: ConsoleReadResult<ConsoleCapabilitiesDto>;
}

/** The composed capabilities registry view (two axes kept verbatim). */
export function ConsoleCapabilitiesView({ result }: ConsoleCapabilitiesViewProps): ReactNode {
  return (
    <ConsoleReadResultView
      result={result}
      subject="the capability registry"
      renderValue={(value: ConsoleCapabilitiesDto, _status: ConsoleStatus, authority) => (
        <section data-console-view="capabilities" aria-labelledby="console-capabilities-heading" className="min-w-0">
          <h2 id="console-capabilities-heading" className="text-lg font-semibold">
            Capabilities — as the capability authority reports them
          </h2>
          <div className="mt-2 max-w-3xl rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
            <p>
              <span className="font-semibold">Boundary facts (the authority's own, verbatim): </span>
              runtime {value.boundary.runtime} · backing {value.boundary.backing} ·{' '}
              authoritative {String(value.boundary.authoritative)} · owner{' '}
              {value.boundary.authorityOwner}.
            </p>
            <p className="mt-1">{value.boundary.notes}</p>
            <p className="mt-1">Registry view generated {formatConsoleIsoTimestamp(value.generatedAt)}.</p>
            <p className="mt-1">
              Two axes are kept exactly as reported: the capability state axis and the
              separate source-availability axis. An item with no authoritative report
              stays availability-UNKNOWN — availability is never inferred from
              configuration, routes, or registry entries.
            </p>
          </div>
          {value.capabilities.length === 0 ? (
            <p
              data-testid="console-capabilities-empty-value"
              className="mt-4 max-w-3xl rounded-xl border border-stone-300 bg-white p-4 text-sm text-stone-700"
            >
              The capability authority answered with an empty registry — a legitimate
              authoritative VALUE (the registry's real content), not an unavailable read.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {value.capabilities.map((capability) => (
                <CapabilityItemView key={capability.capabilityId} capability={capability} />
              ))}
            </ul>
          )}
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
