# PaySwap runtime topology contract

**Work order:** DEP-001 — Deployment topology and environment contract
**Status:** PLANNED — contract defined by DEP-001; deployment-owned capacity lands with later governed work
**Base:** main @ f934a76f20efbd6e238605d8e7320495974a870e
**Owned surfaces:** deployment manifests, environment contracts, runtime topology documentation/configuration
**Forbidden:** protocol semantic changes; product financial authority; external-effect bypass
**Companions:** `spec/deployment/environments.md` (environment contract), `spec/deployment/configuration.md` (configuration and secret boundary contract), `deploy/contracts/components.json` (machine-readable component registry), `scripts/validate_deployment.py` (static/configuration verification gate)

> **Governed contract change — RTN-012** (spec/deployment/topology.md "Contract
> evolution"): the RTN wave (RTN-001..RTN-011, merged at base
> 14b6ca56c07de585df6d1a3a97edcc36ad2e4c02) materialized the nine
> protocol/deployment components as **in-process module surfaces** inside the
> web-api-boundary application — the DEP-003 precedent under the Q3 ruling
> (spec/development-state/rtn-plan-rulings.md). This document's as-of-today
> overlay, the registry summary, and the per-component contracts below were
> updated together with `deploy/contracts/components.json` and
> `scripts/validate_deployment.py` in that one work item. The future work that
> remains is recorded per component (externalized process binding — DEP-002+;
> real-rail credential binding — DEP-005); the in-process forms claim no
> externalized deployment and reach no production financial effect
> (fail-closed; simulated rails only).
>
> **Governed contract change — DEP-004** (same clause): the durable
> operational-jobs layer over the composed protocol runtime was
> materialized as one further in-process module surface — the
> `operational-jobs` component (`src/lib/operations/`: the reconciliation
> sweep, clearing batch progression, netting-settlement progression and
> queue-drain support job kinds, registered through the DEP-003
> substrate's `register()` integration point and emitting protocol
> commands exclusively through the protocol gateway with deterministic
> idempotency keys). The registry summary and the per-component contracts
> below were updated together with `deploy/contracts/components.json` and
> `scripts/validate_deployment.py` in that one work item; the declared
> base moved to the DEP-004 dispatch base (main @
> 2c3f9cf0efb7bae808662d4dd1adaf604d69de0e — the composed runtime the
> jobs orchestrate over; the operational-jobs entrypoints arrive with the
> DEP-004 work item's tree). The component hosts no authority
> (orchestration only); its future work is recorded like every other
> component's (externalized process binding — DEP-002+; real-rail
> credential binding — DEP-005).

## Purpose and method

This document defines the actual PaySwap runtime topology FROM THE REPOSITORY'S REAL ENTRYPOINTS — not from aspiration. For every component it records: repository entrypoint (an actual repository path that exists today, or the FUTURE-WORK marker of the governed work that will bring it), owner layer, the authority it hosts, its health signal, and its rollback mechanism.

DEP-001 defines contracts only. It performs no cloud deployments, no runtime packaging and invents no credentials — none are needed for a contract. Actual target binding (Vercel, Cloudflare, database/queue providers, observability) is held by the Tech Lead and is used from DEP-002 onward.

Honesty rule: a component that does not exist as repository code at the declared base is marked **FUTURE-WORK** with its dependency-graph provenance. It is never silently presented as existing, and no entrypoint is invented for it. The machine-readable registry (`deploy/contracts/components.json`) and the validator (`scripts/validate_deployment.py`) enforce this: claimed-today entrypoints must exist on disk, and the present-set is locked to the governed set — `web-api-boundary` alone from DEP-001 until the RTN-012 governed change updated the contract to the ten-component in-process set (each claimed entrypoint exists on disk at the declared base; each component records its remaining future work). A further present-set change is again a governed change that updates all three surfaces together.

## Repository source of truth (DEP-004 governed base 2c3f9cf0efb7bae808662d4dd1adaf604d69de0e)

The repository's real entrypoints today (the honesty rule: claimed-today
entrypoints must exist on disk at the declared base):

- **Application:** a Next.js (App Router) + TypeScript + Tailwind web application at the repository root.
  - `package.json`: name `payswap3`; scripts: `dev` = `next dev`, `build` = `next build`, `start` = `next start`, `typecheck` = `tsc --noEmit`.
  - Runtime dependencies: `next` 16.1.3, `react` 19.2.3, `react-dom` 19.2.3.
- **Route surface:** `/` (shell home), `/state-primitives` (verification surface), `/_not-found`.
- **Environment contract already in the app:** `src/lib/environment.ts` reads the server-side `PAYSWAP_ENV` variable with an exact allowlist (`sandbox | production`) and fail-safe to `sandbox`. This topology aligns with and extends that contract; it never contradicts it (see "Environment signal wiring" below).
- **The composed protocol runtime (the RTN wave, in-process):** `src/lib/protocol-runtime/` — the kernel, evidence, risk, intent, policy, capability, routing, reservations, liquidity, credit, queues, clearing, obligations, netting, settlement, rails, gateway, transition, and hosting module families (the registry A01–A16 operational spine; `src/lib/protocol-runtime/index.ts` is the wave barrel documenting the module map and the composition order) — plus the DEP-003 durable execution substrate (`src/lib/durable/`: db, queue, worker, scheduler, events) the runtime hosts on.
- **The durable operational-jobs layer (DEP-004, in-process):** `src/lib/operations/` — the operational-jobs family (`index.ts` is the family barrel documenting the module map and the composition order over the composed runtime): the reconciliation sweep, clearing batch progression, netting-settlement progression and queue-drain support job kinds, the orchestration wiring (registration + scheduler + on-demand triggers), the job-progress audit reader, and the operational evidence document (`OPERATIONS-EVIDENCE.md`). The jobs run as durable `operations.*` kinds on the DEP-003 substrate, derive work only from the authorities' public read surfaces, and emit protocol commands exclusively through the protocol gateway (the one admission point) — `scripts/test_operations.mjs` is the plain-Node evidence harness.

