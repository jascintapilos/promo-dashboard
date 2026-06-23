// Probe: investigate the manual "duplicate an existing template" flow on
// QP2A's /superuser/message-template list. Operator confirmed (2026-05-14)
// that manually duplicating + saving works fine, while the bot's
// top-bar Create → fresh dialog → Submit consistently 422s.
//
// Goal:
//   1. Dump every clickable element (icon, button, link) in the Actions
//      column of the first ~5 rows. Identify the Duplicate / Copy action.
//   2. Click that action on row 0, then dump the resulting dialog —
//      every visible AND hidden input, all formcontrolnames, all current
//      values. We need to see what fields the manual flow pre-fills that
//      the Create-from-blank flow leaves null.
//   3. Set up route interception on /api/bo/messagetemplate so if the
//      operator then clicks Submit (after editing Name to TEST_*), we
//      capture the full POST body. That body is the source-of-truth for
//      what the bot needs to send.
//
// Read-only with respect to data: the probe does NOT click Submit on its
// own. Operator must press Enter to close, OR click Submit themselves
// after changing the Name — either way we get useful data.
//
//   node src/browser/qp2-template-duplicate-probe.js

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { getSite } from '../sites.js';

const site = getSite('ibc22');
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (a) => { rl.close(); resolve(a.trim()); }));
}

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 30, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

// ── Login ────────────────────────────────────────────────────────────
await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
await page.locator('button:has-text("Login")').click();
await page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
console.log('[login] ok');

// ── Capture ALL /api/bo/messagetemplate non-GET traffic from now on ──
const captured = [];
page.on('request', (req) => {
  if (req.method() !== 'GET' && /\/api\/bo\/messagetemplate/i.test(req.url())) {
    let body = req.postData() || '';
    try { body = JSON.parse(body); } catch {}
    captured.push({ method: req.method(), url: req.url(), body });
    console.log(`\n  >>> ${req.method()} ${req.url()}`);
    console.log(`      body keys: ${typeof body === 'object' ? Object.keys(body).join(', ') : 'raw-string'}`);
  }
});
page.on('response', async (resp) => {
  if (resp.request().method() !== 'GET' && /\/api\/bo\/messagetemplate/i.test(resp.url())) {
    const status = resp.status();
    let text = '';
    try { text = (await resp.text()).slice(0, 1500); } catch {}
    console.log(`  <<< ${status} ${resp.url()}`);
    if (status >= 400 || text.length < 800) console.log(`      ${text}`);
  }
});

// ── Navigate to 6.6 ──────────────────────────────────────────────────
await page.goto(`${site.baseUrl}/superuser/message-template`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2000);

// Click Search to populate the table.
try {
  await page.locator('button:has-text("Search")').first().click({ timeout: 5000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
} catch {}

// ── Step 1: dump Actions column for first 5 rows ─────────────────────
const rowsDump = await page.evaluate(() => {
  const trs = Array.from(document.querySelectorAll('table tbody tr')).filter((r) => r.offsetParent !== null).slice(0, 5);
  return trs.map((tr, idx) => {
    const cells = Array.from(tr.querySelectorAll('td'));
    // Actions cell = last cell (or last 2)
    const actionsCell = cells[cells.length - 1];
    const codeCell = cells[1]; // Code column per earlier probe
    if (!actionsCell) return { idx, error: 'no actions cell' };
    const clickables = Array.from(actionsCell.querySelectorAll('a, button, i, [role="button"], [class*="btn"], [class*="action"], [class*="icon"]'))
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        title: el.getAttribute('title') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        cls: (el.className.toString() || '').slice(0, 120),
        outerHTML: el.outerHTML.slice(0, 300),
      }));
    // Whole cell HTML for context (sometimes icons are SVG/font with no
    // semantic attributes — only the surrounding markup tells us what they do).
    return {
      idx,
      code: (codeCell?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      actionsCellHTML: actionsCell.innerHTML.slice(0, 1200),
      clickables,
    };
  });
});

