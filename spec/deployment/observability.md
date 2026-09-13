# PaySwap observability and disaster-recovery contract

**Work order:** DEP-007 — Observability, resilience and disaster recovery
**Status:** the in-process contract defined and evidenced by DEP-007 (`src/lib/observability/` + `src/lib/recovery/`); the externalized telemetry binding (metrics endpoints, alerting, external tracing) is FUTURE-WORK under DEP-002+
**Base:** main @ 663b1d4c4e3f1e4b9ebdd2b2758520cb5d8067ed (DEP-003/DEP-004/DEP-005 merged)
**Owned surfaces:** health/metrics/logging/tracing, backups, restore, replay and recovery automation
**Forbidden:** using telemetry as financial evidence or weakening protocol authority
**Companions:** `src/lib/observability/` (the taxonomy, telemetry, health, logging, tracing modules + `OBSERVABILITY-EVIDENCE.md`), `src/lib/recovery/` (backup, restore, replay), `scripts/test_observability_resilience.mjs` (the drill harness), `spec/deployment/topology.md` (the component health-and-rollback model this contract implements), `spec/deployment/environments.md` (F1–F8)

> Not yet referenced from the shared-governance surfaces (components.json /
> validate_deployment.py / topology.md): the Tech Lead wires the state and
> contract references at integration, using the CONTRACT-DELTA PROPOSAL in
> the work item's completion report.

## 1. The forbidden boundary (stated once, enforced everywhere)

**Telemetry is observation only: it never writes authoritative state, never decides financial outcomes, and is never financial evidence; observability never weakens protocol authority.**

Structural enforcement:

- Every telemetry value carries the `ObservationOnly` type brand (`src/lib/observability/taxonomy.ts`); no observability type satisfies the A15 five-slot record contract, so a snapshot can never be submitted as evidence.
- No module in `src/lib/observability/` calls `recordEvent`, value-imports the queue/worker, or imports the gateway, any authority, store or persistence surface — machine-checked by the drill harness's static discipline scan (`drill:family-barrels`).
- The recovery family (`src/lib/recovery/`) writes ONLY its own audit rows under its own owner identity (`incident-recovery`) on the store the composition root directs — the DEP-004/DEP-005 owner-identity precedent. It admits no protocol commands and touches no authoritative state.
- Finality is never reversed by recovery (topology R3); evidence is append-only and never rewritten (R4); recovery never bypasses protocol authorization — it replays authorized work through the existing queue/worker API (R5).

## 2. The nine-domain telemetry taxonomy

The closed union (`src/lib/observability/taxonomy.ts` — `OBSERVABILITY_DOMAINS`): `command | queue | execution | unknown | reconciliation | clearing-netting | settlement-finality | incident-recovery | deployment`. Each domain carries its definition, its owning substrate signals, and its deriving query (the exhaustive `DOMAIN_DEFINITIONS` table); the union is closed — a tenth domain is a governed change.

| Domain | Derives from (owning signals) | The deriving query |
|---|---|---|
| `command` | `operations.command.submitted` events (owner `operational-jobs`); `durable_jobs` rows of command kinds | admissions/replays/refusals over the window (+ refusal reason codes); command-job depth and oldest queued age |
| `queue` | `durable_jobs` status/available_at/lease_expires_at/attempts | depth by status; oldest queued age; dead-letter count; lease-expired reserved (zombie) count; attempt histogram |
| `execution` | substrate lifecycle events (`job_succeeded`, `job_attempt_failed`, `job_dead_lettered`, `job_lease_expired`); `protocol.command.executed` observations; attempts of succeeded jobs | lifecycle event counts in window; executed-observation count; mean attempts of succeeded |
| `unknown` | rail activity events (`rail.transmit.unknown-surfaced` / `.timeout` / `.transport-failure` / `.retransmitted`, owner `rail-connectivity`); `operations.unknown.held` | UNKNOWN-class event counts in window + the retry trail |
| `reconciliation` | the operations progress reader (`readOperationalJobProgress`) over `operations.job.completed` for the sweep kind; investigate submissions | sweep freshness (now − last completion); runs in window; A14 engagements |
| `clearing-netting` | progress-reader completions for the progression kinds; `clearing.`/`netting.` command submissions | per-kind freshness; emissions and refusals in window |
| `settlement-finality` | `settlement.` command submissions; executed `settlement.finality.declare` observations; queued settlement-kind jobs; `operations.unknown.held` | emissions and finality executions in window; queued settlement depth and age; UNKNOWN-held count |
| `incident-recovery` | the recovery family's own journal (`recovery.*` events, owner `incident-recovery`); the append-only backup manifest | backups/restores/replays in window; backup freshness; tamper detections (all-time — a violation never ages out) |
| `deployment` | the frozen environment signal (`PAYSWAP_ENV` allowlist, fail-safe sandbox); `PRAGMA journal_mode`; `schema_migrations`; backup recency | environment; WAL mode; applied migration set; last backup age |

