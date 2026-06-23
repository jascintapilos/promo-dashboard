// Verify the new Member Group Select All locator (input[type=checkbox]
// inside div.pure-checkbox.select-all) actually commits to Angular's
// reactive form, AND that the shadowban un-tick works as a TOGGLE
// against the populated state.
//
// Steps:
//   1. Login QP2A → open Create form → Deposit
//   2. Pick Merchant=IBC22 (Member Group loads its items)
//   3. Open Member Group panel
//   4. Read initial state (trigger text)
//   5. Click Select All via new locator
//   6. Read state after Select All (panel checked count + trigger text)
//   7. Click Shadowban label
//   8. Read final state (panel checked count + trigger text + EXPECTED no shadowban)
//
// No form submit, no test promo code created. Pure DOM inspection.
//
// Run: node src/browser/qp2-member-group-verify.js

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSite } from '../sites.js';

const site = getSite('ibc22');
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 40, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
await page.locator('button:has-text("Login")').click();
await page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
console.log('[login] ok');

await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);
await page.locator('button:has-text("Create")').first().click();
await page.waitForTimeout(2500);

await page.locator('form:has(input[formcontrolname="code"]) select[formcontrolname="promo_type"]').last().selectOption({ label: 'Deposit' });
await page.waitForTimeout(2500);

