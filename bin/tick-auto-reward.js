#!/usr/bin/env node
// Tick "Auto Reward Activation" on existing QP2 promos via the BO UI (Playwright).
//
// Why the UI and not a hand-rolled API PUT: editing through the real Edit modal
// means the BO serializes the FULL current form on Submit — per-currency rows,
// blacklist sub-categories, dialog-popup links, member groups are all preserved
// automatically. We change only the one checkbox.
//
//   node bin/tick-auto-reward.js                      ← dry-run (lists targets)
//   node bin/tick-auto-reward.js --commit             ← live: tick + save each
//   node bin/tick-auto-reward.js --commit --ids=1217  ← only these id(s) (canary)
//   node bin/tick-auto-reward.js --commit --limit=1   ← only the first N targets
//
// Targets default to captures/auto-reward-off.json filtered to created_by==='promo_testbot'.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { getSite } from '../src/sites.js';

const argv = process.argv.slice(2);
const commit = argv.includes('--commit');
const limitArg = argv.find((a) => a.startsWith('--limit='));
const idsArg = argv.find((a) => a.startsWith('--ids='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
const onlyIds = idsArg ? new Set(idsArg.split('=')[1].split(',').map(Number)) : null;

const site = getSite('ibc22');

let targets = JSON.parse(readFileSync('captures/auto-reward-off.json', 'utf8'))
  .filter((r) => r.created_by === 'promo_testbot');
if (onlyIds) targets = targets.filter((t) => onlyIds.has(t.id));
if (Number.isFinite(LIMIT)) targets = targets.slice(0, LIMIT);

console.log(`Targets: ${targets.length} promo_testbot codes with Auto Reward OFF`);
for (const t of targets) console.log(`  ${String(t.id).padEnd(6)} ${t.merchants.padEnd(14)} ${t.code}`);
if (!commit) { console.log('\nDry-run. Add --commit to tick + save via the BO UI.'); process.exit(0); }

const OUT = path.resolve('captures/auto-reward-runs');
mkdirSync(OUT, { recursive: true });
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = path.join(OUT, `${runId}.jsonl`);
const log = (ev) => appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), ...ev }) + '\n');

async function dismissSystemMessage(timeoutMs = 3000) {
  try {
    const ok = page.locator('mat-dialog-container, [role="dialog"], .modal-content')
      .filter({ hasText: /System\s*Message/i }).locator('button').filter({ hasText: /^\s*OK\s*$/i }).first();
    await ok.waitFor({ state: 'visible', timeout: timeoutMs });
    await ok.click({ timeout: 3000 });
    await page.waitForTimeout(400);
    return true;
  } catch { return false; }
}

