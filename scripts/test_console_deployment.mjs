#!/usr/bin/env node
/**
 * payswap3 · PC-006 — The console deployment verification harness.
 *
 * Plain-Node evidence suite for the console deployment contract (design §15:
 * docs/superpowers/specs/2026-09-14-payswap-developer-console-design.md;
 * contract: spec/deployment/console-deployment.md; machine registry:
 * deploy/contracts/console-provider-bindings.json).
 *
 * THE SEPARATION INVARIANT (asserted, not proclaimed): everything this
 * harness proves is a REPOSITORY fact — package identity, contract
 * agreement, route availability in source (and, when a build output is
 * present, in the build's app-path-routes manifest), the environment
 * fail-safe chain of the REAL frozen modules, and the honesty of the
 * RECORDED provider-binding state. It is NOT production proof: no route is
 * claimed deployed, no provider is claimed serving, no production readiness
 * is inferred (environments.md F8; production-readiness.md §1; design §15
 * two-gate separation: repository verification ≠ deployment verification).
 * The harness proves its own confinement mechanically (group 5): a static
 * self-scan fails closed on the six network primitives of
 * console-deployment.md §7.1, so it CANNOT probe, ping or fetch any
 * provider — the tokens are constructed token-wise below precisely so the
 * scanner's own source cannot contain them.
 *
 * PROOF GROUPS (each named, counted, fail-closed):
 *
 *   1. [console-deploy:package-identity]
 *               the exact package identity: package.json name+version vs
 *               the recorded contract; single-package topology (no console
 *               package manifest anywhere in the console source tree; the
 *               standalone build output configuration unchanged; no console
 *               component in deploy/contracts/components.json — the
 *               present-set stays the governed set of eleven).
 *   2. [console-deploy:environment-configuration]
 *               the fail-safe chain over the REAL frozen modules:
 *               getEnvironment() unset/empty/invalid ⇒ sandbox, production
 *               ⇒ production (never production by accident); the classified
 *               environment report; validateStartupConfig() sandbox-ready
 *               with the environment as the whole requirement and
 *               production fail-closed on exactly the four named ids,
 *               reporting ids only (a sentinel value is injected and
 *               asserted absent from the result); no non-test console
 *               source file accesses the process environment directly (the
 *               console adds no environment input of its own).
 *   3. [console-deploy:route-availability]
 *               the console route surface, set-equal BOTH ways across the
 *               filesystem (every page.tsx under src/app/console and
 *               every route.ts under src/app/api/console), the binding
 *               registry,
 *               the frozen CONSOLE_REGISTRY hrefs
 *               (src/lib/console/registry.ts) and — for the static set —
 *               the component registry's web-api-boundary route_surface;
 *               the 3 dynamic segment routes recorded only in the binding
 *               registry; the build app-path-routes manifest carries every
 *               console route WHEN a build output is present (the manifest's
 *               app-path keys are normalized — trailing /page and /route
 *               segments and route-group segments stripped — before the
 *               set comparison; build state is environment, not tree
 *               content: the probe lives on stderr only, so stdout stays
 *               byte-deterministic — the ci-cd.md §2 / DEP-008
 *               discipline).
 *   4. [console-deploy:provider-binding-honesty]
 *               the closed six-provider set (each exactly once); CONNECTED
 *               requires an EXISTING evidence file that records the truth,
 *               a timestamp and a provenance; UNBOUND requires explicit
 *               null evidence fields plus the requirement that live
 *               provider evidence precede any production claim; closed
 *               status vocabulary; the registry invariants present. This
 *               group verifies the HONESTY of the recorded state — never
 *               the liveness of a provider.
 *   5. [console-deploy:repository-deployment-separation]
 *               the two-gate separation recorded on every contract surface
 *               (the registry invariant, console-deployment.md §2/§7), the
 *               static self-scan confinement proof, and the verdict line's
 *               own statement of its limits.
 *
 * Output contract (the scripts/test_*.mjs convention — glob-enumerated into
 * the ci-cd.md §2 `harnesses` gate of scripts/run_ci_gates.mjs): one JSON
 * record per scenario on STDOUT, group records, a human table and a final
 * verdict line; exit 0 iff every group passed. Fail-closed on any missing
 * input — a missing registry, contract document, package.json, route
 * source or evidence file is a group FAILURE (an error, never a silent
 * pass). Stdout is byte-deterministic at the same tree (wall-clock timing
 * and build-state probes live on stderr only).
 *
 * Node-version note: requires Node.js >= 22.6 (native TypeScript type
 * stripping, or --experimental-strip-types on earlier builds); the harness
 * self-configures the flag on Node builds that need it (same bootstrap as
 * the merged harnesses). Zero npm dependencies.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const HARNESS_NAME = 'scripts/test_console_deployment.mjs';

const BINDINGS_FILE = join(ROOT, 'deploy', 'contracts', 'console-provider-bindings.json');
const CONTRACT_DOC = join(ROOT, 'spec', 'deployment', 'console-deployment.md');
const COMPONENTS_FILE = join(ROOT, 'deploy', 'contracts', 'components.json');
const PACKAGE_FILE = join(ROOT, 'package.json');
const NEXT_CONFIG_FILE = join(ROOT, 'next.config.ts');
const REGISTRY_TS = join(ROOT, 'src', 'lib', 'console', 'registry.ts');
const DESIGN_DOC = join(
  ROOT,
  'docs',
  'superpowers',
  'specs',
  '2026-09-14-payswap-developer-console-design.md',
);
const APP_PATH_ROUTES_MANIFEST = join(ROOT, '.next', 'app-path-routes-manifest.json');

const PRODUCTION_REQUIRED_NAMES = [
  'PAYSWAP_DATABASE_URL',
  'PAYSWAP_QUEUE_URL',
  'PAYSWAP_EVIDENCE_STORE_URL',
  'PAYSWAP_RAIL_ADAPTERS_URL',
];
const CLOSED_PROVIDER_SET = ['vercel', 'database', 'queue', 'cloudflare', 'observability', 'github'];

// ---------------------------------------------------------------------------
// Bootstrap (mirrors the merged harnesses): probes .ts module loadability and
// re-executes with the required experimental flag on Node builds that need
// it. No sqlite is used by this harness, so only type stripping is probed.
// ---------------------------------------------------------------------------
const RESPAWN_ENV = 'PAYSWAP_PC006_DEPLOY_RESPAWNED';
async function ensureCapabilities() {
  if (process.env[RESPAWN_ENV] === '1') {
    return;
  }
  let stripTypesNeeded = false;
  try {
    await import(pathToFileURL(join(ROOT, 'src', 'lib', 'environment.ts')));
  } catch (error) {
    if (error && error.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
      stripTypesNeeded = true;
    } else {
      throw error;
    }
  }
  if (!stripTypesNeeded) {
    return;
  }
  const child = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '--', fileURLToPath(import.meta.url)],
    { stdio: 'inherit', env: { ...process.env, [RESPAWN_ENV]: '1' } },
  );
  if (child.status === 9) {
    console.error('node rejected the required experimental flag (exit 9): this Node build does');
    console.error('not support TypeScript type stripping. The PC-006 harness requires Node >= 22.6.');
    process.exit(1);
  }
  process.exit(typeof child.status === 'number' ? child.status : 1);
}

await ensureCapabilities();

// The product layer's module resolver (@/ alias + extensionless relative
// imports → .ts) — registered BEFORE any product-layer dynamic import.
register(new URL('./ts_resolver.mjs', import.meta.url));

// ---------------------------------------------------------------------------
// The verdict record — constructed HERE, before the groups, so group 5 can
// ASSERT its confinement fields as checked inputs (not prose printed after
// the fact). The report prints exactly this object.
// ---------------------------------------------------------------------------
const verdictRecord = {
  type: 'console-deploy-verdict',
  passed: null, // filled at the end (mirrors the group results)
  groups_total: 5,
  groups_failed: 0,
  scenarios_total: 0,
  assertions_total: 0,
  proves: 'repository-facts-only',
  production_proof: false,
  harness: HARNESS_NAME,
};

// ---------------------------------------------------------------------------
// The group runner (the merged harnesses' makeGroup pattern).
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
    setEqual: (actual, expected, message) => {
      const ordinal = count();
      const norm = (xs) => JSON.stringify([...new Set(xs)].sort());
      const a = norm(actual);
      const b = norm(expected);
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
  process.stderr.write(`── console-deploy group: ${name} ──\n`);
  let groupError = null;
  try {
    await runner(group);
  } catch (error) {
    groupError = error;
  }
  const { scenarios, assertions } = group.counts();
  const result = groupError === null ? 'PASS' : 'FAIL';
  groupResults.push({ type: 'console-deploy-group', group: name, scenarios, assertions, result });
  groupLedgers.push(group);
  if (groupError !== null) {
    failure = failure ?? groupError;
    process.stderr.write(`${name}: FAILED — ${groupError.message}\n`);
  } else {
    process.stderr.write(`${name}: PASS (${scenarios} scenarios / ${assertions} assertions)\n`);
  }
  for (const note of group.notes()) {
    if (typeof note === 'string' && note.startsWith('#')) {
      const record = {
        type: 'console-deploy-scenario',
        group: name,
        name: note.replace(/^#\d+ /, ''),
        result,
      };
      process.stdout.write(`${JSON.stringify(record)}\n`);
    }
  }
  process.stdout.write(
    `${JSON.stringify({ type: 'console-deploy-group', group: name, scenarios, assertions, result })}\n`,
  );
}

// ---------------------------------------------------------------------------
// Shared readers (fail-closed: a missing input throws inside its group).
// ---------------------------------------------------------------------------
function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}
function readText(p) {
  return readFileSync(p, 'utf8');
}

/** Walk a directory tree collecting file paths whose basename satisfies keep(). */
function walkFiles(dir, keep, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`cannot walk ${dir}: ${error.message}`);
  }
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(p, keep, acc);
    } else if (keep(entry.name)) {
      acc.push(p);
    }
  }
  return acc;
}

