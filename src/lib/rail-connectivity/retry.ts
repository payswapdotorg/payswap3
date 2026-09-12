/**
 * DEP-005 — External rail connectivity: the transport retry/deadline
 * safeguard engine (pure).
 *
 * Owned surface: src/lib/rail-connectivity/retry.ts (work order DEP-005 —
 * "Retries respect existing idempotency rules"; forbidden: "blind UNKNOWN
 * retry").
 *
 * THE SAFEGUARD CONTRACT this module enforces, structurally:
 *
 *   1. SAME-KEY RETRANSMISSION ONLY — a retransmission re-sends the
 *      EXACT (idempotencyKey, payload, payloadHash) triple of the request;
 *      the engine never re-derives, mutates or mints a new identity. This
 *      is what makes transport-layer retry safe: INV-13-3 ("where the rail
 *      supports idempotency keys, duplicate submissions at the rail
 *      collapse") — the rail collapses the duplicate; there is never a
 *      second external effect for one key.
 *
 *   2. BOUNDED — at most `maxAttempts` attempts (hard-capped at
 *      MAX_RETRY_ATTEMPTS_BOUND by configuration.ts). No infinite retry.
 *
 *   3. BACKOFF — the delay before retransmission N is the pure
 *      exponential function min(backoffBaseMs * 2^(N-1), backoffMaxMs)
 *      (transportBackoffDelayMs below). Deterministic: the same failure
 *      history always produces the same delay.
 *
 *   4. DEADLINE-AWARE — the engine measures every decision against the
 *      request's ABSOLUTE deadline: a retransmission is issued only when
 *      now + backoff still leaves room before the deadline; a deadline
 *      already elapsed (before the first attempt, or after a failure)
 *      resolves `timeout` / surfaces the failure — never a guess, never an
 *      attempt past the deadline.
 *
 *   5. EXPLICITLY-RETRYABLE FAILURES ONLY — the engine retransmits ONLY
 *      after a `transport-failure` whose frozen classification is BOTH
 *      pre-effect AND retryable (TRANSPORT_FAILURE_CLASSIFICATION). A
 *      credential refusal (pre-effect, not retryable) surfaces immediately
 *      — retrying cannot fix configuration (F6). An in-flight failure
 *      (indeterminate external effect) is NEVER retried: retransmitting
 *      after an indeterminate-effect failure would be a blind guess.
 *
 *   6. UNKNOWN AND TIMEOUT ARE NEVER RETRIED — an explicit UNKNOWN result
 *      returns IMMEDIATELY and surfaces upward verbatim (the A14
 *      reconciliation path owns resolution — GC-2/INV-13-4; the work-order
 *      stop condition "blind UNKNOWN retry"); a timeout returns
 *      immediately (the deadline is exhausted by definition).
 *
 * The engine is a PURE function of (port, request, policy, clock): no
 * sleeping, no timers — the backoff is COMPUTED and checked against the
 * injected clock (deterministic under test; the externalized transport
 * binding applies the computed delay in the FUTURE-WORK async form). Every
 * attempt is reported through the onAttempt callback so the activity log
 * (activity.ts) records the full trail (rail, key, outcome, latency,
 * correlation, typed reason, attempt ordinal) — the observability contract.
 *
 * Spec sources (binding): spec/system-work-orders/DEP-005.md ("Retries
 * respect existing idempotency rules"; forbidden: blind UNKNOWN retry);
 * spec/architecture/v0.1/rails-adapters-reconciliation.md lines 45-46
 * ("UNKNOWN: ... This is a durable state; adapters MUST NOT resolve UNKNOWN
 * by re-submission."), lines 66-69 (INV-13-3 idempotency-key collapse),
 * lines 70-72 (INV-13-4 no guessing); spec/deployment/topology.md (the
 * adapter boundary rules).
 */

import type {
  RailTransportPort,
  RailTransportRequest,
  RailTransportResult,
} from './transport.ts';
import type { RailRetryPolicy } from './configuration.ts';

// ---------------------------------------------------------------------------
// The pure backoff schedule
// ---------------------------------------------------------------------------

