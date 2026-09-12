/**
 * RTN-007 — Credit Authority: the composed single-writer command surface
 * for area 7 (A07).
 *
 * Spec sources (binding) — spec/architecture/v0.1/liquidity-credit-queues.md
 * §2 Area 7:
 *   lines 96-111 (the three objects and their exact state machines,
 *     quoted in types.ts).
 *   lines 113-114 (Owning authority):
 *     "Credit Authority (protocol layer, area 7) owns lines, exposure,
 *      and decision semantics."
 *   lines 116-127 (the three invariants this authority enforces):
 *     "INV-7-1 (financial correctness): exposure never exceeds the line
 *      limit; the check and the reservation are atomic under area 5
 *      serialization. Exposure arithmetic is integer Money.
 *      INV-7-2 (concurrency): exposure mutations are serialized per
 *      credit line; two concurrent approvals cannot both count the same
 *      remaining limit.
 *      INV-7-3 (idempotency): decisions are keyed by (intent id, line
 *      id); the same key always returns the same recorded decision."
 *   lines 89-92 (Purpose, verbatim):
 *     "Credit decisions are pure evaluations; the resulting capacity is
 *      held via area 5 reservations like any other resource."
 *   lines 129-136 (failure and UNKNOWN semantics — internal and
 *     deterministic, no UNKNOWN state; repayment UNKNOWN leaves exposure
 *     unchanged until reconciliation).
 *   lines 138-140 (evidence produced); lines 142-149 (boundaries).
 *   spec/architecture/v0.1/core.md §5 Area 5 lines 304-312 (INV-5-1/5-2/5-3
 *     — the resource contracts the line's ledger resource carries) and
 *     lines 335-336 ("Depends on areas 6, 7, and 3 as resource owners").
 *   spec/architecture/v0.1/README.md §3 GC-1/GC-4/GC-5.
 *
 * Command discipline:
 *   - The credit line IS the area-5 ledger resource (resourceId =
 *     `credit-line:<lineId>`; declared total = limit): ACTIVATION declares
 *     the resource; every exposure mutation is a ledger command (INV-7-2
 *     "exposure mutations are serialized per credit line" — the ledger's
 *     per-resource order IS the per-line order, and the authority wraps
 *     every command in its own per-line keyed serializer).
 *   - INV-7-1 is atomic BY CONSTRUCTION: exposure = held + consumed on
 *     the ledger resource, so "exposure never exceeds the line limit" is
 *     exactly the ledger's INV-5-1 available >= 0, checked and held
 *     atomically inside the ledger's serialized requestReservation — two
 *     concurrent approvals can never both count the same remaining limit
 *     (the second's hold is rejected; its decision stays EVALUATED,
 *     retryable, immutable by INV-7-3).
 *   - evaluateCreditUsage is the pure, deterministic evaluation (the
 *     prediction, recorded with CREDIT_DECIDED); applyCreditDecision is
 *     THE atomic capacity commit (the ledger hold) that moves the
 *     decision EVALUATED -> APPLIED and writes EXPOSURE_CHANGED.
 *   - Every consequential operation submits its GC-5 evidence record
 *     FIRST (awaited) and commits state only after the write succeeds
 *     ("A failed write fails the operation", A15 lines 62-64).
 *   - Decisions are keyed by (intent id, line id) — the decision id is
 *     deriveProtocolId('credit-decision', intentId, lineId) — and the
 *     same key always returns the same recorded decision (INV-7-3).
 *   - Suspension blocks new reservations (evaluate denies with
 *     LINE_NOT_ACTIVE; apply rejects); closure requires SUSPENDED and
 *     exposure exactly zero.
 *   - Domain rejections are typed values, never thrown; input-shape
 *     violations throw TypeError (kernel convention).
 *
 * State layer (recorded in CONTRACT-REVIEW.md): in-process single writer —
 * the RTN-002/RTN-005 in-process-object-store precedent. The durable side
 * is persistence.ts + migrations/.
 */

