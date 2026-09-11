#!/usr/bin/env node
/**
 * payswap3 · RTN-005 — Intent / Fulfillment Policy / Capability authorities
 * evidence harness (areas 1-3, per-domain persistence).
 *
 * Plain-Node evidence suite for the SQLite-backed surfaces of the three
 * RTN-005 domains (the same split the RTN-001 kernel and RTN-002 evidence
 * domain use): `bun test` covers the pure modules and the in-process
 * authorities (including the real-log evidence coupling and the RTN-003
 * gate integration); THIS harness exercises each domain's per-domain store
 * — open<Domain>Store over the DEP-003 database layer (node:sqlite), the
 * owned migrations, and the write-through bridges — because Bun does not
 * implement node:sqlite.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/core.md §1 Area 1 lines 33-44 (PaymentIntent,
 *     DemandDescriptor, IntentReceipt — the persisted records);
 *   §2 Area 2 lines 97-107 (FulfillmentPolicy, PolicyEvaluation);
 *   §3 Area 3 lines 154-166 (Capability, Commitment, CapabilitySnapshot);
 *   INV-1-2/INV-1-3 (core.md lines 57-62), INV-2-3 (lines 121-123),
 *   INV-3-1/INV-3-3 (lines 176-184) — the storage-level UNIQUE constraints
 *   that make the idempotency contracts structural;
 *   spec/protocol-runtime-work-orders/README.md "Persistence convention"
 *   (per-domain schema + owned migrations, DEP-003 read-only).
 *
 * Scenario per domain: run the in-process authority against the REAL
 * in-process A15 log (createEvidenceLog), then persist every committed
 * record through the domain bridge, read everything back, and assert the
 * round trip reconstructs the records exactly (Money re-minted through the
 * kernel guards — GC-1 holds on the read path). Duplicate writes report
 * created:false (the dedupe no-ops). The migration bookkeeping is present
 * in schema_migrations. The whole scenario is deterministic (two runs,
 * identical transcripts).
 *
 * Node-version note: requires Node.js >= 22.6 (node:sqlite + type
 * stripping); on 22.6-22.17 this harness re-executes itself with
 * --experimental-sqlite / --experimental-strip-types as needed; on
 * Node >= 22.18 no flags are required. (Same bootstrap as
 * scripts/test_protocol_kernel.mjs and scripts/test_protocol_evidence.mjs.)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const RUNTIME_DIR = join(ROOT, 'src', 'lib', 'protocol-runtime');
const MODULE_URL = (domain, name) => pathToFileURL(join(RUNTIME_DIR, domain, name)).href;

const RESPAWN_ENV = 'PAYSWAP_AUTHORITIES_TEST_RESPAWNED';
const tempDirs = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `payswap-rt5-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

/**
 * Capability bootstrap (mirrors scripts/test_protocol_evidence.mjs): probes
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
    await import(MODULE_URL('intent', 'types.ts'));
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
    console.error('node:sqlite / type stripping. The authorities suite requires Node.js >= 22.6.');
    process.exit(1);
  }
  process.exit(typeof child.status === 'number' ? child.status : 1);
}

await ensureCapabilities();

let intentModule;
let policyModule;
let capabilityModule;
let evidenceModule;
try {
  intentModule = await import(MODULE_URL('intent', 'intent.ts'));
  policyModule = await import(MODULE_URL('policy', 'policy.ts'));
  capabilityModule = await import(MODULE_URL('capability', 'capability.ts'));
  evidenceModule = await import(MODULE_URL('evidence', 'evidence.ts'));
} catch (error) {
  console.error(`Failed to load the RTN-005 domain modules: ${error}`);
  console.error('This suite requires Node.js >= 22.6 (node:sqlite + TypeScript type stripping).');
  process.exit(1);
}

const {
  IntentAuthority,
  demandDescriptor,
  writePaymentIntent,
  writeIntentState,
  writeIntentReceipt,
  readPaymentIntents,
  readIntentReceipts,
  openIntentStore,
} = intentModule;
const {
  PolicyAuthority,
  fulfillmentPolicyDefinition,
  writeFulfillmentPolicy,
  savePolicyState,
  writePolicyEvaluation,
  savePolicyEvaluationState,
  readFulfillmentPolicies,
  readPolicyEvaluations,
  openPolicyStore,
} = policyModule;
const {
  CapabilityAuthority,
  writeCapabilityRecord,
  saveCapabilityState,
  writeCommitmentRecord,
  saveCommitmentState,
  writeCapabilitySnapshot,
  readCapabilities,
  readCommitments,
  readCapabilitySnapshots,
  openCapabilityStore,
} = capabilityModule;
const { createEvidenceLog } = evidenceModule;

const WALL = 1_700_000_000_000;

const ALLOW_INTENT = (subjectId) => ({
  allowed: true,
  gateKind: 'intent.AUTHORIZATION',
  subjectId,
  checkId: 'check-intent-ok',
});
const ALLOW_CAPABILITY = (subjectId) => ({
  allowed: true,
  gateKind: 'capability.ACTIVATION',
  subjectId,
  checkId: 'check-capability-ok',
});

function deterministicClock(start) {
  let wall = start;
  return () => {
    wall += 1;
    return wall;
  };
}

/** Deep structural equality over the persisted-then-read-back records. */
function transcriptOf(records) {
  return JSON.stringify(
    records,
    (key, value) => (key === 'recordedAt' || key === 'createdAt' || key === 'stateChangedAt' || key === 'evaluatedAt' ? undefined : value),
    0,
  );
}

