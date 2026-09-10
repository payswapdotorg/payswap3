# Source of truth

- Work item: GOV-001
- Layer: governance (authoritative contract)
- Base: main @ b9737e9b78482f32ea02ff279ea75d82386ee3cd
- Machine-readable companion: `spec/governance/governance-model.json`
- Enforced by: `spec/governance/implementation-protocol.md`, `spec/governance/drift-control.md`, `scripts/validate_governance.py`

## Purpose

This document fixes, for every actor in `payswapdotorg/payswap3` — Architect, Tech Lead, and Worker — the answer to a single question: when two artifacts disagree, which one wins? Ambiguity about precedence is the root cause of silent drift, duplicate financial authority, and governance by chat memory. This contract removes that ambiguity by declaring one precedence order, one contradiction-resolution procedure, and one enforcement mechanism. It is a governance-layer document: it defines no protocol semantics (that authority belongs to `spec/architecture/v0.1/`), no product UX semantics, and no deployment topology; it defines only which artifact decides when artifacts conflict.

## The precedence order

When any two artifacts disagree, the artifact with the lower rank number wins. The order is absolute. No role, conversation, document, or projection may reorder it, and no artifact may opt out of it by declaring itself authoritative — authorities are declared only in `agents/architect-prompt.md` and must exist on disk (checked by `scripts/validate_governance.py`).

| Rank | Authority | Authoritative for |
|------|-----------|-------------------|
| 1 | Git merge history on `main` | What is merged (merge facts: which work item, which commit, which SHA) |
| 2 | Frozen protocol architecture `spec/architecture/v0.1/` | Financial semantics: authority, accounting, execution, clearing, netting, settlement, finality |
| 3 | Layer authoritative state files | The tracked development state of their own layer only |
| 4 | Layer contracts and work-order surfaces | The declared scope and contracts of their own layer |
| 5 | Derived projections | Nothing. Projections render state for humans; they never authorize work |
| 6 | Conversation and chat memory | Nothing. Never authoritative for any decision |

Same-rank authorities of different layers govern only their own layer. A cross-layer conflict between same-rank artifacts is a reconciliation finding, not a precedence win: it is classified per `spec/governance/drift-control.md` and resolved through the reconciliation process, never by one layer overwriting the other.

### Rank 1 — Git merge history

Git history on `main` is the single source of merge facts. A work item is merged if and only if a merge exists in Git history; no state file, ledger, roadmap, report, or conversation can make a work item merged, and none can un-merge it. The layer state files record merge SHAs as a convenience index, but wherever that record and Git disagree, Git wins and the state file carries a reconciliation defect that must be repaired through the post-merge reconciliation duties in `spec/governance/implementation-protocol.md`.

### Rank 2 — frozen protocol architecture

`spec/architecture/v0.1/` is authoritative for all financial semantics: authority, accounting, execution, clearing, netting, settlement, and finality. The architecture is frozen; any change to its semantics requires the Architecture Change Request process. Product-layer version labels never create a protocol v0.2. No other layer — product, deployment, or governance — may define, extend, or reinterpret financial semantics; a layer that appears to do so is a duplicate financial authority (a standing red flag in `spec/governance/drift-control.md`).

### Rank 3 — layer authoritative state files

Exactly three files are authoritative for the tracked development state of their layer:

| Layer | State file | Tracks |
|-------|-----------|--------|
| Protocol | `spec/development-state/program-state.json` | Protocol work items, merge SHAs, frontier inputs |
| Product/UI | `spec/development-state/product-program-state.json` | Product work items, UI machine state |
| System/deployment | `spec/development-state/system-program-state.json` | Deployment/system work items, system state projection |

Each file tracks its own layer only; none may record facts about another layer. `dependency-state.json` and `frontier-state.json` are recomputed views of protocol state: they are maintained by post-merge reconciliation and must always be regenerable from `program-state.json` plus the work-order ledger. When a recomputed view disagrees with Git facts or with `program-state.json`, ranks 1 through 3 win and the view carries a reconciliation defect until it is recomputed.

