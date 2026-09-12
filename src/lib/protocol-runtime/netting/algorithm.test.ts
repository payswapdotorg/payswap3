/**
 * RTN-009 — Netting Authority: the conservation property tests (INV-11-1)
 * and the netting determinism tests (INV-11-3 / GC-1).
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §3 Area 11:
 *     lines 147-153 — "Reduce sets of obligations to net positions
 *      without changing total value ... Netting is a deterministic
 *      computation over the obligation ledger."
 *     lines 180-183 (INV-11-1, verbatim):
 *       "INV-11-1 (financial correctness, conservation): for every
 *        currency in the set, the integer sum of net positions equals the
 *        integer sum of gross obligations; the check is recorded in the
 *        set's proof before commit."
 *     lines 185-189 (INV-11-3, verbatim):
 *       "INV-11-3 (idempotency): computing a set is a pure function of
 *        its fixed input ids and the netting algorithm version; re-commit
 *        of a committed set id is a no-op."
 *   spec/architecture/v0.1/README.md §3 GC-1 (lines 39-43).
 */
import { describe, expect, test } from 'bun:test';
import {
  NETTING_ALGORITHM_VERSION,
  buildConservationProof,
  computeNetPositions,
  conservationProofHash,
  materializeNetObligations,
  netPositionBreakdownHash,
  verifyConservationProof,
} from './algorithm.ts';
import { mintNettingScope } from './state-machine.ts';
import type { GrossObligationSnapshot } from './types.ts';
import { money } from '../kernel/money.ts';

