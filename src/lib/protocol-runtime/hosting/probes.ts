/**
 * RTN-011 — Authority hosting: the health-signal probes.
 *
 * The transition-runtime component's health signal contract:
 *
 *   deploy/contracts/components.json, transition-runtime, health_signal:
 *     "Transition backlog depth and age; authoritative-state consistency
 *      probes (contract for the future work item)."
 *   spec/deployment/topology.md, transition-runtime, line 149:
 *     "Health signal (contract): transition backlog depth/age;
 *      authoritative-state consistency probes."
 *
 * Two probe families live here:
 *
 *   1. transitionBacklogSnapshot — the depth and age of the transition
 *      backlog over the durable command queue (waiting + in-flight,
 *      non-terminal jobs; the oldest ages by creation and eligibility),
 *      computed from the read-only TransitionQueueInsights port.
 *
 *   2. The authoritative-state consistency probes — the ledger identity
 *      invariants RTN-011.md line 25 names, verified OVER PERSISTED
 *      STATE (the per-domain stores' read bridges supply the records):
 *        - INV-5-1 (reservations): "for every resource, available =
 *          declared total minus held minus consumed, computed in integer
 *          Money; the identity holds after every transition" — AND the
 *          cross-artifact check that the persisted accounting rows agree
 *          with the arithmetic recomputed from the persisted reservation
 *          records;
 *        - INV-6-1 (liquidity): "pool total equals the integer sum of its
 *          positions at all times; per position, available + reserved +
 *          consumed arithmetic is exact and integer";
 *        - INV-11-1 (netting): "for every currency in the set, the
 *          integer sum of net positions equals the integer sum of gross
 *          obligations; the check is recorded in the set's proof before
 *          commit" — the probe re-verifies the recorded proof AND
 *          recomputes both sums from the persisted snapshots.
 *
 * The probes are PURE functions over the persisted-read record lists:
 * the Node harness (and the server runtime) reads the records through
 * the merged per-domain read bridges and calls the probes; the bun
 * suites verify the probe arithmetic on crafted fixtures (including
 * violation detection).
 *
 * Spec sources (binding): deploy/contracts/components.json
 * (transition-runtime health_signal); spec/architecture/v0.1/core.md
 * lines 304-306 (INV-5-1); spec/architecture/v0.1/liquidity-credit-
 * queues.md lines 52-55 (INV-6-1); spec/architecture/v0.1/clearing-
 * netting-settlement.md lines 180-183 (INV-11-1); RTN-011.md line 19
 * (the probe functions) and line 25 (the three ledger identities).
 */

import type { DurableJobStatus } from '../../durable/queue.ts';
import type { TransitionQueueInsights } from '../transition/substrate-port.ts';
import type { Money } from '../kernel/money.ts';
import type { ReservationRecord } from '../reservations/types.ts';
import type { ResourceAccounting } from '../reservations/resource.ts';
import type { LiquidityPoolRecord, LiquidityPositionRecord } from '../liquidity/types.ts';
import type { NettingSetRecord } from '../netting/types.ts';

// ---------------------------------------------------------------------------
// The transition backlog probe (depth and age)
// ---------------------------------------------------------------------------

/**
 * One transition-backlog snapshot: the health signal's "transition
 * backlog depth and age".
 *
 *   - depth             — all non-terminal jobs (waiting + in-flight):
 *                          the commands not yet transitioned to a
 *                          terminal outcome;
 *   - waitingCount      — queued/failed (eligible or awaiting backoff);
 *   - inFlightCount     — reserved (executing under a lease);
 *   - deadLetteredCount — terminal failures needing operator attention
 *                          (execution.md §16);
 *   - oldestBacklogAgeMs — now − the oldest non-terminal job's createdAt
 *                          (how long the oldest unfinished command has
 *                          been in the system);
 *   - oldestEligibleAgeMs — now − the oldest waiting job's availableAt
 *                          (the reservation-lag signal), clamped at 0.
 *
 * Source: deploy/contracts/components.json, transition-runtime,
 * health_signal — "Transition backlog depth and age".
 */
export interface TransitionBacklogSnapshot {
  readonly depth: number;
  readonly waitingCount: number;
  readonly inFlightCount: number;
  readonly deadLetteredCount: number;
  readonly oldestBacklogJobId: string | null;
  readonly oldestBacklogAgeMs: number | null;
  readonly oldestEligibleJobId: string | null;
  readonly oldestEligibleAgeMs: number | null;
  readonly sampledAtWallMs: number;
}

