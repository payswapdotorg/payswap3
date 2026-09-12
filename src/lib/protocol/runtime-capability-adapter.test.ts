/**
 * UI-011 — RUNTIME CAPABILITY ADAPTER product suite (bun).
 *
 * Proves the capability port's runtime re-anchoring: every capability item
 * is a REAL A03 CapabilityRecord (state vocabulary, corridors, cost
 * schedules, capacity) read through the authority's own query API; the
 * five-state presentation axis is derived from the real states; a query
 * with no record is null (never fabricated).
 */

import { describe, expect, test } from 'bun:test';
import { composeProductTestRuntime, type ProductTestComposition } from './product-adapter-test-compose';
import { createRuntimeCapabilityAdapter } from './runtime-capability-adapter';
import { getCapabilityPort, registerCapabilityPortBacking } from './capability-port';
import type { CapabilityPort } from './capability-port';
import { money } from '../protocol-runtime/kernel/money.ts';
import { resolveCapabilityDisplayState } from './capability-state-mapping';

// Top-level awaited setup (bun's ESM test runtime; the ambient bun:test
// declaration exposes describe/test/expect only — no lifecycle hooks).
const composition = await composeProductTestRuntime();
const port: CapabilityPort = createRuntimeCapabilityAdapter(composition.handle);
registerCapabilityPortBacking(port);

async function registerAndActivate(capabilityId: string): Promise<void> {
  const registered = await composition.authorities.capability.registerCapability({
    capabilityId,
    declaration: {
      railId: 'rail-a',
      corridor: {
        sourceCurrency: 'USD',
        destinationCurrency: 'USD',
        sourceGeography: 'US',
        destinationGeography: 'US',
      },
      costSchedule: money('USD', 45, 2),
      tier: 'STANDARD',
    },
    declaredCapacity: money('USD', 500_000, 2),
  });
  expect(registered.ok).toBe(true);
}

describe('UI-011 runtime capability adapter — honest boundary + authoritative zero', () => {
  test('the boundary reports the runtime adapter (LIVE, protocol-adapter, authoritative)', () => {
    const boundary = port.boundary;
    expect(boundary.runtime).toBe('LIVE');
    expect(boundary.backing).toBe('protocol-adapter');
    expect(boundary.authoritative).toBe(true);
    expect(boundary.notes).toContain('A03 Capability Authority');
    expect(getCapabilityPort()).toBe(port);
  });

  test('a fresh runtime lists zero capabilities (the authority\u2019s real answer — an empty listing, not a failure)', async () => {
    const listing = await port.listCapabilities();
    expect(listing.items.length).toBe(0);
    expect(listing.sources.length).toBe(1);
    expect(listing.boundary.notes).toContain('A03');
  });

  test('a capability id the registry holds no record for resolves null', async () => {
    const item = await port.getCapability('cap-not-registered');
    expect(item).toBeNull();
  });
});

describe('UI-011 runtime capability adapter — the real A03 state vocabulary', () => {
  test('REGISTERED presents as pending (in-progress display) with the authority\u2019s wording', async () => {
    await registerAndActivate('cap-state-probe');
    const item = await port.getCapability('cap-state-probe');
    expect(item).not.toBeNull();
    if (item) {
      expect(item.report?.state).toBe('pending');
      expect(item.report?.reportedBy).toContain('Capability Authority (A03)');
      expect(resolveCapabilityDisplayState(item).kind).toBe('in-progress');
      expect(item.descriptor.summary).toContain('rail-a');
    }
  });

  test('ACTIVE presents as available (succeeded display) with real corridor + cost figures', async () => {
    await composition.authorities.capability.activateCapability('cap-state-probe');
    const item = await port.getCapability('cap-state-probe');
    expect(item).not.toBeNull();
    if (item) {
      expect(item.report?.state).toBe('available');
      expect(item.descriptor.summary).toContain('0.45 USD');
      expect(item.descriptor.summary).toContain('5000.00 USD');
      expect(resolveCapabilityDisplayState(item).kind).toBe('succeeded');
      expect(item.report?.evidence?.href).toContain('cap-state-probe');
    }
  });

  test('DEGRADED presents as conditional (action-required display) — the authority\u2019s own no-new-commitments rule', async () => {
    await composition.authorities.capability.degradeCapability('cap-state-probe');
    const item = await port.getCapability('cap-state-probe');
    expect(item).not.toBeNull();
    if (item) {
      expect(item.report?.state).toBe('conditional');
      expect(item.report?.conditions?.[0]?.detail).toContain('no new commitments');
      expect(resolveCapabilityDisplayState(item).kind).toBe('action-required');
    }
  });

  test('RETIRED presents as unavailable (failed display, terminal) with the authority\u2019s reason', async () => {
    await composition.authorities.capability.retireCapability('cap-state-probe');
    const item = await port.getCapability('cap-state-probe');
    expect(item).not.toBeNull();
    if (item) {
      expect(item.report?.state).toBe('unavailable');
      expect(item.report?.reason).toContain('RETIRED');
      expect(resolveCapabilityDisplayState(item).kind).toBe('failed');
    }
  });

  test('the listing presents the registry with per-id filtering honored', async () => {
    await registerAndActivate('cap-list-a');
    await registerAndActivate('cap-list-b');
    const all = await port.listCapabilities();
    expect(all.items.length).toBeGreaterThan(1);
    const filtered = await port.listCapabilities({ capabilityIds: ['cap-list-a'] });
    expect(filtered.items.length).toBe(1);
    expect(filtered.items[0]?.descriptor.id).toBe('cap-list-a');
  });
});
