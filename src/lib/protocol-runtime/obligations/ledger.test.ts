/**
 * RTN-008 — Obligation Ledger Authority: the append-only, totally
 * sequenced ObligationLedger — the INV-10-1 negative tests (amount
 * mutation unrepresentable), INV-10-2 (serialized by sequence; at most
 * one transition per state), the fold's determinism, and the INV-10-4
 * content audit.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §2 Area 10,
 *   lines 104-106 ("ObligationLedger — append-only, totally sequenced
 *   log of obligation records and transitions"); lines 113-118
 *   (INV-10-1/INV-10-2, verbatim).
 */
import { describe, expect, test } from 'bun:test';
import { protocolTime } from '../kernel/time.ts';
import { deepFreeze } from './freeze.ts';
import { ObligationLedger } from './ledger.ts';
import { obligationIdForOriginRecord } from './state-machine.ts';
import type { ObligationCreatedEntry, ObligationRecord, ObligationTerms, ObligationTransitionedEntry } from './types.ts';

const TERMS: ObligationTerms = {
  debtorParticipantId: 'participant-a',
  creditorParticipantId: 'participant-b',
  amount: { currency: 'EUR', scale: 2, amountMinor: 1_000 } as ObligationTerms['amount'],
  reason: 'hop settlement',
};

function makeAuthorityLedger(): { ledger: ObligationLedger; obligationId: string } {
  const ledger = new ObligationLedger();
  const obligationId = obligationIdForOriginRecord('pid.v1.record-1');
  const entry: ObligationCreatedEntry = {
    kind: 'OBLIGATION_CREATED',
    sequence: 0,
    obligationId,
    terms: TERMS,
    origin: {
      kind: 'CLEARING',
      originRecordId: 'pid.v1.record-1',
      originActivityId: 'activity-1',
      batchId: 'pid.v1.batch-1',
    },
    createdBy: 'CLEARING_COMMIT',
    when: protocolTime(0, 1_000),
  };
  ledger.appendEntry(entry);
  return { ledger, obligationId };
}

describe('INV-10-1: the ledger never mutates an amount after creation (lines 113-116)', () => {
  test('the ledger surface has NO update, delete, clear, or truncate member (unrepresentable)', () => {
    const { ledger } = makeAuthorityLedger();
    const members = Object.getOwnPropertyNames(Object.getPrototypeOf(ledger)).concat(
      Object.getOwnPropertyNames(ledger),
    );
    for (const forbidden of ['update', 'delete', 'remove', 'clear', 'truncate', 'amend', 'rewrite']) {
      expect(members.includes(forbidden)).toBe(false);
    }
  });

  test('entries are deep-frozen: amount mutation attempts THROW (the value-layer machine check)', () => {
    const { ledger } = makeAuthorityLedger();
    const entry = ledger.entryAt(0) as ObligationCreatedEntry;
    expect(() => {
      (entry as unknown as { terms?: { amount?: { amountMinor?: number } } }).terms!.amount!.amountMinor = 999_999;
    }).toThrow();
    expect(() => {
      (entry as unknown as { obligationId?: string }).obligationId = 'forged';
    }).toThrow();
    // the frozen tree covers nested origins too
    expect(() => {
      ((entry as unknown as { origin?: Record<string, unknown> }).origin as Record<string, unknown>)['kind'] = 'FORGED';
    }).toThrow();
  });

  test('the projection records are deep-frozen: folding cannot be used to smuggle a mutation', () => {
    const { ledger } = makeAuthorityLedger();
    const record = ledger.foldOne(ledger.entryAt(0)?.obligationId ?? '') as ObligationRecord;
    expect(() => {
      (record as unknown as { terms?: { amount?: { amountMinor?: number } } }).terms!.amount!.amountMinor = 1;
    }).toThrow();
    expect(() => {
      (record as unknown as { state?: string }).state = 'SETTLED';
    }).toThrow();
  });

  test('entries snapshots are frozen copies: previously obtained snapshots never change', () => {
    const { ledger, obligationId } = makeAuthorityLedger();
    const before = ledger.entriesSnapshot();
    ledger.appendEntry({
      kind: 'OBLIGATION_TRANSITIONED',
      sequence: 1,
      obligationId,
      from: 'CREATED',
      to: 'SETTLEMENT_PENDING',
      instructionKind: 'SETTLEMENT_INSTRUCTION',
      causeReference: 'settlement-instruction-1',
      when: protocolTime(1, 2_000),
    });
    expect((before).length).toBe(1);
    expect((ledger.entriesSnapshot()).length).toBe(2);
    // the old snapshot cannot be mutated either
    expect(() => {
      (before as unknown as unknown[]).push({});
    }).toThrow();
  });

  test('deepFreeze throws on mutation of arbitrarily nested JSON trees', () => {
    const frozen = deepFreeze({ a: { b: { c: [1, { d: 2 }] } } });
    expect(() => {
      (frozen as unknown as { a: { b: { c: { d: number }[] } } }).a.b.c[1]!.d = 3;
    }).toThrow();
  });
});

