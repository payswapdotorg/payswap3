/**
 * PC-001 — Server-derived console environment context.
 *
 * Wraps the EXISTING environment authority — there is no new environment
 * source and no second derivation chain:
 *   - `getEnvironment()` / `describeEnvironment()` (src/lib/environment.ts):
 *     the ONLY chain that sets the environment signal is
 *     PAYSWAP_ENV → allowlist {sandbox, production} → fail-safe sandbox.
 *     URL parameters, user content, and client state never participate
 *     (UX contract Section 10; design §2 "environment-aware behavior ...
 *     from explicit server-side configuration, never from user-controlled
 *     state").
 *   - `validateStartupConfig()` (src/lib/startup-config.ts, DEP-002): the
 *     fail-closed per-environment required-configuration check (names only,
 *     never values), surfaced so PC-006's deployment contract has a
 *     foundation and the console can never claim production wiring that
 *     configuration does not explicitly provide.
 *
 * PROOF that client input cannot select production/test:
 *   - `getConsoleEnvironmentContext()` accepts NO arguments (type-level:
 *     no request, headers, cookies, searchParams, or client value can even
 *     be passed);
 *   - this module imports ONLY the two frozen server authorities above —
 *     no request-scoped module is reachable from here (machine-checked by
 *     the import-allowlist test in environment-context.test.ts);
 *   - the fail-safe rule holds end-to-end: unset/invalid PAYSWAP_ENV
 *     resolves to sandbox, so the console can never present sandbox
 *     execution as production execution (N4).
 *
 * Server-side only: reads process.env (through the frozen module) and is
 * consumed by server components/routes; client components receive the
 * resolved context as props.
 */

import { describeEnvironment } from '@/lib/environment';
import { validateStartupConfig } from '@/lib/startup-config';
import type { ConsoleEnvironmentContext } from './types';

/**
 * Resolve the console environment context from the server-side
 * configuration authority. Takes NO input by design: query params, headers,
 * cookies, and any client state are structurally unable to select
 * production/test through this boundary.
 */
export function getConsoleEnvironmentContext(): ConsoleEnvironmentContext {
  const report = describeEnvironment();
  const startup = validateStartupConfig();
  return {
    kind: report.kind,
    configuredValue: report.configuredValue,
    source: report.source,
    derivedBy: 'server',
    startupConfiguration: {
      ok: startup.ok,
      env: startup.env,
      checks: startup.checks.map((check) => ({
        id: check.id,
        ok: check.ok,
        detail: check.detail,
      })),
    },
  };
}
