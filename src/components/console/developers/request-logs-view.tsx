/**
 * PC-005 — Request logs view (module console.developers.logs).
 *
 * Renders EXCLUSIVELY the PC-005 request-log read model's envelope — the
 * bounded in-memory diagnostic ring, redacted BEFORE storage. Honesty rules
 * encoded here (design §11):
 *
 *   - an EMPTY ring is the honest VALUE "no entries recorded yet" — the
 *     recorded PC-003 gap closed with an honest empty value, never a
 *     fabricated record;
 *   - every entry carries the diagnostic-not-evidence label, and the page
 *     renders the redaction provenance (scrubCredentialReferences at
 *     ingestion) so a viewer knows WHY the payload is already redacted;
 *   - the capacity bound is stated (older entries drop at capacity);
 *   - entries render the SCRUBBED payload only — the unredacted form was
 *     never stored, so no code path can render it.
 */

import type { ReactNode } from 'react';
import type { ConsoleReadResult } from '@/lib/console/types';
import type { ConsoleDeveloperRequestLogsDto, ConsoleDeveloperRequestEntryDto } from '@/lib/console/developers/read-models';
import { ConsoleAuthorityLine } from '@/components/console';
import { ConsoleReadResultView } from '@/components/console/views/console-read-result';
import { formatConsoleEpochMs } from '@/components/console/views/view-format';
import { DeveloperProvenanceNote } from './developer-provenance-note';

function renderData(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2) ?? 'null';
  } catch {
    return '[non-serializable payload]';
  }
}

function EntryItemView({ entry }: { readonly entry: ConsoleDeveloperRequestEntryDto }): ReactNode {
  return (
    <li
      data-console-developer-log-entry={entry.id}
      className="rounded-xl border border-stone-300 bg-white p-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          data-console-log-level={entry.level}
          className="inline-flex min-h-6 items-center rounded-lg border px-2 py-0.5 text-xs font-semibold"
        >
          {entry.level}
        </span>
        <code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">{entry.event}</code>
        <span className="text-xs text-stone-500">{formatConsoleEpochMs(entry.wallMs)}</span>
      </div>
      <dl className="mt-2 grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-stone-600">Method:</dt>
          <dd>{entry.method}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-stone-600">Path:</dt>
          <dd><code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">{entry.path}</code></dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-stone-600">Status:</dt>
          <dd data-testid="console-log-entry-status">{entry.status}</dd>
        </div>
        {entry.traceId !== undefined && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-stone-600">Trace:</dt>
            <dd><code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">{entry.traceId}</code></dd>
          </div>
        )}
      </dl>
      <details className="mt-2">
        <summary className="min-h-11 cursor-pointer select-none text-sm font-medium text-stone-700">
          Payload (already redacted before storage)
        </summary>
        <pre
          data-testid="console-log-entry-data"
          className="mt-2 max-w-full overflow-x-auto rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs leading-relaxed text-stone-800"
        >
          {renderData(entry.data)}
        </pre>
      </details>
    </li>
  );
}

export interface ConsoleDeveloperRequestLogsViewProps {
  readonly result: ConsoleReadResult<ConsoleDeveloperRequestLogsDto>;
}

export function ConsoleDeveloperRequestLogsView({
  result,
}: ConsoleDeveloperRequestLogsViewProps): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-6" data-console-view="developer-logs">
      <DeveloperProvenanceNote subject="Request logs" diagnostic />
      <ConsoleReadResultView
        result={result}
        subject="the diagnostic request log"
        renderValue={(value, _status, authority) => (
          <>
            <section aria-labelledby="logs-coverage-heading" className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6">
              <h2 id="logs-coverage-heading" className="text-lg font-semibold text-stone-900">
                Coverage and redaction
              </h2>
              <dl className="mt-2 grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-stone-600">Ingestion:</dt>
                  <dd>the PC-005 console API boundary paths (the credential boundary routes log every request, payload-free)</dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-stone-600">Redaction:</dt>
                  <dd data-testid="console-logs-redaction">{value.redaction}</dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-stone-600">Buffered now:</dt>
                  <dd data-testid="console-logs-recorded">{value.recorded}</dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-stone-600">Bound:</dt>
                  <dd>{value.capacity} entries (oldest drop at capacity) — newest first below</dd>
                </div>
              </dl>
            </section>
            <section aria-labelledby="logs-list-heading" className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6">
              <h2 id="logs-list-heading" className="text-lg font-semibold text-stone-900">
                Entries
              </h2>
              {value.entries.length === 0 ? (
                <p className="mt-2 max-w-3xl text-sm text-stone-600" data-testid="console-logs-empty-value">
                  No entries recorded yet — the honest empty answer of the diagnostic ring. It fills
                  as traffic crosses the console API boundary (for example, create or list an API
                  key); it starts empty on every restart.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {value.entries.map((entry) => (
                    <EntryItemView key={entry.id} entry={entry} />
                  ))}
                </ul>
              )}
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
