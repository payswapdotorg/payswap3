#!/usr/bin/env node
/**
 * DEP-003 evidence suite — durable persistence and work execution.
 *
 * Plain Node.js (no framework, no Next.js runtime, no npm dependencies).
 * Exit code 0 = all cases pass; non-zero = named failures.
 *
 * Evidence matrix (work order):
 *   (a) [test:migration]           fresh DB applies 0001 in a transaction,
 *                                 schema_migrations records it, re-run is a
 *                                 no-op, content mutation is rejected
 *                                 (immutability), WAL + synchronous=FULL.
 *   (b) [test:restart-durability]  queued work survives DB close/reopen AND
 *                                 an abrupt child-process exit (no sqlite
 *                                 close, no WAL checkpoint).
 *   (c) [test:duplicate-work]      enqueueing the same (kind, idempotencyKey)
 *                                 twice => exactly ONE durable_jobs row.
 *   (d) [test:redelivery]          an expired lease is reclaimed at-least-once
 *                                 with attempts incremented, then re-reservable.
 *   (e) [test:dead-letter]         bounded retries: reaching max_attempts =>
 *                                 dead_lettered (terminal), no further retries.
 *   (f) [test:scheduler]           two enqueues with the same tick identity =>
 *                                 one job; restart-safe; distinct ticks => new job.
 *   (g) [test:worker-execution]    bonus: workers execute via registered
 *                                 handlers only; unregistered kinds stay
 *                                 queued; lifecycle events are recorded with
 *                                 a defined owner; authorities own their evidence.
 *
 * Node-version note: requires Node.js >= 22.6 (node:sqlite + type
 * stripping). On Node 22.6–22.17 this harness re-executes itself with
 * --experimental-sqlite / --experimental-strip-types as needed; on
 * Node >= 22.18 no flags are required.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MIGRATIONS_DIR = join(ROOT, 'deploy', 'migrations');
const DURABLE_MODULE = (name) => join(ROOT, 'src', 'lib', 'durable', name);
const DURABLE_URL = (name) => pathToFileURL(DURABLE_MODULE(name)).href;

const RESPAWN_ENV = 'PAYSWAP_DURABLE_TEST_RESPAWNED';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const tempDirs = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `payswap-durable-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}
function countJobs(database, kind) {
  const row = database.sqlite
    .prepare('SELECT COUNT(*) AS total FROM durable_jobs WHERE kind = ?')
    .get(kind);
  return Number(row.total);
}

/**
 * Capability bootstrap. Probes, in order:
 *   1. node:sqlite importability (needs --experimental-sqlite on Node
 *      22.5–22.x builds that still flag it),
 *   2. .ts module loadability via src/lib/durable/events.ts (a module whose
 *      imports are all type-only, so it loads without touching node:sqlite —
 *      needs --experimental-strip-types on Node 22.6–22.17).
 * When flags are required, re-executes this exact script with them and
 * propagates the child's exit code.
 */
async function ensureCapabilities() {
  if (process.env[RESPAWN_ENV] === '1') {
    return;
  }
  const flags = [];
  let sqliteOk = false;
  try {
    await import('node:sqlite');
    sqliteOk = true;
  } catch {
    flags.push('--experimental-sqlite');
  }
  let stripTypesNeeded = false;
  try {
    await import(DURABLE_URL('events.ts'));
  } catch (error) {
    if (error && error.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
      stripTypesNeeded = true;
    } else if (sqliteOk) {
      throw error;
    }
  }
  if (stripTypesNeeded) {
    flags.push('--experimental-strip-types');
  }
  if (flags.length === 0) {
    return;
  }
  const child = spawnSync(
    process.execPath,
    [...flags, '--no-warnings', '--', fileURLToPath(import.meta.url)],
    { stdio: 'inherit', env: { ...process.env, [RESPAWN_ENV]: '1' } },
  );
  if (child.status === 9) {
    console.error('node rejected the required experimental flags (exit 9): this Node build does not support');
    console.error('node:sqlite / type stripping. The evidence suite requires Node.js >= 22.6.');
    process.exit(1);
  }
  process.exit(typeof child.status === 'number' ? child.status : 1);
}

await ensureCapabilities();

let dbModule;
let queueModule;
let workerModule;
let schedulerModule;
let eventsModule;
try {
  dbModule = await import(DURABLE_URL('db.ts'));
  queueModule = await import(DURABLE_URL('queue.ts'));
  workerModule = await import(DURABLE_URL('worker.ts'));
  schedulerModule = await import(DURABLE_URL('scheduler.ts'));
  eventsModule = await import(DURABLE_URL('events.ts'));
} catch (error) {
  console.error(`Failed to load the durable substrate modules: ${error}`);
  console.error('This suite requires Node.js >= 22.6 (node:sqlite + TypeScript type stripping).');
  console.error('On Node 22.6-22.17 it self-configures --experimental-sqlite / --experimental-strip-types.');
  process.exit(1);
}

