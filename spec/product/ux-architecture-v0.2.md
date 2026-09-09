PaySwap Product UX Contract — v0.2 (product-layer)

Status: ACTIVE — normative for the payswap3-product program
Layer: product/UI interaction layer (spec/product/)
Product-layer version: v0.2 (product-layer versioning only — see Section 2)
Protocol reference: frozen protocol architecture at spec/architecture/v0.1/ (protocol v0.1, frozen; never altered by this layer)
Applies to: work items UI-001 through UI-010 and every product surface they materialize
Enforcement: work-order acceptance criteria and stop conditions; mapping-record review (Section 8); the UI-009 hardening gate; the UI-010 closure gate
Change control: amendments only through the governed Tech Lead merge process; additive; layer boundaries preserved

1. Purpose and layer boundary

The product layer is PaySwap's interaction layer. README.md states it plainly: "Product/UI/UX: spec/product/, an interaction layer that must never become a second financial authority." This contract turns that sentence into testable rules for everything a user can see, do, and understand.

The UI presents protocol truth. It never originates, computes, decides, or overrides financial truth.
Every user-visible statement about money, state, or outcomes is a presentation of state owned by a protocol authority.
The product layer consumes authoritative state; it is never a source of financial state.
No product artifact (this contract, the roadmap, the ledger, the work orders, the machine state) redefines, extends, or reinterprets protocol semantics. The protocol is frozen at spec/architecture/v0.1/; protocol work orders WORK-001..WORK-033 are complete and are a separate bounded program.
2. Versioning rule (product-layer only)
The "v0.2" in this document's name and header denotes the product-layer UX contract version only.
It does not denote, imply, or replace any protocol version. The protocol remains frozen at v0.1 under spec/architecture/v0.1/.
Any phrasing that pairs the product-layer version label with the word "protocol" — reading protocol versioning into the product layer — is forbidden language in all product artifacts.
Product-layer versioning follows spec/product/SYSTEM-ARCHITECTURE-VERSIONING.md and spec/product/TECH-LEAD-VERSIONING.md; a product-layer version label never denotes or replaces protocol v0.1.
3. Normative language
MUST / MUST NOT — absolute. A violation blocks acceptance of the work item that contains it.
SHOULD — strong default. Deviation requires recorded rationale in the work item's evidence.
MAY — optional.
4. Roles and surfaces

Five roles use the product. Role correctness (P8) means each role sees only its surfaces.

Role	Surfaces visible to this role
Customer	Customer surfaces: intent creation, personal tracking and evidence, waiting/recovery, party-side mediation and dispute views
Merchant	Merchant surfaces: checkout and offer/quote handling, merchant-side tracking and evidence
Provider	Provider surfaces: capability presentation, provider-side positions and tracking
Operator	Operator surfaces: read-only operational visibility, exactly as permitted by the owning protocol authorities
Administrator	Administrator surfaces: administrative visibility, exactly as permitted; UI visibility is never protocol authority

Rules:

Role assignment is an authoritative input (identity/configuration). The UI MUST NOT self-assign, infer, or escalate roles.
Unknown or unauthenticated visitors get least visibility.
Every surface declares the roles that may see it; navigation, content, and deep links are all role-gated.
Operator and administrator visibility is bounded by what protocol authorities permit; the product layer grants no powers, only views.
5. Preservation rules (P1–P11)

These are the properties the product layer must preserve. Each is normative, and each maps into work-order acceptance criteria.

P1 — One shared navigation grammar

There is exactly one navigation grammar for the whole product.

It MUST be defined once, in the application shell (UI-001), and consumed by every surface.
Back/close semantics, primary navigation, and deep linking MUST behave identically everywhere.
Surfaces MUST NOT invent local navigation paradigms, ad hoc menus, or orphan routes.
Rejected as violations: per-surface navigation trees, inconsistent back behavior, routes reachable only through undocumented entry points.
P2 — Outcome-first interaction

Every consequential flow leads with the outcome the user is trying to achieve.

Flow entry states the desired outcome; mechanism and parameters are disclosed as needed to proceed.
A consequence review in plain language MUST precede any commitment; full terms are visible before the committing action.
Rejected as violations: mechanism-first wizards that bury the outcome, obscured terms, pre-selected commitments, dark patterns.
P3 — Progressive disclosure

