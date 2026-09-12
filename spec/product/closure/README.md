# UI-010 — the Architect closure submission for the payswap3-product program

Status: SUBMITTED (this directory is UI-010's owned surface: the end-to-end UX closure evidence bundle and the closure submission; the Tech Lead independently verifies, integrates, and merges — nothing here flips machine state by itself)
Work order: spec/product/work-orders/UI-010.md
Base: main @ 2e3b8314f3d1532b6032f9e5c93bf0aef9cd2e90 (UI-001..UI-009 + UI-011 all merged per git facts; the dependency gate)
UX contract: spec/product/ux-architecture-v0.2.md (v0.2 product-layer; protocol v0.1 frozen)

---

## What this submission asks the Architect to close

The **payswap3-product program** (UI-001 through UI-010): the product/UI layer of
PaySwap as an interaction layer over the frozen protocol — with the objective,
end-to-end UX closure evidence this bundle carries.

This is the PRODUCT program closure. SYSTEM closure remains governed by
spec/governance/SYSTEM-CLOSURE.md (the three-layer gate: frozen protocol,
product, deployment/operations — SYS-001 reconciliation, SYS-002 full-system
dogfood, deployment readiness). Nothing in this submission claims or performs
SYSTEM closure.

## The bundle in one page

- **Evidence plan** (written before execution): `evidence-plan.md`.
- **Evidence bundle index** (every artifact + the command that produced it):
  `evidence-bundle-index.md`.
- **Acceptance roll-up** (verdict per UI-010 acceptance criterion):
  `acceptance-rollup.md`.
- **Integration findings** (five, all objective, none papered over):
  `evidence/app-e2e/findings.md`.
- **Deferral ledger** (the honest deferrals + requested dispositions):
  `deferral-ledger.md`.
- **Proposed machine-state update** (a PROPOSAL — the Tech Lead governs the
  actual flip): `proposed-product-program-state.json`.
- **The closure record** (the nine-question program-level answers + the
  submission): `architect-closure-record.md`.

## The honest headline

The composed product satisfies the UX contract's presentation discipline
end-to-end: every surface renders exactly one explicit display state; UNKNOWN is
a first-class state everywhere it appears (never success, never failure); the
role matrix holds with zero leakage across all five roles (168/168 deep-link
cells, zero navigation leakage, zero cross-role record content); responsive and
accessibility evidence exists at the agreed baseline for every surface (fresh
re-verification on the composed system); every consequential state carries a
complete nine-question mapping record (66 states enumerated, 91 records, zero
unmapped); the environment signal derives exclusively from configuration and
cannot be spoofed; and the full workflows (intent → authorize → tracking/evidence,
checkout, waiting/recovery, mediation/dispute, authoritative-UNKNOWN) are
evidenced reproducibly over the real composed runtime through the product's own
seven runtime adapters.

The bundle also carries **five objective integration findings** that the
Architect must see before closing (all evidenced, all product-layer, none
touching protocol semantics): the UI-011 splice does not actually reach the
running app's routes (every port call in the live app resolves the honest
transport-unavailable backing — the runtime composes but serves nothing); the
composition root's `drain()` halts the worker without executing queued commands;
`/verification/liquidity-flow` returns HTTP 500; statically prerendered surfaces
bake the build-time environment banner; and the mediation surfaces'
unavailable branches lack level-one headings. The first two make the
already-recorded SYS-001 deferral (the browser/surface transport binding)
**more** urgent, not less: the intended runtime-backed server reads do not
currently exist in the running app, and the app's uniform honest-UNKNOWN
presentation is correct precisely because nothing was wired incorrectly at the
presentation layer.

The submission's judgment — stated plainly for the Architect to accept or
refuse: **the UX contract's product-layer obligations are met and evidenced; the
integration defects are real, recorded, bounded to the product layer, and carry
requested dispositions; none of the work order's stop conditions is hit.**
Closure of the product program is proposed with the deferral ledger as its
honest companion.

## How to re-verify (the bundle is reproducible)

From the repository root at this branch (Node ≥ 22 with native TS stripping;
Playwright + axe-core installed under hardening/tools/):

```bash
bun install && bun run build
mkdir -p .next/standalone/.next && cp -r .next/static .next/standalone/.next/
(cd .next/standalone && PORT=3210 HOSTNAME=127.0.0.1 nohup node server.js &)

cd spec/product/closure/tools
node --import ./alias-loader.mjs probe-drain.mjs            # FINDING 1
node --import ./alias-loader.mjs product-port-journeys.mjs  # Leg A: WF-1..WF-6
node gen-journey-md.mjs
node app-e2e-audit.mjs                                      # Leg B: B-0..B-6
node env-signal-check.mjs                                   # the signal derivation + FINDING 4
node a11y-responsive-audit.mjs                              # the full a11y/responsive re-verification
node --import ./alias-loader.mjs mapping-audit.mjs          # the mapping roll-up
```

Every artifact referenced by `evidence-bundle-index.md` is regenerated by these
commands. The full evidence-freshness caveat is recorded there (two screenshots
are committed renderings; every JSON/MD artifact is regenerable).
