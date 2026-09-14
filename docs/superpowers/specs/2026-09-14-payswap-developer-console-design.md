# PaySwap Developer Console — Post-Closure Architecture Design

**Status:** DESIGN SPEC — pending Architect review

**Repository baseline:** `4f973c92d7534a13854dfa4468bfa3a72dd14756`

**Change class:** Post-closure Architecture Change Request

**Primary decision:** Unified role-aware developer/platform console (option C)

## 1. Scope and governance

The PaySwap three-layer completion program is closed. This change MUST NOT reopen or mutate `WORK-*`, `UI-*`, `DEP-*`, or `SYS-*` completion records, closure evidence, or their historical merge facts. The console is a new post-closure change set entered through the repository's Architecture Change Request lane.

The console is a product/developer surface implemented inside the existing Next.js application. It is not a new deployment, protocol version, financial authority, or replacement for an existing role-specific surface.

The frozen protocol remains `spec/architecture/v0.1/`. The existing reconciled system architecture remains authoritative for cross-layer boundaries. The product UX contract remains authoritative for navigation, state display, evidence, role gating, accessibility, responsiveness, and financial-authority prohibitions.

The console MUST preserve the completed closure state and make any new claims only from current authoritative runtime/protocol data.

## 2. Goals

The first console release MUST provide a coherent platform surface for developers, merchants, providers, operators, and administrators who need to understand or integrate with PaySwap.

It MUST expose authoritative payment/activity state, protocol evidence, capabilities, developer integration controls, operational visibility, and documentation without duplicating financial truth.

It MUST run inside the current Next.js 16 application rather than creating a separate frontend deployment.

It MUST support environment-aware behavior (sandbox/test versus production) from explicit server-side configuration, never from user-controlled state.

It MUST be designed so later credential, webhook, observability, and deployment integrations can be added without redesigning the console boundary.

## 3. Non-goals

The console does not create a new ledger, payment database, settlement state machine, finality authority, capability authority, or worker execution path.

The console does not redefine protocol semantics or introduce protocol v0.2.

The console does not replace the existing customer, merchant, operator, or provider surfaces.

The console does not claim production deployment merely because the Next.js build passes.

The first release does not require every future API/SDK/documentation feature; work is limited to the minimum complete surface needed to make PaySwap usable and inspectable as a developer platform.

## 4. Architectural model

```text
                           PaySwap application
                                  │
              ┌───────────────────┴──────────────────┐
              │                                      │
       Existing role surfaces                  /console
       customer/merchant/provider/               │
       operator                                  │
                                      Console UI + role-aware nav
                                                   │
                                             Console API/read models
                                                   │
                                    ┌──────────────┴──────────────┐
                                    │                             │
                             Protocol/runtime authorities   Operational authorities
                                    │                             │
                             existing gateway/APIs          existing observability/
                             authoritative state             durable execution
                                    │                             │
                              durable state/evidence          telemetry/recovery
```

The console may compose multiple read sources into a view, but each field MUST retain a traceable source/authority. A view-model is presentation composition, not a new authority.

All consequential commands MUST traverse existing protocol authorization and command boundaries. The console MUST NOT write financial state directly to persistence, queues, or evidence stores.

## 5. Console information architecture

Canonical top-level route:

```text
/console
├── Overview
├── Payments
│   ├── all
│   └── [paymentId]
├── Checkout
│   ├── sessions
│   ├── configuration
│   └── test
├── Accounts
│   ├── customers
│   ├── merchants
│   ├── providers
│   └── operators
├── Capabilities
├── Developers
│   ├── api-keys
│   ├── webhooks
│   ├── logs
│   ├── request-inspector
│   └── environments
├── Operations
│   ├── queues
│   ├── execution
│   ├── reconciliation
│   ├── unknown
│   ├── clearing-netting
│   └── incidents
└── Documentation
    ├── api
    ├── concepts
    ├── examples
    └── guides
```

Routes may be simplified or regrouped during implementation where the current app's routing conventions make a different decomposition safer, but the top-level navigation grammar and information architecture above are frozen for the change set.

## 6. Unified role model

The console is one product surface with role-aware modules, not one unrestricted control plane.

| Role | Default console access | Financial write authority |
|---|---|---|
| Customer | personal payments, checkout/test context, evidence relevant to owned activity | none beyond existing authorized customer flows |
| Merchant | merchant payments, checkout, account/configuration, webhooks, integration logs | only actions already authorized through merchant protocol/application paths |
| Provider | provider capabilities, provider-side activity, operational visibility allowed by authority | only existing provider-authorized actions |
| Operator | operational/diagnostic modules and permitted payment visibility | no new authority; existing protocol authority remains owner |
| Administrator | cross-role administration and visibility where explicitly authorized | no new financial authority |

Identity/role is authoritative input. The console MUST NOT infer roles from URL parameters, client state, behavior, or hidden switches. Unauthorized deep links MUST fail closed.

## 7. Navigation and UX

The console MUST use the application's existing shared navigation grammar instead of creating a second shell paradigm.

