# SYS-002 dogfood transcript — s08-capability-emergence

**Scenario:** capability emergence/provider contribution
**Required scenario:** yes (the SYS-002 work order’s required list)
**Result:** PASS
**Revision:** `e9da03abfa649fbfb88cd344cb95117ad18ddc79` (tree `bcb654f091c385f4107e29d089e9e20de9742b23`)
**Environment class:** sandbox (the forbidden clause honored — no production financial claims derivable from this evidence)

## Drive 1 — http-built-app

- **Boundary:** `/api/protocol/commands`, `/capabilities`, `/capabilities/[capabilityId]`
- **Steps (3):**
  - **command capability.register**
    - exchange: POST /api/protocol/commands → 200
    - command: `capability.register` via Capability Authority (key `sys002.dogfood.http.capability`)
    - elapsed: 506 ms
  - **capability listing (user-visible outcome)**
    - exchange: GET /capabilities → 200
    - authority state: CapabilityRecord REGISTERED/PENDING (A03 — activation is compliance-gated by A16)
    - UX observation: x min-h-11 items-center underline-offset-4 hover:underline" href="/capabilities/sys002-dogfood-cap">Capability sys002-dogfood-cap</a></h3><p class="text-xs text-muted-foreground">sys002-dogfood-cap</p></div><div class=
    - elapsed: 28 ms
  - **capability detail surface**
    - exchange: GET /capabilities/sys002-dogfood-cap → 200
    - UX observation: js" async=""></script><title>Capability sys002-dogfood-cap — PaySwap provider surface · PaySwap</title><meta name="description" content="PaySwap product foundation (UI-001): application shell, one navigation grammar, s
    - elapsed: 35 ms
