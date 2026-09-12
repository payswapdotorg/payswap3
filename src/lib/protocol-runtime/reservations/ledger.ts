/**
 * RTN-006 — Reservation Authority: the ReservationLedger — THE
 * concurrency frontier (INV-5-1 / INV-5-2 / INV-5-3 + crash recovery).
 *
 * Spec sources (binding) — spec/architecture/v0.1/core.md §5 Area 5:
 *   lines 293-295 (the ledger, verbatim):
 *     "ReservationLedger — per-resource serialized log of reservation
 *      transitions. The ledger is the concurrency frontier: all resource
 *      mutations pass through it in sequence order."
 *   lines 286-291 (Reservation — the object, the state machine, and the
 *     deterministic deadline rule).
 *   lines 304-312 (the three invariants this ledger enforces):
 *     "INV-5-1 (financial correctness): for every resource, available =
 *      declared total minus held minus consumed, computed in integer
 *      Money; the identity holds after every transition.
 *      INV-5-2 (concurrency): transitions for the same resource are
 *      totally ordered by the ledger sequence; a REQUESTED transition
 *      either becomes HELD or is rejected — never left ambiguous.
 *      INV-5-3 (idempotency): reservation ids are derived from
 *      (intent id, hop id, resource id); duplicate requests return the
 *      recorded state; CONSUMED and RELEASED are exactly-once terminals."
 *   lines 316-322 (failure and UNKNOWN semantics, verbatim):
 *     "Reservation operations are internal and deterministic. Crash
 *      recovery replays the ledger tail: REQUESTED without a subsequent
 *      transition is rolled forward to HELD or rolled back to RELEASED
 *      based on the recorded decision, never duplicated. When a downstream
 *      rail operation is UNKNOWN, associated reservations remain HELD until
 *      reconciliation resolves the operation; they are then consumed or
 *      released exactly once (GC-2)."
 *   lines 326-328 (evidence produced — RESERVATION_* with ledger sequence
 *     number and post-transition arithmetic identity proofs).
 *   lines 330-336 (boundaries: "Reservations are not obligations"; "The
 *     reservation ledger does not initiate external effects"; "Depends on
 *     areas 6, 7, and 3 as resource owners").
 *   spec/architecture/v0.1/README.md §3 GC-1/GC-2/GC-4/GC-5.
 *
 * Command discipline (the merged convention, adapted to this area):
 *   - EVERY resource mutation runs inside the per-resource keyed
 *     serializer and appends to the per-resource serialized log — INV-5-2's
 *     total order is structural ("all resource mutations pass through it
 *     in sequence order").
 *   - The REQUESTED entry is the PRE-COMMIT durable fact: it records the
 *     requested hold AND the deterministic decision (HOLD or REJECT)
 *     computed against the resource's post-prior-transition accounting.
 *     The resolution (HELD or RELEASED) follows inside the same command,
 *     AFTER its GC-5 evidence record is written (submit-then-commit, A15
 *     lines 62-64). A crash — or an evidence-write failure — between the
 *     two leaves the REQUESTED dangling in the tail, exactly the state the
 *     crash-recovery rule contemplates.
 *   - Every command (and every recovery run) first RESOLVES the resource's
 *     dangling tail per the recorded decision ("rolled forward to HELD or
 *     rolled back to RELEASED based on the recorded decision, never
 *     duplicated") — REQUESTED is never left ambiguous past a command
 *     boundary (INV-5-2).
 *   - The INV-5-1 arithmetic identity is recomputed and asserted after
 *     EVERY applied transition (defense in depth over the pure
 *     resource.ts rules; the property tests run randomized sequences).
 *   - Terminal discipline: CONSUMED / RELEASED / EXPIRED are exactly-once
 *     — a repeat terminal command returns the RECORDED state (idempotent
 *     observation, no second arithmetic effect); a terminal-command
 *     mismatch (consuming a released hold) is the typed ILLEGAL_TRANSITION
 *     rejection.
 *   - Domain rejections are typed values, never thrown; input-shape
 *     violations throw TypeError (kernel convention). Rejections emit NO
 *     evidence; the REQUESTED and RESOURCE_DECLARED log entries emit no
 *     evidence records (A05's named set is exhaustive — see evidence.ts).
 *   - UNKNOWN downstream: nothing in this ledger resolves holds on its
 *     own — holds stay HELD until the owning flow (the plan, area 4)
 *     consumes or releases them after reconciliation resolves the UNKNOWN
 *     rail operation (core.md lines 319-322). The ledger initiates no
 *     external effects.
 *
 * Crash recovery model (recorded in CONTRACT-REVIEW.md): the ledger's LOG
 * (the per-resource serialized entries) is the durable artifact; the
 * in-memory maps are rebuilt by REPLAYING it (the constructor's
 * initialEntries adoption). A crash point is any prefix of the log: the
 * constructor adopts the prefix, and recover() resolves every dangling
 * REQUESTED tail per its recorded decision, appending the resolution
 * entries and writing their evidence records. "Never duplicated" holds
 * three ways: the replay creates each reservation exactly once (a second
 * REQUESTED for one id is a corrupt-log error); each dangling REQUESTED is
 * resolved exactly once (the resolution deletes the dangle); and a second
 * recovery run finds nothing to do.
 */

