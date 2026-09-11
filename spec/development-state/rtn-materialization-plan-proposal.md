<!--
PROPOSAL — NOT A GOVERNED WORK PROGRAM YET.

Produced by the RTN-INVESTIGATION worker session (2026-09-11, dispatched by
the Tech Lead under the bounded-investigation authority of the takeover
handoff). This document proposes the runtime-materialization wave; it creates
no work. The Tech Lead reviews it; the Architect approves the wave before any
RTN work order enters the repository. Base inspected: 0ccb640.
-->

# Protocol Runtime Materialization Plan (proposal)

Investigation: RTN-INVESTIGATION (bounded investigation; no production code written, no repo files modified)
Repository: payswapdotorg/payswap3, cloned read-only to /tmp/payswap3-invest
Base SHA inspected: 0ccb640f41f7a246cbfac3c3521885772dd4f3f9 (main; matches the stated base 0ccb640 — main has not moved past it)
Status of this document: PROPOSAL — the Tech Lead reviews it; the Architect approves the wave. This investigation holds no authority to create work.

## 1. The evidence-based answer

Answer: B — the protocol runtime must be implemented as a NEW governed system/runtime work program (a wave of new work orders materializing the frozen v0.1 authorities). The prior Tech Lead's analysis is verified.

Where do WORK-001..WORK-033's protocol authorities become executable runtime code? Nowhere in the repository at 0ccb640. They exist only as frozen semantic contracts in spec/architecture/v0.1/. The repository itself says so, repeatedly and consistently:

WORK-001..WORK-033 delivered specification documents, not code. spec/work-orders/WORK-ORDERS-LEDGER.md records every one of the 33 items as a definition task — e.g. | WORK-001 | Define intent and demand semantics and state machine | 1 | COMPLETE | protocol-v0.1-materialization | — with the merge-as column uniformly protocol-v0.1-materialization, and the ledger header: "Status: all protocol work orders COMPLETE; protocol frontier closed." The deliverable of WORK-001..WORK-033 is the frozen v0.1 spec directory.

The frozen spec explicitly prescribes no implementation. spec/architecture/v0.1/README.md §9: "This directory defines semantics only; it intentionally prescribes no implementation, storage, or service decomposition."

The deployment component contract marks all 9 runtime components as future work, with the RTN wave as their provenance. deploy/contracts/components.json — every one of protocol-gateway, transition-runtime, scheduler, reconciler-workers, netting-settlement-workers, durable-command-queue, authoritative-state-store, evidence-object-store, external-rail-adapters carries "exists_in_repository_today": false and markers such as "FUTURE-WORK: protocol runtime per dependency graph WORK-001..WORK-033; infrastructure binding from DEP-002 onward" (protocol-gateway) and "FUTURE-WORK: protocol adapter semantics per dependency graph WORK-001..WORK-033; credential binding from DEP-002 onward" (external-rail-adapters).

