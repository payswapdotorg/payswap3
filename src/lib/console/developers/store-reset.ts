/**
 * PC-005 — Test-only reset for the module-scoped developer-control stores.
 *
 * The stores are process-lifetime singletons by design (the in-memory
 * architecture ruling). bun test runs every test file in ONE process with
 * a shared module registry, so test files that exercise the singletons
 * through the real boundaries (routes, pages, read models) reset them in
 * beforeEach to stay order-independent and pollution-free — the same
 * discipline PC-004 recorded for the port backings.
 *
 * NOT part of any production surface: importing this module from
 * non-test code would be a wiring bug.
 */

import { __resetDeveloperAuditTrailForTesting } from './audit-trail';
import { __resetDeveloperApiKeyStoreForTesting } from './api-key-store';
import { __resetDeveloperWebhookStoreForTesting } from './webhook-store';
import { __resetDeveloperRequestLogStoreForTesting } from './request-log-store';
import { __resetDeveloperCreationReceiptStoreForTesting } from './creation-receipt';

/** Drop every module-scoped PC-005 store (fresh lazily-built ones follow). */
export function resetDeveloperControlStoresForTesting(): void {
  __resetDeveloperApiKeyStoreForTesting();
  __resetDeveloperWebhookStoreForTesting();
  __resetDeveloperRequestLogStoreForTesting();
  __resetDeveloperCreationReceiptStoreForTesting();
  __resetDeveloperAuditTrailForTesting();
}