### Rank 4 — layer contracts and work-order surfaces

Layer contracts and work-order surfaces — `spec/work-orders/` for the protocol layer, the product contracts under `spec/product/`, and the system contracts `spec/system-architecture.md`, `spec/system-reconciliation.md`, and `spec/system-work-items.md` — are authoritative for the declared scope of their own layer. They authorize bounded work through the dispatch protocol in `spec/governance/agent-dispatch.md`. They never override ranks 1 through 3: a work order that contradicts the frozen architecture is an ARCHITECTURE_BLOCKER, and a work order that contradicts merge facts is a CONTRACT_BLOCKER (see `spec/governance/drift-control.md`).

### Rank 5 — derived projections never authorize work

A projection is any artifact rendered or recomputed from higher-ranked authorities: `spec/product/implementation-roadmap.md` (a frozen human-readable roadmap), summaries, README narratives, closure documents, rendered frontier views, and worker reports. Projections exist to be read. A projection may inform planning, but it may never authorize, expand, or re-scope work. Work authorization flows only from work-order contracts under rank 4, with eligibility computed from ranks 1 through 3 per `spec/governance/parallel-execution.md`. The standing rule: a projection that contradicts Git facts loses — always, immediately, and without negotiation — and the projection is corrected to match the facts.

### Rank 6 — conversation memory is never authoritative

Chat transcripts, prompts, dispatch messages, worker reports, PR descriptions, review comments, and session memory are transport and evidence, never state. An approval, decision, or semantic change that exists only in a conversation has zero governing force. If a conversational decision matters, it must be materialized through the governing process — a work-order contract, a state-file update by reconciliation, or an Architecture Change Request — before it has any effect. A worker or Tech Lead citing a conversation as authority is a drift finding classified per `spec/governance/drift-control.md`.

## Contradiction-resolution procedure

When any two artifacts appear to disagree, follow this procedure in order:

1. Identify the artifacts in conflict and the rank of each.
2. The lower rank wins, immediately and without negotiation. Same-rank, cross-layer conflicts are reconciliation findings, not precedence wins.
3. If a projection contradicts Git facts, the projection loses and is corrected to match Git.
4. Classify the residue: whatever defect produced the contradiction (stale state, missing authority, duplicate authority, scope expansion) is classified per `spec/governance/drift-control.md` and escalated per the escalation rule.
5. Reconcile: the owning authority repairs the losing artifact through its governed process (state reconciliation, projection recompute, contract amendment, or Architecture Change Request), and the repair is re-verified.

## Worked examples

- `program-state.json` records WORK-032 as merged, but Git history shows no merge commit for it. Git wins; the state entry is a reconciliation defect. The Tech Lead repairs the state file; no work is dispatched on the assumption that WORK-032 is merged.
- `implementation-roadmap.md` describes a capability that `spec/architecture/v0.1/` does not define. The roadmap is a projection; it loses. The gap is classified (missing protocol capability required by the product) and escalated — the product layer must not implement the capability itself.
- A product document labels itself v0.2 and appears to define settlement rules. The frozen protocol is the only financial authority; the product document is a duplicate financial authority (ARCHITECTURE_BLOCKER), and a product-layer version label never denotes protocol v0.2.
- A worker report asserts that a change is merged. The report is evidence, not state. Only Git history (rank 1) can make that assertion true, and only the state files (rank 3) may index it after reconciliation.

## Enforcement

- `python3 scripts/validate_governance.py` (run from the repository root) checks that every authority path declared in `agents/architect-prompt.md` exists on disk; absent sibling-wave paths are reported as MISSING (sibling wave), and any other absent path is a hard failure.
- The review gates in `spec/governance/implementation-protocol.md` reject pull requests that rely on projections or conversation memory as authority.
- Violations are classified and escalated per `spec/governance/drift-control.md`; the machine-readable summary of this hierarchy is `spec/governance/governance-model.json`.
