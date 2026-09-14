/**
 * PC-003 — Capabilities read-model tests: DTO schema conformance, the TWO
 * frozen axes (capability state + source availability — availability-unknown
 * ⇒ UNKNOWN, never an outcome), boundary facts carried verbatim, transport →
 * UNKNOWN, and source metadata. Delegation is proven by registering a test
 * backing at the capability port's own register seam.
 */

import { describe, expect, test } from 'bun:test';

import { getCapabilityPort, registerCapabilityPortBacking } from '@/lib/protocol/capability-port';
import type {
  CapabilityItem,
  CapabilityListing,
  CapabilityPort,
  CapabilityReport,
  CapabilityState,
} from '@/lib/protocol/capability-port';
import { isConsoleStatus } from '../dto';
import { consoleSourceMetadata } from '../authority/sources';
import { readConsoleCapabilities } from './capabilities';

// ── Test backing (the port's own register seam — no runtime is booted) ─────

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

const SOURCE = {
  id: 'src-1',
  name: 'Capability Authority runtime',
  authority: 'Capability/Routing Authority',
  availability: 'reachable',
} as const;

function reportFixture(id: string, state: CapabilityState): CapabilityReport {
  return {
    capabilityId: id,
    state,
    reportedBy: 'A03 test backing',
    reportedAt: '2026-09-15T09:00:00.000Z',
    source: SOURCE,
  };
}

function itemFixture(
  id: string,
  report: CapabilityReport | null,
  sourceAvailability: CapabilityItem['source']['availability'] = 'reachable',
): CapabilityItem {
  return {
    descriptor: {
      id,
      name: `Capability ${id}`,
      summary: 'test summary',
      category: 'payments',
      composition: [],
    },
    report,
    source: { ...SOURCE, availability: sourceAvailability },
  };
}

