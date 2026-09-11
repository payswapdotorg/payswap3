"use client";

/**
 * UI-003 — Merchant checkout surface.
 * src/components/merchant/checkout-decision-controls.tsx
 *
 * The explicit decision controls for a merchant checkout offer:
 * - Accept and decline are two DISTINCT, single-intent buttons. Neither is
 *   pre-selected: no default focus, no pre-checked choice, no combined
 *   toggle (N3, P-pre-selection).
 * - Each intent gets its own inline confirmation panel that RESTATES the
 *   consequences (amounts, material conditions, obligations, validity)
 *   immediately before the commitment — nothing decision-relevant is
 *   collapsed at the moment of choice.
 * - Both actions route through protocol authorization via the checkout port
 *   (getCheckoutPort().submitDecision). The UI never applies a decision
 *   itself; it only submits an explicit single-intent request and then
 *   observes the authority-recorded state (N3, no silent state mutation).
 *
 * An optional onSubmitted callback lets the verification harness intercept
 * the post-submission navigation; the default behavior navigates to the
 * follow-up state page.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AvailabilityUnknownState, InProgressState } from "@/components/state";
import {
  formatAuthorityQuotedMoney,
  formatAuthorityTimestamp,
  getCheckoutPort,
  type CheckoutDecisionResult,
  type CheckoutOfferView,
} from "@/lib/protocol/checkout-port";
import { CHECKOUT_IN_PROGRESS_FRAMING } from "@/lib/protocol/checkout-state-mapping";

type Decision = "accept" | "decline";

type Phase =
  | { readonly stage: "idle" }
  | { readonly stage: "confirm"; readonly decision: Decision }
  | { readonly stage: "submitting"; readonly decision: Decision };

interface FailureState {
  readonly target: string;
  readonly detail: string;
}

const amountFor = (offer: CheckoutOfferView, key: string) =>
  offer.quotedAmounts.find((quoted) => quoted.key === key)?.amount;

const materialConditionsOf = (offer: CheckoutOfferView) =>
  offer.conditions.filter((condition) => condition.material);

export function CheckoutDecisionControls({
  offer,
  onSubmitted,
}: {
  offer: CheckoutOfferView;
  /** Optional interception for the verification harness; default navigates. */
  onSubmitted?: (result: CheckoutDecisionResult) => void;
}) {
  const router = useRouter();
  const port = getCheckoutPort();
  const [phase, setPhase] = useState<Phase>({ stage: "idle" });
  const [failure, setFailure] = useState<FailureState | null>(null);
  const confirmHeadingRef = useRef<HTMLHeadingElement>(null);

  // When a confirmation panel opens, focus its heading — a neutral element.
  // The confirm button itself is never auto-focused, so no intent is
  // pre-selected for keyboard users either.
  useEffect(() => {
    if (phase.stage === "confirm") {
      confirmHeadingRef.current?.focus();
    }
  }, [phase]);

  async function submitDecision(decision: Decision) {
    setPhase({ stage: "submitting", decision });
    setFailure(null);
    let result: CheckoutDecisionResult;
    try {
      result = await port.submitDecision({
        checkoutId: offer.checkoutId,
        decision,
      });
    } catch (error) {
      setPhase({ stage: "idle" });
      setFailure({
        target: "the decision submission path",
        detail: `The submission did not complete: ${
          error instanceof Error ? error.message : String(error)
        }. No decision has been recorded — nothing was committed.`,
      });
      return;
    }
    if (result.ok) {
      if (onSubmitted) {
        onSubmitted(result);
        setPhase({ stage: "idle" });
        return;
      }
      router.push(result.followUpHref);
      return;
    }
    // The authority refused the submission itself (not a decision outcome).
    if (result.error === "decision-not-allowed") {
      // The checkout already has a recorded state: observe it instead of
      // retrying. This is a route to the authority's answer, not a UI-side
      // state mutation.
      router.push(`/checkout/${offer.checkoutId}`);
      return;
    }
    setPhase({ stage: "idle" });
    setFailure({
      target: "the decision submission path",
      detail: `${result.error}: ${result.detail} No decision has been recorded — nothing was committed.`,
    });
  }

  const receiveAmount = amountFor(offer, "merchant-receives");
  const customerPaysAmount = amountFor(offer, "customer-pays");
  const materialConditions = materialConditionsOf(offer);

  return (
    <div className="grid gap-4" data-checkout-decision-controls={offer.checkoutId}>
      {phase.stage === "idle" ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="default"
              size="lg"
              onClick={() => setPhase({ stage: "confirm", decision: "accept" })}
              aria-describedby="decision-controls-note"
            >
              <Check aria-hidden="true" />
              Accept offer
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setPhase({ stage: "confirm", decision: "decline" })}
              aria-describedby="decision-controls-note"
            >
              <X aria-hidden="true" />
              Decline offer
            </Button>
          </div>
          <p id="decision-controls-note" className="sr-only">
            Two separate single-intent actions: accepting commits you to the
            obligations of this offer; declining records your refusal. Neither
            is pre-selected; each asks for its own confirmation.
          </p>
          {failure ? (
            <AvailabilityUnknownState target={failure.target} detail={failure.detail} />
          ) : null}
        </div>
      ) : null}

      {phase.stage === "confirm" && phase.decision === "accept" ? (
        <Card className="gap-4 border-emerald-600/40" role="group" aria-label="Confirm acceptance">
          <CardHeader>
            <CardTitle className="text-base">
              <span aria-hidden="true" className="inline-flex items-center gap-2">
                <Check className="size-4 text-emerald-600" />
              </span>
              Confirm acceptance of {offer.protocolReference}
            </CardTitle>
            <CardDescription>
              Restated consequences — read them, then confirm or go back.
              Nothing is committed until you press &quot;Confirm
              acceptance&quot;.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <h4
                ref={confirmHeadingRef}
                tabIndex={-1}
                className="text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-sm"
              >
                What you are committing to
              </h4>
              <ul className="list-disc pl-5 grid gap-1.5 text-sm">
                {receiveAmount ? (
                  <li>
                    You receive{" "}
                    <span className="font-medium">
                      {formatAuthorityQuotedMoney(receiveAmount)}
                    </span>{" "}
                    (quoted by the authority; you never see a different figure
                    from this surface) on the authority&apos;s settlement
                    schedule — not instantly.
                  </li>
                ) : null}
                {customerPaysAmount ? (
                  <li>
                    The customer pays{" "}
                    <span className="font-medium">
                      {formatAuthorityQuotedMoney(customerPaysAmount)}
                    </span>{" "}
                    through the quoted payment rail.
                  </li>
                ) : null}
                <li>
                  Offer validity: until{" "}
                  <span className="font-medium">
                    {formatAuthorityTimestamp(offer.validUntil)}
                  </span>{" "}
                  — a later acceptance is refused.
                </li>
                <li>
                  You accept all {offer.obligations.length} obligations and all{" "}
                  {offer.conditions.length} conditions of this offer.
                </li>
              </ul>
            </div>
            <div className="grid gap-2">
              <h4 className="text-sm font-semibold">
                Material conditions restated at the moment of commitment
              </h4>
              <ul className="grid gap-2">
                {materialConditions.map((condition) => (
                  <li
                    key={condition.id}
                    className="rounded-md border p-3 grid gap-1 text-sm"
                  >
                    <span className="font-medium">{condition.title}</span>
                    <span className="text-muted-foreground">
                      {condition.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="default"
                onClick={() => submitDecision("accept")}
              >
                <Check aria-hidden="true" />
                Confirm acceptance
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPhase({ stage: "idle" })}
              >
                Back — do not accept yet
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {phase.stage === "confirm" && phase.decision === "decline" ? (
        <Card className="gap-4" role="group" aria-label="Confirm decline">
          <CardHeader>
            <CardTitle className="text-base">
              <span aria-hidden="true" className="inline-flex items-center gap-2">
                <X className="size-4" />
              </span>
              Confirm decline of {offer.protocolReference}
            </CardTitle>
            <CardDescription>
              Declining is its own consequential action. Read what it means,
              then confirm or go back.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <h4
                ref={confirmHeadingRef}
                tabIndex={-1}
                className="text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-sm"
              >
                What declining means
              </h4>
              <ul className="list-disc pl-5 grid gap-1.5 text-sm">
                <li>
                  Your refusal is recorded with the Checkout/Intent Authority
                  under a decline receipt.
                </li>
                <li>
                  The customer&apos;s intent moves on without your fulfilment;
                  this specific offer is closed to you.
                </li>
                <li>
                  A recorded decline is not reversible from this surface. If you
                  change your mind, that is a new decision on a new offer —
                  only the authority can record it.
                </li>
                <li>
                  Nothing is accepted by declining: no obligation from this
                  offer applies to you.
                </li>
              </ul>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="destructive"
                onClick={() => submitDecision("decline")}
              >
                <X aria-hidden="true" />
                Confirm decline
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPhase({ stage: "idle" })}
              >
                Back — do not decline yet
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {phase.stage === "submitting" ? (
        <div className="grid gap-3">
          <InProgressState
            whatIsHappening={
              CHECKOUT_IN_PROGRESS_FRAMING[phase.decision].whatIsHappening
            }
            whatCompletesIt={
              CHECKOUT_IN_PROGRESS_FRAMING[phase.decision].whatCompletesIt
            }
            reportedBy="Checkout/Intent Authority — submission in flight (mock stand-in)"
          />
          <p className="text-xs text-muted-foreground">
            Do not close this page while the decision is in flight. The
            consequential state is observed on the state page, never assumed
            here.
          </p>
        </div>
      ) : null}
    </div>
  );
}
