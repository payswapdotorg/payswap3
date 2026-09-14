/**
 * PC-005 — The developer-controls read models (the composition layer the
 * developer pages and the /api/console/developers/** boundary consume).
 *
 * Each read composes the PC-005 in-memory stores (or the PC-001
 * server-derived environment context) into the frozen PC-001 envelope
 * (`ConsoleReadResult`). Every DTO carries:
 *
 *   - its own `ConsoleAuthorityMetadata` — written HERE for the PC-005
 *     surfaces (owning authority: the in-memory developer-control boundary,
 *     named honestly as NON-DURABLE; this module never touches the PC-003
 *     source registry, which stays owned by that phase);
 *   - the honest data-provenance note (developer-provenance.ts) so no view
 *     can render this data as durable protocol state;
 *   - the value branch (the in-memory store always answers synchronously —
 *     an EMPTY list is the honest VALUE "no entries recorded yet", never
 *     an unavailable read; the recorded PC-003 gap is thereby closed with
 *     an honest empty value instead of a fabricated one).
 *
 * The request-log read composes AROUND the PC-003 exported seam
 * `normalizeDeveloperRequestRecord` (read-models/developer-requests.ts):
 * every entry is normalized through that PURE redaction-applying
 * normalizer — the PC-003 DTO contract and redaction path stay the single
 * presentation path — and is then widened with the inspector's own
 * method/path/status fields. The PC-003 scaffold itself (its
 * unavailable-branch read + gap note) is NOT modified: it is owned by
 * PC-003, and its recorded gap statement is superseded HERE by wiring the
 * real (in-memory) source the scaffold was waiting for.
 */

import { consoleValue } from '../dto';
import { getConsoleEnvironmentContext } from '../environment-context';
import type {
  ConsoleAuthorityMetadata,
  ConsoleEnvironmentContext,
  ConsoleReadResult,
} from '../types';
import { normalizeDeveloperRequestRecord } from '../read-models/developer-requests';
import type { ConsoleDeveloperRequestRecordDto } from '../read-models/developer-requests';
import type { Role } from '@/lib/navigation';
import { getDeveloperApiKeyStore } from './api-key-store';
import type { DeveloperApiKeyView, DeveloperCredentialContext } from './api-key-store';
import { getDeveloperWebhookStore } from './webhook-store';
import type { DeveloperWebhookEndpointView } from './webhook-store';
import { CONSOLE_WEBHOOK_EVENT_CATALOG, WEBHOOK_DELIVERY_STATE_NOTE } from './webhook-events';
import type { WebhookEventCatalogEntry } from './webhook-events';
import { getDeveloperRequestLogStore } from './request-log-store';
import type { DeveloperRequestLogEntry, DeveloperRequestLogQuery } from './request-log-store';
import type { DeveloperControlAuditEntry } from './audit-trail';
import {
  DEVELOPER_DIAGNOSTIC_NOT_EVIDENCE_NOTE,
  IN_MEMORY_DEVELOPER_SURFACE_NOTE,
} from './developer-provenance';

/** The server-derived context every developer credential read composes from. */
function credentialContext(role: Role): DeveloperCredentialContext {
  // The environment is derived PER READ from the PC-001 no-input authority —
  // no request value participates, and the context cannot go stale.
  return { role, environment: getConsoleEnvironmentContext().kind };
}

// ── Authority metadata (the PC-005 surfaces' own, honestly non-durable) ─────

const API_KEYS_METADATA: ConsoleAuthorityMetadata = {
  view: 'console.developers.api-keys — environment-scoped API-key controls',
  protocolObject:
    'developer credential records (id/label/environment/created/revoked + a SHA-256 secret digest) — developer tooling, NOT protocol financial truth (design §11)',
  owningAuthority:
    'the PC-005 in-memory developer credential boundary (src/lib/console/developers/api-key-store.ts) — module-scoped process state, honestly NON-DURABLE (cleared on restart); plaintext secrets are generated server-side, shown exactly once at creation, and never retained retrievably',
  runtimeBoundary:
    'getDeveloperApiKeyStore() (src/lib/console/developers/api-key-store.ts) behind POST/GET/DELETE /api/console/developers/api-keys (the dedicated credential boundary; role-gated merchant-only per the frozen registry) and the /console/developers/api-keys page',
  durableSource:
    'none — deliberately: no credential persistence exists at this baseline and developer controls are not financial truth; the in-memory ruling (design §11) is recorded in spec/console/PC-005-evidence.md',
  unknownSemantics:
    'the store answers synchronously (no transport path exists to fail); an EMPTY key list is the honest VALUE "no API keys recorded yet", never an unavailable read and never a business verdict',
  evidenceReference:
    'the in-memory audit trail entries (api-key.created / api-key.revoked) rendered on the page; redaction contract per design §11',
};

