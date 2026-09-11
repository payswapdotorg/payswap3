/**
 * RTN-005 — Capability Authority: the composed single-writer command
 * surface for area 3 (A03).
 *
 * Spec sources (binding) — spec/architecture/v0.1/core.md §3 Area 3:
 *   lines 154-158 (Capability — states, degradation semantics):
 *     "States: REGISTERED -> ACTIVE -> DEGRADED -> RETIRED.
 *      Degraded capabilities accept no new commitments. Retirement is
 *      terminal."
 *   lines 160-163 (Commitment):
 *     "States: OFFERED -> RESERVED -> CONSUMED | EXPIRED | RELEASED.
 *      RESERVED commitments count against capability capacity; CONSUMED is
 *      terminal and exactly once per intent."
 *   lines 165-166 (CapabilitySnapshot — immutable, sequenced).
 *   lines 170-172 (owning authority):
 *     "Capability Authority (protocol layer, area 3) owns the capability
 *      registry and commitment state."
 *   lines 176-184 (INV-3-1 / INV-3-2 / INV-3-3 — quoted in the enforcing
 *   modules: capacity.ts, serializer.ts, and the commitment-id derivation
 *   below).
 *   lines 186-193 (failure semantics):
 *     "A capability entering DEGRADED invalidates only OFFERED commitments;
 *      RESERVED commitments remain valid until released by area 5 rules or
 *      expired by deadline. No UNKNOWN state in this area."
 *   lines 197-200 (evidence produced — CAPABILITY_* / COMMITMENT_* through
 *   the REAL A15 log).
 *   lines 202-208 (boundaries — no rail initiation; commitments are
 *   capacity promises, not ledger entries; "Depends on ... area 16 for risk
 *   gating of capability registration").
 *   spec/architecture/v0.1/evidence-risk-compliance.md §2 Area 16, lines
 *   129-131 (INV-16-3, the gate this authority calls before ACTIVATION):
 *     "state transitions gated by compliance (intent AUTHORIZATION,
 *      capability ACTIVATION) cannot complete without a terminal APPROVED
 *      record for the subject."
 *
 * Command discipline:
 *   - Every capability and commitment command runs INSIDE the keyed
 *     serializer under the CAPABILITY id (INV-3-2's serialization key — see
 *     serializer.ts for why per-capability subsumes per-(capability,
 *     intent) and is required for atomic accounting).
 *   - Every consequential operation submits its GC-5 evidence record FIRST
 *     (awaited) and commits state only after the write succeeds ("A failed
 *     write fails the operation", A15 lines 62-64).
 *   - Capacity accounting is updated atomically with commitment state
 *     (INV-3-2) and the INV-3-1 identity is asserted after EVERY commitment
 *     transition (see the tests' property suite; the authority re-checks it
 *     as defense in depth before commit).
 *   - Commitment ids are derived from (intent id, capability id) via the
 *     kernel identity module (INV-3-3); duplicate requests return the
 *     recorded commitment state.
 *   - Domain rejections are typed values, never thrown; input-shape
 *     violations throw TypeError (kernel convention).
 *   - ACTIVATION calls the RTN-003 compliance gate BEFORE the transition
 *     (INV-16-3, capability side; "risk gating of capability registration",
 *     core.md lines 207-208): no ACTIVE without a terminal APPROVED record
 *     for the capability subject.
 *   - DEGRADATION invalidates only OFFERED commitments (each moves to
 *     RELEASED with its own COMMITMENT_RELEASED record); RESERVED
 *     commitments survive untouched ("RESERVED commitments remain valid
 *     until released by area 5 rules or expired by deadline").
 *
 * State layer (recorded in CONTRACT-REVIEW.md): in-process single writer —
 * the RTN-002 in-process-object-store precedent (see intent/authority.ts).
 * The durable side is persistence.ts + migrations/.
 */

import { deriveProtocolId } from '../kernel/identity.ts';
import { isMoney, money } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';
import type { EvidenceSubmission } from '../kernel/ports.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type { ComplianceGateVerdict } from '../risk/gate.ts';
import {
  applyConsumption,
  applyRelease,
  applyReservation,
  availableCapacity,
  capacityInvariantHolds,
  initialAccounting,
} from './capacity.ts';
import type { CapabilityAccounting } from './capacity.ts';
import {
  capabilityRegisteredEvidence,
  capabilityStateChangedEvidence,
  commitmentEvidence,
  submitCapabilityEvidence,
} from './evidence.ts';
import { KeyedSerializer } from './serializer.ts';
import {
  acceptsNewCommitments,
  isExpiredAt,
  isInvalidatedByDegradation,
  transitionCapability,
  transitionCommitment,
} from './state-machine.ts';
import type {
  CapabilityDeclaration,
  CapabilityRecord,
  CapabilitySnapshot,
  CapabilitySnapshotEntry,
  CapabilityCommandResult,
  CommitmentRecord,
} from './types.ts';