const checks = [];
function check(name, fn) {
  checks.push([name, fn]);
}

// ---------------------------------------------------------------------------
// Intent domain store
// ---------------------------------------------------------------------------

check('intent store: migrations applied, records round-trip, UNIQUE key collapses', async () => {
  const dir = tempDir('intent');
  const dbPath = join(dir, 'intent.sqlite');
  const store = openIntentStore({ dbPath });
  const log = createEvidenceLog({ wallMs: WALL });
  const authority = new IntentAuthority({
    evidence: log,
    gate: ALLOW_INTENT,
    wallClock: deterministicClock(WALL),
  });
  const descriptor = demandDescriptor({
    amount: { currency: 'EUR', scale: 2, amountMinor: 1_000 },
    source: { currency: 'EUR', geography: 'DE', account: 'acct-source' },
    destination: { currency: 'USD', geography: 'US', account: 'acct-destination' },
    constraints: {
      deadlineEpochMs: 60_000,
      allowedRails: ['rail-a'],
      costCeiling: { currency: 'USD', scale: 2, amountMinor: 500 },
    },
    idempotencyKey: 'idem-store-1',
  });
  const submission = await authority.submitIntent(descriptor);
  assert.equal(submission.ok, true);
  const intentId = submission.ok ? submission.intent.intentId : '';
  await authority.authorizeIntent(intentId, 'pid.v1.decision');
  await authority.routeIntent(intentId);
  const intents = authority.listIntents();
  assert.equal(intents.length, 1);
  const intent = intents[0];
  const receipt = authority.getReceipt('idem-store-1');

  // migration bookkeeping
  const applied = store.appliedMigrations().map((migration) => migration.name);
  assert.deepEqual(applied, ['0001_intent.sql']);

  // write-through: intent row + state changes + receipt
  const firstWrite = writePaymentIntent(store, intent);
  assert.equal(firstWrite.created, true);
  const duplicateWrite = writePaymentIntent(store, intent);
  assert.equal(duplicateWrite.created, false); // the storage-level INV-1-2 collapse
  assert.equal(duplicateWrite.reason, 'duplicate-no-op');
  assert.equal(writeIntentState(store, intent), 1);
  assert.equal(writeIntentReceipt(store, receipt).created, true);
  assert.equal(writeIntentReceipt(store, receipt).created, false); // INV-1-3: one receipt per key

  // read-back: the records reconstruct exactly (Money re-minted via money())
  const readIntents = readPaymentIntents(store);
  assert.equal(readIntents.length, 1);
  const readIntent = readIntents[0];
  assert.equal(readIntent.intentId, intent.intentId);
  assert.equal(readIntent.state, 'ROUTED');
  assert.equal(readIntent.descriptor.amount.amountMinor, 1_000);
  assert.equal(readIntent.descriptor.amount.currency, 'EUR');
  assert.deepEqual([...readIntent.descriptor.constraints.allowedRails], ['rail-a']);
  assert.equal(readIntent.descriptorHash, intent.descriptorHash);
  assert.equal(readIntent.policyDecisionId, 'pid.v1.decision');
  const readReceipts = readIntentReceipts(store);
  assert.equal(readReceipts.length, 1);
  assert.equal(readReceipts[0].intentId, intent.intentId);
  assert.equal(readReceipts[0].outcome, 'DRAFT');
  // JSON round-trip transcript equality (excluding timestamps)
  assert.equal(
    transcriptOf(readIntents.map((record) => ({ ...record, createdAt: 0, stateChangedAt: 0 }))),
    transcriptOf(intents.map((record) => ({ ...record, createdAt: 0, stateChangedAt: 0 }))),
  );
  store.close();
});

