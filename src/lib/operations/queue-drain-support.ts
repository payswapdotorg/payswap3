/**
 * DEP-004 — Operational jobs: the queue-draining support duty (A08).
 *
 * Owned surface: src/lib/operations/queue-drain-support.ts (work order
 * DEP-004 — the recurring operational duty the deployment topology names
 * for workers: "queue-draining support"; the scheduler-wiring precedent's
 * fourth recurring tick is the queue eligibility scan).
 *
 * THE DUTY: support the draining lifecycle of the configured fulfillment
 * queues by submitting, through the gateway, exactly the queue-authority
 * command kinds the state derivation calls for:
 *
 *   queue absent → `queues.queue.create` { queueId, policy }  (the lifecycle
 *                  support: ensure the configured queue exists — the
 *                  policy comes from the job's configuration, never from
 *                  invented state)
 *   queue OPEN   → `queues.queue.drain.start` { queueId }    (the drain gate)
 *   queue DRAINING → `queues.eligibility.evaluate` { queueId, snapshot } +
 *                    `queues.items.due.expire` { queueId, at }
 *
 * THE ELIGIBILITY SNAPSHOT IS DERIVED, NEVER INVENTED: the A08 release
 * conditions consume liquidity/capability/credit availability facts, and
 * the job derives every fact from the AUTHORITATIVE read surfaces — the
 * A06 pools (configured pool ids → pool() reads), the A03 capability
 * snapshot, the A07 credit-line exposure views. "Jobs consume only
 * authoritative protocol state" — the snapshot is a projection of that
 * state, assembled at submission time from reads, with the run's
 * deterministic window time as `at`.
 *
 * The job never enqueues items (item intake is the product/intent side),
 * never dispatches (dispatch is the queue authority's in-order step
 * driven by the fulfillment engine), and never resolves dispatched items
 * (the area-14 vocabulary resolution). Draining support only.
 *
 * HONEST EXECUTION NOTE (the filed composition defect D-2,
 * INTEGRATION-EVIDENCE.md): `queues.queue.create` and
 * `queues.eligibility.evaluate` are hosted with identical names on the
 * transition path and EXECUTE end-to-end; `queues.queue.drain.start` and
 * `queues.items.due.expire` are gateway-ADMITTED but un-hosted (the
 * hosted binding vocabulary names them differently — the drain gate has
 * no hosted binding at all, and the expiry sweep's hosted kind is
 * `queues.items.expire`) — those submissions record their receipts and
 * sit queued until the recorded vocabulary-alignment follow-up lands.
 * See OPERATIONS-EVIDENCE.md.
 *
 * Spec sources (binding): spec/system-work-orders/DEP-004.md;
 * liquidity-credit-queues.md Area 8 (the queue + item state machines,
 * the release conditions); COMMAND-SURFACE §A08;
 * hosting/scheduler-wiring.ts (the queue eligibility tick precedent).
 */

import { money } from '../protocol-runtime/kernel/money.ts';
import { operationalJobHandler } from './jobs.ts';
import type { OperationalJobContext, OperationalJobDeps, DurableJobHandler } from './jobs.ts';

/** The queue-drain-support job kind (the DEP-003 durable job identity). */
export const QUEUE_DRAIN_SUPPORT_JOB_KIND = 'operations.queue-drain-support';

/** The canonical ordering rule (A08's single implemented ordering). */
const QUEUE_ORDERING_RULE = 'PRIORITY_CLASS_THEN_SEQUENCE_NUMBER';

/**
 * Derive the A08 eligibility snapshot from the AUTHORITATIVE read
 * surfaces: A06 pool totals (configured pool ids), the A03 capability
 * snapshot, the A07 credit-line exposure views. Every fact is a read
 * projection; the `at` is the run's deterministic window time.
 */
