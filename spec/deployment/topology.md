# PaySwap runtime topology contract

**Work order:** DEP-001 — Deployment topology and environment contract
**Status:** PLANNED — contract defined by DEP-001; deployment-owned capacity lands with later governed work
**Base:** main @ f934a76f20efbd6e238605d8e7320495974a870e
**Owned surfaces:** deployment manifests, environment contracts, runtime topology documentation/configuration
**Forbidden:** protocol semantic changes; product financial authority; external-effect bypass
**Companions:** `spec/deployment/environments.md` (environment contract), `spec/deployment/configuration.md` (configuration and secret boundary contract), `deploy/contracts/components.json` (machine-readable component registry), `scripts/validate_deployment.py` (static/configuration verification gate)

## Purpose and method

This document defines the actual PaySwap runtime topology FROM THE REPOSITORY'S REAL ENTRYPOINTS — not from aspiration. For every component it records: repository entrypoint (an actual repository path that exists today, or the FUTURE-WORK marker of the governed work that will bring it), owner layer, the authority it hosts, its health signal, and its rollback mechanism.

DEP-001 defines contracts only. It performs no cloud deployments, no runtime packaging and invents no credentials — none are needed for a contract. Actual target binding (Vercel, Cloudflare, database/queue providers, observability) is held by the Tech Lead and is used from DEP-002 onward.

Honesty rule: a component that does not exist as repository code at the declared base is marked **FUTURE-WORK** with its dependency-graph provenance. It is never silently presented as existing, and no entrypoint is invented for it. The machine-readable registry (`deploy/contracts/components.json`) and the validator (`scripts/validate_deployment.py`) enforce this: claimed-today entrypoints must exist on disk, and the set of components claiming repository presence today is locked to `web-api-boundary` until a governed change updates the contract.

## Repository source of truth (base SHA f934a76f20efbd6e238605d8e7320495974a870e)

The repository's real entrypoints today:

- **Application:** a Next.js (App Router) + TypeScript + Tailwind web application at the repository root.
  - `package.json`: name `payswap3`; scripts: `dev` = `next dev`, `build` = `next build`, `start` = `next start`, `typecheck` = `tsc --noEmit`.
  - Runtime dependencies: `next` 16.1.3, `react` 19.2.3, `react-dom` 19.2.3.
- **Route surface:** `/` (shell home), `/state-primitives` (verification surface), `/_not-found`.
- **Environment contract already in the app:** `src/lib/environment.ts` reads the server-side `PAYSWAP_ENV` variable with an exact allowlist (`sandbox | production`) and fail-safe to `sandbox`. This topology aligns with and extends that contract; it never contradicts it (see "Environment signal wiring" below).

Everything behind the web/API boundary in the target topology — protocol gateway, durable command queue, transition runtime, background workers, scheduler, database, evidence storage, external rail adapters — does **not** exist as repository code at this base. Those components are **deployment-owned capacity** whose repository entrypoints arrive as future work items per the dependency graph (protocol WORK-001..WORK-033; infrastructure binding from DEP-002 onward).

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

Of the nodes above, exactly one exists as repository code today: the **Web/API boundary application**, which currently hosts the Product/API branch (the shell home `/` and the verification surface `/state-primitives`). It is the only internet-facing surface today, and it hosts **no financial authority**.

All nodes behind the boundary are specified-but-not-yet-in-repo. Until their governed work items land, the durable command path, workers, scheduler, persistence, queue, evidence storage and adapters exist only as this contract's requirements. The web/API boundary must not accumulate their responsibilities locally in the meantime: no authoritative state, no queue semantics, no rail access, and no protocol-authority enforcement in the application tier.

## Architecture-to-component mapping

