/**
 * RTN-008 — Clearing Authority: the deep-freeze helper (the
 * immutability discipline of the batch contents).
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §1 Area 9,
 *   lines 30-31:
 *     "States: OPEN -> STAGED -> COMMITTED -> FINAL.
 *      Contents are immutable after STAGED."
 *   spec/architecture/v0.1/README.md §3 GC-1 lines 39-43 (deterministic
 *     values).
 *
 * Materialization: "Contents are immutable after STAGED" is enforced at
 * TWO layers — the command surface (records are accepted only while
 * OPEN) and the value layer (records and the record list are deep-frozen
 * at every authority mutation; staged contents are frozen arrays, so a
 * mutation attempt on a frozen record throws in strict-mode ESM — the
 * immutability is machine-checkable).
 *
 * Surface discipline: this helper is clearing-domain-owned (RTN-008 owns
 * exactly clearing/ and obligations/; each carries its own copy — the
 * same discipline under which RTN-005/006/007 placed per-domain copies
 * of their helpers).
 */

/**
 * Recursively freeze a JSON-shaped value: every object and array in the
 * tree is Object.freeze'd. Frozen-in-place (no copy). Deterministic and
 * pure for JSON trees.
 *
 * Source: clearing-netting-settlement.md lines 30-31 ("Contents are
 * immutable after STAGED").
 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && (typeof value === 'object' || Array.isArray(value))) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
