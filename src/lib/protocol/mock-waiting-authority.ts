/**
 * Mock waiting authority — UI-006 mock backing for the waiting port.
 *
 * NON-AUTHORITATIVE. This mock is presentation-only: it exists so the
 * waiting/queued/delayed UX on the track surface can be built, verified, and
 * transplanted before the real implementation lands. It NEVER represents
 * financial truth and it NEVER mutates durable financial state.
 *
 * - Authority owner (named per spec/architecture/v0.1, liquidity-credit-queues.md):
 *   the Fulfillment/Queue Authority. When the real service lands, this mock is
 *   replaced behind getWaitingPort() and nothing else changes.
 * - Runtime: ARRIVING.
 * - Data: sandbox scenarios only (stable reference ids below).
 * - Scripting: exposed for the UI-006 verification harness only. The harness
 *   can script fulfillment phases (queued / waiting / delayed / unknown /
 *   resolved). It CANNOT script a recovery: the only path to an accepted
 *   recovery result is requestRecovery(), which assesses authorization per
 *   request and refuses anything not individually authorized per protocol.
 *   Recovery and inquiry outcomes are request results, not scripttable
 *   fulfillment states — scriptWaitingOutcome() rejects them at the type level.
 */

import type {
  WaitingInquiryAvailability,
  WaitingInquiryResult,
  WaitingLookupResult,
  WaitingMoneyQuote,
  WaitingPort,
  WaitingRecoveryAction,
  WaitingRecoveryActionId,
  WaitingRecoveryAuthorization,
  WaitingRecoveryRequestResult,
  WaitingReconciliationPath,
  WaitingSnapshot,
  WaitingViewerRole,
} from "@/lib/protocol/waiting-port";

/** Authority owner named per spec/architecture/v0.1, liquidity-credit-queues.md. */
export const MOCK_WAITING_AUTHORITY_OWNER =
  "Fulfillment/Queue Authority — spec/architecture/v0.1, liquidity-credit-queues.md" as const;

/** Runtime marker: the authority-backed implementation is ARRIVING. */
export const MOCK_WAITING_RUNTIME = "ARRIVING" as const;

/** Non-authoritative note surfaced wherever mock data is presented. */
export const MOCK_WAITING_NON_AUTHORITATIVE_NOTE =
  "Mock backing — presentation-only, NON-AUTHORITATIVE. The Fulfillment/Queue Authority implementation is ARRIVING; sandbox data only.";

/** Who reports every snapshot (the authority, via the mock stand-in). */
const REPORTED_BY = "Fulfillment/Queue Authority";

/** Where protocol authorization is routed (mock stand-in of the real channel). */
const RECOVERY_ROUTE = "Protocol authorization — Fulfillment/Queue Authority (mock backing, ARRIVING)";
const INQUIRY_ROUTE = "Fulfillment/Queue Authority reconciliation sweep (mock backing, ARRIVING)";

// ---------------------------------------------------------------------------
// Fulfillment phases the harness may script (never recovery/inquiry results).
// ---------------------------------------------------------------------------

export type WaitingScriptOutcome =
  | "queued-liquidity-credit"
  | "queued-provider-availability"
  | "waiting-settlement-confirmation"
  | "delayed-liquidity-window"
  | "delayed-provider-backoff"
  | "unknown-pending-reconciliation"
  | "unknown-after-wait-timeout"
  | "resolved-completed"
  | "resolved-failed"
  | "resolved-still-unknown"
  | "queued-minimum-wait-window";

type RecoveryPhase =
  | "queued"
  | "waiting"
  | "delayed"
  | "unknown"
  | "resolved-succeeded"
  | "resolved-failed"
  | "resolved-still-unknown";

// ---------------------------------------------------------------------------
// Scenario templates (authority-reported copy; no invented time estimates).
// ---------------------------------------------------------------------------

interface WaitingScenarioTemplate {
  readonly key: WaitingScriptOutcome;
  readonly phase: RecoveryPhase;
  readonly conditionKind?: "waiting" | "queued" | "delayed";
  readonly whatIsWaiting?: string;
  readonly reason?: string;
  readonly expectation?: string;
  readonly subject?: string;
  readonly explanation?: string;
  readonly waitedFor?: string;
  readonly reconciliation?: WaitingReconciliationPath;
  readonly outcome?: "succeeded" | "failed" | "still-unknown";
  readonly outcomeDetail?: string;
  readonly failureReason?: string;
  readonly nextActions?: readonly string[];
  readonly minimumWaitWindow?: boolean;
  readonly inquiryWhatHappensNext: string;
  readonly inquiryNotAvailableReason?: string;
}

