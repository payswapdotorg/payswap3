import type { NavAudience } from "@/lib/navigation";
import { getMockTrackingAuthority } from "./mock-tracking-authority";

/**
 * UI-005 — Track, status, and evidence surface.
 * The typed adapter-boundary port (the UI-002 intent-port precedent applied
 * to tracking).
 *
 * This module declares, in types, everything the tracking surfaces need from
 * the protocol side. It declares NO protocol semantics of its own: every
 * state, wording, timestamp, and evidence record below is shaped here and
 * ANSWERED by the authority behind the port. The only backing at runtime is
 * the presentation-only mock in ./mock-tracking-authority.ts — explicitly
 * NON-AUTHORITATIVE, with the real owners named below. When the live
 * tracking adapter lands, it is swapped in at getTrackingPort() and ONLY
 * there; no surface or component changes.
 *
 * Authority owner (per spec/architecture/v0.1): the Intent Authority (tracked
 * consequential states + plain-language history) and the Evidence Authority
 * (proof-trail records). This port is a read-only projection of their
 * answers; it never decides, computes, or synthesizes.
 *
 * P4 rule encoded in the vocabulary: a tracked current state is exactly one
 * of the six explicit display states. There is no "pending" — the union
 * below cannot express it. "Pending-like" protocol conditions arrive here
 * as WAITING (with reason, expectation, and actions-or-none) or UNKNOWN
 * (with reconciliation), never as an ambiguous in-between.
 */

/**
 * The closed tracked-state vocabulary — one-to-one with the shared state
 * primitives (P4). 'pending' deliberately cannot be expressed.
 */
export const TRACKED_STATE_KINDS = [
  "succeeded",
  "failed",
  "in-progress",
  "waiting",
  "unknown",
  "action-required",
] as const;

export type TrackedStateKind = (typeof TRACKED_STATE_KINDS)[number];

/** The protocol object a tracked state attaches to (never synthesized UI-side). */
export interface ProtocolObjectRef {
  readonly objectType: string;
  readonly objectId: string;
}

/** Shared metadata every tracked current state carries (P7: mapped + owned). */
export interface TrackedStateMeta {
  /** The protocol object this state belongs to. */
  readonly protocolObject: ProtocolObjectRef;
  /** The authority that owns and answers for this state. */
  readonly owningAuthority: string;
  /** ISO timestamp of when the authority established this state. */
  readonly since: string;
}

/**
 * A tracked consequential current state, as answered by the authority.
 * Each variant carries exactly the fields its shared primitive renders —
 * the mapping in ./tracking-state-mapping.ts is one-to-one by construction.
 */
export type TrackedCurrentState = (
  | {
      readonly state: "succeeded";
      readonly outcome: string;
      readonly reportedBy: string;
      readonly evidence: { readonly label: string; readonly href: string };
    }
  | {
      readonly state: "failed";
      readonly outcome: string;
      readonly reportedBy: string;
      readonly reason?: string;
      readonly nextActions?: readonly string[];
    }
  | {
      readonly state: "in-progress";
      readonly whatIsHappening: string;
      readonly whatCompletesIt: string;
      readonly reportedBy: string;
    }
  | {
      readonly state: "waiting";
      readonly whatIsWaiting: string;
      readonly why: string;
      readonly whatHappensNext: string;
      readonly reportedBy: string;
      /** Absent or empty means "no actions available yet" — the surface says so explicitly (P6). */
      readonly availableActions?: readonly string[];
    }
  | {
      readonly state: "unknown";
      readonly subject: string;
      readonly explanation: string;
      readonly reconciliation?: {
        readonly whoResolves: string;
        readonly recheckTrigger: string;
      };
    }
  | {
      readonly state: "action-required";
      readonly action: string;
      readonly reportedBy: string;
      readonly validity?: string;
      readonly consequenceOfInaction?: string;
    }
) &
  TrackedStateMeta;

/** One plain-language history entry — presented verbatim, never rewritten. */
export interface TrackedHistoryEntry {
  readonly entryId: string;
  /** ISO timestamp as stamped by the recording authority. */
  readonly at: string;
  /** The authority that recorded this entry. */
  readonly authority: string;
  /** Plain-language wording, authored by the authority. */
  readonly wording: string;
}