function deriveEligibilitySnapshot(
  deps: OperationalJobDeps,
  windowStartWallMs: number,
  cycle: number,
): { liquidity: unknown[]; capability: unknown[]; credit: unknown[]; at: { sequence: number; wallMs: number } } {
  const poolIds = deps.config.liquidityPoolIds ?? [];
  const liquidity = poolIds.flatMap((poolId) => {
    const pool = deps.reads.liquidity.pool(poolId);
    if (pool === undefined) {
      return [];
    }
    return [{ poolId, available: money(pool.currency, pool.totalMinor, pool.scale) }];
  });
  const capability = deps.reads.capability
    .snapshot()
    .capabilities.map((entry) => ({ capabilityId: entry.capabilityId, tier: entry.tier, state: entry.state }));
  const credit = deps.reads.credit
    .linesInOrder()
    .flatMap((line) => {
      const exposure = deps.reads.credit.lineExposure(line.lineId);
      if (exposure === undefined) {
        return [];
      }
      return [{ lineId: exposure.lineId, remaining: exposure.remaining }];
    });
  return {
    liquidity,
    capability,
    credit,
    at: { sequence: cycle, wallMs: windowStartWallMs },
  };
}

/**
 * The derivation: for each configured queue — ensure-created, then the
 * drain-gate, then (for DRAINING queues) the eligibility evaluation with
 * the derived snapshot + the due-expiry sweep.
 */
async function deriveQueueDrainSupport(context: OperationalJobContext): Promise<void> {
  const { deps, payload, submit, noteDerived } = context;
  const queueIds = deps.config.queueIds ?? [];
  const policies = deps.config.queuePolicies ?? {};

  for (const queueId of queueIds) {
    const queue = deps.reads.queues.queue(queueId);
    if (queue === undefined) {
      const policy = policies[queueId];
      if (policy === undefined) {
        // No configured creation policy: the job does not invent one.
        continue;
      }
      noteDerived(`queue ${queueId}: absent → create`);
      await submit({
        kind: 'queues.queue.create',
        authority: 'Queue Authority',
        subjectIds: [],
        subject: queueId,
        body: {
          queueId,
          policy: {
            orderingRule: QUEUE_ORDERING_RULE,
            maxWaitEpochMs: policy.maxWaitEpochMs,
            releaseConditions: policy.releaseConditions,
          },
        },
      });
      continue;
    }
    if (queue.state === 'OPEN') {
      noteDerived(`queue ${queueId}: OPEN → drain.start`);
      await submit({
        kind: 'queues.queue.drain.start',
        authority: 'Queue Authority',
        subjectIds: [queueId],
        subject: queueId,
        body: { queueId },
      });
      continue;
    }
    if (queue.state === 'DRAINING') {
      const snapshot = deriveEligibilitySnapshot(deps, payload.windowStartWallMs, payload.cycle);
      noteDerived(
        `queue ${queueId}: DRAINING → eligibility.evaluate ` +
          `(${snapshot.liquidity.length} liquidity / ${snapshot.capability.length} capability / ${snapshot.credit.length} credit facts)`,
      );
      await submit({
        kind: 'queues.eligibility.evaluate',
        authority: 'Queue Authority',
        subjectIds: [queueId],
        subject: queueId,
        body: { queueId, snapshot },
      });
      noteDerived(`queue ${queueId}: DRAINING → items.due.expire (at window start ${payload.windowStartWallMs})`);
      await submit({
        kind: 'queues.items.due.expire',
        authority: 'Queue Authority',
        subjectIds: [queueId],
        subject: queueId,
        body: {
          queueId,
          at: { sequence: payload.cycle, wallMs: payload.windowStartWallMs },
        },
      });
    }
    // PAUSED / CLOSED: no drain support work (resumption is a new queue —
    // the A08 structural rule; the job never invents a resume).
  }
}

/** Build the queue-drain-support durable job handler. */
export function queueDrainSupportJob(deps: OperationalJobDeps): DurableJobHandler {
  return operationalJobHandler(QUEUE_DRAIN_SUPPORT_JOB_KIND, deps, deriveQueueDrainSupport);
}
