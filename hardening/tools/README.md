# UI-009 audit harness

Re-runnable audit tooling that produced the evidence bundle in `../evidence/`.

- `surfaces.mjs` — the audited surface registry (routes, fixture ids, owner audiences, expected deep-link access matrix, state-coverage reference pages).
- `audit.mjs` — the five passes: `node audit.mjs <a11y|keyboard|responsive|roles|states>`. Requires the dev server on localhost:3000 (`bun run dev` at repo root) and playwright 1.62 + axe-core installed here (`bun install`). Writes JSON to `../evidence/raw/`.
- `analyze.mjs` — pre-fix findings summary (markdown).
- `gen-evidence.mjs` — regenerates the markdown/CSV evidence documents from `raw/` and `raw-prefix/`.
- `kb-debug.mjs` — single-surface keyboard-walk debugger.

Browser binaries: Playwright 1.62 / Chromium 1234 (`~/.cache/ms-playwright`). The 44px touch-target probe measures effective hit areas including absolute-positioned `::after` regions and excludes sr-only affordances; the role gate uses record-level denial signatures.
