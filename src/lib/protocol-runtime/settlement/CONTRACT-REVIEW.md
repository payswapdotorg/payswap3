# RTN-009 — Settlement and Finality Authority contract review

Work order: `spec/protocol-runtime-work-orders/RTN-009.md`
Owned surface: `src/lib/protocol-runtime/settlement/` (area 12 — A12, the
apex of the singleFinancialAuthority chain)
Rule: **every exported type/function/constant maps to a cited
`spec/architecture/v0.1/` source; rows with no source are forbidden.**

Method: each row lists the primary `spec/architecture/v0.1/` source (file,
section, line, and the quoted line that grounds the export) and, where
needed, the supporting contracts outside v0.1 that additionally bind the
export (the kernel declarations, the A10/A11 contracts in
clearing-netting-settlement.md, the A13/A14 contracts in
rails-adapters-reconciliation.md, the registry projection, the RTN wave
conventions, the DEP-003 persistence substrate). Quoted text is verbatim
from the frozen v0.1 directory; line numbers refer to the files as merged
at the RTN-009 base (`main @ e67c48c`).

Exported symbol count: **72** (56 runtime symbols enumerated from
`settlement.ts` at load + 16 exported types). Table rows: **72**. The
counts match.

## Recorded interpretation decisions and deviations

1. **Module split is adaptive (the work-order allowance).** The
   settlement surface splits into types.ts (the three frozen machines,
   the settlement subject, the record shapes, the rejection codes),
   state-machine.ts (derived identity + the deterministic rail
   idempotency key + pure transitions), evidence.ts (the named A12
   evidence set), store.ts (the in-process single-writer state carrier),
   ports.ts (the composition ports + the binding helpers),
   authority.ts (the composed command surface), persistence.ts +
   migrations/ (the per-domain durable store), rails-test-double.ts (the
   owned in-surface A13/A14 test double), and the public barrel — the
   RTN-004/005/006/007/008 module pattern.
2. **The attempt machine mirrors the A13 RailOperation machine exactly.**
   The spec's own listing "terminal(CONFIRMED | FAILED | UNKNOWN)" (lines
   228-231) places UNKNOWN among the attempt's terminals, yet lines
   268-272 say "Only the reconciliation resolution may drive the attempt
   to CONFIRMED or FAILED and then advance finality" — UNKNOWN is
   terminal-for-everyone-but-reconciliation. The materialization carries
   the UNKNOWN -> {CONFIRMED, FAILED} edges in the frozen table (the A13
   mirror: rails RAIL_OPERATION_TRANSITIONS.UNKNOWN) executable by
   exactly ONE command: applyResolution (the recovery-directive
   consumer). No normal command passes them (submitAttempt /
   applyRailOutcome refuse an UNKNOWN attempt).
3. **The single-attempt rule (INV-12-2) is BY CONSTRUCTION.** The
   attempt id is keyed by the instruction id (INV-12-3: "attempt
   authorization is keyed by instruction id"), the store holds at most
   one attempt row per instruction (a UNIQUE key at the storage layer),
   and authorizeAttempt refuses with LIVE_ATTEMPT_EXISTS while a live
   attempt exists — with UNKNOWN explicitly live (its only exit is
   reconciliation, per GC-2). After the first attempt is terminally
   resolved, the instruction is terminal (CONFIRMED / FAILED), so the
   only continuation is the A14 recovery directive's NEW instruction with
   a NEW derived id and therefore a NEW idempotency key — "recovery is a
   new instruction with a new attempt, fully evidenced as a new external
   effect", never a re-submission of the same external effect. In this
   runtime no code path can authorize a second attempt for one
   instruction, ever.
4. **One live instruction per subject (the double-payment guard).** The
   spec constrains attempts per instruction (INV-12-2) but not live
   instructions per subject; permitting two live instructions for one
   obligation would move the value twice — contradicting INV-12-1's
   verbatim-amount discipline's purpose. Recorded interpretation:
   createSettlementInstruction refuses while a live (CREATED / ISSUED)
   instruction exists for the subject; a recovery instruction is
   possible only after the prior one is terminal (tested). The A10
   ledger's own applySettlementInstruction no-op corroborates the
   one-live-settlement-episode-per-obligation reading.
5. **The deterministic rail idempotency key (INV-12-3) uses the A13
   authority's exact derivation.** The merged RTN-004
   authorizeOperation derives the key as
   deriveIdempotencyKey('rail.submit', instructionId) inside the A13
   command. This surface's railIdempotencyKeyForInstruction returns the
   identical derivation, so the key the Settlement Authority derives and
   records (in the attempt and the SETTLEMENT_ATTEMPT_AUTHORIZED
   evidence) is the identical key the rail operation carries to the
   adapter at transmission — one key per instruction, flowing only to
   the A13 interface (INV-13-3: "each operation carries a deterministic
   rail idempotency key derived from the instruction id"). The belt-
   and-braces check in authorizeAttempt rejects any mismatch.
6. **PROVISIONAL and FINAL are two separate consequential declarations.**
   "PROVISIONAL is set from rail confirmation semantics (e.g., rail ack,
   blockchain confirmations before protocol depth); FINAL is declared by
   protocol rule only" (lines 237-240). A confirmed attempt (rail report
   or reconciliation resolution) creates/keeps the subject's
   FinalityRecord in PROVISIONAL (rule reference:
   RAIL_CONFIRMATION_SEMANTICS / RECONCILIATION_RESOLUTION_RESOLVED_
   CONFIRMED); declareFinality is the protocol rule's own command (the
   rule: PROVISIONAL record + CONFIRMED attempt + terminal instruction +
   no open case), advancing to FINAL and driving the subject to SETTLED.
   Both declarations write their own FINALITY_DECLARED record (GC-5's
   exactly-one each).
