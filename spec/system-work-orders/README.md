# System work orders

These work orders govern the deployment/operations and final three-layer reconciliation program described by `spec/system-work-items.md`.

They do not replace protocol Work Orders `WORK-001..WORK-033`, do not reopen completed protocol work, and do not create protocol v0.2.

Each item is activated only when its dependencies are merged and its protected surfaces are conflict-free. Workers never merge their own work.
