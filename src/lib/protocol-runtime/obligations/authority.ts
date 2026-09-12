/**
 * RTN-008 — Obligation Ledger Authority: the composed single-writer
 * command surface for area 10 (A10) — the closed INV-10-4 write surface
 * over the append-only, totally sequenced ObligationLedger.
 *
 * Spec sources (binding) — spec/architecture/v0.1/
 * clearing-netting-settlement.md §2 Area 10:
 *   lines 80-87 (Purpose — "the authoritative ledger of who owes whom
 *     what ... the protocol's financial truth (GC-4)").
 *   lines 91-103 (Obligation — the exact state machine and transition
 *     semantics, quoted in types.ts).
 *   lines 104-106 (ObligationLedger — "append-only, totally sequenced
 *     log of obligation records and transitions").
 *   lines 108-111 (Owning authority):
 *     "Obligation Ledger Authority (protocol layer, area 10) — the
 *      single financial authority for debt state (GC-4). No product or
 *      deployment component writes or duplicates this ledger."
 *   lines 113-123 (the four invariants, enforced here):
 *     "INV-10-1 (financial correctness): obligations are integer Money
 *      per currency; the ledger never mutates an amount after creation —
 *      corrections are new linked obligations.
 *      INV-10-2 (concurrency): ledger transitions are serialized by
 *      sequence; each obligation transitions at most once per state.
 *      INV-10-3 (idempotency): obligation creation from clearing is keyed
 *      by origin record id; duplicate instructions are no-ops.
 *      INV-10-4 (authority): only clearing commits, dispute outcomes,
 *      and risk write-offs create or terminalize obligations."
 *   lines 125-131 (failure and UNKNOWN semantics, verbatim):
 *     "The ledger is internal and deterministic; no UNKNOWN state. If a
 *      settlement attempt later becomes UNKNOWN, the obligation remains in
 *      SETTLEMENT_PENDING unchanged until reconciliation resolves the rail
 *      operation (GC-2); finality then advances or fails the obligation
 *      exactly once."
 *   lines 133-137 (evidence produced); lines 139-144 (boundaries — "The
 *     ledger never calls rails and never computes netting").
 *   spec/architecture/v0.1/README.md §3 GC-1/GC-2/GC-4/GC-5.
 *   spec/architecture/v0.1/rails-adapters-reconciliation.md lines 119-131
 *     (the A14 case model the settlement hold integrates with) and lines
 *     175-179 ("new linked obligations created via area 9/10 paths").
 *
 * Command discipline (the INV-10-4 machine-checked gate):
 *   - The write surface is a CLOSED instruction set: exactly one typed
 *     command per instruction kind of OBLIGATION_INSTRUCTION_KINDS, plus
 *     the generic applyInstruction entry that validates the kind against
 *     the closed runtime guard and dispatches. Every mutating handler
 *     consults the frozen INV_10_4_AUTHORITY_GATE row for its kind: the
 *     creation handlers assert gate.creates === true; the disposition
 *     handlers assert gate.terminalizes === their target; the lifecycle
 *     handlers assert both null. NO other write path exists — the
 *     ObligationLedger's appendEntry is the authority's state carrier
 *     (single-writer discipline; the merged RailsStore precedent).
 *   - Creation: ONLY applyClearingCommand (kind CLEARING_COMMIT — the
 *     Clearing Authority's instruction; INV-10-3 idempotent keyed by the
 *     origin record id) and applyDisputeResolution (kind
 *     DISPUTE_RESOLUTION — "resolution creates new obligations, never
 *     mutates this one"). A risk write-off never creates.
 *   - Terminalization: DISPUTED ← openDispute; WRITTEN_OFF ←
 *     applyRiskWriteOff ("terminal disposition via risk authority");
 *     CANCELLED ← applyClearingCorrectionCancel (the correction path,
 *     with mandatory evidence; INV-10-1 — the corrected obligation is a
 *     NEW linked obligation created via the clearing path); SETTLED ←
 *     applySettlementFinality (the area-12 finality advance: "FINAL
 *     advances the obligation to SETTLED exactly once" — recorded
 *     interpretation).
 *   - Lifecycle (neither creation nor terminalization):
 *     applyNettingCommit (area-11 instruction — "obligation transitions
 *     remain owned by area 10, executed only on Netting Authority
 *     instruction", core.md-free: clearing-netting-settlement.md A11
 *     boundaries) and applySettlementInstruction ("a settlement
 *     instruction (area 12) exists").
 *   - The UNKNOWN-settlement hold (GC-2): the surface exposes NO
 *     transition driven by an UNKNOWN observation. The injectable
 *     settlementHold probe (the composition root wires the rails
 *     case-model query) makes applySettlementFinality REFUSE with the
 *     typed UNKNOWN_HELD rejection while the obligation's settlement
 *     attempt is an unresolved UNKNOWN — "the obligation remains in
 *     SETTLEMENT_PENDING unchanged until reconciliation resolves the rail
 *     operation"; after the resolution the probe clears and finality
 *     advances exactly once.
 *   - Evidence FIRST (awaited), then the entry append: the entry's ledger
 *     sequence is PEEKED (not consumed) to build the record's when/proof,
 *     the A15 record is submitted, and only then does the entry commit —
 *     "an operation is not committed until its record is written. A
 *     failed write fails the operation" (A15 lines 62-64), with the
 *     sequence staying gapless (totally ordered) on failure.
 *   - Every command runs under ONE global serializer key (the ledger is
 *     one totally-sequenced log — INV-10-2).
 *   - Domain rejections are typed values, never thrown; input-shape
 *     violations throw TypeError (kernel convention). Duplicate creation
 *     instructions are no-ops returning the recorded obligation
 *     (INV-10-3); no-ops emit no evidence record.
 *
 * State layer (recorded in CONTRACT-REVIEW.md): in-process single writer —
 * the RTN-002/RTN-005/RTN-007 in-process-object-store precedent. The
 * durable side is persistence.ts + migrations/.
 */

