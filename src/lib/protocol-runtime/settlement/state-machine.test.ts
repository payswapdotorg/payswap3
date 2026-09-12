/**
 * RTN-009 — Settlement and Finality Authority: the state machines, the
 * derived identity, and the deterministic rail idempotency key.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §4 Area 12:
 *     lines 225-227 — "SettlementInstruction ... States: CREATED -> ISSUED
 *      -> terminal(CONFIRMED | FAILED). ISSUED means a rail operation
 *      exists (area 13)."
 *     lines 228-233 — "SettlementAttempt ... States: CREATED -> SUBMITTED
 *      -> PENDING | terminal(CONFIRMED | FAILED | UNKNOWN). Exactly one
 *      attempt is authorized at a time per instruction; a second attempt
 *      requires the first to be terminally resolved via reconciliation."
 *     lines 236-240 — "FinalityRecord ... States: PROVISIONAL -> FINAL.
 *      ... FINAL is declared by protocol rule only. FINAL advances the
 *      obligation to SETTLED exactly once."
 *     lines 253-258 (INV-12-2 / INV-12-3).
 *   spec/architecture/v0.1/rails-adapters-reconciliation.md §1 Area 13
 *   lines 33-46 (the mirrored RailOperation machine), lines 66-69
 *   (INV-13-3: "each operation carries a deterministic rail idempotency
 *    key derived from the instruction id").
 *   spec/architecture/v0.1/README.md §3 GC-1.
 */
