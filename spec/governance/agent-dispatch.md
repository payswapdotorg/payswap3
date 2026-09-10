# Agent dispatch protocol

- Work item: GOV-001
- Layer: governance (authoritative contract)
- Base: main @ b9737e9b78482f32ea02ff279ea75d82386ee3cd
- Machine validation of dispatch contracts: `agents/schemas/execution-context.schema.json`
- Related: `spec/governance/source-of-truth.md`, `spec/governance/implementation-protocol.md`, `spec/governance/parallel-execution.md`, `spec/governance/drift-control.md`

## Purpose

This document defines how the Tech Lead dispatches workers and what a valid dispatch contains. Dispatch is the only channel through which a worker acquires work. A dispatch that does not satisfy this protocol is invalid: the worker must stop and report a CONTRACT_BLOCKER rather than improvise the missing terms. Workers receive bounded contracts and never acquire architectural authority from assignment.

## The dispatch unit

One work item, one branch, one pull request, one explicit contract — per worker. The four are inseparable:

- The work item is the unit of authorization, evidence, and merge accounting.
- The branch isolates the change so the diff can be reviewed as a whole.
- The pull request is the single review and merge vehicle for the work item.
- The contract (the execution context below) bounds what may change and what must be proven.

A worker never holds two work items concurrently. A work item is never split across workers after dispatch; if it must be split, the Tech Lead closes the original contract and issues new ones. Rationale: bounded scope keeps diffs reviewable at the scope-verification gate, keeps the parallel-execution surface math sound, and keeps merge accounting one-to-one with work items.

## The execution context (required dispatch fields)

Every dispatch MUST carry all thirteen required fields. The names below map to the properties required by `agents/schemas/execution-context.schema.json` (JSON Schema draft 2020-12); a dispatch that fails the schema is invalid.

| Contract term | Schema property | Required semantics |
|---------------|------------------|---------------------|
| Repository | repository | Repository identity in owner/name form, e.g. payswapdotorg/payswap3 |
| Exact current main SHA | base_sha | Full 40-hex SHA of main at dispatch time; the worker builds on exactly this and records it in every report |
| Work item ID | work_item_id | The single assigned work item, e.g. GOV-001 |
| Architecture authority | architecture_authority | Path of the authoritative architecture for this item, e.g. spec/architecture/v0.1/ |
| Hard dependencies | hard_dependencies | Work item IDs that must be MERGED (a Git fact) before implementation starts; never inferred from projections |
| Contract dependencies | contract_dependencies | Contracts the item must conform to: repository paths or work item IDs |
| Owned surfaces | owned_surfaces | Path prefixes that are the only surfaces the worker may create or modify; at least one required; a prefix reserves every path beneath it |
| Forbidden surfaces | forbidden_surfaces | Path prefixes the worker must never create, modify, or delete |
| Assurance profile | assurance_profile | The evidence standard that applies to this item (tests, proofs, journey evidence) |
| Required proofs | required_proofs | Concrete, checkable proofs the worker must deliver; at least one required |
| Dogfooding requirements | dogfooding_requirements | Journey evidence required by spec/governance/dogfooding-protocol.md |
| Checkpoint contract | checkpoint_contract | When and how the worker reports: checkpoints, report format, escalation timing |
| Stop conditions | stop_conditions | Conditions that halt implementation and trigger escalation per spec/governance/drift-control.md; at least one required |

Field semantics worth emphasizing:

- base_sha is exact. If main moves while the worker is dispatched (a sibling merges), the Tech Lead issues a sibling-wave update with the new SHA; the worker records the new authoritative base in the final report but never rebases onto unmerged sibling branches to acquire sibling code.
- owned_surfaces and forbidden_surfaces are path prefixes. The worker may touch only paths under an owned prefix; a forbidden prefix forbids everything beneath it. Surface disjointness against dispatched siblings is computed per spec/governance/parallel-execution.md and verified in the actual repository.
- hard_dependencies gate dispatch (merged or not — a Git fact), while contract_dependencies gate conformance (present and followed).

## Dispatch checklist (Tech Lead)

Before dispatching, the Tech Lead must be able to answer yes to every item:

1. Eligibility: the work item's hard dependencies are merged per Git history, and its protected surfaces are disjoint from every other dispatched sibling, verified in the actual repository at the base SHA.
2. Base captured: the exact current main SHA (full 40 hex) is recorded in the execution context.
3. Contract complete: all thirteen fields are present and the context validates against agents/schemas/execution-context.schema.json.
4. Surfaces verified: owned and forbidden prefixes are listed against the actual repository tree, not against a projection.
5. Assurance stated: the assurance profile, required proofs, and dogfooding requirements are explicit and match the work item's risk.
6. Checkpoints and stop conditions stated: the worker knows when to report and what halts work.
7. One worker: exactly one worker receives the contract for this work item.
8. No secrets anywhere in the dispatch text.

## Worker obligations

A dispatched worker must: implement exactly the contract; create the single branch named per spec/governance/implementation-protocol.md; touch only owned surfaces; produce every required proof and dogfooding evidence; report at every checkpoint defined by the checkpoint contract; classify and escalate findings per spec/governance/drift-control.md; and stop immediately on any stop condition. The worker never merges the pull request, never consumes unmerged sibling code, and never expands scope — including to fix attractive adjacent problems (those are OUT_OF_SCOPE findings to report, not fixes to include).

## Non-negotiables

1. Workers never merge their own pull requests. Merge authority is the Architect's alone (see spec/governance/implementation-protocol.md and spec/governance/governance-model.json).
2. Sibling workers never consume unmerged sibling code. A worker builds only on merged main at the recorded base SHA; sibling branches, unmerged PRs, and sibling reports are not sources of consumable code.
3. Secrets never enter git, work-item text, PR descriptions, or worker reports. Secrets include tokens, credentials, keys, passwords, connection strings with embedded credentials, and environment values marked secret. A worker who discovers a secret reports its location only — never its value — and classifies the discovery per spec/governance/drift-control.md.

## Base SHA movement (sibling-wave updates)

When a sibling merge moves main, in-flight workers receive a sibling-wave update stating the new base SHA and which paths came into existence. The update changes reported facts, not the contract: the worker continues on the same branch and same owned surfaces. If the merged sibling surfaces intersect the worker's contract dependencies in a way that changes required behavior, the Tech Lead either re-issues the contract or records the change as a new work item — the worker does not silently absorb sibling semantics.

## Invalid dispatches and violations

| Violation | Classification | Consequence |
|-----------|----------------|-------------|
| Execution context missing fields or failing the schema | CONTRACT_BLOCKER | Dispatch invalid; worker stops; Tech Lead re-issues |
| Worker touching a forbidden surface | OUT_OF_SCOPE | Escalation; PR rejected at the scope-verification gate |
| Worker consuming unmerged sibling code | OUT_OF_SCOPE | Escalation; affected changes removed before review |
| Worker merging its own PR | merge-rule violation | Reverted; governance defect recorded |
| Secret in dispatch text, branch, PR, or report | ENVIRONMENT_BLOCKER (handling) | Immediate escalation; value never reproduced anywhere |
| Worker holding two work items | CONTRACT_BLOCKER | One contract closed and re-issued |
