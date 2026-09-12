# UI-010 Leg A — port-level end-to-end workflow journey records

Base: main @ 2e3b8314f3d1532b6032f9e5c93bf0aef9cd2e90
Harness: `node --import ./alias-loader.mjs product-port-journeys.mjs (Node 24.19, native TS stripping)`
Composition: journey-lib.mjs — the server composition root mirrored (substrate→evidence→authorities→persist→bindings→transition→gateway→scheduler + the seven runtime adapters registered into the product ports); recorded deviations: parameterized runtime dir (var/ui010-journeys/), tick-based drain (probe-drain.mjs evidences why)
Runtime directory: var/ui010-journeys/ (fresh per run; per-domain SQLite stores + the A15 evidence store)
A15 evidence chain: **VERIFIED** (verified height 29, final hash a6f0e976f3cd4afa202925998d7e6da0…)
Assertions: **62 total, 0 failed.**

Machine record: `port-journeys.json`; console transcript: `port-journeys-transcript.txt` (the command that produced both: `node --import ./alias-loader.mjs product-port-journeys.mjs`, run from `spec/product/closure/tools/`).

---

## Journey WF-1 — Customer intent lifecycle: consequence quote → explicit submit → compliance-gated authorize → tracking + evidence proof trail

Work item ID: UI-010 (evidence bundle; the workflow exercises the surfaces of UI-002..UI-008 over the UI-011 composed runtime)
Surfaces crossed: customer intent surface (/pay flow: compose→review→submit→state) → provider capability surface (/capabilities) → tracking surface (/track/[referenceId])
Explicit states exercised: WAITING (DRAFT, IMR-9); IN_PROGRESS (AUTHORIZED, IMR-10); UNKNOWN (no-answer query, IMR-8); not-found tracking (TRK-LOOKUP-NOT-FOUND)
Environment: sandbox topology of the real composed system: plain-Node harness (Node 24.19, native TS type stripping) composing substrate(DEP-003 node:sqlite) + A15 evidence log + A01/A02/A03/A04/A05/A06/A07/A08/A09/A10/A11/A12/A13/A14/A16 authorities + persist hooks + gateway + scheduler + the seven product runtime adapters (the UI-011 splice)

### Steps

1. **rails.adapter.register + activate — VIA THE GATEWAY**
   - state before: no rail adapters
   - action: gateway.submitCommand('rails.adapter.register' / 'rails.adapter.activate')
1. **rails adapter ACTIVE** — register admitted=true, activate admitted=true
   - state after: adapter pid.v1.6b79c88a6f45721f6e8710f3e5016a8dddab9b5d5872dd81febae4b964b4d310 = ACTIVE
1. **capability register + gate approval + activate (A03 command surface)**
   - state before: no capabilities in the A03 registry
   - action: capability.registerCapability → risk.evaluateAndRecordCheck/decideCheck (APPROVED) → capability.activateCapability
1. **capability ACTIVE** — registered.ok=true, gate=APPROVED, activated.ok=true
   - state after: cap-usd = ACTIVE
1. **PROVIDER CAPABILITY SURFACE read: ports.capability.listCapabilities()** — cap-usd (available) — CAP-MAP-001 'available'
   - state after: 1 capability item(s); boundary runtime=LIVE
1. **CONSEQUENCE QUOTE: ports.intent.requestConsequenceReport(draft)** — report qrpt_rt_001: fee=1.50 USD, total=26.50 USD, 8 plain-language terms
   - state after: a reviewed consequence report exists (the review surface can render it; the submit gate is armed)
1. **EXPLICIT SUBMIT: ports.intent.submitIntent(draft, authorization)** — transported — intent pid.v1.8aed9241ec8fd1c627f79b4595ce14ed610acc185a8e880fe1e71256e76aab32, authority state DRAFT → display WAITING (IMR-9 (spec/product/intent-mapping-records.md))
   - state before: no intent record
   - state after: A01 holds intent pid.v1.8aed9241ec8fd1c627f79b4595ce14ed610acc185a8e880fe1e71256e76aab32 in DRAFT; evidence: consequence-terms | submission-received | authority-state-report
1. **AUTHORIZE: gateway intent.authorize (compliance-gated)** — admitted=true; A01 state=AUTHORIZED
   - state before: DRAFT
   - state after: AUTHORIZED
