# UI-010 — the acceptance roll-up (verdict per work-order criterion)

Work order: spec/product/work-orders/UI-010.md, "Acceptance". Each verdict cites
the artifact that carries the evidence. Criteria are quoted in condensed form;
the full text is the work order's.

---

## 1. "UI-001 through UI-009 are COMPLETE and UI-011 is COMPLETE (git merge facts authoritative)"

**VERIFIED — gate satisfied.** Git facts at base `2e3b831`: UI-001 (f934a76, PR
#6), UI-002 (5bff0d6, PR #10), UI-003 (ccf43dd, PR #13), UI-004 (35ef9fe, PR
#12), UI-005 (4ce0e74, PR #11), UI-006 (87b9672, PR #15), UI-007 (dd1399d, PR
#16), UI-008 (daeced3, PR #17), UI-009 (fd996c3, PR #21), UI-011 (0022405, PR
#34) — all merged ahead of the base; `spec/development-state/product-program-state.json`
records the same. UI-010's completion (this submission) constitutes program
closure *if* the Architect approves it.

## 2. "Objective end-to-end workflow evidence: reproducible, scripted workflows crossing surface boundaries, exercised in the designated environment with tooling, commands, and artifacts recorded"

**SATISFIED — with the two-leg structure recorded honestly.** The workflow
matrix was planned before execution (`evidence-plan.md` §4); every workflow
crosses ≥2 surface boundaries:

- WF-1 intent → capability → tracking (WAITING/IN_PROGRESS + A15 proof trail);
- WF-2 checkout → tracking (ACTION_REQUIRED offered → FAILED with reason);
- WF-3 checkout UNKNOWN + the fail-closed decision refusal;
- WF-4 waiting → tracking (WAITING → re-check → cancel recovery → terminal FAILED);
- WF-5 mediation → tracking (docket → matrix → dispute open → recourse trail → re-dispute denial);
- WF-6 oversight → liquidity (the AUTHORITATIVE-UNKNOWN aggregates vs quoted figures);
- WF-7 the browser-context honest UNKNOWN (pay compose → review → not-quotable; unknown-reference state);
- WF-8 role matrix + environment signal across every surface.

**Leg A** (`evidence/workflows/port-journeys.{json,md}` + transcript): WF-1..WF-6
driven through the product's own seven runtime adapters over the real composed
runtime — 62 assertions / 0 failed, A15 chain VERIFIED. **Leg B**
(`evidence/app-e2e/app-e2e.{json,md}`): WF-7..WF-8 plus the app's actual
presentations — 31 checks / 0 failed. Commands recorded in
`evidence-bundle-index.md`.

**The honest qualification (FINDING 2):** the intended runtime-backed
server-rendered reads do NOT exist in the running app — the UI-011 splice does
not reach the routes (dev or build), so the app's port calls all resolve the
transport-unavailable backing. The workflows crossing the runtime-backed
adapters are therefore evidenced on Leg A (where the same adapter classes
execute over the same composed runtime), and Leg B evidences the app's actual
honest-UNKNOWN behavior. No stop condition is hit (no protocol semantics were
touched to produce either leg; nothing is fabricated).

## 3. "Every consequential UI state carries a complete nine-question mapping record; unmapped count zero (UX contract §8)"

**SATISFIED.** `evidence/mapping-audit.json`: 66 consequential states enumerated
from the display-resolution layer + the frozen port types; 91 records parsed
across the eight mapping-record documents; **91/91 records carry all nine
answers**; the boundary/error presentations are verified present in the
records' re-anchoring sections; **unmapped consequential states = 0**.

## 4. "UNKNOWN, waiting, and recovery paths are exercised and evidenced, including at least one authoritative-UNKNOWN scenario rendered as unknown — never as success or failure (P5, P6)"

**SATISFIED.** The AUTHORITATIVE-UNKNOWN scenario: the operator oversight
aggregates — the A06/A07/A08 read surfaces genuinely cannot answer cross-provider
sums, and the runtime liquidity adapter presents `authority-unknown` values with
who-resolves + recheck-trigger, rendered as UNKNOWN (WF-6, Leg A; asserted
field-by-field). Additional authoritative-UNKNOWNs: the checkout post-DRAFT
UNKNOWN (cko-map-08, WF-3) and the intent no-answer (IMR-8, both legs). Waiting
and recovery: WF-4 (QUEUED snapshot with reason/expectation/actions; re-check
command; retry DENIED per INV-8-4; cancel recovery → terminal CANCELLED with
reason). Rendered-UNKNOWN honesty on the live app: B-3's checks (the pay
review's not-quotable UNKNOWN with reconciliation; the unknown-reference state
page's Unknown frame with the standing disambiguation) + the states pass
(`a11y-responsive/states.json`: dashed/amber UNKNOWN treatment, disambiguation,
reconciliation — never success/failure wording). The one latent
UNKNOWN-masking risk (FINDING 1's dispute read-back) is recorded and analyzed
for reachability in `evidence/app-e2e/findings.md` — unreachable in the shipped
app's state space today.

## 5. "The role matrix holds across all five roles with zero leakage, evidenced end-to-end (P8)"

**SATISFIED.** `evidence/app-e2e/app-e2e.json` (B-2): 28 surfaces × 6 audiences
= **168/168 deep-link cells correct** vs the implemented guards; zero
navigation leakage (the root shell renders least visibility for all six
audiences; the provider frame renders provider-only entries); zero cross-role
record content across 36 route × audience reads; the mediation record API
resolves viewers server-side. Role gates inside the runtime-backed ports are
additionally evidenced on Leg A (the liquidity operator/provider gates; the
dispute-initiation matrix authorizing customer+merchant only). **The recorded
UI-009 WAIVER-1 is re-verified unchanged** — the `/verification/mediation-flow`
declared-gate ([operator, administrator]) vs implemented-gate (unguarded)
disagreement on a verification harness that renders non-authoritative fixtures
only; carried in `deferral-ledger.md` with its recorded disposition request (the
Tech Lead's one-line guard decision). The error direction is under-exposure of
a tooling surface, not cross-role product-content leakage.

## 6. "Responsive evidence at all shared breakpoints and accessibility evidence at the agreed baseline, for every surface (P9, P10)"

**SATISFIED — re-verified fresh on the composed system** (UI-011 changed every
state presentation, so the prior evidence was not rolled forward unchanged):
`evidence/a11y-responsive/` — axe-core 4.13 (wcag2aa, wcag22aa,
best-practice): **0 violations on 26 of 27 healthy surfaces; 2 violations on
the two mediation surfaces (FINDING 5: the h1 gaps in the honest-unavailable
branches — a FINDING 2 consequence, disposition requested)**; the FINDING 3
surface's error-page violations excluded as n/a and recorded. Keyboard: 0
failures (no traps, full coverage, visible focus everywhere). Responsive at
390/768/1440: 0 horizontal-scroll failures; 0 discrete touch targets under
44px effective (the WCAG 2.5.8 exception classes — associated labels,
inline-in-sentence affordances — measured and recorded separately, as the
UI-009 evidence documented them). Reduced-motion: suppressed under
`prefers-reduced-motion` on all probed surfaces. Six display states distinct;
UNKNOWN frame honesty verified. Prior per-surface evidence: the UI-009 bundle
(`hardening/evidence/`), cited.

## 7. "Environment awareness is evidenced: the sandbox/production signal is correct, and no sandbox flow is presented as production financial execution (N4, §10)"

**SATISFIED — with FINDING 4 recorded.** The signal derives exclusively from
configuration: `/api/health` reports sandbox on the evidence instance; the
banner renders on every healthy surface; URL parameters and client storage
cannot re-label it (scripted attempts recorded); the controlled
`PAYSWAP_ENV=production` check flips /api/health and the dynamic pages
correctly. FINDING 4 (recorded): statically prerendered surfaces bake the
build-time banner — under a production-configured runtime with a sandbox-built
image, static pages show the stale Sandbox banner (the fail-safe direction).
No sandbox flow anywhere presents production financial execution: the
consequential wording carries the sandbox framing (the pay flow's boundary
notes; the N4-checked banner wording), and no production financial execution is
claimed or performed anywhere in this bundle.

## 8. "Evidence is objective and reproducible; anecdotal-only claims do not satisfy any criterion"

**SATISFIED.** Every criterion above cites a recorded artifact produced by a
recorded command (`evidence-bundle-index.md`); the bundle contains no
anecdote-only claims. The five findings are themselves objectively evidenced
(live-app probes, a code-inspected root cause, and a runtime probe), and the
bundle's honesty notes state exactly which legs evidence what.

## 9. "Architect closure is recorded through the governed process"

**SUBMITTED — this directory.** `architect-closure-record.md` carries the
closure record and the program-level nine-question answers;
`proposed-product-program-state.json` carries the PROPOSED machine-state update
(UI-010 merged / program closed) — a proposal only: the Tech Lead governs the
actual state flip through the governed merge process. SYSTEM closure remains
governed by spec/governance/SYSTEM-CLOSURE.md and is explicitly NOT claimed.

---

## Stop-condition assessment

Recorded in `evidence/app-e2e/findings.md`: **none of the work order's stop
conditions is hit** — no protocol semantics were altered to evidence any
workflow; no unmapped consequential state exists; no UNKNOWN is masked as
success or failure anywhere observed (the one latent risk is recorded with its
reachability analysis); no role leakage exists; no evidence gap required
fabrication. The five findings are honest evidence, recorded with requested
dispositions — the opposite of papering over.
