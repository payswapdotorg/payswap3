/**
 * RTN-008 — Obligation Ledger Authority: pure transition application,
 * the terms hash, and the INV-10-3 obligation-id derivation.
 *
 * Spec sources (binding) — spec/architecture/v0.1/
 * clearing-netting-settlement.md §2 Area 10:
 *   lines 92-103 (the Obligation state machine and its transition
 *     semantics — quoted in types.ts).
 *   lines 113-116 (INV-10-1, verbatim):
 *     "INV-10-1 (financial correctness): obligations are integer Money
 *      per currency; the ledger never mutates an amount after creation —
 *      corrections are new linked obligations."
 *   lines 117-121 (INV-10-2/INV-10-3, verbatim):
 *     "INV-10-2 (concurrency): ledger transitions are serialized by
 *      sequence; each obligation transitions at most once per state.
 *      INV-10-3 (idempotency): obligation creation from clearing is keyed
 *      by origin record id; duplicate instructions are no-ops."
 *   lines 133-137 (evidence produced — "OBLIGATION_CREATED (origin
 *     reference, terms hash)").
 *   spec/architecture/v0.1/README.md §3 GC-1 lines 39-43.
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - The obligation id for clearing creations is DERIVED from the origin
 *     record id (INV-10-3 — "keyed by origin record id"): identical
 *     instructions derive identical ids, which makes the duplicate no-op
 *     structural (the key match). Dispute-resolution replacements derive
 *     their ids from (dispute id, replacement index) — the same
 *     determinism discipline (GC-1) applied to the dispute path.
 *   - The terms hash (the OBLIGATION_CREATED proof material) is sha256
 *     over the canonical JSON encoding of the terms — deterministic for
 *     identical terms (GC-1), computed through the RTN-002 canonical
 *     encoder (the same encoder the A15 hash chain itself uses).
 */

import { createHash } from 'node:crypto';
import { canonicalJson } from '../evidence/canonical.ts';
import { deriveProtocolId } from '../kernel/identity.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type { ObligationRecord, ObligationState, ObligationTerms } from './types.ts';
import { canTransitionObligation } from './types.ts';

/**
 * The Obligation Ledger Authority's derivation-format domain. Versioned
 * domain label so derived obligation ids are namespaced and stable.
 *
 * Source: GC-1 (README.md §3 lines 39-43); INV-10-3 (clearing-netting-
 * settlement.md lines 119-121).
 */
export const OBLIGATION_DERIVATION_DOMAIN = 'obligation';

/**
 * Derive the obligation id for one clearing creation — INV-10-3's key:
 * "obligation creation from clearing is keyed by origin record id".
 * Identical origin record ids always derive the identical obligation id,
 * so a duplicate instruction is a structural key match (the no-op).
 *
 * Source: clearing-netting-settlement.md lines 119-121 (INV-10-3).
 */
export function obligationIdForOriginRecord(originRecordId: string): string {
  return deriveProtocolId(OBLIGATION_DERIVATION_DOMAIN, 'origin-record', originRecordId);
}

/**
 * Derive the obligation id for one dispute-resolution replacement — the
 * dispute path's creation key (deterministic per (dispute id, index), so
 * a duplicate resolution application no-ops the same way INV-10-3
 * no-ops clearing duplicates).
 *
 * Source: clearing-netting-settlement.md lines 98-100 ("resolution
 * creates new obligations, never mutates this one"); GC-1.
 */
export function obligationIdForDisputeReplacement(
  disputeId: string,
  replacementIndex: number,
): string {
  return deriveProtocolId(
    OBLIGATION_DERIVATION_DOMAIN,
    'dispute-replacement',
    disputeId,
    replacementIndex,
  );
}

/**
 * The terms hash — sha256 over the canonical JSON encoding of the
 * obligation terms. The OBLIGATION_CREATED proof material ("terms
 * hash"). Deterministic: identical terms hash identically (GC-1).
 *
 * Source: clearing-netting-settlement.md lines 133-134 ("OBLIGATION_
 * CREATED (origin reference, terms hash)"); README.md §3 GC-1.
 */
export function hashObligationTerms(terms: ObligationTerms): string {
  return createHash('sha256').update(canonicalJson(terms), 'utf8').digest('hex');
}

/**
 * Apply one Obligation transition — the pure carrier of the exact
 * machine. Replays (from === to) and every non-edge (including every
 * post-terminal attempt — the terminals have empty successor sets) are
 * the typed illegal outcome; INV-10-2's "each obligation transitions at
 * most once per state" is structural: after a legal application the
 * from-state can never re-occur (the one-way DAG).
 *
 * Source: clearing-netting-settlement.md lines 92-103, 117-118.
 */
export function transitionObligation(
  obligation: ObligationRecord,
  to: ObligationState,
  when: ProtocolTime,
): { readonly ok: true; readonly obligation: ObligationRecord } | { readonly ok: false } {
  if (!canTransitionObligation(obligation.state, to)) {
    return { ok: false };
  }
  return {
    ok: true,
    obligation: { ...obligation, state: to, stateChangedAt: when },
  };
}

/**
 * Mint the transition ProtocolTime for a ledger command. The ledger owns
 * its sequence counter (the entry sequence IS the total order); this
 * helper exists so this module stays pure.
 *
 * Source: A15 line 28 — "when: protocol time (sequenced) and recorded
 * wall time." (the shared time shape — kernel time.ts).
 */
export function obligationTime(sequence: number, wallMs: number): ProtocolTime {
  return protocolTime(sequence, wallMs);
}
