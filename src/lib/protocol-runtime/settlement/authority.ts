/**
 * RTN-009 — Settlement and Finality Authority: the composed single-writer
 * command surface for area 12 (A12) — the apex of the
 * singleFinancialAuthority chain.
 *
 * Spec sources (binding) — spec/architecture/v0.1/
 * clearing-netting-settlement.md §4 Area 12:
 *   lines 211-240 (the objects and machines — quoted in types.ts).
 *   lines 242-245 (Owning authority):
 *     "Settlement Authority (protocol layer, area 12) owns instruction,
 *      attempt, and finality state. Rail adapters report outcomes; they
 *      never declare protocol finality."
 *   lines 247-262 (the four invariants, verbatim):
 *     "INV-12-1 (financial correctness): instruction amounts are integer
 *      Money copied verbatim from the obligation; the rail operation
 *      payload hash is recorded and compared on result.
 *      INV-12-2 (single attempt rule): at most one live attempt per
 *      instruction; blind retry is impossible by construction (GC-2).
 *      INV-12-3 (idempotency): attempt authorization is keyed by
 *      instruction id; rail idempotency keys are derived deterministically
 *      and passed to the adapter.
 *      INV-12-4 (finality exclusivity): only the Settlement Authority
 *      writes FinalityRecord state; FINAL is exactly-once per obligation
 *      and irreversible; reversal of a settled fact is only possible as a
 *      new obligation via dispute/recourse (area 21)."
 *   lines 264-273 (failure and UNKNOWN semantics, verbatim):
 *     "Confirmed failure marks the attempt FAILED and the instruction
 *      FAILED; recovery is a new instruction with a new attempt, fully
 *      evidenced. UNKNOWN is a durable attempt state: the instruction
 *      stays ISSUED, the obligation stays SETTLEMENT_PENDING, and a
 *      reconciliation case (area 14) is opened automatically. Only the
 *      reconciliation resolution may drive the attempt to CONFIRMED or
 *      FAILED and then advance finality. Resumption after resolution is
 *      safe-resume, never re-submission of the same external effect (GC-2)."
 *   lines 275-279 (evidence produced); lines 281-289 (boundaries).
 *   spec/architecture/v0.1/rails-adapters-reconciliation.md §2 Area 14
 *   lines 171-179 (the recovery paths — "RESOLVED_CONFIRMED: area 12 marks
 *    the attempt CONFIRMED and advances finality." / "RESOLVED_FAILED:
 *    area 12 marks the attempt FAILED; a new instruction may be created,
 *    fully evidenced as a new external effect.").
 *   spec/registry/protocol-registry.json singleFinancialAuthority:
 *     "Only the Settlement and Finality Authority originates instructions
 *      for external value movement; only the Rail Authority executes them
 *      through adapters" — settlement instructions originate ONLY here;
 *      rail execution requests flow ONLY to the A13 interface (the
 *      injected SettlementRailsPort; simulated rails only — this module
 *      performs ZERO external transmission: no fetch, no socket, no
 *      client; the adapter connection is caller-supplied).
 *
 * Command discipline (recorded in CONTRACT-REVIEW.md):
 *   - Every command runs under ONE serializer lane (the settlement
 *     domain's single-writer discipline).
 *   - Evidence FIRST (awaited), then the state write it records (A15
 *     lines 62-64) — with no sequence gap on failure.
 *   - Domain rejections are typed values (SettlementCommandResult), never
 *     thrown; input-shape violations throw TypeError (kernel
 *     convention). No-op mirrors and read queries emit no record.
 *   - The INV-12-2 single-attempt rule is BY CONSTRUCTION: the attempt
 *     id is keyed by the instruction id (INV-12-3), the store holds at
 *     most one attempt per instruction, and authorizeAttempt refuses
 *     with LIVE_ATTEMPT_EXISTS while a live attempt (CREATED / SUBMITTED
 *     / PENDING / UNKNOWN — UNKNOWN is live: its only exit is
 *     reconciliation) exists. After the first attempt is terminally
 *     resolved the instruction is terminal (CONFIRMED / FAILED), so the
 *     only continuation is the A14 recovery directive's NEW instruction
 *     — "recovery is a new instruction with a new attempt, fully
 *     evidenced as a new external effect", with a NEW derived
 *     idempotency key. No code path re-submits the same external effect.
 *   - INV-12-1: the instruction's amount is copied VERBATIM from the
 *     subject (the A10 obligation's terms / the A11 net obligation), and
 *     the payload hash — computed through the A13 canonical encoder — is
 *     recorded at creation and re-compared on EVERY result mirror
 *     (submitAttempt / applyRailOutcome / applyResolution).
 *   - INV-12-4: the FinalityRecord store is written only by this
 *     authority's commands; one record per subject (the derived-id key);
 *     the machine's only edge is PROVISIONAL -> FINAL; there is no
 *     reversal command anywhere in the surface (reversal is a NEW
 *     obligation via dispute/recourse — area 21, wave 2); FINAL advances
 *     the subject to SETTLED exactly once (the A10 machine and the A11
 *     net-obligation machine enforce the exactly-once structurally).
 */

import type { EvidenceSubmission } from '../kernel/ports.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { KeyedSerializer } from '../obligations/serializer.ts';
import type { RecoveryDirective } from '../rails/index.ts';
import type { RailOperationRecord } from '../rails/index.ts';
import type { RailAdapterConnection } from '../rails/index.ts';
import {
  finalityDeclaredEvidence,
  settlementAttemptAuthorizedEvidence,
  settlementAttemptResolvedEvidence,
  settlementInstructionCreatedEvidence,
  submitSettlementEvidence,
} from './evidence.ts';
import type {
  SettlementNettingPort,
  SettlementObligationLedgerPort,
  SettlementRailsPort,
} from './ports.ts';
import {
  finalityRecordIdFor,
  railIdempotencyKeyForInstruction,
  railOperationIdForInstruction,
  settlementAttemptIdFor,
  settlementInstructionIdFor,
  settlementPayloadHash,
  settlementRailPayload,
  transitionFinality,
  transitionSettlementAttempt,
  transitionSettlementInstruction,
} from './state-machine.ts';
import { SettlementStore } from './store.ts';
import { deepFreeze } from '../netting/freeze.ts';
import type {
  FinalityRecord,
  SettlementAttemptRecord,
  SettlementCommandResult,
  SettlementInstructionRecord,
  SettlementSubject,
} from './types.ts';
import { isLiveSettlementAttempt, settlementSubjectKey } from './types.ts';

