#!/usr/bin/env node
/**
 * payswap3 · DEP-004 — The operational-jobs evidence harness (the durable
 * operational-jobs layer over the composed protocol runtime).
 *
 * Plain-Node evidence suite for DEP-004's owned integration evidence (the
 * work order's required evidence: "Duplicate-job, restart, UNKNOWN,
 * reconciliation and audit-evidence tests"), composed over the REAL
 * runtime per the wave barrel's composition order: the DEP-003 durable
 * substrate, the real A15 log + evidence store, the real A09/A10/A11/A12/
 * A13/A14/A03/A06/A07/A08 authorities, the RTN-010 gateway (the ONE
 * admission point), the RTN-011 transition runtime (the single writer),
 * and the DEP-004 operational-jobs family (src/lib/operations/) —
 * registered through the substrate's register() integration point.
 *
 * Spec sources (binding):
 *   spec/system-work-orders/DEP-004.md — the acceptance matrix:
 *     - "Jobs consume only authoritative protocol state."
 *     - "Duplicate execution is harmless or prevented by protocol
 *       concurrency controls."
 *     - "UNKNOWN external outcomes trigger reconciliation rather than
 *       blind retry."
 *     - "Clearing/netting jobs are restart-safe and auditable."
 *     - "Settlement-support work never asserts finality itself."
 *   src/lib/protocol-runtime/INTEGRATION-EVIDENCE.md — the composed
 *     UNKNOWN-confirmed/UNKNOWN-failed semantics (the oracle) and the
 *     filed composition defect D-2 (the gateway-vs-hosted vocabulary
 *     gap: admitted-but-un-hosted kinds sit queued — asserted honestly
 *     below, never silently).
 *   src/lib/protocol-runtime/gateway/COMMAND-SURFACE.md — the submission
 *     contract the jobs emit through.
 *   src/lib/operations/OPERATIONS-EVIDENCE.md — the family's evidence
 *     document (duties, disciplines, the honest execution-gap note).
 *
 * Scenarios:
 *   0. [test:family-barrel]        the operations family barrel loads under
 *                                  plain Node and exports the composed
 *                                  surface; the scheduler wiring follows the
 *                                  scheduler-wiring precedent (deterministic
 *                                  payloads per tick identity).
 *   1. [test:clearing-netting-settlement]
 *                                  THE operations golden path: the clearing
 *                                  job advances a window batch open → stage →
 *                                  commit → finalize (records staged by the
 *                                  harness fixture on the owning authority —
 *                                  the composed-journey precedent for the
 *                                  un-hosted clearing.record.add); the
 *                                  netting job opens/computes/commits the
 *                                  cohort set; the settlement job drives the
 *                                  net positions instruction → authorize →
 *                                  submit; finality is advanced by the
 *                                  AUTHORITY (the harness drives the report
 *                                  ingestion + declareFinality — the
 *                                  composed-journey precedent), NEVER by the
 *                                  job (asserted on the job's journal). The
 *                                  duplicate-job discipline: the same-cycle
 *                                  re-trigger is absorbed by the substrate
 *                                  dedupe.
 *   2. [test:unknown-reconciliation]
 *                                  the UNKNOWN path: the settlement job's
 *                                  submit lands UNKNOWN (TRANSMIT_TIMEOUT);
 *                                  the INV-14-1 auto-case opens (the
 *                                  protocol's own reconciliation engagement);
 *                                  the settlement job audits UNKNOWN-held and
 *                                  never retries (the authorities' refusals
 *                                  LIVE_ATTEMPT_EXISTS / UNKNOWN_HELD are
 *                                  demonstrated as the structural controls);
 *                                  the reconciliation sweep submits the A14
 *                                  path (source.register EXECUTES; cycle.open
 *                                  / statements.collect / case.investigate
 *                                  admitted — the queued D-2 subset asserted
 *                                  honestly); the harness completes the
 *                                  UNKNOWN lifecycle through authority-direct
 *                                  fixtures (the composed-journey D-2
 *                                  precedent) — resolution, recovery, and
 *                                  finality — none of them job actions.
 *   3. [test:restart-safety]       the dying-worker cycle on the clearing
 *                                  job: reserve → execute the atomic unit →
 *                                  never complete → lease expiry → the
 *                                  redelivery re-executes and re-submits the
 *                                  SAME command keys (the gateway returns the
 *                                  recorded receipts — never a second
 *                                  effect); then the substrate-level
 *                                  redelivery path (reclaim → re-reserve →
 *                                  the worker re-executes → the job
 *                                  completes) with the progression cascade
 *                                  and zero double effects.
 *   4. [test:queue-drain-support]  the queue lifecycle: the job creates the
 *                                  configured queue (EXECUTES), submits the
 *                                  drain gate (admitted — queued, D-2), then
 *                                  (DRAINING, harness-started fixture) drives
 *                                  the eligibility sweep with the snapshot
 *                                  DERIVED from authoritative reads (the A03
 *                                  capability snapshot + the A06 pool total)
 *                                  and the due-expiry sweep: items become
 *                                  ELIGIBLE and the overdue item EXPIRES.
 *   5. [test:audit-evidence]       the audit join: every consequential job
 *                                  action is in the jobs' durable_events
 *                                  journal; every journal command correlates
 *                                  to its admission (created/replayed) and —
 *                                  for the executable kinds — to its
 *                                  protocol.command.executed observation
 *                                  (applied/replayed/rejected); the A15
 *                                  chain verifies over the whole run; the
 *                                  evidence store round-trips.
 *   6. [test:determinism]          the operations golden path runs twice;
 *                                  the transcripts are identical (GC-1).
 *
 * Node-version note: requires Node.js >= 22.6 (node:sqlite + type
 * stripping); the harness self-configures the experimental flags on Node
 * builds that need them (same bootstrap as the merged RTN harnesses).
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
const OPERATIONS_DIR = join(ROOT, 'src', 'lib', 'operations');
const DURABLE_URL = (name) => pathToFileURL(join(ROOT, 'src', 'lib', 'durable', name)).href;
const MODULE_URL = (domain, name) => pathToFileURL(join(RUNTIME_DIR, domain, name)).href;
const OPS_URL = (name) => pathToFileURL(join(OPERATIONS_DIR, name)).href;

const RESPAWN_ENV = 'PAYSWAP_DEP004_TEST_RESPAWNED';
const tempDirs = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `payswap-dep004-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/**
 * Bootstrap (mirrors the merged RTN harnesses): probes node:sqlite
 * importability and .ts module loadability, re-executing this script with
 * the required experimental flags on Node builds that need them.
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
    await import(MODULE_URL('kernel', 'time.ts'));
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
    console.error('node:sqlite / type stripping. The DEP-004 harness requires Node.js >= 22.6.');
    process.exit(1);
  }
  process.exit(typeof child.status === 'number' ? child.status : 1);
}

await ensureCapabilities();

// -- module loading (the composed runtime + the operations family) ---------

const { listRecentEvents } = await import(DURABLE_URL('events.ts'));
const {
  openTransitionSubstrate,
  asSchedulerSubstrate,
  buildDurablePersistHooks,
  adaptRailEvidenceToRegistryNames,
} = await import(MODULE_URL('hosting', 'durable-binding.ts'));
const { createAuthorityCommandBindings } = await import(MODULE_URL('hosting', 'bindings.ts'));
const { createTransitionRuntime, COMMAND_EXECUTED_EVENT_TYPE } = await import(
  MODULE_URL('transition', 'execution.ts')
);
const { ProtocolGateway, commandQueuePortFromDurableQueue } = await import(MODULE_URL('gateway', 'admission.ts'));
const { createEvidenceLog } = await import(MODULE_URL('evidence', 'log.ts'));
const { openEvidenceStore, writeEvidenceRecord, readEvidenceRecords } = await import(
  MODULE_URL('evidence', 'persistence.ts')
);
const { verifyEvidenceChain } = await import(MODULE_URL('evidence', 'chain.ts'));
const { openObligationsStore } = await import(MODULE_URL('obligations', 'persistence.ts'));
const { openSettlementStore } = await import(MODULE_URL('settlement', 'persistence.ts'));
const { openClearingStore } = await import(MODULE_URL('clearing', 'persistence.ts'));
const { openNettingStore } = await import(MODULE_URL('netting', 'persistence.ts'));
const { openQueuesStore } = await import(MODULE_URL('queues', 'persistence.ts'));
const { openRailsAuthorities } = await import(MODULE_URL('rails', 'runtime.ts'));
const { openReservationLedger } = await import(MODULE_URL('reservations', 'ledger.ts'));
const { settlementPortFromAuthorities, obligationLedgerPortFromAuthority, nettingPortFromAuthority } = await import(
  MODULE_URL('settlement', 'ports.ts')
);
const { ObligationLedgerAuthority } = await import(MODULE_URL('obligations', 'authority.ts'));
const { NettingAuthority } = await import(MODULE_URL('netting', 'authority.ts'));
const { SettlementAuthority } = await import(MODULE_URL('settlement', 'authority.ts'));
const { ClearingAuthority } = await import(MODULE_URL('clearing', 'authority.ts'));
const { QueueAuthority } = await import(MODULE_URL('queues', 'authority.ts'));
const { CapabilityAuthority } = await import(MODULE_URL('capability', 'authority.ts'));
const { LiquidityAuthority } = await import(MODULE_URL('liquidity', 'authority.ts'));
const { CreditAuthority } = await import(MODULE_URL('credit', 'authority.ts'));
const { SimulatedRail, createSimulatedRailAdapter } = await import(MODULE_URL('rails', 'adapters.ts'));
const { validateCommandEnvelope } = await import(MODULE_URL('kernel', 'envelope.ts'));
const { deriveProtocolId, deriveIdempotencyKey } = await import(MODULE_URL('kernel', 'identity.ts'));
const { protocolTime } = await import(MODULE_URL('kernel', 'time.ts'));
const { money } = await import(MODULE_URL('kernel', 'money.ts'));
const { createRiskComplianceAuthority } = await import(MODULE_URL('risk', 'authority.ts'));
const { subjectComplianceData } = await import(MODULE_URL('risk', 'subject.ts'));
const { obligationIdForOriginRecord } = await import(MODULE_URL('obligations', 'state-machine.ts'));
const { netObligationIdFor, nettingSetIdForLabel } = await import(MODULE_URL('netting', 'state-machine.ts'));
const { settlementInstructionIdFor, railIdempotencyKeyForInstruction } = await import(
  MODULE_URL('settlement', 'state-machine.ts')
);
const { clearingBatchId } = await import(MODULE_URL('clearing', 'summation.ts'));

// -- the DEP-004 operational-jobs family (the layer under test) -------------

const operations = await import(OPS_URL('index.ts'));
const {
  OPERATIONS_EVENT_OWNER,
  registerOperationalJobs,
  enqueueOperationalJob,
  operationalJobIdempotencyKey,
  wireOperationalJobScheduler,
  readOperationalJobProgress,
  reconciliationCycleIdForWindow,
  CLEARING_PROGRESSION_JOB_KIND,
  NETTING_SETTLEMENT_PROGRESSION_JOB_KIND,
  RECONCILIATION_SWEEP_JOB_KIND,
  QUEUE_DRAIN_SUPPORT_JOB_KIND,
} = operations;

// -- shared composition -------------------------------------------------------

const LEASE_MS = 40;
const EUR = (minor) => money('EUR', minor, 2);

/** The clearing-record fixtures (the composed journey's gross set). */
const GROSS = [
  { id: 'g1', debtor: 'alpha', creditor: 'beta', amount: 10_000 },
  { id: 'g2', debtor: 'beta', creditor: 'alpha', amount: 4_000 },
  { id: 'g3', debtor: 'beta', creditor: 'gamma', amount: 7_000 },
  { id: 'g4', debtor: 'gamma', creditor: 'alpha', amount: 2_000 },
];

