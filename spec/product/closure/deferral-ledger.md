# UI-010 — the deferral ledger (honest, no silent waivers)

Every deferral, gap, and finding-disposition request this closure submission
carries. None is silently waived; each names the evidence and the requested
owning disposition. The Tech Lead governs every disposition.

---

## D-1 — the browser/surface transport binding for the composed runtime

- **Deferral:** no HTTP binding exists for the protocol gateway; browser-context
  port calls resolve the transport-unavailable backing (honest UNKNOWN /
  not-transported presentations).
- **Evidence:** UI-011's recorded deferral (the intent/checkout/waiting/mediation
  mapping records' re-anchoring sections); Leg B B-3 (WF-7) evidences the
  P5-correct presentations on the live app.
- **Owning work order:** **SYS-001** (the deployment program's three-layer
  reconciliation; COMMAND-SURFACE.md "Health"; DEP-002+). Unchanged by this
  bundle — but see D-2, which makes it more urgent.

## D-2 — FINDING 2: the UI-011 splice does not reach the routes (product-layer integration defect)

- **Finding:** in BOTH the dev server and the production build, the composition
  root's adapter registrations land in module-graph instances the routes never
  use; in the built app the register seams were dead-code-eliminated from the
  instrumentation graph entirely. Every port call in the running app —
  server-rendered reads AND the API routes — resolves the transport-unavailable
  backing. The composed runtime is constructed (SQLite stores created) but
  serves nothing. All presentations remain honest (P5-correct); the intended
  runtime-backed server reads do not exist at runtime.
- **Evidence:** `evidence/app-e2e/findings.md` (live-app probes across
  /oversight, /track, the mediation APIs; the code-inspected root cause in the
  built chunk), `evidence/app-e2e/app-e2e.json` (B-0).
- **Requested disposition (Tech Lead):** fix the registration's module-graph
  reachability in the product layer (e.g. a server-only shared module the routes
  import, performing the registration idempotently) — OR fold the fix into
  SYS-001's HTTP binding, which supersedes in-process registration entirely.
  Until one of those lands, the UI-011 acceptance statement "server-rendered
  surfaces and the API routes carry the runtime-backed reads" is not true of the
  running app, and this ledger is the record of that fact.

## D-3 — FINDING 1: the composition root's drain() halts the worker without executing queued commands

- **Finding:** `server-runtime.ts`'s `handle.drain()` = `worker.stop()`;
  port-level gateway submissions would present admitted-but-not-executed
  UNKNOWN forever; the mediation adapter's post-submit read-back carries a
  latent mis-presentation (an "initiated + resolved" dispute record when the
  command never executed) — unreachable today only because no product surface
  can populate the app process's runtime with obligations (D-2).
- **Evidence:** `evidence/workflows/probe-drain.txt` (the probe: admitted but
  not executed after drain(); the tick control executes).
- **Requested disposition (Tech Lead):** replace the drain with a bounded tick
  pass (the composed-journey harness's pattern) in the composition root — a
  product-layer helper fix, no protocol semantics involved. Fold into the D-2
  remediation.

## D-4 — FINDING 3: /verification/liquidity-flow responds HTTP 500

- **Finding:** the page's mock-era invariant ("the mock authority
  unexpectedly denied the demonstration queries") throws on the honest
  fail-closed backing results.
- **Evidence:** `evidence/app-e2e/findings.md`; B-0 (HTTP 500).
- **Requested disposition:** the surface's owner (UI-007 semantics) replaces
  the invariant with an honest presentation of whatever the backing returns.
  Verification tooling only — no party surface, no financial semantics.

## D-5 — FINDING 4: statically prerendered surfaces bake the build-time environment banner

- **Finding:** under a runtime configuration that differs from the build-time
  configuration, static surfaces show the stale (build-time) banner while
  /api/health and dynamic pages derive correctly. Fail-safe direction (sandbox
  shown under production config), but it contradicts the documented derivation
  chain and the shell mapping record's claim.
- **Evidence:** `evidence/app-e2e/environment-signal.json` (the controlled
  configuration check: 4/4 static surfaces stale; health + dynamic pages
  correct).
- **Requested disposition:** product-layer fix (request-time derivation for the
  banner on static shells, or force those shells dynamic) — the shell owner +
  Tech Lead; in the sandbox evidence environment (config uniform) the signal is
  uniformly correct.

## D-6 — FINDING 5: the mediation surfaces' honest-unavailable branches lack level-one headings

- **Finding:** /mediation and /mediation/dispute/new carry their `<h1>`s in the
  fetched-docket branches; the unavailable branches (rendered per D-2) have
  none — axe `page-has-heading-one` + the semantics probe. A WCAG 2.2 AA
  baseline gap on two party surfaces, produced by D-2's root cause.
- **Evidence:** `evidence/a11y-responsive/{a11y.json,rollup.md}`.
- **Requested disposition:** the surfaces' owner (UI-008 semantics) adds the
  headings to the unavailable branches once the docket branches are exercised.

## D-7 — UI-009 WAIVER-1 (carried forward unchanged): the /verification/mediation-flow declared-gate disagreement

- **Waiver record:** the grammar entry `verification.mediation-flow` (and
  `mediation-nav-entries.json`) declares audiences [operator, administrator];
  the page has no `requireRoleSurface` guard, so every audience can deep-link
  the harness. Content is non-authoritative fixtures only; the error direction
  is under-exposure of verification tooling, not cross-role product-content
  leakage. Closing it is a one-line authorization-logic addition that UI-009
  was forbidden to make and UI-010 does not own.
- **Evidence:** re-verified at base 2e3b831 — `evidence/app-e2e/app-e2e.json`
  (B-2: the declared-gate disagreement, unchanged);
  `hardening/evidence/waivers.md` (the original record).
- **Requested disposition:** the Tech Lead's one-line decision (add the guard
  in the owning work order's semantics, or accept the documented ungated
  verification-tooling pattern). It does not gate product-program closure on
  the role-matrix criterion (zero cross-role product-surface leakage is
  evidenced); it is recorded here because closure must not carry silent
  waivers.

## D-8 — the wave-2 authority gaps (area 19 / 20 / 21) — recorded, not waived

- **Deferral:** the Agents/Mediation Authority (area 19), the Merchant
  checkout-session Authority (area 20), and the Disputes/Recourse Authority
  (area 21) are RTN wave 2 and not merged. Their surfaces present
  unavailable/denied with the recorded gaps (never fabricated): proposal
  decisions and mediation actions fail closed (WF-5, Leg A); checkout decisions
  are refused `decision-not-allowed` (WF-3); the docket's proposal/mediation
  sections report the runtime's authoritative empty sets. Carried by the
  mapping records (MD-400 family, COM gap records, the mediation re-anchoring
  notes) and evidenced in this bundle rather than restated as new gaps.
- **Owning program:** the RTN wave-2 runtime work orders (cross-program; not
  product-layer).

## D-9 — the retained mock-era vocabulary members and records

- **Record:** the intent port's frozen type union retains mock-era fixture
  state members (`acknowledged`, `rejected`, …) for interface compatibility;
  their records (IMR-1..IMR-6) state plainly that the runtime adapter never
  reports them. 25 doc records total are not referenced by the live runtime
  vocabulary (`evidence/mapping-audit.json` — informational; the records are
  the presentation contract for those members and the docs say so). No action
  requested; recorded so the roll-up's "91 records" number is honest about
  which members the runtime actually emits.
