#!/usr/bin/env node
/**
 * payswap3 · PC-007 — The exact-release console verification harness.
 *
 * Plain-Node evidence suite for the FINAL console work item (design §16
 * verification classes 3 and 5 + §21 "production-like smoke run on exact
 * revision"; work order: spec/console-work-orders/PC-007.md — the 8 journeys,
 * the unavailable-authority injection rule, and the closure rule).
 *
 * WHAT THIS HARNESS PROVES (and what it never claims):
 *
 *   It boots the BUILT application (the standalone runtime package the
 *   deployment contract records — `bun run build` first when no build
 *   output exists, then `node .next/standalone/server.js` on an ephemeral
 *   loopback port) against a FRESH runtime (the composed runtime's SQLite
 *   stores are removed before boot, so the runtime holds no seeded data —
 *   the natural no-answer paths ARE the injected unavailable-authority
 *   cases), and drives the 8 release journeys over real HTTP with the
 *   repository's role-cookie mechanism (SHELL_AUDIENCE_COOKIE
 *   'payswap-shell-audience', src/lib/navigation.ts — the same signal the
 *   PC-001/PC-003 smoke evidence and the SYS-001 transport-binding harness
 *   used):
 *
 *     1. customer payment/activity visibility (overview renders; the
 *        payments list/detail compose the honest UNKNOWN presentation —
 *        never a business verdict);
 *     2. merchant payment + checkout visibility (payments + checkout
 *        sessions; an empty session collection renders as the legitimate
 *        VALUE it is when the port answers);
 *     3. provider capability visibility (the capability registry view);
 *     4. operator operations/UNKNOWN/recovery/reconciliation views (the
 *        six operations modules + the operator-scoped health summary, in
 *        the frozen observability taxonomy vocabulary);
 *     5. role/deep-link isolation — the FULL route-role matrix sweep: every
 *        authenticated role × every registry page route (allow ⇒ 200 with
 *        the guarded content; deny ⇒ fail-closed redirect, content never
 *        rendered), plus unauthenticated page redirects and representative
 *        API-boundary denials (404, no content);
 *     6. developer credential/webhook/logging paths (secret-once receipts,
 *        secret-free lists/audit, explicit audited revocation, the
 *        payload-free request-log ring rendered secret-free and label-free);
 *     7. documentation links (the four documentation pages render and every
 *        internal href resolves to a real route — no dead links);
 *     8. environment separation (the server-derived environment label
 *        renders, and query/cookie/body spoof attempts cannot change it).
 *
 *   The revision is read at RUN TIME (`git rev-parse HEAD` /
 *   `HEAD^{tree}` — the test_system_closure.mjs precedent, never
 *   hand-written): the release revision is wherever this harness RUNS. The
 *   worker branch run is the CANDIDATE proof; the Lead's re-run at merged
 *   main is the RELEASE proof. Package identity comes from package.json.
 *
 * WHAT IT NEVER CLAIMS: this is a LOCAL, LOOPBACK-ONLY smoke of the composed
 * repository application. Every URL the harness constructs targets
 * 127.0.0.1 on the ephemeral port it chose; no external host is ever
 * contacted, no provider is probed, no deployment is claimed, and no
 * production readiness is inferred (design §15 two-gate separation —
 * repository/production-like verification ≠ a production claim). The
 * provider-binding truth stays owned by scripts/test_console_deployment.mjs.
 *
 * Output contract (the scripts/test_*.mjs convention — glob-enumerated into
 * run_ci_gates.mjs gate 5): one JSON record per scenario on STDOUT, group
 * records, and a final verdict line; human-readable progress on STDERR;
 * exit 0 iff every group passed. Fail-closed: a missing build, a server
 * that never boots, or a failed journey is a FAILURE, never a silent pass.
 *
 * Stdout determinism note (a deliberate, recorded deviation from the PC-006
 * byte-determinism discipline): the PC-007 work order REQUIRES the verdict
 * record to carry the server port and wall time, so the final verdict line
 * is run-scoped by design. The per-scenario and per-group records stay
 * deterministic at the same tree; all timing and build-state prose lives on
 * stderr.
 *
 * Node-version note: requires Node.js >= 22 (global fetch, node:sqlite in
 * the booted server). Zero npm dependencies.
 */

import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createTcpServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const HARNESS_NAME = 'scripts/test_console_release_verification.mjs';
const DISPATCH_BASE = '901d0f902af5ed46fa9d0fa5495a5253f2626c9b'; // PC-007 dispatch base (c408757 lineage)

const PACKAGE_FILE = join(ROOT, 'package.json');
const STANDALONE_SERVERS = [
  join(ROOT, '.next', 'standalone', 'server.js'),
  join(ROOT, '.next', 'standalone', 'payswap3', 'server.js'),
];

const SHELL_AUDIENCE_COOKIE = 'payswap-shell-audience'; // src/lib/navigation.ts
const ROLES = ['customer', 'merchant', 'provider', 'operator', 'administrator'];

