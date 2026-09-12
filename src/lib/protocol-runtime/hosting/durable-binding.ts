/**
 * RTN-011 — Authority hosting: the REAL substrate binding.
 *
 * Node/server-side ONLY (this module VALUE-imports the DEP-003 substrate's
 * individually-loadable public modules — db, queue, worker, scheduler,
 * events — whose db layer requires node:sqlite; bun does not implement
 * it, so the bun suites bind the same ports to the owned in-memory double
 * in transition/substrate-double.ts, and the plain-Node harness
 * scripts/test_protocol_transition_hosting.mjs binds them HERE).
 *
 * IMPORTANT (composition decision, recorded): the substrate BARREL
 * (src/lib/durable/index.ts) uses extensionless relative imports and is
 * documented as "intended to be loaded by the application's module
 * bundler (Next.js server runtime), never by plain Node scripts — the
 * underlying modules (db/queue/worker/scheduler/events) are individually
 * loadable in plain Node and are exercised that way by
 * scripts/test_durable.mjs". This module follows exactly that documented
 * precedent: openTransitionSubstrate() composes the SAME public modules
 * with the SAME wiring init() performs (queue lifecycle events recorded
 * under SUBSTRATE_EVENT_OWNER; worker over the queue; scheduleRecurring
 * over the queue) — nothing outside the substrate's public API is
 * touched, and the resulting handle satisfies the same structural shape
 * as the barrel's DurableRuntime, so asTransitionSubstrate() accepts
 * BOTH (the Next.js server runtime passes its barrel runtime; the Node
 * harness passes this composition).
 *
 * Spec sources (binding): spec/durable/execution.md §6/§9/§10/§11/§13
 * (the public contract this binding uses); src/lib/durable/index.ts
 * lines 14-18 (the documented integration point: "Future protocol
 * authorities plug in via register() and own their own evidence via
 * recordEvent(type, data, owner)") and lines 20-25 (the barrel's
 * plain-Node note quoted above); spec/deployment/topology.md line 188
 * (the single-writer hard boundary); the merged persistence convention
 * (per-domain stores with per-domain migrations on the DEP-003 db layer
 * — openKernelStore is the reference).
 */

import { openDurableDatabase } from '../../durable/db.ts';
import { DurableQueue } from '../../durable/queue.ts';
import { DurableWorker } from '../../durable/worker.ts';
import {
  recordEvent as recordEventOnDatabase,
  SUBSTRATE_EVENT_OWNER,
} from '../../durable/events.ts';
import {
  scheduleRecurring as scheduleRecurringOnQueue,
} from '../../durable/scheduler.ts';
import type { DurableDatabase } from '../../durable/db.ts';
import type { DurableQueue as DurableQueueType, EnqueueOptions, EnqueueResult } from '../../durable/queue.ts';
import type { DurableJobHandler } from '../../durable/worker.ts';
import type { RecurringSchedule, TickPayloadFn } from '../../durable/scheduler.ts';
import type { TransitionSubstrate, TransitionQueueInsights } from '../transition/substrate-port.ts';
import type { SchedulerSubstratePort } from './scheduler-wiring.ts';
import type { AuthorityPersistHooks } from './bindings.ts';
import type { EvidenceSubmission, EvidenceSubmissionRecord } from '../kernel/ports.ts';
import type { PaymentIntent, IntentReceipt } from '../intent/types.ts';
import type { ReservationLedger } from '../reservations/ledger.ts';
import type { ObligationLedgerAuthority } from '../obligations/authority.ts';
import type { SettlementAuthority } from '../settlement/authority.ts';
import type { ClearingAuthority } from '../clearing/authority.ts';
import type { NettingAuthority } from '../netting/authority.ts';
import type { QueueAuthority } from '../queues/authority.ts';
import {
  writePaymentIntent,
  writeIntentState,
  writeIntentReceipt,
} from '../intent/persistence.ts';
import { persistLedgerSnapshot } from '../reservations/persistence.ts';
import {
  readEntries as readObligationEntries,
  writeEntry as writeObligationEntry,
} from '../obligations/persistence.ts';
import {
  readInstructions,
  readAttempts,
  readFinalities,
  writeInstruction,
  updateInstructionState,
  writeAttempt,
  updateAttemptState,
  writeFinality,
  updateFinalityState,
} from '../settlement/persistence.ts';
import {
  writeBatch as writeClearingBatch,
  writeRecords as writeClearingRecords,
} from '../clearing/persistence.ts';
import {
  readNettingSets,
  readNetObligations,
  writeNettingSet,
  updateNettingSet,
  writeNetObligation,
  updateNetObligationState,
} from '../netting/persistence.ts';
import { writeQueue, writeQueuedItem } from '../queues/persistence.ts';

