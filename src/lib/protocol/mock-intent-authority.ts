/**
 * ════════════════════════════════════════════════════════════════════════
 *  MOCK INTENT AUTHORITY — NON-AUTHORITATIVE, PRESENTATION-ONLY (UI-002)
 * ════════════════════════════════════════════════════════════════════════
 *
 * This module implements the intent port for the pre-runtime period. It
 * is a TRANSPORT AND FIXTURE SIMULATOR, nothing more:
 *
 *   • It is NOT a financial authority (N1). Fee “quotes”, acceptance,
 *     rejections, and every state it reports are fixtures, not decisions.
 *   • It is NOT protocol authorization (N3). It simulates the shape of
 *     the authorization gate (explicit submit + reviewed consequences) so
 *     the product layer cannot accidentally ship an unauthorized path;
 *     when the runtime arrives, real authorization replaces it.
 *   • It holds NO durable financial state (N5): records live in this
 *     browser session's memory only and vanish on reload — which the
 *     surfaces present honestly as UNKNOWN, never as loss or success.
 *
 * The Intent Authority's real state vocabulary ARRIVES with the protocol
 * runtime program; the fixture vocabulary below exists only to exercise
 * the presentation layer end-to-end. Every fixture state is mapped and
 * documented in spec/product/intent-mapping-records.md.
 *
 * Only `getMockIntentPort()` is consumed (via intent-port.ts).
 * `configureMockAuthority` is for verification harnesses exclusively.
 */

import type {
  AuthorityState,
  BoundaryReport,
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
  StateReport,
  SubmitAuthorization,
  SubmitResult,
} from './intent-port';

// ── Harness script (verification surfaces only) ──────────────────────────

export interface MockAuthorityScript {
  /** Fixture state the authority records for the next transported submit. */
  nextSubmitState: AuthorityState;
  /** When false, the authority is unreachable: submits are not transported
   *  and queries return no-answer (rendered as UNKNOWN, per P5). */
  authorityReachable: boolean;
}

const DEFAULT_SCRIPT: MockAuthorityScript = {
  nextSubmitState: 'acknowledged',
  authorityReachable: true,
};

let script: MockAuthorityScript = { ...DEFAULT_SCRIPT };

/** VERIFICATION HARNESS ONLY: script the mock authority's behavior. */
export function configureMockAuthority(next: Partial<MockAuthorityScript>): MockAuthorityScript {
  script = { ...script, ...next };
  return script;
}

/** VERIFICATION HARNESS ONLY: read the current script. */
export function readMockAuthorityScript(): MockAuthorityScript {
  return { ...script };
}

// ── Fixture directory ────────────────────────────────────────────────────

const COMPOSITION_OPTIONS: CompositionOptions = {
  outcomeStatements: [
    'I want to send money to a merchant.',
    'I want to send money to a merchant on a schedule. (arrives with a later work item)',
  ],
  recipients: [
    { id: 'mrc_copperline', displayName: 'Copperline Coffee' },
    { id: 'mrc_harborbooks', displayName: 'Harbor Bookstore' },
    { id: 'mrc_fieldandgrain', displayName: 'Field & Grain Market' },
  ],
  sources: [
    { id: 'src_sb_main', displayName: 'Sandbox balance · Main' },
    { id: 'src_sb_reserve', displayName: 'Sandbox balance · Reserve' },
  ],
  currency: 'USD',
};

const BOUNDARY_NOTE =
  'Quoted by the mock Intent Authority — NON-AUTHORITATIVE, presentation-only. ' +
  'The protocol runtime is ARRIVING; until it lands, nothing here is a financial quote.';

const AUTHORITY_REF = {
  owner: 'Intent Authority',
  architectureRef: 'spec/architecture/v0.1',
  runtimeStatus: 'ARRIVING',
  implementation: 'mock (non-authoritative, presentation-only)',
} as const;

