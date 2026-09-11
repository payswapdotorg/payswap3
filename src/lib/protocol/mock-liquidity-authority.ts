// ============================================================================
// UI-007 — Mock liquidity authority (presentation-only).
// ----------------------------------------------------------------------------
// NON-AUTHORITATIVE. This mock exists only so the UI-007 visibility surfaces
// can be built, typechecked, and browser-verified before the authoritative
// runtime arrives.
//
// Owners of the truth presented through this mock:
//   - the Liquidity Authority  (liquidity positions, queued positions)
//   - the Credit Authority    (credit positions)
// per spec/architecture/v0.1 liquidity-credit-queues.md.
//
// Runtime status: ARRIVING. Until then every value below is sandbox data.
//
// Mock guarantees (they mirror what the real authority must guarantee):
//   - Every amount is an INDEPENDENT authority quote. Notably, `available` is
//     quoted in its own right by the authority; this mock never derives it
//     from balance and reserved, and neither does any surface.
//   - Views are built fresh on every query. Nothing is cached as truth.
//   - Per-role visibility mirrors the permissions the owning authorities
//     permit: the provider-positions surface is permitted to the provider
//     audience; the operator-oversight surface is permitted to the operator
//     audience; every other audience is denied (see getMockSurfacePermissions).
//   - Indeterminacy is scriptable for the verification harness: any value
//     source can be forced to report authority-UNKNOWN per request. UNKNOWN
//     is truth about indeterminacy, never a failure or a zero.
// ============================================================================

import { cookies } from 'next/headers';

import type { NavAudience } from '@/lib/navigation';
import type {
  AuthorityQuotedAmount,
  AuthorityQuotedCount,
  AuthorityUnknownValue,
  AuthorityEvidenceRef,
  LiquidityAccessDenied,
  LiquidityAmountValue,
  LiquidityAuthorityOwner,
  LiquidityCountValue,
  LiquidityPort,
  LiquidityPortBinding,
  LiquiditySurfaceId,
  LiquidityValueSourceId,
  OperatorOversightQuery,
  OperatorOversightResult,
  OperatorOversightView,
  OversightAggregate,
  ProviderCreditPosition,
  ProviderLiquidityPosition,
  ProviderPositionsQuery,
  ProviderPositionsResult,
  ProviderPositionsView,
  QueueEntry,
  QueueSnapshot,
  QueueWaitingSemantics,
} from '@/lib/protocol/liquidity-port';

// ---------------------------------------------------------------------------
// Sandbox scripting (for the verification harness)
// ---------------------------------------------------------------------------

export interface LiquiditySandboxOverrides {
  /** Value sources forced to report authority-UNKNOWN for this request. */
  readonly unknownSources: readonly LiquidityValueSourceId[];
}

export const MOCK_LIQUIDITY_SANDBOX_COOKIE = 'ui007-liquidity-sandbox-unknown-sources';

const VALID_SOURCE_IDS: readonly string[] = [
  'provider.position.balance',
  'provider.position.reserved',
  'provider.position.available',
  'provider.credit.limit',
  'provider.credit.utilized',
  'provider.credit.remaining',
  'queue.entry.position',
  'queue.snapshot.depth',
  'oversight.aggregate.total-reserved',
  'oversight.aggregate.queue-depth',
  'oversight.aggregate.credit-utilized',
];

/**
 * Reads the harness-scripted UNKNOWN sources from the request cookie.
 * Invalid or unknown ids are ignored — the mock never lets scripting invent
 * value sources.
 */
export async function readSandboxOverridesFromCurrentRequest(): Promise<LiquiditySandboxOverrides> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(MOCK_LIQUIDITY_SANDBOX_COOKIE)?.value;
  if (typeof raw !== 'string' || raw.length === 0) {
    return { unknownSources: [] };
  }
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (!Array.isArray(parsed)) {
      return { unknownSources: [] };
    }
    const unknownSources = parsed.filter(
      (id): id is LiquidityValueSourceId =>
        typeof id === 'string' && VALID_SOURCE_IDS.includes(id)
    );
    return { unknownSources };
  } catch {
    return { unknownSources: [] };
  }
}

