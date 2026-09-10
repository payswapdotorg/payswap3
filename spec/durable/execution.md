# Durable Execution Contract (DEP-003)

Status: implemented by DEP-003 (durable persistence and work execution).
Applies to: payswap3, inside the existing `web-api-boundary` application.

This document is the normative contract for the durable execution
substrate: what it is, the job lifecycle state machine, idempotency and
lease semantics, restart/redelivery guarantees, the event/evidence
ownership model, how future protocol authorities integrate, configuration,
and the evidence matrix proving the guarantees.

## 1. What the substrate is — and is not

The durable execution substrate is an in-process execution fabric that
lives inside the existing `web-api-boundary` application (no new deployed
component; the FUTURE-WORK components in `deploy/contracts/components.json`
remain future work and their present-set is untouched):

- durable job persistence (SQLite via Node's built-in `node:sqlite`),
- a deduplicated enqueue path,
- an atomic reservation (lease) model,
- a bounded-retry worker loop,
- a deterministic recurring scheduler,
- explicit, verifiable migrations,
- a persistent event/evidence table with a mandatory owner column.

It is NOT, and must never become:

- a financial authority. The substrate moves job rows; it never decides
  financial outcomes, never computes balances, never signs anything. The
  ONLY integration point for execution semantics is handler registration:
  `register(kind, handler)`. Future protocol authorities plug in there.
- a protocol engine. It attaches no protocol meaning to kinds, payloads,
  or events beyond its own lifecycle vocabulary.
- a new deployment surface. Everything runs inside the Next.js
  application process (server side only).

## 2. Configuration

- `PAYSWAP_DURABLE_DB` — filesystem path of the SQLite database file.
  Default: `var/durable.sqlite` (relative to the process working
  directory; the directory is created on demand). Data is never
  committed: add `var/` to the repository's ignore rules.
- `PAYSWAP_MIGRATIONS_DIR` — directory containing the ordered `*.sql`
  migrations. Default: the first `deploy/migrations` found walking up
  from the process working directory (up to 8 levels), else
  `<cwd>/deploy/migrations`.
- Worker defaults (overridable at `init()`): `concurrency` 1 (bounded),
  `leaseMs` 60000, `pollIntervalMs` 500, `maxAttempts` 5 per job,
  backoff base 1000 ms doubling to a 300000 ms ceiling.
- `:memory:` is accepted as a database path for experiments only; it is
  not durable and WAL is unavailable there.

Packaging note: the migrations directory must ship with the application
image (or be pointed at via `PAYSWAP_MIGRATIONS_DIR`) — the runner is
explicit and fails closed when it cannot find migrations.

## 3. Storage and crash safety

- Engine: `node:sqlite` (`DatabaseSync`), zero npm dependencies
  (package.json is untouched by DEP-003).
- On every open the runner sets: `journal_mode = WAL` (persistent,
  verified on open for file-backed databases), `synchronous = FULL`
  (per-connection, verified: pragma value 2), and `busy_timeout = 5000`
  for cross-process contention.
- Consequences: a committed transaction survives an abrupt process death
  (evidence case b simulates exactly this: a child process exits without
  closing the database and the next opener recovers the committed job),
  and SQLite's single-writer discipline is respected with an explicit
  busy timeout instead of unbounded retry.
- All statements in the substrate are static SQL strings (direct literals
  or module-level named constants) with bound parameters; runtime data is
  never interpolated into SQL. The one intentional exception is the
  migration runner applying the contents of a migration file — DDL
  scripts, not data.

## 4. Migrations

- Location: `deploy/migrations/`, one file per migration, applied in
  ascending filename order. Filenames must start with a strictly
  monotonic numeric prefix (`0001_...`, `0002_...`, ...).
- Runner: `runMigrations(sqlite, migrationsDir)` in
  `src/lib/durable/db.ts`, invoked automatically by
  `openDurableDatabase()`.
- Bookkeeping: the `schema_migrations` table (owned by the runner, not by
  migration files) records `name`, sha256 content `checksum`, and
  `applied_at` (epoch ms).
- Guarantees:
  - each migration applies inside its own `BEGIN IMMEDIATE` transaction —
    a failure rolls the migration back and surfaces a
    `DurableMigrationError`;
  - re-running the runner is a no-op (applied set is skipped);
  - immutability: an applied migration whose file content no longer
    matches the recorded checksum fails loudly; a missing applied
    migration (history regression) fails loudly.
- Verification: evidence case (a) below plus
  `python3 scripts/validate_durable.py` (schema content checks).

## 5. Job lifecycle state machine

States (CHECK-constrained in `durable_jobs.status`):

    queued ──reserve──▶ reserved ──complete──▶ succeeded (terminal)
      ▲                   │
      │  ┌──release───────┤ (no attempt counted)
      │  │                │
      └──┤ fail (backoff) └── fail at max attempts ──▶ dead_lettered (terminal)
      │
      └── reclaimExpired (lease expired, attempts+1) ─▶ queued, or
          dead_lettered at the attempts bound

- `attempts` counts FAILED executions and expired leases (not
  reservations): `fail()` and `reclaimExpired()` increment it;
  `reserve()` never does.
- `failed` is permitted by the CHECK constraint and treated as
  retry-eligible by reservation, but the current substrate never assigns
  it: a failed attempt transitions deterministically to `queued` (with
  backoff) or `dead_lettered` (at the bound). It exists for
  forward-compatible tooling and manual inspection states.
- Terminal states (`succeeded`, `dead_lettered`) are never reserved
  again; late `fail()` calls on them are guarded no-ops.

## 6. Idempotency and dedupe

- `enqueue(kind, payload, { idempotencyKey, maxAttempts, availableAt })`
  inserts with `ON CONFLICT (idempotency_key, kind) DO NOTHING`.
- The schema enforces `UNIQUE (idempotency_key, kind)`: enqueueing the
  same (kind, idempotencyKey) twice results in exactly ONE row; the
  second call returns `created: false` with the existing job (a no-op).
- SQLite treats NULLs as distinct inside UNIQUE constraints: omitting the
  idempotency key opts the enqueue out of dedupe (intent without
  identity). Financially meaningful work MUST always carry a key derived
  from domain identity.
- Payloads are stored as JSON text and round-trip as parsed values.

## 7. Reservation, leases, and redelivery

- `reserve(workerId, leaseMs, { kind })` claims ONE available job
  atomically: a single `BEGIN IMMEDIATE` transaction performs candidate
  select (status in queued/failed, `available_at` elapsed, FIFO by
  available_at/created_at/id, optional kind filter) then a conditional
  UPDATE to `reserved` with `reserved_by` and `lease_expires_at` set. Two
  reservers can never hold the same job.
- `reclaimExpired(now)` redelivers lease-expired jobs at-least-once:
  status back to `queued`, `attempts + 1`, reservation cleared — the
  safety net for workers that died mid-execution. Reclamation itself is
  bounded: an expired lease at the attempts bound dead-letters instead of
  looping forever.
- `complete(jobId, workerId?)` / `fail(jobId, error, workerId?)` /
  `release(jobId, workerId?)` are conditional on `status = 'reserved'`
  (and on `reserved_by = workerId` when an owner is supplied), so a late
  report from a worker whose lease was already reclaimed cannot clobber
  another worker's claim.
- Guarantee: at-least-once execution per job + idempotent handlers under
  the job's idempotency key = effectively-once side effects. The
  substrate provides the keys and the dedupe; handlers must be
  idempotent when side effects are external.

## 8. Retries and dead-letter

- `fail()` computes `attempts := attempts + 1`:
  - below `max_attempts`: status `queued`, `available_at = now +
    backoff(attempts)`;
  - at `max_attempts`: status `dead_lettered` (terminal, no further
    retries, never reserved again).
- Backoff is deterministic (no jitter): first retry after
  `backoffBaseMs` (default 1000 ms), doubling per attempt, capped at
  `backoffMaxMs` (default 300000 ms). The same attempt number always
  yields the same delay.
- Unsafe retries are forbidden by construction: attempts are bounded on
  every path (handler failure and lease expiry), and duplicate enqueue
  is a no-op.

## 9. Worker

- `register(kind, handler)` is the ONLY integration point: the worker
  reserves exclusively jobs whose kind has a registered handler. A job
  whose authority has not arrived yet simply stays `queued` — nothing
  executes, nothing fails, nothing dead-letters (evidence case g).
- Bounded concurrency (default 1; configurable). Each tick:
  `reclaimExpired()` first, then reservation round-robin across
  registered kinds while capacity remains, then execution:
  handler(payload) → `complete()` on success, `fail()` (bounded backoff)
  on error. A handler that vanishes between reservation and dispatch is
  released without penalty.
- `start()` runs an unref'd polling interval (default 500 ms); `stop()`
  is graceful: scheduling stops and in-flight executions are awaited.
- Crash-safe by design: an abrupt process death leaves jobs `reserved`
  until their leases expire; the next worker pass reclaims and redelivers
  them.

## 10. Scheduler determinism

- Tick identity is derived from wall-clock time:
  `tick = floor(now / intervalMs)`; the per-tick idempotency key is
  `scheduleId + ':' + tickId` (default `default:t<n>`).
- `scheduleRecurring(...)` enqueues AT MOST ONE job per tick identity via
  the queue's UNIQUE dedupe: a duplicate enqueue (same tick after a
  restart, a re-run, or a racing schedule) is a no-op. A restarted
  scheduler can therefore NEVER enqueue duplicate financial work
  (evidence case f).
