/**
 * DEP-005 — External rail connectivity: the adapter-activity observability
 * and audit surface.
 *
 * Owned surface: src/lib/rail-connectivity/activity.ts (work order DEP-005
 * — "Adapter activity is observable and auditable").
 *
 * THE ACTIVITY RECORD: one structured row per consequential connectivity
 * event — every transport attempt (first transmission AND same-key
 * retransmission), every final resolution (delivered / timeout /
 * transport-failure / UNKNOWN-surfaced), every report fetch, and the
 * configuration resolution itself. Each row carries the work order's
 * required fields: the rail, the idempotency key, the outcome, the latency,
 * the correlation ids, and the typed failure reason — plus the deadline the
 * call ran under and the attempt ordinal (the retry trail).
 *
 * QUERYABLE: the log is query-first — by rail, by idempotency key, by
 * outcome class, and by time window (since). The harness proves each axis.
 * This is the in-process realization of the topology contract's
 * external-rail-adapters health signal ("adapter circuit state; rail
 * reachability; submission acknowledgment rate"): the circuit/reachability
 * facts derive from these records; the DEP-002+ observability binding
 * (metrics endpoints) is the recorded future work.
 *
 * DURABLE: the log dual-writes — the in-memory structured records (the
 * query surface) AND, when an ActivityAuditPort is bound, one durable_events
 * row per event under RAIL_CONNECTIVITY_EVENT_OWNER ('rail-connectivity')
 * — the DEP-003 evidence home with the explicit owner column (the DEP-004
 * operational-jobs precedent: "every consequential job action ... records a
 * durable_events row under" the family's own owner identity; the substrate
 * records, never interprets). The boundary writes NO A15 records directly:
 * the A15 chain's authority vocabulary is closed to registry authorities,
 * and this family hosts none (topology: external-rail-adapters
 * authority_hosted none).
 *
 * CREDENTIAL ISOLATION IN THE AUDIT (S1-S5): records carry the rail id,
 * host REFERENCE and credential REFERENCE NAME at most — never a
 * credential value. No field for a value exists in the record shape; the
 * harness machine-checks the serialized records for secret-shaped
 * patterns.
 *
 * Determinism: the wall-clock source is injected; every record id is
 * deterministic (`activity.<ordinal>` — ordinal order, no randomness).
 *
 * Spec sources (binding): spec/system-work-orders/DEP-005.md ("Adapter
 * activity is observable and auditable"); spec/deployment/topology.md
 * (external-rail-adapters health signal + the F5/F6 rules; the worker
 * audit discipline); spec/durable/execution.md (durable_events — every row
 * names the party that recorded it); src/lib/operations/jobs.ts (the
 * owner-identity audit precedent).
 */

import type { RailTransportResult } from './transport.ts';
import type { RailTransportCorrelation } from './transport.ts';
import type { ResolvedRailConfig } from './configuration.ts';

// ---------------------------------------------------------------------------
// The audit identity (DEP-003 durable_events owner column)
// ---------------------------------------------------------------------------

/**
 * The durable_events owner for every rail-connectivity audit row. The
 * family is deployment-owned connectivity/transport safeguard logic — it
 * records under its own identity and writes NO A15 records directly (the
 * A15 chain's vocabulary is closed to registry authorities; this family
 * hosts none).
 *
 * Source: the DEP-004 operational-jobs precedent (OPERATIONS_EVENT_OWNER);
 * spec/durable/execution.md ("own their own evidence via recordEvent(type,
 * data, owner)").
 */
export const RAIL_CONNECTIVITY_EVENT_OWNER = 'rail-connectivity';

/** The activity event vocabulary (the durable journal's type strings). */
export const RAIL_CONNECTIVITY_EVENT_TYPES = Object.freeze({
  configurationResolved: 'rail.configuration.resolved',
  transmitAttempted: 'rail.transmit.attempted',
  transmitRetransmitted: 'rail.transmit.retransmitted',
  transmitDelivered: 'rail.transmit.delivered',
  transmitTimeout: 'rail.transmit.timeout',
  transportFailure: 'rail.transmit.transport-failure',
  unknownSurfaced: 'rail.transmit.unknown-surfaced',
  reportFetched: 'rail.report.fetched',
} as const);

// ---------------------------------------------------------------------------
// The structured activity record
// ---------------------------------------------------------------------------

/** The outcome axis of an activity record. */
export type AdapterActivityOutcome =
  | 'delivered-with-report'
  | 'timeout'
  | 'transport-failure'
  | 'UNKNOWN'
  | 'retransmitted'
  | 'report-fetched'
  | 'configuration-resolved';

