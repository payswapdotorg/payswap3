# PC-006 evidence — deployment and provider-binding contract

**Work order:** PC-006 (spec/console-work-orders/PC-006.md — deployment and provider-binding contract)
**Status:** DELIVERED (implementation worker, finisher of the shutdown-interrupted predecessor)
**Dispatch base:** `main` @ `09681dda20dfa53d31c81cf96828944763e30b01` (PC-001..PC-005 all merged, registry 26/26 available, suite 2342/0)
**Candidate revision:** branch `pc-006/deployment-provider-binding` — commits `5645455` (the contract layer) + `882632e` (the verification harness) + the evidence commit that adds this document (exact final SHA in the worklog entry and the merge request)
**Owned surfaces:** `deploy/contracts/**`, `spec/deployment/**` (console-specific additive sections only), `scripts/test_console_deployment.mjs` (new), this document
**Forbidden (verified untouched):** `scripts/validate_deployment.py` and every other existing script, `spec/system-closure/**`, `spec/system-work-orders/**`, `spec/work-orders/**`, `spec/product/closure/**`, all of `src/**`, `package.json`, `spec/development-state/**` — `git diff --name-status 09681dd..HEAD` is exactly the six owned files listed in §7
**Companions:** `spec/deployment/console-deployment.md` (the contract), `deploy/contracts/console-provider-bindings.json` (the machine registry), `scripts/test_console_deployment.mjs` (the harness), `spec/deployment/topology.md` "Contract evolution" (the PC-006 change record), `deploy/contracts/components.json` (the governed route_surface extension)

## 1. Finisher audit of the shutdown-interrupted predecessor

The predecessor (stopped by a server shutdown) left three partial files, all uncommitted. Audited against the design §15 contract, the PC-006 work order, and the existing contract conventions — verify, don't trust:

| Predecessor file | Audit verdict | Action |
|---|---|---|
| `deploy/contracts/console-provider-bindings.json` | **KEPT with one fix.** Structure sound, JSON valid, every machine-checkable fact independently verified: package identity `payswap3` @ `0.1.0` (read from `package.json`); 26 console pages + 10 console API routes on disk (filesystem walk); the 26 `CONSOLE_REGISTRY` hrefs match exactly; github `CONNECTED` with an existing evidence file; the five other providers `UNBOUND` with explicit nulls. One imprecision fixed: the github provenance said the Composio discovery was "recorded at the DEP-005 finalize" without the record chain — replaced with the exact verifiable chain (first recorded at the UI-003 reconcile `f012451` 2026-09-11 "infrastructure truth (GitHub-only) recorded"; restated at the DEP-005 finalize `663b1d4` 2026-09-12; carried through system closure 2026-09-13 into the cited evidence file `spec/system-closure/closure-record.md` and the design baseline §15). The `verification_timestamp` `2026-09-13` is the finalize date of the cited evidence file. | provenance re-written (commit `5645455`) |
| `spec/deployment/console-deployment.md` | **KEPT unchanged.** Every factual claim re-verified: the two-gate chain matches design §15 verbatim-in-structure; F1/F6/F8 citations match `spec/deployment/environments.md`; the four production configuration names match `src/lib/startup-config.ts`; the flat-route claim matches the validator's regex `/[A-Za-z0-9._/-]*` (brackets impossible); the validator claim (1194 → 1229 checks, PASS) reproduced at both base and candidate; the "33 static routes mirrored / 3 dynamic routes recorded only here" arithmetic verified against the filesystem (25 static pages + 8 static API = 33; 1 + 2 dynamic). Its forward references (the topology change record, the harness, this document) were the remaining work — delivered below. | none (delivered as-is, commit `5645455`) |
| `deploy/contracts/components.json` | **KEPT with one prose fix.** The diff is exactly three governed additions: the `update_note` append, 33 static console route entries in `web-api-boundary.route_surface`, and `src/lib/console/registry.ts` in `repository_entrypoint.paths`. The validator's locked provenance fields (`updated_by: SYS-001`, `base_sha: 46507326…`) were correctly left untouched (the validator machine-checks them and workers are forbidden from editing it — see §8). One imprecision fixed: "the frozen CONSOLE_REGISTRY hrefs … plus the /console root" suggested the root is not itself a registry href — corrected ("minus its one dynamic href `/console/payments/[paymentId]`; the `/console` root is itself a registry href"). | phrasing corrected (commit `5645455`) |

Nothing in the predecessor files contradicted the locked DEP content or invented a binding. The validator run at the audited tree: **PASS, 1229 checks** (base: 1194 — the +35 is exactly 33 route_surface entries × 1 check + 1 entrypoint path × 2 checks, reproduced by running the validator at the stashed base).

