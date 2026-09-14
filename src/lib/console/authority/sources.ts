/**
 * PC-003 — The console owning-source registry (machine-readable).
 *
 * Step 1 of the PC-003 plan task: every console read model is enumerated here
 * with the EXACT owning source symbols it delegates to, the runtime boundary
 * it crosses, the durable source of truth, the UNKNOWN/recovery semantics,
 * and the evidence reference — the machine-readable form of the design §17
 * reconciliation matrix rows (the human-readable matrix is
 * spec/console/reconciliation-matrix.md, whose PENDING-PC-003 markers this
 * module fills on the read side).
 *
 * The registry carries the REAL accessor symbols as values (`accessors`) and
 * the REAL display-resolution symbols (`displayResolutions`), so tests can
 * prove by symbol identity that the recorded owning sources are the actual
 * exports the read models delegate through (adapter thinness — a recorded
 * source that stopped existing, or a read model drifting to another source,
 * fails the identity check).
 *
 * Console reads authority; it never becomes one (design §4/§8):
 *   - every accessor is an existing product port accessor or observability
 *     read — no new authority is constructed here;
 *   - no financial persistence, gateway command surface, or authority
 *     command module is imported (mechanically enforced by
 *     src/lib/console/governance.test.ts);
 *   - a read with NO existing authoritative source is recorded as an
 *     explicit gap (the developer request log at this baseline) and its
 *     read model answers unavailable/UNKNOWN — nothing is fabricated.
 */

import { getIntentPort } from '@/lib/protocol/intent-port';
import { getCheckoutPort } from '@/lib/protocol/checkout-port';
import { getCapabilityPort } from '@/lib/protocol/capability-port';
import { getWaitingPort } from '@/lib/protocol/waiting-port';
import { scrubCredentialReferences } from '@/lib/observability/logging';
import { OBSERVABILITY_DOMAINS } from '@/lib/observability/taxonomy';
import type { ComponentHealthProbe } from '@/lib/observability/readiness';
import { INTENT_STATE_DISPLAY_MAP, BOUNDARY_DISPLAY_RESOLUTION } from '@/lib/protocol/intent-state-mapping';
import { resolveCheckoutDisplay } from '@/lib/protocol/checkout-state-mapping';
import { resolveCapabilityDisplayState } from '@/lib/protocol/capability-state-mapping';
import type { ConsoleAuthorityMetadata } from '../types';

/** The console read models PC-003 owns (the design §17 views, read side). */
export const CONSOLE_READ_MODEL_IDS = [
  'payments',
  'payment-detail',
  'checkout-sessions',
  'checkout-session-status',
  'capabilities',
  'operations-health',
  'developer-requests',
] as const;
export type ConsoleReadModelId = (typeof CONSOLE_READ_MODEL_IDS)[number];

/**
 * One owning-source registry entry: the authority metadata (nine-question
 * discipline, design §16/§17) plus the real symbols the read model delegates
 * through, so the delegation target is machine-checkable.
 */
export interface ConsoleSourceRegistryEntry {
  readonly readModel: ConsoleReadModelId;
  /** The design §17 row this entry serves. */
  readonly designView: string;
  /** Authority metadata attached to every DTO this read model emits. */
  readonly metadata: ConsoleAuthorityMetadata;
  /** The EXACT owning accessor symbols the read model calls (identity-checked in tests). */
  readonly accessors: readonly unknown[];
  /** The EXACT display-resolution symbols consulted (identity-checked in tests). */
  readonly displayResolutions: readonly unknown[];
}

// ── Payment list (design §17 row 1) ────────────────────────────────────────

