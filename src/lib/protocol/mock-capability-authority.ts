/**
 * UI-004 — Mock capability authority.
 *
 * NON-AUTHORITATIVE, presentation-only mock backing for the capability port
 * (src/lib/protocol/capability-port.ts). The owner of this surface's truth is
 * the Capability/Routing Authority per spec/architecture/v0.1; the protocol
 * adapter that binds to the real authority has not arrived, so this module's
 * runtime is ARRIVING. Everything below is sandbox fixture data whose only
 * job is to let the provider capability surface present every authoritative
 * shape — including UNKNOWN shapes — while the real authority lands.
 *
 * This module decides nothing. It replays fixture truth, including fixture
 * unavailability of authoritative sources (the Corridor Directory fixture is
 * unreachable by default so the live surface demonstrates availability
 * unknown). It exposes no mutating API: nothing on the provider surface can
 * change any state through it.
 *
 * For the verification harness only, `withAvailabilityScript` derives a
 * scripted port whose sources are reachable, degraded (partial data →
 * indeterminate), or unreachable (→ availability unknown). The live surface
 * always consumes the unscripted `mockCapabilityAuthority`.
 */
import type {
  CapabilityBoundaryInfo,
  CapabilityDescriptor,
  CapabilityItem,
  CapabilityListing,
  CapabilityPort,
  CapabilityQuery,
  CapabilityReport,
  CapabilitySourceAvailability,
  CapabilitySourceRef,
} from "./capability-port";

export const CAPABILITY_AUTHORITY_OWNER =
  "Capability/Routing Authority (spec/architecture/v0.1)";

/** Sandbox-only script for the verification harness. */
export interface CapabilityAvailabilityScript {
  /** Overrides fixture source availability, e.g. { "corridor-directory": "reachable" }. */
  readonly sourceAvailability?: Readonly<
    Record<string, CapabilitySourceAvailability>
  >;
}

export const MOCK_BOUNDARY: CapabilityBoundaryInfo = {
  runtime: "ARRIVING",
  authorityOwner: CAPABILITY_AUTHORITY_OWNER,
  backing: "mock",
  authoritative: false,
  notes:
    "NON-AUTHORITATIVE mock — presentation-only sandbox fixtures. No capability, eligibility, or routing decision is made or implied by this backing.",
};

/**
 * Fixture availability of the authoritative sources. The Corridor Directory is
 * unreachable by default so the unscripted live surface carries one genuine
 * availability-unknown presentation.
 */
export const MOCK_DEFAULT_SOURCE_AVAILABILITY: Readonly<
  Record<string, CapabilitySourceAvailability>
> = {
  "capability-registry": "reachable",
  "routing-table": "reachable",
  "corridor-directory": "unreachable",
};

interface SourceFixture {
  readonly id: string;
  readonly name: string;
  readonly authority: string;
  readonly recordHref: string;
  readonly defaultAvailability: CapabilitySourceAvailability;
  readonly defaultAvailabilityDetail?: string;
}

const SOURCE_FIXTURES: readonly SourceFixture[] = [
  {
    id: "capability-registry",
    name: "Capability Registry",
    authority: CAPABILITY_AUTHORITY_OWNER,
    recordHref: "https://spec.payswap.org/architecture/v0.1#capability-registry",
    defaultAvailability: "reachable",
  },
  {
    id: "routing-table",
    name: "Routing Table",
    authority: CAPABILITY_AUTHORITY_OWNER,
    recordHref: "https://spec.payswap.org/architecture/v0.1#routing-table",
    defaultAvailability: "reachable",
  },
  {
    id: "corridor-directory",
    name: "Corridor Directory",
    authority: CAPABILITY_AUTHORITY_OWNER,
    recordHref: "https://spec.payswap.org/architecture/v0.1#corridor-directory",
    defaultAvailability: "unreachable",
    defaultAvailabilityDetail:
      "The Corridor Directory is not returning authoritative records in this sandbox; corridor-dependent capability states cannot be determined here.",
  },
];

