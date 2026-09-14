/**
 * PC-002 — Console route helpers: the page-guard and metadata conventions
 * every route entrypoint under src/app/console/ uses.
 *
 * Both helpers key off the ROUTE PATH, resolved through the ONE frozen
 * registry (findConsoleRoute) — a page never hardcodes a module id, label,
 * or description, so the route tree and the registry cannot drift:
 *
 *   - `requireConsoleRoute(href)` is the console mirror of the existing
 *     page-guard convention (`await requireRoleSurface('merchant')` in
 *     src/app/(merchant)/checkout/page.tsx): it resolves the registry entry
 *     for the page's own route and delegates to PC-001's
 *     `requireConsoleModule` (fail-closed: unauthenticated / role-denied /
 *     unknown-module all redirect to the shell home — the guarded content
 *     never renders). A route that is not in the frozen registry is an
 *     orphan route and fails closed through notFound() (the existing
 *     grammar-aware 404 convention).
 *   - `consoleRouteMetadata(href)` derives the page title/description from
 *     the registry entry, so the document vocabulary also stays
 *     registry-derived.
 *
 * Server-side only (uses next/navigation primitives); consumed by server
 * components under src/app/console/**.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findConsoleRoute } from '@/lib/console/registry';
import { requireConsoleModule } from '@/lib/console/policy';
import type { AuthenticatedConsolePrincipal } from '@/lib/console/types';

/**
 * Page guard for one console route path: resolve the frozen registry entry
 * for `href` and require that the current server-side principal may access
 * its module. Denials fail closed exactly like the product surface guards;
 * registry-unknown routes 404 through the existing convention.
 */
export async function requireConsoleRoute(
  href: string,
): Promise<AuthenticatedConsolePrincipal> {
  const entry = findConsoleRoute(href);
  if (!entry) {
    // Not part of the frozen registry → no surface (P1: no orphan routes).
    notFound();
  }
  return requireConsoleModule(entry.id);
}

/** Registry-derived page metadata for one console route path. */
export function consoleRouteMetadata(href: string): Metadata {
  const entry = findConsoleRoute(href);
  if (!entry) {
    return { title: 'Console · PaySwap' };
  }
  return {
    title: `${entry.label} · Console`,
    description: entry.description,
  };
}
