/**
 * PC-002 — Console route-group layout: the console shell.
 *
 * Server-side role enforcement at the route-group boundary (PC-001
 * convention preserved): every /console render resolves the principal from
 * the EXISTING audience authority and requires console root access BEFORE
 * any console content renders. Unauthenticated/unknown viewers fail closed
 * through the existing guard convention (redirect to the shell home — the
 * guarded content never renders; src/lib/shell-guard.ts).
 *
 * The shell composition follows the product shell grammar (site-header /
 * nav-list / site-footer conventions, src/components/shell/*):
 *
 *   - ConsoleHeader — console identity, the viewer's role label
 *     (audienceLabel vocabulary), and the server-derived environment label
 *     (PC-001 getConsoleEnvironmentContext, environment-banner pattern).
 *   - ConsoleNav — the module navigation, derived from the ONE frozen
 *     registry (CONSOLE_REGISTRY) and filtered server-side to exactly the
 *     modules the resolved principal may access. Desktop (lg+) renders a
 *     persistent sidebar; below lg the identical link set collapses behind
 *     a native disclosure — same routes, same semantics.
 *   - ConsoleFooter — the standing console facts.
 *
 * Deep-link protection is layered (PC-001 design preserved): this layout
 * guards the group (any authenticated role), and every child route guards
 * its own module on direct entry via requireConsoleRoute — a role-denied or
 * unknown module never renders, for nav visits and deep links alike.
 */

import type { ReactNode } from 'react';
import { requireConsoleModule } from '@/lib/console/policy';
import { CONSOLE_ROOT_MODULE_ID } from '@/lib/console/registry';
import { getConsoleEnvironmentContext } from '@/lib/console/environment-context';
import { ConsoleHeader } from '@/components/console/shell/console-header';
import { ConsoleNav } from '@/components/console/shell/console-nav';
import { ConsoleFooter } from '@/components/console/shell/console-footer';
import { consoleNavigationForRole } from '@/components/console/shell/console-navigation';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  // Fail closed: unauthenticated/unknown role → redirect('/'); no console
  // content renders for any audience that is not explicitly allowed.
  const principal = await requireConsoleModule(CONSOLE_ROOT_MODULE_ID);

  // Server-derived environment context (no arguments — no client input path).
  const environment = getConsoleEnvironmentContext();

  // Server-side role filtering: the navigation model contains exactly the
  // modules the resolved principal may access, before any markup exists.
  const navigation = consoleNavigationForRole(principal.role);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col px-4 py-6">
      <ConsoleHeader role={principal.role} environment={environment} />
      {/*
       * Two-column shell at lg+ (sidebar + content); single stacked column
       * below lg. The content column carries min-w-0 so dense content wraps
       * instead of forcing horizontal page scrolling (P10).
       */}
      <div className="flex flex-col gap-6 py-6 lg:flex-row lg:items-start">
        <ConsoleNav groups={navigation} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      <ConsoleFooter role={principal.role} environment={environment} />
    </div>
  );
}
