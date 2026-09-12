/**
 * DEP-005 — The external rail connectivity family barrel: the composed
 * public surface of the connectivity/transport-safeguard boundary.
 *
 * Owned surface: src/lib/rail-connectivity/ (work order DEP-005 — "production
 * adapter connectivity/configuration and transport safeguards").
 *
 * WHAT THIS LAYER IS: the deployment-owned connectivity boundary of the
 * external rail adapters — the typed transport port, the environment-scoped
 * configuration resolution (credential REFERENCES only, scope-isolated),
 * the same-key/bounded/backoff/deadline-aware retry safeguards, the
 * structured adapter-activity observability/audit surface, and the
 * composition that wraps all of it into the FROZEN A13
 * RailAdapterConnection interface the protocol runtime already consumes.
 * It is the in-process realization of the deployment contract's
 * external-rail-adapters connectivity obligations (spec/deployment/
 * topology.md): the surface real rail transports bind under, with real-rail
 * credentials and the network transport primitive remaining FUTURE-WORK in
 * the production secret scope.
 *
 * WHAT THIS LAYER IS NOT (the work-order boundary, structural):
 *   - NOT a protocol authority: it hosts none (topology:
 *     external-rail-adapters authority_hosted "none"); it never admits
 *     protocol commands (no gateway import — the protocol-gateway stays
 *     the sole admission point) and never writes authoritative state (no
 *     authority/store/persistence import — the transition runtime stays
 *     the single writer; RailAdapter/RailOperation state advances only
 *     through the A13 command surface, rtn-plan-rulings.md Q1/delta 1).
 *   - NOT a network client: the transport primitive is an injected port;
 *     the repository binds deterministic doubles (the evidence harness);
 *     real egress + credential dereference are the externalized FUTURE-WORK
 *     production binding (components.json future_work).
 *   - NOT a translator of UNKNOWN: UNKNOWN results surface upward verbatim
 *     for A14 reconciliation (GC-2 / INV-13-4); retries happen ONLY at the
 *     transport layer, ONLY with the SAME idempotency key (INV-13-3),
 *     ONLY for explicitly-retryable pre-effect failures, bounded, with
 *     backoff, under the deadline.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE MAP — per-module entry points
 * ═══════════════════════════════════════════════════════════════════════
 *
 * | Module | Duty |
 * |---|---|
 * | transport.ts | the typed adapter-transport port: the request contract (deadline + rail idempotency key + correlation ids) and the EXPLICIT result quadruple (delivered-with-report \| timeout \| transport-failure(typed reasons, phase-classified) \| UNKNOWN); the frozen A13 mapping helpers (frozen-vocabulary-only) |
 * | configuration.ts | the environment-scoped per-rail configuration resolver: PAYSWAP_RAIL_{SCOPE}_{RAIL}_* names (host ref, credential REFERENCE, explicit timeout, bounded retry knobs), shape validation, fail-closed loading, the scope-isolation proofs (scope tags + resolution refusals) |
 * | retry.ts | the transport safeguard engine: same-key retransmission only, bounded, exponential backoff, deadline-aware, explicitly-retryable pre-effect failures only; UNKNOWN/timeout NEVER retried |
 * | activity.ts | the structured adapter-activity observability/audit surface: one record per consequential connectivity event (rail, key, outcome, latency, correlation, typed reason, deadline, attempt ordinal), queryable, dual-written to durable_events under the 'rail-connectivity' owner when a journal is bound |
 * | boundary.ts | the composition: transport + config + retry + activity wrapped into the FROZEN RailAdapterConnection (adapter-local payload validation; the conservative frozen-vocabulary mapping; the scope re-check at binding) |
 * | RAIL-CONNECTIVITY-EVIDENCE.md | the family's evidence document (disciplines, the mapping table, the FUTURE-WORK notes, the harness scenarios) |
 *
 * ═══════════════════════════════════════════════════════════════════════
 * THE COMPOSITION ORDER (how the boundary composes — the DEP-004
 * port-binding precedent: the family depends on its own ports; the root
 * binds the real primitives)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   1. THE RUNTIME SCOPE: the composition root derives it from PAYSWAP_ENV
 *      through the frozen src/lib/environment.ts module (sandbox |
 *      production — F1; the family itself never reads process.env).
 *   2. THE CONFIGURATION: resolveRailConnectivityConfig({ processEnv,
 *      runtimeScope, declaredRails }) — typed failures refuse the start
 *      (F6); resolved rails are scope-tagged and frozen.
 *   3. THE ACTIVITY LOG: createAdapterActivityLog({ audit? }) — bind the
 *      durable_events journal (recordEvent under owner
 *      'rail-connectivity') when durable audit is required.
 *   4. THE TRANSPORT PRIMITIVE: the root binds the transport factory —
 *      deterministic in-process doubles in the repository (the harness);
 *      the real network transport client in the externalized production
 *      deployment (FUTURE-WORK).
 *   5. THE BOUNDARY: createConnectivityBoundary({ rails, runtimeScope,
 *      transportFactory, activity, clock }) — one frozen
 *      RailAdapterConnection per rail, scope re-checked at binding.
 *   6. THE SEAM: the A13 authority's submitRailOperation / the settlement
 *      authority's submitAttempt consume the returned connections exactly
 *      as they consume the protocol-owned simulated adapter (the same
 *      interface — the topology simulation rule's "same interface" made
 *      true from the outside in).
 *
 * The evidence harness scripts/test_rail_connectivity.mjs realizes this
 * order end-to-end over scripted transport doubles and the real A13
 * authority (the composed-seam proof), plus the REAL durable substrate for
 * the audit journal proof.
 *
 * Runtime note (the DEP-004 family precedent): this family's modules import
 * only plain-Node-loadable leaves (the rails payload-proof utility) and
 * TYPE-ONLY imports of the frozen adapter interface (erased at load time),
 * so the family loads under plain Node with type stripping AND type-checks
 * under tsc. It is NOT loaded by any bun suite (the merged 1901 remain
 * untouched) and NOT imported by any src/app route (the web boundary keeps
 * zero rail reach, per the topology's web boundary rules).
 */