/** Constructor dependencies for the Settlement and Finality Authority. */
export interface SettlementAuthorityDeps {
  /** The EvidenceSubmission port — the real RTN-002 EvidenceLog. */
  readonly evidence: EvidenceSubmission;
  /** The A13/A14 interface (the merged RTN-004 authorities — simulated rails only). */
  readonly rails: SettlementRailsPort;
  /** The A10 obligations-ledger port (the merged RTN-008 authority). */
  readonly obligations: SettlementObligationLedgerPort;
  /** The A11 netting port (RTN-009's own netting module). */
  readonly netting: SettlementNettingPort;
  /** Injectable wall clock (epoch ms) for deterministic tests; default Date.now. */
  readonly wallClock?: () => number;
}

/** The outcome of one attempt outcome landing. */
export interface AttemptOutcomeMirror {
  readonly attempt: SettlementAttemptRecord;
  readonly instruction: SettlementInstructionRecord;
  readonly operation: RailOperationRecord;
  /** The automatically opened reconciliation case id, when the attempt landed UNKNOWN. */
  readonly caseId?: string;
}

const SETTLEMENT_PIPELINE_KEY = 'settlement-authority.pipeline';

/**
 * The Settlement and Finality Authority (protocol layer, area 12): owns
 * instruction, attempt, and finality state. Rail adapters report
 * outcomes; they never declare protocol finality.
 *
 * Source: clearing-netting-settlement.md lines 242-245.
 */
export class SettlementAuthority {
  private readonly evidence: EvidenceSubmission;
  private readonly rails: SettlementRailsPort;
  private readonly obligations: SettlementObligationLedgerPort;
  private readonly netting: SettlementNettingPort;
  private readonly wallClock: () => number;
  private readonly pipeline = new KeyedSerializer();
  private readonly store = new SettlementStore();

  constructor(deps: SettlementAuthorityDeps) {
    this.evidence = deps.evidence;
    this.rails = deps.rails;
    this.obligations = deps.obligations;
    this.netting = deps.netting;
    this.wallClock = deps.wallClock ?? (() => Date.now());
  }

  /** The domain's state store (read access for the persistence bridge and diagnostics). */
  get stateStore(): SettlementStore {
    return this.store;
  }

  private now(): ProtocolTime {
    return protocolTime(this.store.nextProtocolSequence(), this.wallClock());
  }

  private consume(): ProtocolTime {
    const at = this.now();
    this.store.consumeSequence();
    return at;
  }

  // -------------------------------------------------------------------------
  // Subject reads (the INV-12-1 verbatim-amount source)
  // -------------------------------------------------------------------------

  private readSubject(
    subject: SettlementSubject,
  ):
    | { readonly ok: true; readonly amount: import('../kernel/money.ts').Money; readonly state: string }
    | { readonly ok: false; readonly code: 'SUBJECT_NOT_FOUND' | 'NET_OBLIGATION_NOT_FOUND'; readonly message: string } {
    if (subject.kind === 'OBLIGATION') {
      const obligation = this.obligations.obligation(subject.obligationId);
      if (obligation === undefined) {
        return {
          ok: false,
          code: 'SUBJECT_NOT_FOUND',
          message: `settlement authority: obligation ${subject.obligationId} does not exist in the ledger`,
        };
      }
      return { ok: true, amount: obligation.terms.amount, state: obligation.state };
    }
    const netObligation = this.netting.netObligation(subject.netObligationId);
    if (netObligation === undefined) {
      return {
        ok: false,
        code: 'NET_OBLIGATION_NOT_FOUND',
        message: `settlement authority: net obligation ${subject.netObligationId} does not exist in the netting domain`,
      };
    }
    return { ok: true, amount: netObligation.amount, state: netObligation.state };
  }

  /** Is the subject's state one a settlement instruction can be created for? */
  private subjectSettleable(state: string): boolean {
    return state === 'CREATED' || state === 'NETTED' || state === 'SETTLEMENT_PENDING';
  }

  // -------------------------------------------------------------------------
  // SettlementInstruction — CREATED -> ISSUED -> terminal
  // -------------------------------------------------------------------------

  /**
   * Create one settlement instruction — "protocol authorization to move
   * value externally for one obligation or net position". The amount is
   * integer Money copied VERBATIM from the subject (INV-12-1); the rail
   * payload hash is computed through the A13 canonical encoder and
   * recorded here (compared on every result). Driving the subject domain
   * to SETTLEMENT_PENDING ("a settlement instruction (area 12) exists")
   * happens through the subject's owning port — a no-op typed result when
   * the subject is already SETTLEMENT_PENDING (the recovery path: after a
   * FAILED instruction, "recovery is a new instruction with a new
   * attempt").
   *
   * Guards: the subject exists and is settleable (an already-SETTLED
   * subject is refused — SUBJECT_ALREADY_SETTLED; a dispositioned subject
   * is refused — SUBJECT_NOT_SETTLEABLE); no LIVE instruction exists for
   * the subject (LIVE_INSTRUCTION_EXISTS — the double-payment guard; a
   * second instruction is possible only after the first is terminal).
   *
   * Evidence: SETTLEMENT_INSTRUCTION_CREATED "(obligation id, amount
   * hash)".
   *
   * Source: clearing-netting-settlement.md lines 224-227, 247-249
   * (INV-12-1), 264-266, 276.
   */
  async createSettlementInstruction(input: {
    readonly subject: SettlementSubject;
    readonly beneficiary: string;
    readonly memo?: string;
  }): Promise<SettlementCommandResult<SettlementInstructionRecord>> {
    if (input === null || typeof input !== 'object') {
      throw new TypeError('settlement authority: input must be an object');
    }
    const subject = input.subject;
    if (
      subject === null ||
      typeof subject !== 'object' ||
      (subject.kind !== 'OBLIGATION' && subject.kind !== 'NET_POSITION')
    ) {
      throw new TypeError(
        'settlement authority: subject must be { kind: "OBLIGATION", obligationId } or { kind: "NET_POSITION", netObligationId }',
      );
    }
    if (typeof input.beneficiary !== 'string' || input.beneficiary.length === 0) {
      throw new TypeError('settlement authority: beneficiary must be a non-empty string');
    }
    if (input.memo !== undefined && typeof input.memo !== 'string') {
      throw new TypeError('settlement authority: memo, when present, must be a string');
    }
    return this.pipeline.run(SETTLEMENT_PIPELINE_KEY, async () => {
      const read = this.readSubject(subject);
      if (!read.ok) {
        return { ok: false as const, code: read.code, message: read.message };
      }
      if (read.state === 'SETTLED') {
        return {
          ok: false as const,
          code: 'SUBJECT_ALREADY_SETTLED' as const,
          message: `settlement authority: subject ${settlementSubjectKey(subject)} is already SETTLED — FINAL advances the obligation to SETTLED exactly once (INV-12-4)`,
        };
      }
      if (!this.subjectSettleable(read.state)) {
        return {
          ok: false as const,
          code: 'SUBJECT_NOT_SETTLEABLE' as const,
          message: `settlement authority: subject ${settlementSubjectKey(subject)} is ${read.state}; a settlement instruction requires CREATED, NETTED, or SETTLEMENT_PENDING`,
        };
      }
      const existing = this.store.instructionsForSubject(settlementSubjectKey(subject));
      const live = existing.find(
        (instruction) => instruction.state === 'CREATED' || instruction.state === 'ISSUED',
      );
      if (live !== undefined) {
        return {
          ok: false as const,
          code: 'LIVE_INSTRUCTION_EXISTS' as const,
          message: `settlement authority: subject ${settlementSubjectKey(subject)} already has a live instruction ${live.instructionId} (${live.state}); a new instruction is possible only after the first is terminal (recovery is a new instruction, fully evidenced)`,
        };
      }
      const subjectOrdinal = existing.length + 1;
      const instructionId = settlementInstructionIdFor(subject, subjectOrdinal);
      // INV-12-1: the amount is copied VERBATIM from the subject.
      const payload = {
        instructionId,
        money: read.amount,
        beneficiary: input.beneficiary,
        ...(input.memo === undefined ? {} : { memo: input.memo }),
      } as const;
      const payloadHash = settlementPayloadHash(payload);
      const createdAt = this.now();
      const instruction: SettlementInstructionRecord = deepFreeze({
        instructionId,
        subject,
        subjectOrdinal,
        state: 'CREATED',
        amount: read.amount,
        beneficiary: input.beneficiary,
        ...(input.memo === undefined ? {} : { memo: input.memo }),
        payloadHash,
        createdAt,
      });
      // Drive the subject domain to SETTLEMENT_PENDING first ("a
      // settlement instruction (area 12) exists"); the subject-domain
      // command carries its own evidence and is a typed no-op when the
      // subject is already SETTLEMENT_PENDING (the recovery path).
      if (subject.kind === 'OBLIGATION') {
        const applied = await this.obligations.applySettlementInstruction({
          kind: 'SETTLEMENT_INSTRUCTION',
          obligationId: subject.obligationId,
          settlementInstructionId: instructionId,
        });
        if (!applied.ok) {
          return {
            ok: false as const,
            code: 'OBLIGATION_TRANSITION_REFUSED' as const,
            message: `settlement authority: the obligations ledger refused the SETTLEMENT_PENDING transition: ${applied.code} — ${applied.message}`,
          };
        }
      } else {
        const applied = await this.netting.applyNetPositionSettlementInstruction({
          netObligationId: subject.netObligationId,
          settlementInstructionId: instructionId,
        });
        if (!applied.ok) {
          return {
            ok: false as const,
            code: 'OBLIGATION_TRANSITION_REFUSED' as const,
            message: `settlement authority: the netting domain refused the SETTLEMENT_PENDING transition: ${applied.code} — ${applied.message}`,
          };
        }
      }
      await submitSettlementEvidence(
        this.evidence,
        settlementInstructionCreatedEvidence(instruction),
      );
      this.store.consumeSequence();
      this.store.insertInstruction(instruction);
      return { ok: true as const, value: instruction };
    });
  }

