# RTN-008 — Obligation Ledger Authority contract review

Work order: `spec/protocol-runtime-work-orders/RTN-008.md`
Owned surface: `src/lib/protocol-runtime/obligations/` (area 10 — A10)
Rule: **every exported type/function/constant maps to a cited
`spec/architecture/v0.1/` source; rows with no source are forbidden.**

Method: each row lists the primary `spec/architecture/v0.1/` source (file,
section, line, and the quoted line that grounds the export) and, where
needed, the supporting contracts outside v0.1 that additionally bind the
export (the kernel declarations, the A15 contracts in
evidence-risk-compliance.md, the A14 contracts in
rails-adapters-reconciliation.md, the A09 contracts that compose with
this area, the RTN wave conventions, the registry projection, the DEP-003
persistence substrate). Quoted text is verbatim from the frozen v0.1
directory; line numbers refer to the files as merged at the RTN-008 base
(`main @ 28c6746`).

Exported symbol count: **65** (39 runtime symbols enumerated from
`obligations.ts` at load + 26 exported types). Table rows: **65**. The
counts match.

## Recorded interpretation decisions and deviations

1. **Module split is adaptive (the work-order allowance).** The
   obligations surface splits into types.ts (the frozen machine, the
   ledger entry shapes, the INV-10-4 gate), state-machine.ts (pure
   transitions + the derived identity + the terms hash), ledger.ts (the
   append-only, totally sequenced log), evidence.ts (the named A10
   evidence set), authority.ts (the closed INV-10-4 command surface),
   freeze.ts + serializer.ts (the per-domain value/ordering discipline
   helpers), persistence.ts + migrations/ (the per-domain durable
   store), and the public barrel — the RTN-005/006/007 module pattern.