import type { Money } from '../kernel/money.ts';
import type { EvidenceSubmission } from '../kernel/ports.ts';
import { isMoney } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { deepFreeze } from './freeze.ts';
import {
  obligationCreatedEvidence,
  submitObligationEvidence,
  transitionEvidence,
} from './evidence.ts';
import { ObligationLedger } from './ledger.ts';
import { KeyedSerializer } from './serializer.ts';
import {
  hashObligationTerms,
  obligationIdForDisputeReplacement,
  obligationIdForOriginRecord,
  transitionObligation,
} from './state-machine.ts';
import type {
  ObligationCommandResult,
  ObligationCreatedEntry,
  ObligationInstructionKind,
  ObligationOrigin,
  ObligationRecord,
  ObligationTerms,
  ObligationTransitionedEntry,
} from './types.ts';
import {
  INV_10_4_AUTHORITY_GATE,
  OBLIGATION_INSTRUCTION_KINDS,
  isObligationInstructionKind,
  isObligationState,
} from './types.ts';

/**
 * One obligation creation instruction as the CLEARING Authority submits
 * it — structurally identical to clearing/authority.ts's
 * ObligationCreationInstruction (the sibling-surface composition: this
 * work order owns both sides, so the shapes are co-designed and checked
 * by the compiled contract tests).
 *
 * Source: clearing-netting-settlement.md lines 42-45 ("the only creator
 * of obligation creation instructions"), lines 119-121 (INV-10-3).
 */
export interface ClearingCreationInstruction {
  readonly kind: 'CLEARING_COMMIT';
  readonly batchId: string;
  readonly recordId: string;
  readonly originActivityId: string;
  readonly originKind: 'ROUTE_PLAN_HOP' | 'INTENT' | 'RECONCILIATION_ADJUSTMENT';
  readonly debtorParticipantId: string;
  readonly creditorParticipantId: string;
  readonly amount: Money;
  readonly reason: string;
  /** The prior obligation this instruction corrects (correction records). */
  readonly correctionOf?: string;
}

/**
 * The correction-path terminalization: the prior obligation's CANCELLED
 * transition — "CANCELLED: correction path with mandatory evidence". The
 * `evidenceReference` is MANDATORY (non-empty — the shape guard throws
 * otherwise) and names the correction's evidence (the reconciliation
 * case/adjustment reference); the `replacementObligationId` is the NEW
 * linked obligation the same correction created (INV-10-1 — "corrections
 * are new linked obligations").
 *
 * Source: clearing-netting-settlement.md lines 102-103, 113-116;
 * rails-adapters-reconciliation.md lines 175-179.
 */
export interface ClearingCorrectionCancelInstruction {
  readonly kind: 'CLEARING_CORRECTION_CANCEL';
  readonly obligationId: string;
  readonly replacementObligationId: string;
  readonly evidenceReference: string;
}

/**
 * The dispute opening: "DISPUTED: a dispute (area 21) is open" — the
 * obligation's terminalization into DISPUTED, driven by the dispute
 * reference.
 *
 * Source: clearing-netting-settlement.md lines 98-99.
 */
export interface DisputeOpenInstruction {
  readonly kind: 'DISPUTE_OPEN';
  readonly obligationId: string;
  readonly disputeId: string;
}

/**
 * The dispute resolution: "resolution creates new obligations, never
 * mutates this one" — each replacement becomes a NEW linked obligation
 * (linked to the resolved one), keyed deterministically by (dispute id,
 * replacement index) so duplicate resolutions no-op exactly like
 * INV-10-3's clearing duplicates.
 *
 * Source: clearing-netting-settlement.md lines 98-100.
 */
export interface DisputeResolutionInstruction {
  readonly kind: 'DISPUTE_RESOLUTION';
  readonly disputeId: string;
  readonly resolvedObligationId: string;
  readonly replacements: readonly {
    readonly debtorParticipantId: string;
    readonly creditorParticipantId: string;
    readonly amount: Money;
    readonly reason: string;
  }[];
}

