#!/usr/bin/env node
/**
 * payswap3 · RTN-012 — The composed-journey evidence harness (the RTN wave
 * integration: gateway + transition runtime + every merged authority, over
 * the REAL A15 log and the REAL DEP-003 substrate).
 *
 * Plain-Node evidence suite for RTN-012's owned integration evidence (the
 * work order's core deliverable): the composed golden path, the composed
 * UNKNOWN paths, the RTN-003/RTN-004 real-log integration (the port test
 * doubles replaced by the real A15 log), duplicate/restart/replay safety
 * across the composed path, and evidence-chain hash verification over the
 * full composed journey log.
 *
 * Spec sources (binding):
 *   spec/protocol-runtime-work-orders/RTN-012.md — the acceptance matrix:
 *     - "Composed golden path: intent submit (via gateway) → authorize
 *       (compliance-gated) → route → reserve → fulfill → clear → obligate
 *       → net → settle (simulated rail) → finality — every step evidenced
 *       in the A15 log, chain-verified; the journey includes a
 *       rail-operation transition executed through the single-writer path
 *       (rtn-plan-rulings.md delta 1)."
 *     - "Composed UNKNOWN path: rail UNKNOWN at settlement → auto case →
 *       INVESTIGATING → RESOLVED_CONFIRMED → finality advances exactly
 *       once (and a RESOLVED_FAILED variant: new instruction, new
 *       evidence)."
 *     - "RTN-003/RTN-004 real-log integration verified (the port test
 *       doubles replaced by the real A15 log)."
 *     - "Duplicate/restart safety across the composed path (resubmission,
 *       worker restart, replay)."
 *     - "Evidence chain hash verification passes over the full composed
 *       journey log."
 *   spec/governance/parallel-execution.md ("Integration after constituent
 *     merges": "An integration PR re-runs the full assurance profile over
 *     the composed system ... constituent evidence does not compose").
 *   spec/governance/dogfooding-protocol.md (the journey-record standard
 *     the INTEGRATION-EVIDENCE.md companion documents for the nine
 *     reconciliation questions).
 *   spec/development-state/rtn-plan-rulings.md Q1/delta 1 (the
 *     rail-operation transition through the single-writer path), Q3 (the
 *     in-process composed form), delta 7 (the nine-questions evidence).
 *
 * Scenarios:
 *   0. [test:wave-barrel]     the RTN-012 wave barrel
 *                             (src/lib/protocol-runtime/index.ts) loads
 *                             under plain Node with type stripping and
 *                             exports the composed public surface (the
 *                             module map + composition order it documents).
 *   1. [test:golden-path]     THE composed golden path: rails adapter
 *                             register/activate + intent submit/authorize/
 *                             route + clearing batch open/stage/commit/
 *                             finalize + netting set open/compute/commit +
 *                             settlement instruction create + attempt
 *                             authorize/submit — ALL admitted through the
 *                             RTN-010 gateway onto the REAL durable
 *                             command path, executed by the RTN-011
 *                             transition runtime (the single writer), with
 *                             the rail-operation transitions
 *                             AUTHORIZED→SUBMITTED→PENDING executed through
 *                             that single-writer path (delta 1); the
 *                             compiler/policy/capability/reservation/
 *                             fulfillment/report/finality steps drive the
 *                             OWNING authorities' command surfaces (every
 *                             step evidenced in the REAL A15 log); FINAL
 *                             advances the obligation to SETTLED exactly
 *                             once; the full chain verifies.
 *   2. [test:unknown-confirmed] the composed UNKNOWN path: TRANSMIT_TIMEOUT
 *                             at settlement → the automatic area-14 case →
 *                             INVESTIGATING → RESOLVED_CONFIRMED → the
 *                             safe-resume → finality advances exactly once.
 *   3. [test:unknown-failed]  the RESOLVED_FAILED variant: the recovery
 *                             instruction is a NEW instruction with a NEW
 *                             rail idempotency key and NEW evidence;
 *                             it settles CONFIRMED and finality advances
 *                             exactly once.
 *   4. [test:risk-rails-real-log] RTN-003/RTN-004 real-log integration:
 *                             the REAL A16 risk authority (SCREENING_
 *                             COMPUTED / CHECK_DECIDED, plus a DENY rule
 *                             blocking authorization) and the REAL A13/A14
 *                             rails authorities (ADAPTER_STATE_CHANGED /
 *                             RAIL_OP_AUTHORIZED / RAIL_OP_SUBMITTED /
 *                             CASE_OPENED / CASE_RESOLVED / RAIL_OP_
 *                             REPORTED) write their records into the REAL
 *                             A15 log with REGISTRY authority names — the
 *                             owned port test doubles are replaced by the
 *                             real log, chain-verified and persisted.
 *   5. [test:duplicate-restart-safety] across the composed path:
 *                             resubmission (the RECORDED receipt, never a
 *                             second effect), worker restart (reserve →
 *                             execute → die → lease expiry → reclaim →
 *                             redeliver → replay → complete), and replay
 *                             (the redelivered execution returns the
 *                             recorded state — observation 'replayed').
 *   6. [test:chain-verification] the evidence-chain hash verification over
 *                             the FULL composed journey log: verifyAndRecord
 *                             VERIFIED, the pure verifyEvidenceChain over
 *                             every record, tamper detection on a mutated
 *                             copy, and the evidence-object-store
 *                             round-trip of every record.
 *   7. [test:determinism]     the composed golden journey runs twice; the
 *                             transcripts are identical (GC-1).
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
const MODULE_URL = (domain, name) => pathToFileURL(join(RUNTIME_DIR, domain, name)).href;
const DURABLE_URL = (name) => pathToFileURL(join(ROOT, 'src', 'lib', 'durable', name)).href;
const WAVE_BARREL_URL = pathToFileURL(join(RUNTIME_DIR, 'index.ts')).href;

const RESPAWN_ENV = 'PAYSWAP_RT12_TEST_RESPAWNED';
const tempDirs = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `payswap-rt12-${prefix}-`));
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
    console.error('node:sqlite / type stripping. The RTN-012 harness requires Node.js >= 22.6.');
    process.exit(1);
  }
  process.exit(typeof child.status === 'number' ? child.status : 1);
}

await ensureCapabilities();

// -- module loading (the merged leaf modules, like the RTN-011 harness) ------

const { listRecentEvents } = await import(DURABLE_URL('events.ts'));
const {
  openTransitionSubstrate,
  asTransitionSubstrate,
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
const { openIntentStore, readPaymentIntents } = await import(MODULE_URL('intent', 'persistence.ts'));
const { openReservationsStore } = await import(MODULE_URL('reservations', 'persistence.ts'));
const { openObligationsStore } = await import(MODULE_URL('obligations', 'persistence.ts'));
const { openSettlementStore } = await import(MODULE_URL('settlement', 'persistence.ts'));
const { openClearingStore } = await import(MODULE_URL('clearing', 'persistence.ts'));
const { openNettingStore } = await import(MODULE_URL('netting', 'persistence.ts'));
const { openQueuesStore } = await import(MODULE_URL('queues', 'persistence.ts'));
const { openRailsAuthorities } = await import(MODULE_URL('rails', 'runtime.ts'));
const { settlementPortFromAuthorities, obligationLedgerPortFromAuthority, nettingPortFromAuthority } = await import(
  MODULE_URL('settlement', 'ports.ts')
);
const { IntentAuthority } = await import(MODULE_URL('intent', 'authority.ts'));
const { PolicyAuthority } = await import(MODULE_URL('policy', 'authority.ts'));
const { CapabilityAuthority } = await import(MODULE_URL('capability', 'authority.ts'));
const { RoutingAuthority } = await import(MODULE_URL('routing', 'authority.ts'));
const { openReservationLedger } = await import(MODULE_URL('reservations', 'ledger.ts'));
const { createReservationAcquisitionPort } = await import(MODULE_URL('reservations', 'acquisition.ts'));
const { ObligationLedgerAuthority } = await import(MODULE_URL('obligations', 'authority.ts'));
const { NettingAuthority } = await import(MODULE_URL('netting', 'authority.ts'));
const { SettlementAuthority } = await import(MODULE_URL('settlement', 'authority.ts'));
const { ClearingAuthority } = await import(MODULE_URL('clearing', 'authority.ts'));
const { QueueAuthority } = await import(MODULE_URL('queues', 'authority.ts'));
const { SimulatedRail, createSimulatedRailAdapter } = await import(MODULE_URL('rails', 'adapters.ts'));
const { validateCommandEnvelope } = await import(MODULE_URL('kernel', 'envelope.ts'));
const { deriveProtocolId, deriveIdempotencyKey } = await import(MODULE_URL('kernel', 'identity.ts'));
const { protocolTime } = await import(MODULE_URL('kernel', 'time.ts'));
const { money } = await import(MODULE_URL('kernel', 'money.ts'));
const { createRiskComplianceAuthority } = await import(MODULE_URL('risk', 'authority.ts'));
const { subjectComplianceData } = await import(MODULE_URL('risk', 'subject.ts'));
const { fulfillmentPolicyDefinition } = await import(MODULE_URL('policy', 'evaluation.ts'));
const { demandDescriptor } = await import(MODULE_URL('intent', 'descriptor.ts'));
const { obligationIdForOriginRecord } = await import(MODULE_URL('obligations', 'state-machine.ts'));
const {
  netObligationIdFor,
  nettingSetIdForLabel,
} = await import(MODULE_URL('netting', 'state-machine.ts'));
const {
  settlementInstructionIdFor,
  railIdempotencyKeyForInstruction,
} = await import(MODULE_URL('settlement', 'state-machine.ts'));
const { clearingBatchId } = await import(MODULE_URL('clearing', 'summation.ts'));

// -- shared composition -------------------------------------------------------

const LEASE_MS = 40;
const EUR = (minor) => money('EUR', minor, 2);

/** The gateway's DOCUMENTED intent.submit body (COMMAND-SURFACE.md): the
 *  nested { descriptor: DemandDescriptor, priorIntentId? } form admitted by
 *  RTN-010's registry (executed by the integration adapter for defect D-1). */