/**
 * The exponential-backoff delay before retransmission attempt N (N >= 1,
 * counting retransmissions): min(backoffBaseMs * 2^(N-1), backoffMaxMs).
 * Pure and deterministic — the same (policy, attempt) always yields the
 * same delay.
 *
 * Source: the bounded/backoff/deadline-aware retry acceptance (DEP-005.md).
 */
export function transportBackoffDelayMs(policy: RailRetryPolicy, retransmissionOrdinal: number): number {
  if (retransmissionOrdinal < 1) {
    throw new TypeError('transportBackoffDelayMs: retransmissionOrdinal must be >= 1');
  }
  // Shift-safe doubling: cap the exponent so 2^(N-1) cannot overflow.
  const exponent = Math.min(retransmissionOrdinal - 1, 30);
  const raw = policy.backoffBaseMs * 2 ** exponent;
  return Math.min(raw, policy.backoffMaxMs);
}

// ---------------------------------------------------------------------------
// The pure retry decision
// ---------------------------------------------------------------------------

/** The decision the engine makes after one attempt's result. */
export type TransportRetryDecision =
  | { readonly action: 'return' }
  | { readonly action: 'retransmit'; readonly backoffMs: number };

/**
 * The PURE retry decision after one attempt: retransmit iff ALL hold —
 *   (a) the result is a transport-failure (never UNKNOWN, never timeout,
 *       never delivered);
 *   (b) its frozen classification is pre-effect AND retryable (explicitly
 *       retryable — the conservative rule);
 *   (c) attempts remain under the bound (bounded);
 *   (d) now + backoff < deadline (deadline-aware: the retransmission and
 *       its answer must fit inside the budget).
 * Otherwise the result surfaces (return).
 *
 * Source: DEP-005.md ("Retries respect existing idempotency rules";
 * forbidden "blind UNKNOWN retry"); INV-13-3.
 */
export function decideTransportRetry(input: {
  readonly result: RailTransportResult;
  readonly attemptsUsed: number;
  readonly policy: RailRetryPolicy;
  readonly nowWallMs: number;
  readonly deadlineWallMs: number;
}): TransportRetryDecision {
  const { result, attemptsUsed, policy, nowWallMs, deadlineWallMs } = input;
  if (result.kind !== 'transport-failure') {
    // UNKNOWN and timeout are NEVER retried; delivered is done. The
    // no-blind-retry rule is structural: this branch returns immediately
    // for every non-retryable outcome class.
    return { action: 'return' };
  }
  if (!result.classification.retryable || result.classification.phase !== 'pre-effect') {
    return { action: 'return' };
  }
  if (attemptsUsed >= policy.maxAttempts) {
    return { action: 'return' };
  }
  const backoffMs = transportBackoffDelayMs(policy, attemptsUsed);
  if (nowWallMs + backoffMs >= deadlineWallMs) {
    // Deadline-aware: the retransmission would begin at/after the deadline.
    return { action: 'return' };
  }
  return { action: 'retransmit', backoffMs };
}

// ---------------------------------------------------------------------------
// The attempt trail (the observability contract's raw material)
// ---------------------------------------------------------------------------

/** One recorded attempt of one safeguarded transmission. */
export interface TransportAttemptRecord {
  /** 1-based attempt ordinal. */
  readonly attempt: number;
  /** True when this attempt was a retransmission of the same key (INV-13-3). */
  readonly retransmission: boolean;
  readonly result: RailTransportResult;
  /** The request's idempotency key (identical on every attempt — asserted). */
  readonly idempotencyKey: string;
}

