#!/usr/bin/env node
/**
 * payswap3 · DEP-007 — The observability/resilience/DR evidence harness.
 *
 * Plain-Node evidence suite for DEP-007's required evidence (the work
 * order: "Backup/restore drill, worker restart drill, replay/recovery
 * test, evidence-integrity verification and failure-injection results"),
 * composed over the REAL substrate per the composition order: the DEP-003
 * durable substrate (src/lib/durable/ — read-only integration), the
 * DEP-004 operational jobs (src/lib/operations/ — invoked, never
 * re-implemented), the DEP-005 rail connectivity boundary
 * (src/lib/rail-connectivity/ — invoked through its test surface), the
 * RTN-010 gateway (the ONE admission point), and the two NEW DEP-007
 * families (src/lib/observability/ + src/lib/recovery/).
 *
 * Drill groups (each a named section of the final report table):
 *
 *   0. [drill:family-barrels]     the two new family barrels load under
 *                                 plain Node; the static discipline scan
 *                                 (no gateway/authority/store imports, no
 *                                 network primitives, no secret-shaped
 *                                 strings, and — observability only — no
 *                                 recordEvent value usage anywhere in the
 *                                 family source: telemetry NEVER writes).
 *   1. [drill:backup-restore]     THE backup/restore drill: a populated
 *                                 store (jobs across every reachable status
 *                                 incl. dead_lettered and a reserved
 *                                 zombie; events from four owners incl.
 *                                 rail-connectivity activity and the
 *                                 operational-jobs journal) → verified
 *                                 online backup → manifest row → restore
 *                                 into a fresh target copy → integrity +
 *                                 migration + continuity + evidence
 *                                 verification → append-only semantics →
 *                                 fail-closed refusals.
 *   2. [drill:worker-restart]     THE worker restart drill: a job killed
 *                                 mid-flight (reserve → execute the atomic
 *                                 unit → never complete — the DEP-004
 *                                 harness precedent) + a job crashed after
 *                                 its effect (handler throws) → lease
 *                                 expiry → RESTARTED worker drains →
 *                                 exactly-once effects, no zombie
 *                                 reservations.
 *   3. [drill:replay-recovery]    THE replay/recovery test: the
 *                                 reconciliation sweep killed mid-flight
 *                                 after its command was admitted → backup →
 *                                 restore → replay through the EXISTING
 *                                 worker/queue API with a FRESH gateway
 *                                 (fresh in-memory receipts) → the
 *                                 substrate's UNIQUE(idempotency_key, kind)
 *                                 absorbs the re-submission (created:false,
 *                                 replayed:true — ONE command job, the
 *                                 recorded receipt returned) → UNKNOWN
 *                                 surfaced not retried (zero submissions
 *                                 for the UNKNOWN-held subject) → the sweep
 *                                 re-derives the SAME command key → the
 *                                 trigger re-drive is deduped.
 *   4. [drill:failure-injection]  transport-failure / timeout / UNKNOWN
 *                                 injected through the rail boundary's test
 *                                 surface (the scripted transport double):
 *                                 the retry engine matches the DEP-005
 *                                 contract (pre-effect retryable retried;
 *                                 in-flight / credential-refusal / UNKNOWN
 *                                 / timeout never retried), telemetry
 *                                 reflects them in the right domains, the
 *                                 health model reports degraded with
 *                                 actionable actions, and NO injected
 *                                 failure mutates authoritative state (the
 *                                 durable_jobs table and the A15 evidence
 *                                 log are untouched).
 *   5. [drill:evidence-integrity] THE tamper drill: a restored copy is
 *                                 tampered (one event payload mutated) →
 *                                 verifyEvidenceIntegrity FAILS CLOSED with
 *                                 the tampered row identified by eventId; a
 *                                 restore from a tampered artifact is
 *                                 refused (manifest sha mismatch); a
 *                                 recorded tamper detection drives the
 *                                 health model to incident-recovery DOWN
 *                                 and the composite to DOWN (worst-of —
 *                                 one down domain suffices).
 *   6. [drill:telemetry-taxonomy] ALL NINE domains derive non-trivial
 *                                 state on a populated store; every non-ok
 *                                 domain carries its REQUIRED action
 *                                 descriptor; the severity ordering and the
 *                                 worst-of rollup are proven (ok never
 *                                 masks down); the logging scrubber
 *                                 redacts credential-reference names; the
 *                                 trace() helper correlates command →
 *                                 queue → execution → effects over the ids
 *                                 the substrate already records; the
 *                                 readiness probe (the /api/ready additive
 *                                 enrichment's derivation) is exercised
 *                                 with an explicit database handle.
 *
 * Node-version note: requires Node.js >= 22.6 (node:sqlite + type
 * stripping); the harness self-configures the experimental flags on Node
 * builds that need them (same bootstrap as the merged harnesses).
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OBSERVABILITY_DIR = join(ROOT, 'src', 'lib', 'observability');
const RECOVERY_DIR = join(ROOT, 'src', 'lib', 'recovery');
const DURABLE_URL = (name) => pathToFileURL(join(ROOT, 'src', 'lib', 'durable', name)).href;
const MODULE_URL = (family, name) => pathToFileURL(join(ROOT, 'src', 'lib', family, name)).href;
const OBS_URL = (name) => pathToFileURL(join(OBSERVABILITY_DIR, name)).href;
const REC_URL = (name) => pathToFileURL(join(RECOVERY_DIR, name)).href;

const RESPAWN_ENV = 'PAYSWAP_DEP007_TEST_RESPAWNED';
const tempDirs = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `payswap-dep007-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/**
 * Bootstrap (mirrors the merged harnesses): probes node:sqlite
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
    await import(MODULE_URL('protocol-runtime', 'kernel/time.ts'));
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
    console.error('node:sqlite / type stripping. The DEP-007 harness requires Node.js >= 22.6.');
    process.exit(1);
  }
  process.exit(typeof child.status === 'number' ? child.status : 1);
}

await ensureCapabilities();

// -- module loading (the substrate + the composed families) ------------------

const { openDurableDatabase } = await import(DURABLE_URL('db.ts'));
const { recordEvent, SUBSTRATE_EVENT_OWNER } = await import(DURABLE_URL('events.ts'));
const { createEvidenceLog } = await import(MODULE_URL('protocol-runtime', 'evidence/log.ts'));
const { ProtocolGateway, commandQueuePortFromDurableQueue } = await import(
  MODULE_URL('protocol-runtime', 'gateway/admission.ts')
);
const { money } = await import(MODULE_URL('protocol-runtime', 'kernel/money.ts'));
const { hashRailPayload } = await import(MODULE_URL('protocol-runtime', 'rails/payload.ts'));
const operations = await import(MODULE_URL('operations', 'index.ts'));
const {
  registerOperationalJobs,
  enqueueOperationalJob,
  OPERATIONS_EVENT_OWNER,
  RECONCILIATION_SWEEP_JOB_KIND,
  CLEARING_PROGRESSION_JOB_KIND,
  NETTING_SETTLEMENT_PROGRESSION_JOB_KIND,
  operationalCommandIdempotencyKey,
} = operations;
const railConnectivity = await import(MODULE_URL('rail-connectivity', 'index.ts'));
const {
  resolveRailConnectivityConfig,
  createConnectivityBoundary,
  createAdapterActivityLog,
  RAIL_CONNECTIVITY_EVENT_OWNER,
  IN_PROCESS_SIMULATED_HOST_MARKER,
  TRANSPORT_FAILURE_CLASSIFICATION,
} = railConnectivity;
const recovery = await import(REC_URL('index.ts'));
const {
  createBackup,
  readBackupManifest,
  manifestSummary,
  restoreBackup,
  verifyEvidenceIntegrity,
  bindDurableRuntime,
  drainUntilSettled,
  replayRestoredQueue,
  recoveryAuditFromDatabase,
  RECOVERY_EVENT_OWNER,
  RECOVERY_EVENT_TYPES,
} = recovery;
const observability = await import(OBS_URL('index.ts'));
const {
  OBSERVABILITY_DOMAINS,
  DOMAIN_DEFINITIONS,
  collectTelemetrySnapshot,
  deriveComponentHealth,
  worstOf,
  HEALTH_SEVERITY,
  createObservabilityLogger,
  scrubCredentialReferences,
  trace,
  renderTrace,
  probeComponentHealth,
} = observability;

// ---------------------------------------------------------------------------
// The drill bookkeeping (exact counts for the report table)
// ---------------------------------------------------------------------------

const drillResults = [];
let liveAssertions = 0;

function makeDrill(name) {
  const notes = [];
  let scenarios = 0;
  let assertions = 0;
  const count = () => {
    assertions += 1;
    liveAssertions += 1;
    return assertions;
  };
  const drill = {
    name,
    note: (line) => notes.push(line),
    scenario: (label) => {
      scenarios += 1;
      notes.push(`#${scenarios} ${label}`);
    },
    check: (condition, message) => {
      const ordinal = count();
      if (!condition) {
        throw new Error(`[${name}] assertion #${ordinal} FAILED: ${message}`);
      }
    },
    equal: (actual, expected, message) => {
      const ordinal = count();
      if (actual !== expected) {
        throw new Error(
          `[${name}] assertion #${ordinal} FAILED: ${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
        );
      }
    },
    deepEqual: (actual, expected, message) => {
      const ordinal = count();
      try {
        assert.deepEqual(actual, expected);
      } catch (error) {
        throw new Error(`[${name}] assertion #${ordinal} FAILED: ${message} (${error.message})`);
      }
    },
    finish: () => {
      drillResults.push({ name, scenarios, assertions, notes });
      return notes;
    },
  };
  return drill;
}

// ---------------------------------------------------------------------------
// Shared drill fixtures
// ---------------------------------------------------------------------------

const DRILL_EVENT_OWNER = 'dep007-drill';
const EFFECT_EVENT_TYPE = 'dep007.drill.effect-applied';

/** Does an effect receipt already exist for this key (the read-only guard)? */
function receiptExists(database, type, effectKey) {
  const rows = database
    .prepare('SELECT data FROM durable_events WHERE type = ? AND owner = ?')
    .all(type, DRILL_EVENT_OWNER);
  return rows.some((row) => {
    try {
      return JSON.parse(String(row.data ?? '{}')).effectKey === effectKey;
    } catch {
      return false;
    }
  });
}

function countEvents(database, type, owner) {
  if (type === null || type === undefined) {
    const row = database.prepare('SELECT COUNT(*) AS total FROM durable_events').get();
    return Number(row?.total ?? 0);
  }
  const row = database
    .prepare('SELECT COUNT(*) AS total FROM durable_events WHERE type = ? AND (? IS NULL OR owner = ?)')
    .get(type, owner ?? null, owner ?? null);
  return Number(row?.total ?? 0);
}

