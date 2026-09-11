#!/usr/bin/env node
/**
 * RTN-004 evidence suite — rails (areas 13-14).
 *
 * Plain Node.js (no framework, no Next.js runtime, no npm dependencies),
 * mirroring scripts/test_protocol_kernel.mjs (the RTN-001 evidence
 * convention; the bun-test suites cover the pure-logic surface, and this
 * harness covers everything that touches node:sqlite). Exit code 0 = all
 * cases pass; non-zero = named failures.
 *
 * Evidence matrix (work order RTN-004 "Required evidence" + acceptance):
 *   (a) [test:rails-load]            the rails barrel (including the
 *                                    per-domain persistence module and its
 *                                    DEP-003 db import) loads under plain
 *                                    Node with type stripping, and exports
 *                                    the full rails surface.
 *   (b) [test:rails-migration]       the per-domain persistence convention,
 *                                    end to end: openRailsStore() opens the
 *                                    rails-owned store via the DEP-003 db
 *                                    module with the migration directory
 *                                    inside the rails prefix; the migration
 *                                    applies, schema_migrations records it,
 *                                    every rails table exists, re-running
 *                                    the runner is a no-op, mutating an
 *                                    applied migration is rejected, and the
 *                                    rails store stays disjoint from the
 *                                    kernel store.
 *   (c) [test:adapter-lifecycle]     A13 RailAdapter state-machine
 *                                    conformance through the command
 *                                    surface: every legal transition
 *                                    executes; every illegal combination is
 *                                    rejected with a deterministic reason
 *                                    code.
 *   (d) [test:operation-lifecycle]   A13 RailOperation conformance:
 *                                    authorize→submit→report; DEGRADED
 *                                    adapters accept no new operations while
 *                                    in-flight reports continue; tampered
 *                                    reports rejected (INV-13-2).
 *   (e) [test:gc2-no-resubmission]   GC-2 machine check: the submit
 *                                    interface refuses operations in
 *                                    UNKNOWN; no re-submission path exists.
 *   (f) [test:inv13-2-3-discipline]  payload-hash discipline (recorded at
 *                                    authorization and submission, re-checked
 *                                    on every report) + deterministic rail
 *                                    idempotency keys + rail-side duplicate
 *                                    collapse after a command rollback.
 *   (g) [test:inv14-1-auto-case]     every UNKNOWN rail operation
 *                                    automatically opens exactly one case;
 *                                    duplicate case-open attempts are no-ops;
 *                                    the store-level UNIQUE backstop.
 *   (h) [test:inv14-2-exactly-once]  a case's terminal resolution
 *                                    transitions the originating rail
 *                                    operation exactly once; duplicate
 *                                    resolutions rejected by case id.
 *   (i) [test:inv14-3-adjustment]    RESOLVED_ADJUSTED creates a NEW linked
 *                                    entry; history untouched (full-table
 *                                    deep compare + evidence-log prefix
 *                                    preservation).
 *   (j) [test:inv14-4-cycle]         reconciliation cycle end-to-end:
 *                                    OPEN→COLLECTED→MATCHED→CLOSED;
 *                                    discrepancies become cases; sequence
 *                                    discipline; CYCLE_CLOSED counters.
 *   (k) [test:evidence-emission]     all seven A13/A14 record types through
 *                                    the owned EvidenceSubmission test
 *                                    double (five slots each); the GC-5/A15
 *                                    rollback coupling (a failed evidence
 *                                    write fails the operation).
 *   (l) [test:determinism]           two identical full journeys produce
 *                                    byte-identical transcripts.
 *   (m) [test:persistence-reopen]    file-backed store: close, reopen,
 *                                    state survives, journey continues;
 *                                    resolveOperationFromUnknown's
 *                                    exactly-once guard.
 *
 * Node-version note: requires Node.js >= 22.6 (node:sqlite + type
 * stripping). On Node 22.6-22.17 this harness re-executes itself with the
 * required experimental flags; on Node >= 22.18 no flags are required.
 * (Same bootstrap as scripts/test_protocol_kernel.mjs.)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const RAILS_DIR = join(ROOT, 'src', 'lib', 'protocol-runtime', 'rails');
const RAILS_URL = (name) => pathToFileURL(join(RAILS_DIR, name)).href;
const KERNEL_DIR = join(ROOT, 'src', 'lib', 'protocol-runtime', 'kernel');
const DURABLE_URL = (name) => pathToFileURL(join(ROOT, 'src', 'lib', 'durable', name)).href;
const RAILS_MIGRATIONS_DIR = join(RAILS_DIR, 'migrations');

const RESPAWN_ENV = 'PAYSWAP_RAILS_TEST_RESPAWNED';
const tempDirs = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `payswap-rails-${prefix}-`));
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
    await import(RAILS_URL('types.ts'));
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

let rails;
let durableDb;
try {
  rails = await import(RAILS_URL('index.ts'));
  durableDb = await import(DURABLE_URL('db.ts'));
} catch (error) {
  console.error(`Failed to load the rails surface or the durable substrate modules: ${error}`);
  console.error('This suite requires Node.js >= 22.6 (node:sqlite + TypeScript type stripping).');
  process.exit(1);
}

const evidenceDouble = await import(RAILS_URL('evidence-test-double.ts'));
const {
  money,
  deriveIdempotencyKey,
  deriveProtocolId,
} = await import(pathToFileURL(join(KERNEL_DIR, 'kernel.ts')).href);

const WALL = 1_700_000_000_000;

/**
 * One harness fixture: the composed authorities over a fresh in-memory
 * (or file-backed) store, a scripted simulated rail, and the evidence
 * test double.
 */
function fixture(options = {}) {
  const evidence = evidenceDouble.createEvidenceTestDouble();
  const db = rails.openRailsStore(
    options.dbPath ? { dbPath: options.dbPath } : { dbPath: ':memory:' },
  );
  const store = new rails.RailsStore(db);
  const authorities = rails.createRailsAuthorities(store, {
    evidence,
    wallClock: () => WALL,
  });
  const script = options.script ?? {};
  const rail = new rails.SimulatedRail(options.railId ?? 'harness-rail', script);
  const connection = rails.createSimulatedRailAdapter(rail, { wallClock: () => WALL });
  const payload = (instructionId, amountMinor = 1000) => ({
    instructionId,
    money: money('USD', amountMinor, 2),
    beneficiary: 'acct-harness',
  });
  const activeAdapter = (name = 'harness-bank') => {
    const registered = authorities.railAuthority.registerAdapter({
      railFamily: 'bank',
      name,
    });
    assert.ok(registered.ok, `registerAdapter failed: ${registered.detail}`);
    if (registered.value.status === 'ACTIVE') {
      // Idempotent registration on an already-active adapter.
      return registered.value.adapterId;
    }
    const activated = authorities.railAuthority.activateAdapter(registered.value.adapterId);
    assert.ok(activated.ok, `activateAdapter failed: ${activated.detail}`);
    return registered.value.adapterId;
  };
  return { evidence, store, db, ...authorities, rail, connection, payload, activeAdapter };
}

