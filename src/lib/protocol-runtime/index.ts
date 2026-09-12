/**
 * RTN-012 — The protocol-runtime wave barrel: the composed public surface.
 *
 * Owned surface: src/lib/protocol-runtime/index.ts (work order RTN-012 —
 * "WAVE BARREL: src/lib/protocol-runtime/index.ts — the wave barrel
 * exporting the composed public surface (module map with per-module entry
 * points; document the composition order)").
 *
 * This barrel closes the RTN wave (RTN-001..RTN-011 merged on main): it is
 * the single import surface over the composed protocol runtime — the
 * operational spine A01–A16 (rtn-plan-rulings.md Q2: "the closure of
 * {A09 clearing, A11 netting, A12 settlement-and-finality, A14
 * reconciliation} over dependsOn edges is A01–A12, A13, A14 ... plus the
 * cross-cutting roots A15 (evidence) and A16 (compliance gating)") —
 * hosted in-process inside the web-api-boundary application under the
 * DEP-003 precedent and the Q3 ruling's four conditions: (a) the logical
 * execution topology realized exactly as enforced module boundaries
 * (one admission point = gateway/, one authoritative-state writer =
 * transition/ + hosting/ on the DEP-003 substrate); (b) the externalized
 * process binding recorded as future work (deploy/contracts/
 * components.json future_work per component; DEP-002+); (c) the
 * components.json present-set updated in exactly this governed work item
 * (the contract trio updated together: components.json +
 * spec/deployment/topology.md + scripts/validate_deployment.py); (d) no
 * production financial effect reachable from the in-process form
 * (simulated rails only, no credentials, fail-closed).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE MAP — per-module entry points (the composed surface)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * | Area (registry) | Owning authority | Module dir | Entry points |
 * |---|---|---|---|
 * | — (kernel) | hosts NO authority (RTN-001) | kernel/ | kernel.ts, money.ts, moneybag.ts, time.ts, identity.ts, envelope.ts, reason-codes.ts, ports.ts, persistence.ts |
 * | A15 | Evidence Authority | evidence/ | log.ts, record.ts, chain.ts, canonical.ts, persistence.ts |
 * | A16 | Risk and Compliance Authority | risk/ | authority.ts, gate.ts, evaluation.ts, check.ts, screening.ts, subject.ts, rule.ts |
 * | A01 | Intent Authority | intent/ | authority.ts, descriptor.ts, state-machine.ts |
 * | A02 | Fulfillment Policy Authority | policy/ | authority.ts, evaluation.ts |
 * | A03 | Capability Authority | capability/ | authority.ts, types.ts |
 * | A04 | Routing Authority | routing/ | authority.ts, compiler.ts |
 * | A05 | Reservation Authority | reservations/ | ledger.ts, acquisition.ts, resource.ts |
 * | A06 | Liquidity Authority | liquidity/ | authority.ts |
 * | A07 | Credit Authority | credit/ | authority.ts |
 * | A08 | Queue Authority | queues/ | authority.ts |
 * | A09 | Clearing Authority | clearing/ | authority.ts |
 * | A10 | Obligation Authority | obligations/ | authority.ts, state-machine.ts |
 * | A11 | Netting Authority | netting/ | authority.ts, state-machine.ts |
 * | A12 | Settlement and Finality Authority | settlement/ | authority.ts, state-machine.ts, ports.ts |
 * | A13/A14 | Rail Authority; Reconciliation Authority | rails/ | index.ts (the domain barrel), authority.ts, reconciliation.ts, adapters.ts, runtime.ts |
 * | admission | (hosts no authority — the sole admission point) | gateway/ | index.ts (the domain barrel), admission.ts, registry.ts |
 * | single writer | (executes the hosted authorities' commands) | transition/ | execution.ts, substrate-port.ts |
 * | hosting | (the composition pattern on the substrate) | hosting/ | bindings.ts, durable-binding.ts, scheduler-wiring.ts, probes.ts |
 *
 * Areas A17–A24 are RTN wave 2 (spec/protocol-runtime-work-orders/README.md
 * "RTN wave 2"; rtn-plan-rulings.md Q2/delta 2): no runtime surfaces exist
 * for them in this barrel, by the recorded wave-activation deferral.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * THE COMPOSITION ORDER (how the composed runtime is assembled — the
 * order scripts/test_protocol_composed_journey.mjs realizes end-to-end)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  1. SUBSTRATE      — openTransitionSubstrate (hosting/durable-binding.ts):
 *                      the real DEP-003 durable queue + worker + scheduler
 *                      + durable_events over node:sqlite (read-only
 *                      integration; register() is the only integration
 *                      point — spec/durable/execution.md §9).
 *  2. EVIDENCE       — createEvidenceLog (evidence/log.ts): the REAL A15
 *                      log, bridged to the evidence-object-store's
 *                      per-domain persistence (writeEvidenceRecord) — one
 *                      chain over every authority's records.
 *  3. AUTHORITIES    — the merged command authorities over the one log:
 *                      risk (A16, SQLite store) → intent (A01, gated by
 *                      the risk authority's checkGate) → policy (A02) →
 *                      capability (A03) → routing (A04) → reservations
 *                      (A05) → liquidity (A06) → credit (A07) → queues
 *                      (A08) → obligations (A10) → netting (A11) →
 *                      rails (A13/A14, SQLite store, evidence through
 *                      adaptRailEvidenceToRegistryNames) → settlement
 *                      (A12, ports over rails/obligations/netting) →
 *                      clearing (A09, sink = obligations).
 *  4. PERSIST HOOKS  — buildDurablePersistHooks (hosting/durable-binding.ts):
 *                      the idempotent per-domain durable write-through.
 *  5. BINDINGS       — createAuthorityCommandBindings (hosting/bindings.ts):
 *                      the hosted command kinds, each driving the OWNING
 *                      authority's own command surface.
 *  6. TRANSITION     — createTransitionRuntime (transition/execution.ts)
 *                      + registerAll(): THE single authoritative-state
 *                      writer, hosted on the substrate.
 *  7. GATEWAY        — new ProtocolGateway({ evidence, queue:
 *                      commandQueuePortFromDurableQueue(...) }): the sole
 *                      admission point onto the durable command path.
 *  8. SCHEDULER      — wireRecurringCommandEmitters (hosting/
 *                      scheduler-wiring.ts): timing-driven command emitters
 *                      (clearing/netting/reconciliation/queues ticks).
 *
 * Every state mutation flows gateway → durable queue → worker → transition
 * runtime → owning authority (A15 record first, state after, durable
 * write-through last) — the single-writer discipline (spec/deployment/
 * topology.md "Runtime ownership of protocol authorities").
 *
 * Runtime note: like the gateway and rails barrels, THIS barrel composes
 * the full runtime and is therefore loadable in plain Node with type
 * stripping (explicit .ts specifiers) and in the Next.js server runtime —
 * NOT under bun (the gateway/rails persistence modules import the DEP-003
 * db layer over node:sqlite; bun does not implement it — the repository's
 * documented split: bun suites import the leaf modules directly, the
 * plain-Node harnesses bind the real substrate). The composed journey
 * harness proves this barrel's loadability and export surface.
 *
 * Spec sources (binding):
 *   spec/protocol-runtime-work-orders/RTN-012.md (the wave barrel owned
 *     surface; the composed golden path; the governed contract update);
 *   spec/development-state/rtn-plan-rulings.md Q2 (the A01–A16 spine),
 *     Q3 (in-process materialization conditions a–d), delta 2 (wave-2
 *     deferral of A17–A24), delta 3 (the governed contract trio update);
 *   spec/governance/parallel-execution.md "Integration after constituent
 *     merges" ("Integration work items declare their constituents as hard
 *     dependencies ... An integration PR re-runs the full assurance profile
 *     over the composed system");
 *   spec/deployment/topology.md "Contract evolution" (the trio updated
 *     together in one work item) and "Runtime ownership of protocol
 *     authorities" (exactly one admission point; exactly one writer).
 */

