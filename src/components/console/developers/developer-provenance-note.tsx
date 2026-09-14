/**
 * PC-005 — The honest data-provenance note panel (shared by every
 * in-memory developer surface).
 *
 * The architecture ruling (design §11): developer controls are NOT
 * financial truth, so their stores are in-memory — and every surface that
 * renders their data MUST say so. This panel renders the note verbatim
 * (developer-provenance.ts) with a distinct visual treatment (dashed
 * stone), so it can never be mistaken for durable protocol state.
 *
 * Server-compatible presentational component (no client interactivity).
 */

import type { ReactNode } from 'react';
import { DEVELOPER_DIAGNOSTIC_NOT_EVIDENCE_NOTE, IN_MEMORY_DEVELOPER_SURFACE_NOTE } from '@/lib/console/developers/developer-provenance';

export interface DeveloperProvenanceNoteProps {
  /** Also render the diagnostic-not-evidence note (log/inspector surfaces). */
  readonly diagnostic?: boolean;
  /** Optional extra line naming the exact surface (e.g. "API keys"). */
  readonly subject?: string;
}

/** The honest in-memory data-provenance note (design §11 ruling, rendered). */
export function DeveloperProvenanceNote({
  diagnostic = false,
  subject,
}: DeveloperProvenanceNoteProps): ReactNode {
  return (
    <aside
      data-console-developer-provenance="in-memory"
      aria-label="Data provenance note"
      className="rounded-xl border-2 border-dashed border-stone-300 bg-stone-50 p-4"
    >
      <p className="text-sm text-stone-700">
        <span className="font-semibold text-stone-800">Data provenance{subject ? ` — ${subject}` : ''}: </span>
        {IN_MEMORY_DEVELOPER_SURFACE_NOTE}
      </p>
      {diagnostic && (
        <p className="mt-2 text-sm text-stone-700" data-testid="developer-diagnostic-note">
          <span className="font-semibold text-stone-800">Diagnostic, not evidence: </span>
          {DEVELOPER_DIAGNOSTIC_NOT_EVIDENCE_NOTE}
        </p>
      )}
    </aside>
  );
}
