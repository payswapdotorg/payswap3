/**
 * UI-008 — Mock mediation authority (presentation-only backing).
 *
 * NON-AUTHORITATIVE. This mock exists so the UI-008 surfaces can be
 * demonstrated and verified before the real authorities arrive.
 *
 * Authority owners this mock stands in for (runtime ARRIVING):
 * - Agents/Mediation Authority — spec/architecture/v0.1/extensions-agents-merchant.md
 *   (agent proposals, human mediation).
 * - Disputes/Recourse Authority — spec/architecture/v0.1/
 *   disputes-federation-blockchain-emergence.md (disputes, recourse paths).
 *
 * Guarantees this mock keeps:
 * - It never scripts an unauthorized decision. Harness scripts may only set
 *   AUTHORITY-OWNED outcomes (mediation/dispute states, proposed resolutions,
 *   authority notices, recourse progression, fetch availability). Proposal
 *   decision outcomes are only reachable through submitProposalDecision,
 *   which re-validates per-role authorization on every call.
 * - All data is sandbox data. All money strings are authority-quoted; the
 *   presentation never computes totals.
 * - State is in-memory and resets on server restart or harness reset.
 */

import type {
  AgentProposal,
  DecisionAuthorizationEntry,
  DisputeGround,
  DisputeGroundId,
  DisputeInitiationBriefing,
  DisputeInitiationMatrixRow,
  DisputeInitiationRequest,
  DisputeInitiationResult,
  DisputeRecord,
  DisputableIntent,
  EvidenceRef,
  MediationActionAuthorization,
  MediationActionKind,
  MediationActionRequest,
  MediationActionResult,
  MediationCase,
  MediationHarnessScript,
  MediationPort,
  MediationRoleAuthorizationRow,
  PartyDocket,
  PartyRef,
  PartyRole,
  PortFetch,
  ProposalConsequences,
  ProposalDecisionKind,
  ProposalDecisionRequest,
  ProposalDecisionResult,
  RoleAuthorizationRow,
} from "./mediation-port";

const AGENTS_MEDIATION_AUTHORITY = "Agents/Mediation Authority";
const DISPUTES_RECOURSE_AUTHORITY = "Disputes/Recourse Authority";
const MOCK_NOTE = "mock backing; runtime ARRIVING; presentation-only, never authoritative";
const REPORTED_BY_AGENTS = `${AGENTS_MEDIATION_AUTHORITY} (${MOCK_NOTE})`;
const REPORTED_BY_DISPUTES = `${DISPUTES_RECOURSE_AUTHORITY} (${MOCK_NOTE})`;
const RESOLVED_BY_MEDIATION = `Mediation Authority — ${REPORTED_BY_AGENTS}`;
const RESOLVED_BY_DISPUTES = `Disputes/Recourse Authority (${MOCK_NOTE})`;

const ALL_ROLES: readonly PartyRole[] = [
  "customer",
  "merchant",
  "provider",
  "operator",
  "administrator",
];

const CUSTOMER: PartyRef = { role: "customer", label: "Priya N. (customer)" };
const MERCHANT: PartyRef = { role: "merchant", label: "Arbor Press Coffee (merchant)" };

const HARNESS_PROOF_HREF = "/verification/mediation-flow";

function nowIso(): string {
  return new Date().toISOString();
}

function proofFor(authorizationRef: string, trackingReference: string): EvidenceRef[] {
  return [
    { label: `Protocol authorization record ${authorizationRef}`, href: HARNESS_PROOF_HREF },
    { label: `Swap tracking record ${trackingReference}`, href: `/track/${trackingReference}` },
  ];
}

// ---------------------------------------------------------------------------
// Dispute grounds (frozen-set presentation of the Disputes/Recourse Authority)
// ---------------------------------------------------------------------------

const DISPUTE_GROUNDS: readonly DisputeGround[] = [
  {
    id: "goods-not-received",
    label: "Goods not received",
    description:
      "The quoted delivery window passed and the carrier has no delivery record for the reference you provide.",
    requiresEvidence: true,
  },
  {
    id: "goods-not-as-described",
    label: "Goods not as described",
    description:
      "What arrived materially differs from what the swap's quoted terms describe.",
    requiresEvidence: true,
  },
  {
    id: "settlement-mismatch",
    label: "Settlement mismatch",
    description:
      "The recorded settlement does not match the authority-quoted terms of the swap.",
    requiresEvidence: true,
  },
  {
    id: "authorization-disagreement",
    label: "Authorization disagreement",
    description:
      "You dispute that a decision on the reference was properly authorized under protocol rules.",
    requiresEvidence: false,
  },
  {
    id: "other-with-evidence",
    label: "Other (evidence required)",
    description:
      "Any other ground, provided you attach evidence the Disputes/Recourse Authority can verify.",
    requiresEvidence: true,
  },
];

const DISPUTE_INITIATION_BRIEFING: DisputeInitiationBriefing = {
  authority: REPORTED_BY_DISPUTES,
  grounds: DISPUTE_GROUNDS,
  consequences: [
    "Initiating a dispute pauses the automated completion of the referenced swap while the Disputes/Recourse Authority reviews your grounds (authority-quoted wording).",
    "The other party is notified that a dispute is open and sees the same authority wording you see.",
    "Your grounds, your account of what happened, and your evidence references are shared with the authority and the other party.",
    "Opening a dispute is recorded on the swap's proof trail; it cannot be silently withdrawn. Closing it follows the authority's recorded outcome wording.",
    "If the authority rejects your grounds, the dispute fails and the recorded protocol events stand.",
  ],
  whatHappensNext:
    "The Disputes/Recourse Authority acknowledges the dispute, reviews the grounds against the recorded protocol events, and either opens mediation between the parties or records its rejection wording on the dispute record.",
  consequenceOfInaction:
    "If no dispute is initiated before the swap completes per protocol, the recorded completion stands and later recourse paths narrow.",
};

// ---------------------------------------------------------------------------
// Seed data (sandbox data only)
// ---------------------------------------------------------------------------

interface MediationStore {
  proposals: Record<string, StoredProposal>;
  mediations: Record<string, StoredMediation>;
  disputes: Record<string, StoredDispute>;
  fetchUnreachable: { proposal: boolean; mediation: boolean; dispute: boolean; docket: boolean };
  sequence: number;
}

interface StoredProposal {
  record: Omit<AgentProposal, "viewerAuthorization">;
}

interface StoredMediation {
  record: Omit<MediationCase, "viewerActions">;
  partyAcceptances: PartyRole[];
}

interface StoredDispute {
  record: DisputeRecord;
}

const P001_CONSEQUENCES: ProposalConsequences = {
  ifAccepted: [
    "The swap completes at the originally quoted amount of $84.00 (authority-quoted); the waiting state ends immediately.",
    "The customer is notified right away with the acceptance wording and the completion proof.",
    "The acceptance is recorded on the swap's proof trail; a single party cannot undo it afterwards.",
  ],
  ifRejected: [
    "The swap stays in its current waiting state; nothing about the money moves changes.",
    "The agent will not re-propose this acceptance automatically; a new proposal would be required.",
    "If the wait continues past the authority-quoted window, the customer may open a dispute on this reference.",
  ],
  ifCountered: [
    "Your counter-terms are transmitted to the customer for an explicit accept/reject decision.",
    "The swap stays waiting until the customer decides or the counter's validity window closes.",
    "The counter and the customer's response are both recorded on the proof trail.",
  ],
  ifEscalated: [
    "The proposal moves to human review by the Agents/Mediation Authority.",
    "Escalation does not change the swap's current state while the review is pending.",
    "The authority's review outcome wording will be reported on this proposal when it completes.",
  ],
  financialImpact: { amount: "84.00", currency: "USD" },
  reversibility:
    "Once applied, an acceptance or rejection cannot be undone by a single party. Reversal requires a dispute and the Disputes/Recourse Authority.",
  validUntil: "Authority-quoted window: 72 hours from issuance; 31 hours remain.",
};

