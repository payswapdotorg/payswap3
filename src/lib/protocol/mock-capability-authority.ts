/**
 * ════════════════════════════════════════════════════════════════════════
 *  MOCK CAPABILITY AUTHORITY — RETIRED (UI-011) · verification-support shim
 * ════════════════════════════════════════════════════════════════════════
 *
 * UI-011 retired the mock capability authority: the capability port
 * (src/lib/protocol/capability-port.ts) is now backed by the RUNTIME
 * ADAPTER over the composed A03 Capability Authority (src/lib/protocol/
 * runtime-capability-adapter.ts). This module is no longer a port backing
 * and implements NO authority semantics.
 *
 * WHY THIS FILE STILL EXISTS (recorded deviation, stated honestly): the
 * read-only verification surface frozen by UI-004
 * (src/components/verification/capability-flow-harness.tsx) imports this
 * module's availability-scripting API BY PATH, and the work order forbids
 * changing product surfaces. The retained API scripts ONLY the port's
 * SOURCE-AVAILABILITY axis — the adapter-boundary's own reachability
 * observation, deliberately separate from the capability state axis — so
 * the harness can still demonstrate the availability-unknown
 * presentation. It never scripts, fabricates, or overrides any authority
 * state.
 */

import { getCapabilityPort, type CapabilityPort } from './capability-port';
import type { CapabilitySourceAvailability } from './capability-port';

/** Default harness script: every source reachable (no scripting). */
export const MOCK_DEFAULT_SOURCE_AVAILABILITY: Record<string, CapabilitySourceAvailability> = {};

/**
 * Wrap the CURRENT port backing (the runtime adapter when wired; the
 * honest transport-unavailable backing otherwise) with the harness's
 * source-availability overrides — the verification scripting of the
 * boundary's availability axis ONLY. Capability states pass through
 * untouched: they are the A03 authority's own reports.
 */
export function withAvailabilityScript(script: {
  sourceAvailability: Record<string, CapabilitySourceAvailability>;
}): CapabilityPort {
  const base = getCapabilityPort();
  const overrides = script.sourceAvailability;
  return {
    boundary: base.boundary,
    async listCapabilities(query) {
      const listing = await base.listCapabilities(query);
      return {
        ...listing,
        items: listing.items.map((item) => {
          const scripted = overrides[item.source.id];
          if (scripted === undefined) {
            return item;
          }
          return {
            ...item,
            source: {
              ...item.source,
              availability: scripted,
              availabilityDetail:
                scripted === 'unreachable'
                  ? 'Scripted availability for verification: the harness marked this source unreachable, so no authoritative record renders — availability unknown, never an outcome (P4/P5).'
                  : `Scripted availability for verification: the harness marked this source ${scripted}.`,
            },
            // An unreachable source yields no report at all (the port's
            // contract: report is absent exactly when the source is
            // unavailable).
            report: scripted === 'unreachable' ? null : item.report,
          };
        }),
        sources: listing.sources.map((source) => {
          const scripted = overrides[source.id];
          if (scripted === undefined) {
            return source;
          }
          return {
            ...source,
            availability: scripted,
            availabilityDetail:
              scripted === 'unreachable'
                ? 'Scripted availability for verification: the harness marked this source unreachable — availability unknown.'
                : `Scripted availability for verification: ${scripted}.`,
          };
        }),
      };
    },
    async getCapability(capabilityId, query) {
      const item = await base.getCapability(capabilityId, query);
      if (item === null) {
        return null;
      }
      const scripted = overrides[item.source.id];
      if (scripted === undefined) {
        return item;
      }
      return {
        ...item,
        source: {
          ...item.source,
          availability: scripted,
          availabilityDetail:
            scripted === 'unreachable'
              ? 'Scripted availability for verification: the harness marked this source unreachable, so no authoritative record renders — availability unknown, never an outcome (P4/P5).'
              : `Scripted availability for verification: ${scripted}.`,
        },
        report: scripted === 'unreachable' ? null : item.report,
      };
    },
  };
}
