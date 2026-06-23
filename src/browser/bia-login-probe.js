// Phase 1 — Playwright spy on a Best-in-Asia (BIA) CMS / Kiosk BO login.
// The login form shape is unknown (unlike QPRO/QP2 which we already know is
// merchant_code+username+password), so this probe runs HEADED and the user
// logs in manually. We capture every XHR + cookies + the post-login DOM so
// the auth scheme and banner-section selectors can be extracted offline.
//
//   node src/browser/bia-login-probe.js --site=ws1
//   node src/browser/bia-login-probe.js --site=ws2
//   node src/browser/bia-login-probe.js --site=ws1-classic-my
//
// Each page navigation auto-screenshots + saves the DOM so the most recent
// state is always on disk by the time you close the browser. Closing the
// browser ends the probe and writes the summary.
//
// Outputs to captures/:
//   <site>-login-probe.json      — full XHR stream
//   <site>-login-summary.json    — auth analysis (cookies, POST candidates)
//   <site>-pre-login.png         — initial login screen
//   <site>-last.png + .html      — most-recent page state (auto-updated)

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const site = getSite(flags.site || 'ws1');
if (site.platform !== 'bia') {
  console.error(`error: site "${site.id}" is platform "${site.platform}", expected "bia"`);
  process.exit(2);
}

const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

console.error(`[probe] target: ${site.id} (${site.baseUrl})`);
console.error(`[probe] running headed — manual login`);

// VDI sandbox blocks Playwright's bundled chromium spawn (`spawn UNKNOWN`).
// Using `channel: 'chrome'` launches the system-installed Chrome instead,
// which works in this environment.
const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const hits = [];
const baseHost = new URL(site.baseUrl).host;

// Capture everything to the target host + anything auth-y to other hosts
// (the API may live on a separate domain, as is the case for QPRO/QP2).
const interesting = (u) => u.includes(baseHost) || /\b(login|auth|api|admin)\b/i.test(u);

page.on('request', (r) => {
  if (!interesting(r.url())) return;
  const safeBody = r.postData() ? r.postData().replace(site.password, '<<REDACTED_PASSWORD>>') : null;
  hits.push({
    kind: 'req',
    ts: Date.now(),
    method: r.method(),
    url: r.url(),
    headers: r.headers(),
    postData: safeBody,
    postDataLength: r.postData()?.length ?? 0,
  });
});

page.on('response', async (r) => {
  if (!interesting(r.url())) return;
  let body = null;
  try { body = (await r.text()).slice(0, 4000); } catch {}
  hits.push({
    kind: 'res',
    ts: Date.now(),
    status: r.status(),
    url: r.url(),
    headers: r.headers(),
    body,
  });
});

// Auto-capture page state on every main-frame navigation. The most recent
// state is always on disk when the user closes the browser.
let captureSeq = 0;
const navHistory = [];
page.on('framenavigated', async (frame) => {
  if (frame !== page.mainFrame()) return;
  const seq = ++captureSeq;
  navHistory.push({ seq, ts: Date.now(), url: frame.url() });
  // Settle briefly so the page has time to render before snapshot.
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    await page.screenshot({ path: path.join(OUT, `${site.id}-last.png`), fullPage: true });
    const html = await page.content();
    await writeFile(path.join(OUT, `${site.id}-last.html`), html);
  } catch {}
});

// Open the login page. Try /admin/login first (the directory's standard path
// for CMS hosts); fall back to bare baseUrl if it 404s.
const tryUrls = [
  site.baseUrl + '/admin/login',
  site.baseUrl,
];

let landed = false;
for (const u of tryUrls) {
  try {
    console.error(`[probe] navigating to: ${u}`);
    const resp = await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    if (resp && resp.status() < 400) { landed = true; break; }
    console.error(`[probe]   status ${resp?.status()} — trying next URL`);
  } catch (e) {
    console.error(`[probe]   error: ${e.message} — trying next URL`);
  }
}
if (!landed) {
  console.error(`[probe] could not reach any candidate URL — close the browser to abort`);
}

