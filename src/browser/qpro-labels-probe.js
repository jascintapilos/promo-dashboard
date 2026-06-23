// Diagnostic: dump every <label> in the Create Promotion Code modal — scoped
// to the modal that contains the unique title "Create Promotion Code" (NOT
// other [role="dialog"] elements like multiselect panel overlays).
//
//   node src/browser/qpro-labels-probe.js --site=qpro11

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const site = getSite(flags.site || 'qpro11');
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 20 });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('input[formcontrolname="merchant_code"]').waitFor({ timeout: 20000 });
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

// Pick Deposit so sub-types load
await page.locator('select[formcontrolname="promo_type"]:visible').first().selectOption({ label: 'Deposit' });
await page.waitForTimeout(2000);
// Pick KYC Type=KYC Status so the tier multiselect appears (if it exists)
try {
  await page.locator('select[formcontrolname="kyc_type"]:visible').first().selectOption({ label: 'KYC Status' });
  await page.waitForTimeout(1500);
} catch {}

// Hunt globally for the named UI labels we need (Categories, Game Providers,
// Member Group, KYC Status). Match any element whose text content equals
// (or starts with) one of those, regardless of tag.
const formInfo = await page.evaluate(() => {
  const TARGETS = ['Code', 'Name', 'Types', 'Linked Promotions', 'Validity', 'Rewards Validity', 'Frequency', 'Categories', 'Game Providers', 'Eligible Types', 'Member Group', 'Recurring', 'Status', 'KYC Status', 'Target Type', 'Transfer Amount'];
  const found = {};
  // Walk every visible element with non-empty text that exactly matches a target (allow trailing *, whitespace, asterisk)
  const all = document.querySelectorAll('label, span, div, td, th, p, b, strong');
  all.forEach((el) => {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 50) return;
    if (el.children.length > 1) return; // skip containers — we want leaf-ish text nodes
    for (const target of TARGETS) {
      if (t === target || t === target + ' *' || t === target + '*' || t === target + ':') {
        // Skip if invisible
        const cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        // Skip if inside a multiselect dropdown panel
        if (el.closest('.dropdown-list, [class*="dropdown-list"]')) continue;
        // Skip if inside an <option>
        if (el.closest('option, .ng-option')) continue;
        const entry = {
          target,
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 60),
          text: t,
          parentTag: el.parentElement?.tagName?.toLowerCase() || '',
          parentCls: (el.parentElement?.className || '').toString().slice(0, 60),
          // Look for the nearest kt-dropdown / input / select in the same row/group
          neighbor: '',
        };
        // Find a form-group / row ancestor and inspect for a field
        let p = el.parentElement;
        for (let i = 0; i < 8 && p && !entry.neighbor; i++) {
          const kt = p.querySelector('kt-dropdown-wo-lazyload, kt-dropdown');
          const inp = p.querySelector('input:not([type="hidden"]), select:not([formcontrolname=""])');
          if (kt) entry.neighbor = 'kt-dropdown';
          else if (inp) entry.neighbor = inp.tagName.toLowerCase() + (inp.type ? `[${inp.type}]` : '') + (inp.getAttribute('formcontrolname') ? ` fcn=${inp.getAttribute('formcontrolname')}` : '');
          p = p.parentElement;
        }
        (found[target] = found[target] || []).push(entry);
        break;
      }
    }
  });
  return { found };
});

await writeFile(path.join(OUT, `${site.id}-labels-v2.json`), JSON.stringify(formInfo, null, 2));

console.log('\n=== Targeted label hunt ===');
for (const target of Object.keys(formInfo.found || {}).sort()) {
  const entries = formInfo.found[target];
  console.log(`\n"${target}" (${entries.length} match${entries.length === 1 ? '' : 'es'}):`);
  entries.slice(0, 3).forEach((e) => {
    console.log(`  tag=${e.tag} cls=${JSON.stringify(e.cls)} parent=${e.parentTag}.${JSON.stringify(e.parentCls)} neighbor=${e.neighbor || '<none>'}`);
  });
}

await ctx.close();
await browser.close();