const WEBHOOKS_METADATA: ConsoleAuthorityMetadata = {
  view: 'console.developers.webhooks — endpoint registry, event catalog, delivery state',
  protocolObject:
    'webhook endpoint registrations (url/environment/created/revoked + a SHA-256 signing-secret digest) plus the referenceable event identifiers from the real vocabularies — developer tooling, NOT protocol truth',
  owningAuthority:
    'the PC-005 in-memory webhook registry (src/lib/console/developers/webhook-store.ts) — NON-DURABLE process state; signing secrets are credentials (design §11): server-generated, shown exactly once, never logged; the event catalog is imported from the frozen observability taxonomy with the substrate lifecycle vocabulary source-verified',
  runtimeBoundary:
    'getDeveloperWebhookStore() (src/lib/console/developers/webhook-store.ts) behind POST/GET/DELETE /api/console/developers/webhooks and the /console/developers/webhooks page; CONSOLE_WEBHOOK_EVENT_CATALOG (webhook-events.ts) over OBSERVABILITY_DOMAINS/DOMAIN_DEFINITIONS (src/lib/observability/taxonomy.ts)',
  durableSource:
    'none for the registry (in-memory ruling); the event identifiers reference the real vocabularies: the closed nine-domain taxonomy (src/lib/observability/taxonomy.ts) and the durable substrate event vocabulary (src/lib/durable/events.ts, source-verified without an import — the console governance boundary forbids that import)',
  unknownSemantics:
    'delivery records are honestly absent, not UNKNOWN-guessed: NO delivery worker exists at this baseline — the view states it (retries are not implemented and must never imply protocol replay); an EMPTY endpoint list is the honest VALUE "no endpoints registered yet"',
  evidenceReference:
    'the in-memory audit trail entries (webhook-endpoint.created / webhook-endpoint.revoked); delivery-state rule quoted from design §11',
};

const REQUEST_LOGS_METADATA: ConsoleAuthorityMetadata = {
  view: 'console.developers.logs — the diagnostic request-log ring buffer',
  protocolObject:
    'request/trace metadata for console API boundary traffic — diagnostic records, never evidence substitutes (design §11)',
  owningAuthority:
    'the PC-005 in-memory diagnostic request-log ring (src/lib/console/developers/request-log-store.ts) — bounded, NON-DURABLE, redacted BEFORE storage through the existing fail-closed primitive scrubCredentialReferences (src/lib/observability/logging.ts)',
  runtimeBoundary:
    'ingestDeveloperRequestLog() called by the PC-005 console API boundary handlers (src/app/api/console/developers/**) — PC-003-owned routes are not modified (recorded in spec/console/PC-005-evidence.md); reads compose around the PC-003 exported seam normalizeDeveloperRequestRecord (read-models/developer-requests.ts)',
  durableSource:
    'none — deliberately in-memory (the design §11 ruling recorded in spec/console/PC-005-evidence.md); the A15 evidence chain remains the only protocol evidence authority',
  unknownSemantics:
    'the ring answers synchronously; an EMPTY ring is the honest VALUE "no entries recorded yet" (the recorded PC-003 gap closes as an honest empty value — nothing is fabricated); dropped-at-capacity entries are stated in the UI as the honest bound',
  evidenceReference:
    'per-entry trace ids where present (TraceAnchor family, src/lib/observability/tracing.ts); the redaction contract per design §11; spec/console/reconciliation-matrix.md developer-request-log row',
};

const REQUEST_INSPECTOR_METADATA: ConsoleAuthorityMetadata = {
  view: 'console.developers.request-inspector — the per-entry query view over the same ring',
  protocolObject:
    'one request-log entry with its full (already-redacted) payload — diagnostic, never protocol evidence; NO export exists (no secret-bearing output leaves this surface)',
  owningAuthority:
    'the same PC-005 in-memory ring (request-log-store.ts) queried by path/status — redaction happened at ingestion, so the inspector has no unredacted data to leak',
  runtimeBoundary:
    'queryDeveloperRequestLogs() (request-log-store.ts) behind the /console/developers/request-inspector page (server-side filtering through searchParams — presentation filtering only: no request value can affect role or environment)',
  durableSource: 'none — the same in-memory ruling as the logs surface',
  unknownSemantics:
    'an empty result set is the honest VALUE for the active filters (stated as such, distinct from an unavailable read); filters never fabricate entries',
  evidenceReference: 'per-entry trace ids where present; the redaction contract per design §11',
};

