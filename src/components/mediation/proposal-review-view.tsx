"use client";

/**
 * UI-008 — Agent-proposal review & decision surface.
 *
 * Contract:
 * - Complete plain-language consequences of EVERY decision (accept, reject,
 *   counter, escalate) are presented BEFORE any decision control, fully
 *   visible — nothing decision-relevant is collapsed or hidden.
 * - Decisions are explicit single-intent actions. Clicking a decision does
 *   NOT apply it: an inline confirmation restates that decision's
 *   consequences, and only the Confirm control submits. Decisions are routed
 *   through protocol authorization (POST /api/mediation/decision; the actor
 *   is resolved server-side from the shell audience; the authority
 *   re-validates per-role authorization).
 * - Unauthorized decisions render disabled with the authority's reason.
 * - Every outcome is announced via a polite live region; all controls are
 *   native buttons (keyboard-operable); Escape cancels a pending
 *   confirmation.
 */

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Flag,
  Gavel,
  Loader2,
  RefreshCw,
  Undo2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/pay-flow/money";
import type {
  AgentProposal,
  PartyRole,
  ProposalDecisionKind,
} from "@/lib/protocol/mediation-port";
import {
  DISPLAY_STATUS_BADGE,
  formatUtcTimestamp,
  mapProposalDisplay,
} from "@/lib/protocol/mediation-state-mapping";
import { AnnouncementRegion } from "./live-announcements";
import { AdditionalProofLinks, DisplayStateBlock } from "./display-state-block";

const DECISION_META: Record<
  ProposalDecisionKind,
  { verb: string; restatementHeading: string; consequencesKey: "ifAccepted" | "ifRejected" | "ifCountered" | "ifEscalated" }
> = {
  accept: { verb: "Accept", restatementHeading: "You are about to ACCEPT this proposal", consequencesKey: "ifAccepted" },
  reject: { verb: "Reject", restatementHeading: "You are about to REJECT this proposal", consequencesKey: "ifRejected" },
  counter: { verb: "Counter", restatementHeading: "You are about to COUNTER this proposal", consequencesKey: "ifCountered" },
  escalate: { verb: "Escalate", restatementHeading: "You are about to ESCALATE this proposal", consequencesKey: "ifEscalated" },
};

const DECISION_ICONS: Record<ProposalDecisionKind, LucideIcon> = {
  accept: CheckCircle2,
  reject: XCircle,
  counter: Undo2,
  escalate: Flag,
};

const DECISIONS: readonly ProposalDecisionKind[] = ["accept", "reject", "counter", "escalate"];

function ConfirmIcon({ icon }: { icon: ProposalDecisionKind }) {
  const Icon = DECISION_ICONS[icon];
  return <Icon className="size-4" aria-hidden="true" />;
}