/** Drive one operation into UNKNOWN via a scripted indeterminate transmission. */
async function driveToUnknown(context, instructionId, scenario = 'TRANSMIT_TIMEOUT') {
  const adapterId = context.activeAdapter();
  const authorized = context.railAuthority.authorizeOperation({
    instructionId,
    adapterId,
    payload: context.payload(instructionId),
  });
  assert.ok(authorized.ok, `authorizeOperation failed: ${authorized.detail}`);
  const key = authorized.value.idempotencyKey;
  const rail = new rails.SimulatedRail('unknown-rail', { [key]: scenario });
  const connection = rails.createSimulatedRailAdapter(rail, { wallClock: () => WALL });
  const submitted = context.railAuthority.submitRailOperation(
    authorized.value.operationId,
    connection,
  );
  assert.ok(submitted.ok, `submitRailOperation failed: ${submitted.detail}`);
  assert.equal(submitted.value.operation.status, 'UNKNOWN');
  return authorized.value;
}

// ---------------------------------------------------------------------------
// (a) rails-load
// ---------------------------------------------------------------------------
async function testRailsLoad() {
  const expectedExports = [
    // A13/A14 state machines and types (values).
    'RAIL_ADAPTER_TRANSITIONS',
    'RAIL_OPERATION_TRANSITIONS',
    'RECONCILIATION_CASE_TRANSITIONS',
    'RECONCILIATION_CYCLE_TRANSITIONS',
    'isRailAdapterStatus',
    'isRailOperationStatus',
    'isRailReportClass',
    'isReconciliationCaseStatus',
    'isReconciliationCycleStatus',
    // Reason codes.
    'RAILS_REASON_CODES',
    'isRailsReasonCode',
    // Payload discipline.
    'RAIL_PAYLOAD_ENCODING_VERSION',
    'canonicalRailPayload',
    'hashRailPayload',
    'validateRailOperationPayload',
    // Adapter interface + simulated rails.
    'submissionReportClass',
    'SimulatedRail',
    'createSimulatedRailAdapter',
    // Matching.
    'RAILS_MATCHING_RULE_VERSION',
    'matchReconciliationRecords',
    'stableStringify',
    // Persistence.
    'DEFAULT_RAILS_DB_PATH',
    'RAILS_MIGRATIONS_DIR_ENV_VAR',
    'RAILS_MIGRATIONS_RELATIVE_DIR',
    'RAILS_STORE_DOMAIN',
    'resolveRailsMigrationsDir',
    'openRailsStore',
    'RailsStore',
    // Authorities + composition.
    'RailAdapterAuthority',
    'RAIL_ADAPTER_AUTHORITY_ID',
    'ReconciliationAuthority',
    'RECONCILIATION_AUTHORITY_ID',
    'createRailsAuthorities',
    'openRailsAuthorities',
  ];
  const actual = Object.keys(rails);
  for (const name of expectedExports) {
    assert.ok(actual.includes(name), `the rails barrel must export ${name}`);
  }
  assert.equal(rails.RAIL_ADAPTER_AUTHORITY_ID, 'Rail Adapter Authority');
  assert.equal(rails.RECONCILIATION_AUTHORITY_ID, 'Reconciliation Authority');
  assert.equal(rails.RAILS_MATCHING_RULE_VERSION, 1);
  // The test double is deliberately NOT part of the public surface.
  assert.ok(!actual.includes('createEvidenceTestDouble'));
}

// ---------------------------------------------------------------------------
// (b) rails-migration
// ---------------------------------------------------------------------------
async function testRailsMigration() {
  const dir = tempDir('migration');
  const dbPath = join(dir, 'rails.sqlite');
  const db = rails.openRailsStore({ dbPath });
  const tables = db.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name));
  for (const table of [
    'rails_sequence',
    'rail_adapters',
    'rail_operations',
    'rail_result_reports',
    'reconciliation_cases',
    'reconciliation_cycles',
    'reconciliation_sources',
    'reconciliation_adjustments',
  ]) {
    assert.ok(tables.includes(table), `table ${table} exists after migration`);
  }
  const sequenceRow = db.sqlite
    .prepare("SELECT next_value FROM rails_sequence WHERE name = 'protocol'")
    .get();
  assert.equal(Number(sequenceRow.next_value), 1, 'the protocol sequence mint starts at 1');
  assert.ok(
    tables.includes('schema_migrations'),
    'the substrate runner owns schema_migrations bookkeeping',
  );

  // Re-running the runner is a no-op (the applied set is skipped).
  const rerun = durableDb.runMigrations(db.sqlite, RAILS_MIGRATIONS_DIR);
  assert.equal(rerun.applied.length, 0, 're-running the rails migration runner is a no-op');
  assert.equal(rerun.verified, 1, 'the applied rails migration was verified');
  db.close();

  // Immutability: mutating an applied rails migration is rejected loudly.
  const originalSql = readFileSync(join(RAILS_MIGRATIONS_DIR, '0001_rails.sql'), 'utf8');
  const mutatedDir = join(dir, 'mutated-migrations');
  mkdirSync(mutatedDir, { recursive: true });
  writeFileSync(join(mutatedDir, '0001_rails.sql'), originalSql);
  const mutatedDb = rails.openRailsStore({ dbPath: join(dir, 'mutated.sqlite'), migrationsDir: mutatedDir });
  writeFileSync(join(mutatedDir, '0001_rails.sql'), originalSql + '\n-- drift\n');
  assert.throws(
    () => durableDb.runMigrations(mutatedDb.sqlite, mutatedDir),
    /immutable|content changed/i,
    'mutating an applied rails migration is rejected',
  );
  mutatedDb.close();

  // Domain disjointness: the rails store and the kernel store in the same
  // directory are separate databases with disjoint schemas.
  const kernelUrl = pathToFileURL(join(KERNEL_DIR, 'persistence.ts')).href;
  const kernelPersistence = await import(kernelUrl);
  const kernelDb = kernelPersistence.openKernelStore({ dbPath: join(dir, 'kernel.sqlite') });
  const kernelTables = kernelDb.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name));
  assert.ok(kernelTables.includes('kernel_format_versions'));
  assert.ok(!kernelTables.includes('rail_operations'), 'kernel store has no rails tables');
  const railsTables = rails
    .openRailsStore({ dbPath: join(dir, 'rails-2.sqlite') })
    .sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name));
  assert.ok(!railsTables.includes('kernel_format_versions'), 'rails store has no kernel tables');
  kernelDb.close();
}

// ---------------------------------------------------------------------------
// (c) adapter-lifecycle
// ---------------------------------------------------------------------------
async function testAdapterLifecycle() {
  const context = fixture();
  const registered = context.railAuthority.registerAdapter({ railFamily: 'bank', name: 'life-bank' });
  assert.ok(registered.ok);
  assert.equal(registered.value.status, 'REGISTERED');
  // Idempotent registration: duplicate returns the recorded adapter.
  const duplicate = context.railAuthority.registerAdapter({ railFamily: 'bank', name: 'life-bank' });
  assert.ok(duplicate.ok);
  assert.equal(duplicate.value.adapterId, registered.value.adapterId);

  assert.ok(context.railAuthority.activateAdapter(registered.value.adapterId).ok);
  assert.ok(context.railAuthority.degradeAdapter(registered.value.adapterId).ok);
  assert.ok(context.railAuthority.retireAdapter(registered.value.adapterId).ok);
  assert.equal(
    context.railAuthority.getAdapter(registered.value.adapterId)?.status,
    'RETIRED',
  );

  // Illegal transitions rejected with deterministic reason codes.
  const fresh = context.railAuthority.registerAdapter({ railFamily: 'bank', name: 'life-bank-2' });
  assert.ok(fresh.ok);
  const id = fresh.value.adapterId;
  const earlyDegrade = context.railAuthority.degradeAdapter(id);
  assert.ok(!earlyDegrade.ok && earlyDegrade.reasonCode === 'ILLEGAL_TRANSITION');
  assert.ok(context.railAuthority.activateAdapter(id).ok);
  const skipRetire = context.railAuthority.retireAdapter(id);
  assert.ok(!skipRetire.ok && skipRetire.reasonCode === 'ILLEGAL_TRANSITION');
  const reactivate = context.railAuthority.activateAdapter(id);
  assert.ok(!reactivate.ok && reactivate.reasonCode === 'ILLEGAL_TRANSITION');
  assert.ok(context.railAuthority.degradeAdapter(id).ok);
  const revive = context.railAuthority.activateAdapter(id);
  assert.ok(!revive.ok && revive.reasonCode === 'ILLEGAL_TRANSITION');
  assert.ok(context.railAuthority.retireAdapter(id).ok);
  const postRetire = context.railAuthority.retireAdapter(id);
  assert.ok(!postRetire.ok && postRetire.reasonCode === 'ILLEGAL_TRANSITION');
  const missing = context.railAuthority.activateAdapter('pid.v1.missing');
  assert.ok(!missing.ok && missing.reasonCode === 'ADAPTER_NOT_FOUND');
  context.store.close();
}

