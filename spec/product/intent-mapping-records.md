# Intent mapping records — UI-002 (re-anchored to runtime truth by UI-011)

Status: SHIPPED (UI-002) · RE-ANCHORED (UI-011 — the sanctioned product splice) · Owner: product layer (presentation) · Authority owner: **Intent Authority (spec/architecture/v0.1)** · Runtime boundary: **LIVE** (the composed protocol runtime, RTN-012: A01 + A15 + the protocol gateway)

Every consequential intent state the customer payment intent surface can render carries a complete mapping record below (UX contract Section 8: unmapped states do not ship). Each record answers the contract's nine questions. **The records are re-anchored to the Intent Authority's REAL state vocabulary — INTENT_STATES (A01: DRAFT → AUTHORIZED → ROUTED → FULFILLING → terminal(FULFILLED | FAILED | CANCELLED)), exported by the runtime's own module** (`src/lib/protocol-runtime/intent/types.ts`) — with the mock-era fixture members retained in the port's type union solely for interface compatibility with the frozen UI-002 verification harness (the runtime adapter never reports them; their records below say so).

Adapter boundary: `src/lib/protocol/intent-port.ts` (typed port; `getIntentPort()` returns the registered runtime adapter) backed by `src/lib/protocol/runtime-intent-adapter.ts` (the runtime adapter: commands admitted exclusively through `ProtocolGateway.submitCommand`, reads from the A01 query API + the real A15 chain). The mock backing is RETIRED. Display resolution: `src/lib/protocol/intent-state-mapping.ts` mirrors this document record-for-record.

## UI-011 re-anchoring — runtime truth and the question-9 discharge

- **Owning authority (per state):** the Intent Authority (A01) owns every PaymentIntent state and its semantics; the Evidence Authority (A15) owns the proof trail (INTENT_CREATED / INTENT_AUTHORIZED / INTENT_STATE_CHANGED records with reason codes); the protocol gateway owns admission receipts (ADMITTED / DUPLICATE, recorded per the gateway's own store on the durable path). Consequence quotes derive from the Capability Authority's (A03) real current snapshot — no pre-submit fee surface exists, and no fee is invented.
- **Evidence identity:** the A15 record chain — every consequential step's record (record id, sequence, hash, owning authority, outcome + reason code) — plus the gateway admission receipt for submits (surfaced in the snapshot's evidence trail, including the DUPLICATE label on replayed keys). Proof: the per-port adapter verification in `src/lib/protocol/runtime-intent-adapter.test.ts` (command round-trips through the gateway, DUPLICATE replay, typed rejections, A15-backed reads, UNKNOWN presentation).
- **UNKNOWN semantics:** a query with no record answers `no-answer` → UNKNOWN (never failure, never fabricated; the runtime may not have executed an admitted command yet, or the reference was never submitted). A submit that was admitted but not yet executed presents the receipt + UNKNOWN. Settlement-side UNKNOWN (the intent port does not report it; the runtime's UNKNOWN lives on the settlement/rail path) resolves ONLY through the Reconciliation Authority's terminal case resolution (GC-2, the A14 cycle) — never product-side wording.
- **Reconciliation path:** re-check re-queries the A01 record; the durable command path executes admitted jobs exactly once (the worker auto-drains); replayed submissions dedupe to the same intent (INV-1-3 generalized — no retry storms).
- **User-visible wording source:** the adapter's StateReport wording restates ONLY what the runtime reports (the state name, the frozen transition-table semantics, the A15-recorded reason codes); FULFILLED explicitly does NOT state settlement finality (that is A12's report — N2 discipline).
- **Question 9 (user-visible state) — RTN-012's deferral DISCHARGED:** INTEGRATION-EVIDENCE.md (RTN-012) deferred the user-visible-state reconciliation to this item. Discharged here: the product intent surfaces now render states read from the composed runtime through this port (server-side surfaces carry the runtime-backed reads; browser-context calls present honest no-answer/UNKNOWN — the gateway's HTTP binding is recorded future work, see the deferrals below). The observation evidence is the per-port adapter suite and the server-side surfaces; the full end-to-end journey evidence rolls up under UI-010.
- **Recorded deferrals (never silent):** (1) no browser transport binding for browser-originated port calls (the frozen 'use client' consumers) — the gateway's HTTP binding is recorded future work (COMMAND-SURFACE.md "Health"; DEP-002+); deferred to the deployment program / SYS-001 three-layer reconciliation. (2) No pre-submit fee-quote surface in the composed runtime — quotes derive from the A03 snapshot; when no capability is registered for the corridor the review stays closed (honest no-answer).

