/**
 * State transition announcer (UI-001; P4, P9).
 *
 * State transitions on consequential outcomes MUST be announced
 * accessibly. Surfaces keep ONE of these live regions mounted and pass the
 * human-readable transition message; because the region persists across
 * the change, assistive technology reliably announces each transition.
 */

export interface StateAnnouncerProps {
  /** The transition message, in plain language. */
  readonly message: string;
}

export function StateAnnouncer({ message }: StateAnnouncerProps) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
        Live region (polite)
      </p>
      <p aria-live="polite" aria-atomic="true" className="mt-1 text-sm text-stone-800">
        {message}
      </p>
    </div>
  );
}