import { deriveProtocolId } from '../kernel/identity.ts';
import { isMoney } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';
import type { EvidenceSubmission } from '../kernel/ports.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import {
  applyHold,
  applyTransitionArithmetic,
  availableResource,
  coversAmount,
  initialResourceAccounting,
  resourceInvariantHolds,
} from './resource.ts';
import type { ResourceAccounting } from './resource.ts';
import {
  reservationConsumedEvidence,
  reservationExpiredEvidence,
  reservationHeldEvidence,
  reservationReleasedEvidence,
  submitReservationEvidence,
} from './evidence.ts';
import { KeyedSerializer } from './serializer.ts';
import { isExpiredAt, transitionReservation } from './state-machine.ts';
import type {
  LedgerRecoveryReport,
  ReservationEntryKind,
  ReservationLedgerEntry,
  ReservationReasonCode,
  ReservationRecord,
  ReservationRequestResult,
  ReservationState,
  ReservationTerminalCommandResult,
  ResourceDeclarationResult,
} from './types.ts';
import { canTransitionReservation, isReservationEntryKind } from './types.ts';

/**
 * Constructor dependencies for the ReservationLedger.
 *
 * Source: the wave evidence discipline (evidence through the kernel port —
 * here the REAL RTN-002 log); the wallClock-injection convention for
 * deterministic tests; the crash-recovery adoption input (a surviving log
 * prefix).
 */
export interface ReservationLedgerDeps {
  /** The EvidenceSubmission port — the real RTN-002 EvidenceLog. */
  readonly evidence: EvidenceSubmission;
  /** Injectable wall clock (epoch ms) for deterministic tests; default Date.now. */
  readonly wallClock?: () => number;
  /**
   * A prior log to adopt (crash recovery: the durable entries that
   * survived). The constructor REPLAYS the prefix (rebuilding resources,
   * reservations, and sequence counters) and leaves dangling REQUESTED
   * tails for recover() — the exported factory openReservationLedger()
   * awaits the recovery before returning the ledger.
   */
  readonly initialEntries?: readonly ReservationLedgerEntry[];
}

/** One dangling REQUESTED tail (the crash-recovery input). */
interface DanglingRequest {
  readonly resourceId: string;
  readonly reservationId: string;
  readonly decision: 'HOLD' | 'REJECT';
}

/** One recovery resolution action (the report's row). */
export interface RecoveryAction {
  readonly reservationId: string;
  readonly resourceId: string;
  readonly action: 'ROLLFORWARD_HELD' | 'ROLLBACK_RELEASED';
  readonly reasonCode: ReservationReasonCode;
}

/**
 * The ReservationLedger — per-resource serialized log of reservation
 * transitions; the concurrency frontier through which ALL resource
 * mutations pass in sequence order. Commands: declareResource (the
 * resource owner's INV-5-1 declared total), requestReservation (REQUESTED
 * with the recorded decision, resolved to HELD or RELEASED),
 * consumeReservation / releaseReservation (the exactly-once terminals),
 * expireDueReservations (the deterministic deadline rule), recover (the
 * ledger-tail crash recovery).
 *
 * Source: core.md lines 293-295 (the ledger), lines 286-312 (the machine
 * and invariants), lines 316-322 (crash recovery and UNKNOWN semantics).
 */
export class ReservationLedger {
  private readonly evidence: EvidenceSubmission;
  private readonly wallClock: () => number;
  private readonly serializer = new KeyedSerializer();
  private readonly resources = new Map<string, ResourceAccounting>();
  private readonly reservationsById = new Map<string, ReservationRecord>();
  private readonly log: ReservationLedgerEntry[] = [];
  private readonly resourceSequences = new Map<string, number>();
  private readonly dangling = new Map<string, DanglingRequest>();
  private globalSequence = 0;
  private protocolSequence = 0;

  constructor(deps: ReservationLedgerDeps) {
    if (
      deps.evidence === null ||
      typeof deps.evidence !== 'object' ||
      typeof deps.evidence.submit !== 'function'
    ) {
      throw new TypeError('reservation ledger: deps.evidence must be an EvidenceSubmission port');
    }
    this.evidence = deps.evidence;
    this.wallClock = deps.wallClock ?? (() => Date.now());
    if (deps.initialEntries !== undefined) {
      this.adoptEntries(deps.initialEntries);
    }
  }

  // -------------------------------------------------------------------------
  // Time, sequencing, and the append-only log
  // -------------------------------------------------------------------------

  private nextTime(): ProtocolTime {
    const when = protocolTime(this.protocolSequence, this.wallClock());
    this.protocolSequence += 1;
    return when;
  }

  private nextTimeAtWall(wallMs: number): ProtocolTime {
    const when = protocolTime(this.protocolSequence, wallMs);
    this.protocolSequence += 1;
    return when;
  }

  private appendEntry(input: {
    readonly resourceId: string;
    readonly reservationId?: string;
    readonly intentId?: string;
    readonly hopId?: string;
    readonly entryKind: ReservationEntryKind;
    readonly amount?: Money;
    readonly deadlineEpochMs?: number;
    readonly decision?: 'HOLD' | 'REJECT';
    readonly reasonCode?: ReservationReasonCode;
    readonly at: ProtocolTime;
  }): ReservationLedgerEntry {
    const resourceSequence = (this.resourceSequences.get(input.resourceId) ?? -1) + 1;
    const entry: ReservationLedgerEntry = deepFreeze({
      globalSequence: this.globalSequence,
      resourceSequence,
      resourceId: input.resourceId,
      ...(input.reservationId === undefined ? {} : { reservationId: input.reservationId }),
      ...(input.intentId === undefined ? {} : { intentId: input.intentId }),
      ...(input.hopId === undefined ? {} : { hopId: input.hopId }),
      entryKind: input.entryKind,
      ...(input.amount === undefined ? {} : { amount: input.amount }),
      ...(input.deadlineEpochMs === undefined ? {} : { deadlineEpochMs: input.deadlineEpochMs }),
      ...(input.decision === undefined ? {} : { decision: input.decision }),
      ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
      at: input.at,
    });
    this.log.push(entry);
    this.resourceSequences.set(input.resourceId, resourceSequence);
    this.globalSequence += 1;
    return entry;
  }

