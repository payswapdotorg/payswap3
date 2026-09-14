/**
 * PC-001 — Console route-group layout (scaffolding only, no feature views).
 *
 * Server-side role enforcement at the route-group boundary: every /console
 * render resolves the principal from the EXISTING audience authority and
 * requires console root access BEFORE any console content renders.
 * Unauthenticated/unknown/unauthorized viewers fail closed through the
 * existing guard convention (redirect to the shell home — the guarded
 * content never renders; see src/lib/shell-guard.ts).
 *
 * Deep-link protection is layered: this layout guards the group, and the
 * page re-checks its own module on direct entry (the grammar's deep-link
 * rule). Child routes shipped by later phases (PC-002/PC-004/PC-005) call
 * `requireConsoleModule` with their own module ids.
 */

import type { ReactNode } from 'react';
import { requireConsoleModule } from '@/lib/console/policy';
import { CONSOLE_ROOT_MODULE_ID } from '@/lib/console/registry';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  // Fail closed: unauthenticated/unknown role → redirect('/'); no console
  // content renders for any audience that is not explicitly allowed.
  await requireConsoleModule(CONSOLE_ROOT_MODULE_ID);
  return <>{children}</>;
}
