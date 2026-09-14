/**
 * PC-005 — The API-key credential store (console.developers.api-keys).
 *
 * THE CREDENTIAL BOUNDARY (design §11): secrets are generated, stored, and
 * returned through this dedicated server-side boundary, and:
 *
 *   - the plaintext token is generated SERVER-SIDE (node:crypto random
 *     bytes — never client-supplied; a client cannot ask this store to
 *     persist a chosen secret);
 *   - plaintext is shown ONCE, in the creation result only; the store keeps
 *     a SHA-256 digest, so NO later read (list, audit, log, inspector) can
 *     ever re-display or leak the secret — the plaintext is not retained;
 *   - keys are ENVIRONMENT-SCOPED: the environment is the PC-001
 *     server-derived context handed in by the calling boundary
 *     (getConsoleEnvironmentContext() — no request input participates);
 *     listing shows only the current server-derived environment's keys;
 *   - revocation is EXPLICIT and audited (one entry per mutation in the
 *     shared in-memory audit trail; revoking twice fails closed);
 *   - the store is IN-MEMORY (module-scoped, cleared on restart) — the
 *     sanctioned architecture ruling for developer surfaces; every surface
 *     that renders its data carries the honest provenance note
 *     (developer-provenance.ts).
 *
 * This store holds NO financial authority: an API key is developer tooling
 * (design §11 separates developer controls from protocol financial truth).
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Role } from '@/lib/navigation';
import type { EnvironmentKind } from '@/lib/environment';
import { createDeveloperAuditTrail, getDeveloperAuditTrail } from './audit-trail';
import type { DeveloperAuditTrail, DeveloperControlAuditEntry } from './audit-trail';

/** The public (secret-free) view of one API-key record. */
export interface DeveloperApiKeyView {
  readonly id: string;
  readonly label: string;
  readonly environment: EnvironmentKind;
  readonly createdWallMs: number;
  /** Wall-clock ms of the explicit revocation, or null while active. */
  readonly revokedWallMs: number | null;
}

/** The creation result: the public view PLUS the plaintext, exactly once. */
export interface DeveloperApiKeyCreation {
  readonly key: DeveloperApiKeyView;
  /** The plaintext token — shown ONCE at creation; never stored retrievably. */
  readonly secret: string;
}

/** The server-side context every operation requires (no request input). */
export interface DeveloperCredentialContext {
  readonly role: Role;
  readonly environment: EnvironmentKind;
}

export type DeveloperApiKeyCreateResult =
  | { readonly ok: true; readonly created: DeveloperApiKeyCreation }
  | { readonly ok: false; readonly error: 'invalid-label' };

export type DeveloperApiKeyRevokeResult =
  | { readonly ok: true; readonly revoked: DeveloperApiKeyView }
  | { readonly ok: false; readonly error: 'unknown-id' | 'already-revoked' };

export interface DeveloperApiKeyStore {
  /** Create one key (server-generated secret; plaintext returned ONCE). */
  create(input: { readonly label: string }, context: DeveloperCredentialContext): DeveloperApiKeyCreateResult;
  /** List the keys of the CURRENT server-derived environment (secret-free). */
  list(context: DeveloperCredentialContext): readonly DeveloperApiKeyView[];
  /** Explicitly revoke one key (audited; double-revoke fails closed). */
  revoke(input: { readonly id: string }, context: DeveloperCredentialContext): DeveloperApiKeyRevokeResult;
  /** The audit entries recorded by this store's trail (secret-free). */
  audit(): readonly DeveloperControlAuditEntry[];
}

export interface DeveloperApiKeyStoreOptions {
  /** Shared audit trail (default: the module-scoped console trail). */
  readonly auditTrail?: DeveloperAuditTrail;
  /** Injectable clock (default Date.now — deterministic tests). */
  readonly now?: () => number;
  /** Injectable randomness (default node:crypto randomBytes — deterministic tests). */
  readonly randomBytes?: (count: number) => Buffer;
}

/** Prefix of every generated API-key token (recognizable + greppable). */
export const DEVELOPER_API_KEY_SECRET_PREFIX = 'payswap_dev_';

/** Label validation: 1..64 chars after trimming (fail-closed, no defaults). */
export function isValidDeveloperApiKeyLabel(label: string): boolean {
  return typeof label === 'string' && label.trim().length >= 1 && label.trim().length <= 64;
}

function base64Url(bytes: Buffer): string {
  return bytes
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/** The internal record: digest only — the plaintext is never retained. */
interface ApiKeyRecord {
  readonly id: string;
  readonly label: string;
  readonly environment: EnvironmentKind;
  readonly createdWallMs: number;
  revokedWallMs: number | null;
  /** SHA-256 hex digest of the plaintext token (never renderable). */
  readonly secretDigest: string;
}

function toView(record: ApiKeyRecord): DeveloperApiKeyView {
  // Secret-free by construction: the digest is deliberately dropped here.
  return {
    id: record.id,
    label: record.label,
    environment: record.environment,
    createdWallMs: record.createdWallMs,
    revokedWallMs: record.revokedWallMs,
  };
}

/** Build an isolated API-key store (the factory tests and composition use). */
export function createDeveloperApiKeyStore(options: DeveloperApiKeyStoreOptions = {}): DeveloperApiKeyStore {
  const auditTrail = options.auditTrail ?? createDeveloperAuditTrail();
  const now = options.now ?? Date.now;
  const random = options.randomBytes ?? randomBytes;
  const records = new Map<string, ApiKeyRecord>();

  return {
    create(input, context) {
      if (!isValidDeveloperApiKeyLabel(input.label)) {
        return { ok: false, error: 'invalid-label' };
      }
      const id = `dak_${random(6).toString('hex')}`;
      const secret = `${DEVELOPER_API_KEY_SECRET_PREFIX}${base64Url(random(32))}`;
      const record: ApiKeyRecord = {
        id,
        label: input.label.trim(),
        environment: context.environment,
        createdWallMs: now(),
        revokedWallMs: null,
        secretDigest: createHash('sha256').update(secret).digest('hex'),
      };
      records.set(id, record);
      auditTrail.record({
        wallMs: record.createdWallMs,
        action: 'api-key.created',
        targetId: id,
        actorRole: context.role,
        environment: context.environment,
        detail: `API key created with label "${record.label}" (environment ${context.environment}); the plaintext token was returned once and is not retained.`,
      });
      return { ok: true, created: { key: toView(record), secret } };
    },

    list(context) {
      // Environment-scoped: only the CURRENT server-derived environment's
      // keys are listed (a key created under another environment is not
      // visible from this one).
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
        action: 'api-key.revoked',
        targetId: record.id,
        actorRole: context.role,
        environment: context.environment,
        detail: `API key "${record.label}" explicitly revoked by an authorized ${context.role} actor; revocation is recorded in this in-memory audit trail.`,
      });
      return { ok: true, revoked: toView(record) };
    },

    audit() {
      return auditTrail.listFor('api-key.');
    },
  };
}

// ── The module-scoped default (the console credential boundary's store) ────

let defaultStore: DeveloperApiKeyStore | undefined;

/** The process-lifetime API-key store the console credential boundary uses. */
export function getDeveloperApiKeyStore(): DeveloperApiKeyStore {
  defaultStore ??= createDeveloperApiKeyStore({ auditTrail: getDeveloperAuditTrail() });
  return defaultStore;
}

/** Test-only: drop the module-scoped store (a fresh one is built lazily). */
export function __resetDeveloperApiKeyStoreForTesting(): void {
  defaultStore = undefined;
}
