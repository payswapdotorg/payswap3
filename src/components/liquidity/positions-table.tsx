'use client';

// ============================================================================
// UI-007 — Positions composition table (deliverable 5).
// ----------------------------------------------------------------------------
// The dense position table with responsive mobile degradation (P10): at small
// breakpoints (container narrower than 576px, e.g. a 390px phone) the table
// stacks to definition-list form; it never truncates and never scrolls
// horizontally. UNKNOWN cells render UnknownState-anchored wording — never
// zero, empty, failed, or a definitive value.
//
// Composition detail stays one deliberate step away from the headline (P3):
// the table lives behind a deliberate disclosure.
//
// Degradation is driven by container queries (@container / @xl:) so the same
// component degrades correctly on a real phone AND inside a narrow harness
// box, regardless of viewport width.
// ============================================================================

import { useState } from 'react';

import { UnknownState } from '@/components/state';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  ProviderCreditPosition,
  ProviderLiquidityPosition,
} from '@/lib/protocol/liquidity-port';
import {
  mapCreditPosition,
  mapLiquidityPosition,
  type MappedCreditPosition,
  type MappedLiquidityPosition,
  type MappedValueCell,
} from '@/lib/protocol/liquidity-state-mapping';
import { ChevronDown, ChevronUp, FileClock } from 'lucide-react';

function CellValue({ cell }: { cell: MappedValueCell }) {
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
        {cell.kind === 'quoted-amount' ? cell.formatted : cell.count}
      </p>
      <p className="text-xs whitespace-normal text-muted-foreground">
        Reported by the {cell.quotedBy} · quote {cell.quoteId}
      </p>
    </div>
  );
}