const TEMPLATES: Readonly<Record<WaitingScriptOutcome, WaitingScenarioTemplate>> = {
  "queued-liquidity-credit": {
    key: "queued-liquidity-credit",
    phase: "queued",
    conditionKind: "queued",
    whatIsWaiting: "Liquidity credit allocation that funds the payout",
    reason:
      "The payout entered the liquidity-credit queue before the current credit window opened; the authority has not yet allocated credit to this entry.",
    expectation:
      "When the authority allocates the liquidity credit, the queue releases the payout to settlement and this surface reports the released state.",
    inquiryWhatHappensNext:
      "The Fulfillment/Queue Authority attaches your request to the next reconciliation sweep; the sweep re-checks the authoritative state and this surface reports what it publishes.",
  },
  "queued-provider-availability": {
    key: "queued-provider-availability",
    phase: "queued",
    conditionKind: "queued",
    whatIsWaiting: "Provider availability for the reserved capability slot",
    reason:
      "No provider serving this capability is currently accepting queue entries; the entry waits in the provider-availability queue.",
    expectation:
      "When a serving provider accepts the entry, fulfillment starts and this surface reports the started state.",
    inquiryWhatHappensNext:
      "The Fulfillment/Queue Authority attaches your request to the next reconciliation sweep; the sweep re-checks the authoritative state and this surface reports what it publishes.",
  },
  "waiting-settlement-confirmation": {
    key: "waiting-settlement-confirmation",
    phase: "waiting",
    conditionKind: "waiting",
    whatIsWaiting: "Settlement confirmation for the handed-off payout",
    reason:
      "The payout was handed to settlement confirmation; the settlement authority has not yet published its confirmation record.",
    expectation:
      "When the settlement authority publishes its confirmation record, this surface reports the confirmed outcome.",
    inquiryWhatHappensNext:
      "The Fulfillment/Queue Authority attaches your request to the next reconciliation sweep; the sweep re-checks the authoritative state and this surface reports what it publishes.",
  },
  "delayed-liquidity-window": {
    key: "delayed-liquidity-window",
    phase: "delayed",
    conditionKind: "delayed",
    whatIsWaiting: "Liquidity credit allocation that funds the payout",
    reason:
      "The credit window the authority planned for this entry closed without an allocation; the entry has been re-queued for the next window.",
    expectation:
      "The re-queued entry is evaluated in the next credit window; this surface reports the released or re-delayed state when the authority publishes it.",
    inquiryWhatHappensNext:
      "The Fulfillment/Queue Authority attaches your request to the next reconciliation sweep; the sweep re-checks the authoritative state and this surface reports what it publishes.",
  },
  "delayed-provider-backoff": {
    key: "delayed-provider-backoff",
    phase: "delayed",
    conditionKind: "delayed",
    whatIsWaiting: "Provider retry for the fulfillment slot",
    reason:
      "The serving provider reported a retry backoff after a failed attempt; the authority holds the entry until the backoff releases it for another attempt.",
    expectation:
      "When the backoff releases the entry, the provider retries and this surface reports the retried state.",
    inquiryWhatHappensNext:
      "The Fulfillment/Queue Authority attaches your request to the next reconciliation sweep; the sweep re-checks the authoritative state and this surface reports what it publishes.",
  },
  "unknown-pending-reconciliation": {
    key: "unknown-pending-reconciliation",
    phase: "unknown",
    subject: "The queue position of this fulfillment",
    explanation:
      "The authority's queue report for this entry is pending reconciliation; no authoritative outcome exists yet. This is not a failure and not a success.",
    waitedFor: "The fulfillment was queued; its queue report is now being reconciled.",
    reconciliation: {
      whoResolves: "Fulfillment/Queue Authority reconciliation sweep",
      recheckTrigger: "the next reconciliation sweep of the queue holding this entry",
      whatUserSeesNext:
        "This surface shows the reconciled state when the sweep publishes it; until then it keeps showing this unknown state with the reconciliation path.",
    },
    inquiryWhatHappensNext:
      "Your request attaches to the next reconciliation sweep; the sweep re-checks the authoritative state and this surface reports what it publishes.",
  },
  "unknown-after-wait-timeout": {
    key: "unknown-after-wait-timeout",
    phase: "unknown",
    subject: "The outcome of this fulfillment",
    explanation:
      "The wait for the authority's report timed out without an authoritative outcome; the entry is marked unknown pending reconciliation. This is not a failure and not a success.",
    waitedFor:
      "The fulfillment waited for its authority report; the report did not arrive before the wait closed.",
    reconciliation: {
      whoResolves: "Fulfillment/Queue Authority reconciliation sweep",
      recheckTrigger: "the next reconciliation sweep after the wait closed",
      whatUserSeesNext:
        "This surface shows an explicit terminal state, or an explicitly-still-unknown state with the continuing reconciliation path, when the sweep publishes it.",
    },
    inquiryWhatHappensNext:
      "Your request attaches to the next reconciliation sweep; the sweep re-checks the authoritative state and this surface reports what it publishes.",
  },
  "resolved-completed": {
    key: "resolved-completed",
    phase: "resolved-succeeded",
    outcome: "succeeded",
    outcomeDetail: "The liquidity credit was allocated and the payout settled.",
    inquiryWhatHappensNext: "Not applicable — the fulfillment is complete.",
    inquiryNotAvailableReason: "Fulfillment is complete; there is nothing to re-check.",
  },
  "resolved-failed": {
    key: "resolved-failed",
    phase: "resolved-failed",
    outcome: "failed",
    outcomeDetail: "The fulfillment ended in failure.",
    failureReason:
      "The serving provider exhausted its retry budget and the authority closed the fulfillment.",
    nextActions: [
      "Start a dispute with the merchant of record",
      "Escalate the failure for operator review",
      "Keep this reference for support follow-up",
    ],
    inquiryWhatHappensNext: "Not applicable — the fulfillment ended.",
    inquiryNotAvailableReason:
      "The fulfillment ended in failure; the dispute flow handles follow-ups — this surface does not re-check ended fulfillments.",
  },
  "resolved-still-unknown": {
    key: "resolved-still-unknown",
    phase: "resolved-still-unknown",
    outcome: "still-unknown",
    subject: "The outcome of this fulfillment",
    outcomeDetail:
      "The delayed-fulfillment flow ended and the authoritative outcome is still unknown. This is an explicitly-still-unknown ending, not a dead end: reconciliation continues.",
    reconciliation: {
      whoResolves: "Fulfillment/Queue Authority reconciliation sweep",
      recheckTrigger: "each reconciliation sweep until an authoritative outcome exists",
      whatUserSeesNext:
        "This surface keeps showing the unknown state with the reconciliation path; when an outcome exists it reports the explicit terminal state.",
    },
    inquiryWhatHappensNext:
      "Your request attaches to the next reconciliation sweep; reconciliation continues until an authoritative outcome exists and this surface reports it.",
  },
  "queued-minimum-wait-window": {
    key: "queued-minimum-wait-window",
    phase: "queued",
    conditionKind: "queued",
    minimumWaitWindow: true,
    whatIsWaiting: "Liquidity credit allocation that funds the payout",
    reason:
      "The payout is inside the authority's minimum wait window; the queue has not yet completed its first evaluation of the entry.",
    expectation:
      "The first queue evaluation completes inside the window; after it, this surface reports the evaluated state and any actions that open.",
    inquiryWhatHappensNext: "Not applicable — the minimum wait window is still open.",
    inquiryNotAvailableReason:
      "Inside the minimum wait window the queue has not completed its first evaluation; re-check requests open after the first evaluation.",
  },
};