The in-process form is the FIRST REALIZATION of the component contract, not
an externalized deployment (rtn-plan-rulings.md Q3): the logical execution
topology is realized exactly as enforced module boundaries — one admission
point (`protocol-runtime/gateway/`), one authoritative-state writer
(`protocol-runtime/transition/` + `hosting/` on the substrate), adapters
behind protocol control (`protocol-runtime/rails/adapters.ts`,
transmission-and-reporting only) — while the externalized process binding
remains recorded future work per component. No production financial effect
is reachable from the in-process form: simulated rails, no credentials,
fail-closed.

## Execution topology (target shape — normative)

Quoted verbatim from the system architecture. The deployment topology must realize exactly this shape; nothing in this contract may redraw it:

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

## As-of-today overlay

Of the nodes above, the **Web/API boundary application** exists as repository
code today and hosts the Product/API branch (the shell home `/` and the
verification surface `/state-primitives`). It is the only internet-facing
surface today, and it hosts **no financial authority**.

Every node behind the boundary now ALSO exists as repository code in its
**in-process form** (the RTN wave, merged at the RTN-012 governed base):

| Execution-topology node | In-process repository surface |
| --- | --- |
| Protocol gateway | `src/lib/protocol-runtime/gateway/` (the sole admission point: command validation per owning authority, idempotent receipts, durable submission) |
| Durable command path | `src/lib/durable/queue.ts` (+ `worker.ts` as the dequeue engine of the transition path) |
| Transition/runtime | `src/lib/protocol-runtime/transition/` + `hosting/` (the single authoritative-state writer on the substrate) |
| scheduler | `src/lib/durable/scheduler.ts` + `src/lib/protocol-runtime/hosting/scheduler-wiring.ts` (timing-driven command emitters) |
| operational jobs (the orchestration layer) | `src/lib/operations/` (the DEP-004 durable operational-jobs family: reconciliation sweeps, clearing batch progression, netting-settlement progression, queue-drain support — commands only, through the gateway) |
| reconcilers | `src/lib/protocol-runtime/rails/reconciliation.ts` (the A14 authority; recurring cycle commands through the transition path) |
| netting/settlement | `src/lib/protocol-runtime/netting/` + `settlement/` (the A11/A12 authorities; recurring tick commands) |
| Authoritative state / database | the per-domain persistence modules over `src/lib/durable/db.ts` (the kernel persistence convention) |
| object/evidence storage | `src/lib/protocol-runtime/evidence/` (the A15 log + chain + per-domain store) |
| External rail adapters | `src/lib/protocol-runtime/rails/adapters.ts` (the PROTOCOL-OWNED SIMULATED RAILS — same interface, no external transmission, no credentials) |

The web/API boundary still accumulates none of their responsibilities
locally: no authoritative state, no queue semantics, no rail access, and no
protocol-authority enforcement in the application tier — the in-process
modules under `src/lib/protocol-runtime/` are protocol-owned surfaces
composed by the server runtime and the evidence harnesses, not product-tier
absorption. The externalized process binding (separately deployed processes,
real queue/persistence/adapter infrastructure, production rail credentials)
remains recorded future work per component (DEP-002+; DEP-005 for real
rails).

## Architecture-to-component mapping

| Execution-topology node | Component id (components.json) | Repository status at the RTN-012 governed base |
| --- | --- | --- |
| Users / Integrators | not a deployed component (clients; see environments.md "who/what may reach it") | n/a |
| Web / API boundary | `web-api-boundary` | present today |
| Product/API | `web-api-boundary` (product-owned surface within the boundary application) | present today |
| Protocol gateway | `protocol-gateway` | present today (in-process: `protocol-runtime/gateway/`; externalized binding FUTURE-WORK) |
| Durable command path | `durable-command-queue` | present today (in-process: `durable/queue.ts`; externalized binding FUTURE-WORK) |
| Transition/runtime | `transition-runtime` | present today (in-process: `protocol-runtime/transition/` + `hosting/`; externalized binding FUTURE-WORK) |
| Background workers | worker family: `reconciler-workers`, `netting-settlement-workers` (further subtypes arrive as governed work adds them) + the `operational-jobs` orchestration layer (DEP-004) | present today (in-process: the A14 / A11/A12 authorities hosted on the transition path, orchestrated by the operational-jobs family; externalized binding FUTURE-WORK) |
| scheduler | `scheduler` | present today (in-process: `durable/scheduler.ts` + `hosting/scheduler-wiring.ts`; externalized binding FUTURE-WORK) |
| reconcilers | `reconciler-workers` | present today (in-process: `protocol-runtime/rails/reconciliation.ts`) |
| netting/settlement | `netting-settlement-workers` | present today (in-process: `protocol-runtime/netting/` + `settlement/`) |
| operational jobs | `operational-jobs` | present today (in-process: `src/lib/operations/` — the durable operational-jobs family over the composed runtime; externalized binding FUTURE-WORK) |
| Authoritative state / database | `authoritative-state-store` | present today (in-process: the per-domain persistence modules on `durable/db.ts`; externalized binding FUTURE-WORK) |
| queue | `durable-command-queue` | present today (in-process: `durable/queue.ts`) |
| object/evidence storage | `evidence-object-store` | present today (in-process: `protocol-runtime/evidence/`; externalized binding FUTURE-WORK) |
| External rail adapters | `external-rail-adapters` | present today (in-process: `protocol-runtime/rails/adapters.ts` — the PROTOCOL-OWNED SIMULATED RAILS — plus the DEP-005 connectivity boundary `src/lib/rail-connectivity/`; real transport primitive + real-rail credential binding FUTURE-WORK) |
| banks / PSPs / mobile money / blockchains | external parties — reachable only through `external-rail-adapters` | external |
| external evidence | ingested only through `external-rail-adapters` into `evidence-object-store` | external |

