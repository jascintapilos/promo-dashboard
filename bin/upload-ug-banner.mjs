#!/usr/bin/env node
// UG BO (3MPLAY-NS3 — SBO28/UG01, MENANG7/UG02) banner uploader — module 8.11.
//
// Drives the authenticated AdsPower browser profile via Playwright CDP, so no
// password/CAPTCHA is needed. The AdsPower app must be running with its Local
// API enabled and the profile must hold a live BO session (log in manually
// once inside the AdsPower browser if the session has expired).
//
// Form reference: memory/project_ug_banner_upload_811.md + Google doc
// 14frPSZ1D87paZjKPPjAdRLFRl2V7pYtqWqaBPAAWGNw.
//
// Usage
// ─────
//   node bin/upload-ug-banner.mjs --title="EVENT HUJAN HADIAH" --image=Banner/ug/hujan.png \
//        --url=/promotion --sequence=1 --category=ALL,Slots --start=2026-07-08 --end=2026-07-31
//   node bin/upload-ug-banner.mjs ... --content-file=Banner/ug/hujan-rules.html --commit
//
// Flags
// ─────
//   --title=<text>        Event Title (required)
//   --image=<path>        banner image file (required; must be 360x160px)
//   --url=<path>          Banner Pop up URL, absolute path e.g. /promotion (required)
//   --sequence=<n>        display order, lower shows first (default: 1)
//   --category=<a,b>      comma list: ALL,Special,Sports,Slots,Casino,Others (default: ALL)
//   --language=<name>     "Bhs Indonesia" (default) or "English"
//   --status=<name>       default "Show In Promotion" (see form for other options)
//   --platform=<name>     default "ALL PLATFORM" ("APK ONLY", "DESKTOP / MOBILE ONLY")
//   --img-type=<t>        Single (default) | Multiple
//   --start=<yyyy-mm-dd>  start date (default: today, BO timezone GMT+7)
//   --end=<yyyy-mm-dd>    end date (required unless --no-expiry)
//   --no-expiry           tick "No expired time" instead of an end date
//   --content=<html>      promo rules HTML (inline)
//   --content-file=<path> promo rules HTML from file (overrides --content)
//   --promo-code=<code>   optional promo code text
//   --dry-run             fill the form + screenshot, do NOT click Create (default)
//   --commit              live save — clicks Create and verifies via the listing
//   --profile=<id>        AdsPower profile user_id (default: k1bt9w43)
//   --adspower=<host>     AdsPower Local API base (default: http://127.0.0.1:50325)
//
// Outputs a QC bundle to captures/ug-banner/<slug>.json + screenshots alongside.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BO_BASE = 'https://3m-ns3-admin.com';
const LIST_URL = `${BO_BASE}/Website/BannerSetting`;
const CREATE_URL = `${BO_BASE}/Website/BannerSetting/create/`;
const REQUIRED_W = 360, REQUIRED_H = 160;

const VALID_CATEGORIES = ['ALL', 'Special', 'Sports', 'Slots', 'Casino', 'Others'];
const VALID_STATUS = [
  'Show In Promotion', 'Pop Up Home Page (BEFORE LOGIN)', 'Pop Up Home Page (AFTER LOGIN)',
  'Inactive', 'Show In Jackpot', 'Pop up Deposit Page', 'Pop up Withdraw Page',
];
const VALID_PLATFORM = ['ALL PLATFORM', 'APK ONLY', 'DESKTOP / MOBILE ONLY'];
const VALID_LANGUAGE = ['Bhs Indonesia', 'English'];

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}

function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }

const commit = !!args.commit;
const title = args.title || fail('--title is required');
const imagePath = path.resolve(ROOT, args.image || fail('--image is required'));
// --url= (empty) and --category=NONE are allowed: persisted records (e.g. B23)
// show both stored blank despite the form's required markers.
const popUrl = args.url === true ? '' : (args.url ?? fail('--url is required (absolute path e.g. /promotion, or --url= for blank)'));
const sequence = String(args.sequence ?? '1');
const categories = String(args.category || 'ALL').toUpperCase() === 'NONE'
  ? []
  : String(args.category || 'ALL').split(',').map(s => s.trim()).filter(Boolean);
const language = args.language || 'Bhs Indonesia';
const status = args.status || 'Show In Promotion';
const platform = args.platform || 'ALL PLATFORM';
const imgType = args['img-type'] || 'Single';
const noExpiry = !!args['no-expiry'];
const promoCode = args['promo-code'] || '';
const profileId = args.profile || 'k1bt9w43';
const adspower = args.adspower || 'http://127.0.0.1:50325';

