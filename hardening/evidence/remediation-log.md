# UI-009 — Remediation log

One entry per fix. All fixes are presentation-only: ARIA attributes, focus/landmark/heading structure, contrast tokens, spacing/sizing for touch targets. No state wording, no mapping records, no authorization logic, no protocol types were touched.

## R1 — Environment banner landmark (fixes `region` on all 28 surfaces)

- **Surface:** every route (root layout chrome).
- **Violation:** axe `region` — the persistent environment banner (`role="note"`) rendered outside every landmark.
- **Fix:** wrapped the note in `<div role="region" aria-label="Environment signal">`; note semantics, wording, and sticky behavior unchanged.
- **Files touched:** `src/components/shell/environment-banner.tsx`.

## R2 — Nested `<main>` landmarks removed (fixes `landmark-no-duplicate-main`, `landmark-main-is-top-level` on 13 surfaces)

- **Surface:** checkout-list, checkout-decision, capabilities, capability-detail, liquidity, oversight, track, track-status-intent, track-status-settlement, verification-checkout-flow, verification-capability-flow, verification-liquidity-flow, verification-tracking-flow.
- **Violation:** surfaces rendered their own `<main>` inside the root layout's `<main id="main-content">`.
- **Fix:** nested `<main>` → `<div>` with identical ids/classes (surface skip links and layout preserved; exactly one `main` landmark per page remains).
- **Files touched:** `src/components/provider/capability-surface-frame.tsx`, `src/components/verification/liquidity-flow-harness.tsx`, `src/components/verification/tracking-flow-harness.tsx`, `src/app/(operator)/oversight/page.tsx`, `src/app/verification/checkout-flow/page.tsx`, `src/app/verification/capability-flow/page.tsx`, `src/app/(provider)/liquidity/page.tsx`, `src/app/track/[referenceId]/page.tsx`, `src/app/track/page.tsx`, `src/app/(merchant)/checkout/page.tsx`, `src/app/(merchant)/checkout/[checkoutId]/page.tsx`.

## R3 — Contrast: WAITING reported-by span (WCAG 1.4.3)

