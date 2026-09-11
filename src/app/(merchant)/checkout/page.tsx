/**
 * UI-003 — Merchant checkout surface.
 * src/app/(merchant)/checkout/page.tsx
 *
 * The offer/quote presentation surface for merchants — consequence-first:
 * the plain-language summary, authority-quoted amounts, full conditions and
 * obligations, validity, and consequence-of-inaction are all rendered BEFORE
 * any commitment control, and accept/decline are distinct, explicit,
 * single-intent actions (neither pre-selected).
 *
 * Role-gated to the merchant audience via the shared shell guard: deep links
 * from any other audience redirect home (P8).
 */

import Link from "next/link";
import { Clock, Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AvailabilityUnknownState } from "@/components/state";
import { CheckoutDecisionControls } from "@/components/merchant/checkout-decision-controls";
import { CheckoutOfferView } from "@/components/merchant/checkout-offer-view";
import { MerchantSurfaceBanner } from "@/components/merchant/merchant-surface-banner";
import { requireRoleSurface } from "@/lib/shell-guard";
import { resolveShellAudience } from "@/lib/shell-audience-server";
import {
  formatAuthorityQuotedMoney,
  formatAuthorityTimestamp,
  getCheckoutPort,
} from "@/lib/protocol/checkout-port";
import { resolveCheckoutAdapterErrorPresentation } from "@/lib/protocol/checkout-state-mapping";

export const metadata = {
  title: "Merchant checkout — payswap",
  description:
    "Review open offers and quotes with complete consequences, then explicitly accept or decline.",
};

export default async function MerchantCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ checkoutId?: string }>;
}) {
  // Deep links are role-checked: only the merchant audience reaches this
  // surface; every other audience is redirected home by the shared guard.
  await requireRoleSurface("merchant");
  const audience = await resolveShellAudience();

  const { checkoutId } = await searchParams;
  const port = getCheckoutPort();
  const [queueResult, offerResult] = await Promise.all([
    port.listOpenCheckouts(),
    port.getOffer({ checkoutId }),
  ]);

  const selectedCheckoutId = offerResult.ok
    ? offerResult.offer.checkoutId
    : (checkoutId ?? "unknown");

  const offerErrorPresentation = offerResult.ok
    ? null
    : resolveCheckoutAdapterErrorPresentation(
        offerResult.error,
        offerResult.detail,
        offerResult.reportedBy,
      );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex-1 mx-auto w-full max-w-5xl px-4 py-8 grid gap-6">
        <MerchantSurfaceBanner
          title="Merchant checkout"
          description="Open offers and quotes addressed to your merchant identity. Each offer shows the full consequences before any commitment; accepting and declining are separate explicit actions."
          authorityOwner={port.authorityOwner}
          runtime={port.runtime}
          currentAudience={audience}
        />

        {queueResult.ok ? (
          <section aria-labelledby="open-offers-heading" className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Inbox aria-hidden="true" className="size-4 text-muted-foreground" />
              <h2 id="open-offers-heading" className="text-lg font-semibold">
                Open offers awaiting your explicit decision ({queueResult.items.length})
              </h2>
            </div>
            {queueResult.items.length === 0 ? (
              <Card>
                <CardContent className="text-sm text-muted-foreground">
                  No open offers are queued for your merchant identity right
                  now. New quotes appear here when the authority presents
                  them.
                </CardContent>
              </Card>
            ) : (
              <ul className="grid gap-3">
                {queueResult.items.map((item) => {
                  const isReviewed = item.checkoutId === selectedCheckoutId;
                  return (
                    <li key={item.checkoutId}>
                      <Card
                        className="gap-3 py-4"
                        aria-current={isReviewed ? "true" : undefined}
                      >
                        <CardContent className="flex flex-wrap items-center justify-between gap-3">
                          <div className="grid gap-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-sm leading-snug">
                                {item.title}
                              </p>
                              {isReviewed ? (
                                <Badge>Currently reviewed</Badge>
                              ) : (
                                <Badge variant="outline">Open</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {item.protocolReference} · you receive{" "}
                              <span className="text-foreground font-medium">
                                {formatAuthorityQuotedMoney(item.receiveAmount)}
                              </span>{" "}
                              · valid until{" "}
                              {formatAuthorityTimestamp(item.validUntil)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Clock
                              aria-hidden="true"
                              className="size-4 text-muted-foreground"
                            />
                            {isReviewed ? (
                              <span className="text-sm text-muted-foreground">
                                Reviewed below
                              </span>
                            ) : (
                              <Link
                                href={`/checkout?checkoutId=${item.checkoutId}`}
                                className={buttonVariants({
                                  variant: "outline",
                                  size: "sm",
                                })}
                              >
                                Review this offer
                              </Link>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : (
          <AvailabilityUnknownState
            target="the merchant offer queue"
            detail={queueResult.detail}
          />
        )}

        <Separator />

        {offerResult.ok ? (
          <CheckoutOfferView
            offer={offerResult.offer}
            reportedBy={offerResult.reportedBy}
            runtime={offerResult.runtime}
          >
            <CheckoutDecisionControls offer={offerResult.offer} />
          </CheckoutOfferView>
        ) : (
          <section aria-labelledby="offer-unavailable-heading" className="grid gap-3">
            <h2 id="offer-unavailable-heading" className="text-lg font-semibold">
              Offer presentation unavailable
            </h2>
            <AvailabilityUnknownState
              target={offerErrorPresentation?.target ?? "the offer presentation"}
              detail={offerErrorPresentation?.detail}
            />
            <p className="text-sm text-muted-foreground">
              No decision can be made from this state: the boundary could not
              present the offer, so nothing is offered to accept or decline —
              and nothing is guessed.
            </p>
          </section>
        )}
      </div>

      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto w-full max-w-5xl px-4 py-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span>
            Merchant checkout surface (UI-003) · checkout truth owned by{" "}
            {port.authorityOwner}
          </span>
          <Link
            href="/verification/checkout-flow"
            className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground"
          >
            Checkout flow verification harness
          </Link>
        </div>
      </footer>
    </div>
  );
}
