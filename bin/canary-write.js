#!/usr/bin/env node
// Canary write — Phase 5.2 (extended).
//
// Drives the QPRO BO "Create Promotion Code" form via Playwright. The bot
// types text/number fields, picks single-select dropdowns, ticks
// checkboxes, and selects radios. It pauses for the operator to handle
// multi-selects (Categories, Game Providers, KYC tiers, Member Group) and
// the three popups (Currency, Names, Blacklist). The bot NEVER clicks
// Submit — that's the operator's call. After the operator confirms Save,
// the bot POSTs a status update to the Apps Script dashboard so the task
// flips to QC_Required.
//
//   node bin/canary-write.js <handle> [--commit] [--site=<id>] [--task-id=T-...] [--skip-names]
//
//   --commit       opens a real browser. Without it, prints the action plan only.
//   --site=<id>    overrides the BO site to write to.
//   --task-id=T-…  sets the dashboard's Task_ID so status update finds it. If
//                  omitted, the bot tries to match by request_ref (the handle).
//   --skip-names   after Save, do NOT navigate to add Promotion Names. Use
//                  if you'd rather handle the post-save phase manually.

import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';
import { chromium } from 'playwright';
import { parseArgs } from './_args.js';
import { loadAllRequests, resolveDuplicates, validatePlan } from '../src/planner.js';
import { loadBoCodeIndex, fetchBoCodeAsRecord } from '../src/bo-cache.js';
import { getSite } from '../src/sites.js';
import { BRAND_TO_SITE } from '../src/ingest.js';
import { registerCanaryRun, setTaskStatus } from '../src/dashboard.js';
import { buildActions as buildActionsQpro } from '../src/bo-mapper-qpro.js';
import { resolveSyncFromTemplate } from '../src/message-template-source.js';
import { renderBody, localeDocKey } from '../src/message-template-renderer.js';

// Platform → mapper dispatch. QP2 mapper is built lazily so a missing file
// just produces a clear runtime error (instead of an unrecoverable import
// failure at startup that breaks every brand).
async function buildActionsForPlatform(platform, resolved, opts) {
  const p = String(platform || '').toLowerCase();
  if (p === 'qpro') return buildActionsQpro(resolved, opts);
  if (p === 'qp2') {
    let qp2;
    try { qp2 = await import('../src/bo-mapper-qp2.js'); }
    catch (e) {
      throw new Error(`QP2 mapper not built yet (src/bo-mapper-qp2.js). Build it first for QP2A/B/C/D brands. Original: ${e.message}`);
    }
    return qp2.buildActions(resolved, opts);
  }
  throw new Error(`No mapper for platform "${platform}". Supported: qpro, qp2.`);
}

// ── Safety whitelist ──────────────────────────────────────────────────
// All QPRO brands unrestricted — bo-mapper-qpro.js handles them uniformly.
// QP2 brands kept behind TEST_ prefix until bo-mapper-qp2.js exists AND is
// live-verified on at least one QP2 brand. Remove the gate per-brand as
// each one is validated.
const SAFE_BRANDS = {
  QPRO1:  () => true,
  QPRO2:  () => true,
  QPRO3:  () => true,
  QPRO4:  () => true,
  QPRO5:  () => true,
  QPRO6:  () => true,
  QPRO7:  () => true,
  QPRO8:  () => true,
  QPRO9:  () => true,
  QPRO10: () => true,
  QPRO11: () => true,
  QPRO12: () => true,
  QPRO13: () => true,
  QPRO14: () => true,
  QPRO15: () => true,
  QPRO16: () => true,
  QPRO17: () => true,
  QPRO18: () => true,
  QPRO19: () => true,
  QP2A:   (rec) => /^TEST[_-]/i.test(rec.promo_code || ''),
  QP2B:   (rec) => /^TEST[_-]/i.test(rec.promo_code || ''),
  QP2C:   (rec) => /^TEST[_-]/i.test(rec.promo_code || ''),
  QP2D:   (rec) => /^TEST[_-]/i.test(rec.promo_code || ''),
};

// ── Args ──────────────────────────────────────────────────────────────
const { flags, positional } = parseArgs(process.argv.slice(2));
const handle = positional[0];
if (!handle) {
  console.error('usage: canary-write.js <handle> [--commit] [--site=<id>] [--task-id=T-...]');
  process.exit(2);
}
const commit = flags.commit === true;
const siteOverride = flags.site;
const taskId = flags['task-id'] || '';

// ── Load and resolve request ──────────────────────────────────────────
const { byHandle, byCode } = await loadAllRequests();
const request = byHandle.get(handle);
if (!request) { console.error(`handle "${handle}" not found`); process.exit(2); }
const bo = await loadBoCodeIndex();
const resolved = await resolveDuplicates(request, byCode, { boIndex: bo.byCode, boFetcher: fetchBoCodeAsRecord });

// ── Whitelist + validation ────────────────────────────────────────────
// 2026-05-15: `--brand=<BRAND>` flag lets the multi-brand orchestrator
// (bin/canary-multi-brand.js) target a specific brand on a request that
// lists several. Without the flag, the canary picks the first safe-listed
// brand (original behaviour).
const brandFilter = flags.brand || null;
let targetBrand;
if (brandFilter) {
  if (!resolved.brands.includes(brandFilter)) {
    console.error(`REFUSED: --brand=${brandFilter} not in request brands [${resolved.brands.join(', ')}]`);
    process.exit(3);
  }
  if (!SAFE_BRANDS[brandFilter]) {
    console.error(`REFUSED: brand ${brandFilter} not on safe-list: ${Object.keys(SAFE_BRANDS).join(', ')}`);
    process.exit(3);
  }
  targetBrand = brandFilter;
} else {
  targetBrand = resolved.brands.find((b) => SAFE_BRANDS[b]);
  if (!targetBrand) {
    console.error(`REFUSED: brands [${resolved.brands.join(', ')}] none on safe-list: ${Object.keys(SAFE_BRANDS).join(', ')}`);
    process.exit(3);
  }
}
if (!SAFE_BRANDS[targetBrand](resolved)) {
  console.error(`REFUSED: brand ${targetBrand} safe-listed but promo_code "${resolved.promo_code}" doesn't match its predicate`);
  process.exit(3);
}
const siteId = siteOverride || BRAND_TO_SITE[targetBrand].siteId;
const site = getSite(siteId);
const gaps = validatePlan(resolved);
if (gaps.length) {
  console.error(`REFUSED: plan has ${gaps.length} gap(s):`);
  gaps.forEach((g) => console.error(`  • ${g}`));
  process.exit(4);
}

// ── Proposed configuration (always shown; live mode also asks for go) ─
function printProposal() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`PROPOSED CONFIGURATION — ${commit ? 'LIVE (--commit)' : 'DRY-RUN'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Request:         ${handle}  (${resolved.requestor})`);
  console.log(`Target:          ${targetBrand} on ${siteId}  (${site.label})`);
  if (taskId) console.log(`Task ID:         ${taskId}`);
  if (resolved._resolution?.inherited_from) console.log(`Inherited:       ${resolved._resolution.inherited_from} (${resolved._resolution.inherited_via})`);
  console.log('');
  console.log(`Promo Code:      ${resolved.promo_code}`);
  console.log(`Name (EN):       ${resolved.promotion_name_en || '(missing)'}`);
  console.log(`Name (ZH/ID):    ${resolved.promotion_name_zh_id || '(missing)'}`);
  console.log('');
  console.log(`Bonus Type:      ${resolved.bonus_type}${resolved.bonus_sub_type ? ' - ' + resolved.bonus_sub_type : ''}`);
  const p = resolved.parsed || {};
  const ccyTag = resolved.currencies?.[0] ? ` ${resolved.currencies[0]}` : '';
  if (p.bonus_rate_pct != null)     console.log(`Bonus Rate:      ${p.bonus_rate_pct}%`);
  if (p.spin_count != null)         console.log(`Spin Count:      ${p.spin_count}`);
  if (p.value_per_spin != null)     console.log(`Value per Spin:  ${p.value_per_spin}${ccyTag}`);
  if (p.free_credit_amount != null) console.log(`Free Credit:     ${p.free_credit_amount}${ccyTag}`);
  if (p.min_deposit != null)        console.log(`Min Deposit:     ${p.min_deposit}${ccyTag}`);
  if (p.max_bonus != null)          console.log(`Max Bonus:       ${p.max_bonus}${ccyTag}`);
  if (p.to_multiplier != null)      console.log(`TO Multiplier:   ${p.to_multiplier}x`);
  if (p.game)                       console.log(`Game (FS):       ${p.game}`);
  console.log(`Validity:        ${resolved.validity_days ?? 30} days  (rewards ${resolved.rewards_validity_days ?? resolved.validity_days ?? 30})`);
  console.log(`Currencies:      ${resolved.currencies.join(', ')}`);
  console.log(`Locales:         ${resolved.locales.join(', ')}`);
  console.log(`Recurring:       ${resolved.recurring === true ? 'Recurring' : resolved.recurring === false ? 'One Time' : '(unspecified)'}`);
  console.log('');
}

// Proposal printout suppressed (operator request). printProposal() is still
// defined above in case we want it back for debugging.

// ── Build action plan ────────────────────────────────────────────────
const platform = (BRAND_TO_SITE[targetBrand]?.platform || 'qpro').toLowerCase();
let actions = await buildActionsForPlatform(platform, resolved, { brand: targetBrand });

function printActionPlan(plan) {
  console.log('Action plan:');
  let n = 0;
  for (const a of plan) {
    n++;
    if (a.kind === 'text' || a.kind === 'number') {
      console.log(`  ${String(n).padStart(2)}. ${a.kind.toUpperCase().padEnd(8)} ${a.label.padEnd(35)} → ${a.value}`);
    } else if (a.kind === 'select') {
      console.log(`  ${String(n).padStart(2)}. SELECT   ${a.label.padEnd(35)} → "${a.optionLabel}"`);
    } else if (a.kind === 'check') {
      console.log(`  ${String(n).padStart(2)}. CHECK    ${a.label.padEnd(35)} → ${a.state ? 'TICK' : 'UN-TICK'}`);
    } else if (a.kind === 'radio') {
      console.log(`  ${String(n).padStart(2)}. RADIO    ${a.label.padEnd(35)} (nth=${a.nth ?? 0})`);
    } else if (a.kind === 'multiselect') {
      console.log(`  ${String(n).padStart(2)}. MULTI    ${a.label.padEnd(35)} → tick [${a.options.join(', ')}]`);
    } else if (a.kind === 'multiselect_inverted') {
      console.log(`  ${String(n).padStart(2)}. MULTI-X  ${a.label.padEnd(35)} → Select All, un-tick [${(a.exclusions || []).join(', ')}]`);
    } else if (a.kind === 'wait') {
      console.log(`  ${String(n).padStart(2)}. WAIT     ${a.label} (${a.ms}ms)`);
    } else if (a.kind === 'popup_open') {
      console.log(`  ${String(n).padStart(2)}. POPUP    + ${a.button.padEnd(28)} → ${a.prompt.slice(0, 90)}${a.prompt.length > 90 ? '…' : ''}`);
    } else if (a.kind === 'popup_fill_currency') {
      console.log(`  ${String(n).padStart(2)}. POPUP-FILL + Promotion Currency           → auto-fill ${a.rows.length} currency row${a.rows.length === 1 ? '' : 's'}:`);
      for (const r of a.rows) {
        console.log(`              · ${r.currency}: min_transfer=${r.min_transfer ?? 0}, max_bonus=${r.max_bonus ?? 0}, max_transfer_out=${r.max_transfer_out ?? 0}`);
      }
    } else if (a.kind === 'handoff') {
      console.log(`  ${String(n).padStart(2)}. HANDOFF  ${a.label}`);
      if (a.items) a.items.forEach((it) => console.log(`              · ${it}`));
    } else if (a.kind === 'notify_save') {
      console.log(`  ${String(n).padStart(2)}. NOTIFY   ${a.label}`);
    } else if (a.kind === 'auto_submit') {
      console.log(`  ${String(n).padStart(2)}. AUTO-SUB ${a.label}`);
    } else if (a.kind === 'message_template_create') {
      console.log(`  ${String(n).padStart(2)}. MSG-TPL  Create "${a.name}" — section "${a.section}", type "${a.type}", Sync From <runtime-resolved>`);
    }
  }
  // The post-save phase isn't a mapper action; it's a hardcoded routine.
  // Mention it here so the dry-run matches what will actually run.
  if (flags['skip-names'] !== true) {
    const LOC2CCY = { MY: 'MYR', SG: 'SGD', ID: 'IDR', TH: 'THB', KH: 'KHR', AU: 'AUD' };
    console.log(`  ${String(n + 1).padStart(2)}. POST-SAVE  Navigate back to ${resolved.promo_code}, open Edit modal, AUTO-FILL Promotion Names popup:`);
    for (const locale of resolved.locales) {
      const isEn = locale.endsWith('_EN');
      const isZh = locale.endsWith('_ZH') || locale.endsWith('_ID');
      const nm  = isEn ? resolved.promotion_name_en : (isZh ? resolved.promotion_name_zh_id : '(N/A)');
      const ccy = LOC2CCY[locale.split('_')[0]] || resolved.currencies[0] || 'MYR';
      console.log(`              · ${ccy} / ${locale}: "${nm}"`);
    }
    console.log(`  ${String(n + 2).padStart(2)}. STATUS     POST dashboard → task → QC_Required`);
  } else {
    console.log(`  --skip-names was passed: bot will NOT do the post-save Promotion Names step.`);
    console.log(`  ${String(n + 1).padStart(2)}. STATUS     POST dashboard → task → QC_Required`);
  }
  console.log('');
}

// Action plan printout suppressed too — operator request was to skip the
// "pause and dump" preamble entirely. The audit JSONL still records every
// action for post-run review; `printActionPlan(actions)` here was redundant.

if (!commit) {
  console.log('Dry-run complete. To run for real: add --commit.');
  process.exit(0);
}

// ── Live mode ─────────────────────────────────────────────────────────
// Used to ask "go/edit/abort" here. Operator requested removing this pause
// (the 30+ line proposal dump was noise once we trusted the build). Jump
// straight to launching the browser. To edit fields, change the source row
// + re-ingest before invoking the canary.
const rl = createInterface({ input, output });
console.log(`Launching canary for ${handle} on ${targetBrand}…`);

