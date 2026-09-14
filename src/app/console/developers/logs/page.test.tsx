/**
 * PC-005 — Request-logs page tests (composition through the REAL read model).
 *
 * The PC-004 page-test convention: 'next/headers' mocked (the audience
 * cookie is the only input a test controls), the REAL page component
 * renders through the REAL PC-005 read model over the REAL in-memory
 * diagnostic ring (reset per test — store-reset.ts).
 *
 * Proven here:
 *   - merchant (the only allowed role) receives the composed surface:
 *     the diagnostic-not-evidence provenance, the redaction provenance
 *     line, the capacity bound, and the honest empty VALUE;
 *   - REDACTION BEFORE STORAGE, asserted ON THE STORED ENTRY: an ingested
 *     payload carrying an authorization header and secret-bearing fields
 *     is already scrubbed in the ring (the unredacted form was never
 *     stored), and the page renders only the scrubbed form;
 *   - entries render method/path/status and the (already-redacted) payload;
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

const ConsoleDevelopersLogsPage = (await import('./page')).default;

function reset(): void {
  resetDeveloperControlStoresForTesting();
}

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await ConsoleDevelopersLogsPage());
}

/** A payload a careless boundary might observe — never stored unredacted. */
const SECRET_BEARING_PAYLOAD = {
  outcome: 'created',
  authorization: 'Bearer payswap_dev_abcdefghijklmnopqrstuvwxyz012345',
  apiKey: 'payswap_dev_raw-plaintext-never-to-be-stored',
  label: 'innocent-label',
};

describe('PC-005 /console/developers/logs page — composition', () => {
  test('merchant receives the composed surface with the honest empty VALUE', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    const html = await renderPage();
    expect(html).toContain('data-console-view="developer-logs"');
    // The honest provenance note + the diagnostic-not-evidence note.
    expect(html).toContain('data-console-developer-provenance="in-memory"');
    expect(html).toContain('data-testid="developer-diagnostic-note"');
    expect(html).toContain('Diagnostic data, not protocol evidence');
    // The redaction provenance line (the primitive + where it applied).
    expect(html).toContain('data-testid="console-logs-redaction"');
    expect(html).toContain('scrubCredentialReferences');
    expect(html).toContain('before storage');
    // The honest empty VALUE (never an unavailable read).
    expect(html).toContain('data-testid="console-logs-empty-value"');
    expect(html).toContain('No entries recorded yet');
    expect(html.includes('data-console-read="unavailable"')).toBe(false);
    // The capacity bound is stated.
    expect(html).toContain('entries (oldest drop at capacity)');
  });

  test('redaction happens BEFORE storage — asserted on the STORED entry, then rendered scrubbed', async () => {
    reset();
    ingestDeveloperRequestLog({
      method: 'POST',
      path: '/api/console/developers/api-keys',
      status: 200,
      event: 'console.developers.api-keys.created',
      data: SECRET_BEARING_PAYLOAD,
    });

    // ── The assertion is ON THE STORED ENTRY (the ring), not the render ──
    const stored = queryDeveloperRequestLogs();
    expect(stored.length).toBe(1);
    const entry = stored[0] as { data: Record<string, unknown> };
    // The authorization VALUE was redacted (Bearer-secret shape).
    expect(entry.data.authorization).toBe('[REDACTED:credential-reference]');
    // The secret-bearing KEY's value was redacted (credential naming).
    expect(entry.data.apiKey).toBe('[REDACTED:sensitive-key]');
    // The innocent field survives — the scrub is not a blanket wipe.
    expect(entry.data.outcome).toBe('created');
    expect(entry.data.label).toBe('innocent-label');

    // The page renders the STORED (already-redacted) form only.
    mockedAudienceCookie = 'merchant';
    const html = await renderPage();
    expect(html).toContain('data-console-developer-log-entry=');
    expect(html).toContain('/api/console/developers/api-keys');
    expect(html).toContain('data-testid="console-log-entry-status">200');
    // The rendered payload is the scrubbed form — never the raw material.
    expect(html).toContain('[REDACTED:credential-reference]');
    expect(html).toContain('[REDACTED:sensitive-key]');
    expect(html.includes('Bearer payswap_dev_')).toBe(false);
    expect(html.includes('raw-plaintext-never-to-be-stored')).toBe(false);
    expect(html).toContain('innocent-label');
  });

  test('entries render method/path/status and the already-redacted payload; level derives from status', async () => {
    reset();
    ingestDeveloperRequestLog({
      method: 'GET',
      path: '/api/console/developers/webhooks',
      status: 404,
      event: 'console.developers.boundary.denied',
      data: { outcome: 'denied' },
    });
    mockedAudienceCookie = 'merchant';
    const html = await renderPage();
    expect(html).toContain('data-console-developer-log-entry=');
    expect(html).toContain('GET');
    expect(html).toContain('console.developers.boundary.denied');
    expect(html).toContain('data-testid="console-log-entry-status">404');
    // 4xx derives the warn level (rendered verbatim).
    expect(html).toContain('data-console-log-level="warn"');
    expect(html).toContain('data-testid="console-logs-recorded">1');
  });
});

describe('PC-005 /console/developers/logs page — role isolation', () => {
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
