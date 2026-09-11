import type { NavAudience } from "@/lib/navigation";
import type {
  EvidenceRecordView,
  TrackingBoundaryReport,
  TrackingLookupResult,
  TrackingPort,
  TrackedCurrentState,
  TrackedHistoryEntry,
} from "./tracking-port";

/**
 * UI-005 — mock tracking authority (the adapter-boundary backing).
 *
 * EXPLICITLY NON-AUTHORITATIVE. This mock is presentation-only: it exists so
 * the track/status surfaces can be built, verified, and demonstrated before
 * the live adapter exists. It decides nothing and computes nothing — every
 * state, wording, timestamp, and evidence record is a scripted sandbox
 * session record, shaped exactly like the real answers.
 *
 * Authority owner (per spec/architecture/v0.1):
 *   - Intent Authority — tracked consequential states + plain-language history
 *   - Evidence Authority — proof-trail records
 * Runtime status: ARRIVING (the live tracking adapter replaces this module at
 * getTrackingPort() in ./tracking-port.ts and only there).
 *
 * Sandbox session records: everything below is module-level and resets when
 * the dev server restarts. Nothing is persisted. Nothing here is real money,
 * real users, or real state.
 *
 * Scriptable availability: evidence records can be scripted between
 * 'recorded' and 'no-answer' (see scriptEvidenceAvailability) so the
 * verification harness can exercise the UNKNOWN-record render. Records that
 * never answered carry no recorded payload at all — they can never be
 * scripted into a recorded one (no synthesis, ever).
 */

/** Authority-side money quoting — explicit currency, never computed UI-side. */
function money(amount: string, currency = "EUR"): string {
  return `${amount} ${currency}`;
}

type MockEvidenceAvailability = "recorded" | "no-answer";

interface MockEvidenceRecordSpec {
  readonly recordId: string;
  readonly label: string;
  readonly owningAuthority: string;
  /** Payload when the authority answers for the record. null = never answered. */
  readonly recorded: { readonly recordedAt: string; readonly outcomeWording: string } | null;
  /** Payload when the authority does not answer for the record. */
  readonly noAnswer: {
    readonly explanation: string;
    readonly reconciliation: { readonly whoResolves: string; readonly recheckTrigger: string };
  };
  readonly defaultAvailability: MockEvidenceAvailability;
  /** Whether the verification harness may script this record's availability. */
  readonly scriptable: boolean;
}

interface MockTrackingRecord {
  readonly referenceId: string;
  readonly subjectWording: string;
  readonly subjectKind: string;
  readonly protocolObject: { readonly objectType: string; readonly objectId: string };
  readonly owningAuthority: string;
  readonly authorizedAudiences: readonly NavAudience[];
  readonly viewableByWording: string;
  readonly currentState: TrackedCurrentState;
  /** Oldest first; the port returns most-recent first. */
  readonly history: readonly TrackedHistoryEntry[];
  readonly evidence: readonly MockEvidenceRecordSpec[];
}

const INTENT_AUDIENCES: readonly NavAudience[] = [
  "customer",
  "merchant",
  "operator",
  "administrator",
];

const SETTLEMENT_AUDIENCES: readonly NavAudience[] = [
  "merchant",
  "provider",
  "operator",
  "administrator",
];

const INTENT_VIEWABLE_BY =
  "This reference can be viewed by the customer who owns the payment, the receiving merchant, a PaySwap operator, or a PaySwap administrator.";

const SETTLEMENT_VIEWABLE_BY =
  "This reference can be viewed by the receiving merchant, the provider executing the settlement, a PaySwap operator, or a PaySwap administrator.";

/**
 * Sandbox session records. Every consequential outcome materialized by the
 * surfaces built so far (payment intents, plus the settlement outcome that
 * succeeds them) is represented across the six explicit states. There is no
 * 'pending' anywhere in this data — waiting conditions are WAITING with
 * reason/expectation/actions-or-none; unanswerable conditions are UNKNOWN
 * with a reconciliation path.
 */
