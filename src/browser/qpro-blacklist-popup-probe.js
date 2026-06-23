// Spy the Blacklist popup on the Create form. Same approach as Currency:
// fill prerequisites first so the form's required state lets us click into
// the popup. Capture both the outer popup and (if present) the inner
// Create-Template form's DOM.
//
//   node src/browser/qpro-blacklist-popup-probe.js --site=qpro11

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const headless = !(flags.headless === 'false' || process.env.HEADLESS === 'false');
const site = getSite(flags.site || 'qpro11');

const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded' });
await page.locator('input[formcontrolname="merchant_code"]').waitFor({ timeout: 20000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
const lr = page.waitForResponse((x) => x.url().includes('/api/bo/login') && x.status() === 200);
await page.locator('button:has-text("Login")').click();
await lr;
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.locator('button:has-text("Create")').first().click();
await page.waitForTimeout(2500);

// Fill prerequisites.
const TEST_CODE = `TEST_BL_${Date.now()}`;
try { await page.locator('input[formcontrolname="code"]').last().fill(TEST_CODE); } catch {}
try { await page.locator('input[formcontrolname="name"]').last().fill('Probe BL'); } catch {}
try { await page.locator('select[formcontrolname="promo_type"]').last().selectOption({ label: 'Deposit' }); } catch {}
await page.waitForTimeout(700);
try { await page.locator('select[formcontrolname="promo_sub_type"]').last().selectOption({ label: 'Welcome' }); } catch {}
try { await page.locator('input[formcontrolname="bonus_rate"]').last().fill('120'); } catch {}
try { await page.locator('input[formcontrolname="validity"]').last().fill('30'); } catch {}
try { await page.locator('input[formcontrolname="reward_validity"]').last().fill('7'); } catch {}
try { await page.locator('input[formcontrolname="multiplier"]').first().fill('15'); } catch {}
await page.waitForTimeout(800);

// Find Blacklist button. Try several places: bottom of form is preferred.
const blBtn = page.locator('button:has-text("Blacklist"), button:has-text("BlackList")').last();
const present = await blBtn.count();
const enabled = present > 0 ? await blBtn.isEnabled().catch(() => false) : false;
console.error(`[probe] Blacklist button: present=${present > 0} enabled=${enabled}`);
await page.screenshot({ path: path.join(OUT, `${site.id}-create-prefilled-for-bl.png`), fullPage: true }).catch(() => {});

const out = { blacklistButton: { present: present > 0, enabled } };

if (present > 0 && enabled) {
  try {
    await blBtn.scrollIntoViewIfNeeded().catch(() => {});
    await blBtn.click({ timeout: 5000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, `${site.id}-blacklist-popup.png`), fullPage: true }).catch(() => {});

    out.outerPopup = await page.evaluate(() => {
      const modals = Array.from(document.querySelectorAll('[role="dialog"], .modal-dialog, .modal-content, kt-modal, ngb-modal-window'));
      const vis = modals.filter((m) => m.offsetWidth || m.offsetHeight);
      const top = vis[vis.length - 1] || document.body;
      const visEl = (e) => !!(e.offsetWidth || e.offsetHeight);
      return {
        modalCount: vis.length,
        title: (top.querySelector('.modal-title, h4, h3, h2')?.textContent || '').trim(),
        inputs: Array.from(top.querySelectorAll('input, textarea')).filter(visEl).map((e) => ({
          tag: e.tagName.toLowerCase(), type: e.type || '', placeholder: e.placeholder || '',
          formcontrolname: e.getAttribute('formcontrolname') || '',
        })),
        selects: Array.from(top.querySelectorAll('select')).filter(visEl).map((e) => ({
          formcontrolname: e.getAttribute('formcontrolname') || '',
          options: Array.from(e.options).slice(0, 15).map((o) => o.textContent.trim()),
        })),
        buttons: Array.from(top.querySelectorAll('button, a[role="button"]')).filter(visEl)
          .map((e) => (e.textContent || '').trim().slice(0, 50))
          .filter((t) => t.length > 0 && t.length < 50),
        multiselects: Array.from(top.querySelectorAll('kt-dropdown-wo-lazyload, kt-dropdown')).filter(visEl)
          .map((e) => ({ text: (e.textContent || '').trim().slice(0, 100) })),
      };
    });
    console.error(`[probe] Outer popup: inputs=${out.outerPopup.inputs.length} selects=${out.outerPopup.selects.length} buttons=${out.outerPopup.buttons.length}`);

    // Look for a Create/+Add/Create Template button and click it.
    const candidates = [
      '[role="dialog"]:visible button:has-text("Create Template")',
      '[role="dialog"]:visible button:has-text("Create")',
      '[role="dialog"]:visible button:has-text("+ Add")',
      '[role="dialog"]:visible button:has-text("Add")',
      '.modal-content:visible button:has-text("Create")',
    ];
    let createClicked = false;
    for (const sel of candidates) {
      const btn = page.locator(sel).last();
      if (await btn.count() > 0) {
        try {
          await btn.click({ timeout: 3000 });
          createClicked = true;
          console.error(`[probe] clicked: ${sel}`);
          break;
        } catch {}
      }
    }
    if (createClicked) {
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(OUT, `${site.id}-blacklist-template.png`), fullPage: true }).catch(() => {});
      out.innerForm = await page.evaluate(() => {
        const modals = Array.from(document.querySelectorAll('[role="dialog"], .modal-dialog, .modal-content, kt-modal, ngb-modal-window'));
        const vis = modals.filter((m) => m.offsetWidth || m.offsetHeight);
        const top = vis[vis.length - 1] || document.body;
        const visEl = (e) => !!(e.offsetWidth || e.offsetHeight);
        return {
          modalCount: vis.length,
          title: (top.querySelector('.modal-title, h4, h3, h2')?.textContent || '').trim(),
          inputs: Array.from(top.querySelectorAll('input, textarea')).filter(visEl).map((e) => ({
            tag: e.tagName.toLowerCase(), type: e.type || '', placeholder: e.placeholder || '',
            formcontrolname: e.getAttribute('formcontrolname') || '',
          })),
          selects: Array.from(top.querySelectorAll('select')).filter(visEl).map((e) => ({
            formcontrolname: e.getAttribute('formcontrolname') || '',
            options: Array.from(e.options).slice(0, 15).map((o) => o.textContent.trim()),
          })),
          buttons: Array.from(top.querySelectorAll('button, a[role="button"]')).filter(visEl)
            .map((e) => (e.textContent || '').trim().slice(0, 50))
            .filter((t) => t.length > 0 && t.length < 50),
          multiselects: Array.from(top.querySelectorAll('kt-dropdown-wo-lazyload, kt-dropdown')).filter(visEl)
            .map((e) => ({ text: (e.textContent || '').trim().slice(0, 200) })),
          checkboxCount: Array.from(top.querySelectorAll('input[type="checkbox"]')).filter(visEl).length,
        };
      });
      console.error(`[probe] Inner form: inputs=${out.innerForm.inputs.length} checkboxes=${out.innerForm.checkboxCount} multiselects=${out.innerForm.multiselects.length}`);
    } else {
      console.error('[probe] no Create/Add button found inside Blacklist popup');
    }
  } catch (e) {
    out.error = e.message;
    console.error('[probe] Blacklist popup failure:', e.message.split('\n')[0]);
  }
}

await writeFile(path.join(OUT, `${site.id}-blacklist-popup-probe.json`), JSON.stringify(out, null, 2));
console.log('\n=== BLACKLIST POPUP PROBE ===');
console.log(JSON.stringify({
  buttonState: out.blacklistButton,
  outerPopup: out.outerPopup && {
    title: out.outerPopup.title,
    selects: out.outerPopup.selects.slice(0, 5),
    buttons: out.outerPopup.buttons,
    multiselects: out.outerPopup.multiselects?.slice(0, 5).map((m) => m.text.slice(0, 100)),
  },
  innerForm: out.innerForm && {
    title: out.innerForm.title,
    inputs: out.innerForm.inputs.slice(0, 10),
    selects: out.innerForm.selects.slice(0, 5),
    buttons: out.innerForm.buttons?.slice(0, 8),
    checkboxCount: out.innerForm.checkboxCount,
    multiselectCount: out.innerForm.multiselects?.length,
    multiselectsTop: out.innerForm.multiselects?.slice(0, 5).map((m) => m.text.slice(0, 100)),
  },
}, null, 2));

await ctx.close();
await browser.close();
