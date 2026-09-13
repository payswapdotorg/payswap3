# SYS-002 dogfood transcript — s03-unknown-safe-reconciliation

**Scenario:** UNKNOWN external outcome and safe reconciliation
**Required scenario:** yes (the SYS-002 work order’s required list)
**Result:** PASS
**Revision:** `e9da03abfa649fbfb88cd344cb95117ad18ddc79` (tree `bcb654f091c385f4107e29d089e9e20de9742b23`)
**Environment class:** sandbox (the forbidden clause honored — no production financial claims derivable from this evidence)

## Drive 1 — http-built-app

- **Boundary:** `/api/protocol/commands`, `/oversight`
- **Steps (16):**
  - **command obligations.clearing.commit**
    - exchange: POST /api/protocol/commands → 200
    - command: `obligations.clearing.commit` via Obligation Authority (key `sys002.dogfood.http.obligation`)
    - elapsed: 511 ms
  - **command settlement.instruction.create**
    - exchange: POST /api/protocol/commands → 200
    - command: `settlement.instruction.create` via Settlement and Finality Authority (key `sys002.dogfood.http.instruction`)
    - elapsed: 515 ms
  - **command rails.adapter.register**
    - exchange: POST /api/protocol/commands → 200
    - command: `rails.adapter.register` via Rail Authority (key `sys002.dogfood.http.rails.register`)
    - elapsed: 510 ms
  - **command rails.adapter.activate**
    - exchange: POST /api/protocol/commands → 200
    - command: `rails.adapter.activate` via Rail Authority (key `sys002.dogfood.http.rails.activate`)
    - elapsed: 509 ms
  - **command settlement.attempt.authorize**
    - exchange: POST /api/protocol/commands → 200
    - command: `settlement.attempt.authorize` via Settlement and Finality Authority (key `sys002.dogfood.http.attempt.authorize`)
    - elapsed: 509 ms
  - **command settlement.attempt.submit**
    - exchange: POST /api/protocol/commands → 200
    - command: `settlement.attempt.submit` via Settlement and Finality Authority (key `sys002.dogfood.http.attempt.submit`)
    - elapsed: 509 ms
  - **the unresolved external outcome (recovery arm)**
    - authority state: SettlementAttempt PENDING (A12 — the rail accepted; the external outcome is not yet known)
    - durable evidence: `{"store":"settlement.sqlite","attempt":"PENDING"}`
    - recovery arm: PENDING (typed; the attempt stays unresolved — never translated to success or failure)
  - **command settlement.finality.declare**
    - exchange: POST /api/protocol/commands → 200
    - command: `settlement.finality.declare` via Settlement and Finality Authority (key `sys002.dogfood.http.finality`)
    - elapsed: 507 ms
  - **finality refused (over the unresolved attempt)**
    - authority state: finality declaration REFUSED NOT_PROVISIONAL — the executed typed refusal (GC-2; FINAL requires a CONFIRMED attempt)
    - durable evidence: `{"finality_records_for_instruction":0}`
  - **command reconciliation.source.register**
    - exchange: POST /api/protocol/commands → 200
    - command: `reconciliation.source.register` via Reconciliation Authority (key `sys002.dogfood.http.source`)
    - elapsed: 511 ms
  - **command reconciliation.cycle.open**
    - exchange: POST /api/protocol/commands → 200
    - command: `reconciliation.cycle.open` via Reconciliation Authority (key `sys002.dogfood.http.cycle`)
    - elapsed: 509 ms
  - **command reconciliation.cycle.statements.collect**
    - exchange: POST /api/protocol/commands → 200
    - command: `reconciliation.cycle.statements.collect` via Reconciliation Authority (key `sys002.dogfood.http.collect`)
    - elapsed: 509 ms
  - **command reconciliation.cycle.matching.run**
    - exchange: POST /api/protocol/commands → 200
    - command: `reconciliation.cycle.matching.run` via Reconciliation Authority (key `sys002.dogfood.http.matching`)
    - elapsed: 509 ms
  - **command reconciliation.cycle.close**
    - exchange: POST /api/protocol/commands → 200
    - command: `reconciliation.cycle.close` via Reconciliation Authority (key `sys002.dogfood.http.cycle.close`)
    - elapsed: 509 ms
  - **A14 cycle + discrepancy case**
    - authority state: ReconciliationCycle CLOSED (A14 — the statement reconciliation machinery)
    - authority state: ReconciliationCase OPEN (CYCLE_DISCREPANCY — the UNKNOWN statement’s case, awaiting investigation)
    - durable evidence: `{"store":"rails.sqlite","cycle":{"status":"CLOSED","discrepancy_count":1},"case":{"case_id":"pid.v1.9a5d4c97abbf4ed5d5b388066c8bb2cc12bb70b798dfb6812fb00f39d9b849a5","status":"OPEN","origin_kind":"CYCLE_DISCREPANCY"}}`
  - **oversight UNKNOWN presentation (recovery arm)**
    - exchange: GET /oversight → 200
    - UX observation: thority’s own read; cross-provider aggregates are authority-UNKNOWN by the recorded read-surface gap — never UI-side sums. Provenance wording names the owning authority on every cell.<!-- --> Provenance labels still name the au
    - elapsed: 25 ms
