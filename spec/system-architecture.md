# PaySwap System Architecture — Reconciled View

**Status:** NORMATIVE SYSTEM RECONCILIATION CONTRACT  
**Protocol architecture:** `spec/architecture/v0.1/` (frozen)  
**Product/UX architecture:** `spec/product/ux-architecture-v0.2.md` (product-layer contract only)  
**Deployment architecture:** this document's operational layer; it does not redefine protocol semantics.

## Purpose

PaySwap has three architectural layers that must be implemented as one coherent system:

1. **Protocol / backend** — the financial coordination protocol and its authoritative domain state machines.
2. **Product / UX** — the user-facing interaction layer over protocol state.
3. **Deployment / operations** — the runtime topology that safely executes the protocol and product.

These layers are complementary, not competing architectures.

The protocol remains the sole authority for financial semantics, accounting, execution authorization, settlement and finality.

The product may present and orchestrate protocol state but must never become a second financial authority.

The deployment layer hosts and operationalizes those authorities without duplicating their semantic ownership.

## Architectural relationship

```text
                        PAYSWAP SYSTEM
                              |
          +-------------------+-------------------+
          |                   |                   |
          v                   v                   v
   PROTOCOL / BACKEND       PRODUCT / UX      DEPLOYMENT / OPS
   frozen v0.1              product layer     operational layer
          |                   |                   |
          +-------------------+-------------------+
                              |
                              v
                    Reconciled system behavior
```

## Hard boundaries

### Protocol owns

Identity, authority, values, accounting, intent, demand, capability, market, liquidity, credit, reservations, routing/compiler, execution, clearing, obligations, netting, risk/compliance, evidence, simulation, extensions, agents, recourse, federation, settlement and finality.

### Product owns

Navigation, workflows, presentation, progressive disclosure, accessibility, user tasks, role-aware interaction, evidence presentation and interaction orchestration.

### Deployment owns

Process topology, persistence infrastructure, queues, schedulers, workers, secrets, runtime configuration, CI/CD, observability, scaling, backups, recovery and environment isolation.

### No layer may

Create a competing financial authority, bypass protocol authorization, mutate another layer's authoritative state directly, or infer production readiness from sandbox behavior.

## Execution topology

```text
                         Users / Integrators
                                |
                         Web / API boundary
                                |
                 +--------------+--------------+
                 |                             |
                 v                             v
           Product/API                  Protocol gateway
                 |                             |
                 +--------------+--------------+
                                |
                         Durable command path
                                |
                    +-----------+-----------+
                    |                       |
                    v                       v
              Transition/runtime       Background workers
                    |                       |
                    |              +--------+--------+
                    |              |        |        |
                    |              v        v        v
                    |          scheduler  reconcilers  netting/
                    |                                 settlement
                    v
             Authoritative state
                    |
       +------------+-------------+
       |            |             |
       v            v             v
    database      queue       object/evidence storage
       |
       +-------------------------------+
                                       |
                                       v
                              External rail adapters
                                       |
              +----------------+-------+--------+----------------+
              |                |                |                |
            banks             PSPs          mobile money     blockchains
              |                |                |                |
              +----------------+----------------+----------------+
                                       |
                                       v
                               external evidence
```

## Deployment environments

At minimum the repository must explicitly distinguish:

- development
- test/CI
- sandbox
- staging
- production

Production financial effects must be unreachable from sandbox/demo execution paths unless a separately authorized production configuration is active.

## Durable runtime obligations

The deployment architecture must preserve:

- command idempotency across replicas;
- durable event/evidence storage;
- durable queued work;
- retry safety and UNKNOWN reconciliation;
- scheduled clearing/netting work;
- settlement/reconciliation workers;
- safe database migration;
- secret/key isolation;
- controlled external-effect connectivity;
- immutable audit evidence;
- replay/recovery capability.

## Scaling

The API/product tier may scale horizontally.

Workers must be safe to run concurrently under the existing reservation, idempotency and ownership rules.

Schedulers must not create duplicate financial work.

Clearing/netting/reconciliation jobs must be idempotent or protected by protocol-level concurrency controls.

External effect calls must remain behind the existing adapter boundary.

## Deployment safety

Deployment changes must never silently alter protocol semantics.

Database migrations must be backward-compatible with the currently deployed protocol version unless an explicit governed migration strategy exists.

A deployment rollback must not replay unsafe external effects.

Production promotion requires successful protocol, product, integration and operational verification.

## Observability

Operational telemetry must distinguish:

- command accepted/rejected;
- queued/waiting work;
- execution attempt;
- UNKNOWN outcome;
- reconciliation;
- clearing;
- netting;
- settlement;
- finality;
- incident/recovery;
- product request;
- deployment/runtime health.

Operational telemetry is not a replacement for protocol evidence.

## Disaster recovery

The final operational design must specify:

- persistent state backup;
- recovery point objective;
- recovery time objective;
- restore procedure;
- journal/event replay;
- queue recovery;
- idempotent worker restart;
- external UNKNOWN reconciliation after restart;
- key/secret restoration procedure;
- evidence integrity verification.

## Production gate

PaySwap is not deployment-complete until the Tech Lead can prove, on the exact release revision:

```text
protocol correctness
+
product workflow correctness
+
runtime correctness
+
security/configuration correctness
+
recovery correctness
+
cross-layer reconciliation
+
end-to-end dogfooding
```

## Freeze rule

This is a system reconciliation/operational contract. It does not create a new protocol version.

`spec/architecture/v0.1/` remains frozen and authoritative for backend semantics.
