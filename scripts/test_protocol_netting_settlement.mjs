#!/usr/bin/env node
/**
 * payswap3 · RTN-009 — Netting / Settlement authorities evidence harness
 * (areas 11-12, per-domain persistence + the REAL rails composition).
 *
 * Plain-Node evidence suite for the SQLite-backed surfaces of the two
 * RTN-009 domains (the same split the RTN-001 kernel, the RTN-002
 * evidence domain, the RTN-005/006/007 domains, and RTN-008 use): `bun
 * test` covers the pure modules and the in-process authorities (including
 * the real-log evidence coupling and the composed netting -> settlement
 * journey over the in-memory A13/A14 double); THIS harness exercises each
 * domain's per-domain store — open<Domain>Store over the DEP-003 database
 * layer (node:sqlite), the owned migrations, and the write-through
 * bridges — because Bun does not implement node:sqlite. It also runs the
 * REAL rails composition (RTN-004 RailsStore + RailAdapterAuthority +
 * ReconciliationAuthority + SimulatedRail) that the bun suites cannot
 * host for the same reason: the definitive UNKNOWN -> case -> resolution
 * -> finality end-to-end.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §3 Area 11
 *     lines 147-209 (the whole netting area — the persisted NettingSet /
 *     NetPosition / net-obligation shapes, INV-11-1/2/3);
 *   §4 Area 12 lines 211-289 (the whole settlement area — the persisted
 *     instruction / attempt / finality shapes, INV-12-1/2/3/4, the UNKNOWN
 *     durable state and the safe-resume);
 *   spec/architecture/v0.1/rails-adapters-reconciliation.md §1 Area 13
 *     lines 33-46 (the rail operation machine), §2 Area 14 lines 119-131
 *     (the case model), lines 171-179 (the recovery paths);
 *   spec/protocol-runtime-work-orders/README.md "Persistence convention"
 *   (per-domain schema + owned migrations, DEP-003 read-only).
 *
 * Scenarios:
 *   1. The netting domain store: run the authority over the REAL A15 log
 *      and the REAL obligations ledger, persist every committed artifact
 *      through the domain bridge (writeNettingSet per state,
 *      writeNetObligation, updateNetObligationState), read everything
 *      back, and assert the round trip reconstructs the records exactly
 *      (Money re-minted through the kernel guards — GC-1 holds on the
 *      read path).
 *   2. The settlement domain store: run the authority through the
 *      confirmed journey (including an UNKNOWN -> reconciliation ->
 *      resolution and a FAILED -> recovery instruction), persist
 *      instructions/attempts/finalities, read back, and assert the round
 *      trip.
 *   3. The REAL rails composition: a net-position settlement attempt
 *      lands UNKNOWN (TRANSMIT_TIMEOUT) on the REAL RailAdapterAuthority,
 *      the auto-case opens exactly once (INV-14-1), the second attempt
 *      authorization is refused (INV-12-2), the A10/A11 hold refuses
 *      finality (GC-2), the REAL ReconciliationAuthority resolves the
 *      case (RESOLVED_CONFIRMED — the only exit from UNKNOWN), and
 *      finality then advances the net position to SETTLED exactly once.
 *   4. Determinism: the whole composition runs twice; the transcripts are
 *      identical (GC-1).
 *
 * Node-version note: requires Node.js >= 22.6 (node:sqlite + type
 * stripping); on 22.6-22.17 this harness re-executes itself with
 * --experimental-sqlite / --experimental-strip-types as needed; on
 * Node >= 22.18 no flags are required. (Same bootstrap as
 * scripts/test_protocol_kernel.mjs and
 * scripts/test_protocol_clearing_obligations.mjs.)
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

const RESPAWN_ENV = 'PAYSWAP_RT9_TEST_RESPAWNED';
const tempDirs = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `payswap-rt9-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

/**
 * Bootstrap (mirrors scripts/test_protocol_clearing_obligations.mjs):
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
    await import(MODULE_URL('netting', 'types.ts'));
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
    console.error('node:sqlite / type stripping. The netting/settlement suite requires Node.js >= 22.6.');
    process.exit(1);
  }
  process.exit(typeof child.status === 'number' ? child.status : 1);
}

await ensureCapabilities();

let nettingModule;
let settlementModule;
let obligationsModule;
let railsModule;
let railsEvidenceDoubleModule;
let evidenceModule;
try {
  nettingModule = await import(MODULE_URL('netting', 'netting.ts'));
  settlementModule = await import(MODULE_URL('settlement', 'settlement.ts'));
  obligationsModule = await import(MODULE_URL('obligations', 'obligations.ts'));
  railsModule = await import(MODULE_URL('rails', 'index.ts'));
  railsEvidenceDoubleModule = await import(MODULE_URL('rails', 'evidence-test-double.ts'));
  evidenceModule = await import(MODULE_URL('evidence', 'evidence.ts'));
} catch (error) {
  console.error(`Failed to load the RTN-009 domain modules: ${error}`);
  console.error('This suite requires Node.js >= 22.6 (node:sqlite + TypeScript type stripping).');
  process.exit(1);
}

const {
  NettingAuthority,
  openNettingStore,
  writeNettingSet,
  updateNettingSet,
  writeNetObligation,
  updateNetObligationState,
  readNettingSets,
  readNetObligations,
} = nettingModule;
const {
  SettlementAuthority,
  settlementPortFromAuthorities,
  obligationLedgerPortFromAuthority,
  nettingPortFromAuthority,
  railIdempotencyKeyForInstruction,
  settlementInstructionIdFor,
  openSettlementStore,
  writeInstruction,
  updateInstructionState,
  writeAttempt,
  updateAttemptState,
  writeFinality,
  updateFinalityState,
  readInstructions,
  readAttempts,
  readFinalities,
} = settlementModule;
const { ObligationLedgerAuthority } = obligationsModule;
const {
  createRailsAuthorities,
  RailsStore,
  SimulatedRail,
  createSimulatedRailAdapter,
  openRailsStore,
} = railsModule;
const { createEvidenceTestDouble } = railsEvidenceDoubleModule;
const { createEvidenceLog } = evidenceModule;

const WALL = 1_800_000_000_000;

function deterministicClock(start) {
  let wall = start;
  return () => {
    wall += 1;
    return wall;
  };
}

const EUR = (minor) => ({ currency: 'EUR', scale: 2, amountMinor: minor });

/** Create one obligation in the REAL A10 ledger (acting as the clearing composition root). */
async function createObligation(obligations, recordId, debtor, creditor, amountMinor) {
  const outcome = await obligations.applyClearingCommand({
    batchId: `batch-${recordId}`,
    recordId,
    originActivityId: `activity-${recordId}`,
    originKind: 'INTENT',
    debtorParticipantId: debtor,
    creditorParticipantId: creditor,
    amount: EUR(amountMinor),
    reason: 'RTN-009 harness fixture',
  });
  return outcome.obligationId;
}