Desktop and mobile MUST share the same information architecture. Dense tables MUST degrade to readable cards/details; no horizontal page scrolling for consequential actions.

The primary UX pattern is information-dense but progressive: outcome first, then detail, then evidence/diagnostics.

Payment detail is a flagship surface:

```text
Payment
#ps_...

[result state from authority]

Amount      [authoritative value]
Customer    [authoritative relationship]
Merchant    [authoritative relationship]
Created     [authoritative timestamp]
Rail        [authoritative capability/effect]
Reference   [authoritative reference]

Timeline
  intent created
  command accepted
  execution queued
  external effect requested
  external effect confirmed
  finality established

Evidence
  canonical object
  authority
  execution receipt
  reconciliation state
```

The exact vocabulary MUST come from the authority. `UNKNOWN`, `WAITING`, `IN_PROGRESS`, `FAILED`, `SUCCEEDED`, and `ACTION_REQUIRED` follow the existing product state-display contract.

## 8. Console read-model/API boundary

The console introduces a server-side console boundary for presentation composition. It MUST be thin and authority-preserving.

Responsibilities:

- authorize the current principal/role;
- select the appropriate environment;
- fan out to existing protocol/runtime and operational read authorities;
- normalize responses into stable console DTOs;
- attach source/authority metadata where needed for evidence/debugging;
- preserve UNKNOWN when an authoritative answer is unavailable;
- avoid persistence of new financial truth.

The boundary MUST NOT:

- recompute balances, settlement, finality, risk, capability, or accounting;
- translate an unavailable result into zero/failed/succeeded;
- mutate durable protocol state directly;
- create a parallel payment identifier/state machine.

The first implementation should prefer existing APIs and runtime composition points already present in the repository. New server adapters are acceptable where the current APIs do not expose a required read without crossing authority boundaries.

## 9. Payment/activity model

Overview and payment pages MUST derive metrics from authoritative records or explicitly labeled operational aggregates.

The console MUST distinguish:

- succeeded business outcomes;
- failed business outcomes;
- UNKNOWN outcomes;
- waiting/queued work;
- infrastructure/request failures.

A request or fetch failure is not a business failure. When the authoritative source is unavailable, the console renders UNKNOWN and provides the relevant retry/reconciliation context rather than inventing a verdict.

Activity streams MUST be traceable to the originating object/reference and, where available, protocol evidence.

## 10. Checkout/test surface

Checkout views may exercise existing sandbox/test protocol flows, but the environment signal MUST be server/configuration-derived and persistent in the session/request context.

The console MUST clearly distinguish test/sandbox execution from production execution.

A test checkout MUST use the existing command/runtime path and MUST NOT introduce a console-local payment simulator that masquerades as protocol execution.

## 11. Credentials and developer tooling

API keys, webhooks, request logs, and request inspection are developer controls, but they are separate from protocol financial truth.

API-key requirements:

- secrets are generated/stored/returned through a dedicated credential boundary;
- plaintext secret material is shown only at creation time if the underlying security design permits it;
- keys are environment-scoped;
- revocation is explicit and auditable;
- UI never logs secret material.

Webhook requirements:

- endpoint ownership is role-authorized;
- signing secrets are treated as credentials, never displayed in logs;
- delivery attempts and outcomes reference authoritative event identifiers;
- retries must not imply protocol replay or duplicate financial effects.

Request inspector/logs MUST redact credentials, authorization headers, sensitive payload fields, and secret-bearing configuration. Console logs are diagnostic records, not evidence substitutes.

## 12. Operations model

Operations views may expose queues/workers, reconciliation, UNKNOWN cases, clearing/netting, and incidents using the existing operational telemetry and recovery authorities.

Operations is read-mostly in the first release. Any operator action beyond existing protocol-authorized recovery MUST be explicitly scoped as a separate governed change.

Health summaries MUST preserve the existing observability taxonomy, especially UNKNOWN, recovery, reconciliation, execution, and deployment health.

## 13. Capabilities and accounts

Accounts and capability views are projections over existing identity, account, provider, and capability authorities.

The console MUST NOT infer that a provider/rail is available merely because a route or configuration entry exists. Availability claims must come from authoritative capability/runtime state.

Account detail must distinguish identity/profile data from financial positions and must render each from its owning authority.

## 14. Documentation

Documentation is part of the product shell but is not a second protocol specification.

API reference should be generated from the current implemented boundary/contracts where feasible. Concepts explain existing protocol behavior without reinterpreting it. Examples must identify environment and whether an example is executable, simulated, or illustrative.

Documentation links from the console must resolve to maintained repository/application content; no dead buttons or placeholder destinations are acceptable at release.

## 15. Deployment contract

The console is deployed as part of the existing Next.js application/package.

Deployment readiness is separated into two gates:

```text
Console implementation
  ↓
Repository verification
  ↓
Console deployment contract
  ↓
Actual provider bindings (Vercel/runtime/DB/observability as applicable)
  ↓
Production-like smoke/integration verification
  ↓
Production claim
```

A green local/build/CI result proves repository correctness only. It does not prove production deployment.

