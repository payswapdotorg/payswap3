# RTN-010 — Protocol gateway contract review

Work order: `spec/protocol-runtime-work-orders/RTN-010.md`
Owned surface: `src/lib/protocol-runtime/gateway/` (the protocol-gateway
component's in-process form) + `scripts/test_protocol_gateway.mjs`
Rule: **every exported type/function/constant maps to a cited
`spec/architecture/v0.1/` source (or the governing deployment/work-order
contracts that bind the gateway component); rows with no source are
forbidden.**

Method: each row lists the primary source (file, section, line, and the
quoted line that grounds the export) and, where needed, the supporting
contracts outside v0.1 that additionally bind the export (the kernel
declarations, the DEP-003 durable execution contract, the deployment
topology and component registry, the RTN wave rulings, the RTN-010 work
order itself). Quoted text is verbatim; line numbers refer to the files as
merged at the RTN-010 base (`main @ 4ac6792`).

Exported symbol count: **52** (30 runtime symbols enumerated from the
barrel's `export { ... }` statements — asserted mechanically by
`boundary.test.ts` — plus 22 exported types). Table rows: **52**. The
counts match.

## Recorded interpretation decisions and deviations

1. **The gateway is a runtime component, not a registry authority — and
   its evidence attribution follows the addressed authority.** The A15
   record's 'authority' slot names the OWNING (or addressed) authority,
   resolved to its `EVIDENCE_AUTHORITIES` member; the gateway never
   attributes to itself (no 'Protocol Gateway' name exists in the
   registry's closed set, and inventing one would be a silent semantic
   change — the Q4 ruling's own VOID reasoning applied to a 'Gateway
   Authority'). Grounds: rtn-plan-rulings.md Q4 (validation and refusal are
   per-command per owning authority) and deploy/contracts/components.json
   protocol-gateway ("the protocol authorities ... enforced inside a
   deployment-owned process; the sole admission point").
2. **Fail-closed on unattributable submissions.** A submission whose
   authority slot names no registry authority throws a TypeError instead
   of returning a typed rejection: an unrecorded typed refusal would be a
   consequential admission decision with no evidence record (RTN-010.md
   stop condition: "admission semantics that would bypass evidence
   records"), and recording it would require fabricating an authority
   (Q4). The kernel convention (input-shape violations throw) applies.
3. **No queue-failure reason code.** The durable enqueue is the
   admission's COMMIT step, not an admission decision: a failed enqueue
   fails the whole submitCommand operation (A15 lines 62-64 discipline),
   no receipt is recorded, the same-key retry is safe (queue dedupe), and
   the failure surfaces through the health functions
   ("durable-queue submit success" — components.json) instead of the
   admission reason vocabulary.
4. **The rails authority-name mismatch is mapped, not fixed.** The rails
   module's exported id is `'Rail Adapter Authority'`
   (RAIL_ADAPTER_AUTHORITY_ID); the registry's A13 name — and the member
   of EVIDENCE_AUTHORITIES — is `'Rail Authority'`. The gateway accepts
   BOTH as envelope authorities for the A13 command kinds (the kernel
   envelope's authority enumeration belongs to the registry projection;
   the module constant is what callers find in the merged code) and
   normalizes evidence attribution to `'Rail Authority'`. Recorded as a
   KNOWN LIMITATION: the rails module's own A15 records use the
   non-member name and will need reconciliation at RTN-012's composed
   integration (outside this item's owned surface).
5. **The receipt generalization mapping.** CommandReceipt.commandId =
   `deriveProtocolId('gateway-command', kind, idempotencyKey)` — the
   DEP-003 dedupe identity's two columns as derivation parts (one pair,
   one command id; a different kind under the same key is a different
   command). `state` is 'ADMITTED' (admission's single non-refusal state);
   `outcome` is 'ADMITTED' on first admission and 'DUPLICATE' when the
   queue's dedupe absorbed a re-submission after the gateway's in-memory
   receipt was lost (a process restart) — the honest outcome of THAT
   submission. In-process replays return the RECORDED receipt verbatim
   (INV-1-3's strongest reading, the intent authority's interpretation).
6. **Admission is stricter than the authorities, never looser — with one
   recorded exception.** Bodies must carry exactly the declared fields
   (typo'd fields are malformed commands); cross-field invariants the
   authorities enforce at entry (queues' INV-8-1 terms linkage, the GC-3
   payload.instructionId link, obligations' distinct-participants rule)
   are enforced at admission. The exception: `clearing.record.add`'s
   `amount` is deliberately NOT shape-checked — the Clearing Authority
   defers amount validation to its stage-time QUARANTINE flow (a domain
   semantic admission must not preempt; INVALID_MONEY_*, ZERO_AMOUNT, and
   SELF_PARTY would become unreachable through the gateway).
7. **Port-bearing commands admit their JSON data; the transition runtime
   binds the ports.** `settlement.attempt.submit`, `settlement.attempt.
   railoutcome.apply`, and `rails.operation.submit` require live
   `RailAdapterConnection` objects that are not JSON-representable; the
   gateway admits the command's data portion (instructionId /
   operationId) and RTN-011 binds the connection server-side. The kinds
   and their mapping are documented in COMMAND-SURFACE.md.
8. **The risk authority's caller-supplied `when` travels in the body.**
   The risk commands take `when: ProtocolTime` per call (the authority has
   no clock); the command body carries it (the self-contained-body rule:
   the body is the authority method's full JSON-representable input), and
   the envelope's protocolTime remains the submission's own admission
   time.
9. **`reconciliation` has no `authority.ts`-style class of its own in the
   registry mapping** — A14's command surface is
   `ReconciliationAuthority` (rails/reconciliation.ts), registered under
   its exported `RECONCILIATION_AUTHORITY_ID`. A13 and A14 both live in
   the rails module; the registry keeps them as separate authority
   entries (the registry's area split).
10. **`noSubjects` and `subjectFields` are exported** because
    CommandSpec's subject binding is part of the documented command
    surface (RTN-010.md line 10: subject validation per owning authority);
    future kind additions (RTN wave 2) compose them.
11. **The in-surface queue double.** Bun 1.3.14 does not implement
    node:sqlite, so the bun suites exercise the gateway against an
    in-surface double of the CommandQueuePort with identical dedupe
    semantics; the REAL DurableQueue integration (real SQLite, real
    UNIQUE (idempotency_key, kind) rows, real cross-restart dedupe) is
    proven by `scripts/test_protocol_gateway.mjs` under plain Node — the
    merged evidence-suite convention (the same split every RTN domain
    observes).
12. **The gateway's own domain store follows the per-domain persistence
    convention** (RTN-001's decision; openKernelStore is the reference):
    `var/gateway.sqlite`, migrations inside the gateway prefix, opened
    through the DEP-003 db layer read-only. The gateway class itself holds
    in-memory receipt state (the authorities' in-process single-writer
    precedent); the durable receipt rows are the deployment root's
    composition, mirroring intent_receipts' PRIMARY KEY on the key.

## Exported-symbol table

| # | Export | Kind | Source (quoted line) | Supporting | Notes |
|---|--------|------|----------------------|------------|-------|
| 1 | `GATEWAY_ADMISSION_REASON_CODES` | const | RTN-010.md line 10: "rejection reason codes for invalid/unauthorized commands" | line 14: "admitted or rejected with a deterministic reason code"; kernel reason-codes.ts (the frozen-vocabulary convention) | 5 members, frozen |
| 2 | `GatewayAdmissionReasonCode` | type | RTN-010.md line 10 | — | Closed union of row 1 |
| 3 | `isGatewayAdmissionReasonCode` | function | RTN-010.md line 14 | kernel isSharedReasonCode (guard convention) | Runtime guard |
| 4 | `FieldProblem` | interface | RTN-010.md line 14 (deterministic reason codes — the per-field problem shape) | GC-1 (README.md §3 lines 39-43) | path + problem |
| 5 | `FieldCheck` | type | RTN-010.md line 10: "command validation against each authority's command schema" | GC-1 | `unknown -> true \| FieldProblem` |
| 6 | `FieldSpec` | type | RTN-010.md line 10 | — | required or optional field |
| 7 | `OptionalField` | interface | RTN-010.md line 10 (the authorities' optional parameters) | core.md line 40 (optional fields precedent) | the `optional(...)` wrapper |
| 8 | `BodyInvariant` | type | RTN-010.md line 10 (the authorities' cross-field entry checks) | queues/authority.ts enqueueItem INV-8-1 linkage | applied after fields |
| 9 | `BodyValidation` | type | RTN-010.md line 14 | GC-1 | first-failure field + problem |
| 10 | `GATEWAY_ADMISSION_STATES` | const | core.md lines 43-44: "IntentReceipt — idempotent response object: intent id, current state, and recorded outcome for the submitted idempotency key." | RTN-010.md line 10 (generalized) | `['ADMITTED']` |
| 11 | `GatewayAdmissionState` | type | core.md lines 43-44 | RTN-010.md line 10 | 'ADMITTED' |
| 12 | `GATEWAY_ADMISSION_OUTCOMES` | const | core.md lines 43-44 ("recorded outcome") | spec/durable/execution.md §6 lines 125-129 (the dedupe no-op) | ADMITTED, DUPLICATE |
| 13 | `GatewayAdmissionOutcome` | type | core.md lines 43-44 | §6 | closed union |
| 14 | `CommandReceipt` | interface | core.md lines 43-44 | INV-1-3 (lines 60-62); RTN-010.md line 15 | the generalized IntentReceipt |
| 15 | `commandReceiptId` | function | INV-1-3 (core.md lines 60-62): "re-submission with a recorded idempotency key returns the recorded receipt" | spec/durable/execution.md §6 lines 125-133 (UNIQUE (idempotency_key, kind)); kernel identity.ts | deriveProtocolId('gateway-command', kind, key) |
| 16 | `commandReceipt` | function | core.md lines 43-44, 60-62 | RTN-010.md line 15 | mint (frozen) |
| 17 | `isCommandReceipt` | function | core.md lines 43-44 | — | runtime guard |
| 18 | `CommandSpec` | interface | RTN-010.md line 10: "command validation against each authority's command schema" | rtn-plan-rulings.md Q4 (per-command per owning authority) | kind, authority, fields, invariants, subjects |
| 19 | `AuthorityCommands` | interface | RTN-010.md line 10 | kernel/envelope.ts (the authority-name enumeration); evidence/record.ts EVIDENCE_AUTHORITIES | authority + evidenceAuthority + commands |
| 20 | `SubjectResolver` | type | kernel/envelope.ts: "subjectIds — the subject object ids this command addresses" | A15 line 27 ("what: operation type and subject object ids") | body -> SubjectResolution |
| 21 | `SubjectResolution` | type | kernel/envelope.ts (subjectIds) | rtn-plan-rulings.md Q4 ("including subject ids") | ok-subjectIds \| problem |
| 22 | `subjectFields` | function | kernel/envelope.ts (subjectIds) | per-authority command shapes | the common resolver |
| 23 | `noSubjects` | const | kernel/envelope.ts: "may be empty: e.g. scheduler tick commands address no prior subject object" | — | empty binding |
| 24 | `GATEWAY_COMMAND_AUTHORITIES` | const | RTN-010.md line 14: "Every authority command kind is admitted or rejected" | the merged authorities A01-A14, A16 (wave README); spec/registry/protocol-registry.json | 16 entries (incl. the A13 alias), frozen |
| 25 | `GATEWAY_ENVELOPE_AUTHORITIES` | const | kernel/envelope.ts: "the authority-name enumeration belongs to the registry projection ... RTN-010 validates per-command per owning authority" | spec/registry/protocol-registry.json | the 16 command-authority ids |
| 26 | `GATEWAY_EVIDENCE_AUTHORITY_BY_ENVELOPE` | const | evidence-risk-compliance.md lines 41-43: "All other authorities are writers-by-submission only" | evidence/record.ts EVIDENCE_AUTHORITIES; decision 4 | envelope -> evidence name |
| 27 | `GATEWAY_COMMAND_KIND_COUNT` | const | RTN-010.md line 14 ("Every authority command kind") | — | 112 |
| 28 | `findAuthorityCommands` | function | RTN-010.md line 10 | — | registry lookup |
| 29 | `findCommandSpec` | function | RTN-010.md lines 10, 14 | — | (authority, kind) lookup |
| 30 | `GATEWAY_EVIDENCE_VOCABULARY` | const | RTN-010.md line 16: "Rejected commands are recorded as evidence (admission decisions are consequential records)" | A15 lines 26-32 (the slots the type occupies) | GATEWAY_COMMAND_REJECTED / REJECTED |
| 31 | `GATEWAY_UNKNOWN_SUBJECT_TOKEN` | const | A15 line 27: "what: operation type and subject object ids" | GC-1 (deterministic placeholders) | 'unknown' |
| 32 | `resolveEvidenceAuthority` | function | A15 line 29: "authority: which protocol authority performed the operation." | rtn-plan-rulings.md Q4 (no invented authorities); decision 2 | the attribution resolver |
| 33 | `commandRejectedEvidence` | function | RTN-010.md line 16 | A15 lines 26-32 (five slots); GC-5 (README.md §3 lines 63-67) | the rejection record builder |
| 34 | `submitGatewayEvidence` | function | A15 lines 62-64: "an operation is not committed until its record is written. A failed write fails the operation." | kernel/ports.ts EvidenceSubmission | awaits thenable arms |
| 35 | `CommandQueuePort` | interface | spec/durable/execution.md §6 lines 125-133: "enqueue(kind, payload, { idempotencyKey, ... })" | topology.md (the durable command path node) | the enqueue slice |
| 36 | `CommandQueueEnqueueOutcome` | interface | spec/durable/execution.md §6 lines 125-129: "exactly ONE row; the second call returns created: false with the existing job" | — | created, reason, jobId |
| 37 | `commandQueuePortFromDurableQueue` | function | spec/protocol-runtime-work-orders/README.md: "src/lib/durable/ (read-only integration: import + register()/db API)" | spec/durable/execution.md §6 | the real-queue binding |
| 38 | `CommandAdmissionResult` | type | RTN-010.md lines 14-15 | core.md lines 43-44, 60-62 | accepted \| typed refusal |
| 39 | `ProtocolGatewayDeps` | interface | RTN-010.md line 10 (the evidence port; the durable submission path) | the merged wallClock convention | evidence, queue, wallClock? |
| 40 | `GatewayHealthSnapshot` | interface | deploy/contracts/components.json protocol-gateway health_signal: "Readiness endpoint; command acceptance rate and latency; durable-queue submit success" | RTN-010.md line 18 | the programmatic health form |
| 41 | `ProtocolGateway` | class | topology.md line 231: "There is exactly one protocol-command admission point (protocol-gateway)" | deploy/contracts/components.json ("the sole admission point for protocol commands"); RTN-010.md lines 10, 14-18 | submitCommand / getReceipt / isReady / health |
| 42 | `DEFAULT_GATEWAY_DB_PATH` | const | spec/protocol-runtime-work-orders/README.md "Persistence convention" (per-domain stores) | spec/durable/execution.md §2 lines 40-43 | var/gateway.sqlite |
| 43 | `GATEWAY_MIGRATIONS_DIR_ENV_VAR` | const | spec/durable/execution.md §2 lines 44-47 (the env-var convention) | kernel persistence.ts precedent | PAYSWAP_GATEWAY_MIGRATIONS_DIR |
| 44 | `GATEWAY_MIGRATIONS_RELATIVE_DIR` | const | spec/protocol-runtime-work-orders/README.md "Persistence convention" ("migrations inside its owned prefix") | — | the gateway prefix's migrations dir |
| 45 | `GATEWAY_STORE_DOMAIN` | const | spec/protocol-runtime-work-orders/README.md "Persistence convention" | kernel KERNEL_STORE_DOMAIN precedent | 'protocol-runtime-gateway' |
| 46 | `resolveGatewayMigrationsDir` | function | spec/durable/execution.md §2/§4 (resolution order: explicit, env, walk-up) | kernel resolveKernelMigrationsDir (the reference) | 8-level walk-up |
| 47 | `GatewayStoreOptions` | interface | spec/protocol-runtime-work-orders/README.md "Persistence convention" | kernel KernelStoreOptions precedent | dbPath, migrationsDir |
| 48 | `openGatewayStore` | function | spec/protocol-runtime-work-orders/README.md "Persistence convention" ("using the DEP-003 database layer read-only") | spec/durable/execution.md §3/§4; RTN-010.md evidence | opens via openDurableDatabase |
| 49 | `StoredCommandReceipt` | interface | core.md lines 43-44 (the receipt fields) | spec/durable/execution.md §6 ((kind, key) identity) | + kind, key, jobId |
| 50 | `GatewayReceiptWrite` | interface | INV-1-3 (core.md lines 60-62: one recorded receipt per key) | evidence persistence writeEvidenceRecord precedent | written \| duplicate-no-op |
| 51 | `writeCommandReceipt` | function | INV-1-3 (core.md lines 60-62) | the per-domain persistence convention | INSERT-only, PK (kind, key) |
| 52 | `readCommandReceipts` | function | core.md lines 60-62 ("returns the recorded receipt") | intent persistence readIntentReceipts precedent | deterministic order |

## Verification of this review

- `boundary.test.ts` asserts the barrel's runtime export list equals the
  30 symbols enumerated above (parsed from index.ts — the persistence
  module binds node:sqlite, which bun does not implement) and that the 22
  type exports are present as statements: 30 + 22 = 52 rows.
- `bunx tsc --noEmit`: 0 errors. `bun test`: 1840 pass (992 in this
  surface). `node scripts/test_protocol_gateway.mjs`: all five evidence
  cases pass. `bun run build`: green. All ten merged evidence suites:
  pass. All three validators (`validate_deployment.py`,
  `validate_durable.py`, `validate_governance.py`): PASS.
