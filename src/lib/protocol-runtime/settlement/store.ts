/**
 * RTN-009 — Settlement and Finality Authority: the in-process
 * single-writer state store (the RTN-005/007/008 in-process-object-store
 * precedent).
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §4 Area 12:
 *     lines 220-240 (the three record shapes and machines this store
 *      carries).
 *     lines 242-245 (Owning authority):
 *       "Settlement Authority (protocol layer, area 12) owns
 *        instruction, attempt, and finality state. Rail adapters report
 *        outcomes; they never declare protocol finality."
 *   spec/registry/protocol-registry.json singleFinancialAuthority (the
 *    single-writer discipline: only the Settlement and Finality
 *    Authority originates instructions; only this domain's authority
 *    commands write this store).
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - In-process single writer: this store is the settlement domain's
 *     only state carrier; every mutation flows through exactly one
 *     authority command. INV-12-4's "only the Settlement Authority
 *     writes FinalityRecord state" is the structural single-writer
 *     discipline — the FinalityRecord map has no writer outside this
 *     domain's authority.
 *   - The per-subject indexes: instructionsBySubject (ordered — the
 *     subject-ordinal derivation input), finalityBySubject (one record
 *     per subject — the exactly-once key), attemptByInstruction (one
 *     attempt per instruction — the INV-12-3 key).
 *   - The protocol sequence: one monotonic counter minting the domain's
 *     ProtocolTime sequences (the rails store precedent).
 */

import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { deepFreeze } from '../netting/freeze.ts';
import type {
  FinalityRecord,
  SettlementAttemptRecord,
  SettlementInstructionRecord,
} from './types.ts';
import { settlementSubjectKey } from './types.ts';

/**
 * The settlement domain's state store: instructions, attempts, and
 * finality records — with the per-subject single-record and
 * per-instruction single-attempt indexes.
 *
 * Source: clearing-netting-settlement.md lines 220-262.
 */
export class SettlementStore {
  private readonly instructions = new Map<string, SettlementInstructionRecord>();
  private readonly attempts = new Map<string, SettlementAttemptRecord>();
  private readonly finalities = new Map<string, FinalityRecord>();
  private readonly instructionsBySubject = new Map<string, string[]>();
  private readonly attemptByInstruction = new Map<string, string>();
  private readonly finalityBySubject = new Map<string, string>();
  private sequence = 0;

  /** The domain's next sequenced protocol position (monotonic, gapless per domain). */
  nextProtocolSequence(): number {
    return this.sequence;
  }

  /** Mint the protocol time for the next sequenced position (without consuming it). */
  peekTime(wallMs: number): ProtocolTime {
    return protocolTime(this.sequence, wallMs);
  }

  /** Consume one sequence position (called by the authority when a record commits). */
  consumeSequence(): number {
    const consumed = this.sequence;
    this.sequence += 1;
    return consumed;
  }

  // --- SettlementInstruction records ----------------------------------------

  /** Insert one instruction record (deep-frozen at mint) + index it. */
  insertInstruction(instruction: SettlementInstructionRecord): void {
    if (this.instructions.has(instruction.instructionId)) {
      throw new TypeError(
        `settlement store: instruction ${instruction.instructionId} already exists (derived ids are unique per subject ordinal)`,
      );
    }
    this.instructions.set(instruction.instructionId, deepFreeze({ ...instruction }));
    const key = settlementSubjectKey(instruction.subject);
    const list = this.instructionsBySubject.get(key) ?? [];
    list.push(instruction.instructionId);
    this.instructionsBySubject.set(key, list);
  }

  /** Replace one instruction record (the state transitions). */
  updateInstruction(instruction: SettlementInstructionRecord): void {
    if (!this.instructions.has(instruction.instructionId)) {
      throw new TypeError(
        `settlement store: instruction ${instruction.instructionId} does not exist (update requires insert first)`,
      );
    }
    this.instructions.set(instruction.instructionId, deepFreeze({ ...instruction }));
  }

