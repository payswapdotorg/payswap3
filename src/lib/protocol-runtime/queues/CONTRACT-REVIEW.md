# RTN-007 — Queue Authority contract review

Work order: `spec/protocol-runtime-work-orders/RTN-007.md`
Owned surface: `src/lib/protocol-runtime/queues/` (area 8 — A08)
Rule: **every exported type/function/constant maps to a cited
`spec/architecture/v0.1/` source; rows with no source are forbidden.**

Method: each row lists the primary `spec/architecture/v0.1/` source (file,
section, line, and the quoted line that grounds the export) and, where
needed, the supporting contracts outside v0.1 that additionally bind the
export. Quoted text is verbatim from the frozen v0.1 directory; line
numbers refer to the files as merged at the RTN-007 base
(`main @ fe0fed0`).

Exported symbol count: **58** (42 runtime symbols enumerated from
`queues.ts` at load + 16 exported types). Table rows: **58**. The counts
match.

## Recorded interpretation decisions and deviations

1. **The queue machine is exact and one-way: no PAUSED -> DRAINING
   resume edge.** liquidity-credit-queues.md lines 163-165 give
   "OPEN -> DRAINING -> PAUSED -> CLOSED" — the literal chain has no
   resume edge, and closure is reachable only from PAUSED. "All three
   state machines exact" (the work order's acceptance) selects the
   literal reading: a paused queue that must dispatch again is
   queue-replacement (a new queue), exactly parallel to the frozen
   pool's wind-down. If the Tech Lead rules resumption in, it is a
   one-line transition-table addition plus one test — recorded as a
   known limitation, not silently added.
2. **The item machine adds the waiting-state expiry/cancellation edges
   the area's own semantics make load-bearing.** The linear chain
   (lines 168-169) is the happy path; the Purpose's own words —
   "intents whose fulfillment cannot proceed now ... wait
   deterministically in queues until they become eligible, expire, or
   are cancelled" (lines 151-159) — make expiry and cancellation
   reachable from the WAITING states, and the failure semantics —
   "confirmation graduates the item; confirmed failure cancels it"
   (lines 201-204) — make both terminals reachable from DISPATCHED.
   This is the same rule RTN-006 applied when core.md's own INV-5-2
   made REQUESTED -> RELEASED load-bearing beyond the reservation
   chain's linear form:
     QUEUED     -> ELIGIBLE | CANCELLED | EXPIRED
     ELIGIBLE   -> DISPATCHED | CANCELLED | EXPIRED
     DISPATCHED -> GRADUATED | CANCELLED
   There is NO edge out of DISPATCHED except GRADUATED and CANCELLED —
   INV-8-4's "it is never re-queued or re-dispatched until
   reconciliation resolves the operation" is STRUCTURAL (machine-checked:
   no such edges exist).
