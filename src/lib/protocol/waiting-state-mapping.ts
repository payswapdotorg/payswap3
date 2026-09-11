/**
 * Waiting state mapping — UI-006 authority state -> display presentation.
 *
 * One-to-one: every authority state id reported by the waiting port maps to
 * exactly one display presentation, and every presentation carries its
 * nine-question mapping record id (WQ-*). The complete records live in
 * spec/product/waiting-mapping-records.md; this module mirrors them and is the
 * single place the UI consults for presentation labels, the state primitive to
 * render, and the polite live-region announcement template.
 *
 * Boundaries: the mapping only translates authority-reported states. It never
 * invents time or progress estimates, never recategorizes UNKNOWN as success
 * or failure, and never authorizes recovery on its own.
 */

import type { WaitingAuthorityStateId } from "@/lib/protocol/waiting-port";

/** Path of the complete nine-question mapping records. */
export const WAITING_MAPPING_DOC_PATH = "spec/product/waiting-mapping-records.md";

/** Mapping record ids, one per consequential waiting/recovery state. */
export type WaitingMappingRecordId =
  | "WQ-01"
  | "WQ-02"
  | "WQ-03"
  | "WQ-04"
  | "WQ-05"
  | "WQ-06"
  | "WQ-07"
  | "WQ-08"
  | "WQ-09"
  | "WQ-10"
  | "WQ-11"
  | "WQ-12"
  | "WQ-13"
  | "WQ-14"
  | "WQ-15"
  | "WQ-16";

/** How a waiting authority state is displayed on the track surface. */
export type WaitingDisplayKind =
  | "queued"
  | "waiting"
  | "delayed"
  | "unknown"
  | "resolved-succeeded"
  | "resolved-failed"
  | "resolved-still-unknown"
  | "recovery-requested"
  | "recovery-denied"
  | "inquiry-requested"
  | "inquiry-rejected";

/**
 * Which state primitive renders the presentation. "InlineResult" marks request
 * results (denials, rejections) that render as explicit inline notes rather
 * than fulfillment-state primitives.
 */
export type WaitingDisplayPrimitive =
  | "WaitingState"
  | "UnknownState"
  | "SucceededState"
  | "FailedState"
  | "InProgressState"
  | "InlineResult";

export interface WaitingDisplayPresentation {
  readonly recordId: WaitingMappingRecordId;
  readonly displayKind: WaitingDisplayKind;
  readonly displayPrimitive: WaitingDisplayPrimitive;
  /** Short label shown on the track surface header. */
  readonly surfaceLabel: string;
  /** Live-region announcement template; tokens are filled from port data. */
  readonly announcementTemplate: string;
}

/**
 * The one-to-one authority state -> display presentation mapping.
 * Announcement templates use {token} placeholders filled by
 * fillWaitingAnnouncement() with authority-quoted values only.
 */
export const WAITING_STATE_DISPLAY_MAP: Readonly<
  Record<WaitingAuthorityStateId, WaitingDisplayPresentation>
