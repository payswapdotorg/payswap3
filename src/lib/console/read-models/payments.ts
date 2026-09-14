/**
 * PC-003 — Payments read models (list + detail).
 *
 * Thin server-side composition over the EXISTING intent authority read path —
 * exactly the boundary the mediation routes and customer pay surface already
 * use (the SYS-001 seam): the ROUTE performs ensureProductPortsWired() and
 * this read model then resolves the port accessors:
 *
 *   - payment list:  getIntentPort().listSessionIntents()
 *     (src/lib/protocol/intent-port.ts — the runtime adapter over the
 *     composed A01 Intent Authority + the real A15 evidence chain);
 *   - payment detail: getIntentPort().getIntentState(intentId) plus the
 *     waiting/queued sub-read getWaitingPort().lookupWaiting(intentId,
 *     viewerRole) (src/lib/protocol/waiting-port.ts — A08 with A06/A07
 *     reads), which is the ONLY data-level role check these reads perform
 *     (the per-reference viewer-role check the queue authority owns).
 *
 * Display resolution reuses the FROZEN product mapping — nothing is
 * re-derived here: INTENT_STATE_DISPLAY_MAP / BOUNDARY_DISPLAY_RESOLUTION /
 * mappingRecordRef (src/lib/protocol/intent-state-mapping.ts).
 *
 * UNKNOWN discipline (design §9; structural in PC-001's dto.ts):
 *   - a port no-answer (the authority holds no record / the A15 chain holds
 *     no intents) lands in the UNAVAILABLE branch — presentation UNKNOWN,
 *     never a business FAILED/SUCCEEDED, never "not found", never an empty
 *     list standing in for an authoritative answer;
 *   - a transport failure (the port call itself throws) lands in the
 *     UNAVAILABLE branch via consoleTransportFailure — infrastructure
 *     failure, not a business outcome;
 *   - the waiting sub-read keeps the queue authority's OWN honest answers
 *     distinct: 'none' (no waiting/queued record — a legitimate VALUE),
 *     'role-denied' (the authority's authorization answer for this viewer),
 *     'unknown' (transport only).
 *
 * Read-level status convention for COLLECTION reads: the envelope status
 * describes the READ (the owning authority answered the read with a
 * collection), NOT an aggregate business verdict over the items — no
 * aggregation is computed anywhere in this module (aggregating item
 * statuses would recompute a verdict the authority never gave). The
 * per-item business truth is each item's authorityState + displayStatus
 * from the frozen mapping. For the DETAIL read the envelope status IS the
 * authority-reported business status of that one payment.
 *
 * Role scoping (route-role-matrix.md): module-level access is enforced at
 * the API route (console.payments.all / console.payments.detail — customer,
 * merchant, operator). The intent port's list read exposes NO per-role list
 * filter (its scope is the port's own session/runtime scope — recorded in
 * the DTO's scopeNote as an honest limitation for PC-004/Lead review), and
 * the per-reference data-level check is the waiting port's viewer-role
 * check above.
 */

import type { Role } from '@/lib/navigation';
import { getIntentPort } from '@/lib/protocol/intent-port';
import type {
  IntentEvidenceRecord,
  IntentStateSnapshot,
  SessionIntentListResult,
  StateReport,
} from '@/lib/protocol/intent-port';
import { getWaitingPort } from '@/lib/protocol/waiting-port';
import type { WaitingLookupResult, WaitingSnapshot } from '@/lib/protocol/waiting-port';
import {
  INTENT_STATE_DISPLAY_MAP,
  mappingRecordRef,
} from '@/lib/protocol/intent-state-mapping';
import { consoleTransportFailure, consoleUnavailable, consoleValue } from '../dto';
import type { ConsoleReadResult, ConsoleStatus } from '../types';
import { consoleSourceMetadata } from '../authority/sources';

// ── DTOs ───────────────────────────────────────────────────────────────────

/** One payment in the list, exactly as the intent authority reports it. */
export interface ConsolePaymentSummaryDto {
  readonly intentId: string;
  /** The A01 authority state, verbatim (authority vocabulary). */
  readonly authorityState: string;
  /** The frozen display resolution of the authority state (one of the six). */
  readonly displayStatus: ConsoleStatus;
  /** The nine-question mapping record for the state (evidence trail). */
  readonly mappingRecord: string;
  readonly reportedAt: string;
  /** Authority-quoted decimal string, e.g. "25.00" (never recomputed). */
  readonly amount: string;
  readonly currency: string;
  readonly recipientName: string;
}

