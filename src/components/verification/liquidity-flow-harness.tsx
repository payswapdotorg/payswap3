'use client';

// ============================================================================
// UI-007 — Liquidity, credit, and queue verification harness (deliverable 10).
// ----------------------------------------------------------------------------
// The verification harness for the UI-007 surfaces. It demonstrates:
//   1. The adapter boundary report (port + NON-AUTHORITATIVE mock, ARRIVING).
//   2. The role-visibility matrix (permitted vs redirected home per role).
//   3. Scriptable authority-UNKNOWN value sources.
//   4. The position matrix across states, incl. UNKNOWN renderings.
//   5. Provenance-wording evidence (every value group names its owner).
//   6. Responsive-degradation evidence (a 390px container with the dense
//      table stacked to definition-list form — no horizontal scroll).
//
// The harness renders DEMONSTRATION data: sandbox mock data shaped like the
// provider and operator surfaces. It is presentation-only and NON-AUTHORITATIVE.
// It never renders one role's data to another role — the role matrix shows
// statuses only.
//
// Scripting flows through cookies (audience via POST /api/shell/audience;
// UNKNOWN sources via the sandbox cookie) followed by router.refresh(), so
// the server re-queries the mock on every change. Nothing is cached as truth.
// ============================================================================

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { PositionsHeadline } from '@/components/liquidity/positions-headline';
import { PositionsComposition } from '@/components/liquidity/positions-table';
import { QueuePositionsView } from '@/components/liquidity/queue-positions-view';
import { AvailabilityUnknownState } from '@/components/state';
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
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { NavAudience } from '@/lib/navigation';
import type {
  LiquidityValueSourceId,
  OperatorOversightView,
  ProviderPositionsView,
} from '@/lib/protocol/liquidity-port';
import { LIQUIDITY_MAPPING_RECORD_CATALOG, mapOperatorOversightView } from '@/lib/protocol/liquidity-state-mapping';
import { cn } from '@/lib/utils';
import {
  ArrowUpRight,
  Boxes,
  Eye,
  Fingerprint,
  Loader2,
  MonitorSmartphone,
  ShieldAlert,
  Split,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Harness prop types (plain, serializable — built by the server page)
// ---------------------------------------------------------------------------

export interface RoleMatrixRow {
  readonly audience: NavAudience;
  readonly providerSurface: 'permitted' | 'redirected';
  readonly oversightSurface: 'permitted' | 'redirected';
}

export interface ProvenanceRow {
  readonly group: string;
  readonly owner: string;
  readonly wording: string;
  readonly state: 'quoted' | 'unknown';
}

export interface SourceCatalogEntry {
  readonly id: LiquidityValueSourceId;
  readonly label: string;
  readonly surface: string;
  readonly owner: string;
}

export interface LiquidityFlowHarnessProps {
  readonly currentAudience: NavAudience;
  readonly audiences: readonly NavAudience[];
  readonly unknownSources: readonly LiquidityValueSourceId[];
  readonly sourceCatalog: readonly SourceCatalogEntry[];
  readonly roleMatrix: readonly RoleMatrixRow[];
  readonly provenanceRows: readonly ProvenanceRow[];
  readonly providerView: ProviderPositionsView;
  readonly oversightView: OperatorOversightView;
  readonly sandboxCookieName: string;
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

function SectionHeading({
  id,
  icon,
  title,
  description,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20 space-y-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md border bg-muted/40 p-2 text-muted-foreground">
          {icon}
        </div>
        <div className="space-y-1">
          <h2 id={`${id}-heading`} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground max-w-3xl">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function PermissionBadge({ state }: { state: 'permitted' | 'redirected' }) {
  if (state === 'permitted') {
    return (
      <Badge className="bg-emerald-700 text-white uppercase tracking-wide">Permitted — renders</Badge>
    );
  }
  return (
    <Badge className="bg-amber-700 text-white uppercase tracking-wide">Redirected home</Badge>
  );
}

/** Dense tables here degrade the same way the position tables do (P10). */
function ResponsiveTable({
  columns,
  rows,
  caption,
  renderRow,
  stack,
}: {
  columns: readonly string[];
  rows: number;
  caption: string;
  renderRow: (index: number) => ReactNode;
  stack: (index: number) => ReactNode;
}) {
  return (
    <div className="@container">
      <div className="hidden @xl:block">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column}>{column}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rows }, (_, index) => renderRow(index))}
          </TableBody>
        </Table>
      </div>
      <div className="@xl:hidden space-y-3">
        <span className="sr-only">{caption}</span>
        {Array.from({ length: rows }, (_, index) => stack(index))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

export function LiquidityFlowHarness({
  currentAudience,
  audiences,
  unknownSources,
  sourceCatalog,
  roleMatrix,
  provenanceRows,
  providerView,
  oversightView,
  sandboxCookieName,
}: LiquidityFlowHarnessProps) {
  const router = useRouter();
  const [audiencePending, setAudiencePending] = useState(false);
  const [sourcesPending, setSourcesPending] = useState(false);

  async function applyAudience(next: NavAudience) {
    setAudiencePending(true);
    try {
      await fetch('/api/shell/audience', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audience: next }),
      });
      router.refresh();
    } finally {
      setAudiencePending(false);
    }
  }

  function writeSandboxSources(next: readonly LiquidityValueSourceId[]) {
    setSourcesPending(true);
    document.cookie = `${sandboxCookieName}=${encodeURIComponent(
      JSON.stringify(next)
    )}; path=/; max-age=7200`;
    router.refresh();
    setSourcesPending(false);
  }

  function toggleSource(id: LiquidityValueSourceId, enabled: boolean) {
    const next = enabled
      ? Array.from(new Set([...unknownSources, id]))
      : unknownSources.filter((source) => source !== id);
    writeSandboxSources(next);
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="w-full max-w-6xl mx-auto px-4 py-6 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Payswap · UI-007 verification
            </p>
            <div className="flex items-center gap-2">
              <Badge variant="outline">Viewing as {currentAudience}</Badge>
              <Link href="/" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Home
              </Link>
            </div>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Liquidity, credit &amp; queue visibility — verification harness
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Verification of the read-only liquidity, credit, and queued-position surfaces:
            adapter boundary, role-visibility, UNKNOWN presentation, provenance wording, and
            responsive degradation. Demonstration data below is sandbox mock data,
            presentation-only and NON-AUTHORITATIVE (runtime ARRIVING).
          </p>
          <nav aria-label="Harness sections" className="flex flex-wrap gap-2 text-xs">
            {[
              ['#adapter-boundary', 'Adapter boundary'],
              ['#role-visibility', 'Role visibility'],
              ['#unknown-sources', 'UNKNOWN sources'],
              ['#position-matrix', 'Position matrix'],
              ['#provenance', 'Provenance wording'],
              ['#responsive', 'Responsive 390px'],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="inline-flex min-h-11 items-center rounded-md border bg-muted/40 px-2.5 py-1 font-medium hover:bg-muted"
              >
                {label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <div className="flex-1 w-full max-w-6xl mx-auto px-4 py-8 space-y-12">
        {/* ---------------------------------------------------------------- 1 */}
        <SectionHeading
          id="adapter-boundary"
          icon={<Split aria-hidden className="size-4" />}
          title="1 · Adapter boundary report"
          description="What is authoritative here (nothing, yet), who owns the truth, and what the boundary guarantees."
        >
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Boundary contract</CardTitle>
              <CardDescription>
                src/lib/protocol/liquidity-port.ts declares the surface&apos;s data needs and the
                port accessor. Its only backing today is
                src/lib/protocol/mock-liquidity-authority.ts — explicitly NON-AUTHORITATIVE,
                presentation-only, sandbox data only.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <AvailabilityUnknownState
                target="The authoritative liquidity, credit, and queue implementation"
                detail="The Liquidity Authority and the Credit Authority bindings arrive at runtime (ARRIVING), per spec/architecture/v0.1 liquidity-credit-queues.md. Until then every value on these surfaces comes from the presentation-only mock and is not authoritative."
              />
              <ul className="grid gap-2 text-sm md:grid-cols-2">
                <li className="rounded-lg border p-3">
                  <span className="font-medium">Owners of truth:</span> the Liquidity Authority
                  (liquidity positions, queued positions) and the Credit Authority (credit
                  positions).
                </li>
                <li className="rounded-lg border p-3">
                  <span className="font-medium">No UI-side computation:</span> every monetary
                  value is an authority-quoted string (or an explicit authority-UNKNOWN);
                  available is quoted in its own right, never balance minus reserved; oversight
                  aggregates are quoted, never summed.
                </li>
                <li className="rounded-lg border p-3">
                  <span className="font-medium">UNKNOWN contract:</span> indeterminate values
                  render UNKNOWN with their reconciliation path — never zero, empty, failed,
                  or a definitive value.
                </li>
                <li className="rounded-lg border p-3">
                  <span className="font-medium">At ARRIVING:</span> the authoritative
                  implementation binds behind the port accessor; the surfaces, the state
                  mapping, and the mapping records stay exactly as they are.
                </li>
              </ul>
              <p className="text-xs text-muted-foreground">
                Mapping record for this state: LQ-012 (authority-binding.arriving).
              </p>
            </CardContent>
          </Card>
        </SectionHeading>

        {/* ---------------------------------------------------------------- 2 */}
        <SectionHeading
          id="role-visibility"
          icon={<ShieldAlert aria-hidden className="size-4" />}
          title="2 · Role-visibility matrix (P8)"
          description="Only roles permitted by the owning authorities see each surface; every other audience is redirected home by requireRoleSurface. Deep links are role-checked. The port re-checks permission per query (defense in depth). This matrix shows statuses only — never data."
        >
          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Switch the simulated audience</p>
                    <p className="text-xs text-muted-foreground">
                      POST /api/shell/audience (cookie-backed), then router.refresh(). The live
                      surfaces react to this cookie.
                    </p>
                  </div>
                  {audiencePending ? (
                    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 aria-hidden className="size-3.5 animate-spin" />
                      applying…
                    </span>
                  ) : null}
                </div>
                <RadioGroup
                  value={currentAudience}
                  onValueChange={(value) => applyAudience(value as NavAudience)}
                  className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
                  aria-label="Simulated audience"
                >
                  {audiences.map((audience) => (
                    <div
                      key={audience}
                      className="flex items-center gap-2 rounded-lg border p-3"
                    >
                      <RadioGroupItem id={`audience-${audience}`} value={audience} />
                      <Label
                        htmlFor={`audience-${audience}`}
                        className="flex min-h-11 items-center font-normal cursor-pointer"
                      >
                        {audience}
                        {audience === currentAudience ? (
                          <span className="ml-2 text-xs text-muted-foreground">(current)</span>
                        ) : null}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Permitted vs redirected, per role</CardTitle>
                <CardDescription>
                  /liquidity is the provider surface (guard: requireRoleSurface(&apos;provider&apos;));
                  /oversight is the operator surface (guard:
                  requireRoleSurface(&apos;operator&apos;)). Click “open” with a given audience to
                  see the surface render — or redirect home.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveTable
                  columns={['Audience', '/liquidity (provider)', '/oversight (operator)', 'Try']}
                  rows={roleMatrix.length}
                  caption="Role-visibility matrix"
                  renderRow={(index) => {
                    const row = roleMatrix[index];
                    return (
                      <TableRow key={row.audience}>
                        <TableCell className="whitespace-normal font-medium">
                          {row.audience}
                          {row.audience === currentAudience ? (
                            <span className="ml-2 text-xs text-muted-foreground">(current)</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <PermissionBadge state={row.providerSurface} />
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <PermissionBadge state={row.oversightSurface} />
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <div className="flex gap-2">
                            <Link
                              href="/liquidity"
                              className={buttonVariants({ variant: 'outline', size: 'sm' })}
                            >
                              open /liquidity
                            </Link>
                            <Link
                              href="/oversight"
                              className={buttonVariants({ variant: 'outline', size: 'sm' })}
                            >
                              open /oversight
                            </Link>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  }}
                  stack={(index) => {
                    const row = roleMatrix[index];
                    return (
                      <div key={row.audience} className="rounded-lg border p-3 space-y-2">
                        <p className="text-sm font-medium">{row.audience}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <PermissionBadge state={row.providerSurface} />
                          <Link
                            href="/liquidity"
                            className={buttonVariants({ variant: 'outline', size: 'sm' })}
                          >
                            open /liquidity
                          </Link>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <PermissionBadge state={row.oversightSurface} />
                          <Link
                            href="/oversight"
                            className={buttonVariants({ variant: 'outline', size: 'sm' })}
                          >
                            open /oversight
                          </Link>
                        </div>
                      </div>
                    );
                  }}
                />
                <p className="mt-3 text-xs text-muted-foreground">
                  Mapping record: LQ-011 (access.denied). A denied visit never renders data —
                  not even partially.
                </p>
              </CardContent>
            </Card>
          </div>
        </SectionHeading>

        {/* ---------------------------------------------------------------- 3 */}
        <SectionHeading
          id="unknown-sources"
          icon={<Boxes aria-hidden className="size-4" />}
          title="3 · Scriptable authority-UNKNOWN sources"
          description="Force any value source to report authority-UNKNOWN. The mock is scripted per request through a cookie; the surfaces then render UNKNOWN with the reconciliation path — never zero, empty, failed, or a definitive value."
        >
          <Card>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  Active UNKNOWN sources:{' '}
                  <span className="font-mono text-xs">
                    {unknownSources.length === 0 ? 'none' : unknownSources.join(', ')}
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  {sourcesPending ? (
                    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 aria-hidden className="size-3.5 animate-spin" />
                      applying…
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    onClick={() => writeSandboxSources([])}
                  >
                    Reset all to quoted
                  </button>
                </div>
              </div>
              <ul className="grid gap-2 md:grid-cols-2">
                {sourceCatalog.map((source) => {
                  const checked = unknownSources.includes(source.id);
                  return (
                    <li
                      key={source.id}
                      className="flex items-start justify-between gap-3 rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        <Label
                          htmlFor={`source-${source.id}`}
                          className="flex flex-col gap-0.5 font-normal"
                        >
                          <span className="font-medium">{source.label}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {source.id}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            owner: {source.owner} · surface: {source.surface}
                          </span>
                        </Label>
                      </div>
                      <Switch
                        id={`source-${source.id}`}
                        checked={checked}
                        onCheckedChange={(enabled) => toggleSource(source.id, enabled)}
                        aria-label={`Force ${source.label} to authority-UNKNOWN`}
                      />
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted-foreground">
                Toggling re-queries the mock server-side on refresh — the demonstration matrix
                and the live surfaces below reflect the scripted indeterminacy immediately. The
                scripting cannot invent new value sources or fabricate values.
              </p>
            </CardContent>
          </Card>
        </SectionHeading>

        {/* ---------------------------------------------------------------- 4 */}
        <SectionHeading
          id="position-matrix"
          icon={<Eye aria-hidden className="size-4" />}
          title="4 · Position matrix across states"
          description="The LQ record catalog (authority state → display presentation), followed by the live demonstration rendering of the provider-surface components under the currently scripted sources. Demonstration data: sandbox mock shaped like the provider surface — presentation-only, NON-AUTHORITATIVE."
        >
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">LQ mapping-record catalog</CardTitle>
                <CardDescription>
                  Every consequential visibility state on these surfaces, one-to-one with its
                  display presentation (companion: spec/product/liquidity-mapping-records.md).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveTable
                  columns={['Record', 'Authority state', 'Owning authority', 'Display presentation']}
                  rows={LIQUIDITY_MAPPING_RECORD_CATALOG.length}
                  caption="LQ mapping-record catalog"
                  renderRow={(index) => {
                    const record = LIQUIDITY_MAPPING_RECORD_CATALOG[index];
                    return (
                      <TableRow key={record.recordId}>
                        <TableCell className="whitespace-normal font-mono text-xs">
                          {record.recordId}
                        </TableCell>
                        <TableCell className="whitespace-normal font-mono text-xs">
                          {record.authorityState}
                        </TableCell>
                        <TableCell className="whitespace-normal text-xs">
                          {record.owningAuthority}
                        </TableCell>
                        <TableCell className="whitespace-normal text-xs">
                          {record.presentation}
                        </TableCell>
                      </TableRow>
                    );
                  }}
                  stack={(index) => {
                    const record = LIQUIDITY_MAPPING_RECORD_CATALOG[index];
                    return (
                      <div key={record.recordId} className="rounded-lg border p-3 space-y-1">
                        <p className="font-mono text-xs">
                          {record.recordId} · {record.authorityState}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {record.owningAuthority}
                        </p>
                        <p className="text-xs">{record.presentation}</p>
                      </div>
                    );
                  }}
                />
              </CardContent>
            </Card>

            <div className="rounded-xl border bg-muted/20 p-4 space-y-6">
              <div className="space-y-1">
                <p className="text-sm font-medium flex items-center gap-2">
                  <ArrowUpRight aria-hidden className="size-4 text-muted-foreground" />
                  Live demonstration — provider surface components
                </p>
                <p className="text-xs text-muted-foreground">
                  Rendered from the current mock query with the scripted UNKNOWN sources applied.
                  Reveal the composition disclosures deliberately (P3) — they start closed, as on
                  the live surface.
                </p>
              </div>
              <PositionsHeadline view={providerView} />
              <PositionsComposition
                liquidity={providerView.liquidity}
                credit={providerView.credit}
                idSuffix="provider"
              />
              <QueuePositionsView queues={providerView.queues} />
              <Separator />
              <div className="space-y-1">
                <p className="text-sm font-medium">Live demonstration — operator surface aggregates</p>
                <p className="text-xs text-muted-foreground">
                  The oversight-permitted aggregates, as quoted by the authorities (never summed
                  here).
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {mapOperatorOversightView(oversightView).aggregates.map((aggregate) => (
                  <div key={aggregate.aggregateId} className="rounded-lg border bg-card p-4 space-y-2">
                    <p className="text-sm font-medium">{aggregate.label}</p>
                    {aggregate.value.kind === 'unknown' ? (
                      <p className="rounded-md border border-amber-500/40 bg-amber-50/60 p-2 text-xs dark:bg-amber-950/20">
                        UNKNOWN — {aggregate.value.subject}. {aggregate.value.explanation}{' '}
                        Resolves: {aggregate.value.reconciliation.whoResolves} — recheck:{' '}
                        {aggregate.value.reconciliation.recheckTrigger}.
                      </p>
                    ) : (
                      <p className="text-2xl font-semibold tabular-nums">
                        {aggregate.value.kind === 'quoted-amount'
                          ? aggregate.value.formatted
                          : aggregate.value.count}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Reported by the {aggregate.reportedBy} · {aggregate.note}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </SectionHeading>

        {/* ---------------------------------------------------------------- 5 */}
        <SectionHeading
          id="provenance"
          icon={<Fingerprint aria-hidden className="size-4" />}
          title="5 · Provenance-wording evidence (P11)"
          description="Every value group names its owning authority. This table is derived from the current mock query — quoted values carry their quote wording; scripted-UNKNOWN values carry their reconciliation wording."
        >
          <Card>
            <CardContent>
              <ResponsiveTable
                columns={['Value group', 'Owning authority', 'State', 'Wording presented']}
                rows={provenanceRows.length}
                caption="Provenance wording per value group"
                renderRow={(index) => {
                  const row = provenanceRows[index];
                  return (
                    <TableRow key={row.group}>
                      <TableCell className="whitespace-normal font-medium">{row.group}</TableCell>
                      <TableCell className="whitespace-normal">{row.owner}</TableCell>
                      <TableCell className="whitespace-normal">
                        <Badge
                          variant="outline"
                          className={cn(
                            row.state === 'unknown'
                              ? 'border-amber-600/50 text-amber-800 dark:text-amber-300'
                              : 'border-emerald-700/40 text-emerald-800 dark:text-emerald-300'
                          )}
                        >
                          {row.state}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-normal text-xs">{row.wording}</TableCell>
                    </TableRow>
                  );
                }}
                stack={(index) => {
                  const row = provenanceRows[index];
                  return (
                    <div key={row.group} className="rounded-lg border p-3 space-y-1">
                      <p className="text-sm font-medium">{row.group}</p>
                      <p className="text-xs text-muted-foreground">
                        owner: {row.owner} · state: {row.state}
                      </p>
                      <p className="text-xs">{row.wording}</p>
                    </div>
                  );
                }}
              />
            </CardContent>
          </Card>
        </SectionHeading>

        {/* ---------------------------------------------------------------- 6 */}
        <SectionHeading
          id="responsive"
          icon={<MonitorSmartphone aria-hidden className="size-4" />}
          title="6 · Responsive-degradation evidence (P10, 390px)"
          description="A 390px-wide container renders the dense position table stacked into definition-list form. Degradation is container-query driven, so this box proves the mobile form regardless of your viewport width."
        >
          <div className="space-y-4">
            <div className="rounded-xl border-2 border-dashed p-3">
              <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                390px container — stacked definition-list form, no horizontal scroll
              </p>
              <div className="mx-auto" style={{ width: 390, maxWidth: '100%' }}>
                <PositionsComposition
                  liquidity={providerView.liquidity}
                  credit={providerView.credit}
                  defaultOpen
                  idSuffix="mobile demo"
                />
              </div>
            </div>
            <Alert>
              <MonitorSmartphone aria-hidden />
              <AlertTitle>What to verify on a real 390px viewport</AlertTitle>
              <AlertDescription>
                The dense tables never scroll horizontally and never truncate: the table form
                yields to stacked definition lists below a 576px container; every cell wraps
                (whitespace-normal); UNKNOWN cells render full UnknownState wording — never
                zero, empty, or clipped. The same holds on /liquidity and /oversight.
              </AlertDescription>
            </Alert>
          </div>
        </SectionHeading>

        {/* ---------------------------------------------------------------- 7 */}
        <SectionHeading
          id="how-to-verify"
          icon={<ArrowUpRight aria-hidden className="size-4" />}
          title="7 · Live-surface verification checklist"
          description="Use the audience switcher above, then walk each surface with this checklist."
        >
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              Audience <span className="font-mono">provider</span> → open{' '}
              <Link href="/liquidity" className="font-medium underline underline-offset-4">
                /liquidity
              </Link>{' '}
              — the provider surface renders its own positions, composition one deliberate step
              away; opening <Link href="/oversight" className="font-medium underline underline-offset-4">/oversight</Link>{' '}
              redirects home.
            </li>
            <li>
              Audience <span className="font-mono">operator</span> → open{' '}
              <Link href="/oversight" className="font-medium underline underline-offset-4">
                /oversight
              </Link>{' '}
              — the oversight aggregates render; opening{' '}
              <Link href="/liquidity" className="font-medium underline underline-offset-4">/liquidity</Link>{' '}
              redirects home.
            </li>
            <li>
              Audiences <span className="font-mono">unauthenticated</span>,{' '}
              <span className="font-mono">customer</span>,{' '}
              <span className="font-mono">merchant</span>,{' '}
              <span className="font-mono">administrator</span> → both surfaces redirect home
              (mapping record LQ-011).
            </li>
            <li>
              Toggle any UNKNOWN source (section 3), then re-open a surface — the value renders
              UNKNOWN with its reconciliation path; never zero, empty, or failed.
            </li>
            <li>
              Check provenance wording on every value group (section 5) — each names its owning
              authority and quote.
            </li>
            <li>
              Narrow the browser to 390px (or use the box in section 6) — stacked definition
              lists, no horizontal scroll, no truncation.
            </li>
          </ol>
        </SectionHeading>
      </div>

      <footer className="mt-auto border-t">
        <div className="w-full max-w-6xl mx-auto px-4 py-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">UI-007</Badge>
          <span>
            Verification harness · demonstration data is sandbox mock, presentation-only,
            NON-AUTHORITATIVE · authority runtime ARRIVING.
          </span>
        </div>
      </footer>
    </div>
  );
}
