// Deep characterization of the Game Provider Blacklist popup so we can author
// the full automation: provider sidebar items, category accordion, sub-type
// checkboxes inside an expanded category, Apply-to-other-currencies, Submit.
//
//   node src/browser/qpro-blacklist-deep.js --site=qpro11

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const site = getSite(flags.site || 'qpro11');
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 30, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

// --- Boilerplate: log in, open Create form, fill required, add MYR currency,
//     do Categories + Game Providers Select All — same as the find-blacklist
//     probe so the BlackList button is enabled.
await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
const loginResp = page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.locator('button:has-text("Login")').click();
await loginResp;
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.locator('button:has-text("Create")').last().click({ timeout: 3000 });
await page.waitForTimeout(3000);

const form = page.locator('form:has(input[formcontrolname="code"])');
await form.locator('input[formcontrolname="code"]').fill('PROBE_BL_DEEP');
await form.locator('input[formcontrolname="name"]').fill('Probe Deep');
await form.locator('select[formcontrolname="promo_type"]').selectOption({ label: 'Deposit' });
await page.waitForTimeout(2500);
await form.locator('select[formcontrolname="promo_sub_type"]').selectOption({ index: 1 });
await page.waitForTimeout(500);
await form.locator('input[formcontrolname="bonus_rate"]').fill('50');
await form.locator('input[formcontrolname="validity"]').fill('1');
await form.locator('input[formcontrolname="reward_validity"]').fill('1');
await form.locator('input[formcontrolname="multiplier"]').first().fill('3');

