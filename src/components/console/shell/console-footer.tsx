/**
 * PC-002 — Console footer (site-footer-style, following the shell grammar
 * conventions from src/components/shell/site-footer.tsx: semantic <footer>
 * landmark carrying the standing surface facts and a route back into the
 * product shell grammar home entry).
 *
 * The facts it renders are exactly what the server resolved for this render:
 * the viewer role (PC-001 policy), the environment kind (PC-001 server
 * context), and the navigation source of truth (the frozen console
 * registry). The console shell carries no financial semantics and performs
 * no reads — nothing here invents a status, count, or claim.
 */

import Link from 'next/link';
import { audienceLabel, type Role } from '@/lib/navigation';
import type { ConsoleEnvironmentContext } from '@/lib/console/types';

export interface ConsoleFooterProps {
  readonly role: Role;
  readonly environment: ConsoleEnvironmentContext;
}

export function ConsoleFooter({ role, environment }: ConsoleFooterProps) {
  return (
    <footer className="mt-auto border-t border-stone-200 bg-stone-50">
      <div className="space-y-2 px-1 py-5">
        <p className="text-xs text-stone-500">
          <Link
            href="/"
            title="PaySwap home — grammar entry: home"
            className="font-medium text-stone-700 underline underline-offset-2 hover:text-stone-900"
          >
            Return to the PaySwap shell home
          </Link>
        </p>
        <p className="text-xs text-stone-500">
          PaySwap developer console. Viewer: {audienceLabel(role)} (server-resolved role,
          least visibility for anyone not explicitly allowed). Environment:{' '}
          {environment.kind} (server-derived from {environment.configuredValue}). Module
          access is enforced server-side, default-deny.
        </p>
        <p className="text-xs text-stone-500">
          One console module registry: src/lib/console/registry.ts — navigation, deep-link
          gating, and planned-status presentation all derive from it. The console shell
          carries no financial semantics — no balances, no settlement or finality
          wording, no protocol states.
        </p>
      </div>
    </footer>
  );
}