const { openDurableDatabase, runMigrations } = dbModule;
const { DurableQueue } = queueModule;
const { DurableWorker } = workerModule;
const { computeTick, enqueueTick, scheduleRecurring } = schedulerModule;
const { recordEvent, listEventsByJob, SUBSTRATE_EVENT_OWNER } = eventsModule;

/** Wires the queue lifecycle emitter to the events table, like index.ts does. */
function wireEvents(database) {
  return (event) => {
    recordEvent(database, event.type, event.data, SUBSTRATE_EVENT_OWNER, event.jobId);
  };
}

// ---------------------------------------------------------------------------
// (a) [test:migration]
// ---------------------------------------------------------------------------
async function testMigration() {
  const dir = tempDir('migration');
  const db = openDurableDatabase({
    dbPath: join(dir, 'durable.sqlite'),
    migrationsDir: MIGRATIONS_DIR,
  });

  const applied = db.appliedMigrations();
  assert.equal(applied.length, 1, 'exactly one migration applied');
  assert.equal(applied[0].name, '0001_durable_execution.sql');
  assert.match(applied[0].checksum, /^[0-9a-f]{64}$/, 'sha256 checksum recorded');

  for (const table of ['durable_jobs', 'durable_events', 'schema_migrations']) {
    const row = db.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    assert.ok(row, `table ${table} exists`);
  }

  const journal = db.sqlite.prepare('PRAGMA journal_mode').get();
  assert.equal(String(journal.journal_mode).toLowerCase(), 'wal', 'WAL journaling is active');
  const syncMode = db.sqlite.prepare('PRAGMA synchronous').get();
  assert.equal(Number(syncMode.synchronous), 2, 'synchronous=FULL is active');

  const rerun = runMigrations(db.sqlite, MIGRATIONS_DIR);
  assert.equal(rerun.applied.length, 0, 're-running the migration runner is a no-op');
  assert.equal(rerun.verified, 1, 'the applied migration was verified');
  assert.equal(db.appliedMigrations().length, 1, 'schema_migrations still holds one row');
  db.close();

  const originalSql = readFileSync(join(MIGRATIONS_DIR, '0001_durable_execution.sql'), 'utf8');
  const mutatedDir = join(dir, 'mutated-migrations');
  mkdirSync(mutatedDir, { recursive: true });
  writeFileSync(join(mutatedDir, '0001_durable_execution.sql'), originalSql + '\n-- drift\n');
  const mutated = openDurableDatabase({
    dbPath: join(dir, 'mutated.sqlite'),
    migrationsDir: mutatedDir,
  });
  writeFileSync(join(mutatedDir, '0001_durable_execution.sql'), originalSql + '\n-- drift 2\n');
  assert.throws(
    () => runMigrations(mutated.sqlite, mutatedDir),
    /immutable|content changed/i,
    'mutating an applied migration is rejected',
  );
  mutated.close();
}

