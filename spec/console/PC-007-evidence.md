# PC-007 evidence — production-like verification, evidence, and closure preparation

**Work order:** PC-007 (spec/console-work-orders/PC-007.md — the FINAL work item)
**Branch:** `pc-007/release-verification` (isolated worktree; base `901d0f902af5ed46fa9d0fa5495a5253f2626c9b` = the PC-006 finalize HEAD)
**Delivery:** 4 commits — `c58aacd` (the verification harness) + `927f97d` (the reconciliation report) + `9e4008f` (the closure record) + the evidence commit that adds this document (the exact final SHA is in the worklog entry and the merge request; the battery below ran at `9e4008f` — the delivered tree minus this document, whose addition changes no code under test)
**Owned surfaces:** `scripts/test_console_release_verification.mjs` (new), `spec/console/reconciliation-report.md` (new), `spec/console/console-closure-record.md` (new), this document (new)
**Forbidden (verified untouched):** `spec/development-state/**` (Lead-owned), `spec/system-closure/**`, `spec/work-orders/**`, `spec/system-work-orders/**`, `spec/product/closure/**`, `hardening/`, all of `src/**`, `package.json`, every existing script — `git diff --name-status 901d0f9..HEAD` is exactly the four owned files (§6)
**Companions:** `spec/console/reconciliation-report.md` (the row-by-row reconciliation), `spec/console/console-closure-record.md` (the closure package, status `AWAITING ARCHITECT APPROVAL`)

## 1. The verification battery (exact commands + exact outputs, at `9e4008fb1db080ba4ea8b43e68afef531437ebdf`)

Every command ran in the isolated worktree `/home/z/worktrees/pc-007` at the tree above. Exit codes are the shell's `$?`.

### 1.1 `bun run typecheck` — exit 0, 0 errors

```text
$ bun run typecheck
$ tsc --noEmit
(no output — 0 errors)
```

### 1.2 `bun run build` — exit 0

```text
$ bun run build
✓ Compiled successfully in 21.9s
✓ Generating static pages using 1 worker (43/43) in 418.8ms
Route (app) … ~72 route entries emitted (25 console page routes + 10 console API routes among them)
○ (Static) prerendered as static content / ƒ (Dynamic) server-rendered on demand
```

The standalone output is present (`.next/standalone/server.js`) — the runtime package the release harness boots.

### 1.3 `node scripts/test_console_release_verification.mjs` — exit 0 (the 8 journeys)

Stderr summary (the human transcript):

```text
release:revision-and-package: PASS (3 scenarios / 5 assertions)
release:boot: PASS (2 scenarios / 3 assertions)
release:journey-1-customer-payments: PASS (3 scenarios / 15 assertions)
release:journey-2-merchant-checkout: PASS (3 scenarios / 10 assertions)
release:journey-3-provider-capabilities: PASS (3 scenarios / 7 assertions)
release:journey-4-operator-operations: PASS (4 scenarios / 95 assertions)
release:journey-5-role-isolation: PASS (4 scenarios / 373 assertions)
release:journey-6-developer-controls: PASS (8 scenarios / 42 assertions)
release:journey-7-documentation-links: PASS (3 scenarios / 11 assertions)
release:journey-8-environment-separation: PASS (5 scenarios / 13 assertions)
```

The final stdout verdict line, verbatim (the release record — revision read at RUN TIME):

```json
{"type":"console-release-verification-verdict","passed":true,"proves":"local-composed-app-smoke-on-exact-revision","production_proof":false,"harness":"scripts/test_console_release_verification.mjs","journeys_total":8,"journeys_failed":0,"journey_results":[{"journey":"release:journey-1-customer-payments","result":"PASS"},{"journey":"release:journey-2-merchant-checkout","result":"PASS"},{"journey":"release:journey-3-provider-capabilities","result":"PASS"},{"journey":"release:journey-4-operator-operations","result":"PASS"},{"journey":"release:journey-5-role-isolation","result":"PASS"},{"journey":"release:journey-6-developer-controls","result":"PASS"},{"journey":"release:journey-7-documentation-links","result":"PASS"},{"journey":"release:journey-8-environment-separation","result":"PASS"}],"groups_total":10,"groups_failed":0,"assertions_total":574,"release_revision":{"commit":"9e4008fb1db080ba4ea8b43e68afef531437ebdf","tree":"60b81456caca735543128bb59b75ac24c9941c5e","read_at_run_time":"git rev-parse HEAD / HEAD^{tree} — never hand-written","dispatch_base":"901d0f902af5ed46fa9d0fa5495a5253f2626c9b"},"package_identity":{"name":"payswap3","version":"0.1.0"},"environment_kind":"sandbox","server":{"port":45269,"pid":11299,"bound":"127.0.0.1 (loopback only — no external host is ever contacted)","runtime_state":"fresh (var/web-runtime removed before boot — the no-answer paths are the injected unavailable-authority cases)","built_during_run":false,"stopped":true},"wall_ms":3665,"limits":"local loopback smoke of the composed repository application at the run-time-read revision; NOT a production deployment claim, NOT a provider-binding claim (owned by scripts/test_console_deployment.mjs); the Lead re-run at merged main is the release proof"}
```

