/**
 * ════════════════════════════════════════════════════════════════════════
 *  PROTOCOL INTENT PORT — ADAPTER BOUNDARY (UI-002)
 * ════════════════════════════════════════════════════════════════════════
 *
 * The frozen protocol architecture (spec/architecture/v0.1) OWNS payment
 * intent semantics. This port is the single seam through which intent
 * data enters the UI: every displayed intent state originates from this
 * port, and nothing on the product side computes, decides, or fabricates
 * intent state (N1), acceptance (N1/P4), or settlement wording (N2).
 *
 * CURRENT IMPLEMENTATION: the port is backed by a MOCK that is explicitly
 * NON-AUTHORITATIVE and PRESENTATION-ONLY. The mock simulates the
 * transport and fixture records the real runtime will expose; it is never
 * a financial authority (N1), never protocol authorization (N3), and
 * never durable financial state (N5). The protocol runtime — and with it
 * the Intent Authority's real state vocabulary — is ARRIVING with the
 * protocol runtime program. When it lands, this port is re-anchored to
 * the runtime and the mock is retired; the surfaces do not change shape.
 *
 * Consequential-state mapping: every authority state renderable through
 * this port carries a nine-question mapping record in
 * spec/product/intent-mapping-records.md. Unmapped states do not ship.
 */

// ── Authority fixture vocabulary ─────────────────────────────────────────
//
// These identifiers are the MOCK's fixture vocabulary only. The Intent
// Authority's real state vocabulary ARRIVES with the protocol runtime;
// nothing here defines protocol semantics. Each fixture state maps to
// exactly one display state in intent-state-mapping.ts and carries a
// mapping record in spec/product/intent-mapping-records.md.

export const AUTHORITY_STATES = [
  'acknowledged',
  'rejected',
  'unresolved',
  'held-for-recipient',
  'processing',
  'action-requested',
] as const;

export type AuthorityState = (typeof AUTHORITY_STATES)[number];

export function isAuthorityState(value: unknown): value is AuthorityState {
  return typeof value === 'string' && (AUTHORITY_STATES as readonly string[]).includes(value);
}

// ── Common value shapes ──────────────────────────────────────────────────

export type IntentId = string;
/** Reference for a submission attempt that was not transported. */
export type SubmissionRef = string;

/** Decimal string in minor-unit-free form, e.g. "25.00". USD only for now. */
export type MoneyAmount = string;
export type CurrencyCode = 'USD';

export interface IntentParty {
  readonly id: string;
  readonly displayName: string;
}

/** The owning authority of every intent state this port can report. */
export interface IntentAuthorityRef {
  readonly owner: 'Intent Authority';
  /** Per spec/architecture/v0.1 — the Intent Authority owns intent state. */
  readonly architectureRef: 'spec/architecture/v0.1';
  readonly runtimeStatus: 'ARRIVING';
  readonly implementation: 'mock (non-authoritative, presentation-only)';
}

// ── Composition ──────────────────────────────────────────────────────────

export type IntentOutcomeKind = 'send-payment';

/** What the customer composed — an outcome stated first, then its details. */
export interface IntentDraft {
  readonly outcomeKind: IntentOutcomeKind;
  /** The outcome statement chosen up front, in plain language. */
  readonly outcomeStatement: string;
  readonly amount: MoneyAmount;
  readonly currency: CurrencyCode;
  readonly recipient: IntentParty;
  readonly source: IntentParty;
  readonly customerReference?: string;
}

export interface CompositionOptions {
  /** Plain-language outcome statements the customer leads with (P2). */
  readonly outcomeStatements: readonly string[];
  readonly recipients: readonly IntentParty[];
  readonly sources: readonly IntentParty[];
  readonly currency: CurrencyCode;
}

// ── Consequence report (review step) ─────────────────────────────────────

export interface IntentConsequenceTerm {
  readonly id: string;
  /** Short plain-language label, e.g. “Fee, as quoted”. */
  readonly label: string;
  /** The full consequence statement. Decision-relevant terms may never be
   *  hidden behind collapsed controls (P3). */
  readonly statement: string;
}

/** Terms for the review step, quoted by the (mock) authority — never computed by the UI. */
export interface IntentConsequenceReport {
  readonly reportId: string;
  readonly quotedAt: string;
  readonly amount: MoneyAmount;
  readonly currency: CurrencyCode;
  readonly feeQuoted: MoneyAmount;
  readonly totalQuoted: MoneyAmount;
  readonly terms: readonly IntentConsequenceTerm[];
  /** Fingerprint of the draft this report was quoted for. Submit must echo it. */
  readonly draftFingerprint: string;
  readonly boundaryNote: string;
}

export type ConsequenceReportResult =
  | { readonly kind: 'report'; readonly report: IntentConsequenceReport }
  | { readonly kind: 'no-answer'; readonly note: string };

// ── Explicit submit ──────────────────────────────────────────────────────

/**
 * The only authorization shape the port will accept for a submit (N3/N5):
 * an explicit, single-intent user submit that references the consequence
 * report the customer actually reviewed. The port REFUSES anything else.
 * In the runtime this becomes real protocol authorization; the shape —
 * explicit, reviewed, single-intent — survives.
 */
export interface SubmitAuthorization {
  readonly explicitUserSubmit: true;
  readonly consequenceReportId: string;
  readonly draftFingerprint: string;
}