/**
 * Snapshot the transition backlog over the durable command queue
 * (read-only). The age of a job with a FUTURE availableAt (a scheduled
 * tick command) clamps to 0 — it is not backlogged, it is not yet due.
 *
 * Source: deploy/contracts/components.json, transition-runtime,
 * health_signal; spec/durable/execution.md §16 ("Observability:
 * queue.stats() returns per-status counts").
 */
export function transitionBacklogSnapshot(
  insights: TransitionQueueInsights,
  nowWallMs: number,
): TransitionBacklogSnapshot {
  const stats = insights.stats();
  const waiting = (stats.queued ?? 0) + (stats.failed ?? 0);
  const inFlight = stats.reserved ?? 0;
  const extremes = insights.backlogExtremes();
  const oldestBacklogAgeMs =
    extremes.oldestBacklog === null ? null : Math.max(0, nowWallMs - extremes.oldestBacklog.createdAt);
  const oldestEligibleAgeMs =
    extremes.oldestEligible === null ? null : Math.max(0, nowWallMs - extremes.oldestEligible.availableAt);
  return {
    depth: waiting + inFlight,
    waitingCount: waiting,
    inFlightCount: inFlight,
    deadLetteredCount: stats.dead_lettered ?? 0,
    oldestBacklogJobId: extremes.oldestBacklog?.jobId ?? null,
    oldestBacklogAgeMs,
    oldestEligibleJobId: extremes.oldestEligible?.jobId ?? null,
    oldestEligibleAgeMs,
    sampledAtWallMs: nowWallMs,
  };
}

// ---------------------------------------------------------------------------
// The consistency probes (ledger identities over persisted state)
// ---------------------------------------------------------------------------

/** One violation found by a consistency probe. */
export interface ConsistencyProbeViolation {
  /** The probe that found it (e.g. 'INV-5-1'). */
  readonly probe: string;
  /** The persisted subject the violation is about (resource/pool/set id). */
  readonly subject: string;
  /** The deterministic problem description. */
  readonly problem: string;
}

/** The result of one consistency probe run over persisted state. */
export interface ConsistencyProbeResult {
  /** The invariant's canonical id (e.g. 'INV-5-1'). */
  readonly probe: string;
  /** The invariant's spec text (verbatim). */
  readonly invariant: string;
  /** True iff no violation was found. */
  readonly holds: boolean;
  /** The number of persisted subjects inspected. */
  readonly inspected: number;
  readonly violations: readonly ConsistencyProbeViolation[];
}

function probeResult(
  probe: string,
  invariant: string,
  inspected: number,
  violations: ConsistencyProbeViolation[],
): ConsistencyProbeResult {
  return { probe, invariant, holds: violations.length === 0, inspected, violations };
}

function minorTotal(value: Money): number {
  return value.amountMinor;
}

/** Unit agreement on the MONEY primitives (currency + scale), GC-1. */
function sameUnitParts(currencyA: string, scaleA: number, currencyB: string, scaleB: number): boolean {
  return currencyA === currencyB && scaleA === scaleB;
}

/**
 * INV-5-1 over persisted reservation state — "for every resource,
 * available = declared total minus held minus consumed, computed in
 * integer Money; the identity holds after every transition" (core.md
 * lines 304-306) — verified TWICE over the persisted artifacts:
 *
 *   1. the arithmetic identity on each persisted accounting row:
 *      declared − held − consumed is a non-negative integer in the row's
 *      own unit (the recorded `available` is exactly that difference);
 *   2. the cross-artifact identity: the held/consumed totals RECOMPUTED
 *      from the persisted reservation records (held = Σ HELD amounts,
 *      consumed = Σ CONSUMED amounts, per resource, in each resource's
 *      unit) agree with the persisted accounting rows — two persisted
 *      artifacts describing the same authoritative state cannot disagree.
 *
 * Source: spec/architecture/v0.1/core.md lines 304-306 (INV-5-1);
 * RTN-011.md line 25 ("Consistency probes verify ledger identities
 * (INV-5-1, INV-6-1, INV-11-1) over persisted state").
 */