await writeFile(path.join(OUT, 'qp2-template-row-actions.json'), JSON.stringify(rowsDump, null, 2));
console.log('\n=== Row Actions ===');
for (const r of rowsDump) {
  console.log(`\n  [row ${r.idx}] code="${r.code}"`);
  console.log(`     actions cell HTML: ${r.actionsCellHTML?.replace(/\s+/g, ' ').slice(0, 400)}`);
  for (const c of (r.clickables || [])) {
    console.log(`       <${c.tag}> text="${c.text}" title="${c.title}" aria="${c.ariaLabel}" cls="${c.cls.slice(0, 70)}"`);
  }
}

// ── Step 2: try to click a Duplicate-ish action on row 0 ─────────────
console.log('\n[step 2] looking for a Duplicate-style action on row 0…');
const clicked = await page.evaluate(() => {
  const tr = document.querySelectorAll('table tbody tr')[0];
  if (!tr) return { ok: false, reason: 'no row 0' };
  const cells = tr.querySelectorAll('td');
  const actions = cells[cells.length - 1];
  if (!actions) return { ok: false, reason: 'no actions cell' };
  const all = Array.from(actions.querySelectorAll('a, button, i, [role="button"]')).filter((el) => el.offsetParent !== null);
  // First try by visible text / title / aria-label
  const dup = all.find((el) => {
    const t = ((el.textContent || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
    return /duplicate|clone|copy/.test(t);
  });
  if (dup) { dup.click(); return { ok: true, via: 'text-match', html: dup.outerHTML.slice(0, 200) }; }
  // Fall back: try by class name (font-awesome / kt icons)
  const cls = all.find((el) => /copy|clone|duplicate/i.test(el.className.toString()));
  if (cls) { cls.click(); return { ok: true, via: 'class-match', html: cls.outerHTML.slice(0, 200) }; }
  return { ok: false, reason: 'no duplicate-like action found', tried: all.length };
});
console.log('  →', clicked);

if (!clicked.ok) {
  console.log('\n  ⚠ No Duplicate action found in the row. Falling back to opening row 0 (Edit/View).');
  await page.evaluate(() => {
    const tr = document.querySelectorAll('table tbody tr')[0];
    if (!tr) return;
    const cells = tr.querySelectorAll('td');
    const actions = cells[cells.length - 1];
    const first = actions?.querySelector('a, button, i, [role="button"]');
    first?.click();
  });
}

await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, 'qp2-template-duplicate-dialog.png'), fullPage: true }).catch(() => {});

// ── Step 3: dump the resulting dialog ────────────────────────────────
const dialogDump = await page.evaluate(() => {
  const dialogs = Array.from(document.querySelectorAll('.modal-content, mat-dialog-container, [role="dialog"]')).filter((d) => d.offsetParent !== null);
  if (!dialogs.length) return { error: 'no dialog' };
  const dialog = dialogs[dialogs.length - 1];
  return {
    title: dialog.querySelector('.modal-header, .modal-title, h4, h5, mat-dialog-title')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) || '',
    visibleInputs: Array.from(dialog.querySelectorAll('input')).filter((el) => el.offsetParent !== null).map((el) => ({
      fc: el.getAttribute('formcontrolname'),
      name: el.name,
      id: el.id,
      type: el.type,
      placeholder: el.placeholder,
      value: el.value,
      nearbyLabel: (() => {
        let p = el;
        for (let i = 0; i < 5 && p.parentElement; i++) {
          p = p.parentElement;
          const l = p.querySelector('label, span.kt-font-bold, .form-label');
          if (l && l !== el) return (l.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        }
        return null;
      })(),
    })),
    hiddenInputs: Array.from(dialog.querySelectorAll('input[type="hidden"]')).map((el) => ({
      fc: el.getAttribute('formcontrolname'),
      name: el.name,
      id: el.id,
      value: el.value,
    })),
    selects: Array.from(dialog.querySelectorAll('select')).filter((el) => el.offsetParent !== null).map((el) => ({
      fc: el.getAttribute('formcontrolname'),
      value: el.value,
      valueLabel: el.options[el.selectedIndex]?.textContent?.trim() || null,
      optionCount: el.options.length,
    })),
    tabs: Array.from(dialog.querySelectorAll('.mat-tab-label, [role="tab"], .nav-tabs li'))
      .filter((t) => t.offsetParent !== null)
      .map((t) => (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)),
    submitBtnPresent: !!Array.from(dialog.querySelectorAll('button')).find((b) => /^\s*Submit\s*$/i.test((b.textContent || '').trim())),
  };
});

