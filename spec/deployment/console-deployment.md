# PaySwap console deployment contract

**Work order:** PC-006 — Deployment and provider-binding contract (spec/console-work-orders/PC-006.md)
**Status:** ACTIVE (PC-006) — console-specific, ADDITIVE over the locked DEP-001..DEP-008/SYS-001 contracts; no existing deployment contract section was rewritten
**Base:** main @ `09681dda20dfa53d31c81cf96828944763e30b01` (the PC-006 dispatch base — PC-001..PC-005 all merged, registry 26/26 available, suite 2342/0)
**Owned surfaces:** the console deployment contract requirements, the console provider-binding registry, the console deployment verification harness
**Forbidden:** bypassing the existing topology; presenting repository verification as deployment verification; inventing provider bindings
**Companions:** `deploy/contracts/console-provider-bindings.json` (the machine-readable console binding registry this contract defines), `scripts/test_console_deployment.mjs` (the verification harness, glob-enumerated into the ci-cd.md §2 `harnesses` gate), `spec/deployment/topology.md` (runtime topology + the PC-006 contract-evolution entry), `spec/deployment/environments.md` (fail-closed rules F1–F8), `spec/deployment/configuration.md` (unchanged by PC-006 — the console adds no configurable value), `spec/deployment/packaging.md` (the single runtime package), `spec/deployment/ci-cd.md` (the gate battery), `spec/deployment/production-readiness.md` (the F8 hard boundary), `deploy/contracts/components.json` (the component registry whose web-api-boundary route_surface gained the static console routes), `spec/console/PC-006-evidence.md` (the delivery evidence)

## 1. Scope

This contract defines what "the developer console is deployable" means for PaySwap at the PC-006 baseline. It adds a console-specific layer OVER the existing deployment contracts — it changes no existing rule, adds no component, adds no environment, adds no configurable value, and adds no topology. The console ships as part of the CURRENT Next.js application/package; there is no separate console package, no separate console deployment, and no console-specific production path.

Design source: docs/superpowers/specs/2026-09-14-payswap-developer-console-design.md §15 (deployment contract) — this document is the repository realization of that section.

## 2. The two-gate separation

Deployment readiness is separated into two gates (design §15):

```text
Console implementation
  ↓
Repository verification
  ↓
Console deployment contract          ← this document + its registry + its harness
  ↓
Actual provider bindings             ← the gate that does NOT exist yet (§5)
  ↓
Production-like smoke/integration verification
  ↓
Production claim
```

**A green local/build/CI result proves repository correctness only. It does not prove production deployment.** Everything the PC-006 harness (`scripts/test_console_deployment.mjs`) proves is REPOSITORY evidence: package identity, contract agreement, route availability in source and build output, environment-configuration behavior of the frozen modules, and the honesty of the recorded binding state. The harness's verdict line states this itself (`"proves":"repository-facts-only","production_proof":false`), and the harness proves its own confinement mechanically (§7).

## 3. Package identity requirements

| Requirement | Contract |
|---|---|
| Single package | The console ships inside the ONE runtime package: `payswap3` @ `0.1.0` (`package.json`). Recorded in `deploy/contracts/console-provider-bindings.json` (`package_identity`) and machine-checked against `package.json` on disk. |
| No new topology | The console adds NO component to `deploy/contracts/components.json` (the present-set stays the DEP-004 governed set of eleven). The console surface extends the `web-api-boundary` component's `route_surface` — the D-1 governed-change precedent (SYS-001's `/api/protocol/commands` addition), applied to the console surface at PC-006. |
| Build output unchanged | `next.config.ts` `output: "standalone"` (packaging.md §1) carries the console pages/routes in the same standalone build; the console requires no build configuration of its own. |

## 4. Route availability and environment requirements

**Route surface.** The console route surface is the 26 console pages (`src/app/console/**/page.tsx`, including the `/console` root) plus the 10 console API boundary routes (`src/app/api/console/**/route.ts`). The 33 STATIC routes are mirrored into `deploy/contracts/components.json` `web-api-boundary.route_surface`; the 3 DYNAMIC routes (the `[paymentId]`/`[checkoutId]` segment routes) are recorded only in `deploy/contracts/console-provider-bindings.json` because the component registry's route_surface convention is the deployment validator's flat static-route form (route entries match `/[A-Za-z0-9._/-]*`), which cannot express path segments. The harness proves set-equality BOTH ways between: the binding registry, the component registry's console entries, the frozen `CONSOLE_REGISTRY` hrefs (`src/lib/console/registry.ts` — the single source of truth of the console navigation), and the filesystem; and it cross-checks the build output's app-path-routes manifest when a build output is present (mode declared honestly, the DEP-008 §3 precedent).