  // -------------------------------------------------------------------------
  // Resource declaration (INV-5-1's declared-total input)
  // -------------------------------------------------------------------------

  /**
   * Declare a resource with its declared total — the resource owner's
   * integration input (area 6, 7, or 3 per core.md lines 335-336). The
   * declaration appends a RESOURCE_DECLARED entry to the per-resource log
   * (all resource mutations pass through the ledger) and starts the
   * INV-5-1 identity at (declared, 0, 0). Declaring the SAME total again
   * is an idempotent replay; declaring a different total for an existing
   * resource is the typed RESOURCE_ALREADY_DECLARED rejection (the
   * declared total is the identity's fixed input — a changed total is a
   * new resource-owner decision, a later wave's composition).
   *
   * No evidence record: A05's named set is exhaustive and carries no
   * declaration type (see evidence.ts).
   *
   * Source: core.md lines 304-306 (INV-5-1's declared total), lines
   * 335-336 (the resource owners), lines 293-295 (the mutation passes
   * through the ledger).
   */
  async declareResource(resourceId: string, declaredTotal: Money): Promise<ResourceDeclarationResult> {
    if (typeof resourceId !== 'string' || resourceId.length === 0) {
      throw new TypeError('reservation ledger: resourceId must be a non-empty string');
    }
    if (!isMoney(declaredTotal)) {
      throw new TypeError('reservation ledger: declaredTotal must be a kernel Money value (integer minor units, GC-1)');
    }
    if (declaredTotal.amountMinor < 0) {
      throw new TypeError('reservation ledger: declaredTotal must be non-negative (INV-5-1, core.md lines 304-306)');
    }
    return this.serializer.run(`resource:${resourceId}`, async (): Promise<ResourceDeclarationResult> => {
      await this.resolveDanglingTailInline(resourceId);
      const existing = this.resources.get(resourceId);
      if (existing !== undefined) {
        if (
          existing.declaredTotal.currency === declaredTotal.currency &&
          existing.declaredTotal.scale === declaredTotal.scale &&
          existing.declaredTotal.amountMinor === declaredTotal.amountMinor
        ) {
          return { ok: true, replayed: true, resourceId };
        }
        return {
          ok: false,
          code: 'RESOURCE_ALREADY_DECLARED',
          problem:
            `reservation ledger: resource ${resourceId} is already declared with total ` +
            `${existing.declaredTotal.amountMinor} ${existing.declaredTotal.currency} ` +
            '(the declared total is INV-5-1\'s fixed input — core.md lines 304-306)',
        };
      }
      this.appendEntry({
        resourceId,
        entryKind: 'RESOURCE_DECLARED',
        amount: declaredTotal,
        at: this.nextTime(),
      });
      this.resources.set(resourceId, initialResourceAccounting(resourceId, declaredTotal));
      return { ok: true, replayed: false, resourceId };
    });
  }

  // -------------------------------------------------------------------------
  // Requests (REQUESTED -> HELD | RELEASED, INV-5-2/INV-5-3)
  // -------------------------------------------------------------------------