export function probeReservationLedgerIdentity(input: {
  readonly accountings: readonly ResourceAccounting[];
  readonly reservations: readonly ReservationRecord[];
}): ConsistencyProbeResult {
  const PROBE = 'INV-5-1';
  const invariant =
    'for every resource, available = declared total minus held minus consumed, computed in integer Money; ' +
    'the identity holds after every transition';
  const violations: ConsistencyProbeViolation[] = [];
  const recomputed = new Map<string, { held: number; consumed: number; currency: string; scale: number }>();
  for (const reservation of input.reservations) {
    const resourceId = reservation.resourceId;
    let bucket = recomputed.get(resourceId);
    if (!bucket) {
      bucket = {
        held: 0,
        consumed: 0,
        currency: reservation.amount.currency,
        scale: reservation.amount.scale,
      };
      recomputed.set(resourceId, bucket);
    }
    if (
      !sameUnitParts(
        reservation.amount.currency,
        reservation.amount.scale,
        bucket.currency,
        bucket.scale,
      )
    ) {
      violations.push({
        probe: PROBE,
        subject: resourceId,
        problem: `reservation ${reservation.reservationId} is in a different unit than the resource's other reservations`,
      });
      continue;
    }
    if (reservation.state === 'HELD') {
      bucket.held += minorTotal(reservation.amount);
    } else if (reservation.state === 'CONSUMED') {
      bucket.consumed += minorTotal(reservation.amount);
    }
    // REQUESTED / RELEASED / EXPIRED contribute to neither held nor
    // consumed (the merged INV-5-1 arithmetic).
  }
  for (const accounting of input.accountings) {
    const resourceId = accounting.resourceId;
    const declared = minorTotal(accounting.declaredTotal);
    const held = minorTotal(accounting.heldTotal);
    const consumed = minorTotal(accounting.consumedTotal);
    if (
      !sameUnitParts(
        accounting.declaredTotal.currency,
        accounting.declaredTotal.scale,
        accounting.heldTotal.currency,
        accounting.heldTotal.scale,
      ) ||
      !sameUnitParts(
        accounting.declaredTotal.currency,
        accounting.declaredTotal.scale,
        accounting.consumedTotal.currency,
        accounting.consumedTotal.scale,
      )
    ) {
      violations.push({
        probe: PROBE,
        subject: resourceId,
        problem: 'accounting triple mixes units (declared/held/consumed must share currency and scale)',
      });
      continue;
    }
    const available = declared - held - consumed;
    if (available < 0) {
      violations.push({
        probe: PROBE,
        subject: resourceId,
        problem: `declared ${declared} < held ${held} + consumed ${consumed} (available would be negative)`,
      });
    }
    const bucket = recomputed.get(resourceId);
    if (!bucket) {
      violations.push({
        probe: PROBE,
        subject: resourceId,
        problem: 'accounting row exists with no persisted reservation records recomputing it',
      });
      continue;
    }
    if (bucket.held !== held || bucket.consumed !== consumed) {
      violations.push({
        probe: PROBE,
        subject: resourceId,
        problem:
          `accounting row (held=${held}, consumed=${consumed}) disagrees with the recomputation from ` +
          `reservation records (held=${bucket.held}, consumed=${bucket.consumed})`,
      });
    }
  }
  for (const [resourceId, bucket] of recomputed) {
    if (!input.accountings.some((accounting) => accounting.resourceId === resourceId)) {
      violations.push({
        probe: PROBE,
        subject: resourceId,
        problem: `reservations exist (held=${bucket.held}, consumed=${bucket.consumed}) with no accounting row`,
      });
    }
  }
  return probeResult(PROBE, invariant, input.accountings.length, violations);
}

/**
 * INV-6-1 over persisted liquidity state — "pool total equals the
 * integer sum of its positions at all times; per position, available +
 * reserved + consumed arithmetic is exact and integer"
 * (liquidity-credit-queues.md lines 52-55):
 *
 *   1. per position: available + reserved + consumed === total (integer
 *      minor units, one unit per position);
 *   2. per pool: the persisted pool totalMinor equals the integer sum of
 *      its persisted positions' totals.
 *
 * Source: spec/architecture/v0.1/liquidity-credit-queues.md lines 52-55
 * (INV-6-1); RTN-011.md line 25.
 */
