/**
 * UI-004 — Capability detail view.
 *
 * The single capability view: the authoritative state rendered through the
 * shared primitives (UNKNOWN with its reconciliation when indeterminate,
 * availability unknown when the reporting source is unavailable), the
 * composition the registry states for the capability, and full provenance
 * (which authority reports it). Read-only: the only controls are navigation
 * links; nothing on this view mutates any state.
 */
import Link from "next/link";
import { ArrowLeft, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CapabilityHeadlineStatus } from "@/components/provider/capability-headline-status";
import { CapabilityProvenance } from "@/components/provider/capability-provenance";
import { CapabilityStatePresentation } from "@/components/provider/capability-state-presentation";
import type {
  CapabilityBoundaryInfo,
  CapabilityItem,
} from "@/lib/protocol/capability-port";

export interface CapabilityReference {
  readonly id: string;
  readonly name: string;
}

export function CapabilityDetailView({
  item,
  boundary,
  knownCapabilities,
}: {
  item: CapabilityItem;
  boundary: CapabilityBoundaryInfo;
  knownCapabilities: readonly CapabilityReference[];
}) {
  const { descriptor } = item;
  const nameById = new Map(knownCapabilities.map((ref) => [ref.id, ref.name]));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/capabilities"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          All capabilities
        </Link>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {descriptor.name}
          </h1>
          <Badge variant="outline" className="text-muted-foreground">
            {descriptor.category}
          </Badge>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {descriptor.summary}
        </p>
        <CapabilityHeadlineStatus item={item} />
      </div>

      <section aria-labelledby="capability-state-heading">
        <h2
          id="capability-state-heading"
          className="mb-3 text-lg font-semibold tracking-tight"
        >
          Authoritative state
        </h2>
        <CapabilityStatePresentation item={item} />
      </section>

      <section aria-labelledby="capability-composition-heading">
        <h2
          id="capability-composition-heading"
          className="mb-3 text-lg font-semibold tracking-tight"
        >
          Composition
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          What this capability is composed of, as stated by the Capability
          Registry. Dependencies link to their own read-only capability
          records.
        </p>
        <ul className="space-y-3">
          {descriptor.composition.map((part) => (
            <li key={part.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-sm font-semibold">{part.label}</p>
                {part.dependsOnCapabilityId ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Link2 className="size-3.5" aria-hidden="true" />
                    Depends on:{" "}
                    <Link
                      href={`/capabilities/${part.dependsOnCapabilityId}`}
                      className="font-medium underline underline-offset-2 hover:opacity-80"
                    >
                      {nameById.get(part.dependsOnCapabilityId) ??
                        part.dependsOnCapabilityId}
                    </Link>
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {part.description}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Provenance</CardTitle>
          <CardDescription>
            Which authority reports this capability truth, through which
            source, with what evidence.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CapabilityProvenance item={item} boundary={boundary} />
        </CardContent>
      </Card>

      <Separator />

      <p className="text-xs text-muted-foreground">
        This view is read-only. It presents the authoritative state, the
        stated composition, and the provenance of this capability; it offers
        no capability controls. Actions belong to the merchant and customer
        surfaces.
      </p>
    </div>
  );
}
