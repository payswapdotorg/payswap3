# RTN-010 — The gateway command surface (the UI-011 ledger item's input)

Work order: `spec/protocol-runtime-work-orders/RTN-010.md` (line 19):
"The command surface consumed by future product-port re-anchoring is
documented (the re-anchoring itself is product-program work — opened as
the UI-011 ledger item per rtn-plan-rulings.md Q5 ruling, delta 6)."

Ruling ground (spec/development-state/rtn-plan-rulings.md Q5, line 99):
"Surface ownership: src/lib/protocol/ is a product-owned code surface (the
RTN wave's own shared forbidden-surfaces list) — so the RTN wave cannot
perform the splice, and the proposal's RTN-010 correctly documents only the
command surface the re-anchoring will consume."

**This document IS that surface.** The product-program UI-011 item (port
re-anchoring: swap the mock backings of `src/lib/protocol/*-port.ts` for
runtime adapters, retire the mocks, re-anchor
`spec/product/*-mapping-records.md`) consumes EXACTLY the contracts below.
The port shapes and product surfaces do not change — the adapters call
this gateway; nothing else does.

## The submission contract (the one call)

`ProtocolGateway.submitCommand(submission)` — the ONLY function other code
may call to submit a protocol command (topology.md: "There is exactly one
protocol-command admission point (protocol-gateway)"). The submission is a
kernel `CommandEnvelope` (src/lib/protocol-runtime/kernel/envelope.ts):

```ts
{
  kind: string;            // the command kind, e.g. 'intent.submit'
  authority: string;       // the owning authority, e.g. 'Intent Authority'
  subjectIds: string[];    // the subject object ids (may be empty)
  idempotencyKey: string;  // never null — commands never opt out of dedupe
  protocolTime: { sequence: number; wallMs: number };
  body: object;            // the authority's command input (see catalogue)
}
```

- `kind` is lowercase dot-separated (`area.verb` shape; the DEP-003 kind
  column).
- `authority` is the registry's owning-authority name (for area 13 both
  the registry name `'Rail Authority'` and the module's exported
  `'Rail Adapter Authority'` are accepted).
- `idempotencyKey` is the caller's domain identity for the submission; the
  pair `(kind, idempotencyKey)` is the dedupe identity (DEP-003 UNIQUE
  (idempotency_key, kind)) and the receipt identity.
- `subjectIds` must equal the command kind's declared subject binding
  (positionally) — the catalogue below lists each kind's subject fields.

## The response contract

- Accepted (first or replay): `{ ok: true, replayed, created, receipt, jobId }`
  where `receipt` is the generalized IntentReceipt — `{ commandId, state:
  'ADMITTED', outcome: 'ADMITTED' | 'DUPLICATE', recordedAt }`
  ("command id, current admission state, and recorded outcome for the
  submitted idempotency key"; the command id is derived from
  `(kind, idempotencyKey)`). Re-submission with a recorded key returns the
  RECORDED receipt verbatim — never a second effect (INV-1-3 generalized).
- Rejected: `{ ok: false, reasonCode, problem, field? }` with a frozen
  five-member reason vocabulary: `ENVELOPE_INVALID`, `AUTHORITY_UNKNOWN`,
  `COMMAND_KIND_UNKNOWN`, `COMMAND_BODY_INVALID`,
  `COMMAND_SUBJECT_INVALID`. Every rejection is recorded as evidence
  (operation type `GATEWAY_COMMAND_REJECTED`) on the real A15 log.
- Unattributable submissions (authority slot naming no registry authority)
  throw a TypeError — no invented authority is materialized (Q4).
- A failed durable enqueue fails the whole call (thrown; no receipt; the
  same-key retry is safe).

## Health (programmatic; HTTP binding is deployment work)

`gateway.isReady()` and `gateway.health()` — readiness, command acceptance
rate, admission latency (mean/last), and durable-queue submit success
(rate + last outcome), per deploy/contracts/components.json
protocol-gateway's health_signal contract.

## The command catalogue (112 kinds · 15 command authorities)

Every kind maps 1:1 onto exactly one public command method of exactly one
merged authority class; the transition runtime (RTN-011) resolves the
handler by `(authority, kind)`. "Subjects" lists the body fields the
envelope's `subjectIds` must equal positionally.

### A01 Intent Authority — `intent.*` (7 kinds)

