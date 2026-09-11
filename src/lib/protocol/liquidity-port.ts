// ============================================================================
// UI-007 — Liquidity, credit, and queued-position visibility port.
// ----------------------------------------------------------------------------
// ADAPTER BOUNDARY (the proven port pattern; cf. intent-port UI-002,
// capability-port UI-004, tracking-port UI-005, checkout-port UI-003,
// waiting-port UI-006).
//
// This module declares the DATA NEEDS of the UI-007 read-only visibility
// surfaces as typed shapes, plus a single port accessor. The ONLY
// implementation behind the accessor today is the presentation-only mock in
// ./mock-liquidity-authority.ts, which is explicitly NON-AUTHORITATIVE.
//
// The authority owners of this truth are the Liquidity Authority and the
// Credit Authority per spec/architecture/v0.1 liquidity-credit-queues.md.
// The authoritative runtime binding is ARRIVING.
//
// Invariants this port enforces for every consumer:
//   N1/P11 — every monetary value is an authority-quoted string (or an
//            explicit authority-UNKNOWN). Nothing is ever computed,
//            estimated, interpolated, or cached-as-truth UI-side.
//   P5     — indeterminate values are authority-UNKNOWN values that carry
//            their reconciliation path. They are never zero, empty, failed,
//            or definitive.
//   P8     — queries carry the requesting audience; implementations mirror
//            the permissions the owning authorities permit. Cross-role
//            visibility is refused, never filtered-and-shown.
//   P7     — consequential positions carry an authority-provided evidence
//            trail that the surfaces keep reachable.
// ============================================================================

import type { NavAudience } from '@/lib/navigation';
import {
  getMockLiquidityPort,
  type LiquiditySandboxOverrides,
} from '@/lib/protocol/mock-liquidity-authority';

// ---------------------------------------------------------------------------
// Authority ownership
// ---------------------------------------------------------------------------

/**
 * The two protocol authorities that own liquidity, credit, and queue truth
 * per spec/architecture/v0.1 liquidity-credit-queues.md. The Liquidity
 * Authority owns liquidity positions and queued positions; the Credit
 * Authority owns credit positions.
 */
export type LiquidityAuthorityOwner = 'Liquidity Authority' | 'Credit Authority';

export const LIQUIDITY_AUTHORITY_REFERENCE =
  'spec/architecture/v0.1 liquidity-credit-queues.md';

// ---------------------------------------------------------------------------
// Scriptable value sources (harness support)
// ---------------------------------------------------------------------------

/**
 * Stable identifiers for every value source the surfaces present. The mock
 * can be scripted (per-request) to report any subset of these as
 * authority-UNKNOWN, which is how the verification harness demonstrates the
 * UNKNOWN presentation without ever fabricating values.
 */
export type LiquidityValueSourceId =
  | 'provider.position.balance'
  | 'provider.position.reserved'
  | 'provider.position.available'
  | 'provider.credit.limit'
  | 'provider.credit.utilized'
  | 'provider.credit.remaining'
  | 'queue.entry.position'
  | 'queue.snapshot.depth'
  | 'oversight.aggregate.total-reserved'
  | 'oversight.aggregate.queue-depth'
  | 'oversight.aggregate.credit-utilized';

export interface LiquidityValueSourceDescriptor {
  readonly id: LiquidityValueSourceId;
  readonly label: string;
  readonly surface: 'provider-liquidity' | 'provider-credit' | 'queue' | 'operator-oversight';
  readonly owner: LiquidityAuthorityOwner;
}

