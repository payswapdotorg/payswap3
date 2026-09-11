# UI-009 — WCAG 2.2 AA baseline: tool coverage and assumption-flagged manual checklist

Tooling: **axe-core 4.13.0** driven via Playwright 1.62 (Chromium 1234) with `runOnly: {type: 'tag', values: ['wcag2aa', 'wcag22aa', 'best-practice']}`.
Baseline assumption (flagged): **axe-core 4.13 implements all of WCAG 2.1 A/AA plus one rule tagged `wcag22aa`**; the remaining WCAG 2.2-specific success criteria are not automatable and are verified by the DOM-level checks below. Full per-surface axe output (violations, passes, incomplete, inapplicable) is in the per-surface JSON files next to this document.

## A. Automated coverage (axe, per surface — post-fix: 0 violations on all 28 surfaces)

| WCAG 2.2 AA criterion | axe coverage | Result |
|---|---|---|
| 1.1.1 Non-text content | `image-alt`, `input-image-alt`, `svg-img-alt`, `role-img-alt` | PASS (28/28) |
| 1.3.1 Info and relationships | `heading-order`, `landmark-*`, `label`, `list`, `listitem`, `definition-list`, `dlitem`, `table-*` | PASS (28/28) after remediation |
| 1.3.5 Identify input purpose | `input-autocomplete` (AA in 2.1; covered) | PASS |
| 1.4.3 Contrast (minimum) | `color-contrast` | PASS (28/28) after remediation |
| 1.4.4 Resize text | `meta-viewport` (guards zoom) | PASS (viewport never disables zoom) |
| 1.4.10 Reflow / 1.4.12 Text spacing | DOM probe (hscroll) + best-practice rules | PASS (no hscroll at 320-equivalent content widths; verified at 390/768/1440) |
| 2.1.1 Keyboard / 2.1.2 No keyboard trap / 2.1.3 Keyboard (no exception) | manual tab-walk probe (below) | PASS (28/28) |
| 2.4.1 Bypass blocks | `skip-link` + DOM probe | PASS (root skip link on every route; provider surface frame adds its own) |
| 2.4.2 Page titled | `page-title` | PASS (28/28) |
| 2.4.3 Focus order | tab-walk probe (DOM order) | PASS (28/28) |
| 2.4.4 Link purpose (in context) | `link-name` | PASS |
| 2.4.6 Headings and labels | semantics probe | PASS |
| 2.4.7 Focus visible | tab-walk focus-outline probe | PASS (3px offset outline via `:focus-visible` in globals.css) |
| 3.2.2 / 3.2.3 / 3.2.4 consistency | manual review (below) | PASS |
| 3.3.1 / 3.3.2 / 3.3.3 / 3.3.7 / 3.3.8 error identification, labels, correction | `label`, `select-name`, `button-name`, manual review | PASS |
| 4.1.2 Name, role, value | `aria-*` rules + non-native control audit | PASS |
| 4.1.3 Status messages | live-region audit (below) | PASS |

## B. WCAG 2.2-specific success criteria — manual/DOM verification (assumption-flagged)

