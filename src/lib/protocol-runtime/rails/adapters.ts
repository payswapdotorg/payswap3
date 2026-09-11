/**
 * RTN-004 — Rails: the adapter interface (TRANSMISSION-AND-REPORTING ONLY)
 * and the protocol-owned simulated rails.
 *
 * ARCHITECT RULING (binding — rtn-plan-rulings.md Q1 / wave delta 1,
 * verbatim):
 *   "the adapter interface (simulated now, real under DEP-005) is strictly
 *    TRANSMISSION-AND-REPORTING: no code path in the adapter interface
 *    creates or mutates RailAdapter/RailOperation state; reports
 *    (RailResultReport) are returned/recorded and state advances only
 *    through the authority's command surface."
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/rails-adapters-reconciliation.md §1 Area 13:
 *     lines 21-25 (Purpose): "Adapters translate protocol-authorized
 *      instructions into external actions and report external results back
 *      — including UNKNOWN — without ever owning protocol financial state."
 *     lines 70-72 (INV-13-4, no guessing): "adapters must map every
 *      submission to exactly one report class; they never infer CONFIRMED
 *      or FAILED from silence. Silence or ambiguity maps to UNKNOWN."
 *     lines 74-78 (failure semantics): "Adapter-local failures (malformed
 *      payload, rail rejection at submission) map to FAILED with reason
 *      codes before any external effect occurs. After submission, any
 *      non-deterministic outcome maps to UNKNOWN"
 *     lines 66-69 (INV-13-3): "where the rail supports idempotency keys,
 *      duplicate submissions at the rail collapse"
 *   spec/deployment/topology.md, external-rail-adapters, Simulation rule:
 *     "development, test/CI, sandbox and staging use protocol-owned
 *      simulated rails — same interface, no external transmission, no real
 *      credentials, no signing capability."
 *   spec/architecture/v0.1/README.md §3 GC-3 (lines 51-55): adapters are the
 *    only external-effect boundary, behind protocol authorization.
 *
 * NO-EGRESS DISCIPLINE (work order stop condition + acceptance):
 *   This module performs ZERO external network transmission. The simulated
 *   rail is an in-process deterministic double. There is no `fetch`, no
 *   socket, no HTTP/TLS/DNS client, and no signing capability anywhere in
 *   this file — machine-checked by tests/adapters.test.ts (static source
 *   scan + behavioral guard patching the network globals). No rail
 *   credentials exist in this source (topology.md: "no real credentials").
 *
 * STATE DISCIPLINE (delta 1):
 *   - This module imports NOTHING from authority.ts, reconciliation.ts,
 *     store.ts, or persistence.ts — it cannot reach protocol state.
 *   - `SimulatedRail` holds the EXTERNAL RAIL's own view (the received-key
 *     ledger an external bank/PSP would have). That is the simulated
 *     outside world, not protocol state: "The external rail is an untrusted
 *     reporter: its data is evidence, not protocol truth" (Area 13, Owning
 *     authority).
 *   - The connection's transmission memory (which key it transmitted, with
 *     which payload hash) is adapter-local transmission bookkeeping.
 *   - NO function in this module takes or returns an authority, a store,
 *     or any RailAdapter/RailOperation record. Every signature is pure
 *     transmission/reporting data.
 */

import type { RailOperationPayload } from './types.ts';
import type { RailReportClass } from './types.ts';
import { canonicalRailPayload, hashRailPayload } from './payload.ts';

// ---------------------------------------------------------------------------
// The transmission request / outcome / report envelope (pure data)
// ---------------------------------------------------------------------------

/**
 * What the authority hands the adapter for transmission: the operation's
 * deterministic rail idempotency key (INV-13-3), its payload (integer Money
 * verbatim — INV-13-2), and the payload hash. The adapter carries no
 * authority semantics — the request IS the protocol-authorized output
 * (GC-3: "transmits exclusively protocol-authorized outputs",
 * deploy/contracts/components.json external-rail-adapters).
 *
 * Source: rails-adapters-reconciliation.md lines 21-25, 63-69.
 */
export interface RailTransmissionRequest {
  readonly idempotencyKey: string;
  readonly payload: RailOperationPayload;
  readonly payloadHash: string;
}