3. **Closure requires every resident item terminal.** A closed queue
   would trap live items (INV-8-2's "an item is resident in exactly one
   queue" has no transfer path); closure from PAUSED with resident
   items is the typed QUEUE_HAS_RESIDENT_ITEMS rejection (recorded —
   the spec names no closure precondition for queues; the residency
   invariant forces one).
4. **INV-8-1 is structural.** The item's terms are set once at enqueue
   (deep-frozen FixedIntentTerms referencing the intent's fixed terms,
   core.md INV-1-1 lines 54-56) and NO command accepts terms as input —
   there is no code path that can change them; tests assert deep
   equality after every transition.
5. **Evidence: the ITEM_* set only.** A08's named set (lines 206-210) is
   exactly the six ITEM_* types — no QUEUE_* types exist, and queue
   state transitions are not financial-state mutations under GC-5's own
   definition ("any operation that creates, mutates, or resolves
   financial state" — "Queues hold intents and plans, never money",
   lines 212-213). The asymmetry with A06/A07 (whose pool/line state
   transitions ARE named evidence types) is the spec's, not an omission.
   Each ITEM_* record carries the item's queue sequence in
   proof.sequenceNumbers ("each with queue sequence") and reason codes
   where applicable; the INV-8-4 linkage rides subjectIds and
   priorRecordIds.
6. **Eligibility from protocol-owned snapshots only.** The
   ProtocolEligibilitySnapshot input is the areas 3/6/7 view set
   (capability tier/state, liquidity availability, credit remaining);
   the Queue Authority imports no rail surface, performs no I/O, and
   probes nothing ("never by probing rails", lines 197-199). The
   composition root fills the snapshot from the real authorities.
7. **Dispatch is exactly-once per item id.** dispatchNext picks the
   head of the deterministic order (priority class, then queue
   sequence), requires the queue DRAINING and the item ELIGIBLE, and
   links the item to its downstream operation id; the machine has no
   re-dispatch edge, and repeat dispatches surface typed rejections
   (nothing ELIGIBLE remains). Lower priority-class values dispatch
   earlier (recorded interpretation of "priority class"); within a
   class, arrival order (the queue sequence) — FIFO.
8. **State layer.** In-process single writer (the RTN-002/RTN-005
   precedent); the durable side is persistence.ts + migrations/ over the
   DEP-003 substrate read-only. Every item-mutating command runs inside
   the per-queue keyed serializer (INV-8-2's "eligibility evaluation is
   serialized per queue"); the residency registry is updated inside the
   same serialized sections.

## Exported symbol table (58 rows)

### types.ts (15 runtime + 12 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `QUEUE_STATES` | const | liquidity-credit-queues.md §3 lines 163-165: "States: OPEN -> DRAINING -> PAUSED -> CLOSED." |
| `QueueState` | type | Same as above. |
| `QUEUE_TRANSITIONS` | const | Same as above (the chain this table materializes). |
| `isQueueState` | fn | Same as above. |
| `canTransitionQueue` | fn | Same as above. |
| `ITEM_STATES` | const | §3 lines 168-169: "States: QUEUED -> ELIGIBLE -> DISPATCHED -> terminal(GRADUATED \| CANCELLED \| EXPIRED)." |
| `ItemState` | type | Same as above. |
| `ITEM_TRANSITIONS` | const | Same as above + lines 151-159, 201-204 (the load-bearing edges — interpretation 2). |
| `isItemState` | fn | Same as above. |
| `canTransitionItem` | fn | Same as above. |
| `QUEUE_ORDERING_RULE` | const | §3 lines 173-175: "Ordering is deterministic: priority class, then sequence number." |
| `QUEUE_REASON_CODES` | const | §3 lines 151-204, 206-210 (the grounded reasons) + A15 line 30. |
| `QueueReasonCode` | type | Same as above. |
| `isQueueReasonCode` | fn | A15 line 30. |
| `QUEUE_REJECTION_CODES` | const | §3 lines 206-210 (the exhaustive named set) + the typed-rejection convention. |
| `QueueRejectionCode` | type | Same as above. |
| `isQueueRejectionCode` | fn | Same as above. |
| `DISPATCH_RESOLUTIONS` | const | §3 lines 201-204 ("confirmation graduates the item; confirmed failure cancels it") + rails-adapters-reconciliation.md lines 171-179. |
| `DispatchResolution` | type | Same as above. |
| `isDispatchResolution` | fn | Same as above. |
| `QueueReleaseConditions` | type | §3 lines 163-165 ("an eligibility rule (resource availability, capability tier, deadline class)") + lines 197-199. |
| `QueuePolicy` | type | §3 lines 173-175: "QueuePolicy — immutable per-queue policy: ordering rule, max wait, release conditions." |
| `FulfillmentQueueRecord` | type | §3 lines 163-165: "FulfillmentQueue — ordered waiting area with an eligibility rule." |
| `FixedIntentTerms` | type | §3 lines 182-184: "queuing never changes monetary terms; the item references the intent's fixed terms (INV-1-1)" + core.md lines 54-56. |
| `QueuedItemRecord` | type | §3 lines 167-170: "QueuedItem — one waiting intent (or route plan awaiting dispatch)." |
| `ProtocolEligibilitySnapshot` | type | §3 lines 197-199: "evaluated from protocol-owned snapshots (areas 3, 6, 7), never by probing rails." |
| `QueueCommandResult` | type | INV-8-3 lines 187-189 + the merged typed-result convention. |

### state-machine.ts (3 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `transitionQueue` | fn | §3 lines 163-165 (the queue machine's carrier). |
| `transitionItem` | fn | §3 lines 167-170 (the item machine's carrier). |
| `isItemExpiredAtWallMs` | fn | §3 lines 151-159 ("until they become eligible, expire, or are cancelled") + lines 173-175 ("max wait"). |

### ordering.ts (3 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `compareQueuedItems` | fn | §3 lines 173-175: "Ordering is deterministic: priority class, then sequence number." |
| `orderForDispatch` | fn | Same as above. |
| `isEligibleUnderSnapshot` | fn | §3 lines 197-199: "Eligibility that depends on external state is evaluated from protocol-owned snapshots (areas 3, 6, 7), never by probing rails." |

### serializer.ts (1 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `KeyedSerializer` | class | INV-8-2 lines 185-187: "eligibility evaluation is serialized per queue." |

### evidence.ts (9 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `QUEUE_AUTHORITY_ID` | const | spec/registry/protocol-registry.json A08: "Queue Authority". |
| `QUEUE_EVIDENCE_VOCABULARY` | const | §3 lines 206-210: "ITEM_QUEUED, ITEM_ELIGIBLE, ITEM_DISPATCHED, ITEM_GRADUATED, ITEM_CANCELLED, ITEM_EXPIRED". |
| `itemQueuedEvidence` | fn | §3 line 208 ("ITEM_QUEUED") + A15 lines 26-32 + GC-5. |
| `itemEligibleEvidence` | fn | §3 line 208 ("ITEM_ELIGIBLE") + lines 197-199. |
| `itemDispatchedEvidence` | fn | §3 line 208 ("ITEM_DISPATCHED") + INV-8-2 lines 185-187. |
| `itemGraduatedEvidence` | fn | §3 line 208 ("ITEM_GRADUATED") + lines 170-172 ("GRADUATED means downstream fulfillment completed; the evidence chain links the item to the final outcome"). |
| `itemCancelledEvidence` | fn | §3 line 209 ("ITEM_CANCELLED ... reason codes where applicable") + lines 201-204. |
| `itemExpiredEvidence` | fn | §3 line 209 ("ITEM_EXPIRED") + lines 173-175 (max wait). |
| `submitQueueEvidence` | fn | A15 lines 62-64: "an operation is not committed until its record is written. A failed write fails the operation." |

### authority.ts (1 runtime + 2 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `QueueAuthority` | class | §3 lines 177-178: "Queue Authority (protocol layer, area 8) owns queue and item state." |
| `QueueAuthorityDeps` | type | A15 lines 41-43 (the writers-by-submission port). |
| `QueueRejection` | type | The typed-rejection convention (§3 lines 206-210's exhaustive named set). |

### persistence.ts (10 runtime + 2 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `DEFAULT_QUEUES_DB_PATH` | const | The per-domain persistence convention + spec/durable/execution.md §2 lines 40-43. |
| `QUEUES_MIGRATIONS_DIR_ENV_VAR` | const | spec/durable/execution.md §2 lines 44-47. |
| `QUEUES_MIGRATIONS_RELATIVE_DIR` | const | The per-domain persistence convention. |
| `QUEUES_STORE_DOMAIN` | const | Same as above. |
| `resolveQueuesMigrationsDir` | fn | spec/durable/execution.md §2/§4. |
| `QueuesStoreOptions` | type | Same as above. |
| `openQueuesStore` | fn | spec/protocol-runtime-work-orders/README.md "Persistence convention" + spec/durable/execution.md §3/§4. |
| `writeQueue` | fn | §3 lines 163-165, 173-175 (the persisted queue + immutable policy). |
| `writeQueuedItem` | fn | §3 lines 167-175, 182-184 (the persisted item; the terms column written once). |
| `readQueues` | fn | §3 lines 163-165 + README.md §3 GC-1. |
| `readQueuedItems` | fn | §3 lines 167-175, 182-184 + GC-1. |
| `QueuesStoreWrite` | type | INV-8-3 lines 187-189 (the dedupe report) + DEP-003 §6. |

Runtime row count: 15 + 3 + 3 + 1 + 9 + 1 + 10 = **42**.
Type row count: 12 + 2 + 2 = **16**.
Total: **58** — matches the barrel's exported symbol count.