function countEventsWithData(database, type, owner, key, value) {
  const rows = database
    .prepare('SELECT data FROM durable_events WHERE type = ? AND owner = ?')
    .all(type, owner);
  return rows.filter((row) => {
    try {
      return JSON.parse(String(row.data ?? '{}'))[key] === value;
    } catch {
      return false;
    }
  }).length;
}

function jobsByStatus(database, status) {
  const row = database.prepare('SELECT COUNT(*) AS total FROM durable_jobs WHERE status = ?').get(status);
  return Number(row?.total ?? 0);
}

function jobsOfKind(database, kind) {
  const row = database.prepare('SELECT COUNT(*) AS total FROM durable_jobs WHERE kind = ?').get(kind);
  return Number(row?.total ?? 0);
}

/**
 * THE drill effect handler: an idempotent worker (the at-least-once
 * contract the substrate demands). The effect is recorded ONCE per
 * idempotency key — the guard reads the journal for an existing receipt
 * BEFORE recording (the recorded-receipt discipline; the substrate's
 * UNIQUE(idempotency_key, kind) backstops the enqueue side).
 */
function makeEffectHandler(database, options = {}) {
  return async (job) => {
    const key = job.idempotencyKey ?? job.id;
    if (!receiptExists(database, EFFECT_EVENT_TYPE, key)) {
      recordEvent(database, EFFECT_EVENT_TYPE, { effectKey: key, jobId: job.id }, DRILL_EVENT_OWNER, job.id);
      if (options.crashAfterEffect) {
        // The crash-after-effect hazard: the process died between the
        // effect and complete() — simulated by a throw (the worker's
        // fail() path requeues with bounded backoff; the next execution's
        // guard prevents the second effect).
        throw new Error(`dep007 simulated crash after effect (key ${key})`);
      }
    }
  };
}

/** The deterministic operational read-surface fixture (the composition root binds it). */
function makeReadFixture() {
  return {
    clearing: { batch: () => undefined },
    netting: {
      nettingSet: () => undefined,
      listNettingSets: () => [],
      listNetObligations: () => [{ netObligationId: 'net-obs-1', state: 'CREATED' }],
      obligationClaim: () => undefined,
    },
    obligations: { obligations: () => [] },
    settlement: {
      listInstructions: () => [],
      instructionsForSubject: () => [],
      attemptForInstruction: () => undefined,
      listAttempts: () => [
        {
          attemptId: 'attempt-unknown-1',
          instructionId: 'instr-unknown-1',
          state: 'UNKNOWN',
          reconciliationCaseId: 'case-1',
        },
      ],
    },
    reconciliation: {
      getSource: () => undefined,
      listSources: () => [],
      listCases: () => [{ caseId: 'case-1', status: 'OPEN' }],
      getCycle: () => undefined,
    },
    queues: { queue: () => undefined },
    capability: { snapshot: () => ({ snapshotId: 'snap-dep007', capabilities: [] }) },
    liquidity: { pool: () => undefined },
    credit: { linesInOrder: () => [], lineExposure: () => undefined },
  };
}

function makeJobConfig() {
  return {
    clearingBatchLabelPrefix: 'dep007-batch-',
    nettingLabelPrefix: 'dep007-net-',
    settlementAdapterId: 'adapter-dep007',
    beneficiaryFor: () => 'acct-dep007',
    reconciliationSources: [],
    reconciliationRuleVersion: 1,
    queueIds: [],
  };
}

/**
 * The scripted transport double (the rail boundary's TEST SURFACE — the
 * test_rail_connectivity.mjs precedent): a per-key script of attempt
 * outcomes, a receive ledger collapsing duplicate (key, payloadHash), and
 * full call telemetry for the same-key retransmission assertions.
 */
function createScriptedTransportDouble(script = {}) {
  const transmitLog = [];
  const received = new Map();
  let receiveOrdinal = 0;
  const defaultDelivery = (request, duplicate) => ({
    kind: 'delivered-with-report',
    report: {
      outcomeClass: 'PENDING',
      railReferences: [`scripted.${request.railId}.${receiveOrdinal}`],
      payloadHash: request.payloadHash,
      reportedAtWallMs: 0,
    },
    duplicate,
    telemetry: { completedWallMs: 0, attempts: transmitLog.length, latencyMs: 5 },
  });
  return {
    transmit(request) {
      transmitLog.push(request);
      const scripted = script[request.idempotencyKey] ?? [];
      const ordinal = transmitLog.filter((r) => r.idempotencyKey === request.idempotencyKey).length;
      const scriptedResult = scripted[ordinal - 1];
      let duplicate = 'FIRST';
      const already = received.get(request.idempotencyKey);
      if (already !== undefined) {
        if (already.payloadHash === request.payloadHash) {
          duplicate = 'COLLAPSED';
        } else {
          return {
            kind: 'transport-failure',
            reason: 'RESPONSE_MALFORMED',
            detail: 'idempotency key reused with a different payload (scripted rail)',
            classification: TRANSPORT_FAILURE_CLASSIFICATION['RESPONSE_MALFORMED'],
            telemetry: { completedWallMs: 0, attempts: ordinal, latencyMs: 5 },
          };
        }
      } else {
        receiveOrdinal += 1;
        received.set(request.idempotencyKey, { payloadHash: request.payloadHash, ordinal: receiveOrdinal });
      }
      if (scriptedResult !== undefined && scriptedResult.kind !== 'delivered') {
        return {
          ...scriptedResult,
          telemetry: { completedWallMs: 0, attempts: ordinal, latencyMs: scriptedResult.latencyMs ?? 5 },
        };
      }
      return defaultDelivery(request, duplicate);
    },
    fetchReport(request) {
      const entry = received.get(request.idempotencyKey);
      if (entry === undefined) {
        return {
          outcomeClass: 'UNKNOWN',
          reasonCode: 'SILENCE',
          railReferences: [],
          payloadHash: '',
          reportedAtWallMs: 0,
        };
      }
      return {
        outcomeClass: 'PENDING',
        railReferences: [`scripted.${request.railId}.${entry.ordinal}`],
        payloadHash: entry.payloadHash,
        reportedAtWallMs: 0,
      };
    },
    transmitLog,
    received,
  };
}

const RAIL_ENV = {
  PAYSWAP_RAIL_SANDBOX_DEMOBANK_HOST: IN_PROCESS_SIMULATED_HOST_MARKER,
  PAYSWAP_RAIL_SANDBOX_DEMOBANK_TIMEOUT_MS: '5000',
};

/**
 * THE drill composition (the trimmed form of the test_operations.mjs
 * composition — the DEP-004 precedent): the real substrate (via
 * bindDurableRuntime — the exported DurableQueue/DurableWorker classes),
 * the real RTN-010 gateway over the real A15 log, the real DEP-004
 * operational jobs over a deterministic read fixture, and (optionally)
 * the real DEP-005 connectivity boundary with its activity log dual-
 * writing into the durable journal.
 */
async function composeDrillStore(options = {}) {
  const dir = tempDir(options.prefix ?? 'store');
  const database = openDurableDatabase({ dbPath: join(dir, 'durable.sqlite') });
  const runtime = bindDurableRuntime({
    database,
    workerId: options.workerId ?? 'dep007-harness-worker',
    concurrency: 1,
    leaseMs: options.leaseMs ?? 40,
    backoffBaseMs: 10,
    backoffMaxMs: 50,
  });
  const effectHandler = makeEffectHandler(database, { crashAfterEffect: options.crashAfterEffect });
  runtime.register('dep007.drill.effect', effectHandler);

  // The evidence log + the gateway (the ONE admission point).
  const log = createEvidenceLog({ wallMs: 1_000 });
  const gateway = new ProtocolGateway({
    evidence: log,
    queue: commandQueuePortFromDurableQueue(runtime.queue),
    wallClock: () => Date.now(),
  });

  // The operational jobs over the deterministic read fixture.
  const reads = options.reads ?? makeReadFixture();
  const jobConfig = options.jobConfig ?? makeJobConfig();
  const audit = {
    recordEvent: (type, data, owner, jobId) => recordEvent(database, type, data, owner, jobId),
  };
  const jobSubstrate = {
    register: (kind, handler) => runtime.register(kind, handler),
    enqueueJob: (kind, payload, enqueueOptions) => runtime.enqueue(kind, payload, enqueueOptions),
  };
  const wiring = registerOperationalJobs(jobSubstrate, { gateway, reads, audit, config: jobConfig });

  // The rail connectivity boundary (optional per drill) with its activity
  // log dual-writing to the durable journal under 'rail-connectivity'.
  let boundary = null;
  let transport = null;
  let activity = null;
  if (options.railScript !== undefined) {
    const resolution = resolveRailConnectivityConfig({
      processEnv: RAIL_ENV,
      runtimeScope: { scope: 'sandbox' },
      declaredRails: [{ railId: 'demobank' }],
    });
    assert.equal(resolution.ok, true, 'the drill rail configuration must resolve');
    activity = createAdapterActivityLog({ audit });
    transport = createScriptedTransportDouble(options.railScript);
    let railWall = 10_000;
    boundary = createConnectivityBoundary({
      rails: resolution.rails,
      runtimeScope: 'sandbox',
      transportFactory: () => transport,
      activity,
      clock: () => railWall,
    });
  }

  return {
    dir,
    database,
    runtime,
    gateway,
    log,
    reads,
    jobConfig,
    audit,
    jobSubstrate,
    wiring,
    effectHandler,
    boundary,
    transport,
    activity,
    backupPaths: {
      manifest: join(dir, 'backup-manifest.jsonl'),
      backup: join(dir, 'backup-1.sqlite'),
      target: join(dir, 'restored-1.sqlite'),
    },
    async drain(maxPasses = 120) {
      return drainUntilSettled({ runtime, settleMs: 6, maxPasses });
    },
    async close() {
      await runtime.stop();
      database.close();
    },
  };
}

/** One rail transmission through the boundary's frozen interface. */
function railTransmit(boundary, key) {
  const payload = {
    instructionId: `instr-${key}`,
    money: money('EUR', 1_000, 2),
    beneficiary: 'bene-dep007',
  };
  return boundary.adapters.get('demobank').transmit({
    idempotencyKey: key,
    payload,
    payloadHash: hashRailPayload(payload),
  });
}

// ---------------------------------------------------------------------------
// 0. [drill:family-barrels] — the barrels + the static discipline scan
// ---------------------------------------------------------------------------

