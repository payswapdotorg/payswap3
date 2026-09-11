/**
 * UI-003 — Merchant checkout surface.
 * src/lib/protocol/mock-checkout-authority.ts
 *
 * The NON-AUTHORITATIVE mock backing for the merchant checkout port.
 *
 * MOAT (mock authority facts, pinned):
 * - Authority owner of checkout truth: the Checkout/Intent Authority per
 *   spec/architecture/v0.1. THIS FILE IS NOT THAT AUTHORITY. It is a
 *   presentation-only stand-in used while the runtime status is ARRIVING.
 * - It is sandbox data only: every checkout, amount, condition, obligation,
 *   and state record below is scripted fixture content. No figure here is
 *   financial truth; no decision here is protocol-authorized.
 * - It is deterministic: every function is a pure lookup over the fixture
 *   table below, so the server and the browser always agree, and the
 *   verification harness can script outcomes per checkout id.
 * - It is scriptable: each scripted checkout id resolves to exactly one
 *   outcome path, which is how the verification harness exercises the full
 *   state matrix — including UNKNOWN and its reconciliation path.
 * - It never mutates: submitting a decision returns a receipt and the
 *   follow-up checkout id under which the consequential state is recorded;
 *   the surface is then expected to observe that state via the port. The
 *   mock applies no silent state transitions.
 *
 * The real Checkout/Intent Authority replaces this module behind
 * getCheckoutPort() in ./checkout-port.ts; the surface code never imports
 * this file directly (only the verification harness does, to report the
 * adapter boundary).
 */

import type {
  CheckoutDecisionReceipt,
  CheckoutDecisionRequest,
  CheckoutDecisionResult,
  CheckoutId,
  CheckoutOfferRequest,
  CheckoutOfferResult,
  CheckoutOfferView,
  CheckoutPort,
  CheckoutQueueItem,
  CheckoutQueueResult,
  CheckoutStateRecord,
  CheckoutStatusRequest,
  CheckoutStatusResult,
  MerchantCheckoutState,
} from "./checkout-port";

// ---------------------------------------------------------------------------
// Mock identity
// ---------------------------------------------------------------------------

export const MOCK_CHECKOUT_AUTHORITY_NAME =
  "mock-checkout-authority (presentation-only stand-in)" as const;

export const MOCK_CHECKOUT_AUTHORITY_OWNER =
  "Checkout/Intent Authority (spec/architecture/v0.1)" as const;

export const MOCK_CHECKOUT_RUNTIME = "ARRIVING" as const;

export const MOCK_CHECKOUT_IS_AUTHORITATIVE = false as const;

const REPORTED_BY = `${MOCK_CHECKOUT_AUTHORITY_NAME} standing in for the ${MOCK_CHECKOUT_AUTHORITY_OWNER}`;

const LEDGER_REPORTED_BY = "Checkout/Intent Authority — checkout ledger (mock stand-in)";

const SUBMISSION_ACCEPTED_BY =
  "protocol-authorization gateway (simulated by the mock)";

// ---------------------------------------------------------------------------
// Scripted scenarios (sandbox data only)
// ---------------------------------------------------------------------------

/**
 * What a scripted checkout does when the merchant submits an explicit
 * decision. The follow-up id is the checkout object under which the
 * consequential state is recorded.
 */
interface DecisionScript {
  readonly accept: {
    readonly followUpCheckoutId: CheckoutId;
    readonly receiptId: string;
  };
  readonly decline: {
    readonly followUpCheckoutId: CheckoutId;
    readonly receiptId: string;
  };
}

interface ScenarioFixture {
  readonly checkoutId: CheckoutId;
  readonly label: string;
  readonly description: string;
  readonly offer: CheckoutOfferView;
  readonly stateRecord: CheckoutStateRecord;
  readonly decisionScript?: DecisionScript;
}

const harnessAnchor = (checkoutId: CheckoutId) =>
  `/verification/checkout-flow#scenario-${checkoutId}`;

