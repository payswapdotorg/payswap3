# Shell-level mapping records (UI-001)

- **Work order:** UI-001 — Product foundation: application shell, navigation grammar, and state display primitives
- **Status:** implemented with UI-001
- **Method:** the nine reconciliation questions (UX contract Section 8). A UI state is consequential when its wording or visual implies a financial or protocol consequence — money movement, commitment, obligation, authorization, capability, position, dispute outcome, or **the environment of execution**. A consequential UI state without a complete mapping record MUST NOT ship.

## Boundary note (UI-001 scope)

UI-001 introduces **zero financial semantics** (work order forbids balances, settlement or finality language, and protocol state invention). The shell owns exactly two consequential-level states, both listed in the work order: the **environment signal** (consequential through "the environment of execution") and **role availability** (consequential through authorization-adjacent visibility). For both, the protocol-side answers are **boundary-N/A for UI-001**: no protocol authority, protocol object, or protocol state is consumed or presented by this work item. These records therefore pin the product-layer half of the mapping — source, derivation, runtime boundary, evidence, and user-visible wording — and record which protocol-side answers later work items owe.

Everything else the shell renders (brand, links, documentation text, the state-primitive vocabulary itself, demonstration fixtures) is non-consequential presentation with no financial or protocol implication, and requires no mapping record. The six display states are presentation vocabulary; when a later surface uses them to present a consequential outcome, **that surface** owes the record for the state it presents.

---

## Record 1 — Environment signal (sandbox / production)

**User-visible state:** the always-visible banner pinned to the top of every route — "Sandbox environment" (amber, flask icon) or "Production environment" (dark, server icon), plus a one-line explanation of configuration derivation. The UI exposes no control that re-labels the environment.

1. **Protocol object** — None in UI-001 (boundary-N/A). The signal presents the execution environment of the product session, which in the full architecture is owned by deployment/protocol authorities. At UI-001 no protocol surface exists; the signal is configuration-owned, not protocol-owned. When consequential outcomes exist, their environment of execution maps to protocol execution contexts and those surfaces owe the extension of this record.
2. **Owning authority** — the deployment operator, through explicit build/start-time configuration (`PAYSWAP_ENV`). Not a protocol authority and not the UI: the shell only renders the resolved value. The UI is explicitly forbidden from deciding or re-labeling it (UX contract Section 10).
3. **Runtime boundary** — entirely outside the application process: host environment configuration, read server-side. URL parameters, user content, and client state never reach the derivation chain; there is no client-side input path (the banner is a server component receiving a prop).
4. **Deployed component** — the Next.js server runtime (server components). No external or protocol component is consulted in UI-001.
5. **Persistent state** — deployment configuration (the environment variable), not application durable state, not URL, not user content, not client storage. There is no database or session involvement in UI-001.
6. **UNKNOWN handling** — none required and none rendered as UNKNOWN: the signal resolves deterministically. Unset or invalid configuration resolves fail-safe to **sandbox** (never production by accident — N4 direction). The signal cannot render "unknown environment," and it can never present sandbox as production.
7. **Reconciliation** — redeploy/restart with different explicit configuration. There is no in-app path to change the signal; divergence is impossible from inside the UI because no writable input exists. Raw configuration values are never echoed into the UI (only a classified summary), so configuration content cannot inject wording.
8. **Evidence** — the derivation chain is documented in `src/lib/environment.ts`, rendered step-by-step on the verification surface (`/state-primitives`, section 1) together with the current classification, and the resolved value is continuously visible in the banner. The anti-spoof probe on the same surface demonstrates that URL-parameter attempts are reported as ignored.
9. **User-visible state (exact wording)** — sandbox: "**Sandbox environment** — Configuration-derived signal. Outcomes in this session are sandbox outcomes — never production effects." production: "**Production environment** — Configuration-derived signal. Unqualified consequential wording appears only because configuration says production." Footer adds: "Environment: sandbox|production (configuration-derived)."