Primary information and the primary action come first; depth is one deliberate step away.

Detail, history, and secondary parameters MAY be collapsed or secondary — never the decision-relevant consequences (P2).
Disclosure MUST NOT be used to hide obligations, fees, conditions, or failure modes.
Rejected as violations: consent to terms hidden behind collapsed controls, consequential parameters on a second undisclosed screen.
P4 — Explicit state

Every stateful thing the user sees is in exactly one explicit display state (Section 7). Ambiguous "pending" is forbidden.

Every stateful rendering MUST resolve to exactly one display state: SUCCEEDED, FAILED, UNKNOWN, WAITING, IN_PROGRESS, or ACTION_REQUIRED.
"Pending" without a qualifier MUST resolve to WAITING (with reason) or UNKNOWN (with reconciliation path).
State changes MUST be visible when they matter; no silent transitions on consequential outcomes.
Rejected as violations: spinners used as verdicts, "processing…" as a terminal screen, state that is neither success, failure, nor declared unknown.
P5 — Explicit UNKNOWN

UNKNOWN is a first-class state, surfaced as unknown — never as failure or success.

UNKNOWN MUST carry a distinct label, distinct visual treatment, and a plain-language explanation of what is not yet known.
UNKNOWN MUST NEVER be styled, worded, logged, or counted as success or failure.
Where the reconciliation path is known, UNKNOWN MUST show it: who will resolve it, and what triggers the re-check.
Absence of an answer (unreachable authority, no data yet) renders as UNKNOWN — not as zero, empty, failed, or cached success.
Rejected as violations: optimistic UI that renders hoped-for outcomes, error styling on unknown, default values standing in for authoritative answers.
P6 — Waiting and recovery clarity

When an outcome is not terminal, the user always knows what is happening and what they can do.

WAITING MUST carry: what is waiting, why (as reported by the owning authority), what happens next, and the available user actions — or an explicit "no action is available yet".
Time and progress claims MUST reflect authoritative information only; the UI MUST NOT present invented estimates as authoritative.
Recovery actions MUST be explicit and individually protocol-authorized (N3).
Non-terminal states MUST NOT dead-end: they progress, recover, or state explicitly that they are still unknown.
Rejected as violations: indefinite spinners, dead-end delay screens, recovery actions that silently change state.
P7 — Evidence visibility

Users can see the proof trail for consequential outcomes.

Every consequential outcome MUST provide a reachable, inspectable evidence trail (records, times, authorities, decisions).
Evidence is presented, never fabricated, synthesized, or extrapolated; wording comes from authoritative records.
The product layer adds presentation and navigation to evidence, not conclusions.
Rejected as violations: consequential outcomes with no proof trail, decorative evidence badges, invented narratives about what happened.
P8 — Role correctness

Customer, merchant, provider, operator, and administrator see only their surfaces.

Navigation, content, and deep links are role-gated (Section 4); unknown role means least visibility.
The UI MUST NOT self-assign or escalate roles; role truth is an authoritative input.
Rejected as violations: cross-role leakage in navigation or deep links, client-side "admin mode" toggles, guessing roles from behavior.
P9 — Accessibility

The product is operable and understandable by everyone, at a defined objective standard.

Baseline: WCAG 2.2 level AA (assumption-flagged; re-pinnable by the Tech Lead), plus full keyboard operability, visible focus, semantic structure, and reduced-motion support.
State MUST NOT be signaled by color alone (supports P4 and P5); state transitions MUST be announced accessibly.
Rejected as violations: keyboard traps, unlabeled controls, color-only state signaling, motion-gated interactions.
P10 — Responsive behavior

All surfaces work across viewport sizes, mobile-first.

The breakpoint set is defined once in the shell (UI-001) and shared; surfaces MUST NOT define divergent sets.
Touch targets MUST be at least 44px; layouts MUST NOT scroll horizontally; behavior parity across widths.
Rejected as violations: desktop-only layouts, actions that vanish on small viewports, per-surface breakpoint drift.
P11 — Protocol authority boundaries

The UI stays inside the interaction layer, always.

Every consequential UI state MUST map to a protocol object/state owned by a protocol authority (Section 8).
The UI MUST NOT decide authorization, settlement, finality, capability, or liquidity; it presents the decisions of the authorities that own them.
Rejected as violations: client-side verdicts, surfaces that impersonate an authority, reinterpretation of protocol semantics in wording or visuals.
6. Absolute prohibitions (N1–N5)