// --- kernel (RTN-001): money, identity, time, envelope, reason codes ------
export {
  money,
  isMoney,
  addMoney,
  subtractMoney,
  negateMoney,
  compareMoney,
  moneyEquals,
  isZeroMoney,
  moneyBag,
  emptyMoneyBag,
  moneyBagFromMoney,
  addMoneyBags,
  subtractMoneyBags,
  moneyBagEquals,
} from './kernel/money.ts';
export type { MinorUnits, CurrencyCode, DecimalScale, Money, MoneyBagEntry, MoneyBag } from './kernel/money.ts';
export { protocolTime, isProtocolTime } from './kernel/time.ts';
export type { SequencedPosition, WallEpochMs, ProtocolTime } from './kernel/time.ts';
export {
  DERIVATION_FORMAT_VERSION,
  canonicalDerivationInput,
  deriveProtocolId,
  deriveIdempotencyKey,
  isDerivedProtocolId,
  isDerivedIdempotencyKey,
} from './kernel/identity.ts';
export type { DerivationPart, DerivedProtocolId, DerivedIdempotencyKey } from './kernel/identity.ts';
export { validateCommandEnvelope, commandEnvelopeToEnqueueInput } from './kernel/envelope.ts';
export type {
  CommandKind,
  ProtocolAuthorityId,
  SubjectId,
  IdempotencyKey,
  CommandEnvelope,
  CommandEnvelopeField,
  CommandEnvelopeValidation,
  KernelEnqueueInput,
} from './kernel/envelope.ts';
export { SHARED_REASON_CODES, isSharedReasonCode } from './kernel/reason-codes.ts';
export type { SharedReasonCode } from './kernel/reason-codes.ts';
export type { EvidenceSubmission, EvidenceSubmissionRecord } from './kernel/ports.ts';
export { openKernelStore } from './kernel/persistence.ts';
export type { KernelStoreOptions } from './kernel/persistence.ts';