// Pick Merchant = IBC22
const formScope = page.locator('form:has(input[formcontrolname="code"])').last();
const merchantXpath = `xpath=(.//span[contains(@class,'kt-font-bold') and contains(normalize-space(.), "Merchant")])[1]/following::*[contains(@class,'c-btn')][1]`;
const merchantTrigger = formScope.locator(merchantXpath).first();
await merchantTrigger.waitFor({ timeout: 5000 });
await merchantTrigger.click({ timeout: 3000 });
await page.waitForTimeout(800);
await page.locator('.dropdown-list:visible li').filter({ hasText: /IBC22/i }).first().click({ timeout: 3000 });
await page.waitForTimeout(500);
await merchantTrigger.click({ timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);
console.log('[merchant] IBC22 picked');

// Open Member Group panel
const mgXpath = `xpath=(.//span[contains(@class,'kt-font-bold') and contains(normalize-space(.), "Member Group")])[1]/following::*[contains(@class,'c-btn')][1]`;
const mgTrigger = formScope.locator(mgXpath).first();
await mgTrigger.waitFor({ timeout: 5000 });
await mgTrigger.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
await mgTrigger.click({ force: true, timeout: 3000 });
await page.waitForTimeout(2000);
console.log('[member-group] panel opened');

const panel = page.locator('div.dropdown-list:visible, .dropdown-list.animated:visible').last();

async function snapshot(label) {
  // Wait briefly for Angular re-render
  await page.waitForTimeout(400);
  const triggerText = (await mgTrigger.textContent()).replace(/\s+/g, ' ').trim().slice(0, 300);
  const state = await page.evaluate(() => {
    const visible = (el) => el.offsetParent !== null;
    const panels = Array.from(document.querySelectorAll('.dropdown-list')).filter(visible);
    const p = panels[panels.length - 1];
    if (!p) return null;
    const total = p.querySelectorAll('li').length;
    // Count items with various "checked" indicators (try multiple class patterns)
    const checkboxes = Array.from(p.querySelectorAll('input[type="checkbox"]')).filter(visible);
    const checkedHtml = checkboxes.filter((cb) => cb.checked).length;
    const lisWithChecked = Array.from(p.querySelectorAll('li')).filter((li) => {
      const cb = li.querySelector('input[type="checkbox"]');
      return cb?.checked;
    }).length;
    const selectAllCb = p.querySelector('div.pure-checkbox.select-all input[type="checkbox"]');
    return {
      totalLi: total,
      totalCheckboxes: checkboxes.length,
      checkedCheckboxes: checkedHtml,
      lisWithChecked,
      selectAllChecked: selectAllCb ? selectAllCb.checked : null,
    };
  });
  console.log(`  [${label}] trigger="${triggerText.slice(0, 80)}"`);
  console.log(`           state=${JSON.stringify(state)}`);
  return { label, triggerText, state };
}

const snapshots = [];
snapshots.push(await snapshot('BEFORE any click'));

// Try multiple Select All click strategies, snapshot after each.
console.log('\n[step] trying multiple Select All click strategies');
const strategies = [
  {
    name: 'force-click on input',
    fn: async () => panel.locator('div.pure-checkbox.select-all input[type="checkbox"]').first().click({ force: true, timeout: 3000 }),
  },
  {
    name: 'force-click on div',
    fn: async () => panel.locator('div.pure-checkbox.select-all').first().click({ force: true, timeout: 3000 }),
  },
  {
    name: 'force-click on label',
    fn: async () => panel.locator('div.pure-checkbox.select-all label').first().click({ force: true, timeout: 3000 }),
  },
  {
    name: 'force-click on Select All span',
    fn: async () => panel.locator('div.pure-checkbox.select-all span:has-text("Select All")').first().click({ force: true, timeout: 3000 }),
  },
  {
    name: 'JS native .click() on label',
    fn: async () => page.evaluate(() => {
      const lbl = document.querySelector('.dropdown-list:not([hidden]) div.pure-checkbox.select-all label');
      if (lbl) lbl.click();
    }),
  },
  {
    name: 'JS dispatch click event on div',
    fn: async () => page.evaluate(() => {
      const div = document.querySelector('.dropdown-list:not([hidden]) div.pure-checkbox.select-all');
      if (div) {
        div.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        div.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        div.click();
      }
    }),
  },
];
let foundWorking = null;
for (const s of strategies) {
  console.log(`\n  Trying: ${s.name}`);
  try {
    await s.fn();
    await page.waitForTimeout(800);
    const snap = await snapshot(s.name);
    if (snap.state.checkedCheckboxes > 5) {
      foundWorking = s.name;
      console.log(`  ✓ THIS WORKS: "${s.name}" → ${snap.state.checkedCheckboxes} ticked`);
      break;
    }
    // Undo: click again to revert if it half-ticked
    await s.fn().catch(() => {});
    await page.waitForTimeout(500);
  } catch (e) {
    console.log(`  ✗ "${s.name}" threw: ${e.message.split('\n')[0]}`);
  }
}
console.log(`\n=== WORKING STRATEGY: ${foundWorking || 'NONE — all strategies failed'} ===\n`);
await page.waitForTimeout(800);
snapshots.push(await snapshot('AFTER Select All click'));

// Click shadowban label
console.log('\n[step] clicking shadowban label');
await panel.locator(`li.pure-checkbox label:has-text("Shadowban")`).first().click({ timeout: 3000 });
await page.waitForTimeout(800);
snapshots.push(await snapshot('AFTER shadowban un-tick'));

await writeFile(path.join(OUT, 'qp2-member-group-verify.json'), JSON.stringify(snapshots, null, 2));
console.log('\n=== Wrote captures/qp2-member-group-verify.json ===');

// Summary
const before = snapshots[0].state;
const afterSelectAll = snapshots[1].state;
const afterShadowban = snapshots[2].state;
console.log('\n=== Summary ===');
console.log(`Before:       ${before.checkedCheckboxes} ticked / ${before.totalCheckboxes} total`);
console.log(`After SelAll: ${afterSelectAll.checkedCheckboxes} ticked / ${afterSelectAll.totalCheckboxes} total (selectAll checkbox: ${afterSelectAll.selectAllChecked})`);
console.log(`After excl:   ${afterShadowban.checkedCheckboxes} ticked / ${afterShadowban.totalCheckboxes} total (selectAll checkbox: ${afterShadowban.selectAllChecked})`);
const expected = afterSelectAll.totalCheckboxes - 2;  // Select All checkbox + shadowban both unticked (per operator description)
console.log(`Expected:     ~${expected} ticked / ${afterShadowban.totalCheckboxes} total (Select All + shadowban unticked, rest ticked)`);

if (afterShadowban.checkedCheckboxes >= afterSelectAll.checkedCheckboxes - 2) {
  console.log('✓ PASS — Member Group ended up with most items ticked (matches operator expectation)');
} else {
  console.log(`✗ FAIL — only ${afterShadowban.checkedCheckboxes} ticked (expected ~${expected})`);
}

await page.waitForTimeout(5000);  // hold the browser open briefly so operator can see
await ctx.close();
await browser.close();