  // -------------------------------------------------------------------------
  // SettlementAttempt — INV-12-2/INV-12-3: authorization and submission
  // -------------------------------------------------------------------------

  /**
   * Authorize one attempt for one instruction — INV-12-3: "attempt
   * authorization is keyed by instruction id". The attempt id derives
   * from the instruction id, the deterministic rail idempotency key is
   * derived through the kernel identity (the identical derivation the
   * A13 authority applies — the key is recorded here and flows to the
   * adapter through the A13 submission), and the rail operation is
   * created through the A13 interface with the GC-3 instruction link.
   * The instruction advances CREATED -> ISSUED ("ISSUED means a rail
   * operation exists (area 13)").
   *
   * The INV-12-2 single-attempt rule, by construction: a live attempt
   * (CREATED / SUBMITTED / PENDING / UNKNOWN — UNKNOWN is live) refuses
   * the authorization with LIVE_ATTEMPT_EXISTS; after the first attempt
   * is terminally resolved the instruction is terminal, so the only
   * continuation is the A14 recovery directive's NEW instruction.
   *
   * Evidence: SETTLEMENT_ATTEMPT_AUTHORIZED "(attempt id, rail op id)".
   *
   * Source: clearing-netting-settlement.md lines 225-233, 253-258,
   * 277.
   */
  async authorizeAttempt(
    instructionId: string,
    adapterId: string,
  ): Promise<SettlementCommandResult<SettlementAttemptRecord>> {
    if (typeof instructionId !== 'string' || instructionId.length === 0) {
      throw new TypeError('settlement authority: instructionId must be a non-empty string');
    }
    if (typeof adapterId !== 'string' || adapterId.length === 0) {
      throw new TypeError('settlement authority: adapterId must be a non-empty string');
    }
    return this.pipeline.run(SETTLEMENT_PIPELINE_KEY, async () => {
      const instruction = this.store.instruction(instructionId);
      if (instruction === undefined) {
        return {
          ok: false as const,
          code: 'INSTRUCTION_NOT_FOUND' as const,
          message: `settlement authority: instruction ${instructionId} does not exist`,
        };
      }
      const existing = this.store.attemptForInstruction(instructionId);
      if (existing !== undefined) {
        if (isLiveSettlementAttempt(existing.state)) {
          return {
            ok: false as const,
            code: 'LIVE_ATTEMPT_EXISTS' as const,
            message: `settlement authority: instruction ${instructionId} already has a live attempt ${existing.attemptId} (${existing.state}); INV-12-2 — at most one live attempt per instruction, blind retry is impossible by construction${existing.state === 'UNKNOWN' ? ' (UNKNOWN is durable: the only exit is reconciliation — GC-2)' : ''}`,
          };
        }
        return {
          ok: false as const,
          code: 'INSTRUCTION_TERMINAL' as const,
          message: `settlement authority: instruction ${instructionId} is ${instruction.state}; the terminally resolved attempt closed it — recovery is a NEW instruction, fully evidenced`,
        };
      }
      if (instruction.state !== 'CREATED') {
        return {
          ok: false as const,
          code: 'ILLEGAL_TRANSITION' as const,
          message: `settlement authority: instruction ${instructionId} is ${instruction.state}; attempt authorization requires CREATED`,
        };
      }
      // INV-12-3: the deterministic key, derived through the kernel
      // identity — the same derivation the A13 authority applies, so the
      // key recorded here is the key the adapter receives.
      const idempotencyKey = railIdempotencyKeyForInstruction(instructionId);
      const operationId = railOperationIdForInstruction(instructionId);
      const authorized = this.rails.authorizeOperation({
        instructionId,
        adapterId,
        payload: settlementRailPayload(instruction),
      });
      if (!authorized.ok) {
        return {
          ok: false as const,
          code: 'RAIL_AUTHORIZATION_FAILED' as const,
          message: `settlement authority: the A13 interface refused the rail operation: ${authorized.reasonCode} — ${authorized.detail}`,
        };
      }
      const operation = authorized.value;
      if (operation.idempotencyKey !== idempotencyKey) {
        return {
          ok: false as const,
          code: 'PAYLOAD_HASH_MISMATCH' as const,
          message: `settlement authority: the rail operation's idempotency key ${operation.idempotencyKey} does not match the deterministic key derived from the instruction id (${idempotencyKey}) — INV-12-3 derivation mismatch`,
        };
      }
      if (operation.payloadHash !== instruction.payloadHash) {
        return {
          ok: false as const,
          code: 'PAYLOAD_HASH_MISMATCH' as const,
          message: `settlement authority: the rail operation's payload hash does not match the instruction's recorded payload hash (INV-12-1) — refusing the attempt`,
        };
      }
      const at = this.now();
      const attempt: SettlementAttemptRecord = deepFreeze({
        attemptId: settlementAttemptIdFor(instructionId),
        instructionId,
        state: 'CREATED',
        operationId,
        adapterId,
        idempotencyKey,
        createdAt: at,
      });
      await submitSettlementEvidence(
        this.evidence,
        settlementAttemptAuthorizedEvidence(attempt, at),
      );
      this.store.consumeSequence();
      this.store.insertAttempt(attempt);
      const issued = transitionSettlementInstruction(instruction, 'ISSUED', this.consume());
      if (!issued.ok) {
        throw new TypeError(
          'settlement authority: internal — instruction CREATED -> ISSUED refused by the frozen machine',
        );
      }
      this.store.updateInstruction(issued.instruction);
      return { ok: true as const, value: attempt };
    });
  }

