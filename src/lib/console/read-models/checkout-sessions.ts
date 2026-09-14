/**
 * PC-003 — Checkout sessions read models (list + per-session status).
 *
 * Thin server-side composition over the EXISTING merchant checkout read path
 * — the same boundary the product merchant checkout surface uses:
 *   - list:   getCheckoutPort().listOpenCheckouts()
 *   - status: getCheckoutPort().getStatus({ checkoutId })
 *   (src/lib/protocol/checkout-port.ts — the runtime adapter reading the
 *   composed A01 Intent Authority; the area-20 Merchant Authority runtime is
 *   RTN wave 2 and the port honestly pins runtime ARRIVING with decisions
 *   refused — nothing here changes or hides that).
 *
 * Display resolution reuses the FROZEN product mapping:
 * resolveCheckoutDisplay (src/lib/protocol/checkout-state-mapping.ts) —
 * each MerchantCheckoutState resolves to exactly one display state and its
 * cko-map-XX nine-question record id; the console status is that display
 * state projected onto the six-status vocabulary.
 *
 * UNKNOWN discipline — with the EMPTY-vs-UNKNOWN distinction the design
 * demands (§9, and the work order's "distinguish carefully"):
 *   - ok:false with 'authority-unreachable' is a TRANSPORT failure → the
 *     UNAVAILABLE branch via consoleTransportFailure (UNKNOWN, never a
 *     fabricated offer/state);
 *   - ok:false with 'checkout-not-found' is the authority's no-record
 *     answer for the reference → the UNAVAILABLE branch with the adapter's
 *     own wording (UNKNOWN for this reference — never "not found" failure);
 *   - ok:true with an EMPTY item list is a legitimate VALUE (the authority
 *     answered: there are no open checkout offers) — this port's contract
 *     has no no-answer member for the list, so emptiness is authoritative,
 *     unlike the intent list's P5 no-answer discipline.
 *
 * Role scoping: module-level only — console.checkout.sessions is
 * merchant-only in the frozen route-role matrix (the existing product
 * checkout surface is merchant-audience); the port exposes no further
 * per-role read filter.
 */

import { getCheckoutPort } from '@/lib/protocol/checkout-port';
import type {
  CheckoutQueueResult,
  CheckoutStateRecord,
  CheckoutStatusResult,
} from '@/lib/protocol/checkout-port';
import { resolveCheckoutDisplay } from '@/lib/protocol/checkout-state-mapping';
import { consoleTransportFailure, consoleUnavailable, consoleValue } from '../dto';
import type { ConsoleReadResult, ConsoleStatus } from '../types';
import { consoleSourceMetadata } from '../authority/sources';

// ── DTOs ───────────────────────────────────────────────────────────────────

/** One open checkout session exactly as the checkout port reports it. */
export interface ConsoleCheckoutSessionDto {
  readonly checkoutId: string;
  readonly protocolReference: string;
  readonly title: string;
  /** Authority-quoted money (integer minor units + currency) — never recomputed. */
  readonly receiveAmount: { readonly amountMinorUnits: number; readonly currency: string };
  /** ISO-8601 validity deadline, authority-quoted. */
  readonly validUntil: string;
}

/** The checkout-sessions list read value (empty list = legitimate authoritative answer). */
export interface ConsoleCheckoutSessionsDto {
  readonly sessions: readonly ConsoleCheckoutSessionDto[];
  /** The port's own honest pinned runtime status (area-20 is RTN wave 2). */
  readonly runtime: 'ARRIVING';
  /** The authority owner string the port reports. */
  readonly authorityOwner: string;
  /** Who reported the items (the port's reportedBy). */
  readonly reportedBy: string;
}

/** The per-session status read value. */
export interface ConsoleCheckoutSessionStatusDto {
  readonly checkoutId: string;
  /** The MerchantCheckoutState authority state, verbatim. */
  readonly state: string;
  /** The frozen display resolution of the state (one of the six). */
  readonly displayStatus: ConsoleStatus;
  /** The cko-map-XX nine-question record id (evidence trail). */
  readonly mappingRecord: string;
  readonly reportedBy: string;
  /** ISO-8601, authority-quoted. */
  readonly at: string;
  /** Present when the authority reported a failure reason. */
  readonly reason?: string;
  /** Authority-suggested next actions when the state is failed. */
  readonly nextActions?: readonly string[];
  /** Reachable evidence for consequential outcomes. */
  readonly evidence?: { readonly label: string; readonly href: string };
  /** Reconciliation path when the state is unknown. */
  readonly reconciliation?: { readonly whoResolves: string; readonly recheckTrigger: string };
}

