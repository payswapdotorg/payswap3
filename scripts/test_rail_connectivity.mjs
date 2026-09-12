#!/usr/bin/env node
/**
 * payswap3 · DEP-005 — The external rail connectivity evidence harness.
 *
 * Plain-Node evidence suite for DEP-005's owned integration evidence (the
 * work order's required evidence: "Timeout/failure tests, UNKNOWN/
 * reconciliation test, credential-isolation proof and adapter
 * observability evidence"), composed over the REAL frozen surfaces per
 * the family's composition order (src/lib/rail-connectivity/index.ts):
 * the typed transport port driven by SCRIPTED IN-PROCESS DOUBLES (never a
 * real provider, never the network — the no-egress discipline), the
 * environment-scoped configuration resolver, the retry/deadline safeguard
 * engine, the adapter-activity observability surface, and — for the
 * composed-seam and durable-journal proofs — the REAL A13 Rail Adapter
 * Authority (RTN-004, over its per-domain persistence) and the REAL DEP-003
 * durable substrate's durable_events journal.
 *
 * Spec sources (binding):
 *   spec/system-work-orders/DEP-005.md — the acceptance matrix:
 *     - "Credentials/configuration are environment-scoped."
 *     - "Timeouts and failures are explicit."
 *     - "External UNKNOWN is never translated to failure or success
 *       without reconciliation."
 *     - "Retries respect existing idempotency rules."
 *     - "Adapter activity is observable and auditable."
 *     - "Sandbox and production rail credentials/hosts cannot
 *       cross-contaminate."
 *   spec/architecture/v0.1/rails-adapters-reconciliation.md lines 42-44
 *     (the three UNKNOWN causes), 63-69 (INV-13-2/13-3), 70-78
 *     (INV-13-4 no guessing; failure semantics), 124-126 + 150-152
 *     (INV-14-1: every UNKNOWN auto-opens exactly one case).
 *   src/lib/rail-connectivity/RAIL-CONNECTIVITY-EVIDENCE.md — the
 *     family's evidence document (the disciplines + the mapping table).
 *
 * Scenarios (see RAIL-CONNECTIVITY-EVIDENCE.md for the full matrix):
 *   0. [test:family-barrel]        the family barrel loads under plain
 *                                  Node; the static discipline scan: no
 *                                  authority/gateway/store/persistence
 *                                  imports in the family source, no
 *                                  network client primitives, no
 *                                  secret-shaped strings.
 *   1. [test:configuration-resolution]
 *                                  the env-scoped resolution happy path +
 *                                  every typed failure class.
 *   2. [test:scope-isolation]      THE credential/host isolation proof
 *                                  (opposite-scope refusal, contamination
 *                                  refusal, binding re-check, no values).
 *   3. [test:timeout-explicitness] the deadline discipline (before-start,
 *                                  in-transport, typed result, A13
 *                                  mapping).
 *   4. [test:failure-taxonomy]     all seven typed reasons +
 *                                  classification + the frozen-vocabulary
 *                                  mapping table.
 *   5. [test:unknown-never-translated]
 *                                  THE UNKNOWN discipline: no
 *                                  retransmission after UNKNOWN;
 *                                  UNKNOWN-class-only mapping; the REAL
 *                                  A13 authority lands UNKNOWN + INV-14-1
 *                                  auto-case (reconciliation engages,
 *                                  never a retry).
 *   6. [test:retry-idempotency]    same-key retransmission, bounded
 *                                  attempts, pure backoff, deadline-aware
 *                                  cutoff, exhaustion, rail-side COLLAPSE
 *                                  (INV-13-3).
 *   7. [test:adapter-observability]
 *                                  the structured activity records, the
 *                                  query axes, the durable journal rows
 *                                  under owner 'rail-connectivity' on the
 *                                  REAL substrate, the no-value audit.
 *   8. [test:composed-journey]     the frozen seam: the REAL A13 authority
 *                                  consumes the connectivity-bound
 *                                  connection (delivered / payload-
 *                                  malformed / timeout paths).
 *   9. [test:determinism]          the whole battery runs twice; the
 *                                  transcripts are identical (GC-1).
 *
 * Node-version note: requires Node.js >= 22.6 (type stripping; node:sqlite
 * only for the durable-journal scenario); the harness self-configures the
 * experimental flags on Node builds that need them (the DEP-004 bootstrap
 * precedent).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FAMILY_DIR = join(ROOT, 'src', 'lib', 'rail-connectivity');
const RUNTIME_DIR = join(ROOT, 'src', 'lib', 'protocol-runtime');
const DURABLE_URL = (name) => pathToFileURL(join(ROOT, 'src', 'lib', 'durable', name)).href;
const MODULE_URL = (domain, name) => pathToFileURL(join(RUNTIME_DIR, domain, name)).href;
const FAMILY_URL = (name) => pathToFileURL(join(FAMILY_DIR, name)).href;

const RESPAWN_ENV = 'PAYSWAP_DEP005_TEST_RESPAWNED';
const tempDirs = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `payswap-dep005-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

/**
 * Bootstrap (the DEP-004 harness precedent): probes .ts module loadability
 * and re-executes with the required experimental flags when needed.
 */
async function ensureCapabilities() {
  if (process.env[RESPAWN_ENV] === '1') {
    return;
  }
  const flags = [];
  try {
    await import(MODULE_URL('kernel', 'time.ts'));
  } catch (error) {
    if (error && error.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
      flags.push('--experimental-strip-types');
    } else {
      throw error;
    }
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
    console.error('type stripping. The DEP-005 harness requires Node.js >= 22.6.');
    process.exit(1);
  }
  process.exit(typeof child.status === 'number' ? child.status : 1);
}

await ensureCapabilities();

// -- module loading (the family + the frozen read-only surfaces) -------------

const family = await import(FAMILY_URL('index.ts'));
const {
  resolveRailConnectivityConfig,
  loadRailConnectivityConfigOrThrow,
  assertRailScopeMatchesRuntime,
  createAdapterActivityLog,
  RAIL_CONNECTIVITY_EVENT_OWNER,
  RAIL_CONNECTIVITY_EVENT_TYPES,
  createConnectivityRailAdapter,
  createConnectivityBoundary,
  transmitWithTransportSafeguards,
  transportBackoffDelayMs,
  decideTransportRetry,
  validateTransmissionRequest,
  mapTransportResultToFrozenOutcome,
  TRANSPORT_FAILURE_CLASSIFICATION,
  IN_PROCESS_SIMULATED_HOST_MARKER,
} = family;

// The frozen rails leaf utilities (value import — the plain-Node leaf
// precedent) for request fixtures the A13 authority can accept.
const { hashRailPayload } = await import(MODULE_URL('rails', 'payload.ts'));
const { money } = await import(MODULE_URL('kernel', 'money.ts'));
const { deriveProtocolId } = await import(MODULE_URL('kernel', 'identity.ts'));

// The REAL A13 authority (RTN-004) for the composed-seam scenarios.
const { openRailsAuthorities } = await import(MODULE_URL('rails', 'runtime.ts'));
const { createEvidenceTestDouble } = await import(MODULE_URL('rails', 'evidence-test-double.ts'));

// The REAL DEP-003 durable substrate (read-only integration) for the
// durable-journal scenario.
const { openDurableDatabase } = await import(DURABLE_URL('db.ts'));
const { recordEvent, listRecentEvents } = await import(DURABLE_URL('events.ts'));