All derivations are **pure functions of queries** (`collectTelemetrySnapshot`): no mutation, no side effects, no network; the only clock is the injected `now`. The snapshot records its own honesty bound (`eventRowsScanned`).

## 3. The health model

Per domain: `health ∈ ok | degraded | down | unknown-data`.

**Severity order (worst last):** `ok(0) < degraded(1) < unknown-data(2) < down(3)`. `unknown-data` outranks `degraded` deliberately: a domain whose state cannot be derived may be concealing a down state, so the composite never claims better than "we cannot see" (fail-closed).

**Every non-ok state is actionable.** Each carries a REQUIRED action descriptor — what to inspect, which drill applies, which runbook section (below). The rule is enforced structurally: `domainHealth()` refuses to construct a non-ok domain health without an action (an unactionable degraded/down state cannot exist).

**The composite is worst-of.** The component health is the maximum severity across all nine domains; `worstDomains` names the witnesses. An ok domain can never mask a degraded, unknown-data, or down domain. The `/api/ready` enrichment reports the composite via `readinessProjection`: ok/degraded → `ready`, unknown-data → `health-unknown`, down → `unhealthy` — the F6 configuration checks remain the readiness authority; the enrichment never flips a status code.

Thresholds are operational configuration (`HealthThresholds`), documented defaults per domain (e.g. oldest queued age 60 s; sweep freshness 600 s; backup freshness 3600 s; dead-letter down bound 5; UNKNOWN-storm down bound 10).

## 4. The backup/restore/replay contract

**Backup** (`recovery/backup.ts` — `createBackup`):
- ONLINE: `VACUUM INTO ?` through the substrate handle (parameterized; live, transactionally consistent), preceded by a WAL checkpoint (TRUNCATE).
- VERIFIED AT CREATION: the artifact is re-opened read-only — `PRAGMA integrity_check` must be `ok`, migration checksums must match the source, every `durable_events` row digest must match.
- MANIFESTED: one row appended to the append-only JSONL manifest — source path, byte size, artifact sha256, the `schema_migrations` applied set (name + checksum), event/job counts, the per-row evidence digest list and its ordered root digest, timestamp. The manifest is append-only (a duplicate `backupId` is refused).
- EVIDENCE INTEGRITY UNITS: per-row digest `sha256(eventId \n type \n owner \n dataText)` over the raw stored TEXT; root digest chains them in id order.
- AUDITED: one `recovery.backup.completed` row under owner `incident-recovery` on the composition root's store.

