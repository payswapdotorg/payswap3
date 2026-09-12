/**
 * RTN-007 — Liquidity Authority: the composed single-writer command
 * surface for area 6 (A06).
 *
 * Spec sources (binding) — spec/architecture/v0.1/liquidity-credit-queues.md
 * §1 Area 6:
 *   lines 31-43 (the three objects and their exact state machines, quoted
 *     in types.ts).
 *   lines 47-48 (Owning authority):
 *     "Liquidity Authority (protocol layer, area 6) owns pool and position
 *      state. No other layer may recompute or duplicate it (GC-4)."
 *   lines 52-60 (the three invariants this authority enforces):
 *     "INV-6-1 (financial correctness): pool total equals the integer sum
 *      of its positions at all times; per position,
 *      available + reserved + consumed arithmetic is exact and integer."
 *     "INV-6-2 (concurrency): position transitions occur only via the
 *      area 5 serialized ledger; pools are single-currency, so no
 *      cross-currency arithmetic occurs here."
 *     "INV-6-3 (idempotency): a FundingEntry id applies exactly once;
 *      duplicate funding submissions are detected by id and recorded as
 *      duplicates without effect."
 *   lines 64-69 (failure and UNKNOWN semantics, verbatim):
 *     "Pool accounting is internal and deterministic. External funding is
 *      performed by area 13 rail operations, which may return UNKNOWN; in
 *      that case no FundingEntry exists yet — the pool is unchanged, and
 *      the case waits for reconciliation (GC-2). After reconciliation
 *      confirms the external funding, the FundingEntry is created exactly
 *      once. If reconciliation confirms failure, no entry is created."
 *   lines 71-75 (evidence produced); lines 77-82 (boundaries).
 *   spec/architecture/v0.1/core.md §5 Area 5 lines 293-295 ("The ledger is
 *     the concurrency frontier: all resource mutations pass through it in
 *     sequence order") and lines 335-336 ("Depends on areas 6, 7, and 3 as
 *     resource owners" — the position IS the resource this domain
 *     declares on the RTN-006 ledger).
 *   spec/architecture/v0.1/README.md §3 GC-1/GC-2/GC-4/GC-5.
 *
 * Command discipline:
 *   - Every position mutation passes THROUGH the RTN-006 ReservationLedger
 *     (INV-6-2): hold requests, consumes, releases, and expiries are
 *     ledger commands; the position record is the deterministic re-fold
 *     of the ledger's per-resource entry log (accounting.ts), recomputed
 *     after every command inside the per-position keyed serializer.
 *   - Every consequential operation submits its GC-5 evidence record
 *     FIRST (awaited) and commits state only after the write succeeds ("A
 *     failed write fails the operation", A15 lines 62-64).
 *   - INV-6-1 is asserted after EVERY transition (both sides: the
 *     per-position identity in the fold, and the pool total against the
 *     integer sum of position totals).
 *   - FundingEntry ids are derived from the linked source reference
 *     (rail operation id or internal transfer id) — INV-6-3's exactly-once
 *     is structural; duplicates are reported, never re-applied.
 *   - UNKNOWN external funding leaves the pool unchanged and opens a
 *     pending reconciliation linkage; only RESOLVED_CONFIRMED creates the
 *     entry (exactly once); RESOLVED_FAILED creates none (GC-2).
 *   - Domain rejections are typed values, never thrown; input-shape
 *     violations throw TypeError (kernel convention).
 *   - Frozen pools accept no new reservations (typed rejection before the
 *     ledger is touched); closure requires FROZEN and every position
 *     terminal ("closure is terminal after all positions settle").
 *
 * Serialization discipline: every pool-mutating command (pool machine,
 * funding, pending resolution) runs under the POOL key; every
 * position-mutating command (holds, refolds) runs under the POSITION key.
 * The two groups touch disjoint maps except the shared pool record and
 * the INV-6-1 assertion, whose commits are synchronous blocks (atomic wrt
 * the event loop), so cross-group observation is always pre- or
 * post-commit — never mid-commit.
 *
 * State layer (recorded in CONTRACT-REVIEW.md): in-process single writer —
 * the RTN-002/RTN-005 in-process-object-store precedent. The durable side
 * is persistence.ts + migrations/.
 */

import { deriveProtocolId } from '../kernel/identity.ts';
import { isMoney, money } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';
import type { EvidenceSubmission } from '../kernel/ports.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type { ReservationLedger } from '../reservations/ledger.ts';
import type {
  ReservationRequestResult,
  ReservationTerminalCommandResult,
} from '../reservations/types.ts';
import {
  foldPositionFromEntries,
  poolInvariantHolds,
  positionInvariantHolds,
  sumPositionTotals,
} from './accounting.ts';
import type { PositionFold, PositionLedgerProjection } from './accounting.ts';
import {
  fundingRecordedEvidence,
  poolClosedEvidence,
  poolFrozenEvidence,
  poolOpenedEvidence,
  positionStateChangedEvidence,
  submitLiquidityEvidence,
} from './evidence.ts';
import { KeyedSerializer } from './serializer.ts';
import { transitionPool } from './state-machine.ts';
import type {
  FundingCommandResult,
  FundingEntryRecord,
  FundingSource,
  LiquidityPoolRecord,
  LiquidityPositionRecord,
  LiquidityRejectionCode,
  PendingFundingLinkRecord,
  PendingFundingResolution,
  PoolState,
  ResolvePendingFundingResult,
} from './types.ts';
import { isFundingSourceKind, isPendingFundingResolution } from './types.ts';