// Today in GMT+7 (BO timezone) regardless of VDI timezone
const nowGmt7 = new Date(Date.now() + 7 * 3600e3);
const todayGmt7 = nowGmt7.toISOString().slice(0, 10);
const dateStart = args.start || todayGmt7;
const dateEnd = noExpiry ? '' : (args.end || fail('--end is required unless --no-expiry'));

let contentHtml = args.content || '';
if (args['content-file']) {
  const f = path.resolve(ROOT, args['content-file']);
  if (!existsSync(f)) fail(`content file not found: ${f}`);
  contentHtml = readFileSync(f, 'utf8');
}

if (popUrl && !popUrl.startsWith('/')) fail(`--url must be an absolute path starting with / (got: ${popUrl})`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStart)) fail(`--start must be yyyy-mm-dd (got: ${dateStart})`);
if (dateEnd && !/^\d{4}-\d{2}-\d{2}$/.test(dateEnd)) fail(`--end must be yyyy-mm-dd (got: ${dateEnd})`);
if (dateEnd && dateEnd < dateStart) fail(`--end (${dateEnd}) is before --start (${dateStart})`);
for (const c of categories) if (!VALID_CATEGORIES.includes(c)) fail(`bad category "${c}" — valid: ${VALID_CATEGORIES.join(', ')}`);
if (!VALID_STATUS.includes(status)) fail(`bad status "${status}" — valid: ${VALID_STATUS.join(' | ')}`);
if (!VALID_PLATFORM.includes(platform)) fail(`bad platform "${platform}" — valid: ${VALID_PLATFORM.join(' | ')}`);
if (!VALID_LANGUAGE.includes(language)) fail(`bad language "${language}" — valid: ${VALID_LANGUAGE.join(' | ')}`);
if (!existsSync(imagePath)) fail(`image not found: ${imagePath}`);

// ── Image dimension gate ──────────────────────────────────────────────────────

const meta = await sharp(imagePath).metadata();
if (meta.width !== REQUIRED_W || meta.height !== REQUIRED_H) {
  fail(`image is ${meta.width}x${meta.height}px — BO requires exactly ${REQUIRED_W}x${REQUIRED_H}px (${path.basename(imagePath)})`);
}
console.log(`✓ image ${path.basename(imagePath)} is ${meta.width}x${meta.height}px`);

// ── AdsPower session ──────────────────────────────────────────────────────────

async function adsGet(pathname) {
  const res = await fetch(`${adspower}${pathname}`).catch(() => null);
  if (!res) return null;
  return res.json().catch(() => null);
}

const apiStatus = await adsGet('/status');
if (!apiStatus || apiStatus.code !== 0) {
  fail(`AdsPower Local API not reachable at ${adspower}.\n  Open the AdsPower app, log in, and enable the Local API, then retry.`);
}

// Reuse the browser if the profile is already open, else start it
let cdpEndpoint = null;
const active = await adsGet(`/api/v1/browser/active?user_id=${profileId}`);
if (active?.code === 0 && active.data?.status === 'Active' && active.data?.ws?.puppeteer) {
  cdpEndpoint = active.data.ws.puppeteer;
  console.log(`✓ AdsPower profile ${profileId} already open`);
} else {
  const started = await adsGet(`/api/v1/browser/start?user_id=${profileId}&open_tabs=1`);
  if (started?.code !== 0) fail(`AdsPower could not start profile ${profileId}: ${started?.msg || 'no response'}`);
  cdpEndpoint = started.data.ws.puppeteer;
  console.log(`✓ AdsPower profile ${profileId} started`);
}

const browser = await chromium.connectOverCDP(cdpEndpoint.replace(/^ws:/, 'http:').replace(/\/devtools.*$/, ''));
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] || await ctx.newPage();

// ── Login check ───────────────────────────────────────────────────────────────

await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(1500);
const loggedOut = await page.evaluate(() =>
  !!document.querySelector('input[type=password]') || /log\s*in/i.test(document.title === '' ? '' : (document.querySelector('button[type=submit]')?.innerText || ''))
);
if (loggedOut || !page.url().includes('/Website/BannerSetting')) {
  await browser.close();
  fail(`BO session is not logged in (landed on ${page.url()}).\n  Open the AdsPower browser and log in to ${BO_BASE} manually, then retry.`);
}
console.log('✓ BO session is live');

// ── Fill the create form ──────────────────────────────────────────────────────

