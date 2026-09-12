/**
 * RTN-006 — Routing Authority: keyed asynchronous serialization.
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/core.md §4 Area 4, lines 245-249:
 *     "INV-4-2 (concurrency): a plan is compiled against one capability
 *      snapshot id; dispatch acquires reservations (area 5) in the plan's
 *      fixed hop order.
 *      INV-4-3 (idempotency): compilation is keyed by (intent id, compiler
 *      version, snapshot id); identical inputs return the identical plan."
 *
 * Design (recorded in CONTRACT-REVIEW.md): the authority serializes every
 * plan command under the PLAN id — the derived compilation key of INV-4-3.
 * Two concurrent commands naming the same key necessarily name the same
 * plan; commands on different plans run independently. The compile command
 * awaits the evidence submission (the kernel port's void-or-Promise shape),
 * so concurrent compilations genuinely interleave at that microtask
 * boundary unless serialized; the serializer restores the total order and
 * makes INV-4-3's identical-inputs-identical-plan collapse structural.
 *
 * This helper is routing-domain-owned (surface discipline: RTN-006 owns
 * exactly the two domain prefixes routing/ and reservations/, so no shared
 * surface outside them is invented — the same discipline under which
 * RTN-005 placed its own copy in each of its domains).
 */

/**
 * Serializes async operations per string key: operations enqueued under the
 * same key run strictly one after another, in submission order; operations
 * under different keys run independently.
 *
 * Source: INV-4-2/INV-4-3 (core.md lines 245-249 — compilation keyed and
 * dispatch ordered per plan).
 */
export class KeyedSerializer {
  private readonly tails = new Map<string, Promise<unknown>>();

  /**
   * Run one operation under a key, strictly after any prior operation
   * enqueued under the same key settles (successfully or not). The returned
   * promise carries the operation's own outcome; a rejected prior operation
   * does not reject this one.
   *
   * Source: INV-4-2/INV-4-3 (core.md lines 245-249).
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
