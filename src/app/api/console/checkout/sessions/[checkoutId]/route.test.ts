/**
 * PC-003 — Console checkout session status API tests: the thin route wiring
 * end-to-end. Server-side role check FIRST (fail-closed 404 {ok:false}),
 * then the SYS-001 wiring seam (mocked to a no-op — the checkout port
 * backing is registered at the REAL port seam), then the read result through
 * the PC-001 envelope untouched. Only the dynamic route segment identifies
 * the checkout; a reference the authority holds no record for is the UNKNOWN
 * envelope branch — AUTHORIZATION denial is the only 404.
 */

import { describe, expect, mock, test } from 'bun:test';

let mockedAudienceCookie: string | undefined;

mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'payswap-shell-audience' ? { value: mockedAudienceCookie } : undefined,
  }),
}));

// Registered BEFORE the route module is dynamically imported: the real
// server-composition binds the server-only durable substrate at LOAD time.
mock.module('@/lib/protocol/server-composition', () => ({
  ensureProductPortsWired: async () => {},
}));

const { GET } = await import('./route');
const { registerCheckoutPortBacking } = await import('@/lib/protocol/checkout-port');
import type { CheckoutPort, CheckoutStatusResult } from '@/lib/protocol/checkout-port';

function checkoutStatusBacking(status: () => Promise<CheckoutStatusResult>): CheckoutPort {
  return {
    runtime: 'ARRIVING',
    authorityOwner: 'Checkout/Intent Authority (spec/architecture/v0.1)',
    nonAuthoritative: true,
    getOffer: async () => ({
      ok: false,
      error: 'checkout-not-found',
      detail: 'route test backing',
      reportedBy: 'pc-003 route test backing',
      runtime: 'ARRIVING',
    }),
    getStatus: status,
    listOpenCheckouts: async () => ({
      ok: true,
      items: [],
      reportedBy: 'pc-003 route test backing',
      runtime: 'ARRIVING',
    }),
    submitDecision: async () => ({
      ok: false,
      error: 'decision-not-allowed',
      detail: 'route test backing',
      reportedBy: 'pc-003 route test backing',
      runtime: 'ARRIVING',
    }),
  };
}

function request(checkoutId: string): Request {
  return new Request(`http://localhost/api/console/checkout/sessions/${checkoutId}`);
}

describe('PC-003 /api/console/checkout/sessions/[checkoutId] — fail-closed authorization', () => {
  test('unauthenticated caller gets 404 and NO content', async () => {
    mockedAudienceCookie = undefined;
    const response = await GET(request('cko_1'), { params: Promise.resolve({ checkoutId: 'cko_1' }) });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { ok?: unknown };
    expect(body.ok).toBe(false);
    expect(Object.keys(body)).toEqual(['ok']);
  });

  test('customer (not in the frozen merchant-only grant) is denied with the same 404', async () => {
    mockedAudienceCookie = 'customer';
    const response = await GET(request('cko_1'), { params: Promise.resolve({ checkoutId: 'cko_1' }) });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { ok?: unknown };
    expect(body.ok).toBe(false);
  });
});

describe('PC-003 /api/console/checkout/sessions/[checkoutId] — the status read through the envelope', () => {
  test('the merchant receives the authority-reported state for the referenced checkout', async () => {
    mockedAudienceCookie = 'merchant';
    registerCheckoutPortBacking(
      checkoutStatusBacking(async () => ({
        ok: true,
        record: {
          checkoutId: 'cko_status_7',
          state: 'accepted-awaiting-payment',
          reportedBy: 'runtime checkout adapter over the composed A01 Intent Authority',
          at: '2026-09-15T10:00:00.000Z',
        },
        runtime: 'ARRIVING',
      })),
    );
    const response = await GET(request('cko_status_7'), {
      params: Promise.resolve({ checkoutId: 'cko_status_7' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      principal: { role: string };
      result: {
        outcome: string;
        status: string;
        value: { checkoutId: string; state: string; displayStatus: string; mappingRecord: string };
        authority: { view: string };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.principal.role).toBe('merchant');
    expect(body.result.outcome).toBe('value');
    expect(body.result.status).toBe('WAITING'); // frozen mapping: accepted-awaiting-payment
    expect(body.result.value.checkoutId).toBe('cko_status_7'); // the dynamic segment reached the read
    expect(body.result.value.state).toBe('accepted-awaiting-payment');
    expect(body.result.value.displayStatus).toBe('WAITING');
    expect(body.result.value.mappingRecord).toBe('cko-map-05');
    expect(body.result.authority.view).toContain('console.checkout.sessions');
  });

  test('checkout-not-found is 200 + presentation UNKNOWN — never a 404, never a fabricated state', async () => {
    mockedAudienceCookie = 'merchant';
    registerCheckoutPortBacking(
      checkoutStatusBacking(async () => ({
        ok: false,
        error: 'checkout-not-found',
        detail: 'The Intent Authority holds no intent record for cko_missing. No offer is presented — never a fabricated one.',
        reportedBy: 'pc-003 route test backing',
        runtime: 'ARRIVING',
      })),
    );
    const response = await GET(request('cko_missing'), {
      params: Promise.resolve({ checkoutId: 'cko_missing' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { outcome: string; presentationStatus: string; note: string };
    };
    expect(body.result.outcome).toBe('unavailable');
    expect(body.result.presentationStatus).toBe('UNKNOWN');
    expect(body.result.note).toContain('never a fabricated');
  });
});
