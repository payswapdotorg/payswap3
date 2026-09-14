/**
 * PC-005 — Console developer webhooks boundary route tests.
 *
 * Same conventions as the API-keys boundary tests (next/headers mock only,
 * real route handlers, real in-memory singletons reset per test).
 *
 * Proves through the HTTP boundary:
 *   - role isolation (merchant only; everyone else the bare 404);
 *   - the signing secret is a credential: shown ONCE (JSON create), never
 *     in the list, one-time receipt across the form redirect;
 *   - the GET result carries the real event catalog and the honest
 *     delivery-state note (no delivery worker exists — stated, not
 *     simulated);
 *   - endpoint revocation is explicit + audited, fail-closed on repeats;
 *   - URL validation fails closed through the boundary;
 *   - ingestion is payload-free (outcome word only).
 */

import { describe, expect, mock, test } from 'bun:test';
import { resetDeveloperControlStoresForTesting } from '@/lib/console/developers/store-reset';
import { getDeveloperRequestLogStore } from '@/lib/console/developers/request-log-store';
import { getDeveloperCreationReceiptStore } from '@/lib/console/developers/creation-receipt';
import { getDeveloperWebhookStore } from '@/lib/console/developers/webhook-store';
import { OBSERVABILITY_DOMAINS } from '@/lib/observability/taxonomy';

let mockedAudienceCookie: string | undefined;

mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'payswap-shell-audience' ? { value: mockedAudienceCookie } : undefined,
  }),
}));

const { GET, POST, DELETE } = await import('./route');

function reset(): void {
  resetDeveloperControlStoresForTesting();
}

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/console/developers/webhooks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function formRequest(fields: Record<string, string>): Request {
  return new Request('http://localhost/api/console/developers/webhooks', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

describe('PC-005 /api/console/developers/webhooks — role isolation (fail closed)', () => {
  test('unauthenticated and non-merchant roles receive the bare 404 denial', async () => {
    for (const audience of [undefined, 'customer', 'operator', 'administrator', 'provider']) {
      reset();
      mockedAudienceCookie = audience;
      const response = await GET();
      expect(response.status).toBe(404);
      const body = (await response.json()) as { ok?: unknown };
      expect(body.ok).toBe(false);
      expect(Object.keys(body)).toEqual(['ok']);
    }
  });
});

describe('PC-005 /api/console/developers/webhooks — GET list + real event catalog', () => {
  test('merchant receives the envelope with the catalog and the honest delivery state', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      result: {
        outcome: string;
        value: {
          endpoints: unknown[];
          eventCatalog: { identifier: string; source: string }[];
          deliveryStateNote: string;
          provenance: string;
        };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.result.value.endpoints).toEqual([]);
    const identifiers = body.result.value.eventCatalog.map((entry) => entry.identifier);
    for (const domain of OBSERVABILITY_DOMAINS) {
      expect(identifiers.includes(domain)).toBe(true);
    }
    expect(identifiers.includes('job_enqueued')).toBe(true);
    expect(body.result.value.deliveryStateNote).toContain('No delivery worker exists at this baseline');
    expect(body.result.value.deliveryStateNote).toContain('never imply protocol replay');
    expect(body.result.value.provenance).toContain('In-memory developer surface');
  });
});

describe('PC-005 /api/console/developers/webhooks — signing-secret credential semantics', () => {
  test('JSON creation returns the signing secret exactly ONCE; the list never shows it', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    const response = await POST(jsonRequest({ url: 'https://example.com/hooks' }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: {
        created: { endpoint: { id: string; url: string }; signingSecret: string };
        note: string;
      };
    };
    expect(body.result.created.endpoint.url).toBe('https://example.com/hooks');
    expect(body.result.created.signingSecret.startsWith('payswap_whsec_')).toBe(true);
    expect(body.result.note).toContain('one time only');
    expect(body.result.note).toContain('No delivery worker exists');

    const list = await GET();
    const listBody = (await list.json()) as { result: { value: { endpoints: unknown[] } } };
    expect(listBody.result.value.endpoints.length).toBe(1);
    expect(JSON.stringify(listBody).includes(body.result.created.signingSecret)).toBe(false);
  });

  test('form creation redirects 303 with a ONE-TIME receipt for the signing secret', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    const response = await POST(formRequest({ url: 'https://example.com/hooks' }));
    expect(response.status).toBe(303);
    const location = response.headers.get('location') ?? '';
    expect(location.startsWith('http://localhost/console/developers/webhooks?receipt=')).toBe(true);
    const receiptId = location.split('receipt=')[1] ?? '';
    const first = getDeveloperCreationReceiptStore().consume(receiptId);
    expect(first?.secret.startsWith('payswap_whsec_')).toBe(true);
    expect(getDeveloperCreationReceiptStore().consume(receiptId)).toBeNull();
  });

  test('URL validation fails closed through the boundary (422, nothing recorded)', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    const response = await POST(jsonRequest({ url: 'http://example.com/insecure' }));
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid-url');
    const list = await GET();
    const listBody = (await list.json()) as { result: { value: { endpoints: unknown[] } } };
    expect(listBody.result.value.endpoints.length).toBe(0);
    expect(getDeveloperWebhookStore().audit().length).toBe(0);
  });
});

describe('PC-005 /api/console/developers/webhooks — explicit, audited revocation', () => {
  test('DELETE revokes; the audit trail records created + revoked; repeats fail closed', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    const created = await POST(jsonRequest({ url: 'https://example.com/hooks' }));
    const createdBody = (await created.json()) as { result: { created: { endpoint: { id: string } } } };
    const endpointId = createdBody.result.created.endpoint.id;

    const revoked = await DELETE(
      new Request(`http://localhost/api/console/developers/webhooks?id=${endpointId}`, { method: 'DELETE' }),
    );
    expect(revoked.status).toBe(200);
    const audit = getDeveloperWebhookStore().audit();
    expect(audit.map((entry) => entry.action)).toEqual([
      'webhook-endpoint.created',
      'webhook-endpoint.revoked',
    ]);

    const second = await DELETE(
      new Request(`http://localhost/api/console/developers/webhooks?id=${endpointId}`, { method: 'DELETE' }),
    );
    expect(second.status).toBe(409);
    const unknown = await DELETE(
      new Request('http://localhost/api/console/developers/webhooks?id=wh_missing', { method: 'DELETE' }),
    );
    expect(unknown.status).toBe(404);
  });
});

describe('PC-005 /api/console/developers/webhooks — diagnostic log ingestion (payload-free)', () => {
  test('created requests land in the ring with the outcome word only — never the url or secret', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    await POST(jsonRequest({ url: 'https://example.com/hooks' }));
    const entries = getDeveloperRequestLogStore().query({ path: '/api/console/developers/webhooks' });
    expect(entries.map((entry) => entry.event)).toEqual(['console.developers.webhooks.created']);
    expect(entries[0]?.data).toEqual({ outcome: 'created' });
    const serialized = JSON.stringify(entries);
    expect(serialized.includes('example.com')).toBe(false);
    expect(serialized.includes('payswap_whsec_')).toBe(false);
  });
});