// ---------------------------------------------------------------------------
// Per-role visibility (mirrors what the owning authorities permit)
// ---------------------------------------------------------------------------

export interface MockSurfacePermission {
  readonly surface: LiquiditySurfaceId;
  readonly permittedAudiences: readonly NavAudience[];
  readonly owningAuthorities: readonly LiquidityAuthorityOwner[];
  readonly pageGuard: string;
}

const SURFACE_PERMISSIONS: readonly MockSurfacePermission[] = [
  {
    surface: 'provider-positions',
    permittedAudiences: ['provider'],
    owningAuthorities: ['Liquidity Authority', 'Credit Authority'],
    pageGuard: "requireRoleSurface('provider')",
  },
  {
    surface: 'operator-oversight',
    permittedAudiences: ['operator'],
    owningAuthorities: ['Liquidity Authority', 'Credit Authority'],
    pageGuard: "requireRoleSurface('operator')",
  },
];

export function getMockSurfacePermissions(): readonly MockSurfacePermission[] {
  return SURFACE_PERMISSIONS;
}

function isPermitted(surface: LiquiditySurfaceId, requester: NavAudience): boolean {
  return SURFACE_PERMISSIONS.find((p) => p.surface === surface)?.permittedAudiences.includes(
    requester
  ) === true;
}

// ---------------------------------------------------------------------------
// Sandbox data (all values are independent quotes; nothing is derived)
// ---------------------------------------------------------------------------

const AS_OF = '2025-06-14T12:00:00.000Z';
const AS_OF_CREDIT = '2025-06-14T11:45:00.000Z';

function quotedAmount(
  sourceId: LiquidityValueSourceId,
  amount: string,
  quotedBy: LiquidityAuthorityOwner,
  quoteId: string
): AuthorityQuotedAmount {
  return {
    kind: 'authority-quoted',
    sourceId,
    amount,
    currency: 'USD',
    quotedBy,
    quoteId,
    quotedAt: AS_OF,
  };
}

function quotedCount(
  sourceId: LiquidityValueSourceId,
  count: number,
  quotedBy: LiquidityAuthorityOwner,
  quoteId: string
): AuthorityQuotedCount {
  return {
    kind: 'authority-quoted',
    sourceId,
    count,
    quotedBy,
    quoteId,
    quotedAt: AS_OF,
  };
}

const UNKNOWN_TEMPLATES: Record<
  LiquidityValueSourceId,
  { subject: string; explanation: string }
> = {
  'provider.position.balance': {
    subject: 'Balance of the USD liquidity position',
    explanation:
      'The Liquidity Authority did not return a determinate balance quote for this position in the current snapshot.',
  },
  'provider.position.reserved': {
    subject: 'Reserved amount of the USD liquidity position',
    explanation:
      'The Liquidity Authority did not return a determinate reserved quote for this position in the current snapshot.',
  },
  'provider.position.available': {
    subject: 'Available amount of the USD liquidity position',
    explanation:
      'The Liquidity Authority did not return a determinate available quote for this position in the current snapshot.',
  },
  'provider.credit.limit': {
    subject: 'Limit of the provider settlement credit line',
    explanation:
      'The Credit Authority did not return a determinate limit quote for this credit line in the current snapshot.',
  },
  'provider.credit.utilized': {
    subject: 'Utilized amount of the provider settlement credit line',
    explanation:
      'The Credit Authority did not return a determinate utilized quote for this credit line in the current snapshot.',
  },
  'provider.credit.remaining': {
    subject: 'Remaining amount of the provider settlement credit line',
    explanation:
      'The Credit Authority did not return a determinate remaining quote for this credit line in the current snapshot.',
  },
  'queue.entry.position': {
    subject: 'Queue position of a queued entry',
    explanation:
      'The Liquidity Authority did not return a determinable position for this queued entry in the current snapshot.',
  },
  'queue.snapshot.depth': {
    subject: 'Depth of the queue',
    explanation:
      'The Liquidity Authority did not return a determinate depth quote for this queue in the current snapshot.',
  },
  'oversight.aggregate.total-reserved': {
    subject: 'Total reserved across providers (USD)',
    explanation:
      'The Liquidity Authority did not return a determinate aggregate for this oversight view in the current snapshot.',
  },
  'oversight.aggregate.queue-depth': {
    subject: 'Queued entries across providers',
    explanation:
      'The Liquidity Authority did not return a determinate aggregate for this oversight view in the current snapshot.',
  },
  'oversight.aggregate.credit-utilized': {
    subject: 'Credit utilized across providers (USD)',
    explanation:
      'The Credit Authority did not return a determinate aggregate for this oversight view in the current snapshot.',
  },
};