7. **INV-12-4 exclusivity and irreversibility, structurally.** The
   FinalityRecord store is written only by this authority's commands
   (the single-writer discipline — the registry's singleFinancialAuthority
   rule); one record per subject (the derived-id key; a UNIQUE constraint
   at the storage layer); the machine's only edge is PROVISIONAL ->
   FINAL; there is NO reversal command anywhere in the surface (no
   code path writes FINAL twice or reverses it — a second declaration is
   the typed FINALITY_ALREADY_DECLARED refusal, and the only re-drive
   completes a subject transition left behind by a prior declaration,
   writing no second record). "Reversal of a settled fact is only
   possible as a new obligation via dispute/recourse (area 21)" is
   honored by omission: the area-21 recourse path (wave 2) creates new
   obligations; nothing here touches a settled subject (SUBJECT_ALREADY_
   SETTLED).
8. **The UNKNOWN durable state (lines 264-273), verbatim.** submitAttempt
   mirrors the A13 submission outcome; on UNKNOWN the instruction stays
   ISSUED, the subject stays SETTLEMENT_PENDING (no subject-domain call),
   and the reconciliation case reference (opened automatically and
   atomically by the A13/A14 wiring — INV-14-1, exactly one per
   operation) is recorded on the attempt. declareFinality refuses with
   UNKNOWN_HELD while the attempt is UNKNOWN or a case remains
   non-terminal (GC-2), and the composition root wires the same hold
   into the A10 ledger's settlementHold probe (the RTN-008 surface).
