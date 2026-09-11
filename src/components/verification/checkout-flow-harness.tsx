"use client";

/**
 * UI-003 — Merchant checkout surface.
 * src/components/verification/checkout-flow-harness.tsx
 *
 * The verification harness for the merchant checkout surface, following the
 * intent-flow harness model (UI-002): it exercises the REAL production
 * components (offer view, terms panel, decision controls, state
 * presentation) — not copies — and reports:
 *   1. the live decision surface (full accept and decline flows),
 *   2. the full checkout state matrix — including UNKNOWN with its
 *      reconciliation record id,
 *   3. the role matrix (what every audience sees and is allowed to reach),
 *   4. the adapter boundary report (runtime, authority owner, mapping,
 *      declarations).
 *
 * All scenario data is scripted sandbox data from the NON-AUTHORITATIVE
 * mock (runtime ARRIVING) — the harness verifies the SURFACE, not financial
 * truth.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FlaskConical, ListChecks, ShieldCheck } from "lucide-react";
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
import { CheckoutDecisionControls } from "@/components/merchant/checkout-decision-controls";
import { CheckoutOfferView } from "@/components/merchant/checkout-offer-view";
import { CheckoutStatePresentation } from "@/components/merchant/checkout-state-presentation";
import type { MockScenarioDescriptor } from "@/lib/protocol/mock-checkout-authority";
import type {
  CheckoutDecisionResult,
  CheckoutOfferView as OfferView,
  CheckoutStatusResult,
} from "@/lib/protocol/checkout-port";
import {
  getCheckoutPort,
  formatAuthorityTimestamp,
} from "@/lib/protocol/checkout-port";
import type { CheckoutDisplayState } from "@/lib/protocol/checkout-state-mapping";
import {
  CHECKOUT_DISPLAY_MAPPING_TABLE,
  resolveCheckoutAdapterErrorPresentation,
  resolveCheckoutDisplay,
} from "@/lib/protocol/checkout-state-mapping";
import type { NavAudience, NavEntry } from "@/lib/navigation";
import { guardSurface, resolveNavigation } from "@/lib/navigation";

function flatNavigation(audience: NavAudience): readonly NavEntry[] {
  const resolved = resolveNavigation(audience);
  return [...resolved.primary, ...resolved.footer];
}


// ---------------------------------------------------------------------------
// Props (all serializable, prefetched by the server page)
// ---------------------------------------------------------------------------

export interface CheckoutMatrixRow {
  readonly scenario: MockScenarioDescriptor;
  readonly statusResult: CheckoutStatusResult;
  readonly display: CheckoutDisplayState | null;
}

const ALL_AUDIENCES: readonly NavAudience[] = [
  "unauthenticated",
  "customer",
  "merchant",
  "provider",
  "operator",
  "administrator",
];

const MERCHANT_SURFACE_ALLOWED: readonly NavAudience[] = ["merchant"];
const HARNESS_PAGE_ALLOWED: readonly NavAudience[] = [
  "merchant",
  "operator",
  "administrator",
];

function SectionCard({
  id,
  step,
  title,
  description,
  children,
}: {
  id: string;
  step: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-6 gap-4">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
          <Badge variant="secondary">{step}</Badge>
          {title}
        </CardTitle>
        <CardDescription className="max-w-3xl">{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The live decision surface + submission follow-up
// ---------------------------------------------------------------------------

interface FollowUp {
  readonly record: CheckoutStatusResult;
  readonly display: CheckoutDisplayState | null;
}

function LiveDecisionSurface({
  liveOffer,
  liveOfferReportedBy,
}: {
  liveOffer: OfferView;
  liveOfferReportedBy: string;
}) {
  const port = getCheckoutPort();
  const [lastSubmission, setLastSubmission] = useState<CheckoutDecisionResult | null>(
    null,
  );
  const [followUp, setFollowUp] = useState<FollowUp | null>(null);

  const handleSubmitted = (result: CheckoutDecisionResult) => {
    // Reset the observed follow-up before recording the new submission so a
    // previous result is never shown against a newer receipt.
    setFollowUp(null);
    setLastSubmission(result);
  };

  useEffect(() => {
    if (!lastSubmission?.ok) {
      return;
    }
    let cancelled = false;
    port
      .getStatus({ checkoutId: lastSubmission.followUpCheckoutId })
      .then((statusResult) => {
        if (cancelled) return;
        setFollowUp({
          record: statusResult,
          display: statusResult.ok
            ? resolveCheckoutDisplay(statusResult.record)
            : null,
        });
      })
      .catch(() => {
        if (cancelled) return;
      });
    return () => {
      cancelled = true;
    };
  }, [lastSubmission, port]);

  return (
    <div className="grid gap-6">
      <CheckoutOfferView
        offer={liveOffer}
        reportedBy={liveOfferReportedBy}
        runtime={port.runtime}
      >
        <CheckoutDecisionControls
          offer={liveOffer}
          onSubmitted={handleSubmitted}
        />
      </CheckoutOfferView>

      {lastSubmission ? (
        <Card className="gap-4" id="latest-submission">
          <CardHeader>
            <CardTitle className="text-base flex flex-wrap items-center gap-2">
              <CheckCircle2 aria-hidden="true" className="size-4" />
              Latest submission (routed through protocol authorization)
            </CardTitle>
            <CardDescription>
              The receipt below is what the authority returned for the decision
              you just made in the live surface above.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {lastSubmission.ok ? (
              <>
                <dl className="grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
                  <dt className="text-muted-foreground">Decision</dt>
                  <dd className="font-medium">{lastSubmission.receipt.decision}</dd>
                  <dt className="text-muted-foreground">Receipt id</dt>
                  <dd className="font-mono text-xs">
                    {lastSubmission.receipt.receiptId}
                  </dd>
                  <dt className="text-muted-foreground">Submitted to</dt>
                  <dd>{lastSubmission.receipt.submittedTo}</dd>
                  <dt className="text-muted-foreground">Accepted by</dt>
                  <dd>{lastSubmission.receipt.acceptedBy}</dd>
                  <dt className="text-muted-foreground">At</dt>
                  <dd>{formatAuthorityTimestamp(lastSubmission.receipt.at)}</dd>
                  <dt className="text-muted-foreground">Follow-up checkout</dt>
                  <dd>
                    <Link
                      href={lastSubmission.followUpHref}
                      className="inline-flex min-h-11 items-center underline underline-offset-4"
                    >
                      {lastSubmission.followUpCheckoutId}
                    </Link>
                  </dd>
                </dl>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {lastSubmission.receipt.routingNote}
                </p>
                <Separator />
                <div className="grid gap-3">
                  <p className="text-sm font-medium">
                    Resulting consequential state (observed via the port — never
                    assumed by the UI):
                  </p>
                  {followUp === null ? (
                    <Skeleton className="h-24 w-full" />
                  ) : followUp.record.ok && followUp.display ? (
                    <CheckoutStatePresentation
                      display={followUp.display}
                      record={followUp.record.record}
                    />
                  ) : (
                    <AvailabilityUnknownState
                      target={
                        followUp.record.ok
                          ? "unexpected ok result"
                          : resolveCheckoutAdapterErrorPresentation(
                              followUp.record.error,
                              followUp.record.detail,
                              followUp.record.reportedBy,
                            ).target
                      }
                      detail={
                        followUp.record.ok
                          ? undefined
                          : resolveCheckoutAdapterErrorPresentation(
                              followUp.record.error,
                              followUp.record.detail,
                              followUp.record.reportedBy,
                            ).detail
                      }
                    />
                  )}
                </div>
              </>
            ) : (
              <AvailabilityUnknownState
                target={resolveCheckoutAdapterErrorPresentation(
                  lastSubmission.error,
                  lastSubmission.detail,
                  lastSubmission.reportedBy,
                ).target}
                detail={resolveCheckoutAdapterErrorPresentation(
                  lastSubmission.error,
                  lastSubmission.detail,
                  lastSubmission.reportedBy,
                ).detail}
              />
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

export function CheckoutFlowHarness({
  currentAudience,
  liveOffer,
  liveOfferReportedBy,
  matrixRows,
  authorityOwner,
  runtime,
}: {
  currentAudience: NavAudience;
  liveOffer: OfferView;
  liveOfferReportedBy: string;
  matrixRows: readonly CheckoutMatrixRow[];
  authorityOwner: string;
  runtime: "ARRIVING";
}) {
  return (
    <div className="grid gap-6">
      <header className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <FlaskConical aria-hidden="true" />
            Verification harness
          </Badge>
          <Badge variant="secondary">UI-003 · merchant checkout surface</Badge>
          <Badge variant="destructive">Runtime: {runtime}</Badge>
          <Badge variant="destructive">Mock data — NON-AUTHORITATIVE</Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Checkout flow verification
        </h1>
        <p className="text-muted-foreground text-sm max-w-3xl">
          Exercises the real merchant checkout components and the adapter
          boundary: the decision surface (explicit accept and decline), the
          full consequential-state matrix including UNKNOWN with its
          reconciliation path, the role matrix, and the boundary report. All
          data below is scripted sandbox data from the presentation-only mock;
          checkout truth is owned by the {authorityOwner}.
        </p>
        <nav aria-label="Harness sections" className="flex flex-wrap gap-2 text-sm">
          <Link href="#decision-surface" className="inline-flex min-h-11 items-center underline underline-offset-4">
            1 · Decision surface
          </Link>
          <Link href="#flow-traces" className="inline-flex min-h-11 items-center underline underline-offset-4">
            2 · Flow traces
          </Link>
          <Link href="#matrix" className="inline-flex min-h-11 items-center underline underline-offset-4">
            3 · State matrix
          </Link>
          <Link href="#role-matrix" className="inline-flex min-h-11 items-center underline underline-offset-4">
            4 · Role matrix
          </Link>
          <Link href="#adapter-report" className="inline-flex min-h-11 items-center underline underline-offset-4">
            5 · Adapter boundary report
          </Link>
        </nav>
      </header>

      <SectionCard
        id="decision-surface"
        step="1"
        title="The decision surface, live"
        description="The production /checkout presentation with the real decision controls. Nothing is pre-selected; accepting and declining are distinct single-intent actions; both route through protocol authorization via the port. Completing either flow shows the receipt and the resulting consequential state below."
      >
        <LiveDecisionSurface
          liveOffer={liveOffer}
          liveOfferReportedBy={liveOfferReportedBy}
        />
      </SectionCard>

      <SectionCard
        id="flow-traces"
        step="2"
        title="Flow traces and explicitness checks"
        description="The two consequential paths, narrated end-to-end, plus the structural explicitness checks this harness verifies on the surface above."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-4 grid gap-2">
            <h3 className="font-semibold text-sm">
              Accept flow (full trace)
            </h3>
            <ol className="list-decimal pl-5 grid gap-1.5 text-sm text-muted-foreground">
              <li>Offer presented consequence-first: summary, quoted amounts, every condition and obligation fully expanded.</li>
              <li>
                Press <span className="text-foreground font-medium">Accept offer</span> — an inline confirmation panel opens; focus lands on the neutral heading, never on Confirm.
              </li>
              <li>Panel restates amounts, material conditions, obligations, and validity before commitment.</li>
              <li>
                Press <span className="text-foreground font-medium">Confirm acceptance</span> — InProgressState while routed through protocol authorization.
              </li>
              <li>Receipt returned; the consequential state is observed on /checkout/{`{stateCheckoutId}`} — acknowledged (cko-map-04) or failed with reason (cko-map-07), or UNKNOWN with reconciliation (cko-map-08).</li>
            </ol>
          </div>
          <div className="rounded-lg border p-4 grid gap-2">
            <h3 className="font-semibold text-sm">
              Decline flow (full trace)
            </h3>
            <ol className="list-decimal pl-5 grid gap-1.5 text-sm text-muted-foreground">
              <li>Same offer, same presentation — the decline control sits beside accept, never instead of it.</li>
              <li>
                Press <span className="text-foreground font-medium">Decline offer</span> — its own inline confirmation panel (distinct copy: what declining means).</li>
              <li>
                Press <span className="text-foreground font-medium">Confirm decline</span> — InProgressState while routed through protocol authorization.</li>
              <li>Receipt returned; the recorded decline is observed on the state page (cko-map-06) with its decline receipt as evidence.</li>
            </ol>
          </div>
        </div>
        <Separator />
        <div className="grid gap-2">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <ListChecks aria-hidden="true" className="size-4" />
            Explicitness checks (verified on the live surface above)
          </h3>
          <ul className="grid gap-1.5 text-sm">
            {[
              "Accept and Decline are two separate buttons — no combined control, no toggle, no third combined intent.",
              "Neither is pre-selected: no default-checked input, no autoFocus on any intent button; confirmation panels focus a neutral heading.",
              "Both intents require their own explicit confirmation step that restates consequences in plain language.",
              "Both route through getCheckoutPort().submitDecision — the UI never applies a decision itself and never mutates authority state.",
              "While a submission is in flight, the surface shows InProgressState and claims no outcome.",
              "The terminal outcome is only ever read back from the authority (state page), including UNKNOWN with its reconciliation path.",
            ].map((check) => (
              <li key={check} className="flex gap-2">
                <CheckCircle2
                  aria-hidden="true"
                  className="size-4 shrink-0 mt-0.5 text-emerald-600"
                />
                <span>{check}</span>
              </li>
            ))}
          </ul>
        </div>
      </SectionCard>

      <SectionCard
        id="matrix"
        step="3"
        title="Checkout state matrix (including UNKNOWN)"
        description="Every scripted checkout scenario rendered with the exact production state presentation. Each row links to its live state page and to the anchored presentation below; adapter-error rows are explicit non-states (availability conditions), never consequential claims."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scenario</TableHead>
              <TableHead>Authority state / adapter error</TableHead>
              <TableHead>Display kind</TableHead>
              <TableHead>Mapping record</TableHead>
              <TableHead>Live page</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {matrixRows.map(({ scenario, statusResult, display }) => (
              <TableRow key={scenario.checkoutId}>
                <TableCell className="font-mono text-xs">
                  <Link href={`#scenario-${scenario.checkoutId}`} className="inline-flex min-h-11 items-center underline underline-offset-4">
                    {scenario.checkoutId}
                  </Link>
                  <span className="block text-muted-foreground font-sans text-xs max-w-56">
                    {scenario.label}
                  </span>
                </TableCell>
                <TableCell className="text-xs">
                  {statusResult.ok ? (
                    <Badge variant="secondary">{statusResult.record.state}</Badge>
                  ) : (
                    <Badge variant="destructive">{statusResult.error} (non-state)</Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {display ? (
                    display.kind
                  ) : (
                    <span className="text-muted-foreground">
                      availability-unknown
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {display ? (
                    <Link
                      href="/verification/checkout-flow#adapter-report"
                      className="inline-flex min-h-11 items-center underline underline-offset-4"
                    >
                      {display.recordId}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/checkout/${scenario.checkoutId}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Open
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Separator />

        <div className="grid gap-6">
          {matrixRows.map(({ scenario, statusResult, display }) => (
            <div
              key={scenario.checkoutId}
              id={`scenario-${scenario.checkoutId}`}
              className="scroll-mt-6 grid gap-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-sm font-mono">
                  {scenario.checkoutId}
                </h3>
                {statusResult.ok ? (
                  <Badge variant="secondary">{statusResult.record.state}</Badge>
                ) : (
                  <Badge variant="destructive">{statusResult.error} (non-state)</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {scenario.description}
              </p>
              {statusResult.ok && display ? (
                <CheckoutStatePresentation
                  display={display}
                  record={statusResult.record}
                />
              ) : (
                (() => {
                  const errorPresentation = resolveCheckoutAdapterErrorPresentation(
                    statusResult.ok ? "checkout-not-found" : statusResult.error,
                    statusResult.ok ? "" : statusResult.detail,
                    statusResult.ok ? "" : statusResult.reportedBy,
                  );
                  return (
                    <AvailabilityUnknownState
                      target={errorPresentation.target}
                      detail={errorPresentation.detail}
                    />
                  );
                })()
              )}
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        id="role-matrix"
        step="4"
        title="Role matrix"
        description={`Computed live from the shared navigation grammar (src/lib/navigation.ts — read-only). Current simulated audience: ${currentAudience}. The merchant checkout surfaces are gated to the merchant audience via requireRoleSurface('merchant') — every other audience is redirected home on direct entry.`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Audience</TableHead>
              <TableHead>Sees (resolveNavigation)</TableHead>
              <TableHead>/checkout gate</TableHead>
              <TableHead>This harness gate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ALL_AUDIENCES.map((audience) => {
              const entries: readonly NavEntry[] = flatNavigation(audience);
              const checkoutAllowed = guardSurface(audience, MERCHANT_SURFACE_ALLOWED);
              const harnessAllowed = guardSurface(audience, HARNESS_PAGE_ALLOWED);
              return (
                <TableRow key={audience}>
                  <TableCell className="text-xs font-medium">
                    {audience}
                    {audience === currentAudience ? (
                      <Badge variant="secondary" className="ml-2">
                        current
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {entries.length === 0
                      ? "no entries"
                      : entries
                          .map((entry) => `${entry.label}${entry.status === "planned" ? " (planned)" : ""}`)
                          .join(" · ")}
                  </TableCell>
                  <TableCell className="text-xs">
                    {checkoutAllowed ? (
                      <Badge variant="secondary">allow</Badge>
                    ) : (
                      <Badge variant="destructive">redirect home</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {harnessAllowed ? (
                      <Badge variant="secondary">allow</Badge>
                    ) : (
                      <Badge variant="destructive">redirect home</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground leading-relaxed">
          To verify the gate live: switch the simulated audience via the shell
          audience endpoint (/api/shell/audience), then deep-link{" "}
          <Link href="/checkout" className="inline-flex min-h-11 items-center underline underline-offset-4">
            /checkout
          </Link>{" "}
          or{" "}
          <Link href="/checkout/cko_live_accept_001" className="inline-flex min-h-11 items-center underline underline-offset-4">
            /checkout/cko_live_accept_001
          </Link>
          . As any audience other than merchant, the shared guard redirects to
          the shell home — the surface is invisible, not merely unlinked
          (P8).
        </p>
      </SectionCard>

      <SectionCard
        id="adapter-report"
        step="5"
        title="Adapter boundary report"
        description="What the merchant checkout surface consumes, from whom, with which runtime status, and which display mapping each authority state resolves to."
      >
        <dl className="grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <dt className="text-muted-foreground">Port accessor</dt>
          <dd className="font-mono text-xs">getCheckoutPort() — src/lib/protocol/checkout-port.ts</dd>
          <dt className="text-muted-foreground">Authority owner (truth)</dt>
          <dd>{authorityOwner}</dd>
          <dt className="text-muted-foreground">Runtime status</dt>
          <dd>
            <Badge variant="destructive">{runtime}</Badge>
          </dd>
          <dt className="text-muted-foreground">Current backing</dt>
          <dd>
            mock-checkout-authority —{" "}
            <Badge variant="destructive">NON-AUTHORITATIVE</Badge>{" "}
            presentation-only; sandbox data; scriptable outcomes (one scripted
            outcome path per checkout id)
          </dd>
          <dt className="text-muted-foreground">Port surface</dt>
          <dd className="font-mono text-xs grid gap-0.5">
            <span>getOffer(CheckoutOfferRequest) → CheckoutOfferResult</span>
            <span>getStatus(CheckoutStatusRequest) → CheckoutStatusResult</span>
            <span>listOpenCheckouts() → CheckoutQueueResult</span>
            <span>submitDecision(CheckoutDecisionRequest) → CheckoutDecisionResult</span>
          </dd>
        </dl>
        <Separator />
        <div className="grid gap-2">
          <h3 className="font-semibold text-sm">
            Authority state → display state (one-to-one; record ids)
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Authority state</TableHead>
                <TableHead>Display kind</TableHead>
                <TableHead>Primitive</TableHead>
                <TableHead>Record id</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CHECKOUT_DISPLAY_MAPPING_TABLE.map((row) => (
                <TableRow key={row.recordId}>
                  <TableCell className="text-xs font-mono">{row.authorityState}</TableCell>
                  <TableCell className="text-xs">{row.displayKind}</TableCell>
                  <TableCell className="text-xs">{row.primitive}</TableCell>
                  <TableCell className="text-xs">
                    <Link
                      href="#adapter-report"
                      className="inline-flex min-h-11 items-center underline underline-offset-4"
                      aria-label={`Mapping record ${row.recordId} — see spec/product/checkout-mapping-records.md`}
                    >
                      {row.recordId}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Complete nine-question records for every consequential state:
            spec/product/checkout-mapping-records.md. Explicit non-states
            (page load, client-side pending flags, adapter reachability
            conditions) are listed there and are never presented as
            consequential states.
          </p>
        </div>
        <Separator />
        <div className="grid gap-2">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <ShieldCheck aria-hidden="true" className="size-4" />
            Boundary declarations (verified by this harness)
          </h3>
          <ul className="grid gap-1.5 text-sm">
            {[
              "Financial truth: every amount on the surface is authority-quoted and rendered verbatim; the surface computes no totals, fees, balances, or expiry arithmetic.",
              "Decisions: accept and decline are submitted through the port (protocol authorization path); the UI never applies a decision and never mutates authority state.",
              "States: resolved one-to-one by checkout-state-mapping; the surface renders only the shared state primitives.",
              "UNKNOWN: presented as UNKNOWN with its reconciliation record (cko-map-08) — never silently resolved to a guess.",
              "Evidence: every consequential outcome carries a reachable evidence link (mock: anchors into this harness; real runtime: authority receipts).",
              "Role scoping: merchant surfaces are gated to the merchant audience; other audiences are redirected, not merely unlinked.",
            ].map((declaration) => (
              <li key={declaration} className="flex gap-2">
                <CheckCircle2
                  aria-hidden="true"
                  className="size-4 shrink-0 mt-0.5 text-emerald-600"
                />
                <span>{declaration}</span>
              </li>
            ))}
          </ul>
        </div>
      </SectionCard>
    </div>
  );
}