**Restore** (`recovery/restore.ts` — `restoreBackup`):
- NEVER IN PLACE: the artifact is copied to a FRESH target (clobbering and source-equal targets are refused); the artifact is authenticated against the manifest row (path + sha256) before anything is restored.
- OPENED THROUGH THE SUBSTRATE: `openDurableDatabase` (the migration runner's immutability check runs).
- VERIFIED, FAIL-CLOSED, in order: (1) `integrity_check` = ok; (2) migration set equals the backup record AND matches the repository files' checksums; (3) event/journal continuity — the target's ids equal the backup's ids exactly, strictly increasing, no restore-introduced gaps, every backup event present (append-only preserved); (4) evidence integrity — every per-row digest recomputed and compared; a tampered row is identified by eventId. Any failure closes the target and throws a typed `RestoreVerificationError` carrying the named failures — a partial restore is never returned.
- `verifyEvidenceIntegrity` is exported standalone (the tamper drill drives it directly).

**Replay** (`recovery/replay.ts`):
- NEVER BYPASSES THE SUBSTRATE: `bindDurableRuntime` composes the EXPORTED `DurableQueue`/`DurableWorker` classes over an explicit handle (the wrap-don't-patch rule); `replayRestoredQueue` registers the caller's handlers and drains via the worker's own loop (`tick` → `reclaimExpired` → reserve → execute → complete/fail with bounded backoff).
- IDEMPOTENT BY CONSTRUCTION: the substrate's `UNIQUE (idempotency_key, kind)` is the backstop — a replayed enqueue of the same (kind, key) is absorbed (`created: false`); a crash-redelivered job re-executes its handler whose effects are guarded by recorded receipts (one effect per key, ever). Cross-process re-submissions through a fresh gateway return the RECORDED receipt (`replayed: true`) — never a second effect.
- UNKNOWN IS NEVER RETRIED: redelivery happens only through lease expiry (the at-least-once substrate rule); a replay never re-drives a job BECAUSE its outcome was UNKNOWN — UNKNOWN surfaces to A14 reconciliation (the DEP-005 contract), and the settlement-support job audits UNKNOWN-held without submitting for the held subject.
- Finality is never asserted or reversed by recovery.

## 5. The drill catalog (`scripts/test_observability_resilience.mjs`)

| Drill | Scenarios | Proves |
|---|---|---|
| `drill:family-barrels` | 2 | both family barrels load under plain Node; the static discipline scan (no gateway/authority/store imports, no network primitives, no secret-shaped strings; observability additionally: no `recordEvent` call, never drives the operations machinery) |
| `drill:backup-restore` | 5 | populated store (all reachable job statuses incl. dead_lettered and a reserved zombie; events from four owners) → verified online backup → manifest row → restore into a fresh target → integrity + migration + continuity + evidence verification → append-only semantics → fail-closed refusals |
| `drill:worker-restart` | 2 | kill mid-flight (reserve → execute the atomic unit → never complete) and crash-after-effect (handler throws) → lease expiry / bounded backoff → restarted worker drains → exactly-once effects, no zombie reservations |
| `drill:replay-recovery` | 4 | sweep killed mid-flight after command admission → backup → restore → replay through the existing worker/queue API with a fresh gateway → UNIQUE(idempotency_key, kind) absorbs the re-submission (ONE command job; journal shows created then replayed receipts with the SAME key) → UNKNOWN surfaced not retried (zero submissions for the held subject) → the trigger re-drive is deduped |
| `drill:failure-injection` | 7 | DNS (pre-effect, retried), in-flight loss (never retried), credential refusal (never retried — F6), timeout (never retried), explicit UNKNOWN (never retransmitted), TLS exhaustion (bounded ×3) — telemetry lands them in the right domains, health is degraded with actions, and the durable_jobs table + A15 evidence log are untouched |
| `drill:evidence-integrity` | 3 | one tampered event row → the verifier fails closed identifying the row by eventId; a tampered artifact is refused at both manifest gates (path identity, sha256 receipt); a recorded tamper detection drives incident-recovery DOWN and the composite DOWN (worst-of) |
| `drill:telemetry-taxonomy` | 7 | taxonomy closure (nine domains × definition/signals/query); fresh-store unknown-data states; ALL NINE domains derive non-trivial state on a populated store; every non-ok domain is actionable; severity ordering + worst-of never masks; the readiness probe; the logging scrubber (credential-reference NAMES are sensitive); the trace() correlation |

## 6. Runbook sections (the action targets)

- **§Backup and restore contract** — backup freshness, manifest discipline, restore verification.
- **§Queue and worker recovery** — oldest queued age, unregistered kinds, lease-expiry redelivery.
- **§Worker restart drill** — zombie reservations, at-least-once effects.
- **§Dead-letter recovery** — bounded retries exhausted; replay/re-drive with recorded receipts.
- **§Command admission health** — refusal reason codes; admitted-but-queued commands (the recorded D-2 un-hosted vocabulary subset or a binding outage).
- **§Admitted-but-queued commands** — the D-2 class; the vocabulary-alignment follow-up.
- **§UNKNOWN discipline** — surfaced, never retried; A14 reconciliation owns resolution.
- **§UNKNOWN storm** — the down bound; quarantine transmission reliability work.
- **§Reconciliation freshness** — stale/never-run sweep; the A14 engagement lag.
- **§Progression freshness** — clearing/netting progression lag.
- **§Evidence-integrity violations** — QUARANTINE the tampered store; restore from the last verified backup; never repair evidence in place.
- **§Deployment health** — WAL mode, migration set, backup hygiene.

## 7. Logging and tracing

- **Structured logging** (`logging.ts`): one JSON line per emit (`{ts, level, event, traceId?, data}`), levels `debug|info|warn|error`, in-process sinks (console + a bounded queryable ring buffer). NO external telemetry backend in this work item (FUTURE-WORK).
- **Fail-closed scrubbing**: every payload passes `scrubCredentialReferences` before emission — object KEYS matching credential-reference naming are redacted entirely (the rail configuration naming makes the NAMES themselves sensitive in logs), secret-shaped VALUES are redacted, circular/non-serializable payloads fail closed to a named scrub error. Never a silent pass.
- **Tracing** (`tracing.ts`): `trace(database, anchor)` correlates command → queue → execution → effects over the ids the substrate already records (job id, event id, idempotency key → the job's lifecycle events → its `operations.command.submitted` rows → the command jobs they created → their `protocol.command.executed` observations). Pure reads; no spans, no timers, no external backend.

## 8. FUTURE-WORK (recorded, not invented here)

- The externalized telemetry binding: metrics endpoints, alerting, external log shipping and tracing backends (DEP-002+, per component).
- Scheduled backup automation (the drill proves the mechanism; the cadence is deployment configuration).
- External restore rehearsal in a production-shaped environment (the sandbox drills are the evidence here).

The exact `components.json` / `validate_deployment.py` fields for the integration wiring are carried in the DEP-007 completion report's CONTRACT-DELTA PROPOSAL.