- **Surface:** state-primitives, track-status pages, waiting-recovery, dispute-detail, verification intent/tracking/waiting flows (every WAITING state frame).
- **Violation:** `text-stone-500` (#78716c) on `bg-stone-100` (#f5f5f4) = 4.40:1 < 4.5:1.
- **Fix:** `text-stone-600` (#57534e) = 6.99:1.
- **Files touched:** `src/components/state/waiting-state.tsx`.

## R4 — Contrast: grammar "Planned" chips on state-primitives (WCAG 1.4.3)

- **Surface:** state-primitives.
- **Violation:** chip `text-stone-500` on `bg-stone-100` = 4.40:1.
- **Fix:** `text-stone-600` = 6.99:1 (chip is active documentation content; the inert planned nav entries in the shell remain exempt as inactive components).
- **Files touched:** `src/app/state-primitives/page.tsx`.

## R5 — Contrast: liquidity harness "Redirected home" badge (WCAG 1.4.3)

- **Surface:** verification-liquidity-flow.
- **Violation:** white text on `bg-amber-600` (#d97706) = 3.19:1.
- **Fix:** `bg-amber-700` (#b45309) = 5.02:1.
- **Files touched:** `src/components/verification/liquidity-flow-harness.tsx`.

## R6 — Contrast: pay flow-steps active step circle (WCAG 1.4.3)

- **Surface:** pay-compose, pay-review, pay-intent-state.
- **Violation:** white 10px text on `bg-emerald-600` ≈ 3.6:1 (axe "incomplete").
- **Fix:** `bg-emerald-700` ≈ 5.0:1.
- **Files touched:** `src/components/pay/flow-steps.tsx`.

## R7 — Heading structure: page-level h1 on six deep-link surfaces (fixes `page-has-heading-one`)

- **Surface:** track-status-intent, track-status-settlement, mediation-case, dispute-detail, dispute-initiation, proposal-review.
- **Violation:** no `h1` on the page (views used h2/h3 + non-heading card titles).
- **Fix:** page-level `sr-only` `h1` per page, wording taken from each surface's own vocabulary ("Tracking {reference}", "Mediation thread", "Dispute record and recourse tracking", "Initiate a dispute", "Agent proposal review and decision"). A duplicate h1 briefly introduced on `/track` (which already had a visible h1) was removed before final evidence.
- **Files touched:** `src/app/track/[referenceId]/page.tsx`, `src/app/mediation/case/[caseId]/page.tsx`, `src/app/mediation/dispute/[disputeId]/page.tsx`, `src/app/mediation/dispute/new/page.tsx`, `src/app/mediation/proposal/[proposalId]/page.tsx` (+ reverted edit in `src/app/track/page.tsx`).

## R8 — Heading structure: shared view titles become real headings (hierarchy under the new h1s)

- **Surface:** the six deep-link surfaces plus the harnesses that reuse the views.
- **Violation:** top card titles were non-heading divs → h1→h3 skips and unlabeled heading starts.
- **Fix:** promoted the top `CardTitle`s to `h2` elements with identical classes/ids/content (mediation thread subject, proposal title, recourse tracker title, dispute form title ×2 states, tracked subject, track lookup result titles). Demoted nothing; wording unchanged.
- **Files touched:** `src/components/mediation/mediation-thread-view.tsx`, `src/components/mediation/proposal-review-view.tsx`, `src/components/dispute/recourse-tracker.tsx`, `src/components/dispute/dispute-initiation-form.tsx`, `src/components/track/tracking-status-view.tsx`, `src/components/track/lookup-result-views.tsx`.

## R9 — Heading order: intent-flow harness boundary section (fixes `heading-order`)

- **Surface:** verification-intent-flow.
- **Violation:** h1 → h3 skip at "Boundary conditions → UNKNOWN (P5)".
- **Fix:** the section heading became `h2`.
- **Files touched:** `src/components/verification/intent-flow-harness.tsx`.

## R10 — Touch-target floors on shared UI primitives (P10 44px bar)

- **Surface:** every surface using shadcn primitives.
- **Violation:** buttons 32/28px, inputs 32px, select triggers 32px, switch 32×18.4, radio/checkbox 16px visual with 32px hit area.
- **Fix:** Button sizes floored at min-h-11 (default/sm), min-h-12 (lg), min-h-9 (xs — ≥ AA 24px; no call site in the tree uses xs); icon buttons size-11/size-9. Input `h-8` → `min-h-11`. SelectTrigger `h-8`/`h-7` → `min-h-11`/`min-h-9`. Radio/Checkbox/Switch hit areas expanded from `after:-inset-x-3/-inset-y-2` to `after:-inset-x-4/-inset-y-3.5` (48×44 effective; visual size unchanged).
- **Files touched:** `src/components/ui/button.tsx`, `src/components/ui/input.tsx`, `src/components/ui/select.tsx`, `src/components/ui/switch.tsx`, `src/components/ui/radio-group.tsx`, `src/components/ui/checkbox.tsx`.

## R11 — Touch targets: call-site overrides and custom controls

- **Surface:** dispute-initiation, verification-mediation-flow.
- **Violation:** explicit `className="min-h-9"` overrides on Buttons (winning over the floor via class merge) and a raw `h-9` input in the dispute evidence rows.
- **Fix:** `min-h-9` → `min-h-11` at the call sites; raw input `h-9` → `min-h-11`.
- **Files touched:** `src/components/dispute/dispute-initiation-form.tsx`, `src/components/verification/mediation-flow-harness.tsx`.

## R12 — Touch targets: discrete link rows (P10 44px bar)

- **Surface:** track/status + verification surfaces (evidence trail rows), mediation surfaces (evidence lists), liquidity surfaces (evidence cells + harness section nav), checkout surfaces (receipt/harness links), capabilities surfaces (card titles, provenance links, frame nav/footer).
- **Violation:** standalone interactive link rows measured 14–20px tall.
- **Fix:** `inline-flex min-h-11 items-center` added to every discrete row-style link (succeeded-state evidence anchor, all evidence-list loops, capability provenance + dependency links, card-title links, capability frame primary/footer nav, checkout page links, checkout harness section nav + scenario links, liquidity harness section nav, liquidity role labels).
- **Files touched:** `src/components/state/succeeded-state.tsx`, `src/components/mediation/mediation-thread-view.tsx`, `src/components/mediation/proposal-review-view.tsx`, `src/components/dispute/recourse-tracker.tsx`, `src/components/liquidity/positions-table.tsx`, `src/components/provider/capability-provenance.tsx`, `src/components/provider/capability-detail-view.tsx`, `src/components/provider/capability-list-view.tsx`, `src/components/provider/capability-surface-frame.tsx`, `src/components/merchant/checkout-offer-view.tsx`, `src/components/merchant/checkout-state-presentation.tsx`, `src/app/(merchant)/checkout/page.tsx`, `src/app/(merchant)/checkout/[checkoutId]/page.tsx`, `src/components/verification/checkout-flow-harness.tsx`, `src/components/verification/liquidity-flow-harness.tsx`.
- **Deliberately NOT bumped (documented WCAG 2.5.8 inline exception):** links and sentence-level buttons embedded in running prose (e.g. "Re-check now", inline reference links inside paragraphs, route mentions inside harness table cells, the env-spoof probe link).

## R13 — Touch targets: capability "State presentation" disclosure trigger

- **Surface:** capabilities.
- **Violation:** CollapsibleTrigger 20px tall.
- **Fix:** `min-h-11` + horizontal padding.
- **Files touched:** `src/components/provider/capability-list-view.tsx`.

## R14 — Landmark uniqueness on multi-instance components (fixes residual `landmark-unique`)

- **Surface:** verification-tracking-flow, verification-liquidity-flow, capabilities, capability-detail.
- **Violation:** shared views (TrackedStateCard, EvidenceTrail, PositionsComposition) rendered repeated identical landmark names/ids when instanced per entry; the capability frame's "Primary"/"Footer" navs duplicated the root shell's NavList labels.
- **Fix:** instance-unique ids and accessible names derived from record data (`track-current-state-heading-<objectId>`, `evidence-trail-<firstRecordId>`, `Position composition (provider|mobile demo)`, `aria-label="Current state — <objectId>"`, `aria-label="Proof trail — <recordId>"`); frame nav labels scoped ("Primary — provider surface", "Footer — provider surface"). Visible heading texts unchanged.
- **Files touched:** `src/components/track/tracked-state-card.tsx`, `src/components/track/evidence-trail.tsx`, `src/components/liquidity/positions-table.tsx`, `src/components/verification/liquidity-flow-harness.tsx`, `src/components/provider/capability-surface-frame.tsx`.

## Post-fix re-verification

Every touched surface was re-audited with the same tooling: axe 0 violations (28/28), semantics 28/28 PASS, keyboard 28/28 PASS (full coverage, no traps, visible focus), responsive 0 hscroll with all discrete targets ≥44px effective, role matrix 0 mismatches, explicit states PASS. Scoped verification: `bunx tsc --noEmit` 0 errors; `bun run build` green; browser E2E golden paths driven (customer pay compose→review→submit→state; merchant checkout accept→receipt; track lookup; mediation proposal decision with role-gated controls; waiting re-check) with no console errors.