These five are hard boundaries for every surface, every work item, every change. Each maps to stop conditions in the work orders; a violation stops the item.

N1 — The UI must never become a financial authority

No product surface originates, computes, or decides financial truth. Money-affecting decisions belong to protocol authorities; the product layer presents them.

N2 — The UI must never invent settlement or finality

No wording, visual, sound, or log entry implies settlement, finality, or completion beyond what the owning protocol authority reports. If the authority has not said it, the UI does not show it.

N3 — The UI must never bypass protocol authorization

Every consequential action routes through protocol authorization. No client-side shortcuts, no direct writes to durable state, no hidden second channel, no "trust me" paths.

N4 — The UI must never treat sandbox execution as production financial execution

Sandbox sessions carry a persistent, configuration-derived environment signal (Section 10) and sandbox framing for consequential outcomes. Sandbox money movement is never presented as production financial effect.

N5 — The UI must never silently mutate durable financial state

No consequential action applies without explicit user intent, explicit protocol authorization, and a visible resulting state change with evidence (P7). Silent application, optimistic application without authority, or background mutation are all forbidden.

7. State display model

This vocabulary is UI display semantics. Protocol state naming and transitions belong to the protocol; the display model maps authoritative truth to what the user sees.

Display state	Meaning	Mandatory content
SUCCEEDED	Owning authority reports a terminal successful outcome	Outcome wording from the authority; evidence link (P7)
FAILED	Owning authority reports a terminal failed outcome	Failure wording; reason where the authority provides one; next actions where they exist
UNKNOWN	No authoritative answer is currently available	"Unknown" label; plain-language explanation; reconciliation path where known
WAITING	Non-terminal: queued, delayed, or awaiting per authority	Reason; expectation (what happens next); available actions or explicit "none yet"
IN_PROGRESS	Non-terminal: actively processing per authority	What is happening; what completes it
ACTION_REQUIRED	Authority reports that user action is needed	The action; validity/deadline and consequence of inaction where the authority provides them

Rules:

Terminality is decided by protocol authorities. The UI MUST NOT promote a non-terminal state to terminal or demote a terminal one.
Render conditions are not outcomes. A failed fetch or unreachable authority renders as UNKNOWN (availability unknown), never as a FAILED business outcome; the UI MUST keep fetch-failure visually and semantically distinct from outcome-failure.
Each display state MUST have distinct visual and textual treatment; color alone never carries the distinction.
State transitions on consequential outcomes MUST be announced accessibly (for example, polite live regions).
8. Mapping discipline — the nine reconciliation questions

Every consequential UI state MUST map to a protocol object/state owned by a protocol authority. A UI state is consequential when its wording or visual implies a financial or protocol consequence — money movement, commitment, obligation, authorization, capability, position, dispute outcome, or the environment of execution.

The mapping is recorded by answering the nine reconciliation questions:

Protocol object — which protocol object/state does this UI state present?
Owning authority — which protocol authority owns that object's state?
Runtime boundary — where does that authority run relative to the UI?
Deployed component — which deployed component serves the authoritative state to the UI?
Persistent state — where is the authoritative state durably recorded?
UNKNOWN handling — when no authoritative answer is available, how does the UI render UNKNOWN, and how is it reconciled?
Reconciliation — how does authoritative state become current again after divergence?
Evidence — what proof trail exists for the outcome, and where is it visible to the user?
User-visible state — exactly what does the user see, and how is it worded?

Rules:

