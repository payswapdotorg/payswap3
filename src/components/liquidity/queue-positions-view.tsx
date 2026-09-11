'use client';

// ============================================================================
// UI-007 — Queue positions view (deliverable 6).
// ----------------------------------------------------------------------------
// Queued-position visibility: per-queue snapshots with the provider's own
// entries. Queue composition detail stays one deliberate step away (P3).
// Waiting entries reference the UI-006 waiting semantics (what is waiting,
// why, what happens next) and link to the waiting track surface where a
// tracking reference exists.
//
// Queue truth is owned by the Liquidity Authority: entry positions and queue
// depth are authority-quoted counts. Indeterminate values render UNKNOWN with
// their reconciliation path — never zero, "first", or empty. Nothing here is
// computed, estimated, or cached UI-side.
// ============================================================================

import Link from 'next/link';

import { UnknownState, WaitingState } from '@/components/state';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { QueueSnapshot } from '@/lib/protocol/liquidity-port';
import {
  mapQueueSnapshot,
  type MappedQueueEntry,
  type MappedValueCell,
} from '@/lib/protocol/liquidity-state-mapping';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, ExternalLink, ListOrdered } from 'lucide-react';

function DepthValue({ cell }: { cell: MappedValueCell }) {
  if (cell.kind === 'unknown') {
    return (
      <UnknownState
        subject={cell.subject}
        explanation={cell.explanation}
        reconciliation={cell.reconciliation}
      />
    );
  }
  return (
    <div className="space-y-0.5">
      <p className="text-2xl font-semibold tabular-nums">
        {cell.kind === 'quoted-amount' ? cell.formatted : cell.count}
      </p>
      <p className="text-xs text-muted-foreground">
        Reported by the {cell.quotedBy} · quote {cell.quoteId} · as of {cell.quotedAtLabel}
      </p>
    </div>
  );
}

function EntryPositionValue({ cell }: { cell: MappedValueCell }) {
  if (cell.kind === 'unknown') {
    return (
      <UnknownState
        subject={cell.subject}
        explanation={cell.explanation}
        reconciliation={cell.reconciliation}
      />
    );
  }
  return (
    <div className="space-y-0.5">
      <p className="font-semibold tabular-nums">
        {cell.kind === 'quoted-amount' ? cell.formatted : `#${cell.count} in queue`}
      </p>
      <p className="text-xs text-muted-foreground">
        Reported by the {cell.quotedBy} · quote {cell.quoteId}
      </p>
    </div>
  );
}

function QueueEntryBlock({ entry }: { entry: MappedQueueEntry }) {
  return (
    <li className="rounded-lg border p-3 sm:p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <ListOrdered aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            {entry.entryId}
            <span className="text-xs font-normal text-muted-foreground">
              record {entry.recordId} · entered {entry.enteredAtLabel}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">Reason: {entry.reason}</p>
        </div>
        <div className="min-w-40">
          <EntryPositionValue cell={entry.position} />
        </div>
      </div>

      {/* UI-006 waiting semantics, quoted by the authority */}
      <WaitingState
        whatIsWaiting={entry.waiting.whatIsWaiting}
        why={entry.waiting.why}
        whatHappensNext={entry.waiting.whatHappensNext}
        reportedBy={entry.waiting.reportedBy}
        availableActions={[
          'Re-open this surface to re-query the authority (nothing is cached as truth)',
          entry.tracking
            ? 'Open the waiting status for this entry on the track surface'
            : 'Wait for the authority-quoted expectation to be published for this entry',
        ]}
      />

      {entry.tracking ? (
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/track/${entry.tracking.referenceId}/waiting`}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              // Long authority-provided labels wrap at small breakpoints —
              // never truncate, never force horizontal scroll (P10).
              'h-auto min-w-0 shrink whitespace-normal text-left'
            )}
          >
            <ExternalLink aria-hidden className="size-3.5" />
            Waiting status on the track surface ({entry.tracking.referenceId})
          </Link>
          {entry.evidence.map((ref) => (
            <Link
              key={ref.href}
              href={ref.href}
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'sm' }),
                'h-auto min-w-0 shrink whitespace-normal text-left'
              )}
            >
              {ref.label}
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {entry.evidence.map((ref) => (
            <Link
              key={ref.href}
              href={ref.href}
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'sm' }),
                'h-auto min-w-0 shrink whitespace-normal text-left'
              )}
            >
              {ref.label}
            </Link>
          ))}
        </div>
      )}
    </li>
  );
}

function QueueSnapshotCard({
  snapshot,
  defaultOpen,
}: {
  snapshot: ReturnType<typeof mapQueueSnapshot>;
  defaultOpen: boolean;
}) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <div className="flex w-full flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">{snapshot.queueName}</CardTitle>
            <CardDescription>
              Reported by the {snapshot.reportedBy} · as of {snapshot.asOfLabel} · record{' '}
              {snapshot.recordId}
            </CardDescription>
          </div>
          <div className="w-full max-w-64 sm:w-auto">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Queue depth (authority-quoted)
            </p>
            <DepthValue cell={snapshot.depth} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Collapsible defaultOpen={defaultOpen}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Queue composition — your entries in this queue, one deliberate step away.
            </p>
            <CollapsibleTrigger
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'group')}
            >
              <ChevronDown
                aria-hidden
                className="size-3.5 group-data-[state=open]:hidden"
              />
              <ChevronUp
                aria-hidden
                className="size-3.5 group-data-[state=closed]:hidden"
              />
              Show entries
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            {snapshot.entries.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                The {snapshot.reportedBy} reports no entries of yours in this queue.
              </p>
            ) : (
              <ul
                className="mt-3 max-h-96 space-y-3 overflow-y-auto pr-1"
                aria-label={`Your entries in the ${snapshot.queueName}`}
              >
                {snapshot.entries.map((entry) => (
                  <QueueEntryBlock key={entry.entryId} entry={entry} />
                ))}
              </ul>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

export interface QueuePositionsViewProps {
  queues: readonly QueueSnapshot[];
  /** Harness support: start compositions expanded (live surfaces keep them collapsed). */
  defaultOpen?: boolean;
}

export function QueuePositionsView({ queues, defaultOpen = false }: QueuePositionsViewProps) {
  const snapshots = queues.map(mapQueueSnapshot);

  return (
    <section aria-labelledby="queue-positions-heading" className="space-y-4">
      <div>
        <h2 id="queue-positions-heading" className="text-lg font-semibold tracking-tight">
          Queued positions
        </h2>
        <p className="text-sm text-muted-foreground">
          Queued positions are owned by the Liquidity Authority. Every position and depth below
          is an authority-quoted count; waiting entries carry the UI-006 waiting semantics with
          the reason and expectation, and link to the waiting track surface where a reference
          exists.
        </p>
      </div>
      <div className="grid gap-4">
        {snapshots.map((snapshot) => (
          <QueueSnapshotCard
            key={snapshot.queueId}
            snapshot={snapshot}
            defaultOpen={defaultOpen}
          />
        ))}
      </div>
    </section>
  );
}
