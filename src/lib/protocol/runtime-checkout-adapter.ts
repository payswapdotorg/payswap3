/**
 * ════════════════════════════════════════════════════════════════════════
 *  UI-011 — RUNTIME CHECKOUT ADAPTER (A01-backed CheckoutPort)
 * ════════════════════════════════════════════════════════════════════════
 *
 * The runtime adapter behind getCheckoutPort() once
 * src/lib/protocol/server-runtime.ts registers it. It implements the
 * FROZEN CheckoutPort interface exactly over the composed protocol
 * runtime, honestly scoped to what the runtime ACTUALLY owns:
 *
 *   • READS re-anchor to the LIVE composed A01 Intent Authority: an "open
 *     checkout offer" is a recorded intent (DRAFT) whose terms the runtime
 *     really holds (DemandDescriptor: amount, endpoints, deadline, allowed
 *     rails, cost ceiling). Only figures the Intent Authority actually
 *     reports are quoted — the runtime has no fee-quote surface, so no fee
 *     or merchant-receives figure is invented.
 *   • DECISIONS FAIL CLOSED: the composed runtime exposes NO merchant-
 *     decision command surface (the area-20 Merchant Authority — checkout
 *     session semantics, CHECKOUT_OPENED/COMPLETED/EXPIRED/CANCELLED — is
 *     RTN wave 2 and not merged). submitDecision refuses with the recorded
 *     gap (decision-not-allowed): nothing is committed, nothing is
 *     fabricated, and no simulated acceptance wording is produced.
 *   • The checkout authority surface's pinned runtime status stays
 *     honestly ARRIVING (wave 2); every reportedBy names the A01 read
 *     surface so the provenance is explicit.
 */

import { CHECKOUT_BOUNDARY } from './adapter-boundary';
import type {
  AuthorityQuotedMoney,
  CheckoutDecisionRequest,
  CheckoutDecisionResult,
  CheckoutId,
  CheckoutOfferRequest,
  CheckoutOfferResult,
  CheckoutOfferView,
  CheckoutPort,
  CheckoutQueueItem,
  CheckoutQueueResult,
  CheckoutStateRecord,
  CheckoutStatusRequest,
  CheckoutStatusResult,
  MerchantCheckoutState,
  OfferCondition,
} from './checkout-port';
import type { ProtocolRuntimeHandle } from './runtime-handle';
import type { EvidenceRecord, Money, PaymentIntent } from '../protocol-runtime/index.ts';

function formatKernelMoney(value: Money): AuthorityQuotedMoney {
  const sign = value.amountMinor < 0 ? '-' : '';
  const absolute = Math.abs(Math.trunc(value.amountMinor));
  const whole = Math.floor(absolute / 10 ** value.scale);
  const fraction = String(absolute % 10 ** value.scale).padStart(value.scale, '0');
  return { amountMinorUnits: Number(`${sign}${whole}${fraction}`), currency: value.currency };
}

function isoOfWall(wallMs: number): string {
  return new Date(wallMs).toISOString();
}

const REPORTED_BY =
  'runtime checkout adapter over the composed A01 Intent Authority (real intent terms; no fee-quote surface)';

/** The intents the A15 chain records, oldest first (the read surface). */
function recordedIntents(handle: ProtocolRuntimeHandle): PaymentIntent[] {
  const created = handle.evidenceLog
    .records()
    .filter((record) => record.what.operationType === 'INTENT_CREATED');
  const intents: PaymentIntent[] = [];
  for (const record of created) {
    const intentId = record.what.subjectIds[0];
    const intent = intentId === undefined ? undefined : handle.authorities.intent.getIntent(intentId);
    if (intent !== undefined) {
      intents.push(intent);
    }
  }
  return intents;
}

