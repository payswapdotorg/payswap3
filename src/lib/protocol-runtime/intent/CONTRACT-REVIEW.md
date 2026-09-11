# RTN-005 — Intent Authority contract review

Work order: `spec/protocol-runtime-work-orders/RTN-005.md`
Owned surface: `src/lib/protocol-runtime/intent/` (area 1 — A01)
Rule: **every exported type/function/constant maps to a cited
`spec/architecture/v0.1/` source; rows with no source are forbidden.**

Method: each row lists the primary `spec/architecture/v0.1/` source (file,
section, line, and the quoted line that grounds the export) and, where
needed, the supporting contracts outside v0.1 that additionally bind the
export (the kernel declarations, the A15/A16 contracts in
evidence-risk-compliance.md, the RTN wave conventions, the registry
projection). Quoted text is verbatim from the frozen v0.1 directory; line
numbers refer to the files as merged at the RTN-005 base
(`main @ 54b12ff`).

Exported symbol count: **52** (38 runtime symbols enumerated from
`intent.ts` at load + 14 exported types). Table rows: **52**. The counts
match.

## Recorded interpretation decisions and deviations

1. **The transition table extends the linear chain with the same area's
   failure and change contracts.** core.md lines 34-37 give the happy path
   `DRAFT -> AUTHORIZED -> ROUTED -> FULFILLING -> terminal(FULFILLED |
   FAILED | CANCELLED)`; two contracts in the SAME area add edges the chain
   does not spell out: lines 67-69 ("If routing or fulfillment later fails,
   the intent moves to FAILED") add AUTHORIZED/ROUTED -> FAILED, and INV-1-1
   (lines 54-56, "Any change after authorization requires a new intent; the
   old intent moves to CANCELLED") adds AUTHORIZED/ROUTED/FULFILLING ->
   CANCELLED. DRAFT's only exit is AUTHORIZED (no contract cancels or fails
   a draft). Terminals have empty successor sets — "a failed or cancelled
   intent cannot be restarted" is structural.
2. **The intent id is derived from the submitted idempotency key.** One
   idempotency key collapses to one intent (INV-1-2/1-3), so
   `deriveProtocolId('intent', key)` is the deterministic 1:1 identity; a
   retry (a different key) is a new id linked via `priorIntentId`
   ("A retry is a new intent linked to the prior intent id", line 37).
3. **The IntentReceipt is RECORDED once per key and replayed verbatim.**
   core.md lines 43-44 name "intent id, current state, and recorded outcome
   for the submitted idempotency key"; INV-1-3 says re-submission "returns
   the recorded receipt". Interpretation: "current state" is the state
   current at recording, and replay returns the recorded receipt verbatim
   (Stripe-style idempotency-replay semantics) — the strongest reading of
   "returns the recorded receipt; it never creates a second intent or a
   second financial effect". The recorded outcome is 'DRAFT' (the
   INTENT_CREATED outcome, line 75).
4. **INV-1-1 is enforced structurally, not by a guard.** There is NO
   command on the surface that mutates a descriptor or any monetary term;
   the only path to different terms is a new intent (new key) plus
   cancelling the old one. `PaymentIntent.descriptor` is the same frozen
   object across every transition (the pure transition table asserts this).
5. **One evidence record per consequential operation, exactly the named
   set.** A01's "Evidence produced" names exactly INTENT_CREATED,
   INTENT_AUTHORIZED, INTENT_STATE_CHANGED: creation -> INTENT_CREATED,
   authorization -> INTENT_AUTHORIZED (with the policy decision id as
   proof), every later transition -> INTENT_STATE_CHANGED. No
   INTENT_CANCELLED or other operation type is invented. Refused commands
   (typed rejections, gate blocks) emit NO evidence — they mutate nothing,
   and GC-5 covers operations that create/mutate/resolve state.
6. **The compliance gate is an injected port over RTN-003's verdict
   type.** `IntentAuthorizationGate` is `(subjectId) => ComplianceGateVerdict`
   (type-only import from `../risk/gate.ts` — no runtime coupling); the
   composition root wires risk's `evaluateComplianceGate` / the composed
   authority's `checkGate`. The gate is called INSIDE the per-intent-id
   serialization, before the transition: no AUTHORIZED without a terminal
   APPROVED record for the intent subject (INV-16-3, lines 129-131 of
   evidence-risk-compliance.md; core.md lines 84-85).
7. **Commands are async and await the evidence submission.** The kernel
   port's shape is `void | Promise<void>`; awaiting the synchronous real-log
   submit still yields a microtask boundary, which makes the INV-1-2
   concurrency surface real (concurrent commands genuinely interleave at
   the evidence await) and makes the keyed serializer load-bearing rather
   than decorative.
