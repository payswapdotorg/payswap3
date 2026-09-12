/**
 * RTN-007 — Credit Authority: the INV-7-1 property tests — randomized
 * command sequences over the REAL ledger and authority, asserting
 * "exposure never exceeds the line limit" after EVERY transition.
 *
 * Tested contract (spec-cited):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §2 Area 7, lines
 *   119-121 (INV-7-1, quoted in the module doc of exposure.ts).
 *
 * Determinism: the sequences are driven by a SEEDED xorshift32 PRNG
 * (integer arithmetic only — GC-1); identical seeds yield identical
 * sequences, so failures are reproducible.
 */
import { describe, expect, test } from 'bun:test';
import { createEvidenceLog } from '../evidence/log.ts';
import { money } from '../kernel/money.ts';
import { ReservationLedger } from '../reservations/ledger.ts';
import { CreditAuthority } from './authority.ts';
import { exposureInvariantHolds } from './exposure.ts';

/** Seeded xorshift32 — deterministic integer PRNG (no Math.random). */
function xorshift32(seed: number): () => number {
  let state = seed | 0;
  if (state === 0) {
    state = 0x9e3779b9;
  }
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    return Math.abs(state);
  };
}

const AMOUNT = (minor: number) => money('EUR', minor, 2);

async function runScenario(seed: number): Promise<{
  exposures: number[];
  states: string[];
  invariant: boolean;
  decisions: number;
}> {
  const random = xorshift32(seed);
  const log = createEvidenceLog({ wallMs: 1_000 });
  let wall = 5_000;
  const ledger = new ReservationLedger({ evidence: log, wallClock: () => wall });
  const authority = new CreditAuthority({ evidence: log, ledger, wallClock: () => wall });

  const lineCount = 1 + (random() % 3);
  for (let index = 0; index < lineCount; index += 1) {
    await authority.offerLine({ lineId: `line-${seed}-${index}`, limit: AMOUNT(100 * (5 + (random() % 10))) });
    await authority.activateLine(`line-${seed}-${index}`);
  }

  const check = (lineId: string) => {
    const view = authority.lineExposure(lineId);
    if (view === undefined) {
      throw new Error(`line ${lineId} vanished`);
    }
    if (!exposureInvariantHolds(view)) {
      throw new Error(`INV-7-1 violated at seed ${seed} on ${lineId}`);
    }
    if (view.exposure.amountMinor > view.limit.amountMinor) {
      throw new Error(`exposure exceeds the limit at seed ${seed} on ${lineId}`);
    }
  };
  const checkAll = () => {
    for (let index = 0; index < lineCount; index += 1) {
      check(`line-${seed}-${index}`);
    }
  };

  const liveReservations: string[] = [];
  let decisionCount = 0;
  for (let step = 0; step < 200; step += 1) {
    const roll = random() % 100;
    const lineIndex = random() % lineCount;
    const lineId = `line-${seed}-${lineIndex}`;
    if (roll < 40) {
      // Evaluate + apply a usage (a new intent each time — distinct keys).
      decisionCount += 1;
      const evaluation = await authority.evaluateCreditUsage({
        intentId: `pid.v1.i-${seed}-${decisionCount}`,
        lineId,
        requestedAmount: AMOUNT(100 * (1 + (random() % 6))),
      });
      if (evaluation.ok && evaluation.decision.outcome.kind === 'APPROVED') {
        const applied = await authority.applyCreditDecision({
          decisionId: evaluation.decision.decisionId,
          hopId: `pid.v1.h-${seed}-${decisionCount}`,
          deadlineEpochMs: 10_000 + 10_000 * (random() % 4),
        });
        if (applied.ok) {
          liveReservations.push(applied.reservationId);
        }
      }
    } else if (roll < 60 && liveReservations.length > 0) {
      const index = random() % liveReservations.length;
      const reservationId = liveReservations.splice(index, 1)[0] as string;
      await authority.consumeCreditReservation(reservationId);
    } else if (roll < 80 && liveReservations.length > 0) {
      const index = random() % liveReservations.length;
      const reservationId = liveReservations.splice(index, 1)[0] as string;
      await authority.releaseCreditReservation(reservationId);
    } else if (roll < 85) {
      wall += 45_000;
      const expired = await authority.expireDueCreditReservations();
      for (const expiredReservation of liveReservations.splice(0)) {
        const reservation = ledger.reservation(expiredReservation);
        if (reservation?.state === 'HELD') {
          liveReservations.push(expiredReservation);
        }
      }
      expect(expired.length).toBeGreaterThan(-1);
    } else if (roll < 90) {
      // Suspend (blocks new usage) or advance the machine.
      const line = authority.line(lineId);
      if (line?.state === 'ACTIVE') {
        await authority.suspendLine(lineId);
      }
    }
    checkAll();
  }

  const exposures = authority.linesInOrder().map((line) => authority.lineExposure(line.lineId)?.exposure.amountMinor ?? -1);
  const states = authority.linesInOrder().map((line) => line.state);
  return {
    exposures,
    states,
    invariant: authority.linesInOrder().every((line) => {
      const view = authority.lineExposure(line.lineId);
      return view !== undefined && exposureInvariantHolds(view);
    }),
    decisions: authority.decisionsInOrder().length,
  };
}

describe('INV-7-1 property tests (exposure never exceeds the line limit)', () => {
  test('randomized command sequences hold INV-7-1 at every step (15 seeds)', async () => {
    for (let seed = 1; seed <= 15; seed += 1) {
      const outcome = await runScenario(seed);
      expect(outcome.invariant).toBe(true);
      for (const exposure of outcome.exposures) {
        expect(exposure).toBeGreaterThan(-1);
      }
      expect(outcome.decisions).toBeGreaterThan(0);
    }
  });

  test('identical seeds yield identical scenarios (determinism, GC-1)', async () => {
    const first = await runScenario(1717);
    const second = await runScenario(1717);
    expect(second.exposures).toEqual(first.exposures);
    expect(second.decisions).toBe(first.decisions);
  });
});
