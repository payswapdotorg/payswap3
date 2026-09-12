/**
 * DEP-005 — External rail connectivity: the typed adapter-transport port.
 *
 * Owned surface: src/lib/rail-connectivity/ (work order DEP-005 — "production
 * adapter connectivity/configuration and transport safeguards"). This module
 * defines THE TRANSPORT PORT — the connectivity boundary's own interface —
 * and the explicit result vocabulary every transmission through the boundary
 * resolves to. There is NO implicit success: every call resolves to exactly
 * one of the four explicit outcome classes below, each carrying the rail
 * idempotency key, the correlation ids, and the deadline it ran under.
 *
 * THE FROZEN SEAM (read-only integration). The adapter interface is frozen
 * under the Q1/delta-1 ruling (src/lib/protocol-runtime/rails/adapters.ts):
 * "the adapter interface ... is strictly TRANSMISSION-AND-REPORTING: no code
 * path in the adapter interface creates or mutates RailAdapter/RailOperation
 * state". This port composes UNDER that frozen interface: the boundary
 * (boundary.ts) wraps any RailTransportPort into the frozen
 * RailAdapterConnection shape the A13 authority already consumes. This module
 * imports NOTHING from the authorities, the store, the persistence layer or
 * the gateway — it cannot reach protocol state (machine-checked by
 * scripts/test_rail_connectivity.mjs).
 *
 * THE RESULT VOCABULARY (the work order's explicit-outcome contract):
 *
 *   delivered-with-report — the transport completed the exchange AND the
 *                           rail's synchronous answer is in hand (a report
 *                           envelope; INV-13-4 still applies: the envelope's
 *                           class is whatever the rail asserted, never an
 *                           inference from acceptance).
 *   timeout               — the deadline elapsed before a deliverable answer
 *                           arrived. EXPLICIT: the deadline is a first-class
 *                           member of every request; a timed-out call never
 *                           guesses an outcome.
 *   transport-failure     — the transport itself failed, with a TYPED reason
 *                           from the taxonomy below and an explicit phase:
 *                           'pre-effect' (provably before any external
 *                           effect — DNS, connect refused, TLS handshake) or
 *                           'in-flight' (indeterminate external effect).
 *   UNKNOWN               — the exchange produced an answer whose OUTCOME is
 *                           indeterminate (ambiguous/unclassifiable rail
 *                           response). NEVER translated to success or
 *                           failure by this boundary: it surfaces upward
 *                           verbatim, and the A14 reconciliation path owns
 *                           the resolution (GC-2 / INV-13-4).
 *
 * The conservative A13 mapping (documented here, machine-checked by the
 * harness): only reason codes from the FROZEN rails vocabulary
 * (rails/reason-codes.ts — "No member may be added without a cited spec
 * line") ever enter the frozen RailAdapterConnection interface through this
 * boundary:
 *   timeout                → UNKNOWN { reasonCode: 'TIMEOUT' }
 *   transport-failure      → UNKNOWN { reasonCode: 'CONNECTION_LOSS' }
 *   UNKNOWN                → UNKNOWN { reasonCode: 'AMBIGUOUS_RAIL_RESPONSE' }
 *   adapter-local payload  → REJECTED { reasonCode: 'PAYLOAD_MALFORMED' }
 *                             validation (boundary.ts — the same
 *                             adapter-local discipline the protocol-owned
 *                             simulated adapter applies)
 *   delivered-with-report  → ACCEPTED { railReferences, duplicate }
 * The precise transport taxonomy (DNS vs TLS vs quota, pre-effect vs
 * in-flight, retry history, latency) lives in THIS boundary's own typed
 * results and its adapter-activity records (activity.ts) — never as new
 * protocol reason codes. Where the boundary privately knows a failure was
 * pre-effect, it still maps UNKNOWN-class at the protocol seam: UNKNOWN is
 * the no-guessing catch-all ("Silence or ambiguity maps to UNKNOWN",
 * INV-13-4) and reconciliation is the designed resolution path.
 *
 * NO-EGRESS DISCIPLINE (work-order stop condition): this module performs
 * ZERO external network transmission. The port is an interface; the
 * repository binds deterministic in-process doubles (the harness) and the
 * real network transport primitive is the externalized FUTURE-WORK binding
 * (deploy/contracts/components.json, external-rail-adapters future_work).
 * There is no fetch, socket, HTTP/TLS/DNS client and no signing capability
 * anywhere in this file.
 *
 * Synchrony note: the port is synchronous, matching the frozen in-process
 * adapter interface (RailAdapterConnection.transmit is synchronous) and the
 * composed runtime it binds into today. An asynchronous network transport is
 * part of the externalized process binding (FUTURE-WORK) — recorded in the
 * deployment contract, not invented here.
 *
 * Spec sources (binding):
 *   spec/system-work-orders/DEP-005.md — "Timeouts and failures are
 *     explicit"; "External UNKNOWN is never translated to failure or success
 *     without reconciliation"; "Retries respect existing idempotency rules".
 *   spec/architecture/v0.1/rails-adapters-reconciliation.md lines 21-25
 *     (adapters report external results back — including UNKNOWN — without
 *     ever owning protocol financial state), lines 42-44 (UNKNOWN causes:
 *     "timeout, connection loss, ambiguous rail response"), lines 66-72
 *     (INV-13-3/INV-13-4: idempotency-key collapse; no guessing), lines
 *     74-78 (failure semantics).
 *   spec/deployment/topology.md — external-rail-adapters (the sole
 *     external-effect execution point; simulation rule; F6 fail-closed).
 *   spec/deployment/configuration.md — S1-S5 (secret names only, never
 *     values).
 */