const LIVE_OFFER: CheckoutOfferView = {
  checkoutId: "cko_live_offer_001",
  protocolReference: "pco_9f27c1",
  intentReference: "int_4b8a2e",
  title: "Checkout quote for customer intent int_4b8a2e — EUR corridor",
  quotedAt: "2026-05-28T09:15:00.000Z",
  validUntil: "2026-06-04T09:15:00.000Z",
  quotedAmounts: [
    {
      key: "customer-pays",
      label: "Customer pays",
      amount: { amountMinorUnits: 25000, currency: "EUR" },
      emphasis: "primary",
      note: "Quoted by the Checkout/Intent Authority. This surface never recomputes it.",
    },
    {
      key: "merchant-receives",
      label: "You receive",
      amount: { amountMinorUnits: 24615, currency: "EUR" },
      emphasis: "primary",
      note: "Quoted by the Checkout/Intent Authority, net of the protocol fee below.",
    },
    {
      key: "protocol-fee",
      label: "Protocol fee",
      amount: { amountMinorUnits: 385, currency: "EUR" },
      emphasis: "secondary",
      note: "Quoted by the Checkout/Intent Authority as part of the quote.",
    },
  ],
  conditions: [
    {
      id: "cond-rate-window",
      title: "The quoted figures hold only inside the validity window",
      detail:
        "The quote is valid until 2026-06-04 09:15 UTC. After that, the authority treats the offer as lapsed: accepting it later is refused, and the customer intent moves on without your fulfilment.",
      material: true,
    },
    {
      id: "cond-payment-method",
      title: "Customer pays by SEPA instant transfer",
      detail:
        "The customer's payment arrives from a SEPA-instant rail. If the customer's transfer fails on their side, this checkout moves to a failed payment state — your acceptance alone does not move money.",
      material: false,
    },
    {
      id: "cond-chargeback",
      title: "Chargeback exposure stays with you",
      detail:
        "If the customer later initiates a chargeback through their bank, the disputed amount is pulled back from your settlement balance before it is paid out to you. You are the party exposed to the dispute.",
      material: true,
    },
    {
      id: "cond-settlement",
      title: "Settlement runs on the authority's schedule, not instantly",
      detail:
        "After the customer's payment is confirmed, your 246.15 EUR is scheduled for payout on the next settlement run. 'You receive' describes the quoted amount, not the moment it lands in your account.",
      material: true,
    },
  ],
  obligations: [
    {
      id: "obl-fulfil",
      title: "Fulfil the customer's order once acceptance is acknowledged",
      detail:
        "Accepting commits you to fulfil the order described in intent int_4b8a2e. The authority records your acceptance and the customer relies on it.",
    },
    {
      id: "obl-evidence",
      title: "Keep fulfilment evidence for 90 days",
      detail:
        "You must retain proof of fulfilment (tracking, receipt, or handover record) for 90 days after acceptance, and present it if the checkout is disputed.",
    },
    {
      id: "obl-refund-channel",
      title: "Refunds go through the protocol, not around it",
      detail:
        "If you need to give money back to this customer, you request the refund through the protocol so the ledger stays consistent. Off-ledger refunds leave you exposed with no authority record.",
    },
  ],
  evidence: {
    label: "Offer quote receipt (cko_live_offer_001)",
    href: harnessAnchor("cko_live_offer_001"),
  },
  plainLanguageSummary:
    "If you accept, you commit to fulfil intent int_4b8a2e: the customer pays 250.00 EUR, you receive 246.15 EUR on the authority's settlement schedule, you keep fulfilment evidence for 90 days, and chargeback exposure stays with you.",
};

