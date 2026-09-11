/**
 * RTN-004 — Rails: the A13/A14 core state-machine and record types.
 *
 * Spec sources (binding) —
 * spec/architecture/v0.1/rails-adapters-reconciliation.md §1 Area 13, lines
 * 29-48 (objects and state):
 *   "RailAdapter — registered connector for one external rail family.
 *    States: REGISTERED -> ACTIVE -> DEGRADED -> RETIRED.
 *    DEGRADED adapters accept no new operations; in-flight operations
 *    continue to report results."
 *   "RailOperation — one authorized external effect.
 *    States: AUTHORIZED -> SUBMITTED ->
 *    PENDING | terminal(CONFIRMED | FAILED | UNKNOWN)."
 *   "RailResultReport — immutable report from the rail: outcome class,
 *    rail reference identifiers, timestamp, and payload proof (hash)."
 * §2 Area 14, lines 119-141 (objects and state):
 *   "ReconciliationCase — one resolution unit.
 *    States: OPEN -> INVESTIGATING ->
 *    terminal(MATCHED | RESOLVED_CONFIRMED | RESOLVED_FAILED |
 *    RESOLVED_ADJUSTED)."
 *   "ReconciliationCycle — periodic matching run over a window of protocol
 *    records and external statements ... States: OPEN -> COLLECTED ->
 *    MATCHED -> CLOSED. Discrepancies become cases."
 *   "ReconciliationSource — registered external statement provider (rail
 *    settlement report, statement file, on-chain observer), treated as
 *    untrusted input with sequence numbers."
 * spec/architecture/v0.1/README.md §3 GC-3 (lines 51-55): the
 * settlement-instruction link is "the explicit authorization required by
 * GC-3" (rails-adapters-reconciliation.md lines 38-40).
 * spec/architecture/v0.1/clearing-netting-settlement.md §4 Area 12, lines
 * 224-233: SettlementInstruction is the protocol authorization object the
 * RailOperation links to.
 *
 * State-machine materialization convention (matches the RTN-001 kernel's
 * frozen-table approach): each state vocabulary is exported as a frozen
 * literal union plus a frozen LEGAL TRANSITION TABLE. A transition is legal
 * iff `to ∈ LEGAL_TRANSITIONS[from]`. Illegal transitions are unrepresentable
 * in the command vocabulary: there is no `transition(record, newState)` API
 * anywhere in this surface — each authority command names exactly one legal
 * transition, validates it against the table, and rejects every other
 * combination with a deterministic reason code (see reason-codes.ts).
 */

import type { Money } from '../kernel/money.ts';
import type { ProtocolTime } from '../kernel/time.ts';

// ---------------------------------------------------------------------------
// Area 13 — Rail Adapter Authority state
// ---------------------------------------------------------------------------

/**
 * RailAdapter lifecycle states, verbatim from Area 13.
 *
 * Source: rails-adapters-reconciliation.md lines 30-31 — "States: REGISTERED
 * -> ACTIVE -> DEGRADED -> RETIRED."
 */
export type RailAdapterStatus = 'REGISTERED' | 'ACTIVE' | 'DEGRADED' | 'RETIRED';

/**
 * The frozen legal-transition table for the RailAdapter lifecycle.
 * Exactly the three arrows the frozen state list names:
 * REGISTERED→ACTIVE, ACTIVE→DEGRADED, DEGRADED→RETIRED.
 *
 * Interpretation decision (recorded in CONTRACT-REVIEW.md): the frozen text
 * lists one linear chain and no re-activation arrow, so DEGRADED→ACTIVE is
 * NOT a legal transition; a recovered adapter is a NEW registration (new
 * adapter id). No semantics were added or removed.
 *
 * Source: rails-adapters-reconciliation.md lines 30-31.
 */
export const RAIL_ADAPTER_TRANSITIONS: Readonly<
  Record<RailAdapterStatus, readonly RailAdapterStatus[]>
> = Object.freeze({
  REGISTERED: Object.freeze(['ACTIVE'] as const),
  ACTIVE: Object.freeze(['DEGRADED'] as const),
  DEGRADED: Object.freeze(['RETIRED'] as const),
  RETIRED: Object.freeze([] as const),
});

/**
 * Runtime type guard for RailAdapterStatus.
 *
 * Source: rails-adapters-reconciliation.md lines 30-31.
 */