const DESCRIPTORS: readonly CapabilityDescriptor[] = [
  {
    id: "intent-acceptance",
    name: "Intent acceptance",
    summary:
      "Receiving and accepting payment intents routed by the protocol, as registered for providers.",
    category: "payments",
    composition: [
      {
        id: "intent-reception",
        label: "Intent reception",
        description:
          "Receiving payment intents routed by the protocol to the provider.",
      },
      {
        id: "intent-validation",
        label: "Intent validation",
        description:
          "Authority-side validation of intent shape and signature before acceptance.",
        dependsOnCapabilityId: "routing-participation",
      },
      {
        id: "acceptance-confirmation",
        label: "Acceptance confirmation",
        description:
          "Publishing the acceptance record that settles the intent outcome.",
      },
    ],
  },
  {
    id: "settlement-batch",
    name: "Batch settlement",
    summary:
      "Participation in the protocol batch settlement rail for accepted intents.",
    category: "settlement",
    composition: [
      {
        id: "settlement-batching",
        label: "Settlement batching",
        description:
          "Grouping accepted intents into settlement batches as scheduled by the authority.",
      },
      {
        id: "settlement-finalization",
        label: "Settlement finalization",
        description:
          "Authority-issued finalization of each batch on the settlement rail.",
      },
    ],
  },
  {
    id: "instant-payout",
    name: "Instant payout",
    summary:
      "Payout of settled funds on the instant rail, subject to authority-stated conditions.",
    category: "settlement",
    composition: [
      {
        id: "instant-rail-participation",
        label: "Instant rail participation",
        description:
          "Participation in the instant payout rail operated under the authority.",
      },
      {
        id: "payout-issuance",
        label: "Payout issuance",
        description:
          "Issuing an instant payout against settled funds when the stated conditions hold.",
        dependsOnCapabilityId: "settlement-batch",
      },
    ],
  },
  {
    id: "fx-conversion",
    name: "FX conversion",
    summary:
      "Currency conversion executed by authorized FX counterparties on quoted corridors.",
    category: "payments",
    composition: [
      {
        id: "fx-counterparty-coverage",
        label: "FX counterparty coverage",
        description:
          "An authorized FX counterparty covering the corridors quoted by the Routing Table.",
      },
      {
        id: "fx-execution",
        label: "FX execution",
        description:
          "Execution of the conversion against the authorized counterparty.",
      },
    ],
  },
  {
    id: "refund-issuance",
    name: "Refund issuance",
    summary:
      "Issuing refunds for accepted intents, pending the authority re-evaluation in progress.",
    category: "operations",
    composition: [
      {
        id: "refund-validation",
        label: "Refund validation",
        description:
          "Authority-side validation of refund requests against the intent record.",
      },
      {
        id: "refund-settlement",
        label: "Refund settlement",
        description:
          "Settling the refunded amount back through the settlement rail.",
        dependsOnCapabilityId: "settlement-batch",
      },
    ],
  },
  {
    id: "routing-participation",
    name: "Routing participation",
    summary:
      "Eligibility of the provider to be selected by protocol routing, currently indeterminate.",
    category: "routing",
    composition: [
      {
        id: "directory-reconciliation",
        label: "Directory reconciliation",
        description:
          "The reconciliation the Routing Table runs before it can state participation.",
      },
      {
        id: "routing-selection",
        label: "Routing selection",
        description:
          "Selection of the provider by protocol routing once participation is stated.",
      },
    ],
  },
  {
    id: "cross-border-settlement",
    name: "Cross-border settlement",
    summary:
      "Settlement across corridors listed in the Corridor Directory; state requires the directory.",
    category: "settlement",
    composition: [
      {
        id: "corridor-listing",
        label: "Corridor listing",
        description:
          "The cross-border corridor must be listed by the Corridor Directory.",
      },
      {
        id: "corridor-settlement-rail",
        label: "Corridor settlement rail",
        description:
          "The settlement rail the authority binds to the listed corridor.",
      },
    ],
  },
  {
    id: "dispute-handling",
    name: "Dispute handling",
    summary:
      "Handling disputes raised against accepted intents, as registered for providers.",
    category: "operations",
    composition: [
      {
        id: "dispute-reception",
        label: "Dispute reception",
        description:
          "Receiving disputes routed by the protocol against accepted intents.",
      },
      {
        id: "dispute-response",
        label: "Dispute response",
        description:
          "Publishing the provider response within the authority-stated window.",
      },
    ],
  },
];

interface ReportFixture {
  readonly capabilityId: string;
  readonly sourceId: string;
  readonly state: CapabilityReport["state"];
  readonly reportedBy: string;
  readonly reportedAt: string;
  readonly reason?: string;
  readonly conditions?: NonNullable<CapabilityReport["conditions"]>;
  readonly conditionValidity?: string;
  readonly consequenceOfInaction?: string;
  readonly whatIsHappening?: string;
  readonly whatCompletesIt?: string;
  readonly reconciliation?: CapabilityReport["reconciliation"];
  readonly nextActions?: readonly string[];
  readonly evidence?: CapabilityReport["evidence"];
}