// ---------------------------------------------------------------------------
// (b) [test:restart-durability]
// ---------------------------------------------------------------------------
async function testRestartDurability() {
  const dir = tempDir('restart');
  const dbPath = join(dir, 'durable.sqlite');

  const db1 = openDurableDatabase({ dbPath, migrationsDir: MIGRATIONS_DIR });
  const queue1 = new DurableQueue(db1);
  const enqueued = queue1.enqueue('restart.kind', { value: 42 }, { idempotencyKey: 'restart-1' });
  assert.equal(enqueued.created, true);
  const jobId = enqueued.job.id;
  db1.close(); // graceful close: simulates process death

  const db2 = openDurableDatabase({ dbPath, migrationsDir: MIGRATIONS_DIR });
  const queue2 = new DurableQueue(db2);
  const survived = queue2.getJob(jobId);
  assert.ok(survived, 'job row survived the restart');
  assert.equal(survived.status, 'queued');
  assert.equal(survived.idempotencyKey, 'restart-1');
  assert.equal(survived.payload.value, 42, 'payload round-trips');
  const claimed = queue2.reserve('w-after-restart', 60000);
  assert.ok(claimed, 'job is reservable after the restart');
  assert.equal(claimed.id, jobId);
  db2.close();

  // Hard-crash simulation: a child process enqueues and calls process.exit(0)
  // without closing the database (no sqlite close, no WAL checkpoint). The
  // committed transaction must still be there for the next opener.
  const crashDbPath = join(dir, 'crash.sqlite');
  const childScript = [
    `const { openDurableDatabase } = await import(${JSON.stringify(DURABLE_URL('db.ts'))});`,
    `const { DurableQueue } = await import(${JSON.stringify(DURABLE_URL('queue.ts'))});`,
    `const handle = openDurableDatabase({ dbPath: ${JSON.stringify(crashDbPath)}, migrationsDir: ${JSON.stringify(MIGRATIONS_DIR)} });`,
    `const queue = new DurableQueue(handle);`,
    `queue.enqueue('crash.kind', { durable: true }, { idempotencyKey: 'crash-1' });`,
    `process.exit(0); // abrupt exit: no close(), no WAL checkpoint`,
  ].join('\n');
  const crashChild = spawnSync(
    process.execPath,
    [...process.execArgv, '--input-type=module', '-e', childScript],
    { encoding: 'utf8' },
  );
  assert.equal(
    crashChild.status,
    0,
    `crash-simulation child exited cleanly (stderr: ${crashChild.stderr})`,
  );

  const db3 = openDurableDatabase({ dbPath: crashDbPath, migrationsDir: MIGRATIONS_DIR });
  const queue3 = new DurableQueue(db3);
  const crashed = queue3.getByIdempotencyKey('crash.kind', 'crash-1');
  assert.ok(crashed, 'job committed by the abruptly-exited process is present');
  assert.equal(crashed.status, 'queued');
  const requeued = queue3.reserve('w-after-crash', 60000);
  assert.ok(requeued, 'crash-committed job is reservable');
  assert.equal(requeued.id, crashed.id);
  db3.close();
}

// ---------------------------------------------------------------------------
// (c) [test:duplicate-work]
// ---------------------------------------------------------------------------
async function testDuplicateWork() {
  const dir = tempDir('duplicate');
  const db = openDurableDatabase({ dbPath: join(dir, 'durable.sqlite'), migrationsDir: MIGRATIONS_DIR });
  const queue = new DurableQueue(db);

  const first = queue.enqueue('settlement.batch', { batch: 1 }, { idempotencyKey: 'batch-42' });
  assert.equal(first.created, true);
  assert.equal(first.reason, 'enqueued');
  const second = queue.enqueue('settlement.batch', { batch: 1 }, { idempotencyKey: 'batch-42' });
  assert.equal(second.created, false, 'duplicate enqueue reports created=false');
  assert.equal(second.reason, 'deduplicated');
  assert.equal(second.job.id, first.job.id, 'duplicate enqueue returns the existing job');
  assert.equal(countJobs(db, 'settlement.batch'), 1, 'exactly ONE durable_jobs row');

  queue.enqueue('settlement.batch', { batch: 2 }, { idempotencyKey: 'batch-42' });
  assert.equal(countJobs(db, 'settlement.batch'), 1, 'a third duplicate still adds no row');

  queue.enqueue('unkeyed.kind', { n: 1 });
  queue.enqueue('unkeyed.kind', { n: 2 });
  assert.equal(
    countJobs(db, 'unkeyed.kind'),
    2,
    'a NULL idempotency key opts out of dedupe (documented)',
  );
  db.close();
}

// ---------------------------------------------------------------------------
// (d) [test:redelivery]
// ---------------------------------------------------------------------------
async function testRedelivery() {
  const dir = tempDir('redelivery');
  const db = openDurableDatabase({ dbPath: join(dir, 'durable.sqlite'), migrationsDir: MIGRATIONS_DIR });
  const queue = new DurableQueue(db);

  const job = queue.enqueue('payout.retry', { attempt: 'first' }, { idempotencyKey: 'payout-1' }).job;
  const claimed = queue.reserve('w1', 30);
  assert.ok(claimed, 'job reserved under a short lease');
  assert.equal(claimed.id, job.id);
  assert.equal(claimed.status, 'reserved');
  assert.equal(claimed.reservedBy, 'w1');
  assert.ok(claimed.leaseExpiresAt > Date.now() - 1, 'lease expiry is set');
  assert.equal(claimed.attempts, 0, 'reserve does not count an attempt');

  assert.equal(queue.reclaimExpired().reclaimed, 0, 'nothing to reclaim before expiry');
  await sleep(90);
  const reclaim = queue.reclaimExpired();
  assert.equal(reclaim.reclaimed, 1, 'expired lease reclaimed exactly once');
  assert.equal(reclaim.deadLettered, 0);

  const redelivered = queue.getJob(job.id);
  assert.equal(redelivered.status, 'queued', 'reclaimed job is available again');
  assert.equal(redelivered.attempts, 1, 'attempts incremented by the redelivery');
  assert.equal(redelivered.reservedBy, null, 'reservation cleared');
  assert.equal(redelivered.leaseExpiresAt, null, 'lease cleared');

  const reclaimedAgain = queue.reserve('w2', 5000);
  assert.ok(reclaimedAgain, 'reclaimed job is re-reservable (at-least-once)');
  assert.equal(reclaimedAgain.id, job.id);
  assert.equal(reclaimedAgain.attempts, 1, 'reserve does not double-count attempts');
  db.close();
}