const results = [];
let failure = null;

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** A fixed clock — deterministic transcripts (GC-1). */
function fixedClock(startWallMs) {
  let now = startWallMs;
  return {
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
    set: (ms) => {
      now = ms;
    },
  };
}

const MONEY = money('USD', 1_000, 2);

function transmissionRequestFixture(idempotencyKey, instructionId = 'instr.test-1') {
  const payload = { instructionId, money: MONEY, beneficiary: 'bene-1' };
  return {
    idempotencyKey,
    payload,
    payloadHash: hashRailPayload(payload),
  };
}

/**
 * The scripted transport double — the harness's transport primitive. It is
 * an IN-PROCESS DETERMINISTIC DOUBLE (the no-egress discipline: no
 * network, no real provider), with:
 *   - a per-key script of attempt outcomes (the Nth transmit for a key
 *     resolves to the Nth scripted result; the default is delivery);
 *   - a receive ledger that collapses duplicate (key, payloadHash) —
 *     INV-13-3 — and reports duplicate 'COLLAPSED' on re-delivery;
 *   - a report statement per key;
 *   - full call telemetry (every transmit's request, verbatim) so the
 *     harness can assert the SAME-KEY retransmission identity.
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

      // The rail-side receive: the (key, payloadHash) collapse (INV-13-3).
      let duplicate = 'FIRST';
      const already = received.get(request.idempotencyKey);
      if (already !== undefined) {
        if (already.payloadHash === request.payloadHash) {
          duplicate = 'COLLAPSED';
        } else {
          // Same key, different payload — the rail rejects the reuse.
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
        // SILENCE — INV-13-4: never a guess.
        return {
          outcomeClass: 'UNKNOWN',
          reasonCode: 'SILENCE',
          railReferences: [],
          payloadHash: '',
          reportedAtWallMs: 0,
        };
      }
      const scripted = script[request.idempotencyKey] ?? [];
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
  };
}

const SANDBOX_ENV = {
  PAYSWAP_RAIL_SANDBOX_DEMOBANK_HOST: IN_PROCESS_SIMULATED_HOST_MARKER,
  PAYSWAP_RAIL_SANDBOX_DEMOBANK_TIMEOUT_MS: '5000',
  PAYSWAP_RAIL_SANDBOX_DEMOBANK_CREDENTIAL_REF: 'secret-ref:sandbox-demobank-1',
};

const PRODUCTION_ENV = {
  PAYSWAP_RAIL_PRODUCTION_BANK_A_HOST: 'https://prod-bank-a.example',
  PAYSWAP_RAIL_PRODUCTION_BANK_A_CREDENTIAL_REF: 'secret-ref:prod-bank-a-1',
  PAYSWAP_RAIL_PRODUCTION_BANK_A_TIMEOUT_MS: '15000',
};

function resolveSandbox(extraEnv = {}, rails = [{ railId: 'demobank' }]) {
  return resolveRailConnectivityConfig({
    processEnv: { ...SANDBOX_ENV, ...extraEnv },
    runtimeScope: { scope: 'sandbox' },
    declaredRails: rails,
  });
}

// ---------------------------------------------------------------------------
// 0. [test:family-barrel] — the barrel + the static discipline scan
// ---------------------------------------------------------------------------

async function scenarioFamilyBarrel() {
  const notes = [];
  assert.equal(typeof createConnectivityBoundary, 'function', 'barrel exports the boundary composer');
  assert.equal(typeof resolveRailConnectivityConfig, 'function', 'barrel exports the resolver');
  assert.equal(typeof transmitWithTransportSafeguards, 'function', 'barrel exports the safeguard engine');
  assert.equal(typeof createAdapterActivityLog, 'function', 'barrel exports the activity log');
  notes.push('barrel-loads');

  // The static discipline scan over the family source: the boundary NEVER
  // imports an authority, the gateway, a store or a persistence module;
  // NEVER constructs a network client; and contains no secret-shaped
  // strings (S1-S5).
  const files = readdirSync(FAMILY_DIR).filter((name) => name.endsWith('.ts'));
  assert.ok(files.length >= 5, `the family has its modules on disk (${files.length})`);
  const forbiddenImports = [
    /from\s+'\.\.\/protocol-runtime\/rails\/(authority|store|persistence|reconciliation|runtime|index)\.ts'/,
    /from\s+'\.\.\/protocol-runtime\/gateway\//,
    /from\s+'\.\.\/protocol-runtime\/(transition|hosting)\//,
    /from\s+'\.\.\/durable\/(queue|worker|scheduler)\.ts'/,
  ];
  const forbiddenPrimitives = [
    /(?<![.\w])fetch\s*\(/,
    /globalThis\s*\.\s*fetch/,
    /\bnew\s+(?:WebSocket|net\.Socket|tls\.TLSSocket|http\.ClientRequest|https\.ClientRequest)\b/,
    /\brequire\s*\(\s*['"](node:)?(http|https|net|tls|dgram|dns)['"]\s*\)/,
    /\bfrom\s+['"](node:)?(http|https|net|tls|dgram|dns)['"]\b/,
  ];
  // Secret-shaped patterns (the validator's S1 set + obvious credential
  // assignments).
  const secretPatterns = [
    /ghp_[A-Za-z0-9]{20,}/,
    /sk-[A-Za-z0-9]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /(?:API_KEY|SECRET|PASSWORD|TOKEN)\s*[:=]\s*['"][^'"]{8,}['"]/,
  ];
  for (const name of files) {
    const text = readFileSync(join(FAMILY_DIR, name), 'utf8');
    for (const pattern of forbiddenImports) {
      assert.ok(!pattern.test(text), `${name}: forbidden protocol-surface import (${pattern}) — the boundary never reaches protocol state or the gateway`);
    }
    for (const pattern of forbiddenPrimitives) {
      assert.ok(!pattern.test(text), `${name}: forbidden network primitive (${pattern}) — the no-egress discipline`);
    }
    for (const pattern of secretPatterns) {
      assert.ok(!pattern.test(text), `${name}: secret-shaped string (${pattern}) — S1/S3 violation`);
    }
  }
  notes.push('discipline-scan-clean');
  return notes;
}

// ---------------------------------------------------------------------------
// 1. [test:configuration-resolution]
// ---------------------------------------------------------------------------

function scenarioConfigurationResolution() {
  const notes = [];

  // The happy path: a declared sandbox rail resolves with the explicit
  // timeout and the documented default retry policy.
  const good = resolveSandbox();
  assert.equal(good.ok, true, `sandbox resolution succeeds (${JSON.stringify(good.ok ? null : good.failures)})`);
  const rail = good.rails[0];
  assert.equal(rail.railId, 'demobank');
  assert.equal(rail.scopeTag, 'sandbox');
  assert.equal(rail.hostRef, IN_PROCESS_SIMULATED_HOST_MARKER);
  assert.equal(rail.credentialRef, 'secret-ref:sandbox-demobank-1');
  assert.equal(rail.timeoutDeadlineMs, 5000);
  assert.deepEqual(rail.retry, { maxAttempts: 3, backoffBaseMs: 250, backoffMaxMs: 4000 });
  // Frozen: the resolved configuration is immutable.
  assert.ok(Object.isFrozen(rail), 'resolved rail config is frozen');
  notes.push('happy-path');

  // Every typed failure class, each refusing the start:
  const expectFailure = (resolution, code) => {
    assert.equal(resolution.ok, false, `resolution must fail (${code})`);
    assert.ok(
      resolution.failures.some((f) => f.code === code),
      `failure list carries ${code} (got ${resolution.failures.map((f) => f.code).join(',')})`,
    );
  };
  expectFailure(resolveSandbox({ PAYSWAP_RAIL_SANDBOX_DEMOBANK_HOST: '' }), 'HOST_MISSING');
  expectFailure(
    resolveSandbox({ PAYSWAP_RAIL_SANDBOX_DEMOBANK_HOST: 'https://real.example' }),
    'HOST_MALFORMED',
  );
  expectFailure(resolveSandbox({ PAYSWAP_RAIL_SANDBOX_DEMOBANK_TIMEOUT_MS: '' }), 'TIMEOUT_MISSING');
  expectFailure(resolveSandbox({ PAYSWAP_RAIL_SANDBOX_DEMOBANK_TIMEOUT_MS: 'abc' }), 'TIMEOUT_MALFORMED');
  expectFailure(resolveSandbox({ PAYSWAP_RAIL_SANDBOX_DEMOBANK_TIMEOUT_MS: '-5' }), 'TIMEOUT_MALFORMED');
  expectFailure(
    resolveSandbox({ PAYSWAP_RAIL_SANDBOX_DEMOBANK_CREDENTIAL_REF: 'bad ref! spaces' }),
    'CREDENTIAL_REF_MALFORMED',
  );
  expectFailure(
    resolveSandbox({ PAYSWAP_RAIL_SANDBOX_DEMOBANK_RETRY_MAX_ATTEMPTS: '11' }),
    'RETRY_OUT_OF_BOUND',
  );
  expectFailure(
    resolveSandbox({ PAYSWAP_RAIL_SANDBOX_DEMOBANK_RETRY_MAX_ATTEMPTS: 'x' }),
    'RETRY_MALFORMED',
  );
  expectFailure(
    resolveRailConnectivityConfig({
      processEnv: { ...SANDBOX_ENV },
      runtimeScope: { scope: 'wider' },
      declaredRails: [{ railId: 'demobank' }],
    }),
    'SCOPE_INVALID',
  );
  expectFailure(
    resolveRailConnectivityConfig({
      processEnv: { ...SANDBOX_ENV },
      runtimeScope: { scope: 'sandbox' },
      declaredRails: [{ railId: 'not a valid id!' }],
    }),
    'RAIL_NOT_DECLARED',
  );
  // Production rail without the credential REFERENCE: F6 fail-closed.
  expectFailure(
    resolveRailConnectivityConfig({
      processEnv: {
        PAYSWAP_RAIL_PRODUCTION_BANK_A_HOST: 'https://prod-bank-a.example',
        PAYSWAP_RAIL_PRODUCTION_BANK_A_TIMEOUT_MS: '15000',
      },
      runtimeScope: { scope: 'production' },
      declaredRails: [{ railId: 'bank-a' }],
    }),
    'CREDENTIAL_REF_REQUIRED_FOR_PRODUCTION',
  );
  // The production happy path: host + credential ref + timeout all present.
  const prod = resolveRailConnectivityConfig({
    processEnv: PRODUCTION_ENV,
    runtimeScope: { scope: 'production' },
    declaredRails: [{ railId: 'bank-a' }],
  });
  assert.equal(prod.ok, true, `production resolution succeeds (${JSON.stringify(prod.ok ? null : prod.failures)})`);
  assert.equal(prod.rails[0].scopeTag, 'production');
  assert.equal(prod.rails[0].credentialRef, 'secret-ref:prod-bank-a-1');
  notes.push('typed-failures');

  // The fail-closed loader throws the typed error.
  let threw = null;
  try {
    loadRailConnectivityConfigOrThrow({
      processEnv: {},
      runtimeScope: { scope: 'sandbox' },
      declaredRails: [{ railId: 'demobank' }],
    });
  } catch (error) {
    threw = error;
  }
  assert.ok(threw instanceof Error, 'the fail-closed loader throws');
  assert.equal(threw.name, 'RailConnectivityConfigurationError');
  notes.push('fail-closed-throw');
  return notes;
}

// ---------------------------------------------------------------------------
// 2. [test:scope-isolation] — THE credential/host isolation proof
// ---------------------------------------------------------------------------

function scenarioScopeIsolation() {
  const notes = [];

  // (a) A sandbox process cannot resolve a production-scoped rail: the
  // rail is configured ONLY under the production prefix while the runtime
  // scope is sandbox → SCOPE_MISMATCH (refused, never a fallback).
  const mismatch = resolveRailConnectivityConfig({
    processEnv: PRODUCTION_ENV,
    runtimeScope: { scope: 'sandbox' },
    declaredRails: [{ railId: 'bank-a' }],
  });
  assert.equal(mismatch.ok, false);
  assert.ok(
    mismatch.failures.some((f) => f.code === 'SCOPE_MISMATCH'),
    'the sandbox process refuses the production-scoped rail',
  );
  notes.push('opposite-scope-refused');

  // (b) The mirror: a production process refuses a sandbox-scoped rail.
  const mismatchMirror = resolveRailConnectivityConfig({
    processEnv: SANDBOX_ENV,
    runtimeScope: { scope: 'production' },
    declaredRails: [{ railId: 'demobank' }],
  });
  assert.equal(mismatchMirror.ok, false);
  assert.ok(
    mismatchMirror.failures.some((f) => f.code === 'SCOPE_MISMATCH'),
    'the production process refuses the sandbox-scoped rail',
  );
  notes.push('mirror-refused');

  // (c) A rail configured under BOTH scope prefixes in one process
  // environment: SCOPE_CONTAMINATION — refused regardless of runtime scope.
  const contaminated = resolveRailConnectivityConfig({
    processEnv: {
      ...SANDBOX_ENV,
      ...PRODUCTION_ENV,
      // bank-a configured on BOTH sides at once (sandbox + production
      // hosts in the same process environment):
      PAYSWAP_RAIL_SANDBOX_BANK_A_HOST: 'sandbox:bank-a',
      PAYSWAP_RAIL_SANDBOX_BANK_A_TIMEOUT_MS: '5000',
    },
    runtimeScope: { scope: 'sandbox' },
    declaredRails: [{ railId: 'bank-a' }],
  });
  assert.equal(contaminated.ok, false);
  assert.ok(
    contaminated.failures.some((f) => f.code === 'SCOPE_CONTAMINATION'),
    'both-scope configuration is contamination',
  );
  notes.push('contamination-refused');

  // (d) Every resolved configuration carries the runtime scope tag.
  const sandboxOnly = resolveSandbox();
  assert.ok(sandboxOnly.ok);
  for (const rail of sandboxOnly.rails) {
    assert.equal(rail.scopeTag, 'sandbox');
  }
  const productionOnly = resolveRailConnectivityConfig({
    processEnv: PRODUCTION_ENV,
    runtimeScope: { scope: 'production' },
    declaredRails: [{ railId: 'bank-a' }],
  });
  assert.ok(productionOnly.ok);
  for (const rail of productionOnly.rails) {
    assert.equal(rail.scopeTag, 'production');
  }
  notes.push('scope-tags-correct');

  // (e) The binding-time re-check: a cross-scope binding is refused.
  const crossBind = assertRailScopeMatchesRuntime(productionOnly.rails[0], 'sandbox');
  assert.equal(crossBind.ok, false);
  assert.equal(crossBind.code, 'SCOPE_MISMATCH');
  const sameBind = assertRailScopeMatchesRuntime(sandboxOnly.rails[0], 'sandbox');
  assert.equal(sameBind.ok, true);
  let boundaryThrew = null;
  try {
    createConnectivityBoundary({
      rails: [productionOnly.rails[0]],
      runtimeScope: 'sandbox',
      transportFactory: () => createScriptedTransportDouble(),
      activity: createAdapterActivityLog(),
      clock: () => 0,
    });
  } catch (error) {
    boundaryThrew = error;
  }
  assert.ok(boundaryThrew instanceof TypeError, 'the boundary composer refuses cross-scope binding');
  notes.push('binding-re-check');

  // (f) NO credential VALUES anywhere: the serialized resolved
  // configuration carries only reference names — machine-checked by
  // scanning the serialized form for secret-shaped patterns and for any
  // field that could hold a value.
  const serialized = JSON.stringify({
    sandbox: sandboxOnly.rails,
    production: productionOnly.rails,
  });
  assert.ok(!/ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}/.test(serialized));
  assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(serialized));
  for (const rail of [...sandboxOnly.rails, ...productionOnly.rails]) {
    assert.ok(!('credentialValue' in rail), 'no credential value field exists');
    assert.ok(!('credential' in rail), 'no credential field exists');
    if (rail.credentialRef !== undefined) {
      assert.ok(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(rail.credentialRef), 'the credential field is a reference NAME only');
    }
  }
  notes.push('reference-names-only');
  return notes;
}

// ---------------------------------------------------------------------------
// 3. [test:timeout-explicitness]
// ---------------------------------------------------------------------------

function scenarioTimeoutExplicitness() {
  const notes = [];

  // (a) Deadline already elapsed before the first attempt: the engine
  // resolves the typed timeout WITHOUT issuing any transmission.
  const clock = fixedClock(10_000);
  const neverDelivers = createScriptedTransportDouble();
  const preExpired = transmitWithTransportSafeguards({
    port: neverDelivers,
    request: {
      railId: 'demobank',
      ...transmissionRequestFixture('key.timeout-1'),
      correlation: { instructionId: 'instr.test-1' },
      deadlineWallMs: 9_999,
    },
    policy: { maxAttempts: 3, backoffBaseMs: 250, backoffMaxMs: 4_000 },
    clock: clock.now,
  });
  assert.equal(preExpired.result.kind, 'timeout', 'pre-expired deadline resolves timeout');
  assert.equal(preExpired.result.telemetry.attempts, 0, 'no attempt issued');
  assert.equal(neverDelivers.transmitLog.length, 0, 'the transport was never called');
  assert.equal(preExpired.attempts.length, 0);
  notes.push('pre-expired-timeout');

  // (b) In-transport timeout: the transport scripts a timeout result; the
  // engine returns it immediately (the deadline is exhausted by
  // definition — no retransmission).
  const clock2 = fixedClock(10_000);
  const timeoutRail = createScriptedTransportDouble({
    'key.timeout-2': [
      { kind: 'timeout', deadlineWallMs: 15_000, telemetry: { completedWallMs: 15_000, attempts: 1, latencyMs: 5_000 } },
    ],
  });
  const inTransport = transmitWithTransportSafeguards({
    port: timeoutRail,
    request: {
      railId: 'demobank',
      ...transmissionRequestFixture('key.timeout-2'),
      correlation: { instructionId: 'instr.test-1' },
      deadlineWallMs: 15_000,
    },
    policy: { maxAttempts: 3, backoffBaseMs: 250, backoffMaxMs: 4_000 },
    clock: clock2.now,
  });
  assert.equal(inTransport.result.kind, 'timeout');
  assert.equal(timeoutRail.transmitLog.length, 1, 'a timeout result is returned immediately — never retransmitted');
  notes.push('in-transport-timeout');

  // (c) The A13 mapping: timeout → UNKNOWN with the frozen 'TIMEOUT' code.
  const outcome = mapTransportResultToFrozenOutcome(inTransport.result, 1);
  assert.equal(outcome.class, 'UNKNOWN');
  assert.equal(outcome.reasonCode, 'TIMEOUT');
  assert.ok(outcome.detail.includes('deadline'), 'the detail names the deadline');
  notes.push('a13-mapping');
  return notes;
}

// ---------------------------------------------------------------------------
// 4. [test:failure-taxonomy]
// ---------------------------------------------------------------------------

function scenarioFailureTaxonomy() {
  const notes = [];

  // (a) The classification table: pre-effect failures are the provably
  // no-effect set; only the transient four are retryable; in-flight
  // failures are never retryable.
  const expected = {
    DNS_UNRESOLVED: { phase: 'pre-effect', retryable: true },
    HOST_UNREACHABLE: { phase: 'pre-effect', retryable: true },
    CONNECTION_REFUSED: { phase: 'pre-effect', retryable: true },
    TLS_HANDSHAKE_FAILED: { phase: 'pre-effect', retryable: true },
    AUTH_CREDENTIAL_REJECTED: { phase: 'pre-effect', retryable: false },
    CONNECTION_LOSS_IN_FLIGHT: { phase: 'in-flight', retryable: false },
    RESPONSE_MALFORMED: { phase: 'in-flight', retryable: false },
  };
  for (const [reason, classification] of Object.entries(expected)) {
    assert.deepEqual(
      TRANSPORT_FAILURE_CLASSIFICATION[reason],
      classification,
      `${reason} classification is frozen`,
    );
  }
  notes.push('classification-frozen');

  // (b) A non-retryable pre-effect failure (credential refusal) surfaces
  // immediately — retrying cannot fix configuration (F6).
  const clock = fixedClock(10_000);
  const authRefused = createScriptedTransportDouble({
    'key.auth-1': [
      {
        kind: 'transport-failure',
        reason: 'AUTH_CREDENTIAL_REJECTED',
        detail: 'the credential reference was refused at the door',
        classification: TRANSPORT_FAILURE_CLASSIFICATION['AUTH_CREDENTIAL_REJECTED'],
        telemetry: { completedWallMs: 10_001, attempts: 1, latencyMs: 1 },
      },
    ],
  });
  const refused = transmitWithTransportSafeguards({
    port: authRefused,
    request: {
      railId: 'demobank',
      ...transmissionRequestFixture('key.auth-1'),
      correlation: { instructionId: 'instr.test-1' },
      deadlineWallMs: 20_000,
    },
    policy: { maxAttempts: 3, backoffBaseMs: 250, backoffMaxMs: 4_000 },
    clock: clock.now,
  });
  assert.equal(refused.result.kind, 'transport-failure');
  assert.equal(refused.result.reason, 'AUTH_CREDENTIAL_REJECTED');
  assert.equal(authRefused.transmitLog.length, 1, 'non-retryable failures surface immediately');
  notes.push('non-retryable-surfaces');

  // (c) The frozen-vocabulary-only mapping: EVERY transport result class
  // maps into the A13 outcome with ONLY frozen reason codes.
  const frozenCodes = new Set([
    'PAYLOAD_MALFORMED',
    'RAIL_REJECTED_SUBMISSION',
    'TIMEOUT',
    'CONNECTION_LOSS',
    'AMBIGUOUS_RAIL_RESPONSE',
    'SILENCE',
    'PAYLOAD_HASH_MISMATCH',
  ]);
  const sampleResults = [
    { kind: 'timeout', deadlineWallMs: 1, telemetry: { completedWallMs: 1, attempts: 1, latencyMs: 1 } },
    {
      kind: 'transport-failure',
      reason: 'DNS_UNRESOLVED',
      detail: 'd',
      classification: TRANSPORT_FAILURE_CLASSIFICATION['DNS_UNRESOLVED'],
      telemetry: { completedWallMs: 1, attempts: 1, latencyMs: 1 },
    },
    {
      kind: 'transport-failure',
      reason: 'CONNECTION_LOSS_IN_FLIGHT',
      detail: 'd',
      classification: TRANSPORT_FAILURE_CLASSIFICATION['CONNECTION_LOSS_IN_FLIGHT'],
      telemetry: { completedWallMs: 1, attempts: 1, latencyMs: 1 },
    },
    { kind: 'UNKNOWN', cause: 'AMBIGUOUS_RESPONSE', detail: 'd', telemetry: { completedWallMs: 1, attempts: 1, latencyMs: 1 } },
  ];
  for (const result of sampleResults) {
    const outcome = mapTransportResultToFrozenOutcome(result, 1);
    assert.equal(outcome.class, 'UNKNOWN', `every non-delivered result maps the A13 UNKNOWN class (${result.kind})`);
    assert.ok(frozenCodes.has(outcome.reasonCode), `reason ${outcome.reasonCode} is a frozen A13 code`);
  }
  notes.push('frozen-vocabulary-only');

  // (d) The adapter-local payload validation failure maps REJECTED with
  // the frozen 'PAYLOAD_MALFORMED' — before any transport interaction.
  const tampered = transmissionRequestFixture('key.tamper-1');
  const tamperedOutcome = validateTransmissionRequest({ ...tampered, payloadHash: 'deadbeef' });
  assert.equal(tamperedOutcome.ok, false, 'a tampered hash fails validation');
  notes.push('payload-malformed-rejected');
  return notes;
}

// ---------------------------------------------------------------------------
// 5. [test:unknown-never-translated] — THE UNKNOWN discipline
// ---------------------------------------------------------------------------

async function scenarioUnknownNeverTranslated() {
  const notes = [];

  // (a) The engine NEVER retransmits after an explicit UNKNOWN result: the
  // port's call count stays at 1.
  const clock = fixedClock(10_000);
  const ambiguous = createScriptedTransportDouble({
    'key.unknown-1': [
      { kind: 'UNKNOWN', cause: 'AMBIGUOUS_RESPONSE', detail: 'the rail answered with an unclassifiable body', telemetry: { completedWallMs: 10_002, attempts: 1, latencyMs: 2 } },
    ],
  });
  const unknownRun = transmitWithTransportSafeguards({
    port: ambiguous,
    request: {
      railId: 'demobank',
      ...transmissionRequestFixture('key.unknown-1'),
      correlation: { instructionId: 'instr.unknown-1' },
      deadlineWallMs: 60_000,
    },
    policy: { maxAttempts: 5, backoffBaseMs: 250, backoffMaxMs: 4_000 },
    clock: clock.now,
  });
  assert.equal(unknownRun.result.kind, 'UNKNOWN', 'UNKNOWN surfaces verbatim');
  assert.equal(ambiguous.transmitLog.length, 1, 'never retransmitted after UNKNOWN (the no-blind-retry rule)');
  notes.push('never-retransmitted');

  // (b) The boundary maps UNKNOWN to the A13 UNKNOWN class ONLY — never
  // CONFIRMED, never FAILED, never PENDING.
  const outcome = mapTransportResultToFrozenOutcome(unknownRun.result, 1);
  assert.equal(outcome.class, 'UNKNOWN');
  assert.equal(outcome.reasonCode, 'AMBIGUOUS_RAIL_RESPONSE');
  assert.ok(outcome.detail.includes('A14'), 'the detail names the reconciliation path');
  notes.push('a13-unknown-only');

  // (c) THE COMPOSED PROOF: the REAL A13 authority consumes the
  // connectivity-bound connection; the UNKNOWN lands as the operation's
  // UNKNOWN state and the INV-14-1 auto-case opens — reconciliation
  // engages, and re-submission is refused (GC-2).
  const dbDir = tempDir('unknown');
  const evidence = createEvidenceTestDouble();
  const authorities = openRailsAuthorities(
    { dbPath: join(dbDir, 'rails.sqlite'), migrationsDir: join(RUNTIME_DIR, 'rails', 'migrations') },
    { evidence, wallClock: () => 10_000 },
  );
  const { railAuthority, reconciliation } = authorities;

  const registered = railAuthority.registerAdapter({ railFamily: 'bank', name: 'connectivity-test' });
  assert.equal(registered.ok, true);
  const activate = railAuthority.activateAdapter(registered.value.adapterId);
  assert.equal(activate.ok, true);

  // Authorize FIRST: the A13 authority derives the rail idempotency key
  // from the instruction id (INV-13-3) — the scripted double keys its
  // UNKNOWN script on the AUTHORITY-derived key, so the composed proof
  // exercises the real derivation end-to-end.
  const authorized = railAuthority.authorizeOperation({
    instructionId: 'instr.unknown-1',
    adapterId: registered.value.adapterId,
    payload: { instructionId: 'instr.unknown-1', money: MONEY, beneficiary: 'bene-1' },
  });
  assert.equal(authorized.ok, true, `authorize succeeds (${JSON.stringify(authorized.ok ? null : authorized)})`);
  const unknownKey = authorized.value.idempotencyKey;

  const sandboxConfig = resolveSandbox();
  assert.equal(sandboxConfig.ok, true);
  const activity = createAdapterActivityLog();
  const authorityAmbiguous = createScriptedTransportDouble({
    [unknownKey]: [
      { kind: 'UNKNOWN', cause: 'AMBIGUOUS_RESPONSE', detail: 'the rail answered with an unclassifiable body', telemetry: { completedWallMs: 10_002, attempts: 1, latencyMs: 2 } },
    ],
  });
  const connection = createConnectivityRailAdapter({
    rail: sandboxConfig.rails[0],
    transport: authorityAmbiguous,
    activity,
    clock: clock.now,
    runtimeScope: 'sandbox',
    adapterId: registered.value.adapterId,
  });

  const submitted = railAuthority.submitRailOperation(authorized.value.operationId, connection);
  assert.equal(submitted.ok, true, `the REAL A13 command accepts the connectivity-bound connection (${JSON.stringify(submitted.ok ? null : submitted)})`);
  assert.equal(submitted.value.operation.status, 'UNKNOWN', 'the operation lands UNKNOWN (never translated)');
  assert.equal(submitted.value.submissionReportClass, 'UNKNOWN');
  assert.equal(submitted.value.transmitOutcome.class, 'UNKNOWN');
  assert.equal(submitted.value.transmitOutcome.reasonCode, 'AMBIGUOUS_RAIL_RESPONSE');

  // INV-14-1: exactly one auto-case, opened atomically with the UNKNOWN.
  const autoCase = reconciliation.getCaseByOriginOperation(authorized.value.operationId);
  assert.ok(autoCase !== undefined, 'the A14 reconciliation case auto-opened (INV-14-1)');
  assert.equal(autoCase.status, 'OPEN');
  notes.push('real-a13-unknown-auto-case');

  // GC-2: re-submission of the UNKNOWN operation is refused by the frozen
  // authority — the only exit is reconciliation, never a retry.
  const resubmit = railAuthority.submitRailOperation(authorized.value.operationId, connection);
  assert.equal(resubmit.ok, false);
  assert.equal(resubmit.reasonCode, 'OPERATION_NOT_AUTHORIZED');
  assert.ok(resubmit.detail.includes('re-submission is refused'));
  // And the transport saw exactly ONE transmission for the key through
  // the whole attempted retry.
  assert.equal(
    authorityAmbiguous.transmitLog.filter((r) => r.idempotencyKey === unknownKey).length,
    1,
    'the frozen GC-2 guard blocked the second attempt at the authority',
  );
  notes.push('gc2-refusal');

  // Cleanup: close the rails store.
  authorities.store.close();
  return notes;
}

// ---------------------------------------------------------------------------
// 6. [test:retry-idempotency]
// ---------------------------------------------------------------------------

function scenarioRetryIdempotency() {
  const notes = [];

  // (a) The same-key retransmission: the first attempt fails with a
  // retryable pre-effect failure; the retransmission delivers. BOTH
  // attempts carry the byte-identical request (idempotency key, payload,
  // payload hash — INV-13-3's collapse precondition).
  const clock = fixedClock(10_000);
  const flaky = createScriptedTransportDouble({
    'key.retry-1': [
      {
        kind: 'transport-failure',
        reason: 'CONNECTION_REFUSED',
        detail: 'connection refused before any external effect',
        classification: TRANSPORT_FAILURE_CLASSIFICATION['CONNECTION_REFUSED'],
        telemetry: { completedWallMs: 10_001, attempts: 1, latencyMs: 1 },
      },
    ],
  });
  const retried = transmitWithTransportSafeguards({
    port: flaky,
    request: {
      railId: 'demobank',
      ...transmissionRequestFixture('key.retry-1'),
      correlation: { instructionId: 'instr.retry-1' },
      deadlineWallMs: 60_000,
    },
    policy: { maxAttempts: 3, backoffBaseMs: 250, backoffMaxMs: 4_000 },
    clock: clock.now,
  });
  assert.equal(retried.result.kind, 'delivered-with-report', 'the retransmission delivers');
  assert.equal(flaky.transmitLog.length, 2, 'exactly two attempts (one failure + one retransmission)');
  const [first, second] = flaky.transmitLog;
  assert.equal(first.idempotencyKey, second.idempotencyKey, 'SAME idempotency key on every attempt');
  assert.equal(first.payloadHash, second.payloadHash, 'SAME payload hash on every attempt');
  assert.deepEqual(first.payload, second.payload, 'SAME payload on every attempt');
  assert.equal(retried.result.duplicate, 'COLLAPSED', 'the scripted rail collapsed the retransmitted key (INV-13-3)');
  assert.equal(retried.attempts.length, 2);
  assert.equal(retried.attempts[1].retransmission, true, 'the second attempt is marked a retransmission');
  notes.push('same-key-retransmission');

  // (b) The pure backoff schedule: min(base·2^(n−1), cap).
  const policy = { maxAttempts: 4, backoffBaseMs: 250, backoffMaxMs: 4_000 };
  assert.equal(transportBackoffDelayMs(policy, 1), 250);
  assert.equal(transportBackoffDelayMs(policy, 2), 500);
  assert.equal(transportBackoffDelayMs(policy, 3), 1_000);
  assert.equal(transportBackoffDelayMs(policy, 5), 4_000, 'the cap applies');
  assert.equal(transportBackoffDelayMs(policy, 30), 4_000, 'the cap holds at large exponents');
  notes.push('pure-backoff');

  // (c) The deadline-aware cutoff: a retryable failure whose backoff
  // would begin at/after the deadline does NOT retransmit — the failure
  // surfaces.
  const clock2 = fixedClock(10_000);
  const cut = createScriptedTransportDouble({
    'key.cut-1': [
      {
        kind: 'transport-failure',
        reason: 'DNS_UNRESOLVED',
        detail: 'dns failure before any external effect',
        classification: TRANSPORT_FAILURE_CLASSIFICATION['DNS_UNRESOLVED'],
        telemetry: { completedWallMs: 10_001, attempts: 1, latencyMs: 1 },
      },
    ],
  });
  const cutoff = transmitWithTransportSafeguards({
    port: cut,
    request: {
      railId: 'demobank',
      ...transmissionRequestFixture('key.cut-1'),
      correlation: { instructionId: 'instr.cut-1' },
      // now=10000, backoff for retransmission 1 = 250 → 10250 >= 10240:
      // no deadline room — the failure must surface, never a late attempt.
      deadlineWallMs: 10_240,
    },
    policy: { maxAttempts: 3, backoffBaseMs: 250, backoffMaxMs: 4_000 },
    clock: clock2.now,
  });
  assert.equal(cutoff.result.kind, 'transport-failure', 'the failure surfaces (deadline-aware cutoff)');
  assert.equal(cut.transmitLog.length, 1, 'no retransmission without deadline room');
  notes.push('deadline-cutoff');

  // (d) Bounded exhaustion: every attempt fails retryably; the engine
  // stops at maxAttempts and surfaces the last failure.
  const clock3 = fixedClock(10_000);
  const down = createScriptedTransportDouble({
    'key.down-1': [
      { kind: 'transport-failure', reason: 'DNS_UNRESOLVED', detail: 'down 1', classification: TRANSPORT_FAILURE_CLASSIFICATION['DNS_UNRESOLVED'], telemetry: { completedWallMs: 10_001, attempts: 1, latencyMs: 1 } },
      { kind: 'transport-failure', reason: 'DNS_UNRESOLVED', detail: 'down 2', classification: TRANSPORT_FAILURE_CLASSIFICATION['DNS_UNRESOLVED'], telemetry: { completedWallMs: 10_002, attempts: 2, latencyMs: 1 } },
      { kind: 'transport-failure', reason: 'DNS_UNRESOLVED', detail: 'down 3', classification: TRANSPORT_FAILURE_CLASSIFICATION['DNS_UNRESOLVED'], telemetry: { completedWallMs: 10_003, attempts: 3, latencyMs: 1 } },
      { kind: 'transport-failure', reason: 'DNS_UNRESOLVED', detail: 'down 4 (must never run)', classification: TRANSPORT_FAILURE_CLASSIFICATION['DNS_UNRESOLVED'], telemetry: { completedWallMs: 10_004, attempts: 4, latencyMs: 1 } },
    ],
  });
  const exhausted = transmitWithTransportSafeguards({
    port: down,
    request: {
      railId: 'demobank',
      ...transmissionRequestFixture('key.down-1'),
      correlation: { instructionId: 'instr.down-1' },
      deadlineWallMs: 60_000,
    },
    policy: { maxAttempts: 3, backoffBaseMs: 250, backoffMaxMs: 4_000 },
    clock: clock3.now,
  });
  assert.equal(exhausted.result.kind, 'transport-failure');
  assert.equal(down.transmitLog.length, 3, 'bounded at maxAttempts — the fourth script entry never runs');
  assert.equal(exhausted.result.telemetry.attempts, 3);
  notes.push('bounded-exhaustion');

  // (e) The pure decision function: UNKNOWN never produces a retransmit
  // decision, whatever the budget.
  const unknownDecision = decideTransportRetry({
    result: { kind: 'UNKNOWN', cause: 'OUTCOME_INDETERMINATE', detail: 'd', telemetry: { completedWallMs: 0, attempts: 1, latencyMs: 0 } },
    attemptsUsed: 1,
    policy,
    nowWallMs: 0,
    deadlineWallMs: 1_000_000,
  });
  assert.equal(unknownDecision.action, 'return');
  notes.push('pure-decision');
  return notes;
}

// ---------------------------------------------------------------------------
// 7. [test:adapter-observability]
// ---------------------------------------------------------------------------

function scenarioAdapterObservability() {
  const notes = [];

  // (a) The structured records: a delivered transmission + a retransmitted
  // UNKNOWN + a report fetch produce activity rows with every required
  // field.
  const clock = fixedClock(10_000);
  const activity = createAdapterActivityLog();
  const sandboxConfig = resolveSandbox();
  const transport = createScriptedTransportDouble({
    'key.obs-unknown': [
      { kind: 'UNKNOWN', cause: 'AMBIGUOUS_RESPONSE', detail: 'ambiguous answer', telemetry: { completedWallMs: 10_002, attempts: 1, latencyMs: 2 } },
    ],
  });
  const adapter = createConnectivityRailAdapter({
    rail: sandboxConfig.rails[0],
    transport,
    activity,
    clock: clock.now,
    runtimeScope: 'sandbox',
  });

  // A delivered transmission (with one retryable failure first).
  const deliveredOutcome = adapter.transmit(transmissionRequestFixture('key.obs-delivered'));
  assert.equal(deliveredOutcome.class, 'ACCEPTED');
  // Advance the clock so the window axis has distinct wall times.
  clock.advance(60);
  // An UNKNOWN transmission.
  const unknownOutcome = adapter.transmit(transmissionRequestFixture('key.obs-unknown'));
  assert.equal(unknownOutcome.class, 'UNKNOWN');
  clock.advance(40);
  // A report fetch (silence — a key the rail never received).
  const fetched = adapter.fetchReport('key.obs-silence');
  assert.equal(fetched.outcomeClass, 'UNKNOWN');
  assert.equal(fetched.reasonCode, 'SILENCE');

  const all = activity.all();
  assert.ok(all.length >= 3, `activity rows recorded (${all.length})`);
  for (const record of all) {
    assert.ok(typeof record.railId === 'string' && record.railId.length > 0, 'rail recorded');
    assert.ok(typeof record.idempotencyKey === 'string', 'idempotency key recorded');
    assert.ok(record.outcome, 'outcome recorded');
    assert.ok(Number.isSafeInteger(record.latencyMs), 'latency recorded (integer)');
    assert.ok(typeof record.correlation.instructionId === 'string', 'correlation recorded');
    if (record.outcome === 'transport-failure' || record.outcome === 'retransmitted') {
      assert.ok(record.reasonCode, 'typed failure reason recorded');
    }
  }
  notes.push(`records=${all.length}`);

  // (b) The query axes: by key, by rail, by outcome, by window.
  const byKey = activity.query({ idempotencyKey: 'key.obs-delivered' });
  assert.ok(byKey.length >= 1 && byKey.every((r) => r.idempotencyKey === 'key.obs-delivered'));
  const byRail = activity.query({ railId: 'demobank' });
  assert.ok(byRail.length === all.length, 'the rail axis covers the boundary\'s rails');
  const byOutcome = activity.query({ outcome: 'UNKNOWN' });
  assert.ok(byOutcome.length >= 1 && byOutcome.every((r) => r.outcome === 'UNKNOWN'));
  const byWindow = activity.query({ sinceWallMs: 10_061 });
  assert.ok(byWindow.length >= 1 && byWindow.every((r) => r.wallMs >= 10_061), 'the window axis filters by wall time');
  notes.push('query-axes');

  // (c) The durable journal: bound to the REAL DEP-003 substrate, every
  // consequential event dual-writes one durable_events row under owner
  // 'rail-connectivity'.
  const dbDir = tempDir('audit');
  const database = openDurableDatabase({
    dbPath: join(dbDir, 'durable.sqlite'),
    migrationsDir: join(ROOT, 'deploy', 'migrations'),
  });
  try {
    const durableActivity = createAdapterActivityLog({
      audit: { recordEvent: (type, data, owner, jobId) => recordEvent(database, type, data, owner, jobId) },
    });
    const durableAdapter = createConnectivityRailAdapter({
      rail: sandboxConfig.rails[0],
      transport: createScriptedTransportDouble(),
      activity: durableActivity,
      clock: clock.now,
      runtimeScope: 'sandbox',
    });
    durableActivity.recordConfigurationResolution({ wallMs: 10_000, scopeTag: 'sandbox', rails: sandboxConfig.rails });
    const outcome = durableAdapter.transmit(transmissionRequestFixture('key.obs-durable'));
    assert.equal(outcome.class, 'ACCEPTED');
    durableAdapter.fetchReport('key.obs-durable');

    const rows = listRecentEvents(database, 100).filter((event) => event.owner === RAIL_CONNECTIVITY_EVENT_OWNER);
    assert.ok(rows.length >= 3, `durable rows under the family owner (${rows.length})`);
    const types = new Set(rows.map((row) => row.type));
    assert.ok(types.has(RAIL_CONNECTIVITY_EVENT_TYPES.transmitAttempted) || types.has(RAIL_CONNECTIVITY_EVENT_TYPES.transmitDelivered), 'a transmit event row exists');
    assert.ok(types.has(RAIL_CONNECTIVITY_EVENT_TYPES.reportFetched), 'a report-fetch row exists');
    assert.ok(types.has(RAIL_CONNECTIVITY_EVENT_TYPES.configurationResolved), 'a configuration-resolution row exists');
    // Every durable row's payload carries the structured record fields
    // (rail, key, outcome, latency, correlation).
    for (const row of rows) {
      const record = row.data;
      assert.ok(record && typeof record === 'object');
      assert.ok(typeof record.railId === 'string' || record.rails, 'the durable payload is the structured record');
    }
    notes.push(`durable-rows=${rows.length}`);

    // (d) The no-credential-value audit: the serialized records and the
    // durable payloads contain only reference names — machine-checked.
    const serializedAll = JSON.stringify({ records: durableActivity.all(), durableRows: rows });
    assert.ok(!/ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}/.test(serializedAll), 'no secret-shaped strings in the audit trail');
    assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(serializedAll));
    assert.ok(serializedAll.includes('secret-ref:sandbox-demobank-1') || !serializedAll.includes('credential'), 'only reference names appear');
  } finally {
    database.close();
  }
  notes.push('no-values-audited');
  return notes;
}

// ---------------------------------------------------------------------------
// 8. [test:composed-journey] — the frozen seam, end to end
// ---------------------------------------------------------------------------

async function scenarioComposedJourney() {
  const notes = [];
  const clock = fixedClock(10_000);
  const dbDir = tempDir('journey');
  const evidence = createEvidenceTestDouble();
  const authorities = openRailsAuthorities(
    { dbPath: join(dbDir, 'rails.sqlite'), migrationsDir: join(RUNTIME_DIR, 'rails', 'migrations') },
    { evidence, wallClock: () => 10_000 },
  );
  try {
    const { railAuthority } = authorities;
    const registered = railAuthority.registerAdapter({ railFamily: 'bank', name: 'connectivity-journey' });
    assert.equal(registered.ok, true);
    assert.equal(railAuthority.activateAdapter(registered.value.adapterId).ok, true);

    const sandboxConfig = resolveSandbox();
    const activity = createAdapterActivityLog();

    // (a) The delivered path: the connectivity connection transmits, the
    // A13 command lands the operation PENDING (ACCEPTED → the INV-13-4
    // PENDING mapping), exactly as with the simulated adapter.
    const deliveredTransport = createScriptedTransportDouble();
    const deliveredConnection = createConnectivityRailAdapter({
      rail: sandboxConfig.rails[0],
      transport: deliveredTransport,
      activity,
      clock: clock.now,
      runtimeScope: 'sandbox',
      adapterId: registered.value.adapterId,
    });
    const authorized1 = railAuthority.authorizeOperation({
      instructionId: 'instr.journey-delivered',
      adapterId: registered.value.adapterId,
      payload: { instructionId: 'instr.journey-delivered', money: MONEY, beneficiary: 'bene-1' },
    });
    assert.equal(authorized1.ok, true);
    const submitted1 = railAuthority.submitRailOperation(authorized1.value.operationId, deliveredConnection);
    assert.equal(submitted1.ok, true);
    assert.equal(submitted1.value.operation.status, 'PENDING');
    assert.equal(submitted1.value.submissionReportClass, 'PENDING');
    assert.equal(submitted1.value.transmitOutcome.class, 'ACCEPTED');
    assert.equal(submitted1.value.transmitOutcome.duplicate, 'FIRST');
    notes.push('delivered-pending');

    // (b) The report-driven confirmed path: fetchReport (silence-safe) +
    // recordReport advance PENDING → CONFIRMED through the A13 command
    // surface — the report is evidence, recorded by the authority.
    const envelope = deliveredConnection.fetchReport(authorized1.value.idempotencyKey);
    const reportRecorded = railAuthority.recordReport(authorized1.value.operationId, {
      ...envelope,
      outcomeClass: 'CONFIRMED',
      payloadHash: authorized1.value.payloadHash,
    });
    assert.equal(reportRecorded.ok, true, `the report records (${JSON.stringify(reportRecorded.ok ? null : reportRecorded)})`);
    assert.equal(reportRecorded.value.operation.status, 'CONFIRMED');
    notes.push('report-confirmed');

    // (c) The payload-malformed path: a tampered request is REJECTED
    // before ANY transmission (the frozen simulated-adapter discipline).
    const neverCalled = createScriptedTransportDouble();
    const guardedConnection = createConnectivityRailAdapter({
      rail: sandboxConfig.rails[0],
      transport: neverCalled,
      activity,
      clock: clock.now,
      runtimeScope: 'sandbox',
    });
    const tampered = transmissionRequestFixture('key.journey-tamper');
    const tamperedSubmission = guardedConnection.transmit({ ...tampered, payloadHash: '0'.repeat(64) });
    assert.equal(tamperedSubmission.class, 'REJECTED');
    assert.equal(tamperedSubmission.reasonCode, 'PAYLOAD_MALFORMED');
    assert.equal(neverCalled.transmitLog.length, 0, 'no transmission on a malformed request');
    notes.push('payload-guard');

    // (d) The timeout path through the REAL A13 command: the operation
    // lands UNKNOWN + the INV-14-1 case opens (covered in depth in
    // scenario 5; here the full boundary composition runs it). The script
    // keys on the AUTHORITY-derived idempotency key (authorize first).
    const authorized2 = railAuthority.authorizeOperation({
      instructionId: 'instr.journey-timeout',
      adapterId: registered.value.adapterId,
      payload: { instructionId: 'instr.journey-timeout', money: MONEY, beneficiary: 'bene-1' },
    });
    assert.equal(authorized2.ok, true);
    const timeoutTransport = createScriptedTransportDouble({
      [authorized2.value.idempotencyKey]: [
        { kind: 'timeout', deadlineWallMs: 15_000, telemetry: { completedWallMs: 15_000, attempts: 1, latencyMs: 5_000 } },
      ],
    });
    const timeoutConnection = createConnectivityRailAdapter({
      rail: sandboxConfig.rails[0],
      transport: timeoutTransport,
      activity,
      clock: clock.now,
      runtimeScope: 'sandbox',
      adapterId: registered.value.adapterId,
    });
    const submitted2 = railAuthority.submitRailOperation(authorized2.value.operationId, timeoutConnection);
    assert.equal(submitted2.ok, true);
    assert.equal(submitted2.value.operation.status, 'UNKNOWN');
    assert.equal(submitted2.value.transmitOutcome.reasonCode, 'TIMEOUT');
    const journeyCase = authorities.reconciliation.getCaseByOriginOperation(authorized2.value.operationId);
    assert.ok(journeyCase !== undefined, 'INV-14-1 auto-case on the timeout path');
    notes.push('timeout-unknown-case');

    // (e) The whole-boundary composition: createConnectivityBoundary
    // produces the per-rail map, scope re-checked, activity shared.
    const boundary = createConnectivityBoundary({
      rails: sandboxConfig.rails,
      runtimeScope: 'sandbox',
      transportFactory: () => createScriptedTransportDouble(),
      activity,
      clock: clock.now,
      adapterIds: { demobank: registered.value.adapterId },
    });
    assert.equal(boundary.runtimeScope, 'sandbox');
    assert.ok(boundary.adapters.has('demobank'));
    assert.equal(typeof boundary.adapters.get('demobank').transmit, 'function');
    const boundaryOutcome = boundary.adapters.get('demobank').transmit(transmissionRequestFixture('key.boundary-1'));
    assert.equal(boundaryOutcome.class, 'ACCEPTED');
    notes.push('boundary-composed');
  } finally {
    authorities.store.close();
  }
  return notes;
}

// ---------------------------------------------------------------------------
// The battery
// ---------------------------------------------------------------------------

async function runBattery() {
  const battery = [];
  battery.push(['test:family-barrel', await scenarioFamilyBarrel()]);
  battery.push(['test:configuration-resolution', scenarioConfigurationResolution()]);
  battery.push(['test:scope-isolation', scenarioScopeIsolation()]);
  battery.push(['test:timeout-explicitness', scenarioTimeoutExplicitness()]);
  battery.push(['test:failure-taxonomy', scenarioFailureTaxonomy()]);
  battery.push(['test:unknown-never-translated', await scenarioUnknownNeverTranslated()]);
  battery.push(['test:retry-idempotency', scenarioRetryIdempotency()]);
  battery.push(['test:adapter-observability', scenarioAdapterObservability()]);
  battery.push(['test:composed-journey', await scenarioComposedJourney()]);
  return battery;
}

try {
  // Deterministic transcript: the battery is a pure function of the fixed
  // clocks and the scripted doubles.
  const battery = await runBattery();
  for (const [name, transcript] of battery) {
    results.push([name, transcript]);
  }

  // [test:determinism] — the whole battery runs twice; the transcripts are
  // identical (GC-1 over the connectivity boundary).
  const second = await runBattery();
  const firstTranscript = JSON.stringify(battery.map(([name, notes]) => [name, notes]));
  const secondTranscript = JSON.stringify(second.map(([name, notes]) => [name, notes]));
  assert.equal(secondTranscript, firstTranscript, 'the battery is deterministic');
  results.push(['test:determinism', [`${battery.length}-scenarios:identical`]]);

  console.log('DEP-005 rail-connectivity harness: all checks green.');
  for (const [name, transcript] of results) {
    console.log(`  ${name}: ${transcript.join(' | ')}`);
  }
} catch (error) {
  failure = error;
  console.error('DEP-005 rail-connectivity harness: FAILED.');
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