- **Findings:**
  - The UNKNOWN-attempt arm (rail SILENCE → attempt UNKNOWN → INV-14-1 auto-case → UNKNOWN_HELD finality refusal) has a registry/binding vocabulary gap on the app composition: the gateway registers ‘settlement.attempt.railoutcome.apply’ while the hosted binding kind is ‘settlement.report.apply’ (and ‘settlement.resolution.apply’ carries no hosted binding at all) — the admitted-but-queued class recorded by the DEP-007 runbook. The dogfood therefore drives finality-refused-over-PENDING (NOT_PROVISIONAL) plus the A14 statement/case machinery; the full UNKNOWN→resolution→finality advance is evidenced by the RTN-012 composed-journey harness on its own composition (kept green in the gate battery).

## Drive 2 — composed-runtime

- **Boundary:** `ReconciliationAuthority exported APIs (investigateCase/resolveCase)`
- **Steps (13):**
  - **intent.submit (the seed)**
    - command: `intent.submit` via Intent Authority (key `sys002.dogfood.composed.unknown.001`)
    - elapsed: 0 ms
  - **obligations.clearing.commit (the seed obligation)**
    - command: `obligations.clearing.commit` via Obligation Authority (key `sys002.dogfood.composed.unknown.obligation`)
    - elapsed: 0 ms
  - **rails.adapter.register**
    - command: `rails.adapter.register` via Rail Authority (key `sys002.dogfood.composed.unknown.rails.register`)
    - elapsed: 0 ms
  - **rails.adapter.activate**
    - command: `rails.adapter.activate` via Rail Authority (key `sys002.dogfood.composed.unknown.rails.activate`)
    - elapsed: 1 ms
  - **settlement.instruction.create**
    - command: `settlement.instruction.create` via Settlement and Finality Authority (key `sys002.dogfood.composed.unknown.instruction`)
    - elapsed: 1 ms
  - **settlement.attempt.authorize**
    - command: `settlement.attempt.authorize` via Settlement and Finality Authority (key `sys002.dogfood.composed.unknown.authorize`)
    - elapsed: 0 ms
  - **settlement.attempt.submit**
    - command: `settlement.attempt.submit` via Settlement and Finality Authority (key `sys002.dogfood.composed.unknown.submit`)
    - elapsed: 0 ms
  - **reconciliation.source.register**
    - command: `reconciliation.source.register` via Reconciliation Authority (key `sys002.dogfood.composed.unknown.source`)
    - elapsed: 0 ms
  - **reconciliation.cycle.open**
    - command: `reconciliation.cycle.open` via Reconciliation Authority (key `sys002.dogfood.composed.unknown.cycle`)
    - elapsed: 0 ms
  - **reconciliation.cycle.statements.collect (the UNKNOWN statement)**
    - command: `reconciliation.cycle.statements.collect` via Reconciliation Authority (key `sys002.dogfood.composed.unknown.collect`)
    - elapsed: 0 ms
  - **reconciliation.cycle.matching.run**
    - command: `reconciliation.cycle.matching.run` via Reconciliation Authority (key `sys002.dogfood.composed.unknown.matching`)
    - elapsed: 0 ms
  - **A14 case resolved**
    - authority state: ReconciliationCase MATCHED (A14 — pid.v1.dc57a0e9144bb194d7f334b1303951b975341028706c267f39c1128ff5bc835d)
    - durable evidence: `{"store":"rails.sqlite","row":{"status":"MATCHED"}}`
    - elapsed: 2 ms
  - **settlement.finality.declare (post-resolution)**
    - command: `settlement.finality.declare` via Settlement and Finality Authority (key `sys002.dogfood.composed.unknown.finality`)
    - elapsed: 0 ms
- **Findings:**
  - The finality-advance arm has no drive surface on the app composition: the A12 recovery-directive application (SettlementAuthority.applyResolution) and the rail-outcome application (applyRailOutcome) are reachable neither through gateway-admitted kinds with hosted bindings nor through the runtime handle — after the A14 case resolves, the attempt stays PENDING and finality stays (correctly) refused NOT_PROVISIONAL. The full advance path is proven by the RTN-012 composed-journey harness on its own composition (kept green in the gate battery).
