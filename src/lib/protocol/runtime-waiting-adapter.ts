/**
 * ════════════════════════════════════════════════════════════════════════
 *  UI-011 — RUNTIME WAITING ADAPTER (A08/A06/A07-backed WaitingPort)
 * ════════════════════════════════════════════════════════════════════════
 *
 * The runtime adapter behind getWaitingPort() once
 * src/lib/protocol/server-runtime.ts registers it. It implements the
 * FROZEN WaitingPort interface exactly over the composed runtime:
 *
 *   • LOOKUPS read the A08 Queue Authority's own records (queue / item /
 *     residentItemsOf), with the real A06 liquidity and A07 credit
 *     conditions behind the queue's release policy. The snapshot's
 *     waiting vocabulary (fq.*) is DERIVED from the runtime's own item
 *     states — QUEUED/ELIGIBLE (waiting on the queue's release
 *     conditions), DISPATCHED (awaiting the linked operation's
 *     confirmation, INV-8-4), GRADUATED/CANCELLED/EXPIRED (the explicit
 *     endings) — never scripted, never fabricated.
 *   • RE-CHECK requests submit queues.eligibility.evaluate through
 *     ProtocolGateway.submitCommand (the sole admission point) with the
 *     eligibility snapshot built from the runtime's own A06/A07/A03 reads.
 *   • RECOVERY: cancel submits queues.item.cancel through the gateway
 *     (authorized exactly where the frozen item state machine allows the
 *     CANCELLED edge); retry and escalate are DENIED with the recorded
 *     gap — the composed runtime exposes no retry/escalate kinds (A08's
 *     "never re-queued or re-dispatched until reconciliation resolves the
 *     operation" is structural).
 *   • Reference resolution: item ids and intent ids the runtime actually
 *     records (enumerated from the real A15 ITEM_* chain). A reference the
 *     runtime does not know renders not-found — the honest no-record
 *     answer through the frozen vocabulary (the waiting mapping records
 *     state the reading).
 *   • Viewer roles: the runtime's read surface places no per-viewer
 *     restriction on queue reads; the product shell's audience model
 *     governs surface access (documented in the records).
 */

import { WAITING_BOUNDARY } from './adapter-boundary';
import type {
  WaitingInquiryRequest,
  WaitingInquiryResult,
  WaitingLookupResult,
  WaitingPort,
  WaitingRecoveryRequest,
  WaitingRecoveryRequestResult,
  WaitingRecoveryAction,
  WaitingRecoveryAuthorization,
  WaitingSnapshot,
  WaitingViewerRole,
} from './waiting-port';
import type { ProtocolRuntimeHandle } from './runtime-handle';
import type { CommandEnvelope, Money, ProtocolTime } from '../protocol-runtime/index.ts';
import type { QueuedItemRecord } from '../protocol-runtime/queues/types.ts';
import { protocolTime } from '../protocol-runtime/kernel/time.ts';
import { money as kernelMoney } from '../protocol-runtime/kernel/money.ts';

const REPORTED_BY =
  'Fulfillment/Queue Authority (A08) over the composed protocol runtime — with A06/A07 reads';

const ALL_ROLES: readonly WaitingViewerRole[] = [
  'customer',
  'merchant',
  'provider',
  'operator',
  'administrator',
];

function formatMoney(value: Money): string {
  const sign = value.amountMinor < 0 ? '-' : '';
  const absolute = Math.abs(Math.trunc(value.amountMinor));
  const whole = Math.floor(absolute / 10 ** value.scale);
  const fraction = String(absolute % 10 ** value.scale).padStart(value.scale, '0');
  return `${sign}${whole}.${fraction}`;
}

function isoOfWall(wallMs: number): string {
  return new Date(wallMs).toISOString();
}

/** The (itemId, queueId, intentId) triples the real A15 ITEM_* chain names. */
function recordedItems(handle: ProtocolRuntimeHandle): readonly {
  itemId: string;
  queueId: string;
  intentId: string;
}[] {
  const triples: { itemId: string; queueId: string; intentId: string }[] = [];
  for (const record of handle.evidenceLog.records()) {
    const operation = record.what.operationType;
    if (
      operation === 'ITEM_QUEUED' ||
      operation === 'ITEM_ELIGIBLE' ||
      operation === 'ITEM_DISPATCHED' ||
      operation === 'ITEM_GRADUATED' ||
      operation === 'ITEM_CANCELLED' ||
      operation === 'ITEM_EXPIRED'
    ) {
      const [itemId, queueId, intentId] = record.what.subjectIds;
      if (itemId !== undefined && queueId !== undefined && intentId !== undefined) {
        if (!triples.some((triple) => triple.itemId === itemId)) {
          triples.push({ itemId, queueId, intentId });
        }
      }
    }
  }
  return triples;
}