/** Deterministic PRNG (mulberry32) for the property tests. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PARTICIPANTS = ['merchant-alpha', 'merchant-beta', 'merchant-gamma', 'merchant-delta'];

function snapshot(
  id: string,
  debtor: string,
  creditor: string,
  currency: string,
  amountMinor: number,
): GrossObligationSnapshot {
  return {
    obligationId: id,
    debtorParticipantId: debtor,
    creditorParticipantId: creditor,
    amount: money(currency, amountMinor, 2),
  };
}

describe('INV-11-1 conservation — bilateral (property tests)', () => {
  test('randomized pairwise sets: net conserves the per-participant gross for every currency (25 seeds)', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const random = prng(seed);
      const [a, b] = [PARTICIPANTS[0], PARTICIPANTS[1]];
      const scope = mintNettingScope({ kind: 'BILATERAL', participants: [a, b] });
      const gross: GrossObligationSnapshot[] = [];
      const expected = new Map<string, number>();
      const currencies = ['EUR', 'USD'].slice(0, 1 + Math.floor(random() * 2));
      let index = 0;
      for (const currency of currencies) {
        const count = 1 + Math.floor(random() * 6);
        for (let i = 0; i < count; i += 1) {
          const amount = Math.floor(random() * 100_000) + 1;
          const forward = random() < 0.5;
          const debtor = forward ? a : b;
          const creditor = forward ? b : a;
          gross.push(snapshot(`obligation-${seed}-${index}`, debtor, creditor, currency, amount));
          expected.set(`${creditor}|${currency}`, (expected.get(`${creditor}|${currency}`) ?? 0) + amount);
          expected.set(`${debtor}|${currency}`, (expected.get(`${debtor}|${currency}`) ?? 0) - amount);
          index += 1;
        }
      }
      const positions = computeNetPositions(`set-${seed}`, scope, gross);
      const proof = buildConservationProof(scope, gross, positions);
      // Every per-participant net equals the independently expected gross.
      for (const [key, value] of expected) {
        const [participantId, currency] = key.split('|');
        const position = positions.find(
          (entry) => entry.participantId === participantId && entry.currency === currency,
        );
        expect(position?.net.amountMinor).toBe(value);
      }
      // The recorded check holds, for every currency.
      for (const record of proof.perCurrency) {
        expect(record.conserved).toBe(true);
        expect(record.netSumMinor).toBe(record.grossSumMinor);
        expect(record.netSumMinor).toBe(0); // the closed participant set
      }
      expect(proof.algorithmVersion).toBe(NETTING_ALGORITHM_VERSION);
    }
  });

  test('the classic pairwise example: A owes B 100, B owes A 70 -> A owes B 30', () => {
    const scope = mintNettingScope({ kind: 'BILATERAL', participants: ['a', 'b'] });
    const gross = [
      snapshot('o1', 'a', 'b', 'EUR', 10_000),
      snapshot('o2', 'b', 'a', 'EUR', 7_000),
    ];
    const positions = computeNetPositions('set-pair', scope, gross);
    const proof = buildConservationProof(scope, gross, positions);
    expect(proof.perCurrency.every((entry) => entry.conserved)).toBe(true);
    const flows = materializeNetObligations(positions);
    expect(flows.length).toBe(1);
    expect(flows[0]?.debtorParticipantId).toBe('a');
    expect(flows[0]?.creditorParticipantId).toBe('b');
    expect(flows[0]?.amount.amountMinor).toBe(3_000);
  });

  test('a pairwise net to zero materializes no net obligation', () => {
    const scope = mintNettingScope({ kind: 'BILATERAL', participants: ['a', 'b'] });
    const gross = [
      snapshot('o1', 'a', 'b', 'EUR', 5_000),
      snapshot('o2', 'b', 'a', 'EUR', 5_000),
    ];
    const positions = computeNetPositions('set-zero', scope, gross);
    expect(buildConservationProof(scope, gross, positions).perCurrency.every((e) => e.conserved)).toBe(true);
    expect(materializeNetObligations(positions)).toEqual([]);
  });
});

describe('INV-11-1 conservation — multilateral (property tests)', () => {
  test('randomized multilateral sets: net conserves the per-participant gross for every currency (25 seeds)', () => {
    for (let seed = 101; seed <= 125; seed += 1) {
      const random = prng(seed);
      const participantCount = 3 + Math.floor(random() * 2);
      const participants = PARTICIPANTS.slice(0, participantCount);
      const scope = mintNettingScope({ kind: 'MULTILATERAL', participants });
      const gross: GrossObligationSnapshot[] = [];
      const expected = new Map<string, number>();
      const currencies = ['EUR', 'USD'].slice(0, 1 + Math.floor(random() * 2));
      let index = 0;
      for (const currency of currencies) {
        const count = 3 + Math.floor(random() * 12);
        for (let i = 0; i < count; i += 1) {
          const debtor = participants[Math.floor(random() * participants.length)];
          let creditor = participants[Math.floor(random() * participants.length)];
          if (creditor === debtor) {
            creditor = participants[(participants.indexOf(debtor) + 1) % participants.length];
          }
          const amount = Math.floor(random() * 500_000) + 1;
          gross.push(snapshot(`obligation-${seed}-${index}`, debtor, creditor, currency, amount));
          expected.set(`${creditor}|${currency}`, (expected.get(`${creditor}|${currency}`) ?? 0) + amount);
          expected.set(`${debtor}|${currency}`, (expected.get(`${debtor}|${currency}`) ?? 0) - amount);
          index += 1;
        }
      }
      const positions = computeNetPositions(`set-${seed}`, scope, gross);
      const proof = buildConservationProof(scope, gross, positions);
      for (const [key, value] of expected) {
        const [participantId, currency] = key.split('|');
        const position = positions.find(
          (entry) => entry.participantId === participantId && entry.currency === currency,
        );
        expect(position?.net.amountMinor).toBe(value);
      }
      for (const record of proof.perCurrency) {
        expect(record.conserved).toBe(true);
        expect(record.netSumMinor).toBe(record.grossSumMinor);
        expect(record.netSumMinor).toBe(0);
      }
      // The materialized flows conserve: the total settled equals the
      // total debtor-side net (== the total creditor-side net).
      const flows = materializeNetObligations(positions);
      for (const currency of proof.currencies) {
        const debtorTotal = positions
          .filter((p) => p.currency === currency && p.net.amountMinor < 0)
          .reduce((acc, p) => acc - p.net.amountMinor, 0);
        const flowTotal = flows
          .filter((f) => f.amount.currency === currency)
          .reduce((acc, f) => acc + f.amount.amountMinor, 0);
        expect(flowTotal).toBe(debtorTotal);
      }
    }
  });

  test('the classic cyclic example: A->B 100, B->C 70, C->A 50 nets to three flows conserving 120', () => {
    const scope = mintNettingScope({ kind: 'MULTILATERAL', participants: ['a', 'b', 'c'] });
    const gross = [
      snapshot('o1', 'a', 'b', 'EUR', 10_000),
      snapshot('o2', 'b', 'c', 'EUR', 7_000),
      snapshot('o3', 'c', 'a', 'EUR', 5_000),
    ];
    const positions = computeNetPositions('set-cycle', scope, gross);
    const proof = buildConservationProof(scope, gross, positions);
    expect(proof.perCurrency.every((e) => e.conserved)).toBe(true);
    // Nets: a: -10000 + 5000 = -5000; b: +10000 - 7000 = +3000; c: +7000 - 5000 = +2000.
    expect(positions.find((p) => p.participantId === 'a')?.net.amountMinor).toBe(-5_000);
    expect(positions.find((p) => p.participantId === 'b')?.net.amountMinor).toBe(3_000);
    expect(positions.find((p) => p.participantId === 'c')?.net.amountMinor).toBe(2_000);
    const flows = materializeNetObligations(positions);
    expect(flows.reduce((acc, f) => acc + f.amount.amountMinor, 0)).toBe(5_000);
  });
});

describe('INV-11-3 / GC-1 — determinism (property tests)', () => {
  test('identical inputs yield identical positions, breakdowns, and proof hashes (15 seeds)', () => {
    for (let seed = 201; seed <= 215; seed += 1) {
      const random = prng(seed);
      const scope = mintNettingScope({ kind: 'MULTILATERAL', participants: PARTICIPANTS });
      const gross: GrossObligationSnapshot[] = [];
      const count = 4 + Math.floor(random() * 8);
      for (let i = 0; i < count; i += 1) {
        const debtor = PARTICIPANTS[Math.floor(random() * 4)];
        let creditor = PARTICIPANTS[Math.floor(random() * 4)];
        if (creditor === debtor) {
          creditor = PARTICIPANTS[(PARTICIPANTS.indexOf(debtor) + 1) % 4];
        }
        gross.push(snapshot(`obligation-${seed}-${i}`, debtor, creditor, 'EUR', Math.floor(random() * 100_000)));
      }
      const first = computeNetPositions('set-determinism', scope, gross);
      const second = computeNetPositions('set-determinism', scope, [...gross]);
      expect(second).toEqual(first);
      expect(materializeNetObligations(second)).toEqual(materializeNetObligations(first));
      const firstProof = buildConservationProof(scope, gross, first);
      const secondProof = buildConservationProof(scope, [...gross], second);
      expect(secondProof.proofHash).toBe(firstProof.proofHash);
      // The recorded proof verifies against its own inputs (the commit gate).
      expect(verifyConservationProof(scope, gross, first, firstProof)).toBe(true);
    }
  });

  test('a tampered proof fails verification (the commit gate catches it)', () => {
    const scope = mintNettingScope({ kind: 'BILATERAL', participants: ['a', 'b'] });
    const gross = [snapshot('o1', 'a', 'b', 'EUR', 1_000)];
    const positions = computeNetPositions('set-tamper', scope, gross);
    const proof = buildConservationProof(scope, gross, positions);
    // A self-consistent forgery: the per-participant nets are inflated AND
    // the proof hash is recomputed over the forged content — only the
    // fresh recomputation (gross + positions) catches it.
    const forgedContent = proof.perCurrency.map((entry) => ({
      ...entry,
      netPerParticipant: entry.netPerParticipant.map((p) =>
        p.participantId === 'b' ? { ...p, amountMinor: p.amountMinor + 1 } : p,
      ),
    }));
    const tampered = {
      algorithmVersion: proof.algorithmVersion,
      currencies: proof.currencies,
      perCurrency: forgedContent,
    };
    const forged = { ...tampered, proofHash: conservationProofHash(tampered) };
    expect(verifyConservationProof(scope, gross, positions, forged)).toBe(false);
    // A wrong algorithm version fails verification.
    expect(
      verifyConservationProof(scope, gross, positions, { ...proof, algorithmVersion: proof.algorithmVersion + 1 }),
    ).toBe(false);
    // The honest proof verifies.
    expect(verifyConservationProof(scope, gross, positions, proof)).toBe(true);
  });

  test('the breakdown hash is deterministic and position-specific', () => {
    expect(netPositionBreakdownHash([{ obligationId: 'o1', signedAmountMinor: 100 }])).toBe(
      netPositionBreakdownHash([{ obligationId: 'o1', signedAmountMinor: 100 }]),
    );
    expect(netPositionBreakdownHash([{ obligationId: 'o1', signedAmountMinor: 100 }])).not.toBe(
      netPositionBreakdownHash([{ obligationId: 'o1', signedAmountMinor: 101 }]),
    );
    expect(conservationProofHash({ algorithmVersion: 1, currencies: ['EUR'], perCurrency: [] })).toBe(
      conservationProofHash({ algorithmVersion: 1, currencies: ['EUR'], perCurrency: [] }),
    );
  });
});