/** Map a file under src/app to its Next.js route path (dynamic segments stay bracketed). */
function routeFromAppFile(file) {
  const rel = relative(join(ROOT, 'src', 'app'), file);
  const dir = dirname(rel);
  return dir === '.' ? '/' : `/${dir.split('\\').join('/')}`;
}

const isPage = (name) => name === 'page.tsx';
const isRoute = (name) => name === 'route.ts';
const isManifest = (name) => name === 'package.json';
const isSource = (name) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name);

// ---------------------------------------------------------------------------
// Group 1 — console-deploy:package-identity
// ---------------------------------------------------------------------------
async function groupPackageIdentity(group) {
  const bindings = readJson(BINDINGS_FILE);
  const pkg = readJson(PACKAGE_FILE);
  const recorded = bindings.package_identity;

  group.scenario('the exact package identity (package.json vs the recorded contract)');
  group.equal(pkg.name, recorded.name, 'package.json name must equal the recorded contract name');
  group.equal(pkg.version, recorded.version, 'package.json version must equal the recorded contract version');
  group.check(
    typeof recorded.ships_within === 'string' && recorded.ships_within.includes('web-api-boundary'),
    'the recorded contract ships the console within web-api-boundary (the single Next.js package)',
  );
  group.check(
    typeof recorded.build_output === 'string' && recorded.build_output.includes('.next/standalone'),
    'the recorded build output is the standalone package output',
  );

  group.scenario('single-package topology: no console package manifest exists anywhere in the console source tree');
  const consoleRoots = [
    join(ROOT, 'src', 'app', 'console'),
    join(ROOT, 'src', 'app', 'api', 'console'),
    join(ROOT, 'src', 'components', 'console'),
    join(ROOT, 'src', 'lib', 'console'),
  ];
  let manifestCount = 0;
  for (const root of consoleRoots) {
    for (const file of walkFiles(root, isManifest)) {
      manifestCount += 1;
      group.note(`unexpected package manifest: ${relative(ROOT, file)}`);
    }
  }
  group.equal(manifestCount, 0, 'the console ships inside the ONE package — no nested package manifest');

  group.scenario('the standalone build output configuration is unchanged (packaging.md §1)');
  const nextConfig = readText(NEXT_CONFIG_FILE);
  group.check(
    nextConfig.includes('output: "standalone"'),
    'next.config.ts keeps output: "standalone" (the single runtime package the console ships within)',
  );

  group.scenario('no console component in the component registry (the present-set stays the governed set of eleven)');
  const components = readJson(COMPONENTS_FILE);
  const list = components.components;
  group.check(Array.isArray(list), 'components.json components is a list');
  group.equal(list.length, 11, 'the component present-set count stays eleven (no console component added)');
  const consoleNamed = list.filter((c) => typeof c.id === 'string' && c.id.includes('console'));
  group.equal(consoleNamed.length, 0, 'no component id mentions the console (no topology change)');
  const webBoundary = list.find((c) => c.id === 'web-api-boundary');
  group.check(webBoundary !== undefined, 'the web-api-boundary component exists (the console ships within it)');
  group.note(
    `package identity: ${pkg.name}@${pkg.version} inside web-api-boundary (components: ${list.length}; the console route_surface entries are checked in group 3)`,
  );
}