/** The engine's final resolution: the last result + the full attempt trail. */
export interface SafeguardedTransmission {
  readonly request: RailTransportRequest;
  readonly result: RailTransportResult;
  readonly attempts: readonly TransportAttemptRecord[];
  /** Total wall-clock ms the safeguarded transmission spanned (>= 0). */
  readonly totalLatencyMs: number;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * Run one transmission under the safeguards. The engine is the ONLY place
 * the boundary retransmits, and it retransmits the request VERBATIM (same
 * idempotencyKey, same payload, same payloadHash — never re-derived).
 *
 * Discipline (structurally enforced):
 *   - UNKNOWN → returned immediately (never retried, never translated);
 *   - timeout → returned immediately (deadline exhausted);
 *   - delivered-with-report → returned;
 *   - transport-failure → retransmit ONLY per decideTransportRetry
 *     (pre-effect + retryable + bounded + deadline room); otherwise
 *     surfaced with the typed reason.
 *
 * `onAttempt` receives every attempt as it happens (the activity log's
 * hook); `clock` supplies the deterministic time (deadline checks and
 * latency accounting).
 */
export function transmitWithTransportSafeguards(input: {
  readonly port: RailTransportPort;
  readonly request: RailTransportRequest;
  readonly policy: RailRetryPolicy;
  readonly clock: () => number;
  readonly onAttempt?: (record: TransportAttemptRecord) => void;
}): SafeguardedTransmission {
  const { port, request, policy, clock, onAttempt } = input;
  const attempts: TransportAttemptRecord[] = [];
  const startedWallMs = clock();

  // The deadline guard before the FIRST attempt: an already-elapsed
  // deadline resolves timeout without issuing anything (no guessing).
  if (startedWallMs >= request.deadlineWallMs) {
    const result: RailTransportResult = {
      kind: 'timeout',
      deadlineWallMs: request.deadlineWallMs,
      telemetry: { completedWallMs: startedWallMs, attempts: 0, latencyMs: 0 },
    };
    return { request, result, attempts, totalLatencyMs: 0 };
  }

  let attemptsUsed = 0;
  let result: RailTransportResult | undefined;

  // The bounded loop: at most policy.maxAttempts transmissions.
  for (let attemptOrdinal = 1; attemptOrdinal <= policy.maxAttempts; attemptOrdinal += 1) {
    const attemptStartedWallMs = clock();
    // Per-attempt deadline guard: never issue an attempt at/past the deadline.
    if (attemptStartedWallMs >= request.deadlineWallMs) {
      result = {
        kind: 'timeout',
        deadlineWallMs: request.deadlineWallMs,
        telemetry: {
          completedWallMs: attemptStartedWallMs,
          attempts: attemptsUsed,
          latencyMs: Math.max(0, attemptStartedWallMs - startedWallMs),
        },
      };
      break;
    }

    // SAME-KEY retransmission: the request object is passed verbatim —
    // idempotencyKey, payload and payloadHash are byte-identical across
    // every attempt (INV-13-3's collapse precondition; machine-checked by
    // the harness on the port side).
    const attemptResult = port.transmit(request);
    attemptsUsed += 1;
    const completedWallMs = clock();

    const record: TransportAttemptRecord = {
      attempt: attemptOrdinal,
      retransmission: attemptOrdinal > 1,
      result: attemptResult,
      idempotencyKey: request.idempotencyKey,
    };
    attempts.push(record);
    onAttempt?.(record);

    // The terminal classes: UNKNOWN never retried (surfaces upward for
    // A14 reconciliation); timeout (deadline exhausted in-transport) and
    // delivered return immediately.
    if (
      attemptResult.kind === 'UNKNOWN' ||
      attemptResult.kind === 'timeout' ||
      attemptResult.kind === 'delivered-with-report'
    ) {
      result = attemptResult;
      break;
    }

    // A transport-failure: apply the pure decision.
    const decision = decideTransportRetry({
      result: attemptResult,
      attemptsUsed,
      policy,
      nowWallMs: completedWallMs,
      deadlineWallMs: request.deadlineWallMs,
    });
    if (decision.action === 'return') {
      result = attemptResult;
      break;
    }
    // 'retransmit': the loop continues; the computed backoff is accounted
    // against the deadline in decideTransportRetry (deadline-aware). The
    // engine itself never sleeps (pure); the next attempt begins when the
    // transport binding schedules it — the clock measures the whole span.
  }

  if (result === undefined) {
    // Unreachable: maxAttempts >= 1 (validated by configuration.ts); the
    // loop always runs at least one attempt or breaks on the deadline
    // guards. Kept total for the type system.
    throw new TypeError(
      'transmitWithTransportSafeguards: the bounded loop produced no result (maxAttempts must be >= 1)',
    );
  }

  const completedWallMs = clock();
  return {
    request,
    result,
    attempts: Object.freeze(attempts),
    totalLatencyMs: Math.max(0, completedWallMs - startedWallMs),
  };
}
