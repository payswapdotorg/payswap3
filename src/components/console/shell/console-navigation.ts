/**
 * PC-002 — Console module navigation model, derived from the ONE frozen
 * registry (src/lib/console/registry.ts — design §5 information architecture).
 *
 * The console reuses the product shell's navigation GRAMMAR (P1:
 * src/lib/navigation.ts defines the grammar; the console shell renders
 * through the same conventions — server-resolved audience, role-filtered
 * entries, 44px targets, planned-status tags — via console-specific shell
 * components under src/components/console/shell/). This module is the pure
 * derivation layer between the frozen registry and those renderers:
 *
 *   - The module tree is NEVER re-declared here: groups, entries, order,
 *     roles, and status all come from CONSOLE_REGISTRY.
 *   - Role filtering happens HERE, server-side, before any markup exists.
 *     The renderers (console-nav.tsx) are presentational and receive only
 *     the already-filtered model — there is no client-side access decision
 *     anywhere in the console shell (PC-002 stop condition).
 *   - Group labels are derived mechanically from the frozen group ids
 *     (capitalized), which reproduces the frozen top-level navigation
 *     grammar exactly: Overview, Payments, Checkout, Accounts, Capabilities,
 *     Developers, Operations, Documentation.
 *   - Item labels strip the "Group — " prefix the registry uses for flat
 *     uniqueness so the nested navigation matches the design §5 tree
 *     (e.g. "Operations — queues" renders as "queues" under the Operations
 *     group); labels that do not carry the prefix render verbatim.
 *   - Dynamic-segment routes (e.g. /console/payments/[paymentId]) are
 *     deep-linkable module surfaces but cannot be navigation destinations
 *     (no concrete segment value exists), so they are excluded from the
 *     navigation model. They remain in the registry, authorized through the
 *     same policy, and reachable by deep link.
 */

import type { Role } from '@/lib/navigation';
import { CONSOLE_GROUPS, type ConsoleGroupId } from '@/lib/console/types';
import { CONSOLE_REGISTRY, type ConsoleRouteEntry } from '@/lib/console/registry';

/** One navigation destination, projected from a registry entry. */
export interface ConsoleNavItem {
  /** Registry module id (single source — never a local id). */
  readonly id: string;
  /** Registry route path. */
  readonly href: string;
  /** Presentation label derived from the registry label (see module docs). */
  readonly label: string;
  /** Registry description (tooltip/summary text, verbatim). */
  readonly description: string;
  /** Registry route status, surfaced in the navigation. */
  readonly status: ConsoleRouteEntry['status'];
}

/** One top-level navigation group with its role-filtered items. */
export interface ConsoleNavGroup {
  readonly group: ConsoleGroupId;
  /** Capitalized group id — the frozen top-level grammar label. */
  readonly label: string;
  readonly items: readonly ConsoleNavItem[];
}

/**
 * Does this registry route have a concrete (static) path? Routes with
 * `[param]` tokens are dynamic module surfaces, not navigation targets.
 */
export function isStaticConsoleHref(href: string): boolean {
  return !href.includes('[');
}

/** Group label: the capitalized frozen group id (Overview, Payments, ...). */
export function consoleGroupLabel(group: ConsoleGroupId): string {
  return group.charAt(0).toUpperCase() + group.slice(1);
}

/**
 * Item label: the registry label with its "Group — " prefix stripped when
 * present (the registry prefixes labels for flat-list uniqueness; the nested
 * navigation shows the group already). Verbatim otherwise.
 */
export function consoleNavItemLabel(entry: ConsoleRouteEntry, groupLabel: string): string {
  const prefix = `${groupLabel} — `;
  return entry.label.startsWith(prefix) ? entry.label.slice(prefix.length) : entry.label;
}

/**
 * The role-filtered console navigation, derived exclusively from the frozen
 * registry. A group renders only when the role may access at least one of
 * its static modules; groups keep the frozen information-architecture order;
 * items keep registry order. This runs server-side only — the console layout
 * calls it AFTER the principal is resolved and the root module guard has
 * passed, and passes the result down as plain data.
 */
export function consoleNavigationForRole(role: Role): readonly ConsoleNavGroup[] {
  const groups: ConsoleNavGroup[] = [];
  for (const group of CONSOLE_GROUPS) {
    const label = consoleGroupLabel(group);
    const items: ConsoleNavItem[] = CONSOLE_REGISTRY.filter(
      (entry) =>
        entry.group === group &&
        entry.allowedRoles.includes(role) &&
        isStaticConsoleHref(entry.href),
    ).map((entry) => ({
      id: entry.id,
      href: entry.href,
      label: consoleNavItemLabel(entry, label),
      description: entry.description,
      status: entry.status,
    }));
    if (items.length > 0) {
      groups.push({ group, label, items });
    }
  }
  return groups;
}

/** Count of navigation destinations across all groups (for summary labels). */
export function consoleNavigationItemCount(groups: readonly ConsoleNavGroup[]): number {
  return groups.reduce((count, group) => count + group.items.length, 0);
}
