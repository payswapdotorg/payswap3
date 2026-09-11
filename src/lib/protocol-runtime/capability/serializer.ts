/**
 * RTN-005 — Capability Authority: keyed asynchronous serialization
 * (INV-3-2).
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/core.md §3 Area 3, lines 179-181:
 *     "INV-3-2 (concurrency): commitment transitions are serialized per
 *      (capability, intent); capacity accounting is updated atomically with
 *      commitment state."
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - The authority serializes every capacity-affecting command under the
 *     CAPABILITY id — a strengthening that implies the spec's per-
 *     (capability, intent) key (two commands sharing (capability, intent)
 *     necessarily share the capability) and is REQUIRED for the second half
 *     of INV-3-2: capacity accounting is per-capability shared state, and
 *     the atomic check-then-update of reservation would otherwise inter-
 *     leave across different intents competing for the same capability.
 *   - Commands await the evidence submission (the kernel port's
 *     void-or-Promise shape), so concurrent commands genuinely interleave
 *     at that microtask boundary unless serialized; the serializer restores
 *     the total order.
 *   - Rejected operations never poison the queue; completed keys are
 *     pruned.
 *
 * This helper is capability-domain-owned (surface discipline: RTN-005 owns
 * exactly the three domain prefixes, so no shared surface outside them is
 * invented).
 */

/**
 * Serializes async operations per string key: operations enqueued under the
 * same key run strictly one after another, in submission order; operations
 * under different keys run independently.
 *
 * Source: INV-3-2 (core.md lines 179-181 — "commitment transitions are
 * serialized per (capability, intent)").
 */
export class KeyedSerializer {
  private readonly tails = new Map<string, Promise<unknown>>();

  /**
   * Run one operation under a key, strictly after any prior operation
   * enqueued under the same key settles (successfully or not). The returned
   * promise carries the operation's own outcome; a rejected prior operation
   * does not reject this one.
   *
   * Source: INV-3-2 (core.md lines 179-181).
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
