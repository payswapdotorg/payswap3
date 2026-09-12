/**
 * RTN-007 — Credit Authority: the A07 type vocabulary, state machine
 * tables, record shapes, and runtime guards.
 *
 * Spec sources (binding) — spec/architecture/v0.1/liquidity-credit-queues.md
 * §2 Area 7:
 *   lines 95-111 (Core objects and state, verbatim):
 *     "CreditLine — agreement extending fulfillment capacity against
 *      future repayment.
 *      States: OFFERED -> ACTIVE -> SUSPENDED -> terminal(CLOSED).
 *      Suspension blocks new reservations; closure is terminal after
 *      outstanding exposure is settled or written off (areas 10, 12)."
 *     "CreditExposure — current outstanding amount (Money, integer) on a
 *      credit line, mutated only through area 5 reservations tied to
 *      obligations from clearing (area 9)."
 *     "CreditDecision — deterministic evaluation result for a requested
 *      credit usage.
 *      States: EVALUATED -> APPLIED.
 *      Outcome: APPROVED with approved amount, or DENIED with reason
 *      code. No partial ambiguity: an approval names an exact integer
 *      amount."
 *   lines 113-114 (Owning authority):
 *     "Credit Authority (protocol layer, area 7) owns lines, exposure,
 *      and decision semantics."
 *   lines 116-127 (INV-7-1 / INV-7-2 / INV-7-3, quoted in the enforcing
 *     modules: exposure.ts, authority.ts, and the decision-key derivation
 *     below).
 *   lines 129-136 (failure and UNKNOWN semantics — internal and
 *     deterministic, no UNKNOWN state; repayment UNKNOWN leaves exposure
 *     unchanged until reconciliation).
 *   lines 138-140 (evidence produced — CREDIT_LINE_STATE_CHANGED,
 *     CREDIT_DECIDED, EXPOSURE_CHANGED).
 *   lines 142-149 (boundaries — credit never moves money externally;
 *     "Credit policy parameters are inputs; this area defines semantics,
 *     not business parameters"; "Depends on areas 5, 9, 10, 12, 14").
 *   spec/architecture/v0.1/README.md §3 GC-1/GC-4/GC-5.
 *   spec/registry/protocol-registry.json A07 — owningAuthority:
 *     "Credit Authority".
 *   spec/architecture/v0.1/core.md §5 Area 5 lines 335-336 ("Depends on
 *     areas 6, 7, and 3 as resource owners" — the credit line IS the
 *     area-5 resource this domain declares, with declared total = the
 *     line limit).
 *
 * Transition-table interpretation (recorded in CONTRACT-REVIEW.md): the
 * v0.1 chain is materialized EXACTLY as written:
 *   - CreditLine: OFFERED -> ACTIVE -> SUSPENDED -> terminal(CLOSED).
 *     No SUSPENDED -> ACTIVE resume edge and no OFFERED -> CLOSED
 *     withdrawal edge (resumption is a new line — a new agreement; the
 *     exact one-way chain). Closure only from SUSPENDED, and only when
 *     the line's exposure is exactly zero ("outstanding exposure is
 *     settled or written off").
 *   - CreditDecision: EVALUATED -> APPLIED. A DENIED decision never
 *     applies (nothing to apply — it is the recorded terminal outcome of
 *     the evaluation); an APPROVED decision applies exactly once (the
 *     area-5 reservation hold).
 */

import type { Money } from '../kernel/money.ts';
import type { ProtocolTime } from '../kernel/time.ts';

/**
 * The CreditLine state vocabulary, verbatim from the v0.1 chain.
 *
 * Source: liquidity-credit-queues.md lines 97-99 — "States: OFFERED ->
 * ACTIVE -> SUSPENDED -> terminal(CLOSED)."
 */
export const CREDIT_LINE_STATES: readonly [
  'OFFERED',
  'ACTIVE',
  'SUSPENDED',
  'CLOSED',
] = Object.freeze(['OFFERED', 'ACTIVE', 'SUSPENDED', 'CLOSED'] as const);

/**
 * A CreditLine state. CLOSED is terminal ("terminal(CLOSED)").
 *
 * Source: liquidity-credit-queues.md lines 97-99.
 */
