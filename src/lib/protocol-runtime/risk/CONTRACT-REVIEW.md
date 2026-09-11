# RTN-003 — Risk/Compliance Authority contract review

Work order: `spec/protocol-runtime-work-orders/RTN-003.md`
Owned surface: `src/lib/protocol-runtime/risk/`
Rule: **every exported type/function/constant maps to a cited
`spec/architecture/v0.1/` source; rows with no source are forbidden.**

Method: each row lists the primary `spec/architecture/v0.1/` source (file,
section, line, and the quoted line that grounds the export) and, where
needed, the supporting contracts outside v0.1 that additionally bind the
export (the kernel declaration, the DEP-003 durable execution contract, the
RTN wave conventions, the registry projection). Quoted text is verbatim from
the frozen v0.1 directory; line numbers refer to the files as merged at the
RTN-003 base (`main @ fd996c3`).

Exported symbol count: **123** (84 runtime symbols enumerated from `risk.ts`
at load + 39 exported types). Table rows: **123**. The counts match.

## Recorded interpretation decisions and deviations

1. **Screening entries are party digests matched by pure equality.** A16
   lines 109-111 define screening as "deterministic outcome of matching
   subject data against a screening list version"; INV-16-1 makes the
   evaluation a pure function of (rule version, list version, **subject data
   hash**). The reading that makes the invariant literal: a list version's
   entries are opaque party digests in the subject-data-hash format
   (`sdh.v1.<hex>`), and the match is exact digest equality — the outcome is
   then a pure function of (list version, subject data hash) with no other
   inputs. Fuzzy matching is deliberately absent (it could not be a pure
   function of the hash). List contents remain configuration data inside the
   protocol layer (A16 lines 152-154).
2. **The "rule set version" is a derived digest over member rule versions.**
   INV-16-1 names "rule version", INV-16-4 and CHECK_DECIDED name "rule set
   version"; v0.1 gives a state machine to RiskRule only, not to rule sets.
   Rather than invent a rule-set publishing lifecycle, the rule set version
   is a pure sha256 digest over the exact member rule versions in canonical
   (ruleId, version) order (`rsv.v1.<hex>`) — collision-free, versioned, and
   derived from the very rule versions the invariant names. The live rule
   set is the ACTIVE rules (the authority resolves them; a pinned set may
   reference any published version).