await page.goto(CREATE_URL, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForSelector('#title', { timeout: 15000 });

// Selects: set language FIRST (it swaps the title/content labels), then the rest.
// These may be bootstrap-select enhanced, so set value + fire change + refresh.
async function setSelect(sel, label) {
  const ok = await page.evaluate(([sel, label]) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const opt = [...el.options].find(o => o.text.trim() === label);
    if (!opt) return false;
    el.value = opt.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (window.jQuery && jQuery(el).data('selectpicker')) jQuery(el).selectpicker('refresh');
    return true;
  }, [sel, label]);
  if (!ok) { await browser.close(); fail(`could not set ${sel} to "${label}"`); }
}

await setSelect('#sel_lang_banner', language);
await page.waitForTimeout(500);
await setSelect('#status', status);
await setSelect('#platform', platform);
await setSelect('#img_type', imgType);

// Category is a multi-select; skip entirely for --category=NONE
if (categories.length) {
  const catOk = await page.evaluate((cats) => {
    const el = document.querySelector('#sel_category');
    if (!el) return false;
    for (const o of el.options) o.selected = cats.includes(o.text.trim());
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (window.jQuery && jQuery(el).data('selectpicker')) jQuery(el).selectpicker('refresh');
    return [...el.selectedOptions].length === cats.length;
  }, categories);
  if (!catOk) { await browser.close(); fail(`could not select categories: ${categories.join(', ')}`); }
}

await page.fill('#title', title);
if (popUrl) await page.fill('#pop_up_url', popUrl);
await page.fill('#sequence', sequence);
if (promoCode) await page.fill('#promoCode', promoCode).catch(() => console.log('⚠ promo code field not fillable (disabled?) — skipped'));

await page.fill('#date_start', dateStart);
if (noExpiry) {
  await page.check('#no_limit');
} else {
  await page.fill('#date_until', dateEnd);
}

// Banner image — the visible dropzone proxies input[name=bannerImage]
await page.setInputFiles('input[name="bannerImage"]', imagePath);
console.log('✓ image attached');

// Content — the page has several Summernote instances with misleading names:
// #txtEditor (banner_MultipleImgtxtEditor) is the HIDDEN Multiple-image editor;
// the VISIBLE "Content (<language>)" editor is #langTxtEditor (tc_eng_modal).
// Target whichever textarea's note-editor is actually visible, verify read-back.
if (contentHtml) {
  const result = await page.evaluate((html) => {
    const vis = el => !!el && el.offsetParent !== null;
    const target = [...document.querySelectorAll('textarea')].find(ta =>
      ta.nextElementSibling?.classList?.contains('note-editor') && vis(ta.nextElementSibling)
    ) || document.querySelector('#langTxtEditor');
    if (!target) return { ok: false, how: 'no visible content editor found' };
    const $ = window.jQuery;
    if ($ && $(target).summernote) {
      $(target).summernote('code', html);
      const back = $(target).summernote('code') || '';
      if (back.replace(/\s+/g, '') === html.replace(/\s+/g, ''))
        return { ok: true, how: `summernote (#${target.id || target.name})` };
    }
    const ed = target.nextElementSibling?.querySelector?.('.note-editable');
    if (ed) {
      ed.innerHTML = html;
      target.value = html;
      return { ok: ed.innerHTML.length > 0, how: `dom (#${target.id || target.name})` };
    }
    return { ok: false, how: 'editor found but not settable' };
  }, contentHtml);
  if (!result.ok) { await browser.close(); fail(`could not set content editor HTML (${result.how})`); }
  console.log(`✓ content set via ${result.how}`);
}

// ── Snapshot + summary ────────────────────────────────────────────────────────

const outDir = path.join(ROOT, 'captures', 'ug-banner');
mkdirSync(outDir, { recursive: true });
const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// Screenshots are best-effort — AdsPower windows sometimes refuse captureScreenshot
async function shot(file) {
  const p = path.join(outDir, file);
  const ok = await page.screenshot({ path: p, fullPage: true })
    .catch(() => page.screenshot({ path: p }))
    .catch(() => null);
  if (!ok) { console.log(`⚠ screenshot failed (${file}) — continuing`); return null; }
  return p;
}