| Kind | Body fields | Subjects | Maps to |
|---|---|---|---|
| `intent.submit` | `descriptor` (DemandDescriptor: amount Money, source/destination endpoints {currency, geography, account}, constraints {deadlineEpochMs, allowedRails, costCeiling}, idempotencyKey), `priorIntentId?` | — | `IntentAuthority.submitIntent` |
| `intent.authorize` | `intentId`, `policyDecisionId` | intentId | `authorizeIntent` |
| `intent.route` | `intentId`, `reasonCode?` (IntentReasonCode) | intentId | `routeIntent` |
| `intent.fulfilling.start` | `intentId`, `reasonCode?` | intentId | `startFulfillingIntent` |
| `intent.fulfill` | `intentId`, `reasonCode?` | intentId | `fulfillIntent` |
| `intent.fail` | `intentId`, `reasonCode` (required), `failingRecordId?` | intentId | `failIntent` |
| `intent.cancel` | `intentId`, `reasonCode` (required) | intentId | `cancelIntent` |

### A02 Fulfillment Policy Authority — `policy.*` (5 kinds)

| Kind | Body fields | Subjects | Maps to |
|---|---|---|---|
| `policy.author` | `policyId`, `definition` (FulfillmentPolicyDefinition) | — | `authorPolicy` |
| `policy.version.publish` | `policyId` | policyId | `publishPolicyVersion` |
| `policy.attach` | `policyId`, `version` (int ≥ 1), `intentId`, `snapshotId` | policyId, intentId | `attachPolicy` |
| `policy.evaluate` | `policyId`, `version`, `intentId`, `intentTerms`, `snapshot` (CapabilitySnapshot) | policyId, intentId | `evaluatePolicy` |
| `policy.evaluation.consume` | `evaluationId` | evaluationId | `consumeEvaluation` |

### A03 Capability Authority — `capability.*` (9 kinds)

| Kind | Body fields | Subjects | Maps to |
|---|---|---|---|
| `capability.register` | `capabilityId`, `declaration` (railId, corridor, costSchedule, tier), `declaredCapacity` (Money ≥ 0) | — | `registerCapability` |
| `capability.activate` | `capabilityId`, `reasonCode?` | capabilityId | `activateCapability` |
| `capability.degrade` | `capabilityId`, `reasonCode?` | capabilityId | `degradeCapability` |
| `capability.retire` | `capabilityId`, `reasonCode?` | capabilityId | `retireCapability` |
| `capability.commitment.offer` | `intentId`, `capabilityId`, `amount` (Money > 0), `deadlineEpochMs` | intentId, capabilityId | `offerCommitment` |
| `capability.commitment.reserve` | `commitmentId` | commitmentId | `reserveCommitment` |
| `capability.commitment.consume` | `commitmentId` | commitmentId | `consumeCommitment` |
| `capability.commitment.release` | `commitmentId` | commitmentId | `releaseCommitment` |
| `capability.commitment.expire` | `commitmentId`, `wallMs` | commitmentId | `expireCommitment` |

### A04 Routing Authority — `routing.*` (8 kinds)

| Kind | Body fields | Subjects | Maps to |
|---|---|---|---|
| `routing.compile` | `intentId`, `intentTerms`, `policyEvaluation` (satisfiable union), `snapshot`, `conversions?` | intentId | `compileRoute` |
| `routing.plan.validate` | `planId` | planId | `validatePlan` |
| `routing.plan.dispatch` | `planId` | planId | `dispatchPlan` |
| `routing.hop.unknown.record` | `planId`, `hopId`, `railOperationId` | planId, hopId | `recordUnknownHop` |
| `routing.hop.unknown.resolve` | `planId`, `hopId`, `resolvedOutcome` (CONFIRMED \| FAILED) | planId, hopId | `resolveUnknownHop` |
| `routing.plan.complete` | `planId` | planId | `completePlan` |
| `routing.plan.fail` | `planId`, `reasonCode` (required), `affectedHopIds?` | planId | `failPlan` |
| `routing.plan.abandon` | `planId`, `reasonCode` (required), `affectedHopIds?` | planId | `abandonPlan` |

### A05 Reservation Authority — `reservations.*` (5 kinds)

| Kind | Body fields | Subjects | Maps to |
|---|---|---|---|
| `reservations.resource.declare` | `resourceId`, `declaredTotal` (Money ≥ 0) | resourceId | `declareResource` |
| `reservations.hold.request` | `intentId`, `hopId`, `resourceId`, `amount` (Money ≥ 0), `deadlineEpochMs` | intentId, hopId, resourceId | `requestReservation` |
| `reservations.hold.consume` | `reservationId` | reservationId | `consumeReservation` |
| `reservations.hold.release` | `reservationId` | reservationId | `releaseReservation` |
| `reservations.due.expire` | `at?` (ProtocolTime) | — | `expireDueReservations` |

