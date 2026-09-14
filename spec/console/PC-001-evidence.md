# PC-001 evidence — console foundation, contracts, and governance

**Task:** PC-001 (spec/console-work-orders/PC-001.md)
**Branch:** `pc-001/console-foundation`
**Parent revision:** `9abc805c17ed81e8562a88c03170e44b2f8b8874`
**Design:** docs/superpowers/specs/2026-09-14-payswap-developer-console-design.md (APPROVED)
**Plan:** docs/superpowers/plans/2026-09-14-payswap-developer-console.md (Task 1)

## 1. Authority inventory (exact source symbols reused)

### Identity/role authority (no new identity source invented)

| Purpose | File | Exact symbols |
|---|---|---|
| Role vocabulary (authoritative) | `src/lib/navigation.ts` | `ROLES` = ['customer','merchant','provider','operator','administrator'], `Role`, `NavAudience`, `NAV_AUDIENCES`, `guardSurface(audience, allowed)`, `resolveNavigation(audience)`, `NAVIGATION_ENTRIES`, `SHELL_AUDIENCE_COOKIE` ('payswap-shell-audience'), `NAVIGATION_GRAMMAR_RULES`, `BREAKPOINTS` |
| Server-side audience resolution | `src/lib/shell-audience-server.ts` | `resolveShellAudience(): Promise<NavAudience>` — fail-closed to 'unauthenticated' |
| Server-side page guard convention | `src/lib/shell-guard.ts` | `requireRoleSurface(requiredRole, extraAllowed)` — denial redirects '/' (the convention `requireConsoleModule` mirrors) |

### Environment authority

| Purpose | File | Exact symbols |
|---|---|---|
| Environment signal (sole derivation chain) | `src/lib/environment.ts` | `EnvironmentKind` ('sandbox'\|'production'), `ConfiguredEnvironment`, `EnvironmentReport`, `getEnvironment()`, `describeEnvironment()` — PAYSWAP_ENV → allowlist → fail-safe sandbox |
| Startup configuration validation | `src/lib/startup-config.ts` | `validateStartupConfig(): StartupConfigResult` (names only, never values; F6 fail-closed) |

### Product state-display vocabulary (the DTO status alignment authority)

| Purpose | File | Exact symbols |
|---|---|---|
| Six display states (UX contract §7) | `src/components/state/display-state.ts` | `DISPLAY_STATES` = ['SUCCEEDED','FAILED','UNKNOWN','WAITING','IN_PROGRESS','ACTION_REQUIRED'], `DisplayState`, `STATE_LABELS`, `STATE_MEANINGS`, `UNKNOWN_DISAMBIGUATION`, `NO_ACTIONS_AVAILABLE` |
| Authority→display mapping precedent | `src/lib/protocol/intent-state-mapping.ts` | `INTENT_STATE_DISPLAY_MAP`, `BOUNDARY_DISPLAY_RESOLUTION` ({submitNotTransported:'UNKNOWN', queryNoAnswer:'UNKNOWN'} — the transport-failure≠business-failure rule PC-001 encodes structurally) |
| Honest no-answer backings precedent | `src/lib/protocol/unavailable-backing.ts` | no-answer/not-transported ports (never zero, never failure, never success) |

### Read authorities inventoried for the reconciliation matrix (consumed by PC-003/PC-004, NOT imported by PC-001)

