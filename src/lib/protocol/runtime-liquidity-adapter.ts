/**
 * ════════════════════════════════════════════════════════════════════════
 *  UI-011 — RUNTIME LIQUIDITY ADAPTER (A06/A07/A08-backed LiquidityPort)
 * ════════════════════════════════════════════════════════════════════════
 *
 * The runtime adapter FACTORY behind getLiquidityPort(overrides) once
 * src/lib/protocol/server-runtime.ts registers it. It implements the
 * FROZEN LiquidityPort interface exactly (read-only — no command kinds):
 *
 *   • Provider liquidity positions are the A06 Liquidity Authority's own
 *     records (pools enumerated from the real POOL_OPENED A15 chain;
 *     positionsOf per pool; the position's total/reserved/available are
 *     the authority's INV-6-1 accounting, quoted verbatim).
 *   • Provider credit positions are the A07 Credit Authority's own
 *     records (linesInOrder + lineExposure: limit / exposure / remaining).
 *   • Queue snapshots are the A08 Queue Authority's own records (items
 *     enumerated from the real ITEM_* A15 chain; depth = the authority's
 *     own resident-item set).
 *   • Oversight aggregates are authority-UNKNOWN: the composed runtime
 *     exposes no cross-provider aggregate read, and the product never
 *     sums authority figures UI-side — the gap is recorded (deferral),
 *     and the aggregates render UNKNOWN with their reconciliation path.
 *   • The sandbox overrides (unknownSources) are the verification
 *     harness's scripting of THIS read's availability axis — the affected
 *     values present authority-UNKNOWN with the scripted explanation;
 *     nothing else changes.
 *   • Role mirroring (P8): provider-positions answers providers only;
 *     operator-oversight answers operators only — refused, never
 *     filtered-and-shown.
 */

import { LIQUIDITY_PORT_BINDING } from './adapter-boundary';
import type {
  AuthorityQuotedAmount,
  AuthorityQuotedCount,
  AuthorityUnknownValue,
  LiquidityAmountValue,
  LiquidityCountValue,
  LiquidityPort,
  LiquiditySandboxOverrides,
  OperatorOversightQuery,
  OperatorOversightResult,
  OversightAggregate,
  ProviderPositionsQuery,
  ProviderPositionsResult,
  ProviderPositionsView,
  QueueEntry,
  QueueSnapshot,
  QueueWaitingSemantics,
} from './liquidity-port';
import type { ProtocolRuntimeHandle } from './runtime-handle';
import type { Money } from '../protocol-runtime/index.ts';
import type { QueuedItemRecord } from '../protocol-runtime/queues/types.ts';
import { money as kernelMoney } from '../protocol-runtime/kernel/money.ts';
import type { NavAudience } from '@/lib/navigation';

type SourceId =
  | 'provider.position.balance'
  | 'provider.position.reserved'
  | 'provider.position.available'
  | 'provider.credit.limit'
  | 'provider.credit.utilized'
  | 'provider.credit.remaining'
  | 'queue.entry.position'
  | 'queue.snapshot.depth'
  | 'oversight.aggregate.total-reserved'
  | 'oversight.aggregate.queue-depth'
  | 'oversight.aggregate.credit-utilized';

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

function isProvider(query: ProviderPositionsQuery): boolean {
  return query.requester === 'provider';
}

function isOperator(query: OperatorOversightQuery): boolean {
  return query.requester === 'operator';
}