// Static, read-only SQL for the backlog probe (the db API's documented
// prepare() channel; no mutation, no data interpolation).
const SQL_OLDEST_BACKLOG =
  "SELECT id, created_at FROM durable_jobs WHERE status IN ('queued', 'failed', 'reserved') ORDER BY created_at ASC, id ASC LIMIT 1";
const SQL_OLDEST_ELIGIBLE =
  "SELECT id, available_at FROM durable_jobs WHERE status IN ('queued', 'failed') ORDER BY available_at ASC, id ASC LIMIT 1";

/**
 * The structural shape of a substrate runtime handle this binding
 * accepts: the barrel's DurableRuntime (Next.js server runtime) and
 * openTransitionSubstrate's composition (plain Node) both satisfy it.
 *
 * Source: src/lib/durable/index.ts (DurableRuntime: register/enqueue/
 * recordEvent/scheduleRecurring + database + queue — the public API).
 */
export interface TransitionSubstrateRuntimeHandle {
  readonly database: DurableDatabase;
  readonly queue: DurableQueueType;
  register(kind: string, handler: DurableJobHandler): unknown;
  enqueue(kind: string, payload: unknown, options?: EnqueueOptions): EnqueueResult;
  recordEvent(type: string, data: unknown, owner: string, jobId?: string | null): unknown;
}

/**
 * Compose the durable execution substrate from its individually-loadable
 * public modules — the same wiring the barrel's init() performs (queue
 * lifecycle events recorded under SUBSTRATE_EVENT_OWNER through the
 * events module's recordEvent; the worker over the queue; schedules
 * tracked for stop()) — for plain-Node compositions (the harness, and any
 * non-bundled server runtime).
 *
 * Source: src/lib/durable/index.ts init() (the mirrored composition);
 * scripts/test_durable.mjs (the substrate's own plain-Node precedent);
 * spec/durable/execution.md §2 (the worker defaults these options tune).
 */
export interface OpenTransitionSubstrateOptions {
  readonly dbPath?: string;
  readonly migrationsDir?: string;
  readonly workerId?: string;
  readonly concurrency?: number;
  readonly leaseMs?: number;
  readonly pollIntervalMs?: number;
  readonly backoffBaseMs?: number;
  readonly backoffMaxMs?: number;
}

export interface HostedDurableSubstrate extends TransitionSubstrateRuntimeHandle {
  readonly worker: DurableWorker;
  scheduleRecurring(
    kind: string,
    payloadFn: TickPayloadFn,
    intervalMs: number,
    options?: Parameters<typeof scheduleRecurringOnQueue>[4],
  ): RecurringSchedule;
  /** Full teardown: stop the worker and close the database. */
  close(): void;
}