const P002_CONSEQUENCES: ProposalConsequences = {
  ifAccepted: [
    "The fulfillment window for your swap changes to the agent-proposed window (5 business days instead of 2); the quoted amount stays exactly the same.",
    "The merchant is notified of your consent with this wording and the updated window is recorded on the swap.",
    "Your consent is recorded on the proof trail; a single party cannot undo it afterwards.",
  ],
  ifRejected: [
    "The fulfillment window stays as originally quoted (2 business days).",
    "The merchant's agent is notified of the rejection wording; it will not re-propose automatically.",
    "If the original window then fails, either party may use the dispute path on this reference.",
  ],
  ifCountered: [
    "Your counter-window is transmitted to the merchant for an explicit decision.",
    "The swap keeps its original window until the merchant responds or the counter expires.",
  ],
  ifEscalated: [
    "The proposal moves to human review by the Agents/Mediation Authority.",
    "Escalation does not change your swap's current window while the review is pending.",
  ],
  reversibility:
    "Your decision is a one-time, protocol-authorized consent; it cannot be reversed unilaterally afterwards.",
  validUntil: "Authority-quoted window: 48 hours from issuance; 9 hours remain.",
};

const P003_CONSEQUENCES: ProposalConsequences = {
  ifAccepted: [
    "The swap settles at the partial-receipt amount of $46.50 (authority-quoted) instead of the quoted $52.00.",
    "The customer is notified with the settlement wording and the settlement proof.",
  ],
  ifRejected: [
    "The swap stays waiting for full receipt; the partial-receipt option lapses.",
  ],
  ifCountered: [
    "Your counter-terms are transmitted to the customer for an explicit decision.",
  ],
  ifEscalated: [
    "The proposal moves to human review by the Agents/Mediation Authority.",
  ],
  financialImpact: { amount: "46.50", currency: "USD" },
  reversibility:
    "A settlement decision is recorded on the proof trail and cannot be undone by a single party.",
  validUntil: "Authority-quoted window: closed — this proposal expired without a decision.",
};

const M101_PROPOSED_RESOLUTION = {
  wording:
    "The Mediation Authority proposes: the merchant re-ships the item within 72 hours; if the carrier records no delivery scan within 96 hours after re-ship, the swap settles to the customer at the quoted amount.",
  proposedBy: RESOLVED_BY_MEDIATION,
  validUntil: "Authority-quoted window: 48 hours from proposal issuance.",
};

