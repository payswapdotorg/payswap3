/**
 * PC-003 — Owning-source registry tests: completeness, metadata shape, and
 * SYMBOL IDENTITY of every recorded owning source (adapter thinness — the
 * registry names the REAL exports the read models delegate through, proven
 * by reference equality, not by string).
 */

import { describe, expect, test } from 'bun:test';

import {
  CONSOLE_READ_MODEL_IDS,
  CONSOLE_SOURCE_REGISTRY,
  consoleSourceFor,
  consoleSourceMetadata,
  loadOperationsHealthProbe,
} from './sources';
import type { ConsoleAuthorityMetadata } from '../types';
import { getIntentPort } from '@/lib/protocol/intent-port';
import { getCheckoutPort } from '@/lib/protocol/checkout-port';
import { getCapabilityPort } from '@/lib/protocol/capability-port';
import { getWaitingPort } from '@/lib/protocol/waiting-port';
import { scrubCredentialReferences } from '@/lib/observability/logging';
import { INTENT_STATE_DISPLAY_MAP, BOUNDARY_DISPLAY_RESOLUTION } from '@/lib/protocol/intent-state-mapping';
import { resolveCheckoutDisplay } from '@/lib/protocol/checkout-state-mapping';
import { resolveCapabilityDisplayState } from '@/lib/protocol/capability-state-mapping';
import { OBSERVABILITY_DOMAINS } from '@/lib/observability/taxonomy';

const METADATA_FIELDS: readonly (keyof ConsoleAuthorityMetadata)[] = [
  'view',
  'protocolObject',
  'owningAuthority',
  'runtimeBoundary',
  'durableSource',
  'unknownSemantics',
  'evidenceReference',
];

describe('PC-003 owning-source registry — completeness and shape', () => {
  test('every design §17 read model is registered exactly once', () => {
    expect(CONSOLE_SOURCE_REGISTRY.length).toBe(CONSOLE_READ_MODEL_IDS.length);
    const ids = CONSOLE_SOURCE_REGISTRY.map((entry) => entry.readModel);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...CONSOLE_READ_MODEL_IDS].sort());
  });

  test('every entry carries the full nine-question metadata (all seven fields non-empty)', () => {
    for (const entry of CONSOLE_SOURCE_REGISTRY) {
      for (const field of METADATA_FIELDS) {
        const value = entry.metadata[field];
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      }
      expect(entry.designView.length).toBeGreaterThan(0);
    }
  });

  test('consoleSourceFor is fail-closed for unknown read models', () => {
    expect(consoleSourceFor('payments')).toBeDefined();
    expect(consoleSourceFor('not-a-read-model')).toBeUndefined();
  });

  test('consoleSourceMetadata throws only for wiring bugs (unknown ids), never for runtime input', () => {
    for (const id of CONSOLE_READ_MODEL_IDS) {
      expect(consoleSourceMetadata(id)).toBeDefined();
    }
    expect(() => consoleSourceMetadata('not-a-read-model' as never)).toThrow();
  });

  test('the developer-requests entry records the owning-authority GAP honestly (nothing fabricated)', () => {
    const gap = consoleSourceMetadata('developer-requests');
    expect(gap.owningAuthority).toContain('RECORDED GAP');
    expect(gap.owningAuthority).toContain('PENDING-PC-005');
    expect(gap.durableSource).toContain('none at this baseline');
    expect(gap.unknownSemantics).toContain('diagnostic UNKNOWN');
  });
});

describe('PC-003 owning-source registry — symbol identity (adapter thinness)', () => {
  test('the payments entry records the REAL intent-port accessor and mapping symbols', () => {
    const entry = consoleSourceFor('payments');
    expect(entry?.accessors).toEqual([getIntentPort]);
    expect(entry?.displayResolutions).toEqual([INTENT_STATE_DISPLAY_MAP, BOUNDARY_DISPLAY_RESOLUTION]);
  });

  test('the payment-detail entry records the REAL intent + waiting port accessors', () => {
    const entry = consoleSourceFor('payment-detail');
    expect(entry?.accessors).toEqual([getIntentPort, getWaitingPort]);
  });

  test('the checkout entries record the REAL checkout-port accessor and display resolver', () => {
    for (const id of ['checkout-sessions', 'checkout-session-status'] as const) {
      const entry = consoleSourceFor(id);
      expect(entry?.accessors).toEqual([getCheckoutPort]);
      expect(entry?.displayResolutions).toEqual([resolveCheckoutDisplay]);
    }
  });

  test('the capabilities entry records the REAL capability-port accessor and display resolver', () => {
    const entry = consoleSourceFor('capabilities');
    expect(entry?.accessors).toEqual([getCapabilityPort]);
    expect(entry?.displayResolutions).toEqual([resolveCapabilityDisplayState]);
  });

  test('the operations-health entry records the lazy readiness-probe accessor and domain vocabulary', () => {
    const entry = consoleSourceFor('operations-health');
    // The readiness probe (the /api/ready composition point) is recorded as
    // the registry's OWN lazy accessor — its module graph binds the
    // server-only durable substrate, so it is loaded on demand and never
    // statically from console code (behavioral delegation is proven in
    // operations-health.test.ts against the mocked readiness module).
    expect(entry?.accessors).toEqual([loadOperationsHealthProbe]);
    expect(typeof loadOperationsHealthProbe).toBe('function');
    expect(entry?.metadata.runtimeBoundary).toContain('probeComponentHealth()');
    expect(entry?.metadata.runtimeBoundary).toContain('src/lib/observability/readiness.ts');
    expect(entry?.displayResolutions).toEqual([OBSERVABILITY_DOMAINS]);
  });

  test('the developer-requests entry records the REAL redaction primitive', () => {
    const entry = consoleSourceFor('developer-requests');
    expect(entry?.accessors).toEqual([scrubCredentialReferences]);
  });

  test('every recorded accessor is a function (a hallucinated source cannot register)', () => {
    for (const entry of CONSOLE_SOURCE_REGISTRY) {
      expect(entry.accessors.length).toBeGreaterThan(0);
      for (const accessor of entry.accessors) {
        expect(typeof accessor).toBe('function');
      }
    }
  });
});
