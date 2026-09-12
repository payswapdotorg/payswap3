/**
 * DEP-005 — External rail connectivity: the boundary composition — wrapping
 * the transport port + resolved configuration + retry safeguards +
 * activity observability into the FROZEN A13 adapter interface.
 *
 * Owned surface: src/lib/rail-connectivity/boundary.ts (work order DEP-005
 * — "production adapter connectivity/configuration and transport
 * safeguards").
 *
 * THE COMPOSITION (the DEP-004 port-binding precedent: the family depends
 * on its own ports; the composition root binds the real primitives):
 *
 *     resolved rail config (configuration.ts)
 *           + transport port (transport.ts — the primitive the root binds)
 *           + retry safeguards (retry.ts — same-key, bounded, backoff,
 *             deadline-aware, explicitly-retryable-only)
 *           + activity log (activity.ts — structured, queryable, durable
 *             under the 'rail-connectivity' owner)
 *     ────────────────────────────────────────────────────────────────►
 *     createConnectivityRailAdapter(...) : RailAdapterConnection
 *
 * The returned object SATISFIES the frozen interface structurally — the
 * exact `RailAdapterConnection` shape the A13 authority's
 * submitRailOperation / the settlement authority's submitAttempt already
 * consume (the same seam the protocol-owned simulated adapter binds). The
 * frozen interface is imported TYPE-ONLY (erased at load time); the
 * payload-proof hash utility is value-imported from the frozen rails leaf
 * (payload.ts — the established plain-Node leaf-import precedent).
 *
 * WHAT THE BOUNDARY NEVER DOES (the work-order stop conditions, structural):
 *   - It NEVER admits protocol commands: it holds no gateway reference and
 *     imports nothing from the gateway (the sole admission point stays the
 *     protocol-gateway — topology "Runtime ownership").
 *   - It NEVER writes authoritative state: it imports nothing from any
 *     authority, store or persistence module; RailAdapter/RailOperation
 *     state advances only through the A13 command surface
 *     (rtn-plan-rulings.md Q1/delta 1).
 *   - It NEVER performs network egress: the transport primitive is an
 *     injected port; the repository binds deterministic doubles (the real
 *     network client is the externalized FUTURE-WORK binding).
 *   - It NEVER translates UNKNOWN: the UNKNOWN result maps to the A13
 *     UNKNOWN outcome class and surfaces upward for A14 reconciliation.
 *   - It NEVER holds credential values: the resolved config carries the
 *     credential REFERENCE name only.
 *   (All machine-checked by scripts/test_rail_connectivity.mjs.)
 *
 * THE MAPPING TABLE (transport result → frozen A13 outcome; conservative;
 * frozen-vocabulary-only — no new protocol reason codes are ever minted):
 *
 *   delivered-with-report  → ACCEPTED { railReferences: report's refs,
 *                             duplicate: FIRST | COLLAPSED }
 *                             (the report envelope itself is NOT consumed
 *                             here — the A13 command records it through
 *                             its own path; the envelope's class is the
 *                             rail's assertion, INV-13-4)
 *   timeout                → UNKNOWN { reasonCode: 'TIMEOUT' }
 *   transport-failure      → UNKNOWN { reasonCode: 'CONNECTION_LOSS' }
 *                             (pre-effect or in-flight — conservative: the
 *                             precise taxonomy + retry trail live in the
 *                             activity records, not in protocol reason
 *                             codes)
 *   UNKNOWN                → UNKNOWN { reasonCode: 'AMBIGUOUS_RAIL_RESPONSE' }
 *   adapter-local payload  → REJECTED { reasonCode: 'PAYLOAD_MALFORMED' }
 *     validation failure     (hash recompute mismatch — BEFORE any
 *                             transmission; the same discipline the
 *                             protocol-owned simulated adapter applies:
 *                             "adapter-local failures (malformed payload,
 *                             ...) map to FAILED with reason codes before
 *                             any external effect occurs")
 *   fetchReport silence    → UNKNOWN envelope { reasonCode: 'SILENCE',
 *                             railReferences: [], payloadHash: '' }
 *                             (INV-13-4: "Silence or ambiguity maps to
 *                             UNKNOWN")
 *
 * Source: rails-adapters-reconciliation.md lines 21-25 (adapters report
 * back — including UNKNOWN — without owning protocol state), 42-44 (the
 * three UNKNOWN causes), 70-78 (INV-13-4 + failure semantics);
 * rails/adapters.ts (the frozen interface + the simulated-adapter
 * precedent for PAYLOAD_MALFORMED / SILENCE); rails/reason-codes.ts (the
 * frozen vocabulary); topology.md (the adapter boundary rules).
 */

