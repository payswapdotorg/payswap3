# PaySwap Developer Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Workers must read the frozen design and the assigned PC work order before changing files.

**Goal:** Implement the approved post-closure PaySwap developer console inside the existing Next.js 16 application while preserving protocol authority, role isolation, and the closed system-completion program.

**Architecture:** A unified `/console` product surface uses a server-side console read boundary over existing protocol/runtime and operational authorities. Presentation DTOs compose authoritative state but do not become new financial authorities. The only concurrent implementation pair is PC-002 and PC-003 after PC-001 is merged; all later work is serial.

**Tech Stack:** Next.js 16.1.3, React 19.2.3, TypeScript 5.9.3, existing repository UI components, existing protocol/runtime APIs and operational boundaries.

**Spec:** `docs/superpowers/specs/2026-09-14-payswap-developer-console-design.md`

## Global Constraints

- Base architecture revision: `4f973c92d7534a13854dfa4468bfa3a72dd14756`.
- Design revision: `05aa67535d0a2a28f5244f6f0e17e20059634144`.
- Treat the existing `WORK-*`, `UI-*`, `DEP-*`, and `SYS-*` completion records as immutable history.
- Do not introduce protocol v0.2, a console-local ledger, parallel payment state, or new finality/settlement authority.
- Role and environment selection are server-side; client state is presentation only.
- UNKNOWN remains UNKNOWN when the authoritative source is unavailable.
- A repository build does not prove production deployment.
- Maximum three workers; only PC-002 and PC-003 may run concurrently.
- Workers never merge themselves; the Tech Lead verifies exact worker revisions before merge.

---

## File ownership map

| Work | Primary owned paths | Downstream contract |
|---|---|---|
| PC-001 | `src/lib/console/`, `src/app/console/` scaffolding, `src/app/api/console/` scaffolding, `src/components/console/`, `spec/console/` | role policy, environment context, DTO/status conventions, route registry, reconciliation matrix |
| PC-002 | `src/app/console/`, `src/components/console/shell/` | route tree + shell/navigation |
| PC-003 | `src/app/api/console/`, `src/lib/console/read-models/`, `src/lib/console/authority/` | server read DTOs + source metadata |
| PC-004 | `src/app/console/` feature routes, `src/components/console/views/`, console evidence/tests | composed feature pages using PC-003 DTOs |
| PC-005 | `src/app/console/developers/`, `src/components/console/developers/`, `src/lib/console/developers/`, maintained documentation content | developer controls and diagnostic UX |
| PC-006 | existing `deploy/` and `spec/deployment/` console-specific contracts/evidence | release/provider binding evidence |
| PC-007 | existing `scripts/`, `spec/console/`, closure/evidence files, console program state | exact-release verification and Architect approval record |

A worker must not modify a sibling's owned paths without the Tech Lead explicitly re-slicing the work order.

---

### Task 1: PC-001 — Foundation, contracts, and governance

**Files:**
- Create/modify: `src/lib/console/`
- Create/modify: `src/app/console/` scaffolding only
- Create/modify: `src/app/api/console/` scaffolding only
- Create/modify: `src/components/console/` shared primitives only
- Create/modify: `spec/console/`
- Test: console unit/conformance tests following existing repository conventions

**Interfaces:**
- Consumes: current identity/session source, current environment configuration, existing protocol/runtime and operational boundary contracts.
- Produces: server role policy, environment context, console status/DTO conventions, route/module registry, reconciliation matrix consumed by PC-002..PC-004.

- [ ] Step 1: Inventory current identity/role and environment sources in the repository; record the exact source symbols in the PC-001 evidence.
- [ ] Step 2: Write failing tests for role fail-closed behavior, server-derived environment, UNKNOWN propagation, and DTO status validation.
- [ ] Step 3: Implement the minimum server-side console policy/context/contracts without adding financial persistence.
- [ ] Step 4: Add the frozen route/module registry and the five-view reconciliation matrix.
- [ ] Step 5: Run `npm run typecheck` and `npm run build`.
- [ ] Step 6: Run the focused PC-001 tests and inspect imports for direct UI-to-financial-store access.
- [ ] Step 7: Commit only PC-001 owned files and publish the exact commit for Tech Lead review.

---

### Task 2: PC-002 — Shell and navigation

**Files:**
- Create/modify: `src/app/console/`
- Create/modify: `src/components/console/shell/`
- Test: route inventory, role/deep-link, responsive shell tests

**Interfaces:**
- Consumes: PC-001 role policy, environment context, route/module registry.
- Produces: `/console` shell and frozen navigation consumed by PC-004 and PC-005.

- [ ] Step 1: Add failing route tests for `/console` and representative role-restricted deep links.
- [ ] Step 2: Implement shell/layout and route entrypoints using the existing shared navigation grammar.
- [ ] Step 3: Implement responsive navigation for desktop/mobile without changing route semantics.
- [ ] Step 4: Verify unauthorized direct navigation fails closed.
- [ ] Step 5: Run `npm run typecheck`, `npm run build`, route tests, keyboard/focus checks, and horizontal-overflow checks.
- [ ] Step 6: Commit only PC-002 owned files and report exact commit plus verification output.

---

### Task 3: PC-003 — API boundary and read models

**Files:**
- Create/modify: `src/app/api/console/`
- Create/modify: `src/lib/console/read-models/`
- Create/modify: `src/lib/console/authority/`
- Test: API contract, source mapping, UNKNOWN/environment tests

**Interfaces:**
- Consumes: PC-001 role/environment contracts and existing `/api/health`, `/api/ready`, `/api/protocol`, `/api/mediation`, `/api/shell` boundaries where applicable.
- Produces: stable server DTOs with source/authority metadata consumed by PC-004 and PC-005.

