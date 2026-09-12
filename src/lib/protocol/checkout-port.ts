/**
 * UI-003 — Merchant checkout surface.
 * src/lib/protocol/checkout-port.ts
 *
 * The typed adapter-boundary port for the merchant checkout surface
 * (offer/quote presentation, explicit accept and decline, consequential
 * state presentation). This module declares the surface's data needs as
 * interfaces plus the port accessor, following the adapter-boundary pattern
 * established by UI-002 (intent-port) and UI-004/UI-005 (capability-port /
 * tracking-port).
 *
 * BOUNDARY FACTS (pinned; re-anchored by UI-011):
 * - Authority owner of checkout truth: the Checkout/Intent Authority per
 *   spec/architecture/v0.1 — the re-anchored adapter reads the composed A01
 *   Intent Authority; the area-20 Merchant Authority runtime is RTN wave 2
 *   (not merged) and its absence is stated honestly at the boundary.
 * - Runtime status: LIVE — the composed protocol runtime backs the port
 *   adapter (src/lib/protocol/runtime-checkout-adapter.ts): reads come from
 *   the A01 query API + the real A15 chain, and decisions fail closed
 *   (decision-not-allowed) because the composed runtime exposes no
 *   merchant-decision command surface. Nothing is fabricated.
 * - The surface NEVER computes totals, fees, or exchange figures UI-side.
 *   Every amount rendered by this surface is quoted by the authority and
 *   carried here verbatim. The formatters below are presentation-only
 *   (explicit currency, no arithmetic beyond integer sign/grouping for
 *   display) and follow the UI-002 money pattern from
 *   src/lib/pay-flow/money.ts.
 */

// ---------------------------------------------------------------------------
// Authority identity + runtime
// ---------------------------------------------------------------------------

import { getUnavailableCheckoutPort } from "./unavailable-backing";

/** The authority that owns checkout truth (spec/architecture/v0.1). */
export const CHECKOUT_AUTHORITY_OWNER =
  "Checkout/Intent Authority (spec/architecture/v0.1)" as const;

/**
 * The runtime status of the CHECKOUT authority surface backing this port.
 * Re-anchored note (UI-011): the port's READS are re-anchored to the LIVE
 * composed A01 Intent Authority (real intent terms and states, named in every
 * reportedBy), but the area-20 Merchant Authority runtime (checkout-session
 * semantics, merchant decisions) is RTN wave 2 and NOT merged — so the
 * checkout authority surface itself is still ARRIVING and decisions fail
 * closed with the recorded gap. The pinned status stays honestly ARRIVING.
 */
export type CheckoutRuntimeStatus = "ARRIVING";

/** Pinned runtime status: the area-20 checkout authority surface is ARRIVING (RTN wave 2). */
export const CHECKOUT_PORT_RUNTIME: CheckoutRuntimeStatus = "ARRIVING";

/**
 * The checkout port is not yet authoritative as a whole: its reads are
 * A01-authoritative (named in reportedBy), but its decision semantics have
 * no merged runtime command surface — decisions are refused, never
 * fabricated.
 */
export const CHECKOUT_PORT_IS_AUTHORITATIVE = false as const;

// ---------------------------------------------------------------------------
// Money (authority-quoted; presentation-only formatting)
// ---------------------------------------------------------------------------

/** A money figure quoted by the authority. The surface never computes these. */
export interface AuthorityQuotedMoney {
  /** Integer minor units (e.g. cents) as quoted by the authority. */
  readonly amountMinorUnits: number;
  /** ISO 4217 currency code. Always displayed explicitly. */
  readonly currency: string;
}

/**
 * Presentation-only formatting of an authority-quoted money figure with the
 * currency code explicit. No totals are ever computed UI-side: this function
 * only renders a figure the authority already quoted.
 *
 * Deterministic by construction (pure string operations — no locale, no
 * timezone, no environment-dependent formatting), so server and client
 * render identical strings.
 */