export function isRailAdapterStatus(value: unknown): value is RailAdapterStatus {
  return (
    value === 'REGISTERED' ||
    value === 'ACTIVE' ||
    value === 'DEGRADED' ||
    value === 'RETIRED'
  );
}

/**
 * RailOperation lifecycle states, verbatim from Area 13.
 *
 * Source: rails-adapters-reconciliation.md lines 33-35 — "States: AUTHORIZED
 * -> SUBMITTED -> PENDING | terminal(CONFIRMED | FAILED | UNKNOWN)."
 */
export type RailOperationStatus =
  | 'AUTHORIZED'
  | 'SUBMITTED'
  | 'PENDING'
  | 'CONFIRMED'
  | 'FAILED'
  | 'UNKNOWN';

/**
 * The frozen legal-transition table for the RailOperation lifecycle.
 *
 * Exactly the arrows the frozen state machine names, plus the
 * reconciliation-resolution edges out of UNKNOWN:
 *   AUTHORIZED→SUBMITTED                          (submission command)
 *   SUBMITTED→PENDING | CONFIRMED | FAILED | UNKNOWN
 *   PENDING→CONFIRMED | FAILED | UNKNOWN           (rail result reports)
 *   UNKNOWN→CONFIRMED | FAILED                     (INV-14-2: "a case's
 *                                                terminal resolution
 *                                                transitions the originating
 *                                                rail operation exactly
 *                                                once" — the ONLY exit from
 *                                                UNKNOWN; GC-2 forbids
 *                                                re-submission, and the Rail
 *                                                Adapter Authority exposes no
 *                                                command that executes these
 *                                                two edges — only the
 *                                                Reconciliation Authority's
 *                                                case resolution does)
 *
 * Interpretation decision (recorded in CONTRACT-REVIEW.md): "SUBMITTED ->
 * PENDING | terminal(CONFIRMED | FAILED | UNKNOWN)" is read as SUBMITTED's
 * successor set = {PENDING} ∪ the terminals — corroborated by Area 13's
 * failure semantics (lines 74-78), where submission-time failures map
 * directly to FAILED and post-submission indeterminacy to UNKNOWN, both
 * from the SUBMITTED (handed-to-rail) state. From PENDING (rail accepted),
 * only the terminals follow.
 *
 * Source: rails-adapters-reconciliation.md lines 33-46 (state machine; line
 * 45-46: "UNKNOWN: ... This is a durable state; adapters MUST NOT resolve
 * UNKNOWN by re-submission."), lines 74-78 (failure semantics), Area 14
 * lines 152-154 (INV-14-2), README.md §3 GC-2 lines 45-49.
 */
export const RAIL_OPERATION_TRANSITIONS: Readonly<
  Record<RailOperationStatus, readonly RailOperationStatus[]>
> = Object.freeze({
  AUTHORIZED: Object.freeze(['SUBMITTED'] as const),
  SUBMITTED: Object.freeze(['PENDING', 'CONFIRMED', 'FAILED', 'UNKNOWN'] as const),
  PENDING: Object.freeze(['CONFIRMED', 'FAILED', 'UNKNOWN'] as const),
  CONFIRMED: Object.freeze([] as const),
  FAILED: Object.freeze([] as const),
  UNKNOWN: Object.freeze(['CONFIRMED', 'FAILED'] as const),
});

/**
 * Runtime type guard for RailOperationStatus.
 *
 * Source: rails-adapters-reconciliation.md lines 33-35.
 */
export function isRailOperationStatus(value: unknown): value is RailOperationStatus {
  return (
    value === 'AUTHORIZED' ||
    value === 'SUBMITTED' ||
    value === 'PENDING' ||
    value === 'CONFIRMED' ||
    value === 'FAILED' ||
    value === 'UNKNOWN'
  );
}

/**
 * The rail report classes: the four outcome classes an adapter maps a
 * submission or report to (INV-13-4: "adapters must map every submission to
 * exactly one report class; they never infer CONFIRMED or FAILED from
 * silence. Silence or ambiguity maps to UNKNOWN.").
 *
 * Source: rails-adapters-reconciliation.md lines 39-44 (PENDING /
 * CONFIRMED / FAILED / UNKNOWN semantics) and lines 70-72 (INV-13-4).
 */
export type RailReportClass = 'CONFIRMED' | 'FAILED' | 'PENDING' | 'UNKNOWN';

