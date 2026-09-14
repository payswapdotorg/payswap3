/**
 * PC-001 — Server-side console role policy (fail-closed).
 *
 * Reuses the EXISTING server-side audience authority — there is no new
 * identity source:
 *   - `resolveShellAudience()` (src/lib/shell-audience-server.ts) resolves
 *     the authoritative audience from the session signal, failing closed to
 *     'unauthenticated' (least visibility).
 *   - `requireRoleSurface()` (src/lib/shell-guard.ts) sets the existing
 *     fail-closed page convention (redirect('/') on denial) that
 *     `requireConsoleModule` mirrors for the console.
 *   - The role vocabulary is the existing `ROLES` (src/lib/navigation.ts):
 *     customer, merchant, provider, operator, administrator — which matches
 *     design §6 one-for-one (mapping recorded in
 *     spec/console/PC-001-evidence.md; the repository vocabulary is
 *     authoritative).
 *
 * Access model (design §6): the module-level access map is DERIVED from the
 * frozen route/module registry (src/lib/console/registry.ts) so registry and
 * policy can never drift. Fail-closed rules:
 *   - unauthenticated principal                    → deny;
 *   - unknown role                                 → deny (never a principal);
 *   - module id not in the frozen registry         → deny (unknown-module);
 *   - role not explicitly allowed for the module   → deny (role-denied);
 *   - anything not explicitly allowed              → deny (default-deny).
 */

import { redirect } from 'next/navigation';
import { ROLES, type Role } from '@/lib/navigation';
import { resolveShellAudience } from '@/lib/shell-audience-server';
import { CONSOLE_REGISTRY } from './registry';
import type {
  AuthenticatedConsolePrincipal,
  ConsoleAccessDecision,
  ConsoleModuleId,
  ConsolePrincipal,
} from './types';

/** Narrow a resolved audience to the five console roles. */
export function isConsoleRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * The module-level access map, derived mechanically from the frozen registry
 * (design §6 role model). Every module id maps to the roles explicitly
 * allowed for it; a module id absent here is an unknown module → deny.
 */
export const CONSOLE_MODULE_ACCESS: Readonly<Record<Role, readonly ConsoleModuleId[]>> = (() => {
  const access: Record<Role, ConsoleModuleId[]> = {
    customer: [],
    merchant: [],
    provider: [],
    operator: [],
    administrator: [],
  };
  for (const entry of CONSOLE_REGISTRY) {
    for (const role of entry.allowedRoles) {
      access[role].push(entry.id);
    }
  }
  return access;
})();

/**
 * Default-deny module check: true ONLY when the module id exists in the
 * frozen registry AND the role is explicitly allowed for it.
 */
export function canAccessConsoleModule(role: Role, moduleId: string): moduleId is ConsoleModuleId {
  return CONSOLE_REGISTRY.some(
    (entry) => entry.id === moduleId && entry.allowedRoles.includes(role),
  );
}

/**
 * Resolve the console principal server-side from the existing audience
 * authority. Unauthenticated/unknown audiences resolve to the
 * unauthenticated principal — never to a guessed role (design §6).
 */
export async function resolveConsolePrincipal(): Promise<ConsolePrincipal> {
  const audience = await resolveShellAudience();
  if (isConsoleRole(audience)) {
    return { authenticated: true, role: audience };
  }
  // 'unauthenticated' (or any non-role audience) → least visibility.
  return { authenticated: false, reason: 'unauthenticated' };
}

/**
 * Pure fail-closed authorization decision for one console module. API
 * boundaries use this directly (no redirect); pages use
 * `requireConsoleModule`.
 */
export function authorizeConsoleModule(
  principal: ConsolePrincipal,
  moduleId: string,
): ConsoleAccessDecision {
  if (!principal.authenticated) {
    return { allowed: false, reason: 'unauthenticated', moduleId };
  }
  const entry = CONSOLE_REGISTRY.find((candidate) => candidate.id === moduleId);
  if (!entry) {
    return { allowed: false, reason: 'unknown-module', moduleId };
  }
  if (!entry.allowedRoles.includes(principal.role)) {
    return { allowed: false, reason: 'role-denied', moduleId };
  }
  return { allowed: true, role: principal.role, moduleId: entry.id };
}

/**
 * Page guard (the console mirror of `requireRoleSurface`): resolve the
 * principal server-side and require that it may access `moduleId`.
 * Unknown module ids fail closed exactly like role denials — there is no
 * allow-by-default path. Denial redirects to the shell home — the guarded
 * content never renders for any other audience, and unknown audiences get
 * least visibility (existing guard convention, src/lib/shell-guard.ts).
 */
export async function requireConsoleModule(
  moduleId: string,
): Promise<AuthenticatedConsolePrincipal> {
  const principal = await resolveConsolePrincipal();
  const decision = authorizeConsoleModule(principal, moduleId);
  if (!decision.allowed) {
    redirect('/');
  }
  return { role: decision.role };
}