const HIGH_BAND_OFFER: CheckoutOfferView = {
  checkoutId: "cko_high_band_offer_001",
  protocolReference: "pco_c4183d",
  intentReference: "int_77d0f4",
  title: "Checkout quote for customer intent int_77d0f4 — high-band EUR corridor",
  quotedAt: "2026-05-29T14:40:00.000Z",
  validUntil: "2026-06-05T14:40:00.000Z",
  quotedAmounts: [
    {
      key: "customer-pays",
      label: "Customer pays",
      amount: { amountMinorUnits: 750000, currency: "EUR" },
      emphasis: "primary",
      note: "Quoted by the Checkout/Intent Authority. This surface never recomputes it.",
    },
    {
      key: "merchant-receives",
      label: "You receive",
      amount: { amountMinorUnits: 736875, currency: "EUR" },
      emphasis: "primary",
      note: "Quoted by the Checkout/Intent Authority, net of the protocol fee below.",
    },
    {
      key: "protocol-fee",
      label: "Protocol fee",
      amount: { amountMinorUnits: 13125, currency: "EUR" },
      emphasis: "secondary",
      note: "Quoted by the Checkout/Intent Authority as part of the quote.",
    },
  ],
  conditions: [
    {
      id: "cond-high-band-scope",
      title: "This amount band needs the enhanced merchant authorization scope",
      detail:
        "Amounts at or above 7,500.00 EUR route through the enhanced authorization scope (checkout.accept.high-band). If your merchant identity does not hold that scope when you accept, protocol authorization refuses the acceptance and the checkout fails with a recorded reason.",
      material: true,
    },
    {
      id: "cond-high-band-rate-window",
      title: "The quoted figures hold only inside the validity window",
      detail:
        "The quote is valid until 2026-06-05 14:40 UTC. After that the offer lapses and a later acceptance is refused.",
      material: true,
    },
    {
      id: "cond-high-band-settlement",
      title: "Settlement runs on the authority's schedule",
      detail:
        "After the customer's payment is confirmed, your 7,368.75 EUR is scheduled for payout on the next settlement run for this band.",
      material: true,
    },
  ],
  obligations: [
    {
      id: "obl-high-band-fulfil",
      title: "Fulfil the customer's order once acceptance is acknowledged",
      detail:
        "Accepting commits you to fulfil the order described in intent int_77d0f4 at this amount band.",
    },
    {
      id: "obl-high-band-evidence",
      title: "Keep fulfilment evidence for 90 days",
      detail:
        "High-band checkouts are audited more often: retain proof of fulfilment for 90 days and present it on request.",
    },
  ],
  evidence: {
    label: "Offer quote receipt (cko_high_band_offer_001)",
    href: harnessAnchor("cko_high_band_offer_001"),
  },
  plainLanguageSummary:
    "If you accept, you commit to fulfil intent int_77d0f4 at the high band: the customer pays 7,500.00 EUR, you receive 7,368.75 EUR on settlement — but only if protocol authorization grants the high-band scope; if it refuses, the checkout fails with a recorded reason.",
};