export type CreditLineState = (typeof CREDIT_LINE_STATES)[number];

/**
 * The frozen one-way CreditLine transition table — the exact v0.1 chain.
 * "Suspension blocks new reservations" (the authority's command surface
 * denies new usage on SUSPENDED and non-ACTIVE lines); closure requires
 * SUSPENDED with exposure exactly zero.
 *
 * Source: liquidity-credit-queues.md lines 97-100.
 */
export const CREDIT_LINE_TRANSITIONS: Readonly<
  Record<CreditLineState, readonly CreditLineState[]>
> = Object.freeze({
  OFFERED: Object.freeze(['ACTIVE'] as const),
  ACTIVE: Object.freeze(['SUSPENDED'] as const),
  SUSPENDED: Object.freeze(['CLOSED'] as const),
  CLOSED: Object.freeze([] as const),
});

/**
 * Runtime type guard for CreditLineState.
 *
 * Source: liquidity-credit-queues.md lines 97-99 (the vocabulary this
 * guard re-checks).
 */
export function isCreditLineState(value: unknown): value is CreditLineState {
  return typeof value === 'string' && (CREDIT_LINE_STATES as readonly string[]).includes(value);
}

/**
 * True iff the (from, to) pair is a legal one-way CreditLine transition.
 *
 * Source: liquidity-credit-queues.md lines 97-99 (the chain this table
 * materializes).
 */
export function canTransitionCreditLine(from: CreditLineState, to: CreditLineState): boolean {
  return CREDIT_LINE_TRANSITIONS[from].includes(to);
}

/**
 * The CreditDecision state vocabulary, verbatim from the v0.1 chain.
 *
 * Source: liquidity-credit-queues.md lines 107-108 — "States: EVALUATED
 * -> APPLIED."
 */
export const CREDIT_DECISION_STATES: readonly ['EVALUATED', 'APPLIED'] = Object.freeze([
  'EVALUATED',
  'APPLIED',
] as const);

/**
 * A CreditDecision state. APPLIED is reached exactly once — when the
 * decision's area-5 reservation is HELD (the atomic capacity commit).
 *
 * Source: liquidity-credit-queues.md lines 107-108, 90-92 ("Credit
 * decisions are pure evaluations; the resulting capacity is held via
 * area 5 reservations like any other resource").
 */
export type CreditDecisionState = (typeof CREDIT_DECISION_STATES)[number];

/**
 * Runtime type guard for CreditDecisionState.
 *
 * Source: liquidity-credit-queues.md lines 107-108.
 */
export function isCreditDecisionState(value: unknown): value is CreditDecisionState {
  return typeof value === 'string' && (CREDIT_DECISION_STATES as readonly string[]).includes(value);
}

/**
 * The A07 reason-code vocabulary — the machine-readable codes the
 * CREDIT_LINE_STATE_CHANGED, CREDIT_DECIDED, and EXPOSURE_CHANGED
 * records' outcome slots carry. Members (each grounded, see
 * CONTRACT-REVIEW.md):
 *   - LINE_OFFERED / LINE_ACTIVATED / LINE_SUSPENDED_BLOCKS_NEW_RESERVATIONS
 *     / LINE_CLOSED_EXPOSURE_SETTLED — the line-state records' reasons
 *     (lines 97-100).
 *   - LINE_NOT_ACTIVE / INSUFFICIENT_REMAINING_LIMIT — the DENIED
 *     decision reasons ("Suspension blocks new reservations", lines
 *     99-100; "exposure never exceeds the line limit", INV-7-1 lines
 *     119-121).
 *   - EXPOSURE_HELD / EXPOSURE_CONSUMED / EXPOSURE_RELEASED /
 *     EXPOSURE_EXPIRED — the driving area-5 ledger event behind an
 *     EXPOSURE_CHANGED record ("mutated only through area 5
 *     reservations", lines 101-104).
 *
 * Source: liquidity-credit-queues.md lines 97-127, 138-140; A15 line 30
 * ("outcome: resulting state or decision, including reason codes").
 */