  /**
   * Request one reservation — the hold on a resource for one intent and
   * one hop. The reservation id is derived from (intent id, hop id,
   * resource id) (INV-5-3): a duplicate request returns the RECORDED state
   * (replayed), whatever that state is. A fresh request appends the
   * REQUESTED entry with its recorded decision — the resource's available
   * balance covers the amount (HOLD) or it does not (REJECT) — then
   * resolves it inside the same command: HELD (the hold begins; the
   * accounting's heldTotal grows), or RELEASED with reason
   * INSUFFICIENT_AVAILABLE (the rejected request never held anything;
   * INV-5-2 — never ambiguous). The resolution's RESERVATION_HELD /
   * RESERVATION_RELEASED evidence record is written BEFORE the resolution
   * commits (A15 lines 62-64); a failed write fails the command and leaves
   * the REQUESTED dangling for the self-heal / recover() resolution.
   *
   * Source: core.md lines 286-289 (the machine); INV-5-1 lines 304-306
   * (the decision's arithmetic); INV-5-2 lines 307-309; INV-5-3 lines
   * 310-312.
   */
  async requestReservation(input: {
    readonly intentId: string;
    readonly hopId: string;
    readonly resourceId: string;
    readonly amount: Money;
    readonly deadlineEpochMs: number;
  }): Promise<ReservationRequestResult> {
    if (typeof input.intentId !== 'string' || input.intentId.length === 0) {
      throw new TypeError('reservation ledger: intentId must be a non-empty string');
    }
    if (typeof input.hopId !== 'string' || input.hopId.length === 0) {
      throw new TypeError('reservation ledger: hopId must be a non-empty string');
    }
    if (typeof input.resourceId !== 'string' || input.resourceId.length === 0) {
      throw new TypeError('reservation ledger: resourceId must be a non-empty string');
    }
    if (!isMoney(input.amount)) {
      throw new TypeError('reservation ledger: amount must be a kernel Money value (integer minor units, GC-1)');
    }
    if (input.amount.amountMinor < 0) {
      throw new TypeError('reservation ledger: amount must be non-negative (a hold never adds availability)');
    }
    if (typeof input.deadlineEpochMs !== 'number' || !Number.isInteger(input.deadlineEpochMs)) {
      throw new TypeError('reservation ledger: deadlineEpochMs must be an integer (GC-1)');
    }
    const reservationId = deriveProtocolId(
      'reservation',
      input.intentId,
      input.hopId,
      input.resourceId,
    );
    return this.serializer.run(
      `resource:${input.resourceId}`,
      async (): Promise<ReservationRequestResult> => {
        await this.resolveDanglingTailInline(input.resourceId);
        const recorded = this.reservationsById.get(reservationId);
        if (recorded !== undefined) {
          // INV-5-3: duplicate requests return the recorded state.
          return { ok: true, replayed: true, held: recorded.state === 'HELD', reservation: recorded };
        }
        const accounting = this.resources.get(input.resourceId);
        if (accounting === undefined) {
          return {
            ok: false,
            code: 'RESOURCE_NOT_DECLARED',
            problem:
              `reservation ledger: resource ${input.resourceId} is not declared ` +
              '(the resource owner (area 6/7/3) declares the INV-5-1 total — core.md lines 335-336)',
          };
        }
        if (
          input.amount.currency !== accounting.declaredTotal.currency ||
          input.amount.scale !== accounting.declaredTotal.scale
        ) {
          return {
            ok: false,
            code: 'UNIT_MISMATCH',
            problem:
              `reservation ledger: amount is ${input.amount.amountMinor} ${input.amount.currency} ` +
              `(scale ${input.amount.scale}) but resource ${input.resourceId}'s unit is ` +
              `${accounting.declaredTotal.currency} (scale ${accounting.declaredTotal.scale}) — ` +
              'INV-5-1 requires comparable integer Money (core.md lines 304-306)',
          };
        }
        const decision: 'HOLD' | 'REJECT' = coversAmount(accounting, input.amount) ? 'HOLD' : 'REJECT';
        // (1) The pre-commit durable fact: REQUESTED with the recorded decision.
        const requestedAt = this.nextTime();
        this.appendEntry({
          resourceId: input.resourceId,
          reservationId,
          intentId: input.intentId,
          hopId: input.hopId,
          entryKind: 'REQUESTED',
          amount: input.amount,
          deadlineEpochMs: input.deadlineEpochMs,
          decision,
          at: requestedAt,
        });
        this.dangling.set(input.resourceId, {
          resourceId: input.resourceId,
          reservationId,
          decision,
        });
        const requested: ReservationRecord = deepFreeze({
          reservationId,
          intentId: input.intentId,
          hopId: input.hopId,
          resourceId: input.resourceId,
          amount: input.amount,
          state: 'REQUESTED',
          deadlineEpochMs: input.deadlineEpochMs,
          createdAt: requestedAt,
          stateChangedAt: requestedAt,
        });
        this.reservationsById.set(reservationId, requested);
        // (2) The resolution, evidenced before it commits (A15 lines 62-64).
        if (decision === 'HOLD') {
          const holdApplied = applyHold(accounting, input.amount);
          if (!holdApplied.ok) {
            throw new TypeError(
              `reservation ledger: internal consistency — HOLD decision unwritable (${holdApplied.problem})`,
            );
          }
          const resolvedAt = this.nextTime();
          const resourceSequence =
            (this.resourceSequences.get(input.resourceId) ?? -1) + 1;
          const held: ReservationRecord = deepFreeze({
            ...requested,
            state: 'HELD',
            stateChangedAt: resolvedAt,
          });
          await submitReservationEvidence(
            this.evidence,
            reservationHeldEvidence({
              reservation: held,
              when: resolvedAt,
              resourceSequence,
              accounting: holdApplied.accounting,
            }),
          );
          // (3) Commit: the HELD entry + the state maps.
          this.appendEntry({
            resourceId: input.resourceId,
            reservationId,
            entryKind: 'HELD',
            at: resolvedAt,
          });
          this.resources.set(input.resourceId, holdApplied.accounting);
          this.assertInvariant(input.resourceId);
          this.reservationsById.set(reservationId, held);
          this.dangling.delete(input.resourceId);
          return { ok: true, replayed: false, held: true, reservation: held };
        }
        const resolvedAt = this.nextTime();
        const resourceSequence = (this.resourceSequences.get(input.resourceId) ?? -1) + 1;
        const released: ReservationRecord = deepFreeze({
          ...requested,
          state: 'RELEASED',
          reasonCode: 'INSUFFICIENT_AVAILABLE',
          stateChangedAt: resolvedAt,
        });
        await submitReservationEvidence(
          this.evidence,
          reservationReleasedEvidence({
            reservation: released,
            when: resolvedAt,
            resourceSequence,
            accounting,
            reasonCode: 'INSUFFICIENT_AVAILABLE',
          }),
        );
        this.appendEntry({
          resourceId: input.resourceId,
          reservationId,
          entryKind: 'RELEASED',
          reasonCode: 'INSUFFICIENT_AVAILABLE',
          at: resolvedAt,
        });
        this.assertInvariant(input.resourceId);
        this.reservationsById.set(reservationId, released);
        this.dangling.delete(input.resourceId);
        return { ok: true, replayed: false, held: false, reservation: released };
      },
    );
  }

  // -------------------------------------------------------------------------
  // Terminals (HELD -> CONSUMED | RELEASED | EXPIRED, exactly-once)
  // -------------------------------------------------------------------------

  /**
   * Consume one reservation: HELD -> CONSUMED — the exactly-once terminal
   * ("CONSUMED and RELEASED are exactly-once terminals", INV-5-3). A
   * repeat consume of an already-CONSUMED reservation returns the recorded
   * state (replayed — idempotent observation, no second arithmetic
   * effect); consuming a non-HELD, non-CONSUMED reservation is the typed
   * ILLEGAL_TRANSITION rejection. The hold's value moves from heldTotal to
   * consumedTotal; the INV-5-1 identity is asserted after the transition.
   *
   * Source: core.md lines 288-289 (the machine); INV-5-1 lines 304-306;
   * INV-5-3 lines 310-312; lines 319-322 ("consumed or released exactly
   * once (GC-2)").
   */
  async consumeReservation(reservationId: string): Promise<ReservationTerminalCommandResult> {
    return this.terminalCommand(reservationId, 'CONSUMED');
  }

