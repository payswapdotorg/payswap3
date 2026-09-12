# UI-010 — integration findings (objective evidence, base 2e3b831)

Produced by the UI-010 evidence bundle's objective probing of the composed
product (Leg A port journeys, Leg B built-app audit, and the drain probe).
Each finding states what was observed, the evidence, the affected surfaces,
and the honest consequence for the UX contract. None of these is papered
over anywhere in the bundle; disposition is requested from the Tech Lead
(see `../deferral-ledger.md`).

---

## FINDING 1 — the server composition's `drain()` halts the worker without executing queued commands

- **Where:** `src/lib/protocol/server-runtime.ts` — `handle.drain()` is implemented as
  `await durableRuntime.worker.stop()`. `DurableWorker.stop()`
  (src/lib/durable/worker.ts) clears the polling timer permanently and awaits
  only already-in-flight executions; it does not execute queued jobs.
- **Evidence:** `../workflows/probe-drain.txt` — the probe composes the runtime exactly
  as `server-runtime.ts` does, submits `intent.submit` through the gateway, calls
  `drain()` exactly as the runtime intent adapter does, and shows: the command is
  admitted but NOT executed (`worker.running = false`, no intent record); the
  control (one `worker.tick()`) executes the same command on the same composition.
- **Who is affected:** every runtime adapter that calls `handle.drain()` after a
  gateway submission — the intent adapter's `awaitIntentExecution` loop, the
  waiting adapter's re-check/recovery `.then`, the mediation adapter's
  `initiateDispute`. Over the app's composition, a port submit would present
  admitted-but-not-executed UNKNOWN forever (honest per P5, but the workflow
  never completes server-side).
- **Latent mis-presentation (recorded, currently unreachable):** the mediation
  adapter's `disputeRecordFor` computes `resolved = obligation.state !== 'DISPUTED'`
  on the post-drain read; if an obligation exists and the dispute command was
  admitted but not executed, `initiateDispute` would return `kind: 'initiated'`
  with a dispute record presenting `authorityState: 'resolved'` — an outcome the
  authority never recorded. Unreachable today only because no product surface can
  populate the app process's runtime with obligations (see FINDING 2 — the
  runtime is not reachable from the routes at all).
- **Not a protocol defect:** the gateway, the durable path, the transition
  runtime, and the authorities all behave correctly; the defect is the
  composition-root helper's choice of `stop()` over a bounded tick pass (the
  composed-journey harness drains by ticking — scripts/test_protocol_composed_journey.mjs).

## FINDING 2 — the UI-011 product splice does not reach the routes: every port call in the running app resolves the transport-unavailable backing

