# UI-009 hardening evidence bundle

Produced by the UI-009 responsive/accessibility/role-correctness hardening pass (branch `ui-009/hardening-pass`, base `d81c07b`). Consumed by UI-010.

## Layout

- `evidence/violation-ledger.md` — per-surface × per-check pre-fix → post-fix status and the systemic violation list.
- `evidence/accessibility/` — per-surface axe JSON (pre-fix violations + full post-fix result) plus `MANUAL-CHECKLIST.md` (WCAG 2.2 AA coverage, assumption flags, reduced-motion, screen-reader sanity).
- `evidence/responsive/` — per-surface per-breakpoint JSON + `all-surfaces.csv` (scrollWidth vs innerWidth, effective touch-target measurements with pseudo hit areas; documented 2.5.8 exceptions).
- `evidence/role-matrix.md` — role × surface × deep-link matrix (168 cells), content gates, navigation per audience, findings.
- `evidence/explicit-states.md` — six-state distinctness, UNKNOWN guarantees, every "pending" occurrence classified.
- `evidence/remediation-log.md` — one entry per fix (R1–R14): surface, violation, fix, files touched.
- `evidence/waivers.md` — waiver candidates with rationale (no silent waivers).
- `evidence/raw/` — post-fix raw audit JSON (a11y, keyboard, responsive, roles, states).
- `evidence/raw-prefix/` — pre-fix raw audit JSON (archived before remediation).
- `tools/` — the audit harness itself: `surfaces.mjs` (surface registry + expected access matrix), `audit.mjs` (a11y/keyboard/responsive/roles/states passes), `analyze.mjs` (pre-fix summary), `gen-evidence.mjs` (evidence generator). Re-runnable: `node audit.mjs <pass>` against a dev server on localhost:3000.

## Tooling

Playwright 1.62 (Chromium 1234) + axe-core 4.13 (`wcag2aa`, `wcag22aa`, `best-practice` tags) + custom DOM probes (semantics, keyboard walk with focus-outline capture, responsive metrics, effective touch-target measurement including `::after` hit regions, live-region/state probes). Scoped verification: `bunx tsc --noEmit` (0 errors), `bun run build` (green), agent-browser E2E golden paths.
