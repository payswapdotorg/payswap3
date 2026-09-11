/**
 * RTN-001 — Protocol runtime kernel: the shared reason-code vocabulary.
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/core.md §0 "Shared conventions (recap)",
 *   lines 16-17:
 *     "External results may be UNKNOWN; the only exit from UNKNOWN is
 *      reconciliation (area 14); blind retry is forbidden (GC-2)."
 *   spec/architecture/v0.1/README.md §3 GC-2, lines 45-49:
 *     "UNKNOWN results go to reconciliation, never blind retry.
 *      Any external operation whose result is not known resolves as UNKNOWN.
 *      UNKNOWN is a durable state, not a failure. The only permitted path is:
 *      UNKNOWN -> reconciliation (area 14) -> known result -> safe resume.
 *      Components must never blindly re-submit an UNKNOWN external operation."
 *
 * This is the COMPLETE shared, area-agnostic vocabulary defined by the v0.1
 * shared conventions: every §0 recap across the six v0.1 files repeats
 * exactly this one machine-readable outcome token (UNKNOWN) and no other.
 * Area-specific reason codes (POLICY_UNSATISFIABLE, NO_VIABLE_ROUTE, ...)
 * are owned by their areas' materialization work orders (RTN-005..RTN-009)
 * and are deliberately NOT defined here — no inventions.
 */

/**
 * The shared reason-code vocabulary, verbatim from the v0.1 shared
 * conventions: exactly one member, `UNKNOWN`. Frozen so the set cannot be
 * extended at runtime — no inventions.
 *
 * Source: core.md §0 lines 16-17; README.md §3 GC-2 lines 45-49.
 */
export const SHARED_REASON_CODES: readonly ['UNKNOWN'] = Object.freeze(['UNKNOWN'] as const);

/**
 * A shared reason code. `UNKNOWN` is a durable state, not a failure; the only
 * permitted exit is reconciliation (area 14); blind retry is forbidden.
 *
 * Source: core.md §0 lines 16-17; README.md §3 GC-2 lines 45-49.
 */
export type SharedReasonCode = (typeof SHARED_REASON_CODES)[number];

/**
 * Runtime type guard: true iff the value is a member of the shared
 * reason-code vocabulary.
 *
 * Source: core.md §0 lines 16-17.
 */
export function isSharedReasonCode(value: unknown): value is SharedReasonCode {
  return typeof value === 'string' && (SHARED_REASON_CODES as readonly string[]).includes(value);
}