- Missed ticks while the process was down are NOT backfilled: the
  no-duplicate guarantee takes priority over catch-up. Ticks are fired
  while a schedule is running.
- A schedule's identity must be STABLE across restarts (the default
  `scheduleId` is the constant `default`). Two schedules of the same kind
  must use distinct `scheduleId`s — sharing an identity intentionally
  collapses them to one job per tick.

## 11. Events and evidence ownership

- `durable_events` is the defined, persistent home for event/evidence
  state. Every row carries a mandatory `owner` column; `recordEvent()`
  rejects an empty owner (evidence without an owner is invalid by
  definition).
- The substrate records its own lifecycle events — `job_enqueued`,
  `job_enqueue_deduped`, `job_reserved`, `job_succeeded`,
  `job_attempt_failed`, `job_dead_lettered`, `job_lease_expired` — under
  the owner `durable-substrate` (`SUBSTRATE_EVENT_OWNER`).
- Protocol evidence remains owned by future protocol authorities: they
  record their own rows under their own owner identity via the same
  table and API. The substrate never writes, interprets, or owns
  protocol evidence (evidence case g demonstrates an authority-owned
  row alongside substrate lifecycle rows).
- There is deliberately no foreign key from `durable_events.job_id`:
  evidence must remain queryable independent of job-row lifecycle.

