"use client";

/**
 * UI-008 — Dispute initiation surface.
 *
 * Contract:
 * - Grounds are explicit (the authority's frozen ground set), with an account
 *   of what happened and evidence attachment references. Consequence wording
 *   from the authority is presented BEFORE the submit control.
 * - Initiating a dispute is an explicit single-intent action: submitting opens
 *   an inline confirmation restating the chosen grounds and consequences;
 *   nothing is opened until confirmed. Routed through protocol authorization
 *   (POST /api/mediation/dispute; the actor is resolved server-side; the
 *   authority re-validates party status and reference state).
 * - Denials from the authority are displayed explicitly, never swallowed.
 * - Outcomes are announced via a polite live region.
 */

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, FileWarning, Loader2, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  DisputeInitiationResult,
  DisputableIntent,
  PartyRole,
} from "@/lib/protocol/mediation-port";
import type { DisputeInitiationBriefing } from "@/lib/protocol/mediation-port";
import {
  mapDisputeDisplay,
  mapDisputeInitiationDisplay,
} from "@/lib/protocol/mediation-state-mapping";
import { formatMoney } from "@/lib/pay-flow/money";
import { AnnouncementRegion } from "@/components/mediation/live-announcements";
import { DisplayStateBlock } from "@/components/mediation/display-state-block";

interface EvidenceRow {
  key: string;
  label: string;
  href: string;
}