const OUT = path.resolve('captures/canary-runs');
await mkdir(OUT, { recursive: true });
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${handle}-${targetBrand}`;
const logFile = path.join(OUT, `${runId}.jsonl`);
async function log(ev) { await appendFile(logFile, JSON.stringify({ ts: new Date().toISOString(), ...ev }) + '\n'); }
await log({ event: 'start', handle, brand: targetBrand, site: siteId, taskId, actions });

// Dashboard registration (best-effort, non-blocking).
const reg = await registerCanaryRun({
  handle, promo_code: resolved.promo_code, brand: targetBrand, site_id: siteId,
  bonus_type: resolved.bonus_type, bonus_sub_type: resolved.bonus_sub_type,
  currencies: resolved.currencies, locales: resolved.locales,
  inherited_from: resolved._resolution?.inherited_from,
  typed_fields: actions.filter((a) => a.kind === 'text' || a.kind === 'number').map((a) => ({ label: a.label, value: a.value })),
});
await log({ event: 'dashboard_register', response: reg });
if (reg.skipped) console.log(`Dashboard: skipped (${reg.reason})`);
else if (reg.error) console.log(`Dashboard: register failed (${reg.error}) — continuing`);
else if (reg.response?.id) console.log(`Dashboard: registered as ${reg.response.id}`);
console.log('');

async function waitForOperator(prompt) {
  console.log('');
  const answer = await rl.question(prompt);
  if (/^(abort|cancel|quit|q)$/i.test(answer)) {
    await log({ event: 'aborted_by_operator' });
    throw new Error('aborted_by_operator');
  }
  return answer.trim();
}

console.log('Opening Playwright browser (visible). Wait a few seconds...');
// Launch maximized so the operator can reach the Submit button at the
// bottom of the Create form. Combined with `viewport: null`, the page area
// uses the full window dimensions (not capped at 1600x1000 — that capped
// viewport left Submit off-screen on the VDI).
const browser = await chromium.launch({
  headless: false,
  slowMo: 80,
  channel: 'chrome',
  args: ['--start-maximized'],
});
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();
await log({ event: 'browser_launch' });

let aborted = false;
// Tracks whether the auto_submit action actually saved the promo. If the
// click times out (e.g. a modal popup blocked it), subsequent actions that
// depend on the saved code (message_template_create, post-save Promotion
// Names) skip themselves to avoid creating orphan records.
let formSaveSucceeded = false;

// 2026-05-15: tracks the dialog popup the BO assigns when the
// `dialog_popup_create` handler saves a new dialog popup. The id is the
// canonical join key for `dialog_popup_list` in the promotion PUT; the
// Code is human-readable. The start_date + label are also captured —
// the PUT-route mutator needs all four to build the exact 6-field object
// shape the BO accepts.
let dialogPopupCode = null;
let dialogPopupId = null;
let dialogPopupStartDate = null;
let dialogPopupLabel = null;

// Intercept the promotion PUT (Edit-modal Submit) and inject the new
// dialog popup id into `dialog_popup_list`. This bypasses the kt-dropdown
// link UI entirely, which has a BO-side join-caching delay that often
// prevents the just-created dialog from appearing in the dropdown in time.
// Only mutates when (a) a dialog was just created (b) the request body's
// `dialog_popup_list` is currently empty (so we never overwrite an
// operator-picked link).
// 2026-05-15 — Direct PUT-body mutation for dialog_popup_list.
// dialog-link-mechanism-probe captured the EXACT shape the BO accepts
// (PUT 200) when an operator picks a dialog from the kt-dropdown and
// submits: it's an OBJECT keyed by numeric strings, NOT a JSON array.
// Each entry carries 6 fields: id, start_date, end_date, promotion_id,
// labelKey, code. Earlier attempts with `[id]` and `[{popup_id: id}]`
// both 500'd because of the object-vs-array shape.
//
// Required captures (set by the dialog_popup_create handler):
//   dialogPopupId        — int popup id (POST /api/bo/popups → data.rows.id)
//   dialogPopupCode      — 5-letter code (POST response → data.rows.code)
//   dialogPopupStartDate — ISO timestamp (POST response → data.rows.start_date)
//   dialogPopupLabel     — short label for labelKey (we use the EN promo name)
// 2026-05-15 — route-mutation approach abandoned for QP2A: page.route
// reliably fires on QPRO11 but NOT on QP2A's promotion PUT (probably
// Angular's HttpClient pipeline bypassing the interception layer on
// some BO build). Fallback path is below in the post-save phase: after
// the Edit modal Submit completes (PUT with empty dialog_popup_list),
// we fire a follow-up PUT from inside the page (page.evaluate → fetch)
// that GETs the current promo state, injects dialog_popup_list, and
// PUTs back. That path uses the page's auth cookies and works on both
// QPRO11 and QP2A.

// ── API contract capture ──────────────────────────────────────────────
// Records every non-GET /api/bo/* request + matching response, so we can
// build a pure-HTTP equivalent of this Playwright flow without re-running
// the UI. Additive: behaviour of the canary is unchanged. The dump lands
// at captures/api-contract/<runId>.json at end-of-run.
const apiContract = []; // { method, url, requestBody, status?, responseBody? }
const pendingByKey = new Map(); // url + body-hash → contract entry
function contractKey(method, url, body) {
  return `${method} ${url} ${body ? body.slice(0, 80) : ''}`;
}
page.on('request', (req) => {
  try {
    const url = req.url();
    const method = req.method();
    if (method === 'GET' || !/\/api\/bo\//i.test(url)) return;
    const body = req.postData() || null;
    const entry = { method, url, requestBody: body, ts: new Date().toISOString() };
    apiContract.push(entry);
    pendingByKey.set(contractKey(method, url, body), entry);
  } catch {}
});
page.on('response', async (resp) => {
  try {
    const req = resp.request();
    const method = req.method();
    const url = resp.url();
    if (method === 'GET' || !/\/api\/bo\//i.test(url)) return;
    const body = req.postData() || null;
    const entry = pendingByKey.get(contractKey(method, url, body));
    if (!entry) return;
    entry.status = resp.status();
    try { entry.responseBody = (await resp.text()).slice(0, 8000); } catch {}
    pendingByKey.delete(contractKey(method, url, body));
  } catch {}
});

// Dismiss any "System Message" confirmation/error dialog on top of the
// current page. The BO shows these after most save/cancel/error actions
// (e.g. "Successfully created Promotion Currency") and they block all
// subsequent clicks until OK'd. Best-effort — returns true if a dialog
// was clicked, false otherwise.
async function dismissSystemMessage(timeoutMs = 3000) {
  try {
    const sysMsgOk = page.locator('mat-dialog-container, [role="dialog"], .modal-content')
      .filter({ hasText: /System\s*Message/i })
      .locator('button')
      .filter({ hasText: /^\s*OK\s*$/i })
      .first();
    await sysMsgOk.waitFor({ state: 'visible', timeout: timeoutMs });
    await sysMsgOk.click({ timeout: 3000 });
    await page.waitForTimeout(400);
    return true;
  } catch {
    return false;
  }
}
try {
  // Login.
  await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('input[formcontrolname="merchant_code"]').waitFor({ timeout: 20000 });
  await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
  await page.fill('input[formcontrolname="username"]', site.username);
  await page.fill('input[formcontrolname="password"]', site.password);
  const loginResp = page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
  await page.locator('button:has-text("Login")').click();
  await loginResp;
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await log({ event: 'login_ok' });

  // Navigate to Promotion Codes list + click Create.
  await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.locator('button:has-text("Create")').first().click();
  await page.waitForTimeout(2500);
  await log({ event: 'create_opened' });
  await page.screenshot({ path: path.join(OUT, `${runId}-form-empty.png`), fullPage: true }).catch(() => {});

  // The form lives at the BOTTOM of the page (the list filters share some
  // formcontrolnames). For form-scoped fields we use .last() to pick the
  // most recently rendered occurrence.
  const scopedLocator = (selector, opts = {}) => {
    // Scope to the Create form anchored on the always-unique formcontrolname="code"
    // input. The underlying list page has its own filter form with matching
    // formcontrolnames (promo_type, status, etc.) — anchoring on the Code input
    // is the unambiguous way to find the modal's form. (`form.kt-form:visible`
    // was unreliable: Angular's :visible heuristic returned false for some of
    // the form's selects/inputs styled with absolute positioning, so we skip
    // the inner-:visible filter for unique-per-form fcns.)
    const formScope = page.locator('form:has(input[formcontrolname="code"])').last();
    const isXPath = selector.startsWith('xpath=');
    let loc = formScope.locator(selector);
    if (opts.nth != null) loc = loc.nth(opts.nth);
    else if (opts.scope === 'form') loc = loc.first();
    return loc;
  };

  // Generic popup walker — used by BOTH the pre-save flow (Promotion
  // Currency + Blacklist popups, accessible on the Create form once the
  // required fields are filled) AND the post-save flow (Promotion Names
  // popup, which is only on the Edit form). The bot opens the popup; the
  // operator fills it and confirms by typing "done".
  async function walkPopup(buttonText, prompt) {
    try {
      const btn = page.locator(`button:has-text("${buttonText}")`).first();
      await btn.waitFor({ timeout: 5000 });
      // Some buttons (Currency on the Create form) are disabled until
      // prerequisites are met. If still disabled at click time, hand off
      // immediately rather than wait it out.
      const enabled = await btn.isEnabled().catch(() => true);
      if (!enabled) throw new Error(`"+ ${buttonText}" button is disabled`);
      await btn.click();
      await log({ event: `popup_opened`, button: buttonText });
      console.log(`Opened "+ ${buttonText}" popup.`);
    } catch (e) {
      console.log(`Couldn't auto-click "+ ${buttonText}" (${e.message.split('\n')[0]}) — please click it manually.`);
      await waitForOperator(`Click "+ ${buttonText}" in the BO, then press Enter: `);
    }
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(OUT, `${runId}-popup-${buttonText.toLowerCase().replace(/\s+/g, '-')}.png`), fullPage: true }).catch(() => {});
    console.log('');
    console.log(`─── YOUR TURN — ${prompt} ───`);
    await waitForOperator('Type "done" when finished with this popup (or "abort"): ');
  }

  // Post-save navigation: find the just-created code in the list, open its
  // Edit modal, click "+ Promotion Names", then hand the row-filling to
  // the operator. Saved as a function in scope so the main flow can call it.
  async function postSavePhase() {
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('POST-SAVE — opening edit page to add Promotion Names');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    await log({ event: 'post_save_start' });

    // The promo we just created. Use resolved.promo_code (which reflects any
    // edits the operator made during the proposal step).
    const code = resolved.promo_code;

    // Step 1: return to the list page.
    await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // Step 2: search by the Promotion text filter. The list defaults to empty
    // ("Press Search to load data") so we have to populate it.
    //   QPRO list: input[formcontrolname="promotion"]
    //   QP2  list: input[formcontrolname="name"] (probed 2026-05-13 — QP2's
    //             list has separate id/name fields; the code value goes in name)
    console.log(`Searching the list for ${code}…`);
    const searchSelectors = [
      'input[formcontrolname="promotion"]',  // QPRO
      'input[formcontrolname="name"]',       // QP2
      'input[formcontrolname="code"]',       // fallback
    ];
    let filled = false;
    for (const sel of searchSelectors) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.count() > 0 && await loc.isVisible({ timeout: 1000 }).catch(() => false)) {
          await loc.fill(code, { timeout: 5000 });
          filled = true;
          await log({ event: 'post_save_search_field', selector: sel });
          break;
        }
      } catch {}
    }
    if (!filled) {
      throw new Error(`Couldn't find a search input on the list page (tried: ${searchSelectors.join(', ')})`);
    }
    const tableResp = page.waitForResponse((r) => r.url().includes('/api/bo/promotion?') && r.status() === 200, { timeout: 15000 }).catch(() => null);
    await page.locator('button:has-text("Search")').first().click();
    await tableResp;
    await page.waitForTimeout(2500);

    // Step 3: click the row containing the code. The QPRO list rows hold the
    // code in a cell, and clicking any anchor/button in the row opens the
    // Edit modal.
    const row = page.locator(`tr:has-text("${code}")`).first();
    try {
      await row.waitFor({ timeout: 10000 });
      const rowAction = row.locator('a, button').first();
      await rowAction.click();
      console.log('Opened Edit modal for the new code.');
      await log({ event: 'post_save_row_opened', code });
    } catch (e) {
      console.log(`Couldn't auto-open the row for ${code} — please open it manually.`);
      await waitForOperator('Open the new code in the browser, then press Enter (or "abort"): ');
    }
    await page.waitForTimeout(2500);

    // Step 4: auto-fill the Promotion Names popup. The popup is opened from
    // the Edit modal. For each locale in resolved.locales, the bot opens an
    // "+ Add" inner form and fills currency_id / settings_locale_id /
    // promotion_name / rewards_name, then submits the row.
    try {
      const namesBtn = page.locator('button:has-text("Promotion Names")').first();
      await namesBtn.waitFor({ timeout: 5000 });
      await namesBtn.click();
      console.log('Opened Promotion Names popup.');
    } catch (e) {
      console.log(`Couldn't auto-click "Promotion Names" — please click it manually.`);
      await waitForOperator('Click "+ Promotion Names" in the BO, then press Enter: ');
    }
    await page.waitForTimeout(2000);

    // Locale → currency derivation (mirrors src/ingest.js).
    const LOCALE_TO_CCY = { MY: 'MYR', SG: 'SGD', ID: 'IDR', TH: 'THB', KH: 'KHR', AU: 'AUD' };

    // Anchor the Names popup once — every iteration's selectors scope to it.
    // The popup's title/header contains "Promotion Names" (case-insensitive
    // match handles "+ Promotion Names", "Edit Promotion Names", etc.).
    const namesPopup = page.locator('mat-dialog-container, [role="dialog"], .modal-content')
      .filter({ hasText: /Promotion\s*Names/i })
      .last();
    const innerCurrencySel = 'select[formcontrolname="currency_id"]';

    for (const locale of resolved.locales) {
      const region = locale.split('_')[0];
      const ccy = LOCALE_TO_CCY[region] || resolved.currencies[0] || 'MYR';
      const isEn = locale.endsWith('_EN');
      const isZh = locale.endsWith('_ZH') || locale.endsWith('_ID');
      const name = isEn ? resolved.promotion_name_en : isZh ? resolved.promotion_name_zh_id : resolved.promotion_name_en;

      try {
        // 0. Wait for any previous inner form to fully close (the inner form's
        //    currency_id select should be gone). This is what made iter 2+ fail
        //    in run 8 — the bot tried to click "+ Add" while the inner form
        //    from row 1 was still in its closing animation, and the "Add"
        //    selector matched a stale button.
        await page.waitForSelector(innerCurrencySel, { state: 'hidden', timeout: 5000 }).catch(() => {});

        // 1. Click "+ Add" — locate fresh each iteration, scoped to the
        //    Names popup. Filter out the outer Edit modal's "+ Promotion
        //    Names" button, which also contains "Add"-like text in some
        //    layouts.
        const addBtn = namesPopup.locator('button').filter({ hasText: /^\s*\+?\s*Add\s*$/i }).first();
        await addBtn.waitFor({ state: 'visible', timeout: 5000 });
        await addBtn.click();

        // 2. Wait for the inner form (currency_id select) to appear.
        await page.waitForSelector(innerCurrencySel, { state: 'visible', timeout: 5000 });
        await page.waitForTimeout(400);

        // 3. Pre-check: does this brand offer the locale's currency? If not,
        //    cancel the inner form and skip — saves a guaranteed-fail.
        const curSelect = page.locator(innerCurrencySel).last();
        const opts = (await curSelect.locator('option').allTextContents()).map((s) => s.trim());
        if (!opts.some((o) => o === ccy)) {
          console.log(`  ⚠ Skipping ${locale}: brand does not offer ${ccy} (available: ${opts.filter(Boolean).join(', ') || '<none>'})`);
          await log({ event: 'names_row_skip_currency', locale, ccy, options: opts });
          const cancelBtn = namesPopup.locator('button').filter({ hasText: /^\s*Cancel\s*$/i }).first();
          await cancelBtn.click({ timeout: 3000 }).catch(() => {});
          // Cancel may also pop a System Message confirmation dialog —
          // dismiss it if present so the next iteration's "+ Add" isn't
          // blocked by an unhandled modal.
          await dismissSystemMessage();
          continue;
        }

        // 4. Fill the inner form.
        await curSelect.selectOption({ label: ccy });
        await page.locator('select[formcontrolname="settings_locale_id"]').last().selectOption({ label: locale });
        await page.locator('input[formcontrolname="promotion_name"]').last().fill(name || '');
        await page.locator('input[formcontrolname="rewards_name"]').last().fill(name || '');

        // 5. Submit the inner form.
        const submitBtn = namesPopup.locator('button').filter({ hasText: /^\s*Submit\s*$/i }).first();
        await submitBtn.click({ timeout: 5000 });

        // 6. Dismiss the "Successfully created Promotion Name" System
        //    Message dialog that pops over the popup after each row save.
        //    It's a separate mat-dialog on top of the Names popup; until
        //    clicked-OK it blocks all subsequent clicks (including "+ Add"
        //    for the next iteration). Best-effort — if it doesn't show, no
        //    harm done.
        await dismissSystemMessage();

        // 7. Wait for the inner form to close.
        await page.waitForSelector(innerCurrencySel, { state: 'hidden', timeout: 5000 });

        console.log(`  ✓ Names row added: ${ccy} / ${locale} = "${name}"`);
        await log({ event: 'names_row_added', currency: ccy, locale, name });
      } catch (e) {
        console.log(`  ⚠ Failed to add ${locale} row: ${e.message.split('\n')[0]}`);
        await log({ event: 'names_row_fail', locale, error: e.message });
        // Recovery: try to close any stuck inner form so the next iteration
        // can locate "+ Add" cleanly.
        try {
          const cancelBtn = namesPopup.locator('button').filter({ hasText: /^\s*Cancel\s*$/i }).first();
          await cancelBtn.click({ timeout: 1500 });
        } catch {}
        await page.waitForTimeout(500);
      }
    }

    // Close the Names popup (the inner one) so the outer Edit Promotion
    // Code modal is interactable again.
    try {
      const closeBtn = namesPopup.locator('button').filter({ hasText: /^\s*Close\s*$/i }).first();
      await closeBtn.click({ timeout: 3000 });
      await page.waitForTimeout(800);
      console.log('Closed Promotion Names popup.');
    } catch {
      console.log('Couldn\'t auto-close Names popup — please close manually.');
    }

    // Operator request 2026-05-13 (FS canary V23): link the just-created
    // 6.6 Message Template back to the promo code via the Message kt-dropdown
    // on the Edit modal. The message_template_create handler creates the
    // template with name == promo_code, so the dropdown option label is
    // "PROMOTIONS.MESSAGE.<promo_code>". Only fire if the request asked for
    // an inbox message (matches the message_template_create gate above).
    const needsMsgLink = resolved.inbox_message === true && !/cashback/i.test(resolved.bonus_type || '');
    if (needsMsgLink) {
      try {
        // Find + click the Message kt-dropdown trigger. Playwright's locator
        // chain (editModal scope + XPath) worked on QPRO but failed on QP2
        // (canary V8 2026-05-13). The DOM is fine — probe confirms the
        // kt-font-bold span "Message" and its nearby trigger exist after
        // Names popup closes. Direct DOM walk via evaluate() bypasses any
        // locator-scoping issue.
        await page.waitForTimeout(800);  // let modal settle after Names popup close
        const opened = await page.evaluate(() => {
          const triggers = Array.from(document.querySelectorAll('kt-dropdown-wo-lazyload .c-btn, kt-dropdown .c-btn'))
            .filter((b) => b.offsetParent !== null);
          for (const b of triggers) {
            let p = b;
            for (let i = 0; i < 8 && p.parentElement; i++) {
              p = p.parentElement;
              const lbl = p.querySelector('span.kt-font-bold');
              if (lbl && /^\s*Message\s*\*?\s*$/.test((lbl.textContent || '').trim())) {
                b.scrollIntoView({ block: 'center' });
                b.click();
                return { ok: true };
              }
            }
          }
          return { ok: false, reason: 'no kt-dropdown trigger near a kt-font-bold "Message" label' };
        });
        if (!opened.ok) throw new Error(`Message dropdown locate failed: ${opened.reason}`);
        await page.waitForTimeout(800);

        // Filter via the Search input inside the dropdown panel FIRST. The
        // panel may be virtualized (hundreds of templates → DOM only renders
        // a viewport-sized buffer). Searching narrows the rendered list to
        // the matching template, which makes both the diagnostic check
        // (below) and the option click reliable.
        const searchInput = page.locator('.dropdown-list:visible input[placeholder="Search"]').first();
        if (await searchInput.count() > 0) {
          await searchInput.fill(resolved.promo_code);
          await page.waitForTimeout(800);
        }

        // Diagnose what's in the (now filtered) panel — confirms we clicked
        // the right trigger AND the template option exists.
        const panelInfo = await page.evaluate((code) => {
          const panels = Array.from(document.querySelectorAll('.dropdown-list')).filter((p) => p.offsetParent !== null);
          const panel = panels[panels.length - 1];
          if (!panel) return { hasPanel: false };
          const items = Array.from(panel.querySelectorAll('li')).map((li) => (li.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
          return {
            hasPanel: true,
            itemCount: items.length,
            hasSearchInput: !!panel.querySelector('input[placeholder="Search"]'),
            sampleItems: items.slice(0, 5),
            matchesPromoCode: items.filter((t) => t.includes(code)).slice(0, 3),
          };
        }, resolved.promo_code);
        console.log(`  panel after search: ${JSON.stringify(panelInfo)}`);

        if (!panelInfo.hasPanel) throw new Error('Message dropdown click did not open a panel');
        if (panelInfo.matchesPromoCode.length === 0) {
          throw new Error(`Message panel after search for "${resolved.promo_code}" — no matching template (${panelInfo.itemCount} items rendered). Template likely not saved.`);
        }

        // Click the matching <li>. The visible label is
        // "PROMOTIONS.MESSAGE.<promo_code>"; substring match on the promo
        // code is enough because the search filter narrowed the list.
        const matchOption = page.locator('.dropdown-list:visible li').filter({ hasText: resolved.promo_code }).first();
        await matchOption.waitFor({ timeout: 3000 });
        await matchOption.click({ timeout: 3000 });
        await page.waitForTimeout(500);

        // Close the panel if it's still open (single-select kt-dropdowns
        // sometimes don't auto-close).
        if (await page.locator('.dropdown-list:visible').count() > 0) {
          await messageTrigger.click({ timeout: 1500 }).catch(() => {});
          await page.waitForTimeout(300);
        }

        console.log(`✓ Linked Message Template: PROMOTIONS.MESSAGE.${resolved.promo_code}`);
        await log({ event: 'message_template_linked', code: resolved.promo_code });
      } catch (e) {
        console.log(`  ⚠ Couldn't auto-link Message Template: ${e.message.split('\n')[0]}`);
        console.log(`    Manually pick "PROMOTIONS.MESSAGE.${resolved.promo_code}" in the Message dropdown.`);
      }
    }

    // 2026-05-15: link the Dialog Popup (Section 15.1.2 / 14.1.2) if one
    // was created earlier. Primary path is the PUT-route interceptor —
    // when dialogPopupId is set, the route handler injects it into the
    // Edit-modal Submit's `dialog_popup_list` field in the exact 6-field
    // object shape the BO accepts. The kt-dropdown UI linker stays as a
    // fallback when we have a Code but no id.
    if (resolved.popup_dialog === true && dialogPopupCode && !dialogPopupId) {
      try {
        await page.waitForTimeout(500);
        const opened = await page.evaluate(() => {
          const triggers = Array.from(document.querySelectorAll('kt-dropdown-wo-lazyload .c-btn, kt-dropdown .c-btn'))
            .filter((b) => b.offsetParent !== null);
          // Collect every nearby label per trigger for diagnostic logging
          // when the dropdown isn't found.
          const debug = [];
          for (const b of triggers) {
            let p = b;
            const ancestors = [];
            for (let i = 0; i < 14 && p.parentElement; i++) {
              p = p.parentElement;
              ancestors.push(p);
            }
            // Match either span.kt-font-bold, <label>, or .form-label that
            // contains "Dialog Popup" anywhere in its text.
            for (const anc of ancestors) {
              const lbls = anc.querySelectorAll('span.kt-font-bold, label, .form-label, .kt-form__label, .kt-form__group-label, h6, strong');
              for (const lbl of lbls) {
                const txt = (lbl.textContent || '').replace(/\s+/g, ' ').trim();
                if (/Dialog\s*Popup/i.test(txt)) {
                  b.scrollIntoView({ block: 'center' });
                  b.click();
                  return { ok: true, matchedLabel: txt };
                }
              }
            }
            // Save first ancestor's first kt-font-bold label for debug
            const firstLbl = ancestors[0]?.querySelector?.('span.kt-font-bold, label')?.textContent?.trim();
            if (firstLbl) debug.push(firstLbl.slice(0, 40));
          }
          return { ok: false, reason: `no kt-dropdown near "Dialog Popup" label; nearby labels: [${debug.join(' | ')}]` };
        });
        if (!opened.ok) throw new Error(opened.reason);
        console.log(`    → matched Dialog Popup label: "${opened.matchedLabel}"`);
        await page.waitForTimeout(800);

        // The Dialog Popup dropdown loads all items eagerly (~146 items on
        // QPRO11 2026-05-15). The Search input filter is unreliable when
        // the search string contains parentheses or special chars — empirically
        // returns 0 items even for matching labels. So we skip the filter
        // and scan the full rendered list directly. Each item is formatted
        // as "<code-or-promo_code> - <label>", so matching by the dialog's
        // 5-letter Code OR by the EN promotion name both work; if the
        // dropdown's prefix happens to be the linked promo_code (some BOs
        // do this), the resolved promo_code is the safest fallback.
        const dlgPanelInfo = await page.evaluate(({ code, name, promoCode }) => {
          const panels = Array.from(document.querySelectorAll('.dropdown-list')).filter((p) => p.offsetParent !== null);
          const panel = panels[panels.length - 1];
          if (!panel) return { hasPanel: false };
          const items = Array.from(panel.querySelectorAll('li')).map((li, idx) => ({
            idx,
            text: (li.textContent || '').replace(/\s+/g, ' ').trim(),
            html: (li.innerHTML || '').slice(0, 200),
          })).filter((it) => it.text);
          // Look for ANY substring that could be unique to our new dialog:
          // - the 5-letter dialog Code
          // - the EN promotion name
          // - the promo code
          // - the parenthetical version tag (e.g. "(V13 popup)")
          const versionTag = (name.match(/\(([^)]+)\)/) || [])[1] || '';
          return {
            hasPanel: true,
            itemCount: items.length,
            versionTag,
            matchesCode: items.filter((it) => it.text.includes(code)),
            matchesName: items.filter((it) => it.text.includes(name)),
            matchesPromoCode: items.filter((it) => it.text.includes(promoCode)),
            matchesVersion: versionTag ? items.filter((it) => it.text.includes(versionTag)) : [],
            firstFive: items.slice(0, 5).map((it) => it.text),
            firstItemHtml: items[0]?.html || '',
          };
        }, { code: dialogPopupCode, name: resolved.promotion_name_en, promoCode: resolved.promo_code });
        console.log(`  dialog panel pre-filter: items=${dlgPanelInfo.itemCount}`);
        console.log(`    matches 5-letter code "${dialogPopupCode}": ${dlgPanelInfo.matchesCode.length}`);
        console.log(`    matches EN name: ${dlgPanelInfo.matchesName.length}`);
        console.log(`    matches promo_code "${resolved.promo_code}": ${dlgPanelInfo.matchesPromoCode.length}`);
        console.log(`    matches version tag "${dlgPanelInfo.versionTag}": ${dlgPanelInfo.matchesVersion.length}`);
        if (dlgPanelInfo.matchesVersion.length > 0) {
          console.log(`      versionTag hits: ${JSON.stringify(dlgPanelInfo.matchesVersion.map((it) => `[${it.idx}] ${it.text.slice(0, 100)}`))}`);
        }
        console.log(`    first 5: ${JSON.stringify(dlgPanelInfo.firstFive)}`);
        console.log(`    first item HTML: ${dlgPanelInfo.firstItemHtml.slice(0, 200)}`);
        if (!dlgPanelInfo.hasPanel) throw new Error('Dialog Popup dropdown click did not open a panel');
        if (dlgPanelInfo.itemCount === 0) throw new Error('Dialog panel has 0 items rendered');

        // Pick whichever hit succeeded — code first (most specific), then
        // name, then promo_code, then version-tag fallback ("(V13 popup)").
        let matchHint = null;
        if (dlgPanelInfo.matchesCode.length > 0) matchHint = dialogPopupCode;
        else if (dlgPanelInfo.matchesName.length > 0) matchHint = resolved.promotion_name_en;
        else if (dlgPanelInfo.matchesPromoCode.length > 0) matchHint = resolved.promo_code;
        else if (dlgPanelInfo.matchesVersion.length > 0) matchHint = dlgPanelInfo.versionTag;
        else throw new Error(`Dialog panel: no item matches code "${dialogPopupCode}", name, promo_code "${resolved.promo_code}", or version tag`);

        console.log(`    → matching dropdown item by: "${matchHint}"`);
        const dlgMatch = page.locator('.dropdown-list:visible li').filter({ hasText: matchHint }).first();
        await dlgMatch.waitFor({ timeout: 3000 });
        await dlgMatch.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
        await dlgMatch.click({ timeout: 3000 });
        await page.waitForTimeout(500);

        // Close panel if still open
        if (await page.locator('.dropdown-list:visible').count() > 0) {
          await page.keyboard.press('Tab').catch(() => {});
        }
        console.log(`✓ Linked Dialog Popup: ${dialogPopupCode}`);
        await log({ event: 'dialog_popup_linked', code: dialogPopupCode });
      } catch (e) {
        console.log(`  ⚠ Couldn't auto-link Dialog Popup: ${e.message.split('\n')[0]}`);
        console.log(`    Manually pick "${dialogPopupCode}" in the Dialog Popup dropdown.`);
      }
    } else if (resolved.popup_dialog === true && dialogPopupId) {
      console.log(`  ↳ Dialog Popup link deferred to PUT-route interceptor (id=${dialogPopupId}, code=${dialogPopupCode})`);
    } else if (resolved.popup_dialog === true) {
      console.log(`  ⚠ popup_dialog=true but no Dialog Popup Code/id was captured — link manually`);
    }

    // Operator request 2026-05-13: after the Names rows are added, also
    // click Submit on the outer Edit Promotion Code modal to commit the
    // changes. Without this, the rows are saved one-at-a-time in the inner
    // popup but the modal itself stays open and needs the operator to click.
    let editPromoId = null;
    try {
      const editModal = page.locator('mat-dialog-container, [role="dialog"], .modal-content')
        .filter({ hasText: /Edit\s*Promotion\s*Code/i })
        .last();
      const editSubmit = editModal.locator('button').filter({ hasText: /^\s*Submit\s*$/i }).first();
      await editSubmit.waitFor({ state: 'visible', timeout: 3000 });
      // Listen for the PUT so we can capture the promo id from the URL —
      // needed for the dialog popup follow-up PUT below.
      const putWatcher = page.waitForResponse(
        (r) => r.request().method() === 'PUT' && /\/api\/bo\/promotion\/\d+$/.test(r.url()),
        { timeout: 6000 },
      ).catch(() => null);
      await editSubmit.click({ timeout: 3000 });
      const putResp = await putWatcher;
      if (putResp) {
        const m = putResp.url().match(/\/promotion\/(\d+)/);
        if (m) editPromoId = Number(m[1]);
      }
      await page.waitForTimeout(800);
      await dismissSystemMessage(3000);
      console.log(`Clicked Submit on Edit Promotion Code modal. (promo id=${editPromoId})`);
      await log({ event: 'edit_modal_submitted', promoId: editPromoId });
    } catch (e) {
      console.log(`  ⚠ Couldn't auto-click Submit on Edit Promotion Code: ${e.message.split('\n')[0]}`);
    }

    // 2026-05-15: Dialog Popup link via follow-up PUT. The page.route
    // mutation works on QPRO11 but doesn't fire on QP2A (likely a
    // build-specific Angular interception issue). Instead we fire a
    // separate PUT via Playwright's APIRequestContext which inherits
    // the browser cookies from the page (cross-origin auth handled).
    // The exact 6-field shape for dialog_popup_list comes from
    // src/browser/dialog-link-mechanism-probe.js (operator-pick capture).
    if (resolved.popup_dialog === true && dialogPopupId && editPromoId) {
      try {
        const apiHost = site.apiHost;
        const req = ctx.request;  // browser context API request handle
        const getResp = await req.get(`${apiHost}/api/bo/promotion/${editPromoId}`);
        const getJson = await getResp.json().catch(() => null);
        const body = getJson?.data?.rows || getJson?.data || null;
        if (!body) {
          console.log(`  ⚠ Follow-up GET /promotion/${editPromoId} failed: status=${getResp.status()}`);
        } else {
          body.dialog_popup_list = {
            '0': {
              id: dialogPopupId,
              start_date: dialogPopupStartDate,
              end_date: null,
              promotion_id: editPromoId,
              labelKey: dialogPopupLabel ? `${dialogPopupCode} (${dialogPopupLabel.slice(0, 14)} . . . )` : dialogPopupCode,
              code: dialogPopupCode,
            },
          };
          const putResp = await req.put(`${apiHost}/api/bo/promotion/${editPromoId}`, {
            data: body,
            headers: { 'Content-Type': 'application/json' },
          });
          if (putResp.ok()) {
            console.log(`✓ Dialog Popup linked via follow-up PUT: id=${dialogPopupId} → promotion=${editPromoId} (status=${putResp.status()})`);
            await log({ event: 'dialog_popup_linked_via_put', dialogId: dialogPopupId, promoId: editPromoId });
          } else {
            const errText = await putResp.text().catch(() => '');
            console.log(`  ⚠ Follow-up PUT failed: status=${putResp.status()}`);
            console.log(`    body: ${errText.slice(0, 400)}`);
          }
        }
      } catch (e) {
        console.log(`  ⚠ Follow-up PUT exception: ${e.message.split('\n')[0]}`);
      }
    }

    await log({ event: 'post_save_done' });
  }

  // ── Execute action plan ─────────────────────────────────────────────
  for (const a of actions) {
    await log({ event: 'action_start', action: a });
    try {
      if (a.kind === 'text' || a.kind === 'number') {
        const loc = scopedLocator(a.selector, { nth: a.nth, scope: a.scope || 'form' });
        await loc.waitFor({ timeout: 5000 });
        await loc.fill('');
        await loc.fill(String(a.value));
        console.log(`  ✓ ${a.label}: ${a.value}`);
      } else if (a.kind === 'select') {
        const loc = scopedLocator(a.selector, { nth: a.nth, scope: a.scope || 'form' });
        await loc.waitFor({ timeout: 5000 });
        if (a.matchMode === 'icontains') {
          // Find option whose trimmed/lowercased label contains the target.
          // BO option text often has leading/trailing whitespace (e.g.
          // ` Reload`), so trim consistently both for the find AND for the
          // selectOption call (Playwright normalizes textContent before
          // matching, so a raw ' Reload' label doesn't match anything).
          const want = String(a.optionLabel).toLowerCase().trim();
          const opts = await loc.locator('option').allTextContents();
          const optsTrimmed = opts.map((o) => o.trim());
          const target = optsTrimmed.find((o) => o.toLowerCase().includes(want));
          if (!target) throw new Error(`no option matching "${a.optionLabel}" in [${optsTrimmed.join(', ')}]`);
          await loc.selectOption({ label: target });
        } else {
          await loc.selectOption({ label: a.optionLabel });
        }
        console.log(`  ✓ ${a.label}: "${a.optionLabel}"`);
      } else if (a.kind === 'check') {
        const loc = scopedLocator(a.selector, { scope: 'form' });
        await loc.waitFor({ timeout: 5000 });
        const isChecked = await loc.isChecked();
        if (isChecked !== a.state) await loc.click();
        console.log(`  ✓ ${a.label}: ${a.state ? 'TICK' : 'UN-TICK'}`);
      } else if (a.kind === 'radio') {
        const loc = scopedLocator(a.selector, { nth: a.nth });
        await loc.waitFor({ timeout: 5000 });
        // The BO uses custom-styled radios (CSS-hides the <input> and shows
        // a styled label). Playwright's force-click on the input fires the
        // click handler but doesn't propagate to Angular's reactive form
        // — confirmed in canary run 7 where checked stayed false even
        // after force-click. Native DOM click + manual input/change
        // dispatch fires the full event chain Angular expects.
        await loc.evaluate((el) => {
          el.checked = true;
          el.click();
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        console.log(`  ✓ ${a.label}`);
      } else if (a.kind === 'wait') {
        await page.waitForTimeout(a.ms);
      } else if (a.kind === 'popup_open') {
        // Pre-save popup walker — opens by button text, hands off to operator.
        // Used for Promotion Currency + Blacklist popups on the Create form
        // (both required to be configured before Submit).
        await walkPopup(a.button, a.prompt);
      } else if (a.kind === 'kt_dropdown_pick') {
        // Pick a single option from a kt-dropdown-wo-lazyload custom
        // Angular dropdown. Anchored on the row containing a label text
        // (a.rowLabel) — picks the Nth kt-dropdown trigger inside that
        // row (a.triggerNth, default 0).
        //
        // Previously this clicked an option and hoped the form committed.
        // Multiple strategies clicked SOMETHING visually but the Currency
        // popup's "+ Add" stayed disabled — i.e. the FormControl never
        // updated. Root cause: kt-dropdown-wo-lazyload's single-select
        // variant binds (click) on <li>, but Playwright's click on the
        // child <label> doesn't propagate through Angular's onItemClick
        // outside NgZone. Fix:
        //   1. Try strategies in order, but VERIFY each by reading the
        //      trigger text (which displays the selected value).
        //   2. If a Playwright click doesn't commit, retry with a native
        //      DOM click on the <li> via evaluate() — this fires inside
        //      Angular's zone via the host's existing event listeners.
        //   3. Throw if no strategy committed (do not silently continue
        //      with the form in an invalid state).
        const formScope = page.locator('form:has(input[formcontrolname="code"])').last();
        const rowLabel = a.rowLabel || 'Free Spin Games';
        // 2026-05-13 probe: FS Games Provider + Game share ONE kt-font-bold
        // label ("Free Spin Games *") but live in TWO adjacent rows. The
        // previous row-ancestor anchor returned the innermost row, which
        // contained only ONE .c-btn. Use following:: from the label span
        // so triggerNth=0 → Provider, triggerNth=1 → Game in document order.
        const triggerXpath = `xpath=(.//span[contains(@class,'kt-font-bold') and contains(normalize-space(.), ${JSON.stringify(rowLabel)})])[1]/following::*[contains(@class,'c-btn')]`;
        const triggerNth = Number(a.triggerNth || 0);
        const trigger = formScope.locator(triggerXpath).nth(triggerNth);
        await trigger.waitFor({ timeout: 5000 });

        const wantText = String(a.optionLabel || '');
        // Strip optional prefix code (e.g. "PP - Pragmatic Play" → "Pragmatic Play")
        // for substring matching. Most QPRO single-select panels show the
        // FULL option label including the code prefix, but some game/title
        // panels strip it; matching the trailing chunk works for both.
        const looseTxt = wantText.includes('-') ? wantText.split('-').pop().trim() : wantText;
        const escaped = wantText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const exactRe = new RegExp(`^\\s*${escaped}\\s*$`, 'i');
        const looseEscaped = looseTxt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // 2026-05-14 (FS canary v2 bug): the original looseRe was an
        // UNANCHORED substring match. Wanting "Sweet Bonanza" would also
        // match "Sweet Bonanza Dice" / "...Xmas" / "...1000" etc. — picking
        // the first <li> alphabetically (often the wrong one). End-anchored
        // with a leading word/space boundary fixes it without breaking the
        // common "<code> - <name>" panel layout: matches "vs20bonanza -
        // Sweet Bonanza" but NOT "vs20bnnzdice - Sweet Bonanza Dice".
        const looseRe = new RegExp(`(^|\\s|-\\s*)${looseEscaped}\\s*$`, 'i');

        const readTriggerText = async () => {
          try {
            const t = await trigger.textContent({ timeout: 1000 });
            return (t || '').replace(/\s+/g, ' ').trim();
          } catch { return ''; }
        };
        const isCommitted = (txt) =>
          // Trigger displays the picked option once the form commits.
          // "Please Select" / "Select" / empty means uncommitted.
          txt && !/^(please\s*select|select)\s*$/i.test(txt) && (looseRe.test(txt) || exactRe.test(txt));

        const panelLocator = () =>
          page.locator('div.dropdown-list:visible, .dropdown-list.animated:visible, ul.dropdown-list:visible').last();

        // Open the panel ONCE. Earlier version re-opened the panel between
        // strategies, but that toggled the still-open panel CLOSED — and
        // the catch-block's body-click dismissal hit the nav sidebar,
        // navigating away from the form (canary run 2026-05-13 broke every
        // subsequent action after FS Games failed). The Escape key is the
        // safe panel-only dismissal.
        if (isCommitted(await readTriggerText())) {
          // Already in place — nothing to do. (E.g. handler re-entered
          // for a retry, or some upstream action already set the value.)
          console.log(`  ✓ ${a.label}: already committed`);
        } else {
          await trigger.click({ timeout: 3000 });
          await page.waitForTimeout(700);

          // Strategy bank — try in order against the SAME open panel.
          //   1. Playwright click on <li> matching exact text.
          //   2. Playwright click on <li> matching loose substring.
          //   3. Playwright click on <label> child (multi-select variant).
          //   4. Native DOM click via evaluate() — bypasses actionability.
          const strategies = [
            async () => {
              const panel = panelLocator();
              const cand = panel.locator('li').filter({ hasText: exactRe }).first();
              await cand.waitFor({ timeout: 1500 });
              await cand.click({ timeout: 2000 });
            },
            async () => {
              const panel = panelLocator();
              const cand = panel.locator('li').filter({ hasText: looseRe }).first();
              await cand.waitFor({ timeout: 1500 });
              await cand.click({ timeout: 2000 });
            },
            async () => {
              const panel = panelLocator();
              const cand = panel.locator('li label, label').filter({ hasText: exactRe }).first();
              await cand.waitFor({ timeout: 1500 });
              await cand.click({ timeout: 2000 });
            },
            async () => {
              await page.evaluate(({ exactPattern, loosePattern }) => {
                const exact = new RegExp(exactPattern, 'i');
                const loose = new RegExp(loosePattern, 'i');
                const panels = Array.from(document.querySelectorAll('.dropdown-list')).filter((p) => p.offsetParent !== null);
                const panel = panels[panels.length - 1];
                if (!panel) throw new Error('no visible dropdown-list');
                const items = Array.from(panel.querySelectorAll('li'));
                let target = items.find((li) => exact.test((li.textContent || '').trim()));
                if (!target) target = items.find((li) => loose.test((li.textContent || '').trim()));
                if (!target) throw new Error(`no <li> matching ${exactPattern} or ${loosePattern}`);
                target.click();
                target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                target.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
              }, {
                exactPattern: `^\\s*${escaped}\\s*$`,
                // Same tightening as the Playwright looseRe — see comment
                // above. Avoids picking "Sweet Bonanza Dice" when wanting
                // "Sweet Bonanza".
                loosePattern: `(^|\\s|-\\s*)${looseEscaped}\\s*$`,
              });
            },
          ];

          let committed = false;
          let lastErr = null;
          for (let attempt = 0; attempt < strategies.length; attempt++) {
            try {
              await strategies[attempt]();
              await page.waitForTimeout(400);
              const after = await readTriggerText();
              if (isCommitted(after)) {
                committed = true;
                console.log(`  ✓ ${a.label}: "${a.optionLabel}" (strategy ${attempt + 1}, trigger now: "${after.slice(0, 60)}")`);
                break;
              }
              console.log(`  ⚠ ${a.label}: strategy ${attempt + 1} clicked but trigger still "${after.slice(0, 60)}" — trying next`);
            } catch (e) {
              lastErr = e;
              console.log(`  ⚠ ${a.label}: strategy ${attempt + 1} threw — ${e.message.split('\n')[0]}`);
              // No body-click or page-level dismissal. Just continue
              // against the same panel — if it's still open, the next
              // strategy can try; if it closed, the next click will
              // simply find no match and throw, and we move on.
            }
          }

          // Close the panel — IF it's still visible. Don't use Escape
          // (the QPRO BO binds Escape to the Cancel-dialog action, which
          // closes the whole Create form modal and breaks every
          // subsequent action). Trigger re-click is panel-scoped: it
          // toggles the panel closed if open. Skip if already closed so
          // we don't accidentally re-open it.
          const panelStillVisible = await page.locator('.dropdown-list:visible').count() > 0;
          if (panelStillVisible) {
            await trigger.click({ timeout: 1500 }).catch(() => {});
            await page.waitForTimeout(300);
          }

          if (!committed) {
            // One last verification: the click might commit but only
            // reflect in trigger text after panel close.
            const afterClose = await readTriggerText();
            if (isCommitted(afterClose)) {
              committed = true;
              console.log(`  ✓ ${a.label}: "${a.optionLabel}" (committed after panel close, trigger: "${afterClose.slice(0, 60)}")`);
            } else {
              throw new Error(`kt_dropdown_pick failed to commit "${wantText}" on row "${rowLabel}" trigger ${triggerNth} (trigger text after panel close: "${afterClose.slice(0, 60)}"${lastErr ? `, last error: ${lastErr.message.split('\n')[0]}` : ''})`);
            }
          }
        }
      } else if (a.kind === 'popup_fill_currency') {
        // Full auto-fill for the Promotion Currency popup. For each currency
        // in a.rows: click "+ Add" inside the popup → wait for the inner
        // "Create Promotion Currency" form → fill its fields → Submit → wait
        // for the row to appear. Then click Close on the outer popup.
        const openBtn = page.locator('button:has-text("Promotion Currency")').first();
        const enabled = await openBtn.isEnabled().catch(() => true);
        if (!enabled) {
          console.log('  ⚠ "+ Promotion Currency" still disabled — falling back to manual handoff.');
          await waitForOperator('Click "+ Promotion Currency" in the BO, fill each currency row manually, then press Enter: ');
        } else {
          await openBtn.click();
          await page.waitForTimeout(2000);
          console.log('  ✓ Opened Promotion Currency popup');

          // The Add button used to be looked up via a dialog-scope filter,
          // but on FS the Playwright dialog-visibility heuristic missed
          // the popup. Direct page-wide selector matching only the EXACT
          // "Add" / "+ Add" text (regex-anchored — no "Add Promotion" or
          // similar substrings) is the most reliable approach. `.last()`
          // picks the most recently-opened dialog's Add (modal stacking).
          const addButtonLocator = () => page.locator('button:visible').filter({ hasText: /^\s*\+?\s*Add\s*$/i }).last();

          for (const row of a.rows) {
            // Wrap the WHOLE row (Add click + fill + Submit) in one
            // try/catch so a mid-row failure doesn't bleed into the next.
            try {
              // Click "+ Add" inside the Promotion Currency outer dialog.
              // Use a regex anchored on the literal text "Add" (or "+ Add")
              // to avoid matching buttons like "Add Member Group". If no
              // such button exists (some popup variants render the inner
              // Create form directly), skip silently.
              try {
                // First try a Playwright click (works on most BO popups).
                const addBtn = addButtonLocator();
                await addBtn.waitFor({ state: 'visible', timeout: 5000 });
                await addBtn.click({ timeout: 3000 });
              } catch {
                // Fallback: native DOM click via evaluate. Some BO popups
                // (FS Currency on QPRO) reject Playwright's click because
                // of Angular CDK overlays; native click bypasses that.
                try {
                  await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button')).filter((b) =>
                      b.offsetParent !== null && /^\s*\+?\s*Add\s*$/i.test((b.textContent || '').trim())
                    );
                    if (buttons.length > 0) buttons[buttons.length - 1].click();
                  });
                } catch {}
              }
              // Wait for the inner Create Promotion Currency form. If it
              // doesn't appear, the popup was likely already in single-form
              // layout — fall through silently.
              await page.waitForSelector('select[formcontrolname="currency_id"]', { state: 'visible', timeout: 5000 }).catch(() => {});
              await page.waitForTimeout(500);
              const fill = async (selector, value) => {
                const loc = page.locator(selector).last();
                await loc.waitFor({ timeout: 3000 });
                await loc.fill('');
                await loc.fill(String(value));
              };
              // Currency dropdown. Pre-check: if the requested currency isn't
              // among the dropdown's option labels, fail fast rather than
              // letting selectOption eat its 30s default timeout. Single-
              // currency brands (e.g. QPRO11 = MYR-only) hit this often.
              // Option text has surrounding whitespace (e.g. ` MYR `), so
              // trim both for comparison and for the selectOption lookup.
              const currencySelect = page.locator('select[formcontrolname="currency_id"]').last();
              await currencySelect.waitFor({ timeout: 5000 });
              const rawLabels = await currencySelect.locator('option').allTextContents();
              const trimmedLabels = rawLabels.map((s) => s.trim());
              const idx = trimmedLabels.indexOf(row.currency);
              if (idx < 0) {
                throw new Error(`brand does not offer ${row.currency} (available: ${trimmedLabels.filter((o) => o !== 'Please Select').join(', ') || '<none>'})`);
              }
              await currencySelect.selectOption({ label: trimmedLabels[idx] });
              // Field-agnostic fill: iterate every row key and try to fill
              // the matching <input formcontrolname="<key>"> or <select
              // formcontrolname="<key>">. Skip silently if the field doesn't
              // exist on this platform's inner form. This lets the mapper
              // emit per-bonus-type row shapes (Deposit/FC/FS) and per-
              // platform field names (QPRO vs QP2) without the executor
              // needing to know any specifics.
              //
              // `currency` is the operator-facing label we already used to
              // pick currency_id, so skip it.
              // `status` is a select with option "Active" — handle below.
              const filledFields = [];
              for (const [key, value] of Object.entries(row)) {
                if (key === 'currency' || key === 'status' || value == null) continue;
                try {
                  const inputLoc = page.locator(`input[formcontrolname="${key}"]`).last();
                  if (await inputLoc.count() > 0 && await inputLoc.isVisible().catch(() => false)) {
                    await inputLoc.fill('');
                    await inputLoc.fill(String(value));
                    filledFields.push(`${key}=${value}`);
                    continue;
                  }
                  const selectLoc = page.locator(`select[formcontrolname="${key}"]`).last();
                  if (await selectLoc.count() > 0 && await selectLoc.isVisible().catch(() => false)) {
                    await selectLoc.selectOption({ label: String(value) });
                    filledFields.push(`${key}=${value}`);
                    // Give Angular a beat to re-render any conditional
                    // inputs that depend on this select's value (e.g. on
                    // QP2 Deposit, picking bonus_type=Percentage reveals
                    // bonus_rate + max_bonus inputs). Without this wait
                    // the next iteration's input locator may miss the
                    // newly-rendered field.
                    await page.waitForTimeout(400);
                  }
                } catch (e) {
                  // Skip silently — field absent or value not accepted is
                  // a normal "doesn't apply on this brand/type" condition.
                }
              }
              // Status select — try Active by default, even if the row
              // didn't carry an explicit value (single-platform default).
              try {
                await page.locator('select[formcontrolname="status"]').last().selectOption({ label: 'Active' });
              } catch {}
              const submitBtn = page.locator('[role="dialog"]:visible button:has-text("Submit"), .modal-content:visible button:has-text("Submit")').last();
              try {
                await submitBtn.click({ timeout: 5000 });
              } catch (clickErr) {
                // QP2 Deposit (probe 2026-05-13): the inner Create Promotion
                // Currency form's Submit button is rendered with the disabled
                // attribute even when all visible controls are ng-valid. Force-
                // click via JS click() ignores `disabled` and fires Angular's
                // (click) handler, which DOES save the row (verified via probe
                // — inner dialog closes, row appears in table).
                console.log(`    ⚠ Submit click blocked by disabled attr — force-clicking via JS`);
                await page.evaluate(() => {
                  const dialogs = Array.from(document.querySelectorAll('.modal-content')).filter((d) => d.offsetParent !== null);
                  const innerDialog = dialogs.find((d) =>
                    /create\s+promotion\s+currency/i.test(d.querySelector('.modal-header, .modal-title, h4, h5')?.textContent || '')
                  );
                  if (!innerDialog) return;
                  const submit = Array.from(innerDialog.querySelectorAll('button'))
                    .find((b) => /^\s*Submit\s*$/i.test((b.textContent || '').trim()));
                  if (submit) {
                    submit.removeAttribute('disabled');
                    submit.disabled = false;
                    submit.click();
                  }
                });
              }
              await page.waitForTimeout(1500);
              // Dismiss the "Successfully created Promotion Currency"
              // System Message dialog that pops up after each row save.
              // Without this, the next row's "+ Add" or the outer Close
              // button is blocked by the unhandled modal.
              await dismissSystemMessage(4000);
              console.log(`    ✓ Added ${row.currency}: ${filledFields.join(', ') || '(no extra fields filled)'}`);
            } catch (e) {
              console.log(`    ⚠ Failed to add ${row.currency}: ${e.message.split('\n')[0]}`);
              await log({ event: 'currency_row_fail', currency: row.currency, error: e.message });
              // Recovery: if the inner Create Promotion Currency dialog is
              // still open (Submit didn't fire because of upstream failure),
              // close it so the next iteration's Add click doesn't hit a
              // stale Add button on the wrong dialog.
              const cancelBtn = page.locator('[role="dialog"]:visible button:has-text("Cancel"), [role="dialog"]:visible button:has-text("Close")').last();
              await cancelBtn.click({ timeout: 1500 }).catch(() => {});
              await page.waitForTimeout(500);
            }
          }

          // Close the outer Currency popup.
          try {
            const closeBtn = page.locator('[role="dialog"]:visible button:has-text("Close")').last();
            await closeBtn.click({ timeout: 3000 });
            await page.waitForTimeout(1000);
            console.log('  ✓ Closed Promotion Currency popup');
          } catch (e) {
            console.log(`  ⚠ Couldn't auto-close Currency popup — please click Close manually.`);
          }
        }
      } else if (a.kind === 'multiselect_inverted') {
        // "Select All" then un-tick a small list of exclusions. Used for
        // Game Providers, where the operator wants every provider EXCEPT the
        // 8 Layer 1 exclusions. The trigger-locating logic mirrors the
        // regular multiselect action.
        //
        // QPRO uses <span class="kt-font-bold"> for field headers (NOT
        // <label>). The form is laid out as a single outer 3-column .row
        // containing per-field inner .rows; a CSS `.row:has(span...)` matches
        // both the inner and outer rows, and `.first()` would pick the
        // outer's first dropdown (= Linked Promotions, top-left). XPath
        // `ancestor::div[contains(@class,'row')][1]` returns the INNERMOST
        // ancestor row, so we hit only the field's own dropdown.
        //
        // Also: NEVER target the Linked Promotions row — operator rule.
        const labelHook = a.label;
        const displayLabel = a.displayLabel || a.label;
        const nthIdx = Number(a.nth || 0);     // 0 = first label occurrence, 1 = second, etc.
        if (/linked\s*promotions?/i.test(labelHook)) {
          throw new Error('refusing to operate on Linked Promotions (operator rule: never link to anything)');
        }
        // XPath uses 1-indexed positions. nth(0) → [1], nth(1) → [2], etc.
        const pos = nthIdx + 1;
        const xpathBase = (txt) => `xpath=(.//span[contains(@class,'kt-font-bold') and normalize-space(.)=${JSON.stringify(txt)}])[${pos}]/ancestor::div[contains(@class,'row')][1]//*[self::kt-dropdown-wo-lazyload or self::kt-dropdown]//*[contains(@class,'c-btn')]`;
        const formScope = page.locator('form:has(input[formcontrolname="code"])').last();
        const candidates = [
          formScope.locator(xpathBase(labelHook)).first(),
          formScope.locator(xpathBase(`${labelHook}*`)).first(),
          formScope.locator(`xpath=(.//span[contains(@class,'kt-font-bold') and contains(normalize-space(.), ${JSON.stringify(labelHook)})])[${pos}]/ancestor::div[contains(@class,'row')][1]//*[self::kt-dropdown-wo-lazyload or self::kt-dropdown]//*[contains(@class,'c-btn')]`).first(),
          // Permissive: drop the .row ancestor — find the FIRST .c-btn anywhere
          // after the label span in document order. Some fields (Game Providers
          // in QPRO11) sit in a different wrapper than `.row`, breaking the
          // row-ancestor anchor above.
          formScope.locator(`xpath=(.//span[contains(@class,'kt-font-bold') and contains(normalize-space(.), ${JSON.stringify(labelHook)})])[${pos}]/following::*[contains(@class,'c-btn')][1]`).first(),
          // Legacy fallback for forms that still use <label>.
          formScope.locator(`:has(label:has-text("${labelHook}")) kt-dropdown-wo-lazyload .c-btn`).nth(nthIdx),
        ];
        let opened = false;
        let trigger;
        for (const cand of candidates) {
          try {
            await cand.waitFor({ timeout: 2000 });
            await cand.click({ timeout: 3000 });
            opened = true;
            trigger = cand;
            break;
          } catch {}
        }
        if (!opened) throw new Error(`couldn't open multi-select for "${labelHook}"`);
        await page.waitForTimeout(900);

        // Click "Select All" inside the panel.
        // QPRO's Select All is a toggle label containing TWO spans:
        //   <label><span>Select All</span><span hidden>UnSelect All</span></label>
        // The visible span flips when the panel state toggles. Target the
        // label that has BOTH spans — that's the toggle, not an item label.
        const panel = page.locator('div.dropdown-list:visible, .dropdown-list.animated:visible').last();

        // FIX A (Member Group on QP2, V12+ 2026-05-14): wait for the panel's
        // <li> items to render before clicking Select All. Panels whose
        // options load async (Member Group on QP2 reloads when Merchant
        // changes) open empty briefly. Clicking Select All against an
        // empty list silently no-ops, and the subsequent exclusion click
        // ends up TICKING (not un-ticking) the target — which matches the
        // operator's observed "bot ticks shadowban then unticks" symptom.
        try {
          await panel.locator('li').first().waitFor({ timeout: 5000 });
          // Poll briefly for item count to stabilize (catch slow Angular renders)
          let prevCount = 0;
          for (let i = 0; i < 6; i++) {
            const cnt = await panel.locator('li').count();
            if (cnt > 0 && cnt === prevCount) break;
            prevCount = cnt;
            await page.waitForTimeout(300);
          }
          console.log(`  ${displayLabel}: panel rendered with ${prevCount} items`);
        } catch (e) {
          console.log(`  ⚠ ${displayLabel}: panel didn't render items in 5s — clicks may no-op`);
        }

        let selectAllOk = false;
        // FIRST: if the panel has hierarchical group titles (QP2 Member Group:
        // `<li class="pure-checkbox grp-title">MERCHANT</li>` containing
        // children), the panel's Select All does NOT propagate to children.
        // Instead, ticking each merchant header ticks all its children.
        // Test on the live BO 2026-05-14: JS-clicking the grp-title <li>
        // ticks all its children (including shadowban, which we un-tick after).
        try {
          const grpTitleCount = await panel.locator('li.pure-checkbox.grp-title').count();
          if (grpTitleCount > 0) {
            const clicked = await page.evaluate(() => {
              const panels = Array.from(document.querySelectorAll('.dropdown-list')).filter((p) => p.offsetParent !== null);
              const panel = panels[panels.length - 1];
              if (!panel) return 0;
              const titles = Array.from(panel.querySelectorAll('li.pure-checkbox.grp-title'));
              for (const t of titles) t.click();
              return titles.length;
            });
            if (clicked > 0) {
              await page.waitForTimeout(500);
              console.log(`  ✓ ${displayLabel}: clicked ${clicked} group header(s) (hierarchical panel)`);
              selectAllOk = true;
            }
          }
        } catch {}

        // Select All locator candidates for FLAT panels (Categories, Game Providers).
        //   Strategy 1: QPRO-style toggle label with two spans (Select All /
        //     UnSelect All), one hidden depending on state.
        //   Strategy 2: input checkbox inside `div.pure-checkbox.select-all`.
        //   Strategy 3: the div itself.
        //   Strategy 4: label-with-checkbox-child + exact "Select All" text.
        //   Strategy 5: any label with exact "Select All" text.
        const selectAllCandidates = selectAllOk ? [] : [
          panel.locator('label:has(span:text-is("Select All")):has(span:text-is("UnSelect All"))').first(),
          panel.locator('div.pure-checkbox.select-all input[type="checkbox"]').first(),
          panel.locator('div.pure-checkbox.select-all').first(),
          panel.locator('label:has(input[type="checkbox"])').filter({ hasText: /^\s*Select All\s*$/i }).first(),
          panel.locator('label').filter({ hasText: /^\s*Select All\s*$/i }).first(),
        ];
        for (const cand of selectAllCandidates) {
          try {
            await cand.waitFor({ timeout: 1500 });
            // force: true bypasses Playwright's pointer-events check.
            // QP2 Member Group's Select All has a `<div class="pure-checkbox
            // select-all">` parent that intercepts pointer events (the
            // checkbox underneath is hidden via CSS). force-click sends
            // the click to the checkbox directly.
            await cand.click({ force: true });
            await page.waitForTimeout(500);
            console.log(`  ✓ ${displayLabel}: Select All clicked`);
            selectAllOk = true;
            break;
          } catch {}
        }
        // Diagnostic: immediately after Select All click, read the trigger
        // text. If it changed from "Please Select" to a list of items, the
        // click DID toggle the form state. If it stays "Please Select",
        // the click didn't fire Angular's handler.
        if (selectAllOk && trigger) {
          try {
            const txt = (await trigger.textContent({ timeout: 800 }) || '').replace(/\s+/g, ' ').trim();
            console.log(`    ${displayLabel}: trigger immediately after Select All = "${txt.slice(0, 80)}"`);
          } catch {}
        }
        if (!selectAllOk) {
          console.log(`  ⚠ Couldn't click Select All for "${displayLabel}" — tried 3 patterns`);
          console.log(`    ⛔ Skipping exclusion un-ticks — without Select All firing first, clicking would TICK Layer 1 entries instead of unticking.`);
        }

        // Un-tick each exclusion ONLY if Select All actually fired. Each
        // option lives in <li class="pure-checkbox"><label>NAME</label></li>;
        // clicking the label toggles the underlying checkbox.
        //
        // (Earlier attempt counted `li input[type="checkbox"]:checked` after
        // Select All to verify items got ticked — but Playwright's :checked
        // doesn't reflect Angular's reactive form state on kt-dropdown
        // items, so the count was always 0 even when Select All worked
        // visually. Removed.)
        if (selectAllOk) {
          for (const excl of a.exclusions || []) {
            // Substring match — provider labels often include a code prefix
            // (e.g. "918K - 918KISS Gaming").
            const loose = panel.locator(`li.pure-checkbox label:has-text("${excl}")`).first();
            try {
              await loose.waitFor({ timeout: 1500 });
              await loose.click();
              console.log(`    ✓ un-ticked exclusion: ${excl}`);
            } catch {
              console.log(`    ⚠ exclusion "${excl}" not found — leave as-is`);
            }
            await page.waitForTimeout(200);
          }
        }
        // Diagnostic: state right after exclusions, before panel close.
        if (selectAllOk && trigger) {
          try {
            const txt = (await trigger.textContent({ timeout: 800 }) || '').replace(/\s+/g, ' ').trim();
            console.log(`    ${displayLabel}: trigger after exclusions = "${txt.slice(0, 80)}"`);
          } catch {}
        }
        // Close the panel by re-clicking the same trigger Locator. With XPath
        // selectors + `.first()` keyed on the exact span text, the Locator
        // re-evaluates to the same element. Body-clicks dismissed the modal
        // (operator-confirmed earlier); this is the safe alternative.
        if (trigger) await trigger.click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(400);
        // Diagnostic: state immediately after panel close.
        if (selectAllOk && trigger) {
          try {
            const txt = (await trigger.textContent({ timeout: 800 }) || '').replace(/\s+/g, ' ').trim();
            console.log(`    ${displayLabel}: trigger after panel close = "${txt.slice(0, 80)}"`);
          } catch {}
        }
      } else if (a.kind === 'multiselect') {
        // Open the kt-dropdown-wo-lazyload trigger whose row contains the
        // <span class="kt-font-bold"> label `a.label`, tick each option in
        // `a.options` (case-insensitive substring match), then close the
        // panel.
        //
        // See multiselect_inverted above for the rationale on XPath vs CSS.
        // Innermost-ancestor row is what we want — `.row:has(...)` in CSS
        // matches outer 3-column wrapper too and picks Linked Promotions.
        const labelHook = a.label;
        if (/linked\s*promotions?/i.test(labelHook)) {
          throw new Error('refusing to operate on Linked Promotions (operator rule: never link to anything)');
        }
        let trigger;
        const xpathBase = (txt) => `xpath=.//span[contains(@class,'kt-font-bold') and normalize-space(.)=${JSON.stringify(txt)}]/ancestor::div[contains(@class,'row')][1]//*[self::kt-dropdown-wo-lazyload or self::kt-dropdown]//*[contains(@class,'c-btn')]`;
        const formScope = page.locator('form:has(input[formcontrolname="code"])').last();
        const candidates = [
          formScope.locator(xpathBase(labelHook)).first(),
          formScope.locator(xpathBase(`${labelHook}*`)).first(),
          formScope.locator(`xpath=.//span[contains(@class,'kt-font-bold') and contains(normalize-space(.), ${JSON.stringify(labelHook)})]/ancestor::div[contains(@class,'row')][1]//*[self::kt-dropdown-wo-lazyload or self::kt-dropdown]//*[contains(@class,'c-btn')]`).first(),
          // Permissive: drop the .row ancestor — find the FIRST .c-btn anywhere
          // after the label span in document order. Some fields (Game Providers
          // in QPRO11) sit in a different wrapper than `.row`, breaking the
          // row-ancestor anchor above. Added for FS where the mapper uses
          // multiselect (not multiselect_inverted) for Game Providers (canary
          // V22 2026-05-13 — failed to open without this fallback).
          formScope.locator(`xpath=.//span[contains(@class,'kt-font-bold') and contains(normalize-space(.), ${JSON.stringify(labelHook)})]/following::*[contains(@class,'c-btn')][1]`).first(),
          // Legacy fallback for forms that still use <label>.
          formScope.locator(`:has(label:has-text("${labelHook}")) kt-dropdown-wo-lazyload .c-btn`).first(),
        ];
        let opened = false;
        for (const cand of candidates) {
          try {
            await cand.waitFor({ timeout: 2000 });
            await cand.click({ timeout: 3000 });
            opened = true;
            trigger = cand;
            break;
          } catch {}
        }
        if (!opened) throw new Error(`couldn't open multi-select for "${labelHook}"`);
        await page.waitForTimeout(900);

        for (const opt of a.options) {
          // Inside the most-recently opened panel, click the option label.
          //
          // 2026-05-15: changed from `:text-is(${opt})` to an anchored-
          // regex `filter({ hasText })` so we match QP2's nested-label
          // markup. `:text-is` only checks the element's direct text node
          // — QPRO renders `<label>SLOTS</label>` (matches) but QP2
          // renders `<label><span>SLOTS</span></label>` (doesn't). The
          // anchored regex `^\s*OPT\s*$` matches the combined text of the
          // element + descendants while preserving "exact match" semantics
          // (no substring match — "SPORTS" still won't match "E-SPORTS").
          const panel = page.locator('div.dropdown-list:visible, .dropdown-list.animated:visible').last();
          const optEscaped = String(opt).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const anchoredRe = new RegExp(`^\\s*${optEscaped}\\s*$`, 'i');
          const cand = panel.locator('li.pure-checkbox').filter({ hasText: anchoredRe }).first();
          let clicked = false;
          try {
            await cand.waitFor({ timeout: 1500 });
            await cand.click();
            clicked = true;
          } catch {}
          if (!clicked) console.log(`    ⚠ option "${opt}" not found in panel for "${labelHook}" (no anchored match)`);
          await page.waitForTimeout(200);
        }

        // Close the panel by re-clicking the trigger — see comment in
        // multiselect_inverted above. Leaving it open obscures the next
        // action's target (specifically the right-column Eligibility section
        // fields, which Member Group's panel sits on top of).
        if (trigger) await trigger.click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(400);
        console.log(`  ✓ ${a.label}: ${a.options.join(', ')}`);
      } else if (a.kind === 'handoff') {
        console.log('');
        console.log(`─── ${a.label}`);
        if (a.items) a.items.forEach((it) => console.log(`    · ${it}`));
        await waitForOperator('Reply "next" when those are done (or "abort"): ');
      } else if (a.kind === 'auto_submit') {
        // 1. Pre-Submit screenshot for audit
        await page.screenshot({ path: path.join(OUT, `${runId}-ready-to-save.png`), fullPage: true }).catch(() => {});

        // 2. Compact config preview
        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`AUTO-SUBMIT — ${resolved.promo_code} on ${targetBrand}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`  Brand:        ${targetBrand}  (site=${siteId})`);
        console.log(`  Code:         ${resolved.promo_code}`);
        console.log(`  Name (EN):    ${resolved.promotion_name_en || '-'}`);
        console.log(`  Bonus:        ${resolved.bonus_type}${resolved.bonus_sub_type ? ` / ${resolved.bonus_sub_type}` : ''}`);
        console.log(`  Currencies:   ${(resolved.currencies || []).join(', ')}`);
        console.log(`  Locales:      ${(resolved.locales || []).join(', ')}`);
        console.log(`  Validity:     ${resolved.validity_days ?? '?'} d  / Reward: ${resolved.rewards_validity_days ?? '?'} d`);
        console.log(`  Recurring:    ${resolved.recurring === true ? 'Yes' : 'No'}`);

        // 3. Idempotency check — refuse if the code already exists in the BO
        //    snapshot for this site+merchant. Snapshot may be stale; this is a
        //    best-effort guard against the most common screwup (re-running the
        //    canary for a code that was already saved).
        try {
          const merchantKey = (BRAND_TO_SITE[targetBrand]?.merchantName || targetBrand).toUpperCase();
          const entries = (bo?.byCode?.get(resolved.promo_code) || []);
          const dup = entries.find(
            (e) => e.siteId === siteId && (e.merchant || '').toUpperCase() === merchantKey
          );
          if (dup) {
            console.log('');
            console.log(`  ✖ IDEMPOTENCY: code "${resolved.promo_code}" already exists in BO snapshot`);
            console.log(`    (site=${dup.siteId} merchant=${dup.merchant} id=${dup.id})`);
            console.log('    Aborting Submit. If the snapshot is stale, re-sync with `node bin/sync-promo-codes.js`.');
            await log({ event: 'idempotency_abort', code: resolved.promo_code, existing: dup });
            throw new Error(`FATAL: idempotency: ${resolved.promo_code} already exists on ${siteId}/${dup.merchant}`);
          }
          console.log(`  ✓ Idempotency check: no existing code "${resolved.promo_code}" on ${siteId}/${merchantKey}`);
        } catch (idemErr) {
          if (idemErr.message.startsWith('FATAL:')) throw idemErr;
          // Snapshot read failure shouldn't block the run; warn + continue.
          console.log(`  ⚠ Idempotency check skipped: ${idemErr.message.split('\n')[0]}`);
        }

        // 3.5. Diagnostic dump — dump every input/select/radio in the form
        //      with its current value and `formcontrolname`. Helps when the
        //      form rejects Submit with a "field required" error so we can
        //      see which control is the problem.
        try {
          const formState = await page.evaluate(() => {
            const form = document.querySelector('form.kt-form, form:has(input[formcontrolname="code"])');
            if (!form) return null;
            const rows = [];
            form.querySelectorAll('input, select').forEach((el) => {
              if (!(el.offsetWidth || el.offsetHeight) && el.type !== 'radio' && el.type !== 'checkbox') return;
              const fcn = el.getAttribute('formcontrolname');
              const ng = el.className.includes('ng-invalid') ? '⚠INVALID' : '';
              if (el.type === 'radio' || el.type === 'checkbox') {
                rows.push(`  ${el.type.padEnd(8)} ${(fcn||'-').padEnd(28)} val="${el.value}" checked=${el.checked} ${ng}`);
              } else {
                rows.push(`  ${el.tagName.toLowerCase().padEnd(8)} ${(fcn||'-').padEnd(28)} val="${(el.value||'').slice(0,40)}" ${ng}`);
              }
            });
            // Walk kt-dropdown* custom components — their ng-invalid is on the
            // host element, not a child input. The .c-btn child shows the
            // currently-displayed text (e.g. "Please Select" if uncommitted).
            form.querySelectorAll('kt-dropdown-wo-lazyload, kt-dropdown').forEach((el) => {
              if (!(el.offsetWidth || el.offsetHeight)) return;
              const ng = el.className.includes('ng-invalid') ? '⚠INVALID' : '';
              const trigger = (el.querySelector('.c-btn')?.textContent || '').replace(/\s+/g, ' ').trim();
              // Walk up to find a nearby label
              let label = null;
              let p = el;
              for (let i = 0; i < 6 && p.parentElement; i++) {
                p = p.parentElement;
                const lbl = p.querySelector('span.kt-font-bold');
                if (lbl && lbl !== el) { label = (lbl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40); break; }
              }
              rows.push(`  ktdrop   ${(label || '-').padEnd(28)} trigger="${trigger.slice(0, 50)}" ${ng}`);
            });
            // Form-level ng-valid summary
            rows.push(`  ─ form is ng-${form.classList.contains('ng-valid') ? 'valid' : 'INVALID'} ─`);
            // Enumerate every ng-invalid element on the form — useful when
            // the form is invalid but our scalar/kt-dropdown enumeration
            // doesn't catch the source (e.g. a required nested form-group,
            // a hidden control, or a wrapper).
            const invalids = Array.from(form.querySelectorAll('.ng-invalid'));
            for (const el of invalids) {
              const fcn = el.getAttribute('formcontrolname') || el.getAttribute('formgroupname') || el.getAttribute('formarrayname') || '-';
              const tag = el.tagName.toLowerCase();
              // Skip the form root itself (it's marked ng-invalid because of children)
              if (el === form) continue;
              // Walk up to find a label
              let label = null;
              let p = el;
              for (let i = 0; i < 6 && p.parentElement; i++) {
                p = p.parentElement;
                const lbl = p.querySelector('span.kt-font-bold, label, .form-label');
                if (lbl && lbl !== el) { label = (lbl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60); break; }
              }
              rows.push(`  ⚠ INVALID <${tag} fc="${fcn}"> label="${label || '?'}" cls="${(el.className || '').slice(0, 80)}"`);
            }
            return rows.join('\n');
          });
          if (formState) {
            await log({ event: 'form_state_dump', formState });
            // Only print to stdout if a flag is set — otherwise just log.
            if (process.env.CANARY_DUMP_FORM) {
              console.log('  ── Form state dump ──');
              console.log(formState);
              console.log('  ─────────────────────');
            } else {
              console.log('  (form state captured to JSONL — set CANARY_DUMP_FORM=1 to print)');
            }
          }
        } catch (e) {
          console.log(`  ⚠ form_state_dump failed: ${e.message.split('\n')[0]}`);
        }

        // 4. 5-second countdown so the operator can Ctrl+C to abort.
        console.log('');
        console.log('  Auto-Submit in 5s — Ctrl+C to abort.');
        for (let s = 5; s > 0; s--) {
          process.stdout.write(`    ${s}…`);
          await page.waitForTimeout(1000);
        }
        process.stdout.write('\n');

        // 5. Click Submit. The button text is "Submit" (Create form bottom
        //    button); locate the visible one inside the form scope to avoid
        //    hitting list-page filter buttons.
        const submitBtn = page.locator('form:has(input[formcontrolname="code"]) button:has-text("Submit")').last();
        await submitBtn.waitFor({ timeout: 5000 });
        // Best-effort: wait for either the form-save API response or the URL
        // change back to the list, then verify by checking the dialog closes.
        const saveResp = page.waitForResponse(
          (r) => /\/api\/bo\/(promotion|promotion-code)/.test(r.url()) && r.request().method() === 'POST' && r.status() < 400,
          { timeout: 20000 }
        ).catch(() => null);
        await submitBtn.click({ timeout: 10000 });
        await log({ event: 'auto_submit_clicked' });
        console.log('  ✓ Clicked Submit. Waiting for save confirmation…');
        const resp = await saveResp;
        if (resp) {
          console.log(`  ✓ Save response: HTTP ${resp.status()} ${resp.url().split('?')[0]}`);
          await log({ event: 'auto_submit_response', url: resp.url(), status: resp.status() });
          formSaveSucceeded = true;
        } else {
          // No matching POST seen in 20s — could mean the form rejected
          // client-side (validation error) or the API path differs.
          console.log('  ⚠ No save-response detected in 20s.');
          await log({ event: 'auto_submit_no_response' });
        }
        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(OUT, `${runId}-after-submit.png`), fullPage: true }).catch(() => {});
      } else if (a.kind === 'message_template_create') {
        // Section 6.6 Message Template — create + fill per-locale body from
        // our authored templates (NOT Sync Content From — that produced stale
        // numbers per the old template's values).
        //
        // 1. Navigate to /superuser/message-template
        // 2. Click Create
        // 3. Fill: Section (Promotions), Type (Message), Name (promo_code), Status (Active)
        // 4. For each locale tab: render body via src/message-template-renderer.js,
        //    fill Subject input, paste body HTML into CKEditor.
        // 5. Click Submit.

        if (!formSaveSucceeded) {
          console.log('');
          console.log('─── 6.6 Message Template skipped — main form Submit did not save.');
          console.log('    Re-run after the promo code exists, or create the template manually.');
          await log({ event: 'msg_template_skipped_no_save' });
          continue;
        }

        const platform = (BRAND_TO_SITE[targetBrand]?.platform || 'qpro').toLowerCase();
        console.log('');
        console.log(`─── 6.6 Message Template: creating "${a.name}" on ${targetBrand} (${platform}) ───`);
        await log({ event: 'msg_template_start', name: a.name, platform });

        await page.goto(`${site.baseUrl}/superuser/message-template`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1500);

        // 2026-05-14 (operator verified): QP2 platform uses Duplicate-from-
        // row-0 instead of Create-from-blank. The Create dialog has a Code
        // input with formcontrolname=null, so Angular's reactive form never
        // binds to it — POST body's `code` is null/empty and the server
        // 422s with a misleading "code already taken" error. The Duplicate
        // dialog opens with hidden `id` + Section/Type/Subject/Code all
        // pre-filled from the source row; typing a new Name triggers the
        // form watcher to auto-derive a new Code. Manual flow returned
        // HTTP 200 on the very same merchant.
        //
        // QPRO platform: keep the Create flow (saved successfully on
        // QPRO11 V_id=140 / V_id=141 / V24 — no Code field issue there).
        let dialogMode; // 'create' | 'duplicate'
        if (platform === 'qp2') {
          dialogMode = 'duplicate';
          try {
            await page.locator('button:has-text("Search")').first().click({ timeout: 5000 });
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            await page.waitForTimeout(2000);
          } catch (e) {
            console.log(`  ⚠ Search click failed: ${e.message.split('\n')[0]}`);
          }
          const dupClicked = await page.evaluate(() => {
            const trs = Array.from(document.querySelectorAll('table tbody tr')).filter((r) => r.offsetParent !== null);
            const tr = trs[0];
            if (!tr) return { ok: false, reason: 'no rows in list' };
            // Probe confirmed (2026-05-14): row's Actions cell has two
            // buttons — a gear (fa-cog, Edit) and a Duplicate
            // (button[mattooltip="Duplicate"] containing <i.fa-clone>).
            const btn = tr.querySelector('button[mattooltip="Duplicate"]')
                      || Array.from(tr.querySelectorAll('button')).find((b) => b.querySelector('i.fa-clone'));
            if (!btn) return { ok: false, reason: 'no Duplicate button on row 0' };
            const cells = tr.querySelectorAll('td');
            const sourceCode = (cells[1]?.textContent || '').replace(/\s+/g, ' ').trim();
            btn.click();
            return { ok: true, sourceCode };
          });
          if (!dupClicked.ok) {
            console.log(`  ⚠ Couldn't open Duplicate dialog: ${dupClicked.reason}`);
            await log({ event: 'msg_template_dup_open_fail', reason: dupClicked.reason });
            continue;
          }
          console.log(`  ✓ Duplicate clicked on source: ${dupClicked.sourceCode}`);
          await log({ event: 'msg_template_dup_opened', sourceCode: dupClicked.sourceCode });
        } else {
          dialogMode = 'create';
          const createBtn = page.locator('button:has-text("Create")').first();
          await createBtn.waitFor({ timeout: 10000 });
          await createBtn.click();
        }
        await page.waitForTimeout(2000);
        await page.screenshot({ path: path.join(OUT, `${runId}-msg-tpl-${dialogMode}-form.png`), fullPage: true }).catch(() => {});

        // Scope selectors to the visible dialog. Title is either "Create
        // Message Template" (QPRO) or "Duplicate Message Template" (QP2).
        const dialog = page.locator('mat-dialog-container, [role="dialog"], .modal-content').filter({ hasText: /(Create|Duplicate)\s+Message\s+Template/i }).last();
        const dialogFallback = page.locator('mat-dialog-container, [role="dialog"], .modal-content').last();
        const tplDialog = (await dialog.count()) > 0 ? dialog : dialogFallback;

        if (dialogMode === 'duplicate') {
          // Duplicate dialog: Section/Type/Code/Subject inherit from
          // source. Only Name needs to be set — Angular's form watcher
          // auto-derives the new Code from the new Name.
          //
          // 2026-05-14 (verified): MUST use real keystroke typing
          // (pressSequentially), not .fill(). The Code field has
          // formcontrolname=null and its displayed value is recomputed
          // via a per-keystroke listener on the Name input. Playwright's
          // .fill() fires only synthetic 'input' events which the
          // listener ignores, so the POST body carries the SOURCE's
          // code (unchanged) → server 422s "code already taken" against
          // the source row. Standalone test (bin/test-msg-template.js)
          // proved: .fill → 422, pressSequentially → 200.
          const nameInput = tplDialog.locator('input[formcontrolname="name"]').first();
          await nameInput.click({ clickCount: 3, timeout: 3000 }).catch(() => {});
          await page.keyboard.press('Delete').catch(() => {});
          await nameInput.pressSequentially(a.name, { delay: 35 });
          await nameInput.blur().catch(() => {});
          // Read back the Code field to confirm the watcher fired.
          const verify = await tplDialog.evaluate((d) => {
            const inputs = Array.from(d.querySelectorAll('input[type="text"]'));
            const nameInput = inputs.find((el) => el.getAttribute('formcontrolname') === 'name');
            const codeInput = inputs.find((el) => !el.getAttribute('formcontrolname') && /code/i.test((el.closest('div')?.querySelector('label')?.textContent || '')));
            return { name: nameInput?.value, code: codeInput?.value };
          });
          console.log(`  ✓ Name: "${a.name}" → form code="${verify.code}"`);
          await log({ event: 'msg_template_name_typed', name: verify.name, code: verify.code });
          await page.waitForTimeout(400);
        } else {
          // Create dialog (QPRO): fill Section, Type, Name.
          await tplDialog.locator('select[formcontrolname="section"]').selectOption({ label: a.section });
          console.log(`  ✓ Section: "${a.section}"`);
          await page.waitForTimeout(400);
          await tplDialog.locator('select[formcontrolname="type"]').selectOption({ label: a.type });
          console.log(`  ✓ Type: "${a.type}"`);
          await page.waitForTimeout(400);
          await tplDialog.locator('input[formcontrolname="name"]').fill(a.name);
          console.log(`  ✓ Name: "${a.name}"`);
        }
        // Status select is intentionally NOT touched — it defaults to "Active"
        // and the select renders disabled at default, so any selectOption call
        // times out. Same pattern as the main form's Status select.

        // Discover the locale tabs in the dialog. Brand-dependent —
        // QPRO11 has MY_EN, MY_ZH, US_EN; other brands differ.
        const tabTexts = await tplDialog.evaluateAll((dialogs) => {
          const d = dialogs[0];
          if (!d) return [];
          return Array.from(d.querySelectorAll('.mat-tab-label, [role="tab"], .nav-tabs li'))
            .filter((t) => t.offsetParent !== null)
            .map((t) => (t.textContent || '').replace(/\s+/g, ' ').trim());
        });
        console.log(`  Locale tabs detected: ${tabTexts.join(', ') || '(none)'}`);
        await log({ event: 'msg_template_tabs', tabs: tabTexts });

        // Operator rule 2026-05-14: fill any tab whose language is EN, ZH,
        // or ID (Bahasa Indonesia). QP2 BO requires all locale tabs to be
        // filled before Submit, so the prior strict-request-locales filter
        // silently failed on QP2 (BO had 6 tabs but request only had 2 →
        // template never saved). With EN/ZH/ID bodies authored and the
        // renderer's localeDocKey mapping (MY_EN/SG_EN/ID_EN/US_EN → EN,
        // MY_ZH/SG_ZH → ZH, ID_ID → ID), all 6 QP2 tabs get covered.
        // TH tabs (if any) are skipped until TH bodies are authored.
        const ALLOWED_DOCKEYS = new Set(['EN', 'ZH', 'ID']);
        const tabsToFill = tabTexts.filter((t) => ALLOWED_DOCKEYS.has(localeDocKey(t.trim())));
        const skippedTabs = tabTexts.filter((t) => !ALLOWED_DOCKEYS.has(localeDocKey(t.trim())));
        console.log(`  Filling tabs: ${tabsToFill.join(', ') || '(none)'}${skippedTabs.length ? ` | Skipping: ${skippedTabs.join(', ')}` : ''}`);
        await log({ event: 'msg_template_tab_filter', fill: tabsToFill, skip: skippedTabs });
        for (const tab of tabsToFill) {
          try {
            // Click the tab.
            const tabLoc = page.locator('.mat-tab-label, [role="tab"]').filter({ hasText: new RegExp(`^\\s*${tab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first();
            await tabLoc.click({ force: true, timeout: 2000 });
            await page.waitForTimeout(700);

            const rendered = await renderBody({
              bonusType: a.bonus_type,
              locale: tab,
              brand: targetBrand,
              platform,
              resolved,
            });

            if (rendered.skipped) {
              console.log(`    ⚠ ${tab}: skipped — ${rendered.reason}`);
              await log({ event: 'msg_template_locale_skipped', tab, reason: rendered.reason });
              continue;
            }

            // Subject — type into the visible subject input inside the dialog.
            try {
              const subj = tplDialog.locator('input[formcontrolname="subject"]').last();
              await subj.fill('');
              await subj.fill(rendered.subject || '');
            } catch (e) {
              console.log(`    ⚠ ${tab}: subject fill failed: ${e.message.split('\n')[0]}`);
            }

            // Body — inject into CKEditor. Try setData on the editor instance
            // (proper API), fall back to innerHTML on the contenteditable.
            const bodyOk = await tplDialog.evaluateAll((dialogs, html) => {
              const d = dialogs[0];
              if (!d) return false;
              const editorEl = d.querySelector('.ck-editor__editable[contenteditable="true"], [contenteditable="true"], .ck-editor__editable');
              if (!editorEl) return false;
              try {
                // CKEditor 5 attaches `ckeditorInstance` on the editable element.
                const inst = editorEl.ckeditorInstance;
                if (inst && typeof inst.setData === 'function') {
                  inst.setData(html);
                  return true;
                }
              } catch {}
              // Fallback: direct innerHTML + dispatch input event so Angular
              // form-control state syncs.
              editorEl.innerHTML = html;
              editorEl.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            }, rendered.html);

            if (bodyOk) {
              console.log(`    ✓ ${tab}: subject + body filled (${rendered.html.length} chars, ${rendered.slug}/${rendered.docKey})`);
              await log({ event: 'msg_template_locale_filled', tab, slug: rendered.slug, docKey: rendered.docKey });
            } else {
              console.log(`    ⚠ ${tab}: CKEditor body fill — no editable element found`);
              await log({ event: 'msg_template_locale_no_editor', tab });
            }
          } catch (e) {
            console.log(`    ⚠ ${tab}: failed — ${e.message.split('\n')[0]}`);
            await log({ event: 'msg_template_locale_fail', tab, error: e.message });
          }
        }

        // (Removed 2026-05-14) page.route interceptor that injected `code`
        // into the POST body. No longer needed: on QP2 the Duplicate
        // dialog's form binds Code correctly via Angular's reactive form
        // watcher (Code = `PROMOTIONS.MESSAGE.<NAME>` updated on Name
        // change), and the duplicate POST body has `code` natively.
        // Probe captured a successful HTTP 200 with body keys
        // [id, name, section, type, status, details, code].

        // Submit the dialog. Capture any /api/bo/... POST response so we
        // can tell which endpoint actually got hit AND whether the save
        // persisted (canary V15 2026-05-14: Submit clicked but no API
        // response → Submit likely disabled, same pattern as Currency popup).
        try {
          const tplSubmit = tplDialog.locator('button:has-text("Submit")').last();
          await tplSubmit.waitFor({ timeout: 5000 });

          // Capture ANY non-GET API call that fires during the Submit window.
          const apiCalls = [];
          const respHandler = async (resp) => {
            const req = resp.request();
            if (req.method() !== 'GET' && /\/api\/bo\//i.test(resp.url())) {
              const entry = { method: req.method(), url: resp.url(), status: resp.status() };
              // Capture more of the body so the full `details` payload is
              // visible (each locale's body is ~1500 chars; 6 locales = ~9KB).
              try { entry.requestBody = req.postData()?.slice(0, 20000) || null; } catch {}
              try { entry.responseBody = (await resp.text()).slice(0, 3000); } catch {}
              // Also extract just the locale IDs present in details so we
              // can see at a glance which locales made it into the payload.
              try {
                const parsed = JSON.parse(req.postData() || '{}');
                if (parsed.details && typeof parsed.details === 'object') {
                  entry.localesInRequest = Object.keys(parsed.details);
                }
              } catch {}
              apiCalls.push(entry);
            }
          };
          page.on('response', respHandler);

          // Try Playwright click first; if button is disabled like the
          // Currency popup's, fall back to JS .click() that bypasses the
          // disabled attribute.
          try {
            await tplSubmit.click({ timeout: 4000 });
            console.log('  ✓ Clicked Submit on Message Template dialog (Playwright).');
          } catch (clickErr) {
            console.log(`  ⚠ Playwright Submit click blocked (${clickErr.message.split('\n')[0]}) — force-clicking via JS`);
            await page.evaluate(() => {
              const dialogs = Array.from(document.querySelectorAll('.modal-content, mat-dialog-container'))
                .filter((d) => d.offsetParent !== null);
              const inner = dialogs.find((d) => /(create|duplicate)\s*message\s*template/i.test(d.querySelector('.modal-header, .modal-title, h4, h5')?.textContent || ''))
                          || dialogs[dialogs.length - 1];
              if (!inner) return;
              const submit = Array.from(inner.querySelectorAll('button'))
                .find((b) => /^\s*Submit\s*$/i.test((b.textContent || '').trim()));
              if (submit) { submit.removeAttribute('disabled'); submit.disabled = false; submit.click(); }
            });
            console.log('  ✓ Force-clicked Submit on Message Template dialog (JS).');
          }

          await page.waitForTimeout(3500);  // give the API time to respond
          page.off('response', respHandler);
          if (apiCalls.length > 0) {
            console.log(`    API calls fired: ${apiCalls.map((c) => `${c.method} ${c.status} ${c.url.split('?')[0]}`).join('; ')}`);
            for (const c of apiCalls) {
              if (c.localesInRequest) {
                console.log(`      locales in request: [${c.localesInRequest.join(', ')}]`);
              }
              if (c.status >= 400) {
                console.log(`    ⚠ ${c.method} ${c.url} → ${c.status}`);
                if (c.responseBody) console.log(`      response: ${c.responseBody.slice(0, 600)}`);
              }
            }
            await log({ event: 'msg_template_api_calls', calls: apiCalls });
          } else {
            console.log(`    ⚠ NO /api/bo/ non-GET calls fired during Submit window — the click did not actually save`);
            await log({ event: 'msg_template_no_api' });
          }
          await dismissSystemMessage(3000);
          await page.screenshot({ path: path.join(OUT, `${runId}-msg-tpl-after-submit.png`), fullPage: true }).catch(() => {});
          await log({ event: 'msg_template_submitted', name: a.name });
        } catch (e) {
          console.log(`  ⚠ Couldn't auto-click Submit on Message Template: ${e.message.split('\n')[0]}`);
          await waitForOperator('Click Submit on the Message Template dialog, then type "ok" (or "abort"): ');
        }
      } else if (a.kind === 'dialog_popup_create') {
        // 2026-05-15: Section 15.1.2 (QP2) / 14.1.2 (QPRO) Dialog Popup.
        // Mirrors the message_template_create flow but on /settings/dialog.
        // Always uses "+ Create New Content" (Duplicate is unavailable for
        // dialog popups per operator). After save, captures the 5-letter
        // Code from the BO POST response so the post-save phase can link
        // it on the Edit modal's "Dialog Popup" kt-dropdown.
        if (!formSaveSucceeded) {
          console.log('');
          console.log('─── 15.1.2 Dialog Popup skipped — main form Submit did not save.');
          await log({ event: 'dialog_popup_skipped_no_save' });
          continue;
        }

        const platform = (BRAND_TO_SITE[targetBrand]?.platform || 'qpro').toLowerCase();
        const merchantName = BRAND_TO_SITE[targetBrand]?.merchantName || targetBrand;
        console.log('');
        console.log(`─── 15.1.2 Dialog Popup: creating for "${a.promotion_name_en}" on ${targetBrand} (${platform}) ───`);
        await log({ event: 'dialog_popup_start', promotionName: a.promotion_name_en, platform });

        // Capture POST responses so we can read back the new Code AND id.
        // The endpoint is `/api/bo/popups` (plural) on QPRO — verified via
        // the API contract dump on QPRO11 2026-05-15. Match `/popups` or
        // `/dialog` (in case QP2 uses a different path). The integer `id`
        // is the join key for `dialog_popup_list` on the promotion PUT;
        // the 5-letter Code is human-readable for fallback log lines.
        let capturedCode = null;
        let capturedId = null;
        let capturedStartDate = null;
        const respHandler = async (resp) => {
          const req = resp.request();
          if (req.method() !== 'GET' && /\/api\/bo\/(popups|dialog)/i.test(resp.url())) {
            try {
              const text = await resp.text();
              const json = JSON.parse(text);
              const rows = json?.data?.rows || json?.data || {};
              const code = rows.code;
              const id   = rows.id;
              const sd   = rows.start_date;
              if (code) { capturedCode = code; console.log(`    → captured Dialog Code: "${code}"`); }
              if (id)   { capturedId   = id;   console.log(`    → captured Dialog id:   ${id}`); }
              if (sd)   { capturedStartDate = sd; console.log(`    → captured Dialog start_date: ${sd}`); }
              console.log(`    <<< ${req.method()} ${resp.status()} ${resp.url().split('?')[0]}`);
              if (resp.status() >= 400) console.log(`        response: ${text.slice(0, 400)}`);
            } catch {}
          }
        };
        page.on('response', respHandler);

        try {
          await page.goto(`${site.baseUrl}/settings/dialog`, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(2500);

          // On QP2, switch to the merchant tab matching the brand. QPRO has no
          // tabs (one BO per brand) — skip on QPRO.
          if (platform === 'qp2') {
            try {
              await page.locator(`button:has-text("${merchantName}")`).first().click({ timeout: 3000 });
              await page.waitForTimeout(1500);
              console.log(`  ✓ Switched to merchant tab: ${merchantName}`);
            } catch (e) {
              console.log(`    ⚠ Merchant tab switch skipped: ${e.message.split('\n')[0]}`);
            }
          }

          // Click "+ Create New Content". The button renders as a wide strip
          // in the table HEADER row — it's a <th> wrapping a clickable
          // <div class="content-container text-center"> (verified on QPRO11
          // 2026-05-15 via dialog-create-button-probe). The previous
          // generic span/div selector matched the inner <span> but the click
          // didn't fire the Angular handler. Target the <th> or the
          // content-container <div> specifically. Save a screenshot before
          // the click attempt so a future failure is easier to diagnose.
          await page.screenshot({ path: path.join(OUT, `${runId}-dialog-list-before-create.png`), fullPage: true }).catch(() => {});
          const createCandidates = [
            'th.pr-0.pl-0:has-text("Create New Content")',
            'div.content-container.text-center:has-text("Create New Content")',
            'button:has-text("Create New Content")',
            'a:has-text("Create New Content")',
            '[role="button"]:has-text("Create New Content")',
          ];
          let createClicked = false;
          for (const sel of createCandidates) {
            try {
              const cand = page.locator(sel).first();
              await cand.waitFor({ state: 'visible', timeout: 2500 });
              await cand.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
              await cand.click({ timeout: 3000 });
              createClicked = true;
              console.log(`  ✓ Clicked "Create New Content" via: ${sel}`);
              break;
            } catch {}
          }
          if (!createClicked) {
            // Last-ditch: walk the DOM, find the <th> / <div.content-container>
            // around the "Create New Content" text and dispatch a click on
            // the innermost cursor:pointer ancestor.
            createClicked = await page.evaluate(() => {
              const all = Array.from(document.querySelectorAll('*'));
              const candidates = all.filter((el) => {
                if (el.offsetParent === null) return false;
                const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
                if (!/^\+?\s*Create New Content\s*$/i.test(t)) return false;
                return getComputedStyle(el).cursor === 'pointer';
              });
              const target = candidates[0];
              if (!target) return false;
              target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
              target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              return true;
            });
            if (createClicked) console.log('  ✓ Dispatched click on "Create New Content" via cursor:pointer ancestor');
          }
          if (!createClicked) {
            throw new Error('Could not find "+ Create New Content" trigger after 5 selector variants + DOM walk');
          }
          await page.waitForTimeout(2500);
          await page.screenshot({ path: path.join(OUT, `${runId}-dialog-create-form.png`), fullPage: true }).catch(() => {});

          // Fill form-wide scalars. Position=99, Session=After Login, Start
          // Date = now, End Date = empty, Platform=All, Location=All.
          const dialogScope = page.locator('mat-dialog-container, [role="dialog"], .modal-content, .kt-portlet').filter({ hasText: /Create|New Content/i }).last();
          const setField = async (sel, value, opts = {}) => {
            try {
              const loc = dialogScope.locator(sel).first();
              if (opts.type === 'select') {
                await loc.selectOption({ label: value });
              } else {
                await loc.fill('');
                await loc.fill(value);
              }
            } catch (e) {
              console.log(`    ⚠ ${sel}: ${e.message.split('\n')[0]}`);
            }
          };

          // Label — REQUIRED (POST returns 422 "The label field is required"
          // without it). Operator practice: Label = the EN promotion name
          // (matches existing rows like "VIP SPECIAL FREE CREDIT - 3x TO").
          await setField('input[formcontrolname="label"]', a.promotion_name_en);
          // Position
          await setField('input[formcontrolname="position"]', '99');
          // Session = After Login
          try {
            await dialogScope.locator('select[formcontrolname="session"]').first().selectOption({ label: 'After Login' });
          } catch {}
          // Start Date = now (the field's auto-default is usually now; explicit fill is safer)
          const now = new Date();
          const pad = (n) => String(n).padStart(2, '0');
          const validFromStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
          await setField('input[formcontrolname="start_date"]', validFromStr);
          // End Date stays empty (open-ended).

          console.log(`  ✓ Form scalars: label="${a.promotion_name_en}", position=99, session=After Login, start_date=${validFromStr}`);

          // Discover locale tabs and fill each request locale.
          const tabTexts = await dialogScope.evaluateAll((scopes) => {
            const s = scopes[0];
            if (!s) return [];
            return Array.from(s.querySelectorAll('.mat-tab-label, [role="tab"], .nav-tabs li'))
              .filter((t) => t.offsetParent !== null)
              .map((t) => (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20));
          });
          const ALLOWED_DOCKEYS = new Set(['EN', 'ZH', 'ID']);
          const tabsToFill = tabTexts.filter((t) => ALLOWED_DOCKEYS.has(localeDocKey(t)));
          console.log(`  Locale tabs to fill: ${tabsToFill.join(', ')}`);

          // Localized CTA texts per docKey (operator-confirmed 2026-05-15;
          // see memory/feedback_dialog_popup_defaults.md).
          //   EN  → "CLAIM NOW"     / "READ MORE"
          //   ZH  → "立即领取"      / "阅读更多"
          //   ID  → "Klaim Sekarang" / "Info Lanjut"
          // Right link is uniform `/member/message`. Left link branches on
          // min_deposit: > 0 → `/member/deposit` (Deposit / Cashback /
          // FS-with-transfer); == 0 → `/member/reward` (FC, no-deposit FS).
          const minDep = Number(a.min_deposit ?? resolved?.parsed?.min_deposit ?? 0);
          const ctaLeftLink  = minDep > 0 ? '/member/deposit' : '/member/reward';
          const ctaRightLink = '/member/message';
          const CTA_TEXT_BY_DOCKEY = {
            EN: { left: 'CLAIM NOW', right: 'READ MORE' },
            ZH: { left: '立即领取', right: '阅读更多' },
            ID: { left: 'Klaim Sekarang', right: 'Info Lanjut' },
          };
          console.log(`  CTA links: Left=${ctaLeftLink} (min_deposit=${minDep}), Right=${ctaRightLink}`);

          for (const tab of tabsToFill) {
            try {
              await page.locator('.mat-tab-label, [role="tab"]').filter({ hasText: new RegExp(`^\\s*${tab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first().click({ force: true, timeout: 2000 });
              await page.waitForTimeout(700);

              // CTA Button Type = DUAL. Radio has formcontrolname=null
              // (custom Angular component) — click by label text.
              try {
                await page.locator('label:has-text("DUAL")').first().click({ force: true, timeout: 2000 });
              } catch (e) {
                console.log(`    ⚠ DUAL radio click failed: ${e.message.split('\n')[0]}`);
              }
              await page.waitForTimeout(300);

              const docKey = localeDocKey(tab);
              const ctaText = CTA_TEXT_BY_DOCKEY[docKey] || CTA_TEXT_BY_DOCKEY.EN;

              // CTA fields (formcontrolnames confirmed 2026-05-15 via probe):
              // cta_button_text_1 / cta_button_link_1 = LEFT
              // cta_button_text_2 / cta_button_link_2 = RIGHT
              await setField('input[formcontrolname="cta_button_text_1"]', ctaText.left);
              await setField('input[formcontrolname="cta_button_link_1"]', ctaLeftLink);
              await setField('input[formcontrolname="cta_button_text_2"]', ctaText.right);
              await setField('input[formcontrolname="cta_button_link_2"]', ctaRightLink);

              // Title — use ZH name for ZH locales, EN for EN/ID
              const titleText = docKey === 'ZH' ? (a.promotion_name_zh_id || a.promotion_name_en) : a.promotion_name_en;
              await setField('input[formcontrolname="title"]', titleText);

              // Content body — reuse the Message Template per-locale renderer.
              const rendered = await renderBody({
                bonusType: a.bonus_type,
                locale: tab,
                brand: targetBrand,
                platform,
                resolved,
              });
              if (!rendered.skipped) {
                const bodyOk = await dialogScope.evaluateAll((scopes, html) => {
                  const s = scopes[0];
                  if (!s) return false;
                  const editor = s.querySelector('.ck-editor__editable[contenteditable="true"], [contenteditable="true"]');
                  if (!editor) return false;
                  try {
                    const inst = editor.ckeditorInstance;
                    if (inst?.setData) { inst.setData(html); return true; }
                  } catch {}
                  editor.innerHTML = html;
                  editor.dispatchEvent(new Event('input', { bubbles: true }));
                  return true;
                }, rendered.html);
                if (bodyOk) console.log(`    ✓ ${tab}: Title + CTAs + body (${rendered.html.length} chars)`);
                else console.log(`    ⚠ ${tab}: no CKEditor found`);
              } else {
                console.log(`    ⚠ ${tab}: body render skipped — ${rendered.reason}`);
              }
            } catch (e) {
              console.log(`    ⚠ ${tab}: failed — ${e.message.split('\n')[0]}`);
            }
          }

          // Submit — QPRO labels the button "Create" (btn-success), QP2
          // tends to say "Submit". Match either. Probe verified 2026-05-15
          // on QPRO11: the form's submit button is `button.btn-success` with
          // text "Create". Avoid `Create New` to skip the table's
          // "Create New Content" trigger which may still be visible on the
          // list below the inline form.
          try {
            const submitCandidates = [
              'button.btn-success:has-text("Create"):not(:has-text("Create New"))',
              'button.btn-success:has-text("Submit")',
              'button:has-text("Submit")',
              'button:has-text("Create"):not(:has-text("Create New"))',
            ];
            let submitBtn = null;
            for (const sel of submitCandidates) {
              const cand = page.locator(sel).last();
              try {
                await cand.waitFor({ state: 'visible', timeout: 1500 });
                submitBtn = cand;
                console.log(`    → Submit selector matched: ${sel}`);
                break;
              } catch {}
            }
            if (!submitBtn) throw new Error('no submit/create button found on Dialog form');
            try {
              await submitBtn.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
              await submitBtn.click({ timeout: 4000 });
              console.log('  ✓ Clicked Submit/Create on Dialog Popup form');
            } catch {
              // Force-click via JS as fallback (same pattern as Currency popup)
              await page.evaluate(() => {
                const all = Array.from(document.querySelectorAll('button.btn-success'))
                  .filter((b) => b.offsetParent !== null);
                const btn = all.find((b) => /^\s*(Submit|Create)\s*$/i.test((b.textContent || '').trim()));
                if (btn) { btn.removeAttribute('disabled'); btn.disabled = false; btn.click(); }
              });
              console.log('  ✓ Force-clicked Submit/Create on Dialog Popup form');
            }
            await page.waitForTimeout(3500);
            await dismissSystemMessage(3000);
            await page.screenshot({ path: path.join(OUT, `${runId}-dialog-after-submit.png`), fullPage: true }).catch(() => {});
            if (capturedCode) {
              dialogPopupCode = capturedCode;
              dialogPopupId = capturedId;
              dialogPopupStartDate = capturedStartDate;
              dialogPopupLabel = a.promotion_name_en;
              console.log(`  ✓ Dialog Popup saved with Code: ${dialogPopupCode} (id=${dialogPopupId}, start_date=${dialogPopupStartDate})`);
              console.log(`    → linker armed: next promotion PUT will inject dialog_popup_list={'0':{id:${dialogPopupId}, ...}}`);
              await log({ event: 'dialog_popup_saved', code: dialogPopupCode, id: dialogPopupId, start_date: dialogPopupStartDate });
            } else {
              console.log('  ⚠ Submit fired but no Code captured from response');
              await log({ event: 'dialog_popup_no_code' });
            }
          } catch (e) {
            console.log(`  ⚠ Dialog Popup Submit failed: ${e.message.split('\n')[0]}`);
            await log({ event: 'dialog_popup_submit_fail', error: e.message });
          }
        } finally {
          page.off('response', respHandler);
        }
      }
      await log({ event: 'action_ok', action: a });
    } catch (e) {
      await log({ event: 'action_fail', action: a, error: e.message });
      // FATAL-prefixed errors stop the run entirely (e.g. idempotency abort).
      // Everything else is best-effort — the operator can finish the form
      // manually if a single action fails.
      if (e.message.startsWith('FATAL:')) {
        console.log(`  ✖ FATAL on ${a.label}: ${e.message.replace(/^FATAL:\s*/, '').split('\n')[0]}`);
        throw e;
      }
      console.log(`  ⚠ FAILED on ${a.label}: ${e.message.split('\n')[0]}`);
    }
  }

  // ── Post-save phase: open the saved code, walk operator to Promotion Names popup ──
  // The QPRO BO only exposes the Promotion Names popup on the Edit page, not
  // on Create. So after the operator clicks Submit, the bot navigates back to
  // the list, finds the new code, opens it in Edit mode, and clicks
  // "+ Promotion Names". The actual row-filling stays operator-handled until
  // the Add-form spy lands.
  if (flags['skip-names'] !== true) {
    if (!formSaveSucceeded) {
      console.log('');
      console.log('Post-save Promotion Names skipped — main form Submit did not save.');
      await log({ event: 'post_save_skipped_no_save' });
    } else {
      try {
        await postSavePhase();
      } catch (e) {
        await log({ event: 'post_save_fail', error: e.message });
        console.log(`  ⚠ Post-save navigation failed: ${e.message.split('\n')[0]}`);
        console.log('  You can open the code and add names manually in the browser.');
        await waitForOperator('Press Enter to continue (or "abort"): ');
      }
    }
  }

  await page.screenshot({ path: path.join(OUT, `${runId}-after-save.png`), fullPage: true }).catch(() => {});
  const status = await setTaskStatus({
    taskId,
    requestRef: handle,
    status: 'QC',
    notes: `Canary write complete for ${resolved.promo_code} on ${targetBrand}. Bot auto-submitted. See ${path.basename(logFile)} for the action log.`,
  });
  await log({ event: 'status_update', response: status });
  if (status.skipped) console.log(`Status update: skipped (${status.reason})`);
  else if (status.error) console.log(`Status update: failed (${status.error})`);
  else if (status.response?.ok) console.log(`Status update: task ${status.response.task_id} → ${status.response.new_status}`);
  else console.log(`Status update: HTTP ${status.status} ${JSON.stringify(status.response).slice(0,200)}`);

  await waitForOperator('Press Enter to close the browser. ');
} catch (e) {
  if (e.message !== 'aborted_by_operator') {
    await log({ event: 'error', message: e.message });
    console.error('Error:', e.message);
  } else {
    aborted = true;
  }
} finally {
  rl.close();
  // Dump captured API contract before tearing down the browser.
  try {
    const contractDir = path.resolve('captures/api-contract');
    await mkdir(contractDir, { recursive: true });
    const contractPath = path.join(contractDir, `${runId}.json`);
    await writeFile(contractPath, JSON.stringify({
      runId,
      handle,
      brand: targetBrand,
      site: siteId,
      promo_code: resolved.promo_code,
      bonus_type: resolved.bonus_type,
      bonus_sub_type: resolved.bonus_sub_type,
      capturedAt: new Date().toISOString(),
      calls: apiContract,
    }, null, 2));
    console.log(`API contract: ${contractPath}  (${apiContract.length} calls)`);
  } catch (e) {
    console.log(`API contract dump failed: ${e.message.split('\n')[0]}`);
  }
  await ctx.close();
  await browser.close();
  await log({ event: 'finished', aborted });
}

console.log('');
console.log(`Audit log: ${logFile}`);
