#!/usr/bin/env node
// Standalone validator for the Section 6.6 Message Template Duplicate flow
// on QP2 (or Create flow on QPRO). Runs ONLY the message-template phase —
// skips the main promo-code form so we can iterate on this single step
// without tripping the canary's idempotency check.
//
// Usage:
//   node bin/test-msg-template.js                       # ibc22, fresh TEST name
//   node bin/test-msg-template.js --site=ibc22 --bonus=deposit
//   node bin/test-msg-template.js --site=qpro11 --bonus=free-credit --brand=QPRO11
//   node bin/test-msg-template.js --name=TEST_QP2A_FIX_001
//
// Flags:
//   --site=<id>           BO site (default ibc22)
//   --brand=<BRAND>       Brand for the rendered body (default derived from site)
//   --bonus=<type>        deposit | free-credit | free-spin (default deposit)
//   --name=<name>         Template Name to type (default TEST_<BRAND>_FIX_<ts>)
//   --locales=<csv>       Override request locales (default EN,ZH,ID)
//
// What it does:
//   1. Logs in
//   2. Navigates to /superuser/message-template
//   3. On QP2: clicks Search → clicks the Duplicate button (fa-clone) on row 0
//      On QPRO: clicks the top-bar Create button
//   4. In the resulting dialog: fills Name (Duplicate) or Section/Type/Name (Create)
//   5. Walks every EN/ZH/ID locale tab, fills Subject + CKEditor body
//   6. Captures the /api/bo/messagetemplate POST + response
//   7. Prints SUCCESS / FAILURE with the server's message

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from './_args.js';
import { getSite } from '../src/sites.js';
import { renderBody, localeDocKey } from '../src/message-template-renderer.js';

const { flags } = parseArgs(process.argv.slice(2));
const siteId = flags.site || 'ibc22';
const site = getSite(siteId);
const platform = (site.platform || 'qpro').toLowerCase();

// Default brand inferred from site: ibc22 → QP2A; otherwise uppercased site id.
const DEFAULT_BRAND_FOR_SITE = {
  ibc22: 'QP2A',
  qpro1: 'QPRO1', qpro2: 'QPRO2', qpro3: 'QPRO3', qpro4: 'QPRO4',
  qpro5: 'QPRO5', qpro6: 'QPRO6', qpro7: 'QPRO7', qpro8: 'QPRO8',
  qpro9: 'QPRO9', qpro10: 'QPRO10', qpro11: 'QPRO11', qpro12: 'QPRO12',
  qpro13: 'QPRO13', qpro14: 'QPRO14', qpro15: 'QPRO15', qpro16: 'QPRO16',
  qpro17: 'QPRO17', qpro18: 'QPRO18', qpro19: 'QPRO19',
};
const brand = flags.brand || DEFAULT_BRAND_FOR_SITE[siteId] || siteId.toUpperCase();
const bonusType = flags.bonus || 'deposit';
const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const tplName = flags.name || `TEST_${brand}_FIX_${ts}`;
const requestLocales = (flags.locales || 'EN,ZH,ID').split(',').map((s) => s.trim()).filter(Boolean);

const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

// Minimal `resolved` shape for renderBody. Real canary derives this from the
// promo code request; for a standalone test we feed plausible defaults.
const resolved = {
  promo_code: tplName,
  brand,
  bonus_type: bonusType,
  bonus_sub_type: bonusType === 'free-credit' ? 'Free Credit' : (bonusType === 'free-spin' ? 'Welcome' : 'Reload'),
  currency_symbol: 'RM',
  min_deposit: 50,
  bonus_pct: 50,
  max_bonus: 500,
  turnover: 3,
  bonus_amount_example: 25,
  total_received_example: 75,
  turnover_requirement_example: 225,
  validity_days: 7,
  rewards_validity_days: 30,
  eligible_categories: ['Slot', 'Live Casino'],
  spin_count: 50,
  game_provider: 'PP2 - Pragmatic Play',
  game_name: 'Sweet Bonanza',
  transfer_amount: 50,
  max_transfer_out: 500,
  promotion_name_en: 'Test Template Fix',
  locales: requestLocales,
};

console.log(`[test-msg-template] site=${siteId} platform=${platform} brand=${brand} bonus=${bonusType}`);
console.log(`[test-msg-template] tplName="${tplName}"`);
console.log(`[test-msg-template] requestLocales=${requestLocales.join(',')}`);

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 30, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