// ---------------------------------------------------------------------------
// Policy domain store
// ---------------------------------------------------------------------------

check('policy store: versioned rows, attachment, evaluations round-trip, INV-2-3 UNIQUE', async () => {
  const dir = tempDir('policy');
  const dbPath = join(dir, 'policy.sqlite');
  const store = openPolicyStore({ dbPath });
  const log = createEvidenceLog({ wallMs: WALL });
  const authority = new PolicyAuthority({ evidence: log, wallClock: deterministicClock(WALL) });
  const definition = fulfillmentPolicyDefinition({
    allowedRails: ['rail-a'],
    ordering: 'COST_ASC',
    costCeiling: { currency: 'USD', scale: 2, amountMinor: 300 },
    deadlineEpochMs: 50_000,
    fallbackPreference: [],
  });
  await authority.authorPolicy('policy-store', definition);
  const published = await authority.publishPolicyVersion('policy-store');
  assert.equal(published.ok, true);
  const version = published.ok ? published.record.version : 0;
  await authority.attachPolicy({
    policyId: 'policy-store',
    version,
    intentId: 'pid.v1.intent-store',
    snapshotId: 'pid.v1.snapshot-store',
  });
  const snapshot = Object.freeze({
    snapshotId: 'pid.v1.snapshot-store',
    sequence: 0,
    wallMs: WALL,
    capabilities: Object.freeze([
      Object.freeze({
        capabilityId: 'cap-store',
        railId: 'rail-a',
        corridor: Object.freeze({
          sourceCurrency: 'EUR',
          destinationCurrency: 'USD',
          sourceGeography: 'DE',
          destinationGeography: 'US',
        }),
        state: 'ACTIVE',
        declaredCapacity: { currency: 'EUR', scale: 2, amountMinor: 5_000 },
        reservedTotal: { currency: 'EUR', scale: 2, amountMinor: 0 },
        consumedTotal: { currency: 'EUR', scale: 2, amountMinor: 0 },
        availableCapacity: { currency: 'EUR', scale: 2, amountMinor: 5_000 },
        costSchedule: { currency: 'USD', scale: 2, amountMinor: 50 },
        tier: 'standard',
      }),
    ]),
  });
  const evaluation = await authority.evaluatePolicy({
    policyId: 'policy-store',
    version,
    intentId: 'pid.v1.intent-store',
    intentTerms: {
      amount: { currency: 'EUR', scale: 2, amountMinor: 1_000 },
      sourceCurrency: 'EUR',
      destinationCurrency: 'USD',
      sourceGeography: 'DE',
      destinationGeography: 'US',
      deadlineEpochMs: 60_000,
      allowedRails: ['rail-a'],
      costCeiling: { currency: 'USD', scale: 2, amountMinor: 500 },
    },
    snapshot,
  });
  assert.equal(evaluation.ok, true);
  const evaluationRecord = evaluation.ok ? evaluation.record : undefined;
  await authority.consumeEvaluation(evaluationRecord.evaluationId);

  const applied = store.appliedMigrations().map((migration) => migration.name);
  assert.deepEqual(applied, ['0001_policy.sql']);

  const attachedPolicy = authority.getPolicy(`policy-store@v${version}`);
  const firstWrite = writeFulfillmentPolicy(store, attachedPolicy);
  assert.equal(firstWrite.created, true);
  assert.equal(writeFulfillmentPolicy(store, attachedPolicy).created, false); // versions are immutable rows
  assert.equal(savePolicyState(store, attachedPolicy), 1);
  const evaluationWrite = writePolicyEvaluation(store, authority.listEvaluations()[0]);
  assert.equal(evaluationWrite.created, true);
  assert.equal(writePolicyEvaluation(store, authority.listEvaluations()[0]).created, false); // INV-2-3 UNIQUE
  assert.equal(savePolicyEvaluationState(store, authority.listEvaluations()[0]), 1);

  const readPolicies = readFulfillmentPolicies(store);
  assert.equal(readPolicies.length, 1);
  const readPolicy = readPolicies[0];
  assert.equal(readPolicy.state, 'ATTACHED');
  assert.equal(readPolicy.version, version);
  assert.equal(readPolicy.attachedIntentId, 'pid.v1.intent-store');
  assert.equal(readPolicy.definition.costCeiling.amountMinor, 300);
  assert.deepEqual([...readPolicy.definition.allowedRails], ['rail-a']);
  assert.equal(readPolicy.definition.ordering, 'COST_ASC');
  const readEvaluations = readPolicyEvaluations(store);
  assert.equal(readEvaluations.length, 1);
  const readEvaluation = readEvaluations[0];
  assert.equal(readEvaluation.state, 'CONSUMED');
  assert.equal(readEvaluation.snapshotId, 'pid.v1.snapshot-store');
  assert.equal(readEvaluation.outcome.satisfiable, true);
  assert.equal(readEvaluation.outcome.result.rankedRouteRequirements.length, 1);
  assert.equal(readEvaluation.outcome.result.rankedRouteRequirements[0].capabilityId, 'cap-store');
  assert.equal(readEvaluation.outcome.result.costCeiling.amountMinor, 300);
  assert.equal(readEvaluation.resultHash, evaluationRecord.resultHash);
  store.close();
});