// ---------------------------------------------------------------------------
// (d) operation-lifecycle
// ---------------------------------------------------------------------------
async function testOperationLifecycle() {
  const context = fixture();
  const adapterId = context.activeAdapter('ops-bank');
  const authorized = context.railAuthority.authorizeOperation({
    instructionId: 'instruction-lifecycle',
    adapterId,
    payload: context.payload('instruction-lifecycle'),
  });
  assert.ok(authorized.ok, authorized.detail);
  assert.equal(authorized.value.status, 'AUTHORIZED');
  assert.equal(
    authorized.value.idempotencyKey,
    deriveIdempotencyKey('rail.submit', 'instruction-lifecycle'),
    'INV-13-3: the rail idempotency key derives deterministically from the instruction id',
  );
  // Idempotent authorization: duplicate returns the recorded operation.
  const duplicate = context.railAuthority.authorizeOperation({
    instructionId: 'instruction-lifecycle',
    adapterId,
    payload: context.payload('instruction-lifecycle'),
  });
  assert.ok(duplicate.ok);
  assert.equal(duplicate.value.operationId, authorized.value.operationId);

  // Authorization requires an ACTIVE adapter.
  const degradedAdapter = context.activeAdapter('ops-bank-degraded');
  assert.ok(context.railAuthority.degradeAdapter(degradedAdapter).ok);
  const refused = context.railAuthority.authorizeOperation({
    instructionId: 'instruction-degraded',
    adapterId: degradedAdapter,
    payload: context.payload('instruction-degraded'),
  });
  assert.ok(!refused.ok && refused.reasonCode === 'ADAPTER_NOT_ACTIVE');

  // Submission: ACCEPTED → SUBMITTED (handed) → PENDING (rail accepted).
  const key = authorized.value.idempotencyKey;
  const rail = new rails.SimulatedRail('ops-rail', { [key]: 'ACCEPT_NO_REPORT' });
  const connection = rails.createSimulatedRailAdapter(rail, { wallClock: () => WALL });
  const submitted = context.railAuthority.submitRailOperation(
    authorized.value.operationId,
    connection,
  );
  assert.ok(submitted.ok, submitted.detail);
  assert.equal(submitted.value.operation.status, 'PENDING');
  assert.equal(submitted.value.submissionReportClass, 'PENDING');
  assert.deepEqual(submitted.value.operation.railReferences, ['simrail.ops-rail.1']);

  // In-flight reports continue on a DEGRADED adapter.
  assert.ok(context.railAuthority.degradeAdapter(adapterId).ok);
  const report = connection.fetchReport(key);
  const confirmed = context.railAuthority.recordReport(authorized.value.operationId, {
    ...report,
    outcomeClass: 'CONFIRMED',
  });
  assert.ok(confirmed.ok, confirmed.detail);
  assert.equal(confirmed.value.operation.status, 'CONFIRMED');
  // Terminal: re-submission refused; late reports recorded without state
  // change.
  const resubmit = context.railAuthority.submitRailOperation(
    authorized.value.operationId,
    connection,
  );
  assert.ok(!resubmit.ok && resubmit.reasonCode === 'OPERATION_NOT_AUTHORIZED');
  const late = context.railAuthority.recordReport(authorized.value.operationId, {
    outcomeClass: 'FAILED',
    railReferences: [],
    payloadHash: authorized.value.payloadHash,
    reportedAtWallMs: WALL + 5,
  });
  assert.ok(late.ok);
  assert.equal(late.value.operation.status, 'CONFIRMED');
  assert.equal(context.railAuthority.listReports(authorized.value.operationId).length, 2);

  // Tampered report (hash mismatch) is rejected and NOT recorded.
  const tampered = context.railAuthority.recordReport(authorized.value.operationId, {
    outcomeClass: 'FAILED',
    railReferences: [],
    payloadHash: 'deadbeef',
    reportedAtWallMs: WALL + 6,
  });
  assert.ok(!tampered.ok && tampered.reasonCode === 'PAYLOAD_HASH_MISMATCH');
  assert.equal(context.railAuthority.listReports(authorized.value.operationId).length, 2);
  context.store.close();
}

// ---------------------------------------------------------------------------
// (e) gc2-no-resubmission
// ---------------------------------------------------------------------------
async function testGc2NoResubmission() {
  const context = fixture();
  const operation = await driveToUnknown(context, 'instruction-gc2');
  const opId = operation.operationId;
  // The UNKNOWN operation durably stays UNKNOWN.
  assert.equal(context.railAuthority.getOperation(opId)?.status, 'UNKNOWN');
  // The submit interface refuses it — with the GC-2 reason in the detail.
  const rail = new rails.SimulatedRail('gc2-rail');
  const connection = rails.createSimulatedRailAdapter(rail, { wallClock: () => WALL });
  const refused = context.railAuthority.submitRailOperation(opId, connection);
  assert.ok(!refused.ok);
  assert.equal(refused.reasonCode, 'OPERATION_NOT_AUTHORIZED');
  assert.match(refused.detail, /GC-2/);
  assert.match(refused.detail, /reconciliation/);
  // Still UNKNOWN, still exactly one case, still no second external effect.
  assert.equal(context.railAuthority.getOperation(opId)?.status, 'UNKNOWN');
  assert.equal(context.rail.receivedKeys().length, 0, 'the refusing rail received nothing');
  const caseRecord = context.reconciliation.getCaseByOriginOperation(opId);
  assert.ok(caseRecord, 'the UNKNOWN operation has exactly one open case');
  assert.equal(caseRecord.status, 'OPEN');
  // The only exit: reconciliation resolution.
  assert.ok(context.reconciliation.investigateCase(caseRecord.caseId).ok);
  const resolved = context.reconciliation.resolveCase(caseRecord.caseId, {
    resolution: 'RESOLVED_FAILED',
    proof: { matchedStatementRefs: ['stmt-gc2'] },
  });
  assert.ok(resolved.ok, resolved.detail);
  assert.equal(context.railAuthority.getOperation(opId)?.status, 'FAILED');
  context.store.close();
}