3. **REVIEW_RECORDED's 'authority' slot carries the REVIEWER authority.**
   A16 lines 106-107: "a reviewed decision is recorded with reviewer
   authority identity and reason"; line 147: "REVIEW_RECORDED (reviewer
   authority, decision, rationale)". The five-slot shape is fixed (A15 lines
   26-32), so the three named data map as: reviewer authority → the
   'authority' slot (the authority that performed the reviewed decision);
   decision → outcome.result; rationale → outcome.reasonCode. CHECK_DECIDED
   and SCREENING_COMPUTED carry the Risk and Compliance Authority (the
   registry's A16 owning authority name) in the 'authority' slot.
4. **One evidence record per operation, exactly the named set.** A16's
   "Evidence produced" names exactly CHECK_DECIDED, SCREENING_COMPUTED,
   REVIEW_RECORDED. Emission mapping: auto-decisions and the
   routing-to-review emit CHECK_DECIDED; the reviewed decision (the
   MANUAL_REVIEW → APPROVED | DENIED operation) emits REVIEW_RECORDED (which
   carries the decision); the screening resolution emits SCREENING_COMPUTED.
   Rule lifecycle operations (author/publish/activate/retire) emit NO A15
   evidence: INV-15-1's consequential-operation enumeration covers areas
   1-14 and 18-24 state transitions, not risk-rule configuration, and no
   RULE_* operation type exists in the spec — none is invented.
5. **The check's EVALUATED state is the undecided state.** A16 lines 104-105
   make EVALUATED the initial state of the check lifecycle; lines 140-141
   say "undecided checks block the gated transition until resolved". The
   check exists durably in EVALUATED (evaluation recorded, decision not yet
   applied); deciding is a separate operation. Auto-decision applies exactly
   the recorded deterministic outcome (INV-16-1 end to end); the routing
   transition is legal only for MANDATORY_REVIEW evaluations, and the
   auto-decision transitions are legal only for AUTO evaluations — which is
   what makes "auto-decision is forbidden for hits" enforced TWICE: at the
   type level (the branded check flavors are not assignable to the wrong
   facade, verified by `@ts-expect-error` under `tsc --noEmit`) and at
   runtime (the transition function rejects the pair).
6. **Gate kinds are exactly the two INV-16-3 names, with subject-kind
   matching.** "intent AUTHORIZATION, capability ACTIVATION" (INV-16-3) is
   the frozen two-member set. A check authorizes a gate only when its
   subject kind matches the gate kind (INTENT ↔ intent.AUTHORIZATION;
   CAPABILITY_REGISTRATION ↔ capability.ACTIVATION): A16 line 103 ties a
   check to a subject "(intent, capability registration, merchant
   onboarding)" and cross-kind authorization would be unsound. Blocking
   reason priority is deterministic: CHECK_DENIED > CHECK_UNDECIDED >
   NO_APPROVED_CHECK. Area 3's boundary line says "risk gating of capability
   registration" (core.md lines 207-208) while INV-16-3 says "capability
   ACTIVATION"; the invariant's exact term governs the gate kind, and the
   same gate interface serves both wordings — recorded as a wording
   difference, not a semantic contradiction (no stop condition).
7. **The evaluation's 'when' stamp is not a decision input.** INV-16-1's
   triple is (rule version, list version, subject data hash); the
   ProtocolTime carried on the evaluation/records is the A15 'when' stamp of
   the recording, not a decision input (property tests re-evaluate with
   different stamps and assert identical decision bases).
8. **Persistence of the screening's COMPUTED intermediate.** The authority
   persists the COMPUTED screening row before resolving it (crash-safe
   two-step); a crash between leaves a durable COMPUTED row that the next
   computation of the same input triple resolves idempotently. This is an
   implementation choice inside the persistence convention (v0.1 prescribes
   no storage), not a semantic addition.
9. **INV-16-4 keying is exactly the named pair.** Check ids are derived from
   (subject id, rule set version) alone — NOT the screening list version or
   subject data hash. Re-evaluation with the same pair returns the recorded
   check even when the subject data differs (the recorded result stands until
   a new rule set version is evaluated). This is the invariant's literal
   wording, machine-checked in the Node harness.
