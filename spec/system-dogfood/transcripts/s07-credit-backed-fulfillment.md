# SYS-002 dogfood transcript — s07-credit-backed-fulfillment

**Scenario:** credit-backed fulfillment
**Required scenario:** yes (the SYS-002 work order’s required list)
**Result:** PASS
**Revision:** `e9da03abfa649fbfb88cd344cb95117ad18ddc79` (tree `bcb654f091c385f4107e29d089e9e20de9742b23`)
**Environment class:** sandbox (the forbidden clause honored — no production financial claims derivable from this evidence)

## Drive 1 — composed-runtime

- **Boundary:** `CreditAuthority exported APIs`, `getLiquidityPort().getProviderPositions`
- **Steps (3):**
  - **the A07 line offered + activated**
    - authority state: CreditLine ACTIVE (A07) — limit 200.00 USD
    - durable evidence: `{"line_id":"sys002-dogfood-credit-line"}`
    - elapsed: 1 ms
  - **A07 exposure/backing path**
    - authority state: CreditLine ACTIVE (A07) — limit 200.00 USD
    - authority state: CreditDecision APPROVED + APPLIED → reservation consumed; exposure 60000
    - durable evidence: `{"exposure":{"reserved":0,"consumed":60000,"remaining":140000}}`
    - elapsed: 4 ms
  - **credit visibility surface**
    - authority state: ProviderPositions permitted (the A07 read surface)
    - UX observation: permitted — the credit line sys002-dogfood-credit-line presented with its exposure figures