const PAYMENTS_LIST_METADATA: ConsoleAuthorityMetadata = {
  view: 'console.payments.all — payment list',
  protocolObject:
    'A01 intent state (DRAFT | AUTHORIZED | ROUTED | FULFILLING | FULFILLED | FAILED | CANCELLED), read through listSessionIntents()',
  owningAuthority:
    'Intent Authority (A01, spec/architecture/v0.1) — read through the runtime intent adapter over the composed protocol runtime',
  runtimeBoundary:
    'getIntentPort() (src/lib/protocol/intent-port.ts) backed by the runtime adapter (src/lib/protocol/runtime-intent-adapter.ts); server wiring via ensureProductPortsWired() (src/lib/protocol/server-composition.ts)',
  durableSource:
    'the durable substrate (src/lib/durable/db.ts) + the A01 intent store (protocol-runtime intent area persistence module) + the A15 evidence chain',
  unknownSemantics:
    'listSessionIntents() answering no-answer renders UNKNOWN (P5) — the A15 chain holds no intents; never an empty list standing in for an authoritative zero',
  evidenceReference:
    'A15 evidence-chain records (INTENT_CREATED / INTENT_STATE_CHANGED); mapping records IMR-9..IMR-15 (spec/product/intent-mapping-records.md)',
};

// ── Payment detail (design §17 row 2) ──────────────────────────────────────

const PAYMENT_DETAIL_METADATA: ConsoleAuthorityMetadata = {
  view: 'console.payments.detail — payment detail (flagship)',
  protocolObject:
    'A01 intent state + A15 evidence records + A08 queue/waiting state for the referenced intent',
  owningAuthority:
    'Intent Authority (A01) for intent/evidence reads; Fulfillment/Queue Authority (A08, with A06/A07 reads) for the waiting/queued sub-read',
  runtimeBoundary:
    'getIntentPort().getIntentState() and getWaitingPort().lookupWaiting() (src/lib/protocol/intent-port.ts, src/lib/protocol/waiting-port.ts) over the runtime adapters; gateway admission receipts surface only through the evidence the port reports',
  durableSource:
    'the durable substrate + the A01 intent store (protocol-runtime intent area persistence module) + the A15 evidence chain + the A08 queue records',
  unknownSemantics:
    'getIntentState() no-answer renders UNKNOWN with its reconciliation path (never "not found" failure); the waiting sub-read distinguishes the queue authority’s honest no-record answer (none) from a transport failure (unknown)',
  evidenceReference:
    'the snapshot’s A15 evidence records; mapping records IMR-7/IMR-8 boundary records + IMR-9..IMR-15 (spec/product/intent-mapping-records.md); spec/product/waiting-mapping-records.md',
};

// ── Checkout sessions (design §17 row 3) ───────────────────────────────────

const CHECKOUT_SESSIONS_METADATA: ConsoleAuthorityMetadata = {
  view: 'console.checkout.sessions — checkout sessions',
  protocolObject:
    'merchant checkout state (offered | accept-submitted | decline-submitted | accepted | accepted-awaiting-payment | declined | failed | unknown) read through listOpenCheckouts() / getStatus()',
  owningAuthority:
    'Checkout/Intent Authority (spec/architecture/v0.1) — reads re-anchored to the composed A01 Intent Authority; the area-20 Merchant Authority runtime is RTN wave 2 (recorded gap, honestly ARRIVING at the port boundary)',
  runtimeBoundary:
    'getCheckoutPort() (src/lib/protocol/checkout-port.ts) backed by the runtime adapter (src/lib/protocol/runtime-checkout-adapter.ts)',
  durableSource:
    'the durable substrate + the A01 intent store the adapter reads + the A15 evidence chain; authority-unreachable results are honest no-answers (src/lib/protocol/unavailable-backing.ts)',
  unknownSemantics:
    'authority-unreachable renders UNKNOWN (transport failure — never a fabricated offer/state); checkout-not-found renders UNKNOWN for the reference; an EMPTY open-checkout list is a legitimate VALUE (the authority answered: no open offers)',
  evidenceReference:
    'spec/product/checkout-mapping-records.md (cko-map-01..08 nine-question records); checkout evidence via the A15 chain',
};

// ── Capabilities (design §17 row 4) ────────────────────────────────────────

