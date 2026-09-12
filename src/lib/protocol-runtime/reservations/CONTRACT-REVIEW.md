# RTN-006 — Reservation Authority contract review

Work order: `spec/protocol-runtime-work-orders/RTN-006.md`
Owned surface: `src/lib/protocol-runtime/reservations/` (area 5 — A05)
Rule: **every exported type/function/constant maps to a cited
`spec/architecture/v0.1/` source; rows with no source are forbidden.**

Method: each row lists the primary `spec/architecture/v0.1/` source (file,
section, line, and the quoted line that grounds the export) and, where
needed, the supporting contracts outside v0.1 that additionally bind the
export (the kernel declarations, the A15 contracts in
evidence-risk-compliance.md, the A04 contracts that compose with this
area, the RTN wave conventions, the registry projection). Quoted text is
verbatim from the frozen v0.1 directory; line numbers refer to the files
as merged at the RTN-006 base (`main @ 92adb6a`).

Exported symbol count: **63** (48 runtime symbols enumerated from
`reservations.ts` at load + 15 exported types). Table rows: **63**. The
counts match.

## Recorded interpretation decisions and deviations

1. **The transition table extends the linear chain with the area's own
   rejection and recovery contracts.** core.md lines 288-289 give the
   machine `REQUESTED -> HELD -> terminal(CONSUMED | RELEASED | EXPIRED)`.
   INV-5-2 (lines 307-309) adds the load-bearing edge: "a REQUESTED
   transition either becomes HELD or is rejected — never left ambiguous" —
   a rejected request resolves REQUESTED -> RELEASED (the recorded,
   unambiguous outcome). Crash recovery (lines 316-318) adds the same edge
   from the other side: "rolled forward to HELD or rolled back to RELEASED
   based on the recorded decision". REQUESTED -> CONSUMED and REQUESTED ->
   EXPIRED do not exist (a hold is consumed or expired only while HELD);
   every terminal has an empty successor set — the exactly-once discipline
   is structural.
2. **The REQUESTED entry is the pre-commit durable fact carrying the
   decision.** The ledger appends REQUESTED (with the requested hold AND
   the deterministic decision HOLD/REJECT, computed against the resource's
   post-prior-transition accounting) BEFORE the resolution's evidence is
   written; the resolution (HELD or RELEASED) commits after its GC-5 record
   (A15 lines 62-64). A crash — or an evidence-write failure — between the
   two leaves exactly the dangling tail the recovery rule contemplates.
   Every command (and every recovery run) first resolves the resource's
   dangling tail per the recorded decision, so REQUESTED is never left
   ambiguous past a command boundary.
3. **The REQUESTED and RESOURCE_DECLARED entries emit no evidence
   records.** A05's named set (lines 326-328) is exactly RESERVATION_HELD,
   RESERVATION_CONSUMED, RESERVATION_RELEASED, RESERVATION_EXPIRED — no
   REQUESTED or declaration type exists, and the named set is exhaustive
   (the RTN-005 precedent). The REQUESTED entry is the pre-commit log fact;
   the declaration is the resource owner's integration input (lines
   335-336), not a reservation transition.
