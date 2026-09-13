# SYS-002 dogfood transcript — s02-queued-delayed-fulfillment

**Scenario:** queued/delayed fulfillment
**Required scenario:** yes (the SYS-002 work order’s required list)
**Result:** PASS
**Revision:** `e9da03abfa649fbfb88cd344cb95117ad18ddc79` (tree `bcb654f091c385f4107e29d089e9e20de9742b23`)
**Environment class:** sandbox (the forbidden clause honored — no production financial claims derivable from this evidence)

## Drive 1 — http-built-app

- **Boundary:** `/api/protocol/commands`, `/track/[referenceId]/waiting`
- **Steps (7):**
  - **command queues.queue.create**
    - exchange: POST /api/protocol/commands → 200
    - command: `queues.queue.create` via Queue Authority (key `sys002.dogfood.http.queue`)
    - elapsed: 509 ms
  - **command queues.item.enqueue**
    - exchange: POST /api/protocol/commands → 200
    - command: `queues.item.enqueue` via Queue Authority (key `sys002.dogfood.http.item`)
    - elapsed: 511 ms
  - **item enqueued (durable write-through)**
    - authority state: QueuedItemRecord QUEUED (A08 — item pid.v1.fa12060c3b380ea2f2d499c9e629659abfa244527603d5b72e6768e4e44b2f6a)
    - durable evidence: `{"store":"queues.sqlite","row":{"item_id":"pid.v1.fa12060c3b380ea2f2d499c9e629659abfa244527603d5b72e6768e4e44b2f6a","state":"QUEUED","enqueued_wall_ms":1789321154860}}`
  - **waiting surface (user-visible outcome)**
    - exchange: GET /track/pid.v1.a9b9679763b6c19ab664f1954be45343d1c57dd0d1a47c1e8968e70fd230f076/waiting → 200
    - authority state: QueuedItemRecord QUEUED (A08 Queue Authority)
    - UX observation: Waiting detail — <!-- -->pid.v1.a9b9679763b6c19ab664f1954be45343d1c57dd0d1a47c1e8968e70fd230f076</h1><span data-slot="badge" data-variant="secondary" class="group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden roun
    - elapsed: 34 ms
  - **command queues.eligibility.evaluate**
    - exchange: POST /api/protocol/commands → 200
    - command: `queues.eligibility.evaluate` via Queue Authority (key `sys002.dogfood.http.eligibility`)
    - elapsed: 258 ms
  - **command queues.item.cancel**
    - exchange: POST /api/protocol/commands → 200
    - command: `queues.item.cancel` via Queue Authority (key `sys002.dogfood.http.cancel`)
    - elapsed: 509 ms
  - **terminal state (executed + evidence; the write-through gap recorded)**
    - authority state: QueuedItemRecord CANCELLED (A08 — executed; the A15 evidence records the transition)
    - durable evidence: `{"store_row_state":"ELIGIBLE","evidence_reason_codes":["INTENT_CANCELLED"]}`
- **Findings:**
  - The queues.item.cancel gateway alias (src/lib/protocol/server-runtime.ts) executes the A08 cancel command and records its A15 evidence but omits the durable write-through the sibling bindings perform (persist.queues): the queued_items SQLite row retains the pre-cancel state after an executed cancel. This is the ONLY terminal arm reachable through the HTTP boundary (queues.items.expire is a hosted binding but not a gateway-registered kind; the dispatch/graduation kinds carry no hosted bindings at all — the registry/binding vocabulary-gap class). The full graduation path is driven in the composed leg.

## Drive 2 — composed-runtime

- **Boundary:** `gateway queues.* commands`, `QueueAuthority exported APIs (startDraining/dispatchNext/resolveDispatchedItem)`
- **Steps (6):**
  - **intent.submit through the gateway**
    - command: `intent.submit` via Intent Authority (key `sys002.dogfood.composed.pay.001`)
    - elapsed: 1 ms
  - **queues.queue.create through the gateway**
    - command: `queues.queue.create` via Queue Authority (key `sys002.dogfood.composed.queue`)
    - elapsed: 1 ms
  - **queues.item.enqueue through the gateway**
    - command: `queues.item.enqueue` via Queue Authority (key `sys002.dogfood.composed.item`)
    - elapsed: 0 ms
  - **waiting lookup (condition snapshot)**
    - authority state: QueuedItemRecord QUEUED (A08)
    - UX observation: The fulfillment of intent pid.v1.69e5ddb185d3885a1a7612615e1cdf60bc91e225a2028eae82f8ae65ae1110cf, held by the Fulfillment/Queue Authority in queue sys002-dogfood-composed-queue (QUEUED).
  - **queues.eligibility.evaluate (the protocol-owned snapshot input)**
    - command: `queues.eligibility.evaluate` via Queue Authority (key `sys002.dogfood.composed.eligibility`)
    - elapsed: 1 ms
  - **graduation (terminal state; the write-through gap recorded)**
    - authority state: QueuedItemRecord GRADUATED (RECONCILIATION_CONFIRMED — the authority’s typed result + the A15 evidence)
    - durable evidence: `{"store_row_state":"ELIGIBLE","evidence_reason_codes":["RECONCILIATION_CONFIRMED"]}`
    - elapsed: 4 ms
- **Findings:**
  - The A08 graduation path (startDraining → dispatchNext → resolveDispatchedItem) is drivable only through the authority’s exported APIs (the dispatch kinds are gateway-registered but carry no hosted bindings — the registry/binding vocabulary-gap class), and authority-API transitions perform no binding-level durable write-through: the queued_items SQLite row retains its last persisted state while the authority’s in-memory state and the A15 evidence record the DISPATCHED → GRADUATED transitions. The product surfaces read the authority (in-memory), so the presentations remain correct; the gap affects the store snapshot only.