function seed(): MediationStore {
  const proposals: Record<string, StoredProposal> = {
    "P-001": {
      record: {
        id: "P-001",
        reference: "PROPOSAL-SW2041-A",
        intentReference: "INTENT-2041",
        proposedBy: {
          agentId: "checkout-agent-07",
          agentLabel: "checkout-agent-07 — Arbor Press Coffee checkout agent",
        },
        onBehalfOf: MERCHANT,
        addressedTo: MERCHANT,
        counterparty: CUSTOMER,
        title: "Accept the customer's revised completion window on swap SW-2041",
        summary:
          "The customer asked for a 5-day completion window instead of the quoted 2 days. The agent proposes accepting the revised window; the quoted amount does not change. The agent cannot apply this itself: a human decision is required under protocol authorization.",
        consequences: P001_CONSEQUENCES,
        evidence: [
          { label: "Swap tracking record SW-2041", href: "/track/SW-2041" },
          { label: "Payment intent INTENT-2041", href: "/pay/INTENT-2041" },
          { label: "Customer window request (authority-verified copy)", href: "/track/SW-2041" },
        ],
        authorityState: "awaiting-decision",
      },
    },
    "P-002": {
      record: {
        id: "P-002",
        reference: "PROPOSAL-SW2041-B",
        intentReference: "INTENT-2041",
        proposedBy: {
          agentId: "fulfillment-agent-03",
          agentLabel: "fulfillment-agent-03 — Arbor Press Coffee fulfillment agent",
        },
        onBehalfOf: MERCHANT,
        addressedTo: CUSTOMER,
        counterparty: MERCHANT,
        title: "Consent to a fulfillment-window change on swap SW-2041",
        summary:
          "The merchant's agent proposes changing the fulfillment window to 5 business days. This needs your explicit consent: the window change is consequential and the agent cannot apply it itself.",
        consequences: P002_CONSEQUENCES,
        evidence: [
          { label: "Swap tracking record SW-2041", href: "/track/SW-2041" },
          { label: "Payment intent INTENT-2041", href: "/pay/INTENT-2041" },
        ],
        authorityState: "awaiting-decision",
      },
    },
    "P-003": {
      record: {
        id: "P-003",
        reference: "PROPOSAL-SW2033-A",
        intentReference: "INTENT-2033",
        proposedBy: {
          agentId: "settlement-agent-11",
          agentLabel: "settlement-agent-11 — Arbor Press Coffee settlement agent",
        },
        onBehalfOf: MERCHANT,
        addressedTo: MERCHANT,
        counterparty: CUSTOMER,
        title: "Accept a partial-receipt settlement on swap SW-2033",
        summary:
          "Part of the order (one of two cases) was confirmed delivered; the agent proposes settling at the partial amount. The validity window closed before a decision, so the proposal is expired.",
        consequences: P003_CONSEQUENCES,
        evidence: [
          { label: "Swap tracking record SW-2033", href: "/track/SW-2033" },
          { label: "Carrier partial-delivery scan (authority-verified copy)", href: "/track/SW-2033" },
        ],
        authorityState: "expired",
      },
    },
  };

  const mediations: Record<string, StoredMediation> = {
    "M-101": {
      record: {
        id: "M-101",
        reference: "MED-2038-01",
        subject: "Dispute over delivery of swap SW-2038",
        intentReference: "INTENT-2038",
        linkedDisputeId: "D-201",
        authorityState: "open",
        parties: [
          { party: CUSTOMER, status: "responded" },
          { party: MERCHANT, status: "responded" },
        ],
        messages: [
          {
            id: "M-101-msg-1",
            kind: "authority-notice",
            from: { role: "authority", label: RESOLVED_BY_MEDIATION },
            at: "2025-11-14T10:02:00Z",
            body: "Mediation opened by the Mediation Authority over the delivery of swap SW-2038. Both parties may submit statements; the authority will determine the outcome if the parties do not agree.",
            evidence: [
              { label: "Dispute record D-201", href: "/mediation/dispute/D-201" },
            ],
          },
          {
            id: "M-101-msg-2",
            kind: "party-statement",
            from: CUSTOMER,
            at: "2025-11-14T11:20:00Z",
            body: "The tracking page has shown \u201cout for delivery\u201d for nine days. I have not received the package and I want the swap settled per the quoted terms.",
          },
          {
            id: "M-101-msg-3",
            kind: "party-statement",
            from: MERCHANT,
            at: "2025-11-15T08:05:00Z",
            body: "Our carrier dashboard shows a delivery scan on the quoted delivery date. I attach the carrier event log as evidence.",
            evidence: [
              { label: "Carrier event log (authority-verified copy)", href: "/track/SW-2038" },
            ],
          },
        ],
        proposedResolution: M101_PROPOSED_RESOLUTION,
      },
      partyAcceptances: [],
    },
    "M-102": {
      record: {
        id: "M-102",
        reference: "MED-2033-01",
        subject: "Dispute over settlement mismatch on swap SW-2033",
        intentReference: "INTENT-2033",
        linkedDisputeId: "D-204",
        authorityState: "awaiting-party",
        parties: [
          { party: CUSTOMER, status: "responded" },
          { party: MERCHANT, status: "awaiting-response", since: "2025-11-16T09:00:00Z" },
        ],
        messages: [
          {
            id: "M-102-msg-1",
            kind: "authority-notice",
            from: { role: "authority", label: RESOLVED_BY_MEDIATION },
            at: "2025-11-16T09:00:00Z",
            body: "Mediation opened by the Mediation Authority over a claimed settlement mismatch on swap SW-2033. The customer has responded; the merchant has not yet responded.",
            evidence: [
              { label: "Dispute record D-204", href: "/mediation/dispute/D-204" },
            ],
          },
          {
            id: "M-102-msg-2",
            kind: "party-statement",
            from: CUSTOMER,
            at: "2025-11-16T12:40:00Z",
            body: "The settlement I see on my side is $46.50 but the quoted terms say $52.00. I want the mismatch reconciled by the authority.",
          },
        ],
      },
      partyAcceptances: [],
    },
    "M-103": {
      record: {
        id: "M-103",
        reference: "MED-2035-01",
        subject: "Dispute over settlement of swap SW-2035",
        intentReference: "INTENT-2035",
        linkedDisputeId: "D-202",
        authorityState: "resolved",
        parties: [
          { party: CUSTOMER, status: "responded" },
          { party: MERCHANT, status: "responded" },
        ],
        messages: [
          {
            id: "M-103-msg-1",
            kind: "authority-notice",
            from: { role: "authority", label: RESOLVED_BY_MEDIATION },
            at: "2025-11-06T14:00:00Z",
            body: "Mediation opened by the Mediation Authority over the settlement of swap SW-2035.",
            evidence: [
              { label: "Dispute record D-202", href: "/mediation/dispute/D-202" },
            ],
          },
          {
            id: "M-103-msg-2",
            kind: "party-statement",
            from: CUSTOMER,
            at: "2025-11-06T15:10:00Z",
            body: "The goods arrived damaged and I could not accept delivery; the quoted terms provide for settlement to me in this case.",
          },
          {
            id: "M-103-msg-3",
            kind: "authority-notice",
            from: { role: "authority", label: RESOLVED_BY_MEDIATION },
            at: "2025-11-08T09:30:00Z",
            body: "The Mediation Authority reviewed the carrier damage report and the quoted terms, and issued its determination.",
            evidence: [
              { label: "Carrier damage report (authority-verified copy)", href: "/track/SW-2035" },
            ],
          },
        ],
        resolution: {
          outcomeWording:
            "The Mediation Authority determined the merchant's proof of delivery is not conclusive for swap SW-2035: the carrier damage report supports the customer's claim. The swap settles to the customer at the quoted amount of $19.50 (authority-quoted).",
          resolvedBy: RESOLVED_BY_MEDIATION,
          resolvedAt: "2025-11-08T09:30:00Z",
          proof: [
            {
              label: "Mediation determination record MED-2035-01",
              href: HARNESS_PROOF_HREF,
            },
            { label: "Swap tracking record SW-2035", href: "/track/SW-2035" },
          ],
        },
      },
      partyAcceptances: ["customer", "merchant"],
    },
  };

  const disputes: Record<string, StoredDispute> = {
    "D-201": {
      record: {
        id: "D-201",
        reference: "DIS-2038-01",
        intentReference: "INTENT-2038",
        openedBy: CUSTOMER,
        against: MERCHANT,
        grounds: [DISPUTE_GROUNDS[0]],
        accountOfWhatHappened:
          "The quoted delivery window closed nine days ago and the carrier shows no delivery scan. I have not received the package.",
        evidence: [
          { label: "Swap tracking record SW-2038", href: "/track/SW-2038" },
          { label: "Carrier out-for-delivery events (authority-verified copy)", href: "/track/SW-2038" },
        ],
        authorityState: "in-mediation",
        linkedMediationId: "M-101",
        recourseTrail: [
          {
            id: "D-201-step-1",
            stage: "dispute-opened",
            title: "Dispute opened with the Disputes/Recourse Authority",
            authorityState: "completed",
            authority: RESOLVED_BY_DISPUTES,
            outcomeWording:
              "The Disputes/Recourse Authority accepted the dispute on the grounds \u201cgoods not received\u201d and paused automated completion of swap SW-2038.",
            at: "2025-11-13T16:45:00Z",
            proof: [
              { label: "Dispute initiation record DIS-2038-01", href: HARNESS_PROOF_HREF },
              { label: "Swap tracking record SW-2038", href: "/track/SW-2038" },
            ],
          },
          {
            id: "D-201-step-2",
            stage: "authority-grounds-review",
            title: "Authority grounds review",
            authorityState: "completed",
            authority: RESOLVED_BY_DISPUTES,
            outcomeWording:
              "The authority matched the cited grounds against the recorded protocol events and referred the dispute to mediation.",
            at: "2025-11-14T10:00:00Z",
            proof: [
              { label: "Grounds review record DIS-2038-01", href: HARNESS_PROOF_HREF },
            ],
          },
          {
            id: "D-201-step-3",
            stage: "mediation",
            title: "Mediation between the parties",
            authorityState: "in-progress",
            authority: RESOLVED_BY_MEDIATION,
            proof: [
              { label: "Mediation record MED-2038-01", href: "/mediation/case/M-101" },
            ],
          },
          {
            id: "D-201-step-4",
            stage: "federation-escalation",
            title: "Federation escalation path (per disputes-federation-blockchain-emergence.md)",
            authorityState: "pending",
            authority: RESOLVED_BY_DISPUTES,
            proof: [],
          },
          {
            id: "D-201-step-5",
            stage: "record-closure",
            title: "Dispute record closure",
            authorityState: "pending",
            authority: RESOLVED_BY_DISPUTES,
            proof: [],
          },
        ],
      },
    },
    "D-202": {
      record: {
        id: "D-202",
        reference: "DIS-2035-01",
        intentReference: "INTENT-2035",
        openedBy: CUSTOMER,
        against: MERCHANT,
        grounds: [DISPUTE_GROUNDS[2]],
        accountOfWhatHappened:
          "The goods arrived damaged; delivery could not be accepted. The quoted terms provide for settlement to me in this case.",
        evidence: [
          { label: "Carrier damage report (authority-verified copy)", href: "/track/SW-2035" },
        ],
        authorityState: "resolved",
        linkedMediationId: "M-103",
        resolution: {
          outcomeWording:
            "The Disputes Authority upheld the customer's claim on swap SW-2035. The swap settles to the customer at the quoted amount of $19.50 (authority-quoted).",
          resolvedBy: RESOLVED_BY_DISPUTES,
          resolvedAt: "2025-11-08T10:00:00Z",
          proof: [
            { label: "Mediation determination record MED-2035-01", href: HARNESS_PROOF_HREF },
            { label: "Swap tracking record SW-2035", href: "/track/SW-2035" },
          ],
        },
        recourseTrail: [
          {
            id: "D-202-step-1",
            stage: "dispute-opened",
            title: "Dispute opened with the Disputes/Recourse Authority",
            authorityState: "completed",
            authority: RESOLVED_BY_DISPUTES,
            outcomeWording:
              "The authority accepted the dispute on the grounds \u201csettlement mismatch\u201d and paused automated completion of swap SW-2035.",
            at: "2025-11-06T13:30:00Z",
            proof: [
              { label: "Dispute initiation record DIS-2035-01", href: HARNESS_PROOF_HREF },
            ],
          },
          {
            id: "D-202-step-2",
            stage: "authority-grounds-review",
            title: "Authority grounds review",
            authorityState: "completed",
            authority: RESOLVED_BY_DISPUTES,
            outcomeWording: "The authority referred the dispute to mediation.",
            at: "2025-11-06T14:00:00Z",
            proof: [{ label: "Grounds review record DIS-2035-01", href: HARNESS_PROOF_HREF }],
          },
          {
            id: "D-202-step-3",
            stage: "mediation-determination",
            title: "Mediation determination",
            authorityState: "completed",
            authority: RESOLVED_BY_MEDIATION,
            outcomeWording:
              "The Mediation Authority determined the merchant's proof of delivery is not conclusive; the swap settles to the customer at the quoted amount of $19.50 (authority-quoted).",
            at: "2025-11-08T09:30:00Z",
            proof: [
              { label: "Mediation determination record MED-2035-01", href: HARNESS_PROOF_HREF },
              { label: "Swap tracking record SW-2035", href: "/track/SW-2035" },
            ],
          },
          {
            id: "D-202-step-4",
            stage: "recourse-window",
            title: "Recourse window on the determined outcome",
            authorityState: "in-progress",
            authority: RESOLVED_BY_DISPUTES,
            outcomeWording:
              "The authority-quoted recourse window remains open for 14 days from the determination; within it, the parties may escalate under the federation path.",
            at: "2025-11-08T10:00:00Z",
            proof: [
              { label: "Recourse window record DIS-2035-01", href: HARNESS_PROOF_HREF },
            ],
          },
          {
            id: "D-202-step-5",
            stage: "federation-escalation",
            title: "Federation escalation path (per disputes-federation-blockchain-emergence.md)",
            authorityState: "pending",
            authority: RESOLVED_BY_DISPUTES,
            proof: [],
          },
        ],
      },
    },
    "D-203": {
      record: {
        id: "D-203",
        reference: "DIS-2029-01",
        intentReference: "INTENT-2029",
        openedBy: MERCHANT,
        against: CUSTOMER,
        grounds: [DISPUTE_GROUNDS[3]],
        accountOfWhatHappened:
          "The customer revoked authorization after the swap completed; we dispute that the revocation applies to a completed swap.",
        evidence: [
          { label: "Swap tracking record SW-2029", href: "/track/SW-2029" },
        ],
        authorityState: "failed",
        failure: {
          reason:
            "The Disputes Authority found the cited grounds did not match the recorded protocol events for swap SW-2029: the authorization revocation predates completion and is already reflected in the record.",
          nextActions: [
            "The recorded protocol events stand; the swap remains as recorded.",
            "A new dispute on this reference requires different grounds and new evidence.",
          ],
        },
        recourseTrail: [
          {
            id: "D-203-step-1",
            stage: "dispute-opened",
            title: "Dispute opened with the Disputes/Recourse Authority",
            authorityState: "completed",
            authority: RESOLVED_BY_DISPUTES,
            outcomeWording:
              "The authority accepted the dispute for review on the grounds \u201cauthorization disagreement\u201d.",
            at: "2025-11-02T09:12:00Z",
            proof: [{ label: "Dispute initiation record DIS-2029-01", href: HARNESS_PROOF_HREF }],
          },
          {
            id: "D-203-step-2",
            stage: "authority-grounds-review",
            title: "Authority grounds review",
            authorityState: "failed",
            authority: RESOLVED_BY_DISPUTES,
            outcomeWording:
              "The authority rejected the grounds: they did not match the recorded protocol events.",
            at: "2025-11-03T17:00:00Z",
            proof: [{ label: "Grounds review record DIS-2029-01", href: HARNESS_PROOF_HREF }],
          },
        ],
      },
    },
    "D-204": {
      record: {
        id: "D-204",
        reference: "DIS-2033-01",
        intentReference: "INTENT-2033",
        openedBy: CUSTOMER,
        against: MERCHANT,
        grounds: [DISPUTE_GROUNDS[2]],
        accountOfWhatHappened:
          "The settlement I see on my side is $46.50 but the quoted terms say $52.00 for swap SW-2033.",
        evidence: [
          { label: "Swap tracking record SW-2033", href: "/track/SW-2033" },
        ],
        authorityState: "open",
        linkedMediationId: "M-102",
        recourseTrail: [
          {
            id: "D-204-step-1",
            stage: "dispute-opened",
            title: "Dispute opened with the Disputes/Recourse Authority",
            authorityState: "completed",
            authority: RESOLVED_BY_DISPUTES,
            outcomeWording:
              "The authority accepted the dispute on the grounds \u201csettlement mismatch\u201d and referred it to mediation; the merchant has not yet responded in mediation.",
            at: "2025-11-16T09:00:00Z",
            proof: [
              { label: "Dispute initiation record DIS-2033-01", href: HARNESS_PROOF_HREF },
              { label: "Swap tracking record SW-2033", href: "/track/SW-2033" },
            ],
          },
          {
            id: "D-204-step-2",
            stage: "mediation",
            title: "Mediation between the parties",
            authorityState: "awaiting-party",
            authority: RESOLVED_BY_MEDIATION,
            outcomeWording: "Awaiting a response from the merchant in mediation.",
            at: "2025-11-16T09:00:00Z",
            proof: [
              { label: "Mediation record MED-2033-01", href: "/mediation/case/M-102" },
            ],
          },
        ],
      },
    },
  };

  return {
    proposals,
    mediations,
    disputes,
    fetchUnreachable: { proposal: false, mediation: false, dispute: false, docket: false },
    sequence: 1,
  };
}