export const CREDIT_REASON_CODES: readonly [
  'LINE_OFFERED',
  'LINE_ACTIVATED',
  'LINE_SUSPENDED_BLOCKS_NEW_RESERVATIONS',
  'LINE_CLOSED_EXPOSURE_SETTLED',
  'LINE_NOT_ACTIVE',
  'INSUFFICIENT_REMAINING_LIMIT',
  'EXPOSURE_HELD',
  'EXPOSURE_CONSUMED',
  'EXPOSURE_RELEASED',
  'EXPOSURE_EXPIRED',
] = Object.freeze([
  'LINE_OFFERED',
  'LINE_ACTIVATED',
  'LINE_SUSPENDED_BLOCKS_NEW_RESERVATIONS',
  'LINE_CLOSED_EXPOSURE_SETTLED',
  'LINE_NOT_ACTIVE',
  'INSUFFICIENT_REMAINING_LIMIT',
  'EXPOSURE_HELD',
  'EXPOSURE_CONSUMED',
  'EXPOSURE_RELEASED',
  'EXPOSURE_EXPIRED',
] as const);

/** An A07 reason code. Source: the frozen vocabulary above. */
export type CreditReasonCode = (typeof CREDIT_REASON_CODES)[number];

/**
 * Runtime type guard for CreditReasonCode.
 *
 * Source: A15 line 30 (the reason-code contract this guards).
 */
export function isCreditReasonCode(value: unknown): value is CreditReasonCode {
  return typeof value === 'string' && (CREDIT_REASON_CODES as readonly string[]).includes(value);
}

/**
 * CreditLine — agreement extending fulfillment capacity against future
 * repayment. The limit is the area-5 ledger resource's declared total
 * (resourceId = `credit-line:<lineId>` — core.md lines 335-336), so
 * INV-7-1 ("exposure never exceeds the line limit") is exactly the
 * ledger's INV-5-1 available >= 0 — atomic under area-5 serialization by
 * construction.
 *
 * Source: liquidity-credit-queues.md lines 96-100; INV-7-1 lines 119-121.
 */
export interface CreditLineRecord {
  readonly lineId: string;
  /** The line limit — integer Money; the ledger resource's declared total. */
  readonly limit: Money;
  readonly state: CreditLineState;
  readonly offeredAt: ProtocolTime;
  readonly stateChangedAt: ProtocolTime;
}

/**
 * CreditExposure — the current outstanding amount on a credit line: the
 * integer sum of the line's ledger resource accounting (held + consumed),
 * i.e. every unit of capacity currently extended (reserved or settled
 * into obligations) and not yet repaid. Mutated only through area 5
 * reservations: every change is a ledger transition on the line's
 * resource (INV-7-2's per-line serialization is the ledger's per-resource
 * order).
 *
 * Source: liquidity-credit-queues.md lines 101-104; INV-7-1 lines
 * 119-121; INV-7-2 lines 122-124.
 */
export interface CreditExposureView {
  readonly lineId: string;
  readonly limit: Money;
  /** The ledger resource's held total (reserved capacity). */
  readonly reserved: Money;
  /** The ledger resource's consumed total (capacity settled into obligations). */
  readonly consumed: Money;
  /** The current outstanding amount: reserved + consumed (INV-7-1: <= limit). */
  readonly exposure: Money;
  /** limit - exposure (the remaining extendable capacity). */
  readonly remaining: Money;
}

/**
 * The outcome of one CreditDecision — "APPROVED with approved amount, or
 * DENIED with reason code. No partial ambiguity: an approval names an
 * exact integer amount."
 *
 * Source: liquidity-credit-queues.md lines 109-111.
 */
export type CreditDecisionOutcome =
  | {
      readonly kind: 'APPROVED';
      /** The exact integer amount the approval names (never partial). */
      readonly approvedAmount: Money;
    }
  | {
      readonly kind: 'DENIED';
      readonly reason: CreditReasonCode;
    };