/** Catalog of every value source these surfaces may present. */
export const LIQUIDITY_VALUE_SOURCES: readonly LiquidityValueSourceDescriptor[] = [
  {
    id: 'provider.position.balance',
    label: 'Provider position — balance',
    surface: 'provider-liquidity',
    owner: 'Liquidity Authority',
  },
  {
    id: 'provider.position.reserved',
    label: 'Provider position — reserved',
    surface: 'provider-liquidity',
    owner: 'Liquidity Authority',
  },
  {
    id: 'provider.position.available',
    label: 'Provider position — available',
    surface: 'provider-liquidity',
    owner: 'Liquidity Authority',
  },
  {
    id: 'provider.credit.limit',
    label: 'Credit line — limit',
    surface: 'provider-credit',
    owner: 'Credit Authority',
  },
  {
    id: 'provider.credit.utilized',
    label: 'Credit line — utilized',
    surface: 'provider-credit',
    owner: 'Credit Authority',
  },
  {
    id: 'provider.credit.remaining',
    label: 'Credit line — remaining',
    surface: 'provider-credit',
    owner: 'Credit Authority',
  },
  {
    id: 'queue.entry.position',
    label: 'Queued entry — position',
    surface: 'queue',
    owner: 'Liquidity Authority',
  },
  {
    id: 'queue.snapshot.depth',
    label: 'Queue snapshot — depth',
    surface: 'queue',
    owner: 'Liquidity Authority',
  },
  {
    id: 'oversight.aggregate.total-reserved',
    label: 'Oversight — total reserved across providers (USD)',
    surface: 'operator-oversight',
    owner: 'Liquidity Authority',
  },
  {
    id: 'oversight.aggregate.queue-depth',
    label: 'Oversight — queued entries across providers',
    surface: 'operator-oversight',
    owner: 'Liquidity Authority',
  },
  {
    id: 'oversight.aggregate.credit-utilized',
    label: 'Oversight — credit utilized across providers (USD)',
    surface: 'operator-oversight',
    owner: 'Credit Authority',
  },
];

// ---------------------------------------------------------------------------
// Authority-quoted values (never computed UI-side)
// ---------------------------------------------------------------------------

/** A monetary value quoted verbatim by an owning authority. */
export interface AuthorityQuotedAmount {
  readonly kind: 'authority-quoted';
  readonly sourceId: LiquidityValueSourceId;
  /** Authority-quoted decimal string. Presented, never derived. */
  readonly amount: string;
  readonly currency: 'USD';
  readonly quotedBy: LiquidityAuthorityOwner;
  readonly quoteId: string;
  readonly quotedAt: string;
}

/** A count quoted verbatim by an owning authority (never counted UI-side). */
export interface AuthorityQuotedCount {
  readonly kind: 'authority-quoted';
  readonly sourceId: LiquidityValueSourceId;
  readonly count: number;
  readonly quotedBy: LiquidityAuthorityOwner;
  readonly quoteId: string;
  readonly quotedAt: string;
}

/**
 * An indeterminate value: the authority has NOT returned a determinate answer.
 * This is authoritative truth about indeterminacy — never a failure, zero,
 * or placeholder.
 */
export interface AuthorityUnknownValue {
  readonly kind: 'authority-unknown';
  readonly sourceId: LiquidityValueSourceId;
  readonly subject: string;
  readonly explanation: string;
  readonly reconciliation: {
    readonly whoResolves: string;
    readonly recheckTrigger: string;
  };
}

export type LiquidityAmountValue = AuthorityQuotedAmount | AuthorityUnknownValue;
export type LiquidityCountValue = AuthorityQuotedCount | AuthorityUnknownValue;

/** Authority-provided evidence reference kept reachable from surfaces (P7). */
export interface AuthorityEvidenceRef {
  readonly label: string;
  readonly href: string;
}

// ---------------------------------------------------------------------------
// Provider surface shapes
// ---------------------------------------------------------------------------

export interface ProviderLiquidityPosition {
  readonly positionId: string;
  readonly asset: 'USD';
  readonly balance: LiquidityAmountValue;
  readonly reserved: LiquidityAmountValue;
  readonly available: LiquidityAmountValue;
  readonly asOf: string;
  readonly reportedBy: LiquidityAuthorityOwner;
  readonly evidence: readonly AuthorityEvidenceRef[];
}

export interface ProviderCreditPosition {
  readonly positionId: string;
  readonly scope: string;
  readonly creditLimit: LiquidityAmountValue;
  readonly utilized: LiquidityAmountValue;
  readonly remaining: LiquidityAmountValue;
  readonly asOf: string;
  readonly reportedBy: LiquidityAuthorityOwner;
  readonly evidence: readonly AuthorityEvidenceRef[];
}

