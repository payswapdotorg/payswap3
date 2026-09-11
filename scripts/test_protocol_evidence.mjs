#!/usr/bin/env node
/**
 * RTN-002 evidence suite — Evidence Authority (area 15).
 *
 * Plain Node.js (no framework, no Next.js runtime, no npm dependencies),
 * mirroring scripts/test_protocol_kernel.mjs (the RTN-001 evidence-harness
 * convention — Bun 1.3.14 does not implement node:sqlite, so every
 * SQLite-touching evidence case runs under plain Node here, while the pure
 * logic suites run under `bun test`). Exit code 0 = all cases pass;
 * non-zero = named failures.
 *
 * Evidence matrix (work order RTN-002 "Required evidence" + the persistence
 * demonstration):
 *   (a) [test:evidence-load]        the evidence barrel (including the
 *                                   persistence module and its DEP-003 db
 *                                   import) loads under plain Node with type
 *                                   stripping, and exports the full evidence
 *                                   surface (the EvidenceSubmission port
 *                                   implementation included).
 *   (b) [test:evidence-migration]   the per-domain persistence convention,
 *                                   end to end: openEvidenceStore() opens an
 *                                   evidence-owned store via the DEP-003 db
 *                                   module with the migration directory
 *                                   inside the evidence prefix
 *                                   (src/lib/protocol-runtime/evidence/
 *                                   migrations/); the migration applies,
 *                                   schema_migrations records it, the
 *                                   evidence_records table exists, re-running
 *                                   the runner is a no-op, mutating an
 *                                   applied migration is rejected
 *                                   (immutability), UPDATE/DELETE on
 *                                   evidence_records are rejected by the
 *                                   INV-15-2 triggers, and the evidence
 *                                   store stays fully disjoint from the
 *                                   kernel store and the substrate store.
 *   (c) [test:evidence-log-durable] the composed log + store integration:
 *                                   an in-process EvidenceLog (genesis,
 *                                   multi-authority submissions, duplicate
 *                                   no-op, verification lifecycle records)
 *                                   is written record-by-record into the
 *                                   durable store; read back, the records
 *                                   deep-equal the in-process records and
 *                                   the chain verifies with the identical
 *                                   verdict; a duplicate durable write
 *                                   reports created:false (the INV-15-4
 *                                   no-op); the synchronous commit coupling
 *                                   behaves under plain Node; and the whole
 *                                   scenario is deterministic (two runs,
 *                                   identical transcripts and digests).
 *
 * Node-version note: requires Node.js >= 22.6 (node:sqlite + type
 * stripping); on 22.6-22.17 this harness re-executes itself with
 * --experimental-sqlite / --experimental-strip-types as needed; on
 * Node >= 22.18 no flags are required. (Same bootstrap as
 * scripts/test_durable.mjs and scripts/test_protocol_kernel.mjs.)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const EVIDENCE_DIR = join(ROOT, 'src', 'lib', 'protocol-runtime', 'evidence');
const EVIDENCE_URL = (name) => pathToFileURL(join(EVIDENCE_DIR, name)).href;
const KERNEL_DIR = join(ROOT, 'src', 'lib', 'protocol-runtime', 'kernel');
const DURABLE_URL = (name) => pathToFileURL(join(ROOT, 'src', 'lib', 'durable', name)).href;
const SUBSTRATE_MIGRATIONS_DIR = join(ROOT, 'deploy', 'migrations');

const RESPAWN_ENV = 'PAYSWAP_EVIDENCE_TEST_RESPAWNED';
const tempDirs = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `payswap-evidence-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

/**
 * Capability bootstrap (mirrors scripts/test_protocol_kernel.mjs): probes
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
    await import(EVIDENCE_URL('record.ts'));
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

let evidence;
let dbModule;
try {
  evidence = await import(EVIDENCE_URL('evidence.ts'));
  dbModule = await import(DURABLE_URL('db.ts'));
} catch (error) {
  console.error(`Failed to load the evidence module or the durable substrate modules: ${error}`);
  console.error('This suite requires Node.js >= 22.6 (node:sqlite + TypeScript type stripping).');
  process.exit(1);
}

const {
  canonicalJson,
  EVIDENCE_AUTHORITIES,
  EVIDENCE_LIFECYCLE_VOCABULARY,
  evidenceWriteKey,
  evidenceRecordId,
  isEvidenceRecord,
  validateEvidenceSubmission,
  canonicalSubmissionEncoding,
  EVIDENCE_CHAIN_FORMAT_VERSION,
  EVIDENCE_VERIFICATION_REASON_CODES,
  GENESIS_PREDECESSOR_HASH,
  computeRecordHash,
  verifyEvidenceChain,
  createEvidenceLog,
  commitWithEvidence,
  verificationLifecycleSubmission,
  DEFAULT_EVIDENCE_DB_PATH,
  EVIDENCE_MIGRATIONS_DIR_ENV_VAR,
  EVIDENCE_MIGRATIONS_RELATIVE_DIR,
  EVIDENCE_STORE_DOMAIN,
  resolveEvidenceMigrationsDir,
  openEvidenceStore,
  writeEvidenceRecord,
  readEvidenceRecords,
} = evidence;

const WALL = 1_700_000_000_000;

const SUBMISSIONS = [
  {
    what: { operationType: 'INTENT_CREATED', subjectIds: ['intent-1'] },
    when: { sequence: 3, wallMs: WALL + 1 },
    authority: 'Intent Authority',
    outcome: { result: 'DRAFT', reasonCode: 'UNKNOWN' },
    proof: { sequenceNumbers: [3] },
  },
  {
    what: { operationType: 'COMMITMENT_RESERVED', subjectIds: ['commitment-1', 'intent-1'] },
    when: { sequence: 11, wallMs: WALL + 2 },
    authority: 'Capability Authority',
    outcome: { result: 'RESERVED' },
    proof: { hashes: ['claim-7'], priorRecordIds: [] },
  },
  {
    what: { operationType: 'SETTLEMENT_MARKED_FINAL', subjectIds: ['settlement-9'] },
    when: { sequence: 29, wallMs: WALL + 3 },
    authority: 'Settlement and Finality Authority',
    outcome: { result: 'FINAL' },
    proof: { hashes: ['stmt-1', 'stmt-2'], sequenceNumbers: [29, 30] },
  },
  {
    what: { operationType: 'RAIL_OPERATION_REPORTED', subjectIds: ['rail-op-4'] },
    when: { sequence: 31, wallMs: WALL + 4 },
    authority: 'Rail Authority',
    outcome: { result: 'UNKNOWN', reasonCode: 'UNKNOWN' },
    proof: { hashes: ['rail-ref-1'] },
  },
];

/** Build the reference scenario log (deterministic: fixed wall times). */
function buildScenarioLog() {
  const log = createEvidenceLog({ wallMs: WALL });
  for (const submission of SUBMISSIONS) {
    log.submit(submission);
  }
  log.submit(SUBMISSIONS[1]); // duplicate -> no-op (INV-15-4)
  log.verifyAndRecord(WALL + 50); // lifecycle verification run, recorded
  return log;
}