function gatewayIntentSubmitBody(idempotencyKey) {
  return {
    descriptor: {
      amount: { currency: 'EUR', scale: 2, amountMinor: 200_00 },
      source: { currency: 'EUR', geography: 'DE', account: 'acct-alpha' },
      destination: { currency: 'EUR', geography: 'FR', account: 'acct-beta' },
      constraints: {
        deadlineEpochMs: 99_999_999,
        allowedRails: ['sim-bank'],
        costCeiling: { currency: 'EUR', scale: 2, amountMinor: 100_00 },
      },
      idempotencyKey,
    },
  };
}

/**
 * THE INTEGRATION ADAPTER for the FILED COMPOSITION DEFECT (defect D-1,
 * INTEGRATION-EVIDENCE.md): the merged RTN-010 gateway admits intent.submit
 * with the DOCUMENTED nested body — COMMAND-SURFACE.md: `descriptor`
 * (DemandDescriptor) + `priorIntentId?`, mirroring
 * IntentAuthority.submitIntent(descriptor, {priorIntentId}) — while the
 * merged RTN-011 hosted binding expects the RTN-011 harness's FLAT body
 * convention (amount/source/destination/constraints/idempotencyKey at the
 * body root). No single body satisfies both (the gateway rejects
 * undeclared fields; the binding throws on the nested form). This is a
 * sibling contract mismatch — NOT a composed-path invariant failure (no
 * state mutates outside the single-writer path; no GC/INV contract is
 * breached) — so per the work order it is FILED, not patched: this
 * adapter lives entirely in RTN-012's owned evidence surface, composes
 * the SAME owning authority command (IntentAuthority.submitIntent) with
 * the SAME persist hook, and keeps the gateway the sole admission point.
 * The adapter accepts the GATEWAY's documented contract.
 */
function intentSubmitGatewayBodyBinding(intent, persistIntent) {
  return {
    kind: 'intent.submit',
    authority: 'Intent Authority',
    owner: 'Intent Authority',
    async execute(envelope) {
      const body = envelope.body;
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new TypeError('intent.submit (integration adapter): body must be a record');
      }
      const descriptor = body.descriptor;
      if (descriptor === null || typeof descriptor !== 'object' || typeof descriptor.idempotencyKey !== 'string') {
        throw new TypeError(
          'intent.submit (integration adapter): body.descriptor must be a DemandDescriptor (validated at admission by the gateway\'s demandDescriptor minter)',
        );
      }
      const priorIntentId = body.priorIntentId;
      const result = await intent.submitIntent(
        descriptor,
        typeof priorIntentId === 'string' && priorIntentId.length > 0 ? { priorIntentId } : {},
      );
      if (!result.ok) {
        return { status: 'rejected', code: result.code };
      }
      persistIntent?.(result.intent, result.receipt);
      return {
        status: result.replayed ? 'replayed' : 'applied',
        summary: { intentId: result.intent.intentId, state: result.intent.state },
      };
    },
  };
}

/**
 * THE composed runtime: the RTN-011 hosting composition (substrate +
 * authorities + persist hooks + bindings + transition runtime) EXTENDED
 * with the RTN-012 integration surface — the RTN-010 gateway as the sole
 * admission point over the same durable command path, the REAL RTN-003
 * risk authority as the compliance gate, and the areas-2/3/4 authorities
 * the golden path drives directly (their command kinds have no hosted
 * transition bindings — the recorded sibling-vocabulary gap documented in
 * INTEGRATION-EVIDENCE.md; the owning authorities' own command surfaces
 * still write the real A15 evidence synchronously).
 */
