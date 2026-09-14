/**
 * PC-005 — The developer-controls audit trail (in-memory, design §11).
 *
 * Credential operations MUST be auditable (design §11: "revocation is
 * explicit and auditable"), so every API-key and webhook-endpoint mutation
 * (create / revoke) appends ONE entry to this trail. The trail is:
 *
 *   - IN-MEMORY (module-scoped, cleared on restart — the recorded
 *     architecture ruling for developer surfaces; rendered with the honest
 *     provenance note in the UI);
 *   - SECRET-FREE by construction: entries carry the target id, actor role,
 *     environment, and a plain-language detail — never secret material,
 *     never digests, never URLs' query strings;
 *   - APPEND-ONLY through the public surface (no mutation or deletion of
 *     recorded entries exists except the test reset).
 */

import type { Role } from '@/lib/navigation';
import type { EnvironmentKind } from '@/lib/environment';

/** The audited developer-control actions (closed vocabulary). */
export const DEVELOPER_CONTROL_ACTIONS = [
  'api-key.created',
  'api-key.revoked',
  'webhook-endpoint.created',
  'webhook-endpoint.revoked',
] as const;
export type DeveloperControlAction = (typeof DEVELOPER_CONTROL_ACTIONS)[number];

/** One audit entry: who did what to which developer-control record, when. */
export interface DeveloperControlAuditEntry {
  /** Wall-clock ms of the audited action. */
  readonly wallMs: number;
  /** The action (closed vocabulary above). */
  readonly action: DeveloperControlAction;
  /** The target record id (API-key id or webhook-endpoint id). */
  readonly targetId: string;
  /** The actor role (server-resolved; never client-supplied). */
  readonly actorRole: Role;
  /** The server-derived environment the action applied in. */
  readonly environment: EnvironmentKind;
  /** Plain-language detail (secret-free by construction). */
  readonly detail: string;
}

export interface DeveloperAuditTrail {
  /** Append one entry (stores call this on every mutation). */
  record(entry: DeveloperControlAuditEntry): void;
  /** All entries, oldest first. */
  list(): readonly DeveloperControlAuditEntry[];
  /** Entries whose action starts with the prefix (e.g. 'api-key.'), oldest first. */
  listFor(prefix: string): readonly DeveloperControlAuditEntry[];
}

export interface DeveloperAuditTrailOptions {
  /** Injectable clock (default Date.now — deterministic tests). */
  readonly now?: () => number;
}

/** Build an isolated audit trail (the factory tests and composition use). */
export function createDeveloperAuditTrail(options: DeveloperAuditTrailOptions = {}): DeveloperAuditTrail {
  const entries: DeveloperControlAuditEntry[] = [];
  const now = options.now ?? Date.now;
  return {
    record(entry) {
      entries.push({ ...entry, wallMs: now() });
    },
    list() {
      return Object.freeze([...entries]);
    },
    listFor(prefix) {
      return Object.freeze(entries.filter((entry) => entry.action.startsWith(prefix)));
    },
  };
}

// ── The module-scoped default (the console surfaces' shared trail) ─────────

let defaultTrail: DeveloperAuditTrail | undefined;

/** The process-lifetime audit trail the console developer surfaces share. */
export function getDeveloperAuditTrail(): DeveloperAuditTrail {
  defaultTrail ??= createDeveloperAuditTrail();
  return defaultTrail;
}

/** Test-only: drop the module-scoped trail (a fresh one is built lazily). */
export function __resetDeveloperAuditTrailForTesting(): void {
  defaultTrail = undefined;
}
