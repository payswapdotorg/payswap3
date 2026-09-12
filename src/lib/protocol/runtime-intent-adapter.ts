/**
 * ════════════════════════════════════════════════════════════════════════
 *  UI-011 — RUNTIME INTENT ADAPTER (the A01/A15-backed IntentPort)
 * ════════════════════════════════════════════════════════════════════════
 *
 * The runtime adapter behind getIntentPort() once
 * src/lib/protocol/server-runtime.ts registers it (the UI-011 product
 * splice). It implements the FROZEN IntentPort interface exactly — no
 * product surface changes — over the composed protocol runtime:
 *
 *   • COMMANDS: submitIntent admits `intent.submit` EXCLUSIVELY through
 *     ProtocolGateway.submitCommand with a kernel CommandEnvelope (the
 *     documented nested { descriptor, priorIntentId? } body —
 *     COMMAND-SURFACE.md A01). The idempotency key is derived
 *     deterministically from the reviewed submission identity (consequence
 *     report id + draft fingerprint), so a double-submit replays the SAME
 *     intent through the gateway's DUPLICATE receipt — no second intent,
 *     no second effect, no retry storm (INV-1-3 generalized).
 *   • READS: getIntentState / listSessionIntents read the A01 Intent
 *     Authority's own query API (getIntent) and the real A15 evidence
 *     chain (INTENT_CREATED / INTENT_AUTHORIZED / INTENT_STATE_CHANGED
 *     records — the proof trail). NOTHING is fabricated: when the runtime
 *     holds no record the port answers no-answer → UNKNOWN (P5).
 *   • QUOTES: requestConsequenceReport quotes terms ONLY from what the
 *     runtime actually reports — the Capability Authority's real current
 *     snapshot (A03 cost schedules for the corridor). When no capability
 *     is registered for the corridor, NO terms are quoted (no-answer) and
 *     the review stays closed — the runtime has no pre-submit fee surface
 *     and the adapter never invents a fee (N1).
 *   • GATEWAY ADMISSION OUTCOMES: typed rejections (reasonCode + problem +
 *     field, verbatim in the refusal note) and DUPLICATE receipts (surfaced
 *     in the snapshot's evidence trail) are presented as explicit states
 *     through the mapping discipline — nothing is dropped silently.
 *
 * The adapter is handed its runtime (ProtocolRuntimeHandle) — it NEVER
 * constructs the runtime (no second composition root). It is loadable
 * under bun test (the composed barrel is imported for TYPES ONLY; runtime
 * value imports come from the runtime's own leaf modules — the
 * repository's documented bun/Node split).
 */

import {
  COMPOSITION_OPTIONS,
  INTENT_AUTHORITY_REF,
  INTENT_BOUNDARY,
} from './adapter-boundary';
import type {
  AuthorityState,
  CompositionOptions,
  ConsequenceReportResult,
  IntentConsequenceReport,
  IntentConsequenceTerm,
  IntentDraft,
  IntentEvidenceRecord,
  IntentPort,
  IntentQueryResult,
  IntentStateSnapshot,
  IntentSummary,
  SessionIntentListResult,
  SessionIntentRecord,
  StateReport,
  SubmitAuthorization,
  SubmitResult,
} from './intent-port';
import { isRuntimeAuthorityState } from './intent-port';
import type { ProtocolRuntimeHandle } from './runtime-handle';
import type {
  CommandEnvelope,
  EvidenceRecord,
  IntentState,
  Money,
  PaymentIntent,
} from '../protocol-runtime/index.ts';
import { deriveProtocolId } from '../protocol-runtime/kernel/identity.ts';
import { protocolTime } from '../protocol-runtime/kernel/time.ts';
import { addMoney, money } from '../protocol-runtime/kernel/money.ts';
import { demandDescriptor } from '../protocol-runtime/intent/descriptor.ts';
import { INTENT_TRANSITIONS } from '../protocol-runtime/intent/types.ts';

// ── Presentation-only money formatting (authority-quoted figures) ────────

