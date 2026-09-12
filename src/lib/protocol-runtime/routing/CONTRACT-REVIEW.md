# RTN-006 — Routing Authority contract review

Work order: `spec/protocol-runtime-work-orders/RTN-006.md`
Owned surface: `src/lib/protocol-runtime/routing/` (area 4 — A04)
Rule: **every exported type/function/constant maps to a cited
`spec/architecture/v0.1/` source; rows with no source are forbidden.**

Method: each row lists the primary `spec/architecture/v0.1/` source (file,
section, line, and the quoted line that grounds the export) and, where
needed, the supporting contracts outside v0.1 that additionally bind the
export (the kernel declarations, the A15 contracts in
evidence-risk-compliance.md, the A13/A14 UNKNOWN contracts in
rails-adapters-reconciliation.md, the RTN wave conventions, the registry
projection). Quoted text is verbatim from the frozen v0.1 directory; line
numbers refer to the files as merged at the RTN-006 base
(`main @ 92adb6a`).

Exported symbol count: **74** (49 runtime symbols enumerated from
`routing.ts` at load + 25 exported types). Table rows: **74**. The counts
match.

## Recorded interpretation decisions and deviations

1. **The transition table extends the linear chain with the area's own
   contracts.** core.md lines 224-225 give the machine
   `COMPILED -> VALIDATED -> DISPATCHED -> terminal(COMPLETED | FAILED |
   ABANDONED)`. Lines 255-259 add the load-bearing DISPATCHED exits: "the
   plan then halts at DISPATCHED — it never re-dispatches hops blindly
   (GC-2). Recovery proceeds only after reconciliation (area 14) resolves
   the UNKNOWN rail operation; the plan then completes or fails based on
   the resolved outcome" — so DISPATCHED carries COMPLETED and FAILED
   exits, and a second dispatch is unrepresentable (no DISPATCHED ->
   DISPATCHED edge). ABANDONED's triggers are not enumerated by v0.1; the
   recorded interpretation: ABANDONED is the NON-execution give-up terminal
   (pre-dispatch abandonment — SUPERSEDED / PAYER_CANCELLED; dispatch-time
   acquisition failure — ACQUISITION_FAILED, INV-4-2's acquisition step
   failed with nothing dispatched; halted-plan give-up after its
   reservations expired — RESERVATIONS_EXPIRED), while FAILED is the
   execution-failure terminal (cited by lines 258-259).
2. **The compiler's domain is the spec triple plus recorded conversion
   facts.** core.md lines 227-229 name the function's inputs as "(intent
   terms, policy evaluation, capability snapshot)" — the three authority
   inputs of areas 1-3. INV-4-1 (lines 242-243) requires "explicit,
   recorded conversion amounts for any currency change" and forbids
   floating-point derivation; no v0.1 area supplies rates to area 4 (the
   liquidity areas are single-currency; no FX surface exists in v0.1). The
   materialization therefore carries the conversion amounts as an optional
   per-compilation schedule of explicit integer Money PAIRS
   (`ConversionQuote`) — caller-supplied recorded facts (in the full
   protocol, from the later waves' quote surfaces), not a fourth authority
   input. The compiler performs NO rate arithmetic anywhere: a quote
   applies only when its from-amount EXACTLY equals the value flowing into
   the hop it converts; without a quote, a currency change is unrecordable
   and its chain fails compilation (NO_VIABLE_ROUTE). This is the design
   that keeps the stop condition "any need for floating-point conversion
   arithmetic" unreachable.
3. **The value-preservation identity is materialized as eight integer
   rules (V1..V8).** INV-4-1 (lines 239-244) says preservation is "checked
   by integer summation — for a simple transfer, hop amounts equal the
   intent amount in each currency leg, with explicit, recorded conversion
   amounts for any currency change. Fees are explicit Money line items."
   The check (value.ts) asserts: per-hop Money well-formedness in the
   corridor source currency; hop 0's amount IS the intent amount; unbroken
   corridor chaining (currency AND geography); every currency change
   carries exactly one conversion line item with exact integer amounts;
   flow continuity (each hop's output equals the next hop's input by
   integer equality); the last hop's output IS the delivered amount in the
   destination currency; exactly one fee line item per hop; no orphan line
   items. For a simple transfer this reduces to the spec's sentence
   verbatim. Fees are recorded ALONGSIDE the flow (not deducted from it):
   v0.1 names fees as line items and the cost ceiling as their bound, not
   as flow deductions.
4. **Chain search and ranking are deterministic and pinned.** Usable
   capabilities: ACTIVE, envelope-allowed rail, cost schedule in the
   ceiling's currency and scale (the same INV-2-1 comparability the
   RTN-005 evaluation applies). Chains: simple paths (no repeated
   capability) through the corridor graph from the intent source to the
   intent destination. Ranking: hop count ascending, then element-wise
   comparison under the policy's ordering directive (the same comparator
   RTN-005 ranks route requirements with). The DFS keeps a running minimum
   under a fixed exploration bound (`SEARCH_EXPANSION_LIMIT`), a constant
   OF the pinned compiler version — deterministic per version.
