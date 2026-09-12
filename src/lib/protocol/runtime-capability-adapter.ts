/**
 * ════════════════════════════════════════════════════════════════════════
 *  UI-011 — RUNTIME CAPABILITY ADAPTER (A03-backed CapabilityPort)
 * ════════════════════════════════════════════════════════════════════════
 *
 * The runtime adapter behind getCapabilityPort() once
 * src/lib/protocol/server-runtime.ts registers it. It implements the
 * FROZEN CapabilityPort interface exactly (read-only — no command kinds)
 * over the composed A03 Capability Authority:
 *
 *   • Every capability item is a REAL CapabilityRecord read via the
 *     authority's own query API (getCapability / snapshot): the runtime's
 *     own state vocabulary (REGISTERED / ACTIVE / DEGRADED / RETIRED),
 *     its declared capacity, its corridor, and its cost schedule.
 *   • The port's five-state presentation axis is DERIVED from the real
 *     A03 vocabulary, never fabricated: REGISTERED → pending (awaiting
 *     activation), ACTIVE → available, DEGRADED → conditional (accepts no
 *     new commitments — the authority's own rule), RETIRED → unavailable
 *     (terminal). 'indeterminate' is never produced: A03 states are
 *     determinate; the runtime's indeterminacy presents through the
 *     availability axis instead.
 *   • The source-availability axis is the adapter's own reachability
 *     observation over the runtime ('reachable' when the runtime answers).
 */

import { CAPABILITY_BOUNDARY_INFO } from './adapter-boundary';
import type {
  CapabilityDescriptor,
  CapabilityItem,
  CapabilityListing,
  CapabilityPort,
  CapabilityQuery,
  CapabilityReport,
  CapabilitySourceRef,
} from './capability-port';
import type { ProtocolRuntimeHandle } from './runtime-handle';
import type { CapabilitySnapshotEntry, Money } from '../protocol-runtime/index.ts';

const SOURCE: CapabilitySourceRef = {
  id: 'a03-capability-authority',
  name: 'Capability Authority (A03) over the composed protocol runtime',
  authority: 'Capability/Routing Authority (spec/architecture/v0.1)',
  availability: 'reachable',
  availabilityDetail: 'The composed A03 Capability Authority answered this read.',
};

const REPORTED_BY = 'Capability Authority (A03) over the composed protocol runtime';

function formatMoney(value: Money): string {
  const sign = value.amountMinor < 0 ? '-' : '';
  const absolute = Math.abs(Math.trunc(value.amountMinor));
  const whole = Math.floor(absolute / 10 ** value.scale);
  const fraction = String(absolute % 10 ** value.scale).padStart(value.scale, '0');
  return `${sign}${whole}.${fraction} ${value.currency}`;
}

function isoOfWall(wallMs: number): string {
  return new Date(wallMs).toISOString();
}

function descriptorFor(entry: CapabilitySnapshotEntry): CapabilityDescriptor {
  const corridor = `${entry.corridor.sourceCurrency}/${entry.corridor.sourceGeography} \u2192 ${entry.corridor.destinationCurrency}/${entry.corridor.destinationGeography}`;
  return {
    id: entry.capabilityId,
    name: `Capability ${entry.capabilityId}`,
    summary: `Rail ${entry.railId} \u00b7 corridor ${corridor} \u00b7 tier ${entry.tier} \u00b7 cost schedule ${formatMoney(entry.costSchedule)} \u00b7 declared capacity ${formatMoney(entry.declaredCapacity)} — as recorded by the Capability Authority.`,
    category: 'payments',
    composition: [
      {
        id: `${entry.capabilityId}.declaration`,
        label: 'Capability declaration',
        description: `The A03 record: rail ${entry.railId}, corridor ${corridor}, cost schedule ${formatMoney(entry.costSchedule)}, tier ${entry.tier}.`,
      },
      {
        id: `${entry.capabilityId}.capacity`,
        label: 'Capacity',
        description: `Declared ${formatMoney(entry.declaredCapacity)}; reserved ${formatMoney(entry.reservedTotal)}; consumed ${formatMoney(entry.consumedTotal)}; available ${formatMoney(entry.availableCapacity)} (INV-3 capacity accounting as the authority reports).`,
      },
    ],
  };
}

