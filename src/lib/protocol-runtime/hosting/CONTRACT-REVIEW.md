# RTN-011 — Authority hosting contract review

Work order: `spec/protocol-runtime-work-orders/RTN-011.md`
Owned surface: `src/lib/protocol-runtime/hosting/`
Rule: **every exported type/function/constant maps to a cited spec source
(file + section + quoted line); rows with no source are forbidden.**

Method: each row lists the primary source (file, section, line, and the
quoted line that grounds the export) and, where needed, the supporting
contracts that additionally bind the export (the DEP-003 durable
execution contract, the deployment topology contract, the RTN wave
governance and rulings, the merged authorities' own spec-cited surfaces).
Quoted text is verbatim; line numbers refer to the files as merged at
the RTN-011 base (`main @ 4ac6792`).

Exported symbol count: **38** (enumerated from `bindings.ts` (14),
`scheduler-wiring.ts` (8), `probes.ts` (8), `durable-binding.ts` (8)).
Table rows: **38**. The counts match. (The module has no public barrel;
the four modules are the surface. Test files and the transition module's
ambient `bun-test.d.ts` are test tooling per the RTN-001 convention —
"Not a protocol type: no spec citation applies".)

## Recorded interpretation decisions

1. **Bindings drive the authorities' OWN command surfaces — no protocol
   semantics are re-implemented.** TOPO line 188: "mutated only by
   transition-runtime through protocol-owned transitions — no other layer
   may mutate it directly". Each binding's `execute()` calls the merged
   authority's command method (which writes its A15 record internally,
   first — A15 lines 62-64) and then the injected durable write-through.
   The hosting module holds no state machine of its own.