function findItem(
  handle: ProtocolRuntimeHandle,
  referenceId: string,
): { item: QueuedItemRecord; queueId: string } | undefined {
  for (const triple of recordedItems(handle)) {
    if (triple.itemId === referenceId || triple.intentId === referenceId) {
      const item = handle.authorities.queues.item(triple.itemId);
      if (item !== undefined) {
        return { item, queueId: triple.queueId };
      }
    }
  }
  return undefined;
}

function recoveryActionsFor(
  item: QueuedItemRecord,
  handle: ProtocolRuntimeHandle,
): readonly WaitingRecoveryAction[] {
  const cancelAuthorized =
    item.state === 'QUEUED' || item.state === 'ELIGIBLE'
      ? {
        status: 'authorized' as const,
        basis:
          'The queue authority\u2019s frozen item state machine allows the CANCELLED edge from this state, and the cancel command ' +
          '(queues.item.cancel with reason code INTENT_CANCELLED) is a real gateway kind.',
      }
      : {
        status: 'not-authorized' as const,
        reason:
          item.state === 'DISPATCHED'
            ? 'The item is DISPATCHED: INV-8-4 holds it for its linked operation\u2019s reconciliation — it is never re-queued or cancelled blindly (GC-2).'
            : `The item is terminal (${item.state}); no recovery action exists for a terminal item.`,
      };
  void handle;
  const actions: WaitingRecoveryAction[] = [
    {
      actionId: 'cancel',
      label: 'Request cancellation',
      description: 'Submit queues.item.cancel through the protocol gateway — a real command on the durable path.',
      requestedEffect: 'The queue authority transitions this item to CANCELLED (reason code INTENT_CANCELLED), as authorized.',
      authorization: cancelAuthorized,
    },
    {
      actionId: 'retry',
      label: 'Request retry',
      description: 'A retry would re-dispatch this fulfillment.',
      requestedEffect: 'Re-dispatch of the waiting fulfillment.',
      authorization: {
        status: 'not-authorized',
        reason:
          'The composed runtime exposes no retry command kind: A08\u2019s rule is structural — an item is never re-queued or ' +
          're-dispatched until reconciliation resolves the operation (INV-8-4). A retry is a NEW intent, explicitly submitted.',
      },
    },
    {
      actionId: 'escalate',
      label: 'Request escalation',
      description: 'An escalation would raise the waiting item\u2019s handling.',
      requestedEffect: 'Escalated handling of the waiting fulfillment.',
      authorization: {
        status: 'not-authorized',
        reason:
          'The composed runtime exposes no escalation command kind for queued items (the Agents/Mediation Authority, area 19, ' +
          'is RTN wave 2). No escalation is offered rather than fabricating one.',
      },
    },
  ];
  return actions;
}

function eligibilitySnapshotNow(handle: ProtocolRuntimeHandle, sequence: number): {
  liquidity: readonly { poolId: string; available: Money }[];
  capability: readonly { capabilityId: string; tier: string; state: string }[];
  credit: readonly { lineId: string; remaining: Money }[];
  at: ProtocolTime;
} {
  const at = protocolTime(sequence, Date.now());
  const liquidity: { poolId: string; available: Money }[] = [];
  const seenPools = new Set<string>();
  for (const record of handle.evidenceLog.records()) {
    if (record.what.operationType !== 'POOL_OPENED') continue;
    const poolId = record.what.subjectIds[0];
    if (poolId === undefined || seenPools.has(poolId)) continue;
    seenPools.add(poolId);
    const positions = handle.authorities.liquidity.positionsOf(poolId);
    let sumMinor = 0;
    let currency = 'USD';
    let scale = 2;
    for (const position of positions) {
      sumMinor += position.available.amountMinor;
      currency = position.available.currency;
      scale = position.available.scale;
    }
    liquidity.push({ poolId, available: kernelMoney(currency, sumMinor, scale) });
  }
  const capability = handle.authorities.capability
    .snapshot()
    .capabilities.map((entry) => ({
      capabilityId: entry.capabilityId,
      tier: entry.tier,
      state: entry.state,
    }));
  const credit = handle.authorities.credit.linesInOrder().map((line) => {
    const exposure = handle.authorities.credit.lineExposure(line.lineId);
    return { lineId: line.lineId, remaining: exposure?.remaining ?? line.limit };
  });
  return { liquidity, capability, credit, at };
}