### A06 Liquidity Authority — `liquidity.*` (10 kinds)

| Kind | Body fields | Subjects | Maps to |
|---|---|---|---|
| `liquidity.pool.open` | `poolId`, `currency` (3 uppercase), `scale` (int ≥ 0) | — | `openPool` |
| `liquidity.pool.freeze` | `poolId` | poolId | `freezePool` |
| `liquidity.pool.close` | `poolId` | poolId | `closePool` |
| `liquidity.funding.record` | `poolId`, `source` ({kind: INTERNAL_TRANSFER \| EXTERNAL_RAIL, referenceId}), `amount` (Money > 0) | poolId | `recordConfirmedFunding` |
| `liquidity.funding.pending.open` | `poolId`, `railOperationId`, `expectedAmount` (Money) | poolId | `openPendingFunding` |
| `liquidity.funding.pending.resolve` | `pendingId`, `resolution` (RESOLVED_CONFIRMED \| RESOLVED_FAILED) | pendingId | `resolvePendingFunding` |
| `liquidity.hold.request` | `positionId`, `intentId`, `hopId`, `amount` (Money > 0), `deadlineEpochMs` | positionId, intentId | `requestPositionHold` |
| `liquidity.hold.consume` | `reservationId` | reservationId | `consumeHold` |
| `liquidity.hold.release` | `reservationId` | reservationId | `releaseHold` |
| `liquidity.holds.due.expire` | `at?` | — | `expireDueHolds` |

### A07 Credit Authority — `credit.*` (9 kinds)

| Kind | Body fields | Subjects | Maps to |
|---|---|---|---|
| `credit.line.offer` | `lineId`, `limit` (Money > 0) | — | `offerLine` |
| `credit.line.activate` | `lineId` | lineId | `activateLine` |
| `credit.line.suspend` | `lineId` | lineId | `suspendLine` |
| `credit.line.close` | `lineId` | lineId | `closeLine` |
| `credit.usage.evaluate` | `intentId`, `lineId`, `requestedAmount` (Money > 0) | intentId, lineId | `evaluateCreditUsage` |
| `credit.decision.apply` | `decisionId`, `hopId`, `deadlineEpochMs` | decisionId | `applyCreditDecision` |
| `credit.reservation.consume` | `reservationId` | reservationId | `consumeCreditReservation` |
| `credit.reservation.release` | `reservationId` | reservationId | `releaseCreditReservation` |
| `credit.reservations.due.expire` | `at?` | — | `expireDueCreditReservations` |

### A08 Queue Authority — `queues.*` (10 kinds)

| Kind | Body fields | Subjects | Maps to |
|---|---|---|---|
| `queues.queue.create` | `queueId`, `policy` ({orderingRule: PRIORITY_CLASS_THEN_SEQUENCE_NUMBER, maxWaitEpochMs > 0, releaseConditions: ≥ 1 of requiredCapabilityTier / minLiquidityAvailable / minCreditRemaining}) | — | `createQueue` |
| `queues.queue.drain.start` | `queueId` | queueId | `startDraining` |
| `queues.queue.pause` | `queueId` | queueId | `pauseQueue` |
| `queues.queue.close` | `queueId` | queueId | `closeQueue` |
| `queues.item.enqueue` | `queueId`, `intentId`, `priorityClass` (int ≥ 0), `terms` ({intentId = intentId, terms Money ≥ 0}) | queueId, intentId | `enqueueItem` |
| `queues.eligibility.evaluate` | `queueId`, `snapshot` ({liquidity[], capability[], credit[], at}) | queueId | `evaluateEligibility` |
| `queues.item.dispatch.next` | `queueId`, `linkedOperationId` | queueId | `dispatchNext` |
| `queues.item.dispatch.resolve` | `itemId`, `resolution` (RESOLVED_CONFIRMED \| RESOLVED_FAILED) | itemId | `resolveDispatchedItem` |
| `queues.item.cancel` | `itemId`, `reasonCode` (INTENT_CANCELLED \| ROUTE_FAILED_DETERMINISTIC) | itemId | `cancelItem` |
| `queues.items.due.expire` | `queueId`, `at?` | queueId | `expireDueItems` |

### A09 Clearing Authority — `clearing.*` (5 kinds)

| Kind | Body fields | Subjects | Maps to |
|---|---|---|---|
| `clearing.batch.open` | `batchLabel` | — | `openBatch` |
| `clearing.record.add` | `batchId`, `record` ({origin {originActivityId, originKind}, parties {debtor, creditor}, amount — NOT shape-checked at admission (the stage-time quarantine owns it), reason, correctionOf?}) | batchId | `addRecord` |
| `clearing.batch.stage` | `batchId` | batchId | `stageBatch` |
| `clearing.batch.commit` | `batchId` | batchId | `commitBatch` |
| `clearing.batch.finalize` | `batchId` | batchId | `finalizeBatch` |