// ── Display mapping (frozen product mapping → six-status vocabulary) ───────

/** Map the frozen checkout display kinds onto the six console statuses. */
export function checkoutDisplayStatus(record: CheckoutStateRecord): ConsoleStatus {
  const display = resolveCheckoutDisplay(record);
  switch (display.kind) {
    case 'action-required':
      return 'ACTION_REQUIRED';
    case 'in-progress-accept-submission':
    case 'in-progress-decline-submission':
      return 'IN_PROGRESS';
    case 'succeeded-acknowledged':
    case 'succeeded-declined':
      return 'SUCCEEDED';
    case 'waiting-payment-confirmation':
      return 'WAITING';
    case 'failed':
      return 'FAILED';
    case 'unknown':
      return 'UNKNOWN';
  }
}

/** The cko-map-XX record id for the state (frozen mapping evidence). */
export function checkoutMappingRecord(record: CheckoutStateRecord): string {
  return resolveCheckoutDisplay(record).recordId;
}

// ── Reads ──────────────────────────────────────────────────────────────────

/**
 * Read the open checkout sessions (merchant-scoped module). An EMPTY list is
 * a legitimate authoritative VALUE (the authority answered: no open offers);
 * only port errors land in the UNAVAILABLE branch.
 */
export async function readConsoleCheckoutSessions(): Promise<ConsoleReadResult<ConsoleCheckoutSessionsDto>> {
  const authority = consoleSourceMetadata('checkout-sessions');
  const port = getCheckoutPort();
  let result: CheckoutQueueResult;
  try {
    result = await port.listOpenCheckouts();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return consoleTransportFailure(
      authority,
      `The checkout sessions read could not reach its owning authority (${detail}).`,
    );
  }
  if (!result.ok) {
    if (result.error === 'authority-unreachable') {
      return consoleTransportFailure(authority, result.detail);
    }
    // Any other port error is a no-answer for the list read — UNKNOWN, never
    // a fabricated empty list.
    return consoleUnavailable(authority, result.detail);
  }
  return consoleValue(
    {
      sessions: result.items.map((item) => ({
        checkoutId: item.checkoutId,
        protocolReference: item.protocolReference,
        title: item.title,
        receiveAmount: {
          amountMinorUnits: item.receiveAmount.amountMinorUnits,
          currency: item.receiveAmount.currency,
        },
        validUntil: item.validUntil,
      })),
      runtime: port.runtime,
      authorityOwner: port.authorityOwner,
      reportedBy: result.reportedBy,
    },
    'SUCCEEDED',
    authority,
  );
}

/**
 * Read one checkout session's authority-reported status. A checkout-not-found
 * answer renders UNKNOWN for the reference (the adapter's own wording) —
 * never a fabricated state, never "not found" failure.
 */
export async function readConsoleCheckoutSessionStatus(
  checkoutId: string,
): Promise<ConsoleReadResult<ConsoleCheckoutSessionStatusDto>> {
  const authority = consoleSourceMetadata('checkout-session-status');
  const port = getCheckoutPort();
  let result: CheckoutStatusResult;
  try {
    result = await port.getStatus({ checkoutId });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return consoleTransportFailure(
      authority,
      `The checkout session status read could not reach its owning authority (${detail}).`,
    );
  }
  if (!result.ok) {
    if (result.error === 'authority-unreachable') {
      return consoleTransportFailure(authority, result.detail);
    }
    // checkout-not-found (or any other no-answer): UNKNOWN for the reference.
    return consoleUnavailable(authority, result.detail);
  }
  const record: CheckoutStateRecord = result.record;
  const displayStatus = checkoutDisplayStatus(record);
  return consoleValue(
    {
      checkoutId: record.checkoutId,
      state: record.state,
      displayStatus,
      mappingRecord: checkoutMappingRecord(record),
      reportedBy: record.reportedBy,
      at: record.at,
      ...(record.reason === undefined ? {} : { reason: record.reason }),
      ...(record.nextActions === undefined ? {} : { nextActions: [...record.nextActions] }),
      ...(record.evidence === undefined
        ? {}
        : { evidence: { label: record.evidence.label, href: record.evidence.href } }),
      ...(record.reconciliation === undefined
        ? {}
        : {
            reconciliation: {
              whoResolves: record.reconciliation.whoResolves,
              recheckTrigger: record.reconciliation.recheckTrigger,
            },
          }),
    },
    displayStatus,
    authority,
  );
}