describe('INV-10-2: serialized by sequence; at most one transition per state (lines 117-118)', () => {
  test('the ledger mints a gapless total order and rejects out-of-order appends', () => {
    const { ledger, obligationId } = makeAuthorityLedger();
    expect(ledger.height).toBe(1);
    expect(ledger.peekNextSequence()).toBe(1);
    const outOfOrder: ObligationTransitionedEntry = {
      kind: 'OBLIGATION_TRANSITIONED',
      sequence: 5, // not the next position
      obligationId,
      from: 'CREATED',
      to: 'SETTLEMENT_PENDING',
      instructionKind: 'SETTLEMENT_INSTRUCTION',
      causeReference: 'settlement-instruction-1',
      when: protocolTime(5, 2_000),
    };
    expect(() => ledger.appendEntry(outOfOrder)).toThrow(/gapless total order/);
  });

  test('sequenceInvariant: total order + no from-state repeats per obligation', () => {
    const { ledger, obligationId } = makeAuthorityLedger();
    ledger.appendEntry({
      kind: 'OBLIGATION_TRANSITIONED',
      sequence: 1,
      obligationId,
      from: 'CREATED',
      to: 'NETTED',
      instructionKind: 'NETTING_COMMIT',
      causeReference: 'netting-set-1',
      when: protocolTime(1, 2_000),
    });
    ledger.appendEntry({
      kind: 'OBLIGATION_TRANSITIONED',
      sequence: 2,
      obligationId,
      from: 'NETTED',
      to: 'SETTLEMENT_PENDING',
      instructionKind: 'SETTLEMENT_INSTRUCTION',
      causeReference: 'settlement-instruction-1',
      when: protocolTime(2, 3_000),
    });
    expect(ledger.sequenceInvariant()).toBe(true);
  });

  test('a second transition out of the same state breaks the invariant (the machine check detects it)', () => {
    const { ledger, obligationId } = makeAuthorityLedger();
    ledger.appendEntry({
      kind: 'OBLIGATION_TRANSITIONED',
      sequence: 1,
      obligationId,
      from: 'CREATED',
      to: 'SETTLEMENT_PENDING',
      instructionKind: 'SETTLEMENT_INSTRUCTION',
      causeReference: 'settlement-instruction-1',
      when: protocolTime(1, 2_000),
    });
    // a forged duplicate from-CREATED transition (the one-way DAG makes
    // this unreachable through the authority; the invariant check
    // catches it over the raw log)
    ledger.appendEntry({
      kind: 'OBLIGATION_TRANSITIONED',
      sequence: 2,
      obligationId,
      from: 'CREATED',
      to: 'CANCELLED',
      instructionKind: 'CLEARING_CORRECTION_CANCEL',
      causeReference: 'case-1',
      when: protocolTime(2, 3_000),
    });
    expect(ledger.sequenceInvariant()).toBe(false);
  });

  test('the fold is deterministic and equals the recorded projection (GC-1)', () => {
    const { ledger, obligationId } = makeAuthorityLedger();
    ledger.appendEntry({
      kind: 'OBLIGATION_TRANSITIONED',
      sequence: 1,
      obligationId,
      from: 'CREATED',
      to: 'SETTLEMENT_PENDING',
      instructionKind: 'SETTLEMENT_INSTRUCTION',
      causeReference: 'settlement-instruction-1',
      when: protocolTime(1, 2_000),
    });
    const first = ledger.fold();
    const second = ledger.fold();
    expect(first).toEqual(second);
    expect(first[0]?.state).toBe('SETTLEMENT_PENDING');
    expect(ledger.foldOne(obligationId)?.state).toBe('SETTLEMENT_PENDING');
  });

  test('the fold fails loudly on a corrupt log (a transition for an unknown obligation)', () => {
    const ledger = new ObligationLedger();
    ledger.appendEntry({
      kind: 'OBLIGATION_TRANSITIONED',
      sequence: 0,
      obligationId: 'pid.v1.never-created',
      from: 'CREATED',
      to: 'SETTLED',
      instructionKind: 'SETTLEMENT_FINALITY',
      causeReference: 'finality-1',
      when: protocolTime(0, 1_000),
    });
    expect(() => ledger.fold()).toThrow(/corrupt log/);
  });
});