## 2. Package identity and topology (the contract, as machine-verified)

- The console ships INSIDE the ONE runtime package: **`payswap3` @ `0.1.0`** (`package.json`), build output `.next/standalone` (`next.config.ts` `output: "standalone"` — unchanged, packaging.md §1). No separate console package: zero `package.json` files under `src/app/console/`, `src/app/api/console/`, `src/components/console/`, `src/lib/console/` (harness group 1).
- No topology change: the component present-set stays the governed set of **eleven**; no component id mentions the console; the console surface extends `web-api-boundary` only — the D-1 governed-change precedent (`/api/protocol/commands`), now applied to the console surface: 25 static console page routes + 8 static console API boundary routes in `route_surface`, plus `src/lib/console/registry.ts` in `repository_entrypoint` (commit `5645455`; recorded in the `spec/deployment/topology.md` "Contract evolution" PC-006 entry).
- The 3 dynamic routes (`/console/payments/[paymentId]`, `/api/console/checkout/sessions/[checkoutId]`, `/api/console/payments/[paymentId]`) are recorded ONLY in the binding registry — the component registry's route_surface is the validator's flat static-route form, which cannot express brackets. The harness proves them against the same filesystem and registry sources (group 3).

## 3. Environment requirements (as machine-verified over the REAL frozen modules)

The console requires NO environment configuration of its own; it inherits the package's chain unchanged (harness group 2, driving the real `src/lib/environment.ts` and `src/lib/startup-config.ts`):

1. `PAYSWAP_ENV` — server process environment only; exact allowlist `sandbox | production`; unset, empty, `staging`, `PRODUCTION`, `prod`, `null` all fail-safe to **sandbox**, never to production (F1). Proven live: 8 probes over the real `getEnvironment()`.
2. `validateStartupConfig()` — sandbox: ok with exactly the environment check (the environment selection is the whole required configuration). Production: fail-closed on exactly the four named ids (`PAYSWAP_DATABASE_URL`, `PAYSWAP_QUEUE_URL`, `PAYSWAP_EVIDENCE_STORE_URL`, `PAYSWAP_RAIL_ADAPTERS_URL`); a sentinel VALUE injected into the environment never surfaces in the result (ids only — the F6/S discipline).
3. The console adds no environment input: **zero** direct `process.env` accesses in non-test console source files across `src/app/console/`, `src/app/api/console/`, `src/components/console/`, `src/lib/console/` (the environment scope is server-derived through the frozen modules only — the PC-001 no-input authority chain; `src/lib/console/environment-context.ts` wraps `describeEnvironment()`/`validateStartupConfig()` and takes no arguments).

`spec/deployment/configuration.md` is UNCHANGED by PC-006 (and by PC-001..PC-005): the console program added no externally configurable value.

## 4. Provider-binding truth (the registry, as machine-verified)

