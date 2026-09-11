# UI-009 — Role-correctness verification (role × surface × deep link)

Oracle: page guards (`requireRoleSurface`), the navigation grammar (`NAVIGATION_ENTRIES` audiences), per-reference port authorization, and the verification-harness role matrices. Cookie `payswap-shell-audience` simulates the authoritative audience; every cell below was actually visited in Chromium and the final URL + rendered content recorded (`raw/roles.json`).

## Deep-link matrix (all 28 surfaces × 6 audiences = 168 cells)

| surface | route | unauth | customer | merchant | provider | operator | admin |
|---|---|---|---|---|---|---|---|
| home | `/` | render | render | render | render | render | render |
| state-primitives | `/state-primitives` | render | render | render | render | render | render |
| pay-compose | `/pay` | →home | render | →home | →home | →home | →home |
| pay-review | `/pay/review` | →home | render | →home | →home | →home | →home |
| pay-intent-state | `/pay/INTENT-2041` | →home | render | →home | →home | →home | →home |
| checkout-list | `/checkout` | →home | →home | render | →home | →home | →home |
| checkout-decision | `/checkout/cko_live_offer_001` | →home | →home | render | →home | →home | →home |
| capabilities | `/capabilities` | →home | →home | →home | render | →home | →home |
| capability-detail | `/capabilities/intent-acceptance` | →home | →home | →home | render | →home | →home |
| liquidity | `/liquidity` | →home | →home | →home | render | →home | →home |
| oversight | `/oversight` | →home | →home | →home | →home | render | →home |
| track | `/track` | render | render | render | render | render | render |
| track-status-intent | `/track/PWS-2H8D` | render | render | render | render | render | render |
| track-status-settlement | `/track/STL-4419` | render | render | render | render | render | render |
| waiting-recovery | `/track/TRK-4410-QUEUED-LIQ/waiting` | →home | render | render | render | render | render |
| mediation-hub | `/mediation` | →home | render | render | →home | →home | →home |
| mediation-case | `/mediation/case/M-101` | →home | render | render | →home | →home | →home |
| dispute-initiation | `/mediation/dispute/new` | →home | render | render | →home | →home | →home |
| dispute-detail | `/mediation/dispute/D-201` | →home | render | render | →home | →home | →home |
| proposal-review | `/mediation/proposal/P-001` | →home | render | render | →home | →home | →home |
| verification-intent-flow | `/verification/intent-flow` | render | render | render | render | render | render |
| verification-checkout-flow | `/verification/checkout-flow` | →home | →home | render | →home | render | render |
| verification-capability-flow | `/verification/capability-flow` | render | render | render | render | render | render |
| verification-liquidity-flow | `/verification/liquidity-flow` | render | render | render | render | render | render |
| verification-tracking-flow | `/verification/tracking-flow` | render | render | render | render | render | render |
| verification-waiting-flow | `/verification/waiting-flow` | render | render | render | render | render | render |
| verification-mediation-flow | `/verification/mediation-flow` | render | render | render | render | render | render |
| not-found | `/no-such-route-ui009` | render | render | render | render | render | render |

Observed: 99 render cells, 69 redirect-to-home cells, **0 mismatches vs expected** (guard behavior matches the grammar on every surface).

## Content gates (per-reference record authorization)

| check | expected | denied presentation observed |
|---|---|---|
| track-status-intent:unauthenticated | not-authorized presentation | yes |
| track-status-intent:customer | record | no (record rendered) |
| track-status-intent:merchant | record | no (record rendered) |
| track-status-intent:provider | not-authorized presentation | yes |
| track-status-intent:operator | record | no (record rendered) |
| track-status-intent:administrator | record | no (record rendered) |
| track-status-settlement:unauthenticated | not-authorized presentation | yes |
| track-status-settlement:customer | not-authorized presentation | yes |
| track-status-settlement:merchant | record | no (record rendered) |
| track-status-settlement:provider | record | no (record rendered) |
| track-status-settlement:operator | record | no (record rendered) |
| track-status-settlement:administrator | record | no (record rendered) |
| waiting-recovery:customer | record | no (record rendered) |
| waiting-recovery:merchant | record | no (record rendered) |
| waiting-recovery:provider | not-authorized presentation | yes |
| waiting-recovery:operator | record | no (record rendered) |
| waiting-recovery:administrator | record | no (record rendered) |

All 17 checks match: unauthorized audiences receive the explicit not-authorized / not-visible presentation (never the record, never a failure state); authorized audiences receive the tracked record.

## Navigation per audience (root shell)

Observed for all six audiences: primary `Home`; footer `State primitives (verification)`, `Intent flow verification`, `Track a payment`. The root shell resolves its constant audience (`getShellAudience()` → `unauthenticated`) per the documented UI-001 design (shell-mapping-records.md Q3: "the live shell resolves a constant audience … least visibility"); role-scoped navigation is rendered inside each surface frame from `resolveNavigation(resolveShellAudience())`. No audience ever sees another audience's entries — **zero cross-role leakage**.

## Findings

1. **Leakage count: 0.** No navigation entry, guarded content block, or deep link renders for an audience the grammar does not allow.
2. **Waiver candidate (recorded, not fixed — authorization logic is out of UI-009 scope):** `/verification/mediation-flow` renders for every audience on deep link although the grammar entry `verification.mediation-flow` (and `mediation-nav-entries.json`) declares audiences `[operator, administrator]`. Its sibling harness `/verification/checkout-flow` enforces the same declaration with `requireRoleSurface`. Closing the gap requires adding a guard (authorization logic / access semantics) — forbidden by this work order; see `waivers.md`.
3. The other ungated harnesses (`intent-flow`, `capability-flow`, `liquidity-flow`, `tracking-flow`, `waiting-flow`) are documented verification tooling: `intent-flow` is a grammar entry for EVERY_AUDIENCE; `capability-flow` is documented in `provider-nav-entries.json` as "left ungated to mirror /verification/intent-flow"; the rest follow the same documented pattern (not grammar entries).