async function selectAllMulti(labelHook) {
  const xpath = `xpath=.//span[contains(@class,'kt-font-bold') and normalize-space(.)='${labelHook}']/ancestor::div[contains(@class,'row')][1]//*[self::kt-dropdown-wo-lazyload or self::kt-dropdown]//*[contains(@class,'c-btn')]`;
  const trigger = form.locator(xpath).first();
  await trigger.click({ timeout: 3000 });
  await page.waitForTimeout(900);
  const panel = page.locator('div.dropdown-list:visible, .dropdown-list.animated:visible').last();
  try {
    const selAll = panel.locator('label:has(span:text-is("Select All")):has(span:text-is("UnSelect All"))').first();
    await selAll.waitFor({ timeout: 2000 });
    await selAll.click();
    await page.waitForTimeout(500);
  } catch {}
  await trigger.click({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(400);
}
await selectAllMulti('Categories');
await selectAllMulti('Game Providers');

// Add MYR currency
await page.locator('button:has-text("Promotion Currency")').first().click({ force: true });
await page.waitForTimeout(2000);
await page.locator('[role="dialog"]:visible button:has-text("Add")').last().click({ timeout: 5000 });
await page.waitForTimeout(1500);
const rawLabels = await page.locator('select[formcontrolname="currency_id"]').last().locator('option').allTextContents();
const idx = rawLabels.map((s) => s.trim()).indexOf('MYR');
await page.locator('select[formcontrolname="currency_id"]').last().selectOption({ label: rawLabels[idx].trim() });
await page.locator('input[formcontrolname="max_total_applications"]').last().fill('0');
await page.locator('input[formcontrolname="max_total_bonus"]').last().fill('0');
await page.locator('input[formcontrolname="min_transfer"]').last().fill('100');
await page.locator('input[formcontrolname="max_bonus"]').last().fill('30');
await page.locator('input[formcontrolname="max_transfer_out"]').last().fill('0');
await page.locator('select[formcontrolname="status"]').last().selectOption({ label: 'Active' });
await page.locator('[role="dialog"]:visible button:has-text("Submit")').last().click({ timeout: 5000 });
await page.waitForTimeout(2000);
await page.locator('[role="dialog"]:visible button:has-text("Close")').last().click({ timeout: 3000 });
await page.waitForTimeout(1500);

// Now open the Game Provider Blacklist popup
await page.locator('button.ml-2:text-is("BlackList")').first().click({ force: true, timeout: 5000 });
await page.waitForTimeout(2000);

// ─── Probe 1: dump the provider sidebar list (default state, KAYA selected) ───
await page.screenshot({ path: path.join(OUT, `${site.id}-bl-stage1-default.png`), fullPage: true });
const stage1 = await page.evaluate(() => {
  // Find the GAME PROVIDER BLACKLIST dialog specifically
  const dialog = Array.from(document.querySelectorAll('mat-dialog-container, [role="dialog"], .modal-content'))
    .filter((d) => d.offsetParent !== null && /Game Provider Blacklist/.test(d.textContent || ''))
    .pop();
  if (!dialog) return { error: 'no Game Provider Blacklist dialog found' };

  // Provider sidebar: typically a vertical list on the left. Find list items.
  // Try various structures:
  const sidebarCandidates = Array.from(dialog.querySelectorAll('.list-group, .nav, ul, [role="tablist"], .provider-list'))
    .filter((s) => s.offsetParent !== null)
    .slice(0, 5);
  const providers = [];
  for (const sb of sidebarCandidates) {
    const items = sb.querySelectorAll('li, a, button, [role="tab"], .list-group-item');
    items.forEach((it, i) => {
      const text = (it.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 80) return;
      providers.push({
        sidebarCls: sb.className.slice(0, 80),
        itemTag: it.tagName.toLowerCase(),
        itemCls: it.className.slice(0, 80),
        text,
        active: it.classList.contains('active') || /\bactive\b/.test(it.className) || it.getAttribute('aria-selected') === 'true',
      });
    });
  }

  // Categories panel (right side): default-selected provider should have its
  // categories visible.
  const categoryCandidates = [];
  // Look for anything with "FISHING" or "SLOTS" text and grab its container
  const headers = Array.from(dialog.querySelectorAll('*')).filter((el) => {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return /^(FISHING|SLOTS|SPORTS|LIVE CASINO|E-SPORTS|ARCADE|CRASH|TABLE|LOTTERY|FISH HUNTER|COCK FIGHT)$/i.test(t) && el.children.length <= 3;
  }).slice(0, 12);
  for (const h of headers) {
    categoryCandidates.push({
      tag: h.tagName.toLowerCase(),
      cls: h.className.slice(0, 80),
      text: h.textContent.replace(/\s+/g, ' ').trim(),
      parentCls: h.parentElement?.className?.slice(0, 80) || '',
      hasCheckbox: !!h.parentElement?.querySelector('input[type="checkbox"]'),
      hasChevron: !!h.parentElement?.querySelector('.fa-chevron-down, .fa-chevron-right, mat-icon, [class*="chevron"], [class*="arrow"]'),
    });
  }

  return {
    dialogTag: dialog.tagName.toLowerCase(),
    dialogCls: dialog.className.slice(0, 100),
    sidebarCandidates: sidebarCandidates.map((s) => ({ tag: s.tagName.toLowerCase(), cls: s.className.slice(0, 80), itemCount: s.children.length })),
    providers,
    categoryCandidates,
    allButtonsInDialog: Array.from(dialog.querySelectorAll('button')).slice(0, 20).map((b) => ({
      text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
      cls: (b.className || '').slice(0, 60),
      visible: !!(b.offsetWidth || b.offsetHeight),
    })),
  };
});
await writeFile(path.join(OUT, `${site.id}-bl-stage1.json`), JSON.stringify(stage1, null, 2));

// ─── Probe 2: try expanding a category (click on FISHING / SLOTS header) ───
let stage2 = { skipped: true };
try {
  // Click the SLOTS row header to expand it (KAYA usually has SLOTS as one of its categories)
  const slotsHeader = page.locator('mat-dialog-container').last().locator(':text-is("SLOTS")').first();
  await slotsHeader.waitFor({ timeout: 3000 });
  await slotsHeader.click({ force: true });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, `${site.id}-bl-stage2-slots-expanded.png`), fullPage: true });
  stage2 = await page.evaluate(() => {
    const dialog = Array.from(document.querySelectorAll('mat-dialog-container, [role="dialog"], .modal-content'))
      .filter((d) => d.offsetParent !== null && /Game Provider Blacklist/.test(d.textContent || ''))
      .pop();
    if (!dialog) return { error: 'no dialog' };
    // After expanding, sub-types should be visible somewhere. Look for any
    // checkbox with a label containing the doc's sub-types.
    const subTypeLabels = ['Fishing', 'Table', 'Arcade', 'Lottery', 'Scratchcard', 'Video Poker', 'Instantwin', 'PVP', 'P2P', 'Others', 'eGame', 'Bingo'];
    const found = [];
    for (const subType of subTypeLabels) {
      // Find every element whose text equals or contains the subType, near a checkbox
      const els = Array.from(dialog.querySelectorAll('label, span, td, div')).filter((el) => {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return el.children.length <= 3 && (t === subType || t.toLowerCase() === subType.toLowerCase());
      });
      els.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (!(r.width || r.height)) return;
        const nearbyCheckbox = el.querySelector('input[type="checkbox"]') ||
          el.parentElement?.querySelector('input[type="checkbox"]') ||
          el.closest('label')?.querySelector('input[type="checkbox"]');
        found.push({
          subType,
          tag: el.tagName.toLowerCase(),
          cls: el.className.slice(0, 60),
          parentCls: el.parentElement?.className?.slice(0, 60) || '',
          hasCheckbox: !!nearbyCheckbox,
          checkboxChecked: nearbyCheckbox ? nearbyCheckbox.checked : null,
          x: Math.round(r.x), y: Math.round(r.y),
        });
      });
    }
    return { found, totalCheckboxes: dialog.querySelectorAll('input[type="checkbox"]').length };
  });
} catch (e) {
  stage2 = { error: e.message.split('\n')[0] };
}
await writeFile(path.join(OUT, `${site.id}-bl-stage2.json`), JSON.stringify(stage2, null, 2));