const SCENARIOS: readonly ScenarioFixture[] = [
  {
    checkoutId: "cko_live_offer_001",
    label: "Open offer — default live quote",
    description:
      "The merchant's default open offer: decision still required. Accept is acknowledged; decline is recorded.",
    offer: LIVE_OFFER,
    stateRecord: {
      checkoutId: "cko_live_offer_001",
      state: "offered",
      reportedBy: LEDGER_REPORTED_BY,
      at: "2026-05-28T09:15:00.000Z",
      evidence: {
        label: "Offer quote receipt (cko_live_offer_001)",
        href: harnessAnchor("cko_live_offer_001"),
      },
      originatingOfferSummary:
        "Offer pco_9f27c1: customer pays 250.00 EUR, you receive 246.15 EUR, protocol fee 3.85 EUR.",
    },
    decisionScript: {
      accept: {
        followUpCheckoutId: "cko_live_accept_001",
        receiptId: "drc_live_accept_001",
      },
      decline: {
        followUpCheckoutId: "cko_live_decline_001",
        receiptId: "drc_live_decline_001",
      },
    },
  },
  {
    checkoutId: "cko_high_band_offer_001",
    label: "Open offer — high band, authorization will refuse",
    description:
      "A second open offer at the high amount band. Its accept path scripts a protocol-authorization refusal (failed with reason); its decline path is recorded.",
    offer: HIGH_BAND_OFFER,
    stateRecord: {
      checkoutId: "cko_high_band_offer_001",
      state: "offered",
      reportedBy: LEDGER_REPORTED_BY,
      at: "2026-05-29T14:40:00.000Z",
      evidence: {
        label: "Offer quote receipt (cko_high_band_offer_001)",
        href: harnessAnchor("cko_high_band_offer_001"),
      },
      originatingOfferSummary:
        "Offer pco_c4183d: customer pays 7,500.00 EUR, you receive 7,368.75 EUR, protocol fee 131.25 EUR.",
    },
    decisionScript: {
      accept: {
        followUpCheckoutId: "cko_fail_authorization_001",
        receiptId: "drc_high_band_accept_001",
      },
      decline: {
        followUpCheckoutId: "cko_high_band_decline_001",
        receiptId: "drc_high_band_decline_001",
      },
    },
  },
  {
    checkoutId: "cko_live_accept_001",
    label: "Accepted — acknowledged",
    description:
      "The consequential state after the live offer's acceptance is acknowledged by the authority. Evidence receipt reachable.",
    offer: LIVE_OFFER,
    stateRecord: {
      checkoutId: "cko_live_accept_001",
      state: "accepted",
      reportedBy: LEDGER_REPORTED_BY,
      at: "2026-05-28T09:21:07.000Z",
      evidence: {
        label: "Acceptance acknowledgment receipt (cko_live_accept_001)",
        href: harnessAnchor("cko_live_accept_001"),
      },
      originatingOfferId: "cko_live_offer_001",
      originatingOfferSummary:
        "Offer pco_9f27c1 (cko_live_offer_001): customer pays 250.00 EUR, you receive 246.15 EUR, protocol fee 3.85 EUR.",
    },
  },
  {
    checkoutId: "cko_payment_pending_001",
    label: "Accepted — awaiting customer payment confirmation",
    description:
      "Acceptance acknowledged; the checkout is now waiting on the paying-side authority confirming the customer's payment.",
    offer: LIVE_OFFER,
    stateRecord: {
      checkoutId: "cko_payment_pending_001",
      state: "accepted-awaiting-payment",
      reportedBy: LEDGER_REPORTED_BY,
      at: "2026-05-28T10:02:44.000Z",
      evidence: {
        label: "Acceptance + payment-watch record (cko_payment_pending_001)",
        href: harnessAnchor("cko_payment_pending_001"),
      },
      originatingOfferId: "cko_live_offer_001",
      originatingOfferSummary:
        "Offer pco_9f27c1 (cko_live_offer_001): customer pays 250.00 EUR, you receive 246.15 EUR, protocol fee 3.85 EUR.",
      availableActions: [
        "Watch this state page — the authority publishes the payment confirmation here.",
        "Start fulfilment preparation; money has not moved yet.",
        "If the payment window lapses, the authority records the failure with a reason.",
      ],
    },
  },
  {
    checkoutId: "cko_live_decline_001",
    label: "Declined — recorded",
    description:
      "The consequential state after the live offer's decline is recorded by the authority. Decline receipt reachable.",
    offer: LIVE_OFFER,
    stateRecord: {
      checkoutId: "cko_live_decline_001",
      state: "declined",
      reportedBy: LEDGER_REPORTED_BY,
      at: "2026-05-28T09:19:31.000Z",
      evidence: {
        label: "Decline receipt (cko_live_decline_001)",
        href: harnessAnchor("cko_live_decline_001"),
      },
      originatingOfferId: "cko_live_offer_001",
      originatingOfferSummary:
        "Offer pco_9f27c1 (cko_live_offer_001): customer pays 250.00 EUR, you receive 246.15 EUR, protocol fee 3.85 EUR.",
    },
  },
  {
    checkoutId: "cko_high_band_decline_001",
    label: "Declined — recorded (high band)",
    description:
      "The recorded decline for the high-band offer. Distinct receipt from the live offer's decline.",
    offer: HIGH_BAND_OFFER,
    stateRecord: {
      checkoutId: "cko_high_band_decline_001",
      state: "declined",
      reportedBy: LEDGER_REPORTED_BY,
      at: "2026-05-29T15:03:12.000Z",
      evidence: {
        label: "Decline receipt (cko_high_band_decline_001)",
        href: harnessAnchor("cko_high_band_decline_001"),
      },
      originatingOfferId: "cko_high_band_offer_001",
      originatingOfferSummary:
        "Offer pco_c4183d (cko_high_band_offer_001): customer pays 7,500.00 EUR, you receive 7,368.75 EUR, protocol fee 131.25 EUR.",
    },
  },
  {
    checkoutId: "cko_fail_authorization_001",
    label: "Failed — protocol authorization refused the acceptance",
    description:
      "The high-band offer's accept path: protocol authorization refused the acceptance because the merchant identity lacks the high-band scope. Reason and next actions recorded.",
    offer: HIGH_BAND_OFFER,
    stateRecord: {
      checkoutId: "cko_fail_authorization_001",
      state: "failed",
      reportedBy: LEDGER_REPORTED_BY,
      at: "2026-05-29T15:01:58.000Z",
      reason:
        "Protocol authorization refused the acceptance: this amount band requires the enhanced merchant authorization scope (checkout.accept.high-band), which this merchant identity does not currently hold.",
      nextActions: [
        "Request the enhanced scope from the operator before accepting again.",
        "Decline the offer instead — the offer itself stays open until it lapses.",
        "Re-check this page after the scope is granted; the authority records the re-attempt outcome here.",
      ],
      evidence: {
        label: "Authorization refusal record (cko_fail_authorization_001)",
        href: harnessAnchor("cko_fail_authorization_001"),
      },
      originatingOfferId: "cko_high_band_offer_001",
      originatingOfferSummary:
        "Offer pco_c4183d (cko_high_band_offer_001): customer pays 7,500.00 EUR, you receive 7,368.75 EUR, protocol fee 131.25 EUR.",
    },
  },
  {
    checkoutId: "cko_unknown_001",
    label: "UNKNOWN — acceptance outcome undeterminable",
    description:
      "A scripted lost-response path: the acceptance was submitted and routed, but no terminal acknowledgment or failure reached this surface before the response window closed. Reconciliation path recorded.",
    offer: LIVE_OFFER,
    stateRecord: {
      checkoutId: "cko_unknown_001",
      state: "unknown",
      reportedBy: LEDGER_REPORTED_BY,
      at: "2026-05-28T09:24:10.000Z",
      reconciliation: {
        whoResolves:
          "The Checkout/Intent Authority reconciliation job, escalation owner: the operator on duty.",
        recheckTrigger:
          "Re-check this state page after the next reconciliation run (the sandbox simulation publishes every 15 minutes), or when the operator confirms the reconciliation outcome.",
      },
      evidence: {
        label: "Unknown-outcome watch record (cko_unknown_001)",
        href: harnessAnchor("cko_unknown_001"),
      },
      originatingOfferId: "cko_live_offer_001",
      originatingOfferSummary:
        "Offer pco_9f27c1 (cko_live_offer_001): customer pays 250.00 EUR, you receive 246.15 EUR, protocol fee 3.85 EUR.",
    },
  },
  {
    checkoutId: "cko_inflight_accept_001",
    label: "In flight — acceptance submitted, not yet terminal",
    description:
      "The submission window: acceptance routed through protocol authorization, terminal state not yet recorded.",
    offer: LIVE_OFFER,
    stateRecord: {
      checkoutId: "cko_inflight_accept_001",
      state: "accept-submitted",
      reportedBy: LEDGER_REPORTED_BY,
      at: "2026-05-28T09:20:59.000Z",
      evidence: {
        label: "Submission receipt (cko_inflight_accept_001)",
        href: harnessAnchor("cko_inflight_accept_001"),
      },
      originatingOfferId: "cko_live_offer_001",
      originatingOfferSummary:
        "Offer pco_9f27c1 (cko_live_offer_001): customer pays 250.00 EUR, you receive 246.15 EUR, protocol fee 3.85 EUR.",
    },
  },
  {
    checkoutId: "cko_inflight_decline_001",
    label: "In flight — decline submitted, not yet terminal",
    description:
      "The submission window for a decline routed through protocol authorization.",
    offer: LIVE_OFFER,
    stateRecord: {
      checkoutId: "cko_inflight_decline_001",
      state: "decline-submitted",
      reportedBy: LEDGER_REPORTED_BY,
      at: "2026-05-28T09:18:22.000Z",
      evidence: {
        label: "Submission receipt (cko_inflight_decline_001)",
        href: harnessAnchor("cko_inflight_decline_001"),
      },
      originatingOfferId: "cko_live_offer_001",
      originatingOfferSummary:
        "Offer pco_9f27c1 (cko_live_offer_001): customer pays 250.00 EUR, you receive 246.15 EUR, protocol fee 3.85 EUR.",
    },
  },
] as const;