// ---------------------------------------------------------------------------
// Group 2 — console-deploy:environment-configuration
// ---------------------------------------------------------------------------
async function groupEnvironmentConfiguration(group) {
  const bindings = readJson(BINDINGS_FILE);
  const recorded = bindings.environment_requirements;

  const { getEnvironment, describeEnvironment } = await import(
    pathToFileURL(join(ROOT, 'src', 'lib', 'environment.ts'))
  );
  const { validateStartupConfig } = await import(
    pathToFileURL(join(ROOT, 'src', 'lib', 'startup-config.ts'))
  );

  const prior = process.env.PAYSWAP_ENV;
  const priorRequired = {};
  for (const name of PRODUCTION_REQUIRED_NAMES) {
    priorRequired[name] = process.env[name];
  }
  try {
    group.scenario('the PAYSWAP_ENV fail-safe chain over the REAL frozen module (unset/empty/invalid ⇒ sandbox)');
    delete process.env.PAYSWAP_ENV;
    group.equal(getEnvironment(), 'sandbox', 'unset PAYSWAP_ENV resolves to sandbox (fail-safe)');
    process.env.PAYSWAP_ENV = '';
    group.equal(getEnvironment(), 'sandbox', 'empty PAYSWAP_ENV resolves to sandbox (fail-safe)');
    process.env.PAYSWAP_ENV = 'production';
    group.equal(getEnvironment(), 'production', 'explicit production resolves to production');
    process.env.PAYSWAP_ENV = 'sandbox';
    group.equal(getEnvironment(), 'sandbox', 'explicit sandbox resolves to sandbox');
    for (const invalid of ['staging', 'PRODUCTION', 'prod', 'null']) {
      process.env.PAYSWAP_ENV = invalid;
      group.equal(
        getEnvironment(),
        'sandbox',
        `invalid PAYSWAP_ENV ${JSON.stringify(invalid)} fail-safes to sandbox, never to production`,
      );
    }
    delete process.env.PAYSWAP_ENV;
    group.equal(
      describeEnvironment().configuredValue,
      'unset-or-invalid',
      'the classified report summarizes unset as unset-or-invalid (raw values never echoed)',
    );

    group.scenario('validateStartupConfig sandbox: the environment selection is the whole required configuration');
    const sandboxResult = validateStartupConfig();
    group.equal(sandboxResult.ok, true, 'sandbox startup validation is ok with no further configuration');
    group.equal(sandboxResult.env, 'sandbox', 'the sandbox result reports env sandbox');
    group.equal(
      sandboxResult.checks.length,
      1,
      'sandbox requires exactly the environment check (no production names demanded)',
    );
    group.equal(sandboxResult.checks[0].id, 'environment', 'the sandbox check id is the environment resolution');

    group.scenario('validateStartupConfig production: fail-closed on exactly the four named ids (ids only, never values)');
    process.env.PAYSWAP_ENV = 'production';
    for (const name of PRODUCTION_REQUIRED_NAMES) {
      delete process.env[name];
    }
    const missingResult = validateStartupConfig();
    group.equal(missingResult.ok, false, 'production with the four names missing is NOT ok (fail-closed)');
    group.equal(missingResult.env, 'production', 'the production result reports env production');
    const missingIds = missingResult.checks.filter((c) => !c.ok).map((c) => c.id);
    group.setEqual(
      missingIds,
      PRODUCTION_REQUIRED_NAMES,
      'production validation fails on exactly the four named ids (no more, no fewer)',
    );
    // The secret boundary: a sentinel VALUE must never surface in the result.
    const sentinel = 'payswap-pc006-sentinel-value';
    process.env.PAYSWAP_DATABASE_URL = sentinel;
    const sentinelResult = validateStartupConfig();
    group.equal(sentinelResult.ok, false, 'still NOT ok while the other three names are missing');
    group.check(
      !JSON.stringify(sentinelResult).includes(sentinel),
      'the sentinel configuration VALUE never surfaces in the validation result (ids only — the F6/S discipline)',
    );
    for (const name of PRODUCTION_REQUIRED_NAMES) {
      process.env[name] = 'configured';
    }
    const readyResult = validateStartupConfig();
    group.equal(readyResult.ok, true, 'production with all four names present is ok');
    group.equal(
      readyResult.checks.filter((c) => c.ok).length,
      PRODUCTION_REQUIRED_NAMES.length + 1,
      'the ready result carries the environment check plus the four present-name checks',
    );
  } finally {
    if (prior === undefined) {
      delete process.env.PAYSWAP_ENV;
    } else {
      process.env.PAYSWAP_ENV = prior;
    }
    for (const name of PRODUCTION_REQUIRED_NAMES) {
      if (priorRequired[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = priorRequired[name];
      }
    }
  }

  group.scenario('the console adds no environment input of its own (no direct process-env access in non-test console source)');
  const consoleRoots = [
    join(ROOT, 'src', 'app', 'console'),
    join(ROOT, 'src', 'app', 'api', 'console'),
    join(ROOT, 'src', 'components', 'console'),
    join(ROOT, 'src', 'lib', 'console'),
  ];
  const envAccessPattern = /process\s*\.\s*env\s*[.[\]]/;
  let offenders = 0;
  for (const root of consoleRoots) {
    for (const file of walkFiles(root, isSource)) {
      if (file.includes('.test.')) {
        continue; // test fixtures may stage the frozen environment signal
      }
      if (envAccessPattern.test(readText(file))) {
        offenders += 1;
        group.note(`direct process-env access in ${relative(ROOT, file)}`);
      }
    }
  }
  group.equal(
    offenders,
    0,
    'no non-test console source file reads the process environment directly (server-derived scope through the frozen modules only)',
  );

  group.scenario('the recorded environment-requirements contract carries the documented chain (registry + contract document)');
  for (const name of PRODUCTION_REQUIRED_NAMES) {
    group.check(
      typeof recorded.startup_validation === 'string' && recorded.startup_validation.includes(name),
      `the registry's startup_validation names ${name}`,
    );
  }
  group.check(
    typeof recorded.environment_chain === 'string' &&
      recorded.environment_chain.includes('PAYSWAP_ENV') &&
      recorded.environment_chain.includes('fail-safes to sandbox'),
    'the registry records the PAYSWAP_ENV fail-safe chain',
  );
  const doc = readText(CONTRACT_DOC);
  for (const name of PRODUCTION_REQUIRED_NAMES) {
    group.check(doc.includes(name), `console-deployment.md names the required production id ${name}`);
  }
  group.check(
    doc.includes('fail-safes to `sandbox`, never to `production`'),
    'console-deployment.md records the fail-safe direction',
  );
}

// ---------------------------------------------------------------------------
// Group 3 — console-deploy:route-availability
// ---------------------------------------------------------------------------
async function groupRouteAvailability(group) {
  const bindings = readJson(BINDINGS_FILE);
  const pagesDir = join(ROOT, 'src', 'app', 'console');
  const apiDir = join(ROOT, 'src', 'app', 'api', 'console');

  const fsPages = walkFiles(pagesDir, isPage).map(routeFromAppFile);
  const fsApi = walkFiles(apiDir, isRoute).map(routeFromAppFile);

  group.scenario('the console page surface: filesystem ⇔ binding registry ⇔ frozen CONSOLE_REGISTRY (both ways)');
  const { CONSOLE_REGISTRY } = await import(pathToFileURL(REGISTRY_TS));
  const registryHrefs = CONSOLE_REGISTRY.map((entry) => entry.href);
  const recordedPages = bindings.console_route_surface.pages;
  group.check(Array.isArray(recordedPages), 'the binding registry records a pages list');
  group.setEqual(fsPages, recordedPages, 'every console page on disk is recorded in the binding registry, both ways');
  group.setEqual(fsPages, registryHrefs, 'every console page on disk equals a frozen CONSOLE_REGISTRY href, both ways');
  group.equal(registryHrefs.length, new Set(registryHrefs).size, 'the CONSOLE_REGISTRY hrefs are unique');
  group.note(`console pages: ${fsPages.length} (${fsPages.filter((r) => r.includes('[')).length} dynamic)`);

  group.scenario('the console API boundary surface: filesystem ⇔ binding registry (both ways)');
  const recordedApi = bindings.console_route_surface.api;
  group.check(Array.isArray(recordedApi), 'the binding registry records an api list');
  group.setEqual(fsApi, recordedApi, 'every console API route on disk is recorded in the binding registry, both ways');
  group.note(`console API routes: ${fsApi.length} (${fsApi.filter((r) => r.includes('[')).length} dynamic)`);

  group.scenario('the static console routes equal the component registry console entries (both ways)');
  const components = readJson(COMPONENTS_FILE);
  const webBoundary = components.components.find((c) => c.id === 'web-api-boundary');
  const surface = webBoundary.route_surface;
  group.check(Array.isArray(surface), 'web-api-boundary carries a route_surface list');
  const consoleSurface = surface.filter((r) => r === '/console' || r.startsWith('/console/'));
  const consoleApiSurface = surface.filter((r) => r === '/api/console' || r.startsWith('/api/console/'));
  const staticPages = fsPages.filter((r) => !r.includes('['));
  const staticApi = fsApi.filter((r) => !r.includes('['));
  group.setEqual(
    consoleSurface,
    staticPages,
    'the component registry console page entries equal the static console pages, both ways',
  );
  group.setEqual(
    consoleApiSurface,
    staticApi,
    'the component registry console API entries equal the static console API routes, both ways',
  );
  const otherSurface = surface.filter((r) => !consoleSurface.includes(r) && !consoleApiSurface.includes(r));
  group.note(
    `route_surface: ${surface.length} total — ${consoleSurface.length} console pages + ${consoleApiSurface.length} console API + ${otherSurface.length} pre-existing boundary routes (${otherSurface.join(', ')})`,
  );

  group.scenario('the 3 dynamic segment routes: recorded only in the binding registry, each present on disk');
  const dynamicPages = fsPages.filter((r) => r.includes('['));
  const dynamicApi = fsApi.filter((r) => r.includes('['));
  group.equal(dynamicPages.length, 1, 'exactly one dynamic console page route ([paymentId])');
  group.equal(dynamicApi.length, 2, 'exactly two dynamic console API routes ([checkoutId], [paymentId])');
  for (const route of [...dynamicPages, ...dynamicApi]) {
    group.check(
      recordedPages.includes(route) || recordedApi.includes(route),
      `the dynamic route ${route} is recorded in the binding registry`,
    );
    group.check(
      !surface.includes(route),
      `the dynamic route ${route} is NOT in the flat component route_surface (bracket segments are recorded only in the binding registry)`,
    );
    group.check(
      existsSync(join(ROOT, 'src', 'app', route)),
      `the dynamic route ${route} exists as a source directory (src/app${route})`,
    );
  }
  group.check(
    typeof bindings.console_route_surface.dynamic_route_representation === 'string' &&
      bindings.console_route_surface.dynamic_route_representation.length > 0,
    'the binding registry records why the dynamic routes live only there (the flat-route convention)',
  );

  group.scenario('the build app-path-routes manifest carries every console route when a build output is present (build state on stderr only)');
  // The manifest records APP-PATH keys — route paths with a trailing
  // "/page" or "/route" segment and any route-group segments (e.g.
  // "/(customer)/pay/page"). Normalization strips those decorations so the
  // comparison is against plain route paths (the console routes carry no
  // route groups).
  const normalizeManifestKey = (key) =>
    key.replace(/\/(page|route)$/, '').replace(/\/\([^/]+\)/g, '') || '/';
  const manifestPresent = existsSync(APP_PATH_ROUTES_MANIFEST);
  let manifestOk = true;
  if (manifestPresent) {
    try {
      const manifestRoutes = Object.keys(readJson(APP_PATH_ROUTES_MANIFEST)).map(normalizeManifestKey);
      const allConsoleRoutes = [...fsPages, ...fsApi];
      const missing = allConsoleRoutes.filter((r) => !manifestRoutes.includes(r));
      if (missing.length > 0) {
        manifestOk = false;
        process.stderr.write(
          `[console-deploy:route-availability] manifest missing console routes: ${missing.join(', ')}\n`,
        );
      } else {
        process.stderr.write(
          `[console-deploy:route-availability] build output present: the app-path-routes manifest carries all ${allConsoleRoutes.length} console routes (stderr evidence only)\n`,
        );
      }
    } catch (error) {
      manifestOk = false;
      process.stderr.write(
        `[console-deploy:route-availability] manifest present but unparsable: ${error.message}\n`,
      );
    }
  } else {
    process.stderr.write(
      '[console-deploy:route-availability] build output absent at harness time (the harnesses gate runs before the build gate on a fresh tree) — stderr evidence only\n',
    );
  }
  // ONE assertion, constant count: an absent manifest passes vacuously; a
  // present manifest is really checked. The stdout record therefore stays
  // byte-identical whether or not a build output exists.
  group.check(
    manifestOk,
    'the build app-path-routes manifest (when present) carries every console route',
  );
}

// ---------------------------------------------------------------------------
// Group 4 — console-deploy:provider-binding-honesty
// ---------------------------------------------------------------------------
async function groupProviderBindingHonesty(group) {
  const bindings = readJson(BINDINGS_FILE);
  const rows = bindings.provider_bindings;

  group.scenario('the closed six-provider set (each exactly once; no other provider)');
  group.check(Array.isArray(rows), 'provider_bindings is a list');
  const providers = rows.map((row) => row.provider);
  group.setEqual(providers, CLOSED_PROVIDER_SET, 'the provider set is exactly the design §15 closed set');
  group.equal(new Set(providers).size, providers.length, 'each provider appears exactly once');

  group.scenario('CONNECTED requires full evidence: an existing file that records the truth, a timestamp, a provenance');
  const connected = rows.filter((row) => row.binding_status === 'CONNECTED');
  group.setEqual(
    connected.map((row) => row.provider),
    ['github'],
    'exactly the recorded truth: github is the only CONNECTED provider',
  );
  for (const row of connected) {
    group.check(
      typeof row.evidence_reference === 'string' && row.evidence_reference.length > 0,
      `${row.provider} CONNECTED carries a non-empty evidence reference`,
    );
    const evidencePath = join(ROOT, row.evidence_reference);
    group.check(existsSync(evidencePath), `${row.provider} evidence file exists (${row.evidence_reference})`);
    const evidenceText = readText(evidencePath);
    group.check(
      /only github is connected/i.test(evidenceText),
      `${row.provider} evidence file records the connection truth ("only GitHub is connected")`,
    );
    group.check(
      typeof row.verification_timestamp === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.verification_timestamp),
      `${row.provider} CONNECTED carries a verification timestamp (ISO date)`,
    );
    group.check(
      typeof row.provenance === 'string' && row.provenance.length > 0,
      `${row.provider} CONNECTED carries a provenance statement`,
    );
    group.check(
      typeof row.requirement === 'string' && row.requirement.length > 0,
      `${row.provider} CONNECTED still records the requirement bounding the claim`,
    );
    group.check(
      /NOT a console runtime binding and NOT a production deployment binding/i.test(row.requirement),
      `${row.provider}'s requirement states the connection is NOT a console runtime or production deployment binding`,
    );
  }
  // The design-§15 baseline truth must agree (no invented binding may
  // contradict the design baseline this contract realizes).
  const design = readText(DESIGN_DOC);
  group.check(
    design.includes('only GitHub is connected through Composio'),
    'the design baseline (§15) records the same truth: only GitHub connected through Composio',
  );

  group.scenario('UNBOUND is explicit: null evidence fields plus the live-evidence requirement');
  const unbound = rows.filter((row) => row.binding_status === 'UNBOUND');
  group.setEqual(
    unbound.map((row) => row.provider),
    ['vercel', 'database', 'queue', 'cloudflare', 'observability'],
    'vercel/database/queue/cloudflare/observability are all recorded UNBOUND',
  );
  for (const row of unbound) {
    group.equal(row.evidence_reference, null, `${row.provider} UNBOUND records a null evidence reference`);
    group.equal(row.verification_timestamp, null, `${row.provider} UNBOUND records a null verification timestamp`);
    group.equal(row.provenance, null, `${row.provider} UNBOUND records a null provenance`);
    group.check(
      typeof row.requirement === 'string' && row.requirement.length > 0,
      `${row.provider} UNBOUND records the requirement that live provider evidence precede any production claim`,
    );
    group.check(
      /live provider evidence/i.test(row.requirement),
      `${row.provider}'s requirement names live provider evidence as the precondition for any production claim`,
    );
  }

  group.scenario('closed status vocabulary (CONNECTED | UNBOUND — nothing else)');
  for (const row of rows) {
    group.check(
      row.binding_status === 'CONNECTED' || row.binding_status === 'UNBOUND',
      `${row.provider} uses the closed vocabulary (found ${JSON.stringify(row.binding_status)})`,
    );
  }

  group.scenario('the registry invariants are present and non-empty (the machine contract)');
  const invariants = bindings.invariants;
  group.check(invariants !== null && typeof invariants === 'object', 'the registry carries an invariants object');
  for (const key of [
    'closed_provider_set',
    'connected_requires_full_evidence',
    'unbound_is_explicit',
    'closed_status_vocabulary',
    'no_fake_bindings',
    'repository_verification_is_not_deployment_proof',
  ]) {
    group.check(
      typeof invariants[key] === 'string' && invariants[key].length > 0,
      `the invariant ${key} is recorded`,
    );
  }
}

