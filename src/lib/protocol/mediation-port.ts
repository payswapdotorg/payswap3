/**
 * UI-008 — Mediation / dispute adapter boundary (typed port).
 *
 * This module declares the data needs of the agent-proposal, mediation, and
 * dispute/recourse presentation surfaces. It is an ADAPTER BOUNDARY, not an
 * authority.
 *
 * Authority owners (per spec/architecture/v0.1):
 * - Agent proposals and human mediation: the Agents/Mediation Authority
 *   (extensions-agents-merchant.md) — RTN wave 2, NOT merged as runtime code.
 * - Disputes and recourse paths: the Disputes/Recourse Authority
 *   (disputes-federation-blockchain-emergence.md) — RTN wave 2; the composed
 *   runtime's A10 obligation dispute primitive (obligations.dispute.open /
 *   applyDisputeResolution) is the merged dispute surface this port
 *   re-anchors to.
 *
 * RE-ANCHORED (UI-011): the backing is the RUNTIME ADAPTER over the composed
 * protocol runtime (src/lib/protocol/runtime-mediation-adapter.ts): dispute
 * reads come from the A10 obligation ledger, dispute initiation submits
 * obligations.dispute.open through the protocol gateway, and the area-19/21
 * surfaces (proposals, mediation cases, the full dispute workflow) present
 * unavailable/denied with the recorded gap — never fabricated. The mock
 * mediation authority is DELETED outright (zero read-only importers).
 *
 * Presentation code must import TYPES ONLY from this module (`import type`) so
 * no backing is ever pulled into client bundles; the port accessor is for
 * server-side pages and API routes.
 */

export type PartyRole =
  | "customer"
  | "merchant"
  | "provider"
  | "operator"
  | "administrator";

export type ProposalDecisionKind = "accept" | "reject" | "counter" | "escalate";

export type MediationActionKind =
  | "submit-statement"
  | "accept-proposed-resolution"
  | "decline-proposed-resolution";

export type MediationScope = "proposal" | "mediation" | "dispute" | "docket";

/** Proof/evidence reference. Hrefs belong to authority-backed surfaces. */
export interface EvidenceRef {
  label: string;
  href: string;
}

/**
 * Authority-quoted money. Presentation may format it (formatMoney) but never
 * computes totals, splits, or conversions.
 */
export interface AuthorityQuotedMoney {
  amount: string;
  currency: "USD";
}

/** Complete plain-language consequences of every proposal decision. */
export interface ProposalConsequences {
  ifAccepted: readonly string[];
  ifRejected: readonly string[];
  ifCountered: readonly string[];
  ifEscalated: readonly string[];
  financialImpact?: AuthorityQuotedMoney;
  reversibility: string;
  validUntil: string;
}

export type ProposalAuthorityState =
  | "awaiting-decision"
  | "decided-accepted"
  | "decided-rejected"
  | "decided-counter-proposed"
  | "decided-escalated"
  | "expired"
  | "authority-unreachable";

export interface PartyRef {
  role: PartyRole;
  label: string;
}

/** Per-viewer authorization entry for a single proposal decision. */
export interface DecisionAuthorizationEntry {
  decision: ProposalDecisionKind;
  authorized: boolean;
  /** Why the role is (or is not) authorized — authority wording. */
  reason: string;
}

export interface ProposalDecisionRecord {
  decision: ProposalDecisionKind;
  decidedBy: PartyRef;
  decidedAt: string;
  /** Protocol authorization reference recorded with the applied decision. */
  authorizationRef: string;
  /** The authority's exact outcome wording; presentation never rewrites it. */
  outcomeWording: string;
  proof: readonly EvidenceRef[];
}

export interface AgentProposal {
  id: string;
  reference: string;
  intentReference: string;
  proposedBy: { agentId: string; agentLabel: string };
  onBehalfOf: PartyRef;
  /** The only role whose decision this proposal awaits. */
  addressedTo: PartyRef;
  /** The party notified of the outcome; may view but not decide. */
  counterparty: PartyRef;
  title: string;
  summary: string;
  consequences: ProposalConsequences;
  evidence: readonly EvidenceRef[];
  authorityState: ProposalAuthorityState;
  decision?: ProposalDecisionRecord;
  /** Set when this proposal was spawned by a counter decision. */
  spawnedFromProposalId?: string;
  /** Authorization entries computed for the requesting viewer only. */
  viewerAuthorization: readonly DecisionAuthorizationEntry[];
}

export type MediationAuthorityState =
  | "open"
  | "awaiting-party"
  | "resolved"
  | "failed"
  | "authority-unreachable";

export interface MediationPartyStatus {
  party: PartyRef;
  status: "responded" | "awaiting-response";
  since?: string;
}

export type MediationMessageKind = "party-statement" | "authority-notice" | "system-note";

