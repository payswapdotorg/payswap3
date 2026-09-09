# System architecture governance

PaySwap has three coordinated implementation layers:

- frozen protocol/backend: `spec/architecture/v0.1/`
- product/UI/UX: `spec/product/`
- deployment/operations: `spec/system-architecture.md`

The layers are reconciled through `spec/system-reconciliation.md` and `spec/system-work-items.md`.

The product and deployment layers never supersede the frozen protocol or become a second financial authority.