Route availability at PC-006 is REPOSITORY availability — every route exists in source, in the frozen navigation registry and in the build output. It is not a claim that any route is deployed or serving traffic anywhere.

**Environment requirements.** The console requires NO environment configuration of its own. It inherits the package's chain unchanged:

1. `PAYSWAP_ENV` — server process environment only; exact allowlist `sandbox | production`; unset, empty or invalid fail-safes to `sandbox`, never to `production` (F1; `src/lib/environment.ts`).
2. `validateStartupConfig()` (`src/lib/startup-config.ts`) — sandbox requires nothing beyond the environment itself; `production` requires the four named configuration names (`PAYSWAP_DATABASE_URL`, `PAYSWAP_QUEUE_URL`, `PAYSWAP_EVIDENCE_STORE_URL`, `PAYSWAP_RAIL_ADAPTERS_URL`) and fails closed, reporting ids only (F6).
3. The console's own environment scope is server-derived only (the PC-001 no-input authority chain); there is no client-side environment switching anywhere in the console, and spoofed `?env=` selectors are structurally ignored (proven by the PC-005 route/page tests).

`spec/deployment/configuration.md` is therefore UNCHANGED by PC-006 (and by PC-001..PC-005): the console program added no externally configurable value.

## 5. Provider-binding truth

The machine-readable registry is `deploy/contracts/console-provider-bindings.json`. Each provider of the closed six-provider set (design §15) records exactly one of:

- **CONNECTED** — with an evidence reference to an existing repository file that records the connection, a verification timestamp, and a provenance statement.
- **UNBOUND** — explicit, with null evidence fields and a non-empty requirement statement: live provider evidence must precede any production claim.

The recorded truth at PC-006 execution time:

| Provider | Status | Evidence |
|---|---|---|
| `github` | **CONNECTED** | the recorded Composio truth (only GitHub connected), recorded at the DEP-005 finalize and carried through system closure: `spec/system-closure/closure-record.md` + `spec/development-state/system-program-state.json` (postClosure). CI-hosting truth only — NOT a console runtime binding, NOT a production deployment binding. |
| `vercel` (runtime host) | **CONNECTED** (2026-09-14, live evidence) | `spec/deployment/live-deployment-record.md` — the post-closure deployment program's governed flip: dedicated project `payswap3`, Git-built deployment `dpl_ExywTQ2y3XeFjajLD9QpJKmGpp9G` at `c8d8ab1`, `payswap3.vercel.app` serving with browser-verified console navigation (sandbox environment). Live-hosting truth for the sandbox dogfood deployment — NOT a production deployment binding |
| `database` | **UNBOUND** | none — the in-process SQLite substrate is the composed realization; the externalized binding is DEP-002+ FUTURE-WORK |
| `queue` | **UNBOUND** | none — same |
| `cloudflare` | **UNBOUND** | none — recorded unbound at the design baseline |
| `observability` | **UNBOUND** | none — the externalized telemetry binding is DEP-002+ FUTURE-WORK |

No fake bindings: the harness verifies the HONESTY of the recorded state (connected ⇒ full evidence; unbound ⇒ explicit nulls + requirement), never the liveness of a provider. Flipping an UNBOUND provider to CONNECTED is a governed change that attaches live provider evidence from the operator (evidence reference + timestamp + provenance), updates the registry, this document and the evidence file, and re-runs the harness. The registry's invariants section is the machine contract for these rules.

## 6. Verification

`node scripts/test_console_deployment.mjs` (plain Node, zero npm dependencies, the scripts/test_*.mjs convention — auto-enumerated into `run_ci_gates.mjs` gate 5). Five proof groups:

