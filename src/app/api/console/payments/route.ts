/**
 * PC-003 — Console payments list API.
 *
 * GET /api/console/payments — the payment-list read model behind the frozen
 * console.payments.all module (customer, merchant, operator per the frozen
 * route-role matrix).
 *
 * Boundary order (design §8): server-side role check FIRST (fail-closed 404
 * with no content — the PC-001 contracts convention; the module never
 * confirms its existence to a caller that is not explicitly allowed), then
 * the SYS-001 server wiring (ensureProductPortsWired — the same seam the
 * product routes use), then the read composition (the payments read model),
 * then DTO normalization into the PC-001 envelope. The handler takes NO
 * request input at all: no query parameter, header, or body value can affect
 * the principal, the environment, or the read (the environment is
 * server-derived inside the response envelope).
 */

import { NextResponse } from 'next/server';
import { authorizeConsoleApiRead } from '@/lib/console/authority/route-access';
import {
  consoleApiDeniedBody,
  consoleApiReadResponseBody,
} from '@/lib/console/authority/api-envelope';
import { ensureProductPortsWired } from '@/lib/protocol/server-composition';
import { readConsolePayments } from '@/lib/console/read-models/payments';

export const dynamic = 'force-dynamic';

export async function GET() {
  const access = await authorizeConsoleApiRead('console.payments.all');
  if (!access.allowed) {
    return NextResponse.json(consoleApiDeniedBody(), {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  // SYS-001 (D-2): ensure this route's module graph resolves the
  // runtime-backed port adapters before the read model resolves the ports.
  await ensureProductPortsWired();
  const result = await readConsolePayments(access.principal.role);
  return NextResponse.json(consoleApiReadResponseBody(access.principal.role, result), {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
