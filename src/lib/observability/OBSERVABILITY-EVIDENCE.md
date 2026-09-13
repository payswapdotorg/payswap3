# DEP-007 — Observability evidence: telemetry, health, backup/restore/replay, and the drills

Work order: `spec/system-work-orders/DEP-007.md` — "Observability,
resilience and disaster recovery"; required evidence: "Backup/restore
drill, worker restart drill, replay/recovery test, evidence-integrity
verification and failure-injection results."

This document is the observability family's evidence surface (alongside
the family barrel `src/lib/observability/index.ts`, the recovery family
`src/lib/recovery/`, the drill harness
`scripts/test_observability_resilience.mjs`, and the contract
`spec/deployment/observability.md`). It records WHAT the families do, the
disciplines that make them safe, and the ACTUAL drill runs and numbers.

- Base: main @ 663b1d4c4e3f1e4b9ebdd2b2758520cb5d8067ed (DEP-003/DEP-004/
  DEP-005 merged — the work order's dependency gate; the spec status line
  "BLOCKED" is stale, superseded by the dispatch).
- Form: in-process first (the DEP-001/002/003/RTN-012/DEP-004/DEP-005
  precedent) — the observability and recovery surfaces run as module
  families over the DEP-003 durable substrate, the DEP-004 operational
  jobs, the DEP-005 rail connectivity boundary and the RTN-010 gateway
  (all read-only integration: import + the documented public API; nothing
  in `src/lib/durable/`, `src/lib/operations/`,
  `src/lib/rail-connectivity/` or `src/lib/protocol-runtime/` is
  modified). The externalized telemetry binding (metrics endpoints,
  alerting, external tracing) is recorded FUTURE-WORK (DEP-002+) — the
  CONTRACT-DELTA PROPOSAL in the completion report carries the exact
  fields.
- Harness: `scripts/test_observability_resilience.mjs` (plain Node ≥ 22.6,
  node:sqlite + type stripping; exit 0 = all drill groups green; run three
  consecutive times — identical results, 30 scenarios / 483 assertions
  each run).

## The drill report (the actual numbers)

| Drill | Scenarios | Assertions | Result |
|---|---|---|---|
| `drill:family-barrels` | 2 | 242 | PASS |
| `drill:backup-restore` | 5 | 48 | PASS |
| `drill:worker-restart` | 2 | 19 | PASS |
| `drill:replay-recovery` | 4 | 30 | PASS |
| `drill:failure-injection` | 7 | 31 | PASS |
| `drill:evidence-integrity` | 3 | 13 | PASS |
| `drill:telemetry-taxonomy` | 7 | 100 | PASS |
| **TOTAL** | **30** | **483** | **PASS** |

## The family surfaces (what DEP-007 owns)

| Module | Duty | The work-order acceptance it delivers |
|---|---|---|
| `observability/taxonomy.ts` | the closed NINE-domain discriminated union (definition · owning signals · deriving query per domain) + the `ObservationOnly` brand | "Runtime telemetry distinguishes command, queue, execution, UNKNOWN, reconciliation, clearing/netting, settlement/finality, incident/recovery and deployment health" — the closed union IS the distinction, compiler-enforced by the exhaustive `DOMAIN_DEFINITIONS` Record |
| `observability/telemetry.ts` | `collectTelemetrySnapshot` — the pure per-domain derivations (queue depth by status, oldest queued age, dead-letter count, lease-expired reserved jobs, attempt histogram, event counts by owner/type over the window, the rail activity rollup, reconciliation-sweep freshness via the operations progress reader, the recovery journal) | the same bullet — every domain's state is DERIVED from recorded events, never guessed |
| `observability/health.ts` | the actionable model: `ok \| degraded \| down \| unknown-data`, a REQUIRED action descriptor on every non-ok state (fail-closed construction), the severity ordering `ok < degraded < unknown-data < down`, and the worst-of composite rollup | "Health/readiness states are actionable" |
| `observability/logging.ts` | structured JSON-lines logging, leveled, with the fail-closed credential-reference scrubber (NAMES are sensitive) over in-process sinks (console + a bounded queryable ring buffer) | the logging half of "health/metrics/logging/tracing" |
| `observability/tracing.ts` | `trace()` — id-based correlation of command → queue → execution → effects over the ids the substrate already records | the tracing half |
| `observability/readiness.ts` | `probeComponentHealth` — the derivation behind the ADDITIVE `/api/ready` enrichment (the existing fields and status codes byte-identical; `/api/health` untouched — the F6 separation preserved) | "Health/readiness states are actionable", wired |
| `recovery/backup.ts` | the verified ONLINE backup (VACUUM INTO through the substrate handle, WAL-checkpoint discipline, immediate read-only verification, the append-only JSONL manifest with per-row evidence digests) | "Backup and restore are automated/tested" |
| `recovery/restore.ts` | restore INTO A TARGET COPY (never in place) with the fail-closed battery: integrity_check, migration checksums (backup record AND repository files), event/journal continuity (no restore-introduced gaps), evidence-integrity re-verification with the tampered row identified; `verifyEvidenceIntegrity` standalone | "Backup and restore are automated/tested"; "Evidence integrity is checked after restore" |
| `recovery/replay.ts` | recovery replay THROUGH THE EXISTING worker/queue API (`bindDurableRuntime` composes the exported `DurableQueue`/`DurableWorker`; the drain-until-settled loop with lease-expiry redelivery; the idempotency report) | "Queue and worker recovery are proven"; "Event/journal replay preserves idempotency" |
| `recovery/journal.ts` | the family's audit identity (owner `incident-recovery`) + the audit port | the incident/DR narrative on the durable_events home |

