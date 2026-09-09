# PaySwap Protocol Architecture v0.1 — Index and Freeze Record

Repository: payswapdotorg/payswap3
Base: main @ 58bb3f31b750a7bd7eedcb3b730b02af9fada3b6
Status: FROZEN — PaySwap protocol architecture v0.1
Change control: Architecture Change Request (ACR) only. See Section 8.

## 1. Scope and authority

This directory (spec/architecture/v0.1/) is the authoritative source for the
PaySwap protocol architecture v0.1: financial semantics, authority model,
ledgering, execution, clearing, netting, settlement, and finality.

Out of scope for this directory:

- Product UX semantics (owned by product documentation).
- Deployment topology (owned by deployment documentation).
- Application code and implementation choices (language, services,
  infrastructure).

The repository README states "protocol v0.1 complete, WORK-001..WORK-033".
This directory materializes that statement as concrete protocol semantics.
Git history remains the authoritative record of merge facts.

## 2. Freeze declaration

- Protocol architecture v0.1 is FROZEN.
- After acceptance of this materialization, no file in this directory is
  modified in place. All changes require an Architecture Change Request.
- An ACR must state: affected areas, invariant impact, state migration plan,
  and evidence impact. ACRs that alter financial semantics require a replay
  proof over recorded evidence before approval.
- Nothing in this directory creates, revives, or endorses a v0.2 or any
  successor redesign. OBSOLETE-V0.2-PROTOCOL-REDESIGN.md remains obsolete
  and is not referenced by this architecture.

## 3. Global constraints (binding on all 24 areas)

GC-1 — Exact, deterministic financial arithmetic.
  All monetary values are signed integers in minor units with an explicit
  currency code and scale. No floating point. Rate application uses integer
  multiplication and deterministic rounding. Re-running any computation on
  identical inputs yields identical outputs.

GC-2 — UNKNOWN results go to reconciliation, never blind retry.
  Any external operation whose result is not known resolves as UNKNOWN.
  UNKNOWN is a durable state, not a failure. The only permitted path is:
  UNKNOWN -> reconciliation (area 14) -> known result -> safe resume.
  Components must never blindly re-submit an UNKNOWN external operation.

GC-3 — External effects only behind the rail-adapter boundary.
  All external financial effects (money movement outside protocol state)
  occur at area 13 external rail adapters, and only with explicit
  authorization linked to a protocol-owned instruction. No component
  outside the rail-adapter boundary may produce an external effect.

GC-4 — Single financial authority.
  The protocol layer owns financial truth: balances, obligations, net
  positions, and finality. Product and deployment layers never duplicate
  or independently recompute financial state. They consume protocol
  projections.

GC-5 — Every consequential operation produces an evidence record.
  A consequential operation is any operation that creates, mutates, or
  resolves financial state, or authorizes an external effect. Each writes
  exactly one evidence record (area 15) with fields: what, when, authority,
  outcome, proof.

GC-6 — Simulation and replay are isolated.
  Simulations and replays run against isolated copies of ledger state and
  never mutate production financial state. Their outputs are marked
  non-authoritative.

GC-7 — Sandbox and demo isolation.
  Sandbox and demo configurations cannot reach production financial
  effects. Production effects require a separate, explicit production
  authorization recorded in evidence.

## 4. Area coverage map (24 areas)