// ---------------------------------------------------------------------------
// Capability domain store
// ---------------------------------------------------------------------------

check('capability store: capabilities, commitments, snapshots round-trip; INV-3-3 UNIQUE', async () => {
  const dir = tempDir('capability');
  const dbPath = join(dir, 'capability.sqlite');
  const store = openCapabilityStore({ dbPath });
  const log = createEvidenceLog({ wallMs: WALL });
  const authority = new CapabilityAuthority({
    evidence: log,
    gate: ALLOW_CAPABILITY,
    wallClock: deterministicClock(WALL),
  });
  await authority.registerCapability({
    capabilityId: 'cap-store',
    declaration: {
      railId: 'rail-a',
      corridor: {
        sourceCurrency: 'EUR',
        destinationCurrency: 'USD',
        sourceGeography: 'DE',
        destinationGeography: 'US',
      },
      costSchedule: { currency: 'USD', scale: 2, amountMinor: 50 },
      tier: 'standard',
    },
    declaredCapacity: { currency: 'EUR', scale: 2, amountMinor: 5_000 },
  });
  await authority.activateCapability('cap-store');
  const snapshot = authority.snapshot();
  await authority.offerCommitment({
    intentId: 'pid.v1.intent-store',
    capabilityId: 'cap-store',
    amount: { currency: 'EUR', scale: 2, amountMinor: 1_000 },
    deadlineEpochMs: 60_000,
  });
  const commitmentId = authority.listCommitments()[0].commitmentId;
  await authority.reserveCommitment(commitmentId);
  await authority.consumeCommitment(commitmentId);

  const applied = store.appliedMigrations().map((migration) => migration.name);
  assert.deepEqual(applied, ['0001_capability.sql']);

  const capability = authority.getCapability('cap-store');
  const firstWrite = writeCapabilityRecord(store, capability);
  assert.equal(firstWrite.created, true);
  assert.equal(writeCapabilityRecord(store, capability).created, false);
  assert.equal(saveCapabilityState(store, capability), 1);
  const commitment = authority.getCommitment(commitmentId);
  const commitmentWrite = writeCommitmentRecord(store, commitment);
  assert.equal(commitmentWrite.created, true);
  assert.equal(writeCommitmentRecord(store, commitment).created, false); // INV-3-3 UNIQUE (intent, capability)
  assert.equal(saveCommitmentState(store, commitment), 1);
  assert.equal(writeCapabilitySnapshot(store, snapshot).created, true);
  assert.equal(writeCapabilitySnapshot(store, snapshot).created, false); // snapshots are immutable, one row per sequence

  const readCapabilityRecords = readCapabilities(store);
  assert.equal(readCapabilityRecords.length, 1);
  const readCapability = readCapabilityRecords[0];
  assert.equal(readCapability.state, 'ACTIVE');
  assert.equal(readCapability.declaration.railId, 'rail-a');
  assert.equal(readCapability.declaration.costSchedule.amountMinor, 50);
  assert.equal(readCapability.declaredCapacity.amountMinor, 5_000);
  assert.equal(readCapability.reservedTotal.amountMinor, 0);
  assert.equal(readCapability.consumedTotal.amountMinor, 1_000);
  const readCommitmentRecords = readCommitments(store);
  assert.equal(readCommitmentRecords.length, 1);
  const readCommitment = readCommitmentRecords[0];
  assert.equal(readCommitment.commitmentId, commitmentId);
  assert.equal(readCommitment.state, 'CONSUMED');
  assert.equal(readCommitment.amount.amountMinor, 1_000);
  assert.equal(readCommitment.deadlineEpochMs, 60_000);
  const readSnapshots = readCapabilitySnapshots(store);
  assert.equal(readSnapshots.length, 1);
  const readSnapshot = readSnapshots[0];
  assert.equal(readSnapshot.snapshotId, snapshot.snapshotId);
  assert.equal(readSnapshot.capabilities.length, 1);
  assert.equal(readSnapshot.capabilities[0].capabilityId, 'cap-store');
  assert.equal(readSnapshot.capabilities[0].availableCapacity.amountMinor, 5_000);
  assert.equal(Object.isFrozen(readSnapshot), true);
  assert.equal(Object.isFrozen(readSnapshot.capabilities), true);
  store.close();
});

