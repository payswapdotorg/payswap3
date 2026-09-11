// ============================================================================
// UI-007 — Liquidity, credit, and queue state mapping.
// ----------------------------------------------------------------------------
// ONE-TO-ONE authority state -> display presentation mapping, plus the
// LQ-* mapping-record ids used by spec/product/liquidity-mapping-records.md.
//
// Every function here is pure and total: one authority state maps to exactly
// one display presentation, with no UI-side branching heuristics.
//
// IMPORTANT — what this module does and does not do:
//   It FORMATS authority-quoted strings for display (presentation), and it
//   CLASSIFIES how many authority values are indeterminate (so the correct
//   presentation state and record id can be shown). It never computes,
//   estimates, interpolates, or repairs a VALUE. Indeterminate values are
//   passed through as UNKNOWN presentations with their reconciliation path.
// ============================================================================

import { formatMoney } from '@/lib/pay-flow/money';
import type {
  AuthorityQuotedAmount,
  AuthorityQuotedCount,
  AuthorityUnknownValue,
  LiquidityAccessDenied,
  LiquidityAmountValue,
  LiquidityAuthorityOwner,
  LiquidityCountValue,
  LiquidityPortBinding,
  OperatorOversightView,
  OversightAggregate,
  ProviderCreditPosition,
  ProviderLiquidityPosition,
  QueueEntry,
  QueueSnapshot,
} from '@/lib/protocol/liquidity-port';

// ---------------------------------------------------------------------------
// Authority states and mapping-record ids
// ---------------------------------------------------------------------------

export type LiquidityAuthorityStateId =
  | 'liquidity.position.quoted'
  | 'liquidity.position.partially-unknown'
  | 'liquidity.position.wholly-unknown'
  | 'credit.position.quoted'
  | 'credit.position.partially-unknown'
  | 'credit.position.wholly-unknown'
  | 'queue.quoted'
  | 'queue.value.unknown'
  | 'oversight.aggregate.quoted'
  | 'oversight.aggregate.unknown'
  | 'access.denied'
  | 'authority-binding.arriving';

export type LiquidityMappingRecordId =
  | 'LQ-001'
  | 'LQ-002'
  | 'LQ-003'
  | 'LQ-004'
  | 'LQ-005'
  | 'LQ-006'
  | 'LQ-007'
  | 'LQ-008'
  | 'LQ-009'
  | 'LQ-010'
  | 'LQ-011'
  | 'LQ-012';

export interface LiquidityMappingRecordSummary {
  readonly recordId: LiquidityMappingRecordId;
  readonly authorityState: LiquidityAuthorityStateId;
  readonly owningAuthority: string;
  readonly presentation: string;
}

