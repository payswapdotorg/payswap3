# SYS-002 dogfood transcript — s01-customer-pay-track

**Scenario:** customer pay and track
**Required scenario:** yes (the SYS-002 work order’s required list)
**Result:** PASS
**Revision:** `e9da03abfa649fbfb88cd344cb95117ad18ddc79` (tree `bcb654f091c385f4107e29d089e9e20de9742b23`)
**Environment class:** sandbox (the forbidden clause honored — no production financial claims derivable from this evidence)

## Drive 1 — http-built-app

- **Boundary:** `/pay`, `/pay/review`, `/api/protocol/commands`, `/track/[referenceId]`
- **Steps (8):**
  - **compose surface render**
    - exchange: GET /pay → 200
    - UX observation: Send a payment intent · PaySwap</title><meta name="description" content="Outcome-first payment intent composition: state the outcome, then the details the intent needs. Nothing is submitted on this page."/><script src="/_
    - elapsed: 133 ms
  - **review surface render**
    - exchange: GET /pay/review → 200
    - UX observation: Review the full consequences · PaySwap</title><meta name="description" content="The complete intent and its plain-language consequences, visible in
    - elapsed: 36 ms
  - **command intent.submit**
    - exchange: POST /api/protocol/commands → 200
    - command: `intent.submit` via Intent Authority (key `sys002.dogfood.http.pay.001`)
    - elapsed: 523 ms
  - **tracked view (user-visible outcome)**
    - exchange: GET /track/pid.v1.a9b9679763b6c19ab664f1954be45343d1c57dd0d1a47c1e8968e70fd230f076 → 200
    - authority state: PaymentIntent DRAFT (A01 Intent Authority)
    - UX observation: DRAFT state presented with the owning authority + evidence trail — !-- -->spec/architecture/v0.1 core.md + evidence-risk-compliance.md<!-- -->). No value on this page is authoritative.</div></div><a class="group/button inline-flex shrink-0 items-c
    - elapsed: 17 ms
  - **command intent.submit**
    - exchange: POST /api/protocol/commands → 200
    - command: `intent.submit` via Intent Authority (key `sys002.dogfood.http.pay.001`)
    - elapsed: 8 ms
  - **receipt lookup + INV-1-3 replay**
    - exchange: GET /api/protocol/commands?kind&key → 200
    - durable evidence: `{"receipt_outcome":"ADMITTED","replayed":true,"second_effect":false}`
  - **unknown-reference track (recovery arm)**
    - exchange: GET /track/sys002-dogfood-unknown-reference → 200
    - UX observation: his reference in the composed runtime: the Intent Authority holds no intent record for sys002-dogfood-unknown-reference and the A15 chain names no such protocol object. This is the runtime’s real answer for this reference — presented as the e
    - recovery arm: not-found (typed; never translated to success or failure)
    - elapsed: 16 ms
  - **state consistency read**
    - durable evidence: `{"store":"intent.sqlite","row":{"state":"DRAFT"}}`

## Drive 2 — composed-runtime

- **Boundary:** `getIntentPort().requestConsequenceReport`, `POST gateway capability.register`
- **Steps (2):**
  - **quote gate no-answer (recovery arm)**
    - UX observation: The composed runtime’s Capability Authority reports no active capability for this corridor, so no consequence terms can be quoted: the runtime exposes no pre-submit fee surface, and no fee is invented. Without a consequence report there is no review, and without review there is no submit — the flow stops here honestly. Re-check after a capability is registered for the corridor (a real protocol com
    - recovery arm: no-answer (typed; the flow stops honestly — without review there is no submit)
  - **fabricated-review submit refused**
    - durable evidence: `{"committed":0}`
    - UX observation: refused — missing-consequence-review
- **Findings:**
  - The quote-gate’s quoted arm is NOT drivable on the app composition: capability ACTIVATION has no gateway command binding and the A16 risk authority (whose APPROVED check gates activation) is not exposed on the runtime handle — the capability stays PENDING and the quote gate honestly stays no-answer. The full activation→quote path is proven by the RTN-012 composed-journey harness on its own composition.
