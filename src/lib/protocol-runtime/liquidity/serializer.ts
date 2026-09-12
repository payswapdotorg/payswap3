/**
 * RTN-007 — Liquidity Authority: keyed asynchronous serialization
 * (INV-6-2).
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §1 Area 6, lines
 *   55-57:
 *     "INV-6-2 (concurrency): position transitions occur only via the
 *      area 5 serialized ledger; pools are single-currency, so no
 *      cross-currency arithmetic occurs here."
 *   spec/architecture/v0.1/core.md §5 Area 5, lines 293-295:
 *     "The ledger is the concurrency frontier: all resource mutations
 *      pass through it in sequence order."
 *
 * Design (recorded in CONTRACT-REVIEW.md): every Liquidity Authority
 * command that drives a position runs INSIDE this serializer under the
 * POSITION id, and the ledger's own per-resource serialization runs
 * inside that (nested, disjoint lock domains — no deadlock). The double
 * serialization keeps the authority's projection fold, its evidence
 * submission, and the ledger mutation in one per-position total order:
 * concurrent commands against the same position observe each other's
 * ledger effects deterministically.
 *
 * This helper is liquidity-domain-owned (surface discipline: RTN-007 owns
 * exactly liquidity/, credit/, and queues/, so no shared surface outside
 * them is invented — the same discipline under which RTN-005/RTN-006
 * placed their own copies in each of their domains).
 */

/**
 * Serializes async operations per string key: operations enqueued under
 * the same key run strictly one after another, in submission order;
 * operations under different keys run independently.
 *
 * Source: INV-6-2 (liquidity-credit-queues.md lines 55-57) via core.md
 * lines 293-295 (the per-resource total order the ledger fronts).
 */
export class KeyedSerializer {
  private readonly tails = new Map<string, Promise<unknown>>();

  /**
   * Run one operation under a key, strictly after any prior operation
   * enqueued under the same key settles (successfully or not). The
   * returned promise carries the operation's own outcome; a rejected
   * prior operation does not reject this one.
   */
  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(key) ?? Promise.resolve();
    const outcome = prior.then(operation, operation);
    const tail = outcome.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    });
    return outcome;
  }

  /** Number of keys with in-flight work (observable for tests). */
  inFlight(): number {
    return this.tails.size;
  }
}
