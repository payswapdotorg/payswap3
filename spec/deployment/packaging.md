# Packaging Contract

Status: ACTIVE (DEP-002)
Component: `web-api-boundary` (the only present component; the nine
future-work components of the topology contract bring their own packaging
when they land).
Scope: what the runtime package is, how it is built reproducibly, how
configuration and secrets are injected at runtime, the sandbox/production
distinction, and the health/readiness evidence procedure.

Related: `spec/deployment/topology.md`, `spec/deployment/environments.md`
(F1–F8), `spec/deployment/configuration.md` (S1–S5),
`deploy/contracts/components.json`.

## 1. What the runtime package is

The runtime package for `web-api-boundary` is the **Next.js standalone
server output** produced by the repository build, wrapped in a
**deterministic multi-stage OCI image**:

| Artifact | Produced by | Contents |
|----------|-------------|----------|
| Standalone output (`.next/standalone/`) | `npm run build` (`next build`, with `output: "standalone"` in `next.config.ts`) | `server.js`, traced minimal `node_modules`, `.next/static`, `public/` |
| OCI image | `docker build` from the repository `Dockerfile` | the standalone output on a pinned `node:22-alpine` base, run as non-root (`nextjs`), exposing port 3000 |

The image contains **no** source tree, no devDependencies, no lockfiles, no
docs/contracts, no logs, and no secret material. The runtime stage copies
only `server.js` + traced dependencies + static assets + public files
(`.dockerignore` guarantees the build context cannot leak host state).

## 2. Reproducible build

The Dockerfile is multi-stage and deterministic:

| Stage | Base | Inputs | Key step | Determinism property |
|-------|------|--------|----------|----------------------|
| `deps` | `node:22-alpine` (pinned tag) | `package.json`, `package-lock.json` ONLY | `npm ci` | Installs exactly the locked dependency graph; fails if manifests and lockfile disagree — an out-of-sync tree cannot build |
| `build` | `node:22-alpine` | deps layer + source (filtered by `.dockerignore`) | `npm run build` | No environment values are set at build time (`PAYSWAP_ENV` is never baked — F2); telemetry disabled; host state (`.next`, `node_modules`, `.git`, `.env*`) excluded from the context |
| `runtime` | `node:22-alpine` | standalone output only | `node server.js` | Non-root user, fixed `PORT=3000`, minimal surface; no package manager runs here |

Determinism notes:
- The base image is pinned to the `node:22-alpine` tag for all three stages
  (single base family; digest-pinning at the platform level is a Tech Lead
  deployment decision).
- Layer ordering is manifest-first (`package.json`/lockfile before source),
  so dependency layers depend only on the lockfile, never on source churn.
- The build performs no network calls that influence output (telemetry
  disabled) and reads no runtime configuration.
- The same commit + lockfile + base tag produces the same standalone output.

## 3. Runtime configuration and secret injection

Configuration enters the component **only** through the process environment
at runtime — environment variables set by the deployment mechanism
(`docker run -e`, orchestrator env blocks, platform secret injection). It is
never source-controlled, never embedded in images, never passed as build
arguments.

| Variable | Scope | Injection | Notes |
|----------|-------|-----------|-------|
| `PAYSWAP_ENV` | public runtime selector | runtime only; image default `sandbox` (`ARG PAYSWAP_ENV=sandbox`) | **F2**: `production` is never baked into any image or build artifact; it is injected at runtime by deployment configuration only. **F4**: unset/invalid ⇒ fail-safe `sandbox` |
| `PAYSWAP_DATABASE_URL` | production (and staging, staging-scoped) | deployment secret injection | name of the authoritative state store connection (S1–S5: value never in the repository) |
| `PAYSWAP_QUEUE_URL` | production (and staging, staging-scoped) | deployment secret injection | durable command queue (S1–S5) |
| `PAYSWAP_EVIDENCE_STORE_URL` | production (and staging, staging-scoped) | deployment secret injection | evidence object store (S1–S5) |
| `PAYSWAP_RAIL_ADAPTERS_URL` | production (and staging, staging-scoped) | deployment secret injection | external rail adapters (S1–S5) |