/**
 * A proof-trail record behind a consequential outcome. Either the authority
 * answers for the record (kind: 'recorded' — verbatim outcome wording,
 * authority, time), or it does not (kind: 'no-answer'), in which case the
 * record renders UNKNOWN for itself — never a synthesized substitute (P5, P7, N1).
 */
export type EvidenceRecordView =
  | {
      readonly kind: "recorded";
      readonly recordId: string;
      readonly label: string;
      readonly owningAuthority: string;
      /** ISO timestamp of the recorded outcome. */
      readonly recordedAt: string;
      /** The outcome wording as recorded — presented, never rewritten. */
      readonly outcomeWording: string;
    }
  | {
      readonly kind: "no-answer";
      readonly recordId: string;
      readonly label: string;
      readonly owningAuthority: string;
      /** Why the record cannot be presented now (authority's own wording). */
      readonly explanation: string;
      readonly reconciliation: {
        readonly whoResolves: string;
        readonly recheckTrigger: string;
      };
    };

/** The full status view for one tracked reference. */
export interface TrackedReferenceView {
  /** Canonical reference id (also the deep-link slug). */
  readonly referenceId: string;
  /** Plain-language wording of what this reference tracks. */
  readonly subjectWording: string;
  /** Subject kind, e.g. 'payment intent' or 'settlement'. */
  readonly subjectKind: string;
  readonly protocolObject: ProtocolObjectRef;
  /** Authority that owns the reference's outcome. */
  readonly owningAuthority: string;
  /** The audience the current viewer was resolved to (role check on direct entry). */
  readonly viewerAudience: NavAudience;
  readonly currentState: TrackedCurrentState;
  /** Plain-language history, most recent first. */
  readonly history: readonly TrackedHistoryEntry[];
  /** The complete proof trail, in trail order. */
  readonly evidenceTrail: readonly EvidenceRecordView[];
}

/** Result of a reference lookup, including the per-reference role check. */
export type TrackingLookupResult =
  | {
      readonly kind: "not-found";
      readonly searchedReference: string;
      readonly wording: string;
      readonly reportedBy: string;
    }
  | {
      readonly kind: "not-authorized";
      readonly searchedReference: string;
      readonly viewerAudience: NavAudience;
      /** Authority wording naming who may view this reference. */
      readonly viewableBy: string;
      readonly wording: string;
      readonly reportedBy: string;
    }
  | {
      readonly kind: "tracked";
      readonly view: TrackedReferenceView;
    };

/**
 * The adapter boundary report — the mock self-describes so every surface can
 * render the boundary honestly. Runtime is marked ARRIVING until the real
 * tracking adapter replaces the mock at the port accessor.
 */
export interface TrackingBoundaryReport {
  readonly surface: string;
  readonly portModule: string;
  readonly backingModule: string;
  readonly backingKind: "mock";
  readonly runtime: "ARRIVING";
  readonly authoritative: false;
  readonly presentationOnly: true;
  /** Named owners of the real answers. */
  readonly authorityOwner: string;
  readonly authorityOwnerSource: string;
  /** Scriptable dimensions exposed by the mock for verification. */
  readonly scriptable: readonly string[];
  readonly note: string;
}

/** The tracking port — everything the surfaces may ask of the protocol side. */
export interface TrackingPort {
  /**
   * Look up one tracked reference on behalf of a resolved viewer audience.
   * The authority behind the port performs the per-reference authorization:
   * an audience not authorized for the reference gets 'not-authorized' with
   * no state, history, or evidence revealed. Never a browse-all listing —
   * the surface tracks by reference only.
   */
  lookupReference(reference: string, viewer: NavAudience): Promise<TrackingLookupResult>;
  /** The adapter boundary report (mock self-description, runtime ARRIVING). */
  describeBoundary(): TrackingBoundaryReport;
}

/**
 * Port accessor. The mock authority is the only backing at runtime and is
 * presentation-only (NON-AUTHORITATIVE). The swap to the real adapter
 * happens here and only here.
 */
export function getTrackingPort(): TrackingPort {
  return getMockTrackingAuthority();
}
