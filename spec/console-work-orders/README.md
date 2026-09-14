# Developer Console Work Orders

Implementation work orders for the approved post-closure developer console.

## Dependency graph

PC-001 -> (PC-002 || PC-003) -> PC-004 -> PC-005 -> PC-006 -> PC-007 -> Architect approval.

Only PC-002 and PC-003 may run concurrently, and only after PC-001 is merged. Maximum workers: three.

## Governance

The closed WORK/UI/DEP/SYS program remains immutable. Console progress is tracked separately in spec/development-state/console-program-state.json.

Workers start from an immutable parent revision, stay within their owned file list, add tests and evidence, report exact HEAD, and never merge their own work.