## Component registry summary

Machine-readable source of record: `deploy/contracts/components.json` (updated by the RTN-012 governed change to the ten in-process components, then by the DEP-004 governed change adding the `operational-jobs` family; every component carries its future_work note). Human summary (full per-component contracts follow):

| id | status | repository entrypoint (in-process form) | owner (runtime) | layer (authority hosted) | health signal (contract) | rollback (contract) |
| --- | --- | --- | --- | --- | --- | --- |
| `web-api-boundary` | present | `package.json`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/lib/environment.ts` | deployment | product | HTTP readiness on `/` | stateless redeploy |
| `protocol-gateway` | present (in-process) | `src/lib/protocol-runtime/gateway/` | deployment | protocol | readiness + command acceptance | redeploy + queue replay |
| `transition-runtime` | present (in-process) | `src/lib/protocol-runtime/transition/` + `hosting/` | deployment | protocol | transition backlog + consistency probes | redeploy + PITR + replay |
| `scheduler` | present (in-process) | `src/lib/durable/scheduler.ts` + `hosting/scheduler-wiring.ts` | deployment | deployment | heartbeat + missed-schedule alarms | redeploy (config only) |
| `reconciler-workers` | present (in-process) | `src/lib/protocol-runtime/rails/reconciliation.ts` | deployment | protocol | drift metrics + reconciliation lag | redeploy + idempotent replay |
| `netting-settlement-workers` | present (in-process) | `src/lib/protocol-runtime/netting/` + `settlement/` | deployment | protocol | batch progress + ledger integrity | redeploy + replay; never un-finalize |
| `operational-jobs` | present (in-process) | `src/lib/operations/` (the job family + orchestration + the progress reader) | deployment | deployment | job-progress audit reader; job/reconciliation lag | redeploy + idempotent job replay |
| `durable-command-queue` | present (in-process) | `src/lib/durable/queue.ts` | deployment | deployment | depth/age + dead-letter rate | retention + replay |
| `authoritative-state-store` | present (in-process) | the per-domain persistence modules on `src/lib/durable/db.ts` | deployment | protocol | replication + consistency probes | PITR + replay; single writer only |
| `evidence-object-store` | present (in-process) | `src/lib/protocol-runtime/evidence/` | deployment | protocol | write/read success + retention integrity | backup restore; append-only kept |
| `external-rail-adapters` | present (in-process — the PROTOCOL-OWNED SIMULATED RAILS + the DEP-005 connectivity boundary) | `src/lib/protocol-runtime/rails/adapters.ts` + `src/lib/rail-connectivity/` | deployment | deployment | the adapter-activity query surface (circuit state + rail reachability derive from it) | fail-closed hold + replay |

The externalized process binding for every behind-the-boundary component
(separately deployed processes; real queue/persistence/adapter
infrastructure) and the real transport primitive + real-rail credential
binding for `external-rail-adapters` remain recorded future work per
component in `deploy/contracts/components.json` (`future_work`) — the
in-process present-set is an honest claim of repository presence, never of
externalized deployment. DEP-005 landed the connectivity boundary's
in-process form (the transport port, configuration resolution,
retry/deadline safeguards and adapter-activity observability, composed
into the frozen A13 adapter interface); the network transport client, the
real adapters and the production credential dereference are part of the
externalized binding.

## Per-component contracts

### web-api-boundary — the Next.js application (EXISTS TODAY)

- **Repository entrypoint (present):** `package.json`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/lib/environment.ts`. Route surface: `/` (shell home), `/state-primitives` (verification surface), `/_not-found`. Manifest facts: name `payswap3`; scripts `dev` = `next dev`, `build` = `next build`, `start` = `next start`, `typecheck` = `tsc --noEmit`; `next` 16.1.3, `react` 19.2.3, `react-dom` 19.2.3.
- **Owner (runtime):** deployment — the process, its hosting, scaling, runtime configuration and environment isolation are deployment-owned.
- **Layer (authority hosted):** product — hosts product-owned navigation, presentation and progressive disclosure.
- **Authority hosted:** none. The boundary hosts no financial authority: it never originates, approves or mutates financial state; it never reaches external rails; once the protocol gateway lands it forwards protocol operations there (through the durable command path); it never writes authoritative state directly.
- **Health signal (implemented today):** process boot plus HTTP readiness — `GET /` returns 200 and the shell renders; the environment signal resolves to an allowlisted value (`sandbox` by fail-safe; `production` only under the production configuration).
- **Rollback:** stateless redeploy of the previous commit/build artifact. The shell holds no authoritative state, so rollback involves no data recovery.
- **Boundary rules:** see "Component boundaries" §Web/API below.

### protocol-gateway — present today (in-process)