10. **The A15 evidence test double is an owned in-surface instrument.**
    Per the wave evidence discipline (work-orders README line 39), emission
    is tested against `EvidenceSubmissionTestDouble` (records what would be
    written, asserts the five-slot shape, can be armed to fail — proving "A
    failed write fails the operation"). The real-log integration is RTN-012's
    (the port TYPE consumed here is the kernel's declaration).
11. **Bun/Node test split.** `bun test` covers the pure modules; the
    SQLite-backed surfaces run under plain Node (Node ≥ 22.6: node:sqlite +
    type stripping) in `scripts/test_risk_authority.mjs` — the same split
    RTN-001 established (`bun test` for the kernel's pure modules;
    `scripts/test_protocol_kernel.mjs` for the store), because Bun does not
    implement `node:sqlite`.
12. **Reason-code vocabulary is the closed set of evaluation causes.** The
    A16 vocabulary is exactly {NO_BREACH, RULE_BREACH, RULE_REVIEW,
    SCREENING_HIT} — one code per deterministic cause the pure evaluation
    can record, mirroring the kernel's decision-3 discipline (area-specific
    codes are owned by the area; no inventions).

## Contract review table

Legend — v0.1 sources: `A16` = `spec/architecture/v0.1/
evidence-risk-compliance.md` (Area 16 section §2 unless noted; A15 = its
Area 15 section §1); `core.md` = `spec/architecture/v0.1/core.md`; `README`
= `spec/architecture/v0.1/README.md`. Supporting: `K` = the merged RTN-001
kernel (`src/lib/protocol-runtime/kernel/`); `DEP-003` =
`spec/durable/execution.md`; `WO` = `spec/protocol-runtime-work-orders/
RTN-003.md`; `WAVE` = `spec/protocol-runtime-work-orders/README.md`;
`REG` = `spec/registry/protocol-registry.json`.

### reason-codes.ts — the A16 reason vocabulary (A16 line 145)

| # | Export | Kind | v0.1 source (quoted line) | Supporting | Notes |
|---|--------|------|---------------------------|-----------|-------|
| 1 | `RISK_REASON_CODES` | const | A16 line 145: "CHECK_DECIDED (subject, rule set version, outcome, reason code)." | A15 line 30 ("outcome: ... including reason codes") | Frozen 4-member set (decision 12) |
| 2 | `RiskReasonCode` | type | A16 line 145 | — | Closed union |
| 3 | `isRiskReasonCode` | function | A16 line 145 | — | Runtime guard |

### subject.ts — the checked subject and its data hash (A16 lines 102-111, INV-16-1/2)

| # | Export | Kind | v0.1 source (quoted line) | Supporting | Notes |
|---|--------|------|---------------------------|-----------|-------|
| 4 | `SUBJECT_KINDS` | const | A16 lines 102-103: "tied to a subject (intent, capability registration, merchant onboarding)." | — | Exactly the three named kinds |
| 5 | `SubjectKind` | type | A16 lines 102-103 | — | |
| 6 | `SubjectMoneyFact` | interface | INV-16-2 (A16 lines 127-128): "threshold comparisons use integer Money or integer counts" | core.md §0 lines 11-12 (Money shape) | Integer minor units keyed by currency |
| 7 | `SubjectCountFact` | interface | INV-16-2 (A16 lines 127-128): "integer counts" | — | |
| 8 | `SubjectComplianceData` | interface | A16 lines 102-111 (the subject of checks and screening) | INV-16-2 | Immutable value object |
| 9 | `subjectComplianceData` | function | A16 lines 102-111 | README GC-1 lines 39-43 | The single mint; rejects floats (INV-16-2), duplicates; canonical fact order |
| 10 | `SUBJECT_DATA_HASH_FORMAT_VERSION` | const | INV-16-1 (A16 lines 124-126): "evaluation is a pure function of (rule version, screening list version, subject data hash)" | K (identity.ts versioned-input discipline) | v1; prefix `sdh.v1.` |
| 11 | `SubjectDataHash` | type | INV-16-1 (A16 lines 124-126); A16 line 146 ("subject hash") | — | Branded |
| 12 | `canonicalSubjectData` | function | INV-16-1 (pure-function input must be canonical and comparable) | K `canonicalDerivationInput` | Unambiguous length-prefixed encoding |
| 13 | `deriveSubjectDataHash` | function | INV-16-1; A16 line 146: "SCREENING_COMPUTED (list version, subject hash, outcome)." | — | sha256 over the canonical encoding |
| 14 | `isSubjectDataHash` | function | INV-16-1 | K (version-detectable prefixes) | |
| 15 | `isSubjectKind` | function | A16 lines 102-103 | — | |

### rule.ts — the RiskRule lifecycle (A16 lines 98-100; INV-16-1/2/4)

| # | Export | Kind | v0.1 source (quoted line) | Supporting | Notes |
|---|--------|------|---------------------------|-----------|-------|
| 16 | `RISK_RULE_STATES` | const | A16 line 100: "States: AUTHORED -> VERSIONED -> ACTIVE -> RETIRED." | — | |
| 17 | `RiskRuleState` | type | A16 line 100 | — | |
| 18 | `RISK_RULE_TRANSITIONS` | const | A16 line 100 | — | The complete legal table |
| 19 | `canTransitionRiskRule` | function | A16 line 100 | — | Pairwise predicate |
| 20 | `isRiskRuleState` | function | A16 line 100 | — | |
| 21 | `RuleFactReference` | type | INV-16-2 (A16 lines 127-128): "integer Money or integer counts" | — | MONEY-by-currency / COUNT-by-name |
| 22 | `RuleThresholdBound` | type | INV-16-2 | core.md §0 lines 11-12 | Integer bound matching the fact class |
| 23 | `RuleComparisonOperator` | type | INV-16-2 | core.md INV-2-1 line 116 ("policy comparisons are integer comparisons") | GT/GTE/LT/LTE/EQ |
| 24 | `RuleBreachAction` | type | A16 lines 104-107 (check terminals a firing rule drives) | — | DENY / REVIEW |
| 25 | `RiskRuleDefinition` | interface | A16 lines 98-99: "versioned, immutable rule definition with an explicit evaluation function signature." | INV-16-2 | ONE structured threshold predicate |
| 26 | `RiskRuleRecord` | interface | A16 lines 98-100 | — | version 0 = AUTHORED draft; ≥1 published |
| 27 | `RiskRuleVerdict` | type | A16 lines 98-99 + 104-107 | — | NOT_FIRED / DENY / REVIEW |
| 28 | `RiskRuleTransitionResult` | type | A16 line 100 (the exact transition set enforced) | — | ok/rule or from/to/problem |
| 29 | `RiskRuleEvaluation` | type | A16 lines 98-99 ("explicit evaluation function signature") | INV-16-1 | Pure function type |
| 30 | `authorRiskRule` | function | A16 line 100 (AUTHORED is the first state) | — | |
| 31 | `reviseRiskRuleDefinition` | function | A16 lines 98-99 ("immutable rule definition" — revision only while AUTHORED) | — | |
| 32 | `publishRiskRuleVersion` | function | A16 line 100: "AUTHORED -> VERSIONED" | — | Assigns the integer version |
| 33 | `activateRiskRule` | function | A16 line 100: "VERSIONED -> ACTIVE" | — | |
| 34 | `retireRiskRule` | function | A16 line 100: "ACTIVE -> RETIRED" | — | Terminal for the version |
| 35 | `validateRiskRuleDefinition` | function | INV-16-2 (integer thresholds; fact/bound agreement) | core.md §0 | TypeError on violation |
| 36 | `evaluateRiskRule` | function | A16 lines 98-99; INV-16-1/INV-16-2 | — | The pure rule evaluation |
| 37 | `RULE_SET_VERSION_FORMAT_VERSION` | const | INV-16-1 ("rule version" input must be stable/comparable) | K | v1; prefix `rsv.v1.` |
| 38 | `RuleSetVersion` | type | INV-16-1; INV-16-4 (A16 lines 133-134); A16 line 145 | — | Derived digest (decision 2) |
| 39 | `deriveRuleSetVersion` | function | INV-16-1; INV-16-4; A16 line 145 ("CHECK_DECIDED (subject, rule set version, outcome, reason code)") | — | Pure sha256 over canonical members |
| 40 | `VersionedRuleSet` | interface | INV-16-1; INV-16-4 | — | Pinned members + derived version |
| 41 | `assembleRuleSet` | function | A16 lines 98-100 (published versions only) | — | Rejects AUTHORED drafts |
| 42 | `deriveComplianceCheckId` | function | INV-16-4: "check ids are keyed by (subject id, rule set version)" | K `deriveProtocolId` | Kernel facility |

### screening.ts — the ScreeningResult lifecycle (A16 lines 109-113; INV-16-1)

| # | Export | Kind | v0.1 source (quoted line) | Supporting | Notes |
|---|--------|------|---------------------------|-----------|-------|
| 43 | `SCREENING_RESULT_STATES` | const | A16 line 111: "States: COMPUTED -> terminal(CLEAR | HIT)." | — | |
| 44 | `ScreeningResultState` | type | A16 line 111 | — | |
| 45 | `SCREENING_RESULT_TRANSITIONS` | const | A16 line 111 | — | COMPUTED→{CLEAR,HIT} only |
| 46 | `canTransitionScreeningResult` | function | A16 line 111 | — | |
| 47 | `isScreeningResultState` | function | A16 line 111 | — | |
| 48 | `ScreeningListRecord` | interface | A16 lines 109-110 ("a screening list version (sanctions, blocked parties)") + lines 152-154 ("list contents remain configuration data") | — | Canonicalized entries (decision 1) |
| 49 | `screeningListVersionId` | function | INV-16-1 ("screening list version"); A16 line 146 ("list version") | — | `<listId>@v<version>` |
| 50 | `createScreeningList` | function | A16 lines 109-110 | — | Validates + canonicalizes |
| 51 | `screenSubjectData` | function | A16 lines 109-111: "deterministic outcome of matching subject data against a screening list version" | INV-16-1 | The pure match (decision 1) |
| 52 | `ScreeningResultRecord` | interface | A16 lines 109-113 | — | matchedEntry present iff HIT |
| 53 | `computeScreeningResult` | function | A16 line 111 (COMPUTED is the initial state) | — | |
| 54 | `resolveScreeningResult` | function | A16 line 111 (COMPUTED -> terminal) | INV-16-1 | Applies the pure match; requires the exact recorded list version |
| 55 | `deriveScreeningId` | function | INV-16-1 (identical inputs address the identical recorded outcome) | K `deriveProtocolId` | From the input triple |

### evaluation.ts — the pure INV-16-1 evaluation and the check record (A16 lines 102-134)

| # | Export | Kind | v0.1 source (quoted line) | Supporting | Notes |
|---|--------|------|---------------------------|-----------|-------|
| 56 | `ComplianceEvaluationOutcome` | type | A16 lines 104-107 + 112-113 | — | AUTO_APPROVE / AUTO_DENY / MANDATORY_REVIEW |
| 57 | `FiredRule` | interface | A16 lines 98-100 (the versioned rules that fired — recorded per version) | INV-16-1 | |
| 58 | `ComplianceEvaluation` | interface | INV-16-1: "identical inputs always produce the identical recorded outcome." | A16 line 145 | The full recorded basis |
| 59 | `ComplianceEvaluationInput` | interface | INV-16-1 (the triple) | A15 lines 27-28 (the 'when' stamp — decision 7) | |
| 60 | `evaluateCompliance` | function | INV-16-1 | A16 lines 98-113 (semantics composed) | Pure; deterministic priority (decision 5) |
| 61 | `COMPLIANCE_CHECK_STATES` | const | A16 lines 104-105: "States: EVALUATED -> terminal(APPROVED | DENIED | MANUAL_REVIEW) -> after review: APPROVED | DENIED." | — | |
| 62 | `ComplianceCheckState` | type | A16 lines 104-105 | — | |
| 63 | `ComplianceCheckRecord` | interface | A16 lines 102-107 | INV-16-4 | Carries the full evaluation |
| 64 | `ComplianceReviewRecord` | interface | A16 lines 106-107: "a reviewed decision is recorded with reviewer authority identity and reason."; line 147 | — | |
| 65 | `AutoDecidableComplianceCheck` | interface | A16 lines 112-113: "auto-decision is forbidden for hits" | — | Branded flavor minted only by evaluation |
| 66 | `ReviewRequiredComplianceCheck` | interface | A16 lines 112-113: "HIT creates a MANUAL_REVIEW ComplianceCheck" | — | Branded flavor |
| 67 | `EvaluatedComplianceCheck` | type | A16 lines 104-113 | — | The union |
| 68 | `evaluateComplianceCheck` | function | A16 lines 102-107; INV-16-1; INV-16-4 | — | Mints the EVALUATED check with the derived id |

### check.ts — the ComplianceCheck state machine (A16 lines 102-113)

| # | Export | Kind | v0.1 source (quoted line) | Supporting | Notes |
|---|--------|------|---------------------------|-----------|-------|
| 69 | `COMPLIANCE_CHECK_TRANSITIONS` | const | A16 lines 104-105 | — | Abstract table |
| 70 | `canTransitionComplianceCheck` | function | A16 lines 104-105 | — | |
| 71 | `isComplianceCheckState` | function | A16 lines 104-105 | — | |
| 72 | `ComplianceCheckTransitionResult` | type | A16 lines 104-107 + 112-113 | — | |
| 73 | `transitionComplianceCheck` | function | A16 lines 104-107 + 112-113 (per-instance HIT constraint) | INV-16-1 | The general machine (decision 5) |
| 74 | `decideComplianceCheck` | function | A16 lines 104-105 (EVALUATED -> APPROVED \| DENIED) + lines 112-113 (auto-decision forbidden for hits) | INV-16-1 | Typed facade; AUTO flavor only |
| 75 | `routeComplianceCheckForReview` | function | A16 lines 112-113: "HIT creates a MANUAL_REVIEW ComplianceCheck" | — | Typed facade; REVIEW flavor only |
| 76 | `recordComplianceReview` | function | A16 lines 106-107 (reviewed decision with reviewer identity and reason) | — | MANUAL_REVIEW -> APPROVED \| DENIED |
| 77 | `isComplianceCheckUndecided` | function | A16 lines 140-141: "undecided checks block the gated transition until resolved." | — | EVALUATED or MANUAL_REVIEW |
| 78 | `nextProtocolTimeAfter` | function | A15 lines 27-28 ("when: protocol time (sequenced) and recorded wall time") | K `protocolTime` | Monotonic stamp helper |

### gate.ts — the INV-16-3 compliance gate

| # | Export | Kind | v0.1 source (quoted line) | Supporting | Notes |
|---|--------|------|---------------------------|-----------|-------|
| 79 | `GATED_TRANSITION_KINDS` | const | INV-16-3 (A16 lines 129-131): "(intent AUTHORIZATION, capability ACTIVATION)" | core.md lines 84-85 (Area 1); core.md lines 207-208 (Area 3) | Frozen two-member set (decision 6) |
| 80 | `GatedTransitionKind` | type | INV-16-3 | — | |
| 81 | `isGatedTransitionKind` | function | INV-16-3 | — | |
| 82 | `ComplianceGateBlockReason` | type | INV-16-3 + A16 lines 140-141 (undecided blocks) | — | NO_APPROVED_CHECK / CHECK_UNDECIDED / CHECK_DENIED |
| 83 | `ComplianceGateVerdict` | type | INV-16-3: "cannot complete without a terminal APPROVED record for the subject." | — | |
| 84 | `evaluateComplianceGate` | function | INV-16-3; A16 lines 140-141 | — | Pure over the recorded checks |

### evidence.ts — A15 five-slot records through the port (A16 lines 144-147; A15 26-64)

| # | Export | Kind | v0.1 source (quoted line) | Supporting | Notes |
|---|--------|------|---------------------------|-----------|-------|
| 85 | `RISK_AUTHORITY_ID` | const | A15 line 29: "authority: which protocol authority performed the operation." | REG area A16: "Risk and Compliance Authority" | |
| 86 | `checkDecidedEvidence` | function | A16 line 145: "CHECK_DECIDED (subject, rule set version, outcome, reason code)." | A15 lines 26-32; GC-5 | Five-slot builder |
| 87 | `screeningComputedEvidence` | function | A16 line 146: "SCREENING_COMPUTED (list version, subject hash, outcome)." | A15 lines 26-32; GC-5 | |
| 88 | `reviewRecordedEvidence` | function | A16 line 147: "REVIEW_RECORDED (reviewer authority, decision, rationale)." | A16 lines 106-107 (decision 3) | Reviewer authority in the authority slot |
| 89 | `submitRiskEvidence` | function | A15 lines 62-64: "an operation is not committed until its record is written. A failed write fails the operation." | K ports.ts (the port type) | Propagates submission failure |

### store.ts — the risk-domain persistence convention (WAVE line 37; README §9 permission)

| # | Export | Kind | v0.1 source (quoted line) | Supporting | Notes |
|---|--------|------|---------------------------|-----------|-------|
| 90 | `DEFAULT_RISK_DB_PATH` | const | README §9 lines 173-174: "intentionally prescribes no implementation, storage, or service decomposition." | WAVE line 37; DEP-003 §2 | `var/risk.sqlite` |
| 91 | `RISK_MIGRATIONS_DIR_ENV_VAR` | const | README §9 lines 173-174 | DEP-003 §2 lines 44-47 | `PAYSWAP_RISK_MIGRATIONS_DIR` |
| 92 | `RISK_MIGRATIONS_RELATIVE_DIR` | const | README §9 lines 173-174 | WAVE line 37 (owned prefix) | |
| 93 | `RISK_STORE_DOMAIN` | const | README §9 lines 173-174 | DEP-003 §11 (owner identity) | `protocol-runtime-risk` |
| 94 | `RiskStoreOptions` | type | README §9 lines 173-174 | DEP-003 db options shape | |
| 95 | `resolveRiskMigrationsDir` | function | README §9 lines 173-174 | DEP-003 §2/§4; K persistence.ts | explicit → env → walk-up → fail-closed |
| 96 | `openRiskStore` | function | README §9 lines 173-174 | WAVE line 37 ("using the DEP-003 database layer read-only") | The convention, kernel-templated |
| 97 | `insertRiskRuleDraft` | function | A16 line 100 (AUTHORED persistence) | WAVE line 37 | One draft per rule (partial index) |
| 98 | `saveRiskRuleDraftDefinition` | function | A16 lines 98-99 (draft revision while AUTHORED) | — | |
| 99 | `publishRiskRuleRow` | function | A16 line 100 ("AUTHORED -> VERSIONED") | — | Atomic draft→version swap |
| 100 | `saveRiskRuleState` | function | A16 line 100 (state persistence) | — | |
| 101 | `findRiskRule` | function | A16 lines 98-100 (versioned rule lookup) | — | |
| 102 | `findRiskRuleDraft` | function | A16 line 100 (AUTHORED lookup) | — | |
| 103 | `nextRiskRuleVersion` | function | A16 lines 98-100 (version assignment at publish) | — | 1 + max recorded |
| 104 | `listRiskRulesInState` | function | A16 line 100 (ACTIVE resolution for evaluation) | INV-16-1 | Canonical order |
| 105 | `insertScreeningList` | function | A16 lines 137-139 ("External list updates are inputs, not effects") | — | Append-only versions |
| 106 | `findLatestScreeningList` | function | A16 lines 137-139 ("leaves the prior version active") | — | |
| 107 | `findScreeningListVersion` | function | INV-16-1 (the pinned list version input) | — | |
| 108 | `recordScreeningListRefreshFailure` | function | A16 lines 137-139: "records the failure — never a silent guess." | — | Durable failure row + prior version |
| 109 | `countScreeningListRefreshFailures` | function | A16 lines 137-139 (the recorded failure trail) | — | |
| 110 | `insertScreeningResult` | function | A16 lines 109-111 (COMPUTED persistence) | INV-16-1 | UNIQUE input triple |
| 111 | `saveScreeningResultState` | function | A16 line 111 (terminal resolution persistence) | — | |
| 112 | `findScreeningResult` | function | INV-16-1 (identical inputs → the recorded outcome) | — | The idempotency read |
| 113 | `insertComplianceCheck` | function | INV-16-4: "check ids are keyed by (subject id, rule set version)" | — | PK = the derived id |
| 114 | `saveComplianceCheckState` | function | A16 lines 104-107 (decision persistence) | — | |
| 115 | `findComplianceCheck` | function | INV-16-4 ("re-evaluation returns the recorded result") | — | |
| 116 | `listComplianceChecksForSubject` | function | INV-16-3 (the gate's read set for the subject) | — | |

### test-double.ts — the owned EvidenceSubmission port double (WAVE line 39)

| # | Export | Kind | v0.1 source (quoted line) | Supporting | Notes |
|---|--------|------|---------------------------|-----------|-------|
| 117 | `EVIDENCE_RECORD_SLOTS` | const | A15 lines 26-32: "Fields (mandatory, exactly these five semantic slots)" | GC-5 | The exact slot key set |
| 118 | `assertEvidenceFiveSlotShape` | function | A15 lines 26-32 | GC-5 | Shape assertion |
| 119 | `RecordedEvidenceSubmission` | type | WAVE line 39 (the double "records what would be written") | — | Record + ordinal |
| 120 | `EvidenceSubmissionTestDouble` | class | WAVE line 39: "the item tests against an owned in-surface test double of the port" | K ports.ts (the port type); A15 lines 62-64 (the failing mode) | RTN-012 replaces it with the real log |

### authority.ts — the composed service (A16 lines 117-119)

| # | Export | Kind | v0.1 source (quoted line) | Supporting | Notes |
|---|--------|------|---------------------------|-----------|-------|
| 121 | `RiskComplianceAuthorityOptions` | type | A16 lines 117-119 (the owning authority composition) | WAVE line 39 (the port); WAVE line 37 (the store) | |
| 122 | `RiskComplianceAuthority` | interface | A16 lines 117-119: "owns rule semantics, check lifecycle, and screening evaluation." | A16 lines 91-93 (gating and recording only) | |
| 123 | `createRiskComplianceAuthority` | function | A16 lines 117-119 | A15 lines 62-64 (submit-then-persist) | Composes store + port |

## Supporting sources used (outside spec/architecture/v0.1/)

These bind the authority to the kernel and wave contracts WITHOUT defining
protocol semantics:

- `src/lib/protocol-runtime/kernel/` (merged RTN-001): the EvidenceSubmission
  port declaration (ports.ts), identity derivation (identity.ts — used for
  check ids and screening ids), protocol time (time.ts), and the persistence
  convention template (persistence.ts).
- `spec/durable/execution.md` — the DEP-003 database layer contract (§2
  configuration, §4 migrations) consumed read-only through
  `src/lib/durable/db.ts`.
- `spec/protocol-runtime-work-orders/README.md` — the persistence convention
  (line 37) and the evidence discipline (line 39).
- `spec/protocol-runtime-work-orders/RTN-003.md` — the work order's
  objective/acceptance/required-evidence lines.
- `spec/registry/protocol-registry.json` — the A16 owning authority name
  ("Risk and Compliance Authority").

## Forbidden-source compliance

No file under `spec/architecture/v0.1/`,
`spec/architecture-change-requests/`, `spec/product/`, `src/lib/protocol/`,
`src/lib/durable/`, `src/components/`, or `src/app/` was modified.
`src/lib/durable/` is consumed read-only (`openDurableDatabase` imported
from `src/lib/durable/db.ts`). All additions live in the owned prefix
`src/lib/protocol-runtime/risk/` plus one root-level evidence harness
(`scripts/test_risk_authority.mjs`, mirroring the kernel's
`scripts/test_protocol_kernel.mjs` precedent — a script, not a spec or
product surface).
