/**
 * RTN-005 — Intent Authority: DemandDescriptor construction, canonical
 * encoding, and the submitted-descriptor hash.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/core.md §1 Area 1, lines 39-41:
 *     "DemandDescriptor — immutable attachment created at DRAFT: amount
 *      (Money), source and destination descriptors, constraints (deadline,
 *      allowed rails, cost ceiling), idempotency key."
 *   core.md line 74-75 (the INTENT_CREATED proof this module feeds):
 *     "INTENT_CREATED (what: intent terms; when; authority: Intent
 *      Authority; outcome: DRAFT; proof: submitted descriptor hash)."
 *   core.md §0 lines 11-14 (Money: integer minor units, 3-letter currency
 *    code, explicit scale — no floating point, GC-1).
 *   spec/architecture/v0.1/README.md §3 GC-1 lines 39-43 ("Re-running any
 *    computation on identical inputs yields identical outputs").
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - `demandDescriptor()` is the single mint: it validates every field the
 *     A01 contract names (Money amount via the kernel's own guards being
 *     applied at the caller, endpoint descriptor shapes, integer deadline,
 *     non-empty sorted-unique allowed rails, Money cost ceiling, non-empty
 *     idempotency key), canonicalizes the allowed-rails order, and returns a
 *     deep-frozen value — the descriptor is immutable from construction.
 *   - The canonical encoding reuses the kernel's identity discipline
 *     (canonicalDerivationInput): every part is type- and length-tagged, so
 *     ambiguous part splits are unrepresentable. The hash prefix
 *     `ddh.v1.<hex>` makes the format version detectable in stored values
 *     (the same discipline as the kernel's pid/idem prefixes and risk's
 *     subject-data hash).
 */

import { createHash } from 'node:crypto';
import { canonicalDerivationInput } from '../kernel/identity.ts';
import { isMoney } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';
import type { DemandConstraints, DemandDescriptor, EndpointDescriptor } from './types.ts';

/**
 * Version of the demand-descriptor hash input format. Bump on any change to
 * the canonical encoding; hashed values carry the version in their prefix.
 *
 * Source: GC-1 (README.md §3 lines 39-43 — identical inputs must derive
 * identical, comparable outputs).
 */
export const DEMAND_DESCRIPTOR_HASH_FORMAT_VERSION = 1;

function fail(message: string): never {
  throw new TypeError(message);
}

/**
 * Validate and mint one endpoint descriptor ("source and destination
 * descriptors" — core.md line 40). Deterministic TypeError on any violation.
 *
 * Source: core.md line 40; area 3 lines 154-155 (corridor currencies and
 * geographies are the matching inputs these fields feed).
 */
export function endpointDescriptor(input: {
  readonly currency: string;
  readonly geography: string;
  readonly account: string;
}): EndpointDescriptor {
  if (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency)) {
    fail(`demand descriptor: endpoint currency must be exactly 3 uppercase letters (got ${JSON.stringify(input.currency)})`);
  }
  if (typeof input.geography !== 'string' || input.geography.length === 0) {
    fail('demand descriptor: endpoint geography must be a non-empty string');
  }
  if (typeof input.account !== 'string' || input.account.length === 0) {
    fail('demand descriptor: endpoint account must be a non-empty string');
  }
  return Object.freeze({ currency: input.currency, geography: input.geography, account: input.account });
}

/**
 * Validate and mint the demand constraints ("constraints (deadline, allowed
 * rails, cost ceiling)" — core.md line 40). The allowed-rails list is
 * canonicalized to ascending sorted order with duplicates rejected, so the
 * same constraint set has exactly one representation (GC-1 determinism).
 *
 * Source: core.md line 40; GC-1 (README.md §3 lines 39-43).
 */
export function demandConstraints(input: {
  readonly deadlineEpochMs: number;
  readonly allowedRails: readonly string[];
  readonly costCeiling: Money;
}): DemandConstraints {
  if (typeof input.deadlineEpochMs !== 'number' || !Number.isInteger(input.deadlineEpochMs)) {
    fail('demand descriptor: deadlineEpochMs must be an integer number of epoch milliseconds');
  }
  if (!Number.isSafeInteger(input.deadlineEpochMs)) {
    fail('demand descriptor: deadlineEpochMs must be a safe integer');
  }
  if (!Array.isArray(input.allowedRails) || input.allowedRails.length === 0) {
    fail('demand descriptor: allowedRails must be a non-empty array of rail ids');
  }
  const sorted = [...input.allowedRails].sort();
  for (const rail of sorted) {
    if (typeof rail !== 'string' || rail.length === 0) {
      fail('demand descriptor: every allowed rail id must be a non-empty string');
    }
  }
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1]) {
      fail(`demand descriptor: duplicate allowed rail id ${JSON.stringify(sorted[index])}`);
    }
  }
  if (!isMoney(input.costCeiling)) {
    fail('demand descriptor: costCeiling must be a well-formed Money value (integer minor units, GC-1)');
  }
  return Object.freeze({
    deadlineEpochMs: input.deadlineEpochMs,
    allowedRails: Object.freeze(sorted),
    costCeiling: input.costCeiling,
  });
}