| # | Area name | File | Section |
|---|-----------|------|---------|
| 1 | intent and demand | core.md | Area 1 |
| 2 | fulfillment policy | core.md | Area 2 |
| 3 | capability discovery and commitments | core.md | Area 3 |
| 4 | routing/compiler | core.md | Area 4 |
| 5 | reservations and concurrency | core.md | Area 5 |
| 6 | liquidity | liquidity-credit-queues.md | Area 6 |
| 7 | credit | liquidity-credit-queues.md | Area 7 |
| 8 | queued/delayed fulfillment | liquidity-credit-queues.md | Area 8 |
| 9 | clearing | clearing-netting-settlement.md | Area 9 |
| 10 | obligations | clearing-netting-settlement.md | Area 10 |
| 11 | bilateral and multilateral netting | clearing-netting-settlement.md | Area 11 |
| 12 | settlement and finality | clearing-netting-settlement.md | Area 12 |
| 13 | external rail adapters | rails-adapters-reconciliation.md | Area 13 |
| 14 | reconciliation | rails-adapters-reconciliation.md | Area 14 |
| 15 | evidence | evidence-risk-compliance.md | Area 15 |
| 16 | risk/compliance | evidence-risk-compliance.md | Area 16 |
| 17 | simulation/replay | evidence-risk-compliance.md | Area 17 |
| 18 | extensions/capability marketplace | extensions-agents-merchant.md | Area 18 |
| 19 | agents and mediation | extensions-agents-merchant.md | Area 19 |
| 20 | merchant checkout/settlement primitives | extensions-agents-merchant.md | Area 20 |
| 21 | disputes/recourse | disputes-federation-blockchain-emergence.md | Area 21 |
| 22 | federation | disputes-federation-blockchain-emergence.md | Area 22 |
| 23 | blockchain rails | disputes-federation-blockchain-emergence.md | Area 23 |
| 24 | capability emergence from unsupported demand | disputes-federation-blockchain-emergence.md | Area 24 |

## 5. Per-area contract

Every area section in the files listed above satisfies the same
seven-item contract:

1. Purpose.
2. Core objects and state (object names and state machines).
3. Owning authority.
4. Key invariants (financial correctness, concurrency, idempotency).
5. Failure and UNKNOWN semantics with recovery path.
6. Evidence produced.
7. Boundaries.

## 6. Machine-readable projections

- spec/registry/protocol-registry.json — machine-readable registry of all
  24 areas: owning authority, primary objects, and cross references to
  the files and sections in this directory.
- spec/development-state/program-state.json — projection of protocol
  program status (complete, WORK-001..WORK-033).
- spec/development-state/dependency-state.json — area-level dependency
  edges among the 24 areas.
- spec/development-state/frontier-state.json — protocol frontier is empty
  (protocol v0.1 is closed).

These are projections. This directory and Git history are authoritative.

## 7. Reading order

1. This README (constraints GC-1..GC-7 are binding on every area).
2. core.md (areas 1-5) — intent through execution.
3. liquidity-credit-queues.md (areas 6-8) — resources and waiting.
4. clearing-netting-settlement.md (areas 9-12) — ledger through finality.
5. rails-adapters-reconciliation.md (areas 13-14) — external world and
   resolution of UNKNOWN.
6. evidence-risk-compliance.md (areas 15-17) — proof and governance.
7. extensions-agents-merchant.md (areas 18-20) — growth surfaces.
8. disputes-federation-blockchain-emergence.md (areas 21-24) — recourse
   and expansion.

## 8. Change control

- v0.1 is frozen. Changes require an Architecture Change Request (ACR).
- An ACR identifies: affected areas, invariant impact, migration of
  persisted state, evidence impact, and a replay proof when financial
  semantics change.
- Approved ACRs open new work orders in spec/work-orders/. The v0.1
  work orders (WORK-001..WORK-033) remain closed and are recorded in
  spec/work-orders/WORK-ORDERS-LEDGER.md.

## 9. Known limitations

- The original materialization work order labeled
  rails-adapters-reconciliation.md as covering areas 13-15, but the file
  name and subject cover 13 (external rail adapters) and 14
  (reconciliation). Conservative interpretation applied: that file covers
  areas 13-14; area 15 (evidence) is covered in
  evidence-risk-compliance.md.
- The original materialization work order labeled
  evidence-risk-compliance.md as covering areas 16-17, but by the fixed
  area list, evidence is 15, risk/compliance is 16, and simulation/replay
  is 17. Conservative interpretation applied: that file covers areas
  15-17.
- development-state projections are informational projections of README
  statements; Git history remains authoritative for merge facts.
- This directory defines semantics only; it intentionally prescribes no
  implementation, storage, or service decomposition.