export interface MediationMessage {
  id: string;
  kind: MediationMessageKind;
  from: PartyRef | { role: "authority"; label: string };
  at: string;
  body: string;
  evidence?: readonly EvidenceRef[];
}

export interface MediationResolution {
  outcomeWording: string;
  resolvedBy: string;
  resolvedAt: string;
  proof: readonly EvidenceRef[];
}

export interface MediationFailure {
  reason: string;
  nextActions: readonly string[];
}

export interface MediationUnknownDetails {
  explanation: string;
  reconciliation: { whoResolves: string; recheckTrigger: string };
}

export interface ProposedResolution {
  wording: string;
  proposedBy: string;
  validUntil: string;
}

export interface MediationActionAuthorization {
  action: MediationActionKind;
  authorized: boolean;
  reason: string;
}

export interface MediationCase {
  id: string;
  reference: string;
  subject: string;
  intentReference: string;
  linkedDisputeId?: string;
  authorityState: MediationAuthorityState;
  parties: readonly MediationPartyStatus[];
  messages: readonly MediationMessage[];
  proposedResolution?: ProposedResolution;
  resolution?: MediationResolution;
  failure?: MediationFailure;
  unknown?: MediationUnknownDetails;
  /** Authorization entries computed for the requesting viewer only. */
  viewerActions: readonly MediationActionAuthorization[];
}

export type DisputeGroundId =
  | "goods-not-received"
  | "goods-not-as-described"
  | "settlement-mismatch"
  | "authorization-disagreement"
  | "other-with-evidence";

export interface DisputeGround {
  id: DisputeGroundId;
  label: string;
  description: string;
  requiresEvidence: boolean;
}

export type DisputeAuthorityState =
  | "open"
  | "in-mediation"
  | "resolved"
  | "failed"
  | "authority-unreachable";

export type RecourseStepAuthorityState =
  | "completed"
  | "in-progress"
  | "awaiting-party"
  | "pending"
  | "failed"
  | "authority-unreachable";

/** One stage on the authority-recorded recourse path, with its proof trail. */
export interface RecourseStep {
  id: string;
  stage: string;
  title: string;
  authorityState: RecourseStepAuthorityState;
  authority: string;
  /** Authority wording for consequential outcomes on this step. */
  outcomeWording?: string;
  at?: string;
  proof: readonly EvidenceRef[];
}

export interface DisputeResolution {
  outcomeWording: string;
  resolvedBy: string;
  resolvedAt: string;
  proof: readonly EvidenceRef[];
}

export interface DisputeFailure {
  reason: string;
  nextActions: readonly string[];
}

export interface DisputeUnknownDetails {
  explanation: string;
  reconciliation: { whoResolves: string; recheckTrigger: string };
}

export interface DisputeRecord {
  id: string;
  reference: string;
  intentReference: string;
  openedBy: PartyRef;
  against: PartyRef;
  grounds: readonly DisputeGround[];
  accountOfWhatHappened: string;
  evidence: readonly EvidenceRef[];
  authorityState: DisputeAuthorityState;
  linkedMediationId?: string;
  resolution?: DisputeResolution;
  failure?: DisputeFailure;
  unknown?: DisputeUnknownDetails;
  recourseTrail: readonly RecourseStep[];
}

/** A reference the viewer may attempt to open a dispute on. */
export interface DisputableIntent {
  reference: string;
  label: string;
  amount?: AuthorityQuotedMoney;
  parties: readonly PartyRole[];
}

/** Authority-worded briefing shown before any dispute initiation. */
export interface DisputeInitiationBriefing {
  authority: string;
  grounds: readonly DisputeGround[];
  consequences: readonly string[];
  whatHappensNext: string;
  consequenceOfInaction?: string;
}

/** Everything the party's mediation surface lists, for one viewer. */
export interface PartyDocket {
  viewer: PartyRole;
  viewerLabel: string;
  proposals: readonly AgentProposal[];
  mediations: readonly MediationCase[];
  disputes: readonly DisputeRecord[];
  disputableIntents: readonly DisputableIntent[];
}

export interface ProposalDecisionRequest {
  proposalId: string;
  decision: ProposalDecisionKind;
  actor: PartyRole;
  /** Required for a counter decision. */
  counterTerms?: string;
  rationale?: string;
}

export interface MediationActionRequest {
  caseId: string;
  action: MediationActionKind;
  actor: PartyRole;
  /** Required for submit-statement. */
  statement?: string;
}

export interface DisputeInitiationRequest {
  intentReference: string;
  grounds: readonly DisputeGroundId[];
  accountOfWhatHappened: string;
  evidence: readonly EvidenceRef[];
  actor: PartyRole;
}

/** Result of an explicitly authorized, single-intent decision. */
export type AuthorizedDecisionResult<T> =
  | {
      kind: "applied";
      record: T;
      authorizationRef: string;
      proof: readonly EvidenceRef[];
    }
  | { kind: "denied"; reason: string };

