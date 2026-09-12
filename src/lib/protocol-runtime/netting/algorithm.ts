/**
 * RTN-009 — Netting Authority: the pure netting computation (INV-11-3) and
 * the conservation check (INV-11-1).
 *
 * Spec sources (binding) — spec/architecture/v0.1/
 * clearing-netting-settlement.md §3 Area 11:
 *   lines 147-153 (Purpose):
 *     "Reduce sets of obligations to net positions without changing total
 *      value: pairwise (bilateral) between two participants and cyclic or
 *      optimization-based (multilateral) across many participants. Netting
 *      is a deterministic computation over the obligation ledger."
 *   lines 180-183 (INV-11-1, verbatim):
 *     "INV-11-1 (financial correctness, conservation): for every
 *      currency in the set, the integer sum of net positions equals the
 *      integer sum of gross obligations; the check is recorded in the
 *      set's proof before commit."
 *   lines 185-189 (INV-11-3, verbatim):
 *     "INV-11-3 (idempotency): computing a set is a pure function of its
 *      fixed input ids and the netting algorithm version; re-commit of a
 *      committed set id is a no-op."
 *   lines 165-166 (NetPosition — "per participant, per currency net amount
 *    (signed integer Money) after netting, with a breakdown hash proving
 *    conservation").
 *   lines 167-169 (NettingScope — bilateral / multilateral).
 *   lines 191-193 (failure semantics: "Netting is internal and
 *    deterministic").
 *   spec/architecture/v0.1/README.md §3 GC-1 (lines 39-43: "Re-running any
 *    computation on identical inputs yields identical outputs").
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - INV-11-3's purity: computeNetting is a pure function of (the gross
 *     obligation snapshots — which are themselves a pure function of the
 *     FIXED input obligation ids, because obligation terms are immutable
 *     after creation (INV-10-1) and the ids were fixed at OPEN) and the
 *     algorithm version. No clocks, no randomness, no I/O; every
 *     collection is ordered deterministically (sorted participants,
 *     sorted currencies, input order for the breakdown).
 *   - INV-11-1's conservation, materialized in the strongest
 *     non-trivial form (CONTRACT-REVIEW interpretation #2): per
 *     (participant, currency) the computed net equals the independently
 *     recomputed signed gross sum (each input obligation contributes +m
 *     to its creditor, -m to its debtor); AND the literal aggregate
 *     integer-sum equality holds (Σ net positions == Σ gross
 *     participant-signed sums; both sides are 0 over the closed
 *     participant set). A scalar-only reading of the sums would be
 *     vacuously 0 == 0 and check nothing; the per-participant equality is
 *     the content that catches any netting bug which creates, destroys,
 *     or misattributes value. Both the aggregate sums and the
 *     per-participant equalities are recorded in the proof.
 *   - The multilateral materialization (gross positions -> bilateral net
 *     obligations) is the classic deterministic greedy largest-to-largest
 *     matching per currency: creditors sorted by (-net, id), debtors by
 *     (net, id) — the most-negative first; min(flow) drains each pair.
 *     Both sides sum to the same total (Σ net == 0 per currency over the
 *     closed set), so the matching exhausts both sides exactly.
 */

import { createHash } from 'node:crypto';
import { canonicalJson } from '../evidence/canonical.ts';
import { money } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';
import type {
  ConservationProof,
  CurrencyConservationRecord,
  GrossObligationSnapshot,
  NetPosition,
  NettingScope,
} from './types.ts';

/**
 * The netting algorithm version — the second input of INV-11-3's pure
 * function ("a pure function of its fixed input ids and the netting
 * algorithm version"). Bump on any change to the computation; every
 * recorded NetPosition and ConservationProof carries it.
 *
 * Source: clearing-netting-settlement.md lines 185-189 (INV-11-3), 201-202
 * ("NETTING_COMPUTED (algorithm version, per-currency conservation
 * proof)").
 */
