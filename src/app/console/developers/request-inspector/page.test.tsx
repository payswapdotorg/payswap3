/**
 * PC-005 — Request-inspector page tests (composition through the REAL read
 * model).
 *
 * The PC-004 page-test convention: 'next/headers' mocked (the audience
 * cookie is the only input a test controls), the REAL page component
 * renders through the REAL PC-005 read model over the REAL in-memory
 * diagnostic ring (reset per test — store-reset.ts).
 *
 * Proven here:
 *   - merchant (the only allowed role) receives the composed surface: the
 *     filter form (a GET form — presentation filtering only), the
 *     per-entry detail, and the explicit NO-EXPORT statement;
 *   - path/status filters apply SERVER-SIDE through the page's own
 *     searchParams and are echoed verbatim; malformed values are ignored
 *     defensively (never fabricated into entries);
 *   - the rendered payload is the STORED (already-redacted) form —
 *     asserted on the stored entry too;
 *   - an empty result set for active filters is the honest VALUE;
 *   - every other role is redirected before any read composes.
 */

import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { resetDeveloperControlStoresForTesting } from '@/lib/console/developers/store-reset';
import {
  ingestDeveloperRequestLog,
  queryDeveloperRequestLogs,
} from '@/lib/console/developers/request-log-store';

let mockedAudienceCookie: string | undefined;

mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'payswap-shell-audience' ? { value: mockedAudienceCookie } : undefined,
  }),
}));

const ConsoleDevelopersRequestInspectorPage = (await import('./page')).default;

function reset(): void {
  resetDeveloperControlStoresForTesting();
}

function seed(): void {
  ingestDeveloperRequestLog({
    method: 'POST',
    path: '/api/console/developers/api-keys',
    status: 200,
    event: 'console.developers.api-keys.created',
    data: { outcome: 'created' },
  });
  ingestDeveloperRequestLog({
    method: 'GET',
    path: '/api/console/developers/webhooks',
    status: 404,
    event: 'console.developers.boundary.denied',
    data: {
      outcome: 'denied',
      authorization: 'Bearer payswap_dev_abcdefghijklmnopqrstuvwxyz012345',
    },
  });
}

async function renderPage(searchParams: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(
    await ConsoleDevelopersRequestInspectorPage({ searchParams: Promise.resolve(searchParams) }),
  );
}

describe('PC-005 /console/developers/request-inspector page — composition', () => {
  test('merchant receives the composed surface (filter form, entries, explicit no-export)', async () => {
    reset();
    seed();
    mockedAudienceCookie = 'merchant';
    const html = await renderPage();
    expect(html).toContain('data-console-view="developer-request-inspector"');
    expect(html).toContain('data-console-developer-provenance="in-memory"');
    expect(html).toContain('data-testid="developer-diagnostic-note"');
    // The filter form is a GET form to this page (presentation filtering).
    expect(html).toContain('action="/console/developers/request-inspector" method="get"');
    expect(html).toContain('name="path"');
    expect(html).toContain('name="status"');
    // Both seeded entries render with method/path/status.
    expect(html).toContain('data-console-inspector-entry=');
    expect(html).toContain('console.developers.api-keys.created');
    expect(html).toContain('console.developers.boundary.denied');
    // The explicit NO-EXPORT statement (a designed absence, stated).
    expect(html).toContain('data-testid="console-inspector-no-export"');
    expect(html).toContain('No export exists on this surface by design');
    // No download/dump affordance anywhere.
    expect(html.includes('download=')).toBe(false);
  });

  test('the rendered payload is the STORED already-redacted form — never the raw material', async () => {
    reset();
    ingestDeveloperRequestLog({
      method: 'POST',
      path: '/api/console/developers/webhooks',
      status: 200,
      event: 'console.developers.webhooks.created',
      data: {
        outcome: 'created',
        authorization: 'Bearer payswap_dev_abcdefghijklmnopqrstuvwxyz012345',
        signingSecret: 'payswap_whsec_raw-plaintext-never-to-be-stored',
      },
    });
    // Assert ON THE STORED ENTRY first (redaction before storage).
    const stored = queryDeveloperRequestLogs();
    expect(stored.length).toBe(1);
    const entry = stored[0] as { data: Record<string, unknown> };
    expect(entry.data.authorization).toBe('[REDACTED:credential-reference]');
    expect(entry.data.signingSecret).toBe('[REDACTED:sensitive-key]');
    expect(entry.data.outcome).toBe('created');

    mockedAudienceCookie = 'merchant';
    const html = await renderPage();
    expect(html).toContain('[REDACTED:credential-reference]');
    expect(html).toContain('[REDACTED:sensitive-key]');
    expect(html.includes('Bearer payswap_dev_')).toBe(false);
    expect(html.includes('raw-plaintext-never-to-be-stored')).toBe(false);
  });

  test('path and status filters apply server-side and are echoed verbatim', async () => {
    reset();
    seed();
    mockedAudienceCookie = 'merchant';
    const html = await renderPage({
      path: '/api/console/developers/webhooks',
      status: '404',
    });
    // Only the matching entry renders.
    expect(html).toContain('console.developers.boundary.denied');
    expect(html.includes('console.developers.api-keys.created')).toBe(false);
    // The filter is echoed verbatim in the form defaults.
    expect(html).toContain('value="/api/console/developers/webhooks"');
    expect(html).toContain('value="404"');
    // The filtered heading states the active filter.
    expect(html).toContain('Entries (filtered)');
  });

  test('malformed filter values are ignored defensively — never fabricated into entries', async () => {
    reset();
    seed();
    mockedAudienceCookie = 'merchant';
    const html = await renderPage({ status: 'abc', path: '   ' });
    // Whitespace-only path and a non-numeric status are dropped: the read
    // composes with NO filter, so both entries render.
    expect(html).toContain('console.developers.api-keys.created');
    expect(html).toContain('console.developers.boundary.denied');
    expect(html.includes('Entries (filtered)')).toBe(false);
  });

  test('an empty result set for active filters is the honest VALUE', async () => {
    reset();
    seed();
    mockedAudienceCookie = 'merchant';
    const html = await renderPage({ status: '500' });
    expect(html).toContain('data-testid="console-inspector-empty-value"');
    expect(html).toContain('No entries match the active filters');
    expect(html).toContain('entries buffered in total');
    expect(html.includes('data-console-read="unavailable"')).toBe(false);
  });
});

describe('PC-005 /console/developers/request-inspector page — role isolation', () => {
  test('every non-merchant viewer is redirected before any read composes', async () => {
    reset();
    for (const audience of ['customer', 'provider', 'operator', 'administrator', undefined]) {
      mockedAudienceCookie = audience;
      let thrown: unknown;
      try {
        await renderPage();
      } catch (error) {
        thrown = error;
      }
      const digest = (thrown as { digest?: unknown })?.digest;
      expect(typeof digest).toBe('string');
      expect((digest as string).startsWith('NEXT_REDIRECT')).toBe(true);
    }
  });
});