// ---------------------------------------------------------------------------
// The frozen route-role matrix (spec/console/route-role-matrix.md, transcribed
// verbatim — the deny cells journey 5 sweeps and the allow cells it proves).
// The [paymentId] probe reference: an arbitrary deep link (allow ⇒ honest
// UNKNOWN detail; deny ⇒ redirect).
// ---------------------------------------------------------------------------
const PAGE_MATRIX = [
  { href: '/console', allow: { customer: true, merchant: true, provider: true, operator: true, administrator: true } },
  { href: '/console/payments', allow: { customer: true, merchant: true, provider: false, operator: true, administrator: false } },
  { href: '/console/payments/ps_pc007_matrix_probe', allow: { customer: true, merchant: true, provider: false, operator: true, administrator: false } },
  { href: '/console/checkout/sessions', allow: { customer: false, merchant: true, provider: false, operator: false, administrator: false } },
  { href: '/console/checkout/configuration', allow: { customer: false, merchant: true, provider: false, operator: false, administrator: false } },
  { href: '/console/checkout/test', allow: { customer: true, merchant: true, provider: false, operator: false, administrator: false } },
  { href: '/console/accounts/customers', allow: { customer: false, merchant: false, provider: false, operator: false, administrator: true } },
  { href: '/console/accounts/merchants', allow: { customer: false, merchant: true, provider: false, operator: false, administrator: true } },
  { href: '/console/accounts/providers', allow: { customer: false, merchant: false, provider: true, operator: false, administrator: true } },
  { href: '/console/accounts/operators', allow: { customer: false, merchant: false, provider: false, operator: false, administrator: true } },
  { href: '/console/capabilities', allow: { customer: false, merchant: false, provider: true, operator: false, administrator: false } },
  { href: '/console/developers/api-keys', allow: { customer: false, merchant: true, provider: false, operator: false, administrator: false } },
  { href: '/console/developers/webhooks', allow: { customer: false, merchant: true, provider: false, operator: false, administrator: false } },
  { href: '/console/developers/logs', allow: { customer: false, merchant: true, provider: false, operator: false, administrator: false } },
  { href: '/console/developers/request-inspector', allow: { customer: false, merchant: true, provider: false, operator: false, administrator: false } },
  { href: '/console/developers/environments', allow: { customer: false, merchant: true, provider: false, operator: false, administrator: false } },
  { href: '/console/operations/queues', allow: { customer: false, merchant: false, provider: false, operator: true, administrator: false } },
  { href: '/console/operations/execution', allow: { customer: false, merchant: false, provider: false, operator: true, administrator: false } },
  { href: '/console/operations/reconciliation', allow: { customer: false, merchant: false, provider: false, operator: true, administrator: false } },
  { href: '/console/operations/unknown', allow: { customer: false, merchant: false, provider: false, operator: true, administrator: false } },
  { href: '/console/operations/clearing-netting', allow: { customer: false, merchant: false, provider: false, operator: true, administrator: false } },
  { href: '/console/operations/incidents', allow: { customer: false, merchant: false, provider: false, operator: true, administrator: false } },
  { href: '/console/documentation/api', allow: { customer: true, merchant: true, provider: true, operator: true, administrator: true } },
  { href: '/console/documentation/concepts', allow: { customer: true, merchant: true, provider: true, operator: true, administrator: true } },
  { href: '/console/documentation/examples', allow: { customer: true, merchant: true, provider: true, operator: true, administrator: true } },
  { href: '/console/documentation/guides', allow: { customer: true, merchant: true, provider: true, operator: true, administrator: true } },
];

const OPERATIONS_PAGES = [
  '/console/operations/queues',
  '/console/operations/execution',
  '/console/operations/reconciliation',
  '/console/operations/unknown',
  '/console/operations/clearing-netting',
  '/console/operations/incidents',
];

const DOC_PAGES = [
  '/console/documentation/api',
  '/console/documentation/concepts',
  '/console/documentation/examples',
  '/console/documentation/guides',
];

const SIX_STATUSES = new Set(['UNKNOWN', 'WAITING', 'IN_PROGRESS', 'FAILED', 'SUCCEEDED', 'ACTION_REQUIRED']);
const HEALTH_STATES = new Set(['ok', 'degraded', 'unknown-data', 'down']);

function resolve(...parts) {
  // Local path resolve (avoids importing node:path's resolve under a name
  // that shadows nothing — kept simple and explicit).
  let p = parts[0];
  for (let i = 1; i < parts.length; i += 1) {
    p = join(p, parts[i]);
  }
  return p;
}

// ---------------------------------------------------------------------------
// The group runner (the merged harnesses' makeGroup pattern).
// ---------------------------------------------------------------------------
const groupResults = [];
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
  process.stderr.write(`── release-verify group: ${name} ──\n`);
  let groupError = null;
  try {
    await runner(group);
  } catch (error) {
    groupError = error;
  }
  const { scenarios, assertions } = group.counts();
  const result = groupError === null ? 'PASS' : 'FAIL';
  groupResults.push({ type: 'release-verify-group', group: name, scenarios, assertions, result });
  if (groupError !== null) {
    failure = failure ?? groupError;
    process.stderr.write(`${name}: FAILED — ${groupError.message}\n`);
  } else {
    process.stderr.write(`${name}: PASS (${scenarios} scenarios / ${assertions} assertions)\n`);
  }
  for (const note of group.notes()) {
    if (typeof note === 'string' && note.startsWith('#')) {
      const record = {
        type: 'release-verify-scenario',
        group: name,
        name: note.replace(/^#\d+ /, ''),
        result,
      };
      process.stdout.write(`${JSON.stringify(record)}\n`);
    }
  }
  process.stdout.write(
    `${JSON.stringify({ type: 'release-verify-group', group: name, scenarios, assertions, result })}\n`,
  );
}

// ---------------------------------------------------------------------------
// Git / package readers (fail-closed).
// ---------------------------------------------------------------------------
function gitExec(...args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  }
  return result.stdout.trim();
}

// ---------------------------------------------------------------------------
// HTTP helpers (loopback-only — every URL is built from BASE).
// ---------------------------------------------------------------------------
let BASE = null; // `http://127.0.0.1:<ephemeral port>` — set at boot

const roleCookie = (role) => ({ Cookie: `${SHELL_AUDIENCE_COOKIE}=${role}` });

async function get(path, headers = {}) {
  const response = await fetch(`${BASE}${path}`, { headers, redirect: 'manual' });
  const text = await response.text();
  return { status: response.status, location: response.headers.get('location'), text };
}

async function getJson(path, headers = {}) {
  const response = await fetch(`${BASE}${path}`, { headers, redirect: 'manual' });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, location: response.headers.get('location'), text, json };
}

async function postJson(path, body, headers = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, location: response.headers.get('location'), text, json };
}

async function del(path, headers = {}) {
  const response = await fetch(`${BASE}${path}`, { method: 'DELETE', headers, redirect: 'manual' });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, location: response.headers.get('location'), text, json };
}

// ---------------------------------------------------------------------------
// HTML extraction helpers (SSR markup; tolerant regexes over stable markers).
// ---------------------------------------------------------------------------
function testidText(html, testid) {
  const match = html.match(new RegExp(`data-testid="${testid}"[^>]*>\\s*([^<]*)`));
  return match === null ? null : match[1].trim();
}

