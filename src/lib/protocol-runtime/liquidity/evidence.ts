/**
 * RTN-007 — Liquidity Authority: A06 evidence emission through the
 * kernel-declared EvidenceSubmission port, to the REAL A15 log (RTN-002,
 * merged at this item's base).
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §1 Area 6, lines
 *   71-75 (the complete named evidence set of the area):
 *     "Evidence produced
 *      - POOL_OPENED, POOL_FROZEN, POOL_CLOSED.
 *      - POSITION_STATE_CHANGED (with post-transition arithmetic proof).
 *      - FUNDING_RECORDED (linked rail operation id or internal transfer
 *        id)."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   26-32 (the exact five-slot record shape) and lines 62-64 (the
 *   synchronous coupling: "an operation is not committed until its record
 *   is written. A failed write fails the operation").
 *   spec/architecture/v0.1/README.md §3 GC-5 lines 63-67 (exactly one
 *   record per consequential operation).
 *   spec/registry/protocol-registry.json A06 — owningAuthority:
 *     "Liquidity Authority" (the 'authority' slot value; validated by the
 *     real log against EVIDENCE_AUTHORITIES).
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - One record per consequential transition, exactly the named set:
 *     each pool state transition writes its own POOL_* record; every
 *     position state change (including the funding-time creation into
 *     AVAILABLE — the position's first state) writes POSITION_STATE_CHANGED
 *     with the post-transition INV-6-1 arithmetic hash in proof.hashes and
 *     the driving ledger entry's per-resource sequence in
 *     proof.sequenceNumbers; every FundingEntry creation writes
 *     FUNDING_RECORDED with the linked rail operation id / internal
 *     transfer id among the subject ids.
 *   - Rejections and duplicate observations emit NO record (a refused or
 *     no-effect command mutates no state; A06's named set is exhaustive —
 *     the RTN-005/RTN-006 precedent).
 *   - what.subjectIds: the object ids the record is about (pool id;
 *     position id + pool id + reservation id where one drove the
 *     transition; funding entry id + pool id + position id + the linked
 *     source reference id).
 */

import type {
  EvidenceSubmission,
  EvidenceSubmissionRecord,
} from '../kernel/ports.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { isProtocolTime } from '../kernel/time.ts';
import { positionArithmeticIdentityHash } from './accounting.ts';
import type { PositionFold } from './accounting.ts';
import type {
  FundingEntryRecord,
  LiquidityPoolRecord,
  LiquidityReasonCode,
  LiquidityPositionRecord,
} from './types.ts';

/**
 * The authority identity recorded in the 'authority' slot of A06's
 * records — the registry's owning authority name for area 6.
 *
 * Source: spec/registry/protocol-registry.json A06 — "owningAuthority":
 * "Liquidity Authority".
 */
export const LIQUIDITY_AUTHORITY_ID = 'Liquidity Authority';

/**
 * The A06 evidence operation-type vocabulary — exactly the five named
 * types, frozen (no inventions).
 *
 * Source: liquidity-credit-queues.md lines 71-75 (the named set quoted in
 * the module doc).
 */
export const LIQUIDITY_EVIDENCE_VOCABULARY = Object.freeze({
  poolOpenedOperationType: 'POOL_OPENED',
  poolFrozenOperationType: 'POOL_FROZEN',
  poolClosedOperationType: 'POOL_CLOSED',
  positionStateChangedOperationType: 'POSITION_STATE_CHANGED',
  fundingRecordedOperationType: 'FUNDING_RECORDED',
} as const);

function assertWhen(when: unknown): asserts when is ProtocolTime {
  if (!isProtocolTime(when)) {
    throw new TypeError('liquidity evidence: when must be a well-formed ProtocolTime');
  }
}

/**
 * Build one POOL_* record. Slot mapping: what.subjectIds = [poolId];
 * outcome = the new state with its grounded reason code;
 * proof.sequenceNumbers = [the pool's stored total] — the INV-6-1
 * left-hand side at the transition (the identity the pool-side check
 * recomputes against the integer sum of positions).
 *
 * Source: liquidity-credit-queues.md lines 71-73; A15 lines 26-32; GC-5.
 */