At the current baseline, the recorded infrastructure truth says only GitHub is connected through Composio; Vercel, database, queue, Cloudflare, and observability provider connections must therefore be treated as unbound until an operator actually connects them. The implementation must expose an explicit deployment verification requirement rather than claiming those integrations exist.

## 16. Testing and evidence

The change set requires five verification classes:

1. **Static/conformance:** typecheck, build, governance validation, route inventory, no forbidden authority imports from UI code.
2. **Console contract:** role matrix, route/deep-link gating, DTO/schema tests, UNKNOWN semantics, environment isolation, credential redaction.
3. **Integration:** payment list/detail against composed runtime, checkout/test path, operational read models, evidence retrieval, webhook/API-log flows.
4. **UX:** responsive behavior, keyboard navigation, focus order, accessible state announcements, no horizontal overflow, no dead routes.
5. **Deployment:** reproducible package, environment configuration validation, provider-binding checks, smoke test on an exact release revision, and explicit separation of deployment proof from repository proof.

All consequential views require evidence mappings using the existing nine-question reconciliation discipline.

## 17. Authority/reconciliation matrix for the console

Every consequential console view MUST be mapped before release:

| View | Protocol object/state | Owning authority | Runtime boundary | Durable source | UNKNOWN/recovery | Evidence |
|---|---|---|---|---|---|---|
| Payment list | payment/intent state as currently defined | existing protocol authority | existing API/runtime | existing authoritative state/evidence | explicit UNKNOWN | authoritative evidence link |
| Payment detail | intent/command/execution/evidence state | existing protocol/runtime authority | existing API/runtime | authoritative record + evidence | explicit UNKNOWN/reconciliation | evidence timeline |
| Checkout session | existing checkout/merchant protocol state | owning merchant/payment authority | existing product/protocol boundary | existing durable state | waiting/UNKNOWN per authority | checkout evidence |
| Capability | capability/provider state | capability authority | existing protocol/API | authoritative registry/runtime state | unavailable => UNKNOWN | capability evidence where defined |
| Operations health | execution/recovery/telemetry state | deployment/observability authorities | existing operational APIs | telemetry/recovery stores | health UNKNOWN where appropriate | operational transcript/trace |
| Developer request log | request/trace metadata | console/API logging boundary | request boundary | operational logs | unavailable => diagnostic unknown | trace/request ID |

No view is considered complete until each row is verified against the actual repository implementation.

## 18. Proposed work decomposition

The implementation will be governed as a new post-closure change set with seven work items. They are intentionally bounded so a Tech Lead can dispatch up to three workers concurrently without sibling drift:

```text
PC-001  Architecture/contracts/governance foundation
   │
   ├───────────────┐
   ▼               ▼
PC-002           PC-003
Console shell    Console API/read models
+ navigation     + authority mappings
   │               │
   └───────┬───────┘
           ▼
        PC-004
 Payments/activity/
 accounts/capabilities/
 operations views
           │
           ▼
        PC-005
 Developers: credentials,
 webhooks, request logs,
 inspector, docs
           │
           ▼
        PC-006
 Deployment integration /
 provider-binding contract
           │
           ▼
        PC-007
 Production-like verification /
 evidence / Architect approval
```

The detailed implementation plan will define exact owned files, forbidden surfaces, acceptance criteria, dependency edges, and worker dispatch order after this design is approved.

## 19. Parallelism rule

The Tech Lead may dispatch at most three workers concurrently. Siblings may work only from the same immutable base revision and MUST NOT depend on unmerged sibling changes.

The intended safe antichain is `PC-002 || PC-003` after `PC-001`; later items consume only merged revisions. Composition belongs to `PC-004`, not to sibling workers. Deployment and final verification remain serial gates.

Workers prepare changes and evidence. Workers do not merge themselves. The Tech Lead verifies worker claims against Git, tests, and actual repository state, then merges through the governed process.

## 20. Stop conditions

The console work MUST stop and return to the Architect when any of the following occurs:

- an implementation proposes new financial authority or duplicate state;
- a console view cannot be reconciled to an owning authority;
- a required API requires bypassing protocol authorization;
- a role boundary cannot be enforced server-side;
- production wiring is claimed without actual provider connection/evidence;
- a credential path would expose or persist plaintext secrets unsafely;
- a worker's change requires unapproved changes outside its owned surface;
- tests or evidence depend on an invented/mocked authority being treated as production truth;
- implementation requires reopening or mutating closed completion records.

## 21. Acceptance target

The console change is complete only when:

```text
architecture + contracts frozen
+ implementation merged
+ all consequential states mapped
+ role/deep-link isolation proven
+ protocol authority preserved
+ credentials/logging safe
+ integration journeys proven
+ responsive/accessibility evidence proven
+ deployment contract proven
+ actual provider bindings verified where claimed
+ production-like smoke run on exact revision
+ Tech Lead verification complete
+ Architect approval recorded
+ post-change state reconciled
```

This document does not claim any of those implementation/completion gates are complete. It freezes the design boundary for the subsequent governed implementation plan.
