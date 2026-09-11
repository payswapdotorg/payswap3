// ============================================================================
// UI-007 — Provider liquidity surface (deliverable 7).
// ----------------------------------------------------------------------------
// Role-gated read-only visibility surface: the provider sees its OWN
// liquidity, credit, and queued positions. Every other audience is
// redirected home by requireRoleSurface (P8), and the port additionally
// mirrors the permissions the owning authorities permit (defense in depth).
//
// Every value on this surface is quoted by its owning protocol authority
// (the Liquidity Authority for liquidity and queued positions; the Credit
// Authority for credit positions, per
// spec/architecture/v0.1 liquidity-credit-queues.md). Nothing is computed,
// estimated, interpolated, or cached as truth on this surface.
// ============================================================================

import Link from 'next/link';

import { PositionsHeadline } from '@/components/liquidity/positions-headline';
import { PositionsComposition } from '@/components/liquidity/positions-table';
import { QueuePositionsView } from '@/components/liquidity/queue-positions-view';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getLiquidityPort } from '@/lib/protocol/liquidity-port';
import {
  mapAccessDenied,
  mapAuthorityBinding,
} from '@/lib/protocol/liquidity-state-mapping';
import { readSandboxOverridesFromCurrentRequest } from '@/lib/protocol/mock-liquidity-authority';
import { requireRoleSurface } from '@/lib/shell-guard';
import { resolveShellAudience } from '@/lib/shell-audience-server';
import { Clock, ShieldCheck } from 'lucide-react';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Liquidity positions — Payswap',
  description:
    'Read-only liquidity, credit, and queued positions quoted by the Liquidity Authority and the Credit Authority.',
};

export default async function ProviderLiquidityPage() {
  await requireRoleSurface('provider');
  const audience = await resolveShellAudience();
  const overrides = await readSandboxOverridesFromCurrentRequest();
  const result = await getLiquidityPort(overrides).getProviderPositions({
    kind: 'provider-positions',
    requester: audience,
  });
  const binding = mapAuthorityBinding(getLiquidityPort(overrides).binding);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="w-full max-w-6xl mx-auto px-4 py-6 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Payswap · provider surface
            </p>
            <div className="flex items-center gap-2">
              <Badge variant="outline">Viewing as {audience}</Badge>
              <Link href="/" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Home
              </Link>
            </div>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Liquidity positions</h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Read-only visibility of your own liquidity, credit, and queued positions. Truth on
            this surface is owned by its protocol authorities: the{' '}
            <strong>Liquidity Authority</strong> (liquidity positions and queued positions) and
            the <strong>Credit Authority</strong> (credit positions), per{' '}
            <span className="font-mono text-xs">{binding.authorityReference}</span>. This surface
            presents their quotes; it never computes, estimates, interpolates, or caches a value
            as truth.
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
            <PositionsHeadline view={result.view} />
            <PositionsComposition
              liquidity={result.view.liquidity}
              credit={result.view.credit}
            />
            <QueuePositionsView queues={result.view.queues} />
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