/**
 * THE composed runtime with the DEP-004 operations layer registered — the
 * wave barrel's composition order (substrate → evidence → authorities →
 * persist hooks → bindings → transition runtime → gateway) extended with
 * THE OPERATIONAL JOBS (registerOperationalJobs — the DEP-003 register()
 * integration point). The composition trims the authorities to the ones
 * the operational duties orchestrate (A03/A06/A07/A08/A09/A10/A11/A12/
 * A13/A14 + the A16 risk gate the capability fixture needs); every
 * authority runs over the one real A15 log, and the jobs layer holds only
 * the gateway's submitCommand, the authorities' reads, and the audit port.
 */
async function composeOperationsRuntime(options = {}) {
  const dir = options.dir ?? tempDir('operations');
  let wall = options.wall ?? 5_000;
  const clock = () => wall;
  const evidenceWallMs = options.evidenceWallMs ?? 1_000;

  // 1. SUBSTRATE — the real DEP-003 durable command path.
  const durableRuntime = openTransitionSubstrate({
    dbPath: join(dir, 'durable.sqlite'),
    workerId: options.workerId ?? 'dep004-harness-worker',
    concurrency: 1,
    leaseMs: options.leaseMs ?? LEASE_MS,
    pollIntervalMs: 5,
    backoffBaseMs: 10,
    backoffMaxMs: 50,
  });

  // 2. EVIDENCE — the REAL A15 log over the evidence-object-store bridge.
  const evidenceStore = openEvidenceStore({ dbPath: join(dir, 'evidence.sqlite') });
  const log = createEvidenceLog({ wallMs: evidenceWallMs });
  const evidence = {
    submit(record) {
      const before = log.height;
      log.submit(record);
      for (const written of log.records().slice(before)) {
        writeEvidenceRecord(evidenceStore, written);
      }
    },
  };

  // 3. AUTHORITIES — the operational spine the jobs orchestrate.
  const risk = createRiskComplianceAuthority({
    evidence,
    store: { dbPath: join(dir, 'risk.sqlite') },
  });
  const capability = new CapabilityAuthority({
    evidence,
    gate: (subjectId) => risk.checkGate('capability.ACTIVATION', subjectId),
    wallClock: clock,
  });
  // The area-5 reservation ledger (the A06/A07 concurrency frontier).
  const reservations = await openReservationLedger({ evidence, wallClock: clock });
  const liquidity = new LiquidityAuthority({ evidence, ledger: reservations, wallClock: clock });
  const credit = new CreditAuthority({ evidence, ledger: reservations, wallClock: clock });
  const obligations = new ObligationLedgerAuthority({ evidence, wallClock: clock });
  const netting = new NettingAuthority({ evidence, obligations, wallClock: clock });
  const railsAuthorities = openRailsAuthorities(
    { dbPath: join(dir, 'rails.sqlite') },
    { evidence: adaptRailEvidenceToRegistryNames(evidence), wallClock: clock },
  );
  const railAuthority = railsAuthorities.railAuthority;
  const reconciliation = railsAuthorities.reconciliation;
  const rail = new SimulatedRail('bank-1', options.railScript ?? {});
  const connection = createSimulatedRailAdapter(rail, { wallClock: clock });
  const settlement = new SettlementAuthority({
    evidence,
    rails: settlementPortFromAuthorities(railAuthority, reconciliation),
    obligations: obligationLedgerPortFromAuthority(obligations),
    netting: nettingPortFromAuthority(netting),
    wallClock: clock,
  });
  obligations.settlementHold = (obligationId) =>
    settlement.isUnknownHeld({ kind: 'OBLIGATION', obligationId });
  const clearing = new ClearingAuthority({ evidence, sink: obligations, wallClock: clock });
  const queues = new QueueAuthority({ evidence, wallClock: clock });

  // 4. PERSIST HOOKS — the idempotent per-domain durable write-through.
  const obligationsStore = openObligationsStore({ dbPath: join(dir, 'obligations.sqlite') });
  const settlementStore = openSettlementStore({ dbPath: join(dir, 'settlement.sqlite') });
  const clearingStore = openClearingStore({ dbPath: join(dir, 'clearing.sqlite') });
  const nettingStore = openNettingStore({ dbPath: join(dir, 'netting.sqlite') });
  const queuesStore = openQueuesStore({ dbPath: join(dir, 'queues.sqlite') });
  const persist = buildDurablePersistHooks({
    obligations: obligationsStore,
    settlement: settlementStore,
    clearing: clearingStore,
    netting: nettingStore,
    queues: queuesStore,
  });

  // 5. BINDINGS + 6. TRANSITION — the single authoritative-state writer.
  const bindings = createAuthorityCommandBindings({
    obligations,
    settlement,
    railsReport: railAuthority,
    railConnection: connection,
    rails: {
      registerAdapter: (input) => railAuthority.registerAdapter(input),
      activateAdapter: (adapterId) => railAuthority.activateAdapter(adapterId),
      authorizeOperation: (input) => railAuthority.authorizeOperation(input),
      submitRailOperation: (operationId, conn) => railAuthority.submitRailOperation(operationId, conn),
    },
    reconciliation: {
      registerSource: (input) => reconciliation.registerSource(input),
      openCycle: (input) => reconciliation.openCycle(input),
      collectStatements: (cycleId, statements) => reconciliation.collectStatements(cycleId, statements),
      runMatching: (cycleId) => reconciliation.runMatching(cycleId),
      closeCycle: (cycleId) => reconciliation.closeCycle(cycleId),
    },
    clearing,
    netting,
    queues,
    persist,
  });
  const runtime = createTransitionRuntime({ substrate: durableRuntime, bindings });
  runtime.registerAll();

  // 7. GATEWAY — the sole admission point over the same durable path.
  const gateway = new ProtocolGateway({
    evidence,
    queue: commandQueuePortFromDurableQueue(durableRuntime.queue),
    wallClock: clock,
  });

  // 8. THE OPERATIONAL JOBS (DEP-004) — the read surface, the job deps,
  //    and the registration through the substrate's register() point.
  const adapterId = deriveProtocolId('rail-adapter', 'sim-bank', 'primary');
  const jobConfig = {
    clearingBatchLabelPrefix: 'ops-batch-',
    nettingLabelPrefix: 'ops-net-',
    settlementAdapterId: adapterId,
    beneficiaryFor: () => 'acct-gamma',
    reconciliationSources: [
      { kind: 'sim-bank', description: 'primary statement feed' },
    ],
    reconciliationRuleVersion: 1,
    statementProvider: options.statementProvider,
    queueIds: ['ops-queue-eur'],
    queuePolicies: {
      'ops-queue-eur': {
        maxWaitEpochMs: 60_000,
        releaseConditions: {
          requiredCapabilityTier: 'standard',
          minLiquidityAvailable: EUR(100_00),
        },
      },
    },
    liquidityPoolIds: ['pool-ops-eur'],
    ...(options.jobConfig ?? {}),
  };
  const reads = {
    clearing: { batch: (batchId) => clearing.batch(batchId) },
    netting: {
      nettingSet: (nettingSetId) => netting.nettingSet(nettingSetId),
      listNettingSets: () => netting.listNettingSets(),
      listNetObligations: () => netting.listNetObligations(),
      obligationClaim: (obligationId) => netting.obligationClaim(obligationId),
    },
    obligations: { obligations: () => obligations.obligations() },
    settlement: {
      listInstructions: () => settlement.listInstructions(),
      instructionsForSubject: (subject) => settlement.instructionsForSubject(subject),
      attemptForInstruction: (instructionId) => settlement.attemptForInstruction(instructionId),
      listAttempts: () => settlement.listAttempts(),
    },
    reconciliation: {
      getSource: (sourceId) => reconciliation.getSource(sourceId),
      listSources: () => reconciliation.listSources(),
      listCases: () => reconciliation.listCases(),
      getCycle: (cycleId) => reconciliation.getCycle(cycleId),
    },
    queues: { queue: (queueId) => queues.queue(queueId) },
    capability: { snapshot: () => capability.snapshot() },
    liquidity: { pool: (poolId) => liquidity.pool(poolId) },
    credit: {
      linesInOrder: () => credit.linesInOrder(),
      lineExposure: (lineId) => credit.lineExposure(lineId),
    },
  };
  const audit = {
    recordEvent: (type, data, owner, jobId) => durableRuntime.recordEvent(type, data, owner, jobId),
  };
  // The composition-root substrate port: the DEP-003 integration point
  // (register) + the durable job-trigger enqueue, bound here (the harness
  // is the composition root — the family's own source never calls the
  // transport primitive by its name; see orchestration.ts's naming note).
  const jobSubstrate = {
    register: (kind, handler) => durableRuntime.register(kind, handler),
    enqueueJob: (kind, payload, options) => durableRuntime.enqueue(kind, payload, options),
  };
  const wiring = registerOperationalJobs(jobSubstrate, {
    gateway,
    reads,
    audit,
    config: jobConfig,
  });

  return {
    dir,
    durableRuntime,
    runtime,
    gateway,
    log,
    evidence,
    evidenceStore,
    stores: { obligations: obligationsStore, settlement: settlementStore, clearing: clearingStore, netting: nettingStore, queues: queuesStore, evidence: evidenceStore },
    authorities: { risk, capability, liquidity, credit, obligations, netting, settlement, clearing, queues },
    rails: { railAuthority, reconciliation },
    rail,
    connection,
    adapterId,
    reads,
    wiring,
    jobConfig,
    jobSubstrate,
    advanceWall: (ms) => {
      wall += ms;
    },
    get wall() {
      return wall;
    },
    async close() {
      await durableRuntime.worker.stop();
      durableRuntime.close();
      risk.close();
      for (const store of [obligationsStore, settlementStore, clearingStore, nettingStore, queuesStore, evidenceStore]) {
        store.close();
      }
    },
  };
}