const SANDBOX_SESSION_RECORDS: readonly MockTrackingRecord[] = [
  {
    referenceId: "PWS-9QM2",
    subjectWording: `Payment of ${money("18.40")} to Meridian Coffee`,
    subjectKind: "payment intent",
    protocolObject: { objectType: "payment-intent", objectId: "INT-9QM2-1187" },
    owningAuthority: "Intent Authority",
    authorizedAudiences: INTENT_AUDIENCES,
    viewableByWording: INTENT_VIEWABLE_BY,
    currentState: {
      state: "succeeded",
      outcome: `Payment of ${money("18.40")} to Meridian Coffee succeeded — the funds are settled to the merchant.`,
      reportedBy: "Intent Authority",
      evidence: {
        label: "View the proof trail for this payment",
        href: "/track/PWS-9QM2#evidence-ev-9qm2-settlement",
      },
      protocolObject: { objectType: "payment-intent", objectId: "INT-9QM2-1187" },
      owningAuthority: "Intent Authority",
      since: "2025-09-08T14:05:02Z",
    },
    history: [
      {
        entryId: "hi-9qm2-1",
        at: "2025-09-08T13:58:11Z",
        authority: "Intent Authority",
        wording: `The customer created this payment and authorized ${money("18.40")} to Meridian Coffee.`,
      },
      {
        entryId: "hi-9qm2-2",
        at: "2025-09-08T13:58:26Z",
        authority: "Intent Authority",
        wording:
          "The customer's bank authorized the payment. The payment moved to captured.",
      },
      {
        entryId: "hi-9qm2-3",
        at: "2025-09-08T14:02:47Z",
        authority: "Evidence Authority",
        wording: `The provider confirmed capture of ${money("18.40")} for this payment.`,
      },
      {
        entryId: "hi-9qm2-4",
        at: "2025-09-08T14:05:02Z",
        authority: "Intent Authority",
        wording:
          "Settlement to Meridian Coffee's account completed. The payment succeeded.",
      },
    ],
    evidence: [
      {
        recordId: "ev-9qm2-authorization",
        label: "Customer authorization record",
        owningAuthority: "Intent Authority",
        recorded: {
          recordedAt: "2025-09-08T13:58:11Z",
          outcomeWording: `The customer authorized a payment of ${money("18.40")} to Meridian Coffee.`,
        },
        noAnswer: {
          explanation:
            "The Intent Authority has not answered for this record yet; its contents cannot be presented.",
          reconciliation: {
            whoResolves: "Intent Authority",
            recheckTrigger: "A fresh lookup of this reference re-checks the record.",
          },
        },
        defaultAvailability: "recorded",
        scriptable: false,
      },
      {
        recordId: "ev-9qm2-settlement",
        label: "Provider settlement confirmation",
        owningAuthority: "Evidence Authority",
        recorded: {
          recordedAt: "2025-09-08T14:05:02Z",
          outcomeWording: `The provider confirmed settlement of ${money("18.40")} to the merchant's account.`,
        },
        noAnswer: {
          explanation:
            "The Evidence Authority has not answered for this record yet. The record is part of the proof trail, but its contents cannot be presented.",
          reconciliation: {
            whoResolves: "Evidence Authority",
            recheckTrigger:
              "The record is re-checked when the Evidence Authority answers, or on a fresh lookup of this reference.",
          },
        },
        // Scriptable through the verification harness (?evidence=no-answer).
        defaultAvailability: "recorded",
        scriptable: true,
      },
      {
        recordId: "ev-9qm2-receipt",
        label: "Merchant receipt record",
        owningAuthority: "Evidence Authority",
        recorded: {
          recordedAt: "2025-09-08T14:06:19Z",
          outcomeWording: `Meridian Coffee issued a receipt for ${money("18.40")}.`,
        },
        noAnswer: {
          explanation:
            "The Evidence Authority has not answered for this record yet; its contents cannot be presented.",
          reconciliation: {
            whoResolves: "Evidence Authority",
            recheckTrigger: "A fresh lookup of this reference re-checks the record.",
          },
        },
        defaultAvailability: "recorded",
        scriptable: false,
      },
    ],
  },
  {
    referenceId: "PWS-5VBM",
    subjectWording: `Payment of ${money("94.00")} to Harbor Print Studio`,
    subjectKind: "payment intent",
    protocolObject: { objectType: "payment-intent", objectId: "INT-5VBM-2043" },
    owningAuthority: "Intent Authority",
    authorizedAudiences: INTENT_AUDIENCES,
    viewableByWording: INTENT_VIEWABLE_BY,
    currentState: {
      state: "succeeded",
      outcome: `Payment of ${money("94.00")} to Harbor Print Studio succeeded — the funds are settled to the merchant.`,
      reportedBy: "Intent Authority",
      evidence: {
        label: "View the proof trail for this payment",
        href: "/track/PWS-5VBM#evidence-ev-5vbm-settlement",
      },
      protocolObject: { objectType: "payment-intent", objectId: "INT-5VBM-2043" },
      owningAuthority: "Intent Authority",
      since: "2025-09-07T16:44:10Z",
    },
    history: [
      {
        entryId: "hi-5vbm-1",
        at: "2025-09-07T16:39:02Z",
        authority: "Intent Authority",
        wording: `The customer created this payment and authorized ${money("94.00")} to Harbor Print Studio.`,
      },
      {
        entryId: "hi-5vbm-2",
        at: "2025-09-07T16:39:40Z",
        authority: "Intent Authority",
        wording:
          "The customer's bank authorized the payment. The payment moved to captured.",
      },
      {
        entryId: "hi-5vbm-3",
        at: "2025-09-07T16:44:10Z",
        authority: "Intent Authority",
        wording:
          "Settlement to Harbor Print Studio's account completed. The payment succeeded.",
      },
    ],
    evidence: [
      {
        recordId: "ev-5vbm-authorization",
        label: "Customer authorization record",
        owningAuthority: "Intent Authority",
        recorded: {
          recordedAt: "2025-09-07T16:39:02Z",
          outcomeWording: `The customer authorized a payment of ${money("94.00")} to Harbor Print Studio.`,
        },
        noAnswer: {
          explanation:
            "The Intent Authority has not answered for this record yet; its contents cannot be presented.",
          reconciliation: {
            whoResolves: "Intent Authority",
            recheckTrigger: "A fresh lookup of this reference re-checks the record.",
          },
        },
        defaultAvailability: "recorded",
        scriptable: false,
      },
      {
        // FIXED no-answer fixture: the authority never answered for this
        // record, so there is no recorded payload at all — it renders
        // UNKNOWN for the record and can never be scripted into a recorded
        // substitute.
        recordId: "ev-5vbm-settlement",
        label: "Provider settlement confirmation",
        owningAuthority: "Evidence Authority",
        recorded: null,
        noAnswer: {
          explanation:
            "The Evidence Authority has not answered for this record. The record is part of the proof trail, but its contents cannot be presented.",
          reconciliation: {
            whoResolves: "Evidence Authority",
            recheckTrigger:
              "The record is re-checked when the Evidence Authority answers, or on a fresh lookup of this reference.",
          },
        },
        defaultAvailability: "no-answer",
        scriptable: false,
      },
    ],
  },
  {
    referenceId: "PWS-7F3K",
    subjectWording: `Payment of ${money("12.00")} to Meridian Coffee`,
    subjectKind: "payment intent",
    protocolObject: { objectType: "payment-intent", objectId: "INT-7F3K-1188" },
    owningAuthority: "Intent Authority",
    authorizedAudiences: INTENT_AUDIENCES,
    viewableByWording: INTENT_VIEWABLE_BY,
    currentState: {
      state: "waiting",
      whatIsWaiting: `Settlement of ${money("12.00")} to Meridian Coffee — the payment is captured and waiting for the provider's settlement window.`,
      why: "The provider settles captured payments to merchants in scheduled settlement windows; this payment was captured after the day's window closed.",
      whatHappensNext:
        "When the next settlement window completes, this payment moves to succeeded, or to failed with the provider's reason if settlement is rejected.",
      reportedBy: "Intent Authority",
      availableActions: [],
      protocolObject: { objectType: "payment-intent", objectId: "INT-7F3K-1188" },
      owningAuthority: "Intent Authority",
      since: "2025-09-09T09:41:55Z",
    },
    history: [
      {
        entryId: "hi-7f3k-1",
        at: "2025-09-09T09:41:12Z",
        authority: "Intent Authority",
        wording: `The customer created this payment and authorized ${money("12.00")} to Meridian Coffee.`,
      },
      {
        entryId: "hi-7f3k-2",
        at: "2025-09-09T09:41:55Z",
        authority: "Intent Authority",
        wording:
          "The customer's bank authorized the payment. The payment moved to captured and now waits for the next settlement window.",
      },
    ],
    evidence: [
      {
        recordId: "ev-7f3k-authorization",
        label: "Customer authorization record",
        owningAuthority: "Intent Authority",
        recorded: {
          recordedAt: "2025-09-09T09:41:12Z",
          outcomeWording: `The customer authorized a payment of ${money("12.00")} to Meridian Coffee.`,
        },
        noAnswer: {
          explanation:
            "The Intent Authority has not answered for this record yet; its contents cannot be presented.",
          reconciliation: {
            whoResolves: "Intent Authority",
            recheckTrigger: "A fresh lookup of this reference re-checks the record.",
          },
        },
        defaultAvailability: "recorded",
        scriptable: false,
      },
      {
        recordId: "ev-7f3k-settlement",
        label: "Provider settlement confirmation",
        owningAuthority: "Evidence Authority",
        recorded: null,
        noAnswer: {
          explanation:
            "The Evidence Authority has not answered for this record. The settlement window has not completed, so the settlement confirmation does not exist yet.",
          reconciliation: {
            whoResolves: "Evidence Authority",
            recheckTrigger:
              "The record is re-checked when the settlement window completes and the Evidence Authority answers, or on a fresh lookup of this reference.",
          },
        },
        defaultAvailability: "no-answer",
        scriptable: false,
      },
    ],
  },
  {
    referenceId: "STL-4419",
    subjectWording: `Settlement of the day's captured payments to Harbor Print Studio (${money("402.50")} total)`,
    subjectKind: "settlement",
    protocolObject: { objectType: "settlement", objectId: "STL-4419" },
    owningAuthority: "Evidence Authority",
    authorizedAudiences: SETTLEMENT_AUDIENCES,
    viewableByWording: SETTLEMENT_VIEWABLE_BY,
    currentState: {
      state: "waiting",
      whatIsWaiting: `Settlement STL-4419 — the day's captured payments to Harbor Print Studio, ${money("402.50")} as quoted by the Evidence Authority, waiting for the provider's settlement transfer.`,
      why: "The provider transfers settled funds in scheduled windows; this settlement batch was prepared after the current window closed.",
      whatHappensNext:
        "When the provider's settlement window completes, this settlement moves to succeeded, or to failed with the provider's reason if the transfer is rejected.",
      reportedBy: "Evidence Authority",
      availableActions: [
        "Contact PaySwap operations with reference STL-4419 if the settlement is still waiting after the announced window.",
        "Look this settlement up again after the announced settlement window closes.",
      ],
      protocolObject: { objectType: "settlement", objectId: "STL-4419" },
      owningAuthority: "Evidence Authority",
      since: "2025-09-09T14:12:03Z",
    },
    history: [
      {
        entryId: "hi-4419-1",
        at: "2025-09-09T14:10:48Z",
        authority: "Evidence Authority",
        wording: `Settlement batch STL-4419 was prepared from the day's captured payments to Harbor Print Studio, ${money("402.50")} as quoted by the Evidence Authority.`,
      },
      {
        entryId: "hi-4419-2",
        at: "2025-09-09T14:12:03Z",
        authority: "Evidence Authority",
        wording:
          "The settlement batch was submitted to the provider and now waits for the provider's settlement window.",
      },
    ],
    evidence: [
      {
        recordId: "ev-4419-batch",
        label: "Settlement batch record",
        owningAuthority: "Evidence Authority",
        recorded: {
          recordedAt: "2025-09-09T14:10:48Z",
          outcomeWording: `Settlement batch STL-4419 was prepared from the day's captured payments to Harbor Print Studio, ${money("402.50")} as quoted by the Evidence Authority.`,
        },
        noAnswer: {
          explanation:
            "The Evidence Authority has not answered for this record yet; its contents cannot be presented.",
          reconciliation: {
            whoResolves: "Evidence Authority",
            recheckTrigger: "A fresh lookup of this reference re-checks the record.",
          },
        },
        defaultAvailability: "recorded",
        scriptable: false,
      },
      {
        recordId: "ev-4419-transfer",
        label: "Provider transfer request record",
        owningAuthority: "Evidence Authority",
        recorded: {
          recordedAt: "2025-09-09T14:12:03Z",
          outcomeWording:
            "The settlement batch was submitted to the provider for transfer in the provider's next settlement window.",
        },
        noAnswer: {
          explanation:
            "The Evidence Authority has not answered for this record yet; its contents cannot be presented.",
          reconciliation: {
            whoResolves: "Evidence Authority",
            recheckTrigger: "A fresh lookup of this reference re-checks the record.",
          },
        },
        defaultAvailability: "recorded",
        scriptable: false,
      },
    ],
  },
  {
    referenceId: "PWS-2H8D",
    subjectWording: `Payment of ${money("64.00")} to Atlas Bookbindery`,
    subjectKind: "payment intent",
    protocolObject: { objectType: "payment-intent", objectId: "INT-2H8D-3320" },
    owningAuthority: "Intent Authority",
    authorizedAudiences: INTENT_AUDIENCES,
    viewableByWording: INTENT_VIEWABLE_BY,
    currentState: {
      state: "failed",
      outcome: `Payment of ${money("64.00")} to Atlas Bookbindery failed — no funds were taken from the customer.`,
      reportedBy: "Intent Authority",
      reason: "The customer's bank declined the authorization (decline code 51 — insufficient funds).",
      nextActions: [
        "Try the payment again with a different payment method.",
        "Contact Atlas Bookbindery support with reference PWS-2H8D if you still want the order.",
      ],
      protocolObject: { objectType: "payment-intent", objectId: "INT-2H8D-3320" },
      owningAuthority: "Intent Authority",
      since: "2025-09-06T11:20:31Z",
    },
    history: [
      {
        entryId: "hi-2h8d-1",
        at: "2025-09-06T11:19:58Z",
        authority: "Intent Authority",
        wording: `The customer created this payment and authorized ${money("64.00")} to Atlas Bookbindery.`,
      },
      {
        entryId: "hi-2h8d-2",
        at: "2025-09-06T11:20:31Z",
        authority: "Intent Authority",
        wording:
          "The customer's bank declined the authorization with decline code 51 — insufficient funds. The payment failed; no funds were taken.",
      },
    ],
    evidence: [
      {
        recordId: "ev-2h8d-authorization",
        label: "Customer authorization record",
        owningAuthority: "Intent Authority",
        recorded: {
          recordedAt: "2025-09-06T11:19:58Z",
          outcomeWording: `The customer authorized a payment of ${money("64.00")} to Atlas Bookbindery.`,
        },
        noAnswer: {
          explanation:
            "The Intent Authority has not answered for this record yet; its contents cannot be presented.",
          reconciliation: {
            whoResolves: "Intent Authority",
            recheckTrigger: "A fresh lookup of this reference re-checks the record.",
          },
        },
        defaultAvailability: "recorded",
        scriptable: false,
      },
      {
        recordId: "ev-2h8d-decline",
        label: "Provider decline record",
        owningAuthority: "Evidence Authority",
        recorded: {
          recordedAt: "2025-09-06T11:20:31Z",
          outcomeWording:
            "The provider reported decline code 51 — insufficient funds — for the 64.00 EUR authorization request. No funds were captured.",
        },
        noAnswer: {
          explanation:
            "The Evidence Authority has not answered for this record yet; its contents cannot be presented.",
          reconciliation: {
            whoResolves: "Evidence Authority",
            recheckTrigger: "A fresh lookup of this reference re-checks the record.",
          },
        },
        defaultAvailability: "recorded",
        scriptable: false,
      },
    ],
  },
  {
    referenceId: "PWS-4TNN",
    subjectWording: `Payment of ${money("22.50")} to Meridian Coffee`,
    subjectKind: "payment intent",
    protocolObject: { objectType: "payment-intent", objectId: "INT-4TNN-1190" },
    owningAuthority: "Intent Authority",
    authorizedAudiences: INTENT_AUDIENCES,
    viewableByWording: INTENT_VIEWABLE_BY,
    currentState: {
      state: "in-progress",
      whatIsHappening: `The customer's bank is verifying the authorization for this payment of ${money("22.50")} to Meridian Coffee.`,
      whatCompletesIt:
        "The bank's verification answer completes this step: the payment then moves to captured, or to failed with the bank's reason.",
      reportedBy: "Intent Authority",
      protocolObject: { objectType: "payment-intent", objectId: "INT-4TNN-1190" },
      owningAuthority: "Intent Authority",
      since: "2025-09-09T10:03:14Z",
    },
    history: [
      {
        entryId: "hi-4tnn-1",
        at: "2025-09-09T10:02:51Z",
        authority: "Intent Authority",
        wording: `The customer created this payment and authorized ${money("22.50")} to Meridian Coffee.`,
      },
      {
        entryId: "hi-4tnn-2",
        at: "2025-09-09T10:03:14Z",
        authority: "Intent Authority",
        wording:
          "The customer's bank began verification of the authorization. The payment is in progress.",
      },
    ],
    evidence: [
      {
        recordId: "ev-4tnn-authorization",
        label: "Customer authorization record",
        owningAuthority: "Intent Authority",
        recorded: {
          recordedAt: "2025-09-09T10:02:51Z",
          outcomeWording: `The customer authorized a payment of ${money("22.50")} to Meridian Coffee.`,
        },
        noAnswer: {
          explanation:
            "The Intent Authority has not answered for this record yet; its contents cannot be presented.",
          reconciliation: {
            whoResolves: "Intent Authority",
            recheckTrigger: "A fresh lookup of this reference re-checks the record.",
          },
        },
        defaultAvailability: "recorded",
        scriptable: false,
      },
      {
        recordId: "ev-4tnn-verification",
        label: "Provider verification record",
        owningAuthority: "Evidence Authority",
        recorded: {
          recordedAt: "2025-09-09T10:03:14Z",
          outcomeWording:
            "The provider reported that the customer's bank is verifying the 22.50 EUR authorization request.",
        },
        noAnswer: {
          explanation:
            "The Evidence Authority has not answered for this record yet; its contents cannot be presented.",
          reconciliation: {
            whoResolves: "Evidence Authority",
            recheckTrigger: "A fresh lookup of this reference re-checks the record.",
          },
        },
        defaultAvailability: "recorded",
        scriptable: false,
      },
    ],
  },
  {
    referenceId: "PWS-6KLP",
    subjectWording: `Payment of ${money("130.00")} to Loom & Ledger`,
    subjectKind: "payment intent",
    protocolObject: { objectType: "payment-intent", objectId: "INT-6KLP-2761" },
    owningAuthority: "Intent Authority",
    authorizedAudiences: INTENT_AUDIENCES,
    viewableByWording: INTENT_VIEWABLE_BY,
    currentState: {
      state: "unknown",
      subject: `The current state of payment PWS-6KLP (${money("130.00")} to Loom & Ledger)`,
      explanation:
        "The Intent Authority has not answered for this payment's current state. The last answered state was captured, recorded before the settlement window; what happened after that is not yet known.",
      reconciliation: {
        whoResolves: "Intent Authority",
        recheckTrigger:
          "The state is re-checked when the Intent Authority answers for this intent, or on a fresh lookup of this reference.",
      },
      protocolObject: { objectType: "payment-intent", objectId: "INT-6KLP-2761" },
      owningAuthority: "Intent Authority",
      since: "2025-09-08T15:22:09Z",
    },
    history: [
      {
        entryId: "hi-6klp-1",
        at: "2025-09-08T15:21:44Z",
        authority: "Intent Authority",
        wording: `The customer created this payment and authorized ${money("130.00")} to Loom & Ledger.`,
      },
      {
        entryId: "hi-6klp-2",
        at: "2025-09-08T15:22:09Z",
        authority: "Intent Authority",
        wording:
          "The customer's bank authorized the payment. The payment moved to captured. No further answer has been recorded since.",
      },
    ],
    evidence: [
      {
        recordId: "ev-6klp-authorization",
        label: "Customer authorization record",
        owningAuthority: "Intent Authority",
        recorded: {
          recordedAt: "2025-09-08T15:21:44Z",
          outcomeWording: `The customer authorized a payment of ${money("130.00")} to Loom & Ledger.`,
        },
        noAnswer: {
          explanation:
            "The Intent Authority has not answered for this record yet; its contents cannot be presented.",
          reconciliation: {
            whoResolves: "Intent Authority",
            recheckTrigger: "A fresh lookup of this reference re-checks the record.",
          },
        },
        defaultAvailability: "recorded",
        scriptable: false,
      },
      {
        recordId: "ev-6klp-settlement",
        label: "Provider settlement confirmation",
        owningAuthority: "Evidence Authority",
        recorded: null,
        noAnswer: {
          explanation:
            "The Evidence Authority has not answered for this record. The settlement outcome of this payment is not yet known.",
          reconciliation: {
            whoResolves: "Evidence Authority",
            recheckTrigger:
              "The record is re-checked when the Evidence Authority answers, or on a fresh lookup of this reference.",
          },
        },
        defaultAvailability: "no-answer",
        scriptable: false,
      },
    ],
  },
  {
    referenceId: "PWS-8XRQ",
    subjectWording: `Payment of ${money("27.00")} to Meridian Coffee`,
    subjectKind: "payment intent",
    protocolObject: { objectType: "payment-intent", objectId: "INT-8XRQ-1191" },
    owningAuthority: "Intent Authority",
    authorizedAudiences: INTENT_AUDIENCES,
    viewableByWording: INTENT_VIEWABLE_BY,
    currentState: {
      state: "action-required",
      action: `Confirm the payment of ${money("27.00")} to Meridian Coffee to proceed.`,
      reportedBy: "Intent Authority",
      validity: "The intent — and this confirmation — expires 30 minutes after creation.",
      consequenceOfInaction:
        "If the payment is not confirmed in time, the intent expires and no payment takes place; nothing is taken from the customer's account.",
      protocolObject: { objectType: "payment-intent", objectId: "INT-8XRQ-1191" },
      owningAuthority: "Intent Authority",
      since: "2025-09-09T10:14:37Z",
    },
    history: [
      {
        entryId: "hi-8xrq-1",
        at: "2025-09-09T10:14:37Z",
        authority: "Intent Authority",
        wording: `The customer created this payment of ${money("27.00")} to Meridian Coffee and was asked to confirm it.`,
      },
    ],
    evidence: [
      {
        recordId: "ev-8xrq-creation",
        label: "Payment intent creation record",
        owningAuthority: "Intent Authority",
        recorded: {
          recordedAt: "2025-09-09T10:14:37Z",
          outcomeWording: `A payment intent for ${money("27.00")} to Meridian Coffee was created and awaits the customer's confirmation.`,
        },
        noAnswer: {
          explanation:
            "The Intent Authority has not answered for this record yet; its contents cannot be presented.",
          reconciliation: {
            whoResolves: "Intent Authority",
            recheckTrigger: "A fresh lookup of this reference re-checks the record.",
          },
        },
        defaultAvailability: "recorded",
        scriptable: false,
      },
    ],
  },
];