/**
 * The risk write-off: "WRITTEN_OFF: terminal disposition via risk
 * authority" — the riskAuthorityReference identifies the risk
 * disposition (recorded in the OBLIGATION_WRITTEN_OFF evidence: "risk
 * authority reference").
 *
 * Source: clearing-netting-settlement.md lines 100-101, 135-136.
 */
export interface RiskWriteOffInstruction {
  readonly kind: 'RISK_WRITE_OFF';
  readonly obligationId: string;
  readonly riskAuthorityReference: string;
}

/**
 * The netting commit (area-11 instruction): "CREATED -> NETTED: replaced
 * by net positions in a committed netting set (area 11)" — the
 * replacement obligation ids the committed netting set produced (may be
 * empty: a pairwise net to zero produces no net obligation).
 *
 * Source: clearing-netting-settlement.md lines 95-97, 177-179 (A11
 * boundaries: "obligation transitions remain owned by area 10, executed
 * only on Netting Authority instruction").
 */
export interface NettingCommitInstruction {
  readonly kind: 'NETTING_COMMIT';
  readonly obligationId: string;
  readonly nettingSetId: string;
  readonly replacementObligationIds: readonly string[];
}

/**
 * The settlement instruction (area-12): "SETTLEMENT_PENDING: a settlement
 * instruction (area 12) exists".
 *
 * Source: clearing-netting-settlement.md lines 97-98.
 */
export interface SettlementInstructionApplied {
  readonly kind: 'SETTLEMENT_INSTRUCTION';
  readonly obligationId: string;
  readonly settlementInstructionId: string;
}

/**
 * The settlement finality advance (area-12): "SETTLED: settlement
 * finality recorded (area 12)" and A12 INV-12-4: "FINAL advances the
 * obligation to SETTLED exactly once" — only from SETTLEMENT_PENDING,
 * exactly once, irreversible.
 *
 * Source: clearing-netting-settlement.md lines 97-99;
 * rails-adapters-reconciliation.md §4 Area 12 (INV-12-4).
 */
export interface SettlementFinalityInstruction {
  readonly kind: 'SETTLEMENT_FINALITY';
  readonly obligationId: string;
  readonly finalityRecordId: string;
}

/**
 * The closed write-instruction union of the Obligation Ledger Authority —
 * the INV-10-4 machine-checked surface: every member's kind is one of
 * OBLIGATION_INSTRUCTION_KINDS; the gate table maps each kind to its
 * authorized effect; applyInstruction validates membership at runtime.
 *
 * Source: clearing-netting-settlement.md lines 119-123 (INV-10-4).
 */
export type ObligationWriteInstruction =
  | ClearingCreationInstruction
  | ClearingCorrectionCancelInstruction
  | DisputeOpenInstruction
  | DisputeResolutionInstruction
  | RiskWriteOffInstruction
  | NettingCommitInstruction
  | SettlementInstructionApplied
  | SettlementFinalityInstruction;

/**
 * The settlement-hold probe: true while the obligation's settlement
 * attempt is an UNRESOLVED UNKNOWN rail operation ("the obligation
 * remains in SETTLEMENT_PENDING unchanged until reconciliation resolves
 * the rail operation"). The composition root wires the rails case-model
 * query (the obligation's settlement instruction → its rail operation →
 * UNKNOWN state); the default never holds.
 *
 * Source: clearing-netting-settlement.md lines 125-131; README.md §3
 * GC-2.
 */
export type SettlementHoldProbe = (obligationId: string) => boolean;

/**
 * Constructor dependencies for the Obligation Ledger Authority.
 *
 * Source: the wave evidence discipline (the REAL RTN-002 log through the
 * kernel port); the settlement-hold probe; the wallClock-injection
 * convention for deterministic tests.
 */
export interface ObligationLedgerAuthorityDeps {
  /** The EvidenceSubmission port — the real RTN-002 EvidenceLog. */
  readonly evidence: EvidenceSubmission;
  /** The settlement UNKNOWN-hold probe (default: never held). */
  readonly settlementHold?: SettlementHoldProbe;
  /** Injectable wall clock (epoch ms) for deterministic tests; default Date.now. */
  readonly wallClock?: () => number;
}

const LEDGER_KEY = 'obligation-ledger.pipeline';

/**
 * The outcome of one creation instruction: the obligation id and whether
 * the instruction was a duplicate no-op (INV-10-3).
 *
 * Source: clearing-netting-settlement.md lines 119-121.
 */
export interface ClearingCreationOutcome {
  readonly obligationId: string;
  readonly duplicate: boolean;
}

/**
 * The Obligation Ledger Authority: the single financial authority for
 * debt state (GC-4) — the closed INV-10-4 write surface over the
 * append-only, totally sequenced ObligationLedger.
 *
 * Source: clearing-netting-settlement.md lines 108-111.
 */
export class ObligationLedgerAuthority {
  private readonly evidence: EvidenceSubmission;
  private readonly settlementHold: SettlementHoldProbe;
  private readonly wallClock: () => number;
  private readonly pipeline = new KeyedSerializer();
  private readonly ledger = new ObligationLedger();