// ---------------------------------------------------------------------------
// Reference seeds (sandbox data only).
// ---------------------------------------------------------------------------

interface WaitingReferenceSeed {
  readonly referenceId: string;
  readonly scenarioKey: WaitingScriptOutcome;
  readonly intentSummary: string;
  readonly amount: WaitingMoneyQuote;
  readonly reportedAt: string;
  readonly allowedViewerRoles: readonly WaitingViewerRole[];
  readonly inquiryRoles: readonly WaitingViewerRole[];
}

const SEEDS: readonly WaitingReferenceSeed[] = [
  {
    referenceId: "TRK-4410-QUEUED-LIQ",
    scenarioKey: "queued-liquidity-credit",
    intentSummary: "Payout to Coffee Commons, funded by a liquidity credit",
    amount: { value: "132.50", currency: "USD" },
    reportedAt: "2025-09-08T09:15:00Z",
    allowedViewerRoles: ["customer", "merchant", "operator", "administrator"],
    inquiryRoles: ["customer", "merchant"],
  },
  {
    referenceId: "TRK-4411-QUEUED-PROV",
    scenarioKey: "queued-provider-availability",
    intentSummary: "Capability fulfillment waiting for an available provider",
    amount: { value: "480.00", currency: "USD" },
    reportedAt: "2025-09-08T10:02:00Z",
    allowedViewerRoles: ["merchant", "provider", "operator", "administrator"],
    inquiryRoles: ["merchant", "provider"],
  },
  {
    referenceId: "TRK-4412-WAITING-CONFIRM",
    scenarioKey: "waiting-settlement-confirmation",
    intentSummary: "Payout awaiting settlement confirmation",
    amount: { value: "96.20", currency: "USD" },
    reportedAt: "2025-09-08T11:40:00Z",
    allowedViewerRoles: ["customer", "merchant", "operator", "administrator"],
    inquiryRoles: ["customer", "merchant"],
  },
  {
    referenceId: "TRK-4413-DELAYED-LIQ-WINDOW",
    scenarioKey: "delayed-liquidity-window",
    intentSummary: "Payout delayed past its liquidity window",
    amount: { value: "310.00", currency: "USD" },
    reportedAt: "2025-09-08T13:05:00Z",
    allowedViewerRoles: ["customer", "merchant", "operator", "administrator"],
    inquiryRoles: ["customer", "merchant"],
  },
  {
    referenceId: "TRK-4414-DELAYED-PROV-BACKOFF",
    scenarioKey: "delayed-provider-backoff",
    intentSummary: "Capability fulfillment in provider retry backoff",
    amount: { value: "75.00", currency: "USD" },
    reportedAt: "2025-09-08T14:22:00Z",
    allowedViewerRoles: ["merchant", "provider", "operator", "administrator"],
    inquiryRoles: ["merchant", "provider"],
  },
  {
    referenceId: "TRK-4415-UNKNOWN-RECON",
    scenarioKey: "unknown-pending-reconciliation",
    intentSummary: "Payout whose queue position is being reconciled",
    amount: { value: "210.75", currency: "USD" },
    reportedAt: "2025-09-08T15:48:00Z",
    allowedViewerRoles: ["customer", "merchant", "operator", "administrator"],
    inquiryRoles: ["customer", "merchant"],
  },
  {
    referenceId: "TRK-4416-UNKNOWN-TIMEOUT",
    scenarioKey: "unknown-after-wait-timeout",
    intentSummary: "Fulfillment whose wait closed without an authority report",
    amount: { value: "58.40", currency: "USD" },
    reportedAt: "2025-09-08T16:30:00Z",
    allowedViewerRoles: ["customer", "merchant", "operator", "administrator"],
    inquiryRoles: ["customer", "merchant"],
  },
  {
    referenceId: "TRK-4417-RESOLVED-OK",
    scenarioKey: "resolved-completed",
    intentSummary: "Payout completed after a delayed liquidity window",
    amount: { value: "132.50", currency: "USD" },
    reportedAt: "2025-09-09T08:05:00Z",
    allowedViewerRoles: ["customer", "merchant", "provider", "operator", "administrator"],
    inquiryRoles: [],
  },
  {
    referenceId: "TRK-4418-RESOLVED-FAILED",
    scenarioKey: "resolved-failed",
    intentSummary: "Capability fulfillment that ended in failure",
    amount: { value: "75.00", currency: "USD" },
    reportedAt: "2025-09-09T09:12:00Z",
    allowedViewerRoles: ["customer", "merchant", "operator", "administrator"],
    inquiryRoles: [],
  },
  {
    referenceId: "TRK-4419-RESOLVED-STILL-UNKNOWN",
    scenarioKey: "resolved-still-unknown",
    intentSummary: "Fulfillment whose delayed flow ended still unknown",
    amount: { value: "199.99", currency: "USD" },
    reportedAt: "2025-09-09T10:44:00Z",
    allowedViewerRoles: ["customer", "merchant", "provider", "operator", "administrator"],
    inquiryRoles: ["customer", "merchant", "provider"],
  },
  {
    referenceId: "TRK-4420-NO-ACTION",
    scenarioKey: "queued-minimum-wait-window",
    intentSummary: "New payout inside the authority's minimum wait window",
    amount: { value: "25.00", currency: "USD" },
    reportedAt: "2025-09-09T11:20:00Z",
    allowedViewerRoles: ["customer", "merchant", "operator", "administrator"],
    inquiryRoles: [],
  },
  {
    referenceId: "TRK-9000-WAITING-LIVE",
    scenarioKey: "queued-liquidity-credit",
    intentSummary: "Live-scripted fulfillment for the waiting flow verification harness",
    amount: { value: "64.30", currency: "USD" },
    reportedAt: "2025-09-09T12:00:00Z",
    allowedViewerRoles: ["customer", "merchant", "provider", "operator", "administrator"],
    inquiryRoles: ["customer", "merchant", "provider"],
  },
];

