# UI-010 Leg B — the built-app end-to-end audit (HTTP + browser)

Base URL: http://localhost:3210 (bun run build + node .next/standalone/server.js — the documented runtime package; the composed runtime constructed in-process, evidenced by the SQLite stores under .next/standalone/var/web-runtime/ and /api/health).
Tooling: Playwright (Chromium) + plain fetch.
Verdict: **31 checks, 0 failed.**

## B-0 the integration findings (evidenced live)

- PASS — FINDING 2 live evidence: /oversight (operator) renders the transport-unavailable presentation — the UI-011 splice does not reach the routes (full analysis in findings.md)
- PASS — FINDING 3 live evidence: /verification/liquidity-flow responds HTTP 500 (the mock-era invariant trips on the honest fail-closed backing)
- PASS — FINDING 2 live evidence: the dispute API (the one browser-reachable consequential write) resolves the transport-unavailable backing — no command is admitted

See `findings.md` for the full analysis (FINDINGS 1–3) and the deferral ledger for disposition.

## B-1 environment signal (N4, Section 10)

- PASS — /api/health reports env=sandbox (the fail-safe: PAYSWAP_ENV unset)
- PASS — /api/ready responds 200
- PASS — the sandbox environment banner renders on all 11 non-500 unauthenticated-reachable surfaces incl. the 404 page (the one 500 is the FINDING 3 route)
- PASS — URL parameters cannot spoof the environment signal (still Sandbox)
- PASS — client storage cannot spoof the environment signal (still Sandbox)

## B-2 role matrix (P8)

- PASS — deep-link matrix: 28 surfaces × 6 audiences = 168 cells; 0 mismatches vs the implemented guards
- PASS — declared-gate vs implemented-gate disagreements re-verified: verification-mediation-flow (the recorded UI-009 WAIVER-1, unchanged)
- PASS — record-content leakage: 36 route × audience reads, 0 instances of cross-role record content
- PASS — the mediation record API resolves the viewer server-side (unauthenticated → not-visible, never the record)
- PASS — a party viewer querying an unknown record receives the honest unavailable/not-visible answer (never fabricated content)

## B-3 WF-7 — the browser-context honest UNKNOWN

- PASS — the browser-context consequence quote renders UNKNOWN ("not quotable right now")
- PASS — the UNKNOWN carries its reconciliation path (Resolved by / Re-check)
- PASS — the submit is honestly unavailable (no submit control; the review stays closed)
- PASS — the pay flow carries the sandbox signal (the N4 framing for consequential wording)
- PASS — the unknown-reference intent state renders UNKNOWN (never 404, never failure)
- PASS — the UNKNOWN state frame carries the standing disambiguation (never success or failure)

Screenshots: `wf7-pay-review-unknown.png`, `wf7-intent-state-unknown.png`.

## B-4 the app's server-rendered presentations (the app as it is)

- PASS — /track/<reference> renders the honest no-record presentation with the transport note (never a fabricated record, never a 404 failure)
- PASS — /checkout renders the honest unavailable presentation (no fabricated offers)
- PASS — /capabilities states the honest reachability boundary (the adapter-boundary constants render)
- PASS — /oversight renders the honest fail-closed presentation (UNKNOWN-class, never fabricated aggregates)
- PASS — /liquidity renders the honest transport-unavailable presentation
- PASS — /mediation renders the honest unavailable docket with the wave-2 gap stated

## B-5 the dispute-initiation flow

- PASS — the dispute initiation is DENIED with the honest not-transported reason — nothing was recorded, nothing was mutated (P5: not a failure verdict)
- PASS — the unauthenticated actor is denied before any authority call (server-side audience resolution)
- PASS — the dispute-initiation surface fail-closes when the party docket is unreachable (the honest availability-unknown presentation — the initiation form is never offered without the docket's disputable references)
- PASS — the surface renders the explicit dispute-initiation unavailable section (aria-label present) rather than any fabricated initiation flow

Screenshot: `dispute-initiation-consequences.png`.

## B-6 navigation leakage

- PASS — the root shell renders least-visibility navigation for all six audiences (zero cross-role entries)
- PASS — the provider surface frame renders the provider navigation (own entries present, zero foreign entries)

Machine record: `app-e2e.json`.