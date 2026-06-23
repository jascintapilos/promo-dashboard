// Test a CLEAN single click of the Select All in Member Group, then test
// alternative click targets one at a time.

import { chromium } from 'playwright';
import { getSite } from '../sites.js';

const site = getSite('ibc22');

async function setupPanel() {
  const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 30, args: ['--start-maximized'] });
  const ctx = await browser.newContext({ viewport: null });
  const page = await ctx.newPage();
  await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
  await page.fill('input[formcontrolname="username"]', site.username);
  await page.fill('input[formcontrolname="password"]', site.password);
  await page.locator('button:has-text("Login")').click();
  await page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(2000);
  await page.locator('button:has-text("Create")').first().click();
  await page.waitForTimeout(2500);
  await page.locator('form:has(input[formcontrolname="code"]) select[formcontrolname="promo_type"]').last().selectOption({ label: 'Deposit' });
  await page.waitForTimeout(2500);

  // Merchant
  const formScope = page.locator('form:has(input[formcontrolname="code"])').last();
  const mt = formScope.locator(`xpath=(.//span[contains(@class,'kt-font-bold') and contains(normalize-space(.), "Merchant")])[1]/following::*[contains(@class,'c-btn')][1]`).first();
  await mt.waitFor({ timeout: 5000 });
  await mt.click({ timeout: 3000 });
  await page.waitForTimeout(800);
  await page.locator('.dropdown-list:visible li').filter({ hasText: /IBC22/i }).first().click({ timeout: 3000 });
  await page.waitForTimeout(500);
  await mt.click({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(1500);

  // Eligible Types = Members
  await formScope.locator('select[formcontrolname="eligible_types"]').selectOption({ label: 'Members' });
  await page.waitForTimeout(800);

  // Open Member Group
  const mgt = formScope.locator(`xpath=(.//span[contains(@class,'kt-font-bold') and contains(normalize-space(.), "Member Group")])[1]/following::*[contains(@class,'c-btn')][1]`).first();
  await mgt.waitFor({ timeout: 5000 });
  await mgt.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  await mgt.click({ force: true, timeout: 3000 });
  await page.waitForTimeout(2000);

  return { browser, ctx, page, mgt };
}

async function snap(page, mgt, label) {
  await page.waitForTimeout(500);
  const triggerText = (await mgt.textContent()).replace(/\s+/g, ' ').trim().slice(0, 200);
  console.log(`  [${label}] trigger="${triggerText.slice(0, 100)}"`);
  return triggerText;
}

async function run(name, clickFn) {
  console.log(`\n========== TEST: ${name} ==========`);
  const env = await setupPanel();
  await snap(env.page, env.mgt, 'before click');
  await clickFn(env.page);
  await env.page.waitForTimeout(800);
  await snap(env.page, env.mgt, 'AFTER click');
  await env.page.waitForTimeout(2000);
  await env.ctx.close();
  await env.browser.close();
}

const panelSel = '.dropdown-list:visible, .dropdown-list.animated:visible';

await run('1. force-click on input', async (page) => {
  await page.locator(`${panelSel} div.pure-checkbox.select-all input[type="checkbox"]`).first().click({ force: true });
});

await run('2. force-click on div', async (page) => {
  await page.locator(`${panelSel} div.pure-checkbox.select-all`).first().click({ force: true });
});

await run('3. force-click on label', async (page) => {
  await page.locator(`${panelSel} div.pure-checkbox.select-all label`).first().click({ force: true });
});

await run('4. JS click on input', async (page) => {
  await page.evaluate(() => {
    const cb = document.querySelector('.dropdown-list:not([hidden]) div.pure-checkbox.select-all input[type="checkbox"]');
    if (cb) cb.click();
  });
});

await run('5. JS click on label', async (page) => {
  await page.evaluate(() => {
    const lbl = document.querySelector('.dropdown-list:not([hidden]) div.pure-checkbox.select-all label');
    if (lbl) lbl.click();
  });
});

await run('6. JS click on label-span', async (page) => {
  await page.evaluate(() => {
    const sp = Array.from(document.querySelectorAll('.dropdown-list:not([hidden]) div.pure-checkbox.select-all label span')).find((s) => /^Select All$/.test((s.textContent || '').trim()));
    if (sp) sp.click();
  });
});

await run('7. Playwright click on IBC22 grp-title label', async (page) => {
  await page.locator(`${panelSel} li.pure-checkbox.grp-title > label`).first().click({ force: true });
});

await run('8. JS click on IBC22 grp-title <li> directly', async (page) => {
  await page.evaluate(() => {
    const li = document.querySelector('.dropdown-list:not([hidden]) li.pure-checkbox.grp-title');
    if (li) li.click();
  });
});

await run('9. JS click on IBC22 grp-title input', async (page) => {
  await page.evaluate(() => {
    const li = document.querySelector('.dropdown-list:not([hidden]) li.pure-checkbox.grp-title');
    if (li) {
      const cb = li.querySelector('input[type="checkbox"]');
      if (cb) cb.click();
    }
  });
});

await run('10. DIAGNOSTIC: what does the panel actually contain RIGHT NOW?', async (page) => {
  const info = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll('.dropdown-list')).filter((p) => p.offsetParent !== null);
    const panel = panels[panels.length - 1];
    if (!panel) return { error: 'no panel' };
    const selectAllDiv = panel.querySelector('div.pure-checkbox.select-all');
    const selectAllInput = panel.querySelector('div.pure-checkbox.select-all input[type="checkbox"]');
    const firstGrpItem = panel.querySelector('li.pure-checkbox.grp-item');
    const firstGrpTitle = panel.querySelector('li.pure-checkbox.grp-title');
    return {
      panelClasses: panel.className,
      hasSelectAllDiv: !!selectAllDiv,
      selectAllInputBox: selectAllInput?.getBoundingClientRect() || null,
      firstGrpItemBox: firstGrpItem?.getBoundingClientRect() || null,
      firstGrpItemText: firstGrpItem ? (firstGrpItem.textContent || '').trim().slice(0, 30) : null,
      firstGrpTitleBox: firstGrpTitle?.getBoundingClientRect() || null,
      firstGrpTitleText: firstGrpTitle ? (firstGrpTitle.textContent || '').trim().slice(0, 30) : null,
      panelBox: panel.getBoundingClientRect(),
    };
  });
  console.log(`  panel info:`, JSON.stringify(info, null, 2));
});

console.log('\nDone');