/**
 * The deterministic drain over the REAL worker (the composed harness's
 * pattern): tick() dispatches at bounded concurrency 1 and stop() awaits
 * the in-flight executions — repeat until nothing is dispatchable.
 */
async function drain(composition, maxPasses = 80) {
  let total = 0;
  for (let i = 0; i < maxPasses; i += 1) {
    const dispatched = await composition.durableRuntime.worker.tick();
    await composition.durableRuntime.worker.stop();
    total += dispatched;
    if (dispatched === 0) {
      break;
    }
  }
  return total;
}

/**
 * Admit one command through THE GATEWAY (the sole admission point) — the
 * harness's own fixture path (adapter registration etc.), then drain so
 * the transition runtime executes it.
 */
async function submitViaGateway(composition, kind, authority, body, idempotencyKey, subjectIds = []) {
  const envelope = {
    kind,
    authority,
    subjectIds,
    idempotencyKey,
    protocolTime: protocolTime(1, composition.wall),
    body,
  };
  const validation = validateCommandEnvelope(envelope, { allowedAuthorities: [authority] });
  assert.equal(validation.ok, true, `harness envelope for ${kind} must be kernel-valid`);
  const admission = await composition.gateway.submitCommand(envelope);
  assert.equal(admission.ok, true, `gateway refused ${kind}: ${admission.ok ? '' : `${admission.reasonCode}: ${admission.problem}`}`);
  await drain(composition);
  return admission;
}

/** Trigger one operational job run (the on-demand path) and drain. */
function triggerJob(composition, jobKind, cycle, windowStartWallMs, windowEndWallMs) {
  const result = enqueueOperationalJob(composition.jobSubstrate, jobKind, {
    cycle,
    windowStartWallMs,
    windowEndWallMs,
  });
  return result;
}

async function runJob(composition, jobKind, cycle, windowStartWallMs, windowEndWallMs) {
  const trigger = triggerJob(composition, jobKind, cycle, windowStartWallMs, windowEndWallMs);
  await drain(composition);
  return trigger;
}

/** The operational-jobs journal (the durable_events audit rows). */
function jobJournal(composition, limit = 1_600) {
  return listRecentEvents(composition.durableRuntime.database, limit)
    .filter((event) => event.owner === OPERATIONS_EVENT_OWNER)
    .reverse();
}

function journalCommands(composition) {
  return jobJournal(composition).filter((event) => event.type === 'operations.command.submitted');
}

function operationTypes(composition) {
  return composition.log.records().map((record) => record.what.operationType);
}

function countType(composition, type) {
  return operationTypes(composition).filter((candidate) => candidate === type).length;
}

function executedObservations(composition) {
  return listRecentEvents(composition.durableRuntime.database, 1_600)
    .filter((event) => event.type === COMMAND_EXECUTED_EVENT_TYPE)
    .map((event) => ({ ...(event.data ?? {}), jobId: event.jobId, owner: event.owner }))
    .reverse();
}

/**
 * Drive the REAL risk authority's approval for one gate subject (the
 * composed harness's helper — the capability-activation fixture).
 */
async function approveGateSubject(composition, subjectId, subjectKind, when) {
  const { risk } = composition.authorities;
  risk.registerScreeningList({ listId: 'sanctions', version: 1, entries: [] }, when);
  const subject = subjectComplianceData({
    subjectId,
    subjectKind,
    countFacts: [{ name: 'rails', count: 1 }],
  });
  const check = await risk.evaluateAndRecordCheck(subject, 'sanctions', when);
  const decided = await risk.decideCheck(check.checkId, when);
  assert.equal(decided.state, 'APPROVED', `the gate check for ${subjectId} must be APPROVED`);
  return decided;
}

// ---------------------------------------------------------------------------
// Scenario 0 — [test:family-barrel]
// ---------------------------------------------------------------------------

async function scenarioFamilyBarrel() {
  const names = Object.keys(operations);
  assert.ok(names.length >= 25, `the operations barrel exports the composed surface (found ${names.length} exports)`);
  const required = [
    'OPERATIONS_EVENT_OWNER', 'OPERATIONS_EVENT_TYPES', 'parseOperationalJobPayload',
    'operationalCommandIdempotencyKey', 'submitJobCommand', 'operationalJobHandler',
    'RECONCILIATION_SWEEP_JOB_KIND', 'CLEARING_PROGRESSION_JOB_KIND',
    'NETTING_SETTLEMENT_PROGRESSION_JOB_KIND', 'QUEUE_DRAIN_SUPPORT_JOB_KIND',
    'reconciliationSweepJob', 'clearingProgressionJob', 'nettingSettlementProgressionJob',
    'queueDrainSupportJob', 'OPERATIONAL_JOB_KINDS', 'OPERATIONAL_JOB_SCHEDULES',
    'registerOperationalJobs', 'operationalJobIdempotencyKey', 'enqueueOperationalJob',
    'wireOperationalJobScheduler', 'readOperationalJobProgress',
    'reconciliationCycleIdForWindow',
  ];
  const missing = required.filter((name) => !(name in operations));
  assert.deepEqual(missing, [], 'the operations barrel must export every family entry point');

  // The scheduler wiring follows the scheduler-wiring precedent: the
  // payloadFn is a pure function of the tick identity (deterministic
  // payloads; commands/jobs only, never state).
  const scheduled = [];
  const stubSubstrate = {
    scheduleRecurring(kind, payloadFn, intervalMs, options) {
      scheduled.push({ kind, intervalMs, options });
      return {
        stop() {},
        tickOnce: () => ({ created: true }),
      };
    },
  };
  const wired = wireOperationalJobScheduler(stubSubstrate);
  assert.equal(wired.length, 4, 'four recurring operational-job schedules');
  assert.deepEqual(
    wired.map((schedule) => schedule.config.jobKind),
    [...operations.OPERATIONAL_JOB_KINDS],
    'the wired schedules cover the four duties',
  );
  // Determinism of the trigger payloads: the same tick identity always
  // produces the same payload (the scheduler-wiring precedent's rule).
  const sample = scheduled[0];
  assert.ok(sample.kind.startsWith('operations.'), 'the scheduled kinds are the operations.* job kinds');
  assert.ok(typeof sample.options.scheduleId === 'string' && sample.options.scheduleId.length > 0);

  // The idempotency-key discipline is deterministic per (job, cycle, subject).
  const keyA = operations.operationalCommandIdempotencyKey(CLEARING_PROGRESSION_JOB_KIND, 4, 'ops-batch-4', 'clearing.batch.open');
  const keyB = operations.operationalCommandIdempotencyKey(CLEARING_PROGRESSION_JOB_KIND, 4, 'ops-batch-4', 'clearing.batch.open');
  const keyC = operations.operationalCommandIdempotencyKey(CLEARING_PROGRESSION_JOB_KIND, 5, 'ops-batch-4', 'clearing.batch.open');
  assert.equal(keyA, keyB, 'the same (job, cycle, subject, kind) derives the same key');
  assert.notEqual(keyA, keyC, 'a different cycle derives a different key (fresh work, fresh key)');

  // The job payload parser rejects malformed payloads loudly.
  assert.throws(() => operations.parseOperationalJobPayload({ cycle: -1, windowStartWallMs: 0, windowEndWallMs: 1 }));
  assert.throws(() => operations.parseOperationalJobPayload('nonsense'));

  return [
    `exports:${names.length}`,
    'schedules:4:deterministic',
    `key:${keyA.slice(0, 14)}`,
  ];
}

