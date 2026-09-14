/**
 * PC-003 — Console payments list API tests: the thin route wiring end-to-end.
 * Server-side role check FIRST (fail-closed 404 {ok:false} with no content —
 * the PC-001 boundary convention), then the SYS-001 wiring seam (mocked here
 * — the port backings are registered at the REAL port seams instead, which is
 * exactly what the wiring does in production), then the read result passed
 * through the PC-001 envelope UNTOUCHED (value or UNKNOWN — never
 * re-worded at the HTTP boundary).
 *
 * The request-context chain is driven by mocking 'next/headers' ONLY — the
 * real audience authority and the real route handler run unmodified.
 */

import { describe, expect, mock, test } from 'bun:test';

let mockedAudienceCookie: string | undefined;

mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'payswap-shell-audience' ? { value: mockedAudienceCookie } : undefined,
  }),
}));

// The SYS-001 wiring seam is mocked to a no-op: the test registers the port
// backings directly at the ports' own register seams (the same seams
// ensureProductPortsWired drives in production), so no runtime is booted.
// The mock is registered BEFORE the route module is dynamically imported —
// the real server-composition binds the server-only durable substrate at
// LOAD time, so the mock must prevent that load entirely.
mock.module('@/lib/protocol/server-composition', () => ({
  ensureProductPortsWired: async () => {},
}));

const { GET } = await import('./route');
const { registerIntentPortBacking } = await import('@/lib/protocol/intent-port');
import type { IntentPort, SessionIntentListResult } from '@/lib/protocol/intent-port';

function intentListBacking(list: () => Promise<SessionIntentListResult>): IntentPort {
  return {
    boundary: () => ({
      adapter: 'intent-port',
      authorityOwner: 'Intent Authority (spec/architecture/v0.1)',
      runtimeStatus: 'LIVE',
      implementation: 'pc-003 route test backing',
      authoritative: true,
      note: 'route test backing',
    }),
    getCompositionOptions: () => ({
      outcomeStatements: [],
      recipients: [],
      sources: [],
      currency: 'USD',
    }),
    requestConsequenceReport: async () => ({ kind: 'no-answer', note: 'route test backing' }),
    submitIntent: async () => ({
      kind: 'not-transported',
      submissionRef: 'sr_route_test',
      note: 'route test backing',
    }),
    getIntentState: async () => ({ kind: 'no-answer', reason: 'no-record', note: 'route test backing' }),
    listSessionIntents: list,
    getPresentationFixture: async () => ({ kind: 'no-answer', reason: 'no-record', note: 'route test backing' }),
  };
}

describe('PC-003 /api/console/payments — fail-closed authorization', () => {
  test('unauthenticated caller gets 404 and NO content (the module never confirms itself)', async () => {
    mockedAudienceCookie = undefined;
    const response = await GET();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { ok?: unknown };
    expect(body.ok).toBe(false);
    expect(Object.keys(body)).toEqual(['ok']);
  });

  test('a role outside the frozen registry grant (provider) is denied with the same 404', async () => {
    mockedAudienceCookie = 'provider';
    const response = await GET();
    expect(response.status).toBe(404);
    const body = (await response.json()) as { ok?: unknown };
    expect(body.ok).toBe(false);
  });
});

describe('PC-003 /api/console/payments — authorized reads through the PC-001 envelope', () => {
  test('an allowed role (customer) receives the envelope with the read result untouched', async () => {
    mockedAudienceCookie = 'customer';
    registerIntentPortBacking(
      intentListBacking(async () => ({
        kind: 'records',
        records: [
          {
            intentId: 'pi_route_1',
            authorityState: 'FULFILLED',
            reportedAt: '2026-09-15T10:00:00.000Z',
            amount: '25.00',
            currency: 'USD',
            recipientName: 'Route Recipient',
          },
        ],
      })),
    );
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as {
      ok: boolean;
      principal: { role: string };
      environment: { derivedBy: string; kind: string };
      result: {
        outcome: string;
        status: string;
        value: { payments: { intentId: string; displayStatus: string }[]; viewerRole: string };
        authority: { view: string };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.principal.role).toBe('customer');
    expect(body.environment.derivedBy).toBe('server');
    expect(['sandbox', 'production']).toContain(body.environment.kind);
    expect(body.result.outcome).toBe('value');
    expect(body.result.status).toBe('SUCCEEDED');
    expect(body.result.value.payments[0]?.intentId).toBe('pi_route_1');
    expect(body.result.value.payments[0]?.displayStatus).toBe('SUCCEEDED');
    expect(body.result.value.viewerRole).toBe('customer');
    expect(body.result.authority.view).toContain('console.payments.all');
  });

  test('UNKNOWN propagates through the HTTP boundary: a no-answer read is 200 + unavailable, never a fabricated empty list', async () => {
    mockedAudienceCookie = 'operator';
    registerIntentPortBacking(
      intentListBacking(async () => ({
        kind: 'no-answer',
        note: 'The A15 chain records no intents — UNKNOWN, not an authoritative empty list.',
      })),
    );
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { outcome: string; presentationStatus: string; note: string };
    };
    expect(body.result.outcome).toBe('unavailable');
    expect(body.result.presentationStatus).toBe('UNKNOWN');
    expect(body.result.note).toContain('UNKNOWN');
  });

  test('a transport failure of the read is 200 + presentation UNKNOWN — never FAILED/SUCCEEDED', async () => {
    mockedAudienceCookie = 'merchant';
    registerIntentPortBacking(
      intentListBacking(async () => {
        throw new Error('intent authority unreachable');
      }),
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
