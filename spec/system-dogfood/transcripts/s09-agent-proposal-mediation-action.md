# SYS-002 dogfood transcript — s09-agent-proposal-mediation-action

**Scenario:** agent proposal → simulation → mediation → authorized action
**Required scenario:** yes (the SYS-002 work order’s required list)
**Result:** PASS
**Revision:** `e9da03abfa649fbfb88cd344cb95117ad18ddc79` (tree `bcb654f091c385f4107e29d089e9e20de9742b23`)
**Environment class:** sandbox (the forbidden clause honored — no production financial claims derivable from this evidence)

## Drive 1 — http-built-app

- **Boundary:** `/mediation`, `/mediation/proposal/[proposalId]`, `/api/mediation/decision`, `/api/mediation/action`, `/api/mediation/script`
- **Steps (3):**
  - **party docket (user-visible outcome)**
    - exchange: GET /mediation → 200
    - authority state: PartyDocket fetched (A10 read surface; proposals/mediations = the runtime’s authoritative empty sets — area 19 gap recorded)
    - UX observation: Agent proposals addressed to you</h2><span data-slot="badge" data-variant="secondary" class="group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounde
    - elapsed: 16 ms
  - **agent proposal surface (the area-19 gap presentation)**
    - exchange: GET /mediation/proposal/sys002-dogfood-proposal-001 → 200
    - UX observation: agent proposals could not be retrieved (The Agents/Mediation Authority (area 19 — agent proposals, human mediation) is RTN wave 2 and NOT merged as runtime code: the composed runtime cannot currently report this record, and nothing is synthesized in
    - recovery arm: unavailable (typed; the recorded D-8 gap — never a fabricated proposal record)
    - elapsed: 16 ms
  - **decision/action/script APIs (fail-closed arms)**
    - exchange: POST /api/mediation/decision → 200
    - durable evidence: `{"committed":0,"fabricated":0}`
    - UX observation: Not applied: the composed runtime exposes no agent-proposal command surface (the Agents/Mediation Authority, area 19, is RTN wave 2). The decision on proposal sys002-dogfood-proposal-001 was refused —
- **Findings:**
  - The authorized-action arm of the agent-proposal journey is NOT-IMPLEMENTED-AT-THIS-LAYER: the Agents/Mediation Authority (area 19) is RTN wave 2 — every decision/action surface fails closed with the recorded gap (D-8). The dispute primitive (area 10) IS merged and is driven end-to-end in S10. *(owning work item: D-8 (RTN wave-2 runtime work orders))*
