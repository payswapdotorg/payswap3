/**
 * DEP-007 — The observability family barrel: the composed public surface
 * of the health/metrics/logging/tracing layer.
 *
 * Owned surface: src/lib/observability/ (work order DEP-007 — "Owned
 * surfaces: health/metrics/logging/tracing, backups, restore, replay and
 * recovery automation"; this barrel covers the first half — the recovery
 * half lives in src/lib/recovery/).
 *
 * WHAT THIS LAYER IS: the deployment-owned observability wrapper over the
 * existing substrate. It READS durable_events, durable_jobs, the DEP-005
 * rail activity surface, the DEP-004 operations progress reader, and the
 * recovery family's own journal — deriving the NINE health domains
 * (taxonomy.ts), the TelemetrySnapshot (telemetry.ts), the actionable
 * health model with the worst-of rollup (health.ts), structured JSON-lines
 * logging with fail-closed credential-reference scrubbing (logging.ts),
 * and id-based trace correlation (tracing.ts). It never forks or
 * re-implements substrate semantics: it wraps, read-only.
 *
 * WHAT THIS LAYER IS NOT (the work order's forbidden clause, structural):
 *   - NOT financial evidence: no observability type satisfies the A15
 *     record contract; every telemetry value carries the ObservationOnly
 *     brand; the harness's static discipline scan machine-checks that no
 *     observability module calls recordEvent, imports the
 *     gateway/authorities/stores, or constructs a network client.
 *   - NOT a state writer: the only effects this family performs are
 *     in-process log emission (console + a bounded ring buffer).
 *   - NOT an external telemetry binding: there is no metrics endpoint, no
 *     collector, no tracing backend — external binding is recorded
 *     FUTURE-WORK (the DEP-002+ binding precedent; the CONTRACT-DELTA
 *     PROPOSAL in the work item's completion report carries the exact
 *     components.json fields for it).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE MAP
 * ═══════════════════════════════════════════════════════════════════════
 *
 * | Module | Duty |
 * |---|---|
 * | taxonomy.ts | the closed NINE-domain discriminated union (command, queue, execution, unknown, reconciliation, clearing-netting, settlement-finality, incident-recovery, deployment) with per-domain definitions, owning substrate signals, and deriving queries; the ObservationOnly brand (the forbidden boundary, type-level) |
 * | telemetry.ts | collectTelemetrySnapshot — the pure per-domain metric derivations over the durable store (queue depth by status, oldest queued age, dead-letter count, lease-expired reserved jobs, attempt histogram, event counts by owner/type over the window, the rail activity rollup, reconciliation-sweep freshness via the operations progress reader, the recovery journal) |
 * | health.ts | the actionable health model: ok \\| degraded \\| down \\| unknown-data per domain, a REQUIRED action descriptor on every non-ok state (fail-closed construction), the severity ordering, and the worst-of composite rollup that never masks |
 * | logging.ts | structured JSON-lines logging with levels and the fail-closed credential-reference scrubber; in-process sinks (console + a queryable bounded ring buffer) |
 * | tracing.ts | the trace() correlation helper over the ids the substrate already records (command → queue → execution → effects) |
 * | OBSERVABILITY-EVIDENCE.md | the family's evidence document (the drill runs, the numbers, the honest boundaries) |
 *
 * The web boundary integration is ADDITIVE ONLY: src/app/api/ready/route.ts
 * gains a componentHealth enrichment (the existing fields and status codes
 * byte-identical; src/app/api/health/route.ts untouched — the F6
 * liveness/readiness separation is preserved).
 */

// --- the taxonomy --------------------------------------------------------------
export {
  OBSERVABILITY_DOMAINS,
  DOMAIN_DEFINITIONS,
  TELEMETRY_FORBIDDEN_BOUNDARY,
  isObservabilityDomain,
  listObservabilityDomains,
} from './taxonomy.ts';
export type {
  ObservabilityDomain,
  DomainDefinition,
  ObservationOnly,
} from './taxonomy.ts';

// --- the telemetry snapshot collector -------------------------------------------
export {
  collectTelemetrySnapshot,
  DEFAULT_TELEMETRY_WINDOW_MS,
  DEFAULT_EVENT_SCAN_LIMIT,
} from './telemetry.ts';
export type {
  TelemetrySnapshot,
  TelemetryOptions,
  BackupManifestSummaryEntry,
  QueueDomainMetrics,
  CommandDomainMetrics,
  ExecutionDomainMetrics,
  UnknownDomainMetrics,
  ReconciliationDomainMetrics,
  ClearingNettingDomainMetrics,
  SettlementFinalityDomainMetrics,
  IncidentRecoveryDomainMetrics,
  DeploymentDomainMetrics,
} from './telemetry.ts';

// --- the health model ------------------------------------------------------------
export { deriveComponentHealth, readinessProjection, worstOf, HEALTH_SEVERITY } from './health.ts';
export type {
  HealthState,
  HealthActionDescriptor,
  DomainHealth,
  ComponentHealth,
  HealthThresholds,
} from './health.ts';

// --- structured logging ------------------------------------------------------------
export {
  createObservabilityLogger,
  scrubCredentialReferences,
  consoleLogSink,
  DEFAULT_RING_CAPACITY,
  isLogLevel,
} from './logging.ts';
export type {
  LogLevel,
  LogRecord,
  LogSink,
  LogQuery,
  ObservabilityLogger,
  ObservabilityLoggerOptions,
} from './logging.ts';

// --- trace correlation ---------------------------------------------------------------
export { trace, renderTrace } from './tracing.ts';
export type { TraceAnchor, TraceDocument, TraceEvent, TraceJob, TraceLink } from './tracing.ts';

// --- the readiness enrichment (server-side, additive) ---------------------------------
export {
  probeComponentHealth,
  type ComponentHealthProbe,
} from './readiness.ts';