  /**
   * Submit one attempt through the A13 adapter connection — the ONLY
   * external-effect path (the connection is caller-supplied; this module
   * performs no transmission itself). The A13 submitRailOperation command
   * transmits with the deterministic idempotency key and maps the outcome
   * through the INV-13-4 no-guessing mapping; this command mirrors the
   * outcome into the attempt (CREATED -> SUBMITTED -> the mapped state)
   * and applies the instruction-level consequences:
   *   PENDING  — the attempt is PENDING; the instruction STAYS ISSUED.
   *   FAILED   — "confirmed failure marks the attempt FAILED and the
   *              instruction FAILED"; the subject stays SETTLEMENT_
   *              PENDING (recovery is a new instruction).
   *   UNKNOWN  — "UNKNOWN is a durable attempt state: the instruction
   *              stays ISSUED, the obligation stays SETTLEMENT_PENDING,
   *              and a reconciliation case (area 14) is opened
   *              automatically" (exactly one, by the A13/A14 wiring);
   *              the case reference is recorded on the attempt.
   * The payload hash is re-compared (INV-12-1 / INV-13-2).
   *
   * Evidence: SETTLEMENT_ATTEMPT_RESOLVED "(outcome, resolution
   * reference)" — one record for the submission's outcome (the A13
   * records cover the rail side).
   *
   * Source: clearing-netting-settlement.md lines 228-233, 264-273, 278;
   * rails-adapters-reconciliation.md lines 33-46, 70-72.
   */
  async submitAttempt(
    instructionId: string,
    connection: RailAdapterConnection,
  ): Promise<SettlementCommandResult<AttemptOutcomeMirror>> {
    if (typeof instructionId !== 'string' || instructionId.length === 0) {
      throw new TypeError('settlement authority: instructionId must be a non-empty string');
    }
    if (connection === null || typeof connection !== 'object') {
      throw new TypeError('settlement authority: connection must be a RailAdapterConnection');
    }
    return this.pipeline.run(SETTLEMENT_PIPELINE_KEY, async () => {
      const instruction = this.store.instruction(instructionId);
      if (instruction === undefined) {
        return {
          ok: false as const,
          code: 'INSTRUCTION_NOT_FOUND' as const,
          message: `settlement authority: instruction ${instructionId} does not exist`,
        };
      }
      const attempt = this.store.attemptForInstruction(instructionId);
      if (attempt === undefined) {
        return {
          ok: false as const,
          code: 'ATTEMPT_NOT_FOUND' as const,
          message: `settlement authority: instruction ${instructionId} has no attempt (authorize first)`,
        };
      }
      if (attempt.state !== 'CREATED') {
        if (isLiveSettlementAttempt(attempt.state)) {
          return {
            ok: false as const,
            code: 'LIVE_ATTEMPT_EXISTS' as const,
            message: `settlement authority: attempt ${attempt.attemptId} is ${attempt.state} — already submitted; re-submission is impossible by construction (INV-12-2 / GC-2)`,
          };
        }
        return {
          ok: false as const,
          code: 'ATTEMPT_ALREADY_TERMINAL' as const,
          message: `settlement authority: attempt ${attempt.attemptId} is ${attempt.state} (terminal)`,
        };
      }
      // The A13 submission — the only external-effect path.
      const submitted = this.rails.submitRailOperation(attempt.operationId, connection);
      if (!submitted.ok) {
        return {
          ok: false as const,
          code: 'RAIL_SUBMISSION_FAILED' as const,
          message: `settlement authority: the A13 interface refused the submission: ${submitted.reasonCode} — ${submitted.detail}`,
        };
      }
      const operation = submitted.value.operation;
      // INV-12-1 / INV-13-2: the payload hash is compared on the result.
      if (operation.payloadHash !== instruction.payloadHash) {
        return {
          ok: false as const,
          code: 'PAYLOAD_HASH_MISMATCH' as const,
          message: `settlement authority: the rail operation's payload hash changed across the submission (INV-12-1) — refusing to mirror the outcome`,
        };
      }
      return this.landAttemptOutcome(attempt, instruction, operation);
    });
  }

