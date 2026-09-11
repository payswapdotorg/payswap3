/**
 * RTN-005 — Capability Authority: pure state-machine application over
 * Capability and Commitment records.
 *
 * Spec sources (binding) — spec/architecture/v0.1/core.md §3 Area 3:
 *   lines 156-158 (Capability state machine):
 *     "States: REGISTERED -> ACTIVE -> DEGRADED -> RETIRED.
 *      Degraded capabilities accept no new commitments. Retirement is
 *      terminal."
 *   lines 160-163 (Commitment state machine):
 *     "States: OFFERED -> RESERVED -> CONSUMED | EXPIRED | RELEASED.
 *      RESERVED commitments count against capability capacity; CONSUMED is
 *      terminal and exactly once per intent."
 *   lines 186-193 (failure and UNKNOWN semantics):
 *     "A capability entering DEGRADED invalidates only OFFERED commitments;
 *      RESERVED commitments remain valid until released by area 5 rules or
 *      expired by deadline."
 *
 * This module is PURE: (record, target) -> updated record | typed
 * rejection; no store, no clock, no evidence port, no capacity accounting
 * (accounting lives in capacity.ts and the authority composes both).
 */

import type { ProtocolTime } from '../kernel/time.ts';
import type {
  CapabilityRecord,
  CapabilityState,
  CapabilityCommandResult,
  CommitmentRecord,
  CommitmentState,
} from './types.ts';
import { canTransitionCapability, canTransitionCommitment } from './types.ts';

/**
 * Apply one Capability state transition — pure. Returns the updated record
 * or the typed ILLEGAL_TRANSITION rejection (covers every post-terminal
 * attempt and every shortcut off the chain, e.g. REGISTERED -> DEGRADED).
 *
 * Source: core.md lines 156-157 ("REGISTERED -> ACTIVE -> DEGRADED ->
 * RETIRED"); line 158 ("Retirement is terminal").
 */
export function transitionCapability(
  capability: CapabilityRecord,
  target: CapabilityState,
  at: ProtocolTime,
): CapabilityCommandResult<CapabilityRecord> {
  if (!canTransitionCapability(capability.state, target)) {
    return {
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      problem: `capability ${capability.capabilityId}: illegal one-way transition ${capability.state} -> ${target} (core.md A03 lines 156-157; retirement is terminal)`,
    };
  }
  return {
    ok: true,
    record: { ...capability, state: target, stateChangedAt: at },
  };
}

/**
 * Apply one Commitment state transition — pure. Returns the updated record
 * or the typed ILLEGAL_TRANSITION rejection (covers every post-terminal
 * attempt — CONSUMED, EXPIRED, RELEASED are terminal — and OFFERED ->
 * CONSUMED, which the machine does not contain).
 *
 * Source: core.md lines 160-163 (the machine; "CONSUMED is terminal and
 * exactly once per intent").
 */
export function transitionCommitment(
  commitment: CommitmentRecord,
  target: CommitmentState,
  at: ProtocolTime,
): CapabilityCommandResult<CommitmentRecord> {
  if (!canTransitionCommitment(commitment.state, target)) {
    return {
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      problem: `commitment ${commitment.commitmentId}: illegal one-way transition ${commitment.state} -> ${target} (core.md A03 lines 160-163; CONSUMED, EXPIRED, and RELEASED are terminal)`,
    };
  }
  return {
    ok: true,
    record: { ...commitment, state: target, stateChangedAt: at },
  };
}

/**
 * Whether the capability accepts a NEW commitment: exactly ACTIVE does
 * ("Degraded capabilities accept no new commitments", core.md lines
 * 157-158; REGISTERED is not yet serving, RETIRED is terminal).
 *
 * Source: core.md lines 156-158.
 */
export function acceptsNewCommitments(capability: CapabilityRecord): boolean {
  return capability.state === 'ACTIVE';
}

/**
 * Whether a commitment is invalidated by its capability entering DEGRADED:
 * exactly OFFERED commitments are ("A capability entering DEGRADED
 * invalidates only OFFERED commitments; RESERVED commitments remain valid
 * until released by area 5 rules or expired by deadline", core.md lines
 * 188-190).
 *
 * Source: core.md lines 188-190.
 */
export function isInvalidatedByDegradation(commitment: CommitmentRecord): boolean {
  return commitment.state === 'OFFERED';
}

/**
 * Whether a RESERVED commitment is expired at the given protocol wall
 * time: the deadline has passed ("expired by deadline" — deterministic on
 * protocol time, core.md lines 190-191).
 *
 * Source: core.md lines 190-191; area 3 line 165 (snapshot "at a point in
 * protocol time").
 */
export function isExpiredAt(commitment: CommitmentRecord, wallMs: number): boolean {
  return wallMs >= commitment.deadlineEpochMs;
}
