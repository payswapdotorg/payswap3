/**
 * RTN-009 — Netting Authority: the deep-freeze value discipline.
 *
 * Domain-owned copy of the RTN-008 obligations/freeze.ts helper (the
 * surface discipline: RTN-009 owns exactly netting/ and settlement/;
 * sibling-domain internals are not imported).
 *
 * Source: clearing-netting-settlement.md §3 Area 11 lines 177-189 (the INV
 * contracts whose value layer this guards); §2 Area 10 lines 113-116
 * (INV-10-1 — the same discipline the A10 records follow).
 */

/**
 * Deep-freeze a value: every object and array in the tree, recursively.
 * Records minted through this are immutable at the value layer —
 * mutation attempts throw in strict-mode ESM (machine-checkable).
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || (typeof value !== 'object' && !Array.isArray(value))) {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