A consequential UI state without a complete mapping record MUST NOT ship.
Mapping records are reviewed as part of the owning work order's acceptance.
Mapping completeness is re-verified across the whole product at UI-009 and is closure evidence at UI-010.
When a UI state cannot be mapped, the correct product-layer answer is UNKNOWN presentation (P5) — never invention.
This discipline is the product-layer half of the system reconciliation discipline (spec/system-reconciliation.md); it adds no protocol semantics.
9. Evidence visibility (obligations)
Consequential outcomes MUST link to their proof trail; the evidence surface materializes in UI-005 and is reused by later surfaces.
Evidence records are listed with authority, time, and outcome wording; the UI adds navigation, not interpretation.
Where an evidence record is itself unavailable, the UI shows UNKNOWN for the record — never a synthesized substitute.
10. Environment awareness (sandbox vs production)
A persistent, always-visible environment signal distinguishes sandbox from production, derived exclusively from explicit configuration. It MUST NOT be spoofable by user content, URL parameters, or client state.
Production framing (unqualified consequential wording) is used only when configuration says production.
Sandbox sessions frame consequential outcomes as sandbox outcomes; combined with N4, this is what prevents sandbox execution from reading as production financial execution.
The UI MUST NOT expose any control that re-labels the environment.
11. Accessibility (obligations)
Standard: WCAG 2.2 level AA is the working baseline (assumption-flagged for the Tech Lead to re-pin; recorded in the product program's known limitations).
Full keyboard operability with visible, ordered focus; semantic landmarks and headings; labels on all controls; ARIA only where semantics require it.
Contrast at the baseline level; reduced-motion support; no color-only state signaling (P4, P5); state changes announced accessibly.
Objective, tool-backed accessibility evidence is produced at UI-009 and rolled up at UI-010.
12. Responsive behavior (obligations)
Mobile-first; one shared breakpoint set defined in UI-001 and documented there; every surface conforms.
Touch targets at least 44px; no horizontal scrolling at any supported width; behavior parity — every consequential action is available on small viewports.
Dense presentations (timelines, evidence tables, position tables) MUST degrade to readable mobile forms rather than truncate or scroll horizontally.
13. Navigation grammar (obligations)
One grammar: primary navigation, back/close semantics, deep links, and role filtering are defined once in the shell (UI-001).
Status views MUST be deep-linkable and role-checked on direct entry (P8).
No surface introduces a second paradigm; extensions to the grammar go through the shell, not around it.
14. Program artifacts and closure
Artifact	Path	Role
UX contract (this document)	spec/product/ux-architecture-v0.2.md	Normative rules for every surface
Implementation roadmap	spec/product/implementation-roadmap.md	Frozen human-readable sequence
Work-item ledger	spec/product/work-items.md	Pinned dependency graph (source of record)
UI work orders	spec/product/work-orders/UI-001.md … UI-010.md	Dispatchable, bounded work units
Product machine state	spec/development-state/product-program-state.json	Projection for dispatch; Git merge facts are authoritative

Closure: the program's closure target is UI-010, which requires objective end-to-end UX evidence, responsive/accessibility evidence, and Architect closure through the governed process.

15. Change control and enforcement
This contract changes only through the governed Tech Lead merge process; changes are additive and preserve the layer boundary.
The pinned work-item graph is frozen; work orders and the ledger MUST NOT add or remove edges outside the governed process.
Enforcement points: per-work-order acceptance criteria and stop conditions; mapping-record review (Section 8); the UI-009 hardening gate; the UI-010 closure gate.
16. Non-goals
No protocol semantics are defined, extended, or reinterpreted here.
No backend implementation, runtime topology, or deployment boundaries (owned by other programs; see spec/system-work-orders/).
No scheduling or reordering of protocol or system work.
No financial computation of any kind.
Appendix A — Mapping record template
Field	Question to answer
Protocol object	Which protocol object/state does this UI state present?
Owning authority	Which protocol authority owns that object's state?
Runtime boundary	Where does that authority run relative to the UI?
Deployed component	Which deployed component serves the authoritative state to the UI?
Persistent state	Where is the authoritative state durably recorded?
UNKNOWN handling	How is UNKNOWN rendered here, and how is it reconciled?
Reconciliation	How does authoritative state become current again after divergence?
Evidence	What proof trail exists, and where is it visible?
User-visible state	Exactly what does the user see, and how is it worded?

Each record also carries: the UI state name, the owning work item, the surface, and the last review.

Appendix B — Rules quick reference
ID	Rule
P1	One shared navigation grammar
P2	Outcome-first interaction
P3	Progressive disclosure
P4	Explicit state — never ambiguous pending
P5	Explicit UNKNOWN — never failure or success
P6	Waiting and recovery clarity
P7	Evidence visibility for consequential outcomes
P8	Role correctness — five roles, their surfaces only
P9	Accessibility
P10	Responsive behavior
P11	Protocol authority boundaries
N1	Never become a financial authority
N2	Never invent settlement or finality
N3	Never bypass protocol authorization
N4	Never treat sandbox execution as production financial execution
N5	Never silently mutate durable financial state
