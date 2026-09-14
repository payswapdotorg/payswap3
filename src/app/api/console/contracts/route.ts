/**
 * PC-001 — Console contracts API (boundary scaffolding only).
 *
 * GET /api/console/contracts serves the frozen route/module registry and the
 * server-derived environment report — the two PC-001 foundation contracts —
 * behind the console role policy. NO financial reads and no feature data:
 * this is the boundary scaffold later console API work (PC-003) extends.
 *
 * Fail-closed authorization: the principal is resolved server-side from the
 * existing audience authority; an unauthenticated/unknown/unauthorized
 * caller receives 404 with no registry or environment content — the console
 * boundary does not confirm its existence to callers that are not
 * explicitly allowed (design §6: unauthorized deep links fail closed).
 *
 * Conventions follow the existing API boundaries (src/app/api/health/route.ts,
 * src/app/api/ready/route.ts): force-dynamic (per-request evaluation against
 * the live process environment — never statically prerendered or cached),
 * JSON responses with Cache-Control: no-store.
 */

import { NextResponse } from 'next/server';
import { authorizeConsoleModule, resolveConsolePrincipal } from '@/lib/console/policy';
import { CONSOLE_REGISTRY, CONSOLE_ROOT_MODULE_ID, consoleRegistrySummary } from '@/lib/console/registry';
import { getConsoleEnvironmentContext } from '@/lib/console/environment-context';
import { CONSOLE_STATUSES } from '@/lib/console/dto';

export const dynamic = 'force-dynamic';

export async function GET() {
  const principal = await resolveConsolePrincipal();
  const decision = authorizeConsoleModule(principal, CONSOLE_ROOT_MODULE_ID);
  if (!decision.allowed) {
    // Fail closed: no registry, no environment report, no role echo.
    return NextResponse.json(
      { ok: false },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const environment = getConsoleEnvironmentContext();
  return NextResponse.json(
    {
      ok: true,
      principal: { role: decision.role },
      registry: {
        summary: consoleRegistrySummary(),
        routes: CONSOLE_REGISTRY.map((entry) => ({
          id: entry.id,
          href: entry.href,
          label: entry.label,
          description: entry.description,
          group: entry.group,
          allowedRoles: entry.allowedRoles,
          status: entry.status,
        })),
      },
      environment,
      contracts: {
        statusVocabulary: CONSOLE_STATUSES,
        readEnvelope: 'ConsoleReadResult<T> = value|unavailable; unavailable ⇒ presentationStatus UNKNOWN (never FAILED/SUCCEEDED)',
        authorityMetadata: 'ConsoleAuthorityMetadata (nine-question discipline: view, protocolObject, owningAuthority, runtimeBoundary, durableSource, unknownSemantics, evidenceReference)',
      },
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
