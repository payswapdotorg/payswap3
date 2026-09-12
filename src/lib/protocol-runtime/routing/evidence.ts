/**
 * RTN-006 — Routing Authority: A04 evidence emission through the
 * kernel-declared EvidenceSubmission port, to the REAL A15 log (RTN-002,
 * merged at this item's base).
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/core.md §4 Area 4, lines 263-265 (the complete
 *   named evidence set of the area):
 *     "Evidence produced
 *      - ROUTE_COMPILED (compiler version, snapshot id, plan hash).
 *      - ROUTE_VALIDATED, ROUTE_DISPATCHED, ROUTE_COMPLETED, ROUTE_FAILED,
 *        ROUTE_ABANDONED (with reason codes and affected hop ids)."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   26-32 (the exact five-slot record shape: what/when/authority/outcome/
 *   proof) and lines 62-64 (the synchronous coupling):
 *     "Evidence writing is internal and synchronous with the operation it
 *      records: an operation is not committed until its record is written.
 *      A failed write fails the operation."
 *   spec/architecture/v0.1/README.md §3 GC-5 lines 63-67 (exactly one
 *   record per consequential operation).
 *   spec/registry/protocol-registry.json A04 — owningAuthority:
 *     "Routing Authority" (the 'authority' slot value; validated by the
 *     real log against EVIDENCE_AUTHORITIES).
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - One record per consequential operation, exactly the named set:
 *     compile -> ROUTE_COMPILED, validate -> ROUTE_VALIDATED, dispatch ->
 *     ROUTE_DISPATCHED, complete -> ROUTE_COMPLETED, fail -> ROUTE_FAILED
 *     (including the NO_VIABLE_ROUTE terminal compilation failure),
 *     abandon -> ROUTE_ABANDONED. No other operation type exists.
 *   - ROUTE_COMPILED's slot mapping of "(compiler version, snapshot id,
 *     plan hash)": snapshot id -> what.subjectIds (with the plan and intent
 *     ids); compiler version -> proof.sequenceNumbers; plan hash ->
 *     proof.hashes. The plan hash itself covers all three (the canonical
 *     plan encoding includes compiler version, snapshot id, and the value
 *     flow), so the mapping is a redundancy, not an approximation.
 *   - ROUTE_DISPATCHED's proof carries the acquired reservations' ids as
 *     prior-record links (the area-5 records the dispatch produced) —
 *     "links to prior records required to verify the record" (A15 lines
 *     31-32).
 *   - "Affected hop ids" ride in what.subjectIds (hop ids are subject
 *     object ids): all hop ids on COMPLETED; the caller-named affected
 *     subset on FAILED/ABANDONED.
 *   - The UNKNOWN-hop HALT emits NO evidence record: the halt is not a
 *     state-machine transition (the plan stays DISPATCHED — core.md lines
 *     255-259), and the UNKNOWN fact's own evidence belongs to the rail
 *     and reconciliation areas (13/12/14 — "Every UNKNOWN rail operation
 *     automatically opens exactly one case",
 *     rails-adapters-reconciliation.md lines 124-125). The halt is recorded
 *     as a plan-record annotation, and its resolution flows into the
 *     ROUTE_COMPLETED/ROUTE_FAILED records' reason codes. A04's named
 *     evidence set is exhaustive (the RTN-005 precedent).
 *   - Emission is submit-then-commit at the authority layer: a failed
 *     submission throws and nothing is committed ("A failed write fails
 *     the operation").
 */

import type {
  EvidenceSubmission,
  EvidenceSubmissionRecord,
} from '../kernel/ports.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { isProtocolTime } from '../kernel/time.ts';
import { ROUTE_COMPILER_VERSION, routePlanHash } from './compiler.ts';
import type { RoutePlanContent } from './compiler.ts';
import type { RoutePlan, RoutePlanReasonCode } from './types.ts';

/**
 * The authority identity recorded in the 'authority' slot of A04's records —
 * the registry's owning authority name for area 4.
 *
 * Source: spec/registry/protocol-registry.json A04 — "owningAuthority":
 * "Routing Authority".
 */
export const ROUTING_AUTHORITY_ID = 'Routing Authority';

/**
 * The A04 evidence operation-type vocabulary — exactly the six named
 * types, frozen (no inventions).
 *
 * Source: core.md lines 263-265 (the named set quoted in the module doc).
 */
export const ROUTE_EVIDENCE_VOCABULARY = Object.freeze({
  compiledOperationType: 'ROUTE_COMPILED',
  validatedOperationType: 'ROUTE_VALIDATED',
  dispatchedOperationType: 'ROUTE_DISPATCHED',
  completedOperationType: 'ROUTE_COMPLETED',
  failedOperationType: 'ROUTE_FAILED',
  abandonedOperationType: 'ROUTE_ABANDONED',
} as const);

function assertWhen(when: unknown): asserts when is ProtocolTime {
  if (!isProtocolTime(when)) {
    throw new TypeError('routing evidence: when must be a well-formed ProtocolTime');
  }
}