// ---------------------------------------------------------------------------
// The operations golden path (scenario 1 / 5 / 6 share the runner)
// ---------------------------------------------------------------------------

/**
 * THE operations golden path: the clearing job's window-batch lifecycle
 * (open → stage → commit → finalize, records staged by the harness fixture
 * on the owning authority — the composed-journey precedent for the
 * un-hosted clearing.record.add), the netting job's cohort progression
 * (open → compute → commit), the settlement job's net-position progression
 * (instruction → authorize → submit), and finality advanced by the
 * AUTHORITY (the harness's report-ingestion + declareFinality fixtures —
 * the composed-journey precedent) — never by the job (asserted).
 */
async function runOperationsGoldenPath(options = {}) {
  // The deterministic identity chain, computable up front (fixed inputs):
  // the netting set label → the two net obligations (alpha→gamma 4_000,
  // beta→gamma 1_000) → their instructions (ordinal 1) → the rail keys.
  const SET_LABEL = 'ops-net-1';
  const setId = nettingSetIdForLabel(SET_LABEL);
  const netObligationIds = [
    netObligationIdFor(setId, 'alpha', 'gamma', 'EUR'),
    netObligationIdFor(setId, 'beta', 'gamma', 'EUR'),
  ];
  const instructionIds = netObligationIds.map((netObligationId) =>
    settlementInstructionIdFor({ kind: 'NET_POSITION', netObligationId }, 1),
  );
  const railKeys = instructionIds.map((instructionId) => railIdempotencyKeyForInstruction(instructionId));
  const defaultRailScript = Object.fromEntries(railKeys.map((key) => [key, 'ACCEPT_REPORT_CONFIRMED']));
  const composition = await composeOperationsRuntime({
    railScript: options.railScript ?? defaultRailScript,
  });
  const transcript = [];
  const note = (step) => transcript.push(step);
  const { authorities, rails } = composition;

  // --- (0) the rail adapter — registered + activated VIA THE GATEWAY (the
  //     harness fixture path; the settlement attempts ride this adapter). ---
  await submitViaGateway(composition, 'rails.adapter.register', 'Rail Authority', { railFamily: 'sim-bank', name: 'primary' }, 'dep004-adapter-1');
  await submitViaGateway(composition, 'rails.adapter.activate', 'Rail Authority', { adapterId: composition.adapterId }, 'dep004-adapter-2', [composition.adapterId]);
  note('adapter:ACTIVE');

  // --- (1) THE CLEARING JOB: the window batch lifecycle across four runs
  //     (the lookback sweep advances the prior cycles' batches; one
  //     progression command per batch per run — the restart discipline). ---
  const BATCH_LABEL = 'ops-batch-4';
  const batchId = clearingBatchId(BATCH_LABEL);
  const window = (cycle) => [cycle * 1_000, cycle * 1_000 + 1_000];

  await runJob(composition, CLEARING_PROGRESSION_JOB_KIND, 4, ...window(4));
  assert.equal(authorities.clearing.batch(batchId)?.state, 'OPEN', 'run 4 opened the window batch');
  note('batch:OPEN');

  // The DUPLICATE-JOB discipline (level 1 — the trigger): re-triggering the
  // SAME cycle is absorbed by the substrate dedupe (no second job row).
  const duplicateTrigger = triggerJob(composition, CLEARING_PROGRESSION_JOB_KIND, 4, ...window(4));
  assert.equal(duplicateTrigger.created, false, 'the same-cycle re-trigger is deduplicated by the substrate');
  assert.equal(duplicateTrigger.reason, 'deduplicated');
  note('duplicate-trigger:deduplicated');

  // The clearing records: staged by the HARNESS on the owning authority's
  // command surface (the composed-journey precedent — clearing.record.add
  // is gateway-admitted but un-hosted, defect D-2).
  for (const entry of GROSS) {
    const staged = await authorities.clearing.addRecord(batchId, {
      origin: { originActivityId: `activity-${entry.id}`, originKind: 'INTENT' },
      parties: { debtorParticipantId: entry.debtor, creditorParticipantId: entry.creditor },
      amount: EUR(entry.amount),
      reason: 'DEP-004 operations golden path fixture',
    });
    assert.equal(staged.ok, true, `clearing record ${entry.id} must stage`);
  }
  note('records:4:staged');

  await runJob(composition, CLEARING_PROGRESSION_JOB_KIND, 5, ...window(5));
  assert.equal(authorities.clearing.batch(batchId)?.state, 'STAGED', 'run 5 staged the window batch');
  note('batch:STAGED');
  await runJob(composition, CLEARING_PROGRESSION_JOB_KIND, 6, ...window(6));
  assert.equal(authorities.clearing.batch(batchId)?.state, 'COMMITTED', 'run 6 committed the window batch');
  note('batch:COMMITTED');
  await runJob(composition, CLEARING_PROGRESSION_JOB_KIND, 7, ...window(7));
  assert.equal(authorities.clearing.batch(batchId)?.state, 'FINAL', 'run 7 finalized the window batch');
  note('batch:FINAL');

  // The commit flowed the records to the A10 sink: four CREATED obligations.
  const obligationsList = authorities.obligations.obligations();
  assert.equal(obligationsList.length, 4);
  assert.equal(obligationsList.every((record) => record.state === 'CREATED'), true);
  assert.equal(countType(composition, 'OBLIGATION_CREATED'), 4);
  note('obligations:4:CREATED');

  // --- (2) THE NETTING-SETTLEMENT JOB: cohort open → compute → commit,
  //     then the net-position settlement support. ---
  await runJob(composition, NETTING_SETTLEMENT_PROGRESSION_JOB_KIND, 1, ...window(1));
  assert.equal(authorities.netting.nettingSet(setId)?.state, 'OPEN', 'run 1 opened the cohort set');
  note('net:OPEN');
  await runJob(composition, NETTING_SETTLEMENT_PROGRESSION_JOB_KIND, 2, ...window(2));
  assert.equal(authorities.netting.nettingSet(setId)?.state, 'COMPUTED', 'run 2 computed the cohort set');
  note('net:COMPUTED');
  await runJob(composition, NETTING_SETTLEMENT_PROGRESSION_JOB_KIND, 3, ...window(3));
  assert.equal(authorities.netting.nettingSet(setId)?.state, 'COMMITTED', 'run 3 committed the cohort set');
  note('net:COMMITTED');
  const netObligations = authorities.netting.netObligationsOfSet(setId);
  assert.equal(netObligations.length, 2, 'the gross set nets to two positions');
  assert.equal(netObligations.reduce((acc, entry) => acc + entry.amount.amountMinor, 0), 5_000);
  assert.equal(obligationsList.every(() => true), true);
  assert.equal(
    authorities.obligations.obligations().every((record) => record.state === 'NETTED'),
    true,
    'the gross obligations were replaced by the net positions',
  );
  note('netpositions:2:sums:5000');

  // --- (3) the settlement support: instruction → authorize → submit (the
  //     job's progression duty; three runs — one command per subject per
  //     run). The rail script (the caller's) decides the outcomes. ---
  await runJob(composition, NETTING_SETTLEMENT_PROGRESSION_JOB_KIND, 4, ...window(4));
  const instructions = authorities.settlement.listInstructions();
  assert.equal(instructions.length, 2, 'run 4 created the two net-position instructions');
  assert.equal(instructions.every((instruction) => instruction.state === 'CREATED'), true);
  note('instructions:2:CREATED');
  await runJob(composition, NETTING_SETTLEMENT_PROGRESSION_JOB_KIND, 5, ...window(5));
  assert.equal(
    authorities.settlement.listInstructions().every((instruction) => instruction.state === 'ISSUED'),
    true,
    'run 5 authorized the attempts (the instructions are ISSUED)',
  );
  note('attempts:AUTHORIZED');
  await runJob(composition, NETTING_SETTLEMENT_PROGRESSION_JOB_KIND, 6, ...window(6));
  const attempts = authorities.settlement.listAttempts();
  assert.equal(attempts.length, 2);
  for (const attempt of attempts) {
    assert.equal(attempt.state, options.expectedAttemptState ?? 'PENDING', 'run 6 submitted the attempts');
  }
  note(`attempts:2:${options.expectedAttemptState ?? 'PENDING'}`);

  return { transcript, composition };
}

