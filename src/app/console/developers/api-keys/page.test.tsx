/**
 * PC-005 — API-keys page tests (composition through the REAL read model).
 *
 * The PC-003/PC-004 page-test convention: 'next/headers' mocked (the
 * audience cookie is the only input a test controls), the REAL page
 * component renders through the REAL PC-005 read model over the REAL
 * in-memory store (reset per test — store-reset.ts).
 *
 * Proven here:
 *   - merchant (the only allowed role) receives the composed surface:
 *     provenance note, boundary contract, create form, honest empty VALUE;
 *   - the one-time receipt renders the secret ONCE — a second render of
 *     the same receipt shows the honest already-shown state, never the
 *     secret;
 *   - created keys list with id/label/environment (never the secret);
 *   - the error flag renders the honest rejection panel;
 *   - every other role is redirected before any read composes.
 */

import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { resetDeveloperControlStoresForTesting } from '@/lib/console/developers/store-reset';
import { getDeveloperApiKeyStore } from '@/lib/console/developers/api-key-store';
import { getDeveloperCreationReceiptStore } from '@/lib/console/developers/creation-receipt';

let mockedAudienceCookie: string | undefined;

mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'payswap-shell-audience' ? { value: mockedAudienceCookie } : undefined,
  }),
}));

const ConsoleDevelopersApiKeysPage = (await import('./page')).default;

function reset(): void {
  resetDeveloperControlStoresForTesting();
}

async function renderPage(searchParams: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(
    await ConsoleDevelopersApiKeysPage({ searchParams: Promise.resolve(searchParams) }),
  );
}

describe('PC-005 /console/developers/api-keys page — composition', () => {
  test('merchant receives the composed surface with the honest empty VALUE', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    const html = await renderPage();
    expect(html).toContain('data-console-view="developer-api-keys"');
    // The honest provenance note (in-memory ruling) renders.
    expect(html).toContain('data-console-developer-provenance="in-memory"');
    expect(html).toContain('In-memory developer surface — not durable, not protocol evidence');
    // The empty registry is a VALUE, not an unavailable read.
    expect(html).toContain('data-testid="console-api-keys-empty-value"');
    expect(html).toContain('No API keys recorded yet');
    expect(html.includes('data-console-read="unavailable"')).toBe(false);
    // The create form targets the credential boundary.
    expect(html).toContain('action="/api/console/developers/api-keys"');
    expect(html).toContain('name="label"');
    // The boundary contract states the server-derived environment rule.
    expect(html).toContain('no query parameter, form field, header, or client value can select it');
    // No secret-once panel without a receipt — the honest already-shown note.
    expect(html).toContain('data-testid="developer-secret-already-shown"');
    expect(html.includes('data-console-developer-secret-once')).toBe(false);
  });

  test('a created key lists with id/label/environment — the secret NEVER renders', async () => {
    reset();
    const created = getDeveloperApiKeyStore().create(
      { label: 'page-key' },
      { role: 'merchant', environment: 'sandbox' },
    );
    if (!created.ok) throw new Error('expected creation to succeed');
    mockedAudienceCookie = 'merchant';
    const html = await renderPage();
    expect(html).toContain('data-console-developer-api-key');
    expect(html).toContain('page-key');
    expect(html).toContain('data-testid="console-api-key-environment">sandbox');
    // The plaintext never renders (list, audit, or anywhere else).
    expect(html.includes(created.created.secret)).toBe(false);
    // The audit trail renders the creation entry (secret-free).
    expect(html).toContain('data-console-developer-audit="api-key.created"');
    // The explicit revoke form posts action=revoke with the key id.
    expect(html).toContain('name="action" value="revoke"');
  });

  test('a one-time receipt renders the secret EXACTLY ONCE', async () => {
    reset();
    const created = getDeveloperApiKeyStore().create(
      { label: 'receipt-key' },
      { role: 'merchant', environment: 'sandbox' },
    );
    if (!created.ok) throw new Error('expected creation to succeed');
    const receiptId = getDeveloperCreationReceiptStore().issue(
      created.created.secret,
      created.created.key.id,
    );
    mockedAudienceCookie = 'merchant';
    const first = await renderPage({ receipt: receiptId });
    expect(first).toContain('data-console-developer-secret-once="true"');
    expect(first).toContain('data-testid="developer-secret-once-value"');
    expect(first).toContain(created.created.secret);
    expect(first).toContain('shown this one time only');
    // The SAME receipt renders the honest already-shown state — never the secret.
    const second = await renderPage({ receipt: receiptId });
    expect(second).toContain('data-testid="developer-secret-already-shown"');
    expect(second.includes(created.created.secret)).toBe(false);
  });

  test('the boundary error flag renders the honest rejection panel', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    const html = await renderPage({ error: 'invalid-label' });
    expect(html).toContain('data-testid="console-developer-boundary-error"');
    expect(html).toContain('invalid-label');
  });

  test('a spoofed env search parameter cannot select the environment (server-derived only)', async () => {
    reset();
    const saved = process.env.PAYSWAP_ENV;
    try {
      delete process.env.PAYSWAP_ENV;
      // A key created through the real store under the CURRENT server-derived
      // environment (sandbox — the fail-safe with PAYSWAP_ENV unset).
      const created = getDeveloperApiKeyStore().create(
        { label: 'env-spoof-key' },
        { role: 'merchant', environment: 'sandbox' },
      );
      if (!created.ok) throw new Error('expected creation to succeed');
      mockedAudienceCookie = 'merchant';
      // The spoofed selector rides the request; the read takes NO input.
      const html = await renderPage({ env: 'production' });
      // The listed key renders the SERVER-DERIVED environment (sandbox) —
      // never the spoofed production — and there is no environment selector
      // anywhere in the markup.
      expect(html).toContain('data-testid="console-api-key-environment">sandbox');
      expect(html).toContain('env-spoof-key');
      expect(html).toContain('this form has no environment field by design');
      // The spoofed value cannot leak into any key's environment slot.
      expect(html).toContain('data-testid="console-api-key-environment">sandbox</dd>');
      expect(html.includes('data-testid="console-api-key-environment">production')).toBe(false);
    } finally {
      if (saved === undefined) {
        delete process.env.PAYSWAP_ENV;
      } else {
        process.env.PAYSWAP_ENV = saved;
      }
    }
  });
});

describe('PC-005 /console/developers/api-keys page — role isolation', () => {
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