export function probeLiquidityPoolIdentity(input: {
  readonly pools: readonly LiquidityPoolRecord[];
  readonly positions: readonly LiquidityPositionRecord[];
}): ConsistencyProbeResult {
  const PROBE = 'INV-6-1';
  const invariant =
    'pool total equals the integer sum of its positions at all times; per position, ' +
    'available + reserved + consumed arithmetic is exact and integer';
  const violations: ConsistencyProbeViolation[] = [];
  const positionsByPool = new Map<string, LiquidityPositionRecord[]>();
  for (const position of input.positions) {
    const list = positionsByPool.get(position.poolId) ?? [];
    list.push(position);
    positionsByPool.set(position.poolId, list);
    if (
      !sameUnitParts(
        position.available.currency,
        position.available.scale,
        position.reserved.currency,
        position.reserved.scale,
      ) ||
      !sameUnitParts(
        position.available.currency,
        position.available.scale,
        position.consumed.currency,
        position.consumed.scale,
      ) ||
      !sameUnitParts(
        position.available.currency,
        position.available.scale,
        position.total.currency,
        position.total.scale,
      )
    ) {
      violations.push({
        probe: PROBE,
        subject: position.positionId,
        problem: 'position arithmetic mixes units (available/reserved/consumed/total must share unit)',
      });
      continue;
    }
    const sum =
      minorTotal(position.available) + minorTotal(position.reserved) + minorTotal(position.consumed);
    if (sum !== minorTotal(position.total)) {
      violations.push({
        probe: PROBE,
        subject: position.positionId,
        problem: `available + reserved + consumed = ${sum} ≠ total ${minorTotal(position.total)}`,
      });
    }
  }
  for (const pool of input.pools) {
    const positions = positionsByPool.get(pool.poolId) ?? [];
    const sum = positions.reduce(
      (acc, position) =>
        position.total.currency === pool.currency && position.total.scale === pool.scale
          ? acc + minorTotal(position.total)
          : acc,
      0,
    );
    if (positions.some((position) => position.total.currency !== pool.currency || position.total.scale !== pool.scale)) {
      violations.push({
        probe: PROBE,
        subject: pool.poolId,
        problem: 'a position of the pool is in a different unit than the pool (pools are single-currency — INV-6-2)',
      });
    }
    if (sum !== pool.totalMinor) {
      violations.push({
        probe: PROBE,
        subject: pool.poolId,
        problem: `pool totalMinor ${pool.totalMinor} ≠ the integer sum of its positions' totals ${sum}`,
      });
    }
  }
  for (const poolId of positionsByPool.keys()) {
    if (!input.pools.some((pool) => pool.poolId === poolId)) {
      violations.push({
        probe: PROBE,
        subject: poolId,
        problem: 'positions exist with no persisted pool row',
      });
    }
  }
  return probeResult(PROBE, invariant, input.pools.length, violations);
}

/**
 * INV-11-1 over persisted netting state — "for every currency in the set,
 * the integer sum of net positions equals the integer sum of gross
 * obligations; the check is recorded in the set's proof before commit"
 * (clearing-netting-settlement.md lines 180-183) — verified TWICE over
 * each persisted COMPUTED/COMMITTED set:
 *
 *   1. the recorded conservation proof itself (perCurrency.holds, and
 *      netSumMinor === grossSumMinor for every currency);
 *   2. the RECOMPUTED sums: Σ netPositions.net per currency (signed
 *      integer minor units) equals Σ grossObligations.amount per
 *      currency, and both equal the proof's recorded sums.
 *
 * Source: spec/architecture/v0.1/clearing-netting-settlement.md lines
 * 180-183 (INV-11-1); RTN-011.md line 25.
 */
