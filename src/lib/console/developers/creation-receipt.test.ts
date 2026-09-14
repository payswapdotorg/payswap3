/**
 * PC-005 — One-time creation receipt tests: the secret-once mechanism.
 *
 * Proves the redirect-safe one-time display contract:
 *   - a receipt works EXACTLY ONCE (destructive consume);
 *   - the receipt id is opaque and unrelated to the secret;
 *   - unknown/expired/consumed ids answer null (the page then renders the
 *     honest "already shown or expired" state — never the secret).
 */

import { describe, expect, test } from 'bun:test';
import { createDeveloperCreationReceiptStore } from './creation-receipt';

function fixedStore() {
  let call = 0;
  return createDeveloperCreationReceiptStore({
    now: () => 4000,
    randomBytes: (count: number) => {
      call += 1;
      return Buffer.alloc(count, call % 251);
    },
  });
}

describe('PC-005 creation receipts — one-time secret display', () => {
  test('a receipt hands back the secret exactly once, then never again', () => {
    const store = fixedStore();
    const receiptId = store.issue('payswap_dev_secretvalue', 'dak_123');
    const first = store.consume(receiptId);
    expect(first).not.toBeNull();
    expect(first?.secret).toBe('payswap_dev_secretvalue');
    expect(first?.targetId).toBe('dak_123');
    expect(first?.issuedWallMs).toBe(4000);
    // The second consume of the SAME id answers null — the secret is gone.
    expect(store.consume(receiptId)).toBeNull();
    expect(store.size()).toBe(0);
  });

  test('receipt ids are opaque — no derivable relation to the secret', () => {
    const store = fixedStore();
    const secret = 'payswap_dev_abcdefghijklmnopqrst';
    const receiptId = store.issue(secret, 'dak_1');
    expect(receiptId.startsWith('rcpt_')).toBe(true);
    expect(receiptId.includes(secret)).toBe(false);
    expect(receiptId.includes(secret.slice('payswap_dev_'.length))).toBe(false);
  });

  test('unknown ids answer null (fail closed)', () => {
    const store = fixedStore();
    expect(store.consume('rcpt_00000000000000000000000000000000')).toBeNull();
    expect(store.consume('')).toBeNull();
    expect(store.consume('not-a-receipt')).toBeNull();
  });

  test('each issue produces a distinct receipt id', () => {
    const store = fixedStore();
    const a = store.issue('s1', 'dak_1');
    const b = store.issue('s2', 'dak_2');
    expect(a).not.toBe(b);
    expect(store.size()).toBe(2);
  });
});