// Network log for the message-template endpoint — capture BOTH request and
// response so we can diff our payload against the manual flow's payload.
const apiHits = [];
page.on('request', (req) => {
  if (req.method() !== 'GET' && /\/api\/bo\/messagetemplate/i.test(req.url())) {
    let body = req.postData() || '';
    try {
      const parsed = JSON.parse(body);
      console.log(`\n  >>> ${req.method()} ${req.url()}`);
      console.log(`      body keys: ${Object.keys(parsed).join(', ')}`);
      if (parsed.code !== undefined) console.log(`      code: "${parsed.code}"`);
      if (parsed.name !== undefined) console.log(`      name: "${parsed.name}"`);
      if (parsed.id !== undefined)   console.log(`      id: ${parsed.id}`);
      if (parsed.section !== undefined) console.log(`      section: ${JSON.stringify(parsed.section)}`);
      if (parsed.type !== undefined)    console.log(`      type: ${JSON.stringify(parsed.type)}`);
      if (parsed.details && typeof parsed.details === 'object') {
        console.log(`      details locale keys: [${Object.keys(parsed.details).join(', ')}]`);
      }
    } catch {
      console.log(`\n  >>> ${req.method()} ${req.url()}  raw-body=${String(body).slice(0, 150)}`);
    }
  }
});
page.on('response', async (resp) => {
  if (resp.request().method() !== 'GET' && /\/api\/bo\/messagetemplate/i.test(resp.url())) {
    const status = resp.status();
    let body = '';
    try { body = (await resp.text()).slice(0, 2000); } catch {}
    apiHits.push({ method: resp.request().method(), url: resp.url(), status, body });
    console.log(`\n  <<< ${resp.request().method()} ${status} ${resp.url()}`);
    if (status >= 400 || body.length < 800) console.log(`      ${body}`);
  }
});

// ── Login ────────────────────────────────────────────────────────────
await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
await page.locator('button:has-text("Login")').click();
await page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
console.log('[login] ok');

// ── Navigate to 6.6 ──────────────────────────────────────────────────
await page.goto(`${site.baseUrl}/superuser/message-template`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);

let dialogMode;
if (platform === 'qp2') {
  // Click Search to load existing rows, then click Duplicate (fa-clone) on row 0.
  dialogMode = 'duplicate';
  try {
    await page.locator('button:has-text("Search")').first().click({ timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);
  } catch (e) { console.log(`  ⚠ Search click failed: ${e.message.split('\n')[0]}`); }

  const dup = await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('table tbody tr')).filter((r) => r.offsetParent !== null);
    const tr = trs[0];
    if (!tr) return { ok: false, reason: 'no rows' };
    const btn = tr.querySelector('button[mattooltip="Duplicate"]')
              || Array.from(tr.querySelectorAll('button')).find((b) => b.querySelector('i.fa-clone'));
    if (!btn) return { ok: false, reason: 'no Duplicate button on row 0' };
    const code = (tr.querySelectorAll('td')[1]?.textContent || '').replace(/\s+/g, ' ').trim();
    btn.click();
    return { ok: true, sourceCode: code };
  });
  if (!dup.ok) { console.error(`FATAL: ${dup.reason}`); process.exit(1); }
  console.log(`[duplicate] source: ${dup.sourceCode}`);
} else {
  dialogMode = 'create';
  await page.locator('button:has-text("Create")').first().click();
}
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, `test-msg-tpl-${dialogMode}-form.png`), fullPage: true }).catch(() => {});

const dialog = page.locator('mat-dialog-container, [role="dialog"], .modal-content').filter({ hasText: /(Create|Duplicate)\s+Message\s+Template/i }).last();
const dialogFallback = page.locator('mat-dialog-container, [role="dialog"], .modal-content').last();
const tplDialog = (await dialog.count()) > 0 ? dialog : dialogFallback;

if (dialogMode === 'duplicate') {
  // 2026-05-14 v2: type Name with real keystrokes. The Duplicate dialog
  // has formcontrolname=null on Code, but the displayed Code is computed
  // from the Name FormControl via an Angular watcher that listens to
  // keypress events on the Name input. Playwright `.fill()` fires only
  // synthetic 'input'/'change' events which the watcher ignores → POST
  // body carries the SOURCE's `code` (unchanged) → server 422s with
  // "code already taken" against the source row.
  const nameInput = tplDialog.locator('input[formcontrolname="name"]').first();
  await nameInput.click({ clickCount: 3, timeout: 3000 }).catch(() => {});  // select all
  await page.keyboard.press('Delete').catch(() => {});
  await nameInput.pressSequentially(tplName, { delay: 35 });
  await nameInput.blur().catch(() => {});
  // Verify what's actually in the form by reading Code field's displayed value.
  const verify = await tplDialog.evaluate((d) => {
    const inputs = Array.from(d.querySelectorAll('input[type="text"]'));
    const nameInput = inputs.find((el) => el.getAttribute('formcontrolname') === 'name');
    const codeInput = inputs.find((el) => !el.getAttribute('formcontrolname') && /code/i.test((el.closest('div')?.querySelector('label')?.textContent || '')));
    return {
      name: nameInput?.value,
      code: codeInput?.value,
    };
  });
  console.log(`[name] typed "${tplName}" → form value: name="${verify.name}" code="${verify.code}"`);
  await page.waitForTimeout(400);
} else {
  await tplDialog.locator('select[formcontrolname="section"]').selectOption({ label: 'Promotions' });
  await page.waitForTimeout(400);
  await tplDialog.locator('select[formcontrolname="type"]').selectOption({ label: 'Message' });
  await page.waitForTimeout(400);
  await tplDialog.locator('input[formcontrolname="name"]').fill(tplName);
  console.log(`[name] "${tplName}"`);
}

