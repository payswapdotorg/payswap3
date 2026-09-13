# SYS-002 dogfood transcript — s05-clearing-netting

**Scenario:** cross-corridor reciprocal demand and clearing/netting
**Required scenario:** yes (the SYS-002 work order’s required list)
**Result:** PASS
**Revision:** `e9da03abfa649fbfb88cd344cb95117ad18ddc79` (tree `bcb654f091c385f4107e29d089e9e20de9742b23`)
**Environment class:** sandbox (the forbidden clause honored — no production financial claims derivable from this evidence)

## Drive 1 — composed-runtime

- **Boundary:** `gateway clearing.batch.* / netting.set.* commands`, `ClearingAuthority.addRecord (no HTTP surface — recorded)`
- **Steps (9):**
  - **clearing.batch.open through the gateway**
    - command: `clearing.batch.open` via Clearing Authority (key `sys002.dogfood.composed.clearing.open`)
    - elapsed: 0 ms
  - **reciprocal gross pair 1/4 (alpha → beta) through the clearing-commit command**
    - command: `obligations.clearing.commit` via Obligation Authority (key `sys002.dogfood.composed.clearing.record.c1`)
    - elapsed: 1 ms
  - **reciprocal gross pair 2/4 (beta → alpha) through the clearing-commit command**
    - command: `obligations.clearing.commit` via Obligation Authority (key `sys002.dogfood.composed.clearing.record.c2`)
    - elapsed: 1 ms
  - **reciprocal gross pair 3/4 (beta → gamma) through the clearing-commit command**
    - command: `obligations.clearing.commit` via Obligation Authority (key `sys002.dogfood.composed.clearing.record.c3`)
    - elapsed: 0 ms
  - **reciprocal gross pair 4/4 (gamma → alpha) through the clearing-commit command**
    - command: `obligations.clearing.commit` via Obligation Authority (key `sys002.dogfood.composed.clearing.record.c4`)
    - elapsed: 1 ms
  - **netting.set.open through the gateway**
    - command: `netting.set.open` via Netting Authority (key `sys002.dogfood.composed.netting.open`)
    - elapsed: 0 ms
  - **netting.set.compute through the gateway**
    - command: `netting.set.compute` via Netting Authority (key `sys002.dogfood.composed.netting.compute`)
    - elapsed: 0 ms
  - **netting.set.commit through the gateway**
    - command: `netting.set.commit` via Netting Authority (key `sys002.dogfood.composed.netting.commit`)
    - elapsed: 0 ms
  - **netting complete (conservation recorded)**
    - authority state: NettingSet COMMITTED (A11) — 2 net obligations, sum 5000
    - durable evidence: `{"store":"netting.sqlite","net_obligations":[{"debtor":"alpha","creditor":"gamma","amount_minor":4000},{"debtor":"beta","creditor":"gamma","amount_minor":1000}]}`
- **Findings:**
  - The A09 clearing RECORD STAGING has no gateway/HTTP command surface (the recorded sibling-vocabulary gap): the batch lifecycle commands exist (clearing.batch.open/stage/commit/finalize) but per-record staging is driven through the obligations.clearing.commit alias over the same A09→A10 clearing-commit path — recorded here as the boundary this dogfood actually drove.
