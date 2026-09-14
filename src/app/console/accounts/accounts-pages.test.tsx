/**
 * PC-004 — Accounts pages tests (all four account modules at the page seam).
 *
 * The provider-side projection composes the REAL PC-003 capabilities read
 * model over a capability-port backing registered at the port's own register
 * seam (the PC-003 precedent — no read-model module is mocked: a bun test
 * process shares the module registry across files, and a read-model mock
 * would poison the PC-003 suites importing it for real). 'next/headers' is
 * mocked for the request-context chain; the wiring seam is no-op'd.
 *
 * Proven here:
 *   - role isolation per module (the frozen matrix: customers/operators are
 *     administrator-only; merchants is merchant+administrator; providers is
 *     provider+administrator) — denials redirect before any read composes;
 *   - the gap views render the honest recorded gap (no fabricated lists);
 *   - the providers page composes the capability projection (per-item
 *     UNKNOWN preserved) alongside its identity gap, with REAL
 *     source-registry attribution.
 */

import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { registerCapabilityPortBacking } from '@/lib/protocol/capability-port';
import type {
  CapabilityItem,
  CapabilityListing,
  CapabilityPort,
  CapabilityReport,
} from '@/lib/protocol/capability-port';

/** An async server-component page (renders a React element tree). */
type AsyncPage = () => Promise<ReactElement>;

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
  id: 'src-accounts-1',
  name: 'Capability Authority runtime',
  authority: 'Capability/Routing Authority',
  availability: 'reachable',
} as const;

function accountsItemFixture(
  id: string,
  report: CapabilityReport | null,
  sourceAvailability: CapabilityItem['source']['availability'] = 'reachable',
): CapabilityItem {
  return {
    descriptor: {
      id,
      name: id === 'cap_accounts_1' ? 'Accounts Fixture Rail' : 'Accounts Fixture Unreported Rail',
      summary: 'accounts page-test summary',
      category: id === 'cap_accounts_1' ? 'payments' : 'settlement',
      composition: [],
    },
    report,
    source: { ...SOURCE, availability: sourceAvailability },
  };
}

function accountsListingFixture(items: readonly CapabilityItem[]): CapabilityListing {
  return {
    items,
    sources: [SOURCE],
    boundary: {
      runtime: 'LIVE',
      authorityOwner: 'Capability/Routing Authority (A03, spec/architecture/v0.1)',
      backing: 'protocol-adapter',
      authoritative: true,
      notes: 'accounts page-test backing notes',
    },
    generatedAt: '2026-09-15T10:00:00.000Z',
  };
}

function capabilityBacking(list: () => CapabilityListing): CapabilityPort {
  return {
    boundary: accountsListingFixture([]).boundary,
    async listCapabilities() {
      listCallCount += 1;
      return list();
    },
    async getCapability() {
      return null;
    },
  };
}

// The default backing: one reported available rail + one unreported rail.
const DEFAULT_LISTING: CapabilityListing = accountsListingFixture([
  {
    descriptor: { id: 'cap_accounts_1', name: 'Accounts Fixture Rail', summary: 'accounts page-test summary', category: 'payments', composition: [] },
    report: {
      capabilityId: 'cap_accounts_1',
      state: 'available',
      reportedBy: 'A03 accounts page-test backing',
      reportedAt: '2026-09-15T09:00:00.000Z',
      source: SOURCE,
    },
    source: { ...SOURCE, availability: 'reachable' },
  },
  accountsItemFixture('cap_accounts_2', null, 'unreachable'),
]);

registerCapabilityPortBacking(capabilityBacking(() => DEFAULT_LISTING));

const AccountsCustomersPage = (await import('./customers/page')).default;
const AccountsMerchantsPage = (await import('./merchants/page')).default;
const AccountsProvidersPage = (await import('./providers/page')).default;
const AccountsOperatorsPage = (await import('./operators/page')).default;

/** Render one async page component to static markup. */
async function render(page: AsyncPage): Promise<string> {
  return renderToStaticMarkup(await page());
}

/** True when the page render redirects (the guard fired before content). */
async function renderRedirected(page: AsyncPage): Promise<boolean> {
  try {
    await page();
    return false;
  } catch (error) {
    const digest = (error as { digest?: unknown })?.digest;
    return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
  }
}

