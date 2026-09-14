/**
 * PC-003 — Console operations health API tests: the thin route wiring
 * end-to-end. Server-side role check FIRST (fail-closed 404 {ok:false} — the
 * composite read serves the six frozen operations modules, all operator-only
 * in the frozen route-role matrix; the guard is the registry-DERIVED
 * intersection, never hard-coded), then the read over the EXISTING
 * observability probe (the /api/ready composition point — the readiness
 * module is MOCKED so no durable substrate is bound; the delegation itself
 * is proven in read-models/operations-health.test.ts), then the PC-001
 * envelope untouched.
 */

import { describe, expect, mock, test } from 'bun:test';

let mockedAudienceCookie: string | undefined;

mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'payswap-shell-audience' ? { value: mockedAudienceCookie } : undefined,
  }),
}));

// The readiness probe is MOCKED (the lazy accessor's dynamic-import target):
// the real module binds the server-only durable substrate at LOAD time.
mock.module('@/lib/observability/readiness', () => ({
  probeComponentHealth: () => ({
    overall: 'ok',
    readiness: 'ready',
    generatedAt: 1726444800000,
    domains: {
      command: { state: 'ok' },
      queue: { state: 'ok' },
      execution: { state: 'ok' },
      unknown: { state: 'ok' },
      reconciliation: { state: 'ok' },
      'clearing-netting': { state: 'ok' },
      'settlement-finality': { state: 'ok' },
      'incident-recovery': { state: 'ok' },
      deployment: { state: 'ok' },
    },
  }),
  getReadinessProbeDatabase: (): never => {
    throw new Error('console code must never open the readiness probe database directly');
  },
}));

const { GET } = await import('./route');

describe('PC-003 /api/console/operations/health — fail-closed authorization', () => {
  test('unauthenticated caller gets 404 and NO content', async () => {
    mockedAudienceCookie = undefined;
    const response = await GET();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { ok?: unknown };
    expect(body.ok).toBe(false);
    expect(Object.keys(body)).toEqual(['ok']);
  });

  test('customer and merchant (outside the operator-only intersection) are denied with the same 404', async () => {
    for (const role of ['customer', 'merchant'] as const) {
      mockedAudienceCookie = role;
      const response = await GET();
      expect(response.status).toBe(404);
      const body = (await response.json()) as { ok?: unknown };
      expect(body.ok).toBe(false);
    }
  });
});

describe('PC-003 /api/console/operations/health — the authorized operator read through the envelope', () => {
  test('the operator receives the nine-domain health composite with the documented projection', async () => {
    mockedAudienceCookie = 'operator';
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
          overall: string;
          overallDisplayStatus: string;
          readiness: string;
          generatedAt: number;
          domains: { domain: string; state: string; displayStatus: string }[];
        };
        authority: { view: string };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.principal.role).toBe('operator');
    expect(body.environment.derivedBy).toBe('server');
    expect(body.result.outcome).toBe('value');
    expect(body.result.status).toBe('SUCCEEDED'); // overall ok ⇒ the projection
    expect(body.result.value.overall).toBe('ok');
    expect(body.result.value.overallDisplayStatus).toBe('SUCCEEDED');
    expect(body.result.value.readiness).toBe('ready');
    expect(body.result.value.generatedAt).toBe(1726444800000);
    expect(body.result.value.domains.length).toBe(9); // the frozen nine domains
    for (const domain of body.result.value.domains) {
      expect(domain.state).toBe('ok');
      expect(domain.displayStatus).toBe('SUCCEEDED');
    }
    expect(body.result.authority.view).toContain('console.operations');
  });
});