export function openTransitionSubstrate(
  options: OpenTransitionSubstrateOptions = {},
): HostedDurableSubstrate {
  const database = openDurableDatabase({
    ...(options.dbPath === undefined ? {} : { dbPath: options.dbPath }),
    ...(options.migrationsDir === undefined ? {} : { migrationsDir: options.migrationsDir }),
  });
  const queue = new DurableQueue(database, {
    ...(options.backoffBaseMs === undefined ? {} : { backoffBaseMs: options.backoffBaseMs }),
    ...(options.backoffMaxMs === undefined ? {} : { backoffMaxMs: options.backoffMaxMs }),
    emitEvent: (event) => {
      recordEventOnDatabase(database, event.type, event.data, SUBSTRATE_EVENT_OWNER, event.jobId);
    },
  });
  const worker = new DurableWorker({
    queue,
    ...(options.workerId === undefined ? {} : { workerId: options.workerId }),
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    ...(options.leaseMs === undefined ? {} : { leaseMs: options.leaseMs }),
    ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
  });
  const schedules: RecurringSchedule[] = [];
  const instance: HostedDurableSubstrate = {
    database,
    queue,
    worker,
    register(kind, handler) {
      worker.register(kind, handler);
      return instance;
    },
    enqueue(kind, payload, enqueueOptions) {
      return queue.enqueue(kind, payload, enqueueOptions);
    },
    recordEvent(type, data, owner, jobId) {
      return recordEventOnDatabase(database, type, data, owner, jobId);
    },
    scheduleRecurring(kind, payloadFn, intervalMs, recurringOptions) {
      const schedule = scheduleRecurringOnQueue(
        queue,
        kind,
        payloadFn,
        intervalMs,
        recurringOptions,
      );
      schedules.push(schedule);
      return schedule;
    },
    close() {
      for (const schedule of schedules) {
        schedule.stop();
      }
      worker.stop();
      database.close();
    },
  };
  return instance;
}

/**
 * Adapt a substrate runtime handle onto the transition runtime's
 * substrate port: register()/enqueue()/recordEvent() pass straight
 * through (the handle satisfies them structurally); the queue-insights
 * reader is backed by queue.stats() plus the two read-only SELECTs above
 * over the db API.
 *
 * Source: src/lib/durable/index.ts lines 14-18 (the integration point);
 * spec/durable/execution.md §6/§9/§11; deploy/contracts/components.json
 * transition-runtime health_signal ("Transition backlog depth and age").
 */
export function asTransitionSubstrate(runtime: TransitionSubstrateRuntimeHandle): TransitionSubstrate {
  const database = runtime.database;
  const insights: TransitionQueueInsights = {
    stats: () => runtime.queue.stats(),
    backlogExtremes: () => {
      const backlogRow = database.prepare(SQL_OLDEST_BACKLOG).get() as
        | (Record<string, unknown> & { id: unknown; created_at: unknown })
        | undefined;
      const eligibleRow = database.prepare(SQL_OLDEST_ELIGIBLE).get() as
        | (Record<string, unknown> & { id: unknown; available_at: unknown })
        | undefined;
      return {
        oldestBacklog: backlogRow
          ? { jobId: String(backlogRow.id), createdAt: Number(backlogRow.created_at) }
          : null,
        oldestEligible: eligibleRow
          ? { jobId: String(eligibleRow.id), availableAt: Number(eligibleRow.available_at) }
          : null,
      };
    },
  };
  return {
    register: (kind, handler) => runtime.register(kind, handler as DurableJobHandler),
    enqueue: (kind: string, payload: unknown, options?: EnqueueOptions): EnqueueResult =>
      runtime.enqueue(kind, payload, options),
    recordEvent: (type, data, owner, jobId) => runtime.recordEvent(type, data, owner, jobId),
    queue: insights,
  };
}

/**
 * Adapt a substrate runtime handle onto the scheduler wiring's port
 * (scheduleRecurring passes straight through — the recurring command
 * emitters get enqueueing capability ONLY, per the scheduler boundary:
 * "owns timing only, never mutates authoritative state").
 *
 * Source: spec/durable/execution.md §10/§13 (scheduleRecurring); the
 * scheduler boundary (topology.md lines 156-157, 217).
 */
export function asSchedulerSubstrate(
  runtime: HostedDurableSubstrate | (TransitionSubstrateRuntimeHandle & {
    scheduleRecurring(
      kind: string,
      payloadFn: TickPayloadFn,
      intervalMs: number,
      options?: Parameters<typeof scheduleRecurringOnQueue>[4],
    ): RecurringSchedule;
  }),
): SchedulerSubstratePort {
  return {
    scheduleRecurring: (kind, payloadFn, intervalMs, options) =>
      runtime.scheduleRecurring(kind, payloadFn as TickPayloadFn, intervalMs, options as never),
  };
}