/**
 * Constructor dependencies for the Liquidity Authority.
 *
 * Source: the wave evidence discipline (the REAL RTN-002 log through the
 * kernel port); the RTN-006 ReservationLedger — THE mutation interface
 * every position/exposure transition passes through; the
 * wallClock-injection convention for deterministic tests.
 */
export interface LiquidityAuthorityDeps {
  /** The EvidenceSubmission port — the real RTN-002 EvidenceLog. */
  readonly evidence: EvidenceSubmission;
  /**
   * The RTN-006 ReservationLedger — the area-5 concurrency frontier.
   * Every position mutation is a ledger command; the position projection
   * is the fold of the ledger's per-resource entry log.
   */
  readonly ledger: ReservationLedger;
  /** Injectable wall clock (epoch ms) for deterministic tests; default Date.now. */
  readonly wallClock?: () => number;
}

/**
 * The recorded hold of one requestPositionHold command — the updated
 * position plus the ledger reservation that drives it.
 *
 * Source: liquidity-credit-queues.md lines 38-39 ("Transitions are driven
 * exclusively by area 5 reservations"); core.md lines 286-291.
 */
export interface PositionHoldRecord {
  readonly position: LiquidityPositionRecord;
  readonly reservationId: string;
}

/** One command's rejection (typed, never thrown). */
export interface LiquidityRejection {
  readonly ok: false;
  readonly code: LiquidityRejectionCode;
  readonly problem: string;
}

/**
 * The Liquidity Authority: sole writer of pool and position state (GC-4).
 * Commands: openPool / freezePool / closePool (the exact pool machine);
 * recordConfirmedFunding (exactly-once FundingEntry + position +
 * ledger resource declaration); openPendingFunding / resolvePendingFunding
 * (the UNKNOWN funding path — pool unchanged until confirmation, GC-2);
 * requestPositionHold / consumeHold / releaseHold / expireDueHolds (the
 * ledger-mediated position machine).
 *
 * Source: liquidity-credit-queues.md lines 31-82; core.md lines 293-295,
 * 335-336.
 */
export class LiquidityAuthority {
  private readonly evidence: EvidenceSubmission;
  private readonly ledger: ReservationLedger;
  private readonly wallClock: () => number;
  private readonly serializer = new KeyedSerializer();
  private readonly pools = new Map<string, LiquidityPoolRecord>();
  private readonly positions = new Map<string, LiquidityPositionRecord>();
  private readonly entries = new Map<string, FundingEntryRecord>();
  private readonly pendingLinks = new Map<string, PendingFundingLinkRecord>();
  private readonly positionsByPool = new Map<string, string[]>();
  private protocolSequence = 0;

  constructor(deps: LiquidityAuthorityDeps) {
    if (
      deps.evidence === null ||
      typeof deps.evidence !== 'object' ||
      typeof deps.evidence.submit !== 'function'
    ) {
      throw new TypeError('liquidity authority: deps.evidence must be an EvidenceSubmission port');
    }
    if (deps.ledger === null || typeof deps.ledger !== 'object') {
      throw new TypeError('liquidity authority: deps.ledger must be a ReservationLedger');
    }
    this.evidence = deps.evidence;
    this.ledger = deps.ledger;
    this.wallClock = deps.wallClock ?? (() => Date.now());
  }

  // -------------------------------------------------------------------------
  // Time
  // -------------------------------------------------------------------------

  private nextTime(): ProtocolTime {
    const when = protocolTime(this.protocolSequence, this.wallClock());
    this.protocolSequence += 1;
    return when;
  }

  // -------------------------------------------------------------------------
  // Pool machine (OPEN -> FROZEN -> CLOSED, exact)
  // -------------------------------------------------------------------------

