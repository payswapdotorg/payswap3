/**
 * RTN-009 — Settlement and Finality Authority: the A12 type vocabulary —
 * the SettlementInstruction, SettlementAttempt, and FinalityRecord state
 * machines, the settlement subject, the record shapes, and the typed
 * rejection codes.
 *
 * Spec sources (binding) — spec/architecture/v0.1/
 * clearing-netting-settlement.md §4 Area 12:
 *   lines 211-218 (Purpose, verbatim):
 *     "Define how net obligations are executed externally through rail
 *      adapters, how results (including UNKNOWN) are handled, and how
 *      finality — the irreversible endpoint of a financial obligation — is
 *      declared solely by the protocol."
 *   lines 220-240 (Core objects and state, verbatim):
 *     "SettlementInstruction — protocol authorization to move value
 *      externally for one obligation or net position.
 *      States: CREATED -> ISSUED -> terminal(CONFIRMED | FAILED).
 *      ISSUED means a rail operation exists (area 13).
 *
 *      SettlementAttempt — one authorized external attempt for one
 *      instruction.
 *      States: CREATED -> SUBMITTED -> PENDING |
 *      terminal(CONFIRMED | FAILED | UNKNOWN).
 *      Exactly one attempt is authorized at a time per instruction; a
 *      second attempt requires the first to be terminally resolved via
 *      reconciliation.
 *
 *      FinalityRecord — protocol declaration that value movement is
 *      irreversible.
 *      States: PROVISIONAL -> FINAL.
 *      PROVISIONAL is set from rail confirmation semantics (e.g., rail
 *      ack, blockchain confirmations before protocol depth); FINAL is
 *      declared by protocol rule only. FINAL advances the obligation to
 *      SETTLED exactly once."
 *   lines 242-245 (Owning authority):
 *     "Settlement Authority (protocol layer, area 12) owns instruction,
 *      attempt, and finality state. Rail adapters report outcomes; they
 *      never declare protocol finality."
 *   lines 247-262 (the four invariants — quoted in full below at each
 *     binding site).
 *   lines 264-273 (failure and UNKNOWN semantics):
 *     "Confirmed failure marks the attempt FAILED and the instruction
 *      FAILED; recovery is a new instruction with a new attempt, fully
 *      evidenced. UNKNOWN is a durable attempt state: the instruction
 *      stays ISSUED, the obligation stays SETTLEMENT_PENDING, and a
 *      reconciliation case (area 14) is opened automatically. Only the
 *      reconciliation resolution may drive the attempt to CONFIRMED or
 *      FAILED and then advance finality. Resumption after resolution is
 *      safe-resume, never re-submission of the same external effect (GC-2)."
 *   lines 275-279 (evidence produced); lines 281-289 (boundaries:
 *    "Settlement never computes netting or mutates obligations beyond
 *    lifecycle transitions." / "Settlement does not implement rail
 *    protocols; area 13 does." / "Finality is protocol-owned even when
 *    informed by rail or blockchain confirmation data." / "Depends on
 *    areas 10, 11, 13, 14, 15").
 *   spec/architecture/v0.1/rails-adapters-reconciliation.md §1 Area 13
 *   lines 33-46 (the RailOperation machine this authority's attempts
 *   mirror), §2 Area 14 lines 171-179 (the recovery paths this authority
 *   consumes).
 *   spec/architecture/v0.1/README.md §3 GC-1/GC-2/GC-3/GC-4/GC-5.
 *   spec/registry/protocol-registry.json singleFinancialAuthority — the
 *   apex: "Only the Settlement and Finality Authority originates
 *   instructions for external value movement; only the Rail Authority
 *   executes them through adapters".
 *
 * Interpretation decisions (recorded in CONTRACT-REVIEW.md):
 *   - The attempt machine mirrors the A13 RailOperation machine exactly
 *     (CREATED plays AUTHORIZED's role): UNKNOWN is listed among the
 *     attempt's terminal states in the spec's own list ("terminal(
 *     CONFIRMED | FAILED | UNKNOWN)") — terminal in the sense that
 *     nothing but a reconciliation resolution moves it (lines 268-272);
 *     the machine therefore carries UNKNOWN -> {CONFIRMED, FAILED} edges
 *     that NO normal command executes — only the resolution consumer
 *     does (the RAIL_OPERATION_TRANSITIONS mirror).
 *   - The settlement subject union {OBLIGATION, NET_POSITION} comes from
 *     line 224-225 verbatim ("for one obligation or net position").
 */

import type { Money } from '../kernel/money.ts';
import type { ProtocolTime } from '../kernel/time.ts';