> = {
  "fq.queued.liquidity-credit": {
    recordId: "WQ-01",
    displayKind: "queued",
    displayPrimitive: "WaitingState",
    surfaceLabel: "Queued — liquidity credit",
    announcementTemplate:
      "Queued: {whatIsWaiting}. Reason: {reason} What happens next: {expectation} Reported by {reportedBy}.",
  },
  "fq.queued.provider-availability": {
    recordId: "WQ-02",
    displayKind: "queued",
    displayPrimitive: "WaitingState",
    surfaceLabel: "Queued — provider availability",
    announcementTemplate:
      "Queued: {whatIsWaiting}. Reason: {reason} What happens next: {expectation} Reported by {reportedBy}.",
  },
  "fq.waiting.settlement-confirmation": {
    recordId: "WQ-03",
    displayKind: "waiting",
    displayPrimitive: "WaitingState",
    surfaceLabel: "Waiting — settlement confirmation",
    announcementTemplate:
      "Waiting: {whatIsWaiting}. Reason: {reason} What happens next: {expectation} Reported by {reportedBy}.",
  },
  "fq.delayed.liquidity-window": {
    recordId: "WQ-04",
    displayKind: "delayed",
    displayPrimitive: "WaitingState",
    surfaceLabel: "Delayed — liquidity window",
    announcementTemplate:
      "Delayed: {whatIsWaiting}. Reason: {reason} What happens next: {expectation} Reported by {reportedBy}.",
  },
  "fq.delayed.provider-backoff": {
    recordId: "WQ-05",
    displayKind: "delayed",
    displayPrimitive: "WaitingState",
    surfaceLabel: "Delayed — provider backoff",
    announcementTemplate:
      "Delayed: {whatIsWaiting}. Reason: {reason} What happens next: {expectation} Reported by {reportedBy}.",
  },
  "fq.unknown.pending-reconciliation": {
    recordId: "WQ-06",
    displayKind: "unknown",
    displayPrimitive: "UnknownState",
    surfaceLabel: "Unknown — pending reconciliation",
    announcementTemplate:
      "Unknown: {subject}. {explanation} {whoResolves} re-checks this on {recheckTrigger}. This is not a failure and not a success.",
  },
  "fq.unknown.after-wait-timeout": {
    recordId: "WQ-07",
    displayKind: "unknown",
    displayPrimitive: "UnknownState",
    surfaceLabel: "Unknown — after wait timeout",
    announcementTemplate:
      "Unknown: {subject}. {explanation} {whoResolves} re-checks this on {recheckTrigger}. This is not a failure and not a success.",
  },
  "fq.resolved.completed": {
    recordId: "WQ-08",
    displayKind: "resolved-succeeded",
    displayPrimitive: "SucceededState",
    surfaceLabel: "Resolved — completed",
    announcementTemplate:
      "Resolved, completed: {outcomeDetail} Reported by {reportedBy}.",
  },
  "fq.resolved.failed": {
    recordId: "WQ-09",
    displayKind: "resolved-failed",
    displayPrimitive: "FailedState",
    surfaceLabel: "Resolved — failed",
    announcementTemplate:
      "Resolved, failed: {outcomeDetail} Reason: {failureReason} Reported by {reportedBy}.",
  },
  "fq.resolved.still-unknown": {
    recordId: "WQ-10",
    displayKind: "resolved-still-unknown",
    displayPrimitive: "UnknownState",
    surfaceLabel: "Ended — still unknown",
    announcementTemplate:
      "Ended, still unknown: {outcomeDetail} {whoResolves} continues reconciliation on {recheckTrigger}. This is not a dead end.",
  },
  "fq.recovery.retry-requested": {
    recordId: "WQ-11",
    displayKind: "recovery-requested",
    displayPrimitive: "InProgressState",
    surfaceLabel: "Retry requested",
    announcementTemplate:
      "Retry request routed to protocol authorization. {whatHappensNext}",
  },
  "fq.recovery.cancel-requested": {
    recordId: "WQ-12",
    displayKind: "recovery-requested",
    displayPrimitive: "InProgressState",
    surfaceLabel: "Cancel requested",
    announcementTemplate:
      "Cancel request routed to protocol authorization. {whatHappensNext}",
  },
  "fq.recovery.escalate-requested": {
    recordId: "WQ-13",
    displayKind: "recovery-requested",
    displayPrimitive: "InProgressState",
    surfaceLabel: "Escalation requested",
    announcementTemplate:
      "Escalation request routed to protocol authorization. {whatHappensNext}",
  },
  "fq.recovery.denied": {
    recordId: "WQ-14",
    displayKind: "recovery-denied",
    displayPrimitive: "InlineResult",
    surfaceLabel: "Recovery not authorized",
    announcementTemplate:
      "{actionId} was not authorized. {reason}",
  },
  "fq.inquiry.recheck-requested": {
    recordId: "WQ-15",
    displayKind: "inquiry-requested",
    displayPrimitive: "InProgressState",
    surfaceLabel: "Re-check requested",
    announcementTemplate:
      "Re-check requested. {whatHappensNext}",
  },
  "fq.inquiry.rejected": {
    recordId: "WQ-16",
    displayKind: "inquiry-rejected",
    displayPrimitive: "InlineResult",
    surfaceLabel: "Re-check request not accepted",
    announcementTemplate:
      "The re-check request was not accepted. {reason}",
  },
};

/** All mapping record ids, in record order. */
export const WAITING_MAPPING_RECORD_IDS: readonly WaitingMappingRecordId[] =
  Object.values(WAITING_STATE_DISPLAY_MAP).map((presentation) => presentation.recordId);

/**
 * The explicit non-states list from the mapping records: presentations that
 * look adjacent to waiting states but are explicitly NOT authority states.
 * Mirrored here so surfaces and the doc stay in lockstep.
 */
export const WAITING_NON_STATES: readonly string[] = [
  "No action available yet is a presentation of a condition's action set, not an authority state.",
  "UNKNOWN is not failure and not success; it is unresolved pending reconciliation.",
  "Queued is not in progress: nothing is executing; the entry awaits capacity.",
  "Delayed is not failed: the authority still expects completion, without publishing an estimate.",
  "A recovery request is not a recovery outcome: requesting never mutates financial state.",
  "An inquiry (re-check request) is not a state change of the fulfillment.",
  "Ended still-unknown is not a dead end: reconciliation continues and stays visible.",
];

/**
 * Resolve the display presentation for an authority state id. Exhaustive by
 * construction: an unmapped state id throws instead of silently rendering.
 */
export function getWaitingDisplayPresentation(
  stateId: WaitingAuthorityStateId,
): WaitingDisplayPresentation {
  const presentation = WAITING_STATE_DISPLAY_MAP[stateId];
  if (!presentation) {
    throw new Error(`No waiting display presentation mapped for authority state: ${stateId}`);
  }
  return presentation;
}

/**
 * Fill an announcement template with authority-quoted tokens. Unknown tokens
 * are removed rather than guessed; the announcement never invents content.
 */
export function fillWaitingAnnouncement(
  template: string,
  tokens: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (match, token: string) => {
    const value = tokens[token];
    return typeof value === "string" && value.length > 0 ? value : "";
  });
}