export type ProposalDecisionResult = AuthorizedDecisionResult<AgentProposal>;
export type MediationActionResult = AuthorizedDecisionResult<MediationCase>;

export type DisputeInitiationResult =
  | { kind: "initiated"; record: DisputeRecord; reference: string }
  | { kind: "denied"; reason: string };

/**
 * Result of querying the owning authority for a record. Presentation must
 * branch on all three kinds: fetched / not-visible (role-checked) /
 * unavailable (authority cannot currently report — availability unknown).
 */
export type PortFetch<T> =
  | { kind: "fetched"; record: T }
  | { kind: "not-visible"; reason: string }
  | { kind: "unavailable"; target: string; detail?: string };

export interface RoleAuthorizationRow {
  role: PartyRole;
  label: string;
  entries: readonly DecisionAuthorizationEntry[];
}

export interface MediationRoleAuthorizationRow {
  role: PartyRole;
  label: string;
  entries: readonly MediationActionAuthorization[];
}

export interface DisputeInitiationMatrixRow {
  role: PartyRole;
  label: string;
  authorized: boolean;
  reason: string;
}

/**
 * Harness scripting for the verification surface. Scripts may only set
 * AUTHORITY-OWNED outcomes (mediation/dispute states, proposed resolutions,
 * authority notices, recourse progression, fetch availability). Proposal
 * decisions are never scriptable: they only flow through
 * submitProposalDecision under per-role authorization.
 */
export type MediationHarnessScript =
  | { type: "reset" }
  | {
      type: "set-proposal-state";
      proposalId: string;
      authorityState: "awaiting-decision" | "expired" | "authority-unreachable";
    }
  | {
      type: "set-mediation-state";
      caseId: string;
      authorityState: MediationAuthorityState;
      resolutionWording?: string;
      failureReason?: string;
      nextActions?: readonly string[];
    }
  | {
      type: "set-proposed-resolution";
      caseId: string;
      wording?: string;
      validUntil?: string;
    }
  | { type: "clear-proposed-resolution"; caseId: string }
  | { type: "add-authority-notice"; caseId: string; body: string }
  | {
      type: "set-dispute-state";
      disputeId: string;
      authorityState: DisputeAuthorityState;
      resolutionWording?: string;
      failureReason?: string;
    }
  | { type: "advance-recourse"; disputeId: string; stepId: string }
  | { type: "set-fetch-availability"; scope: MediationScope; unreachable: boolean };

export interface MediationPort {
  getPartyDocket(viewer: PartyRole): Promise<PortFetch<PartyDocket>>;
  getProposal(query: { proposalId: string; viewer: PartyRole }): Promise<PortFetch<AgentProposal>>;
  getMediationCase(query: {
    caseId: string;
    viewer: PartyRole;
  }): Promise<PortFetch<MediationCase>>;
  getDispute(query: { disputeId: string; viewer: PartyRole }): Promise<PortFetch<DisputeRecord>>;
  getDisputeInitiationBriefing(): Promise<DisputeInitiationBriefing>;

  /** Each decision is individually authorized; denials carry the reason. */
  submitProposalDecision(request: ProposalDecisionRequest): Promise<ProposalDecisionResult>;
  submitMediationAction(request: MediationActionRequest): Promise<MediationActionResult>;
  initiateDispute(request: DisputeInitiationRequest): Promise<DisputeInitiationResult>;

  /** Harness-only introspection for the verification surface. */
  describeProposalDecisionMatrix(query: {
    proposalId: string;
  }): Promise<readonly RoleAuthorizationRow[]>;
  describeMediationActionMatrix(query: {
    caseId: string;
  }): Promise<readonly MediationRoleAuthorizationRow[]>;
  describeDisputeInitiationMatrix(query: {
    intentReference: string;
  }): Promise<readonly DisputeInitiationMatrixRow[]>;
  applyHarnessScript(script: MediationHarnessScript): Promise<{
    applied: string;
    note: string;
  }>;
}

import { getUnavailableMediationPort } from "./unavailable-backing";

/**
 * The registered runtime-adapter backing (set once per server process by
 * src/lib/protocol/server-runtime.ts). Server-side use only: pages and API
 * routes — the runtime is in-process on the server.
 */
let registeredBacking: MediationPort | undefined;

/** UI-011 seam: register the server-side runtime adapter as this port's backing. */
export function registerMediationPortBacking(backing: MediationPort): void {
  registeredBacking = backing;
}

/**
 * Port accessor. Since UI-011 it returns the registered RUNTIME ADAPTER
 * (A10 dispute reads + gateway-admitted obligations.dispute.open; the
 * area-19/21 gaps are denied/unavailable with recorded reasons). When no
 * adapter is registered in this context, it returns the honest
 * transport-unavailable backing.
 */
export function getMediationPort(): MediationPort {
  return registeredBacking ?? getUnavailableMediationPort();
}