  /**
   * Release one reservation: HELD -> RELEASED — the exactly-once terminal.
   * A repeat release of an already-RELEASED reservation returns the
   * recorded state; releasing a CONSUMED or EXPIRED hold is the typed
   * ILLEGAL_TRANSITION rejection. The hold's value returns to available.
   *
   * Source: core.md lines 288-289; INV-5-1 lines 304-306 ("every hold is
   * either consumed or released — never silently lost", lines 280-282);
   * INV-5-3 lines 310-312.
   */
  async releaseReservation(reservationId: string): Promise<ReservationTerminalCommandResult> {
    return this.terminalCommand(reservationId, 'RELEASED');
  }

  private async terminalCommand(
    reservationId: string,
    target: 'CONSUMED' | 'RELEASED',
  ): Promise<ReservationTerminalCommandResult> {
    if (typeof reservationId !== 'string' || reservationId.length === 0) {
      throw new TypeError('reservation ledger: reservationId must be a non-empty string');
    }
    const peek = this.reservationsById.get(reservationId);
    if (peek === undefined) {
      return {
        ok: false,
        code: 'RESERVATION_NOT_FOUND',
        problem: `reservation ledger: reservation ${reservationId} is not recorded`,
      };
    }
    const resourceId = peek.resourceId;
    return this.serializer.run(
      `resource:${resourceId}`,
      async (): Promise<ReservationTerminalCommandResult> => {
        await this.resolveDanglingTailInline(resourceId);
        const current = this.reservationsById.get(reservationId);
        if (current === undefined) {
          return {
            ok: false,
            code: 'RESERVATION_NOT_FOUND',
            problem: `reservation ledger: reservation ${reservationId} is not recorded`,
          };
        }
        if (current.state === target) {
          // Exactly-once as idempotent observation: the recorded terminal.
          return { ok: true, replayed: true, reservation: current };
        }
        const transition = transitionReservation(current, target, this.nextTime());
        if (!transition.ok) {
          return transition;
        }
        const accounting = this.resources.get(resourceId);
        if (accounting === undefined) {
          throw new TypeError(
            `reservation ledger: resource ${resourceId} vanished (internal consistency)`,
          );
        }
        const nextAccounting = applyTransitionArithmetic(
          accounting,
          current.state,
          target,
          current.amount,
        );
        const resourceSequence = (this.resourceSequences.get(resourceId) ?? -1) + 1;
        if (target === 'CONSUMED') {
          await submitReservationEvidence(
            this.evidence,
            reservationConsumedEvidence({
              reservation: transition.reservation,
              when: transition.reservation.stateChangedAt,
              resourceSequence,
              accounting: nextAccounting,
            }),
          );
        } else {
          await submitReservationEvidence(
            this.evidence,
            reservationReleasedEvidence({
              reservation: transition.reservation,
              when: transition.reservation.stateChangedAt,
              resourceSequence,
              accounting: nextAccounting,
            }),
          );
        }
        this.appendEntry({
          resourceId,
          reservationId,
          entryKind: target,
          at: transition.reservation.stateChangedAt,
        });
        this.resources.set(resourceId, nextAccounting);
        this.assertInvariant(resourceId);
        this.reservationsById.set(reservationId, transition.reservation);
        return { ok: true, replayed: false, reservation: transition.reservation };
      },
    );
  }

  /**
   * Expire every HELD reservation whose deadline the given protocol time
   * has reached — the deterministic deadline rule ("Each reservation
   * carries a deadline; expiry is deterministic on protocol time"): a pure
   * function of (ledger state, protocol time). The expired set is
   * processed in ascending reservation-id order (a deterministic total
   * order); each expiry is the HELD -> EXPIRED terminal with its evidence
   * record and log entry, and the INV-5-1 identity asserted after the
   * transition. Returns the expired reservations.
   *
   * Source: core.md lines 290-291 (the deadline rule), lines 288-289 (the
   * EXPIRED terminal), lines 326-328 (RESERVATION_EXPIRED); GC-1.
   */
  async expireDueReservations(at?: ProtocolTime): Promise<readonly ReservationRecord[]> {
    const runAt = at ?? this.nextTime();
    const due = [...this.reservationsById.values()]
      .filter((reservation) => isExpiredAt(reservation, runAt))
      .sort((a, b) => (a.reservationId < b.reservationId ? -1 : a.reservationId > b.reservationId ? 1 : 0));
    const expired: ReservationRecord[] = [];
    for (const candidate of due) {
      const resourceId = candidate.resourceId;
      const result = await this.serializer.run(`resource:${resourceId}`, async ():
        Promise<ReservationRecord | undefined> => {
        await this.resolveDanglingTailInline(resourceId);
        const current = this.reservationsById.get(candidate.reservationId);
        if (current === undefined || !isExpiredAt(current, runAt)) {
          return undefined; // resolved or released under the lock; deterministic given runAt
        }
        const transition = transitionReservation(
          current,
          'EXPIRED',
          this.nextTimeAtWall(runAt.wallMs),
          { reasonCode: 'DEADLINE_EXPIRED' },
        );
        if (!transition.ok) {
          return undefined;
        }
        const accounting = this.resources.get(resourceId);
        if (accounting === undefined) {
          throw new TypeError(
            `reservation ledger: resource ${resourceId} vanished (internal consistency)`,
          );
        }
        const nextAccounting = applyTransitionArithmetic(
          accounting,
          current.state,
          'EXPIRED',
          current.amount,
        );
        const resourceSequence = (this.resourceSequences.get(resourceId) ?? -1) + 1;
        await submitReservationEvidence(
          this.evidence,
          reservationExpiredEvidence({
            reservation: transition.reservation,
            when: transition.reservation.stateChangedAt,
            resourceSequence,
            accounting: nextAccounting,
          }),
        );
        this.appendEntry({
          resourceId,
          reservationId: current.reservationId,
          entryKind: 'EXPIRED',
          reasonCode: 'DEADLINE_EXPIRED',
          at: transition.reservation.stateChangedAt,
        });
        this.resources.set(resourceId, nextAccounting);
        this.assertInvariant(resourceId);
        this.reservationsById.set(current.reservationId, transition.reservation);
        return transition.reservation;
      });
      if (result !== undefined) {
        expired.push(result);
      }
    }
    return expired;
  }

