/**
 * RTN-008 — Clearing Authority: the INV-9-1 validation and per-currency
 * integer summation checks, and the derived identity of records and
 * commits.
 *
 * Spec sources (binding) — spec/architecture/v0.1/
 * clearing-netting-settlement.md §1 Area 9:
 *   lines 48-51 (INV-9-1, verbatim):
 *     "INV-9-1 (financial correctness): amounts are integer Money;
 *      staging performs per-currency integer summation checks; a batch is
 *      committed only if every included record passes validation."
 *   lines 52-54 (INV-9-2, verbatim):
 *     "INV-9-2 (concurrency): batches are processed in sequence order;
 *      record deduplication keys (origin activity id) guarantee a
 *      committed batch produces each obligation exactly once."
 *   lines 55-56 (INV-9-3, verbatim):
 *     "INV-9-3 (idempotency): re-committing the same batch id is a no-op
 *      returning the recorded result."
 *   lines 58-64 (the upstream-UNKNOWN clearability gate):
 *     "Because clearing consumes only protocol-internal activity records,
 *      it has no UNKNOWN state; any upstream UNKNOWN (rail operations
 *      during fulfillment) must already be resolved by area 14 before the
 *      activity becomes clearable."
 *   spec/architecture/v0.1/README.md §3 GC-1 lines 39-43 (integer-only
 *     arithmetic; deterministic re-runs).
 *   spec/architecture/v0.1/core.md §0 lines 11-14 (Money and MoneyBag —
 *     the integer summation substrate).
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - Per-currency integer summation (INV-9-1) is computed with the
 *     kernel MoneyBag (entrywise, deterministic, integer-only): every
 *     record's amount contributes one entry; the staged totals are the
 *     integer sums per currency, recorded on the batch and hashed into
 *     the BATCH_STAGED proof ("record count, per-currency totals hash").
 *   - Per-record validation covers the fields INV-9-1 names: the amount
 *     must be well-formed integer Money (isMoney), per-currency scale
 *     consistency within the batch (integer summation requires same-unit
 *     operands — a mixed-scale currency is quarantined
 *     SCALE_MISMATCH_WITHIN_CURRENCY), a non-zero amount (a zero debt is
 *     not an economic event; ZERO_AMOUNT), distinct parties (a self-debt
 *     is not an economic event; SELF_PARTY), and the A09 upstream-UNKNOWN
 *     clearability gate (UPSTREAM_UNRESOLVED_UNKNOWN — the caller supplies
 *     the unresolved-UNKNOWN rail-operation references for the origin
 *     activity; see authority.ts).
 *   - The record id is DERIVED from (origin kind, origin activity id)
 *     and the batch id is DERIVED from the caller-supplied batch identity
 *     — identical submissions derive identical ids (GC-1), which is what
 *     makes INV-9-3's re-commit "return the recorded result" keyed by
 *     batch id structural.
 */

import { createHash } from 'node:crypto';
import { canonicalJson } from '../evidence/canonical.ts';
import { deriveIdempotencyKey, deriveProtocolId } from '../kernel/identity.ts';
import { isMoney, moneyBagFromMoney, addMoneyBags } from '../kernel/money.ts';
import type { Money, MoneyBag } from '../kernel/money.ts';
import type { ClearingOriginReference, ClearingParties, ClearingRecord, ClearingReasonCode } from './types.ts';
import { isClearingOriginKind } from './types.ts';

/**
 * The Clearing Authority's derivation-format version for record and batch
 * ids. Versioned so a future format change is detectable in stored values.
 *
 * Source: GC-1 (README.md §3 lines 39-43) — derivations must be stable
 * and comparable; the INV-9-2/INV-9-3/INV-10-3 key contracts.
 */
export const CLEARING_DERIVATION_DOMAIN = 'clearing';

/**
 * Derive the ClearingRecord id from its origin identity — the key the
 * obligation ledger's INV-10-3 keys creation on ("obligation creation
 * from clearing is keyed by origin record id"). Identical origin identity
 * always derives the identical record id.
 *
 * Source: clearing-netting-settlement.md lines 119-121 (INV-10-3) and
 * lines 35-37 (the record's origin reference); GC-1.
 */