| Execution-topology node | Component id (components.json) | Repository status at base |
| --- | --- | --- |
| Users / Integrators | not a deployed component (clients; see environments.md "who/what may reach it") | n/a |
| Web / API boundary | `web-api-boundary` | present today |
| Product/API | `web-api-boundary` (product-owned surface within the boundary application) | present today |
| Protocol gateway | `protocol-gateway` | FUTURE-WORK |
| Durable command path | `durable-command-queue` | FUTURE-WORK |
| Transition/runtime | `transition-runtime` | FUTURE-WORK |
| Background workers | worker family: `reconciler-workers`, `netting-settlement-workers` (further subtypes arrive as governed work adds them) | FUTURE-WORK |
| scheduler | `scheduler` | FUTURE-WORK |
| reconcilers | `reconciler-workers` | FUTURE-WORK |
| netting/settlement | `netting-settlement-workers` | FUTURE-WORK |
| Authoritative state / database | `authoritative-state-store` | FUTURE-WORK |
| queue | `durable-command-queue` | FUTURE-WORK |
| object/evidence storage | `evidence-object-store` | FUTURE-WORK |
| External rail adapters | `external-rail-adapters` | FUTURE-WORK |
| banks / PSPs / mobile money / blockchains | external parties — reachable only through `external-rail-adapters` | external |
| external evidence | ingested only through `external-rail-adapters` into `evidence-object-store` | external |

## Component registry summary

Machine-readable source of record: `deploy/contracts/components.json`. Human summary (full per-component contracts follow):

| id | status | repository entrypoint | owner (runtime) | layer (authority hosted) | health signal (contract) | rollback (contract) |
| --- | --- | --- | --- | --- | --- | --- |
| `web-api-boundary` | present | `package.json`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/lib/environment.ts` | deployment | product | HTTP readiness on `/` | stateless redeploy |
| `protocol-gateway` | FUTURE-WORK | protocol WORK-001..WORK-033; binding DEP-002+ | deployment | protocol | readiness + command acceptance | redeploy + queue replay |
| `transition-runtime` | FUTURE-WORK | protocol WORK-001..WORK-033 | deployment | protocol | transition backlog + consistency probes | redeploy + PITR + replay |
| `scheduler` | FUTURE-WORK | deployment capacity; binding DEP-002+ | deployment | deployment | heartbeat + missed-schedule alarms | redeploy (config only) |
| `reconciler-workers` | FUTURE-WORK | protocol WORK-001..WORK-033 | deployment | protocol | drift metrics + reconciliation lag | redeploy + idempotent replay |
| `netting-settlement-workers` | FUTURE-WORK | protocol WORK-001..WORK-033 | deployment | protocol | batch progress + ledger integrity | redeploy + replay; never un-finalize |
| `durable-command-queue` | FUTURE-WORK | deployment capacity; binding DEP-002+ | deployment | deployment | depth/age + dead-letter rate | retention + replay |
| `authoritative-state-store` | FUTURE-WORK | deployment capacity; binding DEP-002+ | deployment | protocol | replication + consistency probes | PITR + replay; single writer only |
| `evidence-object-store` | FUTURE-WORK | deployment capacity; binding DEP-002+ | deployment | protocol | write/read success + retention integrity | backup restore; append-only kept |
| `external-rail-adapters` | FUTURE-WORK | protocol WORK-001..WORK-033; binding DEP-002+ | deployment | deployment | circuit state + rail reachability | fail-closed hold + replay |

## Per-component contracts

### web-api-boundary — the Next.js application (EXISTS TODAY)

- **Repository entrypoint (present):** `package.json`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/lib/environment.ts`. Route surface: `/` (shell home), `/state-primitives` (verification surface), `/_not-found`. Manifest facts: name `payswap3`; scripts `dev` = `next dev`, `build` = `next build`, `start` = `next start`, `typecheck` = `tsc --noEmit`; `next` 16.1.3, `react` 19.2.3, `react-dom` 19.2.3.
- **Owner (runtime):** deployment — the process, its hosting, scaling, runtime configuration and environment isolation are deployment-owned.
- **Layer (authority hosted):** product — hosts product-owned navigation, presentation and progressive disclosure.
- **Authority hosted:** none. The boundary hosts no financial authority: it never originates, approves or mutates financial state; it never reaches external rails; once the protocol gateway lands it forwards protocol operations there (through the durable command path); it never writes authoritative state directly.
- **Health signal (implemented today):** process boot plus HTTP readiness — `GET /` returns 200 and the shell renders; the environment signal resolves to an allowlisted value (`sandbox` by fail-safe; `production` only under the production configuration).
- **Rollback:** stateless redeploy of the previous commit/build artifact. The shell holds no authoritative state, so rollback involves no data recovery.
- **Boundary rules:** see "Component boundaries" §Web/API below.

