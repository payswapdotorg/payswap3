/**
 * RTN-009 — Settlement and Finality Authority: derived identity, the
 * deterministic rail idempotency key, the payload discipline, and the
 * pure record-transition carriers.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §4 Area 12:
 *     lines 253-262 (INV-12-2/INV-12-3/INV-12-4 — quoted in the module
 *      docs of the files they bind).
 *   spec/architecture/v0.1/rails-adapters-reconciliation.md §1 Area 13:
 *     lines 352-353 (INV-13-3: "each operation carries a deterministic
 *      rail idempotency key derived from the instruction id").
 *   src/lib/protocol-runtime/kernel/identity.ts — the deterministic
 *    derivation the INV idempotency contracts require.
 *   src/lib/protocol-runtime/rails/payload.ts — the canonical rail
 *    payload encoding + hash (INV-13-2), reused so the settlement
 *    domain's recorded payload hash IS the hash the rail authority
 *    computes and re-checks.
 *
 * Design (recorded in CONTRACT-REVIEW.md): every A12 id is DERIVED from
 * domain identity through the kernel: the instruction id from (subject
 * kind, subject id, subject ordinal — recovery is a NEW instruction with
 * a NEW ordinal, hence a NEW idempotency key: "recovery is a new
 * instruction with a new attempt, fully evidenced as a new external
 * effect"); the attempt id from the instruction id (INV-12-3: "attempt
 * authorization is keyed by instruction id" — at most one attempt per
 * instruction is structural); the finality record id from the subject
 * (one FinalityRecord per subject — INV-12-4's exactly-once is
 * structural). The rail idempotency key uses the SAME derivation the
 * merged A13 authority applies inside authorizeOperation
 * (deriveIdempotencyKey('rail.submit', instructionId)) so the key this
 * authority derives and records is the identical key the adapter
 * receives at transmission — one key per instruction, flowing only to
 * the A13 interface.
 */

import { deriveProtocolId, deriveIdempotencyKey } from '../kernel/identity.ts';
import type { DerivedIdempotencyKey } from '../kernel/identity.ts';
import { hashRailPayload } from '../rails/payload.ts';
import type { RailOperationPayload } from '../rails/index.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type {
  FinalityRecord,
  FinalityState,
  SettlementAttemptRecord,
  SettlementAttemptState,
  SettlementInstructionRecord,
  SettlementInstructionState,
  SettlementSubject,
} from './types.ts';
import {
  canTransitionFinality,
  canTransitionSettlementAttempt,
  canTransitionSettlementInstruction,
  settlementSubjectKey,
} from './types.ts';

/**
 * The Settlement and Finality Authority's derivation-format domain.
 * Versioned domain label so derived settlement ids are namespaced and
 * stable.
 *
 * Source: GC-1 (README.md §3 lines 39-43); INV-12-3
 * (clearing-netting-settlement.md lines 256-258).
 */
export const SETTLEMENT_DERIVATION_DOMAIN = 'settlement';

/**
 * Derive the SettlementInstruction id for one subject and ordinal. The
 * ordinal is the 1-based count of instructions ever created for the
 * subject, so the FIRST instruction is ordinal 1 and every recovery
 * instruction ("recovery is a new instruction with a new attempt, fully
 * evidenced") derives a fresh id — and therefore a fresh rail operation
 * and a fresh idempotency key, never a retry of the same external
 * effect.
 *
 * Source: clearing-netting-settlement.md lines 225-227, 264-266; GC-2;
 * the kernel identity discipline.
 */
export function settlementInstructionIdFor(
  subject: SettlementSubject,
  subjectOrdinal: number,
): string {
  return deriveProtocolId(
    SETTLEMENT_DERIVATION_DOMAIN,
    'instruction',
    subject.kind,
    settlementSubjectKey(subject),
    subjectOrdinal,
  );
}

/**
 * Derive the SettlementAttempt id for one instruction — INV-12-3's key:
 * "attempt authorization is keyed by instruction id". Identical
 * instruction ids always derive the identical attempt id, so at most
 * one attempt per instruction is STRUCTURAL (the INV-12-2
 * single-attempt rule by construction).
 *
 * Source: clearing-netting-settlement.md lines 253-258 (INV-12-2,
 * INV-12-3).
 */
export function settlementAttemptIdFor(instructionId: string): string {
  return deriveProtocolId(SETTLEMENT_DERIVATION_DOMAIN, 'attempt', instructionId);
}

/**
 * Derive the FinalityRecord id for one settlement subject — one record
 * per subject, ever: INV-12-4's "FINAL is exactly-once per obligation" is
 * structural (a second record for one subject cannot exist).
 *
 * Source: clearing-netting-settlement.md lines 235-240, 259-262
 * (INV-12-4).
 */
export function finalityRecordIdFor(subject: SettlementSubject): string {
  return deriveProtocolId(
    SETTLEMENT_DERIVATION_DOMAIN,
    'finality',
    subject.kind,
    settlementSubjectKey(subject),
  );
}

/**
 * The deterministic rail idempotency key for one instruction — the exact
 * derivation the merged A13 authority applies (rails/authority.ts
 * authorizeOperation: deriveIdempotencyKey('rail.submit',
 * instructionId)), exposed here so the Settlement Authority derives the
 * key, RECORDS it in the attempt and its
 * SETTLEMENT_ATTEMPT_AUTHORIZED evidence, and hands the instruction to
 * the A13 interface — which derives the identical key and passes it to
 * the adapter at transmission. "Rail idempotency keys are derived
 * deterministically and passed to the adapter" (INV-12-3; INV-13-3).
 *
 * Source: clearing-netting-settlement.md lines 256-258 (INV-12-3);
 * rails-adapters-reconciliation.md lines 66-69 (INV-13-3).
 */
