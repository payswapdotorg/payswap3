/**
 * PC-005 — Request inspector view (module console.developers.request-inspector).
 *
 * A query view over the SAME in-memory ring the logs surface reads:
 *   - server-side filtering by path and status through the page's own
 *     searchParams (a GET form — presentation filtering only: no request
 *     value can affect role or environment);
 *   - per-entry detail with the FULL redaction guarantee: the payload
 *     rendered here is the stored (already-redacted) form — the unredacted
 *     payload was never stored, so there is nothing to leak;
 *   - NO export: there is no export button, link, or download on this
 *     surface by design (no secret-bearing output ever leaves it), and the
 *     page says so explicitly;
 *   - an empty result set is the honest VALUE for the active filters.
 */

import type { ReactNode } from 'react';
import type { ConsoleReadResult } from '@/lib/console/types';
import type { ConsoleDeveloperRequestInspectorDto, ConsoleDeveloperRequestEntryDto } from '@/lib/console/developers/read-models';
import { ConsoleAuthorityLine } from '@/components/console';
import { ConsoleReadResultView } from '@/components/console/views/console-read-result';
import { formatConsoleEpochMs } from '@/components/console/views/view-format';
import { DeveloperProvenanceNote } from './developer-provenance-note';

const PAGE_HREF = '/console/developers/request-inspector';

function renderData(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2) ?? 'null';
  } catch {
    return '[non-serializable payload]';
  }
}

function InspectorFilterFormView({
  filter,
}: {
  readonly filter: ConsoleDeveloperRequestInspectorDto['filter'];
}): ReactNode {
  return (
    <section aria-labelledby="inspector-filter-heading" className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6">
      <h2 id="inspector-filter-heading" className="text-lg font-semibold text-stone-900">
        Filters
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-stone-600">
        Server-side presentation filtering over the diagnostic ring — filters narrow what is
        displayed; they never touch authorization or environment.
      </p>
      <form method="get" action={PAGE_HREF} className="mt-4 flex max-w-2xl flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="inspector-path" className="block text-sm font-medium text-stone-700">
            Exact path
          </label>
          <input
            id="inspector-path"
            name="path"
            type="text"
            defaultValue={filter.path ?? ''}
            autoComplete="off"
            className="mt-1 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
            placeholder="/api/console/developers/api-keys"
          />
        </div>
        <div className="w-32">
          <label htmlFor="inspector-status" className="block text-sm font-medium text-stone-700">
            Status
          </label>
          <input
            id="inspector-status"
            name="status"
            type="number"
            min={100}
            max={599}
            defaultValue={filter.status === undefined ? '' : String(filter.status)}
            autoComplete="off"
            className="mt-1 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
            placeholder="e.g. 404"
          />
        </div>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
        >
          Apply filters
        </button>
      </form>
    </section>
  );
}

function InspectorEntryView({ entry }: { readonly entry: ConsoleDeveloperRequestEntryDto }): ReactNode {
  return (
    <li data-console-inspector-entry={entry.id} className="rounded-xl border border-stone-300 bg-white p-4">
      <details open={false}>
        <summary className="flex min-h-11 cursor-pointer select-none flex-wrap items-baseline gap-x-3 gap-y-1">
          <span data-console-log-level={entry.level} className="inline-flex min-h-6 items-center rounded-lg border px-2 py-0.5 text-xs font-semibold">
            {entry.level}
          </span>
          <code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">{entry.event}</code>
          <span className="text-xs text-stone-500">
            {entry.method} {entry.path} → <span data-testid="console-inspector-entry-status">{entry.status}</span> · {formatConsoleEpochMs(entry.wallMs)}
          </span>
        </summary>
        <dl className="mt-2 grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-stone-600">Entry id:</dt>
            <dd>{entry.id}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-stone-600">Trace:</dt>
            <dd>{entry.traceId ?? '— none recorded —'}</dd>
          </div>
        </dl>
        <pre
          data-testid="console-inspector-entry-data"
          className="mt-2 max-w-full overflow-x-auto rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs leading-relaxed text-stone-800"
        >
          {renderData(entry.data)}
        </pre>
      </details>
    </li>
  );
}

export interface ConsoleDeveloperRequestInspectorViewProps {
  readonly result: ConsoleReadResult<ConsoleDeveloperRequestInspectorDto>;
}

export function ConsoleDeveloperRequestInspectorView({
  result,
}: ConsoleDeveloperRequestInspectorViewProps): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-6" data-console-view="developer-request-inspector">
      <DeveloperProvenanceNote subject="Request inspector" diagnostic />
      <ConsoleReadResultView
        result={result}
        subject="the filtered diagnostic ring"
        renderValue={(value, _status, authority) => (
          <>
            <InspectorFilterFormView filter={value.filter} />
            <section aria-labelledby="inspector-list-heading" className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6">
              <h2 id="inspector-list-heading" className="text-lg font-semibold text-stone-900">
                Entries{value.filter.path !== undefined || value.filter.status !== undefined ? ' (filtered)' : ''}
              </h2>
              {value.entries.length === 0 ? (
                <p className="mt-2 max-w-3xl text-sm text-stone-600" data-testid="console-inspector-empty-value">
                  No entries{value.filter.path !== undefined || value.filter.status !== undefined
                    ? ' match the active filters'
                    : ' recorded yet'} — the honest empty answer of the diagnostic ring for this view
                  ({value.recorded} entries buffered in total).
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {value.entries.map((entry) => (
                    <InspectorEntryView key={entry.id} entry={entry} />
                  ))}
                </ul>
              )}
            </section>
            <p
              data-testid="console-inspector-no-export"
              className="rounded-xl border-2 border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-700"
            >
              No export exists on this surface by design: entries and their payloads stay in this
              page (diagnostic, redacted, in-memory) — no secret-bearing output ever leaves it, and
              there is no download, copy-all, or dump affordance to add.
            </p>
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