2. **The rails evidence registry-name adapter** (`adaptRailEvidenceToRegistryNames`):
   the merged A13 modules submit evidence under their local constant
   `'Rail Adapter Authority'` (the v0.1 Area 13 prose name), while the
   real A15 log validates against the registry's closed set, which names
   area 13's owning authority `'Rail Authority'`
   (`spec/registry/protocol-registry.json` A13: owningAuthority
   "Rail Authority"; `evidence/record.ts` EVIDENCE_AUTHORITIES). The
   merged rails suites composed the authorities over rails' own
   in-surface evidence double, so this seam was never exercised before
   RTN-011. The adapter maps the local name onto the REGISTRY name at
   the hosting boundary (the record's authority slot becomes the
   registry's owning authority identity — what A15 requires); it is
   flagged for governed reconciliation in the completion report.
3. **Command bodies are JSON-representable records revived through the
   kernel guards (GC-1).** The durable command path stores payloads as
   JSON text (DEP-003 §6: "Payloads are stored as JSON text and
   round-trip as parsed values"); the bindings re-mint kernel Money
   values through `money()` on the revived read path — exactly the
   per-domain persistence read bridges' discipline.
4. **Persist hooks are injected, idempotent, and optional in bun.** The
   merged persistence convention (WAVE: "each authority domain owns its
   schema and per-domain migrations inside its owned prefix, using the
   DEP-003 database layer read-only") is a write-through bridge per
   domain. Bun suites construct bindings without hooks (bun does not
   implement node:sqlite — the documented split); the Node harness and
   the server runtime inject them via `durable-binding.ts`. Every hook
   is read-diff-write (INSERT-ON-CONFLICT / state UPDATE) so at-least-once
   redelivery re-persists without duplication.
5. **The recurring tick bodies derive wholly from tick identity.** The
   tick window `[tick·interval, (tick+1)·interval)` — not the wall-clock
   reading — is the command's subject identity (DEP-003 §10: "Tick
   identity is derived from wall-clock time: tick = floor(now /
   intervalMs)"), so command consumers (e.g. the reconciliation cycle id
   from (windowStart, windowEnd, ruleVersion)) are idempotent per
   window. Interval defaults are configuration starting points (TOPO
   line 158: "schedules are configuration").
6. **INV-11-1's probe recomputation uses the proof's signed convention.**
   A gross obligation contributes −amount for its debtor and +amount for
   its creditor; a net position carries its signed net; per currency and
   per participant, Σnet must equal Σgross (the recorded proof's own
   `grossPerParticipant`/`netPerParticipant` convention —
   clearing-netting-settlement.md lines 180-183 and the merged
   CurrencyConservationRecord shape).
7. **The scheduler wiring is structurally mutation-free.** It imports
   only kernel and substrate-scheduler modules (machine-checked in
   `hosting/boundary-review.test.ts` scan (b)) and holds only the
   enqueueing port — "It owns timing, not semantics: no state mutation,
   no rail access, no protocol decisions" (TOPO line 217).
8. **`openTransitionSubstrate` composes the substrate's individually
   loadable public modules.** The barrel's own doc marks it
   bundler-load-only (extensionless imports; "the underlying modules
   (db/queue/worker/scheduler/events) are individually loadable in plain
   Node and are exercised that way by scripts/test_durable.mjs"); the
   composition mirrors `init()`'s public wiring (queue lifecycle events
   under SUBSTRATE_EVENT_OWNER, worker over the queue, tracked
   schedules) without touching any substrate internal.

## Contract review table

Legend — `TOPO` = `spec/deployment/topology.md`; `A15` =
`spec/architecture/v0.1/evidence-risk-compliance.md`; `CORE` =
`spec/architecture/v0.1/core.md`; `LCQ` =
`spec/architecture/v0.1/liquidity-credit-queues.md`; `CNS` =
`spec/architecture/v0.1/clearing-netting-settlement.md`; `RAR` =
`spec/architecture/v0.1/rails-adapters-reconciliation.md`; `DEP-003` =
`spec/durable/execution.md`; `SUBSTRATE` = `src/lib/durable/index.ts`;
`WO` = `spec/protocol-runtime-work-orders/RTN-011.md`; `WAVE` =
`spec/protocol-runtime-work-orders/README.md`; `RULINGS` =
`spec/development-state/rtn-plan-rulings.md`; `COMPONENTS` =
`deploy/contracts/components.json`; `REGISTRY` =
`spec/registry/protocol-registry.json`; `ENVELOPE` =
`src/lib/protocol-runtime/kernel/envelope.ts`.

### bindings.ts — the concrete authority command bindings

| # | Export | Kind | Source (quoted line) | Supporting contracts | Notes |
|---|--------|------|----------------------|----------------------|-------|
| 1 | `IntentPersistHook` | type | WO line 14: "commit state atomically" (the durable write-through lands after the A15 record) | WAVE "Persistence convention" (per-domain stores, DEP-003 db layer read-only); intent/persistence.ts (the merged bridges: ON CONFLICT DO NOTHING / state UPDATE) | Idempotent intent+receipt write-through |
| 2 | `ReservationsPersistHook` | type | WO line 14 ("commit state atomically") | WAVE persistence convention; reservations/persistence.ts persistLedgerSnapshot; CORE lines 306-312 (INV-5-2/5-3 — the artifacts) | Snapshot write-through; readLedgerEntries feeds restart rehydration |
| 3 | `ObligationsPersistHook` | type | WO line 14 ("commit state atomically") | WAVE persistence convention; obligations/persistence.ts (INSERT-only — INV-10-1) | Append-only entry write-through (diff by sequence) |
| 4 | `SettlementPersistHook` | type | WO line 14 ("commit state atomically") | WAVE persistence convention; settlement/persistence.ts (INSERT + state UPDATEs; UNIQUE subject/instruction) | Read-diff-write over instructions/attempts/finalities |
| 5 | `ClearingPersistHook` | type | WO line 14 ("commit state atomically") | WAVE persistence convention; clearing/persistence.ts (writeBatch UPSERT, writeRecords) | batchLabel is an insert-only column; the open/tick command carries it first |
| 6 | `NettingPersistHook` | type | WO line 14 ("commit state atomically") | WAVE persistence convention; netting/persistence.ts | label insert-only; set + net obligations read-diff-write |
| 7 | `QueuesPersistHook` | type | WO line 14 ("commit state atomically") | WAVE persistence convention; queues/persistence.ts (writeQueue/writeQueuedItem) | Queue row + resident items |
| 8 | `AuthorityPersistHooks` | interface | WO line 14 ("commit state atomically") | WAVE persistence convention | The injected hook bundle (optional in bun — the documented split) |
| 9 | `HostedRailsAdapterSurface` | interface | RULINGS Q1, delta 1: "no code path in the adapter interface creates and mutates RailAdapter/RailOperation state" + RAR Area 13 Owning authority: "Rail Adapter Authority (protocol layer, area 13) owns adapter registry and operation lifecycle." | WO line 26 (the single-writer review includes the rails surface) | The A13 command surface the hosting drives (register/activate/authorize/submit); the REAL authority in Node, never the adapter interface |
| 10 | `HostedReconciliationCycleSurface` | interface | RAR Area 14 (the cycle model: open/collect/match/close) | WO line 18 ("reconciliation cycles" among the recurring ticks) | The A14 cycle command surface for the tick commands |
| 11 | `AuthorityHostingDeps` | interface | SUBSTRATE lines 14-18 ("Future protocol authorities plug in via register() ...") | The merged authorities' constructor surfaces (evidence port, ports, wallClock) | Every member optional — the hosting composes whichever authorities the runtime hosts |
| 12 | `SettlementRailsReportSurface` | interface | RAR Area 13: "Adapters translate protocol-authorized instructions into external actions and report external results back — including UNKNOWN — without ever owning protocol financial state." | WO line 26 | recordReport through the A13 command surface (never the adapter interface) for the report-driven confirmed path |
| 13 | `createAuthorityCommandBindings` | function | SUBSTRATE lines 14-18 (the hosting pattern at the integration point) | WO lines 14-16; CORE lines 57-62 (INV-1-2/1-3), 304-312 (INV-5-x); CNS lines 119-121 (INV-10-3), 247-262 (INV-12-2/3/4) — the INV-x-3 disciplines the bindings preserve | One binding per command kind (intent, reservations, obligations, settlement, rails, clearing, netting, queues, reconciliation); duplicate-kind guard |
| 14 | `enqueueCommand` | function | ENVELOPE commandEnvelopeToEnqueueInput: "Map a validated command envelope 1:1 onto the DEP-003 enqueue contract." | DEP-003 §6 lines 125-133; RULINGS delta 5 (the re-scope: the item's own test harness enqueues through the substrate's PUBLIC enqueue API; production admission remains exclusively RTN-010's gateway) | The harness admission path; scheduler ticks enqueue via scheduleRecurring |

### scheduler-wiring.ts — the recurring command emitters

| # | Export | Kind | Source (quoted line) | Supporting contracts | Notes |
|---|--------|------|----------------------|----------------------|-------|
| 15 | `SchedulerSubstratePort` | interface | TOPO line 217: "Scheduler boundary. `scheduler` emits timing-driven commands into the durable queue. It owns timing, not semantics: no state mutation, no rail access, no protocol decisions." | DEP-003 §10/§13 (scheduleRecurring) | The enqueueing-only port the wiring holds |
| 16 | `TickWindow` | interface | DEP-003 §10 lines 194-196: "Tick identity is derived from wall-clock time: `tick = floor(now / intervalMs)`" | DEP-003 §10 lines 198-204 (at-most-one per tick; no backfill) | [tick·interval, (tick+1)·interval) — the command's deterministic subject identity |
| 17 | `RecurringCommandScheduleConfig` | interface | TOPO line 158: "Rollback (contract): redeploy the previous artifact; schedules are configuration, so no data recovery is involved." | DEP-003 §10 ("A schedule's identity must be STABLE across restarts") | kind, authority, stable scheduleId, cadence, body builder |
| 18 | `RECURRING_COMMAND_SCHEDULES` | const | WO line 18: "Scheduler wiring pattern for recurring ticks (clearing batches, netting cycles, reconciliation cycles, queue eligibility scans) using scheduleRecurring" | CNS Area 9 (clearing batches), Area 11 (netting cycles); RAR Area 14 (reconciliation cycles); LCQ Area 8 (queue eligibility scans) | The four canonical tick schedules (frozen list) |
| 19 | `tickWindowFor` | function | DEP-003 §10 lines 194-196 (tick identity derivation) | — | Validates tick ≥ 0 and interval > 0; pure |
| 20 | `tickCommandEnvelope` | function | ENVELOPE CommandEnvelope.subjectIds doc: "may be empty: e.g. scheduler tick commands address no prior subject object" + DEP-003 §10: "the per-tick idempotency key is `scheduleId + ':' + tickId`" | ENVELOPE (the 1:1 enqueue mapping — the command's dedupe identity equals the scheduler job's) | idempotencyKey = the substrate scheduler's own per-tick key; protocolTime sequences by tick |
| 21 | `WiredRecurringCommandSchedule` | interface | DEP-003 §10/§13 (scheduleRecurring(kind, payloadFn, intervalMs, { scheduleId })) | — | tickOnce/stop control over one wired schedule |
| 22 | `wireRecurringCommandEmitters` | function | WO line 24: "Recurring-tick jobs emit commands only (no direct state mutation from scheduler callbacks)." | TOPO lines 156-157 ("owns timing only, never mutates authoritative state"); DEP-003 §10 (distinct scheduleIds mandatory) | One scheduleRecurring per config; payloadFn builds envelopes; shared-scheduleId rejected |

### probes.ts — the health-signal probes

| # | Export | Kind | Source (quoted line) | Supporting contracts | Notes |
|---|--------|------|----------------------|----------------------|-------|
| 23 | `TransitionBacklogSnapshot` | interface | COMPONENTS transition-runtime health_signal: "Transition backlog depth and age; authoritative-state consistency probes (contract for the future work item)." | TOPO line 149 | depth (waiting+in-flight), dead-letter count, creation age, eligibility age (clamped) |
| 24 | `transitionBacklogSnapshot` | function | COMPONENTS transition-runtime health_signal ("Transition backlog depth and age") | DEP-003 §16 ("Observability: queue.stats() returns per-status counts") | Pure read over TransitionQueueInsights |
| 25 | `ConsistencyProbeViolation` | interface | WO line 25: "Consistency probes verify ledger identities (INV-5-1, INV-6-1, INV-11-1) over persisted state." | — | probe id, subject, deterministic problem |
| 26 | `ConsistencyProbeResult` | interface | WO line 25 (the probe contract) | COMPONENTS transition-runtime health_signal ("authoritative-state consistency probes") | probe, verbatim invariant text, holds, inspected, violations |
| 27 | `probeReservationLedgerIdentity` | function | CORE lines 304-306: "INV-5-1 (financial correctness): for every resource, available = declared total minus held minus consumed, computed in integer Money; the identity holds after every transition." | WO line 25 ("over persisted state") | Verifies the arithmetic identity AND the cross-artifact recomputation (accounting rows vs reservation records) |
| 28 | `probeLiquidityPoolIdentity` | function | LCQ lines 52-55: "INV-6-1 (financial correctness): pool total equals the integer sum of its positions at all times; per position, available + reserved + consumed arithmetic is exact and integer." | WO line 25 | Per-position identity + pool-total vs Σ positions |
| 29 | `probeNettingConservation` | function | CNS lines 180-183: "INV-11-1 (financial correctness, conservation): for every currency in the set, the integer sum of net positions equals the integer sum of gross obligations; the check is recorded in the set's proof before commit." | WO line 25 | Verifies the recorded proof AND recomputes both sums (signed convention — decision 6) |
| 30 | `runLedgerIdentityProbes` | function | COMPONENTS transition-runtime health_signal: "authoritative-state consistency probes" | WO line 25 (the three named identities) | Runs all three over the persisted-read inputs |

### durable-binding.ts — the REAL substrate binding (Node/server only)

| # | Export | Kind | Source (quoted line) | Supporting contracts | Notes |
|---|--------|------|----------------------|----------------------|-------|
| 31 | `TransitionSubstrateRuntimeHandle` | interface | SUBSTRATE (DurableRuntime public surface: register/enqueue/recordEvent/scheduleRecurring + database + queue) | WO line 6 ("integration via register()/enqueue/db API only") | The structural handle both the barrel runtime and the Node composition satisfy |
| 32 | `OpenTransitionSubstrateOptions` | interface | DEP-003 §2 lines 48-50 ("Worker defaults (overridable at `init()`)") | SUBSTRATE DurableInitOptions (the mirrored option names) | dbPath/migrationsDir/worker/concurrency/lease/poll/backoff |
| 33 | `HostedDurableSubstrate` | interface | SUBSTRATE DurableRuntime: "register(kind, handler) ... enqueue ... recordEvent ... scheduleRecurring ... Full teardown: stop() then close the database." | DEP-003 §9 (worker), §10 (schedules) | The composition handle: + worker + scheduleRecurring + close() |
| 34 | `openTransitionSubstrate` | function | SUBSTRATE lines 20-25: "the underlying modules (db/queue/worker/scheduler/events) are individually loadable in plain Node and are exercised that way by scripts/test_durable.mjs" | DEP-003 §11 (lifecycle events under SUBSTRATE_EVENT_OWNER); scripts/test_durable.mjs (the precedent) | Composes the public modules with init()'s wiring — decision 8; nothing outside the public API is touched |
| 35 | `asTransitionSubstrate` | function | SUBSTRATE lines 14-18 (the documented integration point) | COMPONENTS transition-runtime health_signal (the backlog SELECTs over the db API) | Adapts a runtime handle onto TransitionSubstrate (register/enqueue/recordEvent + read-only queue insights) |
| 36 | `asSchedulerSubstrate` | function | TOPO line 217 ("It owns timing, not semantics") | DEP-003 §10/§13 (scheduleRecurring) | Adapts a runtime handle onto the enqueueing-only scheduler port |
| 37 | `adaptRailEvidenceToRegistryNames` | function | REGISTRY A13: owningAuthority "Rail Authority" (the registry's closed authority names the A15 log validates against — evidence/record.ts EVIDENCE_AUTHORITIES) | RAR Area 13 (the local prose name "Rail Adapter Authority"); decision 2 | Maps the A13 local constant onto the registry name at the hosting boundary; flagged for governed reconciliation |
| 38 | `buildDurablePersistHooks` | function | WAVE "Persistence convention": "each authority domain owns its schema and per-domain migrations inside its owned prefix, using the DEP-003 database layer read-only." | WO line 14 ("commit state atomically"); the merged per-domain bridges | Read-diff-write idempotent hooks over the open per-domain stores — decision 4 |

## Verification

- `bunx tsc --noEmit` — 0 errors.
- `bun test` — green (the merged suites untouched; this module's suites:
  `hosting/bindings.test.ts`, `hosting/scheduler-wiring.test.ts`,
  `hosting/probes.test.ts`, `hosting/boundary-review.test.ts`).
- `scripts/test_protocol_transition_hosting.mjs` — the REAL substrate
  compositions (public enqueue API, real authorities incl. the
  SQLite-authoritative rails, real lease reclaim, real child-process
  kill/restart, real scheduleRecurring, real probes over persisted
  state) all green.