// --- evidence (RTN-002, A15): the real log, records, chain -----------------
export { createEvidenceLog, verificationLifecycleSubmission, commitWithEvidence } from './evidence/log.ts';
export type { EvidenceLog, EvidenceLogOptions } from './evidence/log.ts';
export {
  EVIDENCE_AUTHORITIES,
  EVIDENCE_AUTHORITY_NAME,
  EVIDENCE_LIFECYCLE_VOCABULARY,
  isEvidenceRecord,
  validateEvidenceSubmission,
  canonicalSubmissionEncoding,
} from './evidence/record.ts';
export type { EvidenceRecord, EvidenceRecordProof } from './evidence/record.ts';
export {
  EVIDENCE_CHAIN_FORMAT_VERSION,
  GENESIS_PREDECESSOR_HASH,
  EVIDENCE_VERIFICATION_REASON_CODES,
  computeRecordHash,
  verifyEvidenceChain,
} from './evidence/chain.ts';
export type { ChainVerification, ChainDivergence, ChainDivergenceProblem } from './evidence/chain.ts';

// --- risk / compliance (RTN-003, A16) ---------------------------------------
export { createRiskComplianceAuthority } from './risk/authority.ts';
export type { RiskComplianceAuthority, RiskComplianceAuthorityOptions } from './risk/authority.ts';
export { evaluateComplianceGate } from './risk/gate.ts';
export type { ComplianceGateVerdict, GatedTransitionKind } from './risk/gate.ts';
export { evaluateComplianceCheck } from './risk/evaluation.ts';
export type { ComplianceCheckRecord, ComplianceEvaluationInput } from './risk/evaluation.ts';
export { decideComplianceCheck } from './risk/check.ts';
export { createScreeningList } from './risk/screening.ts';
export type { ScreeningListRecord } from './risk/screening.ts';
export { subjectComplianceData, canonicalSubjectData, deriveSubjectDataHash } from './risk/subject.ts';
export type { SubjectComplianceData, SubjectKind, SubjectMoneyFact, SubjectCountFact } from './risk/subject.ts';

