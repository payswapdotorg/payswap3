# Serverless Runtime-Root Adaptation (post-closure deployment change record)

Status: ACTIVE (post-closure deployment program — worker DEPLOY-D)
Base: `eb3cdb8` (local main; app code byte-identical to the release
revision `b9b0ae2` — the base diff is docs-only)
Change class: governed **post-closure deployment adaptation** — additive
only. Closed WORK/UI/DEP/SYS records, `deploy/contracts/components.json`,
`scripts/validate_deployment.py`, and everything under
`src/lib/console/**`, `src/components/console/**`,
`src/app/console/**` are untouched by this change.
Owned surfaces of this change: `src/lib/protocol/server-runtime.ts`,
`src/lib/durable/db.ts`, `next.config.ts`, `package.json`, the two
colocated test suites (`src/lib/protocol/server-runtime.test.ts`,
`src/lib/durable/db.test.ts`), this document, and a one-line additive
contract-evolution entry in `spec/deployment/topology.md`.

Related: `spec/deployment/topology.md` (contract evolution),
`spec/deployment/packaging.md` (the runtime package this adapts),
`spec/deployment/environments.md` (F1–F8), `spec/durable/execution.md`
(the substrate's own env-input family), the DEPLOY-B audit entry in the
program worklog.

## 1. The blocker this change resolves (DEPLOY-B audit finding)

The audit (post-closure deployment audit at the same base) established
that the runtime substrate writes under `process.cwd()`:

- The composed runtime's artifact directory —
  `RUNTIME_DIR = join(process.cwd(), 'var', 'web-runtime')`
  (`src/lib/protocol/server-runtime.ts`, pre-change line 121), created
  with `mkdirSync(..., { recursive: true })` inside
  `composeProtocolRuntime()` (pre-change line 213) with eleven SQLite
  stores opened under it.
- The durable substrate's default database path —
  `var/durable.sqlite` (`src/lib/durable/db.ts`,
  `getDurableDbPath()`; its directory created with `mkdirSync` inside
  `openDurableDatabase()`), used by the `/api/ready` readiness probe's
  lazily-opened durable handle (`src/lib/observability/readiness.ts`).

On a Vercel serverless function the process working directory
(`/var/task`) is **read-only**: `mkdirSync` throws `EROFS`, the
composition boot rejects, the rejection is deliberately rethrown through
the globalThis-slot / wire / instrumentation chain, and Next.js fails
server prepare — **every route (including `/api/health`) returns 500**.
`/tmp` is writable and persists per warm instance.

Secondary filesystem risk recorded by the audit: the migration trees are
**read at runtime by walking up from the process cwd** —
`deploy/migrations` (`src/lib/durable/db.ts` `resolveMigrationsDir`)
and the seventeen per-domain migration directories under
`src/lib/protocol-runtime/<domain>/migrations` (each domain's
persistence module resolves its own owned directory the same way) — and
`next.config.ts` had no `outputFileTracingIncludes`, so a serverless
bundle could omit the never-imported `.sql` trees and every store open
would fail with `DurableMigrationError`.

## 2. The change

### 2.1 The runtime-state root override (the one new concept)

Both runtime WRITE roots now derive from a single **runtime-state root**
(the `var/` equivalent), resolvable through one environment variable:

| Directive | Contract |
|-----------|----------|
| `PAYSWAP_RUNTIME_DIR` | Honored **only** when set to a **non-empty ABSOLUTE path**. Unset, empty, whitespace-only, or **relative** values are invalid and **fail safe** to the default `join(process.cwd(), 'var')` — the exact pre-existing default. An invalid value never crashes; it degrades (the `src/lib/environment.ts` fail-safe pattern: invalid `PAYSWAP_ENV` → sandbox, never a crash). |

Applied to both write roots:

| Root | Pre-change | With an absolute override |
|------|------------|---------------------------|
| Composed runtime artifact directory (`src/lib/protocol/server-runtime.ts` — `resolveRuntimeRoot()` / `resolveRuntimeDir()`, resolution at composition time, not import time) | `<cwd>/var/web-runtime` | `<PAYSWAP_RUNTIME_DIR>/web-runtime` |
| Durable substrate default database (`src/lib/durable/db.ts` — `getDurableDbPath()`, a duplicated resolver, deliberately no shared module) | `resolve('var/durable.sqlite')` | `<PAYSWAP_RUNTIME_DIR>/durable.sqlite` |

Precedence and pre-existing semantics are unchanged:

- An explicit `PAYSWAP_DURABLE_DB` (the DEP-003 substrate override) is
  the most-specific override and still wins over the runtime root;
  `:memory:` passes through unchanged.
- The migration-directory READ paths are unchanged: they remain
  cwd-walk-up repository paths (bundled **static assets**, not runtime
  state — §2.2 makes the bundler carry them).
- The per-domain `DEFAULT_*_DB_PATH` constants (`var/<domain>.sqlite`)
  are unchanged: the web composition never uses them (every composed
  store passes an explicit path under the runtime artifact directory);
  they serve only repository-checkout harnesses and scripts.

Classification: `PAYSWAP_RUNTIME_DIR` is a **substrate-level
runtime-state placement directive** — the same family as
`PAYSWAP_DURABLE_DB` and `PAYSWAP_MIGRATIONS_DIR` (infrastructure inputs
documented with the substrate, `spec/durable/execution.md`), NOT an
application configuration value. It changes **where** runtime state
lives, never **what** the application does: the closed configuration
list of `spec/deployment/configuration.md` is untouched (no behavior
selector, no secret, no environment value — S1–S5 and F1–F8 unaffected).

### 2.2 Bundling for runtime fs-reads

`next.config.ts` gains (the only addition; `output: "standalone"`
untouched):

```ts
outputFileTracingIncludes: {
  "/**": ["./deploy/migrations/*.sql", "./src/lib/protocol-runtime/**/migrations/*.sql"],
},
```

Every directory tree of runtime-read static assets is covered — the
durable substrate's `deploy/migrations` (one file:
`0001_durable_execution.sql`) and all seventeen per-domain persistence
migration trees (`capability`, `clearing`, `credit`, `evidence`,
`gateway`, `intent`, `kernel`, `liquidity`, `netting`, `obligations`,
`policy`, `queues`, `rails`, `reservations`, `risk`, `routing`,
`settlement` — each `0001_<domain>.sql`). Read-only assets only: no
runtime state is bundled. Verified in the built standalone output (§5).

