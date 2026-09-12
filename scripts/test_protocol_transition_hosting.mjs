#!/usr/bin/env node
/**
 * payswap3 · RTN-011 — Transition runtime and authority hosting evidence
 * harness (the REAL DEP-003 substrate composition).
 *
 * Plain-Node evidence suite for the RTN-011 owned surfaces
 * (src/lib/protocol-runtime/transition/ + hosting/): the bun suites cover
 * the in-process semantics over the owned in-memory substrate double
 * (bun does not implement node:sqlite — the repository's documented
 * split); THIS harness binds the same transition runtime and hosted
 * bindings to the REAL substrate — real node:sqlite durable queue,
 * worker, lease reclaim, deterministic backoff, scheduler, and
 * durable_events — with commands enqueued through the substrate's PUBLIC
 * enqueue API (rtn-plan-rulings.md delta 5: this item's own test harness;
 * production admission remains exclusively RTN-010's gateway, whose
 * unmerged code this item never consumes).
 *
 * Spec sources (binding):
 *   spec/protocol-runtime-work-orders/RTN-011.md lines 14-26 — the
 *   acceptance matrix this harness proves end-to-end:
 *     - the dequeue → resolve-owning-authority-handler →
 *       apply-transition → write-A15-evidence → commit-atomically path,
 *       with the state transition + exactly one evidence record,
 *       atomically (a failed evidence write rolls back the transition);
 *     - duplicate delivery is a no-op returning recorded state (intent,
 *       reservation, obligation, and settlement command kinds);
 *     - crash/restart replay: kill-and-restart of the worker loop
 *       mid-execution produces no duplicate effects (lease reclaim +
 *       idempotency);
 *     - recurring-tick jobs emit commands only;
 *     - transition backlog depth/age + the INV-5-1/INV-6-1/INV-11-1
 *       consistency probes over persisted state;
 *     - the rails state machines advance only through the transition
 *       path (rtn-plan-rulings.md Q1 ruling, delta 1).
 *   spec/durable/execution.md §5-§13 (the substrate public contract).
 *
 * Scenarios:
 *   1. [test:e2e-command-path] — intent.submit through the public
 *      enqueue API: dequeue → resolve → apply → A15 evidence → commit;
 *      exactly one INTENT_CREATED record; the authority-owned
 *      durable_events observation row alongside the substrate lifecycle
 *      rows; enqueue dedupe.
 *   2. [test:e2e-four-kinds] — intent, reservation, obligation, and
 *      settlement command kinds through the path, with the per-domain
 *      durable write-through and read-backs over the real per-domain
 *      stores.
 *   3. [test:rails-single-writer] — the REAL RailsAdapterAuthority over
 *      the real RailsStore: adapter + operation state machines advance
 *      ONLY through the transition path (Q1/delta 1).
 *   4. [test:atomicity-rollback] — an induced A15 evidence-write failure
 *      rolls the transition back (no state, no record, no observation);
 *      the at-least-once redelivery after the heal commits exactly once.
 *   5. [test:duplicate-redelivery] — the four kinds through the REAL
 *      lease-expiry redelivery (reserve → execute → never complete →
 *      reclaimExpired → redeliver → replay → complete): no duplicate
 *      effects.
 *   6. [test:restart-lease-reclaim] — a REAL child process is killed
 *      mid-execution (after the atomic unit commits, before the job
 *      completes); the parent rehydrates the reservation ledger from the
 *      persisted entries, reclaims the expired lease, redelivers, and
 *      replays — the durable artifacts show exactly one effect.
 *   7. [test:scheduler-ticks] — the REAL scheduleRecurring: tickOnce
 *      emits exactly one command envelope (validated) and touches no
 *      authority state; the handler executes it through the path; the
 *      same tick never emits twice; a distinct tick emits a new command.
 *   8. [test:probes] — the transition backlog probe over the real queue
 *      and the three ledger-identity consistency probes over the
 *      persisted per-domain stores (including drift detection over a
 *      corrupted persisted row).
 *
 * Node-version note: requires Node.js >= 22.6 (node:sqlite + type
 * stripping); the harness self-configures the experimental flags on Node
 * builds that need them (same bootstrap as the merged RTN harnesses).
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const RUNTIME_DIR = join(ROOT, 'src', 'lib', 'protocol-runtime');
const MODULE_URL = (domain, name) => pathToFileURL(join(RUNTIME_DIR, domain, name)).href;
const DURABLE_URL = (name) => pathToFileURL(join(ROOT, 'src', 'lib', 'durable', name)).href;

const RESPAWN_ENV = 'PAYSWAP_RT11_TEST_RESPAWNED';
const tempDirs = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `payswap-rt11-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/**
 * Bootstrap (mirrors the merged RTN harnesses): probes node:sqlite
 * importability and .ts module loadability, re-executing this script
 * with the required experimental flags on Node builds that need them.
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
    console.error('node:sqlite / type stripping. The RTN-011 harness requires Node.js >= 22.6.');
    process.exit(1);
  }
  process.exit(typeof child.status === 'number' ? child.status : 1);
}

await ensureCapabilities();

// -- module loading (real .ts modules through Node type stripping) -----------

const { listRecentEvents } = await import(DURABLE_URL('events.ts'));
const {
  openTransitionSubstrate,
  asTransitionSubstrate,
  asSchedulerSubstrate,
  buildDurablePersistHooks,
  adaptRailEvidenceToRegistryNames,
} = await import(MODULE_URL('hosting', 'durable-binding.ts'));
const { createAuthorityCommandBindings, enqueueCommand } = await import(MODULE_URL('hosting', 'bindings.ts'));
const { createTransitionRuntime, COMMAND_EXECUTED_EVENT_TYPE } = await import(
  MODULE_URL('transition', 'execution.ts')
);
const { wireRecurringCommandEmitters, tickCommandEnvelope } = await import(
  MODULE_URL('hosting', 'scheduler-wiring.ts')
);
const {
  transitionBacklogSnapshot,
  probeReservationLedgerIdentity,
  probeLiquidityPoolIdentity,
  probeNettingConservation,
} = await import(MODULE_URL('hosting', 'probes.ts'));
const { createEvidenceLog } = await import(MODULE_URL('evidence', 'log.ts'));
const { openEvidenceStore, writeEvidenceRecord, readEvidenceRecords } = await import(
  MODULE_URL('evidence', 'persistence.ts')
);
const { openIntentStore, readPaymentIntents, readIntentReceipts } = await import(MODULE_URL('intent', 'persistence.ts'));
const {
  openReservationsStore,
  readLedgerEntries,
  readReservations,
  readResourceAccountings,
} = await import(MODULE_URL('reservations', 'persistence.ts'));
const { openReservationLedger } = await import(MODULE_URL('reservations', 'ledger.ts'));
const { readEntries: readObligationEntries } = await import(MODULE_URL('obligations', 'persistence.ts'));
const {
  readInstructions,
  readAttempts,
  readFinalities,
} = await import(MODULE_URL('settlement', 'persistence.ts'));
const { openRailsStore, openRailsAuthorities } = await import(MODULE_URL('rails', 'runtime.ts'));
const { readNettingSets, readNetObligations } = await import(MODULE_URL('netting', 'persistence.ts'));
const { settlementPortFromAuthorities, obligationLedgerPortFromAuthority, nettingPortFromAuthority } = await import(
  MODULE_URL('settlement', 'ports.ts')
);
const { IntentAuthority } = await import(MODULE_URL('intent', 'authority.ts'));
const { ObligationLedgerAuthority } = await import(MODULE_URL('obligations', 'authority.ts'));
const { NettingAuthority } = await import(MODULE_URL('netting', 'authority.ts'));
const { SettlementAuthority } = await import(MODULE_URL('settlement', 'authority.ts'));
const { ClearingAuthority } = await import(MODULE_URL('clearing', 'authority.ts'));
const { QueueAuthority } = await import(MODULE_URL('queues', 'authority.ts'));
const { openLiquidityStore, writePool, writePosition, readPools, readPositions } = await import(
  MODULE_URL('liquidity', 'persistence.ts')
);
const { LiquidityAuthority } = await import(MODULE_URL('liquidity', 'authority.ts'));
const { SimulatedRail, createSimulatedRailAdapter } = await import(MODULE_URL('rails', 'adapters.ts'));
const { validateCommandEnvelope } = await import(MODULE_URL('kernel', 'envelope.ts'));
const { deriveIdempotencyKey } = await import(MODULE_URL('kernel', 'identity.ts'));
const { protocolTime } = await import(MODULE_URL('kernel', 'time.ts'));
const { evaluateComplianceCheck } = await import(MODULE_URL('risk', 'evaluation.ts'));
const { decideComplianceCheck } = await import(MODULE_URL('risk', 'check.ts'));
const { createScreeningList } = await import(MODULE_URL('risk', 'screening.ts'));
const { subjectComplianceData } = await import(MODULE_URL('risk', 'subject.ts'));
const { evaluateComplianceGate } = await import(MODULE_URL('risk', 'gate.ts'));
const { obligationIdForOriginRecord } = await import(MODULE_URL('obligations', 'state-machine.ts'));
const {
  settlementInstructionIdFor,
  railIdempotencyKeyForInstruction,
} = await import(MODULE_URL('settlement', 'state-machine.ts'));

// -- shared composition -------------------------------------------------------

const LEASE_MS = 40;
const BACKOFF_BASE_MS = 10;

function intentApprovalGate() {
  const WHEN = protocolTime(10, 1_000);
  const LATER = protocolTime(11, 2_000);
  const approvedCheck = (subjectId) =>
    decideComplianceCheck(
      evaluateComplianceCheck({
        rules: [],
        screeningList: createScreeningList('sanctions', 1, []),
        subject: subjectComplianceData({
          subjectId,
          subjectKind: 'INTENT',
          moneyFacts: [{ currency: 'EUR', amountMinor: 1_000 }],
        }),
        evaluatedAt: WHEN,
      }),
      LATER,
    );
  return (subjectId) => evaluateComplianceGate([approvedCheck(subjectId)], 'intent.AUTHORIZATION', subjectId);
}

/** The A15 channel over the real log + the durable evidence store bridge. */
function evidenceChannelOverStore(log, store) {
  return {
    submit(record) {
      const before = log.height;
      log.submit(record);
      for (const written of log.records().slice(before)) {
        writeEvidenceRecord(store, written);
      }
    },
  };
}

