/**
 * UNKNOWN display primitive (UI-001; UX contract Section 7, P5).
 *
 * UNKNOWN is a first-class state, surfaced as unknown — never as failure
 * and never as success. It renders with a distinct label ("Unknown"), a
 * distinct visual treatment (dashed amber frame, question icon), and a
 * plain-language explanation of what is not yet known. The frame appends a
 * standing disambiguation so Unknown is never worded, styled, logged, or
 * counted as success or failure. Where the reconciliation path is known,
 * it is shown: who resolves it and what triggers the re-check.
 *
 * Use this whenever NO authoritative answer is currently available —
 * including a failed fetch (see also AvailabilityUnknownState) or an
 * unreachable authority. Absence of an answer is never zero, empty,
 * failed, or cached success.
 */

import type { ReactNode } from 'react';
import { StateFrame } from './state-frame';
import { UnknownIcon } from './state-icons';

export interface ReconciliationPath {
  /** Who will resolve the unknown. */
  readonly whoResolves: string;
  /** What triggers the re-check. */
  readonly recheckTrigger: string;
}

export interface UnknownStateProps {
  /** What is not yet known, in plain language. */
  readonly subject: string;
  /** Plain-language explanation of why there is no authoritative answer yet. */
  readonly explanation: string;
  /** Reconciliation path, where it is known (P5). */
  readonly reconciliation?: ReconciliationPath;
  readonly children?: ReactNode;
}

export function UnknownState({
  subject,
  explanation,
  reconciliation,
  children,
}: UnknownStateProps) {
  return (
    <StateFrame state="UNKNOWN" role="status" icon={<UnknownIcon className="h-5 w-5" />}>
      <p className="font-medium">{subject}</p>
      <p>{explanation}</p>
      {reconciliation && (
        <dl className="space-y-1">
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-stone-700">Resolved by:</dt>
            <dd>{reconciliation.whoResolves}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-stone-700">Re-check:</dt>
            <dd>{reconciliation.recheckTrigger}</dd>
          </div>
        </dl>
      )}
      {children}
    </StateFrame>
  );
}
