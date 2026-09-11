# RTN-001 — Kernel contract review

Work order: `spec/protocol-runtime-work-orders/RTN-001.md`
Owned surface: `src/lib/protocol-runtime/kernel/`
Rule: **every exported kernel type/function/constant maps to a cited
`spec/architecture/v0.1/` source; rows with no source are forbidden.**

Method: each row lists the primary `spec/architecture/v0.1/` source (file,
section, line, and the quoted line that grounds the export) and, where
needed, the supporting contracts outside v0.1 that additionally bind the
export (the DEP-003 durable execution contract, the RTN wave conventions,
the deployment topology contract). Quoted text is verbatim from the frozen
v0.1 directory; line numbers refer to the files as merged at the RTN-001
base (`main @ d81c07b`).

Exported symbol count: **59** (enumerated from `kernel.ts`, the public
barrel). Table rows: **59**. The counts match.

## Recorded interpretation decisions and deviations

1. **MoneyBag lives in `money.ts`** (not a separate module). core.md §0
   defines Money and MoneyBag as one adjacent pair of shared conventions
   (lines 11-14); the work order's suggested module list is explicitly
   adaptive ("adapt to what §0 actually requires and say so if you deviate").
2. **Identity derivation has no §0 line.** The work order objective says
   "deterministic id and idempotency-key derivation ... cite §0 lines", but
   core.md §0 contains no identity-derivation line. The derivation contract
   is sourced from the per-area INV idempotency contracts that REQUIRE
   derived ids/keys (INV-1-2/1-3, INV-3-3, INV-4-3, INV-5-3, INV-15-4) —
   all inside `spec/architecture/v0.1/` — plus the DEP-003 enqueue contract
   as a supporting source. No semantics beyond those contracts were added.
3. **The shared reason-code vocabulary is exactly `{UNKNOWN}`.** All six
   v0.1 files' §0 recap sections repeat exactly one machine-readable
   outcome token (UNKNOWN, GC-2). Area-specific codes (POLICY_UNSATISFIABLE,
   NO_VIABLE_ROUTE, ...) are owned by their areas' work orders (RTN-005
   and later) and are deliberately absent from the kernel — no inventions.
4. **`prisma/schema.prisma` does not exist in this repository.** The work
   order's environment step names it as the DEP-003 enqueue idempotency
   contract, but the actual contract lives in
   `deploy/migrations/0001_durable_execution.sql` line 34 (`UNIQUE
   (idempotency_key, kind)`) and `spec/durable/execution.md` §6 (lines
   125-133). The envelope's 1:1 mapping is proven against the real schema
   in `scripts/test_protocol_kernel.mjs` `[test:envelope-enqueue]`.
5. **The persistence convention's v0.1 anchor is a permission, not a
   prescription.** v0.1 intentionally "prescribes no implementation,
   storage, or service decomposition" (README.md §9, lines 173-174); the
   convention itself is decided in the RTN wave governance
   (`spec/protocol-runtime-work-orders/README.md` line 37) and mechanically
   composes the DEP-003 database layer read-only.
6. **Money carries no allocate/split operations.** §0 does not mention
   allocation or splitting; the kernel implements exactly the §0
   representation plus add/subtract (Money) and entrywise add/subtract
   (MoneyBag). Rate application (GC-1's "integer multiplication and
   deterministic rounding") belongs to the areas owning conversions (area 4
   records "explicit, recorded conversion amounts"), not to the kernel.
7. **MoneyBag entry ordering rule (chosen, documented, stable):** entries
   are stored in ascending currency-code order (code-point order over the
   3 uppercase letters). §0 requires entrywise determinism; a fixed total
   order makes every derived representation stable across runs.