/** Summary of the sandbox references, for the verification harness. */
export interface MockWaitingReferenceSummary {
  readonly referenceId: string;
  readonly scenarioKey: WaitingScriptOutcome;
  readonly intentSummary: string;
  readonly allowedViewerRoles: readonly WaitingViewerRole[];
}

export const MOCK_WAITING_REFERENCES: readonly MockWaitingReferenceSummary[] =
  SEEDS.map((seed) => ({
    referenceId: seed.referenceId,
    scenarioKey: seed.scenarioKey,
    intentSummary: seed.intentSummary,
    allowedViewerRoles: seed.allowedViewerRoles,
  }));

// ---------------------------------------------------------------------------
// Scriptable state (verification harness only).
// ---------------------------------------------------------------------------

const scenarioOverrides = new Map<string, WaitingScriptOutcome>();

export interface MockWaitingRequestLogEntry {
  readonly index: number;
  readonly kind: "recovery" | "inquiry";
  readonly referenceId: string;
  readonly actionId?: WaitingRecoveryActionId;
  readonly requestedByRole: WaitingViewerRole;
  readonly result: "accepted" | "denied" | "rejected";
  readonly reason?: string;
}

const requestLog: MockWaitingRequestLogEntry[] = [];
let logCounter = 0;

/**
 * Script a fulfillment phase for a known sandbox reference. Fulfillment phases
 * only: recovery and inquiry outcomes are request results, never scripttable
 * states, so an unauthorized (or any) recovery can never be scripted here.
 */
