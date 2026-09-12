/**
 * ════════════════════════════════════════════════════════════════════════
 *  MOCK LIQUIDITY AUTHORITY — RETIRED (UI-011) · verification-support shim
 * ════════════════════════════════════════════════════════════════════════
 *
 * UI-011 retired the mock liquidity authority: the liquidity port
 * (src/lib/protocol/liquidity-port.ts) is now backed by the RUNTIME
 * ADAPTER FACTORY over the composed A06 Liquidity / A07 Credit / A08
 * Queue authorities (src/lib/protocol/runtime-liquidity-adapter.ts). This
 * module is no longer a port backing and implements NO authority
 * semantics and holds NO sandbox figures.
 *
 * WHY THIS FILE STILL EXISTS (recorded deviation, stated honestly): the
 * read-only surfaces frozen by UI-007 (src/app/(provider)/liquidity/
 * page.tsx, src/app/(operator)/oversight/page.tsx, and
 * src/app/verification/liquidity-flow/page.tsx import
 * readSandboxOverridesFromCurrentRequest, MOCK_LIQUIDITY_SANDBOX_COOKIE,
 * and getMockSurfacePermissions BY PATH) — and the work order forbids
 * changing product surfaces. The retained exports are exactly those
 * verification/permission-mirror helpers: the sandbox-override reader
 * (the harness's scripting of the read's availability axis, honored by
 * the runtime adapter factory through the port accessor) and the surface
 * permission mirror (the P8 role mirror the page guards encode).
 */

import { cookies } from 'next/headers';
import type {
  LiquidityAuthorityOwner,
  LiquiditySandboxOverrides,
  LiquiditySurfaceId,
  LiquidityValueSourceId,
} from './liquidity-port';
import type { NavAudience } from '@/lib/navigation';

export type { LiquiditySandboxOverrides } from './liquidity-port';

export const MOCK_LIQUIDITY_SANDBOX_COOKIE = 'ui007-liquidity-sandbox-unknown-sources';

const VALID_SOURCE_IDS: readonly string[] = [
  'provider.position.balance',
  'provider.position.reserved',
  'provider.position.available',
  'provider.credit.limit',
  'provider.credit.utilized',
  'provider.credit.remaining',
  'queue.entry.position',
  'queue.snapshot.depth',
  'oversight.aggregate.total-reserved',
  'oversight.aggregate.queue-depth',
  'oversight.aggregate.credit-utilized',
];

/**
 * Reads the harness-scripted UNKNOWN sources from the request cookie.
 * Invalid or unknown ids are ignored — the scripting can never invent
 * value sources. The overrides flow to the runtime adapter factory via
 * getLiquidityPort(overrides) (the frozen accessor signature).
 */
export async function readSandboxOverridesFromCurrentRequest(): Promise<LiquiditySandboxOverrides> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(MOCK_LIQUIDITY_SANDBOX_COOKIE)?.value;
  if (typeof raw !== 'string' || raw.length === 0) {
    return { unknownSources: [] };
  }
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (!Array.isArray(parsed)) {
      return { unknownSources: [] };
    }
    const unknownSources = parsed.filter(
      (id): id is LiquidityValueSourceId =>
        typeof id === 'string' && VALID_SOURCE_IDS.includes(id),
    );
    return { unknownSources };
  } catch {
    return { unknownSources: [] };
  }
}

// ---------------------------------------------------------------------------
// Per-role visibility (the P8 permission mirror the page guards encode)
// ---------------------------------------------------------------------------

export interface MockSurfacePermission {
  readonly surface: LiquiditySurfaceId;
  readonly permittedAudiences: readonly NavAudience[];
  readonly owningAuthorities: readonly LiquidityAuthorityOwner[];
  readonly pageGuard: string;
}

const SURFACE_PERMISSIONS: readonly MockSurfacePermission[] = [
  {
    surface: 'provider-positions',
    permittedAudiences: ['provider'],
    owningAuthorities: ['Liquidity Authority', 'Credit Authority'],
    pageGuard: "requireRoleSurface('provider')",
  },
  {
    surface: 'operator-oversight',
    permittedAudiences: ['operator'],
    owningAuthorities: ['Liquidity Authority', 'Credit Authority'],
    pageGuard: "requireRoleSurface('operator')",
  },
];

export function getMockSurfacePermissions(): readonly MockSurfacePermission[] {
  return SURFACE_PERMISSIONS;
}