// ---------------------------------------------------------------------------
// Determinism: the whole scenario runs identically twice
// ---------------------------------------------------------------------------

check('the durable scenario is deterministic (two runs, identical persisted transcripts)', async () => {
  const transcripts = [];
  for (let run = 0; run < 2; run += 1) {
    const dir = tempDir(`determinism-${run}`);
    const intentStore = openIntentStore({ dbPath: join(dir, 'intent.sqlite') });
    const policyStore = openPolicyStore({ dbPath: join(dir, 'policy.sqlite') });
    const capabilityStore = openCapabilityStore({ dbPath: join(dir, 'capability.sqlite') });
    const log = createEvidenceLog({ wallMs: WALL });
    const intentAuthority = new IntentAuthority({
      evidence: log,
      gate: ALLOW_INTENT,
      wallClock: deterministicClock(WALL),
    });
    const descriptor = demandDescriptor({
      amount: { currency: 'EUR', scale: 2, amountMinor: 900 },
      source: { currency: 'EUR', geography: 'DE', account: 'acct-source' },
      destination: { currency: 'USD', geography: 'US', account: 'acct-destination' },
      constraints: {
        deadlineEpochMs: 60_000,
        allowedRails: ['rail-a'],
        costCeiling: { currency: 'USD', scale: 2, amountMinor: 500 },
      },
      idempotencyKey: `idem-determinism-${run}`,
    });
    const submission = await intentAuthority.submitIntent(descriptor);
    const intent = submission.ok ? submission.intent : undefined;
    writePaymentIntent(intentStore, intent);
    writeIntentReceipt(intentStore, intentAuthority.getReceipt(`idem-determinism-${run}`));
    transcripts.push(transcriptOf(readPaymentIntents(intentStore)));
    transcripts.push(transcriptOf(readIntentReceipts(intentStore)));
    transcripts.push(String(log.height));
    intentStore.close();
    policyStore.close();
    capabilityStore.close();
  }
  // the two runs' transcripts differ only in the idempotency key (and the
  // identities derived from it: intent id, descriptor hash); the structural
  // transcript (states, amounts, log height) is identical
  const stripDerivedIdentity = (text) =>
    text
      .replace(/"descriptorHash":"ddh\.v1\.[0-9a-f]+"/g, '"descriptorHash":"<HASH>"')
      .replace(/"intentId":"pid\.v1\.[0-9a-f]+"/g, '"intentId":"<PID>"');
  const first = stripDerivedIdentity(transcripts[0].replaceAll('idem-determinism-0', 'X'));
  const second = stripDerivedIdentity(transcripts[3].replaceAll('idem-determinism-1', 'X'));
  assert.equal(first, second);
  assert.equal(transcripts[2], transcripts[5]);
});

let failures = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`(pass) ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`(fail) ${name}`);
    console.error(error);
  }
}

for (const dir of tempDirs) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup on shared runners
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log(`\nRTN-005 authorities harness: all ${checks.length} checks green.`);
