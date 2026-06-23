// Spy the Currency popup on the QPRO Create form. The "+ Promotion
// Currency" button is disabled until the main form has its required fields
// filled, so this probe first fills the prerequisites (code, name,
// promo_type, sub_type, bonus_rate, validity) — then clicks the button —
// then captures the popup + the inner "+ Add" form DOM.
//
//   node src/browser/qpro-currency-popup-probe.js --site=qpro11

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

// Login.
await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded' });
await page.locator('input[formcontrolname="merchant_code"]').waitFor({ timeout: 20000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
const loginResp = page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200);
await page.locator('button:has-text("Login")').click();
await loginResp;
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
console.error('[probe] logged in');

// Open Create form.
await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.locator('button:has-text("Create")').first().click();
await page.waitForTimeout(2500);
console.error('[probe] Create form open');

// Fill prerequisites. Use .last() to target the Create form rather than the
// search filters above. Test order: text fields → dropdowns → numeric.
const TEST_CODE = `TEST_PROBE_${Date.now()}`;
try { await page.locator('input[formcontrolname="code"]').last().fill(TEST_CODE); } catch (e) { console.error('[probe] code fill:', e.message.split('\n')[0]); }
try { await page.locator('input[formcontrolname="name"]').last().fill('Probe test promo'); } catch (e) { console.error('[probe] name fill:', e.message.split('\n')[0]); }
try { await page.locator('select[formcontrolname="promo_type"]').last().selectOption({ label: 'Deposit' }); } catch (e) { console.error('[probe] promo_type:', e.message.split('\n')[0]); }
await page.waitForTimeout(700);
try { await page.locator('select[formcontrolname="promo_sub_type"]').last().selectOption({ label: 'Welcome' }); } catch (e) { console.error('[probe] sub_type:', e.message.split('\n')[0]); }
try { await page.locator('input[formcontrolname="bonus_rate"]').last().fill('120'); } catch (e) { console.error('[probe] bonus_rate:', e.message.split('\n')[0]); }
try { await page.locator('input[formcontrolname="validity"]').last().fill('30'); } catch (e) { console.error('[probe] validity:', e.message.split('\n')[0]); }
try { await page.locator('input[formcontrolname="reward_validity"]').last().fill('7'); } catch (e) { console.error('[probe] reward_validity:', e.message.split('\n')[0]); }
try { await page.locator('input[formcontrolname="multiplier"]').first().fill('15'); } catch (e) { console.error('[probe] multiplier:', e.message.split('\n')[0]); }

await page.waitForTimeout(1000);
console.error('[probe] prerequisites filled. Checking Currency button state…');

// Scroll into view and check button state.
const currencyBtn = page.locator('button:has-text("Promotion Currency")').first();
const btnPresent = await currencyBtn.count();
let btnEnabled = false;
if (btnPresent > 0) {
  await currencyBtn.scrollIntoViewIfNeeded().catch(() => {});
  btnEnabled = await currencyBtn.isEnabled().catch(() => false);
}
console.error(`[probe] Currency button: present=${btnPresent > 0} enabled=${btnEnabled}`);
await page.screenshot({ path: path.join(OUT, `${site.id}-create-prefilled.png`), fullPage: true }).catch(() => {});

// Try to click and capture.
const out = { btnPresent: btnPresent > 0, btnEnabled };

if (btnPresent > 0 && btnEnabled) {
  try {
    await currencyBtn.click({ timeout: 5000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, `${site.id}-currency-popup.png`), fullPage: true }).catch(() => {});

    // Capture the topmost visible modal/dialog.
    out.popupShape = await page.evaluate(() => {
      const modals = Array.from(document.querySelectorAll('[role="dialog"], .modal-dialog, .modal-content, kt-modal, ngb-modal-window, .mat-dialog-container'));
      const vis = modals.filter((m) => m.offsetWidth || m.offsetHeight);
      const top = vis[vis.length - 1] || document.body;
      const visEl = (e) => !!(e.offsetWidth || e.offsetHeight);
      return {
        modalCount: vis.length,
        modalTag: top.tagName.toLowerCase(),
        title: (top.querySelector('.modal-title, h4, h3, h2')?.textContent || '').trim(),
        inputs: Array.from(top.querySelectorAll('input, textarea')).filter(visEl).map((e) => ({
          tag: e.tagName.toLowerCase(), type: e.type || '', placeholder: e.placeholder || '',
          formcontrolname: e.getAttribute('formcontrolname') || '',
        })),
        selects: Array.from(top.querySelectorAll('select')).filter(visEl).map((e) => ({
          formcontrolname: e.getAttribute('formcontrolname') || '',
          options: Array.from(e.options).slice(0, 12).map((o) => o.textContent.trim()),
        })),
        buttons: Array.from(top.querySelectorAll('button, a[role="button"]')).filter(visEl)
          .map((e) => ({ text: (e.textContent || '').trim().slice(0, 50), type: e.type || '' }))
          .filter((b) => b.text.length > 0 && b.text.length < 50),
        multiselects: Array.from(top.querySelectorAll('kt-dropdown-wo-lazyload, kt-dropdown')).filter(visEl)
          .map((e) => ({ text: (e.textContent || '').trim().slice(0, 120) })),
      };
    });
    console.error(`[probe] popup captured: inputs=${out.popupShape.inputs.length} selects=${out.popupShape.selects.length}`);

    // Now click "+ Add" inside the popup.
    const addBtn = page.locator(`[role="dialog"]:visible button:has-text("Add"), .modal-content:visible button:has-text("Add")`).last();
    if (await addBtn.count() > 0) {
      try {
        await addBtn.click({ timeout: 3000 });
        await page.waitForTimeout(2500);
        await page.screenshot({ path: path.join(OUT, `${site.id}-currency-add-form.png`), fullPage: true }).catch(() => {});
        out.addForm = await page.evaluate(() => {
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
          };
        });
        console.error(`[probe] Add form captured: inputs=${out.addForm.inputs.length} selects=${out.addForm.selects.length}`);
      } catch (e) {
        console.error('[probe] Add click failed:', e.message.split('\n')[0]);
      }
    } else {
      console.error('[probe] no Add button found inside Currency popup');
    }
  } catch (e) {
    console.error('[probe] Currency click failed:', e.message.split('\n')[0]);
    out.clickError = e.message;
  }
}

await writeFile(path.join(OUT, `${site.id}-currency-popup-probe.json`), JSON.stringify(out, null, 2));
console.log('\n=== CURRENCY POPUP PROBE ===');
console.log(JSON.stringify({
  btnPresent: out.btnPresent,
  btnEnabled: out.btnEnabled,
  popup: out.popupShape && {
    title: out.popupShape.title,
    inputs: out.popupShape.inputs.slice(0, 10),
    selects: out.popupShape.selects.slice(0, 5),
    buttons: out.popupShape.buttons?.filter((b) => /add|submit|close|save/i.test(b.text)),
  },
  addForm: out.addForm && {
    title: out.addForm.title,
    inputs: out.addForm.inputs,
    selects: out.addForm.selects,
    buttons: out.addForm.buttons?.filter((t) => /add|submit|close|save|cancel/i.test(t)),
  },
}, null, 2));

await ctx.close();
await browser.close();
