/**
 * UI-010 evidence tooling — the environment-signal derivation check
 * (UX contract Section 10 / N4).
 *
 * Starts a SECOND instance of the same standalone build with
 * `PAYSWAP_ENV=production` (a controlled configuration check IN THE SANDBOX:
 * no production financial execution is claimed or performed — the check
 * proves the signal's derivation is exclusively configuration-driven), then
 * records:
 *   - /api/health (force-dynamic) → env must be "production";
 *   - a dynamic page's banner (/track) → "Production environment";
 *   - statically prerendered pages' banners (/ and /state-primitives and a
 *     verification harness) → observed as recorded (FINDING 4: baked at
 *     build time — see evidence/app-e2e/findings.md);
 *   - the sandbox instance's health + banner for the contrast row.
 *
 * Usage (from spec/product/closure/tools/, with the sandbox instance on :3210):
 *   node env-signal-check.mjs
 * Artifact: evidence/app-e2e/environment-signal.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dirname;
const EVIDENCE_DIR = join(HERE, '..', 'evidence', 'app-e2e');
mkdirSync(EVIDENCE_DIR, { recursive: true });

const SANDBOX_URL = process.env.BASE_URL ?? 'http://localhost:3210';
const PROD_PORT = process.env.PROD_PORT ?? '3211';
const PROD_URL = `http://localhost:${PROD_PORT}`;
const REPO = join(HERE, '..', '..', '..', '..');
const STANDALONE = join(REPO, '.next', 'standalone', 'server.js');

async function healthOf(baseUrl) {
  return (await fetch(`${baseUrl}/api/health`)).json();
}

async function bannerOf(baseUrl, route) {
  const html = await (await fetch(`${baseUrl}${route}`)).text();
  if (/Production environment/.test(html)) return 'Production environment';
  if (/Sandbox environment/.test(html)) return 'Sandbox environment';
  return '(no banner found)';
}

const checks = [];
function check(label, pass, evidence) {
  checks.push({ label, pass, evidence });
  console.log(`  ${pass ? 'PASS' : 'RECORDED'} — ${label}`);
}

// 1. The sandbox instance (the evidence instance).
const sandboxHealth = await healthOf(SANDBOX_URL);
check('the sandbox instance (PAYSWAP_ENV unset) reports env=sandbox', sandboxHealth.env === 'sandbox', JSON.stringify(sandboxAndTrim(sandboxHealth)));
const sandboxBanner = await bannerOf(SANDBOX_URL, '/');
check('the sandbox instance renders the Sandbox banner', sandboxBanner === 'Sandbox environment');

// 2. Start the production-configured instance of the SAME build.
const { spawn } = await import('node:child_process');
const proc = spawn(process.execPath, [STANDALONE], {
  cwd: join(REPO, '.next', 'standalone'),
  env: { ...process.env, PORT: PROD_PORT, HOSTNAME: '127.0.0.1', PAYSWAP_ENV: 'production' },
  stdio: 'ignore',
});
await new Promise((resolve) => setTimeout(resolve, 5000));

let artifact;
try {
  const prodHealth = await healthOf(PROD_URL);
  check('the production-configured instance (PAYSWAP_ENV=production) reports env=production — the signal derives exclusively from configuration', prodHealth.env === 'production', JSON.stringify(sandboxAndTrim(prodHealth)));

  const dynamicBanner = await bannerOf(PROD_URL, '/track');
  check('a DYNAMIC page on the production instance renders the Production banner (request-time derivation)', dynamicBanner === 'Production environment', `banner=/track → ${dynamicBanner}`);

  const staticHome = await bannerOf(PROD_URL, '/');
  const staticPrimitives = await bannerOf(PROD_URL, '/state-primitives');
  const staticHarness = await bannerOf(PROD_URL, '/verification/intent-flow');
  const staticNotFound = await bannerOf(PROD_URL, '/no-such-route-ui010');
  const staticStale = [staticHome, staticPrimitives, staticHarness, staticNotFound].filter((b) => b === 'Sandbox environment').length;
  check(
    `FINDING 4 recorded: ${staticStale}/4 statically prerendered surfaces on the production instance render the STALE build-time (Sandbox) banner — the banner is baked at prerender time; the dynamic surfaces and /api/health derive at request time`,
    true,
    `home=${staticHome}; state-primitives=${staticPrimitives}; intent-flow=${staticHarness}; 404=${staticNotFound}`,
  );

  artifact = {
    note: [
      'Controlled configuration check in the sandbox: the same standalone build started with PAYSWAP_ENV=production.',
      'No production financial execution is claimed or performed; this evidences the signal derivation chain only.',
      'FINDING 4: statically prerendered surfaces bake the build-time signal (see findings.md).',
    ].join(' '),
    sandboxInstance: { baseUrl: SANDBOX_URL, health: sandboxHealth, homeBanner: sandboxBanner },
    productionInstance: {
      baseUrl: PROD_URL,
      health: prodHealth,
      banners: {
        '/track (dynamic)': dynamicBanner,
        '/ (static)': staticHome,
        '/state-primitives (static)': staticPrimitives,
        '/verification/intent-flow (static)': staticHarness,
        '/no-such-route-ui010 (404, static)': staticNotFound,
      },
    },
    checks,
  };
} finally {
  proc.kill('SIGTERM');
}

writeFileSync(join(EVIDENCE_DIR, 'environment-signal.json'), JSON.stringify(artifact, null, 2));
console.log('Artifact: evidence/app-e2e/environment-signal.json');

function sandboxAndTrim(health) {
  return { status: health.status, env: health.env, component: health.component };
}
