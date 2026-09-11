/**
 * UI-003 — Merchant checkout surface.
 * src/lib/protocol/checkout-state-mapping.ts
 *
 * Authority state → display state resolution for the merchant checkout
 * surface. Every merchant-checkout authority state resolves to EXACTLY ONE
 * display state (one-to-one, P4): the mapping below is a total, deterministic
 * function over the MerchantCheckoutState vocabulary, and no two authority
 * states share a display kind. Each display state carries the id of its
 * complete nine-question mapping record in
 * spec/product/checkout-mapping-records.md.
 *
 * The display states are presentation contracts for the shared state
 * primitives (src/components/state): the mapping supplies fixed plain-language
 * framing, the authority record supplies authority-quoted details (reason,
 * evidence, reconciliation, next actions). Nothing here computes financial
 * truth; nothing here mutates authority state.
 */

import type {
  CheckoutPortError,
  CheckoutReconciliation,
  CheckoutStateRecord,
  MerchantCheckoutState,
} from "./checkout-port";

// ---------------------------------------------------------------------------
// Mapping-record ids (complete records in spec/product/checkout-mapping-records.md)
// ---------------------------------------------------------------------------

export type CheckoutMappingRecordId =
  | "cko-map-01"
  | "cko-map-02"
  | "cko-map-03"
  | "cko-map-04"
  | "cko-map-05"
  | "cko-map-06"
  | "cko-map-07"
  | "cko-map-08";

// ---------------------------------------------------------------------------
// Display states (one per authority state; one-to-one)
// ---------------------------------------------------------------------------

export type CheckoutDisplayKind =
  | "action-required"
  | "in-progress-accept-submission"
  | "in-progress-decline-submission"
  | "succeeded-acknowledged"
  | "waiting-payment-confirmation"
  | "succeeded-declined"
  | "failed"
  | "unknown";

export type CheckoutDisplayState =
  | {
      readonly kind: "action-required";
      readonly recordId: CheckoutMappingRecordId;
      readonly action: string;
      readonly reportedBy: string;
      readonly validity: string;
      readonly consequenceOfInaction: string;
    }
  | {
      readonly kind: "in-progress-accept-submission";
      readonly recordId: CheckoutMappingRecordId;
      readonly whatIsHappening: string;
      readonly whatCompletesIt: string;
      readonly reportedBy: string;
    }
  | {
      readonly kind: "in-progress-decline-submission";
      readonly recordId: CheckoutMappingRecordId;
      readonly whatIsHappening: string;
      readonly whatCompletesIt: string;
      readonly reportedBy: string;
    }
  | {
      readonly kind: "succeeded-acknowledged";
      readonly recordId: CheckoutMappingRecordId;
      readonly outcome: string;
      readonly reportedBy: string;
      readonly evidence: { readonly label: string; readonly href: string };
    }
  | {
      readonly kind: "waiting-payment-confirmation";
      readonly recordId: CheckoutMappingRecordId;
      readonly whatIsWaiting: string;
      readonly why: string;
      readonly whatHappensNext: string;
      readonly reportedBy: string;
      readonly availableActions: readonly string[];
    }
  | {
      readonly kind: "succeeded-declined";
      readonly recordId: CheckoutMappingRecordId;
      readonly outcome: string;
      readonly reportedBy: string;
      readonly evidence: { readonly label: string; readonly href: string };
    }
  | {
      readonly kind: "failed";
      readonly recordId: CheckoutMappingRecordId;
      readonly outcome: string;
      readonly reportedBy: string;
      readonly reason: string;
      readonly nextActions: readonly string[];
    }
  | {
      readonly kind: "unknown";
      readonly recordId: CheckoutMappingRecordId;
      readonly subject: string;
      readonly explanation: string;
      readonly reconciliation: CheckoutReconciliation;
    };

// ---------------------------------------------------------------------------
// Fixed framing (single source of plain-language consequence text)
// ---------------------------------------------------------------------------

/**
 * The 'offered' action framing. Validity and consequence-of-inaction are
 * stated BEFORE any commitment control so the merchant always decides with
 * the consequences visible.
 */
export const CHECKOUT_OFFERED_ACTION_LABEL =
  "Decide this checkout explicitly: accept the offer or decline it. No action happens until you choose one." as const;

