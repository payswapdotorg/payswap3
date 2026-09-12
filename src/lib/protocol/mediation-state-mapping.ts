/**
 * UI-008 — Authority-state → display-presentation mapping (one-to-one).
 *
 * Every authority-reported mediation/dispute state maps to exactly one shared
 * state primitive presentation, and every mapping carries a mapping-record id
 * (MD-*) documented in spec/product/mediation-mapping-records.md.
 *
 * Mapping rules:
 * - One-to-one: one authority state, one primitive, one MD-* record.
 * - Authority wording is passed through verbatim (outcome wording, reasons,
 *   next actions, reconciliation). Presentation never rewrites it.
 * - UNKNOWN is a first-class outcome, not a fallback.
 * - This module is pure data mapping (no React), safe for server and client.
 *   Views import it directly; the display primitive components live in
 *   @/components/state.
 */

import type {
  AgentProposal,
  DisputeRecord,
  MediationCase,
  RecourseStep,
} from "./mediation-port";

const AGENTS_MEDIATION_AUTHORITY = "Agents/Mediation Authority";
const DISPUTES_RECOURSE_AUTHORITY = "Disputes/Recourse Authority";
// Re-anchored by UI-011: the constant name is frozen surface vocabulary
// (read-only consumers render it); the VALUE states the runtime truth.
const MOCK_RUNTIME_NOTE = "runtime-backed where the composed runtime answers (UI-011): A10 dispute primitive live; area-19/21 RTN wave 2 — unavailable/denied with the recorded gap, never fabricated";

export const MEDIATION_AUTHORITIES = {
  agentsMediation: AGENTS_MEDIATION_AUTHORITY,
  disputesRecourse: DISPUTES_RECOURSE_AUTHORITY,
  reportedByAgents: `${AGENTS_MEDIATION_AUTHORITY} (area 19, RTN wave 2 — not merged; unavailable with the recorded gap)`,
  reportedByDisputes: `${DISPUTES_RECOURSE_AUTHORITY} (area 21, RTN wave 2 — not merged; the composed A10 dispute primitive is the live dispute surface)`,
  runtimeNote: MOCK_RUNTIME_NOTE,
} as const;

export type DisplayPrimitiveKind =
  | "action-required"
  | "in-progress"
  | "waiting"
  | "succeeded"
  | "failed"
  | "unknown"
  | "availability-unknown";

export interface MappedActionRequired {
  primitive: "action-required";
  recordId: string;
  props: {
    action: string;
    reportedBy: string;
    validity?: string;
    consequenceOfInaction?: string;
  };
}

export interface MappedInProgress {
  primitive: "in-progress";
  recordId: string;
  props: { whatIsHappening: string; whatCompletesIt: string; reportedBy: string };
}

export interface MappedWaiting {
  primitive: "waiting";
  recordId: string;
  props: {
    whatIsWaiting: string;
    why: string;
    whatHappensNext: string;
    reportedBy: string;
    availableActions?: readonly string[];
  };
}

export interface MappedSucceeded {
  primitive: "succeeded";
  recordId: string;
  props: {
    outcome: string;
    reportedBy: string;
    evidence: { label: string; href: string };
  };
}

export interface MappedFailed {
  primitive: "failed";
  recordId: string;
  props: { outcome: string; reportedBy: string; reason?: string; nextActions?: readonly string[] };
}

export interface MappedUnknown {
  primitive: "unknown";
  recordId: string;
  props: {
    subject: string;
    explanation: string;
    reconciliation?: { whoResolves: string; recheckTrigger: string };
  };
}

export interface MappedAvailabilityUnknown {
  primitive: "availability-unknown";
  recordId: string;
  props: { target: string; detail?: string };
}

export type MappedDisplay =
  | MappedActionRequired
  | MappedInProgress
  | MappedWaiting
  | MappedSucceeded
  | MappedFailed
  | MappedUnknown
  | MappedAvailabilityUnknown;