// ---------------------------------------------------------------------------
// Group 5 — console-deploy:repository-deployment-separation
// ---------------------------------------------------------------------------
async function groupSeparation(group) {
  const bindings = readJson(BINDINGS_FILE);
  const doc = readText(CONTRACT_DOC);

  group.scenario('the separation invariant is recorded on every contract surface');
  group.check(
    typeof bindings.invariants.repository_verification_is_not_deployment_proof === 'string' &&
      /production/i.test(bindings.invariants.repository_verification_is_not_deployment_proof),
    'the registry invariant repository_verification_is_not_deployment_proof is recorded and bounds the production claim',
  );
  group.check(
    doc.includes('## 7. The separation invariant (repository verification ≠ deployment verification)'),
    'console-deployment.md §7 states the two-gate separation',
  );
  group.check(
    doc.includes('does not prove production deployment'),
    'console-deployment.md §2 states that a green local/build/CI result is repository correctness only',
  );
  group.check(
    typeof bindings.console_route_surface.route_availability_note === 'string' &&
      /REPOSITORY availability/i.test(bindings.console_route_surface.route_availability_note) &&
      /not a claim/i.test(bindings.console_route_surface.route_availability_note),
    'the route availability note states route availability is REPOSITORY availability, not a deployment claim',
  );

  group.scenario('the harness confinement: a static self-scan over this harness source fails closed on the network primitives');
  // The six primitives of console-deployment.md §7.1, constructed token-wise
  // so this scanner's own source cannot contain them (the display forms are
  // sanitized the same way for the assertion messages).
  const token = (parts) => parts.join('');
  const sanitize = (value) => value.replace(':', ' ').replace('(', ' call)');
  const netTokens = [
    token(['node:', 'http']),
    token(['node:', 'https']),
    token(['node:', 'net']),
    token(['node:', 'dns']),
    token(['fetc', 'h(']),
    token(['connec', 't(']),
  ];
  const selfSource = readText(fileURLToPath(import.meta.url));
  for (const netToken of netTokens) {
    group.check(
      !selfSource.includes(netToken),
      `this harness performs no network access (self-scan: the ${sanitize(netToken)} primitive is absent from its own source)`,
    );
  }
  group.note('the self-scan covers the whole harness source — the harness cannot probe, ping or fetch any provider');

  group.scenario('the verdict line states its own limits (a checked input, not prose printed after the fact)');
  group.equal(
    verdictRecord.proves,
    'repository-facts-only',
    'the verdict record states this harness proves repository facts only',
  );
  group.equal(
    verdictRecord.production_proof,
    false,
    'the verdict record states production_proof: false (no production proof is inferred or claimed)',
  );
  group.equal(verdictRecord.groups_total, 5, 'the verdict record counts the five proof groups');
}