  /**
   * Apply the rail operation's current outcome to the attempt — the
   * report mirror (after the composition root records a rail report
   * through the A13 interface, the attempt advances to the reported
   * outcome). The payload hash is re-compared (INV-12-1 / INV-13-2);
   * the exit from UNKNOWN is REFUSED here (GC-2 — only the
   * reconciliation resolution drives an UNKNOWN attempt out, via
   * applyResolution).
   *
   * Evidence: SETTLEMENT_ATTEMPT_RESOLVED for every newly landed outcome.
   *
   * Source: clearing-netting-settlement.md lines 228-233, 264-273, 278.
   */
  async applyRailOutcome(
    instructionId: string,
  ): Promise<SettlementCommandResult<AttemptOutcomeMirror>> {
    if (typeof instructionId !== 'string' || instructionId.length === 0) {
      throw new TypeError('settlement authority: instructionId must be a non-empty string');
    }
    return this.pipeline.run(SETTLEMENT_PIPELINE_KEY, async () => {
      const instruction = this.store.instruction(instructionId);
      if (instruction === undefined) {
        return {
          ok: false as const,
          code: 'INSTRUCTION_NOT_FOUND' as const,
          message: `settlement authority: instruction ${instructionId} does not exist`,
        };
      }
      const attempt = this.store.attemptForInstruction(instructionId);
      if (attempt === undefined) {
        return {
          ok: false as const,
          code: 'ATTEMPT_NOT_FOUND' as const,
          message: `settlement authority: instruction ${instructionId} has no attempt`,
        };
      }
      if (attempt.state === 'UNKNOWN') {
        return {
          ok: false as const,
          code: 'RECOVERY_NOT_APPLICABLE' as const,
          message: `settlement authority: attempt ${attempt.attemptId} is UNKNOWN — the only exit is the reconciliation resolution (GC-2); use applyResolution`,
        };
      }
      if (attempt.state !== 'SUBMITTED' && attempt.state !== 'PENDING') {
        return {
          ok: false as const,
          code: 'ATTEMPT_ALREADY_TERMINAL' as const,
          message: `settlement authority: attempt ${attempt.attemptId} is ${attempt.state}; outcomes mirror only onto SUBMITTED or PENDING attempts`,
        };
      }
      const operation = this.rails.getOperation(attempt.operationId);
      if (operation === undefined) {
        return {
          ok: false as const,
          code: 'OPERATION_NOT_FOUND' as const,
          message: `settlement authority: rail operation ${attempt.operationId} does not exist`,
        };
      }
      if (operation.payloadHash !== instruction.payloadHash) {
        return {
          ok: false as const,
          code: 'PAYLOAD_HASH_MISMATCH' as const,
          message: `settlement authority: the rail operation's payload hash does not match the instruction's recorded payload hash (INV-12-1) — refusing to mirror the outcome`,
        };
      }
      if (
        operation.status !== 'PENDING' &&
        operation.status !== 'CONFIRMED' &&
        operation.status !== 'FAILED' &&
        operation.status !== 'UNKNOWN'
      ) {
        // No outcome has landed on the rail side yet — a typed no-op.
        return {
          ok: true as const,
          value: { attempt, instruction, operation, unchanged: true } as AttemptOutcomeMirror &
            { readonly unchanged: boolean },
        };
      }
      if (operation.status === attempt.state) {
        return {
          ok: true as const,
          value: { attempt, instruction, operation, unchanged: true } as AttemptOutcomeMirror &
            { readonly unchanged: boolean },
        };
      }
      return this.landAttemptOutcome(attempt, instruction, operation);
    });
  }

  /**
   * Internal: land one attempt outcome (the shared consequence engine of
   * submitAttempt and applyRailOutcome). Emits exactly ONE
   * SETTLEMENT_ATTEMPT_RESOLVED record for the landing, applies the
   * instruction-level consequence, and — for a CONFIRMED landing — sets
   * the FinalityRecord to PROVISIONAL ("PROVISIONAL is set from rail
   * confirmation semantics") with its own FINALITY_DECLARED record.
   */
  private async landAttemptOutcome(
    attempt: SettlementAttemptRecord,
    instruction: SettlementInstructionRecord,
    operation: RailOperationRecord,
  ): Promise<SettlementCommandResult<AttemptOutcomeMirror>> {
    const target = operation.status;
    if (
      target !== 'PENDING' &&
      target !== 'CONFIRMED' &&
      target !== 'FAILED' &&
      target !== 'UNKNOWN'
    ) {
      throw new TypeError(
        `settlement authority: internal — cannot land rail status ${target} on an attempt`,
      );
    }
    // CREATED -> SUBMITTED (the handoff), then SUBMITTED -> the outcome —
    // both in memory; the single store write happens after the evidence
    // lands (A15: a failed write fails the operation with no state effect).
    let current = attempt;
    if (current.state === 'CREATED') {
      const handed = transitionSettlementAttempt(current, 'SUBMITTED', this.consume());
      if (!handed.ok) {
        throw new TypeError(
          'settlement authority: internal — attempt CREATED -> SUBMITTED refused by the frozen machine',
        );
      }
      current = handed.attempt;
    }
    const landed = transitionSettlementAttempt(current, target, this.consume());
    if (!landed.ok) {
      return {
        ok: false as const,
        code: 'ILLEGAL_TRANSITION' as const,
        message: `settlement authority: attempt ${attempt.attemptId} is ${current.state}; ${current.state} -> ${target} is not a legal SettlementAttempt transition`,
      };
    }
    let resolutionReference = operation.operationId;
    let updated = landed.attempt;
    if (target === 'UNKNOWN') {
      // "a reconciliation case (area 14) is opened automatically" — by
      // the A13/A14 wiring, atomically with the UNKNOWN landing. Exactly
      // one case per operation (INV-14-1); record its reference.
      const caseRecord = this.rails.caseForOperation(operation.operationId);
      if (caseRecord !== undefined) {
        updated = { ...updated, reconciliationCaseId: caseRecord.caseId } as SettlementAttemptRecord;
        resolutionReference = caseRecord.caseId;
      }
    }
    await submitSettlementEvidence(
      this.evidence,
      settlementAttemptResolvedEvidence(updated, updated.resolvedAt ?? this.now(), resolutionReference),
    );
    this.store.updateAttempt(updated);
    // The instruction-level consequence.
    let updatedInstruction = instruction;
    if (target === 'FAILED') {
      const failed = transitionSettlementInstruction(
        instruction,
        'FAILED',
        updated.resolvedAt ?? this.now(),
      );
      if (!failed.ok) {
        throw new TypeError(
          'settlement authority: internal — instruction ISSUED -> FAILED refused by the frozen machine',
        );
      }
      updatedInstruction = failed.instruction;
      this.store.updateInstruction(updatedInstruction);
    } else if (target === 'CONFIRMED') {
      const confirmed = transitionSettlementInstruction(
        instruction,
        'CONFIRMED',
        updated.resolvedAt ?? this.now(),
      );
      if (!confirmed.ok) {
        throw new TypeError(
          'settlement authority: internal — instruction ISSUED -> CONFIRMED refused by the frozen machine',
        );
      }
      updatedInstruction = confirmed.instruction;
      this.store.updateInstruction(updatedInstruction);
      // PROVISIONAL finality from the rail confirmation semantics.
      const provisional = await this.declareProvisionalFinality(
        instruction.subject,
        instruction,
        operation,
        'RAIL_CONFIRMATION_SEMANTICS',
      );
      if (!provisional.ok) {
        return {
          ok: false as const,
          code: provisional.code,
          message: provisional.message,
        };
      }
    }
    return {
      ok: true as const,
      value: {
        attempt: updated,
        instruction: updatedInstruction,
        operation,
        ...(updated.reconciliationCaseId === undefined
          ? {}
          : { caseId: updated.reconciliationCaseId }),
      },
    };
  }

