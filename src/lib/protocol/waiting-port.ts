/**
 * Waiting port — UI-006 typed port for waiting/queued/delayed fulfillment UX.
 *
 * Adapter-boundary pattern (proven by intent-port UI-002, capability-port
 * UI-004, tracking-port UI-005, checkout-port UI-003): this module declares the
 * track surface's waiting data needs as typed interfaces plus a port accessor.
 * `getWaitingPort()` currently returns the NON-AUTHORITATIVE mock backing
 * (src/lib/protocol/mock-waiting-authority.ts).
 *
 * - Authority owner: the Fulfillment/Queue Authority
 *   (spec/architecture/v0.1, liquidity-credit-queues.md).
 * - Runtime: ARRIVING — the authority-backed implementation lands with the
 *   fulfillment/queue service; until then every value here is presentation-only
 *   sandbox data.
 *
 * Hard boundaries honored by every consumer of this port:
 * - Waiting, queued, and delayed are distinct authority-reported conditions,
 *   each carrying a reason, an expectation, and available recovery actions or
 *   an explicit "no action is available yet".
 * - Time and progress claims are authority-quoted only; consumers never invent
 *   estimates and never present invented estimates as authoritative.
 * - UNKNOWN after a wait is surfaced as unknown with its reconciliation path —
 *   who re-checks, what triggers the re-check, what the user sees next — never
 *   as failure or success.
 * - Delayed-fulfillment flows end in explicit terminal states or
 *   explicitly-still-unknown states; there are no dead ends and no indefinite
 *   ambiguous spinners.
 * - Recovery actions (retry, cancel, escalate) are individually authorized per
 *   protocol; requests route through protocol authorization and never silently
 *   mutate durable financial state.
 */

import {
  MOCK_WAITING_AUTHORITY_OWNER,
  MOCK_WAITING_RUNTIME,
  mockWaitingAuthority,
} from "@/lib/protocol/mock-waiting-authority";

/** Owning authority for everything this port reports. */
export const WAITING_PORT_AUTHORITY_OWNER = MOCK_WAITING_AUTHORITY_OWNER;

/** Runtime status of the authority-backed implementation. */
export const WAITING_PORT_RUNTIME_STATUS = MOCK_WAITING_RUNTIME;

/** Roles that may view waiting detail, mirroring the shell audience grammar. */
export type WaitingViewerRole =
  | "customer"
  | "merchant"
  | "provider"
  | "operator"
  | "administrator";

/** The three distinct, explicit fulfillment conditions this surface presents. */
export type WaitingConditionKind = "waiting" | "queued" | "delayed";

/** Protocol recovery verbs. Each is individually authorized per request. */
export type WaitingRecoveryActionId = "retry" | "cancel" | "escalate";

/**
 * Authority state vocabulary reported by the Fulfillment/Queue Authority.
 * Every id maps one-to-one to a display presentation in
 * src/lib/protocol/waiting-state-mapping.ts and to a nine-question mapping
 * record in spec/product/waiting-mapping-records.md.
 */
export type WaitingAuthorityStateId =
  // Conditions (waiting / queued / delayed).
  | "fq.queued.liquidity-credit"
  | "fq.queued.provider-availability"
  | "fq.waiting.settlement-confirmation"
  | "fq.delayed.liquidity-window"
  | "fq.delayed.provider-backoff"
  // UNKNOWN with reconciliation.
  | "fq.unknown.pending-reconciliation"
  | "fq.unknown.after-wait-timeout"
  // Endings of delayed-fulfillment flows (explicit terminal / still-unknown).
  | "fq.resolved.completed"
  | "fq.resolved.failed"
  | "fq.resolved.still-unknown"
  // Recovery request outcomes (consequential states).
  | "fq.recovery.retry-requested"
  | "fq.recovery.cancel-requested"
  | "fq.recovery.escalate-requested"
  | "fq.recovery.denied"
  // Inquiry (re-check request) outcomes (consequential states).
  | "fq.inquiry.recheck-requested"
  | "fq.inquiry.rejected";

/** Authority-quoted money. Consumers format with formatMoney; they never compute. */
export interface WaitingMoneyQuote {
  /** Authority-quoted decimal string, e.g. "132.50". */
  readonly value: string;
  readonly currency: "USD";
}

