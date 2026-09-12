# RTN-007 — Liquidity Authority contract review

Work order: `spec/protocol-runtime-work-orders/RTN-007.md`
Owned surface: `src/lib/protocol-runtime/liquidity/` (area 6 — A06)
Rule: **every exported type/function/constant maps to a cited
`spec/architecture/v0.1/` source; rows with no source are forbidden.**

Method: each row lists the primary `spec/architecture/v0.1/` source (file,
section, line, and the quoted line that grounds the export) and, where
needed, the supporting contracts outside v0.1 that additionally bind the
export (the kernel declarations, the A15 contracts in
evidence-risk-compliance.md, the A05 contracts in core.md that compose
with this area, the RTN wave conventions, the registry projection, the
DEP-003 persistence substrate). Quoted text is verbatim from the frozen
v0.1 directory; line numbers refer to the files as merged at the RTN-007
base (`main @ fe0fed0`).

Exported symbol count: **72** (51 runtime symbols enumerated from
`liquidity.ts` at load + 21 exported types). Table rows: **72**. The
counts match.

## Recorded interpretation decisions and deviations

1. **The position machine is exact and one-way: there is NO RESERVED ->
   AVAILABLE edge.** liquidity-credit-queues.md lines 38-39 give
   "AVAILABLE -> RESERVED -> terminal(CONSUMED | RETURNED)". A position
   whose live holds drain to zero ends its reservation cycle TERMINAL —
   CONSUMED iff consumed == total (exhausted), RETURNED otherwise (the
   residual — total - consumed — stays attributed to the returned
   position and keeps counting in the pool total, exactly as INV-6-1's
   "pool total equals the integer sum of its positions" requires).
   Re-offering capacity is the funding flow's job (a new FundingEntry
   creates a new AVAILABLE position). The alternative reading (a
   RESERVED -> AVAILABLE return edge allowing multi-cycle positions) is
   NOT an edge of the written chain; "All three state machines exact"
   (the work order's acceptance) selects the literal one.
2. **The position IS the area-5 ledger resource.** core.md lines 335-336
   ("Depends on areas 6, 7, and 3 as resource owners") plus lines 293-295
   ("all resource mutations pass through [the ledger]") position the
   Liquidity Authority as the resource owner that declares each position
   on the RTN-006 ReservationLedger with declared total = the position
   amount. The position's accounting triple is therefore EXACTLY the
   ledger's INV-5-1 accounting, and the position's state machine is the
   pure left fold of the ledger's per-resource entry log
   (accounting.ts): HELD entries drive AVAILABLE -> RESERVED; a
   REQUESTED(REJECT) resolution (RELEASED for a never-held request) has
   no machine effect; consumption/release/expiry of live holds drive the
   terminal folds. Reservations against liquidity positions are mediated
   by THIS authority (the fold fails loudly on a HELD entry against a
   terminal position — the same corrupt-log convention the ledger itself
   applies).
3. **Pool machine exactness.** OPEN -> FROZEN -> CLOSED only: closure
   requires FROZEN (not directly from OPEN) with every position terminal
   ("closure is terminal after all positions settle", lines 33-35);
   freezing is available from OPEN at any time; there is no unfreeze
   edge. Funding is accepted only into OPEN pools (a wind-down pool
   accepts no new positions — the spec gates "no new reservations" and a
   position created into a frozen pool could never be reserved).
4. **INV-6-3 is structural.** The FundingEntry id is DERIVED from its
   linked source reference — deriveProtocolId('liquidity-funding-entry',
   kind, referenceId) — so the same rail operation id or internal
   transfer id always names the same entry: the direct confirmed path
   and the pending-resolution path derive the SAME id (machine-checked),
   and duplicate submissions are detected by id and reported with no
   effect ("duplicate funding submissions are detected by id and
   recorded as duplicates without effect", lines 58-60). Duplicates emit
   no evidence record (no state mutation; the A06 named set is
   exhaustive — the RTN-005/RTN-006 precedent).
5. **The UNKNOWN-funding path.** openPendingFunding records the durable
   reconciliation linkage with the pool UNCHANGED (lines 64-67); NO
   evidence record is emitted for the linkage or its failure resolution
   (no financial state mutated; the named set is exhaustive). Only
   RESOLVED_CONFIRMED creates the entry — exactly once — writing
   FUNDING_RECORDED and the funded position's POSITION_STATE_CHANGED;
   RESOLVED_FAILED closes the linkage with no entry (lines 66-69). The
   confirmed amount is the linkage's expected amount; amount
   discrepancies are area-14 RESOLVED_ADJUSTED cases (an area-9/10 flow,
   rails-adapters-reconciliation.md lines 175-179) — out of scope here.
   RESOLVED_CONFIRMED arriving for a non-OPEN pool is the typed
   POOL_NOT_OPEN rejection (the composition root re-routes — recorded).
6. **Evidence emission points.** Each pool state transition writes its
   own POOL_* record; the position's creation into AVAILABLE writes
   POSITION_STATE_CHANGED (creation IS a transition of the position);
   every machine state change thereafter writes POSITION_STATE_CHANGED
   with the post-transition INV-6-1 arithmetic-identity hash; every
   FundingEntry creation writes FUNDING_RECORDED with the linked source
   reference id among the subject ids. Accounting-only changes (a second
   hold on an already-RESERVED position) emit NO liquidity record — the
   area-5 ledger's own RESERVATION_HELD/CONSUMED/RELEASED/EXPIRED
   records carry the resource arithmetic (GC-5's one-record-per-operation
   holds per authority: the ledger records the reservation transition,
   liquidity records the position machine transition).
7. **Expiry.** expireDueHolds runs the ledger's deterministic deadline
   sweep ("expiry is deterministic on protocol time", core.md lines
   290-291) and re-folds each affected position once, in ascending
   position-id order. The sweep is global over the ledger; the
   composition root sequences the sibling domains' sweeps so every
   resource owner observes the sweep's effects on its resources
   (recorded limitation).
8. **State layer.** In-process single writer (the RTN-002/RTN-005
   precedent); the durable side is persistence.ts + migrations/ over the
   DEP-003 substrate read-only. Pool-mutating commands serialize under
   the POOL key; position-mutating commands under the POSITION key;
   commits are synchronous blocks, so cross-group observation is always
   pre- or post-commit.

## Exported symbol table (72 rows)

### types.ts (16 runtime + 14 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `POOL_STATES` | const | liquidity-credit-queues.md §1 lines 33-34: "States: OPEN -> FROZEN -> CLOSED." |
| `PoolState` | type | Same as above. |
| `POOL_TRANSITIONS` | const | Same as above (the chain this table materializes). |
| `isPoolState` | fn | Same as above (the vocabulary this guard re-checks). |
| `canTransitionPool` | fn | Same as above; lines 33-35 (freeze/closure semantics). |
| `POSITION_STATES` | const | liquidity-credit-queues.md §1 lines 38-39: "States: AVAILABLE -> RESERVED -> terminal(CONSUMED | RETURNED)." |
| `PositionState` | type | Same as above. |
| `POSITION_TRANSITIONS` | const | Same as above; lines 38-39: "Transitions are driven exclusively by area 5 reservations." |
| `isPositionState` | fn | Same as above. |
| `canTransitionPosition` | fn | Same as above. |
| `LIQUIDITY_REASON_CODES` | const | §1 lines 33-43, 71-75 (the grounded reasons) + A15 line 30: "outcome: resulting state or decision, including reason codes." |
| `LiquidityReasonCode` | type | Same as above. |
| `isLiquidityReasonCode` | fn | A15 line 30. |
| `FUNDING_SOURCE_KINDS` | const | §1 lines 40-43: "referencing either an internal transfer of settled funds (area 12) or a confirmed external funding rail operation (area 13)." |
| `FundingSourceKind` | type | Same as above. |
| `isFundingSourceKind` | fn | Same as above. |
| `LiquidityPoolRecord` | type | §1 lines 31-34: "LiquidityPool — protocol-owned account of funds usable for fulfillment in one currency." + INV-6-1 lines 52-54. |
| `LiquidityPositionRecord` | type | §1 lines 36-39: "LiquidityPosition — component of a pool attributed to a funding source or operational purpose." + core.md lines 335-336. |
| `FundingSource` | type | §1 lines 40-43 (the reference pair). |
| `FundingEntryRecord` | type | §1 lines 40-43, 64-69: "the FundingEntry is created exactly once." |
| `PendingFundingLinkRecord` | type | §1 lines 64-67: "the pool is unchanged, and the case waits for reconciliation (GC-2)" + rails-adapters-reconciliation.md lines 171-179. |
| `LIQUIDITY_REJECTION_CODES` | const | §1 lines 71-75 (the exhaustive named set — rejections emit none) + the rails typed-rejection convention. |
| `LiquidityRejectionCode` | type | Same as above. |
| `isLiquidityRejectionCode` | fn | Same as above. |
| `LiquidityCommandResult` | type | INV-6-2 lines 55-57 + INV-6-3 lines 58-60 + the merged typed-result convention. |
| `FundingCommandResult` | type | INV-6-3 lines 58-60: "a FundingEntry id applies exactly once; duplicate funding submissions are detected by id and recorded as duplicates without effect." |
| `ResolvePendingFundingResult` | type | §1 lines 66-69: "If reconciliation confirms failure, no entry is created." |
| `PENDING_FUNDING_RESOLUTIONS` | const | rails-adapters-reconciliation.md lines 171-179 (RESOLVED_CONFIRMED / RESOLVED_FAILED). |
| `PendingFundingResolution` | type | Same as above. |
| `isPendingFundingResolution` | fn | Same as above. |

### state-machine.ts (3 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `transitionPool` | fn | §1 lines 33-35 (the pool machine's carrier). |
| `transitionPosition` | fn | §1 lines 38-39 (the position machine's carrier). |
| `positionTransitionTime` | fn | A15 line 28: "when: protocol time (sequenced) and recorded wall time." |

### accounting.ts (8 runtime + 2 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `POSITION_ARITHMETIC_IDENTITY_HASH_FORMAT_VERSION` | const | §1 lines 73-74: "POSITION_STATE_CHANGED (with post-transition arithmetic proof)." |
| `PositionFold` | type | INV-6-1 lines 52-54 (the accounting triple + machine state) + core.md lines 304-306 (INV-5-1). |
| `PositionLedgerProjection` | type | core.md lines 293-295: "per-resource serialized log of reservation transitions." |
| `initialPositionFold` | fn | INV-6-1 lines 52-54 (the identity's zero point). |
| `positionInvariantHolds` | fn | INV-6-1 lines 52-54: "per position, available + reserved + consumed arithmetic is exact and integer." |
| `foldPositionFromEntries` | fn | INV-6-2 lines 55-57: "position transitions occur only via the area 5 serialized ledger" + core.md lines 288-295. |
| `poolInvariantHolds` | fn | INV-6-1 lines 52-54: "pool total equals the integer sum of its positions at all times" + INV-6-2 lines 55-57. |
| `sumPositionTotals` | fn | INV-6-1 lines 52-54 (the recomputed right-hand side) + README.md §3 GC-1. |
| `canonicalPositionAccounting` | fn | §1 lines 73-74 (the arithmetic proof's encoding) + A15 lines 31-32. |
| `positionArithmeticIdentityHash` | fn | §1 lines 73-74: "post-transition arithmetic proof." |

### serializer.ts (1 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `KeyedSerializer` | class | INV-6-2 lines 55-57 via core.md lines 293-295: "The ledger is the concurrency frontier: all resource mutations pass through it in sequence order." |

### evidence.ts (8 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `LIQUIDITY_AUTHORITY_ID` | const | spec/registry/protocol-registry.json A06: "Liquidity Authority". |
| `LIQUIDITY_EVIDENCE_VOCABULARY` | const | §1 lines 71-75: "POOL_OPENED, POOL_FROZEN, POOL_CLOSED. POSITION_STATE_CHANGED ... FUNDING_RECORDED". |
| `poolOpenedEvidence` | fn | §1 line 73: "POOL_OPENED" + A15 lines 26-32 + GC-5. |
| `poolFrozenEvidence` | fn | §1 line 73: "POOL_FROZEN" + lines 33-35 ("Frozen pools accept no new reservations"). |
| `poolClosedEvidence` | fn | §1 line 73: "POOL_CLOSED" + lines 33-35. |
| `positionStateChangedEvidence` | fn | §1 lines 73-74: "POSITION_STATE_CHANGED (with post-transition arithmetic proof)." |
| `fundingRecordedEvidence` | fn | §1 lines 74-75: "FUNDING_RECORDED (linked rail operation id or internal transfer id)." |
| `submitLiquidityEvidence` | fn | A15 lines 62-64: "an operation is not committed until its record is written. A failed write fails the operation." |

### authority.ts (1 runtime + 3 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `LiquidityAuthority` | class | §1 lines 47-48: "Liquidity Authority (protocol layer, area 6) owns pool and position state. No other layer may recompute or duplicate it (GC-4)." |
| `LiquidityAuthorityDeps` | type | A15 lines 41-43 (the writers-by-submission port) + core.md lines 293-295, 335-336 (the ledger dependency). |
| `PositionHoldRecord` | type | §1 lines 38-39 + core.md lines 286-291 (the driving reservation). |
| `LiquidityRejection` | type | The typed-rejection convention (§1 lines 71-75's exhaustive named set). |

### persistence.ts (14 runtime + 2 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `DEFAULT_LIQUIDITY_DB_PATH` | const | The per-domain persistence convention (RTN-001 decision) + spec/durable/execution.md §2 lines 40-43. |
| `LIQUIDITY_MIGRATIONS_DIR_ENV_VAR` | const | spec/durable/execution.md §2 lines 44-47. |
| `LIQUIDITY_MIGRATIONS_RELATIVE_DIR` | const | The per-domain persistence convention. |
| `LIQUIDITY_STORE_DOMAIN` | const | Same as above. |
| `resolveLiquidityMigrationsDir` | fn | spec/durable/execution.md §2/§4 (the migration conventions). |
| `LiquidityStoreOptions` | type | Same as above. |
| `openLiquidityStore` | fn | spec/protocol-runtime-work-orders/README.md "Persistence convention" + spec/durable/execution.md §3/§4. |
| `writePool` | fn | §1 lines 31-35 (the persisted pool shape). |
| `writePosition` | fn | §1 lines 36-39 + INV-6-1 lines 52-54. |
| `writeFundingEntry` | fn | §1 lines 40-43 + INV-6-3 lines 58-60. |
| `writePendingFundingLink` | fn | §1 lines 64-69. |
| `readPools` | fn | §1 lines 31-34 + README.md §3 GC-1. |
| `readPositions` | fn | §1 lines 36-39 + GC-1. |
| `readFundingEntries` | fn | §1 lines 40-43, 58-60 + GC-1. |
| `readPendingFundingLinks` | fn | §1 lines 64-69 + GC-1. |
| `LiquidityStoreWrite` | type | INV-6-3 lines 58-60 (the dedupe report) + DEP-003 §6. |

Runtime row count: 16 + 3 + 8 + 1 + 8 + 1 + 14 = **51**.
Type row count: 14 + 2 + 3 + 2 = **21**.
Total: **72** — matches the barrel's exported symbol count.