function assertPlanLike(plan: RoutePlan | RoutePlanContent): void {
  if (plan === null || typeof plan !== 'object') {
    throw new TypeError('routing evidence: plan must be a RoutePlan record or compiled content');
  }
}

/**
 * Build the ROUTE_COMPILED record. Slot mapping of the A04 contract
 * "ROUTE_COMPILED (compiler version, snapshot id, plan hash)":
 *   - what.subjectIds: the plan id, the intent id, and the snapshot id;
 *   - when: the compilation time;
 *   - authority: Routing Authority;
 *   - outcome: COMPILED;
 *   - proof.sequenceNumbers: the pinned compiler version;
 *   - proof.hashes: the plan hash.
 *
 * Source: core.md lines 263-264; A15 lines 26-32; GC-5.
 */
export function routeCompiledEvidence(
  plan: RoutePlan | RoutePlanContent,
  when: ProtocolTime,
): EvidenceSubmissionRecord {
  assertWhen(when);
  assertPlanLike(plan);
  if (plan.compilerVersion !== ROUTE_COMPILER_VERSION) {
    // Defense in depth: only the pinned compiler may mint plans whose
    // evidence this module builds.
    throw new TypeError(
      `routing evidence: ROUTE_COMPILED requires the pinned compiler version (got v${plan.compilerVersion})`,
    );
  }
  return {
    what: {
      operationType: ROUTE_EVIDENCE_VOCABULARY.compiledOperationType,
      subjectIds: [plan.planId, plan.intentId, plan.snapshotId],
    },
    when,
    authority: ROUTING_AUTHORITY_ID,
    outcome: { result: 'COMPILED' },
    proof: {
      hashes: [routePlanHash(plan)],
      sequenceNumbers: [plan.compilerVersion],
    },
  };
}

/**
 * Build the ROUTE_VALIDATED record — the validation transition's record.
 *
 * Source: core.md lines 263-265 ("ROUTE_VALIDATED"); A15 lines 26-32; GC-5.
 */
export function routeValidatedEvidence(plan: RoutePlan, when: ProtocolTime): EvidenceSubmissionRecord {
  assertWhen(when);
  assertPlanLike(plan);
  if (plan.state !== 'VALIDATED') {
    throw new TypeError('routing evidence: ROUTE_VALIDATED requires the plan in VALIDATED');
  }
  return {
    what: {
      operationType: ROUTE_EVIDENCE_VOCABULARY.validatedOperationType,
      subjectIds: [plan.planId, plan.intentId],
    },
    when,
    authority: ROUTING_AUTHORITY_ID,
    outcome: { result: 'VALIDATED' },
    proof: { hashes: [routePlanHash(plan)] },
  };
}

/**
 * Build the ROUTE_DISPATCHED record — proof carries the acquired
 * reservations' ids as prior-record links (the area-5 records dispatch
 * produced), in fixed hop order.
 *
 * Source: core.md lines 263-265 ("ROUTE_DISPATCHED"); INV-4-2 lines
 * 245-247; A15 lines 31-32 ("links to prior records required to verify
 * the record"); GC-5.
 */
export function routeDispatchedEvidence(plan: RoutePlan, when: ProtocolTime): EvidenceSubmissionRecord {
  assertWhen(when);
  assertPlanLike(plan);
  if (plan.state !== 'DISPATCHED') {
    throw new TypeError('routing evidence: ROUTE_DISPATCHED requires the plan in DISPATCHED');
  }
  return {
    what: {
      operationType: ROUTE_EVIDENCE_VOCABULARY.dispatchedOperationType,
      subjectIds: [plan.planId, plan.intentId],
    },
    when,
    authority: ROUTING_AUTHORITY_ID,
    outcome: { result: 'DISPATCHED' },
    proof: {
      priorRecordIds: plan.reservationRefs.map((ref) => ref.reservationId),
    },
  };
}

/**
 * Build the ROUTE_COMPLETED record — "affected hop ids" are all the plan's
 * hop ids (every hop completed).
 *
 * Source: core.md lines 263-265 ("ROUTE_COMPLETED ... (with reason codes
 * and affected hop ids)"); A15 lines 26-32; GC-5.
 */
export function routeCompletedEvidence(plan: RoutePlan, when: ProtocolTime): EvidenceSubmissionRecord {
  assertWhen(when);
  assertPlanLike(plan);
  if (plan.state !== 'COMPLETED') {
    throw new TypeError('routing evidence: ROUTE_COMPLETED requires the plan in COMPLETED');
  }
  return {
    what: {
      operationType: ROUTE_EVIDENCE_VOCABULARY.completedOperationType,
      subjectIds: [plan.planId, plan.intentId, ...plan.hops.map((hop) => hop.hopId)],
    },
    when,
    authority: ROUTING_AUTHORITY_ID,
    outcome: { result: 'COMPLETED' },
    proof: {},
  };
}