The nine questions (UX contract Section 8 record format):

1. **State identity** — what is the state's canonical identifier, and who reports it?
2. **Display resolution** — which of the six display states does it resolve to, and why is that unambiguous (P4)?
3. **Mandatory content** — what MUST be on screen when this state renders?
4. **Wording boundaries** — what wording is permitted, and what is forbidden (N2)?
5. **User actions** — which actions are available, and which are protocol-authorized (N3)?
6. **Evidence trail** — which records, times, authorities, and decisions are shown (P7)?
7. **Reconciliation / progression** — who resolves it, and what triggers the re-check (P5/P6)?
8. **Causes** — what conditions produce this state, as reported by the authority (no client-side inference)?
9. **Ownership & runtime boundary** — which protocol object owns it, and what is the runtime status?

---

## IMR-1 — `acknowledged` → SUCCEEDED
> **Re-anchored (UI-011):** the runtime adapter never reports `acknowledged` (an interface-compat fixture member). The runtime's terminal-success report is `FULFILLED` (IMR-13). This record is retained so nothing unmapped ships; its mock-era answers stand as the historical presentation contract.


1. **State identity.** `acknowledged` — an authority-reported fixture state (mock vocabulary, NON-AUTHORITATIVE). Reported by the Intent Authority (mock) through the intent port as `IntentStateSnapshot.authorityState`, with `authority.owner = 'Intent Authority'`, `architectureRef = spec/architecture/v0.1`, `runtimeStatus = 'ARRIVING'`.
2. **Display resolution.** SUCCEEDED, exactly one. The authority reported it holds the intent on record with acceptance for processing. It is not UNKNOWN (there is an answer), not FAILED, and not a non-terminal WAITING/IN_PROGRESS/ACTION_REQUIRED report.
3. **Mandatory content.** Headline "Acknowledged by the Intent Authority."; the authority's acknowledgement note verbatim; the scope restatement — receipt and acceptance for processing, with settlement/finality/completion explicitly NOT stated; the intent brief (amount, recipient, source, reference, intent id, composed time); the evidence trail; the source note (who reported, when, mapping record IMR-1, runtime ARRIVING).
4. **Wording boundaries.** Permitted: the authority's own wording ("acknowledged", "holds on record", "acceptance for processing"). Forbidden: "payment complete", "settled", "final", "money sent", "done", any celebratory completion framing beyond the acknowledgement itself (N2). The scope note makes the boundary explicit on screen.
5. **User actions.** Re-check with the authority (a read-only re-query through the port — always available); "Compose another intent" (a new, separately reviewed intent — never a resubmission). No consequential write action exists for this state pre-runtime.
6. **Evidence trail.** `submission-received` record (received-at, authorization basis: explicit user submit referencing the reviewed consequence report); `consequence-terms` record (the pre-submit quote: report id, amount, fee, total); `authority-state-report` record (authority-reported state, reported-at, owning authority, mapping record); `acknowledgement` record (acknowledged-at, scope). Rendered via the shared evidence component, inspectable, capped-height scrollable.
7. **Reconciliation / progression.** Terminal for the product's presentation of THIS report: the snapshot is deterministic (re-query returns the same report until the authority reports otherwise). The re-check button re-queries and displays whatever returns, including a later different state. No auto-refresh invents progress.
8. **Causes.** As reported by the mock authority: an explicit, single-intent submit that passed the boundary's authorization-shape check (explicit user submit + reviewed consequence report + unchanged draft fingerprint) was transported and recorded. The product never infers acknowledgement.
9. **Ownership & runtime boundary.** The intent record and its acknowledgement are owned by the Intent Authority (spec/architecture/v0.1). Runtime: ARRIVING — the current report comes from the mock (NON-AUTHORITATIVE, presentation-only), which holds records in browser-session memory only.