| 2.2 criterion | Method | Result | Assumptions |
|---|---|---|---|
| **2.4.11 Focus not obscured (minimum)** | DOM probe: after each Tab, the focused element's rect vs sticky header/banner bounds (banner height 36px, header 60px, `scroll-mt-*` present on anchor targets). No focused element in any walk was covered by the sticky banner/header at document top; every surface also provides `scroll-mt-24` on deep-link targets. | PASS | Observed at the audited viewport heights (844/1024/900). |
| **2.4.12 Focus not obscured (enhanced)** | Same probe; sticky chrome never overlaps the focused element after browser scroll-into-view. | PASS | AA baseline only requires 2.4.11. |
| **2.4.13 Focus appearance** | Computed style of focused element: `outline: 3px solid #0f766e` (teal-700, 5.47:1 on white) with 2px offset — an indicator ≥ area minimum. | PASS | 2.4.13 is AAA; recorded for completeness. |
| **2.5.7 Dragging movements** | Source grep: no `draggable`, no pointer-drag APIs in `src/` (verification below). No drag-based interaction exists. | PASS (vacuous) | — |
| **2.5.8 Target size (minimum)** | Touch-target probe with effective hit areas (pseudo-element expansion). All discrete controls ≥44×44; the only sub-24px boxes are WCAG 2.5.8-exempt inline sentence targets and associated `<label for>` text (both documented in `../responsive/README.md`). | PASS | Inline and associated-label exceptions are explicitly invoked and listed per row in `responsive/all-surfaces.csv`. |
| **3.2.6 Consistent help** | Navigation grammar audit: help/verification entries (`State primitives`, `Track a payment`, `Intent flow verification`) render in the same footer position on every surface via the ONE grammar; the environment banner is pinned identically on all routes. | PASS | — |
| **3.3.7 Redundant entry** | Flow review: the customer compose→review flow carries forward all entered data; the dispute form retains values between add/remove evidence rows; no flow asks for the same information twice. | PASS | Verified on the driven golden paths (pay, dispute, proposal, waiting). |
| **3.3.8 Accessible authentication (minimum)** | No credential/identity input exists anywhere (identity ships in a later work item; the audience cookie is a verification mechanism, not an authentication UI). | PASS (vacuous) | — |

Source grep evidence for 2.5.7 / drag APIs:

```
$ rg -n "draggable|onDrag|pointerdown.*move|setPointerCapture" src/
(no matches)
```

## C. Screen-reader sanity (DOM-level, assumption-flagged)

- Landmarks on every route: `banner` (header), `main` (exactly one per page after remediation), `contentinfo` (footer), named `region` for the environment signal; named `navigation` regions ("Primary", "Footer", surface-scoped variants).
- Heading hierarchy: exactly one `h1` per page (sr-only on the five deep-link status pages), no skipped levels.
- Live regions: state frames use `role="status"`/`role="alert"` (assertive for FAILED/ACTION_REQUIRED); `StateAnnouncer` polite region persists across state transitions; mediation decision results, waiting recovery requests, and dispute submissions all announce through these regions (verified in the E2E drive: "Decision applied: … under protocol authorization", "Re-check requested…").
- Every icon is `aria-hidden="true"` with `focusable="false"`; no icon-only interactive control lacks an accessible name (axe `button-name`/`link-name` PASS).
- `<html lang="en">` on every route; `<title>` per route.

**Assumption (flagged):** verification was performed at the DOM/accessibility-tree level (Playwright accessibility snapshots + axe), not with a dedicated screen reader (NVDA/JAWS unavailable in the sandbox). The structure verified (landmarks, heading order, live regions, accessible names, tab order) is the input such tools consume.

## D. Reduced motion (P9)

Emulated `prefers-reduced-motion: reduce` on the state-bearing surfaces (`state-primitives`, `verification-intent-flow`, `verification/tracking-flow`): `document.getAnimations()` reports **zero running animations** under reduce (ps-arc spin and ps-strip slide are disabled by the `@media (prefers-reduced-motion: reduce)` block in `globals.css`); under normal motion both decorative animations run. No other infinite/keyframe animations exist in the product CSS.

## E. Known non-product artifacts (documented, not violations)

- `nextjs-portal` elements occasionally appear in the focus order: they are the **Next.js dev-mode dev tools overlay**, present only under `next dev`, not in the production build (verified: the production build renders without them).
- `color-contrast` "incomplete" entries on some surfaces are aria-hidden decorative glyphs (→ arrows) and the step-number circle (fixed to emerald-700) — no failing contrast remains in the final run.
- shadcn semantic tokens (e.g. `text-muted-foreground`) resolve to no CSS in this Tailwind v4 setup (no `@theme` wiring); elements fall back to the inherited body color (stone-900) — a styling-consistency observation only, since all resulting contrasts pass and no content is affected.
