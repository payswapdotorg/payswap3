/**
 * ════════════════════════════════════════════════════════════════════════
 *  UI-011 — TRANSPORT-UNAVAILABLE PORT BACKINGS (the honest no-answer side)
 * ════════════════════════════════════════════════════════════════════════
 *
 * The backing a port accessor returns when NO runtime adapter has been
 * registered in this context — today exactly one case: browser-context
 * calls from the frozen 'use client' consumers (compose/review/state
 * views, checkout decision controls, waiting panels, verification
 * harnesses). The composed protocol runtime is in-process on the server
 * (node:sqlite durable substrate); no browser transport binding exists in
 * this work item (the gateway's HTTP binding is recorded future work,
 * COMMAND-SURFACE.md; DEP-002+).
 *
 * These backings implement ZERO authority semantics — that is the point:
 * they never fabricate state, acceptance, rejection, amounts, or
 * settlement wording (N1/N2/N3/N5). They present the absence of an answer
 * as a first-class result (P5): queries return no-answer / not-found /
 * denied / unavailable with the reconciliation path stated in the note;
 * submits return not-transported (UNKNOWN whether the authority received
 * the submission — never failure, never success, never a silent retry).
 * Boundary reports return the SHARED runtime-adapter constants
 * (adapter-boundary.ts) so server render and browser hydration agree.
 *
 * The runtime adapters (server-side) are the authoritative backings:
 * src/lib/protocol/runtime-*-adapter.ts, registered per process by
 * src/lib/protocol/server-runtime.ts through each port module's
 * register*PortBacking seam.
 */

import {
  CAPABILITY_BOUNDARY_INFO,
  CHECKOUT_BOUNDARY,
  COMPOSITION_OPTIONS,
  DISPUTE_INITIATION_BRIEFING,
  INTENT_BOUNDARY,
  LIQUIDITY_PORT_BINDING,
  TRACKING_BOUNDARY_REPORT,
  WAITING_BOUNDARY,
} from './adapter-boundary';
import type {
  AuthorityState,
  CompositionOptions,
  ConsequenceReportResult,
  IntentDraft,
  IntentPort,
  IntentQueryResult,
  SessionIntentListResult,
  SubmitAuthorization,
  SubmitResult,
} from './intent-port';
import type {
  CheckoutDecisionRequest,
  CheckoutDecisionResult,
  CheckoutOfferRequest,
  CheckoutOfferResult,
  CheckoutPort,
  CheckoutQueueResult,
  CheckoutStatusRequest,
  CheckoutStatusResult,
} from './checkout-port';
import type {
  CapabilityItem,
  CapabilityListing,
  CapabilityPort,
  CapabilityQuery,
} from './capability-port';
import type {
  AgentProposal,
  DecisionAuthorizationEntry,
  DisputeInitiationBriefing,
  DisputeInitiationMatrixRow,
  DisputeInitiationRequest,
  DisputeInitiationResult,
  MediationActionAuthorization,
  MediationActionKind,
  MediationActionRequest,
  MediationActionResult,
  MediationCase,
  MediationHarnessScript,
  MediationPort,
  MediationRoleAuthorizationRow,
  PartyDocket,
  PartyRole,
  PortFetch,
  ProposalDecisionKind,
  ProposalDecisionRequest,
  ProposalDecisionResult,
  DisputeRecord,
  RoleAuthorizationRow,
} from './mediation-port';
import type {
  OperatorOversightQuery,
  OperatorOversightResult,
  LiquidityPort,
  ProviderPositionsQuery,
  ProviderPositionsResult,
} from './liquidity-port';
import type {
  NavAudience,
} from '@/lib/navigation';
import type {
  TrackingLookupResult,
  TrackingPort,
} from './tracking-port';
import type {
  WaitingInquiryRequest,
  WaitingInquiryResult,
  WaitingLookupResult,
  WaitingPort,
  WaitingRecoveryRequest,
  WaitingRecoveryRequestResult,
  WaitingViewerRole,
} from './waiting-port';

/** Honest wording for "the runtime is not reachable from this context". */
const UNREACHABLE_NOTE =
  'The composed protocol runtime is in-process on the server and no browser transport binding exists in this work item ' +
  '(the gateway\u2019s HTTP binding is recorded future work). It is UNKNOWN whether the owning authority can answer from ' +
  'this context — presented as UNKNOWN with its reconciliation path, never as failure or success. ' +
  'The reconciliation path: re-check from a server-rendered surface or an API route (the runtime-backed reads); ' +
  'no value here is authoritative and none is invented.';

