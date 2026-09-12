# RTN-008 — Clearing Authority contract review

Work order: `spec/protocol-runtime-work-orders/RTN-008.md`
Owned surface: `src/lib/protocol-runtime/clearing/` (area 9 — A09)
Rule: **every exported type/function/constant maps to a cited
`spec/architecture/v0.1/` source; rows with no source are forbidden.**

Method: each row lists the primary `spec/architecture/v0.1/` source (file,
section, line, and the quoted line that grounds the export) and, where
needed, the supporting contracts outside v0.1 that additionally bind the
export (the kernel declarations, the A15 contracts in
evidence-risk-compliance.md, the A14 contracts in
rails-adapters-reconciliation.md, the RTN wave conventions, the registry
projection, the DEP-003 persistence substrate). Quoted text is verbatim
from the frozen v0.1 directory; line numbers refer to the files as merged
at the RTN-008 base (`main @ 28c6746`).

Exported symbol count: **65** (45 runtime symbols enumerated from
`clearing.ts` at load + 20 exported types). Table rows: **65**. The
counts match.

## Recorded interpretation decisions and deviations

1. **Module split is adaptive (the work-order allowance).** The clearing
   surface splits into types.ts (the frozen machines, vocabularies, and
   record shapes), state-machine.ts (pure transition carriers),
   summation.ts (the INV-9-1 validation + per-currency integer summation
   + derived identity), evidence.ts (the named A09 evidence set),
   authority.ts (the composed single-writer command surface), freeze.ts
   + serializer.ts (the per-domain value/ordering discipline helpers),
   persistence.ts + migrations/ (the per-domain durable store), and the
   public barrel — the RTN-005/006/007 module pattern.
2. **"Batches are processed in sequence order" (INV-9-2, lines 52-54) is
   the PROCESSING (staging) order.** The gate: a batch cannot stage while
   an earlier-sequence batch is still OPEN (unprocessed); the
   machine-checkable invariant (`sequenceInvariant`) is that no batch is
   past OPEN while an earlier one is still OPEN; every command runs
   under one global pipeline serializer. The FULL-lifecycle
   rank-monotonicity reading (earlier batches must be at least as
   advanced as later ones at every rank) was considered and REJECTED: a
   STAGED batch holding quarantined records is absorbing (the frozen
   batch machine has no disposition edge out of STAGED) and INV-9-1
   forbids its commit ("a batch is committed only if every included
   record passes validation"), so a strict rank gate would freeze the
   whole clearing pipeline forever on one bad record — contradicting
   lines 37-40 ("they await manual or automated disposition": the
   disposition is out of band, in new batches, and the pipeline must
   continue). The out-of-band disposition path is tested: a stuck batch
   never commits; a fresh batch with the corrected record commits past
   it.
3. **Quarantine blocks the commit (INV-9-1 read literally).** The commit
   gate refuses any batch holding a QUARANTINED record (the work order's
   stop condition "batch commit that can proceed with a failed record").
   Quarantined records stay in the immutable batch contents forever
   ("never dropped"), each evidenced with RECORD_QUARANTINED and its
   reason code.
4. **Records and batches derive their identity (GC-1).** recordId is
   derived from (origin kind, origin activity id) — the INV-10-3
   creation key; batchId is derived from the caller's batch label — the
   INV-9-3 re-commit key; the commit idempotency key is derived from the
   batchId — the BATCH_COMMITTED "idempotency proof". Identical inputs
   always derive identical ids, which makes every no-op structural.
5. **The A09 upstream-UNKNOWN clearability gate is an injectable
   probe.** A09 lines 58-64: "any upstream UNKNOWN (rail operations
   during fulfillment) must already be resolved by area 14 before the
   activity becomes clearable." The authority accepts a `clearability`
   function (origin activity id → unresolved UNKNOWN operation ids);
   records whose activity has unresolved UNKNOWNs quarantine with
   UPSTREAM_UNRESOLVED_UNKNOWN. The real rails-store query is the
   composition root's wiring (proven in the node harness against the
   REAL RTN-004 RailsStore/ReconciliationAuthority/SimulatedRail); the
   default probe reports none (no rails composed).
6. **The FINAL transition emits no evidence record.** The A09 named
   evidence set (lines 66-70) has exactly three members
   (BATCH_STAGED, BATCH_COMMITTED, RECORD_QUARANTINED) and the named set
   is exhaustive (the RTN-005/006/007 precedent — no inventions). FINAL
   is the hand-off acknowledgment: the authority verifies every produced
   obligation id exists in the ledger (the OBLIGATION_LEDGER_MISMATCH
   rejection on a gap) — the hand-off's subject matter is already
   evidenced by the ledger's own OBLIGATION_CREATED records.
7. **Rejections, re-commit no-ops (INV-9-3), and duplicate creation
   no-ops (INV-10-3) emit no record** (no state mutated; the named set is
   exhaustive).