// --- intent (RTN-005, A01) ----------------------------------------------------
export { IntentAuthority } from './intent/authority.ts';
export type { IntentAuthorityDeps, IntentAuthorizationGate } from './intent/authority.ts';
export { demandDescriptor, endpointDescriptor, demandConstraints, canonicalDemandDescriptor, demandDescriptorHash, DEMAND_DESCRIPTOR_HASH_FORMAT_VERSION } from './intent/descriptor.ts';
export type { DemandDescriptor, DemandConstraints } from './intent/types.ts';
export { transitionPaymentIntent } from './intent/state-machine.ts';
export { INTENT_STATES, INTENT_TRANSITIONS } from './intent/types.ts';
export type { PaymentIntent, IntentState, IntentReasonCode, IntentReceipt, IntentSubmissionResult, IntentTransitionResult } from './intent/types.ts';

// --- fulfillment policy (RTN-005, A02) ---------------------------------------
export { PolicyAuthority } from './policy/authority.ts';
export type { PolicyAuthorityDeps } from './policy/authority.ts';
export { fulfillmentPolicyDefinition, evaluateFulfillmentPolicy, POLICY_EVALUATION_HASH_FORMAT_VERSION } from './policy/evaluation.ts';
export type { FulfillmentPolicyDefinition, IntentTerms, PolicyEvaluationOutcome } from './policy/types.ts';

// --- capability (RTN-005, A03) --------------------------------------------------
export { CapabilityAuthority } from './capability/authority.ts';
export type { CapabilityAuthorityDeps, CapabilityActivationGate } from './capability/authority.ts';
export { CAPABILITY_STATES, CAPABILITY_TRANSITIONS, COMMITMENT_STATES, COMMITMENT_TRANSITIONS, isCapabilityState, isCommitmentState } from './capability/types.ts';
export type { CapabilitySnapshot, CapabilitySnapshotEntry, CapabilityState, CommitmentState } from './capability/types.ts';

// --- routing (RTN-006, A04) -----------------------------------------------------
export { RoutingAuthority } from './routing/authority.ts';
export type { RoutingAuthorityDeps } from './routing/authority.ts';
export { compileRoutePlan, canonicalConversionSchedule, ROUTE_COMPILER_VERSION, ROUTE_PLAN_HASH_FORMAT_VERSION } from './routing/compiler.ts';
export type { RoutePlan, RouteHop, ConversionQuote } from './routing/types.ts';

// --- reservations (RTN-006, A05) ------------------------------------------------
export { ReservationLedger, openReservationLedger } from './reservations/ledger.ts';
export type { ReservationLedgerDeps, RecoveryAction } from './reservations/ledger.ts';
export { createReservationAcquisitionPort } from './reservations/acquisition.ts';
export { availableResource, resourceInvariantHolds, initialResourceAccounting } from './reservations/resource.ts';
export type { ResourceAccounting } from './reservations/resource.ts';
export type { ReservationRecord, ReservationState } from './reservations/types.ts';

// --- liquidity (RTN-007, A06) ----------------------------------------------------
export { LiquidityAuthority } from './liquidity/authority.ts';
export type { LiquidityAuthorityDeps, PositionHoldRecord, LiquidityRejection } from './liquidity/authority.ts';

// --- credit (RTN-007, A07) -------------------------------------------------------
export { CreditAuthority, creditLineResourceId } from './credit/authority.ts';
export type { CreditAuthorityDeps, CreditRejection } from './credit/authority.ts';

// --- queues (RTN-007, A08) -------------------------------------------------------
export { QueueAuthority } from './queues/authority.ts';
export type { QueueAuthorityDeps, QueueRejection } from './queues/authority.ts';

// --- clearing (RTN-008, A09) ------------------------------------------------------
export { ClearingAuthority } from './clearing/authority.ts';
export type {
  ClearingAuthorityDeps,
  ClearingRecordInput,
  ObligationLedgerSink,
  ClearabilityProbe,
} from './clearing/authority.ts';