import type { RailOperationPayload } from '../protocol-runtime/rails/types.ts';
import type { RailReportEnvelope } from '../protocol-runtime/rails/adapters.ts';

// ---------------------------------------------------------------------------
// The transport request (deadline + idempotency key + correlation ids)
// ---------------------------------------------------------------------------

/**
 * The correlation ids every transport call carries. The instruction link is
 * the GC-3 authorization reference ("AUTHORIZED: created by Settlement
 * Authority (area 12) with a linked settlement instruction; this link is the
 * explicit authorization required by GC-3" — rails-adapters-reconciliation.md
 * lines 36-40); the rail idempotency key is INV-13-3's deterministic
 * submission identity. Together they make every transport attempt
 * correlatable end-to-end: instruction → operation → transmission attempt →
 * activity record → (on indeterminacy) reconciliation case.
 *
 * Source: rails-adapters-reconciliation.md lines 36-40, 63-69; DEP-005 work
 * order ("every call carries deadline, rail idempotency key, correlation
 * ids").
 */
export interface RailTransportCorrelation {
  /** The settlement-instruction link (GC-3) — from the payload. */
  readonly instructionId: string;
  /** The A13 adapter record this transmission runs for, when bound per-adapter. */
  readonly adapterId?: string;
}

/**
 * One transmission request handed to the transport port. The deadline is
 * ABSOLUTE (epoch ms — GC-1 integer time): the transport and the retry
 * engine (retry.ts) both measure against it; a request whose deadline has
 * already elapsed resolves to `timeout` without guessing.
 *
 * The idempotencyKey + payload + payloadHash triple is the retransmission
 * identity: INV-13-3 ("where the rail supports idempotency keys, duplicate
 * submissions at the rail collapse") is what makes same-key transport-layer
 * retransmission safe — a retry re-sends EXACTLY this triple, never a
 * re-derived one.
 */
export interface RailTransportRequest {
  /** The configured rail this transmission runs against (configuration.ts). */
  readonly railId: string;
  /** INV-13-3: the deterministic rail idempotency key (same key on every attempt). */
  readonly idempotencyKey: string;
  /** The authorized external effect's payload — integer Money verbatim (INV-13-2). */
  readonly payload: RailOperationPayload;
  /** The payload proof hash recorded at authorization (INV-13-2). */
  readonly payloadHash: string;
  /** The correlation ids (instruction link, adapter). */
  readonly correlation: RailTransportCorrelation;
  /** ABSOLUTE deadline in epoch ms; the transport never runs past it. */
  readonly deadlineWallMs: number;
}