import { describe, expect, test } from 'bun:test';
import {
  SETTLEMENT_INSTRUCTION_STATES,
  SETTLEMENT_INSTRUCTION_TRANSITIONS,
  SETTLEMENT_ATTEMPT_STATES,
  SETTLEMENT_ATTEMPT_TRANSITIONS,
  FINALITY_STATES,
  FINALITY_TRANSITIONS,
  canTransitionFinality,
  canTransitionSettlementAttempt,
  canTransitionSettlementInstruction,
  isLiveSettlementAttempt,
  settlementSubjectKey,
} from './types.ts';
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
import { deriveIdempotencyKey } from '../kernel/identity.ts';
import { money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';

const WHEN = protocolTime(0, 0);
const EUR = (minor: number) => money('EUR', minor, 2);

describe('the SettlementInstruction machine (lines 225-227)', () => {
  test('the exact vocabulary and one-way chain', () => {
    expect([...SETTLEMENT_INSTRUCTION_STATES]).toEqual(['CREATED', 'ISSUED', 'CONFIRMED', 'FAILED']);
    expect([...SETTLEMENT_INSTRUCTION_TRANSITIONS.CREATED]).toEqual(['ISSUED']);
    expect([...SETTLEMENT_INSTRUCTION_TRANSITIONS.ISSUED]).toEqual(['CONFIRMED', 'FAILED']);
    // The terminals are one-way: recovery is a NEW instruction.
    expect([...SETTLEMENT_INSTRUCTION_TRANSITIONS.CONFIRMED]).toEqual([]);
    expect([...SETTLEMENT_INSTRUCTION_TRANSITIONS.FAILED]).toEqual([]);
    expect(canTransitionSettlementInstruction('CREATED', 'ISSUED')).toBe(true);
    expect(canTransitionSettlementInstruction('ISSUED', 'CREATED')).toBe(false);
    expect(canTransitionSettlementInstruction('FAILED', 'ISSUED')).toBe(false);
    expect(canTransitionSettlementInstruction('CREATED', 'CONFIRMED')).toBe(false);
  });

  test('the pure transition carrier stamps issuedAt / terminalAt', () => {
    const instruction = {
      instructionId: 'pid.v1.i',
      subject: { kind: 'OBLIGATION' as const, obligationId: 'pid.v1.o' },
      subjectOrdinal: 1,
      state: 'CREATED' as const,
      amount: EUR(100),
      beneficiary: 'acct-1',
      payloadHash: 'h',
      createdAt: WHEN,
    };
    const issued = transitionSettlementInstruction(instruction, 'ISSUED', WHEN);
    expect(issued.ok).toBe(true);
    if (issued.ok) {
      expect(issued.instruction.state).toBe('ISSUED');
      expect(issued.instruction.issuedAt).toBeDefined();
      const failed = transitionSettlementInstruction(issued.instruction, 'FAILED', WHEN);
      expect(failed.ok).toBe(true);
      if (failed.ok) {
        expect(failed.instruction.terminalAt).toBeDefined();
      }
    }
  });
});

describe('the SettlementAttempt machine (lines 228-233, the A13 mirror)', () => {
  test('the exact vocabulary', () => {
    expect([...SETTLEMENT_ATTEMPT_STATES]).toEqual([
      'CREATED',
      'SUBMITTED',
      'PENDING',
      'CONFIRMED',
      'FAILED',
      'UNKNOWN',
    ]);
  });

  test('the frozen table: the submission/report outcomes and the reconciliation-only exit from UNKNOWN', () => {
    expect([...SETTLEMENT_ATTEMPT_TRANSITIONS.CREATED]).toEqual(['SUBMITTED']);
    expect([...SETTLEMENT_ATTEMPT_TRANSITIONS.SUBMITTED]).toEqual([
      'PENDING',
      'CONFIRMED',
      'FAILED',
      'UNKNOWN',
    ]);
    expect([...SETTLEMENT_ATTEMPT_TRANSITIONS.PENDING]).toEqual([
      'CONFIRMED',
      'FAILED',
      'UNKNOWN',
    ]);
    // The A13 mirror: UNKNOWN -> {CONFIRMED, FAILED} exists in the table,
    // executable ONLY by the reconciliation-resolution consumer.
    expect([...SETTLEMENT_ATTEMPT_TRANSITIONS.UNKNOWN]).toEqual(['CONFIRMED', 'FAILED']);
    // The terminals are one-way.
    expect([...SETTLEMENT_ATTEMPT_TRANSITIONS.CONFIRMED]).toEqual([]);
    expect([...SETTLEMENT_ATTEMPT_TRANSITIONS.FAILED]).toEqual([]);
    // No blind retry, structurally.
    expect(canTransitionSettlementAttempt('PENDING', 'SUBMITTED')).toBe(false);
    expect(canTransitionSettlementAttempt('UNKNOWN', 'SUBMITTED')).toBe(false);
    expect(canTransitionSettlementAttempt('UNKNOWN', 'UNKNOWN')).toBe(false);
    expect(canTransitionSettlementAttempt('CREATED', 'PENDING')).toBe(false);
  });

  test('the INV-12-2 live set: CREATED, SUBMITTED, PENDING, and UNKNOWN are live (the UNKNOWN exit is reconciliation only)', () => {
    expect(isLiveSettlementAttempt('CREATED')).toBe(true);
    expect(isLiveSettlementAttempt('SUBMITTED')).toBe(true);
    expect(isLiveSettlementAttempt('PENDING')).toBe(true);
    expect(isLiveSettlementAttempt('UNKNOWN')).toBe(true);
    expect(isLiveSettlementAttempt('CONFIRMED')).toBe(false);
    expect(isLiveSettlementAttempt('FAILED')).toBe(false);
  });
});

describe('the FinalityRecord machine (lines 236-240, INV-12-4)', () => {
  test('the exact two-state vocabulary and the single one-way edge', () => {
    expect([...FINALITY_STATES]).toEqual(['PROVISIONAL', 'FINAL']);
    expect([...FINALITY_TRANSITIONS.PROVISIONAL]).toEqual(['FINAL']);
    // There is no reversal edge anywhere — FINAL is irreversible.
    expect([...FINALITY_TRANSITIONS.FINAL]).toEqual([]);
    expect(canTransitionFinality('PROVISIONAL', 'FINAL')).toBe(true);
    expect(canTransitionFinality('FINAL', 'PROVISIONAL')).toBe(false);
    expect(canTransitionFinality('PROVISIONAL', 'PROVISIONAL')).toBe(false);
    expect(canTransitionFinality('FINAL', 'FINAL')).toBe(false);
  });

  test('the pure transition carrier stamps the declaration times', () => {
    const finality = {
      finalityRecordId: 'pid.v1.f',
      subject: { kind: 'OBLIGATION' as const, obligationId: 'pid.v1.o' },
      state: 'PROVISIONAL' as const,
      ruleReference: 'RAIL_CONFIRMATION_SEMANTICS',
      declaredProvisionalAt: WHEN,
    };
    const advanced = transitionFinality(finality, 'FINAL', WHEN);
    expect(advanced.ok).toBe(true);
    if (advanced.ok) {
      expect(advanced.finality.state).toBe('FINAL');
      expect(advanced.finality.declaredFinalAt).toBeDefined();
      // Reversal is refused by the machine.
      expect(transitionFinality(advanced.finality, 'PROVISIONAL', WHEN).ok).toBe(false);
    }
  });
});

describe('derived identity and the deterministic rail idempotency key (INV-12-3 / INV-13-3)', () => {
  test('instruction ids derive from (subject, ordinal): recovery is a NEW id', () => {
    const subject = { kind: 'OBLIGATION' as const, obligationId: 'pid.v1.obligation' };
    const first = settlementInstructionIdFor(subject, 1);
    const second = settlementInstructionIdFor(subject, 2);
    expect(first).toBe(settlementInstructionIdFor(subject, 1));
    expect(first).not.toBe(second);
    const netSubject = { kind: 'NET_POSITION' as const, netObligationId: 'pid.v1.net' };
    expect(settlementInstructionIdFor(netSubject, 1)).not.toBe(
      settlementInstructionIdFor(subject, 1),
    );
    expect(settlementSubjectKey(subject)).toBe('pid.v1.obligation');
    expect(settlementSubjectKey(netSubject)).toBe('pid.v1.net');
  });

  test('attempt ids derive from the instruction id (INV-12-3: one attempt per instruction, structurally)', () => {
    expect(settlementAttemptIdFor('instr-1')).toBe(settlementAttemptIdFor('instr-1'));
    expect(settlementAttemptIdFor('instr-1')).not.toBe(settlementAttemptIdFor('instr-2'));
  });

  test('finality record ids derive from the subject (INV-12-4: one record per subject, structurally)', () => {
    const subject = { kind: 'OBLIGATION' as const, obligationId: 'pid.v1.obligation' };
    expect(finalityRecordIdFor(subject)).toBe(finalityRecordIdFor(subject));
    const netSubject = { kind: 'NET_POSITION' as const, netObligationId: 'pid.v1.net' };
    expect(finalityRecordIdFor(subject)).not.toBe(finalityRecordIdFor(netSubject));
  });

  test('the rail idempotency key derivation is the A13 authority\'s exact derivation, deterministic per instruction', () => {
    const key = railIdempotencyKeyForInstruction('instr-1');
    expect(key).toBe(deriveIdempotencyKey('rail.submit', 'instr-1'));
    expect(key).toBe(railIdempotencyKeyForInstruction('instr-1'));
    expect(key).not.toBe(railIdempotencyKeyForInstruction('instr-2'));
    expect(railOperationIdForInstruction('instr-1')).toBe(railOperationIdForInstruction('instr-1'));
    expect(railOperationIdForInstruction('instr-1')).not.toBe(railOperationIdForInstruction('instr-2'));
  });

  test('the payload hash covers the instruction link, the verbatim money, and the beneficiary (INV-12-1)', () => {
    const instruction = {
      instructionId: 'instr-1',
      amount: EUR(2_500),
      beneficiary: 'acct-9',
    };
    const payload = settlementRailPayload({ ...instruction, subject: { kind: 'OBLIGATION' as const, obligationId: 'o' }, subjectOrdinal: 1, state: 'CREATED' as const, payloadHash: '', createdAt: WHEN });
    expect(payload.instructionId).toBe('instr-1');
    expect(payload.money.amountMinor).toBe(2_500);
    expect(payload.beneficiary).toBe('acct-9');
    const hash = settlementPayloadHash(payload);
    expect(hash).toBe(settlementPayloadHash(payload));
    // Any content change changes the hash.
    expect(hash).not.toBe(
      settlementPayloadHash({ ...payload, money: EUR(2_501) }),
    );
    expect(hash).not.toBe(
      settlementPayloadHash({ ...payload, beneficiary: 'acct-8' }),
    );
    expect(hash).not.toBe(
      settlementPayloadHash({ ...payload, instructionId: 'instr-2' }),
    );
  });
});
