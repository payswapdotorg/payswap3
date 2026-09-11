/**
 * RTN-005 — Capability Authority: the A03 type vocabulary, state machine
 * tables, and runtime guards.
 *
 * Spec sources (binding) — spec/architecture/v0.1/core.md §3 Area 3:
 *   lines 154-158 (Capability — the object and state machine, verbatim):
 *     "Capability — advertised ability: rail id, corridor (source/destination
 *      currencies and geographies), capacity limits, cost schedule, tier.
 *      States: REGISTERED -> ACTIVE -> DEGRADED -> RETIRED.
 *      Degraded capabilities accept no new commitments. Retirement is
 *      terminal."
 *   lines 160-163 (Commitment):
 *     "Commitment — binding promise of capacity for one intent.
 *      States: OFFERED -> RESERVED -> CONSUMED | EXPIRED | RELEASED.
 *      RESERVED commitments count against capability capacity; CONSUMED is
 *      terminal and exactly once per intent."
 *   lines 165-166 (CapabilitySnapshot):
 *     "CapabilitySnapshot — immutable, sequenced view of all capabilities at
 *      a point in protocol time; consumed by policy evaluation and routing."
 *   lines 176-184 (INV-3-1/INV-3-2/INV-3-3):
 *     "INV-3-1 (financial correctness): capacity limits are integer Money
 *      bounds; sum of RESERVED and CONSUMED commitments never exceeds the
 *      capability's declared capacity.
 *      INV-3-2 (concurrency): commitment transitions are serialized per
 *      (capability, intent); capacity accounting is updated atomically with
 *      commitment state.
 *      INV-3-3 (idempotency): commitment ids are derived from
 *      (intent id, capability id); duplicate requests return the recorded
 *      commitment state."
 *   lines 186-193 (failure semantics — degraded invalidates only OFFERED;
 *   RESERVED survives; no UNKNOWN; stale attestations ignored by sequence).
 *   lines 197-200 (evidence produced — CAPABILITY_REGISTERED /
 *   CAPABILITY_STATE_CHANGED / COMMITMENT_OFFERED / COMMITMENT_RESERVED /
 *   COMMITMENT_CONSUMED / COMMITMENT_RELEASED / COMMITMENT_EXPIRED, "each
 *   with capacity arithmetic in the proof field").
 *   lines 202-208 (boundaries: "The registry never initiates rail
 *   operations"; "Commitments are capacity promises, not ledger entries";
 *   "Depends on area 15 for evidence and area 16 for risk gating of
 *   capability registration").
 *   spec/architecture/v0.1/README.md §3 GC-1/GC-4/GC-5.
 *   spec/registry/protocol-registry.json A03 — owningAuthority:
 *   "Capability Authority".
 */

import type { Money } from '../kernel/money.ts';
import type { ProtocolTime } from '../kernel/time.ts';

/**
 * True iff the (from, to) pair is a legal one-way Capability transition.
 *
 * Source: core.md lines 156-157 (the chain).
 */
export function canTransitionCapability(from: CapabilityState, to: CapabilityState): boolean {
  return CAPABILITY_TRANSITIONS[from].includes(to);
}

/**
 * True iff the (from, to) pair is a legal one-way Commitment transition.
 *
 * Source: core.md lines 160-163 (the machine, with the degradation-driven
 * OFFERED -> RELEASED edge of lines 188-190).
 */
export function canTransitionCommitment(from: CommitmentState, to: CommitmentState): boolean {
  return COMMITMENT_TRANSITIONS[from].includes(to);
}

/**
 * The Capability state vocabulary, verbatim from v0.1.
 *
 * Source: core.md lines 156-157 — "States: REGISTERED -> ACTIVE ->
 * DEGRADED -> RETIRED."
 */
export const CAPABILITY_STATES: readonly [
  'REGISTERED',
  'ACTIVE',
  'DEGRADED',
  'RETIRED',
] = Object.freeze(['REGISTERED', 'ACTIVE', 'DEGRADED', 'RETIRED'] as const);

/**
 * A Capability state. RETIRED is terminal ("Retirement is terminal").
 * DEGRADED capabilities accept no new commitments (lines 157-158).
 *
 * Source: core.md lines 156-158.
 */
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

/**
 * The frozen one-way Capability transition table — the exact chain, no
 * shortcuts: RETIRED is reachable only from DEGRADED, REGISTERED only
 * becomes ACTIVE.
 *
 * Source: core.md lines 156-157 ("REGISTERED -> ACTIVE -> DEGRADED ->
 * RETIRED").
 */
