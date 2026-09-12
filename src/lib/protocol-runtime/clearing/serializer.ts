/**
 * RTN-008 — Clearing Authority: keyed asynchronous serialization
 * (INV-9-2).
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §1 Area 9,
 *   lines 52-54:
 *     "INV-9-2 (concurrency): batches are processed in sequence order;
 *      record deduplication keys (origin activity id) guarantee a
 *      committed batch produces each obligation exactly once."
 *
 * Design (recorded in CONTRACT-REVIEW.md): EVERY Clearing Authority
 * command runs under ONE global pipeline key — the batch pipeline is a
 * single sequenced lane (the rank-monotonicity gate plus this serializer
 * is the machine-checkable form of "batches are processed in sequence
 * order"). This helper is clearing-domain-owned (surface discipline:
 * RTN-008 owns exactly clearing/ and obligations/; the same discipline
 * under which RTN-005/006/007 placed their own per-domain copies).
 */

/**
 * Serializes async operations per string key: operations enqueued under
 * the same key run strictly one after another, in submission order;
 * operations under different keys run independently.
 *
 * Source: INV-9-2 (clearing-netting-settlement.md lines 52-54).
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