/**
 * Build the ROUTE_FAILED record — "with reason codes and affected hop
 * ids". Two shapes share one operation type:
 *   - an executed plan that FAILED (the plan record in FAILED state, with
 *     its hop subset);
 *   - the NO_VIABLE_ROUTE terminal COMPILATION failure (no plan object:
 *     the subjects are the intent id and the compilation-attempt key — the
 *     derived plan id of (intent id, compiler version, snapshot id), which
 *     is also the demand signal's identity).
 *
 * Source: core.md lines 253-254 ("NO_VIABLE_ROUTE is a terminal failure"),
 * lines 263-265; A15 lines 26-32; GC-5.
 */
export function routeFailedEvidence(input: {
  readonly plan: RoutePlan;
  readonly when: ProtocolTime;
  readonly reasonCode: RoutePlanReasonCode;
  readonly affectedHopIds?: readonly string[];
}): EvidenceSubmissionRecord {
  const { plan, when, reasonCode, affectedHopIds } = input;
  assertWhen(when);
  assertPlanLike(plan);
  if (plan.state !== 'FAILED') {
    throw new TypeError('routing evidence: ROUTE_FAILED requires the plan in FAILED');
  }
  const hopIds =
    affectedHopIds === undefined ? plan.hops.map((hop) => hop.hopId) : [...affectedHopIds];
  return {
    what: {
      operationType: ROUTE_EVIDENCE_VOCABULARY.failedOperationType,
      subjectIds: [plan.planId, plan.intentId, ...hopIds],
    },
    when,
    authority: ROUTING_AUTHORITY_ID,
    outcome: { result: 'FAILED', reasonCode },
    proof: {},
  };
}

/**
 * Build the NO_VIABLE_ROUTE compilation-failure record — the terminal
 * failure of a compilation attempt (no plan object exists). The subjects
 * are the intent id and the compilation-attempt key (the derived plan id
 * of (intent id, compiler version, snapshot id) — INV-4-3's compilation
 * key). This record is ALSO the demand signal's emission point (its
 * derived record id is recorded on the signal).
 *
 * Source: core.md lines 253-254 ("NO_VIABLE_ROUTE is a terminal failure
 * that also emits a demand signal for area 24"); lines 263-265; INV-4-3
 * lines 248-249; A15 lines 26-32; GC-5.
 */
export function routeNoViableRouteEvidence(input: {
  readonly intentId: string;
  readonly attemptKey: string;
  readonly snapshotId: string;
  readonly when: ProtocolTime;
}): EvidenceSubmissionRecord {
  const { intentId, attemptKey, snapshotId, when } = input;
  assertWhen(when);
  if (typeof intentId !== 'string' || intentId.length === 0) {
    throw new TypeError('routing evidence: routeNoViableRouteEvidence requires the intent id');
  }
  if (typeof attemptKey !== 'string' || attemptKey.length === 0) {
    throw new TypeError('routing evidence: routeNoViableRouteEvidence requires the attempt key');
  }
  return {
    what: {
      operationType: ROUTE_EVIDENCE_VOCABULARY.failedOperationType,
      subjectIds: [intentId, attemptKey, snapshotId],
    },
    when,
    authority: ROUTING_AUTHORITY_ID,
    outcome: { result: 'FAILED', reasonCode: 'NO_VIABLE_ROUTE' },
    proof: {},
  };
}

/**
 * Build the ROUTE_ABANDONED record — "with reason codes and affected hop
 * ids" (the caller-named affected subset, or all hops when unnamed).
 *
 * Source: core.md lines 263-265; A15 lines 26-32; GC-5.
 */
export function routeAbandonedEvidence(input: {
  readonly plan: RoutePlan;
  readonly when: ProtocolTime;
  readonly reasonCode: RoutePlanReasonCode;
  readonly affectedHopIds?: readonly string[];
}): EvidenceSubmissionRecord {
  const { plan, when, reasonCode, affectedHopIds } = input;
  assertWhen(when);
  assertPlanLike(plan);
  if (plan.state !== 'ABANDONED') {
    throw new TypeError('routing evidence: ROUTE_ABANDONED requires the plan in ABANDONED');
  }
  const hopIds =
    affectedHopIds === undefined ? plan.hops.map((hop) => hop.hopId) : [...affectedHopIds];
  return {
    what: {
      operationType: ROUTE_EVIDENCE_VOCABULARY.abandonedOperationType,
      subjectIds: [plan.planId, plan.intentId, ...hopIds],
    },
    when,
    authority: ROUTING_AUTHORITY_ID,
    outcome: { result: 'ABANDONED', reasonCode },
    proof: {},
  };
}

/**
 * Submit one evidence record through the EvidenceSubmission port, honoring
 * the A15 coupling: a submission failure (a throw) propagates to the caller
 * and fails the operation that was being recorded ("A failed write fails
 * the operation" — A15 lines 62-64). The await accepts both port arms (the
 * real RTN-002 log submits synchronously; async ports are also honored,
 * per the kernel port's void-or-Promise shape).
 *
 * Source: A15 lines 62-64 + lines 41-43; the kernel port declaration
 * (src/lib/protocol-runtime/kernel/ports.ts).
 */
export async function submitRoutingEvidence(
  port: EvidenceSubmission,
  record: EvidenceSubmissionRecord,
): Promise<void> {
  await port.submit(record);
}
