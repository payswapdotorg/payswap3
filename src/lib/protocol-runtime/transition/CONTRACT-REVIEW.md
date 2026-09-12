# RTN-011 — Transition runtime contract review

Work order: `spec/protocol-runtime-work-orders/RTN-011.md`
Owned surface: `src/lib/protocol-runtime/transition/`
Rule: **every exported type/function/constant maps to a cited spec source
(file + section + quoted line); rows with no source are forbidden.**

Method: each row lists the primary source (file, section, line, and the
quoted line that grounds the export) and, where needed, the supporting
contracts that additionally bind the export (the DEP-003 durable
execution contract — the substrate this item integrates on, the
deployment topology contract, the RTN wave governance, the work order
itself). Quoted text is verbatim; line numbers refer to the files as
merged at the RTN-011 base (`main @ 4ac6792`).

Exported symbol count: **11** (enumerated from `substrate-port.ts`,
`execution.ts`, `substrate-double.ts` — the module has no public barrel;
the three modules are the surface). Table rows: **11**. The counts match.
(`bun-test.d.ts` is ambient test tooling per the RTN-001 kernel
convention — "Not a protocol type: no spec citation applies" — and
exports no symbols.)

## Recorded interpretation decisions

1. **The substrate port is structural, not the barrel type.** The work
   order's integration rule is `src/lib/durable/` "read-only integration:
   import + register()/enqueue/db API". The transition core depends on a
   narrow structural interface (`TransitionSubstrate`) satisfied by the
   barrel runtime (Next.js server) and by
   `hosting/durable-binding.ts`'s composition (plain Node) — the barrel
   itself documents that its extensionless imports make it
   bundler-load-only ("the underlying modules ... are individually
   loadable in plain Node"). All substrate imports in this module are
   `import type` (erased at load), which also keeps the module loadable
   in the bun test runtime (bun does not implement node:sqlite — the
   repository's documented split; the REAL substrate compositions run in
   `scripts/test_protocol_transition_hosting.mjs`).
2. **"Dequeue" is the substrate worker's reservation+dispatch.** The
   acceptance path's first step is performed by the substrate's worker
   (execution.md §9: it "reserves exclusively jobs whose kind has a
   registered handler" and dispatches to the handler); the transition
   runtime IS that registered handler (`executeCommand`). No second
   dequeue mechanism exists.
3. **Typed rejections are completed executions; exceptions fail the
   operation.** The merged authorities' `{ok:false, code}` convention is
   a deterministic protocol decision — retrying it would only burn
   attempts, so the job completes and the rejection is observable in the
   authority-owned observation row. Any exception (induced A15
   evidence-write failure, persist failure, TypeError) propagates so the
   substrate's bounded-retry/dead-letter path applies — "failure fails
   the operation" (RTN-011.md line 14). This split is recorded as the
   item's reading of "failure".
4. **The observation row is delivery narration, not the authoritative
   evidence.** The A15 record (written inside each authority's command,
   first) is the authoritative evidence and is exactly-once by INV-15-4
   write keys; the `recordEvent` row records each DELIVERY of a command
   under the owning authority's owner identity (the documented
   integration point: "own their own evidence via recordEvent(type,
   data, owner)"). At-least-once redelivery may therefore append a
   second observation row for the same command (status 'replayed') while
   the financial effect and the A15 record remain exactly-once — the
   tests assert precisely this.
5. **The substrate double mirrors §5-§12 of execution.md** (states,
   dedupe, reservation/lease/redelivery, bounded deterministic backoff,
   registered-kinds-only worker, mandatory event owner) at the documented
   simplification of sequential dispatch inside `tick()` (the real
   worker's bounded-concurrency slot discipline is a substrate-internal
   concern proven by DEP-003's own harness; the double models
   concurrency 1, the substrate default). Crash-mid-execution is
   exercised through the queue's PUBLIC reserve/reclaimExpired surface —
   exactly how the Node harness drives the REAL substrate.
6. **`backlogExtremes` splits "age" into creation-age and
   eligibility-age.** The health signal names "Transition backlog depth
   and age" (components.json); the probe reports the oldest non-terminal
   job's creation age (how long the oldest unfinished command has been
   in the system) and the oldest waiting job's availability age (the
   reservation-lag signal), clamping future-dated (scheduled) jobs to 0
   — they are not backlogged, they are not yet due.

## Contract review table

Legend — `TOPO` = `spec/deployment/topology.md`; `A15` =
`spec/architecture/v0.1/evidence-risk-compliance.md`; `DEP-003` =
`spec/durable/execution.md`; `SUBSTRATE` = `src/lib/durable/index.ts`
(the documented integration point); `WO` =
`spec/protocol-runtime-work-orders/RTN-011.md`; `WAVE` =
`spec/protocol-runtime-work-orders/README.md`; `COMPONENTS` =
`deploy/contracts/components.json`; `ENVELOPE` =
`src/lib/protocol-runtime/kernel/envelope.ts` (the merged, spec-cited
command payload contract); `CORE` =
`spec/architecture/v0.1/core.md`.

### substrate-port.ts — the structural substrate port