### A10 Obligation Ledger Authority — `obligations.*` (8 kinds)

| Kind | Body fields | Subjects | Maps to |
|---|---|---|---|
| `obligations.clearing.commit` | `batchId`, `recordId`, `originActivityId`, `originKind`, `debtorParticipantId`, `creditorParticipantId` (≠ debtor), `amount` (Money), `reason`, `correctionOf?` | — | `applyClearingCommand` |
| `obligations.correction.cancel` | `obligationId`, `replacementObligationId`, `evidenceReference` | obligationId | `applyClearingCorrectionCancel` |
| `obligations.dispute.open` | `obligationId`, `disputeId` | obligationId | `openDispute` |
| `obligations.dispute.resolve` | `disputeId`, `resolvedObligationId`, `replacements[]` ({debtor ≠ creditor, amount, reason}) | disputeId, resolvedObligationId | `applyDisputeResolution` |
| `obligations.writeoff.risk` | `obligationId`, `riskAuthorityReference` | obligationId | `applyRiskWriteOff` |
| `obligations.netting.commit` | `obligationId`, `nettingSetId`, `replacementObligationIds[]` | obligationId, nettingSetId | `applyNettingCommit` |
| `obligations.settlement.instruction` | `obligationId`, `settlementInstructionId` | obligationId | `applySettlementInstruction` |
| `obligations.settlement.finality` | `obligationId`, `finalityRecordId` | obligationId | `applySettlementFinality` |

### A11 Netting Authority — `netting.*` (5 kinds)

| Kind | Body fields | Subjects | Maps to |
|---|---|---|---|
| `netting.set.open` | `label`, `scope` ({kind: BILATERAL (2) \| MULTILATERAL (≥ 3), participants[]}), `inputObligationIds[]` | — | `openNettingSet` |
| `netting.set.compute` | `nettingSetId` | nettingSetId | `computeNettingSet` |
| `netting.set.commit` | `nettingSetId` | nettingSetId | `commitNettingSet` |
| `netting.position.instruction.apply` | `netObligationId`, `settlementInstructionId` | netObligationId | `applyNetPositionSettlementInstruction` |
| `netting.position.finality.apply` | `netObligationId`, `finalityRecordId` | netObligationId | `applyNetPositionSettlementFinality` |

### A12 Settlement and Finality Authority — `settlement.*` (6 kinds)

| Kind | Body fields | Subjects | Maps to |
|---|---|---|---|
| `settlement.instruction.create` | `subject` ({kind: OBLIGATION, obligationId} \| {kind: NET_POSITION, netObligationId}), `beneficiary`, `memo?` | the subject id | `createSettlementInstruction` |
| `settlement.attempt.authorize` | `instructionId`, `adapterId` | instructionId | `authorizeAttempt` |
| `settlement.attempt.submit` | `instructionId` (the live connection is bound by the transition runtime) | instructionId | `submitAttempt` |
| `settlement.attempt.railoutcome.apply` | `instructionId` | instructionId | `applyRailOutcome` |
| `settlement.resolution.apply` | `recovery` (the three-feed RecoveryDirective union), `caseId?` | recovery.instructionId (or caseId for the area-09-10 feed) | `applyResolution` |
| `settlement.finality.declare` | `instructionId` | instructionId | `declareFinality` |

### A13 Rail Adapter Authority — `rails.*` (7 kinds; envelope authority 'Rail Authority' or 'Rail Adapter Authority')

| Kind | Body fields | Subjects | Maps to |
|---|---|---|---|
| `rails.adapter.register` | `railFamily`, `name` | — | `registerAdapter` |
| `rails.adapter.activate` | `adapterId` | adapterId | `activateAdapter` |
| `rails.adapter.degrade` | `adapterId`, `reasonCode?` | adapterId | `degradeAdapter` |
| `rails.adapter.retire` | `adapterId`, `reasonCode?` | adapterId | `retireAdapter` |
| `rails.operation.authorize` | `instructionId`, `adapterId`, `payload` (RailOperationPayload; payload.instructionId must equal instructionId) | instructionId | `authorizeOperation` |
| `rails.operation.submit` | `operationId` (the live connection is bound by the transition runtime) | operationId | `submitRailOperation` |
| `rails.operation.report.record` | `operationId`, `report` ({outcomeClass, reasonCode?, railReferences[], payloadHash, reportedAtWallMs}) | operationId | `recordReport` |