/**
 * The RTN-003 compliance-gate port the Capability Authority calls before
 * completing ACTIVATION (INV-16-3, capability side). The verdict type is
 * RTN-003's own (type-only import); the composition root wires risk's
 * evaluateComplianceGate over the recorded checks.
 *
 * Source: core.md lines 207-208 ("Depends on ... area 16 for risk gating of
 * capability registration"); evidence-risk-compliance.md lines 129-131.
 */
export interface CapabilityActivationGate {
  (subjectId: string): ComplianceGateVerdict;
}

/**
 * Constructor dependencies for the Capability Authority.
 *
 * Source: the wave evidence discipline (the REAL RTN-002 log through the
 * kernel port); core.md lines 207-208 (the gate dependency); the rails
 * wallClock-injection convention.
 */
export interface CapabilityAuthorityDeps {
  /** The EvidenceSubmission port — the real RTN-002 EvidenceLog. */
  readonly evidence: EvidenceSubmission;
  /** The RTN-003 compliance gate (INV-16-3) called before ACTIVATION. */
  readonly gate: CapabilityActivationGate;
  /** Injectable wall clock (epoch ms) for deterministic tests; default Date.now. */
  readonly wallClock?: () => number;
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

function assertDeclaration(declaration: CapabilityDeclaration): void {
  if (declaration === null || typeof declaration !== 'object') {
    throw new TypeError('capability authority: declaration must be a CapabilityDeclaration');
  }
  if (typeof declaration.railId !== 'string' || declaration.railId.length === 0) {
    throw new TypeError('capability authority: declaration.railId must be a non-empty string');
  }
  const corridor = declaration.corridor;
  if (corridor === null || typeof corridor !== 'object') {
    throw new TypeError('capability authority: declaration.corridor must be a Corridor');
  }
  for (const field of ['sourceCurrency', 'destinationCurrency', 'sourceGeography', 'destinationGeography'] as const) {
    const value = corridor[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError(`capability authority: corridor.${field} must be a non-empty string`);
    }
    if ((field === 'sourceCurrency' || field === 'destinationCurrency') && !/^[A-Z]{3}$/.test(value)) {
      throw new TypeError(`capability authority: corridor.${field} must be exactly 3 uppercase letters`);
    }
  }
  if (!isMoney(declaration.costSchedule)) {
    throw new TypeError('capability authority: declaration.costSchedule must be a well-formed Money value (GC-1)');
  }
  if (typeof declaration.tier !== 'string' || declaration.tier.length === 0) {
    throw new TypeError('capability authority: declaration.tier must be a non-empty string');
  }
}

/**
 * The Capability Authority: sole writer of the capability registry and
 * commitment state. Commands: register / activate (compliance-gated) /
 * degrade (invalidates OFFERED commitments) / retire; offer / reserve /
 * consume / release / expire commitments; snapshot (immutable, sequenced).
 *
 * Source: core.md lines 170-172 (owning authority); INV-3-1/2/3 (lines
 * 176-184); lines 186-193 (degradation semantics); lines 197-200
 * (evidence).
 */
export class CapabilityAuthority {
  private readonly evidence: EvidenceSubmission;
  private readonly gate: CapabilityActivationGate;
  private readonly wallClock: () => number;
  private readonly serializer = new KeyedSerializer();
  private readonly capabilities = new Map<string, CapabilityRecord>();
  private readonly accounting = new Map<string, CapabilityAccounting>();
  private readonly commitments = new Map<string, CommitmentRecord>();
  private sequence = 0;
  private snapshotSequence = 0;

  constructor(deps: CapabilityAuthorityDeps) {
    if (deps.evidence === null || typeof deps.evidence !== 'object' || typeof deps.evidence.submit !== 'function') {
      throw new TypeError('capability authority: deps.evidence must be an EvidenceSubmission port');
    }
    if (typeof deps.gate !== 'function') {
      throw new TypeError('capability authority: deps.gate must be the RTN-003 compliance gate function');
    }
    this.evidence = deps.evidence;
    this.gate = deps.gate;
    this.wallClock = deps.wallClock ?? (() => Date.now());
  }