  /** The instruction record by id. */
  instruction(instructionId: string): SettlementInstructionRecord | undefined {
    return this.instructions.get(instructionId);
  }

  /** All instruction records for one subject, in creation (ordinal) order. */
  instructionsForSubject(subjectKey: string): readonly SettlementInstructionRecord[] {
    return (this.instructionsBySubject.get(subjectKey) ?? []).map(
      (id) => this.instructions.get(id) as SettlementInstructionRecord,
    );
  }

  /** All instruction records (insertion order). */
  listInstructions(): readonly SettlementInstructionRecord[] {
    return [...this.instructions.values()];
  }

  // --- SettlementAttempt records ----------------------------------------------

  /** Insert one attempt record (deep-frozen at mint) + index it by instruction. */
  insertAttempt(attempt: SettlementAttemptRecord): void {
    if (this.attempts.has(attempt.attemptId)) {
      throw new TypeError(
        `settlement store: attempt ${attempt.attemptId} already exists (one attempt per instruction — INV-12-3)`,
      );
    }
    if (this.attemptByInstruction.has(attempt.instructionId)) {
      throw new TypeError(
        `settlement store: instruction ${attempt.instructionId} already has an attempt (INV-12-2: at most one live attempt per instruction)`,
      );
    }
    this.attempts.set(attempt.attemptId, deepFreeze({ ...attempt }));
    this.attemptByInstruction.set(attempt.instructionId, attempt.attemptId);
  }

  /** Replace one attempt record (the state transitions). */
  updateAttempt(attempt: SettlementAttemptRecord): void {
    if (!this.attempts.has(attempt.attemptId)) {
      throw new TypeError(
        `settlement store: attempt ${attempt.attemptId} does not exist (update requires insert first)`,
      );
    }
    this.attempts.set(attempt.attemptId, deepFreeze({ ...attempt }));
  }

  /** The attempt record by id. */
  attempt(attemptId: string): SettlementAttemptRecord | undefined {
    return this.attempts.get(attemptId);
  }

  /** The one attempt of one instruction (the INV-12-3 key). */
  attemptForInstruction(instructionId: string): SettlementAttemptRecord | undefined {
    const attemptId = this.attemptByInstruction.get(instructionId);
    return attemptId === undefined ? undefined : this.attempts.get(attemptId);
  }

  /** All attempt records (insertion order). */
  listAttempts(): readonly SettlementAttemptRecord[] {
    return [...this.attempts.values()];
  }

  // --- FinalityRecord records --------------------------------------------------

  /** Insert one finality record (deep-frozen at mint) + index it by subject. */
  insertFinality(finality: FinalityRecord): void {
    if (this.finalities.has(finality.finalityRecordId)) {
      throw new TypeError(
        `settlement store: finality record ${finality.finalityRecordId} already exists (one record per subject — INV-12-4 exactly-once)`,
      );
    }
    this.finalities.set(finality.finalityRecordId, deepFreeze({ ...finality }));
    this.finalityBySubject.set(settlementSubjectKey(finality.subject), finality.finalityRecordId);
  }

  /** Replace one finality record (the PROVISIONAL -> FINAL transition). */
  updateFinality(finality: FinalityRecord): void {
    if (!this.finalities.has(finality.finalityRecordId)) {
      throw new TypeError(
        `settlement store: finality record ${finality.finalityRecordId} does not exist (update requires insert first)`,
      );
    }
    this.finalities.set(finality.finalityRecordId, deepFreeze({ ...finality }));
  }

  /** The finality record by id. */
  finality(finalityRecordId: string): FinalityRecord | undefined {
    return this.finalities.get(finalityRecordId);
  }

  /** The one finality record of one subject (INV-12-4's exactly-once key). */
  finalityForSubject(subjectKey: string): FinalityRecord | undefined {
    const finalityRecordId = this.finalityBySubject.get(subjectKey);
    return finalityRecordId === undefined ? undefined : this.finalities.get(finalityRecordId);
  }

  /** All finality records (insertion order). */
  listFinalities(): readonly FinalityRecord[] {
    return [...this.finalities.values()];
  }
}
