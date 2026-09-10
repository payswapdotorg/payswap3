/**
 * The ONE navigation renderer (UI-001; P1).
 *
 * The shell header, the shell footer, and the verification role matrix all
 * render navigation through this component — the same grammar (src/lib/navigation.ts)
 * and the same renderer everywhere. No surface may render its own
 * navigation paradigm.
 *
 * Available entries render as links with 44px minimum touch targets (P10).
 * Planned entries render inert: non-navigating, aria-disabled, tagged
 * "Planned" — routes stay reserved in the grammar without becoming live
 * entry points before their work items ship.
 */

import Link from 'next/link';
import type { NavEntry } from '@/lib/navigation';

export interface NavListProps {
  /** Accessible name of the nav landmark, scoped by the calling surface. */
  readonly label: string;
  readonly entries: readonly NavEntry[];
}

export function NavList({ label, entries }: NavListProps) {
  if (entries.length === 0) {
    return null;
  }
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap items-center gap-1">
        {entries.map((entry) => (
          <li key={entry.id}>
            {entry.status === 'available' ? (
              <Navlink entry={entry} />
            ) : (
              <PlannedEntry entry={entry} />
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Navlink({ entry }: { entry: NavEntry }) {
  return (
    <Link
      href={entry.href}
      title={entry.description}
      className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-900"
    >
      {entry.label}
    </Link>
  );
}

function PlannedEntry({ entry }: { entry: NavEntry }) {
  return (
    <span
      aria-disabled="true"
      title={`${entry.description} Reserved route: ${entry.href} (inert until it ships).`}
      className="inline-flex min-h-11 cursor-not-allowed items-center gap-2 rounded-lg px-3 text-sm text-stone-400"
    >
      {entry.label}
      <span className="rounded-full border border-stone-300 bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
        Planned
      </span>
    </span>
  );
}