console.log('Stage 1 — providers in sidebar:');
console.log(`  dialog: ${stage1.dialogTag}`);
console.log(`  sidebarCandidates: ${stage1.sidebarCandidates?.length}`);
console.log(`  providers found: ${stage1.providers?.length}`);
stage1.providers?.slice(0, 10).forEach((p) => console.log(`    ${p.itemTag}.${JSON.stringify(p.itemCls.slice(0,40))} text="${p.text}" active=${p.active}`));
console.log(`  category candidates: ${stage1.categoryCandidates?.length}`);
stage1.categoryCandidates?.forEach((c) => console.log(`    ${c.tag} text="${c.text}" hasCheckbox=${c.hasCheckbox} hasChevron=${c.hasChevron} parent="${c.parentCls.slice(0,40)}"`));
console.log(`  buttons in dialog: ${stage1.allButtonsInDialog?.length}`);
stage1.allButtonsInDialog?.forEach((b) => console.log(`    button "${b.text}" cls="${b.cls.slice(0,40)}"`));

console.log('\nStage 2 — after expanding SLOTS:');
if (stage2.error) { console.log(`  ERROR: ${stage2.error}`); }
else if (stage2.skipped) { console.log('  SKIPPED'); }
else {
  console.log(`  totalCheckboxes after expand: ${stage2.totalCheckboxes}`);
  console.log(`  sub-type matches found: ${stage2.found?.length}`);
  stage2.found?.slice(0, 15).forEach((f) => console.log(`    "${f.subType}" tag=${f.tag} hasCheckbox=${f.hasCheckbox} checked=${f.checkboxChecked} pos=(${f.x},${f.y})`));
}

await ctx.close();
await browser.close();
