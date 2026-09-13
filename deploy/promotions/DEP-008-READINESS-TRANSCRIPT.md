# DEP-008 — Readiness verification transcript

Work order: `spec/system-work-orders/DEP-008.md` — "Production readiness proof".
Contract: `spec/deployment/production-readiness.md` (the readiness-proof
contract). This document records the REQUIRED EVIDENCE with the exact command
lines and outputs captured in the DEP-008 execution sandbox (the worker
sandbox — the same environment a fresh clone runs the gates in; no CI-only
gate exists).

- Dispatch base: `main @ a39cccf312cf55aff6321eb5e0dbbde7936f201b` (verified
  with `git rev-parse a39cccf312cf55aff6321eb5e0dbbde7936f201b^{commit}` —
  exact match; the dependency gate — DEP-006 merged (PR #37) + DEP-007 merged
  (PR #38) + the product closure candidate UI-010 merged (PR #35) — is
  satisfied at this base; the work order's stale `Status: BLOCKED` line is
  superseded by this dispatch).
- Branch: `dep-008/production-readiness-proof`.
- Toolchain: Node `v24.19.0`, bun `1.3.14`, Python `3.12.14`, git `2.50.1`.
- The delivered commits on the branch:
  - `ed673d7d220002186b1d06082b55321d58e04a38` — `DEP-008: production
    readiness proof (release freeze, ten proof groups, verification
    transcript, contract update)` — **THE RELEASE REVISION under proof**.
  - the evidence commit (this file + the promotion records for the release
    revision; append-only records can only trail the revision they freeze —
    ci-cd.md §3).

## The immutable release identifier

**Release record: `pr-1789278934747-9b83ecdc27`**

```json
{"record_id":"pr-1789278934747-9b83ecdc27","commit_sha":"ed673d7d220002186b1d06082b55321d58e04a38",
 "commit_subject":"DEP-008: production readiness proof (release freeze, ten proof groups, verification transcript, contract update)",
 "tree_digest":"35b92ab9a01f3b02902a6e7a0b77edd9d5d773bb",
 "content_digest":"9b83ecdc2756f211fb0045af2374d3bf1eb2f184820215558fff4f0ddde72ed1",
 "tracked_file_count":746,"created_at":"2026-09-13T05:55:34.747Z"}
```

Command (freezes the revision — runs a FRESH full gate battery first,
appends the record only when every gate passes):

```bash
node scripts/promote.mjs record
```

```json
{"ok":true,"action":"record","record_id":"pr-1789278934747-9b83ecdc27","commit_sha":"ed673d7d220002186b1d06082b55321d58e04a38","tree_digest":"35b92ab9a01f3b02902a6e7a0b77edd9d5d773bb","content_digest":"9b83ecdc2756f211fb0045af2374d3bf1eb2f184820215558fff4f0ddde72ed1","gates":"governance:pass deployment-contract:pass durable-contract:pass typecheck:pass harnesses:pass build:pass","appended_to":"deploy/promotions/promotion-records.jsonl"}
```

**Recorded gate table (all six green; the release-record battery):**

| gate | command | exit | wall |
|---|---|---|---|
| governance | `python3 scripts/validate_governance.py` | 0 | 29 ms |
| deployment-contract | `python3 scripts/validate_deployment.py` | 0 | 69 ms |
| durable-contract | `python3 scripts/validate_durable.py` | 0 | 38 ms |
| typecheck | `bun run typecheck` | 0 | 2 951 ms |
| harnesses | `node scripts/test_*.mjs` (17 files, glob) | 0 | 13 910 ms |
| build | `bun run build` | 0 | 30 396 ms |

**Record re-verification (the recorded revision re-proves itself end to
end):**

```bash
node scripts/promote.mjs verify pr-1789278934747-9b83ecdc27
```

```json
{"ok":true,"action":"verify","record_id":"pr-1789278934747-9b83ecdc27",
 "commit_sha":"ed673d7d220002186b1d06082b55321d58e04a38",
 "content_digest_matches":true,"gate_table_matches":true,"problems":[]}
```

The temp-worktree battery at the recorded SHA re-ran all six gates green and
the gate table was byte-identical (wall times exempt; build stdout digest
exempt per the contract) — including the per-harness stdout digests, which
proves the readiness harness's byte-determinism across record/verify
contexts.

### The record chain, honestly stated

The append-only store (`deploy/promotions/promotion-records.jsonl`) holds, in
order: the two DEP-006-era rehearsal records, the DEP-008 bootstrap record
and the DEP-008 release record:

1. **R1** `pr-1789270523172-76af45c723` and **R2**
   `pr-1789270693798-62fe257271` — the DEP-006 rehearsal records. **A
   finding of this work item:** their revisions (`e30d4224…`,
   `ba7bddcd…`) do NOT resolve in the local git history — those commits
   were rebased away when the DEP-006 PRs merged (the merged content on
   main carries different SHAs). They are rebase-orphaned rehearsal
   artifacts; `promote.mjs verify` against them would fail its
   recorded-revision-exists check. The readiness harness's record
   selection skips them deterministically (skipped count disclosed in the
   proof notes below).
2. **R-base** `pr-1789277963039-b21e6dcf4a` — the DEP-008 bootstrap record
   freezing the dispatch base `a39cccf…` (recorded on a clean tree at the
   base: the release candidate as dispatched — DEP-006 + DEP-007 + the
   product closure merged). It exists so the release-identity proof has a
   resolvable record at the implementation commit (the harness reads only
   HEAD-committed records; an uncommitted append is not a frozen identity).
   Its own `verify` is bounded by the pre-existing determinism defect
   fixed in this work item (see the disclosure below): the recorded
   revision predates the fix. The fully verifiable records are R-base's
   successors carrying the fix — R3 below and any record made after it.
3. **R3** `pr-1789278934747-9b83ecdc27` — **the DEP-008 release record**
   (the release revision `ed673d7…` — this work item's implementation
   commit). The proof harness below targets exactly this record; the
   rollback plan's R1 target is R-base (the previous resolvable record in
   the chain).

## (a) The proof harness run — the ten groups

Command (captured at the evidence commit, clean tree — the captured
transcript's JSONL on stdout, timing-augmented records and progress on
stderr):

```bash
node scripts/test_production_readiness.mjs \
  > /tmp/dep008-transcript-capture.jsonl \
  2> /tmp/dep008-transcript-capture-progress.txt
```

**Exit code: 0 — all ten proof groups green.**

| proof group | scenarios | assertions | result |
|---|---|---|---|
| proof:release-identity | 6 | 32 | PASS |
| proof:protocol-integration | 6 | 39 | PASS |
| proof:ui-integration | 6 | 72 | PASS |
| proof:failure-injection | 5 | 22 | PASS |
| proof:scaling-behavior | 5 | 21 | PASS |
| proof:config-secret-safety | 5 | 27 | PASS |
| proof:backup-restore-queue-recovery | 5 | 30 | PASS |
| proof:unknown-reconciliation | 4 | 14 | PASS |
| proof:external-effect-safety | 4 | 30 | PASS |
| proof:rollback-observability | 4 | 30 | PASS |
| **TOTAL** | **50** | **317** | **PASS** |

Verdict record (the machine-parseable stdout tail):

```json
{"type":"proof-verdict","passed":true,"groups_total":10,"groups_failed":0,"scenarios_total":50,"assertions_total":317,"stop_conditions_triggered":0,"release_record_id":"pr-1789278934747-9b83ecdc27","release_revision":"ed673d7d220002186b1d06082b55321d58e04a38","harness":"scripts/test_production_readiness.mjs"}
```

Per-group wall-clock (stderr companion records — stdout stays
byte-deterministic per the ci-cd.md §2 contract; this is the disclosed
resolution of the dispatch guidance's ask for timing inside the stdout
JSONL):

```json
{"type":"proof-timing","group":"proof:release-identity","wall_ms":631}
{"type":"proof-timing","group":"proof:protocol-integration","wall_ms":1690}
{"type":"proof-timing","group":"proof:ui-integration","wall_ms":16}
{"type":"proof-timing","group":"proof:failure-injection","wall_ms":761}
{"type":"proof-timing","group":"proof:scaling-behavior","wall_ms":548}
{"type":"proof-timing","group":"proof:config-secret-safety","wall_ms":482}
{"type":"proof-timing","group":"proof:backup-restore-queue-recovery","wall_ms":215}
{"type":"proof-timing","group":"proof:unknown-reconciliation","wall_ms":1771}
{"type":"proof-timing","group":"proof:external-effect-safety","wall_ms":97}
{"type":"proof-timing","group":"proof:rollback-observability","wall_ms":103}
```

### What each group proved (the per-group evidence notes, verbatim)

```text
proof:release-identity:
  records:source=HEAD-committed:working-tree-dirty=no
  record:pr-1789278934747-9b83ecdc27:revision=ed673d7d220002:files=746
  gates:governance:pass+deployment-contract:pass+durable-contract:pass+typecheck:pass+harnesses:pass+build:pass:harnesses=17
  chain:records=4:latest-resolvable=pr-1789278934747-9b83ecdc27:skipped-orphaned=2
  digest:recomputed=9b83ecdc2756:head-is-descendant=yes
proof:protocol-integration:
  wrap:scripts/test_protocol_composed_journey.mjs:exit=0:markers=7
  wrap:scripts/test_protocol_composed_journey.mjs:exit=0:markers=6
  refusals:7:rows=1:rejection-records=7
proof:ui-integration:
  mock-shims:7
  mode: the UI-011 family uses bundler-resolved specifiers (bun/Next-compiled
  — `bun run typecheck` and the frozen gateway boundary test are its
  compile-level and splice-level proof); this harness verifies the binding
  exports and wiring statically
  mode: static verification of the route handlers, ports and binding wiring
  (battery-safe); the standalone build output is probed on stderr and
  live-verified once in this transcript (section e)
proof:failure-injection:
  wrap:scripts/test_observability_resilience.mjs:exit=0:markers=7
  dep007-drills:scenarios=30:assertions=483
  exhaustion:transport failure [DNS_UNRESOLVED/pre-effect] after 3 attempt(s): proof down 3 — outcome indeter
proof:scaling-behavior:
  contention:dispatched=100:passes=14
  scope: SUBSTRATE-level scaling evidence in-sandbox (bounded drains, lease
  exclusivity, exactly-once effects under burst and contention) — NOT a claim
  about production horizontal scaling
proof:config-secret-safety:
  s1-scan:files=747:patterns=5:hits=0
proof:backup-restore-queue-recovery:
  populated:events=20:owners=2
  replay:redelivered=1:events-after-watermark=4
proof:unknown-reconciliation:
  wrap:scripts/test_protocol_composed_journey.mjs:exit=0:markers=5
  wrap:scripts/test_operations.mjs:exit=0:markers=6
  unknown-accounting: every surfaced UNKNOWN is recorded in the activity log
  and held for the A14 path (zero retried, zero translated, zero silently
  dropped); the wrapped composed journey + operations drills evidence the A14
  cycle resolving UNKNOWN to RESOLVED_CONFIRMED / RESOLVED_FAILED with
  finality advancing exactly once
proof:external-effect-safety:
  layer-3 (durable UNIQUE + gateway recorded receipt) proven in proof:protocol-integration and the wrapped drills
  (the typed refusal + rollback-plan assertions — see the plan below)
proof:rollback-observability:
  health:overall=down:unknown=down:worstDomains=2
```

(The full JSONL — one record per proof scenario, 50 records, plus the group
and verdict records — is reproducible by re-running the command above; the
stdout is byte-deterministic across runs at the same tree, verified by
repeated runs including with and without the gitignored build output
present.)

## (b) The migration gate — on a copy

```bash
node scripts/promote.mjs migrate pr-1789278934747-9b83ecdc27
```

```json
{"ok":true,"action":"migrate","record_id":"pr-1789278934747-9b83ecdc27","source":"fresh-throwaway (no durable database present at record time)","applied":["0001_durable_execution.sql"],"verified":true,"real_database_mutated":false,"appended_to":"deploy/promotions/promotion-records.jsonl"}
```

The real database is never opened for write; the applied set matched the
files on disk exactly. During the proof harness run the migration gate is
additionally re-driven INSIDE a throwaway worktree at HEAD (the
`proof:release-identity` group) with the repository records file verified
byte-identical before/after — the append lands in the throwaway only.

## (c) The rollback plan for the release record (R1–R5 honored)

```bash
node scripts/promote.mjs rollback-plan pr-1789278934747-9b83ecdc27
```

Emission properties (the full JSON is reproducible with the command above):

- `plan_only: true` — the plan performs no external effects.
- `rolled_back_revision` = the recorded immutable revision
  (`ed673d7d220002186b1d06082b55321d58e04a38`, tree
  `35b92ab9…`, content `9b83ecdc…` — byte-equal to the record).
- `rollback_target` = **R-base** `pr-1789277963039-b21e6dcf4a`
  (`a39cccf…`) — the previous resolvable promotion record in the
  append-only chain; `executable: true`; step 1 is the R1-tagged
  redeploy-previous-artifact step.
- The six steps carry the principle tags
  `R1`, `R2`, `R2+R4`, `R3`, `R5+R3`, `R5`; the finality-protection step
  states finality is NEVER reversed (R3); the authorization-boundary step
  states rollback never bypasses protocol authorization (R5).
- `external_effect_safety.unknown_never_retried: true`; the three
  post-effect cases are listed with recourse routing,
  `execution: "listed-not-executed — this tool performs no external
  effects"`.
- `per_component` copies the rollback contracts of exactly the eleven
  registered components (the registry is the single source of truth).

## (d) The proof harness's own battery integrity

The readiness harness is glob-enumerated into the `harnesses` gate (17
harness files at the release revision). Its stdout is byte-deterministic:
verified by repeated runs at the same tree — including with and without the
gitignored `.next/` build output present (the build-output probe reports on
stderr only) — and proven end-to-end by `promote.mjs verify` (section "The
immutable release identifier" above) whose per-harness stdout-digest
comparison passed against the recorded gate table.

## (e) UI integration — the one-time LIVE probe of the standalone output

The `proof:ui-integration` group verifies the route handlers, ports and
binding wiring statically (battery-safe; the harnesses gate runs before the
build gate on a fresh tree). Additionally, ONCE in this sandbox, the
standalone output was built, started and probed (environment note: this
sandbox's clone sits inside a parent workspace with multiple lockfiles, so
Next.js infers the workspace root one level up and emits the standalone
server at `.next/standalone/payswap3/server.js` — a fresh single-lockfile
clone emits the flat `.next/standalone/server.js`):

```bash
bun run build
PORT=3999 HOSTNAME=127.0.0.1 PAYSWAP_ENV=sandbox node .next/standalone/payswap3/server.js &
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" http://127.0.0.1:3999/
curl -s http://127.0.0.1:3999/api/health
curl -s http://127.0.0.1:3999/api/ready
```

Captured results:

- `GET /` → **HTTP 200**, 37 211 bytes,
  `<title>PaySwap — product shell</title>` — the shell renders at `/`
  (the server reported `✓ Ready in 112ms`).
- `GET /api/health` → **HTTP 200**:
  `{"status":"ok","component":"web-api-boundary","env":"sandbox"}` — the
  F6 liveness route, byte-identical shape, no `componentHealth`.
- `GET /api/ready` → **HTTP 200**:
  `{"status":"ok","component":"web-api-boundary","env":"sandbox","checks":[{"id":"environment","ok":true,...}],"componentHealth":{"overall":"unknown-data","readiness":"health-unknown",...}}`
  — the F6 readiness authority (the configuration checks) answers ok, and
  the DEP-007 additive `componentHealth` enrichment fails closed to
  `unknown-data` on a fresh store (never a guessed ok) with actionable
  per-domain action descriptors.

## (f) The security/configuration proof (`proof:config-secret-safety`)

- **S1-style secret scan over the whole release tree**: all **747 tracked
  files** at the evidence commit scanned against the five secret-value
  patterns (`ghp_…`, `gho_…`, `sk-…`, `AKIA…`, `-----BEGIN … PRIVATE
  KEY-----`) — **zero hits**. (The release revision itself carries 746
  tracked files; this transcript document is the 747th — the scan covers
  every tracked file of the delivered tree, this document included.)
  No credentials, tokens or secrets exist anywhere in the release tree.
- **Fail-closed configuration matrix** (through the frozen
  `src/lib/startup-config.ts` module's exported API): sandbox resolves ok
  with no required names; `PAYSWAP_ENV=production` with the four required
  names missing → **NOT ready**, failing check ids exactly
  `PAYSWAP_DATABASE_URL, PAYSWAP_QUEUE_URL, PAYSWAP_EVIDENCE_STORE_URL,
  PAYSWAP_RAIL_ADAPTERS_URL` (ids only, never values); with every NAME
  present → ok (presence only — values are never read).
- **F1 allowlist agreement**: `PAYSWAP_ENV` unset/`''`/`'staging'` → resolves
  `sandbox` (fail-safe); `'production'` → `production`; the allowlist
  `sandbox | production` agrees across `src/lib/environment.ts`,
  `deploy/contracts/components.json`, `spec/deployment/environments.md` and
  `spec/deployment/configuration.md`.
- **Credential REFERENCES only**: the rail resolver records
  `secret-ref:…` NAMES (frozen configs, never dereferenced); a production
  rail without its credential reference fails closed with the typed
  `CREDENTIAL_REF_REQUIRED_FOR_PRODUCTION`.
- **Environment-crossing refusal**: `promote.mjs record` under
  `PAYSWAP_ENV=production` is REFUSED (exit 2, "PAYSWAP_ENV resolves to
  production… unverified production promotion is forbidden"); a
  sandbox-scoped rail configuration is refused for a production runtime
  scope (`SCOPE_MISMATCH`); a rail carrying BOTH scope prefixes is refused
  (`SCOPE_CONTAMINATION`). Sandbox configuration can never satisfy
  production gates.

## (g) The stop-condition audit (each explicitly checked, NOT triggered)

| Stop condition | Checked where (proof group) | Result |
|---|---|---|
| any unsafe external retry | `proof:failure-injection` + `proof:external-effect-safety` — timeouts/UNKNOWN/in-flight: exactly one transmit each, never retransmitted; the retryable pre-effect failure re-drove with the SAME rail idempotency key, bounded at 3 attempts with the 4th never issued; duplicates collapsed at the transport, boundary and durable layers; the rollback plan lists post-effect recourse without executing it | **NOT TRIGGERED** |
| environment crossing | `proof:config-secret-safety` — the promotion tool refused a resolved production context (exit 2); sandbox rail config refused for production scope (SCOPE_MISMATCH); cross-contamination refused; the release was recorded under the sandbox context | **NOT TRIGGERED** |
| missing recovery path | `proof:backup-restore-queue-recovery` — backup → destroy → verified restore → settled replay with exactly-once effects; the zombie reclaimed through lease expiry; the dead letter terminal; the worker-restart path proven | **NOT TRIGGERED** |
| unreconciled UNKNOWN | `proof:unknown-reconciliation` — zero UNKNOWN-class keys retransmitted or translated; every surfaced UNKNOWN recorded and held for A14; the wrapped drills evidence terminal resolution (RESOLVED_CONFIRMED / RESOLVED_FAILED) with finality advancing exactly once | **NOT TRIGGERED** |
| configuration ambiguity | `proof:config-secret-safety` — every configuration failure typed and named (HOST_MISSING / SCOPE_MISMATCH / SCOPE_CONTAMINATION / CREDENTIAL_REF_REQUIRED_FOR_PRODUCTION); missing production names fail closed with ids only; the allowlist closed and agreeing everywhere | **NOT TRIGGERED** |
| unexplained authority bypass | `proof:protocol-integration` — every command reached the durable path only through `ProtocolGateway.submitCommand`; the typed refusal matrix (body/envelope/subject/kind/authority) left zero durable rows and zero executions; the composed journey wrap evidences the single-writer transition path; the splice guard re-verified (src/app + src/components contain zero protocol-runtime imports) | **NOT TRIGGERED** |

**Zero stop conditions triggered.** The harness computes each verdict from
real assertions; a triggered (or group-failure-unverifiable) condition
fails the run closed.

## Disclosures (honest findings of this work item)

1. **The DEP-007 battery-determinism defect, found and fixed (disclosed,
   minimal)**: `scripts/test_observability_resilience.mjs` printed the
   epoch-ms backup id in a drill note — its stdout was not byte-identical
   across runs at the same tree, violating the ci-cd.md §2 battery
   determinism contract and making `promote.mjs verify` fail (per-harness
   stdout-digest mismatch) for ANY promotion record whose revision contains
   that harness (i.e., every record at any tree since the DEP-007 merge).
   Fixed by normalizing that one note line (the id's manifest identity
   remains asserted; no assertion, scenario or drill changed). Verified:
   repeated harness runs are byte-identical; `promote.mjs verify` of the
   DEP-008 release record passes the gate-table comparison.
2. **The DEP-006 rehearsal records R1/R2 are rebase-orphaned** (their
   revisions do not exist in main's history — see the record chain above).
   The harness's record selection skips rebase-orphaned records
   deterministically and discloses the count.
3. **The harness reads HEAD-committed records only** — an uncommitted
   append is not a frozen release identity (a temp worktree at HEAD cannot
   reproduce it). In every governed flow the tree is clean and the
   committed version is the working file.
4. **Timing lives on stderr, not stdout** — the dispatch guidance asked for
   timing inside the stdout JSONL; the repository's own ci-cd.md §2
   byte-determinism contract wins (the harness is glob-enumerated into the
   `harnesses` gate whose stdout digests `verify` compares). Both streams
   are machine-parseable JSONL; this transcript captures both.
5. **The scaling group is substrate-level in-sandbox evidence** — bounded
   drains, lease exclusivity, exactly-once effects under a 500-job burst
   across 25 kinds and two-worker contention — and is NOT a claim about
   production horizontal scaling.

## The evidence boundary (restated)

Everything in this transcript is SANDBOX evidence, produced by repo-local
tooling that also runs green in a fresh clone. Production readiness is never
inferred from sandbox behavior (environments.md F8 — the hard boundary; the
work order's Forbidden list). The production deployment binding remains
FUTURE-WORK; every `production_gate` in
`deploy/contracts/components.json` stays authoritative.

## RECOMMENDATION TO THE ARCHITECT

Approve DEP-008 as delivered: the release revision
`ed673d7d220002186b1d06082b55321d58e04a38` carries an immutable, re-
verifiable release record (`pr-1789278934747-9b83ecdc27`, verified end-to-end
above), ten green fail-closed proof groups covering every acceptance
dimension, zero triggered stop conditions, a clean S1 scan, and a fully
conformant rollback plan. Recommended conditions of approval: (1) the
disclosed DEP-007 determinism fix should be treated as load-bearing for the
promotion contract — any future record whose revision predates it will fail
`verify`; (2) the rebase-orphaned DEP-006 rehearsal records should be
annoted as historical at the next governance touch (their SHAs do not
resolve); (3) the production deployment binding (DEP-002+) remains the
governed path from this evidence to any production claim. The approval
itself is the Architect's to give — this transcript recommends, it does not
approve.
