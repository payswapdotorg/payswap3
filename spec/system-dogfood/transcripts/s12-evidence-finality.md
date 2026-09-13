# SYS-002 dogfood transcript — s12-evidence-finality

**Scenario:** evidence/finality where the protocol path is complete
**Required scenario:** yes (the SYS-002 work order’s required list)
**Result:** PASS
**Revision:** `e9da03abfa649fbfb88cd344cb95117ad18ddc79` (tree `bcb654f091c385f4107e29d089e9e20de9742b23`)
**Environment class:** sandbox (the forbidden clause honored — no production financial claims derivable from this evidence)

## Drive 1 — http-built-app

- **Boundary:** `/track/[referenceId]`, `read-only SQLite over var/web-runtime`
- **Steps (1):**
  - **durable rows over the HTTP-leg runtime**
    - durable evidence: `{"store":"durable.sqlite","rows":[{"kind":"capability.register","status":"succeeded","n":1},{"kind":"intent.submit","status":"succeeded","n":1},{"kind":"obligations.clearing.commit","status":"succeeded","n":1},{"kind":"obligations.dispute.open","status":"succeeded","n":1},{"kind":"queues.eligibility.evaluate","status":"succeeded","n":1},{"kind":"queues.item.cancel","status":"succeeded","n":1},{"kind":"queues.item.enqueue","status":"succeeded","n":1},{"kind":"queues.queue.create","status":"succeeded","n":1},{"kind":"rails.adapter.activate","status":"succeeded","n":1},{"kind":"rails.adapter.register","status":"succeeded","n":1},{"kind":"reconciliation.cycle.close","status":"succeeded","n":1},{"kind":"reconciliation.cycle.matching.run","status":"succeeded","n":1},{"kind":"reconciliation.cycle.open","status":"succeeded","n":1},{"kind":"reconciliation.cycle.statements.collect","status":"succeeded","n":1},{"kind":"reconciliation.source.register","status":"succeeded","n":1},{"kind":"settlement.attempt.authorize","status":"succeeded","n":1},{"kind":"settlement.attempt.submit","status":"succeeded","n":1},{"kind":"settlement.finality.declare","status":"succeeded","n":1},{"kind":"settlement.instruction.create","status":"succeeded","n":1}]}`
    - UX observation: /track evidence trail presented for the journey (18 evidence rows behind it)

## Drive 2 — composed-runtime

- **Boundary:** `evidenceLog.verifyAndRecord`, `read-only SQLite over var/web-runtime`
- **Steps (2):**
  - **A15 chain verification**
    - durable evidence: `{"verdict":"VERIFIED","records":48,"operation_types":["ADAPTER_STATE_CHANGED","CAPABILITY_REGISTERED","CASE_OPENED","CASE_RESOLVED","CREDIT_DECIDED","CREDIT_LINE_STATE_CHANGED","EVIDENCE_LOG_GENESIS","EVIDENCE_LOG_VERIFICATION","EXPOSURE_CHANGED","FUNDING_RECORDED","INTENT_CREATED","ITEM_DISPATCHED","ITEM_ELIGIBLE","ITEM_GRADUATED","ITEM_QUEUED","NETTING_COMMITTED","NETTING_COMPUTED","NETTING_SET_OPENED","OBLIGATION_CREATED","OBLIGATION_STATE_CHANGED","POOL_OPENED","POSITION_STATE_CHANGED","RAIL_OP_AUTHORIZED","RAIL_OP_REPORTED","RAIL_OP_SUBMITTED","RESERVATION_CONSUMED","RESERVATION_HELD","SETTLEMENT_ATTEMPT_AUTHORIZED","SETTLEMENT_ATTEMPT_RESOLVED","SETTLEMENT_INSTRUCTION_CREATED"]}`
  - **durable + evidence + finality rows**
    - durable evidence: `{"durable_jobs":20,"evidence_rows":46,"finality_final_records":0}`
- **Findings:**
  - The evidence/finality scenario’s FINAL arm is bound to the A12 applyResolution surface gap (see the S03 finding): on the app composition finality is proven as NEVER-ASSERTED-OVER-UNRESOLVED (the correct protocol behavior), and the evidence chain fully verifies; the FINAL advance itself is evidenced by the RTN-012 composed-journey harness (its test:golden-path / test:unknown-confirmed scenarios, kept green in the gate battery).
