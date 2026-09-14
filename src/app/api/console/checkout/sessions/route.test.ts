/**
 * PC-003 — Console checkout sessions list API tests: the thin route wiring
 * end-to-end. Server-side role check FIRST (fail-closed 404 {ok:false} — the
 * module is merchant-only in the frozen route-role matrix), then the SYS-001
 * wiring seam (mocked to a no-op — the checkout port backing is registered
 * at the REAL port seam), then the read result through the PC-001 envelope
 * untouched (an EMPTY open-checkout list is a legitimate VALUE; only port
 * errors/transport failures are UNKNOWN).
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
import type { CheckoutPort, CheckoutQueueResult } from '@/lib/protocol/checkout-port';

function checkoutListBacking(list: () => Promise<CheckoutQueueResult>): CheckoutPort {
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
    getStatus: async () => ({
      ok: false,
      error: 'checkout-not-found',
      detail: 'route test backing',
      reportedBy: 'pc-003 route test backing',
      runtime: 'ARRIVING',
    }),
    listOpenCheckouts: list,
    submitDecision: async () => ({
      ok: false,
      error: 'decision-not-allowed',
      detail: 'route test backing',
      reportedBy: 'pc-003 route test backing',
      runtime: 'ARRIVING',
    }),
  };
}

describe('PC-003 /api/console/checkout/sessions — fail-closed authorization', () => {
  test('unauthenticated caller gets 404 and NO content', async () => {
    mockedAudienceCookie = undefined;
    const response = await GET();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { ok?: unknown };
    expect(body.ok).toBe(false);
    expect(Object.keys(body)).toEqual(['ok']);
  });

  test('customer (not in the frozen merchant-only grant) is denied with the same 404', async () => {
    mockedAudienceCookie = 'customer';
    const response = await GET();
    expect(response.status).toBe(404);
    const body = (await response.json()) as { ok?: unknown };
    expect(body.ok).toBe(false);
  });
});

describe('PC-003 /api/console/checkout/sessions — authorized merchant reads through the envelope', () => {
  test('the merchant receives the port’s items verbatim + the honest boundary facts', async () => {
    mockedAudienceCookie = 'merchant';
    registerCheckoutPortBacking(
      checkoutListBacking(async () => ({
        ok: true,
        items: [
          {
            checkoutId: 'cko_route_1',
            protocolReference: 'cko_route_1',
            title: 'Open offer — payment intent cko_route_1',
            receiveAmount: { amountMinorUnits: 2500, currency: 'USD' },
            validUntil: '2026-09-16T10:00:00.000Z',
          },
        ],
        reportedBy: 'runtime checkout adapter over the composed A01 Intent Authority',
        runtime: 'ARRIVING',
      })),
    );
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as {
      ok: boolean;
      principal: { role: string };
      environment: { derivedBy: string };
      result: {
        outcome: string;
        status: string;
        value: {
          sessions: { checkoutId: string; receiveAmount: { amountMinorUnits: number } }[];
          runtime: string;
          authorityOwner: string;
        };
        authority: { view: string };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.principal.role).toBe('merchant');
    expect(body.environment.derivedBy).toBe('server');
    expect(body.result.outcome).toBe('value');
    expect(body.result.status).toBe('SUCCEEDED');
    expect(body.result.value.sessions[0]?.checkoutId).toBe('cko_route_1');
    expect(body.result.value.sessions[0]?.receiveAmount.amountMinorUnits).toBe(2500);
    expect(body.result.value.runtime).toBe('ARRIVING'); // the port’s honest pinned status
    expect(body.result.authority.view).toContain('console.checkout.sessions');
  });

  test('an EMPTY open-checkout list is 200 + VALUE (the authority answered: no open offers)', async () => {
    mockedAudienceCookie = 'merchant';
    registerCheckoutPortBacking(
      checkoutListBacking(async () => ({
        ok: true,
        items: [],
        reportedBy: 'runtime checkout adapter over the composed A01 Intent Authority',
        runtime: 'ARRIVING',
      })),
    );
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { outcome: string; status: string; value: { sessions: unknown[] } };
    };
    expect(body.result.outcome).toBe('value');
    expect(body.result.status).toBe('SUCCEEDED');
    expect(body.result.value.sessions).toEqual([]);
  });

  test('authority-unreachable is 200 + presentation UNKNOWN — never a fabricated list', async () => {
    mockedAudienceCookie = 'merchant';
    registerCheckoutPortBacking(
      checkoutListBacking(async () => ({
        ok: false,
        error: 'authority-unreachable',
        detail: 'The checkout authority boundary could not be reached.',
        reportedBy: 'pc-003 route test backing',
        runtime: 'ARRIVING',
      })),
    );
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { outcome: string; presentationStatus: string; note: string };
    };
    expect(body.result.outcome).toBe('unavailable');
    expect(body.result.presentationStatus).toBe('UNKNOWN');
    expect(body.result.note).toContain('not a business outcome');
  });
});