export function scriptWaitingOutcome(
  referenceId: string,
  outcome: WaitingScriptOutcome,
): void {
  const seed = SEEDS.find((candidate) => candidate.referenceId === referenceId);
  if (!seed) {
    throw new Error(`Unknown sandbox reference: ${referenceId}`);
  }
  scenarioOverrides.set(referenceId, outcome);
}

/** Clear all scripting and the request log (verification harness reset). */
export function clearWaitingScriptting(): void {
  scenarioOverrides.clear();
  requestLog.length = 0;
}

/** Readonly copy of the mock request log (evidence: requests log, never mutate). */
export function getMockWaitingRequestLog(): readonly MockWaitingRequestLogEntry[] {
  return [...requestLog];
}

function resolveScenario(referenceId: string): { seed: WaitingReferenceSeed; template: WaitingScenarioTemplate } | null {
  const seed = SEEDS.find((candidate) => candidate.referenceId === referenceId);
  if (!seed) return null;
  const key = scenarioOverrides.get(referenceId) ?? seed.scenarioKey;
  return { seed, template: TEMPLATES[key] };
}

// ---------------------------------------------------------------------------
// Per-protocol recovery authorization (simulated by the mock; the real
// assessment lives behind protocol authorization when it ARRIVES).
// ---------------------------------------------------------------------------

const RECOVERY_ACTION_META: Readonly<
  Record<WaitingRecoveryActionId, { label: string; description: string; requestedEffect: string }>
> = {
  retry: {
    label: "Request retry",
    description:
      "Ask the Fulfillment/Queue Authority to re-evaluate this queue entry. Requesting does not itself change any financial state; the authority decides and reports the outcome here.",
    requestedEffect: "Re-evaluate the queue entry",
  },
  cancel: {
    label: "Request cancel",
    description:
      "Ask to stop the fulfillment while the protocol cancellation window is open. Requesting does not itself change any financial state; the authority decides and reports the outcome here.",
    requestedEffect: "Stop the fulfillment before handoff",
  },
  escalate: {
    label: "Escalate to operator review",
    description:
      "Route this fulfillment to operator review. Requesting does not itself change any financial state; the reviewer decides and reports the outcome here.",
    requestedEffect: "Operator review of this fulfillment",
  },
};

function authorized(basis: string): WaitingRecoveryAuthorization {
  return { status: "authorized", basis };
}

function notAuthorized(reason: string): WaitingRecoveryAuthorization {
  return { status: "not-authorized", reason };
}

function assessRetry(
  phase: RecoveryPhase,
  minimumWaitWindow: boolean,
  role: WaitingViewerRole,
): WaitingRecoveryAuthorization {
  if (minimumWaitWindow && phase === "queued") {
    return notAuthorized(
      "Inside the authority's minimum wait window, re-queue evaluation is not requestable yet; it opens after the first queue evaluation.",
    );
  }
  switch (phase) {
    case "unknown":
    case "resolved-still-unknown":
      return notAuthorized(
        "While the authoritative state is unknown, no recovery action is taken; reconciliation reports first.",
      );
    case "resolved-succeeded":
      return notAuthorized("The fulfillment completed; retry does not apply.");
    case "resolved-failed":
      return notAuthorized(
        "The fulfillment ended in failure; the dispute flow handles follow-ups, not retry.",
      );
    case "queued":
    case "waiting":
    case "delayed":
      switch (role) {
        case "customer":
          return notAuthorized(
            "Customers do not request re-queue evaluation directly; the merchant of record routes it, or support escalation does.",
          );
        case "provider":
          return notAuthorized(
            "Providers do not initiate retry on queues they serve; the queue authority re-evaluates.",
          );
        case "merchant":
          return authorized("Protocol queue re-evaluation request — merchant of record.");
        case "operator":
          return authorized("Operator console action — queue re-evaluation request.");
        case "administrator":
          return authorized("Administrator channel — queue re-evaluation request.");
      }
  }
}

