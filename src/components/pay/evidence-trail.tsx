import { FileClock } from 'lucide-react';
import type { IntentEvidenceRecord } from '@/lib/protocol/intent-port';
import { formatTimestamp } from '@/lib/pay-flow/money';

/**
 * Evidence trail (UI-002, P7). Presented, never fabricated: every record,
 * time, and authority string comes from the port's snapshot. Each record
 * is inspectable — its details are one deliberate step away (native
 * details/summary, keyboard-accessible), while the record's summary and
 * time stay visible.
 */
export function EvidenceTrail({ records }: { records: readonly IntentEvidenceRecord[] }) {
  if (records.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        The authority reported no evidence records for this state.
      </p>
    );
  }
  return (
    <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1" role="list">
      {records.map((record) => (
        <li key={record.id} className="rounded-md border bg-card">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-start gap-2.5 rounded-md p-3 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <FileClock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium leading-snug">{record.summary}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {formatTimestamp(record.at)} · {record.authority}
                </span>
              </span>
              <span
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-xs font-medium text-muted-foreground group-open:hidden"
              >
                Inspect
              </span>
              <span
                aria-hidden="true"
                className="mt-0.5 hidden shrink-0 text-xs font-medium text-muted-foreground group-open:inline"
              >
                Close
              </span>
            </summary>
            <div className="border-t px-3 py-2.5">
              <dl className="grid gap-1.5">
                {record.details.map((detail) => (
                  <div key={detail.label} className="grid gap-0.5 sm:grid-cols-[auto_1fr] sm:gap-3">
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {detail.label}
                    </dt>
                    <dd className="break-words text-xs leading-relaxed">{detail.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
