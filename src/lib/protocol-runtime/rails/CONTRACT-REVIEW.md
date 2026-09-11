# RTN-004 — Rails contract review

Work order: `spec/protocol-runtime-work-orders/RTN-004.md`
Owned surface: `src/lib/protocol-runtime/rails/`
Rule: **every exported type/function/class/constant maps to a cited
`spec/architecture/v0.1/` source (or a binding non-v0.1 contract); rows
with no source are forbidden.**

Method: each row lists the primary source (file, section, line, and the
quoted line that grounds the export) and, where needed, the supporting
contracts that additionally bind it (the RTN wave conventions, the
deployment topology contract, the architect rulings — rtn-plan-rulings.md
Q1/delta 1 is BINDING on this surface). Quoted text is verbatim from the
frozen v0.1 directory; line numbers refer to the files as merged at the
RTN-004 base (`main @ fd996c3`).

Exported symbol count (from `index.ts`, the public barrel): **72**
(34 runtime values, 38 types). Table rows: **72**. The counts match.
Two additional in-surface exports are TEST TOOLING ONLY, not part of the
public surface (see the last table section).

## Recorded interpretation decisions and deviations

1. **SUBMITTED's successor set.** The frozen state list ("AUTHORIZED ->
   SUBMITTED -> PENDING | terminal(CONFIRMED | FAILED | UNKNOWN)", lines
   33-35) is read as SUBMITTED's successors = {PENDING} ∪ the terminals —
   corroborated by the failure semantics (lines 74-78): submission-time
   failures "map to FAILED ... before any external effect occurs" (from
   SUBMITTED, the handed-to-rail state), and post-submission
   indeterminacy maps to UNKNOWN. A definitive CONFIRMED report on a
   not-yet-acked operation is therefore legal from SUBMITTED (the crash
   window between handoff and ack belongs to the durable command path —
   RTN-011/RTN-012). No semantics were added: every edge in the table
   traces to the frozen state machine's named states.
2. **No adapter re-activation arrow.** The frozen chain "REGISTERED ->
   ACTIVE -> DEGRADED -> RETIRED" (lines 30-31) has exactly three arrows
   and no DEGRADED→ACTIVE edge. A recovered adapter is a NEW registration
   (new derived adapter id). Implementing a revive edge would be a silent
   semantic addition; this surface does not perform it.
