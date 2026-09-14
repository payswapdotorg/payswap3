/**
 * PC-004 — Checkout configuration page tests (the honest gap, at the page
 * seam). The page composes the REAL checkout-sessions read model ONLY for its
 * boundary facts — driven by a checkout-port backing registered at the port's
 * own register seam (the PC-003 precedent; no read-model module is mocked: a
 * bun test process shares the module registry across files, and a read-model
 * mock would poison the PC-003 suites importing it for real). The gap
 * statement renders regardless of the read's branch.
 */

import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { registerCheckoutPortBacking } from '@/lib/protocol/checkout-port';
import type { CheckoutPort, CheckoutQueueResult } from '@/lib/protocol/checkout-port';

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

function checkoutListBacking(list: () => Promise<CheckoutQueueResult>): CheckoutPort {
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
    getStatus: async () => ({
      ok: false,
      error: 'checkout-not-found',
      detail: 'page-test backing holds no record',
      reportedBy: 'pc-004 page-test backing',
      runtime: 'ARRIVING',
    }),
    listOpenCheckouts: async () => {
      listCallCount += 1;
      return list();
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

// The default backing: one open offer (whose ITEMS must never render on the
// configuration page — they belong to the sessions module).
registerCheckoutPortBacking(
  checkoutListBacking(async () => ({
    ok: true,
    items: [
      {
        checkoutId: 'cko_never_rendered',
        protocolReference: 'pr_never_rendered',
        title: 'Never rendered on this page',
        receiveAmount: { amountMinorUnits: 2500, currency: 'USD' },
        validUntil: '2026-09-20T12:00:00.000Z',
      },
    ],
    reportedBy: 'pc-004 page-test backing',
    runtime: 'ARRIVING',
  })),
);

const ConsoleCheckoutConfigurationPage = (await import('./page')).default;

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await ConsoleCheckoutConfigurationPage());
}

describe('PC-004 /console/checkout/configuration page — the honest gap', () => {
  test('merchant sees the recorded gap and the ONE authoritative fact — no invented settings, no session items', async () => {
    mockedAudienceCookie = 'merchant';
    const html = await renderPage();
    expect(html).toContain('data-console-gap="true"');
    expect(html).toContain('No checkout configuration authority or settings read exists');
    expect(html).toContain('data-testid="console-checkout-configuration-runtime"');
    expect(html).toContain('ARRIVING');
    // Session items belong to the sessions module — never rendered here.
    expect(html.includes('cko_never_rendered')).toBe(false);
    // No fabricated setting widgets.
    expect(html.includes('<form')).toBe(false);
    expect(html.includes('<input')).toBe(false);
    expect(html.includes('<button')).toBe(false);
    // Attribution from the REAL source-registry metadata.
    expect(html).toContain('Checkout/Intent Authority (spec/architecture/v0.1) — reads re-anchored');
    expect(listCallCount).toBeGreaterThan(0);
  });

  test('an unavailable boundary read still renders the honest gap (a recorded fact)', async () => {
    registerCheckoutPortBacking(
      checkoutListBacking(async () => ({
        ok: false,
        error: 'authority-unreachable',
        detail: 'The checkout authority is unreachable — page-test transport backing.',
        reportedBy: 'pc-004 page-test backing',
        runtime: 'ARRIVING',
      })),
    );
    mockedAudienceCookie = 'merchant';
    const html = await renderPage();
    // The boundary read itself renders the honest UNKNOWN panel...
    expect(html).toContain('data-console-read="unavailable"');
    expect(html).toContain('data-console-status="UNKNOWN"');
    // ...while the recorded gap still stands on its own.
    expect(html).toContain('data-console-gap="true"');
    expect(html).toContain('No checkout configuration authority or settings read exists');
  });

  // Restore the default backing for any later consumer in this file.
  registerCheckoutPortBacking(
    checkoutListBacking(async () => ({
      ok: true,
      items: [
        {
          checkoutId: 'cko_never_rendered',
          protocolReference: 'pr_never_rendered',
          title: 'Never rendered on this page',
          receiveAmount: { amountMinorUnits: 2500, currency: 'USD' },
          validUntil: '2026-09-20T12:00:00.000Z',
        },
      ],
      reportedBy: 'pc-004 page-test backing',
      runtime: 'ARRIVING',
    })),
  );
});

describe('PC-004 /console/checkout/configuration page — role isolation', () => {
  test('customer is redirected before any read composes (merchant-only module)', async () => {
    const before = listCallCount;
    mockedAudienceCookie = 'customer';
    let thrown: unknown;
    try {
      await renderPage();
    } catch (error) {
      thrown = error;
    }
    const digest = (thrown as { digest?: unknown })?.digest;
    expect(typeof digest).toBe('string');
    expect((digest as string).startsWith('NEXT_REDIRECT')).toBe(true);
    expect(listCallCount).toBe(before);
  });
});