function envelopeFor(kind, idempotencyKey, body, authority) {
  return {
    kind,
    authority,
    subjectIds: [],
    idempotencyKey,
    protocolTime: protocolTime(1, 5_000),
    body,
  };
}

function submitIntentBody(key) {
  return {
    amount: { currency: 'EUR', scale: 2, amountMinor: 2_500 },
    source: { currency: 'EUR', geography: 'DE', account: 'acct-alpha' },
    destination: { currency: 'EUR', geography: 'FR', account: 'acct-beta' },
    constraints: {
      deadlineEpochMs: 99_999_999,
      allowedRails: ['sim-bank'],
      costCeiling: { currency: 'EUR', scale: 2, amountMinor: 500 },
    },
    idempotencyKey: key,
  };
}

/**
 * Compose the FULL hosted runtime over the REAL substrate and the REAL
 * authorities (including the SQLite-authoritative rails authorities).
 */
async function composeHostedRuntime(options = {}) {
  const dir = options.dir ?? tempDir('composition');
  let wall = options.wall ?? 5_000;
  const clock = () => wall;
  const evidenceWallMs = options.evidenceWallMs ?? 1_000;
  const durableRuntime = openTransitionSubstrate({
    dbPath: join(dir, 'durable.sqlite'),
    workerId: options.workerId ?? 'rt11-harness-worker',
    concurrency: 1,
    leaseMs: options.leaseMs ?? LEASE_MS,
    pollIntervalMs: 5,
    backoffBaseMs: BACKOFF_BASE_MS,
    backoffMaxMs: 50,
  });
  const substrate = asTransitionSubstrate(durableRuntime);
  const schedulerSubstrate = asSchedulerSubstrate(durableRuntime);

  const intentStore = openIntentStore({ dbPath: join(dir, 'intent.sqlite') });
  const reservationsStore = openReservationsStore({ dbPath: join(dir, 'reservations.sqlite') });
  const obligationsStore = await import(MODULE_URL('obligations', 'persistence.ts')).then((m) =>
    m.openObligationsStore({ dbPath: join(dir, 'obligations.sqlite') }),
  );
  const settlementStore = await import(MODULE_URL('settlement', 'persistence.ts')).then((m) =>
    m.openSettlementStore({ dbPath: join(dir, 'settlement.sqlite') }),
  );
  const clearingStore = await import(MODULE_URL('clearing', 'persistence.ts')).then((m) =>
    m.openClearingStore({ dbPath: join(dir, 'clearing.sqlite') }),
  );
  const nettingStore = await import(MODULE_URL('netting', 'persistence.ts')).then((m) =>
    m.openNettingStore({ dbPath: join(dir, 'netting.sqlite') }),
  );
  const queuesStore = await import(MODULE_URL('queues', 'persistence.ts')).then((m) =>
    m.openQueuesStore({ dbPath: join(dir, 'queues.sqlite') }),
  );
  const evidenceStore = openEvidenceStore({ dbPath: join(dir, 'evidence.sqlite') });
  const liquidityStore = openLiquidityStore({ dbPath: join(dir, 'liquidity.sqlite') });

  const log = createEvidenceLog({ wallMs: evidenceWallMs });
  const baseEvidence = evidenceChannelOverStore(log, evidenceStore);
  let evidenceArmed = options.armEvidenceOnce === true;
  const evidence = evidenceArmed
    ? {
        submit(record) {
          if (evidenceArmed) {
            // The induced A15 evidence-write failure: ONE submit throws
            // (auto-disarmed — the redelivery after the heal succeeds).
            evidenceArmed = false;
            throw new Error('induced A15 evidence-write failure (rt11 harness)');
          }
          baseEvidence.submit(record);
        },
      }
    : baseEvidence;

  const intent = new IntentAuthority({ evidence, gate: intentApprovalGate(), wallClock: clock });
  const reservations = await openReservationLedger({
    evidence,
    wallClock: clock,
    ...(options.reservationsInitialEntries === undefined
      ? {}
      : { initialEntries: options.reservationsInitialEntries }),
  });
  const obligations = new ObligationLedgerAuthority({ evidence, wallClock: clock });
  const netting = new NettingAuthority({ evidence, obligations, wallClock: clock });
  // The rails authorities' evidence flows through the registry-name
  // adapter ('Rail Authority' → the registry's 'Rail Authority')
  // so the REAL A15 log accepts the records.
  const railsAuthorities = openRailsAuthorities(
    { dbPath: join(dir, 'rails.sqlite') },
    {
      evidence: adaptRailEvidenceToRegistryNames(evidence),
      ...(options.railsWallClock === undefined ? {} : { wallClock: options.railsWallClock }),
    },
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

  const persist = buildDurablePersistHooks({
    intent: intentStore,
    reservations: reservationsStore,
    obligations: obligationsStore,
    settlement: settlementStore,
    clearing: clearingStore,
    netting: nettingStore,
    queues: queuesStore,
  });

  const bindings = createAuthorityCommandBindings({
    intent,
    reservations,
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
  const runtime = createTransitionRuntime({ substrate, bindings });
  runtime.registerAll();

  return {
    dir,
    durableRuntime,
    substrate,
    schedulerSubstrate,
    runtime,
    log,
    evidence,
    evidenceStore,
    stores: {
      intent: intentStore,
      reservations: reservationsStore,
      obligations: obligationsStore,
      settlement: settlementStore,
      clearing: clearingStore,
      netting: nettingStore,
      queues: queuesStore,
      evidence: evidenceStore,
      liquidity: liquidityStore,
    },
    authorities: { intent, reservations, obligations, netting, settlement, clearing, queues },
    rails: { railAuthority, reconciliation },
    rail,
    connection,
    advanceWall: (ms) => {
      wall += ms;
    },
    get wall() {
      return wall;
    },
    async close() {
      await durableRuntime.worker.stop();
      durableRuntime.close();
      for (const store of [
        intentStore,
        reservationsStore,
        obligationsStore,
        settlementStore,
        clearingStore,
        nettingStore,
        queuesStore,
        evidenceStore,
        liquidityStore,
      ]) {
        store.close();
      }
    },
  };
}

/**
 * The deterministic drain over the REAL worker: tick() dispatches (at
 * bounded concurrency 1) and stop() awaits the in-flight executions —
 * repeat until nothing is dispatchable.
 */
async function drain(composition, maxPasses = 60) {
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

function executedObservations(composition) {
  // listRecentEvents is newest-first; the harness narrates in
  // chronological order (oldest first).
  return listRecentEvents(composition.durableRuntime.database, 500)
    .filter((event) => event.type === COMMAND_EXECUTED_EVENT_TYPE)
    .map((event) => ({ ...(event.data ?? {}), jobId: event.jobId, owner: event.owner }))
    .reverse();
}

function operationTypes(composition) {
  return composition.log.records().map((record) => record.what.operationType);
}

// ---------------------------------------------------------------------------
// Scenario 1 — [test:e2e-command-path]
// ---------------------------------------------------------------------------

async function scenarioE2ECommandPath() {
  const composition = await composeHostedRuntime();
  const { substrate } = composition;
  const commandKey = deriveIdempotencyKey('command', 'intent.submit', 'rt11-e2e-key');
  const submitted = enqueueCommand(
    substrate,
    envelopeFor('intent.submit', commandKey, submitIntentBody('rt11-e2e-key'), 'Intent Authority'),
  );
  assert.equal(submitted.created, true);
  // The substrate's public enqueue dedupe (UNIQUE (kind, key)).
  const duplicate = enqueueCommand(
    substrate,
    envelopeFor('intent.submit', commandKey, submitIntentBody('rt11-e2e-key'), 'Intent Authority'),
  );
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.job.id, submitted.job.id);

  // The worker dequeues (reserves) and dispatches to the registered
  // executor: dequeue → resolve → apply → A15 evidence → commit.
  const dispatched = await drain(composition);
  assert.equal(dispatched, 1);
  const job = composition.durableRuntime.queue.getJob(submitted.job.id);
  assert.equal(job.status, 'succeeded');

  // The state transition: the intent exists, DRAFT.
  const intents = composition.authorities.intent.listIntents();
  assert.equal(intents.length, 1);
  assert.equal(intents[0].state, 'DRAFT');
  assert.equal(intents[0].intentId, composition.authorities.intent.getReceipt('rt11-e2e-key').intentId);

  // Exactly ONE A15 evidence record for the consequential operation
  // (plus the log's genesis), persisted in the evidence store too.
  const created = operationTypes(composition).filter((type) => type === 'INTENT_CREATED');
  assert.equal(created.length, 1);
  const persistedEvidence = readEvidenceRecords(composition.stores.evidence);
  assert.equal(persistedEvidence.filter((record) => record.what.operationType === 'INTENT_CREATED').length, 1);

  // The authority-owned observation row coexists with the substrate's
  // lifecycle rows in durable_events.
  const observations = executedObservations(composition);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].owner, 'Intent Authority');
  assert.equal(observations[0].jobId, submitted.job.id);
  assert.equal(observations[0].status, 'applied');
  const lifecycleTypes = listRecentEvents(composition.durableRuntime.database, 500)
    .filter((event) => event.owner === 'durable-substrate')
    .map((event) => event.type);
  for (const expected of ['job_enqueued', 'job_enqueue_deduped', 'job_reserved', 'job_succeeded']) {
    assert.ok(lifecycleTypes.includes(expected), `missing lifecycle event ${expected}`);
  }

  // The durable write-through: the intent + receipt round-trip from the
  // per-domain store.
  const persistedIntents = readPaymentIntents(composition.stores.intent);
  assert.equal(persistedIntents.length, 1);
  assert.equal(persistedIntents[0].state, 'DRAFT');
  assert.equal(readIntentReceipts(composition.stores.intent).length, 1);

  await composition.close();
  return ['enqueue:deduped', 'job:succeeded', 'intent:DRAFT', 'evidence:exactly-one', 'observation:authority-owned'];
}

// ---------------------------------------------------------------------------
// Scenario 2 — [test:e2e-four-kinds]
// ---------------------------------------------------------------------------

async function scenarioFourKinds() {
  const obligationId = obligationIdForOriginRecord('rt11-rec-1');
  const instructionId = settlementInstructionIdFor({ kind: 'OBLIGATION', obligationId }, 1);
  const railKey = railIdempotencyKeyForInstruction(instructionId);
  const composition = await composeHostedRuntime({
    railScript: { [railKey]: 'ACCEPT_REPORT_CONFIRMED' },
  });
  const { substrate, authorities } = composition;

  // (a) intent: submit + authorize through the path.
  enqueueCommand(
    substrate,
    envelopeFor(
      'intent.submit',
      deriveIdempotencyKey('command', 'intent.submit', 'four-key'),
      submitIntentBody('four-key'),
      'Intent Authority',
    ),
  );
  // (pre-execute to learn the id deterministically: submit first, drain, then authorize)
  await drain(composition);
  const learnedIntentId = authorities.intent.listIntents()[0].intentId;
  enqueueCommand(
    substrate,
    envelopeFor(
      'intent.authorize',
      deriveIdempotencyKey('command', 'intent.authorize', learnedIntentId),
      { intentId: learnedIntentId, policyDecisionId: 'policy-four' },
      'Intent Authority',
    ),
  );
  await drain(composition);
  assert.equal(authorities.intent.getIntent(learnedIntentId).state, 'AUTHORIZED');
  assert.equal(operationTypes(composition).filter((type) => type === 'INTENT_CREATED').length, 1);
  assert.equal(operationTypes(composition).filter((type) => type === 'INTENT_AUTHORIZED').length, 1);

  // (b) reservation: declare → request → consume through the path.
  enqueueCommand(
    substrate,
    envelopeFor(
      'reservation.resource.declare',
      deriveIdempotencyKey('command', 'reservation.declare', 'four-res'),
      { resourceId: 'four-res', declaredTotal: { currency: 'EUR', scale: 2, amountMinor: 10_000 } },
      'Reservation Authority',
    ),
  );
  const requestKey = deriveIdempotencyKey('command', 'reservation.request', 'four-res', 'hop-1');
  enqueueCommand(
    substrate,
    envelopeFor(
      'reservation.request',
      requestKey,
      {
        intentId: learnedIntentId,
        hopId: 'hop-1',
        resourceId: 'four-res',
        amount: { currency: 'EUR', scale: 2, amountMinor: 4_000 },
        deadlineEpochMs: 99_999_999,
      },
      'Reservation Authority',
    ),
  );
  await drain(composition);
  const reservation = authorities.reservations.reservations()[0];
  assert.equal(reservation.state, 'HELD');
  const consumeKey = deriveIdempotencyKey('command', 'reservation.consume', reservation.reservationId);
  enqueueCommand(
    substrate,
    envelopeFor(
      'reservation.consume',
      consumeKey,
      { reservationId: reservation.reservationId },
      'Reservation Authority',
    ),
  );
  await drain(composition);
  assert.equal(authorities.reservations.reservations()[0].state, 'CONSUMED');
  assert.equal(authorities.reservations.availableOf('four-res').amountMinor, 6_000);
  // Persisted read-backs: the ledger entries + reservations + accounting.
  const persistedEntries = readLedgerEntries(composition.stores.reservations);
  assert.equal(persistedEntries.filter((entry) => entry.entryKind === 'RESOURCE_DECLARED').length, 1);
  assert.equal(persistedEntries.filter((entry) => entry.entryKind === 'REQUESTED').length, 1);
  assert.equal(persistedEntries.filter((entry) => entry.entryKind === 'HELD').length, 1);
  assert.equal(persistedEntries.filter((entry) => entry.entryKind === 'CONSUMED').length, 1);
  assert.equal(readReservations(composition.stores.reservations).length, 1);
  assert.equal(readResourceAccountings(composition.stores.reservations)[0].heldTotal.amountMinor, 0);
  assert.equal(readResourceAccountings(composition.stores.reservations)[0].consumedTotal.amountMinor, 4_000);

  // (c) obligation: clearing-commit through the path.
  enqueueCommand(
    substrate,
    envelopeFor(
      'obligation.clearing.commit',
      deriveIdempotencyKey('command', 'obligation.clearing.commit', 'rt11-rec-1'),
      {
        batchId: 'rt11-batch-1',
        recordId: 'rt11-rec-1',
        originActivityId: 'rt11-activity-1',
        originKind: 'INTENT',
        debtorParticipantId: 'alpha',
        creditorParticipantId: 'beta',
        amount: { currency: 'EUR', scale: 2, amountMinor: 6_000 },
        reason: 'rt11 four-kinds fixture',
      },
      'Obligation Authority',
    ),
  );
  await drain(composition);
  const learnedObligationId = authorities.obligations.obligations()[0].obligationId;
  assert.equal(learnedObligationId, obligationId);
  assert.equal(authorities.obligations.obligation(obligationId).state, 'CREATED');
  assert.equal(operationTypes(composition).filter((type) => type === 'OBLIGATION_CREATED').length, 1);
  // The append-only obligations ledger round-trips.
  assert.equal(readObligationEntries(composition.stores.obligations).length, 1);

  // (d) settlement: instruction → attempt → report-driven confirm →
  // finality through the path (over the REAL rails authorities). The
  // adapter is registered + activated through the path first.
  enqueueCommand(
    substrate,
    envelopeFor(
      'rails.adapter.register',
      deriveIdempotencyKey('command', 'rails.adapter.register', 'rt11-four-bank'),
      { railFamily: 'sim-bank', name: 'rt11-four-primary' },
      'Rail Authority',
    ),
  );
  await drain(composition);
  const fourAdapterId = composition.rails.railAuthority.listAdapters()[0].adapterId;
  enqueueCommand(
    substrate,
    envelopeFor(
      'rails.adapter.activate',
      deriveIdempotencyKey('command', 'rails.adapter.activate', fourAdapterId),
      { adapterId: fourAdapterId },
      'Rail Authority',
    ),
  );
  await drain(composition);
  enqueueCommand(
    substrate,
    envelopeFor(
      'settlement.instruction.create',
      deriveIdempotencyKey('command', 'settlement.instruction.create', obligationId),
      { subject: { kind: 'OBLIGATION', obligationId }, beneficiary: 'acct-beta' },
      'Settlement and Finality Authority',
    ),
  );
  await drain(composition);
  assert.equal(authorities.obligations.obligation(obligationId).state, 'SETTLEMENT_PENDING');
  enqueueCommand(
    substrate,
    envelopeFor(
      'settlement.attempt.authorize',
      deriveIdempotencyKey('command', 'settlement.attempt.authorize', instructionId),
      { instructionId, adapterId: fourAdapterId },
      'Settlement and Finality Authority',
    ),
  );
  await drain(composition);
  enqueueCommand(
    substrate,
    envelopeFor(
      'settlement.attempt.submit',
      deriveIdempotencyKey('command', 'settlement.attempt.submit', instructionId),
      { instructionId },
      'Settlement and Finality Authority',
    ),
  );
  await drain(composition);
  assert.equal(authorities.settlement.attemptForInstruction(instructionId).state, 'PENDING');
  enqueueCommand(
    substrate,
    envelopeFor(
      'settlement.report.apply',
      deriveIdempotencyKey('command', 'settlement.report.apply', instructionId),
      { instructionId },
      'Settlement and Finality Authority',
    ),
  );
  await drain(composition);
  assert.equal(authorities.settlement.attemptForInstruction(instructionId).state, 'CONFIRMED');
  enqueueCommand(
    substrate,
    envelopeFor(
      'settlement.declare.finality',
      deriveIdempotencyKey('command', 'settlement.declare.finality', instructionId),
      { instructionId },
      'Settlement and Finality Authority',
    ),
  );
  await drain(composition);
  assert.equal(authorities.obligations.obligation(obligationId).state, 'SETTLED');
  assert.equal(
    authorities.settlement.finalityForSubject({ kind: 'OBLIGATION', obligationId }).state,
    'FINAL',
  );
  // The settlement store round-trips: one instruction, one attempt, one
  // finality (PROVISIONAL → FINAL is an UPDATE, not a second row).
  assert.equal(readInstructions(composition.stores.settlement).length, 1);
  assert.equal(readAttempts(composition.stores.settlement).length, 1);
  assert.equal(readFinalities(composition.stores.settlement).length, 1);
  assert.equal(readFinalities(composition.stores.settlement)[0].state, 'FINAL');

  // The composed A15 chain verifies end-to-end.
  assert.equal(composition.log.verifyAndRecord(composition.wall).verdict, 'VERIFIED');

  await composition.close();
  return ['intent:AUTHORIZED', 'reservation:CONSUMED', 'obligation:SETTLED', 'finality:FINAL', 'chain:VERIFIED'];
}

// ---------------------------------------------------------------------------
// Scenario 3 — [test:rails-single-writer]
// ---------------------------------------------------------------------------

async function scenarioRailsSingleWriter() {
  const composition = await composeHostedRuntime();
  const { substrate, rails } = composition;
  // Before any command: no adapters, no operations.
  assert.equal(rails.railAuthority.listAdapters().length, 0);
  assert.equal(rails.railAuthority.listOperations().length, 0);

  // Adapter state machines advance ONLY through the transition path.
  enqueueCommand(
    substrate,
    envelopeFor(
      'rails.adapter.register',
      deriveIdempotencyKey('command', 'rails.adapter.register', 'rt11-bank'),
      { railFamily: 'sim-bank', name: 'rt11-primary' },
      'Rail Authority',
    ),
  );
  await drain(composition);
  let adapter = rails.railAuthority.listAdapters()[0];
  assert.equal(adapter.status, 'REGISTERED');
  enqueueCommand(
    substrate,
    envelopeFor(
      'rails.adapter.activate',
      deriveIdempotencyKey('command', 'rails.adapter.activate', adapter.adapterId),
      { adapterId: adapter.adapterId },
      'Rail Authority',
    ),
  );
  await drain(composition);
  adapter = rails.railAuthority.listAdapters()[0];
  assert.equal(adapter.status, 'ACTIVE');

  // Operation state machine: AUTHORIZED → SUBMITTED → PENDING, each
  // advance a command executed through the path.
  enqueueCommand(
    substrate,
    envelopeFor(
      'rails.operation.authorize',
      deriveIdempotencyKey('command', 'rails.operation.authorize', 'rt11-op-1'),
      {
        instructionId: 'rt11-op-1',
        adapterId: adapter.adapterId,
        payload: {
          instructionId: 'rt11-op-1',
          money: { currency: 'EUR', scale: 2, amountMinor: 1_500 },
          beneficiary: 'acct-beta',
          memo: 'rt11 single-writer probe',
        },
      },
      'Rail Authority',
    ),
  );
  await drain(composition);
  const operation = rails.railAuthority.listOperations()[0];
  assert.equal(operation.status, 'AUTHORIZED');
  enqueueCommand(
    substrate,
    envelopeFor(
      'rails.operation.submit',
      deriveIdempotencyKey('command', 'rails.operation.submit', operation.operationId),
      { operationId: operation.operationId },
      'Rail Authority',
    ),
  );
  await drain(composition);
  assert.equal(rails.railAuthority.getOperation(operation.operationId).status, 'PENDING');

  // Exactly ONE operation exists — created and advanced only by the two
  // commands above; the adapter interface (SimulatedRail + connection)
  // holds no protocol state and created nothing.
  assert.equal(rails.railAuthority.listOperations().length, 1);
  // The A15 records: ADAPTER_STATE_CHANGED (register + activate) and
  // RAIL_OP_AUTHORIZED + RAIL_OP_SUBMITTED — all written by the
  // authority inside its transactions, driven only by the commands.
  const types = operationTypes(composition);
  assert.equal(types.filter((type) => type === 'RAIL_OP_AUTHORIZED').length, 1);
  assert.equal(types.filter((type) => type === 'RAIL_OP_SUBMITTED').length, 1);
  assert.equal(types.filter((type) => type === 'ADAPTER_STATE_CHANGED').length, 2);

  await composition.close();
  return ['adapter:ACTIVE', 'operation:PENDING', 'rails-state:path-only'];
}

// ---------------------------------------------------------------------------
// Scenario 4 — [test:atomicity-rollback]
// ---------------------------------------------------------------------------

async function scenarioAtomicityRollback() {
  // The induced A15 evidence-write failure: the composition's evidence
  // channel throws on its FIRST submit (auto-disarmed — the redelivery
  // after the backoff elapses submits through the real channel).
  const failing = await composeHostedRuntime({ armEvidenceOnce: true });
  const { substrate } = failing;
  const commandKey = deriveIdempotencyKey('command', 'intent.submit', 'rt11-atomic');
  const submitted = enqueueCommand(
    failing.substrate,
    envelopeFor('intent.submit', commandKey, submitIntentBody('rt11-atomic'), 'Intent Authority'),
  );
  await drain(failing);
  const job = failing.durableRuntime.queue.getJob(submitted.job.id);
  // The operation FAILED: nothing committed — no intent, no receipt, no
  // A15 record, no observation row; the job is requeued with backoff.
  assert.equal(job.status, 'queued');
  assert.equal(job.attempts, 1);
  assert.equal(failing.authorities.intent.listIntents().length, 0);
  assert.equal(failing.authorities.intent.getReceipt('rt11-atomic'), undefined);
  assert.equal(failing.log.height, 1); // genesis only
  assert.equal(executedObservations(failing).length, 0);
  assert.equal(readPaymentIntents(failing.stores.intent).length, 0);

  // At-least-once recovery: the channel is healed; after the backoff
  // (10 ms base) elapses, the redelivery commits EXACTLY ONCE.
  await sleep(BACKOFF_BASE_MS + 5);
  const redelivered = await drain(failing);
  assert.equal(redelivered, 1);
  assert.equal(failing.durableRuntime.queue.getJob(submitted.job.id).status, 'succeeded');
  assert.equal(failing.authorities.intent.listIntents().length, 1);
  assert.equal(operationTypes(failing).filter((type) => type === 'INTENT_CREATED').length, 1);
  const observations = executedObservations(failing);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].status, 'applied');
  assert.equal(readPaymentIntents(failing.stores.intent).length, 1);

  await failing.close();
  return ['failure:rolled-back', 'retry:committed-once'];
}