async function composeComposedRuntime(options = {}) {
  const dir = options.dir ?? tempDir('composition');
  let wall = options.wall ?? 5_000;
  const clock = () => wall;
  const evidenceWallMs = options.evidenceWallMs ?? 1_000;

  // 1. SUBSTRATE — the real DEP-003 durable command path.
  const durableRuntime = openTransitionSubstrate({
    dbPath: join(dir, 'durable.sqlite'),
    workerId: options.workerId ?? 'rt12-harness-worker',
    concurrency: 1,
    leaseMs: options.leaseMs ?? LEASE_MS,
    pollIntervalMs: 5,
    backoffBaseMs: 10,
    backoffMaxMs: 50,
  });
  const substrate = asTransitionSubstrate(durableRuntime);

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

  // 3. AUTHORITIES — every merged authority over the one log.
  // A16 — the REAL risk/compliance authority (its SQLite store; its
  // SCREENING_COMPUTED / CHECK_DECIDED records land in the real log: the
  // RTN-003 real-log integration).
  const risk = createRiskComplianceAuthority({
    evidence,
    store: { dbPath: join(dir, 'risk.sqlite') },
  });
  // A01 — the intent authority gated by the REAL risk authority's gate.
  const intent = new IntentAuthority({
    evidence,
    gate: (subjectId) => risk.checkGate('intent.AUTHORIZATION', subjectId),
    wallClock: clock,
  });
  // A02/A03 — the policy + capability authorities (capability activation
  // gated by the real risk authority).
  const policy = new PolicyAuthority({ evidence, wallClock: clock });
  const capability = new CapabilityAuthority({
    evidence,
    gate: (subjectId) => risk.checkGate('capability.ACTIVATION', subjectId),
    wallClock: clock,
  });
  // A05 — the reservation ledger (the routing dispatch's acquisition
  // target; "reserve (ledger)").
  const reservations = await openReservationLedger({ evidence, wallClock: clock });
  // A04 — the routing authority over the real acquisition port.
  const routing = new RoutingAuthority({
    evidence,
    reservations: createReservationAcquisitionPort(reservations),
    wallClock: clock,
  });
  // A10/A11 — the obligation ledger + netting authority.
  const obligations = new ObligationLedgerAuthority({ evidence, wallClock: clock });
  const netting = new NettingAuthority({ evidence, obligations, wallClock: clock });
  // A13/A14 — the REAL rails authorities (evidence through the registry-
  // name adapter: the RTN-004 real-log integration).
  const railsAuthorities = openRailsAuthorities(
    { dbPath: join(dir, 'rails.sqlite') },
    { evidence: adaptRailEvidenceToRegistryNames(evidence), wallClock: clock },
  );
  const railAuthority = railsAuthorities.railAuthority;
  const reconciliation = railsAuthorities.reconciliation;
  // The simulated rail (the external-rail-adapters component's in-process
  // form: transmission-and-reporting only, no credentials — Q1/delta 1).
  const rail = new SimulatedRail('bank-1', options.railScript ?? {});
  const connection = createSimulatedRailAdapter(rail, { wallClock: clock });
  // A12 — the settlement and finality authority over the rails ports.
  const settlement = new SettlementAuthority({
    evidence,
    rails: settlementPortFromAuthorities(railAuthority, reconciliation),
    obligations: obligationLedgerPortFromAuthority(obligations),
    netting: nettingPortFromAuthority(netting),
    wallClock: clock,
  });
  obligations.settlementHold = (obligationId) =>
    settlement.isUnknownHeld({ kind: 'OBLIGATION', obligationId });
  // A09 — the clearing authority (sink = the obligation ledger).
  const clearing = new ClearingAuthority({ evidence, sink: obligations, wallClock: clock });
  // A08 — the queue authority.
  const queues = new QueueAuthority({ evidence, wallClock: clock });

  // 4. PERSIST HOOKS — the idempotent per-domain durable write-through.
  const intentStore = openIntentStore({ dbPath: join(dir, 'intent.sqlite') });
  const reservationsStore = openReservationsStore({ dbPath: join(dir, 'reservations.sqlite') });
  const obligationsStore = openObligationsStore({ dbPath: join(dir, 'obligations.sqlite') });
  const settlementStore = openSettlementStore({ dbPath: join(dir, 'settlement.sqlite') });
  const clearingStore = openClearingStore({ dbPath: join(dir, 'clearing.sqlite') });
  const nettingStore = openNettingStore({ dbPath: join(dir, 'netting.sqlite') });
  const queuesStore = openQueuesStore({ dbPath: join(dir, 'queues.sqlite') });
  const persist = buildDurablePersistHooks({
    intent: intentStore,
    reservations: reservationsStore,
    obligations: obligationsStore,
    settlement: settlementStore,
    clearing: clearingStore,
    netting: nettingStore,
    queues: queuesStore,
  });

  // 5. BINDINGS — the hosted command kinds on the substrate, with the
  //    intent.submit binding replaced by the integration adapter for the
  //    FILED defect D-1 (the gateway's documented nested body vs the
  //    RTN-011 flat-body convention — see intentSubmitGatewayBodyBinding).
  const mergedBindings = createAuthorityCommandBindings({
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
  const bindings = [
    ...mergedBindings.filter((binding) => binding.kind !== 'intent.submit'),
    intentSubmitGatewayBodyBinding(intent, persist.intent),
  ];

  // 6. TRANSITION — the single authoritative-state writer, registered.
  const runtime = createTransitionRuntime({ substrate, bindings });
  runtime.registerAll();

  // 7. GATEWAY — the RTN-012 composition: the sole admission point bound
  //    to the SAME durable command path (the merged RTN-010 surface).
  const gateway = new ProtocolGateway({
    evidence,
    queue: commandQueuePortFromDurableQueue(durableRuntime.queue),
    wallClock: clock,
  });

  return {
    dir,
    durableRuntime,
    substrate,
    runtime,
    gateway,
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
    },
    authorities: { risk, intent, policy, capability, routing, reservations, obligations, netting, settlement, clearing, queues },
    rails: { railAuthority, reconciliation },
    rail,
    connection,
    adapterId: deriveProtocolId('rail-adapter', 'sim-bank', 'primary'),
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
      for (const store of [
        intentStore,
        reservationsStore,
        obligationsStore,
        settlementStore,
        clearingStore,
        nettingStore,
        queuesStore,
        evidenceStore,
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

/**
 * Admit one command through THE GATEWAY (the sole admission point), then
 * drain the durable command path so the transition runtime executes it.
 * Asserts admission + execution, and returns the admission result.
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
  assert.equal(admission.created, true, `the first admission of ${kind} creates the durable job`);
  await drain(composition);
  return admission;
}

function operationTypes(composition) {
  return composition.log.records().map((record) => record.what.operationType);
}

function countType(composition, type) {
  return operationTypes(composition).filter((candidate) => candidate === type).length;
}

function executedObservations(composition) {
  // listRecentEvents is newest-first; the harness narrates chronologically.
  return listRecentEvents(composition.durableRuntime.database, 800)
    .filter((event) => event.type === COMMAND_EXECUTED_EVENT_TYPE)
    .map((event) => ({ ...(event.data ?? {}), jobId: event.jobId, owner: event.owner }))
    .reverse();
}

/**
 * Drive the REAL risk authority's approval for one gate subject: register
 * the screening list once per composition (append-only by version — the
 * guard makes the helper idempotent), evaluate + decide the check. The
 * check lands in the risk SQLite store with SCREENING_COMPUTED +
 * CHECK_DECIDED records in the real A15 log.
 */
async function approveGateSubject(composition, subjectId, subjectKind, when) {
  const { risk } = composition.authorities;
  if (!composition.screeningListRegistered) {
    risk.registerScreeningList({ listId: 'sanctions', version: 1, entries: [] }, when);
    composition.screeningListRegistered = true;
  }
  const subject = subjectComplianceData({
    subjectId,
    subjectKind,
    ...(subjectKind === 'INTENT'
      ? { moneyFacts: [{ currency: 'EUR', amountMinor: 200_00 }] }
      : { countFacts: [{ name: 'rails', count: 1 }] }),
  });
  const check = await risk.evaluateAndRecordCheck(subject, 'sanctions', when);
  const decided = await risk.decideCheck(check.checkId, when);
  assert.equal(decided.state, 'APPROVED', `the gate check for ${subjectId} must be APPROVED`);
  return decided;
}

// ---------------------------------------------------------------------------
// Scenario 0 — [test:wave-barrel]
// ---------------------------------------------------------------------------

async function scenarioWaveBarrel() {
  const barrel = await import(WAVE_BARREL_URL);
  const names = Object.keys(barrel);
  assert.ok(names.length >= 150, `the wave barrel exports the composed surface (found ${names.length} exports)`);
  const required = [
    // kernel + evidence
    'money', 'protocolTime', 'deriveProtocolId', 'validateCommandEnvelope', 'createEvidenceLog',
    'EVIDENCE_AUTHORITIES', 'verifyEvidenceChain',
    // authorities (the operational spine A01-A16)
    'createRiskComplianceAuthority', 'IntentAuthority', 'PolicyAuthority', 'CapabilityAuthority',
    'RoutingAuthority', 'ReservationLedger', 'openReservationLedger', 'LiquidityAuthority',
    'CreditAuthority', 'QueueAuthority', 'ClearingAuthority', 'ObligationLedgerAuthority',
    'NettingAuthority', 'SettlementAuthority', 'RailAdapterAuthority', 'ReconciliationAuthority',
    'createRailsAuthorities', 'SimulatedRail', 'createSimulatedRailAdapter',
    // admission + single writer + hosting
    'ProtocolGateway', 'commandQueuePortFromDurableQueue', 'TransitionRuntime',
    'createTransitionRuntime', 'createAuthorityCommandBindings', 'openTransitionSubstrate',
    'adaptRailEvidenceToRegistryNames', 'buildDurablePersistHooks', 'wireRecurringCommandEmitters',
    'transitionBacklogSnapshot', 'settlementPortFromAuthorities',
  ];
  const missing = required.filter((name) => !(name in barrel));
  assert.deepEqual(missing, [], 'the wave barrel must export every composed-surface entry point');
  return [`exports:${names.length}`];
}

// ---------------------------------------------------------------------------
// Scenario 1/2/3 — the composed golden path (+ the UNKNOWN variants)
// ---------------------------------------------------------------------------

/**
 * THE composed journey. One deterministic run from intent submission to
 * finality, returning the step transcript. The rail script decides the
 * settlement outcome: {} → the default ACCEPT_NO_REPORT? NO — the caller
 * always scripts the net-position instruction's key: ACCEPT_REPORT_
 * CONFIRMED (golden) or TRANSMIT_TIMEOUT (the UNKNOWN variants).
 */
async function runComposedJourney(railScenario, journeyOptions = {}) {
  // unknownResolution: 'RESOLVED_CONFIRMED' (the journey resolves the
  // auto-case itself and advances finality) or 'NONE' (the journey stops
  // after the durable UNKNOWN state + the auto-case — the scenario drives
  // the terminal resolution; the RESOLVED_FAILED variant).
  const unknownResolution = journeyOptions.unknownResolution ?? 'RESOLVED_CONFIRMED';
  // The deterministic identity chain, computable up front (fixed inputs):
  // the netting set id from the label; the largest net obligation (alpha
  // owes gamma 4_000 minor — the fixed gross fixtures below net to alpha
  // -4_000, beta -1_000, gamma +5_000); the instruction id from ordinal 1;
  // the rail key from the instruction id.
  const SET_LABEL = 'golden-net-1';
  const setId = nettingSetIdForLabel(SET_LABEL);
  const netObligationId = netObligationIdFor(setId, 'alpha', 'gamma', 'EUR');
  const instructionId = settlementInstructionIdFor({ kind: 'NET_POSITION', netObligationId }, 1);
  const railKey = railIdempotencyKeyForInstruction(instructionId);
  const BATCH_LABEL = 'golden-batch-1';
  const batchId = clearingBatchId(BATCH_LABEL);
  const adapterId = deriveProtocolId('rail-adapter', 'sim-bank', 'primary');

  const composition = await composeComposedRuntime({
    railScript: { [railKey]: railScenario, ...(journeyOptions.extraRailScript ?? {}) },
  });
  const transcript = [];
  const note = (step) => transcript.push(step);
  const { authorities, rails } = composition;
  const submit = (kind, authority, body, key, subjects) =>
    submitViaGateway(composition, kind, authority, body, key, subjects);

  // --- (0) the A16 gate substrate: the screening list (registered once —
  //     list versions are append-only). ---
  if (!composition.screeningListRegistered) {
    authorities.risk.registerScreeningList(
      { listId: 'sanctions', version: 1, entries: [] },
      protocolTime(1, 1_000),
    );
    composition.screeningListRegistered = true;
  }

  // --- (1) rails adapter register + activate — VIA THE GATEWAY (the
  //     A13 command surface on the single-writer path). ---
  await submit('rails.adapter.register', 'Rail Authority', { railFamily: 'sim-bank', name: 'primary' }, 'rails-register-1');
  await submit('rails.adapter.activate', 'Rail Authority', { adapterId }, 'rails-activate-1', [adapterId]);
  assert.equal(rails.railAuthority.getAdapter(adapterId)?.status, 'ACTIVE');
  note('adapter:ACTIVE');

  // --- (2) capability register + gate + activate (A03 direct — the
  //     compliance-gated capability activation via the REAL risk gate). ---
  const registered = await authorities.capability.registerCapability({
    capabilityId: 'cap-eur',
    declaration: {
      railId: 'sim-bank',
      corridor: { sourceCurrency: 'EUR', sourceGeography: 'DE', destinationCurrency: 'EUR', destinationGeography: 'FR' },
      costSchedule: EUR(50),
      tier: 'standard',
    },
    declaredCapacity: EUR(500_00),
  });
  assert.equal(registered.ok, true);
  await approveGateSubject(composition, 'cap-eur', 'CAPABILITY_REGISTRATION', protocolTime(2, 2_000));
  const activated = await authorities.capability.activateCapability('cap-eur');
  assert.equal(activated.ok, true);
  const snapshot = authorities.capability.snapshot();
  note('capability:ACTIVE');

  // --- (3) policy author + publish (A02 direct). ---
  await authorities.policy.authorPolicy('policy-golden', fulfillmentPolicyDefinition({
    allowedRails: ['sim-bank'],
    ordering: 'COST_ASC',
    costCeiling: EUR(300_00),
    deadlineEpochMs: 99_999_999,
    fallbackPreference: [],
  }));
  await authorities.policy.publishPolicyVersion('policy-golden');
  note('policy:published');

  // --- (4) INTENT SUBMIT — VIA THE GATEWAY (the work order's
  //     "intent submit (via gateway)": gateway → durable queue → worker →
  //     transition runtime → IntentAuthority.submitIntent; the body is the
  //     gateway's DOCUMENTED nested form — COMMAND-SURFACE.md — executed
  //     by the integration adapter for the filed defect D-1). ---
  const INTENT_KEY = 'golden-intent-1';
  const intentBody = gatewayIntentSubmitBody(INTENT_KEY);
  const intentAdmission = await submit('intent.submit', 'Intent Authority', intentBody, deriveIdempotencyKey('command', 'intent.submit', INTENT_KEY));
  const intentId = authorities.intent.getReceipt(INTENT_KEY).intentId;
  assert.equal(authorities.intent.getIntent(intentId)?.state, 'DRAFT');
  assert.equal(countType(composition, 'INTENT_CREATED'), 1);
  note(`intent:${intentId}:DRAFT`);
  const jobId = intentAdmission.jobId;
  assert.equal(composition.durableRuntime.queue.getJob(jobId).status, 'succeeded');

  // --- (5) the A16 compliance check for the intent subject — the REAL
  //     risk authority (RTN-003 real-log integration). ---
  await approveGateSubject(composition, intentId, 'INTENT', protocolTime(3, 3_000));

  // --- (6) policy attach + evaluate (A02 direct). ---
  const attached = await authorities.policy.attachPolicy({
    policyId: 'policy-golden',
    version: 1,
    intentId,
    snapshotId: snapshot.snapshotId,
  });
  assert.equal(attached.ok, true);
  const terms = {
    amount: EUR(200_00),
    sourceCurrency: 'EUR',
    destinationCurrency: 'EUR',
    sourceGeography: 'DE',
    destinationGeography: 'FR',
    deadlineEpochMs: 99_999_999,
    allowedRails: ['sim-bank'],
    costCeiling: EUR(100_00),
  };
  const evaluation = await authorities.policy.evaluatePolicy({
    policyId: 'policy-golden',
    version: 1,
    intentId,
    intentTerms: terms,
    snapshot,
  });
  assert.equal(evaluation.ok, true);
  const evaluationRecord = evaluation.ok ? evaluation.record : undefined;
  assert.equal(evaluationRecord?.outcome.satisfiable, true);
  note('policy:satisfiable');

  // --- (7) AUTHORIZE — VIA THE GATEWAY (compliance-gated: the authority's
  //     gate reads the REAL risk authority's APPROVED check). ---
  await submit('intent.authorize', 'Intent Authority', { intentId, policyDecisionId: evaluationRecord?.evaluationId ?? '' }, deriveIdempotencyKey('command', 'intent.authorize', intentId), [intentId]);
  assert.equal(authorities.intent.getIntent(intentId)?.state, 'AUTHORIZED');
  assert.equal(countType(composition, 'INTENT_AUTHORIZED'), 1);
  note('intent:AUTHORIZED');

  // --- (8) ROUTE (the compiler) — A04 direct: compile + validate. ---
  const compiled = await authorities.routing.compileRoute({
    intentId,
    intentTerms: terms,
    policyEvaluation: evaluationRecord?.outcome,
    snapshot,
    conversions: [],
  });
  assert.equal(compiled.ok, true);
  const plan = compiled.ok ? compiled.plan : undefined;
  assert.equal(plan?.hops.length, 1);
  assert.equal(plan?.hops[0]?.capabilityId, 'cap-eur');
  await authorities.routing.validatePlan(plan?.planId ?? '');
  assert.equal(countType(composition, 'ROUTE_COMPILED'), 1);
  assert.equal(countType(composition, 'ROUTE_VALIDATED'), 1);
  note('route:compiled:validated');

  // --- (9) the intent ROUTED transition — VIA THE GATEWAY. ---
  await submit('intent.route', 'Intent Authority', { intentId }, deriveIdempotencyKey('command', 'intent.route', intentId), [intentId]);
  assert.equal(authorities.intent.getIntent(intentId)?.state, 'ROUTED');
  note('intent:ROUTED');

  // --- (10) RESERVE (the ledger) — the plan dispatch acquires the
  //      reservations in fixed hop order (A04→A05, direct). ---
  await authorities.reservations.declareResource('cap-eur', EUR(500_00));
  const dispatched = await authorities.routing.dispatchPlan(plan?.planId ?? '');
  assert.equal(dispatched.ok, true);
  const accounting = authorities.reservations.resourceAccounting('cap-eur');
  assert.equal(accounting?.heldTotal.amountMinor, 200_00);
  assert.equal(countType(composition, 'RESERVATION_HELD'), 1);
  note('reserve:HELD');

  // --- (11) FULFILL — the A01/A02/A03 fulfillment chain (direct). ---
  await authorities.intent.startFulfillingIntent(intentId);
  await authorities.policy.consumeEvaluation(evaluationRecord?.evaluationId ?? '');
  const realCommitmentId = deriveProtocolId('commitment', intentId, 'cap-eur');
  assert.notEqual(realCommitmentId, undefined);
  const offered = await authorities.capability.offerCommitment({
    intentId,
    capabilityId: 'cap-eur',
    amount: EUR(200_00),
    deadlineEpochMs: 99_999_999,
  });
  assert.equal(offered.ok, true);
  await authorities.capability.reserveCommitment(realCommitmentId);
  await authorities.capability.consumeCommitment(realCommitmentId);
  await authorities.intent.fulfillIntent(intentId);
  assert.equal(authorities.intent.getIntent(intentId)?.state, 'FULFILLED');
  await authorities.routing.completePlan(plan?.planId ?? '');
  const consumedAccounting = authorities.reservations.resourceAccounting('cap-eur');
  assert.equal(consumedAccounting?.heldTotal.amountMinor, 0);
  assert.equal(consumedAccounting?.consumedTotal.amountMinor, 200_00);
  assert.equal(countType(composition, 'COMMITMENT_CONSUMED'), 1);
  assert.equal(countType(composition, 'RESERVATION_CONSUMED'), 1);
  note('intent:FULFILLED');

  // --- (12) CLEAR (the batch) — open/stage/commit/finalize VIA THE
  //      GATEWAY; the records stage directly (no hosted binding for
  //      clearing.record.add — the sibling-vocabulary gap). ---
  await submit('clearing.batch.open', 'Clearing Authority', { batchLabel: BATCH_LABEL }, deriveIdempotencyKey('command', 'clearing.open', BATCH_LABEL));
  const gross = [
    { id: 'g1', debtor: 'alpha', creditor: 'beta', amount: 10_000 },
    { id: 'g2', debtor: 'beta', creditor: 'alpha', amount: 4_000 },
    { id: 'g3', debtor: 'beta', creditor: 'gamma', amount: 7_000 },
    { id: 'g4', debtor: 'gamma', creditor: 'alpha', amount: 2_000 },
  ];
  for (const entry of gross) {
    const staged = await authorities.clearing.addRecord(batchId, {
      origin: { originActivityId: `activity-${entry.id}`, originKind: 'INTENT' },
      parties: { debtorParticipantId: entry.debtor, creditorParticipantId: entry.creditor },
      amount: EUR(entry.amount),
      reason: 'composed golden journey fixture',
    });
    assert.equal(staged.ok, true, `clearing record ${entry.id} must stage`);
  }
  await submit('clearing.batch.stage', 'Clearing Authority', { batchId }, deriveIdempotencyKey('command', 'clearing.stage', BATCH_LABEL), [batchId]);
  await submit('clearing.batch.commit', 'Clearing Authority', { batchId }, deriveIdempotencyKey('command', 'clearing.commit', BATCH_LABEL), [batchId]);
  await submit('clearing.batch.finalize', 'Clearing Authority', { batchId }, deriveIdempotencyKey('command', 'clearing.finalize', BATCH_LABEL), [batchId]);
  // OBLIGATE (the ledger): the commit flowed the records to the A10 sink
  // (fresh gross obligations in CREATED — the written chain CREATED ->
  // NETTED -> SETTLEMENT_PENDING -> SETTLED).
  const obligationsList = authorities.obligations.obligations();
  assert.equal(obligationsList.length, 4);
  assert.equal(countType(composition, 'OBLIGATION_CREATED'), 4);
  assert.equal(obligationsList.every((record) => record.state === 'CREATED'), true);
  note(`obligations:${obligationsList.length}:CREATED`);

  // --- (13) NET (conservation) — open/compute/commit VIA THE GATEWAY. ---
  await submit('netting.set.open', 'Netting Authority', {
    label: SET_LABEL,
    scope: { kind: 'MULTILATERAL', participants: ['alpha', 'beta', 'gamma'] },
    inputObligationIds: obligationsList.map((record) => record.obligationId),
  }, deriveIdempotencyKey('command', 'netting.open', SET_LABEL));
  await submit('netting.set.compute', 'Netting Authority', { nettingSetId: setId }, deriveIdempotencyKey('command', 'netting.compute', SET_LABEL), [setId]);
  const committedNet = await submit('netting.set.commit', 'Netting Authority', { nettingSetId: setId }, deriveIdempotencyKey('command', 'netting.commit', SET_LABEL), [setId]);
  assert.equal(committedNet.created, true);
  const netObligations = authorities.netting.netObligationsOfSet(setId);
  // alpha: -10000+4000+2000 = -4000; beta: 10000-4000-7000 = -1000;
  // gamma: 7000-2000 = +5000 — the net positions replace the gross set.
  assert.equal(netObligations.length, 2);
  assert.equal(netObligations.reduce((acc, entry) => acc + entry.amount.amountMinor, 0), 5_000);
  note(`net:${netObligations.length}:sums:5000`);

  // --- (14) SETTLE (the simulated rail) — create/authorize/submit VIA THE
  //      GATEWAY. The attempt authorization + submission drive the A13
  //      rail-operation transitions AUTHORIZED → SUBMITTED → PENDING
  //      THROUGH THE SINGLE-WRITER PATH (rtn-plan-rulings.md Q1/delta 1). ---
  await submit('settlement.instruction.create', 'Settlement and Finality Authority', {
    subject: { kind: 'NET_POSITION', netObligationId },
    beneficiary: 'acct-gamma',
    memo: 'composed golden journey net settlement',
  }, deriveIdempotencyKey('command', 'settlement.create', netObligationId), [netObligationId]);
  assert.equal(authorities.settlement.instruction(instructionId)?.state, 'CREATED');
  assert.equal(authorities.netting.netObligation(netObligationId)?.state, 'SETTLEMENT_PENDING');
  note('instruction:CREATED');
  await submit('settlement.attempt.authorize', 'Settlement and Finality Authority', {
    instructionId,
    adapterId,
  }, deriveIdempotencyKey('command', 'settlement.authorize', instructionId), [instructionId]);
  assert.equal(authorities.settlement.instruction(instructionId)?.state, 'ISSUED');
  const operationId = deriveProtocolId('rail-operation', instructionId);
  const operation = rails.railAuthority.getOperation(operationId);
  assert.equal(operation?.status, 'AUTHORIZED');
  assert.equal(countType(composition, 'RAIL_OP_AUTHORIZED'), 1);
  note('railop:AUTHORIZED');
  await submit('settlement.attempt.submit', 'Settlement and Finality Authority', {
    instructionId,
  }, deriveIdempotencyKey('command', 'settlement.submit', instructionId), [instructionId]);
  const attempt = authorities.settlement.attemptForInstruction(instructionId);
  note(`attempt:${attempt?.state}`);

  // --- (15) the outcome branches (the rail script decides). ---
  if (attempt?.state === 'PENDING') {
    // The report-driven confirmed path (direct): the adapter reports, the
    // A13 command records the report (external evidence), A12 mirrors it.
    const report = composition.connection.fetchReport(railKey);
    assert.equal(report.outcomeClass, 'CONFIRMED');
    const recorded = rails.railAuthority.recordReport(attempt.operationId, report);
    assert.equal(recorded.ok, true);
    // Two RAIL_OP_REPORTED records: the submission's own report class (at
    // submitRailOperation) + the final statement ingestion.
    assert.equal(countType(composition, 'RAIL_OP_REPORTED'), 2);
    const mirrored = await authorities.settlement.applyRailOutcome(instructionId);
    assert.equal(mirrored.ok, true);
    note(`resolved:${mirrored.ok ? mirrored.value.attempt.state : ''}`);
  } else if (attempt?.state === 'UNKNOWN') {
    // The composed UNKNOWN path: the durable UNKNOWN state (the
    // instruction stays ISSUED; the net position stays
    // SETTLEMENT_PENDING), the INV-14-1 auto-case, and the re-submission
    // refusals (INV-12-2 / the A13 no-re-submission rule).
    assert.equal(authorities.settlement.instruction(instructionId)?.state, 'ISSUED');
    assert.equal(authorities.netting.netObligation(netObligationId)?.state, 'SETTLEMENT_PENDING');
    const caseRecord = rails.reconciliation.getCaseByOriginOperation(attempt.operationId);
    assert.ok(caseRecord !== undefined);
    assert.equal(caseRecord.status, 'OPEN');
    assert.equal(attempt.reconciliationCaseId, caseRecord.caseId);
    note(`case:${caseRecord.caseId}`);
    // INV-12-2: the second attempt authorization is refused while UNKNOWN.
    const second = await authorities.settlement.authorizeAttempt(instructionId, adapterId);
    assert.equal(second.ok, false);
    assert.equal(second.code, 'LIVE_ATTEMPT_EXISTS');
    // GC-2: finality is blocked until reconciliation resolves.
    const blocked = await authorities.settlement.declareFinality(instructionId);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'UNKNOWN_HELD');
    note('held:UNKNOWN_HELD');
    if (unknownResolution === 'RESOLVED_CONFIRMED') {
      // INVESTIGATING → the terminal resolution.
      assert.equal(rails.reconciliation.investigateCase(caseRecord.caseId).ok, true);
      const resolved = rails.reconciliation.resolveCase(caseRecord.caseId, {
        resolution: 'RESOLVED_CONFIRMED',
        proof: { externalRefs: ['bank-statement-golden'] },
      });
      assert.equal(resolved.ok, true);
      assert.equal(resolved.ok ? resolved.value.operation.status : '', 'CONFIRMED');
      assert.equal(resolved.ok ? resolved.value.recovery.feed : '', 'AREA_12_FINALITY_ADVANCE');
      note(`resolved:${resolved.ok ? resolved.value.case.status : ''}`);
      // The safe-resume: the recovery directive applies through A12.
      const resumed = await authorities.settlement.applyResolution(
        resolved.ok ? resolved.value.recovery : null,
        caseRecord.caseId,
      );
      assert.equal(resumed.ok, true);
      note(`resumed:${resumed.ok ? resumed.value.attempt.state : ''}`);
    }
  }

  // --- (16) FINALITY — FINAL advances the obligation to SETTLED exactly
  //      once (direct: the gateway kind has no identically-named hosted
  //      binding — the sibling-vocabulary gap). Skipped in the NONE mode:
  //      the net position stays UNKNOWN-held for the scenario's own
  //      resolution. ---
  if (unknownResolution !== 'NONE') {
    const declared = await authorities.settlement.declareFinality(instructionId);
    assert.equal(declared.ok, true);
    assert.equal(declared.ok ? declared.value.state : '', 'FINAL');
    assert.equal(authorities.netting.netObligation(netObligationId)?.state, 'SETTLED');
    const again = await authorities.settlement.declareFinality(instructionId);
    assert.equal(again.ok, false);
    assert.equal(again.code, 'FINALITY_ALREADY_DECLARED');
    // Two FINALITY_DECLARED records: the PROVISIONAL advance (the mirror
    // path) + the FINAL declaration; the FINAL advance happened exactly
    // once (the second declaration is refused above).
    assert.equal(countType(composition, 'FINALITY_DECLARED'), 2);
    note(`finality:FINAL:SETTLED`);
  }

  // --- (17) the full composed journey log verifies (chain hash). ---
  const verification = composition.log.verifyAndRecord(composition.wall + 1);
  assert.equal(verification.verdict, 'VERIFIED');
  note(`chain:${verification.verdict}`);

  // The caller owns closing the composition (scenarios read the durable
  // artifacts after the journey).
  return { transcript, composition };
}

// ---------------------------------------------------------------------------
// Scenario 1 — [test:golden-path]
// ---------------------------------------------------------------------------

async function scenarioGoldenPath() {
  const { transcript, composition } = await runComposedJourney('ACCEPT_REPORT_CONFIRMED');
  // The golden path's own assertions live in runComposedJourney; here the
  // scenario pins the required transcript shape.
  assert.ok(transcript.some((step) => step === 'adapter:ACTIVE'));
  assert.ok(transcript.some((step) => step.startsWith('intent:')));
  assert.ok(transcript.some((step) => step === 'intent:AUTHORIZED'));
  assert.ok(transcript.some((step) => step === 'route:compiled:validated'));
  assert.ok(transcript.some((step) => step === 'reserve:HELD'));
  assert.ok(transcript.some((step) => step === 'intent:FULFILLED'));
  assert.ok(transcript.some((step) => step.startsWith('obligations:4:CREATED')));
  assert.ok(transcript.some((step) => step.startsWith('net:2:')));
  assert.ok(transcript.some((step) => step === 'instruction:CREATED'));
  assert.ok(transcript.some((step) => step === 'railop:AUTHORIZED'));
  assert.ok(transcript.some((step) => step.startsWith('attempt:PENDING')));
  assert.ok(transcript.some((step) => step.startsWith('resolved:CONFIRMED')));
  assert.ok(transcript.some((step) => step === 'finality:FINAL:SETTLED'));
  assert.equal(transcript[transcript.length - 1], 'chain:VERIFIED');
  // The gateway-admitted commands' observation rows: every hosted-command
  // execution recorded an authority-owned observation with 'applied'.
  const observations = executedObservations(composition);
  const gatewayKinds = [
    'rails.adapter.register', 'rails.adapter.activate', 'intent.submit', 'intent.authorize',
    'intent.route', 'clearing.batch.open', 'clearing.batch.stage', 'clearing.batch.commit',
    'clearing.batch.finalize', 'netting.set.open', 'netting.set.compute', 'netting.set.commit',
    'settlement.instruction.create', 'settlement.attempt.authorize', 'settlement.attempt.submit',
  ];
  for (const kind of gatewayKinds) {
    const rows = observations.filter((row) => row.kind === kind);
    assert.equal(rows.length, 1, `exactly one observation row for ${kind}`);
    assert.equal(rows[0].status, 'applied', `${kind} must be applied`);
  }
  const owners = new Map(observations.map((row) => [row.kind, row.owner]));
  assert.equal(owners.get('intent.submit'), 'Intent Authority');
  assert.equal(owners.get('rails.adapter.register'), 'Rail Authority');
  assert.equal(owners.get('clearing.batch.commit'), 'Clearing Authority');
  assert.equal(owners.get('netting.set.commit'), 'Netting Authority');
  assert.equal(owners.get('settlement.attempt.submit'), 'Settlement and Finality Authority');
  await composition.close();
  return transcript;
}

// ---------------------------------------------------------------------------
// Scenario 2 — [test:unknown-confirmed]
// ---------------------------------------------------------------------------

async function scenarioUnknownConfirmed() {
  const { transcript } = await runComposedJourney('TRANSMIT_TIMEOUT');
  assert.ok(transcript.some((step) => step.startsWith('attempt:UNKNOWN')));
  assert.ok(transcript.some((step) => step.startsWith('case:')));
  assert.ok(transcript.some((step) => step === 'held:UNKNOWN_HELD'));
  assert.ok(transcript.some((step) => step.startsWith('resolved:RESOLVED_CONFIRMED')));
  assert.ok(transcript.some((step) => step.startsWith('resumed:CONFIRMED')));
  assert.ok(transcript.some((step) => step === 'finality:FINAL:SETTLED'));
  assert.equal(transcript[transcript.length - 1], 'chain:VERIFIED');
  // Finality advanced exactly once through the UNKNOWN resolution.
  return transcript;
}

// ---------------------------------------------------------------------------
// Scenario 3 — [test:unknown-failed] (the RESOLVED_FAILED variant)
// ---------------------------------------------------------------------------

async function scenarioUnknownFailed() {
  // Same composed journey, but the net-position rail times out and the
  // case resolves RESOLVED_FAILED: the attempt/instruction go FAILED, and
  // the recovery is a NEW instruction (new id, new rail idempotency key,
  // new evidence) that settles CONFIRMED.
  const SET_LABEL = 'golden-net-1';
  const setId = nettingSetIdForLabel(SET_LABEL);
  const netObligationId = netObligationIdFor(setId, 'alpha', 'gamma', 'EUR');
  const netInstructionId = settlementInstructionIdFor({ kind: 'NET_POSITION', netObligationId }, 1);
  const netKey = railIdempotencyKeyForInstruction(netInstructionId);
  // The recovery subject: a fresh direct obligation (every input
  // obligation is netted; create a new one — the RTN-009 journey
  // precedent), with its own deterministic instruction + rail key.
  const RECOVERY_RECORD = 'g9';
  const recoveryObligationId = obligationIdForOriginRecord(RECOVERY_RECORD);
  const recoveryInstructionId = settlementInstructionIdFor({ kind: 'OBLIGATION', obligationId: recoveryObligationId }, 1);
  const recoveryKey = railIdempotencyKeyForInstruction(recoveryInstructionId);

  const { transcript, composition } = await runComposedJourney('TRANSMIT_TIMEOUT', {
    unknownResolution: 'NONE', // the scenario drives the RESOLVED_FAILED terminal
    // The recovery instruction's rail is scripted CONFIRMED (the same
    // composition hosts both the timed-out net-position rail key and the
    // recovery rail key).
    extraRailScript: { [recoveryKey]: 'ACCEPT_REPORT_CONFIRMED' },
  });
  const { authorities, rails } = composition;
  void netKey;

  // The attempt must have gone UNKNOWN → the auto-case → RESOLVED_FAILED.
  const attempt = authorities.settlement.attemptForInstruction(netInstructionId);
  assert.equal(attempt?.state, 'UNKNOWN');
  const caseRecord = rails.reconciliation.getCaseByOriginOperation(attempt?.operationId ?? '');
  assert.ok(caseRecord !== undefined);
  assert.equal(rails.reconciliation.investigateCase(caseRecord.caseId).ok, true);
  const resolved = rails.reconciliation.resolveCase(caseRecord.caseId, {
    resolution: 'RESOLVED_FAILED',
    proof: { externalRefs: ['bank-statement-failed-variant'] },
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.ok ? resolved.value.operation.status : '', 'FAILED');
  assert.equal(resolved.ok ? resolved.value.recovery.feed : '', 'AREA_12_NEW_INSTRUCTION');
  const resumed = await authorities.settlement.applyResolution(
    resolved.ok ? resolved.value.recovery : null,
    caseRecord.caseId,
  );
  assert.equal(resumed.ok, true);
  assert.equal(resumed.ok ? resumed.value.attempt.state : '', 'FAILED');
  assert.equal(resumed.ok ? resumed.value.instruction.state : '', 'FAILED');
  transcript.push(`failed:${resumed.ok ? resumed.value.attempt.state : ''}`);

  // The recovery: a NEW obligation + a NEW instruction (new id + new key).
  const fresh = await authorities.obligations.applyClearingCommand({
    batchId: 'batch-golden-recovery',
    recordId: RECOVERY_RECORD,
    originActivityId: `activity-${RECOVERY_RECORD}`,
    originKind: 'INTENT',
    debtorParticipantId: 'alpha',
    creditorParticipantId: 'gamma',
    amount: EUR(900),
    reason: 'composed recovery fixture',
  });
  assert.equal(fresh.obligationId, recoveryObligationId);
  const recovery = await authorities.settlement.createSettlementInstruction({
    subject: { kind: 'OBLIGATION', obligationId: recoveryObligationId },
    beneficiary: 'acct-gamma',
  });
  assert.equal(recovery.ok, true);
  assert.equal(recovery.ok ? recovery.value.instructionId : '', recoveryInstructionId);
  assert.notEqual(recoveryKey, railIdempotencyKeyForInstruction(netInstructionId));
  transcript.push(`recovery:${recovery.ok ? recovery.value.subjectOrdinal : ''}:new-key`);

  // The recovery instruction settles CONFIRMED: authorize → submit (the
  // recovery rail script) → report → finality → SETTLED exactly once.
  const adapterId = composition.adapterId;
  const authorized = await authorities.settlement.authorizeAttempt(recoveryInstructionId, adapterId);
  assert.equal(authorized.ok, true);
  const submitted = await authorities.settlement.submitAttempt(recoveryInstructionId, composition.connection);
  assert.equal(submitted.ok, true);
  assert.equal(submitted.ok ? submitted.value.attempt.state : '', 'PENDING');
  const report = composition.connection.fetchReport(recoveryKey);
  assert.equal(report.outcomeClass, 'CONFIRMED');
  const recorded = rails.railAuthority.recordReport(
    (authorities.settlement.attemptForInstruction(recoveryInstructionId))?.operationId ?? '',
    report,
  );
  assert.equal(recorded.ok, true);
  const mirrored = await authorities.settlement.applyRailOutcome(recoveryInstructionId);
  assert.equal(mirrored.ok, true);
  assert.equal(mirrored.ok ? mirrored.value.attempt.state : '', 'CONFIRMED');
  transcript.push(`recovery:CONFIRMED`);
  const declared = await authorities.settlement.declareFinality(recoveryInstructionId);
  assert.equal(declared.ok, true);
  assert.equal(authorities.obligations.obligation(recoveryObligationId)?.state, 'SETTLED');
  const again = await authorities.settlement.declareFinality(recoveryInstructionId);
  assert.equal(again.ok, false);
  transcript.push(`recovery:FINAL:SETTLED`);

  // The whole composed log (both variants' evidence) verifies.
  const verification = composition.log.verifyAndRecord(composition.wall + 1);
  assert.equal(verification.verdict, 'VERIFIED');
  transcript.push('chain:VERIFIED');

  await composition.close();
  return transcript;
}

// ---------------------------------------------------------------------------
// Scenario 4 — [test:risk-rails-real-log] (RTN-003/RTN-004 real-log integration)
// ---------------------------------------------------------------------------

async function scenarioRiskRailsRealLog() {
  const composition = await composeComposedRuntime({});
  const transcript = [];
  const { authorities, rails } = composition;

  // (a) The REAL A16 risk authority over the REAL A15 log: the screening
  //     computation + the check decision land in the chain with the
  //     registry authority name, and persist in the evidence store.
  composition.screeningListRegistered = true; // registered below via the direct call
  authorities.risk.registerScreeningList(
    { listId: 'sanctions', version: 1, entries: [] },
    protocolTime(1, 1_000),
  );
  await submitViaGateway(composition, 'intent.submit', 'Intent Authority', gatewayIntentSubmitBody('risklog-intent-1'), deriveIdempotencyKey('command', 'intent.submit', 'risklog-intent-1'));
  const intentId = authorities.intent.getReceipt('risklog-intent-1').intentId;
  const approved = await approveGateSubject(composition, intentId, 'INTENT', protocolTime(2, 2_000));
  const riskRecords = composition.log
    .records()
    .filter((record) => record.authority === 'Risk and Compliance Authority');
  const riskTypes = riskRecords.map((record) => record.what.operationType);
  assert.ok(riskTypes.includes('SCREENING_COMPUTED'), 'SCREENING_COMPUTED in the real log');
  assert.ok(riskTypes.includes('CHECK_DECIDED'), 'CHECK_DECIDED in the real log');
  transcript.push(`risk-records:${riskRecords.length}`);

  // (b) The DENY path through the REAL authority: author + publish +
  //     activate a threshold rule that denies the subject's money fact;
  //     a second intent's check DENIES; the gate blocks the authorization
  //     (INV-16-3) — and the gateway-admitted authorize command completes
  //     as the typed rejection (observation 'rejected').
  authorities.risk.authorRule('rule-deny-large', {
    kind: 'THRESHOLD',
    fact: { factClass: 'MONEY', currency: 'EUR' },
    operator: 'GT',
    bound: { boundClass: 'MONEY', currency: 'EUR', amountMinor: 100_00 },
    onBreach: 'DENY',
  }, protocolTime(3, 3_000));
  authorities.risk.publishRule('rule-deny-large', protocolTime(4, 4_000));
  authorities.risk.activateRule('rule-deny-large', 1, protocolTime(5, 5_000));
  await submitViaGateway(composition, 'intent.submit', 'Intent Authority', gatewayIntentSubmitBody('risklog-intent-2'), deriveIdempotencyKey('command', 'intent.submit', 'risklog-intent-2'));
  const deniedIntentId = authorities.intent.getReceipt('risklog-intent-2').intentId;
  const deniedSubject = subjectComplianceData({
    subjectId: deniedIntentId,
    subjectKind: 'INTENT',
    moneyFacts: [{ currency: 'EUR', amountMinor: 200_00 }],
  });
  const deniedCheck = await authorities.risk.evaluateAndRecordCheck(deniedSubject, 'sanctions', protocolTime(6, 6_000));
  const decided = await authorities.risk.decideCheck(deniedCheck.checkId, protocolTime(7, 7_000));
  assert.equal(decided.state, 'DENIED');
  const blockedGate = authorities.risk.checkGate('intent.AUTHORIZATION', deniedIntentId);
  assert.equal(blockedGate.allowed, false);
  assert.equal(blockedGate.blockedBy, 'CHECK_DENIED');
  // The gateway-admitted authorize on the denied subject: the authority
  // refuses (COMPLIANCE_BLOCKED) — a typed rejection, completed job, one
  // observation row with status 'rejected', NO INTENT_AUTHORIZED record.
  const refusal = await composition.gateway.submitCommand({
    kind: 'intent.authorize',
    authority: 'Intent Authority',
    subjectIds: [deniedIntentId],
    idempotencyKey: deriveIdempotencyKey('command', 'intent.authorize', deniedIntentId),
    protocolTime: protocolTime(1, composition.wall),
    body: { intentId: deniedIntentId, policyDecisionId: 'pid.v1.decision-none' },
  });
  assert.equal(refusal.ok, true, 'admission succeeds — the refusal happens at execution');
  await drain(composition);
  assert.equal(authorities.intent.getIntent(deniedIntentId)?.state, 'DRAFT');
  const refusalObservations = executedObservations(composition).filter(
    (row) => row.kind === 'intent.authorize' && row.jobId === refusal.jobId,
  );
  assert.equal(refusalObservations.length, 1);
  assert.equal(refusalObservations[0].status, 'rejected');
  assert.equal(refusalObservations[0].code, 'COMPLIANCE_BLOCKED');
  assert.equal(
    composition.log.records().filter((record) => record.what.operationType === 'INTENT_AUTHORIZED').length,
    0,
  );
  transcript.push('denied-gate:COMPLIANCE_BLOCKED');

  // (c) The REAL A13/A14 rails authorities over the REAL A15 log (the
  //     RTN-004 port-double replacement): register + activate through the
  //     gateway (the single-writer path), then drive an operation to
  //     UNKNOWN with the auto-case — the records carry the REGISTRY
  //     authority names ('Rail Authority' / 'Reconciliation Authority',
  //     never the rails module's local label).
  await submitViaGateway(composition, 'rails.adapter.register', 'Rail Authority', { railFamily: 'sim-bank', name: 'primary' }, 'risklog-rails-1');
  const adapterId = composition.adapterId;
  await submitViaGateway(composition, 'rails.adapter.activate', 'Rail Authority', { adapterId }, 'risklog-rails-2', [adapterId]);
  // A direct UNKNOWN operation through the A13 command surface.
  const opInstructionId = 'pid.v1.instruction-risklog';
  const opKey = railIdempotencyKeyForInstruction(opInstructionId);
  const unknownRail = new SimulatedRail('bank-risklog', { [opKey]: 'TRANSMIT_TIMEOUT' });
  const unknownConnection = createSimulatedRailAdapter(unknownRail, { wallClock: () => composition.wall });
  const opAuthorized = rails.railAuthority.authorizeOperation({
    instructionId: opInstructionId,
    adapterId,
    payload: {
      instructionId: opInstructionId,
      money: { currency: 'EUR', amountMinor: 900, scale: 2 },
      beneficiary: 'acct-gamma',
      memo: 'risk-log rails fixture',
    },
  });
  assert.equal(opAuthorized.ok, true, `authorizeOperation: ${opAuthorized.ok ? '' : opAuthorized.reasonCode}`);
  const opSubmitted = rails.railAuthority.submitRailOperation(opAuthorized.value.operationId, unknownConnection);
  assert.equal(opSubmitted.ok, true);
  assert.equal(opSubmitted.value.operation.status, 'UNKNOWN');
  const opCase = rails.reconciliation.getCaseByOriginOperation(opAuthorized.value.operationId);
  assert.ok(opCase !== undefined);
  rails.reconciliation.investigateCase(opCase.caseId);
  rails.reconciliation.resolveCase(opCase.caseId, {
    resolution: 'RESOLVED_CONFIRMED',
    proof: { externalRefs: ['bank-statement-risklog'] },
  });
  const railsRecords = composition.log.records().filter((record) => record.authority === 'Rail Authority');
  const railsTypes = railsRecords.map((record) => record.what.operationType);
  for (const expected of ['ADAPTER_STATE_CHANGED', 'RAIL_OP_AUTHORIZED', 'RAIL_OP_SUBMITTED']) {
    assert.ok(railsTypes.includes(expected), `${expected} in the real log under the registry name`);
  }
  const reconRecords = composition.log.records().filter((record) => record.authority === 'Reconciliation Authority');
  const reconTypes = reconRecords.map((record) => record.what.operationType);
  assert.ok(reconTypes.includes('CASE_OPENED'), 'CASE_OPENED in the real log under the registry name');
  assert.ok(reconTypes.includes('CASE_RESOLVED'), 'CASE_RESOLVED in the real log under the registry name');
  assert.equal(
    composition.log.records().some((record) => record.authority === 'Rail Adapter Authority'),
    false,
    'the rails module local label never appears in the real log (registry-name adapter)',
  );
  transcript.push(`rails-records:${railsRecords.length + reconRecords.length}`);

  // (d) The persisted evidence store round-trips the risk + rails records.
  const persisted = readEvidenceRecords(composition.stores.evidence);
  for (const type of ['SCREENING_COMPUTED', 'CHECK_DECIDED', 'RAIL_OP_AUTHORIZED', 'CASE_OPENED']) {
    assert.ok(
      persisted.some((record) => record.what.operationType === type),
      `${type} persisted in the evidence-object-store`,
    );
  }
  transcript.push('persisted:round-trip');

  // (e) The whole real log verifies.
  const verification = composition.log.verifyAndRecord(composition.wall + 1);
  assert.equal(verification.verdict, 'VERIFIED');
  transcript.push('chain:VERIFIED');

  await composition.close();
  return transcript;
}

// ---------------------------------------------------------------------------
// Scenario 5 — [test:duplicate-restart-safety]
// ---------------------------------------------------------------------------

async function scenarioDuplicateRestartSafety() {
  const composition = await composeComposedRuntime({});
  const transcript = [];
  const { authorities, gateway, durableRuntime, runtime, substrate } = composition;

  // (a) RESUBMISSION: the same (kind, idempotency key) through the gateway
  //     returns the RECORDED receipt verbatim — never a second effect.
  const INTENT_KEY = 'restart-intent-1';
  const intentBody = gatewayIntentSubmitBody(INTENT_KEY);
  const commandKey = deriveIdempotencyKey('command', 'intent.submit', INTENT_KEY);
  const envelope = {
    kind: 'intent.submit',
    authority: 'Intent Authority',
    subjectIds: [],
    idempotencyKey: commandKey,
    protocolTime: protocolTime(1, composition.wall),
    body: intentBody,
  };
  const first = await gateway.submitCommand(envelope);
  assert.equal(first.ok, true);
  await drain(composition);
  const second = await gateway.submitCommand(envelope);
  assert.equal(second.ok, true);
  assert.equal(second.replayed, true);
  assert.equal(second.created, false);
  assert.equal(second.receipt, first.receipt, 'the re-submission returns the RECORDED receipt verbatim');
  assert.equal(authorities.intent.listIntents().length, 1, 'exactly ONE intent — never a second effect');
  assert.equal(countType(composition, 'INTENT_CREATED'), 1, 'exactly ONE INTENT_CREATED record');
  const stats = durableRuntime.queue.stats();
  assert.equal(
    stats.succeeded + stats.queued + stats.reserved,
    1,
    'exactly one durable job for the key',
  );
  transcript.push('resubmission:recorded-receipt');

  // (b) WORKER RESTART (the lease-reclaim redelivery): enqueue a SECOND
  //     intent.submit through the gateway, reserve it as a "dying" worker,
  //     execute the atomic unit, never complete — the lease expires, the
  //     next worker pass reclaims + redelivers, the re-execution REPLAYS
  //     (INV-1-3: the recorded receipt + recorded intent return), and the
  //     job completes. Exactly one effect across the restart.
  const RESTART_KEY = 'restart-intent-2';
  const restartEnvelope = {
    kind: 'intent.submit',
    authority: 'Intent Authority',
    subjectIds: [],
    idempotencyKey: deriveIdempotencyKey('command', 'intent.submit', RESTART_KEY),
    protocolTime: protocolTime(1, composition.wall),
    body: gatewayIntentSubmitBody(RESTART_KEY),
  };
  const admitted = await gateway.submitCommand(restartEnvelope);
  assert.equal(admitted.ok, true);
  const reserved = durableRuntime.queue.reserve('killed-worker', LEASE_MS, { kind: 'intent.submit' });
  assert.equal(reserved.id, admitted.jobId, 'the dying worker reserves the admitted job');
  await runtime.executeCommand(reserved); // the atomic unit commits; the loop "dies" (never completes)
  const restartIntentId = authorities.intent.getReceipt(RESTART_KEY).intentId;
  assert.ok(restartIntentId !== undefined, 'the intent committed before the crash');
  await sleep(LEASE_MS + 40); // the lease expires
  const dispatched = await drain(composition); // reclaimExpired → re-reserve → replay → complete
  assert.equal(dispatched, 1, 'exactly one redelivered dispatch after the reclaim');
  const job = durableRuntime.queue.getJob(admitted.jobId);
  assert.equal(job.status, 'succeeded');
  assert.equal(job.attempts, 1, 'one reclaim, one completion');
  // REPLAY: exactly one effect + the observations narrate applied → replayed.
  assert.equal(authorities.intent.listIntents().length, 2, 'two intents total — the restart added no duplicate');
  assert.equal(
    composition.log.records().filter((record) => record.what.operationType === 'INTENT_CREATED').length,
    2,
    'exactly two INTENT_CREATED records — the redelivery emitted none',
  );
  const observations = executedObservations(composition).filter((row) => row.kind === 'intent.submit' && row.jobId === admitted.jobId);
  assert.deepEqual(
    observations.map((row) => row.status),
    ['applied', 'replayed'],
    'the redelivered execution replays the recorded state (never a second effect)',
  );
  transcript.push('worker-restart:lease-reclaim:replayed');

  // (c) The full log verifies after the restart cycle.
  const verification = composition.log.verifyAndRecord(composition.wall + 1);
  assert.equal(verification.verdict, 'VERIFIED');
  transcript.push('chain:VERIFIED');

  void substrate;
  await composition.close();
  return transcript;
}

// ---------------------------------------------------------------------------
// Scenario 6 — [test:chain-verification] (over the FULL composed journey log)
// ---------------------------------------------------------------------------

async function scenarioChainVerification() {
  // Reuse a golden journey's log: run it, then verify the chain three ways
  // and prove the hash chain actually binds (tamper detection).
  const { composition } = await runComposedJourney('ACCEPT_REPORT_CONFIRMED');
  const transcript = [];
  const records = composition.log.records();
  assert.ok(records.length >= 40, `the composed journey log is substantial (${records.length} records)`);

  // (a) verifyAndRecord — the lifecycle-recorded verification.
  const verification = composition.log.verifyAndRecord(composition.wall + 2);
  assert.equal(verification.verdict, 'VERIFIED');
  transcript.push(`verifyAndRecord:${verification.verdict}`);

  // (b) The pure chain verification over every record (no recording).
  const pure = verifyEvidenceChain(records);
  assert.equal(pure.verdict, 'VERIFIED');
  transcript.push(`verifyEvidenceChain:${pure.verdict}:${records.length}`);

  // (c) Tamper detection: mutating one record's outcome breaks the chain
  //     at the mutated position (the hash chain binds the journey).
  const tampered = records.map((record, index) =>
    index === Math.floor(records.length / 2)
      ? { ...record, outcome: { ...record.outcome, result: 'TAMPERED' } }
      : record,
  );
  const tamperVerification = verifyEvidenceChain(tampered);
  assert.notEqual(tamperVerification.verdict, 'VERIFIED');
  transcript.push(`tamper:${tamperVerification.verdict}`);

  // (d) The evidence-object-store round-trips EVERY record: the authority
  //     records were bridged at submit time; the log's own lifecycle
  //     records (genesis + verification) sync here through the same
  //     idempotent ON CONFLICT DO NOTHING bridge — then the persisted set
  //     equals the full chain, in sequence order.
  for (const record of records) {
    writeEvidenceRecord(composition.stores.evidence, record);
  }
  const persisted = readEvidenceRecords(composition.stores.evidence);
  assert.equal(persisted.length, records.length);
  for (let index = 0; index < records.length; index += 1) {
    assert.equal(persisted[index].recordId, records[index].recordId);
    assert.equal(persisted[index].what.operationType, records[index].what.operationType);
  }
  transcript.push('persisted:full-round-trip');

  // (e) The persisted chain ALSO verifies independently.
  const persistedVerification = verifyEvidenceChain(persisted);
  assert.equal(persistedVerification.verdict, 'VERIFIED');
  transcript.push(`persisted-chain:${persistedVerification.verdict}`);

  await composition.close();
  return transcript;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

let failure = null;
const results = [];
try {
  const barrelTranscript = await scenarioWaveBarrel();
  results.push(['test:wave-barrel', barrelTranscript]);

  const goldenTranscript = await scenarioGoldenPath();
  results.push(['test:golden-path', goldenTranscript]);

  const unknownTranscript = await scenarioUnknownConfirmed();
  results.push(['test:unknown-confirmed', unknownTranscript]);

  const failedTranscript = await scenarioUnknownFailed();
  results.push(['test:unknown-failed', failedTranscript]);

  const riskRailsTranscript = await scenarioRiskRailsRealLog();
  results.push(['test:risk-rails-real-log', riskRailsTranscript]);

  const duplicateTranscript = await scenarioDuplicateRestartSafety();
  results.push(['test:duplicate-restart-safety', duplicateTranscript]);

  const chainTranscript = await scenarioChainVerification();
  results.push(['test:chain-verification', chainTranscript]);

  // [test:determinism] — the composed golden journey runs twice; the
  // transcripts are identical (GC-1 over the composed system).
  const determinismA = await scenarioGoldenPath();
  const determinismB = await scenarioGoldenPath();
  assert.deepEqual(determinismB, determinismA);
  results.push(['test:determinism', [`${determinismA.length}-steps:identical`]]);

  console.log('RTN-012 composed-journey harness: all checks green.');
  for (const [name, transcript] of results) {
    console.log(`  ${name}: ${transcript.join(' | ')}`);
  }
} catch (error) {
  failure = error;
  console.error('RTN-012 composed-journey harness: FAILED.');
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
