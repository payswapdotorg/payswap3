# PaySwap System Completion and Three-Architecture Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the repository's existing worker/Architect protocol and implement this plan task-by-task. Do not create a new protocol architecture.

**Goal:** Make a fresh Tech Lead capable of completing the remaining PaySwap product and deployment work while reconciling the frozen v0.1 backend, product UX layer, and operational deployment layer into one verified system.

**Architecture:** Preserve the frozen PaySwap v0.1 protocol architecture. Treat product/UX and deployment as separate bounded layers that integrate with, but never supersede, protocol authorities.

**Tech Stack:** Use the repository's existing Python application, protocol modules, product shell, test infrastructure, CI configuration, and deployment/runtime technology actually present in the repository. Do not introduce a new stack merely for architectural cleanliness.

**Spec:** `spec/system-architecture.md`

## Global Constraints

- Backend protocol authority remains `spec/architecture/v0.1/`.
- Product UX remains a presentation/orchestration layer and cannot create financial authority.
- Deployment infrastructure cannot duplicate financial authority.
- Unknown external outcomes require reconciliation before unsafe retry.
- External effects remain behind adapter boundaries.
- Financial arithmetic remains exact and deterministic.
- Existing netting, liquidity, credit, queues, capability, agents, merchant, evidence, recourse, simulation, federation, settlement and finality semantics remain intact.
- All work uses repository-first evidence and the existing Architect/worker governance model.

---

### Task 1: Persist reconciled system architecture

Create `spec/system-architecture.md` and `spec/system-work-items.md`. Establish the single system-level reconciliation contract and deployment work graph without creating a protocol v0.2.

### Task 2: Harden fresh Tech Lead bootstrap

Update the architecture/agent bootstrap references so a fresh Tech Lead discovers protocol, product and deployment authorities plus the final system reconciliation gate.

### Task 3: Normalize UX architecture naming/semantics

Inspect all references to `ux-architecture-v0.2.md`, `execution-handoff-v0.2.md`, and `execution-runtime-v0.2.md`. Preserve legitimate product-layer contracts while making clear that their version labels do not denote a replacement protocol architecture.

### Task 4: Build deployment architecture from actual repository topology

Inspect the real runtime and define API/web, workers, scheduler, queues, database, evidence/object storage, secrets, external adapters, environment boundaries, observability, CI/CD, backup/recovery and production safety. Every component must map to actual repository behavior.

### Task 5: Activate DEP-001 through DEP-003

Implement deployment topology/environment contract, runtime/configuration packaging, and durable persistence/work execution with repository-native worker boundaries.

### Task 6: Activate DEP-004 and DEP-005

Implement durable reconciliation/clearing/netting/settlement-supporting workers and production-safe external rail connectivity. Prove duplicate work, restart, queue redelivery, UNKNOWN, timeout, adapter failure and recovery behavior.

### Task 7: Activate DEP-006 and DEP-007

Implement CI/CD promotion, release verification, observability, resilience and disaster recovery including migration safety, rollback safety, backup/restore, replay/recovery and configuration validation.

### Task 8: Finish UI-001 through UI-010

Follow the existing frozen product roadmap. Do not mark UI items final without implementation, objective workflow evidence, responsive/accessibility evidence, Architect review, merge and product-state reconciliation.

### Task 9: SYS-001 — Three-architecture reconciliation

Build a deterministic matrix connecting UX flow → protocol object/state → protocol authority → API/runtime boundary → deployment component → persistence → evidence. Test major journeys and reject duplicate authority or bypass paths.

### Task 10: SYS-002 — Full-system dogfood

Exercise customer, merchant, provider, liquidity, developer, agent, operator and administrator journeys as applicable, including cross-corridor netting, queued demand, liquidity, credit, capability emergence, agents, merchant acceptance, disputes/recourse, blockchain paths, UNKNOWN and recovery.

### Task 11: DEP-008 — Production readiness proof

On the exact release candidate execute production-like integration, failure injection, rollback, backup/restore, queue recovery, external-effect safety, configuration/secret validation and observability verification.

### Task 12: SYS-003 — Final closure

Only close after all UI items are final, deployment readiness is final, SYS-001 and SYS-002 pass, the exact release revision is verified, machine state is synchronized, and the Architect approves closure.
