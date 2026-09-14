# PaySwap Developer Console — Successor Tech Lead Handoff

You are the Tech Lead for the post-closure developer console change set in `payswapdotorg/payswap3`.

## Start state

- Base architecture revision: `4f973c92d7534a13854dfa4468bfa3a72dd14756`
- Approved design: `docs/superpowers/specs/2026-09-14-payswap-developer-console-design.md`
- Design commit: `05aa67535d0a2a28f5244f6f0e17e20059634144`
- Work-order registry: `spec/console-work-orders/README.md`
- Plan: `docs/superpowers/plans/2026-09-14-payswap-developer-console.md`
- State: `spec/development-state/console-program-state.md`

## Mission

Implement the frozen console design faithfully. You are an orchestrator and verifier, not the default implementer. Dispatch workers for PC work; inspect their actual changed files, exact commits, test results, and evidence before merging.

## Mandatory sequence

```text
PC-001
  |
  +---- PC-002 || PC-003
              |
             PC-004
               |
             PC-005
               |
             PC-006
               |
             PC-007
               |
        Architect approval
```

Maximum three workers. Never dispatch a sibling against unmerged sibling code. PC-004 begins only after both PC-002 and PC-003 are merged and independently verified.

## Worker contract

Before dispatch, give the worker the assigned work order and exact parent revision. The worker must report:

- starting SHA;
- final SHA;
- changed-file list;
- tests run and results;
- authority/reconciliation mappings added;
- any deviation or stop condition.

Do not accept a claim because a report says it passed. Inspect Git and reproduce the critical verification battery.

## Repository-first rules

At every frontier, inspect the live repository before assigning work. Do not assume a file, API, provider binding, or integration exists because it is named in the plan. If the live repository differs, update the work order only through the governed change path.

## Financial and authority rules

The console is never a source of financial truth. It may read and compose authoritative data but may not create a parallel ledger, payment state machine, settlement/finality authority, or direct UI persistence path.

Every consequential field must map to an owning authority, runtime boundary, durable source, recovery/UNKNOWN semantics, and evidence reference.

## Role and environment rules

Role comes from the authoritative server-side identity/session source. Environment is selected from server configuration. URL parameters, browser state, local storage, or hidden UI switches are not authorities.

Unauthorized deep links fail closed.

## Production-evidence rule

A green local build, CI result, or static contract is repository evidence only. Production or provider availability claims require current evidence from the actual connected provider. At the design baseline only GitHub connectivity was recorded; verify current integration state before PC-006/PC-007.

## Stop and escalate

Return to the Architect before proceeding if:

- a work item requires reopening a closed completion record;
- a new financial or protocol authority is proposed;
- a required read cannot be reconciled to an owner;
- a role boundary cannot be enforced server-side;
- an integration is claimed without live provider evidence;
- protected credential material cannot be safely contained;
- the worker needs an unapproved sibling surface;
- tests require treating a fabricated authority as production truth.

## Final verification

Before Architect approval, verify the exact release SHA, changed-file scope, build/typecheck, console contract tests, role/deep-link matrix, payment/activity journeys, UNKNOWN/recovery semantics, checkout environment separation, developer-tool protections, accessibility/responsive evidence, deployment/provider evidence, and the full reconciliation matrix.

Then update `spec/development-state/console-program-state.md` with exact merged SHAs and evidence references. Do not alter the closed WORK/UI/DEP/SYS state files.