  constructor(deps: ObligationLedgerAuthorityDeps) {
    this.evidence = deps.evidence;
    this.settlementHold = deps.settlementHold ?? (() => false);
    this.wallClock = deps.wallClock ?? (() => Date.now());
  }

  // -------------------------------------------------------------------------
  // Read surface (projections — GC-4: every downstream fact is a
  // projection of the ledger)
  // -------------------------------------------------------------------------

  /** The underlying append-only ledger (the state carrier; read use). */
  get log(): ObligationLedger {
    return this.ledger;
  }

  /** The obligation record by id (the projection fold for one id). */
  obligation(obligationId: string): ObligationRecord | undefined {
    return this.ledger.foldOne(obligationId);
  }

  /** Does the ledger hold this obligation (the clearing sink's probe)? */
  hasObligation(obligationId: string): boolean {
    return this.ledger.foldOne(obligationId) !== undefined;
  }

  /** The full projection (the fold of the entire entry log). */
  obligations(): readonly ObligationRecord[] {
    return this.ledger.fold();
  }

  // -------------------------------------------------------------------------
  // The generic closed-surface entry (runtime closedness of INV-10-4)
  // -------------------------------------------------------------------------

  /**
   * Apply one write instruction through the CLOSED surface: the kind is
   * validated against OBLIGATION_INSTRUCTION_KINDS (a fabricated kind is
   * a TypeError — the closed-union machine check's runtime arm), the
   * handler consults the INV-10-4 gate row for its kind, and the
   * instruction dispatches to the typed command's core. The typed
   * commands below delegate here — ONE dispatch path, one gate.
   *
   * Source: clearing-netting-settlement.md lines 119-123 (INV-10-4).
   */
  applyInstruction(
    instruction: ObligationWriteInstruction,
  ): Promise<
    ObligationCommandResult<ObligationRecord | ClearingCreationOutcome | ClearingCreationOutcome[]>
  > {
    if (
      instruction === null ||
      typeof instruction !== 'object' ||
      typeof (instruction as { kind?: unknown }).kind !== 'string'
    ) {
      throw new TypeError('obligations authority: instruction must be an object with a kind');
    }
    const kind = (instruction as { kind: unknown }).kind;
    if (!isObligationInstructionKind(kind)) {
      throw new TypeError(
        `obligations authority: instruction kind ${JSON.stringify(kind)} is outside the closed INV-10-4 surface (${OBLIGATION_INSTRUCTION_KINDS.join(' | ')})`,
      );
    }
    switch (kind) {
      case 'CLEARING_COMMIT':
        return this.applyClearingCommand(instruction as ClearingCreationInstruction).then(
          (outcome) => ({ ok: true as const, value: outcome }) as const,
        );
      case 'DISPUTE_RESOLUTION':
        return this.applyDisputeResolution(
          instruction as unknown as DisputeResolutionInstruction & { resolvedObligationId: string },
        );
      default:
        return this.dispatchTransition(
          instruction as unknown as TransitionInstruction,
        ) as Promise<ObligationCommandResult<ObligationRecord>>;
    }
  }

  // -------------------------------------------------------------------------
  // Creation commands (INV-10-4: clearing commits, dispute outcomes)
  // -------------------------------------------------------------------------

  /**
   * Apply one obligation creation instruction from the Clearing Authority
   * — the ONLY creation path from clearing ("the only creator of
   * obligation creation instructions"). INV-10-3: the obligation id is
   * derived from the origin record id ("keyed by origin record id"); a
   * duplicate instruction is a no-op returning the recorded obligation
   * (no entry, no evidence — the second financial effect is impossible by
   * construction). `correctionOf` links the new obligation to the prior
   * one it corrects (INV-10-1 — "corrections are new linked
   * obligations"); the referenced prior obligation must exist.
   *
   * Throws TypeError on malformed input (shape violations — kernel
   * convention) and on a correctionOf referencing a nonexistent prior
   * obligation (the invalid-reference failure fails the caller's
   * operation).
   *
   * Source: clearing-netting-settlement.md lines 42-45, 113-121, 92-103.
   */
  async applyClearingCommand(
    instruction: Omit<ClearingCreationInstruction, 'kind'>,
  ): Promise<ClearingCreationOutcome> {
    assertCreationInput(instruction);
    return this.pipeline.run(LEDGER_KEY, async () => {
      const gate = INV_10_4_AUTHORITY_GATE.CLEARING_COMMIT;
      if (!gate.creates) {
        throw new TypeError('obligations authority: INV-10-4 gate violation on CLEARING_COMMIT');
      }
      const obligationId = obligationIdForOriginRecord(instruction.recordId);
      const existing = this.ledger.foldOne(obligationId);
      if (existing !== undefined) {
        // INV-10-3 duplicate no-op: return the recorded obligation.
        return { obligationId, duplicate: true };
      }
      if (
        instruction.correctionOf !== undefined &&
        this.ledger.foldOne(instruction.correctionOf) === undefined
      ) {
        throw new TypeError(
          `obligations authority: correctionOf ${instruction.correctionOf} does not reference an obligation in the ledger (INV-10-1: corrections are new linked obligations)`,
        );
      }
      const origin: ObligationOrigin = {
        kind: 'CLEARING',
        originRecordId: instruction.recordId,
        originActivityId: instruction.originActivityId,
        batchId: instruction.batchId,
      };
      const entry = await this.writeCreation({
        obligationId,
        terms: {
          debtorParticipantId: instruction.debtorParticipantId,
          creditorParticipantId: instruction.creditorParticipantId,
          amount: instruction.amount,
          reason: instruction.reason,
        },
        origin,
        linkedPriorObligationId: instruction.correctionOf,
        createdBy: 'CLEARING_COMMIT',
      });
      return { obligationId: entry.obligationId, duplicate: false };
    });
  }

