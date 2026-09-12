/**
 * RTN-009 — Netting Authority: the in-process single-writer state store
 * (the RTN-005/007/008 in-process-object-store precedent).
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §3 Area 11:
 *     lines 157-170 (the NettingSet, NetPosition, NettingScope — the
 *      carried record shapes).
 *     lines 182-184 (INV-11-2, verbatim):
 *       "INV-11-2 (concurrency): an obligation can belong to at most one
 *        open netting set; set membership is claimed atomically at OPEN."
 *     lines 191-193 (failure semantics — validation failures abort before
 *      commit with no ledger effect).
 *   spec/registry/protocol-registry.json singleFinancialAuthority (the
 *    single-writer discipline every authority state store follows).
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - In-process single writer: this store is the netting domain's only
 *     state carrier; every mutation flows through exactly one authority
 *     command (the RailsStore precedent, minus the SQLite coupling — the
 *     durable side is persistence.ts + migrations/, per the RTN-001
 *     convention).
 *   - INV-11-2's membership claims: one map from obligation id to the
 *     claiming set id. claimMembership is ALL-OR-NOTHING (atomic): it
 *     validates every id is unclaimed first, then claims all of them in
 *     one synchronous section — a partially-claimed OPEN is
 *     unrepresentable. Claims are released when the set COMMITS (the
 *     obligation's NETTED state then structurally prevents re-netting —
 *     only CREATED obligations can enter a set, and applyNettingCommit
 *     transitions CREATED -> NETTED exactly once).
 *   - The protocol sequence: one monotonic counter minting the domain's
 *     ProtocolTime sequences (the rails store precedent; each authority
 *     domain owns its sequenced positions).
 */

import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { deepFreeze } from './freeze.ts';
import type { NetObligationRecord } from './types.ts';
import type { NettingSetRecord } from './types.ts';

/**
 * The netting domain's state store: netting sets, net obligations, and the
 * INV-11-2 membership claims — with all-or-nothing atomic claiming.
 *
 * Source: clearing-netting-settlement.md lines 157-189.
 */
export class NettingStore {
  private readonly nettingSets = new Map<string, NettingSetRecord>();
  private readonly netObligations = new Map<string, NetObligationRecord>();
  private readonly membershipClaims = new Map<string, string>();
  private readonly usedLabels = new Set<string>();
  private sequence = 0;

  /** The domain's next sequenced protocol position (monotonic, gapless per domain). */
  nextProtocolSequence(): number {
    return this.sequence;
  }

  /** Mint the protocol time for the next sequenced position (without consuming it). */
  peekTime(wallMs: number): ProtocolTime {
    return protocolTime(this.sequence, wallMs);
  }

  /** Consume one sequence position (called by the authority when a record commits). */
  consumeSequence(): number {
    const consumed = this.sequence;
    this.sequence += 1;
    return consumed;
  }

  // --- NettingSet records --------------------------------------------------

  /** Register a set label as used (the open-time uniqueness gate). */
  reserveLabel(label: string): void {
    this.usedLabels.add(label);
  }

  /** Has this label been used (by any set, committed or not)? */
  labelUsed(label: string): boolean {
    return this.usedLabels.has(label);
  }

  /** Insert one NettingSet record (deep-frozen at mint). */
  insertNettingSet(set: NettingSetRecord): void {
    this.nettingSets.set(set.nettingSetId, deepFreeze({ ...set }));
  }

  /** Replace one NettingSet record (the OPEN→COMPUTED→COMMITTED transitions). */
  updateNettingSet(set: NettingSetRecord): void {
    if (!this.nettingSets.has(set.nettingSetId)) {
      throw new TypeError(
        `netting store: set ${set.nettingSetId} does not exist (update requires insert first)`,
      );
    }
    this.nettingSets.set(set.nettingSetId, deepFreeze({ ...set }));
  }

  /** The NettingSet record by id. */
  nettingSet(nettingSetId: string): NettingSetRecord | undefined {
    return this.nettingSets.get(nettingSetId);
  }

  /** All NettingSet records (insertion order). */
  listNettingSets(): readonly NettingSetRecord[] {
    return [...this.nettingSets.values()];
  }

  // --- NetObligation records -------------------------------------------------

  /** Insert one NetObligation record (deep-frozen at mint). */
  insertNetObligation(netObligation: NetObligationRecord): void {
    if (this.netObligations.has(netObligation.netObligationId)) {
      throw new TypeError(
        `netting store: net obligation ${netObligation.netObligationId} already exists (re-commit is a no-op — INV-11-3)`,
      );
    }
    this.netObligations.set(netObligation.netObligationId, deepFreeze({ ...netObligation }));
  }

  /** Replace one NetObligation record (the settlement-facing transitions). */
  updateNetObligation(netObligation: NetObligationRecord): void {
    if (!this.netObligations.has(netObligation.netObligationId)) {
      throw new TypeError(
        `netting store: net obligation ${netObligation.netObligationId} does not exist (update requires insert first)`,
      );
    }
    this.netObligations.set(netObligation.netObligationId, deepFreeze({ ...netObligation }));
  }

  /** The NetObligation record by id. */
  netObligation(netObligationId: string): NetObligationRecord | undefined {
    return this.netObligations.get(netObligationId);
  }

  /** All NetObligation records of one netting set (insertion order). */
  netObligationsOfSet(nettingSetId: string): readonly NetObligationRecord[] {
    return [...this.netObligations.values()].filter(
      (entry) => entry.nettingSetId === nettingSetId,
    );
  }

  /** All NetObligation records (insertion order). */
  listNetObligations(): readonly NetObligationRecord[] {
    return [...this.netObligations.values()];
  }

  // --- INV-11-2: the atomic membership claims ---------------------------------

  /**
   * Is this obligation currently claimed by an open (non-committed)
   * netting set? Returns the claiming set id when claimed.
   *
   * Source: clearing-netting-settlement.md lines 182-184 (INV-11-2).
   */
  membershipClaim(obligationId: string): string | undefined {
    return this.membershipClaims.get(obligationId);
  }

  /**
   * Claim membership for a set over its input obligations — ALL OR NOTHING
   * (atomic at OPEN): if ANY id is already claimed, NOTHING is claimed and
   * the conflicting id is returned. The claim exists only for sets not yet
   * COMMITTED ("an obligation can belong to at most one open netting set").
   *
   * Source: clearing-netting-settlement.md lines 182-184 (INV-11-2).
   */
  claimMembership(
    nettingSetId: string,
    obligationIds: readonly string[],
  ): { readonly ok: true } | { readonly ok: false; readonly conflictingObligationId: string; readonly claimedBy: string } {
    for (const obligationId of obligationIds) {
      const claimedBy = this.membershipClaims.get(obligationId);
      if (claimedBy !== undefined) {
        return { ok: false, conflictingObligationId: obligationId, claimedBy };
      }
    }
    for (const obligationId of obligationIds) {
      this.membershipClaims.set(obligationId, nettingSetId);
    }
    return { ok: true };
  }

  /**
   * Release the membership claims of a set (at COMMIT — the set is no
   * longer open; the NETTED obligation state structurally prevents
   * re-netting thereafter).
   *
   * Source: clearing-netting-settlement.md lines 161-184.
   */
  releaseMembership(nettingSetId: string): void {
    for (const [obligationId, claimingSet] of this.membershipClaims) {
      if (claimingSet === nettingSetId) {
        this.membershipClaims.delete(obligationId);
      }
    }
  }
}