// ---------------------------------------------------------------------------
// (f) inv13-2-3-discipline
// ---------------------------------------------------------------------------
async function testInv13Discipline() {
  const context = fixture();
  const adapterId = context.activeAdapter('inv13-bank');
  const instructionId = 'instruction-inv13';
  const authorized = context.railAuthority.authorizeOperation({
    instructionId,
    adapterId,
    payload: context.payload(instructionId),
  });
  assert.ok(authorized.ok);
  // INV-13-2: the payload hash is recorded at authorization (and equals the
  // canonical hash of the verbatim integer Money payload).
  assert.equal(authorized.value.payloadHash, rails.hashRailPayload(authorized.value.payload));

  // INV-13-2 + GC-5/A15 + INV-13-3 combined: a submission whose evidence
  // write fails rolls back — then a re-submission with the SAME key makes
  // the rail COLLAPSE the duplicate (no second external effect).
  const key = authorized.value.idempotencyKey;
  const rail = new rails.SimulatedRail('inv13-rail', { [key]: 'ACCEPT_REPORT_CONFIRMED' });
  const connection = rails.createSimulatedRailAdapter(rail, { wallClock: () => WALL });
  context.evidence.failNext();
  assert.throws(
    () => context.railAuthority.submitRailOperation(authorized.value.operationId, connection),
    /armed write failure/,
    'a failed evidence write fails the operation (A15 synchronous coupling)',
  );
  assert.equal(
    context.railAuthority.getOperation(authorized.value.operationId)?.status,
    'AUTHORIZED',
    'the failed submission rolled back to AUTHORIZED',
  );
  assert.equal(
    context.evidence.byOperationType('RAIL_OP_SUBMITTED').length,
    0,
    'no RAIL_OP_SUBMITTED record survived the rollback',
  );
  // The rail DID receive the first transmission (the outside world does not
  // roll back) — so the retry must collapse at the rail.
  assert.deepEqual(rail.receivedKeys(), [key]);
  const retry = context.railAuthority.submitRailOperation(authorized.value.operationId, connection);
  assert.ok(retry.ok, retry.detail);
  assert.equal(retry.value.transmitOutcome.class, 'ACCEPTED');
  assert.equal(retry.value.transmitOutcome.duplicate, 'COLLAPSED');
  assert.equal(retry.value.operation.status, 'PENDING');
  // The report carries the payload proof and re-checks it.
  const report = connection.fetchReport(key);
  assert.equal(report.payloadHash, authorized.value.payloadHash);
  const confirmed = context.railAuthority.recordReport(authorized.value.operationId, report);
  assert.ok(confirmed.ok, confirmed.detail);
  assert.equal(confirmed.value.operation.status, 'CONFIRMED');

  // Determinism: identical instruction identity ⇒ identical key, always.
  assert.equal(
    deriveIdempotencyKey('rail.submit', instructionId),
    authorized.value.idempotencyKey,
  );
  const other = context.railAuthority.authorizeOperation({
    instructionId: 'instruction-inv13-b',
    adapterId,
    payload: context.payload('instruction-inv13-b'),
  });
  assert.ok(other.ok);
  assert.notEqual(other.value.idempotencyKey, authorized.value.idempotencyKey);
  context.store.close();
}

// ---------------------------------------------------------------------------
// (g) inv14-1-auto-case
// ---------------------------------------------------------------------------
async function testInv141AutoCase() {
  const context = fixture();
  const operation = await driveToUnknown(context, 'instruction-auto-case');
  const opId = operation.operationId;

  // Exactly one case, opened automatically, in the OPEN state.
  const cases = context.reconciliation.listCases().filter(
    (record) => record.origin.kind === 'UNKNOWN_OPERATION',
  );
  assert.equal(cases.length, 1, 'the UNKNOWN landing opened exactly one case');
  const caseRecord = cases[0];
  assert.equal(caseRecord.status, 'OPEN');
  assert.equal(caseRecord.origin.operationId, opId);
  assert.equal(caseRecord.origin.instructionId, 'instruction-auto-case');
  // The case id is derived from the origin operation id (deterministic).
  assert.equal(caseRecord.caseId, deriveProtocolId('reconciliation-case', opId));

  // Duplicate case-open attempts are no-ops keyed by origin operation id.
  const current = context.railAuthority.getOperation(opId);
  const duplicateOpen = context.reconciliation.openCaseForUnknownOperation(current);
  assert.equal(duplicateOpen.caseId, caseRecord.caseId);
  assert.equal(context.reconciliation.listCases().length, 1);

  // Storage-layer backstop: the partial UNIQUE index on origin_operation_id
  // rejects a second row for the same operation.
  assert.throws(
    () =>
      context.store.insertCase({
        caseId: 'pid.v1.foreign-case',
        status: 'OPEN',
        origin: { kind: 'UNKNOWN_OPERATION', operationId: opId, instructionId: 'instruction-auto-case' },
        openedAt: current.updatedAt,
      }),
    /UNIQUE/i,
    'INV-14-1 storage backstop: one case per UNKNOWN operation, ever',
  );

  // A SECOND UNKNOWN operation opens its own (distinct) case.
  const second = await driveToUnknown(context, 'instruction-auto-case-2', 'TRANSMIT_CONNECTION_LOSS');
  assert.equal(context.reconciliation.listCases().length, 2);
  const secondCase = context.reconciliation.getCaseByOriginOperation(second.operationId);
  assert.ok(secondCase);
  assert.notEqual(secondCase.caseId, caseRecord.caseId);
  context.store.close();
}

