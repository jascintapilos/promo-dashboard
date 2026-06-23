// Cycle 2+3 probe — open the three remaining components on the QPRO
// Create form and capture their DOM:
//   1. Game Providers multi-select (kt-dropdown) — for the Select All /
//      Unselect All control discovery and option-label format
//   2. Promotion Currency popup — fields and submit button
//   3. Blacklist popup — including the Create Template inner form
//
//   node src/browser/qpro-popups-probe.js --site=qpro11

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

async function login() {
  await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('input[formcontrolname="merchant_code"]').waitFor({ timeout: 20000 });
  await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
  await page.fill('input[formcontrolname="username"]', site.username);
  await page.fill('input[formcontrolname="password"]', site.password);
  const r = page.waitForResponse((x) => x.url().includes('/api/bo/login') && x.status() === 200);
  await page.locator('button:has-text("Login")').click();
  await r;
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}

async function openCreateForm() {
  await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.locator('button:has-text("Create")').first().click();
  await page.waitForTimeout(2500);
}

// Snapshot of every visible button/input/select inside the topmost modal
// or, if no modal, the body.
async function snapshotModal(label) {
  await page.screenshot({ path: path.join(OUT, `${site.id}-${label}.png`), fullPage: true }).catch(() => {});
  return page.evaluate(() => {
    const modals = Array.from(document.querySelectorAll('[role="dialog"], .modal-dialog, .modal-content, .mat-dialog-container, ngb-modal-window'));
    const visibleModals = modals.filter((m) => m.offsetWidth || m.offsetHeight);
    const scope = visibleModals[visibleModals.length - 1] || document.body;
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
    return {
      modalCount: visibleModals.length,
      modalTag: visibleModals.length ? visibleModals[visibleModals.length - 1].tagName.toLowerCase() : null,
      modalTitle: visibleModals.length ? (visibleModals[visibleModals.length - 1].querySelector('.modal-title, h4, h3, h2')?.textContent.trim() || '') : '',
      inputs: Array.from(scope.querySelectorAll('input, textarea')).filter(vis).map((e) => ({
        tag: e.tagName.toLowerCase(),
        type: e.type || '',
        placeholder: e.placeholder || '',
        formcontrolname: e.getAttribute('formcontrolname') || '',
        name: e.name || '',
      })),
      selects: Array.from(scope.querySelectorAll('select')).filter(vis).map((e) => ({
        formcontrolname: e.getAttribute('formcontrolname') || '',
        options: Array.from(e.options).slice(0, 8).map((o) => o.textContent.trim()),
      })),
      buttons: Array.from(scope.querySelectorAll('button, a[role="button"]')).filter(vis).map((e) => ({
        text: (e.textContent || '').trim().slice(0, 50),
        type: e.type || '',
      })).filter((b) => b.text.length > 0 && b.text.length < 50),
      multiselects: Array.from(scope.querySelectorAll('kt-dropdown-wo-lazyload, kt-dropdown, .multiselect')).filter(vis).map((e) => ({
        tag: e.tagName.toLowerCase(),
        text: (e.textContent || '').trim().slice(0, 100),
      })),
    };
  });
}

const out = {};

await login();
await openCreateForm();
console.error('[probe] Create form open');

// ── (A) Game Providers chip — open the dropdown that contains provider names ──
// We don't know the exact label text — try the chip near the "Game Providers" label,
// and also any chip whose visible text starts with a provider prefix.
console.error('[probe] (A) opening Game Providers chip');
try {
  // Look for kt-dropdown near a label/text saying "Game Providers"
  const triggers = [
    page.locator(`:has(label:has-text("Game Providers")) kt-dropdown-wo-lazyload .c-btn`),
    page.locator(`kt-dropdown-wo-lazyload .c-btn:near(:text("Game Providers"))`),
  ];
  let opened = false;
  for (const t of triggers) {
    const n = await t.count();
    if (n === 0) continue;
    try {
      await t.last().click({ timeout: 4000 });
      opened = true;
      console.error(`[probe] (A) opened via ${n} candidates`);
      break;
    } catch {}
  }
  if (opened) {
    await page.waitForTimeout(800);
    out.gameProviders = await page.evaluate(() => {
      const panel = Array.from(document.querySelectorAll('div.dropdown-list, .dropdown-list.animated'))
        .filter((p) => p.offsetWidth || p.offsetHeight).pop();
      if (!panel) return { panelFound: false };
      const items = Array.from(panel.querySelectorAll('li, label')).filter((e) => e.offsetWidth || e.offsetHeight);
      const ctrls = Array.from(panel.querySelectorAll('button, a, label'))
        .filter((e) => /select\s*all|unselect/i.test(e.textContent || ''))
        .map((e) => ({ tag: e.tagName.toLowerCase(), text: (e.textContent || '').trim().slice(0, 40) }));
      return {
        panelFound: true,
        panelClass: panel.className,
        itemCount: items.length,
        hasSearch: !!panel.querySelector('input[type="text"]'),
        controls: ctrls,
        sampleItems: items.slice(0, 25).map((e) => (e.textContent || '').trim().slice(0, 60)),
      };
    });
    console.error(`[probe] (A) Game Providers: items=${out.gameProviders.itemCount} ctrls=${out.gameProviders.controls.map((c) => c.text).join(',')}`);
    // Close
    await page.locator('body').click({ position: { x: 10, y: 10 } }).catch(() => {});
    await page.waitForTimeout(400);
  } else {
    out.gameProviders = { error: 'no trigger matched' };
  }
} catch (e) {
  out.gameProviders = { error: e.message.split('\n')[0] };
}