### protocol-gateway — FUTURE-WORK

- **Repository entrypoint (future-work marker):** FUTURE-WORK: protocol runtime per dependency graph WORK-001..WORK-033; infrastructure binding from DEP-002 onward. No repository code exists at this base.
- **Owner (runtime):** deployment (process, hosting, configuration, scaling, secrets).
- **Layer (authority hosted):** protocol.
- **Authority hosted:** the protocol authorities enumerated by the system architecture's hard boundaries — identity, authority, values, accounting, intent, demand, capability, market, liquidity, credit, reservations, routing/compiler, execution admission, clearing, obligations, risk/compliance, recourse, federation — enforced inside a deployment-owned process. It is the sole admission point for protocol commands.
- **Health signal (contract for the future work item):** readiness endpoint; command acceptance rate and latency; durable-queue submit success.
- **Rollback (contract):** redeploy the previous artifact; in-flight commands replay from the durable command queue; rollback never mutates authoritative state directly.

### transition-runtime — FUTURE-WORK

- **Repository entrypoint (future-work marker):** FUTURE-WORK: protocol runtime per dependency graph WORK-001..WORK-033.
- **Owner (runtime):** deployment. **Layer:** protocol.
- **Authority hosted:** authoritative state transitions — execution, clearing, obligations, netting, settlement, finality (protocol-owned) — applied as the single writer to `authoritative-state-store`.
- **Health signal (contract):** transition backlog depth/age; authoritative-state consistency probes.
- **Rollback (contract):** redeploy the previous artifact plus point-in-time recovery of authoritative state and replay of durable commands. As the only authoritative-state writer, no other rollback path exists.

### scheduler — FUTURE-WORK

- **Repository entrypoint (future-work marker):** FUTURE-WORK: deployment capacity per dependency graph; infrastructure binding from DEP-002 onward.
- **Owner (runtime):** deployment. **Layer:** deployment.
- **Authority hosted:** none — emits timing-driven commands into the durable command queue; owns timing only, never mutates authoritative state and never reaches external rails.
- **Health signal (contract):** scheduler heartbeat; missed-schedule alarms.
- **Rollback (contract):** redeploy the previous artifact; schedules are configuration, so no data recovery is involved.

### reconciler-workers — FUTURE-WORK

- **Repository entrypoint (future-work marker):** FUTURE-WORK: protocol runtime per dependency graph WORK-001..WORK-033.
- **Owner (runtime):** deployment. **Layer:** protocol.
- **Authority hosted:** protocol-owned reconciliation semantics — compares authoritative state against external evidence and submits corrective commands through the protocol gateway; never mutates authoritative state directly and never reaches rails directly.
- **Health signal (contract):** reconciliation lag; drift metrics.
- **Rollback (contract):** redeploy the previous artifact; idempotent replay from the durable command path.

### netting-settlement-workers — FUTURE-WORK

- **Repository entrypoint (future-work marker):** FUTURE-WORK: protocol runtime per dependency graph WORK-001..WORK-033.
- **Owner (runtime):** deployment. **Layer:** protocol.
- **Authority hosted:** netting, settlement and finality computation (protocol-owned) executed as deployment-owned background processes. Corrections after finality flow only through protocol-governed recourse — deployment rollback never un-finalizes.
- **Health signal (contract):** settlement batch progress; ledger integrity probes.
- **Rollback (contract):** redeploy the previous artifact and replay durable commands; finality is never reversed by deployment action.

### durable-command-queue — FUTURE-WORK