// --- the typed transport port -------------------------------------------------
export type {
  RailTransportRequest,
  RailReportFetchRequest,
  RailTransportCorrelation,
  RailTransportResult,
  RailTransportTelemetry,
  RailTransportFailureReason,
  RailTransportUnknownCause,
  TransportFailureClassification,
  RailTransportPort,
} from './transport.ts';
export {
  TRANSPORT_FAILURE_CLASSIFICATION,
  RAIL_TRANSPORT_RESULT_KINDS,
  isRailTransportFailureReason,
  isRailTransportResultKind,
  frozenA13ReasonCodeForResult,
  protocolClassForTransportResult,
} from './transport.ts';

// --- the environment-scoped configuration -------------------------------------
export type {
  RailConnectivityScopeTag,
  RailConnectivityScopeSegment,
  RailConnectivityRuntimeScope,
  RailRetryPolicy,
  ResolvedRailConfig,
  RailConnectivityResolutionFailure,
  RailConnectivityResolution,
  RailConnectivityResolutionInput,
  RailDeclaration,
} from './configuration.ts';
export {
  RAIL_CONNECTIVITY_VARIABLE_TEMPLATES,
  RAIL_CONNECTIVITY_PRODUCTION_REQUIRED_NAMES,
  MAX_RETRY_ATTEMPTS_BOUND,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  DEFAULT_RETRY_BACKOFF_BASE_MS,
  DEFAULT_RETRY_BACKOFF_MAX_MS,
  IN_PROCESS_SIMULATED_HOST_MARKER,
  isRailConnectivityScopeTag,
  resolveRailConnectivityConfig,
  loadRailConnectivityConfigOrThrow,
  assertRailScopeMatchesRuntime,
  RailConnectivityConfigurationError,
} from './configuration.ts';

// --- the retry/deadline safeguard engine ---------------------------------------
export type { TransportRetryDecision, TransportAttemptRecord, SafeguardedTransmission } from './retry.ts';
export { transportBackoffDelayMs, decideTransportRetry, transmitWithTransportSafeguards } from './retry.ts';

// --- the adapter-activity observability/audit surface --------------------------
export type {
  AdapterActivityRecord,
  AdapterActivityOutcome,
  AdapterActivityQuery,
  AdapterActivityLog,
  ActivityAuditPort,
} from './activity.ts';
export {
  RAIL_CONNECTIVITY_EVENT_OWNER,
  RAIL_CONNECTIVITY_EVENT_TYPES,
  createAdapterActivityLog,
} from './activity.ts';

// --- the boundary composition (the frozen interface, satisfied) ----------------
export type {
  ConnectivityRailAdapterOptions,
  RailTransportFactory,
  ConnectivityBoundaryOptions,
  ConnectivityBoundary,
} from './boundary.ts';
export {
  validateTransmissionRequest,
  mapTransportResultToFrozenOutcome,
  createConnectivityRailAdapter,
  createConnectivityBoundary,
} from './boundary.ts';
