/**
 * UI-003 — Merchant checkout surface.
 * src/components/merchant/checkout-state-presentation.tsx
 *
 * The post-action state presentation for a merchant checkout, rendered via
 * the shared state primitives EXCLUSIVELY (acknowledged, declined, failed
 * with reason, UNKNOWN with its reconciliation path — P4, P5, P6). The
 * display state is resolved by src/lib/protocol/checkout-state-mapping.ts
 * (one authority state ↔ exactly one display state); this component only
 * renders it and never re-derives mapping, amounts, or outcomes.
 *
 * Pure presentational composition (client-safe so the verification harness
 * can reuse the exact production presentations).
 */

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ActionRequiredState,
  FailedState,
  InProgressState,
  SucceededState,
  UnknownState,
  WaitingState,
} from "@/components/state";
import { formatAuthorityTimestamp } from "@/lib/protocol/checkout-port";
import type { CheckoutStateRecord } from "@/lib/protocol/checkout-port";
import type { CheckoutDisplayState } from "@/lib/protocol/checkout-state-mapping";

function MetaBadges({ display }: { display: CheckoutDisplayState }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant="secondary">{display.kind}</Badge>
      <Badge variant="outline">Mapping record: {display.recordId}</Badge>
    </div>
  );
}

function EvidenceLink({
  evidence,
}: {
  evidence: { readonly label: string; readonly href: string };
}) {
  return (
    <Link
      href={evidence.href}
      className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4 hover:text-foreground w-fit"
    >
      {evidence.label}
    </Link>
  );
}

export function CheckoutStatePresentation({
  display,
  record,
}: {
  display: CheckoutDisplayState;
  record: CheckoutStateRecord;
}) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-lg">Checkout state</CardTitle>
        <CardDescription className="grid gap-1">
          <span>
            Checkout <span className="font-medium">{record.checkoutId}</span> ·
            authority state{" "}
            <span className="font-medium">{record.state}</span>
          </span>
          <span>
            Recorded {formatAuthorityTimestamp(record.at)} · reported by{" "}
            {record.reportedBy}
          </span>
        </CardDescription>
        <MetaBadges display={display} />
      </CardHeader>

      <CardContent className="grid gap-4">
        {display.kind === "action-required" ? (
          <div className="grid gap-4">
            <ActionRequiredState
              action={display.action}
              reportedBy={display.reportedBy}
              validity={display.validity}
              consequenceOfInaction={display.consequenceOfInaction}
            />
            {record.originatingOfferSummary ? (
              <p className="text-sm text-muted-foreground">
                {record.originatingOfferSummary}
              </p>
            ) : null}
            <Link
              href={`/checkout?checkoutId=${record.checkoutId}`}
              className={buttonVariants({ variant: "default" })}
            >
              Review this offer and decide
            </Link>
          </div>
        ) : null}

        {display.kind === "in-progress-accept-submission" ||
        display.kind === "in-progress-decline-submission" ? (
          <div className="grid gap-4">
            <InProgressState
              whatIsHappening={display.whatIsHappening}
              whatCompletesIt={display.whatCompletesIt}
              reportedBy={display.reportedBy}
            >
              {record.originatingOfferSummary ? (
                <p className="text-muted-foreground">
                  {record.originatingOfferSummary}
                </p>
              ) : null}
              {record.evidence ? (
                <EvidenceLink evidence={record.evidence} />
              ) : null}
            </InProgressState>
            <p className="text-xs text-muted-foreground">
              The decision is in the protocol&apos;s hands. This surface shows
              the recorded terminal state as soon as the authority publishes
              it — it never assumes an outcome mid-flight.
            </p>
          </div>
        ) : null}

        {display.kind === "succeeded-acknowledged" ? (
          <div className="grid gap-4">
            <SucceededState
              outcome={display.outcome}
              reportedBy={display.reportedBy}
              evidence={display.evidence}
            >
              {record.originatingOfferSummary ? (
                <p className="text-muted-foreground">
                  {record.originatingOfferSummary}
                </p>
              ) : null}
              <p>
                Your fulfilment obligations from the offer now apply. Money has
                not necessarily moved yet — the payment phase is a separate,
                authority-reported state.
              </p>
            </SucceededState>
          </div>
        ) : null}

        {display.kind === "waiting-payment-confirmation" ? (
          <div className="grid gap-4">
            <WaitingState
              whatIsWaiting={display.whatIsWaiting}
              why={display.why}
              whatHappensNext={display.whatHappensNext}
              reportedBy={display.reportedBy}
              availableActions={display.availableActions}
            >
              {record.originatingOfferSummary ? (
                <p className="text-muted-foreground">
                  {record.originatingOfferSummary}
                </p>
              ) : null}
              {record.evidence ? (
                <EvidenceLink evidence={record.evidence} />
              ) : null}
            </WaitingState>
          </div>
        ) : null}

        {display.kind === "succeeded-declined" ? (
          <div className="grid gap-4">
            <SucceededState
              outcome={display.outcome}
              reportedBy={display.reportedBy}
              evidence={display.evidence}
            >
              {record.originatingOfferSummary ? (
                <p className="text-muted-foreground">
                  {record.originatingOfferSummary}
                </p>
              ) : null}
              <p>
                The customer intent moves on without your fulfilment. No
                obligation from this offer applies to you. The decline receipt
                is the authority&apos;s record of your explicit refusal.
              </p>
            </SucceededState>
          </div>
        ) : null}

        {display.kind === "failed" ? (
          <div className="grid gap-4">
            <FailedState
              outcome={display.outcome}
              reportedBy={display.reportedBy}
              reason={display.reason}
              nextActions={display.nextActions}
            >
              {record.originatingOfferSummary ? (
                <p className="text-muted-foreground">
                  {record.originatingOfferSummary}
                </p>
              ) : null}
              {record.evidence ? (
                <EvidenceLink evidence={record.evidence} />
              ) : null}
            </FailedState>
          </div>
        ) : null}

        {display.kind === "unknown" ? (
          <div className="grid gap-4">
            <UnknownState
              subject={display.subject}
              explanation={display.explanation}
              reconciliation={display.reconciliation}
            >
              {record.originatingOfferSummary ? (
                <p className="text-muted-foreground">
                  {record.originatingOfferSummary}
                </p>
              ) : null}
              {record.evidence ? (
                <EvidenceLink evidence={record.evidence} />
              ) : null}
              <p className="text-muted-foreground">
                This page shows the resolved terminal state as soon as the
                authority publishes it. Until then, no assumption is made in
                either direction.
              </p>
            </UnknownState>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