  /**
   * Internal: create-or-keep the subject's FinalityRecord in PROVISIONAL
   * — "PROVISIONAL is set from rail confirmation semantics". Exactly one
   * record per subject (the derived-id key); a record already in FINAL
   * cannot be re-declared PROVISIONAL (that would reverse FINAL).
   */
  private async declareProvisionalFinality(
    subject: SettlementSubject,
    instruction: SettlementInstructionRecord,
    operation: RailOperationRecord | undefined,
    ruleReference: string,
  ): Promise<SettlementCommandResult<FinalityRecord>> {
    const existing = this.store.finalityForSubject(settlementSubjectKey(subject));
    if (existing !== undefined) {
      if (existing.state === 'FINAL') {
        return {
          ok: false as const,
          code: 'FINALITY_ALREADY_DECLARED' as const,
          message: `settlement authority: the finality record of subject ${settlementSubjectKey(subject)} is FINAL — FINAL is irreversible (INV-12-4)`,
        };
      }
      return { ok: true as const, value: existing };
    }
    const at = this.now();
    const finality: FinalityRecord = deepFreeze({
      finalityRecordId: finalityRecordIdFor(subject),
      subject,
      state: 'PROVISIONAL',
      instructionId: instruction.instructionId,
      ...(operation === undefined ? {} : { operationId: operation.operationId }),
      ruleReference,
      payloadHash: instruction.payloadHash,
      declaredProvisionalAt: at,
    });
    await submitSettlementEvidence(this.evidence, finalityDeclaredEvidence(finality, at));
    this.store.consumeSequence();
    this.store.insertFinality(finality);
    return { ok: true as const, value: finality };
  }

  // -------------------------------------------------------------------------
  // The safe-resume consumer (RTN-004's resolution interface)
  // -------------------------------------------------------------------------

  /**
   * Apply one reconciliation recovery directive — the safe-resume
   * semantics via RTN-004's resolution interface ("Resumption after
   * resolution is safe-resume, never re-submission of the same external
   * effect (GC-2)"):
   *   - AREA_12_FINALITY_ADVANCE (RESOLVED_CONFIRMED): the attempt
   *     UNKNOWN -> CONFIRMED, the instruction ISSUED -> CONFIRMED, and
   *     finality advances to PROVISIONAL ("area 12 marks the attempt
   *     CONFIRMED and advances finality") — the FINAL declaration
   *     remains the protocol rule's own step (declareFinality).
   *   - AREA_12_NEW_INSTRUCTION (RESOLVED_FAILED): the attempt UNKNOWN ->
   *     FAILED and the instruction ISSUED -> FAILED ("area 12 marks the
   *     attempt FAILED; a new instruction may be created, fully
   *     evidenced as a new external effect") — the subject stays
   *     SETTLEMENT_PENDING.
   *
   * Guards: the attempt must be UNKNOWN; the originating rail operation
   * must already carry the resolution's terminal outcome (the A14
   * authority transitions it exactly once, before the directive is
   * consumed); duplicate applications are refused (the attempt is no
   * longer UNKNOWN).
   *
   * Evidence: SETTLEMENT_ATTEMPT_RESOLVED "(outcome, resolution
   * reference)" + FINALITY_DECLARED (PROVISIONAL) for the advance path.
   *
   * Source: clearing-netting-settlement.md lines 264-273, 278;
   * rails-adapters-reconciliation.md lines 173-179; RecoveryDirective
   * (rails/types.ts).
   */
  async applyResolution(
    recovery: RecoveryDirective,
    caseId?: string,
  ): Promise<SettlementCommandResult<AttemptOutcomeMirror>> {
    if (recovery === null || typeof recovery !== 'object') {
      throw new TypeError('settlement authority: recovery must be a RecoveryDirective');
    }
    if (recovery.feed !== 'AREA_12_FINALITY_ADVANCE' && recovery.feed !== 'AREA_12_NEW_INSTRUCTION') {
      return {
        ok: false as const,
        code: 'RECOVERY_NOT_APPLICABLE' as const,
        message: `settlement authority: recovery feed ${recovery.feed} is not an area-12 directive`,
      };
    }
    return this.pipeline.run(SETTLEMENT_PIPELINE_KEY, async () => {
      const instructionId = recovery.instructionId;
      const instruction = this.store.instruction(instructionId);
      if (instruction === undefined) {
        return {
          ok: false as const,
          code: 'INSTRUCTION_NOT_FOUND' as const,
          message: `settlement authority: instruction ${instructionId} does not exist`,
        };
      }
      const attempt = this.store.attemptForInstruction(instructionId);
      if (attempt === undefined) {
        return {
          ok: false as const,
          code: 'ATTEMPT_NOT_FOUND' as const,
          message: `settlement authority: instruction ${instructionId} has no attempt`,
        };
      }
      if (attempt.state !== 'UNKNOWN') {
        return {
          ok: false as const,
          code: 'RECOVERY_NOT_APPLICABLE' as const,
          message: `settlement authority: attempt ${attempt.attemptId} is ${attempt.state} — only an UNKNOWN attempt consumes a reconciliation resolution (GC-2)`,
        };
      }
      const operation = this.rails.getOperation(attempt.operationId);
      if (operation === undefined) {
        return {
          ok: false as const,
          code: 'OPERATION_NOT_FOUND' as const,
          message: `settlement authority: rail operation ${attempt.operationId} does not exist`,
        };
      }
      if (operation.payloadHash !== instruction.payloadHash) {
        return {
          ok: false as const,
          code: 'PAYLOAD_HASH_MISMATCH' as const,
          message: `settlement authority: the rail operation's payload hash does not match the instruction's recorded payload hash (INV-12-1) — refusing the resolution`,
        };
      }
      const expectedOperationState = recovery.feed === 'AREA_12_FINALITY_ADVANCE' ? 'CONFIRMED' : 'FAILED';
      if (operation.status !== expectedOperationState) {
        return {
          ok: false as const,
          code: 'RECOVERY_NOT_APPLICABLE' as const,
          message: `settlement authority: the origin rail operation is ${operation.status}, but the ${recovery.feed} directive requires ${expectedOperationState} (the reconciliation authority transitions the operation before the directive is consumed)`,
        };
      }
      // The case reference: the recorded id, or the case-model query.
      const resolvedCaseId =
        caseId ??
        attempt.reconciliationCaseId ??
        this.rails.caseForOperation(operation.operationId)?.caseId;
      if (recovery.feed === 'AREA_12_FINALITY_ADVANCE' && resolvedCaseId === undefined) {
        return {
          ok: false as const,
          code: 'RECOVERY_NOT_APPLICABLE' as const,
          message:
            'settlement authority: no reconciliation case reference for the RESOLVED_CONFIRMed advance — the resolution reference is mandatory evidence',
        };
      }
      // INV-14-2's exactly-once, from the consuming side: if the case is
      // still open the resolution has not happened — refuse.
      if (resolvedCaseId !== undefined) {
        const caseRecord = this.rails.caseForOperation(operation.operationId);
        if (
          caseRecord !== undefined &&
          caseRecord.caseId === resolvedCaseId &&
          caseRecord.status !== 'RESOLVED_CONFIRMED' &&
          caseRecord.status !== 'RESOLVED_FAILED' &&
          caseRecord.status !== 'RESOLVED_ADJUSTED' &&
          caseRecord.status !== 'MATCHED'
        ) {
          return {
            ok: false as const,
            code: 'UNKNOWN_HELD' as const,
            message: `settlement authority: reconciliation case ${resolvedCaseId} is ${caseRecord.status} — the attempt stays UNKNOWN until the case is terminally resolved (GC-2)`,
          };
        }
      }
      // Land the resolution on the attempt.
      const target = recovery.feed === 'AREA_12_FINALITY_ADVANCE' ? 'CONFIRMED' : 'FAILED';
      const landed = transitionSettlementAttempt(attempt, target, this.consume());
      if (!landed.ok) {
        return {
          ok: false as const,
          code: 'ILLEGAL_TRANSITION' as const,
          message: `settlement authority: attempt ${attempt.attemptId} is ${attempt.state}; UNKNOWN -> ${target} is not a legal SettlementAttempt transition`,
        };
      }
      let updated = landed.attempt;
      const resolutionReference = resolvedCaseId ?? operation.operationId;
      if (resolvedCaseId !== undefined) {
        updated = { ...updated, reconciliationCaseId: resolvedCaseId } as SettlementAttemptRecord;
      }
      await submitSettlementEvidence(
        this.evidence,
        settlementAttemptResolvedEvidence(updated, updated.resolvedAt ?? this.now(), resolutionReference),
      );
      this.store.updateAttempt(updated);
      // The instruction-level consequence + finality advance.
      const instructionTarget = recovery.feed === 'AREA_12_FINALITY_ADVANCE' ? 'CONFIRMED' : 'FAILED';
      const transitioned = transitionSettlementInstruction(
        instruction,
        instructionTarget,
        updated.resolvedAt ?? this.now(),
      );
      if (!transitioned.ok) {
        throw new TypeError(
          'settlement authority: internal — instruction ISSUED -> terminal refused by the frozen machine',
        );
      }
      this.store.updateInstruction(transitioned.instruction);
      if (recovery.feed === 'AREA_12_FINALITY_ADVANCE') {
        const provisional = await this.declareProvisionalFinality(
          instruction.subject,
          instruction,
          operation,
          'RECONCILIATION_RESOLUTION_RESOLVED_CONFIRMED',
        );
        if (!provisional.ok) {
          return { ok: false as const, code: provisional.code, message: provisional.message };
        }
      }
      return {
        ok: true as const,
        value: {
          attempt: updated,
          instruction: transitioned.instruction,
          operation,
          ...(resolvedCaseId === undefined ? {} : { caseId: resolvedCaseId }),
        },
      };
    });
  }