/** Per-action authorization as assessed per protocol for the current viewer. */
export type WaitingRecoveryAuthorization =
  | { readonly status: "authorized"; readonly basis: string }
  | { readonly status: "not-authorized"; readonly reason: string };

/** A recovery action as reported for the current viewer of a reference. */
export interface WaitingRecoveryAction {
  readonly actionId: WaitingRecoveryActionId;
  readonly label: string;
  readonly description: string;
  /** What the action requests at the protocol level (a request, never a mutation). */
  readonly requestedEffect: string;
  readonly authorization: WaitingRecoveryAuthorization;
}

/**
 * Reconciliation visibility for UNKNOWN states: who re-checks, what triggers
 * the re-check, and what the user will see next.
 */
export interface WaitingReconciliationPath {
  readonly whoResolves: string;
  readonly recheckTrigger: string;
  readonly whatUserSeesNext: string;
}

/**
 * Whether the current viewer may request a re-check through this surface,
 * with the authority's explicit "what happens next" wording.
 */
export interface WaitingInquiryAvailability {
  readonly available: boolean;
  readonly notAvailableReason?: string;
  readonly whatHappensNext: string;
}

/** Authority-quoted evidence reference. */
export interface WaitingEvidenceRef {
  readonly label: string;
  readonly href: string;
}

/** Fields shared by every waiting snapshot variant. */
export interface WaitingSnapshotBase {
  readonly referenceId: string;
  /** What is being fulfilled (authority-quoted summary). */
  readonly intentSummary: string;
  readonly amount: WaitingMoneyQuote;
  /** Role the snapshot was resolved for. */
  readonly viewerRole: WaitingViewerRole;
  /** Roles permitted to view this reference (per-reference role check). */
  readonly allowedViewerRoles: readonly WaitingViewerRole[];
  readonly reportedBy: string;
  /** ISO 8601 timestamp as reported by the authority. */
  readonly reportedAt: string;
  /**
   * Recovery actions for the current viewer, each individually authorized,
   * or an empty array meaning the explicit "no action is available yet".
   */
  readonly recovery: readonly WaitingRecoveryAction[];
  readonly inquiry: WaitingInquiryAvailability;
  /**
   * Authority-quoted caveat about timing/progress, e.g. that the authority has
   * published no completion estimate. Never a UI-invented estimate.
   */
  readonly authorityNote?: string;
}

export type WaitingConditionStateId =
  | "fq.queued.liquidity-credit"
  | "fq.queued.provider-availability"
  | "fq.waiting.settlement-confirmation"
  | "fq.delayed.liquidity-window"
  | "fq.delayed.provider-backoff";

/** A waiting/queued/delayed condition as reported by the authority. */
export interface WaitingConditionSnapshot extends WaitingSnapshotBase {
  readonly snapshotKind: "condition";
  readonly authorityStateId: WaitingConditionStateId;
  readonly conditionKind: WaitingConditionKind;
  readonly whatIsWaiting: string;
  /** Reason exactly as reported by the owning authority. */
  readonly reason: string;
  /** Expectation of what happens next, as reported by the authority. */
  readonly expectation: string;
}

export type WaitingUnknownStateId =
  | "fq.unknown.pending-reconciliation"
  | "fq.unknown.after-wait-timeout";

/** UNKNOWN after a wait, with its reconciliation path. Never success/failure. */
export interface WaitingUnknownSnapshot extends WaitingSnapshotBase {
  readonly snapshotKind: "unknown";
  readonly authorityStateId: WaitingUnknownStateId;
  readonly subject: string;
  readonly explanation: string;
  /** What the preceding wait was, as reported by the authority. */
  readonly waitedFor: string;
  readonly reconciliation: WaitingReconciliationPath;
}

export type WaitingResolutionStateId =
  | "fq.resolved.completed"
  | "fq.resolved.failed"
  | "fq.resolved.still-unknown";

/**
 * Ending of a delayed-fulfillment flow: explicit terminal state (completed or
 * failed) or an explicitly-still-unknown state with continuing reconciliation.
 */
