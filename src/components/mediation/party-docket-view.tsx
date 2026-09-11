/**
 * UI-008 — Party docket view (shared by the customer and merchant party
 * surfaces). Server component: renders each proposal/mediation/dispute the
 * viewer is party to, with explicit state badges (from the mapping) and
 * deep-linkable detail routes.
 *
 * This file is deliberately hook-free so both party pages render it directly
 * from their server components.
 */

import Link from "next/link";
import { ArrowUpRight, FileWarning, Gavel, Route } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PartyDocket, PartyRole } from "@/lib/protocol/mediation-port";
import {
  DISPLAY_STATUS_BADGE,
  mapDisputeDisplay,
  mapMediationDisplay,
  mapProposalDisplay,
} from "@/lib/protocol/mediation-state-mapping";

export function PartyDocketView({
  docket,
  audience,
}: {
  docket: PartyDocket;
  audience: PartyRole;
}) {
  const audienceLabel = audience === "customer" ? "customer" : "merchant";
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Mediation, proposals &amp; disputes
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Your {audienceLabel} surface for consequential human-in-the-loop moments: agent
          proposals awaiting your decision, mediations you are party to, disputes you are party
          to, and their recourse trails. Every decision is explicitly protocol-authorized; every
          state is explicit, including UNKNOWN. Backed today by a presentation-only mock
          authority (runtime ARRIVING).
        </p>
        <p className="text-xs text-muted-foreground">
          Viewing as <span className="font-medium text-foreground">{docket.viewerLabel}</span>.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Dispute initiation</CardTitle>
          <CardDescription>
            Open a dispute with the Disputes/Recourse Authority on a reference where you are a
            party — explicit grounds, evidence references, and consequence wording first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/mediation/dispute/new"
            className={buttonVariants({ variant: "outline", className: "min-h-11" })}
          >
            <FileWarning className="size-4" aria-hidden="true" />
            Initiate a dispute
          </Link>
        </CardContent>
      </Card>

      <section aria-labelledby="proposals-heading" className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 id="proposals-heading" className="text-lg font-semibold">
            Agent proposals addressed to you
          </h2>
          <Badge variant="secondary">{docket.proposals.length}</Badge>
        </div>
        {docket.proposals.length === 0 ? (
          <EmptyNote text="No agent proposals are awaiting your decision right now. When an agent proposes something consequential, it appears here with its complete consequences." />
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {docket.proposals.map((proposal) => {
              const display = mapProposalDisplay(proposal);
              const badge = DISPLAY_STATUS_BADGE[display.primitive];
              return (
                <li key={proposal.id}>
                  <Card className="h-full gap-4">
                    <CardHeader>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={badge.className}>
                          {badge.label}
                        </Badge>
                        <Badge variant="secondary">{proposal.reference}</Badge>
                      </div>
                      <CardTitle className="pt-1 text-base leading-snug">{proposal.title}</CardTitle>
                      <CardDescription className="line-clamp-2">{proposal.summary}</CardDescription>
                    </CardHeader>
                    <CardContent className="mt-auto space-y-3">
                      <p className="text-xs text-muted-foreground">
                        {proposal.consequences.validUntil}
                      </p>
                      <Link
                        href={`/mediation/proposal/${proposal.id}`}
                        className={buttonVariants({ variant: "outline", className: "min-h-11 w-full" })}
                      >
                        <Gavel className="size-4" aria-hidden="true" />
                        Review and decide
                        <ArrowUpRight className="ml-auto size-4" aria-hidden="true" />
                      </Link>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="mediations-heading" className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 id="mediations-heading" className="text-lg font-semibold">
            Mediations you are party to
          </h2>
          <Badge variant="secondary">{docket.mediations.length}</Badge>
        </div>
        {docket.mediations.length === 0 ? (
          <EmptyNote text="You are not a party to any mediation right now. Mediations appear here when the Disputes/Recourse Authority refers a dispute to mediation." />
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {docket.mediations.map((mediation) => {
              const display = mapMediationDisplay(mediation);
              const badge = DISPLAY_STATUS_BADGE[display.primitive];
              const awaiting = mediation.parties
                .filter((entry) => entry.status === "awaiting-response")
                .map((entry) => entry.party.label);
              return (
                <li key={mediation.id}>
                  <Card className="h-full gap-4">
                    <CardHeader>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={badge.className}>
                          {badge.label}
                        </Badge>
                        <Badge variant="secondary">{mediation.reference}</Badge>
                      </div>
                      <CardTitle className="pt-1 text-base leading-snug">{mediation.subject}</CardTitle>
                      {awaiting.length > 0 ? (
                        <CardDescription>
                          Waiting on {awaiting.join(", ")} to participate.
                        </CardDescription>
                      ) : (
                        <CardDescription>
                          Parties:{" "}
                          {mediation.parties.map((entry) => entry.party.label).join(" and ")}.
                        </CardDescription>
                      )}
                    </CardHeader>
                    <CardContent className="mt-auto">
                      <Link
                        href={`/mediation/case/${mediation.id}`}
                        className={buttonVariants({ variant: "outline", className: "min-h-11 w-full" })}
                      >
                        <Gavel className="size-4" aria-hidden="true" />
                        Open mediation thread
                        <ArrowUpRight className="ml-auto size-4" aria-hidden="true" />
                      </Link>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="disputes-heading" className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 id="disputes-heading" className="text-lg font-semibold">
            Disputes you are party to
          </h2>
          <Badge variant="secondary">{docket.disputes.length}</Badge>
        </div>
        {docket.disputes.length === 0 ? (
          <EmptyNote text="You are not a party to any dispute right now. You can initiate one on a reference where you are a party." />
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {docket.disputes.map((dispute) => {
              const display = mapDisputeDisplay(dispute);
              const badge = DISPLAY_STATUS_BADGE[display.primitive];
              return (
                <li key={dispute.id}>
                  <Card className="h-full gap-4">
                    <CardHeader>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={badge.className}>
                          {badge.label}
                        </Badge>
                        <Badge variant="secondary">{dispute.reference}</Badge>
                      </div>
                      <CardTitle className="pt-1 text-base leading-snug">
                        {dispute.openedBy.role === docket.viewer
                          ? `You vs ${dispute.against.label}`
                          : `${dispute.openedBy.label} vs you`}
                        {" — "}
                        {dispute.grounds.map((ground) => ground.label).join(", ")}
                      </CardTitle>
                      <CardDescription className="line-clamp-2">
                        {dispute.accountOfWhatHappened}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="mt-auto">
                      <Link
                        href={`/mediation/dispute/${dispute.id}`}
                        className={buttonVariants({ variant: "outline", className: "min-h-11 w-full" })}
                      >
                        <Route className="size-4" aria-hidden="true" />
                        Track recourse and proof
                        <ArrowUpRight className="ml-auto size-4" aria-hidden="true" />
                      </Link>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
      {text}
    </p>
  );
}
