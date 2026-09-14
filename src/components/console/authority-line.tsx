/**
 * PC-001 — Shared console primitive: the authority/source attribution line.
 *
 * Every consequential console value must render with its owning authority
 * and runtime boundary visible (design §4: "each field MUST retain a
 * traceable source/authority"; §8: "attach source/authority metadata").
 * This is the shared one-line presentation for that attribution; the full
 * nine-question metadata shape is ConsoleAuthorityMetadata
 * (src/lib/console/types.ts).
 *
 * Server-compatible presentational component (no client interactivity).
 */

export interface ConsoleAuthorityLineProps {
  /** The owning authority for the value(s) above this line (named exactly). */
  readonly owningAuthority: string;
  /** The runtime boundary the read crossed (named exactly). */
  readonly runtimeBoundary: string;
  /** The durable source of truth, where applicable. */
  readonly durableSource?: string;
  /** Evidence reference (record id family / document path). */
  readonly evidenceReference?: string;
}

/** Compact attribution line: source/authority metadata stated in plain text. */
export function ConsoleAuthorityLine({
  owningAuthority,
  runtimeBoundary,
  durableSource,
  evidenceReference,
}: ConsoleAuthorityLineProps) {
  return (
    <dl
      aria-label="Source and authority attribution"
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500"
    >
      <div className="flex flex-wrap gap-x-1">
        <dt className="font-medium text-stone-600">Authority:</dt>
        <dd>{owningAuthority}</dd>
      </div>
      <div className="flex flex-wrap gap-x-1">
        <dt className="font-medium text-stone-600">Boundary:</dt>
        <dd>{runtimeBoundary}</dd>
      </div>
      {durableSource && (
        <div className="flex flex-wrap gap-x-1">
          <dt className="font-medium text-stone-600">Durable source:</dt>
          <dd>{durableSource}</dd>
        </div>
      )}
      {evidenceReference && (
        <div className="flex flex-wrap gap-x-1">
          <dt className="font-medium text-stone-600">Evidence:</dt>
          <dd>{evidenceReference}</dd>
        </div>
      )}
    </dl>
  );
}
