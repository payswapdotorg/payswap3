/**
 * RTN-009 — Netting Authority: derived identity, scope minting, and the
 * pure record-transition carriers.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §3 Area 11:
 *     lines 157-163 (NettingSet — "one netting computation over a closed
 *      set of obligations"; "OPEN: input obligation ids fixed"), 161-163
 *      ("replaced by net obligations in the ledger" — the deterministic
 *      net-obligation identity).
 *     lines 167-169 (NettingScope — bilateral (exactly two participants)
 *      or multilateral (three or more, defined participant set)).
 *     lines 185-189 (INV-11-3 — "computing a set is a pure function of
 *      its fixed input ids and the netting algorithm version").
 *   spec/architecture/v0.1/README.md §3 GC-1 (lines 39-43: "Re-running
 *    any computation on identical inputs yields identical outputs").
 *   src/lib/protocol-runtime/kernel/identity.ts — the deterministic
 *    derivation the INV idempotency contracts require (deriveProtocolId).
 *
 * Design (recorded in CONTRACT-REVIEW.md): every netting-domain id is
 * DERIVED from domain identity through the kernel (the RTN-008
 * obligation-id precedent): the NettingSet id from the caller's set label
 * (labels are unique per set — the clearing openBatch precedent); the
 * NetObligation id from (netting set id, debtor, creditor, currency), so
 * identical sets materialize identical net obligations and re-commit is a
 * structural no-op.
 */

import { deriveProtocolId } from '../kernel/identity.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type {
  NetObligationRecord,
  NetObligationState,
  NettingScope,
  NettingSetRecord,
  NettingSetState,
} from './types.ts';
import { canTransitionNetObligation, canTransitionNettingSet } from './types.ts';

/**
 * The Netting Authority's derivation-format domain. Versioned domain
 * label so derived netting ids are namespaced and stable.
 *
 * Source: GC-1 (README.md §3 lines 39-43); INV-11-3
 * (clearing-netting-settlement.md lines 185-189).
 */
export const NETTING_DERIVATION_DOMAIN = 'netting';

/**
 * Derive the NettingSet id for one set label. Identical labels always
 * derive the identical id, so a duplicate label is a structural key match
 * (the typed NETTING_SET_EXISTS rejection — labels are unique per set).
 *
 * Source: clearing-netting-settlement.md lines 157-163 (one set per
 * computation); the kernel identity discipline (identity.ts).
 */
export function nettingSetIdForLabel(label: string): string {
  return deriveProtocolId(NETTING_DERIVATION_DOMAIN, 'set', label);
}

/**
 * Derive the NetObligation id for one net flow: (netting set id, debtor,
 * creditor, currency). Identical committed sets materialize identical net
 * obligations — the INV-11-3 no-op discipline applied to the replacement
 * objects.
 *
 * Source: clearing-netting-settlement.md lines 161-163 ("replaced by net
 * obligations in the ledger"), 185-189 (INV-11-3); GC-1.
 */
export function netObligationIdFor(
  nettingSetId: string,
  debtorParticipantId: string,
  creditorParticipantId: string,
  currency: string,
): string {
  return deriveProtocolId(
    NETTING_DERIVATION_DOMAIN,
    'net-position',
    nettingSetId,
    debtorParticipantId,
    creditorParticipantId,
    currency,
  );
}

/**
 * Mint a NettingScope from its raw parts, normalizing the participant list
 * to sorted order with duplicates rejected. Bilateral requires EXACTLY
 * two distinct participants; multilateral requires three or more
 * ("bilateral (exactly two participants) or multilateral (three or more,
 * defined participant set)" — verbatim).
 *
 * Source: clearing-netting-settlement.md lines 167-169.
 */
export function mintNettingScope(input: {
  readonly kind: 'BILATERAL' | 'MULTILATERAL';
  readonly participants: readonly string[];
}): NettingScope {
  if (!Array.isArray(input.participants)) {
    throw new TypeError('netting scope: participants must be an array');
  }
  for (const participantId of input.participants) {
    if (typeof participantId !== 'string' || participantId.length === 0) {
      throw new TypeError('netting scope: every participant id must be a non-empty string');
    }
  }
  const sorted = [...input.participants].sort();
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1]) {
      throw new TypeError(
        `netting scope: duplicate participant id ${JSON.stringify(sorted[index])}`,
      );
    }
  }
  if (input.kind === 'BILATERAL') {
    if (sorted.length !== 2) {
      throw new TypeError(
        `netting scope: BILATERAL requires exactly two participants (got ${sorted.length})`,
      );
    }
    return { kind: 'BILATERAL', participants: Object.freeze([sorted[0], sorted[1]]) };
  }
  if (input.kind === 'MULTILATERAL') {
    if (sorted.length < 3) {
      throw new TypeError(
        `netting scope: MULTILATERAL requires three or more participants (got ${sorted.length})`,
      );
    }
    return { kind: 'MULTILATERAL', participants: Object.freeze(sorted) };
  }
  throw new TypeError(`netting scope: unknown kind ${JSON.stringify(input.kind)}`);
}

/**
 * Apply one NettingSet state transition — the pure carrier of the exact
 * machine (OPEN→COMPUTED→COMMITTED; every other pair is the typed illegal
 * outcome; COMMITTED has an empty successor set — the one-way chain).
 *
 * Source: clearing-netting-settlement.md lines 158-163.
 */
export function transitionNettingSet(
  set: NettingSetRecord,
  to: NettingSetState,
  when: ProtocolTime,
): { readonly ok: true; readonly set: NettingSetRecord } | { readonly ok: false } {
  if (!canTransitionNettingSet(set.state, to)) {
    return { ok: false };
  }
  return { ok: true, set: { ...set, state: to } };
}

/**
 * Apply one NetObligation state transition — the pure carrier of the
 * settlement-facing machine (CREATED→SETTLEMENT_PENDING→SETTLED; SETTLED
 * is terminal with an empty successor set — "FINAL advances the
 * obligation to SETTLED exactly once", A12 INV-12-4).
 *
 * Source: clearing-netting-settlement.md lines 92-99 (the vocabulary);
 * §4 Area 12 lines 259-262 (INV-12-4).
 */
export function transitionNetObligation(
  netObligation: NetObligationRecord,
  to: NetObligationState,
  when: ProtocolTime,
): { readonly ok: true; readonly netObligation: NetObligationRecord } | { readonly ok: false } {
  if (!canTransitionNetObligation(netObligation.state, to)) {
    return { ok: false };
  }
  return { ok: true, netObligation: { ...netObligation, state: to, stateChangedAt: when } };
}

/**
 * Mint the transition ProtocolTime for a netting command (the domain owns
 * its monotonic sequence counter, like the rails store; this helper keeps
 * the module pure).
 *
 * Source: A15 line 28 — "when: protocol time (sequenced) and recorded wall
 * time." (the shared time shape — kernel time.ts).
 */
export function nettingTime(sequence: number, wallMs: number): ProtocolTime {
  return protocolTime(sequence, wallMs);
}