1. **STATE READ: ports.intent.getIntentState(intentId)** — AUTHORIZED → display IN_PROGRESS (IMR-10 (spec/product/intent-mapping-records.md))
1. **TRACKING READ: ports.tracking.lookupReference(intentId, "customer")** — tracked: state=in-progress; history=2 entries; evidenceTrail=2 records
   - state after: current: The Intent Authority reports the intent pid.v1.8aed9241ec8fd1c627f79b4595ce14ed610acc185a8e880fe1e71256e76aab32 AUTHORIZED — progressing as reported. · evidence: INTENT_CREATED(DRAFT · sequence 7 · hash dd43233e411807fa5669e3dfda0133ad91d6cc5f1cd249598481970f8bc0e4c2) | INTENT_AUTHORIZED(AUTHORIZED · sequence 12 · hash ad997d38d39a198c689d48cb342ca777f29a22a8559b615792850a9fafe1572e)
1. **UNKNOWN READ: ports.intent.getIntentState(<never-submitted>)** — no-answer (reason no-record) — the note words it UNKNOWN with the reconciliation path
   - state after: the intent state surface renders UNKNOWN (IMR-8), never 404/failed
1. **UNKNOWN TRACKING: ports.tracking.lookupReference("NOT-A-REFERENCE")** — not-found — "the runtime's real answer for this reference … never as a fabricated state" (TRK-LOOKUP-NOT-FOUND)

### Assertions

- PASS — the rail adapter is ACTIVE for the corridor
- PASS — the capability is ACTIVE in the A03 snapshot
- PASS — the capability surface lists the ACTIVE capability from the A03 registry (CAP-MAP-001 'available')
- PASS — the consequence report quotes terms from the A03 snapshot (fee 1.50 USD)
- PASS — the explicit submit is transported (gateway admission + durable execution)
- PASS — the DRAFT snapshot resolves to the WAITING display state (IMR-9)
- PASS — the intent compliance gate check is APPROVED (the real risk authority)
- PASS — intent.authorize admitted + executed: the intent is AUTHORIZED
- PASS — the intent state query returns the AUTHORIZED snapshot (IN_PROGRESS, IMR-10)
- PASS — the tracking lookup resolves the intent by its protocol object id
- PASS — the tracked state is in-progress (TRK-IN-PROGRESS)
- PASS — the evidence trail carries A15 record ids, sequences, and hashes
- PASS — an unknown reference queries as no-answer → UNKNOWN (never failure)
- PASS — the tracking lookup of an unknown reference is not-found with UNKNOWN-honest wording

### Nine reconciliation questions

1. **Protocol object:** PaymentIntent (A01) — DRAFT → AUTHORIZED over the frozen one-way table; the A15 INTENT_CREATED / INTENT_AUTHORIZED records; the gateway admission receipt for intent.submit (steps: EXPLICIT SUBMIT, AUTHORIZE).
2. **Owning authority:** Intent Authority (A01) owns every intent state; the Evidence Authority (A15) owns the proof trail; the Capability Authority (A03) owns the quoted cost schedule; the protocol gateway owns admission.
3. **Runtime boundary:** Product port call (server-side composition) → protocol gateway (the sole admission point) → durable command path → transition runtime → Intent Authority. The harness crosses the product/protocol boundary exactly as src/lib/protocol/runtime-intent-adapter.ts does.
4. **Deployed component:** The composed protocol runtime in-process (node:sqlite substrate) + the seven runtime adapters — the same composition src/lib/protocol/server-runtime.ts wires for the app; here under the UI-010 journey harness (var/ui010-journeys/).
5. **Persistent state:** Per-domain SQLite stores under var/ui010-journeys/ (intent.sqlite, evidence.sqlite, durable.sqlite, …) — the write-through persist hooks; the A15 chain is append-only.
6. **UNKNOWN handling:** A never-submitted reference queries as no-answer → UNKNOWN with the reconciliation path (step: UNKNOWN READ); the tracking surface renders not-found with UNKNOWN-honest wording (step: UNKNOWN TRACKING). Both recorded verbatim in the JSON.
7. **Reconciliation:** Re-check re-queries the A01 record; replayed submissions dedupe to the same intent (the deterministic submission identity); the A15 chain verification over the full journey log passes (VERIFIED, height recorded in the summary).
8. **Evidence:** The A15 record chain (record ids, sequence numbers, hashes) surfaced through the tracking port evidenceTrail; the gateway admission receipt; this artifact: evidence/workflows/port-journeys.json + port-journeys-transcript.txt.
9. **User-visible state:** The customer intent surface renders WAITING (DRAFT) then IN_PROGRESS (AUTHORIZED) with the evidence trail reachable; the tracking surface renders the same truth per its own view (steps: STATE READ, TRACKING READ).
   - verified by: Port-level: recorded snapshots and views (the exact data the server components render). Surface-level rendering over HTTP is evidenced by Leg B (app-e2e) for the server-rendered paths.