9. **The safe-resume consumer.** applyResolution consumes RTN-004's
   RecoveryDirective (the resolution interface): AREA_12_FINALITY_ADVANCE
   (RESOLVED_CONFIRMED: the attempt UNKNOWN -> CONFIRMED, the
   instruction ISSUED -> CONFIRMED, finality advances to PROVISIONAL —
   "area 12 marks the attempt CONFIRMED and advances finality") and
   AREA_12_NEW_INSTRUCTION (RESOLVED_FAILED: the attempt UNKNOWN ->
   FAILED, the instruction ISSUED -> FAILED — "area 12 marks the attempt
   FAILED; a new instruction may be created, fully evidenced as a new
   external effect"). Guards: the attempt must be UNKNOWN; the
   originating rail operation must already carry the resolution's
   terminal outcome; the case must be terminally resolved. Duplicate
   applications are refused (the attempt is no longer UNKNOWN).
10. **The evidence emission points (the named set is exhaustive).**
    createSettlementInstruction writes SETTLEMENT_INSTRUCTION_CREATED;
    authorizeAttempt writes SETTLEMENT_ATTEMPT_AUTHORIZED; every attempt
    outcome landing (PENDING / CONFIRMED / FAILED / UNKNOWN from the
    submission, the report mirror, or the resolution) writes
    SETTLEMENT_ATTEMPT_RESOLVED; each finality declaration (PROVISIONAL,
    FINAL) writes FINALITY_DECLARED. The instruction's terminal flip and
    the subject-domain lifecycle transitions are consequences of the
    attempt-resolution operation (one record per consequential
    operation — GC-5); rejections, no-op mirrors, and read queries emit
    nothing.
11. **The rails composition port.** The A13/A14 access is the injected
    SettlementRailsPort (authorizeOperation / submitRailOperation /
    getOperation — the merged RTN-004 RailAdapterAuthority commands — plus
    caseForOperation — the ReconciliationAuthority's case query); the
    binding helper settlementPortFromAuthorities wires the real
    authorities. Rail execution requests flow ONLY to this port; the
    adapter connection is caller-supplied (simulated rails only — the
    module performs ZERO external transmission, machine-checked by the
    static source scan test). The bun suites bind the owned in-memory
    double (rails-test-double.ts — faithful to the frozen A13/A14
    semantics, over the REAL SimulatedRail adapter) because the real
    RailsStore requires node:sqlite; the node harness
    (scripts/test_protocol_netting_settlement.mjs) proves the REAL
    composition — the same split RTN-008 used. rails-test-double.ts is
    test tooling only: not exported from the public barrel, no spec
    citation (the kernel's bun-test.d.ts precedent; the RTN-004
    evidence-test-double.ts precedent).
12. **The subject-domain drives are lifecycle-only** ("Settlement never
    computes netting or mutates obligations beyond lifecycle
    transitions", lines 281-283): the obligations port carries
    applySettlementInstruction / applySettlementFinality and the netting
    port carries the net-position mirrors — nothing else.
13. **The A05 dependency note.** The work order's dependency line
    (RTN-008, RTN-006, RTN-004 — "A12 dependsOn A05, A10, A11, A13")
    reflects the registry's coarse crossReference graph; the binding A12
    per-area contract says "Depends on areas 10, 11, 13, 14, 15" (lines
    288-289) and the A12 section text references nothing from area 5 —
    no reservations surface is composed here. RTN-006 is consumed only as
    merged-base context (its module conventions). Recorded as an
    interpretation, not a deviation.

## Exported symbol table (72 rows)

### types.ts (17 runtime + 9 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `SettlementSubject` | type | §4 lines 224-225: "protocol authorization to move value externally for one obligation or net position." |
| `settlementSubjectKey` | fn | Same as above + the kernel identity discipline (the derivation input). |
| `SETTLEMENT_INSTRUCTION_STATES` | const | §4 lines 225-226: "States: CREATED -> ISSUED -> terminal(CONFIRMED \| FAILED)." |
| `SettlementInstructionState` | type | Same as above. |
| `SETTLEMENT_INSTRUCTION_TERMINAL_STATES` | const | §4 line 226: "terminal(CONFIRMED \| FAILED)". |
| `SETTLEMENT_INSTRUCTION_TRANSITIONS` | const | §4 lines 225-227 + lines 264-266 ("recovery is a new instruction with a new attempt" — the terminals have empty successor sets). |
| `isSettlementInstructionState` | fn | §4 lines 225-227 (the vocabulary this guard re-checks). |
| `canTransitionSettlementInstruction` | fn | Same as above. |
| `SettlementInstructionRecord` | type | §4 lines 224-227 (the instruction) + lines 247-249 (INV-12-1: "instruction amounts are integer Money copied verbatim from the obligation; the rail operation payload hash is recorded and compared on result"). |
| `SETTLEMENT_ATTEMPT_STATES` | const | §4 lines 228-231: "States: CREATED -> SUBMITTED -> PENDING \| terminal(CONFIRMED \| FAILED \| UNKNOWN)." |
| `SettlementAttemptState` | type | Same as above. |
| `SETTLEMENT_ATTEMPT_TRANSITIONS` | const | §4 lines 228-233 + lines 264-273 (the A13 mirror; the UNKNOWN -> {CONFIRMED, FAILED} edges executable only by the reconciliation resolution) + rails-adapters-reconciliation.md lines 33-46. |
| `isSettlementAttemptState` | fn | §4 lines 228-231. |
| `canTransitionSettlementAttempt` | fn | §4 lines 228-233, 264-273. |
| `isLiveSettlementAttempt` | fn | §4 lines 253-256 (INV-12-2: "at most one live attempt per instruction") + lines 264-273 (UNKNOWN's durable semantics). |
| `SettlementAttemptRecord` | type | §4 lines 228-233 + lines 253-258 (INV-12-2/INV-12-3 — the per-instruction key, the deterministic rail idempotency key, the case reference). |
| `FINALITY_STATES` | const | §4 lines 236-237: "States: PROVISIONAL -> FINAL." |
| `FinalityState` | type | Same as above. |
| `FINALITY_TRANSITIONS` | const | §4 lines 236-240 + lines 259-262 (INV-12-4 — FINAL has an empty successor set; there is no reversal edge). |
| `isFinalityState` | fn | §4 lines 236-237. |
| `canTransitionFinality` | fn | §4 lines 236-240. |
| `FinalityRecord` | type | §4 lines 235-240 (the record, the rule references) + lines 278-279 ("FINALITY_DECLARED (PROVISIONAL or FINAL, rule reference, proof)"). |
| `SETTLEMENT_REJECTION_CODES` | const | §4 lines 220-289 (the gates the rejections ground) + the merged typed-rejection convention (RTN-005/006/007/008). |
| `SettlementRejectionCode` | type | Same as above. |
| `isSettlementRejectionCode` | fn | Same as above. |
| `SettlementCommandResult` | type | The merged typed-result convention (RTN-005/006/007/008); §4 lines 247-262 (the INV gates). |

### state-machine.ts (12 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `SETTLEMENT_DERIVATION_DOMAIN` | const | GC-1 (README.md §3 lines 39-43) + INV-12-3 (§4 lines 256-258). |
| `settlementInstructionIdFor` | fn | §4 lines 225-227, 264-266 (recovery is a NEW instruction — the (subject, ordinal) derivation) + GC-2. |
| `settlementAttemptIdFor` | fn | §4 lines 256-258 (INV-12-3): "attempt authorization is keyed by instruction id." |
| `finalityRecordIdFor` | fn | §4 lines 259-262 (INV-12-4): "FINAL is exactly-once per obligation" (the per-subject derived key). |
| `railIdempotencyKeyForInstruction` | fn | §4 lines 256-258 (INV-12-3: "rail idempotency keys are derived deterministically and passed to the adapter") + rails-adapters-reconciliation.md lines 66-69 (INV-13-3: "each operation carries a deterministic rail idempotency key derived from the instruction id"). |
| `railOperationIdForInstruction` | fn | rails-adapters-reconciliation.md lines 36-40 ("AUTHORIZED: created by Settlement Authority (area 12) with a linked settlement instruction; this link is the explicit authorization required by GC-3"). |
| `settlementRailPayload` | fn | §4 lines 224-227, 247-249 (INV-12-1) + rails-adapters-reconciliation.md lines 36-40, 63-65 (INV-13-2: "operation payloads carry integer Money verbatim from the authorization"). |
| `settlementPayloadHash` | fn | §4 lines 247-249 (INV-12-1: "the rail operation payload hash is recorded and compared on result") + rails-adapters-reconciliation.md lines 63-65 (INV-13-2). |
| `transitionSettlementInstruction` | fn | §4 lines 225-227 (the machine's pure carrier). |
| `transitionSettlementAttempt` | fn | §4 lines 228-233, 264-273 (the machine's pure carrier). |
| `transitionFinality` | fn | §4 lines 236-240, 259-262 (the one-way machine's pure carrier). |
| `settlementTime` | fn | A15 line 28 (evidence-risk-compliance.md): "when: protocol time (sequenced) and recorded wall time." |

### evidence.ts (7 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `SETTLEMENT_AUTHORITY_ID` | const | spec/registry/protocol-registry.json A12: "Settlement and Finality Authority" + singleFinancialAuthority.apex + §4 lines 242-245. |
| `SETTLEMENT_EVIDENCE_VOCABULARY` | const | §4 lines 275-279 (the complete named set — verbatim). |
| `settlementInstructionCreatedEvidence` | fn | §4 line 276: "SETTLEMENT_INSTRUCTION_CREATED (obligation id, amount hash)." + A15 lines 26-32 + GC-5. |
| `settlementAttemptAuthorizedEvidence` | fn | §4 line 277: "SETTLEMENT_ATTEMPT_AUTHORIZED (attempt id, rail op id)." + A15 lines 26-32 + GC-5. |
| `settlementAttemptResolvedEvidence` | fn | §4 line 278: "SETTLEMENT_ATTEMPT_RESOLVED (outcome, resolution reference)." + A15 lines 26-32 + GC-5. |
| `finalityDeclaredEvidence` | fn | §4 lines 278-279: "FINALITY_DECLARED (PROVISIONAL or FINAL, rule reference, proof)." + A15 lines 26-32 + GC-5. |
| `submitSettlementEvidence` | fn | A15 lines 62-64: "an operation is not committed until its record is written. A failed write fails the operation." |

### store.ts (1 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `SettlementStore` | class | §4 lines 220-262 (the carried record shapes and machines) + lines 242-245 ("Settlement Authority ... owns instruction, attempt, and finality state") + the singleFinancialAuthority single-writer discipline (spec/registry/protocol-registry.json). |

### ports.ts (3 runtime + 3 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `SettlementRailsPort` | type | §4 lines 281-289 ("Settlement does not implement rail protocols; area 13 does" / "Depends on areas 10, 11, 13, 14, 15") + rails-adapters-reconciliation.md lines 36-40, 50-54, 150-152 (INV-14-1). |
| `settlementPortFromAuthorities` | fn | spec/registry/protocol-registry.json singleFinancialAuthority: "Only the Settlement and Finality Authority originates instructions for external value movement; only the Rail Authority executes them through adapters." |
| `SettlementObligationLedgerPort` | type | §4 lines 97-99 (§2 Area 10: "a settlement instruction (area 12) exists" / "SETTLED: settlement finality recorded (area 12)") + §4 lines 281-283 ("Settlement never computes netting or mutates obligations beyond lifecycle transitions"). |
| `obligationLedgerPortFromAuthority` | fn | §4 lines 97-99, 281-289 (the A10 binding helper). |
| `SettlementNettingPort` | type | §4 lines 224-225 ("for one obligation or net position") + lines 236-240 (INV-12-4 — the net position's finality advance) + lines 281-289. |
| `nettingPortFromAuthority` | fn | §4 lines 224-225, 236-240 (the A11 binding helper). |

### authority.ts (1 runtime + 2 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `SettlementAuthority` | class | §4 lines 242-245: "Settlement Authority (protocol layer, area 12) owns instruction, attempt, and finality state. Rail adapters report outcomes; they never declare protocol finality." + lines 247-262 (the four invariants). |
| `SettlementAuthorityDeps` | type | The wave evidence discipline (spec/protocol-runtime-work-orders/README.md "Evidence discipline") + the per-domain conventions. |
| `AttemptOutcomeMirror` | type | §4 lines 228-233, 264-273 (the attempt outcome landing — the shared consequence engine's result). |

### persistence.ts (15 runtime + 2 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `DEFAULT_SETTLEMENT_DB_PATH` | const | The per-domain persistence convention (spec/protocol-runtime-work-orders/README.md) + DEP-003 §2 lines 40-43. |
| `SETTLEMENT_MIGRATIONS_DIR_ENV_VAR` | const | DEP-003 §2 lines 44-47; the per-domain convention. |
| `SETTLEMENT_MIGRATIONS_RELATIVE_DIR` | const | The per-domain convention (owned migrations inside the owned prefix). |
| `SETTLEMENT_STORE_DOMAIN` | const | The per-domain convention (the domain's owner identity). |
| `resolveSettlementMigrationsDir` | fn | DEP-003 migration conventions (spec/durable/execution.md §2/§4). |
| `SettlementStoreOptions` | type | The per-domain convention; the substrate's DurableDatabaseOptions shape. |
| `openSettlementStore` | fn | The per-domain convention; spec/durable/execution.md §3/§4. |
| `writeInstruction` | fn | §4 lines 224-227, 247-249 (INV-12-1 — the verbatim amount columns + the recorded payload hash). |
| `updateInstructionState` | fn | §4 lines 225-227, 264-266 (the machine's persistence; the terminals have no outgoing edges). |
| `writeAttempt` | fn | §4 lines 228-233, 253-258 (the per-instruction UNIQUE row — INV-12-2/INV-12-3 at the storage layer). |
| `updateAttemptState` | fn | §4 lines 228-233, 264-273 (the machine's persistence, including the resolution edges). |
| `writeFinality` | fn | §4 lines 235-240, 259-262 (the per-subject UNIQUE row — INV-12-4's exactly-once at the storage layer). |
| `updateFinalityState` | fn | §4 lines 236-240, 259-262 (the one-way PROVISIONAL -> FINAL persistence; no reversal UPDATE anywhere in this module). |
| `readInstructions` | fn | §4 lines 224-227 + GC-1 (Money re-minted through the kernel guards on the read path). |
| `readAttempts` | fn | §4 lines 228-233, 253-258 + GC-1. |
| `readFinalities` | fn | §4 lines 235-240, 259-262 + GC-1. |
| `SettlementStoreWrite` | type | The write-bridge convention (the RTN-007/RTN-008 sibling template). |

Note: rails-test-double.ts is TEST TOOLING ONLY — not exported from the
public barrel, carrying no spec citation rows (the kernel's bun-test.d.ts
precedent; the RTN-004 evidence-test-double.ts precedent). Its semantics
mirror the cited A13/A14 contracts for the bun suites; the real
authorities are proven in the node harness.
