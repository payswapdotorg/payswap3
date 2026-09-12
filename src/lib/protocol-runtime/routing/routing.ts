/**
 * RTN-006 — Routing Authority: public barrel.
 *
 * Owned surface: src/lib/protocol-runtime/routing/ (work order RTN-006,
 * area 4). Every export cites its spec/architecture/v0.1/ source in its
 * module's doc-comments and in CONTRACT-REVIEW.md (this directory).
 *
 * This barrel materializes the A04 Routing Authority: the RoutePlan state
 * machine (COMPILED -> VALIDATED -> DISPATCHED ->
 * terminal(COMPLETED | FAILED | ABANDONED); UNKNOWN hops halt the plan at
 * DISPATCHED, never re-dispatching blindly), the deterministic pinned
 * RouteCompiler ((intent terms, policy evaluation, capability snapshot) ->
 * RoutePlan | NO_VIABLE_ROUTE; versions pinned and recorded in every
 * plan), INV-4-1 value preservation by integer summation with explicit
 * recorded conversion amounts and explicit Money fee line items, INV-4-2
 * compilation against one snapshot id with fixed-hop-order reservation
 * acquisition at dispatch, INV-4-3 compilation keyed by (intent id,
 * compiler version, snapshot id), the NO_VIABLE_ROUTE area-24 demand
 * signal with the emission point recorded, and A04's ROUTE_* evidence
 * records submitted to the REAL RTN-002 A15 log.
 *
 * Runtime note: loadable in plain Node with type stripping (explicit .ts
 * specifiers); the bun test suites import leaf modules directly because
 * Bun 1.3.14 does not implement node:sqlite — the same split the sibling
 * domains observe.
 */

// --- types.ts — the A04 vocabulary and state machine tables -----------------
export {
  ROUTE_PLAN_STATES,
  ROUTE_PLAN_TRANSITIONS,
  ROUTE_PLAN_REASON_CODES,
  ROUTE_REJECTION_CODES,
  isRoutePlanState,
  isRoutePlanReasonCode,
  canTransitionRoutePlan,
} from './types.ts';
export type {
  RoutePlanState,
  RoutePlanReasonCode,
  ConversionLineItem,
  FeeLineItem,
  RouteValueLedger,
  RouteHop,
  HopReservationRef,
  UnknownHopRef,
  RoutePlan,
  RouteDemandSignal,
  ConversionQuote,
  RouteRejectionCode,
  RouteCommandResult,
  RouteCompilationResult,
  ReservationAcquisitionRequest,
  ReservationAcquisitionResult,
  ReservationTerminalResult,
  ReservationAcquisition,
} from './types.ts';

// --- state-machine.ts — pure transition application + halt guards ----------
export {
  transitionRoutePlan,
  requiresReasonCode,
  checkRoutePlanReasonCode,
  hasUnresolvedUnknownHop,
  deadlinePassedAt,
} from './state-machine.ts';

// --- value.ts — the pure INV-4-1 value-preservation accounting -------------
export {
  hopOutputAmount,
  totalFeesInCurrency,
  checkRouteValuePreservation,
  canonicalValueFlow,
  availableAfterFees,
} from './value.ts';
export type { ValuePreservationCheck } from './value.ts';

// --- compiler.ts — the deterministic pinned RouteCompiler ------------------
export {
  ROUTE_COMPILER_VERSION,
  ROUTE_PLAN_HASH_FORMAT_VERSION,
  SEARCH_EXPANSION_LIMIT,
  canonicalConversionSchedule,
  hopComparator,
  settlementSemanticsFor,
  compileRoutePlan,
  canonicalRoutePlan,
  routePlanHash,
} from './compiler.ts';
export type {
  RoutePlanContent,
  RouteCompilationOutcome,
  RouteCompilationRequest,
} from './compiler.ts';

// --- evidence.ts — A04 records through the port to the real log ------------
export {
  ROUTING_AUTHORITY_ID,
  ROUTE_EVIDENCE_VOCABULARY,
  routeCompiledEvidence,
  routeValidatedEvidence,
  routeDispatchedEvidence,
  routeCompletedEvidence,
  routeFailedEvidence,
  routeNoViableRouteEvidence,
  routeAbandonedEvidence,
  submitRoutingEvidence,
} from './evidence.ts';

// --- serializer.ts — per-plan keyed serialization --------------------------
export { KeyedSerializer } from './serializer.ts';

// --- authority.ts — the composed single-writer command surface -------------
export { RoutingAuthority } from './authority.ts';
export type { RoutingAuthorityDeps } from './authority.ts';

// --- persistence.ts — the per-domain durable store (DEP-003 read-only) -----
export {
  DEFAULT_ROUTING_DB_PATH,
  ROUTING_MIGRATIONS_DIR_ENV_VAR,
  ROUTING_MIGRATIONS_RELATIVE_DIR,
  ROUTING_STORE_DOMAIN,
  resolveRoutingMigrationsDir,
  openRoutingStore,
  writeRoutePlan,
  saveRoutePlanState,
  writeRouteDemandSignal,
  readRoutePlans,
  readRouteDemandSignals,
} from './persistence.ts';
export type { RoutingStoreOptions, RoutingStoreWrite } from './persistence.ts';
