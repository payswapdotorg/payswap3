/**
 * ════════════════════════════════════════════════════════════════════════
 *  UI-011 — SHARED ADAPTER-BOUNDARY CONSTANTS (honest, environment-stable)
 * ════════════════════════════════════════════════════════════════════════
 *
 * The boundary facts every backing of every port reports — the runtime
 * adapter (server) AND the transport-unavailable backing (browser) return
 * EXACTLY these values, so server render and client hydration always agree
 * and every surface renders the SAME honest boundary.
 *
 * Honesty rules (UI-011 acceptance): the boundary reports describe the
 * runtime adapter — implementation identity and capability limits — with
 * nothing claimed beyond what the composed protocol runtime (RTN-012,
 * src/lib/protocol-runtime/) actually answers:
 *   • runtimeStatus is LIVE: the composed runtime is merged and the port
 *     adapters are wired to it (in-process, server-side).
 *   • authoritative is true: the state presentation reads the runtime's
 *     own public read surface (authority query APIs + the A15 evidence
 *     log); commands flow exclusively through ProtocolGateway.submitCommand.
 *   • CAPABILITY LIMIT, stated in every note: the composed runtime is
 *     in-process on the server (node:sqlite substrate — the DEP-003
 *     durable command path). There is NO browser transport binding in this
 *     work item (the gateway's HTTP binding is recorded future work,
 *     COMMAND-SURFACE.md "Health"; DEP-002+). Port calls that originate in
 *     a browser context (the frozen 'use client' consumers) therefore
 *     reach the transport-unavailable backing and present no-answer /
 *     not-transported — UNKNOWN, never success or failure (P5) — with the
 *     reconciliation path stated. Server-rendered surfaces and the API
 *     routes carry the runtime-backed reads and commands.
 */

import type {
  BoundaryReport as IntentBoundaryReport,
  CompositionOptions,
  IntentAuthorityRef,
} from './intent-port';
import type { CapabilityBoundaryInfo } from './capability-port';
import type { LiquidityPortBinding } from './liquidity-port';
import type { TrackingBoundaryReport } from './tracking-port';
import type { DisputeInitiationBriefing } from './mediation-port';

// ── Intent (A01 Intent Authority + A15 evidence; UI-002 surface) ─────────

