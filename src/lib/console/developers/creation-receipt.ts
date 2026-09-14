/**
 * PC-005 — One-time creation receipts (the secret-once display mechanism).
 *
 * The credential boundary (src/app/api/console/developers/** routes) shows
 * plaintext secret material EXACTLY ONCE (design §11). For form-driven
 * creations (the console page's plain-HTML form POST), the one-time display
 * crosses a redirect: the boundary issues an opaque random receipt id, and
 * the page consumes it ONCE after the redirect to render the secret.
 *
 * HONEST BOUNDARIES:
 *   - the receipt id is random, opaque, and carries NO derivable relation
 *     to the secret — it is a lookup key into process memory only;
 *   - consumption is DESTRUCTIVE (the mapping is deleted on first read), so
 *     the secret cannot be re-displayed — a second render of the same
 *     receipt id answers null and the page shows the honest "already shown
 *     or expired" state;
 *   - receipt ids never enter the request log (the boundary logs the
 *     pathname WITHOUT the query string — see request-log-store.ts);
 *   - IN-MEMORY (cleared on restart — the sanctioned architecture ruling).
 */

import { randomBytes } from 'node:crypto';

/** What a consumed receipt hands back: the one-time secret display. */
export interface DeveloperCreationReceipt {
  /** The plaintext secret — the ONLY time it is handed back. */
  readonly secret: string;
  /** The target record id (API-key id or webhook-endpoint id). */
  readonly targetId: string;
  /** Wall-clock ms the receipt was issued. */
  readonly issuedWallMs: number;
}

export interface DeveloperCreationReceiptStore {
  /** Issue a one-time receipt for a freshly created secret. */
  issue(secret: string, targetId: string): string;
  /** Consume one receipt (destructive: a receipt works exactly once). */
  consume(receiptId: string): DeveloperCreationReceipt | null;
  /** The number of outstanding (unconsumed) receipts. */
  size(): number;
}

export interface DeveloperCreationReceiptStoreOptions {
  /** Injectable clock (default Date.now — deterministic tests). */
  readonly now?: () => number;
  /** Injectable randomness (default node:crypto randomBytes — deterministic tests). */
  readonly randomBytes?: (count: number) => Buffer;
}

/** Build an isolated receipt store (the factory tests use). */
export function createDeveloperCreationReceiptStore(
  options: DeveloperCreationReceiptStoreOptions = {},
): DeveloperCreationReceiptStore {
  const now = options.now ?? Date.now;
  const random = options.randomBytes ?? randomBytes;
  const outstanding = new Map<string, DeveloperCreationReceipt>();

  return {
    issue(secret, targetId) {
      const receiptId = `rcpt_${random(16).toString('hex')}`;
      outstanding.set(receiptId, { secret, targetId, issuedWallMs: now() });
      return receiptId;
    },

    consume(receiptId) {
      // Destructive read: delete FIRST, then answer — a concurrent second
      // consume of the same id can never receive the secret.
      const receipt = outstanding.get(receiptId);
      outstanding.delete(receiptId);
      return receipt ?? null;
    },

    size() {
      return outstanding.size;
    },
  };
}

// ── The module-scoped default (the console credential boundary's store) ────

let defaultStore: DeveloperCreationReceiptStore | undefined;

/** The process-lifetime receipt store the console credential boundary uses. */
export function getDeveloperCreationReceiptStore(): DeveloperCreationReceiptStore {
  defaultStore ??= createDeveloperCreationReceiptStore();
  return defaultStore;
}

/** Test-only: drop the module-scoped store (a fresh one is built lazily). */
export function __resetDeveloperCreationReceiptStoreForTesting(): void {
  defaultStore = undefined;
}