const ENVIRONMENTS_METADATA: ConsoleAuthorityMetadata = {
  view: 'console.developers.environments — the read-only environment presentation',
  protocolObject:
    'the server-derived environment signal (sandbox | production) with its derivation chain and the startup configuration validation summary — environment truth, not financial truth',
  owningAuthority:
    'the EXISTING environment authority chain (src/lib/environment.ts: PAYSWAP_ENV → allowlist → fail-safe sandbox) plus validateStartupConfig() (src/lib/startup-config.ts, DEP-002), composed through the PC-001 no-input wrapper getConsoleEnvironmentContext() (src/lib/console/environment-context.ts)',
  runtimeBoundary:
    'getConsoleEnvironmentContext() — accepts NO arguments: no query parameter, header, cookie, or client state can select production/test through this boundary (proven by tests that attempt exactly those spoofs); there is NO environment switching anywhere in the console',
  durableSource:
    'the deployment configuration (PAYSWAP_ENV) at build/start time — names only, never values (S1–S5); no console-owned environment state exists',
  unknownSemantics:
    'not applicable as an unavailable read: the chain always answers (fail-safe sandbox); the page renders the derivation result verbatim and the honest "no switching" statement',
  evidenceReference:
    'UX contract Section 10 (persistent environment signal); DEP-002 startup configuration validation; design §10 (sandbox/production distinction is server/configuration-derived)',
};

// ── DTOs ───────────────────────────────────────────────────────────────────

/** The API-keys read value (secret-free by construction). */
export interface ConsoleDeveloperApiKeysDto {
  readonly environment: string;
  readonly keys: readonly DeveloperApiKeyView[];
  readonly audit: readonly DeveloperControlAuditEntry[];
  readonly provenance: string;
}

/** The webhooks read value (registry + catalog + honest delivery state). */
export interface ConsoleDeveloperWebhooksDto {
  readonly environment: string;
  readonly endpoints: readonly DeveloperWebhookEndpointView[];
  readonly eventCatalog: readonly WebhookEventCatalogEntry[];
  readonly deliveryStateNote: string;
  readonly audit: readonly DeveloperControlAuditEntry[];
  readonly provenance: string;
}