/** Catalog of every consequential visibility state on these surfaces. */
export const LIQUIDITY_MAPPING_RECORD_CATALOG: readonly LiquidityMappingRecordSummary[] = [
  {
    recordId: 'LQ-001',
    authorityState: 'liquidity.position.quoted',
    owningAuthority: 'Liquidity Authority',
    presentation:
      'Read-only value with provenance wording (reported-by, quote id, as-of) on every value group. Never editable, never recomputed.',
  },
  {
    recordId: 'LQ-002',
    authorityState: 'liquidity.position.partially-unknown',
    owningAuthority: 'Liquidity Authority',
    presentation:
      'Each indeterminate value renders UNKNOWN with its reconciliation path; the quoted values beside it keep their provenance. Never zero, empty, or failed.',
  },
  {
    recordId: 'LQ-003',
    authorityState: 'liquidity.position.wholly-unknown',
    owningAuthority: 'Liquidity Authority',
    presentation:
      'The whole value group renders UNKNOWN with its reconciliation path; no placeholder value is shown for any part of the group.',
  },
  {
    recordId: 'LQ-004',
    authorityState: 'credit.position.quoted',
    owningAuthority: 'Credit Authority',
    presentation:
      'Read-only credit values with provenance wording on every value group. Limit, utilized, and remaining are presented as independently quoted — remaining is never derived from limit minus utilized.',
  },
  {
    recordId: 'LQ-005',
    authorityState: 'credit.position.partially-unknown',
    owningAuthority: 'Credit Authority',
    presentation:
      'Each indeterminate credit value renders UNKNOWN with its reconciliation path; quoted values beside it keep their provenance.',
  },
  {
    recordId: 'LQ-006',
    authorityState: 'credit.position.wholly-unknown',
    owningAuthority: 'Credit Authority',
    presentation:
      'The whole credit value group renders UNKNOWN with its reconciliation path; no placeholder value is shown.',
  },
  {
    recordId: 'LQ-007',
    authorityState: 'queue.quoted',
    owningAuthority: 'Liquidity Authority',
    presentation:
      'Queued entries with authority-quoted positions, waiting semantics (what is waiting, why, what happens next), and a reachable track-surface reference. Composition stays one deliberate step away.',
  },
  {
    recordId: 'LQ-008',
    authorityState: 'queue.value.unknown',
    owningAuthority: 'Liquidity Authority',
    presentation:
      'Any indeterminate queue value (entry position or queue depth) renders UNKNOWN with its reconciliation path — never zero, never "first", never empty.',
  },
  {
    recordId: 'LQ-009',
    authorityState: 'oversight.aggregate.quoted',
    owningAuthority: 'Liquidity Authority / Credit Authority',
    presentation:
      'Authority-quoted aggregate with provenance wording. The aggregate is presented as quoted — never summed, filtered, or derived UI-side.',
  },
  {
    recordId: 'LQ-010',
    authorityState: 'oversight.aggregate.unknown',
    owningAuthority: 'Liquidity Authority / Credit Authority',
    presentation:
      'An indeterminate aggregate renders UNKNOWN with its reconciliation path; no partial or estimated aggregate is shown.',
  },
  {
    recordId: 'LQ-011',
    authorityState: 'access.denied',
    owningAuthority: 'Liquidity Authority / Credit Authority (permissions mirrored by the surface guard)',
    presentation:
      'The surface does not render for the requesting role; deep links redirect home. No data, not even partial or teaser data, is shown.',
  },
  {
    recordId: 'LQ-012',
    authorityState: 'authority-binding.arriving',
    owningAuthority: 'Liquidity Authority / Credit Authority',
    presentation:
      'An ARRIVING banner states that values are backed by the presentation-only mock until the authoritative runtime arrives; provenance wording still names the owning authorities.',
  },
];

// ---------------------------------------------------------------------------
// Display cell types (the one-to-one value-level presentations)
// ---------------------------------------------------------------------------

export interface MappedQuotedAmountCell {
  readonly kind: 'quoted-amount';
  /** formatMoney output of the authority-quoted string — presentation only. */
  readonly formatted: string;
  /** The authority-quoted string, verbatim. */
  readonly raw: string;
  readonly currency: 'USD';
  readonly quotedBy: LiquidityAuthorityOwner;
  readonly quoteId: string;
  readonly quotedAt: string;
  readonly quotedAtLabel: string;
}

export interface MappedQuotedCountCell {
  readonly kind: 'quoted-count';
  readonly count: number;
  readonly quotedBy: LiquidityAuthorityOwner;
  readonly quoteId: string;
  readonly quotedAt: string;
  readonly quotedAtLabel: string;
}

export interface MappedUnknownCell {
  readonly kind: 'unknown';
  readonly subject: string;
  readonly explanation: string;
  readonly reconciliation: { readonly whoResolves: string; readonly recheckTrigger: string };
}

export type MappedValueCell = MappedQuotedAmountCell | MappedQuotedCountCell | MappedUnknownCell;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/**
 * Deterministic UTC label so server and client renders always agree.
 * Presentation only — the authority's ISO timestamp is preserved verbatim in
 * the quotedAt field.
 */