  /**
   * Apply one dispute resolution — "resolution creates new obligations,
   * never mutates this one": each replacement becomes a NEW obligation
   * (CREATED, linked to the resolved obligation, origin
   * DISPUTE_RESOLUTION); the resolved obligation itself is NEVER mutated
   * (it stays DISPUTED). Idempotent per (dispute id, replacement index):
   * a duplicate application no-ops the already-created replacements and
   * reports them as duplicates.
   *
   * Source: clearing-netting-settlement.md lines 98-100, 119-123
   * (INV-10-4 — dispute outcomes create).
   */
  async applyDisputeResolution(
    instruction: DisputeResolutionInstruction,
  ): Promise<ObligationCommandResult<ClearingCreationOutcome[]>> {
    assertDisputeResolutionInput(instruction);
    return this.pipeline.run(LEDGER_KEY, async () => {
      const gate = INV_10_4_AUTHORITY_GATE.DISPUTE_RESOLUTION;
      if (!gate.creates) {
        throw new TypeError('obligations authority: INV-10-4 gate violation on DISPUTE_RESOLUTION');
      }
      const resolved = this.ledger.foldOne(instruction.resolvedObligationId);
      if (resolved === undefined) {
        return {
          ok: false,
          code: 'OBLIGATION_NOT_FOUND' as const,
          message: `obligations authority: resolved obligation ${instruction.resolvedObligationId} not found`,
        };
      }
      if (resolved.state !== 'DISPUTED') {
        return {
          ok: false,
          code: 'NOT_DISPUTED' as const,
          message: `obligations authority: dispute resolution requires the obligation in DISPUTED (got ${resolved.state})`,
        };
      }
      const outcomes: ClearingCreationOutcome[] = [];
      for (let index = 0; index < instruction.replacements.length; index += 1) {
        const replacement = instruction.replacements[index] as NonNullable<
          (typeof instruction.replacements)[number]
        >;
        const obligationId = obligationIdForDisputeReplacement(instruction.disputeId, index);
        const existing = this.ledger.foldOne(obligationId);
        if (existing !== undefined) {
          outcomes.push({ obligationId, duplicate: true });
          continue;
        }
        const origin: ObligationOrigin = {
          kind: 'DISPUTE_RESOLUTION',
          disputeId: instruction.disputeId,
          resolvedObligationId: instruction.resolvedObligationId,
        };
        const entry = await this.writeCreation({
          obligationId,
          terms: {
            debtorParticipantId: replacement.debtorParticipantId,
            creditorParticipantId: replacement.creditorParticipantId,
            amount: replacement.amount,
            reason: replacement.reason,
          },
          origin,
          linkedPriorObligationId: instruction.resolvedObligationId,
          createdBy: 'DISPUTE_RESOLUTION',
        });
        outcomes.push({ obligationId: entry.obligationId, duplicate: false });
      }
      return { ok: true, value: outcomes };
    });
  }

  // -------------------------------------------------------------------------
  // Terminalization commands (INV-10-4: dispute, risk, correction; and
  // the area-12 finality advance)
  // -------------------------------------------------------------------------

  /**
   * Open a dispute — the DISPUTED terminalization: "DISPUTED: a dispute
   * (area 21) is open". Terminal: a disputed obligation is never mutated
   * by its resolution (the resolution creates new obligations).
   *
   * Source: clearing-netting-settlement.md lines 98-99, 119-123.
   */
  async openDispute(
    instruction: DisputeOpenInstruction,
  ): Promise<ObligationCommandResult<ObligationRecord>> {
    assertObligationId(instruction?.obligationId);
    assertNonEmpty(instruction?.disputeId, 'disputeId');
    return this.pipeline.run(LEDGER_KEY, async () => {
      this.assertGateTerminalizes('DISPUTE_OPEN', 'DISPUTED');
      return this.transition('DISPUTE_OPEN', instruction.obligationId, instruction.disputeId);
    });
  }

