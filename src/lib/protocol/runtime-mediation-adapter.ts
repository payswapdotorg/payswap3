/**
 * ════════════════════════════════════════════════════════════════════════
 *  UI-011 — RUNTIME MEDIATION ADAPTER (A10-backed MediationPort)
 * ════════════════════════════════════════════════════════════════════════
 *
 * The runtime adapter behind getMediationPort() once
 * src/lib/protocol/server-runtime.ts registers it. It implements the
 * FROZEN MediationPort interface exactly over the composed runtime,
 * honestly scoped to what the runtime ACTUALLY owns:
 *
 *   • DISPUTES re-anchor to the merged A10 obligation dispute primitive:
 *     a dispute is recorded by obligations.dispute.open (terminalizing
 *     the obligation into DISPUTED, linked by the dispute id in the A15
 *     chain); resolution creates replacement obligations, never mutating
 *     the disputed one. Dispute reads derive from the A10 records and the
 *     real A15 chain (OBLIGATION_CREATED / OBLIGATION_STATE_CHANGED with
 *     cause references).
 *   • DISPUTE INITIATION submits obligations.dispute.open through
 *     ProtocolGateway.submitCommand (the sole admission point) when the
 *     referenced obligation exists in the runtime; otherwise it is denied
 *     with the honest reason.
 *   • AGENT PROPOSALS and MEDIATION CASES present UNAVAILABLE with the
 *     recorded gap: the Agents/Mediation Authority (area 19) and the
 *     Disputes/Recourse Authority (area 21) are RTN wave 2 — NOT merged.
 *     Their commands are denied (never fabricated), and the docket's
 *     proposal/mediation sections report the runtime's authoritative
 *     empty set with the gap recorded in the mapping records.
 *   • The harness script surface reports honestly that no authority-state
 *     scripting exists over the runtime adapter.
 */

import { DISPUTE_INITIATION_BRIEFING, MEDIATION_RUNTIME_NOTE } from './adapter-boundary';
import type {
  DisputeGround,
  DisputeInitiationBriefing,
  DisputeInitiationMatrixRow,
  DisputeInitiationRequest,
  DisputeInitiationResult,
  DisputeRecord,
  MediationActionRequest,
  MediationActionResult,
  MediationHarnessScript,
  MediationPort,
  MediationRoleAuthorizationRow,
  PartyDocket,
  PartyRole,
  PortFetch,
  ProposalDecisionRequest,
  ProposalDecisionResult,
  RecourseStep,
  RoleAuthorizationRow,
} from './mediation-port';
import type { ProtocolRuntimeHandle } from './runtime-handle';
import type {
  CommandEnvelope,
  Money,
  ObligationRecord,
} from '../protocol-runtime/index.ts';
import { deriveProtocolId } from '../protocol-runtime/kernel/identity.ts';
import { protocolTime } from '../protocol-runtime/kernel/time.ts';

const AREA_19_UNAVAILABLE =
  'The Agents/Mediation Authority (area 19 — agent proposals, human mediation) is RTN wave 2 and NOT merged as runtime ' +
  'code: the composed runtime cannot currently report this record, and nothing is synthesized in its place. The recorded ' +
  'deferral: the mediation splice lands with the area-19 runtime (see the mediation mapping records).';

function formatMoney(value: Money): string {
  const sign = value.amountMinor < 0 ? '-' : '';
  const absolute = Math.abs(Math.trunc(value.amountMinor));
  const whole = Math.floor(absolute / 10 ** value.scale);
  const fraction = String(absolute % 10 ** value.scale).padStart(value.scale, '0');
  return `${sign}${whole}.${fraction} ${value.currency}`;
}

function isoOfWall(wallMs: number): string {
  return new Date(wallMs).toISOString();
}

/** The dispute ids the real A15 chain records (DISPUTE_OPEN transitions). */
function recordedDisputes(handle: ProtocolRuntimeHandle): readonly {
  disputeId: string;
  obligationId: string;
  when: { wallMs: number };
}[] {
  const out: { disputeId: string; obligationId: string; when: { wallMs: number } }[] = [];
  for (const record of handle.evidenceLog.records()) {
    if (record.what.operationType !== 'OBLIGATION_STATE_CHANGED') continue;
    if (record.outcome.reasonCode !== 'DISPUTE_OPEN') continue;
    const [obligationId, disputeId] = record.what.subjectIds;
    if (obligationId !== undefined && disputeId !== undefined) {
      if (!out.some((entry) => entry.disputeId === disputeId)) {
        out.push({ disputeId, obligationId, when: { wallMs: record.when.wallMs } });
      }
    }
  }
  return out;
}