/**
 * CreditDecision — deterministic evaluation result for a requested credit
 * usage, keyed by (intent id, line id) (INV-7-3): the decision id is
 * deriveProtocolId('credit-decision', intentId, lineId), so the same key
 * always returns the same recorded decision. EVALUATED is the recorded
 * evaluation; APPLIED is reached exactly once, when the decision's
 * capacity is held via the area-5 reservation (the atomic INV-7-1
 * check-and-hold).
 *
 * Source: liquidity-credit-queues.md lines 105-111; INV-7-3 lines
 * 125-127.
 */
export interface CreditDecisionRecord {
  readonly decisionId: string;
  readonly intentId: string;
  readonly lineId: string;
  readonly state: CreditDecisionState;
  readonly outcome: CreditDecisionOutcome;
  /** The ledger reservation that applied the decision (set at apply). */
  readonly reservationId?: string;
  readonly evaluatedAt: ProtocolTime;
  readonly appliedAt?: ProtocolTime;
}

/**
 * The typed rejection codes of the Credit Authority's command surface
 * (domain rejections are typed values, never thrown — the merged rails
 * command convention). Rejections emit NO evidence: a refused command
 * mutates no state, and A07's named evidence set is exhaustive.
 *
 * Source: liquidity-credit-queues.md lines 138-140 (the exhaustive named
 * set); the rails typed-rejection convention.
 */
export const CREDIT_REJECTION_CODES: readonly [
  'LINE_NOT_FOUND',
  'LINE_NOT_ACTIVE',
  'DECISION_NOT_FOUND',
  'DECISION_NOT_APPROVED',
  'DECISION_ALREADY_APPLIED',
  'ILLEGAL_TRANSITION',
  'INSUFFICIENT_REMAINING_LIMIT',
  'UNIT_MISMATCH',
  'EXPOSURE_OUTSTANDING',
  'RESERVATION_NOT_OWNED',
] = Object.freeze([
  'LINE_NOT_FOUND',
  'LINE_NOT_ACTIVE',
  'DECISION_NOT_FOUND',
  'DECISION_NOT_APPROVED',
  'DECISION_ALREADY_APPLIED',
  'ILLEGAL_TRANSITION',
  'INSUFFICIENT_REMAINING_LIMIT',
  'UNIT_MISMATCH',
  'EXPOSURE_OUTSTANDING',
  'RESERVATION_NOT_OWNED',
] as const);

/** A Credit Authority rejection code. Source: the frozen list above. */
export type CreditRejectionCode = (typeof CREDIT_REJECTION_CODES)[number];

/**
 * Runtime type guard for CreditRejectionCode.
 *
 * Source: the typed-rejection convention (the frozen list above).
 */
export function isCreditRejectionCode(value: unknown): value is CreditRejectionCode {
  return typeof value === 'string' && (CREDIT_REJECTION_CODES as readonly string[]).includes(value);
}

/**
 * The command-result convention of the Credit Authority: the updated
 * record on success (replayed: true for an idempotent replay of an
 * already-recorded effect — no second effect, no second evidence
 * record), or a typed rejection.
 *
 * Source: INV-7-3 lines 125-127 (the key replay); the merged typed-result
 * convention.
 */
export type CreditCommandResult<T> =
  | {
      readonly ok: true;
      readonly replayed: boolean;
      readonly record: T;
    }
  | {
      readonly ok: false;
      readonly code: CreditRejectionCode;
      readonly problem: string;
    };

/**
 * The outcome of applyCreditDecision: the applied decision with its
 * reservation (the capacity hold), or a typed rejection — an apply whose
 * atomic hold failed (INSUFFICIENT_REMAINING_LIMIT) leaves the decision
 * EVALUATED and retryable (the recorded decision is immutable — INV-7-3).
 *
 * Source: liquidity-credit-queues.md lines 90-92 ("the resulting capacity
 * is held via area 5 reservations"); INV-7-1 lines 119-121 (the atomic
 * check); INV-7-3 lines 125-127.
 */
export type ApplyCreditDecisionResult =
  | {
      readonly ok: true;
      readonly replayed: boolean;
      readonly decision: CreditDecisionRecord;
      readonly reservationId: string;
    }
  | {
      readonly ok: false;
      readonly code: CreditRejectionCode;
      readonly problem: string;
    };