import type {
  RailAdapterConnection,
  RailTransmissionRequest,
  RailTransmissionOutcome,
  RailReportEnvelope,
} from '../protocol-runtime/rails/adapters.ts';
import { hashRailPayload } from '../protocol-runtime/rails/payload.ts';
import type { RailTransportPort, RailTransportResult } from './transport.ts';
import type { RailTransportCorrelation } from './transport.ts';
import type { ResolvedRailConfig, RailConnectivityScopeTag } from './configuration.ts';
import { assertRailScopeMatchesRuntime } from './configuration.ts';
import { transmitWithTransportSafeguards } from './retry.ts';
import type { AdapterActivityLog } from './activity.ts';

// ---------------------------------------------------------------------------
// The adapter-local validation (before ANY transmission)
// ---------------------------------------------------------------------------

/**
 * Adapter-local request validation, BEFORE any transport interaction (the
 * simulated-adapter discipline): the request must be well-formed and its
 * payloadHash must equal the hash recomputed from the payload. A malformed
 * or tampered request is REJECTED with the frozen code
 * 'PAYLOAD_MALFORMED' — "adapter-local failures ... map to FAILED with
 * reason codes before any external effect occurs".
 *
 * Source: rails-adapters-reconciliation.md lines 74-76;
 * rails/adapters.ts validateRequest.
 */
