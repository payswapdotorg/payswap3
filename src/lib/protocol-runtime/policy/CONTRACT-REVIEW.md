# RTN-005 — Fulfillment Policy Authority contract review

Work order: `spec/protocol-runtime-work-orders/RTN-005.md`
Owned surface: `src/lib/protocol-runtime/policy/` (area 2 — A02)
Rule: **every exported type/function/constant maps to a cited
`spec/architecture/v0.1/` source; rows with no source are forbidden.**

Method: each row lists the primary `spec/architecture/v0.1/` source (file,
section, line, and the quoted line that grounds the export) and, where
needed, the supporting contracts outside v0.1 that additionally bind the
export. Quoted text is verbatim from the frozen v0.1 directory; line
numbers refer to the files as merged at the RTN-005 base
(`main @ 54b12ff`).

Exported symbol count: **63** (45 runtime symbols enumerated from
`policy.ts` at load + 18 exported types). Table rows: **63**. The counts
match.

## Recorded interpretation decisions and deviations

1. **The policy document's field list is the purpose section's list.**
   core.md lines 91-93 define what a policy selects: "allowed rails,
   ordering, cost ceilings, deadlines, and fallback preferences" — the
   definition carries exactly those five fields. v0.1 prescribes no
   concrete ordering semantics, so the two orderings (`COST_ASC`,
   `TIER_DESC`) are documented deterministic total orders (final
   tie-break always the capability id — INV-2-1's purity requires a total
   order over the ranked list). This is the minimal concrete semantics the
   "ranked route requirements" (line 105) content requires.
2. **The evaluation's concrete filter and merge semantics.** v0.1 fixes the
   evaluation as "a pure function of (policy version, intent terms,
   capability snapshot)" (INV-2-1) with contents "ranked route
   requirements, constraint envelope, cost ceiling, deadline" (lines
   105-106). Concrete semantics (all integer or set-theoretic): candidates
   are ACTIVE snapshot capabilities (A03 lines 157-158 — degraded accept no
   commitments) on the policy ∩ intent allowed rails, with the exact
   corridor match, cost within the merged ceiling, and available capacity
   covering the intent amount; the envelope merges the rail intersection,
   ordering, and fallback preference; the ceiling is min(policy, intent) by
   `compareMoney`; the deadline is min(policy, intent) in integer
   milliseconds. Empty result -> POLICY_UNSATISFIABLE (lines 127-128).
