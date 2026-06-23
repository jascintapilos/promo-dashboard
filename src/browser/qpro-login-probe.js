// Phase 1 — Playwright spy on QPRO login. Single attempt to avoid account
// lockout. Captures every request/response to the BO host during a real
// login flow, then writes the full capture + a summary to captures/.
//
//   node src/browser/qpro-login-probe.js [--site=qpro1] [--headless=false]
//
// Default is headless. Pass HEADLESS=false (env) or --headless=false to watch
// it run. Resulting files:
//   captures/<site>-login-probe.json    — every captured req/res
//   captures/<site>-login-summary.json  — analysis: POST candidates, cookies, etc.
//   captures/<site>-pre-submit.png      — screenshot of login page before submit
//   captures/<site>-post-submit.png     — screenshot after submit

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const headless = !(flags.headless === 'false' || process.env.HEADLESS === 'false');

const site = getSite(flags.site || 'qpro1');
if (site.platform !== 'qpro') {
  console.error(`error: site "${site.id}" is platform "${site.platform}", expected "qpro"`);
  process.exit(2);
}

const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const hits = [];
// Capture POSTs to any host (the BO frontend often sits on one domain while
// the API host is a totally separate one — empirically confirmed for both
// QP2 and QPRO). Also capture POST responses, plus any GET that looks
// auth/login-related, to keep the capture useful but bounded.
const looksAuthy = (u) => /\b(login|auth|token|signin)\b/i.test(u);

page.on('request', (r) => {
  const isPost = r.method() === 'POST';
  if (!isPost && !looksAuthy(r.url())) return;
  // Sanitize: never log the plaintext password if it leaks into a header/body.
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
  const isPost = r.request().method() === 'POST';
  if (!isPost && !looksAuthy(r.url())) return;
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

console.error(`[probe] target: ${site.id} (${site.baseUrl})`);
console.error(`[probe] headless: ${headless}`);

try {
  await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  console.error(`[probe] landed at: ${page.url()}`);
  console.error(`[probe] title:     ${await page.title()}`);

  // The QPRO/QP2 login form is three fields: merchant_code / username / password.
  // (Confirmed empirically; both platforms use the same Angular-SPA shape.)
  const merchantInput = page.locator('input[formcontrolname="merchant_code"]');
  const userInput     = page.locator('input[formcontrolname="username"]');
  const passInput     = page.locator('input[formcontrolname="password"]');

  await merchantInput.waitFor({ timeout: 20000 });
  await userInput.waitFor({ timeout: 5000 });
  await passInput.waitFor({ timeout: 5000 });

  const merchantCode = flags['merchant-code'] || site.loginMerchantCode;
  if (!merchantCode) {
    throw new Error(
      `merchant_code unknown for site "${site.id}". Either set loginMerchantCode in bo-sites.json\n` +
      `or pass --merchant-code=<CODE> (usually the brand acronym from the BO directory).`,
    );
  }
  console.error(`[probe] filling credentials: merchant_code="${merchantCode}" user="${site.username}"`);
  await merchantInput.fill(merchantCode);
  await userInput.fill(site.username);
  await passInput.fill(site.password);

  await page.screenshot({ path: path.join(OUT, `${site.id}-pre-submit.png`) }).catch(() => {});

  const submit = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign In"), button:has-text("Log in")').first();
  const submitCount = await submit.count();
  if (submitCount > 0) {
    console.error(`[probe] clicking submit button`);
    await submit.click();
  } else {
    console.error(`[probe] no submit button found, pressing Enter`);
    await passInput.press('Enter');
  }

  // Wait for the auth POST + redirect to settle.
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.screenshot({ path: path.join(OUT, `${site.id}-post-submit.png`), fullPage: true }).catch(() => {});

  console.error(`[probe] post-submit url: ${page.url()}`);
} catch (e) {
  console.error(`[probe] navigation/interaction error: ${e.message}`);
}

// Categorize captured hits.
const postReqs = hits.filter((h) => h.kind === 'req' && h.method === 'POST');
const cookies = await ctx.cookies();

const summary = {
  site: site.id,
  baseUrl: site.baseUrl,
  finalUrl: page.url(),
  totalHits: hits.length,
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
};

const captureFile = path.join(OUT, `${site.id}-login-probe.json`);
const summaryFile = path.join(OUT, `${site.id}-login-summary.json`);
await writeFile(captureFile, JSON.stringify(hits, null, 2));
await writeFile(summaryFile, JSON.stringify(summary, null, 2));

console.log('\n=== PROBE SUMMARY ===');
console.log(JSON.stringify(summary, null, 2));
console.log(`\nFull capture: ${captureFile}`);
console.log(`Summary:      ${summaryFile}`);
console.log(`Screenshots:  ${path.join(OUT, `${site.id}-pre-submit.png`)} + ${site.id}-post-submit.png`);

await ctx.close();
await browser.close();