  /**
   * Apply one risk write-off — the WRITTEN_OFF terminalization: "terminal
   * disposition via risk authority". Emits the OBLIGATION_WRITTEN_OFF
   * record carrying the risk authority reference.
   *
   * Source: clearing-netting-settlement.md lines 100-101, 135-136,
   * 119-123.
   */
  async applyRiskWriteOff(
    instruction: RiskWriteOffInstruction,
  ): Promise<ObligationCommandResult<ObligationRecord>> {
    assertObligationId(instruction?.obligationId);
    assertNonEmpty(instruction?.riskAuthorityReference, 'riskAuthorityReference');
    return this.pipeline.run(LEDGER_KEY, async () => {
      this.assertGateTerminalizes('RISK_WRITE_OFF', 'WRITTEN_OFF');
      return this.transition(
        'RISK_WRITE_OFF',
        instruction.obligationId,
        instruction.riskAuthorityReference,
      );
    });
  }

  /**
   * Apply one clearing correction cancel — the CANCELLED terminalization:
   * "CANCELLED: correction path with mandatory evidence". The mandatory
   * evidence reference names the correction's evidence (the
   * reconciliation case/adjustment reference); the replacement obligation
   * is the NEW linked obligation the same correction created (INV-10-1).
   *
   * Source: clearing-netting-settlement.md lines 102-103, 113-116,
   * 119-123.
   */
  async applyClearingCorrectionCancel(
    instruction: ClearingCorrectionCancelInstruction,
  ): Promise<ObligationCommandResult<ObligationRecord>> {
    assertObligationId(instruction?.obligationId);
    assertNonEmpty(instruction?.replacementObligationId, 'replacementObligationId');
    assertNonEmpty(instruction?.evidenceReference, 'evidenceReference');
    return this.pipeline.run(LEDGER_KEY, async () => {
      this.assertGateTerminalizes('CLEARING_CORRECTION_CANCEL', 'CANCELLED');
      return this.transition(
        'CLEARING_CORRECTION_CANCEL',
        instruction.obligationId,
        instruction.evidenceReference,
        instruction.replacementObligationId,
      );
    });
  }