- Intent (payment list/detail): `getIntentPort()` (`src/lib/protocol/intent-port.ts`) + `createRuntimeIntentAdapter` (`src/lib/protocol/runtime-intent-adapter.ts`) + `ensureProductPortsWired()` (`src/lib/protocol/server-composition.ts`); A01 vocabulary `INTENT_STATES` (`src/lib/protocol-runtime/intent/types.ts`).
- Checkout: `getCheckoutPort()` (`src/lib/protocol/checkout-port.ts`) + `runtime-checkout-adapter.ts` + `checkout-state-mapping.ts`; `CHECKOUT_BOUNDARY` (`src/lib/protocol/adapter-boundary.ts`).
- Capability: `getCapabilityPort()` (`src/lib/protocol/capability-port.ts`) + `runtime-capability-adapter.ts`; A03 authority `src/lib/protocol-runtime/capability/authority.ts` (read via the port, never imported by console code).
- Waiting/execution: `getWaitingPort()` (`src/lib/protocol/waiting-port.ts`).
- Tracking/evidence: `getTrackingPort()` (`src/lib/protocol/tracking-port.ts`); A15 chain `src/lib/protocol-runtime/evidence/`.
- Operations health: `OBSERVABILITY_DOMAINS`/`DOMAIN_DEFINITIONS` (`src/lib/observability/taxonomy.ts`), `deriveComponentHealth`/`HealthState` (`src/lib/observability/health.ts`), `probeComponentHealth` (`src/lib/observability/readiness.ts`), `collectTelemetrySnapshot` (`src/lib/observability/telemetry.ts`), progress reader (`src/lib/operations/progress-reader.ts`), rail activity (`src/lib/rail-connectivity/activity.ts`).
- Logging/redaction primitives for developer views: `LogRecord`/`LogSink`/`scrubCredentialReferences` (`src/lib/observability/logging.ts`), `TraceDocument`/`trace()` (`src/lib/observability/tracing.ts`).

### API boundary conventions (followed)

- `src/app/api/health/route.ts` — force-dynamic, NextResponse.json, Cache-Control: no-store.
- `src/app/api/shell/audience/route.ts` — audience validated against `NAV_AUDIENCES`.
- `src/app/api/mediation/record/route.ts` — server-side audience resolution precedent in API routes; `ensureProductPortsWired()` per-route wiring precedent (for PC-003).
- `src/app/not-found.tsx` — grammar-aware 404 convention (planned routes stay inert; deep links to unshipped routes 404).

## 2. Role vocabulary mapping decision

Design §6 lists Customer, Merchant, Provider, Operator, Administrator. The
existing repository vocabulary `ROLES` (`src/lib/navigation.ts`) is EXACTLY
`customer | merchant | provider | operator | administrator` — a one-for-one
match. **Decision: the EXISTING repository role vocabulary is authoritative;**
no mapping table is needed and none was invented. The console principal is
resolved from `resolveShellAudience()` narrowed by `isConsoleRole()` —
'unauthenticated' (the sixth NavAudience) is the fail-closed least-visibility
principal, never a console role.

## 3. Role→module access decisions (design §6, default-deny)

Recorded per-route with rationale in `spec/console/route-role-matrix.md`
(machine-checked against the code registry by `registry.test.ts`). Summary of
the judgment calls, all fail-closed:

- **console.overview + documentation.\***: all five roles (one product surface; documentation is part of the product shell, design §14).
- **payments.\***: customer (personal payments), merchant (merchant payments), operator (permitted payment visibility). Provider: not listed in §6 → deny. Administrator: "visibility where explicitly authorized" — payment visibility is not explicit in §6 → deny (recorded; widening requires a governed change).
- **checkout.sessions/configuration**: merchant only (the existing product checkout surface is merchant-audience). **checkout.test**: customer + merchant (§6 customer row: "checkout/test context").
- **accounts.customers/operators**: administrator (cross-role administration). **accounts.merchants**: merchant (own account/configuration) + administrator. **accounts.providers**: provider (provider-side activity) + administrator.
- **capabilities**: provider only — mirrors the existing `/capabilities` surface audiences (['provider']).
- **developers.\*** (api-keys, webhooks, logs, request-inspector, environments): merchant only in the first release — the §6 merchant row ("webhooks, integration logs") is the only explicit authorization; administrator/operator access is default-denied until an explicit authorization exists (recorded in the matrix).
- **operations.\*** (all six): operator only (§6 operator row: "operational/diagnostic modules"); read-mostly per design §12.

## 4. Status vocabulary alignment