  private nextTime(): ProtocolTime {
    const when = protocolTime(this.sequence, this.wallClock());
    this.sequence += 1;
    return when;
  }

  private accountingOf(capabilityId: string): CapabilityAccounting {
    const accounting = this.accounting.get(capabilityId);
    if (accounting === undefined) {
      throw new TypeError(`capability authority: no accounting for ${capabilityId} (internal consistency)`);
    }
    return accounting;
  }

  // -------------------------------------------------------------------------
  // Capability lifecycle
  // -------------------------------------------------------------------------

  /**
   * Register a capability: REGISTERED, with the declared integer Money
   * capacity bound and zero accounting. Emits CAPABILITY_REGISTERED.
   *
   * Source: core.md lines 154-158 (the advertised ability + states); INV-3-1
   * lines 176-178 (the declared bound); line 197 (evidence).
   */
  async registerCapability(input: {
    readonly capabilityId: string;
    readonly declaration: CapabilityDeclaration;
    readonly declaredCapacity: Money;
  }): Promise<CapabilityCommandResult<CapabilityRecord>> {
    const { capabilityId, declaration, declaredCapacity } = input;
    if (typeof capabilityId !== 'string' || capabilityId.length === 0) {
      throw new TypeError('capability authority: capabilityId must be a non-empty string');
    }
    assertDeclaration(declaration);
    if (!isMoney(declaredCapacity)) {
      throw new TypeError('capability authority: declaredCapacity must be a well-formed Money value (INV-3-1 integer Money bound)');
    }
    if (declaredCapacity.amountMinor < 0) {
      throw new TypeError('capability authority: declaredCapacity must be non-negative minor units');
    }
    return this.serializer.run(`capability:${capabilityId}`, async (): Promise<CapabilityCommandResult<CapabilityRecord>> => {
      if (this.capabilities.has(capabilityId)) {
        return {
          ok: false,
          code: 'ILLEGAL_TRANSITION',
          problem: `capability authority: capability ${capabilityId} is already registered (registration is the entry operation)`,
        };
      }
      const when = this.nextTime();
      const record: CapabilityRecord = deepFreeze({
        capabilityId,
        state: 'REGISTERED',
        declaration: deepFreeze(declaration),
        declaredCapacity,
        reservedTotal: money(declaredCapacity.currency, 0, declaredCapacity.scale),
        consumedTotal: money(declaredCapacity.currency, 0, declaredCapacity.scale),
        createdAt: when,
        stateChangedAt: when,
      });
      await submitCapabilityEvidence(this.evidence, capabilityRegisteredEvidence(record, when));
      this.capabilities.set(capabilityId, record);
      this.accounting.set(capabilityId, initialAccounting(declaredCapacity));
      return { ok: true, record };
    });
  }

  /**
   * Activate a capability: REGISTERED -> ACTIVE, gated by the RTN-003
   * compliance gate (INV-16-3, capability ACTIVATION — "risk gating of
   * capability registration", core.md lines 207-208). A non-allowed verdict
   * blocks the transition with no state change and no evidence.
   *
   * Source: core.md lines 156-157, 207-208; evidence-risk-compliance.md
   * lines 129-131, 140-141.
   */
  async activateCapability(
    capabilityId: string,
    reasonCode?: string,
  ): Promise<CapabilityCommandResult<CapabilityRecord>> {
    if (typeof capabilityId !== 'string' || capabilityId.length === 0) {
      throw new TypeError('capability authority: capabilityId must be a non-empty string');
    }
    return this.serializer.run(`capability:${capabilityId}`, async (): Promise<CapabilityCommandResult<CapabilityRecord>> => {
      const current = this.capabilities.get(capabilityId);
      if (current === undefined) {
        return notFound(capabilityId);
      }
      if (current.state !== 'REGISTERED') {
        return illegalCapability(current, 'ACTIVE');
      }
      const verdict = this.gate(capabilityId);
      if (!verdict.allowed) {
        return {
          ok: false,
          code: 'COMPLIANCE_BLOCKED',
          problem: `capability authority: activation of ${capabilityId} blocked by compliance (INV-16-3 — ${verdict.blockedBy}${verdict.checkId === undefined ? '' : `, check ${verdict.checkId}`}); a terminal APPROVED record for the subject is required`,
        };
      }
      return this.commitCapabilityTransition(current, 'ACTIVE', { reasonCode });
    });
  }

