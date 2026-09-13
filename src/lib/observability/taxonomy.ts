/**
 * DEP-007 — Observability: the telemetry taxonomy (the NINE health domains).
 *
 * Owned surface: src/lib/observability/taxonomy.ts (work order DEP-007 —
 * "Runtime telemetry distinguishes command, queue, execution, UNKNOWN,
 * reconciliation, clearing/netting, settlement/finality, incident/recovery
 * and deployment health").
 *
 * THE CLOSED TAXONOMY. Exactly nine domains, as a closed discriminated
 * union. Each domain carries its definition, the owning substrate signals
 * it derives from, and the query that derives its state. The union is
 * closed structurally: OBSERVABILITY_DOMAINS is a frozen tuple, the
 * ObservabilityDomain union is derived from it, and DOMAIN_DEFINITIONS is
 * an exhaustive Record over it — a tenth domain cannot be added without
 * editing this file (a governed change), and a domain cannot be removed
 * without the exhaustive Record failing to compile.
 *
 * THE FORBIDDEN BOUNDARY (work order: "using telemetry as financial
 * evidence" is FORBIDDEN). Telemetry is OBSERVATION ONLY:
 *   - it derives its view from recorded events (durable_events,
 *     durable_jobs, the rail activity surface, the operations progress
 *     reader) — pure queries, no mutation, no side effects, no network;
 *   - it never writes authoritative state, never decides financial
 *     outcomes, and is NEVER financial evidence: the A15 evidence chain is
 *     closed to registry authorities (evidence/record.ts), and no
 *     observability type satisfies the five-slot record contract — the
 *     ObservationOnly brand below marks every telemetry value as
 *     observation-only at the type level, and the family's static
 *     discipline scan (scripts/test_observability_resilience.mjs)
 *     machine-checks that no observability module calls recordEvent,
 *     imports a gateway/authority/store, or constructs a network client.
 *   - observability never weakens protocol authority: it holds no command
 *     path, no enqueue capability, no credential, and no state write.
 *
 * Spec sources (binding): spec/system-work-orders/DEP-007.md (the
 * acceptance bullet that names the nine domains; the forbidden clause);
 * spec/deployment/topology.md (the health-and-rollback model; the
 * evidence-object-store append-only rule; R3/R4/R5); spec/durable/
 * execution.md (durable_jobs/durable_events — the substrate signals);
 * src/lib/operations/progress-reader.ts (the audit reader the
 * reconciliation domain derives freshness from);
 * src/lib/rail-connectivity/activity.ts (the activity surface the
 * UNKNOWN/execution domains derive from).
 */

// ---------------------------------------------------------------------------
// The type-level observation-only boundary
// ---------------------------------------------------------------------------

/**
 * The brand marker every telemetry value carries: OBSERVATION ONLY — never
 * financial evidence, never an authoritative-state input. The brand is
 * type-only (erased at load time); it exists so a TelemetrySnapshot (or any
 * slice of one) can never be confused with an evidence record or an
 * authoritative input at the type level, and so the intent is machine
 * greppable in every derived interface.
 */
export declare const OBSERVATION_ONLY_BRAND: unique symbol;

/** The observation-only marker interface (the brand carrier). */
export interface ObservationOnly {
  readonly [OBSERVATION_ONLY_BRAND]: 'telemetry-is-observation-only-never-financial-evidence';
}

// ---------------------------------------------------------------------------
// The closed nine-domain union
// ---------------------------------------------------------------------------

/**
 * The nine health domains, in work-order order. Closed: the tuple is
 * frozen, the union is derived, and DOMAIN_DEFINITIONS is exhaustive.
 */
export const OBSERVABILITY_DOMAINS = Object.freeze([
  'command',
  'queue',
  'execution',
  'unknown',
  'reconciliation',
  'clearing-netting',
  'settlement-finality',
  'incident-recovery',
  'deployment',
] as const);

/** The closed discriminated union of the nine health domains. */
export type ObservabilityDomain = (typeof OBSERVABILITY_DOMAINS)[number];