// Read the form back from the DOM so verification doesn't depend on a screenshot
const readback = await page.evaluate(() => {
  const selText = s => { const el = document.querySelector(s); return el ? [...el.selectedOptions].map(o => o.text.trim()).join(', ') : null; };
  const val = s => document.querySelector(s)?.value ?? null;
  const vis = el => !!el && el.offsetParent !== null;
  const contentTa = [...document.querySelectorAll('textarea')].find(ta =>
    ta.nextElementSibling?.classList?.contains('note-editor') && vis(ta.nextElementSibling));
  return {
    status: selText('#status'), platform: selText('#platform'), language: selText('#sel_lang_banner'),
    title: val('#title'), pop_up_url: val('#pop_up_url'), sequence: val('#sequence'),
    categories: selText('#sel_category'), img_type: selText('#img_type'),
    date_start: val('#date_start'), date_until: val('#date_until'),
    no_expiry: document.querySelector('#no_limit')?.checked ?? null,
    image_attached: !!document.querySelector('input[name="bannerImage"]')?.files?.length,
    content_html: (contentTa?.nextElementSibling?.querySelector('.note-editable')?.innerHTML || '').slice(0, 200),
  };
});
console.log('\n── Form read-back (from live DOM) ────────');
console.log(JSON.stringify(readback, null, 2));

const mismatches = [];
if (readback.title !== title) mismatches.push('title');
if (readback.pop_up_url !== popUrl) mismatches.push('pop_up_url');
if (readback.sequence !== sequence) mismatches.push('sequence');
if (readback.date_start !== dateStart) mismatches.push('date_start');
if (!noExpiry && readback.date_until !== dateEnd) mismatches.push('date_until');
if (!readback.image_attached) mismatches.push('image');
if (contentHtml && !readback.content_html) mismatches.push('content');
if (mismatches.length) { await browser.close(); fail(`form read-back mismatch on: ${mismatches.join(', ')}`); }
console.log('✓ read-back matches plan');

const shotPlan = await shot(`${slug}__plan.png`);

const plan = {
  bo: BO_BASE, module: '8.11 BannerSetting', mode: commit ? 'commit' : 'dry-run',
  title, language, status, platform, img_type: imgType,
  pop_up_url: popUrl, sequence: Number(sequence), categories,
  date_start: dateStart, date_until: noExpiry ? null : dateEnd, no_expired_time: noExpiry,
  promo_code: promoCode || null,
  image: { file: path.relative(ROOT, imagePath), width: meta.width, height: meta.height },
  content_chars: contentHtml.length,
  readback,
  screenshots: { plan: shotPlan ? path.relative(ROOT, shotPlan) : null },
  ts: new Date().toISOString(),
};

console.log('\n── Plan ──────────────────────────────────');
console.log(JSON.stringify(plan, null, 2));

if (!commit) {
  writeFileSync(path.join(outDir, `${slug}.json`), JSON.stringify(plan, null, 2));
  console.log(`\n✓ DRY-RUN complete — form filled + verified, Create NOT clicked.`);
  if (shotPlan) console.log(`  Review screenshot: ${shotPlan}`);
  console.log(`  Re-run with --commit to save.`);
  await browser.close();
  process.exit(0);
}

// ── Commit ────────────────────────────────────────────────────────────────────

console.log('\nClicking Create…');
await Promise.all([
  page.waitForURL(/Website\/BannerSetting(?!\/create)/, { timeout: 30000 }).catch(() => null),
  page.click('button:has-text("Create")'),
]);
await page.waitForTimeout(2500);

// Verify: banner title appears on the listing
if (!page.url().includes('/Website/BannerSetting') || page.url().includes('/create')) {
  const shotErr = await shot(`${slug}__error.png`);
  const errText = await page.evaluate(() =>
    [...document.querySelectorAll('.alert, .invalid-feedback, .help-block, .text-danger')]
      .map(e => e.innerText.trim()).filter(Boolean).join(' | '));
  await browser.close();
  fail(`save did not redirect to listing (still on ${page.url()})\n  validation: ${errText || '(none shown)'}\n  screenshot: ${shotErr || '(capture failed)'}`);
}

await page.goto(LIST_URL, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(1500);
const found = await page.evaluate((t) => document.body.innerText.includes(t), title);
const shotSaved = await shot(`${slug}__saved.png`);

plan.saved = found;
plan.screenshots.saved = shotSaved ? path.relative(ROOT, shotSaved) : null;
writeFileSync(path.join(outDir, `${slug}.json`), JSON.stringify(plan, null, 2));

if (found) {
  console.log(`\n✓ SAVED — "${title}" is on the Banner Settings listing.`);
  console.log(`  QC bundle: captures/ug-banner/${slug}.json`);
} else {
  console.log(`\n⚠ Create submitted but "${title}" was NOT found on the listing — verify manually.`);
  console.log(`  Screenshot: ${shotSaved}`);
}
await browser.close();
process.exit(found ? 0 : 2);
