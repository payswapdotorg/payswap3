/**
 * UI-004 — Capability port (adapter boundary).
 *
 * This module declares the data needs of the provider capability surface as
 * typed interfaces plus a port accessor, following the UI-002 adapter-boundary
 * precedent (src/lib/protocol/intent-port.ts). It owns NO protocol semantics:
 * every capability, eligibility, or routing truth expressed through these
 * shapes is owned by the Capability/Routing Authority per
 * spec/architecture/v0.1.
 *
 * RE-ANCHORED (UI-011): the backing is the RUNTIME ADAPTER over the
 * composed protocol runtime (src/lib/protocol/
 * runtime-capability-adapter.ts): every capability report is read from the
 * A03 Capability Authority's own query API (REGISTERED / ACTIVE / DEGRADED /
 * RETIRED, declared capacity, corridors, cost schedules). The port is
 * read-only — no command kinds. The surface never computes a capability,
 * eligibility, or routing decision; it presents what the port reports,
 * including explicit UNKNOWN shapes when the truth cannot be
 * authoritatively determined.
 */

import { getUnavailableCapabilityPort } from "./unavailable-backing";

// ---------------------------------------------------------------------------
// Capability state vocabulary — owned by the Capability/Routing Authority.
// ---------------------------------------------------------------------------

/** Definitive and indeterminate capability states as reported by the authority. */
export const CAPABILITY_STATES = [
  "available",
  "unavailable",
  "conditional",
  "pending",
  "indeterminate",
] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

/**
 * Availability of an authoritative source, as observed at the boundary.
 * This axis is deliberately separate from the capability state axis:
 * an unavailable source never produces an outcome — it produces
 * availability-unknown.
 */
export const CAPABILITY_SOURCE_AVAILABILITY = [
  "reachable",
  "degraded",
  "unreachable",
] as const;
export type CapabilitySourceAvailability =
  (typeof CAPABILITY_SOURCE_AVAILABILITY)[number];

export const CAPABILITY_CATEGORIES = [
  "payments",
  "settlement",
  "routing",
  "operations",
] as const;
export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number];

/**
 * Money as quoted by an authority. Presentation-only: the surface formats it
 * with its explicit currency (src/lib/pay-flow/money.ts) and never computes,
 * converts, or derives amounts UI-side.
 */
export interface CapabilityMoney {
  readonly amount: string;
  readonly currency: string;
}

/** A reference to the authoritative source that reports capability truth. */
export interface CapabilitySourceRef {
  readonly id: string;
  readonly name: string;
  /** The protocol authority that owns the source, e.g. the Capability/Routing Authority. */
  readonly authority: string;
  readonly availability: CapabilitySourceAvailability;
  readonly availabilityDetail?: string;
  /** Authority-side record anchor, when the source is reachable. */
  readonly recordHref?: string;
}

/** An authority-stated condition under which a conditional capability holds. */
export interface CapabilityCondition {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  /** Authority-quoted monetary threshold, if the condition carries one. */
  readonly threshold?: CapabilityMoney;
}

/** How an indeterminate capability becomes determinate again. */
export interface CapabilityReconciliation {
  readonly whoResolves: string;
  readonly recheckTrigger: string;
}

export interface CapabilityEvidence {
  readonly label: string;
  readonly href: string;
}

/**
 * The authoritative report for one capability, as owned by the reporting
 * source. Field presence follows the reported state:
 * - available: evidence
 * - unavailable: reason, nextActions
 * - conditional: conditions, conditionValidity, consequenceOfInaction
 * - pending: whatIsHappening, whatCompletesIt
 * - indeterminate: reason, reconciliation
 */
export interface CapabilityReport {
  readonly capabilityId: string;
  readonly state: CapabilityState;
  readonly reportedBy: string;
  readonly reportedAt: string;
  readonly reason?: string;
  readonly conditions?: readonly CapabilityCondition[];
  readonly conditionValidity?: string;
  readonly consequenceOfInaction?: string;
  readonly whatIsHappening?: string;
  readonly whatCompletesIt?: string;
  readonly reconciliation?: CapabilityReconciliation;
  readonly nextActions?: readonly string[];
  readonly evidence?: CapabilityEvidence;
  readonly source: CapabilitySourceRef;
}

/** What a capability is composed of, as stated by the capability registry. */
export interface CapabilityCompositionPart {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Another capability this part depends on, if any. */
  readonly dependsOnCapabilityId?: string;
}

export interface CapabilityDescriptor {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly category: CapabilityCategory;
  readonly composition: readonly CapabilityCompositionPart[];
}

/**
 * One capability as the boundary presents it: the registry descriptor (what
 * it is) and the authoritative report (what state it is in), when a report
 * exists. `report` is absent exactly when the reporting source is
 * unavailable — the capability state then cannot be authoritatively
 * determined and the surface must render availability-unknown, never an
 * outcome.
 */
export interface CapabilityItem {
  readonly descriptor: CapabilityDescriptor;
  readonly report: CapabilityReport | null;
  readonly source: CapabilitySourceRef;
}

/** Adapter-boundary status, surfaced with every listing. */
export interface CapabilityBoundaryInfo {
  /** ARRIVING until the protocol adapter that binds the real authority lands. */
  readonly runtime: "ARRIVING" | "LIVE";
  readonly authorityOwner: string;
  readonly backing: "mock" | "protocol-adapter";
  /** False while the backing is the presentation-only mock. */
  readonly authoritative: boolean;
  readonly notes: string;
}

export interface CapabilityListing {
  readonly items: readonly CapabilityItem[];
  readonly sources: readonly CapabilitySourceRef[];
  readonly boundary: CapabilityBoundaryInfo;
  readonly generatedAt: string;
}

/** Query shape for listing capabilities. */
export interface CapabilityQuery {
  readonly categories?: readonly CapabilityCategory[];
  readonly capabilityIds?: readonly string[];
}

export interface CapabilityPort {
  readonly boundary: CapabilityBoundaryInfo;
  listCapabilities(query?: CapabilityQuery): Promise<CapabilityListing>;
  /**
   * Resolves a single capability by id. Returns null when the id is unknown
   * to the registry. An item whose reporting source is unavailable is
   * returned with `report: null` (availability unknown), not as null.
   */
  getCapability(
    capabilityId: string,
    query?: CapabilityQuery,
  ): Promise<CapabilityItem | null>;
}

/**
 * The registered runtime-adapter backing (set once per server process by
 * src/lib/protocol/server-runtime.ts); in a browser context no adapter is
 * registered and the honest transport-unavailable backing answers.
 */
let registeredBacking: CapabilityPort | undefined;

/** UI-011 seam: register the server-side runtime adapter as this port's backing. */
export function registerCapabilityPortBacking(backing: CapabilityPort): void {
  registeredBacking = backing;
}

/**
 * Port accessor for the provider capability surface. Since UI-011 it returns
 * the registered RUNTIME ADAPTER (A03 reads over the composed runtime);
 * when no adapter is registered in this context (browser), it returns the
 * honest transport-unavailable backing. The surface and its mapping records
 * did not change.
 */
export function getCapabilityPort(): CapabilityPort {
  return registeredBacking ?? getUnavailableCapabilityPort();
}