// ── (B) Promotion Currency popup ─────────────────────────────────────
console.error('[probe] (B) clicking "+ Promotion Currency"');
try {
  const btn = page.locator('button:has-text("Promotion Currency")').first();
  await btn.waitFor({ timeout: 5000 });
  await btn.click();
  await page.waitForTimeout(2500);
  out.currencyPopup = await snapshotModal('currency-popup');
  console.error(`[probe] (B) Currency popup: modalCount=${out.currencyPopup.modalCount} inputs=${out.currencyPopup.inputs.length} selects=${out.currencyPopup.selects.length}`);

  // Some popups show a list first — click Add or + Add to reveal the form
  const addBtn = page.locator(`[role="dialog"]:visible button:has-text("Add"), .modal-content:visible button:has-text("Add")`).last();
  const addCount = await addBtn.count();
  if (addCount > 0) {
    console.error('[probe] (B) clicking + Add inside Currency popup');
    try {
      await addBtn.click({ timeout: 3000 });
      await page.waitForTimeout(1500);
      out.currencyAddForm = await snapshotModal('currency-add-form');
      console.error(`[probe] (B) Currency Add form: inputs=${out.currencyAddForm.inputs.length} selects=${out.currencyAddForm.selects.length}`);
    } catch (e) {
      console.error('[probe] (B) Add click failed:', e.message.split('\n')[0]);
    }
  }

  // Close everything by pressing Escape twice
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
} catch (e) {
  out.currencyPopup = { error: e.message.split('\n')[0] };
}

// ── (C) Blacklist popup ──────────────────────────────────────────────
console.error('[probe] (C) clicking "+ Blacklist"');
try {
  const btn = page.locator('button:has-text("BlackList"), button:has-text("Blacklist")').first();
  await btn.waitFor({ timeout: 5000 });
  await btn.click();
  await page.waitForTimeout(2500);
  out.blacklistPopup = await snapshotModal('blacklist-popup');
  console.error(`[probe] (C) Blacklist popup: modalCount=${out.blacklistPopup.modalCount} buttons=${out.blacklistPopup.buttons.map((b) => b.text).join(' / ')}`);

  // Look for Create Template button
  const createTpl = page.locator(`[role="dialog"]:visible button:has-text("Create"), .modal-content:visible button:has-text("Create")`).last();
  if (await createTpl.count() > 0) {
    try {
      await createTpl.click({ timeout: 3000 });
      await page.waitForTimeout(2500);
      out.blacklistCreateTemplate = await snapshotModal('blacklist-create-template');
      console.error(`[probe] (C) Create Template form: inputs=${out.blacklistCreateTemplate.inputs.length}`);
    } catch (e) {
      console.error('[probe] (C) Create Template click failed:', e.message.split('\n')[0]);
    }
  }
} catch (e) {
  out.blacklistPopup = { error: e.message.split('\n')[0] };
}

await writeFile(path.join(OUT, `${site.id}-popups-probe.json`), JSON.stringify(out, null, 2));
console.log('\n=== POPUPS PROBE SUMMARY ===');
console.log(JSON.stringify({
  gameProviders: out.gameProviders && {
    panelFound: out.gameProviders.panelFound,
    itemCount: out.gameProviders.itemCount,
    controls: out.gameProviders.controls,
    sample: out.gameProviders.sampleItems?.slice(0, 10),
  },
  currencyPopup: out.currencyPopup && {
    modalTitle: out.currencyPopup.modalTitle,
    inputs: out.currencyPopup.inputs.slice(0, 10),
    selects: out.currencyPopup.selects.slice(0, 5),
    relevantButtons: out.currencyPopup.buttons?.filter((b) => /add|submit|close|save/i.test(b.text)),
  },
  currencyAddForm: out.currencyAddForm && {
    modalTitle: out.currencyAddForm.modalTitle,
    inputs: out.currencyAddForm.inputs,
    selects: out.currencyAddForm.selects,
    relevantButtons: out.currencyAddForm.buttons?.filter((b) => /add|submit|close|save/i.test(b.text)),
  },
  blacklistPopup: out.blacklistPopup && {
    modalTitle: out.blacklistPopup.modalTitle,
    inputs: out.blacklistPopup.inputs.slice(0, 5),
    selects: out.blacklistPopup.selects.slice(0, 5),
    relevantButtons: out.blacklistPopup.buttons?.filter((b) => /add|submit|close|create|apply/i.test(b.text)),
  },
  blacklistCreateTemplate: out.blacklistCreateTemplate && {
    modalTitle: out.blacklistCreateTemplate.modalTitle,
    inputs: out.blacklistCreateTemplate.inputs.slice(0, 8),
    selects: out.blacklistCreateTemplate.selects.slice(0, 5),
    multiselectCount: out.blacklistCreateTemplate.multiselects?.length,
    relevantButtons: out.blacklistCreateTemplate.buttons?.filter((b) => /add|submit|close|save|apply/i.test(b.text)),
  },
}, null, 2));

await ctx.close();
await browser.close();
