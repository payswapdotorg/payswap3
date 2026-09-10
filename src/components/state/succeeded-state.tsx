/**
 * SUCCEEDED display primitive (UI-001; UX contract Section 7).
 *
 * Renders ONLY when the owning protocol authority reports a terminal
 * successful outcome. The API makes invention structurally hard: callers
 * must supply the authority that reported the outcome and a reachable
 * evidence reference — the product layer presents authority decisions, it
 * never originates them (N1, P7, P11).
 */

import type { ReactNode } from 'react';
import { StateFrame } from './state-frame';
import { SucceededIcon } from './state-icons';

export interface EvidenceRef {
  /** Label for the evidence link, worded from the authoritative record (P7). */
  readonly label: string;
  /** Location of the evidence trail. */
  readonly href: string;
}

export interface SucceededStateProps {
  /**
   * Outcome wording from the owning authority. The UI presents the
   * authority's wording; it never writes its own verdict (N2, P11).
   */
  readonly outcome: string;
  /** The authority that reported this terminal success. */
  readonly reportedBy: string;
  /**
   * Every consequential success provides a reachable, inspectable evidence
   * trail (P7). Required — a consequential success without evidence does
   * not render.
   */
  readonly evidence: EvidenceRef;
  /** Optional secondary detail; primary information stays first (P3). */
  readonly children?: ReactNode;
}

export function SucceededState({
  outcome,
  reportedBy,
  evidence,
  children,
}: SucceededStateProps) {
  return (
    <StateFrame state="SUCCEEDED" role="status" icon={<SucceededIcon className="h-5 w-5" />}>
      <p className="font-medium">{outcome}</p>
      <p>
        <span className="text-stone-600">Reported by: </span>
        {reportedBy}
      </p>
      <p>
        <a
          href={evidence.href}
          className="font-medium text-emerald-800 underline decoration-emerald-600 underline-offset-2 hover:bg-emerald-100"
        >
          {evidence.label}
        </a>
      </p>
      {children}
    </StateFrame>
  );
}
