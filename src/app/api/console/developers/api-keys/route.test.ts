/**
 * PC-005 — Console developer API-keys boundary route tests.
 *
 * The request-context chain is driven by mocking 'next/headers' ONLY (the
 * real audience authority and the real route handlers run unmodified) —
 * the same PC-003 route-test convention. The stores are the REAL in-memory
 * singletons, reset before every test (store-reset.ts).
 *
 * Proves the design §11 credential contract THROUGH the HTTP boundary:
 *   - role isolation: merchant (the frozen registry's only allowed role)
 *     passes; customer/operator/administrator/unauthenticated get the
 *     fail-closed 404 {ok:false} with no content;
 *   - creation (JSON mode) returns the plaintext token exactly ONCE; the
 *     list never contains it;
 *   - creation (form mode — the console page's plain form) redirects 303
 *     with a one-time receipt that hands back the secret exactly once;
 *   - environment scope: a spoofed ?env=production query parameter is
 *     IGNORED — the created key carries the server-derived environment;
 *   - revocation is explicit, audited, and fail-closed on repeats;
 *   - every request lands in the diagnostic request-log ring payload-free
 *     (method/path/status/outcome only — asserted on the stored entries).
 */

import { describe, expect, mock, test } from 'bun:test';
import { resetDeveloperControlStoresForTesting } from '@/lib/console/developers/store-reset';
import { getDeveloperRequestLogStore } from '@/lib/console/developers/request-log-store';
import { getDeveloperCreationReceiptStore } from '@/lib/console/developers/creation-receipt';
import { getDeveloperApiKeyStore } from '@/lib/console/developers/api-key-store';

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

