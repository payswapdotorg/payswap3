/**
 * Role-routing matrix (UI-001 verification; P8).
 *
 * Static proof of role correctness: one panel per audience (the five roles
 * plus the unauthenticated viewer), each rendering navigation through the
 * SAME NavList component the live shell header and footer use. The matrix
 * is deliberately static — the product ships no role-switching control,
 * because role assignment is an authoritative input the UI never
 * self-assigns or escalates (P8).
 *
 * Also renders the deep-link guard proof: for sample surfaces, which
 * audiences pass guardSurface on direct entry.
 */

import {
  NAV_AUDIENCES,
  NAVIGATION_ENTRIES,
  audienceLabel,
  audienceNote,
  guardSurface,
  resolveNavigation,
  type NavEntry,
} from '@/lib/navigation';
import { NavList } from '@/components/shell/nav-list';

const GUARD_SAMPLE_IDS = [
  'state-primitives',
  'customer-tracking',
  'provider-tracking',
  'operator-overview',
  'administrator-visibility',
] as const;

export function RoleRoutingMatrix() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {NAV_AUDIENCES.map((audience) => {
        const nav = resolveNavigation(audience);
        return (
          <section
            key={audience}
            aria-labelledby={`role-matrix-${audience}`}
            className="rounded-xl border border-stone-200 bg-stone-50 p-4"
          >
            <h3 id={`role-matrix-${audience}`} className="text-sm font-semibold">
              {audienceLabel(audience)}
            </h3>
            <p className="mt-1 text-xs text-stone-600">{audienceNote(audience)}</p>
            <div className="mt-3">
              <NavList
                label={`Primary navigation — ${audienceLabel(audience)}`}
                entries={nav.primary}
              />
            </div>
            <div className="mt-2">
              <NavList
                label={`Footer navigation — ${audienceLabel(audience)}`}
                entries={nav.footer}
              />
            </div>
          </section>
        );
      })}
      <DeepLinkGuardMatrix />
    </div>
  );
}

function DeepLinkGuardMatrix() {
  const samples = NAVIGATION_ENTRIES.filter((entry) =>
    (GUARD_SAMPLE_IDS as readonly string[]).includes(entry.id),
  );
  return (
    <section
      aria-labelledby="deep-link-guard"
      className="rounded-xl border border-stone-200 bg-stone-50 p-4"
    >
      <h3 id="deep-link-guard" className="text-sm font-semibold">
        Deep-link role check (guardSurface)
      </h3>
      <p className="mt-1 text-xs text-stone-600">
        Status views are deep-linkable, and direct entry re-checks the viewer role. A deep
        link never bypasses the grammar or the role gate (P1, P8).
      </p>
      <ul className="mt-3 space-y-3">
        {samples.map((entry) => (
          <GuardRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

function GuardRow({ entry }: { entry: NavEntry }) {
  const visibleTo = NAV_AUDIENCES.filter((audience) =>
    guardSurface(audience, entry.audiences),
  );
  const gatedFor = NAV_AUDIENCES.filter(
    (audience) => !guardSurface(audience, entry.audiences),
  );
  return (
    <li className="text-xs">
      <p>
        <code className="rounded bg-white px-1.5 py-0.5 font-mono text-stone-800">
          {entry.href}
        </code>{' '}
        <span className="text-stone-600">
          {entry.status === 'planned' ? '(planned — inert until it ships)' : ''}
        </span>
      </p>
      <p className="mt-1 text-stone-700">
        <span className="font-semibold">Visible to: </span>
        {visibleTo.map((audience) => audienceLabel(audience)).join(', ')}
      </p>
      <p className="mt-0.5 text-stone-700">
        <span className="font-semibold">Gated for: </span>
        {gatedFor.length > 0
          ? gatedFor.map((audience) => audienceLabel(audience)).join(', ')
          : 'no audience'}
      </p>
    </li>
  );
}
