/**
 * PC-003 — Console payment detail API.
 *
 * GET /api/console/payments/[paymentId] — the flagship payment-detail read
 * model behind the frozen console.payments.detail module (customer,
 * merchant, operator per the frozen route-role matrix).
 *
 * Boundary order (design §8): server-side role check FIRST (fail-closed 404
 * with no content), then the SYS-001 server wiring, then the read
 * composition, then DTO normalization. The request body/query is never read:
 * only the dynamic route segment identifies the reference, and a reference
 * the authority cannot answer for is the UNKNOWN envelope branch — never a
 * 404, never "not found" failure (the product pay-page convention, design
 * §7/§9). AUTHORIZATION denial is the only 404 on this surface.
 */

import { NextResponse } from 'next/server';
import { authorizeConsoleApiRead } from '@/lib/console/authority/route-access';
import {
  consoleApiDeniedBody,
  consoleApiReadResponseBody,
} from '@/lib/console/authority/api-envelope';
import { ensureProductPortsWired } from '@/lib/protocol/server-composition';
import { readConsolePaymentDetail } from '@/lib/console/read-models/payments';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const access = await authorizeConsoleApiRead('console.payments.detail');
  if (!access.allowed) {
    return NextResponse.json(consoleApiDeniedBody(), {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  const { paymentId } = await params;
  // SYS-001 (D-2): ensure this route's module graph resolves the
  // runtime-backed port adapters before the read model resolves the ports.
  await ensureProductPortsWired();
  const result = await readConsolePaymentDetail(paymentId, access.principal.role);
  return NextResponse.json(consoleApiReadResponseBody(access.principal.role, result), {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