export function poolStateEvidence(input: {
  readonly operationType: string;
  readonly pool: LiquidityPoolRecord;
  readonly requiredState: 'OPEN' | 'FROZEN' | 'CLOSED';
  readonly when: ProtocolTime;
  readonly reasonCode: LiquidityReasonCode;
}): EvidenceSubmissionRecord {
  const { operationType, pool, requiredState, when, reasonCode } = input;
  assertWhen(when);
  if (pool.state !== requiredState) {
    throw new TypeError(
      `liquidity evidence: ${operationType} requires the pool in ${requiredState} (got ${pool.state})`,
    );
  }
  return {
    what: {
      operationType,
      subjectIds: [pool.poolId],
    },
    when,
    authority: LIQUIDITY_AUTHORITY_ID,
    outcome: {
      result: requiredState,
      reasonCode,
    },
    proof: {
      sequenceNumbers: [pool.totalMinor],
    },
  };
}

/**
 * Build the POOL_OPENED record — the pool's creation (state OPEN).
 *
 * Source: liquidity-credit-queues.md line 73 ("POOL_OPENED"); A15 lines
 * 26-32; GC-5.
 */
export function poolOpenedEvidence(input: {
  readonly pool: LiquidityPoolRecord;
  readonly when: ProtocolTime;
}): EvidenceSubmissionRecord {
  return poolStateEvidence({
    operationType: LIQUIDITY_EVIDENCE_VOCABULARY.poolOpenedOperationType,
    requiredState: 'OPEN',
    reasonCode: 'POOL_OPENED',
    ...input,
  });
}

/**
 * Build the POOL_FROZEN record — OPEN -> FROZEN ("Frozen pools accept no
 * new reservations").
 *
 * Source: liquidity-credit-queues.md line 73 ("POOL_FROZEN"); lines 33-35
 * (the freeze semantics); A15 lines 26-32; GC-5.
 */
export function poolFrozenEvidence(input: {
  readonly pool: LiquidityPoolRecord;
  readonly when: ProtocolTime;
}): EvidenceSubmissionRecord {
  return poolStateEvidence({
    operationType: LIQUIDITY_EVIDENCE_VOCABULARY.poolFrozenOperationType,
    requiredState: 'FROZEN',
    reasonCode: 'POOL_FROZEN_NO_NEW_RESERVATIONS',
    ...input,
  });
}

/**
 * Build the POOL_CLOSED record — FROZEN -> CLOSED (terminal, after all
 * positions settle).
 *
 * Source: liquidity-credit-queues.md line 73 ("POOL_CLOSED"); lines 33-35
 * (the closure semantics); A15 lines 26-32; GC-5.
 */
export function poolClosedEvidence(input: {
  readonly pool: LiquidityPoolRecord;
  readonly when: ProtocolTime;
}): EvidenceSubmissionRecord {
  return poolStateEvidence({
    operationType: LIQUIDITY_EVIDENCE_VOCABULARY.poolClosedOperationType,
    requiredState: 'CLOSED',
    reasonCode: 'POOL_CLOSED_ALL_POSITIONS_SETTLED',
    ...input,
  });
}

/**
 * Build the POSITION_STATE_CHANGED record. Slot mapping:
 * what.subjectIds = [positionId, poolId, reservationId?] (the driving
 * area-5 reservation when one exists); outcome = the new state with the
 * driving ledger-event reason code; proof.hashes = the post-transition
 * INV-6-1 arithmetic-identity hash; proof.sequenceNumbers = [the driving
 * ledger entry's per-resource sequence, the position's stored total].
 *
 * Source: liquidity-credit-queues.md lines 73-74 ("POSITION_STATE_CHANGED
 * (with post-transition arithmetic proof)"); lines 38-39 (the driving
 * reservations); A15 lines 26-32; GC-5.
 */
