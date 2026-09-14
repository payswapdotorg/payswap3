/**
 * PC-003 — Console developer requests API (the request-log read scaffold).
 *
 * GET /api/console/developers/requests — the developer request-log scaffold
 * PC-005 will consume, behind the frozen console.developers.logs module
 * (merchant-only per the frozen route-role matrix).
 *
 * At this baseline NO request-log authority or persistence exists (the
 * recorded design §17 gap): the read composes no source and answers the
 * UNAVAILABLE branch — presentation UNKNOWN with the owning-authority gap in
 * the attached metadata — and fabricates nothing. The boundary order is
 * still enforced exactly: server-side role check FIRST (fail-closed 404 with
 * no content), then the (scaffold) read, then DTO normalization. When PC-005
 * wires the real request-boundary source, the route shape and the redaction
 * path (scrubCredentialReferences inside the record normalizer) stay.
 *
 * The handler takes NO request input: no query parameter filters log reads
 * here (filtering belongs to the PC-005 boundary design).
 */

import { NextResponse } from 'next/server';
import { authorizeConsoleApiRead } from '@/lib/console/authority/route-access';
import {
  consoleApiDeniedBody,
  consoleApiReadResponseBody,
} from '@/lib/console/authority/api-envelope';
import { readConsoleDeveloperRequests } from '@/lib/console/read-models/developer-requests';

export const dynamic = 'force-dynamic';

export async function GET() {
  const access = await authorizeConsoleApiRead('console.developers.logs');
  if (!access.allowed) {
    return NextResponse.json(consoleApiDeniedBody(), {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  const result = await readConsoleDeveloperRequests();
  return NextResponse.json(consoleApiReadResponseBody(access.principal.role, result), {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