---

## Journey WF-2 — Merchant checkout over a real DRAFT intent → offer read → terminal cancel → failed status → tracking view of the failure

Work item ID: UI-010 (evidence bundle; the workflow exercises the surfaces of UI-002..UI-008 over the UI-011 composed runtime)
Surfaces crossed: merchant checkout surface (/checkout, /checkout/[checkoutId]) → customer intent surface (the port submit that creates the offer) → tracking surface (/track/[referenceId])
Explicit states exercised: ACTION_REQUIRED (offered, cko-map-01); FAILED (CANCELLED with reason code, cko-map-07 / TRK-FAILED)
Environment: sandbox topology of the real composed system: plain-Node harness (Node 24.19, native TS type stripping) composing substrate(DEP-003 node:sqlite) + A15 evidence log + A01/A02/A03/A04/A05/A06/A07/A08/A09/A10/A11/A12/A13/A14/A16 authorities + persist hooks + gateway + scheduler + the seven product runtime adapters (the UI-011 splice)

### Steps

1. **submit intent-2 (the offer behind the checkout)** — intent pid.v1.daea8c22e92d74de6cbc63dd6e5ddc3ec76b04966e9a74c26aa9fa558c9d6ccf DRAFT
1. **CHECKOUT LIST: ports.checkout.listOpenCheckouts()** — 1 open offer(s); pid.v1.daea8c22e92d74de6cbc63dd6e5ddc3ec76b04966e9a74c26aa9fa558c9d6ccf — ACTION_REQUIRED (cko-map-01)
   - state after: receiveAmount 12.5 USD, validUntil 2026-09-13T14:14:42.101Z
1. **CHECKOUT OFFER: ports.checkout.getOffer({checkoutId})** — "Open offer — payment intent pid.v1.daea8c22e92d74de6cbc63dd6e5ddc3ec76b04966e9a74c26aa9fa558c9d6ccf"; 5 material conditions; plainLanguageSummary carries the no-settlement-finality wording
   - state after: the merchant decision page renders the offer (ACTION_REQUIRED)
1. **CHECKOUT STATUS (pre-cancel): ports.checkout.getStatus()** — state=offered → display action-required
1. **AUTHORIZE intent-2** — admitted=true; A01 state=AUTHORIZED
1. **TERMINAL CANCEL: gateway intent.cancel (reason PAYER_CANCELLED — the A01 reason-code vocabulary)**
   - state before: AUTHORIZED (the offer rendered as UNKNOWN post-DRAFT)
   - state after: CANCELLED (terminal)
1. **CHECKOUT STATUS (post-cancel): ports.checkout.getStatus()** — state=failed → display failed; reason: The Intent Authority reports the intent CANCELLED — the offer did not proceed and no money
   - state after: nextActions: Open the intent’s state page for the authority’s recorded reason code
