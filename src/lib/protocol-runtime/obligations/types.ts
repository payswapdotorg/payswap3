/**
 * RTN-008 — Obligation Ledger Authority: the A10 type vocabulary, the
 * obligation state machine, the ledger entry shapes, and the INV-10-4
 * machine-checked authority gate.
 *
 * Spec sources (binding) — spec/architecture/v0.1/
 * clearing-netting-settlement.md §2 Area 10:
 *   lines 80-87 (Purpose, verbatim):
 *     "Maintain the authoritative ledger of who owes whom what, in which
 *      currency, from which clearing origin, in what lifecycle state. This
 *      ledger is the protocol's financial truth (GC-4); every downstream
 *      netting or settlement fact is a projection of it."
 *   lines 91-103 (Obligation, verbatim):
 *     "Obligation — a single ledger debt entry.
 *      States: CREATED -> NETTED -> SETTLEMENT_PENDING ->
 *      terminal(SETTLED | DISPUTED | WRITTEN_OFF | CANCELLED).
 *      Transitions:
 *      - CREATED -> NETTED: replaced by net positions in a committed
 *        netting set (area 11).
 *      - SETTLEMENT_PENDING: a settlement instruction (area 12) exists.
 *      - SETTLED: settlement finality recorded (area 12).
 *      - DISPUTED: a dispute (area 21) is open; resolution creates new
 *        obligations, never mutates this one.
 *      - WRITTEN_OFF: terminal disposition via risk authority.
 *      - CANCELLED: correction path with mandatory evidence."
 *   lines 104-106 (ObligationLedger, verbatim):
 *     "ObligationLedger — append-only, totally sequenced log of obligation
 *      records and transitions."
 *   lines 108-111 (Owning authority):
 *     "Obligation Ledger Authority (protocol layer, area 10) — the single
 *      financial authority for debt state (GC-4). No product or deployment
 *      component writes or duplicates this ledger."
 *   lines 113-123 (INV-10-1 / INV-10-2 / INV-10-3 / INV-10-4, verbatim):
 *     "INV-10-1 (financial correctness): obligations are integer Money
 *      per currency; the ledger never mutates an amount after creation —
 *      corrections are new linked obligations."
 *     "INV-10-2 (concurrency): ledger transitions are serialized by
 *      sequence; each obligation transitions at most once per state."
 *     "INV-10-3 (idempotency): obligation creation from clearing is keyed
 *      by origin record id; duplicate instructions are no-ops."
 *     "INV-10-4 (authority): only clearing commits, dispute outcomes,
 *      and risk write-offs create or terminalize obligations."
 *   lines 125-131 (failure and UNKNOWN semantics, verbatim):
 *     "The ledger is internal and deterministic; no UNKNOWN state. If a
 *      settlement attempt later becomes UNKNOWN, the obligation remains in
 *      SETTLEMENT_PENDING unchanged until reconciliation resolves the rail
 *      operation (GC-2); finality then advances or fails the obligation
 *      exactly once."
 *   lines 133-137 (evidence produced); lines 139-144 (boundaries).
 *   spec/architecture/v0.1/README.md §3 GC-1/GC-2/GC-4/GC-5 (GC-4 lines
 *     57-61: "The protocol layer owns financial truth: balances,
 *     obligations, net positions, and finality.").
 *   spec/registry/protocol-registry.json A10 — owningAuthority:
 *     "Obligation Authority".
 *   spec/architecture/v0.1/rails-adapters-reconciliation.md lines 119-131
 *     (the A14 case model the UNKNOWN-settlement hold integrates with)
 *     and lines 175-179 ("RESOLVED_ADJUSTED: new linked obligations
 *     created via area 9/10 paths").
 *
 * Transition-table interpretation (recorded in CONTRACT-REVIEW.md):
 *   - The written chain "CREATED -> NETTED -> SETTLEMENT_PENDING ->
 *     terminal(...)" is the HAPPY-PATH order. The transitions are driven
 *     by CONDITIONS, not positions: NETTED only when a committed netting
 *     set replaces the obligation (optional — an obligation may settle
 *     without ever being netted, so CREATED -> SETTLEMENT_PENDING is
 *     legal); SETTLEMENT_PENDING when a settlement instruction exists
 *     (from CREATED or NETTED); SETTLED only from SETTLEMENT_PENDING
 *     ("a settlement instruction (area 12) exists" precedes finality —
 *     "SETTLED: settlement finality recorded (area 12)"); the three
 *     disposition terminals DISPUTED / WRITTEN_OFF / CANCELLED are
 *     reachable from every non-terminal state (their driving conditions
 *     are state-independent: "a dispute (area 21) is open", "terminal
 *     disposition via risk authority", "correction path"). All four
 *     terminals have empty successor sets (one-way; "each obligation
 *     transitions at most once per state" is structural).
 *   - INV-10-4's closed instruction set is materialized as the frozen
 *     INV_10_4_AUTHORITY_GATE table over the closed instruction-kind
 *     union (below): the two CREATING kinds are exactly clearing commits
 *     and dispute outcomes; the disposition TERMINALIZERS are exactly
 *     dispute-open (DISPUTED), risk write-off (WRITTEN_OFF), and the
 *     clearing correction cancel (CANCELLED — the correction path,
 *     INV-10-1: corrections are new linked obligations created via the
 *     clearing path, and the prior obligation's CANCELLED transition is
 *     that same correction's terminalization). The SETTLED advance is
 *     the area-12 finality instruction (A12 INV-12-4: "FINAL advances the
 *     obligation to SETTLED exactly once") — the success completion, not
 *     a disposition; recorded as the one deliberate deviation from the
 *     literal three-path terminalizer list, with the machine check kept:
 *     NO other kind creates or terminalizes anything.
 */