  /**
   * Degrade a capability: ACTIVE -> DEGRADED. "Degraded capabilities
   * accept no new commitments" (enforced in offerCommitment) and "A
   * capability entering DEGRADED invalidates only OFFERED commitments" —
   * each OFFERED commitment of this capability moves to RELEASED with its
   * own COMMITMENT_RELEASED record (capacity arithmetic unchanged: OFFERED
   * holds no capacity). RESERVED commitments survive untouched.
   *
   * Source: core.md lines 157-158, 186-190.
   */
  async degradeCapability(
    capabilityId: string,
    reasonCode?: string,
  ): Promise<CapabilityCommandResult<CapabilityRecord>> {
    if (typeof capabilityId !== 'string' || capabilityId.length === 0) {
      throw new TypeError('capability authority: capabilityId must be a non-empty string');
    }
    return this.serializer.run(`capability:${capabilityId}`, async (): Promise<CapabilityCommandResult<CapabilityRecord>> => {
      const current = this.capabilities.get(capabilityId);
      if (current === undefined) {
        return notFound(capabilityId);
      }
      if (current.state !== 'ACTIVE') {
        return illegalCapability(current, 'DEGRADED');
      }
      // Evidence for the capability transition first (submit-then-commit).
      const when = this.nextTime();
      const transition = transitionCapability(current, 'DEGRADED', when);
      if (!transition.ok) {
        return transition;
      }
      await submitCapabilityEvidence(
        this.evidence,
        capabilityStateChangedEvidence(transition.record, when, {
          ...(reasonCode === undefined ? {} : { reasonCode }),
        }),
      );
      this.capabilities.set(capabilityId, transition.record);
      // Then the OFFERED invalidations, each its own consequential
      // operation with its own record (submit-then-commit per commitment).
      for (const commitment of this.commitmentsByCapability(capabilityId)) {
        if (isInvalidatedByDegradation(commitment)) {
          const invalidated = await this.commitCommitmentTransition(commitment, 'RELEASED');
          if (!invalidated.ok) {
            return invalidated;
          }
        }
      }
      return { ok: true, record: transition.record };
    });
  }

  /**
   * Retire a capability: DEGRADED -> RETIRED (terminal). Retirement is
   * reachable only through DEGRADED (the exact chain); no commitments are
   * invalidated by retirement itself (degradation already handled OFFERED;
   * RESERVED commitments survive until released or expired).
   *
   * Source: core.md lines 156-158 ("Retirement is terminal"), 186-190.
   */
  async retireCapability(
    capabilityId: string,
    reasonCode?: string,
  ): Promise<CapabilityCommandResult<CapabilityRecord>> {
    if (typeof capabilityId !== 'string' || capabilityId.length === 0) {
      throw new TypeError('capability authority: capabilityId must be a non-empty string');
    }
    return this.serializer.run(`capability:${capabilityId}`, async (): Promise<CapabilityCommandResult<CapabilityRecord>> => {
      const current = this.capabilities.get(capabilityId);
      if (current === undefined) {
        return notFound(capabilityId);
      }
      if (current.state !== 'DEGRADED') {
        return illegalCapability(current, 'RETIRED');
      }
      return this.commitCapabilityTransition(current, 'RETIRED', { reasonCode });
    });
  }

  private async commitCapabilityTransition(
    current: CapabilityRecord,
    target: CapabilityRecord['state'],
    options: { readonly reasonCode?: string },
  ): Promise<CapabilityCommandResult<CapabilityRecord>> {
    const when = this.nextTime();
    const transition = transitionCapability(current, target, when);
    if (!transition.ok) {
      return transition;
    }
    await submitCapabilityEvidence(
      this.evidence,
      capabilityStateChangedEvidence(transition.record, when, {
        ...(options.reasonCode === undefined ? {} : { reasonCode: options.reasonCode }),
      }),
    );
    this.capabilities.set(current.capabilityId, transition.record);
    return { ok: true, record: transition.record };
  }

  // -------------------------------------------------------------------------
  // Commitments
  // -------------------------------------------------------------------------