const browser = await chromium.launch({ headless: false, slowMo: 80, channel: 'chrome', args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();
const results = [];

try {
  // ── Login (config-driven, same as canary-write.js) ──
  await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('input[formcontrolname="merchant_code"]').waitFor({ timeout: 20000 });
  await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
  await page.fill('input[formcontrolname="username"]', site.username);
  await page.fill('input[formcontrolname="password"]', site.password);
  const loginResp = page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
  await page.locator('button:has-text("Login")').click();
  await loginResp;
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  log({ event: 'login_ok' });
  console.log('Logged in.\n');

  for (const t of targets) {
    const code = t.code;
    const res = { id: t.id, code, merchants: t.merchants, status: 'pending', checkbox_before: null, checkbox_after: null, put_status: null };
    try {
      await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1200);

      // Search by code (QP2 list holds the code in the "name" filter)
      let filled = false;
      for (const sel of ['input[formcontrolname="name"]', 'input[formcontrolname="code"]', 'input[formcontrolname="promotion"]']) {
        const loc = page.locator(sel).first();
        if (await loc.count() > 0 && await loc.isVisible({ timeout: 800 }).catch(() => false)) {
          await loc.fill(''); await loc.fill(code); filled = true; break;
        }
      }
      if (!filled) throw new Error('no search input found on list page');
      const tableResp = page.waitForResponse((r) => r.url().includes('/api/bo/promotion?') && r.status() === 200, { timeout: 15000 }).catch(() => null);
      await page.locator('button:has-text("Search")').first().click();
      await tableResp; await page.waitForTimeout(1500);

      // Open the matching row's Edit modal
      const row = page.locator(`tr:has-text("${code}")`).first();
      await row.waitFor({ timeout: 8000 });
      await row.locator('a, button').first().click();
      await page.waitForTimeout(2200);

      const editModal = page.locator('mat-dialog-container, [role="dialog"], .modal-content')
        .filter({ hasText: /Edit\s*Promotion\s*Code/i }).last();
      await editModal.waitFor({ timeout: 8000 });

      // Guard: confirm we opened the right code
      const codeVal = await editModal.locator('input[formcontrolname="code"]').first().inputValue().catch(() => null);
      if (codeVal && codeVal.trim() !== code) throw new Error(`opened wrong code "${codeVal}" (wanted ${code})`);

      // Tick auto_reward_activation
      const cb = editModal.locator('input[formcontrolname="auto_reward_activation"]').first();
      await cb.waitFor({ timeout: 5000 });
      await cb.scrollIntoViewIfNeeded().catch(() => {});
      res.checkbox_before = await cb.isChecked().catch(() => null);
      if (res.checkbox_before !== true) {
        try { await cb.click({ timeout: 4000 }); }
        catch {
          await editModal.locator('mat-checkbox:has(input[formcontrolname="auto_reward_activation"]), label:has(input[formcontrolname="auto_reward_activation"])')
            .first().click({ timeout: 3000 });
        }
      }
      res.checkbox_after = await cb.isChecked().catch(() => null);
      if (res.checkbox_after !== true) throw new Error(`checkbox not ticked (after=${res.checkbox_after})`);

      // Submit the Edit modal — capture the PUT. Clicking Submit pops a
      // confirm dialog BEFORE the PUT fires, so after clicking we keep
      // dismissing OK/Yes/Confirm dialogs until the PUT lands (or ~9s).
      const submit = editModal.locator('button:visible').filter({ hasText: /^\s*Submit\s*$/i }).last();
      await submit.waitFor({ state: 'visible', timeout: 6000 });
      await submit.scrollIntoViewIfNeeded().catch(() => {});
      let putResp = null, putDone = false;
      page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/bo\/promotion\/\d+(\?|$)/.test(r.url()), { timeout: 16000 })
        .then((r) => { putResp = r; putDone = true; }).catch(() => {});
      const box = await submit.boundingBox();
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      else await submit.click({ force: true }).catch(() => {});
      for (let i = 0; i < 18 && !putDone; i++) {
        const ok = page.locator('mat-dialog-container, [role="dialog"], .modal-content, .swal2-popup')
          .locator('button').filter({ hasText: /^\s*(OK|Yes|Confirm|Submit)\s*$/i }).first();
        if (await ok.count() > 0 && await ok.isVisible().catch(() => false)) await ok.click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(500);
      }
      const put = putResp;
      res.put_status = put ? put.status() : null;
      if (put && !put.ok()) { try { res.put_body = (await put.text()).slice(0, 300); } catch {} }
      await page.waitForTimeout(600);
      await dismissSystemMessage(3000);

      if (put && put.ok()) { res.status = 'ok'; console.log(`  ✓ ${String(t.id).padEnd(6)} ${code}  (PUT ${put.status()})`); }
      else { res.status = put ? `put_${put.status()}` : 'no_put'; console.log(`  ⚠ ${String(t.id).padEnd(6)} ${code}: ${res.status}`); await page.screenshot({ path: path.join(OUT, `${runId}-${t.id}-fail.png`), fullPage: true }).catch(() => {}); }
      log({ event: 'tick_result', ...res });
    } catch (e) {
      res.status = 'error'; res.error = e.message.split('\n')[0];
      console.log(`  ✗ ${String(t.id).padEnd(6)} ${code}: ${res.error}`);
      await page.screenshot({ path: path.join(OUT, `${runId}-${t.id}-error.png`), fullPage: true }).catch(() => {});
      log({ event: 'error', ...res });
      await dismissSystemMessage(1500);
    }
    results.push(res);
  }
} finally {
  console.log('\n── Summary ──');
  for (const r of results) {
    console.log(`  ${r.status === 'ok' ? '✓' : '✗'} ${String(r.id).padEnd(6)} ${r.code.padEnd(34)} before=${r.checkbox_before} after=${r.checkbox_after} put=${r.put_status || '-'}${r.status !== 'ok' ? '  [' + r.status + (r.error ? ': ' + r.error : '') + ']' : ''}`);
  }
  const ok = results.filter((r) => r.status === 'ok').length;
  console.log(`\n${ok}/${results.length} ticked OK`);
  log({ event: 'run_done', ok, total: results.length, results });
  await page.waitForTimeout(1500);
  await browser.close();
}
