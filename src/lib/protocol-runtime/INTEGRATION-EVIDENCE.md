# RTN-012 — Integration evidence: the composed-journey record

Work order: `spec/protocol-runtime-work-orders/RTN-012.md` — "the composed-journey
evidence answers the nine reconciliation questions
(spec/governance/dogfooding-protocol.md) at the protocol/runtime boundary" and
"a DEP-004 dispatchability statement is produced as review evidence (file
under your owned surfaces or the report)".

This document IS that evidence file (RTN-012's owned integration-evidence
surface, alongside the wave barrel `src/lib/protocol-runtime/index.ts` and
the composed-journey harness `scripts/test_protocol_composed_journey.mjs`).

- Base branch + base SHA: main @ 14b6ca56c07de585df6d1a3a97edcc36ad2e4c02
- Environment: sandbox topology of the real composed system (the in-process
  module surfaces inside the web-api-boundary application: the RTN-010
  gateway over the real DEP-003 durable queue/worker, the RTN-011 transition
  runtime, the real A01–A16 authorities over the real RTN-002 A15 log and the
  per-domain stores, the real RTN-003 risk authority, the real RTN-004
  rails/reconciliation authorities over their store, and the protocol-owned
  simulated rails — no external transmission, no credentials, fail-closed).
- Harness: `scripts/test_protocol_composed_journey.mjs` (plain Node ≥ 22.6,
  node:sqlite + type stripping; exit 0 = all scenarios green).

## The composed golden path (the journey record)

Journey: the composed golden path — one intent from submission to finality
through the merged runtime.
Steps (every consequential step's A15 record in the ONE chain; the harness
asserts each, and `verifyAndRecord` returns VERIFIED at the end — 49 records
in the golden run):

1. `rails.adapter.register` + `rails.adapter.activate` — admitted through the
   GATEWAY → durable queue → worker → transition runtime → the A13
   RailAdapterAuthority command surface. ADAPTER_STATE_CHANGED records.
2. Capability register + compliance-gated activation (A03, through the REAL
   A16 risk authority gate; CAPABILITY_REGISTERED / CAPABILITY_STATE_CHANGED).
