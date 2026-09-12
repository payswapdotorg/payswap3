#!/usr/bin/env node
/**
 * RTN-010 evidence suite — protocol gateway (queue-submission integration).
 *
 * Plain Node.js (no framework, no Next.js runtime, no npm dependencies),
 * mirroring scripts/test_protocol_kernel.mjs (the RTN evidence convention).
 * Exit code 0 = all cases pass; non-zero = named failures.
 *
 * Evidence matrix (work order RTN-010 "Required evidence": "queue-
 * submission integration tests"; acceptance line 15: "Idempotent submission:
 * same command + idempotency key returns the recorded receipt, never a
 * second effect"; line 16: "Rejected commands are recorded as evidence";
 * line 18: health functions):
 *   (a) [test:gateway-load]        the gateway barrel (including the
 *                                  persistence module and its read-only
 *                                  DEP-003 db import) loads under plain
 *                                  Node with type stripping, and exports
 *                                  the documented contract surface.
 *   (b) [test:gateway-store]       the per-domain persistence convention,
 *                                  end to end: openGatewayStore() opens a
 *                                  gateway-owned store via the DEP-003 db
 *                                  module with the migration directory
 *                                  inside the gateway prefix; the migration
 *                                  applies, schema_migrations records it,
 *                                  the gateway_command_receipts table
 *                                  exists with its CHECK/PRIMARY-KEY
 *                                  contract, re-running the runner is a
 *                                  no-op, and mutating an applied migration
 *                                  is rejected (immutability). Receipt
 *                                  writes are insert-only with
 *                                  duplicate-no-op semantics; reads
 *                                  round-trip.
 *   (c) [test:queue-submission]    the REAL composed admission path:
 *                                  ProtocolGateway bound to the REAL
 *                                  DurableQueue over real SQLite through
 *                                  commandQueuePortFromDurableQueue, with
 *                                  the REAL EvidenceLog as the evidence
 *                                  port. An admitted command produces
 *                                  exactly ONE durable_jobs row whose kind,
 *                                  idempotency_key, and payload round-trip
 *                                  the envelope (the kernel envelope maps
 *                                  1:1 onto the enqueue contract);
 *                                  re-submission returns the RECORDED
 *                                  receipt with NO second row and NO second
 *                                  enqueue; a different key under the same
 *                                  kind is a second row; the same key under
 *                                  a different kind is a distinct row (the
 *                                  dedupe identity is (kind, key)); a
 *                                  rejection writes exactly one A15 record
 *                                  and no durable row; the receipt store
 *                                  write/read round-trips the admission.
 *   (d) [test:restart-durability]  process-restart semantics: a fresh
 *                                  gateway over the REOPENED durable queue
 *                                  (the receipt memory lost) re-submits the
 *                                  same (kind, key): the queue's UNIQUE
 *                                  dedupe absorbs it (created: false), the
 *                                  gateway records a DUPLICATE-outcome
 *                                  receipt, and there is STILL exactly one
 *                                  durable row — never a second effect.
 *   (e) [test:gateway-health]      the health functions over the real
 *                                  queue: readiness, command acceptance
 *                                  rate, admission latency, and
 *                                  durable-queue submit success.
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
const GATEWAY_DIR = join(ROOT, 'src', 'lib', 'protocol-runtime', 'gateway');
const GATEWAY_URL = (name) => pathToFileURL(join(GATEWAY_DIR, name)).href;
const EVIDENCE_URL = pathToFileURL(join(ROOT, 'src', 'lib', 'protocol-runtime', 'evidence', 'log.ts')).href;
const DURABLE_URL = (name) => pathToFileURL(join(ROOT, 'src', 'lib', 'durable', name)).href;
const SUBSTRATE_MIGRATIONS_DIR = join(ROOT, 'deploy', 'migrations');

const RESPAWN_ENV = 'PAYSWAP_GATEWAY_TEST_RESPAWNED';
const tempDirs = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `payswap-gateway-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

/**
 * Capability bootstrap (mirrors scripts/test_durable.mjs): probes
 * node:sqlite importability and .ts module loadability, re-executing this
 * script with the required experimental flags on Node builds that need
 * them.
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
    await import(GATEWAY_URL('reason-codes.ts'));
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

let gatewayModule;
let evidenceLogModule;
let dbModule;
let queueModule;
try {
  gatewayModule = await import(GATEWAY_URL('index.ts'));
  evidenceLogModule = await import(EVIDENCE_URL);
  dbModule = await import(DURABLE_URL('db.ts'));
  queueModule = await import(DURABLE_URL('queue.ts'));
} catch (error) {
  console.error(`Failed to load the gateway or the durable substrate modules: ${error}`);
  console.error('This suite requires Node.js >= 22.6 (node:sqlite + TypeScript type stripping).');
  process.exit(1);
}

const {
  ProtocolGateway,
  commandQueuePortFromDurableQueue,
  GATEWAY_ADMISSION_REASON_CODES,
  GATEWAY_COMMAND_KIND_COUNT,
  DEFAULT_GATEWAY_DB_PATH,
  GATEWAY_MIGRATIONS_DIR_ENV_VAR,
  GATEWAY_MIGRATIONS_RELATIVE_DIR,
  GATEWAY_STORE_DOMAIN,
  resolveGatewayMigrationsDir,
  openGatewayStore,
  writeCommandReceipt,
  readCommandReceipts,
} = gatewayModule;
const { createEvidenceLog } = evidenceLogModule;
const { DurableQueue } = queueModule;

function pass(name) {
  console.log(`(pass) ${name}`);
}

// ---------------------------------------------------------------------------
// (a) [test:gateway-load]
// ---------------------------------------------------------------------------
async function testGatewayLoad() {
  assert.equal(typeof ProtocolGateway, 'function', 'gateway exports ProtocolGateway');
  assert.equal(typeof commandQueuePortFromDurableQueue, 'function', 'gateway exports commandQueuePortFromDurableQueue');
  assert.equal(typeof openGatewayStore, 'function', 'gateway exports openGatewayStore');
  assert.equal(typeof resolveGatewayMigrationsDir, 'function', 'gateway exports resolveGatewayMigrationsDir');
  assert.equal(typeof writeCommandReceipt, 'function', 'gateway exports writeCommandReceipt');
  assert.equal(typeof readCommandReceipts, 'function', 'gateway exports readCommandReceipts');
  assert.deepEqual(
    [...GATEWAY_ADMISSION_REASON_CODES],
    ['ENVELOPE_INVALID', 'AUTHORITY_UNKNOWN', 'COMMAND_KIND_UNKNOWN', 'COMMAND_BODY_INVALID', 'COMMAND_SUBJECT_INVALID'],
    'the admission reason-code vocabulary is the frozen five-member set',
  );
  assert.equal(GATEWAY_COMMAND_KIND_COUNT, 112, 'the registry catalogues 112 distinct command kinds');
  assert.equal(DEFAULT_GATEWAY_DB_PATH, 'var/gateway.sqlite', 'the gateway store default path follows the domain convention');
  assert.equal(GATEWAY_STORE_DOMAIN, 'protocol-runtime-gateway', 'the gateway store domain identity');
  assert.equal(GATEWAY_MIGRATIONS_DIR_ENV_VAR, 'PAYSWAP_GATEWAY_MIGRATIONS_DIR', 'the migrations-dir env var follows the domain convention');
  const resolved = resolveGatewayMigrationsDir();
  assert.ok(
    resolved.endsWith(GATEWAY_MIGRATIONS_RELATIVE_DIR),
    `gateway migrations dir resolves inside the gateway prefix (got ${resolved})`,
  );
  pass('test:gateway-load');
}

// ---------------------------------------------------------------------------
// (b) [test:gateway-store] — the per-domain persistence convention
// ---------------------------------------------------------------------------
async function testGatewayStore() {
  const dir = tempDir('store');
  const store = openGatewayStore({
    dbPath: join(dir, 'gateway.sqlite'),
    migrationsDir: join(GATEWAY_DIR, 'migrations'),
  });
  assert.ok(store.sqlite, 'gateway store exposes the underlying DatabaseSync handle');
  assert.equal(store.migrationsDir, join(GATEWAY_DIR, 'migrations'), 'store used the gateway migrations dir');

  const applied = store.appliedMigrations();
  assert.equal(applied.length, 1, 'exactly one gateway migration applied');
  assert.equal(applied[0].name, '0001_gateway.sql', 'the gateway migration is 0001_gateway.sql');
  assert.match(applied[0].checksum, /^[0-9a-f]{64}$/, 'sha256 content checksum recorded');

  const table = store.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get('gateway_command_receipts');
  assert.ok(table, 'gateway_command_receipts table exists after migration');

  // The PRIMARY KEY (kind, idempotency_key) mirrors the DEP-003 dedupe
  // identity; the CHECK constraints pin the frozen receipt vocabularies.
  const schema = String(
    store.sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'gateway_command_receipts'")
      .get().sql,
  );
  assert.match(schema, /PRIMARY KEY \(kind, idempotency_key\)/, 'the receipt PK mirrors (kind, idempotency_key)');
  assert.match(schema, /CHECK \(state IN \('ADMITTED'\)\)/, 'the admission-state CHECK');
  assert.match(schema, /CHECK \(outcome IN \('ADMITTED', 'DUPLICATE'\)\)/, 'the admission-outcome CHECK');

  // Re-running the runner is a no-op.
  const { runMigrations } = dbModule;
  runMigrations(store.sqlite, join(GATEWAY_DIR, 'migrations'));
  assert.equal(store.appliedMigrations().length, 1, 're-running the migration runner is a no-op');

  // Mutating an applied migration is rejected (immutability).
  const mutatedDir = join(dir, 'mutated-migrations');
  mkdirSync(mutatedDir, { recursive: true });
  cpSync(join(GATEWAY_DIR, 'migrations', '0001_gateway.sql'), join(mutatedDir, '0001_gateway.sql'));
  let mutationRejected = false;
  try {
    runMigrations(store.sqlite, mutatedDir);
    writeFileSync(join(mutatedDir, '0001_gateway.sql'), readFileSync(join(mutatedDir, '0001_gateway.sql'), 'utf8') + '\n-- mutated\n');
    runMigrations(store.sqlite, mutatedDir);
  } catch {
    mutationRejected = true;
  }
  assert.ok(mutationRejected, 'mutating an applied migration is rejected');

  // Receipt writes are insert-only with duplicate-no-op semantics; reads
  // round-trip.
  const receipt = {
    kind: 'intent.authorize',
    idempotencyKey: 'idem-store-1',
    receipt: {
      commandId: 'pid.v1.0000000000000000000000000000000000000000000000000000000000000000',
      state: 'ADMITTED',
      outcome: 'ADMITTED',
      recordedAt: { sequence: 0, wallMs: 1_000 },
    },
    jobId: 'job-store-1',
  };
  const first = writeCommandReceipt(store, receipt);
  assert.deepEqual(first, { created: true, reason: 'written' }, 'the first receipt write creates the row');
  const duplicate = writeCommandReceipt(store, receipt);
  assert.deepEqual(duplicate, { created: false, reason: 'duplicate-no-op' }, 'a duplicate receipt write is a no-op');
  const read = readCommandReceipts(store);
  assert.equal(read.length, 1, 'one stored receipt');
  assert.equal(read[0].kind, 'intent.authorize');
  assert.equal(read[0].idempotencyKey, 'idem-store-1');
  assert.equal(read[0].receipt.state, 'ADMITTED');
  assert.equal(read[0].receipt.outcome, 'ADMITTED');
  assert.equal(read[0].receipt.recordedAt.sequence, 0);
  assert.equal(read[0].receipt.recordedAt.wallMs, 1_000);
  assert.equal(read[0].jobId, 'job-store-1');
  store.close();
  pass('test:gateway-store');
}

// ---------------------------------------------------------------------------
// (c) [test:queue-submission] — the REAL composed admission path
// ---------------------------------------------------------------------------
async function testQueueSubmission() {
  const dir = tempDir('queue');
  const db = dbModule.openDurableDatabase({
    dbPath: join(dir, 'durable.sqlite'),
    migrationsDir: SUBSTRATE_MIGRATIONS_DIR,
  });
  const queue = new DurableQueue(db);
  const log = createEvidenceLog({ wallMs: 1_000 });
  const gateway = new ProtocolGateway({
    evidence: log,
    queue: commandQueuePortFromDurableQueue(queue),
    wallClock: () => 5_000,
  });

  const envelope = {
    kind: 'intent.authorize',
    authority: 'Intent Authority',
    subjectIds: ['pid.v1.intent-queue'],
    idempotencyKey: 'idem-queue-1',
    protocolTime: { sequence: 0, wallMs: 1_000 },
    body: { intentId: 'pid.v1.intent-queue', policyDecisionId: 'pid.v1.decision-queue' },
  };

  // First admission: exactly one durable row, kind + key + payload
  // round-trip the envelope (the kernel envelope maps 1:1 onto the
  // enqueue contract).
  const first = await gateway.submitCommand(envelope);
  assert.equal(first.ok, true, 'the first submission is admitted');
  assert.equal(first.created, true, 'the first submission creates the durable job');
  assert.equal(first.replayed, false, 'the first submission is not a replay');
  assert.equal(first.receipt.outcome, 'ADMITTED', 'the recorded outcome is ADMITTED');
  const rows = db.prepare('SELECT * FROM durable_jobs ORDER BY id').all();
  assert.equal(rows.length, 1, 'exactly ONE durable_jobs row after the first admission');
  assert.equal(rows[0].kind, 'intent.authorize', 'the row kind is the command kind');
  assert.equal(rows[0].idempotency_key, 'idem-queue-1', 'the row idempotency_key is the envelope key (never NULL)');
  assert.notEqual(rows[0].idempotency_key, null, 'the stored idempotency_key is never NULL');
  const payload = JSON.parse(rows[0].payload);
  assert.deepEqual(
    { kind: payload.kind, authority: payload.authority, subjectIds: payload.subjectIds, idempotencyKey: payload.idempotencyKey, body: payload.body },
    { kind: envelope.kind, authority: envelope.authority, subjectIds: envelope.subjectIds, idempotencyKey: envelope.idempotencyKey, body: envelope.body },
    'the stored payload round-trips the full command envelope',
  );
  assert.equal(rows[0].status, 'queued', 'the admitted command is queued on the durable command path');

  // Re-submission: the RECORDED receipt, verbatim; no second row.
  const second = await gateway.submitCommand(envelope);
  assert.equal(second.ok, true, 'the re-submission is admitted (replayed)');
  assert.equal(second.replayed, true, 'the re-submission replays the recorded key');
  assert.equal(second.receipt, first.receipt, 'the re-submission returns the RECORDED receipt verbatim');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM durable_jobs').get().n, 1, 'still exactly ONE durable_jobs row — never a second effect');

  // A different key under the same kind is a second command.
  const third = await gateway.submitCommand({ ...envelope, idempotencyKey: 'idem-queue-2' });
  assert.equal(third.ok, true);
  assert.equal(third.created, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM durable_jobs').get().n, 2, 'a different key is a second durable row');

  // The same key under a different kind is a DISTINCT dedupe identity.
  const fourth = await gateway.submitCommand({
    ...envelope,
    kind: 'intent.route',
    subjectIds: ['pid.v1.intent-queue'],
    body: { intentId: 'pid.v1.intent-queue' },
  });
  assert.equal(fourth.ok, true);
  assert.equal(fourth.created, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM durable_jobs').get().n, 3, 'the same key under a different kind is a distinct row');

  // A rejection writes exactly one A15 record and NO durable row.
  const heightBefore = log.height;
  const rejected = await gateway.submitCommand({ ...envelope, kind: 'intent.explode', idempotencyKey: 'idem-queue-rejected' });
  assert.equal(rejected.ok, false, 'the unknown-kind submission is refused');
  assert.equal(rejected.reasonCode, 'COMMAND_KIND_UNKNOWN');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM durable_jobs').get().n, 3, 'a rejected command writes NO durable row');
  assert.equal(log.height - heightBefore, 1, 'the refusal wrote exactly ONE A15 record');

  // The receipt store round-trips the admission (the composed durable side).
  const store = openGatewayStore({
    dbPath: join(dir, 'gateway.sqlite'),
    migrationsDir: join(GATEWAY_DIR, 'migrations'),
  });
  const write = writeCommandReceipt(store, {
    kind: envelope.kind,
    idempotencyKey: envelope.idempotencyKey,
    receipt: first.receipt,
    jobId: first.jobId,
  });
  assert.equal(write.created, true, 'the receipt write lands in the gateway store');
  const stored = readCommandReceipts(store).find(
    (row) => row.kind === envelope.kind && row.idempotencyKey === envelope.idempotencyKey,
  );
  assert.ok(stored, 'the receipt reads back');
  assert.equal(stored.receipt.commandId, first.receipt.commandId, 'the stored command id round-trips');
  store.close();
  db.close();
  pass('test:queue-submission');
}

// ---------------------------------------------------------------------------
// (d) [test:restart-durability] — cross-restart idempotency
// ---------------------------------------------------------------------------
async function testRestartDurability() {
  const dir = tempDir('restart');
  const dbPath = join(dir, 'durable.sqlite');
  const envelope = {
    kind: 'capability.commitment.reserve',
    authority: 'Capability Authority',
    subjectIds: ['pid.v1.commitment-restart'],
    idempotencyKey: 'idem-restart-1',
    protocolTime: { sequence: 0, wallMs: 1_000 },
    body: { commitmentId: 'pid.v1.commitment-restart' },
  };

  // Process A admits the command and closes everything (simulated restart).
  const dbA = dbModule.openDurableDatabase({ dbPath, migrationsDir: SUBSTRATE_MIGRATIONS_DIR });
  const queueA = new DurableQueue(dbA);
  const logA = createEvidenceLog({ wallMs: 1_000 });
  const gatewayA = new ProtocolGateway({
    evidence: logA,
    queue: commandQueuePortFromDurableQueue(queueA),
    wallClock: () => 5_000,
  });
  const first = await gatewayA.submitCommand(envelope);
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  dbA.close();

  // Process B reopens the durable queue (the gateway's receipt memory is
  // lost; the queue row is not) and re-submits the same (kind, key).
  const dbB = dbModule.openDurableDatabase({ dbPath, migrationsDir: SUBSTRATE_MIGRATIONS_DIR });
  const queueB = new DurableQueue(dbB);
  const logB = createEvidenceLog({ wallMs: 2_000 });
  const gatewayB = new ProtocolGateway({
    evidence: logB,
    queue: commandQueuePortFromDurableQueue(queueB),
    wallClock: () => 6_000,
  });
  const second = await gatewayB.submitCommand(envelope);
  assert.equal(second.ok, true, 'the cross-restart re-submission is admitted');
  assert.equal(second.replayed, true, 'the re-submission is a replay');
  assert.equal(second.created, false, 'the queue absorbed the re-submission (created: false)');
  assert.equal(second.receipt.outcome, 'DUPLICATE', 'the honest outcome for the absorbed re-submission is DUPLICATE');
  assert.equal(
    dbB.prepare('SELECT COUNT(*) AS n FROM durable_jobs').all()[0].n,
    1,
    'STILL exactly ONE durable row across the restart — never a second effect',
  );
  dbB.close();
  pass('test:restart-durability');
}

// ---------------------------------------------------------------------------
// (e) [test:gateway-health] — the health functions over the real queue
// ---------------------------------------------------------------------------
async function testGatewayHealth() {
  const dir = tempDir('health');
  const db = dbModule.openDurableDatabase({
    dbPath: join(dir, 'durable.sqlite'),
    migrationsDir: SUBSTRATE_MIGRATIONS_DIR,
  });
  const queue = new DurableQueue(db);
  const log = createEvidenceLog({ wallMs: 1_000 });
  let ticks = 0;
  const gateway = new ProtocolGateway({
    evidence: log,
    queue: commandQueuePortFromDurableQueue(queue),
    wallClock: () => {
      ticks += 1;
      return 10_000 + ticks;
    },
  });

  assert.equal(gateway.isReady(), true, 'readiness: the gateway is ready');
  const accepted = {
    kind: 'intent.route',
    authority: 'Intent Authority',
    subjectIds: ['pid.v1.intent-health'],
    idempotencyKey: 'idem-health-1',
    protocolTime: { sequence: 0, wallMs: 1_000 },
    body: { intentId: 'pid.v1.intent-health' },
  };
  const refused = { ...accepted, kind: 'intent.explode', idempotencyKey: 'idem-health-2' };
  await gateway.submitCommand(accepted);
  await gateway.submitCommand(accepted);
  await gateway.submitCommand(refused);
  const health = gateway.health();
  assert.equal(health.ready, true, 'health reports readiness');
  assert.equal(health.commandsTotal, 3, 'three completed typed outcomes');
  assert.equal(health.commandsAdmitted, 1, 'one first admission');
  assert.equal(health.commandsReplayed, 1, 'one idempotent replay');
  assert.equal(health.commandsRejected, 1, 'one refusal');
  assert.ok(Math.abs(health.commandAcceptanceRate - 2 / 3) < 1e-12, 'acceptance rate is 2/3');
  assert.equal(health.latencySamples, 3, 'latency was measured for every completed admission');
  assert.ok(health.meanAdmissionLatencyMs > 0, 'mean admission latency is positive under the tick clock');
  assert.equal(health.queueSubmits, 1, 'one durable enqueue attempt (replays never enqueue)');
  assert.equal(health.queueSubmitSuccesses, 1, 'the enqueue succeeded');
  assert.equal(health.lastQueueSubmitSuccess, true, 'the last queue submit succeeded');
  assert.ok(Math.abs(health.queueSubmitSuccessRate - 1) < 1e-12, 'queue submit success rate is 1');
  db.close();
  pass('test:gateway-health');
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
try {
  await testGatewayLoad();
  await testGatewayStore();
  await testQueueSubmission();
  await testRestartDurability();
  await testGatewayHealth();
} catch (error) {
  console.error(`\nRTN-010 gateway evidence suite FAILED: ${error instanceof Error ? error.message : error}`);
  if (error instanceof Error && error.stack) {
    console.error(error.stack.split('\n').slice(0, 6).join('\n'));
  }
  process.exit(1);
} finally {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log('\nRTN-010 gateway evidence suite: all cases passed.');
