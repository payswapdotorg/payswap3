/**
 * UI-004 — Capability list view.
 *
 * The read-only provider capability list: headline status first (P3), with
 * the full state presentation one deliberate disclosure step away and the
 * composition/detail one navigation step away. The surface presents
 * authority truth only — it offers no action controls on items (the
 * merchant/customer surfaces act), and nothing here mutates any state.
 */
import Link from "next/link";
import { ArrowRight, ChevronDown, Info, ShieldQuestion } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { AvailabilityUnknownState } from "@/components/state";
import { CapabilityHeadlineStatus } from "@/components/provider/capability-headline-status";
import { CapabilityStatePresentation } from "@/components/provider/capability-state-presentation";
import type {
  CapabilityCategory,
  CapabilityItem,
  CapabilityListing,
} from "@/lib/protocol/capability-port";
import { countCapabilityDisplayStates } from "@/lib/protocol/capability-state-mapping";
import type { CapabilityDisplayStateKind } from "@/lib/protocol/capability-state-mapping";

const CATEGORY_LABELS: Record<CapabilityCategory, string> = {
  payments: "Payments",
  settlement: "Settlement",
  routing: "Routing",
  operations: "Operations",
};

const CATEGORY_ORDER: readonly CapabilityCategory[] = [
  "payments",
  "settlement",
  "routing",
  "operations",
];

const SUMMARY_LABELS: Readonly<Record<CapabilityDisplayStateKind, string>> = {
  succeeded: "available",
  failed: "unavailable",
  "action-required": "conditional",
  "in-progress": "in progress",
  unknown: "unknown",
  "availability-unknown": "availability unknown",
};

function CapabilitySourceLine({ listing }: { listing: CapabilityListing }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <span className="font-medium text-foreground">Authoritative sources:</span>
      {listing.sources.map((source) => (
        <span key={source.id} className="inline-flex items-center gap-1.5">
          <span>{source.name}</span>
          <Badge
            variant="outline"
            className={
              source.availability === "reachable"
                ? "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400"
                : source.availability === "degraded"
                  ? "border-amber-400 text-amber-700 dark:border-amber-700 dark:text-amber-400"
                  : "border-dashed border-zinc-400 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300"
            }
          >
            {source.availability === "unreachable" ? "unavailable" : source.availability}
          </Badge>
        </span>
      ))}
    </p>
  );
}

function CapabilityListItem({ item }: { item: CapabilityItem }) {
  return (
    <li>
      <article className="rounded-xl border p-4 sm:p-5">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-base font-semibold tracking-tight">
              <Link
                href={`/capabilities/${item.descriptor.id}`}
                className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
              >
                {item.descriptor.name}
              </Link>
            </h3>
            <p className="text-xs text-muted-foreground">
              {item.descriptor.id}
            </p>
          </div>
          {/* Headline status first (P3) */}
          <CapabilityHeadlineStatus item={item} />
          <p className="text-sm text-muted-foreground">
            {item.descriptor.summary}
          </p>
          {/* Full state presentation: one deliberate disclosure step away */}
          <Collapsible defaultOpen={false}>
            <CollapsibleTrigger className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md px-1 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&[data-state=open]>svg]:rotate-180">
              State presentation
              <ChevronDown
                className="size-4 transition-transform duration-200"
                aria-hidden="true"
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <CapabilityStatePresentation item={item} />
            </CollapsibleContent>
          </Collapsible>
          {/* Detail: one navigation step away */}
          <div>
            <Link
              href={`/capabilities/${item.descriptor.id}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              View detail
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </article>
    </li>
  );
}

export function CapabilityListView({ listing }: { listing: CapabilityListing }) {
  const counts = countCapabilityDisplayStates(listing.items);
  const registry = listing.sources.find(
    (source) => source.id === "capability-registry",
  );
  const registryUnavailable = registry?.availability === "unreachable";

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Capabilities
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Protocol capability and routing truth for providers, exactly as
          reported by the Capability/Routing Authority. This surface is
          read-only: it presents states, conditions, provenance, and
          composition. It takes no actions and changes nothing.
        </p>
      </div>

      <Alert>
        <Info aria-hidden="true" />
        <AlertTitle>
          Adapter boundary — runtime {listing.boundary.runtime}
        </AlertTitle>
        <AlertDescription>
          Backed by a {listing.boundary.authoritative ? "" : "NON-AUTHORITATIVE "}
          {listing.boundary.backing} (presentation-only). Authority owner:{" "}
          {listing.boundary.authorityOwner}. {listing.boundary.notes}
        </AlertDescription>
      </Alert>

      {registryUnavailable ? (
        <div className="space-y-3">
          <AvailabilityUnknownState
            target="Capability Registry"
            detail={
              registry?.availabilityDetail ??
              "The Capability Registry is unavailable, so the set of capabilities itself cannot be authoritatively enumerated."
            }
          />
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <ShieldQuestion className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Capabilities reported by other sources may exist, but they cannot be
            listed while the registry is unavailable. This is not a claim that
            no capabilities exist.
          </p>
        </div>
      ) : (
        <>
          {/* Headline capability status first (P3) */}
          <div className="space-y-3 rounded-xl border p-4 sm:p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Headline status — authority-reported
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {(Object.keys(SUMMARY_LABELS) as Array<keyof typeof SUMMARY_LABELS>).map(
                (kind) => (
                  <Badge key={kind} variant="secondary" className="font-normal">
                    {counts[kind]} {SUMMARY_LABELS[kind]}
                  </Badge>
                ),
              )}
            </div>
            <CapabilitySourceLine listing={listing} />
          </div>

          {CATEGORY_ORDER.map((category) => {
            const items = listing.items.filter(
              (item) => item.descriptor.category === category,
            );
            if (items.length === 0) return null;
            return (
              <section key={category} aria-labelledby={`category-${category}`}>
                <div className="mb-3 flex items-baseline gap-2">
                  <h2
                    id={`category-${category}`}
                    className="text-lg font-semibold tracking-tight"
                  >
                    {CATEGORY_LABELS[category]}
                  </h2>
                  <span className="text-sm text-muted-foreground">
                    {items.length}{" "}
                    {items.length === 1 ? "capability" : "capabilities"}
                  </span>
                </div>
                <ul className="space-y-4">
                  {items.map((item) => (
                    <CapabilityListItem key={item.descriptor.id} item={item} />
                  ))}
                </ul>
              </section>
            );
          })}

          <Card className="bg-muted/30">
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                About this surface
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Each capability shows its authoritative state first; its full
                state presentation and its detail (composition, conditions,
                provenance) are each one deliberate step away.
              </p>
              <p>
                Indeterminate truth renders as UNKNOWN with its reconciliation
                path — never as failure or success. Unavailable authoritative
                sources render availability unknown — distinct from outcome
                failure.
              </p>
              <p className="text-xs">
                Generated at {listing.generatedAt} · mapping records:{" "}
                spec/product/capability-mapping-records.md
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
