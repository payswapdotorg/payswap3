/**
 * PC-004 — Capabilities view tests.
 *
 * Proven here:
 *   - the two-axis truth renders verbatim (capability state + source
 *     availability) with boundary facts and attribution;
 *   - per-item availability-UNKNOWN is preserved (design §13): an item with
 *     no authoritative report renders UNKNOWN — never an outcome, never an
 *     inferred availability;
 *   - an empty registry is the authority's legitimate VALUE;
 *   - an unavailable read renders UNKNOWN — never a business verdict.
 */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConsoleAuthorityMetadata, ConsoleReadResult } from '@/lib/console/types';
import type { ConsoleCapabilitiesDto } from '@/lib/console/read-models/capabilities';
import { ConsoleCapabilitiesView } from './capabilities-view';

const AUTHORITY: ConsoleAuthorityMetadata = {
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
    authority: AUTHORITY,
  };
}

function unavailable(): ConsoleReadResult<ConsoleCapabilitiesDto> {
  return {
    outcome: 'unavailable',
    presentationStatus: 'UNKNOWN',
    note: 'The fixture capabilities read could not reach its owning authority. This is a transport/infrastructure failure, not a business outcome — the DTO stays UNKNOWN.',
    authority: AUTHORITY,
  };
}

describe('PC-004 capabilities view', () => {
  test('renders the two-axis truth verbatim with boundary facts and attribution', () => {
    const html = renderToStaticMarkup(
      <ConsoleCapabilitiesView
        result={capabilitiesValue([
          {
            capabilityId: 'cap_fixture_1',
            name: 'Fixture Card Rail',
            category: 'card',
            authorityState: 'available',
            sourceAvailability: 'reachable',
            displayStatus: 'SUCCEEDED',
            mappingRecord: 'CAP-MAP-001 (spec/product/capability-mapping-records.md)',
            reportedBy: 'A03 fixture',
            reportedAt: '2026-09-15T10:00:00.000Z',
            evidence: { label: 'capability evidence', href: '/evidence/cap_fixture_1' },
          },
        ])}
      />,
    );
    expect(html).toContain('data-console-capability="cap_fixture_1"');
    expect(html).toContain('Fixture Card Rail');
    expect(html).toContain('available');
    expect(html).toContain('reachable');
    expect(html).toContain('CAP-MAP-001');
    expect(html).toContain('LIVE');
    expect(html).toContain('Capability/Routing Authority (spec/architecture/v0.1)');
    expect(html).toContain('capability evidence');
    expect(html).toContain('Capability/Routing Authority (A03) — fixture');
    // Layout safety.
    expect(html.includes('<table')).toBe(false);
    expect(html).toContain('min-w-0');
    expect(html).toContain('break-all');
  });

  test('per-item availability-UNKNOWN is preserved — never an outcome, never inferred', () => {
    const html = renderToStaticMarkup(
      <ConsoleCapabilitiesView
        result={capabilitiesValue([
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
    expect(html).toContain('data-console-status="UNKNOWN"');
    expect(html).toContain('no authoritative report — availability is UNKNOWN, never inferred');
    // No business verdict for the unreported item.
    expect(html.includes('data-console-status="SUCCEEDED"')).toBe(false);
    expect(html.includes('data-console-status="FAILED"')).toBe(false);
  });

  test('an empty registry is the authority’s legitimate VALUE', () => {
    const html = renderToStaticMarkup(
      <ConsoleCapabilitiesView result={capabilitiesValue([])} />,
    );
    expect(html).toContain('data-testid="console-capabilities-empty-value"');
    expect(html.includes('data-console-status="UNKNOWN"')).toBe(false);
  });

  test('an unavailable read renders UNKNOWN — never a business verdict', () => {
    const html = renderToStaticMarkup(<ConsoleCapabilitiesView result={unavailable()} />);
    expect(html).toContain('data-console-read="unavailable"');
    expect(html).toContain('data-console-status="UNKNOWN"');
    expect(html.includes('data-console-status="FAILED"')).toBe(false);
    expect(html.includes('data-console-status="SUCCEEDED"')).toBe(false);
  });
});
