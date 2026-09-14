/**
 * PC-005 — The developer request-log store (console.developers.logs /
 * console.developers.request-inspector): a bounded, in-memory diagnostic
 * ring buffer with REDACTION BEFORE STORAGE.
 *
 * THE REDACTION CHAIN (design §11: "Request inspector/logs MUST redact
 * credentials, authorization headers, sensitive payload fields, and
 * secret-bearing configuration"):
 *
 *   ingestion ──► scrubCredentialReferences (the EXISTING fail-closed
 *   (src/lib/observability/logging.ts primitive, the same one every
 *    structured log emit passes through) applied to the payload AND
 *    to the path/method strings ──► ONLY THEN is the entry stored.
 *
 * The stored entry is therefore already redacted: every later read (list,
 * inspector detail, filter) serves the scrubbed form — there is no code
 * path that can render the unredacted payload, because it was never
 * stored. Tests assert ON THE STORED ENTRIES (not the rendered output).
 *
 * Ingestion happens at the console API boundary paths PC-005 owns
 * (src/app/api/console/developers/** handlers call
 * ingestDeveloperRequestLog with their own method/path/status). PC-003's
 * routes are owned by that phase and are not modified — recorded in the
 * PC-005 report as a composition note.
 *
 * The buffer is IN-MEMORY and bounded (oldest entries are dropped at
 * capacity) — diagnostic data, never evidence (see
 * developer-provenance.ts). The PC-003 exported seam
 * normalizeDeveloperRequestRecord (read-models/developer-requests.ts) is
 * the presentation normalizer the read model composes around.
 */

import { scrubCredentialReferences } from '@/lib/observability/logging';
import type { LogLevel } from '@/lib/observability/logging';

/** The default ring capacity (bounded — the whole point of a ring buffer). */
export const DEFAULT_DEVELOPER_REQUEST_LOG_CAPACITY = 200;

/** One stored request-log entry: ALREADY redacted at ingestion. */
export interface DeveloperRequestLogEntry {
  /** Monotonic sequence id (stable within the process lifetime). */
  readonly id: number;
  readonly wallMs: number;
  readonly level: LogLevel;
  readonly event: string;
  /** HTTP method of the boundary request (constant at the boundary). */
  readonly method: string;
  /** Pathname only — query strings never enter the log (receipt ids etc.). */
  readonly path: string;
  /** HTTP status the boundary responded with. */
  readonly status: number;
  /** The payload AFTER scrubCredentialReferences (redacted before storage). */
  readonly data: unknown;
  readonly traceId?: string;
}

/** The ingestion input (the boundary hands this in; it gets scrubbed). */
export interface DeveloperRequestLogInput {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly event: string;
  /** Payload as observed at the boundary — scrubbed BEFORE storage. */
  readonly data?: unknown;
  readonly traceId?: string;
  /** Level override; derived from the status when omitted. */
  readonly level?: LogLevel;
}

/** The inspector/log query filters (AND-combined; all optional). */
export interface DeveloperRequestLogQuery {
  /** Exact pathname filter (e.g. '/api/console/developers/api-keys'). */
  readonly path?: string;
  /** Exact status filter (e.g. 404). */
  readonly status?: number;
  /** Max entries returned (newest first). Default 100. */
  readonly limit?: number;
}

function deriveLevel(status: number): LogLevel {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

export interface DeveloperRequestLogStore {
  /** Ingest one boundary request (redaction happens HERE, before storage). */
  ingest(input: DeveloperRequestLogInput): DeveloperRequestLogEntry;
  /** Query the ring (newest first, AND-combined filters). */
  query(filter?: DeveloperRequestLogQuery): readonly DeveloperRequestLogEntry[];
  /** The number of entries currently buffered. */
  size(): number;
  /** The ring capacity (rendered as an honest bound in the UI). */
  capacity(): number;
}

export interface DeveloperRequestLogStoreOptions {
  /** Ring capacity (default 200; must be >= 1). */
  readonly capacity?: number;
  /** Injectable clock (default Date.now — deterministic tests). */
  readonly now?: () => number;
}

/** Build an isolated request-log ring buffer (the factory tests use). */
export function createDeveloperRequestLogStore(
  options: DeveloperRequestLogStoreOptions = {},
): DeveloperRequestLogStore {
  const capacity =
    typeof options.capacity === 'number' && Number.isInteger(options.capacity) && options.capacity >= 1
      ? options.capacity
      : DEFAULT_DEVELOPER_REQUEST_LOG_CAPACITY;
  const now = options.now ?? Date.now;
  const ring: DeveloperRequestLogEntry[] = [];
  let sequence = 0;

  return {
    ingest(input) {
      sequence += 1;
      // REDACTION BEFORE STORAGE — the one and only place an entry is built:
      // payload, path, and method all pass through the fail-closed scrub,
      // so what lands in the ring is already the redacted form.
      const entry: DeveloperRequestLogEntry = {
        id: sequence,
        wallMs: now(),
        level: input.level ?? deriveLevel(input.status),
        event: input.event,
        method: typeof input.method === 'string' ? String(scrubCredentialReferences(input.method)) : 'UNKNOWN',
        path: typeof input.path === 'string' ? String(scrubCredentialReferences(input.path)) : 'UNKNOWN',
        status: typeof input.status === 'number' ? input.status : 0,
        data: scrubCredentialReferences(input.data === undefined ? null : input.data),
        ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
      };
      ring.push(entry);
      if (ring.length > capacity) {
        ring.splice(0, ring.length - capacity);
      }
      return entry;
    },

    query(filter = {}) {
      const limit =
        typeof filter.limit === 'number' && Number.isInteger(filter.limit) && filter.limit >= 1
          ? filter.limit
          : 100;
      const matching = ring.filter(
        (entry) =>
          (filter.path === undefined || entry.path === filter.path) &&
          (filter.status === undefined || entry.status === filter.status),
      );
      // Newest first: the diagnostic surfaces care about the latest traffic.
      return Object.freeze(matching.slice(-limit).reverse());
    },

    size() {
      return ring.length;
    },

    capacity() {
      return capacity;
    },
  };
}

// ── The module-scoped default (the console boundary's ring buffer) ─────────

let defaultStore: DeveloperRequestLogStore | undefined;

/** The process-lifetime request-log ring the console boundary ingests into. */
export function getDeveloperRequestLogStore(): DeveloperRequestLogStore {
  defaultStore ??= createDeveloperRequestLogStore();
  return defaultStore;
}

/**
 * Ingest one boundary request into the module-scoped ring (the ONE call the
 * PC-005 boundary routes make; redaction-before-storage applies inside).
 */
export function ingestDeveloperRequestLog(input: DeveloperRequestLogInput): DeveloperRequestLogEntry {
  return getDeveloperRequestLogStore().ingest(input);
}

/** Query the module-scoped ring (the logs/inspector reads' backing). */
export function queryDeveloperRequestLogs(filter?: DeveloperRequestLogQuery): readonly DeveloperRequestLogEntry[] {
  return getDeveloperRequestLogStore().query(filter);
}

/** Test-only: drop the module-scoped ring (a fresh one is built lazily). */
export function __resetDeveloperRequestLogStoreForTesting(): void {
  defaultStore = undefined;
}