  /**
   * Offer a commitment: the binding promise of capacity for one intent,
   * OFFERED. The commitment id is derived from (intent id, capability id)
   * — INV-3-3: duplicate requests return the recorded commitment state
   * (with COMMITMENT_MISMATCH when the recorded promise's amount or unit
   * differs — one commitment per (intent, capability) is structural in the
   * id). The capability must be ACTIVE ("Degraded capabilities accept no
   * new commitments"; REGISTERED and RETIRED equally refuse). OFFERED holds
   * no capacity — the INV-3-1 bound is checked at reservation. Emits
   * COMMITMENT_OFFERED with the capacity arithmetic of the unchanged
   * accounting.
   *
   * Source: core.md lines 160-163, 157-158; INV-3-3 lines 182-184; lines
   * 198-200 (evidence).
   */
  async offerCommitment(input: {
    readonly intentId: string;
    readonly capabilityId: string;
    readonly amount: Money;
    readonly deadlineEpochMs: number;
  }): Promise<CapabilityCommandResult<CommitmentRecord>> {
    const { intentId, capabilityId, amount, deadlineEpochMs } = input;
    if (typeof intentId !== 'string' || intentId.length === 0) {
      throw new TypeError('capability authority: intentId must be a non-empty string');
    }
    if (typeof capabilityId !== 'string' || capabilityId.length === 0) {
      throw new TypeError('capability authority: capabilityId must be a non-empty string');
    }
    if (!isMoney(amount)) {
      throw new TypeError('capability authority: amount must be a well-formed Money value (GC-1)');
    }
    if (amount.amountMinor <= 0) {
      throw new TypeError('capability authority: amount must be positive minor units (a promise of zero capacity is not a promise)');
    }
    if (typeof deadlineEpochMs !== 'number' || !Number.isInteger(deadlineEpochMs) || !Number.isSafeInteger(deadlineEpochMs)) {
      throw new TypeError('capability authority: deadlineEpochMs must be a safe integer number of epoch milliseconds');
    }
    // INV-3-3: commitment ids are derived from (intent id, capability id).
    const commitmentId = deriveProtocolId('commitment', intentId, capabilityId);
    return this.serializer.run(`capability:${capabilityId}`, async (): Promise<CapabilityCommandResult<CommitmentRecord>> => {
      const capability = this.capabilities.get(capabilityId);
      if (capability === undefined) {
        return commitmentNotFound(commitmentId, capabilityId);
      }
      const existing = this.commitments.get(commitmentId);
      if (existing !== undefined) {
        // INV-3-3: duplicate requests return the recorded commitment state.
        if (
          existing.amount.currency !== amount.currency ||
          existing.amount.scale !== amount.scale ||
          existing.amount.amountMinor !== amount.amountMinor
        ) {
          return {
            ok: false,
            code: 'COMMITMENT_MISMATCH',
            problem: `capability authority: commitment ${commitmentId} is already recorded with amount ${existing.amount.amountMinor} ${existing.amount.currency}; the (intent id, capability id) pair admits exactly one commitment (INV-3-3)`,
          };
        }
        return { ok: true, record: existing };
      }
      if (!acceptsNewCommitments(capability)) {
        return {
          ok: false,
          code: 'NOT_ACTIVE',
          problem: `capability authority: capability ${capabilityId} is ${capability.state} — degraded capabilities accept no new commitments (core.md lines 157-158), and only ACTIVE capabilities serve`,
        };
      }
      if (
        amount.currency !== capability.declaredCapacity.currency ||
        amount.scale !== capability.declaredCapacity.scale
      ) {
        throw new TypeError(
          `capability authority: commitment amount must share the capability's capacity unit ${capability.declaredCapacity.currency}/${capability.declaredCapacity.scale} (got ${amount.currency}/${amount.scale})`,
        );
      }
      const when = this.nextTime();
      const record: CommitmentRecord = deepFreeze({
        commitmentId,
        intentId,
        capabilityId,
        amount,
        state: 'OFFERED',
        deadlineEpochMs,
        createdAt: when,
        stateChangedAt: when,
      });
      await submitCapabilityEvidence(
        this.evidence,
        commitmentEvidence(record, this.accountingOf(capabilityId), when),
      );
      this.commitments.set(commitmentId, record);
      return { ok: true, record };
    });
  }

