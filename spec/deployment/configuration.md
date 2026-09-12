# PaySwap configuration and secret boundary contract

**Work order:** DEP-001 — Deployment topology and environment contract
**Status:** PLANNED — contract defined by DEP-001; secret binding to real infrastructure from DEP-002 onward
**Base:** main @ f934a76f20efbd6e238605d8e7320495974a870e
**Owned surfaces:** configuration contracts, secret boundaries
**Forbidden:** protocol semantic changes; product financial authority; external-effect bypass
**Companions:** `spec/deployment/topology.md` (runtime topology), `spec/deployment/environments.md` (environment classes and fail-closed rules), `deploy/contracts/components.json` (machine-readable registry), `scripts/validate_deployment.py` (verification gate)

## Scope

As of base SHA f934a76 the application exposed exactly **one** externally configurable value: `PAYSWAP_ENV`; DEP-005 added the per-rail rail-connectivity configuration family as the second governed extension of this list. This document defines where each value is set, how it is validated, and the secret-boundary rules that govern all configuration. Every externally configurable value for the existing application is listed here; anything not listed is not configurable. The list is closed: new values arrive only with their components' governed work items, together with an update to this document, `deploy/contracts/components.json` and `scripts/validate_deployment.py`.

## Externally configurable values (current)

| Variable | Where it is set | Allowed values | Validation and invalid behavior | Secret? | Read by |
| --- | --- | --- | --- | --- | --- |
| `PAYSWAP_ENV` | server process environment only: deployment-platform environment (sandbox, staging, production), CI environment (test-ci), local shell or git-ignored `.env` (development) | exact allowlist `sandbox | production` (case-sensitive exact match) | unset, empty or any non-allowlisted value fail-safes to `sandbox`; the process never errors on a bad value and never defaults to `production` | no — a non-sensitive environment class label, safe to surface in the shell's environment signal | `src/lib/environment.ts` (server-side only); surfaced by the shell's environment signal |
| `PAYSWAP_RAIL_{SCOPE}_{RAIL}_HOST` (DEP-005; {SCOPE} is `SANDBOX` or `PRODUCTION`; {RAIL} is the declared rail id upper-cased with `-` → `_`) | the rail-connectivity boundary's process environment: deployment-managed per-environment configuration (production: the separately authorized production configuration; non-production: the sandbox namespace) | sandbox: `in-process:simulated` (the documented marker) or a `sandbox:`-namespaced reference; production: a URI-shaped host reference | missing/empty → the resolver's typed `HOST_MISSING` (or `SCOPE_MISMATCH` when only the opposite-scope prefix is set); malformed → `HOST_MALFORMED`; a sandbox host other than the simulated marker is refused (F5); a rail under BOTH scope prefixes → `SCOPE_CONTAMINATION` — every failure refuses the boundary's start (fail-closed, F6) | no — a host reference, never a credential | `src/lib/rail-connectivity/configuration.ts` (the resolver; scoped resolution only) |
| `PAYSWAP_RAIL_{SCOPE}_{RAIL}_CREDENTIAL_REF` (DEP-005) | the production secret scope's process environment at the externalized binding; sandbox may omit it | a reference NAME: alphanumeric plus `. _ : -` separators, at most 256 characters | missing/empty in production → `CREDENTIAL_REF_REQUIRED_FOR_PRODUCTION` (fail-closed — adapters without credentials never run, F6); malformed → `CREDENTIAL_REF_MALFORMED`; optional in sandbox (F5: simulated rails, no real credentials) | the reference NAME is configuration; the credential VALUE it names never enters the repository, code, tests, specs or reports (S1-S4) — dereferencing is the externalized production binding (FUTURE-WORK) | `src/lib/rail-connectivity/configuration.ts` (records the reference only; nothing in the family ever reads a value) |
| `PAYSWAP_RAIL_{SCOPE}_{RAIL}_TIMEOUT_MS` (DEP-005) | the rail-connectivity boundary's process environment | a positive safe integer (the per-rail transmission deadline budget) | missing/empty → `TIMEOUT_MISSING` (no default — timeouts are explicit); non-positive or non-integer → `TIMEOUT_MALFORMED`; both refuse the start | no | `src/lib/rail-connectivity/configuration.ts` |
| `PAYSWAP_RAIL_{SCOPE}_{RAIL}_RETRY_MAX_ATTEMPTS` (DEP-005; optional) | the rail-connectivity boundary's process environment | an integer 1..10 (bounded by construction) | malformed → `RETRY_MALFORMED`; above 10 → `RETRY_OUT_OF_BOUND`; default when unset: 3 (the documented `DEFAULT_RETRY_MAX_ATTEMPTS`) | no | `src/lib/rail-connectivity/configuration.ts` |
| `PAYSWAP_RAIL_{SCOPE}_{RAIL}_RETRY_BACKOFF_BASE_MS` (DEP-005; optional) | the rail-connectivity boundary's process environment | a positive safe integer (the exponential-backoff base; the schedule caps at 4000 ms) | malformed → `RETRY_MALFORMED`; default when unset: 250 (the documented default) | no | `src/lib/rail-connectivity/configuration.ts` |

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
| rail adapter credentials (banks, PSPs, mobile money, blockchains) | `external-rail-adapters` | LANDED with DEP-005: the credential REFERENCE names (`PAYSWAP_RAIL_{SCOPE}_{RAIL}_CREDENTIAL_REF` — see the current-values table above); the credential VALUES and their secret-store dereference remain FUTURE-WORK at the externalized production binding (production secret scope only) |
| observability endpoints | deployment binding (DEP-002+) | FUTURE-WORK |

Rule: every new externally configurable value lands WITH its component's work item, updating this document, `deploy/contracts/components.json` and `scripts/validate_deployment.py` in the same change. The table above names categories only — no values, no defaults, no credentials.

The concrete per-scope forms of the DEP-005 rail-connectivity variables (the registry's `required_configuration` for `external-rail-adapters` — the machine-checked agreement):

- `PAYSWAP_RAIL_PRODUCTION_{RAIL}_HOST` / `PAYSWAP_RAIL_PRODUCTION_{RAIL}_CREDENTIAL_REF` / `PAYSWAP_RAIL_PRODUCTION_{RAIL}_TIMEOUT_MS` (all three REQUIRED for every declared production rail)
- `PAYSWAP_RAIL_SANDBOX_{RAIL}_HOST` / `PAYSWAP_RAIL_SANDBOX_{RAIL}_TIMEOUT_MS` (required for every declared sandbox rail; the sandbox credential reference is optional — F5)

## Verification

`python3 scripts/validate_deployment.py` (from the repository root) checks that this document states the exact runtime allowlist `sandbox | production` and documents `PAYSWAP_ENV`, in agreement with `src/lib/environment.ts`, `spec/deployment/environments.md` and `deploy/contracts/components.json`. Since DEP-005 it also machine-checks the rail-connectivity configuration agreement: the `PAYSWAP_RAIL_{SCOPE}_{RAIL}_*` pattern names stated here match the `external-rail-adapters` component's `required_configuration` in the registry, and the resolver's variable templates (`src/lib/rail-connectivity/configuration.ts`) agree with both. Execution evidence is recorded in the DEP-001 and DEP-005 completion reports; the behavioral evidence (shape validation, fail-closed loading, scope isolation, reference-only credentials) is `scripts/test_rail_connectivity.mjs`.