| # | Export | Kind | Source (quoted line) | Supporting contracts | Notes |
|---|--------|------|----------------------|----------------------|-------|
| 1 | `TransitionQueueInsights` | interface | COMPONENTS transition-runtime health_signal: "Transition backlog depth and age; authoritative-state consistency probes (contract for the future work item)." + TOPO line 149: "Health signal (contract): transition backlog depth/age; authoritative-state consistency probes." | DEP-003 §16 ("Observability: queue.stats() returns per-status counts") | Read-only stats + backlog extremes; backed by queue.stats() and static SELECTs over the db API |
| 2 | `TransitionSubstrate` | interface | SUBSTRATE lines 14-18: "register(kind, handler) is the single integration point; ... Future protocol authorities plug in via register() and own their own evidence via recordEvent(type, data, owner)." | DEP-003 §6 (enqueue), §9 (register), §11 (recordEvent owner); WO line 6 ("integration via register()/enqueue/db API only") | The narrow structural view: register/enqueue/recordEvent + queue insights; type-only substrate imports |

### execution.ts — the command execution path

| # | Export | Kind | Source (quoted line) | Supporting contracts | Notes |
|---|--------|------|----------------------|----------------------|-------|
| 3 | `COMMAND_EXECUTED_EVENT_TYPE` | const | SUBSTRATE lines 17-18: "own their own evidence via recordEvent(type, data, owner)" | DEP-003 §11 lines 214-218: "Protocol evidence remains owned by future protocol authorities: they record their own rows under their own owner identity via the same table and API." | The durable_events type of the authority-owned observation row; owner = the owning authority's registry name |
| 4 | `AuthorityCommandExecutionStatus` | type | WO line 16: "At-least-once redelivery safety: handlers are idempotent via each area's INV-x-3 key discipline (duplicate delivery returns recorded state, never a second effect)." | The merged authorities' typed-result convention (rejections emit no evidence) | 'applied' / 'replayed' / 'rejected' — the replay flag maps the INV-x-3 recorded-state returns |
| 5 | `AuthorityCommandOutcome` | interface | WO line 14: "Command execution path: dequeue a command → resolve the owning authority handler → apply the transition → write the A15 evidence record → commit state atomically" | A15 lines 62-64 (the atomic discipline the binding preserves) | The binding's reported outcome: status, typed rejection code, JSON-safe summary |
| 6 | `AuthorityCommandBinding` | interface | WO line 14 ("resolve the owning authority handler") | DEP-003 §9 lines 174-179: "register(kind, handler) is the ONLY integration point" | One hosted authority command: kind (1:1 onto durable_jobs.kind — ENVELOPE), authority target, owner identity, execute() |
| 7 | `TransitionRuntime` | class | TOPO line 148: "Authority hosted: authoritative state transitions — execution, clearing, obligations, netting, settlement, finality (protocol-owned) — applied as the single writer to authoritative-state-store." | TOPO line 188 ("mutated only by transition-runtime ... no other layer may mutate it directly"); A15 lines 62-64; WO lines 14-22 | The single authoritative-state writer's execution path: validate envelope → resolve binding → binding.execute (A15 first) → recordEvent observation |
| 8 | `createTransitionRuntime` | function | SUBSTRATE lines 14-18 (the integration point) | WO lines 14-20 | Composition entry point over substrate + bindings |

### substrate-double.ts — the owned in-surface substrate test double

| # | Export | Kind | Source (quoted line) | Supporting contracts | Notes |
|---|--------|------|----------------------|----------------------|-------|
| 9 | `SubstrateDoubleEvent` | interface | DEP-003 §11 lines 212-213: "`durable_events` is the defined, persistent home for event/evidence state. Every row carries a mandatory `owner` column" | The in-surface test-double convention (rails/evidence-test-double.ts, settlement/rails-test-double.ts) | The double's event row shape (owner mandatory) |
| 10 | `InMemoryDurableSubstrateOptions` | interface | DEP-003 §2 lines 48-50: "Worker defaults (overridable at `init()`): `concurrency` 1 (bounded), `leaseMs` 60000, `pollIntervalMs` 500, `maxAttempts` 5 per job, backoff base 1000 ms doubling to a 300000 ms ceiling." | DEP-003 §8 ("Backoff is deterministic (no jitter)") | Injectable clock/lease/backoff/job-id for deterministic bun suites |
| 11 | `InMemoryDurableSubstrate` | class | DEP-003 §5-§12 (the mirrored public contract: job lifecycle, dedupe, reservation/lease/redelivery, bounded retry, worker, events) | WO line 30 (required evidence categories (c)-(g) re-proven over the mirror); decision 5 | Implements TransitionSubstrate + the queue's public surface + a worker-like tick()/drain(); concurrency-1 dispatch (the substrate default) |

## Verification

- `bunx tsc --noEmit` — 0 errors.
- `bun test` — green (the merged suites untouched; this module's suites:
  `transition/execution.test.ts`, `transition/substrate-double.test.ts`).
- `scripts/test_protocol_transition_hosting.mjs` — the REAL substrate
  compositions (public enqueue API) all green.
