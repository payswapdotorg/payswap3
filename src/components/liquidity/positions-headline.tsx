// ============================================================================
// UI-007 — Positions headline (deliverable 4).
// ----------------------------------------------------------------------------
// Headline positions first (P3): the read-only position summary with
// provenance wording (reported-by authority) on every value group.
//
// Every value rendered here comes from the authority through the liquidity
// port, mapped one-to-one by liquidity-state-mapping. This component never
// computes, estimates, interpolates, or caches a value, and it renders
// authority-UNKNOWN values as UNKNOWN with their reconciliation path — never
// as zero, empty, failed, or a definitive value.
// ============================================================================

import Link from 'next/link';

import { UnknownState } from '@/components/state';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { ProviderPositionsView } from '@/lib/protocol/liquidity-port';
import {
  mapCreditPosition,
  mapLiquidityPosition,
  provenanceWordingForCell,
  type MappedValueCell,
} from '@/lib/protocol/liquidity-state-mapping';
import { cn } from '@/lib/utils';

function ValueBlock({
  label,
  cell,
}: {
  label: string;
  cell: MappedValueCell;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {cell.kind === 'unknown' ? (
        <UnknownState
          subject={cell.subject}
          explanation={cell.explanation}
          reconciliation={cell.reconciliation}
        />
      ) : (
        <>
          <p className="text-2xl font-semibold tabular-nums tracking-tight">
            {cell.kind === 'quoted-amount' ? cell.formatted : cell.count}
          </p>
          <p className="text-xs text-muted-foreground">
            Reported by the {cell.quotedBy} · quote {cell.quoteId} · as of {cell.quotedAtLabel}
          </p>
        </>
      )}
    </div>
  );
}

function EvidenceLinks({
  evidence,
}: {
  evidence: readonly { label: string; href: string }[];
}) {
  if (evidence.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {evidence.map((ref) => (
        <Link
          key={ref.href}
          href={ref.href}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            // Authority-provided evidence labels may be long: they must wrap
            // at small breakpoints — never truncate, never force horizontal
            // scroll (P10). buttonVariants bakes in shrink-0 + whitespace-nowrap,
            // which we deliberately override for long authority labels.
            'h-auto min-w-0 shrink whitespace-normal text-left'
          )}
        >
          {ref.label}
        </Link>
      ))}
    </div>
  );
}

export function PositionsHeadline({ view }: { view: ProviderPositionsView }) {
  const liquidity = view.liquidity.map(mapLiquidityPosition);
  const credit = view.credit.map(mapCreditPosition);
  const firstCell =
    liquidity[0]?.cells.balance ?? credit[0]?.cells.creditLimit ?? null;

  return (
    <section aria-labelledby="positions-headline-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="positions-headline-heading" className="text-lg font-semibold tracking-tight">
            Headline positions
          </h2>
          <p className="text-sm text-muted-foreground">
            Read-only summary, reported by the owning authorities. Position composition stays
            one deliberate step away (below).
          </p>
        </div>
        <Badge variant="outline">As of {liquidity[0]?.asOfLabel ?? view.asOf}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {liquidity.map((position) => (
          <Card key={position.positionId} className="gap-4">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  Liquidity — {position.asset} position
                </CardTitle>
                <Badge variant="secondary">{position.reportedBy}</Badge>
              </div>
              <CardDescription>
                Reported by the {position.reportedBy} ({position.positionId}). Balance, reserved,
                and available are each quoted in their own right — never derived on this surface.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <ValueBlock label="Balance" cell={position.cells.balance} />
              <ValueBlock label="Reserved" cell={position.cells.reserved} />
              <ValueBlock label="Available" cell={position.cells.available} />
            </CardContent>
            <CardFooter className="flex-col items-start gap-3">
              <p className="min-w-0 break-words text-xs text-muted-foreground">
                Mapping record: {position.recordId} ({position.state})
              </p>
              <EvidenceLinks evidence={position.evidence} />
            </CardFooter>
          </Card>
        ))}

        {credit.map((position) => (
          <Card key={position.positionId} className="gap-4">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Credit — {position.scope}</CardTitle>
                <Badge variant="secondary">{position.reportedBy}</Badge>
              </div>
              <CardDescription>
                Reported by the {position.reportedBy} ({position.positionId}). Limit, utilized,
                and remaining are each quoted in their own right — remaining is never computed
                as limit minus utilized on this surface.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <ValueBlock label="Limit" cell={position.cells.creditLimit} />
              <ValueBlock label="Utilized" cell={position.cells.utilized} />
              <ValueBlock label="Remaining" cell={position.cells.remaining} />
            </CardContent>
            <CardFooter className="flex-col items-start gap-3">
              <p className="min-w-0 break-words text-xs text-muted-foreground">
                Mapping record: {position.recordId} ({position.state})
              </p>
              <EvidenceLinks evidence={position.evidence} />
            </CardFooter>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Every value group above carries its own reported-by provenance wording. Example wording —{' '}
        {firstCell ? (
          <span className="font-mono">“{provenanceWordingForCell(firstCell)}”</span>
        ) : (
          'no positions are present for this provider.'
        )}
      </p>
    </section>
  );
}