/**
 * The transmission outcome — exactly one of three classes. This is the
 * adapter's complete vocabulary for a submission; the NO-GUESSING mapping
 * to the operation's report class is `submissionReportClass` below.
 *
 *   ACCEPTED — the rail took the request (outcome not yet known: PENDING).
 *   REJECTED — adapter-local failure or rail rejection at submission, with
 *              a reason code, BEFORE any external effect (→ FAILED).
 *   UNKNOWN  — timeout / connection loss / ambiguous response (→ UNKNOWN).
 *
 * Source: rails-adapters-reconciliation.md lines 33-44 (state semantics),
 * 74-78 (failure semantics), 70-72 (INV-13-4).
 */
export type RailTransmissionOutcome =
  | {
      readonly class: 'ACCEPTED';
      readonly railReferences: readonly string[];
      /** FIRST: the rail took this key for the first time; COLLAPSED: the rail collapsed a duplicate submission of the same key+payload (INV-13-3). */
      readonly duplicate: 'FIRST' | 'COLLAPSED';
    }
  | {
      readonly class: 'REJECTED';
      readonly reasonCode: string;
      readonly detail: string;
    }
  | {
      readonly class: 'UNKNOWN';
      readonly reasonCode: string;
      readonly detail: string;
    };

/**
 * The report envelope the adapter returns when the authority asks for the
 * rail's result: the shape of a RailResultReport ("immutable report from
 * the rail: outcome class, rail reference identifiers, timestamp, and
 * payload proof (hash)" — lines 47-48) as pure data. The authority records
 * reports and advances state; the adapter only reports.
 *
 * Source: rails-adapters-reconciliation.md lines 47-48.
 */
export interface RailReportEnvelope {
  readonly outcomeClass: RailReportClass;
  readonly reasonCode?: string;
  readonly railReferences: readonly string[];
  readonly payloadHash: string;
  readonly reportedAtWallMs: number;
}

/**
 * The adapter interface: transmission-and-reporting ONLY (delta 1). Two
 * methods, both pure data-in/data-out; NO code path here creates or mutates
 * RailAdapter/RailOperation state. Real adapters (DEP-005) implement this
 * same interface against real rails with credentials held outside source;
 * non-production environments bind the protocol-owned simulated rails
 * (topology.md simulation rule).
 *
 * Source: rtn-plan-rulings.md Q1 scope impact (delta 1, quoted above);
 * topology.md simulation rule.
 */
export interface RailAdapterConnection {
  /** Hand one protocol-authorized request to the external rail. */
  transmit(request: RailTransmissionRequest): RailTransmissionOutcome;
  /**
   * Fetch the rail's current result report for an idempotency key. NEVER
   * infers CONFIRMED or FAILED from silence — silence maps to UNKNOWN
   * (INV-13-4); an accepted-but-not-final rail maps to PENDING.
   */
  fetchReport(idempotencyKey: string): RailReportEnvelope;
}

/**
 * The INV-13-4 no-guessing mapping, as one pure function: every submission
 * maps to EXACTLY ONE report class.
 *   ACCEPTED  → PENDING  (rail accepted but outcome not yet known — NEVER
 *                         inferred CONFIRMED or FAILED from acceptance)
 *   REJECTED  → FAILED   (adapter-local/rail rejection, before external
 *                         effect)
 *   UNKNOWN   → UNKNOWN  (silence/ambiguity)
 *
 * Source: rails-adapters-reconciliation.md lines 70-72 — "adapters must map
 * every submission to exactly one report class; they never infer CONFIRMED
 * or FAILED from silence. Silence or ambiguity maps to UNKNOWN."
 */
export function submissionReportClass(outcome: RailTransmissionOutcome): RailReportClass {
  switch (outcome.class) {
    case 'ACCEPTED':
      return 'PENDING';
    case 'REJECTED':
      return 'FAILED';
    case 'UNKNOWN':
      return 'UNKNOWN';
  }
}

// ---------------------------------------------------------------------------
// SimulatedRail — the protocol-owned in-process external-rail double
// ---------------------------------------------------------------------------