/**
 * Complete the golden path's settlement: the report ingestion + finality —
 * the AUTHORITY's own commands, driven by the HARNESS (the composed-journey
 * precedent: settlement.report.apply / settlement.finality.declare are
 * gateway-admitted but un-hosted — defect D-2; the job NEVER submits them,
 * asserted on the journal). Finality advances exactly once per subject.
 */
async function completeGoldenSettlement(composition, transcript, note) {
  const instructions = composition.authorities.settlement.listInstructions();
  for (const instruction of instructions) {
    const attempt = composition.authorities.settlement.attemptForInstruction(instruction.instructionId);
    assert.ok(attempt !== undefined);
    const railKey = railIdempotencyKeyForInstruction(instruction.instructionId);
    const report = composition.connection.fetchReport(railKey);
    assert.equal(report.outcomeClass, 'CONFIRMED', 'the scripted rail reports CONFIRMED');
    const recorded = composition.rails.railAuthority.recordReport(attempt.operationId, report);
    assert.equal(recorded.ok, true);
    const mirrored = await composition.authorities.settlement.applyRailOutcome(instruction.instructionId);
    assert.equal(mirrored.ok, true);
    assert.equal(mirrored.ok ? mirrored.value.attempt.state : '', 'CONFIRMED');
    // FINALITY — the AUTHORITY's own command (never the job's):
    const declared = await composition.authorities.settlement.declareFinality(instruction.instructionId);
    assert.equal(declared.ok, true);
    assert.equal(declared.ok ? declared.value.state : '', 'FINAL');
    const again = await composition.authorities.settlement.declareFinality(instruction.instructionId);
    assert.equal(again.ok, false);
    assert.equal(again.code, 'FINALITY_ALREADY_DECLARED');
  }
  const settled = composition.authorities.netting
    .listNetObligations()
    .every((netObligation) => netObligation.state === 'SETTLED');
  assert.equal(settled, true, 'finality advanced both net positions to SETTLED');
  note('finality:FINAL:SETTLED:2');
  void transcript;
}

// ---------------------------------------------------------------------------
// Scenario 1 — [test:clearing-netting-settlement]
// ---------------------------------------------------------------------------

async function scenarioGoldenPath() {
  const { transcript, composition } = await runOperationsGoldenPath({});
  const note = (step) => transcript.push(step);
  await completeGoldenSettlement(composition, transcript, note);

  // THE FINALITY BOUNDARY (the acceptance criterion): the job NEVER
  // asserted finality — its journal contains no finality/report/resolution
  // command submission of any kind.
  const commands = journalCommands(composition);
  const jobCommandKinds = new Set(commands.map((event) => event.data.commandKind));
  for (const forbidden of [
    'settlement.finality.declare',
    'settlement.attempt.railoutcome.apply',
    'settlement.resolution.apply',
    'reconciliation.case.resolve',
  ]) {
    assert.equal(jobCommandKinds.has(forbidden), false, `the job never submits ${forbidden}`);
  }
  assert.deepEqual(
    [...jobCommandKinds].sort(),
    [
      'clearing.batch.commit',
      'clearing.batch.finalize',
      'clearing.batch.open',
      'clearing.batch.stage',
      'netting.set.commit',
      'netting.set.compute',
      'netting.set.open',
      'settlement.attempt.authorize',
      'settlement.attempt.submit',
      'settlement.instruction.create',
    ],
    'the job family emitted exactly the progression kinds',
  );
  note('job-kinds:progression-only');

  // Every executable job command has an authority-owned observation row.
  const observations = executedObservations(composition);
  const jobCommandJobIds = new Set(commands.map((event) => event.data.commandJobId));
  const observed = observations.filter((row) => jobCommandJobIds.has(row.jobId));
  assert.equal(observed.length, commands.length, 'every job-submitted executable command was executed exactly once');
  assert.equal(observed.every((row) => row.status === 'applied'), true, 'every execution applied');
  note('observations:applied');

  // The whole run verifies (the chain hash) — the audit evidence.
  const verification = composition.log.verifyAndRecord(composition.wall + 1);
  assert.equal(verification.verdict, 'VERIFIED');
  note(`chain:${verification.verdict}`);

  await composition.close();
  return transcript;
}

// ---------------------------------------------------------------------------
// Scenario 2 — [test:unknown-reconciliation]
// ---------------------------------------------------------------------------

