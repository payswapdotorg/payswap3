/**
 * PC-003 — Console capabilities API tests: the thin route wiring end-to-end.
 * Server-side role check FIRST (fail-closed 404 {ok:false} — the module is
 * provider-only in the frozen route-role matrix, mirroring the provider
 * audience of the product /capabilities surface), then the SYS-001 wiring
 * seam (mocked to a no-op — the capability port backing is registered at the
 * REAL port seam), then the read result through the PC-001 envelope
 * untouched (per-item availability-unknown stays UNKNOWN — never an outcome,
 * never an authoritative empty registry).
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
const { registerCapabilityPortBacking } = await import('@/lib/protocol/capability-port');
import type { CapabilityListing, CapabilityPort } from '@/lib/protocol/capability-port';

function capabilityBacking(listing: () => CapabilityListing): CapabilityPort {
  return {
    boundary: listing().boundary,
    async listCapabilities() {
      return listing();
    },
    async getCapability() {
      return null;
    },
  };
}

const LISTING: CapabilityListing = {
  items: [
    {
      descriptor: {
        id: 'cap_route_live',
        name: 'Route Capability',
        summary: 'route test summary',
        category: 'payments',
        composition: [],
      },
      report: {
        capabilityId: 'cap_route_live',
        state: 'available',
        reportedBy: 'A03 route test backing',
        reportedAt: '2026-09-15T09:00:00.000Z',
        source: {
          id: 'src-route',
          name: 'Capability Authority runtime',
          authority: 'Capability/Routing Authority',
          availability: 'reachable',
        },
      },
      source: {
        id: 'src-route',
        name: 'Capability Authority runtime',
        authority: 'Capability/Routing Authority',
        availability: 'reachable',
      },
    },
    {
      descriptor: {
        id: 'cap_route_dark',
        name: 'Dark Capability',
        summary: 'route test summary',
        category: 'payments',
        composition: [],
      },
      report: null, // availability-unknown: no authoritative report
      source: {
        id: 'src-route',
        name: 'Capability Authority runtime',
        authority: 'Capability/Routing Authority',
        availability: 'unreachable',
      },
    },
  ],
  sources: [],
  boundary: {
    runtime: 'LIVE',
    authorityOwner: 'Capability/Routing Authority (A03, spec/architecture/v0.1)',
    backing: 'protocol-adapter',
    authoritative: true,
    notes: 'pc-003 route test backing notes',
  },
  generatedAt: '2026-09-15T10:00:00.000Z',
};

describe('PC-003 /api/console/capabilities — fail-closed authorization', () => {
  test('unauthenticated caller gets 404 and NO content', async () => {
    mockedAudienceCookie = undefined;
    const response = await GET();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { ok?: unknown };
    expect(body.ok).toBe(false);
    expect(Object.keys(body)).toEqual(['ok']);
  });

  test('merchant (not in the frozen provider-only grant) is denied with the same 404', async () => {
    mockedAudienceCookie = 'merchant';
    const response = await GET();
    expect(response.status).toBe(404);
    const body = (await response.json()) as { ok?: unknown };
    expect(body.ok).toBe(false);
  });
});

describe('PC-003 /api/console/capabilities — authorized provider reads through the envelope', () => {
  test('the provider receives the two-axis listing: available ⇒ SUCCEEDED, unreachable ⇒ UNKNOWN (never an outcome)', async () => {
    mockedAudienceCookie = 'provider';
    registerCapabilityPortBacking(capabilityBacking(() => LISTING));
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
          capabilities: {
            capabilityId: string;
            authorityState?: string;
            sourceAvailability: string;
            displayStatus: string;
          }[];
          boundary: { runtime: string; authorityOwner: string };
        };
        authority: { view: string };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.principal.role).toBe('provider');
    expect(body.environment.derivedBy).toBe('server');
    expect(body.result.outcome).toBe('value');
    expect(body.result.status).toBe('SUCCEEDED'); // the read-level convention
    const live = body.result.value.capabilities.find((c) => c.capabilityId === 'cap_route_live');
    expect(live?.authorityState).toBe('available');
    expect(live?.sourceAvailability).toBe('reachable');
    expect(live?.displayStatus).toBe('SUCCEEDED');
    const dark = body.result.value.capabilities.find((c) => c.capabilityId === 'cap_route_dark');
    expect('authorityState' in (dark ?? {})).toBe(false); // nothing fabricated for the dark item
    expect(dark?.sourceAvailability).toBe('unreachable');
    expect(dark?.displayStatus).toBe('UNKNOWN'); // availability-unknown, never an outcome
    expect(body.result.value.boundary.runtime).toBe('LIVE');
    expect(body.result.authority.view).toContain('console.capabilities');
  });

  test('a thrown port call is 200 + presentation UNKNOWN — never FAILED/SUCCEEDED', async () => {
    mockedAudienceCookie = 'provider';
    registerCapabilityPortBacking({
      boundary: LISTING.boundary,
      async listCapabilities() {
        throw new Error('capability port unreachable');
      },
      async getCapability() {
        return null;
      },
    });
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