function assessCancel(
  phase: RecoveryPhase,
  minimumWaitWindow: boolean,
  role: WaitingViewerRole,
): WaitingRecoveryAuthorization {
  if (phase === "queued") {
    if (minimumWaitWindow) {
      return notAuthorized(
        "Inside the authority's minimum wait window the queue has not completed its first evaluation; cancellation opens after the first evaluation.",
      );
    }
    switch (role) {
      case "customer":
        return authorized(
          "Protocol cancellation window — the customer may cancel before the queue hands the fulfillment off.",
        );
      case "merchant":
        return authorized(
          "Protocol cancellation window — the merchant of record may cancel before handoff.",
        );
      case "provider":
        return notAuthorized("Providers cannot cancel a fulfillment they may be assigned to serve.");
      case "operator":
        return notAuthorized("Cancellation is a party action; operators route recoveries from the console.");
      case "administrator":
        return notAuthorized(
          "Cancellation is a party action; administrators route recoveries through the operator channel.",
        );
    }
  }
  switch (phase) {
    case "waiting":
      return notAuthorized(
        "The cancellation window closed when the queue handed the fulfillment to settlement confirmation.",
      );
    case "delayed":
      return notAuthorized(
        "The cancellation window closed when the queue handed the fulfillment onward; the dispute flow handles stopped fulfillments.",
      );
    case "unknown":
    case "resolved-still-unknown":
      return notAuthorized(
        "While the authoritative state is unknown, no recovery action is taken; reconciliation reports first.",
      );
    case "resolved-succeeded":
      return notAuthorized("The fulfillment completed; cancellation does not apply.");
    case "resolved-failed":
      return notAuthorized(
        "The fulfillment already ended; the dispute flow handles stopped fulfillments.",
      );
  }
}

function assessEscalate(
  phase: RecoveryPhase,
  minimumWaitWindow: boolean,
  role: WaitingViewerRole,
): WaitingRecoveryAuthorization {
  if (minimumWaitWindow && phase === "queued") {
    return notAuthorized(
      "Inside the authority's minimum wait window escalation is not requestable yet; it opens after the first evaluation if the entry is still unresolved.",
    );
  }
  if (phase === "resolved-succeeded") {
    return notAuthorized("The fulfillment completed; there is nothing to escalate.");
  }
  switch (role) {
    case "customer":
    case "merchant":
      return authorized("Protocol escalation channel — any party to the fulfillment may escalate to operator review.");
    case "provider":
      if (phase === "resolved-failed") {
        return notAuthorized(
          "The provider is party to the failure review; the customer or merchant of record files the escalation.",
        );
      }
      return authorized("Protocol escalation channel — any party to the fulfillment may escalate to operator review.");
    case "operator":
      return notAuthorized("Operators are the escalation destination; route the review from the operator console.");
    case "administrator":
      return authorized("Administrators may escalate on behalf of any party.");
  }
}

function buildRecoveryActions(
  template: WaitingScenarioTemplate,
  role: WaitingViewerRole,
): readonly WaitingRecoveryAction[] {
  const phase = template.phase;
  const window = template.minimumWaitWindow === true;
  const actionIds: readonly WaitingRecoveryActionId[] = ["retry", "cancel", "escalate"];
  return actionIds.map((actionId) => ({
    actionId,
    ...RECOVERY_ACTION_META[actionId],
    authorization:
      actionId === "retry"
        ? assessRetry(phase, window, role)
        : actionId === "cancel"
          ? assessCancel(phase, window, role)
          : assessEscalate(phase, window, role),
  }));
}

function buildInquiry(
  seed: WaitingReferenceSeed,
  template: WaitingScenarioTemplate,
  role: WaitingViewerRole,
): WaitingInquiryAvailability {
  if (!seed.inquiryRoles.includes(role)) {
    return {
      available: false,
      notAvailableReason:
        template.inquiryNotAvailableReason ??
        "Your current role does not request re-checks on this reference through this surface.",
      whatHappensNext: "Re-check requests are not available to this role for this reference.",
    };
  }
  return {
    available: true,
    whatHappensNext: template.inquiryWhatHappensNext,
  };
}

