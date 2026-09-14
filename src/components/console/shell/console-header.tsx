/**
 * PC-002 — Console header (site-header-style, following the shell grammar
 * conventions from src/components/shell/site-header.tsx: semantic <header>
 * landmark, brand link, viewer label, and — per the environment-banner
 * pattern (src/components/shell/environment-banner.tsx) — a named
 * environment note whose value arrives ONLY as a server-resolved prop).
 *
 * The role label uses the grammar's `audienceLabel` vocabulary
 * (src/lib/navigation.ts); the role itself was resolved server-side from the
 * existing audience authority by PC-001's policy (the console layout). The
 * environment label comes from PC-001's server-derived context
 * (getConsoleEnvironmentContext — derivedBy 'server', no arguments), never
 * from client state. This component renders nothing it was not told by the
 * server.
 */

import Link from 'next/link';
import { Terminal } from 'lucide-react';
import { audienceLabel, type Role } from '@/lib/navigation';
import type { ConsoleEnvironmentContext } from '@/lib/console/types';

export interface ConsoleHeaderProps {
  /** Resolved server-side by the console layout (PC-001 policy). */
  readonly role: Role;
  /** Server-derived environment context (PC-001, getConsoleEnvironmentContext). */
  readonly environment: ConsoleEnvironmentContext;
}

export function ConsoleHeader({ role, environment }: ConsoleHeaderProps) {
  const sandbox = environment.kind === 'sandbox';
  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1">
          <Link
            href="/console"
            title="Console overview — the frozen registry root module"
            className="flex min-h-11 items-center gap-2 text-base font-semibold text-stone-900"
          >
            <Terminal
              aria-hidden="true"
              focusable="false"
              className="h-5 w-5 text-teal-700"
            />
            PaySwap Console
          </Link>
          <p className="text-xs text-stone-500">Developer &amp; platform console</p>
        </div>
        <p className="text-xs text-stone-500">
          Role:{' '}
          <span data-testid="console-header-role" className="font-medium text-stone-700">
            {audienceLabel(role)}
          </span>
          <span> · resolved server-side</span>
        </p>
      </div>
      {/*
       * Environment label (environment-banner pattern): a named note whose
       * value is a server-resolved prop. The root shell banner already pins
       * the product-wide signal; this is the console's own server-derived
       * label from the PC-001 context (source + derivation included).
       */}
      <p
        role="note"
        aria-label={`Console environment: ${environment.kind}`}
        data-testid="console-header-environment"
        className={`border-t px-1 py-1.5 text-xs ${
          sandbox ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-stone-300 bg-stone-100 text-stone-700'
        }`}
      >
        Environment: <strong className="font-semibold">{environment.kind}</strong> ·{' '}
        {environment.configuredValue} · derived by {environment.derivedBy} configuration
        only — client input cannot select production/test.
      </p>
    </header>
  );
}