function reconciliationFor(owner: LiquidityAuthorityOwner) {
  return {
    whoResolves: owner,
    recheckTrigger:
      'Re-open this surface — the authority is re-queried on every load and no value is cached as truth here',
  };
}

function amount(
  overrides: LiquiditySandboxOverrides,
  sourceId: LiquidityValueSourceId,
  value: string,
  owner: LiquidityAuthorityOwner,
  quoteId: string
): LiquidityAmountValue {
  if (overrides.unknownSources.includes(sourceId)) {
    const template = UNKNOWN_TEMPLATES[sourceId];
    const unknown: AuthorityUnknownValue = {
      kind: 'authority-unknown',
      sourceId,
      subject: template.subject,
      explanation: template.explanation,
      reconciliation: reconciliationFor(owner),
    };
    return unknown;
  }
  return quotedAmount(sourceId, value, owner, quoteId);
}

function count(
  overrides: LiquiditySandboxOverrides,
  sourceId: LiquidityValueSourceId,
  value: number,
  owner: LiquidityAuthorityOwner,
  quoteId: string
): LiquidityCountValue {
  if (overrides.unknownSources.includes(sourceId)) {
    const template = UNKNOWN_TEMPLATES[sourceId];
    const unknown: AuthorityUnknownValue = {
      kind: 'authority-unknown',
      sourceId,
      subject: template.subject,
      explanation: template.explanation,
      reconciliation: reconciliationFor(owner),
    };
    return unknown;
  }
  return quotedCount(sourceId, value, owner, quoteId);
}

// --- Provider liquidity position (Liquidity Authority) ---------------------
// NOTE: balance, reserved, and available are three INDEPENDENT quotes in this
// sandbox data. The mock never computes available = balance - reserved.

function buildLiquidityPosition(
  overrides: LiquiditySandboxOverrides
): ProviderLiquidityPosition {
  const evidence: readonly AuthorityEvidenceRef[] = [
    {
      label: 'Position snapshot evidence — settlement reserve hold (track surface)',
      href: '/track/trk-ui007-hold-001',
    },
  ];
  return {
    positionId: 'liq-usd-001',
    asset: 'USD',
    balance: amount(overrides, 'provider.position.balance', '4820.50', 'Liquidity Authority', 'lq-quote-bal-001'),
    reserved: amount(overrides, 'provider.position.reserved', '610.00', 'Liquidity Authority', 'lq-quote-rsv-001'),
    available: amount(overrides, 'provider.position.available', '4210.50', 'Liquidity Authority', 'lq-quote-avl-001'),
    asOf: AS_OF,
    reportedBy: 'Liquidity Authority',
    evidence,
  };
}

// --- Provider credit position (Credit Authority) ----------------------------
// limit, utilized, and remaining are three INDEPENDENT quotes.