const TRANSPORT_REPORTER = 'runtime port adapter (transport unavailable from this context)';

let unavailableSequence = 0;
function nextUnavailableRef(prefix: string): string {
  unavailableSequence += 1;
  return `${prefix}_untransported_${unavailableSequence.toString().padStart(3, '0')}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ── Intent ───────────────────────────────────────────────────────────────

const unavailableIntentPort: IntentPort = {
  boundary: () => INTENT_BOUNDARY,
  getCompositionOptions: (): CompositionOptions => COMPOSITION_OPTIONS,
  async requestConsequenceReport(_draft: IntentDraft): Promise<ConsequenceReportResult> {
    return {
      kind: 'no-answer',
      note:
        'The runtime adapter could not be reached to quote consequence terms, so no consequence report was issued. ' +
        'Without a consequence report there is no review, and without review there is no submit — the flow stops here honestly. ' +
        UNREACHABLE_NOTE,
    };
  },
  async submitIntent(draft: IntentDraft, authorization: SubmitAuthorization): Promise<SubmitResult> {
    if (authorization.explicitUserSubmit !== true) {
      return {
        kind: 'refused',
        reason: 'missing-explicit-authorization',
        note: 'Refused at the adapter boundary: the submit lacked explicit user authorization.',
      };
    }
    if (!authorization.consequenceReportId || !authorization.draftFingerprint) {
      return {
        kind: 'refused',
        reason: 'missing-consequence-review',
        note: 'Refused at the adapter boundary: no reviewed consequence report backs this submit. Consequences must be reviewed before any commit (P2/P3).',
      };
    }
    if (
      draft.outcomeKind !== 'send-payment' ||
      draft.currency !== 'USD' ||
      !draft.outcomeStatement ||
      !draft.recipient.id ||
      !draft.source.id ||
      !/^\d{1,9}(\.\d{1,2})?$/.test(draft.amount)
    ) {
      return {
        kind: 'refused',
        reason: 'malformed-draft',
        note: 'The submit was refused at the adapter boundary: the draft is not complete and well-formed.',
      };
    }
    return {
      kind: 'not-transported',
      submissionRef: nextUnavailableRef('sub'),
      note:
        'The submission was not transported to the Intent Authority. It is UNKNOWN whether the authority received this ' +
        'intent — presented as UNKNOWN with a reconciliation path, never as failure or success. ' +
        UNREACHABLE_NOTE,
    };
  },
  async getIntentState(_intentId: string): Promise<IntentQueryResult> {
    return {
      kind: 'no-answer',
      reason: 'unreachable',
      note: UNREACHABLE_NOTE,
    };
  },
  async listSessionIntents(): Promise<SessionIntentListResult> {
    return {
      kind: 'no-answer',
      note:
        'The runtime adapter could not be reached, so it is unknown whether any intent records are available. ' +
        'Rendered as UNKNOWN — not as an empty list standing in for an authoritative zero. ' +
        UNREACHABLE_NOTE,
    };
  },
  async getPresentationFixture(_state: AuthorityState): Promise<IntentQueryResult> {
    return {
      kind: 'no-answer',
      reason: 'unreachable',
      note:
        'The runtime adapter could not be reached, so no demonstration snapshot is available for this state. ' +
        'The state matrix renders UNKNOWN — the verification fixtures are served by the server-side runtime adapter. ' +
        UNREACHABLE_NOTE,
    };
  },
};

export function getUnavailableIntentPort(): IntentPort {
  return unavailableIntentPort;
}

// ── Checkout ─────────────────────────────────────────────────────────────

const unavailableCheckoutPort: CheckoutPort = {
  runtime: CHECKOUT_BOUNDARY.runtime,
  authorityOwner: CHECKOUT_BOUNDARY.authorityOwner,
  nonAuthoritative: true,
  async getOffer(_request: CheckoutOfferRequest): Promise<CheckoutOfferResult> {
    return {
      ok: false,
      error: 'authority-unreachable',
      detail:
        'The runtime adapter could not be reached to read the checkout offer, so no offer is presented — never a fabricated one. ' +
        UNREACHABLE_NOTE,
      reportedBy: TRANSPORT_REPORTER,
      runtime: CHECKOUT_BOUNDARY.runtime,
    };
  },
  async getStatus(_request: CheckoutStatusRequest): Promise<CheckoutStatusResult> {
    return {
      ok: false,
      error: 'authority-unreachable',
      detail:
        'The runtime adapter could not be reached to read the checkout state, so no state is presented — never a fabricated one. ' +
        UNREACHABLE_NOTE,
      reportedBy: TRANSPORT_REPORTER,
      runtime: CHECKOUT_BOUNDARY.runtime,
    };
  },
  async listOpenCheckouts(): Promise<CheckoutQueueResult> {
    return {
      ok: false,
      error: 'authority-unreachable',
      detail:
        'The runtime adapter could not be reached, so it is unknown whether any open checkouts exist. ' +
        'Rendered as UNKNOWN — not as an empty queue standing in for an authoritative zero. ' +
        UNREACHABLE_NOTE,
      reportedBy: TRANSPORT_REPORTER,
      runtime: CHECKOUT_BOUNDARY.runtime,
    };
  },
  async submitDecision(_request: CheckoutDecisionRequest): Promise<CheckoutDecisionResult> {
    return {
      ok: false,
      error: 'authority-unreachable',
      detail:
        'The decision submission was not transported: the runtime adapter could not be reached, so no decision was ' +
        'recorded — nothing was committed. No silent retry occurs; re-submit explicitly after re-checking. ' +
        UNREACHABLE_NOTE,
      reportedBy: TRANSPORT_REPORTER,
      runtime: CHECKOUT_BOUNDARY.runtime,
    };
  },
};

export function getUnavailableCheckoutPort(): CheckoutPort {
  return unavailableCheckoutPort;
}

// ── Capability ───────────────────────────────────────────────────────────

const unavailableCapabilityPort: CapabilityPort = {
  boundary: CAPABILITY_BOUNDARY_INFO,
  async listCapabilities(_query?: CapabilityQuery): Promise<CapabilityListing> {
    return {
      items: [],
      sources: [],
      boundary: {
        ...CAPABILITY_BOUNDARY_INFO,
        notes:
          CAPABILITY_BOUNDARY_INFO.notes +
          ' REACHED FROM A CONTEXT WITHOUT THE RUNTIME ADAPTER: the capability registry could not be enumerated here, ' +
          'so this listing is NOT an authoritative empty registry — it is the absence of an answer (see the boundary note).',
      },
      generatedAt: nowIso(),
    };
  },
  async getCapability(_capabilityId: string, _query?: CapabilityQuery): Promise<CapabilityItem | null> {
    // The frozen interface has one no-record shape (null); from this context
    // it means "no authoritative registry answer is reachable here" — the
    // capability detail page renders the boundary note, and the mapping
    // records (CAP-MAP-006 family) state the honest reading.
    return null;
  },
};

export function getUnavailableCapabilityPort(): CapabilityPort {
  return unavailableCapabilityPort;
}

// ── Tracking ─────────────────────────────────────────────────────────────

const unavailableTrackingPort: TrackingPort = {
  async lookupReference(reference: string, _viewer: NavAudience): Promise<TrackingLookupResult> {
    return {
      kind: 'not-found',
      searchedReference: reference,
      wording:
        'It is not known whether a tracked record exists for this reference: the runtime adapter could not be reached from ' +
        'this context, so the Intent Authority was not queried. This is the absence of an answer (UNKNOWN), not a verdict ' +
        'that no record exists. ' +
        UNREACHABLE_NOTE,
      reportedBy: TRANSPORT_REPORTER,
    };
  },
  describeBoundary: () => TRACKING_BOUNDARY_REPORT,
};

export function getUnavailableTrackingPort(): TrackingPort {
  return unavailableTrackingPort;
}

// ── Waiting ──────────────────────────────────────────────────────────────

function waitingTransportNote(): string {
  return (
    'The runtime adapter could not be reached from this context, so the Fulfillment/Queue Authority was not queried. ' +
    UNREACHABLE_NOTE
  );
}

const unavailableWaitingPort: WaitingPort = {
  runtime: WAITING_BOUNDARY.runtime,
  authorityOwner: WAITING_BOUNDARY.authorityOwner,
  nonAuthoritative: WAITING_BOUNDARY.nonAuthoritative,
  lookupWaiting(referenceId: string, _viewerRole: WaitingViewerRole): WaitingLookupResult {
    // The frozen WaitingLookupResult has no no-answer member; the honest
    // reading of this branch (documented in the waiting mapping records)
    // is "no reachable answer" — never an authoritative zero claim, and
    // no fabricated snapshot figures.
    void waitingTransportNote();
    return { status: 'not-found', referenceId };
  },
  requestRecheck(request: WaitingInquiryRequest): WaitingInquiryResult {
    return {
      status: 'rejected',
      authorityStateId: 'fq.inquiry.rejected',
      referenceId: request.referenceId,
      reason:
        'The re-check request was not transported: the runtime adapter could not be reached from this context, so no ' +
        'queues.eligibility.evaluate command was admitted. This is not a refusal by the Fulfillment/Queue Authority — ' +
        'the request simply did not reach it. ' +
        waitingTransportNote(),
    };
  },
  requestRecovery(request: WaitingRecoveryRequest): WaitingRecoveryRequestResult {
    return {
      status: 'denied',
      authorityStateId: 'fq.recovery.denied',
      referenceId: request.referenceId,
      actionId: request.actionId,
      reason:
        'The recovery request was not transported: the runtime adapter could not be reached from this context, so no ' +
        'recovery command was admitted and nothing was mutated. This is not a denial by the Fulfillment/Queue Authority — ' +
        'the request simply did not reach it. ' +
        waitingTransportNote(),
    };
  },
};

export function getUnavailableWaitingPort(): WaitingPort {
  return unavailableWaitingPort;
}

// ── Liquidity ────────────────────────────────────────────────────────────

const unavailableLiquidityPort: LiquidityPort = {
  binding: LIQUIDITY_PORT_BINDING,
  async getProviderPositions(query: ProviderPositionsQuery): Promise<ProviderPositionsResult> {
    return {
      kind: 'denied',
      surface: 'provider-positions',
      requester: query.requester,
      reason:
        'The runtime adapter could not be reached from this context, so no liquidity, credit, or queue values can be ' +
        'authoritatively presented here — fail closed, never zero, never fabricated. ' +
        UNREACHABLE_NOTE,
    };
  },
  async getOperatorOversight(query: OperatorOversightQuery): Promise<OperatorOversightResult> {
    return {
      kind: 'denied',
      surface: 'operator-oversight',
      requester: query.requester,
      reason:
        'The runtime adapter could not be reached from this context, so no oversight aggregates can be authoritatively ' +
        'presented here — fail closed, never zero, never fabricated. ' +
        UNREACHABLE_NOTE,
    };
  },
};

export function getUnavailableLiquidityPort(_overrides?: unknown): LiquidityPort {
  return unavailableLiquidityPort;
}

// ── Mediation ────────────────────────────────────────────────────────────

function mediationUnavailable<T>(target: string): PortFetch<T> {
  return {
    kind: 'unavailable',
    target,
    detail:
      'The runtime adapter could not be reached from this context (and the area-19/area-21 authorities are RTN wave 2 ' +
      'where noted), so the owning authority cannot currently report this record. ' +
      UNREACHABLE_NOTE,
  };
}

const unavailableMediationPort: MediationPort = {
  async getPartyDocket(viewer: PartyRole): Promise<PortFetch<PartyDocket>> {
    return mediationUnavailable<PartyDocket>(`the party docket for the ${viewer} role`);
  },
  async getProposal(query: { proposalId: string; viewer: PartyRole }): Promise<PortFetch<AgentProposal>> {
    return mediationUnavailable<AgentProposal>(`agent proposal ${query.proposalId}`);
  },
  async getMediationCase(query: { caseId: string; viewer: PartyRole }): Promise<PortFetch<MediationCase>> {
    return mediationUnavailable<MediationCase>(`mediation case ${query.caseId}`);
  },
  async getDispute(query: { disputeId: string; viewer: PartyRole }): Promise<PortFetch<DisputeRecord>> {
    return mediationUnavailable<DisputeRecord>(`dispute ${query.disputeId}`);
  },
  async getDisputeInitiationBriefing(): Promise<DisputeInitiationBriefing> {
    return DISPUTE_INITIATION_BRIEFING;
  },
  async submitProposalDecision(request: ProposalDecisionRequest): Promise<ProposalDecisionResult> {
    return {
      kind: 'denied',
      reason:
        'The decision was not applied: the runtime adapter could not be reached from this context, and the composed ' +
        'runtime exposes no agent-proposal command surface (the Agents/Mediation Authority, area 19, is RTN wave 2). ' +
        'Nothing was committed and nothing was fabricated. ' +
        UNREACHABLE_NOTE +
        ` [requested: proposal ${request.proposalId}, decision ${request.decision}]`,
    };
  },
  async submitMediationAction(request: MediationActionRequest): Promise<MediationActionResult> {
    return {
      kind: 'denied',
      reason:
        'The action was not applied: the runtime adapter could not be reached from this context, and the composed ' +
        'runtime exposes no mediation-case command surface (the Agents/Mediation Authority, area 19, is RTN wave 2). ' +
        'Nothing was committed and nothing was fabricated. ' +
        UNREACHABLE_NOTE +
        ` [requested: case ${request.caseId}, action ${request.action}]`,
    };
  },
  async initiateDispute(request: DisputeInitiationRequest): Promise<DisputeInitiationResult> {
    return {
      kind: 'denied',
      reason:
        'The dispute was not initiated: the runtime adapter could not be reached from this context, so no ' +
        'obligations.dispute.open command was admitted — nothing was recorded and nothing was mutated. ' +
        UNREACHABLE_NOTE +
        ` [requested for intent reference ${request.intentReference}]`,
    };
  },
  async describeProposalDecisionMatrix(query: { proposalId: string }): Promise<readonly RoleAuthorizationRow[]> {
    const roles: readonly { role: PartyRole; label: string }[] = [
      { role: 'customer', label: 'Customer' },
      { role: 'merchant', label: 'Merchant' },
      { role: 'provider', label: 'Provider' },
      { role: 'operator', label: 'Operator' },
      { role: 'administrator', label: 'Administrator' },
    ];
    const decisions: readonly ProposalDecisionKind[] = ['accept', 'reject', 'counter', 'escalate'];
    const entries: readonly DecisionAuthorizationEntry[] = decisions.map((decision) => ({
      decision,
      authorized: false,
      reason:
        'Not authorized in this context: the runtime adapter is not reachable here (and the area-19 proposal surface ' +
        'is RTN wave 2), so no proposal decision is offered — fail closed. ' +
        UNREACHABLE_NOTE,
    }));
    return roles.map((entry) => ({
      role: entry.role,
      label: entry.label,
      entries,
    }));
  },
  async describeMediationActionMatrix(query: { caseId: string }): Promise<readonly MediationRoleAuthorizationRow[]> {
    const roles: readonly { role: PartyRole; label: string }[] = [
      { role: 'customer', label: 'Customer' },
      { role: 'merchant', label: 'Merchant' },
      { role: 'provider', label: 'Provider' },
      { role: 'operator', label: 'Operator' },
      { role: 'administrator', label: 'Administrator' },
    ];
    const actions: readonly MediationActionKind[] = [
      'submit-statement',
      'accept-proposed-resolution',
      'decline-proposed-resolution',
    ];
    const entries: readonly MediationActionAuthorization[] = actions.map((action) => ({
      action,
      authorized: false,
      reason:
        'Not authorized in this context: the runtime adapter is not reachable here (and the area-19 mediation surface ' +
        'is RTN wave 2), so no mediation action is offered — fail closed. ' +
        UNREACHABLE_NOTE,
    }));
    return roles.map((entry) => ({
      role: entry.role,
      label: entry.label,
      entries,
    }));
  },
  async describeDisputeInitiationMatrix(query: { intentReference: string }): Promise<readonly DisputeInitiationMatrixRow[]> {
    const roles: readonly { role: PartyRole; label: string }[] = [
      { role: 'customer', label: 'Customer' },
      { role: 'merchant', label: 'Merchant' },
      { role: 'provider', label: 'Provider' },
      { role: 'operator', label: 'Operator' },
      { role: 'administrator', label: 'Administrator' },
    ];
    return roles.map((entry) => ({
      role: entry.role,
      label: entry.label,
      authorized: false,
      reason:
        'Not authorized in this context: the runtime adapter is not reachable here, so no obligations.dispute.open ' +
        'command can be admitted — fail closed. ' +
        UNREACHABLE_NOTE +
        ` [reference: ${query.intentReference}]`,
    }));
  },
  async applyHarnessScript(script: MediationHarnessScript): Promise<{ applied: string; note: string }> {
    return {
      applied: 'no',
      note:
        'The runtime-backed mediation adapter exposes no authority-state scripting: mock-era harness scripts cannot ' +
        'fabricate runtime authority state, so this script was not applied. Authority state is read from the composed ' +
        'runtime only. ' +
        UNREACHABLE_NOTE +
        ` [script type: ${script.type}]`,
    };
  },
};

export function getUnavailableMediationPort(): MediationPort {
  return unavailableMediationPort;
}