let store: MediationStore = seed();

export function resetMockMediationAuthority(): void {
  store = seed();
}

// ---------------------------------------------------------------------------
// Authorization rules (presentation of protocol authorization)
// ---------------------------------------------------------------------------

const ROLE_LABELS: Record<PartyRole, string> = {
  customer: "A customer",
  merchant: "A merchant",
  provider: "A provider",
  operator: "An operator",
  administrator: "An administrator",
};

function proposalDecisionAuthorization(
  proposal: Omit<AgentProposal, "viewerAuthorization">,
  role: PartyRole,
  decision: ProposalDecisionKind,
): { authorized: boolean; reason: string } {
  if (proposal.authorityState === "expired") {
    return {
      authorized: false,
      reason:
        "The proposal's authority-quoted validity window closed. The Agents/Mediation Authority no longer accepts any decision on it.",
    };
  }
  if (proposal.authorityState.startsWith("decided-")) {
    return {
      authorized: false,
      reason:
        "A decision was already applied and recorded on this proposal. Decisions are single-shot; a new proposal is required for further changes.",
    };
  }
  if (proposal.authorityState === "authority-unreachable") {
    return {
      authorized: false,
      reason:
        "The Agents/Mediation Authority cannot currently report this proposal's state, so no decision can be accepted until the state is known.",
    };
  }
  if (decision === "counter" && role === proposal.addressedTo.role) {
    return {
      authorized: true,
      reason: `You are the party this proposal is addressed to; the authority authorizes you to counter it with explicit terms.`,
    };
  }
  if (role === proposal.addressedTo.role) {
    return {
      authorized: true,
      reason: `You are the party this proposal is addressed to (${proposal.addressedTo.label}); the Agents/Mediation Authority authorizes you to ${decision} it.`,
    };
  }
  if (role === proposal.counterparty.role) {
    return {
      authorized: false,
      reason: `Only ${proposal.addressedTo.label}, the party the proposal is addressed to, may decide it. You are the counterparty; you are notified of the outcome and may open a dispute if you disagree with it.`,
    };
  }
  if (role === "provider") {
    return {
      authorized: false,
      reason:
        "Providers do not decide agent proposals. Providers are notified of outcomes on surfaces they are party to.",
    };
  }
  if (role === "operator") {
    return {
      authorized: false,
      reason:
        "Operators oversee surfaces and availability; they never exercise party decisions.",
    };
  }
  return {
    authorized: false,
    reason:
      "Administrators never exercise a party's decision on the party's behalf; authorization stays with the addressed party.",
  };
}

function mediationActionAuthorization(
  mediation: Omit<MediationCase, "viewerActions">,
  acceptances: readonly PartyRole[],
  role: PartyRole,
  action: MediationActionKind,
): { authorized: boolean; reason: string } {
  const isParty = mediation.parties.some((entry) => entry.party.role === role);
  if (!isParty) {
    return {
      authorized: false,
      reason: "Only parties to a mediation may act in it; this surface is role-checked.",
    };
  }
  if (mediation.authorityState === "resolved") {
    return {
      authorized: false,
      reason:
        "The mediation is resolved with the authority's outcome wording; no further party actions are accepted.",
    };
  }
  if (mediation.authorityState === "failed") {
    return {
      authorized: false,
      reason:
        "The mediation failed; the authority's failure record and its next actions stand. Further process flows through the dispute's recourse path.",
    };
  }
  if (mediation.authorityState === "authority-unreachable") {
    return {
      authorized: false,
      reason:
        "The Mediation Authority cannot currently report this mediation's state; party actions are withheld until the state is known.",
    };
  }
  if (action === "submit-statement") {
    return {
      authorized: true,
      reason: "You are a party to this mediation and it is open for party statements.",
    };
  }
  if (!mediation.proposedResolution) {
    return {
      authorized: false,
      reason: "No proposed resolution is currently open on this mediation.",
    };
  }
  if (action === "accept-proposed-resolution") {
    if (acceptances.includes(role)) {
      return {
        authorized: false,
        reason: "Your acceptance of the proposed resolution is already recorded.",
      };
    }
    return {
      authorized: true,
      reason:
        "A proposed resolution is open and you are a party; every party's acceptance is required before the Mediation Authority applies it.",
    };
  }
  return {
    authorized: true,
    reason:
      "You are a party and a proposed resolution is open; declining it records your disagreement and the authority will then determine the outcome.",
  };
}