1. **TRACKING READ of the cancelled intent** — state=failed; outcome: The Intent Authority reports the intent pid.v1.daea8c22e92d74de6cbc63dd6e5ddc3ec76b04966e9a74c26aa9fa558c9d6ccf CANCELLED (reason code PAYER

### Assertions

- PASS — a second intent is submitted and held in DRAFT
- PASS — the checkout list presents the DRAFT intent as an open offer
- PASS — the offer read quotes the intent's own recorded terms (no fee invented)
- PASS — the offer wording never states settlement or finality (N2)
- PASS — the offered checkout resolves to ACTION_REQUIRED (cko-map-01)
- PASS — intent-2 is AUTHORIZED (the precondition for the terminal cancel)
- PASS — intent.cancel admitted + executed: the intent is CANCELLED
- PASS — the cancelled checkout presents the failed record with reason and next actions (cko-map-07)
- PASS — the tracked view presents the terminal failure with the recorded reason code (TRK-FAILED)
- PASS — the cancelled intent no longer appears as an open offer

### Nine reconciliation questions

1. **Protocol object:** PaymentIntent (A01) presented as the merchant checkout offer (offered → failed through CANCELLED with reason code PAYER_CANCELLED).
2. **Owning authority:** Intent Authority (A01) — the checkout adapter reads it honestly (the area-20 Merchant Authority is RTN wave 2 and owns no merged object yet; recorded in the checkout mapping records).
3. **Runtime boundary:** Checkout port reads (server composition) → A01 query API; the terminal cancel crosses the product/protocol boundary through the gateway (intent.cancel).
4. **Deployed component:** The runtime checkout adapter over the composed runtime; the intent authority; the gateway.
5. **Persistent state:** intent.sqlite + the A15 chain (INTENT_STATE_CHANGED with the reason code) + durable.sqlite (the executed job).
6. **UNKNOWN handling:** The offer read never fabricates: no intent → checkout-not-found → the availability-unknown presentation (see WF-3 for the mapped UNKNOWN read); the list presents only real DRAFT intents.
7. **Reconciliation:** Re-check re-reads the A01 record; the cancelled intent leaves the open-offer list on the next read (asserted).
8. **Evidence:** A15 INTENT_* records; the checkout status record evidence link to the intent A15 chain; the JSON artifact steps (CHECKOUT LIST/OFFER/STATUS, TERMINAL CANCEL, TRACKING READ).
9. **User-visible state:** The merchant checkout list renders the open offer (ACTION_REQUIRED, cko-map-01); after the cancel, the state page renders failed with the authority reason and next actions (cko-map-07); the tracking surface renders the terminal failure with the reason code (TRK-FAILED).
   - verified by: Port-level recorded records (the exact data the merchant surfaces render).

---

## Journey WF-3 — Checkout UNKNOWN over the post-DRAFT intent + the fail-closed accept-decision refusal + the unknown-reference error mapping

Work item ID: UI-010 (evidence bundle; the workflow exercises the surfaces of UI-002..UI-008 over the UI-011 composed runtime)
Surfaces crossed: merchant checkout surface (/checkout/[checkoutId])
Explicit states exercised: UNKNOWN (checkout session gap with reconciliation, cko-map-08); honest refusal (decision-not-allowed); checkout-not-found → UNKNOWN presentation
Environment: sandbox topology of the real composed system: plain-Node harness (Node 24.19, native TS type stripping) composing substrate(DEP-003 node:sqlite) + A15 evidence log + A01/A02/A03/A04/A05/A06/A07/A08/A09/A10/A11/A12/A13/A14/A16 authorities + persist hooks + gateway + scheduler + the seven product runtime adapters (the UI-011 splice)

### Steps

1. **CHECKOUT STATUS over the AUTHORIZED intent: ports.checkout.getStatus()** — state=unknown → display unknown
   - state after: reconciliation.whoResolves: The Checkout/Intent Authority: the area-20 checkout-session record (wave 2) would resolve the merchant-decisio
1. **DECISION SUBMIT: ports.checkout.submitDecision({decision: "accept"})** — refused — decision-not-allowed: The composed protocol runtime exposes no merchant-decision command surface: the area-20 Merchant Authority (checkout-session semantics: CHECKOUT_OPENE…
   - state before: the merchant presses Accept on the offer
   - state after: no decision recorded, nothing committed (fail closed; the area-20 wave-2 gap)
1. **UNKNOWN-REFERENCE STATUS: ports.checkout.getStatus(<unknown id>)** — error=checkout-not-found → presentation {"target":"the requested checkout object — The Intent Authority holds no intent record for pid.v1.no-such-checkout, so no checkout state exists to report. UNKNO
   - state after: the surface renders the availability-unknown presentation (UNKNOWN), never a fabricated state

### Assertions

- PASS — WF-1's authorized intent is available for the post-DRAFT checkout read
- PASS — the post-DRAFT checkout state is UNKNOWN — never success or failure (cko-map-08)
- PASS — the UNKNOWN checkout carries its reconciliation path (who resolves + re-check trigger)
- PASS — the accept decision is REFUSED (decision-not-allowed) — nothing committed
- PASS — the unknown-reference checkout maps to an UNKNOWN-class presentation

### Nine reconciliation questions

1. **Protocol object:** The checkout presentation of a post-DRAFT intent (cko-map-08: the area-20 checkout-session object does not exist in the composed runtime — UNKNOWN, with reconciliation).
2. **Owning authority:** The (wave-2) Checkout/Intent Authority surface; today the A01 Intent Authority is the live owner named in every reportedBy.
3. **Runtime boundary:** Checkout port read + the decision submit crossing to the (absent) merchant-decision command surface — refused fail-closed at the adapter boundary.
4. **Deployed component:** The runtime checkout adapter over the composed runtime.
5. **Persistent state:** Nothing is written by the refused decision (asserted: nothing committed); reads leave no state.
6. **UNKNOWN handling:** THE checkout UNKNOWN path: post-DRAFT intents present state "unknown" with who-resolves + re-check trigger (asserted); unknown references map to the availability-unknown presentation (asserted).
7. **Reconciliation:** The recorded reconciliation path: re-check re-reads the Intent Authority and reports whatever returns, including another unknown.
8. **Evidence:** The status record reconciliation fields; the refusal detail; the JSON artifact steps (CHECKOUT STATUS over AUTHORIZED, DECISION SUBMIT, UNKNOWN-REFERENCE STATUS).
9. **User-visible state:** The merchant decision page renders UNKNOWN (never success/failure) for the post-DRAFT offer, and the accept control submission surfaces the explicit refusal wording — nothing is committed.
   - verified by: Port-level recorded records + the display resolution through the product own resolveCheckoutDisplay/resolveCheckoutAdapterErrorPresentation (recorded in the steps).

---

## Journey WF-4 — Waiting/recovery: queue item → WAITING snapshot → re-check command → cancel recovery → terminal resolution (+ the retry denial)

Work item ID: UI-010 (evidence bundle; the workflow exercises the surfaces of UI-002..UI-008 over the UI-011 composed runtime)
Surfaces crossed: tracking surface (/track/[referenceId]) → waiting/recovery surface (/track/[referenceId]/waiting)
Explicit states exercised: WAITING (fq.queued.liquidity-credit, WQ-01); re-check accepted (fq.inquiry.recheck-requested, WQ-15); recovery denial (fq.recovery.denied, WQ-14); FAILED terminal (fq.resolved.failed with reason, WQ-09)
Environment: sandbox topology of the real composed system: plain-Node harness (Node 24.19, native TS type stripping) composing substrate(DEP-003 node:sqlite) + A15 evidence log + A01/A02/A03/A04/A05/A06/A07/A08/A09/A10/A11/A12/A13/A14/A16 authorities + persist hooks + gateway + scheduler + the seven product runtime adapters (the UI-011 splice)

### Steps

1. **QUEUE + ITEM (A08 command surface)** — queue-ui010 (OPEN); item pid.v1.32062efd9e08960b52201666ca7273e0ac6714d8e692530c893dbc9cb8e817c9 QUEUED
   - state before: no queue items
   - state after: item pid.v1.32062efd9e08960b52201666ca7273e0ac6714d8e692530c893dbc9cb8e817c9 for intent pid.v1.8aed9241ec8fd1c627f79b4595ce14ed610acc185a8e880fe1e71256e76aab32
1. **WAITING LOOKUP: ports.waiting.lookupWaiting(itemId, "customer")** — fq.queued.liquidity-credit (queued) — display WAITING (WQ-01)
   - state after: whatIsWaiting: Intent pid.v1.8aed9241ec8fd1c627f79b4595ce14ed610acc185a8e880fe1e71256e76aab32's fulfillment (queue queue-ui01 · reason: Waiting on the queue’s release conditions (the eligibility rule the authority evaluates over its own liquidity · expectation: The queue drains (queues.queue.drain.start) and dispatches eligible items in ord
1. **RE-CHECK: ports.waiting.requestRecheck({referenceId, requestedByRole})** — accepted (fq.inquiry.recheck-requested, WQ-15) — routedTo: Fulfillment/Queue Authority (A08) via the protocol gateway — queues.eligibility.evaluate
   - state after: the command is admitted on the durable path; the snapshot re-read reports the authority's answer
1. **SNAPSHOT RE-READ after the re-check** — fq.queued.liquidity-credit — the release conditions still do not hold (an honest no-progression answer, never a fabricated progression)
1. **RETRY RECOVERY: ports.waiting.requestRecovery({actionId: "retry"})** — denied (fq.recovery.denied, WQ-14) — Denied per protocol: the composed runtime exposes no retry command kind — A08’s "never re-queued or re-dispatched until …
1. **CANCEL RECOVERY: ports.waiting.requestRecovery({actionId: "cancel"})** — accepted (fq.recovery.cancel-requested, WQ-12) — routedTo: Fulfillment/Queue Authority (A08) via the protocol gateway — queues.item.cancel
   - state before: item QUEUED
   - state after: the cancel command is admitted; the item's next read reports the authority's state
1. **TERMINAL RE-READ: ports.waiting.lookupWaiting(itemId)** — fq.resolved.failed (outcome failed) — display FAILED terminal (WQ-09)
   - state after: failureReason: Reason code as recorded: INTENT_CANCELLED. · nextActions: A retry is a new, explicitly submitted intent — never a silent re-dispatch (INV-8-4).

### Assertions

- PASS — WF-1's intent is available for the queued fulfillment
- PASS — the queue item is enqueued (A08, ITEM_QUEUED in the A15 chain)
- PASS — the waiting lookup finds the item and presents a QUEUED snapshot
- PASS — the WAITING snapshot carries what/why/next (P6 mandatory content)
- PASS — the recovery actions are explicit: cancel authorized, retry/escalate not-authorized
- PASS — the re-check request is accepted and routed to queues.eligibility.evaluate
- PASS — the re-read after the re-check is still an honest QUEUED (no fabricated progression)
- PASS — the retry recovery is DENIED per protocol (INV-8-4 structural; no retry kind)
- PASS — the cancel recovery is accepted and routed to queues.item.cancel
- PASS — the cancelled item presents the explicit terminal resolution with the recorded reason
- PASS — the waiting lookup also resolves the item by INTENT id (the tracking→waiting deep link)

### Nine reconciliation questions

1. **Protocol object:** The A08 queued fulfillment item (QUEUED → CANCELLED) behind the intent; the queues.eligibility.evaluate and queues.item.cancel commands.
2. **Owning authority:** Fulfillment/Queue Authority (A08), with A06 Liquidity / A07 Credit conditions behind the release policy.
3. **Runtime boundary:** Waiting port lookup (read) and the re-check/recovery requests (commands) crossing to the gateway; the item terms are the A08 record own.
4. **Deployed component:** The runtime waiting adapter over the composed runtime.
5. **Persistent state:** queues.sqlite (the queue + item records), the A15 ITEM_* records, durable.sqlite (the executed commands).
6. **UNKNOWN handling:** The not-found lookup vocabulary is documented as UNKNOWN-honest (WQ records); retry/escalate recovery are denied with the protocol-structural reasons (never offered, never fabricated).
7. **Reconciliation:** The re-check submits queues.eligibility.evaluate and the snapshot re-read reports the authority answer (asserted: still QUEUED — an honest no-progression); the cancel recovery submits queues.item.cancel and the terminal re-read reports CANCELLED with the recorded reason (asserted).
8. **Evidence:** A15 ITEM_QUEUED / ITEM_CANCELLED records; the snapshot evidence links to /track/<intentId>; the JSON artifact steps.
9. **User-visible state:** The waiting surface renders WAITING with what/why/next and explicit recovery authorizations; after the cancel it renders the terminal failed resolution with the reason code; the retry control renders the protocol denial.
   - verified by: Port-level recorded snapshots (the exact data the waiting surface renders).

---

## Journey WF-5 — Mediation/dispute: obligations via clearing → party docket → initiation matrix → dispute open through the gateway → dispute record + recourse trail (+ re-dispute denial + the area-19 gaps)

Work item ID: UI-010 (evidence bundle; the workflow exercises the surfaces of UI-002..UI-008 over the UI-011 composed runtime)
Surfaces crossed: mediation surfaces (/mediation, /mediation/dispute/new, /mediation/dispute/[disputeId]) → tracking surface (the obligation's origin reference)
Explicit states exercised: ACTION_REQUIRED (disputable obligation on the docket); dispute open (MD-201 dispute-open with the authority); denied re-dispute (frozen one-way table); unavailable (area-19 proposals, MD-400-class)
Environment: sandbox topology of the real composed system: plain-Node harness (Node 24.19, native TS type stripping) composing substrate(DEP-003 node:sqlite) + A15 evidence log + A01/A02/A03/A04/A05/A06/A07/A08/A09/A10/A11/A12/A13/A14/A16 authorities + persist hooks + gateway + scheduler + the seven product runtime adapters (the UI-011 splice)

### Steps

1. **CLEARING: gateway clearing.batch.open/stage/commit/finalize** — batch pid.v1.aef13f21c09d4b1f438a0f2d8cf98ea438146cc2e1919611f1e83351a556f98f committed; obligation pid.v1.dd5bf74a1beb8edda4dc01fbcea25f3ce93cca107f0815e64dcb563afbb7e335 CREATED for origin activity-ui010-wf5
   - state before: no obligations in the A10 ledger
   - state after: one OUTSTANDING (CREATED) obligation
1. **PARTY DOCKET: ports.mediation.getPartyDocket("customer")** — fetched — disputes: 0; proposals: 0 (the runtime's authoritative empty set for the area-19 surface); mediations: 0; disputableIntents: 1
   - state after: disputable: activity-ui010-wf5 (Obligation pid.v1.dd5bf74a1beb8edda4dc01fbcea25f3ce93cca107f0815e64dcb563afbb7e335 — 25.00 USD (CREATED))
1. **INITIATION BRIEFING: ports.mediation.getDisputeInitiationBriefing()** — authority: Obligation Authority (A10 dispute primitive) over the composed protocol runtime — obligati…; 5 grounds; 4 consequences; whatHappensNext + consequenceOfInaction present
1. **INITIATION MATRIX: ports.mediation.describeDisputeInitiationMatrix({intentReference})** — customer=true merchant=true provider=false operator=false administrator=false
1. **DISPUTE INITIATION: ports.mediation.initiateDispute({...actor: "customer"})** — initiated — dispute pid.v1.1a0de586f6be80bfa043975b425f097997e6edf309710ec51e288cd6fed8e6f3; obligation now DISPUTED; record authorityState=open
   - state before: obligation pid.v1.dd5bf74a1beb8edda4dc01fbcea25f3ce93cca107f0815e64dcb563afbb7e335 CREATED (OUTSTANDING)
   - state after: obligation DISPUTED (terminalized; no settlement proceeds while the dispute is open)
1. **DISPUTE READ: ports.mediation.getDispute({disputeId, viewer})** — fetched — authorityState=open; recourseTrail: Dispute recorded (completed)
   - state after: proof: A15 chain (dispute pid.v1.1a0de586f6be80bfa043975b425f097997e6edf309710ec51e288cd6fed8e6f3)
1. **RE-DISPUTE DENIAL: initiateDispute on the DISPUTED obligation** — denied — The dispute was NOT initiated — nothing was recorded. The matching obligation is in the DISPUTED state — the frozen one-way table does not allow the D…
1. **AREA-19 GAP: ports.mediation.getProposal({proposalId: "P-001"})** — unavailable — The Agents/Mediation Authority (area 19 — agent proposals, human mediation) is RTN wave 2 and NOT merged as ru…

### Assertions

- PASS — the clearing record stages on the open batch
- PASS — the clearing commit created the obligation in CREATED (the A10 sink)
- PASS — the party docket reads the disputable obligation from the A10 ledger
- PASS — the initiation briefing carries the authority consequence wording before any submit (P2)
- PASS — the initiation matrix authorizes customer+merchant only (P8-style matrix over the A10 primitive)
- PASS — the dispute is initiated through obligations.dispute.open (gateway admission + execution)
- PASS — the obligation is DISPUTED after the command executes
- PASS — the dispute record presents authorityState "open" (not resolved — the command executed)
- PASS — the A15 chain records the DISPUTE_OPEN transition
- PASS — the dispute read returns the fetched record with its recourse trail
- PASS — the recourse trail cites the A15 chain as its proof
- PASS — the party docket now lists the open dispute
- PASS — the re-dispute is DENIED (the frozen one-way table: DISPUTED is not re-enterable)
- PASS — an agent proposal reads unavailable with the recorded area-19 gap (never fabricated)
- PASS — a proposal decision is denied (fail closed; nothing committed)
- PASS — the proposal decision matrix is all-unauthorized (fail closed)

### Nine reconciliation questions

1. **Protocol object:** The A10 obligation (CREATED → DISPUTED) and its dispute record (the obligations.dispute.open primitive); the A15 DISPUTE_OPEN transition; the clearing batch that created the obligation.
2. **Owning authority:** Obligation Authority (A10) owns the obligation state and the dispute primitive; Clearing Authority (A09) created the obligation; the Evidence Authority (A15) owns the chain.
3. **Runtime boundary:** Clearing commands through the gateway; mediation port reads (docket, matrix, dispute) and the dispute-initiation command through the gateway.
4. **Deployed component:** The runtime mediation adapter over the composed runtime.
5. **Persistent state:** obligations.sqlite, clearing.sqlite, the A15 chain, durable.sqlite.
6. **UNKNOWN handling:** Area-19 surfaces (proposals, mediation cases) present unavailable with the recorded gap — never fabricated (asserted); the re-dispute is denied with the frozen one-way table reason (asserted).
7. **Reconciliation:** The dispute is readable by its id; the docket re-read lists it; resolution arrives only as the authority recorded dispute resolution (never from the surface).
8. **Evidence:** The A15 DISPUTE_OPEN record (asserted present); the dispute record recourse trail citing the A15 chain (asserted); the JSON artifact steps.
9. **User-visible state:** The mediation hub renders the disputable obligation and then the open dispute with its recourse trail; the initiation matrix renders per-role authorization (customer/merchant authorized; provider/operator/administrator not — asserted).
   - verified by: Port-level recorded records (the exact data the mediation surfaces render).

---

## Journey WF-6 — Authoritative-UNKNOWN: the operator oversight aggregates (A06/A07/A08 read-surface gap) + provider positions + the oversight role gate

Work item ID: UI-010 (evidence bundle; the workflow exercises the surfaces of UI-002..UI-008 over the UI-011 composed runtime)
Surfaces crossed: operator oversight surface (/oversight) → provider liquidity surface (/liquidity)
Explicit states exercised: UNKNOWN — authoritative (LQ-009/LQ-010 aggregates, authority-unknown with reconciliation); denied (oversight role gate, LQ-011)
Environment: sandbox topology of the real composed system: plain-Node harness (Node 24.19, native TS type stripping) composing substrate(DEP-003 node:sqlite) + A15 evidence log + A01/A02/A03/A04/A05/A06/A07/A08/A09/A10/A11/A12/A13/A14/A16 authorities + persist hooks + gateway + scheduler + the seven product runtime adapters (the UI-011 splice)

### Steps

1. **A06 pool + confirmed funding** — pool-usd funded with 1000.00 USD (POOL_OPENED + FUNDING_CONFIRMED in the A15 chain)
1. **OVERSIGHT READ: ports.liquidity.getOperatorOversight({requester: "operator"})** — 3 aggregates; 3 are authority-unknown
   - state after: oversight-total-reserved (Total reserved across providers (USD)): UNKNOWN — The composed runtime exposes no cross-provider aggregate read: the A06 Liquidity Authority… resolves: The Liquidity Authority (a cross-pool aggregate read) — recorded future read-surface work
           oversight-queue-depth (Queued entries across providers): UNKNOWN — The composed runtime exposes no cross-queue aggregate read: the A08 Queue Authority’s publ… resolves: The Queue Authority (a cross-queue aggregate read) — recorded future read-surface work
           oversight-credit-utilized (Credit utilized across providers (USD)): UNKNOWN — The composed runtime exposes no cross-provider aggregate read: the A07 Credit Authority’s … resolves: The Credit Authority (a cross-line aggregate read) — recorded future read-surface work
1. **PROVIDER POSITIONS: ports.liquidity.getProviderPositions({requester: "provider"})** — 1 liquidity position(s): pid.v1.7cfeb037f5887d83a8199a96d52e687dfaee37835853f54abb9cb774243e6575 available 1000.00 USD; credit lines: 0; queue snapshots: 1
   - state after: the provider surface renders the authority-quoted figures (contrasting the oversight aggregates' authoritative UNKNOWN)
1. **OVERSIGHT ROLE GATE: getOperatorOversight({requester: "customer"})** — denied — The operator oversight surface mirrors what the owning authorities permit: only the operator audience may read the overs…

### Assertions

- PASS — a real pool with confirmed funding exists in A06
- PASS — the operator oversight read is permitted
- PASS — the cross-provider aggregates present authority-UNKNOWN — never a UI-side sum (LQ-009/LQ-010)
- PASS — every authority-unknown aggregate carries who-resolves + recheck-trigger (P5 reconciliation)
- PASS — the provider positions read is permitted with real A06 figures
- PASS — a non-operator requester is denied the oversight read (the port role gate)

### Nine reconciliation questions

1. **Protocol object:** The oversight aggregate reads the runtime cannot answer (cross-provider/cross-queue sums) — authoritative UNKNOWN values; the provider position reads A06 CAN answer.
2. **Owning authority:** Liquidity Authority (A06), Credit Authority (A07), Queue Authority (A08) — the aggregates are theirs and are indeterminate on their current read surfaces.
3. **Runtime boundary:** Liquidity port reads (server composition) → the A06/A07/A08 query APIs.
4. **Deployed component:** The runtime liquidity adapter over the composed runtime.
5. **Persistent state:** The A06 pool/funding records (liquidity.sqlite is not among the per-domain stores — A06 positions live in the reservations-area stores; the A15 POOL_OPENED / FUNDING_CONFIRMED records are the durable proof — asserted present).
6. **UNKNOWN handling:** THE authoritative-UNKNOWN: the three oversight aggregates present authority-unknown with who-resolves and recheck-trigger (asserted) — never a UI-side sum, never zero standing in for an answer.
7. **Reconciliation:** Each unknown aggregate records its resolution: a governed read-surface extension by the owning authority (per-position reads remain available on the provider surface — evidenced by the provider read in the same workflow).
8. **Evidence:** The aggregate values with their explanations and reconciliation paths; the provider position with the real quoted figure (1000.00 USD) as the contrast; the JSON artifact steps.
9. **User-visible state:** The oversight surface renders UNKNOWN for the aggregates with the plain-language explanations and reconciliation; the provider liquidity surface renders the authority-quoted figures.
   - verified by: Port-level recorded values (the exact data the oversight/liquidity surfaces render) + Leg B renders the oversight surface over HTTP.

**Authoritative-UNKNOWN rendered:** [{"aggregateId":"oversight-total-reserved","subject":"total reserved across providers"},{"aggregateId":"oversight-queue-depth","subject":"queued entries across providers"},{"aggregateId":"oversight-credit-utilized","subject":"credit utilized across providers"}] — unknown (authority-unknown values with reconciliation paths) — never success, never failure, never a fabricated sum

---