/**
 * Runtime type guard for RailReportClass.
 *
 * Source: rails-adapters-reconciliation.md lines 39-44, 70-72.
 */
export function isRailReportClass(value: unknown): value is RailReportClass {
  return (
    value === 'CONFIRMED' ||
    value === 'FAILED' ||
    value === 'PENDING' ||
    value === 'UNKNOWN'
  );
}

/**
 * The operation payload: the authorized external effect's content. Money is
 * integer Money copied VERBATIM from the authorization (INV-13-2:
 * "operation payloads carry integer Money verbatim from the authorization").
 *
 * The `instructionId` is the link to the SettlementInstruction (Area 12) —
 * "AUTHORIZED: created by Settlement Authority (area 12) with a linked
 * settlement instruction; this link is the explicit authorization required
 * by GC-3" (rails-adapters-reconciliation.md lines 36-40).
 *
 * `beneficiary` is the external rail account reference the effect targets.
 *
 * Source: rails-adapters-reconciliation.md lines 36-40, 63-65 (INV-13-2);
 * README.md §3 GC-3 lines 51-55.
 */
export interface RailOperationPayload {
  readonly instructionId: string;
  readonly money: Money;
  readonly beneficiary: string;
  readonly memo?: string;
}

/**
 * RailAdapterRecord — the protocol-owned registry row for one registered
 * connector. Owned by the Rail Adapter Authority (Area 13 "Owning
 * authority: ... owns adapter registry and operation lifecycle").
 *
 * Source: rails-adapters-reconciliation.md lines 29-32, 50-54.
 */
export interface RailAdapterRecord {
  readonly adapterId: string;
  readonly railFamily: string;
  readonly name: string;
  readonly status: RailAdapterStatus;
  /** Reason code of the most recent state change, when one was recorded. */
  readonly reasonCode?: string;
  readonly createdAt: ProtocolTime;
  readonly updatedAt: ProtocolTime;
}

/**
 * RailOperationRecord — one authorized external effect, protocol-owned
 * authoritative state (rtn-plan-rulings.md Q1: the lifecycle is
 * protocol-owned, transitioned only through the authority's command
 * surface).
 *
 *   - `instructionId` — the GC-3 authorization link (Area 12 instruction).
 *   - `payload` / `payloadHash` — INV-13-2: money verbatim + hash recorded
 *     at authorization, recorded at submission, re-checked on every report.
 *   - `idempotencyKey` — INV-13-3: "each operation carries a deterministic
 *     rail idempotency key derived from the instruction id".
 *   - `railReferences` — identifiers the rail returned at submission /
 *     reporting ("rail reference identifiers", lines 47-48).
 *
 * Source: rails-adapters-reconciliation.md lines 33-48, 50-54, 63-65,
 * 66-69; rtn-plan-rulings.md Q1 ruling (delta 1).
 */
export interface RailOperationRecord {
  readonly operationId: string;
  readonly instructionId: string;
  readonly adapterId: string;
  readonly status: RailOperationStatus;
  readonly payload: RailOperationPayload;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
  /** Reason code of the most recent transition, when one was recorded. */
  readonly reasonCode?: string;
  readonly railReferences: readonly string[];
  readonly authorizedAt: ProtocolTime;
  readonly updatedAt: ProtocolTime;
}

/**
 * RailResultReportRecord — an ingested report, immutable once recorded.
 * "RailResultReport — immutable report from the rail: outcome class, rail
 * reference identifiers, timestamp, and payload proof (hash)."
 *
 * `ordinal` is the per-operation report sequence (1, 2, 3, ...) making the
 * report log totally ordered per operation.
 *
 * Source: rails-adapters-reconciliation.md lines 47-48; INV-13-2 line 64
 * ("re-checked on every report").
 */
export interface RailResultReportRecord {
  readonly reportId: string;
  readonly operationId: string;
  readonly ordinal: number;
  readonly outcomeClass: RailReportClass;
  readonly reasonCode?: string;
  readonly railReferences: readonly string[];
  readonly payloadHash: string;
  /** The report's own asserted timestamp (integer epoch ms — GC-1). */
  readonly reportedAtWallMs: number;
  /** Protocol time the authority recorded the report. */
  readonly recordedAt: ProtocolTime;
}

// ---------------------------------------------------------------------------
// Area 14 — Reconciliation Authority state
// ---------------------------------------------------------------------------