---

## IMR-2 — `rejected` → FAILED
> **Re-anchored (UI-011):** the runtime adapter never reports `rejected` (interface-compat fixture member). The runtime's terminal-failure reports are `FAILED` (IMR-14) and `CANCELLED` (IMR-15), each carrying the A01 reason-code vocabulary.


1. **State identity.** `rejected` — authority-reported fixture state (mock vocabulary, NON-AUTHORITATIVE), via the same snapshot shape as IMR-1.
2. **Display resolution.** FAILED, exactly one. The authority reported a rejection with a reason; this is a terminal answer, not UNKNOWN, and not a non-terminal report.
3. **Mandatory content.** Headline "Rejected by the Intent Authority."; the reason code and message verbatim; the recovery hint where reported (or the explicit statement that none was reported); the statement that a rejected intent does not move money; the intent brief; the evidence trail; the source note.
4. **Wording boundaries.** Permitted: the authority's reason wording, "rejection", recovery as reported. Forbidden: blaming the customer beyond the authority's reason, "declined by you" framings the authority did not report, any settlement/refund implication beyond the authority's report (N2).
5. **User actions.** Re-check with the authority (read-only); "Compose a new intent" — explicitly labeled as a NEW intent; any retry is a fresh composition → review → explicit submit, never a silent resubmission (N3/N5).
6. **Evidence trail.** `submission-received` and `consequence-terms` records as in IMR-1; the `authority-state-report` record; a rejection-specific record with the reason code, the reason message, and the recovery hint (or "None reported").
7. **Reconciliation / progression.** Terminal as reported. Re-check remains available and honest (the mock is deterministic; a runtime authority may report a different later state, which then renders per its own record).
8. **Causes.** As reported: the authority rejected the intent (fixture: recipient limit exceeded). The product never decides rejection and never renders a transport error as rejection — a boundary refusal renders as a product-boundary failure with its own wording (see IMR-7's sibling: submit refusals are NOT intent states).
9. **Ownership & runtime boundary.** Rejection and its reason are owned by the Intent Authority. Runtime: ARRIVING; current source is the mock, NON-AUTHORITATIVE.

---

## IMR-3 — `unresolved` → UNKNOWN
> **Re-anchored (UI-011):** the runtime adapter never reports `unresolved` (interface-compat fixture member). The runtime's indeterminacy presents through `no-answer` (IMR-8 re-anchored): a command admitted but not yet executed, or a reference the A01 registry does not hold.


1. **State identity.** `unresolved` — authority-reported fixture state (mock vocabulary, NON-AUTHORITATIVE): the authority holds the intent but has reached no acceptance decision.
2. **Display resolution.** UNKNOWN, exactly one — never SUCCEEDED, never FAILED. The state chip reads UNKNOWN, the visual grammar is the distinct dashed UNKNOWN treatment, and nothing counts it as success or failure anywhere (P5).
3. **Mandatory content.** Headline "It is not yet known whether this intent was accepted."; the explicit statement that UNKNOWN is not success and not failure; what is not yet known (verbatim from the authority report); the reconciliation path — who resolves it (the Intent Authority, runtime ARRIVING) and what triggers the re-check (the re-check action re-queries and reports whatever returns, including another UNKNOWN); the intent brief; the evidence trail; the source note.
4. **Wording boundaries.** Permitted: "not yet known", "unresolved", "no acceptance decision to show yet". Forbidden: "pending" without a qualifier, "processing" (that is a different state), error styling, success styling, spinner-as-verdict, optimistic "should go through" framing (N1/N2/P4/P5).
5. **User actions.** Re-check with the authority — the single protocol-shaped action available pre-runtime; it is a read-only re-query and never mutates anything. No recovery write action is offered.
6. **Evidence trail.** `submission-received`, `consequence-terms`, and `authority-state-report` records, each stating the authority-reported state `unresolved` and the owning authority. The absence of a decision record is itself presented as the state's content, not as missing data.
7. **Reconciliation / progression.** The Intent Authority resolves it; the re-check action triggers the re-query. Non-terminal and non-dead-end: the state page states explicitly that the state changes only when the authority's report changes, and the re-check is always available (P6).
8. **Causes.** As reported: the authority has the intent on record with no acceptance decision yet. Distinct from the boundary conditions in IMR-7/IMR-8 (no answer reachable at all) — those also render UNKNOWN, with their own records, and are never presented as failure.
9. **Ownership & runtime boundary.** The acceptance decision is owned by the Intent Authority. Runtime: ARRIVING; current source is the mock, NON-AUTHORITATIVE.

---

## IMR-4 — `held-for-recipient` → WAITING
> **Re-anchored (UI-011):** the runtime adapter reports the frozen WAITING variant's FIELDS for the real `DRAFT` state (IMR-9): a qualified wait on the authority's compliance-gated authorization decision — the variant kind is the port's frozen discriminant; the wording is runtime truth.


1. **State identity.** `held-for-recipient` — authority-reported fixture state (mock vocabulary, NON-AUTHORITATIVE).
2. **Display resolution.** WAITING, exactly one. The authority reported the intent is held pending the recipient — a qualified, non-terminal wait (P4: "pending" must resolve to WAITING with reason or UNKNOWN).
3. **Mandatory content.** What is waiting (the payment intent, held by the authority); why (waiting for the recipient, as reported); what happens next (the authority will report the recipient's response; the displayed state changes only when that report arrives); the available actions — or the explicit statement that none is available yet; the intent brief; the evidence trail; the source note.
4. **Wording boundaries.** Permitted: "waiting on the recipient", "held by the authority". Forbidden: time or progress estimates not reported by the authority (none are shown — the authority provided none), "should complete soon", invented countdowns (P6, N2).
5. **User actions.** Re-check with the authority (read-only). The authority reports cancellation is authorized — and the record states plainly that the protocol path to exercise it ARRIVES with the runtime, so this surface offers no cancel control rather than bypass protocol authorization (N3). No silent state mutation is possible from this state.
6. **Evidence trail.** `submission-received`, `consequence-terms`, `authority-state-report` records with the held state and its reason.
7. **Reconciliation / progression.** Progresses when the authority reports the recipient's response; the re-check action re-queries on demand. Non-dead-end by construction (P6).
8. **Causes.** As reported: the recipient has not yet responded. The product never infers "waiting" from elapsed time — only from the authority's report.
9. **Ownership & runtime boundary.** The hold and the recipient response are owned by the Intent Authority. Runtime: ARRIVING; current source is the mock, NON-AUTHORITATIVE.

---

## IMR-5 — `processing` → IN_PROGRESS
> **Re-anchored (UI-011):** the runtime adapter reports this variant for the real `AUTHORIZED` / `ROUTED` / `FULFILLING` states (IMR-10..IMR-12) — a present activity report, never a verdict.


1. **State identity.** `processing` — authority-reported fixture state (mock vocabulary, NON-AUTHORITATIVE).
2. **Display resolution.** IN_PROGRESS, exactly one. The authority reported processing is underway. This is a present activity report, not a verdict (P4) — the surface says so explicitly.
3. **Mandatory content.** What is happening (the authority is processing this intent, as reported); the "as reported" note; the explicit statement that this is not a verdict and resolves explicitly when the authority's next report arrives; the intent brief; the evidence trail; the source note. No estimate is shown because the authority reported none.
4. **Wording boundaries.** Permitted: "processing, as reported". Forbidden: invented progress bars, percentage claims, ETA language, "almost done", or a spinner presented AS the state (the icon animates, the label and content carry the state — P4/P6).
5. **User actions.** Re-check with the authority (read-only).
6. **Evidence trail.** `submission-received`, `consequence-terms`, `authority-state-report` records with the processing report.
7. **Reconciliation / progression.** The authority's next report resolves it; the re-check action re-queries on demand. The presentation never self-resolves "processing" into success after a timeout.
8. **Causes.** As reported: the authority began processing. The product never infers processing from its own submit timing — the transport-in-flight presentation on the submit path is a separately-labeled product-layer transport status, never an intent state.
9. **Ownership & runtime boundary.** Processing status is owned by the Intent Authority. Runtime: ARRIVING; current source is the mock, NON-AUTHORITATIVE.

---

## IMR-6 — `action-requested` → ACTION_REQUIRED
> **Re-anchored (UI-011):** the runtime adapter never reports `action-requested` (interface-compat fixture member); the runtime's intent states carry no customer-action request in the merged vocabulary.


1. **State identity.** `action-requested` — authority-reported fixture state (mock vocabulary, NON-AUTHORITATIVE).
2. **Display resolution.** ACTION_REQUIRED, exactly one. The authority requested an action from the customer before the intent can proceed.
3. **Mandatory content.** The requested action (confirm the updated recipient details, as reported); the rationale (the recipient requires confirmation, as reported); the intent brief; the evidence trail; the source note; the explicit statement that the action is exercised through the authority's protocol path, which ARRIVES with the runtime — this surface presents the request and never performs the action by a side channel (N3).
4. **Wording boundaries.** Permitted: the authority's request wording. Forbidden: performing or implying the action client-side, "we've confirmed for you", auto-fulfillment, or presenting the request as an error.
5. **User actions.** Re-check with the authority (read-only). The requested action itself has no pre-runtime control — by design, and stated on screen.
6. **Evidence trail.** `submission-received`, `consequence-terms`, `authority-state-report` records including the request and rationale.
7. **Reconciliation / progression.** The customer's action (via the authority's path once it exists) and the authority's subsequent report resolve it; re-check re-queries on demand. Non-dead-end: the state states what is requested and why (P6).
8. **Causes.** As reported: the recipient requires confirmation from the customer. The product never generates action requests itself.
9. **Ownership & runtime boundary.** The request and its fulfillment path are owned by the Intent Authority. Runtime: ARRIVING; current source is the mock, NON-AUTHORITATIVE.

---

## IMR-7 — boundary: submission not transported → UNKNOWN
> **Re-anchored (UI-011):** the boundary condition splits honestly: a browser-context submit presents not-transported (no transport binding — recorded deferral); a server-side submit that was ADMITTED but not yet executed presents the admission receipt with UNKNOWN (the durable path executes it exactly once; a replayed key dedupes to the same intent — no retry storm). Gateway typed rejections surface verbatim through the frozen refusal vocabulary.


1. **State identity.** Not an authority state: a submit transport outcome reported by the port (`SubmitResult` `not-transported` with a `submissionRef`). The customer is routed to the state page for the submission reference.
2. **Display resolution.** UNKNOWN, exactly one. It is UNKNOWN whether the authority received the intent — never rendered as failure, never as success, never retried silently (N5: no background resubmission).
3. **Mandatory content.** Headline stating it is not yet known whether the authority holds this intent; what is not yet known (whether the submission reached the authority); the reconciliation path (the Intent Authority resolves it; re-check re-queries and reports whatever returns, including another UNKNOWN); the submission reference; the source note naming the boundary condition and record IMR-7.
4. **Wording boundaries.** Permitted: "not transported", "not yet known". Forbidden: "failed to pay", "submission failed" as a verdict, automatic retry messaging, optimistic "we'll keep trying" claims the authority never made (N2/N5).
5. **User actions.** Re-check with the authority (read-only). Composing a new intent is offered as a new, separately reviewed intent — clearly not a resubmission of the untransported one.
6. **Evidence trail.** The state page's source note carries the boundary condition and the note from the port. The draft was cleared from the flow store on submit attempt, so no phantom "in-flight" draft remains; the session listing shows only recorded intents.
7. **Reconciliation / progression.** Re-check re-queries by reference; the mock holds no record for an untransported submission, so the re-check honestly returns no-answer → UNKNOWN again (IMR-8). With the runtime, the authority's durable record answers it.
8. **Causes.** The port reported the submission was not transported (harness script: authority unreachable). The product distinguishes this explicitly from refusal (authorization-shape rejection), which renders as a product-boundary failure, and from authority rejection (IMR-2).
9. **Ownership & runtime boundary.** Receipt truth is owned by the Intent Authority. Runtime: ARRIVING; the current transport is the mock's, NON-AUTHORITATIVE.

---

## IMR-8 — boundary: query with no answer → UNKNOWN
> **Re-anchored (UI-011):** answered from runtime truth: the A01 registry holds no record for the reference (never submitted, or an admitted command not yet executed), or the call originates in a browser context (no transport binding — recorded deferral). UNKNOWN either way; re-check re-queries.


1. **State identity.** Not an authority state: a query outcome reported by the port (`IntentQueryResult` `no-answer`, reason `unreachable` or `no-record`).
2. **Display resolution.** UNKNOWN, exactly one (P5: absence of an answer renders as UNKNOWN — never as zero, empty, failed, or cached success).
3. **Mandatory content.** Headline stating it is not yet known whether the authority holds this intent; what is not yet known, phrased per reason (unreachable: the authority cannot be reached right now; no-record: no record is reachable in this session — the mock holds records in browser-session memory only); the reconciliation path (the Intent Authority resolves it; re-check re-queries and reports whatever returns, including another UNKNOWN; no durable record exists pre-runtime to fall back on and none is invented); last-checked timestamp; the source note naming the boundary condition and record IMR-8.
4. **Wording boundaries.** Permitted: "no authoritative answer is reachable". Forbidden: "not found" as failure, a 404-style dead end, an empty-state stand-in, or default/cached success values standing in for the answer (P5).
5. **User actions.** Re-check with the authority (read-only, always available).
6. **Evidence trail.** The source note carries the boundary reason and the port's note verbatim; the last-checked line records each query time.
7. **Reconciliation / progression.** Re-check re-queries; the runtime's durable record will answer it. The page is a non-dead-end by construction.
8. **Causes.** The port could not reach the mock authority, or holds no record for the reference (including deep links to references never submitted in this session). This is exactly how a full page reload of a state URL presents pre-runtime — honestly UNKNOWN.
9. **Ownership & runtime boundary.** The answer is owned by the Intent Authority. Runtime: ARRIVING; the current answerer is the mock, NON-AUTHORITATIVE.


---

## IMR-9 — `DRAFT` → WAITING (runtime A01 state)

1. **State identity.** `DRAFT` — the Intent Authority's own state (A01: DRAFT → AUTHORIZED → …; the frozen one-way table's first state), reported through the intent port as `IntentStateSnapshot.authorityState` with `authority.owner = 'Intent Authority'`, `runtimeStatus = 'LIVE'`, implementation naming the runtime adapter.
2. **Display resolution.** WAITING, exactly one — a qualified, non-terminal wait (P4): the authority HOLDS the intent on record with fixed terms, awaiting its own compliance-gated authorization decision (INV-16-3). Presented through the frozen WAITING StateReport variant (its fields carry the runtime truth).
3. **Mandatory content.** What is waiting (the payment intent, held by the authority in DRAFT, terms fixed); why (the compliance-gated DRAFT → AUTHORIZED transition executes on the runtime's single-writer path — not reported yet); what happens next (the authority reports the authorization decision; the display changes only when that report arrives); the explicit no-cancel statement (the frozen table's only DRAFT successor is AUTHORIZED); the intent brief; the A15 evidence trail; the source note.
4. **Wording boundaries.** Permitted: "held by the Intent Authority in DRAFT", "awaiting the authorization decision", the authority's own vocabulary. Forbidden: settlement/finality/completion wording (the authority has reported none — N2), invented ETA (P6), UNKNOWN styled as failure or success, "processing" (a different state).
5. **User actions.** Re-check with the authority (read-only re-query — always available). No consequential write action exists from this state through this port (cancel is not authorized: no frozen edge).
6. **Evidence trail.** The gateway admission receipt (ADMITTED/DUPLICATE) and the real A15 `INTENT_CREATED` record (record id, sequence, hash, descriptor-hash proof) — rendered through the shared evidence component.
7. **Reconciliation / progression.** The authority's authorization decision resolves it (the runtime executes the compliance-gated transition); the re-check action re-queries on demand; the durable command path executes admitted jobs exactly once. Non-dead-end by construction (P6).
8. **Causes.** An explicit, reviewed, single-intent submit admitted through the protocol gateway and executed on the durable path (the sole admission point). The product never infers DRAFT.
9. **Ownership & runtime boundary.** PaymentIntent + the DRAFT state are owned by the Intent Authority (A01); the proof trail by A15; the receipt by the gateway. Runtime: LIVE — read from the composed runtime (the adapter query API + the A15 chain). Browser-context queries present UNKNOWN (the recorded no-transport-binding deferral).