const NOT_FOUND_WORDING =
  "No tracked reference matches the reference entered. Check the reference and enter it again, or ask the party who gave you the reference to confirm it.";

const NOT_AUTHORIZED_WORDING =
  "This reference is tracked, but the current viewer role is not authorized to see it. Nothing about its state, history, or proof is shown.";

/**
 * The mock tracking authority. Presentation-only; the port accessor in
 * ./tracking-port.ts hands this out until the live adapter lands.
 */
class MockTrackingAuthority implements TrackingPort {
  /** Scripted evidence-availability overrides (verification harness). */
  private readonly scriptedEvidence = new Map<string, MockEvidenceAvailability>();

  async lookupReference(reference: string, viewer: NavAudience): Promise<TrackingLookupResult> {
    const normalized = reference.trim().toUpperCase();
    const record = SANDBOX_SESSION_RECORDS.find(
      (candidate) => candidate.referenceId === normalized
    );

    if (record === undefined) {
      return {
        kind: "not-found",
        searchedReference: normalized,
        wording: NOT_FOUND_WORDING,
        reportedBy: "Tracking Authority (mock)",
      };
    }

    if (!record.authorizedAudiences.includes(viewer)) {
      return {
        kind: "not-authorized",
        searchedReference: record.referenceId,
        viewerAudience: viewer,
        viewableBy: record.viewableByWording,
        wording: NOT_AUTHORIZED_WORDING,
        reportedBy: "Tracking Authority (mock)",
      };
    }

    const history = [...record.history].sort((a, b) => b.at.localeCompare(a.at));

    return {
      kind: "tracked",
      view: {
        referenceId: record.referenceId,
        subjectWording: record.subjectWording,
        subjectKind: record.subjectKind,
        protocolObject: record.protocolObject,
        owningAuthority: record.owningAuthority,
        viewerAudience: viewer,
        currentState: record.currentState,
        history,
        evidenceTrail: record.evidence.map((spec) => this.resolveEvidenceRecord(record.referenceId, spec)),
      },
    };
  }

