/**
 * UI-009 audit runner.
 *
 * Usage:
 *   node audit.mjs a11y        — axe + semantics + reduced-motion per surface
 *   node audit.mjs keyboard    — tab walk, focus visibility, native semantics
 *   node audit.mjs responsive  — hscroll + touch targets per breakpoint
 *   node audit.mjs roles       — role matrix (deep links + nav rendering)
 *   node audit.mjs states      — explicit-state re-verification
 *
 * Writes raw JSON evidence to hardening/evidence/raw/<pass>.json.
 * All checks run against the live dev server on localhost:3000.
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from './surfaces.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(__dirname, '../evidence/raw');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const AXE_SOURCE = fs.readFileSync(
  path.resolve(__dirname, 'node_modules/axe-core/axe.min.js'),
  'utf8',
);

async function newPage(browser, { audience, width = 1440, height = 900, reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion,
  });
  const page = await context.newPage();
  if (audience !== undefined) {
    await page.context().addCookies([
      { name: S.AUDIENCE_COOKIE, value: audience, url: S.BASE_URL },
    ]);
  }
  return page;
}

async function loadSurface(page, route) {
  const response = await page.goto(S.BASE_URL + route, {
    waitUntil: 'networkidle',
    timeout: 45000,
  });
  // Give client components a frame to hydrate.
  await page.waitForTimeout(400);
  return response;
}

function slug(id) {
  return id.replace(/[^a-z0-9-]/gi, '-');
}

// ---------------------------------------------------------------------------
// DOM probes (serialized into the page)
// ---------------------------------------------------------------------------

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
  const focusables = [...document.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter((el) => {
    if (el.closest('[aria-hidden="true"]')) return false;
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;
    return vis(el) || el === skipLink;
  });
  const nonNativeInteractive = [...document.querySelectorAll('[role="button"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[role="option"],[role="menuitem"]')].map((el) => {
    const native = ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A'].includes(el.tagName);
    return { role: el.getAttribute('role'), tag: el.tagName, name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 60), native };
  }).filter((x) => !x.native);
  return {
    lang: document.documentElement.getAttribute('lang'),
    title: document.title,
    landmarks,
    mains: [...document.querySelectorAll('main,[role="main"]')].length,
    h1Count: headings.filter((h) => h.level === 1).length,
    headings,
    headingSkips,
    hasSkipLink: !!skipLink,
    skipLinkTargetExists: !!document.getElementById('main-content'),
    focusableCount: focusables.length,
    nonNativeInteractive,
    unlabeledInteractive: [...document.querySelectorAll('button,[role="button"],a[href]')]
      .filter((el) => {
        if (el.closest('nav[aria-label]')) return false;
        const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
        return name.length === 0 && vis(el);
      })
      .map((el) => el.outerHTML.slice(0, 120)),
  };
};

const HSCROLL_PROBE = () => {
  const se = document.scrollingElement || document.documentElement;
  const tol = 1;
  return {
    scrollWidth: se.scrollWidth,
    clientWidth: se.clientWidth,
    innerWidth: window.innerWidth,
    noHorizontalScroll: se.scrollWidth <= window.innerWidth + tol,
    docHeight: se.scrollHeight,
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
    // skip visually-hidden affordances (sr-only skip links: not touch targets)
    if (el.classList.contains('sr-only')) continue;
    if (el.offsetParent === null && cs.position !== 'fixed' && cs.position !== 'absolute') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    // Effective hit area: expand by an absolute-positioned ::after pseudo
    // (radios, checkboxes, and switches reserve an invisible hit region).
    let w = r.width;
    let h = r.height;
    const after = getComputedStyle(el, '::after');
    if (after.position === 'absolute' && after.content !== 'none' && after.display !== 'none') {
      w += Math.abs(px(after.left)) + Math.abs(px(after.right));
      h += Math.abs(px(after.top)) + Math.abs(px(after.bottom));
    }
    const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || el.getAttribute('for') || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    out.push({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') ?? '',
      name,
      visualW: Math.round(r.width * 10) / 10,
      visualH: Math.round(r.height * 10) / 10,
      w: Math.round(w * 10) / 10,
      h: Math.round(h * 10) / 10,
      under44: w < 44 || h < 44,
      under24: w < 24 || h < 24,
    });
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
    running.push({
      animationName: cs.animationName,
      iteration: cs.animationIterationCount,
      duration: cs.animationDuration,
      element: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).slice(0, 3).join('.') : ''),
    });
  }
  return running;
};

// ---------------------------------------------------------------------------
// Pass: a11y (axe + semantics + reduced motion)
// ---------------------------------------------------------------------------

async function runA11y() {
  const browser = await chromium.launch();
  const results = {};
  for (const surface of S.SURFACES) {
    const page = await newPage(browser, { audience: surface.audience });
    try {
      const response = await loadSurface(page, surface.route);
      const status = response ? response.status() : null;
      const axe = await page.evaluate(async (AXE_SRC) => {
        // eslint-disable-next-line no-eval
        (0, eval)(AXE_SRC);
        const out = await window.axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2aa', 'wcag22aa', 'best-practice'] },
          resultTypes: ['violations', 'passes', 'incomplete', 'inapplicable'],
        });
        return {
          violations: out.violations.map((v) => ({
            id: v.id, impact: v.impact, help: v.help, tags: v.tags.filter((t) => t.startsWith('wcag') || t === 'best-practice'),
            nodes: v.nodes.slice(0, 12).map((n) => ({ target: n.target.slice(0, 3), html: (n.html || '').slice(0, 160), failureSummary: (n.failureSummary || '').slice(0, 300) })),
          })),
          passes: out.passes.map((p) => p.id),
          incomplete: out.incomplete.map((p) => ({ id: p.id, impact: p.impact, help: p.help, nodes: p.nodes.map((n) => ({ target: n.target.slice(0, 2), failureSummary: (n.failureSummary || '').slice(0, 200) })) })),
          inapplicable: out.inapplicable.map((p) => p.id),
        };
      }, AXE_SOURCE).catch((e) => ({ error: String(e) }));
      const semantics = await page.evaluate(SEMANTIC_PROBE);
      results[surface.id] = { route: surface.route, audience: surface.audience, httpStatus: status, axe, semantics };
    } catch (e) {
      results[surface.id] = { route: surface.route, audience: surface.audience, error: String(e) };
    } finally {
      await page.context().close();
    }
  }

  // Reduced-motion pass on state-bearing animations (state-primitives shows all six).
  const rm = {};
  for (const id of ['state-primitives', 'verification-intent-flow', 'verification-tracking-flow']) {
    const surface = S.SURFACES.find((s) => s.id === id);
    const page = await newPage(browser, { audience: surface.audience, reducedMotion: 'reduce' });
    try {
      await loadSurface(page, surface.route);
      const normalPage = await newPage(browser, { audience: surface.audience, reducedMotion: 'no-preference' });
      await loadSurface(normalPage, surface.route);
      rm[id] = {
        route: surface.route,
        runningAnimationsUnderReducedMotion: await page.evaluate(ANIMATION_PROBE),
        runningAnimationsUnderNormalMotion: await normalPage.evaluate(ANIMATION_PROBE),
        arcProbe: await page.evaluate(() => {
          const el = document.querySelector('.ps-arc');
          const strip = document.querySelector('.ps-strip');
          const get = (n) => (n ? getComputedStyle(n).animationName : 'absent');
          return { arcAnimation: get(el), stripAnimation: get(strip) };
        }),
      };
      await normalPage.context().close();
    } finally {
      await page.context().close();
    }
  }
  results.__reducedMotion = rm;
  await browser.close();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'a11y.json'), JSON.stringify(results, null, 2));
  console.log('a11y pass complete');
}

// ---------------------------------------------------------------------------
// Pass: keyboard
// ---------------------------------------------------------------------------

async function runKeyboard() {
  const browser = await chromium.launch();
  const results = {};
  for (const surface of S.SURFACES) {
    const page = await newPage(browser, { audience: surface.audience });
    try {
      await loadSurface(page, surface.route);
      const probe = await page.evaluate(SEMANTIC_PROBE);
      const focusableCount = probe.focusableCount;
      const maxTabs = Math.min(Math.max(focusableCount * 3, 20), 250);
      const walked = [];
      await page.evaluate(() => { document.body.focus(); (document.activeElement || document.body).blur(); window.focus(); });
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
          const r = el.getBoundingClientRect();
          // unique DOM path (position among siblings) — same-named links get distinct keys
          const path = [];
          let n = el;
          while (n && n !== document.body) {
            let idx = 0, sib = n;
            while ((sib = sib.previousElementSibling)) idx++;
            path.unshift(n.tagName + ':' + idx);
            n = n.parentElement;
          }
          return {
            body: false,
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute('role') ?? '',
            name: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 50),
            id: el.id || '',
            outlineStyle: cs.outlineStyle,
            outlineWidth: cs.outlineWidth,
            outlineColor: cs.outlineColor,
            boxShadow: cs.boxShadow !== 'none' ? cs.boxShadow : '',
            visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top <= window.innerHeight,
            key: path.join('>'),
          };
        });
        if (info.body) continue;
        walked.push(info);
        if (seen.has(info.key)) {
          // Focus revisited an element already visited.
          if (seen.size >= Math.max(focusableCount - 2, 1)) { wrapped = true; break; }
          // revisit before covering focusables: could be a cycle — allow 2 repeats (jump links), then trap
          stuckCount++;
          if (stuckCount > 2) { trap = true; break; }
        } else {
          stuckCount = 0;
          seen.add(info.key);
        }
        if (seen.size >= focusableCount) { wrapped = true; break; }
      }
      const focusInvisible = walked.filter((w) => (w.outlineStyle === 'none' || w.outlineWidth === '0px') && !w.boxShadow);
      results[surface.id] = {
        route: surface.route,
        audience: surface.audience,
        focusableCount,
        stepsWalked: walked.length,
        coveredAllFocusables: seen.size >= focusableCount && focusableCount > 0,
        wrapped,
        trap,
        focusInvisible: focusInvisible.map((w) => ({ tag: w.tag, name: w.name, outlineStyle: w.outlineStyle })),
        walkOrder: walked.map((w) => `${w.tag}${w.id ? '#' + w.id : ''} "${w.name}"`),
        nonNativeInteractive: probe.nonNativeInteractive,
        unlabeledInteractive: probe.unlabeledInteractive,
      };
    } catch (e) {
      results[surface.id] = { route: surface.route, error: String(e) };
    } finally {
      await page.context().close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'keyboard.json'), JSON.stringify(results, null, 2));
  console.log('keyboard pass complete');
}

// ---------------------------------------------------------------------------
// Pass: responsive
// ---------------------------------------------------------------------------

async function runResponsive() {
  const browser = await chromium.launch();
  const results = {};
  for (const surface of S.SURFACES) {
    results[surface.id] = { route: surface.route, audience: surface.audience, breakpoints: {} };
    for (const bp of S.BREAKPOINTS) {
      const page = await newPage(browser, { audience: surface.audience, width: bp.width, height: bp.height });
      try {
        await loadSurface(page, surface.route);
        const hscroll = await page.evaluate(HSCROLL_PROBE);
        const targets = await page.evaluate(TOUCH_TARGET_PROBE);
        results[surface.id].breakpoints[bp.name] = {
          width: bp.width,
          ...hscroll,
          touchTargets: {
            measured: targets.length,
            under44: targets.filter((t) => t.under44 && !t.under24),
            under24: targets.filter((t) => t.under24),
          },
        };
      } catch (e) {
        results[surface.id].breakpoints[bp.name] = { width: bp.width, error: String(e) };
      } finally {
        await page.context().close();
      }
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'responsive.json'), JSON.stringify(results, null, 2));
  console.log('responsive pass complete');
}

// ---------------------------------------------------------------------------
// Pass: roles
// ---------------------------------------------------------------------------

async function runRoles() {
  const browser = await chromium.launch();
  const results = { navigation: {}, deepLinks: {}, contentGates: {} };
  for (const audience of S.AUDIENCES) {
    const page = await newPage(browser, { audience });
    try {
      await loadSurface(page, '/');
      results.navigation[audience] = await page.evaluate(() => {
        const read = (label) => {
          const nav = [...document.querySelectorAll('nav')].find((n) => n.getAttribute('aria-label') === label);
          if (!nav) return [];
          return [...nav.querySelectorAll('a')].map((a) => ({ text: a.textContent.trim().replace(/\s+/g, ' '), href: a.getAttribute('href') }));
        };
        return { primary: read('Primary'), footer: read('Footer') };
      });
    } finally {
      await page.context().close();
    }
  }
  for (const surface of S.SURFACES) {
    results.deepLinks[surface.id] = { route: surface.route, expected: surface.deepLink, declared: surface.deepLinkDeclared, observed: {}, content: {} };
    for (const audience of S.AUDIENCES) {
      const page = await newPage(browser, { audience });
      try {
        const response = await page.goto(S.BASE_URL + surface.route, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(500);
        const url = page.url().replace(S.BASE_URL, '') || '/';
        const finalUrl = url.split('?')[0];
        const content = await page.evaluate(() => {
          const main = document.querySelector('main');
          const h1 = document.querySelector('main h1, h1');
          const fullText = (main ? main.textContent : document.body.textContent).replace(/\s+/g, ' ').trim();
          return {
            mainTextHead: fullText.slice(0, 220),
            mainTextFull: fullText,
            h1: h1 ? h1.textContent.trim().slice(0, 90) : null,
            title: document.title,
          };
        });
        const observed = finalUrl === '/' && surface.route !== '/' ? 'home' : 'render';
        results.deepLinks[surface.id].observed[audience] = { observed, httpStatus: response ? response.status() : null, finalUrl, content };
        if (surface.contentGate && observed === 'render') {
          const text = content.mainTextFull.toLowerCase();
          const gate = surface.contentGate;
          const seesRecord = audience === 'unauthenticated'
            ? false
            : !text.includes('not authorized') && !text.includes('not authorized'.toUpperCase());
          // Record-level denial signatures only — action-level wording
          // ("Not authorized: Customers do not request re-queue evaluation
          // directly…") is recovery-action guidance, not a record denial.
          const isDeniedPresentation =
            text.includes('waiting detail is not visible to the') ||
            text.includes('reference is not viewable in your current role') ||
            text.includes('the current viewer role is not authorized to see it');
          results.contentGates[`${surface.id}:${audience}`] = {
            expected: gate.authorized.includes(audience) ? 'record' : 'not-authorized presentation',
            deniedPresentation: isDeniedPresentation,
          };
        }
      } catch (e) {
        results.deepLinks[surface.id].observed[audience] = { error: String(e) };
      } finally {
        await page.context().close();
      }
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'roles.json'), JSON.stringify(results, null, 2));
  console.log('roles pass complete');
}

// ---------------------------------------------------------------------------
// Pass: explicit states
// ---------------------------------------------------------------------------

async function runStates() {
  const browser = await chromium.launch();
  const results = {};

  // Six-state matrix on the state-primitives surface.
  {
    const page = await newPage(browser, { audience: 'unauthenticated' });
    await loadSurface(page, '/state-primitives');
    results.statePrimitivesMatrix = await page.evaluate(() => {
      const labels = ['Succeeded', 'Failed', 'Unknown', 'Waiting', 'In progress', 'Action required'];
      const frames = [...document.querySelectorAll('.ps-state-frame')];
      const found = {};
      for (const label of labels) {
        const frame = frames.find((f) => f.textContent.includes(label));
        if (!frame) { found[label] = null; continue; }
        const cs = getComputedStyle(frame);
        const chip = [...frame.querySelectorAll('span')].find((s) => s.textContent.trim() === label);
        const chipCs = chip ? getComputedStyle(chip) : null;
        const toRgb = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); return m ? m[1].split(',').slice(0, 3).map(Number) : null; };
        const rgb = toRgb(chipCs ? chipCs.backgroundColor : 'rgb(0,0,0)');
        found[label] = {
          borderStyle: cs.borderTopStyle,
          borderWidth: cs.borderTopWidth,
          borderColor: cs.borderTopColor,
          chipBackground: chipCs ? chipCs.backgroundColor : null,
          chipText: chipCs ? chipCs.color : null,
          hue: rgb ? (rgb[0] === rgb[1] && rgb[1] === rgb[2] ? 'gray' : 'colored') : null,
          carriesDisambiguation: label === 'Unknown' ? frame.textContent.includes('Unknown is not a success verdict and not a failure verdict') : undefined,
        };
      }
      return {
        frameCount: frames.length,
        states: found,
        distinctTreatments: new Set(frames.map((f) => getComputedStyle(f).borderTopStyle + '|' + getComputedStyle(f).borderTopWidth + '|' + getComputedStyle(f).backgroundColor)).size,
        bodyTextHasAmbiguousPending: /\bpending\b/i.test(document.querySelector('main').textContent),
        pendingMatches: (document.querySelector('main').textContent.match(/[^.]{0,60}\bpending\b[^.]{0,60}/gi) || []).slice(0, 6),
      };
    });
    await page.context().close();
  }

  // Track reference pages across all six display states.
  results.trackReferences = {};
  for (const ref of S.STATE_REFERENCE_PAGES) {
    const page = await newPage(browser, { audience: ref.audience });
    await loadSurface(page, ref.route);
    results.trackReferences[ref.route] = await page.evaluate((expect) => {
      const main = document.querySelector('main');
      const text = main.textContent;
      const frames = [...main.querySelectorAll('.ps-state-frame')];
      const state = frames.map((f) => {
        const cs = getComputedStyle(f);
        const label = [...f.querySelectorAll('span')].map((s) => s.textContent.trim()).find((t) => /^(Succeeded|Failed|Unknown|Waiting|In progress|Action required)$/.test(t)) || null;
        return { label, borderStyle: cs.borderTopStyle, backgroundColor: cs.backgroundColor };
      });
      return {
        expectedDisplayState: expect,
        statesPresented: state,
        containsAmbiguousPendingWord: /\bpending\b/i.test(text),
        pendingMatches: (text.match(/[^.]{0,60}\bpending\b[^.]{0,60}/gi) || []).slice(0, 4),
        unknownWordedAsSuccessOrFail: /unknown[^.]{0,80}(succeed|success|failed|failure)/i.test(text) && !text.includes('Unknown is not a success verdict and not a failure verdict'),
      };
    }, ref.expect);
    await page.context().close();
  }

  // UNKNOWN deep link on pay surface.
  {
    const page = await newPage(browser, { audience: 'customer' });
    await loadSurface(page, '/pay/INTENT-2041');
    results.payUnknownDeepLink = await page.evaluate(() => {
      const main = document.querySelector('main');
      const text = main.textContent;
      return {
        h1: document.querySelector('h1') ? document.querySelector('h1').textContent.trim().slice(0, 80) : null,
        rendersUnknownPresentation: /Unknown/.test(text),
        carriesDisambiguation: text.includes('Unknown is not a success verdict and not a failure verdict'),
        bodyText: text.replace(/\s+/g, ' ').slice(0, 400),
      };
    });
    await page.context().close();
  }

  // Grep-style wording scan across every surface's rendered main text.
  results.wordingScan = {};
  for (const surface of S.SURFACES) {
    const page = await newPage(browser, { audience: surface.audience });
    await loadSurface(page, surface.route);
    results.wordingScan[surface.id] = await page.evaluate(() => {
      const main = document.querySelector('main');
      const text = main ? main.textContent : '';
      return {
        ambiguousPending: (text.match(/[^.]{0,50}\bpending\b[^.]{0,50}/gi) || []).slice(0, 4),
        unknownAsOutcome: /status: (success|succeeded|failed)/i.test(text) ? true : false,
      };
    });
    await page.context().close();
  }
  await browser.close();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'states.json'), JSON.stringify(results, null, 2));
  console.log('states pass complete');
}

// ---------------------------------------------------------------------------

const pass = process.argv[2];
const passes = { a11y: runA11y, keyboard: runKeyboard, responsive: runResponsive, roles: runRoles, states: runStates };
if (!passes[pass]) {
  console.error('Usage: node audit.mjs <a11y|keyboard|responsive|roles|states>');
  process.exit(1);
}
await passes[pass]();