function buildSnapshot(
  seed: WaitingReferenceSeed,
  template: WaitingScenarioTemplate,
  viewerRole: WaitingViewerRole,
): WaitingSnapshot {
  const base = {
    referenceId: seed.referenceId,
    intentSummary: seed.intentSummary,
    amount: seed.amount,
    viewerRole,
    allowedViewerRoles: seed.allowedViewerRoles,
    reportedBy: REPORTED_BY,
    reportedAt: seed.reportedAt,
    recovery: buildRecoveryActions(template, viewerRole),
    inquiry: buildInquiry(seed, template, viewerRole),
  };

  if (template.phase === "unknown") {
    return {
      ...base,
      snapshotKind: "unknown",
      authorityStateId:
        template.key === "unknown-pending-reconciliation"
          ? "fq.unknown.pending-reconciliation"
          : "fq.unknown.after-wait-timeout",
      subject: template.subject ?? "The outcome of this fulfillment",
      explanation: template.explanation ?? "",
      waitedFor: template.waitedFor ?? "",
      reconciliation: template.reconciliation ?? {
        whoResolves: "Fulfillment/Queue Authority reconciliation sweep",
        recheckTrigger: "the next reconciliation sweep",
        whatUserSeesNext: "This surface reports what the sweep publishes.",
      },
      authorityNote: "The authority has not published an outcome; no estimate is implied by this view.",
    };
  }

  if (
    template.phase === "resolved-succeeded" ||
    template.phase === "resolved-failed" ||
    template.phase === "resolved-still-unknown"
  ) {
    return {
      ...base,
      snapshotKind: "resolution",
      authorityStateId:
        template.phase === "resolved-succeeded"
          ? "fq.resolved.completed"
          : template.phase === "resolved-failed"
            ? "fq.resolved.failed"
            : "fq.resolved.still-unknown",
      outcome: template.outcome ?? "still-unknown",
      subject: template.subject,
      outcomeDetail: template.outcomeDetail ?? "",
      evidence:
        template.outcome === "succeeded"
          ? [
              {
                label: "Settlement confirmation (mock evidence)",
                href: `/track/${seed.referenceId}`,
              },
            ]
          : undefined,
      failureReason: template.failureReason,
      nextActions: template.nextActions,
      reconciliation: template.reconciliation,
      authorityNote:
        template.outcome === "still-unknown"
          ? "The flow ended explicitly still-unknown; reconciliation continues and stays visible."
          : undefined,
    };
  }

  return {
    ...base,
    snapshotKind: "condition",
    authorityStateId: conditionStateId(template.key),
    conditionKind: template.conditionKind ?? "queued",
    whatIsWaiting: template.whatIsWaiting ?? "",
    reason: template.reason ?? "",
    expectation: template.expectation ?? "",
    authorityNote:
      template.minimumWaitWindow === true
        ? "No user action is available yet. The authority has not published a completion estimate."
        : "The authority has not published a completion estimate for this entry.",
  };
}

function conditionStateId(
  key: WaitingScriptOutcome,
):
  | "fq.queued.liquidity-credit"
  | "fq.queued.provider-availability"
  | "fq.waiting.settlement-confirmation"
  | "fq.delayed.liquidity-window"
  | "fq.delayed.provider-backoff" {
  switch (key) {
    case "queued-liquidity-credit":
    case "queued-minimum-wait-window":
      return "fq.queued.liquidity-credit";
    case "queued-provider-availability":
      return "fq.queued.provider-availability";
    case "waiting-settlement-confirmation":
      return "fq.waiting.settlement-confirmation";
    case "delayed-liquidity-window":
      return "fq.delayed.liquidity-window";
    case "delayed-provider-backoff":
      return "fq.delayed.provider-backoff";
    default:
      throw new Error(`Scenario key ${key} is not a condition`);
  }
}

// ---------------------------------------------------------------------------
// Accepted-request payloads (request results; they never mutate phases).
// ---------------------------------------------------------------------------

const RECOVERY_ACCEPTED: Readonly<
  Record<
    WaitingRecoveryActionId,
    {
      routedTo: string;
      whatHappensNext: string;
      whatUserSeesNext: string;
    }
  >
> = {
  retry: {
    routedTo: RECOVERY_ROUTE,
    whatHappensNext:
      "The authority re-evaluates the queue entry and publishes its decision. Requesting did not change any financial state.",
    whatUserSeesNext: "This surface reports the re-evaluated state when the authority publishes it.",
  },
  cancel: {
    routedTo: RECOVERY_ROUTE,
    whatHappensNext:
      "The authority evaluates the cancellation request under the protocol window. Requesting did not change any financial state.",
    whatUserSeesNext:
      "This surface reports the stopped state, or the window-closed denial, when the authority publishes it.",
  },
  escalate: {
    routedTo: "Protocol authorization — operator review (mock backing, ARRIVING)",
    whatHappensNext:
      "The escalation routes to operator review. Requesting did not change any financial state.",
    whatUserSeesNext: "This surface reports the review outcome when the reviewer publishes it.",
  },
};

// ---------------------------------------------------------------------------
// The port instance (NON-AUTHORITATIVE mock backing).
// ---------------------------------------------------------------------------

function logRecovery(
  request: { referenceId: string; actionId: WaitingRecoveryActionId; requestedByRole: WaitingViewerRole },
  result: "accepted" | "denied",
  reason?: string,
): void {
  logCounter += 1;
  requestLog.push({
    index: logCounter,
    kind: "recovery",
    referenceId: request.referenceId,
    actionId: request.actionId,
    requestedByRole: request.requestedByRole,
    result,
    reason,
  });
}

