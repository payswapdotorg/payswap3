/**
 * RTN-001 — Protocol runtime kernel: deterministic identity derivation.
 *
 * Spec sources (binding) — the v0.1 idempotency invariant contracts that
 * require ids and idempotency keys to be DERIVED from domain identity:
 *   spec/architecture/v0.1/core.md §3 Area 3, lines 182-184 (INV-3-3):
 *     "commitment ids are derived from (intent id, capability id);
 *      duplicate requests return the recorded commitment state."
 *   spec/architecture/v0.1/core.md §5 Area 5, lines 310-312 (INV-5-3):
 *     "reservation ids are derived from (intent id, hop id, resource id);
 *      duplicate requests return the recorded state; CONSUMED and RELEASED
 *      are exactly-once terminals."
 *   spec/architecture/v0.1/core.md §4 Area 4, lines 248-249 (INV-4-3):
 *     "compilation is keyed by (intent id, compiler version, snapshot id);
 *      identical inputs return the identical plan."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   56-58 (INV-15-4):
 *     "evidence write keys derived from the subject operation id prevent
 *      duplicate records for one operation."
 *   spec/architecture/v0.1/core.md §1 Area 1, lines 60-62 (INV-1-3):
 *     "re-submission with a recorded idempotency key returns the recorded
 *      receipt; it never creates a second intent or a second financial
 *      effect."
 *
 * Note on the work order's "cite §0 lines": core.md §0 itself contains no
 * identity-derivation line; the derivation requirement is sourced from the
 * per-area INV idempotency contracts quoted above (the closest §0-adjacent
 * text is INV-1-2/INV-1-3 in Area 1). This deviation is recorded in
 * CONTRACT-REVIEW.md.
 *
 * Supporting contract (the enqueue side that consumes idempotency keys):
 *   spec/durable/execution.md §6, lines 130-133:
 *     "SQLite treats NULLs as distinct inside UNIQUE constraints: omitting
 *      the idempotency key opts the enqueue out of dedupe (intent without
 *      identity). Financially meaningful work MUST always carry a key
 *      derived from domain identity."
 *
 * Design:
 *   - Derivation is hash-based: sha256 over a VERSIONED canonical encoding of
 *     the derivation parts. The version integer is inside the hashed payload
 *     AND visible in the output prefix, so a future format change is
 *     detectable both in stored values (prefix mismatch) and in the encoding
 *     itself (version mismatch).
 *   - The canonical encoding is unambiguous: every part is length-prefixed
 *     with its type tag, so ('ab', 'c') and ('a', 'bc') derive DIFFERENT ids.
 *   - Numeric parts must be integers — floats are rejected (GC-1 discipline
 *     extended to identity inputs; "identical inputs return the identical
 *     plan" requires inputs to be exact values).
 *   - Two output namespaces: derived OBJECT ids (`pid.v1.<hex>`) and derived
 *     IDEMPOTENCY KEYS (`idem.v1.<hex>`), so a derived id can never be
 *     accidentally used as a dedupe key or vice versa.
 *
 * The kernel derives identity; it is NOT an "identity authority" — it holds
 * no registry of subjects and validates no subject semantics (rtn-plan-
 * rulings.md Q4/delta 4: identity/market are non-normative vocabulary for
 * the runtime; subject validation is per-command per owning authority).
 */

import { createHash } from 'node:crypto';

/**
 * Version of the derivation input format. Bump on any change to the
 * canonical encoding; derived values carry the version in their prefix so
 * mixed-version values are detectable in storage.
 *
 * Source: the INV contracts above require stable, comparable derivation
 * ("identical inputs return the identical plan" — INV-4-3).
 */
export const DERIVATION_FORMAT_VERSION = 1;

/**
 * One derivation input part: a string label/domain value or an exact integer
 * (e.g. a sequence position or a format version). Floats are not valid
 * derivation inputs.
 *
 * Source: INV-3-3 / INV-5-3 (ids derived from tuple identities);
 * GC-1 integer discipline (README.md §3 lines 39-43).
 */
export type DerivationPart = string | number;

/**
 * A deterministically derived protocol object id: `pid.v1.<sha256-hex>`.
 *
 * Source: INV-3-3 (core.md lines 182-184) and INV-5-3 (core.md lines
 * 310-312) — object ids derived from domain tuples.
 */
export type DerivedProtocolId = string & { readonly __kernelDerivedId: 'derived-protocol-id' };