(10 groups / 38 scenarios / 574 assertions / 0 failures; the booted server was SIGTERMed by the harness — `stopped: true` — and no server process survives the run: `ps` shows none.)

### 1.4 `bun test` — exit 0, the exact baseline

```text
$ bun test
 2342 pass
 0 fail
 54770 expect() calls
Ran 2342 tests across 151 files. [1.72s]
```

The exact recorded post-PC-005/006 baseline — zero new failures introduced by PC-007 (PC-007 touches no `src/**` file; the new harness is a `scripts/test_*.mjs` battery, not a bun test).

### 1.5 `python3 scripts/validate_deployment.py` — exit 0

```text
  environments: development, test-ci, sandbox, staging, production
  runtime allowlist: PAYSWAP_ENV in ['production', 'sandbox'] (fail-safe: sandbox)
  checks performed: 1229
  result: PASS
```

### 1.6 `node scripts/test_console_deployment.mjs` (PC-006 harness, unchanged) — exit 0

```json
{"type":"console-deploy-verdict","passed":true,"groups_total":5,"groups_failed":0,"scenarios_total":22,"assertions_total":127,"proves":"repository-facts-only","production_proof":false,"harness":"scripts/test_console_deployment.mjs"}
```

### 1.7 `python3 scripts/validate_governance.py` — exit 0

```text
RESULT: PASS — 17 authority paths validated (17 present, 0 sibling-wave pending), 0 errors
```