export function ProposalReviewView({
  initialProposal,
  viewer,
  viewerLabel,
  onAnnounce,
}: {
  initialProposal: AgentProposal;
  viewer: PartyRole;
  viewerLabel: string;
  onAnnounce?: (message: string) => void;
}) {
  const [proposal, setProposal] = React.useState(initialProposal);
  const [confirming, setConfirming] = React.useState<ProposalDecisionKind | null>(null);
  const [counterTerms, setCounterTerms] = React.useState("");
  const [submitting, setSubmitting] = React.useState<ProposalDecisionKind | null>(null);
  const [denial, setDenial] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const [rechecking, setRechecking] = React.useState(false);
  const confirmPanelRef = React.useRef<HTMLDivElement>(null);
  const counterTermsRef = React.useRef<HTMLTextAreaElement>(null);

  const display = mapProposalDisplay(proposal);
  const badge = DISPLAY_STATUS_BADGE[display.primitive];
  const awaitingDecision = proposal.authorityState === "awaiting-decision";
  const primaryEvidenceHref =
    display.primitive === "succeeded" ? display.props.evidence.href : undefined;

  const announce = React.useCallback(
    (message: string) => {
      setAnnouncement(message);
      onAnnounce?.(message);
    },
    [onAnnounce],
  );

  React.useEffect(() => {
    if (confirming) {
      confirmPanelRef.current?.focus();
      if (confirming === "counter") {
        window.setTimeout(() => counterTermsRef.current?.focus(), 50);
      }
    }
  }, [confirming]);

  function openConfirmation(decision: ProposalDecisionKind) {
    setDenial(null);
    setConfirming(decision);
  }

  function cancelConfirmation() {
    setConfirming(null);
    setCounterTerms("");
  }

  async function submitDecision(decision: ProposalDecisionKind) {
    setSubmitting(decision);
    setDenial(null);
    try {
      const response = await fetch("/api/mediation/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId: proposal.id,
          decision,
          counterTerms: decision === "counter" ? counterTerms : undefined,
        }),
      });
      const outcome = (await response.json()) as
        | { kind: "applied"; record: AgentProposal; authorizationRef: string }
        | { kind: "denied"; reason: string }
        | { error?: string };
      const parsed = outcome !== null && "kind" in outcome ? outcome : null;
      if (parsed && parsed.kind === "applied") {
        setProposal(parsed.record);
        setConfirming(null);
        setCounterTerms("");
        announce(
          `Decision applied: ${parsed.record.decision?.outcomeWording ?? "the authority recorded the decision."} Authorization record ${parsed.authorizationRef}.`,
        );
      } else if (parsed && parsed.kind === "denied") {
        setDenial(parsed.reason);
        announce(`Decision denied by protocol authorization: ${parsed.reason}`);
      } else {
        setDenial("The decision request was malformed and was not submitted to the authority.");
        announce("Decision request failed: malformed request.");
      }
    } catch {
      setDenial("The decision could not be submitted; the authority surface was unreachable.");
      announce("Decision submission failed: the authority surface was unreachable.");
    } finally {
      setSubmitting(null);
    }
  }

  async function recheck() {
    setRechecking(true);
    try {
      const response = await fetch(
        `/api/mediation/record?type=proposal&id=${encodeURIComponent(proposal.id)}`,
      );
      const fetched = (await response.json()) as
        | { kind: "fetched"; record: AgentProposal }
        | { kind: "not-visible"; reason: string }
        | { kind: "unavailable"; target: string; detail?: string };
      if (fetched && fetched.kind === "fetched") {
        const changed = fetched.record.authorityState !== proposal.authorityState;
        setProposal(fetched.record);
        announce(
          changed
            ? `Rechecked with the Agents/Mediation Authority: the proposal state changed to ${fetched.record.authorityState}.`
            : "Rechecked with the Agents/Mediation Authority: the reported state is unchanged.",
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

  const viewerIsAddressee = proposal.addressedTo.role === viewer;

  return (
    <article className="space-y-6" aria-labelledby="proposal-review-heading">
      <AnnouncementRegion message={announcement} id="proposal-review-announcements" />

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
        <Badge variant="secondary">{proposal.reference}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl leading-snug" id="proposal-review-heading">
            {proposal.title}
          </CardTitle>
          <CardDescription className="leading-relaxed">{proposal.summary}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Proposed by</dt>
              <dd className="mt-0.5">{proposal.proposedBy.agentLabel}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">On behalf of</dt>
              <dd className="mt-0.5">{proposal.onBehalfOf.label}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Decision awaited from</dt>
              <dd className="mt-0.5">{proposal.addressedTo.label}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Counterparty (notified)</dt>
              <dd className="mt-0.5">{proposal.counterparty.label}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Referenced swap</dt>
              <dd className="mt-0.5">
                <Link
                  href={`/track/${proposal.intentReference.replace("INTENT-", "SW-")}`}
                  className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"
                >
                  Tracking record {proposal.intentReference.replace("INTENT-", "SW-")}
                  <ArrowUpRight className="size-3" aria-hidden="true" />
                </Link>
              </dd>
            </div>
            {proposal.consequences.financialImpact ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Authority-quoted amount in question
                </dt>
                <dd className="mt-0.5 font-medium">
                  {formatMoney(
                    proposal.consequences.financialImpact.amount,
                    proposal.consequences.financialImpact.currency,
                  )}
                </dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            You are viewing as <span className="font-medium text-foreground">{viewerLabel}</span>
            {viewerIsAddressee
              ? " — the party this proposal is addressed to."
              : " — the counterparty; you are notified of the outcome."}
            {proposal.spawnedFromProposalId
              ? ` Spawned by the counter decision on ${proposal.spawnedFromProposalId}.`
              : ""}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Complete consequences of every decision</CardTitle>
          <CardDescription>
            Everything that happens under each decision, in plain language, before any decision
            control. Nothing here is collapsed: read all four before deciding.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {DECISIONS.map((decision) => {
            const meta = DECISION_META[decision];
            return (
              <section key={decision} aria-labelledby={`consequences-${decision}`}>
                <h3 id={`consequences-${decision}`} className="text-sm font-semibold">
                  If you {meta.verb.toLowerCase()} this proposal
                </h3>
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
                  {proposal.consequences[meta.consequencesKey].map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>
            );
          })}
          <Separator />
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reversibility</p>
              <p className="mt-1 leading-relaxed">{proposal.consequences.reversibility}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Validity</p>
              <p className="mt-1 leading-relaxed">{proposal.consequences.validUntil}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <DisplayStateBlock display={display}>
        {proposal.decision ? (
          <div className="space-y-2 text-xs">
            <p>
              <span className="font-medium text-foreground">Decided by:</span>{" "}
              {proposal.decision.decidedBy.label} on {formatUtcTimestamp(proposal.decision.decidedAt)}
            </p>
            <p>
              <span className="font-medium text-foreground">Authorization record:</span>{" "}
              {proposal.decision.authorizationRef}
            </p>
            <AdditionalProofLinks proof={proposal.decision.proof} excludeHref={primaryEvidenceHref} />
          </div>
        ) : null}
      </DisplayStateBlock>

      <Card>
        <CardHeader>
          <CardTitle>Evidence on this proposal</CardTitle>
          <CardDescription>
            Authority-verified references. Full evidence stays visible before and after any
            decision.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {proposal.evidence.map((entry) => (
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
        </CardContent>
      </Card>

      {awaitingDecision ? (
        <Card>
          <CardHeader>
            <CardTitle>Decide on this proposal</CardTitle>
            <CardDescription>
              Each control is a single-intent decision routed through protocol authorization.
              Selecting one opens an inline confirmation that restates its consequences; nothing
              is applied until you confirm. Unauthorized decisions are disabled with the
              authority&apos;s reason.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {DECISIONS.map((decision) => {
                const meta = DECISION_META[decision];
                const Icon = DECISION_ICONS[decision];
                const authorization = proposal.viewerAuthorization.find(
                  (entry) => entry.decision === decision,
                );
                const authorized = authorization?.authorized ?? false;
                const reasonId = `authz-reason-${decision}`;
                return (
                  <div key={decision} className="space-y-1.5">
                    <Button
                      type="button"
                      variant={decision === "accept" ? "default" : decision === "reject" ? "destructive" : "outline"}
                      className="min-h-11 w-full justify-start"
                      disabled={!authorized || submitting !== null}
                      aria-describedby={reasonId}
                      onClick={() => openConfirmation(decision)}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      {meta.verb} this proposal
                      <ChevronRight className="ml-auto size-4" aria-hidden="true" />
                    </Button>
                    <p
                      id={reasonId}
                      className={
                        authorized
                          ? "text-xs text-muted-foreground"
                          : "text-xs text-destructive dark:text-red-300"
                      }
                    >
                      {authorized ? "Authorized for your role." : `Not authorized: ${authorization?.reason}`}
                    </p>
                  </div>
                );
              })}
            </div>

            {denial ? (
              <Alert variant="destructive" role="alert">
                <Gavel className="size-4" aria-hidden="true" />
                <AlertTitle>Protocol authorization denied this action</AlertTitle>
                <AlertDescription>{denial}</AlertDescription>
              </Alert>
            ) : null}

            {confirming ? (
              <div
                ref={confirmPanelRef}
                role="group"
                aria-labelledby={`confirm-${confirming}-heading`}
                tabIndex={-1}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    cancelConfirmation();
                  }
                }}
                className="space-y-4 rounded-xl border border-amber-600/50 bg-amber-600/5 p-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:border-amber-400/40 dark:bg-amber-400/10"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 id={`confirm-${confirming}-heading`} className="text-sm font-semibold">
                    {DECISION_META[confirming].restatementHeading}
                  </h3>
                  <Badge variant="outline" className="shrink-0">
                    Confirmation required
                  </Badge>
                </div>
                <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
                  {proposal.consequences[DECISION_META[confirming].consequencesKey].map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Reversibility: {proposal.consequences.reversibility}
                </p>
                {confirming === "counter" ? (
                  <div className="space-y-1.5">
                    <label
                      htmlFor="counter-terms"
                      className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                    >
                      Your counter-terms (required)
                    </label>
                    <textarea
                      id="counter-terms"
                      ref={counterTermsRef}
                      value={counterTerms}
                      onChange={(event) => setCounterTerms(event.target.value)}
                      rows={3}
                      aria-describedby="counter-terms-hint"
                      className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
                      placeholder="State the exact terms you propose instead"
                    />
                    <p id="counter-terms-hint" className="text-xs text-muted-foreground">
                      At least 10 characters; the authority records these terms verbatim.
                    </p>
                  </div>
                ) : null}
                <p className="text-xs leading-relaxed">
                  Confirming applies this decision through protocol authorization and records it
                  on the proof trail. It is not applied until you confirm. Press Escape to cancel.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={confirming === "reject" ? "destructive" : "default"}
                    className="min-h-11"
                    disabled={submitting !== null || (confirming === "counter" && counterTerms.trim().length < 10)}
                    onClick={() => void submitDecision(confirming)}
                  >
                    {submitting === confirming ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <ConfirmIcon icon={confirming} />
                    )}
                    Confirm {DECISION_META[confirming].verb.toLowerCase()}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11"
                    disabled={submitting !== null}
                    onClick={cancelConfirmation}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          This proposal is in the authority-reported state &ldquo;{proposal.authorityState}&rdquo;,
          so no decision control is offered. Decisions are single-shot: a new proposal is required
          for further changes.
        </p>
      )}

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
