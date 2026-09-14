/**
 * PC-001 — Shared console primitive: the six-status presentation.
 *
 * Renders EXACTLY the frozen console DTO status vocabulary
 * (UNKNOWN | WAITING | IN_PROGRESS | FAILED | SUCCEEDED | ACTION_REQUIRED —
 * src/lib/console/dto.ts), which is aligned one-for-one with the product
 * state-display contract (src/components/state/display-state.ts). Labels and
 * meanings are reused FROM that contract — the console never re-words a
 * state, and UNKNOWN never renders as success or failure (P5).
 *
 * Server-compatible presentational component (no client interactivity).
 */

import { STATE_LABELS, STATE_MEANINGS, UNKNOWN_DISAMBIGUATION } from '@/components/state';
import type { ConsoleStatus } from '@/lib/console/types';

/** Visual tone per status — distinct for UNKNOWN so it is never styled as success/failure. */
export function consoleStatusTone(status: ConsoleStatus): string {
  switch (status) {
    case 'SUCCEEDED':
      return 'border-teal-300 bg-teal-50 text-teal-800';
    case 'FAILED':
      return 'border-red-300 bg-red-50 text-red-800';
    case 'UNKNOWN':
      return 'border-dashed border-amber-400 bg-amber-50 text-amber-800';
    case 'WAITING':
      return 'border-stone-300 bg-stone-50 text-stone-700';
    case 'IN_PROGRESS':
      return 'border-sky-300 bg-sky-50 text-sky-800';
    case 'ACTION_REQUIRED':
      return 'border-violet-300 bg-violet-50 text-violet-800';
  }
}

export interface ConsoleStatusPresentationProps {
  /** One of the six frozen console statuses (validated by the DTO layer). */
  readonly status: ConsoleStatus;
  /** What the status is about, in plain language (rendered for UNKNOWN/disambiguation contexts). */
  readonly subject?: string;
  /** Optional authority note (e.g. an unavailable read's reconciliation note). */
  readonly note?: string;
}

/**
 * Compact status chip with accessible semantics: the visible label comes
 * from the product contract; screen readers additionally get the state's
 * one-line meaning, and UNKNOWN always carries the standing disambiguation
 * (never success, never failure).
 */
export function ConsoleStatusPresentation({
  status,
  subject,
  note,
}: ConsoleStatusPresentationProps) {
  const label = STATE_LABELS[status];
  const meaning = STATE_MEANINGS[status];
  const ariaLabel =
    status === 'UNKNOWN'
      ? `${label}. ${meaning} ${UNKNOWN_DISAMBIGUATION}${subject ? ` Subject: ${subject}.` : ''}`
      : `${label}. ${meaning}${subject ? ` Subject: ${subject}.` : ''}`;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span
        role="status"
        aria-label={ariaLabel}
        className={`inline-flex min-h-6 items-center rounded-lg border px-2 py-0.5 text-xs font-semibold ${consoleStatusTone(status)}`}
        data-console-status={status}
      >
        {label}
      </span>
      {note && <span className="text-xs text-stone-500">{note}</span>}
    </span>
  );
}
