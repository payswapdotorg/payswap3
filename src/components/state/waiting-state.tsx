/**
 * WAITING display primitive (UI-001; UX contract Section 7, P6).
 *
 * A non-terminal state — queued, delayed, or awaiting, per the owning
 * authority. The API makes the mandatory content structural: callers must
 * supply what is waiting, why (as reported by the owning authority), and
 * what happens next. Available actions are a prop; when they are omitted
 * or empty, the primitive renders the explicit statement "No action is
 * available yet." — a non-terminal state never dead-ends, and time or
 * progress claims reflect authoritative information only (the UI never
 * presents invented estimates as authoritative).
 */

import type { ReactNode } from 'react';
import { StateFrame } from './state-frame';
import { WaitingIcon } from './state-icons';
import { NO_ACTIONS_AVAILABLE } from './display-state';

export interface WaitingStateProps {
  /** What is waiting. */
  readonly whatIsWaiting: string;
  /** Why, as reported by the owning authority. */
  readonly why: string;
  /** What happens next — the expectation, from the authority. */
  readonly whatHappensNext: string;
  /** The authority reporting the waiting state. */
  readonly reportedBy: string;
  /**
   * Available user actions. Omitted or empty renders the explicit
   * "No action is available yet." line (P6).
   */
  readonly availableActions?: readonly string[];
  readonly children?: ReactNode;
}

export function WaitingState({
  whatIsWaiting,
  why,
  whatHappensNext,
  reportedBy,
  availableActions,
  children,
}: WaitingStateProps) {
  const hasActions = availableActions !== undefined && availableActions.length > 0;
  return (
    <StateFrame state="WAITING" role="status" icon={<WaitingIcon className="h-5 w-5" />}>
      <p className="font-medium">{whatIsWaiting}</p>
      <p>
        <span className="text-stone-600">Why: </span>
        {why}
        <span className="text-stone-600"> (as reported by {reportedBy})</span>
      </p>
      <p>
        <span className="text-stone-600">What happens next: </span>
        {whatHappensNext}
      </p>
      {hasActions ? (
        <div>
          <p className="font-medium">Available actions:</p>
          <ul className="list-disc space-y-1 pl-5">
            {availableActions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="font-medium text-stone-700">{NO_ACTIONS_AVAILABLE}</p>
      )}
      {children}
    </StateFrame>
  );
}