Secret boundary (S1–S5) enforcement in this change:
- Only secret **names** appear in code/docs (`src/lib/startup-config.ts`,
  this document). No secret values exist anywhere in the repository,
  Dockerfile, or reports.
- `.dockerignore` excludes `.env*`, `*.pem`, `*.key` and all local state, so
  no secret material can enter an image build context.
- Readiness reports failing check **ids** (= names) only — never values (F6, S4).
- `scripts/validate_deployment.py` mechanically scans the repository for
  secret-value patterns and value assignments of the declared names.

## 4. Sandbox vs production distinction

| Concern | `sandbox` | `production` |
|---------|-----------|--------------|
| `PAYSWAP_ENV` value | `sandbox` (explicit or fail-safe default) | `production` — **injected at runtime by deployment configuration only** (F2) |
| Required configuration | none beyond the environment itself | all four names in §3 must be PRESENT at runtime |
| Readiness with missing required configuration | n/a (nothing required) — `/api/ready` → 200 | **fail closed**: `/api/ready` → 503 with the named failing check ids (F6) |
| Financial behavior | demo/sandbox behavior only; never production financial behavior (F4) | production wiring |
| Secret values in scope | none | injected via deployment mechanisms, never source control (S1–S5) |
| Where the value may live | image default (`sandbox`) or unset | production deployment configuration ONLY |

## 5. Health and readiness evidence

### 5.1 Endpoints and semantics

| Endpoint | Kind | Success | Failure | Notes |
|----------|------|---------|---------|-------|
| `GET /api/health` | liveness | `200 {status:"ok", component:"web-api-boundary", env:<resolved>}` | — (process not serving) | No readiness logic, no secrets; reflects the live runtime injection (`force-dynamic`) |
| `GET /api/ready` | readiness | `200 {status:"ok", component, env, checks:[{id,ok,detail}]}` | `503 {status:"not_ready", component, env, failing:[<named check ids>]}` | Runs `validateStartupConfig()`; ids only, never values; `no-store` |

### 5.2 Fail-closed proof procedure (executable in the repository sandbox)

The procedure below exercises the REAL runtime package
(`.next/standalone/server.js`) built by the repository's own build script:

```bash
# 1. Build the standalone runtime package.
npm run build            # next build (output: "standalone") + static/public copy

# 2. Sandbox behavior — no PAYSWAP_ENV injected (fail-safe sandbox).
env -u PAYSWAP_ENV PORT=3001 HOSTNAME=127.0.0.1 NODE_ENV=production \
  node .next/standalone/server.js &
curl -s http://127.0.0.1:3001/api/health   # → 200 {"status":"ok","component":"web-api-boundary","env":"sandbox"}
curl -s http://127.0.0.1:3001/api/ready    # → 200 {"status":"ok",...,"checks":[{"id":"environment","ok":true,...}]}

# 3. Fail-closed proof — production value with NO required names injected.
env -u PAYSWAP_DATABASE_URL -u PAYSWAP_QUEUE_URL -u PAYSWAP_EVIDENCE_STORE_URL \
    -u PAYSWAP_RAIL_ADAPTERS_URL PAYSWAP_ENV=production PORT=3002 \
    HOSTNAME=127.0.0.1 NODE_ENV=production node .next/standalone/server.js &
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3002/api/ready
  # → 503
curl -s http://127.0.0.1:3002/api/ready
  # → {"status":"not_ready",...,"failing":["PAYSWAP_DATABASE_URL","PAYSWAP_QUEUE_URL","PAYSWAP_EVIDENCE_STORE_URL","PAYSWAP_RAIL_ADAPTERS_URL"]}
curl -s http://127.0.0.1:3002/api/health   # → 200 {"status":"ok",...,"env":"production"} (liveness stays up; readiness fails closed)

# 4. Invalid value fails safe to sandbox (frozen allowlist).
PAYSWAP_ENV=staging PORT=3003 HOSTNAME=127.0.0.1 NODE_ENV=production \
  node .next/standalone/server.js &
curl -s http://127.0.0.1:3003/api/health   # → 200 ... "env":"sandbox" (F4 fail-safe)