  /**
   * Reserve a commitment: OFFERED -> RESERVED, taking capacity
   * atomically with the state change (INV-3-2) under the INV-3-1 integer
   * bound — a reservation that would exceed declared capacity is rejected
   * with CAPACITY_EXCEEDED and nothing changes. Emits COMMITMENT_RESERVED
   * with the post-transition capacity arithmetic.
   *
   * Source: core.md lines 160-162 ("RESERVED commitments count against
   * capability capacity"); INV-3-1 lines 176-178; INV-3-2 lines 179-181;
   * lines 198-200 (evidence).
   */
  async reserveCommitment(commitmentId: string): Promise<CapabilityCommandResult<CommitmentRecord>> {
    return this.commitmentCommand(commitmentId, async (commitment) => {
      const accounting = this.accountingOf(commitment.capabilityId);
      const reservation = applyReservation(accounting, commitment.amount);
      if (!reservation.ok) {
        return {
          ok: false,
          code: 'CAPACITY_EXCEEDED',
          problem: reservation.problem,
        };
      }
      const when = this.nextTime();
      const transition = transitionCommitment(commitment, 'RESERVED', when);
      if (!transition.ok) {
        return transition;
      }
      await submitCapabilityEvidence(this.evidence, commitmentEvidence(transition.record, reservation.accounting, when));
      // Atomic with the state change (INV-3-2); the identity is asserted
      // before commit (defense in depth for the property-tested INV-3-1).
      if (!capacityInvariantHolds(reservation.accounting)) {
        throw new TypeError(
          `capability authority: INV-3-1 violated while reserving ${commitmentId} (internal consistency)`,
        );
      }
      this.commitments.set(commitmentId, transition.record);
      this.accounting.set(commitment.capabilityId, reservation.accounting);
      this.capabilities.set(
        commitment.capabilityId,
        this.withTotals(this.capabilities.get(commitment.capabilityId) as CapabilityRecord, reservation.accounting),
      );
      return { ok: true, record: transition.record };
    });
  }

  /**
   * Consume a commitment: RESERVED -> CONSUMED (terminal, exactly once per
   * intent — the second consume attempt is an ILLEGAL_TRANSITION rejection
   * on the terminal state). Capacity moves from reserved to consumed; the
   * committed total is unchanged, so INV-3-1 holds after the transition by
   * construction (asserted before commit). Emits COMMITMENT_CONSUMED with
   * the post-transition capacity arithmetic.
   *
   * Source: core.md lines 160-163 ("CONSUMED is terminal and exactly once
   * per intent"); INV-3-1/INV-3-2; lines 198-200 (evidence).
   */
  async consumeCommitment(commitmentId: string): Promise<CapabilityCommandResult<CommitmentRecord>> {
    return this.commitmentCommand(commitmentId, async (commitment) => {
      const accounting = this.accountingOf(commitment.capabilityId);
      const consumed = applyConsumption(accounting, commitment.amount);
      const when = this.nextTime();
      const transition = transitionCommitment(commitment, 'CONSUMED', when);
      if (!transition.ok) {
        return transition;
      }
      await submitCapabilityEvidence(this.evidence, commitmentEvidence(transition.record, consumed, when));
      if (!capacityInvariantHolds(consumed)) {
        throw new TypeError(
          `capability authority: INV-3-1 violated while consuming ${commitmentId} (internal consistency)`,
        );
      }
      this.commitments.set(commitmentId, transition.record);
      this.accounting.set(commitment.capabilityId, consumed);
      this.capabilities.set(
        commitment.capabilityId,
        this.withTotals(this.capabilities.get(commitment.capabilityId) as CapabilityRecord, consumed),
      );
      return { ok: true, record: transition.record };
    });
  }

  /**
   * Release a commitment: OFFERED | RESERVED -> RELEASED (terminal). A
   * RESERVED release returns capacity (reserved -= amount); an OFFERED
   * release (the degradation invalidation path) holds no capacity to
   * return. Emits COMMITMENT_RELEASED with the post-transition capacity
   * arithmetic.
   *
   * Source: core.md lines 160-163, 188-191 ("released by area 5 rules");
   * lines 198-200 (evidence).
   */
  async releaseCommitment(commitmentId: string): Promise<CapabilityCommandResult<CommitmentRecord>> {
    return this.commitmentCommand(commitmentId, async (commitment) => {
      let accounting = this.accountingOf(commitment.capabilityId);
      if (commitment.state === 'RESERVED') {
        accounting = applyRelease(accounting, commitment.amount);
      }
      const when = this.nextTime();
      const transition = transitionCommitment(commitment, 'RELEASED', when);
      if (!transition.ok) {
        return transition;
      }
      await submitCapabilityEvidence(this.evidence, commitmentEvidence(transition.record, accounting, when));
      if (!capacityInvariantHolds(accounting)) {
        throw new TypeError(
          `capability authority: INV-3-1 violated while releasing ${commitmentId} (internal consistency)`,
        );
      }
      this.commitments.set(commitmentId, transition.record);
      this.accounting.set(commitment.capabilityId, accounting);
      this.capabilities.set(
        commitment.capabilityId,
        this.withTotals(this.capabilities.get(commitment.capabilityId) as CapabilityRecord, accounting),
      );
      return { ok: true, record: transition.record };
    });
  }

