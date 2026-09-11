# RTN-005 — Capability Authority contract review

Work order: `spec/protocol-runtime-work-orders/RTN-005.md`
Owned surface: `src/lib/protocol-runtime/capability/` (area 3 — A03)
Rule: **every exported type/function/constant maps to a cited
`spec/architecture/v0.1/` source; rows with no source are forbidden.**

Method: each row lists the primary `spec/architecture/v0.1/` source (file,
section, line, and the quoted line that grounds the export) and, where
needed, the supporting contracts outside v0.1 that additionally bind the
export. Quoted text is verbatim from the frozen v0.1 directory; line
numbers refer to the files as merged at the RTN-005 base
(`main @ 54b12ff`).

Exported symbol count: **62** (47 runtime symbols enumerated from
`capability.ts` at load + 15 exported types). Table rows: **62**. The
counts match.

## Recorded interpretation decisions and deviations

1. **"A capability entering DEGRADED invalidates only OFFERED commitments"
   (core.md lines 188-190) is materialized as OFFERED -> RELEASED.** The
   commitment machine (lines 160-163) has OFFERED -> RESERVED -> terminal
   (CONSUMED | EXPIRED | RELEASED); an invalidated offer is a promise no
   longer binding — exactly the RELEASED terminal — and no capacity was
   ever held for it ("RESERVED commitments count against capability
   capacity", lines 162-163). The transition table therefore carries one
   edge beyond the linear chain reading, cited to the degradation
   semantics; leaving invalidated offers frozen in OFFERED would contradict
   "invalidates". RESERVED commitments are untouched ("RESERVED commitments
   remain valid until released by area 5 rules or expired by deadline",
   lines 190-191) — release and expiry still work after degradation.
2. **The declared capacity is ONE integer Money bound.** INV-3-1 says
   "capacity limits are integer Money bounds; sum of RESERVED and CONSUMED
   commitments never exceeds the capability's declared capacity" —
   singular declared capacity per capability. It is denominated in the
   corridor's source currency (the commitment amount's unit); the cost
   schedule is a separate Money value and may be denominated independently.
   Commitment amounts must share the capacity unit (enforced by the kernel
   Money arithmetic guards).
3. **INV-3-2's serialization is keyed per CAPABILITY** — a strengthening
   that implies the spec's per-(capability, intent) key (two commands
   sharing (capability, intent) necessarily share the capability) and is
   REQUIRED by the invariant's second half ("capacity accounting is updated
   atomically with commitment state"): capacity is per-capability shared
   state, and the check-then-update of reservation must not interleave
   across different intents competing for the same capability.
4. **"CONSUMED is terminal and exactly once per intent" (lines 162-163) is
   enforced per (intent, capability).** The commitment id IS the (intent
   id, capability id) pair (INV-3-3), so exactly-once is structural: the
   commitment's CONSUMED is terminal (the second consume is an
   ILLEGAL_TRANSITION rejection) and one commitment exists per pair. A
   multi-hop intent consumes one commitment per hop-capability, which the
   id derivation supports; a global one-consumption-per-intent rule across
   ALL capabilities would contradict the (intent, capability) keying.