// ---------------------------------------------------------------------------
// Proposal mappings (authority: Agents/Mediation Authority)
// ---------------------------------------------------------------------------

export function mapProposalDisplay(proposal: AgentProposal): MappedDisplay {
  const reportedBy = MEDIATION_AUTHORITIES.reportedByAgents;
  switch (proposal.authorityState) {
    case "awaiting-decision":
      return {
        primitive: "action-required",
        recordId: "MD-001",
        props: {
          action: `Decide on this agent proposal: accept, reject, counter, or escalate it. The complete consequences of each decision are stated above; none is applied until you confirm.`,
          reportedBy,
          validity: proposal.consequences.validUntil,
          consequenceOfInaction:
            "If no decision is made before the validity window closes, the proposal expires without being applied and the swap keeps its current state.",
        },
      };
    case "decided-accepted":
      return {
        primitive: "succeeded",
        recordId: "MD-002",
        props: {
          outcome: proposal.decision?.outcomeWording ?? "The acceptance was applied under protocol authorization.",
          reportedBy,
          evidence: primaryProof(proposal.decision?.proof ?? proposal.evidence),
        },
      };
    case "decided-rejected":
      return {
        primitive: "failed",
        recordId: "MD-003",
        props: {
          outcome: proposal.decision?.outcomeWording ?? "The rejection was recorded.",
          reportedBy,
          reason: `Rejected by ${proposal.decision?.decidedBy.label ?? "the addressed party"} on ${proposal.decision?.decidedAt ?? "an authority-recorded timestamp"}. The proposal is closed; a new proposal is required for further changes.`,
          nextActions: [
            "The counterparty is notified with the rejection wording.",
            "If you disagree with how this reference now stands, the dispute path remains open to both parties.",
          ],
        },
      };
    case "decided-counter-proposed":
      return {
        primitive: "in-progress",
        recordId: "MD-004",
        props: {
          whatIsHappening: `Counter-terms from ${proposal.decision?.decidedBy.label ?? "the addressed party"} are with ${proposal.counterparty.label} for an explicit decision. Nothing further is required from you on this proposal.`,
          whatCompletesIt: `${proposal.counterparty.label}'s explicit accept or reject decision, or the counter's authority-quoted validity window closing.`,
          reportedBy,
        },
      };
    case "decided-escalated":
      return {
        primitive: "in-progress",
        recordId: "MD-005",
        props: {
          whatIsHappening: `This proposal is under human review by the ${AGENTS_MEDIATION_AUTHORITY} after the escalation by ${proposal.decision?.decidedBy.label ?? "the addressed party"}.`,
          whatCompletesIt: `The authority's review outcome, reported here with its exact wording and proof.`,
          reportedBy,
        },
      };
    case "expired":
      return {
        primitive: "failed",
        recordId: "MD-006",
        props: {
          outcome: "The proposal expired without a decision: its authority-quoted validity window closed.",
          reportedBy,
          reason: proposal.consequences.validUntil,
          nextActions: [
            "No decision is accepted on this proposal anymore.",
            "The swap keeps its current state; a new proposal would be required to change it.",
            "If you disagree with how this reference now stands, the dispute path remains open to both parties.",
          ],
        },
      };
    case "authority-unreachable":
    default:
      return {
        primitive: "unknown",
        recordId: "MD-007",
        props: {
          subject: `The current state of proposal ${proposal.id} (${proposal.reference})`,
          explanation: `The ${AGENTS_MEDIATION_AUTHORITY} cannot currently report this proposal's state, so it is UNKNOWN. No decision can be accepted and no state is assumed until the authority reports again.`,
          reconciliation: {
            whoResolves: `The ${AGENTS_MEDIATION_AUTHORITY}; its availability is surfaced on the operator oversight surface (UI-007).`,
            recheckTrigger: "Recheck from this surface; the recheck records nothing on your behalf and applies no decision.",
          },
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Mediation mappings (authority: Agents/Mediation Authority)
// ---------------------------------------------------------------------------

export function mapMediationDisplay(mediationCase: MediationCase): MappedDisplay {
  const reportedBy = MEDIATION_AUTHORITIES.reportedByAgents;
  switch (mediationCase.authorityState) {
    case "open":
      return {
        primitive: "in-progress",
        recordId: "MD-101",
        props: {
          whatIsHappening: `Mediation is open between ${mediationCase.parties
            .map((entry) => entry.party.label)
            .join(" and ")} over ${mediationCase.subject}.`,
          whatCompletesIt: `Every party's acceptance of the proposed resolution, or the ${AGENTS_MEDIATION_AUTHORITY}'s determination.`,
          reportedBy,
        },
      };
    case "awaiting-party": {
      const awaiting = mediationCase.parties.filter((entry) => entry.status === "awaiting-response");
      const labels = awaiting.map((entry) => entry.party.label).join(", ") || "a party";
      return {
        primitive: "waiting",
        recordId: "MD-102",
        props: {
          whatIsWaiting: `A response from ${labels} in this mediation.`,
          why: "The mediation cannot advance until every party participates; participation is what makes the outcome legitimate.",
          whatHappensNext: `The mediation advances when ${labels} responds, or fails when the authority-quoted participation window closes.`,
          reportedBy,
          availableActions: mediationCase.viewerActions
            .filter((entry) => entry.authorized)
            .map((entry) =>
              entry.action === "submit-statement"
                ? "Add your statement to the thread"
                : entry.action === "accept-proposed-resolution"
                  ? "Accept the proposed resolution"
                  : "Decline the proposed resolution",
            ),
        },
      };
    }
    case "resolved":
      return {
        primitive: "succeeded",
        recordId: "MD-103",
        props: {
          outcome: mediationCase.resolution?.outcomeWording ?? "The mediation is resolved.",
          reportedBy,
          evidence: primaryProof(mediationCase.resolution?.proof ?? []),
        },
      };
    case "failed":
      return {
        primitive: "failed",
        recordId: "MD-104",
        props: {
          outcome: "The mediation failed and is closed.",
          reportedBy,
          reason: mediationCase.failure?.reason,
          nextActions: mediationCase.failure?.nextActions,
        },
      };
    case "authority-unreachable":
    default:
      return {
        primitive: "unknown",
        recordId: "MD-105",
        props: {
          subject: `The current state of mediation ${mediationCase.id} (${mediationCase.reference})`,
          explanation: `The ${AGENTS_MEDIATION_AUTHORITY} cannot currently report this mediation's state, so it is UNKNOWN. Party actions are withheld and no state is assumed.`,
          reconciliation: mediationCase.unknown?.reconciliation ?? {
            whoResolves: `The ${AGENTS_MEDIATION_AUTHORITY}; its availability is surfaced on the operator oversight surface (UI-007).`,
            recheckTrigger: "Recheck from this surface or from the dispute's recourse tracker.",
          },
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Dispute mappings (authority: Disputes/Recourse Authority)
// ---------------------------------------------------------------------------

export function mapDisputeDisplay(dispute: DisputeRecord): MappedDisplay {
  const reportedBy = MEDIATION_AUTHORITIES.reportedByDisputes;
  switch (dispute.authorityState) {
    case "open":
      return {
        primitive: "in-progress",
        recordId: "MD-201",
        props: {
          whatIsHappening: `The dispute opened by ${dispute.openedBy.label} against ${dispute.against.label} is with the ${DISPUTES_RECOURSE_AUTHORITY}: automated completion of the referenced swap is paused while the authority reviews the grounds.`,
          whatCompletesIt: `The authority's grounds review: referral to mediation, or its rejection wording on this record.`,
          reportedBy,
        },
      };
    case "in-mediation":
      return {
        primitive: "in-progress",
        recordId: "MD-202",
        props: {
          whatIsHappening: `This dispute is in mediation between the parties; the mediation's own state is reported on the linked mediation thread.`,
          whatCompletesIt: `The mediation's determination, whose exact wording the ${DISPUTES_RECOURSE_AUTHORITY} records on this dispute.`,
          reportedBy,
        },
      };
    case "resolved":
      return {
        primitive: "succeeded",
        recordId: "MD-203",
        props: {
          outcome: dispute.resolution?.outcomeWording ?? "The dispute is resolved.",
          reportedBy,
          evidence: primaryProof(dispute.resolution?.proof ?? []),
        },
      };
    case "failed":
      return {
        primitive: "failed",
        recordId: "MD-204",
        props: {
          outcome: "The dispute failed: the authority did not uphold it.",
          reportedBy,
          reason: dispute.failure?.reason,
          nextActions: dispute.failure?.nextActions,
        },
      };
    case "authority-unreachable":
    default:
      return {
        primitive: "unknown",
        recordId: "MD-205",
        props: {
          subject: `The current state of dispute ${dispute.id} (${dispute.reference})`,
          explanation: `The ${DISPUTES_RECOURSE_AUTHORITY} cannot currently report this dispute's state, so it is UNKNOWN. No state is assumed and no party action is accepted on it.`,
          reconciliation: dispute.unknown?.reconciliation ?? {
            whoResolves: `The ${DISPUTES_RECOURSE_AUTHORITY}; its availability is surfaced on the operator oversight surface (UI-007).`,
            recheckTrigger: "Recheck from this surface; the recourse trail keeps every already-recorded proof.",
          },
        },
      };
  }
}

/** Pre-initiation presentation (used by the dispute initiation form). */
export function mapDisputeInitiationDisplay(consequenceOfInaction?: string): MappedDisplay {
  return {
    primitive: "action-required",
    recordId: "MD-206",
    props: {
      action:
        "Initiate a dispute with the Disputes/Recourse Authority: choose explicit grounds, state what happened, attach evidence references, then confirm. Nothing is opened until you confirm.",
      reportedBy: MEDIATION_AUTHORITIES.reportedByDisputes,
      consequenceOfInaction,
    },
  };
}

// ---------------------------------------------------------------------------
// Recourse-step mappings (authority: Disputes/Recourse Authority)
// ---------------------------------------------------------------------------

export function mapRecourseStepDisplay(step: RecourseStep): MappedDisplay {
  const reportedBy = MEDIATION_AUTHORITIES.reportedByDisputes;
  switch (step.authorityState) {
    case "completed":
      return {
        primitive: "succeeded",
        recordId: "MD-301",
        props: {
          outcome: step.outcomeWording ?? `The ${step.title} completed; its proof is recorded.`,
          reportedBy: step.authority,
          evidence: primaryProof(step.proof),
        },
      };
    case "in-progress":
      return {
        primitive: "in-progress",
        recordId: "MD-302",
        props: {
          whatIsHappening: `${step.title} is currently in progress with the authority that owns it.`,
          whatCompletesIt: `The authority's recorded outcome for this stage, with its proof on this trail.`,
          reportedBy: step.authority,
        },
      };
    case "awaiting-party":
      return {
        primitive: "waiting",
        recordId: "MD-303",
        props: {
          whatIsWaiting: `${step.title} is waiting on a party's participation.`,
          why: "This recourse stage only advances with the party's response; the authority does not proceed for a party.",
          whatHappensNext: `The stage advances when the party responds, or records its failure if the authority-quoted window closes.`,
          reportedBy: step.authority,
        },
      };
    case "pending":
      return {
        primitive: "waiting",
        recordId: "MD-304",
        props: {
          whatIsWaiting: `The ${step.title.toLowerCase()} stage of the recourse path.`,
          why: "This stage has not been triggered: it only opens when the prior stages' outcomes require it.",
          whatHappensNext: `If the prior stages' outcomes require escalation, this stage opens with the authority's wording and proof.`,
          reportedBy: step.authority,
        },
      };
    case "failed":
      return {
        primitive: "failed",
        recordId: "MD-305",
        props: {
          outcome: `${step.title} failed.`,
          reportedBy: step.authority,
          reason: step.outcomeWording,
          nextActions: [
            "The stages that already completed keep their proof on this trail.",
            "Further process follows the authority's recorded next actions on the dispute record.",
          ],
        },
      };
    case "authority-unreachable":
    default:
      return {
        primitive: "unknown",
        recordId: "MD-306",
        props: {
          subject: `The current state of the \u201c${step.title}\u201d recourse stage`,
          explanation: `The owning authority cannot currently report this stage's state, so it is UNKNOWN. No state is assumed.`,
          reconciliation: {
            whoResolves: `The ${DISPUTES_RECOURSE_AUTHORITY}; its availability is surfaced on the operator oversight surface (UI-007).`,
            recheckTrigger: "Recheck from this tracker; completed stages keep their recorded proof.",
          },
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Fetch-availability mapping (MD-400)
// ---------------------------------------------------------------------------

export function mapUnavailableFetch(
  scope: "proposal" | "mediation" | "dispute" | "docket",
  target: string,
  detail?: string,
): MappedDisplay {
  return {
    primitive: "availability-unknown",
    recordId: "MD-400",
    props: {
      target:
        scope === "docket"
          ? `${AGENTS_MEDIATION_AUTHORITY} + ${DISPUTES_RECOURSE_AUTHORITY} docket query`
          : target,
      detail:
        detail ??
        "The owning authority cannot currently report this information. Availability is UNKNOWN; nothing is assumed and no action is taken on your behalf.",
    },
  };
}

function primaryProof(proof: readonly { label: string; href: string }[]): {
  label: string;
  href: string;
} {
  const first = proof[0];
  if (first) return first;
  return { label: "Proof trail (verification harness)", href: "/verification/mediation-flow" };
}

// ---------------------------------------------------------------------------
// Mapping tables (evidence for the verification harness state matrix)
// ---------------------------------------------------------------------------

export interface StateMappingRow {
  recordId: string;
  authorityState: string;
  primitive: DisplayPrimitiveKind;
  oneLine: string;
}

export const PROPOSAL_MAPPING_TABLE: readonly StateMappingRow[] = [
  { recordId: "MD-001", authorityState: "awaiting-decision", primitive: "action-required", oneLine: "A human decision is required; all consequences are shown before any control." },
  { recordId: "MD-002", authorityState: "decided-accepted", primitive: "succeeded", oneLine: "Acceptance applied under protocol authorization, with the authority's outcome wording and proof." },
  { recordId: "MD-003", authorityState: "decided-rejected", primitive: "failed", oneLine: "Rejection recorded; proposal closed; dispute path remains open." },
  { recordId: "MD-004", authorityState: "decided-counter-proposed", primitive: "in-progress", oneLine: "Counter-terms are with the counterparty for their explicit decision." },
  { recordId: "MD-005", authorityState: "decided-escalated", primitive: "in-progress", oneLine: "Under human review by the Agents/Mediation Authority." },
  { recordId: "MD-006", authorityState: "expired", primitive: "failed", oneLine: "Validity window closed; no decision accepted anymore." },
  { recordId: "MD-007", authorityState: "authority-unreachable", primitive: "unknown", oneLine: "State UNKNOWN; decisions withheld; reconciliation path shown." },
];

export const MEDIATION_MAPPING_TABLE: readonly StateMappingRow[] = [
  { recordId: "MD-101", authorityState: "open", primitive: "in-progress", oneLine: "Mediation open between the parties." },
  { recordId: "MD-102", authorityState: "awaiting-party", primitive: "waiting", oneLine: "Waiting on a named party's participation." },
  { recordId: "MD-103", authorityState: "resolved", primitive: "succeeded", oneLine: "Resolved with the authority's exact outcome wording and proof." },
  { recordId: "MD-104", authorityState: "failed", primitive: "failed", oneLine: "Failed with the authority's reason and next actions." },
  { recordId: "MD-105", authorityState: "authority-unreachable", primitive: "unknown", oneLine: "State UNKNOWN; party actions withheld; reconciliation path shown." },
];

export const DISPUTE_MAPPING_TABLE: readonly StateMappingRow[] = [
  { recordId: "MD-201", authorityState: "open", primitive: "in-progress", oneLine: "Dispute with the authority; automated completion paused." },
  { recordId: "MD-202", authorityState: "in-mediation", primitive: "in-progress", oneLine: "Dispute in mediation; linked thread reports the mediation's own state." },
  { recordId: "MD-203", authorityState: "resolved", primitive: "succeeded", oneLine: "Resolved with the authority's outcome wording; recourse window tracked." },
  { recordId: "MD-204", authorityState: "failed", primitive: "failed", oneLine: "Grounds rejected; recorded protocol events stand." },
  { recordId: "MD-205", authorityState: "authority-unreachable", primitive: "unknown", oneLine: "State UNKNOWN; no party action accepted; reconciliation path shown." },
  { recordId: "MD-206", authorityState: "initiation (pre-submit)", primitive: "action-required", oneLine: "Initiation is an explicit single-intent action with consequences restated before confirmation." },
];

export const RECOURSE_MAPPING_TABLE: readonly StateMappingRow[] = [
  { recordId: "MD-301", authorityState: "completed", primitive: "succeeded", oneLine: "Stage outcome recorded with proof." },
  { recordId: "MD-302", authorityState: "in-progress", primitive: "in-progress", oneLine: "Stage in progress with its owning authority." },
  { recordId: "MD-303", authorityState: "awaiting-party", primitive: "waiting", oneLine: "Stage waiting on a party's participation." },
  { recordId: "MD-304", authorityState: "pending", primitive: "waiting", oneLine: "Stage not yet triggered by prior outcomes." },
  { recordId: "MD-305", authorityState: "failed", primitive: "failed", oneLine: "Stage failed; completed stages keep their proof." },
  { recordId: "MD-306", authorityState: "authority-unreachable", primitive: "unknown", oneLine: "Stage state UNKNOWN; reconciliation path shown." },
];

export const FETCH_MAPPING_ROW: StateMappingRow = {
  recordId: "MD-400",
  authorityState: "fetch unavailable",
  primitive: "availability-unknown",
  oneLine: "The authority cannot currently be queried; availability is UNKNOWN and nothing is assumed.",
};

// ---------------------------------------------------------------------------
// Status badges for list surfaces (presentation detail keyed by primitive)
// ---------------------------------------------------------------------------

export const DISPLAY_STATUS_BADGE: Record<
  DisplayPrimitiveKind,
  { label: string; className: string }
> = {
  "action-required": {
    label: "Action required",
    className:
      "border-amber-600/40 bg-amber-600/10 text-amber-800 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300",
  },
  "in-progress": {
    label: "In progress",
    className: "border-stone-400/50 bg-stone-400/10 text-stone-700 dark:border-stone-500/40 dark:bg-stone-500/10 dark:text-stone-300",
  },
  waiting: {
    label: "Waiting",
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300",
  },
  succeeded: {
    label: "Resolved",
    className:
      "border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-300",
  },
  failed: {
    label: "Failed",
    className:
      "border-destructive/40 bg-destructive/10 text-destructive dark:border-destructive/40 dark:bg-destructive/15 dark:text-red-300",
  },
  unknown: {
    label: "Unknown",
    className: "border-dashed border-stone-400/70 bg-muted text-muted-foreground",
  },
  "availability-unknown": {
    label: "Availability unknown",
    className: "border-dashed border-stone-400/70 bg-muted text-muted-foreground",
  },
};

/** Deterministic UTC timestamp formatting (no hydration drift). */
export function formatUtcTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })}, ${date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  })} UTC`;
}