function EvidenceCell({ evidence }: { evidence: readonly { label: string; href: string }[] }) {
  if (evidence.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <ul className="space-y-1">
      {evidence.map((ref) => (
        <li key={ref.href}>
          <a
            href={ref.href}
            className="inline-flex min-h-11 items-start gap-1 py-2 text-xs font-medium underline underline-offset-4"
          >
            <FileClock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {ref.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

// --- Dense desktop tables -----------------------------------------------------

function LiquidityTable({ positions }: { positions: readonly MappedLiquidityPosition[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Position</TableHead>
          <TableHead>Balance</TableHead>
          <TableHead>Reserved</TableHead>
          <TableHead>Available</TableHead>
          <TableHead>As of</TableHead>
          <TableHead className="min-w-56">Evidence (P7)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((position) => (
          <TableRow key={position.positionId}>
            <TableCell className="whitespace-normal font-medium">
              {position.asset} · {position.positionId}
              <p className="text-xs text-muted-foreground">Record {position.recordId}</p>
            </TableCell>
            <TableCell className="whitespace-normal align-top">
              <CellValue cell={position.cells.balance} />
            </TableCell>
            <TableCell className="whitespace-normal align-top">
              <CellValue cell={position.cells.reserved} />
            </TableCell>
            <TableCell className="whitespace-normal align-top">
              <CellValue cell={position.cells.available} />
            </TableCell>
            <TableCell className="whitespace-normal align-top text-xs">
              {position.asOfLabel}
              <p className="text-muted-foreground">Reported by the {position.reportedBy}</p>
            </TableCell>
            <TableCell className="whitespace-normal align-top">
              <EvidenceCell evidence={position.evidence} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CreditTable({ positions }: { positions: readonly MappedCreditPosition[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Credit line</TableHead>
          <TableHead>Limit</TableHead>
          <TableHead>Utilized</TableHead>
          <TableHead>Remaining</TableHead>
          <TableHead>As of</TableHead>
          <TableHead className="min-w-56">Evidence (P7)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((position) => (
          <TableRow key={position.positionId}>
            <TableCell className="whitespace-normal font-medium">
              {position.scope}
              <p className="text-xs text-muted-foreground">Record {position.recordId}</p>
            </TableCell>
            <TableCell className="whitespace-normal align-top">
              <CellValue cell={position.cells.creditLimit} />
            </TableCell>
            <TableCell className="whitespace-normal align-top">
              <CellValue cell={position.cells.utilized} />
            </TableCell>
            <TableCell className="whitespace-normal align-top">
              <CellValue cell={position.cells.remaining} />
            </TableCell>
            <TableCell className="whitespace-normal align-top text-xs">
              {position.asOfLabel}
              <p className="text-muted-foreground">Reported by the {position.reportedBy}</p>
            </TableCell>
            <TableCell className="whitespace-normal align-top">
              <EvidenceCell evidence={position.evidence} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// --- Mobile stacked definition lists (P10: readable, never truncated) --------

function StackRow({ term, cell }: { term: string; cell: MappedValueCell }) {
  return (
    <div className="grid grid-cols-1 gap-1 rounded-lg border bg-muted/30 p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{term}</dt>
      <dd className="min-w-0">
        <CellValue cell={cell} />
      </dd>
    </div>
  );
}

function LiquidityStack({ position }: { position: MappedLiquidityPosition }) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">
          Liquidity — {position.asset} · {position.positionId}
        </CardTitle>
        <CardDescription>
          Record {position.recordId} · as of {position.asOfLabel} · reported by the{' '}
          {position.reportedBy}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <dl className="grid grid-cols-1 gap-2">
          <StackRow term="Balance" cell={position.cells.balance} />
          <StackRow term="Reserved" cell={position.cells.reserved} />
          <StackRow term="Available" cell={position.cells.available} />
        </dl>
        <div className="mt-3">
          <EvidenceCell evidence={position.evidence} />
        </div>
      </CardContent>
    </Card>
  );
}

function CreditStack({ position }: { position: MappedCreditPosition }) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">
          Credit — {position.scope} · {position.positionId}
        </CardTitle>
        <CardDescription>
          Record {position.recordId} · as of {position.asOfLabel} · reported by the{' '}
          {position.reportedBy}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <dl className="grid grid-cols-1 gap-2">
          <StackRow term="Limit" cell={position.cells.creditLimit} />
          <StackRow term="Utilized" cell={position.cells.utilized} />
          <StackRow term="Remaining" cell={position.cells.remaining} />
        </dl>
        <div className="mt-3">
          <EvidenceCell evidence={position.evidence} />
        </div>
      </CardContent>
    </Card>
  );
}

// --- The composition disclosure (one deliberate step away) ---------------------

export interface PositionsCompositionProps {
  liquidity: readonly ProviderLiquidityPosition[];
  credit: readonly ProviderCreditPosition[];
  /** Harness support: start expanded (the live surfaces keep it collapsed). */
  defaultOpen?: boolean;
  /** UI-009: instance-unique landmark ids when rendered more than once per page. */
  idSuffix?: string;
}

export function PositionsComposition({
  liquidity,
  credit,
  defaultOpen = false,
  idSuffix = "",
}: PositionsCompositionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const mappedLiquidity = liquidity.map(mapLiquidityPosition);
  const mappedCredit = credit.map(mapCreditPosition);

  return (
    <section
      aria-label={`Position composition${idSuffix ? ` (${idSuffix})` : ""}`}
      className="space-y-3"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <Card className="gap-4">
          <CardHeader>
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <CardTitle
                  id={`positions-composition-heading${idSuffix}`}
                  className="text-base"
                >
                  Position composition
                </CardTitle>
                <CardDescription>
                  Per-position detail with the authority quote behind every value. This stays one
                  deliberate step away from the headline (P3) — choose to reveal it.
                </CardDescription>
              </div>
              <CollapsibleTrigger className={buttonVariants({ variant: 'outline' })}>
                {open ? (
                  <>
                    <ChevronUp aria-hidden className="size-4" />
                    Hide composition
                  </>
                ) : (
                  <>
                    <ChevronDown aria-hidden className="size-4" />
                    Show composition
                  </>
                )}
              </CollapsibleTrigger>
            </div>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="@container space-y-8">
              {/* Dense table form (container ≥ 576px) */}
              <div className="hidden @xl:block space-y-8">
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Liquidity positions</h3>
                  <LiquidityTable positions={mappedLiquidity} />
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Credit positions</h3>
                  <CreditTable positions={mappedCredit} />
                </div>
              </div>

              {/* Stacked definition-list form (container < 576px, e.g. 390px) —
                  readable, never truncated, never horizontally scrolled */}
              <div className="@xl:hidden space-y-4">
                <h3 className="text-sm font-semibold">Liquidity positions</h3>
                {mappedLiquidity.map((position) => (
                  <LiquidityStack key={position.positionId} position={position} />
                ))}
                <h3 className="text-sm font-semibold">Credit positions</h3>
                {mappedCredit.map((position) => (
                  <CreditStack key={position.positionId} position={position} />
                ))}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </section>
  );
}