describe('the INV-10-4 content audit over the written log (lines 119-123)', () => {
  test('a legal journey audit holds', () => {
    const { ledger, obligationId } = makeAuthorityLedger();
    ledger.appendEntry({
      kind: 'OBLIGATION_TRANSITIONED',
      sequence: 1,
      obligationId,
      from: 'CREATED',
      to: 'SETTLEMENT_PENDING',
      instructionKind: 'SETTLEMENT_INSTRUCTION',
      causeReference: 'settlement-instruction-1',
      when: protocolTime(1, 2_000),
    });
    ledger.appendEntry({
      kind: 'OBLIGATION_TRANSITIONED',
      sequence: 2,
      obligationId,
      from: 'SETTLEMENT_PENDING',
      to: 'SETTLED',
      instructionKind: 'SETTLEMENT_FINALITY',
      causeReference: 'finality-record-1',
      when: protocolTime(2, 3_000),
    });
    const audit = ledger.inv10_4Audit();
    expect(audit.holds).toBe(true);
    expect(audit.violations).toEqual([]);
  });

  test('the audit detects a creation outside the gate paths and a wrong terminalizer', () => {
    const ledger = new ObligationLedger();
    // a forged creation entry whose path is NOT a gate creation kind
    ledger.appendEntry({
      kind: 'OBLIGATION_CREATED',
      sequence: 0,
      obligationId: 'pid.v1.forged',
      terms: TERMS,
      origin: {
        kind: 'CLEARING',
        originRecordId: 'pid.v1.record-x',
        originActivityId: 'activity-x',
        batchId: 'pid.v1.batch-x',
      },
      createdBy: 'RISK_WRITE_OFF', // forged: risk write-offs never create
      when: protocolTime(0, 1_000),
    });
    // a forged terminalization via the wrong instruction kind
    ledger.appendEntry({
      kind: 'OBLIGATION_TRANSITIONED',
      sequence: 1,
      obligationId: 'pid.v1.forged',
      from: 'CREATED',
      to: 'WRITTEN_OFF',
      instructionKind: 'SETTLEMENT_FINALITY', // forged: the wrong terminalizer
      causeReference: 'finality-1',
      when: protocolTime(1, 2_000),
    });
    const audit = ledger.inv10_4Audit();
    expect(audit.holds).toBe(false);
    expect((audit.violations).length).toBe(2);
  });
});