/** The payment-list read value (a collection; see the module header for the status convention). */
export interface ConsolePaymentListDto {
  readonly payments: readonly ConsolePaymentSummaryDto[];
  readonly viewerRole: Role;
  /** Honest scope statement: what the owning read actually scopes to. */
  readonly scopeNote: string;
}

/** The waiting/queued sub-read of a payment detail (A08's own answers, kept distinct). */
export type ConsoleWaitingReadDto =
  | {
      readonly status: 'reported';
      readonly authorityStateId: string;
      readonly snapshotKind: 'condition' | 'unknown' | 'resolution';
      readonly displayStatus: ConsoleStatus;
      readonly summary: string;
      readonly reason: string;
      readonly reportedBy: string;
      readonly reportedAt: string;
      /** Recovery action ids the authority reports as available for this viewer (empty = explicit none). */
      readonly recoveryActions: readonly string[];
      readonly inquiryAvailable: boolean;
    }
  | {
      /** The queue authority's honest no-record answer — a legitimate VALUE, not UNKNOWN. */
      readonly status: 'none';
      readonly note: string;
    }
  | {
      /** The queue authority's per-reference authorization answer for this viewer role. */
      readonly status: 'role-denied';
      readonly viewerRole: Role;
      readonly allowedViewerRoles: readonly string[];
    }
  | {
      /** Transport failure of the waiting sub-read only — never a business verdict. */
      readonly status: 'unknown';
      readonly note: string;
    };

