/**
 * PC-004 — Accounts views tests (honest gap projections + the provider-side
 * capability projection).
 *
 * Proven here:
 *   - the account gap views render UNKNOWN for the account listing and
 *     NEVER a fabricated account list (no names, no emails, no ids that no
 *     authority quoted);
 *   - the provider projection composes the capability read model with
 *     per-item UNKNOWN preserved, and the identity/profile gap still
 *     renders;
 *   - attribution is present on every gap projection.
 */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConsoleAuthorityMetadata, ConsoleReadResult } from '@/lib/console/types';
import type { ConsoleCapabilitiesDto } from '@/lib/console/read-models/capabilities';
import { ConsoleAccountGapView, ConsoleProviderAccountView } from './accounts-views';

const CAPABILITY_AUTHORITY: ConsoleAuthorityMetadata = {
  view: 'console.capabilities — fixture',
  protocolObject: 'fixture A03 capability state',
  owningAuthority: 'Capability/Routing Authority (A03) — fixture',
  runtimeBoundary: 'getCapabilityPort() — fixture boundary',
  durableSource: 'the durable substrate + A03 registry — fixture',
  unknownSemantics: 'unavailable ⇒ UNKNOWN: report:null is the absence of an answer.',
  evidenceReference: 'CAP-MAP-001..006 (spec/product/capability-mapping-records.md)',
};

function capabilitiesValue(
  capabilities: ConsoleCapabilitiesDto['capabilities'],
): ConsoleReadResult<ConsoleCapabilitiesDto> {
  return {
    outcome: 'value',
    value: {
      capabilities,
      boundary: {
        runtime: 'LIVE',
        backing: 'the composed runtime — fixture',
        authoritative: true,
        authorityOwner: 'Capability/Routing Authority (spec/architecture/v0.1)',
        notes: 'fixture boundary notes',
      },
      generatedAt: '2026-09-15T10:00:00.000Z',
    },
    status: 'SUCCEEDED',
    authority: CAPABILITY_AUTHORITY,
  };
}

describe('PC-004 account gap views (customers / merchants / operators)', () => {
  for (const audience of ['customers', 'merchants', 'operators'] as const) {
    test(`the ${audience} projection renders the honest gap — never a fabricated account list`, () => {
      // Mirrors the page composition: merchants/operators pages add one
      // audience-specific inventory line on top of the shared inventory.
      const extraInventory =
        audience === 'merchants' || audience === 'operators'
          ? ['audience-specific fixture inventory line']
          : undefined;
      const html = renderToStaticMarkup(
        <ConsoleAccountGapView audience={audience} extraInventory={extraInventory} />,
      );
      expect(html).toContain('data-console-gap="true"');
      expect(html).toContain('data-console-status="UNKNOWN"');
      expect(html).toContain('account authority or account read exists');
      // No fabricated account rows: no list items beyond the inventory bullets.
      const listItems = html.split('<li').length - 1;
      const inventoryBullets = 3 + (extraInventory !== undefined ? 1 : 0);
      expect(listItems).toBe(inventoryBullets);
      // Attribution present.
      expect(html).toContain('none at this baseline');
      expect(html).toContain('spec/console/reconciliation-matrix.md');
    });
  }
});

describe('PC-004 provider account view (capability projection + identity gap)', () => {
  test('composes the capability projection with per-item UNKNOWN preserved', () => {
    const html = renderToStaticMarkup(
      <ConsoleProviderAccountView
        capabilities={capabilitiesValue([
          {
            capabilityId: 'cap_fixture_1',
            name: 'Fixture Card Rail',
            category: 'card',
            authorityState: 'available',
            sourceAvailability: 'reachable',
            displayStatus: 'SUCCEEDED',
            mappingRecord: 'CAP-MAP-001 (spec/product/capability-mapping-records.md)',
          },
          {
            capabilityId: 'cap_fixture_2',
            name: 'Fixture Unreported Rail',
            category: 'bank',
            sourceAvailability: 'unreachable',
            displayStatus: 'UNKNOWN',
            mappingRecord: 'CAP-MAP-006 (spec/product/capability-mapping-records.md)',
          },
        ])}
      />,
    );
    expect(html).toContain('data-console-view="accounts-providers"');
    // The projection renders with attribution from the capability authority.
    expect(html).toContain('data-console-capability="cap_fixture_1"');
    expect(html).toContain('available');
    expect(html).toContain('no authoritative report — availability UNKNOWN');
    expect(html).toContain('Capability/Routing Authority (A03) — fixture');
    // The identity/profile gap still renders.
    expect(html).toContain('No provider account/profile authority or account read exists');
    expect(html).toContain('data-console-gap="true"');
    // Layout safety.
    expect(html.includes('<table')).toBe(false);
    expect(html).toContain('min-w-0');
  });

  test('an unavailable capability projection renders UNKNOWN — the gap view stands on its own', () => {
    const html = renderToStaticMarkup(
      <ConsoleProviderAccountView
        capabilities={{
          outcome: 'unavailable',
          presentationStatus: 'UNKNOWN',
          note: 'The fixture capabilities read could not reach its owning authority. This is a transport/infrastructure failure, not a business outcome — the DTO stays UNKNOWN.',
          authority: CAPABILITY_AUTHORITY,
        }}
      />,
    );
    expect(html).toContain('data-console-read="unavailable"');
    expect(html).toContain('data-console-status="UNKNOWN"');
    // The identity gap still renders.
    expect(html).toContain('data-console-gap="true"');
  });

  test('an empty capability registry renders as the legitimate VALUE it is', () => {
    const html = renderToStaticMarkup(
      <ConsoleProviderAccountView capabilities={capabilitiesValue([])} />,
    );
    expect(html).toContain('data-testid="console-provider-capabilities-empty-value"');
  });
});