// ---------------------------------------------------------------------------
// The rails evidence registry-name adapter
// ---------------------------------------------------------------------------

/**
 * The A13 rails modules submit evidence under their local constant
 * 'Rail Adapter Authority' (the v0.1 Area 13 prose name), while the real
 * A15 log validates authority names against the registry's closed set,
 * which names area 13's owning authority 'Rail Authority'
 * (spec/registry/protocol-registry.json A13: owningAuthority
 * "Rail Authority"; evidence/record.ts EVIDENCE_AUTHORITIES). The merged
 * rails suites exercised the authorities over rails' own in-surface
 * evidence double, so this seam was never composed before RTN-011.
 *
 * This adapter maps the local name onto the REGISTRY name on the hosting
 * boundary — the record's authority slot becomes the registry's owning
 * authority identity for area 13, which is what A15 requires. The mapping
 * is recorded as an interpretation decision in CONTRACT-REVIEW.md and
 * flagged for governed reconciliation (the rails domain's local constant
 * versus the registry name) in the completion report.
 *
 * Source: spec/registry/protocol-registry.json (A13 owningAuthority "Rail
 * Authority"); src/lib/protocol-runtime/evidence/record.ts
 * (EVIDENCE_AUTHORITIES — the closed set the log validates against);
 * rails/authority.ts (RAIL_ADAPTER_AUTHORITY_ID — the local prose name).
 */
const RAIL_ADAPTER_AUTHORITY_LOCAL_NAME = 'Rail Adapter Authority';
const RAIL_AUTHORITY_REGISTRY_NAME = 'Rail Authority';

export function adaptRailEvidenceToRegistryNames(evidence: EvidenceSubmission): EvidenceSubmission {
  return {
    submit(record: EvidenceSubmissionRecord): void {
      if (record.authority === RAIL_ADAPTER_AUTHORITY_LOCAL_NAME) {
        evidence.submit({ ...record, authority: RAIL_AUTHORITY_REGISTRY_NAME });
        return;
      }
      evidence.submit(record);
    },
  };
}

// ---------------------------------------------------------------------------
// The durable write-through hooks (read-diff-write over the merged bridges)
// ---------------------------------------------------------------------------

/**
 * Build the per-domain durable write-through hooks over OPEN per-domain
 * stores (the merged persistence convention: one store per domain, on
 * the DEP-003 database layer). Every hook is IDEMPOTENT — it reads the
 * persisted rows, diffs against the authority's committed state, and
 * writes only what is new or changed — so the at-least-once redelivery
 * of a command re-persists the same rows without duplication.
 *
 * The clearing hook's batchLabel is an insert-only column (the merged
 * UPSERT never updates it on conflict): the open/tick command — which
 * carries the label — always precedes the stage/commit/finalize commands
 * of the same batch in the command sequence, so the label is recorded
 * with the first write.
 *
 * Source: the merged persistence convention (README "Persistence
 * convention" — per-domain stores, per-domain migrations, DEP-003 db
 * layer read-only); RTN-011.md line 14 ("commit state atomically" — the
 * durable write-through lands after the A15 evidence record).
 */