export const NETTING_ALGORITHM_VERSION = 1;

/**
 * The scale of a participant's net position for one currency: the scale of
 * the first gross obligation seen in that currency (all obligations in one
 * currency carry the same scale — the kernel's Money contract pairs one
 * scale with one currency per value; a mismatched scale in one set is a
 * validation failure of the input, surfaced as an explicit error).
 */
function scaleFor(gross: readonly GrossObligationSnapshot[], currency: string): number {
  const first = gross.find((entry) => entry.amount.currency === currency);
  if (first === undefined) {
    throw new TypeError(`netting algorithm: currency ${currency} not present in the input`);
  }
  return first.amount.scale;
}

/**
 * The breakdown hash of one NetPosition — sha256 over the canonical JSON
 * encoding of the ordered breakdown (input obligation id + signed
 * contribution), proving conservation from the record itself.
 *
 * Source: clearing-netting-settlement.md lines 165-166 ("with a breakdown
 * hash proving conservation"); GC-1 (README.md §3 lines 39-43).
 */
export function netPositionBreakdownHash(
  breakdown: readonly { readonly obligationId: string; readonly signedAmountMinor: number }[],
): string {
  return createHash('sha256').update(canonicalJson([...breakdown]), 'utf8').digest('hex');
}

/**
 * The conservation proof's own hash — sha256 over the canonical JSON
 * encoding of the full proof (algorithm version + per-currency records),
 * recorded in the set and in the NETTING_COMPUTED evidence record's proof
 * slot (GC-1: identical sets derive identical proof hashes).
 *
 * Source: clearing-netting-settlement.md lines 180-183 (INV-11-1: "the
 * check is recorded in the set's proof before commit"); lines 201-202.
 */
export function conservationProofHash(proof: Omit<ConservationProof, 'proofHash'>): string {
  return createHash('sha256').update(canonicalJson(proof), 'utf8').digest('hex');
}

/**
 * The ordered participant list of a scope (sorted at scope mint; returned
 * as-is for iteration determinism).
 *
 * Source: clearing-netting-settlement.md lines 167-169; GC-1.
 */
export function scopeParticipants(scope: NettingScope): readonly string[] {
  return scope.participants;
}

/**
 * Compute the net positions of one netting set — the PURE function of
 * INV-11-3. For every (participant, currency): the net position is the sum
 * of the participant's signed gross contributions (+m as creditor, -m as
 * debtor). Every position carries its ordered breakdown and the breakdown
 * hash. Positions are emitted in (participant, currency) sorted order.
 *
 * Determinism: iteration over the participants (sorted at scope mint) and
 * the currencies (sorted), with the breakdown preserving input order —
 * identical inputs yield identical outputs, always (GC-1).
 *
 * Source: clearing-netting-settlement.md lines 147-153 (the deterministic
 * computation), 165-166 (NetPosition), 185-189 (INV-11-3).
 */
export function computeNetPositions(
  nettingSetId: string,
  scope: NettingScope,
  gross: readonly GrossObligationSnapshot[],
): readonly NetPosition[] {
  const participants = scopeParticipants(scope);
  // breakdowns[(participant, currency)] = ordered signed contributions.
  const breakdowns = new Map<string, { obligationId: string; signedAmountMinor: number }[]>();
  const sum = (participantId: string, currency: string, obligationId: string, signed: number) => {
    const key = `${participantId}|${currency}`;
    const list = breakdowns.get(key) ?? [];
    list.push({ obligationId, signedAmountMinor: signed });
    breakdowns.set(key, list);
  };
  for (const obligation of gross) {
    sum(obligation.creditorParticipantId, obligation.amount.currency, obligation.obligationId, obligation.amount.amountMinor);
    sum(obligation.debtorParticipantId, obligation.amount.currency, obligation.obligationId, -obligation.amount.amountMinor);
  }
  const currencies = [...new Set(gross.map((entry) => entry.amount.currency))].sort();
  const positions: NetPosition[] = [];
  for (const participantId of participants) {
    for (const currency of currencies) {
      const key = `${participantId}|${currency}`;
      const breakdown = breakdowns.get(key);
      if (breakdown === undefined) {
        continue;
      }
      const netMinor = breakdown.reduce((acc, entry) => acc + entry.signedAmountMinor, 0);
      positions.push({
        nettingSetId,
        participantId,
        currency,
        net: money(currency, netMinor, scaleFor(gross, currency)),
        breakdownHash: netPositionBreakdownHash(breakdown),
        breakdown: Object.freeze([...breakdown]),
      });
    }
  }
  return Object.freeze(positions);
}