3. Policy author + publish (A02).
4. **Intent submit — VIA THE GATEWAY** (the work order's phrase): the
   documented nested body (`COMMAND-SURFACE.md`), executed by the transition
   runtime through the integration adapter for the filed defect D-1 (below).
   INTENT_CREATED; the intent DRAFT; the durable write-through round-trips.
5. The A16 compliance check for the intent subject (the REAL risk authority:
   SCREENING_COMPUTED + CHECK_DECIDED in the real log — the RTN-003
   real-log integration).
6. Policy attach + evaluate (A02; POLICY_ATTACHED / POLICY_EVALUATED).
7. **Authorize — VIA THE GATEWAY** (compliance-gated at execution: the
   authority's gate reads the risk authority's APPROVED check; INV-16-3).
   INTENT_AUTHORIZED.
8. Route (the A04 compiler): compileRoute + validatePlan (ROUTE_COMPILED /
   ROUTE_VALIDATED), then the intent ROUTED transition — VIA THE GATEWAY.
9. Reserve (the A05 ledger): plan dispatch acquires the reservation in fixed
   hop order (RESERVATION_HELD; the ledger accounting exact).
10. Fulfill: FULFILLING start, evaluation consumption, commitment offer +
    reserve + consume (A03), intent FULFILLED (INTENT_STATE_CHANGED ×3,
    COMMITMENT_* records), plan completion consumes the reservation
    (RESERVATION_CONSUMED, ROUTE_COMPLETED).
11. Clear (the batch) — open/stage/commit/finalize VIA THE GATEWAY; the four
    records stage directly through the A09 command surface; the commit flows
    them to the A10 sink (BATCH_STAGED, BATCH_COMMITTED, OBLIGATION_CREATED ×4).
12. Net (conservation) — open/compute/commit VIA THE GATEWAY
    (NETTING_SET_OPENED, NETTING_COMPUTED, NETTING_COMMITTED); the gross set
    nets to two positions summing to the conserved total.
13. Settle (the simulated rail) — instruction create + attempt authorize +
    attempt submit VIA THE GATEWAY. The attempt authorization and submission
    drive the A13 rail-operation transitions AUTHORIZED → SUBMITTED → PENDING
    THROUGH THE SINGLE-WRITER PATH (rtn-plan-rulings.md Q1/delta 1:
    RAIL_OP_AUTHORIZED + RAIL_OP_SUBMITTED records; the operation's
    idempotency key is the derived instruction key). The submission
    transmission itself is the adapter interface (transmission-and-reporting
    only — the simulated rail).
14. The report-driven confirmation: the adapter's report recorded through the
    A13 command surface (RAIL_OP_REPORTED — external evidence, not protocol
    truth), the A12 mirror confirms (SETTLEMENT_ATTEMPT_RESOLVED).
15. Finality: declareFinality → FINAL; the net position advances to SETTLED
    exactly once (the second declaration is refused with
    FINALITY_ALREADY_DECLARED); FINALITY_DECLARED (PROVISIONAL + FINAL).
16. The evidence chain hash verification over the FULL composed journey log:
    VERIFIED (plus the pure `verifyEvidenceChain`, tamper detection on a
    mutated copy, and the evidence-object-store round-trip of every record).

The composed UNKNOWN path (the same journey with the rail scripted
TRANSMIT_TIMEOUT): the attempt lands UNKNOWN (the durable state — the
instruction stays ISSUED, the net position stays SETTLEMENT_PENDING), the
INV-14-1 auto-case opens exactly once, the second attempt authorization is
refused (INV-12-2), finality is blocked (GC-2, UNKNOWN_HELD), INVESTIGATING →
RESOLVED_CONFIRMED → the safe-resume applies the recovery directive →
finality advances exactly once → SETTLED; the chain verifies.

The RESOLVED_FAILED variant: the case resolves RESOLVED_FAILED (the operation
→ FAILED; the attempt/instruction FAILED), and the recovery is a NEW
instruction — a new id and a NEW rail idempotency key (new evidence) — which
settles CONFIRMED and advances finality exactly once.

Duplicate/restart safety across the composed path: gateway resubmission
returns the RECORDED receipt verbatim (never a second effect; exactly one
intent, one INTENT_CREATED, one durable row); the worker-restart
lease-reclaim redelivery (reserve → execute → die → lease expiry → reclaim →
redeliver) replays the recorded state (observations `applied` → `replayed`;
exactly one effect); the full log verifies after the restart cycle.

Determinism (GC-1): the composed golden journey runs twice; the transcripts
are identical.

## The nine reconciliation questions (spec/governance/dogfooding-protocol.md)

Answered at the protocol/runtime boundary from the composed-journey evidence
above. "A question answered with an assertion instead of evidence is
unanswered" — each answer points into the harness scenarios.

1. **Protocol object:** every step's object, named per the registry: the
   DemandDescriptor → PaymentIntent (A01) at submission; the
   ComplianceCheckRecord (A16) for the gate; the FulfillmentPolicyVersion +
   PolicyEvaluationRecord (A02); the CapabilityRecord + CommitmentRecord +
   CapabilitySnapshot (A03); the RoutePlan (A04); the ReservationRecord +
   ResourceAccounting (A05); the ClearingBatchRecord + ClearingRecord (A09);
   the ObligationRecord (A10); the NettingSetRecord + NetObligationRecord
   (A11); the SettlementInstructionRecord + SettlementAttemptRecord +
   FinalityRecord (A12); the RailAdapterRecord + RailOperationRecord +
   RailResultReportRecord (A13); the ReconciliationCaseRecord (A14); the
   EvidenceRecord chain (A15). Evidence: the harness asserts each object's
   identity and state at every step (e.g. the deterministic id chain —
   nettingSetIdForLabel → netObligationIdFor → settlementInstructionIdFor →
   railIdempotencyKeyForInstruction).
2. **Owning authority:** each object's owning authority per the registry and
   the A15 record's authority slot: Intent Authority, Risk and Compliance
   Authority, Fulfillment Policy Authority, Capability Authority, Routing
   Authority, Reservation Authority, Clearing Authority, Obligation Authority,
   Netting Authority, Settlement and Finality Authority, Rail Authority,
   Reconciliation Authority, Evidence Authority. The harness asserts the
   record-authority mapping (e.g. RAIL_OP_AUTHORIZED carries 'Rail Authority'
   — the registry name, never the rails module's local label) and the
   observation-row owners.
3. **Runtime boundary:** the journey crosses exactly one protocol admission
   boundary (the gateway — `ProtocolGateway.submitCommand`, the sole
   admission point) and one authoritative-state writer boundary (the
   transition runtime's command execution path); the external-effect boundary
   is the adapter interface (the simulated rail — transmission only, no
   protocol state). What crosses in which direction: command envelopes in
   (gateway → durable queue), authority state + A15 records out (transition
   runtime → stores/log), rail instructions out and rail reports in (adapter
   interface → external evidence → the A13 command surface).
4. **Deployed component:** per the reconciled system architecture and the
   RTN-012 updated contract (deploy/contracts/components.json — all ten
   components present in their in-process forms): the gateway component
   admits; the durable-command-queue transports; the transition-runtime
   component writes; the authoritative-state-store + evidence-object-store
   persist; the netting-settlement-workers + reconciler-workers component
   surfaces host the A11/A12/A14 semantics; the external-rail-adapters
   component is the simulated-rail transmission surface; the scheduler
   component emits the recurring ticks. The externalized process binding
   remains recorded future work per component (Q3/delta 3).
5. **Persistent state:** every consequential step's durable writes — the
   per-domain SQLite stores on the DEP-003 database layer (intent,
   reservations, obligations, settlement, clearing, netting, queues,
   evidence, risk, rails) via the idempotent per-domain write-through; the
   durable_jobs/durable_events rows (the command path + the authority-owned
   observation rows); the append-only evidence_records rows (INV-15-4 write
   keys, ON CONFLICT DO NOTHING). The harness asserts the write-through
   round-trips (readPaymentIntents, readEvidenceRecords, …) and the
   evidence-store full round-trip.
6. **UNKNOWN handling:** produced at settlement submission (TRANSMIT_TIMEOUT
   on the simulated rail) — the attempt's durable UNKNOWN state; held by the
   instruction staying ISSUED and the net position staying SETTLEMENT_PENDING
   (GC-2; finality blocked with UNKNOWN_HELD; re-submission refused by both
   A12 (LIVE_ATTEMPT_EXISTS) and A13 (OPERATION_NOT_AUTHORIZED)); resolved
   ONLY by the Reconciliation Authority's terminal case resolution
   (INVESTIGATING → RESOLVED_CONFIRMED / RESOLVED_FAILED), whose recovery
   directive feeds A12 (finality advance, or a NEW instruction with a NEW
   rail idempotency key — never re-submission of the same external effect).
   The A14 authority owns the resolution; the ownership is protocol-level.
7. **Reconciliation:** the three layers reconcile through this contract
   chain: protocol (the frozen v0.1 area contracts the authorities implement
   — asserted by the merged suites re-run in this integration), product (the
   mapping records re-anchor later, under UI-011 — see question 9's honest
   deferral), system (this journey record + the RTN-012-updated deployment
   contract trio, machine-checked by the three validators). The
   sandbox/production boundary is stated honestly: sandbox topology, the
   simulated rails, no production financial execution claimed.
8. **Evidence:** the harness run itself — `node
   scripts/test_protocol_composed_journey.mjs` exit 0 with the eight scenario
   transcripts printed (wave-barrel exports:188; the golden path's 18-step
   transcript ending `chain:VERIFIED`; the UNKNOWN transcripts; the
   risk/rails real-log records; the duplicate/restart transcript; the chain
   verification incl. `tamper:TAMPER_DETECTED`; determinism
   `18-steps:identical`); the validators' exit-0 outputs; tsc 0 errors; bun
   test 1901 green. Mapped to the acceptance criteria per the work order.
9. **User-visible state:** **an explicit, honest deferral** (rtn-plan-rulings
   md delta 7 — a recorded deferral, never a silent gap): no product surface
   observes this journey today. The product ports (`src/lib/protocol/`) are
   still mock-backed (presentation-only, runtimeStatus 'ARRIVING'), and the
   RTN wave's forbidden-surface rule correctly kept them so; the re-anchoring
   is the UI-011 product-ledger item (rtn-plan-rulings.md Q5/delta 6), which
   owns the splice, the mock retirement, and the `spec/product/
   *-mapping-records.md` re-anchoring, with SYS-001/SYS-002 owning the
   three-layer reconciliation that will then answer this question by
   observation. Until then, the composed runtime's observable state is the
   protocol/runtime boundary's own: the A15 chain, the per-domain stores,
   the observation rows, and the gateway receipts — all asserted above.

Known gaps: none unanswered — question 9 is answered by the recorded
deferral above (the only question whose sufficient answer requires surfaces
this wave is forbidden to touch).

## The DEP-004 dispatchability memo (review evidence)

**Statement:** with RTN-001..RTN-011 merged and RTN-012's composed evidence
in hand, the DEP-004 dependency line "Depends on: DEP-003 + frozen protocol
authorities" is SATISFIED by the composed runtime this wave materialized:
DEP-003 (the durable execution substrate) is merged; the "protocol
authorities" are, per rtn-plan-rulings.md's Q2 interpretation, "the
operational authorities DEP-004's own objective and acceptance criteria
exercise — reconciliation, clearing, netting, and settlement support — whose
structural closure per spec/development-state/dependency-state.json is the
A01–A16 spine" — and that spine is now runtime code: the A14 reconciliation
semantics (the only exit from UNKNOWN), the A09 clearing batches, the A11
conservation-proofed netting, and the A12 settlement/finality support all
execute end-to-end over the DEP-003 substrate in the composed journey
(every acceptance-shaped behavior is exercised: jobs consume only
authoritative protocol state; UNKNOWN triggers reconciliation rather than
blind retry (the auto-case + the refused re-submissions); the
clearing/netting path is restart-safe and auditable (the lease-reclaim
replay with exactly one effect, the A15 chain); settlement-support work
never asserts finality itself (finality advances exactly once, only through
the protocol rule)). The wave-activation record's RTN wave 2 deferral of
A17–A24 (rtn-plan-rulings.md delta 2) is consistent with this reading: no
DEP-004 acceptance criterion touches A17–A24 (every growth area depends on
the spine, never the reverse).

**The dispatch-gate facts for the Tech Lead's post-merge reconciliation
act** (implementation-protocol.md — the status flip itself is the Tech
Lead's, not this item's): the gate is "RTN-001..RTN-011 hard requirements,
RTN-012 recommended before dispatch"; the hard requirements are merged (Git
facts at the base above); this item supplies the recommendation's evidence —
the composed golden path, the UNKNOWN paths, duplicate/restart safety, the
chain-verified real A15 log over the risk and rails authorities, and the
governed deployment-contract update whose validators all exit 0. DEP-004's
own jobs would be in-process background operations on this same substrate
(admission through the same gateway; execution through the same transition
path); no additional authority is required, and none may be invented
(rtn-plan-rulings.md Q4).

**Sandbox boundary (stated honestly):** the composed evidence demonstrates
behavior under the sandbox topology (simulated rails, no credentials). It is
NOT production financial execution and does not claim to be; DEP-005 remains
where real external transmission binding lands.

## Filed composition defects (for the Tech Lead's review attention)

Two sibling-surface mismatches were discovered by this integration item.
Neither is a composed-path invariant failure (no state mutated outside the
single-writer path; no GC/INV contract breached — verified by the composed
journey itself), so per the work order's stop-condition rule they are FILED,
not patched (the owning surfaces belong to RTN-010/RTN-011):

- **D-1 — the intent.submit body-shape mismatch.** RTN-010's gateway admits
  `intent.submit` with the DOCUMENTED nested body (`COMMAND-SURFACE.md`:
  `{ descriptor: DemandDescriptor, priorIntentId? }`, mirroring
  `IntentAuthority.submitIntent(descriptor, {priorIntentId})`), while
  RTN-011's hosted binding expects the RTN-011 harness's FLAT body
  convention. No single body satisfies both (the gateway rejects undeclared
  fields; the binding throws on the nested form). RTN-012's composed journey
  bridges this with an integration adapter binding INSIDE the harness (the
  owned evidence surface): it accepts the gateway's documented contract and
  drives the SAME `IntentAuthority.submitIntent` + the same persist hook —
  the gateway remains the sole admission point and the transition runtime
  remains the single writer. **Recommended follow-up:** a vocabulary-
  alignment work item (RTN-011's owned surface) converging the binding's
  body convention on the gateway's documented contract.
- **D-2 — the kind-vocabulary gap between the gateway registry and the
  hosted bindings.** RTN-010's registry names 112 kinds; RTN-011's hosting
  binds 44 (23 with identical names — including every kind the composed
  golden path drives through the gateway). Beyond the intersection, the
  siblings chose different names for overlapping surfaces (e.g. gateway
  `settlement.finality.declare` vs hosted `settlement.declare.finality`;
  gateway `reservations.hold.request` vs hosted `reservation.request`) and
  several gateway-admitted kinds have no hosted binding (policy, capability,
  routing, liquidity, credit, risk, queues item ops, …). Gateway-admitted
  commands of un-hosted kinds would sit WAITING on the durable path (the
  worker reserves only registered kinds) — no invariant is violated, but the
  composed runtime does not execute them. The composed journey drives those
  steps on the OWNING authorities' command surfaces (the RTN-005/006/009
  journey precedent), with every step still evidenced in the real A15 log.
  **Recommended follow-up:** the same vocabulary-alignment work item
  (extending the hosted bindings to the full gateway catalogue, or
  documenting the hosted subset as the durable-path surface).

Also recorded (a scoped review-gate update in a sibling's owned surface,
performed by this integration item and flagged for review attention): the
RTN-011 boundary review (hosting/boundary-review.test.ts) learned the RTN-012
wave barrel — check (g) now admits exactly `src/lib/protocol-runtime/index.ts`
as a re-export-only composition root, and a NEW check (h) mechanically
enforces that the barrel is pure re-exports (no construction, no command
call, no substrate reach). The gate is stronger, not weaker.

## Scoped verification (the assurance profile re-run over the composed system)

- `bunx tsc --noEmit` — 0 errors.
- `bun test` — 1901 pass / 0 fail (the merged suites still green).
- `node scripts/test_protocol_composed_journey.mjs` — all eight scenarios
  green (exit 0).
- The merged Node harnesses re-run green: kernel, evidence, authorities
  (risk), rails, gateway, routing/reservations, liquidity/credit/queues,
  clearing/obligations, netting/settlement, transition/hosting.
- `python3 scripts/validate_deployment.py` — PASS (635 checks, exit 0) with
  the updated contract.
- `python3 scripts/validate_governance.py` — PASS (exit 0).
- `python3 scripts/validate_durable.py` — PASS (69 checks, exit 0).
- `bun run build` — green (the Next.js production build).