async function scenarioUnknownReconciliation() {
  // The net-position instruction ids are deterministic: the two net
  // positions alpha→gamma (4_000) and beta→gamma (1_000).
  const SET_LABEL = 'ops-net-1';
  const setId = nettingSetIdForLabel(SET_LABEL);
  const netObligationIds = [
    netObligationIdFor(setId, 'alpha', 'gamma', 'EUR'),
    netObligationIdFor(setId, 'beta', 'gamma', 'EUR'),
  ];
  const instructionIds = netObligationIds.map((netObligationId) =>
    settlementInstructionIdFor({ kind: 'NET_POSITION', netObligationId }, 1),
  );
  const railKeys = instructionIds.map((instructionId) => railIdempotencyKeyForInstruction(instructionId));
  // BOTH rail transmissions time out: the UNKNOWN discipline is exercised
  // on every settlement subject.
  const railScript = {
    [railKeys[0]]: 'TRANSMIT_TIMEOUT',
    [railKeys[1]]: 'TRANSMIT_TIMEOUT',
  };

  const statementProviderCalls = [];
  const composition = await composeOperationsRuntime({
    railScript,
    statementProvider: (window) => {
      statementProviderCalls.push(window);
      return [];
    },
  });
  const transcript = [];
  const note = (step) => transcript.push(step);
  const { authorities, rails } = composition;

  // (0) the adapter + the golden pipeline up to the submissions.
  await submitViaGateway(composition, 'rails.adapter.register', 'Rail Authority', { railFamily: 'sim-bank', name: 'primary' }, 'dep004-unknown-adapter-1');
  await submitViaGateway(composition, 'rails.adapter.activate', 'Rail Authority', { adapterId: composition.adapterId }, 'dep004-unknown-adapter-2', [composition.adapterId]);
  const BATCH_LABEL = 'ops-batch-4';
  const batchId = clearingBatchId(BATCH_LABEL);
  const window = (cycle) => [cycle * 1_000, cycle * 1_000 + 1_000];
  await runJob(composition, CLEARING_PROGRESSION_JOB_KIND, 4, ...window(4));
  for (const entry of GROSS) {
    await authorities.clearing.addRecord(batchId, {
      origin: { originActivityId: `activity-${entry.id}`, originKind: 'INTENT' },
      parties: { debtorParticipantId: entry.debtor, creditorParticipantId: entry.creditor },
      amount: EUR(entry.amount),
      reason: 'DEP-004 UNKNOWN-path fixture',
    });
  }
  await runJob(composition, CLEARING_PROGRESSION_JOB_KIND, 5, ...window(5));
  await runJob(composition, CLEARING_PROGRESSION_JOB_KIND, 6, ...window(6));
  await runJob(composition, CLEARING_PROGRESSION_JOB_KIND, 7, ...window(7));
  assert.equal(authorities.clearing.batch(batchId)?.state, 'FINAL');
  note('batch:FINAL');
  await runJob(composition, NETTING_SETTLEMENT_PROGRESSION_JOB_KIND, 1, ...window(1));
  await runJob(composition, NETTING_SETTLEMENT_PROGRESSION_JOB_KIND, 2, ...window(2));
  await runJob(composition, NETTING_SETTLEMENT_PROGRESSION_JOB_KIND, 3, ...window(3));
  assert.equal(authorities.netting.nettingSet(setId)?.state, 'COMMITTED');
  note('net:COMMITTED');
  await runJob(composition, NETTING_SETTLEMENT_PROGRESSION_JOB_KIND, 4, ...window(4));
  await runJob(composition, NETTING_SETTLEMENT_PROGRESSION_JOB_KIND, 5, ...window(5));

  // (1) THE UNKNOWN LANDING: both attempts land UNKNOWN (the durable
  //     UNKNOWN state — the instruction stays ISSUED, the net position
  //     stays SETTLEMENT_PENDING), and the INV-14-1 auto-case opens for
  //     each (the PROTOCOL'S OWN reconciliation engagement — no job
  //     action involved: the oracle's semantics).
  await runJob(composition, NETTING_SETTLEMENT_PROGRESSION_JOB_KIND, 6, ...window(6));
  const attempts = authorities.settlement.listAttempts();
  assert.equal(attempts.length, 2);
  for (const attempt of attempts) {
    assert.equal(attempt.state, 'UNKNOWN', 'the scripted transmission lands UNKNOWN');
    assert.ok(attempt.reconciliationCaseId !== undefined, 'the INV-14-1 auto-case is recorded on the attempt');
    const caseRecord = rails.reconciliation.getCase(attempt.reconciliationCaseId ?? '');
    assert.ok(caseRecord !== undefined);
    assert.equal(caseRecord.status, 'OPEN');
    const instruction = authorities.settlement.instruction(attempt.instructionId);
    assert.equal(instruction?.state, 'ISSUED', 'the instruction stays ISSUED (GC-2)');
  }
  assert.equal(
    authorities.netting.listNetObligations().every((netObligation) => netObligation.state === 'SETTLEMENT_PENDING'),
    true,
    'the net positions stay SETTLEMENT_PENDING (GC-2)',
  );
  note('attempts:2:UNKNOWN');
  note('autocases:2:OPEN');

  // (2) THE SETTLEMENT JOB'S NEVER-RETRY DISCIPLINE: the next run audits
  //     the UNKNOWN-held observations and submits NOTHING for them.
  const journalBefore = journalCommands(composition).length;
  await runJob(composition, NETTING_SETTLEMENT_PROGRESSION_JOB_KIND, 7, ...window(7));
  const heldRows = jobJournal(composition).filter((event) => event.type === 'operations.unknown.held');
  assert.equal(heldRows.length, 2, 'the job audited both UNKNOWN-held subjects');
  for (const row of heldRows) {
    assert.ok(typeof row.data.caseId === 'string', 'the held audit names the INV-14-1 case');
  }
  assert.equal(journalCommands(composition).length, journalBefore, 'the run submitted no commands (never a retry)');
  note('held:audited:no-retry');

  // (3) THE PROTOCOL'S OWN CONCURRENCY CONTROLS refuse the blind retry
  //     (the acceptance criterion's backstop — demonstrated on the owning
  //     authority's command surface): a second attempt authorization is
  //     refused LIVE_ATTEMPT_EXISTS and finality is blocked UNKNOWN_HELD.
  for (const attempt of attempts) {
    const second = await authorities.settlement.authorizeAttempt(attempt.instructionId, composition.adapterId);
    assert.equal(second.ok, false);
    assert.equal(second.code, 'LIVE_ATTEMPT_EXISTS');
    const blocked = await authorities.settlement.declareFinality(attempt.instructionId);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'UNKNOWN_HELD');
  }
  note('blind-retry:REFUSED:LIVE_ATTEMPT_EXISTS');
  note('finality:BLOCKED:UNKNOWN_HELD');

  // (4) THE RECONCILIATION SWEEP — the A14 path trigger (the work order's
  //     UNKNOWN discipline): source registration EXECUTES; the cycle-open
  //     and case-investigate submissions are admitted (recorded receipts)
  //     and sit queued — the honest D-2 vocabulary-gap status, asserted.
  const sweepWindow = { windowStartWallMs: 10_000, windowEndWallMs: 20_000 };
  const sweepCycleId = reconciliationCycleIdForWindow(sweepWindow.windowStartWallMs, sweepWindow.windowEndWallMs, 1);
  await runJob(composition, RECONCILIATION_SWEEP_JOB_KIND, 1, sweepWindow.windowStartWallMs, sweepWindow.windowEndWallMs);
  const sources = rails.reconciliation.listSources();
  assert.equal(sources.length, 1, 'the sweep registered the statement source (EXECUTED)');
  note('source:registered');
  const sweepCommands = journalCommands(composition).filter((event) => event.data.jobKind === RECONCILIATION_SWEEP_JOB_KIND);
  const sweepKinds = sweepCommands.map((event) => event.data.commandKind);
  assert.equal(sweepKinds.filter((kind) => kind === 'reconciliation.source.register').length, 1);
  assert.equal(sweepKinds.filter((kind) => kind === 'reconciliation.cycle.open').length, 1, 'the sweep submitted the cycle-open command');
  assert.equal(sweepKinds.filter((kind) => kind === 'reconciliation.case.investigate').length, 2, 'the sweep submitted the investigation trigger for both OPEN auto-cases');
  for (const event of sweepCommands) {
    assert.equal(event.data.ok, true, 'every A14 submission was admitted');
  }
  // The D-2 honesty assertion: the un-hosted kinds' durable jobs sit
  // queued (the worker reserves only registered kinds — the recorded
  // composition defect, asserted never silently passed over).
  for (const event of sweepCommands) {
    const commandJob = composition.durableRuntime.queue.getJob(event.data.commandJobId);
    assert.ok(commandJob !== null);
    if (event.data.commandKind === 'reconciliation.source.register') {
      assert.equal(commandJob.status, 'succeeded', 'source.register executed end-to-end');
    } else {
      assert.equal(commandJob.status, 'queued', `${event.data.commandKind} sits queued (the D-2 vocabulary gap — recorded, not hidden)`);
    }
  }
  note('a14:admitted:cycle.open+case.investigate:queued-D2');

  // (5) The sweep's collect derivation (exercised against a real OPEN
  //     cycle — the harness pre-opens the cycle on the owning authority's
  //     command surface, the D-2 workaround fixture): the next sweep run
  //     derives statements.collect with the configured provider's feed.
  const opened = rails.reconciliation.openCycle({
    windowStartWallMs: sweepWindow.windowStartWallMs,
    windowEndWallMs: sweepWindow.windowEndWallMs,
    sourceIds: sources.map((source) => source.sourceId),
    ruleVersion: 1,
  });
  assert.equal(opened.ok, true, 'the fixture opened the window cycle (the D-2 workaround)');
  const cycle = rails.reconciliation.getCycle(sweepCycleId);
  assert.equal(cycle?.status, 'OPEN');
  await runJob(composition, RECONCILIATION_SWEEP_JOB_KIND, 2, sweepWindow.windowStartWallMs, sweepWindow.windowEndWallMs);
  const collectCommands = journalCommands(composition).filter(
    (event) => event.data.jobKind === RECONCILIATION_SWEEP_JOB_KIND && event.data.commandKind === 'reconciliation.cycle.statements.collect',
  );
  assert.equal(collectCommands.length, 1, 'the sweep derived the collect step for the OPEN cycle');
  assert.equal(collectCommands[0].data.ok, true);
  assert.equal(statementProviderCalls.length, 1, 'the statement provider fed the collect derivation (job INPUT)');
  note('cycle:collect:derived');

  // (6) THE ORACLE'S COMPLETION — through authority-direct fixtures (the
  //     composed-journey D-2 precedent): investigation, the terminal
  //     resolution, the recovery directive's application, and finality —
  //     NONE of them job actions (the job's journal is asserted clean of
  //     every judgment kind below).
  for (const attempt of attempts) {
    const caseId = attempt.reconciliationCaseId ?? '';
    assert.equal(rails.reconciliation.investigateCase(caseId).ok, true);
    const resolved = rails.reconciliation.resolveCase(caseId, {
      resolution: 'RESOLVED_CONFIRMED',
      proof: { externalRefs: [`bank-statement-dep004-${caseId}`] },
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.ok ? resolved.value.recovery.feed : '', 'AREA_12_FINALITY_ADVANCE');
    const resumed = await authorities.settlement.applyResolution(
      resolved.ok ? resolved.value.recovery : null,
      caseId,
    );
    assert.equal(resumed.ok, true);
    const declared = await authorities.settlement.declareFinality(attempt.instructionId);
    assert.equal(declared.ok, true);
    assert.equal(declared.ok ? declared.value.state : '', 'FINAL');
  }
  assert.equal(
    authorities.netting.listNetObligations().every((netObligation) => netObligation.state === 'SETTLED'),
    true,
    'the recovery advanced both net positions to SETTLED',
  );
  note('resolution:RESOLVED_CONFIRMED:finality:FINAL:SETTLED');

  // THE JOB-BOUNDARY ASSERTION: the job family's journal contains NO
  // resolution, NO recovery application, NO finality — the judgment kinds
  // are the authority's/operator's, never the job's.
  const jobCommandKinds = new Set(journalCommands(composition).map((event) => event.data.commandKind));
  for (const forbidden of ['reconciliation.case.resolve', 'settlement.resolution.apply', 'settlement.finality.declare']) {
    assert.equal(jobCommandKinds.has(forbidden), false, `the job never submits ${forbidden}`);
  }
  note('job-boundary:judgment-never');

  // The whole UNKNOWN-path log verifies.
  const verification = composition.log.verifyAndRecord(composition.wall + 1);
  assert.equal(verification.verdict, 'VERIFIED');
  note(`chain:${verification.verdict}`);

  await composition.close();
  return transcript;
}

// ---------------------------------------------------------------------------
// Scenario 3 — [test:restart-safety]
// ---------------------------------------------------------------------------

