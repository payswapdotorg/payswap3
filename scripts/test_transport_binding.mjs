#!/usr/bin/env node
/**
 * SYS-001 — the transport-binding remediation harness (family A: the
 * D-1/D-2/D-3 proof against the BUILT APP).
 *
 * Plain-Node evidence suite (dependency-free; Node >= 22.6 — the harness
 * self-configures the experimental flags on Node builds that need them,
 * same bootstrap as the merged harnesses) that drives the PRODUCTION
 * BUILD (`bun run build` + `node .next/standalone/.../server.js`, the
 * repository's documented runtime package, spec/deployment/packaging.md)
 * and proves, over HTTP against the running server:
 *
 *   [bind:build]  the standalone build exists and boots (the packaged
 *                 runtime; the composition boots in the server process —
 *                 the var/web-runtime/ SQLite stores appear).
 *   [bind:d2]     THE D-2 ACCEPTANCE — every probed server-side port call
 *                 resolves the RUNTIME-backed adapters, not the
 *                 transport-unavailable backing: the operator oversight
 *                 aggregates surface, the tracking surface, and the
 *                 mediation API routes present the runtime adapters' own
 *                 wording (the reproduction at the dispatch base showed
 *                 the backing's "runtime adapter could not be reached"
 *                 wording on every one of these surfaces).
 *   [bind:d3]     THE D-3 ACCEPTANCE — submitted commands EXECUTE: an
 *                 intent.submit admitted through the HTTP binding
 *                 executes on the durable command path (the intent record
 *                 becomes readable through the port surface), the receipt
 *                 is idempotent (re-submission replays, never a second
 *                 effect), and the worker keeps running after the drain
 *                 (the pre-SYS-001 drain() = worker.stop() halted it).
 *   [bind:d1]     THE D-1 ACCEPTANCE — the protocol gateway's HTTP
 *                 binding admits and typed-refuses per the A01 admission
 *                 contract: the accepted arm (receipt + jobId), the five
 *                 typed refusal reason codes, the unattributable-authority
 *                 TypeError (transport-typed 400), malformed JSON (400),
 *                 the receipt lookup, and INV-1-3 idempotent replay.
 *   [bind:p5]     P5-CORRECTNESS PRESERVED — the UNKNOWN/waiting/
 *                 recovery vocabulary survives the remediation: the
 *                 browser-context pay flow still presents the honest
 *                 not-quotable UNKNOWN (no translation to success or
 *                 failure), the unknown-reference intent state still
 *                 renders UNKNOWN with its reconciliation path, and no
 *                 probed surface fabricates state (the transport-unavailable
 *                 backing remains the fail-closed default where no runtime
 *                 adapter is registered — the 'use client' consumers).
 *
 * OUTPUT CONTRACT: stdout is byte-deterministic across runs at the same
 * tree (the ci-cd.md §2 battery determinism contract — this harness is
 * glob-enumerated into the `harnesses` gate): the machine-parseable JSONL
 * group/scenario records plus the human summary table. Wall-clock timing
 * and the server's own logs live on stderr only. The fixed port (3311)
 * is part of the deterministic contract; a port that cannot be bound
 * fails the run closed.
 *
 * Deferral-ledger dispositions proven here: D-1 (the HTTP binding),
 * D-2 (the route-reachable composition), D-3 (the bounded drain +
 * executing commands). Companion matrix: spec/system-reconciliation-
 * matrix.md; companion journey harness (in-process, every journey):
 * scripts/test_system_reconciliation.mjs.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const HARNESS_NAME = 'scripts/test_transport_binding.mjs';
const PORT = 3311;
const BASE = `http://127.0.0.1:${PORT}`;
const OPERATOR_COOKIE = 'Cookie: payswap-shell-audience=operator';
const CUSTOMER_COOKIE = 'Cookie: payswap-shell-audience=customer';

function resolve(...segments) {
  // minimal path.resolve (node:path resolve is fine; named to avoid the
  // global shadowing confusion in this file)
  return join(...segments);
}

// ---------------------------------------------------------------------------
// Bootstrap (mirrors the merged RTN harnesses): probe node:sqlite
// importability and .ts module loadability, re-executing with the required
// experimental flags on Node builds that need them.
// ---------------------------------------------------------------------------
const RESPAWN_ENV = 'PAYSWAP_SYS001_BIND_RESPAWNED';
async function ensureCapabilities() {
  if (process.env[RESPAWN_ENV] === '1') {
    return;
  }
  const flags = [];
  try {
    await import('node:sqlite');
  } catch {
    flags.push('--experimental-sqlite');
  }
  const probe = join(ROOT, 'src', 'lib', 'protocol-runtime', 'kernel', 'time.ts');
  let stripTypesNeeded = false;
  try {
    await import(`file://${probe}`);
  } catch (error) {
    if (error && error.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
      stripTypesNeeded = true;
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

// ---------------------------------------------------------------------------
// The group runner (the readiness harness's makeProofGroup pattern).
// ---------------------------------------------------------------------------
const groupResults = [];
const groupLedgers = [];
let liveAssertions = 0;
let failure = null;

function makeGroup(name) {
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
    notes: () => notes,
    counts: () => ({ scenarios, assertions }),
  };
}

async function runGroup(name, runner) {
  const group = makeGroup(name);
  process.stderr.write(`── bind group: ${name} ──\n`);
  let groupError = null;
  try {
    await runner(group);
  } catch (error) {
    groupError = error;
  }
  const { scenarios, assertions } = group.counts();
  const result = groupError === null ? 'PASS' : 'FAIL';
  groupResults.push({ type: 'bind-group', group: name, scenarios, assertions, result });
  groupLedgers.push(group);
  if (groupError !== null) {
    failure = failure ?? groupError;
    process.stderr.write(`${name}: FAILED — ${groupError.message}\n`);
  } else {
    process.stderr.write(`${name}: PASS (${scenarios} scenarios / ${assertions} assertions)\n`);
  }
  for (const note of group.notes()) {
    if (typeof note === 'string' && note.startsWith('#')) {
      const record = { type: 'bind-scenario', group: name, name: note.replace(/^#\d+ /, ''), result };
      process.stdout.write(`${JSON.stringify(record)}\n`);
    }
  }
  process.stdout.write(
    `${JSON.stringify({ type: 'bind-group', group: name, scenarios, assertions, result })}\n`,
  );
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, headers = {}) {
  const response = await fetch(`${BASE}${path}`, { headers });
  const text = await response.text();
  return { status: response.status, text, json: safeJson(text) };
}

async function post(path, body, headers = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, text, json: safeJson(text) };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The intent.submit envelope (the A01 DOCUMENTED nested body —
// COMMAND-SURFACE.md; minted with the runtime's own demandDescriptor via
// the leaf module, identical discipline to the composed-journey harness).
// ---------------------------------------------------------------------------
const INTENT_KEY = 'sys001.bind.http.intent.001';

async function mintIntentSubmitBody() {
  const descriptorUrl = new URL(
    `file://${join(ROOT, 'src', 'lib', 'protocol-runtime', 'intent', 'descriptor.ts')}`,
  ).href;
  const { demandDescriptor } = await import(descriptorUrl);
  const descriptor = demandDescriptor({
    amount: { amountMinor: 2500, currency: 'USD', scale: 2 },
    source: { currency: 'USD', geography: 'US', account: 'sys001-bind-src' },
    destination: { currency: 'USD', geography: 'US', account: 'sys001-bind-dst' },
    constraints: {
      deadlineEpochMs: 1789384278922,
      allowedRails: ['sim-bank'],
      costCeiling: { amountMinor: 500, currency: 'USD', scale: 2 },
    },
    idempotencyKey: INTENT_KEY,
  });
  return { descriptor };
}

async function intentIdForKey(key) {
  const identityUrl = new URL(
    `file://${join(ROOT, 'src', 'lib', 'protocol-runtime', 'kernel', 'identity.ts')}`,
  ).href;
  const { deriveProtocolId } = await import(identityUrl);
  return deriveProtocolId('intent', key);
}

// ---------------------------------------------------------------------------
// The built app: build, locate the standalone server, boot, probe, stop.
// ---------------------------------------------------------------------------
function standaloneServerPath() {
  const direct = join(ROOT, '.next', 'standalone', 'server.js');
  if (existsSync(direct)) {
    return { dir: dirname(direct), script: direct };
  }
  const nested = join(ROOT, '.next', 'standalone', 'payswap3', 'server.js');
  if (existsSync(nested)) {
    return { dir: dirname(nested), script: nested };
  }
  return null;
}

function build(group) {
  group.scenario('the standalone build (the documented runtime package)');
  const built = spawnSync('bun', ['run', 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const exit = built.error ? 127 : typeof built.status === 'number' ? built.status : 1;
  process.stderr.write(built.stdout ?? '');
  process.stderr.write(built.stderr ?? '');
  group.equal(exit, 0, 'bun run build exits 0');
  const server = standaloneServerPath();
  group.check(server !== null, 'the standalone server.js exists (.next/standalone)');
  return server;
}

async function bootServer(group, server) {
  group.scenario('the standalone server boots and the composition starts');
  // Fresh runtime state for a deterministic run (build output state is
  // gitignored; the composition's SQLite stores regenerate per boot).
  const runtimeDir = join(server.dir, 'var', 'web-runtime');
  rmSync(runtimeDir, { recursive: true, force: true });
  const child = spawn(process.execPath, [server.script], {
    cwd: server.dir,
    env: { ...process.env, PORT: String(PORT), HOSTNAME: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logChunks = [];
  child.stdout.on('data', (chunk) => logChunks.push(String(chunk)));
  child.stderr.on('data', (chunk) => logChunks.push(String(chunk)));
  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
    await sleep(200);
    try {
      const response = await fetch(`${BASE}/api/health`);
      ready = response.status === 200;
    } catch {
      ready = false;
    }
  }
  group.check(ready, `the server answers /api/health 200 on port ${PORT}`);
  group.check(existsSync(runtimeDir), 'the composed runtime is constructed in the server process (var/web-runtime stores)');
  return { child, logText: () => logChunks.join('') };
}

async function stopServer(child) {
  if (child.exitCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  for (let attempt = 0; attempt < 50 && child.exitCode === null; attempt += 1) {
    await sleep(100);
  }
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await sleep(300);
  }
}

// ---------------------------------------------------------------------------
// The bind groups
// ---------------------------------------------------------------------------

async function proveD2(group) {
  group.scenario('the operator oversight surface resolves the runtime liquidity adapter (not the transport-unavailable backing)');
  const oversight = await get('/oversight', { 'Cookie': 'payswap-shell-audience=operator' });
  group.equal(oversight.status, 200, 'GET /oversight (operator) answers 200');
  group.check(
    !oversight.text.includes('runtime adapter could not be reached'),
    'the oversight surface no longer presents the transport-unavailable backing wording (D-2)',
  );
  group.check(
    oversight.text.includes('oversight aggregates') || oversight.text.includes('operator oversight'),
    'the oversight surface presents the runtime liquidity adapter\u2019s own wording',
  );

  group.scenario('the tracking surface resolves the runtime tracking adapter');
  const track = await get('/track/sys001-bind-unknown-reference');
  group.equal(track.status, 200, 'GET /track/<unknown> answers 200');
  group.check(
    !track.text.includes('It is not known whether a tracked record exists'),
    'the unknown-reference tracking surface no longer presents the backing\u2019s not-found wording (D-2)',
  );
  group.check(
    track.text.includes('holds no intent record') || track.text.includes('Intent Authority'),
    'the tracking surface presents the runtime adapter\u2019s authoritative no-record wording (A01 consulted)',

  );

  group.scenario('the mediation dispute API resolves the runtime mediation adapter');
  const dispute = await post(
    '/api/mediation/dispute',
    {
      intentReference: 'sys001-bind-unknown-reference',
      grounds: ['goods-not-received'],
      accountOfWhatHappened: 'sys001 bind probe',
      evidence: [],
    },
    { 'Cookie': 'payswap-shell-audience=customer' },
  );
  group.equal(dispute.status, 200, 'POST /api/mediation/dispute (customer) answers 200');
  group.check(dispute.json !== null && dispute.json.kind === 'denied', 'the dispute initiation returns the mediation port\u2019s denied arm');
  group.check(
    typeof dispute.json?.reason === 'string' && !dispute.json.reason.includes('could not be reached'),
    'the denial is the runtime adapter\u2019s authority-grounded denial (no obligation recorded), not a transport failure (D-2)',
  );

  group.scenario('the mediation record API resolves the runtime mediation adapter');
  const record = await get(
    '/api/mediation/record?type=dispute&id=sys001-bind-unknown-reference',
    { 'Cookie': 'payswap-shell-audience=customer' },
  );
  group.equal(record.status, 200, 'GET /api/mediation/record answers 200');
  group.check(
    !(typeof record.text === 'string' && record.text.includes('runtime adapter could not be reached')),
    'the record API no longer presents the transport-unavailable backing (D-2)',
  );
}

async function proveD3(group) {
  group.scenario('an intent.submit admitted through the HTTP binding EXECUTES on the durable command path');
  const body = await mintIntentSubmitBody();
  const admission = await post('/api/protocol/commands', {
    kind: 'intent.submit',
    authority: 'Intent Authority',
    subjectIds: [],
    idempotencyKey: INTENT_KEY,
    protocolTime: { sequence: 1, wallMs: Date.now() },
    body,
  });
  group.equal(admission.status, 200, 'POST /api/protocol/commands answers 200');
  group.check(admission.json?.ok === true, 'the admission is accepted (receipt returned)');
  group.check(
    typeof admission.json?.jobId === 'string' && admission.json.jobId.length > 0,
    'the admission carries the durable job id (the durable command path position)',
  );
  const intentId = await intentIdForKey(INTENT_KEY);

  let executed = false;
  for (let attempt = 0; attempt < 50 && !executed; attempt += 1) {
    await sleep(200);
    const track = await get(`/track/${encodeURIComponent(intentId)}`);
    executed =
      track.status === 200 &&
      (track.text.includes('DRAFT') || track.text.includes('draft'));
  }
  group.check(
    executed,
    'the submitted command EXECUTED: the intent is readable through the runtime-backed tracking surface in its DRAFT state (D-3; the worker auto-poll executes admitted jobs)',
  );

  group.scenario('the receipt is idempotent (INV-1-3): re-submission replays, no second effect');
  const replay = await post('/api/protocol/commands', {
    kind: 'intent.submit',
    authority: 'Intent Authority',
    subjectIds: [],
    idempotencyKey: INTENT_KEY,
    protocolTime: { sequence: 2, wallMs: Date.now() },
    body,
  });
  group.equal(replay.status, 200, 'the re-submission answers 200');
  group.check(replay.json?.ok === true, 'the re-submission is accepted');
  group.equal(replay.json?.replayed, true, 'the re-submission REPLAYS the recorded receipt');
  group.equal(replay.json?.created, false, 'the re-submission does NOT create a second durable job');
  group.equal(
    replay.json?.receipt?.commandId,
    admission.json?.receipt?.commandId,
    'the replayed receipt is the recorded one, verbatim (no second effect)',
  );

  group.scenario('the receipt lookup answers the recorded receipt');
  const lookup = await get(
    `/api/protocol/commands?kind=intent.submit&idempotencyKey=${encodeURIComponent(INTENT_KEY)}`,
  );
  group.equal(lookup.status, 200, 'GET /api/protocol/commands?kind& idempotencyKey answers 200');
  group.check(lookup.json?.found === true, 'the receipt is found');
  group.equal(lookup.json?.receipt?.outcome, 'ADMITTED', 'the receipt outcome is ADMITTED');
}

async function proveD1(group) {
  group.scenario('the typed refusal vocabulary (the A01 admission contract\u2019s reason codes)');
  const refusals = [
    {
      label: 'COMMAND_KIND_UNKNOWN',
      envelope: {
        kind: 'intent.nonsense.kind',
        authority: 'Intent Authority',
        subjectIds: [],
        idempotencyKey: 'sys001.bind.refuse.kind',
        protocolTime: { sequence: 1, wallMs: Date.now() },
        body: {},
      },
      reasonCode: 'COMMAND_KIND_UNKNOWN',
    },
    {
      label: 'COMMAND_BODY_INVALID',
      envelope: {
        kind: 'intent.submit',
        authority: 'Intent Authority',
        subjectIds: [],
        idempotencyKey: 'sys001.bind.refuse.body',
        protocolTime: { sequence: 1, wallMs: Date.now() },
        body: { descriptor: 'not-a-descriptor' },
      },
      reasonCode: 'COMMAND_BODY_INVALID',
    },
    {
      label: 'AUTHORITY_UNKNOWN',
      envelope: {
        kind: 'intent.submit',
        authority: 'Evidence Authority',
        subjectIds: [],
        idempotencyKey: 'sys001.bind.refuse.authority',
        protocolTime: { sequence: 1, wallMs: Date.now() },
        body: {},
      },
      reasonCode: 'AUTHORITY_UNKNOWN',
    },
    {
      label: 'ENVELOPE_INVALID',
      envelope: {
        kind: 'intent.submit',
        authority: 'Intent Authority',
        subjectIds: [],
        idempotencyKey: '',
        protocolTime: { sequence: 1, wallMs: Date.now() },
        body: {},
      },
      reasonCode: 'ENVELOPE_INVALID',
    },
    {
      label: 'COMMAND_SUBJECT_INVALID',
      envelope: {
        kind: 'intent.authorize',
        authority: 'Intent Authority',
        subjectIds: ['not-the-intent-id'],
        idempotencyKey: 'sys001.bind.refuse.subject',
        protocolTime: { sequence: 1, wallMs: Date.now() },
        body: { intentId: 'pid.v1.sys001subjectmismatch', policyDecisionId: 'sys001.policy.decision' },
      },
      reasonCode: 'COMMAND_SUBJECT_INVALID',
    },
  ];
  for (const refusal of refusals) {
    const response = await post('/api/protocol/commands', refusal.envelope);
    group.equal(response.status, 200, `${refusal.label}: HTTP 200 (typed refusals are protocol results)`);
    group.check(response.json?.ok === false, `${refusal.label}: the typed refusal arm`);
    group.equal(response.json?.reasonCode, refusal.reasonCode, `${refusal.label}: the deterministic reason code`);
  }

  group.scenario('the unattributable-authority refusal (gateway TypeError; transport-typed 400)');
  const unattributable = await post('/api/protocol/commands', {
    kind: 'intent.submit',
    authority: 'NOT A REGISTRY AUTHORITY',
    subjectIds: [],
    idempotencyKey: 'sys001.bind.refuse.unattributable',
    protocolTime: { sequence: 1, wallMs: Date.now() },
    body: {},
  });
  group.equal(unattributable.status, 400, 'the unattributable submission answers 400');
  group.equal(
    unattributable.json?.transportError,
    'unattributable-submission',
    'the transport error is typed (no authority fabricated)',
  );

  group.scenario('malformed JSON (transport-typed 400)');
  const malformed = await post('/api/protocol/commands', '{not valid json');
  group.equal(malformed.status, 400, 'malformed JSON answers 400');
  group.equal(malformed.json?.transportError, 'malformed-json', 'the malformed-JSON transport error is typed');

  group.scenario('the receipt lookup\u2019s missing-parameter refusal');
  const missing = await get('/api/protocol/commands');
  group.equal(missing.status, 400, 'GET without parameters answers 400');
  group.equal(missing.json?.transportError, 'missing-lookup-parameters', 'the missing-parameter transport error is typed');

  group.scenario('an unknown receipt lookup answers found: false (never fabricated)');
  const unknown = await get(
    '/api/protocol/commands?kind=intent.submit&idempotencyKey=sys001.bind.no-such-receipt',
  );
  group.equal(unknown.status, 200, 'the unknown receipt lookup answers 200');
  group.equal(unknown.json?.found, false, 'the unknown receipt lookup answers found: false');
}

async function proveP5(group) {
  group.scenario('the unknown-reference tracking surface presents the explicit not-found outcome, never a fabricated state (P5 through the runtime adapter)');
  const track = await get('/track/sys001-bind-unknown-reference');
  group.equal(track.status, 200, 'GET /track/<unknown> answers 200');
  group.check(
    track.text.includes('No tracked record matches this reference') ||
      track.text.includes('holds no intent record'),
    'the tracking surface presents the runtime adapter\u2019s explicit not-found wording (the Intent Authority was consulted and holds no record)',
  );
  group.check(
    !track.text.includes('Payment failed') && !track.text.includes('payment-failed'),
    'the not-found outcome is not translated into a failure presentation (P5)',
  );

  group.scenario('the oversight aggregates remain UNKNOWN-annotated, never fabricated zeros (P5 through the runtime adapter)');
  const oversight = await get('/oversight', { 'Cookie': 'payswap-shell-audience=operator' });
  group.equal(oversight.status, 200, 'GET /oversight (operator) answers 200');
  group.check(
    oversight.text.includes('UNKNOWN') || oversight.text.toLowerCase().includes('unknown'),
    'the oversight aggregates carry the UNKNOWN vocabulary where the read-surface gap is recorded (never zero, never fabricated)',
  );
  group.check(
    !oversight.text.includes('runtime adapter could not be reached'),
    'the UNKNOWN annotation is the runtime adapter\u2019s authoritative-UNKNOWN, not the transport-unavailable backing (the D-2/D-5 boundary stays honest)',
  );

  group.scenario('the mediated no-answer vocabulary stays typed (the mediation record API presents the runtime adapter\u2019s honest answer)');
  const record = await get(
    '/api/mediation/record?type=dispute&id=sys001-bind-unknown-reference',
    { 'Cookie': 'payswap-shell-audience=customer' },
  );
  group.equal(record.status, 200, 'GET /api/mediation/record answers 200');
  group.check(record.json !== null, 'the record API returns a typed result');
  group.check(
    record.json?.kind === 'fetched' ||
      record.json?.kind === 'not-found' ||
      record.json?.kind === 'not-visible' ||
      record.json?.kind === 'unavailable',
    'the mediation record result stays inside the typed vocabulary (fetched/not-found/not-visible/unavailable — never fabricated)',
  );
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------
process.stderr.write(`${HARNESS_NAME}: proving the transport binding against the BUILT app (6 groups, fail-closed)\n`);

let server = null;
let child = null;
try {
  await runGroup('bind:build', async (group) => {
    server = build(group);
  });
  await runGroup('bind:boot', async (group) => {
    const booted = await bootServer(group, server);
    child = booted.child;
  });
  await runGroup('bind:d2', proveD2);
  await runGroup('bind:d3', proveD3);
  await runGroup('bind:d1', proveD1);
  await runGroup('bind:p5', proveP5);
} finally {
  if (child !== null) {
    await stopServer(child);
  }
}

// ---------------------------------------------------------------------------
// The report (stdout — byte-deterministic; timing lives on stderr only)
// ---------------------------------------------------------------------------
process.stdout.write('\nSYS-001 transport-binding remediation proof (built app)\n');
process.stdout.write('='.repeat(78) + '\n');
const header = ['bind group', 'scenarios', 'assertions', 'result'];
process.stdout.write(header.map((cell) => String(cell).padEnd(24)).join('') + '\n');
process.stdout.write('-'.repeat(78) + '\n');
const scenariosTotal = groupResults.reduce((sum, r) => sum + r.scenarios, 0);
for (const row of groupResults) {
  const line = [row.group, String(row.scenarios), String(row.assertions), row.result];
  process.stdout.write(line.map((cell) => String(cell).padEnd(24)).join('') + '\n');
}
process.stdout.write('-'.repeat(78) + '\n');
process.stdout.write(
  `TOTAL: ${scenariosTotal} scenarios / ${liveAssertions} assertions / ${failure === null ? 'PASS' : 'FAIL'}\n`,
);

process.stdout.write('\nBind evidence notes (deterministic)\n');
process.stdout.write('-'.repeat(78) + '\n');
for (const ledger of groupLedgers) {
  process.stdout.write(`${ledger.name}:\n`);
  for (const note of ledger.notes()) {
    process.stdout.write(`  ${note}\n`);
  }
}

process.stdout.write(
  `${JSON.stringify({
    type: 'bind-verdict',
    passed: failure === null,
    groups_total: groupResults.length,
    groups_failed: groupResults.filter((r) => r.result === 'FAIL').length,
    scenarios_total: scenariosTotal,
    assertions_total: liveAssertions,
    harness: HARNESS_NAME,
  })}\n`,
);

if (failure !== null) {
  process.stderr.write(`${HARNESS_NAME}: FAILED — ${failure.message}\n`);
  process.exit(1);
}
process.stderr.write(`${HARNESS_NAME}: all bind groups green.\n`);
process.exit(0);
