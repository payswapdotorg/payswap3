#!/usr/bin/env node
/**
 * payswap3 · RTN-006 — Routing / Reservations authorities evidence harness
 * (areas 4-5, per-domain persistence).
 *
 * Plain-Node evidence suite for the SQLite-backed surfaces of the two
 * RTN-006 domains (the same split the RTN-001 kernel, the RTN-002 evidence
 * domain, and the RTN-005 domains use): `bun test` covers the pure modules
 * and the in-process authorities (including the real-log evidence coupling
 * and the routing × reservations integration); THIS harness exercises each
 * domain's per-domain store — open<Domain>Store over the DEP-003 database
 * layer (node:sqlite), the owned migrations, and the write-through bridges
 * — because Bun does not implement node:sqlite.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/core.md §4 Area 4 lines 221-230 (RoutePlan,
 *     RouteCompiler — the persisted records; the pinned compiler version
 *     recorded in every plan row);
 *   lines 248-249 (INV-4-3 — the storage-level UNIQUE (intent_id,
 *     compiler_version, snapshot_id) that makes the compilation-key
 *     contract structural);
 *   lines 253-254 (NO_VIABLE_ROUTE's area-24 demand signal — the durable
 *     signal rows, with the emission point recorded);
 *   §5 Area 5 lines 286-295 (Reservation, ReservationLedger — the
 *     persisted artifacts; the append-only entry log);
 *   lines 304-312 (INV-5-1/INV-5-2/INV-5-3 — the storage-level UNIQUE
 *     constraints that make the contracts structural);
 *   lines 316-318 (crash recovery — the persisted entry log with its
 *     recorded decisions is the recovery input, proven here by rebuilding
 *     a ledger from the persisted entries after a truncation);
 *   spec/protocol-runtime-work-orders/README.md "Persistence convention"
 *   (per-domain schema + owned migrations, DEP-003 read-only).
 *
 * Scenario per domain: run the in-process authority/ledger against the
 * REAL in-process A15 log (createEvidenceLog), persist every committed
 * artifact through the domain bridge, read everything back, and assert the
 * round trip reconstructs the records exactly (Money re-minted through the
 * kernel guards — GC-1 holds on the read path). Duplicate writes report
 * created:false (the dedupe no-ops). The reservation store's ledger entries
 * are re-fed into a fresh ledger to prove the crash-recovery replay over
 * the DURABLE log. The whole scenario is deterministic (two runs,
 * identical transcripts).
 *
 * Node-version note: requires Node.js >= 22.6 (node:sqlite + type
 * stripping); on 22.6-22.17 this harness re-executes itself with
 * --experimental-sqlite / --experimental-strip-types as needed; on
 * Node >= 22.18 no flags are required. (Same bootstrap as
 * scripts/test_protocol_kernel.mjs and scripts/test_protocol_authorities.mjs.)
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

const RESPAWN_ENV = 'PAYSWAP_RT6_TEST_RESPAWNED';
const tempDirs = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `payswap-rt6-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

/**
 * Bootstrap (mirrors scripts/test_protocol_authorities.mjs): probes
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
    await import(MODULE_URL('routing', 'types.ts'));
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
    console.error('node:sqlite / type stripping. The routing/reservations suite requires Node.js >= 22.6.');
    process.exit(1);
  }
  process.exit(typeof child.status === 'number' ? child.status : 1);
}

await ensureCapabilities();

let routingModule;
let reservationsModule;
let evidenceModule;
try {
  routingModule = await import(MODULE_URL('routing', 'routing.ts'));
  reservationsModule = await import(MODULE_URL('reservations', 'reservations.ts'));
  evidenceModule = await import(MODULE_URL('evidence', 'evidence.ts'));
} catch (error) {
  console.error(`Failed to load the RTN-006 domain modules: ${error}`);
  console.error('This suite requires Node.js >= 22.6 (node:sqlite + TypeScript type stripping).');
  process.exit(1);
}

const {
  RoutingAuthority,
  writeRoutePlan,
  saveRoutePlanState,
  writeRouteDemandSignal,
  readRoutePlans,
  readRouteDemandSignals,
  openRoutingStore,
} = routingModule;
const {
  ReservationLedger,
  openReservationLedger,
  createReservationAcquisitionPort,
  writeLedgerEntry,
  writeReservationRecord,
  saveReservationState,
  writeResourceRow,
  saveResourceAccounting,
  readLedgerEntries,
  readReservations,
  readResourceAccountings,
  openReservationsStore,
} = reservationsModule;
const { createEvidenceLog } = evidenceModule;

const WALL = 1_700_000_000_000;

function deterministicClock(start) {
  let wall = start;
  return () => {
    wall += 1;
    return wall;
  };
}

function capability(capabilityId, corridor, availableMinor) {
  const [sourceCurrency, sourceGeography, destinationCurrency, destinationGeography] = corridor;
  return {
    capabilityId,
    railId: 'sepa',
    corridor: { sourceCurrency, sourceGeography, destinationCurrency, destinationGeography },
    state: 'ACTIVE',
    declaredCapacity: { currency: sourceCurrency, scale: 2, amountMinor: availableMinor },
    reservedTotal: { currency: sourceCurrency, scale: 2, amountMinor: 0 },
    consumedTotal: { currency: sourceCurrency, scale: 2, amountMinor: 0 },
    availableCapacity: { currency: sourceCurrency, scale: 2, amountMinor: availableMinor },
    costSchedule: { currency: 'EUR', scale: 2, amountMinor: 100 },
    tier: 'STANDARD',
  };
}

const INTENT_ID_INPUT = 'pid.v1.intent';
const SNAPSHOT = {
  snapshotId: 'pid.v1.snapshot-1',
  sequence: 1,
  wallMs: WALL,
  capabilities: [
    capability('cap-a', ['EUR', 'DE', 'EUR', 'FR'], 500_00),
    capability('cap-b', ['EUR', 'FR', 'USD', 'US'], 1_000_00),
  ],
};
const TERMS = {
  amount: { currency: 'EUR', scale: 2, amountMinor: 200_00 },
  sourceCurrency: 'EUR',
  destinationCurrency: 'USD',
  sourceGeography: 'DE',
  destinationGeography: 'US',
  deadlineEpochMs: 60_000,
  allowedRails: ['sepa'],
  costCeiling: { currency: 'EUR', scale: 2, amountMinor: 500_00 },
};
const EVALUATION = {
  satisfiable: true,
  result: {
    rankedRouteRequirements: [],
    constraintEnvelope: { allowedRails: ['sepa'], ordering: 'COST_ASC', fallbackPreference: [] },
    costCeiling: { currency: 'EUR', scale: 2, amountMinor: 500_00 },
    deadlineEpochMs: 60_000,
  },
};
const CONVERSIONS = [
  {
    fromCurrency: 'EUR',
    toCurrency: 'USD',
    fromAmount: { currency: 'EUR', scale: 2, amountMinor: 200_00 },
    toAmount: { currency: 'USD', scale: 2, amountMinor: 220_00 },
  },
];

async function runScenario() {
  const transcript = [];
  // -----------------------------------------------------------------------
  // Routing domain store
  // -----------------------------------------------------------------------
  {
    const dir = tempDir('routing');
    const store = openRoutingStore({ dbPath: join(dir, 'routing.sqlite') });
    const log = createEvidenceLog({ wallMs: WALL });
    const ledger = new ReservationLedger({
      evidence: log,
      wallClock: deterministicClock(WALL),
    });
    const authority = new RoutingAuthority({
      evidence: log,
      reservations: createReservationAcquisitionPort(ledger),
      wallClock: deterministicClock(WALL),
    });
    await ledger.declareResource('cap-a', { currency: 'EUR', scale: 2, amountMinor: 500_00 });
    await ledger.declareResource('cap-b', { currency: 'EUR', scale: 2, amountMinor: 1_000_00 });
    const compiled = await authority.compileRoute({
      intentId: INTENT_ID_INPUT,
      intentTerms: TERMS,
      policyEvaluation: EVALUATION,
      snapshot: SNAPSHOT,
      conversions: CONVERSIONS,
    });
    assert.equal(compiled.ok, true);
    const plan = compiled.ok ? compiled.plan : null;
    assert.ok(plan);
    await authority.validatePlan(plan.planId);
    await authority.dispatchPlan(plan.planId);
    const completed = await authority.completePlan(plan.planId);
    assert.equal(completed.ok, true);
    // A NO_VIABLE_ROUTE compilation: the demand signal with the emission
    // point recorded.
    const noRoute = await authority.compileRoute({
      intentId: 'pid.v1.intent-empty',
      intentTerms: TERMS,
      policyEvaluation: EVALUATION,
      snapshot: { ...SNAPSHOT, snapshotId: 'pid.v1.snapshot-2', capabilities: [] },
    });
    assert.equal(noRoute.ok, false);
    assert.equal(noRoute.terminal, true);

    // migration bookkeeping
    const applied = store.appliedMigrations().map((migration) => migration.name);
    assert.deepEqual(applied, ['0001_routing.sql']);

    // write-through: plan row + state changes + demand signal
    assert.equal(writeRoutePlan(store, plan).created, true);
    assert.equal(writeRoutePlan(store, plan).created, false); // the storage-level INV-4-3 collapse
    assert.equal(writeRoutePlan(store, plan).reason, 'duplicate-no-op');
    const finalPlan = authority.plan(plan.planId);
    assert.ok(finalPlan);
    assert.equal(saveRoutePlanState(store, finalPlan), 1);
    const signal = noRoute.terminal ? noRoute.demandSignal : null;
    assert.ok(signal);
    assert.equal(writeRouteDemandSignal(store, signal).created, true);
    assert.equal(writeRouteDemandSignal(store, signal).created, false); // one signal per compilation key

    // read-back: the records reconstruct exactly (Money re-minted)
    const plans = readRoutePlans(store);
    assert.equal(plans.length, 1);
    const readPlan = plans[0];
    assert.equal(readPlan.planId, finalPlan.planId);
    assert.equal(readPlan.state, 'COMPLETED');
    assert.equal(readPlan.compilerVersion, 1);
    assert.equal(readPlan.snapshotId, SNAPSHOT.snapshotId);
    assert.equal(readPlan.hops.length, 2);
    assert.equal(readPlan.hops[0].amount.amountMinor, 200_00);
    assert.equal(readPlan.hops[0].amount.currency, 'EUR');
    assert.equal(readPlan.hops[0].corridor.sourceGeography, 'DE');
    assert.equal(readPlan.hops[1].settlementSemantics, 'HOP_SETTLEMENT:EUR->USD@US');
    assert.equal(readPlan.valueLedger.deliveredAmount.amountMinor, 220_00);
    assert.equal(readPlan.valueLedger.conversions[0].toAmount.currency, 'USD');
    assert.equal(readPlan.valueLedger.fees.length, 2);
    assert.equal(readPlan.deadlineEpochMs, 60_000);
    assert.equal(readPlan.reservationRefs.length, 2);
    assert.deepEqual(
      readPlan.reservationRefs.map((ref) => ref.reservationId),
      finalPlan.reservationRefs.map((ref) => ref.reservationId),
    );
    const signals = readRouteDemandSignals(store);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].signalId, signal.signalId);
    assert.equal(signals[0].emissionPointRecordId, signal.emissionPointRecordId);
    assert.equal(signals[0].requestedCorridor.sourceCurrency, 'EUR');
    assert.equal(signals[0].amount.amountMinor, 200_00);
    transcript.push(
      JSON.stringify({
        plans: plans.map((entry) => [entry.planId, entry.state]),
        signals: signals.map((entry) => [entry.signalId, entry.emissionPointRecordId]),
      }),
    );
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }

  // -----------------------------------------------------------------------
  // Reservations domain store
  // -----------------------------------------------------------------------
  {
    const dir = tempDir('reservations');
    const store = openReservationsStore({ dbPath: join(dir, 'reservations.sqlite') });
    const log = createEvidenceLog({ wallMs: WALL });
    const ledger = new ReservationLedger({
      evidence: log,
      wallClock: deterministicClock(WALL),
    });
    await ledger.declareResource('cap-a', { currency: 'EUR', scale: 2, amountMinor: 500_00 });
    await ledger.declareResource('cap-b', { currency: 'EUR', scale: 2, amountMinor: 1_000_00 });
    const routing = new RoutingAuthority({
      evidence: log,
      reservations: createReservationAcquisitionPort(ledger),
      wallClock: deterministicClock(WALL),
    });
    const compiled = await routing.compileRoute({
      intentId: INTENT_ID_INPUT,
      intentTerms: TERMS,
      policyEvaluation: EVALUATION,
      snapshot: SNAPSHOT,
      conversions: CONVERSIONS,
    });
    assert.equal(compiled.ok, true);
    const plan = compiled.ok ? compiled.plan : null;
    assert.ok(plan);
    await routing.validatePlan(plan.planId);
    await routing.dispatchPlan(plan.planId);
    const hop1Id = plan.hops[1].hopId;
    await routing.recordUnknownHop(plan.planId, hop1Id, 'railop-1');
    await routing.resolveUnknownHop(plan.planId, hop1Id, 'CONFIRMED');
    const completed = await routing.completePlan(plan.planId);
    assert.equal(completed.ok, true);

    // migration bookkeeping
    const applied = store.appliedMigrations().map((migration) => migration.name);
    assert.deepEqual(applied, ['0001_reservations.sql']);

    // write-through: every ledger entry (the append-only log), every
    // reservation record, every resource accounting row.
    for (const entry of ledger.entries()) {
      assert.equal(writeLedgerEntry(store, entry).created, true);
    }
    assert.equal(writeLedgerEntry(store, ledger.entries()[0]).created, false); // append-only dedupe
    for (const reservation of ledger.reservations()) {
      assert.equal(writeReservationRecord(store, reservation).created, true);
      assert.equal(writeReservationRecord(store, reservation).created, false); // INV-5-3
      assert.equal(saveReservationState(store, reservation), 1);
    }
    for (const resourceId of ['cap-a', 'cap-b']) {
      const accounting = ledger.resourceAccounting(resourceId);
      assert.ok(accounting);
      assert.equal(writeResourceRow(store, accounting).created, true);
      assert.equal(writeResourceRow(store, accounting).created, false);
      assert.equal(saveResourceAccounting(store, accounting), 1);
    }

    // read-back: the artifacts reconstruct exactly.
    const entries = readLedgerEntries(store);
    assert.equal(entries.length, ledger.entries().length);
    assert.deepEqual(
      entries.map((entry) => [entry.globalSequence, entry.resourceId, entry.entryKind, entry.resourceSequence]),
      ledger.entries().map((entry) => [entry.globalSequence, entry.resourceId, entry.entryKind, entry.resourceSequence]),
    );
    const requested = entries.find((entry) => entry.entryKind === 'REQUESTED');
    assert.ok(requested);
    assert.equal(requested.decision, 'HOLD');
    assert.equal(requested.intentId, INTENT_ID_INPUT);
    assert.equal(requested.amount.amountMinor, 200_00);
    const reservations = readReservations(store);
    assert.equal(reservations.length, 2);
    assert.equal(reservations[0].state, 'CONSUMED');
    assert.equal(reservations[0].amount.currency, 'EUR');
    assert.equal(reservations[0].deadlineEpochMs, 60_000);
    const accountings = readResourceAccountings(store);
    assert.equal(accountings.length, 2);
    for (const accounting of accountings) {
      assert.equal(accounting.heldTotal.amountMinor, 0);
      assert.equal(accounting.consumedTotal.amountMinor, 200_00);
      assert.equal(accounting.declaredTotal.currency, 'EUR');
    }

    // THE DURABLE CRASH-RECOVERY PROOF: the persisted entry log (truncated
    // at a crash point) rebuilds a fresh ledger, and the dangling REQUESTED
    // tail resolves per the recorded decision.
    const persisted = readLedgerEntries(store);
    const cut = persisted.findIndex((entry) => entry.entryKind === 'REQUESTED') + 1;
    const recoveryLog = createEvidenceLog({ wallMs: WALL });
    const recovered = new ReservationLedger({
      evidence: recoveryLog,
      wallClock: deterministicClock(WALL),
      initialEntries: persisted.slice(0, cut),
    });
    const report = await recovered.recover();
    assert.equal(report.resolved.length, 1);
    assert.equal(report.resolved[0].action, 'ROLLFORWARD_HELD');
    const recoveredReservation = recovered.reservations()[0];
    assert.ok(recoveredReservation);
    assert.equal(recoveredReservation.state, 'HELD');
    assert.equal(recoveredReservation.reasonCode, 'RECOVERY_ROLLFORWARD');
    const recoveredAccounting = recovered.resourceAccounting(recoveredReservation.resourceId);
    assert.ok(recoveredAccounting);
    assert.equal(recoveredAccounting.heldTotal.amountMinor, 200_00);
    assert.equal(recoveredAccounting.consumedTotal.amountMinor, 0);
    // The boot path over the FULL persisted log: the factory's recovery
    // finds nothing to resolve (no dangles) and reconstructs the state.
    const bootLedger = await openReservationLedger({
      evidence: recoveryLog,
      wallClock: deterministicClock(WALL),
      initialEntries: persisted,
    });
    assert.equal(bootLedger.reservations().length, 2);
    assert.equal(bootLedger.danglingTails().length, 0);
    assert.equal(bootLedger.reservations()[0].state, 'CONSUMED');

    transcript.push(
      JSON.stringify({
        entries: entries.map((entry) => [entry.entryKind, entry.resourceSequence]),
        reservations: reservations.map((entry) => [entry.reservationId, entry.state]),
        recovery: report.resolved.map((action) => [action.action, action.reasonCode]),
      }),
    );
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
  return transcript;
}

const first = await runScenario();
const second = await runScenario();
assert.deepEqual(first, second);

const results = [
  ['routing store: plans and demand signals round-trip; INV-4-3 UNIQUE', true],
  ['reservations store: entries, reservations, accounting round-trip; durable crash recovery', true],
  ['the durable scenario is deterministic (two runs, identical persisted transcripts)', true],
];
for (const [name, ok] of results) {
  console.log(`(${ok ? 'pass' : 'FAIL'}) ${name}`);
  if (!ok) {
    process.exitCode = 1;
  }
}
console.log('RTN-006 routing/reservations harness: all checks green.');