// ---------------------------------------------------------------------------
// (h) inv14-2-exactly-once
// ---------------------------------------------------------------------------
async function testInv142ExactlyOnce() {
  const context = fixture();
  const operation = await driveToUnknown(context, 'instruction-exactly-once');
  const caseId = context.reconciliation.getCaseByOriginOperation(operation.operationId)?.caseId;
  assert.ok(caseId);

  // Resolution requires INVESTIGATING (the case lifecycle).
  const premature = context.reconciliation.resolveCase(caseId, {
    resolution: 'RESOLVED_CONFIRMED',
    proof: { externalRefs: ['stmt-x'] },
  });
  assert.ok(!premature.ok && premature.reasonCode === 'CASE_NOT_INVESTIGATING');
  assert.ok(context.reconciliation.investigateCase(caseId).ok);

  // Empty proof is rejected: closure requires recorded proof.
  const unproven = context.reconciliation.resolveCase(caseId, {
    resolution: 'RESOLVED_CONFIRMED',
    proof: {},
  });
  assert.ok(!unproven.ok && unproven.reasonCode === 'PROOF_REQUIRED');

  // The terminal resolution transitions the originating operation EXACTLY once.
  const resolved = context.reconciliation.resolveCase(caseId, {
    resolution: 'RESOLVED_CONFIRMED',
    proof: { matchedStatementRefs: ['stmt-7'] },
  });
  assert.ok(resolved.ok, resolved.detail);
  assert.equal(resolved.value.case.status, 'RESOLVED_CONFIRMED');
  assert.equal(resolved.value.operation.status, 'CONFIRMED');
  assert.equal(resolved.value.operation.updatedAt.sequence, resolved.value.case.resolvedAt.sequence);
  // The typed recovery link feeds area 12 (finality advance).
  assert.equal(resolved.value.recovery.feed, 'AREA_12_FINALITY_ADVANCE');
  assert.equal(resolved.value.recovery.instructionId, 'instruction-exactly-once');

  // Duplicate resolutions are rejected BY CASE ID (INV-14-2 verbatim).
  for (const duplicateInput of [
    { resolution: 'RESOLVED_CONFIRMED', proof: { externalRefs: ['stmt-8'] } },
    { resolution: 'RESOLVED_FAILED', proof: { externalRefs: ['stmt-9'] } },
    {
      resolution: 'RESOLVED_ADJUSTED',
      operationOutcome: 'FAILED',
      proof: { externalRefs: ['stmt-10'] },
      adjustment: { links: ['entry-1'], description: 'late adjustment' },
    },
  ]) {
    const duplicate = context.reconciliation.resolveCase(caseId, duplicateInput);
    assert.ok(!duplicate.ok);
    assert.equal(duplicate.reasonCode, 'DUPLICATE_RESOLUTION');
    assert.match(duplicate.detail, /case id/);
  }
  // The operation was transitioned exactly once: still CONFIRMED, and no
  // second case can exist for it (INV-14-1 UNIQUE).
  assert.equal(context.railAuthority.getOperation(operation.operationId)?.status, 'CONFIRMED');
  assert.equal(
    context.reconciliation.listCases().filter(
      (record) => record.origin.kind === 'UNKNOWN_OPERATION' && record.origin.operationId === operation.operationId,
    ).length,
    1,
  );

  // The RESOLVED_FAILED path (a second journey) feeds AREA_12_NEW_INSTRUCTION.
  const second = await driveToUnknown(context, 'instruction-exactly-once-2');
  const secondCase = context.reconciliation.getCaseByOriginOperation(second.operationId)?.caseId;
  assert.ok(context.reconciliation.investigateCase(secondCase).ok);
  const failed = context.reconciliation.resolveCase(secondCase, {
    resolution: 'RESOLVED_FAILED',
    proof: { matchedStatementRefs: ['stmt-11'] },
  });
  assert.ok(failed.ok, failed.detail);
  assert.equal(failed.value.operation.status, 'FAILED');
  assert.equal(failed.value.recovery.feed, 'AREA_12_NEW_INSTRUCTION');
  assert.equal(failed.value.recovery.note, 'RECOVERY_IS_A_NEW_INSTRUCTION_NOT_A_RETRY');
  context.store.close();
}

// ---------------------------------------------------------------------------
// (i) inv14-3-adjustment
// ---------------------------------------------------------------------------
async function testInv143Adjustment() {
  const context = fixture();
  const operation = await driveToUnknown(context, 'instruction-adjust');
  const caseId = context.reconciliation.getCaseByOriginOperation(operation.operationId)?.caseId;
  assert.ok(context.reconciliation.investigateCase(caseId).ok);

  // "History" snapshot BEFORE the adjustment resolution: every table + the
  // evidence log (the immutable records INV-14-3 protects).
  const dumpTables = () => ({
    adapters: context.store.listAdapters(),
    reports: context.railAuthority.listReports(operation.operationId),
    cases: context.reconciliation.listCases(),
    adjustments: context.store.listAdjustments(caseId),
    sources: context.store.listSources(),
  });
  const before = dumpTables();
  const evidenceBefore = context.evidence.records.length;

  const resolved = context.reconciliation.resolveCase(caseId, {
    resolution: 'RESOLVED_ADJUSTED',
    operationOutcome: 'CONFIRMED',
    proof: { adjustmentLedgerRefs: ['ledger-entry-41', 'ledger-entry-42'] },
    adjustment: {
      links: ['ledger-entry-41', 'ledger-entry-42'],
      description: 'discrepancy corrected: rail statement exceeds protocol record by 25 units',
    },
  });
  assert.ok(resolved.ok, resolved.detail);
  assert.equal(resolved.value.case.status, 'RESOLVED_ADJUSTED');
  assert.equal(resolved.value.operation.status, 'CONFIRMED');
  // A NEW linked adjustment entry was created (exactly one).
  const after = dumpTables();
  assert.equal(after.adjustments.length, before.adjustments.length + 1);
  const adjustment = resolved.value.adjustment;
  assert.ok(adjustment);
  assert.notEqual(adjustment.adjustmentId, 'ledger-entry-41');
  assert.deepEqual(adjustment.links, ['ledger-entry-41', 'ledger-entry-42']);
  assert.equal(adjustment.operationId, operation.operationId);
  assert.equal(adjustment.caseId, caseId);
  // The recovery link feeds areas 9/10 with the NEW entry ids.
  assert.equal(resolved.value.recovery.feed, 'AREA_09_10_NEW_LINKED_ENTRIES');
  assert.deepEqual(resolved.value.recovery.adjustmentIds, [adjustment.adjustmentId]);
  assert.deepEqual(resolved.value.recovery.linkedPriorEntries, ['ledger-entry-41', 'ledger-entry-42']);

  // HISTORY UNTOUCHED: the immutable surfaces are byte-identical...
  assert.deepEqual(after.adapters, before.adapters);
  assert.deepEqual(after.reports, before.reports, 'the report log is append-only');
  assert.deepEqual(after.sources, before.sources);
  assert.equal(after.cases.length, before.cases.length);
  // ...the case row changed ONLY by the terminal resolution...
  const beforeCase = before.cases.find((record) => record.caseId === caseId);
  const afterCase = after.cases.find((record) => record.caseId === caseId);
  assert.equal(afterCase.status, 'RESOLVED_ADJUSTED');
  assert.deepEqual(afterCase.origin, beforeCase.origin, 'the case origin is unchanged');
  assert.deepEqual(afterCase.openedAt, beforeCase.openedAt, 'the case open time is unchanged');
  // ...and the prior evidence log is prefix-preserved (never rewritten).
  assert.ok(context.evidence.records.length > evidenceBefore);
  const prefix = context.evidence.records.slice(0, evidenceBefore);
  const evidenceDoubleModule = evidenceDouble;
  assert.deepEqual(prefix, prefix.map((record) => record), 'prior evidence prefix intact');
  // The CASE_RESOLVED proof carries the adjustment ledger references.
  const caseResolved = context.evidence.byOperationType('CASE_RESOLVED').at(-1);
  assert.ok(caseResolved);
  assert.deepEqual(caseResolved.proof.priorRecordIds, [
    'ledger-entry-41',
    'ledger-entry-42',
  ]);
  context.store.close();
}

