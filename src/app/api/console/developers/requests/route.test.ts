/**
 * PC-003 — Console developer requests API tests: the thin route wiring
 * end-to-end for the request-log scaffold PC-005 will consume. Server-side
 * role check FIRST (fail-closed 404 {ok:false} — the module is merchant-only
 * in the frozen route-role matrix), then the scaffold read (NO request-log
 * authority exists at this baseline — the recorded design §17 gap), then the
 * PC-001 envelope untouched: the recorded gap crosses the HTTP boundary as
 * the UNAVAILABLE branch with presentation UNKNOWN — never a fabricated log
 * list, never a business verdict.
 */

import { describe, expect, mock, test } from 'bun:test';

let mockedAudienceCookie: string | undefined;

mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'payswap-shell-audience' ? { value: mockedAudienceCookie } : undefined,
  }),
}));

const { GET } = await import('./route');

describe('PC-003 /api/console/developers/requests — fail-closed authorization', () => {
  test('unauthenticated caller gets 404 and NO content', async () => {
    mockedAudienceCookie = undefined;
    const response = await GET();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { ok?: unknown };
    expect(body.ok).toBe(false);
    expect(Object.keys(body)).toEqual(['ok']);
  });

  test('customer and operator (outside the merchant-only grant) are denied with the same 404', async () => {
    for (const role of ['customer', 'operator'] as const) {
      mockedAudienceCookie = role;
      const response = await GET();
      expect(response.status).toBe(404);
      const body = (await response.json()) as { ok?: unknown };
      expect(body.ok).toBe(false);
    }
  });
});

describe('PC-003 /api/console/developers/requests — the recorded gap through the envelope', () => {
  test('the merchant receives the UNAVAILABLE branch with the recorded owning-authority gap — UNKNOWN, nothing fabricated', async () => {
    mockedAudienceCookie = 'merchant';
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as {
      ok: boolean;
      principal: { role: string };
      environment: { derivedBy: string };
      result: {
        outcome: string;
        presentationStatus: string;
        note: string;
        authority: { view: string; owningAuthority: string; durableSource: string };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.principal.role).toBe('merchant');
    expect(body.environment.derivedBy).toBe('server');
    expect(body.result.outcome).toBe('unavailable');
    expect(body.result.presentationStatus).toBe('UNKNOWN');
    expect(body.result.note).toContain('PENDING-PC-005');
    expect(body.result.note).toContain('fabricat');
    // The gap is recorded in the attached authority metadata (source metadata rule).
    expect(body.result.authority.view).toContain('console.developers.logs');
    expect(body.result.authority.owningAuthority).toContain('RECORDED GAP');
    expect(body.result.authority.durableSource).toContain('none at this baseline');
  });
});
