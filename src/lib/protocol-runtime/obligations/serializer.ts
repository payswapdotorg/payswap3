/**
 * RTN-008 — Obligation Ledger Authority: keyed asynchronous
 * serialization (INV-10-2).
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §2 Area 10,
 *   lines 117-118:
 *     "INV-10-2 (concurrency): ledger transitions are serialized by
 *      sequence; each obligation transitions at most once per state."
 *
 * Design (recorded in CONTRACT-REVIEW.md): EVERY Obligation Ledger
 * Authority command runs under ONE global ledger key — the ledger is one
 * totally-sequenced log, and the single lane is the machine-checkable
 * form of "ledger transitions are serialized by sequence". This helper
 * is obligations-domain-owned (surface discipline: RTN-008 owns exactly
 * clearing/ and obligations/; the same discipline under which
 * RTN-005/006/007 placed their own per-domain copies).
 */

/**
 * Serializes async operations per string key: operations enqueued under
 * the same key run strictly one after another, in submission order;
 * operations under different keys run independently.
 *
 * Source: INV-10-2 (clearing-netting-settlement.md lines 117-118).
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