export function createRuntimeLiquidityPortFactory(
  handle: ProtocolRuntimeHandle,
): (overrides: LiquiditySandboxOverrides) => LiquidityPort {
  let quoteSequence = 0;

  function quoted(
    sourceId: SourceId,
    value: string | number,
    quotedBy: 'Liquidity Authority' | 'Credit Authority',
  ): AuthorityQuotedAmount | AuthorityQuotedCount {
    quoteSequence += 1;
    const quoteId = `rtq_${quoteSequence.toString().padStart(4, '0')}`;
    const quotedAt = new Date().toISOString();
    if (typeof value === 'number') {
      return { kind: 'authority-quoted', sourceId, count: value, quotedBy, quoteId, quotedAt };
    }
    return { kind: 'authority-quoted', sourceId, amount: value, currency: 'USD', quotedBy, quoteId, quotedAt };
  }

  function scriptedUnknown(
    sourceId: SourceId,
    subject: string,
    overrides: LiquiditySandboxOverrides,
  ): AuthorityUnknownValue | undefined {
    if (!overrides.unknownSources.includes(sourceId)) {
      return undefined;
    }
    return {
      kind: 'authority-unknown',
      sourceId,
      subject,
      explanation:
        `Scripted indeterminacy for verification: the harness marked this value source (${sourceId}) authority-UNKNOWN for ` +
        'this request. This is the read\u2019s availability axis being demonstrated — the underlying authority read is not ' +
        'presented here, and nothing is substituted for it.',
      reconciliation: {
        whoResolves: 'The owning authority (the runtime adapter\u2019s read)',
        recheckTrigger: 'Re-request without the sandbox override (the verification harness\u2019s scripting)',
      },
    };
  }

  function asAmount(
    sourceId: SourceId,
    value: string,
    quotedBy: 'Liquidity Authority' | 'Credit Authority',
    overrides: LiquiditySandboxOverrides,
    subject: string,
  ): LiquidityAmountValue {
    return scriptedUnknown(sourceId, subject, overrides) ?? (quoted(sourceId, value, quotedBy) as AuthorityQuotedAmount);
  }

  function asCount(
    sourceId: SourceId,
    value: number,
    quotedBy: 'Liquidity Authority' | 'Credit Authority',
    overrides: LiquiditySandboxOverrides,
    subject: string,
  ): LiquidityCountValue {
    return scriptedUnknown(sourceId, subject, overrides) ?? (quoted(sourceId, value, quotedBy) as AuthorityQuotedCount);
  }

  function poolIds(): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const record of handle.evidenceLog.records()) {
      if (record.what.operationType !== 'POOL_OPENED') continue;
      const poolId = record.what.subjectIds[0];
      if (poolId !== undefined && !seen.has(poolId)) {
        seen.add(poolId);
        ids.push(poolId);
      }
    }
    return ids;
  }

  function queueItems(): readonly { item: QueuedItemRecord; queueId: string }[] {
    const out: { item: QueuedItemRecord; queueId: string }[] = [];
    const seen = new Set<string>();
    for (const record of handle.evidenceLog.records()) {
      const operation = record.what.operationType;
      if (!operation.startsWith('ITEM_')) continue;
      const [itemId, queueId] = record.what.subjectIds;
      if (itemId === undefined || queueId === undefined || seen.has(itemId)) continue;
      const item = handle.authorities.queues.item(itemId);
      if (item !== undefined) {
        seen.add(itemId);
        out.push({ item, queueId });
      }
    }
    return out;
  }

  return function buildLiquidityPort(overrides: LiquiditySandboxOverrides): LiquidityPort {
    async function getProviderPositions(query: ProviderPositionsQuery): Promise<ProviderPositionsResult> {
      if (!isProvider(query)) {
        return {
          kind: 'denied',
          surface: 'provider-positions',
          requester: query.requester,
          reason:
            'The provider liquidity surface mirrors what the owning authorities permit: only the provider audience may read ' +
            'provider positions. Cross-role visibility is refused, never filtered-and-shown (P8).',
        };
      }
      const liquidity = poolIds().flatMap((poolId) =>
        handle.authorities.liquidity.positionsOf(poolId).map((position) => ({
          positionId: position.positionId,
          poolId,
          record: position,
        })),
      );
      const credit = handle.authorities.credit.linesInOrder().map((line) => ({
        line,
        exposure: handle.authorities.credit.lineExposure(line.lineId),
      }));
      const queuesByQueue = new Map<string, QueuedItemRecord[]>();
      for (const { item, queueId } of queueItems()) {
        const list = queuesByQueue.get(queueId) ?? [];
        list.push(item);
        queuesByQueue.set(queueId, list);
      }
      const queueSnapshots: QueueSnapshot[] = [...queuesByQueue.entries()].map(([queueId, items]) => {
        const queue = handle.authorities.queues.queue(queueId);
        const waiting: QueueWaitingSemantics = {
          whatIsWaiting: `Intent fulfillments the queue authority holds in queue ${queueId}${queue ? ` (${queue.state})` : ''}.`,
          why:
            queue === undefined
              ? 'The queue\u2019s release conditions did not hold at the authority\u2019s last evaluation, as recorded.'
              : 'The queue\u2019s immutable release conditions (eligibility over liquidity/credit/capability reads) did not hold at the authority\u2019s last evaluation.',
          whatHappensNext:
            'The queue drains and dispatches eligible items in deterministic order; the authority records each dispatch (INV-8-4).',
          reportedBy: 'Liquidity Authority',
        };
        return {
          queueId,
          queueName: queueId,
          depth: asCount(
            'queue.snapshot.depth',
            items.length,
            'Liquidity Authority',
            overrides,
            `queue ${queueId} depth`,
          ),
          asOf: new Date().toISOString(),
          reportedBy: 'Liquidity Authority',
          entries: items.map((item) => ({
            entryId: item.itemId,
            queueId,
            position: asCount(
              'queue.entry.position',
              item.queueSequence,
              'Liquidity Authority',
              overrides,
              `item ${item.itemId} position`,
            ),
            reason:
              item.reasonCode === undefined
                ? 'Queued per the authority\u2019s eligibility evaluation (the item\u2019s fixed terms are immutable, INV-8-1).'
                : `Reason code as recorded: ${item.reasonCode}.`,
            enteredAt: isoOfWall(item.enqueuedAtWallMs),
            waiting,
            tracking: { referenceId: item.intentId },
            evidence: [
              { label: `A15 queue-item record ${item.itemId}`, href: `/track/${item.intentId}` },
            ],
          })),
        };
      });
      const view: ProviderPositionsView = {
        providerRef: 'composed-runtime',
        liquidity: liquidity.map(({ positionId, poolId, record }) => ({
          positionId,
          asset: 'USD' as const,
          balance: asAmount(
            'provider.position.balance',
            formatMoney(record.total),
            'Liquidity Authority',
            overrides,
            `position ${positionId} total`,
          ),
          reserved: asAmount(
            'provider.position.reserved',
            formatMoney(record.reserved),
            'Liquidity Authority',
            overrides,
            `position ${positionId} reserved`,
          ),
          available: asAmount(
            'provider.position.available',
            formatMoney(record.available),
            'Liquidity Authority',
            overrides,
            `position ${positionId} available`,
          ),
          asOf: isoOfWall(record.stateChangedAt.wallMs),
          reportedBy: 'Liquidity Authority',
          evidence: [
            {
              label: `A06 position ${positionId} (pool ${poolId})`,
              href: `/provider/liquidity`,
            },
          ],
        })),
        credit: credit.map(({ line, exposure }) => ({
          positionId: line.lineId,
          scope: `Credit line ${line.lineId} (${line.state}) — the Credit Authority\u2019s own record`,
          creditLimit: asAmount(
            'provider.credit.limit',
            formatMoney(line.limit),
            'Credit Authority',
            overrides,
            `line ${line.lineId} limit`,
          ),
          utilized: asAmount(
            'provider.credit.utilized',
            formatMoney(
              exposure?.exposure ?? kernelMoney(line.limit.currency, 0, line.limit.scale),
            ),
            'Credit Authority',
            overrides,
            `line ${line.lineId} exposure`,
          ),
          remaining: asAmount(
            'provider.credit.remaining',
            formatMoney(
              exposure?.remaining ?? line.limit,
            ),
            'Credit Authority',
            overrides,
            `line ${line.lineId} remaining`,
          ),
          asOf: isoOfWall(line.stateChangedAt.wallMs),
          reportedBy: 'Credit Authority',
          evidence: [
            { label: `A07 credit line ${line.lineId}`, href: `/provider/liquidity` },
          ],
        })),
        queues: queueSnapshots,
        asOf: new Date().toISOString(),
      };
      return { kind: 'permitted', view };
    }

    async function getOperatorOversight(query: OperatorOversightQuery): Promise<OperatorOversightResult> {
      if (!isOperator(query)) {
        return {
          kind: 'denied',
          surface: 'operator-oversight',
          requester: query.requester,
          reason:
            'The operator oversight surface mirrors what the owning authorities permit: only the operator audience may read ' +
            'the oversight aggregates. Cross-role visibility is refused, never filtered-and-shown (P8).',
        };
      }
      const totalReserved: AuthorityUnknownValue = {
        kind: 'authority-unknown',
        sourceId: 'oversight.aggregate.total-reserved',
        subject: 'total reserved across providers',
        explanation:
          'The composed runtime exposes no cross-provider aggregate read: the A06 Liquidity Authority\u2019s public read surface ' +
          'is per-pool/per-position, and the product never sums authority figures UI-side (N1/P11). The aggregate is ' +
          'authoritatively indeterminate here — recorded as a deferral to the read-surface gap (see the liquidity mapping records).',
        reconciliation: {
          whoResolves: 'The Liquidity Authority (a cross-pool aggregate read) — recorded future read-surface work',
          recheckTrigger: 'A governed read-surface extension (the per-position reads remain available on the provider surface)',
        },
      };
      const queueDepth: AuthorityUnknownValue = {
        kind: 'authority-unknown',
        sourceId: 'oversight.aggregate.queue-depth',
        subject: 'queued entries across providers',
        explanation:
          'The composed runtime exposes no cross-queue aggregate read: the A08 Queue Authority\u2019s public read surface is ' +
          'per-queue, and the product never counts across authorities UI-side. Authoritatively indeterminate here — recorded ' +
          'as a deferral to the read-surface gap.',
        reconciliation: {
          whoResolves: 'The Queue Authority (a cross-queue aggregate read) — recorded future read-surface work',
          recheckTrigger: 'A governed read-surface extension (the per-queue snapshots remain available on the provider surface)',
        },
      };
      const creditUtilized: AuthorityUnknownValue = {
        kind: 'authority-unknown',
        sourceId: 'oversight.aggregate.credit-utilized',
        subject: 'credit utilized across providers',
        explanation:
          'The composed runtime exposes no cross-provider aggregate read: the A07 Credit Authority\u2019s public read surface is ' +
          'per-line, and the product never sums authority figures UI-side. Authoritatively indeterminate here — recorded as ' +
          'a deferral to the read-surface gap.',
        reconciliation: {
          whoResolves: 'The Credit Authority (a cross-line aggregate read) — recorded future read-surface work',
          recheckTrigger: 'A governed read-surface extension (the per-line exposures remain available on the provider surface)',
        },
      };
      const aggregates: OversightAggregate[] = [
        {
          aggregateId: 'oversight-total-reserved',
          label: 'Total reserved across providers (USD)',
          value: overrides.unknownSources.includes('oversight.aggregate.total-reserved')
            ? scriptedUnknown('oversight.aggregate.total-reserved', 'total reserved across providers', overrides)!
            : totalReserved,
          reportedBy: 'Liquidity Authority',
          note:
            'UNKNOWN by read-surface gap (never a UI-side sum). The provider surface carries the per-position reserved figures.',
        },
        {
          aggregateId: 'oversight-queue-depth',
          label: 'Queued entries across providers',
          value: overrides.unknownSources.includes('oversight.aggregate.queue-depth')
            ? scriptedUnknown('oversight.aggregate.queue-depth', 'queued entries across providers', overrides)!
            : queueDepth,
          reportedBy: 'Liquidity Authority',
          note:
            'UNKNOWN by read-surface gap (never a UI-side count). The provider surface carries the per-queue snapshots.',
        },
        {
          aggregateId: 'oversight-credit-utilized',
          label: 'Credit utilized across providers (USD)',
          value: overrides.unknownSources.includes('oversight.aggregate.credit-utilized')
            ? scriptedUnknown('oversight.aggregate.credit-utilized', 'credit utilized across providers', overrides)!
            : creditUtilized,
          reportedBy: 'Credit Authority',
          note:
            'UNKNOWN by read-surface gap (never a UI-side sum). The provider surface carries the per-line exposures.',
        },
      ];
      return {
        kind: 'permitted',
        view: {
          aggregates,
          asOf: new Date().toISOString(),
          scopeNote:
            'Operator oversight over the composed runtime. The three aggregates are authority-UNKNOWN by recorded read-surface ' +
            'gaps (the runtime exposes no cross-provider aggregate reads; the product never derives aggregates UI-side). ' +
            'Per-provider detail remains reachable on the provider surfaces through the same port.',
        },
      };
    }

    return {
      binding: {
        ...LIQUIDITY_PORT_BINDING,
        note:
          LIQUIDITY_PORT_BINDING.note +
          (overrides.unknownSources.length > 0
            ? ` This request carries verification sandbox overrides (authority-UNKNOWN scripted for: ${overrides.unknownSources.join(', ')}).`
            : ''),
      },
      getProviderPositions,
      getOperatorOversight,
    };
  };
}