// ---------------------------------------------------------------------------
// Scenario 1 — the netting domain store (area 11 x per-domain persistence)
// ---------------------------------------------------------------------------

async function runNettingScenario() {
  const dir = tempDir('netting');
  const log = createEvidenceLog({ wallMs: WALL });
  const clock = deterministicClock(WALL);
  const obligations = new ObligationLedgerAuthority({ evidence: log, wallClock: clock });
  const netting = new NettingAuthority({
    evidence: log,
    obligations,
    wallClock: clock,
  });
  const store = openNettingStore({ dbPath: join(dir, 'netting.sqlite') });
  const transcript = [];

  const o1 = await createObligation(obligations, 'h1', 'alpha', 'beta', 10_000);
  const o2 = await createObligation(obligations, 'h2', 'beta', 'alpha', 6_000);
  const o3 = await createObligation(obligations, 'h3', 'beta', 'gamma', 3_000);
  const o4 = await createObligation(obligations, 'h4', 'gamma', 'alpha', 1_500);

  const opened = await netting.openNettingSet({
    label: 'harness-set',
    scope: { kind: 'MULTILATERAL', participants: ['alpha', 'beta', 'gamma'] },
    inputObligationIds: [o1, o2, o3, o4],
  });
  assert.equal(opened.ok, true);
  writeNettingSet(store, opened.value, 'harness-set');
  transcript.push(`open:${opened.value.nettingSetId}:${opened.value.state}`);

  const computed = await netting.computeNettingSet(opened.value.nettingSetId);
  assert.equal(computed.ok, true);
  updateNettingSet(store, computed.value);
  transcript.push(`computed:${computed.value.netPositions.length}:${computed.value.conservationProof.perCurrency.length}`);

  const committed = await netting.commitNettingSet(opened.value.nettingSetId);
  assert.equal(committed.ok, true);
  updateNettingSet(store, committed.value.set);
  for (const netObligation of committed.value.netObligations) {
    writeNetObligation(store, netObligation);
  }
  transcript.push(`committed:${committed.value.netObligations.length}:${committed.value.set.state}`);

  // The settlement-facing net-obligation lifecycle, persisted through the bridge.
  const first = committed.value.netObligations[0];
  const pending = await netting.applyNetPositionSettlementInstruction({
    netObligationId: first.netObligationId,
    settlementInstructionId: 'harness-instruction-1',
  });
  assert.equal(pending.ok, true);
  updateNetObligationState(store, pending.value.netObligation);
  const settled = await netting.applyNetPositionSettlementFinality({
    netObligationId: first.netObligationId,
    finalityRecordId: 'harness-finality-1',
  });
  assert.equal(settled.ok, true);
  updateNetObligationState(store, settled.value);
  transcript.push(`net:${first.netObligationId}:${pending.value.netObligation.state}:${settled.value.state}`);

  // The A10 side: all inputs NETTED.
  for (const obligationId of [o1, o2, o3, o4]) {
    assert.equal(obligations.obligation(obligationId).state, 'NETTED');
  }
  transcript.push(`a10:${obligations.obligations().filter((o) => o.state === 'NETTED').length}`);

  // Round trip: read back and compare against the authority's live records.
  const sets = readNettingSets(store);
  assert.equal(sets.length, 1);
  assert.equal(sets[0].label, 'harness-set');
  const liveSet = netting.nettingSet(opened.value.nettingSetId);
  assert.deepEqual(sets[0].set, liveSet);
  const persistedObligations = readNetObligations(store);
  assert.equal(persistedObligations.length, committed.value.netObligations.length);
  for (const entry of persistedObligations) {
    const live = netting.netObligation(entry.netObligationId);
    assert.deepEqual(entry, live);
  }
  transcript.push(`roundtrip:${sets.length}:${persistedObligations.length}`);

  // The evidence log verifies end-to-end.
  assert.equal(log.verifyAndRecord(clock()).verdict, 'VERIFIED');
  transcript.push('chain:VERIFIED');
  store.close?.();
  return transcript;
}