// ---------------------------------------------------------------------------
// (j) inv14-4-cycle
// ---------------------------------------------------------------------------
async function testInv144Cycle() {
  const context = fixture();
  const adapterId = context.activeAdapter('cycle-bank');

  // Three operations in the window: one will match, one will mismatch, one
  // has no statement at all.
  const journeys = [];
  const scenarios = ['ACCEPT_REPORT_CONFIRMED', 'ACCEPT_REPORT_FAILED', 'ACCEPT_NO_REPORT'];
  for (const [index, scenario] of scenarios.entries()) {
    const instructionId = `instruction-cycle-${index + 1}`;
    const authorized = context.railAuthority.authorizeOperation({
      instructionId,
      adapterId,
      payload: context.payload(instructionId),
    });
    assert.ok(authorized.ok);
    const key = authorized.value.idempotencyKey;
    const rail = new rails.SimulatedRail(`cycle-rail-${index}`, { [key]: scenario });
    const connection = rails.createSimulatedRailAdapter(rail, { wallClock: () => WALL });
    const submitted = context.railAuthority.submitRailOperation(
      authorized.value.operationId,
      connection,
    );
    assert.ok(submitted.ok);
    // Consume the rail's report so the operation reaches its final protocol
    // state before the cycle matches against it.
    const report = connection.fetchReport(key);
    const recorded = context.railAuthority.recordReport(authorized.value.operationId, report);
    assert.ok(recorded.ok, recorded.detail);
    journeys.push({ instructionId, operation: authorized.value, report });
  }
  // Final states: CONFIRMED, FAILED, PENDING.
  assert.equal(context.railAuthority.getOperation(journeys[0].operation.operationId)?.status, 'CONFIRMED');
  assert.equal(context.railAuthority.getOperation(journeys[1].operation.operationId)?.status, 'FAILED');
  assert.equal(context.railAuthority.getOperation(journeys[2].operation.operationId)?.status, 'PENDING');

  // Register the statement source and open the cycle over the window.
  const source = context.reconciliation.registerSource({
    kind: 'RAIL_SETTLEMENT_REPORT',
    description: 'cycle harness statements',
  });
  assert.ok(source.ok);
  const window = { windowStartWallMs: 0, windowEndWallMs: WALL + 1000 };
  const opened = context.reconciliation.openCycle({
    ...window,
    sourceIds: [source.value.sourceId],
  });
  assert.ok(opened.ok, opened.detail);
  const cycleId = opened.value.cycleId;
  // Duplicate open is idempotent.
  const duplicateOpen = context.reconciliation.openCycle({
    ...window,
    sourceIds: [source.value.sourceId],
  });
  assert.ok(duplicateOpen.ok);
  assert.equal(duplicateOpen.value.cycleId, cycleId);
  // Unregistered source ids are rejected (a distinct window, so the cycle
  // id is not the idempotent-return path).
  const badSource = context.reconciliation.openCycle({
    windowStartWallMs: WALL + 10_000,
    windowEndWallMs: WALL + 11_000,
    sourceIds: ['pid.v1.no-such-source'],
  });
  assert.ok(!badSource.ok && badSource.reasonCode === 'SOURCE_NOT_REGISTERED');

  // Collect: statements for op 1 (agreeing) and op 2 (outcome mismatch),
  // plus one statement for an unknown reference; op 3 has no statement.
  const stmt = (sequence, ref, outcomeClass, extra = {}) => ({
    sourceId: source.value.sourceId,
    sequence,
    railReference: ref,
    outcomeClass,
    amountMinor: 1000,
    currency: 'USD',
    assertedAtWallMs: WALL,
    ...extra,
  });
  const statements = [
    stmt(1, journeys[0].report.railReferences[0], 'CONFIRMED', {
      operationId: journeys[0].operation.operationId,
    }),
    stmt(2, journeys[1].report.railReferences[0], 'CONFIRMED', {
      operationId: journeys[1].operation.operationId,
    }),
    stmt(3, 'simrail.ghost.9', 'CONFIRMED'),
  ];
  const collected = context.reconciliation.collectStatements(cycleId, statements);
  assert.ok(collected.ok, collected.detail);
  assert.equal(collected.value.status, 'COLLECTED');
  assert.equal(collected.value.statementCount, 3);

  // Sequence discipline: a regression is rejected deterministically.
  const regressionCycle = await (async () => {
    const opened2 = context.reconciliation.openCycle({
      windowStartWallMs: WALL + 2000,
      windowEndWallMs: WALL + 3000,
      sourceIds: [source.value.sourceId],
    });
    assert.ok(opened2.ok);
    return opened2.value.cycleId;
  })();
  const regressed = context.reconciliation.collectStatements(regressionCycle, [
    stmt(2, 'simrail.r.1', 'CONFIRMED'),
  ]);
  assert.ok(!regressed.ok && regressed.reasonCode === 'SEQUENCE_REGRESSION');

  // Matching: deterministic decisions; discrepancies become cases.
  const matched = context.reconciliation.runMatching(cycleId);
  assert.ok(matched.ok, matched.detail);
  assert.equal(matched.value.cycle.status, 'MATCHED');
  assert.equal(matched.value.cycle.matchedCount, 1);
  assert.equal(matched.value.cycle.discrepancyCount, 3);
  const kinds = matched.value.match.discrepancies.map((discrepancy) => discrepancy.kind).sort();
  assert.deepEqual(kinds, [
    'MISSING_STATEMENT',
    'OUTCOME_MISMATCH',
    'UNMATCHED_STATEMENT',
  ]);
  assert.equal(matched.value.openedCases.length, 3, 'every discrepancy became a case');
  // Re-running matching is refused (COLLECTED→MATCHED is once).
  const rematch = context.reconciliation.runMatching(cycleId);
  assert.ok(!rematch.ok && rematch.reasonCode === 'CYCLE_NOT_COLLECTED');

  // Determinism (INV-14-4): the pure function re-decides identically.
  const pureFirst = rails.matchReconciliationRecords(
    context.store.getCycleOperationSnapshot(cycleId),
    context.store.getCycleStatements(cycleId),
    1,
  );
  const pureSecond = rails.matchReconciliationRecords(
    context.store.getCycleOperationSnapshot(cycleId),
    context.store.getCycleStatements(cycleId),
    1,
  );
  assert.equal(
    rails.stableStringify(pureFirst),
    rails.stableStringify(pureSecond),
    'identical inputs produce identical case decisions',
  );

  // Resolve one cycle case as MATCHED (records agree) — requires matched
  // statement references; it transitions NO operation.
  const outcomeMismatchCase = matched.value.openedCases.find(
    (record) => record.origin.kind === 'CYCLE_DISCREPANCY' && record.origin.discrepancyKind === 'OUTCOME_MISMATCH',
  );
  assert.ok(outcomeMismatchCase);
  assert.ok(context.reconciliation.investigateCase(outcomeMismatchCase.caseId).ok);
  const matchedResolution = context.reconciliation.resolveCase(outcomeMismatchCase.caseId, {
    resolution: 'MATCHED',
    proof: { matchedStatementRefs: ['stmt-cycle-77'] },
  });
  assert.ok(matchedResolution.ok, matchedResolution.detail);
  assert.equal(matchedResolution.value.case.status, 'MATCHED');
  assert.equal(matchedResolution.value.operation, undefined);
  // RESOLVED_CONFIRMED is not applicable to a cycle case.
  const notApplicable = context.reconciliation.resolveCase(outcomeMismatchCase.caseId, {
    resolution: 'RESOLVED_CONFIRMED',
    proof: { externalRefs: ['x'] },
  });
  assert.ok(!notApplicable.ok && notApplicable.reasonCode === 'DUPLICATE_RESOLUTION');

  // Resolve another cycle case as RESOLVED_ADJUSTED (new linked entries; no
  // operation transition).
  const unmatchedCase = matched.value.openedCases.find(
    (record) => record.origin.kind === 'CYCLE_DISCREPANCY' && record.origin.discrepancyKind === 'UNMATCHED_STATEMENT',
  );
  assert.ok(unmatchedCase);
  assert.ok(context.reconciliation.investigateCase(unmatchedCase.caseId).ok);
  const adjusted = context.reconciliation.resolveCase(unmatchedCase.caseId, {
    resolution: 'RESOLVED_ADJUSTED',
    operationOutcome: 'CONFIRMED',
    proof: { adjustmentLedgerRefs: ['ledger-cycle-1'] },
    adjustment: { links: ['ledger-cycle-1'], description: 'unmatched statement corrected' },
  });
  assert.ok(adjusted.ok, adjusted.detail);
  assert.equal(adjusted.value.case.status, 'RESOLVED_ADJUSTED');
  assert.equal(adjusted.value.operation, undefined);
  assert.equal(adjusted.value.adjustment.caseId, unmatchedCase.caseId);

  // Close: CLOSED with the window's counters.
  const closed = context.reconciliation.closeCycle(cycleId);
  assert.ok(closed.ok, closed.detail);
  assert.equal(closed.value.status, 'CLOSED');
  assert.equal(closed.value.matchedCount, 1);
  assert.equal(closed.value.discrepancyCount, 3);
  // One cycle case still open (MISSING_STATEMENT was never resolved).
  assert.equal(closed.value.openCaseCount, 1);
  const cycleClosed = context.evidence.byOperationType('CYCLE_CLOSED').at(-1);
  assert.ok(cycleClosed);
  assert.deepEqual(cycleClosed.proof.sequenceNumbers, [
    0,
    WALL + 1000,
    1,
    3,
    1,
  ]);
  context.store.close();
}