await writeFile(path.join(OUT, 'qp2-template-duplicate-dialog.json'), JSON.stringify(dialogDump, null, 2));
console.log('\n=== Duplicate / Edit dialog dump ===');
console.log(`  title: "${dialogDump.title}"`);
console.log(`  tabs: ${(dialogDump.tabs || []).join(', ')}`);
console.log('  visible inputs:');
for (const i of (dialogDump.visibleInputs || [])) {
  console.log(`    fc="${i.fc}" name="${i.name}" type=${i.type} label="${i.nearbyLabel}" value="${(i.value || '').slice(0, 50)}"`);
}
console.log('  hidden inputs:');
for (const i of (dialogDump.hiddenInputs || [])) {
  console.log(`    fc="${i.fc}" name="${i.name}" id="${i.id}" value="${(i.value || '').slice(0, 80)}"`);
}
console.log('  selects:');
for (const s of (dialogDump.selects || [])) {
  console.log(`    fc="${s.fc}" value="${s.value}" label="${s.valueLabel}" options=${s.optionCount}`);
}
console.log(`  Submit button present: ${dialogDump.submitBtnPresent}`);

// ── Step 4: wait for operator to do the manual save (if desired) ─────
console.log('');
console.log('────────────────────────────────────────────────────────────');
console.log('OPERATOR: edit the Name (e.g. add _PROBE suffix) and click Submit on the dialog.');
console.log('Any POST to /api/bo/messagetemplate will be captured here.');
console.log('Then press Enter in this terminal to dump the captured payloads.');
console.log('Type "skip" + Enter to skip and just dump what we already have.');
console.log('────────────────────────────────────────────────────────────');
await waitForEnter('> ');

await writeFile(path.join(OUT, 'qp2-template-duplicate-capture.json'), JSON.stringify(captured, null, 2));
console.log(`\nCaptured ${captured.length} non-GET /api/bo/messagetemplate calls:`);
for (const c of captured) {
  console.log(`\n  ${c.method} ${c.url}`);
  if (typeof c.body === 'object') {
    console.log(`    keys: ${Object.keys(c.body).join(', ')}`);
    if (c.body.code !== undefined) console.log(`    code: "${c.body.code}"`);
    if (c.body.name !== undefined) console.log(`    name: "${c.body.name}"`);
    if (c.body.section !== undefined) console.log(`    section: ${JSON.stringify(c.body.section)}`);
    if (c.body.type !== undefined) console.log(`    type: ${JSON.stringify(c.body.type)}`);
    if (c.body.id !== undefined) console.log(`    id: ${JSON.stringify(c.body.id)}`);
    if (c.body.details) console.log(`    details locale keys: [${Object.keys(c.body.details).join(', ')}]`);
  } else {
    console.log(`    raw: ${String(c.body).slice(0, 200)}`);
  }
}

console.log('\nArtifacts:');
console.log('  captures/qp2-template-row-actions.json');
console.log('  captures/qp2-template-duplicate-dialog.json');
console.log('  captures/qp2-template-duplicate-dialog.png');
console.log('  captures/qp2-template-duplicate-capture.json');

await page.waitForTimeout(1500);
await ctx.close();
await browser.close();