// ---------------------------------------------------------------------------
// Scenario 5 — [test:duplicate-redelivery]
// ---------------------------------------------------------------------------

/**
 * The REAL redelivery harness: enqueue → reserve → execute the atomic
 * unit → never complete (the worker-loop kill window) → the lease
 * expires → the worker's tick reclaims and redelivers → the re-execution
 * replays → complete.
 */
async function redeliverThroughLeaseExpiry(composition, kind, commandKey, body, authority) {
  const submitted = enqueueCommand(
    composition.substrate,
    envelopeFor(kind, commandKey, body, authority),
  );
  const reserved = composition.durableRuntime.queue.reserve('killed-loop', LEASE_MS, { kind });
  assert.equal(reserved.id, submitted.job.id);
  await composition.runtime.executeCommand(reserved);
  // The loop "dies" here: nothing completes the job. The lease expires.
  await sleep(LEASE_MS + 20);
  // The next worker pass: reclaimExpired (attempts+1) → re-reserve →
  // re-execute → complete.
  const dispatched = await drain(composition);
  assert.equal(dispatched, 1);
  return { jobId: submitted.job.id };
}

async function scenarioDuplicateRedelivery() {
  const obligationId = obligationIdForOriginRecord('rt11-dup-rec');
  const instructionId = settlementInstructionIdFor({ kind: 'OBLIGATION', obligationId }, 1);
  const railKey = railIdempotencyKeyForInstruction(instructionId);
  const composition = await composeHostedRuntime({
    railScript: { [railKey]: 'ACCEPT_REPORT_CONFIRMED' },
  });
  const { substrate, authorities } = composition;

  // (a) intent.submit: the recorded receipt returns, never a second
  // intent or a second INTENT_CREATED record (INV-1-3).
  const intentKey = deriveIdempotencyKey('command', 'intent.submit', 'rt11-dup-intent');
  const { jobId: intentJobId } = await redeliverThroughLeaseExpiry(
    composition,
    'intent.submit',
    intentKey,
    submitIntentBody('rt11-dup-intent'),
    'Intent Authority',
  );
  assert.equal(authorities.intent.listIntents().length, 1);
  assert.equal(operationTypes(composition).filter((type) => type === 'INTENT_CREATED').length, 1);
  const job = composition.durableRuntime.queue.getJob(intentJobId);
  assert.equal(job.status, 'succeeded');
  assert.equal(job.attempts, 1); // one reclaim, one completion
  const intentObservations = executedObservations(composition).filter(
    (row) => row.kind === 'intent.submit',
  );
  assert.deepEqual(
    intentObservations.map((row) => row.status),
    ['applied', 'replayed'],
  );

  // (b) reservation.request: the recorded HELD state returns; the
  // accounting is exact (INV-5-1/INV-5-3).
  enqueueCommand(
    substrate,
    envelopeFor(
      'reservation.resource.declare',
      deriveIdempotencyKey('command', 'reservation.declare', 'dup-res'),
      { resourceId: 'dup-res', declaredTotal: { currency: 'EUR', scale: 2, amountMinor: 10_000 } },
      'Reservation Authority',
    ),
  );
  await drain(composition);
  const requestKey = deriveIdempotencyKey('command', 'reservation.request', 'dup-res', 'hop-9');
  await redeliverThroughLeaseExpiry(
    composition,
    'reservation.request',
    requestKey,
    {
      intentId: authorities.intent.listIntents()[0].intentId,
      hopId: 'hop-9',
      resourceId: 'dup-res',
      amount: { currency: 'EUR', scale: 2, amountMinor: 3_000 },
      deadlineEpochMs: 99_999_999,
    },
    'Reservation Authority',
  );
  assert.equal(authorities.reservations.reservations().length, 1);
  assert.equal(authorities.reservations.reservations()[0].state, 'HELD');
  assert.equal(authorities.reservations.availableOf('dup-res').amountMinor, 7_000);
  assert.equal(operationTypes(composition).filter((type) => type === 'RESERVATION_HELD').length, 1);
  // Persisted: exactly one REQUESTED and one HELD entry.
  const entries = readLedgerEntries(composition.stores.reservations);
  assert.equal(entries.filter((entry) => entry.entryKind === 'REQUESTED').length, 1);
  assert.equal(entries.filter((entry) => entry.entryKind === 'HELD').length, 1);

  // (c) obligation.clearing.commit: the duplicate instruction is a
  // ledger no-op (INV-10-3).
  await redeliverThroughLeaseExpiry(
    composition,
    'obligation.clearing.commit',
    deriveIdempotencyKey('command', 'obligation.clearing.commit', 'rt11-dup-rec'),
    {
      batchId: 'rt11-dup-batch',
      recordId: 'rt11-dup-rec',
      originActivityId: 'rt11-dup-activity',
      originKind: 'INTENT',
      debtorParticipantId: 'alpha',
      creditorParticipantId: 'beta',
      amount: { currency: 'EUR', scale: 2, amountMinor: 5_000 },
      reason: 'rt11 duplicate fixture',
    },
    'Obligation Authority',
  );
  assert.equal(authorities.obligations.obligations().length, 1);
  assert.equal(operationTypes(composition).filter((type) => type === 'OBLIGATION_CREATED').length, 1);
  assert.equal(readObligationEntries(composition.stores.obligations).length, 1);

  // (d) settlement.attempt.submit: blind retry is impossible by
  // construction (INV-12-2) — the redelivered submit is refused with the
  // typed code and the rail sees no second transmission.
  enqueueCommand(
    substrate,
    envelopeFor(
      'rails.adapter.register',
      deriveIdempotencyKey('command', 'rails.adapter.register', 'rt11-dup-bank'),
      { railFamily: 'sim-bank', name: 'rt11-dup-primary' },
      'Rail Authority',
    ),
  );
  await drain(composition);
  const dupAdapterId = composition.rails.railAuthority.listAdapters()[0].adapterId;
  enqueueCommand(
    substrate,
    envelopeFor(
      'rails.adapter.activate',
      deriveIdempotencyKey('command', 'rails.adapter.activate', dupAdapterId),
      { adapterId: dupAdapterId },
      'Rail Authority',
    ),
  );
  await drain(composition);
  enqueueCommand(
    substrate,
    envelopeFor(
      'settlement.instruction.create',
      deriveIdempotencyKey('command', 'settlement.instruction.create', obligationId),
      { subject: { kind: 'OBLIGATION', obligationId }, beneficiary: 'acct-beta' },
      'Settlement and Finality Authority',
    ),
  );
  await drain(composition);
  enqueueCommand(
    substrate,
    envelopeFor(
      'settlement.attempt.authorize',
      deriveIdempotencyKey('command', 'settlement.attempt.authorize', instructionId),
      { instructionId, adapterId: dupAdapterId },
      'Settlement and Finality Authority',
    ),
  );
  await drain(composition);
  // The FIRST submit: executed, then killed in the completion window.
  await redeliverThroughLeaseExpiry(
    composition,
    'settlement.attempt.submit',
    deriveIdempotencyKey('command', 'settlement.attempt.submit', instructionId),
    { instructionId },
    'Settlement and Finality Authority',
  );
  const attempt = authorities.settlement.attemptForInstruction(instructionId);
  assert.equal(attempt.state, 'PENDING');
  // Exactly one rail operation for the instruction (no second external
  // effect was ever attempted).
  assert.equal(authorities.settlement.listAttempts().length, 1);
  const submitObservations = executedObservations(composition).filter(
    (row) => row.kind === 'settlement.attempt.submit',
  );
  assert.equal(submitObservations.length, 2);
  assert.equal(submitObservations[1].status, 'rejected');
  assert.equal(submitObservations[1].code, 'LIVE_ATTEMPT_EXISTS');

  await composition.close();
  return ['intent:replayed', 'reservation:replayed', 'obligation:duplicate-no-op', 'settlement:typed-refusal'];
}

