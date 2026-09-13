#!/usr/bin/env node
/**
 * payswap3 · DEP-008 — The production readiness proof harness.
 *
 * Plain-Node evidence suite for DEP-008's acceptance ("On one exact release
 * revision prove production-like protocol integration, UI integration,
 * failure injection, scaling behavior, configuration/secret safety,
 * backup/restore, queue recovery, UNKNOWN reconciliation, external-effect
 * safety, rollback and observability"), composed — never forked — over the
 * merged machinery:
 *
 *   - the DEP-006 promotion tool (scripts/promote.mjs — invoked as a black
 *     box: `record` refusal semantics, `migrate` on a throwaway worktree
 *     copy, `rollback-plan` emission) and the gate runner contract
 *     (scripts/run_ci_gates.mjs);
 *   - the DEP-007 drill machinery (src/lib/recovery/ + src/lib/observability/
 *     + the rail-connectivity boundary's test surface), WRAPPED: this
 *     harness re-runs scripts/test_observability_resilience.mjs,
 *     scripts/test_protocol_composed_journey.mjs, scripts/test_operations.mjs
 *     and scripts/test_rail_connectivity.mjs as child processes and asserts
 *     their green exit + their composed markers (extend-or-wrap, never fork);
 *   - the RTN-012 composed journey surfaces (the gateway admission →
 *     transition runtime → authoritative state chain) re-driven in a fresh
 *     minimal composition for the admission-refusal and poisoning proofs;
 *   - the UI-011 re-anchoring contract (the runtime adapters, the retired
 *     mock shims, the splice guard, the F6 routes).
 *
 * PROOF GROUPS (each named, counted, fail-closed; the run FAILS CLOSED if
 * any group fails or any stop condition fires):
 *
 *   1. [proof:release-identity]            the frozen release revision: the
 *                                         last promotion-record in
 *                                         deploy/promotions/promotion-records.jsonl
 *                                         (append-only records trail the
 *                                         revision they freeze — ci-cd.md §3);
 *                                         its commit SHA + tree digest
 *                                         re-derived in a temp git worktree,
 *                                         the content digest recomputed with
 *                                         the promotion tool's exact
 *                                         algorithm and compared; the
 *                                         recorded gate table all-green; the
 *                                         migration gate re-run on a
 *                                         throwaway copy via `promote.mjs
 *                                         migrate` inside a temp worktree at
 *                                         HEAD (the append lands in the
 *                                         throwaway; the repository records
 *                                         file stays byte-identical).
 *   2. [proof:protocol-integration]       production-like protocol
 *                                         integration: the wrapped composed
 *                                         journey (golden path to finality,
 *                                         the UNKNOWN paths, duplicate/
 *                                         restart safety, chain verification)
 *                                         + a fresh gateway composition:
 *                                         admission, recorded-receipt replay,
 *                                         the typed refusal matrix (body
 *                                         validation, unknown kind, envelope,
 *                                         subject binding, authority), and
 *                                         command-path poisoning attempts
 *                                         NEVER admitted, NEVER executed.
 *   3. [proof:ui-integration]             the UI-011 re-anchoring: the seven
 *                                         runtime adapters + port seams +
 *                                         the one composition root, the
 *                                         retired mock shims, the splice
 *                                         guard (src/app + src/components
 *                                         never import protocol-runtime),
 *                                         the shell at / and the F6
 *                                         liveness/readiness routes, the
 *                                         standalone build output when
 *                                         present (mode declared honestly).
 *   4. [proof:failure-injection]          the wrapped DEP-007 drill battery
 *                                         + production-like cases: an
 *                                         adapter timeout storm (N=25),
 *                                         bounded retry exhaustion, duplicate
 *                                         external submissions (idempotency
 *                                         keys hold at three layers), UNKNOWN
 *                                         never retried nor translated, and
 *                                         no injected failure mutates
 *                                         authoritative state.
 *   5. [proof:scaling-behavior]           bounded SUBSTRATE-level scaling
 *                                         evidence IN-SANDBOX: a 500-job
 *                                         burst across 25 kinds (no lost or
 *                                         duplicated jobs; FIFO discipline;
 *                                         exactly-once effects), worker
 *                                         concurrency invariants (leases held
 *                                         exclusively; no double execution
 *                                         under two-worker contention), and
 *                                         the bounded-refusal surfaces (drain
 *                                         pass bound, retry deadline cutoff,
 *                                         concurrency bound, attempt bound).
 *                                         This is NOT a claim about
 *                                         production horizontal scaling.
 *   6. [proof:config-secret-safety]       fail-closed configuration
 *                                         resolution (missing required
 *                                         production names ⇒ NOT ready), the
 *                                         F1 runtime allowlist agreement,
 *                                         credential REFERENCES only, the
 *                                         S1-style secret scan over the
 *                                         whole release tree, and the
 *                                         environment-crossing refusal
 *                                         (sandbox config can never satisfy
 *                                         production gates; the promotion
 *                                         tool refuses a production context).
 *   7. [proof:backup-restore-queue-recovery]  the DEP-007 drill machinery
 *                                         composed fresh: populate (all
 *                                         reachable job statuses incl. a
 *                                         dead letter and a reserved zombie)
 *                                         → verified backup → destroy →
 *                                         restore → evidence-integrity
 *                                         verification → queue replay →
 *                                         exactly-once completion → the
 *                                         worker-restart path (lease expiry
 *                                         → reclaim → re-execution with the
 *                                         recorded-receipt guard).
 *   8. [proof:unknown-reconciliation]     UNKNOWN outcomes surfaced (never
 *                                         silently retried, never
 *                                         translated), held for the A14
 *                                         reconciliation path, and resolved
 *                                         to terminal states with evidence
 *                                         (the wrapped composed-journey
 *                                         UNKNOWN paths + the operations
 *                                         reconciliation drill); zero
 *                                         unreconciled UNKNOWN at proof end
 *                                         (a STOP condition).
 *   9. [proof:external-effect-safety]     the rail boundary refuses unsafe
 *                                         retries (UNKNOWN/timeout never
 *                                         retransmitted; retryable
 *                                         pre-effect failures re-driven with
 *                                         the SAME rail idempotency keys),
 *                                         duplicate submissions dedupe by
 *                                         idempotency key, post-effect
 *                                         failures route to recourse
 *                                         (listed, not executed), and the
 *                                         rollback-plan emission honors
 *                                         R1–R5 (finality never reversed).
 *  10. [proof:rollback-observability]     the rollback plan for the release
 *                                         record references the recorded
 *                                         immutable revision (and the
 *                                         previous record as the R1 target),
 *                                         and the observability stack
 *                                         reports the full proof run
 *                                         (telemetry snapshots before/after
 *                                         the injected degradation, the
 *                                         worst-of health rollup, the drill
 *                                         log as the verification
 *                                         transcript).
 *
 * STOP-CONDITION DISCIPLINE (hard): the work order's six stop conditions —
 * unsafe external retry, environment crossing, missing recovery path,
 * unreconciled UNKNOWN, configuration ambiguity, unexplained authority
 * bypass — are CHECKED by real assertions in their owning groups. Any
 * triggered (or unverifiable, because its group failed) condition fails the
 * run closed. A failed-but-honest proof is a valid deliverable state; a
 * green-but-fudged one is a governance violation.
 *
 * OUTPUT CONTRACT (and why timing lives on stderr):
 *
 *   - STDOUT is byte-deterministic across runs at the same tree (the
 *     ci-cd.md §2 battery determinism contract — this harness is glob-
 *     enumerated into the `harnesses` gate, whose per-harness stdout
 *     digests `promote.mjs verify` compares byte-for-byte). It carries the
 *     machine-parseable JSONL transcript (one record per proof scenario)
 *     plus the human summary tables. NO wall-clock values, temp paths,
 *     random ids or memory figures ever reach stdout.
 *   - STDERR carries the human progress AND the timing-augmented JSONL
 *     records ({"type":"proof-timing",...} per group) — machine-parseable,
 *     captured in deploy/promotions/DEP-008-READINESS-TRANSCRIPT.md:
 *
 *       node scripts/test_production_readiness.mjs \
 *         >transcript.jsonl 2>timing-and-progress.jsonl
 *
 *     (The dispatch guidance asked for timing inside the stdout JSONL; the
 *     repository's own determinism contract wins over the guidance — this
 *     is the disclosed resolution.)
 *
 * Node-version note: requires Node.js >= 22.6 (node:sqlite + type
 * stripping); the harness self-configures the experimental flags on Node
 * builds that need them (same bootstrap as the merged harnesses).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const RECORDS_FILE = join(ROOT, 'deploy', 'promotions', 'promotion-records.jsonl');
const RECORDS_REL = 'deploy/promotions/promotion-records.jsonl';
const COMPONENTS_JSON = join(ROOT, 'deploy', 'contracts', 'components.json');
const MIGRATIONS_DIR = join(ROOT, 'deploy', 'migrations');
const PROTOCOL_DIR = join(ROOT, 'src', 'lib', 'protocol');
const APP_DIR = join(ROOT, 'src', 'app');
const COMPONENTS_UI_DIR = join(ROOT, 'src', 'components');

const DURABLE_URL = (name) => pathToFileURL(join(ROOT, 'src', 'lib', 'durable', name)).href;
const MODULE_URL = (family, name) => pathToFileURL(join(ROOT, 'src', 'lib', family, name)).href;

const HARNESS_NAME = 'scripts/test_production_readiness.mjs';
const RESPAWN_ENV = 'PAYSWAP_DEP008_TEST_RESPAWNED';

// The proof clock for the rail boundary composition (fixed — the retry
// engine is a synchronous loop over the injected clock; deadlines are
// absolute epoch ms).
const RAIL_NOW = 10_000;

const tempDirs = [];
function tempDir(prefix) {
  const parent = mkdtempSync(join(tmpdir(), `payswap-dep008-${prefix}-`));
  tempDirs.push(parent);
  return parent;
}
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

// ---------------------------------------------------------------------------
// Capability bootstrap (mirrors the merged harnesses): node:sqlite + .ts
// type-stripping, re-exec self with the required experimental flags.
// ---------------------------------------------------------------------------
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
  process.exit(typeof child.status === 'number' ? child.status : 1);
}

await ensureCapabilities();

// -- module loading (the frozen substrate + the composed families) --------

const { openDurableDatabase } = await import(DURABLE_URL('db.ts'));
const { recordEvent } = await import(DURABLE_URL('events.ts'));
const { DurableQueue } = await import(DURABLE_URL('queue.ts'));
const { DurableWorker } = await import(DURABLE_URL('worker.ts'));
const { createEvidenceLog } = await import(MODULE_URL('protocol-runtime', 'evidence/log.ts'));
const {
  ProtocolGateway,
  commandQueuePortFromDurableQueue,
} = await import(MODULE_URL('protocol-runtime', 'gateway/admission.ts'));
const { money } = await import(MODULE_URL('protocol-runtime', 'kernel/money.ts'));
const { hashRailPayload } = await import(MODULE_URL('protocol-runtime', 'rails/payload.ts'));
const railConnectivity = await import(MODULE_URL('rail-connectivity', 'index.ts'));
const {
  resolveRailConnectivityConfig,
  createConnectivityBoundary,
  createAdapterActivityLog,
  RAIL_CONNECTIVITY_EVENT_OWNER,
  IN_PROCESS_SIMULATED_HOST_MARKER,
  TRANSPORT_FAILURE_CLASSIFICATION,
  transmitWithTransportSafeguards,
  transportBackoffDelayMs,
  decideTransportRetry,
  mapTransportResultToFrozenOutcome,
} = railConnectivity;
const recovery = await import(MODULE_URL('recovery', 'index.ts'));
const {
  createBackup,
  readBackupManifest,
  restoreBackup,
  bindDurableRuntime,
  drainUntilSettled,
  replayRestoredQueue,
  recoveryAuditFromDatabase,
} = recovery;
const observability = await import(MODULE_URL('observability', 'index.ts'));
const {
  OBSERVABILITY_DOMAINS,
  collectTelemetrySnapshot,
  deriveComponentHealth,
  HEALTH_SEVERITY,
} = observability;

// ---------------------------------------------------------------------------
// The proof bookkeeping (named groups, counted scenarios/assertions, the
// stop-condition registry — the work order's alarm system).
// ---------------------------------------------------------------------------

const proofRecords = []; // stdout JSONL scenario records (deterministic)
const groupResults = []; // summary rows
const timingRecords = []; // stderr JSONL timing records
const stopConditionRegistry = new Map();
let liveAssertions = 0;
let failure = null;

const STOP_CONDITIONS = [
  'unsafe external retry',
  'environment crossing',
  'missing recovery path',
  'unreconciled UNKNOWN',
  'configuration ambiguity',
  'unexplained authority bypass',
];
for (const id of STOP_CONDITIONS) {
  stopConditionRegistry.set(id, { status: 'unverified', where: '', detail: '' });
}

/** Record a stop-condition verdict from a group's REAL assertions. */
function stopCondition(id, triggered, where, detail) {
  const entry = stopConditionRegistry.get(id);
  if (!entry) {
    throw new Error(`unknown stop condition id: ${id}`);
  }
  if (entry.status === 'triggered') {
    return; // once triggered, stays triggered (fail-closed latch)
  }
  if (entry.status === 'not-triggered' && triggered) {
    entry.status = 'triggered';
  } else {
    entry.status = triggered ? 'triggered' : 'not-triggered';
  }
  entry.where = where;
  entry.detail = detail;
}

const PROOF_GROUPS = [
  'proof:release-identity',
  'proof:protocol-integration',
  'proof:ui-integration',
  'proof:failure-injection',
  'proof:scaling-behavior',
  'proof:config-secret-safety',
  'proof:backup-restore-queue-recovery',
  'proof:unknown-reconciliation',
  'proof:external-effect-safety',
  'proof:rollback-observability',
];

function emit(object) {
  process.stdout.write(`${JSON.stringify(object)}\n`);
}

function noteStderr(line) {
  process.stderr.write(`${line}\n`);
}

/**
 * One proof group. `scenarios` are counted; `check`/`equal`/`deepEqual`
 * count assertions and throw on failure (the group runner catches, marks
 * the group FAILED and continues — the full picture is the deliverable,
 * fail-closed at the verdict).
 */
