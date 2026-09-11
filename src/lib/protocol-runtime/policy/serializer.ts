/**
 * RTN-005 — Fulfillment Policy Authority: keyed asynchronous serialization
 * (INV-2-3's one-evaluation-per-key contract under concurrency).
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/core.md §2 Area 2, lines 121-123:
 *     "INV-2-3 (idempotency): one policy evaluation id per (intent,
 *      policy version, snapshot id); duplicate requests return the
 *      recorded evaluation."
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - The evaluation command awaits the evidence submission (the kernel
 *     port's void-or-Promise shape), so two concurrent evaluations of the
 *     same (intent, policy version, snapshot id) genuinely interleave at
 *     that microtask boundary unless serialized; this serializer keyed by
 *     the derived evaluation id restores the total order, making the
 *     one-record contract hold under concurrency exactly as it holds
 *     sequentially.
 *   - Rejected operations never poison the queue; completed keys are
 *     pruned.
 *
 * This helper is policy-domain-owned (surface discipline: RTN-005 owns
 * exactly the three domain prefixes, so no shared surface outside them is
 * invented).
 */

/**
 * Serializes async operations per string key: operations enqueued under the
 * same key run strictly one after another, in submission order; operations
 * under different keys run independently.
 *
 * Source: INV-2-3 (core.md lines 121-123 — "one policy evaluation id per
 * (intent, policy version, snapshot id)").
 */
export class KeyedSerializer {
  private readonly tails = new Map<string, Promise<unknown>>();

  /**
   * Run one operation under a key, strictly after any prior operation
   * enqueued under the same key settles (successfully or not). The returned
   * promise carries the operation's own outcome; a rejected prior operation
   * does not reject this one.
   *
   * Source: INV-2-3 (core.md lines 121-123).
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