export const CAPABILITY_TRANSITIONS: Readonly<Record<CapabilityState, readonly CapabilityState[]>> =
  Object.freeze({
    REGISTERED: Object.freeze(['ACTIVE'] as const),
    ACTIVE: Object.freeze(['DEGRADED'] as const),
    DEGRADED: Object.freeze(['RETIRED'] as const),
    RETIRED: Object.freeze([] as const),
  });

/**
 * Runtime type guard for CapabilityState.
 *
 * Source: core.md lines 156-157 (the vocabulary this guard re-checks).
 */
export function isCapabilityState(value: unknown): value is CapabilityState {
  return typeof value === 'string' && (CAPABILITY_STATES as readonly string[]).includes(value);
}

/**
 * The Commitment state vocabulary, verbatim from v0.1.
 *
 * Source: core.md line 161 — "States: OFFERED -> RESERVED -> CONSUMED |
 * EXPIRED | RELEASED."
 */
export const COMMITMENT_STATES: readonly [
  'OFFERED',
  'RESERVED',
  'CONSUMED',
  'EXPIRED',
  'RELEASED',
] = Object.freeze(['OFFERED', 'RESERVED', 'CONSUMED', 'EXPIRED', 'RELEASED'] as const);

/**
 * A Commitment state. CONSUMED is terminal ("CONSUMED is terminal and
 * exactly once per intent", core.md lines 162-163); EXPIRED and RELEASED
 * are the other terminals of the machine.
 *
 * Source: core.md lines 160-163.
 */
export type CommitmentState = (typeof COMMITMENT_STATES)[number];

/**
 * The frozen Commitment transition table. The machine's chain is
 * OFFERED -> RESERVED -> terminal(CONSUMED | EXPIRED | RELEASED); the
 * additional OFFERED -> RELEASED edge materializes "A capability entering
 * DEGRADED invalidates only OFFERED commitments" (core.md lines 188-190):
 * an invalidated offer is a promise no longer binding, which is exactly the
 * RELEASED terminal (no capacity was ever held for an OFFERED commitment —
 * line 162: "RESERVED commitments count against capability capacity").
 * Interpretation recorded in CONTRACT-REVIEW.md.
 *
 * Source: core.md lines 160-163 (the machine), 188-190 (degradation
 * semantics).
 */
export const COMMITMENT_TRANSITIONS: Readonly<Record<CommitmentState, readonly CommitmentState[]>> =
  Object.freeze({
    OFFERED: Object.freeze(['RESERVED', 'RELEASED'] as const),
    RESERVED: Object.freeze(['CONSUMED', 'EXPIRED', 'RELEASED'] as const),
    CONSUMED: Object.freeze([] as const),
    EXPIRED: Object.freeze([] as const),
    RELEASED: Object.freeze([] as const),
  });

/**
 * Runtime type guard for CommitmentState.
 *
 * Source: core.md line 161 (the vocabulary this guard re-checks).
 */
export function isCommitmentState(value: unknown): value is CommitmentState {
  return typeof value === 'string' && (COMMITMENT_STATES as readonly string[]).includes(value);
}

/**
 * The corridor — "source/destination currencies and geographies" (the
 * matching key policy evaluation and routing consume).
 *
 * Source: core.md lines 154-155 — "corridor (source/destination currencies
 * and geographies)".
 */
export interface Corridor {
  readonly sourceCurrency: string;
  readonly destinationCurrency: string;
  readonly sourceGeography: string;
  readonly destinationGeography: string;
}

/**
 * The Capability declaration — the advertised ability, exactly the four
 * named fields: rail id, corridor, capacity limits (carried on the
 * CapabilityRecord as declaredCapacity), cost schedule, tier.
 *
 * Source: core.md lines 154-155 — "advertised ability: rail id, corridor
 * (...), capacity limits, cost schedule, tier."
 */
export interface CapabilityDeclaration {
  /** The rail this capability rides (matched against policy allowed rails). */
  readonly railId: string;
  /** The corridor (source/destination currencies and geographies). */
  readonly corridor: Corridor;
  /** The cost schedule as a kernel Money value (integer minor units). */
  readonly costSchedule: Money;
  /** The service tier (a deterministic ranking key for policy ordering). */
  readonly tier: string;
}

/**
 * Capability — the advertised ability as recorded by the authority, with
 * its capacity accounting (INV-3-1's integer Money identity:
 * reservedTotal + consumedTotal <= declaredCapacity at all times).
 *
 * Source: core.md lines 154-158 (object + states); INV-3-1 lines 176-178.
 */