/** A report-fetch request (the connectivity form of fetchReport). */
export interface RailReportFetchRequest {
  readonly railId: string;
  readonly idempotencyKey: string;
  readonly correlation: RailTransportCorrelation;
  /** The hash the report must prove (INV-13-2 "re-checked on every report"). */
  readonly payloadHash: string;
}

// ---------------------------------------------------------------------------
// The typed transport-failure taxonomy (DEP-005-owned vocabulary)
// ---------------------------------------------------------------------------

/**
 * The transport-failure reason taxonomy. This is the CONNECTIVITY BOUNDARY's
 * own vocabulary (DEP-005 owned) — distinct from, and mapped conservatively
 * INTO, the frozen A13/A14 rails vocabulary. Each reason carries a frozen
 * classification (TRANSPORT_FAILURE_CLASSIFICATION below): its phase
 * (pre-effect vs in-flight) and whether transport-layer retry of the SAME
 * idempotency key is explicitly permitted.
 *
 *   pre-effect — the request provably never reached the rail (name
 *                resolution, TCP connect, TLS handshake, credential
 *                refusal at the door). No external effect can exist.
 *   in-flight  — the exchange began and failed or produced an unusable
 *                answer. The external effect is INDETERMINATE: the
 *                protocol-level outcome must be UNKNOWN, never FAILED.
 *
 * Source: rails-adapters-reconciliation.md lines 42-44 (UNKNOWN causes),
 * 74-78 (failure semantics — "After submission, any non-deterministic
 * outcome maps to UNKNOWN"); DEP-005 work order ("failures are explicit";
 * "Retries respect existing idempotency rules").
 */
export type RailTransportFailureReason =
  | 'DNS_UNRESOLVED'
  | 'HOST_UNREACHABLE'
  | 'CONNECTION_REFUSED'
  | 'TLS_HANDSHAKE_FAILED'
  | 'AUTH_CREDENTIAL_REJECTED'
  | 'CONNECTION_LOSS_IN_FLIGHT'
  | 'RESPONSE_MALFORMED';

/** The frozen classification of every transport-failure reason. */
export interface TransportFailureClassification {
  /** 'pre-effect': provably before any external effect; 'in-flight': indeterminate. */
  readonly phase: 'pre-effect' | 'in-flight';
  /**
   * Whether the transport-layer retry engine (retry.ts) may retransmit the
   * SAME idempotency key after this failure. True ONLY for pre-effect,
   * transient causes (INV-13-3 makes the retransmission collapse at the
   * rail). In-flight failures are NEVER retried by the engine — their
   * external effect is indeterminate, so a retransmission would be a blind
   * guess (the UNKNOWN discipline).
   */
  readonly retryable: boolean;
}

/**
 * The frozen classification table. Pre-effect transient failures (DNS,
 * host unreachable, connect refused, TLS handshake) are retryable; a
 * credential refusal is pre-effect but NOT retryable (retrying cannot fix
 * configuration — fail-closed F6, the operator must intervene); every
 * in-flight failure is non-retryable (indeterminate effect).
 *
 * Source: INV-13-3 (same-key collapse); DEP-005 work order stop condition
 * ("blind UNKNOWN retry" is forbidden — in-flight failures are treated as
 * effect-indeterminate).
 */
export const TRANSPORT_FAILURE_CLASSIFICATION: Readonly<
  Record<RailTransportFailureReason, TransportFailureClassification>
> = Object.freeze({
  DNS_UNRESOLVED: Object.freeze({ phase: 'pre-effect', retryable: true }),
  HOST_UNREACHABLE: Object.freeze({ phase: 'pre-effect', retryable: true }),
  CONNECTION_REFUSED: Object.freeze({ phase: 'pre-effect', retryable: true }),
  TLS_HANDSHAKE_FAILED: Object.freeze({ phase: 'pre-effect', retryable: true }),
  AUTH_CREDENTIAL_REJECTED: Object.freeze({ phase: 'pre-effect', retryable: false }),
  CONNECTION_LOSS_IN_FLIGHT: Object.freeze({ phase: 'in-flight', retryable: false }),
  RESPONSE_MALFORMED: Object.freeze({ phase: 'in-flight', retryable: false }),
});

