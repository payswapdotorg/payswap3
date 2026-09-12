#!/usr/bin/env node
/**
 * payswap3 · RTN-008 — Clearing / Obligations authorities evidence
 * harness (areas 9-10, per-domain persistence + the real rails
 * composition).
 *
 * Plain-Node evidence suite for the SQLite-backed surfaces of the two
 * RTN-008 domains (the same split the RTN-001 kernel, the RTN-002
 * evidence domain, and the RTN-005/006/007 domains use): `bun test`
 * covers the pure modules and the in-process authorities (including the
 * real-log evidence coupling and the composed clearing -> obligations
 * journey); THIS harness exercises each domain's per-domain store —
 * open<Domain>Store over the DEP-003 database layer (node:sqlite), the
 * owned migrations, and the write-through bridges — because Bun does not
 * implement node:sqlite. It also runs the REAL rails case-model
 * composition (RTN-004 RailsStore + ReconciliationAuthority +
 * SimulatedRail) that the bun suites cannot host for the same reason.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §1 Area 9
 *     lines 29-40 (ClearingBatch, ClearingRecord — the persisted
 *     shapes), lines 47-56 (INV-9-1/INV-9-2/INV-9-3 — the storage-level
 *     constraints: the exact state machines as CHECKs, the quarantine
 *     reason codes, the recorded commit result), lines 58-64 (the
 *     upstream-UNKNOWN clearability gate);
 *   §2 Area 10 lines 91-106 (Obligation, ObligationLedger — the
 *     persisted entry shapes), lines 113-123 (INV-10-1/INV-10-2/
 *     INV-10-3/INV-10-4 — the append-only entry table with the gapless
 *     total sequence as PRIMARY KEY, the closed instruction-kind CHECK,
 *     no UPDATE anywhere), lines 125-131 (the UNKNOWN-settlement hold);
 *   spec/architecture/v0.1/rails-adapters-reconciliation.md §2 Area 14
 *     lines 119-131 (the case model), lines 173-179 (the recovery
 *     paths);
 *   spec/protocol-runtime-work-orders/README.md "Persistence convention"
 *   (per-domain schema + owned migrations, DEP-003 read-only).
 *
 * Scenarios:
 *   1. The clearing domain store: run the in-process authority over the
 *      REAL in-process A15 log, persist every committed artifact through
 *      the domain bridge (writeBatch/writeRecords), read everything
 *      back, and assert the round trip reconstructs the records exactly
 *      (Money re-minted through the kernel guards — GC-1 holds on the
 *      read path).
 *   2. The obligations domain store: run the authority, persist every
 *      ledger entry (writeEntry — INSERT only), read back, re-fold the
 *      entries into a fresh ObligationLedger, and assert the projection
 *      is identical (the fold is a pure function of the log — GC-1).
 *   3. The REAL rails composition: a settlement attempt lands UNKNOWN
 *      (TRANSMIT_TIMEOUT), the A09 clearability gate quarantines the
 *      activity's new record, the A10 hold refuses finality
 *      (UNKNOWN_HELD), the Reconciliation Authority resolves the case
 *      (the only exit from UNKNOWN — GC-2), and finality then advances
 *      the obligation to SETTLED exactly once.
 *   4. Determinism: the whole run is executed twice; the persisted
 *      transcripts are identical (GC-1).
 *
 * Node-version note: requires Node.js >= 22.6 (node:sqlite + type
 * stripping); on 22.6-22.17 this harness re-executes itself with
 * --experimental-sqlite / --experimental-strip-types as needed; on
 * Node >= 22.18 no flags are required. (Same bootstrap as
 * scripts/test_protocol_kernel.mjs and
 * scripts/test_protocol_liquidity_credit_queues.mjs.)
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

const RESPAWN_ENV = 'PAYSWAP_RT8_TEST_RESPAWNED';
const tempDirs = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `payswap-rt8-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

/**
 * Bootstrap (mirrors scripts/test_protocol_liquidity_credit_queues.mjs):
 * probes node:sqlite importability and .ts module loadability,
 * re-executing this script with the required experimental flags on Node
 * builds that need them.
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
    await import(MODULE_URL('clearing', 'types.ts'));
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
    console.error('node:sqlite / type stripping. The clearing/obligations suite requires Node.js >= 22.6.');
    process.exit(1);
  }
  process.exit(typeof child.status === 'number' ? child.status : 1);
}

await ensureCapabilities();

let clearingModule;
let obligationsModule;
let railsModule;
let railsEvidenceDoubleModule;
let evidenceModule;
try {
  clearingModule = await import(MODULE_URL('clearing', 'clearing.ts'));
  obligationsModule = await import(MODULE_URL('obligations', 'obligations.ts'));
  railsModule = await import(MODULE_URL('rails', 'index.ts'));
  railsEvidenceDoubleModule = await import(MODULE_URL('rails', 'evidence-test-double.ts'));
  evidenceModule = await import(MODULE_URL('evidence', 'evidence.ts'));
} catch (error) {
  console.error(`Failed to load the RTN-008 domain modules: ${error}`);
  console.error('This suite requires Node.js >= 22.6 (node:sqlite + TypeScript type stripping).');
  process.exit(1);
}

const {
  ClearingAuthority,
  openClearingStore,
  writeBatch,
  writeRecords,
  readBatches,
  readRecords,
} = clearingModule;
const {
  ObligationLedgerAuthority,
  ObligationLedger,
  openObligationsStore,
  writeEntry,
  readEntries,
} = obligationsModule;
const { createRailsAuthorities, RailsStore, SimulatedRail, createSimulatedRailAdapter, openRailsStore } =
  railsModule;
const { createEvidenceTestDouble } = railsEvidenceDoubleModule;
const { createEvidenceLog } = evidenceModule;

const WALL = 1_700_000_000_000;

function deterministicClock(start) {
  let wall = start;
  return () => {
    wall += 1;
    return wall;
  };
}

const EUR = (minor) => ({ currency: 'EUR', scale: 2, amountMinor: minor });

// ---------------------------------------------------------------------------
// Scenario 1 — the clearing domain store (area 9 x per-domain persistence)
// ---------------------------------------------------------------------------

function runClearingScenario() {
  const dir = tempDir('clearing');
  const log = createEvidenceLog({ wallMs: WALL });
  const clock = deterministicClock(WALL);
  const obligations = new ObligationLedgerAuthority({ evidence: log, wallClock: clock });
  const authority = new ClearingAuthority({
    evidence: log,
    sink: obligations,
    wallClock: clock,
  });
  const store = openClearingStore({ dbPath: join(dir, 'clearing.sqlite') });
  const transcript = [];

  return {
    dir,
    store,
    transcript,
    async run() {
      // (1) Open a batch; add records; stage; commit; finalize.
      const opened = await authority.openBatch({ batchLabel: 'cycle-2025-06-07' });
      assert.equal(opened.ok, true);
      const batchId = opened.value.batchId;
      writeBatch(store, authority.batch(batchId), 'cycle-2025-06-07');
      transcript.push(`open:${batchId}:${opened.value.sequence}:${opened.value.state}`);

      const goodRecord = {
        origin: { originActivityId: 'activity-1', originKind: 'INTENT' },
        parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
        amount: EUR(1_500),
        reason: 'hop settlement',
      };
      const added = await authority.addRecord(batchId, goodRecord);
      assert.equal(added.ok, true);
      const duplicate = await authority.addRecord(batchId, {
        ...goodRecord,
        amount: EUR(1_500),
      });
      assert.equal(duplicate.ok, true);
      writeRecords(store, batchId, authority.batchRecords(batchId));
      transcript.push(`records:${authority.batchRecords(batchId).length}`);

      const staged = await authority.stageBatch(batchId);
      assert.equal(staged.ok, true);
      writeBatch(store, authority.batch(batchId), 'cycle-2025-06-07');
      writeRecords(store, batchId, authority.batchRecords(batchId));
      transcript.push(`stage:${staged.value.state}:${staged.value.recordCount}:${staged.value.perCurrencyTotals}`);

      const committed = await authority.commitBatch(batchId);
      assert.equal(committed.ok, true);
      assert.equal(committed.value.commit.obligationIds.length, 1); // the duplicate no-ops
      assert.deepEqual(committed.value.commit.duplicateOriginActivityIds, ['activity-1']);
      writeBatch(store, authority.batch(batchId), 'cycle-2025-06-07');
      transcript.push(`commit:${committed.value.commit.obligationIds.length}:${committed.value.commit.idempotencyKey}`);

      // INV-9-3: re-commit is a no-op returning the recorded result.
      const replay = await authority.commitBatch(batchId);
      assert.equal(replay.ok, true);
      assert.equal(replay.value.replayed, true);
      assert.equal(replay.value.commit.idempotencyKey, committed.value.commit.idempotencyKey);
      transcript.push(`recommit:${replay.value.replayed}`);

      const finalized = await authority.finalizeBatch(batchId);
      assert.equal(finalized.ok, true);
      writeBatch(store, authority.batch(batchId), 'cycle-2025-06-07');
      transcript.push(`final:${finalized.value.state}`);

      // (2) A quarantined batch: the zero-amount record quarantines and
      // blocks the commit; the record is never dropped.
      const second = await authority.openBatch({ batchLabel: 'quarantine-cycle' });
      const quarantinedBatchId = second.ok ? second.value.batchId : '';
      await authority.addRecord(quarantinedBatchId, {
        origin: { originActivityId: 'activity-bad', originKind: 'ROUTE_PLAN_HOP' },
        parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
        amount: EUR(0),
        reason: 'hop settlement',
      });
      const quarantineStaged = await authority.stageBatch(quarantinedBatchId);
      assert.equal(quarantineStaged.ok, true);
      const quarantinedRecords = authority.quarantinedRecords(quarantinedBatchId);
      assert.equal(quarantinedRecords.length, 1);
      assert.equal(quarantinedRecords[0].quarantineReason, 'ZERO_AMOUNT');
      const refused = await authority.commitBatch(quarantinedBatchId);
      assert.equal(refused.ok, false);
      assert.equal(refused.code, 'RECORDS_QUARANTINED');
      writeBatch(store, authority.batch(quarantinedBatchId), 'quarantine-cycle');
      writeRecords(store, quarantinedBatchId, authority.batchRecords(quarantinedBatchId));
      transcript.push(`quarantine:${quarantinedRecords.length}:${refused.code}`);

      // (3) The round trip: read back and compare exactly.
      const batches = readBatches(store);
      assert.equal(batches.length, 2);
      const roundTripBatch = batches.find((batch) => batch.batchId === batchId);
      assert.ok(roundTripBatch !== undefined);
      assert.equal(roundTripBatch.state, 'FINAL');
      assert.equal(roundTripBatch.recordCount, 2);
      assert.equal(roundTripBatch.perCurrencyTotals, authority.batch(batchId).perCurrencyTotals);
      assert.equal(roundTripBatch.contentsHash, authority.batch(batchId).contentsHash);
      assert.equal(roundTripBatch.commit.idempotencyKey, committed.value.commit.idempotencyKey);
      assert.deepEqual(roundTripBatch.commit.obligationIds, committed.value.commit.obligationIds);
      const roundTripRecords = readRecords(store, batchId);
      assert.equal(roundTripRecords.length, 2);
      assert.deepEqual(roundTripRecords, [...authority.batchRecords(batchId)]);
      const roundTripQuarantined = readRecords(store, quarantinedBatchId);
      assert.equal(roundTripQuarantined[0].state, 'QUARANTINED');
      assert.equal(roundTripQuarantined[0].quarantineReason, 'ZERO_AMOUNT');
      assert.equal(
        roundTripQuarantined[0].amount.amountMinor,
        authority.batchRecords(quarantinedBatchId)[0].amount.amountMinor,
      );
      transcript.push(`roundtrip:exact`);

      // (4) The migration set is recorded and idempotent (re-open).
      const reopened = openClearingStore({ dbPath: join(dir, 'clearing.sqlite') });
      assert.equal(readBatches(reopened).length, 2);
      reopened.close();
      transcript.push(`reopen:idempotent`);
    },
  };
}

// ---------------------------------------------------------------------------
// Scenario 2 — the obligations domain store (area 10 x append-only log)
// ---------------------------------------------------------------------------

function runObligationsScenario() {
  const dir = tempDir('obligations');
  const log = createEvidenceLog({ wallMs: WALL });
  const clock = deterministicClock(WALL);
  const authority = new ObligationLedgerAuthority({ evidence: log, wallClock: clock });
  const store = openObligationsStore({ dbPath: join(dir, 'obligations.sqlite') });
  const transcript = [];

  return {
    dir,
    store,
    transcript,
    async run() {
      // (1) Create two obligations via the clearing path.
      const first = await authority.applyClearingCommand({
        batchId: 'pid.v1.batch-1',
        recordId: 'pid.v1.record-1',
        originActivityId: 'activity-1',
        originKind: 'INTENT',
        debtorParticipantId: 'participant-a',
        creditorParticipantId: 'participant-b',
        amount: EUR(1_000),
        reason: 'hop settlement',
      });
      assert.equal(first.duplicate, false);
      const second = await authority.applyClearingCommand({
        batchId: 'pid.v1.batch-1',
        recordId: 'pid.v1.record-2',
        originActivityId: 'activity-2',
        originKind: 'ROUTE_PLAN_HOP',
        debtorParticipantId: 'participant-b',
        creditorParticipantId: 'participant-c',
        amount: EUR(2_000),
        reason: 'hop settlement',
      });
      assert.equal(second.duplicate, false);
      // INV-10-3: the duplicate no-ops.
      const duplicate = await authority.applyClearingCommand({
        batchId: 'pid.v1.batch-1',
        recordId: 'pid.v1.record-1',
        originActivityId: 'activity-1',
        originKind: 'INTENT',
        debtorParticipantId: 'participant-a',
        creditorParticipantId: 'participant-b',
        amount: EUR(1_000),
        reason: 'hop settlement',
      });
      assert.equal(duplicate.duplicate, true);
      transcript.push(`created:${authority.obligations().length}:${duplicate.duplicate}`);

      // (2) The lifecycle: net one, settle both.
      await authority.applyNettingCommit({
        kind: 'NETTING_COMMIT',
        obligationId: first.obligationId,
        nettingSetId: 'netting-set-1',
        replacementObligationIds: ['pid.v1.net-obligation-1'],
      });
      await authority.applySettlementInstruction({
        kind: 'SETTLEMENT_INSTRUCTION',
        obligationId: first.obligationId,
        settlementInstructionId: 'instruction-1',
      });
      await authority.applySettlementFinality({
        kind: 'SETTLEMENT_FINALITY',
        obligationId: first.obligationId,
        finalityRecordId: 'finality-1',
      });
      await authority.applyRiskWriteOff({
        kind: 'RISK_WRITE_OFF',
        obligationId: second.obligationId,
        riskAuthorityReference: 'risk-disposition-1',
      });
      transcript.push(
        `lifecycle:${authority.obligation(first.obligationId).state}:${authority.obligation(second.obligationId).state}`,
      );

      // (3) Persist every entry (INSERT only) and read back.
      for (const entry of authority.log.entriesSnapshot()) {
        writeEntry(store, entry);
      }
      const entries = readEntries(store);
      assert.equal(entries.length, authority.log.height);
      assert.deepEqual(entries, [...authority.log.entriesSnapshot()]);
      transcript.push(`entries:${entries.length}`);

      // (4) Re-fold the persisted entries into a FRESH ledger: the
      // projection is a pure function of the log (GC-1).
      const replayLedger = new ObligationLedger();
      for (const entry of entries) {
        replayLedger.appendEntry(entry);
      }
      assert.deepEqual([...replayLedger.fold()], [...authority.obligations()]);
      assert.equal(replayLedger.sequenceInvariant(), true);
      assert.equal(replayLedger.inv10_4Audit().holds, true);
      transcript.push(`refold:identical:${replayLedger.inv10_4Audit().holds}`);

      // (5) The mutation backstop: the store has no UPDATE path — the
      // write bridge is INSERT-only; a duplicate sequence insert fails
      // (the PRIMARY KEY makes the total order structural).
      let rejected = false;
      try {
        writeEntry(store, entries[0]);
      } catch {
        rejected = true;
      }
      assert.equal(rejected, true);
      transcript.push(`appendonly:${rejected}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Scenario 3 — the REAL rails composition (A09 gate + A10 hold + GC-2)
// ---------------------------------------------------------------------------

function runRailsCompositionScenario() {
  const dir = tempDir('rails-composition');
  const log = createEvidenceLog({ wallMs: WALL });
  const clock = deterministicClock(WALL);
  const store = new RailsStore(openRailsStore({ dbPath: join(dir, 'rails.sqlite') }));
  // The rails authorities submit through the RTN-004 in-surface evidence
  // test double (the rails surface's own convention — its authority names
  // are not registry-validated until the RTN-012 composed-log
  // integration); the RTN-008 authorities (Clearing, Obligation) submit
  // to the REAL A15 log.
  const rails = createRailsAuthorities(store, {
    evidence: createEvidenceTestDouble(),
    wallClock: clock,
  });
  const adapter = rails.railAuthority.registerAdapter({ railFamily: 'sim', name: 'simulated-bank' });
  assert.equal(adapter.ok, true);
  const activated = rails.railAuthority.activateAdapter(
    adapter.ok ? adapter.value.adapterId : '',
  );
  assert.equal(activated.ok, true);
  const adapterId = adapter.ok ? adapter.value.adapterId : '';

  const obligations = new ObligationLedgerAuthority({
    evidence: log,
    settlementHold: () =>
      store.listOperations().some((operation) => operation.status === 'UNKNOWN'),
    wallClock: clock,
  });
  const authority = new ClearingAuthority({
    evidence: log,
    sink: obligations,
    clearability: (activityId) =>
      activityId === 'activity-1'
        ? store
            .listOperations()
            .filter((operation) => operation.status === 'UNKNOWN')
            .map((operation) => operation.operationId)
        : [],
    wallClock: clock,
  });
  const transcript = [];

  return {
    dir,
    store,
    transcript,
    async run() {
      // (1) Clear the activity into an obligation.
      const opened = await authority.openBatch({ batchLabel: 'settlement-cycle' });
      const batchId = opened.ok ? opened.value.batchId : '';
      await authority.addRecord(batchId, {
        origin: { originActivityId: 'activity-1', originKind: 'INTENT' },
        parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
        amount: EUR(1_000),
        reason: 'hop settlement',
      });
      await authority.stageBatch(batchId);
      const committed = await authority.commitBatch(batchId);
      assert.equal(committed.ok, true);
      const obligationId = committed.ok ? committed.value.commit.obligationIds[0] : '';
      await authority.finalizeBatch(batchId);
      await obligations.applySettlementInstruction({
        kind: 'SETTLEMENT_INSTRUCTION',
        obligationId,
        settlementInstructionId: 'settlement-instruction-1',
      });
      assert.equal(obligations.obligation(obligationId).state, 'SETTLEMENT_PENDING');
      transcript.push(`created:${obligationId.startsWith('pid.v1.')}`);

      // (2) Submit the settlement rail operation; it lands UNKNOWN
      // (TRANSMIT_TIMEOUT) and a case auto-opens (INV-14-1).
      const rail = new SimulatedRail('bank-1', {});
      const connection = createSimulatedRailAdapter(rail, { wallClock: clock });
      const authorized = rails.railAuthority.authorizeOperation({
        instructionId: 'settlement-instruction-1',
        adapterId,
        payload: {
          instructionId: 'settlement-instruction-1',
          money: EUR(1_000),
          beneficiary: 'bank-account-b',
        },
      });
      assert.equal(authorized.ok, true);
      const operationId = authorized.ok ? authorized.value.operationId : '';
      const idempotencyKey = authorized.ok ? authorized.value.idempotencyKey : '';
      rail.script[idempotencyKey] = 'TRANSMIT_TIMEOUT';
      const submitted = rails.railAuthority.submitRailOperation(operationId, connection);
      assert.equal(submitted.ok, true);
      if (submitted.ok) {
        assert.equal(submitted.value.operation.status, 'UNKNOWN');
      }
      assert.equal(store.countOpenCases(), 1);
      transcript.push(`unknown:${submitted.ok ? submitted.value.operation.status : 'FAILED'}`);

      // (3) THE A10 HOLD: finality refused (UNKNOWN_HELD); the
      // obligation remains SETTLEMENT_PENDING unchanged.
      const refused = await obligations.applySettlementFinality({
        kind: 'SETTLEMENT_FINALITY',
        obligationId,
        finalityRecordId: 'finality-1',
      });
      assert.equal(refused.ok, false);
      assert.equal(refused.code, 'UNKNOWN_HELD');
      assert.equal(obligations.obligation(obligationId).state, 'SETTLEMENT_PENDING');
      transcript.push(`held:${refused.code}`);

      // (4) THE A09 GATE: the activity with the upstream UNKNOWN is not
      // clearable — the new record quarantines.
      const second = await authority.openBatch({ batchLabel: 'clearability-check' });
      const secondId = second.ok ? second.value.batchId : '';
      await authority.addRecord(secondId, {
        origin: { originActivityId: 'activity-1', originKind: 'INTENT' },
        parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
        amount: EUR(1_000),
        reason: 'hop settlement',
      });
      await authority.stageBatch(secondId);
      const quarantined = authority.quarantinedRecords(secondId);
      assert.equal(quarantined.length, 1);
      assert.equal(quarantined[0].quarantineReason, 'UPSTREAM_UNRESOLVED_UNKNOWN');
      transcript.push(`gate:${quarantined[0].quarantineReason}`);

      // (5) THE ONLY EXIT FROM UNKNOWN (GC-2): the Reconciliation
      // Authority resolves the case.
      const caseRecord = store
        .listCases()
        .find((candidate) => candidate.status === 'OPEN' || candidate.status === 'INVESTIGATING');
      assert.ok(caseRecord !== undefined);
      if (caseRecord.status === 'OPEN') {
        const investigated = rails.reconciliation.investigateCase(caseRecord.caseId);
        assert.equal(investigated.ok, true);
      }
      const resolved = rails.reconciliation.resolveCase(caseRecord.caseId, {
        resolution: 'RESOLVED_CONFIRMED',
        proof: { externalRefs: ['bank-statement-1'] },
      });
      assert.equal(resolved.ok, true);
      if (resolved.ok) {
        assert.equal(resolved.value.operation.status, 'CONFIRMED');
      }
      transcript.push(`resolved:${resolved.ok ? 'CONFIRMED' : 'FAILED'}`);

      // (6) After the resolution: finality advances EXACTLY ONCE; the
      // activity becomes clearable again.
      const advanced = await obligations.applySettlementFinality({
        kind: 'SETTLEMENT_FINALITY',
        obligationId,
        finalityRecordId: 'finality-1',
      });
      assert.equal(advanced.ok, true);
      assert.equal(advanced.ok ? advanced.value.state : '', 'SETTLED');
      const secondAdvance = await obligations.applySettlementFinality({
        kind: 'SETTLEMENT_FINALITY',
        obligationId,
        finalityRecordId: 'finality-2',
      });
      assert.equal(secondAdvance.ok, false);
      const third = await authority.openBatch({ batchLabel: 'clearable-after' });
      const thirdId = third.ok ? third.value.batchId : '';
      await authority.addRecord(thirdId, {
        origin: { originActivityId: 'activity-1', originKind: 'INTENT' },
        parties: { debtorParticipantId: 'participant-a', creditorParticipantId: 'participant-b' },
        amount: EUR(1_000),
        reason: 'hop settlement',
      });
      const thirdStaged = await authority.stageBatch(thirdId);
      assert.equal(thirdStaged.ok, true);
      assert.equal(authority.quarantinedRecords(thirdId).length, 0);
      transcript.push(`finality:${advanced.ok ? advanced.value.state : ''}:clearable:yes`);

      // (7) The composed log verifies end to end (both authorities +
      // rails + evidence).
      const verification = log.verifyAndRecord(clock());
      assert.equal(verification.verdict, 'VERIFIED');
      transcript.push(`chain:${verification.verdict}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Run everything (twice — determinism)
// ---------------------------------------------------------------------------

function cleanup() {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function executeRun() {
  const clearing = runClearingScenario();
  const obligations = runObligationsScenario();
  const composition = runRailsCompositionScenario();
  await clearing.run();
  clearing.store.close();
  await obligations.run();
  obligations.store.close();
  await composition.run();
  composition.store.close();
  return {
    clearing: [...clearing.transcript],
    obligations: [...obligations.transcript],
    composition: [...composition.transcript],
  };
}

process.on('exit', cleanup);

try {
  const firstRun = await executeRun();
  const secondRun = await executeRun();
  assert.deepEqual(secondRun, firstRun);
  console.log('RTN-008 clearing/obligations harness: all checks green.');
  console.log(`  clearing transcript:     ${firstRun.clearing.length} steps`);
  console.log(`  obligations transcript:  ${firstRun.obligations.length} steps`);
  console.log(`  rails composition:       ${firstRun.composition.length} steps`);
  console.log('  determinism: two runs, identical transcripts.');
} catch (error) {
  console.error(`RTN-008 clearing/obligations harness FAILED: ${error.stack ?? error}`);
  process.exit(1);
}