// ---------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------
await runGroup('console-deploy:package-identity', groupPackageIdentity);
await runGroup('console-deploy:environment-configuration', groupEnvironmentConfiguration);
await runGroup('console-deploy:route-availability', groupRouteAvailability);
await runGroup('console-deploy:provider-binding-honesty', groupProviderBindingHonesty);
await runGroup('console-deploy:repository-deployment-separation', groupSeparation);

// ---------------------------------------------------------------------------
// The report (stdout — byte-deterministic; timing and build-state live on
// stderr only).
// ---------------------------------------------------------------------------
const scenariosTotal = groupResults.reduce((sum, r) => sum + r.scenarios, 0);

process.stdout.write('\nPC-006 console deployment verification\n');
process.stdout.write('='.repeat(78) + '\n');
const header = ['proof group', 'scenarios', 'assertions', 'result'];
process.stdout.write(header.map((cell) => String(cell).padEnd(42)).join('') + '\n');
process.stdout.write('-'.repeat(78) + '\n');
for (const row of groupResults) {
  const line = [row.group, String(row.scenarios), String(row.assertions), row.result];
  process.stdout.write(line.map((cell) => String(cell).padEnd(42)).join('') + '\n');
}
process.stdout.write('-'.repeat(78) + '\n');
process.stdout.write(
  `TOTAL: ${scenariosTotal} scenarios / ${liveAssertions} assertions / ${
    failure === null ? 'PASS' : 'FAIL'
  }\n`,
);

process.stdout.write('\nDeployment evidence notes (deterministic — timing and build-state probes live on stderr only)\n');
process.stdout.write('-'.repeat(78) + '\n');
for (const ledger of groupLedgers) {
  process.stdout.write(`${ledger.name}:\n`);
  for (const note of ledger.notes()) {
    process.stdout.write(`  ${note}\n`);
  }
}

verdictRecord.passed = failure === null;
verdictRecord.groups_failed = groupResults.filter((r) => r.result === 'FAIL').length;
verdictRecord.scenarios_total = scenariosTotal;
verdictRecord.assertions_total = liveAssertions;
process.stdout.write(`${JSON.stringify(verdictRecord)}\n`);

if (failure !== null) {
  process.stderr.write(`${HARNESS_NAME}: FAILED — ${failure.message}\n`);
  process.exit(1);
}
process.stderr.write(`${HARNESS_NAME}: all five proof groups green (repository facts only — production proof: false).\n`);
process.stdout.write(
  '\nPC-006 console deployment verification: all groups green (REPOSITORY facts only — no route is claimed deployed, no provider is claimed serving, no production readiness is inferred; the provider-binding gate stays above this harness).\n',
);
process.exit(0);