8. **Staging is resumable.** Each record's ACCEPTED ->
   STAGED|QUARANTINED transition is computed, evidenced (the quarantine
   record first, awaited), and committed per record; the pass ends with
   the batch-level summation and the BATCH_STAGED record before the
   batch commits. A failed evidence write fails the staging pass
   ("A failed write fails the operation", A15 lines 62-64) with the
   already-transitioned record states intact (a re-stage skips them) —
   the batch stays OPEN and the INV-9-1 validation re-runs cleanly.
9. **State layer.** In-process single writer (the RTN-002/RTN-005/RTN-007
   in-process-object-store precedent); the durable side is
   persistence.ts + migrations/ over the DEP-003 substrate read-only
   (the RTN-001 convention). Deep-frozen records and record lists make
   "Contents are immutable after STAGED" machine-checkable at the value
   layer (mutation attempts throw in strict-mode ESM).
10. **The sink contract.** The Clearing Authority's product toward area
    10 is `ObligationCreationInstruction` through the
    `ObligationLedgerSink` port (applyClearingCommand + hasObligation).
    The port is clearing-owned (this surface declares it; the sibling
    obligations surface's `applyClearingCommand` structurally implements
    it — both surfaces are the SAME work order, so the composition has
    no unmerged-sibling violation). The corrections carry `correctionOf`
    (the linked prior obligation) per INV-10-1 and A14 lines 175-179
    ("new linked obligations created via area 9/10 paths").

## Exported symbol table (65 rows)

### types.ts (15 runtime + 11 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `BATCH_STATES` | const | clearing-netting-settlement.md §1 lines 30-31: "States: OPEN -> STAGED -> COMMITTED -> FINAL." |
| `BatchState` | type | Same as above. |
| `BATCH_TRANSITIONS` | const | Same as above (the chain this table materializes); lines 31-33 (the freeze/commit/final semantics). |
| `isBatchState` | fn | Same as above (the vocabulary this guard re-checks). |
| `canTransitionBatch` | fn | Same as above. |
| `batchStateRank` | fn | Lines 30-33 (the chain order) + INV-9-2 lines 52-54: "batches are processed in sequence order." |
| `RECORD_STATES` | const | §1 lines 37-38: "States: ACCEPTED -> STAGED \| QUARANTINED." |
| `RecordState` | type | Same as above. |
| `RECORD_TRANSITIONS` | const | Same as above; lines 38-40: "Quarantined records never produce obligations; they await manual or automated disposition with reason codes." |
| `isRecordState` | fn | Same as above. |
| `canTransitionRecord` | fn | Same as above. |
| `CLEARING_REASON_CODES` | const | §1 lines 47-51 (INV-9-1: "a batch is committed only if every included record passes validation"), lines 58-64 (the UNKNOWN gate), lines 38-40 ("with reason codes"). |
| `ClearingReasonCode` | type | Same as above. |
| `isClearingReasonCode` | fn | A15 line 30: "outcome: resulting state or decision, including reason codes." |
| `CLEARING_REJECTION_CODES` | const | §1 lines 30-33 (the machine gates) + lines 47-56 (INV-9-1/9-2/9-3) + the merged typed-rejection convention. |
| `ClearingRejectionCode` | type | Same as above. |
| `isClearingRejectionCode` | fn | Same as above. |
| `CLEARING_ORIGIN_KINDS` | const | §1 lines 35-37: "reference to the fulfilling activity (route plan hop, intent)"; rails-adapters-reconciliation.md lines 177-179 ("new linked obligations created via area 9/10 paths"). |
| `ClearingOriginKind` | type | Same as above. |
| `isClearingOriginKind` | fn | Same as above. |
| `ClearingOriginReference` | type | §1 lines 35-37; INV-9-2 lines 52-54: "record deduplication keys (origin activity id)". |
| `ClearingParties` | type | §1 lines 35-37: "parties" + §2 lines 84-87 ("who owes whom what"). |
| `ClearingRecord` | type | §1 lines 35-40 (the record shape, the quarantine reason, the correction link). |
| `ClearingBatchRecord` | type | §1 lines 29-33 (the batch shape) + lines 48-56 (the summation totals, the sequence, the INV-9-3 recorded result) + lines 67-68 (the staged proof material). |
| `BatchCommitResult` | type | §1 lines 52-56 (INV-9-2/INV-9-3) + lines 67-68: "BATCH_COMMITTED (obligation ids created, idempotency proof)." |
| `ClearingCommandResult` | type | The merged typed-result convention (RTN-005/006/007); §1 lines 47-56 (the INV gates the rejections ground). |