export function formatAsOfLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(
    d.getUTCHours()
  )}:${pad2(d.getUTCMinutes())} UTC`;
}

function mapAmount(value: LiquidityAmountValue): MappedValueCell {
  if (value.kind === 'authority-unknown') {
    return mapUnknown(value);
  }
  const quoted = value as AuthorityQuotedAmount;
  return {
    kind: 'quoted-amount',
    formatted: formatMoney(quoted.amount, quoted.currency),
    raw: quoted.amount,
    currency: quoted.currency,
    quotedBy: quoted.quotedBy,
    quoteId: quoted.quoteId,
    quotedAt: quoted.quotedAt,
    quotedAtLabel: formatAsOfLabel(quoted.quotedAt),
  };
}

function mapCount(value: LiquidityCountValue): MappedValueCell {
  if (value.kind === 'authority-unknown') {
    return mapUnknown(value);
  }
  const quoted = value as AuthorityQuotedCount;
  return {
    kind: 'quoted-count',
    count: quoted.count,
    quotedBy: quoted.quotedBy,
    quoteId: quoted.quoteId,
    quotedAt: quoted.quotedAt,
    quotedAtLabel: formatAsOfLabel(quoted.quotedAt),
  };
}

function mapUnknown(value: AuthorityUnknownValue): MappedUnknownCell {
  return {
    kind: 'unknown',
    subject: value.subject,
    explanation: value.explanation,
    reconciliation: value.reconciliation,
  };
}

function isUnknown(value: LiquidityAmountValue | LiquidityCountValue): boolean {
  return value.kind === 'authority-unknown';
}

function isQuotedAmountValue(
  value: LiquidityAmountValue | LiquidityCountValue
): value is AuthorityQuotedAmount {
  return value.kind === 'authority-quoted' && 'amount' in value;
}

// ---------------------------------------------------------------------------
// Position-level mapping (one-to-one)
// ---------------------------------------------------------------------------

export interface MappedLiquidityPosition {
  readonly recordId: 'LQ-001' | 'LQ-002' | 'LQ-003';
  readonly state: 'liquidity.position.quoted' | 'liquidity.position.partially-unknown' | 'liquidity.position.wholly-unknown';
  readonly positionId: string;
  readonly asset: 'USD';
  readonly cells: {
    readonly balance: MappedValueCell;
    readonly reserved: MappedValueCell;
    readonly available: MappedValueCell;
  };
  readonly asOf: string;
  readonly asOfLabel: string;
  readonly reportedBy: LiquidityAuthorityOwner;
  readonly evidence: readonly { label: string; href: string }[];
}

export function mapLiquidityPosition(position: ProviderLiquidityPosition): MappedLiquidityPosition {
  const cells = {
    balance: mapAmount(position.balance),
    reserved: mapAmount(position.reserved),
    available: mapAmount(position.available),
  };
  const unknownCount = [cells.balance, cells.reserved, cells.available].filter(
    (cell) => cell.kind === 'unknown'
  ).length;
  const recordId: MappedLiquidityPosition['recordId'] =
    unknownCount === 0 ? 'LQ-001' : unknownCount === 3 ? 'LQ-003' : 'LQ-002';
  const state: MappedLiquidityPosition['state'] =
    recordId === 'LQ-001'
      ? 'liquidity.position.quoted'
      : recordId === 'LQ-003'
        ? 'liquidity.position.wholly-unknown'
        : 'liquidity.position.partially-unknown';
  return {
    recordId,
    state,
    positionId: position.positionId,
    asset: position.asset,
    cells,
    asOf: position.asOf,
    asOfLabel: formatAsOfLabel(position.asOf),
    reportedBy: position.reportedBy,
    evidence: position.evidence,
  };
}

export interface MappedCreditPosition {
  readonly recordId: 'LQ-004' | 'LQ-005' | 'LQ-006';
  readonly state: 'credit.position.quoted' | 'credit.position.partially-unknown' | 'credit.position.wholly-unknown';
  readonly positionId: string;
  readonly scope: string;
  readonly cells: {
    readonly creditLimit: MappedValueCell;
    readonly utilized: MappedValueCell;
    readonly remaining: MappedValueCell;
  };
  readonly asOf: string;
  readonly asOfLabel: string;
  readonly reportedBy: LiquidityAuthorityOwner;
  readonly evidence: readonly { label: string; href: string }[];
}

export function mapCreditPosition(position: ProviderCreditPosition): MappedCreditPosition {
  const cells = {
    creditLimit: mapAmount(position.creditLimit),
    utilized: mapAmount(position.utilized),
    remaining: mapAmount(position.remaining),
  };
  const unknownCount = [cells.creditLimit, cells.utilized, cells.remaining].filter(
    (cell) => cell.kind === 'unknown'
  ).length;
  const recordId: MappedCreditPosition['recordId'] =
    unknownCount === 0 ? 'LQ-004' : unknownCount === 3 ? 'LQ-006' : 'LQ-005';
  const state: MappedCreditPosition['state'] =
    recordId === 'LQ-004'
      ? 'credit.position.quoted'
      : recordId === 'LQ-006'
        ? 'credit.position.wholly-unknown'
        : 'credit.position.partially-unknown';
  return {
    recordId,
    state,
    positionId: position.positionId,
    scope: position.scope,
    cells,
    asOf: position.asOf,
    asOfLabel: formatAsOfLabel(position.asOf),
    reportedBy: position.reportedBy,
    evidence: position.evidence,
  };
}

// ---------------------------------------------------------------------------
// Queue mapping (one-to-one)
// ---------------------------------------------------------------------------

export interface MappedQueueEntry {
  readonly recordId: 'LQ-007' | 'LQ-008';
  readonly state: 'queue.quoted' | 'queue.value.unknown';
  readonly entryId: string;
  readonly reason: string;
  readonly enteredAt: string;
  readonly enteredAtLabel: string;
  readonly position: MappedValueCell;
  readonly waiting: {
    readonly whatIsWaiting: string;
    readonly why: string;
    readonly whatHappensNext: string;
    readonly reportedBy: LiquidityAuthorityOwner;
  };
  readonly tracking?: { readonly referenceId: string };
  readonly evidence: readonly { label: string; href: string }[];
}

export function mapQueueEntry(entry: QueueEntry): MappedQueueEntry {
  const position = mapCount(entry.position);
  const positionUnknown = isUnknown(entry.position);
  return {
    recordId: positionUnknown ? 'LQ-008' : 'LQ-007',
    state: positionUnknown ? 'queue.value.unknown' : 'queue.quoted',
    entryId: entry.entryId,
    reason: entry.reason,
    enteredAt: entry.enteredAt,
    enteredAtLabel: formatAsOfLabel(entry.enteredAt),
    position,
    waiting: entry.waiting,
    tracking: entry.tracking,
    evidence: entry.evidence,
  };
}

export interface MappedQueueSnapshot {
  readonly recordId: 'LQ-007' | 'LQ-008';
  readonly state: 'queue.quoted' | 'queue.value.unknown';
  readonly queueId: string;
  readonly queueName: string;
  readonly depth: MappedValueCell;
  readonly asOf: string;
  readonly asOfLabel: string;
  readonly reportedBy: LiquidityAuthorityOwner;
  readonly entries: readonly MappedQueueEntry[];
}

export function mapQueueSnapshot(snapshot: QueueSnapshot): MappedQueueSnapshot {
  const entries = snapshot.entries.map(mapQueueEntry);
  const anyUnknown =
    isUnknown(snapshot.depth) || entries.some((entry) => entry.recordId === 'LQ-008');
  return {
    recordId: anyUnknown ? 'LQ-008' : 'LQ-007',
    state: anyUnknown ? 'queue.value.unknown' : 'queue.quoted',
    queueId: snapshot.queueId,
    queueName: snapshot.queueName,
    depth: mapCount(snapshot.depth),
    asOf: snapshot.asOf,
    asOfLabel: formatAsOfLabel(snapshot.asOf),
    reportedBy: snapshot.reportedBy,
    entries,
  };
}

// ---------------------------------------------------------------------------
// Oversight mapping (one-to-one)
// ---------------------------------------------------------------------------

export interface MappedOversightAggregate {
  readonly recordId: 'LQ-009' | 'LQ-010';
  readonly state: 'oversight.aggregate.quoted' | 'oversight.aggregate.unknown';
  readonly aggregateId: string;
  readonly label: string;
  readonly value: MappedValueCell;
  readonly reportedBy: LiquidityAuthorityOwner;
  readonly note: string;
}

export function mapOversightAggregate(aggregate: OversightAggregate): MappedOversightAggregate {
  const value: MappedValueCell = isQuotedAmountValue(aggregate.value)
    ? mapAmount(aggregate.value)
    : isUnknown(aggregate.value)
      ? mapUnknown(aggregate.value as AuthorityUnknownValue)
      : mapCount(aggregate.value);
  const unknown = aggregate.value.kind === 'authority-unknown';
  return {
    recordId: unknown ? 'LQ-010' : 'LQ-009',
    state: unknown ? 'oversight.aggregate.unknown' : 'oversight.aggregate.quoted',
    aggregateId: aggregate.aggregateId,
    label: aggregate.label,
    value,
    reportedBy: aggregate.reportedBy,
    note: aggregate.note,
  };
}

export interface MappedOversightView {
  readonly aggregates: readonly MappedOversightAggregate[];
  readonly asOf: string;
  readonly asOfLabel: string;
  readonly scopeNote: string;
}

export function mapOperatorOversightView(view: OperatorOversightView): MappedOversightView {
  return {
    aggregates: view.aggregates.map(mapOversightAggregate),
    asOf: view.asOf,
    asOfLabel: formatAsOfLabel(view.asOf),
    scopeNote: view.scopeNote,
  };
}

// ---------------------------------------------------------------------------
// Access-denied and authority-binding mapping (one-to-one)
// ---------------------------------------------------------------------------

export interface MappedAccessDenied {
  readonly recordId: 'LQ-011';
  readonly state: 'access.denied';
  readonly surface: 'provider-positions' | 'operator-oversight';
  readonly requester: string;
  readonly reason: string;
}

export function mapAccessDenied(denied: LiquidityAccessDenied): MappedAccessDenied {
  return {
    recordId: 'LQ-011',
    state: 'access.denied',
    surface: denied.surface,
    requester: denied.requester,
    reason: denied.reason,
  };
}

export interface MappedAuthorityBinding {
  readonly recordId: 'LQ-012';
  readonly state: 'authority-binding.arriving';
  readonly runtime: 'ARRIVING';
  readonly authorityOwners: readonly LiquidityAuthorityOwner[];
  readonly authorityReference: string;
  readonly note: string;
  readonly target: string;
  readonly detail: string;
}

export function mapAuthorityBinding(binding: LiquidityPortBinding): MappedAuthorityBinding {
  return {
    recordId: 'LQ-012',
    state: 'authority-binding.arriving',
    runtime: binding.runtime,
    authorityOwners: binding.authorityOwners,
    authorityReference: binding.authorityReference,
    note: binding.note,
    target: 'The authoritative liquidity, credit, and queue implementation',
    detail:
      'The Liquidity Authority and the Credit Authority bindings arrive at runtime (ARRIVING). Until then every value on these surfaces comes from the presentation-only mock and is not authoritative.',
  };
}

// ---------------------------------------------------------------------------
// Provenance-wording helper (used by the surfaces and the harness)
// ---------------------------------------------------------------------------

export function provenanceWordingForCell(cell: MappedValueCell): string {
  if (cell.kind === 'unknown') {
    return `UNKNOWN — resolved by ${cell.reconciliation.whoResolves}; recheck: ${cell.reconciliation.recheckTrigger}`;
  }
  return `Reported by the ${cell.quotedBy} · quote ${cell.quoteId} · as of ${cell.quotedAtLabel}`;
}