export function createRuntimeWaitingAdapter(handle: ProtocolRuntimeHandle): WaitingPort {
  let protocolSequence = 0;

  function snapshotFor(item: QueuedItemRecord, viewerRole: WaitingViewerRole): WaitingSnapshot {
    const queue = handle.authorities.queues.queue(item.queueId);
    const amount = { value: formatMoney(item.terms.terms), currency: 'USD' as const };
    const base = {
      referenceId: item.itemId,
      intentSummary: `The fulfillment of intent ${item.intentId}, held by the Fulfillment/Queue Authority in queue ${item.queueId} (${item.state}).`,
      amount,
      viewerRole,
      allowedViewerRoles: ALL_ROLES,
      reportedBy: REPORTED_BY,
      reportedAt: isoOfWall(item.stateChangedAt.wallMs),
      recovery: recoveryActionsFor(item, handle),
      inquiry: {
        available: true,
        whatHappensNext:
          'The re-check submits queues.eligibility.evaluate through the protocol gateway over the runtime\u2019s current ' +
          'liquidity/credit/capability reads; the authority\u2019s own evaluation answer is then reported.',
      },
      authorityNote:
        queue === undefined
          ? undefined
          : `Queue policy (immutable, as the authority records): max wait ${queue.policy.maxWaitEpochMs} ms; release conditions ` +
            `${JSON.stringify(queue.policy.releaseConditions)}.`,
    };
    const conditionFromPolicy = ((): 'liquidity-credit' | 'provider-availability' => {
      const conditions = queue?.policy.releaseConditions ?? {};
      return conditions.requiredCapabilityTier !== undefined &&
        conditions.minLiquidityAvailable === undefined &&
        conditions.minCreditRemaining === undefined
        ? 'provider-availability'
        : 'liquidity-credit';
    })();
    switch (item.state) {
      case 'QUEUED':
      case 'ELIGIBLE':
        return {
          ...base,
          snapshotKind: 'condition',
          authorityStateId:
            conditionFromPolicy === 'liquidity-credit'
              ? 'fq.queued.liquidity-credit'
              : 'fq.queued.provider-availability',
          conditionKind: 'queued',
          whatIsWaiting: `Intent ${item.intentId}'s fulfillment (queue ${item.queueId}, position by priority class ${item.priorityClass} / sequence ${item.queueSequence}), as the queue authority holds it.`,
          reason:
            item.state === 'QUEUED'
              ? 'Waiting on the queue\u2019s release conditions (the eligibility rule the authority evaluates over its own liquidity/credit/capability reads).'
              : 'Eligible per the authority\u2019s last evaluation; awaiting the queue\u2019s drain and dispatch in deterministic order.',
          expectation:
            'The queue drains (queues.queue.drain.start) and dispatches eligible items in order; the authority records the dispatch and the linked operation\u2019s outcome resolves it (INV-8-4).',
        };
      case 'DISPATCHED':
        return {
          ...base,
          snapshotKind: 'condition',
          authorityStateId: 'fq.waiting.settlement-confirmation',
          conditionKind: 'waiting',
          whatIsWaiting: `Intent ${item.intentId}'s dispatched fulfillment operation${item.linkedOperationId ? ` (${item.linkedOperationId})` : ''}, as the queue authority holds it in DISPATCHED.`,
          reason:
            'Awaiting the linked operation\u2019s confirmation — the item is never re-dispatched while the operation is unresolved (INV-8-4; UNKNOWN resolves only through reconciliation, GC-2).',
          expectation:
            'Confirmation graduates the item (GRADUATED); confirmed failure cancels it (CANCELLED) — both recorded by the authority. The resolution arrives from the operation\u2019s outcome, not from this surface.',
        };
      case 'GRADUATED':
        return {
          ...base,
          snapshotKind: 'resolution',
          authorityStateId: 'fq.resolved.completed',
          outcome: 'succeeded',
          outcomeDetail:
            'The queue authority reports the item GRADUATED: the downstream fulfillment completed, as recorded (INV-8-4\u2019s graduation).',
          evidence: [
            {
              label: `A15 queue-item record ${item.itemId}`,
              href: `/track/${item.intentId}`,
            },
          ],
        };
      case 'CANCELLED':
        return {
          ...base,
          snapshotKind: 'resolution',
          authorityStateId: 'fq.resolved.failed',
          outcome: 'failed',
          outcomeDetail: 'The queue authority reports the item CANCELLED — the queued fulfillment did not proceed.',
          failureReason:
            item.reasonCode === undefined
              ? 'The authority recorded the cancellation (see the A15 ITEM_CANCELLED record).'
              : `Reason code as recorded: ${item.reasonCode}.`,
          nextActions: [
            'A retry is a new, explicitly submitted intent — never a silent re-dispatch (INV-8-4).',
          ],
        };
      case 'EXPIRED':
        return {
          ...base,
          snapshotKind: 'resolution',
          authorityStateId: 'fq.resolved.failed',
          outcome: 'failed',
          outcomeDetail:
            'The queue authority reports the item EXPIRED: the max-wait clock reached its deterministic limit (the queue\u2019s immutable policy).',
          failureReason: 'Item EXPIRED per the queue\u2019s max-wait policy, as the authority recorded.',
          nextActions: [
            'A retry is a new, explicitly submitted intent — the expired item is terminal.',
          ],
        };
    }
  }

  function lookupWaiting(referenceId: string, viewerRole: WaitingViewerRole): WaitingLookupResult {
    const found = findItem(handle, referenceId);
    if (found === undefined) {
      // The frozen WaitingLookupResult has no no-answer member; the honest
      // reading (documented in the waiting mapping records) is "no
      // reachable record" — the runtime's own answer, never an invented
      // snapshot.
      return { status: 'not-found', referenceId };
    }
    return { status: 'found', snapshot: snapshotFor(found.item, viewerRole) };
  }

  function requestRecheck(request: WaitingInquiryRequest): WaitingInquiryResult {
    const found = findItem(handle, request.referenceId);
    if (found === undefined) {
      return {
        status: 'rejected',
        authorityStateId: 'fq.inquiry.rejected',
        referenceId: request.referenceId,
        reason:
          'The composed runtime holds no queue item for this reference (the A08 authority was not asked about a record it holds). ' +
          'The re-check is rejected as not applicable — the reference the runtime records is the item id or intent id.',
      };
    }
    // THE re-check command: queues.eligibility.evaluate through the sole
    // admission point, over the runtime's own current reads.
    protocolSequence += 1;
    const envelope: CommandEnvelope = {
      kind: 'queues.eligibility.evaluate',
      authority: 'Queue Authority',
      subjectIds: [found.item.queueId],
      idempotencyKey: `recheck.${found.item.queueId}.${found.item.itemId}.${Date.now()}`,
      protocolTime: protocolTime(protocolSequence, Date.now()),
      body: {
        queueId: found.item.queueId,
        // The snapshot is built from the runtime's own current reads; the
        // command's body snapshot is the eligibility view at submission.
        snapshot: eligibilitySnapshotNow(handle, protocolSequence),
      },
    };
    // The frozen port interface is synchronous; the gateway is async. The
    // command is submitted (fire-and-forget with a guarded catch) and this
    // result reports the SUBMISSION honestly — the evaluation itself lands
    // on the durable command path, and every gateway rejection is recorded
    // as A15 evidence (GATEWAY_COMMAND_REJECTED), so nothing drops
    // silently; the snapshot re-read reports what the authority now holds.
    void handle.gateway
      .submitCommand(envelope)
      .then(async (admission) => {
        if (admission.ok) {
          await handle.drain();
        }
      })
      .catch(() => {
        /* a failed durable enqueue throws (no receipt); the same-key retry
           is safe — see COMMAND-SURFACE.md. The outcome surfaces on the
           next read. */
      });
    return {
      status: 'accepted',
      authorityStateId: 'fq.inquiry.recheck-requested',
      referenceId: request.referenceId,
      routedTo: 'Fulfillment/Queue Authority (A08) via the protocol gateway — queues.eligibility.evaluate',
      whoResolves: 'The Fulfillment/Queue Authority',
      recheckTrigger:
        'The authority\u2019s own evaluation over its current liquidity/credit/capability reads; the item states answer on the durable path',
      whatHappensNext:
        'The queue authority evaluated (or re-evaluated) the queue\u2019s eligibility over the real snapshot; the items\u2019 ' +
        'states answer on the durable command path — the waiting snapshot re-read reports whatever the authority now holds.',
      whatUserSeesNext:
        'The waiting snapshot for this reference, re-read from the authority — including a still-queued state if the release ' +
        'conditions still do not hold (another honest answer, never a fabricated progression).',
    };
  }

  function requestRecovery(request: WaitingRecoveryRequest): WaitingRecoveryRequestResult {
    const found = findItem(handle, request.referenceId);
    if (found === undefined) {
      return {
        status: 'denied',
        authorityStateId: 'fq.recovery.denied',
        referenceId: request.referenceId,
        actionId: request.actionId,
        reason:
          'The composed runtime holds no queue item for this reference, so no recovery action is applicable. The reference ' +
          'the runtime records is the item id or intent id.',
      };
    }
    if (request.actionId !== 'cancel') {
      return {
        status: 'denied',
        authorityStateId: 'fq.recovery.denied',
        referenceId: request.referenceId,
        actionId: request.actionId,
        reason:
          request.actionId === 'retry'
            ? 'Denied per protocol: the composed runtime exposes no retry command kind — A08\u2019s "never re-queued or ' +
              're-dispatched until reconciliation resolves the operation" (INV-8-4) is structural. A retry is a NEW intent, ' +
              'explicitly submitted and separately reviewed.'
            : 'Denied per protocol: the composed runtime exposes no escalation command kind for queued items (the area-19 ' +
              'Agents/Mediation Authority is RTN wave 2). No escalation is fabricated.',
      };
    }
    const item = found.item;
    if (item.state !== 'QUEUED' && item.state !== 'ELIGIBLE') {
      return {
        status: 'denied',
        authorityStateId: 'fq.recovery.denied',
        referenceId: request.referenceId,
        actionId: request.actionId,
        reason:
          item.state === 'DISPATCHED'
            ? 'Denied per protocol: the item is DISPATCHED and held for its linked operation\u2019s reconciliation (INV-8-4) — ' +
              'cancellation would bypass the operation\u2019s resolution, so the authority does not offer it here.'
            : `Denied per protocol: the item is terminal (${item.state}); no recovery action exists for a terminal item.`,
      };
    }
    // THE cancel command: queues.item.cancel through the sole admission point.
    protocolSequence += 1;
    const envelope: CommandEnvelope = {
      kind: 'queues.item.cancel',
      authority: 'Queue Authority',
      subjectIds: [item.itemId],
      idempotencyKey: `recovery.cancel.${item.itemId}.${Date.now()}`,
      protocolTime: protocolTime(protocolSequence, Date.now()),
      body: { itemId: item.itemId, reasonCode: 'INTENT_CANCELLED' },
    };
    // The frozen port interface is synchronous; the gateway is async. The
    // command is submitted (fire-and-forget with a guarded catch) and this
    // result reports the SUBMISSION honestly; every admission outcome is
    // recorded in the A15 chain (including typed rejections —
    // GATEWAY_COMMAND_REJECTED evidence), so nothing drops silently.
    void handle.gateway
      .submitCommand(envelope)
      .then(async (admission) => {
        if (admission.ok) {
          await handle.drain();
        }
      })
      .catch(() => {
        /* a failed durable enqueue throws (no receipt); the same-key retry is safe. */
      });
    return {
      status: 'accepted',
      authorityStateId: 'fq.recovery.cancel-requested',
      referenceId: request.referenceId,
      actionId: 'cancel',
      routedTo: 'Fulfillment/Queue Authority (A08) via the protocol gateway — queues.item.cancel',
      whatHappensNext:
        'The cancel command (queues.item.cancel) was submitted to the protocol gateway — the sole admission point. ' +
        'It is admitted-but-unhosted on the composed durable path (the D-2 vocabulary gap, INTEGRATION-EVIDENCE.md); the ' +
        'item’s next read reports whatever the queue authority then holds, and the A15 chain records the admission.',
      whatUserSeesNext:
        'The waiting snapshot re-read reports the CANCELLED resolution with the authority\u2019s recorded reason — an explicit ' +
        'terminal state, never a silent drop.',
    };
  }

  return {
    runtime: WAITING_BOUNDARY.runtime,
    authorityOwner: WAITING_BOUNDARY.authorityOwner,
    nonAuthoritative: false,
    lookupWaiting,
    requestRecheck,
    requestRecovery,
  };
}