const BOUNDARY: BoundaryReport = {
  adapter: 'intent-port',
  authorityOwner: 'Intent Authority (spec/architecture/v0.1)',
  runtimeStatus: 'ARRIVING',
  implementation: 'mock',
  authoritative: false,
  note:
    'This adapter boundary is presentation-only. Every intent state the UI shows originates ' +
    'here; the product layer computes nothing. The Intent Authority (spec/architecture/v0.1) ' +
    'owns intent semantics; its runtime ARRIVES with the protocol runtime program.',
};

// ── Module state (this browser session, in memory only) ──────────────────

interface IssuedReport {
  report: IntentConsequenceReport;
  fingerprint: string;
}

const intents = new Map<string, IntentStateSnapshot>();
const issuedReports = new Map<string, IssuedReport>();
let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}_sb_${sequence.toString().padStart(3, '0')}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso(): string {
  return new Date().toISOString();
}

// ── Draft validation and fingerprinting (mock-side only) ─────────────────

const AMOUNT_PATTERN = /^\d{1,9}(\.\d{1,2})?$/;

function parseAmountCents(amount: string): number | null {
  if (!AMOUNT_PATTERN.test(amount)) return null;
  const [whole, fraction = ''] = amount.split('.');
  const cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  return cents > 0 ? cents : null;
}

function formatCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${(cents % 100).toString().padStart(2, '0')}`;
}

function fingerprintDraft(draft: IntentDraft): string {
  // Deterministic serialization of the consequential fields.
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
      note: 'The authority side refused the submit: the draft is not complete and well-formed.',
    };
  }
  return null;
}

// ── Consequence terms (quoted by the mock, presented verbatim) ───────────

function buildConsequenceTerms(draft: IntentDraft, fee: string, total: string): IntentConsequenceTerm[] {
  return [
    {
      id: 'term.intent',
      label: 'What you are stating',
      statement: `You are stating an intent to send ${draft.amount} ${draft.currency} to ${draft.recipient.displayName}, funded from ${draft.source.displayName}.`,
    },
    {
      id: 'term.fee',
      label: 'Fee, as quoted',
      statement: `The authority quotes a fee of ${fee} ${draft.currency} for this intent. If the intent proceeds, the total is ${total} ${draft.currency}. The fee is a quote from the (mock) authority — the product did not compute it.`,
    },
    {
      id: 'term.execution',
      label: 'How this proceeds',
      statement:
        'The intent proceeds only if and when the Intent Authority and the recipient accept it. This surface shows only what they report. It does not predict acceptance and never states settlement, finality, or completion beyond the authority’s own report.',
    },
    {
      id: 'term.failure',
      label: 'If it does not proceed',
      statement:
        'If the authority rejects the intent, it reports a reason; the intent’s state page shows FAILED with that reason and any recovery the authority authorizes. A rejected intent does not move money.',
    },
    {
      id: 'term.unknown',
      label: 'If there is no answer yet',
      statement:
        'If no authoritative answer is reachable, the state page shows UNKNOWN with a reconciliation path — never a guess, never a spinner standing in as a verdict, and never UNKNOWN styled as success or failure.',
    },
    {
      id: 'term.evidence',
      label: 'Records and evidence',
      statement:
        'The authority retains a record of this intent with a unique reference. The evidence trail — records, times, decisions — is reachable from the intent’s state page whenever the intent state is shown.',
    },
    {
      id: 'term.single',
      label: 'One intent per submit',
      statement:
        'This submit creates exactly one payment intent. No further intent is created, batched, or repeated without another explicit, reviewed submit.',
    },
  ];
}

// ── State reports (fixture content, wording per the mapping records) ──────

function stateReportFor(state: AuthorityState, intent: IntentSummary, at: string): StateReport {
  switch (state) {
    case 'acknowledged':
      return {
        kind: 'acknowledged',
        acknowledgementNote:
          `The Intent Authority has acknowledged the payment intent ${intent.intentId} and holds it on record. ` +
          'Acknowledgement means receipt and acceptance for processing — the authority has not reported settlement, finality, or completion, so none is shown.',
        recordedAt: at,
      };
    case 'rejected':
      return {
        kind: 'rejected',
        reason: {
          code: 'AUTHORITY.RECIPIENT_LIMIT',
          message:
            'Rejected by the Intent Authority: the recipient’s limit for this amount is exceeded, as reported by the authority.',
        },
        recoveryHint:
          'As reported by the authority: the recipient can accept this amount once their limit clears. Any retry is a new, explicitly submitted intent — this surface never silently re-submits.',
      };
    case 'unresolved':
      return {
        kind: 'unresolved',
        whatIsNotKnown:
          `Whether the Intent Authority has reached an acceptance decision for intent ${intent.intentId}.`,
        reconciliation: {
          whoResolves: 'The Intent Authority (spec/architecture/v0.1) resolves this; the runtime is ARRIVING.',
          recheckAvailable: true,
          note:
            'A re-check re-queries the authority and reports whatever comes back — including another UNKNOWN. UNKNOWN is never styled, worded, or counted as success or failure.',
        },
      };
    case 'held-for-recipient':
      return {
        kind: 'held-for-recipient',
        whatIsWaiting: `The payment intent ${intent.intentId}, held by the Intent Authority.`,
        why: 'Waiting for the recipient to respond, as reported by the authority.',
        whatHappensNext:
          'The authority will report the recipient’s response; the state shown here changes only when that report arrives.',
        cancelAuthorized: true,
      };
    case 'processing':
      return {
        kind: 'processing',
        activity: `The Intent Authority is processing intent ${intent.intentId}, as reported by the authority.`,
        asReported:
          'The authority reported processing is underway. No estimate is shown because the authority provided none — the UI does not invent progress claims.',
      };
    case 'action-requested':
      return {
        kind: 'action-requested',
        requestedAction: 'Confirm the updated recipient details with the Intent Authority.',
        rationale:
          'The authority reported the recipient requires confirmation from you before this intent can proceed. The authority owns this request; the surface only presents it.',
      };
  }
}

// ── Evidence ──────────────────────────────────────────────────────────────

function evidenceForSubmission(
  intentId: string,
  report: IntentConsequenceReport | null,
  at: string
): IntentEvidenceRecord[] {
  const records: IntentEvidenceRecord[] = [];
  if (report) {
    records.push({
      id: `ev_${intentId}_terms`,
      at: report.quotedAt,
      authority: 'Intent Authority (mock, non-authoritative)',
      kind: 'consequence-terms',
      summary: 'Consequence terms quoted before the explicit submit.',
      details: [
        { label: 'Consequence report', value: report.reportId },
        { label: 'Amount', value: `${report.amount} ${report.currency}` },
        { label: 'Fee as quoted', value: `${report.feeQuoted} ${report.currency}` },
        { label: 'Total if the intent proceeds', value: `${report.totalQuoted} ${report.currency}` },
      ],
    });
  }
  records.push({
    id: `ev_${intentId}_received`,
    at,
    authority: 'Intent Authority (mock, non-authoritative)',
    kind: 'submission-received',
    summary: 'Explicit single-intent submission received and recorded.',
    details: [
      { label: 'Intent reference', value: intentId },
      { label: 'Received at', value: at },
      { label: 'Authorization basis', value: 'Explicit user submit referencing the reviewed consequence report' },
    ],
  });
  return records;
}

function stateReportEvidence(
  intentId: string,
  state: AuthorityState,
  stateReport: StateReport,
  at: string
): IntentEvidenceRecord[] {
  const records: IntentEvidenceRecord[] = [
    {
      id: `ev_${intentId}_state`,
      at,
      authority: 'Intent Authority (mock, non-authoritative)',
      kind: 'authority-state-report',
      summary: `Authority state report: ${state} (fixture vocabulary; runtime ARRIVING).`,
      details: [
        { label: 'Authority-reported state', value: state },
        { label: 'Reported at', value: at },
        { label: 'Owning authority', value: 'Intent Authority (spec/architecture/v0.1), runtime ARRIVING' },
        { label: 'Mapping record', value: `spec/product/intent-mapping-records.md — see the record for ${state}` },
      ],
    },
  ];
  if (stateReport.kind === 'acknowledged') {
    records.push({
      id: `ev_${intentId}_ack`,
      at: stateReport.recordedAt,
      authority: 'Intent Authority (mock, non-authoritative)',
      kind: 'acknowledgement',
      summary: 'Acknowledgement recorded by the authority.',
      details: [
        { label: 'Acknowledged at', value: stateReport.recordedAt },
        { label: 'Scope of acknowledgement', value: 'Receipt and acceptance for processing — no settlement or finality implied' },
      ],
    });
  }
  if (stateReport.kind === 'rejected') {
    records.push({
      id: `ev_${intentId}_rejection`,
      at,
      authority: 'Intent Authority (mock, non-authoritative)',
      kind: 'authority-state-report',
      summary: `Rejection reason reported: ${stateReport.reason.code}.`,
      details: [
        { label: 'Reason code', value: stateReport.reason.code },
        { label: 'Reason message', value: stateReport.reason.message },
        { label: 'Recovery hint', value: stateReport.recoveryHint ?? 'None reported' },
      ],
    });
  }
  return records;
}

// ── Snapshot assembly ────────────────────────────────────────────────────

function buildSnapshot(
  intentId: string,
  draft: IntentDraft,
  state: AuthorityState,
  composedAt: string,
  reportedAt: string,
  consequenceReport: IntentConsequenceReport | null
): IntentStateSnapshot {
  const intent: IntentSummary = {
    intentId,
    amount: draft.amount,
    currency: draft.currency,
    recipientName: draft.recipient.displayName,
    sourceName: draft.source.displayName,
    customerReference: draft.customerReference,
    composedAt,
  };
  const stateReport = stateReportFor(state, intent, reportedAt);
  const evidence = [
    ...evidenceForSubmission(intentId, consequenceReport, reportedAt),
    ...stateReportEvidence(intentId, state, stateReport, reportedAt),
  ];
  return {
    intentId,
    authority: AUTHORITY_REF,
    authorityState: state,
    reportedAt,
    intent,
    stateReport,
    evidence,
  };
}

// ── The mock port ────────────────────────────────────────────────────────

const mockPort: IntentPort = {
  boundary: () => BOUNDARY,

  getCompositionOptions: () => COMPOSITION_OPTIONS,

  async requestConsequenceReport(draft): Promise<ConsequenceReportResult> {
    await delay(350);
    const malformed = validateDraft(draft);
    if (malformed) {
      return {
        kind: 'no-answer',
        note: 'The draft is not complete and well-formed, so the authority side issued no consequence report.',
      };
    }
    if (!script.authorityReachable) {
      return {
        kind: 'no-answer',
        note:
          'The (mock) Intent Authority could not be reached to quote consequences. Without a consequence report there is no review, and without review there is no submit — the flow stops here honestly.',
      };
    }
    const cents = parseAmountCents(draft.amount) as number;
    // Fixture quote policy — simulated authority-side quote, not a UI computation.
    const feeCents = Math.round(cents * 0.012 + 15);
    const total = formatCents(cents + feeCents);
    const fee = formatCents(feeCents);
    const reportId = nextId('qrpt');
    const fingerprint = fingerprintDraft(draft);
    const report: IntentConsequenceReport = {
      reportId,
      quotedAt: nowIso(),
      amount: draft.amount,
      currency: draft.currency,
      feeQuoted: fee,
      totalQuoted: total,
      terms: buildConsequenceTerms(draft, fee, total),
      draftFingerprint: fingerprint,
      boundaryNote: BOUNDARY_NOTE,
    };
    issuedReports.set(reportId, { report, fingerprint });
    return { kind: 'report', report };
  },

  async submitIntent(draft, authorization: SubmitAuthorization): Promise<SubmitResult> {
    await delay(600);
    const malformed = validateDraft(draft);
    if (malformed) return malformed;

    // Simulated authorization gate (N3 shape): explicit submit, reviewed
    // consequences, unchanged draft. The port refuses everything else.
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

    if (!script.authorityReachable) {
      return {
        kind: 'not-transported',
        submissionRef: nextId('sub'),
        note:
          'The submission was not transported to the (mock) Intent Authority. It is UNKNOWN whether the authority received this intent — presented as UNKNOWN with a reconciliation path, never as failure or success.',
      };
    }

    const intentId = nextId('pi');
    const at = nowIso();
    const snapshot = buildSnapshot(intentId, draft, script.nextSubmitState, at, at, issued.report);
    intents.set(intentId, snapshot);
    return { kind: 'transported', intentId, snapshot };
  },

  async getIntentState(intentId): Promise<IntentQueryResult> {
    await delay(200);
    if (!script.authorityReachable) {
      return {
        kind: 'no-answer',
        reason: 'unreachable',
        note:
          'The (mock) Intent Authority cannot be reached right now. It is UNKNOWN whether the authority holds a record for this reference — the reconciliation path is to re-check.',
      };
    }
    const snapshot = intents.get(intentId);
    if (!snapshot) {
      return {
        kind: 'no-answer',
        reason: 'no-record',
        note:
          'No record for this reference is reachable in this session. The mock authority holds records in this browser session’s memory only, so it is UNKNOWN whether the authority itself holds one — this is presented as UNKNOWN, never as “not found” failure.',
      };
    }
    // Deterministic: re-query returns the same authority report.
    return { kind: 'snapshot', snapshot };
  },

  async listSessionIntents(): Promise<SessionIntentListResult> {
    await delay(150);
    if (!script.authorityReachable) {
      return {
        kind: 'no-answer',
        note: 'The (mock) Intent Authority could not be reached, so it is unknown whether any intent records are available. Rendered as UNKNOWN — not as an empty list.',
      };
    }
    const records = [...intents.values()]
      .sort((a, b) => (a.reportedAt < b.reportedAt ? 1 : -1))
      .map((snapshot) => ({
        intentId: snapshot.intentId,
        authorityState: snapshot.authorityState,
        reportedAt: snapshot.reportedAt,
        amount: snapshot.intent.amount,
        currency: snapshot.intent.currency,
        recipientName: snapshot.intent.recipientName,
      }));
    if (records.length === 0) {
      // P5: “no data yet” is an absence of answer, rendered as UNKNOWN —
      // never as an empty list standing in for an authoritative zero.
      return {
        kind: 'no-answer',
        note:
          'The (mock) Intent Authority holds no intent records in this browser session yet. No broader answer is available, so availability is presented as UNKNOWN — not as an authoritative empty list.',
      };
    }
    return { kind: 'records', records };
  },

  async getPresentationFixture(state): Promise<IntentQueryResult> {
    await delay(120);
    const draft: IntentDraft = {
      outcomeKind: 'send-payment',
      outcomeStatement: 'I want to send money to a merchant.',
      amount: '25.00',
      currency: 'USD',
      recipient: COMPOSITION_OPTIONS.recipients[0],
      source: COMPOSITION_OPTIONS.sources[0],
      customerReference: 'Demonstration fixture',
    };
    const at = nowIso();
    const snapshot = buildSnapshot(`pi_fixture_${state}`, draft, state, at, at, null);
    return { kind: 'snapshot', snapshot };
  },
};

export function getMockIntentPort(): IntentPort {
  return mockPort;
}