// Discover + filter locale tabs.
const tabTexts = await tplDialog.evaluateAll((dialogs) => {
  const d = dialogs[0];
  if (!d) return [];
  return Array.from(d.querySelectorAll('.mat-tab-label, [role="tab"], .nav-tabs li'))
    .filter((t) => t.offsetParent !== null)
    .map((t) => (t.textContent || '').replace(/\s+/g, ' ').trim());
});
console.log(`[tabs] detected: ${tabTexts.join(', ')}`);

const ALLOWED = new Set(['EN', 'ZH', 'ID']);
const tabsToFill = tabTexts.filter((t) => ALLOWED.has(localeDocKey(t.trim())));
console.log(`[tabs] filling: ${tabsToFill.join(', ')}`);

for (const tab of tabsToFill) {
  try {
    const tabLoc = page.locator('.mat-tab-label, [role="tab"]').filter({ hasText: new RegExp(`^\\s*${tab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first();
    await tabLoc.click({ force: true, timeout: 2000 });
    await page.waitForTimeout(700);

    const rendered = await renderBody({ bonusType, locale: tab, brand, platform, resolved });
    if (rendered.skipped) {
      console.log(`  [${tab}] skipped: ${rendered.reason}`);
      continue;
    }

    const subj = tplDialog.locator('input[formcontrolname="subject"]').last();
    await subj.fill('');
    await subj.fill(rendered.subject || '');

    const bodyOk = await tplDialog.evaluateAll((dialogs, html) => {
      const d = dialogs[0];
      if (!d) return false;
      const editorEl = d.querySelector('.ck-editor__editable[contenteditable="true"], [contenteditable="true"], .ck-editor__editable');
      if (!editorEl) return false;
      try {
        const inst = editorEl.ckeditorInstance;
        if (inst && typeof inst.setData === 'function') { inst.setData(html); return true; }
      } catch {}
      editorEl.innerHTML = html;
      editorEl.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, rendered.html);

    console.log(`  [${tab}] subject + body filled (${rendered.html.length} chars) ${bodyOk ? 'OK' : 'NO-EDITOR'}`);
  } catch (e) {
    console.log(`  [${tab}] failed: ${e.message.split('\n')[0]}`);
  }
}

// Submit.
console.log('\n[submit] clicking Submit on the dialog');
const tplSubmit = tplDialog.locator('button:has-text("Submit")').last();
try {
  await tplSubmit.click({ timeout: 4000 });
  console.log('  ✓ Playwright click');
} catch (e) {
  console.log(`  ⚠ Playwright click blocked (${e.message.split('\n')[0]}) — force-clicking via JS`);
  await page.evaluate(() => {
    const dlgs = Array.from(document.querySelectorAll('.modal-content, mat-dialog-container')).filter((d) => d.offsetParent !== null);
    const inner = dlgs.find((d) => /(create|duplicate)\s*message\s*template/i.test(d.querySelector('.modal-header, .modal-title, h4, h5')?.textContent || '')) || dlgs[dlgs.length - 1];
    if (!inner) return;
    const b = Array.from(inner.querySelectorAll('button')).find((b) => /^\s*Submit\s*$/i.test((b.textContent || '').trim()));
    if (b) { b.removeAttribute('disabled'); b.disabled = false; b.click(); }
  });
}

await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(OUT, 'test-msg-tpl-after-submit.png'), fullPage: true }).catch(() => {});

// ── Verdict ──────────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────────────────────────');
console.log(`API hits: ${apiHits.length}`);
let ok = false;
for (const h of apiHits) {
  console.log(`  ${h.method} ${h.status} ${h.url}`);
  console.log(`    ${h.body}`);
  if (h.status >= 200 && h.status < 300) ok = true;
}
console.log(ok ? `\n✅ SUCCESS: template "${tplName}" save returned 2xx` : `\n❌ FAILURE: no 2xx response for template save`);

await page.waitForTimeout(2000);
await ctx.close();
await browser.close();
process.exit(ok ? 0 : 1);
