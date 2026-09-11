/**
 * Waiting detail page — UI-006 deep-linkable waiting view on the track surface.
 *
 * /track/[referenceId]/waiting — role-checked like the parent track detail
 * view: server-side audience resolution, an authenticated-role guard, then a
 * per-reference role check through the waiting port's lookup. The page composes
 * the waiting recovery panel (deliverable 4) and the waiting inquiry form
 * (deliverable 5).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { WaitingRecoveryPanel } from "@/components/track/waiting-recovery-panel";
import { WaitingInquiryForm } from "@/components/track/waiting-inquiry-form";
import { formatMoney } from "@/lib/pay-flow/money";
import type { NavAudience } from "@/lib/navigation";
import { requireRoleSurface } from "@/lib/shell-guard";
import { resolveShellAudience } from "@/lib/shell-audience-server";
import {
  WAITING_PORT_AUTHORITY_OWNER,
  WAITING_PORT_RUNTIME_STATUS,
  getWaitingPort,
  type WaitingViewerRole,
} from "@/lib/protocol/waiting-port";
import { getWaitingDisplayPresentation } from "@/lib/protocol/waiting-state-mapping";

interface WaitingDetailPageProps {
  params: Promise<{ referenceId: string }>;
}

export async function generateMetadata({
  params,
}: WaitingDetailPageProps): Promise<Metadata> {
  const { referenceId } = await params;
  return {
    title: `Waiting — ${referenceId} — payswap3`,
    description: `Waiting, queued, or delayed fulfillment detail for ${referenceId}, with recovery actions and reconciliation visibility.`,
  };
}

function toWaitingViewerRole(audience: NavAudience): WaitingViewerRole | null {
  switch (audience) {
    case "customer":
    case "merchant":
    case "provider":
    case "operator":
    case "administrator":
      return audience;
    default:
      return null;
  }
}

export default async function TrackReferenceWaitingPage({
  params,
}: WaitingDetailPageProps) {
  const { referenceId } = await params;
  const audience = await resolveShellAudience();

  // Role-checked like the parent surface: unauthenticated visitors are sent
  // home; per-reference roles are then checked through the port lookup.
  await requireRoleSurface("customer", [
    "merchant",
    "provider",
    "operator",
    "administrator",
  ]);

  const viewerRole = toWaitingViewerRole(audience);
  if (!viewerRole) {
    redirect("/");
  }

  const lookup = getWaitingPort().lookupWaiting(referenceId, viewerRole);

  const backToTrack = (
    <Link
      href={`/track/${referenceId}`}
      className={buttonVariants({ variant: "outline" })}
    >
      <ArrowLeft aria-hidden />
      Back to track detail
    </Link>
  );

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        {backToTrack}
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Waiting detail — {referenceId}
          </h1>
          <Badge variant="secondary">{WAITING_PORT_RUNTIME_STATUS}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Waiting, queued, and delayed fulfillment states for this reference, with the reason
          reported by the owning authority, the expectation of what happens next, and the
          recovery options authorized per protocol. Authority:{" "}
          {WAITING_PORT_AUTHORITY_OWNER}.
        </p>
      </div>

      {lookup.status === "role-denied" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-5 text-muted-foreground" aria-hidden />
              This waiting detail is not visible to the {viewerRole} role
            </CardTitle>
            <CardDescription>
              The per-reference role check for {referenceId} did not pass. This is an explicit
              access outcome, not a failure of the fulfillment.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p>
              Roles permitted for this reference:{" "}
              {lookup.allowedViewerRoles.join(", ")}. Switch audience in the simulated shell to
              view it, or open the reference from the{" "}
              <Link
                href="/track"
                className="underline underline-offset-4"
              >
                track surface
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      ) : null}

      {lookup.status === "not-found" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-5 text-muted-foreground" aria-hidden />
              No waiting record exists for this reference
            </CardTitle>
            <CardDescription>
              The waiting backing (mock, {WAITING_PORT_RUNTIME_STATUS}) reports no waiting
              entry for {referenceId}.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <p>
              Nothing is implied about any real fulfillment. Open the{" "}
              <Link href="/track" className="underline underline-offset-4">
                track surface
              </Link>{" "}
              to look up a reference the mock backing knows.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {lookup.status === "found" ? (
        <div className="grid gap-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Reference context</CardTitle>
              <CardDescription>
                {lookup.snapshot.intentSummary}. Amount (authority-quoted):{" "}
                {formatMoney(
                  lookup.snapshot.amount.value,
                  lookup.snapshot.amount.currency,
                )}
                . Reported by {lookup.snapshot.reportedBy} at{" "}
                {lookup.snapshot.reportedAt}.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Display state:</span>
                <Badge variant="secondary">
                  {getWaitingDisplayPresentation(lookup.snapshot.authorityStateId).surfaceLabel}
                </Badge>
                <Badge variant="outline">
                  {getWaitingDisplayPresentation(lookup.snapshot.authorityStateId).recordId}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  authority state {lookup.snapshot.authorityStateId} — viewer role {viewerRole}
                </span>
              </div>
            </CardContent>
          </Card>

          <WaitingRecoveryPanel snapshot={lookup.snapshot} />

          <Separator />

          <WaitingInquiryForm
            referenceId={referenceId}
            viewerRole={viewerRole}
            inquiry={lookup.snapshot.inquiry}
          />
        </div>
      ) : null}
    </div>
  );
}