export function buildDurablePersistHooks(stores: {
  readonly intent?: DurableDatabase;
  readonly reservations?: DurableDatabase;
  readonly obligations?: DurableDatabase;
  readonly settlement?: DurableDatabase;
  readonly clearing?: DurableDatabase;
  readonly netting?: DurableDatabase;
  readonly queues?: DurableDatabase;
}): AuthorityPersistHooks {
  return {
    ...(stores.intent
      ? {
          intent: (intent: PaymentIntent, receipt?: IntentReceipt) => {
            const store = stores.intent as DurableDatabase;
            writePaymentIntent(store, intent);
            writeIntentState(store, intent);
            if (receipt) {
              writeIntentReceipt(store, receipt);
            }
          },
        }
      : {}),
    ...(stores.reservations
      ? {
          reservations: (ledger: ReservationLedger) => {
            const store = stores.reservations as DurableDatabase;
            const resourceIds = [
              ...new Set(ledger.reservations().map((reservation) => reservation.resourceId)),
            ];
            persistLedgerSnapshot(store, {
              entries: ledger.entries(),
              reservations: ledger.reservations(),
              resourceAccountings: resourceIds
                .map((resourceId) => ledger.resourceAccounting(resourceId))
                .filter((accounting): accounting is NonNullable<typeof accounting> => accounting !== undefined),
            });
          },
        }
      : {}),
    ...(stores.obligations
      ? {
          obligations: (authority: ObligationLedgerAuthority) => {
            const store = stores.obligations as DurableDatabase;
            const persisted = new Set(
              readObligationEntries(store).map((entry) => entry.sequence),
            );
            for (const entry of authority.log.entriesSnapshot()) {
              if (!persisted.has(entry.sequence)) {
                writeObligationEntry(store, entry);
              }
            }
          },
        }
      : {}),
    ...(stores.settlement
      ? {
          settlement: (authority: SettlementAuthority) => {
            const store = stores.settlement as DurableDatabase;
            const persistedInstructions = new Map(
              readInstructions(store).map((instruction) => [instruction.instructionId, instruction.state]),
            );
            for (const instruction of authority.listInstructions()) {
              const persistedState = persistedInstructions.get(instruction.instructionId);
              if (persistedState === undefined) {
                writeInstruction(store, instruction);
              } else if (persistedState !== instruction.state) {
                updateInstructionState(store, instruction);
              }
            }
            const persistedAttempts = new Map(
              readAttempts(store).map((attempt) => [attempt.attemptId, attempt.state]),
            );
            for (const attempt of authority.listAttempts()) {
              const persistedState = persistedAttempts.get(attempt.attemptId);
              if (persistedState === undefined) {
                writeAttempt(store, attempt);
              } else if (persistedState !== attempt.state) {
                updateAttemptState(store, attempt);
              }
            }
            const persistedFinalities = new Map(
              readFinalities(store).map((finality) => [finality.finalityRecordId, finality.state]),
            );
            for (const finality of authority.listFinalities()) {
              const persistedState = persistedFinalities.get(finality.finalityRecordId);
              if (persistedState === undefined) {
                writeFinality(store, finality);
              } else if (persistedState !== finality.state) {
                updateFinalityState(store, finality);
              }
            }
          },
        }
      : {}),
    ...(stores.clearing
      ? {
          clearing: (authority: ClearingAuthority, batchId: string, batchLabel?: string) => {
            const store = stores.clearing as DurableDatabase;
            const batch = authority.batch(batchId);
            if (!batch) {
              return;
            }
            writeClearingBatch(store, batch, batchLabel ?? '');
            writeClearingRecords(store, batchId, authority.batchRecords(batchId));
          },
        }
      : {}),
    ...(stores.netting
      ? {
          netting: (authority: NettingAuthority, nettingSetId: string, label?: string) => {
            const store = stores.netting as DurableDatabase;
            const set = authority.nettingSet(nettingSetId);
            if (!set) {
              return;
            }
            const persistedSets = new Set(
              readNettingSets(store).map((record) => record.set.nettingSetId),
            );
            if (persistedSets.has(set.nettingSetId)) {
              updateNettingSet(store, set);
            } else {
              writeNettingSet(store, set, label ?? '');
            }
            const persistedNetObligations = new Map(
              readNetObligations(store).map((record) => [record.netObligationId, record.state]),
            );
            for (const netObligation of authority.netObligationsOfSet(nettingSetId)) {
              const persistedState = persistedNetObligations.get(netObligation.netObligationId);
              if (persistedState === undefined) {
                writeNetObligation(store, netObligation);
              } else if (persistedState !== netObligation.state) {
                updateNetObligationState(store, netObligation);
              }
            }
          },
        }
      : {}),
    ...(stores.queues
      ? {
          queues: (authority: QueueAuthority, queueId: string) => {
            const store = stores.queues as DurableDatabase;
            const queue = authority.queue(queueId);
            if (queue) {
              writeQueue(store, queue);
            }
            for (const item of authority.residentItemsOf(queueId)) {
              writeQueuedItem(store, item);
            }
          },
        }
      : {}),
  };
}

