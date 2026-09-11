import type { TrackedHistoryEntry } from "@/lib/protocol/tracking-port";

/**
 * UI-005 — the plain-language history list of the tracking status view.
 *
 * Every entry is presented verbatim: the wording, the authority that
 * recorded it, and the authority-stamped time. Nothing here is rewritten,
 * merged, or synthesized — the surface only displays what the authority
 * answered. Most recent first.
 */

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

/** Format an authority-stamped ISO time for display, explicitly in UTC. */
export function formatAuthorityTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "time unavailable";
  }
  return dateFormatter.format(date);
}

export function TrackHistoryList({ history }: { history: readonly TrackedHistoryEntry[] }) {
  return (
    <section aria-labelledby="track-history-heading" className="space-y-3">
      <h2 id="track-history-heading" className="text-lg font-semibold tracking-tight">
        Plain-language history
      </h2>
      <p className="text-sm text-muted-foreground">
        What happened, as recorded by the authorities that recorded it — presented verbatim,
        most recent first.
      </p>
      {history.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No history has been recorded for this reference yet.
        </p>
      ) : (
        <ol className="relative space-y-6 border-l border-muted pl-6">
          {history.map((entry) => (
            <li key={entry.entryId} className="relative">
              <span
                aria-hidden="true"
                className="absolute -left-[31px] top-1.5 size-2.5 rounded-full bg-muted-foreground/60"
              />
              <p className="text-sm leading-relaxed">{entry.wording}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {entry.authority} · {formatAuthorityTime(entry.at)} UTC
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
