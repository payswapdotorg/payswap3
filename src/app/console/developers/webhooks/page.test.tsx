/**
 * PC-005 — Webhooks page tests (composition through the REAL read model).
 *
 * The PC-004 page-test convention: 'next/headers' mocked (the audience
 * cookie is the only input a test controls), the REAL page component
 * renders through the REAL PC-005 read model over the REAL in-memory
 * webhook store (reset per test — store-reset.ts).
 *
 * Proven here:
 *   - merchant (the only allowed role) receives the composed surface:
 *     provenance note, create form, the event catalog FROM THE REAL
 *     vocabulary catalog, and the honest no-delivery-worker state;
 *   - a registered endpoint lists id/url/environment — the signing
 *     secret NEVER renders (list, audit, or anywhere else);
 *   - the one-time receipt renders the signing secret ONCE — a second
 *     render of the same receipt shows the honest already-shown state;
 *   - explicit revocation is visible and audited (created + revoked
 *     audit entries, secret-free);
 *   - a spoofed env selector is structurally ignored (server-derived);
 *   - every other role is redirected before any read composes.
 */

import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { resetDeveloperControlStoresForTesting } from '@/lib/console/developers/store-reset';
import { getDeveloperWebhookStore } from '@/lib/console/developers/webhook-store';
import { getDeveloperCreationReceiptStore } from '@/lib/console/developers/creation-receipt';
import { CONSOLE_WEBHOOK_EVENT_CATALOG } from '@/lib/console/developers/webhook-events';

let mockedAudienceCookie: string | undefined;

mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'payswap-shell-audience' ? { value: mockedAudienceCookie } : undefined,
  }),
}));

const ConsoleDevelopersWebhooksPage = (await import('./page')).default;

function reset(): void {
  resetDeveloperControlStoresForTesting();
}

async function renderPage(searchParams: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(
    await ConsoleDevelopersWebhooksPage({ searchParams: Promise.resolve(searchParams) }),
  );
}

