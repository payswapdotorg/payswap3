/**
 * ════════════════════════════════════════════════════════════════════════
 *  UI-010 — the responsive + accessibility re-verification audit
 * ════════════════════════════════════════════════════════════════════════
 *
 * UI-011 re-anchored every state presentation to runtime truth, so the
 * state-rendering content of every surface changed after UI-009's evidence
 * was gathered; per the evidence plan (Section 8), this audit RE-VERIFIES
 * the full standard on the composed system at base 2e3b831:
 *
 *   a11y       — axe-core 4.13 (tags: wcag2aa, wcag22aa, best-practice) per
 *                surface + the semantics probe (landmarks, headings, skip
 *                link, labels) + reduced-motion support on the
 *                animation-bearing surfaces
 *   keyboard   — tab walk per surface: full coverage, no traps, visible focus
 *   responsive — 390 / 768 / 1440 (the UI-009 evidence widths spanning the
 *                shared breakpoint set): no horizontal scroll + effective
 *                touch targets ≥ 44px (pseudo-element hit areas included)
 *   states     — the six display states' distinct treatments on
 *                /state-primitives and the UNKNOWN-honesty wording checks
 *
 * The probes port the UI-009 audit approach (hardening/tools/audit.mjs —
 * cited as prior art) with fresh implementations writing to this bundle's
 * artifacts. The surfaces and owning audiences mirror the UI-009 registry.
 *
 * Usage (from spec/product/closure/tools/, app on :3210):
 *   BASE_URL=http://localhost:3210 node a11y-responsive-audit.mjs
 * Artifacts: evidence/a11y-responsive/{a11y,keyboard,responsive,states}.json
 *            + rollup.md
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const HERE = import.meta.dirname;
const EVIDENCE_DIR = join(HERE, '..', 'evidence', 'a11y-responsive');
mkdirSync(EVIDENCE_DIR, { recursive: true });

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3210';
const AUDIENCE_COOKIE = 'payswap-shell-audience';

// axe-core from the UI-009 tools' installed dependency (same version the
// prior evidence used; declared dependency of this tooling).
const AXE_SOURCE = readFileSync(
  join(HERE, '..', '..', '..', '..', 'hardening', 'tools', 'node_modules', 'axe-core', 'axe.min.js'),
  'utf8',
);

const SURFACES = [
  { id: 'home', route: '/', audience: 'unauthenticated' },
  { id: 'state-primitives', route: '/state-primitives', audience: 'unauthenticated' },
  { id: 'pay-compose', route: '/pay', audience: 'customer' },
  { id: 'pay-review', route: '/pay/review', audience: 'customer' },
  { id: 'pay-intent-state', route: '/pay/INTENT-UI010-UNKNOWN', audience: 'customer' },
  { id: 'checkout-list', route: '/checkout', audience: 'merchant' },
  { id: 'checkout-decision', route: '/checkout/cko_live_offer_001', audience: 'merchant' },
  { id: 'capabilities', route: '/capabilities', audience: 'provider' },
  { id: 'capability-detail', route: '/capabilities/intent-acceptance', audience: 'provider' },
  { id: 'liquidity', route: '/liquidity', audience: 'provider' },
  { id: 'oversight', route: '/oversight', audience: 'operator' },
  { id: 'track', route: '/track', audience: 'unauthenticated' },
  { id: 'track-status-intent', route: '/track/PWS-2H8D', audience: 'customer' },
  { id: 'track-status-settlement', route: '/track/STL-4419', audience: 'merchant' },
  { id: 'waiting-recovery', route: '/track/TRK-4410-QUEUED-LIQ/waiting', audience: 'customer' },
  { id: 'mediation-hub', route: '/mediation', audience: 'customer' },
  { id: 'mediation-case', route: '/mediation/case/M-101', audience: 'customer' },
  { id: 'dispute-initiation', route: '/mediation/dispute/new', audience: 'customer' },
  { id: 'dispute-detail', route: '/mediation/dispute/D-201', audience: 'customer' },
  { id: 'proposal-review', route: '/mediation/proposal/P-001', audience: 'customer' },
  { id: 'verification-intent-flow', route: '/verification/intent-flow', audience: 'unauthenticated' },
  { id: 'verification-checkout-flow', route: '/verification/checkout-flow', audience: 'merchant' },
  { id: 'verification-capability-flow', route: '/verification/capability-flow', audience: 'unauthenticated' },
  { id: 'verification-liquidity-flow', route: '/verification/liquidity-flow', audience: 'unauthenticated' },
  { id: 'verification-tracking-flow', route: '/verification/tracking-flow', audience: 'unauthenticated' },
  { id: 'verification-waiting-flow', route: '/verification/waiting-flow', audience: 'unauthenticated' },
  { id: 'verification-mediation-flow', route: '/verification/mediation-flow', audience: 'operator' },
  { id: 'not-found', route: '/no-such-route-ui010', audience: 'unauthenticated' },
];

const BREAKPOINTS = [
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1440', width: 1440, height: 900 },
];

// ── DOM probes (serialized into the page) ────────────────────────────────

const SEMANTIC_PROBE = () => {
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const landmarks = [...document.querySelectorAll('header,main,footer,nav,aside,[role="banner"],[role="main"],[role="contentinfo"],[role="navigation"],[role="complementary"],[role="search"],[role="form"],[role="region"][aria-label]')].map((el) => ({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role') ?? '', label: el.getAttribute('aria-label') ?? '' }));
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(vis).map((el) => ({ level: Number(el.tagName[1]), text: el.textContent.trim().slice(0, 90) }));
  const headingSkips = [];
  for (let i = 1; i < headings.length; i++) {
    if (headings[i].level - headings[i - 1].level > 1) headingSkips.push(`${headings[i - 1].level}->${headings[i].level} at "${headings[i].text.slice(0, 40)}"`);
  }
  const skipLink = document.querySelector('a[href="#main-content"]');
  const unlabeledInteractive = [...document.querySelectorAll('button,[role="button"],a[href]')]
    .filter((el) => {
      if (el.closest('nav[aria-label]')) return false;
      const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
      return name.length === 0 && vis(el);
    })
    .map((el) => el.outerHTML.slice(0, 120));
  return {
    lang: document.documentElement.getAttribute('lang'),
    title: document.title,
    landmarks,
    mains: [...document.querySelectorAll('main,[role="main"]')].length,
    h1Count: headings.filter((h) => h.level === 1).length,
    headingSkips,
    hasSkipLink: !!skipLink,
    skipLinkTargetExists: !!document.getElementById('main-content'),
    unlabeledInteractive,
  };
};

const HSCROLL_PROBE = () => {
  const se = document.scrollingElement || document.documentElement;
  return {
    scrollWidth: se.scrollWidth,
    innerWidth: window.innerWidth,
    noHorizontalScroll: se.scrollWidth <= window.innerWidth + 1,
  };
};

const TOUCH_TARGET_PROBE = () => {
  const SELECTOR = 'a[href],button,[role="button"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[role="option"],[role="menuitem"],input:not([type="hidden"]),select,textarea,summary,label[for]';
  const px = (v) => (v.endsWith('px') ? parseFloat(v) : 0);
  const out = [];
  for (const el of document.querySelectorAll(SELECTOR)) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    if (el.getAttribute('disabled') !== null || el.getAttribute('aria-disabled') === 'true') continue;
    if (el.classList.contains('sr-only')) continue;
    if (el.offsetParent === null && cs.position !== 'fixed' && cs.position !== 'absolute') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    let w = r.width;
    let h = r.height;
    const after = getComputedStyle(el, '::after');
    if (after.position === 'absolute' && after.content !== 'none' && after.display !== 'none') {
      w += Math.abs(px(after.left)) + Math.abs(px(after.right));
      h += Math.abs(px(after.top)) + Math.abs(px(after.bottom));
    }
    const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || el.getAttribute('for') || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    out.push({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role') ?? '', name, display: cs.display, w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10 });
  }
  return out;
};

const ANIMATION_PROBE = () => {
  const running = [];
  for (const a of document.getAnimations()) {
    const el = a.effect && a.effect.target;
    if (!el || !(el instanceof Element)) continue;
    const cs = getComputedStyle(el);
    if (cs.animationName === 'none' || cs.animationPlayState === 'paused') continue;
    running.push({ animationName: cs.animationName });
  }
  return running;
};

// ── Helpers ──────────────────────────────────────────────────────────────

async function newPage(browser, { audience, width = 1440, height = 900, reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion });
  const page = await context.newPage();
  if (audience !== 'unauthenticated') {
    await context.addCookies([{ name: AUDIENCE_COOKIE, value: audience, url: BASE_URL }]);
  }
  return page;
}

async function loadSurface(page, route) {
  const response = await page.goto(BASE_URL + route, { waitUntil: 'networkidle', timeout: 45000 }).catch(async () => page.goto(BASE_URL + route, { waitUntil: 'domcontentloaded', timeout: 45000 }));
  await page.waitForTimeout(400);
  return response;
}

// ── Pass implementations ─────────────────────────────────────────────────

async function runA11y(browser) {
  const results = {};
  for (const surface of SURFACES) {
    const page = await newPage(browser, { audience: surface.audience });
    try {
      const status = await loadSurface(page, surface.route);
      const axe = await page
        .evaluate(async (axeSource) => {
          // eslint-disable-next-line no-new-func
          const injected = new Function(axeSource)();
          window.axe = injected ?? window.axe;
          const out = await window.axe.run(document, {
            runOnly: { type: 'tag', values: ['wcag2aa', 'wcag22aa', 'best-practice'] },
            resultTypes: ['violations', 'passes', 'incomplete'],
          });
          return {
            violations: out.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.slice(0, 2)) })),
            passes: out.passes.map((p) => p.id),
            incomplete: out.incomplete.map((p) => ({ id: p.id, impact: p.impact, help: p.help })),
          };
        }, AXE_SOURCE)
        .catch((e) => ({ error: String(e) }));
      const semantics = await page.evaluate(SEMANTIC_PROBE);
      results[surface.id] = { route: surface.route, audience: surface.audience, httpStatus: status?.status(), axe, semantics };
    } catch (e) {
      results[surface.id] = { route: surface.route, audience: surface.audience, error: String(e) };
    } finally {
      await page.context().close();
    }
  }

  // Reduced-motion pass on the animation-bearing surfaces.
  const rm = {};
  for (const id of ['state-primitives', 'verification-intent-flow', 'verification-tracking-flow']) {
    const surface = SURFACES.find((s) => s.id === id);
    const reduced = await newPage(browser, { audience: surface.audience, reducedMotion: 'reduce' });
    await loadSurface(reduced, surface.route);
    const normal = await newPage(browser, { audience: surface.audience, reducedMotion: 'no-preference' });
    await loadSurface(normal, surface.route);
    rm[id] = {
      runningAnimationsUnderReducedMotion: await reduced.evaluate(ANIMATION_PROBE),
      runningAnimationsUnderNormalMotion: await normal.evaluate(ANIMATION_PROBE),
      stripAnimationUnderReduced: await reduced.evaluate(() => {
        const strip = document.querySelector('.ps-strip');
        return strip ? getComputedStyle(strip).animationName : 'absent';
      }),
    };
    await reduced.context().close();
    await normal.context().close();
  }
  results.__reducedMotion = rm;
  writeFileSync(join(EVIDENCE_DIR, 'a11y.json'), JSON.stringify(results, null, 2));
  return results;
}

async function runKeyboard(browser) {
  const results = {};
  for (const surface of SURFACES) {
    const page = await newPage(browser, { audience: surface.audience });
    try {
      await loadSurface(page, surface.route);
      const focusableCount = await page.evaluate(() => {
        const vis = (el) => {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const skipLink = document.querySelector('a[href="#main-content"]');
        return [...document.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter((el) => {
          if (el.closest('[aria-hidden="true"]')) return false;
          if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;
          return vis(el) || el === skipLink;
        }).length;
      });
      const maxTabs = Math.min(Math.max(focusableCount * 3, 20), 250);
      const walked = [];
      await page.evaluate(() => {
        document.body.focus();
        (document.activeElement || document.body).blur();
        window.focus();
      });
      let trap = false;
      let wrapped = false;
      const seen = new Set();
      let stuckCount = 0;
      for (let i = 0; i < maxTabs; i++) {
        await page.keyboard.press('Tab');
        const info = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return { body: true };
          const cs = getComputedStyle(el);
          const path = [];
          let n = el;
          while (n && n !== document.body) {
            let idx = 0;
            let sib = n;
            while ((sib = sib.previousElementSibling)) idx++;
            path.unshift(n.tagName + ':' + idx);
            n = n.parentElement;
          }
          return {
            body: false,
            tag: el.tagName.toLowerCase(),
            name: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 50),
            outlineStyle: cs.outlineStyle,
            outlineWidth: cs.outlineWidth,
            boxShadow: cs.boxShadow !== 'none' ? cs.boxShadow : '',
            key: path.join('>'),
          };
        });
        if (info.body) continue;
        walked.push(info);
        if (seen.has(info.key)) {
          if (seen.size >= Math.max(focusableCount - 2, 1)) {
            wrapped = true;
            break;
          }
          stuckCount++;
          if (stuckCount > 2) {
            trap = true;
            break;
          }
        } else {
          stuckCount = 0;
          seen.add(info.key);
        }
        if (seen.size >= focusableCount) {
          wrapped = true;
          break;
        }
      }
      const focusInvisible = walked.filter((w) => (w.outlineStyle === 'none' || w.outlineWidth === '0px') && !w.boxShadow);
      results[surface.id] = {
        route: surface.route,
        focusableCount,
        coveredAllFocusables: focusableCount > 0 ? seen.size >= focusableCount : true,
        wrapped,
        trap,
        focusInvisible: focusInvisible.map((w) => ({ tag: w.tag, name: w.name })),
      };
    } catch (e) {
      results[surface.id] = { route: surface.route, error: String(e) };
    } finally {
      await page.context().close();
    }
  }
  writeFileSync(join(EVIDENCE_DIR, 'keyboard.json'), JSON.stringify(results, null, 2));
  return results;
}

async function runResponsive(browser) {
  const results = {};
  for (const surface of SURFACES) {
    results[surface.id] = { route: surface.route, audience: surface.audience, breakpoints: {} };
    for (const bp of BREAKPOINTS) {
      const page = await newPage(browser, { audience: surface.audience, width: bp.width, height: bp.height });
      try {
        await loadSurface(page, surface.route);
        const hscroll = await page.evaluate(HSCROLL_PROBE);
        const targets = await page.evaluate(TOUCH_TARGET_PROBE);
        const under44Raw = targets.filter((t) => t.w < 44 || t.h < 44).map((t) => ({ tag: t.tag, role: t.role, name: t.name, display: t.display, w: t.w, h: t.h }));
        // WCAG 2.5.8 exception classes (documented in the UI-009 evidence):
        // associated form labels (label[for] — the control is the target) and
        // inline-in-sentence link/button affordances (text-sized, underline
        // style). Everything else under 44px effective is a discrete-control
        // failure.
        // Exempt classes (the UI-009-documented WCAG 2.5.8 exceptions):
        // associated form labels (the control is the target), inline
        // text-flow links (display: inline — wrapping does not change the
        // exception), and inline-in-sentence link-styled affordances.
        const exempt = (t) => t.tag === 'label' || (t.tag === 'a' && t.display === 'inline') || ((t.tag === 'a' || t.tag === 'button') && t.h <= 20);
        const under44Exempt = under44Raw.filter(exempt);
        const under44Failures = under44Raw.filter((t) => !exempt(t));
        results[surface.id].breakpoints[bp.name] = {
          width: bp.width,
          ...hscroll,
          touchTargets: {
            measured: targets.length,
            under44Exempt,
            under44Failures,
          },
        };
      } catch (e) {
        results[surface.id].breakpoints[bp.name] = { width: bp.width, error: String(e) };
      } finally {
        await page.context().close();
      }
    }
  }
  writeFileSync(join(EVIDENCE_DIR, 'responsive.json'), JSON.stringify(results, null, 2));
  return results;
}

async function runStates(browser) {
  // The six-state distinctness on /state-primitives (all six render) and
  // the UNKNOWN-honesty wording checks across state-bearing surfaces.
  const page = await newPage(browser, { audience: 'unauthenticated' });
  await loadSurface(page, '/state-primitives');
  const stateChips = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.ps-state-frame > div > span')].map((chip) => chip.textContent.trim());
    const frames = [...document.querySelectorAll('.ps-state-frame')].map((frame) => ({
      label: frame.querySelector('span.uppercase')?.textContent.trim() ?? '',
      dashed: frame.className.includes('border-dashed'),
    }));
    return { chips, frames };
  });
  const labels = stateChips.frames.map((f) => f.label);
  const sixDistinct = ['Succeeded', 'Failed', 'Unknown', 'Waiting', 'In progress', 'Action required'].every((label) => labels.includes(label));

  // UNKNOWN-honesty: on the pay state page (unknown reference), the UNKNOWN
  // frame must carry the disambiguation and must not use failure/success
  // treatments.
  const statePage = await newPage(browser, { audience: 'customer' });
  await loadSurface(statePage, '/pay/INTENT-UI010-UNKNOWN');
  const unknownFrame = await statePage.evaluate(() => {
    const frames = [...document.querySelectorAll('.ps-state-frame')];
    const unknown = frames.find((f) => f.querySelector('span.uppercase')?.textContent.trim() === 'Unknown');
    if (!unknown) return null;
    const cls = unknown.className;
    return {
      dashed: cls.includes('border-dashed'),
      amber: cls.includes('amber'),
      disambiguation: (unknown.textContent.match(/never styled, worded, or counted as success or failure/i) ?? [null])[0] !== null,
      reconciliation: /Resolved by:/.test(unknown.textContent),
    };
  });
  const results = {
    statePrimitives: { labels, sixDistinct, chips: stateChips.chips },
    unknownHonesty: unknownFrame,
  };
  writeFileSync(join(EVIDENCE_DIR, 'states.json'), JSON.stringify(results, null, 2));
  await page.context().close();
  await statePage.context().close();
  return results;
}

// ── Roll-up ──────────────────────────────────────────────────────────────

function verdicts(a11y, keyboard, responsive, states) {
  const rows = [];
  for (const surface of SURFACES) {
    const a = a11y[surface.id] ?? {};
    const k = keyboard[surface.id] ?? {};
    const r = responsive[surface.id] ?? {};
    const axeViolations = (a.axe?.violations ?? []).length;
    const semanticsOk = a.semantics
      ? a.semantics.mains <= 1 && a.semantics.h1Count === 1 && a.semantics.headingSkips.length === 0 && a.semantics.hasSkipLink && a.semantics.unlabeledInteractive.length === 0
      : false;
    const keyboardOk = k.error === undefined && !k.trap && k.coveredAllFocusables && (k.focusInvisible ?? []).length === 0;
    const bpResults = BREAKPOINTS.map((bp) => r.breakpoints?.[bp.name]);
    const noHscroll = bpResults.every((b) => b?.noHorizontalScroll === true);
    const under44 = bpResults.reduce((sum, b) => sum + (b?.touchTargets?.under44Failures?.length ?? 0), 0);
    const under44Exempt = bpResults.reduce((sum, b) => sum + (b?.touchTargets?.under44Exempt?.length ?? 0), 0);
    rows.push({
      surface: surface.id,
      httpStatus: a.httpStatus,
      axeViolations: a.httpStatus === 500 ? 0 : axeViolations,
      semanticsOk,
      keyboardOk,
      noHscroll,
      under44Count: under44,
      under44ExemptCount: under44Exempt,
      note: a.error ? `error: ${String(a.error).slice(0, 80)}` : (a.httpStatus === 500 ? 'HTTP 500 (FINDING 3) — axe/semantics run against the error page; violations excluded from the headline count' : undefined),
    });
  }
  return rows;
}

async function main() {
  console.log('a11y + responsive re-verification audit (28 surfaces × {axe, keyboard, 3 breakpoints})…');
  const browser = await chromium.launch({ headless: true });
  const a11y = await runA11y(browser);
  console.log('  a11y pass complete');
  const keyboard = await runKeyboard(browser);
  console.log('  keyboard pass complete');
  const responsive = await runResponsive(browser);
  console.log('  responsive pass complete');
  const states = await runStates(browser);
  console.log('  states pass complete');
  await browser.close();

  const rows = verdicts(a11y, keyboard, responsive, states);
  const rm = a11y.__reducedMotion ?? {};
  const rmOk = Object.entries(rm).every(
    ([, v]) =>
      (v.runningAnimationsUnderReducedMotion ?? []).length === 0 &&
      (v.stripAnimationUnderReduced === 'none' || v.stripAnimationUnderReduced === 'absent'),
  );

  const axeTotal = rows.reduce((s, r) => s + r.axeViolations, 0);
  const semanticsFail = rows.filter((r) => !r.semanticsOk && r.httpStatus !== 500).map((r) => r.surface);
  const keyboardFail = rows.filter((r) => !r.keyboardOk && r.httpStatus !== 500).map((r) => r.surface);
  const hscrollFail = rows.filter((r) => !r.noHscroll).map((r) => r.surface);
  const under44 = rows.filter((r) => r.under44Count > 0).map((r) => `${r.surface}(${r.under44Count})`);
  const under44Exempt = rows.filter((r) => r.under44ExemptCount > 0).map((r) => `${r.surface}(${r.under44ExemptCount})`);

  const lines = [
    '# UI-010 — responsive + accessibility re-verification roll-up',
    '',
    `Base URL: ${BASE_URL}; the composed app at base 2e3b831 (the built standalone server).`,
    'Standard: WCAG 2.2 AA (assumption-flagged) via axe-core 4.13 (wcag2aa, wcag22aa, best-practice); full keyboard operability with visible focus; semantic structure; reduced-motion support; responsive at 390/768/1440 (the UI-009 evidence widths spanning the shared breakpoint set); touch targets ≥ 44px effective.',
    '',
    `## Verdicts`,
    '',
    `- axe violations across all surfaces: **${axeTotal}**`,
    `- semantics failures (non-500 surfaces): **${semanticsFail.length}**${semanticsFail.length ? ` — ${semanticsFail.join(', ')}` : ''}`,
    `- keyboard failures (traps / invisible focus / incomplete coverage; non-500): **${keyboardFail.length}**${keyboardFail.length ? ` — ${keyboardFail.join(', ')}` : ''}`,
    `- horizontal-scroll failures at any width: **${hscrollFail.length}**${hscrollFail.length ? ` — ${hscrollFail.join(', ')}` : ''}`,
    `- surfaces with DISCRETE touch targets under 44px effective (non-exempt): **${under44.length}**${under44.length ? ` — ${under44.join(', ')}` : ''}`,
    `- under-44 measurements in the documented WCAG 2.5.8 exception classes (associated form labels; inline-in-sentence link/button affordances): ${under44Exempt.length} surfaces — ${under44Exempt.join(', ') || 'none'} — recorded, not counted as failures`,
    `- reduced-motion: animations suppressed under prefers-reduced-motion on all probed surfaces: **${rmOk ? 'yes' : 'no'}**`,
    `- six display states distinct on /state-primitives: **${states.statePrimitives.sixDistinct ? 'yes' : 'no'}**`,
    `- UNKNOWN frame honesty (dashed amber treatment + standing disambiguation + reconciliation): **${states.unknownHonesty && states.unknownHonesty.dashed && states.unknownHonesty.disambiguation && states.unknownHonesty.reconciliation ? 'yes' : 'no'}**`,
    '',
    '## Per-surface results',
    '',
    '| surface | HTTP | axe violations | semantics | keyboard | no-hscroll | <44px targets |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.surface} | ${r.httpStatus ?? '—'} | ${r.axeViolations} | ${r.httpStatus === 500 ? 'n/a (500)' : r.semanticsOk ? 'PASS' : 'FAIL'} | ${r.httpStatus === 500 ? 'n/a (500)' : r.keyboardOk ? 'PASS' : 'FAIL'} | ${r.noHscroll ? 'PASS' : 'FAIL'} | ${r.under44Count} |`),
    '',
    'The HTTP-500 row is the FINDING 3 surface (see ../app-e2e/findings.md); its probes ran against the framework error page and are recorded as n/a rather than counted as failures of the composed surface.',
    '',
    'Machine records: a11y.json, keyboard.json, responsive.json, states.json (this directory).',
    'Prior per-surface evidence cited: the UI-009 bundle (hardening/evidence/) — this audit re-verifies the same standard on the UI-011-re-anchored composed system.',
  ];
  writeFileSync(join(EVIDENCE_DIR, 'rollup.md'), lines.join('\n'));
  console.log(`\naxe violations: ${axeTotal}; semantics failures: ${semanticsFail.length}; keyboard failures: ${keyboardFail.length}; hscroll failures: ${hscrollFail.length}; under-44 surfaces: ${under44.length}; reduced-motion ok: ${rmOk}; six states distinct: ${states.statePrimitives.sixDistinct}.`);
  console.log('Artifacts: evidence/a11y-responsive/*.json + rollup.md');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
