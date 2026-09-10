# PaySwap environment contract

**Work order:** DEP-001 — Deployment topology and environment contract
**Status:** PLANNED — contract defined by DEP-001; binding to real infrastructure from DEP-002 onward
**Base:** main @ f934a76f20efbd6e238605d8e7320495974a870e
**Owned surfaces:** environment contracts, environment isolation
**Forbidden:** protocol semantic changes; product financial authority; external-effect bypass
**Companions:** `spec/deployment/topology.md` (runtime topology), `spec/deployment/configuration.md` (configuration and secret boundaries), `deploy/contracts/components.json` (machine-readable registry), `scripts/validate_deployment.py` (verification gate)

## Purpose

This contract defines the five PaySwap environment classes — development, test/CI, sandbox, staging, production — each with its purpose, isolation boundary, who/what may reach it, and configuration source. It aligns with — and extends, never contradicts — the application's runtime environment contract in `src/lib/environment.ts`.

The core guarantee, stated once and enforced by the fail-closed rules below: **sandbox/demo cannot reach production financial effects without separately authorized production configuration.**

## Canonical environments and the runtime allowlist

- **Canonical environment ids (deployment classes):** `development`, `test-ci`, `sandbox`, `staging`, `production`.
- **Runtime allowlist (application code):** `PAYSWAP_ENV` recognizes exactly `sandbox | production`, fail-safe `sandbox`. This is implemented today in `src/lib/environment.ts` and machine-checked by `scripts/validate_deployment.py`.

These are two layers of one contract: the five ids are DEPLOYMENT boundaries (who runs what, where, with which configuration); the runtime allowlist is what the application code resolves. The mapping is total and closed:

| Environment class | PAYSWAP_ENV runtime value | Application behavior |
| --- | --- | --- |
| development | unset, invalid, or sandbox | sandbox semantics (fail-safe) |
| test-ci | unset, invalid, or sandbox | sandbox semantics (fail-safe) |
| sandbox | sandbox | sandbox semantics |
| staging | sandbox (production-shaped infrastructure, sandbox runtime semantics) | sandbox semantics |
| production | production — set only in the production configuration | production semantics |

No fifth runtime value exists and no deployment configuration may invent one. Staging is production-shaped in infrastructure but runs sandbox runtime semantics; it is never a backdoor to production effects.

## Environment matrix

| Environment | Purpose | Isolation boundary | Who/what may reach it | Configuration source | PAYSWAP_ENV runtime value | Production financial effects |
| --- | --- | --- | --- | --- | --- | --- |
| `development` | local implementation and verification | workstation-local processes; no shared data plane; no shared credentials; no rail reachability | engineers on their own workstations | local shell or git-ignored .env; PAYSWAP_ENV unset or sandbox | `sandbox` (fail-safe) | none |
| `test-ci` | static and automated verification: `python3 scripts/validate_deployment.py`, typecheck, tests, build/start rehearsal | hermetic, ephemeral CI runners; no rail networks; no real credentials of any kind | CI pipelines only | CI-managed environment; PAYSWAP_ENV unset or sandbox | `sandbox` (fail-safe) | none |
| `sandbox` | shared, production-shaped demo surface | isolated sandbox namespace; simulated rails only; sandbox credential namespace holds no production secrets | demo users and integrators via the web/API boundary | deployment-managed sandbox configuration; PAYSWAP_ENV=sandbox | `sandbox` | none |
| `staging` | pre-release verification on production-shaped infrastructure | separate staging namespace and data plane; no production rail credentials by default; distinct observability | release engineers and internal verification flows | deployment-managed staging configuration; PAYSWAP_ENV=sandbox | `sandbox` | none — staging holds no production rail credentials; production effects require the separately authorized production configuration set |
| `production` | the live PaySwap service | production namespace; secrets only in the production secret scope; production-only credential and network reachability | end users and integrators via the web/API boundary; operators via observability only | separately authorized production configuration, bound from DEP-002 onward | `production` | only here — the sole environment with real financial effects |

## Environment details

### development

