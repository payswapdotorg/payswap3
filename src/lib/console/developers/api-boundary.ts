/**
 * PC-005 — The console developer write-boundary helpers (the dedicated
 * credential boundary's response envelope + boundary logging).
 *
 * The read routes under src/app/api/console/** respond with the PC-003
 * envelope ({ok, principal, environment, result} — api-envelope.ts). The
 * PC-005 credential boundary WRITES (create/revoke), so this module gives
 * the write responses the SAME outer shape (stable contract for the
 * documentation examples) with the write result in `result`, plus:
 *
 *   - the same denial convention (404 {ok:false}, no content — imported
 *     from the PC-003 helper, not duplicated);
 *   - the same server-derived environment attachment (the PC-001 no-input
 *     context — no request value participates);
 *   - ingestConsoleBoundaryRequest(): the ONE ingestion hook the PC-005
 *     boundary routes call, feeding the diagnostic request-log ring with
 *     method/path/status/event — payload-free by construction (no labels,
 *     no ids, no secrets ever enter the log data; the outcome word only).
 */

import { getConsoleEnvironmentContext } from '../environment-context';
import type { ConsoleEnvironmentContext } from '../types';
import { consoleApiDeniedBody } from '../authority/api-envelope';
import type { Role } from '@/lib/navigation';
import { ingestDeveloperRequestLog } from './request-log-store';
import { scrubCredentialReferences } from '@/lib/observability/logging';

/** The write-response body (the read envelope's outer shape; result: T). */
export interface ConsoleDeveloperWriteResponseBody<T> {
  readonly ok: true;
  readonly principal: { readonly role: Role };
  readonly environment: ConsoleEnvironmentContext;
  readonly result: T;
}

/** Build the authorized write response body (server-derived environment). */
export function consoleDeveloperWriteResponseBody<T>(
  role: Role,
  result: T,
): ConsoleDeveloperWriteResponseBody<T> {
  return {
    ok: true,
    principal: { role },
    environment: getConsoleEnvironmentContext(),
    result,
  };
}

export { consoleApiDeniedBody };

/**
 * The boundary request outcome word (the ONLY payload that enters the
 * request log from a credential operation — never labels, ids, or secrets).
 */
export type ConsoleBoundaryOutcome =
  | 'listed'
  | 'created'
  | 'revoked'
  | 'denied'
  | 'invalid-input'
  | 'unknown-target'
  | 'already-revoked';

/**
 * Ingest one boundary request into the diagnostic request-log ring.
 * Payload-free: the data is exactly {method, status, outcome} — the ring
 * entry's `path` is the constant route pathname (query strings never
 * enter: receipt ids and spoofed selectors are structurally absent).
 */
export function ingestConsoleBoundaryRequest(input: {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: '/api/console/developers/api-keys' | '/api/console/developers/webhooks';
  readonly status: number;
  readonly event: string;
  readonly outcome: ConsoleBoundaryOutcome;
}): void {
  ingestDeveloperRequestLog({
    method: input.method,
    path: input.path,
    status: input.status,
    event: input.event,
    // The scrub runs at ingestion anyway; the payload is secret-free here
    // BY CONSTRUCTION (outcome word only).
    data: { outcome: input.outcome },
  });
}

/** Safely stringify an error for a redirect error flag (never raw input). */
export function boundaryErrorFlag(error: string): string {
  return String(scrubCredentialReferences(error)).slice(0, 64);
}
