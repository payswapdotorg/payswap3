/**
 * PC-003 — Capabilities read model.
 *
 * Thin server-side composition over the EXISTING provider capability read
 * path — the same boundary the product provider capabilities surface uses:
 *   - list: getCapabilityPort().listCapabilities()
 *   (src/lib/protocol/capability-port.ts — the runtime adapter reading the
 *   A03 Capability Authority's own query API over the composed runtime).
 *
 * Display resolution reuses the FROZEN product mapping:
 * resolveCapabilityDisplayState (src/lib/protocol/capability-state-mapping.ts)
 * — TWO AXES are kept exactly as the authority reports them:
 *   - the capability state axis (available | unavailable | conditional |
 *     pending | indeterminate);
 *   - the source-availability axis (reachable | degraded | unreachable).
 * Availability-unknown (report:null or an unreachable source) is the absence
 * of an answer → the console status UNKNOWN — never an outcome, never an
 * authoritative empty registry (design §13: availability is never inferred
 * from configuration).
 *
 * The A03 snapshot the adapter returns IS the authority's own sequenced view,
 * so a returned listing is always the authoritative answer — including an
 * empty items array, which is the registry's real content (this port's
 * contract has no no-answer member for the listing; the transport-unavailable
 * BACKING — browser contexts — is what answers no-answer, and on the server
 * the route's ensureProductPortsWired() rules it out). A thrown port call is
 * the only transport path → the UNAVAILABLE branch via
 * consoleTransportFailure.
 *
 * Role scoping: module-level only — console.capabilities is provider-only in
 * the frozen route-role matrix (mirroring the product /capabilities surface
 * audiences); the port exposes no further per-role read filter.
 */

import { getCapabilityPort } from '@/lib/protocol/capability-port';
import type { CapabilityItem, CapabilityListing } from '@/lib/protocol/capability-port';
import { resolveCapabilityDisplayState } from '@/lib/protocol/capability-state-mapping';
import { consoleTransportFailure, consoleValue } from '../dto';
import type { ConsoleReadResult, ConsoleStatus } from '../types';
import { consoleSourceMetadata } from '../authority/sources';

// ── DTOs ───────────────────────────────────────────────────────────────────

/** One capability exactly as the capability authority reports it. */
export interface ConsoleCapabilityDto {
  readonly capabilityId: string;
  readonly name: string;
  readonly category: string;
  /** The A03 capability state, verbatim (present iff a report exists). */
  readonly authorityState?: string;
  /** The source-availability axis, verbatim (reachable | degraded | unreachable). */
  readonly sourceAvailability: string;
  /** The frozen display resolution (one of the six; availability-unknown ⇒ UNKNOWN). */
  readonly displayStatus: ConsoleStatus;
  /** The CAP-MAP-XXX nine-question record id (evidence trail). */
  readonly mappingRecord: string;
  readonly reportedBy?: string;
  readonly reportedAt?: string;
  /** Reachable evidence reference when the authority provided one. */
  readonly evidence?: { readonly label: string; readonly href: string };
}

/** The capabilities read value (the authority's own sequenced registry view). */
export interface ConsoleCapabilitiesDto {
  readonly capabilities: readonly ConsoleCapabilityDto[];
  /** The port's boundary facts, verbatim (runtime/backing/authoritative/owner). */
  readonly boundary: {
    readonly runtime: string;
    readonly backing: string;
    readonly authoritative: boolean;
    readonly authorityOwner: string;
    readonly notes: string;
  };
  /** ISO-8601, port-quoted. */
  readonly generatedAt: string;
}

// ── Display mapping (frozen product mapping → six-status vocabulary) ───────

/** Map the frozen capability display kinds onto the six console statuses. */
export function capabilityDisplayStatus(item: CapabilityItem): ConsoleStatus {
  const display = resolveCapabilityDisplayState(item);
  switch (display.kind) {
    case 'succeeded':
      return 'SUCCEEDED';
    case 'failed':
      return 'FAILED';
    case 'action-required':
      return 'ACTION_REQUIRED';
    case 'in-progress':
      return 'IN_PROGRESS';
    case 'unknown':
    case 'availability-unknown':
      return 'UNKNOWN';
  }
}

/** The CAP-MAP-XXX record id for the item (frozen mapping evidence). */
export function capabilityMappingRecord(item: CapabilityItem): string {
  return resolveCapabilityDisplayState(item).recordId;
}

// ── Read ───────────────────────────────────────────────────────────────────

/** Normalize one port item into the console DTO (pure presentation). */
function capabilityDto(item: CapabilityItem): ConsoleCapabilityDto {
  const { descriptor, report, source } = item;
  const base: ConsoleCapabilityDto = {
    capabilityId: descriptor.id,
    name: descriptor.name,
    category: descriptor.category,
    // The source-availability axis, verbatim — a present report with an
    // unreachable source is STILL availability-unknown per the frozen
    // mapping (the source axis wins).
    sourceAvailability: source.availability,
    displayStatus: capabilityDisplayStatus(item),
    mappingRecord: capabilityMappingRecord(item),
  };
  if (report === null || report === undefined) {
    // No authoritative report: availability-unknown — nothing else to carry.
    return base;
  }
  return {
    ...base,
    authorityState: report.state,
    reportedBy: report.reportedBy,
    reportedAt: report.reportedAt,
    ...(report.evidence === undefined
      ? {}
      : { evidence: { label: report.evidence.label, href: report.evidence.href } }),
  };
}

/**
 * Read the capability listing. The listing is always the A03 authority's own
 * answer (an empty registry is the registry's real content — a VALUE); only a
 * thrown port call lands in the UNAVAILABLE (UNKNOWN) branch. Per-item
 * availability-unknown (report:null / unreachable source) is preserved as the
 * item's UNKNOWN status — never an outcome.
 */
export async function readConsoleCapabilities(): Promise<ConsoleReadResult<ConsoleCapabilitiesDto>> {
  const authority = consoleSourceMetadata('capabilities');
  const port = getCapabilityPort();
  let listing: CapabilityListing;
  try {
    listing = await port.listCapabilities();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return consoleTransportFailure(
      authority,
      `The capabilities read could not reach its owning authority (${detail}).`,
    );
  }
  return consoleValue(
    {
      capabilities: listing.items.map(capabilityDto),
      boundary: {
        runtime: listing.boundary.runtime,
        backing: listing.boundary.backing,
        authoritative: listing.boundary.authoritative,
        authorityOwner: listing.boundary.authorityOwner,
        notes: listing.boundary.notes,
      },
      generatedAt: listing.generatedAt,
    },
    'SUCCEEDED',
    authority,
  );
}