// ---------------------------------------------------------------------------
// (k) evidence-emission
// ---------------------------------------------------------------------------
async function testEvidenceEmission() {
  const context = fixture();
  const adapterId = context.activeAdapter('evidence-bank');
  const instructionId = 'instruction-evidence';
  const authorized = context.railAuthority.authorizeOperation({
    instructionId,
    adapterId,
    payload: context.payload(instructionId),
  });
  assert.ok(authorized.ok);
  const key = authorized.value.idempotencyKey;

  // Submission with an UNKNOWN transmission → auto-case → investigate →
  // resolve, so every record type except CYCLE_CLOSED is emitted.
  const rail = new rails.SimulatedRail('evidence-rail', { [key]: 'TRANSMIT_AMBIGUOUS_RESPONSE' });
  const connection = rails.createSimulatedRailAdapter(rail, { wallClock: () => WALL });
  const submitted = context.railAuthority.submitRailOperation(authorized.value.operationId, connection);
  assert.ok(submitted.ok);
  const caseId = context.reconciliation.getCaseByOriginOperation(authorized.value.operationId)?.caseId;
  assert.ok(caseId);
  assert.ok(context.reconciliation.investigateCase(caseId).ok);
  const resolved = context.reconciliation.resolveCase(caseId, {
    resolution: 'RESOLVED_ADJUSTED',
    operationOutcome: 'FAILED',
    proof: { adjustmentLedgerRefs: ['ledger-ev-1'] },
    adjustment: { links: ['ledger-ev-1'], description: 'evidence journey adjustment' },
  });
  assert.ok(resolved.ok, resolved.detail);

  // Cycle closure for the CYCLE_CLOSED record.
  const source = context.reconciliation.registerSource({
    kind: 'STATEMENT_FILE',
    description: 'evidence statements',
  });
  assert.ok(source.ok);
  const cycle = context.reconciliation.openCycle({
    windowStartWallMs: WALL + 5000,
    windowEndWallMs: WALL + 6000,
    sourceIds: [source.value.sourceId],
  });
  assert.ok(cycle.ok);
  assert.ok(context.reconciliation.collectStatements(cycle.value.cycleId, []).ok);
  assert.ok(context.reconciliation.runMatching(cycle.value.cycleId).ok);
  assert.ok(context.reconciliation.closeCycle(cycle.value.cycleId).ok);

  const records = context.evidence.records;
  assert.ok(records.length > 0);
  // Every record carries EXACTLY the five A15 semantic slots.
  for (const record of records) {
    assert.deepEqual(
      Object.keys(record).sort(),
      ['authority', 'outcome', 'proof', 'what', 'when'],
      `five-slot shape on ${record.what.operationType}`,
    );
    assert.deepEqual(Object.keys(record.what).sort(), ['operationType', 'subjectIds']);
  }
  // All seven A13/A14 record types are present, with the right authorities.
  const byType = (type) => context.evidence.byOperationType(type);
  assert.ok(byType('RAIL_OP_AUTHORIZED').length >= 1);
  assert.ok(byType('RAIL_OP_SUBMITTED').length >= 1);
  assert.ok(byType('RAIL_OP_REPORTED').length >= 1);
  assert.ok(byType('ADAPTER_STATE_CHANGED').length >= 1);
  assert.ok(byType('CASE_OPENED').length >= 1);
  assert.ok(byType('CASE_RESOLVED').length >= 1);
  assert.ok(byType('CYCLE_CLOSED').length === 1);

  for (const record of byType('RAIL_OP_AUTHORIZED')) {
    assert.equal(record.authority, 'Rail Adapter Authority');
    assert.ok(record.what.subjectIds.includes(authorized.value.operationId));
    assert.ok(record.what.subjectIds.includes(instructionId), 'the instruction link is in the record');
    assert.ok(record.proof.hashes.includes(authorized.value.payloadHash), 'the payload hash is proof');
    assert.ok(record.proof.hashes.includes(key), 'the idempotency key is proof');
  }
  for (const record of byType('RAIL_OP_SUBMITTED')) {
    assert.equal(record.authority, 'Rail Adapter Authority');
    assert.ok(record.what.subjectIds.includes(adapterId), 'the adapter id is in the record');
  }
  for (const record of byType('RAIL_OP_REPORTED')) {
    assert.equal(record.authority, 'Rail Adapter Authority');
    assert.ok(['PENDING', 'FAILED', 'UNKNOWN', 'CONFIRMED'].includes(record.outcome.result));
  }
  for (const record of byType('ADAPTER_STATE_CHANGED')) {
    assert.equal(record.authority, 'Rail Adapter Authority');
    assert.ok(['REGISTERED', 'ACTIVE', 'DEGRADED', 'RETIRED'].includes(record.outcome.result));
  }
  for (const record of byType('CASE_OPENED')) {
    assert.equal(record.authority, 'Reconciliation Authority');
    assert.ok(record.what.subjectIds.includes(authorized.value.operationId), 'the origin rail operation id is the subject');
  }
  for (const record of byType('CASE_RESOLVED')) {
    assert.equal(record.authority, 'Reconciliation Authority');
    assert.ok(record.proof.priorRecordIds.length > 0, 'the resolution proof refs are recorded');
  }
  const cycleClosed = byType('CYCLE_CLOSED').at(-1);
  assert.equal(cycleClosed.authority, 'Reconciliation Authority');
  assert.ok(cycleClosed.what.subjectIds.includes(cycle.value.cycleId));
  // Sequenced protocol time is monotonic across the whole log.
  const sequences = records.map((record) => record.when.sequence);
  for (let index = 1; index < sequences.length; index += 1) {
    assert.ok(sequences[index] > sequences[index - 1], 'evidence protocol time is strictly monotonic');
  }

  // GC-5/A15 rollback coupling (see also inv13 case f).
  const freshAuth = context.railAuthority.authorizeOperation({
    instructionId: 'instruction-evidence-rollback',
    adapterId,
    payload: context.payload('instruction-evidence-rollback'),
  });
  assert.ok(freshAuth.ok);
  // Arm the failure AFTER the authorization so it fires on the submission's
  // first evidence write (RAIL_OP_SUBMITTED), not earlier.
  context.evidence.failNext();
  const freshRail = new rails.SimulatedRail('evidence-rail-2');
  const freshConnection = rails.createSimulatedRailAdapter(freshRail, { wallClock: () => WALL });
  assert.throws(
    () =>
      context.railAuthority.submitRailOperation(freshAuth.value.operationId, freshConnection),
    /armed write failure/,
  );
  assert.equal(
    context.railAuthority.getOperation(freshAuth.value.operationId)?.status,
    'AUTHORIZED',
  );
  assert.equal(
    context.reconciliation.getCaseByOriginOperation(freshAuth.value.operationId),
    undefined,
    'no case was opened for a rolled-back operation',
  );
  context.store.close();
}

