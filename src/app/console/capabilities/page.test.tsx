/**
 * PC-004 — Capabilities page tests (composition through the REAL read model).
 *
 * The PC-003 read-model-test precedent: the capability port backing is
 * registered AT THE PORT'S OWN REGISTER SEAM ('next/headers' mocked for the
 * request-context chain, the SYS-001 wiring seam no-op'd) and the page then
 * composes the REAL PC-003 capabilities read model over that backing. No
 * read-model module is mocked (a bun test process shares the module registry
 * across files; a read-model mock would poison the PC-003 suites importing it
 * for real).
 *
 * Proven here:
 *   - provider (the only allowed role) receives the composed registry view
 *     with per-item UNKNOWN preserved and REAL source-registry attribution;
 *   - administrator is redirected before any read composes (the dedicated
 *     capabilities module is provider-only in the frozen matrix);
 *   - a transport failure of the port renders UNKNOWN — never a verdict.
 */

import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { registerCapabilityPortBacking } from '@/lib/protocol/capability-port';
import type {
  CapabilityItem,
  CapabilityListing,
  CapabilityPort,
  CapabilityReport,
} from '@/lib/protocol/capability-port';

let mockedAudienceCookie: string | undefined;

mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'payswap-shell-audience' ? { value: mockedAudienceCookie } : undefined,
  }),
}));

mock.module('@/lib/protocol/server-composition', () => ({
  ensureProductPortsWired: async () => {},
}));

// ── The capability-port test backing (the port's own register seam) ─────────

let listCallCount = 0;

const SOURCE = {
  id: 'src-page-1',
  name: 'Capability Authority runtime',
  authority: 'Capability/Routing Authority',
  availability: 'reachable',
} as const;

function pageItemFixture(
  id: string,
  report: CapabilityReport | null,
  sourceAvailability: CapabilityItem['source']['availability'] = 'reachable',
): CapabilityItem {
  return {
    descriptor: {
      id,
      name: `Page Fixture ${id === 'cap_page_1' ? 'Rail' : 'Unreported Rail'}`,
      summary: 'page-test summary',
      category: id === 'cap_page_1' ? 'payments' : 'settlement',
      composition: [],
    },
    report,
    source: { ...SOURCE, availability: sourceAvailability },
  };
}

function pageListingFixture(items: readonly CapabilityItem[]): CapabilityListing {
  return {
    items,
    sources: [SOURCE],
    boundary: {
      runtime: 'LIVE',
      authorityOwner: 'Capability/Routing Authority (A03, spec/architecture/v0.1)',
      backing: 'protocol-adapter',
      authoritative: true,
      notes: 'pc-004 page-test backing notes',
    },
    generatedAt: '2026-09-15T10:00:00.000Z',
  };
}

function capabilityBacking(list: () => CapabilityListing): CapabilityPort {
  return {
    boundary: pageListingFixture([]).boundary,
    async listCapabilities() {
      listCallCount += 1;
      return list();
    },
    async getCapability() {
      return null;
    },
  };
}

// The default backing: one reported available rail + one unreported rail
// (availability-unknown — the absence of an answer, never an outcome).
const DEFAULT_LISTING: CapabilityListing = pageListingFixture([
  {
    descriptor: { id: 'cap_page_1', name: 'Page Fixture Rail', summary: 'page-test summary', category: 'payments', composition: [] },
    report: {
      capabilityId: 'cap_page_1',
      state: 'available',
      reportedBy: 'A03 page-test backing',
      reportedAt: '2026-09-15T09:00:00.000Z',
      source: SOURCE,
    },
    source: { ...SOURCE, availability: 'reachable' },
  },
  pageItemFixture('cap_page_2', null, 'unreachable'),
]);

registerCapabilityPortBacking(capabilityBacking(() => DEFAULT_LISTING));

const ConsoleCapabilitiesPage = (await import('./page')).default;

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await ConsoleCapabilitiesPage());
}

describe('PC-004 /console/capabilities page — composition', () => {
  test('provider receives the composed registry with per-item UNKNOWN preserved', async () => {
    mockedAudienceCookie = 'provider';
    const html = await renderPage();
    expect(html).toContain('data-console-view="capabilities"');
    expect(html).toContain('data-console-capability="cap_page_1"');
    expect(html).toContain('data-console-status="SUCCEEDED"');
    expect(html).toContain('available');
    expect(html).toContain('no authoritative report — availability is UNKNOWN, never inferred');
    // The frozen two-axis mapping records render verbatim (the real
    // capability-state-mapping record ids).
    expect(html).toContain('CAP-MAP-001');
    expect(html).toContain('CAP-MAP-006');
    // Boundary facts verbatim from the port.
    expect(html).toContain('LIVE');
    expect(html).toContain('pc-004 page-test backing notes');
    // Attribution from the REAL source-registry metadata.
    expect(html).toContain('Capability/Routing Authority (A03, spec/architecture/v0.1)');
    expect(html).toContain('getCapabilityPort() (src/lib/protocol/capability-port.ts)');
    expect(listCallCount).toBeGreaterThan(0);
  });

  test('a transport failure of the port renders UNKNOWN — never a business verdict', async () => {
    registerCapabilityPortBacking(
      capabilityBacking(() => {
        throw new Error('page-test transport failure');
      }),
    );
    mockedAudienceCookie = 'provider';
    const html = await renderPage();
    expect(html).toContain('data-console-read="unavailable"');
    expect(html).toContain('data-console-status="UNKNOWN"');
    expect(html.includes('data-console-status="FAILED"')).toBe(false);
    expect(html.includes('data-console-status="SUCCEEDED"')).toBe(false);
    expect(html).toContain('transport/infrastructure failure, not a business outcome');
  });

  // Restore the default listing backing for any later consumer in this file.
  registerCapabilityPortBacking(capabilityBacking(() => DEFAULT_LISTING));
});

describe('PC-004 /console/capabilities page — role isolation', () => {
  test('administrator and every other non-provider role are redirected before any read composes', async () => {
    const before = listCallCount;
    for (const audience of ['customer', 'merchant', 'operator', 'administrator']) {
      mockedAudienceCookie = audience;
      let thrown: unknown;
      try {
        await renderPage();
      } catch (error) {
        thrown = error;
      }
      const digest = (thrown as { digest?: unknown })?.digest;
      expect(typeof digest).toBe('string');
      expect((digest as string).startsWith('NEXT_REDIRECT')).toBe(true);
    }
    expect(listCallCount).toBe(before);
  });
});
