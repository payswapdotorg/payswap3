/**
 * RTN-006 — Reservation Authority: keyed asynchronous serialization
 * (INV-5-2).
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/core.md §5 Area 5, lines 293-295:
 *     "ReservationLedger — per-resource serialized log of reservation
 *      transitions. The ledger is the concurrency frontier: all resource
 *      mutations pass through it in sequence order."
 *   lines 307-309 (INV-5-2):
 *     "INV-5-2 (concurrency): transitions for the same resource are
 *      totally ordered by the ledger sequence; a REQUESTED transition
 *      either becomes HELD or is rejected — never left ambiguous."
 *
 * Design (recorded in CONTRACT-REVIEW.md): the ledger serializes every
 * resource mutation under the RESOURCE id — exactly the per-resource total
 * order INV-5-2 names. Two concurrent requests competing for one resource
 * interleave at the evidence submission's microtask boundary unless
 * serialized; the serializer restores the total order, and each request's
 * decision is computed against the post-prior-transition accounting, so
 * concurrent REQUESTED resolution is deterministic under submission order.
 *
 * This helper is reservations-domain-owned (surface discipline: RTN-006
 * owns exactly the two domain prefixes routing/ and reservations/, so no
 * shared surface outside them is invented — the same discipline under
 * which RTN-005 placed its own copy in each of its domains).
 */

/**
 * Serializes async operations per string key: operations enqueued under the
 * same key run strictly one after another, in submission order; operations
 * under different keys run independently.
 *
 * Source: INV-5-2 (core.md lines 293-295, 307-309 — per-resource total
 * order through the ledger).
 */
export class KeyedSerializer {
  private readonly tails = new Map<string, Promise<unknown>>();

  /**
   * Run one operation under a key, strictly after any prior operation
   * enqueued under the same key settles (successfully or not). The returned
   * promise carries the operation's own outcome; a rejected prior operation
   * does not reject this one.
   *
   * Source: INV-5-2 (core.md lines 307-309).
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