import { deriveProtocolId } from '../kernel/identity.ts';
import { isMoney } from '../kernel/money.ts';
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
  creditDecidedEvidence,
  creditLineStateChangedEvidence,
  exposureChangedEvidence,
  submitCreditEvidence,
} from './evidence.ts';
import {
  exposureFromAccounting,
  exposureInvariantHolds,
  zeroExposure,
} from './exposure.ts';
import type { CreditExposureView } from './types.ts';
import { KeyedSerializer } from './serializer.ts';
import { transitionCreditDecision, transitionCreditLine } from './state-machine.ts';
import type {
  ApplyCreditDecisionResult,
  CreditDecisionOutcome,
  CreditDecisionRecord,
  CreditLineRecord,
  CreditRejectionCode,
} from './types.ts';

/**
 * The ledger resource id of one credit line — the area-5 resource this
 * domain owns and declares at activation (declared total = limit).
 *
 * Source: core.md lines 335-336 ("Depends on areas 6, 7, and 3 as
 * resource owners"); lines 304-306 (INV-5-1's declared total).
 */
export function creditLineResourceId(lineId: string): string {
  return `credit-line:${lineId}`;
}

/**
 * Constructor dependencies for the Credit Authority.
 *
 * Source: the wave evidence discipline (the REAL RTN-002 log through the
 * kernel port); the RTN-006 ReservationLedger — THE mutation interface
 * every exposure transition passes through; the wallClock-injection
 * convention for deterministic tests.
 */
export interface CreditAuthorityDeps {
  /** The EvidenceSubmission port — the real RTN-002 EvidenceLog. */
  readonly evidence: EvidenceSubmission;
  /**
   * The RTN-006 ReservationLedger — the area-5 concurrency frontier. The
   * credit line is the ledger resource; every exposure mutation is a
   * ledger command.
   */
  readonly ledger: ReservationLedger;
  /** Injectable wall clock (epoch ms) for deterministic tests; default Date.now. */
  readonly wallClock?: () => number;
}

/** One command's rejection (typed, never thrown). */
export interface CreditRejection {
  readonly ok: false;
  readonly code: CreditRejectionCode;
  readonly problem: string;
}

/**
 * The Credit Authority: sole writer of lines, exposure, and decision
 * semantics (GC-4). Commands: offerLine / activateLine / suspendLine /
 * closeLine (the exact line machine); evaluateCreditUsage /
 * applyCreditDecision (the CreditDecision machine — EVALUATED -> APPLIED,
 * INV-7-3 keying); consumeCreditReservation / releaseCreditReservation /
 * expireDueCreditReservations (the ledger-mediated exposure mutations).
 *
 * Source: liquidity-credit-queues.md lines 96-149; core.md lines
 * 293-312, 335-336.
 */
export class CreditAuthority {
  private readonly evidence: EvidenceSubmission;
  private readonly ledger: ReservationLedger;
  private readonly wallClock: () => number;
  private readonly serializer = new KeyedSerializer();
  private readonly lines = new Map<string, CreditLineRecord>();
  private readonly decisions = new Map<string, CreditDecisionRecord>();
  private protocolSequence = 0;

  constructor(deps: CreditAuthorityDeps) {
    if (
      deps.evidence === null ||
      typeof deps.evidence !== 'object' ||
      typeof deps.evidence.submit !== 'function'
    ) {
      throw new TypeError('credit authority: deps.evidence must be an EvidenceSubmission port');
    }
    if (deps.ledger === null || typeof deps.ledger !== 'object') {
      throw new TypeError('credit authority: deps.ledger must be a ReservationLedger');
    }
    this.evidence = deps.evidence;
    this.ledger = deps.ledger;
    this.wallClock = deps.wallClock ?? (() => Date.now());
  }

  private nextTime(): ProtocolTime {
    const when = protocolTime(this.protocolSequence, this.wallClock());
    this.protocolSequence += 1;
    return when;
  }

  // -------------------------------------------------------------------------
  // Line machine (OFFERED -> ACTIVE -> SUSPENDED -> CLOSED, exact)
  // -------------------------------------------------------------------------