/**
 * ReconciliationCase lifecycle states, verbatim from Area 14.
 *
 * Source: rails-adapters-reconciliation.md lines 119-123 — "States: OPEN ->
 * INVESTIGATING -> terminal(MATCHED | RESOLVED_CONFIRMED | RESOLVED_FAILED |
 * RESOLVED_ADJUSTED)."
 */
export type ReconciliationCaseStatus =
  | 'OPEN'
  | 'INVESTIGATING'
  | 'MATCHED'
  | 'RESOLVED_CONFIRMED'
  | 'RESOLVED_FAILED'
  | 'RESOLVED_ADJUSTED';

/**
 * The frozen legal-transition table for the ReconciliationCase lifecycle:
 * OPEN→INVESTIGATING, then INVESTIGATING→any terminal. Terminal states have
 * no outgoing edges — INV-14-2's "duplicate resolutions are rejected by case
 * id" is exactly this table plus the command guard.
 *
 * Interpretation decision (recorded in CONTRACT-REVIEW.md): the frozen chain
 * has no direct OPEN→terminal arrow, so a terminal resolution requires the
 * case to pass INVESTIGATING first ("Emergency manual resolutions follow the
 * same case lifecycle", Area 14 lines 193-195).
 *
 * Source: rails-adapters-reconciliation.md lines 119-123, 151-154 (INV-14-2),
 * 193-195.
 */
export const RECONCILIATION_CASE_TRANSITIONS: Readonly<
  Record<ReconciliationCaseStatus, readonly ReconciliationCaseStatus[]>
> = Object.freeze({
  OPEN: Object.freeze(['INVESTIGATING'] as const),
  INVESTIGATING: Object.freeze([
    'MATCHED',
    'RESOLVED_CONFIRMED',
    'RESOLVED_FAILED',
    'RESOLVED_ADJUSTED',
  ] as const),
  MATCHED: Object.freeze([] as const),
  RESOLVED_CONFIRMED: Object.freeze([] as const),
  RESOLVED_FAILED: Object.freeze([] as const),
  RESOLVED_ADJUSTED: Object.freeze([] as const),
});

/**
 * Runtime type guard for ReconciliationCaseStatus.
 *
 * Source: rails-adapters-reconciliation.md lines 119-123.
 */
export function isReconciliationCaseStatus(
  value: unknown,
): value is ReconciliationCaseStatus {
  return (
    value === 'OPEN' ||
    value === 'INVESTIGATING' ||
    value === 'MATCHED' ||
    value === 'RESOLVED_CONFIRMED' ||
    value === 'RESOLVED_FAILED' ||
    value === 'RESOLVED_ADJUSTED'
  );
}

/**
 * ReconciliationCycle lifecycle states, verbatim from Area 14.
 *
 * Source: rails-adapters-reconciliation.md lines 133-137 — "States: OPEN ->
 * COLLECTED -> MATCHED -> CLOSED."
 */
export type ReconciliationCycleStatus = 'OPEN' | 'COLLECTED' | 'MATCHED' | 'CLOSED';

/**
 * The frozen legal-transition table for the ReconciliationCycle lifecycle:
 * exactly OPEN→COLLECTED→MATCHED→CLOSED.
 *
 * Source: rails-adapters-reconciliation.md lines 133-137.
 */
export const RECONCILIATION_CYCLE_TRANSITIONS: Readonly<
  Record<ReconciliationCycleStatus, readonly ReconciliationCycleStatus[]>
> = Object.freeze({
  OPEN: Object.freeze(['COLLECTED'] as const),
  COLLECTED: Object.freeze(['MATCHED'] as const),
  MATCHED: Object.freeze(['CLOSED'] as const),
  CLOSED: Object.freeze([] as const),
});

/**
 * Runtime type guard for ReconciliationCycleStatus.
 *
 * Source: rails-adapters-reconciliation.md lines 133-137.
 */
export function isReconciliationCycleStatus(
  value: unknown,
): value is ReconciliationCycleStatus {
  return (
    value === 'OPEN' ||
    value === 'COLLECTED' ||
    value === 'MATCHED' ||
    value === 'CLOSED'
  );
}

/**
 * Where a reconciliation case came from. Area 14 names exactly two case
 * origins:
 *   1. an UNKNOWN rail operation ("Every UNKNOWN rail operation automatically
 *      opens exactly one case", lines 124-126 / INV-14-1 lines 150-152);
 *   2. a cycle discrepancy ("Discrepancies become cases", line 137).
 *
 * Source: rails-adapters-reconciliation.md lines 124-126, 133-137.
 */
