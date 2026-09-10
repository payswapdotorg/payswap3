/**
 * Server-side surface guards (UI-002, P8).
 *
 * Deep links are role-checked on direct entry: every customer pay route
 * resolves the authoritative audience and evaluates guardSurface before
 * rendering anything. A denied entry redirects home — the guarded content
 * never renders for any other audience, and unknown audiences get least
 * visibility ('unauthenticated' by the server-side resolution).
 */
import { redirect } from 'next/navigation';
import { guardSurface, type Role, type NavAudience } from '@/lib/navigation';
import { resolveShellAudience } from '@/lib/shell-audience-server';

/**
 * Require that the resolved audience holds `requiredRole` (or is an
 * explicitly allowed superset audience) before a guarded surface renders.
 * Denial redirects to the shell home; no guarded content leaks.
 */
export async function requireRoleSurface(
  requiredRole: Role,
  extraAllowed: readonly NavAudience[] = [],
): Promise<void> {
  const audience = await resolveShellAudience();
  const allowed = guardSurface(audience, [requiredRole, ...extraAllowed]);
  if (!allowed) {
    redirect('/');
  }
}
