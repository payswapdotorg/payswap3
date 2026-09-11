#!/usr/bin/env node
/**
 * RTN-001 evidence suite — protocol runtime kernel.
 *
 * Plain Node.js (no framework, no Next.js runtime, no npm dependencies),
 * mirroring scripts/test_durable.mjs (the DEP-003 evidence convention).
 * Exit code 0 = all cases pass; non-zero = named failures.
 *
 * Evidence matrix (work order RTN-001 "Required evidence"):
 *   (a) [test:kernel-load]            the kernel barrel (including the
 *                                     persistence module and its DEP-003 db
 *                                     import) loads under plain Node with
 *                                     type stripping, and exports the full
 *                                     kernel surface.
 *   (b) [test:kernel-migration]       the per-domain persistence convention,
 *                                     end to end: openKernelStore() opens a
 *                                     kernel-owned store via the DEP-003 db
 *                                     module with the migration directory
 *                                     inside the kernel prefix
 *                                     (src/lib/protocol-runtime/kernel/
 *                                     migrations/); the migration applies,
 *                                     schema_migrations records it, the
 *                                     kernel_format_versions table exists,
 *                                     re-running the runner is a no-op, and
 *                                     mutating an applied migration is
 *                                     rejected (immutability).
 *   (c) [test:envelope-enqueue]       the command envelope maps 1:1 onto the
 *                                     DEP-003 enqueue idempotency contract:
 *                                     envelope → enqueue input →
 *                                     DurableQueue.enqueue → exactly ONE
 *                                     durable_jobs row for the same
 *                                     (kind, idempotencyKey); the duplicate
 *                                     enqueue reports created:false; the
 *                                     payload round-trips the envelope; the
 *                                     same key under a different kind is a
 *                                     distinct dedupe identity; the stored
 *                                     idempotency_key is never NULL.
 *
 * Node-version note: requires Node.js >= 22.6 (node:sqlite + type
 * stripping). On Node 22.6–22.17 this harness re-executes itself with
 * --experimental-sqlite / --experimental-strip-types as needed; on
 * Node >= 22.18 no flags are required. (Same bootstrap as
 * scripts/test_durable.mjs.)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const KERNEL_DIR = join(ROOT, 'src', 'lib', 'protocol-runtime', 'kernel');
const KERNEL_URL = (name) => pathToFileURL(join(KERNEL_DIR, name)).href;
const DURABLE_MODULE = (name) => join(ROOT, 'src', 'lib', 'durable', name);
const DURABLE_URL = (name) => pathToFileURL(DURABLE_MODULE(name)).href;
const SUBSTRATE_MIGRATIONS_DIR = join(ROOT, 'deploy', 'migrations');

const RESPAWN_ENV = 'PAYSWAP_KERNEL_TEST_RESPAWNED';
const tempDirs = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `payswap-kernel-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

/**
 * Capability bootstrap (mirrors scripts/test_durable.mjs): probes
 * node:sqlite importability and .ts module loadability, re-executing this
 * script with the required experimental flags on Node builds that need them.
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
    await import(KERNEL_URL('time.ts'));
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

let kernel;
let dbModule;
let queueModule;
try {
  kernel = await import(KERNEL_URL('kernel.ts'));
  dbModule = await import(DURABLE_URL('db.ts'));
  queueModule = await import(DURABLE_URL('queue.ts'));
} catch (error) {
  console.error(`Failed to load the kernel or the durable substrate modules: ${error}`);
  console.error('This suite requires Node.js >= 22.6 (node:sqlite + TypeScript type stripping).');
  process.exit(1);
}

const {
  money,
  moneyBag,
  addMoneyBags,
  subtractMoneyBags,
  protocolTime,
  deriveIdempotencyKey,
  validateCommandEnvelope,
  commandEnvelopeToEnqueueInput,
  SHARED_REASON_CODES,
  openKernelStore,
  resolveKernelMigrationsDir,
  KERNEL_MIGRATIONS_RELATIVE_DIR,
} = kernel;
const { runMigrations } = dbModule;
const { DurableQueue } = queueModule;

// ---------------------------------------------------------------------------
// (a) [test:kernel-load]
// ---------------------------------------------------------------------------
async function testKernelLoad() {
  assert.equal(typeof money, 'function', 'kernel exports money()');
  assert.equal(typeof moneyBag, 'function', 'kernel exports moneyBag()');
  assert.equal(typeof addMoneyBags, 'function', 'kernel exports addMoneyBags()');
  assert.equal(typeof subtractMoneyBags, 'function', 'kernel exports subtractMoneyBags()');
  assert.equal(typeof protocolTime, 'function', 'kernel exports protocolTime()');
  assert.equal(typeof deriveIdempotencyKey, 'function', 'kernel exports deriveIdempotencyKey()');
  assert.equal(typeof validateCommandEnvelope, 'function', 'kernel exports validateCommandEnvelope()');
  assert.equal(
    typeof commandEnvelopeToEnqueueInput,
    'function',
    'kernel exports commandEnvelopeToEnqueueInput()',
  );
  assert.deepEqual([...SHARED_REASON_CODES], ['UNKNOWN'], 'shared reason codes are exactly [UNKNOWN]');
  assert.equal(typeof openKernelStore, 'function', 'kernel exports openKernelStore()');
  assert.equal(typeof resolveKernelMigrationsDir, 'function', 'kernel exports resolveKernelMigrationsDir()');

  // The kernel's arithmetic is loadable AND correct under plain Node too.
  const bag = addMoneyBags(
    moneyBag([
      { currency: 'USD', amountMinor: 100 },
      { currency: 'EUR', amountMinor: 200 },
    ]),
    moneyBag([{ currency: 'EUR', amountMinor: -50 }]),
  );
  assert.deepEqual(
    bag.entries,
    [
      { currency: 'EUR', amountMinor: 150 },
      { currency: 'USD', amountMinor: 100 },
    ],
    'entrywise bag addition works under plain Node',
  );

  // The migration directory resolves INSIDE the kernel prefix.
  const resolved = resolveKernelMigrationsDir();
  assert.ok(
    resolved.endsWith(KERNEL_MIGRATIONS_RELATIVE_DIR),
    `kernel migrations dir resolves inside the kernel prefix (got ${resolved})`,
  );
}

// ---------------------------------------------------------------------------
// (b) [test:kernel-migration] — the per-domain persistence convention
// ---------------------------------------------------------------------------
async function testKernelMigration() {
  const dir = tempDir('migration');

  // The kernel-owned store opens via the DEP-003 db module, with the
  // migration directory inside the kernel prefix (explicitly passed here so
  // the test is independent of the walk-up resolution).
  const store = openKernelStore({
    dbPath: join(dir, 'kernel.sqlite'),
    migrationsDir: join(KERNEL_DIR, 'migrations'),
  });

  assert.ok(store.sqlite, 'kernel store exposes the underlying DatabaseSync handle');
  assert.equal(store.migrationsDir, join(KERNEL_DIR, 'migrations'), 'store used the kernel migrations dir');

  const applied = store.appliedMigrations();
  assert.equal(applied.length, 1, 'exactly one kernel migration applied');
  assert.equal(applied[0].name, '0001_kernel.sql', 'the kernel migration is 0001_kernel.sql');
  assert.match(applied[0].checksum, /^[0-9a-f]{64}$/, 'sha256 content checksum recorded');

  // Schema existence: the kernel-owned table exists.
  const table = store.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get('kernel_format_versions');
  assert.ok(table, 'kernel_format_versions table exists after migration');

  // Substrate-inherited guarantees: WAL + synchronous=FULL.
  const journal = store.sqlite.prepare('PRAGMA journal_mode').get();
  assert.equal(String(journal.journal_mode).toLowerCase(), 'wal', 'WAL journaling is active');
  const syncMode = store.sqlite.prepare('PRAGMA synchronous').get();
  assert.equal(Number(syncMode.synchronous), 2, 'synchronous=FULL is active');

  // Re-running the runner is a no-op (the applied set is skipped).
  const rerun = runMigrations(store.sqlite, join(KERNEL_DIR, 'migrations'));
  assert.equal(rerun.applied.length, 0, 're-running the kernel migration runner is a no-op');
  assert.equal(rerun.verified, 1, 'the applied kernel migration was verified');
  store.close();

  // Immutability: mutating an applied kernel migration is rejected loudly.
  const kernelMigrations = join(KERNEL_DIR, 'migrations');
  const originalSql = readFileSync(join(kernelMigrations, '0001_kernel.sql'), 'utf8');
  const mutatedDir = join(dir, 'mutated-migrations');
  mkdirSync(mutatedDir, { recursive: true });
  writeFileSync(join(mutatedDir, '0001_kernel.sql'), originalSql);
  const mutatedStore = openKernelStore({
    dbPath: join(dir, 'mutated.sqlite'),
    migrationsDir: mutatedDir,
  });
  writeFileSync(join(mutatedDir, '0001_kernel.sql'), originalSql + '\n-- drift\n');
  assert.throws(
    () => runMigrations(mutatedStore.sqlite, mutatedDir),
    /immutable|content changed/i,
    'mutating an applied kernel migration is rejected',
  );
  mutatedStore.close();

  // The kernel store and the substrate store stay fully disjoint domains:
  // opening the substrate store (deploy/migrations) in the same directory
  // creates a SEPARATE database with the substrate schema, not the kernel's.
  const { openDurableDatabase } = dbModule;
  const substrateStore = openDurableDatabase({
    dbPath: join(dir, 'durable.sqlite'),
    migrationsDir: SUBSTRATE_MIGRATIONS_DIR,
  });
  const substrateTables = substrateStore.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name));
  assert.ok(substrateTables.includes('durable_jobs'), 'substrate store has durable_jobs');
  assert.ok(!substrateTables.includes('kernel_format_versions'), 'substrate store has no kernel table');
  const kernelTables = openKernelStore({
    dbPath: join(dir, 'kernel2.sqlite'),
    migrationsDir: join(KERNEL_DIR, 'migrations'),
  })
    .sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name));
  assert.ok(kernelTables.includes('kernel_format_versions'), 'kernel store has its table');
  assert.ok(!kernelTables.includes('durable_jobs'), 'kernel store has no substrate table');
  kernelTables.length; // readability anchor
  substrateStore.close();
}

// ---------------------------------------------------------------------------
// (c) [test:envelope-enqueue] — envelope → DEP-003 enqueue, 1:1
// ---------------------------------------------------------------------------
async function testEnvelopeEnqueueMapping() {
  const dir = tempDir('envelope');
  const database = dbModule.openDurableDatabase({
    dbPath: join(dir, 'durable.sqlite'),
    migrationsDir: SUBSTRATE_MIGRATIONS_DIR,
  });
  const queue = new DurableQueue(database);

  const envelopeValue = {
    kind: 'intent.create',
    authority: 'Intent Authority',
    subjectIds: ['intent-1'],
    idempotencyKey: deriveIdempotencyKey('intent.create', 'intent-1'),
    protocolTime: protocolTime(7, 1_700_000_000_000),
    body: { amountMinor: 100, currency: 'USD', scale: 2 },
  };

  const validated = validateCommandEnvelope(envelopeValue);
  assert.equal(validated.ok, true, 'the envelope validates');
  if (!validated.ok) {
    throw new Error('precondition failed: envelope must validate');
  }

  // 1:1 mapping: kind ↔ kind, envelope ↔ payload, key ↔ idempotencyKey.
  const input = commandEnvelopeToEnqueueInput(validated.envelope);
  assert.equal(input.kind, envelopeValue.kind, 'enqueue kind is the envelope kind');
  assert.equal(input.idempotencyKey, envelopeValue.idempotencyKey, 'enqueue key is the envelope key');
  assert.deepEqual(input.payload, envelopeValue, 'enqueue payload is the full envelope');

  // First enqueue: created.
  const first = queue.enqueue(input.kind, input.payload, { idempotencyKey: input.idempotencyKey });
  assert.equal(first.created, true, 'first enqueue creates the job');
  assert.equal(first.reason, 'enqueued');
  assert.equal(first.job.kind, 'intent.create');

  // The stored idempotency_key is never NULL (protocol commands never opt
  // out of dedupe).
  const storedKeyRow = database.sqlite
    .prepare('SELECT idempotency_key FROM durable_jobs WHERE id = ?')
    .get(first.job.id);
  assert.equal(
    String(storedKeyRow.idempotency_key),
    envelopeValue.idempotencyKey,
    'durable_jobs.idempotency_key is the envelope key (non-NULL)',
  );

  // Second identical enqueue: deduplicated by UNIQUE (idempotency_key, kind).
  const second = queue.enqueue(input.kind, input.payload, { idempotencyKey: input.idempotencyKey });
  assert.equal(second.created, false, 'second enqueue is deduplicated');
  assert.equal(second.reason, 'deduplicated');
  assert.equal(second.job.id, first.job.id, 'the deduplicated enqueue returns the existing job');

  const countRow = database.sqlite
    .prepare('SELECT COUNT(*) AS total FROM durable_jobs')
    .get();
  assert.equal(Number(countRow.total), 1, 'exactly ONE durable_jobs row exists');

  // The payload round-trips: parsed back out of storage, it re-validates.
  const roundTrip = validateCommandEnvelope(first.job.payload);
  assert.equal(roundTrip.ok, true, 'the stored payload re-validates as an envelope');
  if (roundTrip.ok) {
    assert.equal(roundTrip.envelope.idempotencyKey, envelopeValue.idempotencyKey);
    assert.deepEqual(roundTrip.envelope.subjectIds, ['intent-1']);
  }

  // Same idempotency key under a DIFFERENT kind is a distinct dedupe
  // identity (the UNIQUE constraint is over the PAIR) — exactly the 1:1
  // mapping the work order requires the envelope to compose with.
  const cancelValue = {
    ...envelopeValue,
    kind: 'intent.cancel',
  };
  const cancelValidated = validateCommandEnvelope(cancelValue);
  assert.equal(cancelValidated.ok, true);
  if (!cancelValidated.ok) {
    throw new Error('precondition failed: cancel envelope must validate');
  }
  const cancelInput = commandEnvelopeToEnqueueInput(cancelValidated.envelope);
  const cancel = queue.enqueue(cancelInput.kind, cancelInput.payload, {
    idempotencyKey: cancelInput.idempotencyKey,
  });
  assert.equal(cancel.created, true, 'same key + different kind creates a new row');
  const countAfterCancel = database.sqlite
    .prepare('SELECT COUNT(*) AS total FROM durable_jobs')
    .get();
  assert.equal(Number(countAfterCancel.total), 2, 'two rows for two (kind, key) identities');

  // A NULL key opts out of dedupe in the substrate — but a protocol command
  // can never do that: envelope validation rejects the missing key.
  const nullKey = validateCommandEnvelope({ ...envelopeValue, idempotencyKey: null });
  assert.equal(nullKey.ok, false, 'an envelope with a null idempotency key is rejected');
  if (!nullKey.ok) {
    assert.equal(nullKey.field, 'idempotencyKey');
  }

  database.close();
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
const cleanup = () => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
};

async function main() {
  const cases = [
    ['kernel-load', testKernelLoad],
    ['kernel-migration', testKernelMigration],
    ['envelope-enqueue', testEnvelopeEnqueueMapping],
  ];
  const failures = [];
  for (const [name, fn] of cases) {
    try {
      await fn();
      console.log(`[test:${name}] ok`);
    } catch (error) {
      failures.push(name);
      console.error(`[test:${name}] FAILED: ${error && error.stack ? error.stack : error}`);
    }
  }
  cleanup();
  if (failures.length > 0) {
    console.error(`\n${failures.length} case(s) failed: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('\nAll RTN-001 kernel evidence cases passed.');
}

await main();