import type { Money } from '../kernel/money.ts';
import type { ProtocolTime } from '../kernel/time.ts';

// ---------------------------------------------------------------------------
// Area 10 — the Obligation state machine
// ---------------------------------------------------------------------------

/**
 * The Obligation state vocabulary, verbatim from the v0.1 chain.
 *
 * Source: clearing-netting-settlement.md lines 92-93 — "States: CREATED
 * -> NETTED -> SETTLEMENT_PENDING -> terminal(SETTLED | DISPUTED |
 * WRITTEN_OFF | CANCELLED)."
 */
export const OBLIGATION_STATES: readonly [
  'CREATED',
  'NETTED',
  'SETTLEMENT_PENDING',
  'SETTLED',
  'DISPUTED',
  'WRITTEN_OFF',
  'CANCELLED',
] = Object.freeze([
  'CREATED',
  'NETTED',
  'SETTLEMENT_PENDING',
  'SETTLED',
  'DISPUTED',
  'WRITTEN_OFF',
  'CANCELLED',
] as const);

/**
 * An Obligation state. SETTLED, DISPUTED, WRITTEN_OFF, and CANCELLED are
 * terminal — empty successor sets make post-terminal transitions
 * unrepresentable.
 *
 * Source: clearing-netting-settlement.md lines 92-93.
 */
export type ObligationState = (typeof OBLIGATION_STATES)[number];

/**
 * The frozen one-way Obligation transition table — the exact v0.1 chain
 * with condition-driven edges (see the module doc's recorded
 * interpretation). SETTLED only from SETTLEMENT_PENDING (finality
 * requires a settlement instruction); the three disposition terminals
 * from every non-terminal state; NETTED only from CREATED (a netted
 * obligation has already been replaced — "replaced by net positions in a
 * committed netting set").
 *
 * Source: clearing-netting-settlement.md lines 92-103.
 */
export const OBLIGATION_TRANSITIONS: Readonly<
  Record<ObligationState, readonly ObligationState[]>
> = Object.freeze({
  CREATED: Object.freeze([
    'NETTED',
    'SETTLEMENT_PENDING',
    'DISPUTED',
    'WRITTEN_OFF',
    'CANCELLED',
  ] as const),
  NETTED: Object.freeze(['SETTLEMENT_PENDING', 'DISPUTED', 'WRITTEN_OFF', 'CANCELLED'] as const),
  SETTLEMENT_PENDING: Object.freeze([
    'SETTLED',
    'DISPUTED',
    'WRITTEN_OFF',
    'CANCELLED',
  ] as const),
  SETTLED: Object.freeze([] as const),
  DISPUTED: Object.freeze([] as const),
  WRITTEN_OFF: Object.freeze([] as const),
  CANCELLED: Object.freeze([] as const),
});

