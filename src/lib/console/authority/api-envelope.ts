/**
 * PC-003 — The console API read response envelope.
 *
 * Every console API read responds with the SAME server-derived envelope:
 *
 *   { ok: true, principal: { role }, environment, result }
 *
 *   - `principal` is the server-resolved role (the existing audience
 *     authority; never client-supplied);
 *   - `environment` is the PC-001 server-derived environment context —
 *     `getConsoleEnvironmentContext()` accepts NO input, so no query
 *     parameter, header, cookie, or body value can select
 *     production/sandbox through this boundary (design §2/§10; proven by
 *     tests that attempt exactly those spoofs);
 *   - `result` is the PC-001 ConsoleReadResult envelope (value |
 *     unavailable ⇒ presentationStatus UNKNOWN).
 *
 * Denial is the PC-001 contracts-route convention: 404 with { ok: false }
 * and NO other content — the console API never confirms a module's
 * existence to a caller that is not explicitly allowed.
 *
 * This module is PURE (no next/server import): it builds the JSON-able body;
 * the thin routes wrap it in NextResponse with force-dynamic + no-store
 * (the existing /api/health, /api/ready, /api/console/contracts convention).
 */

import { getConsoleEnvironmentContext } from '../environment-context';
import type { ConsoleEnvironmentContext, ConsoleReadResult } from '../types';
import type { Role } from '@/lib/navigation';

/** The denial body — 404 with no content beyond the bare marker. */
export function consoleApiDeniedBody(): { readonly ok: false } {
  return { ok: false };
}

/** The success body shape (the stable contract PC-004/PC-005 consume). */
export interface ConsoleApiReadResponseBody<T> {
  readonly ok: true;
  readonly principal: { readonly role: Role };
  readonly environment: ConsoleEnvironmentContext;
  readonly result: ConsoleReadResult<T>;
}

/**
 * Build the success body for an authorized read: the server-derived
 * environment is attached HERE (from the no-input PC-001 context function),
 * so every console API response carries the server-derived environment and
 * nothing from the request participates.
 */
export function consoleApiReadResponseBody<T>(
  role: Role,
  result: ConsoleReadResult<T>,
): ConsoleApiReadResponseBody<T> {
  return {
    ok: true,
    principal: { role },
    environment: getConsoleEnvironmentContext(),
    result,
  };
}
