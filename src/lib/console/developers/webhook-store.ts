/**
 * PC-005 — The webhook endpoint registry (console.developers.webhooks).
 *
 * Endpoint ownership is role-authorized at the boundary (the frozen registry
 * allows merchant only for this module), and the signing secret is treated
 * EXACTLY like an API key (design §11: "signing secrets are treated as
 * credentials, never displayed in logs"):
 *
 *   - generated SERVER-SIDE (node:crypto) and shown ONCE at creation;
 *   - only a SHA-256 digest is retained — no list/audit/log/inspector read
 *     can re-display it;
 *   - revocation is explicit and audited;
 *   - IN-MEMORY (module-scoped, cleared on restart — the sanctioned
 *     architecture ruling; rendered with the honest provenance note).
 *
 * NO delivery worker exists at this baseline: this registry stores endpoint
 * registrations only. It never constructs deliveries, never enqueues
 * anything, and never implies protocol replay (see webhook-events.ts for
 * the honest delivery-state note the view renders).
 */

import { createHash, randomBytes } from 'node:crypto';
import type { EnvironmentKind } from '@/lib/environment';
import { createDeveloperAuditTrail, getDeveloperAuditTrail } from './audit-trail';
import type { DeveloperAuditTrail, DeveloperControlAuditEntry } from './audit-trail';
import type { DeveloperCredentialContext } from './api-key-store';

export type { DeveloperCredentialContext };

/** The public (secret-free) view of one webhook endpoint registration. */
export interface DeveloperWebhookEndpointView {
  readonly id: string;
  readonly url: string;
  readonly environment: EnvironmentKind;
  readonly createdWallMs: number;
  /** Wall-clock ms of the explicit revocation, or null while active. */
  readonly revokedWallMs: number | null;
}

/** The creation result: the public view PLUS the signing secret, once. */
export interface DeveloperWebhookEndpointCreation {
  readonly endpoint: DeveloperWebhookEndpointView;
  /** The signing secret — shown ONCE at creation; never stored retrievably. */
  readonly signingSecret: string;
}

export type DeveloperWebhookCreateResult =
  | { readonly ok: true; readonly created: DeveloperWebhookEndpointCreation }
  | { readonly ok: false; readonly error: 'invalid-url' };

export type DeveloperWebhookRevokeResult =
  | { readonly ok: true; readonly revoked: DeveloperWebhookEndpointView }
  | { readonly ok: false; readonly error: 'unknown-id' | 'already-revoked' };

export interface DeveloperWebhookStore {
  /** Register one endpoint (server-generated signing secret; shown ONCE). */
  create(input: { readonly url: string }, context: DeveloperCredentialContext): DeveloperWebhookCreateResult;
  /** List the endpoints of the CURRENT server-derived environment (secret-free). */
  list(context: DeveloperCredentialContext): readonly DeveloperWebhookEndpointView[];
  /** Explicitly revoke one endpoint (audited; double-revoke fails closed). */
  revoke(input: { readonly id: string }, context: DeveloperCredentialContext): DeveloperWebhookRevokeResult;
  /** The audit entries recorded by this store's trail (secret-free). */
  audit(): readonly DeveloperControlAuditEntry[];
}

export interface DeveloperWebhookStoreOptions {
  /** Shared audit trail (default: the module-scoped console trail). */
  readonly auditTrail?: DeveloperAuditTrail;
  /** Injectable clock (default Date.now — deterministic tests). */
  readonly now?: () => number;
  /** Injectable randomness (default node:crypto randomBytes — deterministic tests). */
  readonly randomBytes?: (count: number) => Buffer;
}

/** Prefix of every generated webhook signing secret (recognizable + greppable). */
export const DEVELOPER_WEBHOOK_SECRET_PREFIX = 'payswap_whsec_';

/**
 * URL validation, fail-closed: an https:// URL with a host, OR an http://
 * URL whose host is loopback (local development receivers). Everything else
 * is rejected — no defaults, no trimming-into-validity.
 */
export function isValidDeveloperWebhookUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:' && parsed.hostname.length > 0) {
    return true;
  }
  return (
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]')
  );
}

function base64Url(bytes: Buffer): string {
  return bytes
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

interface WebhookEndpointRecord {
  readonly id: string;
  readonly url: string;
  readonly environment: EnvironmentKind;
  readonly createdWallMs: number;
  revokedWallMs: number | null;
  /** SHA-256 hex digest of the signing secret (never renderable). */
  readonly secretDigest: string;
}

function toView(record: WebhookEndpointRecord): DeveloperWebhookEndpointView {
  return {
    id: record.id,
    url: record.url,
    environment: record.environment,
    createdWallMs: record.createdWallMs,
    revokedWallMs: record.revokedWallMs,
  };
}

/** Build an isolated webhook endpoint registry (the factory tests use). */
export function createDeveloperWebhookStore(options: DeveloperWebhookStoreOptions = {}): DeveloperWebhookStore {
  const auditTrail = options.auditTrail ?? createDeveloperAuditTrail();
  const now = options.now ?? Date.now;
  const random = options.randomBytes ?? randomBytes;
  const records = new Map<string, WebhookEndpointRecord>();

  return {
    create(input, context) {
      if (!isValidDeveloperWebhookUrl(input.url)) {
        return { ok: false, error: 'invalid-url' };
      }
      const id = `wh_${random(6).toString('hex')}`;
      const signingSecret = `${DEVELOPER_WEBHOOK_SECRET_PREFIX}${base64Url(random(32))}`;
      const record: WebhookEndpointRecord = {
        id,
        url: input.url,
        environment: context.environment,
        createdWallMs: now(),
        revokedWallMs: null,
        secretDigest: createHash('sha256').update(signingSecret).digest('hex'),
      };
      records.set(id, record);
      auditTrail.record({
        wallMs: record.createdWallMs,
        action: 'webhook-endpoint.created',
        targetId: id,
        actorRole: context.role,
        environment: context.environment,
        detail: `Webhook endpoint registered for ${record.url} (environment ${context.environment}); the signing secret was returned once and is not retained.`,
      });
      return { ok: true, created: { endpoint: toView(record), signingSecret } };
    },

    list(context) {
      return Object.freeze(
        [...records.values()]
          .filter((record) => record.environment === context.environment)
          .map(toView),
      );
    },

    revoke(input, context) {
      const record = records.get(input.id);
      if (record === undefined) {
        return { ok: false, error: 'unknown-id' };
      }
      if (record.revokedWallMs !== null) {
        return { ok: false, error: 'already-revoked' };
      }
      record.revokedWallMs = now();
      auditTrail.record({
        wallMs: record.revokedWallMs,
        action: 'webhook-endpoint.revoked',
        targetId: record.id,
        actorRole: context.role,
        environment: context.environment,
        detail: `Webhook endpoint ${record.url} explicitly revoked by an authorized ${context.role} actor; revocation is recorded in this in-memory audit trail.`,
      });
      return { ok: true, revoked: toView(record) };
    },

    audit() {
      return auditTrail.listFor('webhook-endpoint.');
    },
  };
}

// ── The module-scoped default (the console webhook boundary's store) ───────

let defaultStore: DeveloperWebhookStore | undefined;

/** The process-lifetime webhook registry the console webhook boundary uses. */
export function getDeveloperWebhookStore(): DeveloperWebhookStore {
  defaultStore ??= createDeveloperWebhookStore({ auditTrail: getDeveloperAuditTrail() });
  return defaultStore;
}

/** Test-only: drop the module-scoped store (a fresh one is built lazily). */
export function __resetDeveloperWebhookStoreForTesting(): void {
  defaultStore = undefined;
}