/**
 * One structured adapter-activity record. Immutable. Carries the work
 * order's required observability fields: rail, idempotency key, outcome,
 * latency, correlation, typed failure reason (+ deadline + attempt
 * ordinal).
 *
 * There is NO field for a credential value (S1-S5): the record may carry
 * the credential REFERENCE NAME (resolvedRailConfig carries it) — never a
 * value.
 */
export interface AdapterActivityRecord {
  /** Deterministic record id: `activity.<ordinal>` (insertion order). */
  readonly activityId: string;
  /** Wall-clock ms at recording (integer — GC-1; from the injected clock). */
  readonly wallMs: number;
  readonly railId: string;
  /** The rail's scope tag (sandbox | production) — the isolation evidence axis. */
  readonly scopeTag: string;
  readonly idempotencyKey: string;
  /** The correlation ids (the GC-3 instruction link, the adapter when bound). */
  readonly correlation: RailTransportCorrelation;
  readonly outcome: AdapterActivityOutcome;
  /** The typed failure reason (transport taxonomy) — present for failure/timeout outcomes. */
  readonly reasonCode?: string;
  /** This transmission's latency in ms (per the engine's total span or the attempt's own span). */
  readonly latencyMs: number;
  /** The attempt ordinal (1 = first transmission; > 1 = same-key retransmission). */
  readonly attempt: number;
  /** The absolute deadline the call ran under (the timeout discipline's evidence). */
  readonly deadlineWallMs?: number;
}

/** Query axes for the activity log (all optional; AND-combined). */
export interface AdapterActivityQuery {
  readonly railId?: string;
  readonly idempotencyKey?: string;
  readonly outcome?: AdapterActivityOutcome;
  readonly sinceWallMs?: number;
}

// ---------------------------------------------------------------------------
// The audit port (structural — satisfied by the substrate's recordEvent)
// ---------------------------------------------------------------------------

/**
 * The durable journal port: the DEP-003 substrate's recordEvent satisfies
 * it structurally (type/data/owner/jobId — the jobs-family precedent). An
 * in-memory double satisfies it in tests. The boundary holds ONLY this
 * port — no database handle, no queue, no authority.
 */
export interface ActivityAuditPort {
  readonly recordEvent: (
    type: string,
    data: unknown,
    owner: string,
    jobId?: string | null,
  ) => unknown;
}

// ---------------------------------------------------------------------------
// The log (in-memory query surface + optional durable dual-write)
// ---------------------------------------------------------------------------

/**
 * The adapter-activity log: the family's observability surface. Append-only
 * in memory (query-first), dual-writing each consequential event to the
 * bound durable journal under RAIL_CONNECTIVITY_EVENT_OWNER when one is
 * bound.
 *
 * The recorder is the ONLY writer; readers query. Nothing in this module
 * can reach protocol state (it holds a structural audit port, nothing
 * else).
 */
export interface AdapterActivityLog {
  /** Record one attempt (called by the boundary per transport attempt). */
  recordAttempt(input: {
    readonly rail: ResolvedRailConfig;
    readonly idempotencyKey: string;
    readonly correlation: RailTransportCorrelation;
    readonly attempt: number;
    readonly retransmission: boolean;
    readonly result: RailTransportResult;
    readonly latencyMs: number;
    readonly wallMs: number;
    readonly deadlineWallMs: number;
  }): AdapterActivityRecord;

  /** Record one report fetch — the fetchReport observability. */
  recordReportFetch(input: {
    readonly rail: ResolvedRailConfig;
    readonly idempotencyKey: string;
    readonly correlation: RailTransportCorrelation;
    readonly wallMs: number;
    readonly outcomeClass: string;
    readonly reasonCode?: string;
  }): AdapterActivityRecord;

  /** Record the configuration resolution (the audit of what was resolved, scope-tagged). */
  recordConfigurationResolution(input: {
    readonly wallMs: number;
    readonly scopeTag: string;
    readonly rails: readonly ResolvedRailConfig[];
  }): AdapterActivityRecord;

  /** Query the records (AND-combined axes, insertion order). */
  query(query?: AdapterActivityQuery): readonly AdapterActivityRecord[];

  /** All records, insertion order (the full audit trail). */
  all(): readonly AdapterActivityRecord[];
}

/**
 * Build the adapter-activity log. `audit` is optional: unbound, the log is
 * the in-memory query surface alone (the harness's default); bound, every
 * consequential event dual-writes one durable_events row under
 * RAIL_CONNECTIVITY_EVENT_OWNER (the DEP-004 precedent).
 */