// ---------------------------------------------------------------------------
// (a) [test:evidence-load]
// ---------------------------------------------------------------------------
async function testEvidenceLoad() {
  assert.equal(typeof canonicalJson, 'function', 'exports canonicalJson');
  assert.equal(typeof evidenceWriteKey, 'function', 'exports evidenceWriteKey');
  assert.equal(typeof evidenceRecordId, 'function', 'exports evidenceRecordId');
  assert.equal(typeof isEvidenceRecord, 'function', 'exports isEvidenceRecord');
  assert.equal(typeof validateEvidenceSubmission, 'function', 'exports validateEvidenceSubmission');
  assert.equal(typeof canonicalSubmissionEncoding, 'function', 'exports canonicalSubmissionEncoding');
  assert.equal(typeof computeRecordHash, 'function', 'exports computeRecordHash');
  assert.equal(typeof verifyEvidenceChain, 'function', 'exports verifyEvidenceChain');
  assert.equal(typeof createEvidenceLog, 'function', 'exports createEvidenceLog');
  assert.equal(typeof commitWithEvidence, 'function', 'exports commitWithEvidence');
  assert.equal(typeof verificationLifecycleSubmission, 'function', 'exports verificationLifecycleSubmission');
  assert.equal(typeof openEvidenceStore, 'function', 'exports openEvidenceStore');
  assert.equal(typeof resolveEvidenceMigrationsDir, 'function', 'exports resolveEvidenceMigrationsDir');
  assert.equal(typeof writeEvidenceRecord, 'function', 'exports writeEvidenceRecord');
  assert.equal(typeof readEvidenceRecords, 'function', 'exports readEvidenceRecords');
  assert.equal(EVIDENCE_CHAIN_FORMAT_VERSION, 1, 'chain format version is 1');
  assert.equal(GENESIS_PREDECESSOR_HASH, 'GENESIS', 'genesis sentinel');
  assert.equal(EVIDENCE_STORE_DOMAIN, 'protocol-runtime-evidence', 'evidence store domain');
  assert.equal(DEFAULT_EVIDENCE_DB_PATH, 'var/evidence.sqlite', 'default evidence db path');
  assert.equal(EVIDENCE_MIGRATIONS_DIR_ENV_VAR, 'PAYSWAP_EVIDENCE_MIGRATIONS_DIR', 'migrations env var');
  assert.equal(EVIDENCE_MIGRATIONS_RELATIVE_DIR, join('src', 'lib', 'protocol-runtime', 'evidence', 'migrations'), 'owned migrations dir');
  assert.equal(EVIDENCE_LIFECYCLE_VOCABULARY.genesisOperationType, 'EVIDENCE_LOG_GENESIS', 'genesis operation type');
  assert.equal(EVIDENCE_VERIFICATION_REASON_CODES.length, 4, 'four verification reason codes');

  // The port implementation works under plain Node: the log satisfies the
  // kernel-declared EvidenceSubmission port (structural: submit is the only
  // write channel, synchronous void).
  const log = createEvidenceLog({ wallMs: WALL });
  const portSubmission = {
    what: { operationType: 'INTENT_CREATED', subjectIds: ['intent-port-1'] },
    when: { sequence: 5, wallMs: WALL + 5 },
    authority: 'Intent Authority',
    outcome: { result: 'DRAFT' },
    proof: {},
  };
  log.submit(portSubmission);
  assert.equal(log.height, 2, 'the port submit path works under plain Node');
  assert.equal(log.records()[1].what.operationType, 'INTENT_CREATED');
  assert.ok(isEvidenceRecord(log.records()[1]), 'written record passes the runtime guard');

  // The migration directory resolves INSIDE the evidence prefix.
  const resolved = resolveEvidenceMigrationsDir();
  assert.ok(
    resolved.endsWith(EVIDENCE_MIGRATIONS_RELATIVE_DIR),
    `evidence migrations dir resolves inside the evidence prefix (got ${resolved})`,
  );
}