export function formatAuthorityQuotedMoney(
  money: AuthorityQuotedMoney,
): string {
  const sign = money.amountMinorUnits < 0 ? "-" : "";
  const absoluteMinor = Math.abs(Math.trunc(money.amountMinorUnits));
  const majorDigits = String(Math.floor(absoluteMinor / 100));
  const minorDigits = String(absoluteMinor % 100).padStart(2, "0");
  const groupedMajor = majorDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${groupedMajor}.${minorDigits} ${money.currency}`;
}

/**
 * Presentation-only formatting of an authority-quoted ISO-8601 timestamp.
 * Slices the quoted string directly (no Date parsing), so the display is
 * deterministic across server and client and never re-derives time truth.
 */
export function formatAuthorityTimestamp(iso: string): string {
  const [date, time = ""] = iso.split("T");
  const hhmm = time.slice(0, 5);
  return hhmm ? `${date} ${hhmm} UTC` : date;
}

// ---------------------------------------------------------------------------
// Offer / quote shapes
// ---------------------------------------------------------------------------

/** Stable identifier for a merchant checkout object. */
export type CheckoutId = string;

/** A headline money figure of an offer, quoted by the authority. */
export interface QuotedAmount {
  /** Stable key (e.g. 'customer-pays') for stable React lists. */
  readonly key: string;
  /** Plain-language label shown to the merchant. */
  readonly label: string;
  /** The authority-quoted figure, rendered verbatim. */
  readonly amount: AuthorityQuotedMoney;
  /** Emphasis for presentation ordering only; never decision semantics. */
  readonly emphasis: "primary" | "secondary";
  /** Optional authority note attached to the quote. */
  readonly note?: string;
}

/** A decision-relevant condition of the offer. Rendered uncollapsed. */
export interface OfferCondition {
  readonly id: string;
  readonly title: string;
  /** Plain-language consequence text. */
  readonly detail: string;
  /** Material conditions are flagged in words as well as styling. */
  readonly material: boolean;
}

/** An obligation the merchant commits to by accepting. */
export interface OfferObligation {
  readonly id: string;
  readonly title: string;
  /** Plain-language obligation text. */
  readonly detail: string;
}

/** The complete offer/quote presentation the authority provides. */
export interface CheckoutOfferView {
  readonly checkoutId: CheckoutId;
  /** Protocol object reference for the offer/quote. */
  readonly protocolReference: string;
  /** The originating customer intent (UI-002 surface). */
  readonly intentReference: string;
  readonly title: string;
  /** ISO-8601, authority-quoted. */
  readonly quotedAt: string;
  /** ISO-8601 validity deadline, authority-quoted. */
  readonly validUntil: string;
  /** Headline amounts (customer pays / merchant receives / fees…). */
  readonly quotedAmounts: readonly QuotedAmount[];
  /** All decision-relevant conditions. Nothing here may be collapsed. */
  readonly conditions: readonly OfferCondition[];
  /** Obligations the merchant commits to by accepting. */
  readonly obligations: readonly OfferObligation[];
  /** Consequence-first, plain-language summary sentence. */
  readonly plainLanguageSummary: string;
  /** Reachable evidence for the quote itself. */
  readonly evidence: { readonly label: string; readonly href: string };
}

/** One open offer in the merchant queue awaiting an explicit decision. */
export interface CheckoutQueueItem {
  readonly checkoutId: CheckoutId;
  readonly protocolReference: string;
  readonly title: string;
  /** The headline 'you receive' figure, quoted by the authority. */
  readonly receiveAmount: AuthorityQuotedMoney;
  /** ISO-8601 validity deadline, authority-quoted. */
  readonly validUntil: string;
}

// ---------------------------------------------------------------------------
// Checkout state vocabulary
// ---------------------------------------------------------------------------

/**
 * The merchant-checkout state vocabulary owned by the Checkout/Intent
 * Authority. One authority state ↔ exactly one display state (see
 * checkout-state-mapping.ts and spec/product/checkout-mapping-records.md).
 */
export type MerchantCheckoutState =
  /** Offer/quote presented; awaiting an explicit merchant decision. */
  | "offered"
  /** Acceptance submitted; routed through protocol authorization; not yet terminal. */
  | "accept-submitted"
  /** Decline submitted; routed through protocol authorization; not yet terminal. */
  | "decline-submitted"
  /** Acceptance acknowledged and recorded by the authority. */
  | "accepted"
  /** Acceptance acknowledged; now waiting on customer payment confirmation. */
  | "accepted-awaiting-payment"
  /** Decline recorded by the authority. */
  | "declined"
  /** Decision failed; reason recorded by the authority. */
  | "failed"
  /** Outcome undeterminable by this surface; reconciliation required. */
  | "unknown";

/** Reconciliation path for an UNKNOWN checkout state. */
export interface CheckoutReconciliation {
  /** Who owns resolving the UNKNOWN into a terminal state. */
  readonly whoResolves: string;
  /** When/how the merchant should re-check for the resolved outcome. */
  readonly recheckTrigger: string;
}

/** The authority-reported state of a checkout at a point in time. */
export interface CheckoutStateRecord {
  readonly checkoutId: CheckoutId;
  readonly state: MerchantCheckoutState;
  /** The authority component reporting this state. */
  readonly reportedBy: string;
  /** ISO-8601, authority-quoted. */
  readonly at: string;
  /** Present when state === 'failed'. */
  readonly reason?: string;
  /** Authority-suggested next actions when state === 'failed'. */
  readonly nextActions?: readonly string[];
  /** Reachable evidence for consequential outcomes. */
  readonly evidence?: { readonly label: string; readonly href: string };
  /** Present when state === 'unknown'. */
  readonly reconciliation?: CheckoutReconciliation;
  /**
   * Authority-quoted plain-language summary of the originating offer
   * (carried verbatim; never recomposed UI-side).
   */
  readonly originatingOfferSummary?: string;
  /** The id of the offer this record originates from, when applicable. */
  readonly originatingOfferId?: CheckoutId;
  /** Actions available to the merchant while waiting (waiting states). */
  readonly availableActions?: readonly string[];
}

// ---------------------------------------------------------------------------
// Requests + results (the surface's data needs)
// ---------------------------------------------------------------------------

/** Ask for an offer/quote presentation. Omit checkoutId for the default open offer. */
export interface CheckoutOfferRequest {
  readonly checkoutId?: CheckoutId;
}

/** Ask for the current authority-reported state of a checkout. */
export interface CheckoutStatusRequest {
  readonly checkoutId: CheckoutId;
}

/** An explicit, single-intent merchant decision routed through protocol authorization. */
export interface CheckoutDecisionRequest {
  readonly checkoutId: CheckoutId;
  readonly decision: "accept" | "decline";
}

/** Receipt proving the decision was routed through protocol authorization. */
export interface CheckoutDecisionReceipt {
  readonly checkoutId: CheckoutId;
  readonly decision: "accept" | "decline";
  readonly receiptId: string;
  /** Where the decision was submitted (protocol authorization path). */
  readonly submittedTo: string;
  /** Who accepted the submission for routing. */
  readonly acceptedBy: string;
  /** ISO-8601, authority-quoted. */
  readonly at: string;
  /**
   * Explicit routing note: the surface records decisions only through the
   * authority; the UI never applies a decision itself.
   */
  readonly routingNote: string;
}

/** Adapter-level error codes (reachability/identity, not consequential states). */
export type CheckoutPortError =
  | "checkout-not-found"
  | "authority-unreachable"
  | "decision-not-allowed";

interface CheckoutResultErrorShared {
  readonly ok: false;
  readonly error: CheckoutPortError;
  readonly detail: string;
  readonly reportedBy: string;
  readonly runtime: CheckoutRuntimeStatus;
}

export type CheckoutOfferResult =
  | {
      readonly ok: true;
      readonly offer: CheckoutOfferView;
      readonly reportedBy: string;
      readonly runtime: CheckoutRuntimeStatus;
    }
  | CheckoutResultErrorShared;

export type CheckoutStatusResult =
  | {
      readonly ok: true;
      readonly record: CheckoutStateRecord;
      readonly runtime: CheckoutRuntimeStatus;
    }
  | CheckoutResultErrorShared;

export type CheckoutQueueResult =
  | {
      readonly ok: true;
      readonly items: readonly CheckoutQueueItem[];
      readonly reportedBy: string;
      readonly runtime: CheckoutRuntimeStatus;
    }
  | CheckoutResultErrorShared;

export type CheckoutDecisionResult =
  | {
      readonly ok: true;
      readonly receipt: CheckoutDecisionReceipt;
      /** The checkout id under which the consequential state is recorded. */
      readonly followUpCheckoutId: CheckoutId;
      /** Ready-to-navigate observation surface for the resulting state. */
      readonly followUpHref: string;
      readonly runtime: CheckoutRuntimeStatus;
    }
  | CheckoutResultErrorShared;

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/**
 * The typed port the merchant checkout surface consumes. Every consequential
 * value crossing this boundary is authority-reported; the surface adds
 * nothing and computes nothing.
 */
export interface CheckoutPort {
  /** Runtime status of the checkout authority surface (area-20 RTN wave 2: ARRIVING; reads are A01-LIVE — see authorityOwner/reportedBy). */
  readonly runtime: CheckoutRuntimeStatus;
  /** The authority that owns checkout truth. */
  readonly authorityOwner: string;
  /** True while the checkout decision semantics have no merged runtime command surface. */
  readonly nonAuthoritative: true;
  getOffer(request: CheckoutOfferRequest): Promise<CheckoutOfferResult>;
  getStatus(request: CheckoutStatusRequest): Promise<CheckoutStatusResult>;
  listOpenCheckouts(): Promise<CheckoutQueueResult>;
  submitDecision(
    request: CheckoutDecisionRequest,
  ): Promise<CheckoutDecisionResult>;
}

/**
 * The registered runtime-adapter backing (set once per server process by
 * src/lib/protocol/server-runtime.ts); in a browser context no adapter is
 * registered and the honest transport-unavailable backing answers.
 */
let registeredBacking: CheckoutPort | undefined;

/** UI-011 seam: register the server-side runtime adapter as this port's backing. */
export function registerCheckoutPortBacking(backing: CheckoutPort): void {
  registeredBacking = backing;
}

/**
 * Port accessor for the merchant checkout surface. Since UI-011 it returns
 * the registered RUNTIME ADAPTER (A01 reads over the composed runtime;
 * decisions fail closed where no runtime command surface exists); when no
 * adapter is registered in this context (browser), it returns the honest
 * transport-unavailable backing. The surface code never imports a backing
 * directly.
 */
export function getCheckoutPort(): CheckoutPort {
  return registeredBacking ?? getUnavailableCheckoutPort();
}
