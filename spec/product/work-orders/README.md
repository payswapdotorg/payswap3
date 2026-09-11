Product/UI Work Orders — Index and Format Contract

Status: ACTIVE
Program: payswap3-product
Directory: spec/product/work-orders/
UX contract: spec/product/ux-architecture-v0.2.md (product-layer v0.2)
Roadmap (frozen): spec/product/implementation-roadmap.md
Ledger: spec/product/work-items.md
Machine state: spec/development-state/product-program-state.json

1. Purpose

This directory holds the ten dispatchable work orders of the product/UI program (UI-001..UI-010). This README is the index and the format contract for those files. Work orders are PLANNED until dispatched through the governed process.

2. Format contract

Every work order in this directory mirrors the system work-order format (exemplar: spec/system-work-orders/DEP-001.md) and MUST contain, in this order:

# UI-00X — <title> — the work-order header
**Status:** — PLANNED until dispatch; transitions only via governed merges
**Depends on:** — exactly the pinned graph predecessors (see the ledger)
**Owned surfaces:** — the UI surfaces the item may create or modify; nothing else
**Forbidden:** — always begins with the product baseline (protocol semantics; financial authority; bypassing protocol authorization), followed by item-specific prohibitions
## Objective — what the item achieves, in plain language
## Acceptance — checkable criteria; UX-contract rules are cited where they bind
## Required evidence — the objective artifacts the item must produce
## Stop conditions — the conditions under which the item stops and reports upward
3. Index
ID	Title	Depends on	Status	Path
UI-001	Product foundation: application shell, navigation grammar, and state display primitives	—	MERGED — f934a76 (PR #6)	spec/product/work-orders/UI-001.md
UI-002	Customer payment intent surface	UI-001	MERGED — 5bff0d6 (PR #10)	spec/product/work-orders/UI-002.md
UI-003	Merchant checkout surface	UI-002	PLANNED	spec/product/work-orders/UI-003.md
UI-004	Provider and capability surface	UI-002	MERGED — 35ef9fe (PR #12)	spec/product/work-orders/UI-004.md
UI-005	Track, status, and evidence surface	UI-002	MERGED — 4ce0e74 (PR #11)	spec/product/work-orders/UI-005.md
UI-006	Waiting, queued, and delayed fulfillment UX with recovery	UI-005	PLANNED	spec/product/work-orders/UI-006.md
UI-007	Liquidity, credit, and queue visibility surfaces	UI-006	PLANNED	spec/product/work-orders/UI-007.md
UI-008	Agent proposal, mediation, and dispute/recourse surfaces	UI-007	PLANNED	spec/product/work-orders/UI-008.md
UI-009	Responsive, accessibility, and role-correctness hardening across all surfaces	UI-008	PLANNED	spec/product/work-orders/UI-009.md
UI-010	End-to-end UX closure evidence and Architect closure	UI-009	PLANNED	spec/product/work-orders/UI-010.md

The dependency column encodes the pinned graph exactly: nine edges, no extra, no missing.

4. Dispatch rules
Only frontier items are dispatchable; the frontier starts at UI-001 and is tracked in the machine state.
After UI-002, the items UI-003, UI-004, and UI-005 are dispatchable in parallel.
UI-003 and UI-004 are graph leaves; they MUST be complete before UI-009 acceptance (scope requirement, not a graph edge).
Closure (UI-010) requires all ten items COMPLETE, objective end-to-end UX evidence, responsive/accessibility evidence, and Architect closure.
5. Authority boundaries
Product work orders govern UI surfaces only. They never define or alter protocol semantics, never carry financial authority, and never bypass protocol authorization.
Forbidden surfaces for every product work order: all existing repository files (read-only), sibling-owned state files (including spec/development-state/system-program-state.json), backend implementation, deployment topology, and anything under the frozen protocol architecture.
Product work orders are a separate bounded program from protocol work orders (WORK-001..WORK-033, complete) and from system work orders (spec/system-work-orders/).
Versioning note: the product program uses product-layer version labels (UX contract v0.2). These never denote or replace protocol v0.1.
