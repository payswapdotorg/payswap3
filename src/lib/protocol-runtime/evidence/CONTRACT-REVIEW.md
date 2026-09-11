# RTN-002 — Evidence Authority contract review

Work order: `spec/protocol-runtime-work-orders/RTN-002.md`
Owned surface: `src/lib/protocol-runtime/evidence/`
Rule: **every exported symbol maps to a cited spec source (file + section +
quoted line); rows with no source are forbidden.**

Method: each row lists the primary `spec/architecture/v0.1/` source (file,
section, line, and the quoted line that grounds the export) and, where
needed, the supporting contracts outside v0.1 that additionally bind the
export (the DEP-003 durable execution contract, the RTN wave conventions,
the registry, the composed RTN-001 kernel surface). Quoted text is verbatim
from the frozen v0.1 directory; line numbers refer to the files as merged at
the RTN-002 base (`main @ fd996c3`).

Exported symbol count: **34** (enumerated from `evidence.ts`, the public
barrel: 25 runtime exports + 9 type-only exports). Table rows: **34**. The
counts match.

## Recorded interpretation decisions and deviations

1. **Module split (adaptive).** The work order says "module split adaptive —
   say so if you deviate": the evidence domain is split
   `canonical.ts` / `record.ts` / `chain.ts` / `log.ts` / `persistence.ts` /
   `evidence.ts` (barrel) + `migrations/0001_evidence.sql`. The deviation
   from a one-file reading is `canonical.ts`, extracted because BOTH the
   INV-15-4 write-key derivation (record.ts) and the INV-15-3 record-hash
   computation (chain.ts) must share one deterministic encoder — two
   encoders would risk two orderings.
2. **"State: WRITTEN (terminal)" is materialized as existence.** A15 line 33
   lists State separately from Fields; adding a state field would violate
   "exactly these five semantic slots" (line 26). The record type exists
   only in written, deep-frozen form; the append is the WRITTEN transition;
   there is no second state to represent.
3. **INV-15-4's "subject operation id".** The kernel port carries no
   separate operation-id field; the operation's identity, as expressed
   through the port's own five slots (A15 line 27 defines `what` as
   "operation type and subject object ids"), is the derivation input — via
   the kernel identity module, exactly the route the work order names. The
   canonical identity is order-insensitive over subject ids and proof
   material (sorted in the derivation input; preserved verbatim in the
   written record), so a re-serialization of the same operation derives the
   same key.
4. **Two sequencings, both spec-named.** The submitter's protocol time
   (`when.sequence`, A15 line 28) is the operation's time at its owning
   authority; the log's total sequence (`proof.sequenceNumber`, A15 lines
   31-32 + 35-37) is the log's own order. Neither rewrites the other.
5. **Genesis predecessor sentinel.** Genesis (sequence 0) has no predecessor
   to hash; `GENESIS` is a non-hex sentinel so it can never be confused
   with a real 64-hex digest. INV-15-3's "from genesis" is the check site.
6. **recordId is not hashed into the record hash.** The hash covers content
   + chain position; id integrity is enforced by re-derivation during
   verification (a mutated id is caught by `RECORD_ID_MISMATCH`, a mutated
   content by `RECORD_HASH_MISMATCH` — independent coverage).
7. **The evidence area's verification vocabulary.** The four divergence
   classes (`SEQUENCE_MISMATCH`, `PREDECESSOR_HASH_MISMATCH`,
   `RECORD_HASH_MISMATCH`, `RECORD_ID_MISMATCH`) are the evidence area's own
   reason codes — A15 lines 41-42 give the Evidence Authority record-schema
   ownership, and line 30 requires outcomes to carry reason codes. Each
   class names the proof-slot field whose check failed; no other vocabulary
   was invented.
8. **Verification lifecycle records describe the log before their own
   append.** A run over height H is recorded as a record appended after
   those H records; the next run verifies it in turn. Honest by
   construction (a record cannot contain its own hash).
9. **No clock anywhere.** All wall times are caller-supplied
   (`createEvidenceLog({wallMs})`, `verifyAndRecord(wallMs)`) — GC-1
   determinism extended to the log; the log mints only the total sequence.
