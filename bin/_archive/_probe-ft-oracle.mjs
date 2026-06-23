import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const profile = JSON.parse(readFileSync(path.resolve('ft-profile-ws1.local.json'), 'utf8'));
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext({ storageState: profile.storageState, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Go to /v2/oracle (bottom sidebar item — possibly user account)
await page.goto('https://mb8.ft-crm.com/v2/oracle', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(4000);
console.log('URL:', page.url());
const text = (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g,' ');
console.log('Text (first 500):', text.slice(0, 500));

// Look for any links that could lead to account settings / MFA
const links = await page.$$eval('a, button', els => els.map(e => ({
  text: (e.innerText||'').trim().replace(/\s+/g,' ').slice(0,60),
  href: e.getAttribute('href')||'',
})).filter(e => e.text || e.href));
console.log('\nLinks:', links.slice(0, 30));

// Also - check what's at the very BOTTOM of the left sidebar by scrolling
// Look for any element with 'user' or 'account' or 'profile' in the full DOM
const userEls = await page.evaluate(() => {
  const found = [];
  document.querySelectorAll('*').forEach(el => {
    const t = (el.getAttribute('class')||'') + (el.getAttribute('id')||'') + (el.getAttribute('href')||'') + (el.getAttribute('title')||'') + (el.getAttribute('aria-label')||'');
    if (/user|account|profile|avatar|mfa|security|authenticat/i.test(t)) {
      const r = el.getBoundingClientRect();
      found.push({ tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').slice(0,60), id: el.id, href: el.getAttribute('href')||'', title: el.getAttribute('title')||'', aria: el.getAttribute('aria-label')||'', x: Math.round(r.x), y: Math.round(r.y) });
    }
  });
  return found;
});
console.log('\nElements with user/account/profile in attributes:', userEls.slice(0, 20));

await browser.close();