function disputeInitiationAuthorization(
  intentReference: string,
  role: PartyRole,
): { authorized: boolean; reason: string } {
  const intent = DISPUTABLE_INTENTS.find((entry) => entry.reference === intentReference);
  if (!intent) {
    return {
      authorized: false,
      reason: `The Disputes/Recourse Authority does not know a swap with reference ${intentReference}.`,
    };
  }
  if (!intent.parties.includes(role)) {
    return {
      authorized: false,
      reason:
        "Only a party to the referenced swap (its customer or its merchant) may initiate a dispute on it.",
    };
  }
  const openDispute = Object.values(store.disputes).find(
    (entry) =>
      entry.record.intentReference === intentReference &&
      (entry.record.authorityState === "open" ||
        entry.record.authorityState === "in-mediation"),
  );
  if (openDispute) {
    return {
      authorized: false,
      reason: `A dispute (${openDispute.record.id}) is already open for this reference. The authority does not accept a second dispute on the same reference while one is open.`,
    };
  }
  const resolvedDispute = Object.values(store.disputes).find(
    (entry) =>
      entry.record.intentReference === intentReference &&
      entry.record.authorityState === "resolved",
  );
  if (resolvedDispute) {
    return {
      authorized: false,
      reason: `The dispute record ${resolvedDispute.record.id} for this reference is resolved. Recourse for a resolved record flows through its recourse window, not a new initiation.`,
    };
  }
  return {
    authorized: true,
    reason:
      "You are a party to the referenced swap and no open dispute exists on it; the authority can accept a dispute initiation from you.",
  };
}

const DISPUTABLE_INTENTS: readonly DisputableIntent[] = [
  {
    reference: "INTENT-2041",
    label: "Swap SW-2041 — quoted amount $84.00 (authority-quoted)",
    amount: { amount: "84.00", currency: "USD" },
    parties: ["customer", "merchant"],
  },
  {
    reference: "INTENT-2038",
    label: "Swap SW-2038 — quoted amount $46.50 (authority-quoted)",
    amount: { amount: "46.50", currency: "USD" },
    parties: ["customer", "merchant"],
  },
  {
    reference: "INTENT-2035",
    label: "Swap SW-2035 — quoted amount $19.50 (authority-quoted)",
    amount: { amount: "19.50", currency: "USD" },
    parties: ["customer", "merchant"],
  },
];

// ---------------------------------------------------------------------------
// Visibility (role-checked deep links)
// ---------------------------------------------------------------------------

function proposalVisibleTo(
  proposal: Omit<AgentProposal, "viewerAuthorization">,
  viewer: PartyRole,
): boolean {
  return viewer === proposal.addressedTo.role || viewer === proposal.counterparty.role;
}

function mediationVisibleTo(
  mediation: Omit<MediationCase, "viewerActions">,
  viewer: PartyRole,
): boolean {
  return mediation.parties.some((entry) => entry.party.role === viewer);
}

function disputeVisibleTo(dispute: DisputeRecord, viewer: PartyRole): boolean {
  return dispute.openedBy.role === viewer || dispute.against.role === viewer;
}

function withViewerAuthorization(
  proposal: Omit<AgentProposal, "viewerAuthorization">,
  viewer: PartyRole,
): AgentProposal {
  const decisions: readonly ProposalDecisionKind[] = ["accept", "reject", "counter", "escalate"];
  const viewerAuthorization: DecisionAuthorizationEntry[] = decisions.map((decision) => {
    const rule = proposalDecisionAuthorization(proposal, viewer, decision);
    return { decision, authorized: rule.authorized, reason: rule.reason };
  });
  return { ...proposal, viewerAuthorization };
}

function withViewerActions(
  mediation: Omit<MediationCase, "viewerActions">,
  acceptances: readonly PartyRole[],
  viewer: PartyRole,
): MediationCase {
  const actions: readonly MediationActionKind[] = [
    "submit-statement",
    "accept-proposed-resolution",
    "decline-proposed-resolution",
  ];
  const viewerActions: MediationActionAuthorization[] = actions.map((action) => {
    const rule = mediationActionAuthorization(mediation, acceptances, viewer, action);
    return { action, authorized: rule.authorized, reason: rule.reason };
  });
  return { ...mediation, viewerActions };
}

// ---------------------------------------------------------------------------
// Mock authority implementation
// ---------------------------------------------------------------------------

function cloneProposalDecisionOutcome(
  proposalId: string,
  decision: ProposalDecisionKind,
  decidedBy: PartyRef,
  outcomeWording: string,
  authorizationRef: string,
  trackingReference: string,
): ProposalDecisionResult {
  const stored = store.proposals[proposalId];
  if (!stored) {
    return { kind: "denied", reason: `No proposal with id ${proposalId} is known to the ${AGENTS_MEDIATION_AUTHORITY}.` };
  }
  const proof = proofFor(authorizationRef, trackingReference);
  stored.record = {
    ...stored.record,
    authorityState:
      decision === "accept"
        ? "decided-accepted"
        : decision === "reject"
          ? "decided-rejected"
          : decision === "counter"
            ? "decided-counter-proposed"
            : "decided-escalated",
    decision: {
      decision,
      decidedBy,
      decidedAt: nowIso(),
      authorizationRef,
      outcomeWording,
      proof,
    },
  };
  return {
    kind: "applied",
    record: withViewerAuthorization(stored.record, decidedBy.role),
    authorizationRef,
    proof,
  };
}

