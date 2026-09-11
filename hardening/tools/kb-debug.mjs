import { chromium } from 'playwright';

const route = process.argv[2] || '/capabilities';
const audience = process.argv[3] || 'provider';

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: 'payswap-shell-audience', value: audience, url: 'http://localhost:3000' }]);
const p = await ctx.newPage();
await p.goto('http://localhost:3000' + route, { waitUntil: 'networkidle' });
await p.waitForTimeout(400);

const walk = [];
let repeats = 0;
for (let i = 0; i < 60; i++) {
  await p.keyboard.press('Tab');
  const info = await p.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'BODY';
    const path = [];
    let n = el;
    while (n && n !== document.body) {
      let idx = 0, sib = n;
      while ((sib = sib.previousElementSibling)) idx++;
      path.unshift(n.tagName + ':' + idx);
      n = n.parentElement;
    }
    return path.join('>') + ' text=' + (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  });
  if (walk.length && walk[walk.length - 1] === info && info !== 'BODY') {
    repeats++;
    if (repeats > 2) { walk.push(info + ' <<STUCK>>'); break; }
  } else repeats = 0;
  walk.push(info);
}
console.log(walk.join('\n'));
console.log('focusables:', await p.evaluate(() => [...document.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter((e) => { const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && e.getBoundingClientRect().width > 0; }).length));
await b.close();