- **Repository entrypoint (present, in-process form):** `src/lib/protocol-runtime/gateway/` — `index.ts` (the module barrel + boundary contract), `admission.ts` (the sole admission call `ProtocolGateway.submitCommand`), `registry.ts` (the per-authority command catalogue), `receipts.ts`, `persistence.ts`, `COMMAND-SURFACE.md` (the UI-011 re-anchoring input). Claimed paths exist on disk at the declared base.
- **Future work that remains:** FUTURE-WORK: externalized process binding — the gateway as a separately deployed process with an HTTP readiness endpoint and observability binding (DEP-002+); the in-process module surface (RTN-010, inside the web-api-boundary application) is the composed realization, not an externalized deployment.
- **Owner (runtime):** deployment (process, hosting, configuration, scaling, secrets).
- **Layer (authority hosted):** protocol.
- **Authority hosted:** the sole admission point for protocol commands — per-command validation against the owning authorities' registered schemas (the registry A01–A14 and A16 command authorities), idempotent admission receipts, typed rejection evidence, and durable submission. Hosts no authority of its own and implements no identity or market authority (rtn-plan-rulings.md Q4 — subject validation is per-command per owning authority; the earlier hard-boundaries paraphrase is not an authority claim).
- **Health signal (implemented as the programmatic contract; HTTP binding is deployment work):** `gateway.isReady()` and `gateway.health()` — readiness, command acceptance rate, admission latency, durable-queue submit success.
- **Rollback (contract):** redeploy the previous artifact; in-flight commands replay from the durable command queue; rollback never mutates authoritative state directly.

### transition-runtime — present today (in-process)

- **Repository entrypoint (present, in-process form):** `src/lib/protocol-runtime/transition/execution.ts` (the dequeue → resolve-owning-authority → apply-transition → A15-evidence → atomic-commit path) + `substrate-port.ts`, hosted through `src/lib/protocol-runtime/hosting/bindings.ts` (the per-authority command bindings) and `hosting/durable-binding.ts` (the real substrate binding) on `src/lib/durable/worker.ts`. Claimed paths exist on disk at the declared base.
- **Future work that remains:** FUTURE-WORK: externalized process binding — the transition runtime as a separately deployed worker process fleet with observability binding (DEP-002+); the in-process module surface (RTN-011, hosted on the DEP-003 substrate inside the web-api-boundary application) is the composed realization.
- **Owner (runtime):** deployment. **Layer:** protocol.
- **Authority hosted:** the single authoritative-state writer — the merged authorities' command surfaces (registry A01–A14 and A16) executed as hosted bindings through the command execution path; no other layer mutates authoritative state (the hard boundary).
- **Health signal (implemented as the programmatic contract):** the transition backlog probe (`hosting/probes.ts` — backlog depth/age over the real queue) and the authoritative-state consistency probes (reservation-ledger identity, liquidity-pool identity, netting conservation).
- **Rollback (contract):** redeploy the previous artifact plus point-in-time recovery of authoritative state and replay of durable commands. As the only authoritative-state writer, no other rollback path exists.

### scheduler — present today (in-process)