  /**
   * Offer a credit line — the agreement extending fulfillment capacity
   * against future repayment (state OFFERED). The limit is the caller's
   * input ("Credit policy parameters are inputs; this area defines
   * semantics, not business parameters"); it becomes the ledger
   * resource's declared total at activation and never changes.
   *
   * Source: liquidity-credit-queues.md lines 96-98, 145-147.
   */
  async offerLine(input: {
    readonly lineId: string;
    readonly limit: Money;
  }): Promise<{ ok: true; replayed: boolean; line: CreditLineRecord } | CreditRejection> {
    if (typeof input.lineId !== 'string' || input.lineId.length === 0) {
      throw new TypeError('credit authority: lineId must be a non-empty string');
    }
    if (!isMoney(input.limit)) {
      throw new TypeError('credit authority: limit must be a kernel Money value (integer minor units, GC-1)');
    }
    if (input.limit.amountMinor <= 0) {
      throw new TypeError('credit authority: limit must be positive');
    }
    return this.serializer.run(`line:${input.lineId}`, async () => {
      const existing = this.lines.get(input.lineId);
      if (existing !== undefined) {
        if (
          existing.limit.currency === input.limit.currency &&
          existing.limit.scale === input.limit.scale &&
          existing.limit.amountMinor === input.limit.amountMinor
        ) {
          return { ok: true as const, replayed: true, line: existing };
        }
        return rejection(
          'ILLEGAL_TRANSITION',
          `credit authority: line ${input.lineId} already exists with a different limit`,
        );
      }
      const when = this.nextTime();
      const line: CreditLineRecord = {
        lineId: input.lineId,
        limit: input.limit,
        state: 'OFFERED',
        offeredAt: when,
        stateChangedAt: when,
      };
      await submitCreditEvidence(
        this.evidence,
        creditLineStateChangedEvidence({ line, requiredState: 'OFFERED', reasonCode: 'LINE_OFFERED', when }),
      );
      this.lines.set(line.lineId, deepFreeze(line));
      return { ok: true as const, replayed: false, line };
    });
  }

  /**
   * Activate a credit line — OFFERED -> ACTIVE. Activation declares the
   * line as an area-5 ledger resource with declared total = the limit
   * (the INV-5-1 identity's fixed input; core.md lines 304-306, 335-336),
   * which is what makes INV-7-1 atomic under area-5 serialization.
   *
   * Source: liquidity-credit-queues.md lines 97-99; core.md lines
   * 304-306, 335-336.
   */
  async activateLine(
    lineId: string,
  ): Promise<{ ok: true; replayed: boolean; line: CreditLineRecord } | CreditRejection> {
    if (typeof lineId !== 'string' || lineId.length === 0) {
      throw new TypeError('credit authority: lineId must be a non-empty string');
    }
    return this.serializer.run(`line:${lineId}`, async () => {
      const line = this.lines.get(lineId);
      if (line === undefined) {
        return rejection('LINE_NOT_FOUND', `credit authority: line ${lineId} is not recorded`);
      }
      if (line.state === 'ACTIVE') {
        return { ok: true as const, replayed: true, line };
      }
      const when = this.nextTime();
      const transition = transitionCreditLine(line, 'ACTIVE', when);
      if (!transition.ok) {
        return rejection(
          'ILLEGAL_TRANSITION',
          `credit authority: line transition ${line.state} -> ACTIVE is not an edge of the exact v0.1 chain`,
        );
      }
      const declaration = await this.ledger.declareResource(creditLineResourceId(lineId), line.limit);
      if (!declaration.ok) {
        return rejection(
          'ILLEGAL_TRANSITION',
          `credit authority: the ledger rejected the line resource declaration: ${declaration.problem}`,
        );
      }
      await submitCreditEvidence(
        this.evidence,
        creditLineStateChangedEvidence({
          line: transition.line,
          requiredState: 'ACTIVE',
          reasonCode: 'LINE_ACTIVATED',
          when,
        }),
      );
      this.lines.set(lineId, deepFreeze(transition.line));
      return { ok: true as const, replayed: false, line: transition.line };
    });
  }

