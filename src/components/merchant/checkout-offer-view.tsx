/**
 * UI-003 — Merchant checkout surface.
 * src/components/merchant/checkout-offer-view.tsx
 *
 * The complete, consequence-first offer/quote presentation: plain-language
 * summary, authority-quoted amounts, full terms (conditions + obligations),
 * the action-required strip with validity and consequence-of-inaction, and a
 * children slot for the explicit decision controls. Amounts, conditions and
 * obligations are all visible BEFORE any commitment control (P2, P3); every
 * figure is authority-quoted and rendered verbatim — never computed here.
 *
 * Pure presentational composition (client-safe; the decision controls are
 * passed in as children).
 */

import type { ReactNode } from "react";
import { ReceiptText } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ActionRequiredState } from "@/components/state";
import {
  formatAuthorityQuotedMoney,
  formatAuthorityTimestamp,
  type CheckoutOfferView,
  type CheckoutRuntimeStatus,
} from "@/lib/protocol/checkout-port";
import {
  CHECKOUT_OFFERED_ACTION_LABEL,
  CHECKOUT_OFFERED_CONSEQUENCE_OF_INACTION,
} from "@/lib/protocol/checkout-state-mapping";
import { CheckoutTermsPanel } from "@/components/merchant/checkout-terms-panel";

export function CheckoutOfferView({
  offer,
  reportedBy,
  runtime,
  children,
}: {
  offer: CheckoutOfferView;
  reportedBy: string;
  runtime: CheckoutRuntimeStatus;
  children?: ReactNode;
}) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-lg leading-snug">{offer.title}</CardTitle>
        <CardDescription className="grid gap-1">
          <span>
            Quoted {formatAuthorityTimestamp(offer.quotedAt)} · Valid until{" "}
            <span className="text-foreground font-medium">
              {formatAuthorityTimestamp(offer.validUntil)}
            </span>
          </span>
          <span>
            Protocol reference {offer.protocolReference} · Originating customer
            intent {offer.intentReference}
          </span>
        </CardDescription>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="secondary">State: offered — decision required</Badge>
          <Badge variant="secondary">Quoted by authority</Badge>
        </div>
      </CardHeader>

      <CardContent className="grid gap-6">
        <Alert>
          <ReceiptText aria-hidden="true" />
          <AlertTitle>In plain language</AlertTitle>
          <AlertDescription>
            <p className="leading-relaxed">{offer.plainLanguageSummary}</p>
            <p className="text-xs pt-1">
              Read the full terms below before deciding. Nothing is committed
              until you explicitly accept.
            </p>
          </AlertDescription>
        </Alert>

        <section aria-labelledby="quoted-amounts-heading" className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="quoted-amounts-heading" className="text-lg font-semibold">
              Quoted amounts
            </h2>
            <Badge variant="outline">
              Quoted by the authority — never computed on this surface
            </Badge>
          </div>
          <dl className="grid gap-3 sm:grid-cols-3">
            {offer.quotedAmounts.map((quoted) => (
              <div
                key={quoted.key}
                className="rounded-lg border p-4 grid gap-1"
              >
                <dt className="text-muted-foreground text-sm">
                  {quoted.label}
                </dt>
                <dd
                  className={
                    quoted.emphasis === "primary"
                      ? "text-2xl font-semibold tracking-tight"
                      : "text-lg font-medium text-muted-foreground"
                  }
                >
                  {formatAuthorityQuotedMoney(quoted.amount)}
                </dd>
                {quoted.note ? (
                  <dd className="text-xs text-muted-foreground leading-relaxed">
                    {quoted.note}
                  </dd>
                ) : null}
              </div>
            ))}
          </dl>
        </section>

        <CheckoutTermsPanel
          conditions={offer.conditions}
          obligations={offer.obligations}
        />

        <ActionRequiredState
          action={CHECKOUT_OFFERED_ACTION_LABEL}
          reportedBy={reportedBy}
          validity={`This offer is valid until ${formatAuthorityTimestamp(
            offer.validUntil,
          )} (authority-quoted deadline).`}
          consequenceOfInaction={CHECKOUT_OFFERED_CONSEQUENCE_OF_INACTION}
        />

        <Separator />

        <section aria-labelledby="decision-heading" className="grid gap-3">
          <h2 id="decision-heading" className="text-lg font-semibold">
            Your decision
          </h2>
          <p className="text-sm text-muted-foreground">
            Accept and decline are two separate, single-intent actions. Neither
            is pre-selected, and no action is taken until you explicitly choose
            one.
            {runtime === "ARRIVING"
              ? "While the runtime is ARRIVING, decisions are routed through the simulated protocol authorization path of the NON-AUTHORITATIVE mock."
              : ""}
          </p>
          {children}
        </section>
      </CardContent>

      <CardFooter className="text-xs text-muted-foreground gap-2 flex-wrap">
        <span>Evidence:</span>
        <a
          href={offer.evidence.href}
          className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground"
        >
          {offer.evidence.label}
        </a>
      </CardFooter>
    </Card>
  );
}
