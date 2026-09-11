import type { EvidenceRecordView, TrackedCurrentState, TrackedStateKind } from "./tracking-port";

/**
 * UI-005 — tracked state → display state resolution.
 *
 * This module is the explicit mapping layer of the adapter boundary (the
 * intent-state-mapping precedent applied to tracking). The mapping is
 * ONE-TO-ONE by construction (P4): every tracked state kind resolves to
 * exactly one shared state primitive, and the closed vocabulary in
 * ./tracking-port.ts cannot express an ambiguous "pending" — waiting
 * conditions arrive as WAITING (reason + expectation + actions-or-none),
 * unanswerable conditions as UNKNOWN (with reconciliation).
 *
 * It also owns the mapping-record ids (UX contract Section 8): every tracked
 * consequential state carries a complete nine-question record in
 * spec/product/tracking-mapping-records.md, and the id of that record is
 * resolved here so the surfaces can surface it.
 */

// Compile-time assertion (P4): the tracked vocabulary cannot express 'pending'.
type AssertNoAmbiguousPending = "pending" extends TrackedStateKind ? never : unknown;
export type __NoAmbiguousPending = AssertNoAmbiguousPending;

/** Display labels — the explicit state names the surfaces render (P4). */
export const TRACKED_STATE_LABELS: Readonly<Record<TrackedStateKind, string>> = {
  succeeded: "SUCCEEDED",
  failed: "FAILED",
  "in-progress": "IN_PROGRESS",
  waiting: "WAITING",
  unknown: "UNKNOWN",
  "action-required": "ACTION_REQUIRED",
};

/** Mapping-record ids — one complete nine-question record per tracked state. */
export const TRACKING_MAPPING_RECORD_IDS: Readonly<Record<TrackedStateKind, string>> = {
  succeeded: "TRK-SUCCEEDED",
  failed: "TRK-FAILED",
  "in-progress": "TRK-IN-PROGRESS",
  waiting: "TRK-WAITING",
  unknown: "TRK-UNKNOWN",
  "action-required": "TRK-ACTION-REQUIRED",
};

/** Mapping record for an evidence record the authority cannot answer for. */
export const EVIDENCE_UNAVAILABLE_MAPPING_RECORD_ID = "TRK-EVIDENCE-UNAVAILABLE";

/** Mapping records for the two non-tracked lookup outcomes (documented for completeness). */
export const LOOKUP_NOT_FOUND_MAPPING_RECORD_ID = "TRK-LOOKUP-NOT-FOUND";
export const LOOKUP_NOT_AUTHORIZED_MAPPING_RECORD_ID = "TRK-LOOKUP-NOT-AUTHORIZED";

/** The explicit note rendered when a WAITING state has no available actions (P6). */
export const WAITING_NO_ACTIONS_NOTE =
  "No actions are available to you yet — this outcome is waiting on the authority that owns it, not on you.";

/**
 * A display-state descriptor: which shared primitive renders the state, and
 * the exact props it is rendered with. Props mirror the primitive interfaces
 * one-to-one — this module never rewrites, merges, or synthesizes authority
 * wording.
 */
export type DisplayStateDescriptor =
  | {
      readonly primitive: "SucceededState";
      readonly kind: "succeeded";
      readonly label: "SUCCEEDED";
      readonly props: {
        outcome: string;
        reportedBy: string;
        evidence: { label: string; href: string };
      };
    }
  | {
      readonly primitive: "FailedState";
      readonly kind: "failed";
      readonly label: "FAILED";
      readonly props: {
        outcome: string;
        reportedBy: string;
        reason?: string;
        nextActions?: readonly string[];
      };
    }
  | {
      readonly primitive: "InProgressState";
      readonly kind: "in-progress";
      readonly label: "IN_PROGRESS";
      readonly props: {
        whatIsHappening: string;
        whatCompletesIt: string;
        reportedBy: string;
      };
    }
  | {
      readonly primitive: "WaitingState";
      readonly kind: "waiting";
      readonly label: "WAITING";
      readonly props: {
        whatIsWaiting: string;
        why: string;
        whatHappensNext: string;
        reportedBy: string;
        availableActions?: readonly string[];
      };
    }
  | {
      readonly primitive: "UnknownState";
      readonly kind: "unknown";
      readonly label: "UNKNOWN";
      readonly props: {
        subject: string;
        explanation: string;
        reconciliation?: { whoResolves: string; recheckTrigger: string };
      };
    }
  | {
      readonly primitive: "ActionRequiredState";
      readonly kind: "action-required";
      readonly label: "ACTION_REQUIRED";
      readonly props: {
        action: string;
        reportedBy: string;
        validity?: string;
        consequenceOfInaction?: string;
      };
    };