function jsonRequest(body: unknown, url = 'http://localhost/api/console/developers/api-keys'): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function formRequest(fields: Record<string, string>): Request {
  return new Request('http://localhost/api/console/developers/api-keys', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

describe('PC-005 /api/console/developers/api-keys — role isolation (fail closed)', () => {
  test('unauthenticated and non-merchant roles receive the bare 404 denial', async () => {
    for (const audience of [undefined, 'customer', 'operator', 'administrator', 'provider']) {
      reset();
      mockedAudienceCookie = audience;
      const response = await GET();
      expect(response.status).toBe(404);
      const body = (await response.json()) as { ok?: unknown };
      expect(body.ok).toBe(false);
      expect(Object.keys(body)).toEqual(['ok']);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  test('denied attempts are still ingested into the diagnostic ring (payload-free)', async () => {
    reset();
    mockedAudienceCookie = 'customer';
    await GET();
    const entries = getDeveloperRequestLogStore().query({ path: '/api/console/developers/api-keys' });
    expect(entries.map((entry) => entry.status)).toEqual([404]);
    expect(entries[0]?.event).toBe('console.developers.boundary.denied');
    expect(entries[0]?.data).toEqual({ outcome: 'denied' });
  });
});

describe('PC-005 /api/console/developers/api-keys — GET list (secret-free)', () => {
  test('merchant receives the envelope with the honest empty VALUE and provenance note', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      principal: { role: string };
      environment: { derivedBy: string };
      result: {
        outcome: string;
        status: string;
        value: { keys: unknown[]; provenance: string; environment: string };
        authority: { view: string };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.principal.role).toBe('merchant');
    expect(body.environment.derivedBy).toBe('server');
    expect(body.result.outcome).toBe('value');
    expect(body.result.value.keys).toEqual([]);
    expect(body.result.value.provenance).toContain('In-memory developer surface');
    expect(body.result.authority.view).toContain('console.developers.api-keys');
  });

  test('after a creation, the list shows the key WITHOUT the secret', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    const created = await POST(jsonRequest({ label: 'route-key' }));
    const createdBody = (await created.json()) as {
      result: { created: { key: { id: string }; secret: string } };
    };
    const secret = createdBody.result.created.secret;
    const list = await GET();
    const listBody = (await list.json()) as { result: { value: { keys: unknown[] } } };
    expect(listBody.result.value.keys.length).toBe(1);
    expect(JSON.stringify(listBody).includes(secret)).toBe(false);
  });
});

describe('PC-005 /api/console/developers/api-keys — creation semantics', () => {
  test('JSON creation returns the plaintext exactly ONCE with the honest note', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    const response = await POST(jsonRequest({ label: 'ci' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as {
      ok: boolean;
      principal: { role: string };
      result: {
        created: { key: { id: string; label: string; environment: string; revokedWallMs: null }; secret: string };
        note: string;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.result.created.key.label).toBe('ci');
    expect(body.result.created.secret.startsWith('payswap_dev_')).toBe(true);
    expect(body.result.note).toContain('one time only');
  });

  test('a spoofed ?env=production selector is IGNORED — the key is server-environment scoped', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    const saved = process.env.PAYSWAP_ENV;
    try {
      delete process.env.PAYSWAP_ENV;
      const response = await POST(jsonRequest({ label: 'spoof-test' }, 'http://localhost/api/console/developers/api-keys?env=production'));
      expect(response.status).toBe(200);
      const body = (await response.json()) as { result: { created: { key: { environment: string } } } };
      expect(body.result.created.key.environment).toBe('sandbox');
    } finally {
      if (saved === undefined) {
        delete process.env.PAYSWAP_ENV;
      } else {
        process.env.PAYSWAP_ENV = saved;
      }
    }
  });

  test('an invalid label fails closed (422) and records nothing in the store', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    const response = await POST(jsonRequest({ label: '' }));
    expect(response.status).toBe(422);
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body.error).toBe('invalid-label');
    const list = await GET();
    const listBody = (await list.json()) as { result: { value: { keys: unknown[] } } };
    expect(listBody.result.value.keys.length).toBe(0);
  });

  test('form creation redirects 303 with a ONE-TIME receipt that hands back the secret', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    const response = await POST(formRequest({ label: 'form-key' }));
    expect(response.status).toBe(303);
    const location = response.headers.get('location') ?? '';
    expect(location.startsWith('http://localhost/console/developers/api-keys?receipt=')).toBe(true);
    const receiptId = location.split('receipt=')[1] ?? '';
    // The receipt hands the secret back EXACTLY once.
    const first = getDeveloperCreationReceiptStore().consume(receiptId);
    expect(first).not.toBeNull();
    expect(first?.secret.startsWith('payswap_dev_')).toBe(true);
    expect(getDeveloperCreationReceiptStore().consume(receiptId)).toBeNull();
  });

  test('an invalid form label redirects back with the error flag (no receipt)', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    const response = await POST(formRequest({ label: '   ' }));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/console/developers/api-keys?error=invalid-label');
    expect(getDeveloperCreationReceiptStore().size()).toBe(0);
  });
});

describe('PC-005 /api/console/developers/api-keys — explicit, audited revocation', () => {
  async function createKey(): Promise<string> {
    const created = await POST(jsonRequest({ label: 'to-revoke' }));
    const body = (await created.json()) as { result: { created: { key: { id: string } } } };
    return body.result.created.key.id;
  }

  test('DELETE revokes explicitly and the audit trail records both mutations', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    const keyId = await createKey();
    const response = await DELETE(
      new Request(`http://localhost/api/console/developers/api-keys?id=${keyId}`, { method: 'DELETE' }),
    );
    expect(response.status).toBe(200);
    const audit = getDeveloperApiKeyStore().audit();
    expect(audit.map((entry) => entry.action)).toEqual(['api-key.created', 'api-key.revoked']);
    // The revoked key is listed with its revocation timestamp.
    const list = await GET();
    const listBody = (await list.json()) as {
      result: { value: { keys: { revokedWallMs: number | null }[] } };
    };
    expect(listBody.result.value.keys[0]?.revokedWallMs).not.toBeNull();
  });

  test('double revocation fails closed (409) and unknown ids fail closed (404)', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    const keyId = await createKey();
    const first = await DELETE(
      new Request(`http://localhost/api/console/developers/api-keys?id=${keyId}`, { method: 'DELETE' }),
    );
    expect(first.status).toBe(200);
    const second = await DELETE(
      new Request(`http://localhost/api/console/developers/api-keys?id=${keyId}`, { method: 'DELETE' }),
    );
    expect(second.status).toBe(409);
    const unknown = await DELETE(
      new Request('http://localhost/api/console/developers/api-keys?id=dak_missing', { method: 'DELETE' }),
    );
    expect(unknown.status).toBe(404);
  });

  test('form-mode revocation (action=revoke) redirects back without a receipt', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    const keyId = await createKey();
    const response = await POST(formRequest({ action: 'revoke', id: keyId }));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/console/developers/api-keys');
    const audit = getDeveloperApiKeyStore().audit();
    expect(audit.map((entry) => entry.action)).toEqual(['api-key.created', 'api-key.revoked']);
  });
});

describe('PC-005 /api/console/developers/api-keys — diagnostic log ingestion (payload-free)', () => {
  test('created requests land in the ring with the outcome word only — never the label or secret', async () => {
    reset();
    mockedAudienceCookie = 'merchant';
    await POST(jsonRequest({ label: 'logged-key' }));
    const entries = getDeveloperRequestLogStore().query({ path: '/api/console/developers/api-keys' });
    expect(entries.map((entry) => entry.event)).toEqual(['console.developers.api-keys.created']);
    expect(entries[0]?.method).toBe('POST');
    expect(entries[0]?.status).toBe(200);
    expect(entries[0]?.data).toEqual({ outcome: 'created' });
    const serialized = JSON.stringify(entries);
    expect(serialized.includes('logged-key')).toBe(false);
    expect(serialized.includes('payswap_dev_')).toBe(false);
  });
});
