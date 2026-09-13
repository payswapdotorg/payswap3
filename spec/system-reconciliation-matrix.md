# PaySwap System Reconciliation Matrix — SYS-001

**Status:** NORMATIVE SYSTEM RECONCILIATION EVIDENCE (SYS-001 deliverable)
**Machine-readable companion:** `spec/system-reconciliation-matrix.json` (same journeys, same hops — the harness checks both agree)
**Harness:** `scripts/test_system_reconciliation.mjs` (every claim below is mechanically asserted)
**Built-app transport-binding proof:** `scripts/test_transport_binding.mjs` (D-1/D-2/D-3 against `bun run build` + the standalone server)
**Reconciliation contract:** `spec/system-reconciliation.md` (the seven-hop invariant)
**Work order:** `spec/system-work-orders/SYS-001.md`

## The seven hops

Every consequential product journey is traced through exactly seven hops
(spec/system-reconciliation.md's reconciliation invariant):

```text
product action (route/component)
→ canonical protocol object/state
→ owning protocol authority (the registry area)
→ API/runtime boundary (the port adapter / the sole admission point / the D-1 HTTP binding)
→ deployment component (the components.json id)
→ durable state/evidence (durable_jobs / domain stores / the A15 chain)
→ user-visible outcome (the presentation vocabulary)
```

A gap in any chain is a system integration defect, not permission to invent
a new authority. There are no gaps below: every cell names the exact
file+export or record type, and the harness verifies the named artifacts
exist, the journeys execute end-to-end over the composed runtime, and the
durability/authority/environment claims hold.

## The journeys

### J1-customer-pay — compose → review (consequence terms) → explicit submit → intent state

| Hop | Cell |
| --- | --- |
| Product action | `src/app/(customer)/pay/page.tsx` · `src/app/(customer)/pay/review/page.tsx` · `src/app/(customer)/pay/[intentId]/page.tsx` (+ `src/components/pay/{compose-intent,review-intent,intent-state}-view.tsx`) |
| Canonical object | `PaymentIntent` — states `INTENT_STATES` (`src/lib/protocol-runtime/intent/types.ts`): DRAFT → AUTHORIZED → ROUTED → FULFILLING → FULFILLED \| FAILED \| CANCELLED |
| Owning authority | **A01 Intent Authority** — `src/lib/protocol-runtime/intent/authority.ts` `IntentAuthority.submitIntent` / `getIntent` |
| API/runtime boundary | `getIntentPort()` (`src/lib/protocol/intent-port.ts`) → `createRuntimeIntentAdapter` (`src/lib/protocol/runtime-intent-adapter.ts`) → `ProtocolGateway.submitCommand` kind `intent.submit`; HTTP binding `POST /api/protocol/commands` (`src/app/api/protocol/commands/route.ts`) |
| Deployment component | web-api-boundary · protocol-gateway · transition-runtime · durable-command-queue · authoritative-state-store · evidence-object-store |
| Durable state/evidence | `var/web-runtime/durable.sqlite` `durable_jobs` (kind `intent.submit`, UNIQUE(idempotency_key, kind)); `var/web-runtime/intent.sqlite` (openIntentStore write-through); A15 records `INTENT_CREATED` / `INTENT_STATE_CHANGED` / `INTENT_AUTHORIZED` / `GATEWAY_COMMAND_REJECTED` in `var/web-runtime/evidence.sqlite` |
| User-visible outcome | `SubmitResult` (transported \| not-transported \| refused); `IntentQueryResult` (snapshot with `StateReport` \| no-answer = UNKNOWN with reconciliation path); mapping records `spec/product/intent-mapping-records.md` |

### J2-track — reference lookup → tracked view with evidence trail

| Hop | Cell |
| --- | --- |
| Product action | `src/app/track/page.tsx` · `src/app/track/[referenceId]/page.tsx` |
| Canonical object | `PaymentIntent` (the tracked reference is the protocol object id) |
| Owning authority | **A01 Intent Authority** — `getIntent` (read surface) |
| API/runtime boundary | `getTrackingPort()` (`src/lib/protocol/tracking-port.ts`) → `createRuntimeTrackingAdapter` (`src/lib/protocol/runtime-tracking-adapter.ts`) |
| Deployment component | web-api-boundary · authoritative-state-store · evidence-object-store |
| Durable state/evidence | read surface over the J1 durable path; A15 `INTENT_CREATED` / `INTENT_STATE_CHANGED` |
| User-visible outcome | `TrackingLookupResult` (tracked: `TrackedReferenceView` + evidence trail \| not-found: explicit wording, never fabricated); mapping records `spec/product/tracking-mapping-records.md` |

### J3-waiting-queued — queue membership, waiting panel, re-check and recovery requests

| Hop | Cell |
| --- | --- |
| Product action | `src/app/track/[referenceId]/waiting/page.tsx` (+ `src/components/track/waiting-{inquiry-form,recovery-panel}.tsx`) |
| Canonical object | `QueuedItemRecord` — states `ITEM_STATES` (`src/lib/protocol-runtime/queues/types.ts`): QUEUED \| ELIGIBLE \| DISPATCHED \| GRADUATED \| CANCELLED \| EXPIRED |
| Owning authority | **A08 Queue Authority** — `src/lib/protocol-runtime/queues/authority.ts` `QueueAuthority.enqueueItem` / `evaluateEligibility` / `cancelItem` |
| API/runtime boundary | `getWaitingPort()` (`src/lib/protocol/waiting-port.ts`) → `createRuntimeWaitingAdapter` (`src/lib/protocol/runtime-waiting-adapter.ts`) → gateway kinds `queues.item.enqueue` / `queues.eligibility.evaluate` / `queues.item.cancel`; HTTP binding `POST /api/protocol/commands` |
| Deployment component | web-api-boundary · protocol-gateway · transition-runtime · durable-command-queue · scheduler · authoritative-state-store · evidence-object-store |
| Durable state/evidence | `durable_jobs` (queues.* kinds); `var/web-runtime/queues.sqlite` (openQueuesStore); A15 `ITEM_QUEUED` / `ITEM_*` records (subjectIds = [itemId, queueId, intentId]) |
| User-visible outcome | `WaitingLookupResult` (found: `WaitingSnapshot` \| not-found \| role-denied); `WaitingInquiryResult` / `WaitingRecoveryRequestResult` (accepted \| rejected \| denied — never silent success); mapping records `spec/product/waiting-mapping-records.md` |

### J4-unknown-reconciliation — UNKNOWN outcome + reconciliation

| Hop | Cell |
| --- | --- |
| Product action | `src/app/(customer)/pay/[intentId]/page.tsx` · `src/app/track/[referenceId]/page.tsx` · `src/app/(operator)/oversight/page.tsx` · `src/app/track/[referenceId]/waiting/page.tsx` |
| Canonical object | the no-answer arms (`IntentQueryResult.no-answer`, `TrackingLookupResult.not-found`, `ProviderPositionsResult.denied`); `ReconciliationCase` (A14: OPEN → INVESTIGATING → RESOLVED_CONFIRMED \| RESOLVED_FAILED \| RESOLVED_ADJUSTED \| MATCHED); the settlement UNKNOWN-hold |
| Owning authority | **A14 Reconciliation Authority** (the only exit from UNKNOWN — GC-2) — `src/lib/protocol-runtime/rails/reconciliation.ts` `ReconciliationAuthority`; co-owner **A12 Settlement and Finality Authority** (UNKNOWN-hold, finality gate, resolutions exactly once) |
| API/runtime boundary | the seven ports' no-answer arms; gateway kinds `reconciliation.source.register` / `reconciliation.cycle.{open,statements.collect,matching.run,close}` / `settlement.finality.declare` (typed refusal UNKNOWN_HELD/NOT_PROVISIONAL over unresolved outcomes); HTTP binding `POST /api/protocol/commands` |
| Deployment component | web-api-boundary · protocol-gateway · reconciler-workers · netting-settlement-workers · transition-runtime · durable-command-queue · evidence-object-store |
| Durable state/evidence | `durable_jobs` (reconciliation.\*/settlement.\* kinds); `var/web-runtime/rails.sqlite` (cases/cycles/sources + settlement); A15 `RECONCILIATION_*` records; the full rail-UNKNOWN auto-case → resolution → finality-once path is evidenced by `scripts/test_protocol_composed_journey.mjs` (kept green by the SYS-001 gate battery) |
| User-visible outcome | UNKNOWN presented as UNKNOWN with its reconciliation path on every arm (no-answer, not-found, denied) — never translated to success or failure; recovery wording names who resolves |

### J5-merchant-checkout — offer/status/queue reads and the fail-closed decision surface

| Hop | Cell |
| --- | --- |
| Product action | `src/app/(merchant)/checkout/page.tsx` · `src/app/(merchant)/checkout/[checkoutId]/page.tsx` (+ `src/components/merchant/checkout-decision-controls.tsx`) |
| Canonical object | `PaymentIntent` (the checkout offer/state reads the A01 record; the checkout-session authority itself is area 20, RTN wave 2 — deferral-ledger D-8) |
| Owning authority | **A01 Intent Authority** (read surface); checkout decisions own NO authority (area 20 is wave 2 — fail closed) |
| API/runtime boundary | `getCheckoutPort()` (`src/lib/protocol/checkout-port.ts`) → `createRuntimeCheckoutAdapter` (`src/lib/protocol/runtime-checkout-adapter.ts`) |
| Deployment component | web-api-boundary · authoritative-state-store · evidence-object-store |
| Durable state/evidence | read surface over the J1 durable path (no command path for checkout decisions — fail closed) |
| User-visible outcome | `CheckoutOfferResult` / `CheckoutStatusResult` / `CheckoutQueueResult`; `CheckoutDecisionResult` REFUSED `decision-not-allowed` — nothing committed, nothing fabricated; mapping records `spec/product/checkout-mapping-records.md` |

### J6-liquidity-credit-visibility — provider positions and operator oversight

| Hop | Cell |
| --- | --- |
| Product action | `src/app/(provider)/liquidity/page.tsx` · `src/app/(operator)/oversight/page.tsx` |
| Canonical object | liquidity positions (A06, over the A05 reservation ledger) + credit lines/exposure (A07) + queue aggregates (A08) |
| Owning authority | **A06 Liquidity Authority** (`src/lib/protocol-runtime/liquidity/authority.ts` `LiquidityAuthority.positionsOf`) + **A07 Credit Authority** (`src/lib/protocol-runtime/credit/authority.ts` `CreditAuthority.linesInOrder`/`lineExposure`) |
| API/runtime boundary | `getLiquidityPort()` (`src/lib/protocol/liquidity-port.ts`) → `createRuntimeLiquidityPortFactory` (`src/lib/protocol/runtime-liquidity-adapter.ts`) |
| Deployment component | web-api-boundary · authoritative-state-store · evidence-object-store |
| Durable state/evidence | read surface over `var/web-runtime/reservations.sqlite` + `queues.sqlite` (created through the A05/A08 command paths) |
| User-visible outcome | `ProviderPositionsResult` / `OperatorOversightResult` (permitted with authoritative figures \| denied fail-closed) — aggregates annotate UNKNOWN where a read-surface gap is recorded, never fabricated zeros; mapping records `spec/product/liquidity-mapping-records.md` |

### J7-mediation-dispute — the party docket, dispute initiation, the dispute record

| Hop | Cell |
| --- | --- |
| Product action | `src/app/mediation/page.tsx` · `src/app/mediation/dispute/new/page.tsx` · `src/app/mediation/dispute/[disputeId]/page.tsx` · `src/app/mediation/case/[caseId]/page.tsx` · `src/app/mediation/proposal/[proposalId]/page.tsx` · the five `src/app/api/mediation/*/route.ts` endpoints |
| Canonical object | `ObligationRecord` (A10: CREATED → NETTED → SETTLEMENT_PENDING → DISPUTED → …; the dispute primitive terminalizes an OUTSTANDING obligation into DISPUTED) |
| Owning authority | **A10 Obligation Authority** — `src/lib/protocol-runtime/obligations/authority.ts` `ObligationLedgerAuthority.openDispute` / `applyClearingCommand` |
| API/runtime boundary | `getMediationPort()` (`src/lib/protocol/mediation-port.ts`) → `createRuntimeMediationAdapter` (`src/lib/protocol/runtime-mediation-adapter.ts`) → gateway kinds `obligations.clearing.commit` / `obligations.dispute.open`; HTTP binding `POST /api/protocol/commands` |
| Deployment component | web-api-boundary · protocol-gateway · transition-runtime · durable-command-queue · authoritative-state-store · evidence-object-store |
| Durable state/evidence | `durable_jobs` (obligations.\* kinds); `var/web-runtime/obligations.sqlite` (openObligationsStore); A15 `OBLIGATION_CREATED` / `OBLIGATION_STATE_CHANGED` (dispute id as cause reference) |
| User-visible outcome | `DisputeInitiationResult` (initiated: `DisputeRecord` authorityState `open` — the EXECUTED DISPUTED state, per the D-3 remediation \| denied: authority-grounded refusals); `PartyDocket`; `PortFetch` (fetched \| not-visible \| unavailable); mapping records `spec/product/mediation-mapping-records.md` |

### J8-capability-provider — the capability registry listing and detail

| Hop | Cell |
| --- | --- |
| Product action | `src/app/(provider)/capabilities/page.tsx` · `src/app/(provider)/capabilities/[capabilityId]/page.tsx` |
| Canonical object | `CapabilityRecord` (A03: REGISTERED/PENDING → ACTIVE → DEGRADED/RETIRED; activation compliance-gated by A16) |
| Owning authority | **A03 Capability Authority** — `src/lib/protocol-runtime/capability/authority.ts` `CapabilityAuthority.registerCapability` / `activateCapability` / `snapshot` |
| API/runtime boundary | `getCapabilityPort()` (`src/lib/protocol/capability-port.ts`) → `createRuntimeCapabilityAdapter` (`src/lib/protocol/runtime-capability-adapter.ts`) → gateway kinds `capability.register` / `capability.activate`; HTTP binding `POST /api/protocol/commands` |
| Deployment component | web-api-boundary · protocol-gateway · transition-runtime · evidence-object-store |
| Durable state/evidence | `durable_jobs` (capability.\* kinds); the A03 registry is in-memory per composition with the A15 chain (`CAPABILITY_REGISTERED`, `CAPABILITY_STATE_CHANGED`) as the durable record — no per-domain capability store is composed (recorded honestly) |
| User-visible outcome | `CapabilityListing` (items + sources + boundary) — states mapped per the frozen vocabulary; browser contexts render the honest non-authoritative empty listing with the boundary note (never an authoritative zero claim); mapping records `spec/product/capability-mapping-records.md` |

## The system-level proofs (the work order's acceptance)

1. **No duplicate ledger/settlement/finality authority.** The ONE production
   composition root (`src/lib/protocol/server-runtime.ts`) constructs every
   authority once per process; `src/lib/protocol/product-adapter-test-compose.ts`
   is the bun test-only double; no other product-layer file constructs an
   authority; the mock shims are RETIRED/NON-AUTHORITATIVE and register
   nothing. Mechanically asserted by the harness's `recon:authority` group.
2. **No UI-only financial truth.** src/app/** and src/components/** contain
   zero protocol-runtime imports (the splice guard, re-verified); the port
   modules fall back to the honest transport-unavailable backing; every
   effect flows through the durable command path (the `recon:no-bypass`
   group: durable_jobs rows for every kind, terminal statuses, domain-store
   rows, the hash-verified A15 chain).
3. **No deployment bypass.** Every submitted command leaves its durable job
   row and its A15 record; the evidence chain verifies end-to-end
   (`verifyAndRecord` → VERIFIED).
4. **Explicit environment isolation.** The allowlist is exactly
   `sandbox|production` with fail-safe `sandbox`; the startup gate refuses
   production without its four required names (sandbox config can never
   satisfy production gates); the components.json agreement holds
   (`recon:environment`).
5. **UNKNOWN/waiting/recovery preservation.** The no-answer arms stay
   no-answer across every probed port; finality is never asserted over
   unresolved outcomes; the dispute record presents the executed DISPUTED
   state (the D-3 latent mis-presentation is unreachable); the unavailable
   backing still presents not-transported/no-answer as UNKNOWN
   (`recon:p5`).

## Change record

- **SYS-001** generated this matrix (base `main @ 46507326265aa5be869d0389f0414d5c7c28f762`)
  as the three-architecture reconciliation evidence: the D-1/D-2/D-3
  transport-binding remediation (the HTTP binding, the route-reachable
  composition, the bounded drain), this matrix + its machine-readable
  companion, and the two harnesses
  (`scripts/test_system_reconciliation.mjs`, `scripts/test_transport_binding.mjs`).