- **Repository entrypoint (future-work marker):** FUTURE-WORK: deployment capacity per dependency graph; infrastructure binding from DEP-002 onward.
- **Owner (runtime):** deployment. **Layer:** deployment.
- **Authority hosted:** none — durable, at-least-once transport for protocol commands (the execution topology's "durable command path" node); ordering and durability only; no financial semantics.
- **Health signal (contract):** queue depth and age; dead-letter rate.
- **Rollback (contract):** message retention and replay; payload semantics belong to producers and consumers, never to the queue.

### authoritative-state-store — FUTURE-WORK

- **Repository entrypoint (future-work marker):** FUTURE-WORK: deployment capacity per dependency graph; infrastructure binding from DEP-002 onward.
- **Owner (runtime):** deployment (persistence infrastructure: backups, recovery, scaling). **Layer:** protocol (hosted authority).
- **Authority hosted:** protocol-owned authoritative state (identity, accounting, reservations, obligations, settlement and finality records) on deployment-owned persistence infrastructure; mutated only by `transition-runtime` through protocol-owned transitions — no other layer may mutate it directly (hard boundary).
- **Health signal (contract):** replication and consistency probes; backup verification.
- **Rollback (contract):** point-in-time recovery plus replay of durable commands; direct external mutation is never permitted.

### evidence-object-store — FUTURE-WORK

- **Repository entrypoint (future-work marker):** FUTURE-WORK: deployment capacity per dependency graph; infrastructure binding from DEP-002 onward.
- **Owner (runtime):** deployment (object storage infrastructure). **Layer:** protocol (hosted authority).
- **Authority hosted:** protocol-owned evidence records — command and decision evidence written by protocol components, plus external evidence ingested through the rail adapters — on deployment-owned object storage; append-only; never edited or deleted within retention.
- **Health signal (contract):** write and read success; retention integrity checks.
- **Rollback (contract):** restore from backup with append-only history preserved; rollback never rewrites evidence.

### external-rail-adapters — FUTURE-WORK

- **Repository entrypoint (future-work marker):** FUTURE-WORK: protocol adapter semantics per dependency graph WORK-001..WORK-033; credential binding from DEP-002 onward.
- **Owner (runtime):** deployment. **Layer:** deployment.
- **Authority hosted:** none — the only component that transmits to external rails (banks, PSPs, mobile money, blockchains); it transmits exclusively protocol-authorized outputs and cannot originate or alter financial decisions; it holds rail credentials and fails closed when they are absent; it ingests external evidence into `evidence-object-store`.
- **Health signal (contract):** adapter circuit state; rail reachability; submission acknowledgment rate.
- **Rollback (contract):** fail-closed disable or hold, then replay of pending authorized submissions after recovery; financial reversals flow only through protocol-governed recourse.
- **Simulation rule:** development, test/CI, sandbox and staging use protocol-owned simulated rails — same interface, no external transmission, no real credentials, no signing capability.

## Component boundaries

**Web/API boundary.** The only internet-facing component. Hosts product presentation and progressive disclosure. No financial authority: it never mutates authoritative state, never queues on its own, never reaches rails. It reads the environment signal server-side (`PAYSWAP_ENV`) and forwards protocol operations to `protocol-gateway` once that component exists. Product-owned semantics live here; protocol semantics never do.

**Durable command path (queue boundary).** Every state-changing protocol operation flows through `durable-command-queue` — no component bypasses it by writing authoritative state directly. At-least-once delivery; replay-safe; consumers are idempotent. The queue itself carries no financial semantics.

**Worker boundary.** Background workers (`reconciler-workers`, `netting-settlement-workers`, future subtypes) consume durable commands and execute protocol-owned semantics inside deployment-owned processes. They never serve internet traffic, never hold rail credentials (only adapters do), and never mutate authoritative state directly.

**Scheduler boundary.** `scheduler` emits timing-driven commands into the durable queue. It owns timing, not semantics: no state mutation, no rail access, no protocol decisions.

**Persistence boundary.** `authoritative-state-store` is mutated only by `transition-runtime` through protocol-owned transitions. Deployment owns the infrastructure (backups, recovery, scaling) but holds no financial authority over its contents; no layer mutates another layer's authoritative state directly.

**Evidence storage boundary.** `evidence-object-store` is append-only. It is written by protocol components and by adapter ingestion of external evidence; retained per governance; never edited; rollback restores but never rewrites history.

**Adapter boundary (external effects).** `external-rail-adapters` is the sole external-effect execution point. It transmits only protocol-authorized outputs; credentials live only in the production secret scope (environments.md fail-closed rules F4/F5/F6); adapters fail closed without credentials; non-production environments use simulated rails. This is the mechanism behind "sandbox/demo cannot reach production financial effects without separately authorized production configuration".

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