  /**
   * Expire a commitment: RESERVED -> EXPIRED, deterministic on protocol
   * time — legal only when the caller's current protocol time has passed
   * the commitment's deadline (NOT_DUE otherwise). Emits
   * COMMITMENT_EXPIRED with the post-transition capacity arithmetic.
   *
   * Source: core.md lines 190-191 ("expired by deadline"); kernel time.ts
   * ("expiry is deterministic on protocol time", area 5 lines 290-291);
   * lines 198-200 (evidence).
   */
  async expireCommitment(commitmentId: string, wallMs: number): Promise<CapabilityCommandResult<CommitmentRecord>> {
    if (typeof wallMs !== 'number' || !Number.isInteger(wallMs) || !Number.isSafeInteger(wallMs)) {
      throw new TypeError('capability authority: wallMs must be a safe integer number of epoch milliseconds');
    }
    return this.commitmentCommand(commitmentId, async (commitment) => {
      if (commitment.state !== 'RESERVED') {
        const rejection = transitionCommitment(commitment, 'EXPIRED', this.nextTime());
        if (!rejection.ok) {
          return rejection;
        }
      }
      if (!isExpiredAt(commitment, wallMs)) {
        return {
          ok: false,
          code: 'NOT_DUE',
          problem: `capability authority: commitment ${commitmentId} deadline ${commitment.deadlineEpochMs} has not passed at ${wallMs} (expiry is deterministic on protocol time)`,
        };
      }
      const accounting = applyRelease(this.accountingOf(commitment.capabilityId), commitment.amount);
      const when = this.nextTime();
      const transition = transitionCommitment(commitment, 'EXPIRED', when);
      if (!transition.ok) {
        return transition;
      }
      await submitCapabilityEvidence(this.evidence, commitmentEvidence(transition.record, accounting, when));
      if (!capacityInvariantHolds(accounting)) {
        throw new TypeError(
          `capability authority: INV-3-1 violated while expiring ${commitmentId} (internal consistency)`,
        );
      }
      this.commitments.set(commitmentId, transition.record);
      this.accounting.set(commitment.capabilityId, accounting);
      this.capabilities.set(
        commitment.capabilityId,
        this.withTotals(this.capabilities.get(commitment.capabilityId) as CapabilityRecord, accounting),
      );
      return { ok: true, record: transition.record };
    });
  }

  private withTotals(capability: CapabilityRecord, accounting: CapabilityAccounting): CapabilityRecord {
    return deepFreeze({
      ...capability,
      reservedTotal: accounting.reserved,
      consumedTotal: accounting.consumed,
    });
  }

  private async commitmentCommand(
    commitmentId: string,
    operation: (commitment: CommitmentRecord) => Promise<CapabilityCommandResult<CommitmentRecord>>,
  ): Promise<CapabilityCommandResult<CommitmentRecord>> {
    if (typeof commitmentId !== 'string' || commitmentId.length === 0) {
      throw new TypeError('capability authority: commitmentId must be a non-empty string');
    }
    const commitment = this.commitments.get(commitmentId);
    if (commitment === undefined) {
      return commitmentNotFound(commitmentId, undefined);
    }
    // INV-3-2: serialized per capability (subsumes per-(capability, intent));
    // the accounting check-then-update inside the operation is atomic.
    return this.serializer.run(`capability:${commitment.capabilityId}`, () => operation(commitment));
  }

  private async commitCommitmentTransition(
    commitment: CommitmentRecord,
    target: CommitmentRecord['state'],
  ): Promise<CapabilityCommandResult<CommitmentRecord>> {
    let accounting = this.accountingOf(commitment.capabilityId);
    if (commitment.state === 'RESERVED' && target === 'RELEASED') {
      accounting = applyRelease(accounting, commitment.amount);
    }
    const when = this.nextTime();
    const transition = transitionCommitment(commitment, target, when);
    if (!transition.ok) {
      return transition;
    }
    await submitCapabilityEvidence(this.evidence, commitmentEvidence(transition.record, accounting, when));
    if (!capacityInvariantHolds(accounting)) {
      throw new TypeError(
        `capability authority: INV-3-1 violated during ${commitment.state} -> ${target} on ${commitment.commitmentId} (internal consistency)`,
      );
    }
    this.commitments.set(commitment.commitmentId, transition.record);
    this.accounting.set(commitment.capabilityId, accounting);
    this.capabilities.set(
      commitment.capabilityId,
      this.withTotals(this.capabilities.get(commitment.capabilityId) as CapabilityRecord, accounting),
    );
    return { ok: true, record: transition.record };
  }

