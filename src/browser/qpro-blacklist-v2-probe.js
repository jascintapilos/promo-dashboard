// Take 2 on the Blacklist popup. Hypothesis: the per-promo "+ BlackList"
// button at the bottom of the Create form is hidden until at least one
// Currency row is saved. So this probe: fills prereqs → opens Currency →
// adds a row → closes → THEN looks for any Blacklist-style button at the
// bottom of the form. Reports all visible buttons with positions.
//
//   node src/browser/qpro-blacklist-v2-probe.js --site=qpro11

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
console.error('[probe] Create form open');

// Prereqs
const TEST_CODE = `TEST_BL2_${Date.now()}`;
try { await page.locator('input[formcontrolname="code"]').last().fill(TEST_CODE); } catch {}
try { await page.locator('input[formcontrolname="name"]').last().fill('Probe BL2'); } catch {}
try { await page.locator('select[formcontrolname="promo_type"]').last().selectOption({ label: 'Deposit' }); } catch {}
await page.waitForTimeout(700);
try { await page.locator('select[formcontrolname="promo_sub_type"]').last().selectOption({ label: 'Welcome' }); } catch {}
try { await page.locator('input[formcontrolname="bonus_rate"]').last().fill('120'); } catch {}
try { await page.locator('input[formcontrolname="validity"]').last().fill('30'); } catch {}
try { await page.locator('input[formcontrolname="reward_validity"]').last().fill('7'); } catch {}
try { await page.locator('input[formcontrolname="multiplier"]').first().fill('15'); } catch {}
await page.waitForTimeout(800);
console.error('[probe] prereqs done');

// Open Currency → Add → fill → submit → close
const out = { steps: [] };
try {
  await page.locator('button:has-text("Promotion Currency")').first().click({ timeout: 5000 });
  await page.waitForTimeout(2000);
  const addBtn = page.locator(`[role="dialog"]:visible button:has-text("Add"), .modal-content:visible button:has-text("Add")`).last();
  await addBtn.click({ timeout: 5000 });
  await page.waitForTimeout(1500);
  await page.locator('select[formcontrolname="currency_id"]').last().selectOption({ label: 'MYR' });
  await page.locator('input[formcontrolname="max_total_applications"]').last().fill('0');
  await page.locator('input[formcontrolname="max_total_bonus"]').last().fill('0');
  await page.locator('input[formcontrolname="min_transfer"]').last().fill('50');
  await page.locator('input[formcontrolname="max_bonus"]').last().fill('300');
  await page.locator('input[formcontrolname="max_transfer_out"]').last().fill('0');
  await page.locator('select[formcontrolname="status"]').last().selectOption({ label: 'Active' });
  const submitBtn = page.locator(`[role="dialog"]:visible button:has-text("Submit"), .modal-content:visible button:has-text("Submit")`).last();
  await submitBtn.click({ timeout: 5000 });
  await page.waitForTimeout(2000);
  const closeBtn = page.locator(`[role="dialog"]:visible button:has-text("Close")`).last();
  await closeBtn.click({ timeout: 3000 });
  await page.waitForTimeout(1500);
  out.steps.push('currency_added_and_closed');
  console.error('[probe] Currency row saved + popup closed');
} catch (e) {
  out.steps.push(`currency_step_failed: ${e.message.split('\n')[0]}`);
  console.error('[probe] Currency step failed:', e.message.split('\n')[0]);
}

// Now scroll to the bottom of the form and list every visible button.
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, `${site.id}-after-currency-saved.png`), fullPage: true }).catch(() => {});

const buttons = await page.$$eval('button, a[role="button"]', (els) => els.map((e) => {
  const r = e.getBoundingClientRect();
  return {
    text: (e.textContent || '').trim().slice(0, 60),
    x: Math.round(r.left), y: Math.round(r.top),
    visible: r.width > 0 && r.height > 0,
    disabled: e.disabled,
  };
}).filter((b) => b.visible && b.text.length > 0 && b.text.length < 60));

out.buttonsAfterCurrencySaved = buttons;
console.log('VISIBLE BUTTONS AFTER CURRENCY ROW SAVED:');
buttons.forEach((b) => console.log(`  pos=(${b.x},${b.y}) ${b.disabled ? 'DISABLED ' : ''}"${b.text}"`));

// Try clicking any button whose text contains "Blacklist" or "BlackList", excluding the top-right "Blacklist" filter button.
const blCandidates = buttons.filter((b) => /black\s*list/i.test(b.text));
console.error(`[probe] Blacklist candidates: ${blCandidates.length}`);
for (const b of blCandidates) console.error(`  candidate: "${b.text}" @ (${b.x},${b.y})`);

// If we found a bottom-of-form Blacklist button (y > 700 typically), try clicking it.
const bottomBl = blCandidates.find((b) => b.y > 700) || blCandidates[blCandidates.length - 1];
if (bottomBl) {
  try {
    // Click via locator + has-text + nth (use the last one which should be the bottom).
    const blBtn = page.locator('button:has-text("Blacklist"), button:has-text("BlackList")').last();
    await blBtn.scrollIntoViewIfNeeded().catch(() => {});
    await blBtn.click({ timeout: 5000 });
    await page.waitForTimeout(2500);
    out.steps.push('blacklist_clicked');
    await page.screenshot({ path: path.join(OUT, `${site.id}-blacklist-popup-v2.png`), fullPage: true }).catch(() => {});
    out.popupShape = await page.evaluate(() => {
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
          options: Array.from(e.options).slice(0, 12).map((o) => o.textContent.trim()),
        })),
        buttons: Array.from(top.querySelectorAll('button, a[role="button"]')).filter(visEl)
          .map((e) => (e.textContent || '').trim().slice(0, 50))
          .filter((t) => t.length > 0 && t.length < 50),
        multiselects: Array.from(top.querySelectorAll('kt-dropdown-wo-lazyload, kt-dropdown')).filter(visEl)
          .map((e) => ({ text: (e.textContent || '').trim().slice(0, 200) })),
        checkboxCount: Array.from(top.querySelectorAll('input[type="checkbox"]')).filter(visEl).length,
      };
    });
    console.error(`[probe] popup captured: inputs=${out.popupShape.inputs.length} multiselects=${out.popupShape.multiselects.length} cb=${out.popupShape.checkboxCount}`);
  } catch (e) {
    out.steps.push(`blacklist_click_failed: ${e.message.split('\n')[0]}`);
    console.error('[probe] Blacklist click still failed:', e.message.split('\n')[0]);
  }
}

await writeFile(path.join(OUT, `${site.id}-blacklist-v2-probe.json`), JSON.stringify(out, null, 2));

console.log('\n=== BLACKLIST V2 SUMMARY ===');
console.log('Steps:', out.steps);
if (out.popupShape) {
  console.log('Title:', out.popupShape.title);
  console.log('Modal count:', out.popupShape.modalCount);
  console.log('Inputs:', JSON.stringify(out.popupShape.inputs.slice(0, 8), null, 2));
  console.log('Selects:', JSON.stringify(out.popupShape.selects.slice(0, 6), null, 2));
  console.log('Buttons:', out.popupShape.buttons);
  console.log('Multiselects:', out.popupShape.multiselects.length);
  console.log('Checkboxes:', out.popupShape.checkboxCount);
}

await ctx.close();
await browser.close();