3. **Attachment is 1:1.** "a policy attached to an intent is fixed for that
   intent" (lines 99-100): a policy version attaches to exactly one intent
   (ATTACHED carries `attachedIntentId`; re-attach elsewhere is refused),
   and an intent carries at most one attached policy. Both directions are
   enforced (and structural in the store's partial unique index).
4. **One evidence record per consequential operation, exactly the named
   set.** A02's "Evidence produced" names exactly POLICY_ATTACHED and
   POLICY_EVALUATED. Authoring and versioning emit NO evidence (the
   RTN-003 rule-lifecycle precedent: an area's named set is exhaustive; no
   POLICY_AUTHORED type exists in the spec, none is invented). The
   unsatisfiable evaluation DOES emit POLICY_EVALUATED — the failure is the
   area's reason-coded consequential decision (lines 127-128). EVALUATED ->
   CONSUMED emits no separate record (not in the named set; recorded here).
5. **The snapshot dependency is type-only.** "Depends on area 3 for the
   capability snapshot format" (lines 141-142) is satisfied by the
   CapabilitySnapshot TYPE (type-only import from
   `../capability/types.ts` — no runtime coupling, no cycle); the snapshot
   arrives as a value. The intent's terms likewise arrive as a value
   (`IntentTerms`) — the pure function takes no dependency on the Intent
   Authority.
6. **The policy version keying follows the risk-rule precedent.** The
   AUTHORED draft is version 0 (one open draft per policy identity);
   publishing assigns the next integer version as a new immutable row —
   "versioned, immutable policy document" (lines 97-99).
7. **The state layer is an in-process single writer** (the RTN-002
   precedent — see intent/CONTRACT-REVIEW.md decision 8): the authority
   runs under `bun test`; the durable side is persistence.ts + owned
   migrations, exercised by `scripts/test_protocol_authorities.mjs`.
8. **Evaluation commands are serialized per derived evaluation id**
   (INV-2-3's key) — the same keyed-async-serializer discipline as INV-1-2,
   because the evidence await is a real microtask boundary.

## Exported-symbol table

| # | Export | Kind | v0.1 source (quoted line) | Supporting | Notes |
|---|--------|------|---------------------------|------------|-------|
| 1 | `POLICY_STATES` | const | core.md lines 98-99: "Lifecycle: AUTHORED -> VERSIONED -> ATTACHED." | — | Frozen 3-member vocabulary |
| 2 | `PolicyState` | type | core.md lines 98-100 | — | ATTACHED is terminal |
| 3 | `POLICY_TRANSITIONS` | const | core.md lines 98-100: "No further state changes; a policy attached to an intent is fixed for that intent." | — | Exact lifecycle |
| 4 | `isPolicyState` | function | core.md lines 98-99 | — | Runtime guard |
| 5 | `canTransitionPolicy` | function | core.md lines 98-100 | — | Table predicate |
| 6 | `POLICY_EVALUATION_STATES` | const | core.md lines 104-105: "States: EVALUATED -> CONSUMED." | — | Exact machine |
| 7 | `PolicyEvaluationState` | type | core.md lines 104-105 | — | CONSUMED terminal |
| 8 | `POLICY_EVALUATION_TRANSITIONS` | const | core.md lines 104-105 | — | The one edge |
| 9 | `isPolicyEvaluationState` | function | core.md lines 104-105 | — | Runtime guard |
| 10 | `canTransitionPolicyEvaluation` | function | core.md lines 104-105 | — | Table predicate |
| 11 | `POLICY_ORDERINGS` | const | core.md lines 91-93: "ordering" (of the fulfillment shape) | INV-2-1 (lines 115-117) | 2 deterministic total orders (decision 1) |
| 12 | `PolicyOrdering` | type | core.md lines 91-93 | — | Closed union |
| 13 | `isPolicyOrdering` | function | core.md lines 91-93 | — | Runtime guard |
| 14 | `POLICY_REASON_CODES` | const | core.md lines 127-128: "failures are reason-coded (POLICY_UNSATISFIABLE)" | — | Exactly the one named code |
| 15 | `PolicyReasonCode` | type | core.md lines 127-128 | — | Closed union |
| 16 | `isPolicyReasonCode` | function | core.md lines 127-128 | — | Runtime guard |
| 17 | `POLICY_REJECTION_CODES` | const | core.md lines 134-135 (the exhaustive named set) | rails typed-rejection convention | 5 typed codes; refused commands emit no evidence |
| 18 | `PolicyRejectionCode` | type | core.md lines 134-135 | — | Closed union |
| 19 | `PolicyCommandResult` | type | core.md lines 97-107 (the machines the commands drive) | INV-2-2/INV-2-3 | Typed rejection on refusal |
| 20 | `FulfillmentPolicyDefinition` | interface | core.md lines 91-93: "allowed rails, ordering, cost ceilings, deadlines, and fallback preferences" | lines 97-99 | Exactly the five fields (decision 1) |
| 21 | `FulfillmentPolicyRecord` | interface | core.md lines 97-100: "FulfillmentPolicy — versioned, immutable policy document attached to an intent at authorization time." | line 134 (attached snapshot id) | Version, lifecycle, attachment |
| 22 | `IntentTerms` | interface | core.md lines 102-103: "evaluating a policy against an intent" | A01 lines 39-41 (the demand's terms) | The intent's demand-side inputs as values |
| 23 | `RouteRequirement` | interface | core.md lines 105-106: "ranked route requirements" | A03 lines 154-155 | One ranked candidate |
| 24 | `ConstraintEnvelope` | interface | core.md lines 105-106: "constraint envelope" | lines 91-93 | Merged constraints for routing |
| 25 | `PolicyEvaluationResult` | interface | core.md lines 105-106: "Contents: ranked route requirements, constraint envelope, cost ceiling, deadline." | — | The four contents verbatim |
| 26 | `PolicyEvaluationOutcome` | type | core.md lines 102-107 | lines 127-128 (POLICY_UNSATISFIABLE) | Satisfiable result or reason-coded failure |
| 27 | `PolicyEvaluationRecord` | interface | core.md lines 102-107 | INV-2-2 (lines 118-120); INV-2-3 (lines 121-123); line 135 | Derived id, recorded basis, state, result hash |
| 28 | `PolicySnapshotInput` | type | core.md lines 141-142: "Depends on area 3 for the capability snapshot format." | capability/types.ts CapabilitySnapshot | Type-only dependency (decision 5) |
| 29 | `POLICY_EVALUATION_HASH_FORMAT_VERSION` | const | core.md line 135: "result hash" | GC-1 (README.md §3 lines 39-43) | `peh.v1.` / `pdh.v1.` prefixes |
| 30 | `fulfillmentPolicyDefinition` | function | core.md lines 91-93, 97-99 | GC-1 | Validating, canonicalizing, freezing mint |
| 31 | `mergedAllowedRails` | function | core.md lines 91-93 ("allowed rails" both sides) | lines 105-106 | Policy ∩ intent, ascending |
| 32 | `mergedCostCeiling` | function | INV-2-1 (core.md lines 115-117): "cost ceilings are Money values; policy comparisons are integer comparisons" | lines 39-41 | min() by compareMoney |
| 33 | `mergedDeadline` | function | core.md lines 91-93 ("deadlines"); lines 105-106 ("deadline") | lines 39-41 | Integer min |
| 34 | `evaluateFulfillmentPolicy` | function | INV-2-1 (core.md lines 115-117): "Evaluation is a pure function of (policy version, intent terms, capability snapshot)." | lines 102-107; lines 127-128 | THE pure function; decision 2 |
| 35 | `rankRouteRequirements` | function | core.md lines 91-93 ("ordering"); line 105 ("ranked") | INV-2-1 | Deterministic total order |
| 36 | `canonicalPolicyEvaluationOutcome` | function | core.md line 135: "POLICY_EVALUATED (outcome: evaluation id and result hash)" | GC-1 | Kernel type-tagged encoding |
| 37 | `policyEvaluationResultHash` | function | core.md line 135 | — | sha256; `peh.v1.` |
| 38 | `canonicalPolicyDefinition` | function | core.md lines 97-99 ("versioned, immutable policy document") | A15 lines 31-32 | The attached version's fingerprint input |
| 39 | `policyDefinitionHash` | function | core.md line 134 (POLICY_ATTACHED proof material) | A15 lines 31-32 | sha256; `pdh.v1.` |
| 40 | `transitionFulfillmentPolicy` | function | core.md lines 98-100 | — | Pure; ATTACHED patch records intent + snapshot |
| 41 | `transitionPolicyEvaluation` | function | core.md lines 104-105 | — | Pure; EVALUATED -> CONSUMED |
| 42 | `KeyedSerializer` | class | INV-2-3 (core.md lines 121-123): "one policy evaluation id per (intent, policy version, snapshot id)" | — | Serialized per evaluation id (decision 8) |
| 43 | `POLICY_AUTHORITY_ID` | const | registry A02 "owningAuthority": "Fulfillment Policy Authority" | core.md lines 110-111 ("Policy Authority (protocol layer, area 2)") | The 'authority' slot value |
| 44 | `POLICY_EVIDENCE_VOCABULARY` | const | core.md lines 134-135 (the named set) | — | Exactly the 2 named types |
| 45 | `policyAttachedEvidence` | function | core.md line 134: "POLICY_ATTACHED (policy version, snapshot id)." | A15 lines 26-32; GC-5 | Version id + intent + snapshot as subjects |
| 46 | `policyEvaluatedEvidence` | function | core.md line 135: "POLICY_EVALUATED (outcome: evaluation id and result hash)." | lines 127-128 | Evaluation id subject; result hash proof |
| 47 | `submitPolicyEvidence` | function | A15 lines 62-64: "A failed write fails the operation." | kernel ports.ts | Submit-then-commit coupling |
| 48 | `PolicyAuthority` | class | core.md lines 110-111: "Policy Authority (protocol layer, area 2) owns policy semantics and versioning." | INV-2-1/2-2/2-3; lines 127-130 | The command surface |
| 49 | `PolicyAuthorityDeps` | type | core.md lines 110-111 | A15 lines 62-64 | evidence + wallClock |
| 50 | `DEFAULT_POLICY_DB_PATH` | const | (persistence convention; v0.1 prescribes no storage — README.md §9 lines 173-174) | spec/durable/execution.md §2 lines 40-43; wave README | var/policy.sqlite |
| 51 | `POLICY_MIGRATIONS_DIR_ENV_VAR` | const | (same) | spec/durable/execution.md §2 lines 44-47 | PAYSWAP_POLICY_MIGRATIONS_DIR |
| 52 | `POLICY_MIGRATIONS_RELATIVE_DIR` | const | (same) | wave README "Persistence convention" | Owned prefix migrations |
| 53 | `POLICY_STORE_DOMAIN` | const | (same) | wave README "Persistence convention" | protocol-runtime-policy |
| 54 | `resolvePolicyMigrationsDir` | function | (same) | spec/durable/execution.md §2/§4 | Explicit > env > walk-up > fail-closed |
| 55 | `openPolicyStore` | function | (same) | spec/durable/execution.md §3/§4; kernel reference pattern | openDurableDatabase + owned migrations |
| 56 | `PolicyStoreOptions` | type | (same) | substrate DurableDatabaseOptions shape | dbPath + migrationsDir |
| 57 | `PolicyStoreWrite` | type | (same) | INV-2-3 (core.md lines 121-123); DEP-003 §6 dedupe-report shape | created + reason |
| 58 | `writeFulfillmentPolicy` | function | core.md lines 97-100 (the persisted record) | — | INSERT-only on (policy id, version) |
| 59 | `savePolicyState` | function | core.md lines 98-100 (the lifecycle) | — | UPDATE state + attachment |
| 60 | `writePolicyEvaluation` | function | core.md lines 102-107 | INV-2-3 (lines 121-123) | UNIQUE (intent, policy version, snapshot) |
| 61 | `savePolicyEvaluationState` | function | core.md lines 104-105 | — | EVALUATED -> CONSUMED persisted |
| 62 | `readFulfillmentPolicies` | function | core.md lines 97-100 | GC-1 (README.md §3 lines 39-43) | Definition re-minted on read |
| 63 | `readPolicyEvaluations` | function | core.md lines 102-107 | INV-2-2 (recorded snapshot id) | Reconstructed frozen evaluations |
