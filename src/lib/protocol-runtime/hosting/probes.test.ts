/**
 * RTN-011 — The health-signal probes (bun suite): the transition backlog
 * snapshot and the three ledger-identity consistency probes.
 *
 * The probes are pure functions over persisted-read records; here they
 * are verified over BOTH real authority-produced state (the merged
 * authorities' own records — the realistic shapes) and crafted
 * corrupted fixtures (violation detection: a probe that cannot detect
 * drift is not a probe).
 *
 * Tested contracts (spec-cited):
 *   deploy/contracts/components.json, transition-runtime, health_signal:
 *   "Transition backlog depth and age; authoritative-state consistency
 *   probes (contract for the future work item)."
 *   spec/architecture/v0.1/core.md lines 304-306 (INV-5-1);
 *   spec/architecture/v0.1/liquidity-credit-queues.md lines 52-55
 *   (INV-6-1); spec/architecture/v0.1/clearing-netting-settlement.md
 *   lines 180-183 (INV-11-1); RTN-011.md line 25.
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import { createEvidenceLog } from '../evidence/log.ts';
import { openReservationLedger } from '../reservations/ledger.ts';
import { ObligationLedgerAuthority } from '../obligations/authority.ts';
import { NettingAuthority } from '../netting/authority.ts';
import type { NettingObligationLedgerPort } from '../netting/authority.ts';
import { LiquidityAuthority } from '../liquidity/authority.ts';
import {
  transitionBacklogSnapshot,
  probeReservationLedgerIdentity,
  probeLiquidityPoolIdentity,
  probeNettingConservation,
  runLedgerIdentityProbes,
} from './probes.ts';
import type { TransitionQueueInsights } from '../transition/substrate-port.ts';

const EUR = (minor: number) => money('EUR', minor, 2);

describe('the transition backlog probe (depth and age)', () => {
  test('an empty queue reports zero depth and null ages', () => {
    const insights: TransitionQueueInsights = {
      stats: () => ({ queued: 0, reserved: 0, succeeded: 0, failed: 0, dead_lettered: 0 }),
      backlogExtremes: () => ({ oldestBacklog: null, oldestEligible: null }),
    };
    const snapshot = transitionBacklogSnapshot(insights, 10_000);
    expect(snapshot.depth).toBe(0);
    expect(snapshot.waitingCount).toBe(0);
    expect(snapshot.inFlightCount).toBe(0);
    expect(snapshot.oldestBacklogAgeMs).toBeNull();
    expect(snapshot.oldestEligibleAgeMs).toBeNull();
    expect(snapshot.sampledAtWallMs).toBe(10_000);
  });

  test('depth counts waiting + in-flight; ages measure creation and eligibility', () => {
    const insights: TransitionQueueInsights = {
      stats: () => ({ queued: 2, reserved: 1, succeeded: 5, failed: 0, dead_lettered: 1 }),
      backlogExtremes: () => ({
        oldestBacklog: { jobId: 'job-1', createdAt: 9_000 },
        oldestEligible: { jobId: 'job-2', availableAt: 9_500 },
      }),
    };
    const snapshot = transitionBacklogSnapshot(insights, 10_000);
    expect(snapshot.depth).toBe(3);
    expect(snapshot.waitingCount).toBe(2);
    expect(snapshot.inFlightCount).toBe(1);
    expect(snapshot.deadLetteredCount).toBe(1);
    expect(snapshot.oldestBacklogJobId).toBe('job-1');
    expect(snapshot.oldestBacklogAgeMs).toBe(1_000);
    expect(snapshot.oldestEligibleJobId).toBe('job-2');
    expect(snapshot.oldestEligibleAgeMs).toBe(500);
  });

  test('a scheduled (not-yet-due) job clamps its eligible age to zero', () => {
    const insights: TransitionQueueInsights = {
      stats: () => ({ queued: 1, reserved: 0, succeeded: 0, failed: 0, dead_lettered: 0 }),
      backlogExtremes: () => ({
        oldestBacklog: { jobId: 'job-1', createdAt: 9_000 },
        oldestEligible: { jobId: 'job-1', availableAt: 12_000 },
      }),
    };
    const snapshot = transitionBacklogSnapshot(insights, 10_000);
    expect(snapshot.oldestEligibleAgeMs).toBe(0);
    expect(snapshot.oldestBacklogAgeMs).toBe(1_000);
  });
});

describe('the INV-5-1 reservation-ledger identity probe', () => {
  async function realLedger() {
    const log = createEvidenceLog({ wallMs: 1_000 });
    let wall = 5_000;
    const clock = () => wall;
    const ledger = await openReservationLedger({ evidence: log, wallClock: clock });
    await ledger.declareResource('res-1', EUR(10_000));
    await ledger.requestReservation({
      intentId: 'intent-a',
      hopId: 'hop-1',
      resourceId: 'res-1',
      amount: EUR(4_000),
      deadlineEpochMs: 99_999_999,
    });
    await ledger.requestReservation({
      intentId: 'intent-b',
      hopId: 'hop-2',
      resourceId: 'res-1',
      amount: EUR(2_500),
      deadlineEpochMs: 99_999_999,
    });
    await ledger.consumeReservation(ledger.reservations()[0]?.reservationId ?? '');
    return ledger;
  }

  test('holds over the real ledger state (recomputation agrees with the accounting)', async () => {
    const ledger = await realLedger();
    const accountings = [
      ledger.resourceAccounting('res-1') as NonNullable<ReturnType<typeof ledger.resourceAccounting>>,
    ];
    const result = probeReservationLedgerIdentity({
      accountings,
      reservations: ledger.reservations(),
    });
    expect(result.probe).toBe('INV-5-1');
    expect(result.holds).toBe(true);
    expect(result.inspected).toBe(1);
    expect(result.violations).toEqual([]);
    // The state under probe: 4_000 consumed + 2_500 held of 10_000.
    expect(accountings[0]?.consumedTotal.amountMinor).toBe(4_000);
    expect(accountings[0]?.heldTotal.amountMinor).toBe(2_500);
  });

  test('detects a corrupted accounting row (drift between the persisted artifacts)', async () => {
    const ledger = await realLedger();
    const honest = ledger.resourceAccounting('res-1');
    expect(honest).toBeDefined();
    const corrupted = {
      resourceId: 'res-1',
      declaredTotal: honest ? honest.declaredTotal : EUR(0),
      heldTotal: EUR(1),
      consumedTotal: honest ? honest.consumedTotal : EUR(0),
    };
    const result = probeReservationLedgerIdentity({
      accountings: [corrupted],
      reservations: ledger.reservations(),
    });
    expect(result.holds).toBe(false);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0]?.subject).toBe('res-1');
  });

  test('detects a negative-available accounting row', () => {
    const result = probeReservationLedgerIdentity({
      accountings: [
        {
          resourceId: 'res-2',
          declaredTotal: EUR(100),
          heldTotal: EUR(90),
          consumedTotal: EUR(20),
        },
      ],
      reservations: [
        {
          resourceId: 'res-2',
          reservationId: 'r-x',
          state: 'HELD',
          amount: EUR(90),
        } as never,
      ],
    });
    expect(result.holds).toBe(false);
    expect(result.violations.some((violation) => violation.problem.includes('negative'))).toBe(true);
  });

  test('detects reservations with no accounting row', () => {
    const result = probeReservationLedgerIdentity({
      accountings: [],
      reservations: [
        { resourceId: 'res-3', reservationId: 'r-y', state: 'HELD', amount: EUR(50) } as never,
      ],
    });
    expect(result.holds).toBe(false);
    expect(result.violations.some((violation) => violation.problem.includes('no accounting row'))).toBe(true);
  });
});

describe('the INV-6-1 liquidity-pool identity probe', () => {
  test('holds over the real liquidity authority state', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    let wall = 5_000;
    const clock = () => wall;
    const ledger = await openReservationLedger({ evidence: log, wallClock: clock });
    const liquidity = new LiquidityAuthority({ evidence: log, ledger, wallClock: clock });
    const opened = await liquidity.openPool({ poolId: 'pool-1', currency: 'EUR', scale: 2 });
    expect(opened.ok).toBe(true);
    await liquidity.recordConfirmedFunding({
      poolId: 'pool-1',
      source: { kind: 'INTERNAL_TRANSFER', referenceId: 'tr-1' },
      amount: EUR(8_000),
    });
    await liquidity.recordConfirmedFunding({
      poolId: 'pool-1',
      source: { kind: 'INTERNAL_TRANSFER', referenceId: 'tr-2' },
      amount: EUR(2_000),
    });
    const pool = liquidity.pool('pool-1');
    const positions = liquidity.positionsOf('pool-1');
    expect(pool).toBeDefined();
    expect(positions.length).toBe(2);
    const result = probeLiquidityPoolIdentity({ pools: [pool as never], positions: positions as never });
    expect(result.probe).toBe('INV-6-1');
    expect(result.holds).toBe(true);
    expect(result.inspected).toBe(1);
  });

  test('detects a pool total that disagrees with its positions', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const ledger = await openReservationLedger({ evidence: log, wallClock: () => 5_000 });
    const liquidity = new LiquidityAuthority({ evidence: log, ledger, wallClock: () => 5_000 });
    await liquidity.openPool({ poolId: 'pool-2', currency: 'EUR', scale: 2 });
    await liquidity.recordConfirmedFunding({
      poolId: 'pool-2',
      source: { kind: 'INTERNAL_TRANSFER', referenceId: 'tr-1' },
      amount: EUR(8_000),
    });
    const pool = liquidity.pool('pool-2');
    const positions = liquidity.positionsOf('pool-2');
    const corrupted = { ...(pool as object), totalMinor: 9_999 } as never;
    const result = probeLiquidityPoolIdentity({ pools: [corrupted], positions: positions as never });
    expect(result.holds).toBe(false);
    expect(result.violations.some((violation) => violation.subject === 'pool-2')).toBe(true);
  });
});

describe('the INV-11-1 netting conservation probe', () => {
  async function computedSet() {
    const log = createEvidenceLog({ wallMs: 1_000 });
    let wall = 5_000;
    const clock = () => wall;
    const obligations = new ObligationLedgerAuthority({ evidence: log, wallClock: clock });
    const netting = new NettingAuthority({
      evidence: log,
      obligations: obligations as unknown as NettingObligationLedgerPort,
      wallClock: clock,
    });
    const gross: Array<{ debtor: number; creditor: number }> = [
      { debtor: 10_000, creditor: 4_000 },
      { debtor: 4_000, creditor: 10_000 },
    ];
    let index = 0;
    for (const entry of gross) {
      await obligations.applyClearingCommand({
        batchId: `probe-batch-${index}`,
        recordId: `probe-rec-${index}`,
        originActivityId: `probe-activity-${index}`,
        originKind: 'INTENT',
        debtorParticipantId: 'alpha',
        creditorParticipantId: 'beta',
        amount: EUR(entry.debtor),
        reason: 'probe fixture',
      } as never);
      index += 1;
    }
    const ids = obligations.obligations().map((obligation) => obligation.obligationId);
    const opened = await netting.openNettingSet({
      label: 'probe-set',
      scope: { kind: 'BILATERAL', participants: ['alpha', 'beta'] },
      inputObligationIds: ids,
    });
    expect(opened.ok).toBe(true);
    const computed = await netting.computeNettingSet(opened.ok ? opened.value.nettingSetId : '');
    expect(computed.ok).toBe(true);
    return netting.nettingSet(opened.ok ? opened.value.nettingSetId : '');
  }

  test('holds over the real computed set (recorded proof verified + sums recomputed)', async () => {
    const set = await computedSet();
    expect(set?.conservationProof).toBeDefined();
    const result = probeNettingConservation([set as never]);
    expect(result.probe).toBe('INV-11-1');
    expect(result.holds).toBe(true);
    expect(result.inspected).toBe(1);
  });

  test('detects a corrupted conservation proof', async () => {
    const set = await computedSet();
    const proof = set?.conservationProof;
    expect(proof).toBeDefined();
    const corruptedSet = {
      ...set,
      conservationProof: {
        ...proof,
        perCurrency: proof?.perCurrency.map((record) => ({
          ...record,
          netSumMinor: record.netSumMinor + 1,
        })),
      },
    } as never;
    const result = probeNettingConservation([corruptedSet]);
    expect(result.holds).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  test('detects recomputation drift between net positions and gross obligations', async () => {
    const set = await computedSet();
    const netPositions = set?.netPositions ?? [];
    expect(netPositions.length).toBeGreaterThan(0);
    const corruptedSet = {
      ...set,
      netPositions: netPositions.map((position) => ({
        ...position,
        net: EUR(position.net.amountMinor + 7),
      })),
    } as never;
    const result = probeNettingConservation([corruptedSet]);
    expect(result.holds).toBe(false);
    expect(
      result.violations.some((violation) => violation.problem.includes('recomputed')),
    ).toBe(true);
  });

  test('sets before COMPUTED are not inspected (no proof exists yet)', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const obligations = new ObligationLedgerAuthority({ evidence: log, wallClock: () => 5_000 });
    await obligations.applyClearingCommand({
      batchId: 'b',
      recordId: 'r',
      originActivityId: 'a',
      originKind: 'INTENT',
      debtorParticipantId: 'alpha',
      creditorParticipantId: 'beta',
      amount: EUR(500),
      reason: 'x',
    } as never);
    const netting = new NettingAuthority({
      evidence: log,
      obligations: obligations as unknown as NettingObligationLedgerPort,
      wallClock: () => 5_000,
    });
    const ids = obligations.obligations().map((obligation) => obligation.obligationId);
    const opened = await netting.openNettingSet({
      label: 'open-only',
      scope: { kind: 'BILATERAL', participants: ['alpha', 'beta'] },
      inputObligationIds: ids,
    });
    const setOpen = netting.nettingSet(opened.ok ? opened.value.nettingSetId : '');
    const result = probeNettingConservation([setOpen as never]);
    expect(result.inspected).toBe(0);
    expect(result.holds).toBe(true);
  });
});

describe('runLedgerIdentityProbes (the composed health signal)', () => {
  test('all three probes run and report their invariant ids', () => {
    const results = runLedgerIdentityProbes({
      reservations: { accountings: [], reservations: [] },
      liquidity: { pools: [], positions: [] },
      netting: [],
    });
    expect(results.length).toBe(3);
    expect(results.map((result) => result.probe)).toEqual(['INV-5-1', 'INV-6-1', 'INV-11-1']);
    expect(results.every((result) => result.holds)).toBe(true);
    // The invariant texts are the spec's, verbatim.
    expect(results[0]?.invariant).toContain('available = declared total minus held minus consumed');
    expect(results[1]?.invariant).toContain('pool total equals the integer sum of its positions');
    expect(results[2]?.invariant).toContain(
      'the integer sum of net positions equals the integer sum of gross obligations',
    );
  });
});