export function validateTransmissionRequest(
  request: RailTransmissionRequest,
): { ok: true } | { ok: false; detail: string } {
  if (request === null || typeof request !== 'object') {
    return { ok: false, detail: 'transmission request must be an object' };
  }
  if (typeof request.idempotencyKey !== 'string' || request.idempotencyKey.length === 0) {
    return { ok: false, detail: 'idempotencyKey must be a non-empty string' };
  }
  if (typeof request.payloadHash !== 'string' || request.payloadHash.length === 0) {
    return { ok: false, detail: 'payloadHash must be a non-empty string' };
  }
  let recomputed: string;
  try {
    recomputed = hashRailPayload(request.payload);
  } catch (error) {
    return {
      ok: false,
      detail: `payload failed adapter-local validation (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  if (recomputed !== request.payloadHash) {
    return {
      ok: false,
      detail: 'payloadHash does not match the payload (tampered or malformed request)',
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The conservative mapping into the frozen A13 outcome vocabulary
// ---------------------------------------------------------------------------

/**
 * Map one safeguarded transport resolution to the frozen
 * RailTransmissionOutcome — the ONLY place the mapping exists (one pure
 * function, machine-checked). Conservative by design: every non-delivered
 * transport resolution maps to the A13 UNKNOWN class with a FROZEN
 * reason code; only the adapter-local payload-validation failure maps to
 * REJECTED (with the frozen 'PAYLOAD_MALFORMED'); only a delivered
 * exchange maps to ACCEPTED. See the module doc's mapping table.
 *
 * Source: rails-adapters-reconciliation.md lines 42-44, 70-78;
 * rails/reason-codes.ts (the frozen vocabulary).
 */
export function mapTransportResultToFrozenOutcome(
  result: RailTransportResult,
  attempts: number,
): RailTransmissionOutcome {
  if (result.kind === 'delivered-with-report') {
    return {
      class: 'ACCEPTED',
      railReferences: [...result.report.railReferences],
      duplicate: result.duplicate,
    };
  }
  // timeout / transport-failure / UNKNOWN → the A13 UNKNOWN class, with
  // the frozen reason codes for the spec's three UNKNOWN causes. The
  // attempt count rides in the detail (evidence, not a guess).
  const detail =
    result.kind === 'timeout'
      ? `transmission deadline ${result.deadlineWallMs} elapsed after ${attempts} attempt(s) — outcome indeterminate (no guess; A14 reconciliation owns resolution)`
      : result.kind === 'transport-failure'
        ? `transport failure [${result.reason}/${result.classification.phase}] after ${attempts} attempt(s): ${result.detail} — outcome indeterminate (no guess; A14 reconciliation owns resolution)`
        : `rail answer indeterminate (${result.cause}) after ${attempts} attempt(s): ${result.detail} — surfaced verbatim for A14 reconciliation (GC-2)`;
  const reasonCode =
    result.kind === 'timeout'
      ? 'TIMEOUT'
      : result.kind === 'transport-failure'
        ? 'CONNECTION_LOSS'
        : 'AMBIGUOUS_RAIL_RESPONSE';
  return { class: 'UNKNOWN', reasonCode, detail };
}

// ---------------------------------------------------------------------------
// The connectivity-bound rail adapter (the frozen interface, satisfied)
// ---------------------------------------------------------------------------

/** Options for one connectivity-bound adapter. */
export interface ConnectivityRailAdapterOptions {
  /** The resolved rail configuration (scope-tagged; frozen at resolution). */
  readonly rail: ResolvedRailConfig;
  /** The transport primitive (the composition root binds the real/double port). */
  readonly transport: RailTransportPort;
  /** The activity log (observability + audit). */
  readonly activity: AdapterActivityLog;
  /** The wall clock (deadline derivation + latency accounting). */
  readonly clock: () => number;
  /** The runtime scope the boundary is being bound in (the scope re-check). */
  readonly runtimeScope: RailConnectivityScopeTag;
  /** The A13 adapter record id this connection runs for (correlation), when bound per-adapter. */
  readonly adapterId?: string;
}

/**
 * Wrap the transport port + resolved configuration into the FROZEN
 * RailAdapterConnection. The returned object is what the A13 authority
 * consumes: same interface, same discipline as the protocol-owned
 * simulated adapter — with the DEP-005 transport safeguards interposed
 * (deadline, typed results, same-key bounded retry, activity records,
 * scope isolation).
 *
 * Behavior:
 *   transmit(request):
 *     1. Scope re-check (belt-and-suspenders #5): the rail's scopeTag must
 *        equal the runtime scope this adapter was bound in.
 *     2. Adapter-local payload validation → REJECTED 'PAYLOAD_MALFORMED'
 *        (before ANY transport interaction).
 *     3. Deadline derivation: deadline = clock() + rail.timeoutDeadlineMs
 *        (the explicit per-rail budget).
 *     4. transmitWithTransportSafeguards — same-key, bounded, backoff,
 *        deadline-aware; every attempt recorded in the activity log.
 *     5. The conservative mapping (mapTransportResultToFrozenOutcome).
 *   fetchReport(key):
 *     The transport's report fetch; silence maps to the UNKNOWN envelope
 *     with the frozen 'SILENCE' code (INV-13-4). Recorded in the activity
 *     log. NEVER infers CONFIRMED or FAILED from silence.
 */
export function createConnectivityRailAdapter(
  options: ConnectivityRailAdapterOptions,
): RailAdapterConnection {
  const { rail, transport, activity, clock } = options;

  // The scope-tag re-check at BINDING time (never bind cross-scope).
  const scopeCheck = assertRailScopeMatchesRuntime(rail, options.runtimeScope);
  if (!scopeCheck.ok) {
    throw new TypeError(`createConnectivityRailAdapter: ${scopeCheck.detail}`);
  }

  const correlationFor = (request: RailTransmissionRequest): RailTransportCorrelation => ({
    instructionId: request.payload.instructionId,
    ...(options.adapterId === undefined ? {} : { adapterId: options.adapterId }),
  });

  return {
    transmit(request: RailTransmissionRequest): RailTransmissionOutcome {
      // 1. Adapter-local validation BEFORE any transport interaction.
      const validation = validateTransmissionRequest(request);
      if (!validation.ok) {
        return { class: 'REJECTED', reasonCode: 'PAYLOAD_MALFORMED', detail: validation.detail };
      }

      // 2. The deadline: absolute, from the per-rail budget (explicit).
      const nowWallMs = clock();
      const deadlineWallMs = nowWallMs + rail.timeoutDeadlineMs;

      // 3. The safeguarded transmission (same-key retry, bounded, backoff,
      //    deadline-aware; every attempt recorded).
      const safeguarded = transmitWithTransportSafeguards({
        port: transport,
        request: {
          railId: rail.railId,
          idempotencyKey: request.idempotencyKey,
          payload: request.payload,
          payloadHash: request.payloadHash,
          correlation: correlationFor(request),
          deadlineWallMs,
        },
        policy: rail.retry,
        clock,
        onAttempt: (record) => {
          activity.recordAttempt({
            rail,
            idempotencyKey: request.idempotencyKey,
            correlation: correlationFor(request),
            attempt: record.attempt,
            retransmission: record.retransmission,
            result: record.result,
            latencyMs: record.result.telemetry.latencyMs,
            wallMs: clock(),
            deadlineWallMs,
          });
        },
      });

      // 4. The conservative mapping into the frozen vocabulary.
      return mapTransportResultToFrozenOutcome(safeguarded.result, safeguarded.attempts.length);
    },

    fetchReport(idempotencyKey: string): RailReportEnvelope {
      const nowWallMs = clock();
      // The transport's report fetch for this key (the payload hash proof
      // is carried from the transmission memory the transport owns).
      const envelope = transport.fetchReport({
        railId: rail.railId,
        idempotencyKey,
        correlation: { instructionId: '*' },
        payloadHash: '',
      });
      activity.recordReportFetch({
        rail,
        idempotencyKey,
        correlation: { instructionId: '*' },
        wallMs: nowWallMs,
        outcomeClass: envelope.outcomeClass,
        ...(envelope.reasonCode === undefined ? {} : { reasonCode: envelope.reasonCode }),
      });
      // The transport's fetchReport contract already maps silence to the
      // UNKNOWN envelope (INV-13-4 — never a guess); the boundary passes
      // the envelope through, re-stamping the wall clock the frozen
      // interface expects.
      return { ...envelope, reportedAtWallMs: nowWallMs };
    },
  };
}

// ---------------------------------------------------------------------------
// The family composition root (one call, all safeguards)
// ---------------------------------------------------------------------------

/** The transport factory: the composition root binds the primitive per rail. */
export type RailTransportFactory = (rail: ResolvedRailConfig) => RailTransportPort;

/** Options for the whole connectivity boundary. */
export interface ConnectivityBoundaryOptions {
  /** The resolved configuration (configuration.ts — scope-tagged, frozen). */
  readonly rails: readonly ResolvedRailConfig[];
  /** The runtime scope (the composition root derives it from PAYSWAP_ENV via the frozen environment module). */
  readonly runtimeScope: RailConnectivityScopeTag;
  /** The transport factory (per-rail primitive binding). */
  readonly transportFactory: RailTransportFactory;
  /** The activity log (shared across the boundary's adapters). */
  readonly activity: AdapterActivityLog;
  /** The wall clock. */
  readonly clock: () => number;
  /** The A13 adapter record ids per rail id (correlation), when bound per-adapter. */
  readonly adapterIds?: Readonly<Record<string, string>>;
}

/** The composed connectivity boundary. */
export interface ConnectivityBoundary {
  /** The runtime scope the boundary is bound in. */
  readonly runtimeScope: RailConnectivityScopeTag;
  /** The frozen RailAdapterConnection per rail id (the A13-consumable seam). */
  readonly adapters: ReadonlyMap<string, RailAdapterConnection>;
  /** The activity log (queryable observability). */
  readonly activity: AdapterActivityLog;
}

/**
 * Compose the whole connectivity boundary: per declared rail, re-check the
 * scope tag, bind the transport primitive and wrap it with all safeguards
 * into the frozen RailAdapterConnection. One rail may never bind outside
 * its scope (the scope re-check throws on mismatch — refuse to start).
 *
 * This is the composition-root form the evidence harness (and the future
 * externalized adapter fleet binding) drives: the family's own ports
 * (transport factory, activity log, clock) bound to real primitives.
 */
export function createConnectivityBoundary(options: ConnectivityBoundaryOptions): ConnectivityBoundary {
  const adapters = new Map<string, RailAdapterConnection>();
  for (const rail of options.rails) {
    // The scope re-check (belt-and-suspenders): refuse cross-scope binding.
    const scopeCheck = assertRailScopeMatchesRuntime(rail, options.runtimeScope);
    if (!scopeCheck.ok) {
      throw new TypeError(`createConnectivityBoundary: ${scopeCheck.detail}`);
    }
    const transport = options.transportFactory(rail);
    adapters.set(
      rail.railId,
      createConnectivityRailAdapter({
        rail,
        transport,
        activity: options.activity,
        clock: options.clock,
        runtimeScope: options.runtimeScope,
        ...(options.adapterIds?.[rail.railId] === undefined
          ? {}
          : { adapterId: options.adapterIds[rail.railId] }),
      }),
    );
  }
  return {
    runtimeScope: options.runtimeScope,
    adapters,
    activity: options.activity,
  };
}