  /**
   * Open a pool — the protocol-owned account of funds usable for
   * fulfillment in ONE currency. Single-currency by construction: the
   * currency and scale are fixed at open time and every funding entry and
   * hold amount is checked against them (INV-6-2; cross-currency
   * arithmetic inside pools is a work-order stop condition).
   *
   * Source: liquidity-credit-queues.md lines 31-35; INV-6-2 lines 55-57.
   */
  async openPool(input: {
    readonly poolId: string;
    readonly currency: string;
    readonly scale: number;
  }): Promise<{ ok: true; replayed: boolean; pool: LiquidityPoolRecord } | LiquidityRejection> {
    if (typeof input.poolId !== 'string' || input.poolId.length === 0) {
      throw new TypeError('liquidity authority: poolId must be a non-empty string');
    }
    if (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency)) {
      throw new TypeError('liquidity authority: currency must be exactly 3 uppercase letters (GC-1)');
    }
    if (typeof input.scale !== 'number' || !Number.isInteger(input.scale) || input.scale < 0) {
      throw new TypeError('liquidity authority: scale must be a non-negative integer (GC-1)');
    }
    return this.serializer.run(`pool:${input.poolId}`, async () => {
      const existing = this.pools.get(input.poolId);
      if (existing !== undefined) {
        if (existing.currency === input.currency && existing.scale === input.scale) {
          return { ok: true as const, replayed: true, pool: existing };
        }
        return {
          ok: false as const,
          code: 'ILLEGAL_TRANSITION' as LiquidityRejectionCode,
          problem:
            `liquidity authority: pool ${input.poolId} already exists with ` +
            `${existing.currency}/${existing.scale}`,
        };
      }
      const when = this.nextTime();
      const pool: LiquidityPoolRecord = {
        poolId: input.poolId,
        currency: input.currency,
        scale: input.scale,
        state: 'OPEN',
        totalMinor: 0,
        openedAt: when,
        stateChangedAt: when,
      };
      await submitLiquidityEvidence(this.evidence, poolOpenedEvidence({ pool, when }));
      this.pools.set(pool.poolId, deepFreeze(pool));
      this.positionsByPool.set(pool.poolId, []);
      this.assertPoolInvariant(pool.poolId);
      return { ok: true as const, replayed: false, pool };
    });
  }

  /**
   * Freeze a pool — OPEN -> FROZEN. "Frozen pools accept no new
   * reservations": requestPositionHold on a frozen pool is the typed
   * POOL_FROZEN_NO_NEW_RESERVATIONS rejection (checked before the ledger
   * is touched); in-flight holds still consume/release/expiry through the
   * ledger.
   *
   * Source: liquidity-credit-queues.md lines 33-35, 73.
   */
  async freezePool(
    poolId: string,
  ): Promise<{ ok: true; replayed: boolean; pool: LiquidityPoolRecord } | LiquidityRejection> {
    if (typeof poolId !== 'string' || poolId.length === 0) {
      throw new TypeError('liquidity authority: poolId must be a non-empty string');
    }
    return this.serializer.run(`pool:${poolId}`, async () => {
      const pool = this.pools.get(poolId);
      if (pool === undefined) {
        return rejection('POOL_NOT_FOUND', `liquidity authority: pool ${poolId} is not recorded`);
      }
      if (pool.state === 'FROZEN') {
        return { ok: true as const, replayed: true, pool };
      }
      const when = this.nextTime();
      const transition = transitionPool(pool, 'FROZEN', when);
      if (!transition.ok) {
        return rejection(
          'ILLEGAL_TRANSITION',
          `liquidity authority: pool transition ${pool.state} -> FROZEN is not an edge of the exact v0.1 chain`,
        );
      }
      await submitLiquidityEvidence(this.evidence, poolFrozenEvidence({ pool: transition.pool, when }));
      this.pools.set(poolId, deepFreeze(transition.pool));
      return { ok: true as const, replayed: false, pool: transition.pool };
    });
  }

  /**
   * Close a pool — FROZEN -> CLOSED, terminal. Closure requires every
   * position terminal ("closure is terminal after all positions settle"):
   * a pool with a non-terminal position is the typed
   * POOL_HAS_UNSETTLED_POSITIONS rejection.
   *
   * Source: liquidity-credit-queues.md lines 33-35.
   */
  async closePool(
    poolId: string,
  ): Promise<{ ok: true; replayed: boolean; pool: LiquidityPoolRecord } | LiquidityRejection> {
    if (typeof poolId !== 'string' || poolId.length === 0) {
      throw new TypeError('liquidity authority: poolId must be a non-empty string');
    }
    return this.serializer.run(`pool:${poolId}`, async () => {
      const pool = this.pools.get(poolId);
      if (pool === undefined) {
        return rejection('POOL_NOT_FOUND', `liquidity authority: pool ${poolId} is not recorded`);
      }
      if (pool.state === 'CLOSED') {
        return { ok: true as const, replayed: true, pool };
      }
      const when = this.nextTime();
      const transition = transitionPool(pool, 'CLOSED', when);
      if (!transition.ok) {
        return rejection(
          'ILLEGAL_TRANSITION',
          `liquidity authority: pool transition ${pool.state} -> CLOSED is not an edge of the exact v0.1 chain`,
        );
      }
      const unsettled = this.positionsOf(poolId).filter(
        (position) => position.state !== 'CONSUMED' && position.state !== 'RETURNED',
      );
      if (unsettled.length > 0) {
        return rejection(
          'POOL_HAS_UNSETTLED_POSITIONS',
          `liquidity authority: pool ${poolId} cannot close while ${unsettled.length} position(s) ` +
            'are not terminal (closure is terminal after all positions settle — ' +
            'liquidity-credit-queues.md lines 33-35)',
        );
      }
      await submitLiquidityEvidence(this.evidence, poolClosedEvidence({ pool: transition.pool, when }));
      this.pools.set(poolId, deepFreeze(transition.pool));
      return { ok: true as const, replayed: false, pool: transition.pool };
    });
  }

  // -------------------------------------------------------------------------
  // Funding (INV-6-3 exactly-once; UNKNOWN -> pending linkage, GC-2)
  // -------------------------------------------------------------------------

  /**
   * Record CONFIRMED funding — the FundingEntry creation path for an
   * internal transfer of settled funds (area 12) or a confirmed external
   * funding rail operation (area 13). The entry id is derived from the
   * source reference, so the same rail operation id or internal transfer
   * id always names the same entry (INV-6-3 structural): a duplicate
   * submission is detected and reported with no effect. Creation declares
   * the position as an area-5 ledger resource (declared total = the
   * funded amount — core.md lines 304-306, 335-336) and writes
   * FUNDING_RECORDED + the position's POSITION_STATE_CHANGED (AVAILABLE).
   *
   * Source: liquidity-credit-queues.md lines 40-43, 58-60, 64-69, 71-75.
   */
  async recordConfirmedFunding(input: {
    readonly poolId: string;
    readonly source: FundingSource;
    readonly amount: Money;
  }): Promise<FundingCommandResult> {
    assertFundingSource(input.source);
    if (!isMoney(input.amount)) {
      throw new TypeError('liquidity authority: amount must be a kernel Money value (integer minor units, GC-1)');
    }
    const pool = this.pools.get(input.poolId);
    if (pool === undefined) {
      return rejection('POOL_NOT_FOUND', `liquidity authority: pool ${input.poolId} is not recorded`);
    }
    if (input.amount.amountMinor <= 0) {
      throw new TypeError('liquidity authority: funding amount must be positive');
    }
    const fundingEntryId = deriveProtocolId(
      'liquidity-funding-entry',
      input.source.kind,
      input.source.referenceId,
    );
    return this.serializer.run(`pool:${input.poolId}`, async (): Promise<FundingCommandResult> => {
      const existing = this.entries.get(fundingEntryId);
      if (existing !== undefined) {
        // INV-6-3: detected by id, recorded as duplicate, no effect.
        return { ok: true, created: false, duplicateOf: existing };
      }
      return this.createFundingEntry(pool, input.source, fundingEntryId, input.amount);
    });
  }

  /**
   * Open a pending funding linkage — the UNKNOWN external funding path.
   * The pool is UNCHANGED (no FundingEntry exists yet); the linkage
   * records the rail operation awaiting reconciliation and waits
   * ("the case waits for reconciliation (GC-2)"). The pending id is
   * derived from (pool id, rail operation id) — replays return the
   * recorded linkage. No evidence record: the pool is unchanged and A06's
   * named set is exhaustive (the FUNDING_RECORDED record belongs to the
   * confirmed creation, if it ever comes).
   *
   * Source: liquidity-credit-queues.md lines 64-67.
   */
  async openPendingFunding(input: {
    readonly poolId: string;
    readonly railOperationId: string;
    readonly expectedAmount: Money;
  }): Promise<{ ok: true; replayed: boolean; link: PendingFundingLinkRecord } | LiquidityRejection> {
    if (typeof input.railOperationId !== 'string' || input.railOperationId.length === 0) {
      throw new TypeError('liquidity authority: railOperationId must be a non-empty string');
    }
    if (!isMoney(input.expectedAmount)) {
      throw new TypeError('liquidity authority: expectedAmount must be a kernel Money value (GC-1)');
    }
    const pool = this.pools.get(input.poolId);
    if (pool === undefined) {
      return rejection('POOL_NOT_FOUND', `liquidity authority: pool ${input.poolId} is not recorded`);
    }
    if (input.expectedAmount.currency !== pool.currency) {
      return rejection(
        'CURRENCY_MISMATCH',
        `expected funding ${input.expectedAmount.currency} into the ${pool.currency} pool is forbidden (INV-6-2)`,
      );
    }
    if (input.expectedAmount.scale !== pool.scale) {
      return rejection(
        'UNIT_MISMATCH',
        `expected funding at scale ${input.expectedAmount.scale} into the scale-${pool.scale} pool is forbidden (GC-1)`,
      );
    }
    const pendingId = deriveProtocolId('liquidity-pending-funding', input.poolId, input.railOperationId);
    return this.serializer.run(`pool:${input.poolId}`, async () => {
      const existing = this.pendingLinks.get(pendingId);
      if (existing !== undefined) {
        return { ok: true as const, replayed: true, link: existing };
      }
      const alreadyFunded = deriveProtocolId(
        'liquidity-funding-entry',
        'EXTERNAL_RAIL',
        input.railOperationId,
      );
      if (this.entries.has(alreadyFunded)) {
        return rejection(
          'FUNDING_ENTRY_EXISTS',
          `liquidity authority: rail operation ${input.railOperationId} already has a confirmed ` +
            'FundingEntry (INV-6-3 — it cannot simultaneously await reconciliation)',
        );
      }
      const when = this.nextTime();
      const link: PendingFundingLinkRecord = deepFreeze({
        pendingId,
        poolId: input.poolId,
        railOperationId: input.railOperationId,
        expectedAmount: input.expectedAmount,
        status: 'PENDING',
        openedAt: when,
      });
      this.pendingLinks.set(pendingId, link);
      return { ok: true as const, replayed: false, link };
    });
  }

  /**
   * Resolve a pending funding linkage with the reconciliation terminal
   * resolution of the underlying UNKNOWN rail operation. RESOLVED_CONFIRMED
   * creates the FundingEntry exactly once (replays return the recorded
   * entry and linkage); RESOLVED_FAILED closes the linkage with NO entry
   * ("If reconciliation confirms failure, no entry is created"). The
   * confirmed amount is the linkage's expected amount (amount
   * discrepancies are area-14 RESOLVED_ADJUSTED cases, an area-9/10 flow
   * — recorded interpretation).
   *
   * Source: liquidity-credit-queues.md lines 66-69; rails-adapters-
   * reconciliation.md lines 171-179; GC-2.
   */
  async resolvePendingFunding(input: {
    readonly pendingId: string;
    readonly resolution: PendingFundingResolution;
  }): Promise<ResolvePendingFundingResult> {
    if (typeof input.pendingId !== 'string' || input.pendingId.length === 0) {
      throw new TypeError('liquidity authority: pendingId must be a non-empty string');
    }
    if (!isPendingFundingResolution(input.resolution)) {
      throw new TypeError(
        'liquidity authority: resolution must be RESOLVED_CONFIRMED or RESOLVED_FAILED (area 14 vocabulary)',
      );
    }
    const link = this.pendingLinks.get(input.pendingId);
    if (link === undefined) {
      return rejection('PENDING_NOT_FOUND', `liquidity authority: pending funding ${input.pendingId} is not recorded`);
    }
    return this.serializer.run(`pool:${link.poolId}`, async (): Promise<ResolvePendingFundingResult> => {
      const current = this.pendingLinks.get(input.pendingId);
      if (current === undefined) {
        return rejection('PENDING_NOT_FOUND', `liquidity authority: pending funding ${input.pendingId} is not recorded`);
      }
      if (current.status !== 'PENDING') {
        if (current.status === input.resolution) {
          // The identical resolution, already applied — the recorded state.
          if (
            current.status === 'RESOLVED_CONFIRMED' &&
            current.fundingEntryId !== undefined
          ) {
            const entry = this.entries.get(current.fundingEntryId);
            const position = entry === undefined ? undefined : this.positions.get(entry.positionId);
            if (entry !== undefined && position !== undefined) {
              return {
                ok: true as const,
                resolution: 'RESOLVED_CONFIRMED' as const,
                replayed: true,
                entry,
                position,
                link: current,
              };
            }
          }
          return { ok: true as const, resolution: 'RESOLVED_FAILED' as const, replayed: true, link: current };
        }
        return rejection(
          'PENDING_ALREADY_RESOLVED',
          `liquidity authority: pending funding ${input.pendingId} already resolved as ${current.status}`,
        );
      }
      const when = this.nextTime();
      if (input.resolution === 'RESOLVED_FAILED') {
        const resolved: PendingFundingLinkRecord = deepFreeze({
          ...current,
          status: 'RESOLVED_FAILED',
          resolvedAt: when,
        });
        this.pendingLinks.set(current.pendingId, resolved);
        return { ok: true as const, resolution: 'RESOLVED_FAILED' as const, replayed: false, link: resolved };
      }
      // RESOLVED_CONFIRMED — create the FundingEntry exactly once, with
      // the derived (structural) entry id for this rail operation.
      const pool = this.pools.get(current.poolId);
      if (pool === undefined) {
        return rejection('POOL_NOT_FOUND', `liquidity authority: pool ${current.poolId} vanished (internal consistency)`);
      }
      const source: FundingSource = { kind: 'EXTERNAL_RAIL', referenceId: current.railOperationId };
      const fundingEntryId = deriveProtocolId('liquidity-funding-entry', source.kind, source.referenceId);
      const created = await this.createFundingEntry(pool, source, fundingEntryId, current.expectedAmount);
      if (!created.ok) {
        return created;
      }
      let entry: FundingEntryRecord;
      let position: LiquidityPositionRecord;
      let replayed: boolean;
      if (created.created) {
        entry = created.entry;
        position = created.position;
        replayed = false;
      } else {
        // The entry was already created through the direct confirmed path
        // for the same rail operation — the recorded artifacts (INV-6-3).
        entry = created.duplicateOf;
        const recorded = this.positions.get(entry.positionId);
        if (recorded === undefined) {
          return rejection(
            'POSITION_NOT_FOUND',
            `liquidity authority: the recorded funding's position ${entry.positionId} vanished (internal consistency)`,
          );
        }
        position = recorded;
        replayed = true;
      }
      const resolvedLink: PendingFundingLinkRecord = deepFreeze({
        ...current,
        status: 'RESOLVED_CONFIRMED',
        resolvedAt: when,
        fundingEntryId,
      });
      this.pendingLinks.set(current.pendingId, resolvedLink);
      return {
        ok: true as const,
        resolution: 'RESOLVED_CONFIRMED' as const,
        replayed,
        entry,
        position,
        link: resolvedLink,
      };
    });
  }

  /**
   * The shared FundingEntry creation (the single exactly-once path for
   * both the direct confirmed path and the pending-resolution path).
   * Writes FUNDING_RECORDED and the funded position's
   * POSITION_STATE_CHANGED (AVAILABLE) BEFORE committing (A15 lines
   * 62-64), declares the position as an area-5 ledger resource (declared
   * total = the funded amount), and asserts INV-6-1 after the commit.
   *
   * Source: liquidity-credit-queues.md lines 40-43, 58-60, 66-69, 71-75;
   * core.md lines 304-306, 335-336.
   */
  private async createFundingEntry(
    pool: LiquidityPoolRecord,
    source: FundingSource,
    fundingEntryId: string,
    amount: Money,
  ): Promise<FundingCommandResult> {
    if (pool.state !== 'OPEN') {
      return rejection(
        'POOL_NOT_OPEN',
        `liquidity authority: pool ${pool.poolId} is ${pool.state} (funding creates positions; ` +
          'a wind-down pool accepts none)',
      );
    }
    if (amount.currency !== pool.currency) {
      return rejection(
        'CURRENCY_MISMATCH',
        `funding ${amount.currency} into the ${pool.currency} pool is forbidden (INV-6-2 single-currency)`,
      );
    }
    if (amount.scale !== pool.scale) {
      return rejection(
        'UNIT_MISMATCH',
        `funding at scale ${amount.scale} into the scale-${pool.scale} pool is forbidden (GC-1)`,
      );
    }
    const existing = this.entries.get(fundingEntryId);
    if (existing !== undefined) {
      return { ok: true, created: false, duplicateOf: existing };
    }
    const positionId = deriveProtocolId('liquidity-position', fundingEntryId);
    const declaration = await this.ledger.declareResource(positionId, amount);
    if (!declaration.ok) {
      return rejection(
        'ILLEGAL_TRANSITION',
        `liquidity authority: the ledger rejected the position declaration: ${declaration.problem}`,
      );
    }
    const when = this.nextTime();
    const entryRecord: FundingEntryRecord = {
      fundingEntryId,
      poolId: pool.poolId,
      positionId,
      amount,
      source,
      recordedAt: when,
    };
    const fold: PositionFold = {
      state: 'AVAILABLE',
      total: amount,
      available: amount,
      reserved: money(amount.currency, 0, amount.scale),
      consumed: money(amount.currency, 0, amount.scale),
    };
    const position: LiquidityPositionRecord = {
      positionId,
      poolId: pool.poolId,
      fundingEntryId,
      state: 'AVAILABLE',
      total: amount,
      available: fold.available,
      reserved: fold.reserved,
      consumed: fold.consumed,
      fundingSource: source,
      createdAt: when,
      stateChangedAt: when,
    };
    await submitLiquidityEvidence(
      this.evidence,
      fundingRecordedEvidence({ entry: entryRecord, fundedFold: fold, when }),
    );
    await submitLiquidityEvidence(
      this.evidence,
      positionStateChangedEvidence({ position, fold, when, reasonCode: 'POSITION_FUNDED' }),
    );
    const totals = (this.positionsByPool.get(pool.poolId) ?? []).map((id) => {
      const existingPosition = this.positions.get(id);
      if (existingPosition === undefined) {
        throw new TypeError(`liquidity authority: position ${id} vanished (internal consistency)`);
      }
      return existingPosition.total;
    });
    totals.push(amount);
    const totalMinor = sumPositionTotals(pool.currency, pool.scale, totals);
    const updatedPool: LiquidityPoolRecord = { ...pool, totalMinor };
    // The synchronous commit block (atomic wrt the event loop).
    this.entries.set(fundingEntryId, deepFreeze(entryRecord));
    this.positions.set(positionId, deepFreeze(position));
    const residents = this.positionsByPool.get(pool.poolId) ?? [];
    residents.push(positionId);
    this.positionsByPool.set(pool.poolId, residents);
    this.pools.set(pool.poolId, deepFreeze(updatedPool));
    this.assertPoolInvariant(pool.poolId);
    return { ok: true, created: true, entry: entryRecord, position };
  }

  // -------------------------------------------------------------------------
  // Position machine (ledger-mediated: INV-6-2)
  // -------------------------------------------------------------------------

  /**
   * Request a hold against a position — the liquidity-mediated area-5
   * reservation request. Gates (before the ledger is touched): the pool
   * must be OPEN and unfrozen ("Frozen pools accept no new
   * reservations"); the position must not be terminal; the amount must
   * match the pool's single currency and scale. The ledger performs the
   * atomic INV-5-1 check-and-hold (INSUFFICIENT_AVAILABLE on over-commit);
   * on HELD, the position folds to RESERVED and its
   * POSITION_STATE_CHANGED record is written before the commit. Duplicate
   * requests (same intent/hop/position) return the ledger's RECORDED
   * state (INV-5-3) — a recorded HELD replays, a recorded rejection
   * replays the typed INSUFFICIENT_AVAILABLE rejection.
   *
   * Source: liquidity-credit-queues.md lines 33-39; INV-6-2 lines 55-57;
   * core.md lines 286-312 (the reservation machine and INV-5-1/5-2/5-3).
   */
  async requestPositionHold(input: {
    readonly positionId: string;
    readonly intentId: string;
    readonly hopId: string;
    readonly amount: Money;
    readonly deadlineEpochMs: number;
  }): Promise<{ ok: true; replayed: boolean; record: PositionHoldRecord } | LiquidityRejection> {
    if (typeof input.intentId !== 'string' || input.intentId.length === 0) {
      throw new TypeError('liquidity authority: intentId must be a non-empty string');
    }
    if (typeof input.hopId !== 'string' || input.hopId.length === 0) {
      throw new TypeError('liquidity authority: hopId must be a non-empty string');
    }
    if (!isMoney(input.amount)) {
      throw new TypeError('liquidity authority: amount must be a kernel Money value (GC-1)');
    }
    if (input.amount.amountMinor <= 0) {
      throw new TypeError('liquidity authority: a hold amount must be positive');
    }
    const position = this.positions.get(input.positionId);
    if (position === undefined) {
      return rejection('POSITION_NOT_FOUND', `liquidity authority: position ${input.positionId} is not recorded`);
    }
    const pool = this.pools.get(position.poolId);
    if (pool === undefined) {
      throw new TypeError("liquidity authority: the position's pool vanished (internal consistency)");
    }
    if (pool.state === 'FROZEN') {
      return rejection(
        'POOL_FROZEN_NO_NEW_RESERVATIONS',
        `liquidity authority: pool ${pool.poolId} is FROZEN (frozen pools accept no new reservations — ` +
          'liquidity-credit-queues.md lines 33-35)',
      );
    }
    if (pool.state === 'CLOSED') {
      return rejection('POOL_NOT_OPEN', `liquidity authority: pool ${pool.poolId} is CLOSED`);
    }
    if (input.amount.currency !== pool.currency) {
      return rejection(
        'CURRENCY_MISMATCH',
        `holding ${input.amount.currency} against the ${pool.currency} pool is forbidden (INV-6-2)`,
      );
    }
    if (input.amount.scale !== pool.scale) {
      return rejection(
        'UNIT_MISMATCH',
        `holding at scale ${input.amount.scale} against the scale-${pool.scale} pool is forbidden (GC-1)`,
      );
    }
    if (position.state === 'CONSUMED' || position.state === 'RETURNED') {
      return rejection(
        'POSITION_TERMINAL',
        `liquidity authority: position ${input.positionId} is terminal (${position.state}); new ` +
          'funding opens a new position (the exact one-way chain — CONTRACT-REVIEW interpretation)',
      );
    }
    return this.serializer.run(`position:${input.positionId}`, async () => {
      const request = await this.ledger.requestReservation({
        intentId: input.intentId,
        hopId: input.hopId,
        resourceId: input.positionId,
        amount: input.amount,
        deadlineEpochMs: input.deadlineEpochMs,
      });
      return this.absorbHoldRequest(input.positionId, request);
    });
  }

  /**
   * Absorb one ledger hold request result into the position projection:
   * HELD folds the position (AVAILABLE -> RESERVED writes
   * POSITION_STATE_CHANGED; already-RESERVED writes none — the ledger's
   * own RESERVATION_HELD record carries the arithmetic); the ledger's
   * recorded rejection resolves to the typed INSUFFICIENT_AVAILABLE
   * result (deterministic on replay — INV-5-3).
   *
   * Source: liquidity-credit-queues.md lines 38-39, 73-74; core.md lines
   * 307-312.
   */
  private async absorbHoldRequest(
    positionId: string,
    request: ReservationRequestResult,
  ): Promise<{ ok: true; replayed: boolean; record: PositionHoldRecord } | LiquidityRejection> {
    if (!request.ok) {
      return mapLedgerRejection(request.code, request.problem);
    }
    const reservation = request.reservation;
    if (!request.held) {
      // The ledger's recorded rejection (INV-5-2 — never ambiguous). The
      // position fold is unchanged.
      return rejection(
        'INSUFFICIENT_AVAILABLE',
        `liquidity authority: the position's available balance cannot cover the hold ` +
          `(${reservation.reasonCode ?? 'INSUFFICIENT_AVAILABLE'}; INV-6-1/INV-5-1)`,
      );
    }
    const updated = await this.refoldPosition(positionId, {
      reasonCode: 'HOLD_PLACED',
      reservationId: reservation.reservationId,
    });
    return {
      ok: true as const,
      replayed: request.replayed,
      record: { position: updated, reservationId: reservation.reservationId },
    };
  }

  /**
   * Consume a hold — the ledger's exactly-once CONSUMED terminal, applied
   * to the position projection: consumed += amount, reserved -= amount;
   * the position folds toward CONSUMED (exhausted) or RETURNED (residual
   * returned) when the live holds drain to zero.
   *
   * Source: liquidity-credit-queues.md lines 38-39; core.md lines
   * 288-289, 310-312.
   */
  async consumeHold(
    reservationId: string,
  ): Promise<{ ok: true; replayed: boolean; record: LiquidityPositionRecord } | LiquidityRejection> {
    return this.terminalHold(reservationId, 'HOLD_CONSUMED', (id) => this.ledger.consumeReservation(id));
  }

  /**
   * Release a hold — the ledger's exactly-once RELEASED terminal, applied
   * to the position projection: the held amount returns to available; the
   * position folds toward RETURNED when the live holds drain to zero.
   *
   * Source: liquidity-credit-queues.md lines 38-39; core.md lines
   * 288-289, 310-312.
   */
  async releaseHold(
    reservationId: string,
  ): Promise<{ ok: true; replayed: boolean; record: LiquidityPositionRecord } | LiquidityRejection> {
    return this.terminalHold(reservationId, 'HOLD_RELEASED', (id) => this.ledger.releaseReservation(id));
  }

  private async terminalHold(
    reservationId: string,
    reasonCode: 'HOLD_CONSUMED' | 'HOLD_RELEASED',
    command: (reservationId: string) => Promise<ReservationTerminalCommandResult>,
  ): Promise<{ ok: true; replayed: boolean; record: LiquidityPositionRecord } | LiquidityRejection> {
    if (typeof reservationId !== 'string' || reservationId.length === 0) {
      throw new TypeError('liquidity authority: reservationId must be a non-empty string');
    }
    const reservation = this.ledger.reservation(reservationId);
    if (reservation === undefined) {
      return rejection(
        'POSITION_NOT_FOUND',
        `liquidity authority: reservation ${reservationId} is not recorded on the ledger`,
      );
    }
    const positionId = reservation.resourceId;
    if (!this.positions.has(positionId)) {
      return rejection(
        'POSITION_NOT_FOUND',
        `liquidity authority: reservation ${reservationId} does not belong to a liquidity position`,
      );
    }
    return this.serializer.run(`position:${positionId}`, async () => {
      const result = await command(reservationId);
      if (!result.ok) {
        return mapLedgerRejection(result.code, result.problem);
      }
      const updated = await this.refoldPosition(positionId, { reasonCode, reservationId });
      return { ok: true as const, replayed: result.replayed, record: updated };
    });
  }

  /**
   * Expire every due hold on every position — the ledger's deterministic
   * deadline rule, applied to the position projections. Each affected
   * position is re-folded once, in ascending position-id order (a
   * deterministic total order), inside the per-position serializer;
   * positions whose machine state changed write POSITION_STATE_CHANGED
   * with HOLD_EXPIRED.
   *
   * Source: liquidity-credit-queues.md lines 38-39; core.md lines 290-291
   * ("expiry is deterministic on protocol time").
   */
  async expireDueHolds(at?: ProtocolTime): Promise<readonly LiquidityPositionRecord[]> {
    const expired = await this.ledger.expireDueReservations(at);
    const affectedPositionIds = [...new Set(expired.map((reservation) => reservation.resourceId))].sort();
    const updated: LiquidityPositionRecord[] = [];
    for (const positionId of affectedPositionIds) {
      const position = await this.serializer.run(`position:${positionId}`, async () =>
        this.refoldPosition(positionId, { reasonCode: 'HOLD_EXPIRED' }),
      );
      updated.push(position);
    }
    return Object.freeze(updated);
  }

  /**
   * Re-fold one position from the ledger's per-resource entry log and
   * commit the projection — the single position mutation path (INV-6-2:
   * "position transitions occur only via the area 5 serialized ledger").
   * Runs inside the per-position keyed serializer. A machine state change
   * writes POSITION_STATE_CHANGED (with the post-transition INV-6-1
   * arithmetic proof) BEFORE the commit.
   *
   * Source: INV-6-2 lines 55-57; lines 73-74; A15 lines 62-64.
   */
  private async refoldPosition(
    positionId: string,
    driving: {
      readonly reasonCode: 'HOLD_PLACED' | 'HOLD_CONSUMED' | 'HOLD_RELEASED' | 'HOLD_EXPIRED';
      readonly reservationId?: string;
    },
  ): Promise<LiquidityPositionRecord> {
    const current = this.positions.get(positionId);
    if (current === undefined) {
      throw new TypeError(`liquidity authority: position ${positionId} vanished (internal consistency)`);
    }
    const entries = this.ledger.entriesFor(positionId);
    const projection: PositionLedgerProjection = foldPositionFromEntries(entries);
    const fold = projection.fold;
    if (!positionInvariantHolds(fold)) {
      throw new TypeError(
        `liquidity authority: INV-6-1 violated on position ${positionId} (liquidity-credit-queues.md lines 52-54)`,
      );
    }
    const when = this.nextTime();
    const updated: LiquidityPositionRecord = {
      ...current,
      state: fold.state,
      available: fold.available,
      reserved: fold.reserved,
      consumed: fold.consumed,
      stateChangedAt: fold.state === current.state ? current.stateChangedAt : when,
    };
    if (fold.state !== current.state) {
      await submitLiquidityEvidence(
        this.evidence,
        positionStateChangedEvidence({
          position: updated,
          fold,
          when,
          reasonCode: driving.reasonCode,
          ...(driving.reservationId === undefined
            ? {}
            : {
                reservationId: driving.reservationId,
                resourceSequence: projection.lastResourceSequence,
              }),
        }),
      );
    }
    this.positions.set(positionId, deepFreeze(updated));
    this.assertPoolInvariant(current.poolId);
    return updated;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** The pool record, or undefined. Source: lines 31-34 (the owned state). */
  pool(poolId: string): LiquidityPoolRecord | undefined {
    return this.pools.get(poolId);
  }

  /** The position record, or undefined. Source: lines 36-39. */
  position(positionId: string): LiquidityPositionRecord | undefined {
    return this.positions.get(positionId);
  }

  /** The FundingEntry, or undefined. Source: lines 40-43, 58-60. */
  fundingEntry(fundingEntryId: string): FundingEntryRecord | undefined {
    return this.entries.get(fundingEntryId);
  }

  /** The pending funding linkage, or undefined. Source: lines 64-69. */
  pendingFundingLink(pendingId: string): PendingFundingLinkRecord | undefined {
    return this.pendingLinks.get(pendingId);
  }

  /** The pool's positions, in funding order. Source: INV-6-1 lines 52-54. */
  positionsOf(poolId: string): readonly LiquidityPositionRecord[] {
    const ids = this.positionsByPool.get(poolId) ?? [];
    return Object.freeze(
      ids.map((id) => {
        const position = this.positions.get(id);
        if (position === undefined) {
          throw new TypeError(`liquidity authority: position ${id} vanished (internal consistency)`);
        }
        return position;
      }),
    );
  }

  /**
   * The pool's INV-6-1 identity, recomputed live: the stored total equals
   * the integer sum of position totals, single currency throughout.
   *
   * Source: INV-6-1 (liquidity-credit-queues.md lines 52-54).
   */
  poolInvariant(poolId: string): boolean {
    const pool = this.pools.get(poolId);
    if (pool === undefined) {
      return false;
    }
    return poolInvariantHolds({
      poolCurrency: pool.currency,
      poolScale: pool.scale,
      storedTotalMinor: pool.totalMinor,
      positionTotals: this.positionsOf(poolId).map((position) => position.total),
    });
  }

  /** Assert INV-6-1 (both sides) — defense in depth after every commit. */
  private assertPoolInvariant(poolId: string): void {
    const pool = this.pools.get(poolId);
    if (pool === undefined) {
      throw new TypeError(`liquidity authority: pool ${poolId} vanished (internal consistency)`);
    }
    if (!this.poolInvariant(poolId)) {
      throw new TypeError(
        `liquidity authority: INV-6-1 violated on pool ${poolId} (the stored total is not the ` +
          'integer sum of positions — liquidity-credit-queues.md lines 52-54)',
      );
    }
    for (const position of this.positionsOf(poolId)) {
      if (
        !positionInvariantHolds({
          state: position.state,
          total: position.total,
          available: position.available,
          reserved: position.reserved,
          consumed: position.consumed,
        })
      ) {
        throw new TypeError(
          `liquidity authority: INV-6-1 violated on position ${position.positionId} ` +
            '(liquidity-credit-queues.md lines 52-54)',
        );
      }
    }
  }
}