console.error(`[probe] landed at: ${page.url()}`);
console.error(`[probe] title:     ${await page.title().catch(() => '(unknown)')}`);
await page.screenshot({ path: path.join(OUT, `${site.id}-pre-login.png`) }).catch(() => {});

console.error(``);
console.error(`╔════════════════════════════════════════════════════════════════════════╗`);
console.error(`║  MANUAL LOGIN — follow these steps in the open browser window           ║`);
console.error(`║                                                                        ║`);
console.error(`║   Username: ${site.username.padEnd(58)}║`);
console.error(`║   Password: <from bo-sites.local.json>                                 ║`);
console.error(`║                                                                        ║`);
console.error(`║   1. Log in via the browser                                            ║`);
console.error(`║   2. Navigate to the Banner section (Section 14.2 or equivalent)       ║`);
console.error(`║   3. If you can, open one existing banner in EDIT mode — this captures ║`);
console.error(`║      the form-field selectors needed to drive the create-banner UI     ║`);
console.error(`║   4. CLOSE THE BROWSER WINDOW when done                                ║`);
console.error(`║                                                                        ║`);
console.error(`║  The probe auto-captures every page you visit (screenshot + HTML +     ║`);
console.error(`║  XHR), so don't worry about clicking the "right" things — just do      ║`);
console.error(`║  what you'd normally do to set up one banner.                          ║`);
console.error(`╚════════════════════════════════════════════════════════════════════════╝`);
console.error(``);

// Wait for the user to close the browser. Either signal — page close or
// browser disconnect — ends the probe.
await new Promise((resolve) => {
  page.on('close', resolve);
  browser.on('disconnected', resolve);
});

console.error(`[probe] browser closed — writing capture files`);

// Best-effort final summary. Cookies may already be inaccessible if the
// context is torn down, so wrap.
let cookies = [];
try { cookies = await ctx.cookies(); } catch {}

const postReqs = hits.filter((h) => h.kind === 'req' && h.method === 'POST');
const summary = {
  site: site.id,
  baseUrl: site.baseUrl,
  totalHits: hits.length,
  navHistory,
  postRequests: postReqs.map((h) => ({
    url: h.url,
    headerKeys: Object.keys(h.headers).sort(),
    bodyShape: h.postData
      ? (h.postData.trim().startsWith('{') ? 'json'
        : /^[^=]+=[^&]/.test(h.postData) ? 'form-encoded'
        : 'unknown')
      : null,
    bodyLength: h.postDataLength,
    bodyPreview: h.postData?.slice(0, 300),
  })),
  responseStatusCounts: hits
    .filter((h) => h.kind === 'res')
    .reduce((acc, h) => { acc[h.status] = (acc[h.status] || 0) + 1; return acc; }, {}),
  cookies: cookies.map((c) => ({
    name: c.name,
    domain: c.domain,
    path: c.path,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite,
    valueLength: c.value.length,
  })),
  cookieDomains: [...new Set(cookies.map((c) => c.domain))],
};

const captureFile = path.join(OUT, `${site.id}-login-probe.json`);
const summaryFile = path.join(OUT, `${site.id}-login-summary.json`);
await writeFile(captureFile, JSON.stringify(hits, null, 2));
await writeFile(summaryFile, JSON.stringify(summary, null, 2));

console.error(``);
console.error(`[probe] DONE. ${hits.length} hits, ${navHistory.length} navigations, ${cookies.length} cookies`);
console.error(`  capture: ${captureFile}`);
console.error(`  summary: ${summaryFile}`);
console.error(`  last:    ${path.join(OUT, `${site.id}-last.png`)} + .html`);

try { await ctx.close(); } catch {}
try { await browser.close(); } catch {}
process.exit(0);