/**
 * Consequence of not deciding while the offer is open — stated up front
 * (ActionRequiredState.consequenceOfInaction).
 */
export const CHECKOUT_OFFERED_CONSEQUENCE_OF_INACTION =
  "If you neither accept nor decline before the offer lapses, the customer intent moves on without your fulfilment, the quote expires, and a later acceptance is refused." as const;

/**
 * In-flight framing for the two submission windows. Used both by the state
 * page (authority records) and by the decision controls while a submission
 * is being routed (the same words, so the surface never invents a different
 * story client-side).
 */
export const CHECKOUT_IN_PROGRESS_FRAMING = {
  accept: {
    whatIsHappening:
      "Your acceptance is being routed through protocol authorization. Nothing is committed on this page while it is in flight.",
    whatCompletesIt:
      "The Checkout/Intent Authority records the terminal outcome: an acknowledged acceptance, a failure with a recorded reason, or — if the response is lost — an UNKNOWN outcome with a reconciliation path.",
  },
  decline: {
    whatIsHappening:
      "Your decline is being routed through protocol authorization. Nothing is recorded on this page while it is in flight.",
    whatCompletesIt:
      "The Checkout/Intent Authority records the decline receipt, or a failure with a recorded reason if the submission itself fails.",
  },
} as const;

const FALLBACK_EVIDENCE = {
  label: "Evidence trail (pending authority publication)",
  href: "/verification/checkout-flow#adapter-report",
} as const;

const FALLBACK_REASON =
  "The authority recorded a failure without publishing a reason. Treat this as incomplete reporting: re-check the state page rather than assuming a cause." as const;

const FALLBACK_RECONCILIATION: CheckoutReconciliation = {
  whoResolves: "The Checkout/Intent Authority reconciliation job (owner: operator on duty).",
  recheckTrigger:
    "Re-check this state page after the next reconciliation run; the resolved outcome is published here.",
} as const;

// ---------------------------------------------------------------------------
// Resolution (total, deterministic, one-to-one)
// ---------------------------------------------------------------------------

/**
 * Resolve an authority checkout state record to its single display state.
 * This is the ONLY place authority states become presentation states for the
 * merchant checkout surface; pages and components must not re-derive it.
 */
export function resolveCheckoutDisplay(
  record: CheckoutStateRecord,
): CheckoutDisplayState {
  switch (record.state) {
    case "offered":
      return {
        kind: "action-required",
        recordId: "cko-map-01",
        action: CHECKOUT_OFFERED_ACTION_LABEL,
        reportedBy: record.reportedBy,
        validity: `Offer valid until the authority-quoted deadline recorded for ${record.checkoutId} (see the quote receipt).`,
        consequenceOfInaction: CHECKOUT_OFFERED_CONSEQUENCE_OF_INACTION,
      };
    case "accept-submitted":
      return {
        kind: "in-progress-accept-submission",
        recordId: "cko-map-02",
        whatIsHappening: CHECKOUT_IN_PROGRESS_FRAMING.accept.whatIsHappening,
        whatCompletesIt: CHECKOUT_IN_PROGRESS_FRAMING.accept.whatCompletesIt,
        reportedBy: record.reportedBy,
      };
    case "decline-submitted":
      return {
        kind: "in-progress-decline-submission",
        recordId: "cko-map-03",
        whatIsHappening: CHECKOUT_IN_PROGRESS_FRAMING.decline.whatIsHappening,
        whatCompletesIt: CHECKOUT_IN_PROGRESS_FRAMING.decline.whatCompletesIt,
        reportedBy: record.reportedBy,
      };
    case "accepted":
      return {
        kind: "succeeded-acknowledged",
        recordId: "cko-map-04",
        outcome: "Checkout accepted — your acceptance is acknowledged and recorded",
        reportedBy: record.reportedBy,
        evidence: record.evidence ?? FALLBACK_EVIDENCE,
      };
    case "accepted-awaiting-payment":
      return {
        kind: "waiting-payment-confirmation",
        recordId: "cko-map-05",
        whatIsWaiting:
          "Confirmation that the customer's payment has arrived on the paying-side authority.",
        why: "Your acceptance is acknowledged, but money has not moved yet: the customer's payment is still being confirmed.",
        whatHappensNext:
          "When the payment is confirmed, the authority schedules your quoted payout on the next settlement run; if the payment fails, the checkout moves to a failed state with a recorded reason.",
        reportedBy: record.reportedBy,
        availableActions: record.availableActions ?? [
          "Watch this state page — the authority publishes the payment outcome here.",
        ],
      };
    case "declined":
      return {
        kind: "succeeded-declined",
        recordId: "cko-map-06",
        outcome: "Checkout declined — your decline is recorded",
        reportedBy: record.reportedBy,
        evidence: record.evidence ?? FALLBACK_EVIDENCE,
      };
    case "failed":
      return {
        kind: "failed",
        recordId: "cko-map-07",
        outcome: "Checkout decision failed",
        reportedBy: record.reportedBy,
        reason: record.reason ?? FALLBACK_REASON,
        nextActions: record.nextActions ?? [
          "Re-check this state page; the authority publishes failures with reasons.",
        ],
      };
    case "unknown":
      return {
        kind: "unknown",
        recordId: "cko-map-08",
        subject: `The outcome of checkout ${record.checkoutId} is UNKNOWN`,
        explanation:
          "A decision was submitted and routed through protocol authorization, but no terminal acknowledgment or failure reached this surface before the response window closed. This surface does not guess the outcome — treat it as undecided until the authority publishes the resolved state.",
        reconciliation: record.reconciliation ?? FALLBACK_RECONCILIATION,
      };
  }
}