## The forbidden boundary (the work order's forbidden clause)

Telemetry is observation only — never financial evidence, never an
authoritative-state input, never a protocol-authority weakening. Enforced
four ways: (1) the `ObservationOnly` type brand on every telemetry value;
(2) no observability module calls `recordEvent` or value-imports the
queue/worker — machine-checked by the harness's static discipline scan
(242 assertions in `drill:family-barrels`, of which the scan is the bulk);
(3) the recovery family's only durable writes are its own audit rows under
its own owner identity; (4) the drills assert that injected rail failures
mutate NEITHER the durable_jobs table NOR the A15 evidence log
(`drill:failure-injection` scenario 7). Finality is never reversed by
recovery and evidence is never edited — restore preserves append-only
history and the tamper drill orders quarantine, never in-place repair.

## The nine domains — signal → query → example value (from the drill runs)

One populated drill store (the `drill:backup-restore` population: 12 jobs
across every reachable status incl. one dead_lettered and one reserved
zombie; 46 events from four owners; one verified backup):

| Domain | Signal → query | Example value (drill run) |
|---|---|---|
| command | `operations.command.submitted` count + command-kind job depth | `submissionsInWindow=3, createdInWindow=3, refusedInWindow=0, commandJobsQueued=3, oldestCommandJobQueuedAgeMs=26` |
| queue | `GROUP BY status` over durable_jobs + MIN(available_at) + expired-lease count + attempt histogram | `depthByStatus={queued:4, reserved:1, succeeded:6, failed:0, dead_lettered:1}, oldestQueuedAgeMs=26, attemptHistogram=[{attempts:0,count:11},{attempts:1,count:1}]` |
| execution | lifecycle event counts in window + mean attempts of succeeded | `succeededInWindow=6, attemptFailedInWindow=1, deadLetteredInWindow=1, meanAttemptsOfSucceeded=0` (the trimmed drill composition hosts no transition runtime, so `protocol.command.executed` observations are 0 there — an honest property of the composition, noted; the query covers them and the full-runtime counts are exercised by test_operations.mjs) |
| unknown | rail UNKNOWN-class event counts + `operations.unknown.held` | `railUnknownSurfacedInWindow=1, unknownHeldInWindow=1, totalInWindow=2`; in `drill:failure-injection`: `transportFailures=6, timeouts=1, surfaced=1, retransmissions=3, totalInWindow=8` |
| reconciliation | progress-reader sweep completions → freshness | `lastSweepCompletedAt=<run time>, sweepFreshnessMs=25, sweepRunsInWindow=1, investigateSubmissionsInWindow=1` |
| clearing-netting | progression completions + `clearing.`/`netting.` emissions | `lastClearingRunAt≠null, clearingCommandsInWindow=1, nettingCommandsInWindow=0 (the fixture has no cohort)` |
| settlement-finality | `settlement.*` emissions + queued settlement jobs + UNKNOWN-held | `settlementCommandsInWindow=1, settlementJobsQueued=1, oldestSettlementJobQueuedAgeMs=11, unknownHeldInWindow=1` |
| incident-recovery | `recovery.*` events + the manifest | `backupsInWindow=1, lastBackupAt≠null, backupFreshnessMs=1, manifestBackupsTotal=1, tamperDetectedTotal=0` |
| deployment | frozen environment signal + WAL + migrations + backup age | `environment=sandbox, journalMode=wal, migrationsApplied=1, migrationNames=[0001_durable_execution.sql], lastBackupAgeMs=1` |

## Health model evidence (degraded/down cases with their actions)

- **Composite degraded** (the populated store): worst-of witnesses
  `['queue','execution','unknown','settlement-finality']` — queue
  degraded (dead-lettered=1), execution degraded (attempt failure in
  window), unknown degraded (UNKNOWN-class events), settlement-finality
  degraded (UNKNOWN-held: finality blocked pending reconciliation). Each
  carries its action descriptor, e.g. unknown → inspect the rail activity
  records + the A14 cases, drill `drill:failure-injection`, runbook
  §UNKNOWN discipline.
- **Composite down** (`drill:evidence-integrity` scenario 3): a recorded
  `recovery.tamper.detected` event → incident-recovery DOWN with the
  QUARANTINE action (inspect the tampered rows + restore from the last
  verified backup; never repair in place), composite DOWN with
  `worstDomains=['incident-recovery']` — while execution stayed ok: ok
  never masks down.
