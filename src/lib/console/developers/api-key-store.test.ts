/**
 * PC-005 — API-key credential store tests.
 *
 * Proves the design §11 credential contract at the STORE level:
 *   - the plaintext secret is generated server-side and returned ONCE
 *     (creation result only);
 *   - the list view NEVER contains the secret (or anything derived from it
 *     beyond id/label/environment/created/revoked);
 *   - keys are environment-scoped: listing shows only the current
 *     server-derived environment's keys;
 *   - revocation is explicit, idempotent-fail-closed, and audited;
 *   - invalid labels fail closed (no defaults);
 *   - the audit trail carries no secret material.
 */

import { describe, expect, test } from 'bun:test';
import { createDeveloperAuditTrail } from './audit-trail';
import type { DeveloperAuditTrail } from './audit-trail';
import { createDeveloperApiKeyStore, isValidDeveloperApiKeyLabel } from './api-key-store';
import type { DeveloperApiKeyStore } from './api-key-store';

const MERCHANT = { role: 'merchant' as const, environment: 'sandbox' as const };

function fixedStore(): { store: DeveloperApiKeyStore; audit: DeveloperAuditTrail } {
  let tick = 0;
  const audit = createDeveloperAuditTrail({ now: () => 1000 + tick++ });
  let call = 0;
  const store = createDeveloperApiKeyStore({
    auditTrail: audit,
    now: () => 2000,
    randomBytes: (count: number) => {
      call += 1;
      return Buffer.alloc(count, call % 251);
    },
  });
  return { store, audit };
}

describe('PC-005 API-key store — creation returns the plaintext exactly once', () => {
  test('creation returns the public view PLUS the server-generated secret', () => {
    const { store } = fixedStore();
    const result = store.create({ label: 'ci-key' }, MERCHANT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created.secret.startsWith('payswap_dev_')).toBe(true);
    expect(result.created.secret.length).toBeGreaterThan('payswap_dev_'.length + 20);
    expect(result.created.key.id).toMatch(/^dak_[0-9a-f]+$/);
    expect(result.created.key.label).toBe('ci-key');
    expect(result.created.key.environment).toBe('sandbox');
    expect(result.created.key.createdWallMs).toBe(2000);
    expect(result.created.key.revokedWallMs).toBeNull();
  });

  test('the label is validated fail-closed (no defaults, no trimming-into-validity beyond trim)', () => {
    const { store } = fixedStore();
    expect(isValidDeveloperApiKeyLabel('')).toBe(false);
    expect(isValidDeveloperApiKeyLabel('   ')).toBe(false);
    expect(isValidDeveloperApiKeyLabel('x'.repeat(65))).toBe(false);
    expect(store.create({ label: '' }, MERCHANT)).toEqual({ ok: false, error: 'invalid-label' });
    expect(store.create({ label: '   ' }, MERCHANT)).toEqual({ ok: false, error: 'invalid-label' });
    expect(store.create({ label: 'x'.repeat(65) }, MERCHANT)).toEqual({ ok: false, error: 'invalid-label' });
    expect(store.list(MERCHANT).length).toBe(0);
    // A 64-char label is the boundary case: valid.
    expect(store.create({ label: 'x'.repeat(64) }, MERCHANT).ok).toBe(true);
  });

  test('every creation generates a FRESH secret (no reuse)', () => {
    let counter = 0;
    const store = createDeveloperApiKeyStore({
      randomBytes: (count: number) => {
        counter += 1;
        return Buffer.alloc(count, counter);
      },
    });
    const first = store.create({ label: 'a' }, MERCHANT);
    const second = store.create({ label: 'b' }, MERCHANT);
    if (!first.ok || !second.ok) throw new Error('expected both creations to succeed');
    expect(first.created.secret).not.toBe(second.created.secret);
    expect(first.created.key.id).not.toBe(second.created.key.id);
  });
});