### 2.3 Engines pin

`package.json` gains `"engines": { "node": ">=22.13" }` — `node:sqlite`
is unflagged from Node 22.13; the deployment platform runs Node 24.x.
Nothing else in `package.json` changes (the dependency guard of
`scripts/validate_durable.py` passes: dependencies and scripts
unchanged; `npm ci` stays in sync — the engines field is not part of
lockfile dependency sync).

## 3. What this change does NOT change

- No protocol, financial, or console semantics; no route surface; no
  component present-set; no environment allowlist; no health/readiness
  contracts; no components.json or validator change.
- **Default behavior is byte-identical when the directive is unset** —
  regression-guarded by the colocated suites (the default resolutions
  are pinned to the exact pre-adaptation paths).
- The migration READ paths stay cwd-relative walk-ups (bundled static
  assets).
- `output: "standalone"` and the Dockerfile packaging path are
  untouched (the Docker runtime's cwd is writable; the override is
  simply unset there).

## 4. The honest serverless consequence (no durability claims)

On a serverless host the override points at a writable instance-local
directory (for example `/tmp/payswap-runtime`). State written there is
**per-instance ephemeral**: a cold start begins from empty stores, and
nothing survives instance recycling. This is exactly the recorded
non-durable residual carried into program closure (the per-process
globalThis composition means per-instance stores; the in-memory
developer stores are likewise non-durable) — this change makes no
durability claim and adds none. **UNKNOWN presentations on fresh
instances are the designed honest behavior**: the ports' unavailable/
transport-unavailable backings and the fail-closed readiness enrichment
(`unknown-data`, never a guess) answer exactly as the fresh-runtime
release harness proved locally. This change is NOT a production
deployment claim: the production provider binding stays UNBOUND
(live-evidence-before-claim, machine-enforced) and every
`production_gate` rule stays authoritative.

## 5. Verification battery (run at this change's worktree HEAD)

All gates ran over the app-code-complete tree (commit `98e3078`; the
only commit after it is this documentation record itself — docs-only,
byte-identical app code):