**Battery summary: 7/7 PASS.** (`scripts/test_production_readiness.mjs` was NOT run as a battery item and is NOT a PC-007 gate; the recorded known base-failure signature — the DEP-008 release-record orphan `proof:release-identity #32` — remains a named post-closure residual with an owner, carried in the closure record's residual list unchanged.)

## 2. The release harness — what it proves and how (the §16 classes 3+5 smoke)

### 2.1 Design

`scripts/test_console_release_verification.mjs` follows the `scripts/test_*.mjs` convention (plain Node, zero npm dependencies, auto-enumerated into `run_ci_gates.mjs` gate 5 by the glob): one JSON record per scenario on STDOUT, group records, a human transcript + all timing on STDERR, a final verdict line on STDOUT, exit 0 iff every group passed, fail-closed on every missing input (no build output, a server that never boots, a failed journey).

- **Exact-release discipline (the `test_system_closure.mjs` precedent):** the revision is read at RUN TIME (`git rev-parse HEAD` / `HEAD^{tree}`) and the dispatch base is verified as an ancestor — the release revision is wherever the harness RUNS. The worker-branch run is the CANDIDATE proof; the Lead's re-run at merged `main` is the RELEASE proof. Package identity (`payswap3` @ `0.1.0`) is read from `package.json` at run time.
- **The BUILT app, not the dev server:** `bun run build` first when no standalone output exists, then `node .next/standalone/server.js` on an ephemeral loopback port (acquired via a `net` listen(0) probe), static assets copied beside the traced server per the packaging contract, `PAYSWAP_ENV` deleted from the server env (the fail-safe chain resolves sandbox — deterministic regardless of the ambient environment), `/api/health` awaited to 200, the PID recorded, the server SIGTERMed in a `finally` (killed even when a journey fails).
- **Unavailable-authority injection (the work order's rule):** the composed runtime's SQLite stores (`var/web-runtime`) are removed before boot — a FRESH runtime with NO seeded data, so the natural no-answer paths ARE the injected cases: the payments list/detail no-answer (A15 chain holds no intents), and the value/unknown disambiguation is proven BOTH ways live (payments no-answer ⇒ UNKNOWN panel; checkout sessions and capabilities ANSWERING ⇒ legitimate empty VALUEs — an empty collection is never dressed up as UNKNOWN, and a no-answer is never dressed up as an empty list).
- **Role cookies:** every authenticated probe carries `Cookie: payswap-shell-audience=<role>` — the SHELL_AUDIENCE_COOKIE mechanism (`src/lib/navigation.ts` + `src/lib/shell-audience-server.ts`) the PC-001/PC-003 smoke evidence and the SYS-001 transport-binding harness used; the server resolves the role server-side, never from the URL.
- **Loopback-only confinement:** every URL is constructed against `http://127.0.0.1:<port>`; no external host is ever contacted; the verdict records `production_proof: false` by construction.

### 2.2 The 8 journeys (probes → assertions → results)

| # | Journey | Probes (role) | Decisive assertions | Result |
|---|---|---|---|---|
| 1 | Customer payment/activity visibility | GET `/console`, GET `/console/payments`, GET `/console/payments/ps_pc007_unknown_probe` (customer) | 200s; principal + environment render; the fresh-runtime payments read renders the UNKNOWN unavailable panel (value branch NOT rendered; no FAILED/SUCCEEDED chip; the authority note renders); the unknown-reference detail renders UNKNOWN — never a "not found" business verdict | **PASS** (3/15) |
| 2 | Merchant payment + checkout visibility | GET `/console/payments`, GET `/console/checkout/sessions`, GET `/console/checkout/test` (merchant) | same honest UNKNOWN for payments; the sessions read renders the VALUE branch with the empty-collection panel (the port ANSWERED — an empty list is a legitimate VALUE, the unavailable panel does NOT render); the checkout test surface renders its environment panel | **PASS** (3/10) |
| 3 | Provider capability visibility | GET `/console/capabilities`, GET `/console/accounts/providers` (provider) | the registry VALUE branch renders; the empty registry renders as the honest VALUE with the no-inference rule stated; every rendered status is frozen six-status vocabulary; the provider accounts projection renders | **PASS** (3/7) |
| 4 | Operator operations/UNKNOWN/recovery/reconciliation | GET `/console` + all six `/console/operations/*` (operator) | the role-scoped health summary renders with ALL NINE taxonomy domains; every health state is `ok\|degraded\|unknown-data\|down` verbatim; every status chip is six-status vocabulary; every operations page renders its domain view + the honest module-gap panel; the unknown view preserves UNKNOWN-case semantics | **PASS** (4/95) |
| 5 | Role/deep-link isolation | the FULL matrix sweep: 26 registry page routes × 5 roles (130 cells), unauthenticated probes, 8 representative API denials | 53 allow cells → 200 + the guarded shell renders; 77 deny cells → redirect to `/` and the guarded content NEVER renders; unauthenticated → redirect from every probed surface; API denials → 404 `{ok:false}` with no content | **PASS** (4/373) |
| 6 | Developer credential/webhook/logging paths | GET the 5 developer pages; POST/GET/DELETE `/api/console/developers/api-keys`; POST/GET/DELETE `/api/console/developers/webhooks`; GET `/console/developers/logs` + `/request-inspector` (merchant) | the plaintext secret renders exactly ONCE (creation response, `payswap_dev_` prefix) and appears in NO later read (list JSON, list page, audit trail, request logs, inspector); explicit audited revocation (audit entries render secret-free); double-revoke fails closed 409; the webhook signing secret (`payswap_whsec_`) treated identically; the request-log ring renders payload-free — not even the created key's LABEL appears | **PASS** (8/42) |
| 7 | Documentation links | GET the 4 `/console/documentation/*` pages (customer); every internal `href` extracted from the rendered HTML re-fetched | all four pages 200; every internal href resolves to a real route (200, or a redirect whose target resolves) — zero dead links; a real link surface exists (≥10 unique internal hrefs) | **PASS** (3/11) |
| 8 | Environment separation | GET `/console` baseline vs `?env=production` vs spoofed `payswap-env`/`PAYSWAP_ENV` cookies; GET `/console/developers/environments?env=production`; GET `/console/checkout/test?env=production`; POST create key with `?env=production` + body `environment:'production'` | the server-derived environment label renders; the reported environment kind is IDENTICAL with and without every spoof attempt; the environments page renders the no-switching statement; the created key stays scoped to the server-derived `sandbox` despite query+body spoof attempts | **PASS** (5/13) |

### 2.3 Fail-closed behavior (proven, not proclaimed)

An intermediate harness run during development (before three assertion-shape fixes: the empty-registry capability value, the summary-view domain markers, and the read-envelope JSON nesting) produced `journeys_failed: 5` and **exit 1** — the verdict line recorded the failing journeys and the process still killed the server. A failing journey is a FAILURE, never a silent pass. The three fixes were assertion-shape corrections (matching the actual honest UI markers), not weakening: each fixed assertion still proves the same design requirement.

### 2.4 Recorded deviations from precedent (deliberate)

1. **Stdout byte-determinism:** the PC-006 harness keeps stdout byte-deterministic (timing on stderr only). The PC-007 work order REQUIRES the verdict record to carry the server port and wall time, so the final verdict line is run-scoped by design. The per-scenario and per-group records stay deterministic; all other timing/build prose lives on stderr. (The port is ephemeral by the work order's own "ephemeral port" requirement — byte-determinism of the verdict line is structurally impossible and not attempted.)
2. **The harness DOES use `fetch`** — against `127.0.0.1` only, to the server it booted itself. The PC-006 harness's no-fetch self-scan is its own repository-facts confinement; PC-007's contract is the opposite (drive the live app). The confinement that replaces it: every URL is built from the harness's own BASE constant; no external hostname appears anywhere in the source; the verdict records the loopback-only scope.
3. **A one-line closure-record amendment** (`9e4008f`, amending the scenario-count text 30→38) — no content change beyond the corrected count; the full battery was re-run at the amended HEAD (§1 transcripts are from `9e4008f`).

## 3. The reconciliation report (deliverable 2)

`spec/console/reconciliation-report.md` reconciles every consequential console view — the six design §17 rows row-by-row (object/state, owning authority, runtime boundary, durable source, UNKNOWN/recovery, evidence — each cell verified against the ACTUAL merged implementation with the owning merged SHA cited) plus the remaining consequential surfaces (overview, accounts ×4, checkout configuration/test, developers ×5, documentation ×4) — against the merged revisions PC-001 `465e2f7` … PC-006 `8a326af` + flips (the `spec/development-state/console-program-state.md` ledger), each with the live journey evidence from §2. Its §4 is the stop-condition review: **no stop condition triggered** (no unreconciled consequential field, no role leakage, no authority bypass, no protected-data exposure, no unexplained UNKNOWN semantics, no invented provider claim, no release-evidence mismatch). Its §3 is the honest residual list (carried into the closure record §4).

## 4. The closure record (deliverable 3)

`spec/console/console-closure-record.md` — the full closure package: release identity (run-time-read revision + package identity + the Lead-re-run release-proof rule), the five verification-class results (§2 above: static/conformance PASS; console contract PASS — 2342/0 suite + 54 console test files + the role matrix at three levels; integration PASS — the 8 journeys; UX PASS at the code level with the **PENDING-LEAD** post-merge browser verification placeholder; deployment PASS — PC-006 harness + validator 1229 + provider-binding truth github-only), the role-matrix verification, the residual list, the design §21 item-by-item state, and the approval block. **Status line: `AWAITING ARCHITECT APPROVAL`** — the closure rule: tests passing alone is NOT completion; completion is recorded only in the program state after the Tech Lead's reconciliation and the Architect's explicit approval. Nothing in it reopens or mutates the closed WORK/UI/DEP/SYS records.

## 5. What PC-007 deliberately did NOT do

- Did NOT touch `spec/development-state/` (Lead-owned), `spec/system-closure/`, `spec/work-orders/`, `spec/system-work-orders/`, `spec/product/closure/`, `hardening/`, `src/**`, `package.json`, or any existing script (all read-only; the diff in §6 proves it).
- Did NOT merge, push, or mark the program complete; did NOT claim production deployment, provider connection, or readiness; did NOT fix the DEP-008 release-record orphan (recorded, owned, retained); did NOT invent any provider or authority claim.
- Did NOT widen any role cell, environment path, or data surface — the harness only OBSERVES the frozen surface.

## 6. The owned diff (proof of confinement)

```text
$ git diff --name-status 901d0f9..HEAD
A  scripts/test_console_release_verification.mjs
A  spec/console/PC-007-evidence.md
A  spec/console/console-closure-record.md
A  spec/console/reconciliation-report.md
```

Exactly the four owned deliverables — 0 modifications to any existing file. Commit list: `c58aacd` (harness) → `927f97d` (reconciliation report) → `9e4008f` (closure record, includes the scenario-count amendment) → the evidence commit (this document).

## 7. For the Tech Lead (the closure chain, per the work order)

1. Verify this candidate against Git/tests/repository (the battery in §1 re-runs at any tree; every claim in §2–§4 cites a machine-checkable source).
2. Governed merge of the branch; then **re-run `node scripts/test_console_release_verification.mjs` at merged `main`** — that run is the RELEASE proof (the verdict line re-reads the revision at run time; the worker-branch verdicts in this document are the CANDIDATE proof).
3. Perform the post-merge browser verification (the PENDING-LEAD placeholder in the closure record Class 4) and record it.
4. Reconcile the closure record + reconciliation report (residual list included) and request the Architect's explicit approval.
5. Only after that approval: update `spec/development-state/console-program-state.md` (Lead-owned) with the PC-007 merge fact and the completion recording.
