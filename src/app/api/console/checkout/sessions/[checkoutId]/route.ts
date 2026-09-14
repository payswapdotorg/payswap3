/**
 * PC-003 — Console checkout session status API.
 *
 * GET /api/console/checkout/sessions/[checkoutId] — the per-session status
 * read behind the frozen console.checkout.sessions module (merchant-only per
 * the frozen route-role matrix).
 *
 * Boundary order (design §8): server-side role check FIRST (fail-closed 404
 * with no content), then the SYS-001 server wiring, then the read
 * composition, then DTO normalization. Only the dynamic route segment
 * identifies the reference; a reference the authority holds no record for is
 * the UNKNOWN envelope branch — never a 404, never a fabricated state (the
 * product checkout convention). AUTHORIZATION denial is the only 404 here.
 */

import { NextResponse } from 'next/server';
import { authorizeConsoleApiRead } from '@/lib/console/authority/route-access';
import {
  consoleApiDeniedBody,
  consoleApiReadResponseBody,
} from '@/lib/console/authority/api-envelope';
import { ensureProductPortsWired } from '@/lib/protocol/server-composition';
import { readConsoleCheckoutSessionStatus } from '@/lib/console/read-models/checkout-sessions';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ checkoutId: string }> },
) {
  const access = await authorizeConsoleApiRead('console.checkout.sessions');
  if (!access.allowed) {
    return NextResponse.json(consoleApiDeniedBody(), {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  const { checkoutId } = await params;
  // SYS-001 (D-2): ensure this route's module graph resolves the
  // runtime-backed port adapters before the read model resolves the ports.
  await ensureProductPortsWired();
  const result = await readConsoleCheckoutSessionStatus(checkoutId);
  return NextResponse.json(consoleApiReadResponseBody(access.principal.role, result), {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