// --- obligations (RTN-008, A10) ---------------------------------------------------
export { ObligationLedgerAuthority } from './obligations/authority.ts';
export type {
  ClearingCreationInstruction,
  ClearingCreationOutcome,
} from './obligations/authority.ts';
export {
  OBLIGATION_DERIVATION_DOMAIN,
  obligationIdForOriginRecord,
  hashObligationTerms,
  transitionObligation,
} from './obligations/state-machine.ts';
export type { ObligationRecord, ObligationState } from './obligations/types.ts';

// --- netting (RTN-009, A11) ---------------------------------------------------------
export { NettingAuthority } from './netting/authority.ts';
export type { NettingAuthorityDeps, NettingObligationLedgerPort, NettingCommitOutcome } from './netting/authority.ts';
export {
  NETTING_DERIVATION_DOMAIN,
  nettingSetIdForLabel,
  netObligationIdFor,
  mintNettingScope,
  transitionNettingSet,
} from './netting/state-machine.ts';
export type { NettingSetRecord, NetObligationRecord, NettingScope } from './netting/types.ts';

// --- settlement and finality (RTN-009, A12) -------------------------------------------
export { SettlementAuthority } from './settlement/authority.ts';
export type { SettlementAuthorityDeps, AttemptOutcomeMirror } from './settlement/authority.ts';
export {
  SETTLEMENT_DERIVATION_DOMAIN,
  settlementInstructionIdFor,
  finalityRecordIdFor,
  railIdempotencyKeyForInstruction,
  railOperationIdForInstruction,
} from './settlement/state-machine.ts';
export type { SettlementInstructionRecord, SettlementAttemptRecord, FinalityRecord, SettlementSubject, FinalityState } from './settlement/types.ts';
export {
  settlementPortFromAuthorities,
  obligationLedgerPortFromAuthority,
  nettingPortFromAuthority,
} from './settlement/ports.ts';

// --- rails (RTN-004, A13/A14): the domain barrel (Node-only) ----------------------------
export {
  RAIL_ADAPTER_TRANSITIONS,
  RAIL_OPERATION_TRANSITIONS,
  RECONCILIATION_CASE_TRANSITIONS,
  RECONCILIATION_CYCLE_TRANSITIONS,
  isRailAdapterStatus,
  isRailOperationStatus,
  isRailReportClass,
  isReconciliationCaseStatus,
  isReconciliationCycleStatus,
  RAILS_REASON_CODES,
  isRailsReasonCode,
  RAIL_PAYLOAD_ENCODING_VERSION,
  canonicalRailPayload,
  hashRailPayload,
  validateRailOperationPayload,
  submissionReportClass,
  SimulatedRail,
  createSimulatedRailAdapter,
  RAILS_MATCHING_RULE_VERSION,
  matchReconciliationRecords,
  stableStringify,
  DEFAULT_RAILS_DB_PATH,
  RAILS_MIGRATIONS_DIR_ENV_VAR,
  RAILS_MIGRATIONS_RELATIVE_DIR,
  RAILS_STORE_DOMAIN,
  resolveRailsMigrationsDir,
  openRailsStore,
  RailsStore,
  RailAdapterAuthority,
  RAIL_ADAPTER_AUTHORITY_ID,
  ReconciliationAuthority,
  RECONCILIATION_AUTHORITY_ID,
  createRailsAuthorities,
  openRailsAuthorities,
} from './rails/index.ts';
export type {
  RailAdapterStatus,
  RailOperationStatus,
  RailReportClass,
  RailAdapterRecord,
  RailOperationRecord,
  RailResultReportRecord,
  ReconciliationCaseStatus,
  ReconciliationCycleStatus,
  ReconciliationCaseRecord,
  CaseTerminalResolution,
  ResolutionProof,
  RecoveryDirective,
  ReconciliationCycleRecord,
  ReconciliationSourceRecord,
  ExternalStatementRecord,
  RailsCommandResult,
  SimulatedRailScenario,
  RailAdapterConnection,
  RailReportEnvelope,
  RailsAuthorities,
  RailsRuntimeDeps,
} from './rails/index.ts';