/**
 * Adapter-level error scripts. These are NOT checkout states — they model
 * what the surface shows when the boundary itself cannot answer
 * (AvailabilityUnknown presentation), and exist so the verification harness
 * can exercise those rows too.
 */
export interface MockAdapterErrorScenario {
  readonly checkoutId: CheckoutId;
  readonly error: "checkout-not-found" | "authority-unreachable";
  readonly label: string;
  readonly description: string;
}

export const MOCK_CHECKOUT_ADAPTER_ERROR_SCENARIOS: readonly MockAdapterErrorScenario[] =
  [
    {
      checkoutId: "cko_missing_001",
      error: "checkout-not-found",
      label: "Adapter error — checkout not found",
      description:
        "Requesting a checkout id the mock does not know. The surface answers with the AvailabilityUnknown presentation, never a guessed state.",
    },
    {
      checkoutId: "cko_unreachable_001",
      error: "authority-unreachable",
      label: "Adapter error — authority unreachable",
      description:
        "A scripted unreachable path: the boundary itself cannot answer. AvailabilityUnknown presentation; no consequential claim is made.",
    },
  ] as const;

/** Scenario descriptors the verification harness renders (sandbox data only). */
export interface MockScenarioDescriptor {
  readonly checkoutId: CheckoutId;
  readonly label: string;
  readonly description: string;
  readonly authorityState?: MerchantCheckoutState;
  readonly adapterError?: "checkout-not-found" | "authority-unreachable";
}

