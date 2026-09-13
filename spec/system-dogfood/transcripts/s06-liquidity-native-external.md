# SYS-002 dogfood transcript — s06-liquidity-native-external

**Scenario:** native and external liquidity
**Required scenario:** yes (the SYS-002 work order’s required list)
**Result:** PASS
**Revision:** `e9da03abfa649fbfb88cd344cb95117ad18ddc79` (tree `bcb654f091c385f4107e29d089e9e20de9742b23`)
**Environment class:** sandbox (the forbidden clause honored — no production financial claims derivable from this evidence)

## Drive 1 — composed-runtime

- **Boundary:** `LiquidityAuthority exported APIs`, `gateway capability.register`, `/liquidity + /oversight (the HTTP leg)`
- **Steps (4):**
  - **the A06 pool: native funding recorded**
    - authority state: LiquidityPool OPEN (A06) — native INTERNAL_TRANSFER position, available 100.00 USD
    - durable evidence: `{"pool_id":"sys002-dogfood-pool","native_position_available":100000}`
    - elapsed: 2 ms
  - **the A06 external + UNKNOWN pending funding paths**
    - authority state: FundingEntry EXTERNAL_RAIL recorded (external liquidity — post-reconciliation confirmation)
    - authority state: PendingFundingLink RESOLVED_CONFIRMED (the UNKNOWN funding path — pool unchanged until confirmation, GC-2)
    - durable evidence: `{"external_position_available":50000,"resolved_pending_available":25000}`
    - elapsed: 3 ms
  - **A06 native + external + resolved-pending positions**
    - authority state: LiquidityPool OPEN (A06) — 3 positions, available sum 175000
    - authority state: PendingFundingLink RESOLVED_CONFIRMED (the UNKNOWN funding path — GC-2)
    - durable evidence: `{"positions":[{"positionId":"pid.v1.4f93e84c6f3451834146f9e8ca9d08d6b90655b87118b4900e132830e1691b79","source":"INTERNAL_TRANSFER","available":100000},{"positionId":"pid.v1.44da82bebff9b54e2956a7a74baa840c58594a4d44a0418bb7fba498a1f27408","source":"EXTERNAL_RAIL","available":50000},{"positionId":"pid.v1.f2a3837e6e63faa0a86946848ad81350cd80d7f4062d272b37fcce56e1f48b98","source":"EXTERNAL_RAIL","available":25000}]}`
  - **provider positions surface**
    - authority state: ProviderPositions permitted (A06 + A07 read surface)
    - UX observation: permitted — 3 liquidity positions presented from the A06 records
