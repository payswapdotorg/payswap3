# SYS-002 dogfood transcript — s10-dispute-recourse

**Scenario:** dispute/recourse
**Required scenario:** yes (the SYS-002 work order’s required list)
**Result:** PASS
**Revision:** `e9da03abfa649fbfb88cd344cb95117ad18ddc79` (tree `bcb654f091c385f4107e29d089e9e20de9742b23`)
**Environment class:** sandbox (the forbidden clause honored — no production financial claims derivable from this evidence)

## Drive 1 — http-built-app

- **Boundary:** `/api/protocol/commands`, `/mediation/dispute/new`, `/api/mediation/dispute`, `/mediation/dispute/[disputeId]`, `/mediation`
- **Steps (4):**
  - **dispute initiation surface**
    - exchange: GET /mediation/dispute/new?intentReference=… → 200
    - UX observation: a-label="Dispute initiation"><h1 class="sr-only">Initiate a dispute</h1><article class="space-y-6" aria-labelledby="dispute-initiation-heading"><div id="dispute-initiation-announcements" role="status" aria-live="polite" aria-at
    - elapsed: 31 ms
  - **dispute initiated (user-visible outcome)**
    - exchange: POST /api/mediation/dispute → 200
    - authority state: ObligationRecord DISPUTED (A10 — the dispute primitive terminalized the OUTSTANDING obligation)
    - UX observation: initiated — authorityState open (the EXECUTED DISPUTED state); dispute pid.v1.3eb51def6114f394d2aac934f856f3ac3ef3b38bc97254e02603457c6dacb78c
    - elapsed: 10 ms
  - **dispute detail + docket + record API**
    - exchange: GET /mediation/dispute/pid.v1.3eb51def6114f394d2aac934f856f3ac3ef3b38bc97254e02603457c6dacb78c → 200
    - UX observation: ;svg]:size-3! bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80">pid.v1.3eb51def6114f394d2aac934f856f3ac3ef3b38bc97254e02603457c6dacb78c</span></div><div data-slot="card-title" class="font-heading font-medium group-data-[size=sm]/card:text-sm pt-1 text-bas
    - elapsed: 20 ms
  - **state consistency read**
    - durable evidence: `{"store":"obligations.sqlite","row":{"to_state":"DISPUTED"}}`