export const MOCK_CHECKOUT_SCENARIOS: readonly MockScenarioDescriptor[] = [
  ...SCENARIOS.map((scenario) => ({
    checkoutId: scenario.checkoutId,
    label: scenario.label,
    description: scenario.description,
    authorityState: scenario.stateRecord.state,
  })),
  ...MOCK_CHECKOUT_ADAPTER_ERROR_SCENARIOS.map((errorScenario) => ({
    checkoutId: errorScenario.checkoutId,
    label: errorScenario.label,
    description: errorScenario.description,
    adapterError: errorScenario.error,
  })),
] as const;

// ---------------------------------------------------------------------------
// Deterministic lookups (pure; no mutation, no clock reads)
// ---------------------------------------------------------------------------

const scenarioById = new Map<string, ScenarioFixture>(
  SCENARIOS.map((scenario) => [scenario.checkoutId, scenario]),
);

function resolveRequestedCheckoutId(
  request: CheckoutOfferRequest,
): CheckoutId {
  return request.checkoutId ?? "cko_live_offer_001";
}

function adapterErrorResult(
  error: "checkout-not-found" | "authority-unreachable",
  checkoutId: CheckoutId,
): {
  ok: false;
  error: "checkout-not-found" | "authority-unreachable";
  detail: string;
  reportedBy: string;
  runtime: "ARRIVING";
} {
  if (error === "authority-unreachable") {
    return {
      ok: false,
      error,
      detail:
        "The checkout boundary is scripted unreachable for this checkout id (sandbox simulation). Whether the offer exists or a state is recorded cannot be determined from here — nothing is guessed.",
      reportedBy: REPORTED_BY,
      runtime: MOCK_CHECKOUT_RUNTIME,
    };
  }
  return {
    ok: false,
    error,
    detail: `No checkout is known to the boundary for id '${checkoutId}'. No state is invented for unknown ids.`,
    reportedBy: REPORTED_BY,
    runtime: MOCK_CHECKOUT_RUNTIME,
  };
}

const adapterErrorScenarioFor = (checkoutId: CheckoutId) =>
  MOCK_CHECKOUT_ADAPTER_ERROR_SCENARIOS.find(
    (errorScenario) => errorScenario.checkoutId === checkoutId,
  );

