import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const profile = JSON.parse(readFileSync(path.resolve('ft-profile-ws1.local.json'), 'utf8'));
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext({ storageState: profile.storageState, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto('https://mb8.ft-crm.com/v2/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(5000);

// Dump ALL clickable elements (including divs/spans with cursor:pointer or @click)
const all = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll('*').forEach(el => {
    const style = window.getComputedStyle(el);
    const isClickable = style.cursor === 'pointer'
      || el.tagName === 'A' || el.tagName === 'BUTTON'
      || el.getAttribute('role') === 'button'
      || el.getAttribute('tabindex') !== null;
    if (!isClickable) return;
    const text = (el.innerText || '').trim().replace(/\s+/g,' ').slice(0, 50);
    const r = el.getBoundingClientRect();
    if (r.width < 5 || r.height < 5) return; // skip invisible
    results.push({
      tag: el.tagName,
      text,
      href: el.getAttribute('href') || '',
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      title: el.getAttribute('title')||'',
      aria: el.getAttribute('aria-label')||'',
    });
  });
  return results;
});

// Sort by position (top first, then left to right) and print
all.sort((a,b) => a.y - b.y || a.x - b.x);
console.log('All clickable elements by position:');
for (const e of all) {
  const loc = `(${e.x},${e.y} ${e.w}×${e.h})`;
  console.log(`  ${e.tag.padEnd(6)} ${loc.padEnd(22)} text="${e.text.slice(0,40)}" href="${e.href}" cls="${e.cls.slice(0,50)}" aria="${e.aria}"`);
}

await browser.close();