/** The flagship payment detail (design §7), every figure authority-quoted. */
export interface ConsolePaymentDetailDto {
  readonly intentId: string;
  /** The A01 authority state, verbatim. */
  readonly authorityState: string;
  /** The frozen display resolution — the envelope status of this read. */
  readonly displayStatus: ConsoleStatus;
  readonly mappingRecord: string;
  readonly reportedAt: string;
  readonly amount: string;
  readonly currency: string;
  readonly recipientName: string;
  readonly sourceName: string;
  readonly customerReference?: string;
  readonly composedAt: string;
  /** The authority's state report, carried verbatim in the port's frozen shape. */
  readonly stateReport: StateReport;
  /** The A15 evidence records the port surfaced, carried verbatim. */
  readonly evidence: readonly IntentEvidenceRecord[];
  /** The A08 waiting/queued sub-read for this reference and viewer. */
  readonly waiting: ConsoleWaitingReadDto;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const PAYMENTS_SCOPE_NOTE =
  'The intent port exposes no per-role list filter: this list is the owning read authority’s own scope (the intents the composed runtime’s A15 chain records for this process), module-gated to customer/merchant/operator at the console boundary; per-reference data-level role checks apply on the detail read (the queue authority’s viewer-role check).';

function waitingDisplayStatus(snapshot: WaitingSnapshot): ConsoleStatus {
  switch (snapshot.snapshotKind) {
    case 'condition':
      return 'WAITING';
    case 'unknown':
      return 'UNKNOWN';
    case 'resolution':
      return snapshot.outcome === 'succeeded'
        ? 'SUCCEEDED'
        : snapshot.outcome === 'failed'
          ? 'FAILED'
          : 'UNKNOWN';
  }
}

function waitingSummary(snapshot: WaitingSnapshot): string {
  switch (snapshot.snapshotKind) {
    case 'condition':
      return snapshot.whatIsWaiting;
    case 'unknown':
      return snapshot.subject;
    case 'resolution':
      return snapshot.outcomeDetail;
  }
}

function waitingReason(snapshot: WaitingSnapshot): string {
  switch (snapshot.snapshotKind) {
    case 'condition':
      return snapshot.reason;
    case 'unknown':
      return snapshot.explanation;
    case 'resolution':
      return snapshot.failureReason ?? snapshot.outcomeDetail;
  }
}

function normalizeWaiting(lookup: WaitingLookupResult): ConsoleWaitingReadDto {
  if (lookup.status === 'not-found') {
    return {
      status: 'none',
      note: 'The Fulfillment/Queue Authority holds no waiting/queued record for this reference — its own honest answer, not an unavailable read.',
    };
  }
  if (lookup.status === 'role-denied') {
    return {
      status: 'role-denied',
      viewerRole: lookup.viewerRole,
      allowedViewerRoles: [...lookup.allowedViewerRoles],
    };
  }
  const snapshot = lookup.snapshot;
  return {
    status: 'reported',
    authorityStateId: snapshot.authorityStateId,
    snapshotKind: snapshot.snapshotKind,
    displayStatus: waitingDisplayStatus(snapshot),
    summary: waitingSummary(snapshot),
    reason: waitingReason(snapshot),
    reportedBy: snapshot.reportedBy,
    reportedAt: snapshot.reportedAt,
    recoveryActions: snapshot.recovery.map((action) => action.actionId),
    inquiryAvailable: snapshot.inquiry.available,
  };
}

function transportNote(operation: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `The ${operation} read could not reach its owning authority (${detail}).`;
}

// ── Payment list ───────────────────────────────────────────────────────────

/**
 * Read the payment list for the given viewer role. Thin composition over
 * IntentPort.listSessionIntents() — the port's own no-answer discipline is
 * preserved exactly (no-answer renders UNKNOWN, never an empty list).
 */
export async function readConsolePayments(viewerRole: Role): Promise<ConsoleReadResult<ConsolePaymentListDto>> {
  const authority = consoleSourceMetadata('payments');
  const port = getIntentPort();
  let result: SessionIntentListResult;
  try {
    result = await port.listSessionIntents();
  } catch (error) {
    return consoleTransportFailure(authority, transportNote('payment list', error));
  }
  if (result.kind === 'no-answer') {
    // The port's own P5 discipline, verbatim: the A15 chain holds no intents.
    return consoleUnavailable(authority, result.note);
  }
  return consoleValue(
    {
      payments: result.records.map((record) => ({
        intentId: record.intentId,
        authorityState: record.authorityState,
        displayStatus: INTENT_STATE_DISPLAY_MAP[record.authorityState],
        mappingRecord: mappingRecordRef(record.authorityState),
        reportedAt: record.reportedAt,
        amount: record.amount,
        currency: record.currency,
        recipientName: record.recipientName,
      })),
      viewerRole,
      scopeNote: PAYMENTS_SCOPE_NOTE,
    },
    'SUCCEEDED',
    authority,
  );
}

// ── Payment detail ─────────────────────────────────────────────────────────

/**
 * Read one payment's detail (flagship view input): the A01 snapshot with its
 * A15 evidence, plus the A08 waiting/queued sub-read scoped to the viewer
 * role. A no-answer for the intent renders UNKNOWN — never "not found"
 * failure (design §7/§9); the waiting sub-read keeps the queue authority's
 * own honest answers distinct from transport failures.
 */
export async function readConsolePaymentDetail(
  intentId: string,
  viewerRole: Role,
): Promise<ConsoleReadResult<ConsolePaymentDetailDto>> {
  const authority = consoleSourceMetadata('payment-detail');
  const port = getIntentPort();
  let snapshot: IntentStateSnapshot | undefined;
  try {
    const result = await port.getIntentState(intentId);
    if (result.kind === 'no-answer') {
      // The authority's own no-answer wording, verbatim: UNKNOWN with its
      // reconciliation path — never a fabricated "not found" failure.
      return consoleUnavailable(authority, result.note);
    }
    snapshot = result.snapshot;
  } catch (error) {
    return consoleTransportFailure(authority, transportNote('payment detail', error));
  }

  // The A08 waiting sub-read: the ONLY per-reference data-level role check
  // (the queue authority checks the viewer role itself). A failure here
  // degrades the sub-read to 'unknown' — it NEVER degrades the whole
  // payment detail (the A01 answer stands on its own).
  let waiting: ConsoleWaitingReadDto;
  try {
    waiting = normalizeWaiting(getWaitingPort().lookupWaiting(intentId, viewerRole));
  } catch (error) {
    waiting = { status: 'unknown', note: transportNote('waiting sub-read', error) };
  }

  return consoleValue(
    {
      intentId: snapshot.intentId,
      authorityState: snapshot.authorityState,
      displayStatus: INTENT_STATE_DISPLAY_MAP[snapshot.authorityState],
      mappingRecord: mappingRecordRef(snapshot.authorityState),
      reportedAt: snapshot.reportedAt,
      amount: snapshot.intent.amount,
      currency: snapshot.intent.currency,
      recipientName: snapshot.intent.recipientName,
      sourceName: snapshot.intent.sourceName,
      ...(snapshot.intent.customerReference === undefined
        ? {}
        : { customerReference: snapshot.intent.customerReference }),
      composedAt: snapshot.intent.composedAt,
      stateReport: snapshot.stateReport,
      evidence: [...snapshot.evidence],
      waiting,
    },
    INTENT_STATE_DISPLAY_MAP[snapshot.authorityState],
    authority,
  );
}
