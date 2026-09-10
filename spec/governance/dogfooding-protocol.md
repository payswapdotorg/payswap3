# Dogfooding protocol

- Work item: GOV-001
- Layer: governance (authoritative contract)
- Base: main @ b9737e9b78482f32ea02ff279ea75d82386ee3cd
- Related: `spec/governance/implementation-protocol.md` (review gate 6), `spec/governance/source-of-truth.md`, `spec/governance/drift-control.md`

## Purpose

Dogfooding is the repository's own-evidence standard: before a consequential workflow is accepted as complete, it must be exercised as a real journey on the real composed system, and the record of that journey must answer the nine reconciliation questions. This protocol defines what a journey must exercise, what counts as evidence, and where the production/sandbox boundary lies. It exists because assertions and screenshots are cheap and behavior is expensive — completion claims must be backed by the expensive thing.

## Scope

This protocol applies to every work item whose assurance profile includes journey evidence, and to every integration of work items whose user-visible behavior composes. Governance-scaffolding items satisfy it by dogfooding the governance machinery itself: running the validator, walking the lifecycle, and producing the evidence this repository now requires — GOV-001 itself is such a journey (its validator run is its dogfooding evidence).

## Journey requirements

A journey must exercise the real composed system:

- the actual components, in the actual composed topology, with actual persistence — no stubs standing in for financial semantics, no mock authorities, no simulated protocol behavior where real protocol behavior is required;
- the actual protocol semantics as frozen in spec/architecture/v0.1/ — a journey that exercises a re-implementation of the semantics proves nothing about the system;
- the actual user-visible surfaces where the workflow is user-visible, so the ninth question (below) can be answered from observation.

Screenshots alone are insufficient: a screenshot shows that something rendered, not that the system behaved. Sufficient evidence is a journey record: the ordered steps, the commands or API calls made, the state before and after each consequential step, the assertions and their outcomes, and the logs of the consequential steps. Mock-only runs, demo fixtures wired to fake success, and green unit tests without contract review are likewise insufficient for journey evidence.

## The nine reconciliation questions

Every consequential workflow must answer all nine questions. A question answered with an assertion instead of evidence is unanswered:

| # | Question | A sufficient answer includes |
|---|----------|------------------------------|
| 1 | Protocol object | Which protocol object (or, for governance work, which authoritative artifact) the step creates or modifies, named per the protocol registry and the authorities in agents/architect-prompt.md |
| 2 | Owning authority | Which authority owns that object and its semantics, per agents/architect-prompt.md; the artifact that is authoritative for the semantics involved |
| 3 | Runtime boundary | Which runtime boundary the execution crosses (protocol boundary, product shell, deployment host), and what crosses it in which direction |
| 4 | Deployed component | Which deployed component executes the step, per the reconciled system architecture |
| 5 | Persistent state | What persistent state is written or changed, where it lives, and what durability it carries; absence of required persistent state is a red flag (spec/governance/drift-control.md) |
| 6 | UNKNOWN handling | How UNKNOWN semantics are produced, held, and resolved for this step, and who owns the resolution |
| 7 | Reconciliation | How the step reconciles across the three layers (protocol, product, system), and which reconciliation artifact records it |
| 8 | Evidence | What verifiable evidence proves the step executed as described: transcripts, logs, state diffs, validator output, test results mapped to the contract |
| 9 | User-visible state | What state becomes visible to which user, through which surface, verified by observation rather than assertion |

## Evidence standards

What counts as dogfooding evidence:

- full journey records with commands or API calls, sequences, and outcomes;
- state dumps before and after consequential steps, with the persistent location identified;
- validator and test runs with commands, exit codes, and output, mapped to the acceptance criteria they prove;
- logs of consequential steps, tied to the deployed components that produced them.

What never counts, alone or combined, as sufficient dogfooding evidence:

- screenshots (rendering is not behavior);
- mock-only runs that stub financial semantics or authorities;
- green tests without contract review (the never-do list);
- sandbox financial execution presented as production financial execution (below);
- worker or reviewer assertions without artifacts.

## The production/sandbox boundary

Sandbox execution never counts as production financial execution. A sandbox journey demonstrates that the composed system behaves as specified under the sandbox topology; it says nothing about production financial execution, which requires the deployment-governed evidence of the reconciled system architecture, operational evidence, and three-layer reconciliation. Presentation of sandbox financial execution as production execution is a standing red flag (production/sandbox boundary violation, default ARCHITECTURE_BLOCKER). Conversely, simulation and test state must never mutate production financial state — the boundary is bidirectional and is itself a reconciliation question (question 7).

## Journey record format

    Journey: <journey name>
    Work item ID: <item-id>
    Base branch + base SHA: main @ <full 40-hex SHA>
    Environment: sandbox topology of the real composed system (components listed)
    Steps:
      1. <action/command/call> — state before, state after, assertion, outcome
      2. ...
    Nine reconciliation questions:
      1. Protocol object: <answer with evidence pointer>
      2. Owning authority: <answer>
      3. Runtime boundary: <answer>
      4. Deployed component: <answer>
      5. Persistent state: <answer>
      6. UNKNOWN handling: <answer>
      7. Reconciliation: <answer>
      8. Evidence: <answer>
      9. User-visible state: <answer>
    Known gaps: <any unanswered question and why>

## Completion judgment

A consequential workflow counts as dogfooded when its journey record answers all nine questions with acceptable evidence, gathered on the real composed system, with the sandbox/production boundary stated honestly. System completion requires more than dogfooding: all consequential workflows dogfooded, three-layer reconciliation complete, and operational evidence in hand — declaring completion before that is a never-do. Work items that cannot yet satisfy this protocol for their workflows report the gap as a known limitation or a blocker classified per spec/governance/drift-control.md; they never paper over it with screenshots.
