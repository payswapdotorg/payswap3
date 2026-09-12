# UI-010 — the Architect closure record (the payswap3-product program)

Submitted for Architect approval through the governed process. The Tech Lead
independently verifies, integrates, and merges; this record is the submission's
substance — the program-level answers to the dogfooding protocol's nine
reconciliation questions (spec/governance/dogfooding-protocol.md), the closure
judgment, and what closure does and does not claim.

---

## The program being closed

**payswap3-product** — the product/UI layer of PaySwap over the frozen protocol
(v0.1, spec/architecture/v0.1/): the application shell and navigation grammar
(UI-001), the customer intent surface (UI-002), merchant checkout (UI-003),
provider capabilities (UI-004), tracking and evidence (UI-005), waiting and
recovery (UI-006), liquidity/credit/queue visibility (UI-007), mediation and
dispute/recourse (UI-008), the responsive/accessibility/role-correctness
hardening pass (UI-009), the protocol port re-anchoring to the composed runtime
(UI-011), and this closure evidence bundle (UI-010). Git merge facts for every
item are in `acceptance-rollup.md` criterion 1.

## The program-level nine reconciliation questions

1. **Protocol object.** The program's surfaces present the frozen protocol's
   objects — PaymentIntents (A01) and their A15 evidence chain, capabilities
   (A03), reservations (A05), liquidity/credit/queues (A06/A07/A08), clearing
   batches and obligations (A09/A10, the dispute primitive), settlements and
   rails (A12/A13), and the gateway's admission receipts. The closure evidence
   exercises these through the product's own seven runtime adapters over the
   real composed runtime (Leg A: `evidence/workflows/port-journeys.md`) —
   submit → authorize → track, checkout reads and refusals, waiting/recovery,
   dispute initiation with the A15 DISPUTE_OPEN record, and the
   authoritative-UNKNOWN oversight aggregates.
2. **Owning authority.** Every consequential state's owning authority is
   recorded in the 91 nine-question mapping records (audited mechanically:
   `evidence/mapping-audit.json` — 66 consequential states enumerated from the
   display-resolution layer, zero unmapped). The product layer owns no
   financial truth anywhere (P11/N1): the evidence contains no counterexample —
   every workflow's figures, verdicts, and reason codes are the authorities'
   own reports.
3. **Runtime boundary.** The product's runtime boundary is the seven port
   adapters over the in-process composed runtime (server-side) and the honest
   transport-unavailable backing (browser context — the recorded SYS-001
   deferral). The closure evidence additionally established (FINDING 2) that
   the in-process registration does not reach the running app's routes — the
   app's uniform honest-UNKNOWN presentation is correct, but the intended
   server-side runtime reads do not currently exist at runtime; recorded with
   its requested disposition (deferral ledger D-2).
4. **Deployed component.** The evidence ran against the repository's documented
   runtime package (`node .next/standalone/server.js`, the Dockerfile runtime
   stage) and the plain-Node composition harness (the repo's established
   evidence pattern). The app's /api/health and /api/ready answered per the
   DEP-002 semantics throughout.
5. **Persistent state.** Leg A's workflows wrote real durable state: the
   per-domain SQLite stores under `var/ui010-journeys/`, the A15 evidence
   chain (VERIFIED, height 29, hash-chained), the gateway's admission receipts
   on the durable command path, and the DISPUTE_OPEN obligation transition.
   The app leg's honest denials wrote nothing (asserted: "nothing was
   recorded, nothing was mutated").
6. **UNKNOWN handling.** UNKNOWN is a first-class state everywhere the evidence
   probed: the authoritative-UNKNOWN oversight aggregates (with who-resolves +
   recheck-trigger), the checkout post-DRAFT UNKNOWN (cko-map-08), the intent
   no-answer (IMR-8), the browser-context not-transported and not-quotable
   presentations (WF-7), and the evidence-record no-answer view. Every one is
   rendered unknown — distinct label, dashed treatment, standing
   disambiguation — never success or failure (asserted in both legs + the
   states pass). The one latent masking risk (FINDING 1's dispute read-back)
   is recorded with its reachability analysis.
7. **Reconciliation.** Product-layer reconciliation is evidenced end-to-end:
   re-checks re-query and report what returns (including another UNKNOWN);
   replayed submissions dedupe through the gateway; the A15 chain verifies;
   the mapping records carry each state's reconciliation path; the three-layer
   (protocol/product/system) reconciliation remains SYS-001's governed work —
   the deferral ledger is the product layer's honest handoff into it.
8. **Evidence.** This bundle: the evidence plan (written first), the port
   journeys (62 assertions, 0 failed, chain VERIFIED), the built-app audit (31
   checks, 0 failed), the a11y/responsive re-verification (per-surface table),
   the mapping audit (0 unmapped), the environment-signal proof, the five
   findings, and the deferral ledger — every artifact with the command that
   produced it (`evidence-bundle-index.md`).
9. **User-visible state.** What users see, per role, was verified by
   observation on the running app (Leg B: the deep-link matrix, navigation,
   content presentations, the UNKNOWN wordings) and by the recorded snapshots
   and views on Leg A (the exact data the server components render for the
   runtime-backed presentations). The five roles see exactly their surfaces;
   unauthenticated visitors see least visibility; nobody sees fabricated
   state anywhere this bundle probed.

## The closure judgment (submitted for the Architect's decision)

**Proposed: the payswap3-product program is closed.**

- The UX contract's product-layer obligations are met and objectively
  evidenced end-to-end (acceptance roll-up: all nine criteria satisfied, with
  the two-leg workflow structure and FINDING 2 recorded honestly).
- No stop condition is hit: no protocol semantics were altered; no unmapped
  consequential state; no UNKNOWN masked as success or failure; no role
  leakage; no fabricated evidence.
- The five integration findings are real, evidenced, bounded to the product
  layer, and carry requested dispositions in the deferral ledger — the two
  material ones (D-2 FINDING 2, D-3 FINDING 1) belong to the SYS-001
  remediation path that the recorded browser-transport deferral already
  points at.
- The known limitations stand as recorded: the WCAG 2.2 AA baseline remains
  assumption-flagged for the Tech Lead to re-pin; the wave-2 authority gaps
  (area 19/20/21) present honestly-unavailable/denied surfaces; WAIVER-1's
  disposition is requested; the retained mock-era vocabulary members are
  documented in their records.

## What closure does NOT claim

- **No SYSTEM closure.** spec/governance/SYSTEM-CLOSURE.md governs that gate
  (deployment readiness, SYS-001 reconciliation, SYS-002 full-system dogfood,
  exact release revision verification); none of it is claimed here.
- **No production financial execution.** Every run in this bundle is sandbox;
  the production-signal check is a configuration-derivation check.
- **No claim that the running app performs runtime-backed reads.** FINDING 2
  is the recorded opposite; the honest app presents UNKNOWN/denied everywhere
  its ports are called, and that honesty is itself part of what the evidence
  certifies.

## The governed-process statement

This record is submitted by the UI-010 work order's completion, which the work
order defines as constituting program closure. The Tech Lead independently
verifies this bundle, integrates the branch, and — on approving closure —
applies `proposed-product-program-state.json` to
`spec/development-state/product-program-state.json` through the governed merge
process. An Architect refusal to close is a recorded stop condition; this
submission exists to give the Architect everything needed to make that
decision honestly.