export function getMockMediationAuthority(): MediationPort {
  return {
    async getPartyDocket(viewer: PartyRole): Promise<PortFetch<PartyDocket>> {
      if (store.fetchUnreachable.docket) {
        return {
          kind: "unavailable",
          target: `${AGENTS_MEDIATION_AUTHORITY} + ${DISPUTES_RECOURSE_AUTHORITY} docket query`,
          detail:
            "The authorities backing this surface cannot currently report your docket. Nothing is assumed; recheck before acting.",
        };
      }
      const viewerLabel =
        viewer === "customer" ? CUSTOMER.label : viewer === "merchant" ? MERCHANT.label : ROLE_LABELS[viewer];
      const proposals = Object.values(store.proposals)
        .filter((entry) => entry.record.addressedTo.role === viewer)
        .map((entry) => withViewerAuthorization(entry.record, viewer));
      const mediations = Object.values(store.mediations)
        .filter((entry) => mediationVisibleTo(entry.record, viewer))
        .map((entry) => withViewerActions(entry.record, entry.partyAcceptances, viewer));
      const disputes = Object.values(store.disputes)
        .filter((entry) => disputeVisibleTo(entry.record, viewer))
        .map((entry) => entry.record);
      return {
        kind: "fetched",
        record: { viewer, viewerLabel, proposals, mediations, disputes, disputableIntents: DISPUTABLE_INTENTS },
      };
    },

    async getProposal({ proposalId, viewer }): Promise<PortFetch<AgentProposal>> {
      if (store.fetchUnreachable.proposal) {
        return {
          kind: "unavailable",
          target: AGENTS_MEDIATION_AUTHORITY,
          detail: `The authority cannot currently report proposal ${proposalId}.`,
        };
      }
      const stored = store.proposals[proposalId];
      if (!stored) {
        return {
          kind: "not-visible",
          reason: `No proposal with id ${proposalId} is visible to your role. Deep links are role-checked: only the addressed party and the counterparty may open a proposal.`,
        };
      }
      if (!proposalVisibleTo(stored.record, viewer)) {
        return {
          kind: "not-visible",
          reason: `Proposal ${proposalId} exists but is not visible to your role. Only the addressed party and the counterparty may open it.`,
        };
      }
      return { kind: "fetched", record: withViewerAuthorization(stored.record, viewer) };
    },

    async getMediationCase({ caseId, viewer }): Promise<PortFetch<MediationCase>> {
      if (store.fetchUnreachable.mediation) {
        return {
          kind: "unavailable",
          target: AGENTS_MEDIATION_AUTHORITY,
          detail: `The authority cannot currently report mediation ${caseId}.`,
        };
      }
      const stored = store.mediations[caseId];
      if (!stored) {
        return {
          kind: "not-visible",
          reason: `No mediation with id ${caseId} is visible to your role. Deep links are role-checked: only parties to a mediation may open it.`,
        };
      }
      if (!mediationVisibleTo(stored.record, viewer)) {
        return {
          kind: "not-visible",
          reason: `Mediation ${caseId} exists but you are not a party to it. Only parties may open a mediation thread.`,
        };
      }
      return {
        kind: "fetched",
        record: withViewerActions(stored.record, stored.partyAcceptances, viewer),
      };
    },

    async getDispute({ disputeId, viewer }): Promise<PortFetch<DisputeRecord>> {
      if (store.fetchUnreachable.dispute) {
        return {
          kind: "unavailable",
          target: DISPUTES_RECOURSE_AUTHORITY,
          detail: `The authority cannot currently report dispute ${disputeId}.`,
        };
      }
      const stored = store.disputes[disputeId];
      if (!stored) {
        return {
          kind: "not-visible",
          reason: `No dispute with id ${disputeId} is visible to your role. Deep links are role-checked: only the parties to a dispute may open it.`,
        };
      }
      if (!disputeVisibleTo(stored.record, viewer)) {
        return {
          kind: "not-visible",
          reason: `Dispute ${disputeId} exists but you are not a party to it. Only the parties may open a dispute record.`,
        };
      }
      return { kind: "fetched", record: stored.record };
    },

    async getDisputeInitiationBriefing(): Promise<DisputeInitiationBriefing> {
      return DISPUTE_INITIATION_BRIEFING;
    },

    async submitProposalDecision(request: ProposalDecisionRequest): Promise<ProposalDecisionResult> {
      const stored = store.proposals[request.proposalId];
      if (!stored) {
        return {
          kind: "denied",
          reason: `No proposal with id ${request.proposalId} is known to the ${AGENTS_MEDIATION_AUTHORITY}.`,
        };
      }
      const rule = proposalDecisionAuthorization(stored.record, request.actor, request.decision);
      if (!rule.authorized) {
        return { kind: "denied", reason: rule.reason };
      }
      const decidedBy: PartyRef =
        request.actor === "customer"
          ? CUSTOMER
          : request.actor === "merchant"
            ? MERCHANT
            : { role: request.actor, label: ROLE_LABELS[request.actor] };
      const counterpartyLabel =
        request.actor === stored.record.addressedTo.role
          ? stored.record.counterparty.label
          : stored.record.addressedTo.label;
      const authorizationRef = `AUTHZ-${request.proposalId}-${request.decision}-${request.actor}-${store.sequence}`;
      store.sequence += 1;
      const trackingReference = stored.record.intentReference.replace("INTENT-", "SW-");

      if (request.decision === "counter") {
        const terms = request.counterTerms?.trim() ?? "";
        if (terms.length < 10) {
          return {
            kind: "denied",
            reason:
              "A counter requires explicit terms. The authority cannot submit a counter without substantive terms (at least 10 characters).",
          };
        }
        const wording = `Counter-terms from ${decidedBy.label} were recorded and transmitted to ${counterpartyLabel} for an explicit decision under protocol authorization.`;
        const result = cloneProposalDecisionOutcome(
          request.proposalId,
          "counter",
          decidedBy,
          wording,
          authorizationRef,
          trackingReference,
        );
        // A counter spawns a decision proposal addressed to the counterparty.
        const counterId = `P-1${String(100 + store.sequence).slice(-3)}`;
        store.sequence += 1;
        const counterProposal: Omit<AgentProposal, "viewerAuthorization"> = {
          id: counterId,
          reference: `PROPOSAL-${trackingReference}-C${store.sequence}`,
          intentReference: stored.record.intentReference,
          proposedBy: { agentId: "mediation-clerk", agentLabel: "Mediation Authority clerk (mock)" },
          onBehalfOf: decidedBy,
          addressedTo: stored.record.counterparty.role === request.actor
            ? { role: stored.record.addressedTo.role, label: stored.record.addressedTo.label }
            : { role: stored.record.counterparty.role, label: stored.record.counterparty.label },
          counterparty: decidedBy,
          title: `Counter-terms from ${decidedBy.label} on swap ${trackingReference} — your decision`,
          summary: `Counter-terms transmitted under protocol authorization: \u201c${terms}\u201d Your explicit decision is required; nothing is applied until you decide.`,
          consequences: {
            ifAccepted: [
              `The counter-terms from ${decidedBy.label} are applied as the recorded agreement on swap ${trackingReference}.`,
              "The acceptance is recorded on the swap's proof trail and cannot be undone by a single party.",
            ],
            ifRejected: [
              "The counter-terms lapse; the swap stays in its current state.",
              "The counterparty is notified with the rejection wording.",
            ],
            ifCountered: [
              "Your own counter-terms are transmitted back for an explicit decision.",
            ],
            ifEscalated: [
              "The disagreement moves to human review by the Agents/Mediation Authority.",
            ],
            reversibility:
              "Once decided, the outcome is recorded on the proof trail; a single party cannot undo it.",
            validUntil: "Authority-quoted window: 48 hours from transmission.",
          },
          evidence: [
            { label: `Counter authorization record ${authorizationRef}`, href: HARNESS_PROOF_HREF },
            { label: `Swap tracking record ${trackingReference}`, href: `/track/${trackingReference}` },
          ],
          authorityState: "awaiting-decision",
          spawnedFromProposalId: request.proposalId,
        };
        store.proposals[counterId] = { record: counterProposal };
        return result;
      }

      const wording =
        request.decision === "accept"
          ? `The acceptance by ${decidedBy.label} was recorded by the ${AGENTS_MEDIATION_AUTHORITY} and applied under protocol authorization. The accepted consequences now stand.`
          : request.decision === "reject"
            ? `The rejection by ${decidedBy.label} was recorded by the ${AGENTS_MEDIATION_AUTHORITY}. The proposal is closed; the rejected consequences now stand.`
            : `The escalation by ${decidedBy.label} was recorded. The proposal is under human review by the ${AGENTS_MEDIATION_AUTHORITY}; the review's outcome wording will be reported on this proposal when it completes.`;
      return cloneProposalDecisionOutcome(
        request.proposalId,
        request.decision,
        decidedBy,
        wording,
        authorizationRef,
        trackingReference,
      );
    },

    async submitMediationAction(request: MediationActionRequest): Promise<MediationActionResult> {
      const stored = store.mediations[request.caseId];
      if (!stored) {
        return {
          kind: "denied",
          reason: `No mediation with id ${request.caseId} is known to the ${AGENTS_MEDIATION_AUTHORITY}.`,
        };
      }
      const rule = mediationActionAuthorization(
        stored.record,
        stored.partyAcceptances,
        request.actor,
        request.action,
      );
      if (!rule.authorized) {
        return { kind: "denied", reason: rule.reason };
      }
      const actor: PartyRef =
        request.actor === "customer"
          ? CUSTOMER
          : request.actor === "merchant"
            ? MERCHANT
            : { role: request.actor, label: ROLE_LABELS[request.actor] };
      const authorizationRef = `AUTHZ-${request.caseId}-${request.action}-${request.actor}-${store.sequence}`;
      store.sequence += 1;
      const trackingReference = stored.record.intentReference.replace("INTENT-", "SW-");
      const proof = proofFor(authorizationRef, trackingReference);
      const at = nowIso();
      const messages = [...stored.record.messages];

      if (request.action === "submit-statement") {
        const statement = request.statement?.trim() ?? "";
        if (statement.length < 10) {
          return {
            kind: "denied",
            reason:
              "A statement requires substantive text (at least 10 characters); the authority cannot record an empty statement.",
          };
        }
        messages.push({
          id: `${request.caseId}-msg-${messages.length + 1}`,
          kind: "party-statement",
          from: actor,
          at,
          body: statement,
        });
        const parties = stored.record.parties.map((entry) =>
          entry.party.role === request.actor && entry.status === "awaiting-response"
            ? { ...entry, status: "responded" as const }
            : entry,
        );
        const allResponded = parties.every((entry) => entry.status === "responded");
        stored.record = {
          ...stored.record,
          parties,
          messages,
          authorityState:
            stored.record.authorityState === "awaiting-party" && allResponded
              ? "open"
              : stored.record.authorityState,
        };
        return {
          kind: "applied",
          record: withViewerActions(stored.record, stored.partyAcceptances, request.actor),
          authorizationRef,
          proof,
        };
      }

      if (!stored.record.proposedResolution) {
        return {
          kind: "denied",
          reason: "No proposed resolution is currently open on this mediation.",
        };
      }

      if (request.action === "accept-proposed-resolution") {
        stored.partyAcceptances = [...stored.partyAcceptances, request.actor];
        messages.push({
          id: `${request.caseId}-msg-${messages.length + 1}`,
          kind: "system-note",
          from: { role: "authority", label: RESOLVED_BY_MEDIATION },
          at,
          body: `${actor.label} accepted the proposed resolution. Acceptance is recorded under protocol authorization ${authorizationRef}.`,
          evidence: [{ label: `Authorization record ${authorizationRef}`, href: HARNESS_PROOF_HREF }],
        });
        const allPartiesAccepted = stored.record.parties.every((entry) =>
          stored.partyAcceptances.includes(entry.party.role),
        );
        if (allPartiesAccepted) {
          const outcomeWording = `Both parties accepted the proposed resolution: ${stored.record.proposedResolution.wording}`;
          stored.record = {
            ...stored.record,
            authorityState: "resolved",
            messages,
            proposedResolution: undefined,
            resolution: {
              outcomeWording,
              resolvedBy: RESOLVED_BY_MEDIATION,
              resolvedAt: at,
              proof,
            },
          };
          resolveLinkedDisputeFromMediation(request.caseId, outcomeWording, proof);
        } else {
          stored.record = { ...stored.record, messages };
        }
        return {
          kind: "applied",
          record: withViewerActions(stored.record, stored.partyAcceptances, request.actor),
          authorizationRef,
          proof,
        };
      }

      // decline-proposed-resolution
      messages.push({
        id: `${request.caseId}-msg-${messages.length + 1}`,
        kind: "system-note",
        from: { role: "authority", label: RESOLVED_BY_MEDIATION },
        at,
        body: `${actor.label} declined the proposed resolution. The Mediation Authority will determine the outcome; the determination's wording will appear here.`,
        evidence: [{ label: `Authorization record ${authorizationRef}`, href: HARNESS_PROOF_HREF }],
      });
      stored.record = {
        ...stored.record,
        messages,
        proposedResolution: undefined,
      };
      return {
        kind: "applied",
        record: withViewerActions(stored.record, stored.partyAcceptances, request.actor),
        authorizationRef,
        proof,
      };
    },

    async initiateDispute(request: DisputeInitiationRequest): Promise<DisputeInitiationResult> {
      const rule = disputeInitiationAuthorization(request.intentReference, request.actor);
      if (!rule.authorized) {
        return { kind: "denied", reason: rule.reason };
      }
      if (request.grounds.length === 0) {
        return {
          kind: "denied",
          reason: "A dispute requires at least one explicit ground; the authority cannot record a groundless dispute.",
        };
      }
      const knownGrounds = request.grounds.every((id) =>
        DISPUTE_GROUNDS.some((ground) => ground.id === id),
      );
      if (!knownGrounds) {
        return {
          kind: "denied",
          reason: "One or more cited grounds are not part of the authority's ground set.",
        };
      }
      const completeEvidence = request.evidence.filter(
        (entry) => entry.label.trim().length > 0 && entry.href.trim().length > 0,
      );
      const evidenceRequired = request.grounds.some((id) => {
        const ground = DISPUTE_GROUNDS.find((entry) => entry.id === id);
        return ground?.requiresEvidence ?? true;
      });
      if (evidenceRequired && completeEvidence.length === 0) {
        return {
          kind: "denied",
          reason:
            "The cited grounds require evidence. Attach at least one complete evidence reference (label plus link) the authority can verify.",
        };
      }
      const account = request.accountOfWhatHappened.trim();
      if (account.length < 30) {
        return {
          kind: "denied",
          reason:
            "The authority requires a substantive account of what happened (at least 30 characters).",
        };
      }
      const actor: PartyRef =
        request.actor === "customer"
          ? CUSTOMER
          : request.actor === "merchant"
            ? MERCHANT
            : { role: request.actor, label: ROLE_LABELS[request.actor] };
      const against: PartyRef =
        request.actor === "customer" ? MERCHANT : request.actor === "merchant" ? CUSTOMER : MERCHANT;
      const disputeId = `D-2${String(10 + store.sequence).padStart(2, "0")}`;
      store.sequence += 1;
      const reference = `DIS-${request.intentReference.replace("INTENT-", "")}-${store.sequence}`;
      const trackingReference = request.intentReference.replace("INTENT-", "SW-");
      const grounds = request.grounds
        .map((id) => DISPUTE_GROUNDS.find((ground) => ground.id === id))
        .filter((ground): ground is DisputeGround => Boolean(ground));
      const dispute: DisputeRecord = {
        id: disputeId,
        reference,
        intentReference: request.intentReference,
        openedBy: actor,
        against,
        grounds,
        accountOfWhatHappened: account,
        evidence: completeEvidence,
        authorityState: "open",
        recourseTrail: [
          {
            id: `${disputeId}-step-1`,
            stage: "dispute-opened",
            title: "Dispute opened with the Disputes/Recourse Authority",
            authorityState: "completed",
            authority: RESOLVED_BY_DISPUTES,
            outcomeWording: `The Disputes/Recourse Authority accepted the dispute from ${actor.label} on the cited grounds and paused automated completion of swap ${trackingReference}.`,
            at: nowIso(),
            proof: [
              { label: `Dispute initiation record ${reference}`, href: HARNESS_PROOF_HREF },
              { label: `Swap tracking record ${trackingReference}`, href: `/track/${trackingReference}` },
            ],
          },
          {
            id: `${disputeId}-step-2`,
            stage: "authority-grounds-review",
            title: "Authority grounds review",
            authorityState: "in-progress",
            authority: RESOLVED_BY_DISPUTES,
            proof: [],
          },
        ],
      };
      store.disputes[disputeId] = { record: dispute };
      return { kind: "initiated", record: dispute, reference };
    },

    async describeProposalDecisionMatrix({ proposalId }): Promise<readonly RoleAuthorizationRow[]> {
      const stored = store.proposals[proposalId];
      if (!stored) return [];
      const decisions: readonly ProposalDecisionKind[] = ["accept", "reject", "counter", "escalate"];
      return ALL_ROLES.map((role) => ({
        role,
        label: role === "customer" ? CUSTOMER.label : role === "merchant" ? MERCHANT.label : ROLE_LABELS[role],
        entries: decisions.map((decision) => {
          const rule = proposalDecisionAuthorization(stored.record, role, decision);
          return { decision, authorized: rule.authorized, reason: rule.reason };
        }),
      }));
    },

    async describeMediationActionMatrix({ caseId }): Promise<readonly MediationRoleAuthorizationRow[]> {
      const stored = store.mediations[caseId];
      if (!stored) return [];
      const actions: readonly MediationActionKind[] = [
        "submit-statement",
        "accept-proposed-resolution",
        "decline-proposed-resolution",
      ];
      return ALL_ROLES.map((role) => ({
        role,
        label: role === "customer" ? CUSTOMER.label : role === "merchant" ? MERCHANT.label : ROLE_LABELS[role],
        entries: actions.map((action) => {
          const rule = mediationActionAuthorization(stored.record, stored.partyAcceptances, role, action);
          return { action, authorized: rule.authorized, reason: rule.reason };
        }),
      }));
    },

    async describeDisputeInitiationMatrix({ intentReference }): Promise<readonly DisputeInitiationMatrixRow[]> {
      return ALL_ROLES.map((role) => {
        const rule = disputeInitiationAuthorization(intentReference, role);
        return {
          role,
          label: role === "customer" ? CUSTOMER.label : role === "merchant" ? MERCHANT.label : ROLE_LABELS[role],
          authorized: rule.authorized,
          reason: rule.reason,
        };
      });
    },

    async applyHarnessScript(script: MediationHarnessScript): Promise<{ applied: string; note: string }> {
      const note =
        "Harness script applied to the presentation-only mock. Proposal decisions are never scripted: they only flow through submitProposalDecision under per-role authorization.";
      switch (script.type) {
        case "reset": {
          resetMockMediationAuthority();
          return { applied: "reset — mock reseeded with sandbox defaults", note };
        }
        case "set-proposal-state": {
          const stored = store.proposals[script.proposalId];
          if (!stored) {
            return { applied: "refused — unknown proposal", note };
          }
          if (String(script.authorityState).startsWith("decided-")) {
            return {
              applied: "refused",
              note:
                "Scripting a proposal decision outcome is refused: decisions only flow through submitProposalDecision under per-role authorization.",
            };
          }
          stored.record = { ...stored.record, authorityState: script.authorityState, decision: undefined };
          return { applied: `proposal ${script.proposalId} authority state set to ${script.authorityState}`, note };
        }
        case "set-mediation-state": {
          const stored = store.mediations[script.caseId];
          if (!stored) {
            return { applied: "refused — unknown mediation", note };
          }
          const record = { ...stored.record };
          record.authorityState = script.authorityState;
          record.proposedResolution = undefined;
          record.resolution = undefined;
          record.failure = undefined;
          record.unknown = undefined;
          if (script.authorityState === "resolved") {
            record.resolution = {
              outcomeWording:
                script.resolutionWording ??
                "The Mediation Authority recorded its determination: the proposed agreement applies and the mediation is resolved with this wording.",
              resolvedBy: RESOLVED_BY_MEDIATION,
              resolvedAt: nowIso(),
              proof: proofFor(`SCRIPT-${script.caseId}`, record.intentReference.replace("INTENT-", "SW-")),
            };
          } else if (script.authorityState === "failed") {
            record.failure = {
              reason:
                script.failureReason ??
                "The mediation participation window closed without every party responding.",
              nextActions:
                script.nextActions ?? [
                  "The parties may continue on the dispute's recourse path, which this failure does not close.",
                  "The authority records this failure as proof on the dispute record.",
                ],
            };
          } else if (script.authorityState === "authority-unreachable") {
            record.unknown = {
              explanation: `The ${AGENTS_MEDIATION_AUTHORITY} cannot currently report the state of mediation ${script.caseId}. No state is assumed.`,
              reconciliation: {
                whoResolves: `The ${AGENTS_MEDIATION_AUTHORITY} (its availability is surfaced on the operator oversight surface)`,
                recheckTrigger:
                  "Recheck from this surface or from the verification harness; the reconciliation path is recorded either way.",
              },
            };
          }
          stored.record = record;
          return { applied: `mediation ${script.caseId} authority state set to ${script.authorityState}`, note };
        }
        case "set-proposed-resolution": {
          const stored = store.mediations[script.caseId];
          if (!stored) {
            return { applied: "refused — unknown mediation", note };
          }
          stored.record = {
            ...stored.record,
            authorityState: stored.record.authorityState === "authority-unreachable" ? "open" : stored.record.authorityState,
            proposedResolution: {
              wording:
                script.wording ??
                "The Mediation Authority proposes: the parties settle at the quoted amount and the swap completes; both parties' explicit acceptance is required.",
              proposedBy: RESOLVED_BY_MEDIATION,
              validUntil: script.validUntil ?? "Authority-quoted window: 48 hours from proposal issuance.",
            },
          };
          stored.partyAcceptances = [];
          return { applied: `proposed resolution set on mediation ${script.caseId}`, note };
        }
        case "clear-proposed-resolution": {
          const stored = store.mediations[script.caseId];
          if (!stored) {
            return { applied: "refused — unknown mediation", note };
          }
          stored.record = { ...stored.record, proposedResolution: undefined };
          stored.partyAcceptances = [];
          return { applied: `proposed resolution cleared on mediation ${script.caseId}`, note };
        }
        case "add-authority-notice": {
          const stored = store.mediations[script.caseId];
          if (!stored) {
            return { applied: "refused — unknown mediation", note };
          }
          stored.record = {
            ...stored.record,
            messages: [
              ...stored.record.messages,
              {
                id: `${script.caseId}-msg-${stored.record.messages.length + 1}`,
                kind: "authority-notice",
                from: { role: "authority", label: RESOLVED_BY_MEDIATION },
                at: nowIso(),
                body: script.body,
              },
            ],
          };
          return { applied: `authority notice appended to mediation ${script.caseId}`, note };
        }
        case "set-dispute-state": {
          const stored = store.disputes[script.disputeId];
          if (!stored) {
            return { applied: "refused — unknown dispute", note };
          }
          const record: DisputeRecord = { ...stored.record };
          record.authorityState = script.authorityState;
          record.resolution = undefined;
          record.failure = undefined;
          record.unknown = undefined;
          if (script.authorityState === "resolved") {
            record.resolution = {
              outcomeWording:
                script.resolutionWording ??
                "The Disputes/Recourse Authority recorded its determination and the dispute is resolved with this wording.",
              resolvedBy: RESOLVED_BY_DISPUTES,
              resolvedAt: nowIso(),
              proof: proofFor(`SCRIPT-${script.disputeId}`, record.intentReference.replace("INTENT-", "SW-")),
            };
          } else if (script.authorityState === "failed") {
            record.failure = {
              reason:
                script.failureReason ??
                "The Disputes/Recourse Authority rejected the cited grounds against the recorded protocol events.",
              nextActions: [
                "The recorded protocol events stand.",
                "A new dispute on this reference requires different grounds and new evidence.",
              ],
            };
          } else if (script.authorityState === "authority-unreachable") {
            record.unknown = {
              explanation: `The ${DISPUTES_RECOURSE_AUTHORITY} cannot currently report the state of dispute ${script.disputeId}. No state is assumed.`,
              reconciliation: {
                whoResolves: `The ${DISPUTES_RECOURSE_AUTHORITY} (its availability is surfaced on the operator oversight surface)`,
                recheckTrigger:
                  "Recheck from this surface or from the verification harness; the reconciliation path is recorded either way.",
              },
            };
          }
          stored.record = record;
          return { applied: `dispute ${script.disputeId} authority state set to ${script.authorityState}`, note };
        }
        case "advance-recourse": {
          const stored = store.disputes[script.disputeId];
          if (!stored) {
            return { applied: "refused — unknown dispute", note };
          }
          const step = stored.record.recourseTrail.find((entry) => entry.id === script.stepId);
          if (!step) {
            return { applied: "refused — unknown recourse step", note };
          }
          const next =
            step.authorityState === "pending"
              ? "in-progress"
              : step.authorityState === "in-progress" || step.authorityState === "awaiting-party"
                ? "completed"
                : "completed";
          const proof =
            next === "completed"
              ? proofFor(`SCRIPT-${script.disputeId}-${script.stepId}`, stored.record.intentReference.replace("INTENT-", "SW-"))
              : step.proof;
          stored.record = {
            ...stored.record,
            recourseTrail: stored.record.recourseTrail.map((entry) =>
              entry.id === script.stepId
                ? {
                    ...entry,
                    authorityState: next as typeof entry.authorityState,
                    outcomeWording:
                      next === "completed"
                        ? (entry.outcomeWording ??
                          `The ${entry.authority} recorded this stage's outcome with its proof.`)
                        : entry.outcomeWording,
                    at: next === "completed" ? nowIso() : entry.at,
                    proof,
                  }
                : entry,
            ),
          };
          return {
            applied: `recourse step ${script.stepId} on dispute ${script.disputeId} advanced to ${next}`,
            note,
          };
        }
        case "set-fetch-availability": {
          store.fetchUnreachable[script.scope] = script.unreachable;
          return {
            applied: `fetch availability for scope ${script.scope} set to ${script.unreachable ? "unreachable" : "reachable"}`,
            note,
          };
        }
        default: {
          return { applied: "refused — unknown script", note };
        }
      }
    },
  };
}