export const mockWaitingAuthority: WaitingPort = {
  runtime: MOCK_WAITING_RUNTIME,
  authorityOwner: MOCK_WAITING_AUTHORITY_OWNER,
  nonAuthoritative: true,

  lookupWaiting(referenceId: string, viewerRole: WaitingViewerRole): WaitingLookupResult {
    const resolved = resolveScenario(referenceId);
    if (!resolved) {
      return { status: "not-found", referenceId };
    }
    if (!resolved.seed.allowedViewerRoles.includes(viewerRole)) {
      return {
        status: "role-denied",
        referenceId,
        viewerRole,
        allowedViewerRoles: resolved.seed.allowedViewerRoles,
      };
    }
    return { status: "found", snapshot: buildSnapshot(resolved.seed, resolved.template, viewerRole) };
  },

  requestRecheck(request): WaitingInquiryResult {
    const resolved = resolveScenario(request.referenceId);
    if (!resolved) {
      return {
        status: "rejected",
        authorityStateId: "fq.inquiry.rejected",
        referenceId: request.referenceId,
        reason: "No waiting record exists for this reference in the mock backing (ARRIVING).",
      };
    }
    const { seed, template } = resolved;
    if (!seed.allowedViewerRoles.includes(request.requestedByRole)) {
      logRecoveryLikeInquiry(request, "rejected", "Role not permitted for this reference.");
      return {
        status: "rejected",
        authorityStateId: "fq.inquiry.rejected",
        referenceId: request.referenceId,
        reason: "Your current role is not permitted to view this reference; the request was not routed.",
      };
    }
    if (!seed.inquiryRoles.includes(request.requestedByRole)) {
      logRecoveryLikeInquiry(request, "rejected", template.inquiryNotAvailableReason ?? "Inquiry not available.");
      return {
        status: "rejected",
        authorityStateId: "fq.inquiry.rejected",
        referenceId: request.referenceId,
        reason:
          template.inquiryNotAvailableReason ??
          "Your current role does not request re-checks on this reference through this surface.",
      };
    }
    logRecoveryLikeInquiry(request, "accepted");
    return {
      status: "accepted",
      authorityStateId: "fq.inquiry.recheck-requested",
      referenceId: request.referenceId,
      routedTo: INQUIRY_ROUTE,
      whoResolves: "Fulfillment/Queue Authority reconciliation sweep",
      recheckTrigger: "the next reconciliation sweep of the queue holding this entry",
      whatHappensNext:
        "Your request attaches to the next reconciliation sweep; the sweep re-checks the authoritative state.",
      whatUserSeesNext:
        "This surface reports what the sweep publishes — an explicit terminal state, or explicitly-still-unknown with the continuing reconciliation path. No completion time is estimated.",
    };
  },

  requestRecovery(request): WaitingRecoveryRequestResult {
    const resolved = resolveScenario(request.referenceId);
    if (!resolved) {
      const reason = "No waiting record exists for this reference in the mock backing (ARRIVING).";
      logRecovery(request, "denied", reason);
      return {
        status: "denied",
        authorityStateId: "fq.recovery.denied",
        referenceId: request.referenceId,
        actionId: request.actionId,
        reason,
      };
    }
    const { seed, template } = resolved;
    if (!seed.allowedViewerRoles.includes(request.requestedByRole)) {
      const reason =
        "Your current role is not permitted to view this reference; no recovery request was routed.";
      logRecovery(request, "denied", reason);
      return {
        status: "denied",
        authorityStateId: "fq.recovery.denied",
        referenceId: request.referenceId,
        actionId: request.actionId,
        reason,
      };
    }
    const actions = buildRecoveryActions(template, request.requestedByRole);
    const action = actions.find((candidate) => candidate.actionId === request.actionId);
    if (!action || action.authorization.status !== "authorized") {
      // The mock NEVER scripts an unauthorized recovery: the only acceptance
      // path is per-request protocol authorization, assessed above.
      const reason =
        action && action.authorization.status === "not-authorized"
          ? action.authorization.reason
          : "Unknown recovery action.";
      logRecovery(request, "denied", reason);
      return {
        status: "denied",
        authorityStateId: "fq.recovery.denied",
        referenceId: request.referenceId,
        actionId: request.actionId,
        reason,
      };
    }
    const accepted = RECOVERY_ACCEPTED[request.actionId];
    logRecovery(request, "accepted");
    return {
      status: "accepted",
      authorityStateId: `fq.recovery.${request.actionId}-requested` as
        | "fq.recovery.retry-requested"
        | "fq.recovery.cancel-requested"
        | "fq.recovery.escalate-requested",
      referenceId: request.referenceId,
      actionId: request.actionId,
      routedTo: accepted.routedTo,
      whatHappensNext: accepted.whatHappensNext,
      whatUserSeesNext: accepted.whatUserSeesNext,
    };
  },
};

function logRecoveryLikeInquiry(
  request: { referenceId: string; requestedByRole: WaitingViewerRole },
  result: "accepted" | "rejected",
  reason?: string,
): void {
  logCounter += 1;
  requestLog.push({
    index: logCounter,
    kind: "inquiry",
    referenceId: request.referenceId,
    requestedByRole: request.requestedByRole,
    result,
    reason,
  });
}