- **Where:** the interaction of `src/instrumentation.ts` (the composition's entry)
  with the module graphs the routes consume.
- **What was observed (live app, both dev server and production build):**
  - `/oversight` (operator) renders "the runtime adapter could not be reached from
    this context" — the transport-unavailable backing's wording, not the runtime
    liquidity adapter's authoritative-UNKNOWN aggregates.
  - `/track/<reference>` renders the unavailable backing's not-found wording.
  - `POST /api/mediation/dispute` returns the backing's not-transported denial —
    no command is admitted.
  - `GET /api/mediation/record?type=dispute&id=…` (customer) returns `unavailable`.
  - The composition ITSELF runs in the server process: the SQLite stores are
    created under the server's `var/web-runtime/` (build-time prerender pass) and
    `.next/standalone/var/web-runtime/` (the standalone server's cwd) with fresh
    timestamps per process start.
- **Root cause (built app, code-inspected):** Turbopack compiles
  `instrumentation.ts` and each route into separate module graphs. The
  instrumentation graph's chunk (`[root-of-the-server]__0c069240._.js`, module
  46061 = `server-runtime.ts`) carries the composition, but the
  `register*PortBacking(...)` seams were eliminated as dead code in that graph —
  within the instrumentation graph nothing ever calls the `get*Port()` accessors,
  so the registrations (writes to module-level slots never read in that graph)
  were removed. The routes' own graphs carry separate port-module instances whose
  slots are never written. The dev server behaves identically (per-graph module
  instances). Net effect: the composed runtime is constructed and then serves
  nothing; every port call from every surface resolves
  `src/lib/protocol/unavailable-backing.ts`.
- **Honest consequence (why the app is still P5-correct):** the unavailable
  backings implement zero authority semantics — every surface presents honest
  no-answer / not-transported / denied with reconciliation paths. No fabricated
  state, no mis-presented outcome, no N1/N2/N3/N5 violation was observed anywhere
  (Leg B's checks confirm the honest presentations across all surfaces).
- **What this breaks:** the UI-011 acceptance intent that "server-rendered
  surfaces and the API routes carry the runtime-backed reads and commands." The
  runtime-backed presentations are instead evidenced on Leg A
  (`../workflows/port-journeys.json`), where the same seven adapter classes
  execute over the same composed runtime classes with the registration performed
  in-process by the harness (no bundler graph separation).
- **Not a protocol defect; product-layer integration.** Likely resolution paths
  for the Tech Lead: perform the registration inside each route's module graph
  (e.g. a shared server-only module imported by the routes rather than only by
  the instrumentation hook), or supersede the in-process registration design with
  the gateway HTTP binding (SYS-001), which is the already-recorded direction.

## FINDING 3 — `/verification/liquidity-flow` responds HTTP 500

- **Where:** `src/app/verification/liquidity-flow/page.tsx` — the page throws
  `new Error('Mock authority unexpectedly denied the demonstration queries.')`
  when its demonstration queries return anything other than `permitted`.
- **Evidence:** Leg B B-0 (HTTP 500 on the live app; the error is visible in the
  server log). With the ports resolving the transport-unavailable backing
  (FINDING 2), both demonstration queries return the honest fail-closed `denied`
  result — a mock-era invariant that no longer holds.
- **Affected surface:** the UI-007 verification harness (verification tooling, not
  a party surface). It renders a server error page instead of the harness.
- **Honest consequence:** no financial semantics are involved (fixtures and reads
  only); the failure mode is a broken verification surface, not a mis-presentation.
  Fix belongs to the surface's owner (replace the mock-era invariant with an
  honest presentation of whatever the backing returns).

## FINDING 4 — statically prerendered surfaces bake the build-time environment signal

- **Where:** the environment banner on statically prerendered routes
  (`/`, `/state-primitives`, `/verification/{intent,capability,mediation,tracking}-flow`,
  the 404 page) versus dynamic routes and `/api/health`.
- **Evidence (environment-signal.json, the controlled configuration check):** a
  second instance of the same build started with `PAYSWAP_ENV=production`:
  - `/api/health` reports `env: "production"` (force-dynamic, correct).
  - Dynamic pages (e.g. `/track`) render "Production environment" (correct).
  - **Static pages render "Sandbox environment"** — the banner was baked at build
    time (the build ran with `PAYSWAP_ENV` unset) and is not re-derived at
    runtime. `/verification/intent-flow` and the 404 page behave the same way.
- **Honest consequence:** in the sandbox evidence environment (PAYSWAP_ENV unset
  at build and run) the signal is uniformly correct. The inconsistency manifests
  only when runtime configuration differs from build-time configuration — the
  deployment shape the packaging spec describes (a build-time image, runtime
  PAYSWAP_ENV injection, F2 "never baked at build time"). The stale banner on
  static surfaces errs in the fail-safe direction (sandbox shown in a
  production-configured process), but it contradicts the documented derivation
  chain ("the server root layout calls getEnvironment()" evaluated per render)
  and the shell mapping record's claim. Recorded for the Tech Lead; the fix is
  a product-layer change (force the banner dynamic or derive at request time on
  static shells) — out of UI-010's owned surfaces.

---

## Stop-condition assessment (per the work order)

- "Any workflow that cannot be evidenced without altering frozen protocol
  semantics" — **not hit**: the full workflows are evidenced on Leg A over the
  real composed runtime; no protocol semantics were touched.
- "Any unmapped consequential state" — **not hit** (mapping roll-up: zero
  unmapped consequential states).
- "Any UNKNOWN masked as success or failure" — **not hit**: every UNKNOWN
  presentation observed (both legs) is worded and styled as unknown; FINDING 1's
  latent dispute mis-presentation is recorded as unreachable-in-practice and
  flagged, not hidden.
- "Any role leakage" — **not hit** (168/168 deep-link cells correct; zero
  navigation leakage; zero cross-role record content). WAIVER-1 (the
  declared-gate disagreement on the mediation-flow verification harness) is
  re-verified unchanged and carried in the deferral ledger with its recorded
  disposition request.
- "Any evidence gap that would require fabrication" — **not hit**: every claim
  in this bundle is backed by a recorded artifact; the four findings above are
  the honest gaps, evidenced rather than papered over.


## FINDING 5 — the honest-unavailable branches of the mediation surfaces lack level-one headings (an a11y regression consequence of FINDING 2)

- **Where:** `/mediation` (the party hub) and `/mediation/dispute/new` (dispute initiation):
  each page's `<h1>` lives in the FETCHED-docket branch
  (`PartyDocketView`'s heading; the initiation form's `sr-only` h1). With the
  party docket resolving the transport-unavailable backing (FINDING 2), the
  pages render their `AvailabilityUnknownState` branches — which carry no
  level-one heading.
- **Evidence:** `../a11y-responsive/a11y.json` + `rollup.md` — axe
  `page-has-heading-one` on both surfaces and the semantics probe (h1 count 0);
  UI-009's evidence had all 28 surfaces passing (its audit ran against the
  mock-era always-fetched docket, so these branches were never rendered).
- **Affected surfaces:** two party mediation surfaces (presentation-layer only:
  no state or authority semantics involved).
- **Classification:** WCAG 2.2 AA baseline gap on two surfaces, produced by the
  same root cause as FINDING 2. Fixing the heading belongs to the surfaces'
  owner (UI-008 semantics) once the docket branches are exercised — out of
  UI-010's owned surfaces; recorded for the Tech Lead.