function makeProofGroup(name) {
  const notes = [];
  let scenarios = 0;
  let assertions = 0;
  const count = () => {
    assertions += 1;
    liveAssertions += 1;
    return assertions;
  };
  return {
    name,
    note: (line) => notes.push(line),
    scenario: (label) => {
      scenarios += 1;
      notes.push(`#${scenarios} ${label}`);
      return scenarios;
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
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      if (a !== b) {
        throw new Error(`[${name}] assertion #${ordinal} FAILED: ${message} (${a} !== ${b})`);
      }
    },
    notes: () => notes,
    counts: () => ({ scenarios, assertions }),
  };
}

// ---------------------------------------------------------------------------
// Git helpers (fail-closed) + the promotion tool's exact digest algorithm
// (copied verbatim from scripts/promote.mjs — the release identity must be
// re-derived the same way it was frozen).
// ---------------------------------------------------------------------------

function git(args, cwd = ROOT) {
  const child = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (child.error || typeof child.status !== 'number' || child.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${child.error ? child.error.message : child.stderr || child.stdout}`);
  }
  return child.stdout;
}

function gitOk(args, cwd = ROOT) {
  const child = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return child.status === 0 ? child.stdout : null;
}

function trackedFiles(cwd) {
  const child = spawnSync('git', ['ls-files', '-z'], { cwd, encoding: 'buffer' });
  if (child.error || child.status !== 0) {
    throw new Error(`git ls-files failed in ${cwd}`);
  }
  return child.stdout
    .toString('utf8')
    .split('\0')
    .filter((p) => p.length > 0)
    .sort();
}

function contentDigest(cwd) {
  const paths = trackedFiles(cwd);
  const combined = createHash('sha256');
  for (const rel of paths) {
    const abs = join(cwd, rel);
    if (!existsSync(abs)) {
      throw new Error(`tracked file missing on disk: ${rel} (in ${cwd})`);
    }
    const digest = createHash('sha256').update(readFileSync(abs)).digest('hex');
    combined.update(`${digest}  ${rel}\n`, 'utf8');
  }
  return { digest: combined.digest('hex'), fileCount: paths.length };
}

/**
 * A throwaway git worktree at `rev`, removed in the finally (a failed proof
 * must never leak a worktree — the promote.mjs verify precedent).
 */
function withWorktree(rev, fn) {
  const parent = tempDir('worktree');
  const path = join(parent, 'wt');
  git(['worktree', 'add', '--detach', path, rev]);
  try {
    return fn(path);
  } finally {
    const removed = gitOk(['worktree', 'remove', '--force', path]);
    if (removed === null) {
      rmSync(path, { recursive: true, force: true });
    }
  }
}

/** Child-process environment: minimal, hermetic, deterministic. */
function childEnv() {
  const env = {};
  if (typeof process.env.PATH === 'string') env.PATH = process.env.PATH;
  if (typeof process.env.HOME === 'string') env.HOME = process.env.HOME;
  env.TMPDIR = tmpdir();
  // PAYSWAP_ENV is deliberately absent: children resolve the fail-safe
  // sandbox (F1) exactly as a fresh CI runner does. PAYSWAP_DURABLE_DB is
  // absent so the migration gate's child always runs the deterministic
  // fresh-throwaway case inside ITS worktree.
  return env;
}

/**
 * The FROZEN promotion records: HEAD's committed version of the append-only
 * store. (An uncommitted append is not a frozen release identity — a temp
 * worktree at HEAD cannot reproduce it; the harness proves the committed
 * truth and notes any dirty tail. In every governed flow — CI, the battery
 * inside `promote.mjs record`, `verify` worktrees — the tree is clean and
 * the committed version IS the working file.)
 */
function readRecords() {
  const child = spawnSync('git', ['show', `HEAD:${RECORDS_REL}`], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (child.error || typeof child.status !== 'number' || child.status !== 0) {
    throw new Error(
      `git show HEAD:${RECORDS_REL} failed — the append-only record store must be tracked at HEAD ` +
        `(fail-closed): ${child.error ? child.error.message : child.stderr || child.stdout}`,
    );
  }
  const entries = [];
  for (const [index, line] of child.stdout.split('\n').entries()) {
    if (line.trim().length === 0) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      throw new Error(`${RECORDS_REL} line ${index + 1} does not parse as JSON: ${error.message}`);
    }
    if (!entry || typeof entry !== 'object' || typeof entry.type !== 'string') {
      throw new Error(`${RECORDS_REL} line ${index + 1}: entry must be an object with a "type" field`);
    }
    entries.push(entry);
  }
  return entries;
}

/** Is the working records file dirty vs HEAD (deterministic per tree)? */
function recordsWorkingTreeDirty() {
  if (!existsSync(RECORDS_FILE)) return true;
  const child = spawnSync('git', ['show', `HEAD:${RECORDS_REL}`], { cwd: ROOT, encoding: 'utf8' });
  if (child.status !== 0) return true;
  return readFileSync(RECORDS_FILE, 'utf8') !== child.stdout;
}

/**
 * The release record under proof: the LAST promotion-record in the file
 * whose revision RESOLVES in the local git history. (The DEP-006-era
 * rehearsal records R1/R2 reference commits that were rebased away when
 * their PRs merged — their SHAs do not exist on main — so the selection
 * skips rebase-orphaned records deterministically and discloses the count;
 * a record whose revision cannot be checked out is not an immutable
 * release identity.)
 */
function releaseRecord(records) {
  const promotionRecords = records.filter((entry) => entry.type === 'promotion-record');
  if (promotionRecords.length === 0) {
    throw new Error(
      `${RECORDS_REL} holds no promotion-record — the release identity is undefined; ` +
        'run `node scripts/promote.mjs record` on a committed, clean revision first (fail-closed)',
    );
  }
  let skippedOrphaned = 0;
  for (let index = promotionRecords.length - 1; index >= 0; index -= 1) {
    const candidate = promotionRecords[index];
    const sha = candidate?.revision?.commit_sha;
    const resolves =
      typeof sha === 'string' &&
      gitOk(['cat-file', '-e', `${sha}^{commit}`]) !== null;
    if (resolves) {
      return { record: candidate, index, all: promotionRecords, skippedOrphaned };
    }
    skippedOrphaned += 1;
  }
  throw new Error(
    `${RECORDS_REL} holds ${promotionRecords.length} promotion-record(s) but NONE resolves in the ` +
      'local git history (rebase-orphaned rehearsal records) — the release identity is undefined; ' +
      'record a fresh revision with `node scripts/promote.mjs record` first (fail-closed)',
  );
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const PROOF_EVENT_OWNER = 'dep008-proof';
const EFFECT_EVENT_TYPE = 'dep008.proof.effect-applied';

function receiptExists(database, effectKey) {
  const rows = database
    .prepare('SELECT data FROM durable_events WHERE type = ? AND owner = ?')
    .all(EFFECT_EVENT_TYPE, PROOF_EVENT_OWNER);
  return rows.some((row) => {
    try {
      return JSON.parse(String(row.data ?? '{}')).effectKey === effectKey;
    } catch {
      return false;
    }
  });
}

function effectReceipts(database) {
  const rows = database
    .prepare('SELECT data FROM durable_events WHERE type = ? AND owner = ?')
    .all(EFFECT_EVENT_TYPE, PROOF_EVENT_OWNER);
  const counts = new Map();
  for (const row of rows) {
    try {
      const key = JSON.parse(String(row.data ?? '{}')).effectKey;
      if (typeof key === 'string') counts.set(key, (counts.get(key) ?? 0) + 1);
    } catch {
      // ignore malformed (never expected)
    }
  }
  return counts;
}

/** The recorded-receipt guarded handler (the DEP-007 drill pattern). */
function makeEffectHandler(database, options = {}) {
  return async (job) => {
    const key = job.idempotencyKey ?? job.id;
    if (!receiptExists(database, key)) {
      recordEvent(database, EFFECT_EVENT_TYPE, { effectKey: key, kind: job.kind }, PROOF_EVENT_OWNER, job.id);
    }
    if (options.alwaysThrow) {
      throw new Error(`dep008 proof handler failure (key ${key})`);
    }
  };
}

function jobsByStatus(database, status) {
  const row = database.prepare('SELECT COUNT(*) AS total FROM durable_jobs WHERE status = ?').get(status);
  return Number(row?.total ?? 0);
}

const MONEY = money('USD', 1_000, 2);

function transmissionRequest(idempotencyKey, instructionId) {
  const payload = { instructionId, money: MONEY, beneficiary: 'bene-proof' };
  return { idempotencyKey, payload, payloadHash: hashRailPayload(payload) };
}

/**
 * The scripted transport double (the rail-connectivity boundary's test
 * surface, as driven by scripts/test_rail_connectivity.mjs): scripts map
 * idempotency key → ordered results; the receive ledger collapses same-key
 * re-submissions (INV-13-3) and refuses key reuse with a different payload.
 * The script is MUTABLE (the boundary binds the factory result ONCE at
 * construction — swapping the double has no effect; the rig re-scripts the
 * one bound double instead).
 */
function createScriptedTransportDouble(initialScript = {}) {
  let currentScript = initialScript;
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
      const scripted = currentScript[request.idempotencyKey] ?? [];
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
      const scripted = currentScript[request.idempotencyKey] ?? [];
      const statement = scripted.find((s) => s?.statementOutcomeClass !== undefined);
      return {
        outcomeClass: statement?.statementOutcomeClass ?? 'PENDING',
        railReferences: [`scripted.${request.railId}.${entry.ordinal}`],
        payloadHash: entry.payloadHash,
        reportedAtWallMs: 0,
      };
    },
    transmitLog,
    received,
    get script() {
      return currentScript;
    },
    set script(next) {
      currentScript = next ?? {};
    },
  };
}

const SANDBOX_RAIL_ENV = {
  PAYSWAP_RAIL_SANDBOX_DEMOBANK_HOST: IN_PROCESS_SIMULATED_HOST_MARKER,
  PAYSWAP_RAIL_SANDBOX_DEMOBANK_TIMEOUT_MS: '5000',
  PAYSWAP_RAIL_SANDBOX_DEMOBANK_CREDENTIAL_REF: 'secret-ref:sandbox-demobank-1',
};

function resolveSandboxRails(extraEnv = {}, rails = [{ railId: 'demobank' }]) {
  return resolveRailConnectivityConfig({
    processEnv: { ...SANDBOX_RAIL_ENV, ...extraEnv },
    runtimeScope: { scope: 'sandbox' },
    declaredRails: rails,
  });
}

/** The rig store: one durable store hosting the rail activity dual-writes. */
function openRigStore(dir) {
  const database = openDurableDatabase({ dbPath: join(dir, 'rig.sqlite') });
  const activity = createAdapterActivityLog({
    audit: { recordEvent: (type, data, owner, jobId) => recordEvent(database, type, data, owner, jobId) },
  });
  const resolution = resolveSandboxRails();
  if (!resolution.ok) {
    throw new Error(`sandbox rail configuration failed to resolve: ${JSON.stringify(resolution.failures)}`);
  }
  let rigTransport = createScriptedTransportDouble();
  const boundary = createConnectivityBoundary({
    rails: resolution.rails,
    runtimeScope: 'sandbox',
    transportFactory: () => rigTransport,
    activity,
    clock: () => RAIL_NOW,
  });
  return {
    database,
    activity,
    boundary,
    get transport() {
      return rigTransport;
    },
    set transport(next) {
      rigTransport = next;
    },
    close() {
      database.close();
    },
  };
}

/**
 * Load the frozen src/lib/startup-config.ts under plain Node.
 *
 * The module's ONLY import is the bundler path alias `@/lib/environment`
 * (resolved by Next/tsc, not by plain Node). This loader imports a VERBATIM
 * TEMP COPY of the module with exactly that one specifier rewritten to the
 * real src/lib/environment.ts file URL — the same resolution the bundler
 * performs; every other byte is identical and the frozen source is never
 * touched (the alias is a bundler concern, not module semantics).
 */
async function loadStartupConfigModule() {
  const rel = join('src', 'lib', 'startup-config.ts');
  const source = readFileSync(join(ROOT, rel), 'utf8');
  const environmentUrl = pathToFileURL(join(ROOT, 'src', 'lib', 'environment.ts')).href;
  const rewritten = source.replace(/(["'])@\/lib\/environment\1/g, (_match, quote) => `${quote}${environmentUrl}${quote}`);
  const dir = tempDir('startup-config');
  const target = join(dir, 'startup-config.ts');
  writeFileSync(target, rewritten);
  return import(pathToFileURL(target).href);
}

// ---------------------------------------------------------------------------
// The wrapped harnesses (compose over the merged evidence, never fork).
// ---------------------------------------------------------------------------

function runWrappedHarness(group, relPath, markers, label) {
  const started = Number(process.hrtime.bigint() / 1000000n);
  const child = spawnSync('node', [join(ROOT, relPath)], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: childEnv(),
  });
  const wallMs = Number(process.hrtime.bigint() / 1000000n) - started;
  const exit = typeof child.status === 'number' ? child.status : 1;
  const stdout = typeof child.stdout === 'string' ? child.stdout : '';
  group.check(exit === 0, `${label}: exit 0 (got ${exit})`);
  const missing = markers.filter((marker) => !stdout.includes(marker));
  group.deepEqual(missing, [], `${label}: every composed marker present in the wrapped harness stdout`);
  group.note(`wrap:${relPath}:exit=${exit}:markers=${markers.length}`);
  noteStderr(`[${group.name}] wrapped ${relPath}: exit ${exit}, ${markers.length} markers, ${wallMs}ms (wall-clock — stderr evidence only)`);
  return { exit, stdout };
}

// ---------------------------------------------------------------------------
// Group 1 — proof:release-identity
// ---------------------------------------------------------------------------

async function proveReleaseIdentity(group) {
  const records = readRecords();
  const { record, all, skippedOrphaned } = releaseRecord(records);
  const revision = record.revision;

  group.scenario('the release record — located, unique, well-formed');
  group.note(`records:source=HEAD-committed:working-tree-dirty=${recordsWorkingTreeDirty() ? 'yes' : 'no'}`);
  group.check(typeof record.record_id === 'string' && record.record_id.length > 0, 'the record id is present');
  group.equal(record.schema_version, 1, 'the record schema version is 1');
  group.equal(
    records.filter((entry) => entry.type === 'promotion-record' && entry.record_id === record.record_id).length,
    1,
    'the record id is unique in the append-only store',
  );
  for (const field of ['commit_sha', 'commit_subject', 'tree_digest', 'content_digest', 'tracked_file_count']) {
    group.check(
      typeof revision[field] === 'string' || typeof revision[field] === 'number',
      `revision.${field} is recorded`,
    );
  }
  group.check(/^[0-9a-f]{40}$/.test(revision.commit_sha), 'the commit SHA is a full hex sha1');
  group.check(/^[0-9a-f]{40}$/.test(revision.tree_digest), 'the tree digest is git-shaped (sha1 over the tree object)');
  group.check(/^[0-9a-f]{64}$/.test(revision.content_digest), 'the content digest is sha256-shaped');
  group.equal(
    record.environment_context?.payswap_env_resolved,
    'sandbox',
    'the release was recorded under the sandbox context (the fail-safe runtime allowlist)',
  );
  group.note(`record:${record.record_id}:revision=${revision.commit_sha.slice(0, 12)}:files=${revision.tracked_file_count}`);

  group.scenario('the recorded revision exists and its tree digest matches the git object store');
  const sha = revision.commit_sha;
  const resolved = git(['rev-parse', `${sha}^{commit}`]).trim();
  group.equal(resolved, sha, 'the recorded commit SHA resolves locally (CI fetches full history)');
  const treeNow = git(['rev-parse', `${sha}^{tree}`]).trim();
  group.equal(treeNow, revision.tree_digest, 'the recorded tree digest matches the revision');

  group.scenario('the content digest re-derived at the recorded revision matches exactly');
  const rederived = withWorktree(sha, (worktree) => contentDigest(worktree));
  group.equal(rederived.digest, revision.content_digest, 'the content digest recomputed over a checkout of the recorded SHA matches the record');
  group.equal(rederived.fileCount, revision.tracked_file_count, 'the tracked file count matches the record');
  const ancestor = gitOk(['merge-base', '--is-ancestor', sha, 'HEAD']);
  group.note(
    `digest:recomputed=${rederived.digest.slice(0, 12)}:head-is-descendant=${ancestor !== null ? 'yes' : 'no'}`,
  );

  group.scenario('the recorded gate table is all-green (the immutable release identifier carries a passing battery)');
  const gateTable = Array.isArray(record.gate_table) ? record.gate_table : [];
  group.check(gateTable.length === 6, `the gate table holds the six contract gates (got ${gateTable.length})`);
  const gateNames = gateTable.map((gate) => gate.gate);
  group.deepEqual(
    gateNames,
    ['governance', 'deployment-contract', 'durable-contract', 'typecheck', 'harnesses', 'build'],
    'the gate order matches the CI/CD contract',
  );
  for (const gate of gateTable) {
    group.check(gate.passed === true && gate.exit === 0, `gate ${gate.gate} passed in the recorded battery`);
  }
  group.check(record.gate_verdict?.passed === true, 'the recorded gate verdict is PASS');
  const harnessCount = Array.isArray(gateTable.find((g) => g.gate === 'harnesses')?.harnesses)
    ? gateTable.find((g) => g.gate === 'harnesses').harnesses.length
    : 0;
  group.note(`gates:${gateNames.map((n, i) => `${n}:${gateTable[i].passed ? 'pass' : 'FAIL'}`).join('+')}:harnesses=${harnessCount}`);

  group.scenario('the migration gate ran on a copy (promote.mjs migrate inside a throwaway worktree at HEAD)');
  const recordsBefore = readFileSync(RECORDS_FILE, 'utf8');
  const migrateResult = withWorktree('HEAD', (worktree) => {
    const child = spawnSync('node', [join(worktree, 'scripts', 'promote.mjs'), 'migrate', record.record_id], {
      cwd: worktree,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: childEnv(),
    });
    return {
      exit: typeof child.status === 'number' ? child.status : 1,
      stdout: typeof child.stdout === 'string' ? child.stdout : '',
      stderr: typeof child.stderr === 'string' ? child.stderr : '',
    };
  });
  group.equal(migrateResult.exit, 0, 'promote.mjs migrate exited 0 on the throwaway copy');
  let migrateJson = null;
  try {
    migrateJson = JSON.parse(migrateResult.stdout.split('\n').find((line) => line.trim().startsWith('{')));
  } catch {
    // parsed below
  }
  group.check(migrateJson !== null && migrateJson.ok === true, 'the migration gate reported ok');
  group.equal(migrateJson?.verified, true, 'the migration gate verified the applied set against the files on disk');
  group.equal(migrateJson?.real_database_mutated, false, 'the real database was never mutated');
  const diskMigrations = trackedFiles(ROOT)
    .filter((rel) => rel.startsWith('deploy/migrations/') && rel.endsWith('.sql'))
    .map((rel) => rel.slice('deploy/migrations/'.length))
    .sort();
  group.deepEqual(
    migrateJson?.applied ?? [],
    diskMigrations,
    'the applied migration set matches the release tree exactly and completely',
  );
  const recordsAfter = readFileSync(RECORDS_FILE, 'utf8');
  group.equal(recordsAfter, recordsBefore, 'the repository records file is byte-identical (the append landed in the throwaway worktree only)');

  group.scenario('the recorded release position vs the proof tree (records trail revisions — ci-cd.md §3)');
  group.check(ancestor !== null, 'the recorded revision is an ancestor of the proof tree HEAD');
  group.note(`chain:records=${all.length}:latest-resolvable=${record.record_id}:skipped-orphaned=${skippedOrphaned}`);
  return record;
}

// ---------------------------------------------------------------------------
// Group 2 — proof:protocol-integration
// ---------------------------------------------------------------------------

async function proveProtocolIntegration(group) {
  group.scenario('the wrapped composed journey — the golden path to finality with evidence');
  runWrappedHarness(group, 'scripts/test_protocol_composed_journey.mjs', [
    'RTN-012 composed-journey harness: all checks green.',
    'finality:FINAL:SETTLED',
    'chain:VERIFIED',
    'resubmission:recorded-receipt',
    'worker-restart:lease-reclaim:replayed',
    'tamper:TAMPER_DETECTED',
    'test:determinism: 18-steps:identical',
  ], 'composed journey (golden path)');
  group.scenario('the wrapped composed journey — the UNKNOWN paths and the authorization refusal');
  runWrappedHarness(group, 'scripts/test_protocol_composed_journey.mjs', [
    'attempt:UNKNOWN',
    'held:UNKNOWN_HELD',
    'resolved:RESOLVED_CONFIRMED',
    'resumed:CONFIRMED',
    'recovery:CONFIRMED',
    'denied-gate:COMPLIANCE_BLOCKED',
  ], 'composed journey (UNKNOWN paths)');

  // A fresh minimal gateway composition (the test_protocol_gateway.mjs
  // precedent): the RTN-010 gateway over the REAL durable queue + the REAL
  // A15 log — the admission contract driven directly.
  const dir = tempDir('gateway');
  const database = openDurableDatabase({ dbPath: join(dir, 'gateway.sqlite') });
  const queue = new DurableQueue(database);
  const log = createEvidenceLog({ wallMs: 5_000 });
  const gateway = new ProtocolGateway({
    evidence: log,
    queue: commandQueuePortFromDurableQueue(queue),
    wallClock: () => 5_000,
  });
  const envelope = {
    kind: 'intent.authorize',
    authority: 'Intent Authority',
    subjectIds: ['pid.v1.intent-proof'],
    idempotencyKey: 'dep008-idem-1',
    protocolTime: { sequence: 0, wallMs: 1_000 },
    body: { intentId: 'pid.v1.intent-proof', policyDecisionId: 'pid.v1.decision-proof' },
  };
  const rowCount = () => Number(database.prepare('SELECT COUNT(*) AS n FROM durable_jobs').get().n);

  group.scenario('successful admission onto the durable command path + the recorded-receipt replay');
  const first = await gateway.submitCommand(envelope);
  group.check(first.ok === true, 'the first submission is admitted');
  group.equal(first.created, true, 'the first submission creates the durable job');
  group.equal(first.replayed, false, 'the first submission is not a replay');
  group.equal(first.receipt.outcome, 'ADMITTED', 'the recorded outcome is ADMITTED');
  group.equal(rowCount(), 1, 'exactly ONE durable_jobs row after the first admission');
  const second = await gateway.submitCommand(envelope);
  group.check(second.ok === true, 'the re-submission is admitted (replayed)');
  group.equal(second.replayed, true, 'the re-submission replays the recorded key');
  group.equal(second.receipt, first.receipt, 'the re-submission returns the RECORDED receipt verbatim (never a second effect)');
  group.equal(rowCount(), 1, 'still exactly ONE durable_jobs row');

  group.scenario('command admission refusals — the typed rejection matrix (body validation)');
  const heightBefore = log.height;
  const refused = [];
  const expectRefusal = async (payload, idempotencyKey, reasonCode, field) => {
    const result = await gateway.submitCommand({ ...envelope, ...payload, idempotencyKey });
    group.check(result.ok === false, `submission ${idempotencyKey} is refused`);
    group.equal(result.reasonCode, reasonCode, `submission ${idempotencyKey} refused with ${reasonCode}`);
    if (field !== undefined) {
      group.equal(result.field, field, `submission ${idempotencyKey} names the failing field`);
    }
    refused.push(idempotencyKey);
  };
  await expectRefusal({ body: null }, 'dep008-rej-body-null', 'COMMAND_BODY_INVALID');
  await expectRefusal({ body: { intentId: 'pid.v1.intent-proof' } }, 'dep008-rej-body-missing', 'COMMAND_BODY_INVALID', 'policyDecisionId');
  await expectRefusal({ body: { ...envelope.body, surpriseField: 1 } }, 'dep008-rej-body-extra', 'COMMAND_BODY_INVALID', 'surpriseField');
  group.equal(rowCount(), 1, 'no body-invalid submission created a durable row');

  group.scenario('command admission refusals — envelope, subject, kind and authority');
  await expectRefusal({ kind: 'Intent.Authorize' }, 'dep008-rej-casing', 'ENVELOPE_INVALID', 'kind');
  await expectRefusal({ subjectIds: [] }, 'dep008-rej-subjects', 'COMMAND_SUBJECT_INVALID');
  await expectRefusal({ kind: 'intent.explode' }, 'dep008-rej-unknown-kind', 'COMMAND_KIND_UNKNOWN');
  await expectRefusal({ authority: 'Evidence Authority' }, 'dep008-rej-authority', 'AUTHORITY_UNKNOWN');
  let threwInvented = false;
  try {
    await gateway.submitCommand({ ...envelope, authority: 'Rogue Authority', idempotencyKey: 'dep008-rej-rogue' });
  } catch {
    threwInvented = true;
  }
  group.check(threwInvented, 'an invented authority throws (the refusal cannot be recorded without fabricating an authority — fail-closed)');
  group.equal(rowCount(), 1, 'no refusal path created a durable row');
  group.equal(log.height - heightBefore, refused.length, `each typed refusal wrote exactly ONE A15 rejection record (${refused.length})`);
  let nonObjectThrew = false;
  try {
    await gateway.submitCommand(null);
  } catch {
    nonObjectThrew = true;
  }
  group.check(nonObjectThrew, 'a non-object submission throws (never admitted)');

  group.scenario('command-path poisoning — malformed payloads NEVER admitted, unknown commands NEVER executed');
  group.equal(rowCount(), 1, 'the durable command path still holds exactly the one legitimately admitted job');
  group.equal(jobsByStatus(database, 'queued'), 1, 'the admitted command is queued (poisoning added nothing)');
  group.equal(jobsByStatus(database, 'succeeded') + jobsByStatus(database, 'failed') + jobsByStatus(database, 'dead_lettered'), 0, 'nothing was executed (no worker is bound to this composition)');
  const rejectedRecords = log.records().filter((r) => r.what?.operationType === 'GATEWAY_COMMAND_REJECTED');
  group.check(rejectedRecords.length >= refused.length, 'the refusal evidence records are present in the A15 log');
  group.note(`refusals:${refused.length}:rows=${rowCount()}:rejection-records=${rejectedRecords.length}`);

  stopCondition(
    'unexplained authority bypass',
    false,
    'proof:protocol-integration',
    'every command reached the durable path only through ProtocolGateway.submitCommand; the typed refusal matrix (body/envelope/subject/kind/authority) left zero durable rows and zero executions; the composed journey wrap evidences the single-writer transition path',
  );
  database.close();
}

// ---------------------------------------------------------------------------
// Group 3 — proof:ui-integration
// ---------------------------------------------------------------------------

async function proveUiIntegration(group) {
  const adapters = [
    'runtime-intent-adapter.ts',
    'runtime-checkout-adapter.ts',
    'runtime-capability-adapter.ts',
    'runtime-tracking-adapter.ts',
    'runtime-waiting-adapter.ts',
    'runtime-liquidity-adapter.ts',
    'runtime-mediation-adapter.ts',
  ];
  const ports = [
    'intent-port.ts',
    'checkout-port.ts',
    'capability-port.ts',
    'tracking-port.ts',
    'waiting-port.ts',
    'liquidity-port.ts',
    'mediation-port.ts',
  ];

  group.scenario('the UI-011 runtime adapters and port seams exist (the ports bind to the composed runtime)');
  for (const file of adapters) {
    group.check(existsSync(join(PROTOCOL_DIR, file)), `src/lib/protocol/${file} exists`);
  }
  for (const file of ports) {
    group.check(existsSync(join(PROTOCOL_DIR, file)), `src/lib/protocol/${file} exists`);
  }
  for (const file of ['runtime-handle.ts', 'server-runtime.ts', 'unavailable-backing.ts', 'product-adapter-test-compose.ts']) {
    group.check(existsSync(join(PROTOCOL_DIR, file)), `src/lib/protocol/${file} exists`);
  }
  const serverRuntimeText = readFileSync(join(PROTOCOL_DIR, 'server-runtime.ts'), 'utf8');
  group.check(
    serverRuntimeText.includes('export async function wireProductPortsToProtocolRuntime'),
    'server-runtime.ts exports wireProductPortsToProtocolRuntime (the ONE composition root)',
  );
  for (const port of ports) {
    const seam = `register${port.replace(/-port\.ts$/, '').replace(/^./, (c) => c.toUpperCase())}PortBacking`;
    group.check(serverRuntimeText.includes(seam), `server-runtime.ts calls ${seam} (the UI-011 binding seam)`);
  }

  group.scenario('mock retirement per the re-anchoring contract (recorded verification-shim deviations)');
  const mockFiles = readdirSync(PROTOCOL_DIR).filter((name) => /^mock-.*-authority\.ts$/.test(name));
  group.note(`mock-shims:${mockFiles.length}`);
  for (const name of mockFiles) {
    const text = readFileSync(join(PROTOCOL_DIR, name), 'utf8');
    group.check(
      text.includes('RETIRED') || text.includes('NON-AUTHORITATIVE'),
      `${name} is marked RETIRED (UI-011 verification-support shim) or NON-AUTHORITATIVE (presentation-only) — no authority semantics`,
    );
    group.check(
      !text.includes('registerIntentPortBacking') &&
        !text.includes('registerCheckoutPortBacking') &&
        !text.includes('registerCapabilityPortBacking') &&
        !text.includes('registerTrackingPortBacking') &&
        !text.includes('registerWaitingPortBacking') &&
        !text.includes('registerLiquidityPortBacking') &&
        !text.includes('registerMediationPortBacking'),
      `${name} never registers itself as a port backing`,
    );
  }
  const instrumentation = readFileSync(join(ROOT, 'src', 'instrumentation.ts'), 'utf8');
  group.check(
    instrumentation.includes("NEXT_RUNTIME !== 'nodejs'") && instrumentation.includes('wireProductPortsToProtocolRuntime'),
    'src/instrumentation.ts guards the composition root to the nodejs runtime',
  );

  group.scenario('the splice guard — product surfaces never import protocol-runtime (mechanically re-verified)');
  const spliceViolations = [];
  const scanDir = (dir, label) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      let stat = null;
      try {
        stat = readdirSync(full);
      } catch {
        stat = null;
      }
      if (stat !== null) {
        scanDir(full, label);
        continue;
      }
      if (!/\.(tsx?|jsx?)$/.test(name)) continue;
      const text = readFileSync(full, 'utf8');
      if (/from\s+['"][^'"]*protocol-runtime/.test(text) || /import\(['"][^'"]*protocol-runtime/.test(text)) {
        spliceViolations.push(`${full.replace(ROOT, '')}`);
      }
    }
  };
  scanDir(APP_DIR, 'src/app');
  scanDir(COMPONENTS_UI_DIR, 'src/components');
  group.deepEqual(spliceViolations, [], 'src/app/** and src/components/** contain zero protocol-runtime imports (the UI-011 invariant)');
  const adapterFiles = adapters.map((name) => readFileSync(join(PROTOCOL_DIR, name), 'utf8')).join('');
  group.check(
    /protocol-runtime/.test(adapterFiles),
    'the port adapters ARE the sanctioned protocol-runtime importers (the splice lives in src/lib/protocol/)',
  );

  group.scenario('the shell renders at / and readiness/health answer per F6 (static verification)');
  group.check(existsSync(join(APP_DIR, 'page.tsx')), 'src/app/page.tsx exists (the shell entry surface)');
  group.check(existsSync(join(APP_DIR, 'layout.tsx')), 'src/app/layout.tsx exists');
  const healthText = readFileSync(join(ROOT, 'src', 'app', 'api', 'health', 'route.ts'), 'utf8');
  group.check(!healthText.includes('componentHealth'), '/api/health carries no componentHealth (the F6 liveness/readiness separation)');
  const readyText = readFileSync(join(ROOT, 'src', 'app', 'api', 'ready', 'route.ts'), 'utf8');
  for (const marker of ['status: "ok"', 'status: "not_ready"', 'componentHealth', 'force-dynamic', 'validateStartupConfig']) {
    group.check(readyText.includes(marker), `/api/ready carries ${marker} (the F6 readiness contract + the DEP-007 additive enrichment)`);
  }
  const pageText = readFileSync(join(APP_DIR, 'page.tsx'), 'utf8');
  group.check(pageText.includes('describeEnvironment'), 'the shell derives the environment signal server-side (the sandbox/production banner)');

  group.scenario('the binding exports exist with their frozen signatures (static — the UI-011 family is bun/Next-compiled, not plain-Node-loaded)');
  const expectedSeams = {
    'intent-port.ts': 'export function registerIntentPortBacking(backing: IntentPort): void',
    'checkout-port.ts': 'export function registerCheckoutPortBacking(backing: CheckoutPort): void',
    'capability-port.ts': 'export function registerCapabilityPortBacking(backing: CapabilityPort): void',
    'tracking-port.ts': 'export function registerTrackingPortBacking(backing: TrackingPort): void',
    'waiting-port.ts': 'export function registerWaitingPortBacking(backing: WaitingPort): void',
    'liquidity-port.ts': 'export function registerLiquidityPortBacking(',
    'mediation-port.ts': 'export function registerMediationPortBacking(backing: MediationPort): void',
  };
  for (const [file, seam] of Object.entries(expectedSeams)) {
    const text = readFileSync(join(PROTOCOL_DIR, file), 'utf8');
    group.check(text.includes(seam), `src/lib/protocol/${file} exports its UI-011 backing seam verbatim`);
  }
  const unavailableText = readFileSync(join(PROTOCOL_DIR, 'unavailable-backing.ts'), 'utf8');
  for (const seam of ['getUnavailableIntentPort', 'getUnavailableCheckoutPort', 'getUnavailableCapabilityPort', 'getUnavailableTrackingPort', 'getUnavailableWaitingPort']) {
    group.check(unavailableText.includes(`export function ${seam}`), `unavailable-backing.ts exports ${seam} (browser contexts never fabricate state — the fail-closed default backing)`);
  }
  for (const adapter of ['Intent', 'Checkout', 'Capability', 'Tracking', 'Waiting', 'Mediation']) {
    const file = `runtime-${adapter.toLowerCase()}-adapter.ts`;
    const text = readFileSync(join(PROTOCOL_DIR, file), 'utf8');
    group.check(
      new RegExp(`export function createRuntime${adapter}`).test(text) || text.includes(`createRuntime${adapter}`),
      `${file} exports its runtime adapter factory`,
    );
  }
  group.check(
    readFileSync(join(PROTOCOL_DIR, 'runtime-liquidity-adapter.ts'), 'utf8').includes('createRuntimeLiquidityPortFactory'),
    'runtime-liquidity-adapter.ts exports its port factory (the A06/A07-composed liquidity binding)',
  );
  group.check(
    readFileSync(join(PROTOCOL_DIR, 'runtime-handle.ts'), 'utf8').includes('export interface ProtocolRuntimeHandle'),
    'runtime-handle.ts exports the ProtocolRuntimeHandle contract',
  );
  group.note(
    'mode: the UI-011 family uses bundler-resolved specifiers (bun/Next-compiled — `bun run typecheck` and the frozen gateway boundary test are its compile-level and splice-level proof); this harness verifies the binding exports and wiring statically',
  );

  group.scenario('the standalone build output (mode declared honestly — the probe is environment state, reported on stderr only)');
  // The .next/standalone layout is BUILD-OUTPUT state (gitignored), not tree
  // content: its presence/shape must never reach stdout, or the harness's
  // stdout digest would become a function of untracked build artifacts
  // (breaking the ci-cd.md §2 byte-determinism contract across record/verify
  // flows). The probe therefore reports on STDERR only; the one-time LIVE
  // start of the standalone output (build → start → probe / and /api/ready)
  // is captured in deploy/promotions/DEP-008-READINESS-TRANSCRIPT.md.
  const standaloneCandidates = [
    join(ROOT, '.next', 'standalone', 'server.js'),
    join(ROOT, '.next', 'standalone', 'payswap3', 'server.js'),
  ];
  const presentCandidates = standaloneCandidates.filter((path) => existsSync(path));
  if (presentCandidates.length > 0) {
    const base = dirname(presentCandidates[0]);
    const routesPresent =
      existsSync(join(base, '.next', 'server', 'app')) ||
      existsSync(join(base, '.next', 'server', 'app-paths-manifest.json'));
    noteStderr(
      `[${group.name}] standalone build output present: ${presentCandidates[0].replace(ROOT, '.')}` +
        ` (compiled app routes ${routesPresent ? 'present' : 'not found'}) — stderr evidence only`,
    );
  } else {
    noteStderr(
      `[${group.name}] standalone build output absent at proof time (the harnesses gate runs before the build gate on a fresh tree) — stderr evidence only`,
    );
  }
  group.note(
    'mode: static verification of the route handlers, ports and binding wiring (battery-safe); the standalone build output is probed on stderr and live-verified once in deploy/promotions/DEP-008-READINESS-TRANSCRIPT.md',
  );
}

// ---------------------------------------------------------------------------
// Group 4 — proof:failure-injection
// ---------------------------------------------------------------------------

async function proveFailureInjection(group, rig) {
  group.scenario('the wrapped DEP-007 drill battery (the merged failure-injection drills)');
  const wrapped = runWrappedHarness(group, 'scripts/test_observability_resilience.mjs', [
    'DEP-007 observability/resilience/DR harness: all drill groups green.',
    'drill:failure-injection',
    'drill:backup-restore',
    'drill:worker-restart',
    'drill:replay-recovery',
    'drill:evidence-integrity',
    'drill:telemetry-taxonomy',
  ], 'DEP-007 drills');
  const totalLine = wrapped.stdout
    .split('\n')
    .find((line) => line.trim().startsWith('TOTAL'));
  const parts = totalLine ? totalLine.trim().split(/\s+/) : [];
  group.check(parts.length >= 4 && parts[3] === 'PASS', 'the DEP-007 drill TOTAL row reports PASS');
  group.note(`dep007-drills:scenarios=${parts[1] ?? '?'}:assertions=${parts[2] ?? '?'}`);

  group.scenario('adapter timeout storm — N=25 timeouts through the boundary, none retried, none translated');
  const stormScript = {};
  const stormKeys = [];
  for (let i = 0; i < 25; i += 1) {
    const key = `dep008.storm.${i}`;
    stormKeys.push(key);
    stormScript[key] = [
      { kind: 'timeout', deadlineWallMs: RAIL_NOW + 5_000, latencyMs: 5 },
    ];
  }
  rig.transport.script = stormScript;
  let stormUnknown = 0;
  for (const key of stormKeys) {
    const outcome = rig.boundary.adapters.get('demobank').transmit(transmissionRequest(key, 'instr.dep008.storm'));
    if (outcome.class === 'UNKNOWN' && outcome.reasonCode === 'TIMEOUT') stormUnknown += 1;
  }
  group.equal(stormUnknown, 25, 'every storm submission maps to the frozen UNKNOWN/TIMEOUT outcome (never guessed)');
  const stormTransmits = rig.transport.transmitLog.filter((r) => stormKeys.includes(r.idempotencyKey));
  group.equal(stormTransmits.length, 25, 'exactly one transmit attempt per key (timeouts are NEVER retried)');
  const timeoutActivity = rig.activity.query({ outcome: 'timeout' }).filter((r) => stormKeys.includes(r.idempotencyKey));
  group.equal(timeoutActivity.length, 25, 'the adapter activity log recorded all 25 timeouts');

  group.scenario('retry exhaustion — bounded retransmission of a retryable pre-effect failure');
  const downScript = {
    'dep008.dns-down': [
      { kind: 'transport-failure', reason: 'DNS_UNRESOLVED', detail: 'proof down 1', classification: TRANSPORT_FAILURE_CLASSIFICATION['DNS_UNRESOLVED'], latencyMs: 1 },
      { kind: 'transport-failure', reason: 'DNS_UNRESOLVED', detail: 'proof down 2', classification: TRANSPORT_FAILURE_CLASSIFICATION['DNS_UNRESOLVED'], latencyMs: 1 },
      { kind: 'transport-failure', reason: 'DNS_UNRESOLVED', detail: 'proof down 3', classification: TRANSPORT_FAILURE_CLASSIFICATION['DNS_UNRESOLVED'], latencyMs: 1 },
      { kind: 'transport-failure', reason: 'DNS_UNRESOLVED', detail: 'proof down 4 (must never run)', classification: TRANSPORT_FAILURE_CLASSIFICATION['DNS_UNRESOLVED'], latencyMs: 1 },
    ],
  };
  rig.transport.script = downScript;
  const exhausted = transmitWithTransportSafeguards({
    port: rig.transport,
    request: {
      railId: 'demobank',
      ...transmissionRequest('dep008.dns-down', 'instr.dep008.dns'),
      correlation: { instructionId: 'instr.dep008.dns' },
      deadlineWallMs: RAIL_NOW + 60_000,
    },
    policy: { maxAttempts: 3, backoffBaseMs: 250, backoffMaxMs: 4_000 },
    clock: () => RAIL_NOW,
  });
  group.equal(exhausted.result.kind, 'transport-failure', 'exhaustion surfaces the last transport-failure');
  group.equal(exhausted.attempts.length, 3, 'exactly three attempts (the bound)');
  const exhaustedKeys = new Set(exhausted.attempts.map((a) => a.idempotencyKey));
  group.deepEqual([...exhaustedKeys], ['dep008.dns-down'], 'every retransmission carried the SAME rail idempotency key (INV-13-3)');
  const exhaustedTransmits = rig.transport.transmitLog.filter((r) => r.idempotencyKey === 'dep008.dns-down');
  group.equal(exhaustedTransmits.length, 3, 'the fourth scripted failure never ran (the bound held)');
  const mappedExhaustion = mapTransportResultToFrozenOutcome(exhausted.result, exhausted.attempts.length);
  group.equal(mappedExhaustion.class, 'UNKNOWN', 'the exhausted submission maps to UNKNOWN at the A13 seam (no guess)');
  group.equal(mappedExhaustion.reasonCode, 'CONNECTION_LOSS', 'the exhaustion reason code is CONNECTION_LOSS');
  group.note(`exhaustion:${mappedExhaustion.detail.slice(0, 80)}`);

  group.scenario('duplicate external submissions — the idempotency key holds at the transport, boundary and durable layers');
  rig.transport.script = {};
  const dupKey = 'dep008.duplicate';
  const firstSend = rig.boundary.adapters.get('demobank').transmit(transmissionRequest(dupKey, 'instr.dep008.dup'));
  const secondSend = rig.boundary.adapters.get('demobank').transmit(transmissionRequest(dupKey, 'instr.dep008.dup'));
  group.equal(firstSend.class, 'ACCEPTED', 'the first submission is accepted');
  group.equal(firstSend.duplicate, 'FIRST', 'the first submission is marked FIRST');
  group.equal(secondSend.class, 'ACCEPTED', 'the duplicate submission is answered (not re-effected)');
  group.equal(secondSend.duplicate, 'COLLAPSED', 'the duplicate submission COLLAPSED onto the recorded receipt (INV-13-3 — one effect)');
  group.check(rig.transport.received.has(dupKey), 'the rail received the key exactly once (one receive-ledger entry)');
  const dupQueueDir = tempDir('dup');
  const dupDb = openDurableDatabase({ dbPath: join(dupQueueDir, 'dup.sqlite') });
  const dupQueue = new DurableQueue(dupDb);
  const dupA = dupQueue.enqueue('dep008.dup.kind', { n: 1 }, { idempotencyKey: 'dup-key' });
  const dupB = dupQueue.enqueue('dep008.dup.kind', { n: 1 }, { idempotencyKey: 'dup-key' });
  group.equal(dupA.created, true, 'the first durable enqueue creates');
  group.equal(dupB.created, false, 'the duplicate durable enqueue is deduplicated');
  group.equal(dupB.reason, 'deduplicated', 'the dedupe reason is recorded');
  group.equal(dupB.job.id, dupA.job.id, 'the duplicate returns the EXISTING job (UNIQUE(idempotency_key, kind))');
  dupDb.close();

  group.scenario('no injected failure mutates authoritative state');
  group.equal(
    jobsByStatus(rig.database, 'queued') +
      jobsByStatus(rig.database, 'reserved') +
      jobsByStatus(rig.database, 'succeeded') +
      jobsByStatus(rig.database, 'failed') +
      jobsByStatus(rig.database, 'dead_lettered'),
    0,
    'the rig store holds ZERO durable jobs (the storm never touched the durable command path)',
  );

  stopCondition(
    'unsafe external retry',
    false,
    'proof:failure-injection',
    'timeouts and UNKNOWNs: exactly one transmit each (never retried); the retryable pre-effect failure re-drove with the SAME key, bounded at 3 attempts with the 4th never issued; duplicates collapsed at the transport, boundary and durable layers',
  );
}

// ---------------------------------------------------------------------------
// Group 5 — proof:scaling-behavior (substrate-level, in-sandbox)
// ---------------------------------------------------------------------------

async function proveScalingBehavior(group) {
  group.scenario('burst load — 500 jobs across 25 kinds enqueued with no loss');
  const rssBefore = process.memoryUsage().rss;
  const scaleDir = tempDir('scale');
  const scaleDb = openDurableDatabase({ dbPath: join(scaleDir, 'scale.sqlite') });
  const runtime = bindDurableRuntime({
    database: scaleDb,
    workerId: 'dep008-scale-worker',
    concurrency: 8,
    leaseMs: 40,
    backoffBaseMs: 10,
    backoffMaxMs: 50,
  });
  const kinds = [];
  for (let k = 1; k <= 25; k += 1) {
    const kind = `dep008.scale.k${String(k).padStart(2, '0')}`;
    kinds.push(kind);
    runtime.register(kind, makeEffectHandler(scaleDb));
  }
  let enqueued = 0;
  let enqueueFailures = 0;
  for (const kind of kinds) {
    for (let i = 1; i <= 20; i += 1) {
      const result = runtime.enqueue(kind, { i }, { idempotencyKey: `dep008-scale-${kind}-${i}` });
      if (result.created === true) {
        enqueued += 1;
      } else {
        enqueueFailures += 1;
      }
    }
  }
  group.equal(enqueueFailures, 0, 'every burst enqueue created its job (no loss, no dedupe anomaly)');
  group.equal(enqueued, 500, 'exactly 500 jobs were enqueued');
  const queuedAtBurst = jobsByStatus(scaleDb, 'queued');
  group.equal(queuedAtBurst, 500, 'the queue depth reports all 500 jobs (no loss at enqueue)');
  const rssAfterEnqueue = process.memoryUsage().rss;
  noteStderr(
    `[${group.name}] burst enqueue memory: rss ${rssBefore} → ${rssAfterEnqueue} bytes (delta ${rssAfterEnqueue - rssBefore}) — stderr evidence only`,
  );

  group.scenario('FIFO dispatch discipline (the substrate claim order)');
  const fifoDir = tempDir('fifo');
  const fifoDb = openDurableDatabase({ dbPath: join(fifoDir, 'fifo.sqlite') });
  const fifoQueue = new DurableQueue(fifoDb);
  const base = 50_000;
  for (let i = 0; i < 5; i += 1) {
    fifoQueue.enqueue('dep008.fifo', { i }, { idempotencyKey: `fifo-${i}`, availableAt: base + i * 50 });
  }
  const fifoOrder = [];
  let fifoJob = fifoQueue.reserve('fifo-worker-a', 1_000, { kind: 'dep008.fifo' });
  const clockNow = base + 10_000;
  while (fifoJob !== null) {
    fifoOrder.push(JSON.parse(JSON.stringify(fifoJob.payload)).i);
    fifoQueue.complete(fifoJob.id, 'fifo-worker-a');
    fifoJob = fifoQueue.reserve('fifo-worker-a', 1_000, { kind: 'dep008.fifo' });
    if (fifoJob !== null && fifoJob.availableAt > clockNow) break;
  }
  group.deepEqual(fifoOrder, [0, 1, 2, 3, 4], 'reserve returns jobs in (available_at, created_at, id) order');
  fifoDb.close();

  group.scenario('drain under load — every job completed exactly once, nothing lost or duplicated');
  const drain = await drainUntilSettled({ runtime, settleMs: 4, maxPasses: 400 });
  group.check(drain.settled, `the drain settled (passes=${drain.passes}, dispatched=${drain.dispatched})`);
  group.equal(jobsByStatus(scaleDb, 'succeeded'), 500, 'all 500 jobs succeeded');
  group.equal(
    jobsByStatus(scaleDb, 'queued') + jobsByStatus(scaleDb, 'reserved') + jobsByStatus(scaleDb, 'failed'),
    0,
    'nothing is queued, reserved or failed at proof end',
  );
  const receipts = effectReceipts(scaleDb);
  group.equal(receipts.size, 500, 'exactly 500 distinct effect receipts');
  group.check([...receipts.values()].every((count) => count === 1), 'every effect key applied EXACTLY ONCE');
  const rssAfterDrain = process.memoryUsage().rss;
  noteStderr(
    `[${group.name}] post-drain memory: rss ${rssAfterDrain} bytes (delta from start ${rssAfterDrain - rssBefore}) — stderr evidence only`,
  );

  group.scenario('worker concurrency invariants — leases held exclusively, no double execution under contention');
  const exclDir = tempDir('exclusive');
  const exclDb = openDurableDatabase({ dbPath: join(exclDir, 'exclusive.sqlite') });
  const exclQueue = new DurableQueue(exclDb);
  exclQueue.enqueue('dep008.excl', { n: 1 }, { idempotencyKey: 'excl-only' });
  const heldByA = exclQueue.reserve('worker-a', 5_000, { kind: 'dep008.excl' });
  group.check(heldByA !== null, 'worker A reserved the only job');
  const heldByB = exclQueue.reserve('worker-b', 5_000, { kind: 'dep008.excl' });
  group.equal(heldByB, null, 'worker B cannot reserve the job held by A (lease exclusivity)');
  const lateComplete = exclQueue.complete(heldByA.id, 'worker-b');
  group.equal(lateComplete, false, 'a different worker cannot complete the leased job');
  exclQueue.complete(heldByA.id, 'worker-a');
  exclDb.close();

  const contentionDir = tempDir('contention');
  const contentionDb = openDurableDatabase({ dbPath: join(contentionDir, 'contention.sqlite') });
  const workerOne = bindDurableRuntime({
    database: contentionDb,
    workerId: 'dep008-contention-a',
    concurrency: 4,
    leaseMs: 40,
    backoffBaseMs: 10,
    backoffMaxMs: 50,
  });
  const workerTwo = bindDurableRuntime({
    database: contentionDb,
    workerId: 'dep008-contention-b',
    concurrency: 4,
    leaseMs: 40,
    backoffBaseMs: 10,
    backoffMaxMs: 50,
  });
  for (const runtimeOf of [workerOne, workerTwo]) {
    runtimeOf.register('dep008.contend', makeEffectHandler(contentionDb));
  }
  for (let i = 0; i < 100; i += 1) {
    workerOne.enqueue('dep008.contend', { i }, { idempotencyKey: `contend-${i}` });
  }
  let passes = 0;
  let dispatched = 0;
  while (passes < 600) {
    const a = await workerOne.worker.tick();
    const b = await workerTwo.worker.tick();
    dispatched += a + b;
    passes += 1;
    if (a === 0 && b === 0) {
      const remaining =
        jobsByStatus(contentionDb, 'queued') + jobsByStatus(contentionDb, 'failed') + jobsByStatus(contentionDb, 'reserved');
      if (remaining === 0) break;
    }
  }
  group.equal(jobsByStatus(contentionDb, 'succeeded'), 100, 'both workers drained all 100 contention jobs');
  const contentionReceipts = effectReceipts(contentionDb);
  group.equal(contentionReceipts.size, 100, '100 distinct effects under two-worker contention');
  group.check(
    [...contentionReceipts.values()].every((count) => count === 1),
    'no job executed twice under contention (the recorded-receipt guard + lease exclusivity)',
  );
  group.note(`contention:dispatched=${dispatched}:passes=${passes}`);

  group.scenario('backpressure — the bounded-refusal surfaces (the honest substrate contract)');
  const boundDir = tempDir('bound');
  const boundDb = openDurableDatabase({ dbPath: join(boundDir, 'bound.sqlite') });
  const boundRuntime = bindDurableRuntime({
    database: boundDb,
    workerId: 'dep008-bound-worker',
    concurrency: 2,
    leaseMs: 40,
    backoffBaseMs: 10,
    backoffMaxMs: 50,
  });
  boundRuntime.register('dep008.bound', makeEffectHandler(boundDb));
  for (let i = 0; i < 50; i += 1) {
    boundRuntime.enqueue('dep008.bound', { i }, { idempotencyKey: `bound-${i}` });
  }
  const onePass = await drainUntilSettled({ runtime: boundRuntime, settleMs: 1, maxPasses: 1 });
  group.equal(onePass.settled, false, 'a drain bounded to one pass REFUSES to claim settlement (fail-closed, never loops unboundedly)');
  group.check(onePass.pendingRemaining > 0, 'the bounded drain reports the pending remainder honestly');
  const cutoff = decideTransportRetry({
    result: {
      kind: 'transport-failure',
      reason: 'DNS_UNRESOLVED',
      detail: 'proof cutoff',
      classification: TRANSPORT_FAILURE_CLASSIFICATION['DNS_UNRESOLVED'],
      telemetry: { completedWallMs: 0, attempts: 1, latencyMs: 1 },
    },
    attemptsUsed: 1,
    policy: { maxAttempts: 3, backoffBaseMs: 250, backoffMaxMs: 4_000 },
    nowWallMs: RAIL_NOW,
    deadlineWallMs: RAIL_NOW + 240,
  });
  group.equal(cutoff.action, 'return', 'a retransmission that would cross the deadline is REFUSED (deadline-aware backpressure)');
  const backoffSeries = [1, 2, 3, 5, 30].map((n) => transportBackoffDelayMs({ maxAttempts: 4, backoffBaseMs: 250, backoffMaxMs: 4_000 }, n));
  group.deepEqual(backoffSeries, [250, 500, 1000, 4000, 4000], 'the backoff schedule is bounded and capped');
  let concurrencyThrew = false;
  try {
    new DurableWorker({ queue: new DurableQueue(boundDb), workerId: 'bad', concurrency: 0 });
  } catch {
    concurrencyThrew = true;
  }
  group.check(concurrencyThrew, 'worker concurrency below 1 is refused by construction');
  const boundFailDb = openDurableDatabase({ dbPath: join(boundDir, 'fail.sqlite') });
  const boundFailQueue = new DurableQueue(boundFailDb);
  const attemptBound = boundFailQueue.enqueue('dep008.onetry', {}, { idempotencyKey: 'onetry', maxAttempts: 1 });
  boundFailQueue.reserve('bound-worker', 1_000, { kind: 'dep008.onetry' });
  const failOutcome = boundFailQueue.fail(attemptBound.job.id, new Error('proof one-shot'), 'bound-worker');
  group.equal(failOutcome.outcome, 'dead_lettered', 'maxAttempts=1 dead-letters on the first failure (the attempt bound refuses unbounded retry)');
  boundFailDb.close();
  boundDb.close();

  group.note(
    'scope: SUBSTRATE-level scaling evidence in-sandbox (bounded drains, lease exclusivity, exactly-once effects under burst and contention) — NOT a claim about production horizontal scaling',
  );
  scaleDb.close();
  contentionDb.close();
}

// ---------------------------------------------------------------------------
// Group 6 — proof:config-secret-safety
// ---------------------------------------------------------------------------

function withEnv(overrides, fn) {
  const saved = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function proveConfigSecretSafety(group, releaseRecordRef) {
  if (!releaseRecordRef) {
    throw new Error('the release record is unavailable (proof:release-identity failed — fail-closed)');
  }
  const startupConfig = await loadStartupConfigModule();
  const environmentModule = await import(pathToFileURL(join(ROOT, 'src', 'lib', 'environment.ts')).href);

  group.scenario('fail-closed startup configuration resolution (missing production names ⇒ NOT ready)');
  const sandboxResult = withEnv({ PAYSWAP_ENV: undefined }, () => startupConfig.validateStartupConfig());
  group.check(sandboxResult.ok, 'sandbox resolves ok (the environment selection is the whole required configuration)');
  group.equal(sandboxResult.env, 'sandbox', 'the resolved environment is sandbox');
  const productionMissing = withEnv(
    {
      PAYSWAP_ENV: 'production',
      PAYSWAP_DATABASE_URL: undefined,
      PAYSWAP_QUEUE_URL: undefined,
      PAYSWAP_EVIDENCE_STORE_URL: undefined,
      PAYSWAP_RAIL_ADAPTERS_URL: undefined,
    },
    () => startupConfig.validateStartupConfig(),
  );
  group.equal(productionMissing.ok, false, 'production with missing required names is NOT ready (fail-closed, F6)');
  group.deepEqual(
    productionMissing.checks.filter((c) => !c.ok).map((c) => c.id),
    ['PAYSWAP_DATABASE_URL', 'PAYSWAP_QUEUE_URL', 'PAYSWAP_EVIDENCE_STORE_URL', 'PAYSWAP_RAIL_ADAPTERS_URL'],
    'the failing checks are the four NAMED production names (ids only, never values)',
  );
  const productionPresent = withEnv(
    {
      PAYSWAP_ENV: 'production',
      PAYSWAP_DATABASE_URL: 'sqlite://proof-placeholder',
      PAYSWAP_QUEUE_URL: 'sqlite://proof-placeholder',
      PAYSWAP_EVIDENCE_STORE_URL: 'sqlite://proof-placeholder',
      PAYSWAP_RAIL_ADAPTERS_URL: 'sqlite://proof-placeholder',
    },
    () => startupConfig.validateStartupConfig(),
  );
  group.check(productionPresent.ok, 'production with every required NAME present resolves ok (presence only — values are never read)');
  group.equal(productionPresent.checks.length, 5, 'the production check list is the environment plus the four names');

  group.scenario('the F1 runtime allowlist agreement (fail-safe sandbox, never production by accident)');
  group.equal(withEnv({ PAYSWAP_ENV: undefined }, () => environmentModule.getEnvironment()), 'sandbox', 'unset resolves sandbox');
  group.equal(withEnv({ PAYSWAP_ENV: 'staging' }, () => environmentModule.getEnvironment()), 'sandbox', "'staging' is not a runtime value — fail-safe sandbox");
  group.equal(withEnv({ PAYSWAP_ENV: '' }, () => environmentModule.getEnvironment()), 'sandbox', 'empty fail-safes to sandbox');
  group.equal(withEnv({ PAYSWAP_ENV: 'production' }, () => environmentModule.getEnvironment()), 'production', "'production' resolves production (only via explicit configuration)");
  const registry = JSON.parse(readFileSync(COMPONENTS_JSON, 'utf8'));
  group.deepEqual(registry.runtime_env_allowlist, ['sandbox', 'production'], 'the registry allowlist agrees');
  const environmentsMd = readFileSync(join(ROOT, 'spec', 'deployment', 'environments.md'), 'utf8');
  const configurationMd = readFileSync(join(ROOT, 'spec', 'deployment', 'configuration.md'), 'utf8');
  group.check(environmentsMd.includes('sandbox | production'), 'environments.md states the allowlist');
  group.check(configurationMd.includes('sandbox | production'), 'configuration.md states the allowlist');

  group.scenario('credential REFERENCES only — never values, on every configuration surface');
  const sandboxRails = resolveSandboxRails();
  group.check(sandboxRails.ok, 'the sandbox rail configuration resolves');
  const rail = sandboxRails.rails[0];
  group.equal(rail.credentialRef, 'secret-ref:sandbox-demobank-1', 'the resolver records the credential REFERENCE NAME only');
  group.check(Object.isFrozen(rail), 'the resolved rail configuration is frozen');
  group.check(!JSON.stringify(rail).includes('value'), 'no credential value field exists on the resolved configuration');
  const productionShape = resolveRailConnectivityConfig({
    processEnv: {
      PAYSWAP_RAIL_PRODUCTION_BANK_A_HOST: 'https://prod-bank-a.example',
      PAYSWAP_RAIL_PRODUCTION_BANK_A_TIMEOUT_MS: '15000',
    },
    runtimeScope: { scope: 'production' },
    declaredRails: [{ railId: 'bank-a' }],
  });
  group.check(productionShape.ok === false, 'a production rail without its credential reference fails closed (F6)');
  group.check(
    productionShape.failures.some((f) => f.code === 'CREDENTIAL_REF_REQUIRED_FOR_PRODUCTION'),
    'the failure is the typed CREDENTIAL_REF_REQUIRED_FOR_PRODUCTION',
  );
  const productionFull = resolveRailConnectivityConfig({
    processEnv: {
      PAYSWAP_RAIL_PRODUCTION_BANK_A_HOST: 'https://prod-bank-a.example',
      PAYSWAP_RAIL_PRODUCTION_BANK_A_CREDENTIAL_REF: 'secret-ref:prod-bank-a-1',
      PAYSWAP_RAIL_PRODUCTION_BANK_A_TIMEOUT_MS: '15000',
    },
    runtimeScope: { scope: 'production' },
    declaredRails: [{ railId: 'bank-a' }],
  });
  group.check(productionFull.ok, 'the full production shape resolves (references only)');
  group.equal(productionFull.rails[0].credentialRef, 'secret-ref:prod-bank-a-1', 'the production credential is a reference name');

  group.scenario('the S1-style secret scan over the whole release tree');
  const patterns = [
    /ghp_[A-Za-z0-9]{20,}/,
    /gho_[A-Za-z0-9]{20,}/,
    /sk-[A-Za-z0-9]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  ];
  const tracked = trackedFiles(ROOT);
  const hits = [];
  for (const rel of tracked) {
    let text = '';
    try {
      text = readFileSync(join(ROOT, rel), 'utf8');
    } catch {
      continue;
    }
    for (const pattern of patterns) {
      if (pattern.test(text)) hits.push(`${rel}:${pattern.source.slice(0, 12)}`);
    }
  }
  group.deepEqual(hits, [], `zero secret-value patterns across all ${tracked.length} tracked files (S1)`);
  group.note(`s1-scan:files=${tracked.length}:patterns=${patterns.length}:hits=0`);

  group.scenario('environment-crossing refusal — sandbox configuration can never satisfy production gates');
  const crossRefusal = withWorktree('HEAD', (worktree) => {
    const child = spawnSync('node', [join(worktree, 'scripts', 'promote.mjs'), 'record'], {
      cwd: worktree,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: { ...childEnv(), PAYSWAP_ENV: 'production' },
    });
    return {
      exit: typeof child.status === 'number' ? child.status : 1,
      stderr: typeof child.stderr === 'string' ? child.stderr : '',
    };
  });
  group.equal(crossRefusal.exit, 2, 'promote.mjs record under PAYSWAP_ENV=production is REFUSED (exit 2)');
  group.check(
    crossRefusal.stderr.includes('PAYSWAP_ENV resolves to production'),
    'the refusal names the production context (the production_gate contract stays authoritative)',
  );
  const scopeMismatch = resolveRailConnectivityConfig({
    processEnv: {
      PAYSWAP_RAIL_SANDBOX_DEMOBANK_HOST: IN_PROCESS_SIMULATED_HOST_MARKER,
      PAYSWAP_RAIL_SANDBOX_DEMOBANK_TIMEOUT_MS: '5000',
    },
    runtimeScope: { scope: 'production' },
    declaredRails: [{ railId: 'demobank' }],
  });
  group.check(
    scopeMismatch.ok === false && scopeMismatch.failures.some((f) => f.code === 'SCOPE_MISMATCH'),
    'a sandbox-scoped rail configuration is REFUSED for a production runtime scope (F1–F8 boundary)',
  );
  const contamination = resolveRailConnectivityConfig({
    processEnv: {
      PAYSWAP_RAIL_SANDBOX_DEMOBANK_HOST: IN_PROCESS_SIMULATED_HOST_MARKER,
      PAYSWAP_RAIL_SANDBOX_DEMOBANK_TIMEOUT_MS: '5000',
      PAYSWAP_RAIL_PRODUCTION_DEMOBANK_HOST: 'https://prod.example',
      PAYSWAP_RAIL_PRODUCTION_DEMOBANK_CREDENTIAL_REF: 'secret-ref:prod-1',
      PAYSWAP_RAIL_PRODUCTION_DEMOBANK_TIMEOUT_MS: '5000',
    },
    runtimeScope: { scope: 'sandbox' },
    declaredRails: [{ railId: 'demobank' }],
  });
  group.check(
    contamination.ok === false && contamination.failures.some((f) => f.code === 'SCOPE_CONTAMINATION'),
    'a rail carrying BOTH scope prefixes is refused (cross-contamination, fail-closed)',
  );
  group.check(
    releaseRecordRef.environment_context?.production_promotion !== undefined,
    'the release record itself carries the production-promotion refusal note',
  );

  stopCondition('environment crossing', false, 'proof:config-secret-safety', 'the promotion tool refused a resolved production context (exit 2); sandbox rail config is refused for production scope (SCOPE_MISMATCH); both-scope contamination refused; the runtime allowlist agrees across the implementation, the registry and the documents');
  stopCondition('configuration ambiguity', false, 'proof:config-secret-safety', 'every configuration failure is typed and named (HOST_MISSING/SCOPE_MISMATCH/SCOPE_CONTAMINATION/CREDENTIAL_REF_REQUIRED_FOR_PRODUCTION); missing production names fail closed with ids only; the allowlist is closed and agrees everywhere');
}

// ---------------------------------------------------------------------------
// Group 7 — proof:backup-restore-queue-recovery
// ---------------------------------------------------------------------------

async function proveBackupRestoreQueueRecovery(group) {
  const dir = tempDir('recovery');
  const database = openDurableDatabase({ dbPath: join(dir, 'store.sqlite') });
  const runtime = bindDurableRuntime({
    database,
    workerId: 'dep008-recovery-worker',
    concurrency: 1,
    leaseMs: 40,
    backoffBaseMs: 10,
    backoffMaxMs: 50,
  });
  runtime.register('dep008.effect', makeEffectHandler(database));
  // The flaky kind fails BEFORE its effect (a pure thrower — no receipt is
  // recorded; the exhaustion path is the substrate's, not an effect).
  runtime.register('dep008.flaky', async () => {
    throw new Error('dep008 proof flaky failure');
  });

  group.scenario('a populated store across every reachable job status (incl. a dead letter and a reserved zombie)');
  for (const key of ['rec-a', 'rec-b', 'rec-c']) {
    runtime.enqueue('dep008.effect', { key }, { idempotencyKey: key });
  }
  const firstDrain = await drainUntilSettled({ runtime, settleMs: 6, maxPasses: 120 });
  group.check(firstDrain.settled, 'the first cohort drained');
  group.equal(jobsByStatus(database, 'succeeded'), 3, 'three jobs completed');
  runtime.enqueue('dep008.flaky', { key: 'rec-dead' }, { idempotencyKey: 'rec-dead', maxAttempts: 1 });
  const deadDrain = await drainUntilSettled({ runtime, settleMs: 6, maxPasses: 120 });
  group.check(deadDrain.settled, 'the dead-letter cohort drained');
  group.equal(jobsByStatus(database, 'dead_lettered'), 1, 'the exhausted job is dead-lettered (terminal)');
  const zombie = runtime.enqueue('dep008.effect', { key: 'rec-zombie' }, { idempotencyKey: 'rec-zombie' });
  const held = runtime.queue.reserve('dep008-dying-worker', 40, { kind: 'dep008.effect' });
  group.equal(held?.id, zombie.job.id, 'the zombie job is reserved mid-flight (the worker will never complete it)');
  await makeEffectHandler(database)(held);
  // Let the lease expire BEFORE the backup: the replay's first tick then
  // reclaims the zombie (a live lease would let the settle check pass with
  // the zombie still reserved — the honest redelivery needs the expiry).
  await sleep(80);
  runtime.enqueue('dep008.effect', { key: 'rec-queued' }, { idempotencyKey: 'rec-queued' });
  group.equal(jobsByStatus(database, 'queued'), 1, 'one job remains queued for the replay');
  const owners = new Set(
    database.prepare('SELECT DISTINCT owner FROM durable_events').all().map((row) => String(row.owner)),
  );
  group.check(owners.has(PROOF_EVENT_OWNER) && owners.has('durable-substrate'), 'events from the proof and the substrate owners are present');
  const eventCount = Number(database.prepare('SELECT COUNT(*) AS n FROM durable_events').get().n);
  group.note(`populated:events=${eventCount}:owners=${owners.size}`);

  group.scenario('verified online backup with the append-only manifest row');
  const backupPaths = {
    backup: join(dir, 'backup.sqlite'),
    manifest: join(dir, 'manifest.jsonl'),
    target: join(dir, 'restored.sqlite'),
  };
  const entry = createBackup({
    database,
    backupPath: backupPaths.backup,
    manifestPath: backupPaths.manifest,
    audit: recoveryAuditFromDatabase(database),
  });
  group.check(entry.byteSize > 0, 'the backup artifact is non-empty');
  group.equal(entry.integrityCheck, 'ok', 'the fresh backup passed its own integrity_check');
  group.equal(entry.migrationChecksumsMatch, true, 'the backup migration checksums match the source');
  group.equal(entry.evidenceDigestsMatch, true, 'the backup evidence digests match the source');
  const manifestRows = readBackupManifest(backupPaths.manifest);
  group.equal(manifestRows.length, 1, 'the manifest holds exactly one row after one backup');
  group.equal(manifestRows[0].backupId, entry.backupId, 'the manifest row is the backup receipt');

  group.scenario('destroy + restore into a fresh target with the full verification battery');
  const restore = restoreBackup({
    backupPath: backupPaths.backup,
    targetPath: backupPaths.target,
    manifestPath: backupPaths.manifest,
    audit: recoveryAuditFromDatabase(database),
  });
  group.equal(restore.verification.integrityCheck, 'ok', 'the restored target passes integrity_check');
  group.equal(restore.verification.migrationsMatch, true, 'the target migrations match the backup record');
  group.equal(restore.verification.repoMigrationsMatch, true, 'the backup migrations match the repository files');
  group.equal(restore.verification.evidenceIntegrity.ok, true, 'evidence integrity verified after restore');
  group.equal(restore.verification.evidenceIntegrity.mismatches.length, 0, 'no evidence mismatches');
  group.equal(restore.database.path, resolve(backupPaths.target), 'the restored handle is the TARGET copy (never in place)');
  group.check(restore.database.isOpen(), 'the restored handle is open through the substrate');

  group.scenario('queue replay — exactly-once completion for every pending and redelivered job');
  const replayHandlers = new Map([
    ['dep008.effect', makeEffectHandler(restore.database)],
    ['dep008.flaky', async () => {
      throw new Error('dep008 proof flaky failure');
    }],
  ]);
  const replay = await replayRestoredQueue({
    database: restore.database,
    handlers: replayHandlers,
    settleMs: 6,
    maxPasses: 160,
    audit: recoveryAuditFromDatabase(restore.database),
  });
  group.check(replay.drain.settled, 'the replay drained the restored queue to settlement');
  group.check(replay.redeliveredJobs.length >= 1, 'the reserved zombie was redelivered through lease expiry');
  group.equal(jobsByStatus(restore.database, 'succeeded'), 5, 'all five effect jobs completed exactly once (3 pre-backup + queued + zombie)');
  group.equal(jobsByStatus(restore.database, 'dead_lettered'), 1, 'the dead letter stayed terminal (never re-executed by replay)');
  const restoredReceipts = effectReceipts(restore.database);
  group.equal(restoredReceipts.size, 5, 'exactly five effect receipts in the restored store');
  group.check([...restoredReceipts.values()].every((count) => count === 1), 'every effect key applied EXACTLY ONCE across backup + restore + replay');
  group.note(`replay:redelivered=${replay.redeliveredJobs.length}:events-after-watermark=${Object.keys(replay.eventsByType).length}`);

  group.scenario('the worker-restart path — lease expiry, reclaim, re-execution with the receipt guard');
  const restartDir = tempDir('restart');
  const restartDb = openDurableDatabase({ dbPath: join(restartDir, 'restart.sqlite') });
  const restartRuntime = bindDurableRuntime({
    database: restartDb,
    workerId: 'dep008-restart-worker',
    concurrency: 1,
    leaseMs: 40,
    backoffBaseMs: 10,
    backoffMaxMs: 50,
  });
  restartRuntime.register('dep008.effect', makeEffectHandler(restartDb));
  const dying = restartRuntime.enqueue('dep008.effect', { key: 'restart-1' }, { idempotencyKey: 'restart-1' });
  const dyingJob = restartRuntime.queue.reserve('dep008-crashing-worker', 40, { kind: 'dep008.effect' });
  group.equal(dyingJob?.id, dying.job.id, 'the crashing worker holds the job mid-flight');
  await makeEffectHandler(restartDb)(dyingJob);
  await sleep(80);
  const reclaimed = restartRuntime.queue.reclaimExpired();
  group.equal(reclaimed.reclaimed, 1, 'the expired lease was reclaimed');
  const redelivered = restartRuntime.queue.reserve('dep008-revived-worker', 40, { kind: 'dep008.effect' });
  group.equal(redelivered?.id, dying.job.id, 'the SAME durable job was redelivered');
  await makeEffectHandler(restartDb)(redelivered);
  restartRuntime.queue.complete(redelivered.id, 'dep008-revived-worker');
  const restartReceipts = effectReceipts(restartDb);
  group.equal(restartReceipts.get('restart-1'), 1, 'the effect applied exactly once across the crash and the redelivery');
  restartDb.close();
  database.close();
  restore.database.close();

  stopCondition('missing recovery path', false, 'proof:backup-restore-queue-recovery', 'backup → destroy → verified restore → settled replay with exactly-once effects; the zombie reclaimed through lease expiry; the dead letter terminal; the worker-restart path proven');
}

// ---------------------------------------------------------------------------
// Group 8 — proof:unknown-reconciliation
// ---------------------------------------------------------------------------

async function proveUnknownReconciliation(group, rig) {
  group.scenario('the wrapped composed journey — the A14 cycle resolves UNKNOWN to terminal states');
  runWrappedHarness(group, 'scripts/test_protocol_composed_journey.mjs', [
    'case:pid.v1.',
    'held:UNKNOWN_HELD',
    'resolved:RESOLVED_CONFIRMED',
    'resumed:CONFIRMED',
    'finality:FINAL:SETTLED',
  ], 'composed journey (A14 resolution)');
  group.scenario('the wrapped operations harness — the reconciliation sweep drives UNKNOWN work to terminal states');
  runWrappedHarness(group, 'scripts/test_operations.mjs', [
    'DEP-004 operational-jobs harness: all checks green.',
    'test:unknown-reconciliation:',
    'finality:BLOCKED:UNKNOWN_HELD',
    'blind-retry:REFUSED:LIVE_ATTEMPT_EXISTS',
    'resolution:RESOLVED_CONFIRMED:finality:FINAL:SETTLED',
    'a14:admitted:cycle.open+case.investigate:queued-D2',
  ], 'operations reconciliation sweep');

  group.scenario('UNKNOWN surfaced, never retried, never translated (the boundary discipline)');
  const unknownScript = {
    'dep008.unknown-1': [
      { kind: 'UNKNOWN', cause: 'AMBIGUOUS_RESPONSE', detail: 'the proof rail answered an unclassifiable body', latencyMs: 2 },
    ],
  };
  rig.transport.script = unknownScript;
  const unknownOutcome = rig.boundary.adapters.get('demobank').transmit(
    transmissionRequest('dep008.unknown-1', 'instr.dep008.unknown'),
  );
  group.equal(unknownOutcome.class, 'UNKNOWN', 'the UNKNOWN outcome is surfaced as UNKNOWN at the frozen A13 seam (never translated)');
  group.equal(unknownOutcome.reasonCode, 'AMBIGUOUS_RAIL_RESPONSE', 'the reason code names the ambiguity');
  const unknownTransmits = rig.transport.transmitLog.filter((r) => r.idempotencyKey === 'dep008.unknown-1');
  group.equal(unknownTransmits.length, 1, 'the UNKNOWN submission was transmitted exactly ONCE (never retransmitted)');
  const unknownActivity = rig.activity.query({ idempotencyKey: 'dep008.unknown-1' });
  group.check(
    unknownActivity.some((record) => record.outcome === 'UNKNOWN'),
    'the adapter activity log records the surfaced UNKNOWN',
  );
  const silence = rig.transport.fetchReport({ idempotencyKey: 'dep008.unknown-absent', railId: 'demobank' });
  group.equal(silence.outcomeClass, 'UNKNOWN', 'a report fetch for an unrecorded key returns UNKNOWN (INV-13-4: never a guess)');
  group.equal(silence.reasonCode, 'SILENCE', 'the reason code is SILENCE');

  group.scenario('zero unreconciled UNKNOWN at proof end (the STOP-condition check)');
  const unknownClassActivity = rig.activity.all().filter(
    (record) => record.outcome === 'UNKNOWN' || record.outcome === 'timeout',
  );
  group.check(unknownClassActivity.length >= 26, `every injected UNKNOWN-class outcome is RECORDED (${unknownClassActivity.length} activity records)`);
  const retriedKeys = new Set();
  for (const record of unknownClassActivity) {
    const attempts = rig.transport.transmitLog.filter((r) => r.idempotencyKey === record.idempotencyKey);
    if (attempts.length > 1) retriedKeys.add(record.idempotencyKey);
  }
  group.deepEqual([...retriedKeys], [], 'no UNKNOWN-class key was ever retransmitted');
  const translated = rig.activity
    .all()
    .filter((record) => record.outcome === 'UNKNOWN')
    .filter((record) => {
      const deliver = rig.activity
        .query({ idempotencyKey: record.idempotencyKey, outcome: 'delivered-with-report' })
        .filter((r) => r.attempt > record.attempt);
      return deliver.length > 0;
    });
  group.deepEqual(translated, [], 'no UNKNOWN was later re-worded as delivered (never translated)');
  const commandJobs = jobsByStatus(rig.database, 'queued') + jobsByStatus(rig.database, 'reserved') + jobsByStatus(rig.database, 'succeeded');
  group.equal(commandJobs, 0, 'the UNKNOWNs never spawned durable command work (held for A14, not blindly retried)');
  group.note(
    'unknown-accounting: every surfaced UNKNOWN is recorded in the activity log and held for the A14 path (zero retried, zero translated, zero silently dropped); the wrapped composed journey + operations drills evidence the A14 cycle resolving UNKNOWN to RESOLVED_CONFIRMED / RESOLVED_FAILED with finality advancing exactly once',
  );

  stopCondition(
    'unreconciled UNKNOWN',
    false,
    'proof:unknown-reconciliation',
    'zero UNKNOWN-class keys retransmitted or translated; every surfaced UNKNOWN recorded and held for A14; the wrapped drills evidence terminal resolution (RESOLVED_CONFIRMED / RESOLVED_FAILED) with finality advancing exactly once',
  );
}

// ---------------------------------------------------------------------------
// Group 9 — proof:external-effect-safety
// ---------------------------------------------------------------------------

async function proveExternalEffectSafety(group, rig, releaseRecordRef) {
  group.scenario('the rail boundary refuses unsafe retries — and re-drives safe ones with the same key');
  if (!releaseRecordRef) {
    throw new Error('the release record is unavailable (proof:release-identity failed — fail-closed)');
  }
  rig.transport.script = {
    'dep008.safe-retry': [
      { kind: 'transport-failure', reason: 'CONNECTION_REFUSED', detail: 'proof pre-effect refusal', classification: TRANSPORT_FAILURE_CLASSIFICATION['CONNECTION_REFUSED'], latencyMs: 1 },
      { kind: 'transport-failure', reason: 'CONNECTION_REFUSED', detail: 'proof pre-effect refusal 2', classification: TRANSPORT_FAILURE_CLASSIFICATION['CONNECTION_REFUSED'], latencyMs: 1 },
    ],
  };
  const safeRetry = transmitWithTransportSafeguards({
    port: rig.transport,
    request: {
      railId: 'demobank',
      ...transmissionRequest('dep008.safe-retry', 'instr.dep008.safe'),
      correlation: { instructionId: 'instr.dep008.safe' },
      deadlineWallMs: RAIL_NOW + 60_000,
    },
    policy: { maxAttempts: 3, backoffBaseMs: 250, backoffMaxMs: 4_000 },
    clock: () => RAIL_NOW,
  });
  group.equal(safeRetry.result.kind, 'delivered-with-report', 'the retryable pre-effect failure was safely re-driven to delivery');
  group.equal(safeRetry.attempts.length, 3, 'the safe retry used the bounded attempts');
  const safeKeys = new Set(safeRetry.attempts.map((a) => a.idempotencyKey));
  group.deepEqual([...safeKeys], ['dep008.safe-retry'], 'the re-drive carried the SAME rail idempotency key (recorded receipts prevent a second effect)');
  const inflightScript = {
    'dep008.inflight': [
      { kind: 'transport-failure', reason: 'CONNECTION_LOSS_IN_FLIGHT', detail: 'proof in-flight loss', classification: TRANSPORT_FAILURE_CLASSIFICATION['CONNECTION_LOSS_IN_FLIGHT'], latencyMs: 1 },
    ],
  };
  rig.transport.script = inflightScript;
  const inflight = transmitWithTransportSafeguards({
    port: rig.transport,
    request: {
      railId: 'demobank',
      ...transmissionRequest('dep008.inflight', 'instr.dep008.inflight'),
      correlation: { instructionId: 'instr.dep008.inflight' },
      deadlineWallMs: RAIL_NOW + 60_000,
    },
    policy: { maxAttempts: 3, backoffBaseMs: 250, backoffMaxMs: 4_000 },
    clock: () => RAIL_NOW,
  });
  group.equal(inflight.result.kind, 'transport-failure', 'the in-flight failure surfaces');
  group.equal(inflight.attempts.length, 1, 'an in-flight failure is NEVER retried (the effect may have landed — no re-drive)');

  group.scenario('duplicate submissions dedupe by idempotency key (three layers, one effect)');
  rig.transport.script = {};
  const layeredKey = 'dep008.layered';
  const firstLayer = rig.boundary.adapters.get('demobank').transmit(transmissionRequest(layeredKey, 'instr.dep008.layered'));
  const secondLayer = rig.boundary.adapters.get('demobank').transmit(transmissionRequest(layeredKey, 'instr.dep008.layered'));
  group.equal(firstLayer.class, 'ACCEPTED', 'layer 1 (transport): the first submission delivers');
  group.equal(secondLayer.duplicate, 'COLLAPSED', 'layer 2 (rail receive ledger): the duplicate COLLAPSED to one effect');
  group.check(rig.transport.received.has(layeredKey), 'the receive ledger holds exactly one entry for the key');
  group.check(secondLayer.class === 'ACCEPTED', 'the duplicate call is answered without a second effect');
  group.note('layer-3 (durable UNIQUE + gateway recorded receipt) proven in proof:protocol-integration and the wrapped drills');

  group.scenario('post-effect failures route to recourse (listed, not executed)');
  const planChild = spawnSync('node', [join(ROOT, 'scripts', 'promote.mjs'), 'rollback-plan', releaseRecordRef.record_id], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: childEnv(),
  });
  group.equal(planChild.status, 0, 'promote.mjs rollback-plan emitted the plan (read-only)');
  const plan = JSON.parse(planChild.stdout);
  group.equal(plan.plan_only, true, 'the plan is plan-only (no external effects performed)');
  group.equal(plan.external_effect_safety.unknown_never_retried, true, 'the plan states UNKNOWN is never retried');
  group.equal(plan.external_effect_safety.execution, 'listed-not-executed — this tool performs no external effects', 'the plan executes nothing');
  const postCases = plan.external_effect_safety.post_effect_cases ?? [];
  group.equal(postCases.length, 3, 'the three post-effect cases are listed');
  for (const postCase of postCases) {
    group.check(
      postCase.routing.includes('listed, NOT executed') || postCase.routing.includes('listed-not-executed'),
      `the post-effect case "${postCase.case.slice(0, 40)}…" is listed with recourse routing, NOT executed`,
    );
  }
  group.check(
    postCases.some((c) => c.case.includes('UNKNOWN at rollback time')),
    'the UNKNOWN-at-rollback case routes to the A14 Reconciliation Authority path (GC-2)',
  );

  group.scenario('the rollback-plan emission honors R1–R5 (finality never reversed)');
  group.equal(plan.rolled_back_revision.commit_sha, releaseRecordRef.revision.commit_sha, 'the plan rolls back the RECORDED immutable revision');
  group.equal(plan.rolled_back_revision.tree_digest, releaseRecordRef.revision.tree_digest, 'the plan carries the recorded tree digest');
  group.equal(plan.rolled_back_revision.content_digest, releaseRecordRef.revision.content_digest, 'the plan carries the recorded content digest');
  const principles = new Set(Object.keys(plan.principles ?? {}));
  for (const rule of ['R1', 'R2', 'R3', 'R4', 'R5']) {
    group.check(principles.has(rule), `the plan states principle ${rule}`);
  }
  const finalityStep = (plan.steps ?? []).find((step) => step.action === 'finality-protection');
  group.check(finalityStep !== undefined, 'the plan has an explicit finality-protection step');
  group.deepEqual(finalityStep?.principles ?? [], ['R3'], 'finality protection is R3-tagged');
  group.check(
    JSON.stringify(plan).includes('finality is NEVER reversed'),
    'the plan states finality is NEVER reversed (post-finality corrections flow only through protocol-governed recourse)',
  );
  const authorizationStep = (plan.steps ?? []).find((step) => step.action === 'authorization-boundary');
  group.deepEqual(authorizationStep?.principles ?? [], ['R5'], 'the authorization boundary is R5-tagged (no protocol bypass)');

  stopCondition(
    'unsafe external retry',
    false,
    'proof:external-effect-safety',
    'UNKNOWN/timeout/in-flight never retransmitted; the retryable pre-effect failure re-drove with the SAME key, bounded; duplicates collapsed at every layer; the rollback plan lists post-effect recourse without executing it and states finality is never reversed',
  );
}

// ---------------------------------------------------------------------------
// Group 10 — proof:rollback-observability
// ---------------------------------------------------------------------------

async function proveRollbackObservability(group, rig, releaseRecordRef, records) {
  group.scenario('the rollback plan for the release record references the recorded immutable revision');
  if (!releaseRecordRef) {
    throw new Error('the release record is unavailable (proof:release-identity failed — fail-closed)');
  }
  const planChild = spawnSync('node', [join(ROOT, 'scripts', 'promote.mjs'), 'rollback-plan', releaseRecordRef.record_id], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: childEnv(),
  });
  group.equal(planChild.status, 0, 'the rollback plan emitted');
  const plan = JSON.parse(planChild.stdout);
  group.equal(plan.record_id, releaseRecordRef.record_id, 'the plan names the release record');
  group.equal(plan.rolled_back_revision.commit_subject, releaseRecordRef.revision.commit_subject, 'the plan carries the recorded revision identity');
  const previous = records.filter((entry) => entry.type === 'promotion-record');
  const previousRecord = previous[previous.length - 2] ?? null;
  if (previousRecord) {
    group.equal(plan.rollback_target?.commit_sha, previousRecord.revision.commit_sha, 'the R1 rollback target is the PREVIOUS promotion record in the append-only chain');
    group.equal(plan.executable, true, 'the plan is executable when a previous record exists');
    group.deepEqual(
      plan.steps.find((step) => step.step === 1)?.principles ?? [],
      ['R1'],
      'step 1 is the R1 redeploy-previous-artifact step',
    );
  } else {
    group.equal(plan.rollback_target, null, 'the FIRST record refuses to invent a rollback target (fail-closed)');
    group.equal(plan.executable, false, 'the plan is not executable without a recorded target');
  }
  group.check(Array.isArray(plan.per_component) && plan.per_component.length >= 10, 'the per-component rollback contracts come from the registry (never invented)');
  const registry = JSON.parse(readFileSync(COMPONENTS_JSON, 'utf8'));
  group.deepEqual(
    plan.per_component.map((c) => c.id),
    registry.components.map((c) => c.id),
    'the plan covers exactly the registered components (the registry is the single source of truth)',
  );

  group.scenario('telemetry snapshots before/after the injected degradation (the observability stack reports the proof run)');
  const stormBefore = collectTelemetrySnapshot(rig.database, { isCommandJobKind: () => false });
  const stormAfter = collectTelemetrySnapshot(rig.database, { isCommandJobKind: () => false });
  group.check(
    stormAfter.domains.unknown.railTimeoutInWindow >= 25,
    `the unknown domain derived the timeout storm (${stormAfter.domains.unknown.railTimeoutInWindow} in window)`,
  );
  group.check(
    stormAfter.domains.unknown.totalInWindow >= 26,
    `the unknown domain derived the full UNKNOWN-class total (${stormAfter.domains.unknown.totalInWindow} in window)`,
  );
  group.equal(stormBefore.domains.deployment.environment, 'sandbox', 'the deployment domain reports the frozen sandbox signal');
  group.equal(stormAfter.domains.deployment.journalMode, 'wal', 'the deployment domain reports the WAL crash-safety mode');
  const rigEventCount = Number(rig.database.prepare('SELECT COUNT(*) AS n FROM durable_events').get().n);
  group.equal(stormAfter.eventRowsScanned, rigEventCount, `the snapshot records its honesty bound (every one of the ${rigEventCount} rig rows scanned)`);

  group.scenario('the health worst-of rollup reflects the injected degradation (never masks)');
  const health = deriveComponentHealth(stormAfter);
  const unknownHealth = health.domains.unknown;
  group.check(
    unknownHealth.state === 'down' || unknownHealth.state === 'degraded',
    `the unknown domain reports the storm (${unknownHealth.state})`,
  );
  if (unknownHealth.state !== 'ok') {
    group.check(
      unknownHealth.action !== undefined && unknownHealth.action.whatToInspect.length > 10,
      'the degraded/down domain carries its REQUIRED action descriptor',
    );
    group.check(unknownHealth.action.drill.startsWith('drill:'), 'the action names its drill');
    group.check(unknownHealth.action.runbookSection.includes('.md §'), 'the action names its runbook section');
  }
  const maxSeverity = Math.max(...OBSERVABILITY_DOMAINS.map((domain) => HEALTH_SEVERITY[health.domains[domain].state]));
  group.equal(HEALTH_SEVERITY[health.overall], maxSeverity, 'the composite equals the worst domain severity (worst-of, never masking)');
  group.check(HEALTH_SEVERITY[health.overall] >= HEALTH_SEVERITY.degraded, 'the composite reflects the injected degradation');
  group.note(
    `health:overall=${health.overall}:unknown=${unknownHealth.state}:worstDomains=${health.worstDomains.length}`,
  );

  group.scenario('the drill log is the verification transcript (self-check)');
  group.check(proofRecords.length >= 10, 'the JSONL transcript is being emitted (one record per proof scenario)');
  const recordedGroups = new Set([...proofRecords.map((r) => r.group), ...groupResults.map((r) => r.group)]);
  // The prior nine groups must already be recorded; this group's own records
  // follow through the identical emission path when it completes.
  for (const name of PROOF_GROUPS.filter((candidate) => candidate !== group.name)) {
    group.check(recordedGroups.has(name), `the transcript records group ${name}`);
  }
  group.check(
    groupResults.every((r) => r.result === 'PASS'),
    'every completed group is recorded PASS so far (fail-closed discipline holds)',
  );
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

noteStderr(`${HARNESS_NAME}: proving the release readiness dimensions (10 groups, fail-closed)`);

const rigDir = tempDir('rig');
const rig = openRigStore(rigDir);
let releaseRecordRef = null;
let recordsSnapshot = null;

const groupRunners = [
  ['proof:release-identity', proveReleaseIdentity],
  ['proof:protocol-integration', proveProtocolIntegration],
  ['proof:ui-integration', proveUiIntegration],
  ['proof:failure-injection', (group) => proveFailureInjection(group, rig)],
  ['proof:scaling-behavior', proveScalingBehavior],
  ['proof:config-secret-safety', (group) => proveConfigSecretSafety(group, releaseRecordRef)],
  ['proof:backup-restore-queue-recovery', proveBackupRestoreQueueRecovery],
  ['proof:unknown-reconciliation', (group) => proveUnknownReconciliation(group, rig)],
  ['proof:external-effect-safety', (group) => proveExternalEffectSafety(group, rig, releaseRecordRef)],
  ['proof:rollback-observability', (group) => proveRollbackObservability(group, rig, releaseRecordRef, recordsSnapshot)],
];

const groupTimings = [];
const groupLedgers = [];
for (const [name, runner] of groupRunners) {
  const started = Number(process.hrtime.bigint() / 1000000n);
  const group = makeProofGroup(name);
  noteStderr(`── proof group: ${name} ──`);
  let groupError = null;
  try {
    if (name === 'proof:release-identity') {
      recordsSnapshot = readRecords();
      releaseRecordRef = await runner(group);
    } else {
      await runner(group);
    }
  } catch (error) {
    groupError = error;
  }
  const wallMs = Number(process.hrtime.bigint() / 1000000n) - started;
  const { scenarios, assertions } = group.counts();
  const result = groupError === null ? 'PASS' : 'FAIL';
  const record = { type: 'proof-group', group: name, scenarios, assertions, result };
  groupResults.push(record);
  groupLedgers.push(group);
  groupTimings.push({ type: 'proof-timing', group: name, wall_ms: wallMs });
  noteStderr(JSON.stringify({ type: 'proof-timing', group: name, wall_ms: wallMs }));
  if (groupError !== null) {
    failure = failure ?? groupError;
    noteStderr(`${name}: FAILED — ${groupError.message}`);
  } else {
    noteStderr(`${name}: PASS (${scenarios} scenarios / ${assertions} assertions / ${wallMs}ms)`);
  }
  // Per-scenario stdout records (deterministic): the group's notes are the
  // scenario ledger; emit one record per scenario in order.
  for (const note of group.notes()) {
    if (typeof note === 'string' && note.startsWith('#')) {
      const scenarioRecord = { type: 'proof-scenario', group: name, name: note.replace(/^#\d+ /, ''), assertions: null, result };
      proofRecords.push(scenarioRecord);
      emit(scenarioRecord);
    }
  }
  emit(record);
}

// Stop-condition latching for failed groups: a group that failed leaves
// its stop conditions UNVERIFIED — fail-closed (the run cannot go green).
const groupOwnership = {
  'proof:failure-injection': ['unsafe external retry'],
  'proof:external-effect-safety': ['unsafe external retry'],
  'proof:config-secret-safety': ['environment crossing', 'configuration ambiguity'],
  'proof:backup-restore-queue-recovery': ['missing recovery path'],
  'proof:unknown-reconciliation': ['unreconciled UNKNOWN'],
  'proof:protocol-integration': ['unexplained authority bypass'],
};
if (failure !== null) {
  for (const [groupName, conditions] of Object.entries(groupOwnership)) {
    const groupFailed = groupResults.find((r) => r.group === groupName)?.result === 'FAIL';
    if (groupFailed) {
      for (const id of conditions) {
        const entry = stopConditionRegistry.get(id);
        if (entry.status !== 'triggered') {
          entry.status = 'unverified (group failed)';
          entry.where = groupName;
          entry.detail = 'the owning proof group FAILED — its stop condition cannot be cleared (fail-closed)';
        }
      }
    }
  }
}

// The rig store closes AFTER the observability group read it.
try {
  rig.close();
} catch {
  // best effort
}
for (const dir of tempDirs) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

// ---------------------------------------------------------------------------
// The report (stdout — byte-deterministic; timing lives on stderr only)
// ---------------------------------------------------------------------------

const scenariosTotal = groupResults.reduce((sum, r) => sum + r.scenarios, 0);
const stopTriggered = [...stopConditionRegistry.values()].filter(
  (entry) => entry.status === 'triggered' || entry.status.startsWith('unverified'),
).length;

process.stdout.write('\nDEP-008 production readiness proof\n');
process.stdout.write('='.repeat(78) + '\n');
const header = ['proof group', 'scenarios', 'assertions', 'result'];
process.stdout.write(header.map((cell) => String(cell).padEnd(36)).join('') + '\n');
process.stdout.write('-'.repeat(78) + '\n');
for (const row of groupResults) {
  const line = [row.group, String(row.scenarios), String(row.assertions), row.result];
  process.stdout.write(line.map((cell) => String(cell).padEnd(36)).join('') + '\n');
}
process.stdout.write('-'.repeat(78) + '\n');
process.stdout.write(
  `TOTAL: ${scenariosTotal} scenarios / ${liveAssertions} assertions / ${
    failure === null && stopTriggered === 0 ? 'PASS' : 'FAIL'
  }\n`,
);

process.stdout.write('\nProof evidence notes (deterministic — timing lives on stderr only)\n');
process.stdout.write('-'.repeat(78) + '\n');
for (const ledger of groupLedgers) {
  process.stdout.write(`${ledger.name}:\n`);
  for (const note of ledger.notes()) {
    process.stdout.write(`  ${note}\n`);
  }
}

process.stdout.write('\nStop-condition audit (the work order alarm system)\n');
process.stdout.write('-'.repeat(78) + '\n');
for (const id of STOP_CONDITIONS) {
  const entry = stopConditionRegistry.get(id);
  const verdict =
    entry.status === 'not-triggered'
      ? 'NOT TRIGGERED'
      : entry.status === 'triggered'
        ? 'TRIGGERED (STOP)'
        : 'UNVERIFIED (STOP)';
  process.stdout.write(`${id.padEnd(28)} ${verdict}\n`);
  process.stdout.write(`  checked: ${entry.where || '(none)'}\n`);
}
process.stdout.write('-'.repeat(78) + '\n');

emit({
  type: 'proof-verdict',
  passed: failure === null && stopTriggered === 0,
  groups_total: groupResults.length,
  groups_failed: groupResults.filter((r) => r.result === 'FAIL').length,
  scenarios_total: scenariosTotal,
  assertions_total: liveAssertions,
  stop_conditions_triggered: stopTriggered,
  release_record_id: releaseRecordRef?.record_id ?? null,
  release_revision: releaseRecordRef?.revision.commit_sha ?? null,
  harness: HARNESS_NAME,
});

if (failure !== null || stopTriggered !== 0) {
  if (failure !== null) {
    noteStderr(`${HARNESS_NAME}: FAILED — ${failure.message}`);
  }
  process.exit(1);
}
noteStderr(`${HARNESS_NAME}: all proof groups green; all stop conditions NOT TRIGGERED.`);
process.stdout.write('\nDEP-008 production readiness proof: all groups green (sandbox evidence — production readiness is never inferred from it; F8).\n');
process.exit(0);
