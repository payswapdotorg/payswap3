Product/UI Implementation Roadmap

Status: FROZEN — human-readable UI roadmap; the sequence below is pinned
Program: payswap3-product
Base: main @ b9737e9b78482f32ea02ff279ea75d82386ee3cd (frozen protocol architecture present)
UX contract: spec/product/ux-architecture-v0.2.md (product-layer v0.2)
Ledger (graph source of record): spec/product/work-items.md
Machine state (projection): spec/development-state/product-program-state.json — Git merge facts are authoritative

1. Purpose

This roadmap is the frozen, human-readable sequencing of the product/UI program. It exists so anyone can see, without reading code, what must be built and in what order to reach product closure. The machine-readable projection lives in the product program state file; where any artifact and Git history disagree, Git merge facts are authoritative.

2. Pinned dependency graph
UI-001 (product foundation / app shell)  ↓UI-002  ├── UI-003  ├── UI-004  └── UI-005          ↓       UI-006          ↓       UI-007          ↓       UI-008          ↓       UI-009          ↓       UI-010 (end-to-end UX closure evidence)
3. Edge list (exact)
#	Edge	Reading
1	UI-001 → UI-002	The app shell and primitives precede the first feature surface
2	UI-002 → UI-003	Merchant checkout follows the customer intent surface
3	UI-002 → UI-004	Provider/capability surface follows the customer intent surface
4	UI-002 → UI-005	Track/status + evidence surface follows the customer intent surface
5	UI-005 → UI-006	Waiting/recovery UX builds on track/status + evidence
6	UI-006 → UI-007	Liquidity/credit/queue visibility follows waiting/recovery
7	UI-007 → UI-008	Mediation/dispute surfaces follow the visibility surfaces
8	UI-008 → UI-009	Cross-cutting hardening follows the feature surfaces
9	UI-009 → UI-010	Closure evidence follows hardening

Nine edges, exactly as pinned: no extra edges, no missing edges.

Note on Phase 4: the pinned graph draws the continuation arrow from UI-005 to UI-006, and the ledger encodes exactly that — UI-006 depends on UI-005, not on UI-003/UI-004.

4. Phases
Phase	Items	Scope in one line	Exit condition
1 — Foundation	UI-001	App shell, one navigation grammar, state/UNKNOWN display primitives, environment signal, role-scoped navigation scaffold	Shell and primitives accepted with mapping records; zero financial semantics
2 — Customer intent	UI-002	Outcome-first payment intent composition, review, explicit submit, explicit post-submit states	Intent surface accepted including the UNKNOWN path and mapping records
3 — Parallel surfaces	UI-003, UI-004, UI-005	Merchant checkout; provider/capability; track/status + evidence — mutually independent, all after UI-002	All three accepted (any order or concurrent execution)
4 — Waiting & recovery	UI-006	Waiting/queued/delayed fulfillment and recovery UX with reconciliation visibility	Accepted including UNKNOWN-with-reconciliation evidence
5 — Read-only truth	UI-007	Liquidity/credit/queue visibility, strictly read-only authoritative presentation	Accepted including provenance wording and role gating
6 — Human loop	UI-008	Agent proposal/mediation and disputes/recourse surfaces	Accepted including decision-authorization evidence
7 — Hardening	UI-009	Responsive + accessibility + role-correctness hardening across all materialized surfaces	Objective tool-backed evidence bundle produced; zero open violations or recorded waivers
8 — Closure	UI-010	End-to-end UX closure evidence and Architect closure	Architect closure recorded; program closed
5. Dispatch rules
Only items in the current frontier (see the machine state) are dispatchable. The frontier starts at UI-001.
After UI-002 completes, UI-003, UI-004, and UI-005 are dispatchable in parallel; they are mutually independent.
UI-003 and UI-004 are graph leaves (nothing depends on them). They MUST nonetheless be complete before UI-009 acceptance, because UI-009's hardening scope is "all materialized surfaces" — this is a scope requirement recorded here, in the ledger, and in UI-009; it is not a graph edge.
Deferring the leaves past the parallel window does not block dispatch of the mainline; it blocks UI-009/UI-010 acceptance and therefore closure.
Status transitions happen only through governed merges; the machine state is updated as part of those merges.
6. Closure
The closure target is UI-010.
Closure requires all ten work items to record COMPLETE (Git merge facts authoritative).
UI-010 requires: objective end-to-end UX evidence across the composed system, responsive/accessibility evidence, and Architect closure.
No closure shortcut exists that skips any work item or any of the three closure evidence classes.
7. Invariants
The dependency graph is frozen: nine edges, exactly as pinned. Additions or removals go through the governed Tech Lead process, never through a work order.
This roadmap is human-readable documentation; it adds no semantics beyond the ledger and the UX contract.
The roadmap schedules product/UI work only; protocol and system work are separate programs.
Product-layer versioning only: the UX contract's v0.2 label never denotes or replaces protocol v0.1.
