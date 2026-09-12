/**
 * RTN-008 — Clearing Authority: pure transition application for the A09
 * state machines (batch and record).
 *
 * Spec sources (binding) — spec/architecture/v0.1/
 * clearing-netting-settlement.md §1 Area 9:
 *   lines 30-33 (ClearingBatch, verbatim):
 *     "States: OPEN -> STAGED -> COMMITTED -> FINAL.
 *      Contents are immutable after STAGED. COMMITTED means obligations
 *      have been created; FINAL means all produced obligations are handed
 *      to the obligation ledger."
 *   lines 37-40 (ClearingRecord, verbatim):
 *     "States: ACCEPTED -> STAGED | QUARANTINED.
 *      Quarantined records never produce obligations; they await manual
 *      or automated disposition with reason codes."
 *
 * The transition tables themselves live in types.ts (the frozen exact
 * chains); this module applies them to the record shapes, returning the
 * updated record or the typed ILLEGAL_TRANSITION rejection (typed values,
 * never thrown — the merged command convention). This module is the pure
 * state-carrier; the DRIVING layer (which command triggers which
 * transition, and under which INV gate) is authority.ts.
 */

import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type {
  ClearingBatchRecord,
  ClearingRecord,
  ClearingReasonCode,
  BatchState,
  RecordState,
} from './types.ts';
import { canTransitionBatch, canTransitionRecord } from './types.ts';

/**
 * Apply one ClearingBatch transition — the pure carrier of the exact
 * chain. Replays (from === to) are illegal (the chain has no self-edges);
 * every non-edge is too. The commit result is attached by the caller (the
 * authority) on the STAGED -> COMMITTED application, never here — this
 * function only carries state.
 *
 * Source: clearing-netting-settlement.md lines 30-33.
 */
export function transitionBatch(
  batch: ClearingBatchRecord,
  to: BatchState,
  when: ProtocolTime,
): { readonly ok: true; readonly batch: ClearingBatchRecord } | { readonly ok: false } {
  if (!canTransitionBatch(batch.state, to)) {
    return { ok: false };
  }
  return {
    ok: true,
    batch: { ...batch, state: to, stateChangedAt: when },
  };
}

/**
 * Apply one ClearingRecord transition — the pure carrier of the exact
 * chain: ACCEPTED -> STAGED (validation passed) or ACCEPTED ->
 * QUARANTINED (validation failed, "with reason codes" — the reason is
 * mandatory on the quarantine edge and forbidden on the stage edge).
 *
 * Source: clearing-netting-settlement.md lines 37-40.
 */
export function transitionRecord(
  record: ClearingRecord,
  to: RecordState,
  when: ProtocolTime,
  quarantineReason?: ClearingReasonCode,
): { readonly ok: true; readonly record: ClearingRecord } | { readonly ok: false } {
  if (!canTransitionRecord(record.state, to)) {
    return { ok: false };
  }
  if (to === 'QUARANTINED' && quarantineReason === undefined) {
    // "Quarantined records ... await manual or automated disposition with
    // reason codes" — a quarantine without a reason code is not a state
    // this machine can represent.
    return { ok: false };
  }
  if (to === 'STAGED' && quarantineReason !== undefined) {
    return { ok: false };
  }
  return {
    ok: true,
    record: {
      ...record,
      state: to,
      stateChangedAt: when,
      ...(to === 'QUARANTINED' ? { quarantineReason } : {}),
    },
  };
}

/**
 * Mint the transition ProtocolTime for a domain command. The authority
 * owns its sequence counter; this helper exists so the state-machine
 * module stays pure (the caller supplies the sequenced time).
 *
 * Source: A15 line 28 — "when: protocol time (sequenced) and recorded
 * wall time." (evidence-risk-compliance.md; the shared time shape every
 * authority stamps onto its records — kernel time.ts.)
 */
export function clearingTime(sequence: number, wallMs: number): ProtocolTime {
  return protocolTime(sequence, wallMs);
}