  // -------------------------------------------------------------------------
  // Finality — the protocol rule (INV-12-4)
  // -------------------------------------------------------------------------

  /**
   * Declare FINAL — "FINAL is declared by protocol rule only". The
   * protocol rule this runtime materializes: the subject's finality
   * record is PROVISIONAL, the driving attempt is CONFIRMED, the
   * instruction is CONFIRMED (terminal), and no open reconciliation case
   * remains for the originating rail operation (GC-2). On the
   * declaration: the FinalityRecord advances PROVISIONAL -> FINAL
   * (irreversible — the machine has no other edge; there is no reversal
   * command anywhere in this surface), and the subject advances to
   * SETTLED exactly once ("FINAL advances the obligation to SETTLED
   * exactly once") — through the subject's owning port, with the
   * finality record id as the cause reference.
   *
   * Exactly-once: one FinalityRecord per subject (the derived-id key);
   * the PROVISIONAL -> FINAL edge fires at most once (a second
   * declaration is the typed FINALITY_ALREADY_DECLARED rejection —
   * except the tear-completion re-drive, which only completes a subject
   * transition left behind by a prior declaration and writes no second
   * record). An UNKNOWN attempt blocks the declaration (UNKNOWN_HELD)
   * until reconciliation resolves it.
   *
   * Evidence: FINALITY_DECLARED "(FINAL, rule reference, proof)".
   *
   * Source: clearing-netting-settlement.md lines 235-240, 259-262
   * (INV-12-4), 278-279.
   */
  async declareFinality(
    instructionId: string,
  ): Promise<SettlementCommandResult<FinalityRecord>> {
    if (typeof instructionId !== 'string' || instructionId.length === 0) {
      throw new TypeError('settlement authority: instructionId must be a non-empty string');
    }
    return this.pipeline.run(SETTLEMENT_PIPELINE_KEY, async () => {
      const instruction = this.store.instruction(instructionId);
      if (instruction === undefined) {
        return {
          ok: false as const,
          code: 'INSTRUCTION_NOT_FOUND' as const,
          message: `settlement authority: instruction ${instructionId} does not exist`,
        };
      }
      const attempt = this.store.attemptForInstruction(instructionId);
      if (attempt === undefined) {
        return {
          ok: false as const,
          code: 'ATTEMPT_NOT_FOUND' as const,
          message: `settlement authority: instruction ${instructionId} has no attempt`,
        };
      }
      if (attempt.state === 'UNKNOWN') {
        return {
          ok: false as const,
          code: 'UNKNOWN_HELD' as const,
          message: `settlement authority: attempt ${attempt.attemptId} is UNKNOWN — finality is blocked until reconciliation resolves it (GC-2)`,
        };
      }
      if (attempt.state !== 'CONFIRMED') {
        return {
          ok: false as const,
          code: 'NOT_PROVISIONAL' as const,
          message: `settlement authority: attempt ${attempt.attemptId} is ${attempt.state}; FINAL requires a CONFIRMED attempt`,
        };
      }
      if (instruction.state !== 'CONFIRMED') {
        return {
          ok: false as const,
          code: 'INSTRUCTION_TERMINAL' as const,
          message: `settlement authority: instruction ${instructionId} is ${instruction.state}; FINAL requires a CONFIRMED instruction`,
        };
      }
      // GC-2 belt-and-braces: no open case may remain.
      const caseRecord = this.rails.caseForOperation(attempt.operationId);
      if (
        caseRecord !== undefined &&
        caseRecord.status !== 'RESOLVED_CONFIRMED' &&
        caseRecord.status !== 'RESOLVED_FAILED' &&
        caseRecord.status !== 'RESOLVED_ADJUSTED' &&
        caseRecord.status !== 'MATCHED'
      ) {
        return {
          ok: false as const,
          code: 'UNKNOWN_HELD' as const,
          message: `settlement authority: reconciliation case ${caseRecord.caseId} is ${caseRecord.status} — finality is blocked until the case is terminally resolved (GC-2)`,
        };
      }
      const finality = this.store.finalityForSubject(settlementSubjectKey(instruction.subject));
      if (finality === undefined) {
        return {
          ok: false as const,
          code: 'NOT_PROVISIONAL' as const,
          message: `settlement authority: subject ${settlementSubjectKey(instruction.subject)} has no PROVISIONAL finality record to declare FINAL`,
        };
      }
      if (finality.state === 'FINAL') {
        // The tear-completion re-drive: a prior declaration wrote FINAL
        // but the subject transition may have been left behind — complete
        // it (exactly-once is protected by the subject machine itself);
        // write NO second record.
        const completion = await this.driveSubjectSettled(instruction, finality);
        if (!completion.ok) {
          return { ok: false as const, code: completion.code, message: completion.message };
        }
        return {
          ok: false as const,
          code: 'FINALITY_ALREADY_DECLARED' as const,
          message: `settlement authority: the finality record of subject ${settlementSubjectKey(instruction.subject)} is already FINAL — FINAL is exactly-once and irreversible (INV-12-4)`,
        };
      }
      const at = this.now();
      const advanced = transitionFinality(
        { ...finality, instructionId: instruction.instructionId, operationId: attempt.operationId, payloadHash: instruction.payloadHash },
        'FINAL',
        at,
      );
      if (!advanced.ok) {
        throw new TypeError(
          'settlement authority: internal — finality PROVISIONAL -> FINAL refused by the frozen machine',
        );
      }
      const declared: FinalityRecord = deepFreeze({
        ...advanced.finality,
        ruleReference: 'PROTOCOL_FINALITY_RULE_CONFIRMED_ATTEMPT_TERMINAL_INSTRUCTION_NO_OPEN_CASE',
      });
      await submitSettlementEvidence(this.evidence, finalityDeclaredEvidence(declared, at));
      this.store.consumeSequence();
      this.store.updateFinality(declared);
      const settled = await this.driveSubjectSettled(instruction, declared);
      if (!settled.ok) {
        return { ok: false as const, code: settled.code, message: settled.message };
      }
      return { ok: true as const, value: declared };
    });
  }