// ---------------------------------------------------------------------------
// Scenario 2 — the settlement domain store (area 12 x per-domain persistence)
// ---------------------------------------------------------------------------

async function runSettlementScenario() {
  const dir = tempDir('settlement');
  const log = createEvidenceLog({ wallMs: WALL });
  const clock = deterministicClock(WALL);
  const obligations = new ObligationLedgerAuthority({ evidence: log, wallClock: clock });
  const netting = new NettingAuthority({ evidence: log, obligations, wallClock: clock });
  // The REAL rails authorities over the REAL store. The rails side's
  // evidence goes to RTN-004's owned test double (the registry's
  // authority-name list carries 'Rail Authority', not the rails surface's
  // internal 'Rail Adapter Authority' id — the real-log integration of
  // the rails domain is RTN-012's composed work; the same split RTN-008's
  // harness used), while THIS work order's authorities (obligations,
  // netting, settlement) write to the REAL log.
  const railsDir = tempDir('settlement-rails');
  const railsStore = new RailsStore(
    openRailsStore({ dbPath: join(railsDir, 'rails.sqlite') }),
  );
  const railsEvidence = createEvidenceTestDouble();
  const authorities = createRailsAuthorities(railsStore, { evidence: railsEvidence, wallClock: clock });
  const adapterId = authorities.railAuthority.registerAdapter({
    railFamily: 'sim-bank',
    name: 'primary',
  }).value.adapterId;
  authorities.railAuthority.activateAdapter(adapterId);

  const settlement = new SettlementAuthority({
    evidence: log,
    rails: settlementPortFromAuthorities(authorities.railAuthority, authorities.reconciliation),
    obligations: obligationLedgerPortFromAuthority(obligations),
    netting: nettingPortFromAuthority(netting),
    wallClock: clock,
  });
  const store = openSettlementStore({ dbPath: join(dir, 'settlement.sqlite') });
  const transcript = [];

  // Journey A: a confirmed direct-obligation settlement.
  const o1 = await createObligation(obligations, 's1', 'alpha', 'beta', 5_000);
  const createdA = await settlement.createSettlementInstruction({
    subject: { kind: 'OBLIGATION', obligationId: o1 },
    beneficiary: 'acct-beta',
  });
  assert.equal(createdA.ok, true);
  writeInstruction(store, createdA.value);
  const instructionA = createdA.value.instructionId;
  const keyA = railIdempotencyKeyForInstruction(instructionA);
  const railA = new SimulatedRail('bank-s1', { [keyA]: 'ACCEPT_REPORT_CONFIRMED' });
  const connectionA = createSimulatedRailAdapter(railA, { wallClock: clock });
  const authorizedA = await settlement.authorizeAttempt(instructionA, adapterId);
  assert.equal(authorizedA.ok, true);
  writeAttempt(store, authorizedA.value);
  updateInstructionState(store, settlement.instruction(instructionA));
  const submittedA = await settlement.submitAttempt(instructionA, connectionA);
  assert.equal(submittedA.ok, true);
  updateAttemptState(store, submittedA.value.attempt);
  updateInstructionState(store, submittedA.value.instruction);
  transcript.push(`A:${submittedA.value.attempt.state}`);
  const reportA = connectionA.fetchReport(keyA);
  const recordedA = authorities.railAuthority.recordReport(
    authorizedA.value.operationId,
    reportA,
  );
  assert.equal(recordedA.ok, true);
  const mirroredA = await settlement.applyRailOutcome(instructionA);
  assert.equal(mirroredA.ok, true);
  updateAttemptState(store, mirroredA.value.attempt);
  updateInstructionState(store, mirroredA.value.instruction);
  const finalityA = settlement.finalityForSubject({ kind: 'OBLIGATION', obligationId: o1 });
  writeFinality(store, finalityA);
  const declaredA = await settlement.declareFinality(instructionA);
  assert.equal(declaredA.ok, true);
  updateFinalityState(store, declaredA.value);
  transcript.push(`A:${declaredA.value.state}:${obligations.obligation(o1).state}`);

  // Journey B: UNKNOWN -> reconciliation -> RESOLVED_FAILED -> recovery
  // instruction (a NEW id and idempotency key).
  const o2 = await createObligation(obligations, 's2', 'beta', 'gamma', 2_500);
  const createdB = await settlement.createSettlementInstruction({
    subject: { kind: 'OBLIGATION', obligationId: o2 },
    beneficiary: 'acct-gamma',
  });
  assert.equal(createdB.ok, true);
  writeInstruction(store, createdB.value);
  const instructionB = createdB.value.instructionId;
  const keyB = railIdempotencyKeyForInstruction(instructionB);
  const railB = new SimulatedRail('bank-s2', { [keyB]: 'TRANSMIT_TIMEOUT' });
  const connectionB = createSimulatedRailAdapter(railB, { wallClock: clock });
  const authorizedB = await settlement.authorizeAttempt(instructionB, adapterId);
  assert.equal(authorizedB.ok, true);
  writeAttempt(store, authorizedB.value);
  updateInstructionState(store, settlement.instruction(instructionB));
  const submittedB = await settlement.submitAttempt(instructionB, connectionB);
  assert.equal(submittedB.ok, true);
  updateAttemptState(store, submittedB.value.attempt);
  transcript.push(`B:${submittedB.value.attempt.state}`);
  assert.equal(submittedB.value.attempt.state, 'UNKNOWN');
  // The INV-12-2 refusal while UNKNOWN (the REAL A13 refuses re-submission too).
  const refused = await settlement.authorizeAttempt(instructionB, adapterId);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'LIVE_ATTEMPT_EXISTS');
  const railResubmission = authorities.railAuthority.submitRailOperation(
    authorizedB.value.operationId,
    connectionB,
  );
  assert.equal(railResubmission.ok, false);
  assert.equal(railResubmission.reasonCode, 'OPERATION_NOT_AUTHORIZED');
  // The reconciliation: investigate + RESOLVED_FAILED.
  const caseRecord = authorities.reconciliation.getCaseByOriginOperation(authorizedB.value.operationId);
  assert.ok(caseRecord !== undefined);
  const investigated = authorities.reconciliation.investigateCase(caseRecord.caseId);
  assert.equal(investigated.ok, true);
  const resolved = authorities.reconciliation.resolveCase(caseRecord.caseId, {
    resolution: 'RESOLVED_FAILED',
    proof: { externalRefs: ['bank-statement-s2'] },
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.value.operation.status, 'FAILED');
  assert.equal(resolved.value.recovery.feed, 'AREA_12_NEW_INSTRUCTION');
  const resumed = await settlement.applyResolution(resolved.value.recovery, caseRecord.caseId);
  assert.equal(resumed.ok, true);
  updateAttemptState(store, resumed.value.attempt);
  updateInstructionState(store, resumed.value.instruction);
  transcript.push(`B:${resumed.value.attempt.state}:${resumed.value.instruction.state}`);
  // The recovery instruction: a NEW id and a NEW idempotency key.
  const recovery = await settlement.createSettlementInstruction({
    subject: { kind: 'OBLIGATION', obligationId: o2 },
    beneficiary: 'acct-gamma',
  });
  assert.equal(recovery.ok, true);
  writeInstruction(store, recovery.value);
  const keyRecovery = railIdempotencyKeyForInstruction(recovery.value.instructionId);
  assert.notEqual(keyRecovery, keyB);
  transcript.push(`B:recovery:${recovery.value.subjectOrdinal}`);

  // Round trip.
  const instructions = readInstructions(store);
  const attempts = readAttempts(store);
  const finalities = readFinalities(store);
  assert.equal(instructions.length, 3); // A + B + the B recovery
  assert.equal(attempts.length, 2);
  assert.equal(finalities.length, 1);
  for (const instruction of instructions) {
    assert.deepEqual(instruction, settlement.instruction(instruction.instructionId));
  }
  for (const attempt of attempts) {
    assert.deepEqual(attempt, settlement.attempt(attempt.attemptId));
  }
  for (const finality of finalities) {
    assert.deepEqual(finality, settlement.finality(finality.finalityRecordId));
  }
  transcript.push(`roundtrip:${instructions.length}:${attempts.length}:${finalities.length}`);
  assert.equal(log.verifyAndRecord(clock()).verdict, 'VERIFIED');
  transcript.push('chain:VERIFIED');
  store.close?.();
  railsStore.close();
  return transcript;
}