function buildCreditPosition(overrides: LiquiditySandboxOverrides): ProviderCreditPosition {
  const evidence: readonly AuthorityEvidenceRef[] = [
    {
      label: 'Credit line utilization evidence (track surface)',
      href: '/track/trk-ui007-credit-001',
    },
  ];
  return {
    positionId: 'crd-line-001',
    scope: 'Provider settlement credit line',
    creditLimit: amount(overrides, 'provider.credit.limit', '10000.00', 'Credit Authority', 'cr-quote-lim-001'),
    utilized: amount(overrides, 'provider.credit.utilized', '2500.00', 'Credit Authority', 'cr-quote-utl-001'),
    remaining: amount(overrides, 'provider.credit.remaining', '7500.00', 'Credit Authority', 'cr-quote-rem-001'),
    asOf: AS_OF_CREDIT,
    reportedBy: 'Credit Authority',
    evidence,
  };
}

// --- Queues (Liquidity Authority) --------------------------------------------
// Queue names and shapes are sandbox stand-ins; the authority defines the
// real queue semantics at ARRIVING runtime.

function waitingSemantics(
  whatIsWaiting: string,
  why: string,
  whatHappensNext: string
): QueueWaitingSemantics {
  return {
    whatIsWaiting,
    why,
    whatHappensNext,
    reportedBy: 'Liquidity Authority',
  };
}

function buildSettlementQueue(overrides: LiquiditySandboxOverrides): QueueSnapshot {
  const entries: QueueEntry[] = [
    {
      entryId: 'qentry-set-001',
      queueId: 'queue-settlement-funding',
      position: count(overrides, 'queue.entry.position', 3, 'Liquidity Authority', 'lq-quote-qp-001'),
      reason: 'Awaiting settlement funding confirmation from the Liquidity Authority',
      enteredAt: '2025-06-13T09:20:00.000Z',
      waiting: waitingSemantics(
        'Settlement funding for one queued settlement',
        'The settlement is queued behind authority-confirmed funding availability',
        'The Liquidity Authority confirms funding and the entry leaves the queue'
      ),
      tracking: { referenceId: 'trk-ui007-settle-001' },
      evidence: [
        {
          label: 'Queued settlement evidence (track surface)',
          href: '/track/trk-ui007-settle-001',
        },
      ],
    },
    {
      entryId: 'qentry-set-002',
      queueId: 'queue-settlement-funding',
      position: count(overrides, 'queue.entry.position', 5, 'Liquidity Authority', 'lq-quote-qp-002'),
      reason: 'Awaiting the next netting window',
      enteredAt: '2025-06-13T15:05:00.000Z',
      waiting: waitingSemantics(
        'Netting window for one queued settlement',
        'The settlement is queued for the next authority-confirmed netting window',
        'The netting window opens, the entry is netted, and it leaves the queue'
      ),
      tracking: { referenceId: 'trk-ui007-settle-002' },
      evidence: [
        {
          label: 'Queued settlement evidence (track surface)',
          href: '/track/trk-ui007-settle-002',
        },
      ],
    },
  ];
  return {
    queueId: 'queue-settlement-funding',
    queueName: 'Settlement funding queue',
    depth: count(overrides, 'queue.snapshot.depth', 7, 'Liquidity Authority', 'lq-quote-qd-001'),
    asOf: AS_OF,
    reportedBy: 'Liquidity Authority',
    entries,
  };
}

function buildWithdrawalQueue(overrides: LiquiditySandboxOverrides): QueueSnapshot {
  const entries: QueueEntry[] = [
    {
      entryId: 'qentry-wdr-001',
      queueId: 'queue-withdrawal',
      position: count(overrides, 'queue.entry.position', 1, 'Liquidity Authority', 'lq-quote-qp-003'),
      reason: 'Withdrawal batch pending authority clearance',
      enteredAt: '2025-06-14T08:40:00.000Z',
      waiting: waitingSemantics(
        'Clearance of one withdrawal batch',
        'The withdrawal batch is queued for authority clearance',
        'The Liquidity Authority clears the batch and the entry leaves the queue'
      ),
      tracking: { referenceId: 'trk-ui007-withdraw-001' },
      evidence: [
        {
          label: 'Queued withdrawal evidence (track surface)',
          href: '/track/trk-ui007-withdraw-001',
        },
      ],
    },
  ];
  return {
    queueId: 'queue-withdrawal',
    queueName: 'Withdrawal queue',
    depth: count(overrides, 'queue.snapshot.depth', 2, 'Liquidity Authority', 'lq-quote-qd-002'),
    asOf: AS_OF,
    reportedBy: 'Liquidity Authority',
    entries,
  };
}

