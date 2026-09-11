"use client";

/**
 * UI-004 — Capability flow verification harness.
 *
 * Verifies the provider capability surface end-to-end through the real
 * adapter boundary (capability port -> mock authority -> state mapping ->
 * shared primitives):
 *
 *  1. Adapter boundary report — port, backing, authority owner, runtime,
 *     and the one-to-one authority-state -> display-state mapping table.
 *  2. Scriptable availability — re-resolves the capability state matrix with
 *     sources reachable / degraded (partial data) / unreachable.
 *  3. Capability state matrix — every fixture rendered through the real
 *     mapping and primitives, including the UNKNOWN-versus-failure
 *     distinction (indeterminate and source-unavailable never render as
 *     success or failure) and the role matrix (deep-link role checks).
 *
 * The harness only reads: scripted availability changes what the mock returns
 * to this harness, never any protocol state.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Eye } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AvailabilityUnknownState } from "@/components/state";
import { CapabilityHeadlineStatus } from "@/components/provider/capability-headline-status";
import { CapabilityStatePresentation } from "@/components/provider/capability-state-presentation";
import { getCapabilityPort } from "@/lib/protocol/capability-port";
import {
  MOCK_DEFAULT_SOURCE_AVAILABILITY,
  withAvailabilityScript,
} from "@/lib/protocol/mock-capability-authority";
import type { CapabilityItem, CapabilityListing } from "@/lib/protocol/capability-port";
import type { CapabilitySourceAvailability } from "@/lib/protocol/capability-port";
import { CAPABILITY_STATE_MAPPING_TABLE } from "@/lib/protocol/capability-state-mapping";
import { guardSurface, resolveNavigation } from "@/lib/navigation";
import type { NavAudience, NavEntry } from "@/lib/navigation";

// ResolvedNavigation ({primary, footer}) flattened for array-style checks —
// integration splice for the real navigation grammar (stand-in returned an
// array; the real resolveNavigation returns the two-bucket shape).
function flatNavigation(audience: NavAudience): readonly NavEntry[] {
  const resolved = resolveNavigation(audience);
  return [...resolved.primary, ...resolved.footer];
}


const NAV_AUDIENCES: readonly NavAudience[] = [
  "unauthenticated",
  "customer",
  "merchant",
  "provider",
  "operator",
  "administrator",
];

/** The provider surfaces allow exactly the provider audience (P8). */
const PROVIDER_SURFACE_ALLOWED: readonly NavAudience[] = ["provider"];

const AVAILABILITY_OPTIONS: Readonly<
  Array<{ value: CapabilitySourceAvailability; label: string }>
> = [
  { value: "reachable", label: "Reachable" },
  { value: "degraded", label: "Degraded (partial data)" },
  { value: "unreachable", label: "Unreachable" },
];