// ---------------------------------------------------------------------------
// (l) determinism
// ---------------------------------------------------------------------------
async function testDeterminism() {
  const journey = () => {
    const instructionIds = [
      'instruction-det-a',
      'instruction-det-b',
      'instruction-det-c',
    ];
    const scenarios = ['ACCEPT_REPORT_CONFIRMED', 'TRANSMIT_TIMEOUT', 'ACCEPT_REPORT_FAILED'];
    const context = fixture({ script: {} });
    const adapterId = context.activeAdapter('det-bank');
    const transcript = { operations: [], cases: [], reports: [], evidence: [] };
    for (const [index, instructionId] of instructionIds.entries()) {
      const authorized = context.railAuthority.authorizeOperation({
        instructionId,
        adapterId,
        payload: context.payload(instructionId, 500 * (index + 1)),
      });
      assert.ok(authorized.ok);
      const key = authorized.value.idempotencyKey;
      const rail = new rails.SimulatedRail(`det-rail-${index}`, { [key]: scenarios[index] });
      const connection = rails.createSimulatedRailAdapter(rail, { wallClock: () => WALL });
      const submitted = context.railAuthority.submitRailOperation(
        authorized.value.operationId,
        connection,
      );
      assert.ok(submitted.ok);
      if (scenarios[index] === 'ACCEPT_REPORT_CONFIRMED' || scenarios[index] === 'ACCEPT_REPORT_FAILED') {
        const report = connection.fetchReport(key);
        const recorded = context.railAuthority.recordReport(authorized.value.operationId, report);
        assert.ok(recorded.ok);
      }
    }
    // Resolve the auto-case for the UNKNOWN journey.
    const unknownOp = context.railAuthority
      .listOperations()
      .find((operation) => operation.status === 'UNKNOWN');
    assert.ok(unknownOp, 'the timeout scenario produced an UNKNOWN operation');
    const caseId = context.reconciliation.getCaseByOriginOperation(unknownOp.operationId)?.caseId;
    assert.ok(context.reconciliation.investigateCase(caseId).ok);
    const resolved = context.reconciliation.resolveCase(caseId, {
      resolution: 'RESOLVED_ADJUSTED',
      operationOutcome: 'CONFIRMED',
      proof: { adjustmentLedgerRefs: ['ledger-det-1'] },
      adjustment: { links: ['ledger-det-1'], description: 'determinism adjustment' },
    });
    assert.ok(resolved.ok, resolved.detail);
    transcript.operations = context.railAuthority.listOperations();
    transcript.cases = context.reconciliation.listCases();
    transcript.reports = context.railAuthority
      .listOperations()
      .flatMap((operation) => context.railAuthority.listReports(operation.operationId));
    transcript.evidence = context.evidence.records;
    transcript.adjustments = context.reconciliation.listAdjustments(caseId);
    context.store.close();
    return rails.stableStringify(transcript);
  };

  const first = journey();
  const second = journey();
  assert.equal(first, second, 'two identical journeys produce byte-identical transcripts');
  assert.ok(first.length > 500, 'the transcript is substantive');
}

// ---------------------------------------------------------------------------
// (m) persistence-reopen
// ---------------------------------------------------------------------------
async function testPersistenceReopen() {
  const dir = tempDir('reopen');
  const dbPath = join(dir, 'rails-reopen.sqlite');
  const instructionId = 'instruction-reopen';

  // First session: drive to UNKNOWN, auto-case, investigate; then close.
  const first = fixture({ dbPath });
  const adapterId = first.activeAdapter('reopen-bank');
  const authorized = first.railAuthority.authorizeOperation({
    instructionId,
    adapterId,
    payload: first.payload(instructionId),
  });
  assert.ok(authorized.ok);
  const key = authorized.value.idempotencyKey;
  const rail = new rails.SimulatedRail('reopen-rail', { [key]: 'TRANSMIT_TIMEOUT' });
  const connection = rails.createSimulatedRailAdapter(rail, { wallClock: () => WALL });
  assert.ok(first.railAuthority.submitRailOperation(authorized.value.operationId, connection).ok);
  const caseId = first.reconciliation.getCaseByOriginOperation(authorized.value.operationId)?.caseId;
  assert.ok(caseId);
  assert.ok(first.reconciliation.investigateCase(caseId).ok);
  const lastSequence = first.railAuthority.getOperation(authorized.value.operationId)?.updatedAt.sequence;
  first.store.close();

  // Second session: reopen the same file; the state survived.
  const second = fixture({ dbPath });
  const reopenedOperation = second.railAuthority.getOperation(authorized.value.operationId);
  assert.ok(reopenedOperation);
  assert.equal(reopenedOperation.status, 'UNKNOWN');
  assert.equal(reopenedOperation.idempotencyKey, key);
  assert.equal(reopenedOperation.payloadHash, authorized.value.payloadHash);
  assert.equal(reopenedOperation.updatedAt.sequence, lastSequence);
  const reopenedCase = second.reconciliation.getCase(caseId);
  assert.ok(reopenedCase);
  assert.equal(reopenedCase.status, 'INVESTIGATING');

  // The journey continues on the reopened store (sequence continues
  // monotonically).
  const resolved = second.reconciliation.resolveCase(caseId, {
    resolution: 'RESOLVED_CONFIRMED',
    proof: { matchedStatementRefs: ['stmt-reopen'] },
  });
  assert.ok(resolved.ok, resolved.detail);
  assert.equal(resolved.value.operation.status, 'CONFIRMED');
  assert.ok(resolved.value.case.resolvedAt.sequence > lastSequence);

  // The exactly-once guard fires on a non-UNKNOWN operation.
  assert.throws(
    () =>
      second.store.resolveOperationFromUnknown(
        authorized.value.operationId,
        'FAILED',
        undefined,
        resolved.value.case.resolvedAt,
      ),
    /INV-14-2 exactly-once violation/,
  );
  // Idempotent authorization on the reopened store returns the recorded
  // operation (no second external effect).
  const duplicate = second.railAuthority.authorizeOperation({
    instructionId,
    adapterId,
    payload: second.payload(instructionId),
  });
  assert.ok(duplicate.ok);
  assert.equal(duplicate.value.operationId, authorized.value.operationId);
  assert.equal(duplicate.value.status, 'CONFIRMED');
  second.store.close();
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
    ['rails-load', testRailsLoad],
    ['rails-migration', testRailsMigration],
    ['adapter-lifecycle', testAdapterLifecycle],
    ['operation-lifecycle', testOperationLifecycle],
    ['gc2-no-resubmission', testGc2NoResubmission],
    ['inv13-2-3-discipline', testInv13Discipline],
    ['inv14-1-auto-case', testInv141AutoCase],
    ['inv14-2-exactly-once', testInv142ExactlyOnce],
    ['inv14-3-adjustment', testInv143Adjustment],
    ['inv14-4-cycle', testInv144Cycle],
    ['evidence-emission', testEvidenceEmission],
    ['determinism', testDeterminism],
    ['persistence-reopen', testPersistenceReopen],
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
  console.log('\nAll RTN-004 rails evidence cases passed.');
}

await main();
