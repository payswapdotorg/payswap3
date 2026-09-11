/**
 * RTN-005 — Intent Authority: keyed asynchronous serialization (INV-1-2).
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/core.md §1 Area 1, lines 57-59:
 *     "INV-1-2 (concurrency): state transitions are serialized per intent
 *      id. Concurrent submissions carrying the same idempotency key collapse
 *      to one intent and one receipt."
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - Every command of the authority is an async operation that awaits the
 *     evidence submission (the kernel port's void-or-Promise shape — awaiting
 *     the synchronous real-log submit still yields a microtask boundary).
 *     Two commands issued back-to-back on the same key therefore genuinely
 *     interleave unless serialized; this serializer restores the total order
 *     INV-1-2 requires.
 *   - The serializer is per-key: for the submit command the key is the
 *     derived intent id (the idempotency key determines the intent id — one
 *     key, one intent), and for transition commands the key is the intent
 *     id, exactly "serialized per intent id".
 *   - Rejected operations never poison the queue: the tail chain runs the
 *     next operation regardless of the prior outcome.
 *   - Completed keys are pruned (the map holds only in-flight work), so the
 *     serializer does not grow with intent count.
 *
 * This helper is intent-domain-owned (surface discipline: RTN-005 owns
 * exactly src/lib/protocol-runtime/intent/|policy/|capability/, so the three
 * domains each carry their own copy rather than inventing a shared surface
 * outside the owned prefixes).
 */

/**
 * Serializes async operations per string key: operations enqueued under the
 * same key run strictly one after another, in submission order; operations
 * under different keys run independently.
 *
 * Source: INV-1-2 (core.md lines 57-59 — "state transitions are serialized
 * per intent id").
 */
export class KeyedSerializer {
  private readonly tails = new Map<string, Promise<unknown>>();

  /**
   * Run one operation under a key, strictly after any prior operation
   * enqueued under the same key settles (successfully or not). The returned
   * promise carries the operation's own outcome; a rejected prior operation
   * does not reject this one.
   *
   * Source: INV-1-2 (core.md lines 57-59).
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