The deployment state names this exact missing piece and this exact wave. spec/development-state/system-program-state.json: "DEP-004 BLOCKED (requires protocol authorities as runtime code — not yet materialized)" and "Deployment chain pauses at DEP-004 pending protocol-authority runtime materialization (a future governed wave; runtime-materialization investigation dispatched under governance)." Git history confirms: 5877b11 reconcile: DEP-003 merged (b3bc430, PR #9); deployment chain pauses at DEP-004 (blocked on protocol-authority runtime).

The product ports are presentation seams whose real backing is explicitly "ARRIVING". src/lib/protocol/intent-port.ts: "The protocol runtime — and with it the Intent Authority's real state vocabulary — is ARRIVING with the protocol runtime program. When it lands, this port is re-anchored to the runtime and the mock is retired; the surfaces do not change shape." The typed field: readonly runtimeStatus: 'ARRIVING'; readonly implementation: 'mock (non-authoritative, presentation-only)'. Same for capability-port.ts ("explicitly NON-AUTHORITATIVE, presentation-only, runtime ARRIVING") and tracking-port.ts ("The only backing at runtime is the presentation-only mock... explicitly NON-AUTHORITATIVE").

The durable substrate is capacity, not authority — and names its own integration point for exactly this wave. src/lib/durable/index.ts: "this module hosts no financial authority, decides no financial outcomes, computes no balances, and signs nothing. Future protocol authorities plug in via register() and own their own evidence via recordEvent(type, data, owner)." spec/durable/execution.md §1: "The ONLY integration point for execution semantics is handler registration: register(kind, handler). Future protocol authorities plug in there."

A full enumeration of git ls-files src/ shows no protocol runtime code anywhere. The tree contains only: product UI components (src/components/...), app routes (src/app/...), the three product ports + three mocks + three state mappings (src/lib/protocol/), the DEP-003 substrate (src/lib/durable/), and product-side helpers (src/lib/pay-flow/, src/lib/navigation.ts, src/lib/environment.ts, src/lib/shell-guard.ts, src/lib/startup-config.ts).

Refutations of the alternatives

A (runtime already exists in the repo): REFUTED. No authority state machine, command path, gateway, transition runtime, or authoritative store exists as code (evidence items 3, 5, 7). spec/deployment/topology.md "As-of-today overlay": "Of the nodes above, exactly one exists as repository code today: the Web/API boundary application... All nodes behind the boundary are specified-but-not-yet-in-repo. Until their governed work items land, the durable command path, workers, scheduler, persistence, queue, evidence storage and adapters exist only as this contract's requirements."

C (already partially present in another repository path): REFUTED for the authorities. The two in-repo assets that resemble runtime pieces are deliberately non-authority: the product ports (presentation contracts; the ports themselves disclaim authority) and the DEP-003 substrate (deployment-owned capacity; "It is NOT, and must never become: a financial authority" — spec/durable/execution.md §1). Neither contains any of the 24 area state machines. What exists is capacity and seams, not authority. (These assets are valuable and are reused by the proposed wave — see §2 and §3.)

D (intentionally deferred by the architecture): REFUTED as stated. The architecture does not defer the runtime indefinitely; it makes it the gating work: DEP-004's dependency line names it, components.json's future-work markers schedule it, the ports await it ("ARRIVING"), and the system state dispatches this very investigation to design it. Deferral of DEP-004 is blocked-on, not waived-by, the architecture.

## 2. The target runtime shape (from the architect; verified against spec)

The architect's diagram is verbatim the execution topology of spec/system-architecture.md, which spec/deployment/topology.md quotes with: "The deployment topology must realize exactly this shape; nothing in this contract may redraw it."


```
Web/API → Protocol Gateway → Durable Command Path → Transition Runtime → Authoritative State
                                          + Evidence Store + External Rail Adapters (behind protocol control)
Background: scheduler, reconcilers, netting/settlement workers
```

Two governing one-per-system rules from spec/deployment/topology.md ("Runtime ownership of protocol authorities"): "There is exactly one protocol-command admission point (protocol-gateway) and exactly one authoritative-state writer (transition-runtime)."

Mapping the 9 FUTURE-WORK components to the 24 registry areas

COMPONENT (COMPONENTS.JSON)
	
LAYER
	
AUTHORITY HOSTED (QUOTED FROM COMPONENTS.JSON)
	
REGISTRY AREAS / AUTHORITIES IT HOSTS
	
PROPOSED REPOSITORY SURFACE (THIS WAVE)

protocol-gateway	protocol	"protocol authorities per the system architecture hard boundaries — identity, authority, values, accounting, intent, demand, capability, market, liquidity, credit, reservations, routing/compiler, execution admission, clearing, obligations, risk/compliance, recourse, federation — enforced inside a deployment-owned process; the sole admission point for protocol commands"	A01 Intent, A02 Fulfillment Policy, A03 Capability, A04 Routing, A05 Reservations, A06 Liquidity, A07 Credit, A08 Queues, A16 Risk/Compliance — as the command admission surface (identity/values/accounting map to the kernel + A10; "market" is an open question, §6-Q4)	src/lib/protocol-runtime/gateway/ (RTN-010)
transition-runtime	protocol	"authoritative state transitions — execution, clearing, obligations, netting, settlement, finality (protocol-owned) — applied as the single writer to authoritative-state-store"	The single-writer transition path for all area state machines A01–A12, A16 (A09 Clearing, A10 Obligations, A11 Netting, A12 Settlement/Finality transitions are its headline load)	src/lib/protocol-runtime/transition/ + hosting/ (RTN-011)
scheduler	deployment	"none — emits timing-driven commands into the durable command queue; owns timing only, never mutates authoritative state and never reaches external rails"	No area (timing only; drives A08 queue eligibility, A09 clearing batches, A11 netting cycles, A14 reconciliation cycles by commands)	DEP-003 substrate's scheduler.ts (merged) + wiring pattern (RTN-011)
reconciler-workers	protocol	"protocol-owned reconciliation semantics — compares authoritative state against external evidence and submits corrective commands through the protocol gateway; never mutates authoritative state directly and never reaches rails directly"	A14 Reconciliation Authority	src/lib/protocol-runtime/rails/ (authority, RTN-004); jobs are DEP-004's scope
netting-settlement-workers	protocol	"netting, settlement and finality computation (protocol-owned) executed as deployment-owned background processes; corrections after finality flow only through protocol-governed recourse — deployment rollback never un-finalizes"	A11 Netting Authority + A12 Settlement and Finality Authority (computation; FINAL is written via the single-writer path per INV-12-4)	src/lib/protocol-runtime/netting/, settlement/ (RTN-009); jobs are DEP-004's scope
durable-command-queue	deployment	"none — durable, at-least-once transport for protocol commands... ordering and durability only, no financial semantics"	No area (transport). In-process capacity already merged as the DEP-003 substrate queue	Reuse src/lib/durable/queue.ts read-only (integration, not modification)
authoritative-state-store	protocol	"protocol-owned authoritative state (identity, accounting, reservations, obligations, settlement and finality records) on deployment-owned persistence infrastructure; mutated only by transition-runtime through protocol-owned transitions — no other layer may mutate it directly"	Persistence of A01–A12, A16 primary objects	Per-domain stores inside each authority surface (RTN-001 convention; RTN-005..009)
evidence-object-store	protocol	"protocol-owned evidence records — command and decision evidence written by protocol components, plus external evidence ingested through the rail adapters — on deployment-owned object storage; append-only, never edited or deleted within retention"	A15 Evidence Authority (EvidenceRecord/EvidenceLog; cross-cutting INV-15-1..4)	src/lib/protocol-runtime/evidence/ (RTN-002)
external-rail-adapters	deployment	"none — the only component that transmits to external rails; transmits exclusively protocol-authorized outputs and cannot originate or alter financial decisions; holds rail credentials and fails closed when they are absent; ingests external evidence into evidence-object-store"	A13 external rail adapters + A23 blockchain rails as transmission boundary; the A13 Rail Adapter Authority's semantics (registry, RailOperation lifecycle) are protocol-owned (open question §6-Q1 on where that state lives)	src/lib/protocol-runtime/rails/ (protocol semantics, RTN-004) + simulated rails (non-production; see topology.md: "development, test-ci, sandbox and staging use protocol-owned simulated rails — same interface, no external transmission, no real credentials, no signing capability")

Materialization mode: in-process first (the DEP-003 precedent)

The wave proposes to materialize the 9 components as repository code hosted in-process inside the existing web-api-boundary application, exactly as DEP-003 did for the durable substrate: spec/durable/execution.md §1: "an in-process execution fabric that lives inside the existing web-api-boundary application (no new deployed component; the FUTURE-WORK components in deploy/contracts/components.json remain future work and their present-set is untouched)." Externalization into separately deployed processes (if ever) remains deployment-layer binding — components.json field semantics: "the deployment layer owns process topology... for every deployed component", and the markers say "infrastructure binding from DEP-002 onward." The governed components.json presence update rides one work item (RTN-012), per topology.md "Contract evolution": "Adding, removing or re-scoping components... is a governed change that updates deploy/contracts/components.json, the spec/deployment/ documents and scripts/validate_deployment.py together in one work item."*

## 3. The proposed work-order decomposition (RTN wave)

Scope decision (evidence-based)

This wave materializes the DEP-004-unblocking spine: areas A01–A16 (intent → settlement/finality, rails/adapters/reconciliation, evidence, risk/compliance). DEP-004's own text scopes its need: "Run durable operational processes for reconciliation, clearing, netting and settlement support through existing protocol authorities" (DEP-004.md) — i.e., the operational authorities, not the growth surfaces. A17–A24 (simulation/replay, marketplace, agents, merchant primitives, disputes/recourse, federation, blockchain rails, emergence) are deferred to a follow-on governed wave (RTN wave 2), because: (a) none of them is a structural dependency of DEP-004; (b) spec/development-state/dependency-state.json shows them depending on the A01–A16 spine (e.g. A20 merchant dependsOn A01/A04/A12; A21 disputes dependsOn A12/A13/A14; A24 emergence dependsOn A01/A03/A18); (c) SYS-002 dogfooding, which does require several of them, is gated behind DEP-008/product closure in spec/system-work-items.md. This scoping needs Architect confirmation (open question §6-Q2).

Wave governance preamble

Work-order documents materialize at wave activation in a new spec/protocol-runtime-work-orders/ directory (a Tech Lead act, mirroring spec/system-work-orders/); workers' owned surfaces are code surfaces only.
Every dispatch carries the full 13-field execution context of spec/governance/agent-dispatch.md (repository, base_sha, work_item_id, architecture_authority, hard_dependencies, contract_dependencies, owned_surfaces, forbidden_surfaces, assurance_profile, required_proofs, dogfooding_requirements, checkpoint_contract, stop_conditions) and validates against agents/schemas/execution-context.schema.json.
Antichain discipline per spec/governance/parallel-execution.md: hard dependencies merged (Git facts), owned-surface disjointness verified in the actual repository tree, ≤3 concurrent workers per antichain, no sibling consumes unmerged sibling code, workers never merge (spec/governance/implementation-protocol.md — the Architect is sole merge authority; six review gates).
Shared forbidden surfaces (all items): spec/architecture/v0.1/ (frozen semantics), spec/architecture-change-requests/, src/lib/protocol/ (product ports), src/lib/durable/ (except read-only integration: import + register()/db API), spec/product/, src/components/, src/app/.
Persistence convention (decided in RTN-001): each authority domain owns its schema and per-domain migrations inside its owned prefix, using the DEP-003 database layer read-only. This keeps sibling surfaces disjoint (a shared deploy/migrations/ prefix would collide between parallel siblings). The spec permits this: v0.1 "prescribes no implementation, storage, or service decomposition."
Evidence discipline: every consequential operation writes an A15 record through the kernel-declared EvidenceSubmission port; where the real evidence log is not yet a hard dependency (RTN-003, RTN-004), the item tests against an owned in-surface test double of the port and the real-log integration is proven in RTN-012 (integration items re-run the full assurance profile: "constituent evidence does not compose" — parallel-execution.md).

Antichain schedule (max width 3; all owned prefixes disjoint — none exists in the tree today; no prefix is an ancestor of a sibling's prefix)

ANTICHAIN
	
ITEMS (CONCURRENT WORKERS)
	
NOTES

1	RTN-001	Kernel; everything depends on it
2	RTN-002 ∥ RTN-003 ∥ RTN-004	The three roots (A15, A16, A13/A14) — max parallelism 3
3	RTN-005	A01→A02→A03 chain (A04/A05 wait on it)
4	RTN-006	A04→A05
5	RTN-007	A06–A08 (needs RTN-004 for A13/A14 edges)
6	RTN-008	A09–A10
7	RTN-009	A11–A12
8	RTN-010 ∥ RTN-011	Gateway ∥ transition/hosting (disjoint: gateway/ vs transition/+hosting/)
9	RTN-012	Wave integration + governed deployment-contract update

Single-worker antichains 3–7 are a deliberate serialization: dependency-state.json makes the A01→A05→A09→A12 spine a chain, and parallel-execution.md forbids making items parallel by weakening conditions ("items that fail any condition wait; they are never made parallel by weakening the condition").

RTN-001 — Protocol runtime kernel: money, identity, time, and the command envelope

Status: PLANNED
Depends on: DEP-003 (merged b3bc430, PR #9 — substrate provides db/queue/worker/scheduler/events read-only)
Owned surfaces: src/lib/protocol-runtime/kernel/
Forbidden surfaces: protocol semantic changes to spec/architecture/v0.1/; any second financial authority; src/lib/protocol/ product ports; src/lib/durable/ (read-only integration only: import db API, register()); spec/architecture-change-requests/; spec/product/; src/components/; src/app/

Objective

Materialize the area-agnostic foundation every authority builds on, exactly as specified in the shared conventions of spec/architecture/v0.1/core.md §0: Money ("signed integer minor units, 3-letter currency code, explicit decimal scale per currency. No floating point anywhere (GC-1)") and MoneyBag ("set of (currency, integer amount) entries; addition and subtraction are entrywise and deterministic"); deterministic id and idempotency-key derivation; protocol time (sequenced + wall); the command envelope (the payload contract of the durable command path); the shared reason-code vocabulary; the EvidenceSubmission port declaration; and the per-domain persistence convention on the DEP-003 database layer.

Acceptance

Money is integer-only by construction: float construction and float arithmetic are unrepresentable; every operation is deterministic on identical inputs (G1).
MoneyBag addition/subtraction is entrywise, deterministic, and per-currency.
Command envelope validates (authority target, subject ids, idempotency key, protocol time) and maps 1:1 onto the DEP-003 enqueue idempotency contract (UNIQUE (idempotency_key, kind)).
EvidenceSubmission port declared with the A15 five-slot shape (what/when/authority/outcome/proof).
Per-domain persistence convention documented and demonstrated: a kernel-owned store opens via the DEP-003 db module with a migration directory inside the kernel prefix.
No kernel type invents semantics absent from v0.1 §0 — every exported type cites its spec source in doc-comment.

Required evidence

Typecheck (tsc --noEmit) clean; arithmetic conformance tests incl. repeated-run determinism; negative tests (float construction rejected, currency-code mismatch rejected); migration-runner exercise; contract-review table mapping each kernel type to its spec/architecture/v0.1/ source line.

Stop conditions

Any need to alter spec/architecture/v0.1/; any need to give the kernel financial decision semantics beyond §0; DEP-003 substrate API insufficient for the persistence convention (escalate CONTRACT_BLOCKER — do not modify src/lib/durable/); discovery of a contradiction between §0 conventions.

RTN-002 — Evidence Authority and evidence-object-store (area 15)

Status: PLANNED
Depends on: RTN-001
Owned surfaces: src/lib/protocol-runtime/evidence/
Forbidden surfaces: (shared set)

Materialize the A15 Evidence Authority and the in-process evidence-object-store component: EvidenceRecord with exactly the five mandatory semantic slots; the append-only, totally sequenced, hash-chained EvidenceLog ("Each record's proof includes the hash of its predecessor, making tampering detectable"); deterministic chain verification; the write discipline "an operation is not committed until its record is written. A failed write fails the operation" (A15, Failure semantics); and the EvidenceSubmission port implementation for all other authorities ("All other authorities are writers-by-submission only; none can alter or suppress records").

Records are immutable: no update or delete path exists in code (INV-15-2).
The hash chain verifies deterministically from genesis (INV-15-3); tampering with any record is detectable.
Evidence write keys derived from subject operation id prevent duplicate records for one operation (INV-15-4).
Record fields are exactly what/when/authority/outcome/proof (GC-5); authority names are the registry's owning authorities.
Log lifecycle events (genesis, verification runs) are themselves recorded.
Every consequential-operation test in later items can rely on a synchronous commit coupling exposed by this module.

Chain-verification tests (genesis, append, verify, tamper-detect); duplicate-write no-op test; append-only negative test (mutation attempt unrepresentable); evidence schema conformance test against the A15 section; a written mapping of each product-port evidence shape (src/lib/protocol/tracking-port.ts IntentEvidenceRecord) to A15 slots (read-only comparison; no product file changes).

Any pressure to make evidence writes asynchronous with the operation they record (violates GC-5/A15); schema contradiction between A15 and the registry; need to reuse the substrate's lifecycle events table as the A15 log (they are different things — substrate events are substrate-owned, A15 is protocol-owned; escalate if conflation is required).

RTN-003 — Risk and Compliance Authority (area 16)

Status: PLANNED
Depends on: RTN-001 (contract dependency: RTN-002's EvidenceSubmission port as declared in the kernel; real-log integration proven in RTN-012)
Owned surfaces: src/lib/protocol-runtime/risk/
Forbidden surfaces: (shared set)

Materialize the A16 Risk/Compliance Authority: RiskRule (AUTHORED→VERSIONED→ACTIVE→RETIRED); ComplianceCheck (EVALUATED→terminal(APPROVED | DENIED | MANUAL_REVIEW)→after review APPROVED|DENIED); ScreeningResult (COMPUTED→terminal(CLEAR | HIT)); gating semantics — "state transitions gated by compliance (intent AUTHORIZATION, capability ACTIVATION) cannot complete without a terminal APPROVED record for the subject" (INV-16-3); deterministic evaluation as "a pure function of (rule version, screening list version, subject data hash)" (INV-16-1); HIT handling ("HIT creates a MANUAL_REVIEW ComplianceCheck; auto-decision is forbidden for hits").

Rule versioning lifecycle exact; immutable rule definitions with explicit evaluation signatures.
Check lifecycle exact incl. MANUAL_REVIEW as a durable state and reviewed decisions recording reviewer authority identity and reason.
Identical inputs (rule version, list version, subject hash) always produce the identical recorded outcome — machine-checked determinism (INV-16-1).
All threshold comparisons use integer Money or integer counts; no floats (INV-16-2).
Check ids keyed by (subject id, rule set version); re-evaluation returns the recorded result (INV-16-4).
Undecided checks block gated transitions — demonstrated via the gate interface other authorities will call.
CHECK_DECIDED / SCREENING_COMPUTED / REVIEW_RECORDED records emitted through the EvidenceSubmission port.

State-machine conformance tests (every legal transition; every illegal transition rejected); determinism property tests; gating negative test (blocked transition without APPROVED); HIT→MANUAL_REVIEW no-auto-decision test; evidence emission tests against an owned test double of the port; typecheck clean.

Any need to move screening-list contents or review authority semantics into product or deployment layers; a rule semantics requirement that cannot be expressed as a pure function; spec contradiction on check lifecycle.

RTN-004 — Rail Adapter Authority semantics and Reconciliation Authority (areas 13–14)

Status: PLANNED
Depends on: RTN-001 (contract dependency: RTN-002's port as declared in the kernel; real-log integration proven in RTN-012)
Owned surfaces: src/lib/protocol-runtime/rails/
Forbidden surfaces: (shared set) + any external network transmission from non-production environments; any rail credentials in source

Materialize the A13 external rail adapter boundary and the A14 Reconciliation Authority as protocol-owned semantics with protocol-owned simulated rails (per topology.md's simulation rule for non-production environments):

A13: RailAdapter (REGISTERED→ACTIVE→DEGRADED→RETIRED); RailOperation (AUTHORIZED→SUBMITTED→PENDING | terminal(CONFIRMED | FAILED | UNKNOWN)) with the link to a settlement instruction as "the explicit authorization required by GC-3"; RailResultReport; boundary exclusivity (INV-13-1); payload-hash discipline (INV-13-2); deterministic rail idempotency keys (INV-13-3); no-guessing (INV-13-4: "adapters must map every submission to exactly one report class; they never infer CONFIRMED or FAILED from silence. Silence or ambiguity maps to UNKNOWN").
A14: ReconciliationCase (OPEN→INVESTIGATING→terminal(MATCHED | RESOLVED_CONFIRMED | RESOLVED_FAILED | RESOLVED_ADJUSTED)); ReconciliationCycle (OPEN→COLLECTED→MATCHED→CLOSED); ReconciliationSource with sequence numbers; "Every UNKNOWN rail operation automatically opens exactly one case" (INV-14-1); exactly-once resolution (INV-14-2); adjustments create new linked entries, never mutate history (INV-14-3); deterministic matching rules (INV-14-4); recovery paths RESOLVED_CONFIRMED/RESOLVED_FAILED/RESOLVED_ADJUSTED feeding area 12/9/10.
Simulated rails: same interface, scripted outcomes incl. UNKNOWN, no external transmission, no credentials, no signing.

All A13/A14 state machines exact; illegal transitions unrepresentable.
UNKNOWN is a durable terminal-class state in the operation model; no code path re-submits an UNKNOWN operation (GC-2 — machine-checked: the submit interface refuses operations in UNKNOWN).
Every UNKNOWN operation automatically opens exactly one case; duplicate case-open attempts are no-ops keyed by origin operation id.
Terminal case resolution transitions the originating operation exactly once; duplicate resolutions rejected by case id.
Simulated rails produce scripted CONFIRMED/FAILED/PENDING/UNKNOWN; no socket egress exists in the module (verified by review + test).
RAIL_OP_AUTHORIZED / SUBMITTED / REPORTED, ADAPTER_STATE_CHANGED, CASE_OPENED, CASE_RESOLVED, CYCLE_CLOSED records emitted through the port.

State-machine conformance tests; UNKNOWN auto-case test; exactly-once resolution test; adjustment-creates-new-entry test (history untouched); determinism test for matching; no-egress verification for simulated rails; evidence emission tests (port test double); typecheck clean.

Any requirement to hold real rail credentials or perform real transmission in this item (DEP-005 territory); any pressure to resolve UNKNOWN by re-submission; contradiction between A13's "Rail Adapter Authority (protocol layer, area 13) owns adapter registry and operation lifecycle" and components.json's external-rail-adapters layer "deployment"/authority_hosted "none" — stop and record as open question §6-Q1 rather than improvise an ownership ruling.

RTN-005 — Intent, Fulfillment Policy, and Capability Authorities (areas 1–3)

Status: PLANNED
Depends on: RTN-002, RTN-003, RTN-004
Owned surfaces: src/lib/protocol-runtime/intent/, src/lib/protocol-runtime/policy/, src/lib/protocol-runtime/capability/
Forbidden surfaces: (shared set)

Materialize A01–A03 with their evidence and compliance couplings:

A01 Intent Authority: PaymentIntent (DRAFT→AUTHORIZED→ROUTED→FULFILLING→terminal(FULFILLED | FAILED | CANCELLED)), "Transitions are one-way; a failed or cancelled intent cannot be restarted. A retry is a new intent linked to the prior intent id"; DemandDescriptor immutable at DRAFT; IntentReceipt idempotent response; INV-1-1 (terms fixed at AUTHORIZATION; change requires new intent + CANCELLED evidence); INV-1-2 (serialized per intent id; idempotency-key collapse); INV-1-3 (recorded key returns recorded receipt); compliance gating before AUTHORIZED via the RTN-003 gate interface.
A02 Fulfillment Policy: FulfillmentPolicy (AUTHORED→VERSIONED→ATTACHED, fixed per intent); PolicyEvaluation (EVALUATED→CONSUMED) as "a pure function of (policy version, intent terms, capability snapshot)"; INV-2-x (integer ceilings; recorded snapshot id; one evaluation id per (intent, policy version, snapshot id)).
A03 Capability Authority: Capability (REGISTERED→ACTIVE→DEGRADED→RETIRED; "Degraded capabilities accept no new commitments"); Commitment (OFFERED→RESERVED→CONSUMED | EXPIRED | RELEASED; "CONSUMED is terminal and exactly once per intent"); CapabilitySnapshot (immutable, sequenced); INV-3-1 (capacity integer bound: RESERVED + CONSUMED never exceeds declared capacity); INV-3-2 (serialized per (capability, intent), atomic capacity accounting); INV-3-3 (commitment ids from (intent id, capability id)).

All three state machines exact; one-way transitions enforced; retry-as-new-intent linkage.
Idempotent receipts: concurrent same-key submissions collapse to one intent + one receipt (INV-1-2/3).
Policy evaluation determinism machine-checked on identical (policy version, terms, snapshot).
Capacity arithmetic invariant holds after every commitment transition (INV-3-1) — property test.
DEGRADED capability accepts no new commitments; RESERVED survives degradation until area-5 release/expiry.
Evidence: INTENT_CREATED / INTENT_AUTHORIZED / INTENT_STATE_CHANGED, POLICY_ATTACHED / POLICY_EVALUATED, CAPABILITY_* / COMMITMENT_* records written to the real A15 log (RTN-002 merged).
Compliance gate: no AUTHORIZED transition without terminal APPROVED for the subject (integration with RTN-003).

State-machine conformance suites (legal + illegal transitions × 3 areas); idempotency collapse tests; capacity conservation property tests; snapshot immutability tests; determinism tests; evidence-record tests against the real log; typecheck clean.

Any requirement to mutate intent terms after AUTHORIZATION; capacity semantics that cannot stay integer; contradiction between A01's compliance-gating dependency and RTN-003's gate interface; evidence schema mismatch with the real log.

RTN-006 — Routing Authority and Reservation Authority (areas 4–5)

Status: PLANNED
Depends on: RTN-005
Owned surfaces: src/lib/protocol-runtime/routing/, src/lib/protocol-runtime/reservations/
Forbidden surfaces: (shared set)

Materialize A04–A05:

A04 Routing/Compiler: RoutePlan (COMPILED→VALIDATED→DISPATCHED→terminal(COMPLETED | FAILED | ABANDONED)); RouteCompiler as "a deterministic function from (intent terms, policy evaluation, capability snapshot) to either a RoutePlan or a reason-coded failure (NO_VIABLE_ROUTE). Compiler versions are pinned"; INV-4-1 value preservation by integer summation with explicit recorded conversion amounts and explicit Money fee line items; INV-4-2 plan compiled against one snapshot id, reservations acquired in fixed hop order at dispatch; INV-4-3 compilation keyed by (intent id, compiler version, snapshot id); NO_VIABLE_ROUTE terminal failure that "also emits a demand signal for area 24" (emission point recorded; the A24 consumer arrives with the follow-on wave); UNKNOWN hop halts the plan at DISPATCHED — never re-dispatches blindly.
A05 Reservations: Reservation (REQUESTED→HELD→terminal(CONSUMED | RELEASED | EXPIRED)) with deadlines "deterministic on protocol time"; ReservationLedger as "the concurrency frontier: all resource mutations pass through it in sequence order"; INV-5-1 ("for every resource, available = declared total minus held minus consumed, computed in integer Money; the identity holds after every transition"); INV-5-2 (total order per resource; REQUESTED resolves to HELD or is rejected, never ambiguous); INV-5-3 (ids from (intent id, hop id, resource id); CONSUMED/RELEASED exactly-once terminals); crash recovery "replays the ledger tail: REQUESTED without a subsequent transition is rolled forward to HELD or rolled back to RELEASED based on the recorded decision, never duplicated"; UNKNOWN downstream keeps reservations HELD until reconciliation resolves.

Both state machines exact; compiler determinism machine-checked (identical inputs → identical plan, pinned version recorded in every plan).
Value-preservation check: hop summation identity holds for multi-hop and cross-currency plans with explicit conversion line items; fees are explicit Money.
Ledger serialization: per-resource transitions totally ordered; concurrent REQUESTED resolution is deterministic.
Arithmetic identity (INV-5-1) holds after every transition — property test with randomized sequences.
Exactly-once terminal discipline; ledger-tail recovery replay proven on simulated crash points.
Evidence: ROUTE_* and RESERVATION_* records with proofs (ledger sequence number and post-transition arithmetic identity).

Compiler determinism + pinning tests; multi-hop/cross-currency integer summation tests; ledger serialization and crash-recovery tests; INV-5-1 property tests; illegal-transition rejection tests; evidence tests; typecheck clean.

Any need for floating-point conversion arithmetic; any requirement to dispatch reservations out of hop order; ledger semantics that cannot guarantee exactly-once terminals; contradiction with A04's halting rule under UNKNOWN.

RTN-007 — Liquidity, Credit, and Queue Authorities (areas 6–8)

Status: PLANNED
Depends on: RTN-006, RTN-004 (A06 dependsOn A13/A14 for funding-entry semantics; A07 dependsOn A14)
Owned surfaces: src/lib/protocol-runtime/liquidity/, src/lib/protocol-runtime/credit/, src/lib/protocol-runtime/queues/
Forbidden surfaces: (shared set)

Materialize A06–A08:

A06 Liquidity Authority: LiquidityPool (OPEN→FROZEN→CLOSED, single-currency); LiquidityPosition (AVAILABLE→RESERVED→terminal(CONSUMED | RETURNED)) "driven exclusively by area 5 reservations"; FundingEntry exactly-once, created only "After reconciliation confirms the external funding" (UNKNOWN leaves the pool unchanged; confirmed failure creates no entry); INV-6-1 (pool total equals integer sum of positions; per-position available + reserved + consumed exact).
A07 Credit Authority: CreditLine (OFFERED→ACTIVE→SUSPENDED→terminal(CLOSED)); CreditExposure "mutated only through area 5 reservations tied to obligations from clearing"; CreditDecision (EVALUATED→APPLIED) with "APPROVED with approved amount... an exact integer amount" or DENIED with reason; INV-7-1 (exposure ≤ limit atomically under area 5 serialization); INV-7-2 (serialized per line); INV-7-3 (keyed by (intent id, line id)).
A08 Queue Authority: FulfillmentQueue (OPEN→DRAINING→PAUSED→CLOSED); QueuedItem (QUEUED→ELIGIBLE→DISPATCHED→terminal(GRADUATED | CANCELLED | EXPIRED)); QueuePolicy immutable, "Ordering is deterministic: priority class, then sequence number"; INV-8-1 (queuing never changes monetary terms); INV-8-2 (exactly one queue residency; dispatch exactly-once per item id); INV-8-3 (replays return recorded state); INV-8-4 (UNKNOWN keeps the item DISPATCHED — "it is never re-queued or re-dispatched until reconciliation resolves the operation"); eligibility "evaluated from protocol-owned snapshots (areas 3, 6, 7), never by probing rails".

All three state machines exact; position/exposure transitions only via the RTN-006 reservation ledger interface.
INV-6-1 and INV-7-1 arithmetic identities hold after every transition — property tests.
FundingEntry exactly-once; UNKNOWN-funding path leaves pool unchanged and produces a pending reconciliation linkage.
Two concurrent approvals cannot both count the same remaining limit (serialized check + reservation atomic).
Queue ordering deterministic (priority class, then sequence); duplicate dispatch impossible by construction; UNKNOWN item stays DISPATCHED (machine-checked).
Evidence: POOL_*, POSITION_STATE_CHANGED, FUNDING_RECORDED, CREDIT_*, EXPOSURE_CHANGED, ITEM_* records with arithmetic proofs.

Arithmetic identity property tests; concurrency tests for credit line serialization; exactly-once funding tests; queue ordering determinism tests; UNKNOWN-hold tests; illegal-transition tests; evidence tests; typecheck clean.

Any cross-currency arithmetic inside pools (forbidden by A06); any queue retry policy that re-submits external effects (violates INV-8-4); exposure check that cannot be made atomic with reservation; snapshot-based eligibility impossible without rail probing.

RTN-008 — Clearing Authority and Obligation Ledger Authority (areas 9–10)

Status: PLANNED
Depends on: RTN-007, RTN-004 (A09 dependsOn A14: "any upstream UNKNOWN... must already be resolved by area 14 before the activity becomes clearable")
Owned surfaces: src/lib/protocol-runtime/clearing/, src/lib/protocol-runtime/obligations/
Forbidden surfaces: (shared set)

Materialize A09–A10:

A09 Clearing: ClearingBatch (OPEN→STAGED→COMMITTED→FINAL; "Contents are immutable after STAGED"); ClearingRecord (ACCEPTED→STAGED | QUARANTINED; "Quarantined records never produce obligations"); INV-9-1 (per-currency integer summation checks; commit only if every record passes); INV-9-2 (batches in sequence order; dedup keys by origin activity id — "a committed batch produces each obligation exactly once"); INV-9-3 (re-commit of same batch id is a no-op returning the recorded result); Clearing Authority as "the only creator of obligation creation instructions".
A10 Obligations: Obligation lifecycle (CREATED→NETTED→SETTLEMENT_PENDING→terminal(SETTLED | DISPUTED | WRITTEN_OFF | CANCELLED)) with the exact transition semantics (NETTED replacement by net positions; SETTLEMENT_PENDING when a settlement instruction exists; DISPUTED opens area-21 path — resolution creates new obligations, never mutates; WRITTEN_OFF via risk authority; CANCELLED with mandatory evidence); ObligationLedger as "append-only, totally sequenced log" and "the protocol's single financial truth (GC-4)"; INV-10-1 ("the ledger never mutates an amount after creation — corrections are new linked obligations"); INV-10-2 (serialized by sequence; at most one transition per state); INV-10-3 (creation keyed by origin record id; duplicates no-ops); INV-10-4 ("only clearing commits, dispute outcomes, and risk write-offs create or terminalize obligations").

Both state machines exact; staged-batch immutability enforced; quarantine path never silently drops records.
Dedup: duplicate origin activity ids produce one obligation; re-commit no-ops.
Ledger append-only: amount mutation unrepresentable; corrections modeled as new linked obligations.
Only the three INV-10-4 paths create/terminalize obligations — machine-checked gate.
UNKNOWN-settlement behavior: obligation remains SETTLEMENT_PENDING unchanged until reconciliation resolution (integration with RTN-004 case model).
Evidence: BATCH_STAGED / BATCH_COMMITTED / RECORD_QUARANTINED, OBLIGATION_CREATED / OBLIGATION_STATE_CHANGED / OBLIGATION_WRITTEN_OFF with terms hashes and idempotency proofs.

State-machine suites; batch immutability tests; dedup and re-commit no-op tests; append-only negative tests; INV-10-4 authority-gate tests; per-currency summation validation tests; evidence tests; typecheck clean.

Any obligation amount mutation path; any obligation creation outside clearing/dispute/risk paths; batch commit that can proceed with a failed record; ledger sequence that cannot be made totally ordered.

RTN-009 — Netting Authority and Settlement and Finality Authority (areas 11–12)

Status: PLANNED
Depends on: RTN-008, RTN-006, RTN-004 (A12 dependsOn A05, A10, A11, A13)
Owned surfaces: src/lib/protocol-runtime/netting/, src/lib/protocol-runtime/settlement/
Forbidden surfaces: (shared set) + any external transmission (simulated rails only)

Materialize A11–A12, the apex of the singleFinancialAuthority chain:

A11 Netting: NettingSet (OPEN→COMPUTED→COMMITTED; input ids fixed at OPEN); NetPosition with "a breakdown hash proving conservation"; NettingScope bilateral/multilateral; INV-11-1 conservation ("the integer sum of net positions equals the integer sum of gross obligations; the check is recorded in the set's proof before commit"); INV-11-2 ("an obligation can belong to at most one open netting set; set membership is claimed atomically at OPEN"); INV-11-3 (pure function of fixed input ids + algorithm version; re-commit no-op); obligations in DISPUTED state excluded.
A12 Settlement and Finality: SettlementInstruction (CREATED→ISSUED→terminal(CONFIRMED | FAILED)); SettlementAttempt (CREATED→SUBMITTED→PENDING | terminal(CONFIRMED | FAILED | UNKNOWN)) with INV-12-2 single-attempt rule ("at most one live attempt per instruction; blind retry is impossible by construction"); INV-12-3 (attempt authorization keyed by instruction id; deterministic rail idempotency keys derived and passed to the adapter); FinalityRecord (PROVISIONAL→FINAL; "FINAL is declared by protocol rule only. FINAL advances the obligation to SETTLED exactly once"); INV-12-1 (amounts copied verbatim; payload hash recorded and compared on result); INV-12-4 finality exclusivity ("only the Settlement Authority writes FinalityRecord state; FINAL is exactly-once per obligation and irreversible; reversal... is only possible as a new obligation via dispute/recourse"); UNKNOWN as "a durable attempt state: the instruction stays ISSUED, the obligation stays SETTLEMENT_PENDING, and a reconciliation case (area 14) is opened automatically"; safe-resume semantics via RTN-004's resolution interface.
Registry singleFinancialAuthority: settlement instructions originate only here; rail execution requests flow only to the A13 interface (RTN-004).

All state machines exact; single-live-attempt enforced by construction (second attempt authorization rejected until first is terminally resolved via reconciliation).
Conservation proof recorded before commit for every netting set; multilateral and bilateral scopes.
At-most-one open netting set per obligation (atomic membership claim).
FINAL exactly-once and irreversible: no code path writes FINAL twice or reverses it; reversal modeled only as new obligation creation.
UNKNOWN attempt auto-opens exactly one reconciliation case; RESOLVED_CONFIRMED → attempt CONFIRMED → finality advances; RESOLVED_FAILED → new instruction possible, fully evidenced.
Rail idempotency keys deterministic from instruction id; payload hash verified on every report.
Evidence: NETTING_SET_OPENED / NETTING_COMPUTED / NETTING_COMMITTED, SETTLEMENT_INSTRUCTION_CREATED / SETTLEMENT_ATTEMPT_AUTHORIZED / SETTLEMENT_ATTEMPT_RESOLVED, FINALITY_DECLARED with rule references and proofs.

Conservation property tests (bilateral + multilateral); single-attempt negative tests; finality exclusivity and irreversibility tests; UNKNOWN→case→resolution→finality end-to-end tests against simulated rails; determinism tests for netting; evidence tests; typecheck clean.

Any design that permits a second live attempt; any path that reverses FINAL; netting that can include a DISPUTED obligation; conservation check that cannot be recorded before commit; contradiction between INV-12-4's Settlement Authority write exclusivity and the single-writer discipline (escalate as open question).

RTN-010 — Protocol gateway: command admission and idempotent receipts

Status: PLANNED
Depends on: RTN-005, RTN-006, RTN-007, RTN-008, RTN-009 (all A01–A16 authorities merged)
Owned surfaces: src/lib/protocol-runtime/gateway/
Forbidden surfaces: (shared set) + any src/app/ route additions (web-boundary wiring is a separate governed splice)

Materialize the protocol-gateway component as the in-process, sole admission point for protocol commands (topology.md: "exactly one protocol-command admission point (protocol-gateway)"; components.json: "the sole admission point for protocol commands"): command validation against each authority's command schema; idempotent receipts (the IntentReceipt pattern generalized: "intent id, current state, and recorded outcome for the submitted idempotency key"); submission onto the durable command path via the DEP-003 enqueue with kernel idempotency keys; rejection reason codes for invalid/unauthorized commands; the readiness/health contract ("Readiness endpoint; command acceptance rate and latency; durable-queue submit success" — exposed as programmatic health functions; HTTP binding is deployment work).

Every authority command kind is admitted or rejected with a deterministic reason code; no financial effect occurs at admission (effects occur only via the transition path).
Idempotent submission: same command + idempotency key returns the recorded receipt, never a second effect.
Rejected commands are recorded as evidence (admission decisions are consequential records).
The gateway is the only module other code may call to submit protocol commands — enforced by module boundary and documented contract.
Readiness/health functions report command acceptance and queue-submit success per the components.json contract.
The command surface consumed by future product-port re-anchoring is documented (the re-anchoring itself is product-program work — see §6-Q5).

Admission validation tests (per command kind: accept/reject matrix); idempotent receipt tests; queue-submission integration tests; rejection-evidence tests; boundary review proving no second admission path exists; typecheck clean.

Any requirement for the gateway to execute financial transitions itself (single-writer violation); any requirement to touch src/app/ or src/lib/protocol/; admission semantics that would bypass evidence records.

RTN-011 — Transition runtime and authority hosting on the durable substrate

Status: PLANNED
Depends on: RTN-005, RTN-006, RTN-007, RTN-008, RTN-009, RTN-002
Owned surfaces: src/lib/protocol-runtime/transition/, src/lib/protocol-runtime/hosting/
Forbidden surfaces: (shared set) + any mutation of substrate internals (integration via register()/enqueue/db API only)

Materialize the transition-runtime component's in-process form — the single authoritative-state writer — and the authority hosting pattern on the DEP-003 substrate, exactly at the documented integration point (src/lib/durable/index.ts: "Future protocol authorities plug in via register() and own their own evidence via recordEvent(type, data, owner)"):

Command execution path: dequeue a command → resolve the owning authority handler → apply the transition → write the A15 evidence record → commit state atomically ("an operation is not committed until its record is written" — A15); failure fails the operation.
Single-writer discipline: authoritative state is mutated only through this path (topology.md: "mutated only by transition-runtime through protocol-owned transitions — no other layer may mutate it directly").
At-least-once redelivery safety: handlers are idempotent via each area's INV-x-3 key discipline (duplicate delivery returns recorded state, never a second effect).
Worker restart/redelivery determinism and lease reclaim safety (substrate guarantees composed with area idempotency).
Scheduler wiring pattern for recurring ticks (clearing batches, netting cycles, reconciliation cycles, queue eligibility scans) using scheduleRecurring — timing-driven command emission only, per the scheduler boundary ("owns timing only, never mutates authoritative state").
Transition backlog/consistency probe functions (components.json health signal contract: "Transition backlog depth and age; authoritative-state consistency probes").

A command submitted through RTN-010's gateway, enqueued on the substrate, and executed by this path produces: the state transition + exactly one evidence record, atomically; a failed evidence write rolls back the transition.
Duplicate delivery of the same command is a no-op returning recorded state (demonstrated on at least intent, reservation, obligation, and settlement command kinds).
Crash/restart replay: kill-and-restart of the worker loop mid-execution produces no duplicate effects (lease reclaim + idempotency).
No module other than the transition path mutates authoritative state — boundary review.
Recurring-tick jobs emit commands only (no direct state mutation from scheduler callbacks).
Consistency probes verify ledger identities (INV-5-1, INV-6-1, INV-11-1) over persisted state.

End-to-end command→transition→evidence tests; atomicity tests (induced evidence-write failure rolls back); duplicate/redelivery tests; restart/lease-reclaim tests; scheduler tick tests; single-writer boundary review evidence; typecheck clean.

Any substrate capability gap requiring src/lib/durable/ modification (escalate CONTRACT_BLOCKER — a substrate change is a separate governed work item); any transition that cannot be made atomic with its evidence record; an authority whose idempotency keys cannot deduplicate redelivery.

RTN-012 — RTN wave integration and governed deployment-contract update

Status: PLANNED
Depends on: RTN-010, RTN-011
Owned surfaces: src/lib/protocol-runtime/index.ts (wave barrel), deploy/contracts/components.json, spec/deployment/topology.md, scripts/validate_deployment.py
Forbidden surfaces: (shared set)

Close the wave: (1) integration evidence over the composed runtime — "Integration work items declare their constituents as hard dependencies... An integration PR re-runs the full assurance profile over the composed system" (parallel-execution.md); (2) the governed deployment-contract update — topology.md "Contract evolution": update deploy/contracts/components.json (and spec/deployment/topology.md + scripts/validate_deployment.py together in this one work item) to record the repository entrypoints that now exist for the materialized components, following the DEP-003 in-process precedent and the honesty rule ("claimed-today entrypoints must exist on disk"); (3) the DEP-004 dispatchability record — the composed evidence the Tech Lead uses to flip DEP-004's status and frontier per the post-merge state reconciliation duties (implementation-protocol.md).

Composed golden path: intent submit (via gateway) → authorize (compliance-gated) → route → reserve → fulfill → clear → obligate → net → settle (simulated rail) → finality — every step evidenced in the A15 log, chain-verified.
Composed UNKNOWN path: rail UNKNOWN at settlement → auto case → INVESTIGATING → RESOLVED_CONFIRMED → finality advances exactly once (and a RESOLVED_FAILED variant: new instruction, new evidence).
RTN-003/RTN-004 real-log integration verified (the port test doubles replaced by the real A15 log).
Duplicate/restart safety across the composed path (resubmission, worker restart, replay).
Evidence chain hash verification passes over the full composed journey log.
python3 scripts/validate_deployment.py exits 0 with the updated contract; python3 scripts/validate_governance.py exits 0; python3 scripts/validate_durable.py exits 0; typecheck clean.
components.json changes preserve the ownership model (owner=deployment for every component; authority only in protocol-layer entries; future-work markers only where entrypoints genuinely do not exist — e.g. externalized process binding if the Architect keeps the externalized reading, see §6-Q3).
A dispatchability statement for DEP-004 is produced as review evidence (status flip itself is a Tech Lead post-merge reconciliation act).

End-to-end journey tests (golden + UNKNOWN + failure paths) with chain-verified evidence; duplicate/restart/replay suite; validator outputs (all three validators, exit 0); contract-diff review evidence; the DEP-004 dispatchability memo.

Any composed-path invariant failure (stop and file the defect — do not patch authorities in an integration item beyond its owned surfaces); validator disagreement with the contract update; any requirement to rewrite evidence or state to make a test pass.

## 4. The v0.1 invariants that MUST NOT change

The wave implements these; it never alters them. Any conflict is a stop condition.

Global constraints (registry protocol.globalConstraints, identical in substance to README GC-1..GC-7)

G1: "Exact, deterministic financial arithmetic: integer minor units, no floats, no rounding in the protocol core, idempotent computations."
G2: "External outcomes can be UNKNOWN; UNKNOWN -> reconciliation -> known outcome -> safe recovery; never blind retry."
G3: "All external effects go behind rail-adapter boundaries with explicit authority; no component outside the protocol authorities may produce financial effects."
G4: "Single financial authority: the protocol layer owns financial truth; product and deployment layers may not duplicate it."
G5: "Every consequential operation produces evidence records (what/when/authority/outcome/proof), committed atomically with the state transition."
G6: "Simulation/replay operates on isolated, environment-tagged state and can never mutate production financial state."
G7: "Sandbox/demo can never reach production financial effects without separately authorized production configuration, which they do not hold."

The single financial authority rule (registry protocol.singleFinancialAuthority)

apex: Settlement and Finality Authority; executor: Rail Authority.
"Only the Settlement and Finality Authority originates instructions for external value movement; only the Rail Authority executes them through adapters; liquidity funding/withdrawal egress is token-scoped to the Liquidity Authority; product and deployment layers hold no signing or execution power."

Freeze rules

Registry freezeNote: "Protocol architecture v0.1 is frozen. Any protocol semantic change requires the Architecture Change Request process; product-layer version labels do not create a protocol v0.2."
README §2: "After acceptance of this materialization, no file in this directory is modified in place. All changes require an Architecture Change Request." ACRs altering financial semantics "require a replay proof over recorded evidence before approval."
spec/architecture-change-requests/OBSOLETE-V0.2-PROTOCOL-REDESIGN.md: "Status: OBSOLETE — DO NOT IMPLEMENT... Implementation must continue against the frozen PaySwap v0.1 protocol architecture."

Area authority contracts and key invariants (per registry file/section; binding as written)

AREA
	
OWNING AUTHORITY (REGISTRY)
	
INVARIANTS THAT MUST NOT CHANGE (SELECTED, VERBATIM GIST)

A01	Intent Authority	INV-1-1 terms fixed at AUTHORIZATION (change ⇒ new intent + CANCELLED evidence); INV-1-2 serialized per intent id; INV-1-3 idempotency-key receipts; one-way transitions, no restart
A02	Fulfillment Policy Authority	INV-2-1 pure-function evaluation, integer ceilings; INV-2-3 one evaluation id per (intent, version, snapshot)
A03	Capability Authority	INV-3-1 RESERVED+CONSUMED ≤ declared capacity; INV-3-2 atomic capacity accounting; INV-3-3 commitment ids from (intent, capability)
A04	Routing Authority	INV-4-1 integer value preservation, explicit conversions/fees; INV-4-3 compilation keyed by (intent, compiler version, snapshot); UNKNOWN halts plan at DISPATCHED
A05	Reservation Authority	INV-5-1 available = total − held − consumed after every transition; INV-5-3 exactly-once terminals; ledger-tail crash recovery never duplicates
A06	Liquidity Authority	INV-6-1 pool total = integer sum of positions; INV-6-3 FundingEntry exactly once (UNKNOWN ⇒ no entry yet)
A07	Credit Authority	INV-7-1 exposure ≤ limit atomically; INV-7-3 decisions keyed by (intent, line)
A08	Queue Authority	INV-8-2 dispatch exactly-once per item; INV-8-4 UNKNOWN item never re-queued/re-dispatched
A09	Clearing Authority	INV-9-2 origin-id dedup ⇒ each obligation exactly once; INV-9-3 re-commit no-op; quarantine, never drop
A10	Obligation Ledger Authority	INV-10-1 no amount mutation after creation — corrections are new linked obligations; INV-10-4 only clearing/dispute/risk write-offs create or terminalize
A11	Netting Authority	INV-11-1 conservation (sum of nets = sum of grosss), recorded before commit; INV-11-2 at most one open set per obligation; DISPUTED excluded
A12	Settlement and Finality Authority	INV-12-2 single live attempt (blind retry impossible by construction); INV-12-4 FINAL exactly-once, irreversible, written only by the Settlement Authority; UNKNOWN auto-opens a case
A13	Rail Authority	INV-13-1 boundary exclusivity (no external effect outside authorized RailOperations); INV-13-4 no-guessing (silence ⇒ UNKNOWN)
A14	Reconciliation Authority	INV-14-1 every UNKNOWN has exactly one open case; INV-14-2 exactly-once resolution; INV-14-3 adjustments create new entries, never rewrite history
A15	Evidence Authority	INV-15-1 exactly one record per consequential operation; INV-15-2 append-only; INV-15-3 hash chain verifies from genesis; INV-15-4 write-key idempotency
A16	Risk and Compliance Authority	INV-16-1 pure-function determinism; INV-16-3 gated transitions cannot complete without terminal APPROVED; HIT ⇒ MANUAL_REVIEW, no auto-decision
A17–A24	Simulation/Marketplace/Agent/Merchant/Recourse/Federation/Blockchain-Rail/Emergence Authorities	Preserved unchanged for the follow-on wave: INV-17-1 isolation (no code path from simulation to production writes); INV-21-1 settled facts immutable — remedies are new linked obligations; INV-22-1 federation adds limits, never exceptions to GC-1..GC-7; INV-23-1 no early finality (finality-depth rule); INV-24-2 no auto-deployment

## 5. The DEP-004 unblocking path

DEP-004's own dependency text (spec/system-work-orders/DEP-004.md): "Depends on: DEP-003 + frozen protocol authorities", with objective "Run durable operational processes for reconciliation, clearing, netting and settlement support through existing protocol authorities." The cross-layer graph (spec/system-work-items.md) says "Depends on: DEP-003 + protocol authorities."

Current facts: DEP-003 is MERGED (b3bc430, PR #9). The second dependency is unmet: spec/development-state/system-program-state.json — "DEP-004 BLOCKED (requires protocol authorities as runtime code — not yet materialized)."

Which RTN items must merge before DEP-004 becomes dispatchable:

Strictly required: RTN-001 through RTN-011. DEP-004's jobs drive reconciliation, clearing, netting, and settlement support "through existing protocol authorities", and its acceptance bullets bind it to the authorities' own guarantees:
"Jobs consume only authoritative protocol state." → the state stores exist only via the authorities: RTN-005..RTN-009, on the kernel convention RTN-001.
"Duplicate execution is harmless or prevented by protocol concurrency controls." → those controls are the area invariants (INV-5-2 ledger serialization, INV-8-2 exactly-once dispatch, INV-9-2/INV-9-3 batch dedup, INV-11-2 atomic set membership, INV-12-2 single attempt) — RTN-006..RTN-009.
"UNKNOWN external outcomes trigger reconciliation rather than blind retry." → the A13/A14 semantics and the auto-case path: RTN-004, composed with A12 via RTN-009 and executed through RTN-011.
"Clearing/netting jobs are restart-safe and auditable" and "Settlement-support work never asserts finality itself" → finality exclusivity (INV-12-4) and the evidence log (GC-5) must exist as runtime code: RTN-002, RTN-009, RTN-011.
The command path that the jobs submit through ("corrective commands through the protocol gateway" — components.json reconciler-workers): RTN-010, RTN-011 (with DEP-003's queue as transport).
Recommended gate before dispatch: RTN-012. Per spec/governance/parallel-execution.md: "Integration work... re-runs the full assurance profile over the composed system... constituent evidence does not compose." DEP-004 consumes the composed runtime; dispatching it before RTN-012 would ask DEP-004's worker to be the first executor of an unproven composition. RTN-012 additionally lands the governed components.json update, so the deployment contract no longer contradicts what DEP-004's worker will find in the repository.

Net: DEP-004 becomes dispatchable after RTN-001..RTN-011 merge (hard requirement), and the Tech Lead should hold dispatch until RTN-012 merges (assurance-floor recommendation). DEP-005 (external rail connectivity) remains downstream: "Depends on: DEP-003, DEP-004."

## 6. Open questions for the Architect (5)

Q1 — Where does the Rail Authority's protocol state live?
spec/architecture/v0.1/rails-adapters-reconciliation.md Area 13: "Rail Adapter Authority (protocol layer, area 13) owns adapter registry and operation lifecycle." But deploy/contracts/components.json gives external-rail-adapters "layer": "deployment" and "authority_hosted": "none — ... cannot originate or alter financial decisions", and topology.md's protocol-authority list excludes the adapter component. So RailOperation lifecycle state (AUTHORIZED→SUBMITTED→…) is protocol-owned state, yet the only rail-touching component hosts no authority. The plan assumes that state persists in the authoritative-state-store and transitions through the single-writer path, with the adapter component (and RTN-004's simulated rails) as pure transmission — the spec never says this explicitly. Ruling requested.

Q2 — What exactly does "protocol authorities" mean in DEP-004's dependency line?
spec/system-work-items.md: "DEP-004 ... Depends on: DEP-003 + protocol authorities" (unqualified), while DEP-004's objective names only "reconciliation, clearing, netting and settlement support"; system-program-state.json says "requires protocol authorities as runtime code" (also unqualified). This plan scopes the wave to A01–A16 and defers A17–A24 to a follow-on wave on the strength of DEP-004's objective text — but if the intended reading is "all 24 areas," the wave must be re-scoped (and N ≤ 12 no longer holds). Ruling requested.

Q3 — Is in-process materialization an acceptable realization of the component contract?
spec/durable/execution.md §1 (the DEP-003 precedent): "an in-process execution fabric that lives inside the existing web-api-boundary application (no new deployed component; the FUTURE-WORK components in deploy/contracts/components.json remain future work and their present-set is untouched)" — while components.json defines the 9 components as distinct deployment-owned processes with per-component health signals and rollbacks, and topology.md's "Contract evolution" permits updating the contract "together in one work item." The plan materializes all 9 as in-process modules first (RTN-012 updates the contract accordingly). If the Architect requires distinct deployed processes (or distinct runtime entrypoints), RTN-010/011/012 must be re-scoped toward process separation and the DEP layer must own the binding. Ruling requested.

Q4 — Vocabulary mismatch: "market" and "identity/accounting/values" vs the 24-area registry.
components.json protocol-gateway hosts "identity, authority, values, accounting, intent, demand, capability, market, liquidity..." and spec/system-architecture.md "Protocol owns" includes "Identity... market" — but the 24-area registry contains no identity area, no market area, and no "Market Authority" (closest: A03 Capability Authority, A18 Marketplace Authority). The plan maps "values"→kernel Money (GC-1), "accounting"→A10 obligation ledger, and leaves "market"/"identity" as gateway vocabulary mapped to A03/A18 — a conservative interpretation in the spirit of the v0.1 README's own "Known limitations" practice. Confirmation requested.

Q5 — Who owns re-anchoring the product ports to the runtime, and does it gate DEP-004?
src/lib/protocol/intent-port.ts: "When it lands, this port is re-anchored to the runtime and the mock is retired; the surfaces do not change shape." The RTN wave cannot touch src/lib/protocol/ (product-owned forbidden surface), so re-anchoring is a product-program work order. But spec/system-reconciliation.md's invariant requires the full chain "user intent → product interaction → canonical protocol object/state → owning protocol authority → API/runtime boundary → deployment component → durable state/evidence → user-visible outcome" — a chain that is broken until re-anchoring lands. Is DEP-004 (background operations, no user surface) truly independent of that splice, or must a port-re-anchoring item be sequenced before SYS-001 (and in which program)? Ruling requested.

Proposal status: this document creates no work. The Tech Lead reviews it; the Architect approves the wave. Per spec/governance/agent-dispatch.md: "Workers receive bounded contracts and never acquire architectural authority from assignment."
