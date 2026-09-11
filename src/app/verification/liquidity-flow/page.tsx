// ============================================================================
// UI-007 — Verification route for the liquidity, credit, and queue flow
// (deliverable 10).
// ----------------------------------------------------------------------------
// Gathers the harness data server-side:
//   - the current (cookie-simulated) audience,
//   - the currently scripted authority-UNKNOWN sources,
//   - demonstration views in the provider and operator surface shapes
//     (sandbox mock data, presentation-only, NON-AUTHORITATIVE),
//   - the role-visibility matrix (statuses only — never another role's data),
//   - provenance-wording rows derived from the live query.
// ============================================================================

import type { Metadata } from 'next';

import {
  LiquidityFlowHarness,
  type ProvenanceRow,
  type RoleMatrixRow,
} from '@/components/verification/liquidity-flow-harness';
import type { NavAudience } from '@/lib/navigation';
import {
  LIQUIDITY_VALUE_SOURCES,
  getLiquidityPort,
} from '@/lib/protocol/liquidity-port';
import {
  mapCreditPosition,
  mapLiquidityPosition,
  mapOperatorOversightView,
  mapQueueSnapshot,
  provenanceWordingForCell,
} from '@/lib/protocol/liquidity-state-mapping';
import {
  MOCK_LIQUIDITY_SANDBOX_COOKIE,
  getMockSurfacePermissions,
  readSandboxOverridesFromCurrentRequest,
} from '@/lib/protocol/mock-liquidity-authority';
import { resolveShellAudience } from '@/lib/shell-audience-server';

export const metadata: Metadata = {
  title: 'UI-007 verification — liquidity, credit & queue visibility',
  description:
    'Verification harness for the read-only liquidity, credit, and queued-position visibility surfaces.',
};

const AUDIENCES: readonly NavAudience[] = [
  'unauthenticated',
  'customer',
  'merchant',
  'provider',
  'operator',
  'administrator',
];

export default async function LiquidityFlowVerificationPage() {
  const currentAudience = await resolveShellAudience();
  const overrides = await readSandboxOverridesFromCurrentRequest();
  const port = getLiquidityPort(overrides);

  // Demonstration views in the two surface shapes. These are sandbox mock
  // data, presentation-only and NON-AUTHORITATIVE — the harness labels them
  // as such. The live surfaces themselves remain role-gated.
  const [providerResult, oversightResult] = await Promise.all([
    port.getProviderPositions({ kind: 'provider-positions', requester: 'provider' }),
    port.getOperatorOversight({ kind: 'operator-oversight', requester: 'operator' }),
  ]);
  if (providerResult.kind !== 'permitted' || oversightResult.kind !== 'permitted') {
    throw new Error('Mock authority unexpectedly denied the demonstration queries.');
  }

  // Role-visibility matrix: statuses only, never data (no cross-role leak).
  const permissions = getMockSurfacePermissions();
  const roleMatrix: readonly RoleMatrixRow[] = AUDIENCES.map((audience) => {
    const providerSurface = permissions
      .find((p) => p.surface === 'provider-positions')
      ?.permittedAudiences.includes(audience);
    const oversightSurface = permissions
      .find((p) => p.surface === 'operator-oversight')
      ?.permittedAudiences.includes(audience);
    return {
      audience,
      providerSurface: providerSurface ? 'permitted' : 'redirected',
      oversightSurface: oversightSurface ? 'permitted' : 'redirected',
    };
  });

  // Provenance-wording rows derived from the live (scripted) query.
  const provenanceRows: ProvenanceRow[] = [];
  for (const position of providerResult.view.liquidity) {
    const mapped = mapLiquidityPosition(position);
    provenanceRows.push(
      { group: `Liquidity · balance (${mapped.positionId})`, owner: 'Liquidity Authority', state: mapped.cells.balance.kind === 'unknown' ? 'unknown' : 'quoted', wording: provenanceWordingForCell(mapped.cells.balance) },
      { group: `Liquidity · reserved (${mapped.positionId})`, owner: 'Liquidity Authority', state: mapped.cells.reserved.kind === 'unknown' ? 'unknown' : 'quoted', wording: provenanceWordingForCell(mapped.cells.reserved) },
      { group: `Liquidity · available (${mapped.positionId})`, owner: 'Liquidity Authority', state: mapped.cells.available.kind === 'unknown' ? 'unknown' : 'quoted', wording: provenanceWordingForCell(mapped.cells.available) }
    );
  }
  for (const position of providerResult.view.credit) {
    const mapped = mapCreditPosition(position);
    provenanceRows.push(
      { group: `Credit · limit (${mapped.positionId})`, owner: 'Credit Authority', state: mapped.cells.creditLimit.kind === 'unknown' ? 'unknown' : 'quoted', wording: provenanceWordingForCell(mapped.cells.creditLimit) },
      { group: `Credit · utilized (${mapped.positionId})`, owner: 'Credit Authority', state: mapped.cells.utilized.kind === 'unknown' ? 'unknown' : 'quoted', wording: provenanceWordingForCell(mapped.cells.utilized) },
      { group: `Credit · remaining (${mapped.positionId})`, owner: 'Credit Authority', state: mapped.cells.remaining.kind === 'unknown' ? 'unknown' : 'quoted', wording: provenanceWordingForCell(mapped.cells.remaining) }
    );
  }
  for (const snapshot of providerResult.view.queues) {
    const mapped = mapQueueSnapshot(snapshot);
    provenanceRows.push({
      group: `Queue · depth (${mapped.queueName})`,
      owner: 'Liquidity Authority',
      state: mapped.depth.kind === 'unknown' ? 'unknown' : 'quoted',
      wording: provenanceWordingForCell(mapped.depth),
    });
    for (const entry of mapped.entries) {
      provenanceRows.push({
        group: `Queue · position (${entry.entryId})`,
        owner: 'Liquidity Authority',
        state: entry.position.kind === 'unknown' ? 'unknown' : 'quoted',
        wording: provenanceWordingForCell(entry.position),
      });
    }
  }
  for (const aggregate of mapOperatorOversightView(oversightResult.view).aggregates) {
    provenanceRows.push({
      group: `Oversight · ${aggregate.label}`,
      owner: aggregate.reportedBy,
      state: aggregate.value.kind === 'unknown' ? 'unknown' : 'quoted',
      wording: provenanceWordingForCell(aggregate.value),
    });
  }

  return (
    <LiquidityFlowHarness
      currentAudience={currentAudience}
      audiences={AUDIENCES}
      unknownSources={overrides.unknownSources}
      sourceCatalog={LIQUIDITY_VALUE_SOURCES.map((source) => ({
        id: source.id,
        label: source.label,
        surface: source.surface,
        owner: source.owner,
      }))}
      roleMatrix={roleMatrix}
      provenanceRows={provenanceRows}
      providerView={providerResult.view}
      oversightView={oversightResult.view}
      sandboxCookieName={MOCK_LIQUIDITY_SANDBOX_COOKIE}
    />
  );
}