  describeBoundary(): TrackingBoundaryReport {
    return {
      surface: "UI-005 — track/status surface (/track)",
      portModule: "src/lib/protocol/tracking-port.ts",
      backingModule: "src/lib/protocol/mock-tracking-authority.ts",
      backingKind: "mock",
      runtime: "ARRIVING",
      authoritative: false,
      presentationOnly: true,
      authorityOwner:
        "the Intent Authority (tracked consequential states, plain-language history) and the Evidence Authority (proof-trail records)",
      authorityOwnerSource: "spec/architecture/v0.1",
      scriptable: [
        "evidence-record availability: recorded | no-answer (verification harness: ?evidence=no-answer)",
      ],
      note:
        "Presentation-only sandbox session records. Every state, wording, time, and evidence record here is mock data shaped exactly like the real authority answers; none of it is authoritative. The live tracking adapter replaces this backing at getTrackingPort() and only there.",
    };
  }

  /**
   * Script a record's availability (verification only). Records that never
   * answered (recorded === null) cannot be scripted to 'recorded' — there is
   * no recorded payload to reveal, and none is ever synthesized.
   */
  scriptEvidenceAvailability(
    referenceId: string,
    recordId: string,
    availability: MockEvidenceAvailability
  ): boolean {
    const record = SANDBOX_SESSION_RECORDS.find(
      (candidate) => candidate.referenceId === referenceId.trim().toUpperCase()
    );
    const spec = record?.evidence.find((candidate) => candidate.recordId === recordId);
    if (!record || !spec || !spec.scriptable) {
      return false;
    }
    if (availability === "recorded" && spec.recorded === null) {
      return false;
    }
    this.scriptedEvidence.set(`${record.referenceId}:${spec.recordId}`, availability);
    return true;
  }

