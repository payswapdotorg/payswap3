// ============================================================================
// UI-007 — Operator oversight surface (deliverable 7).
// ----------------------------------------------------------------------------
// Role-gated read-only visibility surface: the operator sees ONLY the
// oversight-permitted aggregates quoted by the owning authorities. Every
// other audience is redirected home by requireRoleSurface (P8), and the port
// additionally mirrors the permissions the owning authorities permit
// (defense in depth).
//
// The aggregates below are authority-quoted values. They are never summed,
// filtered, derived, or cached UI-side — the operator surface presents each
// aggregate exactly as the Liquidity Authority or the Credit Authority quoted
// it. Provider-identifying detail is not visible on this surface.
// ============================================================================

import Link from 'next/link';

import { UnknownState } from '@/components/state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { getLiquidityPort } from '@/lib/protocol/liquidity-port';
import {
  mapAccessDenied,
  mapAuthorityBinding,
  mapOperatorOversightView,
} from '@/lib/protocol/liquidity-state-mapping';
import { readSandboxOverridesFromCurrentRequest } from '@/lib/protocol/mock-liquidity-authority';
import { requireRoleSurface } from '@/lib/shell-guard';
import { resolveShellAudience } from '@/lib/shell-audience-server';
import { Clock, Eye, ShieldCheck } from 'lucide-react';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Oversight — Payswap',
  description:
    'Authority-quoted oversight aggregates permitted to operators by the Liquidity Authority and the Credit Authority.',
};

export default async function OperatorOversightPage() {
  await requireRoleSurface('operator');
  const audience = await resolveShellAudience();
  const overrides = await readSandboxOverridesFromCurrentRequest();
  const port = getLiquidityPort(overrides);
  const result = await port.getOperatorOversight({
    kind: 'operator-oversight',
    requester: audience,
  });
  const binding = mapAuthorityBinding(port.binding);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="w-full max-w-6xl mx-auto px-4 py-6 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Payswap · operator surface
            </p>
            <div className="flex items-center gap-2">
              <Badge variant="outline">Viewing as {audience}</Badge>
              <Link href="/" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Home
              </Link>
            </div>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Oversight</h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Read-only visibility of the aggregates the owning authorities permit to oversight.
            Truth on this surface is owned by its protocol authorities: the{' '}
            <strong>Liquidity Authority</strong> and the <strong>Credit Authority</strong>, per{' '}
            <span className="font-mono text-xs">{binding.authorityReference}</span>. Every value
            below is an authority-quoted aggregate — this surface never sums, filters, derives,
            or caches a value as truth.
          </p>
        </div>
      </header>

      <div className="flex-1 w-full max-w-6xl mx-auto px-4 py-8 space-y-8">
        <Alert>
          <Clock aria-hidden />
          <AlertTitle>Authority binding: ARRIVING (record {binding.recordId})</AlertTitle>
          <AlertDescription>
            {binding.detail} Provenance labels still name the authority that owns each value at
            runtime.
          </AlertDescription>
        </Alert>

        {result.kind === 'permitted' ? (
          <>
            <Alert>
              <Eye aria-hidden />
              <AlertTitle>Oversight scope</AlertTitle>
              <AlertDescription>{result.view.scopeNote}</AlertDescription>
            </Alert>

            <section aria-labelledby="oversight-aggregates-heading" className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 id="oversight-aggregates-heading" className="text-lg font-semibold tracking-tight">
                    Permitted aggregates
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Headline aggregates first; each aggregate&apos;s provenance is stated with the
                    value. Composition detail beyond these aggregates is not visible to
                    oversight.
                  </p>
                </div>
                <Badge variant="outline">As of {mapOperatorOversightView(result.view).asOfLabel}</Badge>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {mapOperatorOversightView(result.view).aggregates.map((aggregate) => (
                  <Card key={aggregate.aggregateId} className="justify-between gap-4">
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="text-base">{aggregate.label}</CardTitle>
                        <Badge variant="secondary">{aggregate.reportedBy}</Badge>
                      </div>
                      <CardDescription>{aggregate.note}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {aggregate.value.kind === 'unknown' ? (
                        <UnknownState
                          subject={aggregate.value.subject}
                          explanation={aggregate.value.explanation}
                          reconciliation={aggregate.value.reconciliation}
                        />
                      ) : (
                        <div className="space-y-1">
                          <p className="text-3xl font-semibold tabular-nums tracking-tight">
                            {aggregate.value.kind === 'quoted-amount'
                              ? aggregate.value.formatted
                              : aggregate.value.count}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Reported by the {aggregate.value.quotedBy} · quote{' '}
                            {aggregate.value.quoteId} · as of {aggregate.value.quotedAtLabel}
                          </p>
                        </div>
                      )}
                    </CardContent>
                    <CardFooter>
                      <p className="text-xs text-muted-foreground">
                        Mapping record: {aggregate.recordId} ({aggregate.state})
                      </p>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            </section>
          </>
        ) : (
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-base">This surface did not render</CardTitle>
              <CardDescription>
                Mapping record {mapAccessDenied(result).recordId} — access denied by the owning
                protocol authorities.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm">{mapAccessDenied(result).reason}</p>
              <p className="text-xs text-muted-foreground">
                Requesting audience: {mapAccessDenied(result).requester} · surface:{' '}
                {mapAccessDenied(result).surface}
              </p>
            </CardContent>
            <CardFooter>
              <Link href="/" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                <ShieldCheck aria-hidden className="size-3.5" />
                Return home
              </Link>
            </CardFooter>
          </Card>
        )}
      </div>

      <footer className="mt-auto border-t">
        <div className="w-full max-w-6xl mx-auto px-4 py-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">UI-007</Badge>
          <span>
            Read-only presentation · owners: Liquidity Authority, Credit Authority · mock
            backing, runtime ARRIVING — non-authoritative.
          </span>
        </div>
      </footer>
    </div>
  );
}