// ---------------------------------------------------------------------------
// Scenario 3 — the REAL rails composition (the definitive e2e)
// ---------------------------------------------------------------------------

async function runRealRailsComposition() {
  const dir = tempDir('composition');
  const log = createEvidenceLog({ wallMs: WALL });
  const clock = deterministicClock(WALL);
  const obligations = new ObligationLedgerAuthority({ evidence: log, wallClock: clock });
  const netting = new NettingAuthority({ evidence: log, obligations, wallClock: clock });
  const railsStore = new RailsStore(openRailsStore({ dbPath: join(dir, 'rails.sqlite') }));
  const railsEvidence = createEvidenceTestDouble();
  const authorities = createRailsAuthorities(railsStore, { evidence: railsEvidence, wallClock: clock });
  const adapterId = authorities.railAuthority.registerAdapter({
    railFamily: 'sim-bank',
    name: 'primary',
  }).value.adapterId;
  authorities.railAuthority.activateAdapter(adapterId);
  const settlement = new SettlementAuthority({
    evidence: log,
    rails: settlementPortFromAuthorities(authorities.railAuthority, authorities.reconciliation),
    obligations: obligationLedgerPortFromAuthority(obligations),
    netting: nettingPortFromAuthority(netting),
    wallClock: clock,
  });
  const transcript = [];

  // Net two obligations; settle the net position.
  const o1 = await createObligation(obligations, 'r1', 'alpha', 'beta', 9_000);
  const o2 = await createObligation(obligations, 'r2', 'beta', 'alpha', 3_000);
  const opened = await netting.openNettingSet({
    label: 'composition-set',
    scope: { kind: 'BILATERAL', participants: ['alpha', 'beta'] },
    inputObligationIds: [o1, o2],
  });
  assert.equal(opened.ok, true);
  await netting.computeNettingSet(opened.value.nettingSetId);
  const committed = await netting.commitNettingSet(opened.value.nettingSetId);
  assert.equal(committed.ok, true);
  const netObligationId = committed.value.netObligations[0].netObligationId;
  transcript.push(`net:${committed.value.netObligations[0].amount.amountMinor}`);

  const created = await settlement.createSettlementInstruction({
    subject: { kind: 'NET_POSITION', netObligationId },
    beneficiary: 'acct-beta',
  });
  assert.equal(created.ok, true);
  const instructionId = created.value.instructionId;
  const key = railIdempotencyKeyForInstruction(instructionId);
  const rail = new SimulatedRail('bank-comp', { [key]: 'TRANSMIT_TIMEOUT' });
  const connection = createSimulatedRailAdapter(rail, { wallClock: clock });
  const authorized = await settlement.authorizeAttempt(instructionId, adapterId);
  assert.equal(authorized.ok, true);
  // INV-12-3: the REAL A13 operation carries the identical derived key.
  const operation = authorities.railAuthority.getOperation(authorized.value.operationId);
  assert.equal(operation.idempotencyKey, key);
  assert.equal(operation.payloadHash, created.value.payloadHash);
  transcript.push(`authorized:${operation.status}`);

  const submitted = await settlement.submitAttempt(instructionId, connection);
  assert.equal(submitted.ok, true);
  assert.equal(submitted.value.attempt.state, 'UNKNOWN');
  transcript.push(`attempt:${submitted.value.attempt.state}`);

  // INV-14-1: exactly one case, automatically opened by the REAL A13/A14 wiring.
  const caseRecord = authorities.reconciliation.getCaseByOriginOperation(operation.operationId);
  assert.ok(caseRecord !== undefined);
  assert.equal(caseRecord.status, 'OPEN');
  assert.equal(submitted.value.caseId, caseRecord.caseId);
  transcript.push(`case:${caseRecord.caseId}`);

  // The durable UNKNOWN state, verbatim.
  assert.equal(settlement.instruction(instructionId).state, 'ISSUED');
  assert.equal(netting.netObligation(netObligationId).state, 'SETTLEMENT_PENDING');
  // INV-12-2 on the REAL A13: re-submission is refused.
  const resubmission = authorities.railAuthority.submitRailOperation(operation.operationId, connection);
  assert.equal(resubmission.ok, false);
  assert.equal(resubmission.reasonCode, 'OPERATION_NOT_AUTHORIZED');
  // The second attempt authorization is refused while UNKNOWN.
  const second = await settlement.authorizeAttempt(instructionId, adapterId);
  assert.equal(second.ok, false);
  assert.equal(second.code, 'LIVE_ATTEMPT_EXISTS');
  // GC-2: finality is blocked until reconciliation resolves.
  const blocked = await settlement.declareFinality(instructionId);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'UNKNOWN_HELD');
  transcript.push('held:UNKNOWN_HELD');

  // The reconciliation resolution — the only exit from UNKNOWN.
  assert.equal(authorities.reconciliation.investigateCase(caseRecord.caseId).ok, true);
  const resolved = authorities.reconciliation.resolveCase(caseRecord.caseId, {
    resolution: 'RESOLVED_CONFIRMED',
    proof: { externalRefs: ['bank-statement-comp'] },
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.value.operation.status, 'CONFIRMED');
  assert.equal(resolved.value.recovery.feed, 'AREA_12_FINALITY_ADVANCE');
  // INV-14-2: the duplicate resolution is rejected.
  const duplicate = authorities.reconciliation.resolveCase(caseRecord.caseId, {
    resolution: 'RESOLVED_FAILED',
    proof: { externalRefs: ['bank-statement-comp'] },
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reasonCode, 'DUPLICATE_RESOLUTION');

  // The safe-resume: attempt CONFIRMED, finality PROVISIONAL then FINAL,
  // the net position SETTLED exactly once.
  const resumed = await settlement.applyResolution(resolved.value.recovery, caseRecord.caseId);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.value.attempt.state, 'CONFIRMED');
  assert.equal(resumed.value.instruction.state, 'CONFIRMED');
  transcript.push(`resolved:${resumed.value.attempt.state}`);
  const finality = settlement.finalityForSubject({ kind: 'NET_POSITION', netObligationId });
  assert.equal(finality.state, 'PROVISIONAL');
  const declared = await settlement.declareFinality(instructionId);
  assert.equal(declared.ok, true);
  assert.equal(declared.value.state, 'FINAL');
  assert.equal(netting.netObligation(netObligationId).state, 'SETTLED');
  // FINAL is exactly-once and irreversible.
  const again = await settlement.declareFinality(instructionId);
  assert.equal(again.ok, false);
  assert.equal(again.code, 'FINALITY_ALREADY_DECLARED');
  transcript.push(`finality:${declared.value.state}:${netting.netObligation(netObligationId).state}`);

  // The evidence chain of the WHOLE composed runtime verifies.
  assert.equal(log.verifyAndRecord(clock()).verdict, 'VERIFIED');
  transcript.push('chain:VERIFIED');
  railsStore.close();
  return transcript;
}

// ---------------------------------------------------------------------------
// Scenario 4 — determinism (two identical runs, identical transcripts)
// ---------------------------------------------------------------------------

let failure = null;
try {
  const nettingTranscript = await runNettingScenario();
  const settlementTranscript = await runSettlementScenario();
  const firstComposition = await runRealRailsComposition();
  const secondComposition = await runRealRailsComposition();
  assert.deepEqual(secondComposition, firstComposition);

  console.log('RTN-009 netting/settlement harness: all checks green.');
  console.log(`  netting store:            ${nettingTranscript.join(' | ')}`);
  console.log(`  settlement store:         ${settlementTranscript.join(' | ')}`);
  console.log(`  real rails composition:   ${firstComposition.join(' | ')}`);
  console.log('  determinism: two composition runs, identical transcripts.');
} catch (error) {
  failure = error;
  console.error('RTN-009 netting/settlement harness: FAILED.');
  console.error(error);
} finally {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}
if (failure !== null) {
  process.exit(1);
}
