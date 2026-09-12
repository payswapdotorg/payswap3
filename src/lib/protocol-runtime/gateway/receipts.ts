/**
 * RTN-010 — Protocol gateway: the generalized idempotent command receipt.
 *
 * The IntentReceipt pattern, GENERALIZED from area 1 to every protocol
 * command admitted by the gateway. Spec source (binding) —
 * spec/architecture/v0.1/core.md §1 Area 1, lines 43-44:
 *   "IntentReceipt — idempotent response object: intent id, current state,
 *    and recorded outcome for the submitted idempotency key."
 * and the invariant it serves (lines 60-62):
 *   "INV-1-3 (idempotency): re-submission with a recorded idempotency key
 *    returns the recorded receipt; it never creates a second intent or a
 *    second financial effect."
 * RTN-010.md line 10: "idempotent receipts (the IntentReceipt pattern
 * generalized: 'intent id, current state, and recorded outcome for the
 * submitted idempotency key')"; line 15: "Idempotent submission: same
 * command + idempotency key returns the recorded receipt, never a second
 * effect."
 *
 * Generalization mapping (recorded in CONTRACT-REVIEW.md):
 *   IntentReceipt.intentId   -> CommandReceipt.commandId — the derived id
 *                               of the ADMITTED COMMAND (not of an intent):
 *                               deriveProtocolId('gateway-command', kind,
 *                               idempotencyKey). The derivation identity
 *                               mirrors the DEP-003 dedupe identity UNIQUE
 *                               (idempotency_key, kind) — the same pair
 *                               collapses to the same command id, and a
 *                               different kind under the same key is a
 *                               DIFFERENT command (spec/durable/execution.md
 *                               §6 lines 125-133).
 *   IntentReceipt.state      -> CommandReceipt.state — the admission state
 *                               current at recording ('ADMITTED'; admission
 *                               has exactly one non-refusal state).
 *   IntentReceipt.outcome    -> CommandReceipt.outcome — the recorded
 *                               outcome for the submitted idempotency key:
 *                               'ADMITTED' on first admission, 'DUPLICATE'
 *                               when the durable queue absorbed a
 *                               re-submission as a dedupe no-op (created:
 *                               false) after the gateway's receipt memory
 *                               did not hold the key (e.g. a process
 *                               restart between the two submissions).
 *   IntentReceipt.recordedAt -> CommandReceipt.recordedAt — the gateway's
 *                               protocol time at recording.
 *
 * INV-1-3 replay semantics carry over verbatim: re-submission of the same
 * (kind, idempotency key) returns the RECORDED receipt — never a second
 * enqueue, never a second effect. The durable backstop is the queue's own
 * UNIQUE (idempotency_key, kind) row: even across gateway restarts the
 * second enqueue is absorbed (created: false), so at most ONE durable job
 * — and therefore at most one transition-path execution — ever exists per
 * (kind, key).
 */

import { deriveProtocolId } from '../kernel/identity.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { isProtocolTime } from '../kernel/time.ts';

/**
 * The admission state vocabulary: the states a submitted command's
 * admission passes through. 'ADMITTED' is the single non-refusal state —
 * refusals never produce a receipt at all (they produce a typed rejection
 * with an admission reason code and a rejection evidence record).
 *
 * Source: core.md lines 43-44 ("current state" — the state current at
 * recording); RTN-010.md lines 14-15.
 */
export const GATEWAY_ADMISSION_STATES: readonly ['ADMITTED'] = Object.freeze(['ADMITTED'] as const);

/**
 * An admission state. Source: core.md lines 43-44; RTN-010.md lines 14-15.
 */
export type GatewayAdmissionState = (typeof GATEWAY_ADMISSION_STATES)[number];

/**
 * The admission outcome vocabulary for a recorded receipt: 'ADMITTED' (the
 * key's first admission created the durable job) or 'DUPLICATE' (the
 * submission was absorbed by the queue's dedupe — no second effect; a new
 * receipt was recorded because the gateway's in-memory receipt for the key
 * was not present at this submission).
 *
 * Source: core.md lines 43-44 ("recorded outcome for the submitted
 * idempotency key"); spec/durable/execution.md §6 lines 125-129 (the
 * dedupe no-op); RTN-010.md line 15.
 */