function offerForCheckoutId(checkoutId: CheckoutId): CheckoutOfferResult {
  const errorScenario = adapterErrorScenarioFor(checkoutId);
  if (errorScenario) {
    return adapterErrorResult(errorScenario.error, checkoutId);
  }
  const scenario = scenarioById.get(checkoutId);
  if (!scenario) {
    return adapterErrorResult("checkout-not-found", checkoutId);
  }
  return {
    ok: true,
    offer: scenario.offer,
    reportedBy: REPORTED_BY,
    runtime: MOCK_CHECKOUT_RUNTIME,
  };
}

async function getOffer(
  request: CheckoutOfferRequest,
): Promise<CheckoutOfferResult> {
  return offerForCheckoutId(resolveRequestedCheckoutId(request));
}

async function getStatus(
  request: CheckoutStatusRequest,
): Promise<CheckoutStatusResult> {
  const errorScenario = adapterErrorScenarioFor(request.checkoutId);
  if (errorScenario) {
    return adapterErrorResult(errorScenario.error, request.checkoutId);
  }
  const scenario = scenarioById.get(request.checkoutId);
  if (!scenario) {
    return adapterErrorResult("checkout-not-found", request.checkoutId);
  }
  return {
    ok: true,
    record: scenario.stateRecord,
    runtime: MOCK_CHECKOUT_RUNTIME,
  };
}

async function listOpenCheckouts(): Promise<CheckoutQueueResult> {
  const items: readonly CheckoutQueueItem[] = SCENARIOS.filter(
    (scenario) => scenario.stateRecord.state === "offered",
  ).map((scenario) => {
    const receiveAmount =
      scenario.offer.quotedAmounts.find(
        (amount) => amount.key === "merchant-receives",
      )?.amount ?? { amountMinorUnits: 0, currency: "EUR" };
    return {
      checkoutId: scenario.checkoutId,
      protocolReference: scenario.offer.protocolReference,
      title: scenario.offer.title,
      receiveAmount,
      validUntil: scenario.offer.validUntil,
    };
  });
  return {
    ok: true,
    items,
    reportedBy: REPORTED_BY,
    runtime: MOCK_CHECKOUT_RUNTIME,
  };
}

async function submitDecision(
  request: CheckoutDecisionRequest,
): Promise<CheckoutDecisionResult> {
  const scenario = scenarioById.get(request.checkoutId);
  if (!scenario) {
    return adapterErrorResult("checkout-not-found", request.checkoutId);
  }
  if (scenario.stateRecord.state !== "offered" || !scenario.decisionScript) {
    return {
      ok: false,
      error: "decision-not-allowed",
      detail:
        "This checkout is not waiting for a merchant decision (its state is already recorded by the authority). Decisions are only accepted while the checkout is offered.",
      reportedBy: REPORTED_BY,
      runtime: MOCK_CHECKOUT_RUNTIME,
    };
  }
  const script =
    request.decision === "accept"
      ? scenario.decisionScript.accept
      : scenario.decisionScript.decline;
  const receipt: CheckoutDecisionReceipt = {
    checkoutId: request.checkoutId,
    decision: request.decision,
    receiptId: script.receiptId,
    submittedTo: "protocol authorization path (simulated by the mock)",
    acceptedBy: SUBMISSION_ACCEPTED_BY,
    at: scenario.stateRecord.at,
    routingNote:
      "Explicit single-intent merchant decision routed through protocol authorization. This surface records decisions only via the authority — the UI never applies a decision itself. The consequential state is published under the follow-up checkout id; observe it on the state page.",
  };
  return {
    ok: true,
    receipt,
    followUpCheckoutId: script.followUpCheckoutId,
    followUpHref: `/checkout/${script.followUpCheckoutId}`,
    runtime: MOCK_CHECKOUT_RUNTIME,
  };
}

// ---------------------------------------------------------------------------
// The port implementation (NON-AUTHORITATIVE)
// ---------------------------------------------------------------------------

export const mockCheckoutAuthority: CheckoutPort = {
  runtime: MOCK_CHECKOUT_RUNTIME,
  authorityOwner: MOCK_CHECKOUT_AUTHORITY_OWNER,
  nonAuthoritative: true,
  getOffer,
  getStatus,
  listOpenCheckouts,
  submitDecision,
};
