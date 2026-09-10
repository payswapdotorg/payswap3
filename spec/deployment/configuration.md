# PaySwap configuration and secret boundary contract

**Work order:** DEP-001 — Deployment topology and environment contract
**Status:** PLANNED — contract defined by DEP-001; secret binding to real infrastructure from DEP-002 onward
**Base:** main @ f934a76f20efbd6e238605d8e7320495974a870e
**Owned surfaces:** configuration contracts, secret boundaries
**Forbidden:** protocol semantic changes; product financial authority; external-effect bypass
**Companions:** `spec/deployment/topology.md` (runtime topology), `spec/deployment/environments.md` (environment classes and fail-closed rules), `deploy/contracts/components.json` (machine-readable registry), `scripts/validate_deployment.py` (verification gate)

## Scope

As of base SHA f934a76 the application exposes exactly **one** externally configurable value: `PAYSWAP_ENV`. This document defines where it is set, how it is validated, and the secret-boundary rules that govern all configuration that later work items will introduce. Every externally configurable value for the existing application is listed here; anything not listed is not configurable. The list is closed: new values arrive only with their components' governed work items, together with an update to this document, `deploy/contracts/components.json` and `scripts/validate_deployment.py`.

## Externally configurable values (current)

| Variable | Where it is set | Allowed values | Validation and invalid behavior | Secret? | Read by |
| --- | --- | --- | --- | --- | --- |
| `PAYSWAP_ENV` | server process environment only: deployment-platform environment (sandbox, staging, production), CI environment (test-ci), local shell or git-ignored `.env` (development) | exact allowlist `sandbox | production` (case-sensitive exact match) | unset, empty or any non-allowlisted value fail-safes to `sandbox`; the process never errors on a bad value and never defaults to `production` | no — a non-sensitive environment class label, safe to surface in the shell's environment signal | `src/lib/environment.ts` (server-side only); surfaced by the shell's environment signal |

## Validation rules

1. **Server-side only.** `PAYSWAP_ENV` is read from the server process environment; never from the client, requests, query parameters or client-side storage.
2. **Exact match.** Recognition is an exact, case-sensitive match against the allowlist `sandbox | production`; there are no aliases, prefixes or case-folding.
3. **Fail-safe.** Unset, empty or invalid resolves to `sandbox`. Fail-safe is to sandbox, never to production.
4. **Placement.** `production` is set only in the production environment's separately authorized configuration (environments.md fail-closed rules F2 and F3).
5. **No configuration widening.** The allowlist cannot be extended by configuration. Extension is a governed code change that updates `src/lib/environment.ts`, `spec/deployment/environments.md`, this document, `deploy/contracts/components.json` and `scripts/validate_deployment.py` together in one work item.
6. **Not a secret.** `PAYSWAP_ENV` is a non-sensitive class label. Treating it as a capability token is forbidden: it never authorizes anything by itself (F3).

## Secret boundary rules

- **S1 Secrets never enter git, work-item text, PRs or worker reports.** No exceptions; this applies to every environment, contributor and agent.
- **S2 Secret values live only in the deployment-owned secret store**, bound to real infrastructure from DEP-002 onward. The repository and these specifications record secret names and categories only — never values. DEP-001 itself introduces no secrets and invents no credentials.
- **S3 No secret values in code, config files or defaults.** Components that require a secret fail closed when it is absent (environments.md F6); they never guess, hardcode or derive credentials.
- **S4 Local development.** If local secrets ever become necessary, they live in git-ignored `.env` files that are never committed; the same secret rules apply.
- **S5 Verification.** Secret-boundary compliance is enforced by review and static checks; the DEP-001 validator verifies the machine-checkable parts of the configuration contract (allowlist agreement across the implementation, the documents and the registry).

## Future configuration categories (FUTURE-WORK — no current values, by design)

These categories arrive with their components' governed work items (protocol WORK-001..WORK-033; infrastructure binding from DEP-002 onward). None exists today; none may be pre-filled with real values:

| Category | Arriving component | Status |
| --- | --- | --- |
| authoritative-state connection (persistence endpoint) | `authoritative-state-store` | FUTURE-WORK |
| durable queue connection | `durable-command-queue` | FUTURE-WORK |
| object/evidence storage endpoint | `evidence-object-store` | FUTURE-WORK |
| rail adapter credentials (banks, PSPs, mobile money, blockchains) | `external-rail-adapters` | FUTURE-WORK — production secret scope only |
| observability endpoints | deployment binding (DEP-002+) | FUTURE-WORK |

Rule: every new externally configurable value lands WITH its component's work item, updating this document, `deploy/contracts/components.json` and `scripts/validate_deployment.py` in the same change. The table above names categories only — no values, no defaults, no credentials.

## Verification

`python3 scripts/validate_deployment.py` (from the repository root) checks that this document states the exact runtime allowlist `sandbox | production` and documents `PAYSWAP_ENV`, in agreement with `src/lib/environment.ts`, `spec/deployment/environments.md` and `deploy/contracts/components.json`. Execution evidence is recorded in the DEP-001 completion report.