export function createAdapterActivityLog(options?: {
  readonly audit?: ActivityAuditPort;
}): AdapterActivityLog {
  const records: AdapterActivityRecord[] = [];
  const audit = options?.audit;

  const journal = (type: string, data: unknown): void => {
    if (audit === undefined) {
      return;
    }
    // The durable row carries the structured record verbatim (JSON) under
    // the family's owner identity. The substrate records, never
    // interprets; the boundary writes no A15 records directly.
    audit.recordEvent(type, data, RAIL_CONNECTIVITY_EVENT_OWNER, null);
  };

  const append = (
    outcome: AdapterActivityOutcome,
    fields: Omit<AdapterActivityRecord, 'activityId' | 'outcome'>,
  ): AdapterActivityRecord => {
    const activityId = `activity.${records.length + 1}`;
    const record: AdapterActivityRecord = Object.freeze({
      activityId,
      outcome,
      ...fields,
    });
    records.push(record);
    return record;
  };

  const attemptEventFor = (result: RailTransportResult): string => {
    switch (result.kind) {
      case 'delivered-with-report':
        return RAIL_CONNECTIVITY_EVENT_TYPES.transmitDelivered;
      case 'timeout':
        return RAIL_CONNECTIVITY_EVENT_TYPES.transmitTimeout;
      case 'transport-failure':
        return RAIL_CONNECTIVITY_EVENT_TYPES.transportFailure;
      case 'UNKNOWN':
        return RAIL_CONNECTIVITY_EVENT_TYPES.unknownSurfaced;
    }
  };

  const attemptOutcomeFor = (result: RailTransportResult, retransmission: boolean): AdapterActivityOutcome => {
    if (retransmission) {
      // The retransmission event records the retry trail (the audit axis
      // for the same-key discipline) with the attempt's own result class
      // preserved in reasonCode below.
      return 'retransmitted';
    }
    return result.kind;
  };

  return {
    recordAttempt(input) {
      const reasonCode =
        input.result.kind === 'transport-failure'
          ? input.result.reason
          : input.result.kind === 'timeout'
            ? 'TIMEOUT'
            : input.result.kind === 'UNKNOWN'
              ? input.result.cause
              : undefined;
      const record = append(attemptOutcomeFor(input.result, input.retransmission), {
        wallMs: input.wallMs,
        railId: input.rail.railId,
        scopeTag: input.rail.scopeTag,
        idempotencyKey: input.idempotencyKey,
        correlation: input.correlation,
        ...(reasonCode === undefined ? {} : { reasonCode }),
        latencyMs: input.latencyMs,
        attempt: input.attempt,
        deadlineWallMs: input.deadlineWallMs,
      });
      journal(attemptEventFor(input.result), record);
      if (input.retransmission) {
        journal(RAIL_CONNECTIVITY_EVENT_TYPES.transmitRetransmitted, record);
      }
      return record;
    },

    recordReportFetch(input) {
      const record = append('report-fetched', {
        wallMs: input.wallMs,
        railId: input.rail.railId,
        scopeTag: input.rail.scopeTag,
        idempotencyKey: input.idempotencyKey,
        correlation: input.correlation,
        ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
        latencyMs: 0,
        attempt: 0,
      });
      journal(RAIL_CONNECTIVITY_EVENT_TYPES.reportFetched, record);
      return record;
    },

    recordConfigurationResolution(input) {
      // Reference names only: the record carries the rail ids, scope tag,
      // host references and credential REFERENCE names — never values.
      const record = append('configuration-resolved', {
        wallMs: input.wallMs,
        railId: '*',
        scopeTag: input.scopeTag,
        idempotencyKey: '',
        correlation: { instructionId: '*' },
        reasonCode: `rails=${input.rails.length}`,
        latencyMs: 0,
        attempt: 0,
      });
      journal(RAIL_CONNECTIVITY_EVENT_TYPES.configurationResolved, {
        ...record,
        rails: input.rails.map((rail) => ({
          railId: rail.railId,
          scopeTag: rail.scopeTag,
          hostRef: rail.hostRef,
          ...(rail.credentialRef === undefined ? {} : { credentialRef: rail.credentialRef }),
          timeoutDeadlineMs: rail.timeoutDeadlineMs,
          retry: rail.retry,
        })),
      });
      return record;
    },

    query(query = {}) {
      return Object.freeze(
        records.filter(
          (record) =>
            (query.railId === undefined || record.railId === query.railId) &&
            (query.idempotencyKey === undefined || record.idempotencyKey === query.idempotencyKey) &&
            (query.outcome === undefined || record.outcome === query.outcome) &&
            (query.sinceWallMs === undefined || record.wallMs >= query.sinceWallMs),
        ),
      );
    },

    all() {
      return Object.freeze([...records]);
    },
  };
}