  // -------------------------------------------------------------------------
  // Ledger-tail crash recovery
  // -------------------------------------------------------------------------

  /**
   * Resolve every dangling REQUESTED tail — the ledger-tail crash
   * recovery: "REQUESTED without a subsequent transition is rolled forward
   * to HELD or rolled back to RELEASED based on the recorded decision,
   * never duplicated." Each resolution appends its entry and writes its
   * RESERVATION_HELD / RESERVATION_RELEASED evidence record (the recovery
   * is itself a consequential operation), with the recovery reason codes
   * recording the provenance. Idempotent: a second run finds nothing to
   * resolve.
   *
   * Source: core.md lines 316-318; A15 lines 26-32, 62-64; GC-5.
   */
  async recover(): Promise<LedgerRecoveryReport> {
    const resolved: RecoveryAction[] = [];
    const inspectedEntries = this.log.length;
    const resourceIds = [...this.dangling.keys()].sort();
    for (const resourceId of resourceIds) {
      const action = await this.serializer.run(`resource:${resourceId}`, () =>
        this.resolveDanglingTailInline(resourceId),
      );
      if (action !== undefined) {
        resolved.push(action);
      }
    }
    return { resolved, inspectedEntries };
  }

  /**
   * Resolve one resource's dangling REQUESTED tail — INLINE (the caller
   * already holds the per-resource serialization: either a command inside
   * its serializer run, or recover()'s own run). Asserts the dangle is the
   * resource's last log entry (the self-heal design guarantees it),
   * applies the recorded decision, writes the resolution's evidence, and
   * commits the resolution entry.
   *
   * Source: core.md lines 316-318.
   */
  private async resolveDanglingTailInline(resourceId: string): Promise<RecoveryAction | undefined> {
    const dangle = this.dangling.get(resourceId);
    if (dangle === undefined) {
      return undefined;
    }
    // The dangle must be the resource's last log entry.
    let lastForResource: ReservationLedgerEntry | undefined;
    for (let index = this.log.length - 1; index >= 0; index -= 1) {
      const entry = this.log[index] as ReservationLedgerEntry;
      if (entry.resourceId === resourceId) {
        lastForResource = entry;
        break;
      }
    }
    if (
      lastForResource === undefined ||
      lastForResource.entryKind !== 'REQUESTED' ||
      lastForResource.reservationId !== dangle.reservationId
    ) {
      throw new TypeError(
        `reservation ledger: corrupt tail for resource ${resourceId} — the dangling REQUESTED ` +
        'is not the resource\'s last entry (core.md A05 lines 316-318)',
      );
    }
    const requested = this.reservationsById.get(dangle.reservationId);
    if (requested === undefined || requested.state !== 'REQUESTED') {
      throw new TypeError(
        `reservation ledger: corrupt tail for resource ${resourceId} — the dangling REQUESTED ` +
        'has no REQUESTED reservation record',
      );
    }
    const at = this.nextTime();
    const resourceSequence = (this.resourceSequences.get(resourceId) ?? -1) + 1;
    if (dangle.decision === 'HOLD') {
      // Roll forward to HELD.
      const accounting = this.resources.get(resourceId);
      if (accounting === undefined) {
        throw new TypeError(
          `reservation ledger: corrupt tail — resource ${resourceId} undeclared under a dangling REQUESTED`,
        );
      }
      const holdApplied = applyHold(accounting, requested.amount);
      if (!holdApplied.ok) {
        throw new TypeError(
          `reservation ledger: corrupt tail — the recorded HOLD decision no longer applies ` +
          `(${holdApplied.problem}); core.md A05 lines 316-318`,
        );
      }
      const held: ReservationRecord = deepFreeze({
        ...requested,
        state: 'HELD',
        reasonCode: 'RECOVERY_ROLLFORWARD',
        stateChangedAt: at,
      });
      await submitReservationEvidence(
        this.evidence,
        reservationHeldEvidence({
          reservation: held,
          when: at,
          resourceSequence,
          accounting: holdApplied.accounting,
          reasonCode: 'RECOVERY_ROLLFORWARD',
        }),
      );
      this.appendEntry({ resourceId, reservationId: dangle.reservationId, entryKind: 'HELD', at });
      this.resources.set(resourceId, holdApplied.accounting);
      this.assertInvariant(resourceId);
      this.reservationsById.set(dangle.reservationId, held);
      this.dangling.delete(resourceId);
      return {
        reservationId: dangle.reservationId,
        resourceId,
        action: 'ROLLFORWARD_HELD',
        reasonCode: 'RECOVERY_ROLLFORWARD',
      };
    }
    // Roll back to RELEASED (the rejected request never held anything).
    const released: ReservationRecord = deepFreeze({
      ...requested,
      state: 'RELEASED',
      reasonCode: 'RECOVERY_ROLLBACK',
      stateChangedAt: at,
    });
    const accounting = this.resources.get(resourceId);
    if (accounting === undefined) {
      throw new TypeError(
        `reservation ledger: corrupt tail — resource ${resourceId} undeclared under a dangling REQUESTED`,
      );
    }
    await submitReservationEvidence(
      this.evidence,
      reservationReleasedEvidence({
        reservation: released,
        when: at,
        resourceSequence,
        accounting,
        reasonCode: 'RECOVERY_ROLLBACK',
      }),
    );
    this.appendEntry({
      resourceId,
      reservationId: dangle.reservationId,
      entryKind: 'RELEASED',
      reasonCode: 'RECOVERY_ROLLBACK',
      at,
    });
    this.assertInvariant(resourceId);
    this.reservationsById.set(dangle.reservationId, released);
    this.dangling.delete(resourceId);
    return {
      reservationId: dangle.reservationId,
      resourceId,
      action: 'ROLLBACK_RELEASED',
      reasonCode: 'RECOVERY_ROLLBACK',
    };
  }