10. **The authority list is compile-time frozen; registry conformance is
    test-time.** Runtime code never imports `spec/` (a deployed image need
    not ship the spec tree); `registry-conformance.test.ts` re-reads
    `spec/registry/protocol-registry.json` and asserts the frozen list
    equals the registry's owning-authority set — a schema contradiction
    between A15 and the registry (a stop condition) fails loudly there.
11. **The log IS the port implementation.** `EvidenceLog` structurally
    satisfies the kernel's `EvidenceSubmission` (its single `submit` is the
    channel) and takes the synchronous `void` arm of the port's
    `void | Promise<void>` shape — the strongest form of A15's synchronous
    write discipline.
12. **A duplicate write is a no-op, not a failure.** A15 lines 62-64 fail
    the operation on a FAILED write; a duplicate INV-15-4 write means the
    operation's record already exists — its commit discipline is already
    satisfied — so the retry returns void silently.
13. **In-process log + durable schema demonstration (the work order's
    allowance).** The EvidenceLog is an in-process object store; the
    migration demonstrates the log's schema durably; the bridge
    (`writeEvidenceRecord`/`readEvidenceRecords`) is INSERT-only with
    `ON CONFLICT (write_key) DO NOTHING` — the substrate's own dedupe
    shape (DEP-003 §6) — and the INV-15-2 triggers close the boundary.
14. **The substrate's lifecycle events table is NOT the A15 log** (the
    work-order stop condition, honored by construction): the evidence store
    is its own database file (`var/evidence.sqlite`) with its own
    `evidence_records` table; substrate events stay substrate-owned
    (DEP-003 §11).
15. **Persistence evidence runs under the plain-Node harness.** Bun 1.3.14
    does not implement `node:sqlite` (verified), so the SQLite-touching
    cases live in `scripts/test_protocol_evidence.mjs` — the exact split the
    merged kernel practices (RTN-001's own store has no bun test for the
    same reason; `scripts/test_protocol_kernel.mjs` is its harness).
