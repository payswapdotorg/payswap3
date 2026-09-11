"use client";

/**
 * UI-008 — Recourse tracker (dispute record + proof trail).
 *
 * Contract:
 * - The dispute's authority state is explicit via the shared primitives
 *   (open, in mediation, resolved with the authority's exact wording, failed,
 *   or UNKNOWN with its reconciliation path).
 * - Every recourse stage is presented with its own explicit state and the
 *   proof trail for every consequential outcome (completed stages carry
 *   authority wording + proof links; pending stages say why they have not
 *   opened; UNKNOWN stages carry the reconciliation path).
 * - Recheck is explicit: the button re-queries the authority and announces
 *   the result; completed stages keep their recorded proof.
 */

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Loader2, RefreshCw, Route } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DisputeRecord, PartyRole } from "@/lib/protocol/mediation-port";
import {
  DISPLAY_STATUS_BADGE,
  formatUtcTimestamp,
  mapDisputeDisplay,
  mapRecourseStepDisplay,
} from "@/lib/protocol/mediation-state-mapping";
import { AnnouncementRegion } from "@/components/mediation/live-announcements";
import { AdditionalProofLinks, DisplayStateBlock } from "@/components/mediation/display-state-block";

export function RecourseTracker({
  initialDispute,
  viewer,
  viewerLabel,
  onAnnounce,
}: {
  initialDispute: DisputeRecord;
  viewer: PartyRole;
  viewerLabel: string;
  onAnnounce?: (message: string) => void;
}) {
  const [dispute, setDispute] = React.useState(initialDispute);
  const [announcement, setAnnouncement] = React.useState("");
  const [rechecking, setRechecking] = React.useState(false);

  const display = mapDisputeDisplay(dispute);
  const badge = DISPLAY_STATUS_BADGE[display.primitive];
  const primaryEvidenceHref =
    display.primitive === "succeeded" ? display.props.evidence.href : undefined;

  const announce = React.useCallback(
    (message: string) => {
      setAnnouncement(message);
      onAnnounce?.(message);
    },
    [onAnnounce],
  );

  async function recheck() {
    setRechecking(true);
    try {
      const response = await fetch(
        `/api/mediation/record?type=dispute&id=${encodeURIComponent(dispute.id)}`,
      );
      const fetched = (await response.json()) as
        | { kind: "fetched"; record: DisputeRecord }
        | { kind: "not-visible"; reason: string }
        | { kind: "unavailable"; target: string; detail?: string };
      if (fetched && fetched.kind === "fetched") {
        const changed = fetched.record.authorityState !== dispute.authorityState;
        setDispute(fetched.record);
        announce(
          changed
            ? `Rechecked with the Disputes/Recourse Authority: the dispute state changed to ${fetched.record.authorityState}.`
            : "Rechecked with the Disputes/Recourse Authority: the reported state is unchanged; completed stages keep their proof.",
        );
      } else if (fetched && fetched.kind === "unavailable") {
        announce(`Recheck failed: ${fetched.target} is currently unreachable; availability is UNKNOWN.`);
      } else {
        announce("Recheck failed: this record is not visible to your role.");
      }
    } catch {
      announce("Recheck failed: the authority surface was unreachable.");
    } finally {
      setRechecking(false);
    }
  }

  return (
    <article className="space-y-6" aria-labelledby="recourse-tracker-heading">
      <AnnouncementRegion message={announcement} id="recourse-tracker-announcements" />

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/mediation"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
          aria-label="Back to the mediation docket"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to docket
        </Link>
        <Badge variant="outline" className={badge.className}>
          {badge.label}
        </Badge>
        <Badge variant="secondary">{dispute.reference}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl leading-snug" id="recourse-tracker-heading">
            Dispute {dispute.id} — recourse tracking
          </CardTitle>
          <CardDescription>
            Opened by {dispute.openedBy.label} against {dispute.against.label}. You are viewing as{" "}
            <span className="font-medium text-foreground">{viewerLabel}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Referenced swap</dt>
              <dd className="mt-0.5">
                <Link
                  href={`/track/${dispute.intentReference.replace("INTENT-", "SW-")}`}
                  className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"
                >
                  Tracking record {dispute.intentReference.replace("INTENT-", "SW-")}
                  <ArrowUpRight className="size-3" aria-hidden="true" />
                </Link>
              </dd>
            </div>
            {dispute.linkedMediationId ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Linked mediation</dt>
                <dd className="mt-0.5">
                  <Link
                    href={`/mediation/case/${dispute.linkedMediationId}`}
                    className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"
                  >
                    Mediation thread {dispute.linkedMediationId}
                    <ArrowUpRight className="size-3" aria-hidden="true" />
                  </Link>
                </dd>
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Grounds</dt>
              <dd className="mt-0.5 flex flex-wrap gap-2">
                {dispute.grounds.map((ground) => (
                  <Badge key={ground.id} variant="outline">
                    {ground.label}
                  </Badge>
                ))}
              </dd>
            </div>
          </dl>
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Initiator&apos;s account (recorded verbatim)
            </p>
            <p className="text-sm leading-relaxed">{dispute.accountOfWhatHappened}</p>
          </div>
          {dispute.evidence.length > 0 ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Evidence on the dispute record
              </p>
              <ul className="mt-1 space-y-1 text-sm">
                {dispute.evidence.map((entry) => (
                  <li key={`${entry.href}-${entry.label}`}>
                    <Link
                      href={entry.href}
                      className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"
                    >
                      {entry.label}
                      <ArrowUpRight className="size-3" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <DisplayStateBlock display={display}>
        {dispute.resolution ? (
          <div className="space-y-2 text-xs">
            <p>
              <span className="font-medium text-foreground">Resolved by:</span>{" "}
              {dispute.resolution.resolvedBy} on {formatUtcTimestamp(dispute.resolution.resolvedAt)}
            </p>
            <AdditionalProofLinks
              proof={dispute.resolution.proof}
              excludeHref={primaryEvidenceHref}
              heading="Proof on the resolution"
            />
          </div>
        ) : null}
      </DisplayStateBlock>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Route className="size-4 text-muted-foreground" aria-hidden="true" />
            Recourse path — proof trail
          </CardTitle>
          <CardDescription>
            Every consequential outcome on this dispute carries its proof. Stages that have not
            opened say why; UNKNOWN stages carry their reconciliation path.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-5">
            {dispute.recourseTrail.map((step, index) => {
              const stepDisplay = mapRecourseStepDisplay(step);
              const stepBadge = DISPLAY_STATUS_BADGE[stepDisplay.primitive];
              return (
                <li key={step.id} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="flex size-6 items-center justify-center rounded-full border text-xs font-medium text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="font-medium">{step.title}</span>
                    <Badge variant="outline" className={stepBadge.className}>
                      {stepBadge.label}
                    </Badge>
                  </div>
                  <div className="ml-8 space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Stage: {step.stage} — authority: {step.authority}
                      {step.at ? ` — ${formatUtcTimestamp(step.at)}` : ""}
                    </p>
                    <DisplayStateBlock display={stepDisplay}>
                      {step.proof.length > 1 ? (
                        <AdditionalProofLinks
                          proof={step.proof}
                          excludeHref={
                            stepDisplay.primitive === "succeeded"
                              ? stepDisplay.props.evidence.href
                              : undefined
                          }
                          heading="Additional proof on this stage"
                        />
                      ) : null}
                    </DisplayStateBlock>
                  </div>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" className="min-h-11" onClick={() => void recheck()} disabled={rechecking}>
          {rechecking ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-4" aria-hidden="true" />
          )}
          Recheck with the authority
        </Button>
        {rechecking ? <Skeleton className="h-4 w-48" aria-label="Rechecking state" /> : null}
      </div>
    </article>
  );
}