| Gate | Result |
|------|--------|
| `bun run typecheck` | 0 errors |
| `bun test` | **2357 pass / 0 fail** across 153 files (54,791 `expect()` calls) — baseline 2342/0 across 151 files **+ 15 new tests across 2 files** |
| `bun run build` | exit 0 |
| `python3 scripts/validate_deployment.py` | **PASS, 1229 checks** (baseline 1229 — unchanged) |
| `node scripts/test_console_deployment.mjs` | PASS — 5 groups / 22 scenarios / 127 assertions (repository-facts-only, `production_proof: false`) |
| `python3 scripts/validate_governance.py` | PASS — 17/17 authority paths |
| `node scripts/test_console_release_verification.mjs` | PASS — **8/8 journeys**, 10 groups / 574 assertions, release revision `98e3078` (the app-code-complete commit) read at run time, fresh runtime, loopback-only server stopped cleanly |

Additional functional proof of the adaptation itself (beyond the
recorded battery): the **built** standalone server was booted with its
cwd pinned to the bundle root (the serverless-equivalent layout that
now contains the traced migration trees) and
`PAYSWAP_RUNTIME_DIR=/tmp/<scratch>` — `/api/health` answered
`200 {"status":"ok",...}`, `/api/ready` answered `200`, **all** runtime
state landed under the override root (`web-runtime/*.sqlite` for the
eleven composed stores and `durable.sqlite` for the readiness probe),
and **no `var/` directory was created under the read-only-equivalent
cwd**.

Test-suite note (recorded convention): the two colocated suites execute
the REAL resolution functions in a REAL Node child process (bun does
not implement `node:sqlite`, so no bun suite imports the durable
substrate or the composed runtime — the same split the hosting suites
record). Each child pins its cwd to the repository root and runs every
env scenario in-process with the documented save/mutate/restore
discipline; the bun suites assert the returned contract values.

## 6. Serverless deployment usage

Set one runtime environment variable on the function (never a build
argument — F2):

```bash
PAYSWAP_RUNTIME_DIR=/tmp/payswap-runtime
```

Requirements: an **absolute** path to a **writable** directory
(invalid values fail safe to the cwd default — on a read-only cwd that
reproduces the original blocker, by design: fail-safe never means
silently pretending to write). The state there is per-instance
ephemeral (§4).

## Live-verification addendum (2026-09-14, post-deployment)

The adaptation is now verified LIVE on the target platform: Vercel deployment `dpl_ExywTQ2y3XeFjajLD9QpJKmGpp9G` (project `payswap3`, `prj_KKNoN9qidIiPm6EKCf2PE9uhgvrk`) built from Git at `c8d8ab12ffe07f62ac3c8f0faf19386583d38ace` (this change's tip) with the single env var `PAYSWAP_RUNTIME_DIR=/tmp/payswap-runtime`, reached READY, and serves `https://payswap3.vercel.app`: `/api/health` 200 `env:"sandbox"`; `/api/ready` 200 with the nine-domain component health (the composition booted on the read-only serverless filesystem — the exact EROFS crash path this change eliminated); full browser verification (operator console navigation, role isolation, honest UNKNOWN presentations, mobile 390px, zero 5xx, zero browser errors) recorded in `spec/deployment/live-deployment-record.md`. The pre-adaptation control was observed live as predicted: the unadapted `main` build deploys and builds green but its runtime cannot boot (read-only cwd) — recorded in the deployment program worklog; the fail-safe default (env unset) remains byte-identical to pre-adaptation behavior, regression-guarded by the colocated suites.

Re-confirmed after PR #50 merged (2026-09-14T18:08Z): the push to `payswapdotorg/payswap3@main` auto-triggered production deployment `dpl_8HVzhV5c42Wq4GcPNkdDzDFvnr75` at `ae87ea31d0108cb716b46c86ac5012e70012767a` through the Vercel Git integration — the merge commit's tree is bit-identical to this change's tip `12101cb` (zero-file merge delta), so the deployed app code is unchanged. READY+PROMOTED with the same single env var; `/api/health` 200 `env:"sandbox"`; `/api/ready` 200 nine-domain health; fail-closed console journeys and zero browser errors re-verified live — full transcript in `spec/deployment/live-deployment-record.md` §8.