2. **The obligation machine is condition-driven, not position-driven.**
   The written chain "CREATED -> NETTED -> SETTLEMENT_PENDING ->
   terminal(SETTLED | DISPUTED | WRITTEN_OFF | CANCELLED)" (lines 92-93)
   is the happy-path order; the transitions follow their written
   conditions: NETTED only from CREATED ("replaced by net positions in a
   committed netting set" — netting is optional, so CREATED ->
   SETTLEMENT_PENDING is legal for an un-netted obligation);
   SETTLEMENT_PENDING from CREATED or NETTED ("a settlement instruction
   (area 12) exists"); SETTLED only from SETTLEMENT_PENDING (finality
   presupposes the instruction: "SETTLED: settlement finality recorded
   (area 12)"); the three disposition terminals DISPUTED / WRITTEN_OFF /
   CANCELLED reachable from every NON-terminal state (their driving
   conditions are state-independent: "a dispute (area 21) is open",
   "terminal disposition via risk authority", "correction path with
   mandatory evidence"). All four terminals have empty successor sets —
   INV-10-2's "each obligation transitions at most once per state" is
   structural (one-way DAG).
3. **INV-10-4's machine-checked gate — the central interpretation.**
   "INV-10-4 (authority): only clearing commits, dispute outcomes, and
   risk write-offs create or terminalize obligations" (lines 119-123).
   Materialized as the frozen INV_10_4_AUTHORITY_GATE table over the
   CLOSED instruction-kind union: creation belongs to exactly
   CLEARING_COMMIT and DISPUTE_RESOLUTION; the disposition
   terminalizers are exactly DISPUTE_OPEN (-> DISPUTED),
   RISK_WRITE_OFF (-> WRITTEN_OFF), and CLEARING_CORRECTION_CANCEL (->
   CANCELLED — the correction path: INV-10-1's "corrections are new
   linked obligations" are created via the clearing path, and the prior
   obligation's CANCELLED transition is that same correction's
   terminalization; A14 lines 177-179 name the path "area 9/10"). The
   SETTLED advance is the area-12 finality instruction — A12 INV-12-4:
   "FINAL advances the obligation to SETTLED exactly once" (the success
   completion, not a disposition). **This is the one deliberate
   deviation from the literal three-path terminalizer list, recorded
   here**: the frozen A10 lifecycle REQUIRES a SETTLED terminalization
   (lines 92-99) and A12 assigns it to the Settlement Authority, so
   reading "terminalize" as covering SETTLED would put area 12 inside
   INV-10-4's list and contradict A12; reading it as covering only the
   disposition terminals keeps every sentence true. The machine check
   is preserved either way: the gate table is frozen, the write surface
   is the closed union (a fabricated kind is a TypeError at the runtime
   guard), every handler asserts its gate row, and the content-level
   audit (`inv10_4Audit`) re-checks the WRITTEN ledger against the
   table. NO other kind creates or terminalizes anything.
4. **INV-10-1 at three layers.** (a) The command surface: no transition
   command carries an amount — amount mutation is unrepresentable in
   the write types; terms are accepted exactly once, at creation. (b)
   The value layer: obligation records and ledger entries are
   deep-frozen at mint/append; the fold's records are frozen; snapshot
   arrays are frozen — mutation attempts throw in strict-mode ESM
   (machine-checkable). (c) The log layer: the ledger has NO update,
   delete, clear, or truncate member; the durable bridge is
   INSERT-only; the sequence is the gapless PRIMARY KEY. Corrections
   are new linked obligations (`linkedPriorObligationId`), never
   rewrites.
5. **INV-10-2's total order.** The ledger mints ONE gapless sequence
   (0, 1, 2, ...) shared by creation and transition entries; the write
   protocol peeks the next sequence (to mint the entry and its evidence
   record's protocol time), submits the A15 record, and only then
   appends — a failed evidence write leaves the sequence gapless and
   the log untouched ("A failed write fails the operation", A15 lines
   62-64). `appendEntry` asserts the gapless order; `sequenceInvariant`
   re-checks the written log (total order + no from-state repeats per
   obligation); every command runs under one global serializer key.
6. **INV-10-3.** The obligation id for clearing creations is DERIVED
   from the origin record id ("keyed by origin record id"); duplicate
   instructions are structural key matches — no-ops returning the
   recorded obligation, with no entry and no second evidence record.
   Dispute replacements derive their ids from (dispute id, replacement
   index) — the same determinism discipline, so duplicate resolution
   applications no-op the same way.
7. **The UNKNOWN-settlement hold (lines 125-131, GC-2).** The surface
   exposes NO transition driven by any UNKNOWN observation. The
   injectable `settlementHold` probe (the composition root wires the
   rails case-model query) makes applySettlementFinality REFUSE with
   the typed UNKNOWN_HELD rejection while the obligation's settlement
   attempt is an unresolved UNKNOWN — "the obligation remains in
   SETTLEMENT_PENDING unchanged until reconciliation resolves the rail
   operation"; after the resolution the probe clears and finality
   advances exactly once. The real composition (RTN-004
   RailsStore/ReconciliationAuthority/SimulatedRail) is proven in the
   node harness; the default probe never holds.
8. **Evidence emission points.** Creation writes OBLIGATION_CREATED
   ("origin reference, terms hash"); every transition EXCEPT the
   write-off writes OBLIGATION_STATE_CHANGED ("each transition, with
   cause reference"); the WRITTEN_OFF transition writes
   OBLIGATION_WRITTEN_OFF ("risk authority reference") — its own named
   record, which subsumes the generic one (otherwise one consequential
   operation would write two records and violate GC-5's exactly-one).
   Rejections, duplicate no-ops, and no-op re-observations emit no
   record (the named set is exhaustive — the RTN-005/006/007
   precedent).
9. **The clearing composition.** `applyClearingCommand` implements the
   clearing surface's ObligationLedgerSink contract structurally (both
   surfaces are the SAME work order — no unmerged-sibling violation).
   A correctionOf referencing a nonexistent prior obligation throws
   (the invalid-reference failure fails the caller's clearing commit);
   the CANCELLED terminalization is the separate
   `applyClearingCorrectionCancel` command the composition sequences
   after the replacement creation (INV-10-1's two-step correction: new
   linked obligation + prior cancelled with mandatory evidence).
10. **State layer.** In-process single writer (the RTN-002/RTN-005/RTN-007
    in-process-object-store precedent); the durable side is
    persistence.ts + migrations/ over the DEP-003 substrate read-only
    (the RTN-001 convention). The projection (fold/foldOne) is the
    deterministic fold of the entry log — "every downstream netting or
    settlement fact is a projection of it" (lines 80-87).
11. **Deferred (recorded, not invented):** the netting replacement
    CREATION path (A11: "replaced by net obligations in the ledger") is
    RTN-009's composition — this surface provides the NETTED transition
    (the area-11 instruction) and records the replacement ids, but adds
    no netting creation path (INV-10-4's creation list has no netting
    member; the boundary belongs to the Netting Authority work order).
    The area-21 dispute authority and the area-12 settlement authority
    (the instruction/finality issuers) are wave-2/RTN-010 compositions
    over this surface's commands.

## Exported symbol table (65 rows)

### types.ts (15 runtime + 12 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `OBLIGATION_STATES` | const | clearing-netting-settlement.md §2 lines 92-93: "States: CREATED -> NETTED -> SETTLEMENT_PENDING -> terminal(SETTLED \| DISPUTED \| WRITTEN_OFF \| CANCELLED)." |
| `ObligationState` | type | Same as above. |
| `OBLIGATION_TRANSITIONS` | const | Same as above; lines 95-103 (the transition semantics). |
| `isObligationState` | fn | Same as above (the vocabulary this guard re-checks). |
| `canTransitionObligation` | fn | Same as above. |
| `OBLIGATION_TERMINAL_STATES` | const | §2 lines 92-93: "terminal(SETTLED \| DISPUTED \| WRITTEN_OFF \| CANCELLED)". |
| `ObligationTerminalState` | type | Same as above. |
| `isObligationTerminalState` | fn | Same as above. |
| `OBLIGATION_INSTRUCTION_KINDS` | const | §2 lines 119-123 (INV-10-4): "only clearing commits, dispute outcomes, and risk write-offs create or terminalize obligations." + lines 92-103 (the driving conditions) + A12 INV-12-4 (the finality advance). |
| `ObligationInstructionKind` | type | Same as above. |
| `isObligationInstructionKind` | fn | Same as above (the closed-surface runtime guard). |
| `INV_10_4_AUTHORITY_GATE` | const | §2 lines 119-123 (INV-10-4 — the machine-checked gate table). |
| `inv10_4CreationKinds` | fn | Same as above (the creation paths enumeration). |
| `inv10_4TerminalKindFor` | fn | Same as above + lines 92-103 (the terminalizers mapped by target). |
| `ObligationTerms` | type | §2 lines 80-83: "who owes whom what, in which currency" + lines 113-116 (INV-10-1: immutable after creation). |
| `ObligationOrigin` | type | §2 lines 80-83: "from which clearing origin" + lines 98-100 (the dispute resolution origin). |
| `ObligationRecord` | type | §2 lines 91-103 ("Obligation — a single ledger debt entry") + lines 113-116 (the linked correction). |
| `ObligationCreatedEntry` | type | §2 lines 104-106: "append-only, totally sequenced log of obligation records and transitions" + lines 119-123 (the creation path field). |
| `ObligationTransitionedEntry` | type | §2 lines 104-106 + lines 117-118 (INV-10-2) + lines 95-103 (the replacement links). |
| `ObligationLedgerEntry` | type | §2 lines 104-106 (the two entry kinds). |
| `OBLIGATION_REASON_CODES` | const | §2 lines 125-131 (the hold) + lines 113-116 (the correction linkage). |
| `ObligationReasonCode` | type | Same as above. |
| `isObligationReasonCode` | fn | A15 line 30: "outcome: resulting state or decision, including reason codes." |
| `OBLIGATION_REJECTION_CODES` | const | §2 lines 92-103, 113-123, 125-131 (the machine gates the rejections ground) + the merged typed-rejection convention. |
| `ObligationRejectionCode` | type | Same as above. |
| `isObligationRejectionCode` | fn | Same as above. |
| `ObligationCommandResult` | type | The merged typed-result convention (RTN-005/006/007); §2 lines 113-123 (the INV gates). |

### state-machine.ts (6 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `OBLIGATION_DERIVATION_DOMAIN` | const | README.md §3 GC-1 lines 39-43 + the INV-10-3 key contract. |
| `obligationIdForOriginRecord` | fn | §2 lines 119-121 (INV-10-3): "obligation creation from clearing is keyed by origin record id; duplicate instructions are no-ops." |
| `obligationIdForDisputeReplacement` | fn | §2 lines 98-100: "resolution creates new obligations, never mutates this one" + GC-1 (the deterministic key). |
| `hashObligationTerms` | fn | §2 lines 133-134: "OBLIGATION_CREATED (origin reference, terms hash)" + GC-1. |
| `transitionObligation` | fn | §2 lines 92-103 (the machine's carrier); lines 117-118 (INV-10-2). |
| `obligationTime` | fn | A15 line 28: "when: protocol time (sequenced) and recorded wall time." |

### ledger.ts (1 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `ObligationLedger` | class | §2 lines 104-106: "ObligationLedger — append-only, totally sequenced log of obligation records and transitions." + lines 80-87 (the projection) + lines 113-118 (INV-10-1/INV-10-2). |

### evidence.ts (7 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `OBLIGATION_AUTHORITY_ID` | const | spec/registry/protocol-registry.json A10: "Obligation Authority" + §2 lines 108-110: "Obligation Ledger Authority (protocol layer, area 10) — the single financial authority for debt state (GC-4)." |
| `OBLIGATION_EVIDENCE_VOCABULARY` | const | §2 lines 133-137: "OBLIGATION_CREATED ... OBLIGATION_STATE_CHANGED ... OBLIGATION_WRITTEN_OFF". |
| `obligationCreatedEvidence` | fn | §2 lines 133-134: "OBLIGATION_CREATED (origin reference, terms hash)" + A15 lines 26-32 + GC-5. |
| `obligationStateChangedEvidence` | fn | §2 lines 134-135: "OBLIGATION_STATE_CHANGED (each transition, with cause reference)" + A15 lines 26-32 + GC-5. |
| `obligationWrittenOffEvidence` | fn | §2 lines 135-136: "OBLIGATION_WRITTEN_OFF (risk authority reference)" + A15 lines 26-32 + GC-5. |
| `transitionEvidence` | fn | Same as above (the dispatch: the write-off writes its own named record — GC-5's exactly-one). |
| `submitObligationEvidence` | fn | A15 lines 62-64: "an operation is not committed until its record is written. A failed write fails the operation." |

### authority.ts (1 runtime + 12 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `ObligationLedgerAuthority` | class | §2 lines 108-111: "Obligation Ledger Authority (protocol layer, area 10) — the single financial authority for debt state (GC-4). No product or deployment component writes or duplicates this ledger." + lines 113-123 (the INV gates). |
| `ClearingCreationInstruction` | type | §1 lines 42-45 ("the only creator of obligation creation instructions") + §2 lines 119-121 (INV-10-3). |
| `ClearingCorrectionCancelInstruction` | type | §2 lines 102-103: "CANCELLED: correction path with mandatory evidence" + lines 113-116 (INV-10-1) + rails-adapters-reconciliation.md lines 175-179. |
| `DisputeOpenInstruction` | type | §2 lines 98-99: "DISPUTED: a dispute (area 21) is open". |
| `DisputeResolutionInstruction` | type | §2 lines 99-100: "resolution creates new obligations, never mutates this one". |
| `RiskWriteOffInstruction` | type | §2 lines 100-101: "WRITTEN_OFF: terminal disposition via risk authority". |
| `NettingCommitInstruction` | type | §2 lines 95-97: "CREATED -> NETTED: replaced by net positions in a committed netting set (area 11)." |
| `SettlementInstructionApplied` | type | §2 lines 97-98: "SETTLEMENT_PENDING: a settlement instruction (area 12) exists." |
| `SettlementFinalityInstruction` | type | §2 lines 98-99: "SETTLED: settlement finality recorded (area 12)" + A12 INV-12-4: "FINAL advances the obligation to SETTLED exactly once." |
| `ObligationWriteInstruction` | type | §2 lines 119-123 (INV-10-4 — the closed write surface). |
| `SettlementHoldProbe` | type | §2 lines 125-131: "the obligation remains in SETTLEMENT_PENDING unchanged until reconciliation resolves the rail operation (GC-2)" + README.md §3 GC-2. |
| `ObligationLedgerAuthorityDeps` | type | The wave evidence discipline (README.md "Evidence discipline") + the per-domain conventions. |
| `ClearingCreationOutcome` | type | §2 lines 119-121 (INV-10-3: "duplicate instructions are no-ops"). |

### serializer.ts (1 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `KeyedSerializer` | class | INV-10-2 lines 117-118: "ledger transitions are serialized by sequence" (the single-lane serialization). |

### persistence.ts (8 runtime + 2 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `DEFAULT_OBLIGATIONS_DB_PATH` | const | The per-domain persistence convention (spec/protocol-runtime-work-orders/README.md) + DEP-003 §2 lines 40-43. |
| `OBLIGATIONS_MIGRATIONS_DIR_ENV_VAR` | const | DEP-003 §2 lines 44-47; the per-domain convention. |
| `OBLIGATIONS_MIGRATIONS_RELATIVE_DIR` | const | The per-domain convention (owned migrations inside the owned prefix). |
| `OBLIGATIONS_STORE_DOMAIN` | const | The per-domain convention (the domain's owner identity). |
| `resolveObligationsMigrationsDir` | fn | DEP-003 migration conventions (spec/durable/execution.md §2/§4). |
| `ObligationsStoreOptions` | type | The per-domain convention; the substrate's DurableDatabaseOptions shape. |
| `openObligationsStore` | fn | The per-domain convention; spec/durable/execution.md §3/§4. |
| `writeEntry` | fn | §2 lines 104-106, 113-118 (the append-only INSERT-only bridge; the gapless sequence). |
| `readEntries` | fn | Same as above + README.md §3 GC-1 (Money re-minted through the kernel guards on the read path). |
| `ObligationStoreWrite` | type | The write-bridge convention (the RTN-007 sibling template). |

Note: freeze.ts exports `deepFreeze` (internal, not exported from the
barrel — the value-layer immutability discipline; the barrel's public
surface is the 65 rows above).
