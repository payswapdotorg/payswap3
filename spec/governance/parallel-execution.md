# Parallel execution model

- Work item: GOV-001
- Layer: governance (authoritative contract)
- Base: main @ b9737e9b78482f32ea02ff279ea75d82386ee3cd
- Related: `spec/governance/agent-dispatch.md`, `spec/governance/implementation-protocol.md`, `spec/governance/source-of-truth.md`

## Purpose

This document defines when work items may run in parallel and what the Tech Lead must verify before claiming they can. The parallel model exists to increase throughput without weakening assurance. Its central instrument is the antichain: a set of work items that are pairwise independent, so every member can be dispatched simultaneously without any member depending on, or colliding with, another.

## Definitions

- Work item: the unit of authorization and merge accounting, dispatched under one execution context (spec/governance/agent-dispatch.md).
- Hard dependency: a work item that must be merged (a Git fact) before this item's implementation may start.
- Contract dependency: a contract document this item must conform to, but which does not gate dispatch by merge.
- Protected surface: the set of repository path prefixes a work item's contract reserves — its owned surfaces.
- Dispatched sibling: a worker currently executing a work item against the same main lineage whose pull request is not yet merged.
- Eligible item: a work item whose hard dependencies are all merged and whose protected surfaces are disjoint from every other dispatched sibling's protected surfaces.
- Antichain: a set of pairwise eligible items; the maximal dispatchable parallel wave.

## Eligibility computation

A work item is eligible if and only if all three conditions hold:

1. Every hard dependency is MERGED per Git merge history. Merge status is read from Git facts (rank 1 in spec/governance/source-of-truth.md), never from projections, ledgers, or reports. dependency-state.json and frontier-state.json are recomputed views: they may point the Tech Lead at candidates, but eligibility is confirmed against Git.
2. Its protected surfaces are disjoint from the protected surfaces of every other currently dispatched sibling. Disjointness is verified in the actual repository (procedure below), not assumed from any graph.
3. Its contract dependencies exist and are readable at the base SHA, or are owned by work items already merged at that SHA.

The eligible set is the antichain; the Tech Lead may dispatch any subset of it. Items that fail any condition wait; they are never made parallel by weakening the condition.

## Surface disjointness is verified in the actual repository

Two protected prefixes conflict when one is equal to the other, when one is a directory ancestor of the other, or when both cover at least one common actual path in the repository at the base SHA. Verification procedure, performed before every dispatch:

1. List, for every candidate and every dispatched sibling, the owned surface prefixes from its execution context.
2. Expand each prefix against the actual repository tree at the base SHA: walk the tree and record every existing path (file or directory) the prefix covers, plus the prefix itself as a reservation.
3. Compute pairwise intersections of the expanded sets across all candidates and dispatched siblings.
4. Any non-empty intersection removes the less-ready candidate from the antichain (or forces a re-scope by contract amendment before dispatch).
5. Record the expansion lists in the dispatch record, so the scope-verification review gate can re-check disjointness from facts, not from the graph.

The dependency graph is a hint, not a fact: it is a derived projection, and it says nothing about paths. Disjointness is a filesystem property, and it is inspected on disk. If the graph and the repository disagree, the repository wins (spec/governance/source-of-truth.md).

Worked example: ARCH-001 owns spec/architecture/, spec/registry/, spec/development-state/ files, and spec/work-orders/; GOV-001 owns spec/governance/ documents, agents/schemas/, and scripts/; a product sibling owns spec/product/ documents. The expanded sets are pairwise disjoint in the repository, so the three items form an antichain even though all three cite one another's outputs as read-only context. A hypothetical item owning spec/ would conflict with all three and would be ineligible until re-scoped.

## The assurance floor

Parallelism never weakens assurance. The review gates (spec/governance/implementation-protocol.md), the required tests, the evidence inspection, and the dogfooding standards apply identically to every item whether it runs alone or in an antichain. If parallel execution can only be achieved by skipping a gate, shrinking test scope, accepting screenshots as evidence, or trusting a sibling's unreviewed output, the items are serialized instead. There is no fast path through the assurance floor, and the Tech Lead may not grant one.

## Sibling isolation

Each worker builds only on merged main at the exact base SHA in its execution context. Sibling branches, unmerged pull requests, and sibling worker reports are never sources of consumable code: a sibling's output becomes usable only through its merge and a re-dispatch (or sibling-wave update) against the new base. Workers never rebase onto a sibling branch to unblock themselves; if a dependency on sibling output is real, it should have been a hard dependency, and the item belongs in a later antichain. When main moves mid-flight, in-flight workers receive the sibling-wave update (spec/governance/agent-dispatch.md) and continue on their own branch.

## Integration after constituent merges

Integration work — combining multiple merged implementations into one coherent behavior — happens only after all constituent implementations are merged. Integration work items declare their constituents as hard dependencies and are therefore never part of the antichain that produced the constituents. An integration PR re-runs the full assurance profile over the composed system, plus the dogfooding journeys for every consequential workflow the integration touches. There is no review shortcut for integration PRs: they pass the same six gates, and dogfooding evidence for the composed system is mandatory because constituent evidence does not compose.

## Consequences of violation

Dispatching overlapping surfaces or unmerged dependencies is a CONTRACT_BLOCKER for the affected workers (invalid dispatch). Consuming unmerged sibling code is an OUT_OF_SCOPE escalation. Weakened assurance discovered at review rejects the PR at the failed gate; discovered after merge, it is a drift finding classified per spec/governance/drift-control.md and reconciled by the governing authorities.
