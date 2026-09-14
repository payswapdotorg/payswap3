/**
 * PC-005 — Request-log store tests: redaction BEFORE storage, bounded ring,
 * honest filtering.
 *
 * The critical suite for the design §11 redaction chain: assertions run ON
 * THE STORED ENTRIES (what `query()` returns is what was stored) — proving
 * credentials, authorization headers, and secret-bearing fields never
 * ENTER the ring unredacted, so no later read (logs list, inspector
 * detail) can ever leak them.
 */

import { describe, expect, test } from 'bun:test';
import { createDeveloperRequestLogStore } from './request-log-store';
import { scrubCredentialReferences } from '@/lib/observability/logging';

function fixedStore(capacity?: number) {
  let tick = 0;
  return createDeveloperRequestLogStore({
    ...(capacity === undefined ? {} : { capacity }),
    now: () => 3000 + tick++,
  });
}

describe('PC-005 request-log store — redaction happens BEFORE storage', () => {
  test('authorization headers and secret fields are scrubbed in the STORED entry', () => {
    const store = fixedStore();
    const entry = store.ingest({
      method: 'POST',
      path: '/api/console/developers/api-keys',
      status: 200,
      event: 'console.developers.api-key.created',
      data: {
        authorization: 'Bearer abcdefghijklmnopqrst',
        'x-api-key': 'super-secret-value-123',
        label: 'ci-key',
        nested: { secret: 'sk-abcdefghijklmnopqrst', keep: 'visible' },
      },
    });
    // Assert ON THE STORED ENTRY: the redacted markers replaced the
    // sensitive values at ingestion time.
    const data = entry.data as Record<string, unknown>;
    expect(data.authorization).toBe('[REDACTED:credential-reference]');
    expect(data['x-api-key']).toBe('[REDACTED:sensitive-key]');
    expect(data.label).toBe('ci-key');
    const nested = data.nested as Record<string, unknown>;
    expect(nested.secret).toBe('[REDACTED:sensitive-key]');
    expect(nested.keep).toBe('visible');
  });

  test('a stored entry NEVER contains the raw secret material anywhere', () => {
    const store = fixedStore();
    store.ingest({
      method: 'POST',
      path: '/api/console/developers/webhooks',
      status: 200,
      event: 'console.developers.webhook-endpoint.created',
      data: { signingSecret: 'payswap_whsec_abcdefghijklmnopqrstuvwx', url: 'https://example.com/h' },
    });
    const serialized = JSON.stringify(store.query());
    expect(serialized.includes('payswap_whsec_abcdefghijklmnopqrstuvwx')).toBe(false);
    expect(serialized.includes('[REDACTED:sensitive-key]')).toBe(true);
  });

  test('path and method strings also pass the fail-closed scrub', () => {
    const store = fixedStore();
    const entry = store.ingest({
      method: 'GET',
      path: '/api/console/developers/api-keys?token=abcdefghijklmnop',
      status: 200,
      event: 'console.developers.api-keys.listed',
    });
    expect(entry.path).toBe(scrubCredentialReferences('/api/console/developers/api-keys?token=abcdefghijklmnop'));
    expect(entry.method).toBe('GET');
  });

  test('the redaction is the SAME primitive the structured logger uses', () => {
    const store = fixedStore();
    const payload = { password: 'hunter2000', note: 'plain' };
    const entry = store.ingest({
      method: 'GET',
      path: '/api/console/developers/api-keys',
      status: 200,
      event: 'e',
      data: payload,
    });
    expect(entry.data).toEqual(scrubCredentialReferences(payload));
  });
});

describe('PC-005 request-log store — level derivation and metadata', () => {
  test('levels derive from the status (2xx/3xx info, 4xx warn, 5xx error)', () => {
    const store = fixedStore();
    for (const [status, level] of [
      [200, 'info'],
      [303, 'info'],
      [404, 'warn'],
      [422, 'warn'],
      [500, 'error'],
    ] as const) {
      const entry = store.ingest({ method: 'GET', path: '/p', status, event: 'e' });
      expect(entry.level).toBe(level);
    }
  });

  test('entries get monotonic ids and the supplied wall clock', () => {
    const store = fixedStore();
    const first = store.ingest({ method: 'GET', path: '/a', status: 200, event: 'e1' });
    const second = store.ingest({ method: 'GET', path: '/b', status: 200, event: 'e2' });
    expect(second.id).toBe(first.id + 1);
    expect(first.wallMs).toBe(3000);
    expect(second.wallMs).toBe(3001);
  });
});

describe('PC-005 request-log store — the ring is bounded (oldest dropped)', () => {
  test('capacity bounds the ring: the oldest entries are dropped first', () => {
    const store = fixedStore(3);
    for (let i = 0; i < 5; i += 1) {
      store.ingest({ method: 'GET', path: `/p${i}`, status: 200, event: 'e' });
    }
    expect(store.size()).toBe(3);
    // Newest first: p4, p3, p2 — p0 and p1 were dropped.
    expect(store.query().map((entry) => entry.path)).toEqual(['/p4', '/p3', '/p2']);
    expect(store.capacity()).toBe(3);
  });
});

describe('PC-005 request-log store — honest AND-combined filtering', () => {
  test('filter by path, by status, and combined; newest first', () => {
    const store = fixedStore();
    store.ingest({ method: 'GET', path: '/api/console/developers/api-keys', status: 200, event: 'a' });
    store.ingest({ method: 'POST', path: '/api/console/developers/api-keys', status: 422, event: 'b' });
    store.ingest({ method: 'GET', path: '/api/console/developers/webhooks', status: 200, event: 'c' });

    expect(store.query({ path: '/api/console/developers/api-keys' }).map((e) => e.event)).toEqual([
      'b',
      'a',
    ]);
    expect(store.query({ status: 422 }).map((e) => e.event)).toEqual(['b']);
    expect(
      store.query({ path: '/api/console/developers/api-keys', status: 200 }).map((e) => e.event),
    ).toEqual(['a']);
    // An empty result is an honest VALUE for the filter (nothing matches).
    expect(store.query({ path: '/no/such/path' })).toEqual([]);
  });

  test('the default limit is 100 (newest 100 of many)', () => {
    const store = fixedStore();
    for (let i = 0; i < 150; i += 1) {
      store.ingest({ method: 'GET', path: '/p', status: 200, event: `e${i}` });
    }
    const page = store.query();
    expect(page.length).toBe(100);
    expect(page[0]?.event).toBe('e149');
    expect(page[99]?.event).toBe('e50');
  });
});
