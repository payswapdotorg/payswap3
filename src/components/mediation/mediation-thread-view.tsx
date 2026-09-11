"use client";

/**
 * UI-008 — Mediation participation surface (party-visible thread).
 *
 * Contract:
 * - The mediation's authority state is explicit via the shared primitives:
 *   open, awaiting a party, resolved with the authority's EXACT outcome
 *   wording, failed with its reason and next actions, or UNKNOWN with its
 *   reconciliation path.
 * - Party actions (submit statement; accept/decline a proposed resolution)
 *   are explicit, single-intent, keyboard-operable native buttons routed
 *   through protocol authorization (POST /api/mediation/action; the actor is
 *   resolved server-side; the authority re-validates per-role authorization).
 * - Resolution decisions require an inline consequence-restating
 *   confirmation before anything is applied.
 * - Every outcome is announced via a polite live region.
 */

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Gavel,
  Loader2,
  RefreshCw,
  Scale,
  ThumbsDown,
  XCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { MediationActionKind, MediationCase, PartyRole } from "@/lib/protocol/mediation-port";
import {
  DISPLAY_STATUS_BADGE,
  formatUtcTimestamp,
  mapMediationDisplay,
} from "@/lib/protocol/mediation-state-mapping";
import { AnnouncementRegion } from "./live-announcements";
import { AdditionalProofLinks, DisplayStateBlock } from "./display-state-block";

const ACTION_META: Record<
  MediationActionKind,
  { verb: string }
> = {
  "submit-statement": { verb: "Add your statement to the thread" },
  "accept-proposed-resolution": { verb: "Accept the proposed resolution" },
  "decline-proposed-resolution": { verb: "Decline the proposed resolution" },
};