/**
 * A scripted rail scenario. The simulated rail is DETERMINISTIC: its
 * behavior for a key is a pure function of (script, key, receive state).
 *
 *   ACCEPT_REPORT_CONFIRMED   — rail accepts; statement says CONFIRMED.
 *   ACCEPT_REPORT_FAILED      — rail accepts; statement says FAILED.
 *   ACCEPT_REPORT_UNKNOWN     — rail accepts; later response is ambiguous:
 *                               statement says UNKNOWN.
 *   ACCEPT_NO_REPORT          — rail accepts, never issues a final
 *                               statement (fetch derives PENDING from the
 *                               rail's accepted-not-final ledger state).
 *   REJECT_AT_SUBMISSION      — the rail rejects at submission (no external
 *                               effect occurs).
 *   TRANSMIT_TIMEOUT          — the transmission times out: the rail never
 *                               receives anything (silence → UNKNOWN).
 *   TRANSMIT_CONNECTION_LOSS  — connection lost in flight (→ UNKNOWN).
 *   TRANSMIT_AMBIGUOUS_RESPONSE — the submission response itself is
 *                               ambiguous (→ UNKNOWN).
 *
 * Source: topology.md simulation rule ("same interface, no external
 * transmission"); RTN-004 acceptance — "Simulated rails produce scripted
 * CONFIRMED/FAILED/PENDING/UNKNOWN"; rails-adapters-reconciliation.md
 * lines 42-44 (UNKNOWN causes: "timeout, connection loss, ambiguous rail
 * response").
 */
export type SimulatedRailScenario =
  | 'ACCEPT_REPORT_CONFIRMED'
  | 'ACCEPT_REPORT_FAILED'
  | 'ACCEPT_REPORT_UNKNOWN'
  | 'ACCEPT_NO_REPORT'
  | 'REJECT_AT_SUBMISSION'
  | 'TRANSMIT_TIMEOUT'
  | 'TRANSMIT_CONNECTION_LOSS'
  | 'TRANSMIT_AMBIGUOUS_RESPONSE';

/** Default scenario for keys with no script entry. */
const DEFAULT_SCENARIO: SimulatedRailScenario = 'ACCEPT_NO_REPORT';

interface RailLedgerEntry {
  readonly railReference: string;
  readonly payloadHash: string;
  readonly requestCanonical: string;
}

interface RailReceiveResult {
  readonly kind: 'ACCEPTED';
  readonly railReference: string;
  readonly duplicate: 'FIRST' | 'COLLAPSED';
  readonly scenario: SimulatedRailScenario;
}

/** The rail never received the request: the transmission was lost or
 *  indeterminate in flight (the three TRANSMIT_* scenarios — the spec's
 *  three UNKNOWN causes: "timeout, connection loss, ambiguous rail
 *  response", lines 42-44). The adapter maps this to UNKNOWN. */
interface RailNotReceived {
  readonly kind: 'NOT_RECEIVED';
  readonly scenario: 'TRANSMIT_TIMEOUT' | 'TRANSMIT_CONNECTION_LOSS' | 'TRANSMIT_AMBIGUOUS_RESPONSE';
}

/**
 * The simulated external rail: an in-process, deterministic, CREDENTIAL-FREE
 * double standing in for a bank/PSP/mobile-money/blockchain rail in every
 * non-production environment (topology.md simulation rule).
 *
 * What this object IS: the outside world's own view — which idempotency
 * keys it has seen (with which payload hash), which rail reference it
 * minted per key, and what statement it will issue. "The external rail is
 * an untrusted reporter: its data is evidence, not protocol truth."
 *
 * What this object is NOT: protocol state. It holds no RailAdapter or
 * RailOperation records, knows no authority, and mutates nothing the
 * protocol owns.
 *
 * Determinism: the rail reference for the Nth distinct received key is
 * `simrail.<railId>.<N>`; scenario lookup is by key; there is no clock, no
 * randomness, and no I/O.
 *
 * Source: topology.md simulation rule; rails-adapters-reconciliation.md
 * lines 50-54 (Owning authority), lines 66-69 (INV-13-3 duplicate collapse).
 */
export class SimulatedRail {
  private readonly railId: string;
  private readonly script: Readonly<Record<string, SimulatedRailScenario>>;
  private readonly ledger = new Map<string, RailLedgerEntry>();
  private receiveOrdinal = 0;

  constructor(railId: string, script: Readonly<Record<string, SimulatedRailScenario>> = {}) {
    if (typeof railId !== 'string' || railId.length === 0) {
      throw new TypeError('SimulatedRail: railId must be a non-empty string');
    }
    this.railId = railId;
    this.script = { ...script };
  }

  scenarioFor(idempotencyKey: string): SimulatedRailScenario {
    return this.script[idempotencyKey] ?? DEFAULT_SCENARIO;
  }