/**
 * Runtime type guard for ObligationState.
 *
 * Source: clearing-netting-settlement.md lines 92-93 (the vocabulary this
 * guard re-checks).
 */
export function isObligationState(value: unknown): value is ObligationState {
  return typeof value === 'string' && (OBLIGATION_STATES as readonly string[]).includes(value);
}

/**
 * True iff the (from, to) pair is a legal one-way Obligation transition.
 *
 * Source: clearing-netting-settlement.md lines 92-103 (the machine this
 * table materializes).
 */
export function canTransitionObligation(from: ObligationState, to: ObligationState): boolean {
  return OBLIGATION_TRANSITIONS[from].includes(to);
}

/**
 * The terminal states of the Obligation machine.
 *
 * Source: clearing-netting-settlement.md lines 92-93 — "terminal(SETTLED
 * | DISPUTED | WRITTEN_OFF | CANCELLED)".
 */
export const OBLIGATION_TERMINAL_STATES: readonly [
  'SETTLED',
  'DISPUTED',
  'WRITTEN_OFF',
  'CANCELLED',
] = Object.freeze(['SETTLED', 'DISPUTED', 'WRITTEN_OFF', 'CANCELLED'] as const);

/**
 * A terminal Obligation state.
 *
 * Source: clearing-netting-settlement.md lines 92-93.
 */
export type ObligationTerminalState = (typeof OBLIGATION_TERMINAL_STATES)[number];

/**
 * Runtime type guard for ObligationTerminalState.
 *
 * Source: clearing-netting-settlement.md lines 92-93.
 */
