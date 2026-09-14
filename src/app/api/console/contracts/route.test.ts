/**
 * PC-001 — Console contracts API tests: the /api/console/contracts boundary
 * serves the frozen registry + server environment report behind the console
 * role policy, and fails closed for unauthorized callers.
 *
 * The request-context chain is driven by mocking 'next/headers' ONLY — the
 * real audience authority and the real route handler run unmodified.
 */

import { describe, expect, mock, test } from 'bun:test';

// The mocked session signal (the payswap-shell-audience cookie) — the only
// input an HTTP client controls on this surface.
let mockedAudienceCookie: string | undefined;

mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'payswap-shell-audience' ? { value: mockedAudienceCookie } : undefined,
  }),
}));

import { GET } from './route';
import { CONSOLE_REGISTRY, CONSOLE_ROOT_MODULE_ID } from '@/lib/console/registry';
import { CONSOLE_STATUSES } from '@/lib/console/dto';

const PRIOR_ENV = process.env['PAYSWAP_ENV'];

describe('PC-001 /api/console/contracts — fail-closed authorization', () => {
  test('unauthenticated caller gets 404 and NO content (surface does not confirm itself)', async () => {
    mockedAudienceCookie = undefined;
    const response = await GET();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { ok?: unknown };
    expect(body.ok).toBe(false);
    expect(Object.keys(body)).toEqual(['ok']);
  });

  test('an invalid/spoofed audience value is ignored → 404', async () => {
    mockedAudienceCookie = 'superuser';
    const response = await GET();
    expect(response.status).toBe(404);
    const body = (await response.json()) as { ok?: unknown };
    expect(body.ok).toBe(false);
  });
});

describe('PC-001 /api/console/contracts — authorized contract serving', () => {
  test('an allowed console role receives the frozen registry + server environment report (every role)', async () => {
    for (const role of ['customer', 'merchant', 'provider', 'operator', 'administrator'] as const) {
      mockedAudienceCookie = role;
      const response = await GET();
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = (await response.json()) as {
        ok: boolean;
        principal: { role: string };
        registry: {
          summary: { totalRoutes: number; availableRoutes: number; plannedRoutes: number };
          routes: {
            id: string;
            href: string;
            allowedRoles: string[];
            status: string;
          }[];
        };
        environment: {
          kind: string;
          configuredValue: string;
          derivedBy: string;
          startupConfiguration: { ok: boolean; env: string };
        };
        contracts: { statusVocabulary: string[] };
      };
      expect(body.ok).toBe(true);
      expect(body.principal.role).toBe(role);
      // The registry served is EXACTLY the frozen registry.
      expect(body.registry.routes.length).toBe(CONSOLE_REGISTRY.length);
      expect(body.registry.summary.totalRoutes).toBe(CONSOLE_REGISTRY.length);
      // Post-PC-005 Lead flip: all 26 registry modules available (16 composed
      // in PC-004, developers x5 + documentation x4 in PC-005, root from PC-001).
      expect(body.registry.summary.availableRoutes).toBe(CONSOLE_REGISTRY.length);
      expect(body.registry.summary.plannedRoutes).toBe(0);
      const root = body.registry.routes.find(
        (route) => route.id === (CONSOLE_ROOT_MODULE_ID as string),
      );
      expect(root?.href).toBe('/console');
      // The environment report is server-derived only.
      expect(['sandbox', 'production']).toContain(body.environment.kind);
      expect(body.environment.derivedBy).toBe('server');
      expect(body.environment.startupConfiguration.env).toBe(body.environment.kind);
      // The frozen DTO contract is advertised.
      expect(body.contracts.statusVocabulary).toEqual([...CONSOLE_STATUSES]);
    }
  });

  test('the served environment follows the frozen PAYSWAP_ENV chain (fail-safe sandbox)', async () => {
    mockedAudienceCookie = 'operator';
    try {
      delete process.env['PAYSWAP_ENV'];
      let body = (await (await GET()).json()) as { environment: { kind: string } };
      expect(body.environment.kind).toBe('sandbox');

      process.env['PAYSWAP_ENV'] = 'production';
      body = (await (await GET()).json()) as { environment: { kind: string } };
      expect(body.environment.kind).toBe('production');

      // A spoofed value never selects production.
      process.env['PAYSWAP_ENV'] = 'prod';
      body = (await (await GET()).json()) as { environment: { kind: string } };
      expect(body.environment.kind).toBe('sandbox');
    } finally {
      if (PRIOR_ENV === undefined) {
        delete process.env['PAYSWAP_ENV'];
      } else {
        process.env['PAYSWAP_ENV'] = PRIOR_ENV;
      }
    }
  });
});
