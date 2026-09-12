/**
 * RTN-007 — Credit Authority: keyed asynchronous serialization (INV-7-2).
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §2 Area 7, lines
 *   122-124:
 *     "INV-7-2 (concurrency): exposure mutations are serialized per
 *      credit line; two concurrent approvals cannot both count the same
 *      remaining limit."
 *   spec/architecture/v0.1/core.md §5 Area 5, lines 293-295:
 *     "The ledger is the concurrency frontier: all resource mutations
 *      pass through it in sequence order."
 *
 * Design (recorded in CONTRACT-REVIEW.md): every Credit Authority command
 * that reads or mutates a line's exposure (evaluate, apply, consume,
 * release, expiry refold) runs INSIDE this serializer under the LINE id,
 * and the ledger's own per-resource serialization (the line IS the
 * resource) runs inside that — the double serialization keeps the
 * authority's exposure view, its decision records, its evidence
 * submissions, and the ledger mutation in one per-line total order, which
 * is exactly "exposure mutations are serialized per credit line".
 *
 * This helper is credit-domain-owned (surface discipline: RTN-007 owns
 * exactly liquidity/, credit/, and queues/ — the same discipline under
 * which RTN-005/RTN-006/RTN-007-liquidity placed their own copies in
 * each of their domains).
 */

/**
 * Serializes async operations per string key: operations enqueued under
 * the same key run strictly one after another, in submission order;
 * operations under different keys run independently.
 *
 * Source: INV-7-2 (liquidity-credit-queues.md lines 122-124) via core.md
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
