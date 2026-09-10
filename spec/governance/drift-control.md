# Drift control

- Work item: GOV-001
- Layer: governance (authoritative contract)
- Base: main @ b9737e9b78482f32ea02ff279ea75d82386ee3cd
- Machine-readable companion: `spec/governance/governance-model.json`
- Related: `spec/governance/source-of-truth.md`, `spec/governance/agent-dispatch.md`

## Purpose

Drift is any observed deviation between what the repository's declared model says is true and what is actually true or being done: a state file that disagrees with Git, a product document that defines financial semantics, a dispatch that overlaps surfaces, a secret that leaked into a report. This document defines the classification of drift findings, the one standing rule that governs who may fix what, the standing red flags that always escalate, and the escalation ladder.

## The classification enum

Every drift finding is classified with exactly one of five values. The classification determines the required action, and the action is not optional:

| Value | Meaning | Required action |
|-------|---------|-----------------|
| WITHIN_SCOPE | A defect fully inside the assigned work item: owned surfaces, contract scope, no authority or semantic implications | May be fixed inside the assigned work item — the only classification that may — and the finding plus its fix is reported |
| OUT_OF_SCOPE | A real issue, but outside the work item's owned surfaces or purpose | Do not fix; record and escalate; the Tech Lead opens a new work item or reassigns |
| CONTRACT_BLOCKER | The work order contract is ambiguous, internally inconsistent, or impossible as given | Stop; escalate to the Tech Lead, the contract owner |
| ARCHITECTURE_BLOCKER | A contradiction with the frozen architecture, the authority model, or the repository facts | Stop; escalate via the Tech Lead to the Architect |
| ENVIRONMENT_BLOCKER | A tooling, access, or environment failure the worker must not resolve unilaterally | Stop; escalate with diagnostics (never secrets); retry only as directed |

## The standing rule

Only WITHIN_SCOPE findings may be fixed inside the assigned work item. Every other classification is stop-and-escalate: the worker halts the affected work, preserves evidence, and escalates rather than solving locally. Fixing a non-WITHIN_SCOPE finding locally is itself a drift violation — scope expansion — regardless of how correct the local fix looks, because the fix bypassed the authority that owns the problem. When a worker is uncertain between two classifications, the worker chooses the more severe plausible classification; downgrading a classification is the authority-holders' decision, never the worker's.

## Standing red flags

The following findings are standing red flags: they always escalate (their default classification is a floor, not a ceiling), and only the Architect may downgrade a default classification after review. A worker who observes one records it and escalates immediately.

| Red flag | What it looks like | Default classification |
|----------|--------------------|------------------------|
| Architecture contradiction | An artifact or change contradicts the frozen semantics of spec/architecture/v0.1/ or the authority precedence in spec/governance/source-of-truth.md | ARCHITECTURE_BLOCKER |
| Missing authority | An artifact depends on an authority path that does not exist on disk and is not a declared sibling-wave path (validate_governance.py hard-fails it); when the missing authority undermines the authority model itself, raise to ARCHITECTURE_BLOCKER | CONTRACT_BLOCKER |
| Duplicate financial authority | A non-protocol layer (product, deployment, governance) defines, extends, or reinterprets financial semantics: settlement, netting, finality, accounting authority | ARCHITECTURE_BLOCKER |
| Missing protocol capability required by the product | A product journey requires a capability the frozen protocol does not provide; the gap needs an Architecture Change Request, never an invention inside the product layer | ARCHITECTURE_BLOCKER |
| Deployment path bypassing protocol authority | A runtime or deployment route skips protocol-mandated authority, accounting, or execution boundaries | ARCHITECTURE_BLOCKER |
| Unsafe external retry | A non-idempotent external financial operation is retried without the protocol-mandated safeguards | ARCHITECTURE_BLOCKER |
| Unresolved UNKNOWN semantics | An UNKNOWN state persists without an owner or beyond its reconciliation window, or UNKNOWN handling is absent where the protocol requires it | ARCHITECTURE_BLOCKER |
| Missing persistent state | A consequential workflow writes no persistent record, or state that must be durable is volatile | CONTRACT_BLOCKER |
| Production/sandbox boundary violation | Sandbox execution is presented as production financial execution, or simulation/test state can mutate production financial state | ARCHITECTURE_BLOCKER |
| Schema/migration conflict | An incompatible schema or migration affects persistent state or cross-layer contracts | CONTRACT_BLOCKER |
| Protected-surface conflict | The protected surfaces of dispatched work items intersect, or a worker touched a path outside its owned surfaces | CONTRACT_BLOCKER |

## The escalation ladder

Level 1 — Worker. On any classification other than WITHIN_SCOPE, the worker stops the affected work immediately, preserves the evidence (paths, commands, outputs; never secrets), and files an escalation report (template below). The worker does not continue on the affected surface and does not attempt mitigation that touches anything outside the finding's WITHIN_SCOPE residue, if any.

Level 2 — Tech Lead. The Tech Lead triages the escalation: repairs the contract (CONTRACT_BLOCKER), records a new work item or reassigns (OUT_OF_SCOPE), re-scopes or serializes the affected dispatches (protected-surface conflict), handles the environment (ENVIRONMENT_BLOCKER), or routes the finding upward (ARCHITECTURE_BLOCKER and any red flag whose default is architectural). The Tech Lead never resolves a financial-semantics question locally.

Level 3 — Architect. The Architect resolves architecture contradictions, duplicate-authority findings, and capability gaps (via the Architecture Change Request process when protocol semantics are affected), reclassifies or confirms standing red flags, and decides merge consequences.

Escalations are acknowledged before further work proceeds on the affected surface. A worker resumes only when the resolution is recorded in an updated contract or a sibling-wave update — not from a conversational assurance (spec/governance/source-of-truth.md, rank 6).

## Escalation report format

    Work item ID: <item-id>
    Base branch + base SHA: main @ <full 40-hex SHA>
    Classification: <one of the five values>
    Standing red flag (if any): <flag name>
    Observed facts: <paths, commands, outputs — never secrets, never secret values>
    Why local resolution was rejected: <one short paragraph citing the standing rule>
    Proposed resolution (advisory only): <one short paragraph>

The proposed resolution is advisory: the deciding authority owns the decision. The report is transport, not state — it never modifies facts by itself (spec/governance/source-of-truth.md).