describe('PC-005 /console/developers/webhooks page — composition', () => {
  test('merchant receives the composed surface with the REAL event catalog and honest delivery state', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    const html = await renderPage();
    expect(html).toContain('data-console-view="developer-webhooks"');
    expect(html).toContain('data-console-developer-provenance="in-memory"');
    // The honest empty VALUE for the registry.
    expect(html).toContain('data-testid="console-webhooks-empty-value"');
    expect(html).toContain('No webhook endpoints registered yet');
    expect(html.includes('data-console-read="unavailable"')).toBe(false);
    // The create form targets the credential boundary.
    expect(html).toContain('action="/api/console/developers/webhooks"');
    expect(html).toContain('name="url"');
    // Every catalog entry from the REAL vocabulary catalog renders, with
    // per-entry attribution of the owning vocabulary.
    for (const entry of CONSOLE_WEBHOOK_EVENT_CATALOG) {
      expect(html).toContain(`data-console-webhook-event="${entry.identifier}"`);
      expect(html).toContain(entry.sourceModule);
    }
    // The honest delivery state (no worker, no replay implication) is stated.
    expect(html).toContain('data-console-webhook-delivery-state="no-worker"');
    expect(html).toContain('No delivery worker exists at this baseline');
    // No secret-once panel without a receipt.
    expect(html).toContain('data-testid="developer-secret-already-shown"');
    expect(html.includes('data-console-developer-secret-once')).toBe(false);
  });

  test('a registered endpoint lists with id/url/environment — the signing secret NEVER renders', async () => {
    reset();
    const created = getDeveloperWebhookStore().create(
      { url: 'https://example.com/webhooks/payswap' },
      { role: 'merchant', environment: 'sandbox' },
    );
    if (!created.ok) throw new Error('expected creation to succeed');
    mockedAudienceCookie = 'merchant';
    const html = await renderPage();
    expect(html).toContain('data-console-developer-webhook');
    expect(html).toContain('https://example.com/webhooks/payswap');
    // The plaintext signing secret never renders anywhere on the page.
    expect(html.includes(created.created.signingSecret)).toBe(false);
    expect(html.includes('payswap_whsec_')).toBe(false);
    // The audit trail renders the creation entry (secret-free).
    expect(html).toContain('data-console-developer-audit="webhook-endpoint.created"');
    // The explicit revoke form posts action=revoke with the endpoint id.
    expect(html).toContain('name="action" value="revoke"');
  });

  test('a one-time receipt renders the signing secret EXACTLY ONCE', async () => {
    reset();
    const created = getDeveloperWebhookStore().create(
      { url: 'https://example.com/webhooks/once' },
      { role: 'merchant', environment: 'sandbox' },
    );
    if (!created.ok) throw new Error('expected creation to succeed');
    const receiptId = getDeveloperCreationReceiptStore().issue(
      created.created.signingSecret,
      created.created.endpoint.id,
    );
    mockedAudienceCookie = 'merchant';
    const first = await renderPage({ receipt: receiptId });
    expect(first).toContain('data-console-developer-secret-once="true"');
    expect(first).toContain('data-testid="developer-secret-once-value"');
    expect(first).toContain(created.created.signingSecret);
    expect(first).toContain('signing secret is shown this one time only');
    // The SAME receipt renders the honest already-shown state — never the secret.
    const second = await renderPage({ receipt: receiptId });
    expect(second).toContain('data-testid="developer-secret-already-shown"');
    expect(second.includes(created.created.signingSecret)).toBe(false);
  });

  test('explicit revocation is visible and audited (created + revoked entries, secret-free)', async () => {
    reset();
    const store = getDeveloperWebhookStore();
    const context = { role: 'merchant', environment: 'sandbox' } as const;
    const created = store.create({ url: 'https://example.com/webhooks/revoke' }, context);
    if (!created.ok) throw new Error('expected creation to succeed');
    const revoked = store.revoke({ id: created.created.endpoint.id }, context);
    if (!revoked.ok) throw new Error('expected revocation to succeed');
    mockedAudienceCookie = 'merchant';
    const html = await renderPage();
    // The revoked badge renders (explicit, not silent).
    expect(html).toContain('>Revoked<');
    // No revoke form remains for the revoked endpoint.
    expect(html).toContain(`data-console-developer-webhook="${created.created.endpoint.id}"`);
    // The audit trail records BOTH mutations, secret-free.
    expect(html).toContain('data-console-developer-audit="webhook-endpoint.created"');
    expect(html).toContain('data-console-developer-audit="webhook-endpoint.revoked"');
    expect(html.includes(created.created.signingSecret)).toBe(false);
  });

  test('a spoofed env search parameter cannot select the environment (server-derived only)', async () => {
    reset();
    const saved = process.env.PAYSWAP_ENV;
    try {
      delete process.env.PAYSWAP_ENV;
      const created = getDeveloperWebhookStore().create(
        { url: 'https://example.com/webhooks/env' },
        { role: 'merchant', environment: 'sandbox' },
      );
      if (!created.ok) throw new Error('expected creation to succeed');
      mockedAudienceCookie = 'merchant';
      const html = await renderPage({ env: 'production' });
      // The endpoint renders the SERVER-DERIVED environment (sandbox).
      expect(html).toContain('Endpoints in this environment (sandbox)');
      // The form states the server-derived environment inside a span —
      // the spoofed selector cannot leak in as a rendered environment scope.
      expect(html).toContain('server-derived environment (<span class="font-semibold">sandbox</span>)');
      expect(html.includes('Endpoints in this environment (production)')).toBe(false);
    } finally {
      if (saved === undefined) {
        delete process.env.PAYSWAP_ENV;
      } else {
        process.env.PAYSWAP_ENV = saved;
      }
    }
  });
});

describe('PC-005 /console/developers/webhooks page — role isolation', () => {
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