// ---------------------------------------------------------------------------
// Scenario 6 — [test:restart-lease-reclaim] (real child-process kill)
// ---------------------------------------------------------------------------

async function scenarioRestartLeaseReclaim() {
  const dir = tempDir('restart');
  const durableDb = join(dir, 'durable.sqlite');
  const reservationsDb = join(dir, 'reservations.sqlite');
  const evidenceDb = join(dir, 'evidence.sqlite');

  // Phase 1 (parent): declare the resource and enqueue the request
  // command through the public enqueue API; persist; close.
  const parent = await composeHostedRuntime({ dir });
  enqueueCommand(
    parent.substrate,
    envelopeFor(
      'reservation.resource.declare',
      deriveIdempotencyKey('command', 'reservation.declare', 'restart-res'),
      { resourceId: 'restart-res', declaredTotal: { currency: 'EUR', scale: 2, amountMinor: 10_000 } },
      'Reservation Authority',
    ),
  );
  await drain(parent);
  const intentKey = deriveIdempotencyKey('command', 'intent.submit', 'restart-intent');
  enqueueCommand(
    parent.substrate,
    envelopeFor('intent.submit', intentKey, submitIntentBody('restart-intent'), 'Intent Authority'),
  );
  await drain(parent);
  const intentId = parent.authorities.intent.listIntents()[0].intentId;
  const requestKey = deriveIdempotencyKey('command', 'reservation.request', 'restart-res', 'hop-r');
  const submitted = enqueueCommand(
    parent.substrate,
    envelopeFor(
      'reservation.request',
      requestKey,
      {
        intentId,
        hopId: 'hop-r',
        resourceId: 'restart-res',
        amount: { currency: 'EUR', scale: 2, amountMinor: 4_000 },
        deadlineEpochMs: 99_999_999,
      },
      'Reservation Authority',
    ),
  );
  await parent.close();

  // Phase 2 (child): a REAL worker process rehydrates the reservation
  // ledger from the persisted entries, reserves the command, executes
  // the atomic unit (REQUESTED+HELD+evidence+persist+observation), and
  // then stalls — killed mid-execution, before the job completes.
  const childScript = `
import { openTransitionSubstrate, asTransitionSubstrate, buildDurablePersistHooks } from ${JSON.stringify(MODULE_URL('hosting', 'durable-binding.ts'))};
import { createAuthorityCommandBindings } from ${JSON.stringify(MODULE_URL('hosting', 'bindings.ts'))};
import { createTransitionRuntime } from ${JSON.stringify(MODULE_URL('transition', 'execution.ts'))};
import { openReservationLedger } from ${JSON.stringify(MODULE_URL('reservations', 'ledger.ts'))};
import { openReservationsStore, readLedgerEntries } from ${JSON.stringify(MODULE_URL('reservations', 'persistence.ts'))};
import { createEvidenceLog } from ${JSON.stringify(MODULE_URL('evidence', 'log.ts'))};
import { openEvidenceStore, writeEvidenceRecord } from ${JSON.stringify(MODULE_URL('evidence', 'persistence.ts'))};

const durable = openTransitionSubstrate({ dbPath: process.env.RTN11_DURABLE_DB, workerId: 'rt11-child', leaseMs: 150, pollIntervalMs: 5 });
const store = openReservationsStore({ dbPath: process.env.RTN11_RESERVATIONS_DB });
const evidenceStore = openEvidenceStore({ dbPath: process.env.RTN11_EVIDENCE_DB });
const log = createEvidenceLog({ wallMs: 1000 });
const evidence = {
  submit(record) {
    const before = log.height;
    log.submit(record);
    for (const written of log.records().slice(before)) {
      writeEvidenceRecord(evidenceStore, written);
    }
  },
};
const ledger = await openReservationLedger({ evidence, wallClock: () => 5000, initialEntries: readLedgerEntries(store) });
const persist = buildDurablePersistHooks({ reservations: store });
const bindings = createAuthorityCommandBindings({ reservations: ledger, persist });
const runtime = createTransitionRuntime({ substrate: asTransitionSubstrate(durable), bindings });
runtime.registerAll();
const job = durable.queue.reserve('rt11-child', 150, { kind: 'reservation.request' });
if (!job) {
  console.error('CHILD-NO-JOB');
  process.exit(2);
}
await runtime.executeCommand(job);
console.log('EFFECT-COMMITTED');
// The crash window: the process stalls with the job still reserved (the
// lease will expire; the parent will reclaim and redeliver).
setInterval(() => {}, 1000);
`;
  const childEvidenceDb = join(dir, 'child-evidence.sqlite');
  const childScriptPath = join(dir, 'rt11-child.mjs');
  writeFileSync(childScriptPath, childScript);
  const child = spawn(process.execPath, ['--no-warnings', '--', childScriptPath], {
    env: {
      ...process.env,
      RTN11_DURABLE_DB: durableDb,
      RTN11_RESERVATIONS_DB: reservationsDb,
      RTN11_EVIDENCE_DB: childEvidenceDb,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childOutput = '';
  child.stdout.on('data', (chunk) => {
    childOutput += String(chunk);
  });
  let childError = '';
  child.stderr.on('data', (chunk) => {
    childError += String(chunk);
  });
  // Wait for the committed-effect marker (bounded).
  const deadline = Date.now() + 20_000;
  while (!childOutput.includes('EFFECT-COMMITTED') && Date.now() < deadline) {
    await sleep(50);
  }
  assert.ok(childOutput.includes('EFFECT-COMMITTED'), `child did not commit the effect; stderr: ${childError}`);
  // KILL the child mid-execution (after the atomic unit, before the
  // job completes — the job row stays reserved until its lease expires).
  child.kill('SIGKILL');
  await sleep(250); // the 150 ms lease expires

  // Phase 3 (parent restart): rehydrate the reservation ledger from the
  // persisted entries (the merged crash-recovery path), reclaim the
  // expired lease, redeliver, and replay.
  const restartEntriesSource = openReservationsStore({ dbPath: reservationsDb });
  const restartEntries = readLedgerEntries(restartEntriesSource);
  restartEntriesSource.close();
  const restart = await composeHostedRuntime({
    dir,
    reservationsInitialEntries: restartEntries,
  });
  const dispatched = await drain(restart);
  assert.equal(dispatched, 1);
  const job = restart.durableRuntime.queue.getJob(submitted.job.id);
  assert.equal(job.status, 'succeeded');
  assert.equal(job.attempts, 1); // one lease-expiry reclaim, one completion
  assert.ok(
    listRecentEvents(restart.durableRuntime.database, 500).some(
      (event) => event.type === 'job_lease_expired',
    ),
    'the lease-expiry redelivery lifecycle event is recorded',
  );

  // NO DUPLICATE EFFECTS over the durable artifacts:
  const persistedEntries = readLedgerEntries(restart.stores.reservations);
  assert.equal(persistedEntries.filter((entry) => entry.entryKind === 'RESOURCE_DECLARED').length, 1);
  assert.equal(persistedEntries.filter((entry) => entry.entryKind === 'REQUESTED').length, 1);
  assert.equal(persistedEntries.filter((entry) => entry.entryKind === 'HELD').length, 1);
  const persistedReservations = readReservations(restart.stores.reservations);
  const request = persistedReservations.filter((record) => record.resourceId === 'restart-res');
  assert.equal(request.length, 1);
  assert.equal(request[0].state, 'HELD');
  const accounting = readResourceAccountings(restart.stores.reservations).filter(
    (record) => record.resourceId === 'restart-res',
  );
  assert.equal(accounting.length, 1);
  assert.equal(accounting[0].heldTotal.amountMinor, 4_000);
  assert.equal(accounting[0].consumedTotal.amountMinor, 0);
  // INV-5-1 holds over the persisted state.
  const probe = probeReservationLedgerIdentity({
    accountings: readResourceAccountings(restart.stores.reservations),
    reservations: persistedReservations,
  });
  assert.equal(probe.holds, true);
  // The CHILD's A15 chain (its own evidence store file — a fresh
  // in-process log is a new chain instance from genesis) shows EXACTLY
  // ONE RESERVATION_HELD record: the child committed the effect once,
  // and the parent's redelivered replay submitted NO second record (the
  // INV-x-3 duplicate discipline emits no evidence on replay).
  const childEvidenceStore = openEvidenceStore({ dbPath: childEvidenceDb });
  const childEvidenceRecords = readEvidenceRecords(childEvidenceStore);
  childEvidenceStore.close();
  assert.equal(childEvidenceRecords.filter((record) => record.what.operationType === 'RESERVATION_HELD').length, 1);
  // And the parent-restart chain added no RESERVATION_HELD of its own.
  const parentEvidenceRecords = readEvidenceRecords(restart.stores.evidence);
  assert.equal(parentEvidenceRecords.filter((record) => record.what.operationType === 'RESERVATION_HELD').length, 0);
  // The redelivered execution replayed (observation rows narrate the two
  // deliveries of the same command).
  const observations = executedObservations(restart).filter((row) => row.kind === 'reservation.request');
  assert.deepEqual(
    observations.map((row) => row.status),
    ['applied', 'replayed'],
  );

  await restart.close();
  return ['child:killed-after-commit', 'lease:reclaimed', 'ledger:rehydrated', 'effect:exactly-once'];
}

// ---------------------------------------------------------------------------
// Scenario 7 — [test:scheduler-ticks]
// ---------------------------------------------------------------------------

async function scenarioSchedulerTicks() {
  const composition = await composeHostedRuntime();
  const { schedulerSubstrate, substrate, authorities } = composition;

  // A configured recurring schedule (schedules are configuration): the
  // clearing batch tick at a short cadence for the test.
  const clearingConfig = {
    kind: 'clearing.batch.tick',
    authority: 'Clearing Authority',
    scheduleId: 'rt11-clearing-tick',
    intervalMs: 60_000,
    bodyForTick: (window) => ({
      batchLabel: `rt11-clearing-window-${window.tick}`,
      windowStartWallMs: window.windowStartWallMs,
      windowEndWallMs: window.windowEndWallMs,
    }),
  };
  const wired = wireRecurringCommandEmitters(schedulerSubstrate, [clearingConfig]);
  const schedule = wired[0];

  // EMISSION ONLY: tickOnce enqueues exactly one job whose payload is a
  // valid command envelope — and NO authority state changed.
  const emitted = schedule.tickOnce();
  assert.equal(emitted.created, true);
  const queuedJob = composition.durableRuntime.queue
    .getByIdempotencyKey('clearing.batch.tick', emitted.job.idempotencyKey);
  assert.equal(queuedJob.kind, 'clearing.batch.tick');
  const validation = validateCommandEnvelope(queuedJob.payload, {
    allowedAuthorities: ['Clearing Authority'],
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.ok && validation.envelope.idempotencyKey, queuedJob.idempotencyKey);
  assert.equal(
    executedObservations(composition).length,
    0,
    'no command executed at emission time — the scheduler emitted only',
  );
  // No clearing batch exists yet.
  const noBatch = authorities.clearing.batch(
    // The batch id is derived from the label; no observation row exists,
    // so no batch id is discoverable — the authoritative proof is the
    // absence of any executed command above.
    'none',
  );
  assert.equal(noBatch, undefined);

  // The same tick identity never emits twice (the lastTick guard).
  assert.equal(schedule.tickOnce(), null);
  // The queue-level per-tick dedupe: a re-attempt of the same tick
  // identity (a restarted scheduler) collapses at enqueue.
  const reattempt = substrate.enqueue(
    'clearing.batch.tick',
    tickCommandEnvelope(clearingConfig, Math.floor(Date.now() / 60_000)),
    { idempotencyKey: queuedJob.idempotencyKey },
  );
  assert.equal(reattempt.created, false);

  // EXECUTION through the path: the worker dequeues the emitted command
  // and the clearing authority opens the window's batch.
  await drain(composition);
  const observations = executedObservations(composition).filter((row) => row.kind === 'clearing.batch.tick');
  assert.equal(observations.length, 1);
  assert.equal(observations[0].status, 'applied');
  const batchId = observations[0].summary.batchId;
  assert.equal(authorities.clearing.batch(batchId).state, 'OPEN');
  // The durable write-through persisted the batch.
  const readBatches = await import(MODULE_URL('clearing', 'persistence.ts')).then((m) =>
    m.readBatches(composition.stores.clearing),
  );
  assert.equal(readBatches.length, 1);
  assert.equal(readBatches[0].batchId, batchId);

  // A re-delivered tick (the same window label, a distinct job key)
  // completes as the typed duplicate rejection — no second batch.
  enqueueCommand(
    substrate,
    envelopeFor(
      'clearing.batch.tick',
      deriveIdempotencyKey('command', 'clearing.batch.tick', 'redelivered'),
      {
        batchLabel: (queuedJob.payload && queuedJob.payload.body && queuedJob.payload.body.batchLabel) ?? '',
        windowStartWallMs: 0,
        windowEndWallMs: 0,
      },
      'Clearing Authority',
    ),
  );
  await drain(composition);
  assert.equal(readBatches.length, 1);
  const tickObservations = executedObservations(composition).filter((row) => row.kind === 'clearing.batch.tick');
  assert.equal(tickObservations.length, 2);
  assert.equal(tickObservations[1].status, 'rejected');

  // The queue-eligibility scan tick over the queues authority (a queue
  // created through the path first).
  enqueueCommand(
    substrate,
    envelopeFor(
      'queues.queue.create',
      deriveIdempotencyKey('command', 'queues.queue.create', 'rt11-q'),
      {
        queueId: 'rt11-q',
        policy: {
          maxWaitEpochMs: 60_000,
          releaseConditions: { requiredCapabilityTier: 'STANDARD' },
        },
      },
      'Queue Authority',
    ),
  );
  await drain(composition);
  const eligibilityConfig = {
    kind: 'queues.eligibility.tick',
    authority: 'Queue Authority',
    scheduleId: 'rt11-eligibility-tick',
    intervalMs: 60_000,
    bodyForTick: (window) => ({
      windowStartWallMs: window.windowStartWallMs,
      windowEndWallMs: window.windowEndWallMs,
      scans: [
        {
          queueId: 'rt11-q',
          snapshot: {
            liquidity: [],
            capability: [{ capabilityId: 'cap-1', tier: 'STANDARD', state: 'ACTIVE' }],
            credit: [],
            at: { sequence: window.tick, wallMs: window.windowStartWallMs },
          },
        },
      ],
    }),
  };
  const eligibilityWired = wireRecurringCommandEmitters(schedulerSubstrate, [eligibilityConfig]);
  const eligibilityEmitted = eligibilityWired[0].tickOnce();
  assert.equal(eligibilityEmitted.created, true);
  await drain(composition);
  const eligibilityObservations = executedObservations(composition).filter(
    (row) => row.kind === 'queues.eligibility.tick',
  );
  assert.equal(eligibilityObservations.length, 1);
  assert.equal(eligibilityObservations[0].status, 'applied');
  assert.equal(authorities.queues.queue('rt11-q').state, 'OPEN');

  await composition.close();
  return ['emission:envelope-only', 'same-tick:no-duplicate', 'execution:through-path', 'redelivery:typed-rejection'];
}

// ---------------------------------------------------------------------------
// Scenario 8 — [test:probes]
// ---------------------------------------------------------------------------

async function scenarioProbes() {
  const composition = await composeHostedRuntime();
  const { substrate } = composition;

  // (a) The transition backlog probe over the real queue.
  const now = Date.now();
  substrate.enqueue('intent.submit', { future: true }, { idempotencyKey: 'probe-future-1', availableAt: now + 600_000 });
  substrate.enqueue('intent.submit', { future: true }, { idempotencyKey: 'probe-future-2', availableAt: now + 300_000 });
  const backlog = transitionBacklogSnapshot(composition.substrate.queue, Date.now());
  assert.equal(backlog.depth, 2);
  assert.equal(backlog.waitingCount, 2);
  assert.equal(backlog.inFlightCount, 0);
  assert.equal(backlog.oldestBacklogAgeMs !== null && backlog.oldestBacklogAgeMs < 5_000, true);
  assert.equal(backlog.oldestEligibleAgeMs, 0); // not yet due → clamped

  // (b) The reservations INV-5-1 probe over persisted state: drive
  // declare → request → consume through the path, persist, read back.
  enqueueCommand(
    substrate,
    envelopeFor(
      'reservation.resource.declare',
      deriveIdempotencyKey('command', 'reservation.declare', 'probe-res'),
      { resourceId: 'probe-res', declaredTotal: { currency: 'EUR', scale: 2, amountMinor: 8_000 } },
      'Reservation Authority',
    ),
  );
  const intentKey = deriveIdempotencyKey('command', 'intent.submit', 'probe-intent');
  enqueueCommand(
    substrate,
    envelopeFor('intent.submit', intentKey, submitIntentBody('probe-intent'), 'Intent Authority'),
  );
  await drain(composition);
  const intentId = composition.authorities.intent.listIntents()[0].intentId;
  enqueueCommand(
    substrate,
    envelopeFor(
      'reservation.request',
      deriveIdempotencyKey('command', 'reservation.request', 'probe-res', 'hop-p'),
      {
        intentId,
        hopId: 'hop-p',
        resourceId: 'probe-res',
        amount: { currency: 'EUR', scale: 2, amountMinor: 5_000 },
        deadlineEpochMs: 99_999_999,
      },
      'Reservation Authority',
    ),
  );
  await drain(composition);
  const reservationId = composition.authorities.reservations.reservations()[0].reservationId;
  enqueueCommand(
    substrate,
    envelopeFor(
      'reservation.consume',
      deriveIdempotencyKey('command', 'reservation.consume', reservationId),
      { reservationId },
      'Reservation Authority',
    ),
  );
  await drain(composition);
  let probe = probeReservationLedgerIdentity({
    accountings: readResourceAccountings(composition.stores.reservations),
    reservations: readReservations(composition.stores.reservations),
  });
  assert.equal(probe.holds, true, JSON.stringify(probe.violations));
  assert.equal(probe.inspected, 1);

  // Drift detection: corrupt the persisted accounting row (simulated
  // persisted-state drift) — the probe MUST detect it.
  // Corrupt the persisted accounting's held amount INSIDE the Money JSON
  // (a realistic drift: the row stays a well-formed Money value, but its
  // amount no longer agrees with the recomputation from the reservation
  // records).
  composition.stores.reservations
    .prepare(
      "UPDATE reservation_resources SET held_total = json_set(held_total, '$.amountMinor', json_extract(held_total, '$.amountMinor') + 1) WHERE resource_id = ?",
    )
    .run('probe-res');
  probe = probeReservationLedgerIdentity({
    accountings: readResourceAccountings(composition.stores.reservations),
    reservations: readReservations(composition.stores.reservations),
  });
  assert.equal(probe.holds, false);
  assert.equal(probe.violations.length, 1);

  // (c) The liquidity INV-6-1 probe over persisted state (driven through
  // the liquidity authority + its write-through bridge).
  const ledgerForLiquidity = composition.authorities.reservations;
  const liquidity = new LiquidityAuthority({
    evidence: composition.evidence,
    ledger: ledgerForLiquidity,
    wallClock: () => composition.wall,
  });
  const openedPool = await liquidity.openPool({ poolId: 'probe-pool', currency: 'EUR', scale: 2 });
  assert.equal(openedPool.ok, true);
  await liquidity.recordConfirmedFunding({
    poolId: 'probe-pool',
    source: { kind: 'INTERNAL_TRANSFER', referenceId: 'probe-tr-1' },
    amount: { currency: 'EUR', scale: 2, amountMinor: 7_000 },
  });
  const liquidityStore = composition.stores.liquidity;
  writePool(liquidityStore, liquidity.pool('probe-pool'));
  for (const position of liquidity.positionsOf('probe-pool')) {
    writePosition(liquidityStore, position);
  }
  let liquidityProbe = probeLiquidityPoolIdentity({
    pools: readPools(liquidityStore),
    positions: readPositions(liquidityStore),
  });
  assert.equal(liquidityProbe.holds, true, JSON.stringify(liquidityProbe.violations));

  // (d) The netting INV-11-1 probe over persisted state: obligations +
  // netting set driven through the command path.
  for (const recordId of ['probe-net-1', 'probe-net-2']) {
    enqueueCommand(
      substrate,
      envelopeFor(
        'obligation.clearing.commit',
        deriveIdempotencyKey('command', 'obligation.clearing.commit', recordId),
        {
          batchId: `probe-net-batch-${recordId}`,
          recordId,
          originActivityId: `probe-net-activity-${recordId}`,
          originKind: 'INTENT',
          debtorParticipantId: 'alpha',
          creditorParticipantId: 'beta',
          amount: { currency: 'EUR', scale: 2, amountMinor: 3_000 },
          reason: 'rt11 probe fixture',
        },
        'Obligation Authority',
      ),
    );
  }
  await drain(composition);
  const nettingInputIds = composition.authorities.obligations
    .obligations()
    .filter((obligation) => obligation.state === 'CREATED')
    .map((obligation) => obligation.obligationId);
  assert.equal(nettingInputIds.length, 2);
  enqueueCommand(
    substrate,
    envelopeFor(
      'netting.set.open',
      deriveIdempotencyKey('command', 'netting.set.open', 'rt11-probe-set'),
      {
        label: 'rt11-probe-set',
        scope: { kind: 'BILATERAL', participants: ['alpha', 'beta'] },
        inputObligationIds: nettingInputIds,
      },
      'Netting Authority',
    ),
  );
  await drain(composition);
  const setId = composition.authorities.netting.nettingSet(
    // The set id derives from the label; discover it from the observation.
    executedObservations(composition).find((row) => row.kind === 'netting.set.open')?.summary?.nettingSetId,
  );
  assert.notEqual(setId, undefined);
  enqueueCommand(
    substrate,
    envelopeFor(
      'netting.set.compute',
      deriveIdempotencyKey('command', 'netting.set.compute', 'rt11-probe-set'),
      { nettingSetId: setId.nettingSetId },
      'Netting Authority',
    ),
  );
  await drain(composition);
  enqueueCommand(
    substrate,
    envelopeFor(
      'netting.set.commit',
      deriveIdempotencyKey('command', 'netting.set.commit', 'rt11-probe-set'),
      { nettingSetId: setId.nettingSetId },
      'Netting Authority',
    ),
  );
  await drain(composition);
  const persistedSets = readNettingSets(composition.stores.netting);
  assert.equal(persistedSets.length, 1);
  const nettingProbe = probeNettingConservation(persistedSets.map((record) => record.set));
  assert.equal(nettingProbe.holds, true, JSON.stringify(nettingProbe.violations));
  assert.equal(nettingProbe.inspected, 1);
  // The net obligations persisted too (one net flow between the pair).
  assert.equal(readNetObligations(composition.stores.netting).length, 1);

  await composition.close();
  return ['backlog:depth+age', 'INV-5-1:holds+detects-drift', 'INV-6-1:holds', 'INV-11-1:holds'];
}

// -- main ----------------------------------------------------------------------

let failure = null;
try {
  const e2e = await scenarioE2ECommandPath();
  console.log('[test:e2e-command-path] green:', e2e.join(' | '));
  const fourKinds = await scenarioFourKinds();
  console.log('[test:e2e-four-kinds] green:', fourKinds.join(' | '));
  const railsSingleWriter = await scenarioRailsSingleWriter();
  console.log('[test:rails-single-writer] green:', railsSingleWriter.join(' | '));
  const atomicity = await scenarioAtomicityRollback();
  console.log('[test:atomicity-rollback] green:', atomicity.join(' | '));
  const duplicates = await scenarioDuplicateRedelivery();
  console.log('[test:duplicate-redelivery] green:', duplicates.join(' | '));
  const restart = await scenarioRestartLeaseReclaim();
  console.log('[test:restart-lease-reclaim] green:', restart.join(' | '));
  const scheduler = await scenarioSchedulerTicks();
  console.log('[test:scheduler-ticks] green:', scheduler.join(' | '));
  const probes = await scenarioProbes();
  console.log('[test:probes] green:', probes.join(' | '));
  console.log('RTN-011 transition/hosting harness: all checks green.');
} catch (error) {
  failure = error;
  console.error('RTN-011 transition/hosting harness: FAILED.');
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
