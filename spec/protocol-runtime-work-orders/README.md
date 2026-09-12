# Protocol Runtime Materialization work orders (RTN wave)

**Program:** protocol-runtime (governed runtime materialization program)
**Status:** COMPLETE (2026-09-12) — all 12 work orders merged and independently verified by the Tech Lead: RTN-001 184dbbb · RTN-002 54b12ff · RTN-003 adf78f3 · RTN-004 945df37 · RTN-005 92adb6a · RTN-006 fe0fed0 · RTN-007 28c6746 · RTN-008 e67c48c · RTN-009 4ac6792 · RTN-010 ed4a05c · RTN-011 14b6ca5 · RTN-012 f22a624 (PRs #20, #22–#32). Wave materialized per the Architect's rulings (spec/development-state/rtn-plan-rulings.md, merged fb8df22): verdict **APPROVE-WITH-MODIFICATIONS**, seven ordered deltas applied to these work orders. The composed golden path is proven end-to-end (scripts/test_protocol_composed_journey.mjs — 49-record chain VERIFIED); the DEP-004 dispatchability memo and the nine reconciliation answers are filed in src/lib/protocol-runtime/INTEGRATION-EVIDENCE.md. RTN wave 2 (A17–A24) remains the named deferral.
**Source proposal:** spec/development-state/rtn-materialization-plan-proposal.md (§3 decomposition, §4 invariants, §5 DEP-004 unblocking path).

These work orders materialize the frozen v0.1 protocol authorities (A01–A16) as executable runtime code, in-process first (the DEP-003 precedent). They do not alter spec/architecture/v0.1/ (frozen), do not create protocol v0.2, and do not reopen WORK-001..WORK-033.

## Wave shape

12 work orders materializing the operational spine A01–A16 (intent → settlement/finality, rails/adapters/reconciliation, evidence, risk/compliance), with the governed deployment-contract update riding RTN-012.

Antichain schedule (max width 3, all owned prefixes disjoint):

1. RTN-001
2. RTN-002 ∥ RTN-003 ∥ RTN-004
3. RTN-005
4. RTN-006
5. RTN-007
6. RTN-008
7. RTN-009
8. RTN-010 ∥ RTN-011 (re-scoped per rulings delta 5: RTN-011's evidence uses its own test harness via the substrate's public enqueue API; no sibling consumes unmerged sibling code)
9. RTN-012

Single-worker antichains 3–7 are a deliberate serialization (dependency-state.json makes the A01→A05→A09→A12 spine a chain; parallel-execution.md forbids weakening conditions to widen the graph).

## RTN wave 2 (named follow-on deferral — rulings delta 2)

Areas A17–A24 (simulation/replay, marketplace, agents, merchant primitives, disputes/recourse, federation, blockchain rails, emergence) are deferred to a named follow-on governed wave: **RTN wave 2**. None is a structural dependency of DEP-004 (rulings Q2: DEP-004's "protocol authorities" = the operational A01–A16 spine); dependency-state.json shows A17–A24 depending on the A01–A16 spine; SYS-002 dogfooding, which requires several of them, is gated behind DEP-008/product closure in spec/system-work-items.md. RTN wave 2 is proposed through the governed Tech Lead process after the DEP chain advances; its invariants are preserved unchanged in the registry in the meantime.

## Governance preamble

Every dispatch carries the full 13-field execution context of spec/governance/agent-dispatch.md, validated against agents/schemas/execution-context.schema.json. Antichain discipline per spec/governance/parallel-execution.md: hard dependencies merged (Git facts), owned-surface disjointness verified in the repository tree, ≤3 concurrent workers per antichain, no sibling consumes unmerged sibling code, workers never merge (the Architect is sole merge authority; six review gates per spec/governance/implementation-protocol.md).

Shared forbidden surfaces (all items): spec/architecture/v0.1/ (frozen semantics), spec/architecture-change-requests/, src/lib/protocol/ (product ports), src/lib/durable/ (read-only integration: import + register()/db API), spec/product/, src/components/, src/app/.

Persistence convention (decided in RTN-001): each authority domain owns its schema and per-domain migrations inside its owned prefix, using the DEP-003 database layer read-only. The spec permits this: v0.1 "prescribes no implementation, storage, or service decomposition."

Evidence discipline: every consequential operation writes an A15 record through the kernel-declared EvidenceSubmission port; where the real evidence log is not yet a hard dependency (RTN-003, RTN-004), the item tests against an owned in-surface test double of the port and the real-log integration is proven in RTN-012 ("constituent evidence does not compose" — parallel-execution.md).

The v0.1 invariants that must not change are recorded in the proposal §4 (GC-1..GC-7, the single financial authority rule, the freeze rules, the per-area INV contracts); any conflict is a stop condition.

## DEP-004 unblocking

DEP-004 becomes dispatchable after RTN-001..RTN-011 merge (hard requirement), with RTN-012 recommended before dispatch (assurance floor — the dispatchability memo rides RTN-012 and cites the rulings' Q2 interpretation). DEP-005 remains downstream ("Depends on: DEP-003, DEP-004"). The product port-re-anchoring item (UI-011, rulings delta 6) does NOT gate DEP-004.

## Product coupling (rulings delta 6)

spec/product/work-items.md carries the additive UI-011 item (protocol port re-anchoring to the composed runtime), with a hard dependency on the merged composed runtime (RTN-012 at minimum), sequenced before UI-010's closure acceptance and before SYS-001's acceptance. RTN-012's composed-journey evidence records question 9 (user-visible state) as an explicit deferral to UI-011 and SYS-001/SYS-002 (rulings delta 7).