export function MediationThreadView({
  initialCase,
  viewer,
  viewerLabel,
  onAnnounce,
}: {
  initialCase: MediationCase;
  viewer: PartyRole;
  viewerLabel: string;
  onAnnounce?: (message: string) => void;
}) {
  const [mediationCase, setMediationCase] = React.useState(initialCase);
  const [statementDraft, setStatementDraft] = React.useState("");
  const [confirming, setConfirming] = React.useState<"accept-proposed-resolution" | "decline-proposed-resolution" | null>(null);
  const [submitting, setSubmitting] = React.useState<MediationActionKind | null>(null);
  const [denial, setDenial] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const [rechecking, setRechecking] = React.useState(false);
  const confirmPanelRef = React.useRef<HTMLDivElement>(null);

  const display = mapMediationDisplay(mediationCase);
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

  React.useEffect(() => {
    if (confirming) {
      confirmPanelRef.current?.focus();
    }
  }, [confirming]);

  function authorizationFor(action: MediationActionKind) {
    return mediationCase.viewerActions.find((entry) => entry.action === action);
  }

  async function submitAction(action: MediationActionKind, statement?: string) {
    setSubmitting(action);
    setDenial(null);
    try {
      const response = await fetch("/api/mediation/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: mediationCase.id,
          action,
          statement,
        }),
      });
      const outcome = (await response.json()) as
        | { kind: "applied"; record: MediationCase; authorizationRef: string }
        | { kind: "denied"; reason: string }
        | { error?: string };
      const parsed = outcome !== null && "kind" in outcome ? outcome : null;
      if (parsed && parsed.kind === "applied") {
        const applied = parsed;
        setMediationCase(applied.record);
        setConfirming(null);
        setStatementDraft("");
        announce(
          action === "submit-statement"
            ? `Statement added to the mediation thread. Authorization record ${applied.authorizationRef}.`
            : action === "accept-proposed-resolution"
              ? `Your acceptance of the proposed resolution is recorded. Authorization record ${applied.authorizationRef}. ${
                  applied.record.authorityState === "resolved"
                    ? applied.record.resolution?.outcomeWording ?? ""
                    : "The resolution applies once every party has accepted."
                }`
              : `Your decline of the proposed resolution is recorded. The Mediation Authority will determine the outcome. Authorization record ${applied.authorizationRef}.`,
        );
      } else if (parsed && parsed.kind === "denied") {
        setDenial(parsed.reason);
        announce(`Action denied by protocol authorization: ${parsed.reason}`);
      } else {
        setDenial("The action request was malformed and was not submitted to the authority.");
        announce("Action request failed: malformed request.");
      }
    } catch {
      setDenial("The action could not be submitted; the authority surface was unreachable.");
      announce("Action submission failed: the authority surface was unreachable.");
    } finally {
      setSubmitting(null);
    }
  }

  async function recheck() {
    setRechecking(true);
    try {
      const response = await fetch(
        `/api/mediation/record?type=mediation&id=${encodeURIComponent(mediationCase.id)}`,
      );
      const fetched = (await response.json()) as
        | { kind: "fetched"; record: MediationCase }
        | { kind: "not-visible"; reason: string }
        | { kind: "unavailable"; target: string; detail?: string };
      if (fetched && fetched.kind === "fetched") {
        const changed = fetched.record.authorityState !== mediationCase.authorityState;
        setMediationCase(fetched.record);
        announce(
          changed
            ? `Rechecked with the Mediation Authority: the mediation state changed to ${fetched.record.authorityState}.`
            : "Rechecked with the Mediation Authority: the reported state is unchanged.",
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

  const statementAuthorization = authorizationFor("submit-statement");
  const acceptAuthorization = authorizationFor("accept-proposed-resolution");
  const declineAuthorization = authorizationFor("decline-proposed-resolution");
  const threadOpen =
    mediationCase.authorityState === "open" || mediationCase.authorityState === "awaiting-party";

  return (
    <article className="space-y-6" aria-labelledby="mediation-thread-heading">
      <AnnouncementRegion message={announcement} id="mediation-thread-announcements" />

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
        <Badge variant="secondary">{mediationCase.reference}</Badge>
      </div>

      <Card>
        <CardHeader>
          <h2
            data-slot="card-title"
            id="mediation-thread-heading"
            className="font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm text-xl leading-snug"
          >
            {mediationCase.subject}
          </h2>
          <CardDescription>
            Mediation between the parties, reported by the Agents/Mediation Authority. You are
            viewing as <span className="font-medium text-foreground">{viewerLabel}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            {mediationCase.parties.map((entry) => (
              <div key={entry.party.role}>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {entry.party.role === viewer ? "You (party)" : `Party — ${entry.party.role}`}
                </dt>
                <dd className="mt-0.5 flex flex-wrap items-center gap-2">
                  <span>{entry.party.label}</span>
                  <Badge
                    variant="outline"
                    className={
                      entry.status === "responded"
                        ? "border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-300"
                        : "border-amber-600/40 bg-amber-600/10 text-amber-800 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300"
                    }
                  >
                    {entry.status === "responded" ? "Responded" : "Awaiting response"}
                  </Badge>
                </dd>
              </div>
            ))}
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Referenced swap</dt>
              <dd className="mt-0.5">
                <Link
                  href={`/track/${mediationCase.intentReference.replace("INTENT-", "SW-")}`}
                  className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4 hover:text-foreground"
                >
                  Tracking record {mediationCase.intentReference.replace("INTENT-", "SW-")}
                  <ArrowUpRight className="size-3" aria-hidden="true" />
                </Link>
              </dd>
            </div>
            {mediationCase.linkedDisputeId ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Linked dispute</dt>
                <dd className="mt-0.5">
                  <Link
                    href={`/mediation/dispute/${mediationCase.linkedDisputeId}`}
                    className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4 hover:text-foreground"
                  >
                    Dispute {mediationCase.linkedDisputeId} — recourse trail
                    <ArrowUpRight className="size-3" aria-hidden="true" />
                  </Link>
                </dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <DisplayStateBlock display={display}>
        {mediationCase.resolution ? (
          <div className="space-y-2 text-xs">
            <p>
              <span className="font-medium text-foreground">Resolved by:</span>{" "}
              {mediationCase.resolution.resolvedBy} on{" "}
              {formatUtcTimestamp(mediationCase.resolution.resolvedAt)}
            </p>
            <AdditionalProofLinks
              proof={mediationCase.resolution.proof}
              excludeHref={primaryEvidenceHref}
              heading="Proof on the resolution"
            />
          </div>
        ) : null}
      </DisplayStateBlock>

      {mediationCase.proposedResolution && threadOpen ? (
        <Card>
          <CardHeader>
            <CardTitle>Proposed resolution awaiting party decisions</CardTitle>
            <CardDescription>
              Every party&apos;s explicit acceptance is required before the Mediation Authority
              applies a proposed resolution. Deciding is single-intent: selecting a control opens
              an inline confirmation that restates the consequences.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <blockquote className="rounded-lg border-l-4 border-stone-400 bg-muted/40 p-3 text-sm leading-relaxed">
              {mediationCase.proposedResolution.wording}
            </blockquote>
            <p className="text-xs text-muted-foreground">
              Proposed by {mediationCase.proposedResolution.proposedBy} — validity:{" "}
              {mediationCase.proposedResolution.validUntil}
            </p>
            <div className="flex flex-wrap gap-3">
              {acceptAuthorization?.authorized ? (
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={submitting !== null}
                  onClick={() => setConfirming("accept-proposed-resolution")}
                >
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  {ACTION_META["accept-proposed-resolution"].verb}
                </Button>
              ) : null}
              {declineAuthorization?.authorized ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="min-h-11"
                  disabled={submitting !== null}
                  onClick={() => setConfirming("decline-proposed-resolution")}
                >
                  <ThumbsDown className="size-4" aria-hidden="true" />
                  {ACTION_META["decline-proposed-resolution"].verb}
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Acceptance: applies the resolution once every party has accepted; recorded on the
              proof trail. Decline: records your disagreement; the authority then determines the
              outcome and its wording appears on this thread.
            </p>

            {confirming ? (
              <div
                ref={confirmPanelRef}
                role="group"
                aria-labelledby={`confirm-mediation-${confirming}`}
                tabIndex={-1}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setConfirming(null);
                }}
                className="space-y-4 rounded-xl border border-amber-600/50 bg-amber-600/5 p-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:border-amber-400/40 dark:bg-amber-400/10"
              >
                <h3 id={`confirm-mediation-${confirming}`} className="text-sm font-semibold">
                  {confirming === "accept-proposed-resolution"
                    ? "You are about to ACCEPT the proposed resolution"
                    : "You are about to DECLINE the proposed resolution"}
                </h3>
                <blockquote className="rounded-lg border-l-4 border-stone-400 bg-muted/40 p-3 text-sm leading-relaxed">
                  {mediationCase.proposedResolution.wording}
                </blockquote>
                <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
                  {confirming === "accept-proposed-resolution" ? (
                    <li>
                      Your acceptance is recorded on the proof trail under protocol authorization;
                      the resolution applies once every party has accepted, and the mediation
                      resolves with this wording.
                    </li>
                  ) : (
                    <>
                      <li>
                        Your decline is recorded on the proof trail under protocol authorization.
                      </li>
                      <li>
                        The Mediation Authority will then determine the outcome; its exact wording
                        will be reported on this thread and the linked dispute.
                      </li>
                    </>
                  )}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={confirming === "decline-proposed-resolution" ? "destructive" : "default"}
                    className="min-h-11"
                    disabled={submitting !== null}
                    onClick={() => void submitAction(confirming)}
                  >
                    {submitting === confirming ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Scale className="size-4" aria-hidden="true" />
                    )}
                    Confirm {confirming === "accept-proposed-resolution" ? "acceptance" : "decline"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11"
                    disabled={submitting !== null}
                    onClick={() => setConfirming(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Mediation thread</CardTitle>
          <CardDescription>
            Statements and authority notices visible to both parties. The thread is part of the
            proof trail; statements are recorded verbatim.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="max-h-96 space-y-4 overflow-y-auto pr-2 [scrollbar-width:thin]">
            {mediationCase.messages.map((message) => {
              const isAuthority =
                message.kind === "authority-notice" || message.kind === "system-note";
              return (
                <li
                  key={message.id}
                  className={
                    isAuthority
                      ? "rounded-xl border border-stone-300 bg-muted/40 p-4 dark:border-stone-700 dark:bg-muted/20"
                      : "rounded-xl border bg-card p-4"
                  }
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {isAuthority ? (
                      <Gavel className="size-3.5" aria-hidden="true" />
                    ) : null}
                    <span className="font-medium text-foreground">{message.from.label}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {message.kind === "authority-notice"
                        ? "Authority notice"
                        : message.kind === "system-note"
                          ? "Authority note"
                          : "Party statement"}
                    </Badge>
                    <span>{formatUtcTimestamp(message.at)}</span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed">{message.body}</p>
                  {message.evidence && message.evidence.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {message.evidence.map((entry) => (
                        <li key={`${entry.href}-${entry.label}`} className="text-xs">
                          <Link
                            href={entry.href}
                            className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4 hover:text-foreground"
                          >
                            {entry.label}
                            <ArrowUpRight className="size-3" aria-hidden="true" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>

          {threadOpen ? (
            statementAuthorization?.authorized ? (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (statementDraft.trim().length >= 10) {
                    void submitAction("submit-statement", statementDraft);
                  }
                }}
              >
                <label
                  htmlFor="mediation-statement"
                  className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Your statement to the mediation
                </label>
                <textarea
                  id="mediation-statement"
                  value={statementDraft}
                  onChange={(event) => setStatementDraft(event.target.value)}
                  rows={3}
                  aria-describedby="mediation-statement-hint"
                  className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
                  placeholder="State your position for the authority and the other party"
                />
                <p id="mediation-statement-hint" className="text-xs text-muted-foreground">
                  At least 10 characters; recorded verbatim on the thread. Submitting a statement
                  is not a decision — it participates in the mediation.
                </p>
                <Button
                  type="submit"
                  variant="outline"
                  className="min-h-11"
                  disabled={submitting !== null || statementDraft.trim().length < 10}
                >
                  {submitting === "submit-statement" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Gavel className="size-4" aria-hidden="true" />
                  )}
                  Add your statement to the thread
                </Button>
              </form>
            ) : (
              <p className="text-xs text-muted-foreground">
                Statement submission is not available: {statementAuthorization?.reason}
              </p>
            )
          ) : (
            <p className="text-xs text-muted-foreground">
              The thread is closed to further statements in the authority-reported state
              &ldquo;{mediationCase.authorityState}&rdquo;.
            </p>
          )}
        </CardContent>
      </Card>

      {denial ? (
        <Alert variant="destructive" role="alert">
          <XCircle className="size-4" aria-hidden="true" />
          <AlertTitle>Protocol authorization denied this action</AlertTitle>
          <AlertDescription>{denial}</AlertDescription>
        </Alert>
      ) : null}

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
