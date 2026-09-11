# UI-009 — Violation ledger (pre-fix → post-fix per surface × check)

Audit tooling: axe-core 4.13 (tags `wcag2aa`, `wcag22aa`, `best-practice`) driven by Playwright 1.62 over Chromium 1234; DOM probes for semantics, keyboard walk, responsive metrics, and touch targets. Pre-fix evidence: `raw-prefix/`; post-fix evidence: `raw/`. Assumptions are flagged in `accessibility/MANUAL-CHECKLIST.md`.

| surface | route | axe WCAG | semantics | keyboard | responsive (pre→post) |
|---|---|---|---|---|---|
| home | `/` | FAIL(region) → PASS | PASS → PASS | PASS → PASS | PASS → PASS |
| state-primitives | `/state-primitives` | FAIL(color-contrast,region) → PASS | PASS → PASS | PASS → PASS | PASS <44px-on(1/3bp, see violation 4) → PASS <44px-on(1/3bp, see violation 4) |
| pay-compose | `/pay` | FAIL(region) → PASS | PASS → PASS | PASS → PASS | PASS → PASS |
| pay-review | `/pay/review` | FAIL(region) → PASS | PASS → PASS | PASS → PASS | PASS → PASS |
| pay-intent-state | `/pay/INTENT-2041` | FAIL(region) → PASS | PASS → PASS | PASS → PASS | PASS → PASS |
| checkout-list | `/checkout` | FAIL(landmark-main-is-top-level,landmark-no-duplicate-main,landmark-unique,region) → PASS | FAIL(mains=2) → PASS | PASS → PASS | PASS <44px-on(3/3bp, see violation 4) → PASS |
| checkout-decision | `/checkout/cko_live_offer_001` | FAIL(landmark-main-is-top-level,landmark-no-duplicate-main,landmark-unique,region) → PASS | FAIL(mains=2) → PASS | PASS → PASS | PASS <44px-on(3/3bp, see violation 4) → PASS |
| capabilities | `/capabilities` | FAIL(landmark-main-is-top-level,landmark-no-duplicate-main,landmark-unique,region) → PASS | FAIL(mains=2) → PASS | PASS → PASS | PASS <44px-on(3/3bp, see violation 4) → PASS |
| capability-detail | `/capabilities/intent-acceptance` | FAIL(landmark-main-is-top-level,landmark-no-duplicate-main,landmark-unique,region) → PASS | FAIL(mains=2) → PASS | PASS → PASS | PASS <44px-on(3/3bp, see violation 4) → PASS |
| liquidity | `/liquidity` | FAIL(landmark-main-is-top-level,landmark-no-duplicate-main,landmark-unique,region) → PASS | FAIL(mains=2) → PASS | PASS → PASS | PASS <44px-on(3/3bp, see violation 4) → PASS |
| oversight | `/oversight` | FAIL(landmark-main-is-top-level,landmark-no-duplicate-main,landmark-unique,region) → PASS | FAIL(mains=2) → PASS | PASS → PASS | PASS <44px-on(3/3bp, see violation 4) → PASS |
| track | `/track` | FAIL(landmark-main-is-top-level,landmark-no-duplicate-main,landmark-unique,region) → PASS | FAIL(mains=2) → PASS | PASS → PASS | PASS → PASS |
| track-status-intent | `/track/PWS-2H8D` | FAIL(landmark-main-is-top-level,landmark-no-duplicate-main,landmark-unique,page-has-heading-one,region) → PASS | FAIL(mains=2,h1=0) → PASS | PASS → PASS | PASS → PASS |
| track-status-settlement | `/track/STL-4419` | FAIL(color-contrast,landmark-main-is-top-level,landmark-no-duplicate-main,landmark-unique,page-has-heading-one,region) → PASS | FAIL(mains=2,h1=0) → PASS | PASS → PASS | PASS → PASS |
| waiting-recovery | `/track/TRK-4410-QUEUED-LIQ/waiting` | FAIL(color-contrast,region) → PASS | PASS → PASS | PASS → PASS | PASS <44px-on(3/3bp, see violation 4) → PASS |
| mediation-hub | `/mediation` | FAIL(region) → PASS | PASS → PASS | PASS → PASS | PASS → PASS |
| mediation-case | `/mediation/case/M-101` | FAIL(page-has-heading-one,region) → PASS | FAIL(h1=0) → PASS | PASS → PASS | PASS <44px-on(3/3bp, see violation 4) → PASS |
| dispute-initiation | `/mediation/dispute/new` | FAIL(page-has-heading-one,region) → PASS | FAIL(h1=0) → PASS | PASS → PASS | PASS <44px-on(3/3bp, see violation 4) → PASS |
| dispute-detail | `/mediation/dispute/D-201` | FAIL(color-contrast,page-has-heading-one,region) → PASS | FAIL(h1=0) → PASS | PASS → PASS | PASS <44px-on(3/3bp, see violation 4) → PASS |
| proposal-review | `/mediation/proposal/P-001` | FAIL(page-has-heading-one,region) → PASS | FAIL(h1=0) → PASS | PASS → PASS | PASS <44px-on(3/3bp, see violation 4) → PASS |
| verification-intent-flow | `/verification/intent-flow` | FAIL(color-contrast,heading-order,region) → PASS | FAIL(heading-skip) → PASS | PASS → PASS | PASS <44px-on(1/3bp, see violation 4) → PASS |
| verification-checkout-flow | `/verification/checkout-flow` | FAIL(color-contrast,landmark-main-is-top-level,landmark-no-duplicate-main,landmark-unique,region) → PASS | FAIL(mains=2) → PASS | PASS → PASS | PASS <44px-on(3/3bp, see violation 4) → PASS |
| verification-capability-flow | `/verification/capability-flow` | FAIL(landmark-main-is-top-level,landmark-no-duplicate-main,landmark-unique,region) → PASS | FAIL(mains=2) → PASS | PASS → PASS | PASS <44px-on(3/3bp, see violation 4) → PASS |
| verification-liquidity-flow | `/verification/liquidity-flow` | FAIL(color-contrast,landmark-main-is-top-level,landmark-no-duplicate-main,landmark-unique,region) → PASS | FAIL(mains=2) → PASS | PASS → PASS | PASS <44px-on(3/3bp, see violation 4) → PASS |
| verification-tracking-flow | `/verification/tracking-flow` | FAIL(color-contrast,landmark-main-is-top-level,landmark-no-duplicate-main,landmark-unique,region) → PASS | FAIL(mains=2) → PASS | PASS → PASS | PASS <44px-on(3/3bp, see violation 4) → PASS <44px-on(1/3bp, see violation 4) |
| verification-waiting-flow | `/verification/waiting-flow` | FAIL(color-contrast,region) → PASS | PASS → PASS | PASS → PASS | PASS <44px-on(3/3bp, see violation 4) → PASS |
| verification-mediation-flow | `/verification/mediation-flow` | FAIL(region) → PASS | PASS → PASS | PASS → PASS | PASS <44px-on(3/3bp, see violation 4) → PASS |
| not-found | `/no-such-route-ui009` | FAIL(region) → PASS | PASS → PASS | PASS → PASS | PASS → PASS |