export type SubmitResult =
  | { readonly kind: 'transported'; readonly intentId: IntentId; readonly snapshot: IntentStateSnapshot }
  | { readonly kind: 'not-transported'; readonly submissionRef: SubmissionRef; readonly note: string }
  | {
      readonly kind: 'refused';
      readonly reason:
        | 'missing-explicit-authorization'
        | 'missing-consequence-review'
        | 'draft-changed-since-review'
        | 'malformed-draft';
      readonly note: string;
    };

// ── Intent state snapshots ───────────────────────────────────────────────

export interface IntentSummary {
  readonly intentId: IntentId;
  readonly amount: MoneyAmount;
  readonly currency: CurrencyCode;
  readonly recipientName: string;
  readonly sourceName: string;
  readonly customerReference?: string;
  readonly composedAt: string;
}

export type StateReport =
  | {
      readonly kind: 'acknowledged';
      readonly acknowledgementNote: string;
      readonly recordedAt: string;
    }
  | {
      readonly kind: 'rejected';
      readonly reason: { readonly code: string; readonly message: string };
      readonly recoveryHint: string | null;
    }
  | {
      readonly kind: 'unresolved';
      readonly whatIsNotKnown: string;
      readonly reconciliation: {
        readonly whoResolves: string;
        readonly recheckAvailable: boolean;
        readonly note: string;
      };
    }
  | {
      readonly kind: 'held-for-recipient';
      readonly whatIsWaiting: string;
      readonly why: string;
      readonly whatHappensNext: string;
      readonly cancelAuthorized: boolean;
    }
  | { readonly kind: 'processing'; readonly activity: string; readonly asReported: string }
  | { readonly kind: 'action-requested'; readonly requestedAction: string; readonly rationale: string };

export interface IntentEvidenceRecord {
  readonly id: string;
  readonly at: string;
  readonly authority: string;
  readonly kind:
    | 'submission-received'
    | 'consequence-terms'
    | 'authority-state-report'
    | 'acknowledgement';
  readonly summary: string;
  readonly details: readonly { readonly label: string; readonly value: string }[];
}

export interface IntentStateSnapshot {
  readonly intentId: IntentId;
  readonly authority: IntentAuthorityRef;
  readonly authorityState: AuthorityState;
  readonly reportedAt: string;
  readonly intent: IntentSummary;
  readonly stateReport: StateReport;
  readonly evidence: readonly IntentEvidenceRecord[];
}

/**
 * P5: absence of an answer is a first-class result. The UI renders
 * `no-answer` as UNKNOWN with its reconciliation path — never as failure,
 * never as an empty success.
 */
export type IntentQueryResult =
  | { readonly kind: 'snapshot'; readonly snapshot: IntentStateSnapshot }
  | {
      readonly kind: 'no-answer';
      readonly reason: 'unreachable' | 'no-record';
      readonly note: string;
    };

// ── Session listing ──────────────────────────────────────────────────────

export interface SessionIntentRecord {
  readonly intentId: IntentId;
  readonly authorityState: AuthorityState;
  readonly reportedAt: string;
  readonly amount: MoneyAmount;
  readonly currency: CurrencyCode;
  readonly recipientName: string;
}

export type SessionIntentListResult =
  | { readonly kind: 'records'; readonly records: readonly SessionIntentRecord[] }
  | { readonly kind: 'no-answer'; readonly note: string };

// ── Boundary report ──────────────────────────────────────────────────────

export interface BoundaryReport {
  readonly adapter: 'intent-port';
  readonly authorityOwner: 'Intent Authority (spec/architecture/v0.1)';
  readonly runtimeStatus: 'ARRIVING';
  readonly implementation: 'mock';
  readonly authoritative: false;
  readonly note: string;
}

// ── The port ─────────────────────────────────────────────────────────────

import { getMockIntentPort } from './mock-intent-authority';

export interface IntentPort {
  /** Describes this adapter boundary, for honest display where relevant. */
  boundary(): BoundaryReport;
  /** Options the composition step offers (outcome statements lead, P2). */
  getCompositionOptions(): CompositionOptions;
  /** Review step input: full consequence terms, quoted by the authority side. */
  requestConsequenceReport(draft: IntentDraft): Promise<ConsequenceReportResult>;
  /**
   * Explicit, single-intent submit. The port refuses submits that lack the
   * explicit authorization shape or a reviewed consequence report. The UI
   * never applies an intent itself — only the authority side records one.
   */
  submitIntent(draft: IntentDraft, authorization: SubmitAuthorization): Promise<SubmitResult>;
  /** State presentation source: the ONLY origin of displayed intent state. */
  getIntentState(intentId: string): Promise<IntentQueryResult>;
  /**
   * Intents recorded in this session (mock holds them in memory only).
   * `no-answer` renders as UNKNOWN — never as an empty list (P5).
   */
  listSessionIntents(): Promise<SessionIntentListResult>;
  /**
   * Verification-only: a demonstration snapshot for one authority state,
   * used by verification surfaces to render the state matrix through the
   * same port. Not used by customer flow logic.
   */
  getPresentationFixture(state: AuthorityState): Promise<IntentQueryResult>;
}

/**
 * The adapter boundary accessor. Today it returns the NON-AUTHORITATIVE
 * mock; when the protocol runtime program lands it returns the runtime
 * adapter and the mock is retired. Surfaces never import the mock
 * directly — they go through this port.
 */
export function getIntentPort(): IntentPort {
  return getMockIntentPort();
}
