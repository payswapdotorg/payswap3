/**
 * IN_PROGRESS display primitive (UI-001; UX contract Section 7).
 *
 * A non-terminal state — the owning authority reports active processing.
 * The visual treatment (animated arc + progress strip) is decorative
 * motion only, disabled under prefers-reduced-motion; it is never a
 * verdict. The UI never promotes a non-terminal state to terminal (P4) —
 * completion is whatever the authority reports next.
 */

import type { ReactNode } from 'react';
import { StateFrame } from './state-frame';
import { InProgressIcon } from './state-icons';

export interface InProgressStateProps {
  /** What is happening, per the owning authority. */
  readonly whatIsHappening: string;
  /** What completes it — the condition the authority reports as completion. */
  readonly whatCompletesIt: string;
  /** The authority reporting the active processing. */
  readonly reportedBy: string;
  readonly children?: ReactNode;
}

export function InProgressState({
  whatIsHappening,
  whatCompletesIt,
  reportedBy,
  children,
}: InProgressStateProps) {
  return (
    <StateFrame
      state="IN_PROGRESS"
      role="status"
      icon={<InProgressIcon className="ps-arc h-5 w-5" />}
    >
      <p className="font-medium">{whatIsHappening}</p>
      <p>
        <span className="text-stone-600">What completes it: </span>
        {whatCompletesIt}
      </p>
      <p>
        <span className="text-stone-600">Reported by: </span>
        {reportedBy}
      </p>
      {children}
    </StateFrame>
  );
}