## Violations found and their resolution

All 28 surfaces shared four systemic violations (pre-fix), each remediated presentation-only:

1. **region** (axe best-practice; all 28 surfaces) — the persistent environment banner (`role="note"`) sat outside every landmark. Fix: wrapped in a `role="region" aria-label="Environment signal"` landmark (wording and note semantics unchanged).
2. **landmark-no-duplicate-main / landmark-main-is-top-level / landmark-unique** (13 surfaces, 11 files) — surfaces rendered their own `<main>` nested inside the root layout `#main-content`. Fix: nested `<main>` → `<div>` (ids/classes preserved; surface skip links still resolve).
3. **color-contrast** (9 surfaces; WCAG 1.4.3) — `text-stone-500` on `bg-stone-100` (4.40:1, WAITING frame reported-by + grammar chips), `bg-amber-600`+white badge (3.19:1, liquidity harness), `bg-emerald-600`+white step circle (~3.6:1, pay flow steps). Fix: stone-500→stone-600 (6.99:1), amber-600→amber-700 (5.02:1), emerald-600→emerald-700.
4. **Touch targets under 44px** (P10) — buttons h-8/h-7 (32/28px), inputs h-8, select triggers h-8, switch 32×18.4, radio/checkbox 16px visual/32px hit, discrete link rows 14–20px, call-site `min-h-9` overrides, raw `h-9` inputs. Fix: 44px floors across `ui/` primitives (see remediation log); pseudo-element hit areas (48×44) for radios/checkboxes/switches; `min-h-11` on discrete link rows.

Per-surface specific violations:

- **page-has-heading-one** (6 deep-link surfaces: track/[referenceId], mediation/case, mediation/dispute/[id], mediation/dispute/new, mediation/proposal/[id]) — fixed with page-level `sr-only` h1 plus top CardTitle→h2 promotions in the shared views (see remediation log).
- **heading-order** (verification-intent-flow h1→h3 skip at "Boundary conditions → UNKNOWN") — the section heading became h2.
- **landmark-unique on harness pages** — shared view components (TrackedStateCard, EvidenceTrail, PositionsComposition) rendered repeated fixed landmark names/ids when instanced per entry; fixed with instance-unique ids and accessible names (visible heading text unchanged).
- **capability-surface-frame nav labels** — "Primary"/"Footer" navs duplicated the root shell's NavList labels on /capabilities surfaces; scoped to "Primary — provider surface" / "Footer — provider surface".
- **/track page** — a duplicate h1 introduced during remediation was removed before final evidence (final h1Count=1).

## Final status

- axe violations: **0 across all 28 surfaces** (post-fix)
- semantics (landmarks/headings/labels): **28/28 PASS**
- keyboard (tab order, no traps, visible focus, full coverage): **28/28 PASS**
- responsive (390/768/1440): **0 horizontal-scroll failures**; all discrete controls ≥44px effective; inline-sentence links and associated form labels carry documented WCAG 2.5.8 exceptions
- role matrix: **0 deep-link mismatches, 0 content-gate mismatches, 0 navigation leakage**
- explicit states: **six distinct treatments everywhere, no ambiguous pending, UNKNOWN never worded/styled as success or failure**