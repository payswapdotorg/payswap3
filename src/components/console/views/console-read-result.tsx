/**
 * PC-004 — The console read-envelope presentation (the core UNKNOWN
 * discipline of every composed view).
 *
 * Every PC-003 read model resolves to `ConsoleReadResult`:
 *   - `value`        — the owning authority answered; the business status is
 *                      exactly what the authority reported;
 *   - `unavailable`  — NO authoritative answer exists (a no-answer or a
 *                      transport/infrastructure failure). Presentation is
 *                      structurally UNKNOWN — never FAILED, never SUCCEEDED.
 *
 * This component renders the unavailable branch ONCE, for every view, with
 * the same grammar (design §7/§9): the UNKNOWN status chip (dashed amber —
 * visually distinct from every business verdict), the authority's own note
 * verbatim, the standing infrastructure-failure disambiguation (a transport
 * failure is not a business failure), and the full source/authority
 * attribution. A view can therefore never word an unavailable read as a
 * business outcome — the value renderer is only ever invoked for the value
 * branch, and it receives the authority-reported status with it.
 */

import type { ReactNode } from 'react';
import type {
  ConsoleAuthorityMetadata,
  ConsoleReadResult,
  ConsoleStatus,
} from '@/lib/console/types';
import { ConsoleStatusPresentation } from '@/components/console';
import { ConsoleAuthorityLine } from '@/components/console';

export interface ConsoleReadUnavailablePanelProps {
  /** What the unavailable read was about, in plain language. */
  readonly subject: string;
  /** The envelope's own note, verbatim (the authority's or transport note). */
  readonly note: string;
  /** The owning-source metadata attached to the read (rendered as attribution). */
  readonly authority: ConsoleAuthorityMetadata;
}

/**
 * The honest unavailable-read panel: UNKNOWN presentation, infrastructure
 * framing, the authority's note, and full attribution. Visually distinct from
 * the business FAILED treatment by construction (dashed amber UNKNOWN chip —
 * never the solid red FAILED chip).
 */
export function ConsoleReadUnavailablePanel({
  subject,
  note,
  authority,
}: ConsoleReadUnavailablePanelProps) {
  return (
    <section
      data-console-read="unavailable"
      aria-labelledby="console-read-unavailable-heading"
      className="rounded-xl border-2 border-dashed border-amber-400 bg-amber-50 p-4 sm:p-6"
    >
      <h2 id="console-read-unavailable-heading" className="text-lg font-semibold text-amber-900">
        Authoritative read unavailable
      </h2>
      <div className="mt-2">
        <ConsoleStatusPresentation status="UNKNOWN" subject={subject} />
      </div>
      <p className="mt-3 max-w-3xl text-sm text-stone-800" data-testid="console-read-unavailable-note">
        {note}
      </p>
      <p className="mt-2 max-w-3xl text-sm text-stone-600">
        This is an availability condition of the read — an infrastructure or
        authority-reachability condition, <span className="font-semibold">not a business
        outcome</span>. No success and no failure is claimed for {subject}; no verdict is
        guessed. Whoever the note names as resolver re-checks the owning authority; this
        page simply shows its honest answer.
      </p>
      <p className="mt-2 max-w-3xl text-sm text-stone-600">
        <span className="font-semibold text-stone-700">Reconciliation path (the owning source’s own UNKNOWN semantics): </span>
        {authority.unknownSemantics}
      </p>
      <div className="mt-4 border-t border-dashed border-amber-300 pt-3">
        <ConsoleAuthorityLine
          owningAuthority={authority.owningAuthority}
          runtimeBoundary={authority.runtimeBoundary}
          durableSource={authority.durableSource}
          evidenceReference={authority.evidenceReference}
        />
      </div>
    </section>
  );
}

export interface ConsoleReadResultViewProps<T> {
  /** The PC-003 read-model envelope to present. */
  readonly result: ConsoleReadResult<T>;
  /** What this read is about, in plain language (used for UNKNOWN contexts). */
  readonly subject: string;
  /**
   * Render the value branch. Invoked ONLY when the owning authority answered;
   * receives the authority-reported business status and the source metadata
   * alongside the value (attribution stays a single source, never re-derived).
   */
  readonly renderValue: (
    value: T,
    status: ConsoleStatus,
    authority: ConsoleAuthorityMetadata,
  ) => ReactNode;
}

/**
 * The one envelope renderer every composed console view uses: value branches
 * delegate to the view's own renderer; unavailable branches render the honest
 * UNKNOWN panel. The branch decision is made exactly once, here — a view
 * cannot accidentally treat an unavailable read as a business verdict.
 */
export function ConsoleReadResultView<T>({
  result,
  subject,
  renderValue,
}: ConsoleReadResultViewProps<T>): ReactNode {
  if (result.outcome === 'unavailable') {
    return <ConsoleReadUnavailablePanel subject={subject} note={result.note} authority={result.authority} />;
  }
  return renderValue(result.value, result.status, result.authority);
}