8. **The state layer is an in-process single writer** (the RTN-002
   in-process-object-store precedent, RTN-002 work order merged at this
   base), so the full command discipline (serialization, collapse, gate
   coupling, real-log evidence) runs under `bun test` — Bun 1.3.14 does not
   implement node:sqlite. The durable side is the per-domain persistence
   module (owned migrations + bridge functions, the RTN-002 split),
   exercised by `scripts/test_protocol_authorities.mjs` under plain Node.
9. **`protocolTime` is re-exported from state-machine.ts** as a
   convenience seam for conformance suites (a kernel re-export, cited to
   the kernel module, not to v0.1 A01).

## Exported-symbol table

| # | Export | Kind | v0.1 source (quoted line) | Supporting | Notes |
|---|--------|------|---------------------------|------------|-------|
| 1 | `INTENT_STATES` | const | core.md lines 34-35: "States: DRAFT -> AUTHORIZED -> ROUTED -> FULFILLING -> terminal(FULFILLED | FAILED | CANCELLED)." | — | Frozen 7-member vocabulary |
| 2 | `IntentState` | type | core.md lines 34-36 | — | Closed union; 3 terminals |
| 3 | `INTENT_TRANSITIONS` | const | core.md lines 36-37: "Transitions are one-way; a failed or cancelled intent cannot be restarted." | INV-1-1 (lines 54-56); lines 67-69 | Decision 1: chain + area's own failure/cancel edges |
| 4 | `isIntentState` | function | core.md lines 34-36 | — | Runtime guard |
| 5 | `canTransitionIntent` | function | core.md lines 36-37 | — | Table predicate |
| 6 | `INTENT_REASON_CODES` | const | core.md lines 67-69: "the intent moves to FAILED with a machine readable reason code" | line 77 ("with reason code"); lines 127-128 (POLICY_UNSATISFIABLE); §4 lines 253-254 (NO_VIABLE_ROUTE) | 5 members, each flow-cited; frozen |
| 7 | `IntentReasonCode` | type | core.md lines 67-69 | — | Closed union |
| 8 | `isIntentReasonCode` | function | core.md lines 67-69 | — | Runtime guard |
| 9 | `EndpointDescriptor` | interface | core.md line 40: "source and destination descriptors" | A03 lines 154-155 (corridor currencies/geographies) | Currency + geography + opaque account |
| 10 | `DemandConstraints` | interface | core.md line 40: "constraints (deadline, allowed rails, cost ceiling)" | — | Field list verbatim |
| 11 | `DemandDescriptor` | interface | core.md lines 39-41: "DemandDescriptor — immutable attachment created at DRAFT: amount (Money), source and destination descriptors, constraints (...), idempotency key." | — | Exactly the named fields |
| 12 | `PaymentIntent` | interface | core.md lines 33-37: "PaymentIntent — durable statement of demand." | lines 39-41; line 37 (priorIntentId); line 76 (policyDecisionId) | Carries the immutable descriptor + retry link |
| 13 | `IntentReceipt` | interface | core.md lines 43-44: "IntentReceipt — idempotent response object: intent id, current state, and recorded outcome for the submitted idempotency key." | INV-1-3 (lines 60-62) | Decision 3: recorded verbatim, replayed |
| 14 | `INTENT_REJECTION_CODES` | const | core.md lines 74-78 (the exhaustive named evidence set) | rails typed-rejection convention | 4 typed rejection codes; no invented evidence |
| 15 | `IntentRejectionCode` | type | core.md lines 74-78 | — | Closed union |
| 16 | `IntentSubmissionResult` | type | core.md lines 43-44 | INV-1-2/INV-1-3 (lines 57-62) | Receipt + replayed flag |
| 17 | `IntentTransitionResult` | type | core.md lines 33-37 | lines 84-85 (gate coupling) | Typed rejection on refusal |
| 18 | `DEMAND_DESCRIPTOR_HASH_FORMAT_VERSION` | const | core.md lines 74-75: "proof: submitted descriptor hash" | README.md §3 GC-1 lines 39-43 | `ddh.v1.` prefix |
| 19 | `endpointDescriptor` | function | core.md line 40 | — | Validating mint |
| 20 | `demandConstraints` | function | core.md line 40 | GC-1 (README.md §3 lines 39-43) | Sorted/deduped rails |
| 21 | `demandDescriptor` | function | core.md lines 39-41 | — | The single mint; deep-frozen |
| 22 | `canonicalDemandDescriptor` | function | core.md lines 74-75 | GC-1 | Kernel type-tagged encoding |
| 23 | `demandDescriptorHash` | function | core.md lines 74-75: "proof: submitted descriptor hash" | — | sha256; feeds INTENT_CREATED proof |
| 24 | `demandDescriptorEquals` | function | core.md lines 39-41 | GC-1 | Field-by-field equality |
| 25 | `transitionPaymentIntent` | function | core.md lines 36-37 | INV-1-1 (lines 54-56); lines 67-69 | Pure; descriptor rides verbatim |
| 26 | `requiresReasonCode` | function | core.md lines 67-69, 77 | — | FAILED/CANCELLED require codes |
| 27 | `checkIntentReasonCode` | function | core.md lines 67-69 | — | Vocabulary validation |
| 28 | `draftPaymentIntent` | function | core.md lines 33-41 | — | Test helper (DRAFT mint) |
| 29 | `protocolTime` | re-export | (kernel time.ts; A15 line 28: "when: protocol time (sequenced) and recorded wall time") | kernel/time.ts | Convenience seam (decision 9) |
| 30 | `KeyedSerializer` | class | INV-1-2 (core.md lines 57-59): "state transitions are serialized per intent id. Concurrent submissions carrying the same idempotency key collapse to one intent and one receipt." | — | Per-key async total order |
| 31 | `INTENT_AUTHORITY_ID` | const | core.md line 75: "authority: Intent Authority" | registry A01 "owningAuthority": "Intent Authority" | The 'authority' slot value |
| 32 | `INTENT_EVIDENCE_VOCABULARY` | const | core.md lines 74-78 (the named set) | — | Exactly the 3 named types |
| 33 | `intentCreatedEvidence` | function | core.md lines 74-75: "INTENT_CREATED (what: intent terms; when; authority: Intent Authority; outcome: DRAFT; proof: submitted descriptor hash)." | A15 lines 26-32; GC-5 | Five slots exact |
| 34 | `intentAuthorizedEvidence` | function | core.md line 76: "INTENT_AUTHORIZED (outcome: AUTHORIZED; proof: policy decision id)." | A15 lines 26-32, 31-32 | Decision id as prior-record link |
| 35 | `intentStateChangedEvidence` | function | core.md line 77: "INTENT_STATE_CHANGED (one record per transition, with reason code)." | lines 67-69 (failing-record link) | Reason code in outcome |
| 36 | `submitIntentEvidence` | function | A15 lines 62-64: "an operation is not committed until its record is written. A failed write fails the operation." | kernel ports.ts | Submit-then-commit coupling |
| 37 | `IntentAuthority` | class | core.md lines 48-50: "Intent Authority (protocol layer, area 1). Sole writer of PaymentIntent state." | INV-1-1/1-2/1-3; lines 67-70; lines 84-85 | The command surface |
| 38 | `IntentAuthorizationGate` | type | core.md lines 84-85: "area 16 for compliance gating before AUTHORIZED" | A16 INV-16-3 (evidence-risk-compliance.md lines 129-131) | Injected gate port (decision 6) |
| 39 | `IntentAuthorityDeps` | type | core.md lines 48-50 | A15 lines 62-64; lines 84-85 | evidence + gate + wallClock |
| 40 | `DEFAULT_INTENT_DB_PATH` | const | (persistence convention; v0.1 prescribes no storage — README.md §9 lines 173-174) | spec/durable/execution.md §2 lines 40-43; wave README "Persistence convention" | var/intent.sqlite |
| 41 | `INTENT_MIGRATIONS_DIR_ENV_VAR` | const | (same) | spec/durable/execution.md §2 lines 44-47 | PAYSWAP_INTENT_MIGRATIONS_DIR |
| 42 | `INTENT_MIGRATIONS_RELATIVE_DIR` | const | (same) | wave README "Persistence convention" | Owned prefix migrations |
| 43 | `INTENT_STORE_DOMAIN` | const | (same) | wave README "Persistence convention" | protocol-runtime-intent |
| 44 | `resolveIntentMigrationsDir` | function | (same) | spec/durable/execution.md §2/§4 | Explicit > env > walk-up > fail-closed |
| 45 | `openIntentStore` | function | (same) | spec/durable/execution.md §3/§4; kernel/persistence.ts reference pattern | openDurableDatabase + owned migrations |
| 46 | `IntentStoreOptions` | type | (same) | substrate DurableDatabaseOptions shape | dbPath + migrationsDir |
| 47 | `IntentStoreWrite` | type | (same) | INV-1-2/INV-1-3 (core.md lines 57-62); DEP-003 §6 dedupe-report shape | created + reason |
| 48 | `writePaymentIntent` | function | core.md lines 33-41 (the persisted record) | INV-1-2/INV-1-3 (lines 57-62) | INSERT-only; UNIQUE key collapse |
| 49 | `writeIntentState` | function | core.md lines 34-37 (the one-way transitions persisted) | lines 76-77 | UPDATE state + times |
| 50 | `writeIntentReceipt` | function | core.md lines 43-44 | INV-1-3 (lines 60-62) | One receipt row per key |
| 51 | `readPaymentIntents` | function | core.md lines 33-41 | GC-1 (README.md §3 lines 39-43) | Re-minted Money on read |
| 52 | `readIntentReceipts` | function | core.md lines 43-44 | INV-1-3 | Reconstructed frozen receipts |