/** Runtime type guard for the domain union. */
export function isObservabilityDomain(value: unknown): value is ObservabilityDomain {
  return (
    typeof value === 'string' &&
    (OBSERVABILITY_DOMAINS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// The domain definitions (definition · owning signals · deriving query)
// ---------------------------------------------------------------------------

/** One domain's definition: what it observes, from which signals, how. */
export interface DomainDefinition {
  readonly domain: ObservabilityDomain;
  /** What the domain's health MEANS (one sentence, from the work order). */
  readonly definition: string;
  /**
   * The owning substrate signals the domain derives from — every entry
   * names a real recorded signal (a durable_jobs column set, a
   * durable_events type under its owner, the rail activity surface, the
   * operations progress reader, the backup manifest).
   */
  readonly owningSignals: readonly string[];
  /**
   * The query that derives the domain's state (documentation form — the
   * executable derivation is telemetry.ts's collectTelemetrySnapshot, whose
   * per-domain sections are named after these entries).
   */
  readonly query: string;
}

/**
 * The exhaustive domain definition table. Adding a domain requires editing
 * OBSERVABILITY_DOMAINS + this Record together (a governed change); the
 * Record's exhaustiveness is compiler-enforced.
 */
export const DOMAIN_DEFINITIONS: Readonly<Record<ObservabilityDomain, DomainDefinition>> = Object.freeze({
  command: {
    domain: 'command',
    definition:
      'The protocol command admission path: are commands being admitted through the one gateway onto the durable command path, and is admitted command work moving?',
    owningSignals: [
      "durable_events type 'operations.command.submitted' (owner 'operational-jobs') — admissions, receipts and typed refusals over the window",
      "durable_jobs rows of gateway-enqueued command kinds (kinds not prefixed 'operations.') — the durable command path's queue position",
    ],
    query:
      'count events since (now - window) of type operations.command.submitted split by created/replayed/refused (+ refusal reason codes from the row data); count durable_jobs of command kinds by status; MIN-age the oldest queued command job',
  },
  queue: {
    domain: 'queue',
    definition:
      'The durable queue substrate itself: depth by status, oldest queued age, dead-letter count, lease-expired (zombie) reservations, and the attempt histogram.',
    owningSignals: [
      'durable_jobs.status (queued | reserved | succeeded | failed | dead_lettered) — depth by status',
      'durable_jobs.available_at — oldest queued age',
      'durable_jobs.lease_expires_at — lease-expired reserved jobs (zombie reservations)',
      'durable_jobs.attempts — the attempt histogram',
    ],
    query:
      "GROUP BY status over durable_jobs; MIN(available_at) WHERE status IN ('queued','failed'); COUNT WHERE status='reserved' AND lease_expires_at <= now; GROUP BY attempts; COUNT WHERE status='dead_lettered'",
  },
  execution: {
    domain: 'execution',
    definition:
      'Job execution health: are reserved jobs completing, at what attempt cost, and are command executions landing their observations?',
    owningSignals: [
      "durable_events types 'job_succeeded' / 'job_attempt_failed' / 'job_dead_lettered' / 'job_lease_expired' (owner 'durable-substrate') — the substrate's own lifecycle journal",
      "durable_events type 'protocol.command.executed' (owner = the binding authority) — the transition runtime's execution observations",
      'durable_jobs.attempts over succeeded jobs — the execution cost distribution',
    ],
    query:
      "count lifecycle events since (now - window) by type; count protocol.command.executed observations in the window; AVG(attempts) over durable_jobs WHERE status='succeeded'",
  },
  unknown: {
    domain: 'unknown',
    definition:
      'The UNKNOWN discipline surface: UNKNOWN outcomes surfaced (never retried, never translated) from the rail boundary and the settlement-support job, on their way to A14 reconciliation.',
    owningSignals: [
      "durable_events types 'rail.transmit.unknown-surfaced' / 'rail.transmit.timeout' / 'rail.transmit.transport-failure' / 'rail.transmit.retransmitted' (owner 'rail-connectivity') — the DEP-005 activity surface",
      "durable_events type 'operations.unknown.held' (owner 'operational-jobs') — the settlement job's never-retry audit",
    ],
    query:
      'count events since (now - window) of each UNKNOWN-class rail type plus operations.unknown.held; the retry trail arrives via rail.transmit.retransmitted',
  },
  reconciliation: {
    domain: 'reconciliation',
    definition:
      'Reconciliation sweep freshness: is the A14 orchestration duty running on cadence, and is it engaging the OPEN cases?',
    owningSignals: [
      "the operations progress reader (src/lib/operations/progress-reader.ts) over durable_events — 'operations.job.completed' rows for jobKind 'operations.reconciliation-sweep'",
      "durable_events type 'operations.command.submitted' with commandKind 'reconciliation.case.investigate' — the A14 engagement",
    ],
    query:
      'readOperationalJobProgress(database); last operations.job.completed for the sweep kind → freshness = now - recorded_at; count investigate submissions in the window',
  },
  'clearing-netting': {
    domain: 'clearing-netting',
    definition:
      'Clearing and netting progression health: are the A09/A11 progression duties running and emitting their window-batch and cohort commands?',
    owningSignals: [
      "the operations progress reader over durable_events — 'operations.job.completed' rows for jobKinds 'operations.clearing-progression' and 'operations.netting-settlement-progression'",
      "durable_events type 'operations.command.submitted' with commandKind prefixed 'clearing.' or 'netting.' — the progression emissions",
    ],
    query:
      'readOperationalJobProgress(database); last completion per progression kind → freshness; count clearing./netting. command submissions in the window (+ refusals)',
  },
  'settlement-finality': {
    domain: 'settlement-finality',
    definition:
      'Settlement and finality health: is settlement progression emitting, are settlement commands moving toward execution, and is finality advancing only through the authority (never reversed)?',
    owningSignals: [
      "durable_events type 'operations.command.submitted' with commandKind prefixed 'settlement.' — the settlement-support emissions (progression only; finality is NEVER the job's)",
      "durable_events type 'protocol.command.executed' with kind 'settlement.finality.declare' — finality advancing through the AUTHORITY's own command",
      "durable_jobs rows of kinds prefixed 'settlement.' — the settlement command path's queue position",
      "durable_events type 'operations.unknown.held' — settlement attempts held UNKNOWN (finality blocked pending reconciliation)",
    ],
    query:
      'count settlement.* command submissions in the window; count executed settlement.finality.declare observations; count queued settlement-kind jobs and MIN-age the oldest; count unknown-held rows',
  },
  'incident-recovery': {
    domain: 'incident-recovery',
    definition:
      'Disaster-recovery posture: backup coverage, restore verification, replay outcomes, and evidence-integrity violations (a detected tamper is the worst state a store can report).',
    owningSignals: [
      "durable_events types 'recovery.backup.completed' / 'recovery.restore.verified' / 'recovery.restore.failed' / 'recovery.replay.completed' / 'recovery.tamper.detected' / 'recovery.integrity.verified' (owner 'incident-recovery') — the recovery family's own journal",
      'the append-only backup manifest JSONL (recovery/backup.ts) — backup recency and counts',
    ],
    query:
      'count recovery.* events since (now - window) by type; last recovery.backup.completed → backup freshness; tamper/integrity failures count over ALL time (a violation never ages out)',
  },
  deployment: {
    domain: 'deployment',
    definition:
      "Deployment health: the runtime environment signal (the frozen allowlist), the durable store's crash-safety pragmas, the applied migration set, and backup coverage as deployment hygiene.",
    owningSignals: [
      'the frozen environment signal (src/lib/environment.ts — PAYSWAP_ENV allowlist sandbox | production, fail-safe sandbox)',
      "PRAGMA journal_mode on the durable handle (WAL is the DEP-003 crash-safety contract)",
      'schema_migrations (name + sha256 content checksum per applied migration)',
      'the backup manifest — last backup age (none observed = no DR coverage)',
    ],
    query:
      'resolve the environment through the frozen allowlist; PRAGMA journal_mode; COUNT(*) schema_migrations; last recovery.backup.completed → backup age',
  },
});

/** The domain ids in work-order order (a frozen copy for iteration). */
export function listObservabilityDomains(): readonly ObservabilityDomain[] {
  return OBSERVABILITY_DOMAINS;
}

/**
 * The one-line statement of the forbidden boundary (repeated in the spec
 * doc spec/deployment/observability.md and in every drill report):
 * telemetry observes; it never adjudicates, never records financial
 * evidence, and never weakens protocol authority.
 */
export const TELEMETRY_FORBIDDEN_BOUNDARY =
  'Telemetry is observation only: it never writes authoritative state, never decides financial outcomes, and is never financial evidence; observability never weakens protocol authority.';