/**
 * The single mint for DemandDescriptor — the immutable attachment created
 * at DRAFT. Validates amount (kernel Money guard), mints both endpoint
 * descriptors and the constraints, and requires a non-empty idempotency key
 * (INV-1-2's collapse key must be real identity, never absent). Returns a
 * deep-frozen value: descriptor immutability starts at construction.
 *
 * Source: core.md lines 39-41 ("immutable attachment created at DRAFT");
 * INV-1-2/INV-1-3 (the idempotency key's role); GC-1.
 */
export function demandDescriptor(input: {
  readonly amount: Money;
  readonly source: { readonly currency: string; readonly geography: string; readonly account: string };
  readonly destination: { readonly currency: string; readonly geography: string; readonly account: string };
  readonly constraints: {
    readonly deadlineEpochMs: number;
    readonly allowedRails: readonly string[];
    readonly costCeiling: Money;
  };
  readonly idempotencyKey: string;
}): DemandDescriptor {
  if (!isMoney(input.amount)) {
    fail('demand descriptor: amount must be a well-formed Money value (integer minor units, GC-1)');
  }
  if (input.amount.amountMinor <= 0) {
    fail('demand descriptor: amount must be positive minor units (a demand for zero or negative value is not a demand)');
  }
  if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length === 0) {
    fail('demand descriptor: idempotencyKey must be a non-empty string (INV-1-2 collapse requires real identity)');
  }
  const descriptor: DemandDescriptor = Object.freeze({
    amount: input.amount,
    source: endpointDescriptor(input.source),
    destination: endpointDescriptor(input.destination),
    constraints: demandConstraints(input.constraints),
    idempotencyKey: input.idempotencyKey,
  });
  return descriptor;
}

/**
 * Canonical, versioned encoding of the submitted descriptor — the
 * "submitted descriptor hash" input. Pure function of the descriptor;
 * identical descriptors encode identically (GC-1). Uses the kernel's
 * type-tagged part encoding so no two distinct descriptors share an
 * encoding.
 *
 * Source: core.md lines 74-75 ("proof: submitted descriptor hash"); GC-1
 * (README.md §3 lines 39-43).
 */
export function canonicalDemandDescriptor(descriptor: DemandDescriptor): string {
  return canonicalDerivationInput([
    'demand-descriptor',
    `v${DEMAND_DESCRIPTOR_HASH_FORMAT_VERSION}`,
    descriptor.idempotencyKey,
    descriptor.amount.currency,
    descriptor.amount.scale,
    descriptor.amount.amountMinor,
    descriptor.source.currency,
    descriptor.source.geography,
    descriptor.source.account,
    descriptor.destination.currency,
    descriptor.destination.geography,
    descriptor.destination.account,
    descriptor.constraints.deadlineEpochMs,
    descriptor.constraints.allowedRails.join(','),
    descriptor.constraints.costCeiling.currency,
    descriptor.constraints.costCeiling.scale,
    descriptor.constraints.costCeiling.amountMinor,
  ]);
}

/**
 * The submitted descriptor hash: sha256 over the canonical encoding,
 * prefixed `ddh.v1.<hex>`. Deterministic; feeds the INTENT_CREATED proof
 * slot.
 *
 * Source: core.md lines 74-75 — "proof: submitted descriptor hash"; GC-1.
 */
export function demandDescriptorHash(descriptor: DemandDescriptor): string {
  const hex = createHash('sha256').update(canonicalDemandDescriptor(descriptor), 'utf8').digest('hex');
  return `ddh.v${DEMAND_DESCRIPTOR_HASH_FORMAT_VERSION}.${hex}`;
}

/**
 * Structural equality of two demand descriptors (field-by-field; the
 * allowed-rails canonical order makes list comparison unambiguous).
 *
 * Source: core.md lines 39-41 (the field list that defines descriptor
 * identity); GC-1 (deterministic comparison).
 */
export function demandDescriptorEquals(a: DemandDescriptor, b: DemandDescriptor): boolean {
  return (
    a.idempotencyKey === b.idempotencyKey &&
    a.amount.currency === b.amount.currency &&
    a.amount.scale === b.amount.scale &&
    a.amount.amountMinor === b.amount.amountMinor &&
    a.source.currency === b.source.currency &&
    a.source.geography === b.source.geography &&
    a.source.account === b.source.account &&
    a.destination.currency === b.destination.currency &&
    a.destination.geography === b.destination.geography &&
    a.destination.account === b.destination.account &&
    a.constraints.deadlineEpochMs === b.constraints.deadlineEpochMs &&
    a.constraints.allowedRails.join(',') === b.constraints.allowedRails.join(',') &&
    a.constraints.costCeiling.currency === b.constraints.costCeiling.currency &&
    a.constraints.costCeiling.scale === b.constraints.costCeiling.scale &&
    a.constraints.costCeiling.amountMinor === b.constraints.costCeiling.amountMinor
  );
}
