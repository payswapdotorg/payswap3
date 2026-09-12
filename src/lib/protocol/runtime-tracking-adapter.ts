/**
 * ════════════════════════════════════════════════════════════════════════
 *  UI-011 — RUNTIME TRACKING ADAPTER (A01 + A15-backed TrackingPort)
 * ════════════════════════════════════════════════════════════════════════
 *
 * The runtime adapter behind getTrackingPort() once
 * src/lib/protocol/server-runtime.ts registers it. It implements the
 * FROZEN TrackingPort interface exactly — a READ-ONLY projection of the
 * composed runtime, never a decider:
 *
 *   • Tracked states are the A01 Intent Authority's own state reports
 *     (DRAFT … FULFILLED / FAILED / CANCELLED), each resolved to exactly
 *     one of the six tracked-state kinds (P4 — 'pending' is not
 *     expressible).
 *   • The plain-language history is the REAL A15 chain's INTENT_* records,
 *     most recent first, worded from the records' own outcomes and reason
 *     codes.
 *   • The proof trail is the real A15 record chain itself (record ids,
 *     sequence numbers, hashes, owning authorities) — presented as
 *     'recorded' evidence views; a record the verification harness has
 *     scripted to no-answer renders as the no-answer evidence view (P5's
 *     honest record-level UNKNOWN), never a synthesized substitute.
 *   • Reference resolution: the runtime's own intent ids (the protocol
 *     object ids the A15 chain actually names). A reference the runtime
 *     does not know renders not-found with UNKNOWN-honest wording — the
 *     mock-era presentation contract, now answered from runtime truth.
 *   • Viewer roles: the composed runtime's read surface places no
 *     per-viewer restriction on protocol object reads; the product shell's
 *     audience model governs surface access (documented in the records).
 */

import { TRACKING_BOUNDARY_REPORT } from './adapter-boundary';
import type {
  EvidenceRecordView,
  TrackingBoundaryReport,
  TrackingLookupResult,
  TrackingPort,
  TrackedCurrentState,
  TrackedHistoryEntry,
  TrackedReferenceView,
} from './tracking-port';
import type { NavAudience } from '@/lib/navigation';
import type { ProtocolRuntimeHandle } from './runtime-handle';
import type { EvidenceRecord, Money, PaymentIntent } from '../protocol-runtime/index.ts';

type ScriptedAvailability = 'recorded' | 'no-answer';

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

const REPORTED_BY = 'Intent Authority (A01) over the composed protocol runtime';
const EVIDENCE_REPORTED_BY = 'Evidence Authority (A15) — the real record chain';

export interface RuntimeTrackingScripting {
  /** VERIFICATION ONLY: reset the evidence-availability scripting. */
  resetScripting(): void;
  /**
   * VERIFICATION ONLY: script the availability of one evidence record's
   * READ (the demonstration affordance for the no-answer record view).
   * This scripts the ADAPTER'S READ of the A15 record — never the record
   * itself: the chain is immutable.
   */
  scriptEvidenceAvailability(reference: string, recordId: string, availability: ScriptedAvailability): void;
}