describe('PC-004 accounts pages — role isolation per module (the frozen matrix)', () => {
  test('customers (administrator-only): administrator passes; every other role redirects', async () => {
    mockedAudienceCookie = 'administrator';
    expect(await renderRedirected(AccountsCustomersPage)).toBe(false);
    for (const audience of ['customer', 'merchant', 'provider', 'operator']) {
      mockedAudienceCookie = audience;
      expect(await renderRedirected(AccountsCustomersPage)).toBe(true);
    }
  });

  test('merchants (merchant+administrator): both pass; every other role redirects', async () => {
    for (const audience of ['merchant', 'administrator']) {
      mockedAudienceCookie = audience;
      expect(await renderRedirected(AccountsMerchantsPage)).toBe(false);
    }
    for (const audience of ['customer', 'provider', 'operator']) {
      mockedAudienceCookie = audience;
      expect(await renderRedirected(AccountsMerchantsPage)).toBe(true);
    }
  });

  test('providers (provider+administrator): both pass; every other role redirects', async () => {
    for (const audience of ['provider', 'administrator']) {
      mockedAudienceCookie = audience;
      expect(await renderRedirected(AccountsProvidersPage)).toBe(false);
    }
    for (const audience of ['customer', 'merchant', 'operator']) {
      mockedAudienceCookie = audience;
      expect(await renderRedirected(AccountsProvidersPage)).toBe(true);
    }
  });

  test('operators (administrator-only): administrator passes; every other role redirects', async () => {
    mockedAudienceCookie = 'administrator';
    expect(await renderRedirected(AccountsOperatorsPage)).toBe(false);
    for (const audience of ['customer', 'merchant', 'provider', 'operator']) {
      mockedAudienceCookie = audience;
      expect(await renderRedirected(AccountsOperatorsPage)).toBe(true);
    }
  });
});

describe('PC-004 accounts pages — the honest gap projections (no fabricated lists)', () => {
  test('customers/merchants/operators pages render the recorded gap with attribution', async () => {
    mockedAudienceCookie = 'administrator';
    const customers = await render(AccountsCustomersPage);
    expect(customers).toContain('data-console-gap="true"');
    expect(customers).toContain('No customer account authority or account read exists');
    expect(customers).toContain('none at this baseline');

    const merchants = await render(AccountsMerchantsPage);
    expect(merchants).toContain('No merchant account authority or account read exists');
    expect(merchants).toContain('checkout sessions module');

    const operators = await render(AccountsOperatorsPage);
    expect(operators).toContain('No operator account authority or account read exists');
    expect(operators).toContain('operations modules');
  });

  test('the providers page composes the capability projection with per-item UNKNOWN preserved', async () => {
    const before = listCallCount;
    mockedAudienceCookie = 'provider';
    const html = await render(AccountsProvidersPage);
    expect(html).toContain('data-console-view="accounts-providers"');
    expect(html).toContain('data-console-capability="cap_accounts_1"');
    expect(html).toContain('data-console-status="SUCCEEDED"');
    expect(html).toContain('available');
    expect(html).toContain('no authoritative report — availability UNKNOWN');
    expect(html).toContain('CAP-MAP-001');
    expect(html).toContain('CAP-MAP-006');
    // The identity/profile gap still renders.
    expect(html).toContain('No provider account/profile authority or account read exists');
    expect(html).toContain('data-console-gap="true"');
    // Attribution from the REAL source-registry metadata (capability envelope).
    expect(html).toContain('Capability/Routing Authority (A03, spec/architecture/v0.1)');
    expect(listCallCount).toBe(before + 1);
  });

  test('the providers page renders the honest UNKNOWN when the capability port transport-fails', async () => {
    registerCapabilityPortBacking(
      capabilityBacking(() => {
        throw new Error('accounts page-test transport failure');
      }),
    );
    mockedAudienceCookie = 'administrator';
    const html = await render(AccountsProvidersPage);
    expect(html).toContain('data-console-read="unavailable"');
    expect(html).toContain('data-console-status="UNKNOWN"');
    expect(html).toContain('transport/infrastructure failure, not a business outcome');
    // The identity gap still stands on its own.
    expect(html).toContain('data-console-gap="true"');
  });

  // Restore the default listing backing for any later consumer in this file.
  registerCapabilityPortBacking(capabilityBacking(() => DEFAULT_LISTING));
});