16. **`.gitignore` gained `var/`.** Mandated by spec/durable/execution.md
    §2 lines 41-43 ("Data is never committed: add `var/` to the
    repository's ignore rules"). The kernel's CONTRACT-REVIEW documents this
    same addition as delivered, but the git fact at the RTN-002 base shows
    `.gitignore` WITHOUT `var/` (commit cdc4d44 did not touch it) — this
    item completes it. Root-config addition, outside every forbidden
    surface.
17. **`commitWithEvidence` order: operation → record → result.** The record
    describes the operation's actual outcome, so the operation runs first;
    the result is delivered only through a successful write. The API shape
    makes "committed without record" unrepresentable.
18. **Tamper-detection boundary, stated honestly.** A pure verifier vouches
    only for the records it is given: interior mutation/deletion/reordering
    is detected at a determinable position, but a tail-truncated COPY
    presented as a whole log is indistinguishable by pure verification
    alone. In-process, truncation is unrepresentable (no delete path,
    frozen snapshots); in the durable store, DELETE is trigger-aborted.
    External head anchoring is a deployment concern (A15 lines 82-83).
19. **The work order's product-port citation is split across two files.**
    "src/lib/protocol/tracking-port.ts IntentEvidenceRecord" —
    `IntentEvidenceRecord` is declared in `src/lib/protocol/intent-port.ts`
    (lines 196-204); `tracking-port.ts` declares `EvidenceRecordView`
    (lines 131-153). Both shapes are mapped in PRODUCT-PORT-MAPPING.md; no
    product file was changed.

## Contract review table

Legend — v0.1 sources: `A15` =
`spec/architecture/v0.1/evidence-risk-compliance.md` (Area 15); `README` =
`spec/architecture/v0.1/README.md`; `core` =
`spec/architecture/v0.1/core.md`. Supporting: `REG` =
`spec/registry/protocol-registry.json`; `DEP-003` =
`spec/durable/execution.md`; `WO` =
`spec/protocol-runtime-work-orders/RTN-002.md`; `WAVE` =
`spec/protocol-runtime-work-orders/README.md`; `KERNEL` = the merged
RTN-001 kernel surface this module composes (`src/lib/protocol-runtime/
kernel/` — ports.ts, identity.ts, time.ts, persistence.ts).

### canonical.ts — the deterministic encoder (GC-1; INV-15-3; INV-15-4)

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 1 | `canonicalJson` | function | README §3 GC-1 lines 41-43: "Re-running any computation on identical inputs yields identical outputs" + A15 lines 54-55 (INV-15-3): "verification is a pure function of the log" | WO line 10 ("deterministic chain verification") | Sorted keys, safe-integer numbers only (GC-1 "no floating point anywhere"), undefined-as-absent, non-JSON values rejected |

### record.ts — the record type, authority vocabulary, validation, INV-15-4 derivation

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 2 | `EVIDENCE_AUTHORITIES` | const | A15 line 29: "authority: which protocol authority performed the operation." | REG lines 36-293 (every area's `owningAuthority`; A15 = "Evidence Authority" line 190); WO line 17 ("authority names are the registry's owning authorities") | 23 distinct names over 24 areas ("Rail Authority" owns A13+A23); frozen; test-pinned to the registry (decision 10) |
| 3 | `EVIDENCE_AUTHORITY_NAME` | const | A15 lines 41-42: "Evidence Authority (protocol layer, area 15) owns the log and record schema." | REG line 190 | The lifecycle records' authority |
| 4 | `EVIDENCE_LIFECYCLE_VOCABULARY` | const | A15 lines 70-74: "The log's own lifecycle events are also recorded (log genesis, verification runs). Verification results are recorded with the verified chain height and final hash." | — | genesis/verification operation types + GENESIS/VERIFIED/TAMPER_DETECTED results; frozen |
| 5 | `EvidenceRecord` | type | A15 lines 25-33: "EvidenceRecord — one immutable record per consequential operation. Fields (mandatory, exactly these five semantic slots)" | README §3 GC-5 lines 63-67 ("exactly one evidence record (area 15) with fields: what, when, authority, outcome, proof."); core.md §0 line 15 | Exactly five slots; WRITTEN as existence (decision 2); extends the kernel port types, no conflicting shape |
| 6 | `EvidenceRecordProof` | type | A15 lines 31-32: "proof: hashes, sequence numbers, and links to prior records required to verify the record." + lines 35-37: "Each record's proof includes the hash of its predecessor" | KERNEL ports.ts `EvidenceProof` | Kernel submitter material + the chain material (recordId, sequenceNumber, predecessorHash, recordHash) |
| 7 | `isEvidenceRecord` | function | A15 lines 26-33 (the five-slot contract re-checked field by field) | — | Runtime guard; validates read-back records and foreign values |
| 8 | `validateEvidenceSubmission` | function | A15 lines 26-33 + lines 62-64: "A failed write fails the operation" | README §3 GC-5 lines 63-67; REG (authority names) | Throws TypeError deterministically; exact five slots enforced; authority checked against the registry set |
| 9 | `canonicalSubmissionEncoding` | function | A15 line 27: "what: operation type and subject object ids." + INV-15-4 lines 56-58: "evidence write keys derived from the subject operation id" | KERNEL identity.ts `canonicalDerivationInput` (the unambiguous-encoding contract) | The submission-identity encoding the write key derives from; order-insensitive canonicalization (decision 3) |
| 10 | `evidenceWriteKey` | function | INV-15-4 A15 lines 56-58: "evidence write keys derived from the subject operation id prevent duplicate records for one operation" | KERNEL identity.ts `deriveIdempotencyKey` (INV-1-2/1-3 core.md lines 57-62; DEP-003 §6 lines 130-133) | `idem.v1.<sha256>`; duplicate detection at append and in the durable bridge |
| 11 | `evidenceRecordId` | function | A15 lines 31-32 (proof carries the ids "required to verify the record") + INV-15-4 lines 56-58 | KERNEL identity.ts `deriveProtocolId` (INV-3-3 core.md lines 182-184; INV-5-3 lines 310-312) | `pid.v1.<sha256>` derived from the write key; re-derived at verification |

### chain.ts — the hash chain and pure verification (INV-15-3)

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 12 | `EVIDENCE_CHAIN_FORMAT_VERSION` | const | INV-15-3 A15 lines 54-55: "the hash chain verifies deterministically from genesis" | KERNEL identity.ts `DERIVATION_FORMAT_VERSION` (versioned-input discipline, INV-4-3 core.md lines 248-249) | v1; inside the hashed payload |
| 13 | `GENESIS_PREDECESSOR_HASH` | const | A15 lines 35-37: "hash-chained log" + INV-15-3 lines 54-55: "verifies deterministically from genesis" | — | Non-hex sentinel (decision 5) |
| 14 | `EVIDENCE_VERIFICATION_REASON_CODES` | const | A15 line 30: "outcome: resulting state or decision, including reason codes." + lines 73-74 (verification results) | — | The four divergence classes; frozen (decision 7) |
| 15 | `computeRecordHash` | function | A15 lines 35-37: "Each record's proof includes the hash of its predecessor, making tampering detectable." + lines 31-32 (the proof material hashed) | README §3 GC-1 lines 39-43 | sha256 over canonical submission identity + chain position; recordId excluded (decision 6) |
| 16 | `verifyEvidenceChain` | function | INV-15-3 A15 lines 54-55: "the hash chain verifies deterministically from genesis; verification is a pure function of the log." | A15 lines 36-37 ("making tampering detectable"); lines 73-74 (height + final hash) | Pure; checks sequencing, predecessor link, hash re-computation, id re-derivation; returns verdict + verified height + final hash + first divergence |
| 17 | `ChainVerification` | type | A15 lines 73-74: "Verification results are recorded with the verified chain height and final hash." | INV-15-3 lines 54-55 | VERIFIED / TAMPER_DETECTED |
| 18 | `ChainDivergence` | type | A15 lines 36-37: "making tampering detectable" | — | First failing sequence number + class + deterministic detail |
| 19 | `ChainDivergenceProblem` | type | A15 lines 31-37 (the proof-slot fields whose checks fail) | — | The four classes (decision 7) |

### log.ts — the EvidenceLog, the port implementation, the coupling, lifecycle

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 20 | `EvidenceLog` | type | A15 lines 35-37: "EvidenceLog — append-only, totally sequenced, hash-chained log of EvidenceRecords." + lines 39-43: "All other authorities are writers-by-submission only; none can alter or suppress records." | INV-15-2 lines 51-53; INV-15-4 lines 56-58; KERNEL ports.ts `EvidenceSubmission` (decision 11) | No update/delete/clear/truncate member exists (INV-15-2 unrepresentable); structurally implements the port |
| 21 | `EvidenceLogOptions` | type | A15 line 28: "when: protocol time (sequenced) and recorded wall time." + lines 70-72 (genesis recorded) | KERNEL time.ts (no-clock discipline) | wallMs of genesis, caller-supplied (decision 9) |
| 22 | `createEvidenceLog` | function | A15 lines 70-72: "The log's own lifecycle events are also recorded (log genesis, ...)" + lines 35-37 (hash-chained from genesis) | INV-15-3 lines 54-55 | Writes the genesis record at sequence 0; deterministic in options |
| 23 | `commitWithEvidence` | function | A15 lines 62-64: "an operation is not committed until its record is written. A failed write fails the operation." | README §3 GC-5 lines 63-67; WO line 19 ("synchronous commit coupling exposed by this module") | operation → record → result; committed-without-record is unrepresentable (decision 17) |
| 24 | `verificationLifecycleSubmission` | function | A15 lines 70-74: "The log's own lifecycle events are also recorded (log genesis, verification runs). Verification results are recorded with the verified chain height and final hash." | — | Pure builder; also records TAMPER_DETECTED verdicts over durable read-backs |

### persistence.ts — the per-domain store and the durable bridge

| # | Export | Kind | v0.1 source (quoted line) | Supporting contracts | Notes |
|---|--------|------|---------------------------|----------------------|-------|
| 25 | `DEFAULT_EVIDENCE_DB_PATH` | const | README §9 lines 173-174: "This directory defines semantics only; it intentionally prescribes no implementation, storage, or service decomposition." | WAVE line 37 (persistence convention); DEP-003 §2 lines 40-43 (var/ default); KERNEL persistence.ts (the reference pattern) | `var/evidence.sqlite`; never committed (`.gitignore` gained `var/`, decision 16) |
| 26 | `EVIDENCE_MIGRATIONS_DIR_ENV_VAR` | const | README §9 lines 173-174 (storage not prescribed ⇒ configurable) | DEP-003 §2 lines 44-47 (PAYSWAP_MIGRATIONS_DIR mirror); KERNEL persistence.ts | `PAYSWAP_EVIDENCE_MIGRATIONS_DIR` |
| 27 | `EVIDENCE_MIGRATIONS_RELATIVE_DIR` | const | README §9 lines 173-174 | WAVE line 37: "per-domain migrations inside its owned prefix" | `src/lib/protocol-runtime/evidence/migrations` |
| 28 | `EVIDENCE_STORE_DOMAIN` | const | README §9 lines 173-174 | DEP-003 §11 lines 220-224 (owner identity discipline); KERNEL persistence.ts | `protocol-runtime-evidence` — NOT the substrate's `durable-substrate` (decision 14) |
| 29 | `EvidenceStoreOptions` | type | README §9 lines 173-174 | DEP-003 db module option shape; KERNEL persistence.ts `KernelStoreOptions` | dbPath + migrationsDir |
| 30 | `resolveEvidenceMigrationsDir` | function | README §9 lines 173-174 | DEP-003 §2/§4; substrate walk-up resolution (db.ts); KERNEL persistence.ts | explicit → env → walk-up → fail-closed |
| 31 | `openEvidenceStore` | function | README §9 lines 173-174 | WAVE line 37 ("using the DEP-003 database layer read-only"); WO Objective line 10; DEP-003 §3/§4 | Opens via `openDurableDatabase`; the evidence domain's instance of the convention |
| 32 | `EvidenceStoreWrite` | type | INV-15-4 A15 lines 56-58 ("prevent duplicate records") | DEP-003 §6 lines 125-133 (the `{created, reason}` dedupe-report shape) | created / reason / recordId |
| 33 | `writeEvidenceRecord` | function | INV-15-2 A15 lines 51-53: "the log is append-only; no record is modified or removed" + INV-15-4 lines 56-58 | A15 lines 62-64 (a failed write fails the operation); DEP-003 §6 (ON CONFLICT DO NOTHING) | INSERT-only; duplicates are no-ops; the schema's triggers enforce INV-15-2 at the boundary |
| 34 | `readEvidenceRecords` | function | A15 lines 35-37 (the chain survives persistence) + INV-15-3 lines 54-55 ("verification is a pure function of the log") | — | Reads back WRITTEN records in total sequence order; verifiable by the pure verifier |

## Supporting sources used (outside spec/architecture/v0.1/)

These bind the evidence domain to the substrate, the registry, and the wave
contracts WITHOUT defining protocol semantics:

- `spec/registry/protocol-registry.json` — the owning-authority names
  (lines 36-293; A15 "Evidence Authority" at line 190; the "Rail Authority"
  double-name at lines 168/282). Read at TEST time only.
- `spec/durable/execution.md` — the DEP-003 configuration (§2 lines 40-47,
  including the `var/` ignore mandate at lines 41-43), the migration
  contract (§4 lines 75-97), the deduplicated-enqueue shape mirrored by the
  durable bridge (§6 lines 125-133), and the substrate-event ownership
  boundary deliberately not crossed (§11 lines 215-224).
- `spec/protocol-runtime-work-orders/RTN-002.md` — the objective (line 10),
  acceptance (lines 12-19), and required evidence (line 23), including the
  in-process-log allowance and the stop conditions.
- `spec/protocol-runtime-work-orders/README.md` — the persistence
  convention (line 37) and the evidence discipline (line 39).
- The merged RTN-001 kernel (`src/lib/protocol-runtime/kernel/`) — the
  composed surface: `ports.ts` (the EvidenceSubmission port declaration this
  module implements), `identity.ts` (the derivation route INV-15-4 rides),
  `time.ts` (the protocol-time shape and no-clock discipline),
  `persistence.ts` (the per-domain store reference pattern).

## Forbidden-source compliance

No file under `spec/architecture/v0.1/`, `spec/architecture-change-requests/`,
`spec/product/`, `src/lib/protocol/`, `src/lib/durable/`, `src/components/`,
or `src/app/` was modified. `src/lib/durable/` is consumed read-only
(`openDurableDatabase` imported from `src/lib/durable/db.ts`). Root-config
additions outside any forbidden surface: `.gitignore` gained `var/`
(mandated by spec/durable/execution.md §2 lines 41-43 — see decision 16)
and `scripts/test_protocol_evidence.mjs` was added as this domain's
plain-Node evidence harness (the RTN-001 convention: its own harness script
`scripts/test_protocol_kernel.mjs` was added by commit cdc4d44). The kernel
(`src/lib/protocol-runtime/kernel/`) is consumed read-only and its tests
are untouched.