/**
 * Resolve a tracked current state to its display-state descriptor.
 * One-to-one (P4): the switch is exhaustive over the closed vocabulary and
 * passes each authority field straight through to the matching primitive.
 */
export function resolveDisplayState(current: TrackedCurrentState): DisplayStateDescriptor {
  switch (current.state) {
    case "succeeded":
      return {
        primitive: "SucceededState",
        kind: "succeeded",
        label: "SUCCEEDED",
        props: {
          outcome: current.outcome,
          reportedBy: current.reportedBy,
          evidence: current.evidence,
        },
      };
    case "failed":
      return {
        primitive: "FailedState",
        kind: "failed",
        label: "FAILED",
        props: {
          outcome: current.outcome,
          reportedBy: current.reportedBy,
          reason: current.reason,
          nextActions: current.nextActions,
        },
      };
    case "in-progress":
      return {
        primitive: "InProgressState",
        kind: "in-progress",
        label: "IN_PROGRESS",
        props: {
          whatIsHappening: current.whatIsHappening,
          whatCompletesIt: current.whatCompletesIt,
          reportedBy: current.reportedBy,
        },
      };
    case "waiting":
      return {
        primitive: "WaitingState",
        kind: "waiting",
        label: "WAITING",
        props: {
          whatIsWaiting: current.whatIsWaiting,
          why: current.why,
          whatHappensNext: current.whatHappensNext,
          reportedBy: current.reportedBy,
          availableActions: current.availableActions,
        },
      };
    case "unknown":
      return {
        primitive: "UnknownState",
        kind: "unknown",
        label: "UNKNOWN",
        props: {
          subject: current.subject,
          explanation: current.explanation,
          reconciliation: current.reconciliation,
        },
      };
    case "action-required":
      return {
        primitive: "ActionRequiredState",
        kind: "action-required",
        label: "ACTION_REQUIRED",
        props: {
          action: current.action,
          reportedBy: current.reportedBy,
          validity: current.validity,
          consequenceOfInaction: current.consequenceOfInaction,
        },
      };
  }
}

/** The mapping-record id for a tracked state kind. */
export function mappingRecordId(state: TrackedStateKind): string {
  return TRACKING_MAPPING_RECORD_IDS[state];
}

/** True when a WAITING descriptor carries no available actions (the surface says so explicitly). */
export function waitingHasNoActions(descriptor: DisplayStateDescriptor): boolean {
  return (
    descriptor.kind === "waiting" &&
    (descriptor.props.availableActions === undefined ||
      descriptor.props.availableActions.length === 0)
  );
}

/**
 * A proof-trail record display: either the recorded card data (verbatim
 * authority, time, outcome wording) or the UNKNOWN-for-the-record render.
 * A no-answer record NEVER resolves to a substitute (P5, P7, N1).
 */
export type EvidenceRecordDisplay =
  | {
      readonly kind: "recorded";
      readonly recordId: string;
      readonly label: string;
      readonly owningAuthority: string;
      readonly recordedAt: string;
      readonly outcomeWording: string;
    }
  | {
      readonly kind: "unknown-for-record";
      readonly recordId: string;
      readonly label: string;
      readonly owningAuthority: string;
      readonly unknownProps: {
        subject: string;
        explanation: string;
        reconciliation: { whoResolves: string; recheckTrigger: string };
      };
    };

/** Resolve one evidence record to its display form. */
export function resolveEvidenceRecordDisplay(record: EvidenceRecordView): EvidenceRecordDisplay {
  if (record.kind === "recorded") {
    return {
      kind: "recorded",
      recordId: record.recordId,
      label: record.label,
      owningAuthority: record.owningAuthority,
      recordedAt: record.recordedAt,
      outcomeWording: record.outcomeWording,
    };
  }

  return {
    kind: "unknown-for-record",
    recordId: record.recordId,
    label: record.label,
    owningAuthority: record.owningAuthority,
    unknownProps: {
      subject: `The ${record.label.toLowerCase()} for this outcome`,
      explanation: record.explanation,
      reconciliation: record.reconciliation,
    },
  };
}