export function clearingRecordId(origin: ClearingOriginReference): string {
  return deriveProtocolId(CLEARING_DERIVATION_DOMAIN, 'record', origin.originKind, origin.originActivityId);
}

/**
 * Derive the batch id from a caller-supplied batch identity (an external
 * batch label, e.g. a clearing cycle label). Identical labels derive
 * identical ids, which makes INV-9-3's "re-committing the same batch id"
 * a structural key match.
 *
 * Source: clearing-netting-settlement.md lines 55-56 (INV-9-3) —
 * "re-committing the same batch id is a no-op returning the recorded
 * result."
 */
export function clearingBatchId(batchLabel: string): string {
  return deriveProtocolId(CLEARING_DERIVATION_DOMAIN, 'batch', batchLabel);
}

/**
 * Derive the commit idempotency key of one batch — the idempotency proof
 * recorded in the BATCH_COMMITTED evidence and the INV-9-3 recorded
 * result.
 *
 * Source: clearing-netting-settlement.md lines 55-56 (INV-9-3); lines
 * 67-68 ("BATCH_COMMITTED (obligation ids created, idempotency proof)").
 */
export function batchCommitIdempotencyKey(batchId: string): string {
  return deriveIdempotencyKey(CLEARING_DERIVATION_DOMAIN, 'batch-commit', batchId);
}

/**
 * Hash the staged contents of a batch — BATCH_STAGED's proof material
 * ("per-currency totals hash"): the canonical encoding of the record
 * identities, states, and per-currency totals.
 *
 * Source: clearing-netting-settlement.md lines 67-68 — "BATCH_STAGED
 * (record count, per-currency totals hash)."
 */
export function hashStagedContents(
  recordIds: readonly string[],
  perCurrencyTotals: Readonly<Record<string, number>>,
): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        recordIds: [...recordIds],
        perCurrencyTotals: { ...perCurrencyTotals },
      }),
      'utf8',
    )
    .digest('hex');
}

/**
 * The per-record validation outcome: either the record passes (and its
 * amount joins the per-currency summation) or it is quarantined with the
 * machine-readable reason code.
 *
 * Source: clearing-netting-settlement.md lines 48-51 (INV-9-1 — "a batch
 * is committed only if every included record passes validation"), lines
 * 37-40 (the QUARANTINED successor with reason codes).
 */
export type RecordValidationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ClearingReasonCode };

/**
 * Validate one submitted economic event against the INV-9-1 field
 * contract and the A09 upstream-UNKNOWN clearability gate. PURE.
 *
 * Checks (each spec-cited in the module doc):
 *   1. amount is well-formed integer Money (isMoney — the kernel's GC-1
 *      guards; a float or malformed value is INVALID_MONEY_SHAPE);
 *   2. the parties are distinct (SELF_PARTY);
 *   3. the amount is non-zero (ZERO_AMOUNT);
 *   4. the amount's scale matches the batch's per-currency scale
 *      convention seen so far (SCALE_MISMATCH_WITHIN_CURRENCY — integer
 *      summation requires same-unit operands);
 *   5. the origin activity has NO unresolved upstream UNKNOWN rail
 *      operations (UPSTREAM_UNRESOLVED_UNKNOWN — "any upstream UNKNOWN
 *      ... must already be resolved by area 14 before the activity becomes
 *      clearable"); the caller supplies the unresolved references (see
 *      authority.ts for the rails composition).
 *
 * Source: clearing-netting-settlement.md lines 48-51, 58-64; README.md
 * §3 GC-1.
 */