## 12. Restart and redelivery guarantees

- Queued work survives process restart (WAL + committed transactions;
  evidence case b, including a hard-crash child that never closes the
  database).
- Worker redelivery is deterministic and safe: expired leases are
  reclaimed with `attempts + 1`, bounded at `max_attempts` (evidence
  cases d and e).
- Scheduler ticks cannot duplicate financial work (per-tick idempotency
  keys + UNIQUE dedupe; evidence case f).
- The substrate's guarantees are at-least-once delivery plus
  idempotent-dedupe at enqueue; handlers must be idempotent for
  effectively-once side effects.

## 13. Integration guide (future protocol authorities)

Register a handler (the only execution integration point):

    import * as durable from '@/lib/durable';

    durable.init(); // once at server startup
    durable.register('settlement.batch.run', async (job) => {
      // job.payload is the parsed enqueue payload.
      // Financial decisions live HERE, in the authority — never in the substrate.
      // Idempotency: the enqueue key (kind, idempotencyKey) is the dedupe identity.
      await durable.recordEvent(
        'settlement.batch.decided',   // authority-owned evidence type
        { batch: job.payload.batch }, // authority-owned data
        'settlement-authority',       // authority-owned owner identity
        job.id,
      );
    });
    durable.start();

Enqueue work with a domain-derived idempotency key:

    durable.enqueue('settlement.batch.run', { batch: 42 }, {
      idempotencyKey: 'settlement-batch-42', // stable domain identity
      maxAttempts: 5,
    });

