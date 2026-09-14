/**
 * PC-002 — Console module navigation renderer (nav-list-style, following the
 * shared shell grammar conventions from src/components/shell/nav-list.tsx:
 * server-rendered links, 44px minimum interactive targets, registry-status
 * tags, no ad hoc navigation paradigm).
 *
 * Desktop and mobile share the SAME route grammar by construction: both
 * presentations render the SAME component (ConsoleNavList) from the SAME
 * role-filtered model (console-navigation.ts). Below the `lg` breakpoint
 * (1024px — the shared breakpoint set, src/lib/navigation.ts BREAKPOINTS)
 * the navigation collapses behind a native <details> disclosure; at `lg` and
 * above it is a persistent sidebar. Collapsing never changes route
 * semantics — the disclosure contains the identical link set.
 *
 * Role filtering is NOT done here: the model arrives already filtered from
 * the server-side derivation (consoleNavigationForRole), which itself reads
 * the principal from PC-001's policy. There is no client-side access
 * decision anywhere in this component — it is a server component with no
 * interactivity beyond the native disclosure element.
 */

import Link from 'next/link';
import type { ConsoleNavGroup, ConsoleNavItem } from './console-navigation';
import { consoleNavigationItemCount } from './console-navigation';

/** The registry-status tag (same visual grammar as the shell NavList planned tag). */
function ConsolePlannedTag() {
  return (
    <span className="rounded-full border border-stone-300 bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
      Planned
    </span>
  );
}

function ConsoleNavItemLink({ item }: { item: ConsoleNavItem }) {
  return (
    <Link
      href={item.href}
      title={item.description}
      data-console-module={item.id}
      className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-900"
    >
      <span>{item.label}</span>
      {item.status === 'planned' && <ConsolePlannedTag />}
    </Link>
  );
}

/**
 * The ONE module-list renderer. Both viewport presentations use it, so the
 * desktop sidebar and the mobile disclosure are mechanically the same
 * routes, in the same frozen order, with the same status tags. The Overview
 * page also renders it (with a role-scoped label) as the module map.
 */
export function ConsoleNavList({
  groups,
  label = 'Console modules',
}: {
  groups: readonly ConsoleNavGroup[];
  label?: string;
}) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-col gap-4">
        {groups.map((group) => (
          <li key={group.group}>
            <p className="px-3 text-xs font-semibold uppercase tracking-widest text-stone-500">
              {group.label}
            </p>
            <ul className="mt-1 flex flex-col">
              {group.items.map((item) => (
                <li key={item.id}>
                  <ConsoleNavItemLink item={item} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export interface ConsoleNavProps {
  /** Server-derived, role-filtered navigation model (consoleNavigationForRole). */
  readonly groups: readonly ConsoleNavGroup[];
}

export function ConsoleNav({ groups }: ConsoleNavProps) {
  if (groups.length === 0) {
    return null;
  }
  const count = consoleNavigationItemCount(groups);
  return (
    <>
      {/*
       * Mobile (<lg): the module navigation collapses behind one native
       * disclosure. <details>/<summary> are keyboard-operable, focusable
       * controls with platform semantics — no client JavaScript and no route
       * changes; the summary carries a 44px minimum interactive target.
       */}
      <details
        data-console-nav="mobile"
        className="rounded-xl border border-stone-300 bg-white lg:hidden"
      >
        <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium text-stone-700">
          Module navigation{' '}
          <span className="text-xs font-normal text-stone-500">({count})</span>
        </summary>
        <div className="border-t border-stone-200 px-1 py-3">
          <ConsoleNavList groups={groups} />
        </div>
      </details>
      {/*
       * Desktop (lg+): the same renderer as a persistent sidebar. Width-capped
       * and shrink-0 so dense content in the adjacent column wraps instead of
       * overflowing the page horizontally.
       */}
      <aside
        data-console-nav="desktop"
        aria-label="Console module navigation"
        className="hidden w-full shrink-0 lg:block lg:max-w-64"
      >
        <ConsoleNavList groups={groups} />
      </aside>
    </>
  );
}
