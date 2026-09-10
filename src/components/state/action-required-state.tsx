/**
 * ACTION_REQUIRED display primitive (UI-001; UX contract Section 7).
 *
 * The owning authority reports that user action is needed. Mandatory
 * content: the action. Validity/deadline and the consequence of inaction
 * render only where the authority provides them — the primitive never
 * invents deadlines or consequences. The action itself is always
 * protocol-authorized when surfaces wire it (N3); this primitive presents
 * the request, it does not authorize anything.
 */

import type { ReactNode } from 'react';
import { StateFrame } from './state-frame';
import { ActionRequiredIcon } from './state-icons';

export interface ActionRequiredStateProps {
  /** The action the authority reports as needed. */
  readonly action: string;
  /** The authority reporting that user action is needed. */
  readonly reportedBy: string;
  /** Validity or deadline window, where the authority provides one. */
  readonly validity?: string;
  /** Consequence of inaction, where the authority provides one. */
  readonly consequenceOfInaction?: string;
  readonly children?: ReactNode;
}

export function ActionRequiredState({
  action,
  reportedBy,
  validity,
  consequenceOfInaction,
  children,
}: ActionRequiredStateProps) {
  return (
    <StateFrame
      state="ACTION_REQUIRED"
      role="alert"
      icon={<ActionRequiredIcon className="h-5 w-5" />}
    >
      <p className="font-medium">Action needed: {action}</p>
      <p>
        <span className="text-stone-600">Reported by: </span>
        {reportedBy}
      </p>
      {typeof validity === 'string' && validity.length > 0 && (
        <p>
          <span className="text-stone-600">Validity: </span>
          {validity}
        </p>
      )}
      {typeof consequenceOfInaction === 'string' && consequenceOfInaction.length > 0 && (
        <p>
          <span className="text-stone-600">If no action is taken: </span>
          {consequenceOfInaction}
        </p>
      )}
      {children}
    </StateFrame>
  );
}