const REPORT_FIXTURES: readonly ReportFixture[] = [
  {
    capabilityId: "intent-acceptance",
    sourceId: "capability-registry",
    state: "available",
    reportedBy: "Capability Registry",
    reportedAt: "2025-11-18T09:41:00.000Z",
    evidence: {
      label: "Capability Registry record — intent acceptance",
      href: "https://spec.payswap.org/architecture/v0.1#capability-intent-acceptance",
    },
  },
  {
    capabilityId: "settlement-batch",
    sourceId: "capability-registry",
    state: "available",
    reportedBy: "Capability Registry",
    reportedAt: "2025-11-18T09:41:00.000Z",
    evidence: {
      label: "Capability Registry record — batch settlement",
      href: "https://spec.payswap.org/architecture/v0.1#capability-settlement-batch",
    },
  },
  {
    capabilityId: "dispute-handling",
    sourceId: "capability-registry",
    state: "available",
    reportedBy: "Capability Registry",
    reportedAt: "2025-11-18T09:41:00.000Z",
    evidence: {
      label: "Capability Registry record — dispute handling",
      href: "https://spec.payswap.org/architecture/v0.1#capability-dispute-handling",
    },
  },
  {
    capabilityId: "instant-payout",
    sourceId: "capability-registry",
    state: "conditional",
    reportedBy: "Capability Registry",
    reportedAt: "2025-11-18T09:41:00.000Z",
    conditions: [
      {
        id: "instant-payout-balance-threshold",
        label:
          "Settlement balance held on the settlement rail is at or above the authority-quoted threshold.",
        detail:
          "The threshold is re-quoted by the authority per settlement epoch.",
        threshold: { amount: "1000.00", currency: "USD" },
      },
      {
        id: "instant-payout-corridor-listing",
        label:
          "The payout corridor is listed as instant-enabled in the Routing Table.",
        detail: "Corridor eligibility is authority-owned routing truth.",
      },
      {
        id: "instant-payout-addendum",
        label: "The instant payout addendum is in force for the provider.",
      },
    ],
    conditionValidity:
      "Conditions are re-evaluated whenever the Routing Table publishes a new epoch.",
    consequenceOfInaction:
      "The capability stays dormant; payouts continue on the batch rail.",
  },
  {
    capabilityId: "fx-conversion",
    sourceId: "capability-registry",
    state: "unavailable",
    reportedBy: "Capability Registry",
    reportedAt: "2025-11-18T09:41:00.000Z",
    reason:
      "No authorized FX counterparty covers the corridors currently quoted by the Routing Table.",
    nextActions: [
      "Monitor the Routing Table for FX counterparty activation.",
      "Request corridor re-evaluation through the protocol governance flow.",
    ],
  },
  {
    capabilityId: "refund-issuance",
    sourceId: "capability-registry",
    state: "pending",
    reportedBy: "Capability Registry",
    reportedAt: "2025-11-18T09:41:00.000Z",
    whatIsHappening:
      "The Capability/Routing Authority is re-evaluating the refund rails following the v0.1 amendment.",
    whatCompletesIt:
      "The authority publishes the re-evaluated refund capability record.",
  },
  {
    capabilityId: "routing-participation",
    sourceId: "routing-table",
    state: "indeterminate",
    reportedBy: "Routing Table",
    reportedAt: "2025-11-18T09:41:00.000Z",
    reason:
      "Routing participation depends on the directory reconciliation currently in progress at the Routing Table; the authority cannot determine participation yet.",
    reconciliation: {
      whoResolves: "Capability/Routing Authority — Routing Table",
      recheckTrigger:
        "Re-check when the Routing Table publishes its next epoch.",
    },
  },
];

const GENERATED_AT = "2025-11-18T09:41:00.000Z";

const SOURCE_BY_ID: Readonly<Record<string, SourceFixture>> =
  Object.fromEntries(SOURCE_FIXTURES.map((source) => [source.id, source]));

const REPORT_BY_CAPABILITY_ID: Readonly<Record<string, ReportFixture>> =
  Object.fromEntries(
    REPORT_FIXTURES.map((report) => [report.capabilityId, report]),
  );

const DESCRIPTOR_BY_ID: Readonly<Record<string, CapabilityDescriptor>> =
  Object.fromEntries(DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]));