- [ ] Step 1: Enumerate each required console read and its current owning source from actual code.
- [ ] Step 2: Write failing tests for authorization, DTO shape, UNKNOWN propagation, and environment selection.
- [ ] Step 3: Implement thin adapters/composition only where existing boundaries do not directly expose the required read.
- [ ] Step 4: Prove no DTO synthesizes financial outcomes from transport failures.
- [ ] Step 5: Run `npm run typecheck`, `npm run build`, and all PC-003 focused tests.
- [ ] Step 6: Commit only PC-003 owned files and publish exact commit/evidence.

---

### Task 4: PC-004 — Composed console views

**Files:**
- Create/modify: `src/app/console/` feature routes under the shell
- Create/modify: `src/components/console/views/`
- Test/evidence: feature integration, UX/accessibility, reconciliation mappings

**Interfaces:**
- Consumes: PC-002 shell and PC-003 DTOs.
- Produces: usable Overview, Payments, Checkout, Accounts, Capabilities, and Operations surfaces.

- [ ] Step 1: Write failing integration tests for payment list/detail, checkout test flow, capability state, and operations health.
- [ ] Step 2: Implement views strictly from PC-003 DTOs.
- [ ] Step 3: Add evidence/timeline presentation without inventing protocol state.
- [ ] Step 4: Add explicit UNKNOWN/waiting/infrastructure-failure presentation.
- [ ] Step 5: Run role matrix, responsive, keyboard/focus, accessibility, overflow, and dead-route checks.
- [ ] Step 6: Update the reconciliation matrix with actual implementation references.
- [ ] Step 7: Commit and publish exact PC-004 revision/evidence.

---

### Task 5: PC-005 — Developer tooling

**Files:**
- Create/modify: `src/app/console/developers/`
- Create/modify: `src/components/console/developers/`
- Create/modify: `src/lib/console/developers/`
- Create/modify: maintained documentation content only where required
- Test: credential scope/revocation, webhook, log redaction, documentation route tests

**Interfaces:**
- Consumes: PC-002 shell and PC-003 server boundary.
- Produces: developer controls with environment scope, diagnostic logs, webhook views, and maintained docs.

- [ ] Step 1: Enumerate the actual credential/webhook/logging capabilities already present in the repository.
- [ ] Step 2: Write failing tests for role/environment scope and protected-field redaction.
- [ ] Step 3: Implement server-side developer controls using existing security boundaries; do not persist parallel financial state.
- [ ] Step 4: Add request-inspector/log views that distinguish diagnostic data from protocol evidence.
- [ ] Step 5: Add documentation pages/links with executable versus illustrative labeling.
- [ ] Step 6: Run typecheck/build and focused developer-tool tests.
- [ ] Step 7: Commit and publish exact revision/evidence.

---

### Task 6: PC-006 — Deployment/provider-binding contract

**Files:**
- Modify only existing `deploy/` and `spec/deployment/` surfaces required for the console package
- Create console deployment verification/evidence under existing conventions
- Test deployment contract checks

**Interfaces:**
- Consumes: PC-005 merged package and the current deployment topology.
- Produces: exact release/package evidence and provider-binding status used by PC-007.

- [ ] Step 1: Re-verify current provider connectivity before making any deployment claim.
- [ ] Step 2: Define the console route/package requirements in the existing deployment contract.
- [ ] Step 3: Write failing checks for exact package identity, environment requirements, and provider binding status.
- [ ] Step 4: Run the repository build/typecheck plus deployment contract checks.
- [ ] Step 5: Record unbound providers explicitly when no live provider connection exists.
- [ ] Step 6: Commit and publish exact PC-006 revision/evidence.

---

### Task 7: PC-007 — Production-like verification and closure

**Files:**
- Create/modify: existing `scripts/` verification surfaces
- Create/modify: `spec/console/` evidence and reconciliation records
- Create/modify: console-specific closure/program-state record

**Interfaces:**
- Consumes: all merged PC-001..PC-006 outputs and exact deployment/provider evidence.
- Produces: exact-release verification transcript, reconciliation report, Tech Lead verification, and Architect approval request.

- [ ] Step 1: Freeze one exact release revision and record its package identity.
- [ ] Step 2: Run customer, merchant, provider, operator, developer, documentation, and environment-separated journeys.
- [ ] Step 3: Exercise delayed/unavailable authority cases and verify UNKNOWN/waiting behavior.
- [ ] Step 4: Run static/conformance, console contract, integration, UX/accessibility, and deployment evidence batteries.
- [ ] Step 5: Reconcile every consequential view to object/state, owner, runtime boundary, durable source, recovery semantics, and evidence.
- [ ] Step 6: Verify no closed WORK/UI/DEP/SYS record was mutated.
- [ ] Step 7: Record Tech Lead verification and request explicit Architect approval before marking the console program complete.

---

## Tech Lead merge gates

A worker branch is mergeable only when its exact HEAD is based on the required parent revision, its owned-file boundary is respected, tests are reproducible, and no stop condition exists. The Tech Lead must compare the worker's changed-file list with the work order instead of trusting the worker summary.

For the concurrent wave, PC-002 and PC-003 merge independently. PC-004 starts only from a revision containing both approved merges. PC-005, PC-006, and PC-007 are serial.

## Final acceptance

The program is complete only when the design acceptance target is met, every consequential state has an authority mapping, role/deep-link isolation is proven, developer controls are safe, integration journeys pass, UX/accessibility evidence is recorded, deployment claims match real provider evidence, one exact release revision is verified, and Architect approval is recorded in the separate console program state.