4. **The evidence proof slot mapping.** "proof: ledger sequence number and
   arithmetic identity after transition" (lines 326-328):
   proof.sequenceNumbers = the transition entry's PER-RESOURCE sequence
   position (INV-5-2's cited ordering: "transitions for the same resource
   are totally ordered by the ledger sequence"); proof.hashes = the
   post-transition arithmetic-identity hash (`rai.v1.<sha256>` over the
   canonical encoding of (resource, unit, declared, held, consumed,
   available)) — the verifiable encoding of INV-5-1. The entry's
   globalSequence (the cross-resource total order) stays in the log and
   the durable store.
5. **Exactly-once terminals are idempotent observations on repeat
   commands.** INV-5-3 (lines 310-312): "CONSUMED and RELEASED are
   exactly-once terminals" — a repeat consume of a CONSUMED reservation
   returns the recorded terminal (no second arithmetic effect, no second
   evidence record), which is what makes crash-recovery replay and
   plan-terminal retries safe; a terminal-command mismatch (consuming a
   released hold) is the typed ILLEGAL_TRANSITION rejection.
6. **Expiry is a pure function of (ledger state, protocol time).** Lines
   290-291: "expiry is deterministic on protocol time" — a HELD reservation
   is expired iff the evaluation time's wall component has reached the
   deadline (expired iff wallMs >= deadlineEpochMs; the deadline is the
   last valid instant — recorded interpretation). The expired set of one
   run is processed in ascending reservation-id order (a deterministic
   total order). Expiry is driven by an explicit run (the owning flow
   decides when), never by a background clock.
7. **Resource declaration is declare-once.** INV-5-1's declared total is
   the identity's fixed input; re-declaring the identical total is an
   idempotent replay, a different total is the typed
   RESOURCE_ALREADY_DECLARED rejection. Top-ups are the later liquidity
   wave's composition (recorded as a known limitation).
8. **The crash-recovery model.** The ledger's entry log is the durable
   artifact; the in-memory maps rebuild by replay (the constructor's
   initialEntries adoption, with INV-5-1 re-asserted after every replayed
   transition and corrupt logs failing adoption loudly). A crash point is
   any prefix of the log: recover() resolves every dangling REQUESTED tail
   per its recorded decision, appending the resolution entries and writing
   their evidence records (the recovery is itself a consequential
   operation, with RECOVERY_ROLLFORWARD / RECOVERY_ROLLBACK reason codes
   recording the provenance). "Never duplicated" holds three ways: the
   replay creates each reservation once (a second REQUESTED for one id is
   a corrupt-log error); each dangle resolves exactly once; a second
   recovery run finds nothing. The evidence-log-vs-ledger dual-write window
   (a crash between an evidence write and the entry append) is the
   in-process runtime's known limitation — transactional composition of
   the two durable artifacts is the deployment root's concern (RTN-012).
9. **UNKNOWN holds stay HELD.** Lines 319-322: the ledger never resolves
   holds on its own — "associated reservations remain HELD until
   reconciliation resolves the operation; they are then consumed or
   released exactly once (GC-2)". The consuming/releasing flow is the plan
   (area 4, via the acquisition port); the ledger initiates no external
   effects (lines 333-334).
10. **The routing-facing port implementation composes the two owned
    surfaces.** `createReservationAcquisitionPort` implements routing's
    `ReservationAcquisition` (type-only import — dependency inversion, the
    kernel's EvidenceSubmission pattern) over the ledger.
11. **Commands are async and await the evidence submission; the state
    layer is an in-process single writer** (the RTN-002/RTN-005 precedent)
    so the full command discipline runs under `bun test` — Bun 1.3.14 does
    not implement node:sqlite. The durable side is the per-domain
    persistence module (owned migrations + bridge functions), exercised by
    `scripts/test_protocol_routing_reservations.mjs` under plain Node.

## Exported-symbol table

| # | Export | Kind | v0.1 source (quoted line) | Supporting | Notes |
|---|--------|------|---------------------------|------------|-------|
| 1 | `RESERVATION_STATES` | const | core.md lines 288-289: "States: REQUESTED -> HELD -> terminal(CONSUMED | RELEASED | EXPIRED)." | — | Frozen 5-member vocabulary |
| 2 | `ReservationState` | type | core.md lines 288-289 | — | Closed union; 3 terminals |
| 3 | `RESERVATION_TRANSITIONS` | const | core.md lines 288-289 | INV-5-2 lines 307-309; lines 316-318 | Decision 1: chain + rejection/recovery edge |
| 4 | `isReservationState` | function | core.md lines 288-289 | — | Runtime guard |
| 5 | `canTransitionReservation` | function | core.md lines 288-289 | — | Table predicate |
| 6 | `RESERVATION_REASON_CODES` | const | core.md lines 326-328 ("with reason codes" — the A15 outcome slot) | INV-5-1 lines 304-306 (INSUFFICIENT_AVAILABLE); lines 290-291 (DEADLINE_EXPIRED); lines 316-318 (RECOVERY_*) | 4 members, each flow-cited; frozen |
| 7 | `ReservationReasonCode` | type | core.md lines 326-328 | — | Closed union |
| 8 | `isReservationReasonCode` | function | core.md lines 326-328 | — | Runtime guard |
| 9 | `ReservationRecord` | interface | core.md lines 286-289: "Reservation — hold on a resource (liquidity position, credit exposure, or capability commitment) for one intent and one hop." | INV-5-3 lines 310-312; lines 290-291 | reservationId, intent/hop/resource, amount, state, deadline, reason |
| 10 | `RESERVATION_ENTRY_KINDS` | const | core.md lines 293-295: "per-resource serialized log of reservation transitions. The ledger is the concurrency frontier: all resource mutations pass through it in sequence order." | lines 288-289 (the transition kinds); INV-5-1 lines 304-306 (RESOURCE_DECLARED) | 6 kinds: the declaration + the five transitions |
| 11 | `ReservationEntryKind` | type | core.md lines 293-295 | — | Closed union |
| 12 | `isReservationEntryKind` | function | core.md lines 293-295 | — | Runtime guard |
| 13 | `ReservationLedgerEntry` | interface | core.md lines 293-295 (the log) | INV-5-2 lines 307-309 (resourceSequence); lines 316-318 (the recorded decision) | globalSequence + resourceSequence + the transition fact |
| 14 | `RESERVATION_REJECTION_CODES` | const | core.md lines 326-328 (the exhaustive named evidence set) | rails typed-rejection convention | 5 typed rejection codes; no invented evidence |
| 15 | `ReservationRejectionCode` | type | core.md lines 326-328 | — | Closed union |
| 16 | `ReservationRequestResult` | type | core.md lines 286-289 | INV-5-2 lines 307-309; INV-5-3 lines 310-312 | Recorded state (held or terminal) or typed rejection |
| 17 | `ReservationTerminalCommandResult` | type | core.md lines 310-312 ("exactly-once terminals") | lines 319-322 | Updated/replayed record or typed rejection |
| 18 | `ResourceDeclarationResult` | type | core.md lines 304-306 (INV-5-1's declared total) | lines 335-336 (the resource owners) | Declaration outcome |
| 19 | `LedgerRecoveryReport` | interface | core.md lines 316-318: "Crash recovery replays the ledger tail: REQUESTED without a subsequent transition is rolled forward to HELD or rolled back to RELEASED based on the recorded decision, never duplicated." | — | The resolutions + the inspected length |
| 20 | `transitionReservation` | function | core.md lines 288-289 | INV-5-3 lines 310-312 | Pure; exactly-once structural |
| 21 | `isExpiredAt` | function | core.md lines 290-291: "Each reservation carries a deadline; expiry is deterministic on protocol time." | GC-1 | Decision 6: wallMs >= deadline; HELD only |
| 22 | `isRequestedResolution` | function | INV-5-2 (core.md lines 307-309): "a REQUESTED transition either becomes HELD or is rejected — never left ambiguous" | lines 316-318 | HELD or RELEASED, exactly |
| 23 | `ResourceAccounting` | interface | INV-5-1 (core.md lines 304-306): "for every resource, available = declared total minus held minus consumed" | lines 335-336 | The triple + resource id |
| 24 | `initialResourceAccounting` | function | INV-5-1 (core.md lines 304-306) | — | (declared, 0, 0) |
| 25 | `availableResource` | function | INV-5-1 (core.md lines 304-306): "available = declared total minus held minus consumed, computed in integer Money" | — | subtractMoney twice; never negative well-formed |
| 26 | `resourceInvariantHolds` | function | INV-5-1 (core.md lines 304-306): "the identity holds after every transition" | GC-1 | The property-tested predicate |
| 27 | `applyHold` | function | INV-5-1 (core.md lines 304-306); INV-5-2 (lines 307-309) | — | held += amount; over-commit rejected |
| 28 | `applyTransitionArithmetic` | function | INV-5-1 (core.md lines 304-306) | lines 280-282 ("either consumed or released — never silently lost") | Per-edge arithmetic; REQUESTED->RELEASED is a no-op |
| 29 | `coversAmount` | function | INV-5-1 (core.md lines 304-306); INV-5-2 (lines 307-309) | — | Integer comparison |
| 30 | `RESOURCE_ARITHMETIC_IDENTITY_HASH_FORMAT_VERSION` | const | core.md lines 326-328: "arithmetic identity after transition" | GC-1 | `rai.v1.` prefix |
| 31 | `canonicalResourceAccounting` | function | core.md lines 326-328; INV-5-1 (lines 304-306) | — | Deterministic encoding of the post-transition identity |
| 32 | `resourceArithmeticIdentityHash` | function | core.md lines 326-328: "(proof: ledger sequence number and arithmetic identity after transition)" | GC-1 | sha256; feeds the RESERVATION_* proof slots |
| 33 | `KeyedSerializer` | class | INV-5-2 (core.md lines 293-295, 307-309): per-resource total order through the ledger | — | Per-key async total order; domain-owned copy (RTN-005 discipline) |
| 34 | `RESERVATION_AUTHORITY_ID` | const | core.md lines 299-301: "Reservation Authority (protocol layer, area 5) owns reservation state and per-resource serialization." | registry A05 "owningAuthority": "Reservation Authority" | The 'authority' slot value |
| 35 | `RESERVATION_EVIDENCE_VOCABULARY` | const | core.md lines 326-328 (the named set) | — | Exactly the 4 named types |
| 36 | `reservationHeldEvidence` | function | core.md lines 326-328: "RESERVATION_HELD ... (proof: ledger sequence number and arithmetic identity after transition)." | A15 lines 26-32; GC-5; lines 316-318 (recovery reason) | Decision 4: sequenceNumbers + identity hash |
| 37 | `reservationConsumedEvidence` | function | core.md lines 326-328 ("RESERVATION_CONSUMED") | INV-5-3 lines 310-312; A15 lines 26-32 | Post-transition arithmetic proof |
| 38 | `reservationReleasedEvidence` | function | core.md lines 326-328 ("RESERVATION_RELEASED") | INV-5-2 lines 307-309; lines 316-318; A15 lines 26-32 | Reason code: rejection or recovery |
| 39 | `reservationExpiredEvidence` | function | core.md lines 326-328 ("RESERVATION_EXPIRED") | lines 290-291; A15 lines 26-32 | DEADLINE_EXPIRED reason |
| 40 | `submitReservationEvidence` | function | A15 lines 62-64: "an operation is not committed until its record is written. A failed write fails the operation." | kernel ports.ts | Submit-then-commit coupling |
| 41 | `ReservationLedger` | class | core.md lines 293-295: "ReservationLedger — per-resource serialized log of reservation transitions. The ledger is the concurrency frontier: all resource mutations pass through it in sequence order." | INV-5-1/5-2/5-3; lines 316-322; lines 330-336 | The command surface: declare/request/consume/release/expire/recover |
| 42 | `openReservationLedger` | function | core.md lines 316-318 (crash recovery to completion before return) | — | The boot factory: adopt + recover |
| 43 | `ReservationLedgerDeps` | interface | core.md lines 293-295 | A15 lines 62-64 | evidence + wallClock + initialEntries |
| 44 | `RecoveryAction` | interface | core.md lines 316-318: "rolled forward to HELD or rolled back to RELEASED based on the recorded decision" | — | One resolved dangle |
| 45 | `createReservationAcquisitionPort` | function | core.md lines 245-247 (A04's INV-4-2 — dispatch's acquisition step) + lines 272-273 | lines 319-322; INV-5-3 lines 310-312 | Decision 10: routing's area-5 port over the ledger |
| 46 | `DEFAULT_RESERVATIONS_DB_PATH` | const | (persistence convention; v0.1 prescribes no storage — README.md §9 lines 173-174) | spec/durable/execution.md §2 lines 40-43; wave README "Persistence convention" | var/reservations.sqlite |
| 47 | `RESERVATIONS_MIGRATIONS_DIR_ENV_VAR` | const | (same) | spec/durable/execution.md §2 lines 44-47 | PAYSWAP_RESERVATIONS_MIGRATIONS_DIR |
| 48 | `RESERVATIONS_MIGRATIONS_RELATIVE_DIR` | const | (same) | the per-domain convention | src/lib/protocol-runtime/reservations/migrations |
| 49 | `RESERVATIONS_STORE_DOMAIN` | const | (same) | — | 'protocol-runtime-reservations' |
| 50 | `resolveReservationsMigrationsDir` | function | (same) | spec/durable/execution.md §2/§4; the substrate walk-up strategy | explicit -> env -> walk-up -> fail-closed |
| 51 | `openReservationsStore` | function | (same) | spec/durable/execution.md §3/§4; RTN-001 kernel/persistence.ts (the reference pattern) | openDurableDatabase over the owned migrations |
| 52 | `writeLedgerEntry` | function | (same) | core.md lines 293-295 (the append-only log) | INSERT-only; the crash-recovery input |
| 53 | `writeReservationRecord` | function | (same) | core.md lines 286-289; INV-5-3 | INSERT-only on identity; storage-level UNIQUE |
| 54 | `saveReservationState` | function | (same) | core.md lines 288-289 | The durable projection of a terminal transition |
| 55 | `writeResourceRow` | function | (same) | INV-5-1 lines 304-306 | The declared-total row |
| 56 | `saveResourceAccounting` | function | (same) | INV-5-1 lines 304-306 ("the identity holds after every transition") | held/consumed projection |
| 57 | `readLedgerEntries` | function | (same) | GC-1 | Read-back reconstruction in global order |
| 58 | `readReservations` | function | (same) | INV-5-3 | Read-back reconstruction |
| 59 | `readResourceAccountings` | function | (same) | INV-5-1 | Read-back reconstruction |
| 60 | `persistLedgerSnapshot` | function | (same) | the deployment-root composition convention | Full write-through of the ledger state |
| 61 | `accountingFromDeclared` | function | (same) | INV-5-1 | Read-side helper |
| 62 | `ReservationsStoreOptions` | interface | (same) | the substrate's DurableDatabaseOptions shape | dbPath + migrationsDir |
| 63 | `ReservationsStoreWrite` | interface | (same) | DEP-003 §6 dedupe-report shape | { created, reason } |

## Verification

- `bunx tsc --noEmit`: 0 errors.
- `bun test`: the 123 RTN-006 tests (routing + reservations) green; the
  merged suites untouched and green (568 total across the repository).
- `bun run build`: green.
- `node scripts/test_protocol_routing_reservations.mjs`: the durable-side
  harness green (migrations applied, round trips exact, INV-5-2/INV-5-3
  storage-level UNIQUEs, durable crash recovery from the persisted entry
  log, deterministic transcripts).
