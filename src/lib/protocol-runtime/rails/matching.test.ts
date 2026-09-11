/**
 * RTN-004 — Deterministic matching tests (INV-14-4) and the stable-string
 * transcript form. Pure functions — no store.
 *
 * Source of the tested contract — spec/architecture/v0.1/
 * rails-adapters-reconciliation.md §2 Area 14:
 *   line 126: "MATCHED: protocol expectation and external statement agree."
 *   line 137: "Discrepancies become cases."
 *   lines 156-159 (INV-14-4):
 *     "matching rules are pure functions of (protocol record set, external
 *      statement set, rule version); identical inputs produce identical case
 *      decisions."
 *   lines 168-170: "Reconciliation consumes external statements that may
 *    themselves be incomplete or delayed. Missing statements keep cases in
 *    INVESTIGATING; they never force a guess."
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import { deriveProtocolId, deriveIdempotencyKey } from '../kernel/identity.ts';
import { protocolTime } from '../kernel/time.ts';
import { matchReconciliationRecords, RAILS_MATCHING_RULE_VERSION, stableStringify } from './matching.ts';
import type { MatchOutcome } from './matching.ts';
import type { ExternalStatementRecord, RailOperationRecord } from './types.ts';

const WALL = 1_700_000_000_000;

function operation(
  instructionId: string,
  status: RailOperationRecord['status'],
  amountMinor = 1000,
  railReferences: readonly string[] = [],
): RailOperationRecord {
  const operationId = deriveProtocolId('rail-operation', instructionId);
  const at = protocolTime(1, WALL);
  return {
    operationId,
    instructionId,
    adapterId: deriveProtocolId('rail-adapter', 'bank', 'match-bank'),
    status,
    payload: { instructionId, money: money('USD', amountMinor, 2), beneficiary: 'acct-m' },
    payloadHash: `hash-${instructionId}`,
    idempotencyKey: deriveIdempotencyKey('rail.submit', instructionId),
    railReferences,
    authorizedAt: at,
    updatedAt: at,
  };
}

function statement(
  sourceId: string,
  sequence: number,
  ref: string,
  outcomeClass: ExternalStatementRecord['outcomeClass'],
  amountMinor = 1000,
  extra: Partial<ExternalStatementRecord> = {},
): ExternalStatementRecord {
  return {
    sourceId,
    sequence,
    railReference: ref,
    outcomeClass,
    amountMinor,
    currency: 'USD',
    assertedAtWallMs: WALL,
    ...extra,
  };
}

describe('INV-14-4 — pure deterministic matching', () => {
  test('agreement: same outcome class + same integer amount → matched', () => {
    const ops = [operation('instruction-a', 'CONFIRMED', 1000, ['simrail.m.1'])];
    const stmts = [
      statement('src-1', 1, 'simrail.m.1', 'CONFIRMED', 1000, { operationId: ops[0]?.operationId }),
    ];
    const outcome = matchReconciliationRecords(ops, stmts, RAILS_MATCHING_RULE_VERSION);
    expect(outcome.matched.length).toBe(1);
    expect(outcome.discrepancies.length).toBe(0);
    expect(outcome.matched[0]?.operationId).toBe(ops[0]?.operationId);
  });

  test('outcome mismatch and amount mismatch become discrepancies (never guesses)', () => {
    const confirmed = operation('instruction-b', 'CONFIRMED', 1000, ['simrail.m.2']);
    const pending = operation('instruction-c', 'PENDING', 1000, ['simrail.m.3']);
    const stmts = [
      statement('src-1', 2, 'simrail.m.2', 'FAILED', 1000, { operationId: confirmed.operationId }),
      statement('src-1', 3, 'simrail.m.3', 'PENDING', 500, { operationId: pending.operationId }),
    ];
    const outcome = matchReconciliationRecords([confirmed, pending], stmts, RAILS_MATCHING_RULE_VERSION);
    expect(outcome.matched.length).toBe(0);
    expect(outcome.discrepancies.length).toBe(2);
    expect(outcome.discrepancies[0]?.kind).toBe('OUTCOME_MISMATCH');
    expect(outcome.discrepancies[1]?.kind).toBe('AMOUNT_MISMATCH');
  });

  test('missing statements (incomplete external input) and unmatched statements become discrepancies', () => {
    const lonely = operation('instruction-d', 'PENDING', 1000, ['simrail.m.4']);
    const stmts = [statement('src-2', 1, 'simrail.m.ghost', 'CONFIRMED', 1000)];
    const outcome = matchReconciliationRecords([lonely], stmts, RAILS_MATCHING_RULE_VERSION);
    expect(outcome.matched.length).toBe(0);
    const kinds = outcome.discrepancies.map((d) => d.kind);
    expect(kinds).toContain('MISSING_STATEMENT');
    expect(kinds).toContain('UNMATCHED_STATEMENT');
  });

  test('malformed untrusted statements become cases, never exceptions', () => {
    const malformed = {
      sourceId: 'src-3',
      sequence: 0,
      railReference: '',
      outcomeClass: 'CONFIRMED',
      amountMinor: 1.5,
      currency: 'USD',
      assertedAtWallMs: WALL,
    } as unknown as ExternalStatementRecord;
    const outcome = matchReconciliationRecords([], [malformed], RAILS_MATCHING_RULE_VERSION);
    expect(outcome.discrepancies.length).toBe(1);
    expect(outcome.discrepancies[0]?.kind).toBe('MALFORMED_STATEMENT');
  });

  test('unsupported rule version fails closed (a stored rule version can never re-decide)', () => {
    const ops = [operation('instruction-e', 'CONFIRMED')];
    expect(() => matchReconciliationRecords(ops, [], 2)).toThrow(/rule version/);
    expect(() => matchReconciliationRecords(ops, [], 0)).toThrow(/INV-14-4 fail-closed/);
  });

  test('pairing priority: operationId > idempotencyKey > railReference', () => {
    const op = operation('instruction-f', 'PENDING', 1000, ['simrail.m.5']);
    // A statement that carries the operation id wins even when its rail
    // reference is unfamiliar.
    const byOperationId = statement('src-1', 1, 'ref-unfamiliar', 'PENDING', 1000, {
      operationId: op.operationId,
    });
    const outcomeA = matchReconciliationRecords([op], [byOperationId], RAILS_MATCHING_RULE_VERSION);
    expect(outcomeA.matched.length).toBe(1);
    // Without the operation id, the idempotency key pairs.
    const byKey = statement('src-1', 2, 'ref-unfamiliar-2', 'PENDING', 1000, {
      idempotencyKey: op.idempotencyKey,
    });
    const outcomeB = matchReconciliationRecords([op], [byKey], RAILS_MATCHING_RULE_VERSION);
    expect(outcomeB.matched.length).toBe(1);
    // Without either, the recorded rail reference pairs.
    const byRef = statement('src-1', 3, 'simrail.m.5', 'PENDING', 1000);
    const outcomeC = matchReconciliationRecords([op], [byRef], RAILS_MATCHING_RULE_VERSION);
    expect(outcomeC.matched.length).toBe(1);
    // A second statement for an already-matched operation is a duplicate
    // (discrepancy), not a re-pairing.
    const duplicate = statement('src-1', 4, 'simrail.m.5', 'PENDING', 1000);
    const outcomeD = matchReconciliationRecords([op], [byRef, duplicate], RAILS_MATCHING_RULE_VERSION);
    expect(outcomeD.matched.length).toBe(1);
    expect(outcomeD.discrepancies.length).toBe(1);
    expect(outcomeD.discrepancies[0]?.detail).toContain('duplicate statement');
  });
});

describe('INV-14-4 — determinism proof (identical inputs, identical decisions)', () => {
  const ops = [
    operation('instruction-x1', 'CONFIRMED', 1000, ['simrail.d.1']),
    operation('instruction-x2', 'PENDING', 2000, ['simrail.d.2']),
    operation('instruction-x3', 'UNKNOWN', 3000, ['simrail.d.3']),
    operation('instruction-x4', 'FAILED', 4000, ['simrail.d.4']),
  ];
  const stmts = [
    statement('src-1', 1, 'simrail.d.1', 'CONFIRMED', 1000, { operationId: ops[0]?.operationId }),
    statement('src-1', 2, 'simrail.d.2', 'CONFIRMED', 2000, { operationId: ops[1]?.operationId }),
    statement('src-1', 3, 'simrail.d.3', 'FAILED', 3000, { operationId: ops[2]?.operationId }),
    statement('src-1', 4, 'simrail.d.4', 'FAILED', 4000, { operationId: ops[3]?.operationId }),
    statement('src-2', 1, 'simrail.d.ghost', 'CONFIRMED', 999),
  ];

  function shuffled<T>(items: readonly T[], seed: number): T[] {
    const copy = [...items];
    // Deterministic Fisher-Yates with a fixed LCG seeded by `seed`.
    let state = seed;
    const random = (): number => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const a = copy[i];
      const b = copy[j];
      if (a !== undefined && b !== undefined) {
        copy[i] = b;
        copy[j] = a;
      }
    }
    return copy;
  }

  test('shuffled input arrays produce byte-identical outcomes', () => {
    const reference: MatchOutcome = matchReconciliationRecords(
      ops,
      stmts,
      RAILS_MATCHING_RULE_VERSION,
    );
    const referenceTranscript = stableStringify(reference);
    expect(reference.matched.length).toBe(2);
    expect(reference.discrepancies.length).toBe(3);
    for (const seed of [1, 7, 42, 1337, 20260911]) {
      const outcome = matchReconciliationRecords(
        shuffled(ops, seed),
        shuffled(stmts, seed + 1),
        RAILS_MATCHING_RULE_VERSION,
      );
      expect(stableStringify(outcome)).toBe(referenceTranscript);
    }
  });

  test('two runs on identical inputs produce identical case decisions', () => {
    const first = matchReconciliationRecords(ops, stmts, RAILS_MATCHING_RULE_VERSION);
    const second = matchReconciliationRecords(ops, stmts, RAILS_MATCHING_RULE_VERSION);
    expect(stableStringify(first)).toBe(stableStringify(second));
    expect(first).toEqual(second);
  });

  test('stableStringify is key-order insensitive and value-exact', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableStringify([3, { z: 'x', y: 'w' }])).toBe('[3,{"y":"w","z":"x"}]');
    expect(stableStringify(undefined)).toBe('undefined');
    expect(stableStringify(null)).toBe('null');
    // Distinct values never collapse.
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});