3. **Terminal case resolution requires INVESTIGATING.** The case chain
   "OPEN -> INVESTIGATING -> terminal(...)" (lines 119-123) has no direct
   OPEN→terminal arrow, so resolution passes INVESTIGATING first — the
   same lifecycle "emergency manual resolutions" must follow (lines
   193-195: "follow the same case lifecycle and evidence requirements;
   there is no out-of-band path").
4. **MATCHED is the cycle-discrepancy terminal.** MATCHED's definition —
   "protocol expectation and external statement agree" (line 126) — is a
   matching outcome between protocol records and external statements; an
   UNKNOWN-operation case must instead STATE the operation's true outcome
   (RESOLVED_CONFIRMED / RESOLVED_FAILED / RESOLVED_ADJUSTED, "the
   UNKNOWN operation's true outcome is established", lines 127-129).
   Resolution-class applicability is enforced by case origin
   (RESOLUTION_NOT_APPLICABLE otherwise). Conversely,
   RESOLVED_CONFIRMED/RESOLVED_FAILED are rejected on cycle-origin cases
   (there is no UNKNOWN operation to resolve).
5. **Adjustments are created ONLY by case resolution.** The spec ties
   adjustment creation to RESOLVED_ADJUSTED ("a discrepancy is corrected
   by creating new ledger entries", lines 128-130; INV-14-3, lines
   155-157). No standalone createAdjustment command exists — an extra
   command would invent an out-of-band adjustment path the boundaries
   section forbids (lines 193-195).
6. **Deterministic case/adjustment/cycle ids.** Case ids derive from the
   origin (operation id for UNKNOWN-origin; cycle + discrepancy identity
   for cycle-origin); adjustment ids derive from (case id, ordinal); cycle
   ids derive from (window bounds, rule version). All via the kernel's
   deriveProtocolId — the kernel's derived-id discipline applied to this
   domain, making duplicate opens/resolutions no-ops ("duplicate requests
   return the recorded state", the idempotency contracts the kernel
   cites).
7. **One cycle per (window, rule version).** The cycle identity does not
   include source ids: the same window matched under the same rule
   version is ONE cycle (duplicate openCycle returns the recorded cycle).
   Source-set changes for the same window would be a re-scope, not an
   idempotent duplicate.
8. **CYCLE_CLOSED's "open case count" is cycle-scoped.** The record's
   counts (lines 186-187) report the cycle's own still-open cases ("the
   case stays open until a terminal resolution", INV-14-1) — the
   deterministic reading; a global count would make the record depend on
   unrelated cases.
9. **INV-14-1 atomicity via the auto-case port.** The Rail Adapter
   Authority invokes the Reconciliation Authority's
   openCaseForUnknownOperation INSIDE the submitting command's store
   transaction (the nested transaction joins the ambient one), so the
   case exists atomically with the UNKNOWN landing. The A14 state machine
   stays owned by the A14 authority; the A13 authority holds only the
   narrow UnknownCaseOpener port (types.ts).
10. **Evidence five-slot mapping decisions.** A15 fixes the record shape
    at exactly five slots, while the A13/A14 evidence lines name
    per-record content. Mapping decisions (all additive placements inside
    the existing slots, recorded here): RAIL_OP_AUTHORIZED carries the
    instruction link in subjectIds and {payloadHash, idempotencyKey} in
    proof.hashes; RAIL_OP_SUBMITTED carries the adapter id and rail
    references in subjectIds; RAIL_OP_REPORTED carries the outcome class
    (with reason code) and payload proof; CASE_RESOLVED carries the
    matched-statement/adjustment references in proof.priorRecordIds
    ("links to prior records" — the proof slot's own third class);
    CYCLE_CLOSED carries [windowStart, windowEnd, matchedCount,
    discrepancyCount, openCaseCount] in proof.sequenceNumbers (integer
    proof material; the slot taxonomy admits no sixth slot).
11. **No evidence records for INVESTIGATING or COLLECTED.** The A14
    evidence list is exactly CASE_OPENED, CASE_RESOLVED, CYCLE_CLOSED
    (lines 181-187), and neither investigation nor collection is a
    consequential operation under GC-5 (they create, mutate, or resolve
    no financial state and authorize no external effect). Adding records
    the spec does not name would be an invention.
12. **A resting SUBMITTED state is unreachable through the synchronous
    simulated rails.** submitRailOperation executes AUTHORIZED→SUBMITTED
    and then the outcome transition inside one atomic command; an
    operation that RESTS in SUBMITTED arises only when a submit is
    interrupted between handoff and outcome — the durable command path's
    crash window (RTN-011/RTN-012 territory). The recovery guard is
    nonetheless complete: recordReport accepts reports for SUBMITTED
    operations and the transition table covers all four SUBMITTED edges.
    Recorded as a known materialization boundary, not a semantic gap.
13. **Evidence submission is synchronous.** A15: "Evidence writing is
    internal and synchronous with the operation it records" — the
    authorities submit evidence inside the store transaction and reject a
    thenable return (the port's Promise form). The composed real-log
    integration is RTN-012's; this surface tests against the owned test
    double per the wave's evidence discipline.
14. **Reason-code labels are implementation conventions where the spec
    mandates the rejection but not the label.** The guards themselves are
    spec-mandated (illegal transitions rejected; DEGRADED accepts no new
    operations; duplicate resolutions rejected by case id; closure
    requires proof; sequence discipline on untrusted input). The exact
    label strings (ILLEGAL_TRANSITION, ADAPTER_NOT_ACTIVE,
    DUPLICATE_RESOLUTION, ...) are this surface's deterministic
    vocabulary, frozen in reason-codes.ts. The spec-NAMED causes
    (malformed payload, rail rejection at submission, timeout, connection
    loss, ambiguous rail response) carry spec-cited codes verbatim in
    meaning.
15. **Reports on terminal operations are recorded but change no state.**
    Terminal states have no outgoing edges (the state machine is exact);
    the report itself is still immutable evidence ("RailResultReport —
    immutable report", lines 47-48). A same-class report on a
    non-terminal operation (e.g. PENDING on PENDING) is likewise recorded
    without a transition.
16. **The simulated rail holds the EXTERNAL world's own ledger.**
    rtn-plan-rulings.md Q1 forbids the adapter interface from creating or
    mutating RailAdapter/RailOperation PROTOCOL state — the SimulatedRail
    holds the rail-side received-key ledger (what an external bank/PSP
    would remember), and the connection holds transmission bookkeeping
    (which key it transmitted with which hash). Neither is protocol
    state; "The external rail is an untrusted reporter: its data is
    evidence, not protocol truth" (lines 52-54).
17. **Test-suite split follows the repository's established convention.**
    The pure-logic suites run under `bun test` (state machines, adapter
    interface + no-egress, matching, payload, reason codes); everything
    touching node:sqlite runs under the plain-Node evidence harness
    `scripts/test_protocol_rails.mjs`, mirroring
    scripts/test_protocol_kernel.mjs (the RTN-001 convention; bun test in
    this environment cannot load node:sqlite — the substrate's own
    evidence suite is likewise a Node harness).
18. **`var/` was restored to .gitignore.** RTN-001's CONTRACT-REVIEW
    records adding `var/` ("Data is never committed", spec/durable/
    execution.md §2), but the entry is absent at this base (verified:
    `git show fd996c3:.gitignore`); RTN-004 restored it because
    var/rails.sqlite is a runtime artifact of this domain's store.
19. **Source kinds are free-form.** The three provider kinds the spec
    names parenthetically ("rail settlement report, statement file,
    on-chain observer", lines 139-141) are examples of providers, not a
    closed enumeration; registering other kinds adds no protocol
    semantics.
20. **The store's resolveOperationFromUnknown is the INV-14-2 write
    path.** It validates the UNKNOWN source state and throws on
    violation (integrity — the command guards already reject typed). It
    is reachable ONLY through the Reconciliation Authority's
    resolveCase; the Rail Adapter Authority exposes no command that
    transitions an operation out of UNKNOWN (GC-2 machine-checked).

## Contract review table

Legend — `A13` = `spec/architecture/v0.1/
rails-adapters-reconciliation.md` §1 Area 13; `A14` = same file §2 Area
14; `README` = `spec/architecture/v0.1/README.md`; `A12` =
`spec/architecture/v0.1/clearing-netting-settlement.md`; `RULINGS` =
`spec/development-state/rtn-plan-rulings.md`; `TOPO` =
`spec/deployment/topology.md`; `WAVE` = `spec/protocol-runtime-work-
orders/README.md`; `WO` = `spec/protocol-runtime-work-orders/RTN-004.md`;
`KERNEL` = `src/lib/protocol-runtime/kernel/` (merged at base — the
kernel barrel and its cited contracts).

### types.ts — the A13/A14 state machines and record shapes

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 1 | `RailAdapterStatus` | type | A13 lines 30-31: "States: REGISTERED -> ACTIVE -> DEGRADED -> RETIRED." | — | Frozen literal union |
| 2 | `RAIL_ADAPTER_TRANSITIONS` | const | A13 lines 30-31 (the three named arrows) | RULINGS Q1 (authority state) | Frozen table; decision 2 |
| 3 | `isRailAdapterStatus` | function | A13 lines 30-31 | — | Runtime guard |
| 4 | `RailOperationStatus` | type | A13 lines 33-35: "States: AUTHORIZED -> SUBMITTED -> PENDING \| terminal(CONFIRMED \| FAILED \| UNKNOWN)." | — | |
| 5 | `RAIL_OPERATION_TRANSITIONS` | const | A13 lines 33-46 (state machine + lines 45-46: UNKNOWN is durable, no re-submission) | A14 lines 152-154 (INV-14-2); README GC-2 lines 45-49 | UNKNOWN's only exits are the two resolution edges; decision 1 |
| 6 | `isRailOperationStatus` | function | A13 lines 33-35 | — | |
| 7 | `RailReportClass` | type | A13 lines 39-44 (PENDING/CONFIRMED/FAILED/UNKNOWN) + lines 70-72 (INV-13-4) | — | The four report classes |
| 8 | `isRailReportClass` | function | A13 lines 39-44 | — | |
| 9 | `RailOperationPayload` | interface | A13 lines 36-40 (instruction link = GC-3 authorization) + lines 63-65 (INV-13-2 money verbatim) | README GC-3 lines 51-55; A12 lines 224-233 | instructionId + Money + beneficiary (+ optional memo) |
| 10 | `RailAdapterRecord` | interface | A13 lines 29-32 ("RailAdapter — registered connector for one external rail family") + lines 50-54 (owning authority) | — | Registry row |
| 11 | `RailOperationRecord` | interface | A13 lines 33-48 (RailOperation fields) | RULINGS Q1/delta 1 | Protocol-owned authoritative state |
| 12 | `RailResultReportRecord` | interface | A13 lines 47-48: "RailResultReport — immutable report from the rail: outcome class, rail reference identifiers, timestamp, and payload proof (hash)." | INV-13-2 line 64 | Immutable, append-only; per-operation ordinal |
| 13 | `ReconciliationCaseStatus` | type | A14 lines 119-123: "States: OPEN -> INVESTIGATING -> terminal(MATCHED \| RESOLVED_CONFIRMED \| RESOLVED_FAILED \| RESOLVED_ADJUSTED)." | — | |
| 14 | `RECONCILIATION_CASE_TRANSITIONS` | const | A14 lines 119-123 + lines 152-154 (INV-14-2) | — | Terminals have no exits; decision 3 |
| 15 | `isReconciliationCaseStatus` | function | A14 lines 119-123 | — | |
| 16 | `ReconciliationCycleStatus` | type | A14 lines 133-137: "States: OPEN -> COLLECTED -> MATCHED -> CLOSED." | — | |
| 17 | `RECONCILIATION_CYCLE_TRANSITIONS` | const | A14 lines 133-137 | — | Exactly the four-state chain |
| 18 | `isReconciliationCycleStatus` | function | A14 lines 133-137 | — | |
| 19 | `ReconciliationCaseOrigin` | type | A14 lines 124-126 ("Every UNKNOWN rail operation automatically opens exactly one case") + line 137 ("Discrepancies become cases") | — | The two spec-named origins |
| 20 | `ResolutionProof` | interface | A14 lines 151-152 ("closure requires a terminal resolution with recorded proof") + lines 183-185 (CASE_RESOLVED proof) | — | Matched statement / adjustment ledger refs |
| 21 | `ReconciliationCaseRecord` | interface | A14 lines 119-126 (one resolution unit) | — | resolution/recovery iff terminal |
| 22 | `CaseTerminalResolution` | type | A14 lines 121-123 (the four terminals) | — | |
| 23 | `RecoveryDirective` | type | A14 lines 171-179 ("Recovery paths from each terminal resolution" — feeds areas 12/9/10) | WO objective ("recovery paths ... feeding area 12/9/10") | Type-level links; consumers are RTN-009/RTN-012 |
| 24 | `ReconciliationCycleRecord` | interface | A14 lines 133-137 (periodic matching run over a window) | INV-14-4 lines 156-159 | window bounds + rule version + counters |
| 25 | `ReconciliationSourceRecord` | interface | A14 lines 139-141: "ReconciliationSource — registered external statement provider ..., treated as untrusted input with sequence numbers." | — | lastSequence = the consumption watermark |
| 26 | `ExternalStatementRecord` | interface | A14 lines 139-141 + lines 133-137 (matched against protocol records) | README GC-1/GC-4 | Untrusted external claim; integer amount |
| 27 | `ReconciliationAdjustment` | interface | A14 lines 127-130 ("RESOLVED_ADJUSTED: a discrepancy is corrected by creating new ledger entries") + lines 155-157 (INV-14-3) | — | NEW linked entry; links by reference only |
| 28 | `UnknownCaseOpener` | interface | A14 lines 80-81 ("1. Opens a reconciliation case (area 14) automatically.") + INV-14-1 lines 150-152 | WO acceptance ("duplicate case-open attempts are no-ops") | The A13→A14 wiring port; decision 9 |
| 29 | `RailsCommandResult` | type | A13/A14 command guards (e.g. A14 lines 152-154 "duplicate resolutions are rejected") | — | Deterministic typed rejections, never thrown |

### reason-codes.ts — the area-owned vocabulary

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 30 | `RAILS_REASON_CODES` | const | A13 lines 74-78: "Adapter-local failures (malformed payload, rail rejection at submission) map to FAILED with reason codes" + lines 42-44 (UNKNOWN causes) | KERNEL reason-codes.ts lines 16-22 (area codes owned by the area) | Frozen; spec-named causes cited per code; decision 14 |
| 31 | `isRailsReasonCode` | function | A13 lines 74-78 | — | |

### payload.ts — INV-13-2 discipline

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 32 | `RAIL_PAYLOAD_ENCODING_VERSION` | const | A13 lines 63-65 (recorded + re-checked hash requires a stable, comparable encoding) | KERNEL identity.ts (versioned derivation format) | v1; inside the hashed input |
| 33 | `canonicalRailPayload` | function | A13 lines 63-65: "operation payloads carry integer Money verbatim from the authorization" | README GC-1 lines 39-43 | Versioned, length-prefixed, unambiguous |
| 34 | `hashRailPayload` | function | A13 lines 63-65 ("payload hash is recorded at submission and re-checked on every report") + lines 47-48 ("payload proof (hash)") | A12 lines 251-253 (INV-12-1) | sha256 over the canonical encoding |
| 35 | `validateRailOperationPayload` | function | A13 lines 63-65 (Money verbatim) + lines 36-40 (instruction link) | KERNEL money.ts (the single mint) | Mints Money; rejects malformed payloads |

### adapters.ts — transmission-and-reporting ONLY (delta 1)

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 36 | `SimulatedRailScenario` | type | A13 lines 42-44 (UNKNOWN causes) + lines 74-78 (failure classes) | TOPO line 207 simulation rule; WO acceptance ("scripted CONFIRMED/FAILED/PENDING/UNKNOWN") | Eight deterministic scenarios |
| 37 | `SimulatedRailAdapterOptions` | interface | TOPO line 207: "protocol-owned simulated rails — same interface, no external transmission, no real credentials, no signing capability." | — | wallClock injection for determinism |
| 38 | `RailTransmissionRequest` | interface | A13 lines 21-25: "Adapters translate protocol-authorized instructions into external actions" | RULINGS Q1/delta 1; README GC-3 | key + payload + hash; pure data |
| 39 | `RailTransmissionOutcome` | type | A13 lines 74-78 (ACCEPTED/REJECTED/UNKNOWN classes) | — | The adapter's complete submission vocabulary |
| 40 | `RailReportEnvelope` | interface | A13 lines 47-48 (RailResultReport shape) | — | Pure-data report form |
| 41 | `RailAdapterConnection` | interface | A13 lines 21-25 ("report external results back — including UNKNOWN") | RULINGS Q1/delta 1 (binding: transmission-and-reporting only) | Two methods; no authority/store reach |
| 42 | `submissionReportClass` | function | A13 lines 70-72 (INV-13-4: "adapters must map every submission to exactly one report class; they never infer CONFIRMED or FAILED from silence") | — | ACCEPTED→PENDING, REJECTED→FAILED, UNKNOWN→UNKNOWN |
| 43 | `SimulatedRail` | class | A13 lines 50-54 ("The external rail is an untrusted reporter: its data is evidence, not protocol truth") + lines 66-69 (INV-13-3 duplicate collapse) | TOPO line 207 | In-process deterministic double; holds the rail-side ledger (decision 16) |
| 44 | `createSimulatedRailAdapter` | function | A13 lines 74-76 (adapter-local failures "before any external effect occurs") + lines 70-72 (silence→UNKNOWN) | TOPO line 207 (non-production binding) | Validates, transmits, reports; creates NO protocol state |

### matching.ts — INV-14-4 deterministic matching

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 45 | `RAILS_MATCHING_RULE_VERSION` | const | A14 lines 156-159 ("pure functions of (protocol record set, external statement set, rule version)") | — | Version 1; others fail closed |
| 46 | `MatchedPair` | interface | A14 line 126: "MATCHED: protocol expectation and external statement agree." | — | |
| 47 | `MatchDiscrepancy` | interface | A14 line 137 ("Discrepancies become cases") + lines 168-170 (incomplete/delayed statements) | — | Five kinds (rule v1) |
| 48 | `MatchOutcome` | interface | A14 lines 126-137 | — | Canonicalized orders |
| 49 | `matchReconciliationRecords` | function | A14 lines 156-159 (INV-14-4) + line 126 (agreement = expectation equals statement) | README GC-1 (integer comparison) | Pure; canonical sort; pairing priority op-id > key > rail-ref |
| 50 | `stableStringify` | function | A14 lines 156-159 ("identical inputs produce identical case decisions") | README GC-1 lines 41-43 | Key-sorted canonical transcript form |

### persistence.ts — the per-domain persistence convention

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 51 | `DEFAULT_RAILS_DB_PATH` | const | README §9 lines 173-174: "This directory defines semantics only; it intentionally prescribes no implementation, storage, or service decomposition." | WAVE line 37 (convention); RULINGS Q1 | `var/rails.sqlite`; never committed |
| 52 | `RAILS_MIGRATIONS_DIR_ENV_VAR` | const | README §9 lines 173-174 | KERNEL persistence.ts (the reference pattern) | `PAYSWAP_RAILS_MIGRATIONS_DIR` |
| 53 | `RAILS_MIGRATIONS_RELATIVE_DIR` | const | README §9 lines 173-174 | WAVE line 37 ("migrations inside its owned prefix") | `src/lib/protocol-runtime/rails/migrations` |
| 54 | `RAILS_STORE_DOMAIN` | const | README §9 lines 173-174 | KERNEL KERNEL_STORE_DOMAIN (owner identity discipline) | `protocol-runtime-rails` |
| 55 | `resolveRailsMigrationsDir` | function | README §9 lines 173-174 | KERNEL persistence.ts (explicit → env → walk-up → fail-closed) | |
| 56 | `openRailsStore` | function | README §9 lines 173-174 | RULINGS Q1/delta 1; WAVE line 37 ("DEP-003 database layer read-only"); KERNEL openKernelStore | Opens via openDurableDatabase |
| 57 | `RailsStoreOptions` | interface | README §9 lines 173-174 | KERNEL KernelStoreOptions (option shape) | dbPath + migrationsDir |

### store.ts — the authority-state store

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 58 | `RailsStore` | class | A13 lines 50-54 ("owns adapter registry and operation lifecycle") + A14 lines 143-146 ("owns case and cycle state") | RULINGS Q1/delta 1; TOPO ("exactly one authoritative-state writer") | Record↔row mapping, sequence mint, command transactions; resolveOperationFromUnknown is the INV-14-2 write path (decision 20); CHECK constraints mirror the frozen tables; partial UNIQUE index is INV-14-1's storage backstop |

### authority.ts — the A13 command surface

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 59 | `RAIL_ADAPTER_AUTHORITY_ID` | const | A13 lines 50-51: "Rail Adapter Authority (protocol layer, area 13)" | — | The evidence 'authority' slot value |
| 60 | `RailAdapterAuthorityDeps` | interface | A13 lines 50-54 | RULINGS Q1 (the auto-case port); KERNEL ports.ts (EvidenceSubmission) | store + evidence + caseOpener + wallClock |
| 61 | `RailAdapterAuthority` | class | A13 lines 50-54 (owning authority) + lines 56-95 (the INV contracts and evidence it enforces) | RULINGS Q1/delta 1 ("state advances only through the authority's command surface") | Registry + operation lifecycle + report ingestion; the GC-2 machine check lives in submitRailOperation |
| 62 | `SubmitRailOperationOutcome` | interface | A13 lines 70-72 (the INV-13-4 mapping) + lines 89-95 (evidence) | — | operation + submissionReportClass + transmitOutcome |

### reconciliation.ts — the A14 command surface

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 63 | `RECONCILIATION_AUTHORITY_ID` | const | A14 lines 143-145: "Reconciliation Authority (protocol layer, area 14)" | — | The evidence 'authority' slot value |
| 64 | `ReconciliationAuthorityDeps` | interface | A14 lines 143-146 | KERNEL ports.ts | store + evidence + wallClock |
| 65 | `ReconciliationAuthority` | class | A14 lines 143-146 ("owns case and cycle state and is the only authority permitted to resolve an UNKNOWN rail operation") | README GC-2 lines 45-49; RULINGS Q1 | Cases, sources, cycles, adjustments; the ONLY UNKNOWN exit |
| 66 | `CaseResolutionInput` | type | A14 lines 119-130 (terminal classes + ADJUSTED's new entries) + lines 151-157 (proof required) | — | Origin-applicable resolutions enforced (decision 4) |
| 67 | `ResolveCaseOutcome` | interface | A14 lines 171-179 (recovery paths) + lines 183-185 (CASE_RESOLVED) | — | case + operation? + adjustment? + recovery? |
| 68 | `CycleMatchingOutcome` | interface | A14 lines 133-137 + lines 156-159 (INV-14-4) | — | cycle + match + openedCases |

### runtime.ts — the composition root

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 69 | `RailsRuntimeDeps` | interface | A14 lines 80-81 ("Opens a reconciliation case (area 14) automatically") | WAVE line 39 (evidence discipline) | evidence + wallClock |
| 70 | `RailsAuthorities` | interface | A13 lines 50-54 + A14 lines 143-146 (the two authorities, one domain) | TOPO (single-writer discipline) | store + both authorities |
| 71 | `createRailsAuthorities` | function | A14 lines 80-81 + INV-14-1 lines 150-152 | RULINGS Q1/delta 1 | Wires the auto-case port; decision 9 |
| 72 | `openRailsAuthorities` | function | README §9 lines 173-174 | RULINGS Q1; WAVE line 37 | Opens the store then wires |

### In-surface test tooling (NOT part of the public barrel)

Following the kernel's `bun-test.d.ts` precedent ("Not a protocol type:
no spec citation applies (test tooling only)"):

| Export | Kind | Source | Notes |
|--------|------|--------|-------|
| `createEvidenceTestDouble` | function | WAVE line 39 ("the item tests against an owned in-surface test double of the port") | The owned EvidenceSubmission double; not exported from index.ts |
| `EvidenceTestDouble` | interface | WAVE line 39 | Adds records/byOperationType/clear/failNext (test control) |

## Supporting sources used (outside spec/architecture/v0.1/)

- `spec/development-state/rtn-plan-rulings.md` — Q1/delta 1 (BINDING:
  the rails surface implements the A13/A14 state machines as authority
  state under the RTN-001 per-domain persistence convention; the adapter
  interface is strictly transmission-and-reporting; state advances only
  through the authority's command surface; RTN-011's boundary review must
  include the rails surface; RTN-012's composed journey must show a
  rail-operation transition through the single-writer path).
- `spec/protocol-runtime-work-orders/README.md` — the persistence
  convention, the evidence discipline (owned test double; real-log
  integration in RTN-012), the shared forbidden surfaces.
- `spec/protocol-runtime-work-orders/RTN-004.md` — the objective,
  acceptance bullets (incl. the delta-1 acceptance bullet), required
  evidence, stop conditions.
- `spec/deployment/topology.md` — the simulation rule (line 207: "same
  interface, no external transmission, no real credentials, no signing
  capability") and the single-writer execution topology.
- `spec/durable/execution.md` — the DEP-003 database layer consumed
  read-only (openDurableDatabase; migration runner; var/ ignore rule).
- `src/lib/protocol-runtime/kernel/` — the merged kernel (money, protocol
  time, identity derivation, the EvidenceSubmission port declaration, the
  persistence reference pattern, the bun-test ambient declaration).
- `deploy/migrations/0001_durable_execution.sql` — the integer
  epoch-milliseconds convention (line 10) inherited by the rails
  migration.

## Forbidden-source compliance

No file under `spec/architecture/v0.1/`,
`spec/architecture-change-requests/`, `spec/product/`,
`src/lib/protocol/`, `src/lib/durable/`, `src/components/`, or
`src/app/` was modified. `src/lib/durable/` is consumed read-only
(`openDurableDatabase` imported from `src/lib/durable/db.ts`). The
kernel is consumed as merged surface code (it is ON MAIN at this base,
per the work order's shared context). Root-config change outside any
forbidden surface: `.gitignore` gained the `var/` entry (decision 18).
No external network transmission exists anywhere in this item (static +
behavioral no-egress proofs in adapters.test.ts); no rail credentials
exist in source.