/** The product composition directory (P2 outcome-first composition input). */
export const COMPOSITION_OPTIONS: CompositionOptions = {
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

export const INTENT_BOUNDARY: IntentBoundaryReport = {
  adapter: 'intent-port',
  authorityOwner: 'Intent Authority (spec/architecture/v0.1)',
  runtimeStatus: 'LIVE',
  implementation: 'runtime adapter over the composed protocol runtime (A01 Intent Authority + A15 evidence log; commands via ProtocolGateway.submitCommand — UI-011)',
  authoritative: true,
  note:
    'This adapter boundary is backed by the composed protocol runtime: intent commands are admitted exclusively through the protocol gateway ' +
    '(the sole admission point) and every intent state it reports is read from the Intent Authority\u2019s own query API over the real A15 evidence chain. ' +
    'Capability limits: the runtime is in-process on the server (node:sqlite durable substrate); there is no browser transport binding in this work item, ' +
    'so port calls from a browser context present no-answer / not-transported as UNKNOWN with a reconciliation path — never success or failure. ' +
    'The runtime exposes no pre-submit fee-quote surface: consequence terms are quoted only from the Capability Authority\u2019s real current snapshot ' +
    '(cost schedules the runtime actually reports); when no capability is registered for the corridor, no terms are quoted and the review stays closed.',
};

export const INTENT_AUTHORITY_REF: IntentAuthorityRef = {
  owner: 'Intent Authority',
  architectureRef: 'spec/architecture/v0.1',
  runtimeStatus: 'LIVE',
  implementation: 'runtime adapter over the composed protocol runtime (A01 + A15)',
};

// ── Checkout (A01 intent reads; area-20 runtime is RTN wave 2 — UI-003) ──

export const CHECKOUT_BOUNDARY = {
  runtime: 'ARRIVING' as const,
  authorityOwner:
    'Checkout/Intent Authority (spec/architecture/v0.1) — reads re-anchored by UI-011 to the composed A01 Intent Authority (LIVE); the area-20 Merchant Authority runtime is RTN wave 2 and not merged',
  nonAuthoritative: true,
  note:
    'Runtime-backed reads: offers and statuses are read from the composed A01 Intent Authority (real DemandDescriptor terms; real intent states; ' +
    'no fee-quote surface, so only figures the Intent Authority actually reports are quoted). Capability limits: the composed runtime exposes NO ' +
    'merchant-decision command surface (the area-20 checkout-session semantics are RTN wave 2), so explicit accept/decline decisions are REFUSED ' +
    'with the recorded gap (decision-not-allowed) — nothing is committed, nothing is fabricated. The checkout authority surface is ARRIVING with ' +
    'wave 2; the A01 read surface behind it is live and named in every reportedBy.',
};

// ── Capability (A03 Capability Authority — UI-004 surface) ───────────────

export const CAPABILITY_BOUNDARY_INFO: CapabilityBoundaryInfo = {
  runtime: 'LIVE',
  authorityOwner: 'Capability/Routing Authority (spec/architecture/v0.1) — re-anchored to the composed A03 Capability Authority',
  backing: 'protocol-adapter',
  authoritative: true,
  notes:
    'Runtime-backed: every capability report is read from the A03 Capability Authority\u2019s own query API (REGISTERED/ACTIVE/DEGRADED/RETIRED state ' +
    'vocabulary, declared capacity, corridors, cost schedules). Capability limits: read-only port (no command kinds); browser-context calls present ' +
    'the boundary without an authoritative registry enumeration (no transport binding this work item). The source-availability axis is the adapter\u2019s ' +
    'own reachability observation and is scriptable by the verification harness only.',
};

// ── Tracking (A01 intent states + A15 proof trails — UI-005 surface) ─────

export const TRACKING_BOUNDARY_REPORT: TrackingBoundaryReport = {
  surface: 'track/status/evidence',
  portModule: 'src/lib/protocol/tracking-port.ts',
  backingModule: 'src/lib/protocol/runtime-tracking-adapter.ts',
  backingKind: 'runtime-adapter',
  runtime: 'LIVE',
  authoritative: true,
  presentationOnly: false,
  authorityOwner:
    'Intent Authority (tracked consequential states + plain-language history) and the Evidence Authority (proof-trail records) — per spec/architecture/v0.1, re-anchored to the composed A01 + A15 runtime surfaces',
  authorityOwnerSource: 'spec/architecture/v0.1 core.md + evidence-risk-compliance.md',
  scriptable: ['evidence-availability (verification harness; server-side only)'],
  note:
    'Runtime-backed: tracked states are the A01 Intent Authority\u2019s own state reports, the history is the A15 evidence chain\u2019s INTENT_* records, ' +
    'and the proof trail is the real A15 record chain. Capability limits: reference lookups resolve the runtime\u2019s own protocol object ids; ' +
    'the runtime exposes no per-viewer role gating on protocol reads (the product shell\u2019s audience model governs surface access), and browser-context ' +
    'calls present not-found with UNKNOWN-honest wording (no transport binding this work item). Evidence-record availability scripting is the ' +
    'verification harness\u2019s demonstration affordance over the adapter\u2019s A15 read.',
};

// ── Waiting (A08 Fulfillment/Queue Authority + A06/A07 — UI-006 surface) ─

export const WAITING_BOUNDARY = {
  runtime: 'LIVE' as const,
  authorityOwner:
    'Fulfillment/Queue Authority (spec/architecture/v0.1 liquidity-credit-queues.md) — re-anchored to the composed A08 Queue Authority with A06 Liquidity / A07 Credit reads',
  nonAuthoritative: false,
  note:
    'Runtime-backed: waiting snapshots are read from the A08 queue records (QUEUED/ELIGIBLE/DISPATCHED/GRADUATED/CANCELLED/EXPIRED) with the real ' +
    'A06 liquidity and A07 credit conditions. Re-check requests submit queues.eligibility.evaluate through the protocol gateway; cancel recovery submits ' +
    'queues.item.cancel. Capability limits: the composed runtime exposes no retry/escalate recovery kinds (denied with the recorded gap); ' +
    'browser-context calls present the unknown snapshot with its reconciliation path (no transport binding this work item).',
};

// ── Liquidity (A06 + A07 + A08 reads — UI-007 surface) ───────────────────

export const LIQUIDITY_PORT_BINDING: LiquidityPortBinding = {
  implementation: 'runtime-adapter',
  runtime: 'LIVE',
  authorityOwners: ['Liquidity Authority', 'Credit Authority'],
  authorityReference: 'spec/architecture/v0.1 liquidity-credit-queues.md — re-anchored to the composed A06/A07/A08 runtime surfaces',
  note:
    'Runtime-backed: positions, credit, and queue snapshots are read from the composed A06 Liquidity Authority, A07 Credit Authority, and A08 Queue ' +
    'Authority query APIs. Capability limits: read-only port; the composed runtime exposes no cross-provider aggregate read, so the oversight aggregates ' +
    'present authority-UNKNOWN with the recorded gap (never a UI-side sum); browser-context calls present denied-with-reason (no transport binding this work item). ' +
    'Sandbox overrides (unknownSources) are the verification harness\u2019s scripting of the read\u2019s availability axis.',
};

// ── Mediation (A10 dispute primitive; area 19/21 wave-2 gap — UI-008) ────

export const MEDIATION_RUNTIME_NOTE =
  'Runtime-backed where the composed runtime answers: disputes read from the A10 obligation ledger\u2019s dispute primitive and dispute initiation ' +
  'submits obligations.dispute.open through the protocol gateway. Capability limits: the Agents/Mediation Authority (area 19) and the Disputes/Recourse ' +
  'Authority (area 21) are RTN wave 2 and NOT merged — proposals, mediation cases, and the dispute workflow beyond the A10 primitive present ' +
  'unavailable/denied with the recorded gap, never fabricated.';

/** The dispute-initiation briefing the adapter words from the runtime's own
 *  A10 dispute semantics (the grounds catalog is the product's presentation
 *  of the account-of-what-happened the A10 dispute carries). */
export const DISPUTE_INITIATION_BRIEFING: DisputeInitiationBriefing = {
  authority:
    'Obligation Authority (A10 dispute primitive) over the composed protocol runtime — obligations.dispute.open via the protocol gateway',
  grounds: [
    {
      id: 'goods-not-received',
      label: 'Goods or services not received',
      description:
        'The obligation\u2019s counterparty did not deliver what the fulfilled activity recorded. The dispute records your account of what happened.',
      requiresEvidence: true,
    },
    {
      id: 'goods-not-as-described',
      label: 'Goods or services not as described',
      description:
        'What was delivered does not match what the fulfilled activity recorded. The dispute records your account of what happened.',
      requiresEvidence: true,
    },
    {
      id: 'settlement-mismatch',
      label: 'Settlement amount mismatch',
      description:
        'The settled obligation does not match what the cleared activity should have produced. The dispute records the discrepancy.',
      requiresEvidence: true,
    },
    {
      id: 'authorization-disagreement',
      label: 'Authorization disagreement',
      description: 'The parties disagree about whether the recorded activity was authorized. The dispute records the disagreement.',
      requiresEvidence: false,
    },
    {
      id: 'other-with-evidence',
      label: 'Other (evidence required)',
      description:
        'Any other reason, recorded with your evidence. The A10 dispute primitive carries your account verbatim; the authority decides on resolution.',
      requiresEvidence: true,
    },
  ],
  consequences: [
    'Opening a dispute terminalizes the recorded obligation into DISPUTED (the A10 primitive: no settlement proceeds while the dispute is open).',
    'The dispute is resolved only by the Obligation Authority\u2019s recorded resolution, which replaces the disputed obligation with new obligations as governance requires — never by this surface.',
    'While the dispute is open, the disputed obligation does not settle; nothing in this flow moves money.',
    'The dispute record and its resolution are written to the real A15 evidence chain.',
  ],
  whatHappensNext:
    'The Obligation Authority records the dispute (obligations.dispute.open through the protocol gateway — the sole admission point) and the ' +
    'obligation\u2019s state becomes DISPUTED. Resolution arrives as the authority\u2019s recorded dispute resolution; this surface only presents it.',
  consequenceOfInaction:
    'If you do not open a dispute, the obligation proceeds on its recorded course (settlement per the composed runtime).',
};