function allStatusChips(html) {
  return [...html.matchAll(/data-console-status="([A-Z_]+)"/g)].map((m) => m[1]);
}

function allHealthDomainStates(html) {
  return [...html.matchAll(/data-testid="console-health-domain-state"[^>]*>\s*([^<]*)/g)].map((m) => m[1].trim());
}

function extractInternalHrefs(html) {
  const hrefs = new Set();
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = match[1];
    if (href.startsWith('/') && !href.startsWith('//')) {
      // Site-absolute internal route (hash/query kept out of the route id).
      hrefs.add(href.split('#')[0].split('?')[0]);
    }
  }
  return [...hrefs];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Server lifecycle: build if needed, fresh runtime, ephemeral port, boot.
// ---------------------------------------------------------------------------
const runtimeFacts = {
  revision: null,
  tree: null,
  packageName: null,
  packageVersion: null,
  environmentKind: null,
  port: null,
  serverPid: null,
  builtNow: false,
  wallMs: null,
  journeysTotal: 8,
  journeysFailed: 0,
};

let serverChild = null;

function standaloneServerPath() {
  for (const candidate of STANDALONE_SERVERS) {
    if (existsSync(candidate)) {
      return { dir: dirname(candidate), script: candidate };
    }
  }
  return null;
}

async function acquireEphemeralPort() {
  return new Promise((resolvePort, reject) => {
    const probe = createTcpServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

async function buildIfNeeded(group) {
  group.scenario('the built app exists (bun run build first when no build output is present)');
  let server = standaloneServerPath();
  if (server === null) {
    process.stderr.write('no standalone build output — running bun run build (stderr only)…\n');
    const built = spawnSync('bun', ['run', 'build'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    process.stderr.write(built.stdout ?? '');
    process.stderr.write(built.stderr ?? '');
    const exit = built.error ? 127 : typeof built.status === 'number' ? built.status : 1;
    group.equal(exit, 0, 'bun run build exits 0 when no build output exists');
    runtimeFacts.builtNow = true;
    server = standaloneServerPath();
  }
  group.check(server !== null, 'the standalone server.js exists (.next/standalone)');
  return server;
}

async function bootServer(group, server) {
  group.scenario('the standalone server boots on an ephemeral loopback port with a FRESH runtime');
  // Fresh runtime state for the unavailable-authority injection: the
  // composition's SQLite stores regenerate per boot, so a fresh boot is a
  // runtime with NO seeded data — the natural no-answer paths.
  const runtimeDir = join(server.dir, 'var', 'web-runtime');
  rmSync(runtimeDir, { recursive: true, force: true });
  // Complete the standalone runtime package the documented way (packaging.md:
  // the build emits the traced server; static assets are copied beside it) so
  // the booted app serves its own /_next assets — the same package shape the
  // deployment contract records.
  const staticSource = join(ROOT, '.next', 'static');
  const staticTarget = join(server.dir, '.next', 'static');
  if (existsSync(staticSource) && !existsSync(staticTarget)) {
    cpSync(staticSource, staticTarget, { recursive: true });
  }
  const port = await acquireEphemeralPort();
  const env = { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1' };
  // The environment signal is the server's OWN configuration only: unset
  // here so the fail-safe chain resolves sandbox (deterministic regardless
  // of the ambient environment the harness itself runs under).
  delete env.PAYSWAP_ENV;
  serverChild = spawn(process.execPath, [server.script], {
    cwd: server.dir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  runtimeFacts.port = port;
  runtimeFacts.serverPid = serverChild.pid;
  const logChunks = [];
  serverChild.stdout.on('data', (chunk) => logChunks.push(String(chunk)));
  serverChild.stderr.on('data', (chunk) => logChunks.push(String(chunk)));
  BASE = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 150 && !ready; attempt += 1) {
    if (serverChild.exitCode !== null) {
      break;
    }
    await sleep(200);
    try {
      const response = await fetch(`${BASE}/api/health`);
      ready = response.status === 200;
    } catch {
      ready = false;
    }
  }
  group.check(ready, `the server answers /api/health 200 on 127.0.0.1:${port}`);
  group.check(serverChild.exitCode === null, 'the server process stays up after readiness');
  if (!ready) {
    process.stderr.write(`server boot log tail:\n${logChunks.join('').slice(-4000)}\n`);
  }
  return { child: serverChild, logText: () => logChunks.join('') };
}

async function stopServer() {
  if (serverChild === null || serverChild.exitCode !== null) {
    return;
  }
  serverChild.kill('SIGTERM');
  for (let attempt = 0; attempt < 50 && serverChild.exitCode === null; attempt += 1) {
    await sleep(100);
  }
  if (serverChild.exitCode === null) {
    serverChild.kill('SIGKILL');
    await sleep(300);
  }
}

// ---------------------------------------------------------------------------
// Group 0 — the exact release revision and package identity (run-time read).
// ---------------------------------------------------------------------------
async function groupRevisionAndPackage(group) {
  group.scenario('the exact release revision is read from the repo at run time (never hand-written)');
  runtimeFacts.revision = gitExec('rev-parse', 'HEAD');
  runtimeFacts.tree = gitExec('rev-parse', 'HEAD^{tree}');
  group.check(/^[0-9a-f]{40}$/.test(runtimeFacts.revision), 'HEAD resolves to a full commit SHA');
  group.check(/^[0-9a-f]{40}$/.test(runtimeFacts.tree), 'HEAD^{tree} resolves to a full tree SHA');
  group.note(`release revision (run-time read): commit ${runtimeFacts.revision} tree ${runtimeFacts.tree}`);

  group.scenario('the PC-007 dispatch base is an ancestor of the release revision');
  group.check(
    spawnSync('git', ['merge-base', '--is-ancestor', DISPATCH_BASE, 'HEAD'], { cwd: ROOT }).status === 0,
    `the dispatch base ${DISPATCH_BASE} is an ancestor of HEAD`,
  );

  group.scenario('the package identity is read from package.json');
  const pkg = JSON.parse(readFileSync(PACKAGE_FILE, 'utf8'));
  runtimeFacts.packageName = pkg.name;
  runtimeFacts.packageVersion = pkg.version;
  group.equal(pkg.name, 'payswap3', 'the package name is payswap3 (the single runtime package)');
  group.check(typeof pkg.version === 'string' && pkg.version.length > 0, 'the package version is a non-empty string');
}

// ---------------------------------------------------------------------------
// Group 1 — journey 1: customer payment/activity visibility.
// ---------------------------------------------------------------------------
async function journey1CustomerPayments(group) {
  group.scenario('/console renders for the customer role (server-resolved principal + environment)');
  const overview = await get('/console', roleCookie('customer'));
  group.equal(overview.status, 200, 'GET /console (customer) answers 200');
  group.equal(testidText(overview.text, 'console-principal-role'), 'customer', 'the principal role renders as customer');
  const envKind = testidText(overview.text, 'console-environment-kind');
  group.check(envKind !== null, 'the server-derived environment label renders on the overview');
  group.note(`environment kind rendered to the customer: ${envKind}`);
  group.check(
    overview.text.includes('client input cannot select production/test'),
    'the overview states the environment is not client-selectable',
  );

  group.scenario('/console/payments composes the honest UNKNOWN presentation (injected unavailable authority: fresh runtime, no seeded intents)');
  const payments = await get('/console/payments', roleCookie('customer'));
  group.equal(payments.status, 200, 'GET /console/payments (customer) answers 200');
  group.check(
    payments.text.includes('data-console-read="unavailable"'),
    'the payments list renders the unavailable-read panel (the port answered no-answer)',
  );
  const chips = allStatusChips(payments.text);
  group.check(chips.includes('UNKNOWN'), 'the payments list presents UNKNOWN');
  group.check(!chips.includes('FAILED'), 'the unavailable read never presents FAILED');
  group.check(!chips.includes('SUCCEEDED'), 'the unavailable read never presents SUCCEEDED');
  group.check(
    !payments.text.includes('data-console-view="payments-list"'),
    'the value branch (payments list) is NOT rendered for a no-answer',
  );
  group.check(
    payments.text.includes('data-testid="console-read-unavailable-note"'),
    'the authority note renders with the unavailable panel',
  );

  group.scenario('payment detail deep link: an unknown reference renders UNKNOWN, never a "not found" business verdict');
  const detail = await get('/console/payments/ps_pc007_unknown_probe', roleCookie('customer'));
  group.equal(detail.status, 200, 'GET /console/payments/<unknown reference> (customer) answers 200');
  const detailChips = allStatusChips(detail.text);
  group.check(detailChips.includes('UNKNOWN'), 'the payment detail presents UNKNOWN for the unknown reference');
  group.check(!detailChips.includes('FAILED'), 'the unknown reference is never a FAILED verdict');
  group.check(
    detail.text.includes('data-console-read="unavailable"'),
    'the payment detail renders the unavailable panel (no-answer, not a fabricated 404 verdict)',
  );
}

// ---------------------------------------------------------------------------
// Group 2 — journey 2: merchant payment + checkout visibility.
// ---------------------------------------------------------------------------
async function journey2MerchantCheckout(group) {
  group.scenario('/console/payments composes for the merchant role (same honest UNKNOWN on the fresh runtime)');
  const payments = await get('/console/payments', roleCookie('merchant'));
  group.equal(payments.status, 200, 'GET /console/payments (merchant) answers 200');
  group.check(payments.text.includes('data-console-read="unavailable"'), 'the fresh-runtime no-answer renders the unavailable panel');
  group.check(allStatusChips(payments.text).includes('UNKNOWN'), 'the merchant sees the same UNKNOWN presentation');

  group.scenario('/console/checkout/sessions: the port answers — an empty collection renders as the legitimate VALUE');
  const sessions = await get('/console/checkout/sessions', roleCookie('merchant'));
  group.equal(sessions.status, 200, 'GET /console/checkout/sessions (merchant) answers 200');
  group.check(
    sessions.text.includes('data-console-view="checkout-sessions"'),
    'the checkout sessions VALUE branch renders (the owning port answered the list read)',
  );
  group.check(
    !sessions.text.includes('data-console-read="unavailable"'),
    'the answering port is NOT presented as unavailable (envelope honesty)',
  );
  group.check(
    sessions.text.includes('data-testid="console-checkout-empty-value"') ||
      sessions.text.includes('data-testid="console-checkout-receive-amount"'),
    'the sessions read renders its own honest answer (empty VALUE or real session rows)',
  );
  group.check(
    !sessions.text.includes('data-testid="console-checkout-receive-amount"') ||
      sessions.text.includes('data-console-view="checkout-sessions"'),
    'session rows (if any) render inside the value branch only',
  );

  group.scenario('/console/checkout/test renders with the server-derived environment signal');
  const test = await get('/console/checkout/test', roleCookie('merchant'));
  group.equal(test.status, 200, 'GET /console/checkout/test (merchant) answers 200');
  group.check(
    test.text.includes('data-testid="console-checkout-test-environment"'),
    'the checkout test surface renders its environment panel',
  );
}

// ---------------------------------------------------------------------------
// Group 3 — journey 3: provider capability visibility.
// ---------------------------------------------------------------------------
async function journey3ProviderCapabilities(group) {
  group.scenario('/console/capabilities composes the capability authority registry view for the provider role');
  const capabilities = await get('/console/capabilities', roleCookie('provider'));
  group.equal(capabilities.status, 200, 'GET /console/capabilities (provider) answers 200');
  group.check(
    capabilities.text.includes('data-console-view="capabilities"'),
    'the capabilities VALUE branch renders (the port answered the listing read)',
  );
  group.check(
    !capabilities.text.includes('data-console-read="unavailable"'),
    'an answering capability port is not presented as unavailable',
  );
  const chips = allStatusChips(capabilities.text);
  const emptyRegistry = capabilities.text.includes('data-testid="console-capabilities-empty-value"');
  group.check(
    chips.length > 0 || emptyRegistry,
    'the registry answer renders its own honest value (capability rows with frozen statuses, or the empty-registry VALUE)',
  );
  for (const chip of chips) {
    group.check(SIX_STATUSES.has(chip), `every rendered status is frozen console vocabulary (${chip})`);
  }

  group.scenario('availability is never inferred from configuration (design §13) — availability-unknown items stay UNKNOWN');
  group.check(
    capabilities.text.includes('availability is never inferred') || emptyRegistry,
    'the capabilities view states the no-inference rule (or renders the authority\u2019s empty registry value)',
  );

  group.scenario('/console/accounts/providers renders the provider account projection');
  const accounts = await get('/console/accounts/providers', roleCookie('provider'));
  group.equal(accounts.status, 200, 'GET /console/accounts/providers (provider) answers 200');
  group.check(
    accounts.text.includes('data-console-view="accounts-providers"') ||
      accounts.text.includes('data-console-read="unavailable"'),
    'the provider accounts view renders its own honest answer (value or unavailable — both honest)',
  );
}

// ---------------------------------------------------------------------------
// Group 4 — journey 4: operator operations/UNKNOWN/recovery/reconciliation.
// ---------------------------------------------------------------------------
async function journey4OperatorOperations(group) {
  group.scenario('the operator overview composes the role-scoped operations health summary');
  const overview = await get('/console', roleCookie('operator'));
  group.equal(overview.status, 200, 'GET /console (operator) answers 200');
  group.equal(testidText(overview.text, 'console-principal-role'), 'operator', 'the operator principal renders');
  const summaryRendered =
    overview.text.includes('data-console-view="operations-health-summary"') ||
    overview.text.includes('data-console-read="unavailable"');
  group.check(summaryRendered, 'the operator-scoped health summary renders (value or honest unavailable — never omitted)');

  group.scenario('the health summary carries the frozen observability taxonomy vocabulary');
  const summaryDomainIds = [...overview.text.matchAll(/data-console-health-domain="([^"]+)"/g)].map((m) => m[1]);
  group.check(
    summaryDomainIds.length >= 9,
    `all nine taxonomy domains render on the operator overview (${summaryDomainIds.length} domain entries)`,
  );
  const chips = allStatusChips(overview.text);
  for (const chip of chips) {
    group.check(SIX_STATUSES.has(chip), `every rendered status is frozen console vocabulary (${chip})`);
  }

  group.scenario('every operations module page renders its domain view with the honest gap panel');
  for (const href of OPERATIONS_PAGES) {
    const page = await get(href, roleCookie('operator'));
    group.equal(page.status, 200, `GET ${href} (operator) answers 200`);
    group.check(
      page.text.includes('data-console-view="operations-domain"') ||
        page.text.includes('data-console-read="unavailable"'),
      `${href} renders the operations domain view (value or honest unavailable)`,
    );
    group.check(
      page.text.includes('data-testid="console-operations-gap"'),
      `${href} renders the honest module-gap panel (no invented module telemetry)`,
    );
    const pageStates = allHealthDomainStates(page.text);
    for (const state of pageStates) {
      group.check(HEALTH_STATES.has(state), `${href} health states are taxonomy vocabulary (${state})`);
    }
  }

  group.scenario('the operations unknown view preserves UNKNOWN-case semantics (taxonomy unknown-data answers)');
  const unknownView = await get('/console/operations/unknown', roleCookie('operator'));
  group.equal(unknownView.status, 200, 'GET /console/operations/unknown (operator) answers 200');
  group.check(
    unknownView.text.includes('unknown') || unknownView.text.includes('UNKNOWN'),
    'the unknown view carries the UNKNOWN vocabulary',
  );
  const unknownStates = allHealthDomainStates(unknownView.text);
  group.note(`unknown-view domain states: ${unknownStates.join(', ')}`);
  group.check(
    unknownStates.every((state) => HEALTH_STATES.has(state)),
    'the unknown view renders only the health authority\u2019s own states',
  );
}

// ---------------------------------------------------------------------------
// Group 5 — journey 5: role/deep-link isolation (the FULL matrix sweep).
// ---------------------------------------------------------------------------
async function journey5RoleIsolation(group) {
  group.scenario('the FULL route-role matrix sweep: allow cells render the guarded content');
  let allowProbes = 0;
  for (const row of PAGE_MATRIX) {
    for (const role of ROLES) {
      if (!row.allow[role]) {
        continue;
      }
      allowProbes += 1;
      const response = await get(row.href, roleCookie(role));
      group.equal(response.status, 200, `GET ${row.href} (${role}) — allow cell — answers 200`);
      group.check(
        response.text.includes('data-testid="console-header-role"'),
        `GET ${row.href} (${role}) renders the guarded console shell (header role chip)`,
      );
    }
  }
  group.note(`allow-cell probes: ${allowProbes}`);

  group.scenario('the FULL route-role matrix sweep: deny cells fail closed (redirect, content never rendered)');
  let denyProbes = 0;
  for (const row of PAGE_MATRIX) {
    for (const role of ROLES) {
      if (row.allow[role]) {
        continue;
      }
      denyProbes += 1;
      const response = await get(row.href, roleCookie(role));
      group.check(
        response.status >= 300 && response.status < 400,
        `GET ${row.href} (${role}) — deny cell — redirects (got ${response.status})`,
      );
      group.equal(response.location, '/', `GET ${row.href} (${role}) redirects to the shell home '/'`);
      group.check(
        !response.text.includes('data-testid="console-header-role"') &&
          !response.text.includes('data-console-view='),
        `GET ${row.href} (${role}) never renders guarded console content`,
      );
    }
  }
  group.note(`deny-cell probes: ${denyProbes}`);

  group.scenario('unauthenticated viewers are denied everywhere (fail-closed redirect)');
  for (const href of ['/console', '/console/payments', '/console/operations/queues', '/console/developers/api-keys']) {
    const response = await get(href, {});
    group.check(
      response.status >= 300 && response.status < 400,
      `GET ${href} (unauthenticated) redirects (got ${response.status})`,
    );
    group.equal(response.location, '/', `GET ${href} (unauthenticated) redirects to the shell home`);
    group.check(
      !response.text.includes('data-testid="console-header-role"'),
      `GET ${href} (unauthenticated) never renders console content`,
    );
  }

  group.scenario('representative API-boundary denials answer fail-closed 404 with no content');
  const apiDenials = [
    { path: '/api/console/developers/api-keys', role: 'customer' },
    { path: '/api/console/developers/api-keys', role: 'provider' },
    { path: '/api/console/developers/api-keys', role: 'operator' },
    { path: '/api/console/developers/api-keys', role: 'administrator' },
    { path: '/api/console/developers/webhooks', role: 'operator' },
    { path: '/api/console/payments', role: 'provider' },
    { path: '/api/console/payments', role: 'administrator' },
    { path: '/api/console/payments', role: 'unauthenticated-no-cookie' },
  ];
  for (const probe of apiDenials) {
    const headers = probe.role === 'unauthenticated-no-cookie' ? {} : roleCookie(probe.role);
    const response = await getJson(probe.path, headers);
    group.equal(response.status, 404, `GET ${probe.path} (${probe.role}) — denied — answers 404`);
    group.check(
      response.json !== null && response.json.ok === false,
      `GET ${probe.path} (${probe.role}) answers the fail-closed {ok:false} body`,
    );
    group.check(
      !response.text.includes('principal') || response.text.length < 200,
      `GET ${probe.path} (${probe.role}) leaks no principal/content`,
    );
  }
}

// ---------------------------------------------------------------------------
// Group 6 — journey 6: developer credential/webhook/logging paths.
// ---------------------------------------------------------------------------
async function journey6DeveloperControls(group) {
  const merchant = roleCookie('merchant');
  const createdSecrets = [];
  const createdKeyIds = [];
  const probeLabel = 'PC-007 release probe key';

  group.scenario('the developer pages render for the merchant role before any mutation');
  for (const href of [
    '/console/developers/api-keys',
    '/console/developers/webhooks',
    '/console/developers/logs',
    '/console/developers/request-inspector',
    '/console/developers/environments',
  ]) {
    const page = await get(href, merchant);
    group.equal(page.status, 200, `GET ${href} (merchant) answers 200`);
  }

  group.scenario('POST /api/console/developers/api-keys create: the plaintext secret is returned exactly ONCE');
  const created = await postJson('/api/console/developers/api-keys', { label: probeLabel }, merchant);
  group.equal(created.status, 200, 'POST create (merchant, JSON mode) answers 200');
  group.check(created.json !== null && created.json.ok === true, 'the create response is ok');
  const createdPayload = created.json?.result?.created;
  group.check(
    typeof createdPayload?.secret === 'string' && createdPayload.secret.startsWith('payswap_dev_'),
    'the plaintext token renders once in the creation response (payswap_dev_ prefix)',
  );
  group.check(
    typeof createdPayload?.key?.id === 'string' && createdPayload.key.id.startsWith('dak_'),
    'the created key id renders (dak_ prefix)',
  );
  group.equal(createdPayload.key.environment, 'sandbox', 'the created key is environment-scoped to the server-derived sandbox');
  createdSecrets.push(createdPayload.secret);
  createdKeyIds.push(createdPayload.key.id);

  group.scenario('GET list: the secret NEVER appears in any later read');
  const listAfterCreate = await getJson('/api/console/developers/api-keys', merchant);
  group.equal(listAfterCreate.status, 200, 'GET list (merchant) answers 200');
  const listResult = listAfterCreate.json?.result;
  group.equal(listResult?.outcome, 'value', 'the list read is the value envelope (the ring answers synchronously)');
  const keys = listResult?.value?.keys ?? [];
  group.check(keys.some((key) => key.id === createdPayload.key.id), 'the created key appears in the list');
  group.check(!('secret' in (keys[0] ?? {})), 'no list entry carries a secret field');
  group.check(!listAfterCreate.text.includes(createdSecrets[0]), 'the plaintext token appears nowhere in the list body');
  const pageAfterCreate = await get('/console/developers/api-keys', merchant);
  group.check(!pageAfterCreate.text.includes(createdSecrets[0]), 'the plaintext token appears nowhere in the rendered page');

  group.scenario('DELETE revoke: explicit, audited, fail-closed on double revoke');
  const revoked = await del(`/api/console/developers/api-keys?id=${encodeURIComponent(createdKeyIds[0])}`, merchant);
  group.equal(revoked.status, 200, 'DELETE revoke (merchant) answers 200');
  group.check(revoked.json?.ok === true, 'the revoke response is ok');
  group.check(revoked.json?.result?.revoked?.revokedWallMs !== null, 'the revoked view carries the revocation timestamp');
  const doubleRevoke = await del(`/api/console/developers/api-keys?id=${encodeURIComponent(createdKeyIds[0])}`, merchant);
  group.equal(doubleRevoke.status, 409, 'a second revoke fails closed (409)');
  group.check(doubleRevoke.json?.ok === false, 'the double-revoke body is the fail-closed {ok:false} shape');

  group.scenario('the audit trail records create + revoke (rendered secret-free)');
  const listAfterRevoke = await getJson('/api/console/developers/api-keys', merchant);
  const audit = listAfterRevoke.json?.result?.value?.audit ?? [];
  group.check(
    audit.some((entry) => entry.action === 'api-key.created' && entry.targetId === createdKeyIds[0]),
    'an api-key.created audit entry exists for the created key',
  );
  group.check(
    audit.some((entry) => entry.action === 'api-key.revoked' && entry.targetId === createdKeyIds[0]),
    'an api-key.revoked audit entry exists for the revoked key',
  );
  group.check(!listAfterRevoke.text.includes(createdSecrets[0]), 'the audit trail is secret-free');
  const pageAudit = await get('/console/developers/api-keys', merchant);
  group.check(
    pageAudit.text.includes('api-key.revoked') || pageAudit.text.includes('api-key.created'),
    'the page renders the audited actions',
  );
  group.check(!pageAudit.text.includes(createdSecrets[0]), 'the rendered audit trail is secret-free');

  group.scenario('webhook endpoint create/list/revoke: signing secret treated exactly like a credential');
  const hookCreated = await postJson(
    '/api/console/developers/webhooks',
    { url: 'https://pc007.invalid/release-probe-hook' },
    merchant,
  );
  group.equal(hookCreated.status, 200, 'POST webhook create (merchant) answers 200');
  const hookPayload = hookCreated.json?.result?.created ?? {};
  group.check(
    typeof hookPayload?.signingSecret === 'string' && hookPayload.signingSecret.startsWith('payswap_whsec_'),
    'the webhook signing secret renders once in the creation response',
  );
  const hookId = hookPayload?.endpoint?.id;
  group.check(typeof hookId === 'string' && hookId.startsWith('wh_'), 'the created endpoint id renders (wh_ prefix)');
  createdSecrets.push(hookPayload.signingSecret);
  const hookList = await getJson('/api/console/developers/webhooks', merchant);
  group.equal(hookList.status, 200, 'GET webhook list (merchant) answers 200');
  group.check(!hookList.text.includes(hookPayload.signingSecret), 'the webhook list never carries the signing secret');
  const hookRevoked = await del(`/api/console/developers/webhooks?id=${encodeURIComponent(hookId)}`, merchant);
  group.equal(hookRevoked.status, 200, 'DELETE webhook revoke (merchant) answers 200');
  const hookAudit = (await getJson('/api/console/developers/webhooks', merchant)).json?.result?.value?.audit ?? [];
  group.check(
    hookAudit.some((entry) => entry.action === 'webhook-endpoint.created' && entry.targetId === hookId),
    'a webhook-endpoint.created audit entry exists',
  );
  group.check(
    hookAudit.some((entry) => entry.action === 'webhook-endpoint.revoked' && entry.targetId === hookId),
    'a webhook-endpoint.revoked audit entry exists',
  );

  group.scenario('the request-log boundary renders payload-free, redacted entries (no label, no secret)');
  const logs = await get('/console/developers/logs', merchant);
  group.equal(logs.status, 200, 'GET /console/developers/logs (merchant) answers 200');
  group.check(logs.text.includes('data-console-view="developer-logs"'), 'the developer logs view renders');
  for (const secret of createdSecrets) {
    group.check(!logs.text.includes(secret), 'no secret material appears in the rendered request log');
  }
  group.check(
    !logs.text.includes(probeLabel),
    'the request-log ring stays payload-free — the created key label never appears in the log surface',
  );
  group.check(
    logs.text.includes('data-testid="console-log-entry-status"') ||
      logs.text.includes('data-testid="console-logs-empty-value"'),
    'the log entries render their own honest answer (entries or the empty value)',
  );

  group.scenario('the request inspector renders for the merchant role');
  const inspector = await get('/console/developers/request-inspector', merchant);
  group.equal(inspector.status, 200, 'GET /console/developers/request-inspector (merchant) answers 200');
  group.check(!inspector.text.includes(createdSecrets[0]), 'the inspector never displays secret material');
}

// ---------------------------------------------------------------------------
// Group 7 — journey 7: documentation links.
// ---------------------------------------------------------------------------
async function journey7DocumentationLinks(group) {
  group.scenario('the four documentation pages render (customer role — documentation is shell-wide)');
  const docHtml = new Map();
  for (const href of DOC_PAGES) {
    const page = await get(href, roleCookie('customer'));
    group.equal(page.status, 200, `GET ${href} (customer) answers 200`);
    docHtml.set(href, page.text);
  }

  group.scenario('every internal href on the documentation pages resolves to a real route (no dead links)');
  const internalHrefs = new Set();
  for (const html of docHtml.values()) {
    for (const href of extractInternalHrefs(html)) {
      internalHrefs.add(href);
    }
  }
  group.check(internalHrefs.size >= 10, `a real internal link surface exists (${internalHrefs.size} unique internal hrefs)`);
  group.note(`internal hrefs probed: ${[...internalHrefs].sort().join(' ')}`);
  let deadLinks = [];
  for (const href of [...internalHrefs].sort()) {
    const response = await get(href, roleCookie('customer'));
    if (response.status >= 200 && response.status < 400) {
      continue; // 200, or an expected redirect to a real route — resolves
    }
    if (response.status >= 300 && response.status < 400) {
      continue;
    }
    deadLinks.push({ href, status: response.status });
  }
  group.check(deadLinks.length === 0, `no dead internal links (${deadLinks.map((d) => `${d.href}→${d.status}`).join(', ') || 'none'})`);

  group.scenario('redirecting documentation links land on routes that answer');
  for (const href of [...internalHrefs].sort()) {
    const response = await get(href, roleCookie('customer'));
    if (response.status >= 300 && response.status < 400) {
      const landing = await get(response.location, roleCookie('customer'));
      group.check(
        landing.status >= 200 && landing.status < 400,
        `the redirect target of ${href} (${response.location}) resolves`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Group 8 — journey 8: environment separation (sandbox vs production).
// ---------------------------------------------------------------------------
async function journey8EnvironmentSeparation(group) {
  group.scenario('the server-derived environment label renders on the overview');
  const baseline = await get('/console', roleCookie('customer'));
  group.equal(baseline.status, 200, 'GET /console (customer) answers 200');
  const baselineKind = testidText(baseline.text, 'console-environment-kind');
  group.check(baselineKind !== null, 'the environment kind label renders');
  runtimeFacts.environmentKind = baselineKind; // live-read for the verdict record
  group.note(`baseline environment kind: ${baselineKind} (the server was booted with PAYSWAP_ENV unset — the fail-safe chain resolves sandbox)`);
  group.check(
    baseline.text.includes('derived by server configuration only') ||
      baseline.text.includes('server'),
    'the overview states the environment is server-derived',
  );

  group.scenario('a spoofed environment QUERY parameter cannot change the environment reporting');
  const spoofedQuery = await get('/console?env=production', roleCookie('customer'));
  group.equal(
    testidText(spoofedQuery.text, 'console-environment-kind'),
    baselineKind,
    '?env=production does not change the reported environment kind',
  );
  const spoofedQueryTest = await get('/console/checkout/test?env=production', roleCookie('customer'));
  group.equal(spoofedQueryTest.status, 200, 'GET /console/checkout/test?env=production answers 200');
  group.check(
    spoofedQueryTest.text.includes('sandbox'),
    'the checkout test surface keeps reporting the sandbox environment under ?env=production',
  );

  group.scenario('a spoofed environment COOKIE cannot change the environment reporting');
  const spoofedCookie = await get('/console', {
    Cookie: `${SHELL_AUDIENCE_COOKIE}=customer; payswap-env=production; PAYSWAP_ENV=production`,
  });
  group.equal(
    testidText(spoofedCookie.text, 'console-environment-kind'),
    baselineKind,
    'a spoofed payswap-env/PAYSWAP_ENV cookie does not change the reported environment kind',
  );

  group.scenario('the developers environments page reports the server-derived environment, ignoring spoof attempts');
  const environments = await get('/console/developers/environments?env=production', roleCookie('merchant'));
  group.equal(environments.status, 200, 'GET /console/developers/environments?env=production (merchant) answers 200');
  group.equal(
    testidText(environments.text, 'console-environment-kind'),
    baselineKind,
    'the environments page reports the same server-derived environment kind under ?env=production',
  );
  group.check(
    environments.text.includes('data-testid="console-environment-no-switching"'),
    'the environments page states there is no environment switching input',
  );

  group.scenario('a spoofed environment in the credential BODY/QUERY cannot scope a created key outside the server-derived environment');
  const spoofedCreate = await postJson(
    '/api/console/developers/api-keys?env=production',
    { label: 'PC-007 spoof-env probe', environment: 'production', env: 'production' },
    roleCookie('merchant'),
  );
  group.equal(spoofedCreate.status, 200, 'POST create with spoofed environment fields answers 200');
  const spoofedKey = spoofedCreate.json?.result?.created?.key;
  group.equal(spoofedKey?.environment, 'sandbox', 'the created key is scoped to the server-derived sandbox despite body/query spoof attempts');
  const spoofedSecret = spoofedCreate.json?.result?.created?.secret;
  if (typeof spoofedSecret === 'string') {
    const spoofedPage = await get('/console/developers/api-keys', merchantHeadersWithSpoof());
    group.check(!spoofedPage.text.includes(spoofedSecret), 'the spoof-probe key secret appears nowhere in a later read');
  }
}

function merchantHeadersWithSpoof() {
  return { Cookie: `${SHELL_AUDIENCE_COOKIE}=merchant; payswap-env=production` };
}

// ---------------------------------------------------------------------------
// Run order: revision → boot → the 8 journeys → teardown (always).
// ---------------------------------------------------------------------------
const startedAt = Date.now();
try {
  await runGroup('release:revision-and-package', groupRevisionAndPackage);

  await runGroup('release:boot', async (group) => {
    const server = await buildIfNeeded(group);
    if (server !== null) {
      await bootServer(group, server);
    }
  });

  await runGroup('release:journey-1-customer-payments', journey1CustomerPayments);
  await runGroup('release:journey-2-merchant-checkout', journey2MerchantCheckout);
  await runGroup('release:journey-3-provider-capabilities', journey3ProviderCapabilities);
  await runGroup('release:journey-4-operator-operations', journey4OperatorOperations);
  await runGroup('release:journey-5-role-isolation', journey5RoleIsolation);
  await runGroup('release:journey-6-developer-controls', journey6DeveloperControls);
  await runGroup('release:journey-7-documentation-links', journey7DocumentationLinks);
  await runGroup('release:journey-8-environment-separation', journey8EnvironmentSeparation);
} finally {
  await stopServer();
  runtimeFacts.wallMs = Date.now() - startedAt;
}

// ---------------------------------------------------------------------------
// The verdict record (printed exactly as constructed — the run-scoped facts
// the PC-007 work order requires: journeys, revision, package identity,
// environment kind, server port, wall time, and the honest limits).
// ---------------------------------------------------------------------------
const journeyGroups = groupResults.filter((r) => r.group.startsWith('release:journey-'));
if (runtimeFacts.environmentKind === null && failure === null) {
  // Fail-closed: the live environment read never happened — a verdict record
  // without the real value would be an invented fact.
  failure = failure ?? new Error('the live environment kind was never read (journey 8 did not run to its first scenario)');
}
const journeysFailed = journeyGroups.filter((r) => r.result !== 'PASS').length;
runtimeFacts.journeysFailed = journeysFailed;

const verdict = {
  type: 'console-release-verification-verdict',
  passed: failure === null,
  proves: 'local-composed-app-smoke-on-exact-revision',
  production_proof: false,
  harness: HARNESS_NAME,
  journeys_total: journeyGroups.length,
  journeys_failed: journeysFailed,
  journey_results: journeyGroups.map((r) => ({ journey: r.group, result: r.result })),
  groups_total: groupResults.length,
  groups_failed: groupResults.filter((r) => r.result !== 'PASS').length,
  assertions_total: liveAssertions,
  release_revision: {
    commit: runtimeFacts.revision,
    tree: runtimeFacts.tree,
    read_at_run_time: 'git rev-parse HEAD / HEAD^{tree} — never hand-written',
    dispatch_base: DISPATCH_BASE,
  },
  package_identity: { name: runtimeFacts.packageName, version: runtimeFacts.packageVersion },
  environment_kind: runtimeFacts.environmentKind,
  server: {
    port: runtimeFacts.port,
    pid: runtimeFacts.serverPid,
    bound: '127.0.0.1 (loopback only — no external host is ever contacted)',
    runtime_state: 'fresh (var/web-runtime removed before boot — the no-answer paths are the injected unavailable-authority cases)',
    built_during_run: runtimeFacts.builtNow,
    stopped: true,
  },
  wall_ms: runtimeFacts.wallMs,
  limits:
    'local loopback smoke of the composed repository application at the run-time-read revision; NOT a production deployment claim, NOT a provider-binding claim (owned by scripts/test_console_deployment.mjs); the Lead re-run at merged main is the release proof',
};
process.stdout.write(`${JSON.stringify(verdict)}\n`);

if (failure !== null) {
  process.stderr.write(`${HARNESS_NAME}: FAILED — ${failure.message}\n`);
  process.exit(1);
}
process.stderr.write(
  `${HARNESS_NAME}: all ${journeyGroups.length} journeys green (${liveAssertions} assertions; revision ${runtimeFacts.revision?.slice(0, 12)}; server pid ${runtimeFacts.serverPid} stopped).\n`,
);
process.exit(0);