function conditionsFor(intent: PaymentIntent): OfferCondition[] {
  const constraints = intent.descriptor.constraints;
  return [
    {
      id: 'condition.deadline',
      title: 'Deadline the intent states',
      detail: `The intent's demand deadline is ${new Date(constraints.deadlineEpochMs).toISOString()} — as recorded by the Intent Authority. The runtime treats the deadline deterministically on protocol time.`,
      material: true,
    },
    {
      id: 'condition.rails',
      title: 'Rails the intent allows',
      detail: `The intent allows only these rails: ${constraints.allowedRails.join(', ') || '(none declared)'} — as recorded by the Intent Authority.`,
      material: true,
    },
    {
      id: 'condition.cost-ceiling',
      title: 'Cost ceiling the intent states',
      detail: `The customer's stated cost ceiling is ${formatKernelMoney(constraints.costCeiling).amountMinorUnits / 100} ${constraints.costCeiling.currency} — as recorded by the Intent Authority. The runtime enforces cost as integer Money (GC-1).`,
      material: true,
    },
    {
      id: 'condition.authority-progress',
      title: 'How the authority proceeds',
      detail:
        'The Intent Authority proceeds only through its own recorded transitions (compliance-gated authorization, routing, fulfillment). This surface shows only what the authority reports; accepting an offer commits you to fulfil once the authority records acceptance — which the composed runtime cannot yet record (the area-20 checkout surface is RTN wave 2), so no accept control is backed here.',
      material: true,
    },
    {
      id: 'condition.no-fee-quote',
      title: 'No fee is quoted here',
      detail:
        'The composed runtime exposes no fee-quote surface for checkout: no fee or merchant-receives figure appears on this offer, because no authority reports one. Nothing is estimated UI-side.',
      material: false,
    },
  ];
}

function offerViewFor(intent: PaymentIntent): CheckoutOfferView {
  const amount = formatKernelMoney(intent.descriptor.amount);
  return {
    checkoutId: intent.intentId,
    protocolReference: intent.intentId,
    intentReference: intent.intentId,
    title: `Open offer — payment intent ${intent.intentId}`,
    quotedAt: isoOfWall(intent.createdAt.wallMs),
    validUntil: new Date(intent.descriptor.constraints.deadlineEpochMs).toISOString(),
    quotedAmounts: [
      {
        key: 'customer-pays',
        label: 'Customer pays (as the intent records)',
        amount,
        emphasis: 'primary',
        note: 'The DemandDescriptor amount, read from the Intent Authority — quoted verbatim.',
      },
    ],
    conditions: conditionsFor(intent),
    obligations: [],
    plainLanguageSummary:
      `The Intent Authority holds a payment intent of ${amount.amountMinorUnits / 100} ${amount.currency} ` +
      `(${intent.descriptor.source.account} \u2192 ${intent.descriptor.destination.account}) in DRAFT with fixed terms. ` +
      'If you accept, you commit to fulfil the order it describes; the authority records acceptance and the customer relies on it. ' +
      'No settlement or finality is stated here — the authority has not reported any.',
    evidence: {
      label: `Intent record ${intent.intentId} (A15 evidence chain)`,
      href: `/track/${intent.intentId}`,
    },
  };
}

function checkoutStateFor(intent: PaymentIntent, records: readonly EvidenceRecord[]): CheckoutStateRecord {
  let state: MerchantCheckoutState;
  let reason: string | undefined;
  let nextActions: readonly string[] | undefined;
  let reconciliation: CheckoutStateRecord['reconciliation'] | undefined;
  let availableActions: readonly string[] | undefined;
  switch (intent.state) {
    case 'DRAFT':
      state = 'offered';
      availableActions = [
        'Re-check with the authority (read-only)',
        'Observe the intent\u2019s state as the authority reports it',
      ];
      break;
    case 'AUTHORIZED':
    case 'ROUTED':
    case 'FULFILLING':
    case 'FULFILLED':
      state = 'unknown';
      reconciliation = {
        whoResolves:
          'The Checkout/Intent Authority: the area-20 checkout-session record (wave 2) would resolve the merchant-decision outcome; the composed runtime reports only the intent\u2019s own progression',
        recheckTrigger:
          'Re-check this checkout: the surface re-reads the Intent Authority\u2019s recorded state and reports whatever returns, including another unknown',
      };
      break;
    case 'FAILED':
      state = 'failed';
      reason = 'The Intent Authority moved the intent to FAILED (see the intent\u2019s state page for the recorded reason code).';
      nextActions = [
        'Open the intent\u2019s state page for the authority\u2019s recorded reason',
        'A retry is a new, separately reviewed submission — never a silent resubmission',
      ];
      break;
    case 'CANCELLED':
      state = 'failed';
      reason = 'The Intent Authority reports the intent CANCELLED — the offer did not proceed and no money moved.';
      nextActions = ['Open the intent\u2019s state page for the authority\u2019s recorded reason code'];
      break;
  }
  return {
    checkoutId: intent.intentId,
    state,
    reportedBy: REPORTED_BY,
    at: isoOfWall(intent.stateChangedAt.wallMs),
    ...(reason === undefined ? {} : { reason }),
    ...(nextActions === undefined ? {} : { nextActions }),
    evidence: {
      label: `Intent record ${intent.intentId} (A15 evidence chain)`,
      href: `/track/${intent.intentId}`,
    },
    ...(reconciliation === undefined ? {} : { reconciliation }),
    originatingOfferSummary: offerViewFor(intent).plainLanguageSummary,
    originatingOfferId: intent.intentId,
    ...(availableActions === undefined ? {} : { availableActions }),
  };
}