/**
 * Waiting semantics for a queued entry, quoted by the authority and shaped
 * like the UI-006 waiting semantics so the surfaces can reference the
 * waiting track surface where applicable.
 */
export interface QueueWaitingSemantics {
  readonly whatIsWaiting: string;
  readonly why: string;
  readonly whatHappensNext: string;
  readonly reportedBy: LiquidityAuthorityOwner;
}

export interface QueueEntry {
  readonly entryId: string;
  readonly queueId: string;
  readonly position: LiquidityCountValue;
  readonly reason: string;
  readonly enteredAt: string;
  readonly waiting: QueueWaitingSemantics;
  /** Track-surface reference (UI-005/UI-006) when one exists for this entry. */
  readonly tracking?: { readonly referenceId: string };
  readonly evidence: readonly AuthorityEvidenceRef[];
}

export interface QueueSnapshot {
  readonly queueId: string;
  readonly queueName: string;
  readonly depth: LiquidityCountValue;
  readonly asOf: string;
  readonly reportedBy: LiquidityAuthorityOwner;
  /** The provider's own entries in this queue (never other providers'). */
  readonly entries: readonly QueueEntry[];
}

export interface ProviderPositionsView {
  readonly providerRef: string;
  readonly liquidity: readonly ProviderLiquidityPosition[];
  readonly credit: readonly ProviderCreditPosition[];
  readonly queues: readonly QueueSnapshot[];
  readonly asOf: string;
}

// ---------------------------------------------------------------------------
// Operator oversight shapes
// ---------------------------------------------------------------------------

export interface OversightAggregate {
  readonly aggregateId: string;
  readonly label: string;
  /** Aggregate quoted by the authority — never summed or derived UI-side. */
  readonly value: LiquidityAmountValue | LiquidityCountValue;
  readonly reportedBy: LiquidityAuthorityOwner;
  readonly note: string;
}

export interface OperatorOversightView {
  readonly aggregates: readonly OversightAggregate[];
  readonly asOf: string;
  readonly scopeNote: string;
}

// ---------------------------------------------------------------------------
// Queries per role
// ---------------------------------------------------------------------------

export interface ProviderPositionsQuery {
  readonly kind: 'provider-positions';
  readonly requester: NavAudience;
}

export interface OperatorOversightQuery {
  readonly kind: 'operator-oversight';
  readonly requester: NavAudience;
}

export type LiquiditySurfaceId = 'provider-positions' | 'operator-oversight';

export interface LiquidityAccessDenied {
  readonly kind: 'denied';
  readonly surface: LiquiditySurfaceId;
  readonly requester: NavAudience;
  readonly reason: string;
}

export type ProviderPositionsResult =
  | { readonly kind: 'permitted'; readonly view: ProviderPositionsView }
  | LiquidityAccessDenied;

export type OperatorOversightResult =
  | { readonly kind: 'permitted'; readonly view: OperatorOversightView }
  | LiquidityAccessDenied;

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export interface LiquidityPortBinding {
  readonly implementation: 'mock-presentation-only';
  readonly runtime: 'ARRIVING';
  readonly authorityOwners: readonly LiquidityAuthorityOwner[];
  readonly authorityReference: string;
  readonly note: string;
}

export interface LiquidityPort {
  readonly binding: LiquidityPortBinding;
  getProviderPositions(query: ProviderPositionsQuery): Promise<ProviderPositionsResult>;
  getOperatorOversight(query: OperatorOversightQuery): Promise<OperatorOversightResult>;
}

export const EMPTY_LIQUIDITY_SANDBOX_OVERRIDES: LiquiditySandboxOverrides = {
  unknownSources: [],
};

/**
 * The port accessor. Today it returns the NON-AUTHORITATIVE mock backing
 * (presentation-only; the Liquidity Authority and Credit Authority per
 * spec/architecture/v0.1 liquidity-credit-queues.md own the truth; runtime
 * ARRIVING). When the authoritative implementation arrives it binds here and
 * the surfaces change nothing about how they present.
 */
export function getLiquidityPort(
  overrides: LiquiditySandboxOverrides = EMPTY_LIQUIDITY_SANDBOX_OVERRIDES
): LiquidityPort {
  return getMockLiquidityPort(overrides);
}
