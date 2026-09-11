/**
 * UI-004 — Capability state mapping.
 *
 * Authority state -> display state resolution for the provider capability
 * surface, following the UI-002 adapter-boundary precedent
 * (src/lib/protocol/intent-state-mapping.ts).
 *
 * The mapping is one-to-one (P4): each authority capability state resolves to
 * exactly one display state, and each display state renders through exactly
 * one shared state primitive. Two axes are kept separate on purpose:
 *
 *   capability state axis:   available | unavailable | conditional | pending | indeterminate
 *   source availability axis: reachable | degraded | unreachable
 *
 * Precedence: an unreachable source produces availability-unknown — it never
 * produces an outcome of any kind. A degraded source produces indeterminate
 * reports at the authority, which resolve to UNKNOWN. Indeterminate truth
 * NEVER renders as success or failure (P4, P5); it renders as UNKNOWN with
 * its reconciliation path.
 *
 * Every consequential state carries a mapping record id; the complete
 * nine-question records live in spec/product/capability-mapping-records.md
 * (the intent-mapping-records.md format).
 */
import type {
  CapabilityItem,
  CapabilityReport,
  CapabilitySourceRef,
} from "./capability-port";

// ---------------------------------------------------------------------------
// Mapping record ids (spec/product/capability-mapping-records.md)
// ---------------------------------------------------------------------------

export const CAPABILITY_MAPPING_RECORD_IDS = {
  available: "CAP-MAP-001",
  unavailable: "CAP-MAP-002",
  conditional: "CAP-MAP-003",
  pending: "CAP-MAP-004",
  indeterminate: "CAP-MAP-005",
  availabilityUnknown: "CAP-MAP-006",
} as const;

export type CapabilityMappingRecordId =
  (typeof CAPABILITY_MAPPING_RECORD_IDS)[keyof typeof CAPABILITY_MAPPING_RECORD_IDS];

// ---------------------------------------------------------------------------
// Display states — prop shapes mirror the shared primitive contracts
// (src/components/state) so the view layer can spread them directly.
// ---------------------------------------------------------------------------

export type CapabilityDisplayStateKind =
  | "succeeded"
  | "failed"
  | "action-required"
  | "in-progress"
  | "unknown"
  | "availability-unknown";

export interface SucceededDisplayProps {
  outcome: string;
  reportedBy: string;
  evidence: { label: string; href: string };
}

export interface FailedDisplayProps {
  outcome: string;
  reportedBy: string;
  reason?: string;
  nextActions?: readonly string[];
}

export interface ActionRequiredDisplayProps {
  action: string;
  reportedBy: string;
  validity?: string;
  consequenceOfInaction?: string;
}

export interface InProgressDisplayProps {
  whatIsHappening: string;
  whatCompletesIt: string;
  reportedBy: string;
}

export interface UnknownDisplayProps {
  subject: string;
  explanation: string;
  reconciliation?: { whoResolves: string; recheckTrigger: string };
}

export interface AvailabilityUnknownDisplayProps {
  target: string;
  detail?: string;
}

export type CapabilityDisplayState =
  | {
      kind: "succeeded";
      recordId: "CAP-MAP-001";
      props: SucceededDisplayProps;
    }
  | {
      kind: "failed";
      recordId: "CAP-MAP-002";
      props: FailedDisplayProps;
    }
  | {
      kind: "action-required";
      recordId: "CAP-MAP-003";
      props: ActionRequiredDisplayProps;
    }
  | {
      kind: "in-progress";
      recordId: "CAP-MAP-004";
      props: InProgressDisplayProps;
    }
  | {
      kind: "unknown";
      recordId: "CAP-MAP-005";
      props: UnknownDisplayProps;
    }
  | {
      kind: "availability-unknown";
      recordId: "CAP-MAP-006";
      props: AvailabilityUnknownDisplayProps;
    };

// ---------------------------------------------------------------------------
// Resolution (one-to-one, P4)
// ---------------------------------------------------------------------------

function fallbackEvidence(
  report: CapabilityReport,
  source: CapabilitySourceRef,
): SucceededDisplayProps["evidence"] {
  return (
    report.evidence ?? {
      label: `${source.name} record`,
      href:
        source.recordHref ??
        `/capabilities/${report.capabilityId}#provenance`,
    }
  );
}

