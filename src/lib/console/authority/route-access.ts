/**
 * PC-003 — Console API read access (the thin server-side guard helpers).
 *
 * The console API routes under src/app/api/console/** authorize EVERY read
 * server-side BEFORE any environment context or read composition happens
 * (design §8: "authorize the current principal/role" first). This module is
 * the shared pure logic; the routes map denials to the PC-001 boundary
 * convention themselves (404 {ok:false} with no content — the console
 * boundary never confirms its existence to a caller that is not explicitly
 * allowed; see src/app/api/console/contracts/route.ts).
 *
 * Two authorization shapes:
 *   1. Module-scoped reads (payments, checkout sessions, capabilities,
 *      developer requests) — authorizeConsoleModule against the FROZEN
 *      registry module id (PC-001 policy, default-deny).
 *   2. The composite operations-health read — the read feeds the six frozen
 *      operations modules (queues / execution / reconciliation / unknown /
 *      clearing-netting / incidents), so the allowed role set is DERIVED from
 *      the frozen registry as the intersection of those modules' allowed
 *      roles (strictest reading: a principal must be allowed for every
 *      module the composite serves; currently operator-only, mechanically
 *      derived — never hard-coded here).
 */

import { authorizeConsoleModule, resolveConsolePrincipal } from '../policy';
import { CONSOLE_REGISTRY } from '../registry';
import type { AuthenticatedConsolePrincipal, ConsoleAccessDecision, ConsolePrincipal } from '../types';
import type { Role } from '@/lib/navigation';

/** The pure outcome of guarding one console API read. */
export type ConsoleApiReadAccess =
  | { readonly allowed: true; readonly principal: AuthenticatedConsolePrincipal }
  | { readonly allowed: false; readonly reason: 'unauthenticated' | 'role-denied' | 'unknown-module' };

/** Convert a PC-001 access decision to the API guard shape. */
export function consoleApiReadAccess(decision: ConsoleAccessDecision): ConsoleApiReadAccess {
  return decision.allowed
    ? { allowed: true, principal: { role: decision.role } }
    : { allowed: false, reason: decision.reason };
}

/**
 * Guard one console API read by frozen-registry module id: resolve the
 * principal server-side (the existing audience authority — no input from the
 * request participates) and decide fail-closed. Routes call this FIRST.
 */
export async function authorizeConsoleApiRead(
  moduleId: string,
): Promise<ConsoleApiReadAccess> {
  const principal: ConsolePrincipal = await resolveConsolePrincipal();
  return consoleApiReadAccess(authorizeConsoleModule(principal, moduleId));
}

/**
 * The frozen registry's operations-group module ids (the six modules the
 * composite operations-health read serves). Derived from CONSOLE_REGISTRY,
 * never duplicated.
 */
export function consoleOperationsModuleIds(): readonly string[] {
  return CONSOLE_REGISTRY.filter((entry) => entry.group === 'operations').map((entry) => entry.id);
}

/**
 * The allowed role set for the composite operations-health read: the
 * INTERSECTION of the allowed roles across every frozen operations module
 * (strictest fail-closed derivation — a principal must be authorized for
 * each module the composite feeds). If a later governed change widens one
 * operations module, this composite stays restricted to the intersection
 * until its own governed change.
 */
export function operationsCompositeAccessRoles(): readonly Role[] {
  const moduleIds = consoleOperationsModuleIds();
  if (moduleIds.length === 0) {
    return [];
  }
  const intersection = new Set<Role>(CONSOLE_REGISTRY.find((entry) => entry.id === moduleIds[0])?.allowedRoles ?? []);
  for (const moduleId of moduleIds.slice(1)) {
    const allowed = CONSOLE_REGISTRY.find((entry) => entry.id === moduleId)?.allowedRoles ?? [];
    for (const role of [...intersection]) {
      if (!allowed.includes(role)) {
        intersection.delete(role);
      }
    }
  }
  return [...intersection];
}

/**
 * Guard the composite operations-health read against the derived role set
 * (fail-closed: unauthenticated, unknown role, or any role outside the
 * intersection is denied).
 */
export async function authorizeConsoleOperationsRead(): Promise<ConsoleApiReadAccess> {
  const principal: ConsolePrincipal = await resolveConsolePrincipal();
  if (!principal.authenticated) {
    return { allowed: false, reason: 'unauthenticated' };
  }
  const allowedRoles = operationsCompositeAccessRoles();
  if (!allowedRoles.includes(principal.role)) {
    return { allowed: false, reason: 'role-denied' };
  }
  return { allowed: true, principal: { role: principal.role } };
}