---

## IMR-10 — `AUTHORIZED` → IN_PROGRESS (runtime A01 state)

1. **State identity.** `AUTHORIZED` — the A01 state after the compliance-gated transition (policy decision recorded).
2. **Display resolution.** IN_PROGRESS, exactly one — a present activity report, not a verdict (P4).
3. **Mandatory content.** What is happening (the intent is AUTHORIZED and proceeding toward routing, as reported); the "as reported" note; the explicit no-estimate statement (the authority provided none); the intent brief; the A15 evidence trail (INTENT_AUTHORIZED with the policy-decision link); the source note.
4. **Wording boundaries.** Permitted: "AUTHORIZED, as reported". Forbidden: progress percentages, ETA language, settlement wording, a spinner presented AS the state.
5. **User actions.** Re-check with the authority (read-only).
6. **Evidence trail.** The A15 `INTENT_AUTHORIZED` record (policy decision id as prior-record link) plus the `INTENT_STATE_CHANGED` chain.
7. **Reconciliation / progression.** The authority's next recorded transition resolves it (ROUTED, FAILED, or CANCELLED per the frozen table).
8. **Causes.** The authority executed intent.authorize with a terminal APPROVED compliance record (INV-16-3) — as recorded in A15. The product never infers authorization.
9. **Ownership & runtime boundary.** Intent Authority (A01) + A15. Runtime: LIVE (composed runtime).