/** Runtime type guard for the transport-failure taxonomy. */
export function isRailTransportFailureReason(
  value: unknown,
): value is RailTransportFailureReason {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(TRANSPORT_FAILURE_CLASSIFICATION, value)
  );
}

/** The causes an explicit UNKNOWN may carry (the rail answered; the answer is untrustworthy). */
export type RailTransportUnknownCause = 'AMBIGUOUS_RESPONSE' | 'OUTCOME_INDETERMINATE';

// ---------------------------------------------------------------------------
// The explicit result quadruple
// ---------------------------------------------------------------------------

/** Per-call transport telemetry (integer ms — GC-1; measured against the injected clock). */
export interface RailTransportTelemetry {
  /** Wall-clock ms at the moment the result was produced. */
  readonly completedWallMs: number;
  /** How many transport attempts this resolution took (>= 1 once attempted). */
  readonly attempts: number;
  /** The transport's own measured latency for its LAST attempt, in ms. */
  readonly latencyMs: number;
}

/**
 * THE EXPLICIT RESULT QUADRUPLE. Every transport call resolves to exactly
 * one of these — never an exception-as-outcome, never an implicit success.
 *
 *   'delivered-with-report' — exchange completed; `report` is the rail's
 *       answer (its class is the rail's assertion — the boundary never
 *       upgrades it); `duplicate` reports INV-13-3 collapse: FIRST when the
 *       rail took the key for the first time, COLLAPSED when the rail
 *       collapsed a retransmission of the same key+payload.
 *   'timeout' — the deadline elapsed. The result carries the deadline it
 *       violated; it NEVER carries a guessed outcome.
 *   'transport-failure' — the transport failed with a typed reason and its
 *       phase; retry exhaustions surface here with the last failure.
 *   'UNKNOWN' — the rail's answer is unclassifiable/ambiguous. NEVER
 *       translated: the boundary surfaces it upward verbatim and the A14
 *       reconciliation path owns the resolution.
 *
 * Source: DEP-005 work order ("Timeouts and failures are explicit";
 * "External UNKNOWN is never translated to failure or success without
 * reconciliation"); rails-adapters-reconciliation.md lines 42-44, 70-72.
 */
export type RailTransportResult =
  | {
      readonly kind: 'delivered-with-report';
      readonly report: RailReportEnvelope;
      readonly duplicate: 'FIRST' | 'COLLAPSED';
      readonly telemetry: RailTransportTelemetry;
    }
  | {
      readonly kind: 'timeout';
      /** The request deadline that elapsed. */
      readonly deadlineWallMs: number;
      readonly telemetry: RailTransportTelemetry;
    }
  | {
      readonly kind: 'transport-failure';
      readonly reason: RailTransportFailureReason;
      readonly detail: string;
      /** The classification snapshot (phase + retryability) for this failure. */
      readonly classification: TransportFailureClassification;
      readonly telemetry: RailTransportTelemetry;
    }
  | {
      readonly kind: 'UNKNOWN';
      readonly cause: RailTransportUnknownCause;
      readonly detail: string;
      readonly telemetry: RailTransportTelemetry;
    };

/** The result-kind vocabulary (frozen; for guards and audit typing). */
export const RAIL_TRANSPORT_RESULT_KINDS: readonly string[] = Object.freeze([
  'delivered-with-report',
  'timeout',
  'transport-failure',
  'UNKNOWN',
]);