export function resolveCapabilityDisplayState(
  item: CapabilityItem,
): CapabilityDisplayState {
  const { descriptor, report, source } = item;

  // Availability axis first: an unavailable source yields availability
  // unknown — never an outcome, never failure, never success.
  if (!report || source.availability === "unreachable") {
    return {
      kind: "availability-unknown",
      recordId: "CAP-MAP-006",
      props: {
        target: source.name,
        detail:
          source.availabilityDetail ??
          `${source.name} is not returning an authoritative record for ${descriptor.name}; its state cannot be authoritatively determined here.`,
      },
    };
  }

  // Capability state axis: one authority state -> exactly one display state.
  switch (report.state) {
    case "available":
      return {
        kind: "succeeded",
        recordId: "CAP-MAP-001",
        props: {
          outcome: `${descriptor.name} is available`,
          reportedBy: report.reportedBy,
          evidence: fallbackEvidence(report, source),
        },
      };
    case "unavailable":
      return {
        kind: "failed",
        recordId: "CAP-MAP-002",
        props: {
          outcome: `${descriptor.name} is unavailable`,
          reportedBy: report.reportedBy,
          reason: report.reason,
          nextActions: report.nextActions,
        },
      };
    case "conditional":
      return {
        kind: "action-required",
        recordId: "CAP-MAP-003",
        props: {
          action: `${descriptor.name} is available only when the authority-stated conditions hold`,
          reportedBy: report.reportedBy,
          validity: report.conditionValidity,
          consequenceOfInaction: report.consequenceOfInaction,
        },
      };
    case "pending":
      return {
        kind: "in-progress",
        recordId: "CAP-MAP-004",
        props: {
          whatIsHappening:
            report.whatIsHappening ??
            `The authority is evaluating ${descriptor.name}.`,
          whatCompletesIt:
            report.whatCompletesIt ??
            "The authority publishes the evaluated record.",
          reportedBy: report.reportedBy,
        },
      };
    case "indeterminate":
      // Indeterminate renders as UNKNOWN with its reconciliation path —
      // never as failure or success (P4, P5).
      return {
        kind: "unknown",
        recordId: "CAP-MAP-005",
        props: {
          subject: `${descriptor.name}: state unknown`,
          explanation:
            report.reason ??
            "The authority cannot determine this capability yet.",
          reconciliation: report.reconciliation,
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Headline descriptions (progressive disclosure, P3)
// ---------------------------------------------------------------------------

export type CapabilityHeadlineTone =
  | "positive"
  | "negative"
  | "caution"
  | "attention"
  | "unknown";

export interface CapabilityHeadlineInfo {
  readonly label: string;
  readonly tone: CapabilityHeadlineTone;
  readonly note: string;
}

export function describeCapabilityHeadline(
  item: CapabilityItem,
): CapabilityHeadlineInfo {
  const { descriptor, report, source } = item;
  if (!report || source.availability === "unreachable") {
    return {
      label: "Availability unknown",
      tone: "unknown",
      note: `${source.name} is unavailable; no authoritative state can be presented`,
    };
  }
  switch (report.state) {
    case "available":
      return {
        label: "Available",
        tone: "positive",
        note: `Reported by ${report.reportedBy}`,
      };
    case "unavailable":
      return {
        label: "Unavailable",
        tone: "negative",
        note: `Reported by ${report.reportedBy}`,
      };
    case "conditional":
      return {
        label: "Conditional",
        tone: "caution",
        note: `Reported by ${report.reportedBy}; conditions one step away`,
      };
    case "pending":
      return {
        label: "In progress",
        tone: "attention",
        note: `Reported by ${report.reportedBy}; completion one step away`,
      };
    case "indeterminate":
      return {
        label: "Unknown",
        tone: "unknown",
        note: `Reported by ${report.reportedBy}; reconciliation one step away`,
      };
  }
}

/**
 * Presentation-only aggregation of the authority-reported display states for
 * the headline summary. Counting states is not a capability, eligibility, or
 * routing decision: every counted state is authority-owned.
 */
export function countCapabilityDisplayStates(
  items: readonly CapabilityItem[],
): Readonly<Record<CapabilityDisplayStateKind, number>> {
  const counts: Record<CapabilityDisplayStateKind, number> = {
    succeeded: 0,
    failed: 0,
    "action-required": 0,
    "in-progress": 0,
    unknown: 0,
    "availability-unknown": 0,
  };
  for (const item of items) {
    counts[resolveCapabilityDisplayState(item).kind] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Mapping table (adapter boundary report; verification harness)
// ---------------------------------------------------------------------------

export interface CapabilityMappingTableRow {
  readonly axis: "capability state" | "source availability";
  readonly authorityValue: string;
  readonly displayKind: CapabilityDisplayStateKind;
  readonly primitive: string;
  readonly recordId: CapabilityMappingRecordId;
  readonly neverRendersAs: string;
}

export const CAPABILITY_STATE_MAPPING_TABLE: readonly CapabilityMappingTableRow[] =
  [
    {
      axis: "capability state",
      authorityValue: "available",
      displayKind: "succeeded",
      primitive: "SucceededState",
      recordId: CAPABILITY_MAPPING_RECORD_IDS.available,
      neverRendersAs: "never UNKNOWN, never failed",
    },
    {
      axis: "capability state",
      authorityValue: "unavailable",
      displayKind: "failed",
      primitive: "FailedState",
      recordId: CAPABILITY_MAPPING_RECORD_IDS.unavailable,
      neverRendersAs: "never UNKNOWN, never succeeded",
    },
    {
      axis: "capability state",
      authorityValue: "conditional",
      displayKind: "action-required",
      primitive: "ActionRequiredState",
      recordId: CAPABILITY_MAPPING_RECORD_IDS.conditional,
      neverRendersAs: "never UNKNOWN, never plain success",
    },
    {
      axis: "capability state",
      authorityValue: "pending",
      displayKind: "in-progress",
      primitive: "InProgressState",
      recordId: CAPABILITY_MAPPING_RECORD_IDS.pending,
      neverRendersAs: "never UNKNOWN, never failed",
    },
    {
      axis: "capability state",
      authorityValue: "indeterminate",
      displayKind: "unknown",
      primitive: "UnknownState",
      recordId: CAPABILITY_MAPPING_RECORD_IDS.indeterminate,
      neverRendersAs: "never success, never failure — UNKNOWN with reconciliation",
    },
    {
      axis: "source availability",
      authorityValue: "unreachable",
      displayKind: "availability-unknown",
      primitive: "AvailabilityUnknownState",
      recordId: CAPABILITY_MAPPING_RECORD_IDS.availabilityUnknown,
      neverRendersAs: "never an outcome of any kind — distinct from failure",
    },
  ];
