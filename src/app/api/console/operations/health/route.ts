/**
 * PC-003 — Console operations health API.
 *
 * GET /api/console/operations/health — the composite operations-health read
 * model serving the six frozen operations modules (queues / execution /
 * reconciliation / unknown / clearing-netting / incidents — all operator-only
 * in the frozen registry). Authorization is the registry-DERIVED
 * intersection of those modules' allowed roles (see
 * src/lib/console/authority/route-access.ts) — currently operator-only,
 * mechanically derived from the frozen registry, never hard-coded here.
 *
 * Boundary order (design §8): server-side role check FIRST (fail-closed 404
 * with no content), then the read composition over the existing
 * observability probe (the same composition point /api/ready enriches
 * through — no port wiring needed for this read), then DTO normalization.
 * The handler takes NO request input at all: the health answer comes only
 * from the observability authority.
 */

import { NextResponse } from 'next/server';
import { authorizeConsoleOperationsRead } from '@/lib/console/authority/route-access';
import {
  consoleApiDeniedBody,
  consoleApiReadResponseBody,
} from '@/lib/console/authority/api-envelope';
import { readConsoleOperationsHealth } from '@/lib/console/read-models/operations-health';

export const dynamic = 'force-dynamic';

export async function GET() {
  const access = await authorizeConsoleOperationsRead();
  if (!access.allowed) {
    return NextResponse.json(consoleApiDeniedBody(), {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  const result = await readConsoleOperationsHealth();
  return NextResponse.json(consoleApiReadResponseBody(access.principal.role, result), {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