  private commitmentsByCapability(capabilityId: string): CommitmentRecord[] {
    return [...this.commitments.values()].filter(
      (commitment) => commitment.capabilityId === capabilityId,
    );
  }

  // -------------------------------------------------------------------------
  // Snapshot (immutable, sequenced) and reads
  // -------------------------------------------------------------------------

  /**
   * Mint the CapabilitySnapshot: the immutable, sequenced view of all
   * capabilities at a point in protocol time (the current recorded state
   * and capacity accounting of every capability, including the available
   * capacity the INV-3-1 identity implies). The snapshot is deep-frozen at
   * mint; later authority mutations never change a previously obtained
   * snapshot (copy-on-write state).
   *
   * Source: core.md lines 165-166 — "CapabilitySnapshot — immutable,
   * sequenced view of all capabilities at a point in protocol time;
   * consumed by policy evaluation and routing."
   */
  snapshot(): CapabilitySnapshot {
    const sequence = this.snapshotSequence;
    this.snapshotSequence += 1;
    const wallMs = this.wallClock();
    const entries: CapabilitySnapshotEntry[] = [...this.capabilities.values()]
      .sort((a, b) => (a.capabilityId < b.capabilityId ? -1 : a.capabilityId > b.capabilityId ? 1 : 0))
      .map((capability) => {
        const accounting = this.accountingOf(capability.capabilityId);
        return deepFreeze({
          capabilityId: capability.capabilityId,
          railId: capability.declaration.railId,
          corridor: capability.declaration.corridor,
          state: capability.state,
          declaredCapacity: capability.declaredCapacity,
          reservedTotal: accounting.reserved,
          consumedTotal: accounting.consumed,
          availableCapacity: availableCapacity(accounting),
          costSchedule: capability.declaration.costSchedule,
          tier: capability.declaration.tier,
        });
      });
    return deepFreeze({
      snapshotId: deriveProtocolId('capability-snapshot', sequence),
      sequence,
      wallMs,
      capabilities: Object.freeze(entries),
    });
  }

  /** The recorded capability by id, if any. Source: core.md lines 170-172 (sole writer of the state callers read). */
  getCapability(capabilityId: string): CapabilityRecord | undefined {
    return this.capabilities.get(capabilityId);
  }

  /** The recorded commitment by id, if any (the INV-3-3 lookup). */
  getCommitment(commitmentId: string): CommitmentRecord | undefined {
    return this.commitments.get(commitmentId);
  }

  /** All recorded commitments, in creation (insertion) order. */
  listCommitments(): readonly CommitmentRecord[] {
    return [...this.commitments.values()];
  }

  /** The capacity accounting of a capability (the INV-3-1 triple). */
  getAccounting(capabilityId: string): CapabilityAccounting | undefined {
    return this.accounting.get(capabilityId);
  }
}

function notFound(capabilityId: string): CapabilityCommandResult<CapabilityRecord> {
  return {
    ok: false,
    code: 'CAPABILITY_NOT_FOUND',
    problem: `capability authority: capability ${capabilityId} is not registered`,
  };
}

function commitmentNotFound(
  commitmentId: string,
  capabilityId: string | undefined,
): CapabilityCommandResult<CommitmentRecord> {
  return {
    ok: false,
    code: 'COMMITMENT_NOT_FOUND',
    problem: `capability authority: commitment ${commitmentId} is not recorded${capabilityId === undefined ? '' : ` (capability ${capabilityId})`}`,
  };
}

function illegalCapability(
  current: CapabilityRecord,
  target: CapabilityRecord['state'],
): CapabilityCommandResult<CapabilityRecord> {
  return {
    ok: false,
    code: 'ILLEGAL_TRANSITION',
    problem: `capability authority: illegal one-way transition ${current.state} -> ${target} on capability ${current.capabilityId} (core.md A03 lines 156-157)`,
  };
}