  /**
   * Apply one settlement finality advance — the SETTLED terminalization:
   * "SETTLED: settlement finality recorded (area 12)" / A12 INV-12-4
   * ("FINAL advances the obligation to SETTLED exactly once"). Only from
   * SETTLEMENT_PENDING; terminal; a second advance is the typed
   * ILLEGAL_TRANSITION rejection. While the settlement-hold probe says
   * the attempt is an unresolved UNKNOWN, the advance is REFUSED with
   * the typed UNKNOWN_HELD rejection — "the obligation remains in
   * SETTLEMENT_PENDING unchanged until reconciliation resolves the rail
   * operation" (GC-2).
   *
   * Source: clearing-netting-settlement.md lines 97-99, 125-131; A12
   * INV-12-4.
   */
  async applySettlementFinality(
    instruction: SettlementFinalityInstruction,
  ): Promise<ObligationCommandResult<ObligationRecord>> {
    assertObligationId(instruction?.obligationId);
    assertNonEmpty(instruction?.finalityRecordId, 'finalityRecordId');
    return this.pipeline.run(LEDGER_KEY, async () => {
      this.assertGateTerminalizes('SETTLEMENT_FINALITY', 'SETTLED');
      const obligation = this.ledger.foldOne(instruction.obligationId);
      if (obligation === undefined) {
        return obligationNotFound(instruction.obligationId);
      }
      if (obligation.state === 'SETTLEMENT_PENDING' && this.settlementHold(instruction.obligationId)) {
        return {
          ok: false,
          code: 'UNKNOWN_HELD' as const,
          message: `obligations authority: obligation ${instruction.obligationId} is held at SETTLEMENT_PENDING — its settlement attempt is an unresolved UNKNOWN rail operation (GC-2); finality advances only after reconciliation resolves it`,
        };
      }
      return this.transition(
        'SETTLEMENT_FINALITY',
        instruction.obligationId,
        instruction.finalityRecordId,
      );
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle commands (neither creation nor terminalization)
  // -------------------------------------------------------------------------

  /**
   * Apply one netting commit (the area-11 instruction): CREATED -> NETTED
   * — "replaced by net positions in a committed netting set (area 11)".
   * The replacement obligation ids are recorded in the transition entry
   * (the net positions; possibly empty when a pairwise net nets to zero).
   *
   * Source: clearing-netting-settlement.md lines 95-97.
   */
  async applyNettingCommit(
    instruction: NettingCommitInstruction,
  ): Promise<ObligationCommandResult<ObligationRecord>> {
    assertObligationId(instruction?.obligationId);
    assertNonEmpty(instruction?.nettingSetId, 'nettingSetId');
    if (
      instruction?.replacementObligationIds === undefined ||
      !Array.isArray(instruction.replacementObligationIds)
    ) {
      throw new TypeError('obligations authority: replacementObligationIds must be an array');
    }
    for (const id of instruction.replacementObligationIds) {
      assertNonEmpty(id, 'replacementObligationIds member');
    }
    return this.pipeline.run(LEDGER_KEY, async () => {
      this.assertGateLifecycle('NETTING_COMMIT');
      return this.transition(
        'NETTING_COMMIT',
        instruction.obligationId,
        instruction.nettingSetId,
        undefined,
        instruction.replacementObligationIds,
      );
    });
  }

  /**
   * Apply one settlement instruction (the area-12 event): "SETTLEMENT_
   * PENDING: a settlement instruction (area 12) exists" — the transition
   * when the FIRST instruction for the obligation exists. A second
   * instruction while already SETTLEMENT_PENDING (area-12's recovery: "a
   * new instruction may be created, fully evidenced") is a typed NO-OP
   * (applied: false; no entry, no evidence — the state already says an
   * instruction exists).
   *
   * Source: clearing-netting-settlement.md lines 97-98;
   * rails-adapters-reconciliation.md lines 175-177.
   */
  async applySettlementInstruction(
    instruction: SettlementInstructionApplied,
  ): Promise<
    ObligationCommandResult<{ readonly obligation: ObligationRecord; readonly applied: boolean }>
  > {
    assertObligationId(instruction?.obligationId);
    assertNonEmpty(instruction?.settlementInstructionId, 'settlementInstructionId');
    return this.pipeline.run(LEDGER_KEY, async () => {
      this.assertGateLifecycle('SETTLEMENT_INSTRUCTION');
      const obligation = this.ledger.foldOne(instruction.obligationId);
      if (obligation === undefined) {
        return obligationNotFound(instruction.obligationId);
      }
      if (obligation.state === 'SETTLEMENT_PENDING') {
        return { ok: true, value: { obligation, applied: false } };
      }
      const transitioned = await this.transition(
        'SETTLEMENT_INSTRUCTION',
        instruction.obligationId,
        instruction.settlementInstructionId,
      );
      if (!transitioned.ok) {
        return transitioned;
      }
      return { ok: true, value: { obligation: transitioned.value, applied: true } };
    });
  }

  // -------------------------------------------------------------------------
  // Internal: the single gated write path
  // -------------------------------------------------------------------------

  private assertGateTerminalizes(
    kind: ObligationInstructionKind,
    target: string,
  ): void {
    const gate = INV_10_4_AUTHORITY_GATE[kind];
    if (gate.terminalizes !== target) {
      throw new TypeError(
        `obligations authority: INV-10-4 gate violation — ${kind} must terminalize ${target}`,
      );
    }
  }

  private assertGateLifecycle(kind: ObligationInstructionKind): void {
    const gate = INV_10_4_AUTHORITY_GATE[kind];
    if (gate.creates || gate.terminalizes !== null) {
      throw new TypeError(
        `obligations authority: INV-10-4 gate violation — ${kind} must be a lifecycle-only instruction`,
      );
    }
  }

  private async writeCreation(input: {
    readonly obligationId: string;
    readonly terms: ObligationTerms;
    readonly origin: ObligationOrigin;
    readonly linkedPriorObligationId?: string;
    readonly createdBy: ObligationInstructionKind;
  }): Promise<{ readonly obligationId: string }> {
    const sequence = this.ledger.peekNextSequence();
    const when = protocolTime(sequence, this.wallClock());
    const entry: ObligationCreatedEntry = deepFreeze({
      kind: 'OBLIGATION_CREATED',
      sequence,
      obligationId: input.obligationId,
      terms: input.terms,
      origin: input.origin,
      ...(input.linkedPriorObligationId !== undefined
        ? { linkedPriorObligationId: input.linkedPriorObligationId }
        : {}),
      createdBy: input.createdBy,
      when,
    });
    // Evidence FIRST (A15 lines 62-64): the record is submitted before
    // the entry commits; a failed write fails the operation with NO
    // ledger effect and NO sequence gap.
    await submitObligationEvidence(this.evidence, obligationCreatedEvidence(entry));
    this.ledger.appendEntry(entry);
    return { obligationId: input.obligationId };
  }

  private async transition(
    instructionKind: ObligationInstructionKind,
    obligationId: string,
    causeReference: string,
    replacementObligationId?: string,
    replacementObligationIds?: readonly string[],
  ): Promise<ObligationCommandResult<ObligationRecord>> {
    const obligation = this.ledger.foldOne(obligationId);
    if (obligation === undefined) {
      return obligationNotFound(obligationId);
    }
    const target = gateTargetOf(instructionKind);
    const transitioned = transitionObligation(obligation, target, protocolTime(0, 0));
    if (!transitioned.ok) {
      return {
        ok: false,
        code: 'ILLEGAL_TRANSITION' as const,
        message: `obligations authority: obligation ${obligationId} cannot transition ${obligation.state} -> ${target} (the exact machine; INV-10-2: at most one transition per state)`,
      };
    }
    const sequence = this.ledger.peekNextSequence();
    const when = protocolTime(sequence, this.wallClock());
    const entry: ObligationTransitionedEntry = deepFreeze({
      kind: 'OBLIGATION_TRANSITIONED',
      sequence,
      obligationId,
      from: obligation.state,
      to: target,
      instructionKind,
      causeReference,
      when,
      ...(replacementObligationId !== undefined ? { replacementObligationId } : {}),
      ...(replacementObligationIds !== undefined ? { replacementObligationIds } : {}),
    });
    // Evidence FIRST (A15 lines 62-64) — the write-off writes its own
    // named record; every other transition writes OBLIGATION_STATE_CHANGED.
    await submitObligationEvidence(this.evidence, transitionEvidence(entry));
    this.ledger.appendEntry(entry);
    return { ok: true, value: this.ledger.foldOne(obligationId) as ObligationRecord };
  }

  private async dispatchTransition(
    instruction: TransitionInstruction,
  ): Promise<ObligationCommandResult<ObligationRecord>> {
    switch (instruction.kind) {
      case 'DISPUTE_OPEN':
        return this.openDispute(instruction);
      case 'RISK_WRITE_OFF':
        return this.applyRiskWriteOff(instruction);
      case 'CLEARING_CORRECTION_CANCEL':
        return this.applyClearingCorrectionCancel(instruction);
      case 'SETTLEMENT_FINALITY':
        return this.applySettlementFinality(instruction);
      case 'NETTING_COMMIT':
        return this.applyNettingCommit(instruction);
      case 'SETTLEMENT_INSTRUCTION': {
        const result = await this.applySettlementInstruction(instruction);
        if (!result.ok) {
          return result;
        }
        return { ok: true, value: result.value.obligation };
      }
      default:
        throw new TypeError(
          `obligations authority: instruction kind ${JSON.stringify((instruction as { kind: string }).kind)} is not a transition instruction`,
        );
    }
  }
}

/** The transition-shaped instructions (the dispatch helper's input). */
type TransitionInstruction = Exclude<ObligationWriteInstruction, ClearingCreationInstruction | DisputeResolutionInstruction>;

/**
 * The target state of one instruction kind (the gate's transition map —
 * module-private: the gate table is the public machine check).
 *
 * Source: clearing-netting-settlement.md lines 92-103, 119-123.
 */
function gateTargetOf(kind: ObligationInstructionKind): ObligationRecord['state'] {
  switch (kind) {
    case 'DISPUTE_OPEN':
      return 'DISPUTED';
    case 'RISK_WRITE_OFF':
      return 'WRITTEN_OFF';
    case 'CLEARING_CORRECTION_CANCEL':
      return 'CANCELLED';
    case 'SETTLEMENT_FINALITY':
      return 'SETTLED';
    case 'NETTING_COMMIT':
      return 'NETTED';
    case 'SETTLEMENT_INSTRUCTION':
      return 'SETTLEMENT_PENDING';
    default:
      throw new TypeError(`obligations authority: ${kind} is not a transition instruction`);
  }
}

function obligationNotFound(obligationId: string): { ok: false; code: 'OBLIGATION_NOT_FOUND'; message: string } {
  return {
    ok: false,
    code: 'OBLIGATION_NOT_FOUND' as const,
    message: `obligations authority: obligation ${obligationId} not found`,
  };
}

function assertObligationId(value: unknown): asserts value is string {
  assertNonEmpty(value, 'obligationId');
}

function assertNonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`obligations authority: ${label} must be a non-empty string`);
  }
}