function buildSources(
  script?: CapabilityAvailabilityScript,
): Readonly<Record<string, CapabilitySourceRef>> {
  const overrides = script?.sourceAvailability ?? {};
  return Object.fromEntries(
    SOURCE_FIXTURES.map((fixture) => {
      const availability: CapabilitySourceAvailability =
        overrides[fixture.id] ?? fixture.defaultAvailability;
      const availabilityDetail =
        availability === fixture.defaultAvailability
          ? fixture.defaultAvailabilityDetail
          : availability === "unreachable"
            ? "Fixture: the source is not returning authoritative records (scripted)."
            : availability === "degraded"
              ? "Fixture: the source is returning partial records (scripted)."
              : undefined;
      return [
        fixture.id,
        {
          id: fixture.id,
          name: fixture.name,
          authority: fixture.authority,
          availability,
          availabilityDetail,
          recordHref: availability === "reachable" ? fixture.recordHref : undefined,
        } satisfies CapabilitySourceRef,
      ];
    }),
  );
}

/**
 * Degraded sources return partial data: the authority cannot determine the
 * affected capabilities from what it received, so the report becomes
 * indeterminate — never unavailable, never available.
 */
function degradeReport(
  fixture: ReportFixture,
  source: CapabilitySourceRef,
): CapabilityReport {
  return {
    capabilityId: fixture.capabilityId,
    state: "indeterminate",
    reportedBy: fixture.reportedBy,
    reportedAt: fixture.reportedAt,
    reason: `The reporting source is degraded and returned partial data; the authority cannot determine this capability from the data received.`,
    reconciliation: {
      whoResolves: `${source.authority} — ${source.name}`,
      recheckTrigger: "Re-check when the source returns complete records.",
    },
    source,
  };
}

function buildReport(
  fixture: ReportFixture,
  source: CapabilitySourceRef,
): CapabilityReport | null {
  if (source.availability === "unreachable") {
    // The boundary has no authoritative report to present: availability
    // unknown, never an outcome.
    return null;
  }
  if (source.availability === "degraded") {
    return degradeReport(fixture, source);
  }
  return { ...fixture, source };
}

function buildItem(
  descriptor: CapabilityDescriptor,
  sources: Readonly<Record<string, CapabilitySourceRef>>,
): CapabilityItem {
  const fixture = REPORT_BY_CAPABILITY_ID[descriptor.id];
  const sourceId = fixture?.sourceId ?? "capability-registry";
  const source = sources[sourceId] ?? sources["capability-registry"];
  const report = fixture ? buildReport(fixture, source) : null;
  return { descriptor, report, source };
}

function appliesTo(descriptor: CapabilityDescriptor, query?: CapabilityQuery): boolean {
  if (!query) return true;
  if (query.categories && query.categories.length > 0) {
    if (!query.categories.includes(descriptor.category)) return false;
  }
  if (query.capabilityIds && query.capabilityIds.length > 0) {
    if (!query.capabilityIds.includes(descriptor.id)) return false;
  }
  return true;
}

async function listCapabilities(
  query?: CapabilityQuery,
  script?: CapabilityAvailabilityScript,
): Promise<CapabilityListing> {
  const sources = buildSources(script);
  const registry = sources["capability-registry"];
  // Descriptors are enumerated by the Capability Registry; while it is
  // unreachable, even the set of capabilities cannot be authoritatively
  // determined, so no items are presented.
  const items =
    registry.availability === "unreachable"
      ? []
      : DESCRIPTORS.filter((descriptor) => appliesTo(descriptor, query)).map(
          (descriptor) => buildItem(descriptor, sources),
        );
  return {
    items,
    sources: SOURCE_FIXTURES.map((fixture) => sources[fixture.id]),
    boundary: MOCK_BOUNDARY,
    generatedAt: GENERATED_AT,
  };
}

async function getCapability(
  capabilityId: string,
  query?: CapabilityQuery,
  script?: CapabilityAvailabilityScript,
): Promise<CapabilityItem | null> {
  const descriptor = DESCRIPTOR_BY_ID[capabilityId];
  if (!descriptor || !appliesTo(descriptor, query)) {
    return null;
  }
  const sources = buildSources(script);
  return buildItem(descriptor, sources);
}

export const mockCapabilityAuthority: CapabilityPort = {
  boundary: MOCK_BOUNDARY,
  listCapabilities: (query?: CapabilityQuery) => listCapabilities(query),
  getCapability: (capabilityId: string, query?: CapabilityQuery) =>
    getCapability(capabilityId, query),
};

/**
 * Derives a scripted port for the verification harness. Scripting changes
 * only what the mock authority returns to the harness; the live provider
 * surface consumes the unscripted `mockCapabilityAuthority`.
 */
export function withAvailabilityScript(
  script: CapabilityAvailabilityScript,
): CapabilityPort {
  return {
    boundary: MOCK_BOUNDARY,
    listCapabilities: (query?: CapabilityQuery) => listCapabilities(query, script),
    getCapability: (capabilityId: string, query?: CapabilityQuery) =>
      getCapability(capabilityId, query, script),
  };
}