5. **The demand signal is a durable routing-domain record with the
   emission point recorded.** core.md lines 253-254: "NO_VIABLE_ROUTE is a
   terminal failure that also emits a demand signal for area 24" (the
   follow-on wave's emergence surface — no A24 consumer exists at this
   base). The signal id is derived from the compilation key (idempotent
   emission, one signal per key); the emission point is the derived record
   id of the ROUTE_FAILED record that carries the NO_VIABLE_ROUTE outcome
   (computed with RTN-002's own `evidenceRecordId` — composing with the
   merged evidence module's exported API).
6. **The UNKNOWN-hop halt emits no evidence record of its own.** The halt
   is not a state-machine transition (the plan stays DISPATCHED — lines
   255-259); the UNKNOWN fact's own evidence belongs to the rail and
   reconciliation areas (rails-adapters-reconciliation.md lines 124-125:
   "Every UNKNOWN rail operation automatically opens exactly one case").
   The halt is recorded as a plan-record annotation; its resolution flows
   into the ROUTE_COMPLETED / ROUTE_FAILED records' reason codes. A04's
   named evidence set (lines 263-265) is exhaustive — the RTN-005
   precedent. All terminal transitions from DISPATCHED are refused while
   any halt is unresolved (UNRESOLVED_UNKNOWN_HOP) — the structural form
   of GC-2's "never blindly".
7. **Terminal transitions drive the plan's own reservations' terminals.**
   core.md lines 319-322 (A05): UNKNOWN-associated reservations "are then
   consumed or released exactly once (GC-2)" — the completing plan
   consumes its reservations in fixed hop order; a failing or abandoned
   plan releases what is still HELD. Consumption skips already-CONSUMED
   reservations (INV-5-3 idempotent observation), making recovery replay
   safe. Per-hop consume/release on partial failure (settled hops consume,
   unsettled release) is area 12/14 composition — recorded as a known
   limitation, not implemented here.
8. **Dispatch crash-consistency.** If the ROUTE_DISPATCHED evidence write
   fails after the acquisitions, the command throws, the plan stays
   VALIDATED, and the holds remain HELD; a re-dispatch re-requests the
   same derived reservation ids and the ledger returns the recorded HELD
   state (INV-5-3), so the retry is idempotent — no blind double-hold is
   possible (proven in routing/integration.test.ts).
9. **The area-5 dependency is an injected port** (`ReservationAcquisition`)
   declared by routing (dependency inversion — the kernel's
   EvidenceSubmission pattern) and implemented over the ReservationLedger
   by `reservations/acquisition.ts` (this work order's sibling surface,
   type-only import of the port shape).
10. **Commands are async and await the evidence submission; the state
    layer is an in-process single writer** (the RTN-002/RTN-005 precedent)
    so the full command discipline runs under `bun test` — Bun 1.3.14 does
    not implement node:sqlite. The durable side is the per-domain
    persistence module (owned migrations + bridge functions), exercised by
    `scripts/test_protocol_routing_reservations.mjs` under plain Node.
11. **`settlementSemantics` is a deterministic label.** v0.1 names the hop
    slot (lines 221-223: "expected settlement semantics"; lines 214-216:
    "which settlement instructions to expect") without enumerating its
    vocabulary; the materialization records the corridor-destination
    settlement expectation as a machine-readable label
    (`HOP_SETTLEMENT:<src>-><dst>@<dstGeo>`); area 12's wave owns the real
    semantics.

## Exported-symbol table

| # | Export | Kind | v0.1 source (quoted line) | Supporting | Notes |
|---|--------|------|---------------------------|------------|-------|
| 1 | `ROUTE_PLAN_STATES` | const | core.md lines 224-225: "States: COMPILED -> VALIDATED -> DISPATCHED -> terminal(COMPLETED | FAILED | ABANDONED)." | — | Frozen 6-member vocabulary |
| 2 | `RoutePlanState` | type | core.md lines 224-225 | — | Closed union; 3 terminals |
| 3 | `ROUTE_PLAN_TRANSITIONS` | const | core.md lines 224-225 | lines 255-259 (the DISPATCHED exits) | Decision 1: chain + the area's own UNKNOWN/failure contracts |
| 4 | `isRoutePlanState` | function | core.md lines 224-225 | — | Runtime guard |
| 5 | `canTransitionRoutePlan` | function | core.md lines 224-225 | lines 255-259 | Table predicate; no DISPATCHED -> DISPATCHED edge (GC-2 structural) |
| 6 | `ROUTE_PLAN_REASON_CODES` | const | core.md lines 263-265: "(with reason codes and affected hop ids)" | lines 253-254 (NO_VIABLE_ROUTE); lines 258-259 (HOP_FAILED); INV-4-2 lines 245-247 (ACQUISITION_FAILED); A05 lines 288-291 (RESERVATIONS_EXPIRED); INV-4-2 (SUPERSEDED); A01 PAYER_CANCELLED mirror | 6 members, each flow-cited; frozen |
| 7 | `RoutePlanReasonCode` | type | core.md lines 263-265 | — | Closed union |
| 8 | `isRoutePlanReasonCode` | function | core.md lines 263-265 | — | Runtime guard |
| 9 | `ConversionLineItem` | interface | core.md lines 242-243: "with explicit, recorded conversion amounts for any currency change" | GC-1 (README.md §3 lines 39-43) | One per currency change; exact integer pair |
| 10 | `FeeLineItem` | interface | core.md lines 243-244: "Fees are explicit Money line items" | — | Exactly one per hop |
| 11 | `RouteValueLedger` | interface | core.md lines 239-244 (INV-4-1) | — | The value-preservation material: source, delivered, conversions, fees |
| 12 | `RouteHop` | interface | core.md lines 221-223: "ordered hops, each hop naming a capability (rail id, corridor), an amount (Money), and expected settlement semantics." | lines 270-271 (capability by id, no credentials) | Decision 11: settlement label |
| 13 | `HopReservationRef` | interface | core.md lines 245-247: "dispatch acquires reservations (area 5) in the plan's fixed hop order" | INV-5-3 (lines 310-312) | The acquired reservation id per hop |
| 14 | `UnknownHopRef` | interface | core.md lines 255-257: "a hop may return UNKNOWN from a rail (area 13); the plan then halts at DISPATCHED" | rails-adapters-reconciliation.md lines 124-125 | Halt annotation with resolution slot |
| 15 | `RoutePlan` | interface | core.md lines 221-225: "RoutePlan — compiled plan: ordered hops..." | INV-4-2 lines 245-247; INV-4-3 lines 248-249 | planId, compilerVersion, snapshotId, hops, ledger, refs, halts |
| 16 | `RouteDemandSignal` | interface | core.md lines 253-254: "NO_VIABLE_ROUTE is a terminal failure that also emits a demand signal for area 24." | — | Decision 5: emission point = the ROUTE_FAILED record id |
| 17 | `ConversionQuote` | interface | core.md lines 242-243 ("explicit, recorded conversion amounts") | README.md §3 GC-1 lines 39-43 | Decision 2: recorded facts, one quote per pair |
| 18 | `ROUTE_REJECTION_CODES` | const | core.md lines 263-265 (the exhaustive named evidence set) | rails typed-rejection convention | 8 typed rejection codes; no invented evidence |
| 19 | `RouteRejectionCode` | type | core.md lines 263-265 | — | Closed union |
| 20 | `RouteCommandResult` | type | core.md lines 224-230 | INV-4-2/INV-4-3 | Updated plan or typed rejection |
| 21 | `RouteCompilationResult` | type | core.md lines 227-230 (RouteCompiler); lines 253-254 | INV-4-3 lines 248-249 | Plan / terminal NO_VIABLE_ROUTE + signal / typed rejection |
| 22 | `ReservationAcquisitionRequest` | interface | core.md lines 245-247 (INV-4-2's acquisition step) | INV-5-3 lines 310-312 | The port's request input |
| 23 | `ReservationAcquisitionResult` | type | core.md lines 245-247 | INV-5-2 lines 307-309 | Acquired id or typed failure |
| 24 | `ReservationTerminalResult` | type | core.md lines 319-322: "consumed or released exactly once (GC-2)" | — | Terminal observation |
| 25 | `ReservationAcquisition` | interface | core.md lines 272-273: "Depends on areas 1-3 for inputs and area 5 for reservation acquisition during dispatch." | lines 319-322 | Decision 9: the injected area-5 port |
| 26 | `transitionRoutePlan` | function | core.md lines 224-225 | lines 255-259 | Pure; hops/ledger/snapshot ride verbatim |
| 27 | `requiresReasonCode` | function | core.md lines 263-265 ("with reason codes") | lines 253-254 | FAILED/ABANDONED require codes |
| 28 | `checkRoutePlanReasonCode` | function | core.md lines 263-265 | — | Vocabulary validation |
| 29 | `hasUnresolvedUnknownHop` | function | core.md lines 255-259: "Recovery proceeds only after reconciliation (area 14) resolves the UNKNOWN rail operation" | README.md §3 GC-2 lines 45-49 | The terminal-transition guard |
| 30 | `deadlinePassedAt` | function | core.md lines 288-291 (A05: "Each reservation carries a deadline; expiry is deterministic on protocol time") | — | Integer wall-time predicate |
| 31 | `hopOutputAmount` | function | core.md lines 239-244 (INV-4-1) | — | Same-currency passthrough; cross-currency conversion output |
| 32 | `totalFeesInCurrency` | function | core.md lines 243-244 ("Fees are explicit Money line items") | — | Integer summation of the line items |
| 33 | `checkRouteValuePreservation` | function | core.md lines 239-244: "the plan's value preservation is checked by integer summation" | GC-1 | Decision 3: the V1..V8 identity |
| 34 | `canonicalValueFlow` | function | core.md lines 239-244; line 263 ("plan hash") | GC-1 | Deterministic encoding of the full flow |
| 35 | `availableAfterFees` | function | core.md lines 243-244 | — | Projection helper (fees alongside the flow) |
| 36 | `ValuePreservationCheck` | type | core.md lines 239-244 | — | Typed failure with the rule id |
| 37 | `ROUTE_COMPILER_VERSION` | const | core.md lines 229-230: "Compiler versions are pinned; the version id is recorded in every plan." | INV-4-3 lines 248-249 | Pinned at 1; participates in the plan id |
| 38 | `ROUTE_PLAN_HASH_FORMAT_VERSION` | const | core.md line 263: "ROUTE_COMPILED (compiler version, snapshot id, plan hash)" | GC-1 | `rph.v1.` prefix |
| 39 | `SEARCH_EXPANSION_LIMIT` | const | (determinism; v0.1 prescribes no search) | README.md §3 GC-1 lines 39-43 | Decision 4: a constant of the pinned compiler version |
| 40 | `canonicalConversionSchedule` | function | core.md lines 242-243 | GC-1 | One quote per pair; ambiguous input rejected |
| 41 | `hopComparator` | function | core.md lines 91-93 (A02: "ordering"); line 105 ("ranked route requirements") | INV-2-1 | The policy ordering's total order over hops |
| 42 | `settlementSemanticsFor` | function | core.md lines 214-216 ("which settlement instructions to expect"); lines 221-223 | — | Decision 11: the deterministic label |
| 43 | `compileRoutePlan` | function | core.md lines 227-230: "RouteCompiler — deterministic function from (intent terms, policy evaluation, capability snapshot) to either a RoutePlan or a reason-coded failure (NO_VIABLE_ROUTE)." | INV-4-1/4-2/4-3; lines 253-254; lines 269-271 (never calls rails, never mutates balances) | PURE; decision 2 (conversion facts) and 4 (search/ranking) |
| 44 | `canonicalRoutePlan` | function | core.md line 263 ("plan hash") | INV-4-3 | Covers the compilation key + the value flow |
| 45 | `routePlanHash` | function | core.md line 263: "ROUTE_COMPILED (compiler version, snapshot id, plan hash)" | GC-1 | sha256; feeds the ROUTE_COMPILED proof |
| 46 | `RoutePlanContent` | interface | core.md lines 221-230; INV-4-3 lines 248-249 | — | The pure compiler's output (authority adds state + times) |
| 47 | `RouteCompilationOutcome` | type | core.md lines 228-230 ("either a RoutePlan or a reason-coded failure (NO_VIABLE_ROUTE)") | — | The pure outcome |
| 48 | `RouteCompilationRequest` | interface | core.md lines 227-229 (the triple) | INV-4-3 | Decision 2: triple + optional conversion facts |
| 49 | `ROUTING_AUTHORITY_ID` | const | core.md lines 232-234: "Routing Authority (protocol layer, area 4) owns compilation and plan state." | registry A04 "owningAuthority": "Routing Authority" | The 'authority' slot value |
| 50 | `ROUTE_EVIDENCE_VOCABULARY` | const | core.md lines 263-265 (the named set) | — | Exactly the 6 named types |
| 51 | `routeCompiledEvidence` | function | core.md line 263: "ROUTE_COMPILED (compiler version, snapshot id, plan hash)." | A15 lines 26-32; GC-5 | Decision on slot mapping: snapshot id -> subjectIds; version -> sequenceNumbers; hash -> hashes |
| 52 | `routeValidatedEvidence` | function | core.md lines 263-265 ("ROUTE_VALIDATED") | A15 lines 26-32; GC-5 | Plan hash in proof |
| 53 | `routeDispatchedEvidence` | function | core.md lines 263-265 ("ROUTE_DISPATCHED") | INV-4-2; A15 lines 31-32 | Acquired reservation ids as prior-record links |
| 54 | `routeCompletedEvidence` | function | core.md lines 263-265 ("ROUTE_COMPLETED ... (with reason codes and affected hop ids)") | A15 lines 26-32; GC-5 | All hop ids as affected subjects |
| 55 | `routeFailedEvidence` | function | core.md lines 263-265 ("ROUTE_FAILED ... (with reason codes and affected hop ids)") | A15 lines 26-32; GC-5 | Reason code + affected subset |
| 56 | `routeNoViableRouteEvidence` | function | core.md lines 253-254: "NO_VIABLE_ROUTE is a terminal failure" | INV-4-3 lines 248-249; A15 lines 26-32 | Subjects: intent + the compilation-attempt key |
| 57 | `routeAbandonedEvidence` | function | core.md lines 263-265 ("ROUTE_ABANDONED ... (with reason codes and affected hop ids)") | A15 lines 26-32; GC-5 | Reason code + affected subset |
| 58 | `submitRoutingEvidence` | function | A15 lines 62-64: "an operation is not committed until its record is written. A failed write fails the operation." | kernel ports.ts | Submit-then-commit coupling |
| 59 | `KeyedSerializer` | class | INV-4-2/INV-4-3 (core.md lines 245-249): compilation keyed per plan; dispatch ordered | — | Per-key async total order; domain-owned copy (RTN-005 discipline) |
| 60 | `RoutingAuthority` | class | core.md lines 232-235: "Routing Authority (protocol layer, area 4) owns compilation and plan state. Execution of a dispatched plan is owned by areas 5-13." | INV-4-1/4-2/4-3; lines 253-259; lines 263-265 | The command surface |
| 61 | `RoutingAuthorityDeps` | interface | core.md lines 232-235 | lines 272-273 (the area-5 port); A15 lines 62-64 | evidence + reservations + wallClock |
| 62 | `DEFAULT_ROUTING_DB_PATH` | const | (persistence convention; v0.1 prescribes no storage — README.md §9 lines 173-174) | spec/durable/execution.md §2 lines 40-43; wave README "Persistence convention" | var/routing.sqlite |
| 63 | `ROUTING_MIGRATIONS_DIR_ENV_VAR` | const | (same) | spec/durable/execution.md §2 lines 44-47 | PAYSWAP_ROUTING_MIGRATIONS_DIR |
| 64 | `ROUTING_MIGRATIONS_RELATIVE_DIR` | const | (same) | the per-domain convention | src/lib/protocol-runtime/routing/migrations |
| 65 | `ROUTING_STORE_DOMAIN` | const | (same) | — | 'protocol-runtime-routing' |
| 66 | `resolveRoutingMigrationsDir` | function | (same) | spec/durable/execution.md §2/§4; the substrate walk-up strategy | explicit -> env -> walk-up -> fail-closed |
| 67 | `openRoutingStore` | function | (same) | spec/durable/execution.md §3/§4; RTN-001 kernel/persistence.ts (the reference pattern) | openDurableDatabase over the owned migrations |
| 68 | `writeRoutePlan` | function | (same) | core.md lines 221-230 (the record persisted) | INSERT-only on identity; INV-4-3 storage-level collapse |
| 69 | `saveRoutePlanState` | function | (same) | core.md lines 224-225; lines 255-259 | State/refs/halts projection of ROUTE_* transitions |
| 70 | `writeRouteDemandSignal` | function | (same) | core.md lines 253-254 | INSERT-only; one signal per compilation key |
| 71 | `readRoutePlans` | function | (same) | GC-1 | Read-back reconstruction; Money re-minted |
| 72 | `readRouteDemandSignals` | function | (same) | core.md lines 253-254 | Read-back reconstruction |
| 73 | `RoutingStoreOptions` | interface | (same) | the substrate's DurableDatabaseOptions shape | dbPath + migrationsDir |
| 74 | `RoutingStoreWrite` | interface | (same) | DEP-003 §6 dedupe-report shape | { created, reason } |

## Verification

- `bunx tsc --noEmit`: 0 errors.
- `bun test`: the 123 RTN-006 tests (routing + reservations) green; the
  merged suites untouched and green (568 total across the repository).
- `bun run build`: green.
- `node scripts/test_protocol_routing_reservations.mjs`: the durable-side
  harness green (migrations applied, round trips exact, INV-4-3/INV-5-3
  storage-level UNIQUEs, durable crash recovery, deterministic transcripts).