---

## IMR-11 — `ROUTED` → IN_PROGRESS (runtime A01 state)

1. **State identity.** `ROUTED` — the A01 state after the routing authority's plan was validated and dispatched (ROUTE_VALIDATED / ROUTE_COMPLETED in the chain).
2. **Display resolution.** IN_PROGRESS, exactly one.
3. **Mandatory content.** What is happening (a route plan was validated and dispatched, as reported); the no-estimate statement; the intent brief; the A15 trail; the source note.
4. **Wording boundaries.** As IMR-10. Forbidden additionally: route-detail fabrication (the routing record owns those details).
5. **User actions.** Re-check (read-only).
6. **Evidence trail.** The A15 INTENT_STATE_CHANGED records for the ROUTED transition.
7. **Reconciliation / progression.** FULFILLING, FAILED, or CANCELLED per the frozen table.
8. **Causes.** The routing authority's success landed in A01 (as the architecture defines). The product never infers routing.
9. **Ownership & runtime boundary.** Intent Authority (A01) with the routing outcome's evidence in A15. Runtime: LIVE.

---

## IMR-12 — `FULFILLING` → IN_PROGRESS (runtime A01 state)

1. **State identity.** `FULFILLING` — the A01 state while fulfillment is underway.
2. **Display resolution.** IN_PROGRESS, exactly one.
3. **Mandatory content.** What is happening (fulfillment is underway, as reported); the no-estimate statement; the intent brief; the A15 trail; the source note.
4. **Wording boundaries.** As IMR-10; forbidden additionally: any settlement/finality implication (fulfillment is not settlement).
5. **User actions.** Re-check (read-only).
6. **Evidence trail.** The A15 INTENT_STATE_CHANGED records.
7. **Reconciliation / progression.** FULFILLED or FAILED (terminal) per the frozen table.
8. **Causes.** The authority recorded the fulfillment start. Never inferred product-side.
9. **Ownership & runtime boundary.** Intent Authority (A01) + A15. Runtime: LIVE.