/** One request-log entry as presented (PC-003 normalizer + inspector fields). */
export interface ConsoleDeveloperRequestEntryDto extends ConsoleDeveloperRequestRecordDto {
  readonly id: number;
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

/** The logs read value. */
export interface ConsoleDeveloperRequestLogsDto {
  readonly entries: readonly ConsoleDeveloperRequestEntryDto[];
  readonly capacity: number;
  readonly recorded: number;
  readonly provenance: string;
  readonly diagnosticNote: string;
  /** The redaction primitive every payload passed through BEFORE storage. */
  readonly redaction: string;
}

/** The inspector read value (the filtered view over the same ring). */
export interface ConsoleDeveloperRequestInspectorDto {
  readonly entries: readonly ConsoleDeveloperRequestEntryDto[];
  readonly recorded: number;
  /** The active filters, echoed verbatim (server-side presentation filter). */
  readonly filter: { readonly path?: string; readonly status?: number };
  readonly provenance: string;
  readonly diagnosticNote: string;
}

/** The environments read value (read-only presentation). */
export interface ConsoleDeveloperEnvironmentsDto {
  readonly context: ConsoleEnvironmentContext;
  readonly derivationChain: readonly string[];
  readonly noSwitchingNote: string;
}

// ── The reads ──────────────────────────────────────────────────────────────

/** Read the API-key surface for the current server-derived environment. */
export function readConsoleDeveloperApiKeys(role: Role): ConsoleReadResult<ConsoleDeveloperApiKeysDto> {
  const context = credentialContext(role);
  const store = getDeveloperApiKeyStore();
  return consoleValue(
    {
      environment: context.environment,
      keys: store.list(context),
      audit: store.audit(),
      provenance: IN_MEMORY_DEVELOPER_SURFACE_NOTE,
    },
    'SUCCEEDED',
    API_KEYS_METADATA,
  );
}

/** Read the webhook surface (registry + catalog + honest delivery state). */
export function readConsoleDeveloperWebhooks(role: Role): ConsoleReadResult<ConsoleDeveloperWebhooksDto> {
  const context = credentialContext(role);
  const store = getDeveloperWebhookStore();
  return consoleValue(
    {
      environment: context.environment,
      endpoints: store.list(context),
      eventCatalog: CONSOLE_WEBHOOK_EVENT_CATALOG,
      deliveryStateNote: WEBHOOK_DELIVERY_STATE_NOTE,
      audit: store.audit(),
      provenance: IN_MEMORY_DEVELOPER_SURFACE_NOTE,
    },
    'SUCCEEDED',
    WEBHOOKS_METADATA,
  );
}

/**
 * The environment-scoped credential context for the CURRENT server-derived
 * environment (the boundary's create/revoke operations pass it to the
 * stores). Derived per call — no request input participates.
 */
export function developerCredentialContextFor(role: Role): DeveloperCredentialContext {
  return credentialContext(role);
}

/** Widen one stored (already-redacted) entry through the PC-003 normalizer seam. */
function toRequestEntryDto(entry: DeveloperRequestLogEntry): ConsoleDeveloperRequestEntryDto {
  // Compose AROUND the PC-003 exported seam: the pure normalizer applies
  // its contract (wallMs/level/event/data/traceId; data scrubbed again —
  // idempotent) and the inspector fields widen it for this surface.
  const normalized = normalizeDeveloperRequestRecord({
    wallMs: entry.wallMs,
    level: entry.level,
    event: entry.event,
    data: entry.data,
    ...(entry.traceId === undefined ? {} : { traceId: entry.traceId }),
  });
  return {
    ...normalized,
    id: entry.id,
    method: entry.method,
    path: entry.path,
    status: entry.status,
  };
}

/** Read the diagnostic request log (newest first, bounded by the ring). */
export function readConsoleDeveloperRequestLogs(): ConsoleReadResult<ConsoleDeveloperRequestLogsDto> {
  const store = getDeveloperRequestLogStore();
  const entries = store.query({ limit: store.capacity() });
  return consoleValue(
    {
      entries: entries.map(toRequestEntryDto),
      capacity: store.capacity(),
      recorded: store.size(),
      provenance: IN_MEMORY_DEVELOPER_SURFACE_NOTE,
      diagnosticNote: DEVELOPER_DIAGNOSTIC_NOT_EVIDENCE_NOTE,
      redaction: 'scrubCredentialReferences (src/lib/observability/logging.ts) — applied at ingestion, before storage',
    },
    'SUCCEEDED',
    REQUEST_LOGS_METADATA,
  );
}

/** Read the filtered inspector view (query over the same ring). */
export function readConsoleDeveloperRequestInspector(
  filter: DeveloperRequestLogQuery,
): ConsoleReadResult<ConsoleDeveloperRequestInspectorDto> {
  const store = getDeveloperRequestLogStore();
  const entries = store.query(filter);
  return consoleValue(
    {
      entries: entries.map(toRequestEntryDto),
      recorded: store.size(),
      filter: {
        ...(filter.path === undefined ? {} : { path: filter.path }),
        ...(filter.status === undefined ? {} : { status: filter.status }),
      },
      provenance: IN_MEMORY_DEVELOPER_SURFACE_NOTE,
      diagnosticNote: DEVELOPER_DIAGNOSTIC_NOT_EVIDENCE_NOTE,
    },
    'SUCCEEDED',
    REQUEST_INSPECTOR_METADATA,
  );
}

/** The environment derivation chain, quoted from the frozen authority chain. */
const ENVIRONMENT_DERIVATION_CHAIN: readonly string[] = Object.freeze([
  'Source: the server-side environment variable PAYSWAP_ENV, set by deployment configuration before build/start — nothing else participates.',
  'Validation: exact allowlist { "sandbox", "production" }.',
  'Fail-safe: unset or any invalid value resolves to "sandbox" — production framing appears ONLY when configuration explicitly says production (the shell can never present sandbox execution as production execution).',
  'Resolution point: server-side only; the console receives the resolved value as a prop from the PC-001 no-input context function.',
]);

/** The read-only environment presentation (NO switching, ever). */
export const DEVELOPER_ENVIRONMENT_NO_SWITCHING_NOTE =
  'The environment signal is server-derived and read-only: there is no control on this page, in the console navigation, or anywhere in the product that selects production/sandbox — query parameters, headers, cookies, and client state never participate in the derivation.';

/** Read the environments surface (the frozen PC-001 context, presented). */
export function readConsoleDeveloperEnvironments(): ConsoleReadResult<ConsoleDeveloperEnvironmentsDto> {
  return consoleValue(
    {
      context: getConsoleEnvironmentContext(),
      derivationChain: ENVIRONMENT_DERIVATION_CHAIN,
      noSwitchingNote: DEVELOPER_ENVIRONMENT_NO_SWITCHING_NOTE,
    },
    'SUCCEEDED',
    ENVIRONMENTS_METADATA,
  );
}