async function scenarioRestartSafety() {
  const composition = await composeOperationsRuntime({});
  const transcript = [];
  const note = (step) => transcript.push(step);
  const { durableRuntime, wiring } = composition;
  const BATCH_LABEL = 'ops-restart-batch-1';
  const batchId = clearingBatchId(BATCH_LABEL);
  const jobKind = CLEARING_PROGRESSION_JOB_KIND;
  const payload = { cycle: 1, windowStartWallMs: 1_000, windowEndWallMs: 2_000 };

  // Override the label prefix for this composition's clearing job? The
  // composition's config uses 'ops-batch-'. To address a dedicated batch,
  // this scenario uses the same prefix: the target batch is 'ops-batch-1'.
  const targetBatchId = clearingBatchId('ops-batch-1');

  // --- PART A: the same-key replay (the harmless duplicate execution). ---
  // A dying worker reserves the job and executes the atomic unit (the job
  // run submits the open command + the audit rows) — then "dies" (never
  // completes the job). The open command sits QUEUED.
  const trigger = enqueueOperationalJob(composition.jobSubstrate, jobKind, payload);
  assert.equal(trigger.created, true);
  const reserved = durableRuntime.queue.reserve('dying-worker', LEASE_MS, { kind: jobKind });
  assert.equal(reserved.id, trigger.job.id, 'the dying worker reserved the admitted job');
  const handler = wiring.handlerFor(jobKind);
  assert.ok(handler !== undefined);
  await handler(reserved); // the atomic unit commits; the worker "dies"
  const openAdmissions = journalCommands(composition).filter(
    (event) => event.data.commandKind === 'clearing.batch.open' && event.data.created === true,
  );
  assert.equal(openAdmissions.length, 1, 'the dying run submitted the open command exactly once (created)');
  const openCommandJobId = openAdmissions[0].data.commandJobId;
  assert.equal(durableRuntime.queue.getJob(openCommandJobId).status, 'queued', 'the open command sits queued (nothing drained)');
  note('dying-run:open:submitted');

  // The lease expires; the job is reclaimed; a revived worker re-executes
  // the SAME job (the at-least-once redelivery) — BEFORE the open command
  // executes, so the re-derivation sees the batch still absent and
  // re-submits with the SAME key: the gateway returns the RECORDED receipt
  // (replayed) — never a second effect.
  await sleep(LEASE_MS + 40);
  const reclaimed = durableRuntime.queue.reclaimExpired();
  assert.equal(reclaimed.reclaimed, 1, 'the expired lease was reclaimed');
  const redelivered = durableRuntime.queue.reserve('revived-worker', LEASE_MS, { kind: jobKind });
  assert.equal(redelivered.id, trigger.job.id, 'the redelivered job is the SAME durable job');
  await handler(redelivered); // the re-execution: re-derive → re-submit the SAME key
  const replayAdmissions = journalCommands(composition).filter(
    (event) => event.data.commandKind === 'clearing.batch.open' && event.data.replayed === true,
  );
  assert.equal(replayAdmissions.length, 1, 'the re-execution re-submitted the SAME key (replayed receipt)');
  assert.equal(replayAdmissions[0].data.idempotencyKey, openAdmissions[0].data.idempotencyKey, 'the SAME idempotency key');
  const stats = durableRuntime.queue.stats();
  assert.equal(stats.queued, 1, 'exactly ONE open command exists on the queue — no second effect');
  note('re-execution:same-key:replayed');

  // Complete the redelivered job through the worker (the substrate's own
  // completion path) and drain: the open command executes ONCE.
  await durableRuntime.queue.complete(redelivered.id, 'revived-worker');
  await drain(composition);
  assert.equal(composition.authorities.clearing.batch(targetBatchId)?.state, 'OPEN', 'the batch opened exactly once');
  const job = durableRuntime.queue.getJob(trigger.job.id);
  assert.equal(job.status, 'succeeded');
  note('batch:OPEN:once');

  // --- PART B: the substrate-level redelivery cycle (the full restart). ---
  // A second dying-worker round on the next cycle: reserve → execute (the
  // stage submission) → die → the LEASE-EXPIRY path through the REAL
  // worker (tick's reclaimExpired → re-reserve → re-execute → complete).
  const trigger2 = enqueueOperationalJob(composition.jobSubstrate, jobKind, { cycle: 2, windowStartWallMs: 2_000, windowEndWallMs: 3_000 });
  const reserved2 = durableRuntime.queue.reserve('dying-worker-2', LEASE_MS, { kind: jobKind });
  assert.equal(reserved2.id, trigger2.job.id);
  await handler(reserved2); // submits the stage command (the batch is OPEN now)
  const stageAdmissions = journalCommands(composition).filter(
    (event) =>
      event.data.commandKind === 'clearing.batch.stage' &&
      event.data.subject === targetBatchId &&
      event.data.created === true,
  );
  assert.equal(stageAdmissions.length, 1, 'the dying run submitted the target batch stage command exactly once');
  await sleep(LEASE_MS + 40); // the lease expires — the job is redeliverable
  const dispatched = await drain(composition); // reclaim → re-reserve → the WORKER re-executes → completes
  assert.ok(dispatched >= 2, 'the drain dispatched the redelivered job and the queued commands');
  const job2 = durableRuntime.queue.getJob(trigger2.job.id);
  assert.equal(job2.status, 'succeeded', 'the redelivered job completed through the worker');
  assert.equal(job2.attempts, 1, 'one reclaim, one completion');

  // The progression cascade after the restart: the redelivered run
  // re-derived from the CURRENT authoritative state (the stage had
  // executed → it submitted the NEXT step) — zero double effects.
  const stageCount = journalCommands(composition).filter(
    (event) =>
      event.data.commandKind === 'clearing.batch.stage' &&
      event.data.subject === targetBatchId &&
      event.data.created === true,
  ).length;
  assert.equal(stageCount, 1, 'exactly one target-batch stage admission (created) across the restart');
  const batchState = composition.authorities.clearing.batch(targetBatchId)?.state;
  assert.ok(batchState === 'STAGED' || batchState === 'COMMITTED', `the batch progressed past staging (${batchState})`);
  note('restart:cascade:no-double-effect');

  // The whole log verifies after the restart cycle.
  const verification = composition.log.verifyAndRecord(composition.wall + 1);
  assert.equal(verification.verdict, 'VERIFIED');
  note(`chain:${verification.verdict}`);

  void BATCH_LABEL;
  void batchId;
  await composition.close();
  return transcript;
}

// ---------------------------------------------------------------------------
// Scenario 4 — [test:queue-drain-support]
// ---------------------------------------------------------------------------