| # | Group | Proves |
|---|---|---|
| 1 | `console-deploy:package-identity` | exact package identity (package.json name/version vs the recorded contract); single-package topology (no console package manifest, standalone output unchanged, no new component in the registry) |
| 2 | `console-deploy:environment-configuration` | the fail-safe chain over the REAL frozen modules: `getEnvironment()` unset/invalid/sandbox/production; `validateStartupConfig()` sandbox-ready and production-fail-closed with exactly the four named ids |
| 3 | `console-deploy:route-availability` | every console route (static + dynamic) exists as a source file, equals the frozen CONSOLE_REGISTRY hrefs and the binding registry, the static set equals the component registry's console route_surface entries (both ways), and the build manifest carries them when present |
| 4 | `console-deploy:provider-binding-honesty` | the closed six-provider set; CONNECTED ⇒ existing evidence file + timestamp + provenance; UNBOUND ⇒ explicit nulls + requirement; closed status vocabulary |
| 5 | `console-deploy:repository-deployment-separation` | the two-gate separation invariant stated in the registry and this document, and the harness's own confinement: a static self-scan proves it performs NO network access and NEVER verifies provider liveness — repository facts only |

Output contract: one JSON record per scenario on STDOUT (byte-deterministic at the same tree — the ci-cd.md §2 battery contract), group records, and a final verdict line; exit 0 iff every group passed; fail-closed on any missing input (a missing registry, contract file, package.json, route source or evidence file is an error, never a silent pass).

The harness must stay green in every future battery run while the recorded truth holds; it must FAIL when (a) package identity drifts from the recorded contract, (b) a console route is removed without a governed registry update, (c) a provider is marked connected without evidence, or (d) the separation invariant vocabulary is dropped from the contract surfaces.

## 7. The separation invariant (repository verification ≠ deployment verification)

The harness proves repository facts only, and it proves that confinement mechanically:

1. **No network access.** The harness statically scans its own source for network primitives (`node:http`, `node:https`, `node:net`, `node:dns`, `fetch(`, `connect(`) and fails closed if any is present. It cannot probe, ping or fetch any provider.
2. **No provider liveness verification.** The provider-binding group checks the honesty of the RECORDED state only; the recorded CONNECTED entry (github) carries its own disclosure that PC-006 re-reads recorded truth and does not re-verify the live connection.
3. **No production vocabulary.** The verdict line carries `"proves":"repository-facts-only"` and `"production_proof":false`; the registry's `repository_verification_is_not_deployment_proof` invariant is a checked input, not prose.
4. **The stop conditions hold.** Deployment evidence that cannot be obtained from the actual provider is recorded as UNBOUND (not faked); no deployment change bypasses the existing topology (none was made); no local result is presented as production proof (this section + the harness verdict state it in the machine surface).

This is the same hard boundary as production-readiness.md §1 (F8: the sandbox proves nothing about production) applied to the console deployment contract: a passing harness is a REPOSITORY statement, and the production claim remains gated behind the provider-binding gate that does not exist yet.

## 8. Future work (FUTURE-WORK — recorded, not invented here)

| Item | Status |
|---|---|
| Connecting a remaining UNBOUND provider (database/queue/cloudflare/observability) with live evidence | FUTURE-WORK — operator action; the registry records UNBOUND until then, and any production claim waits for it. (vercel was flipped to CONNECTED on 2026-09-14 by the post-closure deployment program with live evidence — the `no_fake_bindings` governed change: registry + this document + the evidence record + harness re-run green.) |
| Production deployment binding of the console (with the rest of the package) | FUTURE-WORK (DEP-002+; every `production_gate` in components.json stays authoritative) |
| Production-like smoke/integration verification against a real deployment | performed once for the sandbox tier on 2026-09-14 (`spec/deployment/live-deployment-record.md` — real-browser journeys over the live `payswap3.vercel.app` deployment); the production-promotion verification chain remains FUTURE-WORK above the provider-binding gate |
| Console-specific deployment tooling (separate console preview/staging environments) | FUTURE-WORK — no console-specific deployment exists at this baseline, by design |

## 9. Change discipline

This document is ADDITIVE over the locked DEP contracts; it rewrites none of them. Changes to the console deployment contract follow the topology.md "Contract evolution" discipline: the binding registry, this document, the harness and (when the component registry is touched) components.json + the topology change record are updated together in one governed work item. The deployment validator (`scripts/validate_deployment.py`) is worker-read-only: PC-006's route_surface extension requires no validator change (the flat-route entries pass the existing mechanical checks — the validator grew from 1194 to 1229 checks, all green), and the validator's locked provenance fields (`updated_by: SYS-001`, `base_sha: 46507326…`) are disclosed for the Lead's merge-time disposition in the components.json update_note and the topology.md change record.