export interface WaitingResolutionSnapshot extends WaitingSnapshotBase {
  readonly snapshotKind: "resolution";
  readonly authorityStateId: WaitingResolutionStateId;
  readonly outcome: "succeeded" | "failed" | "still-unknown";
  /** Subject line when the ending is still-unknown. */
  readonly subject?: string;
  readonly outcomeDetail: string;
  /** Evidence for a completed fulfillment. */
  readonly evidence?: readonly WaitingEvidenceRef[];
  /** Authority-quoted failure reason. */
  readonly failureReason?: string;
  /** Next actions for a failed fulfillment. */
  readonly nextActions?: readonly string[];
  /** Continuing reconciliation when the flow ended still-unknown. */
  readonly reconciliation?: WaitingReconciliationPath;
}

export type WaitingSnapshot =
  | WaitingConditionSnapshot
  | WaitingUnknownSnapshot
  | WaitingResolutionSnapshot;

/** Per-reference, per-role lookup result, mirroring the tracking port's pattern. */
export type WaitingLookupResult =
  | { readonly status: "found"; readonly snapshot: WaitingSnapshot }
  | { readonly status: "not-found"; readonly referenceId: string }
  | {
      readonly status: "role-denied";
      readonly referenceId: string;
      readonly viewerRole: WaitingViewerRole;
      readonly allowedViewerRoles: readonly WaitingViewerRole[];
    };

/** Request to re-check the authoritative state of a reference. */
export interface WaitingInquiryRequest {
  readonly referenceId: string;
  readonly requestedByRole: WaitingViewerRole;
}

export type WaitingInquiryResult =
  | {
      readonly status: "accepted";
      readonly authorityStateId: "fq.inquiry.recheck-requested";
      readonly referenceId: string;
      readonly routedTo: string;
      readonly whoResolves: string;
      readonly recheckTrigger: string;
      readonly whatHappensNext: string;
      readonly whatUserSeesNext: string;
    }
  | {
      readonly status: "rejected";
      readonly authorityStateId: "fq.inquiry.rejected";
      readonly referenceId: string;
      readonly reason: string;
    };

/** Request for one recovery action. Authorization is assessed per request. */
export interface WaitingRecoveryRequest {
  readonly referenceId: string;
  readonly actionId: WaitingRecoveryActionId;
  readonly requestedByRole: WaitingViewerRole;
}

export type WaitingRecoveryRequestResult =
  | {
      readonly status: "accepted";
      readonly authorityStateId:
        | "fq.recovery.retry-requested"
        | "fq.recovery.cancel-requested"
        | "fq.recovery.escalate-requested";
      readonly referenceId: string;
      readonly actionId: WaitingRecoveryActionId;
      readonly routedTo: string;
      readonly whatHappensNext: string;
      readonly whatUserSeesNext: string;
    }
  | {
      readonly status: "denied";
      readonly authorityStateId: "fq.recovery.denied";
      readonly referenceId: string;
      readonly actionId: WaitingRecoveryActionId;
      readonly reason: string;
    };

/**
 * The waiting surface's data needs. The mock backing is presentation-only and
 * NON-AUTHORITATIVE; the authority-backed implementation is ARRIVING.
 */
export interface WaitingPort {
  readonly runtime: typeof WAITING_PORT_RUNTIME_STATUS;
  readonly authorityOwner: string;
  readonly nonAuthoritative: true;
  /** Per-reference, per-role lookup of the waiting snapshot. */
  lookupWaiting(
    referenceId: string,
    viewerRole: WaitingViewerRole,
  ): WaitingLookupResult;
  /** Request a re-check of the authoritative state. Never forces an outcome. */
  requestRecheck(request: WaitingInquiryRequest): WaitingInquiryResult;
  /**
   * Request one recovery action. Refuses (denies) any request that is not
   * individually authorized per protocol; accepted requests never mutate
   * durable financial state.
   */
  requestRecovery(request: WaitingRecoveryRequest): WaitingRecoveryRequestResult;
}

/**
 * Port accessor. Returns the NON-AUTHORITATIVE mock backing while the real
 * Fulfillment/Queue Authority implementation is ARRIVING.
 */
export function getWaitingPort(): WaitingPort {
  return mockWaitingAuthority;
}