async function scenarioQueueDrainSupport() {
  const composition = await composeOperationsRuntime({});
  const transcript = [];
  const note = (step) => transcript.push(step);
  const { authorities } = composition;
  const QUEUE_ID = 'ops-queue-eur';
  const window = (cycle, start) => [start, start + 1_000];

  // (1) The job creates the configured queue (EXECUTES end-to-end).
  await runJob(composition, QUEUE_DRAIN_SUPPORT_JOB_KIND, 1, ...window(1, 1_000));
  assert.equal(authorities.queues.queue(QUEUE_ID)?.state, 'OPEN', 'run 1 created the queue');
  note('queue:CREATED');

  // (2) The drain gate: the job submits queues.queue.drain.start —
  //     admitted, queued (the D-2 vocabulary gap — asserted honestly).
  await runJob(composition, QUEUE_DRAIN_SUPPORT_JOB_KIND, 2, ...window(2, 2_000));
  const drainStartCommands = journalCommands(composition).filter(
    (event) => event.data.commandKind === 'queues.queue.drain.start',
  );
  assert.equal(drainStartCommands.length, 1, 'the job submitted the drain gate');
  assert.equal(drainStartCommands[0].data.ok, true, 'the drain gate was admitted');
  const drainStartJob = composition.durableRuntime.queue.getJob(drainStartCommands[0].data.commandJobId);
  assert.equal(drainStartJob.status, 'queued', 'drain.start sits queued (D-2 — recorded, not hidden)');
  note('drain.start:admitted:queued-D2');

  // (3) HARNESS FIXTURES (the composed-journey precedent for un-hosted
  //     kinds): start draining directly; enqueue two items; register +
  //     activate a capability (compliance-gated through the REAL risk
  //     authority); open + fund a liquidity pool (the snapshot sources).
  assert.equal((await authorities.queues.startDraining(QUEUE_ID)).ok, true);
  const enqueueA = await authorities.queues.enqueueItem({
    queueId: QUEUE_ID,
    intentId: 'intent-ops-a',
    priorityClass: 1,
    terms: { intentId: 'intent-ops-a', terms: EUR(150_00) },
  });
  assert.equal(enqueueA.ok, true);
  composition.advanceWall(70_000); // item B is enqueued 70s later (the max-wait differentiator)
  const enqueueB = await authorities.queues.enqueueItem({
    queueId: QUEUE_ID,
    intentId: 'intent-ops-b',
    priorityClass: 0,
    terms: { intentId: 'intent-ops-b', terms: EUR(250_00) },
  });
  assert.equal(enqueueB.ok, true);
  note('items:2:QUEUED');
  const registered = await authorities.capability.registerCapability({
    capabilityId: 'cap-ops-eur',
    declaration: {
      railId: 'sim-bank',
      corridor: { sourceCurrency: 'EUR', sourceGeography: 'DE', destinationCurrency: 'EUR', destinationGeography: 'FR' },
      costSchedule: EUR(50),
      tier: 'standard',
    },
    declaredCapacity: EUR(500_00),
  });
  assert.equal(registered.ok, true);
  await approveGateSubject(composition, 'cap-ops-eur', 'CAPABILITY_REGISTRATION', protocolTime(2, 2_000));
  assert.equal((await authorities.capability.activateCapability('cap-ops-eur')).ok, true);
  assert.equal((await authorities.liquidity.openPool({ poolId: 'pool-ops-eur', currency: 'EUR', scale: 2 })).ok, true);
  assert.equal(
    (
      await authorities.liquidity.recordConfirmedFunding({
        poolId: 'pool-ops-eur',
        source: { kind: 'INTERNAL_TRANSFER', referenceId: 'treasury-seed' },
        amount: EUR(500_00),
      })
    ).ok,
    true,
  );
  note('fixtures:capability+pool:ACTIVE');

  // (4) THE JOB'S ELIGIBILITY + EXPIRY SWEEP: the snapshot is DERIVED from
  //     the authoritative reads (the A03 capability snapshot + the A06
  //     pool total). The eligibility evaluation EXECUTES (both items
  //     become ELIGIBLE — the derived snapshot satisfies the release
  //     conditions); the due-expiry submission is admitted and sits queued
  //     (the D-2 vocabulary gap: the hosted binding's kind name is
  //     queues.items.expire, the gateway catalogue's is
  //     queues.items.due.expire — asserted honestly), and the HARNESS
  //     completes the expiry sweep on the owning authority's command
  //     surface (the composed-journey precedent) with the SAME window
  //     time the job's queued submission carries: item A (enqueued at wall
  //     5_000, max wait 60_000) is expired at 66_000; item B (enqueued at
  //     75_000) is not.
  await runJob(composition, QUEUE_DRAIN_SUPPORT_JOB_KIND, 3, ...window(3, 66_000));
  const itemA = authorities.queues.item(
    // the deterministic item id: deriveProtocolId('queue-item', queueId, intentId)
    deriveProtocolId('queue-item', QUEUE_ID, 'intent-ops-a'),
  );
  const itemB = authorities.queues.item(deriveProtocolId('queue-item', QUEUE_ID, 'intent-ops-b'));
  assert.equal(itemA?.state, 'ELIGIBLE', 'the overdue item became ELIGIBLE (the job\'s eligibility sweep with the derived snapshot)');
  assert.equal(itemB?.state, 'ELIGIBLE', 'the fresh item became ELIGIBLE');
  assert.equal(countType(composition, 'ITEM_ELIGIBLE'), 2);
  note('eligibility:ELIGIBLE:2');

  // The journal's snapshot derivation evidence: the evaluate submission's
  // audit row + the executed observation (applied).
  const evaluateCommands = journalCommands(composition).filter(
    (event) => event.data.commandKind === 'queues.eligibility.evaluate',
  );
  assert.equal(evaluateCommands.length, 1);
  assert.equal(evaluateCommands[0].data.ok, true);
  const observations = executedObservations(composition).filter((row) => row.jobId === evaluateCommands[0].data.commandJobId);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].status, 'applied');
  note('evaluate:applied');

  // The due-expiry submission: admitted, queued (D-2 — asserted honestly).
  const expireCommands = journalCommands(composition).filter(
    (event) => event.data.commandKind === 'queues.items.due.expire',
  );
  assert.equal(expireCommands.length, 1, 'the job submitted the due-expiry sweep');
  assert.equal(expireCommands[0].data.ok, true, 'the due-expiry submission was admitted');
  const expireJob = composition.durableRuntime.queue.getJob(expireCommands[0].data.commandJobId);
  assert.equal(expireJob.status, 'queued', 'items.due.expire sits queued (D-2 — the hosted kind name is queues.items.expire)');
  note('expiry:admitted:queued-D2');

  // HARNESS FIXTURE (the composed-journey precedent): the expiry sweep on
  // the owning authority's command surface with the job's window time.
  const expired = await authorities.queues.expireDueItems({
    queueId: QUEUE_ID,
    at: { sequence: 3, wallMs: 66_000 },
  });
  assert.equal(expired.ok, true);
  assert.equal(expired.record.length, 1, 'the overdue item expired at the job\'s window time');
  assert.equal(authorities.queues.item(deriveProtocolId('queue-item', QUEUE_ID, 'intent-ops-a'))?.state, 'EXPIRED');
  assert.equal(authorities.queues.item(deriveProtocolId('queue-item', QUEUE_ID, 'intent-ops-b'))?.state, 'ELIGIBLE');
  assert.equal(countType(composition, 'ITEM_EXPIRED'), 1);
  note('expiry:EXPIRED');

  // The whole log verifies.
  const verification = composition.log.verifyAndRecord(composition.wall + 1);
  assert.equal(verification.verdict, 'VERIFIED');
  note(`chain:${verification.verdict}`);

  await composition.close();
  return transcript;
}

// ---------------------------------------------------------------------------
// Scenario 5 — [test:audit-evidence]
// ---------------------------------------------------------------------------

async function scenarioAuditEvidence() {
  const { composition } = await runOperationsGoldenPath({});
  const note = () => {}; // the transcript belongs to the golden-path runner
  const transcript = [];
  const append = (step) => transcript.push(step);

  // (a) The job-progress reader: the audit join over the journal + the
  //     execution observations + the run summaries.
  const progress = readOperationalJobProgress(composition.durableRuntime.database);
  assert.ok(progress.journal.length > 0, 'the jobs journal is non-empty');
  assert.equal(progress.commands.length, 19, `the audited commands are complete (${progress.commands.length})`);
  assert.equal(progress.runs.length, 10, `the run summaries are complete (${progress.runs.length})`);
  // Every journal command correlates to an admission outcome and — for
  // the executable kinds — to its protocol.command.executed observation.
  for (const command of progress.commands) {
    assert.equal(typeof command.idempotencyKey, 'string');
    assert.equal(command.ok, true, 'every golden-path submission was admitted');
    assert.equal(command.executionStatus, 'applied', 'every executable command was executed and applied');
  }
  const commandKinds = new Set(progress.commands.map((command) => command.commandKind));
  assert.deepEqual(
    [...commandKinds].sort(),
    [
      'clearing.batch.commit',
      'clearing.batch.finalize',
      'clearing.batch.open',
      'clearing.batch.stage',
      'netting.set.commit',
      'netting.set.compute',
      'netting.set.open',
      'settlement.attempt.authorize',
      'settlement.attempt.submit',
      'settlement.instruction.create',
    ],
    'the audited kind set is exactly the progression kinds',
  );
  append(`reader:commands:${progress.commands.length}`);
  append(`reader:runs:${progress.runs.length}`);

  // (b) Every consequential job action is evidenced in the A15 chain: the
  //     executed commands' authority records (BATCH_*, NETTING_*,
  //     SETTLEMENT_*) are present, and the chain verifies.
  for (const type of ['BATCH_STAGED', 'BATCH_COMMITTED', 'NETTING_SET_OPENED', 'NETTING_COMPUTED', 'NETTING_COMMITTED', 'SETTLEMENT_INSTRUCTION_CREATED', 'SETTLEMENT_ATTEMPT_AUTHORIZED']) {
    assert.ok(countType(composition, type) >= 1, `${type} is in the A15 chain (the job action's authority evidence)`);
  }
  append('a15:authority-records:present');

  // (c) The evidence store round-trips every record; the persisted chain
  //     verifies independently.
  for (const record of composition.log.records()) {
    writeEvidenceRecord(composition.stores.evidence, record);
  }
  const persisted = readEvidenceRecords(composition.stores.evidence);
  assert.equal(persisted.length, composition.log.records().length);
  const persistedVerification = verifyEvidenceChain(persisted);
  assert.equal(persistedVerification.verdict, 'VERIFIED');
  append('persisted:round-trip:VERIFIED');

  // (d) The full chain verifies over the whole operations run.
  const verification = composition.log.verifyAndRecord(composition.wall + 1);
  assert.equal(verification.verdict, 'VERIFIED');
  append(`chain:${verification.verdict}`);

  void note;
  await composition.close();
  return transcript;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

let failure = null;
const results = [];
try {
  const barrelTranscript = await scenarioFamilyBarrel();
  results.push(['test:family-barrel', barrelTranscript]);

  const goldenTranscript = await scenarioGoldenPath();
  results.push(['test:clearing-netting-settlement', goldenTranscript]);

  const unknownTranscript = await scenarioUnknownReconciliation();
  results.push(['test:unknown-reconciliation', unknownTranscript]);

  const restartTranscript = await scenarioRestartSafety();
  results.push(['test:restart-safety', restartTranscript]);

  const queueTranscript = await scenarioQueueDrainSupport();
  results.push(['test:queue-drain-support', queueTranscript]);

  const auditTranscript = await scenarioAuditEvidence();
  results.push(['test:audit-evidence', auditTranscript]);

  // [test:determinism] — the operations golden path runs twice; the
  // transcripts are identical (GC-1 over the jobs layer).
  const determinismA = await scenarioGoldenPath();
  const determinismB = await scenarioGoldenPath();
  assert.deepEqual(determinismB, determinismA);
  results.push(['test:determinism', [`${determinismA.length}-steps:identical`]]);

  console.log('DEP-004 operational-jobs harness: all checks green.');
  for (const [name, transcript] of results) {
    console.log(`  ${name}: ${transcript.join(' | ')}`);
  }
} catch (error) {
  failure = error;
  console.error('DEP-004 operational-jobs harness: FAILED.');
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