  // -------------------------------------------------------------------------
  // Log adoption (the replay half of crash recovery)
  // -------------------------------------------------------------------------

  /**
   * Adopt a surviving log prefix: replay every entry in order, rebuilding
   * the resource accountings, the reservations, and the sequence counters,
   * with INV-5-1 asserted after every applied transition. Dangling
   * REQUESTED tails are left for recover() (the resolution half). A log
   * that violates the ledger's own invariants (a double declaration, a
   * duplicated REQUESTED, an illegal transition sequence, an INV-5-1
   * breach) is CORRUPT and fails adoption with a TypeError — never
   * silently repaired.
   *
   * Source: core.md lines 293-295 (the log), lines 304-312 (the
   * invariants the replay re-asserts), lines 316-318 (the dangling tails).
   */
  private adoptEntries(entries: readonly ReservationLedgerEntry[]): void {
    if (!Array.isArray(entries)) {
      throw new TypeError('reservation ledger: initialEntries must be an array of ledger entries');
    }
    const danglingByResource = new Map<string, DanglingRequest>();
    for (const entry of entries) {
      if (entry === null || typeof entry !== 'object' || !isReservationEntryKind(entry.entryKind)) {
        throw new TypeError('reservation ledger: initial entries must be well-formed ledger entries');
      }
      if (typeof entry.resourceId !== 'string' || entry.resourceId.length === 0) {
        throw new TypeError('reservation ledger: entry resourceId must be a non-empty string');
      }
      if (!Number.isInteger(entry.resourceSequence) || entry.resourceSequence < 0) {
        throw new TypeError('reservation ledger: entry resourceSequence must be a non-negative integer');
      }
      if (!Number.isInteger(entry.globalSequence) || entry.globalSequence < 0) {
        throw new TypeError('reservation ledger: entry globalSequence must be a non-negative integer');
      }
      if (entry.globalSequence !== this.globalSequence) {
        throw new TypeError(
          `reservation ledger: corrupt log — global sequence ${entry.globalSequence} where ` +
            `${this.globalSequence} was expected (the log is a total order)`,
        );
      }
      const expectedResourceSequence = (this.resourceSequences.get(entry.resourceId) ?? -1) + 1;
      if (entry.resourceSequence !== expectedResourceSequence) {
        throw new TypeError(
          `reservation ledger: corrupt log — resource ${entry.resourceId} sequence ` +
            `${entry.resourceSequence} where ${expectedResourceSequence} was expected ` +
            '(INV-5-2: transitions for the same resource are totally ordered by the ledger sequence)',
        );
      }
      switch (entry.entryKind) {
        case 'RESOURCE_DECLARED': {
          if (!isMoney(entry.amount)) {
            throw new TypeError('reservation ledger: RESOURCE_DECLARED requires the declared total');
          }
          if (this.resources.has(entry.resourceId)) {
            throw new TypeError(
              `reservation ledger: corrupt log — resource ${entry.resourceId} declared twice`,
            );
          }
          this.resources.set(
            entry.resourceId,
            initialResourceAccounting(entry.resourceId, entry.amount),
          );
          break;
        }
        case 'REQUESTED': {
          if (
            typeof entry.reservationId !== 'string' ||
            typeof entry.intentId !== 'string' ||
            typeof entry.hopId !== 'string' ||
            !isMoney(entry.amount) ||
            (entry.decision !== 'HOLD' && entry.decision !== 'REJECT') ||
            typeof entry.deadlineEpochMs !== 'number'
          ) {
            throw new TypeError(
              'reservation ledger: REQUESTED requires the reservation id, intent id, hop id, amount, deadline, and decision',
            );
          }
          if (!this.resources.has(entry.resourceId)) {
            throw new TypeError(
              `reservation ledger: corrupt log — REQUESTED for undeclared resource ${entry.resourceId}`,
            );
          }
          if (this.reservationsById.has(entry.reservationId)) {
            throw new TypeError(
              `reservation ledger: corrupt log — REQUESTED duplicated for ${entry.reservationId} ` +
              '("never duplicated" — core.md A05 lines 316-318)',
            );
          }
          if (danglingByResource.has(entry.resourceId)) {
            throw new TypeError(
              `reservation ledger: corrupt log — a second REQUESTED dangles for resource ` +
              `${entry.resourceId} before the first resolved`,
            );
          }
          const requested: ReservationRecord = deepFreeze({
            reservationId: entry.reservationId,
            intentId: entry.intentId,
            hopId: entry.hopId,
            resourceId: entry.resourceId,
            amount: entry.amount,
            state: 'REQUESTED',
            deadlineEpochMs: entry.deadlineEpochMs,
            createdAt: entry.at,
            stateChangedAt: entry.at,
          });
          this.reservationsById.set(entry.reservationId, requested);
          danglingByResource.set(entry.resourceId, {
            resourceId: entry.resourceId,
            reservationId: entry.reservationId,
            decision: entry.decision,
          });
          break;
        }
        default: {
          // HELD | CONSUMED | RELEASED | EXPIRED
          const reservationId = entry.reservationId;
          if (typeof reservationId !== 'string') {
            throw new TypeError('reservation ledger: a reservation transition requires the reservation id');
          }
          const reservation = this.reservationsById.get(reservationId);
          if (reservation === undefined || reservation.resourceId !== entry.resourceId) {
            throw new TypeError(
              `reservation ledger: corrupt log — transition for unknown reservation ${reservationId}`,
            );
          }
          const target = entry.entryKind as ReservationState;
          if (!canTransitionReservation(reservation.state, target)) {
            throw new TypeError(
              `reservation ledger: corrupt log — illegal transition ` +
              `${reservation.state} -> ${target} for ${reservationId}`,
            );
          }
          const accounting = this.resources.get(entry.resourceId);
          if (accounting === undefined) {
            throw new TypeError(
              `reservation ledger: corrupt log — no accounting for resource ${entry.resourceId}`,
            );
          }
          const nextAccounting = applyTransitionArithmetic(
            accounting,
            reservation.state,
            target,
            reservation.amount,
          );
          if (!resourceInvariantHolds(nextAccounting)) {
            throw new TypeError(
              `reservation ledger: corrupt log — INV-5-1 violated at the ` +
              `${reservation.state} -> ${target} transition of ${reservationId}`,
            );
          }
          const resolved: ReservationRecord = deepFreeze({
            ...reservation,
            state: target,
            ...(entry.reasonCode === undefined ? {} : { reasonCode: entry.reasonCode }),
            stateChangedAt: entry.at,
          });
          this.resources.set(entry.resourceId, nextAccounting);
          this.reservationsById.set(reservationId, resolved);
          if (danglingByResource.get(entry.resourceId)?.reservationId === reservationId) {
            danglingByResource.delete(entry.resourceId);
          }
          break;
        }
      }
      this.log.push(deepFreeze(entry));
      this.resourceSequences.set(entry.resourceId, entry.resourceSequence);
      this.globalSequence = entry.globalSequence + 1;
      if (Number.isInteger(entry.at?.sequence) && entry.at.sequence >= this.protocolSequence) {
        this.protocolSequence = entry.at.sequence + 1;
      }
    }
    this.dangling.clear();
    for (const dangle of danglingByResource.values()) {
      this.dangling.set(dangle.resourceId, dangle);
    }
  }