---

## Record 2 — Role availability (role-scoped navigation visibility)

**User-visible state:** the header indicator ("Unauthenticated · least visibility") plus exactly the navigation entries the grammar allows for the current audience; planned role entries render inert and tagged "Planned". The role-routing matrix on the verification surface statically renders all six audience views as proof.

1. **Protocol object** — None in UI-001 (boundary-N/A). Navigation visibility is presentation gating in the product layer. In the full architecture, role assignment is an authoritative identity input and operator/administrator visibility is bounded by protocol authorities; none of those objects are consumed yet.
2. **Owning authority** — for UI-001: no identity authority exists, and the UI must not self-assign, infer, or escalate roles (P8). The shell therefore renders the **unauthenticated view — least visibility** — by rule, not by guess. When identity ships, the owning authority becomes that identity/authorization configuration; role truth remains an authoritative input the UI only consumes.
3. **Runtime boundary** — no role input exists at any boundary in UI-001. The live shell resolves a constant audience (`getShellAudience()` → `unauthenticated`) in the server root layout. The verification matrix is static server-rendered proof, not an input path.
4. **Deployed component** — the application shell itself: `src/lib/navigation.ts` (the ONE grammar) + the server root layout + the shared `NavList` renderer.
5. **Persistent state** — none in UI-001 (no sessions, no role records, no client state). Future identity work will owe the answer for where role truth is durably recorded.
6. **UNKNOWN handling** — the availability analog of UNKNOWN is **least visibility**: an unknown or unauthenticated viewer gets the minimum entry set, never a guessed or escalated one (P8). Absence of role input renders the unauthenticated view; there is no path from "unknown" to "administrator."
7. **Reconciliation** — when the identity work item ships an authoritative role input, `getShellAudience()` consumes it in the server layout; today divergence is impossible because no alternate source exists anywhere (no toggle, no URL parameter, no client state can change the audience).
8. **Evidence** — the role-routing matrix on `/state-primitives` renders, per audience, exactly the entries the grammar yields through the same renderer the live shell uses; the grammar registry (all entries with audience gating) is inspectable on the same surface; the code path is `NAVIGATION_ENTRIES` → `resolveNavigation(audience)` → shared `NavList`.
9. **User-visible state (exact wording)** — header: "Unauthenticated · least visibility". Planned entries: label + "Planned" tag, non-navigating, with the reserved route documented in a tooltip. Verification panels note, per role, that surfaces are planned later work items and that operator/administrator visibility is bounded by protocol authorities and "UI visibility is never protocol authority."

---

## Records owed by later work items (ledger)

A consequential UI state without a complete mapping record MUST NOT ship (UX contract Section 8). The following surfaces owe their own nine-question records when they introduce consequential states:

- **Identity/role assignment work item** — the authoritative role input: object, authority, runtime boundary, durable location, and how role availability reconciles (extends Record 2).
- **Environment-of-execution extension** — the first surface presenting a consequential outcome owes the record connecting that outcome to its protocol execution context and to the sandbox framing rule (N4) — the banner itself stays configuration-derived.
- **Customer surfaces** — intent creation (commitment review), personal tracking and evidence, waiting/recovery actions (each recovery action individually protocol-authorized, N3), mediation and dispute views.
- **Merchant surfaces** — checkout, offer/quote handling, merchant-side tracking and evidence.
- **Provider surfaces** — capability presentation, provider-side positions and tracking.
- **Operator surface** — read-only operational visibility, exactly as permitted by the owning protocol authorities.
- **Administrator surface** — administrative visibility, exactly as permitted.
- **Evidence surfaces** — every consequential outcome with a proof trail (P7): where records live, who authored them, and how the UI presents (never fabricates) them.

When a surface cannot map a consequential state, the correct product-layer answer is UNKNOWN presentation (P5) — never invention.