function assertTermsInput(terms: {
  debtorParticipantId: unknown;
  creditorParticipantId: unknown;
  amount: unknown;
  reason: unknown;
}): void {
  assertNonEmpty(terms.debtorParticipantId, 'debtorParticipantId');
  assertNonEmpty(terms.creditorParticipantId, 'creditorParticipantId');
  if (terms.debtorParticipantId === terms.creditorParticipantId) {
    throw new TypeError(
      'obligations authority: debtor and creditor must be distinct participants',
    );
  }
  if (!isMoney(terms.amount)) {
    throw new TypeError(
      'obligations authority: amount must be well-formed integer Money (GC-1)',
    );
  }
  assertNonEmpty(terms.reason, 'reason');
}

function assertCreationInput(
  instruction: Omit<ClearingCreationInstruction, 'kind'>,
): void {
  assertNonEmpty(instruction?.batchId, 'batchId');
  assertNonEmpty(instruction?.recordId, 'recordId');
  assertNonEmpty(instruction?.originActivityId, 'originActivityId');
  if (
    instruction?.originKind !== 'ROUTE_PLAN_HOP' &&
    instruction?.originKind !== 'INTENT' &&
    instruction?.originKind !== 'RECONCILIATION_ADJUSTMENT'
  ) {
    throw new TypeError(
      'obligations authority: originKind must be ROUTE_PLAN_HOP | INTENT | RECONCILIATION_ADJUSTMENT',
    );
  }
  if (instruction?.correctionOf !== undefined) {
    assertNonEmpty(instruction.correctionOf, 'correctionOf');
  }
  assertTermsInput(instruction);
}

function assertDisputeResolutionInput(instruction: DisputeResolutionInstruction): void {
  assertNonEmpty(instruction?.disputeId, 'disputeId');
  assertNonEmpty(instruction?.resolvedObligationId, 'resolvedObligationId');
  if (instruction?.replacements === undefined || !Array.isArray(instruction.replacements)) {
    throw new TypeError('obligations authority: replacements must be an array');
  }
  for (const replacement of instruction.replacements) {
    assertTermsInput(replacement);
  }
}