export function railIdempotencyKeyForInstruction(instructionId: string): DerivedIdempotencyKey {
  return deriveIdempotencyKey('rail.submit', instructionId);
}

/**
 * The rail operation id for one instruction — the A13 derivation
 * (deriveProtocolId('rail-operation', instructionId)), used to link the
 * attempt to the operation created through the A13 interface.
 *
 * Source: rails-adapters-reconciliation.md lines 33-40 (the operation's
 * instruction link — "this link is the explicit authorization required by
 * GC-3"); rails/authority.ts authorizeOperation.
 */
export function railOperationIdForInstruction(instructionId: string): string {
  return deriveProtocolId('rail-operation', instructionId);
}

/**
 * Build the rail operation payload for one instruction: the instruction
 * id link (GC-3), the integer Money copied VERBATIM (INV-12-1 / INV-13-2:
 * "operation payloads carry integer Money verbatim from the
 * authorization"), and the beneficiary.
 *
 * Source: clearing-netting-settlement.md lines 224-227, 247-249;
 * rails-adapters-reconciliation.md lines 36-40, 63-65.
 */
export function settlementRailPayload(
  instruction: SettlementInstructionRecord,
): RailOperationPayload {
  const payload: RailOperationPayload = {
    instructionId: instruction.instructionId,
    money: instruction.amount,
    beneficiary: instruction.beneficiary,
    ...(instruction.memo === undefined ? {} : { memo: instruction.memo }),
  };
  return payload;
}

/**
 * The payload hash of an instruction's rail content — the INV-12-1
 * recorded hash ("the rail operation payload hash is recorded and
 * compared on result"), computed through the SAME rails canonical
 * encoder the A13 authority uses, so the recorded hash equals the hash
 * the rail operation carries and re-checks on every report (INV-13-2).
 *
 * Source: clearing-netting-settlement.md lines 247-249 (INV-12-1);
 * rails-adapters-reconciliation.md lines 63-65 (INV-13-2);
 * rails/payload.ts (the canonical encoder + hash).
 */
export function settlementPayloadHash(payload: RailOperationPayload): string {
  return hashRailPayload(payload);
}

/**
 * Apply one SettlementInstruction transition — the pure carrier of the
 * exact machine (CREATED -> ISSUED -> terminal; the terminals have empty
 * successor sets — recovery is a NEW instruction, never a transition out
 * of a terminal).
 *
 * Source: clearing-netting-settlement.md lines 225-227, 264-266.
 */
export function transitionSettlementInstruction(
  instruction: SettlementInstructionRecord,
  to: SettlementInstructionState,
  when: ProtocolTime,
): { readonly ok: true; readonly instruction: SettlementInstructionRecord } | { readonly ok: false } {
  if (!canTransitionSettlementInstruction(instruction.state, to)) {
    return { ok: false };
  }
  return {
    ok: true,
    instruction: {
      ...instruction,
      state: to,
      ...(to === 'ISSUED' ? { issuedAt: when } : {}),
      ...(to === 'CONFIRMED' || to === 'FAILED' ? { terminalAt: when } : {}),
    },
  };
}

/**
 * Apply one SettlementAttempt transition — the pure carrier of the exact
 * machine. The UNKNOWN -> {CONFIRMED, FAILED} edges are legal ONLY for
 * the reconciliation-resolution consumer (no normal command passes them
 * — the command surface enforces this; the table mirrors the A13
 * RailOperation machine).
 *
 * Source: clearing-netting-settlement.md lines 228-233, 264-273.
 */
export function transitionSettlementAttempt(
  attempt: SettlementAttemptRecord,
  to: SettlementAttemptState,
  when: ProtocolTime,
): { readonly ok: true; readonly attempt: SettlementAttemptRecord } | { readonly ok: false } {
  if (!canTransitionSettlementAttempt(attempt.state, to)) {
    return { ok: false };
  }
  return {
    ok: true,
    attempt: {
      ...attempt,
      state: to,
      ...(to === 'SUBMITTED' ? { submittedAt: when } : {}),
      ...(to !== 'SUBMITTED' ? { resolvedAt: when } : {}),
    },
  };
}

/**
 * Apply one FinalityRecord transition — the pure carrier of the exact
 * machine: PROVISIONAL -> FINAL and nothing else. FINAL has an empty
 * successor set; there is no reversal edge anywhere.
 *
 * Source: clearing-netting-settlement.md lines 236-240, 259-262
 * (INV-12-4).
 */
export function transitionFinality(
  finality: FinalityRecord,
  to: FinalityState,
  when: ProtocolTime,
): { readonly ok: true; readonly finality: FinalityRecord } | { readonly ok: false } {
  if (!canTransitionFinality(finality.state, to)) {
    return { ok: false };
  }
  return {
    ok: true,
    finality: {
      ...finality,
      state: to,
      ...(to === 'PROVISIONAL' ? { declaredProvisionalAt: when } : {}),
      ...(to === 'FINAL' ? { declaredFinalAt: when } : {}),
    },
  };
}

/**
 * Mint the transition ProtocolTime for a settlement command (the domain
 * owns its monotonic sequence counter; this helper keeps the module
 * pure).
 *
 * Source: A15 line 28 — "when: protocol time (sequenced) and recorded wall
 * time." (the shared time shape — kernel time.ts).
 */
export function settlementTime(sequence: number, wallMs: number): ProtocolTime {
  return protocolTime(sequence, wallMs);
}