At PC-006 execution time, in the isolated PC-006 worktree: no provider access exists — no Composio tooling, no provider credentials, no ability (or permission, under the harness's own §7 confinement) to probe any provider live. Per the work order's stop-condition discipline ("record unbound providers explicitly when access is absent rather than creating fake bindings"), the recorded repository truth is carried forward unchanged and honestly:

| Provider | Status | Evidence reference | Verification timestamp | Provenance summary |
|---|---|---|---|---|
| `github` | **CONNECTED** | `spec/system-closure/closure-record.md` (exists; records "only GitHub is connected; no production deployment binding exists") | `2026-09-13` (the cited record's Lead-finalize date) | the Composio discovery recorded at `f012451` (2026-09-11), restated at the DEP-005 finalize `663b1d4` (2026-09-12), carried through system closure (`spec/development-state/system-program-state.json` rtnWave note + deploymentProgress + postClosure.residualLedger) into the design baseline §15 (2026-09-14). CI-hosting truth ONLY — NOT a console runtime binding, NOT a production deployment binding. |
| `vercel` (runtime host) | **UNBOUND** | null (explicit) | null | no account, project, deployment or domain exists in any repository record |
| `database` | **UNBOUND** | null | null | the in-process SQLite substrate is the composed realization; the externalized binding is DEP-002+ FUTURE-WORK |
| `queue` | **UNBOUND** | null | null | same — the externalized queue binding is DEP-002+ FUTURE-WORK |
| `cloudflare` | **UNBOUND** | null | null | recorded unbound at the design baseline; no zone, account or record exists |
| `observability` | **UNBOUND** | null | null | the externalized telemetry binding is DEP-002+ FUTURE-WORK |

**Honesty enforcement (machine, harness group 4):** the closed six-provider set, each exactly once; CONNECTED ⇒ an EXISTING evidence file whose content records the connection truth, an ISO-date verification timestamp, a non-empty provenance, and a requirement bounding the claim; UNBOUND ⇒ null evidence fields plus a requirement naming live provider evidence as the precondition for any production claim; the status vocabulary is exactly `CONNECTED | UNBOUND`; the registry's six invariants are present. Negative probes (temporary mutations, all restored, exit 1 each): a faked `vercel` CONNECTED; a CONNECTED entry without an evidence reference; an UNBOUND entry carrying an evidence reference — all fail closed. The harness verifies the honesty of the RECORDED state, never the liveness of a provider.

Flipping any UNBOUND provider to CONNECTED is a governed change that attaches live provider evidence from the operator (evidence reference + timestamp + provenance), updates the registry, `spec/deployment/console-deployment.md` and this document, and re-runs the harness.

## 5. The verification harness (`scripts/test_console_deployment.mjs`)

The `scripts/test_*.mjs` convention — plain Node, zero npm dependencies, auto-enumerated by glob into `run_ci_gates.mjs` gate 5 (`harnesses`). One JSON record per scenario on STDOUT, group records, a human table and a final verdict line; exit 0 iff every group passes; fail-closed on missing inputs (a deleted binding registry produced exit 1 with the named ENOENT inside its group). Stdout is byte-deterministic (verified: identical bytes across repeated runs AND across build-output-absent vs build-output-present states — the manifest probe and all timing live on stderr only, the ci-cd.md §2 discipline).

| # | Group | Scenarios / assertions | Proves |
|---|---|---|---|
| 1 | `console-deploy:package-identity` | 4 / 10 | exact package identity vs the recorded contract; no console package manifest; standalone output unchanged; no console component (present-set stays 11) |
| 2 | `console-deploy:environment-configuration` | 5 / 31 | the fail-safe chain over the REAL frozen modules (incl. the sentinel-value never surfacing); zero direct env access in non-test console source; the recorded chain text names the four ids |
| 3 | `console-deploy:route-availability` | 5 / 22 | filesystem ⇔ binding registry ⇔ `CONSOLE_REGISTRY` ⇔ components.json static set, both ways; the 3 dynamic routes; the build app-path-routes manifest (keys normalized — trailing `/page`//`/route` and route-group segments stripped) carries every console route when a build output is present |
| 4 | `console-deploy:provider-binding-honesty` | 5 / 51 | §4 above |
| 5 | `console-deploy:repository-deployment-separation` | 3 / 13 | the separation invariant on every contract surface; the static self-scan; the verdict record asserted before printing |
| | **TOTAL** | **22 / 127** | **PASS** |

**How the harness proves repository facts only (the §7 confinement, mechanically):**

1. **No network access.** The harness statically scans its own source for the six network primitives of `console-deployment.md` §7.1 (`node:http`, `node:https`, `node:net`, `node:dns`, `fetch(`, `connect(` — constructed token-wise in the scanner so its own source cannot contain the literals) and fails closed if any is present. It cannot probe, ping or fetch any provider.
2. **No provider liveness verification.** Group 4 checks the honesty of the RECORDED state only; the recorded CONNECTED entry (github) carries its own disclosure that PC-006 re-reads recorded truth and does not re-verify the live connection.
3. **No production vocabulary.** The verdict record is constructed BEFORE the groups run and its confinement fields are asserted as checked inputs (not prose printed after the fact): `"proves":"repository-facts-only"`, `"production_proof":false`. The final stdout line states: no route is claimed deployed, no provider is claimed serving, no production readiness is inferred; the provider-binding gate stays above this harness.
4. **Route availability is repository availability.** The registry's `route_availability_note` (a checked input) states that route availability at PC-006 means source + registry + (when present) build-manifest presence — never a claim that any route is deployed or serving traffic anywhere.

## 6. The retained production-readiness known-failure note

`node scripts/test_production_readiness.mjs` at the candidate tree retains EXACTLY the recorded known base-failure signature (the DEP-008 release-record orphan post-closure residual — a named residual with an owner, recorded in `spec/development-state/system-program-state.json` postClosure.residualLedger; the release record freezes revision `ed673d7`, orphaned by PR #39's squash-merge). Verdict line (stdout):

```json
{"type":"proof-verdict","passed":false,"groups_total":10,"groups_failed":4,"scenarios_total":39,"assertions_total":230,"stop_conditions_triggered":3,"release_record_id":null,"release_revision":null,"harness":"scripts/test_production_readiness.mjs"}
```

Root cause (stderr): `[proof:release-identity] assertion #32 FAILED: the recorded revision is an ancestor of the proof tree HEAD` — the release record's frozen revision is not an ancestor of the current tree; the other three failed groups (`proof:config-secret-safety`, `proof:external-effect-safety`, `proof:rollback-observability`) fail CLOSED on the unavailable release record (the fail-closed cascade, not new defects). All six real protocol groups pass. **The harness was NOT modified by PC-006** (read-only, per the owned-files contract); PC-006 records its continued presence as baseline evidence and does not attempt a fix (the disposition is "a fresh promote.mjs record requires a fully-green readiness tree — disposition at next governance touch", owned by the Lead).

## 7. Verification transcript (the finisher battery, branch tip after the harness commit)

| # | Command | Result (exact) |
|---|---|---|
| 1 | `bun run typecheck` | exit 0 — `tsc --noEmit`, 0 errors |
| 2 | `python3 scripts/validate_deployment.py` | `checks performed: 1229` / `result: PASS` (base 09681dd: 1194 / PASS — reproduced by stashing the change; +35 = 33 route_surface entries + 2 entrypoint checks) |
| 3 | `node scripts/test_console_deployment.mjs` | exit 0 — verdict `{"passed":true,"groups_total":5,"groups_failed":0,"scenarios_total":22,"assertions_total":127,"proves":"repository-facts-only","production_proof":false,…}`; run once build-absent and once build-present (manifest carried all 36 console routes — 26 pages + 10 API — after key normalization): stdout byte-identical |
| 4 | `bun test` | `2342 pass / 0 fail` — 54770 expect() calls across 151 files (exactly the PC-005 baseline; PC-006 added no bun-test file) |
| 5 | `bun run build` | exit 0 — `✓ Compiled successfully`, 43/43 static pages, standalone output; the app-path-routes manifest carries all 36 console routes |
| 6 | `node scripts/test_production_readiness.mjs` | exit 1 — the retained known base-failure signature (§6): `groups_failed: 4`, `proof:release-identity` #32 + the three fail-closed cascades; 6/6 real protocol groups PASS |

Harness quality probes (temporary mutations, all restored): 7 negative cases, all exit 1 — fake `vercel` CONNECTED; CONNECTED without evidence reference; UNBOUND with an evidence reference; a route removed from the binding registry; package version drift; the binding registry deleted; a console route deleted from the build manifest.

`git diff --name-status 09681dd..HEAD` (through the evidence commit): `deploy/contracts/components.json` (M), `deploy/contracts/console-provider-bindings.json` (A), `spec/deployment/console-deployment.md` (A), `spec/deployment/topology.md` (M), `scripts/test_console_deployment.mjs` (A), `spec/console/PC-006-evidence.md` (A) — six files, all within the owned roots; zero forbidden paths.

## 8. Recorded gaps, honest absences and Lead dispositions

1. **Validator provenance lock (Lead disposition at merge).** `scripts/validate_deployment.py` machine-checks `updated_by == 'SYS-001'` and `base_sha == 46507326…` (locked at the SYS-001 four-surface change) and PC-006 workers are forbidden from editing it. The provenance fields are intentionally left at their locked values; the PC-006 provenance lives in the components.json `update_note`, the topology.md PC-006 change record, the binding registry and this document. **For the Lead:** the validator-side provenance flip (`updated_by` → `PC-006`, and per the DEP precedent the declared base → the PC-006 dispatch base `09681dd…`) at merge time completes the governed change's fourth surface. The three worker-updated surfaces pass the locked validator as-is (1229 checks PASS).
2. **No PENDING-PC-006 cells existed.** `spec/console/reconciliation-matrix.md` carries no `PENDING-PC-006` markers (verified by search): the matrix is console-VIEW-scoped (PC-003/004/005 rows) and PC-006 adds no console view. Nothing to fill; recorded here so the absence is deliberate, not overlooked.
3. **Route availability is repository availability** (the honest limit): every console route is proven to exist in source, in the frozen navigation registry, in the component/binding contracts and — when a build output exists — in the build manifest. No route is claimed deployed anywhere.
4. **The five UNBOUND providers stay UNBOUND** until an operator connects them with live evidence (the governed flip path in §4). No production deployment binding is claimed or implied anywhere in the PC-006 surfaces.
5. **The release-identity residual** (§6) predates PC-006 and is outside its scope; PC-006 records its continued presence without touching the readiness harness.