function reportFor(entry: CapabilitySnapshotEntry): CapabilityReport {
  switch (entry.state) {
    case 'ACTIVE':
      return {
        capabilityId: entry.capabilityId,
        state: 'available',
        reportedBy: REPORTED_BY,
        reportedAt: isoOfWall(Date.now()),
        evidence: {
          label: `A03 capability record ${entry.capabilityId}`,
          href: `/capabilities/${entry.capabilityId}`,
        },
        source: SOURCE,
      };
    case 'REGISTERED':
      return {
        capabilityId: entry.capabilityId,
        state: 'pending',
        reportedBy: REPORTED_BY,
        reportedAt: isoOfWall(Date.now()),
        whatIsHappening: `The Capability Authority holds ${entry.capabilityId} in REGISTERED — recorded, not yet activated.`,
        whatCompletesIt: `The activation command (capability.activate) transitions the record to ACTIVE; the authority reports the change.`,
        source: SOURCE,
      };
    case 'DEGRADED':
      return {
        capabilityId: entry.capabilityId,
        state: 'conditional',
        reportedBy: REPORTED_BY,
        reportedAt: isoOfWall(Date.now()),
        conditions: [
          {
            id: `${entry.capabilityId}.degraded-no-new-commitments`,
            label: 'No new commitments while degraded',
            detail: 'DEGRADED capabilities accept no new commitments — the authority\u2019s own recorded rule (core.md area 3).',
          },
        ],
        conditionValidity: 'As long as the authority reports the capability DEGRADED.',
        consequenceOfInaction: 'Existing reserved commitments remain valid until released or expired by the area-5 rules, as the authority records.',
        source: SOURCE,
      };
    case 'RETIRED':
      return {
        capabilityId: entry.capabilityId,
        state: 'unavailable',
        reportedBy: REPORTED_BY,
        reportedAt: isoOfWall(Date.now()),
        reason: 'The Capability Authority reports this capability RETIRED — retirement is terminal.',
        nextActions: [
          'A replacement capability is a new registration through the protocol gateway (capability.register)',
        ],
        source: SOURCE,
      };
  }
}

export function createRuntimeCapabilityAdapter(handle: ProtocolRuntimeHandle): CapabilityPort {
  function itemsFor(query?: CapabilityQuery): CapabilityItem[] {
    // The REAL A03 snapshot — the authority's own sequenced view.
    const snapshot = handle.authorities.capability.snapshot();
    return snapshot.capabilities
      .filter((entry) => {
        if (query?.capabilityIds !== undefined && query.capabilityIds.length > 0) {
          return query.capabilityIds.includes(entry.capabilityId);
        }
        return true;
      })
      .filter((entry) => {
        if (query?.categories !== undefined && query.categories.length > 0) {
          return query.categories.includes('payments');
        }
        return true;
      })
      .map((entry) => ({
        descriptor: descriptorFor(entry),
        report: reportFor(entry),
        source: SOURCE,
      }));
  }

  return {
    boundary: CAPABILITY_BOUNDARY_INFO,
    async listCapabilities(query?: CapabilityQuery): Promise<CapabilityListing> {
      return {
        items: itemsFor(query),
        sources: [SOURCE],
        boundary: CAPABILITY_BOUNDARY_INFO,
        generatedAt: new Date().toISOString(),
      };
    },
    async getCapability(capabilityId: string, query?: CapabilityQuery): Promise<CapabilityItem | null> {
      const record = handle.authorities.capability.getCapability(capabilityId);
      if (record === undefined) {
        return null;
      }
      const items = itemsFor(query ?? { capabilityIds: [capabilityId] });
      const found = items.find((item) => item.descriptor.id === capabilityId);
      if (found !== undefined) {
        return found;
      }
      // The record exists but was filtered out by the query: present it
      // with its own report (the authority's record is the truth).
      const snapshot = handle.authorities.capability.snapshot();
      const entry = snapshot.capabilities.find((candidate) => candidate.capabilityId === capabilityId);
      if (entry === undefined) {
        const derived: CapabilitySnapshotEntry = {
          capabilityId: record.capabilityId,
          railId: record.declaration.railId,
          corridor: record.declaration.corridor,
          state: record.state,
          declaredCapacity: record.declaredCapacity,
          reservedTotal: record.reservedTotal,
          consumedTotal: record.consumedTotal,
          availableCapacity: record.declaredCapacity,
          costSchedule: record.declaration.costSchedule,
          tier: record.declaration.tier,
        };
        return { descriptor: descriptorFor(derived), report: reportFor(derived), source: SOURCE };
      }
      return { descriptor: descriptorFor(entry), report: reportFor(entry), source: SOURCE };
    },
  };
}