8. **Timestamps are integer epoch milliseconds** (the sequenced position is
   a non-negative integer), following the substrate convention
   (`deploy/migrations/0001_durable_execution.sql` line 10: "all timestamps
   are epoch milliseconds (INTEGER)") and the integer discipline of GC-1.
9. **Envelope kind shape.** `kind` is validated as dot-separated lowercase
   segments (`intent.create`) so the DEP-003 `kind` TEXT key stays stable,
   sortable, and collision-free across authorities. This is an
   implementation convention on the DEP-003 side of the mapping; the
   semantic requirement ("operation type") is A15's.

## Contract review table

Legend — v0.1 sources: `core.md` = `spec/architecture/v0.1/core.md`;
`A15` = `spec/architecture/v0.1/evidence-risk-compliance.md` (Area 15);
`README` = `spec/architecture/v0.1/README.md`. Supporting: `DEP-003` =
`spec/durable/execution.md`; `SQL` =
`deploy/migrations/0001_durable_execution.sql`; `WO` =
`spec/protocol-runtime-work-orders/RTN-001.md`; `WAVE` =
`spec/protocol-runtime-work-orders/README.md`; `TOPO` =
`spec/deployment/topology.md`.

### money.ts — Money (core.md §0 lines 11-12; README GC-1 lines 39-43)

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 1 | `MinorUnits` | type | core.md §0 line 11: "Money: signed integer minor units" + README GC-1 line 40: "All monetary values are signed integers in minor units" | — | Branded; minted only by `money()` after integer guards |
| 2 | `CurrencyCode` | type | core.md §0 lines 11-12: "3-letter currency code" | — | Branded; exactly `/^[A-Z]{3}$/` |
| 3 | `DecimalScale` | type | core.md §0 lines 11-12: "explicit decimal scale per currency" | — | Branded; non-negative integer |
| 4 | `Money` | interface | core.md §0 lines 11-12: "Money: signed integer minor units, 3-letter currency code, explicit decimal scale per currency. No floating point anywhere (GC-1)." | README GC-1 lines 39-43 | Immutable value object |
| 5 | `MoneyBagEntry` | interface | core.md §0 line 13: "set of (currency, integer amount) entries" | — | No scale on bag entries (§0 literal shape) |
| 6 | `MoneyBag` | interface | core.md §0 lines 13-14: "MoneyBag: set of (currency, integer amount) entries; addition and subtraction are entrywise and deterministic." | — | Ordering rule: ascending currency code (decision 7) |
| 7 | `money` | function | core.md §0 lines 11-12 (representation contract) | README GC-1 lines 39-43 ("No floating point") | The single public mint; rejects floats, unsafe integers, malformed codes/scales |
| 8 | `isMoney` | function | core.md §0 lines 11-12 | — | Runtime guard re-validating every §0 representation rule |
| 9 | `addMoney` | function | core.md §0 lines 11-14 + README GC-1 line 42-43: "Re-running any computation on identical inputs yields identical outputs" | — | Same currency+scale enforced; safe-integer overflow guard |
| 10 | `subtractMoney` | function | core.md §0 lines 11-14 ("signed", deterministic) | — | Same enforcement; underflow guard |
| 11 | `negateMoney` | function | core.md §0 line 11: "signed integer minor units" | README GC-1 lines 39-43 | Canonicalizes -0 to 0 (determinism) |
| 12 | `compareMoney` | function | core.md §2 INV-2-1 line 116: "policy comparisons are integer comparisons" | — | Same currency+scale enforced |
| 13 | `moneyEquals` | function | core.md §0 lines 11-12 (full representation participates in identity) | — | |
| 14 | `isZeroMoney` | function | core.md §0 line 11 (signed integers include zero; no floats ⇒ exact zero test) | — | |
| 15 | `moneyBag` | function | core.md §0 lines 13-14 | — | Validates entries; rejects duplicate currencies (set semantics); canonical ordering |
| 16 | `emptyMoneyBag` | function | core.md §0 lines 13-14 (entrywise addition over the empty set) | — | Identity element of bag addition |
| 17 | `moneyBagFromMoney` | function | core.md §0 lines 11-14 (Money's minor units are the bag's integer amounts) | — | Drops only the scale (per §0 entry shape) |
| 18 | `addMoneyBags` | function | core.md §0 lines 13-14: "addition and subtraction are entrywise and deterministic" | — | Entrywise union; zero entries retained |
| 19 | `subtractMoneyBags` | function | core.md §0 lines 13-14: "addition and subtraction are entrywise and deterministic" | — | Implicit zero for one-sided currencies |
| 20 | `moneyBagEquals` | function | core.md §0 line 13: "set of (currency, integer amount) entries" | — | Set equality over entries |

### time.ts — protocol time (A15 line 28)

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 21 | `SequencedPosition` | type | A15 line 28: "when: protocol time (sequenced) and recorded wall time" + core.md line 166: "immutable, sequenced view of all capabilities at a point in protocol time" | SQL line 10 (integer timestamps) | Non-negative integer, branded |
| 22 | `WallEpochMs` | type | A15 line 28: "recorded wall time" | SQL line 10: "all timestamps are epoch milliseconds (INTEGER)" | Integer epoch ms, branded |
| 23 | `ProtocolTime` | interface | A15 line 28: "when: protocol time (sequenced) and recorded wall time" | core.md lines 290-291: "expiry is deterministic on protocol time" | The shared time shape authorities stamp |
| 24 | `protocolTime` | function | A15 line 28 | README GC-1 lines 39-43 (integer discipline) | The single mint; guards floats/NaN/unsafe/negative sequence |
| 25 | `isProtocolTime` | function | A15 line 28 | — | Runtime shape guard |

### identity.ts — deterministic derivation (INV idempotency contracts; deviation 2)

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 26 | `DERIVATION_FORMAT_VERSION` | const | INV-4-3 core.md lines 248-249: "compilation is keyed by (intent id, compiler version, snapshot id); identical inputs return the identical plan" | WO objective ("versioned input format so future format changes are detectable") | v1; visible in output prefixes |
| 27 | `DerivationPart` | type | INV-3-3 core.md lines 182-184: "commitment ids are derived from (intent id, capability id)" | README GC-1 lines 39-43 (integer inputs) | string or exact integer; floats rejected |
| 28 | `DerivedProtocolId` | type | INV-3-3 core.md lines 182-184 + INV-5-3 core.md lines 310-312: "reservation ids are derived from (intent id, hop id, resource id)" | — | `pid.v1.<sha256>` |
| 29 | `DerivedIdempotencyKey` | type | INV-1-3 core.md lines 60-62: "re-submission with a recorded idempotency key returns the recorded receipt" | DEP-003 §6 lines 130-133: "MUST always carry a key derived from domain identity" | `idem.v1.<sha256>` |
| 30 | `canonicalDerivationInput` | function | INV-4-3 core.md lines 248-249 ("identical inputs return the identical plan") | — | Unambiguous, versioned encoding |
| 31 | `deriveProtocolId` | function | INV-3-3 core.md lines 182-184; INV-5-3 core.md lines 310-312; INV-15-4 A15 lines 56-58: "evidence write keys derived from the subject operation id" | — | sha256 over the canonical encoding |
| 32 | `deriveIdempotencyKey` | function | INV-1-2 core.md lines 57-59: "Concurrent submissions carrying the same idempotency key collapse to one intent and one receipt" | DEP-003 §6 lines 125-133 (UNIQUE (idempotency_key, kind)) | Feeds the enqueue dedupe |
| 33 | `isDerivedProtocolId` | function | INV-3-3/INV-5-3 (derived-id recognizability) | WO objective (versioned detectability) | Prefix check at current format version |
| 34 | `isDerivedIdempotencyKey` | function | INV-1-3 core.md lines 60-62 | DEP-003 §6 | Prefix check at current format version |

### envelope.ts — the command envelope (A15 slots + INV-1-2/1-3; DEP-003 §6)

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 35 | `CommandKind` | type | A15 line 27: "what: operation type and subject object ids" | DEP-003 §6 lines 125-129 (enqueue kind column) | Shape convention: decision 9 |
| 36 | `ProtocolAuthorityId` | type | A15 line 29: "authority: which protocol authority performed the operation" | — | Enumeration owned by the registry projection + RTN-002/RTN-010 |
| 37 | `SubjectId` | type | A15 line 27: "subject object ids" | — | |
| 38 | `IdempotencyKey` | type | INV-1-3 core.md lines 60-62: "re-submission with a recorded idempotency key returns the recorded receipt" | DEP-003 §6 lines 130-133 (NULL opts out — forbidden here) | Never null on a protocol command |
| 39 | `CommandEnvelope` | interface | A15 lines 26-29 (what/when/authority slots) + INV-1-2 core.md lines 57-59 (idempotency collapse) | WO line 10 ("the payload contract of the durable command path"); TOPO line 180 | Generic over authority-owned body |
| 40 | `CommandEnvelopeField` | type | A15 lines 27-29 (the slot lines the validated fields mirror) | WO line 16: "Command envelope validates (authority target, subject ids, idempotency key, protocol time)" | Field names = the work order's validated fields; not protocol reason codes |
| 41 | `CommandEnvelopeValidation` | type | A15 lines 26-29 + INV-1-2/1-3 | WO line 16 | ok/envelope or field/problem |
| 42 | `KernelEnqueueInput` | interface | INV-1-2 core.md lines 57-59 (collapse identity) | DEP-003 §6 lines 125-129: "enqueue(kind, payload, { idempotencyKey, ... })" | Exactly the queue's input triple |
| 43 | `validateCommandEnvelope` | function | A15 lines 26-29; INV-1-2/1-3 core.md lines 57-62 | WO line 16; DEP-003 §6 | Deterministic validation incl. optional authority allow-list |
| 44 | `commandEnvelopeToEnqueueInput` | function | INV-1-2 core.md lines 57-59 (same key ⇒ same job) | DEP-003 §6 lines 125-133 + SQL line 34: "UNIQUE (idempotency_key, kind)" | The documented 1:1 mapping |

### reason-codes.ts — the shared vocabulary (core.md §0 lines 16-17; GC-2)

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 45 | `SHARED_REASON_CODES` | const | core.md §0 lines 16-17: "External results may be UNKNOWN; the only exit from UNKNOWN is reconciliation (area 14); blind retry is forbidden (GC-2)." | README GC-2 lines 45-49 | Frozen `['UNKNOWN']` — the complete shared set (decision 3) |
| 46 | `SharedReasonCode` | type | core.md §0 lines 16-17 | README GC-2 lines 45-49 | `'UNKNOWN'` only |
| 47 | `isSharedReasonCode` | function | core.md §0 lines 16-17 | — | |

### ports.ts — EvidenceSubmission port (A15 five slots; type-only)

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 48 | `EvidenceWhat` | interface | A15 line 27: "what: operation type and subject object ids" | README GC-5 line 66 | |
| 49 | `EvidenceOutcome` | interface | A15 line 30: "outcome: resulting state or decision, including reason codes" | — | reasonCode optional; area vocabularies |
| 50 | `EvidenceProof` | interface | A15 lines 31-32: "proof: hashes, sequence numbers, and links to prior records required to verify the record" | — | The three spec-named material classes, optional per record |
| 51 | `EvidenceSubmissionRecord` | interface | A15 lines 26-32: "Fields (mandatory, exactly these five semantic slots)" | README GC-5 lines 63-67 | Exactly five slots |
| 52 | `EvidenceSubmission` | interface | A15 lines 41-43: "All other authorities are writers-by-submission only; none can alter or suppress records." | A15 lines 62-64 ("A failed write fails the operation"); WAVE line 39 | TYPE ONLY — implementation is RTN-002's |

### persistence.ts — per-domain persistence convention (README §9 permission; wave decision)

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 53 | `DEFAULT_KERNEL_DB_PATH` | const | README §9 lines 173-174: "This directory defines semantics only; it intentionally prescribes no implementation, storage, or service decomposition." | WAVE line 37 (convention); DEP-003 §2 lines 40-43 (var/ default) | `var/kernel.sqlite`; never committed |
| 54 | `KERNEL_MIGRATIONS_DIR_ENV_VAR` | const | README §9 lines 173-174 (storage not prescribed ⇒ configurable) | DEP-003 §2 lines 44-47 (PAYSWAP_MIGRATIONS_DIR mirror) | `PAYSWAP_KERNEL_MIGRATIONS_DIR` |
| 55 | `KERNEL_MIGRATIONS_RELATIVE_DIR` | const | README §9 lines 173-174 | WAVE line 37: "per-domain migrations inside its owned prefix" | `src/lib/protocol-runtime/kernel/migrations` |
| 56 | `KERNEL_STORE_DOMAIN` | const | README §9 lines 173-174 | DEP-003 §11 lines 220-224 (owner identity discipline) | `protocol-runtime-kernel` |
| 57 | `KernelStoreOptions` | interface | README §9 lines 173-174 | DEP-003 db module option shape | dbPath + migrationsDir |
| 58 | `resolveKernelMigrationsDir` | function | README §9 lines 173-174 | DEP-003 §2/§4; substrate walk-up resolution (db.ts) | explicit → env → walk-up → fail-closed |
| 59 | `openKernelStore` | function | README §9 lines 173-174 | WAVE line 37: "using the DEP-003 database layer read-only"; WO line 18; DEP-003 §3/§4 | Opens via `openDurableDatabase`; the convention demonstration |

## Supporting sources used (outside spec/architecture/v0.1/)

These bind the kernel to the substrate and wave contracts WITHOUT defining
protocol semantics:

- `spec/durable/execution.md` — the DEP-003 enqueue idempotency contract
  (§6, lines 125-133), migration conventions (§4), configuration (§2),
  event ownership (§11), integration guide (§13).
- `deploy/migrations/0001_durable_execution.sql` — the physical
  `UNIQUE (idempotency_key, kind)` constraint (line 34) and the integer
  epoch-milliseconds timestamp convention (line 10).
- `spec/protocol-runtime-work-orders/RTN-001.md` — the work order's
  objective/acceptance lines (10, 16, 18) for the envelope validation
  surface and the persistence demonstration requirement.
- `spec/protocol-runtime-work-orders/README.md` — the persistence
  convention decision (line 37) and the evidence discipline (line 39).
- `spec/development-state/rtn-plan-rulings.md` — Q4/delta 4: the kernel
  carries the "values" weight; no identity/market authority is materialized.
- `spec/deployment/topology.md` — the durable command path node contract
  (line 180: "durable, at-least-once transport for protocol commands ...
  ordering and durability only; no financial semantics").

## Forbidden-source compliance

No file under `spec/architecture/v0.1/`, `spec/architecture-change-requests/`,
`spec/product/`, `src/lib/protocol/`, `src/lib/durable/`, `src/components/`,
or `src/app/` was modified. `src/lib/durable/` is consumed read-only
(`openDurableDatabase` imported from `src/lib/durable/db.ts`). Root-config
additions outside any forbidden surface: `tsconfig.json` gained
`allowImportingTsExtensions` (required so kernel modules can use explicit
`.ts` specifiers and thereby stay loadable under plain Node with type
stripping — the same loadability property the substrate keeps for its own
evidence harness), and `.gitignore` gained `var/` (mandated verbatim by
`spec/durable/execution.md` §2: "Data is never committed: add `var/` to the
repository's ignore rules"; DEP-003 had not carried this through).