export type ReconciliationCaseOrigin =
  | {
      readonly kind: 'UNKNOWN_OPERATION';
      readonly operationId: string;
      readonly instructionId: string;
    }
  | {
      readonly kind: 'CYCLE_DISCREPANCY';
      readonly cycleId: string;
      readonly discrepancyKind: string;
      readonly statementRef?: string;
      readonly protocolRef?: string;
    };

/**
 * The recorded proof of a terminal resolution — "closure requires a terminal
 * resolution with recorded proof" (INV-14-1) and "CASE_RESOLVED (terminal
 * class, proof: matched statement references or adjustment ledger
 * references)" (Area 14 evidence list).
 *
 * Source: rails-adapters-reconciliation.md lines 151-152, 183-185.
 */
export interface ResolutionProof {
  /** References to the matched external statements, when any. */
  readonly matchedStatementRefs?: readonly string[];
  /** References to adjustment ledger entries (RESOLVED_ADJUSTED). */
  readonly adjustmentLedgerRefs?: readonly string[];
  /** Other external references (rail refs, statement file ids, ...). */
  readonly externalRefs?: readonly string[];
}

/**
 * ReconciliationCaseRecord — one resolution unit, protocol-owned state.
 *
 * `resolution` and `recovery` are present iff the case reached a terminal
 * state; `recovery` is the typed link to the downstream area that consumes
 * the resolution (12/9/10 — Area 14 "Recovery paths from each terminal
 * resolution", lines 171-179).
 *
 * Source: rails-adapters-reconciliation.md lines 119-126, 143-146.
 */
export interface ReconciliationCaseRecord {
  readonly caseId: string;
  readonly status: ReconciliationCaseStatus;
  readonly origin: ReconciliationCaseOrigin;
  readonly openedAt: ProtocolTime;
  readonly resolvedAt?: ProtocolTime;
  readonly resolution?: CaseTerminalResolution;
  readonly recovery?: RecoveryDirective;
}

/**
 * The terminal resolution classes of a case (the four terminals of the case
 * state machine).
 *
 * Source: rails-adapters-reconciliation.md lines 121-123.
 */
export type CaseTerminalResolution =
  | 'MATCHED'
  | 'RESOLVED_CONFIRMED'
  | 'RESOLVED_FAILED'
  | 'RESOLVED_ADJUSTED';

/**
 * The typed recovery links feeding areas 12/9/10, verbatim from Area 14's
 * "Recovery paths from each terminal resolution":
 *   - RESOLVED_CONFIRMED → "area 12 marks the attempt CONFIRMED and
 *     advances finality";
 *   - RESOLVED_FAILED → "area 12 marks the attempt FAILED; a new
 *     instruction may be created, fully evidenced as a new external effect";
 *   - RESOLVED_ADJUSTED → "new linked obligations created via area 9/10
 *     paths".
 *
 * These are type-level links ONLY in RTN-004 (the owning authorities are
 * sibling work items RTN-009/RTN-012's composed runtime); they document and
 * machine-check what each resolution feeds.
 *
 * Source: rails-adapters-reconciliation.md lines 171-179.
 */
export type RecoveryDirective =
  | {
      readonly feed: 'AREA_12_FINALITY_ADVANCE';
      readonly instructionId: string;
      readonly operationId: string;
      readonly attemptOutcome: 'CONFIRMED';
    }
  | {
      readonly feed: 'AREA_12_NEW_INSTRUCTION';
      readonly instructionId: string;
      readonly operationId: string;
      readonly note: 'RECOVERY_IS_A_NEW_INSTRUCTION_NOT_A_RETRY';
    }
  | {
      readonly feed: 'AREA_09_10_NEW_LINKED_ENTRIES';
      readonly caseId: string;
      readonly adjustmentIds: readonly string[];
      readonly linkedPriorEntries: readonly string[];
    };

/**
 * ReconciliationCycleRecord — one periodic matching run.
 *
 * `windowStartWallMs`/`windowEndWallMs` bound the protocol records and
 * external statements matched; `ruleVersion` pins the deterministic matching
 * rules (INV-14-4: "matching rules are pure functions of (protocol record
 * set, external statement set, rule version)").
 *
 * Source: rails-adapters-reconciliation.md lines 133-137, 156-159 (INV-14-4).
 */