---

## IMR-13 — `FULFILLED` → SUCCEEDED (runtime A01 state)

1. **State identity.** `FULFILLED` — the A01 terminal successful state.
2. **Display resolution.** SUCCEEDED, exactly one — the authority reports a terminal successful outcome for the intent's fulfillment.
3. **Mandatory content.** The authority's own outcome wording (fulfillment complete, as reported); the EXPLICIT scope note — settlement finality is NOT stated (finality is the Settlement and Finality Authority's report, A12) so none is shown (N2); the intent brief; the A15 trail; the source note.
4. **Wording boundaries.** Permitted: "FULFILLED, as reported". Forbidden: "settled", "final", "money sent", "payment complete", celebratory completion framing beyond the authority's own report.
5. **User actions.** Re-check (read-only); compose a new intent as a NEW, separately reviewed submission.
6. **Evidence trail.** The full A15 INTENT_* chain for the intent (created → authorized → … → fulfilled), each record with its hash and sequence.
7. **Reconciliation / progression.** Terminal per the frozen one-way table. Settlement-side progress is A12/A13's report, reachable through the tracking surface — never invented here.
8. **Causes.** The authority recorded fulfillment completion. Never inferred.
9. **Ownership & runtime boundary.** Intent Authority (A01); proof A15. Runtime: LIVE.