// ---------------------------------------------------------------------------
// The mapping table (mirrors the mapping records; drives the harness report)
// ---------------------------------------------------------------------------

export interface CheckoutDisplayMappingRow {
  readonly authorityState: MerchantCheckoutState;
  readonly displayKind: CheckoutDisplayKind;
  readonly recordId: CheckoutMappingRecordId;
  readonly primitive: string;
}

export const CHECKOUT_DISPLAY_MAPPING_TABLE: readonly CheckoutDisplayMappingRow[] =
  [
    {
      authorityState: "offered",
      displayKind: "action-required",
      recordId: "cko-map-01",
      primitive: "ActionRequiredState",
    },
    {
      authorityState: "accept-submitted",
      displayKind: "in-progress-accept-submission",
      recordId: "cko-map-02",
      primitive: "InProgressState",
    },
    {
      authorityState: "decline-submitted",
      displayKind: "in-progress-decline-submission",
      recordId: "cko-map-03",
      primitive: "InProgressState",
    },
    {
      authorityState: "accepted",
      displayKind: "succeeded-acknowledged",
      recordId: "cko-map-04",
      primitive: "SucceededState",
    },
    {
      authorityState: "accepted-awaiting-payment",
      displayKind: "waiting-payment-confirmation",
      recordId: "cko-map-05",
      primitive: "WaitingState",
    },
    {
      authorityState: "declined",
      displayKind: "succeeded-declined",
      recordId: "cko-map-06",
      primitive: "SucceededState",
    },
    {
      authorityState: "failed",
      displayKind: "failed",
      recordId: "cko-map-07",
      primitive: "FailedState",
    },
    {
      authorityState: "unknown",
      displayKind: "unknown",
      recordId: "cko-map-08",
      primitive: "UnknownState",
    },
  ] as const;

// ---------------------------------------------------------------------------
// Adapter-error presentation (explicit NON-states — see the mapping records)
// ---------------------------------------------------------------------------

/**
 * Adapter-level errors are NOT consequential checkout states. They resolve to
 * the AvailabilityUnknown presentation: the surface states that it cannot
 * determine availability, and claims nothing else. Listed as explicit
 * non-states in spec/product/checkout-mapping-records.md.
 */
export function resolveCheckoutAdapterErrorPresentation(
  error: CheckoutPortError,
  detail: string,
  reportedBy: string,
): {
  readonly target: string;
  readonly detail: string;
} {
  const scope =
    error === "checkout-not-found"
      ? "the requested checkout object"
      : "the checkout authority boundary";
  return {
    target: `${scope} — ${detail} (${reportedBy})`,
    detail:
      "This is an availability condition of this surface's adapter, not a checkout state: no consequential claim is made. Re-check the surface, or use the verification harness to inspect the scripted boundary behavior.",
  };
}