/**
 * A deterministically derived idempotency key: `idem.v1.<sha256-hex>`.
 * Feeds the DEP-003 enqueue contract (UNIQUE (idempotency_key, kind)).
 *
 * Source: INV-1-3 (core.md lines 60-62) + spec/durable/execution.md §6
 * lines 130-133 ("MUST always carry a key derived from domain identity").
 */
export type DerivedIdempotencyKey = string & {
  readonly __kernelDerivedIdempotencyKey: 'derived-idempotency-key';
};

function fail(message: string): never {
  throw new TypeError(message);
}

function encodePart(part: DerivationPart, index: number): string {
  if (typeof part === 'string') {
    return `s${part.length}:${part}`;
  }
  if (typeof part === 'number') {
    if (!Number.isInteger(part)) {
      fail(`derive: derivation part ${index} must be an integer — floats are forbidden by GC-1 (got ${part})`);
    }
    if (!Number.isSafeInteger(part)) {
      fail(`derive: derivation part ${index} must be a safe integer (got ${part})`);
    }
    return `n:${part}`;
  }
  fail(`derive: derivation part ${index} must be a string or integer (got ${typeof part})`);
}

/**
 * Canonical, versioned encoding of the derivation input. The version header
 * makes future format changes detectable; per-part type+length tags make the
 * encoding unambiguous.
 *
 * Source: INV-4-3 (core.md lines 248-249) — "identical inputs return the
 * identical plan" (derivation must be a pure, comparable function).
 */
export function canonicalDerivationInput(parts: readonly DerivationPart[]): string {
  if (!Array.isArray(parts)) {
    fail(`derive: parts must be an array (got ${typeof parts})`);
  }
  const body = parts.map(encodePart).join('|');
  return `v${DERIVATION_FORMAT_VERSION}|${body}`;
}

function deriveHex(parts: readonly DerivationPart[]): string {
  return createHash('sha256').update(canonicalDerivationInput(parts), 'utf8').digest('hex');
}

/**
 * Deterministically derive a protocol object id from domain identity parts,
 * e.g. deriveProtocolId('commitment', intentId, capabilityId) for INV-3-3,
 * or deriveProtocolId('reservation', intentId, hopId, resourceId) for
 * INV-5-3. Identical inputs always yield the identical id; any input
 * difference yields a different id.
 *
 * Source: INV-3-3 (core.md lines 182-184), INV-5-3 (core.md lines 310-312),
 * INV-15-4 (evidence-risk-compliance.md lines 56-58).
 */
export function deriveProtocolId(...parts: readonly DerivationPart[]): DerivedProtocolId {
  return `pid.v${DERIVATION_FORMAT_VERSION}.${deriveHex(parts)}` as DerivedProtocolId;
}

/**
 * Deterministically derive an idempotency key from domain identity parts,
 * e.g. deriveIdempotencyKey('intent.create', intentId) — the key that feeds
 * the DEP-003 enqueue dedupe (UNIQUE (idempotency_key, kind)) and the
 * receipt-collapse invariants (INV-1-2/INV-1-3). Identical inputs always
 * yield the identical key.
 *
 * Source: INV-1-2/INV-1-3 (core.md lines 57-62) + spec/durable/execution.md
 * §6 lines 130-133 ("Financially meaningful work MUST always carry a key
 * derived from domain identity").
 */
export function deriveIdempotencyKey(...parts: readonly DerivationPart[]): DerivedIdempotencyKey {
  return `idem.v${DERIVATION_FORMAT_VERSION}.${deriveHex(parts)}` as DerivedIdempotencyKey;
}

/**
 * Runtime type guard for values minted by deriveProtocolId at the current
 * derivation format version.
 *
 * Source: versioned-input-format requirement (RTN-001 work order: "versioned
 * input format so future format changes are detectable").
 */
export function isDerivedProtocolId(value: unknown): value is DerivedProtocolId {
  return typeof value === 'string' && value.startsWith(`pid.v${DERIVATION_FORMAT_VERSION}.`);
}

/**
 * Runtime type guard for values minted by deriveIdempotencyKey at the
 * current derivation format version.
 *
 * Source: versioned-input-format requirement (RTN-001 work order), feeding
 * the DEP-003 enqueue contract (spec/durable/execution.md §6).
 */
export function isDerivedIdempotencyKey(value: unknown): value is DerivedIdempotencyKey {
  return typeof value === 'string' && value.startsWith(`idem.v${DERIVATION_FORMAT_VERSION}.`);
}