// ---------------------------------------------------------------------------
// Area 12 — the settlement subject
// ---------------------------------------------------------------------------

/**
 * The subject of one settlement instruction: "one obligation or net
 * position" — an A10 obligation (by ledger id) or an A11 net position (by
 * the netting domain's net obligation id).
 *
 * Source: clearing-netting-settlement.md lines 224-225.
 */
export type SettlementSubject =
  | { readonly kind: 'OBLIGATION'; readonly obligationId: string }
  | { readonly kind: 'NET_POSITION'; readonly netObligationId: string };

/**
 * The stable string key of a subject (the derivation input for
 * instruction and finality ids).
 *
 * Source: clearing-netting-settlement.md lines 224-225; the kernel
 * identity discipline.
 */
export function settlementSubjectKey(subject: SettlementSubject): string {
  return subject.kind === 'OBLIGATION' ? subject.obligationId : subject.netObligationId;
}

// ---------------------------------------------------------------------------
// Area 12 — the SettlementInstruction state machine
// ---------------------------------------------------------------------------

/**
 * The SettlementInstruction state vocabulary, verbatim from Area 12.
 *
 * Source: clearing-netting-settlement.md lines 225-226 — "States: CREATED
 * -> ISSUED -> terminal(CONFIRMED | FAILED)."
 */
export const SETTLEMENT_INSTRUCTION_STATES: readonly [
  'CREATED',
  'ISSUED',
  'CONFIRMED',
  'FAILED',
] = Object.freeze(['CREATED', 'ISSUED', 'CONFIRMED', 'FAILED'] as const);

/**
 * A SettlementInstruction state.
 *
 * Source: clearing-netting-settlement.md lines 225-226.
 */
export type SettlementInstructionState = (typeof SETTLEMENT_INSTRUCTION_STATES)[number];

/**
 * The instruction terminal states.
 *
 * Source: clearing-netting-settlement.md line 226 — "terminal(CONFIRMED |
 * FAILED)".
 */
export const SETTLEMENT_INSTRUCTION_TERMINAL_STATES: readonly ['CONFIRMED', 'FAILED'] =
  Object.freeze(['CONFIRMED', 'FAILED'] as const);

/**
 * The frozen one-way SettlementInstruction transition table — exactly the
 * v0.1 machine: CREATED -> ISSUED ("ISSUED means a rail operation exists
 * (area 13)"), ISSUED -> terminal(CONFIRMED | FAILED). The terminals
 * have empty successor sets: "recovery is a new instruction with a new
 * attempt, fully evidenced" — never a transition out of a terminal.
 *
 * Source: clearing-netting-settlement.md lines 225-227, 264-266.
 */
export const SETTLEMENT_INSTRUCTION_TRANSITIONS: Readonly<
  Record<SettlementInstructionState, readonly SettlementInstructionState[]>
> = Object.freeze({
  CREATED: Object.freeze(['ISSUED'] as const),
  ISSUED: Object.freeze(['CONFIRMED', 'FAILED'] as const),
  CONFIRMED: Object.freeze([] as const),
  FAILED: Object.freeze([] as const),
});

/**
 * Runtime type guard for SettlementInstructionState.
 *
 * Source: clearing-netting-settlement.md lines 225-226.
 */
export function isSettlementInstructionState(
  value: unknown,
): value is SettlementInstructionState {
  return (
    typeof value === 'string' &&
    (SETTLEMENT_INSTRUCTION_STATES as readonly string[]).includes(value)
  );
}

/**
 * True iff the (from, to) pair is a legal SettlementInstruction
 * transition.
 *
 * Source: clearing-netting-settlement.md lines 225-227.
 */