  /**
   * Internal: drive the subject to SETTLED — the A10 ledger's
   * SETTLEMENT_FINALITY advance for an OBLIGATION subject, the netting
   * domain's finality advance for a NET_POSITION subject — with the
   * finality record id as the cause reference. Both subject machines
   * enforce the exactly-once structurally (SETTLED is terminal with an
   * empty successor set; a second advance is their typed
   * ILLEGAL_TRANSITION).
   */
  private async driveSubjectSettled(
    instruction: SettlementInstructionRecord,
    finality: FinalityRecord,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly code: 'OBLIGATION_TRANSITION_REFUSED' | 'NET_OBLIGATION_NOT_FOUND' | 'SUBJECT_NOT_FOUND'; readonly message: string }> {
    const subject = instruction.subject;
    if (subject.kind === 'OBLIGATION') {
      const settled = await this.obligations.applySettlementFinality({
        kind: 'SETTLEMENT_FINALITY',
        obligationId: subject.obligationId,
        finalityRecordId: finality.finalityRecordId,
      });
      if (!settled.ok) {
        const obligation = this.obligations.obligation(subject.obligationId);
        if (obligation !== undefined && obligation.state === 'SETTLED') {
          // The exactly-once already fired (the re-drive idempotence).
          return { ok: true };
        }
        return {
          ok: false,
          code: 'OBLIGATION_TRANSITION_REFUSED',
          message: `settlement authority: the obligations ledger refused the SETTLED advance: ${settled.code} — ${settled.message}`,
        };
      }
      return { ok: true };
    }
    const settled = await this.netting.applyNetPositionSettlementFinality({
      netObligationId: subject.netObligationId,
      finalityRecordId: finality.finalityRecordId,
    });
    if (!settled.ok) {
      const netObligation = this.netting.netObligation(subject.netObligationId);
      if (netObligation !== undefined && netObligation.state === 'SETTLED') {
        return { ok: true };
      }
      return {
        ok: false,
        code: 'OBLIGATION_TRANSITION_REFUSED',
        message: `settlement authority: the netting domain refused the SETTLED advance: ${settled.code} — ${settled.message}`,
      };
    }
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Read surface (projections — GC-4)
  // -------------------------------------------------------------------------

  /** The instruction record by id. */
  instruction(instructionId: string): SettlementInstructionRecord | undefined {
    return this.store.instruction(instructionId);
  }

  /** All instruction records for one subject, in ordinal order. */
  instructionsForSubject(subject: SettlementSubject): readonly SettlementInstructionRecord[] {
    return this.store.instructionsForSubject(settlementSubjectKey(subject));
  }

  /** All instruction records (insertion order). */
  listInstructions(): readonly SettlementInstructionRecord[] {
    return this.store.listInstructions();
  }

  /** The attempt record by id. */
  attempt(attemptId: string): SettlementAttemptRecord | undefined {
    return this.store.attempt(attemptId);
  }

  /** The one attempt of one instruction (the INV-12-3 key). */
  attemptForInstruction(instructionId: string): SettlementAttemptRecord | undefined {
    return this.store.attemptForInstruction(instructionId);
  }

  /** All attempt records (insertion order). */
  listAttempts(): readonly SettlementAttemptRecord[] {
    return this.store.listAttempts();
  }

  /** The finality record by id. */
  finality(finalityRecordId: string): FinalityRecord | undefined {
    return this.store.finality(finalityRecordId);
  }

  /** The one finality record of one subject (the INV-12-4 exactly-once key). */
  finalityForSubject(subject: SettlementSubject): FinalityRecord | undefined {
    return this.store.finalityForSubject(settlementSubjectKey(subject));
  }

  /** All finality records (insertion order). */
  listFinalities(): readonly FinalityRecord[] {
    return this.store.listFinalities();
  }

  /**
   * The UNKNOWN-settlement hold: true while the subject's live
   * instruction has an UNKNOWN attempt ("the obligation remains in
   * SETTLEMENT_PENDING unchanged until reconciliation resolves the rail
   * operation" — GC-2). The composition root wires this into the A10
   * ledger's settlementHold probe.
   *
   * Source: clearing-netting-settlement.md §2 Area 10 lines 125-131;
   * README.md §3 GC-2.
   */
  isUnknownHeld(subject: SettlementSubject): boolean {
    const live = this.store
      .instructionsForSubject(settlementSubjectKey(subject))
      .find((instruction) => instruction.state === 'ISSUED');
    if (live === undefined) {
      return false;
    }
    const attempt = this.store.attemptForInstruction(live.instructionId);
    return attempt !== undefined && attempt.state === 'UNKNOWN';
  }
}
