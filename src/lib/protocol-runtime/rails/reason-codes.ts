/**
 * RTN-004 — Rails: the area-13/14 reason-code vocabulary.
 *
 * The kernel deliberately defines only the shared, area-agnostic vocabulary
 * (`UNKNOWN` — GC-2) and leaves area-specific codes to the areas' owning
 * materialization work orders (src/lib/protocol-runtime/kernel/
 * reason-codes.ts lines 16-22: "Area-specific reason codes ...
 * are owned by their areas' materialization work orders"). This module is
 * that vocabulary for areas 13-14.
 *
 * Spec sources (binding) — every code's class of meaning is grounded in
 * spec/architecture/v0.1/rails-adapters-reconciliation.md:
 *   - lines 74-78 (Failure and UNKNOWN semantics, Area 13):
 *     "Adapter-local failures (malformed payload, rail rejection at
 *      submission) map to FAILED with reason codes before any external
 *      effect occurs. After submission, any non-deterministic outcome maps
 *      to UNKNOWN"
 *   - lines 42-44 (UNKNOWN causes): "timeout, connection loss, ambiguous
 *      rail response"
 *   - lines 63-65 (INV-13-2): "payload hash is recorded at submission and
 *      re-checked on every report"
 *   - lines 31-32 (INV-13-1 / DEGRADED semantics): "DEGRADED adapters
 *      accept no new operations"
 *   - lines 45-46 + README.md §3 GC-2 lines 45-49: UNKNOWN is durable;
 *      re-submission is forbidden.
 *   - lines 151-154 (INV-14-2): "duplicate resolutions are rejected by case
 *      id"
 *   - lines 150-152 (INV-14-1): "closure requires a terminal resolution with
 *      recorded proof"
 *
 * Codes marked (implementation convention) below are deterministic
 * rejection labels for command-guard failures — the guards themselves are
 * spec-mandated (a state machine rejects illegal transitions), the exact
 * label strings are this surface's convention, recorded in
 * CONTRACT-REVIEW.md.
 */

/**
 * The frozen A13/A14 reason-code vocabulary. No member may be added without
 * a cited spec line (drift discipline: the kernel freezes its shared set the
 * same way).
 */
export const RAILS_REASON_CODES: readonly string[] = Object.freeze([
  // --- A13 submission-local failures (map to FAILED before any external
  // --- effect — rails-adapters-reconciliation.md lines 74-76)
  'PAYLOAD_MALFORMED',
  'RAIL_REJECTED_SUBMISSION',
  // --- A13 UNKNOWN causes (lines 42-44: "timeout, connection loss,
  // --- ambiguous rail response"; also INV-13-4 silence)
  'TIMEOUT',
  'CONNECTION_LOSS',
  'AMBIGUOUS_RAIL_RESPONSE',
  'SILENCE',
  // --- A13 payload-hash discipline (INV-13-2, lines 63-65)
  'PAYLOAD_HASH_MISMATCH',
  // --- A13 lifecycle guards (implementation convention for the
  // --- spec-mandated rejections: DEGRADED accepts no new operations, lines
  // --- 31-32; submission requires AUTHORIZED — the GC-2 machine check)
  'ADAPTER_NOT_FOUND',
  'ADAPTER_NOT_ACTIVE',
  'OPERATION_NOT_FOUND',
  'OPERATION_NOT_AUTHORIZED',
  'ILLEGAL_TRANSITION',
  // --- A14 case lifecycle guards (INV-14-1/INV-14-2 mandate the rejections;
  // --- labels are implementation convention)
  'CASE_NOT_FOUND',
  'CASE_NOT_OPEN',
  'CASE_NOT_INVESTIGATING',
  'DUPLICATE_RESOLUTION',
  'RESOLUTION_NOT_APPLICABLE',
  'PROOF_REQUIRED',
  'ADJUSTMENT_NOT_POSSIBLE',
  // --- A14 cycle/source guards (implementation convention for the
  // --- spec-mandated lifecycle + untrusted-input sequence discipline,
  // --- lines 139-141)
  'CYCLE_NOT_FOUND',
  'CYCLE_NOT_OPEN',
  'CYCLE_NOT_COLLECTED',
  'CYCLE_NOT_MATCHED',
  'SOURCE_NOT_FOUND',
  'SOURCE_NOT_REGISTERED',
  'SEQUENCE_REGRESSION',
  'MATCHING_RULE_VERSION_UNSUPPORTED',
]);

/**
 * Runtime type guard: true iff the value is a member of the rails
 * reason-code vocabulary.
 */
export function isRailsReasonCode(value: unknown): value is string {
  return typeof value === 'string' && (RAILS_REASON_CODES as readonly string[]).includes(value);
}