/**
 * Build the conservation proof — INV-11-1's recorded check. For every
 * currency in the set: the independently recomputed per-participant gross
 * sums, the computed net positions, the two integer sums, and the
 * conservation verdict. The proof hash covers the whole proof.
 *
 * The recomputation is deliberately INDEPENDENT of computeNetPositions
 * (a second pass over the gross obligations, not a read-back of the
 * positions): the check is meaningful only because it recomputes.
 *
 * Source: clearing-netting-settlement.md lines 180-183 (INV-11-1, quoted
 * in the module doc).
 */
export function buildConservationProof(
  scope: NettingScope,
  gross: readonly GrossObligationSnapshot[],
  netPositions: readonly NetPosition[],
): ConservationProof {
  const participants = scopeParticipants(scope);
  const currencies = [...new Set(gross.map((entry) => entry.amount.currency))].sort();
  const perCurrency: CurrencyConservationRecord[] = [];
  for (const currency of currencies) {
    // The independent recomputation: signed gross sums per participant.
    const grossSums = new Map<string, number>();
    for (const participantId of participants) {
      grossSums.set(participantId, 0);
    }
    for (const obligation of gross) {
      if (obligation.amount.currency !== currency) {
        continue;
      }
      grossSums.set(
        obligation.creditorParticipantId,
        (grossSums.get(obligation.creditorParticipantId) ?? 0) + obligation.amount.amountMinor,
      );
      grossSums.set(
        obligation.debtorParticipantId,
        (grossSums.get(obligation.debtorParticipantId) ?? 0) - obligation.amount.amountMinor,
      );
    }
    const netSums = new Map<string, number>();
    for (const participantId of participants) {
      netSums.set(participantId, 0);
    }
    for (const position of netPositions) {
      if (position.currency !== currency) {
        continue;
      }
      netSums.set(position.participantId, (netSums.get(position.participantId) ?? 0) + position.net.amountMinor);
    }
    const grossPerParticipant = participants.map((participantId) => ({
      participantId,
      amountMinor: grossSums.get(participantId) ?? 0,
    }));
    const netPerParticipant = participants.map((participantId) => ({
      participantId,
      amountMinor: netSums.get(participantId) ?? 0,
    }));
    const grossSumMinor = grossPerParticipant.reduce((acc, entry) => acc + entry.amountMinor, 0);
    const netSumMinor = netPerParticipant.reduce((acc, entry) => acc + entry.amountMinor, 0);
    const perParticipantEqual = grossPerParticipant.every(
      (entry, index) => entry.amountMinor === netPerParticipant[index]?.amountMinor,
    );
    perCurrency.push({
      currency,
      grossPerParticipant: Object.freeze(grossPerParticipant),
      netPerParticipant: Object.freeze(netPerParticipant),
      grossSumMinor,
      netSumMinor,
      conserved: grossSumMinor === netSumMinor && perParticipantEqual,
    });
  }
  const withoutHash: Omit<ConservationProof, 'proofHash'> = {
    algorithmVersion: NETTING_ALGORITHM_VERSION,
    currencies: Object.freeze([...currencies]),
    perCurrency: Object.freeze(perCurrency),
  };
  return { ...withoutHash, proofHash: conservationProofHash(withoutHash) };
}

