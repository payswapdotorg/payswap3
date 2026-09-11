# PaySwap System Reconciliation Work Items

These are system-level implementation/verification items. They do not replace `WORK-001..WORK-033` and do not create a new protocol architecture.

## Graph

```text
PROTOCOL WORK-001..WORK-033 ✅
             |
             +----------------------------+
             |                            |
             v                            v
       PRODUCT / UX                   DEPLOYMENT
       UI-001..UI-010                DEP-001..DEP-008
             |                            |
             +-------------+--------------+
                           |
                           v
                    SYS-001 Reconcile
                           |
                           v
                    SYS-002 Full-system
                           |
                           v
                    SYS-003 Closure
```

## Protocol runtime materialization (RTN wave)

The RTN wave materializes the frozen v0.1 protocol authorities (A01–A16) as executable runtime code — the "protocol authorities" dependency of DEP-004. Governed by spec/protocol-runtime-work-orders/ (work orders RTN-001..RTN-012), activated per the Architect's rulings (spec/development-state/rtn-plan-rulings.md, merged fb8df22; verdict APPROVE-WITH-MODIFICATIONS, seven deltas applied). A17–A24 are deferred to the named follow-on RTN wave 2 (rulings delta 2). The product port-re-anchoring item (spec/product/work-items.md UI-011) rides this wave (rulings delta 6) and does not gate DEP-004.

RTN antichain schedule (max width 3): 1 RTN-001 · 2 RTN-002 ∥ RTN-003 ∥ RTN-004 · 3 RTN-005 · 4 RTN-006 · 5 RTN-007 · 6 RTN-008 · 7 RTN-009 · 8 RTN-010 ∥ RTN-011 · 9 RTN-012.

**DEP-004 dispatch gate:** RTN-001..RTN-011 merged (hard); RTN-012 merged (recommended assurance floor — the dispatchability memo rides RTN-012 and cites the rulings' Q2 interpretation of "protocol authorities" as the operational A01–A16 spine).

## Deployment items

### DEP-001 — Deployment topology and environment contract
Define and implement the runtime topology, environments, boundaries, and production/sandbox isolation.

Depends on: protocol complete + product foundation.

### DEP-002 — Runtime packaging and configuration
Production-grade application/runtime packaging, configuration validation, environment contract, secret injection and safe startup/readiness.

Depends on: DEP-001.

### DEP-003 — Durable persistence and work execution
Database, durable queue, worker execution, scheduler semantics, idempotency across replicas, migrations and storage boundaries.

Depends on: DEP-001, DEP-002.

### DEP-004 — Reconciliation/clearing/netting operations
Durable background execution for queued work, reconciliation, clearing, netting and settlement-supporting operations.

Depends on: DEP-003 + protocol authorities (materialized by the RTN wave; dispatch gate: RTN-001..RTN-011 hard + RTN-012 recommended — spec/protocol-runtime-work-orders/README.md, rtn-plan-rulings.md Q2).

### DEP-005 — External rail connectivity boundary
Production-safe adapter connectivity, credentials, timeouts, isolation, observability, UNKNOWN handling and safe retry/reconciliation.

Depends on: DEP-003, DEP-004.

### DEP-006 — CI/CD and promotion
Automated verification, build/package, migration gates, environment promotion, rollback and release evidence.

Depends on: DEP-002, DEP-003, DEP-005.

### DEP-007 — Observability, resilience and disaster recovery
Metrics, logs, traces, alerting, health, backup/restore, replay/recovery and failure drills.

Depends on: DEP-003, DEP-004, DEP-005.

### DEP-008 — Production readiness proof
Run production-like conformance, failure injection, recovery, scaling, security/configuration and external-effect safety verification.

Depends on: DEP-006, DEP-007 + product closure candidate.

## System reconciliation

### SYS-001 — Three-architecture reconciliation

Prove that:

- UX flows map to real protocol objects/state;
- product actions reach the correct protocol authority;
- deployment paths host the intended authorities;
- no duplicate financial authority exists;
- environment boundaries are explicit;
- state/uncertainty/waiting/recovery semantics survive end-to-end.

Depends on: relevant UI and deployment items.

### SYS-002 — Full-system dogfood

Exercise the complete supported journeys, including:

- customer pay;
- track;
- waiting;
- UNKNOWN;
- recovery;
- merchant checkout;
- settlement;
- evidence;
- dispute/recourse where supported;
- provider/capability;
- liquidity;
- credit;
- agent proposal/mediation;
- external rail sandbox;
- blockchain path where implemented.

### SYS-003 — System closure

Only after:

- UI-010 final;
- DEP-008 final;
- SYS-001 pass;
- SYS-002 pass;
- exact release revision verified;
- all machine state synchronized;
- Architect signs closure.
