/**
 * PC-003 — Console capabilities API.
 *
 * GET /api/console/capabilities — the capabilities read model behind the
 * frozen console.capabilities module (provider-only per the frozen
 * route-role matrix, mirroring the provider-audience product capabilities
 * surface).
 *
 * Boundary order (design §8): server-side role check FIRST (fail-closed 404
 * with no content), then the SYS-001 server wiring, then the read
 * composition, then DTO normalization. The handler takes NO request input at
 * all — availability is never inferred from configuration or query state
 * (design §13); it comes only from the capability authority's report.
 */

import { NextResponse } from 'next/server';
import { authorizeConsoleApiRead } from '@/lib/console/authority/route-access';
import {
  consoleApiDeniedBody,
  consoleApiReadResponseBody,
} from '@/lib/console/authority/api-envelope';
import { ensureProductPortsWired } from '@/lib/protocol/server-composition';
import { readConsoleCapabilities } from '@/lib/console/read-models/capabilities';

export const dynamic = 'force-dynamic';

export async function GET() {
  const access = await authorizeConsoleApiRead('console.capabilities');
  if (!access.allowed) {
    return NextResponse.json(consoleApiDeniedBody(), {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  // SYS-001 (D-2): ensure this route's module graph resolves the
  // runtime-backed port adapters before the read model resolves the ports.
  await ensureProductPortsWired();
  const result = await readConsoleCapabilities();
  return NextResponse.json(consoleApiReadResponseBody(access.principal.role, result), {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
