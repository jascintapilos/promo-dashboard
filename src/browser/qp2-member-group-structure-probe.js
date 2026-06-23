// Probe: on QP2A Create form, pick Deposit + Merchant=IBC22, open Member
// Group, and dump the EXACT HTML structure of the panel's Select All area
// and first few items. We need to know what element the click should
// target. The canary's three Select All candidates (QPRO toggle pattern,
// label+checkbox, label-with-text) all match SOMETHING and click it but
// none actually tick items (V23 showed 0/28 visible-effect ticks).

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

// Pick Deposit
await page.locator('form:has(input[formcontrolname="code"]) select[formcontrolname="promo_type"]').last().selectOption({ label: 'Deposit' });
await page.waitForTimeout(2500);

// Pick Merchant = IBC22 via kt_dropdown_pick logic
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

// Now open Member Group
const mgXpath = `xpath=(.//span[contains(@class,'kt-font-bold') and contains(normalize-space(.), "Member Group")])[1]/following::*[contains(@class,'c-btn')][1]`;
const mgTrigger = formScope.locator(mgXpath).first();
await mgTrigger.waitFor({ timeout: 5000 });
await mgTrigger.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
await mgTrigger.click({ force: true, timeout: 3000 });
await page.waitForTimeout(2000);
console.log('[member-group] dropdown opened');

// Dump the panel structure in detail
const dump = await page.evaluate(() => {
  const visible = (el) => el.offsetParent !== null;
  const panels = Array.from(document.querySelectorAll('.dropdown-list')).filter(visible);
  const panel = panels[panels.length - 1];
  if (!panel) return { error: 'no visible panel' };

  // Capture full HTML of the panel (truncated)
  const panelHTML = panel.outerHTML.slice(0, 15000);

  // Walk the panel's direct children to understand structure
  const directChildren = Array.from(panel.children).map((c, idx) => ({
    idx,
    tag: c.tagName.toLowerCase(),
    cls: (c.className || '').slice(0, 80),
    textHead: (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
  }));

  // Find ANY element whose text is exactly "Select All" (leaf)
  const selectAllCandidates = Array.from(panel.querySelectorAll('*')).filter((el) => {
    if (el.children.length > 0) return false;  // leaf
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return /^Select All$/i.test(t);
  }).map((el) => {
    // Walk up to find nearby checkbox + clickable ancestors
    const ancestors = [];
    let p = el;
    for (let i = 0; i < 8 && p.parentElement; i++) {
      p = p.parentElement;
      const cb = p.querySelector('input[type="checkbox"]');
      ancestors.push({
        tag: p.tagName.toLowerCase(),
        cls: (p.className || '').slice(0, 100),
        hasCheckbox: !!cb,
        clickable: p.tagName === 'LABEL' || p.tagName === 'BUTTON' || p.tagName === 'A' || (p.getAttribute('role') === 'button'),
      });
    }
    return {
      leafTag: el.tagName.toLowerCase(),
      leafCls: (el.className || '').slice(0, 80),
      leafText: (el.textContent || '').trim(),
      ancestors,
    };
  });

  // Capture first 5 li items to compare structures
  const items = Array.from(panel.querySelectorAll('li')).slice(0, 5).map((li, idx) => ({
    idx,
    cls: (li.className || '').slice(0, 80),
    text: (li.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    outerHTML: li.outerHTML.slice(0, 500),
  }));

  return { directChildren, selectAllCandidates, items, panelHTML };
});

await writeFile(path.join(OUT, 'qp2-member-group-structure-probe.json'), JSON.stringify(dump, null, 2));
console.log('\n=== Panel direct children ===');
for (const c of (dump.directChildren || [])) {
  console.log(`  [${c.idx}] <${c.tag}> cls="${c.cls.slice(0, 60)}" text="${c.textHead.slice(0, 60)}"`);
}
console.log('\n=== "Select All" leaf candidates ===');
for (const c of (dump.selectAllCandidates || [])) {
  console.log(`  leaf <${c.leafTag}> cls="${c.leafCls}" text="${c.leafText}"`);
  for (const a of c.ancestors.slice(0, 5)) {
    console.log(`    < <${a.tag}> cls="${a.cls.slice(0, 60)}" hasCheckbox=${a.hasCheckbox} clickable=${a.clickable}`);
  }
}
console.log('\n=== First 3 items (HTML) ===');
for (const i of (dump.items || []).slice(0, 3)) {
  console.log(`  [${i.idx}] cls="${i.cls.slice(0, 60)}" text="${i.text}"`);
  console.log(`     html: ${i.outerHTML.slice(0, 300)}`);
}
console.log('\n=== Full panel HTML written to captures/qp2-member-group-structure-probe.json ===');

await page.waitForTimeout(3000);
await ctx.close();
await browser.close();