// --- gateway (RTN-010): the sole admission point (Node-only) -----------------------------
export {
  GATEWAY_ADMISSION_REASON_CODES,
  isGatewayAdmissionReasonCode,
  GATEWAY_ADMISSION_STATES,
  GATEWAY_ADMISSION_OUTCOMES,
  commandReceiptId,
  commandReceipt,
  isCommandReceipt,
  GATEWAY_COMMAND_AUTHORITIES,
  GATEWAY_ENVELOPE_AUTHORITIES,
  GATEWAY_EVIDENCE_AUTHORITY_BY_ENVELOPE,
  GATEWAY_COMMAND_KIND_COUNT,
  findAuthorityCommands,
  findCommandSpec,
  subjectFields,
  noSubjects,
  GATEWAY_EVIDENCE_VOCABULARY,
  resolveEvidenceAuthority,
  commandRejectedEvidence,
  submitGatewayEvidence,
  ProtocolGateway,
  commandQueuePortFromDurableQueue,
  DEFAULT_GATEWAY_DB_PATH,
  GATEWAY_MIGRATIONS_DIR_ENV_VAR,
  GATEWAY_MIGRATIONS_RELATIVE_DIR,
  GATEWAY_STORE_DOMAIN,
  resolveGatewayMigrationsDir,
  openGatewayStore,
  writeCommandReceipt,
  readCommandReceipts,
} from './gateway/index.ts';
export type {
  GatewayAdmissionReasonCode,
  GatewayAdmissionState,
  GatewayAdmissionOutcome,
  CommandReceipt,
  CommandSpec,
  AuthorityCommands,
  CommandQueuePort,
  CommandQueueEnqueueOutcome,
  CommandAdmissionResult,
  ProtocolGatewayDeps,
  GatewayHealthSnapshot,
  GatewayStoreOptions,
  StoredCommandReceipt,
  GatewayReceiptWrite,
} from './gateway/index.ts';

// --- transition runtime (RTN-011): the single authoritative-state writer ------------------
export {
  TransitionRuntime,
  createTransitionRuntime,
  COMMAND_EXECUTED_EVENT_TYPE,
} from './transition/execution.ts';
export type {
  AuthorityCommandBinding,
  AuthorityCommandOutcome,
  AuthorityCommandExecutionStatus,
} from './transition/execution.ts';
export type { TransitionSubstrate, TransitionQueueInsights } from './transition/substrate-port.ts';

// --- hosting (RTN-011): the composition pattern on the substrate ---------------------------
export {
  createAuthorityCommandBindings,
  enqueueCommand,
} from './hosting/bindings.ts';
export type {
  AuthorityHostingDeps,
  AuthorityPersistHooks,
  HostedRailsAdapterSurface,
  HostedReconciliationCycleSurface,
  SettlementRailsReportSurface,
  IntentPersistHook,
  ReservationsPersistHook,
  ObligationsPersistHook,
  SettlementPersistHook,
  ClearingPersistHook,
  NettingPersistHook,
  QueuesPersistHook,
} from './hosting/bindings.ts';
export {
  openTransitionSubstrate,
  asTransitionSubstrate,
  asSchedulerSubstrate,
  adaptRailEvidenceToRegistryNames,
  buildDurablePersistHooks,
} from './hosting/durable-binding.ts';
export type { TransitionSubstrateRuntimeHandle } from './hosting/durable-binding.ts';
export {
  wireRecurringCommandEmitters,
  tickCommandEnvelope,
  tickWindowFor,
  RECURRING_COMMAND_SCHEDULES,
} from './hosting/scheduler-wiring.ts';
export type { RecurringCommandScheduleConfig, SchedulerSubstratePort } from './hosting/scheduler-wiring.ts';
export {
  transitionBacklogSnapshot,
  probeReservationLedgerIdentity,
  probeLiquidityPoolIdentity,
  probeNettingConservation,
  runLedgerIdentityProbes,
} from './hosting/probes.ts';
