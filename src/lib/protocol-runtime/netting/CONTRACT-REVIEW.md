# RTN-009 — Netting Authority contract review

Work order: `spec/protocol-runtime-work-orders/RTN-009.md`
Owned surface: `src/lib/protocol-runtime/netting/` (area 11 — A11)
Rule: **every exported type/function/constant maps to a cited
`spec/architecture/v0.1/` source; rows with no source are forbidden.**

Method: each row lists the primary `spec/architecture/v0.1/` source (file,
section, line, and the quoted line that grounds the export) and, where
needed, the supporting contracts outside v0.1 that additionally bind the
export (the kernel declarations, the A10 contracts in
clearing-netting-settlement.md §2, the A12/A13/A14 contracts, the registry
projection, the RTN wave conventions, the DEP-003 persistence substrate).
Quoted text is verbatim from the frozen v0.1 directory; line numbers refer
to the files as merged at the RTN-009 base (`main @ e67c48c`).

Exported symbol count: **66** (48 runtime symbols enumerated from
`netting.ts` at load + 18 exported types). Table rows: **66**. The counts
match.

## Recorded interpretation decisions and deviations

1. **Module split is adaptive (the work-order allowance).** The netting
   surface splits into types.ts (the frozen machines, record shapes,
   rejection codes), algorithm.ts (the pure INV-11-3 computation + the
   INV-11-1 conservation check + the multilateral materialization),
   state-machine.ts (derived identity + pure transitions),
   evidence.ts (the named A11 evidence set), store.ts + freeze.ts (the
   in-process single-writer state carrier + the value discipline),
   authority.ts (the composed command surface), persistence.ts +
   migrations/ (the per-domain durable store), and the public barrel —
   the RTN-005/006/007/008 module pattern.
