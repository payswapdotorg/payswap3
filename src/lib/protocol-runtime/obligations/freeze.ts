/**
 * RTN-008 — Obligation Ledger Authority: the deep-freeze helper (the
 * INV-10-1 immutability discipline).
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §2 Area 10,
 *   lines 113-116:
 *     "INV-10-1 (financial correctness): obligations are integer Money
 *      per currency; the ledger never mutates an amount after creation —
 *      corrections are new linked obligations."
 *   spec/architecture/v0.1/README.md §3 GC-1 lines 39-43.
 *
 * Materialization: "the ledger never mutates an amount after creation" is
 * enforced at THREE layers — the command surface (no transition command
 * carries an amount; amount mutation is unrepresentable in the write
 * types), the value layer (obligation records and ledger entries are
 * deep-frozen at mint, so a mutation attempt on a frozen record throws
 * in strict-mode ESM — machine-checkable), and the log layer (the ledger
 * has no update/delete/clear member; corrections are new linked
 * obligations, never rewrites).
 *
 * Surface discipline: obligations-domain-owned (RTN-008 owns exactly
 * clearing/ and obligations/; each carries its own copy — the same
 * discipline under which RTN-005/006/007 placed per-domain copies).
 */

/**
 * Recursively freeze a JSON-shaped value: every object and array in the
 * tree is Object.freeze'd. Frozen-in-place (no copy). Deterministic and
 * pure for JSON trees.
 *
 * Source: INV-10-1 (clearing-netting-settlement.md lines 113-116).
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