export interface CapabilityRecord {
  readonly capabilityId: string;
  readonly state: CapabilityState;
  readonly declaration: CapabilityDeclaration;
  /** Declared capacity — the integer Money bound of INV-3-1. */
  readonly declaredCapacity: Money;
  /** Sum of RESERVED commitment amounts (integer Money). */
  readonly reservedTotal: Money;
  /** Sum of CONSUMED commitment amounts (integer Money). */
  readonly consumedTotal: Money;
  readonly createdAt: ProtocolTime;
  readonly stateChangedAt: ProtocolTime;
}

/**
 * Commitment — the binding promise of capacity for one intent, with its id
 * derived from (intent id, capability id) (INV-3-3) and its deadline (the
 * deterministic expiry input).
 *
 * Source: core.md lines 160-163; INV-3-3 lines 182-184; area 3 lines
 * 190-191 ("RESERVED commitments remain valid until released by area 5
 * rules or expired by deadline").
 */
export interface CommitmentRecord {
  /** deriveProtocolId('commitment', intentId, capabilityId) — INV-3-3. */
  readonly commitmentId: string;
  readonly intentId: string;
  readonly capabilityId: string;
  /** The promised capacity — a kernel Money value in the capability's unit. */
  readonly amount: Money;
  readonly state: CommitmentState;
  /** Expiry deadline in integer epoch milliseconds (deterministic on protocol time). */
  readonly deadlineEpochMs: number;
  readonly createdAt: ProtocolTime;
  readonly stateChangedAt: ProtocolTime;
}

/**
 * One capability's view inside a CapabilitySnapshot — the immutable,
 * sequenced projection of the registry at a point in protocol time,
 * including the capacity accounting policy evaluation feasibility-checks
 * against (availableCapacity = declaredCapacity - reservedTotal -
 * consumedTotal, the INV-3-1 identity rearranged).
 *
 * Source: core.md lines 165-166 ("immutable, sequenced view of all
 * capabilities at a point in protocol time; consumed by policy evaluation
 * and routing"); INV-3-1 lines 176-178.
 */
export interface CapabilitySnapshotEntry {
  readonly capabilityId: string;
  readonly railId: string;
  readonly corridor: Corridor;
  readonly state: CapabilityState;
  readonly declaredCapacity: Money;
  readonly reservedTotal: Money;
  readonly consumedTotal: Money;
  readonly availableCapacity: Money;
  readonly costSchedule: Money;
  readonly tier: string;
}

/**
 * CapabilitySnapshot — immutable, sequenced view of all capabilities at a
 * point in protocol time. The snapshotId is derived from the sequence
 * position (deterministic); the sequence is the authority's monotonic
 * snapshot counter; wallMs is the recorded wall time of the view.
 *
 * Source: core.md lines 165-166; A15 line 28 ("when: protocol time
 * (sequenced) and recorded wall time").
 */
export interface CapabilitySnapshot {
  readonly snapshotId: string;
  readonly sequence: number;
  readonly wallMs: number;
  readonly capabilities: readonly CapabilitySnapshotEntry[];
}

/**
 * The typed rejection codes of the Capability Authority's command surface
 * (domain rejections are typed values, never thrown — the merged rails
 * command convention). Rejections emit NO evidence: a refused command
 * mutates no state, and A03's named evidence set is exhaustive.
 *
 * Source: core.md lines 197-200 (the exhaustive named set); the rails
 * typed-rejection convention.
 */
export const CAPABILITY_REJECTION_CODES: readonly [
  'CAPABILITY_NOT_FOUND',
  'COMMITMENT_NOT_FOUND',
  'ILLEGAL_TRANSITION',
  'NOT_ACTIVE',
  'COMPLIANCE_BLOCKED',
  'CAPACITY_EXCEEDED',
  'COMMITMENT_MISMATCH',
  'NOT_DUE',
] = Object.freeze([
  'CAPABILITY_NOT_FOUND',
  'COMMITMENT_NOT_FOUND',
  'ILLEGAL_TRANSITION',
  'NOT_ACTIVE',
  'COMPLIANCE_BLOCKED',
  'CAPACITY_EXCEEDED',
  'COMMITMENT_MISMATCH',
  'NOT_DUE',
] as const);

/** A Capability Authority rejection code. Source: the frozen list above. */
export type CapabilityRejectionCode = (typeof CAPABILITY_REJECTION_CODES)[number];

/**
 * The outcome of a capability or commitment command: the updated record on
 * success; a typed rejection code with a deterministic problem description
 * on refusal.
 *
 * Source: core.md lines 154-163 (the state machines the commands drive);
 * INV-3-1/INV-3-2/INV-3-3 (the invariants the guards enforce).
 */
export type CapabilityCommandResult<T> =
  | {
      readonly ok: true;
      readonly record: T;
    }
  | {
      readonly ok: false;
      readonly code: CapabilityRejectionCode;
      readonly problem: string;
    };