### state-machine.ts (3 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `transitionBatch` | fn | §1 lines 30-33 (the batch machine's carrier). |
| `transitionRecord` | fn | §1 lines 37-40 (the record machine's carrier; the mandatory reason code on the quarantine edge). |
| `clearingTime` | fn | A15 line 28: "when: protocol time (sequenced) and recorded wall time." |

### summation.ts (9 runtime + 1 type)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `CLEARING_DERIVATION_DOMAIN` | const | README.md §3 GC-1 lines 39-43 ("Re-running any computation on identical inputs yields identical outputs") + INV-9-2/9-3/10-3 key contracts. |
| `clearingRecordId` | fn | §2 lines 119-121 (INV-10-3): "obligation creation from clearing is keyed by origin record id." |
| `clearingBatchId` | fn | §1 lines 55-56 (INV-9-3): "re-committing the same batch id is a no-op returning the recorded result." |
| `batchCommitIdempotencyKey` | fn | §1 lines 55-56 (INV-9-3) + lines 67-68: "idempotency proof." |
| `hashStagedContents` | fn | §1 lines 67-68: "BATCH_STAGED (record count, per-currency totals hash)." |
| `validateClearingRecord` | fn | §1 lines 48-51 (INV-9-1: "amounts are integer Money; staging performs per-currency integer summation checks; a batch is committed only if every included record passes validation") + lines 58-64 (the clearability gate). |
| `RecordValidationOutcome` | type | Same as above. |
| `stagedPerCurrencyTotals` | fn | §1 lines 48-51 (INV-9-1) + core.md §0 lines 13-14 (MoneyBag entrywise integer addition). |
| `totalsToMap` | fn | Same as above (the recorded per-currency totals). |
| `canonicalTotalsJson` | fn | README.md §3 GC-1 lines 39-43 + §1 lines 48-51. |

### evidence.ts (6 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `CLEARING_AUTHORITY_ID` | const | spec/registry/protocol-registry.json A09: "Clearing Authority" + §1 lines 42-44: "Clearing Authority (protocol layer, area 9) owns batch and record state." |
| `CLEARING_EVIDENCE_VOCABULARY` | const | §1 lines 66-70: "BATCH_STAGED ... BATCH_COMMITTED ... RECORD_QUARANTINED". |
| `batchStagedEvidence` | fn | §1 lines 67-68: "BATCH_STAGED (record count, per-currency totals hash)" + A15 lines 26-32 + GC-5. |
| `batchCommittedEvidence` | fn | §1 lines 67-68: "BATCH_COMMITTED (obligation ids created, idempotency proof)" + A15 lines 26-32 + GC-5. |
| `recordQuarantinedEvidence` | fn | §1 lines 68-69: "RECORD_QUARANTINED (reason code, origin reference)" + A15 lines 26-32 + GC-5. |
| `submitClearingEvidence` | fn | A15 lines 62-64: "an operation is not committed until its record is written. A failed write fails the operation." |

### authority.ts (1 runtime + 6 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `ClearingAuthority` | class | §1 lines 42-45: "Clearing Authority (protocol layer, area 9) owns batch and record state, and is the only creator of obligation creation instructions." + lines 47-56 (the INV gates). |
| `ObligationCreationInstruction` | type | §1 lines 42-45 (the instruction product) + lines 35-40 (the record fields it carries). |
| `ObligationCreationOutcome` | type | §1 lines 52-54 (INV-9-2: "a committed batch produces each obligation exactly once") + §2 lines 119-121 (INV-10-3 no-ops). |
| `ObligationLedgerSink` | type | §1 lines 42-45 + lines 77-78: "Depends on areas 1-8 for origin activity, area 10 for obligation creation, area 15 for evidence." |
| `ClearabilityProbe` | type | §1 lines 58-64: "any upstream UNKNOWN ... must already be resolved by area 14 before the activity becomes clearable." |
| `ClearingAuthorityDeps` | type | The wave evidence discipline (README.md "Evidence discipline") + the per-domain conventions. |
| `ClearingRecordInput` | type | §1 lines 35-37 (the submitted event shape) + rails-adapters-reconciliation.md lines 175-179 (the correction link). |

### serializer.ts (1 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `KeyedSerializer` | class | INV-9-2 lines 52-54: "batches are processed in sequence order" (the single-lane serialization). |

### persistence.ts (10 runtime + 2 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `DEFAULT_CLEARING_DB_PATH` | const | The per-domain persistence convention (spec/protocol-runtime-work-orders/README.md) + DEP-003 §2 lines 40-43. |
| `CLEARING_MIGRATIONS_DIR_ENV_VAR` | const | DEP-003 §2 lines 44-47; the per-domain convention. |
| `CLEARING_MIGRATIONS_RELATIVE_DIR` | const | The per-domain convention (owned migrations inside the owned prefix). |
| `CLEARING_STORE_DOMAIN` | const | The per-domain convention (the domain's owner identity). |
| `resolveClearingMigrationsDir` | fn | DEP-003 migration conventions (spec/durable/execution.md §2/§4). |
| `ClearingStoreOptions` | type | The per-domain convention; the substrate's DurableDatabaseOptions shape. |
| `openClearingStore` | fn | The per-domain convention; spec/durable/execution.md §3/§4. |
| `writeBatch` | fn | §1 lines 29-33, 55-56 (the persisted batch row incl. the INV-9-3 recorded commit result). |
| `writeRecords` | fn | §1 lines 35-40 (the persisted record rows, stored order preserved). |
| `readBatches` | fn | Same as above + README.md §3 GC-1 (Money re-minted through the kernel guards on the read path). |
| `readRecords` | fn | Same as above. |
| `ClearingStoreWrite` | type | The write-bridge convention (the RTN-007 sibling template). |

Note: freeze.ts exports `deepFreeze` (internal, not exported from the
barrel — the value-layer immutability discipline; the barrel's public
surface is the 64 rows above).
