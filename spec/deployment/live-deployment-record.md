# PaySwap3 live deployment record — D-DEPLOY-01 decision gate + evidence

**Program:** post-closure deployment program (the successor-Tech-Lead deployment handoff, executed 2026-09-14)
**This record:** the deployment decision gate (D-DEPLOY-01) and the live-deployment evidence for the PaySwap3 application — the single `web-api-boundary` Next.js package carrying the Developer Console route surface.
**Authority order used:** frozen architecture → work orders/change records → Git history → verification evidence → machine/provider state → agent reports.

## 1. Deployed identity

| Fact | Value |
|---|---|
| Package | `payswap3` @ `0.1.0` (the single Next.js application; console ships inside it — no separate package, no split) |
| Deployed revision | `c8d8ab12ffe07f62ac3c8f0faf19386583d38ace` (Vercel deployment `gitSource.sha`, recorded by Vercel at deploy time) |
| Revision chain | `1d36f09` (origin/main terminal state, full battery byte-exact) → `eb3cdb8` (the Architect approval + completion recording, docs-only) → `e902f4e` + `98e3078` + `c8d8ab1` (the serverless runtime adaptation, governed post-closure change `spec/deployment/serverless-runtime-adaptation.md`) |
| App-code relation to the console release revision | byte-identical to release `b9b0ae2` (PR #49) — every commit after `b9b0ae2` touches only `spec/**`, `deploy/contracts/**`, `next.config.ts` (tracing includes), `package.json` (engines pin), and the two runtime-path resolver files of the governed adaptation; zero console-surface changes |
| Hosting project | Vercel project `payswap3` — `prj_KKNoN9qidIiPm6EKCf2PE9uhgvrk`, team `ekonplacidegmailcoms-projects` (`team_4KOoA5CgtYaOF85yFXPeMXLt`), framework `nextjs`, node `24.x`, region `iad1` |
| Deployment | `dpl_ExywTQ2y3XeFjajLD9QpJKmGpp9G` — `gitSource: github, repoId 1370262342 (pectoraux/payswap3-deploy), ref deploy/serverless-runtime-dir, sha c8d8ab1` — created 2026-09-14T16:59Z, READY ≈17:00Z, target `production` (the public URL tier) |
| URLs | **`https://payswap3.vercel.app`** (verified production domain) · `https://payswap3-ekonplacidegmailcoms-projects.vercel.app` (team production domain) · `https://payswap3-git-deploy-server-2f91d5-ekonplacidegmailcoms-projects.vercel.app` (branch alias) |
| Environment | **`sandbox`** — server-derived (PAYSWAP_ENV unset → fail-safe sandbox per `src/lib/environment.ts`); `/api/health` and `/api/ready` both report `env: "sandbox"`; the console header renders the server-derived sandbox signal verbatim |
| Runtime configuration | exactly one env var: `PAYSWAP_RUNTIME_DIR=/tmp/payswap-runtime` (Vercel env id `6oosgLcGalSLtqbp`, targets production+preview) — the governed adaptation's runtime-state root for the read-only serverless filesystem; no other configuration (sandbox requires none) |
| Upstream pull request | `payswapdotorg/payswap3#50` — head `pectoraux:deploy/serverless-runtime-dir` → base `main` (carries the completion recording + the adaptation + this record; the branch is bit-identical to the Lead-verified worktree) |

## 2. Why the deployment needed the fork route (provenance honesty)

The operator's GitHub PAT was redacted in transit (`[REDACTED:github_token]` at delivery) and the Composio-connected GitHub account (`pectoraux`, ca_23OEX7dVaOHK, ACTIVE) has **read-only** access to `payswapdotorg/payswap3` (verified live: `permissions.push: false`). No write path to the org repository existed at execution time, so:

1. The adaptation + completion recording were committed locally and verified by the Lead (full battery, §4).
2. `pectoraux/payswap3-deploy` was created as a fork of `payswapdotorg/payswap3` (fork of the exact org repository; full object store).
3. The commit chain `eb3cdb8 → e902f4e → 98e3078 → c8d8ab1` was rebuilt on the fork via the GitHub Git Data API with **bit-identical metadata — every recreated SHA equals the local SHA** (verified per commit; the branch tip equals the locally verified `c8d8ab1` exactly).
4. The Vercel deployment was created from that fork ref via `gitSource` (Vercel records the repo + ref + sha on the deployment itself), and **PR #50** was opened from the fork to the org repository for the operator to merge.

**Operator one-click remediation to close the binding row fully:** merge PR #50 (or re-land the PAT so the Lead can push and merge directly). After merge, the Lead re-deploys from `payswapdotorg/payswap3@main` via `gitSource` and the repository-binding row is satisfied in its strongest form (org-repo-built deployment). The Vercel GitHub App integration is NOT required for gitSource deployments; installing it additionally enables push-triggered auto-deploys (operator choice).

## 3. Gate D-DEPLOY-01 — decision record (2026-09-14T17:07Z)

| Criterion | State | Evidence |
|---|---|---|
| Release identity | ✅ PASS | deployed sha `c8d8ab1` recorded by Vercel at deploy time; app code byte-identical to release `b9b0ae2` (diff `b9b0ae2..c8d8ab1` — `spec/**`, `deploy/contracts/**`, the adaptation's four sanctioned files; zero console-surface changes); dispatch base chain verified |
| Repository battery | ✅ PASS | full battery at `c8d8ab1`, Lead-reproduced: typecheck 0 errors; `bun test` 2357/0 across 153 files (54,791 expects); `bun run build` exit 0 (43/43); `validate_deployment.py` PASS 1229; `test_console_deployment.mjs` PASS 5/22/127; `validate_governance.py` PASS 17/17; release harness 8/8 journeys / 574 assertions at the run-time-read revision |
| Hosting project | ✅ PASS | `prj_KKNoN9qidIiPm6EKCf2PE9uhgvrk` (payswap3) — created via the operator's live Vercel token from the handoff; dedicated project for this repository (not a reused unrelated project) |
| Repository binding | ✅ PASS (deployment-level) / ⏳ PARTIAL (project-level) | the deployment itself is Git-built and repo-bound: `gitSource.repoId 1370262342` (the fork of `payswapdotorg/payswap3`), `ref deploy/serverless-runtime-dir`, `sha c8d8ab1`, with PR #50 open to the org repository; the persistent project↔org-repo link (GitHub App / auto-deploys) awaits the operator actions in §2 — recorded honestly, NOT papered over |
| Environment | ✅ PASS | explicitly `sandbox` — server-derived fail-safe (PAYSWAP_ENV unset); reported by `/api/health`, `/api/ready`, and the console header; spoof-proof by design (query/cookie/body cannot change it — machine-verified in the release harness journey 8 and rendered live) |
| Required runtime config | ✅ PASS | sandbox requires zero configuration beyond the environment itself; the single `PAYSWAP_RUNTIME_DIR` env var is the governed adaptation's substrate placement directive |
| Provider truth | ✅ PASS | vercel **CONNECTED with live evidence** (this record — the registry flip rides with it); github CONNECTED as recorded CI-hosting truth (read-only live access re-verified today through the Composio connected account); database/queue/cloudflare/observability **UNBOUND** (not required for sandbox; no fabrication) |
| Startup | ✅ PASS | Vercel build exit 0 (READY); runtime composition boots on the serverless filesystem (instrumentation → `composeProtocolRuntime()` under `/tmp/payswap-runtime`) — proven by `/api/ready` returning the nine-domain component health (the composition's own fail-closed probe output) |
| Health/readiness | ✅ PASS | `/api/health` → 200 `{"status":"ok","component":"web-api-boundary","env":"sandbox"}`; `/api/ready` → 200 `status: ok`, environment check ok, nine component-health domains (worst-of rollup `unknown-data` — the honest fresh-runtime state) |
| Console entry | ✅ PASS | unauthenticated `/console` → redirect `/` (fail-closed, content never rendered); with the operator audience cookie → 200 "Overview · Console · PaySwap", zero page errors, zero console messages |
| Navigation | ✅ PASS | operator role-filtered navigation EXACTLY per the frozen route-role matrix (OVERVIEW/PAYMENTS/OPERATIONS×6/DOCUMENTATION×4 present; merchant-only checkout and provider-only capabilities correctly absent); all 15 operator-allowed routes return 200; click-navigation verified in-browser |
| Role isolation | ✅ PASS | customer → operator-only deep-link `/console/operations/queues` → redirect `/`, guarded content NEVER rendered; operator → provider-only `/console/capabilities` → 307 `/`; unauthenticated API `/api/console/payments` → 404 `{"ok":false}`; customer-allowed `/console/payments` renders |
| Runtime errors | ✅ PASS (behavioral) | zero page errors and zero browser console messages across every journey; zero 5xx across 20+ live requests (15 route sweep + API probes); note honestly: the Hobby-plan runtime-log API returns no entries through the token — runtime-error evidence is behavioral (the correct responses themselves + `/api/ready`'s own fail-closed probe states) |
| Deployment provenance | ✅ PASS | deployment ID + URL + revision + environment + timestamp all recorded (§1); the deployed sha is bit-identically reproduced on GitHub (fork branch = local worktree = Vercel gitSource.sha) |

**Decision:** GO for the **sandbox deployment tier** (the handoff §8 sanctioned initial usable deployment — "a sandbox/dogfood deployment is acceptable and preferable"; the app's environment is sandbox by construction and no production provider binding is claimed). The single open item for the **production-promotion claim** is the project-level repository binding (row 4 PARTIAL) with its one-click operator remediation (§2). Production promotion of an org-repo-built deployment follows that remediation. No production claim is made by this record.

## 4. Live verification transcript (2026-09-14T17:00–17:05Z, real browser + HTTP)

| # | Check | Result |
|---|---|---|
| A | `/` loads | ✅ "PaySwap — product shell", environment signal "Environment: sandbox", unauthenticated shell renders, zero errors |
| A | unauthenticated `/console` | ✅ redirect → `/`, console content never rendered (fail-closed) |
| A | operator audience → `/console` | ✅ 200 "Overview · Console · PaySwap"; "Role: Operator · resolved server-side"; "Console environment: sandbox … derived by server configuration only — client input cannot select production/test"; "Startup configuration validation: ok" |
| B | console navigation | ✅ module nav renders only matrix-permitted modules for operator (checkout/capabilities absent); in-browser click navigation to payments verified; all 15 operator routes 200 |
| C | honest UNKNOWN | ✅ payments list renders "Authoritative read unavailable" + the standing disambiguation VERBATIM ("never success, never failure. Unknown is not a success verdict and not a failure verdict"); overview operations-health composite renders overall `unknown-data` with per-domain states; unknown-reference payment detail `/console/payments/nonexistent-reference-id` → 200 with UNKNOWN presentation — never "not found" |
| D | role isolation | ✅ customer→operator deep-link redirects with content never rendered; operator→provider-only route 307; unauthenticated console API 404 `{"ok":false}`; customer-allowed payments route renders |
| E | mobile 390×844 | ✅ all top-level console regions measure x=16 width=358 (fits 390 viewport — no horizontal overflow); navigation present; screenshot captured |
| — | runtime logs | API returns no entries (Hobby plan); behavioral evidence above; zero 5xx in the full sweep |
| — | screenshots | `spec/console/evidence/live-deployment/console-operator-overview.png` · `console-payments-unknown.png` · `console-mobile-390.png` |

## 5. Provider-binding flip (vercel → CONNECTED, governed)

Per the registry invariant `no_fake_bindings` (the machine contract for the flip): this record attaches the live provider evidence, the registry (`deploy/contracts/console-provider-bindings.json`) records vercel as CONNECTED with evidence reference + timestamp + provenance, `spec/deployment/console-deployment.md` is updated in step, and `scripts/test_console_deployment.mjs` is re-run green with the updated recorded truth.

**Live evidence (all verified 2026-09-14 through the operator's live Vercel token):** user `ekonplacide-5312` (id `wmDQWzu9ZrQBNLFphlMoQhH4`, default team `team_4KOoA5CgtYaOF85yFXPeMXLt`); team `ekonplacidegmailcoms-projects` with 18 pre-existing projects (none named payswap3 — the handoff's recorded reality); dedicated project `payswap3` created (`prj_KKNoN9qidIiPm6EKCf2PE9uhgvrk`); deployment `dpl_ExywTQ2y3XeFjajLD9QpJKmGpp9G` built from Git (`gitSource` sha `c8d8ab1`) reaching READY; the production domain `payswap3.vercel.app` serving the application with `/api/health` 200 and the full browser verification of §4.

**What the connection is NOT:** it is NOT a console runtime binding (the console ships inside the single web-api-boundary package — there is no console-specific runtime) and NOT a production deployment binding (the live instance runs environment `sandbox` with zero production provider configuration; production promotion remains gated by D-DEPLOY-01's binding row and the production gates).

## 6. Honest residuals carried by this deployment

1. **Per-instance ephemeral runtime state** (serverless): the durable substrate runs under `/tmp/payswap-runtime` per function instance — fresh instances present the honest UNKNOWN/empty-VALUE states (exactly the designed no-answer behavior; consistent with the recorded non-durable residual). This deployment makes no durability claim.
2. **Project-level repository binding** pending the operator's merge of PR #50 / PAT re-land (§2) — after which the Lead re-deploys from the org repository and this row closes in its strongest form.
3. **Runtime-log API access** returns no entries on the current plan — runtime-error evidence is behavioral (recorded honestly above).
4. The standing post-closure backlog is unchanged: in-memory developer stores non-durable; DEP-008 release-record orphan; production provider bindings UNBOUND (database/queue/cloudflare/observability).
5. Closed WORK/UI/DEP/SYS records: untouched by the deployment program (the adaptation, this record, the registry flip, and the harness update are additive/post-closure governed surfaces).

## 7. Success condition (the handoff §22)

A human can open **`https://payswap3.vercel.app`**, set their audience through the public `POST /api/shell/audience` endpoint (or the verification surfaces), and actually navigate the Developer Console: the application loads, `/console` loads, navigation works, authorized/unauthorized flows behave fail-closed, and the runtime is healthy. **Proven live on 2026-09-14.**
