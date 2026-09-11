/**
 * UI-003 — Merchant checkout surface.
 * src/app/(merchant)/checkout/[checkoutId]/page.tsx
 *
 * The post-action state page: presents the authority-recorded consequential
 * state of a merchant checkout via the shared state primitives exclusively —
 * offered (action required), in-flight submissions, acknowledged acceptance,
 * waiting payment confirmation, recorded decline, failed with reason, or
 * UNKNOWN with its reconciliation path. The evidence trail is reachable for
 * consequential outcomes (P7). Role-gated to merchant (P8).
 */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { AvailabilityUnknownState } from "@/components/state";
import { CheckoutStatePresentation } from "@/components/merchant/checkout-state-presentation";
import { MerchantSurfaceBanner } from "@/components/merchant/merchant-surface-banner";
import { requireRoleSurface } from "@/lib/shell-guard";
import { resolveShellAudience } from "@/lib/shell-audience-server";
import { getCheckoutPort } from "@/lib/protocol/checkout-port";
import {
  resolveCheckoutAdapterErrorPresentation,
  resolveCheckoutDisplay,
} from "@/lib/protocol/checkout-state-mapping";

export const metadata = {
  title: "Checkout state — payswap",
  description:
    "The authority-recorded consequential state of a merchant checkout, including UNKNOWN with its reconciliation path.",
};

export default async function MerchantCheckoutStatePage({
  params,
}: {
  params: Promise<{ checkoutId: string }>;
}) {
  // Deep links are role-checked: only the merchant audience reaches this
  // surface; every other audience is redirected home by the shared guard.
  await requireRoleSurface("merchant");
  const audience = await resolveShellAudience();

  const { checkoutId } = await params;
  const port = getCheckoutPort();
  const statusResult = await port.getStatus({ checkoutId });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-8 grid gap-6">
        <MerchantSurfaceBanner
          title="Checkout state"
          description="The authority-recorded state of one merchant checkout. This page only restates what the authority reported — it never derives, predicts, or mutates a state."
          authorityOwner={port.authorityOwner}
          runtime={port.runtime}
          currentAudience={audience}
          backHref="/checkout"
          backLabel="Back to open offers"
        />

        {statusResult.ok ? (
          (() => {
            const display = resolveCheckoutDisplay(statusResult.record);
            return (
              <CheckoutStatePresentation
                display={display}
                record={statusResult.record}
              />
            );
          })()
        ) : (
          <section
            aria-labelledby="state-unavailable-heading"
            className="grid gap-3"
          >
            <h2 id="state-unavailable-heading" className="text-lg font-semibold">
              Checkout state unavailable
            </h2>
            {(() => {
              const errorPresentation = resolveCheckoutAdapterErrorPresentation(
                statusResult.error,
                statusResult.detail,
                statusResult.reportedBy,
              );
              return (
                <AvailabilityUnknownState
                  target={errorPresentation.target}
                  detail={errorPresentation.detail}
                />
              );
            })()}
            <p className="text-sm text-muted-foreground">
              This is an availability condition of the boundary, not a
              checkout state: no outcome is claimed for {checkoutId}, and no
              outcome is guessed.
            </p>
            <Link
              href="/checkout"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <ArrowLeft aria-hidden="true" />
              Back to open offers
            </Link>
          </section>
        )}
      </main>

      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto w-full max-w-5xl px-4 py-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span>
            Checkout state page (UI-003) · state truth owned by{" "}
            {port.authorityOwner}
          </span>
          <Link
            href="/verification/checkout-flow#matrix"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Checkout state matrix (verification harness)
          </Link>
        </div>
      </footer>
    </div>
  );
}