### A14 Reconciliation Authority — `reconciliation.*` (7 kinds)

| Kind | Body fields | Subjects | Maps to |
|---|---|---|---|
| `reconciliation.case.investigate` | `caseId` | caseId | `investigateCase` |
| `reconciliation.case.resolve` | `caseId`, `resolution` (RESOLVED_CONFIRMED \| RESOLVED_FAILED \| RESOLVED_ADJUSTED \| MATCHED, each with proof) | caseId | `resolveCase` |
| `reconciliation.source.register` | `kind`, `description` | — | `registerSource` |
| `reconciliation.cycle.open` | `windowStartWallMs`, `windowEndWallMs`, `sourceIds[]`, `ruleVersion?` | — | `openCycle` |
| `reconciliation.cycle.statements.collect` | `cycleId`, `statements[]` (ExternalStatementRecord) | cycleId | `collectStatements` |
| `reconciliation.cycle.matching.run` | `cycleId` | cycleId | `runMatching` |
| `reconciliation.cycle.close` | `cycleId` | cycleId | `closeCycle` |

### A16 Risk and Compliance Authority — `risk.*` (11 kinds)

Risk commands carry a caller-supplied `when: ProtocolTime` (the authority
has no clock).

| Kind | Body fields | Subjects | Maps to |
|---|---|---|---|
| `risk.rule.author` | `ruleId`, `definition` (RiskRuleDefinition), `when` | — | `authorRule` |
| `risk.rule.revise` | `ruleId`, `definition`, `when` | ruleId | `reviseRule` |
| `risk.rule.publish` | `ruleId`, `when` | ruleId | `publishRule` |
| `risk.rule.activate` | `ruleId`, `version`, `when` | ruleId | `activateRule` |
| `risk.rule.retire` | `ruleId`, `version`, `when` | ruleId | `retireRule` |
| `risk.screeninglist.register` | `listId`, `version`, `entries[]`, `when` | — | `registerScreeningList` |
| `risk.subject.screen` | `subject` (SubjectComplianceData), `listId`, `when` | — | `screenSubject` |
| `risk.check.evaluate` | `subject`, `listId`, `when` | — | `evaluateAndRecordCheck` |
| `risk.check.decide` | `checkId`, `when` | checkId | `decideCheck` |
| `risk.check.review.route` | `checkId`, `when` | checkId | `routeCheckToReview` |
| `risk.check.review.record` | `checkId`, `review` ({reviewerAuthority, decision: APPROVED \| DENIED, rationale}), `when` | checkId | `recordCheckReview` |

## What is deliberately NOT on this surface

- **Reads.** The gateway admits commands; it exposes no query path. The
  product ports' read sides re-anchor to the authorities' own read methods
  and the per-domain persistence read functions (each authority module
  exports them), composed by the same deployment root that wires the
  gateway. (RTN-010.md line 10: admission, receipts, submission, rejection
  codes, health — no read contract.)
- **The kernel and the Evidence Authority host no command kinds.** The
  kernel is the area-agnostic library; the A15 log is written
  synchronously through the EvidenceSubmission port by every authority —
  neither is commanded through the durable path (envelopes addressed to
  them are rejected with AUTHORITY_UNKNOWN and recorded evidence).
- **Areas A17–A24 (RTN wave 2)** have no runtime surfaces; envelopes
  addressed to their registry authorities are rejected with
  AUTHORITY_UNKNOWN.
- **No identity or market authority exists** (rtn-plan-rulings.md Q4):
  subject validation is per-command per owning authority; a submission
  addressed to an invented authority name fails closed with a TypeError.
- **No transitions.** No financial effect occurs at admission — effects
  occur only via the transition path (RTN-011) that consumes the durable
  jobs the gateway submits.

## Field-shape authority

The per-field validation rules above are the OWNING AUTHORITIES' own
exported schemas — their guards (`isIntentReasonCode`,
`isFundingSourceKind`, ...), their mints (`demandDescriptor`,
`fulfillmentPolicyDefinition`, `validateRiskRuleDefinition`,
`validateRailOperationPayload`, `mintNettingScope`,
`subjectComplianceData`, `canonicalConversionSchedule`), or structural
compositions of their exported types where no public validator exists.
The machine-readable form of this catalogue is
`src/lib/protocol-runtime/gateway/registry.ts`
(`GATEWAY_COMMAND_AUTHORITIES`); the admission tests
(`admission-matrix.test.ts`) hold one valid sample body per kind plus the
accept/reject matrix.