/** Runtime type guard for the result quadruple's kind. */
export function isRailTransportResultKind(value: unknown): value is RailTransportResult['kind'] {
  return (
    value === 'delivered-with-report' ||
    value === 'timeout' ||
    value === 'transport-failure' ||
    value === 'UNKNOWN'
  );
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/**
 * THE TRANSPORT PORT: the connectivity boundary's own interface. The
 * composition root binds the transport primitive — a deterministic
 * in-process double in the evidence harness, the real rail network client
 * in the externalized production deployment (FUTURE-WORK). This port and
 * the frozen adapter interface have the same shape discipline
 * (transmission-and-reporting only: pure data in, explicit data out, no
 * protocol state reachable).
 *
 * Contract of implementors:
 *   - transmit() respects `deadlineWallMs`: a request whose deadline has
 *     elapsed resolves `timeout` (never a guess); a deliverable answer after
 *     the deadline resolves `timeout` as well (the deadline discipline).
 *   - A retransmission of the same (idempotencyKey, payload, payloadHash)
 *     is EXPECTED (the retry engine re-sends the identical triple); the
 *     implementor collapses it at the rail per INV-13-3 and reports
 *     duplicate 'COLLAPSED'.
 *   - fetchReport() NEVER infers CONFIRMED or FAILED from silence — silence
 *     maps to an UNKNOWN envelope (INV-13-4), exactly as the frozen
 *     interface documents.
 */
export interface RailTransportPort {
  /** Hand one transmission to the external rail (deadline-respecting, typed). */
  transmit(request: RailTransportRequest): RailTransportResult;
  /**
   * Fetch the rail's current result report for an idempotency key. Silence
   * maps to UNKNOWN (INV-13-4 — never a guess).
   */
  fetchReport(request: RailReportFetchRequest): RailReportEnvelope;
}

// ---------------------------------------------------------------------------
// The conservative A13 mapping (frozen-vocabulary-only)
// ---------------------------------------------------------------------------

/**
 * The frozen A13 reason code a transport result maps to at the protocol
 * seam. ONLY members of the frozen rails vocabulary
 * (RAILS_REASON_CODES) are ever returned — this boundary adds no protocol
 * reason codes (the vocabulary freeze: "No member may be added without a
 * cited spec line").
 *
 *   timeout            → 'TIMEOUT'           (lines 42-44 — an UNKNOWN cause)
 *   transport-failure  → 'CONNECTION_LOSS'   (lines 42-44 — an UNKNOWN cause)
 *   UNKNOWN            → 'AMBIGUOUS_RAIL_RESPONSE' (lines 42-44)
 *
 * Every transport-level failure maps to the UNKNOWN class at the protocol
 * seam (conservative by design): the boundary's precise taxonomy and retry
 * history live in its own records, and reconciliation — not the transport —
 * resolves indeterminacy.
 *
 * Source: rails/reason-codes.ts (the frozen vocabulary); rails-adapters-
 * reconciliation.md lines 42-44, 70-72, 74-78.
 */
export function frozenA13ReasonCodeForResult(result: RailTransportResult): string {
  switch (result.kind) {
    case 'delivered-with-report':
      // The envelope carries the rail's own asserted class; there is no
      // boundary-minted reason code on the delivered path.
      return result.report.reasonCode ?? '';
    case 'timeout':
      return 'TIMEOUT';
    case 'transport-failure':
      return 'CONNECTION_LOSS';
    case 'UNKNOWN':
      return 'AMBIGUOUS_RAIL_RESPONSE';
  }
}

/**
 * The transport-failure class this result belongs to at the protocol seam:
 * every timeout/failure/UNKNOWN maps to the A13 UNKNOWN class (the
 * conservative mapping — never FAILED, never CONFIRMED). Only
 * adapter-local payload validation (boundary.ts, 'PAYLOAD_MALFORMED') maps
 * to the A13 REJECTED class, mirroring the protocol-owned simulated
 * adapter's discipline exactly.
 *
 * Source: rails-adapters-reconciliation.md lines 74-78 (adapter-local
 * failures map FAILED "before any external effect occurs"; everything after
 * submission maps UNKNOWN); adapters.ts createSimulatedRailAdapter (the
 * in-repository precedent).
 */
export function protocolClassForTransportResult(result: RailTransportResult): 'ACCEPTED' | 'UNKNOWN' {
  return result.kind === 'delivered-with-report' ? 'ACCEPTED' : 'UNKNOWN';
}
