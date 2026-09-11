/**
 * UI-003 — Merchant checkout surface.
 * src/app/verification/checkout-flow/page.tsx
 *
 * The verification harness page for the merchant checkout surface (the
 * intent-flow model from UI-002). Prefetches the scripted scenario matrix and
 * the live offer server-side, then hands serializable data to the client
 * harness, which exercises the real production components.
 *
 * The harness itself is gated to merchant + operator + administrator
 * (verification tooling); the merchant checkout surfaces it verifies are
 * gated to merchant only.
 */

import { requireRoleSurface } from "@/lib/shell-guard";
import { resolveShellAudience } from "@/lib/shell-audience-server";
import { getCheckoutPort } from "@/lib/protocol/checkout-port";
import { resolveCheckoutDisplay } from "@/lib/protocol/checkout-state-mapping";
import { MOCK_CHECKOUT_SCENARIOS } from "@/lib/protocol/mock-checkout-authority";
import {
  CheckoutFlowHarness,
  type CheckoutMatrixRow,
} from "@/components/verification/checkout-flow-harness";

export const metadata = {
  title: "Checkout flow verification — payswap",
  description:
    "Verification harness for the merchant checkout surface: accept/decline flows, the checkout state matrix including UNKNOWN, the role matrix, and the adapter boundary report.",
};

export default async function CheckoutFlowVerificationPage() {
  await requireRoleSurface("merchant", [
    "operator",
    "administrator",
  ]);
  const audience = await resolveShellAudience();

  const port = getCheckoutPort();

  // Prefetch the full scripted matrix (server-side port calls) and the live
  // default offer the decision-surface demo uses.
  const matrixRows: CheckoutMatrixRow[] = [];
  for (const scenario of MOCK_CHECKOUT_SCENARIOS) {
    const statusResult = await port.getStatus({
      checkoutId: scenario.checkoutId,
    });
    matrixRows.push({
      scenario,
      statusResult,
      display: statusResult.ok
        ? resolveCheckoutDisplay(statusResult.record)
        : null,
    });
  }

  const offerResult = await port.getOffer({});

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex-1 mx-auto w-full max-w-5xl px-4 py-8 grid gap-6">
        {offerResult.ok ? (
          <CheckoutFlowHarness
            currentAudience={audience}
            liveOffer={offerResult.offer}
            liveOfferReportedBy={offerResult.reportedBy}
            matrixRows={matrixRows}
            authorityOwner={port.authorityOwner}
            runtime={port.runtime}
          />
        ) : (
          <section className="grid gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              Checkout flow verification unavailable
            </h1>
            <p className="text-sm text-muted-foreground">
              The harness could not load the live offer presentation from the
              boundary ({offerResult.error}: {offerResult.detail}), so the
              decision-surface demo cannot run. Checkout truth is owned by{" "}
              {port.authorityOwner}; nothing is guessed here.
            </p>
          </section>
        )}
      </div>
      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto w-full max-w-5xl px-4 py-4 text-xs text-muted-foreground">
          Verification harness (UI-003) · runtime ARRIVING · mock backing is
          NON-AUTHORITATIVE (presentation-only)
        </div>
      </footer>
    </div>
  );
}
