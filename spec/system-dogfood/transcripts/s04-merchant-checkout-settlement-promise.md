# SYS-002 dogfood transcript — s04-merchant-checkout-settlement-promise

**Scenario:** merchant checkout and settlement promise
**Required scenario:** yes (the SYS-002 work order’s required list)
**Result:** PASS
**Revision:** `e9da03abfa649fbfb88cd344cb95117ad18ddc79` (tree `bcb654f091c385f4107e29d089e9e20de9742b23`)
**Environment class:** sandbox (the forbidden clause honored — no production financial claims derivable from this evidence)

## Drive 1 — http-built-app

- **Boundary:** `/checkout`, `/checkout/[checkoutId]`
- **Steps (3):**
  - **checkout offer surface**
    - exchange: GET /checkout → 200
    - authority state: PaymentIntent DRAFT read surface (A01 — the checkout-session authority is area 20, D-8)
    - UX observation: ou accept, you commit to fulfil the order it describes; the authority records acceptance and the customer relies on it. No settlement or finality is stated here — the authority has not reported any.</p><p class="text-xs pt-1">Read the full
    - elapsed: 29 ms
  - **checkout state surface**
    - exchange: GET /checkout/pid.v1.a9b9679763b6c19ab664f1954be45343d1c57dd0d1a47c1e8968e70fd230f076 → 200
    - UX observation: </span> · authority state<!-- --> <span class="font-medium">offered</span></span><span>Recorded <!-- -->2026-09-13 17:39 UTC<!-- --> · reported by<!-- --> <!-- -->runtime checkout adapter over the composed A
    - elapsed: 19 ms
  - **unknown checkout (recovery arm)**
    - exchange: GET /checkout/sys002-dogfood-unknown-checkout → 200
    - UX observation: en offers</a></div></header><section aria-labelledby="state-unavailable-heading" class="grid gap-3"><h2 id="state-unavailable-heading" class="text-lg font-semibold">Checkout state unavailable</h2><div role="status" class="ps-state-
    - elapsed: 17 ms

## Drive 2 — composed-runtime

- **Boundary:** `getCheckoutPort().submitDecision`
- **Steps (1):**
  - **checkout decision refused**
    - durable evidence: `{"committed":0}`
    - UX observation: decision-not-allowed — the checkout-session authority (area 20) is RTN wave 2; nothing was committed