describe('PC-005 API-key store — the list NEVER shows the secret', () => {
  test('list entries carry exactly id/label/environment/created/revoked and no secret material', () => {
    const { store } = fixedStore();
    const created = store.create({ label: 'ci-key' }, MERCHANT);
    if (!created.ok) throw new Error('expected creation to succeed');
    const secret = created.created.secret;
    const list = store.list(MERCHANT);
    expect(list.length).toBe(1);
    const entry = list[0] as unknown as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toEqual(
      ['createdWallMs', 'environment', 'id', 'label', 'revokedWallMs'].sort(),
    );
    // The plaintext (and any fragment of it) never appears in any list form.
    const serialized = JSON.stringify(list);
    expect(serialized.includes(secret)).toBe(false);
    expect(serialized.includes(secret.slice('payswap_dev_'.length))).toBe(false);
  });

  test('JSON round-trip of the list view is secret-free', () => {
    const { store } = fixedStore();
    const created = store.create({ label: 'payments-key' }, MERCHANT);
    if (!created.ok) throw new Error('expected creation to succeed');
    expect(JSON.stringify(store.list(MERCHANT)).includes(created.created.secret)).toBe(false);
  });
});

describe('PC-005 API-key store — environment scoping', () => {
  test('listing shows ONLY the current environment keys (a sandbox list hides production keys)', () => {
    const { store } = fixedStore();
    store.create({ label: 'sandbox-key' }, { role: 'merchant', environment: 'sandbox' });
    store.create({ label: 'production-key' }, { role: 'merchant', environment: 'production' });
    const sandboxView = store.list({ role: 'merchant', environment: 'sandbox' });
    const productionView = store.list({ role: 'merchant', environment: 'production' });
    expect(sandboxView.map((key) => key.label)).toEqual(['sandbox-key']);
    expect(productionView.map((key) => key.label)).toEqual(['production-key']);
  });

  test('the environment comes only from the calling context — the store takes no client env input', () => {
    // The store API has no environment field on the CREATE input at all:
    // the type is { label } only. This is a compile-time guarantee; here we
    // assert the runtime shape also ignores stray fields a caller might try
    // to smuggle through structural excess.
    const { store } = fixedStore();
    const smuggled = { label: 'spoofed', environment: 'production' } as { label: string };
    const result = store.create(smuggled, MERCHANT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The context (server-derived) stamps the environment — not the input.
    expect(result.created.key.environment).toBe('sandbox');
  });
});

describe('PC-005 API-key store — explicit, audited revocation', () => {
  test('revocation is explicit, flips the view, and is audited', () => {
    const { store, audit } = fixedStore();
    const created = store.create({ label: 'ci-key' }, MERCHANT);
    if (!created.ok) throw new Error('expected creation to succeed');
    const revoked = store.revoke({ id: created.created.key.id }, MERCHANT);
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.revoked.revokedWallMs).toBe(2000);
    expect(store.list(MERCHANT)[0]?.revokedWallMs).toBe(2000);

    const trail = audit.list();
    expect(trail.map((entry) => entry.action)).toEqual(['api-key.created', 'api-key.revoked']);
    expect(trail[1]?.targetId).toBe(created.created.key.id);
    expect(trail[1]?.actorRole).toBe('merchant');
    expect(trail[1]?.environment).toBe('sandbox');
    // The audit detail never contains the secret.
    expect(trail.some((entry) => entry.detail.includes(created.created.secret))).toBe(false);
  });

  test('double revocation and unknown ids fail closed', () => {
    const { store } = fixedStore();
    const created = store.create({ label: 'once' }, MERCHANT);
    if (!created.ok) throw new Error('expected creation to succeed');
    expect(store.revoke({ id: created.created.key.id }, MERCHANT).ok).toBe(true);
    expect(store.revoke({ id: created.created.key.id }, MERCHANT)).toEqual({
      ok: false,
      error: 'already-revoked',
    });
    expect(store.revoke({ id: 'dak_does_not_exist' }, MERCHANT)).toEqual({
      ok: false,
      error: 'unknown-id',
    });
    // Failed revocations record NOTHING new in the audit trail.
    expect(store.audit().length).toBe(2);
  });

  test('store.audit() lists only the api-key slice of the shared trail', () => {
    const audit = createDeveloperAuditTrail();
    const store = createDeveloperApiKeyStore({ auditTrail: audit });
    store.create({ label: 'k' }, MERCHANT);
    audit.record({
      wallMs: 1,
      action: 'webhook-endpoint.created',
      targetId: 'wh_other',
      actorRole: 'merchant',
      environment: 'sandbox',
      detail: 'unrelated entry',
    });
    expect(store.audit().map((entry) => entry.action)).toEqual(['api-key.created']);
  });
});