function SectionCard({
  title,
  description,
  children,
  id,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <Card aria-labelledby={id}>
      <CardHeader>
        <h2 id={id} className="leading-none font-semibold">
          {title}
        </h2>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function MatrixItem({ item }: { item: CapabilityItem }) {
  const { report, source } = item;
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-semibold">{item.descriptor.name}</p>
        <p className="text-xs text-muted-foreground">
          {report
            ? `Authority state: ${report.state}`
            : "Authority state: no report (source unavailable)"}{" "}
          · source: {source.name} ({source.availability})
        </p>
      </div>
      <CapabilityHeadlineStatus item={item} />
      <CapabilityStatePresentation item={item} />
    </div>
  );
}

export function CapabilityFlowHarness() {
  const port = getCapabilityPort();
  const [baseline, setBaseline] = useState<CapabilityListing | null>(null);
  const [listing, setListing] = useState<CapabilityListing | null>(null);
  const [sourceOverrides, setSourceOverrides] = useState<
    Record<string, CapabilitySourceAvailability>
  >({ ...MOCK_DEFAULT_SOURCE_AVAILABILITY });

  // Unscripted baseline: exactly what the live provider surface renders.
  useEffect(() => {
    let cancelled = false;
    getCapabilityPort()
      .listCapabilities()
      .then((result) => {
        if (!cancelled) setBaseline(result);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Scripted resolution for the state matrix.
  useEffect(() => {
    let cancelled = false;
    withAvailabilityScript({ sourceAvailability: sourceOverrides })
      .listCapabilities()
      .then((result) => {
        if (!cancelled) setListing(result);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceOverrides]);

  const failedItem = baseline?.items.find(
    (item) => item.descriptor.id === "fx-conversion",
  );
  const unknownItem = baseline?.items.find(
    (item) => item.descriptor.id === "routing-participation",
  );
  const availabilityUnknownItem = baseline?.items.find(
    (item) => item.descriptor.id === "cross-border-settlement",
  );

  return (
    <div className="space-y-6">
      <Alert>
        <Eye aria-hidden="true" />
        <AlertTitle>What this harness verifies</AlertTitle>
        <AlertDescription>
          The capability state matrix (including UNKNOWN-versus-failure), the
          role matrix for the provider surfaces, and the adapter boundary
          report. Everything renders through the real port, mapping, and shared
          primitives — the same path the live surface uses.
        </AlertDescription>
      </Alert>

      <SectionCard
        id="adapter-boundary"
        title="Adapter boundary report"
        description="The boundary the provider capability surface consumes, exactly as UI-002 established for the intent surface."
      >
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(11rem,auto)_1fr]">
          <dt className="font-medium">Port module</dt>
          <dd className="text-muted-foreground">src/lib/protocol/capability-port.ts</dd>
          <dt className="font-medium">Port accessor</dt>
          <dd className="text-muted-foreground">getCapabilityPort()</dd>
          <dt className="font-medium">Backing</dt>
          <dd className="text-muted-foreground">
            src/lib/protocol/mock-capability-authority.ts — NON-AUTHORITATIVE,
            presentation-only
          </dd>
          <dt className="font-medium">Authority owner</dt>
          <dd className="text-muted-foreground">{port.boundary.authorityOwner}</dd>
          <dt className="font-medium">Runtime</dt>
          <dd className="text-muted-foreground">{port.boundary.runtime}</dd>
          <dt className="font-medium">Authoritative</dt>
          <dd className="text-muted-foreground">
            {String(port.boundary.authoritative)} — {port.boundary.notes}
          </dd>
          <dt className="font-medium">Port surface (read-only)</dt>
          <dd className="text-muted-foreground">
            listCapabilities(query), getCapability(capabilityId, query) — no
            mutating methods; nothing on the provider surface can change state
            through the port
          </dd>
          <dt className="font-medium">Mapping module</dt>
          <dd className="text-muted-foreground">
            src/lib/protocol/capability-state-mapping.ts (one-to-one, P4)
          </dd>
        </dl>
        <h3 className="pt-2 text-sm font-semibold">
          Authority state → display state (one-to-one)
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Axis</TableHead>
              <TableHead>Authority value</TableHead>
              <TableHead>Display kind</TableHead>
              <TableHead>Primitive</TableHead>
              <TableHead>Record</TableHead>
              <TableHead>Never renders as</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {CAPABILITY_STATE_MAPPING_TABLE.map((row) => (
              <TableRow key={`${row.axis}-${row.authorityValue}`}>
                <TableCell className="text-muted-foreground">{row.axis}</TableCell>
                <TableCell className="font-medium">{row.authorityValue}</TableCell>
                <TableCell>{row.displayKind}</TableCell>
                <TableCell className="text-muted-foreground">{row.primitive}</TableCell>
                <TableCell>{row.recordId}</TableCell>
                <TableCell className="text-muted-foreground">
                  {row.neverRendersAs}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>

      <SectionCard
        id="scriptable-availability"
        title="Scriptable availability"
        description="Harness-only scripting of what the mock authority returns. Degraded means partial data: the authority cannot determine affected capabilities (indeterminate → UNKNOWN). Unreachable means no report at all (availability unknown). The live provider surface is unscripted."
      >
        {!baseline ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-9 w-64" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {baseline.sources.map((source) => (
              <div key={source.id} className="space-y-1.5">
                <label
                  htmlFor={`source-${source.id}`}
                  className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {source.name}
                </label>
                <Select
                  value={sourceOverrides[source.id] ?? source.availability}
                  onValueChange={(value) =>
                    setSourceOverrides((previous) => ({
                      ...previous,
                      [source.id]: value as CapabilitySourceAvailability,
                    }))
                  }
                >
                  <SelectTrigger
                    id={`source-${source.id}`}
                    className="w-full"
                    aria-label={`${source.name} availability`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AVAILABILITY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        id="state-matrix"
        title="Capability state matrix"
        description="Every capability resolved through the real mapping and shared primitives under the scripted availability."
      >
        {!listing ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-48 rounded-xl" />
            ))}
          </div>
        ) : listing.items.length === 0 ? (
          <div className="space-y-3">
            <AvailabilityUnknownState
              target="Capability Registry"
              detail="With the registry unreachable, the set of capabilities itself cannot be authoritatively enumerated — so no items render, and the surface must not claim that no capabilities exist."
            />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {listing.items.map((item) => (
              <MatrixItem key={item.descriptor.id} item={item} />
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        id="unknown-vs-failure"
        title="UNKNOWN versus failure"
        description="Three distinct renders with three distinct mapping records. Indeterminate and source-unavailable never render as success or failure (P4, P5)."
      >
        {!baseline ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-destructive">
                  Definitive negative — unavailable
                </p>
                {failedItem ? <CapabilityStatePresentation item={failedItem} /> : null}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                  Indeterminate — UNKNOWN with reconciliation
                </p>
                {unknownItem ? <CapabilityStatePresentation item={unknownItem} /> : null}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                  Source unavailable — availability unknown
                </p>
                {availabilityUnknownItem ? (
                  <CapabilityStatePresentation item={availabilityUnknownItem} />
                ) : null}
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aspect</TableHead>
                  <TableHead>Unavailable</TableHead>
                  <TableHead>Indeterminate</TableHead>
                  <TableHead>Source unreachable</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">Authority state</TableCell>
                  <TableCell>unavailable</TableCell>
                  <TableCell>indeterminate</TableCell>
                  <TableCell>no report (availability axis)</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Primitive</TableCell>
                  <TableCell>FailedState</TableCell>
                  <TableCell>UnknownState</TableCell>
                  <TableCell>AvailabilityUnknownState</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Mapping record</TableCell>
                  <TableCell>CAP-MAP-002</TableCell>
                  <TableCell>CAP-MAP-005</TableCell>
                  <TableCell>CAP-MAP-006</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Is it an outcome?</TableCell>
                  <TableCell>Yes — definitive negative</TableCell>
                  <TableCell>No — never success or failure</TableCell>
                  <TableCell>No — not an outcome at all</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Forward path</TableCell>
                  <TableCell>Next actions stated by authority</TableCell>
                  <TableCell>Reconciliation: who resolves, when to re-check</TableCell>
                  <TableCell>Source availability re-check</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </>
        )}
      </SectionCard>

      <SectionCard
        id="role-matrix"
        title="Role matrix"
        description="Deep links to the provider surfaces are role-checked on direct entry (P8): every audience but provider is redirected home by requireRoleSurface('provider'). Computed live with the real guardSurface from the navigation grammar."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Audience</TableHead>
              <TableHead>guardSurface(audience, [provider])</TableHead>
              <TableHead>Direct entry to /capabilities</TableHead>
              <TableHead>Provider-exclusive surfaces visible</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {NAV_AUDIENCES.map((audience) => {
              const allowed = guardSurface(audience, PROVIDER_SURFACE_ALLOWED);
              // Provider-exclusive surfaces: entries the provider audience
              // resolves that this audience does not — evidence that only the
              // provider sees provider surfaces.
              const providerExclusiveCount = flatNavigation("provider").filter(
                (entry) =>
                  !flatNavigation(audience).some(
                    (other) => other.id === entry.id,
                  ),
              ).length;
              return (
                <TableRow key={audience}>
                  <TableCell className="font-medium">{audience}</TableCell>
                  <TableCell>
                    <Badge
                      variant={allowed ? "secondary" : "destructive"}
                      className="font-normal"
                    >
                      {allowed ? "allowed" : "denied"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {allowed
                      ? "Provider surface renders (role gate passes)"
                      : "Redirected to / by requireRoleSurface"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {providerExclusiveCount}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Audience</TableHead>
              <TableHead>Resolved navigation entry ids</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {NAV_AUDIENCES.map((audience) => (
              <TableRow key={audience}>
                <TableCell className="font-medium">{audience}</TableCell>
                <TableCell className="text-muted-foreground">
                  {flatNavigation(audience)
                    .map((entry) => entry.id)
                    .join(", ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/capabilities"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Try direct entry: /capabilities
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
          <Link
            href="/capabilities/routing-participation"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Try direct entry: /capabilities/routing-participation
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
          <span className="text-xs text-muted-foreground">
            Outcome depends on the simulated shell audience: only the provider
            audience renders; every other audience is redirected home.
          </span>
        </div>
      </SectionCard>

      <SectionCard
        id="read-only"
        title="Read-only nature"
        description="Evidence that no control on the provider surface mutates any state."
      >
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            The capability port exposes only listCapabilities and
            getCapability — no mutating methods exist on the boundary.
          </li>
          <li>
            The provider surface renders no action controls on capability
            items: its only interactive controls are disclosure (collapsible
            state presentation) and navigation (links to read-only detail).
          </li>
          <li>
            The harness scripting above changes only what the mock returns to
            this harness; it is harness-local and touches no protocol state.
          </li>
          <li>
            Money values are authority-quoted and formatted with explicit
            currency (src/lib/pay-flow/money.ts); the UI computes none.
          </li>
        </ul>
      </SectionCard>
    </div>
  );
}