2. **The net obligations are materialized in the NETTING domain (the
   central interpretation).** A11 line 161-163 says the input
   obligations are "moved to NETTED and replaced by net obligations in
   the ledger", but INV-10-4's frozen creation list ("only clearing
   commits, dispute outcomes, and risk write-offs create or terminalize
   obligations", §2 lines 119-123) has NO netting member, and the merged
   A10 write surface (RTN-008) materialized that closed gate with no
   netting creation kind — its CONTRACT-REVIEW decision #11 explicitly
   deferred the net-obligation creation boundary to RTN-009. A12 line
   224-225 makes a settlement instruction "for one obligation or net
   position" (net positions are first-class settlement subjects,
   distinct from A10 obligations), and GC-4 lists "net positions" as
   protocol-owned financial truth alongside "obligations". The
   composition this surface materializes: the NetObligation record (the
   NetPosition's bilateral obligation form) lives in the netting
   domain with a deterministic derived id; the A10 NETTED transition
   entry carries the net obligations as its replacementObligationIds, so
   the replacement is recorded in the ledger (the transition entry is
   the ledger's record of the replacement). No A10 creation path is
   touched (the INV-10-4 gate holds; tested).
3. **The NetObligation lifecycle is the A10 obligation machine's
   settlement-facing subset.** CREATED -> SETTLEMENT_PENDING -> SETTLED,
   using the A10 state vocabulary verbatim (§2 lines 92-99: "a
   settlement instruction (area 12) exists", "SETTLED: settlement
   finality recorded (area 12)"). A net obligation never passes through
   NETTED — it IS the product of netting (§2 lines 95-97 reserves
   CREATED -> NETTED for gross obligations "replaced by net positions
   in a committed netting set"). "Netting never settles" (A11 lines
   205-206) holds: the netting domain declares no finality, calls no
   rails, and owns no instruction/attempt/finality state; the lifecycle
   transitions are driven ONLY by Settlement Authority instructions
   through the injected port — the exact mirror of how A11 itself
   instructs A10's NETTED transitions ("obligation transitions remain
   owned by area 10, executed only on Netting Authority instruction",
   lines 172-175).
4. **INV-11-1's conservation, materialized in the strongest non-trivial
   form.** The literal aggregate reading of "the integer sum of net
   positions equals the integer sum of gross obligations" is vacuous
   (both sides are 0 for a closed participant set). The recorded proof
   carries BOTH: the literal aggregate integer-sum equality (grossSumMinor
   == netSumMinor, both 0 over the closed set) AND the per-participant
   equalities (net(P,c) == grossSigned(P,c), each recomputed
   INDEPENDENTLY from the input obligations — the content that catches
   any netting bug that creates, destroys, or misattributes value). The
   check is computed and recorded in the set's proof at COMPUTED, before
   commit, and re-verified at COMMIT ("the check is recorded in the set's
   proof before commit").
5. **The participant-set closure is a validation gate.** Every input
   obligation's debtor and creditor must be within the scope's
   participant set (bilateral: exactly the two; multilateral: three or
   more). This is what makes Σ net == 0 per currency (the conservation
   aggregate) and the greedy multilateral materialization exhaustive.
6. **No ABORTED state; failed validations leave the set where it is.**
   The frozen machine is exactly OPEN -> COMPUTED -> COMMITTED (lines
   158-160). Validation failures ("failures are validation failures that
   abort the set before commit with no ledger effect", lines 191-193)
   are typed command rejections: the set stays in its current state
   (OPEN for compute-time failures), holding its membership claims. An
   obligation that becomes DISPUTED after OPEN is terminally un-nettable
   (DISPUTED has no outgoing edges in the A10 machine), so a dead OPEN
   set holding claims on it violates nothing (INV-11-2 still holds; the
   obligation can never enter another set anyway).
7. **The commit ordering (cross-domain atomicity interpretation).**
   Validate ALL (recorded proof verifies; every input still CREATED;
   claims still held) → drive the A10 NETTED transitions for every input
   (each individually atomic and evidenced inside the A10 authority) →
   materialize the net obligations → write NETTING_COMMITTED → flip to
   COMMITTED and release the claims. The pre-validation closes every
   deterministic failure mode; the residual tear window (a concurrent
   cross-domain writer racing the pre-validated apply loop) requires a
   writer mutating the A10 ledger between this authority's own commands
   — a composition-root discipline point (the composed runtime's
   single-wire sequencing), recorded as a known limitation, not a
   spec contradiction.
8. **Evidence emission points.** openNettingSet writes
   NETTING_SET_OPENED; computeNettingSet writes NETTING_COMPUTED;
   commitNettingSet writes NETTING_COMMITTED (the re-commit no-op
   writes nothing). The netting domain's area-12-driven lifecycle
   transitions (applyNetPositionSettlementInstruction /
   applyNetPositionSettlementFinality) write NO netting record: the A11
   named evidence set is exactly the three records (lines 199-203), and
   the driving operation's A12 record
   (SETTLEMENT_INSTRUCTION_CREATED / FINALITY_DECLARED) evidences the
   composite operation (GC-5 exactly-one — the RTN-008 interpretation
   #8 precedent). Rejections and no-ops emit nothing.
9. **State layer.** In-process single writer (the RTN-002/005/007/008
   precedent); the durable side is persistence.ts + migrations/ over the
   DEP-003 substrate read-only (the RTN-001 convention). The bun suites
   exercise the in-process authorities against the REAL A15 log and the
   REAL A10 ledger; the durable bridges and the REAL rails composition
   run in the node harness
   (scripts/test_protocol_netting_settlement.mjs) because Bun does not
   implement node:sqlite.
10. **`deepFreeze` (freeze.ts)** is re-implemented in-surface rather
    than imported from the obligations domain (its freeze.ts is internal,
    not exported from its barrel) — the surface discipline: RTN-009 owns
    exactly netting/ and settlement/.

## Exported symbol table (66 rows)

### types.ts (12 runtime + 12 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `NETTING_SET_STATES` | const | clearing-netting-settlement.md §3 lines 158-160: "States: OPEN -> COMPUTED -> COMMITTED." |
| `NettingSetState` | type | Same as above. |
| `NETTING_SET_TRANSITIONS` | const | Same as above; lines 191-193 (the no-UNKNOWN, abort-before-commit semantics). |
| `isNettingSetState` | fn | Same as above (the vocabulary this guard re-checks). |
| `canTransitionNettingSet` | fn | Same as above. |
| `BILATERAL_PARTICIPANT_COUNT` | const | §3 lines 167-169: "NettingScope — bilateral (exactly two participants) or multilateral (three or more, defined participant set)." |
| `MULTILATERAL_MIN_PARTICIPANTS` | const | Same as above. |
| `NettingScope` | type | §3 lines 167-169 (verbatim). |
| `GrossObligationSnapshot` | type | §3 lines 161-162 ("OPEN: input obligation ids fixed.") + lines 180-183 (INV-11-1 — the gross obligations the sums run over) + §2 lines 113-116 (INV-10-1: the immutable amounts). |
| `NetPosition` | type | §3 lines 165-166: "NetPosition — per participant, per currency net amount (signed integer Money) after netting, with a breakdown hash proving conservation." |
| `CurrencyConservationRecord` | type | §3 lines 180-183 (INV-11-1 — the recorded per-currency check). |
| `ConservationProof` | type | §3 lines 180-183 (INV-11-1: "the check is recorded in the set's proof before commit") + lines 185-189 (INV-11-3: the algorithm version). |
| `NettingSetRecord` | type | §3 lines 157-163: "NettingSet — one netting computation over a closed set of obligations." |
| `NET_OBLIGATION_STATES` | const | §3 lines 161-163 ("replaced by net obligations in the ledger") + §2 lines 92-99 (the settlement-facing vocabulary: "a settlement instruction (area 12) exists" / "SETTLED: settlement finality recorded (area 12)"). |
| `NetObligationState` | type | Same as above. |
| `NET_OBLIGATION_TRANSITIONS` | const | Same as above + §4 Area 12 lines 259-262 (INV-12-4: "FINAL advances the obligation to SETTLED exactly once" — SETTLED is terminal). |
| `isNetObligationState` | fn | Same as above. |
| `canTransitionNetObligation` | fn | Same as above. |
| `NetObligationRecord` | type | §3 lines 161-166 (the net obligations + the NetPosition they materialize) + §2 lines 113-116 (INV-10-1 discipline: the amount is set once). |
| `NETTING_REJECTION_CODES` | const | §3 lines 177-209 (the gates the rejections ground: the INV contracts, the scope contract, the DISPUTED exclusion, the validation-failure semantics) + the merged typed-rejection convention (RTN-005/006/007/008). |
| `NettingRejectionCode` | type | Same as above. |
| `isNettingRejectionCode` | fn | Same as above. |
| `NettingCommandResult` | type | The merged typed-result convention (RTN-005/006/007/008); §3 lines 177-189 (the INV gates). |
| `ObligationView` | type | §2 Area 10 lines 80-87: "every downstream netting or settlement fact is a projection of it" (the ledger read view). |

### algorithm.ts (8 runtime + 1 type)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `NETTING_ALGORITHM_VERSION` | const | §3 lines 185-189 (INV-11-3: "a pure function of its fixed input ids and the netting algorithm version") + lines 201-202 ("NETTING_COMPUTED (algorithm version, ...)"). |
| `netPositionBreakdownHash` | fn | §3 lines 165-166 ("with a breakdown hash proving conservation") + GC-1 (README.md §3 lines 39-43). |
| `conservationProofHash` | fn | §3 lines 180-183 (INV-11-1 — the recorded proof's hash) + lines 201-202 + GC-1. |
| `scopeParticipants` | fn | §3 lines 167-169 (the defined participant set) + GC-1 (the sorted iteration order). |
| `computeNetPositions` | fn | §3 lines 147-153: "Netting is a deterministic computation over the obligation ledger." + lines 185-189 (INV-11-3). |
| `buildConservationProof` | fn | §3 lines 180-183 (INV-11-1, verbatim). |
| `materializeNetObligations` | fn | §3 lines 150-151 ("cyclic or optimization-based (multilateral) across many participants") + lines 161-166 (the net obligations). |
| `verifyConservationProof` | fn | §3 lines 180-183 (INV-11-1: "the check is recorded in the set's proof before commit" — the commit gate's re-verification). |
| `MaterializedNetFlow` | type | §3 lines 161-166 (the materialized bilateral net flow). |

### state-machine.ts (7 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `NETTING_DERIVATION_DOMAIN` | const | GC-1 (README.md §3 lines 39-43) + INV-11-3 (§3 lines 185-189). |
| `nettingSetIdForLabel` | fn | §3 lines 157-160 (one set per computation) + the kernel identity discipline (kernel/identity.ts: derived ids from domain identity). |
| `netObligationIdFor` | fn | §3 lines 161-163 ("replaced by net obligations in the ledger") + lines 185-189 (INV-11-3 determinism) + GC-1. |
| `mintNettingScope` | fn | §3 lines 167-169: "NettingScope — bilateral (exactly two participants) or multilateral (three or more, defined participant set)." |
| `transitionNettingSet` | fn | §3 lines 158-163 (the exact machine's pure carrier). |
| `transitionNetObligation` | fn | §2 lines 92-99 (the vocabulary) + §4 lines 259-262 (INV-12-4 — exactly once). |
| `nettingTime` | fn | A15 line 28 (evidence-risk-compliance.md): "when: protocol time (sequenced) and recorded wall time." |

### evidence.ts (6 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `NETTING_AUTHORITY_ID` | const | spec/registry/protocol-registry.json A11: "Netting Authority" + §3 lines 172-175 ("Netting Authority (protocol layer, area 11) owns netting computation and set state"). |
| `NETTING_EVIDENCE_VOCABULARY` | const | §3 lines 199-203 (the complete named set — verbatim). |
| `nettingSetOpenedEvidence` | fn | §3 line 200: "NETTING_SET_OPENED (input obligation ids)." + A15 lines 26-32 + GC-5. |
| `nettingComputedEvidence` | fn | §3 lines 201-202: "NETTING_COMPUTED (algorithm version, per-currency conservation proof)." + A15 lines 26-32 + GC-5. |
| `nettingCommittedEvidence` | fn | §3 lines 202-203: "NETTING_COMMITTED (net obligation ids created)." + A15 lines 26-32 + GC-5. |
| `submitNettingEvidence` | fn | A15 lines 62-64: "an operation is not committed until its record is written. A failed write fails the operation." |

### store.ts (1 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `NettingStore` | class | §3 lines 157-189 (the carried record shapes) + lines 182-184 (INV-11-2: the atomic all-or-nothing claim) + the singleFinancialAuthority single-writer discipline (spec/registry/protocol-registry.json). |

### freeze.ts (1 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `deepFreeze` | fn | §3 lines 177-189 (the INV contracts' value layer — the immutable-record discipline); the RTN-008 freeze.ts precedent (in-surface copy: the sibling's helper is not exported from its barrel). |

### authority.ts (1 runtime + 3 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `NettingAuthority` | class | §3 lines 172-175: "Netting Authority (protocol layer, area 11) owns netting computation and set state; obligation transitions remain owned by area 10, executed only on Netting Authority instruction." + lines 177-189 (the three invariants). |
| `NettingObligationLedgerPort` | type | §3 lines 172-175 (the A10 port: the projection read + the instructed NETTED transition) + §2 lines 80-87 (the projection). |
| `NettingAuthorityDeps` | type | The wave evidence discipline (spec/protocol-runtime-work-orders/README.md "Evidence discipline") + the per-domain conventions. |
| `NettingCommitOutcome` | type | §3 lines 161-163, 202-203 (the commit's produced artifacts: the net obligations + the netted inputs). |

### persistence.ts (12 runtime + 2 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `DEFAULT_NETTING_DB_PATH` | const | The per-domain persistence convention (spec/protocol-runtime-work-orders/README.md) + DEP-003 §2 lines 40-43. |
| `NETTING_MIGRATIONS_DIR_ENV_VAR` | const | DEP-003 §2 lines 44-47; the per-domain convention. |
| `NETTING_MIGRATIONS_RELATIVE_DIR` | const | The per-domain convention (owned migrations inside the owned prefix). |
| `NETTING_STORE_DOMAIN` | const | The per-domain convention (the domain's owner identity). |
| `resolveNettingMigrationsDir` | fn | DEP-003 migration conventions (spec/durable/execution.md §2/§4). |
| `NettingStoreOptions` | type | The per-domain convention; the substrate's DurableDatabaseOptions shape. |
| `openNettingStore` | fn | The per-domain convention; spec/durable/execution.md §3/§4. |
| `writeNettingSet` | fn | §3 lines 157-163 (the persisted record) + lines 180-189 (the carried proof material). |
| `updateNettingSet` | fn | §3 lines 158-163 (the OPEN -> COMPUTED -> COMMITTED persistence of the transitions). |
| `writeNetObligation` | fn | §3 lines 161-166 (the materialized net obligations) + GC-1 (the integer Money columns). |
| `updateNetObligationState` | fn | §2 lines 92-99 + §4 lines 259-262 (INV-12-4 — the exactly-once SETTLED terminal). |
| `readNettingSets` | fn | §3 lines 157-170 + GC-1 (Money re-minted through the kernel guards on the read path). |
| `readNetObligations` | fn | §3 lines 161-166 + GC-1. |
| `NettingStoreWrite` | type | The write-bridge convention (the RTN-007/RTN-008 sibling template). |

Note: the in-surface test tooling (none in this domain beyond the test
files themselves) and the `.test.ts` suites carry no spec citations (test
tooling only — the kernel's bun-test.d.ts precedent).