  /**
   * The rail-side receive: records the key and mints a rail reference.
   * Duplicate submissions carrying the same key AND the same canonical
   * request COLLAPSE to the original rail reference (INV-13-3: "where the
   * rail supports idempotency keys, duplicate submissions at the rail
   * collapse"). The same key with a DIFFERENT payload is rejected — real
   * rails reject idempotency-key reuse with different content.
   */
  receive(
    request: RailTransmissionRequest,
  ): RailReceiveResult | { readonly kind: 'REJECTED'; readonly detail: string } | RailNotReceived {
    const scenario = this.scenarioFor(request.idempotencyKey);
    if (
      scenario === 'TRANSMIT_TIMEOUT' ||
      scenario === 'TRANSMIT_CONNECTION_LOSS' ||
      scenario === 'TRANSMIT_AMBIGUOUS_RESPONSE'
    ) {
      // The rail never receives the request at all — the transmission is
      // lost/indeterminate in flight. The adapter maps this to UNKNOWN.
      return { kind: 'NOT_RECEIVED', scenario };
    }
    if (scenario === 'REJECT_AT_SUBMISSION') {
      return { kind: 'REJECTED', detail: 'simulated rail rejected the submission' };
    }
    const requestCanonical = canonicalRailPayload(request.payload);
    const existing = this.ledger.get(request.idempotencyKey);
    if (existing !== undefined) {
      if (existing.requestCanonical === requestCanonical && existing.payloadHash === request.payloadHash) {
        return { kind: 'ACCEPTED', railReference: existing.railReference, duplicate: 'COLLAPSED', scenario };
      }
      return {
        kind: 'REJECTED',
        detail: 'idempotency key reused with a different payload — rejected by the rail',
      };
    }
    this.receiveOrdinal += 1;
    const railReference = `simrail.${this.railId}.${this.receiveOrdinal}`;
    this.ledger.set(request.idempotencyKey, {
      railReference,
      payloadHash: request.payloadHash,
      requestCanonical,
    });
    return { kind: 'ACCEPTED', railReference, duplicate: 'FIRST', scenario };
  }

  /**
   * The rail-side statement: what the rail asserts about a key it has seen,
   * or null when the rail has nothing to say (never received, or accepted
   * with no statement yet). The ADAPTER (not the rail) maps null-silence to
   * UNKNOWN — the rail itself stays a dumb double.
   */
  statement(idempotencyKey: string): RailReportEnvelope | null {
    const entry = this.ledger.get(idempotencyKey);
    if (entry === undefined) {
      return null;
    }
    const scenario = this.scenarioFor(idempotencyKey);
    const railReferences = [entry.railReference];
    switch (scenario) {
      case 'ACCEPT_REPORT_CONFIRMED':
        return {
          outcomeClass: 'CONFIRMED',
          railReferences,
          payloadHash: entry.payloadHash,
          reportedAtWallMs: 0,
        };
      case 'ACCEPT_REPORT_FAILED':
        return {
          outcomeClass: 'FAILED',
          railReferences,
          payloadHash: entry.payloadHash,
          reportedAtWallMs: 0,
        };
      case 'ACCEPT_REPORT_UNKNOWN':
        return {
          outcomeClass: 'UNKNOWN',
          reasonCode: 'AMBIGUOUS_RAIL_RESPONSE',
          railReferences,
          payloadHash: entry.payloadHash,
          reportedAtWallMs: 0,
        };
      case 'ACCEPT_NO_REPORT':
      default:
        // Accepted, no final statement: the rail's own state is
        // accepted-not-final — the adapter derives PENDING from this.
        return {
          outcomeClass: 'PENDING',
          railReferences,
          payloadHash: entry.payloadHash,
          reportedAtWallMs: 0,
        };
    }
  }

  /** Read-only view of the rail's received-key ledger (test/evidence use). */
  receivedKeys(): readonly string[] {
    return [...this.ledger.keys()];
  }

  /** Read-only view of the rail's ledger entry for one key, when present. */
  ledgerEntry(idempotencyKey: string): RailLedgerEntry | undefined {
    return this.ledger.get(idempotencyKey);
  }
}

// ---------------------------------------------------------------------------
// The simulated adapter connection (same interface a real adapter binds)
// ---------------------------------------------------------------------------

/**
 * Options for the simulated adapter connection.
 * `wallClock` supplies integer epoch-ms timestamps for report envelopes
 * (the RAIL double itself is clock-free); default is the real wall clock.
 * Inject a fixed clock for deterministic tests.
 */
export interface SimulatedRailAdapterOptions {
  readonly wallClock?: () => number;
}