Schedule recurring work deterministically:

    durable.scheduleRecurring('settlement.tick', (tick) => ({ tick }), 60_000, {
      scheduleId: 'settlement', // stable across restarts; distinct per schedule
    });

Shutdown: `await durable.stop()` is graceful (schedules and worker loop
stop, in-flight jobs drain). For full teardown — stop, close the
database, and allow re-initialization — use `getDurableRuntime()?.close()`.

Server-side only: never import the substrate from client components.
The barrel (`index.ts`) is loaded by the application's module bundler;
the underlying modules are individually loadable in plain Node (that is
how the evidence suite exercises them).

## 14. Node.js requirements

- Node 22+ with `node:sqlite` (the deployment pins node:22-alpine).
- On Node 22.5–22.17 the runtime flags may be required:
  `--experimental-sqlite` (node:sqlite) and `--experimental-strip-types`
  (TypeScript type stripping). On Node >= 22.18 neither flag is needed.
  `scripts/test_durable.mjs` self-configures these flags by re-executing
  itself when the current Node build requires them.
- TypeScript typechecking of `node:sqlite` imports requires
  `@types/node` >= 22.5.

## 15. Evidence matrix

Run (repository root):

    python3 scripts/validate_durable.py && node scripts/test_durable.mjs

- (a) `[test:migration]` — fresh temp DB applies 0001 inside a
  transaction; `schema_migrations` records name+checksum+applied_at;
  re-run is a no-op; a mutated applied migration is rejected
  (immutability); WAL and synchronous=FULL are verified on the open
  handle. Migration test.
- (b) `[test:restart-durability]` — enqueue, close the database
  (simulated process death), reopen: the job is still queued and
  reservable; additionally a child process commits a job and exits
  abruptly without closing (no WAL checkpoint) and the next opener
  recovers it. Queue durability proof.
- (c) `[test:duplicate-work]` — enqueueing the same
  (kind, idempotencyKey) twice leaves exactly ONE `durable_jobs` row and
  reports `created: false` for the duplicate; NULL keys opt out of
  dedupe (documented). Duplicate-work test.
- (d) `[test:redelivery]` — reserve under a 30 ms lease, let it expire,
  `reclaimExpired()` returns the job to `queued` with `attempts`
  incremented and it is re-reservable by another worker; a second
  reclaim before expiry is a no-op. Redelivery test.
- (e) `[test:dead-letter]` — with `maxAttempts: 2`, two failures
  dead-letter the job; the dead-lettered job is never reserved again and
  late `fail()` calls are ignored; deterministic backoff is asserted
  numerically. Bounded-retry proof.
- (f) `[test:scheduler]` — two enqueues with the same tick identity
  produce one job; a re-attempt after a simulated restart produces no
  duplicate; a distinct tick produces a new job; a live schedule emits a
  bounded number of jobs. Duplicate-scheduling proof.
- (g) `[test:worker-execution]` (bonus) — a worker executes jobs via
  registered handlers only; unregistered kinds stay queued; failing
  handlers get bounded backoff; substrate lifecycle events are recorded
  with owner `durable-substrate`; an authority-owned evidence row
  coexists under its own owner.
- `validate_durable.py` — migration files parse, are ordered and
  monotonic, and contain the required tables, columns, CHECK, UNIQUE,
  and indexes; TS sources use static SQL with bound parameters and no
  foreign imports; the test suite covers the six required markers;
  package.json satisfies the DEP-003 dependency guard.

## 16. Operational notes

- `var/durable.sqlite` (and its `-wal`/`-shm` siblings) are runtime
  artifacts: never commit them; ignore `var/`.
- Single-writer discipline: the substrate is in-process; concurrent
  access from a second process (e.g. a CLI) is serialized by SQLite's
  write lock with the configured busy timeout.
- Observability: `queue.stats()` returns per-status counts;
  `listRecentEvents()` / `listEventsByJob()` read the event log.
- Dead-lettered jobs require operator attention (inspect
  `durable_events` for `job_dead_lettered` rows and their error data);
  the substrate never auto-retries terminal states.