function formatKernelMoney(value: Money): string {
  const sign = value.amountMinor < 0 ? '-' : '';
  const absolute = Math.abs(Math.trunc(value.amountMinor));
  const whole = Math.floor(absolute / 10 ** value.scale);
  const fraction = String(absolute % 10 ** value.scale).padStart(value.scale, '0');
  return `${sign}${whole}.${fraction}`;
}

function parseAmountCents(amount: string): number | null {
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(amount)) return null;
  const [whole, fraction = ''] = amount.split('.');
  const cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  return cents > 0 ? cents : null;
}

// ── Draft validation and fingerprinting (adapter-boundary, as the mock) ──

function fingerprintDraft(draft: IntentDraft): string {
  const parts = [
    draft.outcomeKind,
    draft.outcomeStatement,
    draft.amount,
    draft.currency,
    draft.recipient.id,
    draft.source.id,
    draft.customerReference ?? '',
  ];
  return parts.map((part) => encodeURIComponent(part)).join('|');
}

function validateDraft(draft: IntentDraft): SubmitResult | null {
  if (
    draft.outcomeKind !== 'send-payment' ||
    draft.currency !== 'USD' ||
    !draft.outcomeStatement ||
    !draft.recipient.id ||
    !draft.source.id ||
    parseAmountCents(draft.amount) == null
  ) {
    return {
      kind: 'refused',
      reason: 'malformed-draft',
      note: 'The submit was refused at the adapter boundary: the draft is not complete and well-formed.',
    };
  }
  return null;
}

// ── Sandbox endpoint directory (presentation mapping for the descriptor) ─
//
// The composition directory's parties map onto the DemandDescriptor's
// endpoint fields; the mapping is adapter-side presentation configuration
// (account = the party id, sandbox geography US) — the protocol object the
// runtime records is the real minted DemandDescriptor either way.

const SANDBOX_GEOGRAPHY = 'US';

function endpointFor(partyId: string, currency: string): {
  currency: string;
  geography: string;
  account: string;
} {
  return { currency, geography: SANDBOX_GEOGRAPHY, account: partyId };
}

function partyDisplayName(partyId: string): string {
  const recipient = COMPOSITION_OPTIONS.recipients.find((party) => party.id === partyId);
  if (recipient) return recipient.displayName;
  const source = COMPOSITION_OPTIONS.sources.find((party) => party.id === partyId);
  if (source) return source.displayName;
  return partyId;
}

// ── Quote policy (stated honestly; figures are the runtime's own) ────────

const QUOTE_DEADLINE_HOURS = 24;

interface IssuedReport {
  report: IntentConsequenceReport;
  fingerprint: string;
  /** The real A03 snapshot entries the quote was derived from. */
  quotedCapabilityIds: readonly string[];
  allowedRails: readonly string[];
  costCeiling: Money;
  deadlineEpochMs: number;
}

// ── A15 record helpers (the real proof trail) ─────────────────────────────

function evidenceTimeIso(record: EvidenceRecord): string {
  return new Date(record.when.wallMs).toISOString();
}

