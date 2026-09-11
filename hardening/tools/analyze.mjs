/**
 * UI-009 pre-fix analysis: summarize raw audit JSON into a violation ledger
 * (markdown) for human review + remediation planning.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.resolve(__dirname, '../evidence/raw');
const read = (f) => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));

const a11y = read('a11y.json');
const kb = read('keyboard.json');
const resp = read('responsive.json');
const roles = read('roles.json');
const states = read('states.json');

const out = [];
const p = (s) => out.push(s);

p('# UI-009 PRE-FIX AUDIT FINDINGS (raw summary)');
p('');

// --- axe violations ---
p('## Accessibility (axe-core 4.13, tags wcag2aa + wcag22aa + best-practice)');
let axeViolations = 0;
for (const [id, r] of Object.entries(a11y)) {
  if (id.startsWith('__')) continue;
  if (r.error) { p(`- ${id}: ERROR ${r.error}`); continue; }
  const vs = r.axe.violations || [];
  if (vs.length) {
    p(`### ${id} (${r.route})`);
    for (const v of vs) {
      axeViolations++;
      p(`- [${v.impact}] ${v.id} — ${v.help} (${v.tags.join(', ')})`);
      for (const n of v.nodes.slice(0, 4)) p(`    - target: ${JSON.stringify(n.target)} :: ${n.html.slice(0, 110)}`);
    }
  } else {
    p(`- ${id}: 0 violations (${(r.axe.passes || []).length} passes)`);
  }
}
p('');
p(`TOTAL axe violation rules across surfaces: ${axeViolations}`);
p('');

// --- semantics ---
p('## Semantics (landmarks / headings / labels)');
for (const [id, r] of Object.entries(a11y)) {
  if (id.startsWith('__') || r.error) continue;
  const s = r.semantics;
  const issues = [];
  if (!s.lang) issues.push('no lang');
  if (s.mains !== 1) issues.push(`mains=${s.mains}`);
  if (s.h1Count !== 1) issues.push(`h1Count=${s.h1Count}`);
  if (s.headingSkips.length) issues.push(`heading skips: ${s.headingSkips.join('; ')}`);
  if (!s.hasSkipLink) issues.push('no skip link');
  if (!s.skipLinkTargetExists) issues.push('skip target missing');
  if (s.nonNativeInteractive.length) issues.push(`non-native interactive: ${JSON.stringify(s.nonNativeInteractive.slice(0, 5))}`);
  if (s.unlabeledInteractive.length) issues.push(`unlabeled interactive: ${s.unlabeledInteractive.length}`);
  if (issues.length) p(`- ${id} (${r.route}): ${issues.join(' | ')}`);
}
p('');

// --- reduced motion ---
p('## Reduced motion');
p('```json');
p(JSON.stringify(a11y.__reducedMotion, null, 1).slice(0, 3000));
p('```');
p('');

// --- keyboard ---
p('## Keyboard');
for (const [id, r] of Object.entries(kb)) {
  if (r.error) { p(`- ${id}: ERROR ${r.error}`); continue; }
  const issues = [];
  if (r.trap) issues.push('TRAP');
  if (!r.coveredAllFocusables && r.focusableCount > 0) issues.push(`covered ${r.stepsWalked}/${r.focusableCount}`);
  if (r.focusInvisible.length) issues.push(`invisible focus on ${r.focusInvisible.length}: ${r.focusInvisible.map((f) => `${f.tag}"${f.name}"`).join(', ')}`);
  if (r.nonNativeInteractive.length) issues.push(`non-native interactive ${r.nonNativeInteractive.length}`);
  if (issues.length) p(`- ${id} (${r.route}): ${issues.join(' | ')}`);
}
p('');

// --- responsive ---
p('## Responsive (390/768/1440: hscroll + touch targets)');
for (const [id, r] of Object.entries(resp)) {
  for (const [bp, b] of Object.entries(r.breakpoints || {})) {
    if (b.error) { p(`- ${id}@${bp}: ERROR`); continue; }
    const issues = [];
    if (!b.noHorizontalScroll) issues.push(`HSCROLL scrollWidth=${b.scrollWidth} innerWidth=${b.innerWidth}`);
    if (b.touchTargets.under24.length) issues.push(`touch<24px: ${b.touchTargets.under24.map((t) => `${t.tag}"${t.name}"(${t.w}x${t.h})`).join(', ').slice(0, 400)}`);
    if (b.touchTargets.under44.length) issues.push(`touch<44px: ${b.touchTargets.under44.map((t) => `${t.tag}"${t.name}"(${t.w}x${t.h})`).join(', ').slice(0, 500)}`);
    if (issues.length) p(`- ${id}@${bp}: ${issues.join(' | ')}`);
  }
}
p('');

// --- roles ---
p('## Role matrix — deep links');
let leaks = 0;
for (const [id, r] of Object.entries(roles.deepLinks)) {
  const mismatches = [];
  for (const [aud, obs] of Object.entries(r.observed)) {
    if (obs.error) { mismatches.push(`${aud}: ERROR`); continue; }
    const expected = r.expected[aud];
    if (expected !== obs.observed) {
      leaks++;
      mismatches.push(`${aud}: expected=${expected} observed=${obs.observed} (status ${obs.httpStatus}, final ${obs.finalUrl})`);
    }
  }
  if (mismatches.length) p(`- ${id} (${r.route}): ${mismatches.join(' | ')}`);
}
p('');
p('## Role matrix — navigation per audience');
p('```json');
p(JSON.stringify(roles.navigation, null, 1));
p('```');
p('');

// --- states ---
p('## Explicit states');
p('```json');
p(JSON.stringify({ statePrimitivesMatrix: states.statePrimitivesMatrix, payUnknownDeepLink: states.payUnknownDeepLink, wordingScan: states.wordingScan }, null, 1).slice(0, 6000));
p('```');
p('');
p('## Track references states');
p('```json');
p(JSON.stringify(states.trackReferences, null, 1).slice(0, 6000));
p('```');

fs.writeFileSync(path.resolve(__dirname, '../evidence/raw/PREFIX-SUMMARY.md'), out.join('\n'));
console.log('written PREFIX-SUMMARY.md — axe violations:', axeViolations, '— deep-link mismatches:', leaks);
