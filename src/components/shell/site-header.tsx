/**
 * Shell header (UI-001). Semantic landmark: <header>.
 *
 * Renders the brand (the grammar home entry), the viewer indicator, and
 * the primary navigation resolved for the current audience by the ONE
 * grammar. The header never invents navigation of its own (P1).
 */

import Link from 'next/link';
import type { NavEntry, NavAudience } from '@/lib/navigation';
import { NavList } from './nav-list';

function SwapMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </svg>
  );
}

export interface SiteHeaderProps {
  readonly audience: NavAudience;
  readonly primary: readonly NavEntry[];
}

export function SiteHeader({ audience, primary }: SiteHeaderProps) {
  const viewerLabel =
    audience === 'unauthenticated'
      ? 'Unauthenticated · least visibility'
      : `Role: ${audience}`;
  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <Link
            href="/"
            title="PaySwap home — grammar entry: home"
            className="flex min-h-11 items-center gap-2 text-base font-semibold text-stone-900"
          >
            <SwapMark className="h-5 w-5 text-teal-700" />
            PaySwap
          </Link>
          <p className="text-xs text-stone-500">{viewerLabel}</p>
        </div>
        <NavList label="Primary" entries={primary} />
      </div>
    </header>
  );
}