- **Composite unknown-data** (fresh store + `drill:failure-injection`):
  reconciliation and clearing-netting have never run → unknown-data with
  actions (trigger the sweep / inspect the registration); the composite
  reports unknown-data, not ok (fail-closed: cannot see).
- **Readiness projection**: degraded composites still project `ready`
  (the F6 configuration checks stay the readiness authority); the
  `/api/ready` enrichment carries the composite + per-domain states and
  NEVER flips a status code (additive-only wiring; `/api/health`
  byte-identical, untouched).

## Backup/restore/replay evidence (exact outputs)

- **Manifest row** (drill run): `{backupId: "backup-<epoch-ms>",
  sourcePath: <store>/durable.sqlite, backupPath: <store>/backup-1.sqlite,
  byteSize: 61440, sha256: <64 hex>, createdAt: <epoch-ms>, migrations:
  [{name: "0001_durable_execution.sql", checksum: <64 hex>}], jobCount: 12,
  eventCount: 46, evidenceRootDigest: <64 hex>, evidence: [46 digests],
  integrityCheck: "ok", migrationChecksumsMatch: true,
  evidenceDigestsMatch: true}` — the manifest JSONL holds exactly one row
  after one backup; a duplicate backupId is refused (append-only).
- **Integrity output**: restore verification = `integrityCheck: "ok"`,
  `migrationsMatch: true`, `repoMigrationsMatch: true`,
  `evidenceIntegrity: {ok: true, verifiedCount: 46, mismatches: []}`,
  continuity = `{ok: true, gaps: [], expectedEventIds: 46 ids,
  restoredEventIds: the same 46 ids positionally}`; the source store gained
  exactly the two recovery audit rows (backup.completed +
  restore.verified) while the restored target holds exactly the backup's
  46 events (restore appends nothing).
- **Idempotency assertion counts** (`drill:replay-recovery`): 2 journal
  submissions of the investigate command K across the crash + replay
  (first `created:true, replayed:false`; replay `created:false,
  replayed:true`; identical deterministic key
  `idem.v1.768b4f…`); exactly 1 durable command job for K after replay; 1
  sweep job row after the same-cycle trigger re-drive (`created:false`,
  reason `deduplicated`); 1 UNKNOWN-held event; 0 submissions for the
  UNKNOWN-held subject; 2 sweep `job.completed` rows (the at-least-once
  narrative) with ONE effect.
- **Tamper-detection output**: `verifyEvidenceIntegrity` on the tampered
  copy → `{ok: false, mismatches: [{eventId: <the tampered row>, 
  expectedDigest: <64 hex>, actualDigest: <64 hex>}]}` — the row is
  identified by eventId; the restore refuses a tampered artifact at BOTH
  manifest gates (path identity, then sha256 receipt).
- **Worker restart**: the killed job completes after the restart with
  `attempts=1`, `reservedBy=null`, exactly one effect event and one
  `job_succeeded`; the crashed-after-effect job completes on its backoff
  redelivery with `attempts=1` and one effect; zero zombie reservations.

## The honest boundaries

1. **The trimmed drill composition.** The drills compose the real
   substrate, the real gateway, the real operational jobs and the real
   rail connectivity boundary, but NOT the full authority matrix of
   test_operations.mjs — the operational read surface is a deterministic
   harness fixture satisfying `OperationalReadSurface` structurally (the
   composition-root binding the family's own design documents), and the
   settlement commands land in the recorded D-2 admitted-but-queued class
   rather than executing end-to-end. The A14/authority semantics remain
   proven by the merged suites; the drills prove the OBSERVABILITY and
   RECOVERY properties over the same substrate.
2. **No external telemetry backend.** Logs are in-process (console + ring
   buffer); metrics are the snapshot derivation; tracing is id-based
   correlation. External binding is the recorded DEP-002+ FUTURE-WORK.
3. **The `/api/ready` route wiring itself** is compile- and
   build-verified (the route compiles and builds as a dynamic route with
   the additive field); the probe derivation (`probeComponentHealth`)
   is drill-verified with an explicit database handle (taxonomy drill
   scenario 5). The route's behavior under the Next server runtime is
   exercised by `bun run build`, not by a live HTTP drill.
4. **Timing realism.** Lease-expiry drills use real wall-clock sleeps
   (40 ms leases, 60 ms waits) — deterministic in outcome (all counts
   asserted), variable only in the millisecond timestamps.

## Sandbox boundary (stated honestly)

The evidence demonstrates behavior under the sandbox topology (simulated
rails via the scripted transport double, no credentials, fail-closed). It
is NOT production disaster recovery and does not claim to be: the real
backup scheduling, the production secret scope, and the externalized
restore rehearsal are the recorded FUTURE-WORK (DEP-002+), carried in the
completion report's CONTRACT-DELTA PROPOSAL.
