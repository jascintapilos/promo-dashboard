// Phase 1/2 — Playwright probe of QPRO 3.3 Promotion Contents + 14.2 Banners.
//
// Captures EVERY XHR + clicks each dropdown/button to map its options + selectors.
// Output:
//   captures/<site>-qpro-3-3-probe.json      — 3.3 form XHR + DOM snapshot
//   captures/<site>-qpro-14-2-probe.json     — 14.2 form XHR + DOM snapshot
//   captures/<site>-qpro-3-3-create.png      — screenshot of 3.3 Create panel
//   captures/<site>-qpro-14-2-create.png     — screenshot of 14.2 Create panel
//
// Run:
//   node src/browser/qpro-form-probe.js --site=qpro4
//
// User must log in interactively (script pauses until they navigate to /general/promotion-contents).
// channel: 'chrome' uses system Chrome (bundled Chromium spawn blocked on VDI).

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const site = getSite(flags.site || 'qpro4');
if (site.platform !== 'qpro') {
  console.error(`error: site "${site.id}" is platform "${site.platform}", expected "qpro"`);
  process.exit(2);
}

const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

console.error(`[probe] target: ${site.id} (${site.baseUrl})`);

// Maximized window so the full QPRO form (Create modal + Submit button at
// the bottom) is reachable without manual resize.
const browser = await chromium.launch({
  headless: false,
  channel: 'chrome',
  args: ['--start-maximized'],
});
// viewport: null lets the page fill the actual maximized window instead of
// being constrained to a fixed 1280×720 viewport even when the window itself
// is bigger.
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

const hits = [];
const apiHost = new URL(site.apiHost).host;

page.on('request', (r) => {
  if (!r.url().includes(apiHost)) return;
  hits.push({
    kind: 'req',
    ts: Date.now(),
    method: r.method(),
    url: r.url(),
    headers: r.headers(),
    postData: r.postData()?.slice(0, 4000) || null,
  });
});
page.on('response', async (r) => {
  if (!r.url().includes(apiHost)) return;
  let body = null;
  try { body = (await r.text()).slice(0, 6000); } catch {}
  hits.push({
    kind: 'res',
    ts: Date.now(),
    status: r.status(),
    url: r.url(),
    headers: r.headers(),
    body,
  });
});

await page.goto(site.baseUrl);
await page.waitForLoadState('domcontentloaded', { timeout: 30000 });

// Full auto-login using creds from bo-sites.json + bo-sites.local.json.
// (Same source the existing api-client.js login uses in production.)
//
// Angular SPA — login fields render asynchronously after DOMContentLoaded.
// Race the merchant_code input appearing vs the dashboard URL stabilising;
// whichever wins tells us if we need to log in or are already in.
try {
  const merchantField = page.locator('input[formcontrolname="merchant_code"]').first();
  const found = await merchantField.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  if (found) {
    await merchantField.fill(site.loginMerchantCode);
    await page.locator('input[formcontrolname="username"]').fill(site.username);
    await page.locator('input[formcontrolname="password"]').fill(site.password);
    const submit = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign In")').first();
    if (await submit.count() > 0) await submit.click();
    else await page.locator('input[formcontrolname="password"]').press('Enter');
    console.error(`[probe] auto-login submitted with user=${site.username}`);
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  } else {
    console.error(`[probe] no login form within 10s — assuming already logged in via cached session.`);
  }
} catch (e) {
  console.error(`[probe] login error: ${e.message}`);
}

console.error(``);
console.error(`╔════════════════════════════════════════════════════════════════════════╗`);
console.error(`║  MANUAL STEPS                                                          ║`);
console.error(`║                                                                        ║`);
console.error(`║  1. Type password (Jcalpha123! / Promo111!) and Login                  ║`);
console.error(`║  2. Navigate: 3. Promotions → 3.3 Promotion Contents                   ║`);
console.error(`║  3. Click "+ Create" (the modal will open)                             ║`);
console.error(`║  4. Pause briefly so the form renders                                  ║`);
console.error(`║  5. CLOSE the browser when you've completed those steps                ║`);
console.error(`║                                                                        ║`);
console.error(`║  The probe auto-captures the DOM + every XHR so don't worry about      ║`);
console.error(`║  clicking specific things. Just open the Create modal.                 ║`);
console.error(`╚════════════════════════════════════════════════════════════════════════╝`);
console.error(``);

// Auto-screenshot + DOM snapshot every 3 seconds while user navigates
let snapCount = 0;
const snapInterval = setInterval(async () => {
  snapCount++;
  try {
    await page.screenshot({ path: path.join(OUT, `${site.id}-qpro-probe-snap-${snapCount}.png`) });
    const dom = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label, .form-label')).map(l => (l.textContent||'').trim()).filter(Boolean);
      const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map(el => ({
        tag: el.tagName,
        type: el.type || null,
        formControl: el.getAttribute('formcontrolname'),
        placeholder: el.placeholder || null,
        readonly: el.readOnly,
      }));
      const buttons = Array.from(document.querySelectorAll('button')).map(b => (b.textContent||'').trim()).filter(Boolean).filter((v,i,a) => a.indexOf(v) === i);
      const dropdowns = Array.from(document.querySelectorAll('kt-dropdown, .dropdown, [class*="select" i]')).map(d => ({ classes: d.className?.toString().slice(0, 100), text: (d.textContent||'').trim().slice(0, 60) }));
      return { url: location.href, labelCount: labels.length, labels: labels.slice(0, 40), inputs: inputs.slice(0, 30), buttons: buttons.slice(0, 30), dropdowns: dropdowns.slice(0, 15) };
    });
    await writeFile(path.join(OUT, `${site.id}-qpro-probe-dom-${snapCount}.json`), JSON.stringify(dom, null, 2));
  } catch {}
}, 3000);

// Wait for browser close
await new Promise((resolve) => {
  page.on('close', resolve);
  browser.on('disconnected', resolve);
});

clearInterval(snapInterval);

// Final capture write
await writeFile(path.join(OUT, `${site.id}-qpro-probe-xhr.json`), JSON.stringify(hits, null, 2));
console.error(`[probe] DONE. ${hits.length} XHR captured, ${snapCount} DOM snapshots`);
console.error(`  XHR: captures/${site.id}-qpro-probe-xhr.json`);
console.error(`  DOM: captures/${site.id}-qpro-probe-dom-*.json (${snapCount} files)`);
console.error(`  PNG: captures/${site.id}-qpro-probe-snap-*.png (${snapCount} files)`);

try { await ctx.close(); } catch {}
try { await browser.close(); } catch {}
process.exit(0);
