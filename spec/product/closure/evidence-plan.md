# UI-010 — End-to-end UX closure evidence plan

Status: EXECUTED (the plan was written BEFORE execution, per the work order's implementation step 1; the executed artifacts live under `spec/product/closure/evidence/` and are indexed in `evidence-bundle-index.md`)
Work order: spec/product/work-orders/UI-010.md
Base: main @ 2e3b8314f3d1532b6032f9e5c93bf0aef9cd2e90 (UI-011 merged at 0022405, PR #34)
UX contract: spec/product/ux-architecture-v0.2.md (P1–P11, N1–N5, Sections 7/8/10/11/12)

This document enumerates what will be evidenced, through which scripted vehicle, before any
evidence was gathered. It is the plan the bundle executed; deviations discovered during
execution are recorded in the artifacts themselves — never silently.

---

## 1. Designated environment

- **Sandbox.** `PAYSWAP_ENV` is unset in this environment, so the environment signal resolves
  sandbox through the documented fail-safe (src/lib/environment.ts). No run in this bundle
  presents production financial execution; the production-signal check (Section 7) is a
  controlled configuration derivation check on a separate instance, recorded as such.
- **The composed product.** Two legs, both scripted and reproducible:
  - **Leg A — the runtime-backed product ports over the real composed protocol runtime.**
    A plain-Node harness (Node 24 type stripping, the repository's established evidence
    pattern — cf. `scripts/test_protocol_composed_journey.mjs`) composes the runtime in the
    barrel's documented order (substrate → evidence → authorities → persist hooks →
    bindings → transition → gateway → scheduler), creates the seven runtime adapters
    (`src/lib/protocol/runtime-*-adapter.ts`), and registers them into the product port
    modules (`register*PortBacking`) — the exact splice `src/lib/protocol/server-runtime.ts`
    performs for the app. The harness then drives the PRODUCT PORTS through the full
    workflows below. Tooling: `node --import ./tools/alias-loader.mjs
    tools/product-port-journeys.mjs`; artifacts under `evidence/workflows/`.
  - **Leg B — the real built app over HTTP.** `bun run build` + `bun run start`
    (PORT=3210; instrumentation wires the composition root in the nodejs runtime), driven
    by a Playwright (1.62) + axe-core (4.13) audit script plus plain HTTP checks.
    Tooling: `node tools/app-e2e-audit.mjs` (+ `curl` health checks); artifacts under
    `evidence/app-e2e/`.
- **The honest landing recorded before execution** (from UI-011's report, restated as a
  plan input, not a finding): browser-context port calls reach the transport-unavailable
  backing (`src/lib/protocol/unavailable-backing.ts`) — the gateway's HTTP binding is
  recorded future work (deferred to SYS-001). Leg B therefore exercises the
  server-rendered runtime-backed reads and evidences the browser-context UNKNOWN
  presentations as the P5-correct behavior they are; the full command workflows
  (intent submit → authorize → … → tracking/dispute proof trails) are evidenced on Leg A,
  where the same adapters execute against the same runtime classes the app composes.

## 2. Surfaces (the composed product at base 2e3b831)

| # | Surface | Route(s) | Owning item |
|---|---------|----------|-------------|
| 1 | Shell home | `/` | UI-001 |
| 2 | State primitives (verification) | `/state-primitives` | UI-001 |
| 3 | Customer intent compose | `/pay` | UI-002 |
| 4 | Customer intent review | `/pay/review` | UI-002 |
| 5 | Customer intent state | `/pay/[intentId]` | UI-002 |
| 6 | Merchant checkout list | `/checkout` | UI-003 |
| 7 | Merchant checkout decision/state | `/checkout/[checkoutId]` | UI-003 |
| 8 | Provider capabilities | `/capabilities` | UI-004 |
| 9 | Provider capability detail | `/capabilities/[capabilityId]` | UI-004 |
| 10 | Provider liquidity | `/liquidity` | UI-007 |
| 11 | Operator oversight | `/oversight` | UI-007 |
| 12 | Track (lookup) | `/track` | UI-005 |
| 13 | Track status/evidence | `/track/[referenceId]` | UI-005 |
| 14 | Waiting/recovery | `/track/[referenceId]/waiting` | UI-006 |
| 15 | Mediation hub (party docket) | `/mediation` | UI-008 |
| 16 | Mediation case | `/mediation/case/[caseId]` | UI-008 |
| 17 | Proposal review | `/mediation/proposal/[proposalId]` | UI-008 |
| 18 | Dispute initiation | `/mediation/dispute/new` | UI-008 |
| 19 | Dispute detail | `/mediation/dispute/[disputeId]` | UI-008 |
| 20–26 | Verification harnesses | `/verification/{intent,checkout,capability,tracking,waiting,liquidity,mediation}-flow` | UI-002..UI-008 |
| 27 | Not-found | any unmatched route | UI-001 |

API surface (part of the composed product's server boundary): `/api/health`, `/api/ready`,
`/api/shell/audience`, `/api/mediation/{record,dispute,decision,action,script}`.

## 3. Roles and the shared breakpoint / accessibility baseline

- **Five roles** (UX contract Section 4): customer, merchant, provider, operator,
  administrator; plus the unauthenticated audience (least visibility) — six audiences in
  the scripted matrix.
- **Shared breakpoints** (src/lib/navigation.ts `BREAKPOINTS`, the one set): sm 640 / md
  768 / lg 1024 / xl 1280 / 2xl 1536. Evidence widths (the UI-009 agreed evidence points
  spanning the set, mobile-first): **390 / 768 / 1440**.
- **Accessibility baseline** (UX contract Section 11, assumption-flagged WCAG 2.2 AA):
  axe-core 4.13 with `wcag2aa`, `wcag22aa`, `best-practice` tags; full keyboard walk with
  visible-focus capture; semantic landmark/heading/label checks; reduced-motion support;
  no color-only state signaling (the six display states carry distinct labels + treatments).

## 4. Workflow matrix (built before execution)

Every workflow crosses at least two surface boundaries and exercises explicit display
states. "Port" = Leg A; "App" = Leg B.

| ID | Workflow | Surfaces crossed | Explicit states exercised | Leg |
|----|----------|------------------|---------------------------|-----|
| WF-1 | Customer intent lifecycle: consequence quote → explicit submit → authorize → tracking + evidence proof trail | intent (3/4/5) → tracking (13) | WAITING (DRAFT), IN_PROGRESS (AUTHORIZED), evidence trail with A15 record ids/hashes; gateway admission receipt | Port |
| WF-2 | Merchant checkout over a real DRAFT intent → offer read → terminal cancel → failed status | checkout (6/7) → tracking (13) | ACTION_REQUIRED (offered), FAILED (CANCELLED with reason code) | Port |
| WF-3 | Checkout over the post-DRAFT intent → status UNKNOWN + accept decision refused (fail closed) | checkout (6/7) | UNKNOWN (checkout session gap, with reconciliation), honest refusal (nothing committed) | Port |
| WF-4 | Waiting/recovery: queue item → WAITING snapshot → re-check command → cancel recovery → terminal resolution | tracking (13) → waiting (14) | WAITING (with reason/expectation/actions), re-check path, FAILED (CANCELLED terminal, reason INTENT_CANCELLED) | Port |
| WF-5 | Mediation/dispute: obligations via clearing → docket (disputable) → initiation matrix → dispute open → dispute record + recourse trail | mediation (15/18/19) → tracking (13) | ACTION_REQUIRED (disputable), dispute-open outcome wording, A15 proof trail | Port |
| WF-6 | Authoritative-UNKNOWN: operator oversight aggregates (A06/A07/A08 read-surface gap) + liquidity provider reads | oversight (11) → liquidity (10) | UNKNOWN (authoritative, with who-resolves + recheck trigger) — never a UI-side sum | Port |
| WF-7 | Browser-context honest UNKNOWN: pay compose → review (terms not quotable → UNKNOWN, submit blocked) → unknown-reference state page | intent (3/4/5) | UNKNOWN (no-answer consequence terms + no-answer state query), reconciliation paths | App |
| WF-8 | Role matrix + environment signal + deep links + content gates across every surface | all | — (P8/N4/Section 10 proof) | App |

## 5. Mapping-completeness audit design

Mechanical audit (`node tools/mapping-audit.mjs`):

1. Enumerate the consequential states the composed product can actually render: the
   runtime adapters' emitted vocabularies (intent states incl. boundary results; checkout
   states incl. adapter errors; capability states; tracked states; waiting snapshots;
   liquidity value shapes incl. authority-unknown; mediation records) — sourced from the
   port type definitions and the state-mapping modules, not from prose.
2. Parse `spec/product/*-mapping-records.md` for every record (`IMR-*`, `cko-map-*`,
   `CAP-MAP-*`, `TRK-*`, `WQ-*`, `LQ-*`, `MD-*`, shell records) and check each carries
   all nine answers (mechanically: nine numbered answer blocks per record).
3. Cross-check: every enumerated consequential state resolves to at least one record
   (directly or via the documented re-anchoring notes); count unmapped consequential
   states. Target: 0. Any gap found is either completed in an owned record or recorded
   honestly as a stop-condition/deferral — never fabricated.

## 6. Role-matrix proof design

Scripted, not anecdotal: for every surface × every audience (28 surfaces × 6 audiences =
168 deep-link cells), navigate by deep link with the simulated authoritative audience
cookie (`payswap-shell-audience`), record final URL and rendered-content class; compare
against the grammar + page guards. Content gates: per-reference record authorization on
track status, waiting, and mediation records (authorized audiences receive the record;
unauthorized receive the explicit not-authorized/not-visible presentation — never the
record, never a failure). Navigation leakage: per-audience navigation resolution contains
no entry declared for another audience. Findings, including the recorded UI-009 WAIVER-1
(mediation-flow declared-gate vs implemented-gate disagreement on a verification
harness), are re-verified at base and reported as-is.

## 7. Environment-signal proof design

1. `/api/health` reports `env: "sandbox"` on the evidence instance; the environment
   banner renders on every surface with the sandbox signal (scripted DOM check across
   surfaces).
2. Controlled configuration check: a second instance started with
   `PAYSWAP_ENV=production` reports and renders the production signal — derivation is
   exclusively from configuration (Section 10). Recorded explicitly as a signal-derivation
   check in the sandbox; no production financial execution is claimed or performed.
3. Anti-spoof: URL parameters, client state, and user content cannot re-label the
   environment (scripted attempts recorded).
4. Sandbox framing of consequential wording: the pay-flow consequence boundary note and
   sandbox-signal wording are captured on the record (N4).

## 8. Responsive + accessibility re-verification design

UI-009's bundle (`hardening/evidence/`) is the prior per-surface evidence; UI-011
re-anchored every state presentation to runtime truth, so the state-rendering content of
every surface changed after UI-009's evidence was gathered. Plan: re-verify the full
standard on the composed system at base 2e3b831 (axe a11y + semantics + keyboard +
responsive at 390/768/1440 across all surfaces, same tags and checks as UI-009), writing
fresh artifacts under `evidence/a11y-responsive/`; cite UI-009's bundle as the prior
per-surface evidence and diff the verdicts. The roll-up states, per surface, whether the
verdict is re-verified (this bundle) and/or prior-cited (UI-009).

## 9. Closure submission design

`spec/product/closure/`:

- `README.md` — the Architect closure submission (governed process: this closes the
  PRODUCT program; SYSTEM closure remains governed by spec/governance/SYSTEM-CLOSURE.md).
- `evidence-bundle-index.md` — every artifact with the command that produced it.
- `acceptance-rollup.md` — verdict per UI-010 acceptance criterion with evidence pointers.
- `deferral-ledger.md` — the honest deferral ledger (browser-context HTTP binding →
  SYS-001; area-19/20/21 wave-2 gaps; UI-009 WAIVER-1 disposition request).
- `proposed-product-program-state.json` — the PROPOSED machine-state update (UI-010
  merged / program closed). The Tech Lead governs the actual flip;
  `spec/development-state/product-program-state.json` is NOT modified by this branch.
- `architect-closure-record.md` — the closure record submitted for Architect approval,
  including the nine-question program-level answers.

## 10. Stop-condition posture (pre-declared)

Any workflow that cannot be evidenced without altering frozen protocol semantics; any
unmapped consequential state; any UNKNOWN masked as success or failure; any role leakage;
any evidence gap that would require fabrication. Known items watched at plan time:
WAIVER-1 (declared-gate disagreement on `/verification/mediation-flow`), the browser
transport gap (deferred to SYS-001), the wave-2 authority gaps (area 19/20/21 — recorded
denials/unavailable, never fabricated). None of these is papered over in the bundle.