`CONSOLE_STATUSES` (`src/lib/console/dto.ts`) is exactly
`UNKNOWN | WAITING | IN_PROGRESS | FAILED | SUCCEEDED | ACTION_REQUIRED` —
machine-checked one-for-one against `DISPLAY_STATES`
(`src/components/state/display-state.ts`) in `dto.test.ts`. Labels/meanings
for the shared status primitive are imported FROM the product contract
(`STATE_LABELS`, `STATE_MEANINGS`, `UNKNOWN_DISAMBIGUATION`) — the console
never re-words a state. The transport-failure rule follows the existing
`BOUNDARY_DISPLAY_RESOLUTION` precedent: transport failure → UNKNOWN, never
FAILED/SUCCEEDED — encoded structurally (the `ConsoleReadResult` unavailable
branch's `presentationStatus` is the literal 'UNKNOWN' and the branch carries
no business-status field).

## 5. Governance forbidden-import list (mechanically enforced)

`src/lib/console/governance.test.ts` scans every console-owned source file
(`src/lib/console/`, `src/app/console/`, `src/app/api/console/`,
`src/components/console/`) and FAILS on any import of:

1. `src/lib/durable/` (the durable substrate: db/events/queue/scheduler/worker);
2. any `src/lib/protocol-runtime/<area>/persistence` module (kernel, intent, evidence, capability, gateway, policy, routing, credit, obligations, clearing, queues, netting, rails, risk, liquidity, reservations, settlement);
3. `src/lib/protocol-runtime/gateway/` (the protocol gateway COMMAND surface — ProtocolGateway.submitCommand admission);
4. `src/lib/protocol-runtime/<area>/authority` modules (authority command methods that bypass gateway admission);
5. `src/lib/protocol-runtime/hosting/` and `src/lib/protocol-runtime/transition/` (dequeue-side execution path and command bindings);
6. direct DB/persistence clients as bare specifiers (node:sqlite, sqlite3, better-sqlite3, pg, postgres, mysql, mysql2, mariadb, mongodb, mongoose, redis, ioredis, prisma, @prisma/client, drizzle-orm, kysely, typeorm, sequelize, mssql, oracledb).

ALLOWED and recorded (not forbidden): `src/lib/protocol/*-port.ts` port
modules and `src/lib/protocol/server-composition.ts` (the sanctioned
read/composition path existing product routes already import — e.g.
`src/app/api/mediation/record/route.ts`), pure read/type modules under
protocol-runtime that do not cross into persistence, and the pure vocabulary
modules (`@/lib/navigation`, `@/lib/environment`, `@/lib/startup-config`,
`@/components/state`). PC-001 itself imports none of the protocol surfaces —
its complete external import set is: next/server, next/navigation, react,
bun:test, node:{fs,path,url}, `@/lib/navigation`, `@/lib/environment`,
`@/lib/startup-config`, `@/lib/shell-audience-server`, `@/components/state`.

The existing RTN-010 boundary test additionally enforces (unchanged by
PC-001) that `src/app/` and `src/components/` never import protocol-runtime
at all — the console app/components files comply.

## 6. Verification battery (exact commands and results)

All commands run from `/home/z/payswap3` on branch `pc-001/console-foundation`.

| Command | Result |
|---|---|
| `bun run typecheck` (tsc --noEmit) | **0 errors** (exit 0) |
| `bun run build` (next build) | **success** — `/console` and `/api/console/contracts` both listed as dynamic (ƒ) routes |
| `bun test` (full suite) | **2016 pass / 1 fail / 2017 tests across 103 files** — the 1 failure is PRE-EXISTING at the parent revision (see §7); PC-001 adds 52 tests across 6 files, all passing |
| `bun test src/lib/console/ src/app/api/console/` (focused) | **52 pass / 0 fail / 1374 expect() calls** — dto (11), environment-context (9), governance (3), policy (13), registry (12), API route contract (4) |
| Manual import inspection | complete import inventory recorded in §5 — zero financial-persistence imports (multiline-aware grep over all console files) |
| Live smoke (production `next start`, ephemeral port) | unauthenticated `/console` → 307 redirect to `/` (fail closed, existing guard convention); unauthenticated `/api/console/contracts` → 404 `{"ok":false}` with no content; spoofed audience cookie ('superuser') → 307 redirect; operator/customer cookies → 200 with the foundation placeholder (registry summary + environment label); planned deep links (`/console/operations/queues`) → 404 for every role (routes do not exist yet — existing not-found convention) |