export function probeNettingConservation(sets: readonly NettingSetRecord[]): ConsistencyProbeResult {
  const PROBE = 'INV-11-1';
  const invariant =
    'for every currency in the set, the integer sum of net positions equals the integer sum of gross ' +
    "obligations; the check is recorded in the set's proof before commit";
  const violations: ConsistencyProbeViolation[] = [];
  let inspected = 0;
  for (const set of sets) {
    if (set.state !== 'COMPUTED' && set.state !== 'COMMITTED') {
      // The conservation proof exists iff the set reached COMPUTED
      // (the record contract); nothing to verify before that.
      continue;
    }
    inspected += 1;
    const grossObligations = set.grossObligations ?? [];
    const netPositions = set.netPositions ?? [];
    const proof = set.conservationProof;
    if (!proof) {
      violations.push({
        probe: PROBE,
        subject: set.nettingSetId,
        problem: 'set is COMPUTED/COMMITTED with no recorded conservation proof',
      });
      continue;
    }
    for (const record of proof.perCurrency) {
      if (record.netSumMinor !== record.grossSumMinor) {
        violations.push({
          probe: PROBE,
          subject: set.nettingSetId,
          problem: `recorded proof: currency ${record.currency} netSumMinor ${record.netSumMinor} ≠ grossSumMinor ${record.grossSumMinor}`,
        });
      }
      if (record.conserved === false) {
        violations.push({
          probe: PROBE,
          subject: set.nettingSetId,
          problem: `recorded proof: currency ${record.currency} records conserved=false`,
        });
      }
    }
    // The recomputation, in the proof's own signed convention: a gross
    // obligation contributes -amount for its debtor and +amount for its
    // creditor; a net position carries its signed net. Per currency and
    // per participant, Σnet must equal Σgross (INV-11-1: "the integer sum
    // of net positions equals the integer sum of gross obligations").
    const grossPerParticipant = new Map<string, Map<string, number>>();
    for (const gross of grossObligations) {
      const byCurrency = grossPerParticipant.get(gross.debtorParticipantId) ?? new Map<string, number>();
      byCurrency.set(
        gross.amount.currency,
        (byCurrency.get(gross.amount.currency) ?? 0) - minorTotal(gross.amount),
      );
      grossPerParticipant.set(gross.debtorParticipantId, byCurrency);
      const creditorCurrencies =
        grossPerParticipant.get(gross.creditorParticipantId) ?? new Map<string, number>();
      creditorCurrencies.set(
        gross.amount.currency,
        (creditorCurrencies.get(gross.amount.currency) ?? 0) + minorTotal(gross.amount),
      );
      grossPerParticipant.set(gross.creditorParticipantId, creditorCurrencies);
    }
    const netPerParticipant = new Map<string, Map<string, number>>();
    for (const position of netPositions) {
      const byCurrency = netPerParticipant.get(position.participantId) ?? new Map<string, number>();
      byCurrency.set(
        position.currency,
        (byCurrency.get(position.currency) ?? 0) + minorTotal(position.net),
      );
      netPerParticipant.set(position.participantId, byCurrency);
    }
    for (const record of proof.perCurrency) {
      const currency = record.currency;
      let grossSum = 0;
      let netSum = 0;
      for (const [participantId, byCurrency] of grossPerParticipant) {
        grossSum += byCurrency.get(currency) ?? 0;
        if ((netPerParticipant.get(participantId)?.get(currency) ?? 0) !== (byCurrency.get(currency) ?? 0)) {
          violations.push({
            probe: PROBE,
            subject: set.nettingSetId,
            problem:
              `recomputed: participant ${participantId} net ${netPerParticipant.get(participantId)?.get(currency) ?? 0} ` +
              `≠ gross ${byCurrency.get(currency) ?? 0} in currency ${currency}`,
          });
        }
      }
      for (const byCurrency of netPerParticipant.values()) {
        netSum += byCurrency.get(currency) ?? 0;
      }
      if (netSum !== grossSum) {
        violations.push({
          probe: PROBE,
          subject: set.nettingSetId,
          problem: `recomputed: currency ${currency} Σnet ${netSum} ≠ Σgross ${grossSum}`,
        });
      }
      if (record.netSumMinor !== netSum || record.grossSumMinor !== grossSum) {
        violations.push({
          probe: PROBE,
          subject: set.nettingSetId,
          problem:
            `recomputed sums (net=${netSum}, gross=${grossSum}) disagree with the recorded proof ` +
            `(net=${record.netSumMinor}, gross=${record.grossSumMinor}) for currency ${currency}`,
        });
      }
    }
  }
  return probeResult(PROBE, invariant, inspected, violations);
}

/**
 * Run all three ledger-identity probes in one call (the health signal's
 * "authoritative-state consistency probes" over the persisted reads of
 * the three areas).
 *
 * Source: deploy/contracts/components.json, transition-runtime,
 * health_signal; RTN-011.md line 25.
 */
export function runLedgerIdentityProbes(input: {
  readonly reservations: {
    readonly accountings: readonly ResourceAccounting[];
    readonly reservations: readonly ReservationRecord[];
  };
  readonly liquidity: {
    readonly pools: readonly LiquidityPoolRecord[];
    readonly positions: readonly LiquidityPositionRecord[];
  };
  readonly netting: readonly NettingSetRecord[];
}): readonly ConsistencyProbeResult[] {
  return [
    probeReservationLedgerIdentity(input.reservations),
    probeLiquidityPoolIdentity(input.liquidity),
    probeNettingConservation(input.netting),
  ];
}