const CAPABILITIES_METADATA: ConsoleAuthorityMetadata = {
  view: 'console.capabilities — capability state',
  protocolObject:
    'A03 capability state (available | unavailable | conditional | pending | indeterminate) with the separate source-availability axis (reachable | degraded | unreachable)',
  owningAuthority:
    'Capability/Routing Authority (A03, spec/architecture/v0.1) — read through the runtime capability adapter; console code reads the port, never the authority module',
  runtimeBoundary:
    'getCapabilityPort() (src/lib/protocol/capability-port.ts) backed by the runtime adapter (src/lib/protocol/runtime-capability-adapter.ts)',
  durableSource:
    'the durable substrate + the A03 capability registry (protocol-runtime capability area persistence module) over the composed runtime',
  unknownSemantics:
    'unavailable ⇒ UNKNOWN: a report:null or unreachable source is the absence of an answer (availability-unknown), never an authoritative empty registry and never an outcome (design §13: availability is never inferred from configuration)',
  evidenceReference:
    'spec/product/capability-mapping-records.md (CAP-MAP-001..006, incl. the CAP-MAP-006 no-record family)',
};

// ── Operations health (design §17 row 5) ───────────────────────────────────

const OPERATIONS_HEALTH_METADATA: ConsoleAuthorityMetadata = {
  view: 'console.operations.* — operations health (composite read for the six operations modules)',
  protocolObject:
    'the nine observability domains (command, queue, execution, unknown, reconciliation, clearing-netting, settlement-finality, incident-recovery, deployment) with per-domain health ok | degraded | unknown-data | down',
  owningAuthority:
    'deployment/observability authorities: deriveComponentHealth (src/lib/observability/health.ts) + probeComponentHealth (src/lib/observability/readiness.ts) over collectTelemetrySnapshot (src/lib/observability/telemetry.ts) — observation-only, never financial evidence',
  runtimeBoundary:
    'probeComponentHealth() (src/lib/observability/readiness.ts) — the SAME composition point the existing /api/ready boundary enriches through (additive componentHealth field); OBSERVABILITY_DOMAINS (src/lib/observability/taxonomy.ts) is the frozen domain vocabulary',
  durableSource:
    'the durable substrate’s durable_events / durable_jobs signals (telemetry snapshot over the readiness probe database) + the operations progress reader (src/lib/operations/progress-reader.ts) + the rail activity surface',
  unknownSemantics:
    'health UNKNOWN where appropriate: the probe is fail-closed — an unopenable store or underivable snapshot reports unknown-data (the health authority’s own UNKNOWN), and a transport failure of the probe itself renders the console unavailable/UNKNOWN branch; telemetry is never translated into a business verdict',
  evidenceReference:
    'operational transcript/trace: TraceDocument / trace() (src/lib/observability/tracing.ts); spec/system-reconciliation.md + DEP-007 evidence (src/lib/observability/OBSERVABILITY-EVIDENCE.md)',
};

// ── Developer request log (design §17 row 6 — RECORDED GAP) ────────────────

const DEVELOPER_REQUESTS_METADATA: ConsoleAuthorityMetadata = {
  view: 'console.developers.logs / request-inspector — developer request log (PC-005 scaffold)',
  protocolObject:
    'request/trace metadata (diagnostic records, never evidence substitutes — design §11)',
  owningAuthority:
    'RECORDED GAP: the console/API logging boundary is PENDING-PC-005 and NO request-log persistence exists at this baseline — the read model answers unavailable/UNKNOWN and fabricates nothing; the existing redaction primitive scrubCredentialReferences (src/lib/observability/logging.ts) is the composed primitive a future source must pass through',
  runtimeBoundary:
    'read scaffold only: readConsoleDeveloperRequests() composes no source (none is merged); normalizeDeveloperRequestRecord() is a pure presentation normalizer over LogRecord (src/lib/observability/logging.ts) for the PC-005 boundary',
  durableSource:
    'none at this baseline (operational request-log persistence is PENDING-PC-005) — recorded, not invented',
  unknownSemantics:
    'unavailable ⇒ diagnostic UNKNOWN — the log gap is a diagnostic unknown, never a business verdict; when PC-005 wires a real source, credentials/authorization headers/secret-bearing fields are redacted through scrubCredentialReferences before any DTO ships',
  evidenceReference:
    'trace/request ids via TraceAnchor (src/lib/observability/tracing.ts); redaction contract per design §11; spec/console/reconciliation-matrix.md developer-request-log row',
};

