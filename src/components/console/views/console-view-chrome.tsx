/**
 * PC-004 — Shared composed-view chrome: the module page header and the honest
 * gap panel.
 *
 * `ConsoleModuleViewHeader` resolves its label/description/group from the ONE
 * frozen registry by route path (the same single-source rule the PC-002
 * placeholder follows), so composed pages never hardcode module vocabulary.
 * It deliberately renders NO registry-status badge: the composed views ship
 * in PC-004 while the registry status flip is a Lead-governed merge-time
 * action, and the pages must render correctly regardless of registry status.
 *
 * `ConsoleGapPanel` is the honest gap presentation for surfaces where the
 * repository exposes NO authoritative read at this baseline: it names what
 * was inventoried, states the recorded gap, and renders nothing that could
 * be mistaken for data. UNKNOWN is presented as the absence of an
 * authoritative answer — never as a business verdict, and never as a
 * fabricated list.
 */

import { notFound } from 'next/navigation';
import { findConsoleRoute } from '@/lib/console/registry';
import { consoleGroupLabel } from '@/components/console/shell/console-navigation';
import { ConsoleStatusPresentation } from '@/components/console';
import { ConsoleAuthorityLine } from '@/components/console';

export interface ConsoleModuleViewHeaderProps {
  /** The page's own route path — resolved through the frozen registry. */
  readonly href: string;
  /** Optional lead sentence under the title (the page's own framing). */
  readonly lead?: string;
}

/** Registry-derived header for a composed console module page. */
export function ConsoleModuleViewHeader({ href, lead }: ConsoleModuleViewHeaderProps) {
  const entry = findConsoleRoute(href);
  if (!entry) {
    // Registry-unknown route → no surface (P1: no orphan routes).
    notFound();
  }
  return (
    <header data-console-module-page={entry.id}>
      <p className="text-xs font-semibold uppercase tracking-widest text-teal-700">
        Console module · {consoleGroupLabel(entry.group)}
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl" data-testid="console-module-label">
        {entry.label}
      </h1>
      {lead ? (
        <p className="mt-3 max-w-3xl text-sm text-stone-600">{lead}</p>
      ) : (
        <p className="mt-3 max-w-3xl text-sm text-stone-600" data-testid="console-module-description">
          {entry.description}
        </p>
      )}
    </header>
  );
}

export interface ConsoleGapPanelProps {
  /** What the gap is about, in plain language (the UNKNOWN subject). */
  readonly subject: string;
  /**
   * The recorded gap statement: what does NOT exist at this baseline and why
   * nothing is rendered in its place. Written by the owning view — never a
   * generic guess.
   */
  readonly gapNote: string;
  /** What the repository DOES expose that was inventoried for this surface. */
  readonly inventory: readonly string[];
  /** Attribution: who owns this surface while the gap stands. */
  readonly authority: {
    readonly owningAuthority: string;
    readonly runtimeBoundary: string;
    readonly durableSource?: string;
    readonly evidenceReference: string;
  };
}

/**
 * The honest recorded-gap panel: an UNKNOWN presentation for a surface with
 * no authoritative read, plus the inventory of what actually exists. No
 * fabricated lists, no invented settings — the panel's whole point.
 */
export function ConsoleGapPanel({ subject, gapNote, inventory, authority }: ConsoleGapPanelProps) {
  return (
    <section
      data-console-gap="true"
      aria-labelledby="console-gap-heading"
      className="rounded-xl border-2 border-dashed border-stone-300 bg-stone-50 p-4 sm:p-6"
    >
      <h2 id="console-gap-heading" className="text-lg font-semibold text-stone-800">
        No authoritative read exists for this surface yet
      </h2>
      <div className="mt-2">
        <ConsoleStatusPresentation status="UNKNOWN" subject={subject} />
      </div>
      <p className="mt-3 max-w-3xl text-sm text-stone-700" data-testid="console-gap-note">{gapNote}</p>
      <h3 className="mt-4 text-sm font-semibold text-stone-800">What the repository actually exposes</h3>
      <ul className="mt-2 max-w-3xl list-disc space-y-1 pl-5 text-sm text-stone-600">
        {inventory.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="mt-3 max-w-3xl text-sm text-stone-600">
        Nothing on this page stands in for the missing read: no simulated list, no
        sample account, no default configuration. The gap is recorded, and the surface
        stays honest until its owning work item lands a real authority.
      </p>
      <div className="mt-4 border-t border-stone-200 pt-3">
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