function intentRecordsFor(handle: ProtocolRuntimeHandle, intentId: string): EvidenceRecord[] {
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

// ── State report wording (the adapter speaks ONLY what the runtime says) ──

function stateReportFor(intent: PaymentIntent, at: string, reasonCode: string | undefined): StateReport {
  const id = intent.intentId;
  switch (intent.state) {
    case 'DRAFT':
      return {
        kind: 'held-for-recipient',
        whatIsWaiting: `The payment intent ${id}, held by the Intent Authority in DRAFT (on record, terms fixed).`,
        why:
          'Awaiting the authority\u2019s authorization decision: the compliance-gated DRAFT \u2192 AUTHORIZED transition ' +
          '(INV-16-3) executes on the runtime\u2019s single-writer path — the runtime has not reported it yet.',
        whatHappensNext:
          'The authority reports the authorization decision; the state shown here changes only when that report arrives. ' +
          'Per the frozen one-way transition table, DRAFT\u2019s only successor is AUTHORIZED — no cancel is authorized in this state.',
        cancelAuthorized: false,
      };
    case 'AUTHORIZED':
      return {
        kind: 'processing',
        activity: `The Intent Authority reports intent ${id} AUTHORIZED and proceeding toward routing.`,
        asReported:
          'The authority reported authorization (policy decision recorded). No estimate is shown because the authority provided none — the UI does not invent progress claims.',
      };
    case 'ROUTED':
      return {
        kind: 'processing',
        activity: `The Intent Authority reports intent ${id} ROUTED: a route plan was validated and dispatched.`,
        asReported:
          'The authority reported the routing outcome. This is a present activity report, not a verdict — it resolves explicitly when the authority\u2019s next report arrives.',
      };
    case 'FULFILLING':
      return {
        kind: 'processing',
        activity: `The Intent Authority reports intent ${id} FULFILLING: fulfillment is underway as reported.`,
        asReported:
          'The authority reported fulfillment started. No estimate is shown because the authority provided none.',
      };
    case 'FULFILLED':
      return {
        kind: 'acknowledged',
        acknowledgementNote:
          `The Intent Authority reports intent ${id} FULFILLED: the fulfillment it authorized has completed, as reported. ` +
          'The authority has NOT reported settlement finality here (finality is the Settlement and Finality Authority\u2019s report), so none is shown.',
        recordedAt: at,
      };
    case 'FAILED':
    case 'CANCELLED': {
      const terminal = intent.state === 'FAILED' ? 'FAILED' : 'CANCELLED';
      const message =
        terminal === 'FAILED'
          ? `Rejected terminally by the Intent Authority: intent ${id} moved to FAILED${reasonCode ? ` with reason code ${reasonCode}` : ''}, as recorded in the A15 chain.`
          : `The Intent Authority reports intent ${id} CANCELLED${reasonCode ? ` (reason code ${reasonCode})` : ''}: the intent did not proceed — no money moved.`;
      return {
        kind: 'rejected',
        reason: {
          code: reasonCode ? `A01.${terminal}:${reasonCode}` : `A01.${terminal}`,
          message,
        },
        recoveryHint:
          terminal === 'FAILED'
            ? 'As the architecture reports: a retry is a NEW intent explicitly submitted and linked to the prior intent id — never a silent resubmission of this one.'
            : 'The cancelled intent is terminal (one-way transitions); any new payment is a new, separately reviewed submission.',
      };
    }
  }
}

// ── Evidence trail (the real A15 records, presented verbatim) ─────────────

function evidenceFor(
  intent: PaymentIntent,
  records: readonly EvidenceRecord[],
  issued: IssuedReport | undefined,
  receiptOutcome: 'ADMITTED' | 'DUPLICATE' | undefined,
): IntentEvidenceRecord[] {
  const out: IntentEvidenceRecord[] = [];
  if (issued) {
    out.push({
      id: `ev_${intent.intentId}_terms`,
      at: issued.report.quotedAt,
      authority: 'Capability Authority (A03 snapshot — the runtime\u2019s own cost schedules)',
      kind: 'consequence-terms',
      summary: 'Consequence terms quoted before the explicit submit (from the composed runtime\u2019s real capability snapshot).',
      details: [
        { label: 'Consequence report', value: issued.report.reportId },
        { label: 'Amount', value: `${issued.report.amount} ${issued.report.currency}` },
        { label: 'Fee as quoted', value: `${issued.report.feeQuoted} ${issued.report.currency}` },
        { label: 'Total if the intent proceeds', value: `${issued.report.totalQuoted} ${issued.report.currency}` },
        { label: 'Quoted capability (A03)', value: issued.quotedCapabilityIds.join(', ') || '—' },
      ],
    });
  }
  if (receiptOutcome !== undefined) {
    out.push({
      id: `ev_${intent.intentId}_receipt`,
      at: new Date().toISOString(),
      authority: 'protocol-gateway (the sole admission point)',
      kind: 'submission-received',
      summary: `Gateway admission receipt: ${receiptOutcome} (the command was admitted onto the durable command path).`,
      details: [
        { label: 'Receipt outcome', value: receiptOutcome },
        {
          label: 'Meaning',
          value:
            receiptOutcome === 'DUPLICATE'
              ? 'This submission replayed a recorded idempotency key — the recorded receipt was returned verbatim; no second effect (INV-1-3).'
              : 'First admission for the idempotency key: one durable job, one effect on execution.',
        },
        { label: 'Authorization basis', value: 'Explicit user submit referencing the reviewed consequence report' },
      ],
    });
  }
  for (const record of records) {
    const operation = record.what.operationType;
    const outcome = record.outcome.result;
    const reason = record.outcome.reasonCode;
    out.push({
      id: `ev_${record.proof.recordId}`,
      at: evidenceTimeIso(record),
      authority: record.authority,
      kind: 'authority-state-report',
      summary:
        operation === 'INTENT_CREATED'
          ? `INTENT_CREATED (A15 record ${record.proof.sequenceNumber}): the intent was created in DRAFT with the submitted terms (descriptor hash recorded).`
          : operation === 'INTENT_AUTHORIZED'
            ? `INTENT_AUTHORIZED (A15 record ${record.proof.sequenceNumber}): the intent was authorized (policy decision linked).`
            : `INTENT_STATE_CHANGED (A15 record ${record.proof.sequenceNumber}): the intent moved to ${outcome}${reason ? ` with reason code ${reason}` : ''}.`,
      details: [
        { label: 'Operation type', value: operation },
        { label: 'Outcome', value: outcome },
        { label: 'Reason code', value: reason ?? 'None recorded' },
        { label: 'Owning authority', value: record.authority },
        { label: 'Record hash', value: record.proof.recordHash },
      ],
    });
  }
  return out;
}

// ── Snapshot assembly (reads the runtime; never fabricates) ───────────────

function buildSnapshot(
  intent: PaymentIntent,
  records: readonly EvidenceRecord[],
  issued: IssuedReport | undefined,
  receiptOutcome: 'ADMITTED' | 'DUPLICATE' | undefined,
  reportedAt: string,
  reasonCode: string | undefined,
): IntentStateSnapshot {
  const summary: IntentSummary = {
    intentId: intent.intentId,
    amount: formatKernelMoney(intent.descriptor.amount),
    // The frozen port vocabulary is USD-only (the product composition directory); the value is the runtime's own recorded currency.
    currency: intent.descriptor.amount.currency as 'USD',
    recipientName: partyDisplayName(intent.descriptor.destination.account),
    sourceName: partyDisplayName(intent.descriptor.source.account),
    customerReference: undefined,
    composedAt: new Date(intent.createdAt.wallMs).toISOString(),
  };
  return {
    intentId: intent.intentId,
    authority: INTENT_AUTHORITY_REF,
    authorityState: intent.state,
    reportedAt,
    intent: summary,
    stateReport: stateReportFor(intent, reportedAt, reasonCode),
    evidence: evidenceFor(intent, records, issued, receiptOutcome),
  };
}

// ── The adapter ───────────────────────────────────────────────────────────

export function createRuntimeIntentAdapter(handle: ProtocolRuntimeHandle): IntentPort {
  // The reason-code read for terminal states comes from the REAL A15 chain
  // (the last INTENT_STATE_CHANGED record for the intent that carries one).
  const latestReasonCode = (intentId: string): string | undefined => {
    const changed = handle.evidenceLog
      .records()
      .filter(
        (record) =>
          record.what.operationType === 'INTENT_STATE_CHANGED' &&
          record.what.subjectIds.includes(intentId) &&
          record.outcome.reasonCode !== undefined,
      );
    return changed.length > 0 ? changed[changed.length - 1].outcome.reasonCode : undefined;
  };

  const issuedReports = new Map<string, IssuedReport>();
  let sequence = 0;
  let protocolSequence = 0;

  function nextId(prefix: string): string {
    sequence += 1;
    return `${prefix}_rt_${sequence.toString().padStart(3, '0')}`;
  }

  function nowIso(): string {
    return new Date().toISOString();
  }

  /** Wait (bounded) for the durable path to execute an admitted command. */
  async function awaitIntentExecution(intentId: string): Promise<PaymentIntent | undefined> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await handle.drain();
      const intent = handle.authorities.intent.getIntent(intentId);
      if (intent !== undefined) return intent;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return undefined;
  }

  async function requestConsequenceReport(draft: IntentDraft): Promise<ConsequenceReportResult> {
    const malformed = validateDraft(draft);
    if (malformed) {
      return {
        kind: 'no-answer',
        note: 'The draft is not complete and well-formed, so the runtime adapter issued no consequence report.',
      };
    }
    // The REAL A03 capability snapshot — the runtime's own current quote basis.
    const snapshot = handle.authorities.capability.snapshot();
    const matching = snapshot.capabilities.filter(
      (entry) =>
        entry.state === 'ACTIVE' &&
        entry.corridor.sourceCurrency === draft.currency &&
        entry.corridor.destinationCurrency === draft.currency &&
        entry.corridor.sourceGeography === SANDBOX_GEOGRAPHY &&
        entry.corridor.destinationGeography === SANDBOX_GEOGRAPHY &&
        entry.availableCapacity.amountMinor > 0,
    );
    if (matching.length === 0) {
      return {
        kind: 'no-answer',
        note:
          'The composed runtime\u2019s Capability Authority reports no active capability for this corridor, so no consequence ' +
          'terms can be quoted: the runtime exposes no pre-submit fee surface, and no fee is invented. Without a consequence ' +
          'report there is no review, and without review there is no submit — the flow stops here honestly. ' +
          'Re-check after a capability is registered for the corridor (a real protocol command through the gateway).',
      };
    }
    // Quote policy, stated honestly: the LOWEST cost schedule the A03
    // snapshot currently reports for the corridor (the figures are the
    // runtime's own; the choice among them is the adapter's quote policy).
    const quoted = matching.reduce((lowest, entry) =>
      entry.costSchedule.amountMinor < lowest.costSchedule.amountMinor ? entry : lowest,
    );
    const cents = parseAmountCents(draft.amount) as number;
    const amountMoney = money(draft.currency, cents, 2);
    const total = addMoney(amountMoney, quoted.costSchedule);
    const allowedRails = [...new Set(matching.map((entry) => entry.railId))].sort();
    const deadlineEpochMs = Date.now() + QUOTE_DEADLINE_HOURS * 3_600_000;
    const reportId = nextId('qrpt');
    const fingerprint = fingerprintDraft(draft);
    const fee = formatKernelMoney(quoted.costSchedule);
    const totalQuoted = formatKernelMoney(total);
    const terms: IntentConsequenceTerm[] = [
      {
        id: 'term.intent',
        label: 'What you are stating',
        statement: `You are stating an intent to send ${draft.amount} ${draft.currency} to ${draft.recipient.displayName}, funded from ${draft.source.displayName}. The Intent Authority will record it in DRAFT with these terms fixed.`,
      },
      {
        id: 'term.fee',
        label: 'Fee, as quoted',
        statement: `The Capability Authority\u2019s current snapshot quotes a cost schedule of ${fee} ${draft.currency} for this corridor (capability ${quoted.capabilityId}). If the intent proceeds, the total is ${totalQuoted} ${draft.currency}. The fee is quoted from the runtime\u2019s own snapshot — the product did not compute it.`,
      },
      {
        id: 'term.execution',
        label: 'How this proceeds',
        statement:
          'The intent proceeds only when the Intent Authority authorizes it: the compliance-gated DRAFT \u2192 AUTHORIZED transition (INV-16-3) executes on the runtime\u2019s single-writer path. This surface shows only what the authority reports. It does not predict acceptance and never states settlement, finality, or completion beyond the authority\u2019s own report.',
      },
      {
        id: 'term.deadline',
        label: 'Deadline the intent states',
        statement: `The submitted intent carries a ${QUOTE_DEADLINE_HOURS}-hour demand deadline (${new Date(deadlineEpochMs).toISOString()}), and the cost ceiling the review quotes (${totalQuoted} ${draft.currency}). These are the demand constraints the authority records.`,
      },
      {
        id: 'term.failure',
        label: 'If it does not proceed',
        statement:
          'If the authority moves the intent to FAILED or CANCELLED, it records a machine-readable reason code; the intent\u2019s state page shows the terminal state with that reason. A failed or cancelled intent does not move money, and a retry is a NEW explicitly submitted intent — never a silent resubmission.',
      },
      {
        id: 'term.unknown',
        label: 'If there is no answer yet',
        statement:
          'If no authoritative answer is reachable (a command admitted but not yet executed, or a query the runtime cannot yet answer), the state page shows UNKNOWN with a reconciliation path — never a guess, never a spinner standing in as a verdict, and never UNKNOWN styled as success or failure. Settlement-side UNKNOWN resolves only through the Reconciliation Authority\u2019s case cycle (GC-2).',
      },
      {
        id: 'term.evidence',
        label: 'Records and evidence',
        statement:
          'The intent\u2019s consequential steps are recorded in the real A15 evidence chain (INTENT_CREATED, INTENT_AUTHORIZED, INTENT_STATE_CHANGED with reason codes). The evidence trail is reachable from the intent\u2019s state page whenever the intent state is shown.',
      },
      {
        id: 'term.single',
        label: 'One intent per submit',
        statement:
          'This submit creates exactly one payment intent. Resubmitting the SAME reviewed consequence report replays the SAME intent idempotently (the gateway\u2019s DUPLICATE receipt — no second effect); no further intent is created, batched, or repeated without another explicit, reviewed submit.',
      },
    ];
    const report: IntentConsequenceReport = {
      reportId,
      quotedAt: nowIso(),
      amount: draft.amount,
      currency: draft.currency,
      feeQuoted: fee,
      totalQuoted,
      terms,
      draftFingerprint: fingerprint,
      boundaryNote:
        'Quoted by the runtime adapter over the composed protocol runtime: the fee is the Capability Authority\u2019s own current ' +
        'cost schedule for the corridor; acceptance, rejection, and every state are the Intent Authority\u2019s reports over the real A15 chain. ' +
        'Nothing here is a production financial execution claim.',
    };
    issuedReports.set(reportId, {
      report,
      fingerprint,
      quotedCapabilityIds: [quoted.capabilityId],
      allowedRails,
      costCeiling: total,
      deadlineEpochMs,
    });
    return { kind: 'report', report };
  }

  async function submitIntent(
    draft: IntentDraft,
    authorization: SubmitAuthorization,
  ): Promise<SubmitResult> {
    const malformed = validateDraft(draft);
    if (malformed) return malformed;

    // The authorization-shape gate (N3): explicit submit, reviewed
    // consequences, unchanged draft — the port refuses everything else.
    if (authorization.explicitUserSubmit !== true) {
      return {
        kind: 'refused',
        reason: 'missing-explicit-authorization',
        note: 'Refused at the adapter boundary: the submit lacked explicit user authorization.',
      };
    }
    const issued = issuedReports.get(authorization.consequenceReportId);
    if (!issued) {
      return {
        kind: 'refused',
        reason: 'missing-consequence-review',
        note: 'Refused at the adapter boundary: no reviewed consequence report backs this submit. Consequences must be reviewed before any commit (P2/P3).',
      };
    }
    if (issued.fingerprint !== authorization.draftFingerprint || issued.fingerprint !== fingerprintDraft(draft)) {
      return {
        kind: 'refused',
        reason: 'draft-changed-since-review',
        note: 'Refused at the adapter boundary: the draft changed since the consequence report was reviewed. Review the updated consequences, then submit.',
      };
    }

    // Deterministic submission identity: the SAME reviewed report + draft
    // replays the SAME intent through the gateway's dedupe (DUPLICATE
    // receipt, no second effect); a NEW review is a NEW intent.
    const idempotencyKey = `intent-submit.${issued.report.reportId}.${issued.fingerprint}`;
    const cents = parseAmountCents(draft.amount) as number;
    const descriptor = demandDescriptor({
      amount: money(draft.currency, cents, 2),
      source: endpointFor(draft.source.id, draft.currency),
      destination: endpointFor(draft.recipient.id, draft.currency),
      constraints: {
        deadlineEpochMs: issued.deadlineEpochMs,
        allowedRails: issued.allowedRails,
        costCeiling: issued.costCeiling,
      },
      idempotencyKey,
    });
    protocolSequence += 1;
    const envelope: CommandEnvelope = {
      kind: 'intent.submit',
      authority: 'Intent Authority',
      subjectIds: [],
      idempotencyKey,
      protocolTime: protocolTime(protocolSequence, Date.now()),
      body: { descriptor },
    };

    // THE sole admission point (COMMAND-SURFACE.md).
    const admission = await handle.gateway.submitCommand(envelope);

    if (!admission.ok) {
      // Typed gateway rejection — surfaced verbatim through the frozen
      // refusal vocabulary; nothing dropped silently.
      return {
        kind: 'refused',
        reason: 'malformed-draft',
        note:
          `The submit was refused at admission: the protocol gateway rejected the command with reason code ` +
          `${admission.reasonCode}${admission.field ? ` (field ${admission.field})` : ''} — ${admission.problem} ` +
          'No intent was created and nothing was committed.',
      };
    }

    const intentId = deriveProtocolId('intent', idempotencyKey);
    const intent = await awaitIntentExecution(intentId);

    if (intent === undefined) {
      // Admitted but not yet executed: the receipt proves the submission
      // reached the authority side; the execution is pending on the durable
      // path. Presented as UNKNOWN (never failure, never silent retry).
      return {
        kind: 'not-transported',
        submissionRef: admission.receipt.commandId,
        note:
          `The protocol gateway ADMITTED this submission (receipt ${admission.receipt.commandId}, outcome ` +
          `${admission.receipt.outcome}) onto the durable command path; whether the Intent Authority has executed it yet is ` +
          'not yet known — presented as UNKNOWN with a reconciliation path, never as failure or success. Re-check the state ' +
          'page: the durable path executes admitted jobs exactly once, and re-submitting the same reviewed report is ' +
          'idempotent (the same intent — no retry storm).',
      };
    }

    // The receipt is returned VERBATIM on replay (outcome stays 'ADMITTED'
    // in-process; 'DUPLICATE' is recorded on cross-restart dedupe). The
    // honest surfaced label keys off the replay flag: a replayed key is a
    // DUPLICATE submission — no second effect (INV-1-3).
    const receiptOutcome: 'ADMITTED' | 'DUPLICATE' = admission.replayed
      ? 'DUPLICATE'
      : admission.receipt.outcome;
    const records = intentRecordsFor(handle, intentId);
    const snapshot = buildSnapshot(intent, records, issued, receiptOutcome, nowIso(), latestReasonCode(intentId));
    if (receiptOutcome === 'DUPLICATE') {
      // The DUPLICATE receipt is already surfaced in the snapshot's
      // evidence trail; the user lands on the EXISTING intent.
      return { kind: 'transported', intentId, snapshot };
    }
    return { kind: 'transported', intentId, snapshot };
  }

  async function getIntentState(intentId: string): Promise<IntentQueryResult> {
    const intent = handle.authorities.intent.getIntent(intentId);
    if (intent === undefined) {
      return {
        kind: 'no-answer',
        reason: 'no-record',
        note:
          'No intent record for this reference is reachable in the composed runtime\u2019s current state: the Intent Authority ' +
          'may not have executed an admitted command yet, or this reference was never submitted to it. This is UNKNOWN — never ' +
          '\u201cnot found\u201d failure. The reconciliation path: re-check re-queries the authority and reports whatever returns, ' +
          'including another UNKNOWN.',
      };
    }
    const records = intentRecordsFor(handle, intentId);
    const snapshot = buildSnapshot(intent, records, undefined, undefined, nowIso(), latestReasonCode(intentId));
    return { kind: 'snapshot', snapshot };
  }

  async function listSessionIntents(): Promise<SessionIntentListResult> {
    // The intent directory is derived from the REAL A15 chain: every
    // INTENT_CREATED record names an intent the authority actually created
    // (subjectIds = [intentId, idempotencyKey]).
    const created = handle.evidenceLog
      .records()
      .filter((record) => record.what.operationType === 'INTENT_CREATED');
    const ids: string[] = [];
    for (const record of created) {
      // INTENT_CREATED subjectIds = [intentId, idempotencyKey] (the first is the intent id).
      const intentId = record.what.subjectIds[0];
      if (intentId !== undefined && handle.authorities.intent.getIntent(intentId) !== undefined) {
        ids.push(intentId);
      }
    }
    if (ids.length === 0) {
      return {
        kind: 'no-answer',
        note:
          'The composed runtime\u2019s A15 chain records no intents yet. Per the port\u2019s P5 discipline, availability is ' +
          'presented as UNKNOWN — not as an authoritative empty list standing in for a verdict.',
      };
    }
    const records: SessionIntentRecord[] = ids.map((intentId) => {
      const intent = handle.authorities.intent.getIntent(intentId) as PaymentIntent;
      return {
        intentId,
        authorityState: intent.state,
        reportedAt: new Date(intent.stateChangedAt.wallMs).toISOString(),
        amount: formatKernelMoney(intent.descriptor.amount),
        currency: intent.descriptor.amount.currency as 'USD',
        recipientName: partyDisplayName(intent.descriptor.destination.account),
      };
    });
    records.sort((a, b) => (a.reportedAt < b.reportedAt ? 1 : -1));
    return { kind: 'records', records };
  }

  async function getPresentationFixture(state: AuthorityState): Promise<IntentQueryResult> {
    if (!isRuntimeAuthorityState(state)) {
      return {
        kind: 'no-answer',
        reason: 'no-record',
        note:
          'The state matrix serves the composed runtime\u2019s own A01 vocabulary; this legacy fixture member is not a state ' +
          'the runtime adapter reports.',
      };
    }
    // A demonstration snapshot for one REAL runtime state: the state's
    // resolution, its frozen transition semantics, and its evidence shape
    // come from the runtime's own exports; the intent brief is clearly
    // labeled demonstration data (verification fixture — the port's own
    // contract for this method).
    const demoIntent: PaymentIntent = {
      intentId: `pi_fixture_${state}`,
      idempotencyKey: `fixture-${state}`,
      state,
      descriptor: {
        amount: money('USD', 2_500, 2),
        source: endpointFor('src_sb_main', 'USD'),
        destination: endpointFor('mrc_copperline', 'USD'),
        constraints: {
          deadlineEpochMs: 99_999_999_999,
          allowedRails: ['sim-bank'],
          costCeiling: money('USD', 2_600, 2),
        },
        idempotencyKey: `fixture-${state}`,
      },
      descriptorHash: 'demonstration',
      createdAt: protocolTime(1, Date.now()),
      stateChangedAt: protocolTime(1, Date.now()),
    };
    const at = nowIso();
    const snapshot = buildSnapshot(demoIntent, [], undefined, undefined, at, undefined);
    const successors = INTENT_TRANSITIONS[state];
    return {
      kind: 'snapshot',
      snapshot: {
        ...snapshot,
        intent: {
          ...snapshot.intent,
          customerReference: 'Demonstration fixture (runtime state-machine presentation)',
        },
        evidence: [
          {
            id: `ev_fixture_${state}_machine`,
            at,
            authority: 'Intent Authority (runtime state machine — demonstration)',
            kind: 'authority-state-report',
            summary: `A01 demonstration for state ${state}: legal successors per the frozen one-way transition table are [${successors.join(', ') || 'none (terminal)'}].`,
            details: [
              { label: 'Authority-reported state', value: state },
              { label: 'Legal successors (frozen table)', value: successors.join(', ') || 'none — terminal' },
              { label: 'Fixture notice', value: 'Demonstration snapshot built on the runtime\u2019s own state machine; the intent brief is fixture data.' },
            ],
          },
          ...snapshot.evidence,
        ],
      },
    };
  }

  return {
    boundary: () => INTENT_BOUNDARY,
    getCompositionOptions: (): CompositionOptions => COMPOSITION_OPTIONS,
    requestConsequenceReport,
    submitIntent,
    getIntentState,
    listSessionIntents,
    getPresentationFixture,
  };
}