  /**
   * Suspend a credit line — ACTIVE -> SUSPENDED. "Suspension blocks new
   * reservations": evaluateCreditUsage denies with LINE_NOT_ACTIVE and
   * applyCreditDecision rejects with LINE_NOT_ACTIVE while the line is
   * not ACTIVE. In-flight HELD reservations survive (the ledger's own
   * discipline: UNKNOWN-associated holds stay HELD, core.md lines
   * 319-322).
   *
   * Source: liquidity-credit-queues.md lines 99-100.
   */
  async suspendLine(
    lineId: string,
  ): Promise<{ ok: true; replayed: boolean; line: CreditLineRecord } | CreditRejection> {
    if (typeof lineId !== 'string' || lineId.length === 0) {
      throw new TypeError('credit authority: lineId must be a non-empty string');
    }
    return this.serializer.run(`line:${lineId}`, async () => {
      const line = this.lines.get(lineId);
      if (line === undefined) {
        return rejection('LINE_NOT_FOUND', `credit authority: line ${lineId} is not recorded`);
      }
      if (line.state === 'SUSPENDED') {
        return { ok: true as const, replayed: true, line };
      }
      const when = this.nextTime();
      const transition = transitionCreditLine(line, 'SUSPENDED', when);
      if (!transition.ok) {
        return rejection(
          'ILLEGAL_TRANSITION',
          `credit authority: line transition ${line.state} -> SUSPENDED is not an edge of the exact v0.1 chain`,
        );
      }
      await submitCreditEvidence(
        this.evidence,
        creditLineStateChangedEvidence({
          line: transition.line,
          requiredState: 'SUSPENDED',
          reasonCode: 'LINE_SUSPENDED_BLOCKS_NEW_RESERVATIONS',
          when,
        }),
      );
      this.lines.set(lineId, deepFreeze(transition.line));
      return { ok: true as const, replayed: false, line: transition.line };
    });
  }

  /**
   * Close a credit line — SUSPENDED -> CLOSED, terminal. Closure requires
   * the line's exposure to be exactly zero ("closure is terminal after
   * outstanding exposure is settled or written off (areas 10, 12)"): a
   * line with outstanding exposure is the typed EXPOSURE_OUTSTANDING
   * rejection. Reduction of CONSUMED exposure (repayment / write-off) is
   * the settlement wave's composition (areas 9-12/21 — deferred, see
   * CONTRACT-REVIEW).
   *
   * Source: liquidity-credit-queues.md lines 99-100, 129-136.
   */
  async closeLine(
    lineId: string,
  ): Promise<{ ok: true; replayed: boolean; line: CreditLineRecord } | CreditRejection> {
    if (typeof lineId !== 'string' || lineId.length === 0) {
      throw new TypeError('credit authority: lineId must be a non-empty string');
    }
    return this.serializer.run(`line:${lineId}`, async () => {
      const line = this.lines.get(lineId);
      if (line === undefined) {
        return rejection('LINE_NOT_FOUND', `credit authority: line ${lineId} is not recorded`);
      }
      if (line.state === 'CLOSED') {
        return { ok: true as const, replayed: true, line };
      }
      const exposure = this.currentExposure(lineId);
      if (exposure === undefined) {
        return rejection('LINE_NOT_FOUND', `credit authority: line ${lineId} has no ledger resource (internal consistency)`);
      }
      if (exposure.exposure.amountMinor !== 0) {
        return rejection(
          'EXPOSURE_OUTSTANDING',
          `credit authority: line ${lineId} cannot close with outstanding exposure ` +
            `${exposure.exposure.amountMinor} ${exposure.exposure.currency} (closure is terminal after ` +
            'outstanding exposure is settled or written off — liquidity-credit-queues.md lines 99-100)',
        );
      }
      const when = this.nextTime();
      const transition = transitionCreditLine(line, 'CLOSED', when);
      if (!transition.ok) {
        return rejection(
          'ILLEGAL_TRANSITION',
          `credit authority: line transition ${line.state} -> CLOSED is not an edge of the exact v0.1 chain`,
        );
      }
      await submitCreditEvidence(
        this.evidence,
        creditLineStateChangedEvidence({
          line: transition.line,
          requiredState: 'CLOSED',
          reasonCode: 'LINE_CLOSED_EXPOSURE_SETTLED',
          when,
        }),
      );
      this.lines.set(lineId, deepFreeze(transition.line));
      return { ok: true as const, replayed: false, line: transition.line };
    });
  }

  // -------------------------------------------------------------------------
  // CreditDecision machine (EVALUATED -> APPLIED; INV-7-3 keying)
  // -------------------------------------------------------------------------

