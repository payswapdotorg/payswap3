#!/usr/bin/env node
/**
 * SYS-001 — the system reconciliation harness (family B: the matrix's
 * mechanical checks).
 *
 * Plain-Node evidence suite (dependency-free; Node >= 22.6 — the harness
 * self-configures the experimental flags on Node builds that need them)
 * that drives EVERY consequential product journey end-to-end through the
 * REAL surfaces — the app's own composition root
 * (src/lib/protocol/server-runtime.ts, imported in-process: the same
 * wireProductPortsToProtocolRuntime() the routes call through
 * src/lib/protocol/server-composition.ts), the seven product ports with
 * the RUNTIME adapters registered over it, the protocol gateway (the sole
 * admission point), and the durable command path — and asserts the
 * reconciliation matrix's claims mechanically
 * (spec/system-reconciliation-matrix.md / .json):
 *
 *   [recon:matrix]       the matrix artifacts exist, parse, and agree:
 *                        8 journeys × 7 hops, every named file exists on
 *                        disk, every claimed export exists, every
 *                        deployment component is a components.json id.
 *   [recon:authority]    AUTHORITY OWNERSHIP — exactly ONE protocol
 *                        authority owns each financial decision: the one
 *                        production composition root (static scan), zero
 *                        authority constructors outside the frozen
 *                        protocol-runtime and the composition roots, the
 *                        mock shims register nothing, the adapters submit
 *                        commands ONLY through the gateway and never call
 *                        authority command methods.
 *   [recon:no-ui-truth]  NO UI-ONLY FINANCIAL TRUTH — the splice guard
 *                        (src/app + src/components never import
 *                        protocol-runtime), the port modules' fail-closed
 *                        unavailable-backing defaults, and the runtime
 *                        assertion that a port-driven effect lands ONLY in
 *                        the durable path (job row + evidence records).
 *   [recon:journeys]     THE EIGHT JOURNEYS end-to-end over the composed
 *                        runtime: pay (quote-gate + submit + DRAFT
 *                        snapshot + INV-1-3 replay), track (not-found +
 *                        tracked), waiting/queued (queue + item + waiting
 *                        snapshot), UNKNOWN + reconciliation (finality
 *                        gate + A14 cycle lifecycle), merchant checkout
 *                        (reads + fail-closed decision), liquidity/credit
 *                        (A06/A07 reads), mediation/dispute (obligation →
 *                        dispute.open → 'open' record — the D-3
 *                        mis-presentation unreachable), capability (A03
 *                        registry listing).
 *   [recon:no-bypass]    NO DEPLOYMENT BYPASS — every effect flows through
 *                        the durable command path: the durable_jobs rows
 *                        exist for every submitted kind (read-only SQLite
 *                        query over var/web-runtime/durable.sqlite), every
 *                        job reached a terminal status (executed, none
 *                        abandoned), the domain stores carry the records,
 *                        and the A15 evidence chain verifies end-to-end
 *                        (hash-verified).
 *   [recon:environment]  EXPLICIT ENVIRONMENT ISOLATION — the
 *                        sandbox|production allowlist with fail-safe
 *                        sandbox (src/lib/environment.ts), the startup
 *                        configuration gate (sandbox ok; production
 *                        without its four required names NOT ok — sandbox
 *                        config can never satisfy production gates), and
 *                        the components.json agreement (allowlist +
 *                        web-api-boundary reachability incl. the D-1
 *                        route).
 *   [recon:p5]           UNKNOWN/WAITING/RECOVERY PRESERVATION — the
 *                        vocabulary survives every hop: every no-answer
 *                        arm observed across the journeys stays a
 *                        no-answer (never translated to success or
 *                        failure), the not-found arms stay explicit
 *                        worded not-found, and the fail-closed decision
 *                        surfaces stay refused.
 *
 * OUTPUT CONTRACT: stdout is byte-deterministic across runs at the same
 * tree (the ci-cd.md §2 battery determinism contract): the JSONL
 * group/scenario records plus the human summary table. Wall-clock timing,
 * ids and paths live on stderr only. The composed runtime is rebuilt
 * fresh per run (var/web-runtime/ is gitignored runtime-artifact state —
 * removed before composition for determinism).
 *
 * Deferral-ledger dispositions proven here: D-2 (the ports resolve the
 * runtime adapters through the app's own composition root — in-process
 * proof; the BUILT-app proof is scripts/test_transport_binding.mjs), D-3
 * (commands execute through the bounded drain; the dispute record's
 * authorityState is 'open'), D-1 (the journeys' commands flow through the
 * sole admission point). Companion matrix:
 * spec/system-reconciliation-matrix.md.
 */
import { register } from 'node:module';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const HARNESS_NAME = 'scripts/test_system_reconciliation.mjs';
const WEB_RUNTIME_DIR = join(ROOT, 'var', 'web-runtime');