export function validateClearingRecord(input: {
  readonly amount: Money;
  readonly parties: ClearingParties;
  readonly seenCurrencyScales: Readonly<Record<string, number>>;
  readonly unresolvedUnknownOperationIds: readonly string[];
}): RecordValidationOutcome {
  if (!isMoney(input.amount)) {
    return { ok: false, reason: 'INVALID_MONEY_SHAPE' };
  }
  if (input.parties.debtorParticipantId === input.parties.creditorParticipantId) {
    return { ok: false, reason: 'SELF_PARTY' };
  }
  if (input.amount.amountMinor === 0) {
    return { ok: false, reason: 'ZERO_AMOUNT' };
  }
  const seenScale = input.seenCurrencyScales[input.amount.currency];
  if (seenScale !== undefined && seenScale !== input.amount.scale) {
    return { ok: false, reason: 'SCALE_MISMATCH_WITHIN_CURRENCY' };
  }
  if (input.unresolvedUnknownOperationIds.length > 0) {
    return { ok: false, reason: 'UPSTREAM_UNRESOLVED_UNKNOWN' };
  }
  return { ok: true };
}

/**
 * The staged summation of a batch's records — INV-9-1's per-currency
 * integer summation: the MoneyBag entrywise integer sum of every record
 * amount, plus the per-currency scale map the validation maintains.
 * Records in QUARANTINED state do NOT join the summation ("Quarantined
 * records never produce obligations") but they DO remain in the batch
 * contents (never dropped). PURE: deterministic for identical inputs.
 *
 * Source: clearing-netting-settlement.md lines 48-51 (INV-9-1); lines
 * 37-40; core.md §0 lines 13-14 (MoneyBag entrywise addition).
 */
export function stagedPerCurrencyTotals(
  records: readonly ClearingRecord[],
): { readonly bag: MoneyBag; readonly scales: Readonly<Record<string, number>> } {
  let bag = { entries: [] } as MoneyBag;
  const scales: Record<string, number> = {};
  for (const record of records) {
    if (record.state !== 'STAGED') {
      continue;
    }
    bag = addMoneyBags(bag, moneyBagFromMoney(record.amount));
    scales[record.amount.currency] = record.amount.scale;
  }
  return { bag, scales };
}

/**
 * The totals as a plain per-currency integer map (the recorded
 * `perCurrencyTotals` shape on the batch and in the durable store) —
 * ascending currency order (the kernel MoneyBag convention).
 *
 * Source: clearing-netting-settlement.md lines 48-51 (the recorded
 * per-currency integer totals); core.md §0 lines 13-14.
 */
export function totalsToMap(bag: MoneyBag): Readonly<Record<string, number>> {
  const map: Record<string, number> = {};
  for (const entry of bag.entries) {
    map[entry.currency] = entry.amountMinor;
  }
  return map;
}

/**
 * Re-mint a per-currency totals map into a canonical JSON string (the
 * batch record's `perCurrencyTotals` column). Deterministic.
 *
 * Source: GC-1 (README.md §3 lines 39-43); clearing-netting-settlement.md
 * lines 48-51.
 */
export function canonicalTotalsJson(totals: Readonly<Record<string, number>>): string {
  return canonicalJson({ ...totals });
}

/**
 * Verify a raw origin input shape (the submitter-facing validation).
 * Throws TypeError on malformed input (input-shape violations throw —
 * kernel convention; domain rejections are typed values).
 *
 * Source: clearing-netting-settlement.md lines 35-37 (the record shape);
 * the merged input-validation convention.
 */
export function assertOriginInput(origin: unknown): asserts origin is ClearingOriginReference {
  if (origin === null || typeof origin !== 'object') {
    throw new TypeError('clearing: record origin must be an object');
  }
  const candidate = origin as Partial<ClearingOriginReference>;
  if (
    typeof candidate.originActivityId !== 'string' ||
    candidate.originActivityId.length === 0
  ) {
    throw new TypeError('clearing: record origin.originActivityId must be a non-empty string');
  }
  if (!isClearingOriginKind(candidate.originKind)) {
    throw new TypeError(
      `clearing: record origin.originKind must be one of ROUTE_PLAN_HOP | INTENT | RECONCILIATION_ADJUSTMENT (got ${JSON.stringify(candidate.originKind)})`,
    );
  }
}
