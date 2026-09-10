# Implementation protocol

- Work item: GOV-001
- Layer: governance (authoritative contract)
- Base: main @ b9737e9b78482f32ea02ff279ea75d82386ee3cd
- Related: `spec/governance/agent-dispatch.md`, `spec/governance/source-of-truth.md`, `spec/governance/drift-control.md`, `spec/governance/dogfooding-protocol.md`

## Purpose

This document defines the implementation lifecycle from dispatch to post-merge reconciliation: how a branch is named, how commits are written, what a pull request must contain, which review gates must pass, who merges, and which state duties follow the merge. It exists so that every change enters the repository the same way, reviewable against one contract, with evidence attached and state reconciled after the fact.

## Lifecycle overview

dispatch (agent-dispatch.md) → branch → implement (owned surfaces only) → self-verify (proofs and dogfooding) → pull request (description contract below) → review gates → Architect merge → post-merge state reconciliation. Each stage is defined below; skipping a stage is a contract violation, and weakening any stage to move faster is forbidden (see the assurance floor in spec/governance/parallel-execution.md).

## Branch naming

The branch for a work item is named <item-id>/<slug>:

- <item-id> is the exact work item ID, e.g. GOV-001, PROD-014.
- <slug> is a short lowercase kebab-case phrase for the change, at most five words, e.g. governance-scaffolding, checkout-journey.
- Exactly one branch per work item; the branch is created from the base SHA recorded in the execution context.

Examples: GOV-001/governance-scaffolding, ARCH-001/protocol-area-docs, PROD-014/checkout-journey. A branch name never carries merge claims or review status; those live in the pull request and in Git history.

## Commit conventions

- Subject line: imperative mood, at most 72 characters, naming the change (Add..., Fix..., Record...).
- Every commit references its work item: either prefix the subject with the item ID (GOV-001: add drift classification) or include a trailer line Work-Item: <item-id> in the body.
- One logical change per commit; the commit stands alone as a reviewable unit.
- The body explains why the change is needed and how it satisfies the contract, pointing at evidence where relevant.
- Commits never include secrets, tokens, or credentials.
- Commit messages never assert merge facts (merged, approved, integrated): merging is the Architect's action, and Git history is its only record (spec/governance/source-of-truth.md, rank 1).
- No bulk generated artifacts outside the owned surfaces; generated files that are owned surfaces are committed deliberately, not incidentally.

## Pull request description contract

Every pull request description MUST contain, in this order, exactly these five sections:

1. Work item ID — the single work item this PR implements.
2. Base branch + base SHA — e.g. main @ b9737e9b78482f32ea02ff279ea75d82386ee3cd; if main moved during implementation, also record the new authoritative base communicated by the sibling-wave update.
3. Changed files — the complete list of repository paths created or modified.
4. Acceptance evidence — one bullet per acceptance criterion of the work order, in order, each stating how it is satisfied, with commands, outputs, and artifact references.
5. Known limitations — conservative interpretations made, assumptions recorded, deferred items.

Template (fill every section; no placeholders may remain):

    Pull request title: <item-id>: <imperative summary>

    Work item ID: <item-id>
    Base branch + base SHA: main @ <full 40-hex SHA>
    Changed files:
      - <repository path>
      - <repository path>
    Acceptance evidence:
      - <acceptance criterion 1>: <how it is satisfied, with commands and outputs>
      - <one bullet per acceptance criterion, in order>
    Known limitations:
      - <conservative interpretations, assumptions, deferred items>

The pull request is evidence transport, never state: an assertion in a PR description has no governing force until the merge is a Git fact and the state files are reconciled. PR descriptions never contain secrets.

## Review gates

All six gates must pass before merge. The gates are ordered but all are mandatory; a failure at any gate rejects the PR at that gate.

1. Scope verification — every changed path falls under an owned surface from the execution context; no forbidden surface is touched; no scope expansion hides in the diff; the diff adds files additively where the contract requires it.
2. Required tests — every test named in the assurance profile ran and passed; no skipped or ignored tests without documented justification; the tests exercise the contract, not the implementation's convenience. Green tests alone never substitute for contract review.
3. Evidence inspection — each acceptance-evidence bullet is inspected for real, checkable evidence; screenshots alone are insufficient (spec/governance/dogfooding-protocol.md).
4. Architecture conformance — the change respects the frozen protocol semantics of spec/architecture/v0.1/ and the authority precedence of spec/governance/source-of-truth.md; no second financial authority is introduced; no product-layer version label is treated as protocol v0.2.
5. Dependency verification — every hard dependency is merged per Git history (not per projections); contract dependencies are present and conformed; no unmerged sibling code is consumed.
6. Dogfooding evidence — the required journeys were exercised on the real composed system and each consequential workflow answers the nine reconciliation questions (spec/governance/dogfooding-protocol.md).

## Merge authority

The Architect is the sole merge authority. A pull request merges only when all six gates pass, and only the Architect performs the merge. The implementing worker never merges their own PR under any circumstances, including trivial or time-critical changes; the Tech Lead may integrate and stage verified changes and prepare them for review, but never merges. The merge commit is the Git fact that makes the work item merged (rank 1 in spec/governance/source-of-truth.md); nothing before the merge — review comments, green CI, worker assertions — carries that force.

## Post-merge state reconciliation duties

Immediately after each merge, the following duties are performed (by the Tech Lead as integrator, verified by the Architect as merge authority):

1. Record the merge SHA — the work item's merge commit SHA is written into the owning layer's authoritative state file (program-state.json, product-program-state.json, or system-program-state.json).
2. Update authoritative state — the work item's status becomes MERGED with the merge SHA; the work-order ledger is updated to match.
3. Recompute eligibility — dependency and frontier views are regenerated from the authoritative state files plus the work-order ledger, and the next eligible antichain is computed per spec/governance/parallel-execution.md.
4. Re-validate — python3 scripts/validate_governance.py is run from the repository root and must exit 0.
5. Communicate base movement — in-flight sibling workers receive a sibling-wave update with the new base SHA and the paths that came into existence (see spec/governance/agent-dispatch.md).

These duties are not optional hygiene: until they complete, downstream eligibility computation may run on stale facts, and any dispatch based on the stale state is invalid.

## Worked example (GOV-001)

Branch GOV-001/governance-scaffolding from main @ b9737e9b78482f32ea02ff279ea75d82386ee3cd; commits reference Work-Item: GOV-001; the PR lists all nine changed files, one evidence bullet per acceptance criterion (including the validator run and its output), and known limitations (conservative interpretations). The Architect verifies scope (only owned governance surfaces touched, additively), runs the validator from the repository root, inspects the schema and model files, verifies no protocol or product surface changed, and merges. Post-merge, program-state-style reconciliation records the merge SHA in the governance-relevant state, the frontier is recomputed, and dispatched siblings receive the base-movement update.