---

## IMR-14 — `FAILED` → FAILED (runtime A01 state)

1. **State identity.** `FAILED` — the A01 terminal failure state, always with a machine-readable reason code from the frozen A01 vocabulary (POLICY_UNSATISFIABLE, NO_VIABLE_ROUTE, FULFILLMENT_FAILED, TERMS_SUPERSEDED, PAYER_CANCELLED).
2. **Display resolution.** FAILED, exactly one — a terminal answer with the authority's recorded reason.
3. **Mandatory content.** The reason code + the authority's message (worded from the A15-recorded reason); the recovery hint as reported (a retry is a NEW intent linked to the prior intent id — never a silent resubmission); the statement that a failed intent moved no money; the intent brief; the A15 trail; the source note.
4. **Wording boundaries.** Permitted: the authority's reason vocabulary, "terminal", the retry-as-new-intent wording. Forbidden: blaming the customer beyond the authority's reason, transport errors presented as authority rejection, refund/settlement implications beyond the report.
5. **User actions.** Re-check (read-only); compose a new intent (explicitly labeled a NEW submission; the protocol's retry linkage is a new intent with priorIntentId, not a resubmission).
6. **Evidence trail.** The A15 INTENT_STATE_CHANGED record carrying the reason code (and the failing-record link where the architecture records one).
7. **Reconciliation / progression.** Terminal (one-way table; empty successor set). Re-check stays honest.
8. **Causes.** Routing or fulfillment failure as recorded by the authority. Never inferred; a gateway rejection (a refusal at admission) NEVER renders as this state — refusals surface through the boundary vocabulary.
9. **Ownership & runtime boundary.** Intent Authority (A01) + A15. Runtime: LIVE.

---

## IMR-15 — `CANCELLED` → FAILED (runtime A01 state)

1. **State identity.** `CANCELLED` — the A01 terminal did-not-proceed state, with reason code PAYER_CANCELLED or TERMS_SUPERSEDED.
2. **Display resolution.** FAILED, exactly one — the terminal "did not proceed" outcome (the six display states carry no separate cancelled member; the record states plainly that a cancelled intent did not proceed and moved no money, so the FAILED presentation never reads as an authority blame).
3. **Mandatory content.** The authority's outcome wording (CANCELLED + the recorded reason code); the explicit "did not proceed, no money moved" statement; the new-submission recovery wording; the intent brief; the A15 trail; the source note.
4. **Wording boundaries.** Permitted: "CANCELLED, as reported", the reason vocabulary. Forbidden: "rejected by the authority" framings (cancellation is not rejection), settlement implications, customer blame.
5. **User actions.** Re-check (read-only); compose a new intent (a NEW submission).
6. **Evidence trail.** The A15 INTENT_STATE_CHANGED record with the cancellation reason code.
7. **Reconciliation / progression.** Terminal.
8. **Causes.** The payer's cancellation or the terms-superseded rule (INV-1-1), as recorded. Never inferred.
9. **Ownership & runtime boundary.** Intent Authority (A01) + A15. Runtime: LIVE.

---

## Non-states (explicitly NOT intent states)

- **Submit-time transport in flight** — rendered as IN_PROGRESS with "product-layer transport status" as its source note, never presented as an intent state or a verdict.
- **Adapter-boundary refusal** (missing explicit authorization / missing consequence review / draft changed since review / malformed draft) — rendered as a FAILED product-boundary failure with its own wording: "This is a product-boundary refusal, not the authority rejecting your intent." No intent record exists.
- **Terms unavailable at review** — rendered as UNKNOWN with re-request, and the review stays closed to submission (P2/P3: no commit without full consequences).