  /**
   * Evaluate one requested credit usage — the pure, deterministic
   * evaluation, keyed by (intent id, line id) (INV-7-3: the same key
   * always returns the same recorded decision — a re-evaluation under the
   * same key is the recorded replay, whatever the inputs). The evaluation
   * is a PREDICTION over the current exposure; the authoritative
   * atomic check is applyCreditDecision's ledger hold (INV-7-1). Outcome:
   * APPROVED with the exact requested amount ("an approval names an exact
   * integer amount" — no partial approvals: "Credit policy parameters are
   * inputs; this area defines semantics"), or DENIED with reason code
   * (LINE_NOT_ACTIVE / INSUFFICIENT_REMAINING_LIMIT). Writes one
   * CREDIT_DECIDED record.
   *
   * Source: liquidity-credit-queues.md lines 89-92, 105-111, 125-127;
   * INV-7-1 lines 119-121.
   */
  async evaluateCreditUsage(input: {
    readonly intentId: string;
    readonly lineId: string;
    readonly requestedAmount: Money;
  }): Promise<{ ok: true; replayed: boolean; decision: CreditDecisionRecord } | CreditRejection> {
    if (typeof input.intentId !== 'string' || input.intentId.length === 0) {
      throw new TypeError('credit authority: intentId must be a non-empty string');
    }
    if (!isMoney(input.requestedAmount)) {
      throw new TypeError('credit authority: requestedAmount must be a kernel Money value (GC-1)');
    }
    if (input.requestedAmount.amountMinor <= 0) {
      throw new TypeError('credit authority: requestedAmount must be positive');
    }
    const decisionId = deriveProtocolId('credit-decision', input.intentId, input.lineId);
    return this.serializer.run(`line:${input.lineId}`, async () => {
      const line = this.lines.get(input.lineId);
      if (line === undefined) {
        return rejection('LINE_NOT_FOUND', `credit authority: line ${input.lineId} is not recorded`);
      }
      const existing = this.decisions.get(decisionId);
      if (existing !== undefined) {
        // INV-7-3: the same key always returns the same recorded decision.
        return { ok: true as const, replayed: true, decision: existing };
      }
      if (input.requestedAmount.currency !== line.limit.currency) {
        return rejection(
          'UNIT_MISMATCH',
          `requesting ${input.requestedAmount.currency} against the ${line.limit.currency} line is forbidden (GC-1)`,
        );
      }
      if (input.requestedAmount.scale !== line.limit.scale) {
        return rejection(
          'UNIT_MISMATCH',
          `requesting at scale ${input.requestedAmount.scale} against the scale-${line.limit.scale} line is forbidden (GC-1)`,
        );
      }
      const exposure =
        line.state === 'OFFERED'
          ? zeroExposure(line.lineId, line.limit)
          : this.currentExposureOrZero(line);
      if (!exposureInvariantHolds(exposure)) {
        throw new TypeError(
          `credit authority: INV-7-1 violated on line ${line.lineId} (exposure exceeds the limit)`,
        );
      }
      let outcome: CreditDecisionOutcome;
      if (line.state !== 'ACTIVE') {
        outcome = { kind: 'DENIED', reason: 'LINE_NOT_ACTIVE' };
      } else if (input.requestedAmount.amountMinor > exposure.remaining.amountMinor) {
        outcome = { kind: 'DENIED', reason: 'INSUFFICIENT_REMAINING_LIMIT' };
      } else {
        outcome = { kind: 'APPROVED', approvedAmount: input.requestedAmount };
      }
      const when = this.nextTime();
      const decision: CreditDecisionRecord = {
        decisionId,
        intentId: input.intentId,
        lineId: input.lineId,
        state: 'EVALUATED',
        outcome,
        evaluatedAt: when,
      };
      await submitCreditEvidence(
        this.evidence,
        creditDecidedEvidence({ decision, exposureAtEvaluation: exposure, when }),
      );
      this.decisions.set(decisionId, deepFreeze(decision));
      return { ok: true as const, replayed: false, decision };
    });
  }

