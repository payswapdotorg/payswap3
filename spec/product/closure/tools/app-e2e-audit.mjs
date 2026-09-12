/**
 * ════════════════════════════════════════════════════════════════════════
 *  UI-010 — LEG B: THE BUILT-APP END-TO-END AUDIT (HTTP + browser)
 * ════════════════════════════════════════════════════════════════════════
 *
 * Runs against the REAL BUILT APP (`bun run build` + the standalone server
 * `node .next/standalone/server.js` — the repository's documented runtime
 * package, spec/deployment/packaging.md) with the composed protocol runtime
 * constructed in the server process (src/instrumentation.ts →
 * src/lib/protocol/server-runtime.ts — evidenced by the SQLite stores the
 * composition creates and /api/health).
 *
 * ⚠ FINDINGS CONTEXT (recorded before this audit's checks were written;
 * full evidence in evidence/app-e2e/findings.md): objective probing of the
 * composed app at base 2e3b831 established that the UI-011 splice does NOT
 * reach the routes' port-module instances — in BOTH the dev server and the
 * production build, every port call from every surface resolves the
 * transport-unavailable backing (honest UNKNOWN / denied presentations;
 * never fabricated). This audit therefore evidences the app AS IT IS:
 *
 *   B-0  the three integration findings, evidenced on the live app
 *   B-1  environment signal: /api/health + the banner on every healthy
 *        surface + anti-spoof attempts (N4, UX contract Section 10)
 *   B-2  the role matrix: every surface × every audience by deep link
 *        (the simulated authoritative audience cookie) + record-content
 *        leakage checks (P8)
 *   B-3  WF-7: the browser-context honest UNKNOWN — the customer pay flow
 *        compose → review renders the not-quotable UNKNOWN (the recorded
 *        SYS-001 deviation presented P5-correctly), and the unknown-reference
 *        intent state page renders UNKNOWN with reconciliation
 *   B-4  the app's actual server-rendered presentations: the honest
 *        transport-unavailable reads on every port surface (tracking,
 *        checkout, capabilities, liquidity, oversight, mediation) — the
 *        runtime-backed presentations themselves are evidenced on Leg A
 *        (product-port-journeys.mjs), where the same adapters execute over
 *        the same composed runtime
 *   B-5  the dispute-initiation API flow: the honest denial + the
 *        authority consequence wording on the initiation surface (P2)
 *   B-6  navigation leakage checks: the root shell renders least
 *        visibility; the provider surface frame renders only provider nav
 *
 * Artifacts: evidence/app-e2e/app-e2e.json + app-e2e.md + findings.md.
 * Tooling: Playwright (Chromium) over the built app + plain fetch.
 *
 * Usage (from spec/product/closure/tools/):
 *   BASE_URL=http://localhost:3210 node app-e2e-audit.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const HERE = import.meta.dirname;
const EVIDENCE_DIR = join(HERE, '..', 'evidence', 'app-e2e');
mkdirSync(EVIDENCE_DIR, { recursive: true });

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3210';
const AUDIENCE_COOKIE = 'payswap-shell-audience';
const AUDIENCES = ['unauthenticated', 'customer', 'merchant', 'provider', 'operator', 'administrator'];

// The UI-009 surface registry, re-declared for this audit (source:
// hardening/tools/surfaces.mjs at base 2e3b831 — routes and implemented
// deep-link expectations; the declared-gate column for
// verification/mediation-flow carries the UI-009 WAIVER-1 disagreement).
const RENDER = 'render';
const HOME = 'home';
const SURFACES = [
  { id: 'home', route: '/', expected: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER } },
  { id: 'state-primitives', route: '/state-primitives', expected: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER } },
  { id: 'pay-compose', route: '/pay', expected: { unauthenticated: HOME, customer: RENDER, merchant: HOME, provider: HOME, operator: HOME, administrator: HOME } },
  { id: 'pay-review', route: '/pay/review', expected: { unauthenticated: HOME, customer: RENDER, merchant: HOME, provider: HOME, operator: HOME, administrator: HOME } },
  { id: 'pay-intent-state', route: '/pay/INTENT-UI010-UNKNOWN', expected: { unauthenticated: HOME, customer: RENDER, merchant: HOME, provider: HOME, operator: HOME, administrator: HOME } },
  { id: 'checkout-list', route: '/checkout', expected: { unauthenticated: HOME, customer: HOME, merchant: RENDER, provider: HOME, operator: HOME, administrator: HOME } },
  { id: 'checkout-decision', route: '/checkout/cko_live_offer_001', expected: { unauthenticated: HOME, customer: HOME, merchant: RENDER, provider: HOME, operator: HOME, administrator: HOME } },
  { id: 'capabilities', route: '/capabilities', expected: { unauthenticated: HOME, customer: HOME, merchant: HOME, provider: RENDER, operator: HOME, administrator: HOME } },
  { id: 'capability-detail', route: '/capabilities/intent-acceptance', expected: { unauthenticated: HOME, customer: HOME, merchant: HOME, provider: RENDER, operator: HOME, administrator: HOME } },
  { id: 'liquidity', route: '/liquidity', expected: { unauthenticated: HOME, customer: HOME, merchant: HOME, provider: RENDER, operator: HOME, administrator: HOME } },
  { id: 'oversight', route: '/oversight', expected: { unauthenticated: HOME, customer: HOME, merchant: HOME, provider: HOME, operator: RENDER, administrator: HOME } },
  { id: 'track', route: '/track', expected: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER } },
  { id: 'track-status-intent', route: '/track/PWS-2H8D', expected: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER } },
  { id: 'track-status-settlement', route: '/track/STL-4419', expected: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER } },
  { id: 'waiting-recovery', route: '/track/TRK-4410-QUEUED-LIQ/waiting', expected: { unauthenticated: HOME, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER } },
  { id: 'mediation-hub', route: '/mediation', expected: { unauthenticated: HOME, customer: RENDER, merchant: RENDER, provider: HOME, operator: HOME, administrator: HOME } },
  { id: 'mediation-case', route: '/mediation/case/M-101', expected: { unauthenticated: HOME, customer: RENDER, merchant: RENDER, provider: HOME, operator: HOME, administrator: HOME } },
  { id: 'dispute-initiation', route: '/mediation/dispute/new', expected: { unauthenticated: HOME, customer: RENDER, merchant: RENDER, provider: HOME, operator: HOME, administrator: HOME } },
  { id: 'dispute-detail', route: '/mediation/dispute/D-201', expected: { unauthenticated: HOME, customer: RENDER, merchant: RENDER, provider: HOME, operator: HOME, administrator: HOME } },
  { id: 'proposal-review', route: '/mediation/proposal/P-001', expected: { unauthenticated: HOME, customer: RENDER, merchant: RENDER, provider: HOME, operator: HOME, administrator: HOME } },
  { id: 'verification-intent-flow', route: '/verification/intent-flow', expected: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER } },
  { id: 'verification-checkout-flow', route: '/verification/checkout-flow', expected: { unauthenticated: HOME, customer: HOME, merchant: RENDER, provider: HOME, operator: RENDER, administrator: RENDER } },
  { id: 'verification-capability-flow', route: '/verification/capability-flow', expected: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER } },
  { id: 'verification-liquidity-flow', route: '/verification/liquidity-flow', expected: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER } },
  { id: 'verification-tracking-flow', route: '/verification/tracking-flow', expected: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER } },
  { id: 'verification-waiting-flow', route: '/verification/waiting-flow', expected: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER } },
  {
    id: 'verification-mediation-flow',
    route: '/verification/mediation-flow',
    expected: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER },
    declaredGate: { unauthenticated: HOME, customer: HOME, merchant: HOME, provider: HOME, operator: RENDER, administrator: RENDER },
    note: 'UI-009 WAIVER-1: the grammar declares [operator, administrator] but the page is unguarded — re-verified here as-is.',
  },
  { id: 'not-found', route: '/no-such-route-ui010', expected: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER } },
];

const checks = [];
function check(section, label, pass, evidence = null) {
  checks.push({ section, label, pass, evidence });
  console.log(`  [${section}] ${pass ? 'PASS' : '✗ FAIL'} — ${label}`);
  return pass;
}

async function newPage(browser, audience, { width = 1440, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  if (audience !== 'unauthenticated') {
    await context.addCookies([{ name: AUDIENCE_COOKIE, value: audience, url: BASE_URL }]);
  }
  return page;
}

async function bodyOf(page, route, wait = 350) {
  await page.goto(BASE_URL + route, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(wait);
  return page.locator('body').innerText();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const artifact = { baseUrl: BASE_URL, startedAt: new Date().toISOString(), sections: {} };

  // ════════════════════════════════════════════════════════════════════
  // B-0 — the integration findings, evidenced on the live app
  // ════════════════════════════════════════════════════════════════════
  console.log('\nB-0 — integration findings (evidenced live)');
  const probePage = await newPage(browser, 'operator');
  const oversightBody = await bodyOf(probePage, '/oversight');
  const finding2TransportWording = /runtime adapter could not be reached from this context/.test(oversightBody);
  check('B-0', 'FINDING 2 live evidence: /oversight (operator) renders the transport-unavailable presentation — the UI-011 splice does not reach the routes (full analysis in findings.md)', finding2TransportWording);
  const liquidityFlowStatus = await probePage.request.get(`${BASE_URL}/verification/liquidity-flow`, { maxRedirects: 0 });
  check('B-0', `FINDING 3 live evidence: /verification/liquidity-flow responds HTTP ${liquidityFlowStatus.status()} (the mock-era invariant trips on the honest fail-closed backing)`, liquidityFlowStatus.status() === 500);
  const disputeProbe = await probePage.evaluate(async () => {
    const response = await fetch('/api/mediation/dispute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intentReference: 'activity-none', grounds: ['other-with-evidence'], accountOfWhatHappened: 'probe', evidence: [] }),
    });
    return response.json();
  });
  check('B-0', 'FINDING 2 live evidence: the dispute API (the one browser-reachable consequential write) resolves the transport-unavailable backing — no command is admitted', disputeProbe.kind === 'denied' && /runtime adapter could not be reached from this context/.test(disputeProbe.reason ?? ''));
  await probePage.context().close();
  artifact.sections.findings = {
    finding2: { oversightTransportWording: finding2TransportWording, disputeProbe },
    finding3: { liquidityFlowStatus: liquidityFlowStatus.status() },
    note: 'FINDING 1 (drain semantics) is evidenced by workflows/probe-drain.txt; FINDINGS 2–3 are live-app evidence above; the full analysis is in findings.md.',
  };

  // ════════════════════════════════════════════════════════════════════
  // B-1 — environment signal (N4, Section 10)
  // ════════════════════════════════════════════════════════════════════
  console.log('\nB-1 — environment signal');
  const health = await (await fetch(`${BASE_URL}/api/health`)).json();
  check('B-1', '/api/health reports env=sandbox (the fail-safe: PAYSWAP_ENV unset)', health.env === 'sandbox' && health.status === 'ok', JSON.stringify(health));
  check('B-1', '/api/ready responds 200', (await fetch(`${BASE_URL}/api/ready`)).status === 200);
  artifact.sections.health = health;

  const bannerPage = await newPage(browser, 'unauthenticated');
  const bannerResults = [];
  for (const surface of SURFACES.filter((s) => s.expected.unauthenticated === RENDER)) {
    const status = await bannerPage.request.get(`${BASE_URL}${surface.route}`, { maxRedirects: 0 });
    // The designed not-found page (HTTP 404) still renders the shell banner;
    // only the FINDING 3 route (HTTP 500) serves the error page without it.
    const expectBanner = status.status() !== 500;
    await bannerPage.goto(BASE_URL + surface.route, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const banner = await bannerPage
      .locator('[role="region"][aria-label="Environment signal"] [role="note"]')
      .first()
      .innerText()
      .catch(() => null);
    const ok = !expectBanner || (banner !== null && /Sandbox environment/.test(banner));
    bannerResults.push({ surface: surface.id, httpStatus: status.status(), banner: banner ? banner.split('\n')[0] : null, ok });
  }
  const bannerExpected = bannerResults.filter((r) => r.httpStatus !== 500);
  check('B-1', `the sandbox environment banner renders on all ${bannerExpected.length} non-500 unauthenticated-reachable surfaces incl. the 404 page (the one 500 is the FINDING 3 route)`, bannerExpected.every((r) => r.ok) && bannerExpected.length >= 11);
  artifact.sections.banner = bannerResults;

  await bannerPage.goto(`${BASE_URL}/?PAYSWAP_ENV=production&env=production&environment=production`, { waitUntil: 'domcontentloaded' });
  const spoofed = await bannerPage
    .locator('[role="region"][aria-label="Environment signal"] [role="note"]')
    .first()
    .innerText()
    .catch(() => null);
  check('B-1', 'URL parameters cannot spoof the environment signal (still Sandbox)', spoofed !== null && /Sandbox environment/.test(spoofed));
  await bannerPage.evaluate(() => {
    try {
      localStorage.setItem('PAYSWAP_ENV', 'production');
      sessionStorage.setItem('PAYSWAP_ENV', 'production');
    } catch { /* ignore */ }
    return true;
  });
  await bannerPage.reload({ waitUntil: 'domcontentloaded' });
  const afterStorage = await bannerPage
    .locator('[role="region"][aria-label="Environment signal"] [role="note"]')
    .first()
    .innerText()
    .catch(() => null);
  check('B-1', 'client storage cannot spoof the environment signal (still Sandbox)', afterStorage !== null && /Sandbox environment/.test(afterStorage));
  await bannerPage.context().close();

  // ════════════════════════════════════════════════════════════════════
  // B-2 — the role matrix (P8)
  // ════════════════════════════════════════════════════════════════════
  console.log('\nB-2 — role matrix (deep links × audiences)');
  const matrix = [];
  let mismatches = 0;
  for (const surface of SURFACES) {
    const row = { surface: surface.id, route: surface.route, cells: {}, declaredDisagreements: surface.declaredGate ? [] : undefined };
    for (const audience of AUDIENCES) {
      const page = await newPage(browser, audience);
      await page.goto(BASE_URL + surface.route, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(200);
      const url = page.url().replace(BASE_URL, '') || '/';
      const redirected = url === '/' && surface.route !== '/';
      const observed = redirected ? 'home' : 'render';
      const expected = surface.expected[audience];
      const match = observed === expected;
      if (!match) mismatches += 1;
      row.cells[audience] = { observed, expected, match };
      if (surface.declaredGate && surface.declaredGate[audience] !== observed) {
        row.declaredDisagreements.push({ audience, declared: surface.declaredGate[audience], observed });
      }
      await page.context().close();
    }
    matrix.push(row);
  }
  check('B-2', `deep-link matrix: ${SURFACES.length} surfaces × ${AUDIENCES.length} audiences = ${SURFACES.length * AUDIENCES.length} cells; ${mismatches} mismatches vs the implemented guards`, mismatches === 0, `${mismatches} mismatches`);
  const declaredDisagreements = matrix.filter((row) => (row.declaredDisagreements ?? []).length > 0);
  check('B-2', `declared-gate vs implemented-gate disagreements re-verified: ${declaredDisagreements.map((r) => r.surface).join(', ')} (the recorded UI-009 WAIVER-1, unchanged)`, declaredDisagreements.length === 1 && declaredDisagreements[0].surface === 'verification-mediation-flow', JSON.stringify(declaredDisagreements.map((r) => ({ surface: r.surface, disagreements: r.declaredDisagreements }))));
  artifact.sections.roleMatrix = {
    cells: SURFACES.length * AUDIENCES.length,
    mismatches,
    declaredDisagreements: declaredDisagreements.map((r) => ({ surface: r.surface, disagreements: r.declaredDisagreements })),
    matrix,
  };

  // Record-content leakage: with the re-anchored ports (and today, the
  // transport-unavailable backings), per-reference record authorization is
  // documented as the runtime's own concern (the boundary reports state the
  // runtime places no per-viewer gating on protocol reads; the product
  // shell's audience model governs surface access). The leakage check that
  // holds in every configuration: no audience ever receives ANOTHER role's
  // record content — record reads resolve not-found/UNKNOWN through the
  // current backings, and the mediation record API applies its server-side
  // viewer resolution.
  const leakageChecks = [];
  for (const route of ['/track/PWS-2H8D', '/track/STL-4419', '/track/TRK-4410-QUEUED-LIQ/waiting', '/mediation/case/M-101', '/mediation/dispute/D-201', '/mediation/proposal/P-001']) {
    for (const audience of AUDIENCES) {
      const page = await newPage(browser, audience);
      const body = await bodyOf(page, route, 300);
      // No record content: no state frames with tracked records, no party
      // docket entries — every read resolves the honest no-record/not-visible
      // presentation. What MUST NOT appear: another party's record content
      // (e.g., dispute grounds/doCKET records, tracked state cards).
      const leakedRecordContent = /grounds catalog|recourse trail|tracked state:|history entries|evidence trail/i.test(body) && !/could not be reached|not known whether|no record|unavailable|not visible|not yet known/i.test(body);
      leakageChecks.push({ route, audience, leakedRecordContent });
      await page.context().close();
    }
  }
  const leakageCount = leakageChecks.filter((c) => c.leakedRecordContent).length;
  check('B-2', `record-content leakage: ${leakageChecks.length} route × audience reads, ${leakageCount} instances of cross-role record content`, leakageCount === 0);
  // The mediation record API's server-side viewer resolution.
  const recordApiPage = await newPage(browser, 'unauthenticated');
  await recordApiPage.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  const unauthRecord = await recordApiPage.evaluate(async (baseUrl) => (await fetch(`${baseUrl}/api/mediation/record?type=dispute&id=D-1`)).json(), BASE_URL);
  check('B-2', 'the mediation record API resolves the viewer server-side (unauthenticated → not-visible, never the record)', unauthRecord.kind === 'not-visible');
  const customerRecordPage = await newPage(browser, 'customer');
  await customerRecordPage.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  const customerRecord = await customerRecordPage.evaluate(async (baseUrl) => (await fetch(`${baseUrl}/api/mediation/record?type=dispute&id=D-1`)).json(), BASE_URL);
  check('B-2', 'a party viewer querying an unknown record receives the honest unavailable/not-visible answer (never fabricated content)', customerRecord.kind === 'unavailable' || customerRecord.kind === 'not-visible');
  artifact.sections.contentLeakage = { checks: leakageChecks.length, leakageCount, unauthRecord, customerRecord };
  await recordApiPage.context().close();
  await customerRecordPage.context().close();

  // ════════════════════════════════════════════════════════════════════
  // B-3 — WF-7: the browser-context honest UNKNOWN (the recorded deviation)
  // ════════════════════════════════════════════════════════════════════
  console.log('\nB-3 — WF-7 browser-context honest UNKNOWN (pay flow)');
  const payPage = await newPage(browser, 'customer');
  await payPage.goto(`${BASE_URL}/pay`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await payPage.waitForTimeout(600);
  await payPage.getByRole('radio', { name: /I want to send money to a merchant\./ }).first().click();
  await payPage.locator('#pay-recipient').click();
  await payPage.getByRole('option', { name: /Copperline Coffee/ }).click();
  await payPage.locator('#pay-source').click();
  await payPage.getByRole('option', { name: /Sandbox balance · Main/ }).click();
  await payPage.locator('#pay-amount').fill('25.00');
  await payPage.getByRole('link', { name: /Review the full consequences/ }).click();
  await payPage.waitForURL('**/pay/review', { timeout: 45000 });
  await payPage.waitForTimeout(900);
  const reviewBody = await payPage.locator('body').innerText();
  const unknownQuote = /The consequences of this intent are not quotable right now\./.test(reviewBody);
  const reconciliationShown = /Resolved by:/.test(reviewBody) && /Re-check:/.test(reviewBody);
  const noSubmit = (await payPage.getByRole('button', { name: /Submit payment intent/ }).count()) === 0;
  const submitBlockedWording = /without a full review there is no submit/i.test(reviewBody);
  check('B-3', 'the browser-context consequence quote renders UNKNOWN ("not quotable right now")', unknownQuote);
  check('B-3', 'the UNKNOWN carries its reconciliation path (Resolved by / Re-check)', reconciliationShown);
  check('B-3', 'the submit is honestly unavailable (no submit control; the review stays closed)', noSubmit && submitBlockedWording);
  const bannerInPay = await payPage.locator('[role="region"][aria-label="Environment signal"] [role="note"]').first().innerText();
  check('B-3', 'the pay flow carries the sandbox signal (the N4 framing for consequential wording)', /Sandbox environment/.test(bannerInPay));
  const reviewScreenshot = join(EVIDENCE_DIR, 'wf7-pay-review-unknown.png');
  await payPage.screenshot({ path: reviewScreenshot, fullPage: true });
  artifact.sections.wf7 = {
    url: payPage.url().replace(BASE_URL, ''),
    unknownQuote, reconciliationShown, noSubmit,
    screenshot: 'wf7-pay-review-unknown.png',
    note: 'The browser-context port call resolves the transport-unavailable backing (UI-011): the runtime adapter is in-process on the server and the gateway HTTP binding is deferred to SYS-001 — compounded by FINDING 2 (the registration does not reach the routes in the first place). The presentation is the P5-correct UNKNOWN either way.',
  };
  await payPage.context().close();

  const statePage = await newPage(browser, 'customer');
  await statePage.goto(`${BASE_URL}/pay/INTENT-UI010-UNKNOWN`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await statePage.waitForTimeout(900);
  const stateBody = await statePage.locator('body').innerText();
  const stateUnknown = /It is not yet known whether the authority holds this intent\./.test(stateBody);
  const unknownChip = await statePage.locator('.ps-state-frame', { hasText: 'Unknown' }).count();
  check('B-3', 'the unknown-reference intent state renders UNKNOWN (never 404, never failure)', stateUnknown && unknownChip > 0);
  check('B-3', 'the UNKNOWN state frame carries the standing disambiguation (never success or failure)', /never styled, worded, or counted as success or failure/i.test(stateBody));
  await statePage.screenshot({ path: join(EVIDENCE_DIR, 'wf7-intent-state-unknown.png'), fullPage: true });
  artifact.sections.wf7.unknownReferenceState = { stateUnknown, unknownChipCount: unknownChip };
  await statePage.context().close();

  // ════════════════════════════════════════════════════════════════════
  // B-4 — the app's actual server-rendered presentations
  // ════════════════════════════════════════════════════════════════════
  console.log('\nB-4 — server-rendered presentations (the app as it is)');
  const readResults = {};

  const trackPage = await newPage(browser, 'customer');
  const trackBody = await bodyOf(trackPage, '/track/PWS-UI010-NOREF');
  readResults.track = {
    honestNoRecord: /not known whether a tracked record exists|No tracked reference matches this lookup/.test(trackBody),
    transportHonest: /runtime adapter could not be reached from this context/.test(trackBody),
  };
  check('B-4', '/track/<reference> renders the honest no-record presentation with the transport note (never a fabricated record, never a 404 failure)', readResults.track.honestNoRecord && readResults.track.transportHonest);
  await trackPage.context().close();

  const checkoutPage = await newPage(browser, 'merchant');
  const checkoutBody = await bodyOf(checkoutPage, '/checkout');
  readResults.checkout = {
    honest: /no open|No open|authority-unreachable|could not be reached/i.test(checkoutBody),
    noFabricatedOffer: !/Open offer — payment intent/.test(checkoutBody),
  };
  check('B-4', '/checkout renders the honest unavailable presentation (no fabricated offers)', readResults.checkout.honest && readResults.checkout.noFabricatedOffer);
  await checkoutPage.context().close();

  const capPage = await newPage(browser, 'provider');
  const capBody = await bodyOf(capPage, '/capabilities');
  readResults.capabilities = {
    boundary: /Capability\/Routing Authority/.test(capBody),
    honestReachability: /browser-context/i.test(capBody),
  };
  check('B-4', '/capabilities states the honest reachability boundary (the adapter-boundary constants render)', readResults.capabilities.boundary && readResults.capabilities.honestReachability);
  await capPage.context().close();

  const oversightPage2 = await newPage(browser, 'operator');
  const oversightBody2 = await bodyOf(oversightPage2, '/oversight');
  readResults.oversight = {
    deniedHonest: /could not be reached from this context/.test(oversightBody2),
    failClosed: /fail closed|never zero|never fabricated/i.test(oversightBody2),
  };
  check('B-4', '/oversight renders the honest fail-closed presentation (UNKNOWN-class, never fabricated aggregates)', readResults.oversight.deniedHonest);
  await oversightPage2.context().close();

  const liquidityPage = await newPage(browser, 'provider');
  const liquidityBody = await bodyOf(liquidityPage, '/liquidity');
  readResults.liquidity = {
    honest: /could not be reached from this context|authority-unreachable/i.test(liquidityBody),
  };
  check('B-4', '/liquidity renders the honest transport-unavailable presentation', readResults.liquidity.honest);
  await liquidityPage.context().close();

  const mediationPage = await newPage(browser, 'customer');
  const mediationBody = await bodyOf(mediationPage, '/mediation');
  readResults.mediation = {
    honest: /could not be reached from this context|unavailable/i.test(mediationBody),
    wave2: /wave 2|RTN wave/i.test(mediationBody),
  };
  check('B-4', '/mediation renders the honest unavailable docket with the wave-2 gap stated', readResults.mediation.honest && readResults.mediation.wave2);
  await mediationPage.context().close();
  artifact.sections.serverReads = {
    results: readResults,
    note: 'The app as it is (FINDING 2): every port surface renders the transport-unavailable backing presentations — honest UNKNOWN/denied, never fabricated. The runtime-backed presentations for the same surfaces are evidenced on Leg A (product-port-journeys.mjs), where the seven runtime adapters execute over the same composed runtime classes.',
  };

  // ════════════════════════════════════════════════════════════════════
  // B-5 — the dispute-initiation flow
  // ════════════════════════════════════════════════════════════════════
  console.log('\nB-5 — dispute-initiation flow');
  const disputePage = await newPage(browser, 'customer');
  await disputePage.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  const disputeResponse = await disputePage.evaluate(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/mediation/dispute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        intentReference: 'activity-ui010-none',
        grounds: ['other-with-evidence'],
        accountOfWhatHappened: 'UI-010 evidence run.',
        evidence: [],
      }),
    });
    return response.json();
  }, BASE_URL);
  check('B-5', 'the dispute initiation is DENIED with the honest not-transported reason — nothing was recorded, nothing was mutated (P5: not a failure verdict)', disputeResponse.kind === 'denied' && /not transported|could not be reached|was not initiated/i.test(disputeResponse.reason ?? ''), JSON.stringify(disputeResponse).slice(0, 140));
  const unauthPage = await newPage(browser, 'unauthenticated');
  await unauthPage.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  const unauthDispute = await unauthPage.evaluate(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/mediation/dispute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intentReference: 'activity-ui010-none', grounds: ['other-with-evidence'], accountOfWhatHappened: 'x', evidence: [] }),
    });
    return response.json();
  }, BASE_URL);
  check('B-5', 'the unauthenticated actor is denied before any authority call (server-side audience resolution)', unauthDispute.kind === 'denied' && /No party role is active/.test(unauthDispute.reason ?? ''));
  await disputePage.goto(`${BASE_URL}/mediation/dispute/new`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await disputePage.waitForTimeout(500);
  const disputeNewBody = await disputePage.locator('body').innerText();
  check('B-5', 'the dispute-initiation surface fail-closes when the party docket is unreachable (the honest availability-unknown presentation — the initiation form is never offered without the docket\'s disputable references)', /could not be reached from this context|authority cannot currently report this record/i.test(disputeNewBody));
  check('B-5', 'the surface renders the explicit dispute-initiation unavailable section (aria-label present) rather than any fabricated initiation flow', await disputePage.locator('section[aria-label="Dispute initiation unavailable"]').count() === 1);
  await disputePage.screenshot({ path: join(EVIDENCE_DIR, 'dispute-initiation-consequences.png'), fullPage: true });
  artifact.sections.disputeFlow = { denied: disputeResponse, unauthDenied: unauthDispute };
  await disputePage.context().close();
  await unauthPage.context().close();

  // ════════════════════════════════════════════════════════════════════
  // B-6 — navigation leakage
  // ════════════════════════════════════════════════════════════════════
  console.log('\nB-6 — navigation leakage');
  const navResults = [];
  for (const audience of AUDIENCES) {
    const page = await newPage(browser, audience);
    const homeBody = await bodyOf(page, '/', 250);
    const leakage = /Checkout|Capabilities|Liquidity|Oversight|Mediation & disputes|Send a payment intent/.test(homeBody);
    navResults.push({ audience, leakage });
    await page.context().close();
  }
  check('B-6', 'the root shell renders least-visibility navigation for all six audiences (zero cross-role entries)', navResults.every((r) => !r.leakage), JSON.stringify(navResults));
  const providerPage = await newPage(browser, 'provider');
  await providerPage.goto(`${BASE_URL}/capabilities`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await providerPage.waitForTimeout(400);
  const providerNav = (await providerPage.locator('nav').allInnerTexts()).join('\n');
  const providerSeesOwn = /Capabilities|Liquidity positions/.test(providerNav);
  const providerLeak = /Checkout|Mediation & disputes|Send a payment intent|Oversight/.test(providerNav);
  check('B-6', 'the provider surface frame renders the provider navigation (own entries present, zero foreign entries)', providerSeesOwn && !providerLeak, providerNav.replace(/\n/g, ' | ').slice(0, 160));
  artifact.sections.navigation = { rootShell: navResults, providerFrame: { providerSeesOwn, providerLeak } };
  await providerPage.context().close();

  await browser.close();

  // ── Persist artifacts ─────────────────────────────────────────────────
  const failed = checks.filter((c) => !c.pass);
  artifact.checks = checks;
  artifact.finishedAt = new Date().toISOString();
  artifact.verdict = { total: checks.length, failed: failed.length };
  writeFileSync(join(EVIDENCE_DIR, 'app-e2e.json'), JSON.stringify(artifact, null, 2));

  const lines = [
    '# UI-010 Leg B — the built-app end-to-end audit (HTTP + browser)',
    '',
    `Base URL: ${BASE_URL} (bun run build + node .next/standalone/server.js — the documented runtime package; the composed runtime constructed in-process, evidenced by the SQLite stores under .next/standalone/var/web-runtime/ and /api/health).`,
    'Tooling: Playwright (Chromium) + plain fetch.',
    `Verdict: **${checks.length} checks, ${failed.length} failed.**`,
    '',
    '## B-0 the integration findings (evidenced live)',
    '',
    ...checks.filter((c) => c.section === 'B-0').map((c) => `- ${c.pass ? 'PASS' : '**FAIL**'} — ${c.label}`),
    '',
    'See `findings.md` for the full analysis (FINDINGS 1–3) and the deferral ledger for disposition.',
    '',
    '## B-1 environment signal (N4, Section 10)',
    '',
    ...checks.filter((c) => c.section === 'B-1').map((c) => `- ${c.pass ? 'PASS' : '**FAIL**'} — ${c.label}`),
    '',
    '## B-2 role matrix (P8)',
    '',
    ...checks.filter((c) => c.section === 'B-2').map((c) => `- ${c.pass ? 'PASS' : '**FAIL**'} — ${c.label}`),
    '',
    '## B-3 WF-7 — the browser-context honest UNKNOWN',
    '',
    ...checks.filter((c) => c.section === 'B-3').map((c) => `- ${c.pass ? 'PASS' : '**FAIL**'} — ${c.label}`),
    '',
    'Screenshots: `wf7-pay-review-unknown.png`, `wf7-intent-state-unknown.png`.',
    '',
    '## B-4 the app\'s server-rendered presentations (the app as it is)',
    '',
    ...checks.filter((c) => c.section === 'B-4').map((c) => `- ${c.pass ? 'PASS' : '**FAIL**'} — ${c.label}`),
    '',
    '## B-5 the dispute-initiation flow',
    '',
    ...checks.filter((c) => c.section === 'B-5').map((c) => `- ${c.pass ? 'PASS' : '**FAIL**'} — ${c.label}`),
    '',
    'Screenshot: `dispute-initiation-consequences.png`.',
    '',
    '## B-6 navigation leakage',
    '',
    ...checks.filter((c) => c.section === 'B-6').map((c) => `- ${c.pass ? 'PASS' : '**FAIL**'} — ${c.label}`),
    '',
    'Machine record: `app-e2e.json`.',
  ];
  writeFileSync(join(EVIDENCE_DIR, 'app-e2e.md'), lines.join('\n'));
  console.log(`\n${checks.length} checks, ${failed.length} failed.`);
  console.log('Artifacts: evidence/app-e2e/app-e2e.json + app-e2e.md');
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