export const GATEWAY_ADMISSION_OUTCOMES: readonly ['ADMITTED', 'DUPLICATE'] = Object.freeze([
  'ADMITTED',
  'DUPLICATE',
] as const);

/**
 * A recorded admission outcome. Source: core.md lines 43-44; RTN-010.md
 * line 15.
 */
export type GatewayAdmissionOutcome = (typeof GATEWAY_ADMISSION_OUTCOMES)[number];

/**
 * CommandReceipt — the idempotent response object for a protocol command
 * admitted by the gateway: the generalized IntentReceipt ("command id,
 * current admission state, and recorded outcome for the submitted
 * idempotency key").
 *
 * Source: core.md lines 43-44 (IntentReceipt, generalized per RTN-010.md
 * line 10); INV-1-3 (core.md lines 60-62).
 */
export interface CommandReceipt {
  /** deriveProtocolId('gateway-command', kind, idempotencyKey) — the command's derived id (the generalization of the intent id). */
  readonly commandId: string;
  /** The admission state current at recording ('ADMITTED'). */
  readonly state: GatewayAdmissionState;
  /** The recorded outcome for the submitted idempotency key ('ADMITTED' | 'DUPLICATE'). */
  readonly outcome: GatewayAdmissionOutcome;
  /** The gateway's protocol time at recording. */
  readonly recordedAt: ProtocolTime;
}

/**
 * Derive the command id for one (kind, idempotency key) pair — the
 * deterministic 1:1 generalization of `deriveProtocolId('intent',
 * idempotencyKey)` (intent/authority.ts). The derivation parts are exactly
 * the DEP-003 dedupe identity's two columns, so one (kind, key) pair is
 * one command id, and the pair's two orderings can never collide (the
 * kernel's type-tagged part encoding is unambiguous).
 *
 * Source: INV-1-2/INV-1-3 (core.md lines 57-62); spec/durable/execution.md
 * §6 lines 125-133 (UNIQUE (idempotency_key, kind)); kernel identity.ts
 * (the derivation discipline).
 */
export function commandReceiptId(kind: string, idempotencyKey: string): string {
  return deriveProtocolId('gateway-command', kind, idempotencyKey);
}

/**
 * Mint one command receipt (deep-frozen; the recorded value replayed
 * verbatim on re-submission — INV-1-3's "returns the recorded receipt").
 *
 * Source: core.md lines 43-44, 60-62; RTN-010.md line 15.
 */
export function commandReceipt(input: {
  readonly kind: string;
  readonly idempotencyKey: string;
  readonly state: GatewayAdmissionState;
  readonly outcome: GatewayAdmissionOutcome;
  readonly recordedAt: ProtocolTime;
}): CommandReceipt {
  if (typeof input.kind !== 'string' || input.kind.length === 0) {
    throw new TypeError('gateway receipt: kind must be a non-empty string');
  }
  if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length === 0) {
    throw new TypeError('gateway receipt: idempotencyKey must be a non-empty string');
  }
  if (!(GATEWAY_ADMISSION_STATES as readonly string[]).includes(input.state)) {
    throw new TypeError('gateway receipt: state must be ADMITTED');
  }
  if (!(GATEWAY_ADMISSION_OUTCOMES as readonly string[]).includes(input.outcome)) {
    throw new TypeError('gateway receipt: outcome must be ADMITTED or DUPLICATE');
  }
  if (!isProtocolTime(input.recordedAt)) {
    throw new TypeError('gateway receipt: recordedAt must be a well-formed ProtocolTime');
  }
  return Object.freeze({
    commandId: commandReceiptId(input.kind, input.idempotencyKey),
    state: input.state,
    outcome: input.outcome,
    recordedAt: input.recordedAt,
  });
}

/**
 * Runtime type guard for a recorded CommandReceipt (the five-field shape
 * plus the frozen vocabularies).
 *
 * Source: core.md lines 43-44 (the receipt shape this guard re-checks).
 */
export function isCommandReceipt(value: unknown): value is CommandReceipt {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.commandId === 'string' &&
    candidate.commandId.length > 0 &&
    typeof candidate.state === 'string' &&
    (GATEWAY_ADMISSION_STATES as readonly string[]).includes(candidate.state) &&
    typeof candidate.outcome === 'string' &&
    (GATEWAY_ADMISSION_OUTCOMES as readonly string[]).includes(candidate.outcome) &&
    isProtocolTime(candidate.recordedAt)
  );
}