export function canTransitionSettlementInstruction(
  from: SettlementInstructionState,
  to: SettlementInstructionState,
): boolean {
  return SETTLEMENT_INSTRUCTION_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Area 12 — the SettlementAttempt state machine
// ---------------------------------------------------------------------------

/**
 * The SettlementAttempt state vocabulary, verbatim from Area 12.
 *
 * Source: clearing-netting-settlement.md lines 228-231 — "States: CREATED
 * -> SUBMITTED -> PENDING | terminal(CONFIRMED | FAILED | UNKNOWN)."
 */
export const SETTLEMENT_ATTEMPT_STATES: readonly [
  'CREATED',
  'SUBMITTED',
  'PENDING',
  'CONFIRMED',
  'FAILED',
  'UNKNOWN',
] = Object.freeze([
  'CREATED',
  'SUBMITTED',
  'PENDING',
  'CONFIRMED',
  'FAILED',
  'UNKNOWN',
] as const);

/**
 * A SettlementAttempt state.
 *
 * Source: clearing-netting-settlement.md lines 228-231.
 */
export type SettlementAttemptState = (typeof SETTLEMENT_ATTEMPT_STATES)[number];

/**
 * The frozen one-way SettlementAttempt transition table — the exact A12
 * machine, mirroring the A13 RailOperation machine (CREATED plays
 * AUTHORIZED's role; see the module doc's recorded interpretation):
 *   CREATED -> SUBMITTED                                   (submission command)
 *   SUBMITTED -> PENDING | CONFIRMED | FAILED | UNKNOWN    (rail outcomes)
 *   PENDING -> CONFIRMED | FAILED | UNKNOWN                (rail reports)
 *   UNKNOWN -> CONFIRMED | FAILED                          (ONLY the
 *     reconciliation resolution — lines 268-272: "Only the reconciliation
 *     resolution may drive the attempt to CONFIRMED or FAILED and then
 *     advance finality"; no normal command executes these two edges)
 *   CONFIRMED / FAILED: terminal (empty successor sets)
 *
 * Source: clearing-netting-settlement.md lines 228-233, 264-273;
 * rails-adapters-reconciliation.md lines 33-46 (the mirrored machine).
 */
export const SETTLEMENT_ATTEMPT_TRANSITIONS: Readonly<
  Record<SettlementAttemptState, readonly SettlementAttemptState[]>
> = Object.freeze({
  CREATED: Object.freeze(['SUBMITTED'] as const),
  SUBMITTED: Object.freeze(['PENDING', 'CONFIRMED', 'FAILED', 'UNKNOWN'] as const),
  PENDING: Object.freeze(['CONFIRMED', 'FAILED', 'UNKNOWN'] as const),
  CONFIRMED: Object.freeze([] as const),
  FAILED: Object.freeze([] as const),
  UNKNOWN: Object.freeze(['CONFIRMED', 'FAILED'] as const),
});

/**
 * Runtime type guard for SettlementAttemptState.
 *
 * Source: clearing-netting-settlement.md lines 228-231.
 */
export function isSettlementAttemptState(value: unknown): value is SettlementAttemptState {
  return (
    typeof value === 'string' &&
    (SETTLEMENT_ATTEMPT_STATES as readonly string[]).includes(value)
  );
}

/**
 * True iff the (from, to) pair is a legal SettlementAttempt transition.
 *
 * Source: clearing-netting-settlement.md lines 228-233, 264-273.
 */
export function canTransitionSettlementAttempt(
  from: SettlementAttemptState,
  to: SettlementAttemptState,
): boolean {
  return SETTLEMENT_ATTEMPT_TRANSITIONS[from].includes(to);
}

/**
 * True iff the attempt state is LIVE — the INV-12-2 "live attempt"
 * ("at most one live attempt per instruction"): CREATED, SUBMITTED,
 * PENDING, or UNKNOWN. UNKNOWN is live: "UNKNOWN is a durable attempt
 * state" whose only exit is reconciliation (GC-2) — so a second attempt
 * authorization is refused while the first is UNKNOWN (the single-attempt
 * negative test).
 *
 * Source: clearing-netting-settlement.md lines 253-256 (INV-12-2),
 * 264-273.
 */
export function isLiveSettlementAttempt(state: SettlementAttemptState): boolean {
  return state === 'CREATED' || state === 'SUBMITTED' || state === 'PENDING' || state === 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// Area 12 — the FinalityRecord state machine
// ---------------------------------------------------------------------------

/**
 * The FinalityRecord state vocabulary, verbatim from Area 12.
 *
 * Source: clearing-netting-settlement.md lines 236-237 — "States:
 * PROVISIONAL -> FINAL."
 */
export const FINALITY_STATES: readonly ['PROVISIONAL', 'FINAL'] = Object.freeze([
  'PROVISIONAL',
  'FINAL',
] as const);

/**
 * A FinalityRecord state.
 *
 * Source: clearing-netting-settlement.md lines 236-237.
 */
export type FinalityState = (typeof FINALITY_STATES)[number];

/**
 * The frozen one-way FinalityRecord transition table: PROVISIONAL ->
 * FINAL and NOTHING ELSE. FINAL has an empty successor set — there is no
 * reversal edge anywhere in the surface ("FINAL is exactly-once per
 * obligation and irreversible; reversal of a settled fact is only
 * possible as a new obligation via dispute/recourse (area 21)" —
 * INV-12-4). No command exists that writes FINAL twice or reverses it.
 *
 * Source: clearing-netting-settlement.md lines 236-240, 259-262
 * (INV-12-4).
 */
export const FINALITY_TRANSITIONS: Readonly<Record<FinalityState, readonly FinalityState[]>> =
  Object.freeze({
    PROVISIONAL: Object.freeze(['FINAL'] as const),
    FINAL: Object.freeze([] as const),
  });

/**
 * Runtime type guard for FinalityState.
 *
 * Source: clearing-netting-settlement.md lines 236-237.
 */
export function isFinalityState(value: unknown): value is FinalityState {
  return typeof value === 'string' && (FINALITY_STATES as readonly string[]).includes(value);
}

/**
 * True iff the (from, to) pair is a legal FinalityRecord transition.
 *
 * Source: clearing-netting-settlement.md lines 236-240.
 */
export function canTransitionFinality(from: FinalityState, to: FinalityState): boolean {
  return FINALITY_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Area 12 — the records
// ---------------------------------------------------------------------------

/**
 * SettlementInstruction — "protocol authorization to move value
 * externally for one obligation or net position". The amount is integer
 * Money copied VERBATIM from the subject (INV-12-1); the payload hash of
 * the rail operation content is recorded here and compared on every
 * result; the beneficiary is the external rail account reference.
 *
 * Source: clearing-netting-settlement.md lines 224-227, 247-249
 * (INV-12-1).
 */
export interface SettlementInstructionRecord {
  readonly instructionId: string;
  readonly subject: SettlementSubject;
  /** The 1-based ordinal of this instruction for the subject (recovery = a NEW instruction). */
  readonly subjectOrdinal: number;
  readonly state: SettlementInstructionState;
  /** Integer Money copied verbatim from the obligation / net position (INV-12-1). */
  readonly amount: Money;
  /** The external rail account reference the value moves to. */
  readonly beneficiary: string;
  readonly memo?: string;
  /** The recorded rail-operation payload hash — recorded at creation, compared on every result (INV-12-1). */
  readonly payloadHash: string;
  readonly createdAt: ProtocolTime;
  readonly issuedAt?: ProtocolTime;
  readonly terminalAt?: ProtocolTime;
}

/**
 * SettlementAttempt — "one authorized external attempt for one
 * instruction", keyed by the instruction id (INV-12-3: "attempt
 * authorization is keyed by instruction id"). Carries the deterministic
 * rail idempotency key passed to the adapter (INV-12-3 + INV-13-3), the
 * rail operation link, and — while UNKNOWN — the reconciliation case
 * reference.
 *
 * Source: clearing-netting-settlement.md lines 228-233, 253-258
 * (INV-12-2/INV-12-3).
 */
export interface SettlementAttemptRecord {
  readonly attemptId: string;
  readonly instructionId: string;
  readonly state: SettlementAttemptState;
  /** The A13 rail operation executing this attempt (the GC-3 authorization link). */
  readonly operationId: string;
  readonly adapterId: string;
  /** The deterministic rail idempotency key derived from the instruction id (INV-12-3/INV-13-3). */
  readonly idempotencyKey: string;
  /** The automatically opened area-14 reconciliation case, when the attempt landed UNKNOWN. */
  readonly reconciliationCaseId?: string;
  readonly createdAt: ProtocolTime;
  readonly submittedAt?: ProtocolTime;
  readonly resolvedAt?: ProtocolTime;
}

/**
 * FinalityRecord — "protocol declaration that value movement is
 * irreversible", one per settlement subject (FINAL exactly-once per
 * obligation — INV-12-4). The rule references record WHICH protocol rule
 * set each state: the rail-confirmation semantics for PROVISIONAL, the
 * finality rule for FINAL.
 *
 * Source: clearing-netting-settlement.md lines 235-240, 259-262
 * (INV-12-4); lines 278-279 ("FINALITY_DECLARED (PROVISIONAL or FINAL,
 * rule reference, proof)").
 */
export interface FinalityRecord {
  readonly finalityRecordId: string;
  readonly subject: SettlementSubject;
  readonly state: FinalityState;
  /** The instruction whose confirmed attempt drove PROVISIONAL. */
  readonly instructionId?: string;
  /** The rail operation whose confirmation informed PROVISIONAL. */
  readonly operationId?: string;
  readonly ruleReference: string;
  readonly payloadHash?: string;
  readonly declaredProvisionalAt?: ProtocolTime;
  readonly declaredFinalAt?: ProtocolTime;
}

// ---------------------------------------------------------------------------
// Typed rejections and command results
// ---------------------------------------------------------------------------

/**
 * The Settlement and Finality Authority's typed rejection codes.
 * SUBJECT_NOT_FOUND / SUBJECT_NOT_SETTLEABLE / SUBJECT_ALREADY_SETTLED
 * (the instruction gates); LIVE_INSTRUCTION_EXISTS (at most one live
 * instruction per subject — the double-payment guard);
 * INSTRUCTION_NOT_FOUND / INSTRUCTION_TERMINAL (the machine);
 * LIVE_ATTEMPT_EXISTS (INV-12-2: "at most one live attempt per
 * instruction; blind retry is impossible by construction");
 * ATTEMPT_NOT_FOUND; ATTEMPT_NOT_LIVE / ATTEMPT_ALREADY_TERMINAL;
 * RAIL_AUTHORIZATION_FAILED / RAIL_SUBMISSION_FAILED (the A13 port's
 * typed failures surfaced); PAYLOAD_HASH_MISMATCH (INV-12-1 / INV-13-2);
  * OPERATION_NOT_FOUND (the rail operation link);
 * NOT_PROVISIONAL / FINALITY_ALREADY_DECLARED / UNKNOWN_HELD (the
 * finality gates — GC-2: FINAL only after every UNKNOWN is resolved);
 * RECOVERY_NOT_APPLICABLE (the resolution-consumer guards);
 * NET_OBLIGATION_NOT_FOUND / OBLIGATION_TRANSITION_REFUSED (the
 * subject-domain drives).
 *
 * Source: clearing-netting-settlement.md lines 220-289 (the gates the
 * rejections ground); the merged typed-rejection convention.
 */
export const SETTLEMENT_REJECTION_CODES: readonly [
  'SUBJECT_NOT_FOUND',
  'SUBJECT_NOT_SETTLEABLE',
  'SUBJECT_ALREADY_SETTLED',
  'LIVE_INSTRUCTION_EXISTS',
  'INSTRUCTION_NOT_FOUND',
  'INSTRUCTION_TERMINAL',
  'LIVE_ATTEMPT_EXISTS',
  'ATTEMPT_NOT_FOUND',
  'ATTEMPT_NOT_LIVE',
  'ATTEMPT_ALREADY_TERMINAL',
  'RAIL_AUTHORIZATION_FAILED',
  'RAIL_SUBMISSION_FAILED',
  'PAYLOAD_HASH_MISMATCH',
  'OPERATION_NOT_FOUND',
  'NOT_PROVISIONAL',
  'FINALITY_ALREADY_DECLARED',
  'UNKNOWN_HELD',
  'RECOVERY_NOT_APPLICABLE',
  'NET_OBLIGATION_NOT_FOUND',
  'OBLIGATION_TRANSITION_REFUSED',
  'ILLEGAL_TRANSITION',
] = Object.freeze([
  'SUBJECT_NOT_FOUND',
  'SUBJECT_NOT_SETTLEABLE',
  'SUBJECT_ALREADY_SETTLED',
  'LIVE_INSTRUCTION_EXISTS',
  'INSTRUCTION_NOT_FOUND',
  'INSTRUCTION_TERMINAL',
  'LIVE_ATTEMPT_EXISTS',
  'ATTEMPT_NOT_FOUND',
  'ATTEMPT_NOT_LIVE',
  'ATTEMPT_ALREADY_TERMINAL',
  'RAIL_AUTHORIZATION_FAILED',
  'RAIL_SUBMISSION_FAILED',
  'PAYLOAD_HASH_MISMATCH',
  'OPERATION_NOT_FOUND',
  'NOT_PROVISIONAL',
  'FINALITY_ALREADY_DECLARED',
  'UNKNOWN_HELD',
  'RECOVERY_NOT_APPLICABLE',
  'NET_OBLIGATION_NOT_FOUND',
  'OBLIGATION_TRANSITION_REFUSED',
  'ILLEGAL_TRANSITION',
] as const);

/**
 * A Settlement and Finality Authority rejection code.
 *
 * Source: clearing-netting-settlement.md lines 220-289.
 */
export type SettlementRejectionCode = (typeof SETTLEMENT_REJECTION_CODES)[number];

/**
 * Runtime type guard for SettlementRejectionCode.
 *
 * Source: clearing-netting-settlement.md lines 220-289.
 */
export function isSettlementRejectionCode(value: unknown): value is SettlementRejectionCode {
  return (
    typeof value === 'string' &&
    (SETTLEMENT_REJECTION_CODES as readonly string[]).includes(value)
  );
}

/**
 * The typed result shape of every Settlement and Finality Authority
 * command (the merged convention — domain rejections are values, never
 * thrown).
 *
 * Source: the merged command convention (RTN-005/006/007/008); A12 lines
 * 247-262 (the INV gates the rejections ground).
 */
export type SettlementCommandResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: SettlementRejectionCode; readonly message: string };