// ---------------------------------------------------------------------------
// (b) [test:evidence-migration] — the per-domain persistence convention
// ---------------------------------------------------------------------------
async function testEvidenceMigration() {
  const dir = tempDir('migration');
  const { runMigrations } = dbModule;

  // The evidence-owned store opens via the DEP-003 db module, with the
  // migration directory inside the evidence prefix (explicitly passed so
  // the test is independent of the walk-up resolution).
  const store = openEvidenceStore({
    dbPath: join(dir, 'evidence.sqlite'),
    migrationsDir: join(EVIDENCE_DIR, 'migrations'),
  });

  assert.ok(store.sqlite, 'evidence store exposes the underlying DatabaseSync handle');
  assert.equal(store.migrationsDir, join(EVIDENCE_DIR, 'migrations'), 'store used the evidence migrations dir');

  const applied = store.appliedMigrations();
  assert.equal(applied.length, 1, 'exactly one evidence migration applied');
  assert.equal(applied[0].name, '0001_evidence.sql', 'the evidence migration is 0001_evidence.sql');
  assert.match(applied[0].checksum, /^[0-9a-f]{64}$/, 'sha256 content checksum recorded');

  // Schema existence: the evidence-owned table exists.
  const table = store.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get('evidence_records');
  assert.ok(table, 'evidence_records table exists after migration');

  // The INV-15-2 triggers exist and enforce append-only at the boundary.
  const triggers = store.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
    .all()
    .map((row) => String(row.name));
  assert.ok(triggers.includes('evidence_records_no_update'), 'no-update trigger exists');
  assert.ok(triggers.includes('evidence_records_no_delete'), 'no-delete trigger exists');

  // Substrate-inherited guarantees: WAL + synchronous=FULL.
  const journal = store.sqlite.prepare('PRAGMA journal_mode').get();
  assert.equal(String(journal.journal_mode).toLowerCase(), 'wal', 'WAL journaling is active');
  const syncMode = store.sqlite.prepare('PRAGMA synchronous').get();
  assert.equal(Number(syncMode.synchronous), 2, 'synchronous=FULL is active');

  // Re-running the runner is a no-op (the applied set is skipped).
  const rerun = runMigrations(store.sqlite, join(EVIDENCE_DIR, 'migrations'));
  assert.equal(rerun.applied.length, 0, 're-running the evidence migration runner is a no-op');
  assert.equal(rerun.verified, 1, 'the applied evidence migration was verified');
  store.close();

  // Immutability: mutating an applied evidence migration is rejected loudly.
  const originalSql = readFileSync(join(EVIDENCE_DIR, 'migrations', '0001_evidence.sql'), 'utf8');
  const mutatedDir = join(dir, 'mutated-migrations');
  mkdirSync(mutatedDir, { recursive: true });
  writeFileSync(join(mutatedDir, '0001_evidence.sql'), originalSql);
  const mutatedStore = openEvidenceStore({
    dbPath: join(dir, 'mutated.sqlite'),
    migrationsDir: mutatedDir,
  });
  writeFileSync(join(mutatedDir, '0001_evidence.sql'), originalSql + '\n-- drift\n');
  assert.throws(
    () => runMigrations(mutatedStore.sqlite, mutatedDir),
    /immutable|content changed/i,
    'mutating an applied evidence migration is rejected',
  );
  mutatedStore.close();

  // The evidence store, the kernel store, and the substrate store stay
  // fully disjoint domains: each opens its OWN database file with its OWN
  // schema (the per-domain persistence convention).
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
  assert.ok(!substrateTables.includes('evidence_records'), 'substrate store has no evidence table');

  const { openKernelStore } = await import(pathToFileURL(join(KERNEL_DIR, 'persistence.ts')).href);
  const kernelStore = openKernelStore({
    dbPath: join(dir, 'kernel.sqlite'),
    migrationsDir: join(KERNEL_DIR, 'migrations'),
  });
  const kernelTables = kernelStore.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name));
  assert.ok(kernelTables.includes('kernel_format_versions'), 'kernel store has its table');
  assert.ok(!kernelTables.includes('evidence_records'), 'kernel store has no evidence table');

  const evidenceStoreTwo = openEvidenceStore({
    dbPath: join(dir, 'evidence2.sqlite'),
    migrationsDir: join(EVIDENCE_DIR, 'migrations'),
  });
  const evidenceTables = evidenceStoreTwo.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name));
  assert.ok(evidenceTables.includes('evidence_records'), 'evidence store has its table');
  assert.ok(!evidenceTables.includes('durable_jobs'), 'evidence store has no substrate table');
  assert.ok(!evidenceTables.includes('kernel_format_versions'), 'evidence store has no kernel table');
  assert.ok(!evidenceTables.includes('durable_events'), 'evidence store does NOT reuse the substrate lifecycle events table (A15 is protocol-owned)');
  evidenceStoreTwo.close();
  kernelStore.close();
  substrateStore.close();
}