/**
 * Build the adapter connection bound to a simulated rail — the exact
 * interface a real (DEP-005) adapter would bind, transmitting to the
 * in-process double instead of a network endpoint.
 *
 * Behavior (all deterministic given the rail's script and the clock):
 *   transmit:
 *     1. Adapter-local validation BEFORE any rail interaction: the payload
 *        must be well-formed and the request's payloadHash must equal the
 *        hash recomputed from the payload. A malformed or tampered request
 *        is REJECTED with reason PAYLOAD_MALFORMED — "adapter-local
 *        failures (malformed payload, ...) map to FAILED with reason codes
 *        before any external effect occurs" (lines 74-76).
 *     2. Hand the request to the simulated rail. A rail rejection at
 *        submission is REJECTED with RAIL_REJECTED_SUBMISSION. The three
 *        TRANSMIT_* scenarios are UNKNOWN with their reason codes
 *        (TIMEOUT / CONNECTION_LOSS / AMBIGUOUS_RAIL_RESPONSE — the
 *        spec's three UNKNOWN causes, lines 42-44). Otherwise ACCEPTED
 *        with the rail's references.
 *   fetchReport:
 *     - The rail's statement when it has one.
 *     - A never-received key (or one lost in flight) is SILENCE, and the
 *       adapter maps silence to an UNKNOWN envelope — INV-13-4's exact
 *       sentence: "Silence or ambiguity maps to UNKNOWN."
 *
 * This function creates NO protocol state and mutates none: the connection
 * it returns holds the rail double and its own transmission memory (which
 * key it transmitted with which hash — bookkeeping for reporting), and
 * nothing else. (Delta 1: transmission-and-reporting only.)
 */
export function createSimulatedRailAdapter(
  rail: SimulatedRail,
  options: SimulatedRailAdapterOptions = {},
): RailAdapterConnection {
  const wallClock: () => number = options.wallClock ?? (() => Date.now());
  const transmitted = new Map<string, { readonly payloadHash: string }>();

  const validateRequest = (request: RailTransmissionRequest): string | null => {
    if (request === null || typeof request !== 'object') {
      return 'transmission request must be an object';
    }
    if (typeof request.idempotencyKey !== 'string' || request.idempotencyKey.length === 0) {
      return 'idempotencyKey must be a non-empty string';
    }
    if (typeof request.payloadHash !== 'string' || request.payloadHash.length === 0) {
      return 'payloadHash must be a non-empty string';
    }
    let recomputed: string;
    try {
      recomputed = hashRailPayload(request.payload);
    } catch (error) {
      // Malformed payload (bad Money shape, empty fields, ...): an
      // adapter-local failure BEFORE any rail interaction.
      return `payload failed adapter-local validation (${error instanceof Error ? error.message : String(error)})`;
    }
    if (recomputed !== request.payloadHash) {
      return 'payloadHash does not match the payload (tampered or malformed request)';
    }
    return null;
  };

  return {
    transmit(request: RailTransmissionRequest): RailTransmissionOutcome {
      const problem = validateRequest(request);
      if (problem !== null) {
        return { class: 'REJECTED', reasonCode: 'PAYLOAD_MALFORMED', detail: problem };
      }
      transmitted.set(request.idempotencyKey, { payloadHash: request.payloadHash });
      const received = rail.receive(request);
      if (received.kind === 'NOT_RECEIVED') {
        const reasonCode =
          received.scenario === 'TRANSMIT_TIMEOUT'
            ? 'TIMEOUT'
            : received.scenario === 'TRANSMIT_CONNECTION_LOSS'
              ? 'CONNECTION_LOSS'
              : 'AMBIGUOUS_RAIL_RESPONSE';
        return {
          class: 'UNKNOWN',
          reasonCode,
          detail: `transmission outcome indeterminate (${received.scenario})`,
        };
      }
      if (received.kind === 'REJECTED') {
        return {
          class: 'REJECTED',
          reasonCode: 'RAIL_REJECTED_SUBMISSION',
          detail: received.detail,
        };
      }
      return {
        class: 'ACCEPTED',
        railReferences: [received.railReference],
        duplicate: received.duplicate,
      };
    },

    fetchReport(idempotencyKey: string): RailReportEnvelope {
      const statement = rail.statement(idempotencyKey);
      if (statement !== null) {
        return { ...statement, reportedAtWallMs: wallClock() };
      }
      // SILENCE — never a guess: the adapter maps silence to UNKNOWN
      // (INV-13-4). The payload hash comes from the adapter's transmission
      // memory for this key (empty when the adapter never transmitted it).
      const memory = transmitted.get(idempotencyKey);
      return {
        outcomeClass: 'UNKNOWN',
        reasonCode: 'SILENCE',
        railReferences: [],
        payloadHash: memory?.payloadHash ?? '',
        reportedAtWallMs: wallClock(),
      };
    },
  };
}