// ---------------------------------------------------------------------------
// (e) [test:dead-letter]
// ---------------------------------------------------------------------------
async function testDeadLetter() {
  const dir = tempDir('deadletter');
  const db = openDurableDatabase({ dbPath: join(dir, 'durable.sqlite'), migrationsDir: MIGRATIONS_DIR });
  const queue = new DurableQueue(db, { backoffBaseMs: 10, backoffMaxMs: 50 });

  const job = queue.enqueue('dead.kind', { x: 1 }, { idempotencyKey: 'dead-1', maxAttempts: 2 }).job;

  let claim = queue.reserve('w', 5000);
  assert.ok(claim, 'first claim');
  const failure1 = queue.fail(job.id, new Error('boom one'), 'w');
  assert.equal(failure1.outcome, 'requeued');
  assert.equal(failure1.job.status, 'queued');
  assert.equal(failure1.job.attempts, 1);
  assert.ok(
    failure1.job.availableAt > failure1.job.updatedAt,
    'deterministic backoff pushed available_at into the future',
  );
  assert.equal(queue.backoffMsForAttempt(1), 10, 'backoff is deterministic: attempt 1 = base');

  await sleep(30); // let the short backoff elapse
  claim = queue.reserve('w', 5000);
  assert.ok(claim, 'second claim after backoff');
  assert.equal(claim.id, job.id);
  const failure2 = queue.fail(job.id, 'boom two', 'w');
  assert.equal(failure2.outcome, 'dead_lettered', 'bounded retries: max attempts reached');
  assert.equal(failure2.job.status, 'dead_lettered');
  assert.equal(failure2.job.attempts, 2);

  await sleep(30);
  assert.equal(queue.reserve('w', 5000), null, 'dead-lettered jobs are never reserved again');
  const lateFailure = queue.fail(job.id, new Error('late failure'), 'w');
  assert.equal(lateFailure.outcome, 'ignored', 'failing a dead-lettered job is a guarded no-op');
  db.close();
}

// ---------------------------------------------------------------------------
// (f) [test:scheduler]
// ---------------------------------------------------------------------------
async function testScheduler() {
  const dir = tempDir('scheduler');
  const db = openDurableDatabase({ dbPath: join(dir, 'durable.sqlite'), migrationsDir: MIGRATIONS_DIR });
  const queue = new DurableQueue(db);

  assert.equal(computeTick(9999, 5000), 1, 'tick identity is deterministic');
  assert.equal(computeTick(10000, 5000), 2);

  const first = enqueueTick(queue, 'settle.tick', (tick) => ({ tick }), 7);
  assert.equal(first.created, true);
  const duplicateTick = enqueueTick(queue, 'settle.tick', (tick) => ({ tick }), 7);
  assert.equal(duplicateTick.created, false, 'same tick identity => duplicate enqueue no-op');
  assert.equal(duplicateTick.job.id, first.job.id);
  assert.equal(countJobs(db, 'settle.tick'), 1, 'two ticks, one identity => ONE job');

  const nextTick = enqueueTick(queue, 'settle.tick', (tick) => ({ tick }), 8);
  assert.equal(nextTick.created, true, 'a different tick identity => a new job');
  assert.equal(countJobs(db, 'settle.tick'), 2);

  // Restart simulation: a fresh queue over the same database re-attempts the
  // same tick identity => still no duplicate.
  db.close();
  const db2 = openDurableDatabase({ dbPath: join(dir, 'durable.sqlite'), migrationsDir: MIGRATIONS_DIR });
  const queue2 = new DurableQueue(db2);
  const afterRestart = enqueueTick(queue2, 'settle.tick', (tick) => ({ tick }), 7);
  assert.equal(afterRestart.created, false, 'scheduler re-run after restart never duplicates work');
  assert.equal(countJobs(db2, 'settle.tick'), 2);

  // Live recurring schedule: bounded number of distinct ticks over a window.
  const schedule = scheduleRecurring(queue2, 'settle.live', (tick) => ({ tick }), 40, {
    scheduleId: 'live',
  });
  schedule.start();
  await sleep(260);
  schedule.stop();
  const liveCount = countJobs(db2, 'settle.live');
  assert.ok(
    liveCount >= 1 && liveCount <= 10,
    `live schedule enqueued a bounded number of jobs (got ${liveCount})`,
  );
  db2.close();
}

