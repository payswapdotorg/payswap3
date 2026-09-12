# RTN-007 — Credit Authority contract review

Work order: `spec/protocol-runtime-work-orders/RTN-007.md`
Owned surface: `src/lib/protocol-runtime/credit/` (area 7 — A07)
Rule: **every exported type/function/constant maps to a cited
`spec/architecture/v0.1/` source; rows with no source are forbidden.**

Method: each row lists the primary `spec/architecture/v0.1/` source (file,
section, line, and the quoted line that grounds the export) and, where
needed, the supporting contracts outside v0.1 that additionally bind the
export. Quoted text is verbatim from the frozen v0.1 directory; line
numbers refer to the files as merged at the RTN-007 base
(`main @ fe0fed0`).

Exported symbol count: **55** (41 runtime symbols enumerated from
`credit.ts` at load + 14 exported types). Table rows: **55**. The counts
match.

## Recorded interpretation decisions and deviations

1. **The credit line IS the area-5 ledger resource.** core.md lines
   335-336 ("Depends on areas 6, 7, and 3 as resource owners") plus
   INV-7-1's own words ("the check and the reservation are atomic under
   area 5 serialization") position the Credit Authority as the resource
   owner that declares each line on the RTN-006 ReservationLedger
   (resource id `credit-line:<lineId>`) with declared total = the limit.
   Exposure is then held + consumed on that resource: INV-7-1
   ("exposure never exceeds the line limit") is EXACTLY the ledger's
   INV-5-1 available >= 0, checked and held atomically inside the
   ledger's serialized requestReservation — two concurrent approvals can
   never both count the same remaining limit (machine-checked).
