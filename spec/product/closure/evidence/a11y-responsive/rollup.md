# UI-010 — responsive + accessibility re-verification roll-up

Base URL: http://localhost:3210; the composed app at base 2e3b831 (the built standalone server).
Standard: WCAG 2.2 AA (assumption-flagged) via axe-core 4.13 (wcag2aa, wcag22aa, best-practice); full keyboard operability with visible focus; semantic structure; reduced-motion support; responsive at 390/768/1440 (the UI-009 evidence widths spanning the shared breakpoint set); touch targets ≥ 44px effective.

## Verdicts

- axe violations across all surfaces: **2**
- semantics failures (non-500 surfaces): **2** — mediation-hub, dispute-initiation
- keyboard failures (traps / invisible focus / incomplete coverage; non-500): **0**
- horizontal-scroll failures at any width: **0**
- surfaces with DISCRETE touch targets under 44px effective (non-exempt): **0**
- under-44 measurements in the documented WCAG 2.5.8 exception classes (associated form labels; inline-in-sentence link/button affordances): 7 surfaces — state-primitives(3), pay-intent-state(3), track(3), waiting-recovery(3), verification-intent-flow(6), verification-tracking-flow(3), verification-mediation-flow(21) — recorded, not counted as failures
- reduced-motion: animations suppressed under prefers-reduced-motion on all probed surfaces: **yes**
- six display states distinct on /state-primitives: **yes**
- UNKNOWN frame honesty (dashed amber treatment + standing disambiguation + reconciliation): **yes**

## Per-surface results

| surface | HTTP | axe violations | semantics | keyboard | no-hscroll | <44px targets |
|---|---|---|---|---|---|---|
| home | 200 | 0 | PASS | PASS | PASS | 0 |
| state-primitives | 200 | 0 | PASS | PASS | PASS | 0 |
| pay-compose | 200 | 0 | PASS | PASS | PASS | 0 |
| pay-review | 200 | 0 | PASS | PASS | PASS | 0 |
| pay-intent-state | 200 | 0 | PASS | PASS | PASS | 0 |
| checkout-list | 200 | 0 | PASS | PASS | PASS | 0 |
| checkout-decision | 200 | 0 | PASS | PASS | PASS | 0 |
| capabilities | 200 | 0 | PASS | PASS | PASS | 0 |
| capability-detail | 404 | 0 | PASS | PASS | PASS | 0 |
| liquidity | 200 | 0 | PASS | PASS | PASS | 0 |
| oversight | 200 | 0 | PASS | PASS | PASS | 0 |
| track | 200 | 0 | PASS | PASS | PASS | 0 |
| track-status-intent | 200 | 0 | PASS | PASS | PASS | 0 |
| track-status-settlement | 200 | 0 | PASS | PASS | PASS | 0 |
| waiting-recovery | 200 | 0 | PASS | PASS | PASS | 0 |
| mediation-hub | 200 | 1 | FAIL | PASS | PASS | 0 |
| mediation-case | 200 | 0 | PASS | PASS | PASS | 0 |
| dispute-initiation | 200 | 1 | FAIL | PASS | PASS | 0 |
| dispute-detail | 200 | 0 | PASS | PASS | PASS | 0 |
| proposal-review | 200 | 0 | PASS | PASS | PASS | 0 |
| verification-intent-flow | 200 | 0 | PASS | PASS | PASS | 0 |
| verification-checkout-flow | 200 | 0 | PASS | PASS | PASS | 0 |
| verification-capability-flow | 200 | 0 | PASS | PASS | PASS | 0 |
| verification-liquidity-flow | 500 | 0 | n/a (500) | n/a (500) | PASS | 0 |
| verification-tracking-flow | 200 | 0 | PASS | PASS | PASS | 0 |
| verification-waiting-flow | 200 | 0 | PASS | PASS | PASS | 0 |
| verification-mediation-flow | 200 | 0 | PASS | PASS | PASS | 0 |
| not-found | 404 | 0 | PASS | PASS | PASS | 0 |

The HTTP-500 row is the FINDING 3 surface (see ../app-e2e/findings.md); its probes ran against the framework error page and are recorded as n/a rather than counted as failures of the composed surface.

Machine records: a11y.json, keyboard.json, responsive.json, states.json (this directory).
Prior per-surface evidence cited: the UI-009 bundle (hardening/evidence/) — this audit re-verifies the same standard on the UI-011-re-anchored composed system.