/**
 * PC-003 — Console checkout sessions list API.
 *
 * GET /api/console/checkout/sessions — the checkout-sessions read model
 * behind the frozen console.checkout.sessions module (merchant-only per the
 * frozen route-role matrix, mirroring the merchant-audience product checkout
 * surface).
 *
 * Boundary order (design §8): server-side role check FIRST (fail-closed 404
 * with no content), then the SYS-001 server wiring, then the read
 * composition, then DTO normalization. The handler takes NO request input at
 * all: no query parameter, header, or body value can affect the principal,
 * the environment, or the read.
 */

import { NextResponse } from 'next/server';
import { authorizeConsoleApiRead } from '@/lib/console/authority/route-access';
import {
  consoleApiDeniedBody,
  consoleApiReadResponseBody,
} from '@/lib/console/authority/api-envelope';
import { ensureProductPortsWired } from '@/lib/protocol/server-composition';
import { readConsoleCheckoutSessions } from '@/lib/console/read-models/checkout-sessions';

export const dynamic = 'force-dynamic';

export async function GET() {
  const access = await authorizeConsoleApiRead('console.checkout.sessions');
  if (!access.allowed) {
    return NextResponse.json(consoleApiDeniedBody(), {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  // SYS-001 (D-2): ensure this route's module graph resolves the
  // runtime-backed port adapters before the read model resolves the ports.
  await ensureProductPortsWired();
  const result = await readConsoleCheckoutSessions();
  return NextResponse.json(consoleApiReadResponseBody(access.principal.role, result), {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