5. **Offering does not check capacity; reserving does.** INV-3-1 binds
   "sum of RESERVED and CONSUMED" — OFFERED holds no capacity, so the
   integer bound is checked and taken atomically at OFFERED -> RESERVED
   (where the invariant's subjects change). An offer is a promise that may
   fail to reserve.
6. **The ACTIVATION gate is implemented although the work order's
   acceptance list names only the intent gate.** core.md lines 207-208
   ("Depends on ... area 16 for risk gating of capability registration")
   and INV-16-3 (evidence-risk-compliance.md lines 129-131, "capability
   ACTIVATION") both bind this surface: REGISTERED -> ACTIVE requires a
   terminal APPROVED record for the capability subject. Not implementing it
   would violate a frozen invariant — a stop condition under the wave
   rules.
7. **The capability id is caller-supplied identity.** Capability holders
   submit attestations and the authority validates and sequences them
   (lines 170-172); the id is the registry key the INV-3-3 derivation
   consumes. Registration validates the declaration shape; duplicate ids
   are refused (one registry row per id).
8. **Snapshot entries carry the capacity accounting view** (declared,
   reserved, consumed, available) — "view of all capabilities" (lines
   165-166) includes the commitment state the policy evaluation's
   feasibility check needs; available = declared - reserved - consumed is
   the INV-3-1 identity rearranged. The snapshot is deep-frozen at mint and
   sequenced by the authority's monotonic counter (id derived from the
   sequence).
9. **One evidence record per consequential operation, exactly the named
   set.** CAPABILITY_REGISTERED for registration; CAPABILITY_STATE_CHANGED
   for every lifecycle step; the five COMMITMENT_* types for every
   commitment transition (including the degradation invalidation's
   OFFERED -> RELEASED). "each with capacity arithmetic in the proof field"
   (lines 198-200) rides as proof.sequenceNumbers = [reservedMinor,
   consumedMinor, declaredMinor] — the exact integers of the INV-3-1
   identity after the transition. Refused commands emit no evidence.
10. **The state layer is an in-process single writer** (the RTN-002
    precedent — see intent/CONTRACT-REVIEW.md decision 8): the authority
    runs under `bun test`; the durable side is persistence.ts + owned
    migrations, exercised by `scripts/test_protocol_authorities.mjs`.
11. **Capability ids in the snapshot are ordered by id** (ascending) so the
    immutable view has a deterministic serialization order (GC-1
    discipline for any derived representation).

## Exported-symbol table

| # | Export | Kind | v0.1 source (quoted line) | Supporting | Notes |
|---|--------|------|---------------------------|------------|-------|
| 1 | `CAPABILITY_STATES` | const | core.md lines 156-157: "States: REGISTERED -> ACTIVE -> DEGRADED -> RETIRED." | — | Frozen 4-member vocabulary |
| 2 | `CapabilityState` | type | core.md lines 156-158 | — | RETIRED terminal |
| 3 | `CAPABILITY_TRANSITIONS` | const | core.md lines 156-157 | line 158 ("Retirement is terminal") | The strict chain, no shortcuts |
| 4 | `isCapabilityState` | function | core.md lines 156-157 | — | Runtime guard |
| 5 | `canTransitionCapability` | function | core.md lines 156-157 | — | Table predicate |
| 6 | `COMMITMENT_STATES` | const | core.md line 161: "States: OFFERED -> RESERVED -> CONSUMED | EXPIRED | RELEASED." | — | Frozen 5-member vocabulary |
| 7 | `CommitmentState` | type | core.md lines 160-163 | — | 3 terminals |
| 8 | `COMMITMENT_TRANSITIONS` | const | core.md lines 160-163 | lines 188-190 (degradation invalidation) | Decision 1: + OFFERED -> RELEASED |
| 9 | `isCommitmentState` | function | core.md line 161 | — | Runtime guard |
| 10 | `canTransitionCommitment` | function | core.md lines 160-163 | — | Table predicate |
| 11 | `Corridor` | interface | core.md lines 154-155: "corridor (source/destination currencies and geographies)" | — | The 4-field matching key |
| 12 | `CapabilityDeclaration` | interface | core.md lines 154-155: "rail id, corridor (...), capacity limits, cost schedule, tier" | — | Exactly the named fields (capacity rides on the record) |
| 13 | `CapabilityRecord` | interface | core.md lines 154-158 ("Capability — advertised ability") | INV-3-1 (lines 176-178) | Declaration + state + accounting triple |
| 14 | `CommitmentRecord` | interface | core.md lines 160-163: "Commitment — binding promise of capacity for one intent." | INV-3-3 (lines 182-184); lines 190-191 (deadline) | Derived id + amount + deadline |
| 15 | `CapabilitySnapshotEntry` | interface | core.md lines 165-166: "immutable, sequenced view of all capabilities at a point in protocol time" | INV-3-1 | The per-capability view incl. accounting (decision 8) |
| 16 | `CapabilitySnapshot` | interface | core.md lines 165-166 | A15 line 28 (sequenced + wall time) | snapshotId derived from sequence |
| 17 | `CAPABILITY_REJECTION_CODES` | const | core.md lines 197-200 (the exhaustive named set) | rails typed-rejection convention | 8 typed codes; refused commands emit no evidence |
| 18 | `CapabilityRejectionCode` | type | core.md lines 197-200 | — | Closed union |
| 19 | `CapabilityCommandResult` | type | core.md lines 154-163 (the machines the commands drive) | INV-3-1/INV-3-2/INV-3-3 | Typed rejection on refusal |
| 20 | `CapabilityAccounting` | interface | INV-3-1 (core.md lines 176-178): "sum of RESERVED and CONSUMED commitments never exceeds the capability's declared capacity" | — | declared + reserved + consumed |
| 21 | `initialAccounting` | function | INV-3-1 (core.md lines 176-178) | INV-3-2 (lines 179-181) | Zero accounting for a registration |
| 22 | `capacityInvariantHolds` | function | INV-3-1 (core.md lines 176-178) | — | The identity as a predicate (property-tested) |
| 23 | `availableCapacity` | function | INV-3-1 (core.md lines 176-178) | lines 165-166 (snapshot view) | declared - reserved - consumed |
| 24 | `applyReservation` | function | INV-3-1 (core.md lines 176-178) | INV-3-2 (lines 179-181) | reserved += amount with the bound check |
| 25 | `applyConsumption` | function | core.md lines 162-163: "RESERVED commitments count against capability capacity; CONSUMED is terminal and exactly once per intent" | INV-3-1 | reserved -> consumed |
| 26 | `applyRelease` | function | core.md lines 190-191: "released by area 5 rules or expired by deadline" | INV-3-1 | reserved -= amount |
| 27 | `isZeroAccounting` | function | INV-3-1 (core.md lines 176-178) | — | The zero baseline |
| 28 | `capacityArithmeticProof` | function | core.md lines 198-200: "each with capacity arithmetic in the proof field" | INV-3-1 | [reserved, consumed, declared] integers |
| 29 | `transitionCapability` | function | core.md lines 156-157 | line 158 | Pure; typed ILLEGAL_TRANSITION |
| 30 | `transitionCommitment` | function | core.md lines 160-163 | — | Pure; terminals have no exits |
| 31 | `acceptsNewCommitments` | function | core.md lines 157-158: "Degraded capabilities accept no new commitments." | — | Exactly ACTIVE |
| 32 | `isInvalidatedByDegradation` | function | core.md lines 188-190: "A capability entering DEGRADED invalidates only OFFERED commitments" | — | Exactly OFFERED |
| 33 | `isExpiredAt` | function | core.md lines 190-191: "expired by deadline" | kernel time.ts (deterministic on protocol time) | Deadline predicate |
| 34 | `KeyedSerializer` | class | INV-3-2 (core.md lines 179-181): "commitment transitions are serialized per (capability, intent)" | — | Serialized per capability (decision 3) |
| 35 | `CAPABILITY_AUTHORITY_ID` | const | registry A03 "owningAuthority": "Capability Authority" | core.md lines 170-172 | The 'authority' slot value |
| 36 | `CAPABILITY_EVIDENCE_VOCABULARY` | const | core.md lines 197-200 (the named set) | — | Exactly the 7 named types |
| 37 | `CAPABILITY_DECLARATION_HASH_FORMAT_VERSION` | const | core.md lines 154-155 (the advertised ability) | GC-1 (README.md §3 lines 39-43) | `cdh.v1.` prefix |
| 38 | `canonicalCapabilityDeclaration` | function | core.md lines 154-155 | A15 lines 31-32 | Kernel type-tagged encoding |
| 39 | `capabilityDeclarationHash` | function | core.md lines 154-155 | A15 lines 31-32 (proof hashes) | Feeds CAPABILITY_* proof slots |
| 40 | `capabilityRegisteredEvidence` | function | core.md line 197: "CAPABILITY_REGISTERED" | A15 lines 26-32; GC-5 | Five slots; declaration hash proof |
| 41 | `capabilityStateChangedEvidence` | function | core.md line 197: "CAPABILITY_STATE_CHANGED" | A15 lines 26-32; GC-5 | New state + optional reason |
| 42 | `commitmentEvidence` | function | core.md lines 198-200: "COMMITMENT_OFFERED, COMMITMENT_RESERVED, COMMITMENT_CONSUMED, COMMITMENT_RELEASED, COMMITMENT_EXPIRED (each with capacity arithmetic in the proof field)." | INV-3-1 | The shared 5-slot shape; proof triple |
| 43 | `submitCapabilityEvidence` | function | A15 lines 62-64: "A failed write fails the operation." | kernel ports.ts | Submit-then-commit coupling |
| 44 | `CapabilityAuthority` | class | core.md lines 170-172: "Capability Authority (protocol layer, area 3) owns the capability registry and commitment state." | INV-3-1/2/3; lines 186-193 | The command surface + snapshot mint |
| 45 | `CapabilityActivationGate` | type | core.md lines 207-208: "area 16 for risk gating of capability registration" | A16 INV-16-3 (evidence-risk-compliance.md lines 129-131) | Injected gate port (decision 6) |
| 46 | `CapabilityAuthorityDeps` | type | core.md lines 170-172 | A15 lines 62-64; lines 207-208 | evidence + gate + wallClock |
| 47 | `DEFAULT_CAPABILITY_DB_PATH` | const | (persistence convention; v0.1 prescribes no storage — README.md §9 lines 173-174) | spec/durable/execution.md §2 lines 40-43; wave README | var/capability.sqlite |
| 48 | `CAPABILITY_MIGRATIONS_DIR_ENV_VAR` | const | (same) | spec/durable/execution.md §2 lines 44-47 | PAYSWAP_CAPABILITY_MIGRATIONS_DIR |
| 49 | `CAPABILITY_MIGRATIONS_RELATIVE_DIR` | const | (same) | wave README "Persistence convention" | Owned prefix migrations |
| 50 | `CAPABILITY_STORE_DOMAIN` | const | (same) | wave README "Persistence convention" | protocol-runtime-capability |
| 51 | `resolveCapabilityMigrationsDir` | function | (same) | spec/durable/execution.md §2/§4 | Explicit > env > walk-up > fail-closed |
| 52 | `openCapabilityStore` | function | (same) | spec/durable/execution.md §3/§4; kernel reference pattern | openDurableDatabase + owned migrations |
| 53 | `CapabilityStoreOptions` | type | (same) | substrate DurableDatabaseOptions shape | dbPath + migrationsDir |
| 54 | `CapabilityStoreWrite` | type | (same) | INV-3-3 (core.md lines 182-184); DEP-003 §6 dedupe-report shape | created + reason |
| 55 | `writeCapabilityRecord` | function | core.md lines 154-158 (the persisted record) | — | INSERT-only on id |
| 56 | `saveCapabilityState` | function | core.md lines 156-158 (the lifecycle) | INV-3-1/INV-3-2 (accounting atomically) | UPDATE state + accounting |
| 57 | `writeCommitmentRecord` | function | core.md lines 160-163 | INV-3-3 (lines 182-184) | UNIQUE (intent, capability) structural |
| 58 | `saveCommitmentState` | function | core.md lines 160-163 | — | UPDATE commitment state |
| 59 | `writeCapabilitySnapshot` | function | core.md lines 165-166 ("immutable, sequenced view") | — | INSERT-only, one row per sequence |
| 60 | `readCapabilities` | function | core.md lines 154-158 | GC-1 (README.md §3 lines 39-43) | Money re-minted on read |
| 61 | `readCommitments` | function | core.md lines 160-163 | INV-3-3 | Reconstructed frozen commitments |
| 62 | `readCapabilitySnapshots` | function | core.md lines 165-166 | — | Immutable views survive the round trip |