2. **Exposure = held + consumed.** "CreditExposure — current outstanding
   amount (Money, integer) on a credit line" (lines 101-104): the
   capacity currently extended — reserved (held) or settled into
   obligations from clearing (consumed) — and not yet repaid. Release
   and expiry reduce exposure (the repayment-tied release path:
   "mutated only through area 5 reservations tied to obligations from
   clearing (area 9)"); consumption moves capacity from reserved to
   consumed. Reduction of CONSUMED exposure (repayment settlement /
   write-off) is the areas 9-12/21 composition — later waves (deferred,
   see the work-order dependency RTN-009/RTN-012); a line with consumed
   exposure therefore cannot close in this wave ("closure is terminal
   after outstanding exposure is settled or written off (areas 10,
   12)") — recorded known limitation.
3. **The line machine is exact and one-way.** OFFERED -> ACTIVE ->
   SUSPENDED -> terminal(CLOSED) only: no SUSPENDED -> ACTIVE resume
   edge (resumption is a new line — a new agreement), no OFFERED ->
   CLOSED withdrawal edge, no ACTIVE -> CLOSED shortcut. Closure
   requires SUSPENDED with exposure exactly zero. "Suspension blocks
   new reservations" is enforced at BOTH evaluate (denial
   LINE_NOT_ACTIVE) and apply (typed rejection); in-flight HELD
   reservations survive suspension (the ledger's own
   holds-stay-HELD-until-resolved discipline, core.md lines 319-322).
4. **The decision machine: EVALUATED -> APPLIED, split into evaluate and
   apply.** evaluateCreditUsage is the pure, deterministic evaluation
   (the prediction over current exposure, recorded with one
   CREDIT_DECIDED record); applyCreditDecision is THE atomic capacity
   commit — the ledger hold — that moves the decision to APPLIED and
   writes EXPOSURE_CHANGED. A DENIED decision never applies (its
   recorded outcome is the answer). An apply whose atomic hold fails
   (INSUFFICIENT_REMAINING_LIMIT) leaves the decision EVALUATED,
   retryable, its recorded outcome unchanged (INV-7-3).
5. **INV-7-3 is structural.** The decision id is
   deriveProtocolId('credit-decision', intentId, lineId) — keyed by
   (intent id, line id); the same key always returns the same recorded
   decision, even under different later inputs (machine-checked).
   Approvals name the EXACT requested integer amount ("No partial
   ambiguity: an approval names an exact integer amount"); partial
   approval would need business parameters, which "are inputs; this
   area defines semantics, not business parameters" (lines 145-147).
6. **Expiry.** expireDueCreditReservations runs the ledger's
   deterministic deadline sweep and re-evidences each affected line
   once, in ascending line-id order. The sweep is global over the
   ledger; the composition root sequences the sibling domains' sweeps
   (recorded limitation, as in liquidity's interpretation 7).
7. **State layer.** In-process single writer (the RTN-002/RTN-005
   precedent); the durable side is persistence.ts + migrations/ over the
   DEP-003 substrate read-only, with a denormalized exposure projection
   row per line (the authoritative computation is always the ledger
   fold).

## Exported symbol table (55 rows)

### types.ts (10 runtime + 10 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `CREDIT_LINE_STATES` | const | liquidity-credit-queues.md §2 lines 97-99: "States: OFFERED -> ACTIVE -> SUSPENDED -> terminal(CLOSED)." |
| `CreditLineState` | type | Same as above. |
| `CREDIT_LINE_TRANSITIONS` | const | Same as above (the chain this table materializes). |
| `isCreditLineState` | fn | Same as above. |
| `canTransitionCreditLine` | fn | Same as above; lines 99-100 (suspension/closure semantics). |
| `CREDIT_DECISION_STATES` | const | §2 lines 107-108: "States: EVALUATED -> APPLIED." |
| `CreditDecisionState` | type | Same as above. |
| `isCreditDecisionState` | fn | Same as above. |
| `CREDIT_REASON_CODES` | const | §2 lines 97-127, 138-140 (the grounded reasons) + A15 line 30. |
| `CreditReasonCode` | type | Same as above. |
| `isCreditReasonCode` | fn | A15 line 30. |
| `CREDIT_REJECTION_CODES` | const | §2 lines 138-140 (the exhaustive named set) + the typed-rejection convention. |
| `CreditRejectionCode` | type | Same as above. |
| `isCreditRejectionCode` | fn | Same as above. |
| `CreditLineRecord` | type | §2 lines 96-98: "CreditLine — agreement extending fulfillment capacity against future repayment." + INV-7-1 lines 119-121. |
| `CreditExposureView` | type | §2 lines 101-104: "CreditExposure — current outstanding amount (Money, integer) on a credit line, mutated only through area 5 reservations tied to obligations from clearing (area 9)." |
| `CreditDecisionOutcome` | type | §2 lines 109-111: "Outcome: APPROVED with approved amount, or DENIED with reason code. No partial ambiguity: an approval names an exact integer amount." |
| `CreditDecisionRecord` | type | §2 lines 105-108 + INV-7-3 lines 125-127. |
| `CreditCommandResult` | type | INV-7-3 lines 125-127 + the merged typed-result convention. |
| `ApplyCreditDecisionResult` | type | §2 lines 90-92: "Credit decisions are pure evaluations; the resulting capacity is held via area 5 reservations like any other resource." + INV-7-1/INV-7-3. |

### state-machine.ts (2 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `transitionCreditLine` | fn | §2 lines 97-100 (the line machine's carrier). |
| `transitionCreditDecision` | fn | §2 lines 107-108 (the decision machine's carrier). |

### exposure.ts (8 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `EXPOSURE_ARITHMETIC_IDENTITY_HASH_FORMAT_VERSION` | const | §2 line 140: "EXPOSURE_CHANGED (post-transition integer arithmetic proof)." |
| `exposureFromAccounting` | fn | §2 lines 101-104 + core.md lines 304-306 (INV-5-1 — the resource accounting the view derives from). |
| `zeroExposure` | fn | INV-7-1 lines 119-121 (the identity's zero point). |
| `exposureInvariantHolds` | fn | INV-7-1 lines 119-121: "exposure never exceeds the line limit ... Exposure arithmetic is integer Money." |
| `canonicalExposureAccounting` | fn | §2 line 140 (the arithmetic proof's encoding) + A15 lines 31-32. |
| `exposureArithmeticIdentityHash` | fn | §2 line 140: "post-transition integer arithmetic proof." |
| `canonicalCreditDecision` | fn | §2 line 139: "CREDIT_DECIDED (decision id, key, outcome, reason code)." + A15 lines 31-32. |
| `creditDecisionIdentityHash` | fn | Same as above. |

### serializer.ts (1 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `KeyedSerializer` | class | INV-7-2 lines 122-124: "exposure mutations are serialized per credit line; two concurrent approvals cannot both count the same remaining limit." |

### evidence.ts (6 runtime)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `CREDIT_AUTHORITY_ID` | const | spec/registry/protocol-registry.json A07: "Credit Authority". |
| `CREDIT_EVIDENCE_VOCABULARY` | const | §2 lines 138-140: "CREDIT_LINE_STATE_CHANGED. CREDIT_DECIDED (decision id, key, outcome, reason code). EXPOSURE_CHANGED (post-transition integer arithmetic proof)." |
| `creditLineStateChangedEvidence` | fn | §2 line 138 + A15 lines 26-32 + GC-5. |
| `creditDecidedEvidence` | fn | §2 line 139 ("decision id, key, outcome, reason code") + A15 lines 26-32 + GC-5. |
| `exposureChangedEvidence` | fn | §2 line 140 ("post-transition integer arithmetic proof") + A15 lines 26-32 + GC-5. |
| `submitCreditEvidence` | fn | A15 lines 62-64: "an operation is not committed until its record is written. A failed write fails the operation." |

### authority.ts (2 runtime + 2 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `CreditAuthority` | class | §2 lines 113-114: "Credit Authority (protocol layer, area 7) owns lines, exposure, and decision semantics." |
| `creditLineResourceId` | fn | core.md lines 335-336: "Depends on areas 6, 7, and 3 as resource owners" (the resource-id convention). |
| `CreditAuthorityDeps` | type | A15 lines 41-43 + core.md lines 293-295, 335-336 (the ledger dependency). |
| `CreditRejection` | type | The typed-rejection convention (§2 lines 138-140's exhaustive named set). |

### persistence.ts (12 runtime + 2 types)

| Symbol | Kind | Source (quoted line) |
|---|---|---|
| `DEFAULT_CREDIT_DB_PATH` | const | The per-domain persistence convention + spec/durable/execution.md §2 lines 40-43. |
| `CREDIT_MIGRATIONS_DIR_ENV_VAR` | const | spec/durable/execution.md §2 lines 44-47. |
| `CREDIT_MIGRATIONS_RELATIVE_DIR` | const | The per-domain persistence convention. |
| `CREDIT_STORE_DOMAIN` | const | Same as above. |
| `resolveCreditMigrationsDir` | fn | spec/durable/execution.md §2/§4. |
| `CreditStoreOptions` | type | Same as above. |
| `openCreditStore` | fn | spec/protocol-runtime-work-orders/README.md "Persistence convention" + spec/durable/execution.md §3/§4. |
| `writeCreditLine` | fn | §2 lines 96-100 (the persisted line shape). |
| `writeCreditDecision` | fn | §2 lines 105-111 (the persisted decision shape). |
| `writeCreditExposure` | fn | §2 lines 101-104 (the denormalized exposure projection). |
| `readCreditLines` | fn | §2 lines 96-100 + README.md §3 GC-1. |
| `readCreditDecisions` | fn | §2 lines 105-111 + INV-7-3 lines 125-127 + GC-1. |
| `readCreditExposure` | fn | §2 lines 101-104, 119-121 + GC-1. |
| `CreditStoreWrite` | type | INV-7-3 lines 125-127 (the dedupe report) + DEP-003 §6. |

Runtime row count: 10 + 2 + 8 + 1 + 6 + 2 + 12 = **41**.
Type row count: 10 + 2 + 2 = **14**.
Total: **55** — matches the barrel's exported symbol count.