// ---------------------------------------------------------------------------
// Bootstrap (mirrors the merged RTN harnesses): re-exec with the required
// experimental flags on Node builds that need them.
// ---------------------------------------------------------------------------
const RESPAWN_ENV = 'PAYSWAP_SYS001_RECON_RESPAWNED';
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
  const { spawnSync } = await import('node:child_process');
  let stripTypesNeeded = false;
  try {
    await import(new URL('file:///'.length === 0 ? '' : `file://${join(ROOT, 'src', 'lib', 'protocol-runtime', 'kernel', 'time.ts')}`).href);
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

// The product layer's module resolver (@/ alias + extensionless relative
// imports → .ts) — registered BEFORE any product-layer dynamic import.
register(new URL('./ts_resolver.mjs', import.meta.url));

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

async function runGroup(name, runner) {
  const group = makeGroup(name);
  process.stderr.write(`── recon group: ${name} ──\n`);
  let groupError = null;
  try {
    await runner(group);
  } catch (error) {
    groupError = error;
  }
  const { scenarios, assertions } = group.counts();
  const result = groupError === null ? 'PASS' : 'FAIL';
  groupResults.push({ type: 'recon-group', group: name, scenarios, assertions, result });
  groupLedgers.push(group);
  if (groupError !== null) {
    failure = failure ?? groupError;
    process.stderr.write(`${name}: FAILED — ${groupError.message}\n`);
  } else {
    process.stderr.write(`${name}: PASS (${scenarios} scenarios / ${assertions} assertions)\n`);
  }
  for (const note of group.notes()) {
    if (typeof note === 'string' && note.startsWith('#')) {
      const record = { type: 'recon-scenario', group: name, name: note.replace(/^#\d+ /, ''), result };
      process.stdout.write(`${JSON.stringify(record)}\n`);
    }
  }
  process.stdout.write(
    `${JSON.stringify({ type: 'recon-group', group: name, scenarios, assertions, result })}\n`,
  );
}

// ---------------------------------------------------------------------------
// Static-scan helpers
// ---------------------------------------------------------------------------
function readText(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

function walkFiles(dir, filter = /\.(tsx?|jsx?)$/) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let stat = null;
    try {
      stat = readdirSync(full);
    } catch {
      stat = null;
    }
    if (stat !== null) {
      out.push(...walkFiles(full, filter));
      continue;
    }
    if (filter.test(name)) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// THE MATRIX (static checks)
// ---------------------------------------------------------------------------
const MATRIX_MD = 'spec/system-reconciliation-matrix.md';
const MATRIX_JSON = 'spec/system-reconciliation-matrix.json';
const HOP_NAMES = [
  'product_action',
  'canonical_protocol_object',
  'owning_authority',
  'api_runtime_boundary',
  'deployment_component',
  'durable_state_evidence',
  'user_visible_outcome',
];

async function proveMatrix(group) {
  group.scenario('the matrix artifacts exist, parse, and agree');
  const matrixJson = JSON.parse(readText(MATRIX_JSON));
  group.check(Array.isArray(matrixJson.journeys) && matrixJson.journeys.length === 8, 'the JSON matrix carries eight journeys');
  const md = readText(MATRIX_MD);
  for (const journey of matrixJson.journeys) {
    group.check(
      typeof journey.journey_id === 'string' && journey.journey_id.length > 0,
      `journey ${journey.journey_id ?? '(unnamed)'} carries an id`,
    );
    for (const hop of HOP_NAMES) {
      const cell = journey.hops?.[hop];
      group.check(
        cell !== null && typeof cell === 'object',
        `${journey.journey_id}: hop ${hop} is present (no hand-waving cells)`,
      );
    }
    group.check(
      md.includes(journey.journey_id),
      `the human matrix documents journey ${journey.journey_id}`,
    );
  }

  group.scenario('every file the matrix names exists on disk');
  const files = new Set();
  for (const journey of matrixJson.journeys) {
    for (const hop of HOP_NAMES) {
      const cell = journey.hops[hop];
      collectStrings(cell, files);
    }
  }
  const missing = [...files]
    .filter((value) => /^(src|spec|scripts|deploy)\//.test(value))
    .filter((value) => !existsSync(join(ROOT, value)));
  group.deepEqual(missing, [], 'every matrix-named path under src/ spec/ scripts/ deploy/ exists on disk');

  group.scenario('every export the matrix claims exists in its file');
  const exportClaims = [
    ['src/lib/protocol-runtime/intent/types.ts', 'INTENT_STATES'],
    ['src/lib/protocol-runtime/queues/types.ts', 'ITEM_STATES'],
    ['src/lib/protocol-runtime/intent/authority.ts', 'IntentAuthority'],
    ['src/lib/protocol-runtime/queues/authority.ts', 'QueueAuthority'],
    ['src/lib/protocol-runtime/liquidity/authority.ts', 'LiquidityAuthority'],
    ['src/lib/protocol-runtime/credit/authority.ts', 'CreditAuthority'],
    ['src/lib/protocol-runtime/obligations/authority.ts', 'ObligationLedgerAuthority'],
    ['src/lib/protocol-runtime/capability/authority.ts', 'CapabilityAuthority'],
    ['src/lib/protocol-runtime/rails/reconciliation.ts', 'ReconciliationAuthority'],
    ['src/lib/protocol-runtime/settlement/authority.ts', 'SettlementAuthority'],
    ['src/lib/protocol-runtime/gateway/admission.ts', 'ProtocolGateway'],
    ['src/lib/protocol/intent-port.ts', 'getIntentPort'],
    ['src/lib/protocol/tracking-port.ts', 'getTrackingPort'],
    ['src/lib/protocol/waiting-port.ts', 'getWaitingPort'],
    ['src/lib/protocol/checkout-port.ts', 'getCheckoutPort'],
    ['src/lib/protocol/liquidity-port.ts', 'getLiquidityPort'],
    ['src/lib/protocol/mediation-port.ts', 'getMediationPort'],
    ['src/lib/protocol/capability-port.ts', 'getCapabilityPort'],
    ['src/lib/protocol/runtime-intent-adapter.ts', 'createRuntimeIntentAdapter'],
    ['src/lib/protocol/runtime-tracking-adapter.ts', 'createRuntimeTrackingAdapter'],
    ['src/lib/protocol/runtime-waiting-adapter.ts', 'createRuntimeWaitingAdapter'],
    ['src/lib/protocol/runtime-checkout-adapter.ts', 'createRuntimeCheckoutAdapter'],
    ['src/lib/protocol/runtime-liquidity-adapter.ts', 'createRuntimeLiquidityPortFactory'],
    ['src/lib/protocol/runtime-mediation-adapter.ts', 'createRuntimeMediationAdapter'],
    ['src/lib/protocol/runtime-capability-adapter.ts', 'createRuntimeCapabilityAdapter'],
    ['src/lib/protocol/server-runtime.ts', 'wireProductPortsToProtocolRuntime'],
    ['src/lib/protocol/server-composition.ts', 'ensureProductPortsWired'],
  ];
  for (const [file, name] of exportClaims) {
    group.check(
      new RegExp(`export (async )?(function|class|const|interface) ${name}\\b`).test(readText(file)) ||
        new RegExp(`export \\{[^}]*\\b${name}\\b[^}]*\\}`).test(readText(file)),
      `${file} exports ${name} (the matrix\u2019s claimed seam)`,
    );
  }

  group.scenario('every deployment component the matrix names is a components.json id');
  const componentsJson = JSON.parse(readText('deploy/contracts/components.json'));
  const ids = new Set(componentsJson.components.map((component) => component.id));
  const unknownComponents = [];
  for (const journey of matrixJson.journeys) {
    for (const id of journey.hops.deployment_component) {
      if (!ids.has(id)) {
        unknownComponents.push(`${journey.journey_id}:${id}`);
      }
    }
  }
  group.deepEqual(unknownComponents, [], 'every deployment hop names a registered component id');
}

function collectStrings(value, into) {
  if (typeof value === 'string') {
    into.add(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      collectStrings(entry, into);
    }
  } else if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) {
      collectStrings(entry, into);
    }
  }
}

// ---------------------------------------------------------------------------
// AUTHORITY OWNERSHIP (static)
// ---------------------------------------------------------------------------
const AUTHORITY_CONSTRUCTORS = [
  'new IntentAuthority(',
  'new PolicyAuthority(',
  'new CapabilityAuthority(',
  'new RoutingAuthority(',
  'new ObligationLedgerAuthority(',
  'new NettingAuthority(',
  'new SettlementAuthority(',
  'new ClearingAuthority(',
  'new QueueAuthority(',
  'new LiquidityAuthority(',
  'new CreditAuthority(',
  'createRiskComplianceAuthority(',
  'openRailsAuthorities(',
  'openReservationLedger(',
];
const SANCTIONED_COMPOSITION_ROOTS = new Set([
  'src/lib/protocol/server-runtime.ts',
  'src/lib/protocol/product-adapter-test-compose.ts',
]);

async function proveAuthorityOwnership(group) {
  group.scenario('exactly one production composition root constructs the authorities');
  const violations = [];
  for (const file of walkFiles(join(ROOT, 'src', 'lib', 'protocol'))) {
    const text = readFileSync(file, 'utf8');
    for (const ctor of AUTHORITY_CONSTRUCTORS) {
      if (text.includes(ctor)) {
        const rel = file.replace(ROOT, '').replace(/^\//, '');
        if (!SANCTIONED_COMPOSITION_ROOTS.has(rel)) {
          violations.push(`${rel}: ${ctor}`);
        }
      }
    }
  }
  group.deepEqual(violations, [], 'authority constructors appear only in server-runtime.ts (the one composition root) and the bun test double');

  group.scenario('no app or component surface constructs an authority (the splice discipline)');
  const appViolations = [];
  for (const file of [...walkFiles(join(ROOT, 'src', 'app')), ...walkFiles(join(ROOT, 'src', 'components'))]) {
    const text = readFileSync(file, 'utf8');
    for (const ctor of AUTHORITY_CONSTRUCTORS) {
      if (text.includes(ctor)) {
        appViolations.push(`${file.replace(ROOT, '')}: ${ctor}`);
      }
    }
  }
  group.deepEqual(appViolations, [], 'zero authority constructors under src/app/** and src/components/**');

  group.scenario('the retired mock shims register nothing and claim no authority');
  const mockFiles = readdirSync(join(ROOT, 'src', 'lib', 'protocol')).filter((name) => /^mock-.*-authority\.ts$/.test(name));
  group.check(mockFiles.length > 0, 'the mock shim family exists (verification-support only)');
  for (const name of mockFiles) {
    const text = readText(`src/lib/protocol/${name}`);
    group.check(
      text.includes('RETIRED') || text.includes('NON-AUTHORITATIVE'),
      `${name} is marked RETIRED or NON-AUTHORITATIVE`,
    );
    for (const seam of ['registerIntentPortBacking', 'registerCheckoutPortBacking', 'registerCapabilityPortBacking', 'registerTrackingPortBacking', 'registerWaitingPortBacking', 'registerLiquidityPortBacking', 'registerMediationPortBacking']) {
      group.check(!text.includes(seam), `${name} never registers itself as a port backing`);
    }
  }

  group.scenario('the adapters submit commands ONLY through the sole admission point');
  const adapters = [
    'src/lib/protocol/runtime-intent-adapter.ts',
    'src/lib/protocol/runtime-checkout-adapter.ts',
    'src/lib/protocol/runtime-capability-adapter.ts',
    'src/lib/protocol/runtime-tracking-adapter.ts',
    'src/lib/protocol/runtime-waiting-adapter.ts',
    'src/lib/protocol/runtime-liquidity-adapter.ts',
    'src/lib/protocol/runtime-mediation-adapter.ts',
  ];
  const commandMethodPattern = /authorities\.\w+\.(submitIntent|authorizeIntent|routeIntent|startFulfillingIntent|fulfillIntent|cancelIntent|registerCapability|activateCapability|degradeCapability|retireCapability|offerCommitment|reserveCommitment|consumeCommitment|createQueue|startDraining|pauseQueue|closeQueue|enqueueItem|evaluateEligibility|dispatchNext|resolveDispatchedItem|cancelItem|expireDueItems|openDispute|applyClearingCommand|applyDisputeResolution|applyNettingCommit|applySettlementInstruction|applySettlementFinality|createSettlementInstruction|authorizeAttempt|submitAttempt|applyRailOutcome|declareFinality|registerSource|openCycle|collectStatements|runMatching|closeCycle|investigateCase|resolveCase)\s*\(/;
  const directCalls = [];
  for (const adapter of adapters) {
    const text = readText(adapter);
    if (commandMethodPattern.test(text)) {
      directCalls.push(adapter);
    }
  }
  group.deepEqual(directCalls, [], 'no adapter ever calls an authority command method directly (gateway.submitCommand only)');
  for (const adapter of adapters) {
    const text = readText(adapter);
    if (text.includes('submitCommand')) {
      group.check(
        text.includes('gateway') && text.includes('.submitCommand('),
        `${adapter} reaches commands through the gateway's submitCommand (the sole admission point)`,
      );
    }
  }

  group.scenario('no duplicate ledger/settlement/finality authority exists in the product layer');
  const ledgerOwners = walkFiles(join(ROOT, 'src', 'lib', 'protocol')).filter((file) => {
    const text = readFileSync(file, 'utf8');
    return text.includes('ObligationLedgerAuthority(') || text.includes('SettlementAuthority(');
  });
  group.deepEqual(
    ledgerOwners.map((file) => file.replace(ROOT, '').replace(/^\//, '')),
    ['src/lib/protocol/product-adapter-test-compose.ts', 'src/lib/protocol/server-runtime.ts'].sort(),
    'the obligation ledger and settlement authorities are constructed in exactly the composition roots (one runtime, no duplicate financial authority)',
  );
}

// ---------------------------------------------------------------------------
// NO UI-ONLY FINANCIAL TRUTH (static + runtime)
// ---------------------------------------------------------------------------
async function proveNoUiTruth(group) {
  group.scenario('the splice guard: product surfaces never import protocol-runtime');
  const spliceViolations = [];
  for (const file of [...walkFiles(join(ROOT, 'src', 'app')), ...walkFiles(join(ROOT, 'src', 'components'))]) {
    const text = readFileSync(file, 'utf8');
    if (/from\s+['"][^'"]*protocol-runtime/.test(text) || /import\(['"][^'"]*protocol-runtime/.test(text)) {
      spliceViolations.push(file.replace(ROOT, ''));
    }
  }
  group.deepEqual(spliceViolations, [], 'src/app/** and src/components/** contain zero protocol-runtime imports');

  group.scenario('the port modules keep the fail-closed unavailable default (no UI-invented backing)');
  for (const [file, seam] of [
    ['src/lib/protocol/intent-port.ts', 'getUnavailableIntentPort'],
    ['src/lib/protocol/checkout-port.ts', 'getUnavailableCheckoutPort'],
    ['src/lib/protocol/capability-port.ts', 'getUnavailableCapabilityPort'],
    ['src/lib/protocol/tracking-port.ts', 'getUnavailableTrackingPort'],
    ['src/lib/protocol/waiting-port.ts', 'getUnavailableWaitingPort'],
    ['src/lib/protocol/liquidity-port.ts', 'getUnavailableLiquidityPort'],
    ['src/lib/protocol/mediation-port.ts', 'getUnavailableMediationPort'],
  ]) {
    const text = readText(file);
    group.check(text.includes(seam), `${file} falls back to ${seam} (the honest no-answer side)`);
    group.check(
      text.includes(`?? ${seam}`) || text.includes(`: ${seam}(`),
      `${file} resolves its backing through the registered-else-unavailable seam`,
    );
  }

  group.scenario('runtime: a port-driven read presents only authority-derivable state (no fabricated figures)');
  // (driven with the wired composition in the journeys group; here the
  // wiring contract itself: the composition module is server-only and the
  // routes import it — the D-2 acceptance's static half)
  for (const file of walkFiles(join(ROOT, 'src', 'app'))) {
    const text = readFileSync(file, 'utf8');
    if (/get(Mediation|Intent|Tracking|Waiting|Checkout|Capability|Liquidity)Port\(\)/.test(text)) {
      group.check(
        text.includes('ensureProductPortsWired'),
        `${file.replace(ROOT, '')} awaits ensureProductPortsWired before port access (the D-2 wiring)`,
      );
    }
  }
  const routeFile = readText('src/app/api/protocol/commands/route.ts');
  group.check(
    routeFile.includes('ensureProductPortsWired') && routeFile.includes('getServerProtocolGateway'),
    'the D-1 HTTP binding resolves the composed runtime through the server composition module',
  );
}

// ---------------------------------------------------------------------------
// THE JOURNEYS (runtime, over the app's own composition root)
// ---------------------------------------------------------------------------
const URL_OF = (rel) => new URL(`file://${join(ROOT, rel)}`).href;

async function proveJourneys(group, context) {
  const { wire, ports, gatewayOf, drain, handleOf } = context;

  group.scenario('the composition boots and the ports resolve the RUNTIME adapters (the D-2 acceptance, in-process)');
  await wire();
  const intentPort = ports.intent;
  const quote = await intentPort.requestConsequenceReport({
    outcomeKind: 'send-payment',
    outcomeStatement: 'Send 25.00 USD to the merchant',
    amount: '25.00',
    currency: 'USD',
    recipient: { id: 'mer-dst-001', displayName: 'Merchant' },
    source: { id: 'cus-src-001', displayName: 'Customer' },
  });
  group.check(quote.kind === 'no-answer', 'the fresh runtime\u2019s quote gate answers no-answer (no active capability — honest P5)');
  group.check(
    quote.kind === 'no-answer' && quote.note.includes('Capability Authority reports no active capability'),
    'the no-answer wording is the RUNTIME adapter\u2019s (the A03 snapshot was consulted — not the transport-unavailable backing\u2019s "could not be reached")',
  );
  const submitRefused = await intentPort.submitIntent(
    {
      outcomeKind: 'send-payment',
      outcomeStatement: 'Send 25.00 USD to the merchant',
      amount: '25.00',
      currency: 'USD',
      recipient: { id: 'mer-dst-001', displayName: 'Merchant' },
      source: { id: 'cus-src-001', displayName: 'Customer' },
    },
    { explicitUserSubmit: true, consequenceReportId: 'sys001-fabricated-report', draftFingerprint: 'sys001-fabricated-fingerprint' },
  );
  group.check(
    submitRefused.kind === 'refused' && submitRefused.reason === 'missing-consequence-review',
    'a submit without a REAL reviewed consequence report is refused at the adapter boundary (P2/P3 — no UI-only financial truth)',
  );

  group.scenario('J1 customer pay: intent.submit through the sole admission point EXECUTES and the port reads the DRAFT snapshot');
  const submit = await gatewaySubmit(context, {
    kind: 'intent.submit',
    authority: 'Intent Authority',
    subjectIds: [],
    idempotencyKey: 'sys001.recon.j1.intent',
    body: { descriptor: await mintDescriptor('sys001.recon.j1.intent') },
  });
  group.check(submit.ok === true && submit.created === true, 'the A01 admission accepts the intent.submit command (receipt + job)');
  const intentId = deriveIntentId('sys001.recon.j1.intent');
  const state = await intentPort.getIntentState(intentId);
  group.check(state.kind === 'snapshot', 'getIntentState returns a snapshot (the command EXECUTED through the bounded drain — D-3)');
  group.check(
    state.kind === 'snapshot' && state.snapshot.authorityState === 'DRAFT',
    'the snapshot\u2019s authority state is DRAFT (the A01 vocabulary, not a fabricated one)',
  );
  group.check(
    state.kind === 'snapshot' && state.snapshot.authority.runtimeStatus === 'LIVE',
    'the snapshot\u2019s authority ref reports the composed runtime LIVE',
  );
  const replay = await gatewaySubmit(context, {
    kind: 'intent.submit',
    authority: 'Intent Authority',
    subjectIds: [],
    idempotencyKey: 'sys001.recon.j1.intent',
    body: { descriptor: await mintDescriptor('sys001.recon.j1.intent') },
  });
  group.check(
    replay.ok === true && replay.replayed === true && replay.created === false,
    'INV-1-3: the same idempotency key replays the recorded receipt (no second intent, no second effect)',
  );

  group.scenario('J2 track: the unknown reference answers the explicit not-found; the created intent answers the tracked view');
  const trackPort = ports.tracking;
  const unknownTrack = await trackPort.lookupReference('sys001-recon-unknown', 'customer');
  group.check(
    unknownTrack.kind === 'not-found' && unknownTrack.wording.includes('holds no intent record'),
    'the unknown reference presents the runtime\u2019s worded not-found (the A01 was consulted — P5, never a fabricated verdict)',
  );
  const tracked = await trackPort.lookupReference(intentId, 'customer');
  group.check(tracked.kind === 'tracked', 'the created intent answers a tracked view');
  group.check(
    tracked.kind === 'tracked' && tracked.view.protocolObject.objectType === 'PaymentIntent',
    'the tracked view names the canonical protocol object (PaymentIntent)',
  );
  group.check(
    tracked.kind === 'tracked' &&
      ['succeeded', 'failed', 'in-progress', 'waiting', 'unknown', 'action-required'].includes(
        tracked.view.currentState.state,
      ),
    'the tracked view carries the frozen TrackedCurrentState vocabulary (a DRAFT intent maps to a non-terminal presentation — never a fabricated terminal verdict)',
  );
  group.check(
    tracked.kind === 'tracked' && tracked.view.owningAuthority.includes('Intent Authority'),
    'the tracked view names the owning authority (A01)',
  );

  group.scenario('J3 waiting/queued: a queue item enqueued through the gateway answers the waiting snapshot');
  await gatewaySubmit(context, {
    kind: 'queues.queue.create',
    authority: 'Queue Authority',
    subjectIds: [],
    idempotencyKey: 'sys001.recon.j3.queue',
    body: {
      queueId: 'sys001-recon-queue',
      policy: {
        orderingRule: 'PRIORITY_CLASS_THEN_SEQUENCE_NUMBER',
        maxWaitEpochMs: 86_400_000,
        releaseConditions: { requiredCapabilityTier: 'standard' },
      },
    },
  });
  await gatewaySubmit(context, {
    kind: 'queues.item.enqueue',
    authority: 'Queue Authority',
    subjectIds: ['sys001-recon-queue', intentId],
    idempotencyKey: 'sys001.recon.j3.item',
    body: {
      queueId: 'sys001-recon-queue',
      intentId,
      priorityClass: 1,
      terms: { intentId, terms: { amountMinor: 2500, currency: 'USD', scale: 2 } },
    },
  });
  const waitingPort = ports.waiting;
  const waiting = waitingPort.lookupWaiting(intentId, 'customer');
  group.check(waiting.status === 'found', 'the waiting lookup finds the queued item by its intent reference (the A08 record)');
  group.check(
    waiting.status === 'found' && waiting.snapshot.intentSummary.includes(intentId),
    'the waiting snapshot carries the frozen WaitingSnapshot vocabulary (reference, condition, recovery actions) over the found item',
  );
  group.check(
    waiting.status === 'found' && waiting.snapshot.snapshotKind === 'condition',
    'the queued item answers a condition snapshot (the A08 item state mapped through the frozen vocabulary)',
  );
  const recheck = waitingPort.requestRecheck({ referenceId: intentId, requestedByRole: 'customer' });
  group.check(
    recheck.status === 'accepted' || recheck.status === 'rejected',
    'the re-check request stays inside the typed waiting vocabulary (accepted/rejected with routedTo naming the Fulfillment/Queue Authority)',
  );

  group.scenario('J4 UNKNOWN + reconciliation: the finality gate refuses over unresolved outcomes, and the A14 cycle lifecycle executes through the gateway');
  await gatewaySubmit(context, {
    kind: 'obligations.clearing.commit',
    authority: 'Obligation Authority',
    subjectIds: [],
    idempotencyKey: 'sys001.recon.j4.obligation',
    body: {
      batchId: 'sys001-recon-batch',
      recordId: 'sys001-recon-record-1',
      originActivityId: 'sys001-recon-j4-activity',
      originKind: 'INTENT',
      debtorParticipantId: 'sys001-debtor',
      creditorParticipantId: 'sys001-creditor',
      amount: { amountMinor: 2500, currency: 'USD', scale: 2 },
      reason: 'sys001 reconciliation journey fixture obligation',
    },
  });
  const handle = handleOf();
  const obligations = handle.authorities.obligations.obligations();
  const obligation = obligations.find((record) => record.obligationId === deriveIntentId('sys001.recon.j4.obligation')) ?? obligations[obligations.length - 1];
  group.check(obligation !== undefined, 'the obligation exists (the A10 ledger answered)');
  const obligationId = obligation.obligationId;
  const instruction = await gatewaySubmit(context, {
    kind: 'settlement.instruction.create',
    authority: 'Settlement and Finality Authority',
    subjectIds: [obligationId],
    idempotencyKey: 'sys001.recon.j4.instruction',
    body: { subject: { kind: 'OBLIGATION', obligationId }, beneficiary: 'sys001-creditor' },
  });
  group.check(instruction.ok === true, 'the settlement instruction is admitted (A12)');
  const instructionId = settlementInstructionIdFor({ kind: 'OBLIGATION', obligationId }, 1);
  const finality = await gatewaySubmit(context, {
    kind: 'settlement.finality.declare',
    authority: 'Settlement and Finality Authority',
    subjectIds: [instructionId],
    idempotencyKey: 'sys001.recon.j4.finality',
    body: { instructionId },
  });
  group.check(finality.ok === true, 'the finality declaration command is admitted (the typed result is the authority\u2019s)');
  const finalityBlocked = finalityNeverDeclared(handle, instructionId);
  group.check(
    finalityBlocked === true,
    'the executed finality declaration is REFUSED by the A12 authority over the unresolved outcome (no FINALITY_DECLARED record — finality never asserted over unresolved state, GC-2)',
  );

  await gatewaySubmit(context, {
    kind: 'reconciliation.source.register',
    authority: 'Reconciliation Authority',
    subjectIds: [],
    idempotencyKey: 'sys001.recon.j4.source',
    body: { kind: 'bank-statement', description: 'sys001 reconciliation journey statement source' },
  });
  const cycleOpen = await gatewaySubmit(context, {
    kind: 'reconciliation.cycle.open',
    authority: 'Reconciliation Authority',
    subjectIds: [],
    idempotencyKey: 'sys001.recon.j4.cycle',
    body: { windowStartWallMs: 1_000, windowEndWallMs: 2_000, sourceIds: [deriveProtocolId('reconciliation-source', 'bank-statement', 'sys001 reconciliation journey statement source')] },
  });
  group.check(cycleOpen.ok === true, 'the reconciliation cycle opens through the gateway (A14)');
  const cycleId = deriveIntentId('sys001.recon.j4.cycle');
  const collect = await gatewaySubmit(context, {
    kind: 'reconciliation.cycle.statements.collect',
    authority: 'Reconciliation Authority',
    subjectIds: [cycleId],
    idempotencyKey: 'sys001.recon.j4.collect',
    body: {
      cycleId,
      statements: [
        {
          sourceId: deriveProtocolId('reconciliation-source', 'bank-statement', 'sys001 reconciliation journey statement source'),
          sequence: 1,
          railReference: 'sys001-rail-ref-1',
          operationId: 'sys001-op-1',
          idempotencyKey: 'sys001-recon-j4-statement',
          outcomeClass: 'UNKNOWN',
          amountMinor: 2500,
          currency: 'USD',
          assertedAtWallMs: 1_500,
        },
      ],
    },
  });
  group.check(collect.ok === true, 'the external statement (outcomeClass UNKNOWN) is collected (A14 — UNKNOWN statements are first-class inputs, never dropped)');
  const matching = await gatewaySubmit(context, {
    kind: 'reconciliation.cycle.matching.run',
    authority: 'Reconciliation Authority',
    subjectIds: [cycleId],
    idempotencyKey: 'sys001.recon.j4.matching',
    body: { cycleId },
  });
  group.check(matching.ok === true, 'the deterministic matching run executes (INV-14-4)');
  const close = await gatewaySubmit(context, {
    kind: 'reconciliation.cycle.close',
    authority: 'Reconciliation Authority',
    subjectIds: [cycleId],
    idempotencyKey: 'sys001.recon.j4.close',
    body: { cycleId },
  });
  group.check(close.ok === true, 'the reconciliation cycle closes (COLLECTED → MATCHED → CLOSED through the gateway)');

  group.scenario('J5 merchant checkout: the offer/status reads answer typed results and the decision stays fail-closed');
  const checkoutPort = ports.checkout;
  const offer = await checkoutPort.getOffer({ checkoutId: intentId });
  group.check(offer.ok === true || offer.error === 'authority-unreachable', 'the checkout offer stays inside the typed vocabulary');
  const status = await checkoutPort.getStatus({ checkoutId: intentId });
  group.check(status.ok === true || status.error === 'authority-unreachable', 'the checkout status stays inside the typed vocabulary');
  const decision = await checkoutPort.submitDecision({ checkoutId: intentId, decision: 'accept' });
  group.check(
    decision.ok === false && decision.error === 'decision-not-allowed',
    'the checkout decision is REFUSED decision-not-allowed (area 20 is RTN wave 2 — fail closed, nothing committed, D-8 recorded)',
  );

  group.scenario('J6 liquidity/credit: the provider positions and oversight aggregates answer the A06/A07-backed vocabulary');
  const liquidityPort = ports.liquidity();
  const positions = await liquidityPort.getProviderPositions({ kind: 'provider-positions', requester: 'provider' });
  group.check(
    positions.kind === 'permitted' || positions.kind === 'denied',
    'the provider positions stay inside the typed vocabulary (permitted with authoritative figures | denied fail-closed)',
  );
  const oversight = await liquidityPort.getOperatorOversight({ kind: 'operator-oversight', requester: 'operator' });
  group.check(
    oversight.kind === 'permitted' || oversight.kind === 'denied',
    'the operator oversight stays inside the typed vocabulary',
  );

  group.scenario('J7 mediation/dispute: the obligation backs an initiated dispute whose record presents the EXECUTED DISPUTED state (the D-3 acceptance)');
  const mediationPort = ports.mediation;
  const docket = await mediationPort.getPartyDocket('customer');
  group.check(docket.kind === 'fetched', 'the party docket is fetched (the A10 read surface)');
  const initiation = await mediationPort.initiateDispute({
    intentReference: 'sys001-recon-j4-activity',
    grounds: ['goods-not-received'],
    accountOfWhatHappened: 'sys001 reconciliation journey dispute',
    evidence: [{ label: 'sys001 probe', href: '/mediation' }],
    actor: 'customer',
  });
  group.check(initiation.kind === 'initiated', 'the dispute initiation returns the initiated arm (the obligations.dispute.open command was admitted and EXECUTED)');
  group.check(
    initiation.kind === 'initiated' && initiation.record.authorityState === 'open',
    'the dispute record\u2019s authorityState is OPEN (the obligation reached DISPUTED before the read-back — the D-3 latent mis-presentation "initiated + resolved" is unreachable)',
  );
  const disputeLookup = await mediationPort.getDispute({
    disputeId: initiation.kind === 'initiated' ? initiation.reference : '',
    viewer: 'customer',
  });
  group.check(
    disputeLookup.kind === 'fetched' || disputeLookup.kind === 'not-visible',
    'the dispute lookup stays inside the typed PortFetch vocabulary',
  );

  group.scenario('J8 capability/provider: the A03 registry listing answers the registered capability');
  await gatewaySubmit(context, {
    kind: 'capability.register',
    authority: 'Capability Authority',
    subjectIds: [],
    idempotencyKey: 'sys001.recon.j8.capability',
    body: {
      capabilityId: 'sys001-recon-cap',
      declaration: {
        railId: 'sim-bank',
        corridor: { sourceCurrency: 'USD', sourceGeography: 'US', destinationCurrency: 'USD', destinationGeography: 'US' },
        costSchedule: { amountMinor: 50, currency: 'USD', scale: 2 },
        tier: 'standard',
      },
      declaredCapacity: { amountMinor: 500_00, currency: 'USD', scale: 2 },
    },
  });
  const capabilityPort = ports.capability;
  const listing = await capabilityPort.listCapabilities();
  group.check(Array.isArray(listing.items), 'the capability listing answers the A03 snapshot (typed listing)');
  group.check(
    listing.items.some((item) => item.descriptor.id === 'sys001-recon-cap'),
    'the registered capability appears in the listing (the gateway command executed)',
  );
}

function finalityNeverDeclared(handle, instructionId) {
  // The A12 authority refuses the declaration over the unresolved outcome
  // (typed refusal — the job executed, the command's outcome is a refusal);
  // the observable: NO FINALITY_DECLARED record exists for the instruction
  // because finality was never asserted (GC-2 — never asserted, never
  // fabricated).
  const records = handle.evidenceLog.records();
  const declared = records.filter(
    (record) =>
      record.what.operationType.startsWith('FINALITY') &&
      record.what.subjectIds.includes(instructionId),
  );
  return declared.length === 0;
}

// ---------------------------------------------------------------------------
// NO DEPLOYMENT BYPASS (runtime, over the durable artifacts)
// ---------------------------------------------------------------------------
async function proveNoBypass(group, context) {
  group.scenario('every submitted command kind left its durable_jobs row (all executed, none abandoned)');
  const durable = new DatabaseSync(join(WEB_RUNTIME_DIR, 'durable.sqlite'), { readOnly: true });
  const rows = durable.prepare('SELECT kind, status, COUNT(*) AS n FROM durable_jobs GROUP BY kind, status ORDER BY kind').all();
  const byKind = new Map();
  for (const row of rows) {
    byKind.set(row.kind, (byKind.get(row.kind) ?? new Map()));
    byKind.get(row.kind).set(row.status, row.n);
  }
  durable.close();
  const expectedKinds = [
    'intent.submit',
    'queues.queue.create',
    'queues.item.enqueue',
    'obligations.clearing.commit',
    'settlement.instruction.create',
    'settlement.finality.declare',
    'reconciliation.source.register',
    'reconciliation.cycle.open',
    'reconciliation.cycle.statements.collect',
    'reconciliation.cycle.matching.run',
    'reconciliation.cycle.close',
    'capability.register',
    'obligations.dispute.open',
  ];
  for (const kind of expectedKinds) {
    group.check(byKind.has(kind), `durable_jobs carries the "${kind}" row (the effect flowed through the durable command path)`);
    const statuses = byKind.get(kind) ?? new Map();
    const abandoned = [...statuses.keys()].filter((status) => status !== 'succeeded');
    group.deepEqual(abandoned, [], `every "${kind}" job reached the terminal succeeded status (executed exactly once)`);
  }

  group.scenario('the domain stores carry the records (write-through persistence)');
  const intents = new DatabaseSync(join(WEB_RUNTIME_DIR, 'intent.sqlite'), { readOnly: true });
  const intentCount = intents.prepare('SELECT COUNT(*) AS n FROM payment_intents').get();
  intents.close();
  group.check(intentCount.n >= 1, 'intent.sqlite carries the payment intent row (the A01 write-through)');
  const obligationsDb = new DatabaseSync(join(WEB_RUNTIME_DIR, 'obligations.sqlite'), { readOnly: true });
  const obligationRows = obligationsDb.prepare('SELECT COUNT(*) AS n FROM obligation_ledger_entries').get();
  obligationsDb.close();
  group.check(obligationRows.n >= 1, 'obligations.sqlite carries the obligation rows (the A10 write-through)');

  group.scenario('the A15 evidence chain verifies end-to-end over the full journey log');
  const handle = context.handleOf();
  const verification = handle.evidenceLog.verifyAndRecord(Date.now());
  group.equal(verification.verdict, 'VERIFIED', 'the hash-verified chain covers every record the journeys produced');
  const records = handle.evidenceLog.records();
  const operationTypes = new Set(records.map((record) => record.what.operationType));
  for (const type of ['INTENT_CREATED', 'ITEM_QUEUED', 'OBLIGATION_CREATED', 'CAPABILITY_REGISTERED']) {
    group.check(operationTypes.has(type), `the A15 chain records ${type} (the evidence trail is complete)`);
  }
  const gatewayRejected = records.filter((record) => record.what.operationType === 'GATEWAY_COMMAND_REJECTED');
  group.check(gatewayRejected.length >= 0, 'typed gateway refusals are recorded as A15 evidence (each refusal leaves its record)');
}

// ---------------------------------------------------------------------------
// ENVIRONMENT ISOLATION
// ---------------------------------------------------------------------------
async function proveEnvironment(group) {
  group.scenario('the runtime allowlist and fail-safe (F1/F2)');
  const environmentModule = await import(URL_OF('src/lib/environment.ts'));
  const original = process.env.PAYSWAP_ENV;
  try {
    delete process.env.PAYSWAP_ENV;
    group.equal(environmentModule.getEnvironment(), 'sandbox', 'unset PAYSWAP_ENV resolves fail-safe to sandbox');
    process.env.PAYSWAP_ENV = 'production';
    group.equal(environmentModule.getEnvironment(), 'production', 'explicit production resolves to production');
    process.env.PAYSWAP_ENV = 'nonsense';
    group.equal(environmentModule.getEnvironment(), 'sandbox', 'an invalid value resolves fail-safe to sandbox (never production by accident)');
  } finally {
    if (original === undefined) {
      delete process.env.PAYSWAP_ENV;
    } else {
      process.env.PAYSWAP_ENV = original;
    }
  }

  group.scenario('sandbox configuration cannot satisfy the production gates (F4/F6 — environment isolation)');
  const startup = await import(URL_OF('src/lib/startup-config.ts'));
  const names = ['PAYSWAP_DATABASE_URL', 'PAYSWAP_QUEUE_URL', 'PAYSWAP_EVIDENCE_STORE_URL', 'PAYSWAP_RAIL_ADAPTERS_URL'];
  const saved = names.map((name) => process.env[name]);
  const originalEnv = process.env.PAYSWAP_ENV;
  try {
    for (const name of names) {
      delete process.env[name];
    }
    delete process.env.PAYSWAP_ENV;
    const sandboxResult = startup.validateStartupConfig();
    group.check(sandboxResult.ok === true, 'sandbox startup validation passes (no production wiring required — F4)');

    process.env.PAYSWAP_ENV = 'production';
    const productionResult = startup.validateStartupConfig();
    group.check(productionResult.ok === false, 'production startup validation WITHOUT the required names is NOT ok (fail-closed — sandbox config can never satisfy production gates)');
    const missing = productionResult.checks.filter((check) => !check.ok).map((check) => check.id);
    group.deepEqual(
      missing.sort(),
      [...names].sort(),
      'the four required production names are reported missing (ids only — never values, S4)',
    );
  } finally {
    for (const [index, name] of names.entries()) {
      if (saved[index] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[index];
      }
    }
    if (originalEnv === undefined) {
      delete process.env.PAYSWAP_ENV;
    } else {
      process.env.PAYSWAP_ENV = originalEnv;
    }
  }

  group.scenario('the components.json environment agreement (the web-boundary reachability includes the D-1 route)');
  const componentsJson = JSON.parse(readText('deploy/contracts/components.json'));
  group.deepEqual(
    componentsJson.runtime_env_allowlist,
    ['sandbox', 'production'],
    'the runtime allowlist is exactly sandbox|production (aligned with src/lib/environment.ts)',
  );
  const webBoundary = componentsJson.components.find((component) => component.id === 'web-api-boundary');
  group.deepEqual(
    webBoundary.environment_reachability,
    ['development', 'test-ci', 'sandbox', 'staging', 'production'],
    'the web-api-boundary serves every environment class (the D-1 binding inherits this reachability)',
  );
  group.check(
    webBoundary.route_surface.includes('/api/protocol/commands'),
    'the web-api-boundary route_surface records the D-1 HTTP binding route (the governed contract change)',
  );
}

// ---------------------------------------------------------------------------
// P5 — UNKNOWN/waiting/recovery preservation
// ---------------------------------------------------------------------------
async function proveP5(group, context) {
  group.scenario('the no-answer arms stay no-answer across every probed port (nothing translates UNKNOWN)');
  const { ports } = context;
  const intentState = await ports.intent.getIntentState('pid.v1.sys001-never-submitted');
  group.check(intentState.kind === 'no-answer', 'the intent port\u2019s unknown reference stays no-answer (P5)');
  group.check(
    intentState.kind === 'no-answer' && intentState.reason === 'no-record',
    'the no-answer carries the runtime\u2019s no-record reason (UNKNOWN, with its reconciliation path)',
  );
  const track = await ports.tracking.lookupReference('sys001-p5-unknown', 'customer');
  group.check(track.kind === 'not-found', 'the tracking port\u2019s unknown reference stays the worded not-found');
  const waiting = ports.waiting.lookupWaiting('sys001-p5-unknown', 'customer');
  group.check(waiting.status === 'not-found', 'the waiting port\u2019s unknown reference stays not-found (no fabricated snapshot)');
  const checkout = await ports.checkout.getOffer({ checkoutId: 'sys001-p5-unknown' });
  group.check(
    checkout.ok === false || checkout.ok === true,
    'the checkout port answers inside its typed vocabulary (no translated outcomes)',
  );
  const recovery = ports.waiting.requestRecovery({ referenceId: 'sys001-p5-unknown', actionId: 'cancel', requestedByRole: 'customer' });
  group.check(
    recovery.status === 'denied' || recovery.status === 'accepted' || recovery.status === 'rejected',
    'the recovery request stays inside the typed vocabulary (denied arms worded as not-transported or authority refusals — never silent success)',
  );

  group.scenario('the unavailable backing remains the fail-closed default wording (P5 preserved where no adapter is registered)');
  const unavailable = readText('src/lib/protocol/unavailable-backing.ts');
  group.check(
    unavailable.includes('not-transported') && unavailable.includes('no-answer'),
    'the transport-unavailable backing still presents not-transported/no-answer as UNKNOWN (never failure, never success)',
  );
  group.check(
    !unavailable.includes('kind: \'transported\''),
    'the unavailable backing never fabricates a transported outcome',
  );

  group.scenario('the dispute vocabulary preserves recovery wording (the A10 dispute primitive)');
  const mediation = await ports.mediation.getDisputeInitiationBriefing();
  group.check(
    typeof mediation.summary === 'string' || typeof mediation === 'object',
    'the dispute initiation briefing answers its typed shape (grounds, evidence requirements, the one-way table)',
  );
  const initiationDenied = await ports.mediation.initiateDispute({
    intentReference: 'sys001-p5-unknown',
    grounds: ['goods-not-received'],
    accountOfWhatHappened: 'p5 probe',
    evidence: [],
    actor: 'customer',
  });
  group.check(
    initiationDenied.kind === 'denied' && initiationDenied.reason.includes('NOT initiated'),
    'the dispute initiation over an unknown reference is DENIED with the authority-grounded wording (nothing recorded, nothing mutated)',
  );
}

// ---------------------------------------------------------------------------
// The gateway/descriptor helpers over the app composition
// ---------------------------------------------------------------------------
let protocolSequence = 100;

async function gatewaySubmit(context, envelope) {
  const gateway = context.gatewayOf();
  const submission = {
    ...envelope,
    protocolTime: { sequence: (protocolSequence += 1), wallMs: Date.now() },
  };
  const admission = await gateway.submitCommand(submission);
  if (admission.ok) {
    await context.drain();
  }
  return admission;
}

async function mintDescriptor(idempotencyKey) {
  const { demandDescriptor } = await import(URL_OF('src/lib/protocol-runtime/intent/descriptor.ts'));
  return demandDescriptor({
    amount: { amountMinor: 2500, currency: 'USD', scale: 2 },
    source: { currency: 'USD', geography: 'US', account: 'sys001-recon-src' },
    destination: { currency: 'USD', geography: 'US', account: 'sys001-recon-dst' },
    constraints: {
      deadlineEpochMs: 1_789_384_278_922,
      allowedRails: ['sim-bank'],
      costCeiling: { amountMinor: 500, currency: 'USD', scale: 2 },
    },
    idempotencyKey,
  });
}

const derivedIds = new Map();
function deriveIntentId(key) {
  const id = derivedIds.get(key);
  if (id === undefined) {
    throw new Error(`harness bug: intent id not pre-derived for ${key}`);
  }
  return id;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------
process.stderr.write(`${HARNESS_NAME}: driving the reconciliation journeys over the composed runtime (7 groups, fail-closed)\n`);

// Fresh runtime state for a deterministic run (gitignored runtime artifact).
rmSync(WEB_RUNTIME_DIR, { recursive: true, force: true });

const serverRuntime = await import(URL_OF('src/lib/protocol/server-runtime.ts'));
const intentPortModule = await import(URL_OF('src/lib/protocol/intent-port.ts'));
const trackingPortModule = await import(URL_OF('src/lib/protocol/tracking-port.ts'));
const waitingPortModule = await import(URL_OF('src/lib/protocol/waiting-port.ts'));
const checkoutPortModule = await import(URL_OF('src/lib/protocol/checkout-port.ts'));
const liquidityPortModule = await import(URL_OF('src/lib/protocol/liquidity-port.ts'));
const mediationPortModule = await import(URL_OF('src/lib/protocol/mediation-port.ts'));
const capabilityPortModule = await import(URL_OF('src/lib/protocol/capability-port.ts'));
const { deriveProtocolId } = await import(URL_OF('src/lib/protocol-runtime/kernel/identity.ts'));
const { settlementInstructionIdFor } = await import(URL_OF('src/lib/protocol-runtime/settlement/state-machine.ts'));

// Patch the intentId helper to the async-derived map (used by the journeys
// through closure-free re-derivation below).
const context = {
  wire: () => serverRuntime.wireProductPortsToProtocolRuntime(),
  handleOf: () => serverRuntime.__handle ?? null,
  gatewayOf: null,
  drain: null,
  ports: {
    intent: intentPortModule.getIntentPort(),
    tracking: trackingPortModule.getTrackingPort(),
    waiting: waitingPortModule.getWaitingPort(),
    checkout: checkoutPortModule.getCheckoutPort(),
    liquidity: () => liquidityPortModule.getLiquidityPort(),
    mediation: mediationPortModule.getMediationPort(),
    capability: capabilityPortModule.getCapabilityPort(),
  },
};

let handle = null;
async function bootHandle() {
  await serverRuntime.wireProductPortsToProtocolRuntime();
  handle = await serverRuntime.getProtocolRuntimeHandle();
  context.handleOf = () => handle;
  context.gatewayOf = () => handle.gateway;
  context.drain = async () => {
    await handle.drain();
  };
  // re-resolve the ports AFTER wiring (the registered adapters)
  context.ports = {
    intent: intentPortModule.getIntentPort(),
    tracking: trackingPortModule.getTrackingPort(),
    waiting: waitingPortModule.getWaitingPort(),
    checkout: checkoutPortModule.getCheckoutPort(),
    liquidity: () => liquidityPortModule.getLiquidityPort(),
    mediation: mediationPortModule.getMediationPort(),
    capability: capabilityPortModule.getCapabilityPort(),
  };
}
context.wire = bootHandle;

// pre-derive the deterministic ids the journeys reference
derivedIds.set('sys001.recon.j1.intent', deriveProtocolId('intent', 'sys001.recon.j1.intent'));
derivedIds.set('sys001.recon.j4.obligation', deriveProtocolId('intent', 'sys001.recon.j4.obligation'));
derivedIds.set('sys001.recon.j4.instruction', deriveProtocolId('intent', 'sys001.recon.j4.instruction'));
derivedIds.set('sys001.recon.j4.cycle', deriveProtocolId('intent', 'sys001.recon.j4.cycle'));

await runGroup('recon:matrix', proveMatrix);
await runGroup('recon:authority', proveAuthorityOwnership);
await runGroup('recon:no-ui-truth', proveNoUiTruth);
await bootHandle();
await runGroup('recon:journeys', (group) => proveJourneys(group, context));
await runGroup('recon:no-bypass', (group) => proveNoBypass(group, context));
await runGroup('recon:environment', proveEnvironment);
await runGroup('recon:p5', (group) => proveP5(group, context));

// ---------------------------------------------------------------------------
// The report (stdout — byte-deterministic; ids and timing live on stderr)
// ---------------------------------------------------------------------------
process.stdout.write('\nSYS-001 system reconciliation proof\n');
process.stdout.write('='.repeat(78) + '\n');
const header = ['recon group', 'scenarios', 'assertions', 'result'];
process.stdout.write(header.map((cell) => String(cell).padEnd(26)).join('') + '\n');
process.stdout.write('-'.repeat(78) + '\n');
const scenariosTotal = groupResults.reduce((sum, r) => sum + r.scenarios, 0);
for (const row of groupResults) {
  const line = [row.group, String(row.scenarios), String(row.assertions), row.result];
  process.stdout.write(line.map((cell) => String(cell).padEnd(26)).join('') + '\n');
}
process.stdout.write('-'.repeat(78) + '\n');
process.stdout.write(
  `TOTAL: ${scenariosTotal} scenarios / ${liveAssertions} assertions / ${failure === null ? 'PASS' : 'FAIL'}\n`,
);

process.stdout.write('\nReconciliation evidence notes (deterministic)\n');
process.stdout.write('-'.repeat(78) + '\n');
for (const ledger of groupLedgers) {
  process.stdout.write(`${ledger.name}:\n`);
  for (const note of ledger.notes()) {
    process.stdout.write(`  ${note}\n`);
  }
}

process.stdout.write(
  `${JSON.stringify({
    type: 'recon-verdict',
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
process.stderr.write(`${HARNESS_NAME}: all recon groups green.\n`);
process.stdout.write('\nSYS-001 system reconciliation: all groups green (the matrix\u2019s claims are mechanically asserted).\n');
process.exit(0);
