/**
 * PC-004 — Checkout sessions page tests (composition through the REAL read
 * models).
 *
 * The PC-003 precedent: 'next/headers' mocked, the wiring seam no-op'd, and
 * the checkout port backing registered AT THE PORT'S OWN REGISTER SEAM — the
 * page then composes the REAL PC-003 checkout-sessions read models (list +
 * per-session status) over that backing with no HTTP hop. No read-model
 * module is mocked (a bun test process shares the module registry across
 * files; a read-model mock would poison the PC-003 suites importing it for
 * real).
 *
 * Proven here:
 *   - merchant (the only allowed role) receives the composed sessions view
 *     with the per-session status composed server-side;
 *   - an EMPTY list is the authority's legitimate VALUE (distinct from an
 *     unavailable read's UNKNOWN);
 *   - a port transport failure renders UNKNOWN and composes NO status
 *     sub-reads;
 *   - customer/provider viewers are redirected before any read composes.
 */

import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { registerCheckoutPortBacking } from '@/lib/protocol/checkout-port';
import type {
  CheckoutPort,
  CheckoutQueueResult,
  CheckoutStateRecord,
  CheckoutStatusResult,
} from '@/lib/protocol/checkout-port';

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

// ── The checkout-port test backing (the port's own register seam) ───────────

let listCallCount = 0;
let statusCallCount = 0;

function checkoutBacking(overrides: {
  list?: () => Promise<CheckoutQueueResult>;
  status?: (checkoutId: string) => Promise<CheckoutStatusResult>;
}): CheckoutPort {
  return {
    runtime: 'ARRIVING',
    authorityOwner: 'Checkout/Intent Authority (spec/architecture/v0.1)',
    nonAuthoritative: true,
    getOffer: async () => ({
      ok: false,
      error: 'checkout-not-found',
      detail: 'page-test backing',
      reportedBy: 'pc-004 page-test backing',
      runtime: 'ARRIVING',
    }),
    getStatus: async (request) =>
      overrides.status
        ? overrides.status(request.checkoutId)
        : {
            ok: false,
            error: 'checkout-not-found',
            detail: 'page-test backing holds no record',
            reportedBy: 'pc-004 page-test backing',
            runtime: 'ARRIVING',
          },
    listOpenCheckouts: async () => {
      listCallCount += 1;
      return overrides.list
        ? overrides.list()
        : {
            ok: false,
            error: 'authority-unreachable',
            detail: 'page-test backing unreachable',
            reportedBy: 'pc-004 page-test backing',
            runtime: 'ARRIVING',
          };
    },
    submitDecision: async () => ({
      ok: false,
      error: 'decision-not-allowed',
      detail: 'page-test backing',
      reportedBy: 'pc-004 page-test backing',
      runtime: 'ARRIVING',
    }),
  };
}

const PAGE_SESSION = {
  checkoutId: 'cko_page_1',
  protocolReference: 'pr_page_1',
  title: 'Page fixture offer',
  receiveAmount: { amountMinorUnits: 2500, currency: 'USD' },
  validUntil: '2026-09-20T12:00:00.000Z',
};

const PAGE_STATUS_RECORD: CheckoutStateRecord = {
  checkoutId: 'cko_page_1',
  state: 'offered',
  reportedBy: 'pc-004 page-test backing',
  at: '2026-09-15T09:00:00.000Z',
  nextActions: ['accept', 'decline'],
};

// The default backing: one open offer with its authority-reported status.
registerCheckoutPortBacking(
  checkoutBacking({
    list: async () => ({
      ok: true,
      items: [PAGE_SESSION],
      reportedBy: 'pc-004 page-test backing',
      runtime: 'ARRIVING',
    }),
    status: async (checkoutId) => {
      statusCallCount += 1;
      expect(checkoutId).toBe('cko_page_1');
      return { ok: true, record: PAGE_STATUS_RECORD, runtime: 'ARRIVING' } satisfies CheckoutStatusResult;
    },
  }),
);

const ConsoleCheckoutSessionsPage = (await import('./page')).default;

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await ConsoleCheckoutSessionsPage());
}

describe('PC-004 /console/checkout/sessions page — composition', () => {
  test('merchant receives the composed list with the per-session status composed server-side', async () => {
    mockedAudienceCookie = 'merchant';
    const html = await renderPage();
    expect(html).toContain('data-console-view="checkout-sessions"');
    expect(html).toContain('data-console-checkout-session="cko_page_1"');
    expect(html).toContain('25.00 USD');
    expect(html).toContain('2026-09-20 12:00 UTC');
    // The status sub-read composed for the listed session (no HTTP hop).
    expect(html).toContain('data-console-status="ACTION_REQUIRED"');
    expect(html).toContain('offered');
    expect(html).toContain('cko-map-01');
    // Boundary facts verbatim.
    expect(html).toContain('ARRIVING');
    expect(html).toContain('Checkout/Intent Authority (spec/architecture/v0.1)');
    // Attribution from the REAL source-registry metadata.
    expect(html).toContain('Checkout/Intent Authority (spec/architecture/v0.1) — reads re-anchored');
    expect(listCallCount).toBeGreaterThan(0);
    expect(statusCallCount).toBeGreaterThan(0);
  });

  test('an EMPTY list renders as the authoritative VALUE — distinct from UNKNOWN', async () => {
    registerCheckoutPortBacking(
      checkoutBacking({
        list: async () => ({
          ok: true,
          items: [],
          reportedBy: 'pc-004 page-test backing',
          runtime: 'ARRIVING',
        }),
      }),
    );
    mockedAudienceCookie = 'merchant';
    const html = await renderPage();
    expect(html).toContain('data-testid="console-checkout-empty-value"');
    expect(html).toContain('no open checkout offers');
    expect(html.includes('data-console-status="UNKNOWN"')).toBe(false);
  });

  test('an unavailable list renders UNKNOWN and composes NO status sub-reads', async () => {
    const statusBefore = statusCallCount;
    registerCheckoutPortBacking(
      checkoutBacking({
        list: async () => ({
          ok: false,
          error: 'authority-unreachable',
          detail: 'The checkout authority is unreachable — page-test transport backing.',
          reportedBy: 'pc-004 page-test backing',
          runtime: 'ARRIVING',
        }),
      }),
    );
    mockedAudienceCookie = 'merchant';
    const html = await renderPage();
    expect(html).toContain('data-console-read="unavailable"');
    expect(html).toContain('data-console-status="UNKNOWN"');
    expect(html.includes('console-checkout-empty-value')).toBe(false);
    expect(html).toContain('The checkout authority is unreachable — page-test transport backing.');
    expect(html).toContain('transport/infrastructure failure, not a business outcome');
    expect(statusCallCount).toBe(statusBefore);
  });

  // Restore the default backing for any later consumer in this file.
  registerCheckoutPortBacking(
    checkoutBacking({
      list: async () => ({
        ok: true,
        items: [PAGE_SESSION],
        reportedBy: 'pc-004 page-test backing',
        runtime: 'ARRIVING',
      }),
      status: async (checkoutId) => {
        statusCallCount += 1;
        expect(checkoutId).toBe('cko_page_1');
        return { ok: true, record: PAGE_STATUS_RECORD, runtime: 'ARRIVING' } satisfies CheckoutStatusResult;
      },
    }),
  );
});

describe('PC-004 /console/checkout/sessions page — role isolation', () => {
  test('customer and provider viewers are redirected (merchant-only module)', async () => {
    const listBefore = listCallCount;
    for (const audience of ['customer', 'provider', 'administrator', 'operator']) {
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
    expect(listCallCount).toBe(listBefore);
  });
});