export function DisputeInitiationForm({
  viewer,
  viewerLabel,
  briefing,
  intents,
  defaultIntentReference,
  onAnnounce,
}: {
  viewer: PartyRole;
  viewerLabel: string;
  briefing: DisputeInitiationBriefing;
  intents: readonly DisputableIntent[];
  defaultIntentReference?: string;
  onAnnounce?: (message: string) => void;
}) {
  const [intentReference, setIntentReference] = React.useState<string>(
    defaultIntentReference && intents.some((entry) => entry.reference === defaultIntentReference)
      ? defaultIntentReference
      : intents[0]?.reference ?? "",
  );
  const [selectedGrounds, setSelectedGrounds] = React.useState<string[]>([]);
  const [account, setAccount] = React.useState("");
  const [evidenceRows, setEvidenceRows] = React.useState<EvidenceRow[]>([
    { key: "evidence-1", label: "", href: "" },
  ]);
  const [confirming, setConfirming] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [denial, setDenial] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<DisputeInitiationResult | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const confirmPanelRef = React.useRef<HTMLDivElement>(null);

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

  const completeEvidence = evidenceRows.filter(
    (row) => row.label.trim().length > 0 && row.href.trim().length > 0,
  );
  const evidenceRequired = briefing.grounds.some(
    (ground) => ground.requiresEvidence && selectedGrounds.includes(ground.id),
  );
  const canSubmit =
    intentReference.length > 0 &&
    selectedGrounds.length > 0 &&
    account.trim().length >= 30 &&
    (!evidenceRequired || completeEvidence.length > 0);

  function toggleGround(groundId: string) {
    setSelectedGrounds((current) =>
      current.includes(groundId)
        ? current.filter((id) => id !== groundId)
        : [...current, groundId],
    );
  }

  function updateEvidenceRow(key: string, field: "label" | "href", value: string) {
    setEvidenceRows((rows) =>
      rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)),
    );
  }

  async function submitInitiation() {
    setSubmitting(true);
    setDenial(null);
    try {
      const response = await fetch("/api/mediation/dispute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intentReference,
          grounds: selectedGrounds,
          accountOfWhatHappened: account,
          evidence: completeEvidence.map((row) => ({ label: row.label, href: row.href })),
        }),
      });
      const outcome = (await response.json()) as DisputeInitiationResult | { error?: string };
      const parsed =
        outcome && "kind" in outcome && (outcome.kind === "initiated" || outcome.kind === "denied")
          ? outcome
          : null;
      if (parsed && parsed.kind === "initiated") {
        setResult(parsed);
        setConfirming(false);
        announce(
          `Dispute initiated: ${parsed.record.reference} on ${parsed.record.intentReference}. The Disputes/Recourse Authority is reviewing the grounds.`,
        );
      } else if (parsed && parsed.kind === "denied") {
        setDenial(parsed.reason);
        announce(`Dispute initiation denied: ${parsed.reason}`);
      } else {
        setDenial("The initiation request was malformed and was not submitted to the authority.");
        announce("Dispute initiation failed: malformed request.");
      }
    } catch {
      setDenial("The initiation could not be submitted; the authority surface was unreachable.");
      announce("Dispute initiation failed: the authority surface was unreachable.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result && result.kind === "initiated") {
    return (
      <article className="space-y-6" aria-labelledby="dispute-initiated-heading">
        <AnnouncementRegion message={announcement} id="dispute-initiation-announcements" />
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/mediation"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            aria-label="Back to the mediation docket"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to docket
          </Link>
          <Badge variant="secondary">{result.record.reference}</Badge>
        </div>
        <Card>
          <CardHeader>
            <h2
              data-slot="card-title"
              id="dispute-initiated-heading"
              className="font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm text-xl"
            >
              Dispute {result.record.reference} opened
            </h2>
            <CardDescription>
              Your initiation was accepted by the authority. Track every consequential outcome on
              the dispute&apos;s recourse trail.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <DisplayStateBlock display={mapDisputeDisplay(result.record)} />
            <div className="flex flex-wrap gap-3">
              <Link
                href={`/mediation/dispute/${result.record.id}`}
                className={buttonVariants({ variant: "default", className: "min-h-11" })}
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Track recourse on {result.record.id}
              </Link>
              <Link
                href="/mediation"
                className={buttonVariants({ variant: "outline", className: "min-h-11" })}
              >
                Back to docket
              </Link>
            </div>
          </CardContent>
        </Card>
      </article>
    );
  }

  const initiationDisplay = mapDisputeInitiationDisplay(briefing.consequenceOfInaction);

  return (
    <article className="space-y-6" aria-labelledby="dispute-initiation-heading">
      <AnnouncementRegion message={announcement} id="dispute-initiation-announcements" />

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/mediation"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
          aria-label="Back to the mediation docket"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to docket
        </Link>
        <Badge variant="outline">Disputes/Recourse Authority</Badge>
      </div>

      <Card>
        <CardHeader>
          <h2
            data-slot="card-title"
            id="dispute-initiation-heading"
            className="font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm text-xl"
          >
            Initiate a dispute
          </h2>
          <CardDescription>
            You are initiating as <span className="font-medium text-foreground">{viewerLabel}</span>
            . Grounds, your account, and your evidence references go to the
            Disputes/Recourse Authority and the other party.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DisplayStateBlock display={initiationDisplay} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What initiating a dispute does</CardTitle>
          <CardDescription>
            The authority&apos;s consequence wording, in full, before any submit control.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
            {briefing.consequences.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">{briefing.whatHappensNext}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dispute details</CardTitle>
          <CardDescription>
            Explicit grounds, your account, and evidence references the authority can verify.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="dispute-reference">Referenced swap</Label>
            <Select
              value={intentReference}
              onValueChange={(value) => setIntentReference(value ?? "")}
            >
              <SelectTrigger id="dispute-reference" className="min-h-11 w-full sm:w-96" aria-describedby="dispute-reference-hint">
                <SelectValue placeholder="Choose the swap this dispute concerns" />
              </SelectTrigger>
              <SelectContent>
                {intents.map((entry) => (
                  <SelectItem key={entry.reference} value={entry.reference}>
                    {entry.label}
                    {entry.amount ? ` — ${formatMoney(entry.amount.amount, entry.amount.currency)}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id="dispute-reference-hint" className="text-xs text-muted-foreground">
              Only references where you are a party are offered. The authority re-checks party
              status, open disputes, and resolved records before accepting.
            </p>
          </div>

          <fieldset className="space-y-3" aria-describedby="grounds-hint">
            <legend className="text-sm font-medium">Grounds for this dispute</legend>
            {briefing.grounds.map((ground) => {
              const checked = selectedGrounds.includes(ground.id);
              return (
                <div
                  key={ground.id}
                  className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/40"
                >
                  <Checkbox
                    id={`ground-${ground.id}`}
                    checked={checked}
                    onCheckedChange={() => toggleGround(ground.id)}
                    className="mt-0.5"
                    aria-describedby={`ground-${ground.id}-description`}
                  />
                  <div className="space-y-1">
                    <Label htmlFor={`ground-${ground.id}`} className="text-sm font-medium leading-none">
                      {ground.label}
                    </Label>
                    <p
                      id={`ground-${ground.id}-description`}
                      className="text-xs leading-relaxed text-muted-foreground"
                    >
                      {ground.description}
                    </p>
                    {ground.requiresEvidence ? (
                      <Badge variant="outline" className="text-[10px]">
                        Evidence required
                      </Badge>
                    ) : null}
                  </div>
                </div>
              );
            })}
            <p id="grounds-hint" className="text-xs text-muted-foreground">
              Choose at least one ground. Grounds marked &ldquo;evidence required&rdquo; cannot be
              submitted without at least one complete evidence reference.
            </p>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="dispute-account">Your account of what happened</Label>
            <textarea
              id="dispute-account"
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              rows={4}
              aria-describedby="dispute-account-hint"
              className="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
              placeholder="Describe what happened, with dates and references where possible"
            />
            <p id="dispute-account-hint" className="text-xs text-muted-foreground">
              At least 30 characters. Recorded verbatim and shared with the authority and the other
              party.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label>Evidence attachment references</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11"
                onClick={() =>
                  setEvidenceRows((rows) => [
                    ...rows,
                    { key: `evidence-${rows.length + 1}-${Date.now()}`, label: "", href: "" },
                  ])
                }
              >
                <Plus className="size-4" aria-hidden="true" />
                Add reference
              </Button>
            </div>
            {evidenceRows.map((row) => (
              <div key={row.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <div className="space-y-1">
                  <Label htmlFor={`${row.key}-label`} className="sr-only">
                    Evidence label
                  </Label>
                  <InputLike
                    id={`${row.key}-label`}
                    value={row.label}
                    onChange={(value) => updateEvidenceRow(row.key, "label", value)}
                    placeholder="Evidence label (e.g., carrier event log)"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${row.key}-href`} className="sr-only">
                    Evidence link
                  </Label>
                  <InputLike
                    id={`${row.key}-href`}
                    value={row.href}
                    onChange={(value) => updateEvidenceRow(row.key, "href", value)}
                    placeholder="Link the authority can verify (e.g., /track/SW-2041)"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 self-end"
                  aria-label="Remove this evidence reference"
                  disabled={evidenceRows.length <= 1}
                  onClick={() =>
                    setEvidenceRows((rows) => rows.filter((entry) => entry.key !== row.key))
                  }
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              A reference is complete when it has both a label and a link. Evidence links should
              point at authority-backed surfaces (for example the swap&apos;s tracking record).
            </p>
          </div>

          <Separator />

          <div className="space-y-3">
            <Button
              type="button"
              className="min-h-11"
              disabled={!canSubmit || submitting}
              onClick={() => setConfirming(true)}
            >
              <FileWarning className="size-4" aria-hidden="true" />
              Review and initiate this dispute
            </Button>
            <p className="text-xs text-muted-foreground">
              Opens an inline confirmation restating the grounds and consequences. Nothing is
              opened with the authority until you confirm.
            </p>

            {denial ? (
              <Alert variant="destructive" role="alert">
                <FileWarning className="size-4" aria-hidden="true" />
                <AlertTitle>The Disputes/Recourse Authority denied this initiation</AlertTitle>
                <AlertDescription>{denial}</AlertDescription>
              </Alert>
            ) : null}

            {confirming ? (
              <div
                ref={confirmPanelRef}
                role="group"
                aria-labelledby="confirm-initiation-heading"
                tabIndex={-1}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setConfirming(false);
                }}
                className="space-y-4 rounded-xl border border-amber-600/50 bg-amber-600/5 p-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:border-amber-400/40 dark:bg-amber-400/10"
              >
                <h3 id="confirm-initiation-heading" className="text-sm font-semibold">
                  You are about to INITIATE this dispute
                </h3>
                <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
                  <li>
                    Reference:{" "}
                    {intents.find((entry) => entry.reference === intentReference)?.label ??
                      intentReference}
                  </li>
                  <li>
                    Grounds:{" "}
                    {briefing.grounds
                      .filter((ground) => selectedGrounds.includes(ground.id))
                      .map((ground) => ground.label)
                      .join(", ")}
                  </li>
                  <li>
                    Evidence references attached:{" "}
                    {completeEvidence.length > 0 ? completeEvidence.length : "none"}
                  </li>
                  {briefing.consequences.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="min-h-11"
                    disabled={submitting}
                    onClick={() => void submitInitiation()}
                  >
                    {submitting ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <FileWarning className="size-4" aria-hidden="true" />
                    )}
                    Confirm initiation
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11"
                    disabled={submitting}
                    onClick={() => setConfirming(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
            {submitting ? <Skeleton className="h-4 w-56" aria-label="Submitting initiation" /> : null}
          </div>
        </CardContent>
      </Card>
    </article>
  );
}

function InputLike({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="flex min-h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] dark:bg-input/30"
    />
  );
}