export function createRuntimeTrackingAdapter(
  handle: ProtocolRuntimeHandle,
): TrackingPort & RuntimeTrackingScripting {
  // Verification scripting state (the A15 READ's availability axis only).
  const scriptedNoAnswer = new Map<string, string>(); // recordId -> reference

  function resetScripting(): void {
    scriptedNoAnswer.clear();
  }

  function scriptEvidenceAvailability(
    reference: string,
    recordId: string,
    availability: ScriptedAvailability,
  ): void {
    if (availability === 'no-answer') {
      scriptedNoAnswer.set(recordId, reference);
    } else {
      scriptedNoAnswer.delete(recordId);
    }
  }

  function intentRecords(intentId: string): EvidenceRecord[] {
    return handle.evidenceLog
      .records()
      .filter(
        (record) =>
          (record.what.operationType === 'INTENT_CREATED' ||
            record.what.operationType === 'INTENT_AUTHORIZED' ||
            record.what.operationType === 'INTENT_STATE_CHANGED') &&
          record.what.subjectIds.includes(intentId),
      );
  }

  function currentStateFor(intent: PaymentIntent, records: readonly EvidenceRecord[]): TrackedCurrentState {
    const amount = formatMoney(intent.descriptor.amount);
    const protocolObject = { objectType: 'PaymentIntent', objectId: intent.intentId };
    const meta = {
      protocolObject,
      owningAuthority: 'Intent Authority (A01)',
      since: isoOfWall(intent.stateChangedAt.wallMs),
    };
    switch (intent.state) {
      case 'DRAFT':
        return {
          ...meta,
          state: 'waiting',
          whatIsWaiting: `The payment intent ${intent.intentId} (${amount}), held by the Intent Authority in DRAFT with fixed terms.`,
          why: 'Awaiting the authority\u2019s compliance-gated authorization decision (INV-16-3) — as reported.',
          whatHappensNext:
            'The authority reports the authorization decision; the tracked state changes only when that report arrives.',
          reportedBy: REPORTED_BY,
          availableActions: [],
        };
      case 'AUTHORIZED':
      case 'ROUTED':
      case 'FULFILLING':
        return {
          ...meta,
          state: 'in-progress',
          whatIsHappening: `The Intent Authority reports the intent ${intent.intentId} ${intent.state} — progressing as reported.`,
          whatCompletesIt:
            'The authority\u2019s next recorded transition (FULFILLED, FAILED, or CANCELLED per the frozen one-way table).',
          reportedBy: REPORTED_BY,
        };
      case 'FULFILLED':
        return {
          ...meta,
          state: 'succeeded',
          outcome:
            `The Intent Authority reports the intent ${intent.intentId} FULFILLED — the fulfillment it authorized has completed, as reported ` +
            `(amount ${amount}). Settlement finality is NOT stated: that is the Settlement and Finality Authority\u2019s report.`,
          reportedBy: REPORTED_BY,
          evidence: {
            label: `A15 evidence chain for ${intent.intentId}`,
            href: `/track/${intent.intentId}#evidence`,
          },
        };
      case 'FAILED':
      case 'CANCELLED': {
        const reasonRecord = [...records]
          .reverse()
          .find((record) => record.outcome.reasonCode !== undefined);
        const reason = reasonRecord?.outcome.reasonCode;
        const terminal = intent.state;
        return {
          ...meta,
          state: 'failed',
          outcome:
            terminal === 'FAILED'
              ? `The Intent Authority reports the intent ${intent.intentId} FAILED${reason ? ` (reason code ${reason})` : ''} — a terminal outcome as recorded in the A15 chain.`
              : `The Intent Authority reports the intent ${intent.intentId} CANCELLED${reason ? ` (reason code ${reason})` : ''} — the intent did not proceed and no money moved.`,
          reportedBy: REPORTED_BY,
          reason,
          nextActions:
            terminal === 'FAILED'
              ? [
                  'A retry is a new, explicitly submitted intent linked to the prior intent id — never a silent resubmission',
                ]
              : ['Any new payment is a new, separately reviewed submission'],
        };
      }
    }
  }

  function historyFor(intent: PaymentIntent, records: readonly EvidenceRecord[]): TrackedHistoryEntry[] {
    return [...records]
      .reverse()
      .map((record) => ({
        entryId: record.proof.recordId,
        at: isoOfWall(record.when.wallMs),
        authority: record.authority,
        wording:
          `${record.what.operationType}: the intent moved to ${record.outcome.result}` +
          (record.outcome.reasonCode ? ` with reason code ${record.outcome.reasonCode}` : '') +
          ' (recorded in the A15 chain).',
      }));
  }

  function evidenceTrailFor(
    referenceId: string,
    records: readonly EvidenceRecord[],
  ): EvidenceRecordView[] {
    return records.map((record) => {
      const recordId = record.proof.recordId;
      if (scriptedNoAnswer.get(recordId) === referenceId) {
        return {
          kind: 'no-answer',
          recordId,
          label: record.what.operationType,
          owningAuthority: EVIDENCE_REPORTED_BY,
          explanation:
            'The evidence read for this record is scripted to no-answer for this verification run — the record\u2019s availability is ' +
            'presented as UNKNOWN. The A15 record itself is immutable; nothing is synthesized in place of the missing answer (P5, N1).',
          reconciliation: {
            whoResolves: 'The Evidence Authority (A15) — the adapter\u2019s read of the record',
            recheckTrigger: 'Re-run the verification with the record\u2019s availability scripted back to recorded',
          },
        };
      }
      return {
        kind: 'recorded',
        recordId,
        label: record.what.operationType,
        owningAuthority: EVIDENCE_REPORTED_BY,
        recordedAt: isoOfWall(record.when.wallMs),
        outcomeWording:
          `${record.outcome.result}` +
          (record.outcome.reasonCode ? ` (reason code ${record.outcome.reasonCode})` : '') +
          ` \u00b7 sequence ${record.proof.sequenceNumber} \u00b7 hash ${record.proof.recordHash}`,
      };
    });
  }

  function viewFor(referenceId: string, intent: PaymentIntent): TrackedReferenceView {
    const records = intentRecords(intent.intentId);
    return {
      referenceId,
      subjectWording: `The payment intent ${intent.intentId} (${formatMoney(intent.descriptor.amount)}, ${intent.descriptor.source.account} \u2192 ${intent.descriptor.destination.account})`,
      subjectKind: 'payment intent',
      protocolObject: { objectType: 'PaymentIntent', objectId: intent.intentId },
      owningAuthority: 'Intent Authority (A01)',
      viewerAudience: 'operator' as NavAudience,
      currentState: currentStateFor(intent, records),
      history: historyFor(intent, records),
      evidenceTrail: evidenceTrailFor(referenceId, records),
    };
  }

  async function lookupReference(reference: string, viewer: NavAudience): Promise<TrackingLookupResult> {
    const trimmed = reference.trim();
    const intent = handle.authorities.intent.getIntent(trimmed);
    if (intent === undefined) {
      return {
        kind: 'not-found',
        searchedReference: reference,
        wording:
          'No tracked record matches this reference in the composed runtime: the Intent Authority holds no intent record ' +
          `for ${trimmed || '(empty)'} and the A15 chain names no such protocol object. This is the runtime\u2019s real answer for this ` +
          'reference — presented as the explicit not-found outcome, never as a fabricated state. Check the reference and enter it ' +
          'again; references are the protocol object ids the runtime records.',
        reportedBy: REPORTED_BY,
      };
    }
    return { kind: 'tracked', view: { ...viewFor(reference, intent), viewerAudience: viewer } };
  }

  function describeBoundary(): TrackingBoundaryReport {
    return TRACKING_BOUNDARY_REPORT;
  }

  return {
    lookupReference,
    describeBoundary,
    resetScripting,
    scriptEvidenceAvailability,
  };
}