// ---------------------------------------------------------------------------
// (c) [test:evidence-log-durable] — log + store, composed
// ---------------------------------------------------------------------------
async function testEvidenceLogDurable() {
  const dir = tempDir('log-durable');
  const store = openEvidenceStore({
    dbPath: join(dir, 'evidence.sqlite'),
    migrationsDir: join(EVIDENCE_DIR, 'migrations'),
  });

  const log = buildScenarioLog();
  // genesis + 4 submissions + 1 verification record = 6 records (the
  // duplicate submission was a no-op).
  assert.equal(log.height, 6, 'scenario height: genesis + 4 records + verification run');
  assert.equal(
    log.records().filter((record) => record.what.operationType === 'COMMITMENT_RESERVED').length,
    1,
    'the duplicate submission produced exactly one record (INV-15-4)',
  );

  // The chain verifies in-process.
  const inProcessVerification = verifyEvidenceChain(log.records());
  assert.equal(inProcessVerification.verdict, 'VERIFIED', 'the in-process chain verifies');

  // Write every record into the durable store.
  for (const record of log.records()) {
    const write = writeEvidenceRecord(store, record);
    assert.equal(write.created, true, `record ${record.proof.sequenceNumber} written`);
    assert.equal(write.reason, 'written');
    assert.equal(write.recordId, record.proof.recordId);
  }
  const countRow = store.sqlite.prepare('SELECT COUNT(*) AS total FROM evidence_records').get();
  assert.equal(Number(countRow.total), 6, 'exactly six durable rows');

  // INV-15-2 at the storage boundary: UPDATE and DELETE are rejected by the
  // triggers.
  assert.throws(
    () => store.sqlite.prepare("UPDATE evidence_records SET authority = 'Rail Authority' WHERE sequence_number = 1").run(),
    /INV-15-2/,
    'UPDATE on evidence_records is rejected (append-only)',
  );
  assert.throws(
    () => store.sqlite.prepare('DELETE FROM evidence_records WHERE sequence_number = 1').run(),
    /INV-15-2/,
    'DELETE on evidence_records is rejected (append-only)',
  );

  // Duplicate durable writes are no-ops (the INV-15-4 write key).
  const duplicateWrite = writeEvidenceRecord(store, log.records()[1]);
  assert.equal(duplicateWrite.created, false, 'duplicate durable write reports created:false');
  assert.equal(duplicateWrite.reason, 'duplicate-no-op');
  const countAfterDuplicate = store.sqlite.prepare('SELECT COUNT(*) AS total FROM evidence_records').get();
  assert.equal(Number(countAfterDuplicate.total), 6, 'still exactly six durable rows');

  // Read back: the durable copy equals the in-process log, and the chain
  // verifies over the durable copy with the IDENTICAL verdict.
  const readBack = readEvidenceRecords(store);
  assert.equal(readBack.length, 6, 'six records read back');
  assert.deepEqual(readBack, log.records(), 'the durable copy deep-equals the in-process records');
  const durableVerification = verifyEvidenceChain(readBack);
  assert.deepEqual(durableVerification, inProcessVerification, 'the durable chain verdict is identical');

  // A tampered durable copy is detectable: drop the trigger, tamper a row,
  // read back, verify (the in-process log is unaffected — it is the
  // in-process source of truth for this demonstration).
  store.sqlite.exec('DROP TRIGGER evidence_records_no_update');
  store.sqlite.prepare("UPDATE evidence_records SET outcome_result = 'HACKED' WHERE sequence_number = 2").run();
  const tamperedRecords = readEvidenceRecords(store);
  const tamperedVerification = verifyEvidenceChain(tamperedRecords);
  assert.equal(tamperedVerification.verdict, 'TAMPER_DETECTED', 'tampering the durable copy is detected');
  assert.equal(tamperedVerification.divergence.sequenceNumber, 2, 'detected at the tampered row');
  assert.equal(tamperedVerification.divergence.problem, 'RECORD_HASH_MISMATCH');
  assert.equal(
    verifyEvidenceChain(tamperedRecords).divergence.detail,
    tamperedVerification.divergence.detail,
    'the tamper detail is deterministic',
  );

  // The synchronous commit coupling behaves under plain Node.
  const committed = commitWithEvidence(
    log,
    () => ({ state: 'RESERVED' }),
    (result) => ({
      what: { operationType: 'COMMITMENT_RESERVED', subjectIds: ['commitment-durable-1'] },
      when: { sequence: 41, wallMs: WALL + 41 },
      authority: 'Capability Authority',
      outcome: { result: result.state },
      proof: {},
    }),
  );
  assert.deepEqual(committed, { state: 'RESERVED' }, 'the coupled operation delivered its result');
  assert.equal(log.height, 7, 'its record was written synchronously');
  assert.throws(
    () =>
      commitWithEvidence(
        log,
        () => 'never-delivered',
        () => ({
          what: { operationType: 'X', subjectIds: ['x'] },
          when: { sequence: 42, wallMs: WALL + 42 },
          authority: 'Not A Registry Authority',
          outcome: { result: 'Y' },
          proof: {},
        }),
      ),
    /registry's owning authorities/,
    'a failed record write fails the operation (result not delivered)',
  );
  assert.equal(log.height, 7, 'the failed write left no record');

  // Determinism: rebuild the whole scenario; identical transcripts/digests.
  const transcriptOf = (targetLog) =>
    targetLog
      .records()
      .map((record) => JSON.stringify(record))
      .join('\n');
  const runOne = transcriptOf(buildScenarioLog());
  const runTwo = transcriptOf(buildScenarioLog());
  assert.equal(runTwo, runOne, 'two scenario runs produce identical record transcripts');
  const digestOne = createHash('sha256').update(runOne, 'utf8').digest('hex');
  const digestTwo = createHash('sha256').update(runTwo, 'utf8').digest('hex');
  assert.equal(digestTwo, digestOne, 'identical scenario digests');
  assert.match(digestOne, /^[0-9a-f]{64}$/, 'the digest is a sha256 hex digest');

  store.close();
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
    ['evidence-load', testEvidenceLoad],
    ['evidence-migration', testEvidenceMigration],
    ['evidence-log-durable', testEvidenceLogDurable],
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
  console.log('\nAll RTN-002 evidence authority evidence cases passed.');
}

await main();