function listingFixture(items: readonly CapabilityItem[]): CapabilityListing {
  return {
    items,
    sources: [SOURCE],
    boundary: {
      runtime: 'LIVE',
      authorityOwner: 'Capability/Routing Authority (A03, spec/architecture/v0.1)',
      backing: 'protocol-adapter',
      authoritative: true,
      notes: 'pc-003 test backing notes',
    },
    generatedAt: '2026-09-15T10:00:00.000Z',
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('PC-003 capabilities read model', () => {
  test('a listing answer is a VALUE: two axes verbatim, frozen display mapping, boundary facts', async () => {
    registerCapabilityPortBacking(
      capabilityBacking(() =>
        listingFixture([
          itemFixture('cap-available', reportFixture('cap-available', 'available')),
          itemFixture('cap-unavailable', reportFixture('cap-unavailable', 'unavailable')),
          itemFixture('cap-conditional', reportFixture('cap-conditional', 'conditional')),
          itemFixture('cap-pending', reportFixture('cap-pending', 'pending')),
          itemFixture('cap-indeterminate', reportFixture('cap-indeterminate', 'indeterminate')),
          itemFixture('cap-no-report', null, 'unreachable'),
        ]),
      ),
    );
    const result = await readConsoleCapabilities();
    expect(result.outcome).toBe('value');
    if (result.outcome !== 'value') return;
    expect(result.status).toBe('SUCCEEDED'); // the read-level convention: the authority answered
    expect(result.value.capabilities.map((item) => item.displayStatus)).toEqual([
      'SUCCEEDED',
      'FAILED',
      'ACTION_REQUIRED',
      'IN_PROGRESS',
      'UNKNOWN',
      'UNKNOWN',
    ]);
    expect(result.value.capabilities.map((item) => item.mappingRecord)).toEqual([
      'CAP-MAP-001',
      'CAP-MAP-002',
      'CAP-MAP-003',
      'CAP-MAP-004',
      'CAP-MAP-005',
      'CAP-MAP-006',
    ]);
    // Verbatim authority states ride along for the reported items; the
    // no-report item carries NO authorityState at all (nothing fabricated).
    expect(result.value.capabilities.map((item) => item.authorityState ?? null)).toEqual([
      'available',
      'unavailable',
      'conditional',
      'pending',
      'indeterminate',
      null,
    ]);
    expect(result.value.capabilities.map((item) => item.sourceAvailability)).toEqual([
      'reachable',
      'reachable',
      'reachable',
      'reachable',
      'reachable',
      'unreachable',
    ]);
    // The port's boundary facts ride along verbatim.
    expect(result.value.boundary).toEqual({
      runtime: 'LIVE',
      authorityOwner: 'Capability/Routing Authority (A03, spec/architecture/v0.1)',
      backing: 'protocol-adapter',
      authoritative: true,
      notes: 'pc-003 test backing notes',
    });
    expect(result.value.generatedAt).toBe('2026-09-15T10:00:00.000Z');
    expect(result.authority).toBe(consoleSourceMetadata('capabilities'));
  });

  test('every reported display status is one of the six frozen statuses', async () => {
    const result = await readConsoleCapabilities();
    expect(result.outcome).toBe('value');
    if (result.outcome !== 'value') return;
    for (const item of result.value.capabilities) {
      expect(isConsoleStatus(item.displayStatus)).toBe(true);
    }
  });

  test('a report present with an UNREACHABLE source is still availability-unknown (the source axis wins)', async () => {
    registerCapabilityPortBacking(
      capabilityBacking(() =>
        listingFixture([itemFixture('cap-lying-source', reportFixture('cap-lying-source', 'available'), 'unreachable')]),
      ),
    );
    const result = await readConsoleCapabilities();
    expect(result.outcome).toBe('value');
    if (result.outcome !== 'value') return;
    const item = result.value.capabilities[0];
    expect(item?.displayStatus).toBe('UNKNOWN'); // never SUCCEEDED — the frozen mapping rule
    expect(item?.mappingRecord).toBe('CAP-MAP-006');
    expect(item?.authorityState).toBe('available'); // the axis values stay verbatim
    expect(item?.sourceAvailability).toBe('unreachable');
  });

  test('an EMPTY registry listing is a legitimate VALUE (the registry’s real content)', async () => {
    registerCapabilityPortBacking(capabilityBacking(() => listingFixture([])));
    const result = await readConsoleCapabilities();
    expect(result.outcome).toBe('value');
    if (result.outcome !== 'value') return;
    expect(result.status).toBe('SUCCEEDED');
    expect(result.value.capabilities).toEqual([]);
  });

  test('a thrown port call is a transport failure → UNKNOWN, never FAILED/SUCCEEDED', async () => {
    const throwingBacking = {
      boundary: listingFixture([]).boundary,
      listCapabilities: async () => {
        throw new Error('capability port exploded');
      },
      getCapability: async () => null,
    } as unknown as CapabilityPort;
    registerCapabilityPortBacking(throwingBacking);
    const result = await readConsoleCapabilities();
    expect(result.outcome).toBe('unavailable');
    if (result.outcome !== 'unavailable') return;
    expect(result.presentationStatus).toBe('UNKNOWN');
    expect(result.note).toContain('capability port exploded');
    expect(result.note).toContain('not a business outcome');
    expect('status' in result).toBe(false);
  });
});

describe('PC-003 capabilities read model — adapter thinness', () => {
  test('the read model derives its DTO from the backing registered at the port seam (getCapabilityPort())', async () => {
    registerCapabilityPortBacking(
      capabilityBacking(() =>
        listingFixture([itemFixture('cap_distinctive_3', reportFixture('cap_distinctive_3', 'available'))]),
      ),
    );
    expect(getCapabilityPort().boundary.authorityOwner).toBe(
      'Capability/Routing Authority (A03, spec/architecture/v0.1)',
    );
    const result = await readConsoleCapabilities();
    expect(result.outcome).toBe('value');
    if (result.outcome !== 'value') return;
    expect(result.value.capabilities[0]?.capabilityId).toBe('cap_distinctive_3');
    expect(result.value.capabilities[0]?.displayStatus).toBe('SUCCEEDED');
  });
});