async function drillFamilyBarrels() {
  const drill = makeDrill('drill:family-barrels');
  drill.scenario('family barrels load under plain Node');
  drill.equal(typeof collectTelemetrySnapshot, 'function', 'the observability barrel exports the snapshot collector');
  drill.equal(typeof deriveComponentHealth, 'function', 'the observability barrel exports the health model');
  drill.equal(typeof createBackup, 'function', 'the recovery barrel exports createBackup');
  drill.equal(typeof restoreBackup, 'function', 'the recovery barrel exports restoreBackup');
  drill.equal(typeof replayRestoredQueue, 'function', 'the recovery barrel exports the replay driver');
  drill.equal(OBSERVABILITY_DOMAINS.length, 9, 'the taxonomy union has exactly NINE members');
  drill.note('barrels-load:9-domains');

  drill.scenario('static discipline scan over both family sources');
  // The frozen-surface prohibitions BOTH families share: no gateway, no
  // transition/hosting, no authority module, no network client, no
  // secret-shaped strings.
  const sharedForbiddenImports = [
    /from\s+'\.\.\/protocol-runtime\/gateway\//,
    /from\s+'\.\.\/protocol-runtime\/transition\//,
    /from\s+'\.\.\/protocol-runtime\/hosting\//,
    /from\s+'\.\.\/protocol-runtime\/(obligations|netting|settlement|clearing|queues|risk|intent|policy|capability|routing|reservations|liquidity|credit)\//,
    /from\s+'\.\.\/protocol-runtime\/rails\/(authority|runtime|persistence|reconciliation)\.ts'/,
  ];
  // Observability additionally: never drives the substrate or the
  // operations machinery — no value import of the queue/worker modules, no
  // import of the orchestration/registration surface, and NO recordEvent
  // call anywhere (telemetry is observation only — the forbidden boundary).
  const observabilityForbiddenImports = [
    ...sharedForbiddenImports,
    /from\s+'\.\.\/operations\/orchestration\.ts'/,
    /from\s+'\.\.\/durable\/(queue|worker|scheduler)\.ts'/,
  ];
  const observabilityForbiddenCalls = [/\bregisterOperationalJobs\s*\(/, /\benqueueOperationalJob\s*\(/, /\bwireOperationalJobScheduler\s*\(/];
  // Recovery: the operations family is entirely out of reach (recovery
  // never drives the operational duties; the drills do, at the composition
  // root).
  const recoveryForbiddenImports = [
    ...sharedForbiddenImports,
    /from\s+'\.\.\/operations\//,
  ];
  const forbiddenPrimitives = [
    /(?<![.\w])fetch\s*\(/,
    /globalThis\s*\.\s*fetch/,
    /\bnew\s+(?:WebSocket|net\.Socket|tls\.TLSSocket|http\.ClientRequest|https\.ClientRequest)\b/,
    /\brequire\s*\(\s*['"](node:)?(http|https|net|tls|dgram|dns)['"]\s*\)/,
    /\bfrom\s+['"](node:)?(http|https|net|tls|dgram|dns)['"]\b/,
  ];
  const secretPatterns = [
    /ghp_[A-Za-z0-9]{20,}/,
    /sk-[A-Za-z0-9]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /(?:API_KEY|SECRET|PASSWORD|TOKEN)\s*[:=]\s*['"][^'"]{8,}['"]/,
  ];
  const observabilityFiles = readdirSync(OBSERVABILITY_DIR).filter((name) => name.endsWith('.ts'));
  const recoveryFiles = readdirSync(RECOVERY_DIR).filter((name) => name.endsWith('.ts'));
  drill.check(observabilityFiles.length >= 6, `the observability family has its modules (${observabilityFiles.length})`);
  drill.check(recoveryFiles.length >= 5, `the recovery family has its modules (${recoveryFiles.length})`);
  // Type-only imports are erased at load time — the scan judges VALUE imports.
  const valueImportText = (text) => text.replace(/^import\s+type\s[^\n]*$/gm, '').replace(/^export\s+type\s[^\n]*$/gm, '');
  for (const [dir, files, forbiddenImports, isObservability] of [
    [OBSERVABILITY_DIR, observabilityFiles, observabilityForbiddenImports, true],
    [RECOVERY_DIR, recoveryFiles, recoveryForbiddenImports, false],
  ]) {
    for (const name of files) {
      const text = readFileSync(join(dir, name), 'utf8');
      const valueText = valueImportText(text);
      for (const pattern of forbiddenImports) {
        drill.check(!pattern.test(valueText), `${name} must not value-import a frozen runtime surface (${pattern})`);
      }
      for (const pattern of forbiddenPrimitives) {
        drill.check(!pattern.test(text), `${name} must not construct a network client (${pattern})`);
      }
      for (const pattern of secretPatterns) {
        drill.check(!pattern.test(text), `${name} contains no secret-shaped strings (${pattern})`);
      }
      if (isObservability) {
        // THE forbidden boundary, machine-checked: telemetry NEVER writes.
        drill.check(
          !/\brecordEvent\s*\(/.test(text),
          `${name} must never call recordEvent (telemetry is observation only — the forbidden boundary)`,
        );
        for (const pattern of observabilityForbiddenCalls) {
          drill.check(!pattern.test(text), `${name} must never drive the operations machinery (${pattern})`);
        }
        drill.check(
          !/from\s+'\.\.\/durable\/events\.ts'.*recordEvent/.test(valueText),
          `${name} imports only the read surface from the durable events module`,
        );
      }
    }
  }
  drill.note(`scan:observability=${observabilityFiles.length}:recovery=${recoveryFiles.length}`);
  return drill.finish();
}

// ---------------------------------------------------------------------------
// 1. [drill:backup-restore]
// ---------------------------------------------------------------------------

async function drillBackupRestore() {
  const drill = makeDrill('drill:backup-restore');
  const composition = await composeDrillStore({ prefix: 'backup', railScript: {} });
  try {
    drill.scenario('populated store: jobs across every reachable status, events from four owners');
    // Succeeded drill jobs (3) + one poison job that dead-letters.
    for (const key of ['eff-1', 'eff-2', 'eff-3']) {
      composition.runtime.enqueue('dep007.drill.effect', { key }, { idempotencyKey: key });
    }
    composition.runtime.register('dep007.drill.poison', async (job) => {
      recordEvent(
        composition.database,
        'dep007.drill.poison-touched',
        { effectKey: job.idempotencyKey, jobId: job.id },
        DRILL_EVENT_OWNER,
        job.id,
      );
      throw new Error('dep007 poison handler: deterministic failure to dead-letter');
    });
    composition.runtime.enqueue('dep007.drill.poison', {}, { idempotencyKey: 'eff-dead', maxAttempts: 1 });
    await composition.drain();
    drill.equal(jobsByStatus(composition.database, 'succeeded'), 3, 'the three effect jobs succeeded');
    drill.equal(jobsByStatus(composition.database, 'dead_lettered'), 1, 'the poison job dead-lettered (bounded retries)');
    drill.equal(
      countEvents(composition.database, 'job_dead_lettered', SUBSTRATE_EVENT_OWNER),
      1,
      'the dead-letter lifecycle event is journaled',
    );

    // The operational jobs (the DEP-004 family — invoked, never re-implemented).
    await enqueueOperationalJob(composition.jobSubstrate, RECONCILIATION_SWEEP_JOB_KIND, {
      cycle: 1,
      windowStartWallMs: 0,
      windowEndWallMs: 1_000,
    });
    await enqueueOperationalJob(composition.jobSubstrate, CLEARING_PROGRESSION_JOB_KIND, {
      cycle: 1,
      windowStartWallMs: 0,
      windowEndWallMs: 1_000,
    });
    await enqueueOperationalJob(composition.jobSubstrate, NETTING_SETTLEMENT_PROGRESSION_JOB_KIND, {
      cycle: 1,
      windowStartWallMs: 0,
      windowEndWallMs: 1_000,
    });
    await composition.drain();
    drill.equal(jobsOfKind(composition.database, 'reconciliation.case.investigate'), 1, 'the sweep admitted one investigate command');
    drill.equal(jobsOfKind(composition.database, 'clearing.batch.open'), 1, 'the clearing job admitted one batch-open command');
    drill.equal(jobsOfKind(composition.database, 'settlement.instruction.create'), 1, 'the settlement phase admitted one instruction-create command');
    drill.equal(
      countEvents(composition.database, 'operations.unknown.held', OPERATIONS_EVENT_OWNER),
      1,
      'the settlement phase surfaced the UNKNOWN-held attempt (never retried)',
    );

    // Rail-connectivity activity INTO this store (the DEP-005 surface).
    const railOutcome = railTransmit(composition.boundary, 'dep007-backup-rail-1');
    drill.equal(railOutcome.class, 'ACCEPTED', 'the scripted delivery maps to the frozen ACCEPTED class');
    drill.equal(
      countEvents(composition.database, 'rail.transmit.delivered', RAIL_CONNECTIVITY_EVENT_OWNER),
      1,
      'the rail activity dual-writes to the durable journal (owner rail-connectivity)',
    );

    // A reserved zombie + a queued job, so the backup captures mid-flight state.
    composition.runtime.enqueue('dep007.drill.effect', { key: 'eff-zombie' }, { idempotencyKey: 'eff-zombie' });
    const zombie = composition.runtime.queue.reserve('dep007-zombie-worker', 60_000, {
      kind: 'dep007.drill.effect',
    });
    drill.check(zombie !== null, 'the zombie job was reserved mid-flight (the kill)');
    composition.runtime.enqueue('dep007.drill.effect', { key: 'eff-queued' }, { idempotencyKey: 'eff-queued' });
    const stats = composition.runtime.queue.stats();
    const totalJobsAtBackup = stats.queued + stats.reserved + stats.succeeded + stats.failed + stats.dead_lettered;
    drill.equal(stats.reserved, 1, 'exactly one reserved (zombie) job at backup time');
    drill.equal(stats.queued, 4, 'four queued jobs at backup time (one drill job + three admitted commands)');
    const eventCountBefore = countEvents(composition.database, null);
    drill.check(eventCountBefore >= 20, `the store is populated (${eventCountBefore} events)`);
    const owners = new Set(
      composition.database
        .prepare('SELECT DISTINCT owner FROM durable_events')
        .all()
        .map((row) => String(row.owner)),
    );
    for (const owner of ['durable-substrate', 'operational-jobs', 'rail-connectivity', 'dep007-drill']) {
      drill.check(owners.has(owner), `events from owner '${owner}' are present in the backed-up store`);
    }
    drill.note(`populated:jobs=${totalJobsAtBackup}:events=${eventCountBefore}:owners=${owners.size}`);

    drill.scenario('verified online backup + append-only manifest row');
    const entry = createBackup({
      database: composition.database,
      backupPath: composition.backupPaths.backup,
      manifestPath: composition.backupPaths.manifest,
      audit: recoveryAuditFromDatabase(composition.database),
    });
    drill.check(entry.byteSize > 0, `the backup artifact is non-empty (${entry.byteSize} bytes)`);
    drill.check(/^[0-9a-f]{64}$/.test(entry.sha256), 'the manifest records the artifact sha256');
    drill.check(entry.migrations.length >= 1, 'the manifest records the applied migration set');
    drill.equal(entry.integrityCheck, 'ok', 'the fresh backup passed its own integrity_check');
    drill.equal(entry.migrationChecksumsMatch, true, 'the backup migrations match the source');
    drill.equal(entry.evidenceDigestsMatch, true, 'the backup evidence digests match the source');
    drill.equal(entry.eventCount, eventCountBefore, 'the manifest event count equals the pre-backup count');
    drill.equal(entry.jobCount, totalJobsAtBackup, 'the manifest job count equals the store job count');
    drill.check(/^[0-9a-f]{64}$/.test(entry.evidenceRootDigest), 'the manifest records the evidence root digest');
    const manifestRows = readBackupManifest(composition.backupPaths.manifest);
    drill.equal(manifestRows.length, 1, 'the manifest holds exactly one row after one backup');
    drill.equal(manifestRows[0].backupId, entry.backupId, 'the manifest row is the backup receipt');
    drill.note(`backup:${entry.backupId}:${entry.byteSize}B:events=${entry.eventCount}`);

    drill.scenario('restore into a fresh target copy — the full verification battery');
    const restore = restoreBackup({
      backupPath: composition.backupPaths.backup,
      targetPath: composition.backupPaths.target,
      manifestPath: composition.backupPaths.manifest,
      audit: recoveryAuditFromDatabase(composition.database),
    });
    drill.equal(restore.verification.integrityCheck, 'ok', 'the restored target passes integrity_check');
    drill.equal(restore.verification.migrationsMatch, true, 'the target migrations match the backup record');
    drill.equal(restore.verification.repoMigrationsMatch, true, 'the backup migrations match the repository files');
    drill.equal(restore.verification.evidenceIntegrity.ok, true, 'evidence integrity verified after restore');
    drill.equal(
      restore.verification.evidenceIntegrity.verifiedCount,
      entry.eventCount,
      'every event row digest verified',
    );
    drill.equal(restore.verification.evidenceIntegrity.mismatches.length, 0, 'no evidence mismatches');
    drill.equal(restore.verification.evidenceIntegrity.rootDigestMatches, true, 'the evidence root digest matches');
    drill.equal(restore.database.path, resolve(composition.backupPaths.target), 'the restored handle is the TARGET copy (never in place)');
    drill.equal(restore.database.isOpen(), true, 'the restored handle is open through the substrate');
    drill.note(`restore:verified:events=${restore.verification.evidenceIntegrity.verifiedCount}`);

    drill.scenario('event/journal continuity + append-only history preserved');
    const continuity = restore.verification.continuity;
    drill.equal(continuity.ok, true, 'continuity verified');
    drill.equal(continuity.gaps.length, 0, 'no restore-introduced gaps');
    drill.equal(continuity.expectedEventIds.length, entry.eventCount, 'every backup event id is expected');
    drill.equal(continuity.restoredEventIds.length, entry.eventCount, 'the restored target holds exactly the backup events (restore appends nothing)');
    drill.check(
      continuity.expectedEventIds.every((id, index) => continuity.restoredEventIds[index] === id),
      'the restored ids equal the backup ids positionally (monotonic, no gaps)',
    );
    drill.equal(
      countEvents(restore.database, null),
      entry.eventCount,
      'append-only preserved: the restored store contains every event the backup contained',
    );
    // The source store, in contrast, gained exactly the recovery audit rows.
    drill.equal(
      countEvents(composition.database, null),
      eventCountBefore + 2,
      'the source store gained exactly the recovery audit rows (backup.completed + restore.verified) — the incident narrative lives on the live store',
    );
    drill.equal(
      countEvents(composition.database, RECOVERY_EVENT_TYPES.backupCompleted, RECOVERY_EVENT_OWNER),
      1,
      'the backup audit row is recorded under the incident-recovery owner',
    );
    drill.equal(
      countEvents(composition.database, RECOVERY_EVENT_TYPES.restoreVerified, RECOVERY_EVENT_OWNER),
      1,
      'the restore audit row is recorded under the incident-recovery owner',
    );
    const restoredJobCount = restore.database.prepare('SELECT COUNT(*) AS total FROM durable_jobs').get();
    drill.equal(Number(restoredJobCount.total), entry.jobCount, 'the restored job count matches the manifest');

    drill.scenario('fail-closed restore refusals');
    let refused = false;
    try {
      restoreBackup({
        backupPath: composition.backupPaths.backup,
        targetPath: composition.backupPaths.target,
        manifestPath: composition.backupPaths.manifest,
      });
    } catch (error) {
      refused = /refusing to clobber/.test(error.message);
    }
    drill.check(refused, 'restore refuses to clobber an existing target (never in place)');
    restore.database.close();
    return drill.finish();
  } finally {
    await composition.close();
  }
}

// ---------------------------------------------------------------------------
// 2. [drill:worker-restart]
// ---------------------------------------------------------------------------

async function drillWorkerRestart() {
  const drill = makeDrill('drill:worker-restart');
  const composition = await composeDrillStore({ prefix: 'restart' });
  try {
    drill.scenario('kill mid-flight → lease expiry → RESTARTED worker drains → exactly-once');
    // (a) Enqueue the victim and claim it through the queue API.
    composition.runtime.enqueue('dep007.drill.effect', { key: 'restart-a' }, { idempotencyKey: 'restart-a' });
    const victim = composition.runtime.queue.reserve('dep007-original-worker', 40, {
      kind: 'dep007.drill.effect',
    });
    drill.check(victim !== null, 'the victim job was reserved by the original worker');
    // (b) THE KILL: execute the atomic unit directly (the DEP-004 harness
    //     precedent — a dying worker's direct execution), then never
    //     complete (the process died between effect and completion).
    await composition.effectHandler(victim);
    drill.equal(
      countEventsWithData(composition.database, EFFECT_EVENT_TYPE, DRILL_EVENT_OWNER, 'effectKey', 'restart-a'),
      1,
      'the killed execution recorded its effect exactly once',
    );
    drill.equal(
      composition.runtime.queue.getJob(victim.id).status,
      'reserved',
      'the job is still reserved (the worker died before complete())',
    );
    // (c) Lease expiry: the at-least-once redelivery.
    await sleep(60);
    const reclaim = composition.runtime.queue.reclaimExpired(Date.now());
    drill.equal(reclaim.reclaimed, 1, 'the expired lease was reclaimed (the job returns to queued)');
    drill.equal(
      countEvents(composition.database, 'job_lease_expired', SUBSTRATE_EVENT_OWNER),
      1,
      'the lease-expiry lifecycle event is journaled',
    );
    // (d) THE RESTART: a fresh worker over the same store (a genuine restart
    //     — new worker identity, same exported classes, same queue API).
    const restarted = bindDurableRuntime({
      database: composition.database,
      workerId: 'dep007-restarted-worker',
      concurrency: 1,
      leaseMs: 40,
      backoffBaseMs: 10,
      backoffMaxMs: 50,
    });
    restarted.register('dep007.drill.effect', makeEffectHandler(composition.database));
    const drain = await drainUntilSettled({ runtime: restarted, settleMs: 6, maxPasses: 80 });
    drill.check(drain.settled, 'the restarted worker drained the store to settlement');
    const finished = composition.runtime.queue.getJob(victim.id);
    drill.equal(finished.status, 'succeeded', 'the redelivered job completed after the restart');
    drill.equal(finished.attempts, 1, 'the redelivery counted exactly one attempt');
    drill.equal(finished.reservedBy, null, 'no zombie reservation (reservedBy cleared on completion)');
    drill.equal(
      countEventsWithData(composition.database, EFFECT_EVENT_TYPE, DRILL_EVENT_OWNER, 'effectKey', 'restart-a'),
      1,
      'EXACTLY-ONCE: the re-execution produced NO second effect (the recorded receipt guarded it)',
    );
    drill.equal(
      countEvents(composition.database, 'job_succeeded', SUBSTRATE_EVENT_OWNER),
      1,
      'exactly one job_succeeded lifecycle event',
    );
    drill.equal(jobsByStatus(composition.database, 'reserved'), 0, 'no zombie reservations remain');

    drill.scenario('worker-loop crash (effect recorded, handler throws) → bounded backoff → idempotent completion');
    const crashComposition = await composeDrillStore({ prefix: 'crash', crashAfterEffect: true });
    try {
      crashComposition.runtime.enqueue('dep007.drill.effect', { key: 'restart-b' }, { idempotencyKey: 'restart-b' });
      const crashDrain = await crashComposition.drain();
      drill.check(crashDrain.settled, 'the crash drain settled (the backoff window passed)');
      const crashed = crashComposition.runtime.queue.getByIdempotencyKey('dep007.drill.effect', 'restart-b');
      drill.equal(crashed.status, 'succeeded', 'the crashed job completed on its redelivery');
      drill.equal(crashed.attempts, 1, 'exactly one failed attempt before the successful redelivery');
      drill.equal(
        countEventsWithData(crashComposition.database, EFFECT_EVENT_TYPE, DRILL_EVENT_OWNER, 'effectKey', 'restart-b'),
        1,
        'EXACTLY-ONCE: the at-least-once redelivery did not duplicate the effect',
      );
      drill.equal(
        countEvents(crashComposition.database, 'job_attempt_failed', SUBSTRATE_EVENT_OWNER),
        1,
        'the failed attempt is journaled (bounded backoff evidence)',
      );
      drill.equal(jobsByStatus(crashComposition.database, 'reserved'), 0, 'no zombie reservations remain');
      const expired = crashComposition.database
        .prepare("SELECT COUNT(*) AS total FROM durable_jobs WHERE status = 'reserved' AND lease_expires_at <= ?")
        .get(Date.now());
      drill.equal(Number(expired.total), 0, 'no lease-expired reserved jobs remain');
      drill.note(`restart:exactly-once:attempts=${crashed.attempts}`);
    } finally {
      await crashComposition.close();
    }
    return drill.finish();
  } finally {
    await composition.close();
  }
}

// ---------------------------------------------------------------------------
// 3. [drill:replay-recovery]
// ---------------------------------------------------------------------------

async function drillReplayRecovery() {
  const drill = makeDrill('drill:replay-recovery');
  const composition = await composeDrillStore({ prefix: 'replay' });
  try {
    drill.scenario('crash mid-flight after command admission → backup (the recovery point)');
    // (a) The clearing job completes normally (a healthy pre-crash run).
    await enqueueOperationalJob(composition.jobSubstrate, CLEARING_PROGRESSION_JOB_KIND, {
      cycle: 7,
      windowStartWallMs: 7_000,
      windowEndWallMs: 8_000,
    });
    await composition.drain();
    drill.equal(
      jobsOfKind(composition.database, 'clearing.batch.open'),
      1,
      'the clearing job admitted its window-batch command (the D-2 queued class)',
    );
    // (b) THE SWEEP CRASH: trigger cycle 7, reserve the job, execute the
    //     atomic unit directly (the DEP-004 restart-evidence precedent),
    //     never complete.
    const sweepTrigger = enqueueOperationalJob(composition.jobSubstrate, RECONCILIATION_SWEEP_JOB_KIND, {
      cycle: 7,
      windowStartWallMs: 7_000,
      windowEndWallMs: 8_000,
    });
    drill.equal(sweepTrigger.created, true, 'the sweep trigger created the job (first trigger)');
    const sweepJob = composition.runtime.queue.reserve('dep007-sweep-worker', 40, {
      kind: RECONCILIATION_SWEEP_JOB_KIND,
    });
    drill.check(sweepJob !== null, 'the sweep job was reserved by the dying worker');
    const sweepHandler = composition.wiring.handlerFor(RECONCILIATION_SWEEP_JOB_KIND);
    await sweepHandler(sweepJob);
    // The dying execution admitted the investigate command K.
    const expectedCommandKey = operationalCommandIdempotencyKey(
      RECONCILIATION_SWEEP_JOB_KIND,
      7,
      'case-1',
      'reconciliation.case.investigate',
    );
    drill.equal(
      countEventsWithData(
        composition.database,
        'operations.command.submitted',
        OPERATIONS_EVENT_OWNER,
        'idempotencyKey',
        expectedCommandKey,
      ),
      1,
      'the dying sweep execution admitted command K (created receipt recorded)',
    );
    const commandJob = composition.runtime.queue.getByIdempotencyKey(
      'reconciliation.case.investigate',
      expectedCommandKey,
    );
    drill.check(commandJob !== null, 'the command K durable job exists (the receipt position)');
    drill.equal(commandJob.status, 'queued', 'the command job sits queued (the un-hosted D-2 class)');
    // (c) The netting job is triggered but never executed (queued at backup).
    enqueueOperationalJob(composition.jobSubstrate, NETTING_SETTLEMENT_PROGRESSION_JOB_KIND, {
      cycle: 7,
      windowStartWallMs: 7_000,
      windowEndWallMs: 8_000,
    });
    // (d) The recovery point.
    const entry = createBackup({
      database: composition.database,
      backupPath: composition.backupPaths.backup,
      manifestPath: composition.backupPaths.manifest,
      audit: recoveryAuditFromDatabase(composition.database),
    });
    drill.equal(entry.integrityCheck, 'ok', 'the recovery-point backup verified');
    drill.note(`recovery-point:events=${entry.eventCount}:jobs=${entry.jobCount}`);

    drill.scenario('restore + replay through the EXISTING worker/queue API — the dedupe proof');
    const restore = restoreBackup({
      backupPath: composition.backupPaths.backup,
      targetPath: composition.backupPaths.target,
      manifestPath: composition.backupPaths.manifest,
      audit: recoveryAuditFromDatabase(composition.database),
    });
    drill.equal(restore.verification.evidenceIntegrity.ok, true, 'the restored copy verified');
    // THE REPLAY COMPOSITION (a genuine process restart over the restored
    // copy): a fresh runtime + a FRESH gateway (empty in-memory receipts —
    // the cross-process dedupe relies on the substrate's UNIQUE
    // (idempotency_key, kind), restored intact) + the same fixture reads.
    const replayRuntime = bindDurableRuntime({
      database: restore.database,
      workerId: 'dep007-replay-worker',
      concurrency: 1,
      leaseMs: 40,
      backoffBaseMs: 10,
      backoffMaxMs: 50,
    });
    const replayGateway = new ProtocolGateway({
      evidence: createEvidenceLog({ wallMs: 9_000 }),
      queue: commandQueuePortFromDurableQueue(replayRuntime.queue),
      wallClock: () => Date.now(),
    });
    const replayAudit = {
      recordEvent: (type, data, owner, jobId) => recordEvent(restore.database, type, data, owner, jobId),
    };
    const replayJobSubstrate = {
      register: (kind, handler) => replayRuntime.register(kind, handler),
      enqueueJob: (kind, payload, enqueueOptions) => replayRuntime.enqueue(kind, payload, enqueueOptions),
    };
    const replayWiring = registerOperationalJobs(replayJobSubstrate, {
      gateway: replayGateway,
      reads: composition.reads,
      audit: replayAudit,
      config: composition.jobConfig,
    });
    const replayHandlers = new Map(replayWiring.jobs.map((job) => [job.kind, job.handler]));
    // The recovery window: by replay time the crashed sweep's lease (40 ms)
    // has expired — the at-least-once redelivery is due (a real restore
    // takes far longer than the lease; the sleep makes it deterministic).
    await sleep(60);
    const replay = await replayRestoredQueue({
      database: restore.database,
      handlers: replayHandlers,
      audit: recoveryAuditFromDatabase(composition.database),
      settleMs: 6,
      maxPasses: 120,
    });
    drill.check(replay.drain.settled, 'the replay drain settled');
    // The sweep job was reserved mid-flight at replay start and redelivered.
    drill.equal(replay.redeliveredJobs.length, 1, 'exactly one job was redelivered (the crashed sweep)');
    drill.check(replay.redeliveredJobs.includes(sweepJob.id), 'the redelivered job is the crashed sweep job');
    // The re-executed sweep is terminal.
    const replayedSweep = replayRuntime.queue.getJob(sweepJob.id);
    drill.equal(replayedSweep.status, 'succeeded', 'the re-executed sweep completed');
    // THE DEDUPE PROOF: still exactly ONE command job for K in the restored copy.
    drill.equal(
      jobsOfKind(restore.database, 'reconciliation.case.investigate'),
      1,
      'NO SECOND EFFECT: the re-submission of command K produced no second durable job (UNIQUE(idempotency_key, kind) held under replay)',
    );
    // The journal carries BOTH submissions: the dying execution's created
    // receipt AND the replay's replayed receipt — the same idempotency key.
    const submissions = restore.database
      .prepare('SELECT data FROM durable_events WHERE type = ? AND owner = ? ORDER BY id ASC')
      .all('operations.command.submitted', OPERATIONS_EVENT_OWNER)
      .map((row) => JSON.parse(String(row.data ?? '{}')))
      .filter((data) => data.idempotencyKey === expectedCommandKey);
    drill.equal(submissions.length, 2, 'the journal recorded both submissions of command K (the dying execution + the replay)');
    drill.equal(submissions[0].created, true, 'the first submission created the receipt');
    drill.equal(submissions[0].replayed, false, 'the first submission was a first admission');
    drill.equal(submissions[1].created, false, 'the replay submission was deduplicated (created: false)');
    drill.equal(submissions[1].replayed, true, 'the replay submission returned the RECORDED receipt (replayed: true)');
    drill.equal(
      submissions[0].idempotencyKey,
      submissions[1].idempotencyKey,
      'both submissions carry the SAME deterministic command key (the re-derivation)',
    );
    drill.note(`replay:dedupe:command-key=${expectedCommandKey}`);

    drill.scenario('UNKNOWN surfaced, never retried — and the re-derivation is identical');
    // The netting job ran during the replay: one instruction-create command
    // admitted, one UNKNOWN-held audit row, and ZERO submissions for the
    // UNKNOWN-held subject (the never-retry discipline).
    drill.equal(
      jobsOfKind(restore.database, 'settlement.instruction.create'),
      1,
      'the netting job admitted its settlement command during replay',
    );
    drill.equal(
      countEvents(restore.database, 'operations.unknown.held', OPERATIONS_EVENT_OWNER),
      1,
      'the UNKNOWN-held outcome was surfaced exactly once',
    );
    const unknownRetries = restore.database
      .prepare('SELECT data FROM durable_events WHERE type = ? AND owner = ?')
      .all('operations.command.submitted', OPERATIONS_EVENT_OWNER)
      .map((row) => JSON.parse(String(row.data ?? '{}')))
      .filter((data) => data.subject === 'instr-unknown-1');
    drill.equal(unknownRetries.length, 0, 'NO submission exists for the UNKNOWN-held subject (never retried — the DEP-005 contract)');
    // The sweep ran twice (the dying execution + the replay) — the audit
    // narrative records both — while the EFFECT count stayed one (above).
    const sweepCompletions = restore.database
      .prepare('SELECT data FROM durable_events WHERE type = ? AND owner = ?')
      .all('operations.job.completed', OPERATIONS_EVENT_OWNER)
      .map((row) => JSON.parse(String(row.data ?? '{}')))
      .filter((data) => data.jobKind === RECONCILIATION_SWEEP_JOB_KIND);
    drill.equal(sweepCompletions.length, 2, 'the audit narrative shows both sweep executions (at-least-once delivery); the effect count stayed one');
    drill.note('unknown:surfaced-once:zero-retry-submissions');

    drill.scenario('trigger re-drive is deduped + post-replay health');
    // Re-triggering the same cycle is absorbed by the substrate dedupe.
    const retrigger = enqueueOperationalJob(replayJobSubstrate, RECONCILIATION_SWEEP_JOB_KIND, {
      cycle: 7,
      windowStartWallMs: 7_000,
      windowEndWallMs: 8_000,
    });
    drill.equal(retrigger.created, false, 'the same-cycle trigger re-drive was deduplicated (created: false)');
    drill.equal(retrigger.reason, 'deduplicated', 'the re-drive reports the deduplicated reason');
    drill.equal(
      jobsOfKind(restore.database, 'operations.reconciliation-sweep'),
      1,
      'still exactly one sweep job row for the cycle',
    );
    // Post-replay health over the restored copy (with the manifest bound):
    const snapshot = collectTelemetrySnapshot(restore.database, {
      backupManifest: manifestSummary(readBackupManifest(composition.backupPaths.manifest)),
      isCommandJobKind: (kind) => !kind.startsWith('operations.') && !kind.startsWith('dep007.'),
    });
    const health = deriveComponentHealth(snapshot);
    drill.check(
      ['ok', 'degraded'].includes(health.overall),
      `the post-replay composite health is serving (${health.overall})`,
    );
    drill.equal(
      health.domains['settlement-finality'].state,
      'degraded',
      'the settlement-finality domain reports the UNKNOWN-held signal (finality blocked pending reconciliation)',
    );
    drill.check(
      health.domains['settlement-finality'].action !== undefined,
      'the degraded settlement domain carries its required action descriptor',
    );
    drill.equal(health.domains.reconciliation.state, 'ok', 'the sweep freshness is healthy post-replay');
    restore.database.close();
    return drill.finish();
  } finally {
    await composition.close();
  }
}

// ---------------------------------------------------------------------------
// 4. [drill:failure-injection]
// ---------------------------------------------------------------------------

async function drillFailureInjection() {
  const drill = makeDrill('drill:failure-injection');
  const script = {
    'dep007-inject-dns': [
      {
        kind: 'transport-failure',
        reason: 'DNS_UNRESOLVED',
        detail: 'scripted DNS failure (pre-effect, retryable)',
        classification: TRANSPORT_FAILURE_CLASSIFICATION['DNS_UNRESOLVED'],
      },
    ],
    'dep007-inject-inflight': [
      {
        kind: 'transport-failure',
        reason: 'CONNECTION_LOSS_IN_FLIGHT',
        detail: 'scripted in-flight loss (indeterminate effect)',
        classification: TRANSPORT_FAILURE_CLASSIFICATION['CONNECTION_LOSS_IN_FLIGHT'],
      },
    ],
    'dep007-inject-auth': [
      {
        kind: 'transport-failure',
        reason: 'AUTH_CREDENTIAL_REJECTED',
        detail: 'scripted credential refusal (pre-effect, NOT retryable — F6)',
        classification: TRANSPORT_FAILURE_CLASSIFICATION['AUTH_CREDENTIAL_REJECTED'],
      },
    ],
    'dep007-inject-timeout': [{ kind: 'timeout', deadlineWallMs: 15_000 }],
    'dep007-inject-unknown': [{ kind: 'UNKNOWN', cause: 'AMBIGUOUS_RESPONSE', detail: 'scripted ambiguous rail answer' }],
    'dep007-inject-tls': [
      {
        kind: 'transport-failure',
        reason: 'TLS_HANDSHAKE_FAILED',
        detail: 'scripted TLS failure (pre-effect, retryable)',
        classification: TRANSPORT_FAILURE_CLASSIFICATION['TLS_HANDSHAKE_FAILED'],
      },
      {
        kind: 'transport-failure',
        reason: 'TLS_HANDSHAKE_FAILED',
        detail: 'scripted TLS failure (pre-effect, retryable)',
        classification: TRANSPORT_FAILURE_CLASSIFICATION['TLS_HANDSHAKE_FAILED'],
      },
      {
        kind: 'transport-failure',
        reason: 'TLS_HANDSHAKE_FAILED',
        detail: 'scripted TLS failure (pre-effect, retryable)',
        classification: TRANSPORT_FAILURE_CLASSIFICATION['TLS_HANDSHAKE_FAILED'],
      },
    ],
  };
  const composition = await composeDrillStore({ prefix: 'inject', railScript: script });
  try {
    const jobsBefore = Number(
      composition.database.prepare('SELECT COUNT(*) AS total FROM durable_jobs').get().total,
    );
    const evidenceHeightBefore = composition.log.height;

    drill.scenario('pre-effect transient failure (DNS) → same-key retransmission → delivered');
    const dnsOutcome = railTransmit(composition.boundary, 'dep007-inject-dns');
    drill.equal(dnsOutcome.class, 'ACCEPTED', 'the retried transmission finally delivered (ACCEPTED)');
    const dnsCalls = composition.transport.transmitLog.filter(
      (request) => request.idempotencyKey === 'dep007-inject-dns',
    );
    drill.equal(dnsCalls.length, 2, 'the engine retransmitted exactly once after the pre-effect failure');
    drill.check(
      dnsCalls.every((request) => request.payloadHash === dnsCalls[0].payloadHash),
      'the retransmission re-sent the EXACT (key, payload, payloadHash) triple (INV-13-3)',
    );
    drill.equal(
      countEvents(composition.database, 'rail.transmit.retransmitted', RAIL_CONNECTIVITY_EVENT_OWNER),
      1,
      'the retransmission is journaled (the retry trail)',
    );

    drill.scenario('in-flight failure → NEVER retried → UNKNOWN {CONNECTION_LOSS}');
    const inFlightOutcome = railTransmit(composition.boundary, 'dep007-inject-inflight');
    drill.equal(inFlightOutcome.class, 'UNKNOWN', 'the in-flight failure maps to the UNKNOWN class (conservative)');
    drill.equal(inFlightOutcome.reasonCode, 'CONNECTION_LOSS', 'the frozen reason code is CONNECTION_LOSS');
    drill.equal(
      composition.transport.transmitLog.filter((r) => r.idempotencyKey === 'dep007-inject-inflight').length,
      1,
      'the in-flight failure was NOT retried (one port call)',
    );

    drill.scenario('credential refusal → pre-effect but NOT retryable (F6) → UNKNOWN');
    const authOutcome = railTransmit(composition.boundary, 'dep007-inject-auth');
    drill.equal(authOutcome.class, 'UNKNOWN', 'the credential refusal surfaces UNKNOWN (retrying cannot fix configuration)');
    drill.equal(
      composition.transport.transmitLog.filter((r) => r.idempotencyKey === 'dep007-inject-auth').length,
      1,
      'the credential refusal was NOT retried (one port call)',
    );

    drill.scenario('timeout → explicit UNKNOWN {TIMEOUT}, never guessed');
    const timeoutOutcome = railTransmit(composition.boundary, 'dep007-inject-timeout');
    drill.equal(timeoutOutcome.class, 'UNKNOWN', 'the timeout maps to UNKNOWN (no guessed outcome)');
    drill.equal(timeoutOutcome.reasonCode, 'TIMEOUT', 'the frozen reason code is TIMEOUT');
    drill.equal(
      composition.transport.transmitLog.filter((r) => r.idempotencyKey === 'dep007-inject-timeout').length,
      1,
      'the timeout was NOT retried (the deadline is exhausted by definition)',
    );

    drill.scenario('explicit UNKNOWN → surfaced verbatim, NEVER retried');
    const unknownOutcome = railTransmit(composition.boundary, 'dep007-inject-unknown');
    drill.equal(unknownOutcome.class, 'UNKNOWN', 'the UNKNOWN result surfaces as the UNKNOWN class');
    drill.equal(unknownOutcome.reasonCode, 'AMBIGUOUS_RAIL_RESPONSE', 'the frozen reason code is AMBIGUOUS_RAIL_RESPONSE');
    drill.equal(
      composition.transport.transmitLog.filter((r) => r.idempotencyKey === 'dep007-inject-unknown').length,
      1,
      'UNKNOWN was never retransmitted (the port saw exactly one call — the DEP-005 contract)',
    );
    drill.equal(
      countEvents(composition.database, 'rail.transmit.unknown-surfaced', RAIL_CONNECTIVITY_EVENT_OWNER),
      1,
      'the UNKNOWN surfacing is journaled (A14 reconciliation owns resolution)',
    );

    drill.scenario('bounded retry exhaustion (TLS x3) → UNKNOWN {CONNECTION_LOSS}');
    const tlsOutcome = railTransmit(composition.boundary, 'dep007-inject-tls');
    drill.equal(tlsOutcome.class, 'UNKNOWN', 'the exhausted retries surface UNKNOWN');
    drill.equal(
      composition.transport.transmitLog.filter((r) => r.idempotencyKey === 'dep007-inject-tls').length,
      3,
      'the engine made exactly maxAttempts=3 attempts (bounded)',
    );

    drill.scenario('telemetry reflects the injections in the right domains; health is actionable; NO authoritative mutation');
    const snapshot = collectTelemetrySnapshot(composition.database, {
      isCommandJobKind: (kind) => !kind.startsWith('operations.') && !kind.startsWith('dep007.'),
    });
    drill.equal(snapshot.domains.unknown.railUnknownSurfacedInWindow, 1, 'the unknown domain counted the UNKNOWN surfacing');
    drill.equal(snapshot.domains.unknown.railTimeoutInWindow, 1, 'the unknown domain counted the timeout');
    drill.equal(
      snapshot.domains.unknown.railTransportFailureInWindow,
      6,
      'the unknown domain counted every transport failure (DNS 1 + in-flight 1 + auth 1 + TLS 3)',
    );
    drill.equal(snapshot.domains.unknown.railRetransmittedInWindow, 3, 'the retry trail: DNS 1 + TLS 2 retransmissions');
    drill.equal(snapshot.domains.unknown.totalInWindow, 8, 'the unknown-domain total (surfaced + timeouts + failures)');
    // No authoritative state was mutated by any injected failure.
    const jobsAfter = Number(
      composition.database.prepare('SELECT COUNT(*) AS total FROM durable_jobs').get().total,
    );
    drill.equal(jobsAfter, jobsBefore, 'the durable_jobs table is untouched (no queue mutation)');
    drill.equal(
      composition.log.height,
      evidenceHeightBefore,
      'the A15 evidence log height is untouched (no evidence records from transmissions)',
    );
    // The health model: the unknown domain is degraded with an actionable action.
    const health = deriveComponentHealth(snapshot);
    drill.equal(health.domains.unknown.state, 'degraded', 'the unknown domain reports degraded (8 events < the down bound 10)');
    drill.check(
      health.domains.unknown.action !== undefined && health.domains.unknown.action.drill === 'drill:failure-injection',
      'the degraded unknown domain carries its action descriptor (the failure-injection drill)',
    );
    drill.check(
      /reconciliation/i.test(health.domains.unknown.action.whatToInspect),
      'the action routes to the A14 reconciliation path (never a blind retry)',
    );
    drill.equal(health.domains.reconciliation.state, 'unknown-data', 'the reconciliation domain is unknown-data on this store (no sweep ever ran)');
    drill.equal(health.overall, 'unknown-data', 'the composite is unknown-data (worst-of: the underivable domains outrank the degraded ones)');
    // No credential VALUES anywhere in the activity records.
    const serialized = JSON.stringify(composition.activity.all());
    drill.check(
      !/secret-ref:|PAYSWAP_RAIL_[A-Z]+_[A-Z0-9_]+_CREDENTIAL_REF\s*=|ghp_|sk-|AKIA|BEGIN [A-Z ]*PRIVATE KEY/i.test(
        serialized,
      ),
      'no credential values appear in the activity records (S1-S5)',
    );
    drill.note(
      `injected:6-cases:port-calls=${composition.transport.transmitLog.length}:unknown-events=${snapshot.domains.unknown.totalInWindow}`,
    );
    return drill.finish();
  } finally {
    await composition.close();
  }
}

// ---------------------------------------------------------------------------
// 5. [drill:evidence-integrity]
// ---------------------------------------------------------------------------

async function drillEvidenceIntegrity() {
  const drill = makeDrill('drill:evidence-integrity');
  const composition = await composeDrillStore({ prefix: 'tamper' });
  try {
    // A populated store + a verified backup + a restored copy.
    composition.runtime.enqueue('dep007.drill.effect', { key: 'tamper-1' }, { idempotencyKey: 'tamper-1' });
    composition.runtime.enqueue('dep007.drill.effect', { key: 'tamper-2' }, { idempotencyKey: 'tamper-2' });
    await composition.drain();
    await enqueueOperationalJob(composition.jobSubstrate, RECONCILIATION_SWEEP_JOB_KIND, {
      cycle: 3,
      windowStartWallMs: 3_000,
      windowEndWallMs: 4_000,
    });
    await composition.drain();
    const entry = createBackup({
      database: composition.database,
      backupPath: composition.backupPaths.backup,
      manifestPath: composition.backupPaths.manifest,
      audit: recoveryAuditFromDatabase(composition.database),
    });
    const restore = restoreBackup({
      backupPath: composition.backupPaths.backup,
      targetPath: composition.backupPaths.target,
      manifestPath: composition.backupPaths.manifest,
      audit: recoveryAuditFromDatabase(composition.database),
    });
    drill.equal(restore.verification.evidenceIntegrity.ok, true, 'the untampered restore verifies');

    drill.scenario('tamper one event payload → the verifier FAILS CLOSED naming the row');
    const tamperedId = entry.evidence[Math.floor(entry.evidence.length / 2)].eventId;
    restore.database
      .prepare('UPDATE durable_events SET data = ? WHERE id = ?')
      .run('{"tampered":"yes"}', tamperedId);
    const tampered = verifyEvidenceIntegrity(restore.database, entry);
    drill.equal(tampered.ok, false, 'the verifier fails closed on the tampered copy');
    drill.equal(tampered.mismatches.length, 1, 'exactly one mismatch is reported');
    drill.equal(tampered.mismatches[0].eventId, tamperedId, `the tampered row is IDENTIFIED by eventId (${tamperedId})`);
    drill.check(
      tampered.mismatches[0].expectedDigest !== tampered.mismatches[0].actualDigest,
      'the mismatch carries the expected vs actual digests',
    );
    drill.note(`tamper:detected:row=${tamperedId}`);

    drill.scenario('a restore from a tampered artifact is refused (both fail-closed gates)');
    // Gate 1: an artifact at a path the manifest row does not name.
    const fakeArtifact = join(composition.dir, 'tampered-artifact.sqlite');
    copyFileSync(composition.backupPaths.backup, fakeArtifact);
    const { DatabaseSync } = await import('node:sqlite');
    const tamperer = new DatabaseSync(fakeArtifact);
    tamperer
      .prepare('UPDATE durable_events SET data = ? WHERE id = ?')
      .run('{"tampered":"artifact"}', tamperedId);
    tamperer.close();
    let refusedPath = false;
    try {
      restoreBackup({
        backupPath: fakeArtifact,
        targetPath: join(composition.dir, 'target-from-copy.sqlite'),
        manifestPath: composition.backupPaths.manifest,
      });
    } catch (error) {
      refusedPath = /is not the manifest row's backup path/.test(error.message);
    }
    drill.check(refusedPath, 'an artifact outside its manifest row is refused (the manifest names its artifact)');
    // Gate 2: the ORIGINAL artifact path, tampered in place — the manifest
    // sha256 receipt no longer matches the artifact bytes.
    const inPlaceTamperer = new DatabaseSync(composition.backupPaths.backup);
    inPlaceTamperer
      .prepare('UPDATE durable_events SET data = ? WHERE id = ?')
      .run('{"tampered":"artifact"}', tamperedId);
    inPlaceTamperer.close();
    let refusedSha = false;
    try {
      restoreBackup({
        backupPath: composition.backupPaths.backup,
        targetPath: join(composition.dir, 'target-from-tampered.sqlite'),
        manifestPath: composition.backupPaths.manifest,
      });
    } catch (error) {
      refusedSha = /sha256 does not match/.test(error.message);
    }
    drill.check(refusedSha, 'the restore refuses a tampered artifact (the manifest sha256 receipt is authoritative)');

    drill.scenario('a recorded tamper detection drives incident-recovery DOWN and the composite DOWN (worst-of)');
    recordEvent(
      composition.database,
      RECOVERY_EVENT_TYPES.tamperDetected,
      { tamperedRowEventId: tamperedId, backupId: entry.backupId },
      RECOVERY_EVENT_OWNER,
      null,
    );
    const snapshot = collectTelemetrySnapshot(composition.database, {
      backupManifest: manifestSummary(readBackupManifest(composition.backupPaths.manifest)),
      isCommandJobKind: (kind) => !kind.startsWith('operations.') && !kind.startsWith('dep007.'),
    });
    const health = deriveComponentHealth(snapshot);
    drill.equal(health.domains['incident-recovery'].state, 'down', 'the incident-recovery domain is DOWN');
    drill.check(
      health.domains['incident-recovery'].action !== undefined &&
        /QUARANTINE/i.test(health.domains['incident-recovery'].action.whatToInspect),
      'the down action orders the quarantine + restore-from-last-verified runbook',
    );
    drill.equal(health.overall, 'down', 'the COMPOSITE is DOWN (worst-of: one down domain suffices)');
    drill.deepEqual(health.worstDomains, ['incident-recovery'], 'the worst domain is named (the anti-masking witness)');
    // Worst-of never masks: an ok domain elsewhere cannot soften it.
    drill.equal(health.domains.execution.state, 'ok', 'another domain can be ok at the same time');
    drill.equal(health.overall, 'down', '…and the composite still reports DOWN (ok never masks down)');
    restore.database.close();
    return drill.finish();
  } finally {
    await composition.close();
  }
}

// ---------------------------------------------------------------------------
// 6. [drill:telemetry-taxonomy]
// ---------------------------------------------------------------------------

async function drillTelemetryTaxonomy() {
  const drill = makeDrill('drill:telemetry-taxonomy');
  const composition = await composeDrillStore({
    prefix: 'taxonomy',
    railScript: {
      'dep007-tax-rail-unknown': [{ kind: 'UNKNOWN', cause: 'AMBIGUOUS_RESPONSE', detail: 'scripted ambiguous answer' }],
    },
  });
  try {
    drill.scenario('taxonomy closure: nine domains, each with definition/signals/query');
    for (const domain of OBSERVABILITY_DOMAINS) {
      const definition = DOMAIN_DEFINITIONS[domain];
      drill.check(definition.definition.length > 20, `${domain} carries a definition`);
      drill.check(definition.owningSignals.length >= 1, `${domain} names its owning substrate signals`);
      drill.check(definition.query.length > 20, `${domain} documents its deriving query`);
    }

    drill.scenario('the fresh-store snapshot: derivable domains idle, underivable domains unknown-data');
    const freshSnapshot = collectTelemetrySnapshot(composition.database, {
      isCommandJobKind: (kind) => !kind.startsWith('operations.') && !kind.startsWith('dep007.'),
    });
    const freshHealth = deriveComponentHealth(freshSnapshot);
    drill.equal(freshHealth.domains.reconciliation.state, 'unknown-data', 'no sweep has run: reconciliation is unknown-data');
    drill.equal(freshHealth.domains['clearing-netting'].state, 'unknown-data', 'no progression has run: clearing-netting is unknown-data');
    drill.equal(freshHealth.domains['incident-recovery'].state, 'degraded', 'no backup on record: incident-recovery is degraded');
    drill.equal(freshHealth.overall, 'unknown-data', 'the fresh composite is unknown-data (fail-closed: cannot see)');
    drill.check(
      freshHealth.domains.reconciliation.action !== undefined,
      'the unknown-data reconciliation domain still carries its required action',
    );

    drill.scenario('the populated store: ALL NINE domains derive non-trivial state');
    // Populate exactly as the backup drill does (statuses + owners + rail).
    for (const key of ['tax-1', 'tax-2']) {
      composition.runtime.enqueue('dep007.drill.effect', { key }, { idempotencyKey: key });
    }
    composition.runtime.register('dep007.drill.poison', async (job) => {
      recordEvent(
        composition.database,
        'dep007.drill.poison-touched',
        { effectKey: job.idempotencyKey, jobId: job.id },
        DRILL_EVENT_OWNER,
        job.id,
      );
      throw new Error('dep007 poison handler');
    });
    composition.runtime.enqueue('dep007.drill.poison', {}, { idempotencyKey: 'tax-poison', maxAttempts: 1 });
    composition.runtime.enqueue('dep007.drill.effect', { key: 'tax-zombie' }, { idempotencyKey: 'tax-zombie' });
    composition.runtime.queue.reserve('dep007-tax-zombie', 60_000, { kind: 'dep007.drill.effect' });
    composition.runtime.enqueue('dep007.drill.effect', { key: 'tax-queued' }, { idempotencyKey: 'tax-queued' });
    await enqueueOperationalJob(composition.jobSubstrate, RECONCILIATION_SWEEP_JOB_KIND, {
      cycle: 5,
      windowStartWallMs: 5_000,
      windowEndWallMs: 6_000,
    });
    await enqueueOperationalJob(composition.jobSubstrate, CLEARING_PROGRESSION_JOB_KIND, {
      cycle: 5,
      windowStartWallMs: 5_000,
      windowEndWallMs: 6_000,
    });
    await enqueueOperationalJob(composition.jobSubstrate, NETTING_SETTLEMENT_PROGRESSION_JOB_KIND, {
      cycle: 5,
      windowStartWallMs: 5_000,
      windowEndWallMs: 6_000,
    });
    await composition.drain();
    railTransmit(composition.boundary, 'dep007-tax-rail-1');
    railTransmit(composition.boundary, 'dep007-tax-rail-unknown');
    createBackup({
      database: composition.database,
      backupPath: composition.backupPaths.backup,
      manifestPath: composition.backupPaths.manifest,
      audit: recoveryAuditFromDatabase(composition.database),
    });
    const manifest = manifestSummary(readBackupManifest(composition.backupPaths.manifest));
    const snapshot = collectTelemetrySnapshot(composition.database, {
      backupManifest: manifest,
      isCommandJobKind: (kind) => !kind.startsWith('operations.') && !kind.startsWith('dep007.'),
    });
    const d = snapshot.domains;
    // command
    drill.check(d.command.submissionsInWindow >= 3, `command: submissions derived (${d.command.submissionsInWindow})`);
    drill.check(d.command.commandJobsQueued >= 3, `command: queued command jobs derived (${d.command.commandJobsQueued})`);
    drill.check(d.command.createdInWindow >= 3, 'command: first admissions derived');
    // queue
    drill.check(d.queue.totalJobs >= 8, `queue: total jobs derived (${d.queue.totalJobs})`);
    drill.equal(d.queue.deadLetterCount, 1, 'queue: the dead-letter count derived');
    drill.check(d.queue.reservedCount === 1, 'queue: the reserved (zombie) count derived');
    drill.check(d.queue.attemptHistogram.length >= 1, 'queue: the attempt histogram derived');
    drill.check(d.queue.oldestQueuedAgeMs !== null, 'queue: the oldest queued age derived');
    // execution
    drill.check(d.execution.succeededInWindow >= 5, `execution: successes in window (${d.execution.succeededInWindow})`);
    drill.check(d.execution.meanAttemptsOfSucceeded !== null, 'execution: the mean attempt cost derived');
    // unknown
    drill.equal(d.unknown.railUnknownSurfacedInWindow, 1, 'unknown: the rail UNKNOWN surfacing derived');
    drill.equal(d.unknown.unknownHeldInWindow, 1, 'unknown: the UNKNOWN-held discipline surface derived');
    // reconciliation
    drill.check(d.reconciliation.lastSweepCompletedAt !== null, 'reconciliation: the sweep freshness derived');
    drill.check(d.reconciliation.sweepFreshnessMs !== null, 'reconciliation: freshness age derived');
    drill.equal(d.reconciliation.investigateSubmissionsInWindow, 1, 'reconciliation: the A14 engagement derived');
    drill.check((d.reconciliation.sweepRunsTotal ?? 0) >= 1, 'reconciliation: the progress reader derived the run set');
    // clearing-netting
    drill.check(d['clearing-netting'].lastClearingRunAt !== null, 'clearing-netting: the clearing freshness derived');
    drill.equal(d['clearing-netting'].clearingCommandsInWindow, 1, 'clearing-netting: the clearing emissions derived');
    drill.equal(d['clearing-netting'].nettingCommandsInWindow, 0, 'clearing-netting: the netting emissions derived (the fixture has no cohort)');
    // settlement-finality
    drill.check(d['settlement-finality'].settlementCommandsInWindow >= 1, 'settlement-finality: the settlement emissions derived');
    drill.check(d['settlement-finality'].settlementJobsQueued >= 1, 'settlement-finality: the queued settlement commands derived');
    drill.equal(d['settlement-finality'].unknownHeldInWindow, 1, 'settlement-finality: the UNKNOWN-held signal derived');
    // incident-recovery
    drill.check(d['incident-recovery'].backupsInWindow >= 1, 'incident-recovery: the backup coverage derived');
    drill.check(d['incident-recovery'].lastBackupAt !== null, 'incident-recovery: the backup recency derived');
    drill.equal(d['incident-recovery'].manifestBackupsTotal, 1, 'incident-recovery: the manifest trail derived');
    // deployment
    drill.equal(d.deployment.environment, 'sandbox', 'deployment: the frozen environment signal derived (fail-safe sandbox)');
    drill.equal(d.deployment.journalMode, 'wal', 'deployment: the WAL crash-safety mode derived');
    drill.check(d.deployment.migrationsApplied >= 1, 'deployment: the applied migration set derived');
    drill.check(d.deployment.lastBackupAgeMs !== null, 'deployment: the backup hygiene derived');
    drill.note(`nine-domains:events-scanned=${snapshot.eventRowsScanned}`);

    drill.scenario('health model: every non-ok domain is actionable; the worst-of rollup never masks');
    const health = deriveComponentHealth(snapshot);
    for (const domain of OBSERVABILITY_DOMAINS) {
      const domainHealth = health.domains[domain];
      if (domainHealth.state !== 'ok') {
        drill.check(
          domainHealth.action !== undefined && domainHealth.action.whatToInspect.length > 10,
          `${domain} (${domainHealth.state}) carries its required action descriptor`,
        );
        drill.check(
          domainHealth.action.drill.startsWith('drill:'),
          `${domain}'s action names its drill (${domainHealth.action.drill})`,
        );
        drill.check(
          domainHealth.action.runbookSection.includes('.md §'),
          `${domain}'s action names its runbook section (${domainHealth.action.runbookSection})`,
        );
      }
    }
    // Severity ordering unit proofs.
    drill.equal(worstOf('ok', 'down'), 'down', 'severity: down beats ok');
    drill.equal(worstOf('down', 'ok'), 'down', 'severity: down beats ok (commutative)');
    drill.equal(worstOf('degraded', 'unknown-data'), 'unknown-data', 'severity: unknown-data beats degraded (fail-closed)');
    drill.equal(worstOf('ok', 'ok'), 'ok', 'severity: ok is neutral');
    drill.equal(HEALTH_SEVERITY.down, 3, 'severity: the ordering is numeric and total');
    // The composite is the max across domains (never masks).
    const maxSeverity = Math.max(
      ...OBSERVABILITY_DOMAINS.map((domain) => HEALTH_SEVERITY[health.domains[domain].state]),
    );
    drill.equal(
      HEALTH_SEVERITY[health.overall],
      maxSeverity,
      'the composite equals the worst domain severity (worst-of, never masking)',
    );
    drill.equal(health.overall, 'degraded', 'the populated composite is degraded (the queue dead letter + the UNKNOWN-held signals)');
    drill.check(health.worstDomains.length >= 1, 'the worst domains are named');

    drill.scenario('the readiness probe (the /api/ready additive enrichment derivation)');
    const probe = probeComponentHealth({
      database: composition.database,
      telemetry: {
        backupManifest: manifest,
        isCommandJobKind: (kind) => !kind.startsWith('operations.') && !kind.startsWith('dep007.'),
      },
    });
    drill.equal(probe.overall, 'degraded', 'the probe mirrors the composite state');
    drill.check(['ready', 'health-unknown', 'unhealthy'].includes(probe.readiness), 'the probe projects the readiness mapping');
    drill.equal(probe.readiness, 'ready', 'a degraded composite still serves (the F6 checks stay the readiness authority)');
    drill.equal(probe.domains.queue.state, 'degraded', 'the probe carries the per-domain states');

    drill.scenario('the logging scrubber: credential-reference NAMES are sensitive (fail-closed)');
    const scrubbed = scrubCredentialReferences({
      rail: 'demobank',
      credentialRef: 'secret-ref:prod-bank-a-1',
      PAYSWAP_RAIL_PRODUCTION_BANK_A_CREDENTIAL_REF: 'anything',
      nested: [
        // A NON-sensitive key carrying a reference-shaped VALUE (the
        // value-redaction path) and a benign sibling (the pass-through).
        { holder: 'secret-ref:prod-bank-a-1', note: 'plain' },
      ],
    });
    const serializedScrub = JSON.stringify(scrubbed);
    drill.check(!serializedScrub.includes('secret-ref:prod-bank-a-1'), 'the scrubber redacts reference-shaped values');
    drill.check(
      serializedScrub.includes('"holder":"[REDACTED:credential-reference]"'),
      'the scrubber redacts the reference VALUE under a non-sensitive key',
    );
    drill.check(serializedScrub.includes('[REDACTED:credential-reference]'), 'the value redaction carries the named marker');
    drill.check(serializedScrub.includes('[REDACTED:sensitive-key]'), 'the scrubber redacts sensitive KEY NAMES entirely');
    drill.check(serializedScrub.includes('"note":"plain"'), 'the scrubber leaves non-sensitive fields intact');
    const logger = createObservabilityLogger({ ringCapacity: 10, now: () => 1_234 });
    logger.log('warn', 'dep007.drill.log', { credentialRef: 'secret-ref:x', level: 42 }, { traceId: 'trace-1' });
    const records = logger.query({ traceId: 'trace-1' });
    drill.equal(records.length, 1, 'the ring buffer is queryable by trace id');
    drill.equal(records[0].level, 'warn', 'the level is preserved');
    drill.check(
      JSON.stringify(records[0].data).includes('[REDACTED:sensitive-key]'),
      'the emitted record is scrubbed (the payload never carries the reference name)',
    );

    drill.scenario('the trace() helper: command → queue → execution → effects over recorded ids');
    const sweepJobs = composition.database
      .prepare('SELECT id FROM durable_jobs WHERE kind = ?')
      .all(RECONCILIATION_SWEEP_JOB_KIND);
    const sweepJobId = sweepJobs[0].id;
    const document = trace(composition.database, { jobId: sweepJobId });
    drill.check(document.jobs.some((job) => job.jobId === sweepJobId), 'the trace anchors the duty job');
    drill.check(
      document.jobs.some((job) => job.kind === 'reconciliation.case.investigate'),
      'the trace reaches the COMMAND job the sweep admitted (command → queue)',
    );
    drill.check(
      document.links.some((link) => link.relation === 'submission→command-job'),
      'the trace records the submission→command-job link',
    );
    drill.check(
      document.events.some((event) => event.type === 'operations.command.submitted'),
      'the trace includes the command submission event',
    );
    drill.check(
      document.events.some((event) => event.type === 'job_succeeded'),
      'the trace includes the duty job lifecycle (effects)',
    );
    const rendered = renderTrace(document);
    drill.check(rendered.includes(sweepJobId), 'the rendered trace names the anchored job');
    const keyTrace = trace(composition.database, { idempotencyKey: 'tax-1' });
    drill.check(
      keyTrace.jobs.some((job) => job.idempotencyKey === 'tax-1'),
      'the trace anchors by idempotency key (the receipt identity)',
    );
    drill.note(`trace:jobs=${document.jobs.length}:events=${document.events.length}:links=${document.links.length}`);
    return drill.finish();
  } finally {
    await composition.close();
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

let failure = null;
try {
  await drillFamilyBarrels();
  await drillBackupRestore();
  await drillWorkerRestart();
  await drillReplayRecovery();
  await drillFailureInjection();
  await drillEvidenceIntegrity();
  await drillTelemetryTaxonomy();
} catch (error) {
  failure = error;
  console.error('DEP-007 observability/resilience/DR harness: FAILED.');
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

// The final drill report table (the exact numbers for the completion report).
console.log('\nDEP-007 drill report');
console.log('='.repeat(78));
const header = ['drill', 'scenarios', 'assertions', 'result'];
console.log(header.map((cell) => String(cell).padEnd(30)).join(''));
console.log('-'.repeat(78));
for (const result of drillResults) {
  const row = [
    result.name,
    String(result.scenarios),
    String(result.assertions),
    failure === null ? 'PASS' : 'RUN-INCOMPLETE',
  ];
  console.log(row.map((cell) => String(cell).padEnd(30)).join(''));
}
console.log('-'.repeat(78));
console.log(
  ['TOTAL', String(drillResults.reduce((sum, r) => sum + r.scenarios, 0)), String(liveAssertions), failure === null ? 'PASS' : 'FAIL']
    .map((cell) => String(cell).padEnd(30))
    .join(''),
);
for (const result of drillResults) {
  console.log(`\n${result.name}:`);
  for (const note of result.notes) {
    console.log(`  ${note}`);
  }
}
if (failure !== null) {
  process.exit(1);
}
console.log('\nDEP-007 observability/resilience/DR harness: all drill groups green.');
