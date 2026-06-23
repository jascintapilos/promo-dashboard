// Open the first existing Message Template in section 6.6 and dump its
// Subject + body (Rich Text Editor) per locale, plus any variables list.
//
//   node src/browser/qpro-6-6-template-detail.js --site=qpro11

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const site = getSite(flags.site || 'qpro11');
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 30, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
const loginResp = page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.locator('button:has-text("Login")').click();
await loginResp;
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.goto(`${site.baseUrl}/superuser/message-template`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500);

// Click the FIRST row's Actions cell — looking for View / Edit icon (eye or pencil).
// Try several common patterns.
const actionSelectors = [
  'tbody tr:first-child td:last-child i, tbody tr:first-child td:last-child a, tbody tr:first-child td:last-child button',
  'tbody tr:first-child [class*="eye"]',
  'tbody tr:first-child [class*="edit"]',
  'tbody tr:first-child [class*="fa-eye"]',
];
let opened = false;
for (const sel of actionSelectors) {
  try {
    const candidate = page.locator(sel).first();
    await candidate.waitFor({ timeout: 1500 });
    await candidate.click({ force: true, timeout: 1500 });
    await page.waitForTimeout(2500);
    opened = true;
    console.log(`[probe] opened first row via: ${sel}`);
    break;
  } catch {}
}

await page.screenshot({ path: path.join(OUT, `${site.id}-6-6-template-existing.png`), fullPage: true });

// Dump the detail dialog
const detail = await page.evaluate(() => {
  const dialog = Array.from(document.querySelectorAll('mat-dialog-container, [role="dialog"], .modal-content'))
    .filter((d) => d.offsetParent !== null && /Template|Message/i.test(d.textContent || ''))
    .pop();
  if (!dialog) return { error: 'no template dialog visible' };

  // Top-level form fields (Section / Type / Name / Code / Sync Content From)
  const topFields = [];
  dialog.querySelectorAll('input, select').forEach((el) => {
    if (!(el.offsetWidth || el.offsetHeight)) return;
    topFields.push({
      tag: el.tagName.toLowerCase(),
      type: el.type || '',
      formcontrolname: el.getAttribute('formcontrolname') || '',
      placeholder: el.placeholder || '',
      value: (el.value || '').slice(0, 120),
      options: el.tagName === 'SELECT' ? Array.from(el.options).map((o) => o.textContent.trim()).slice(0, 12) : undefined,
    });
  });

  // Locale tabs (MY_EN, MY_ZH, SG_EN, etc.)
  const tabs = Array.from(dialog.querySelectorAll('.mat-tab-label, .nav-tabs li, [role="tab"]'))
    .filter((t) => t.offsetParent !== null)
    .map((t) => ({
      text: (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
      active: t.classList.contains('active') || t.getAttribute('aria-selected') === 'true',
      cls: t.className.slice(0, 60),
    }));

  // Subject + body — for currently-visible tab, capture Subject input and the
  // Rich Text Editor's HTML content
  const subjectInput = dialog.querySelector('input[formcontrolname*="subject"]:not([disabled]), input[placeholder*="Subject"]');
  const subject = subjectInput ? subjectInput.value : '';
  // Rich Text Editor: typically a contenteditable div from Quill / TinyMCE / NgxEditor
  const editor = dialog.querySelector('[contenteditable="true"], .ql-editor, .tox-edit-area, [role="textbox"]');
  const body = editor ? editor.innerHTML.slice(0, 1500) : '';
  const bodyText = editor ? editor.textContent.trim().slice(0, 500) : '';

  // Variables panel
  const variablesPanel = Array.from(dialog.querySelectorAll('*')).find((el) => /usable\s*variables/i.test(el.textContent || ''));
  let variables = [];
  if (variablesPanel) {
    // Look for the list of variables right after this label
    const root = variablesPanel.parentElement || variablesPanel;
    variables = Array.from(root.querySelectorAll('code, .badge, .variable-token, span[class*="variable"], li')).slice(0, 30)
      .map((v) => (v.textContent || '').trim()).filter((t) => t && t.length < 80);
  }

  return {
    headings: Array.from(dialog.querySelectorAll('h1, h2, h3, h4, h5, .kt-portlet__head-label, .modal-title')).map((h) => h.textContent.trim().slice(0, 80)),
    topFields,
    tabs,
    activeTabText: tabs.find((t) => t.active)?.text || '',
    subject,
    bodyHtml: body,
    bodyText,
    variables,
    rawHtmlSample: dialog.innerHTML.slice(0, 2500),
  };
});

await writeFile(path.join(OUT, `${site.id}-6-6-existing-detail.json`), JSON.stringify(detail, null, 2));

console.log('=== Existing template detail ===');
console.log(`  headings: ${JSON.stringify(detail.headings)}`);
console.log(`  topFields:`);
detail.topFields?.forEach((f) => console.log(`    ${f.tag}[${f.type}] fcn="${f.formcontrolname}" value="${f.value}" options=${f.options?.length ?? '-'}`));
console.log(`  locale tabs: ${detail.tabs?.map((t) => `"${t.text}"${t.active ? '★' : ''}`).join(', ')}`);
console.log(`  active tab: "${detail.activeTabText}"`);
console.log(`  Subject: "${detail.subject}"`);
console.log(`  Body (text, first 500 chars): "${detail.bodyText}"`);
console.log(`  Body HTML (first 600 chars):`);
console.log(`    ${detail.bodyHtml?.slice(0, 600)}`);
console.log(`  variables: ${JSON.stringify(detail.variables)}`);

await ctx.close();
await browser.close();