export function isObligationTerminalState(value: unknown): value is ObligationTerminalState {
  return (
    typeof value === 'string' &&
    (OBLIGATION_TERMINAL_STATES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Area 10 — INV-10-4: the machine-checked authority gate
// ---------------------------------------------------------------------------

/**
 * The closed instruction-kind vocabulary of the Obligation Ledger's write
 * surface — the union over which INV-10-4's authority gate is checked.
 * The three named INV-10-4 paths are: clearing commits
 * (CLEARING_COMMIT, and the correction path's CLEARING_CORRECTION_CANCEL
 * terminalization), dispute outcomes (DISPUTE_OPEN terminalizes,
 * DISPUTE_RESOLUTION creates), and risk write-offs (RISK_WRITE_OFF
 * terminalizes). SETTLEMENT_FINALITY is the area-12 finality advance
 * ("FINAL advances the obligation to SETTLED exactly once", A12
 * INV-12-4). NETTING_COMMIT and SETTLEMENT_INSTRUCTION are lifecycle
 * transitions (area 11 / area 12 instructions) — neither creates nor
 * terminalizes.
 *
 * Source: clearing-netting-settlement.md lines 119-123 (INV-10-4),
 * lines 92-103 (the transition semantics); rails-adapters-
 * reconciliation.md lines 175-179.
 */
export const OBLIGATION_INSTRUCTION_KINDS: readonly [
  'CLEARING_COMMIT',
  'DISPUTE_RESOLUTION',
  'DISPUTE_OPEN',
  'RISK_WRITE_OFF',
  'CLEARING_CORRECTION_CANCEL',
  'SETTLEMENT_FINALITY',
  'NETTING_COMMIT',
  'SETTLEMENT_INSTRUCTION',
] = Object.freeze([
  'CLEARING_COMMIT',
  'DISPUTE_RESOLUTION',
  'DISPUTE_OPEN',
  'RISK_WRITE_OFF',
  'CLEARING_CORRECTION_CANCEL',
  'SETTLEMENT_FINALITY',
  'NETTING_COMMIT',
  'SETTLEMENT_INSTRUCTION',
] as const);

/**
 * One instruction kind of the ledger's closed write surface.
 *
 * Source: clearing-netting-settlement.md lines 119-123 (INV-10-4).
 */
export type ObligationInstructionKind = (typeof OBLIGATION_INSTRUCTION_KINDS)[number];

/**
 * Runtime type guard for ObligationInstructionKind (the closedness
 * machine check's runtime arm: a fabricated kind is rejected before any
 * ledger effect).
 *
 * Source: clearing-netting-settlement.md lines 119-123 (INV-10-4 — the
 * closed authority surface).
 */
export function isObligationInstructionKind(value: unknown): value is ObligationInstructionKind {
  return (
    typeof value === 'string' &&
    (OBLIGATION_INSTRUCTION_KINDS as readonly string[]).includes(value)
  );
}

/**
 * The INV-10-4 machine-checked authority gate: the frozen map from every
 * instruction kind to its authorized ledger effect. The gate's binding
 * rows:
 *   - creates === true ONLY for CLEARING_COMMIT and DISPUTE_RESOLUTION
 *     ("only clearing commits [and] dispute outcomes ... create" —
 *     INV-10-4);
 *   - terminalizes !== null ONLY for DISPUTE_OPEN ('DISPUTED'),
 *     RISK_WRITE_OFF ('WRITTEN_OFF'), CLEARING_CORRECTION_CANCEL
 *     ('CANCELLED' — the correction path), and SETTLEMENT_FINALITY
 *     ('SETTLED' — the area-12 advance; recorded interpretation);
 *   - every other kind creates nothing and terminalizes nothing.
 *
 * This table IS the machine check: the write surface consults it on
 * every apply; the audit (inv10_4Audit) re-checks the written ledger
 * against it; the tests iterate it exhaustively.
 *
 * Source: clearing-netting-settlement.md lines 119-123 (INV-10-4);
 * lines 92-103 (the transition semantics); A12 INV-12-4.
 */
export const INV_10_4_AUTHORITY_GATE: Readonly<
  Record<
    ObligationInstructionKind,
    { readonly creates: boolean; readonly terminalizes: ObligationTerminalState | null }
  >
> = Object.freeze({
  CLEARING_COMMIT: Object.freeze({ creates: true, terminalizes: null }),
  DISPUTE_RESOLUTION: Object.freeze({ creates: true, terminalizes: null }),
  DISPUTE_OPEN: Object.freeze({ creates: false, terminalizes: 'DISPUTED' }),
  RISK_WRITE_OFF: Object.freeze({ creates: false, terminalizes: 'WRITTEN_OFF' }),
  CLEARING_CORRECTION_CANCEL: Object.freeze({ creates: false, terminalizes: 'CANCELLED' }),
  SETTLEMENT_FINALITY: Object.freeze({ creates: false, terminalizes: 'SETTLED' }),
  NETTING_COMMIT: Object.freeze({ creates: false, terminalizes: null }),
  SETTLEMENT_INSTRUCTION: Object.freeze({ creates: false, terminalizes: null }),
});

/**
 * The creation paths of INV-10-4 ("only clearing commits, dispute
 * outcomes, and risk write-offs create or terminalize obligations" —
 * creation belongs to clearing commits and dispute outcomes; a risk
 * write-off is an authorized path that never creates).
 *
 * Source: clearing-netting-settlement.md lines 119-123.
 */
export function inv10_4CreationKinds(): readonly ObligationInstructionKind[] {
  return OBLIGATION_INSTRUCTION_KINDS.filter((kind) => INV_10_4_AUTHORITY_GATE[kind].creates);
}

/**
 * The disposition terminalizers of INV-10-4 mapped by terminal state.
 *
 * Source: clearing-netting-settlement.md lines 119-123, 92-103.
 */
export function inv10_4TerminalKindFor(
  terminal: ObligationTerminalState,
): ObligationInstructionKind {
  for (const kind of OBLIGATION_INSTRUCTION_KINDS) {
    if (INV_10_4_AUTHORITY_GATE[kind].terminalizes === terminal) {
      return kind;
    }
  }
  throw new TypeError(`obligations: no INV-10-4 terminalizer for ${terminal}`);
}

// ---------------------------------------------------------------------------
// Area 10 — the obligation record and terms (INV-10-1)
// ---------------------------------------------------------------------------

/**
 * The obligation terms — "who owes whom what, in which currency": the
 * debtor (who owes), the creditor (whom), and the integer Money amount
 * (what, in which currency). IMMUTABLE by construction: the ledger's
 * write surface accepts terms exactly once, at creation (INV-10-1 — "the
 * ledger never mutates an amount after creation"); every transition
 * command carries NO amount parameter (amount mutation is unrepresentable
 * in the command surface's types).
 *
 * Source: clearing-netting-settlement.md lines 80-83 (the purpose
 * sentence), lines 113-116 (INV-10-1).
 */
export interface ObligationTerms {
  readonly debtorParticipantId: string;
  readonly creditorParticipantId: string;
  readonly amount: Money;
  readonly reason: string;
}

/**
 * Where an obligation came from — "from which clearing origin" (the
 * purpose sentence, lines 80-83): a clearing record (the origin record
 * id + origin activity id + the committing batch id) or a dispute
 * resolution (the dispute id — "resolution creates new obligations,
 * never mutates this one").
 *
 * Source: clearing-netting-settlement.md lines 80-83, 98-100.
 */
export type ObligationOrigin =
  | {
      readonly kind: 'CLEARING';
      readonly originRecordId: string;
      readonly originActivityId: string;
      readonly batchId: string;
    }
  | {
      readonly kind: 'DISPUTE_RESOLUTION';
      readonly disputeId: string;
      readonly resolvedObligationId: string;
    };

/**
 * Obligation — a single ledger debt entry. Deep-frozen at mint; the
 * `linkedPriorObligationId` carries INV-10-1's "corrections are new
 * linked obligations" (and the dispute resolution's link to the resolved
 * obligation).
 *
 * Source: clearing-netting-settlement.md lines 91-103, 113-116.
 */
export interface ObligationRecord {
  readonly obligationId: string;
  readonly terms: ObligationTerms;
  readonly origin: ObligationOrigin;
  /** The prior obligation this one corrects or resolves (linked). */
  readonly linkedPriorObligationId?: string;
  readonly state: ObligationState;
  readonly createdAt: ProtocolTime;
  readonly stateChangedAt: ProtocolTime;
}

// ---------------------------------------------------------------------------
// Area 10 — the append-only, totally sequenced ledger entries
// ---------------------------------------------------------------------------

/**
 * One creation entry of the append-only log: the obligation's full terms
 * (immutable from here on — INV-10-1), its origin, the creation path
 * (INV-10-4 machine-checkable: only 'CLEARING_COMMIT' or
 * 'DISPUTE_RESOLUTION'), and the total-order sequence.
 *
 * Source: clearing-netting-settlement.md lines 104-106 ("append-only,
 * totally sequenced log of obligation records and transitions"), lines
 * 119-121 (INV-10-3), lines 119-123 (INV-10-4).
 */
export interface ObligationCreatedEntry {
  readonly kind: 'OBLIGATION_CREATED';
  /** The total sequence position (INV-10-2). */
  readonly sequence: number;
  readonly obligationId: string;
  readonly terms: ObligationTerms;
  readonly origin: ObligationOrigin;
  readonly linkedPriorObligationId?: string;
  /** The INV-10-4 creation path: 'CLEARING_COMMIT' | 'DISPUTE_RESOLUTION'. */
  readonly createdBy: ObligationInstructionKind;
  readonly when: ProtocolTime;
}

/**
 * One transition entry of the append-only log: from-state, to-state, the
 * driving instruction kind, the cause reference (the netting set id, the
 * settlement instruction id, the finality record id, the dispute id, the
 * risk authority reference, or the correction evidence reference), and
 * the total-order sequence (INV-10-2: "ledger transitions are serialized
 * by sequence").
 *
 * The optional `replacementObligationId` (the correction path's linked
 * replacement) and `replacementObligationIds` (the netting set's net
 * positions) record the driving instruction's replacement references —
 * the INV-10-1 "corrections are new linked obligations" link and the
 * "replaced by net positions" link.
 *
 * Source: clearing-netting-settlement.md lines 104-106, 117-118
 * (INV-10-2); lines 134-135 ("OBLIGATION_STATE_CHANGED (each transition,
 * with cause reference)"); lines 95-103.
 */
export interface ObligationTransitionedEntry {
  readonly kind: 'OBLIGATION_TRANSITIONED';
  /** The total sequence position (INV-10-2). */
  readonly sequence: number;
  readonly obligationId: string;
  readonly from: ObligationState;
  readonly to: ObligationState;
  readonly instructionKind: ObligationInstructionKind;
  /** The cause reference: the driving instruction's identity. */
  readonly causeReference: string;
  /** The correction path's replacement obligation (CANCELLED entries). */
  readonly replacementObligationId?: string;
  /** The netting set's replacement obligations (NETTED entries). */
  readonly replacementObligationIds?: readonly string[];
  readonly when: ProtocolTime;
}

/**
 * One entry of the ObligationLedger — a creation or a transition.
 * Append-only: there is no update, no delete, and no amend kind
 * (INV-10-1 — the log never rewrites; entries are deep-frozen at mint).
 *
 * Source: clearing-netting-settlement.md lines 104-106, 113-118.
 */
export type ObligationLedgerEntry = ObligationCreatedEntry | ObligationTransitionedEntry;

// ---------------------------------------------------------------------------
// Area 10 — reason codes and typed rejections
// ---------------------------------------------------------------------------

/**
 * The Obligation Ledger Authority's reason-code vocabulary — the
 * machine-readable outcomes A10 names: the UNKNOWN-settlement hold
 * ("the obligation remains in SETTLEMENT_PENDING unchanged until
 * reconciliation resolves the rail operation") and the correction
 * linkage ("corrections are new linked obligations"). Frozen.
 *
 * Source: clearing-netting-settlement.md lines 125-131, 113-116.
 */
export const OBLIGATION_REASON_CODES: readonly [
  'SETTLEMENT_UNKNOWN_HELD',
  'CORRECTION_LINKED',
  'DISPUTE_RESOLUTION_REPLACEMENT',
] = Object.freeze([
  'SETTLEMENT_UNKNOWN_HELD',
  'CORRECTION_LINKED',
  'DISPUTE_RESOLUTION_REPLACEMENT',
] as const);

/**
 * An Obligation Ledger Authority reason code.
 *
 * Source: clearing-netting-settlement.md lines 125-131, 113-116.
 */
export type ObligationReasonCode = (typeof OBLIGATION_REASON_CODES)[number];

/**
 * Runtime type guard for ObligationReasonCode.
 *
 * Source: clearing-netting-settlement.md lines 125-131, 113-116.
 */
export function isObligationReasonCode(value: unknown): value is ObligationReasonCode {
  return (
    typeof value === 'string' && (OBLIGATION_REASON_CODES as readonly string[]).includes(value)
  );
}

/**
 * The typed rejection codes of the Obligation Ledger Authority's command
 * surface. OBLIGATION_NOT_FOUND (lookup failure), ILLEGAL_TRANSITION
 * (the frozen machine — including every post-terminal attempt, which is
 * INV-10-2's "at most once per state"), NOT_DISPUTED /
 * DISPUTE_ALREADY_OPEN (the dispute path guards), UNKNOWN_HELD (the
 * GC-2 hold: a transition attempt that would move a SETTLEMENT_PENDING
 * obligation whose settlement attempt is UNKNOWN — surfaced for the
 * composition root, never bypassed), MANDATORY_EVIDENCE_REQUIRED
 * (CANCELLED's "correction path with mandatory evidence").
 *
 * Source: clearing-netting-settlement.md lines 92-103, 113-123,
 * 125-131.
 */
export const OBLIGATION_REJECTION_CODES: readonly [
  'OBLIGATION_NOT_FOUND',
  'ILLEGAL_TRANSITION',
  'NOT_DISPUTED',
  'DISPUTE_ALREADY_OPEN',
  'UNKNOWN_HELD',
  'MANDATORY_EVIDENCE_REQUIRED',
] = Object.freeze([
  'OBLIGATION_NOT_FOUND',
  'ILLEGAL_TRANSITION',
  'NOT_DISPUTED',
  'DISPUTE_ALREADY_OPEN',
  'UNKNOWN_HELD',
  'MANDATORY_EVIDENCE_REQUIRED',
] as const);

/**
 * A typed Obligation Ledger Authority rejection code.
 *
 * Source: clearing-netting-settlement.md lines 92-103, 113-123, 125-131.
 */
export type ObligationRejectionCode = (typeof OBLIGATION_REJECTION_CODES)[number];

/**
 * Runtime type guard for ObligationRejectionCode.
 *
 * Source: clearing-netting-settlement.md lines 92-131.
 */
export function isObligationRejectionCode(value: unknown): value is ObligationRejectionCode {
  return (
    typeof value === 'string' &&
    (OBLIGATION_REJECTION_CODES as readonly string[]).includes(value)
  );
}

/**
 * The typed result shape of every Obligation Ledger Authority command.
 *
 * Source: the merged command convention (RTN-005/006/007); the A10
 * invariants the rejections ground (lines 92-131).
 */
export type ObligationCommandResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ObligationRejectionCode; readonly message: string };