  /** Clear all scripted availability overrides. */
  resetScripting(): void {
    this.scriptedEvidence.clear();
  }

  /** The currently effective availability for one evidence record. */
  effectiveAvailability(referenceId: string, recordId: string): MockEvidenceAvailability {
    const record = SANDBOX_SESSION_RECORDS.find(
      (candidate) => candidate.referenceId === referenceId.trim().toUpperCase()
    );
    const spec = record?.evidence.find((candidate) => candidate.recordId === recordId);
    if (!record || !spec) {
      return "no-answer";
    }
    return (
      this.scriptedEvidence.get(`${record.referenceId}:${spec.recordId}`) ??
      spec.defaultAvailability
    );
  }

  private resolveEvidenceRecord(
    referenceId: string,
    spec: MockEvidenceRecordSpec
  ): EvidenceRecordView {
    const availability =
      this.scriptedEvidence.get(`${referenceId}:${spec.recordId}`) ?? spec.defaultAvailability;

    if (availability === "recorded" && spec.recorded !== null) {
      return {
        kind: "recorded",
        recordId: spec.recordId,
        label: spec.label,
        owningAuthority: spec.owningAuthority,
        recordedAt: spec.recorded.recordedAt,
        outcomeWording: spec.recorded.outcomeWording,
      };
    }

    return {
      kind: "no-answer",
      recordId: spec.recordId,
      label: spec.label,
      owningAuthority: spec.owningAuthority,
      explanation: spec.noAnswer.explanation,
      reconciliation: spec.noAnswer.reconciliation,
    };
  }
}

/** Verification-only enumeration (the product port exposes no browse-all listing). */
export interface MockReferenceSummary {
  readonly referenceId: string;
  readonly subjectWording: string;
  readonly subjectKind: string;
  readonly state: string;
  readonly authorizedAudiences: readonly NavAudience[];
  readonly note: string;
}

/** Summaries for the verification harness matrix — never used by /track surfaces. */
export const MOCK_REFERENCE_SUMMARIES: readonly MockReferenceSummary[] =
  SANDBOX_SESSION_RECORDS.map((record) => ({
    referenceId: record.referenceId,
    subjectWording: record.subjectWording,
    subjectKind: record.subjectKind,
    state: record.currentState.state,
    authorizedAudiences: record.authorizedAudiences,
    note: `Covers the ${record.currentState.state.replace("-", " ")} display state.`,
  }));

let singleton: MockTrackingAuthority | undefined;

/** The mock authority singleton backing the tracking port. */
export function getMockTrackingAuthority(): MockTrackingAuthority {
  if (singleton === undefined) {
    singleton = new MockTrackingAuthority();
  }
  return singleton;
}
