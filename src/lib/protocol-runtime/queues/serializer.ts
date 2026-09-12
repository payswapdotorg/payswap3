/**
 * RTN-007 — Queue Authority: keyed asynchronous serialization (INV-8-2).
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §3 Area 8, lines
 *   185-187:
 *     "INV-8-2 (concurrency): an item is resident in exactly one queue;
 *      eligibility evaluation is serialized per queue; no item is
 *      dispatched twice — dispatch is exactly-once per item id."
 *
 * Design (recorded in CONTRACT-REVIEW.md): every Queue Authority command
 * that mutates items of one queue (enqueue, eligibility evaluation,
 * dispatch, cancellation, expiry, resolution) runs INSIDE this serializer
 * under the QUEUE id — the per-queue total order INV-8-2 names. The
 * item-residency registry (the global item-id map) is updated inside the
 * same serialized sections, so the exactly-one-residency contract holds
 * under concurrency.
 *
 * This helper is queues-domain-owned (surface discipline: RTN-007 owns
 * exactly liquidity/, credit/, and queues/ — the same discipline under
 * which RTN-005/RTN-006 and this item's sibling domains placed their own
 * copies in each of their domains).
 */

/**
 * Serializes async operations per string key: operations enqueued under
 * the same key run strictly one after another, in submission order;
 * operations under different keys run independently.
 *
 * Source: INV-8-2 (liquidity-credit-queues.md lines 185-187).
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