function resolveLinkedDisputeFromMediation(
  caseId: string,
  outcomeWording: string,
  proof: readonly EvidenceRef[],
): void {
  const stored = Object.values(store.disputes).find(
    (entry) => entry.record.linkedMediationId === caseId,
  );
  if (!stored) return;
  stored.record = {
    ...stored.record,
    authorityState: "resolved",
    resolution: {
      outcomeWording: `The dispute closed with the mediation's outcome: ${outcomeWording}`,
      resolvedBy: RESOLVED_BY_DISPUTES,
      resolvedAt: nowIso(),
      proof,
    },
    recourseTrail: stored.record.recourseTrail.map((step) => {
      if (step.stage === "mediation" && step.authorityState !== "completed") {
        return {
          ...step,
          authorityState: "completed" as const,
          outcomeWording,
          at: nowIso(),
          proof,
        };
      }
      return step;
    }),
  };
}

export const MOCK_AUTHORITY_IDENTIFIERS = {
  agentsMediation: AGENTS_MEDIATION_AUTHORITY,
  disputesRecourse: DISPUTES_RECOURSE_AUTHORITY,
  runtimeNote: MOCK_NOTE,
  reportedByAgents: REPORTED_BY_AGENTS,
  reportedByDisputes: REPORTED_BY_DISPUTES,
} as const;