export function createRuntimeCheckoutAdapter(handle: ProtocolRuntimeHandle): CheckoutPort {
  function findIntent(checkoutId: CheckoutId): PaymentIntent | undefined {
    return handle.authorities.intent.getIntent(checkoutId);
  }

  async function getOffer(request: CheckoutOfferRequest): Promise<CheckoutOfferResult> {
    const intents = recordedIntents(handle);
    const intent =
      request.checkoutId === undefined
        ? intents.find((candidate) => candidate.state === 'DRAFT') ?? intents[0]
        : findIntent(request.checkoutId);
    if (intent === undefined) {
      return {
        ok: false,
        error: 'checkout-not-found',
        detail:
          request.checkoutId === undefined
            ? 'The composed runtime\u2019s A15 chain records no intents, so no checkout offer exists to present. This is the runtime\u2019s real state, not a transport failure — nothing is fabricated.'
            : `The Intent Authority holds no intent record for ${request.checkoutId}. No offer is presented — never a fabricated one.`,
        reportedBy: REPORTED_BY,
        runtime: 'ARRIVING',
      };
    }
    return { ok: true, offer: offerViewFor(intent), reportedBy: REPORTED_BY, runtime: 'ARRIVING' };
  }

  async function getStatus(request: CheckoutStatusRequest): Promise<CheckoutStatusResult> {
    const intent = findIntent(request.checkoutId);
    if (intent === undefined) {
      return {
        ok: false,
        error: 'checkout-not-found',
        detail: `The Intent Authority holds no intent record for ${request.checkoutId}, so no checkout state exists to report. UNKNOWN for this reference — never a fabricated state.`,
        reportedBy: REPORTED_BY,
        runtime: 'ARRIVING',
      };
    }
    const records = handle.evidenceLog
      .records()
      .filter((record) => record.what.subjectIds.includes(intent.intentId));
    return {
      ok: true,
      record: checkoutStateFor(intent, records),
      runtime: 'ARRIVING',
    };
  }

  async function listOpenCheckouts(): Promise<CheckoutQueueResult> {
    const items: CheckoutQueueItem[] = recordedIntents(handle)
      .filter((intent) => intent.state === 'DRAFT')
      .map((intent) => ({
        checkoutId: intent.intentId,
        protocolReference: intent.intentId,
        title: `Open offer — payment intent ${intent.intentId}`,
        receiveAmount: formatKernelMoney(intent.descriptor.amount),
        validUntil: new Date(intent.descriptor.constraints.deadlineEpochMs).toISOString(),
      }));
    return { ok: true, items, reportedBy: REPORTED_BY, runtime: 'ARRIVING' };
  }

  async function submitDecision(_request: CheckoutDecisionRequest): Promise<CheckoutDecisionResult> {
    // FAIL CLOSED — the recorded runtime gap: the composed runtime exposes
    // no merchant-decision command surface (area-20 is RTN wave 2). The
    // decision is refused with the recorded reason; nothing is committed
    // and no simulated acceptance is produced.
    return {
      ok: false,
      error: 'decision-not-allowed',
      detail:
        'The composed protocol runtime exposes no merchant-decision command surface: the area-20 Merchant Authority ' +
        '(checkout-session semantics: CHECKOUT_OPENED/COMPLETED/EXPIRED/CANCELLED) is RTN wave 2 and not merged, and the ' +
        'intent authority\u2019s own transitions do not include a merchant accept/decline command. The decision is refused ' +
        '— no decision was recorded, nothing was committed, and no acceptance or decline wording is fabricated. ' +
        'The recorded deferral: the checkout decision splice lands with the area-20 runtime (RTN wave 2); see the ' +
        'checkout mapping records (COM-xx gap records).',
      reportedBy: REPORTED_BY,
      runtime: 'ARRIVING',
    };
  }

  return {
    runtime: CHECKOUT_BOUNDARY.runtime,
    authorityOwner: CHECKOUT_BOUNDARY.authorityOwner,
    nonAuthoritative: true,
    getOffer,
    getStatus,
    listOpenCheckouts,
    submitDecision,
  };
}