/** The origin reference of an obligation (its activity id, or the dispute it came from). */
function originReferenceOf(obligation: ObligationRecord): string {
  return obligation.origin.kind === 'CLEARING'
    ? obligation.origin.originActivityId
    : obligation.origin.disputeId;
}

/** Obligations resolvable from a product reference (id or origin reference). */
function obligationsForReference(
  handle: ProtocolRuntimeHandle,
  reference: string,
): readonly ObligationRecord[] {
  return handle.authorities.obligations
    .obligations()
    .filter(
      (obligation) =>
        obligation.obligationId === reference || originReferenceOf(obligation) === reference,
    );
}

/** Disputable per the frozen one-way table: DISPUTED is reachable from CREATED / NETTED / SETTLEMENT_PENDING. */
function isDisputable(obligation: ObligationRecord): boolean {
  return (
    obligation.state === 'CREATED' ||
    obligation.state === 'NETTED' ||
    obligation.state === 'SETTLEMENT_PENDING'
  );
}

function partyFor(participantId: string, role: PartyRole): { role: PartyRole; label: string } {
  return { role, label: participantId };
}

export function createRuntimeMediationAdapter(handle: ProtocolRuntimeHandle): MediationPort {
  let protocolSequence = 0;

  function disputeRecordFor(
    dispute: { disputeId: string; obligationId: string; when: { wallMs: number } },
  ): DisputeRecord | null {
    const obligation = handle.authorities.obligations.obligation(dispute.obligationId);
    if (obligation === undefined) {
      return null;
    }
    const resolutionRecords = handle.evidenceLog
      .records()
      .filter(
        (record) =>
          record.what.operationType === 'OBLIGATION_STATE_CHANGED' &&
          record.what.subjectIds.includes(dispute.disputeId) &&
          record.outcome.reasonCode === 'DISPUTE_RESOLUTION',
      );
    const resolved = obligation.state !== 'DISPUTED';
    const grounds: DisputeGround[] = [
      {
        id: 'other-with-evidence',
        label: 'Dispute on the recorded obligation (A10 primitive)',
        description:
          'The dispute terminalizes the recorded obligation into DISPUTED via obligations.dispute.open; the account of what ' +
          'happened is carried by the disputing party and recorded in the A15 chain with the dispute id as cause reference.',
        requiresEvidence: true,
      },
    ];
    const recourseTrail: RecourseStep[] = [
      {
        id: `recourse-${dispute.disputeId}-open`,
        stage: 'Dispute recorded',
        title: `Obligation ${dispute.obligationId} terminalized into DISPUTED`,
        authorityState: 'completed',
        authority: 'Obligation Authority (A10) over the composed protocol runtime',
        outcomeWording:
          'obligations.dispute.open admitted through the protocol gateway; OBLIGATION_STATE_CHANGED recorded with the dispute id as cause reference.',
        at: isoOfWall(dispute.when.wallMs),
        proof: [
          {
            label: `A15 chain (dispute ${dispute.disputeId})`,
            href: `/mediation/disputes/${dispute.disputeId}`,
          },
        ],
      },
    ];
    if (resolved) {
      recourseTrail.push({
        id: `recourse-${dispute.disputeId}-resolution`,
        stage: 'Resolution applied',
        title: 'The dispute resolution created replacement obligations',
        authorityState: 'completed',
        authority: 'Obligation Authority (A10) over the composed protocol runtime',
        outcomeWording:
          'The resolution creates NEW linked obligations and never mutates the disputed one, as the authority records (INV-10 governance).',
        proof: [
          {
            label: `A15 chain (dispute ${dispute.disputeId})`,
            href: `/mediation/disputes/${dispute.disputeId}`,
          },
        ],
      });
    }
    const authorityState: DisputeRecord['authorityState'] = resolved ? 'resolved' : 'open';
    return {
      id: dispute.disputeId,
      reference: dispute.disputeId,
      intentReference: originReferenceOf(obligation),
      openedBy: partyFor(obligation.terms.debtorParticipantId, 'customer'),
      against: partyFor(obligation.terms.creditorParticipantId, 'merchant'),
      grounds,
      accountOfWhatHappened:
        'The account of what happened is carried by the dispute\u2019s A15 records (the dispute id is the cause reference on ' +
        `the OBLIGATION_STATE_CHANGED record for ${dispute.obligationId}); the composed runtime records the primitive's ` +
        'facts, not a narrative — nothing is invented here.',
      evidence: [
        {
          label: `A15 evidence chain (dispute ${dispute.disputeId})`,
          href: `/mediation/disputes/${dispute.disputeId}`,
        },
      ],
      authorityState,
      recourseTrail,
      ...(resolved
        ? {
            resolution: {
              outcomeWording:
                'Resolved by the Obligation Authority\u2019s recorded dispute resolution (replacement obligations created; the disputed obligation was never mutated).',
              resolvedBy: 'Obligation Authority (A10)',
              resolvedAt: isoOfWall(obligation.stateChangedAt.wallMs),
              proof: [
                {
                  label: `A15 chain (dispute ${dispute.disputeId})`,
                  href: `/mediation/disputes/${dispute.disputeId}`,
                },
              ],
            },
          }
        : {}),
    };
  }

  async function getPartyDocket(viewer: PartyRole): Promise<PortFetch<PartyDocket>> {
    const disputes = recordedDisputes(handle)
      .map(disputeRecordFor)
      .filter((record): record is DisputeRecord => record !== null);
    const disputable = handle.authorities.obligations
      .obligations()
      .filter(isDisputable)
      .map((obligation) => ({
        reference: originReferenceOf(obligation),
        label: `Obligation ${obligation.obligationId} — ${formatMoney(obligation.terms.amount)} (${obligation.state})`,
        amount: { amount: formatMoney(obligation.terms.amount).split(' ')[0], currency: 'USD' as const },
        parties: ['customer' as PartyRole, 'merchant' as PartyRole],
      }));
    return {
      kind: 'fetched',
      record: {
        viewer,
        viewerLabel: viewer,
        // The runtime's authoritative empty sets for the area-19 surfaces
        // (the gap is recorded in the mediation mapping records).
        proposals: [],
        mediations: [],
        disputes,
        disputableIntents: disputable,
      },
    };
  }

  async function getProposal(query: {
    proposalId: string;
    viewer: PartyRole;
  }): Promise<PortFetch<never>> {
    void query;
    return { kind: 'unavailable', target: 'agent proposals', detail: AREA_19_UNAVAILABLE };
  }

  async function getMediationCase(query: {
    caseId: string;
    viewer: PartyRole;
  }): Promise<PortFetch<never>> {
    void query;
    return { kind: 'unavailable', target: 'mediation cases', detail: AREA_19_UNAVAILABLE };
  }

  async function getDispute(query: {
    disputeId: string;
    viewer: PartyRole;
  }): Promise<PortFetch<DisputeRecord>> {
    const dispute = recordedDisputes(handle).find(
      (entry) => entry.disputeId === query.disputeId,
    );
    if (dispute === undefined) {
      return {
        kind: 'not-visible',
        reason:
          `The composed runtime records no dispute ${query.disputeId} in the A15 chain (no DISPUTE_OPEN transition names it). ` +
          'This is the runtime\u2019s real answer for this reference — never a fabricated dispute record.',
      };
    }
    const record = disputeRecordFor(dispute);
    if (record === null) {
      return {
        kind: 'not-visible',
        reason: `The obligation behind dispute ${query.disputeId} is no longer readable in the runtime.`,
      };
    }
    return { kind: 'fetched', record };
  }

  async function getDisputeInitiationBriefing(): Promise<DisputeInitiationBriefing> {
    return DISPUTE_INITIATION_BRIEFING;
  }

  async function submitProposalDecision(
    request: ProposalDecisionRequest,
  ): Promise<ProposalDecisionResult> {
    return {
      kind: 'denied',
      reason:
        'Not applied: the composed runtime exposes no agent-proposal command surface (the Agents/Mediation Authority, ' +
        `area 19, is RTN wave 2). The decision on proposal ${request.proposalId} was refused — nothing was committed, ` +
        'nothing was fabricated. ' +
        AREA_19_UNAVAILABLE,
    };
  }

  async function submitMediationAction(request: MediationActionRequest): Promise<MediationActionResult> {
    return {
      kind: 'denied',
      reason:
        'Not applied: the composed runtime exposes no mediation-case command surface (the Agents/Mediation Authority, ' +
        `area 19, is RTN wave 2). The action (${request.action}) on case ${request.caseId} was refused — nothing was ` +
        'committed, nothing was fabricated. ' +
        AREA_19_UNAVAILABLE,
    };
  }

  async function initiateDispute(request: DisputeInitiationRequest): Promise<DisputeInitiationResult> {
    const candidates = obligationsForReference(handle, request.intentReference);
    const obligation = candidates.find((candidate) => isDisputable(candidate));
    if (obligation === undefined) {
      const terminalNote =
        candidates.length > 0
          ? `The matching obligation is in the ${candidates[0].state} state — the frozen one-way table does not allow the DISPUTED transition from there (resolution, not re-dispute, is the recorded path).`
          : 'No obligation recorded for this reference in the composed runtime: the A10 dispute primitive attaches to ' +
            'OBLIGATIONS (obligations.dispute.open requires a recorded obligation). Obligations arise from clearing ' +
            'commits over fulfilled activity; a reference that never reached clearing has no obligation to dispute.';
      return {
        kind: 'denied',
        reason:
          `The dispute was NOT initiated — nothing was recorded. ${terminalNote}`,
      };
    }
    // THE dispute command: obligations.dispute.open through the sole
    // admission point, with a deterministic dispute id over the submission.
    const disputeId = deriveProtocolId(
      'dispute',
      request.intentReference,
      request.actor,
      request.grounds.join(','),
    );
    const idempotencyKey = `dispute-open.${disputeId}`;
    protocolSequence += 1;
    const envelope: CommandEnvelope = {
      kind: 'obligations.dispute.open',
      authority: 'Obligation Authority',
      subjectIds: [obligation.obligationId],
      idempotencyKey,
      protocolTime: protocolTime(protocolSequence, Date.now()),
      body: { obligationId: obligation.obligationId, disputeId },
    };
    const admission = await handle.gateway.submitCommand(envelope);
    if (!admission.ok) {
      return {
        kind: 'denied',
        reason:
          `The dispute command was refused at admission: the protocol gateway rejected obligations.dispute.open with ` +
          `reason code ${admission.reasonCode}${admission.field ? ` (field ${admission.field})` : ''} — ${admission.problem} ` +
          'Nothing was recorded; re-check the obligation\u2019s state and re-submit if appropriate.',
      };
    }
    await handle.drain();
    const record = disputeRecordFor({
      disputeId,
      obligationId: obligation.obligationId,
      when: { wallMs: Date.now() },
    });
    if (record === null) {
      return {
        kind: 'denied',
        reason:
          'The dispute command was admitted, but the obligation\u2019s post-command state is not yet readable; re-check the ' +
          'dispute by its id — the durable path executes admitted jobs exactly once.',
      };
    }
    return { kind: 'initiated', record, reference: disputeId };
  }

  async function describeProposalDecisionMatrix(query: {
    proposalId: string;
  }): Promise<readonly RoleAuthorizationRow[]> {
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
      entries: (['accept', 'reject', 'counter', 'escalate'] as const).map((decision) => ({
        decision,
        authorized: false,
        reason:
          `No proposal decision is authorized for proposal ${query.proposalId}: the area-19 proposal surface is not ` +
          'merged as runtime code, so the adapter offers no decision path — fail closed, never fabricated.',
      })),
    }));
  }

  async function describeMediationActionMatrix(query: {
    caseId: string;
  }): Promise<readonly MediationRoleAuthorizationRow[]> {
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
      entries: (
        ['submit-statement', 'accept-proposed-resolution', 'decline-proposed-resolution'] as const
      ).map((action) => ({
        action,
        authorized: false,
        reason:
          `No mediation action is authorized for case ${query.caseId}: the area-19 mediation surface is not merged as ` +
          'runtime code, so the adapter offers no action path — fail closed, never fabricated.',
      })),
    }));
  }

  async function describeDisputeInitiationMatrix(query: {
    intentReference: string;
  }): Promise<readonly DisputeInitiationMatrixRow[]> {
    const candidates = obligationsForReference(handle, query.intentReference);
    const disputable = candidates.some((obligation) => isDisputable(obligation));
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
      authorized: disputable && (entry.role === 'customer' || entry.role === 'merchant'),
      reason: disputable
        ? entry.role === 'customer' || entry.role === 'merchant'
          ? `Authorized per the A10 dispute primitive: an OUTSTANDING obligation is recorded for ${query.intentReference}, and the disputing parties (customer/merchant) may submit obligations.dispute.open through the protocol gateway.`
          : 'Not authorized: operators and administrators do not initiate payment disputes (the disputing parties do).'
        : `Not authorized: the composed runtime records no OUTSTANDING obligation for ${query.intentReference} (the A10 dispute primitive attaches to obligations).`,
    }));
  }

  async function applyHarnessScript(script: MediationHarnessScript): Promise<{
    applied: string;
    note: string;
  }> {
    return {
      applied: 'no',
      note:
        'The runtime-backed mediation adapter exposes no authority-state scripting: harness scripts cannot fabricate ' +
        'runtime authority state. Dispute state is read from the A10 records + the A15 chain; disputes are initiated only ' +
        'through obligations.dispute.open via the protocol gateway. ' +
        MEDIATION_RUNTIME_NOTE +
        ` [script type: ${script.type}]`,
    };
  }

  return {
    getPartyDocket,
    getProposal,
    getMediationCase,
    getDispute,
    getDisputeInitiationBriefing,
    submitProposalDecision,
    submitMediationAction,
    initiateDispute,
    describeProposalDecisionMatrix,
    describeMediationActionMatrix,
    describeDisputeInitiationMatrix,
    applyHarnessScript,
  };
}