- **Purpose:** protocol and product implementation on a workstation.
- **Isolation boundary:** everything runs locally; no shared data plane; no production credentials; no rail reachability.
- **Who/what may reach it:** the engineer's own local processes only.
- **Configuration source:** local shell or a git-ignored `.env` (never committed).
- **PAYSWAP_ENV:** unset or `sandbox`; any other value fail-safes to `sandbox` in the application.
- **Production financial effects:** none.

### test-ci

- **Purpose:** static checks (`python3 scripts/validate_deployment.py`, `tsc --noEmit`), automated tests, and the build/start rehearsal of the web boundary (`build` → `start` before any production promotion).
- **Isolation boundary:** hermetic, ephemeral runners; no rail networks; no real credentials of any kind.
- **Who/what may reach it:** CI pipelines only.
- **Configuration source:** CI-managed environment variables; `PAYSWAP_ENV` unset or `sandbox`.
- **Production financial effects:** none.

### sandbox

- **Purpose:** the shared, production-shaped demo of the system.
- **Isolation boundary:** its own namespace; simulated rails (protocol-owned simulation semantics) with no external transmission; a sandbox credential namespace that holds no production secrets.
- **Who/what may reach it:** demo users and integrators via the web/API boundary.
- **Configuration source:** deployment-managed sandbox configuration; `PAYSWAP_ENV=sandbox`.
- **Production financial effects:** none.

### staging

- **Purpose:** pre-release verification against production-shaped infrastructure and topology.
- **Isolation boundary:** separate namespace and data plane from production; no production rail credentials by default; distinct observability.
- **Who/what may reach it:** release engineers and internal verification flows.
- **Configuration source:** deployment-managed staging configuration; `PAYSWAP_ENV=sandbox`.
- **Production financial effects:** none. Staging is production-shaped in infrastructure but runs sandbox runtime semantics; production effects require the production configuration set, which staging never holds.

### production

- **Purpose:** the live PaySwap service.
- **Isolation boundary:** production namespace; production-only credential scope; the only environment whose configuration sets `PAYSWAP_ENV=production`.
- **Who/what may reach it:** end users and integrators via the web/API boundary; operators via observability only.
- **Configuration source:** separately authorized production configuration, bound to real infrastructure from DEP-002 onward; secrets supplied by the deployment-owned secret store — never from the repository.
- **Production financial effects:** only here.

## Fail-closed rules

The work-order guarantee — sandbox/demo cannot reach production financial effects without separately authorized production configuration — is enforced by this rule set:

- **F1 Runtime allowlist (implemented today).** `PAYSWAP_ENV` recognizes exactly `sandbox | production`; unset, empty or any other value fail-safes to `sandbox` (`src/lib/environment.ts`). No configuration can widen the allowlist; widening is a governed code change.
- **F2 Production value placement.** `PAYSWAP_ENV=production` is set only in the production environment's configuration. Its presence anywhere else is a contract violation caught in review and by static checks.
- **F3 Necessary, not sufficient.** `PAYSWAP_ENV=production` alone enables no financial effect: real effects additionally require production rail adapter credentials, which exist only in the production secret scope (F4).
- **F4 Secret scoping.** No production secret appears in development, test/CI, sandbox or staging configuration, nor in git, work-item text, PRs or worker reports (see `spec/deployment/configuration.md`).
- **F5 Simulated rails.** Development, test/CI, sandbox and staging use protocol-owned simulated rails: no external transmission, no real credentials, no signing capability.
- **F6 Fail-closed adapters.** Adapters without credentials fail closed — they never infer, guess or escalate an environment.
- **F7 Namespace separation.** Environments are separated at network, credential and data-plane level; infrastructure binding (DEP-002 onward) must preserve this.
- **F8 No inference.** Production readiness is never inferred from sandbox behavior (hard boundary); the sandbox proves nothing about production.

## Verification

`python3 scripts/validate_deployment.py` (from the repository root) checks that the matrix ids above match the canonical environment set in `deploy/contracts/components.json`, that every matrix environment appears in component environment reachability, and that the runtime allowlist `sandbox | production` stated here agrees with `spec/deployment/configuration.md`, `deploy/contracts/components.json` and the implementation in `src/lib/environment.ts`. Execution evidence is recorded in the DEP-001 completion report.