Focused proof map (work-order battery items):
- unauthorized roles fail closed → `policy.test.ts` (full registry×role matrix, unauthenticated everywhere-deny, unknown-module deny, redirect proof for unauthenticated/role-denied/unknown-module) + `route.test.ts` (404 fail-closed) + live smoke;
- environment is server-derived (client env selectors ignored) → `environment-context.test.ts` (no-argument producer, import allowlist, spoof channels, fail-safe chain) + `route.test.ts` (PAYSWAP_ENV chain through the API);
- unavailable authority data stays UNKNOWN → `dto.test.ts` (unavailable branch is structurally UNKNOWN; transport failure never FAILED/SUCCEEDED);
- DTO status validation rejects invented states → `dto.test.ts` (parseConsoleStatus rejects 18 invented variants; consoleValue throws on invented status);
- registry matches frozen IA → `registry.test.ts` (exact route set, groups, status policy, spec-matrix cross-check);
- governance import scan passes → `governance.test.ts` (3 tests, including the raw-marker cross-check).

## 7. Baseline deviation record (pre-existing, NOT caused by PC-001)

At the CLEAN parent revision `9abc805` (before any PC-001 file existed),
`bun test` reports **1964 pass / 1 fail / 1965 tests across 97 files**. The
single failure:

- Test: `RTN-010 boundary review — no second admission path exists > no non-gateway, non-substrate, non-transition-runtime source calls the durable enqueue API or references DurableQueue` (`src/lib/protocol-runtime/gateway/boundary.test.ts`).
- Offenders reported by the test: `src/lib/recovery/index.ts`, `src/lib/recovery/replay.ts` (import `DurableQueue` from `../durable/queue.ts` and call `queue.enqueue(...)`).
- Introduced by: DEP-007 observability/resilience/recovery merge `25b1789` (PR #38), which added `src/lib/recovery/` without whitelisting it in the RTN-010 scan's substrate-consumer allowlist.
- PC-001 impact: none — the failure signature (same test, same two offender files) is byte-identical before and after PC-001; PC-001 adds 52 passing tests and no new failures. Recorded for the Tech Lead: the recovery/ substrate-consumer whitelist amendment is a one-line change in an RTN-010-owned test file (FORBIDDEN surface for PC-001) and is therefore returned rather than fixed.

## 8. Notes for later phases

- `src/lib/console/types.ts` defines `ConsoleModuleId` as a branded string; `requireConsoleModule` accepts a plain `string` deliberately — unknown ids fail closed exactly like role denials (there is no allow-by-default path).
- `bun-test-augmentation.d.ts` (PC-001 owned) merges `mock` into the ambient 'bun:test' declaration so `mock.module('next/headers', ...)` typechecks under `tsc --noEmit` without touching the RTN-001 owned `src/lib/protocol-runtime/kernel/bun-test.d.ts` (matcher interface augmentation was empirically proven NOT to merge, so console tests use only the original matcher subset).
- The contracts API denies with 404 (not 403) by design: the console boundary does not confirm its existence to unauthorized callers (design §6 unauthorized-deep-links fail closed). Existing API authorization precedent (`/api/mediation/record`) answers 200 with a not-visible kind for party-scoped data — the console boundary is stricter because it gates the surface itself, not a record.
- PC-002 must add `requireConsoleModule(<module id>)` calls to every child route page it scaffolds; the layout guards only the console root bar (any authenticated role).
