# PaySwap3

The PaySwap protocol is frozen at `spec/architecture/v0.1/`. Protocol Work Orders `WORK-001` through `WORK-033` are complete; product/UI work is a separate bounded program.

## System completion

PaySwap is implemented as three coordinated layers:

1. **Protocol/backend:** frozen `spec/architecture/v0.1/`, authoritative for financial semantics, authority, accounting, execution, clearing, netting, settlement and finality.
2. **Product/UI/UX:** `spec/product/`, an interaction layer that must never become a second financial authority.
3. **Deployment/operations:** `spec/system-architecture.md`, the runtime/operational layer that hosts and protects the first two without changing their semantic ownership.

Cross-layer reconciliation is governed by `spec/system-reconciliation.md` and `spec/system-work-items.md`.

Fresh successor Tech Lead bootstrap: `agents/successor-tech-lead-bootstrap.md`.

Any protocol semantic change requires the Architecture Change Request process; product-layer version labels do not create a protocol v0.2.

## Validation

Run:

```bash
python3 scripts/validate_governance.py
```