/**
 * The owning-source registry: one entry per console read model, in the frozen
 * design §17 row order. The `accessors`/`displayResolutions` fields hold the
 * REAL symbol references — identity-checked by sources.test.ts so a renamed,
 * moved, or hallucinated source cannot masquerade as an owning authority.
 */
export const CONSOLE_SOURCE_REGISTRY: readonly ConsoleSourceRegistryEntry[] = [
  {
    readModel: 'payments',
    designView: 'Payment list',
    metadata: PAYMENTS_LIST_METADATA,
    accessors: [getIntentPort],
    displayResolutions: [INTENT_STATE_DISPLAY_MAP, BOUNDARY_DISPLAY_RESOLUTION],
  },
  {
    readModel: 'payment-detail',
    designView: 'Payment detail',
    metadata: PAYMENT_DETAIL_METADATA,
    accessors: [getIntentPort, getWaitingPort],
    displayResolutions: [INTENT_STATE_DISPLAY_MAP, BOUNDARY_DISPLAY_RESOLUTION],
  },
  {
    readModel: 'checkout-sessions',
    designView: 'Checkout session (list)',
    metadata: CHECKOUT_SESSIONS_METADATA,
    accessors: [getCheckoutPort],
    displayResolutions: [resolveCheckoutDisplay],
  },
  {
    readModel: 'checkout-session-status',
    designView: 'Checkout session (status)',
    metadata: CHECKOUT_SESSIONS_METADATA,
    accessors: [getCheckoutPort],
    displayResolutions: [resolveCheckoutDisplay],
  },
  {
    readModel: 'capabilities',
    designView: 'Capability',
    metadata: CAPABILITIES_METADATA,
    accessors: [getCapabilityPort],
    displayResolutions: [resolveCapabilityDisplayState],
  },
  {
    readModel: 'operations-health',
    designView: 'Operations health',
    metadata: OPERATIONS_HEALTH_METADATA,
    accessors: [loadOperationsHealthProbe],
    displayResolutions: [OBSERVABILITY_DOMAINS],
  },
  {
    readModel: 'developer-requests',
    designView: 'Developer request log',
    metadata: DEVELOPER_REQUESTS_METADATA,
    accessors: [scrubCredentialReferences],
    displayResolutions: [],
  },
];

/**
 * Lazy accessor for the readiness probe (the /api/ready composition point).
 * The readiness module binds the server-only durable substrate in its import
 * graph, so it is loaded ON DEMAND — never statically from console code
 * (browser and test contexts must stay free of it; the operations-health
 * read model calls this loader, and tests mock the readiness module).
 *
 * The console calls the probe with NO options (the probe's own fail-closed
 * internals own database handling), so the returned contract is the zero-arg
 * projection of the real symbol — the real `probeComponentHealth` (whose
 * optional `database`/`telemetry` parameters are for the /api/ready drills)
 * is assignable to it unchanged, and the durable-substrate option types stay
 * out of the console surface entirely.
 */
export async function loadOperationsHealthProbe(): Promise<() => ComponentHealthProbe> {
  const module = await import('@/lib/observability/readiness');
  return module.probeComponentHealth;
}

/** Look up one registry entry by read-model id (fail-closed: undefined for unknown ids). */
export function consoleSourceFor(readModel: string): ConsoleSourceRegistryEntry | undefined {
  return CONSOLE_SOURCE_REGISTRY.find((entry) => entry.readModel === readModel);
}

/** The authority metadata for one read model (throws for unknown ids — a wiring bug, not a runtime input). */
export function consoleSourceMetadata(readModel: ConsoleReadModelId): ConsoleAuthorityMetadata {
  const entry = consoleSourceFor(readModel);
  if (entry === undefined) {
    throw new Error(`unknown console read model: ${readModel}`);
  }
  return entry.metadata;
}