export function positionStateChangedEvidence(input: {
  readonly position: LiquidityPositionRecord;
  readonly fold: PositionFold;
  readonly when: ProtocolTime;
  readonly reasonCode: LiquidityReasonCode;
  /** The driving reservation id (position-funded transitions carry none). */
  readonly reservationId?: string;
  /** The driving ledger entry's per-resource sequence (ledger-driven transitions). */
  readonly resourceSequence?: number;
}): EvidenceSubmissionRecord {
  const { position, fold, when, reasonCode, reservationId, resourceSequence } = input;
  assertWhen(when);
  if (position.state !== fold.state) {
    throw new TypeError(
      `liquidity evidence: POSITION_STATE_CHANGED requires the record state (${position.state}) ` +
        `to match the folded state (${fold.state})`,
    );
  }
  if (fold.total.amountMinor !== position.total.amountMinor) {
    throw new TypeError(
      'liquidity evidence: the fold total and the record total disagree (INV-6-1)',
    );
  }
  return {
    what: {
      operationType: LIQUIDITY_EVIDENCE_VOCABULARY.positionStateChangedOperationType,
      subjectIds:
        reservationId === undefined
          ? [position.positionId, position.poolId]
          : [position.positionId, position.poolId, reservationId],
    },
    when,
    authority: LIQUIDITY_AUTHORITY_ID,
    outcome: {
      result: position.state,
      reasonCode,
    },
    proof: {
      hashes: [positionArithmeticIdentityHash(fold)],
      sequenceNumbers:
        resourceSequence === undefined
          ? [position.total.amountMinor]
          : [resourceSequence, position.total.amountMinor],
    },
  };
}

/**
 * Build the FUNDING_RECORDED record. Slot mapping: what.subjectIds =
 * [fundingEntryId, poolId, positionId, source.referenceId] — "FUNDING_
 * RECORDED (linked rail operation id or internal transfer id)"; outcome =
 * RECORDED with the source-kind reason; proof.hashes = the INV-6-1
 * arithmetic identity hash of the funded position's zero fold (the
 * post-funding arithmetic proof).
 *
 * Source: liquidity-credit-queues.md lines 74-75 ("FUNDING_RECORDED
 * (linked rail operation id or internal transfer id)"); lines 40-43 (the
 * two source kinds); A15 lines 26-32; GC-5.
 */
export function fundingRecordedEvidence(input: {
  readonly entry: FundingEntryRecord;
  readonly fundedFold: PositionFold;
  readonly when: ProtocolTime;
}): EvidenceSubmissionRecord {
  const { entry, fundedFold, when } = input;
  assertWhen(when);
  return {
    what: {
      operationType: LIQUIDITY_EVIDENCE_VOCABULARY.fundingRecordedOperationType,
      subjectIds: [entry.fundingEntryId, entry.poolId, entry.positionId, entry.source.referenceId],
    },
    when,
    authority: LIQUIDITY_AUTHORITY_ID,
    outcome: {
      result: 'RECORDED',
      reasonCode: 'POSITION_FUNDED',
    },
    proof: {
      hashes: [positionArithmeticIdentityHash(fundedFold)],
      sequenceNumbers: [entry.amount.amountMinor],
    },
  };
}

/**
 * Submit one evidence record through the EvidenceSubmission port, honoring
 * the A15 coupling: a submission failure (a throw) propagates to the
 * caller and fails the operation that was being recorded ("A failed write
 * fails the operation" — A15 lines 62-64). The await accepts both port
 * arms (the real RTN-002 log submits synchronously; async ports are also
 * honored, per the kernel port's void-or-Promise shape).
 *
 * Source: A15 lines 62-64 + lines 41-43; the kernel port declaration
 * (src/lib/protocol-runtime/kernel/ports.ts).
 */
export async function submitLiquidityEvidence(
  port: EvidenceSubmission,
  record: EvidenceSubmissionRecord,
): Promise<void> {
  await port.submit(record);
}