export interface ReconciliationCycleRecord {
  readonly cycleId: string;
  readonly status: ReconciliationCycleStatus;
  readonly windowStartWallMs: number;
  readonly windowEndWallMs: number;
  readonly ruleVersion: number;
  readonly sourceIds: readonly string[];
  readonly statementCount: number;
  readonly matchedCount: number;
  readonly discrepancyCount: number;
  readonly openCaseCount: number;
  readonly openedAt: ProtocolTime;
  readonly closedAt?: ProtocolTime;
}

/**
 * ReconciliationSourceRecord — a registered external statement provider.
 * "ReconciliationSource — registered external statement provider (rail
 * settlement report, statement file, on-chain observer), treated as
 * untrusted input with sequence numbers."
 *
 * `lastSequence` is the highest statement sequence number consumed from this
 * source (strictly increasing per source — the untrusted-input discipline).
 *
 * Source: rails-adapters-reconciliation.md lines 139-141.
 */
export interface ReconciliationSourceRecord {
  readonly sourceId: string;
  readonly kind: string;
  readonly description: string;
  readonly lastSequence: number;
  readonly registeredAt: ProtocolTime;
}

/**
 * ExternalStatementRecord — one statement from a source: an UNTRUSTED
 * external claim about a rail operation's effect. Carries the source's
 * sequence number, the rail's reference, the asserted outcome class and the
 * asserted integer amount (GC-1 discipline; the amount is the external
 * claim, not protocol truth — GC-4).
 *
 * Source: rails-adapters-reconciliation.md lines 139-141 (source contract),
 * 133-137 (cycle matches protocol records against external statements),
 * 108-114 (purpose).
 */
export interface ExternalStatementRecord {
  readonly sourceId: string;
  readonly sequence: number;
  readonly railReference: string;
  readonly operationId?: string;
  readonly idempotencyKey?: string;
  readonly outcomeClass: RailReportClass;
  readonly amountMinor: number;
  readonly currency: string;
  readonly assertedAtWallMs: number;
}

/**
 * ReconciliationAdjustment — a NEW linked entry created by a
 * RESOLVED_ADJUSTED resolution or an explicit adjustment command. INV-14-3:
 * "adjustments create new linked obligations or ledger entries; existing
 * evidence and settled records are never rewritten."
 *
 * `links` references the prior entries/records the adjustment corrects — by
 * reference only; nothing is mutated. `operationId` links the originating
 * rail operation when the adjustment comes from an UNKNOWN-origin case.
 *
 * Source: rails-adapters-reconciliation.md lines 127-130, 155-157 (INV-14-3).
 */
export interface ReconciliationAdjustment {
  readonly adjustmentId: string;
  readonly caseId: string;
  readonly operationId?: string;
  readonly links: readonly string[];
  readonly description: string;
  readonly createdAt: ProtocolTime;
}

// ---------------------------------------------------------------------------
// Cross-authority wiring contract (A13 → A14 auto-case, INV-14-1)
// ---------------------------------------------------------------------------

/**
 * The narrow port the Rail Adapter Authority uses to satisfy INV-14-1
 * ("Every UNKNOWN rail operation automatically opens exactly one case"):
 * implemented by the Reconciliation Authority; invoked inside the same
 * store transaction that lands an operation in UNKNOWN, so the case exists
 * atomically with the UNKNOWN state. The opener is idempotent by origin
 * operation id — duplicate case-open attempts are no-ops (work order
 * acceptance: "duplicate case-open attempts are no-ops keyed by origin
 * operation id").
 *
 * Source: rails-adapters-reconciliation.md lines 80-81 ("1. Opens a
 * reconciliation case (area 14) automatically."), lines 124-126, INV-14-1
 * lines 150-152.
 */
export interface UnknownCaseOpener {
  openCaseForUnknownOperation(operation: RailOperationRecord): ReconciliationCaseRecord;
}

// ---------------------------------------------------------------------------
// Command result shape (shared by both authority command surfaces)
// ---------------------------------------------------------------------------

/**
 * The deterministic command result: either the command's value, or a
 * rejection with a reason code from rails/reason-codes.ts. Domain rejections
 * are VALUES, never thrown exceptions — the caller can branch and record.
 */
export type RailsCommandResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reasonCode: string; readonly detail: string };
