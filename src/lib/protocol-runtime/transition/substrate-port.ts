/**
 * RTN-011 — Transition runtime: the substrate port (structural).
 *
 * The narrow, structural view of the DEP-003 durable execution substrate's
 * PUBLIC API that the transition runtime integrates through — exactly the
 * documented integration point:
 *
 *   src/lib/durable/index.ts, module doc, lines 14-18:
 *     "Hard boundary: the substrate executes jobs via REGISTERED HANDLERS
 *      only. register(kind, handler) is the single integration point; this
 *      module hosts no financial authority, decides no financial outcomes,
 *      computes no balances, and signs nothing. Future protocol authorities
 *      plug in via register() and own their own evidence via
 *      recordEvent(type, data, owner)."
 *
 * This module is TYPE-ONLY relative to the substrate: every import from
 * src/lib/durable/ is an `import type` (erased at load time), so the
 * transition core stays loadable in the bun test runtime (bun does not
 * implement node:sqlite — the repository's documented split: bun suites
 * cover the in-process surfaces; the REAL substrate compositions run in
 * plain-Node harnesses, e.g. scripts/test_protocol_transition_hosting.mjs,
 * which bind this port to the real runtime via
 * hosting/durable-binding.ts).
 *
 * Spec sources (binding):
 *   spec/durable/execution.md §9, lines 174-179:
 *     "register(kind, handler) is the ONLY integration point: the worker
 *      reserves exclusively jobs whose kind has a registered handler."
 *   spec/durable/execution.md §6, lines 125-133 (the enqueue contract —
 *     UNIQUE (idempotency_key, kind) dedupe).
 *   spec/durable/execution.md §11, lines 212-218 (durable_events with the
 *     mandatory owner column; recordEvent() rejects an empty owner).
 *   spec/deployment/topology.md, authoritative-state-store, line 188:
 *     "mutated only by transition-runtime through protocol-owned
 *      transitions — no other layer may mutate it directly (hard boundary)."
 *   deploy/contracts/components.json, transition-runtime, health_signal:
 *     "Transition backlog depth and age; authoritative-state consistency
 *      probes (contract for the future work item)."
 */

import type { DurableJob, DurableJobStatus, EnqueueOptions, EnqueueResult } from '../../durable/queue.ts';

/**
 * Read-only queue insights backing the transition backlog probe
 * (components.json transition-runtime health_signal: "Transition backlog
 * depth and age"). The real binding implements this over the substrate's
 * db API (static SELECTs over durable_jobs) and queue.stats(); the
 * bun-runtime test double implements it over its in-memory rows.
 *
 * Source: deploy/contracts/components.json, transition-runtime,
 * health_signal — "Transition backlog depth and age; authoritative-state
 * consistency probes".
 */
export interface TransitionQueueInsights {
  /** Per-status durable_jobs counts (the queue's public stats() shape). */
  stats(): Record<DurableJobStatus, number>;
  /**
   * The backlog extremes: the oldest NON-TERMINAL job (by created_at —
   * when the oldest unfinished command entered the system) and the oldest
   * WAITING job (by available_at — eligible-for-reservation age; null
   * when nothing is waiting). Read-only; never mutates job rows.
   */
  backlogExtremes(): {
    readonly oldestBacklog: { readonly jobId: string; readonly createdAt: number } | null;
    readonly oldestEligible: { readonly jobId: string; readonly availableAt: number } | null;
  };
}

/**
 * The structural substrate port the transition runtime integrates
 * through: the public register()/enqueue()/recordEvent() surface plus the
 * read-only queue insights for the health-signal probes.
 *
 * The real DEP-003 runtime (src/lib/durable/index.ts DurableRuntime)
 * satisfies register/enqueue/recordEvent structurally; the queue-insights
 * reader is adapted in hosting/durable-binding.ts (the substrate's
 * documented db API, read-only). Test doubles implement the same shape
 * in-memory (transition/substrate-double.ts).
 *
 * Source: src/lib/durable/index.ts lines 14-18 (the documented
 * integration point quoted above); spec/durable/execution.md §6/§9/§11.
 */
export interface TransitionSubstrate {
  /** THE integration point: register the handler that executes a job kind. */
  register(kind: string, handler: (job: DurableJob) => void | Promise<void>): unknown;
  /** The public enqueue path (deduplicated by (kind, idempotencyKey)). */
  enqueue(kind: string, payload: unknown, options?: EnqueueOptions): EnqueueResult;
  /**
   * Record one durable_events row under a non-empty owner. Hosted
   * authorities own their observation rows ("own their own evidence via
   * recordEvent(type, data, owner)").
   */
  recordEvent(type: string, data: unknown, owner: string, jobId?: string | null): unknown;
  /** Read-only queue insights for the backlog probe. */
  readonly queue: TransitionQueueInsights;
}