/** One materialized net flow between two participants in one currency. */
export interface MaterializedNetFlow {
  readonly debtorParticipantId: string;
  readonly creditorParticipantId: string;
  readonly amount: Money;
}

/**
 * Materialize the net positions into bilateral net obligations — the
 * "net obligations" that replace the gross ones (lines 161-163). Per
 * currency: the participants with negative net (debtors) and positive net
 * (creditors) are matched greedily largest-to-largest (the classic
 * deterministic multilateral matching — "cyclic or optimization-based
 * (multilateral)", lines 150-151); every matched pair becomes one flow.
 * Bilateral scopes have at most one flow per currency by construction.
 * Zero positions materialize nothing ("a pairwise net to zero produces no
 * net obligation" — the A10 NettingCommitInstruction contract).
 *
 * Determinism: creditors sorted by (-net, id); debtors by (net, id); the
 * match drains min(credit, |debt|) — identical positions yield identical
 * flows, always (GC-1 / INV-11-3).
 *
 * Source: clearing-netting-settlement.md lines 150-151, 161-166.
 */
export function materializeNetObligations(
  netPositions: readonly NetPosition[],
): readonly MaterializedNetFlow[] {
  const currencies = [...new Set(netPositions.map((position) => position.currency))].sort();
  const flows: MaterializedNetFlow[] = [];
  for (const currency of currencies) {
    const scale = netPositions.find((position) => position.currency === currency)?.net.scale ?? 2;
    const creditors = netPositions
      .filter((position) => position.currency === currency && position.net.amountMinor > 0)
      .map((position) => ({
        participantId: position.participantId,
        amountMinor: position.net.amountMinor as number,
      }))
      .sort((a, b) => b.amountMinor - a.amountMinor || (a.participantId < b.participantId ? -1 : 1));
    const debtors = netPositions
      .filter((position) => position.currency === currency && position.net.amountMinor < 0)
      .map((position) => ({
        participantId: position.participantId,
        amountMinor: (-position.net.amountMinor) as number,
      }))
      .sort((a, b) => b.amountMinor - a.amountMinor || (a.participantId < b.participantId ? -1 : 1));
    let creditIndex = 0;
    let debtorIndex = 0;
    while (creditIndex < creditors.length && debtorIndex < debtors.length) {
      const credit = creditors[creditIndex];
      const debt = debtors[debtorIndex];
      const flowMinor = Math.min(credit.amountMinor, debt.amountMinor);
      if (flowMinor > 0) {
        flows.push({
          debtorParticipantId: debt.participantId,
          creditorParticipantId: credit.participantId,
          amount: money(currency, flowMinor, scale),
        });
      }
      credit.amountMinor -= flowMinor;
      debt.amountMinor -= flowMinor;
      if (credit.amountMinor === 0) {
        creditIndex += 1;
      }
      if (debt.amountMinor === 0) {
        debtorIndex += 1;
      }
    }
  }
  return Object.freeze(flows);
}

/**
 * Re-verify a recorded conservation proof against the gross obligations
 * and net positions it claims to cover — the commit gate's belt-and-braces
 * re-check ("the check is recorded in the set's proof before commit": the
 * recorded proof must be present AND still hold when commit executes).
 * Returns true iff every per-currency record still matches a fresh
 * recomputation and every conserved flag is true.
 *
 * Source: clearing-netting-settlement.md lines 180-183 (INV-11-1).
 */
export function verifyConservationProof(
  scope: NettingScope,
  gross: readonly GrossObligationSnapshot[],
  netPositions: readonly NetPosition[],
  recorded: ConservationProof,
): boolean {
  if (recorded.algorithmVersion !== NETTING_ALGORITHM_VERSION) {
    return false;
  }
  const fresh = buildConservationProof(scope, gross, netPositions);
  if (fresh.proofHash !== recorded.proofHash) {
    return false;
  }
  return recorded.perCurrency.every((entry) => entry.conserved);
}