  /**
   * Apply one APPROVED credit decision — THE atomic capacity commit: the
   * area-5 reservation hold on the line's resource, inside the ledger's
   * per-resource (per-line) serialization (INV-7-1's "the check and the
   * reservation are atomic under area 5 serialization"; INV-7-2's
   * serialized-per-line). On HELD the decision moves EVALUATED -> APPLIED
   * and one EXPOSURE_CHANGED record is written. If the hold is rejected
   * (another approval consumed the remaining limit between evaluation
   * and apply — "two concurrent approvals cannot both count the same
   * remaining limit"), the result is the typed
   * INSUFFICIENT_REMAINING_LIMIT rejection and the decision stays
   * EVALUATED, retryable, its recorded outcome unchanged (INV-7-3).
   * Re-apply of an APPLIED decision returns the recorded state (replay).
   *
   * Source: liquidity-credit-queues.md lines 89-92, 107-108, 119-127;
   * core.md lines 286-312.
   */
  async applyCreditDecision(input: {
    readonly decisionId: string;
    readonly hopId: string;
    readonly deadlineEpochMs: number;
  }): Promise<ApplyCreditDecisionResult> {
    if (typeof input.decisionId !== 'string' || input.decisionId.length === 0) {
      throw new TypeError('credit authority: decisionId must be a non-empty string');
    }
    if (typeof input.hopId !== 'string' || input.hopId.length === 0) {
      throw new TypeError('credit authority: hopId must be a non-empty string');
    }
    if (typeof input.deadlineEpochMs !== 'number' || !Number.isInteger(input.deadlineEpochMs)) {
      throw new TypeError('credit authority: deadlineEpochMs must be an integer (GC-1)');
    }
    const decision = this.decisions.get(input.decisionId);
    if (decision === undefined) {
      return rejection('DECISION_NOT_FOUND', `credit authority: decision ${input.decisionId} is not recorded`);
    }
    return this.serializer.run(`line:${decision.lineId}`, async (): Promise<ApplyCreditDecisionResult> => {
      const current = this.decisions.get(input.decisionId);
      if (current === undefined) {
        return rejection('DECISION_NOT_FOUND', `credit authority: decision ${input.decisionId} is not recorded`);
      }
      if (current.state === 'APPLIED') {
        return {
          ok: true as const,
          replayed: true,
          decision: current,
          reservationId: current.reservationId as string,
        };
      }
      if (current.outcome.kind !== 'APPROVED') {
        return rejection(
          'DECISION_NOT_APPROVED',
          `credit authority: decision ${input.decisionId} is ${current.outcome.kind}` +
            ` (${current.outcome.reason}) — nothing to apply`,
        );
      }
      const line = this.lines.get(current.lineId);
      if (line === undefined) {
        return rejection('LINE_NOT_FOUND', `credit authority: line ${current.lineId} vanished (internal consistency)`);
      }
      if (line.state !== 'ACTIVE') {
        return rejection(
          'LINE_NOT_ACTIVE',
          `credit authority: line ${current.lineId} is ${line.state} (suspension blocks new reservations — ` +
            'liquidity-credit-queues.md lines 99-100)',
        );
      }
      const request: ReservationRequestResult = await this.ledger.requestReservation({
        intentId: current.intentId,
        hopId: input.hopId,
        resourceId: creditLineResourceId(current.lineId),
        amount: current.outcome.approvedAmount,
        deadlineEpochMs: input.deadlineEpochMs,
      });
      if (!request.ok) {
        return mapLedgerRejection(request.code, request.problem);
      }
      if (!request.held) {
        // The ledger's recorded rejection: the atomic INV-7-1 check failed
        // (INV-5-2 — never ambiguous). The decision stays EVALUATED.
        return rejection(
          'INSUFFICIENT_REMAINING_LIMIT',
          `credit authority: the atomic hold was rejected (${request.reservation.reasonCode ?? 'INSUFFICIENT_AVAILABLE'}) — ` +
            'two concurrent approvals cannot both count the same remaining limit (INV-7-1/INV-7-2)',
        );
      }
      const when = this.nextTime();
      const transition = transitionCreditDecision(current, 'APPLIED', when);
      if (!transition.ok) {
        return rejection('ILLEGAL_TRANSITION', 'credit authority: the decision cannot transition to APPLIED');
      }
      const applied: CreditDecisionRecord = deepFreeze({
        ...transition.decision,
        reservationId: request.reservation.reservationId,
      });
      const exposureAfter = this.currentExposureOrThrow(line);
      if (!exposureInvariantHolds(exposureAfter)) {
        throw new TypeError(
          `credit authority: INV-7-1 violated on line ${line.lineId} after the applied hold`,
        );
      }
      await submitCreditEvidence(
        this.evidence,
        exposureChangedEvidence({
          lineId: line.lineId,
          exposure: exposureAfter,
          reasonCode: 'EXPOSURE_HELD',
          when,
          reservationId: request.reservation.reservationId,
        }),
      );
      this.decisions.set(applied.decisionId, applied);
      return {
        ok: true as const,
        replayed: false,
        decision: applied,
        reservationId: request.reservation.reservationId,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Exposure mutations (ledger-mediated: INV-7-2)
  // -------------------------------------------------------------------------

  /**
   * Consume one credit reservation — the ledger's exactly-once CONSUMED
   * terminal, applied to the line's exposure: consumed += amount (the
   * capacity settles into obligations from clearing, area 9). Writes one
   * EXPOSURE_CHANGED record.
   *
   * Source: liquidity-credit-queues.md lines 101-104, 140; core.md lines
   * 288-289, 310-312.
   */
  async consumeCreditReservation(
    reservationId: string,
  ): Promise<{ ok: true; replayed: boolean; record: CreditExposureView } | CreditRejection> {
    return this.exposureTerminal(reservationId, 'EXPOSURE_CONSUMED', (id) =>
      this.ledger.consumeReservation(id),
    );
  }

  /**
   * Release one credit reservation — the ledger's exactly-once RELEASED
   * terminal: the held capacity returns (exposure decreases; repayment
   * and obligation-cancellation flows ride the release path —
   * "mutated only through area 5 reservations tied to obligations from
   * clearing"). Writes one EXPOSURE_CHANGED record.
   *
   * Source: liquidity-credit-queues.md lines 101-104, 140; core.md lines
   * 288-289, 310-312.
   */
  async releaseCreditReservation(
    reservationId: string,
  ): Promise<{ ok: true; replayed: boolean; record: CreditExposureView } | CreditRejection> {
    return this.exposureTerminal(reservationId, 'EXPOSURE_RELEASED', (id) =>
      this.ledger.releaseReservation(id),
    );
  }

  private async exposureTerminal(
    reservationId: string,
    reasonCode: 'EXPOSURE_CONSUMED' | 'EXPOSURE_RELEASED',
    command: (reservationId: string) => Promise<ReservationTerminalCommandResult>,
  ): Promise<{ ok: true; replayed: boolean; record: CreditExposureView } | CreditRejection> {
    if (typeof reservationId !== 'string' || reservationId.length === 0) {
      throw new TypeError('credit authority: reservationId must be a non-empty string');
    }
    const reservation = this.ledger.reservation(reservationId);
    if (reservation === undefined) {
      return rejection(
        'RESERVATION_NOT_OWNED',
        `credit authority: reservation ${reservationId} is not recorded on the ledger`,
      );
    }
    const lineId = lineIdOfResource(reservation.resourceId);
    if (lineId === undefined || !this.lines.has(lineId)) {
      return rejection(
        'RESERVATION_NOT_OWNED',
        `credit authority: reservation ${reservationId} does not belong to a credit line`,
      );
    }
    return this.serializer.run(`line:${lineId}`, async () => {
      const result = await command(reservationId);
      if (!result.ok) {
        return mapLedgerRejection(result.code, result.problem);
      }
      const line = this.lines.get(lineId);
      if (line === undefined) {
        return rejection('LINE_NOT_FOUND', `credit authority: line ${lineId} vanished (internal consistency)`);
      }
      const exposure = this.currentExposureOrThrow(line);
      if (!exposureInvariantHolds(exposure)) {
        throw new TypeError(`credit authority: INV-7-1 violated on line ${lineId} after a terminal transition`);
      }
      const when = this.nextTime();
      await submitCreditEvidence(
        this.evidence,
        exposureChangedEvidence({ lineId, exposure, reasonCode, when, reservationId }),
      );
      return { ok: true as const, replayed: result.replayed, record: exposure };
    });
  }

  /**
   * Expire every due hold on every credit line — the ledger's
   * deterministic deadline rule, applied to the lines' exposure views.
   * Runs the ledger's expiry sweep (a global, deterministic run —
   * "expiry is deterministic on protocol time"), then recomputes and
   * re-evidences each affected credit line once, in ascending line-id
   * order. The composition root sequences the sibling domains' sweeps so
   * every resource owner observes the sweep's effects on its resources
   * (recorded in CONTRACT-REVIEW).
   *
   * Source: liquidity-credit-queues.md lines 101-104, 140; core.md lines
   * 290-291.
   */
  async expireDueCreditReservations(at?: ProtocolTime): Promise<readonly CreditExposureView[]> {
    const expired = await this.ledger.expireDueReservations(at);
    const affectedLineIds = [
      ...new Set(
        expired
          .map((reservation) => lineIdOfResource(reservation.resourceId))
          .filter((lineId): lineId is string => lineId !== undefined && this.lines.has(lineId)),
      ),
    ].sort();
    const updated: CreditExposureView[] = [];
    for (const lineId of affectedLineIds) {
      const view = await this.serializer.run(`line:${lineId}`, async () => {
        const line = this.lines.get(lineId);
        if (line === undefined) {
          throw new TypeError(`credit authority: line ${lineId} vanished (internal consistency)`);
        }
        const exposure = this.currentExposureOrThrow(line);
        if (!exposureInvariantHolds(exposure)) {
          throw new TypeError(`credit authority: INV-7-1 violated on line ${lineId} after expiry`);
        }
        const when = this.nextTime();
        await submitCreditEvidence(
          this.evidence,
          exposureChangedEvidence({ lineId, exposure, reasonCode: 'EXPOSURE_EXPIRED', when }),
        );
        return exposure;
      });
      updated.push(view);
    }
    return Object.freeze(updated);
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** The line record, or undefined. Source: lines 96-100 (the owned state). */
  line(lineId: string): CreditLineRecord | undefined {
    return this.lines.get(lineId);
  }

  /** The decision record, or undefined. Source: lines 105-111 (INV-7-3 keying). */
  decision(decisionId: string): CreditDecisionRecord | undefined {
    return this.decisions.get(decisionId);
  }

  /**
   * The line's current exposure view — recomputed live from the ledger
   * resource accounting ("mutated only through area 5 reservations").
   *
   * Source: liquidity-credit-queues.md lines 101-104; INV-7-1 lines
   * 119-121.
   */
  lineExposure(lineId: string): CreditExposureView | undefined {
    const line = this.lines.get(lineId);
    if (line === undefined) {
      return undefined;
    }
    return this.currentExposure(lineId) ?? zeroExposure(lineId, line.limit);
  }

  /** Every recorded line, in offer order. Source: lines 96-100. */
  linesInOrder(): readonly CreditLineRecord[] {
    return Object.freeze([...this.lines.values()]);
  }

  /** Every recorded decision, in evaluation order. Source: lines 105-111. */
  decisionsInOrder(): readonly CreditDecisionRecord[] {
    return Object.freeze([...this.decisions.values()]);
  }

  // -------------------------------------------------------------------------
  // Internal exposure reads (pure projections of the ledger accounting)
  // -------------------------------------------------------------------------

  private currentExposure(lineId: string): CreditExposureView | undefined {
    const line = this.lines.get(lineId);
    if (line === undefined) {
      return undefined;
    }
    const accounting = this.ledger.resourceAccounting(creditLineResourceId(lineId));
    if (accounting === undefined) {
      return undefined;
    }
    return exposureFromAccounting(lineId, line.limit, accounting);
  }

  private currentExposureOrZero(line: CreditLineRecord): CreditExposureView {
    return this.currentExposure(line.lineId) ?? zeroExposure(line.lineId, line.limit);
  }

  private currentExposureOrThrow(line: CreditLineRecord): CreditExposureView {
    const view = this.currentExposure(line.lineId);
    if (view === undefined) {
      throw new TypeError(
        `credit authority: line ${line.lineId} has no ledger resource accounting (internal consistency)`,
      );
    }
    return view;
  }
}

/** Extract the line id from a `credit-line:<lineId>` resource id. */
function lineIdOfResource(resourceId: string): string | undefined {
  if (!resourceId.startsWith('credit-line:')) {
    return undefined;
  }
  return resourceId.slice('credit-line:'.length);
}

/** Map an area-5 ledger rejection into the credit vocabulary (typed). */
function mapLedgerRejection(
  code: 'RESERVATION_NOT_FOUND' | 'RESOURCE_NOT_DECLARED' | 'RESOURCE_ALREADY_DECLARED' | 'ILLEGAL_TRANSITION' | 'UNIT_MISMATCH',
  problem: string,
): CreditRejection {
  switch (code) {
    case 'RESERVATION_NOT_FOUND':
    case 'RESOURCE_NOT_DECLARED':
      return { ok: false, code: 'RESERVATION_NOT_OWNED', problem };
    case 'UNIT_MISMATCH':
      return { ok: false, code: 'UNIT_MISMATCH', problem };
    default:
      return { ok: false, code: 'ILLEGAL_TRANSITION', problem };
  }
}

function rejection(code: CreditRejectionCode, problem: string): CreditRejection {
  return { ok: false, code, problem };
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
