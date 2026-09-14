/**
 * PC-005 — Webhook endpoint registry tests.
 *
 * Proves the design §11 webhook contract at the STORE level:
 *   - the signing secret is generated server-side and returned ONCE, and is
 *     treated exactly like an API key (never in list/audit output);
 *   - endpoint ownership is role-authorized at the BOUNDARY (registry
 *     allowedRoles) — the store records the acting role in the audit trail;
 *   - URL validation fails closed (https, or loopback http for local
 *     development receivers);
 *   - revocation is explicit and audited; double-revoke fails closed;
 *   - endpoints are environment-scoped.
 */

import { describe, expect, test } from 'bun:test';
import { createDeveloperAuditTrail } from './audit-trail';
import { createDeveloperWebhookStore, isValidDeveloperWebhookUrl } from './webhook-store';
import type { DeveloperWebhookStore } from './webhook-store';

const MERCHANT = { role: 'merchant' as const, environment: 'sandbox' as const };

function fixedStore(): { store: DeveloperWebhookStore } {
  let call = 0;
  const store = createDeveloperWebhookStore({
    auditTrail: createDeveloperAuditTrail({ now: () => 1000 }),
    now: () => 2000,
    randomBytes: (count: number) => {
      call += 1;
      return Buffer.alloc(count, call % 251);
    },
  });
  return { store };
}

describe('PC-005 webhook store — URL validation fails closed', () => {
  test('https URLs with a host are accepted; everything else is rejected', () => {
    expect(isValidDeveloperWebhookUrl('https://example.com/hooks')).toBe(true);
    expect(isValidDeveloperWebhookUrl('https://payments.example.com/hook?x=1')).toBe(true);
    // Loopback http is the local-development exception.
    expect(isValidDeveloperWebhookUrl('http://localhost:9173/hook')).toBe(true);
    expect(isValidDeveloperWebhookUrl('http://127.0.0.1/hook')).toBe(true);
    // Rejections: plain http to a public host, garbage, empty, oversized.
    expect(isValidDeveloperWebhookUrl('http://example.com/hook')).toBe(false);
    expect(isValidDeveloperWebhookUrl('ftp://example.com/hook')).toBe(false);
    expect(isValidDeveloperWebhookUrl('not a url')).toBe(false);
    expect(isValidDeveloperWebhookUrl('')).toBe(false);
    expect(isValidDeveloperWebhookUrl(`https://example.com/${'a'.repeat(2100)}`)).toBe(false);
  });

  test('create rejects invalid URLs and records nothing', () => {
    const { store } = fixedStore();
    expect(store.create({ url: 'http://example.com/hook' }, MERCHANT)).toEqual({
      ok: false,
      error: 'invalid-url',
    });
    expect(store.list(MERCHANT).length).toBe(0);
    expect(store.audit().length).toBe(0);
  });
});

describe('PC-005 webhook store — the signing secret is a credential (shown once, never listed)', () => {
  test('creation returns the endpoint view PLUS the signing secret exactly once', () => {
    const { store } = fixedStore();
    const result = store.create({ url: 'https://example.com/hooks' }, MERCHANT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created.signingSecret.startsWith('payswap_whsec_')).toBe(true);
    expect(result.created.signingSecret.length).toBeGreaterThan('payswap_whsec_'.length + 20);
    expect(result.created.endpoint.id).toMatch(/^wh_[0-9a-f]+$/);
    expect(result.created.endpoint.url).toBe('https://example.com/hooks');
    expect(result.created.endpoint.environment).toBe('sandbox');
    expect(result.created.endpoint.createdWallMs).toBe(2000);
    expect(result.created.endpoint.revokedWallMs).toBeNull();
  });

  test('the list NEVER contains the signing secret (or any fragment of it)', () => {
    const { store } = fixedStore();
    const created = store.create({ url: 'https://example.com/hooks' }, MERCHANT);
    if (!created.ok) throw new Error('expected creation to succeed');
    const list = store.list(MERCHANT);
    expect(list.length).toBe(1);
    const entry = list[0] as unknown as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toEqual(
      ['createdWallMs', 'environment', 'id', 'revokedWallMs', 'url'].sort(),
    );
    const serialized = JSON.stringify(list);
    expect(serialized.includes(created.created.signingSecret)).toBe(false);
    expect(
      serialized.includes(created.created.signingSecret.slice('payswap_whsec_'.length)),
    ).toBe(false);
    // The audit trail is secret-free too.
    expect(
      store.audit().some((entry) => JSON.stringify(entry).includes(created.created.signingSecret)),
    ).toBe(false);
  });
});

describe('PC-005 webhook store — environment scoping and audited revocation', () => {
  test('endpoints are environment-scoped in the listing', () => {
    const { store } = fixedStore();
    store.create({ url: 'https://sandbox.example.com/h' }, { role: 'merchant', environment: 'sandbox' });
    store.create({ url: 'https://production.example.com/h' }, { role: 'merchant', environment: 'production' });
    expect(store.list({ role: 'merchant', environment: 'sandbox' }).map((e) => e.url)).toEqual([
      'https://sandbox.example.com/h',
    ]);
    expect(store.list({ role: 'merchant', environment: 'production' }).map((e) => e.url)).toEqual([
      'https://production.example.com/h',
    ]);
  });

  test('revocation is explicit, audited with the acting role, and fail-closed on repeats', () => {
    const { store } = fixedStore();
    const created = store.create({ url: 'https://example.com/hooks' }, MERCHANT);
    if (!created.ok) throw new Error('expected creation to succeed');
    const revoked = store.revoke({ id: created.created.endpoint.id }, MERCHANT);
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.revoked.revokedWallMs).toBe(2000);
    expect(store.list(MERCHANT)[0]?.revokedWallMs).toBe(2000);

    const trail = store.audit();
    expect(trail.map((entry) => entry.action)).toEqual([
      'webhook-endpoint.created',
      'webhook-endpoint.revoked',
    ]);
    expect(trail[1]?.actorRole).toBe('merchant');
    expect(trail[1]?.targetId).toBe(created.created.endpoint.id);

    expect(store.revoke({ id: created.created.endpoint.id }, MERCHANT)).toEqual({
      ok: false,
      error: 'already-revoked',
    });
    expect(store.revoke({ id: 'wh_missing' }, MERCHANT)).toEqual({ ok: false, error: 'unknown-id' });
    expect(store.audit().length).toBe(2);
  });
});