// --- Operator oversight aggregates (authority-quoted, never summed UI-side) --

function buildOversightView(overrides: LiquiditySandboxOverrides): OperatorOversightView {
  const aggregates: OversightAggregate[] = [
    {
      aggregateId: 'ov-total-reserved',
      label: 'Total reserved across providers (USD)',
      value: amount(overrides, 'oversight.aggregate.total-reserved', '18240.00', 'Liquidity Authority', 'lq-agg-rsv-001'),
      reportedBy: 'Liquidity Authority',
      note: 'Aggregate quoted by the Liquidity Authority; never computed or summed by this surface.',
    },
    {
      aggregateId: 'ov-queue-depth',
      label: 'Queued entries across providers (settlement funding queue)',
      value: count(overrides, 'oversight.aggregate.queue-depth', 9, 'Liquidity Authority', 'lq-agg-qd-001'),
      reportedBy: 'Liquidity Authority',
      note: 'Aggregate quoted by the Liquidity Authority; never counted or summed by this surface.',
    },
    {
      aggregateId: 'ov-credit-utilized',
      label: 'Credit utilized across providers (USD)',
      value: amount(overrides, 'oversight.aggregate.credit-utilized', '41200.00', 'Credit Authority', 'cr-agg-utl-001'),
      reportedBy: 'Credit Authority',
      note: 'Aggregate quoted by the Credit Authority; never computed or summed by this surface.',
    },
  ];
  return {
    aggregates,
    asOf: AS_OF,
    scopeNote:
      'Oversight permission covers authority-quoted aggregates only. Provider-identifying positions and per-provider detail are not visible on this surface.',
  };
}

// ---------------------------------------------------------------------------
// The mock port
// ---------------------------------------------------------------------------

const MOCK_BINDING: LiquidityPortBinding = {
  implementation: 'mock-presentation-only',
  runtime: 'ARRIVING',
  authorityOwners: ['Liquidity Authority', 'Credit Authority'],
  authorityReference: 'spec/architecture/v0.1 liquidity-credit-queues.md',
  note:
    'NON-AUTHORITATIVE mock backing. The Liquidity Authority and the Credit Authority own the truth; this mock presents sandbox data only until the authoritative runtime arrives.',
};

function denied(
  surface: LiquiditySurfaceId,
  requester: NavAudience
): LiquidityAccessDenied {
  return {
    kind: 'denied',
    surface,
    requester,
    reason:
      'The owning protocol authorities do not permit the requesting role to view this surface. No data is shown, not even partially.',
  };
}

export function getMockLiquidityPort(overrides: LiquiditySandboxOverrides): LiquidityPort {
  return {
    binding: MOCK_BINDING,
    async getProviderPositions(
      query: ProviderPositionsQuery
    ): Promise<ProviderPositionsResult> {
      if (!isPermitted('provider-positions', query.requester)) {
        return denied('provider-positions', query.requester);
      }
      // Built fresh on every query. Nothing is cached as truth.
      const view: ProviderPositionsView = {
        providerRef: 'prv-sandbox-001',
        liquidity: [buildLiquidityPosition(overrides)],
        credit: [buildCreditPosition(overrides)],
        queues: [buildSettlementQueue(overrides), buildWithdrawalQueue(overrides)],
        asOf: AS_OF,
      };
      return { kind: 'permitted', view };
    },
    async getOperatorOversight(
      query: OperatorOversightQuery
    ): Promise<OperatorOversightResult> {
      if (!isPermitted('operator-oversight', query.requester)) {
        return denied('operator-oversight', query.requester);
      }
      return { kind: 'permitted', view: buildOversightView(overrides) };
    },
  };
}
