Product/UI Work-Item Ledger

Status: ACTIVE — single source of record for the product work-item graph
Program: payswap3-product
UX contract: spec/product/ux-architecture-v0.2.md (product-layer v0.2)
Roadmap (frozen): spec/product/implementation-roadmap.md
Machine state (projection): spec/development-state/product-program-state.json — Git merge facts are authoritative

1. Pinned dependency graph
UI-001 (product foundation / app shell)  ↓UI-002  ├── UI-003  ├── UI-004  └── UI-005          ↓       UI-006          ↓       UI-007          ↓       UI-008          ↓       UI-009          ↓       UI-010 (end-to-end UX closure evidence)
2. Edge list (exact)
#	From	To
1	UI-001	UI-002
2	UI-002	UI-003
3	UI-002	UI-004
4	UI-002	UI-005
5	UI-005	UI-006
6	UI-006	UI-007
7	UI-007	UI-008
8	UI-008	UI-009
9	UI-009	UI-010
3. Work-item records
UI-001 — Product foundation: application shell, navigation grammar, and state display primitives
Status: PLANNED (machine state: next)
Depends on: none
Dependents: UI-002
Owned surfaces: application shell and root layout; the single navigation grammar; state display primitives (SUCCEEDED, FAILED, UNKNOWN, WAITING, IN_PROGRESS, ACTION_REQUIRED); environment signal (sandbox vs production); role-scoped navigation scaffold for the five roles
Work order: spec/product/work-orders/UI-001.md
Program role: foundation that every later surface mounts into
UI-002 — Customer payment intent surface
Status: PLANNED (machine state: blocked)
Depends on: UI-001
Dependents: UI-003, UI-004, UI-005
Owned surfaces: customer intent composition/review/submit flow; intent state presentation (customer role); customer navigation entries
Work order: spec/product/work-orders/UI-002.md
Program role: first consequential-UX surface; establishes the outcome-first pattern for feature surfaces
UI-003 — Merchant checkout surface
Status: PLANNED (machine state: blocked)
Depends on: UI-002
Dependents: none (graph leaf)
Owned surfaces: merchant checkout flow (offer/quote presentation, explicit accept/decline, consequential states); merchant navigation entries
Work order: spec/product/work-orders/UI-003.md
Program role: parallel feature surface; leaf with closure-scope obligations (UI-009/UI-010)
UI-004 — Provider and capability surface
Status: PLANNED (machine state: blocked)
Depends on: UI-002
Dependents: none (graph leaf)
Owned surfaces: provider capability/eligibility read-only presentation; provider navigation entries
Work order: spec/product/work-orders/UI-004.md
Program role: parallel feature surface; leaf with closure-scope obligations (UI-009/UI-010)
UI-005 — Track, status, and evidence surface
Status: PLANNED (machine state: blocked)
Depends on: UI-002
Dependents: UI-006
Owned surfaces: universal track/status surface; evidence/proof-trail presentation; deep-linkable status views
Work order: spec/product/work-orders/UI-005.md
Program role: parallel feature surface and the base for waiting/recovery (UI-006)
UI-006 — Waiting, queued, and delayed fulfillment UX with recovery
Status: PLANNED (machine state: blocked)
Depends on: UI-005
Dependents: UI-007
Owned surfaces: waiting/queued/delayed presentation on the track/status surface; recovery action flows; reconciliation visibility for unresolved states
Work order: spec/product/work-orders/UI-006.md
Program role: makes non-terminal outcomes first-class
UI-007 — Liquidity, credit, and queue visibility surfaces
Status: PLANNED (machine state: blocked)
Depends on: UI-006
Dependents: UI-008
Owned surfaces: read-only liquidity/credit/queued-position visibility for roles permitted by the owning protocol authorities
Work order: spec/product/work-orders/UI-007.md
Program role: read-only protocol truth presentation
UI-008 — Agent proposal, mediation, and dispute/recourse surfaces
Status: PLANNED (machine state: blocked)
Depends on: UI-007
Dependents: UI-009
Owned surfaces: agent-proposal review/decision surfaces; human mediation interaction surfaces; dispute initiation and recourse tracking
Work order: spec/product/work-orders/UI-008.md
Program role: human-in-the-loop consequential surfaces
UI-009 — Responsive, accessibility, and role-correctness hardening across all surfaces
Status: PLANNED (machine state: blocked)
Depends on: UI-008
Dependents: UI-010
Owned surfaces: cross-cutting hardening pass over every surface materialized by UI-001..UI-008 at execution time; the hardening evidence bundle
Work order: spec/product/work-orders/UI-009.md
Program role: objective-quality gate before closure
UI-010 — End-to-end UX closure evidence and Architect closure
Status: PLANNED (machine state: blocked)
Depends on: UI-009
Dependents: none (closure target)
Owned surfaces: end-to-end closure evidence bundle; Architect closure submission
Work order: spec/product/work-orders/UI-010.md
Program role: closure gate; completion of UI-010 closes the program
4. Invariants
The graph above is pinned: nine edges, no extra, no missing. This ledger is the source of record; the roadmap and the machine state mirror it.
Statuses live in the machine state (a projection); Git merge facts are authoritative.
UI-003 and UI-004 are leaves: nothing depends on them in the graph, but program closure requires them COMPLETE, and UI-009's hardening scope includes their surfaces.
Changes to this ledger are additive and go through the governed Tech Lead process.
5. Closure

Closure target: UI-010. Closure requires all ten items COMPLETE, objective end-to-end UX evidence, responsive/accessibility evidence, and Architect closure.
