/**
 * FAILED display primitive (UI-001; UX contract Section 7).
 *
 * Renders ONLY when the owning protocol authority reports a terminal
 * failed outcome. Render conditions are NOT outcomes: a failed fetch or an
 * unreachable authority renders UNKNOWN (see AvailabilityUnknownState),
 * never FAILED — the two cases stay visually and semantically distinct
 * (P4, P5). The API requires the reporting authority, so a failure verdict
 * cannot appear without an authority behind it (N1, P11).
 */

import type { ReactNode } from 'react';
import { StateFrame } from './state-frame';
import { FailedIcon } from './state-icons';

export interface FailedStateProps {
  /** Failure wording as reported by the owning authority. */
  readonly outcome: string;
  /** The authority that reported this terminal failure. */
  readonly reportedBy: string;
  /** Reason, where the authority provides one. */
  readonly reason?: string;
  /** Next actions, where they exist. Recovery actions are individually protocol-authorized (N3). */
  readonly nextActions?: readonly string[];
  readonly children?: ReactNode;
}

export function FailedState({
  outcome,
  reportedBy,
  reason,
  nextActions,
  children,
}: FailedStateProps) {
  return (
    <StateFrame state="FAILED" role="alert" icon={<FailedIcon className="h-5 w-5" />}>
      <p className="font-medium">{outcome}</p>
      <p>
        <span className="text-stone-600">Reported by: </span>
        {reportedBy}
      </p>
      {typeof reason === 'string' && reason.length > 0 && (
        <p>
          <span className="text-stone-600">Reason: </span>
          {reason}
        </p>
      )}
      {nextActions && nextActions.length > 0 && (
        <div>
          <p className="font-medium">Next actions:</p>
          <ul className="list-disc space-y-1 pl-5">
            {nextActions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </div>
      )}
      {children}
    </StateFrame>
  );
}