- **Repository entrypoint (present, in-process form):** `src/lib/durable/scheduler.ts` (the DEP-003 timing-driven command emitter) + `src/lib/protocol-runtime/hosting/scheduler-wiring.ts` (the protocol-side recurring command emitters: clearing/netting/reconciliation/queue ticks — commands only, never state). Claimed paths exist on disk at the declared base.
- **Future work that remains:** FUTURE-WORK: externalized process binding — the scheduler as a separately deployed timing process with heartbeat/missed-schedule alarms bound to observability (DEP-002+); the in-process module surface (the DEP-003 scheduler + RTN-011's recurring command emitters) is the composed realization.
- **Owner (runtime):** deployment. **Layer:** deployment.
- **Authority hosted:** none — emits timing-driven commands into the durable command queue; owns timing only, never mutates authoritative state and never reaches external rails.
- **Health signal (contract):** scheduler heartbeat; missed-schedule alarms (observability binding from DEP-002+).
- **Rollback (contract):** redeploy the previous artifact; schedules are configuration, so no data recovery is involved.

### reconciler-workers — present today (in-process)

- **Repository entrypoint (present, in-process form):** `src/lib/protocol-runtime/rails/reconciliation.ts` (the A14 Reconciliation Authority: cases, cycles, sources, adjustments) + `rails/matching.ts` (the deterministic INV-14-4 matching) + `rails/persistence.ts` (the per-domain store). The recurring reconciliation-cycle tick commands run through the transition path (`hosting/scheduler-wiring.ts` + the hosted bindings). Claimed paths exist on disk at the declared base.
- **Future work that remains:** FUTURE-WORK: externalized process binding — reconciler workers as separately deployed background processes with reconciliation-lag and drift observability (DEP-002+); the in-process module surface (RTN-004's A14 authority, hosted on the transition path) is the composed realization.
- **Owner (runtime):** deployment. **Layer:** protocol.
- **Authority hosted:** Reconciliation Authority semantics (registry A14) — cases, cycles, sources, and adjustments: the only exit from UNKNOWN (GC-2), with exactly-once resolution and history-never-mutated adjustments. Corrective actions flow as protocol commands through the gateway, never direct state mutation and never direct rail access.
- **Health signal (contract):** reconciliation lag; drift metrics (observability binding from DEP-002+).
- **Rollback (contract):** redeploy the previous artifact; idempotent replay from the durable command path.

### netting-settlement-workers — present today (in-process)

- **Repository entrypoint (present, in-process form):** `src/lib/protocol-runtime/netting/authority.ts` (the A11 Netting Authority) + `settlement/authority.ts` (the A12 Settlement and Finality Authority) + their per-domain persistence modules. The recurring netting-cycle tick commands run through the transition path. Claimed paths exist on disk at the declared base.
- **Future work that remains:** FUTURE-WORK: externalized process binding — netting/settlement workers as separately deployed background processes with batch-progress and ledger-integrity observability (DEP-002+); real-rail settlement transmission additionally requires production rail credentials under DEP-005 (the in-process form settles over the protocol-owned simulated rails only).
- **Owner (runtime):** deployment. **Layer:** protocol.
- **Authority hosted:** Netting Authority and Settlement and Finality Authority semantics (registry A11/A12) — conservation-proofed netting sets and net positions, settlement instructions/attempts over the rail adapter authority, and finality records. Corrections after finality flow only through protocol-governed recourse — deployment rollback never un-finalizes.
- **Health signal (implemented as the programmatic contract):** the netting-conservation ledger-identity probe (`hosting/probes.ts`).
- **Rollback (contract):** redeploy the previous artifact and replay durable commands; finality is never reversed by deployment action.

### operational-jobs — present today (in-process)

- **Repository entrypoint (present, in-process form):** `src/lib/operations/` — `index.ts` (the family barrel + boundary contract), `jobs.ts` (the shared job runtime: the gateway-only submission discipline, the deterministic (job, cycle, subject) idempotency keys, the audit journal), `reconciliation-sweep.ts` (A14 orchestration), `clearing-progression.ts` (A09 window-batch progression), `netting-settlement-progression.ts` (A11 set progression + A12 settlement support — progression only, finality never), `queue-drain-support.ts` (A08 eligibility/expiry sweeps), `orchestration.ts` (registration through the substrate's `register()` integration point + the scheduler wiring following the scheduler-wiring precedent + the on-demand triggers), `progress-reader.ts` (the reads-only job-progress audit reader), `OPERATIONS-EVIDENCE.md` (the operational evidence document). Claimed paths exist on disk in the DEP-004 work item's tree.
- **Future work that remains:** FUTURE-WORK: externalized process binding — the operational jobs as separately deployed background worker processes with job-lag, reconciliation-lag and batch-progression observability (DEP-002+); real-rail settlement support additionally requires production rail credentials under DEP-005 (the in-process form settles over the protocol-owned simulated rails only). The recorded D-2 vocabulary gap (src/lib/protocol-runtime/INTEGRATION-EVIDENCE.md) leaves a subset of the jobs' gateway submissions queued pending the recorded vocabulary-alignment follow-up — a composed-runtime property documented in `src/lib/operations/OPERATIONS-EVIDENCE.md`, not a deployment-contract change.
- **Owner (runtime):** deployment. **Layer:** deployment (hosts no protocol authority — orchestration and job logic only).
- **Authority hosted:** none — the background operational jobs and orchestration for reconciliation sweeps, clearing batch progression, netting-settlement progression and queue-draining support. The jobs are durable `operations.*` kinds on the DEP-003 substrate: they derive work ONLY from the authorities' public read surfaces and emit protocol commands EXCLUSIVELY through `protocol-gateway` (the one admission point) with deterministic idempotency keys per (job, cycle, subject) — zero authority semantics, zero direct state mutation, never a blind retry of an UNKNOWN outcome (reconciliation is the A14 path's job), and settlement support NEVER asserts finality (finality is the Settlement Authority's own command). Every consequential job action is audited (the durable_events journal under the `operational-jobs` owner) and evidenced in the A15 chain through the protocol's own discipline.
- **Health signal (implemented as the programmatic contract):** the job-progress audit reader (`src/lib/operations/progress-reader.ts`) — the journal + command-execution join; job-lag, reconciliation-lag and batch-progression metrics bind to observability from DEP-002+.
- **Rollback (contract):** redeploy the previous artifact; the durable jobs replay from the DEP-003 queue with deterministic idempotency keys (re-execution re-derives pending work from authoritative state and re-submits the SAME keys — recorded receipts, never a second effect). Rollback never asserts or reverses finality (R3).

### durable-command-queue — present today (in-process)

- **Repository entrypoint (present, in-process form):** `src/lib/durable/queue.ts` (the DEP-003 durable queue: UNIQUE (idempotency_key, kind) dedupe, at-least-once delivery, lease reclaim, dead-lettering) — the durable command path the gateway submits onto and the worker consumes from. Claimed paths exist on disk at the declared base.
- **Future work that remains:** FUTURE-WORK: externalized process binding — the durable command queue as separately provisioned queue infrastructure with depth/age and dead-letter observability (DEP-002+); the in-process module surface (the DEP-003 SQLite-backed queue inside the web-api-boundary application) is the composed realization.
- **Owner (runtime):** deployment. **Layer:** deployment.
- **Authority hosted:** none — durable, at-least-once transport for protocol commands (the execution topology's "durable command path" node); ordering and durability only; no financial semantics.
- **Health signal (contract):** queue depth and age; dead-letter rate (observability binding from DEP-002+).
- **Rollback (contract):** message retention and replay; payload semantics belong to producers and consumers, never to the queue.

### authoritative-state-store — present today (in-process)

- **Repository entrypoint (present, in-process form):** the per-domain persistence modules over the DEP-003 database layer — `src/lib/protocol-runtime/kernel/persistence.ts` (the convention) + `src/lib/durable/db.ts` + the per-domain `persistence.ts` of intent, policy, capability, routing, reservations, liquidity, credit, queues, clearing, obligations, netting, settlement, rails (`rails/persistence.ts`) and risk (`risk/store.ts`). Claimed paths exist on disk at the declared base.
- **Future work that remains:** FUTURE-WORK: externalized process binding — production persistence infrastructure with replication, point-in-time recovery, and backup verification (DEP-002+); the in-process module surface (the per-domain SQLite stores on the DEP-003 database layer inside the web-api-boundary application) is the composed realization.
- **Owner (runtime):** deployment (persistence infrastructure: backups, recovery, scaling). **Layer:** protocol (hosted authority).
- **Authority hosted:** protocol-owned authoritative state — intent, fulfillment-policy, capability, route-plan, reservation, liquidity, credit, queue, clearing, obligation, netting, settlement-and-finality, rail-operation, and risk/compliance records (registry A01–A14 and A16; rail-operation records included per rtn-plan-rulings.md Q1) — on the per-domain persistence convention over the DEP-003 database layer; mutated only by `transition-runtime` through protocol-owned transitions — no other layer may mutate it directly (hard boundary).
- **Health signal (implemented as the programmatic contract):** the ledger-identity consistency probes over the persisted per-domain stores (`hosting/probes.ts`); replication and backup verification arrive with the externalized binding (DEP-002+).
- **Rollback (contract):** point-in-time recovery plus replay of durable commands; direct external mutation is never permitted.

### evidence-object-store — present today (in-process)

- **Repository entrypoint (present, in-process form):** `src/lib/protocol-runtime/evidence/` — `log.ts` (the A15 EvidenceLog), `record.ts` (the closed authority vocabulary + five-slot record contract), `chain.ts` (the hash chain), `canonical.ts`, `persistence.ts` (the append-only per-domain evidence store, ON CONFLICT DO NOTHING write keys — INV-15-4). Claimed paths exist on disk at the declared base.
- **Future work that remains:** FUTURE-WORK: externalized process binding — evidence object storage as separately provisioned infrastructure with retention-integrity observability (DEP-002+); the in-process module surface (RTN-002's A15 log + per-domain evidence store) is the composed realization.
- **Owner (runtime):** deployment (object storage infrastructure). **Layer:** protocol (hosted authority).
- **Authority hosted:** Evidence Authority records (registry A15) — append-only, hash-chained evidence over every consequential operation of every authority, plus external evidence ingested through the rail adapters; never edited or deleted within retention (GC-5).
- **Health signal (contract):** write and read success; retention integrity checks (the chain verification is the programmatic integrity check; observability binding from DEP-002+).
- **Rollback (contract):** restore from backup with append-only history preserved; rollback never rewrites evidence.

### external-rail-adapters — present today (in-process: the PROTOCOL-OWNED SIMULATED RAILS + the DEP-005 connectivity boundary)

- **Repository entrypoint (present, in-process form):** `src/lib/protocol-runtime/rails/adapters.ts` — the transmission-and-reporting-only adapter interface (RTN-004, under the Q1/delta-1 ruling: no code path in the adapter interface creates or mutates RailAdapter/RailOperation state; reports are recorded through the A13 authority's command surface) — PLUS, since DEP-005, the connectivity boundary family `src/lib/rail-connectivity/` (`index.ts` the family barrel + boundary contract, `transport.ts` the typed adapter-transport port, `configuration.ts` the environment-scoped per-rail configuration resolver, `retry.ts` the transport retry/deadline safeguard engine, `activity.ts` the adapter-activity observability/audit surface, `boundary.ts` the composition into the frozen `RailAdapterConnection`, `RAIL-CONNECTIVITY-EVIDENCE.md` the evidence document) and the evidence harness `scripts/test_rail_connectivity.mjs`. Claimed paths exist on disk at the declared base. The in-process transport realization is the simulated rail: same interface, no external transmission, no real credentials, no signing capability.
- **Future work that remains:** FUTURE-WORK: the real transport primitive + real-rail credential binding — the real network transport client (HTTP/TLS, provider protocols, signing) and the real adapters that replace the protocol-owned simulated rails, bound in the externalized adapter-fleet process (DEP-002+); production rail credentials exist solely in the production secret scope and are dereferenced from the recorded reference names at the externalized binding (never in the repository — S1-S5). What DEP-005 LANDED in-process: the typed transport port (every call carries the deadline, the rail idempotency key and the correlation ids, and resolves the explicit quadruple delivered-with-report | timeout | transport-failure (typed reasons, phase-classified) | UNKNOWN — no implicit success), the environment-scoped configuration resolution (`PAYSWAP_RAIL_{SCOPE}_{RAIL}_*` names — credential REFERENCES only; malformed/missing configuration refuses the start; sandbox/production scope tags cannot cross-contaminate: opposite-scope and both-scope rails are refused at resolution and again at binding), the same-key/bounded/backoff/deadline-aware retry engine (retransmission re-sends the exact idempotency-key triple — INV-13-3; only explicitly-retryable pre-effect failures; UNKNOWN and timeout are never retried), and the structured adapter-activity observability (queryable by rail/key/outcome/window; dual-written to `durable_events` under owner `rail-connectivity`).
- **Owner (runtime):** deployment. **Layer:** deployment.
- **Authority hosted:** none — the only component that transmits to external rails (banks, PSPs, mobile money, blockchains); it transmits exclusively protocol-authorized outputs and cannot originate or alter financial decisions; it holds rail credentials and fails closed when they are absent; it ingests external evidence into `evidence-object-store`. The DEP-005 connectivity boundary is this component's safeguard surface: it hosts no protocol authority, admits no protocol commands (the protocol gateway stays the sole admission point) and writes no authoritative state (the transition runtime stays the single writer; the frozen A13 command surface stays the only state path).
- **Health signal (implemented as the programmatic contract; observability binding from DEP-002+):** the adapter-activity query surface (`src/lib/rail-connectivity/activity.ts`) — one structured record per consequential connectivity event (rail, idempotency key, outcome, latency, correlation, typed failure reason, deadline, attempt ordinal); adapter circuit state, rail reachability and submission acknowledgment rate derive from these records.
- **Rollback (contract):** fail-closed disable or hold, then replay of pending authorized submissions after recovery; financial reversals flow only through protocol-governed recourse.
- **Simulation rule:** development, test/CI, sandbox and staging use protocol-owned simulated rails — same interface, no external transmission, no real credentials, no signing capability. This IS the in-process form materialized today; real rails arrive only with the externalized binding's separately authorized production configuration (the DEP-005 connectivity boundary enforces the scope separation structurally: a sandbox process cannot resolve or bind a production-scoped rail's hosts or credential references, and vice versa).

## Component boundaries

**Web/API boundary.** The only internet-facing component. Hosts product presentation and progressive disclosure. No financial authority: it never mutates authoritative state, never queues on its own, never reaches rails. It reads the environment signal server-side (`PAYSWAP_ENV`) and forwards protocol operations to `protocol-gateway` once that component exists. Product-owned semantics live here; protocol semantics never do.

**Durable command path (queue boundary).** Every state-changing protocol operation flows through `durable-command-queue` — no component bypasses it by writing authoritative state directly. At-least-once delivery; replay-safe; consumers are idempotent. The queue itself carries no financial semantics.

**Worker boundary.** Background workers (`reconciler-workers`, `netting-settlement-workers`, future subtypes) consume durable commands and execute protocol-owned semantics inside deployment-owned processes. They never serve internet traffic, never hold rail credentials (only adapters do), and never mutate authoritative state directly. The `operational-jobs` component (DEP-004) is the orchestration layer of this boundary: its durable job kinds derive pending work from the authorities' public read surfaces and emit protocol commands exclusively through the protocol gateway — never executing protocol-owned semantics themselves (the transition runtime remains the single writer) and never mutating authoritative state directly.

**Scheduler boundary.** `scheduler` emits timing-driven commands into the durable queue. It owns timing, not semantics: no state mutation, no rail access, no protocol decisions.

**Persistence boundary.** `authoritative-state-store` is mutated only by `transition-runtime` through protocol-owned transitions. Deployment owns the infrastructure (backups, recovery, scaling) but holds no financial authority over its contents; no layer mutates another layer's authoritative state directly.

**Evidence storage boundary.** `evidence-object-store` is append-only. It is written by protocol components and by adapter ingestion of external evidence; retained per governance; never edited; rollback restores but never rewrites history.

**Adapter boundary (external effects).** `external-rail-adapters` is the sole external-effect execution point. It transmits only protocol-authorized outputs; credentials live only in the production secret scope (environments.md fail-closed rules F4/F5/F6); adapters fail closed without credentials; non-production environments use simulated rails. This is the mechanism behind "sandbox/demo cannot reach production financial effects without separately authorized production configuration". Since DEP-005 the component's connectivity boundary (`src/lib/rail-connectivity/`) enforces the transport safeguards at this seam: explicit typed outcomes (timeout/failure/UNKNOWN), deadline-carrying requests, same-key bounded retry, adapter-activity audit — with UNKNOWN surfacing to the A14 reconciliation path, never translated, never blind-retried; the boundary itself admits no protocol commands and writes no authoritative state.

## Runtime ownership of protocol authorities

The ownership model, machine-checked by `scripts/validate_deployment.py`:

- **Owner (runtime) = `deployment` for every component.** Deployment owns process topology, persistence infrastructure, queues, schedulers, workers, secrets, runtime configuration, CI/CD, observability, scaling, backups, recovery and environment isolation — for every deployed component, including those hosting protocol authority.
- **Layer = the architecture layer whose authority the component hosts.** The protocol authorities enumerated by the system architecture's hard boundaries (identity, authority, values, accounting, intent, demand, capability, market, liquidity, credit, reservations, routing/compiler, execution, clearing, obligations, netting, risk/compliance, evidence, simulation, extensions, agents, recourse, federation, settlement and finality) are hosted ONLY by components whose layer is `protocol`: `protocol-gateway`, `transition-runtime`, `reconciler-workers`, `netting-settlement-workers`, `authoritative-state-store`, `evidence-object-store`.
- The `web-api-boundary` (layer `product`), `durable-command-queue`, `scheduler` and `external-rail-adapters` (layer `deployment`) host NO protocol authority. Protocol authority therefore never runs in the presentation tier, the queue, the scheduler or the adapters. There is exactly one protocol-command admission point (`protocol-gateway`) and exactly one authoritative-state writer (`transition-runtime`).

Consequences (hard boundaries restated): no layer creates a competing financial authority; no layer bypasses protocol authorization; no layer mutates another layer's authoritative state directly; production readiness is never inferred from sandbox behavior.

## Environment signal wiring

The application's environment signal (`src/lib/environment.ts`) reads the server-side `PAYSWAP_ENV` variable with the exact allowlist `sandbox | production` and fail-safe to `sandbox`. The five deployment environment classes (development, test-ci, sandbox, staging, production) are defined in `spec/deployment/environments.md`; the configuration and secret boundary rules are in `spec/deployment/configuration.md`. No component may widen the allowlist by configuration; no environment other than production may set `PAYSWAP_ENV=production`; sandbox/demo cannot reach production financial effects without separately authorized production configuration (fail-closed rules F1–F8).

## Health and rollback model

Health is defined per component as a contract. Today only the web boundary has a live runtime health signal (HTTP readiness on `/` plus the environment signal). Future components ship their health signals (listed in their per-component contracts) with their governed work items; DEP-002 onward binds those signals to observability.

Rollback principles:

- **R1 — stateless components** (web boundary, gateway, scheduler, workers): redeploy the previous artifact.
- **R2 — stateful recovery** (authoritative state, evidence, queue): point-in-time recovery plus replay through the durable command path; idempotent consumers make replay safe.
- **R3 — finality:** deployment rollback never reverses protocol finality; post-finality corrections flow only through protocol-governed recourse. Rollback restores infrastructure, not financial outcomes.
- **R4 — evidence:** append-only; restore-from-backup preserves history; rollback never edits evidence.
- **R5 — no bypass:** rollback and recovery paths never bypass protocol authorization — they replay authorized commands; they never hand-edit authoritative state.

## Verification

- **Static/configuration verification (review gate):** `python3 scripts/validate_deployment.py` from the repository root — exit 0 required. It checks: the registry parses and every component carries the required fields; the environment matrix in environments.md agrees with the registry; the runtime allowlist `sandbox | production` is stated in the documents and implemented in `src/lib/environment.ts`; every claimed-today repository entrypoint exists on disk; future-work markers are explicit; the ownership model holds (owner = deployment, authority only in protocol-layer components); and this document agrees with the registry (component ids and normative topology nodes present).
- **Typecheck:** repository script `typecheck` (`tsc --noEmit`).
- **Startup/readiness check (web boundary, per environment):** boot the application with the environment's `PAYSWAP_ENV`; `GET /` must return 200 with the shell rendered; the environment signal must resolve to the allowlisted value (fail-safe `sandbox` otherwise). The production startup path is the repository script chain `build` → `start`, exercised in the test/CI environment before any production promotion.
- Execution evidence for this contract (validator output, environment-isolation checks, production-like startup/readiness) is recorded in the DEP-001 completion report.

## Contract evolution

Adding, removing or re-scoping components, environments or the `PAYSWAP_ENV` allowlist is a governed change that updates `deploy/contracts/components.json`, the `spec/deployment/*` documents and `scripts/validate_deployment.py` together in one work item. DEP-002 onward binds these components to real infrastructure; until then the registry is the single source of truth for what exists versus what is FUTURE-WORK.

**Change record:**

- **DEP-001** generated the contract (base `fdef3aa7…`; present-set locked to `web-api-boundary`).
- **DEP-002** added the runtime-packaging/startup-validation/health-readiness delta checks (every locked DEP-001 value unchanged).
- **RTN-012** updated the present-set to all ten components with the RTN wave's in-process repository entrypoints (rtn-plan-rulings.md Q3/delta 3, under the DEP-003 precedent): declared base moved to the RTN wave base `14b6ca56c07de585df6d1a3a97edcc36ad2e4c02` (where the in-process entrypoints exist on disk); every component carries the `future_work` note recording the externalized process binding (and, for the rail adapters, the DEP-005 real-rail credential binding) that remains future work; owner stays `deployment` for every component; authority only in protocol-layer entries (registry-aligned names per rtn-plan-rulings.md Q4); `external-rail-adapters` stays authority_hosted `none` (Q3, delta 3). All three surfaces — components.json, this document, and the validator — were updated together in that one work item, and `python3 scripts/validate_deployment.py` exits 0 over the updated contract.
- **DEP-004** added the `operational-jobs` component — the durable operational-jobs family (`src/lib/operations/`: reconciliation sweeps, clearing batch progression, netting-settlement progression, queue-drain support; the orchestration wiring; the job-progress audit reader; the operational evidence document + the `scripts/test_operations.mjs` evidence harness) — layer `deployment`, authority_hosted `none` (orchestration only: commands exclusively through `protocol-gateway`, deterministic idempotency keys per (job, cycle, subject), finality never asserted by the jobs, UNKNOWN outcomes trigger the A14 reconciliation path — never a blind retry). Declared base moved to the DEP-004 dispatch base `2c3f9cf0efb7bae808662d4dd1adaf604d69de0e` (the composed protocol runtime the jobs orchestrate over; the operational-jobs entrypoints arrive with the DEP-004 work item's tree and the validator's on-disk honesty check runs against it); owner stays `deployment` for every component; authority only in protocol-layer entries (unchanged). All three surfaces — components.json, this document, and the validator — were updated together in that one work item, and `python3 scripts/validate_deployment.py` exits 0 over the updated contract.
- **DEP-005** landed the external rail connectivity boundary as an owned in-process surface of the `external-rail-adapters` component (the DEP-003/RTN-012/DEP-004 precedent; no present-set change — the boundary is an owned surface of the existing component, not a new one): the `src/lib/rail-connectivity/` family (the typed adapter-transport port with the explicit result quadruple `delivered-with-report | timeout | transport-failure (typed reasons, phase-classified) | UNKNOWN`, every call carrying the deadline + rail idempotency key + correlation ids; the environment-scoped per-rail configuration resolver — `PAYSWAP_RAIL_{SCOPE}_{RAIL}_*` names, credential REFERENCES only, fail-closed loading, sandbox/production scope tags with cross-contamination refused at resolution AND at binding; the same-key/bounded/backoff/deadline-aware retry engine — INV-13-3 retransmission identity, explicitly-retryable pre-effect failures only, UNKNOWN/timeout never retried; the structured adapter-activity observability/audit surface — queryable, dual-written to `durable_events` under owner `rail-connectivity`; the boundary composition wrapping it all into the FROZEN A13 `RailAdapterConnection` interface) + the `scripts/test_rail_connectivity.mjs` evidence harness. The component's entrypoints, `required_configuration` (the per-rail pattern names), `health_signal` (the adapter-activity query surface) and `future_work` were updated; the future-work note now records precisely what remains: the real network transport primitive + real adapter implementations and the production credential binding (secret-store dereference of the recorded reference names), both part of the externalized process binding (DEP-002+). Declared base moved to the DEP-005 dispatch base `5bda6c02a6302461908a5601da5b49f655a489c1` (DEP-003 + DEP-004 merged); owner stays `deployment` for every component; authority only in protocol-layer entries (unchanged); the frozen adapter/execution/reconciliation/evidence authorities were untouched (read-only integration: the boundary imports the frozen interface type-only + the payload-proof leaf utility). All four surfaces — components.json, this document, spec/deployment/configuration.md, and the validator — were updated together in that one work item, and `python3 scripts/validate_deployment.py` exits 0 over the updated contract.