// ---------------------------------------------------------------------------
// (g) [test:worker-execution] — bonus: full worker path + event ownership
// ---------------------------------------------------------------------------
async function testWorkerExecution() {
  const dir = tempDir('worker');
  const db = openDurableDatabase({ dbPath: join(dir, 'durable.sqlite'), migrationsDir: MIGRATIONS_DIR });
  const queue = new DurableQueue(db, { backoffBaseMs: 10, emitEvent: wireEvents(db) });
  const seen = [];
  const worker = new DurableWorker({
    queue,
    workerId: 'evidence-worker',
    concurrency: 2,
    leaseMs: 5000,
  });
  worker.register('evidence.echo', (job) => {
    seen.push(job.payload);
  });
  worker.register('evidence.boom', () => {
    throw new Error('intentional failure');
  });

  const okJob = queue.enqueue('evidence.echo', { hello: 'durable' }, { idempotencyKey: 'echo-1' }).job;
  const boomJob = queue.enqueue('evidence.boom', { n: 1 }, { idempotencyKey: 'boom-1', maxAttempts: 3 }).job;
  const futureJob = queue.enqueue('evidence.future', { later: true }, { idempotencyKey: 'future-1' }).job;

  const dispatched = await worker.tick();
  assert.equal(dispatched, 2, 'one dispatch per registered kind with work');
  await sleep(20);

  assert.deepEqual(seen, [{ hello: 'durable' }], 'handler received the payload');
  assert.equal(queue.getJob(okJob.id).status, 'succeeded');
  const afterBoom = queue.getJob(boomJob.id);
  assert.equal(afterBoom.status, 'queued', 'failed handler re-queued with backoff, not crashed');
  assert.equal(afterBoom.attempts, 1);
  assert.equal(queue.getJob(futureJob.id).status, 'queued', 'unregistered kind stays queued');

  const lifecycle = listEventsByJob(db, okJob.id);
  const types = lifecycle.map((event) => event.type);
  assert.ok(types.includes('job_enqueued'));
  assert.ok(types.includes('job_reserved'));
  assert.ok(types.includes('job_succeeded'));
  for (const event of lifecycle) {
    assert.equal(event.owner, SUBSTRATE_EVENT_OWNER, 'substrate lifecycle events have a defined owner');
  }

  const evidence = recordEvent(
    db,
    'settlement.evidence',
    { note: 'owned-by-authority' },
    'future-settlement-authority',
    boomJob.id,
  );
  assert.equal(evidence.owner, 'future-settlement-authority');
  assert.ok(listEventsByJob(db, boomJob.id).some((event) => event.owner === 'future-settlement-authority'));

  await worker.stop();
  db.close();
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
const TESTS = [
  { marker: 'migration', label: '(a) migration', fn: testMigration },
  { marker: 'restart-durability', label: '(b) restart-durability', fn: testRestartDurability },
  { marker: 'duplicate-work', label: '(c) duplicate-work', fn: testDuplicateWork },
  { marker: 'redelivery', label: '(d) redelivery', fn: testRedelivery },
  { marker: 'dead-letter', label: '(e) dead-letter', fn: testDeadLetter },
  { marker: 'scheduler', label: '(f) scheduler', fn: testScheduler },
  { marker: 'worker-execution', label: '(g) worker-execution (bonus)', fn: testWorkerExecution },
];

let failedCount = 0;
const failedMarkers = [];
for (const test of TESTS) {
  try {
    await test.fn();
    console.log(`[test:${test.marker}] PASS — ${test.label}`);
  } catch (error) {
    failedCount += 1;
    failedMarkers.push(test.marker);
    console.error(`[test:${test.marker}] FAIL — ${test.label}`);
    console.error(error && error.stack ? error.stack : String(error));
  }
}
for (const dir of tempDirs) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

const passedCount = TESTS.length - failedCount;
console.log(`durable evidence suite: ${passedCount}/${TESTS.length} passed`);
if (failedCount > 0) {
  console.error(`named failure(s): ${failedMarkers.join(', ')}`);
  process.exit(1);
}
process.exit(0);
