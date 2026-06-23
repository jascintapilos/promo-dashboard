// Probe: open the QP2A Member Group kt-dropdown, dump initial state +
// options, then click Select All, then dump again to see if the Select All
// actually ticks members. The canary V6 reported "Select All clicked" but
// the trigger stayed "Please Select" — investigate which element the
// Select All click was actually hitting.

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

await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);
await page.locator('button:has-text("Create")').first().click();
await page.waitForTimeout(2500);
await page.locator('form:has(input[formcontrolname="code"]) select[formcontrolname="promo_type"]').last().selectOption({ label: 'Deposit' });
await page.waitForTimeout(2500);

// Open the Member Group dropdown (same XPath as multiselect_inverted)
const formScope = page.locator('form:has(input[formcontrolname="code"])').last();
const triggerXpath = `xpath=.//span[contains(@class,'kt-font-bold') and normalize-space(.)="Member Group"]/ancestor::div[contains(@class,'row')][1]//*[self::kt-dropdown-wo-lazyload or self::kt-dropdown]//*[contains(@class,'c-btn')]`;
const trigger = formScope.locator(triggerXpath).first();
const triggerCount = await trigger.count();
console.log(`[trigger] matches: ${triggerCount}`);

// Also try alternative anchors
const altTriggers = await page.evaluate(() => {
  const spans = Array.from(document.querySelectorAll('span.kt-font-bold')).filter((s) => /member\s*group/i.test(s.textContent || ''));
  return spans.map((s, idx) => ({
    spanText: (s.textContent || '').replace(/\s+/g, ' ').trim(),
    cBtnsAfter: (() => {
      // Find all .c-btn following this span up to next kt-font-bold
      const buttons = [];
      let node = s;
      while (node) {
        if (node.nextElementSibling) {
          node = node.nextElementSibling;
          buttons.push(...Array.from(node.querySelectorAll('.c-btn')));
          if (buttons.length > 0) break;
        } else if (node.parentElement) {
          node = node.parentElement.nextElementSibling;
        } else break;
      }
      return buttons.length;
    })(),
  }));
});
console.log('[alt-triggers]', altTriggers);

await trigger.waitFor({ timeout: 5000 });
await trigger.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
await trigger.click({ force: true, timeout: 3000 });
await page.waitForTimeout(1000);
console.log('[trigger] clicked, panel should be open');

// Dump panel state BEFORE Select All
const beforeDump = await dumpMemberGroupPanel(page, 'BEFORE Select All');

// Click Select All
const panel = page.locator('div.dropdown-list:visible, .dropdown-list.animated:visible').last();
const selectAll = panel.locator('label:has(span:text-is("Select All")):has(span:text-is("UnSelect All"))').first();
const saCount = await selectAll.count();
console.log(`[select-all] match count: ${saCount}`);
if (saCount > 0) {
  await selectAll.click();
  await page.waitForTimeout(800);
  console.log('[select-all] clicked');
}

// Dump after
const afterDump = await dumpMemberGroupPanel(page, 'AFTER Select All');

// Dump trigger state
const triggerText = (await trigger.textContent()).replace(/\s+/g, ' ').trim();
console.log(`[trigger-text] "${triggerText.slice(0, 120)}"`);

await writeFile(path.join(OUT, 'qp2-member-group-probe.json'), JSON.stringify({ beforeDump, afterDump, triggerText, altTriggers }, null, 2));
console.log('\n=== Wrote captures/qp2-member-group-probe.json ===');

await page.waitForTimeout(2000);
await ctx.close();
await browser.close();

async function dumpMemberGroupPanel(page, label) {
  const dump = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll('.dropdown-list')).filter((p) => p.offsetParent !== null);
    const panel = panels[panels.length - 1];
    if (!panel) return null;
    const items = Array.from(panel.querySelectorAll('li')).map((li) => ({
      text: (li.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      checkboxState: (() => {
        const cb = li.querySelector('input[type="checkbox"]');
        return cb ? { exists: true, checked: cb.checked } : { exists: false };
      })(),
      hasSelectedClass: li.classList.contains('selected') || li.classList.contains('active'),
    }));
    const labels = Array.from(panel.querySelectorAll('label'));
    const selectAllLabel = labels.find((l) => /select all/i.test(l.textContent || '') && /unselect all/i.test(l.textContent || ''));
    return {
      panelClasses: panel.className,
      items,
      selectAllElement: selectAllLabel ? {
        outerHTML: selectAllLabel.outerHTML.slice(0, 400),
        visibleSpans: Array.from(selectAllLabel.querySelectorAll('span')).map((s) => ({
          text: (s.textContent || '').trim(),
          hidden: s.hasAttribute('hidden') || getComputedStyle(s).display === 'none',
        })),
      } : null,
    };
  });
  console.log(`\n=== ${label} ===`);
  if (dump?.selectAllElement) {
    console.log('Select All label HTML:', dump.selectAllElement.outerHTML);
    console.log('Spans:', JSON.stringify(dump.selectAllElement.visibleSpans));
  }
  console.log(`Items (${dump?.items?.length || 0}):`);
  for (const i of (dump?.items || []).slice(0, 30)) {
    console.log(`  "${i.text}" cb=${JSON.stringify(i.checkboxState)} selected=${i.hasSelectedClass}`);
  }
  return dump;
}