/** Map an area-5 ledger rejection into the liquidity vocabulary (typed). */
function mapLedgerRejection(
  code: 'RESERVATION_NOT_FOUND' | 'RESOURCE_NOT_DECLARED' | 'RESOURCE_ALREADY_DECLARED' | 'ILLEGAL_TRANSITION' | 'UNIT_MISMATCH',
  problem: string,
): LiquidityRejection {
  switch (code) {
    case 'RESERVATION_NOT_FOUND':
    case 'RESOURCE_NOT_DECLARED':
      return { ok: false, code: 'POSITION_NOT_FOUND', problem };
    case 'UNIT_MISMATCH':
      return { ok: false, code: 'UNIT_MISMATCH', problem };
    default:
      return { ok: false, code: 'ILLEGAL_TRANSITION', problem };
  }
}

function rejection(code: LiquidityRejectionCode, problem: string): LiquidityRejection {
  return { ok: false, code, problem };
}

function assertFundingSource(source: FundingSource): void {
  if (source === null || typeof source !== 'object') {
    throw new TypeError('liquidity authority: source must be a FundingSource');
  }
  if (!isFundingSourceKind(source.kind)) {
    throw new TypeError(
      'liquidity authority: source.kind must be INTERNAL_TRANSFER or EXTERNAL_RAIL (area 12/13 references)',
    );
  }
  if (typeof source.referenceId !== 'string' || source.referenceId.length === 0) {
    throw new TypeError('liquidity authority: source.referenceId must be a non-empty string');
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}