  /** Defense in depth: INV-5-1 asserted after every applied transition. */
  private assertInvariant(resourceId: string): void {
    const accounting = this.resources.get(resourceId);
    if (accounting === undefined || !resourceInvariantHolds(accounting)) {
      throw new TypeError(
        `reservation ledger: INV-5-1 violated after a transition of resource ${resourceId} ` +
        '(core.md A05 lines 304-306)',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** The immutable log snapshot, in total (global) order. */
  entries(): readonly ReservationLedgerEntry[] {
    return Object.freeze([...this.log]);
  }

  /** The resource's entries, in the per-resource total order (INV-5-2). */
  entriesFor(resourceId: string): readonly ReservationLedgerEntry[] {
    return Object.freeze(this.log.filter((entry) => entry.resourceId === resourceId));
  }

  /** The reservation with the given id, or undefined. */
  reservation(reservationId: string): ReservationRecord | undefined {
    return this.reservationsById.get(reservationId);
  }

  /** Every recorded reservation, in log order. */
  reservations(): readonly ReservationRecord[] {
    const ordered: ReservationRecord[] = [];
    const seen = new Set<string>();
    for (const entry of this.log) {
      if (entry.reservationId !== undefined && !seen.has(entry.reservationId)) {
        seen.add(entry.reservationId);
        const reservation = this.reservationsById.get(entry.reservationId);
        if (reservation !== undefined) {
          ordered.push(reservation);
        }
      }
    }
    return Object.freeze(ordered);
  }

  /** The resource's INV-5-1 accounting (declared, held, consumed), or undefined. */
  resourceAccounting(resourceId: string): ResourceAccounting | undefined {
    const accounting = this.resources.get(resourceId);
    return accounting === undefined ? undefined : accounting;
  }

  /** The resource's available balance (declared - held - consumed), or undefined. */
  availableOf(resourceId: string): Money | undefined {
    const accounting = this.resources.get(resourceId);
    return accounting === undefined ? undefined : availableResource(accounting);
  }

  /** The dangling REQUESTED tails (the crash-recovery inputs), by resource id. */
  danglingTails(): readonly DanglingRequest[] {
    return Object.freeze([...this.dangling.values()]);
  }
}

/**
 * Open a ReservationLedger, running the ledger-tail crash recovery to
 * completion before the ledger is returned: a prior log prefix (the
 * surviving entries) is adopted by replay and every dangling REQUESTED is
 * resolved per its recorded decision ("rolled forward to HELD or rolled
 * back to RELEASED based on the recorded decision, never duplicated").
 *
 * Source: core.md lines 316-318.
 */
export async function openReservationLedger(deps: ReservationLedgerDeps): Promise<ReservationLedger> {
  const ledger = new ReservationLedger(deps);
  await ledger.recover();
  return ledger;
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
